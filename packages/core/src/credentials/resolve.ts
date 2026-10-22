import { CliError } from '../errors.js';
import type { AuthProvider } from '../http.js';
import type { Runtime } from '../runtime.js';
import { credentialAccount, type CredentialTarget } from './account.js';
import { parseCredential, serializeCredential, type StoredCredential } from './stored.js';

type StoreRuntime = Pick<Runtime, 'env' | 'store'>;

export interface ResolveCredentialOptions extends CredentialTarget {
  /** Environment variable carrying a token. It wins over the keychain, for CI and containers. */
  readonly tokenEnv?: string;
  /** Environment variable carrying the paired user name, for schemes such as Basic auth. */
  readonly usernameEnv?: string;
  /** Command that signs in, quoted in the message when no credential exists. */
  readonly loginCommand?: string;
}

export interface ResolvedCredential {
  readonly credential: StoredCredential;
  readonly source: 'env' | 'keychain';
  readonly account: string;
}

/**
 * Finds the credential to use, or fails with an auth error (exit code 3)
 * without touching the network. Order: the token environment variable, then the
 * keychain item for this tool, origin and profile.
 */
export async function resolveCredential(
  runtime: StoreRuntime,
  options: ResolveCredentialOptions,
): Promise<ResolvedCredential> {
  const account = credentialAccount(options);

  const envToken = options.tokenEnv === undefined ? undefined : runtime.env[options.tokenEnv];
  if (envToken !== undefined && envToken !== '') {
    const username =
      options.usernameEnv === undefined ? undefined : runtime.env[options.usernameEnv];
    return {
      credential: {
        kind: 'token',
        token: envToken,
        ...(username === undefined || username === '' ? {} : { username }),
      },
      source: 'env',
      account,
    };
  }

  let stored: string | null;
  try {
    stored = await runtime.store.get(account);
  } catch (error) {
    if (
      error instanceof CliError &&
      error.code === 'keychain_unavailable' &&
      options.tokenEnv !== undefined
    ) {
      throw error.with({
        next: [`Set ${options.tokenEnv} to provide a token without the keychain.`],
      });
    }
    throw error;
  }

  if (stored === null) {
    const next: string[] = [];
    if (options.loginCommand !== undefined) next.push(`Sign in with \`${options.loginCommand}\`.`);
    if (options.tokenEnv !== undefined)
      next.push(`Or set the ${options.tokenEnv} environment variable.`);
    throw new CliError('auth', `No credentials found for ${options.origin}.`, {
      code: 'no_credentials',
      causes: [
        'You have not signed in to this server yet.',
        'You signed in with a different profile.',
      ],
      next,
    });
  }

  const credential = parseCredential(stored);
  if (credential === undefined) {
    throw new CliError('auth', `The stored credential for ${options.origin} is unreadable.`, {
      code: 'credential_corrupt',
      next:
        options.loginCommand === undefined
          ? []
          : [`Sign in again with \`${options.loginCommand}\`.`],
    });
  }
  return { credential, source: 'keychain', account };
}

/** The stored credential, ignoring environment variables; `undefined` when none is stored. */
export async function loadStoredCredential(
  runtime: Pick<Runtime, 'store'>,
  target: CredentialTarget,
): Promise<StoredCredential | undefined> {
  const stored = await runtime.store.get(credentialAccount(target));
  return stored === null ? undefined : parseCredential(stored);
}

export async function saveCredential(
  runtime: Pick<Runtime, 'store'>,
  target: CredentialTarget,
  credential: StoredCredential,
): Promise<void> {
  await runtime.store.set(credentialAccount(target), serializeCredential(credential));
}

/** Removes the stored credential; resolves `false` when there was none. */
export function deleteCredential(
  runtime: Pick<Runtime, 'store'>,
  target: CredentialTarget,
): Promise<boolean> {
  return runtime.store.delete(credentialAccount(target));
}

/** `Authorization: Bearer <token>`. */
export function bearerAuth(token: string): AuthProvider {
  return { authorization: () => Promise.resolve(`Bearer ${token}`) };
}

/** `Authorization: Basic <base64(username:secret)>`. */
export function basicAuth(username: string, secret: string): AuthProvider {
  const encoded = Buffer.from(`${username}:${secret}`, 'utf8').toString('base64');
  return { authorization: () => Promise.resolve(`Basic ${encoded}`) };
}
