import { describe, expect, it } from 'vitest';
import { SITE, body, fakeJira, jira } from './helpers.js';

const TRANSITIONS = {
  transitions: [
    { id: '11', name: 'Start progress', to: { name: 'In Progress' } },
    { id: '21', name: 'Resolve', to: { name: 'Done' } },
    { id: '31', name: 'Close', to: { name: 'Done' } },
    { id: '41', name: 'Reopen', to: { name: 'To Do' } },
  ],
};
const noContent = () => new Response(null, { status: 204 });

describe('issue transitions', () => {
  it('lists what the issue can do now', async () => {
    const run = await jira(['issue', 'transitions', 'ABC-1'], {
      fetch: fakeJira({ 'GET /rest/api/3/issue/ABC-1/transitions': TRANSITIONS }),
    });
    expect(run.stdout).toBe(
      [
        '11  Start progress  -> In Progress',
        '21  Resolve         -> Done',
        '31  Close           -> Done',
        '41  Reopen          -> To Do',
        '',
      ].join('\n'),
    );
  });
});

describe('issue transition', () => {
  const routes = () => ({
    'GET /rest/api/3/issue/ABC-1/transitions': TRANSITIONS,
    'POST /rest/api/3/issue/ABC-1/transitions': noContent,
  });

  it.each([
    ['a target status', 'in progress', '11'],
    ['a transition name', 'RESOLVE', '21'],
    ['an id', '41', '41'],
  ])('moves the issue by %s', async (_name, target, id) => {
    const fetch = fakeJira(routes());
    const run = await jira(['issue', 'transition', 'ABC-1', target], { fetch });
    expect(run.code).toBe(0);
    expect(body(fetch.calls[1])).toEqual({ transition: { id } });
    expect(run.stdout).toMatch(/^ABC-1 -> /);
  });

  it('adds a comment and required fields to the transition', async () => {
    const fetch = fakeJira({
      ...routes(),
      'GET /rest/api/3/field': [
        { id: 'resolution', name: 'Resolution', custom: false, schema: { type: 'resolution' } },
      ],
    });
    const run = await jira(
      [
        'issue',
        'transition',
        'ABC-1',
        'Resolve',
        '--comment',
        'Done **now**',
        '--field-json',
        'Resolution={"name":"Done"}',
        '--json',
      ],
      { fetch },
    );
    expect(run.code).toBe(0);
    const sent = body(fetch.calls.at(-1));
    expect(sent.transition).toEqual({ id: '21' });
    expect(sent.fields).toEqual({ resolution: { name: 'Done' } });
    expect(JSON.stringify(sent.update)).toContain('"strong"');
    expect(run.json()).toMatchObject({
      key: 'ABC-1',
      status: 'Done',
      transition: { id: '21', name: 'Resolve' },
    });
  });

  it('refuses an ambiguous target and lists the ids to choose from', async () => {
    const fetch = fakeJira(routes());
    const run = await jira(['issue', 'transition', 'ABC-1', 'done'], { fetch });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('21  Resolve -> Done');
    expect(run.stderr).toContain('31  Close -> Done');
    expect(fetch.calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('lists the available transitions when none matches', async () => {
    const fetch = fakeJira(routes());
    const run = await jira(['issue', 'transition', 'ABC-1', 'Blocked'], { fetch });
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('cannot move to "Blocked"');
    expect(run.stderr).toContain('Start progress');
    expect(fetch.calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('fails locally without the target', async () => {
    const run = await jira(['issue', 'transition', 'ABC-1']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Missing required argument <target>');
    expect(run.stderr).toContain('sdlc-jira issue transition <key> <target>');
    expect(run.fetchCalls).toHaveLength(0);
  });
});

describe('issue assign', () => {
  const ADA = {
    accountId: 'acc-ada',
    displayName: 'Ada Lovelace',
    emailAddress: 'ada@example.test',
    active: true,
  };

  it('assigns the signed-in account with "me"', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/myself': { accountId: 'acc-me' },
      'PUT /rest/api/3/issue/ABC-1/assignee': noContent,
    });
    const run = await jira(['issue', 'assign', 'ABC-1', 'me'], { fetch });
    expect(run.code).toBe(0);
    expect(body(fetch.calls[1])).toEqual({ accountId: 'acc-me' });
  });

  it('clears the assignee with "none"', async () => {
    const fetch = fakeJira({ 'PUT /rest/api/3/issue/ABC-1/assignee': noContent });
    const run = await jira(['issue', 'assign', 'ABC-1', 'none'], { fetch });
    expect(body(fetch.calls[0])).toEqual({ accountId: null });
    expect(run.stdout).toBe('ABC-1 is now unassigned.\n');
    expect(fetch.calls).toHaveLength(1);
  });

  it('uses an account id as given, without a lookup', async () => {
    const fetch = fakeJira({ 'PUT /rest/api/3/issue/ABC-1/assignee': noContent });
    await jira(['issue', 'assign', 'ABC-1', '5b10a2844c20165700ede21f'], { fetch });
    expect(body(fetch.calls[0])).toEqual({ accountId: '5b10a2844c20165700ede21f' });
  });

  it('finds a person assignable to that issue by name or e-mail', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/user/assignable/search': [
        ADA,
        { ...ADA, accountId: 'acc-old', active: false },
      ],
      'PUT /rest/api/3/issue/ABC-1/assignee': noContent,
    });
    await jira(['issue', 'assign', 'ABC-1', 'Ada'], { fetch });
    expect(fetch.calls[0]?.url.searchParams.get('issueKey')).toBe('ABC-1');
    expect(body(fetch.calls[1])).toEqual({ accountId: 'acc-ada' });
  });

  it('prefers an exact match over a partial one', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/user/assignable/search': [
        ADA,
        {
          ...ADA,
          accountId: 'acc-2',
          displayName: 'Ada Lovelace Jr',
          emailAddress: 'jr@example.test',
        },
      ],
      'PUT /rest/api/3/issue/ABC-1/assignee': noContent,
    });
    await jira(['issue', 'assign', 'ABC-1', 'ada lovelace'], { fetch });
    expect(body(fetch.calls[1])).toEqual({ accountId: 'acc-ada' });
  });

  it('lists the candidates instead of guessing when several people match', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/user/assignable/search': [
        ADA,
        {
          ...ADA,
          accountId: 'acc-2',
          displayName: 'Ada Byron',
          emailAddress: 'byron@example.test',
        },
      ],
    });
    const run = await jira(['issue', 'assign', 'ABC-1', 'Ada'], { fetch });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('matches 2 users');
    expect(run.stderr).toContain('byron@example.test');
    expect(fetch.calls).toHaveLength(1);
  });

  it('reports nobody found with exit code 5', async () => {
    const run = await jira(['issue', 'assign', 'ABC-1', 'Zed'], {
      fetch: fakeJira({ 'GET /rest/api/3/user/assignable/search': [] }),
    });
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('No assignable user matches "Zed"');
  });

  it('returns the browse url in --json', async () => {
    const run = await jira(['issue', 'assign', 'ABC-1', 'none', '--json'], {
      fetch: fakeJira({ 'PUT /rest/api/3/issue/ABC-1/assignee': noContent }),
    });
    expect(run.json()).toEqual({ key: 'ABC-1', accountId: null, url: `${SITE}/browse/ABC-1` });
  });
});
