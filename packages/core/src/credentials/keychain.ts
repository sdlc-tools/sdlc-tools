import { CliError } from '../errors.js';
import { KEYCHAIN_SERVICE } from './account.js';
import type { SecretStore } from './store.js';

/** The slice of `@napi-rs/keyring` that is used; narrow so tests can supply a fake. */
export interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type LinuxStore = 'secret-service' | 'keyutils';

export interface KeyringBinding {
  AsyncEntry: new (
    service: string,
    username: string,
    options?: { linux?: { store?: LinuxStore } } | null,
  ) => KeyringEntry;
}

export interface KeychainOptions {
  /** Keychain service name; defaults to `sdlc-tools`. */
  readonly service?: string;
  /**
   * Largest piece of a secret, in UTF-16 code units, stored in one keychain
   * item. Windows Credential Manager rejects blobs above 2560 bytes (1280 code
   * units), which a pair of OAuth tokens can exceed, so longer secrets are
   * split across items on every platform.
   */
  readonly chunkSize?: number;
  /** Used to pick platform-specific advice in errors. */
  readonly platform: NodeJS.Platform;
  /**
   * Linux only. By default the Secret Service is used and the kernel keyring
   * is the fallback when no service is running. Pinning a store makes it fail
   * instead of falling back.
   */
  readonly linuxStore?: LinuxStore;
  /** Loads the native binding; replaced in tests. */
  readonly loadBinding?: () => Promise<KeyringBinding>;
}

const DEFAULT_CHUNK_SIZE = 1000;
const HEADER = 'sdlc1:';

async function loadNativeBinding(): Promise<KeyringBinding> {
  return await import('@napi-rs/keyring');
}

/**
 * {@link SecretStore} backed by the operating system credential store: macOS
 * Keychain, Windows Credential Manager, or the Secret Service API (kernel
 * keyring as fallback) on Linux. The native binding is loaded on first use, so
 * commands that never touch credentials do not load it.
 *
 * Layout: the item named by the account holds `sdlc1:<chunk count>:<first
 * chunk>`; further chunks live in items named `<account>~<n>`.
 */
export class KeychainSecretStore implements SecretStore {
  readonly #service: string;
  readonly #chunkSize: number;
  readonly #platform: NodeJS.Platform;
  readonly #linuxStore: LinuxStore | undefined;
  readonly #loadBinding: () => Promise<KeyringBinding>;
  #binding: Promise<KeyringBinding> | undefined;

  constructor(options: KeychainOptions) {
    this.#service = options.service ?? KEYCHAIN_SERVICE;
    this.#chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.#platform = options.platform;
    this.#linuxStore = options.linuxStore;
    this.#loadBinding = options.loadBinding ?? loadNativeBinding;
    if (!Number.isInteger(this.#chunkSize) || this.#chunkSize < 1) {
      throw new Error('chunkSize must be a positive integer.');
    }
  }

  async get(account: string): Promise<string | null> {
    const head = await this.#read(account);
    if (head === null) return null;
    const { count, first } = this.#parseHead(account, head);

    const parts = [first];
    for (let index = 1; index < count; index += 1) {
      const part = await this.#read(chunkAccount(account, index));
      if (part === null) throw this.#corrupt(account);
      parts.push(part);
    }
    return parts.join('');
  }

  async set(account: string, value: string): Promise<void> {
    const chunks = splitValue(value, this.#chunkSize);
    const previous = await this.#readCount(account);

    for (let index = chunks.length - 1; index >= 1; index -= 1) {
      await this.#write(chunkAccount(account, index), chunks[index] ?? '');
    }
    await this.#write(account, `${HEADER}${chunks.length}:${chunks[0] ?? ''}`);
    for (let index = chunks.length; index < previous; index += 1) {
      await this.#remove(chunkAccount(account, index));
    }
  }

  async delete(account: string): Promise<boolean> {
    const count = await this.#readCount(account);
    for (let index = 1; index < count; index += 1) {
      await this.#remove(chunkAccount(account, index));
    }
    return this.#remove(account);
  }

  async #readCount(account: string): Promise<number> {
    const head = await this.#read(account);
    if (head === null) return 0;
    const match = /^sdlc1:(\d+):/.exec(head);
    return match === null ? 1 : Number(match[1]);
  }

  #parseHead(account: string, head: string): { count: number; first: string } {
    const match = /^sdlc1:(\d+):([\s\S]*)$/.exec(head);
    if (match === null) throw this.#corrupt(account);
    const count = Number(match[1]);
    if (count < 1) throw this.#corrupt(account);
    return { count, first: match[2] ?? '' };
  }

  #corrupt(account: string): CliError {
    return new CliError(
      'auth',
      'The stored credential is incomplete or was not written by this tool.',
      {
        code: 'credential_corrupt',
        details: { account },
        next: ['Sign in again to replace the stored credential.'],
      },
    );
  }

  async #entry(account: string): Promise<KeyringEntry> {
    this.#binding ??= this.#loadBinding();
    let binding: KeyringBinding;
    try {
      binding = await this.#binding;
    } catch (error) {
      this.#binding = undefined;
      throw this.#unavailable(error);
    }
    return new binding.AsyncEntry(
      this.#service,
      account,
      this.#linuxStore === undefined ? undefined : { linux: { store: this.#linuxStore } },
    );
  }

  async #read(account: string): Promise<string | null> {
    const entry = await this.#entry(account);
    return this.#guard(() => entry.getPassword());
  }

  async #write(account: string, value: string): Promise<void> {
    const entry = await this.#entry(account);
    await this.#guard(() => entry.setPassword(value));
  }

  async #remove(account: string): Promise<boolean> {
    const entry = await this.#entry(account);
    return this.#guard(() => entry.deletePassword());
  }

  async #guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.#unavailable(error);
    }
  }

  #unavailable(error: unknown): CliError {
    const reason = error instanceof Error ? error.message : String(error);
    const causes: Record<string, string[]> = {
      linux: [
        'No Secret Service provider (such as GNOME Keyring or KWallet) is running; this is typical in containers, CI and SSH sessions.',
        'The keyring is locked.',
      ],
      darwin: ['The login keychain is locked or access to it was denied.'],
      win32: ['Windows Credential Manager rejected the request.'],
    };
    return new CliError('auth', `The OS keychain is not available: ${reason}`, {
      code: 'keychain_unavailable',
      causes: causes[this.#platform] ?? [
        'The operating system credential store could not be reached.',
      ],
      next: ['Supply the credential through an environment variable instead of the keychain.'],
      cause: error,
    });
  }
}

function chunkAccount(account: string, index: number): string {
  return `${account}~${index}`;
}

/** Splits on code point boundaries so a surrogate pair is never cut in half. */
function splitValue(value: string, size: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const character of value) {
    if (current.length + character.length > size) {
      chunks.push(current);
      current = '';
    }
    current += character;
  }
  chunks.push(current);
  return chunks;
}
