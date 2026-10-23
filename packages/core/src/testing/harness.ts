import { runCli } from '../cli.js';
import type { Cli } from '../command.js';
import type { Runtime, StandardInput } from '../runtime.js';
import { forbidFetch, type MockFetch } from './fetch.js';
import { MemoryFiles } from './memory-files.js';
import { MemorySecretStore } from './memory-store.js';

export interface TestRuntimeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly homedir?: string;
  readonly platform?: NodeJS.Platform;
  /** Defaults to {@link forbidFetch}: a test that reaches the network must say so. */
  readonly fetch?: MockFetch;
  readonly store?: MemorySecretStore;
  /** Defaults to an empty {@link MemoryFiles}: no configuration file exists unless a test adds one. */
  readonly files?: MemoryFiles;
  readonly now?: () => number;
  readonly openUrl?: (url: string) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly stdoutIsTTY?: boolean;
  /**
   * What standard input holds. A string is piped input, which is not a
   * terminal; `{ typed }` makes it a terminal where the person enters that
   * line at a hidden prompt. Omitted, it is empty, not a terminal.
   */
  readonly stdin?: string | { readonly typed: string };
}

export interface TestRuntime {
  readonly runtime: Runtime;
  readonly fetch: MockFetch;
  readonly store: MemorySecretStore;
  /** URLs passed to `openUrl` when no custom implementation was given. */
  readonly opened: string[];
  stdout(): string;
  stderr(): string;
}

/** 2026-01-01T00:00:00Z, so token-expiry arithmetic is deterministic. */
export const TEST_NOW = Date.UTC(2026, 0, 1);

function createTestStdin(
  input: TestRuntimeOptions['stdin'],
  stderr: Runtime['stderr'],
): StandardInput {
  const typed = typeof input === 'object' ? input.typed : undefined;
  return {
    isTTY: typed !== undefined,
    readAll: () => Promise.resolve(typeof input === 'string' ? input : ''),
    readHidden: (prompt) => {
      if (typed === undefined)
        return Promise.reject(new Error('Standard input is not a terminal.'));
      // The prompt is shown and the typed line is not, as on a real terminal.
      stderr.write(`${prompt}\n`);
      return Promise.resolve(typed);
    },
  };
}

export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  let stdout = '';
  let stderr = '';
  const opened: string[] = [];
  const fetch = options.fetch ?? forbidFetch();
  const store = options.store ?? new MemorySecretStore();

  const errorStream: Runtime['stderr'] = {
    isTTY: false,
    write: (chunk) => {
      stderr += chunk;
    },
  };

  const runtime: Runtime = {
    env: options.env ?? {},
    cwd: options.cwd ?? '/work',
    homedir: options.homedir ?? '/home/test',
    platform: options.platform ?? 'linux',
    stdout: {
      isTTY: options.stdoutIsTTY ?? false,
      write: (chunk) => {
        stdout += chunk;
      },
    },
    stderr: errorStream,
    stdin: createTestStdin(options.stdin, errorStream),
    fetch: fetch.fetch,
    store,
    files: options.files ?? new MemoryFiles(),
    now: options.now ?? (() => TEST_NOW),
    openUrl:
      options.openUrl ??
      ((url) => {
        opened.push(url);
        return Promise.resolve();
      }),
    signal: options.signal,
  };
  return { runtime, fetch, store, opened, stdout: () => stdout, stderr: () => stderr };
}

export interface TestRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Parses stdout as one JSON document. */
  json(): unknown;
  /** Parses stderr as the JSON error document printed under `--json`. */
  errorJson(): { error: Record<string, unknown> };
  readonly fetchCalls: MockFetch['calls'];
  readonly store: MemorySecretStore;
}

/** Runs a CLI in memory and captures its exit code and output. */
export async function execute(
  cli: Cli,
  argv: readonly string[],
  options: TestRuntimeOptions = {},
): Promise<TestRun> {
  const test = createTestRuntime(options);
  const code = await runCli(cli, argv, test.runtime);
  return {
    code,
    stdout: test.stdout(),
    stderr: test.stderr(),
    json: () => JSON.parse(test.stdout()) as unknown,
    errorJson: () => JSON.parse(test.stderr()) as { error: Record<string, unknown> },
    fetchCalls: test.fetch.calls,
    store: test.store,
  };
}
