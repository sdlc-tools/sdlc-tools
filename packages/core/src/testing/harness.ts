import { runCli } from '../cli.js';
import type { Cli } from '../command.js';
import type { Runtime } from '../runtime.js';
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

export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  let stdout = '';
  let stderr = '';
  const opened: string[] = [];
  const fetch = options.fetch ?? forbidFetch();
  const store = options.store ?? new MemorySecretStore();

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
    stderr: {
      isTTY: false,
      write: (chunk) => {
        stderr += chunk;
      },
    },
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
