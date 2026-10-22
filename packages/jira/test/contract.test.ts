import { jsonResponse, mockFetch, networkFailure } from '@sdlc-tools/core/testing';
import { describe, expect, it } from 'vitest';
import { ENV, TOKEN, fakeJira, jira } from './helpers.js';

/** Every command that talks to Jira: its path in the command tree and a valid invocation. */
const COMMANDS: readonly (readonly [path: readonly string[], argv: readonly string[]])[] = [
  [
    ['issue', 'view'],
    ['issue', 'view', 'ABC-1'],
  ],
  [
    ['issue', 'list'],
    ['issue', 'list', '--jql', 'project = ABC'],
  ],
  [
    ['issue', 'create'],
    ['issue', 'create', '--project', 'ABC', '--type', 'Task', '--summary', 's'],
  ],
  [
    ['issue', 'edit'],
    ['issue', 'edit', 'ABC-1', '--summary', 's'],
  ],
  [
    ['issue', 'transitions'],
    ['issue', 'transitions', 'ABC-1'],
  ],
  [
    ['issue', 'transition'],
    ['issue', 'transition', 'ABC-1', 'Done'],
  ],
  [
    ['issue', 'assign'],
    ['issue', 'assign', 'ABC-1', 'me'],
  ],
  [
    ['issue', 'comment', 'add'],
    ['issue', 'comment', 'add', 'ABC-1', 'text'],
  ],
  [
    ['issue', 'comment', 'list'],
    ['issue', 'comment', 'list', 'ABC-1'],
  ],
  [
    ['issue', 'worklog', 'add'],
    ['issue', 'worklog', 'add', 'ABC-1', '1h'],
  ],
  [
    ['issue', 'worklog', 'list'],
    ['issue', 'worklog', 'list', 'ABC-1'],
  ],
  [
    ['field', 'list'],
    ['field', 'list'],
  ],
  [
    ['auth', 'status'],
    ['auth', 'status'],
  ],
];

describe('failing before the network', () => {
  it.each(COMMANDS)('%s: no site means no request', async (_path, argv) => {
    const run = await jira(argv, {
      env: { SDLC_JIRA_EMAIL: ENV.SDLC_JIRA_EMAIL, SDLC_JIRA_TOKEN: TOKEN },
    });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing Jira site address');
    expect(run.stderr).toContain('--site');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it.each(COMMANDS)('%s: no credentials means exit code 3 and no request', async (_path, argv) => {
    const run = await jira(argv, { env: { SDLC_JIRA_SITE: ENV.SDLC_JIRA_SITE } });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('No credentials found');
    expect(run.stderr).toContain('sdlc-jira auth login');
    expect(run.stderr).toContain('SDLC_JIRA_TOKEN');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it.each(COMMANDS)('%s: --help prints usage and exits 0 without a request', async (path) => {
    const run = await jira([...path, '--help'], { env: {} });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`sdlc-jira ${path.join(' ')}`);
    expect(run.stdout).toContain('Usage:');
    expect(run.fetchCalls).toHaveLength(0);
  });
});

describe('wrong usage prints the usage of the command in question', () => {
  it('suggests the likely command for a typo', async () => {
    const run = await jira(['issue', 'veiw', 'ABC-1']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('view');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('rejects a flag that belongs to another command', async () => {
    const run = await jira(['issue', 'view', 'ABC-1', '--summary', 'x']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--summary');
    expect(run.stderr).toContain('sdlc-jira issue view <key>');
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('rejects a surplus argument and a missing key', async () => {
    const surplus = await jira(['issue', 'view', 'ABC-1', 'ABC-2']);
    expect(surplus.code).toBe(2);
    const missing = await jira(['issue', 'view']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Missing required argument <key>');
  });
});

describe('server errors', () => {
  const failing = (status: number, message?: string) =>
    mockFetch(() =>
      jsonResponse(status, message === undefined ? {} : { errorMessages: [message] }),
    );

  it('401 names the account problem and the way back in (exit 3)', async () => {
    const run = await jira(['issue', 'view', 'ABC-1'], { fetch: failing(401) });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('API token has not expired');
    expect(run.stderr).toContain('sdlc-jira auth login');
    expect(run.stderr).not.toContain(TOKEN);
  });

  it('403 asks for access (exit 4)', async () => {
    const run = await jira(['issue', 'view', 'ABC-1'], { fetch: failing(403) });
    expect(run.code).toBe(4);
    expect(run.stderr).toContain('Next steps:');
  });

  it('400 shows what Jira said about the request (exit 6)', async () => {
    const run = await jira(['issue', 'edit', 'ABC-1', '--summary', 'x'], {
      fetch: failing(400, 'Field "labels" cannot be set.'),
    });
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('Field "labels" cannot be set.');
  });

  it('5xx and rate limits are server errors (exit 6)', async () => {
    expect((await jira(['issue', 'view', 'ABC-1'], { fetch: failing(503) })).code).toBe(6);
    expect((await jira(['issue', 'view', 'ABC-1'], { fetch: failing(429) })).code).toBe(6);
  });

  it('an unreachable site is a network error (exit 7)', async () => {
    const run = await jira(['issue', 'view', 'ABC-1'], {
      fetch: mockFetch(() => {
        throw networkFailure('ENOTFOUND');
      }),
    });
    expect(run.code).toBe(7);
    expect(run.stderr).toContain('team.example.test');
  });

  it('prints errors as JSON on stderr under --json', async () => {
    const run = await jira(['issue', 'view', 'ABC-1', '--json'], { fetch: failing(404) });
    expect(run.code).toBe(5);
    expect(run.errorJson().error).toMatchObject({ kind: 'not-found', exitCode: 5, status: 404 });
  });

  it('never repeats the credentials in any error', async () => {
    const run = await jira(['issue', 'view', 'ABC-1', '--json'], { fetch: failing(401) });
    expect(run.stderr + run.stdout).not.toContain(TOKEN);
    expect(run.stderr + run.stdout).not.toContain(
      Buffer.from(`dev@example.test:${TOKEN}`).toString('base64'),
    );
  });
});

describe('output', () => {
  it('writes results to stdout and nothing to stderr on success', async () => {
    const run = await jira(['field', 'list'], { fetch: fakeJira({ 'GET /rest/api/3/field': [] }) });
    expect(run).toMatchObject({ code: 0, stderr: '' });
  });
});
