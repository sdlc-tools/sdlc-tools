import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openInBrowser } from '../src/index.js';

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const tsc = fileURLToPath(new URL('../../../node_modules/.bin/tsc', import.meta.url));

const ENTRY = `
import { HttpClient, defineCli, defineCommand, normalizeServerUrl, runMain } from './dist/index.js';

const get = defineCommand({
  name: 'get',
  summary: 'Fetch a path from the server',
  positionals: [{ name: 'path', description: 'Request path', required: true }],
  options: { host: { type: 'string', required: true, description: 'Server address' } },
  run: async ({ options, args }, context) => {
    const server = normalizeServerUrl(options.host);
    const client = new HttpClient({ baseUrl: server.baseUrl, fetch: context.fetch, signal: context.signal });
    const response = await client.get(args.path, { resource: 'the thing' });
    return { data: response.data, text: 'ok ' + JSON.stringify(response.data) };
  },
});

await runMain(defineCli({ name: 'smoke', version: '9.9.9', summary: 'Smoke test CLI', commands: [get] }));
`;

// These tests compile the sources to a temporary directory and run them as a
// real Node process, so they cover the entry point, exit codes and stream
// flushing that in-memory tests cannot. They do not depend on a prior `build`.
/** Real CLI subprocesses and loopback sockets are slow work, not in-process logic: budget for a starved machine. */
const REAL_TIMEOUT = 30_000;

describe.skipIf(process.platform === 'win32')('CLI process', { timeout: REAL_TIMEOUT }, () => {
  let directory: string;
  let server: Server | undefined;
  let host: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdlc-core-process-'));
    await run(tsc, ['-p', 'tsconfig.build.json', '--outDir', join(directory, 'dist')], {
      cwd: packageRoot,
    });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'cli.mjs'), ENTRY);

    const listening = createServer((request, response) => {
      const status = Number(/^\/(\d{3})$/.exec(request.url ?? '')?.[1] ?? 200);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(status === 200 ? { hello: 'world' } : { message: `status ${status}` }),
      );
    });
    server = listening;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    host = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    server?.closeAllConnections();
    await rm(directory, { recursive: true, force: true });
  });

  async function cli(...args: string[]) {
    try {
      const { stdout, stderr } = await run(process.execPath, [join(directory, 'cli.mjs'), ...args]);
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
    }
  }

  it('prints the version and exits 0', async () => {
    expect(await cli('--version')).toEqual({ code: 0, stdout: 'smoke 9.9.9\n', stderr: '' });
  });

  it('prints help to stdout for --help and exits 0', async () => {
    const result = await cli('get', '--help');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('smoke get <path> [options]');
  });

  it('exits 2 and prints usage for a missing command', async () => {
    const result = await cli();
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Missing command');
    expect(result.stderr).toContain('Commands:');
  });

  it('exits 2 and prints the command usage for an unknown flag, before any network call', async () => {
    const result = await cli('get', '/200', '--host', host, '--bogus');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown option '--bogus'.");
    expect(result.stderr).toContain('smoke get <path> [options]');
  });

  it('prints the short result and exits 0 on success', async () => {
    expect(await cli('get', '/200', '--host', host)).toEqual({
      code: 0,
      stdout: 'ok {"hello":"world"}\n',
      stderr: '',
    });
  });

  it('prints the full result as JSON with --json', async () => {
    const result = await cli('get', '/200', '--host', host, '--json');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ hello: 'world' });
  });

  it.each([
    [401, 3, 'rejected the credentials'],
    [403, 4, 'denied access to the thing'],
    [404, 5, 'could not find the thing'],
    [500, 6, 'reported an internal error'],
  ])('maps HTTP %i to exit code %i', async (status, code, text) => {
    const result = await cli('get', `/${status}`, '--host', host);
    expect(result.code).toBe(code);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(text);
    expect(result.stderr).toContain('Next steps:');
  });

  it('prints errors as JSON on stderr with --json', async () => {
    const result = await cli('get', '/404', '--host', host, '--json');
    expect(result.code).toBe(5);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { kind: 'not-found', exitCode: 5, status: 404 },
    });
  });

  it('exits 7 when the server cannot be reached', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));

    const result = await cli('get', '/200', '--host', `http://127.0.0.1:${port}`);
    expect(result.code).toBe(7);
    expect(result.stderr).toContain('Could not reach');
  });
});

describe('openInBrowser', { timeout: REAL_TIMEOUT }, () => {
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.test/'])(
    'refuses to open %s',
    async (url) => {
      await expect(openInBrowser(url, 'linux')).rejects.toThrow(/Refusing to open/);
    },
  );
});
