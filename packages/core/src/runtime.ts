import type { FileReader } from './files.js';
import type { SecretStore } from './credentials/store.js';

export interface WritableLike {
  write(chunk: string): unknown;
  readonly isTTY?: boolean | undefined;
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
