import type { FileReader } from './files.js';
import type { SecretStore } from './credentials/store.js';

export interface WritableLike {
  write(chunk: string): unknown;
  readonly isTTY?: boolean | undefined;
}

/** Standard input as a command sees it: a terminal a person types into, or whatever is piped or redirected in. */
export interface StandardInput {
  /** True when standard input is a terminal; false for a pipe, a file or no input at all. */
  readonly isTTY: boolean;
  /** Everything written to standard input as UTF-8 text, until it ends. */
  readAll(): Promise<string>;
  /**
   * Writes `prompt` to standard error, then reads one line typed on the
   * terminal without echoing it. Only meaningful when {@link isTTY} is true.
   */
  readHidden(prompt: string): Promise<string>;
}

/**
 * Everything a CLI touches in its environment. Library code receives a Runtime
 * instead of reaching for `process`, `console` or global `fetch`, so a test can
 * supply doubles and prove, for example, that a command failed before any
 * network call. `createNodeRuntime` in `main.ts` builds the real one.
 */
export interface Runtime {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly homedir: string;
  readonly platform: NodeJS.Platform;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly stdin: StandardInput;
  readonly fetch: typeof globalThis.fetch;
  readonly store: SecretStore;
  readonly files: FileReader;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => number;
  /** Opens a URL in the user's browser. Rejects when no browser could be launched. */
  readonly openUrl: (url: string) => Promise<void>;
  /** Aborted when the user cancels, for example with Ctrl-C. */
  readonly signal?: AbortSignal | undefined;
}
