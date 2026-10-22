import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { runCli } from './cli.js';
import type { Cli } from './command.js';
import { KeychainSecretStore } from './credentials/keychain.js';
import type { Runtime } from './runtime.js';

/** Opens `url` in the default browser. Only http(s) addresses are launched. */
export function openInBrowser(url: string, platform: NodeJS.Platform): Promise<void> {
  const protocol = new URL(url).protocol;
  if (protocol !== 'http:' && protocol !== 'https:') {
    return Promise.reject(new Error(`Refusing to open a ${protocol} address.`));
  }
  const [command, args] =
    platform === 'darwin'
      ? (['open', [url]] as const)
      : platform === 'win32'
        ? (['rundll32', ['url.dll,FileProtocolHandler', url]] as const)
        : (['xdg-open', [url]] as const);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** The real environment: process streams, global fetch, the OS keychain and the system clock. */
export function createNodeRuntime(signal?: AbortSignal): Runtime {
  return {
    env: process.env,
    cwd: process.cwd(),
    homedir: homedir(),
    platform: process.platform,
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    store: new KeychainSecretStore({ platform: process.platform }),
    now: () => Date.now(),
    openUrl: (url) => openInBrowser(url, process.platform),
    signal,
  };
}

/**
 * Entry point for a CLI executable: runs `cli` against the real environment and
 * sets the process exit code. The first Ctrl-C (or SIGTERM) cancels in-flight
 * work gracefully; a second one terminates the process.
 */
export async function runMain(
  cli: Cli,
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    process.exitCode = await runCli(cli, argv, createNodeRuntime(controller.signal));
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
