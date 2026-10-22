import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { saveCredential } from '@sdlc-tools/core';
import { MemorySecretStore, execute, jsonResponse, mockFetch } from '@sdlc-tools/core/testing';
import { cli } from './fixtures/example-cli.js';

const HOST = 'https://git.example.test';
const ITEM = { title: 'Fix the login page' };

describe('a tool built on core: parse, then configuration, then credentials, then network', () => {
  it('fails on missing arguments before anything else', async () => {
    const run = await execute(cli, ['show']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing required argument <id>.');
    expect(run.stderr).toContain('sdlc-example show <id> [options]');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('fails on a missing server address and names every way to provide it', async () => {
    const run = await execute(cli, ['show', '12']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing server address.');
    expect(run.stderr).toContain('Pass --host.');
    expect(run.stderr).toContain('SDLC_EXAMPLE_HOST');
    expect(run.stderr).toContain('"host" under "example"');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('refuses an insecure server address before any request', async () => {
    const run = await execute(cli, ['show', '12', '--host', 'http://git.example.test']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('must use https');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('fails on missing credentials with exit code 3 before any request', async () => {
    const run = await execute(cli, ['show', '12', '--host', HOST]);
    expect(run.code).toBe(3);
    expect(run.stderr).toContain(`No credentials found for ${HOST}.`);
    expect(run.stderr).toContain('Sign in with `sdlc-example auth login`.');
    expect(run.stderr).toContain('SDLC_EXAMPLE_TOKEN');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('calls the server with a token from the environment and prints the short result', async () => {
    const fetch = mockFetch(() => jsonResponse(200, ITEM));
    const run = await execute(cli, ['show', '12'], {
      fetch,
      env: { SDLC_EXAMPLE_HOST: HOST, SDLC_EXAMPLE_TOKEN: 'env-token' },
    });
    expect(run).toMatchObject({ code: 0, stdout: 'Fix the login page\n', stderr: '' });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.url.href).toBe(`${HOST}/api/items/12`);
    expect(fetch.calls[0]?.headers.get('authorization')).toBe('Bearer env-token');
  });

  it('uses the credential stored for that server in the keychain', async () => {
    const store = new MemorySecretStore();
    await saveCredential(
      { store },
      { tool: 'example', origin: HOST },
      { kind: 'token', token: 'stored' },
    );
    const fetch = mockFetch(() => jsonResponse(200, ITEM));
    const run = await execute(cli, ['show', '12', '--host', HOST], { fetch, store });
    expect(run.code).toBe(0);
    expect(fetch.calls[0]?.headers.get('authorization')).toBe('Bearer stored');

    const other = await execute(cli, ['show', '12', '--host', 'https://other.example.test'], {
      fetch,
      store,
    });
    expect(other.code).toBe(3);
    expect(fetch.calls).toHaveLength(1);
  });

  it('prints the full result as one JSON document with --json', async () => {
    const fetch = mockFetch(() => jsonResponse(200, { ...ITEM, id: 12, labels: ['bug'] }));
    const run = await execute(cli, ['show', '12', '--json'], {
      fetch,
      env: { SDLC_EXAMPLE_HOST: HOST, SDLC_EXAMPLE_TOKEN: 't' },
    });
    expect(run.code).toBe(0);
    expect(run.json()).toEqual({ title: 'Fix the login page', id: 12, labels: ['bug'] });
  });

  it.each([
    [401, 3, 'rejected the credentials', 'Sign in with `sdlc-example auth login`.'],
    [403, 4, 'denied access to item 12', 'Ask an owner or administrator'],
    [404, 5, 'could not find item 12', 'Check the spelling of the identifiers'],
    [500, 6, 'internal error', 'Retry in a moment.'],
  ])(
    'translates HTTP %i into exit code %i with next steps',
    async (status, code, message, step) => {
      const fetch = mockFetch(() => jsonResponse(status, { message: 'details' }));
      const run = await execute(cli, ['show', '12'], {
        fetch,
        env: { SDLC_EXAMPLE_HOST: HOST, SDLC_EXAMPLE_TOKEN: 't' },
      });
      expect(run.code).toBe(code);
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain(message);
      expect(run.stderr).toContain(step);
    },
  );

  it('encodes the id as one path segment', async () => {
    const fetch = mockFetch(() => jsonResponse(404, {}));
    await execute(cli, ['show', '../admin'], {
      fetch,
      env: { SDLC_EXAMPLE_HOST: HOST, SDLC_EXAMPLE_TOKEN: 't' },
    });
    expect(fetch.calls[0]?.url.pathname).toBe('/api/items/..%2Fadmin');
  });
});

describe('documentation', () => {
  it('shows the tested example CLI in the package README', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const block = /<!-- example:cli -->\s*```ts\n([\s\S]*?)```/.exec(readme)?.[1];
    const fixture = await readFile(new URL('./fixtures/example-cli.ts', import.meta.url), 'utf8');
    expect(block?.trim()).toBe(fixture.trim());
  });
});
