import { describe, expect, it } from 'vitest';
import { BASIC, ENV, ISSUE, SITE, fakeJira, jira } from './helpers.js';

describe('issue view', () => {
  it('prints a short summary of the issue', async () => {
    const fetch = fakeJira({ 'GET /rest/api/3/issue/ABC-1': ISSUE });
    const run = await jira(['issue', 'view', 'abc-1'], { fetch });

    expect(run.code).toBe(0);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.url.searchParams.get('fields')).toBe('*all');
    expect(fetch.calls[0]?.headers.get('authorization')).toBe(BASIC);
    expect(run.stdout).toBe(
      [
        'ABC-1  Fix the login page',
        'Status: In Progress  Type: Bug  Priority: High',
        'Assignee: Ada Lovelace  Reporter: Grace Hopper',
        'Labels: web, urgent  Due: 2026-12-31  Updated: 2026-03-01T10:00:00.000+0900',
        `${SITE}/browse/ABC-1`,
        '',
        'It breaks on submit.',
        '',
        'Comments (1):',
        'Grace Hopper  2026-03-01T09:00:00.000+0900',
        '  Reproduced.',
        '',
      ].join('\n'),
    );
  });

  it('prints the complete issue with --json, plus its url', async () => {
    const run = await jira(['issue', 'view', 'ABC-1', '--json'], {
      fetch: fakeJira({ 'GET /rest/api/3/issue/ABC-1': ISSUE }),
    });
    expect(run.json()).toEqual({ ...ISSUE, url: `${SITE}/browse/ABC-1`, aliases: {} });
  });

  it('shows only the latest comments', async () => {
    const comments = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      author: { displayName: 'Ada' },
      created: `2026-03-0${index + 1}`,
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `note ${index + 1}` }] }],
      },
    }));
    const run = await jira(['issue', 'view', 'ABC-1', '--comments', '2'], {
      fetch: fakeJira({
        'GET /rest/api/3/issue/ABC-1': {
          ...ISSUE,
          fields: { ...ISSUE.fields, comment: { comments } },
        },
      }),
    });
    expect(run.stdout).toContain('Comments (last 2 of 4):');
    expect(run.stdout).toContain('note 4');
    expect(run.stdout).not.toContain('note 2');
  });

  it('translates a 404 into causes and next steps with the exit code 5', async () => {
    const run = await jira(['issue', 'view', 'ABC-9'], {
      fetch: fakeJira({
        'GET /rest/api/3/issue/ABC-9': new Response('{}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      }),
    });
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('issue ABC-9');
    expect(run.stderr).toContain('Next steps:');
  });
});

describe('issue list', () => {
  const search = (issues = [ISSUE], extra: Record<string, unknown> = {}) =>
    fakeJira({ 'GET /rest/api/3/search/jql': { issues, ...extra } });

  it('sends a JQL query as given and tabulates the result', async () => {
    const fetch = search();
    const run = await jira(['issue', 'list', '--jql', 'project = ABC ORDER BY created'], { fetch });
    expect(run.code).toBe(0);
    expect(fetch.calls[0]?.url.searchParams.get('jql')).toBe('project = ABC ORDER BY created');
    expect(fetch.calls[0]?.url.searchParams.get('maxResults')).toBe('25');
    expect(run.stdout).toBe('ABC-1  In Progress  Ada Lovelace  Fix the login page\n\n1 issue\n');
  });

  it('builds quoted JQL from filters and the configured project', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/search/jql': { issues: [] },
      'GET /rest/api/3/myself': { accountId: 'me-id' },
    });
    const run = await jira(
      [
        'issue',
        'list',
        '--project',
        'abc',
        '--assignee',
        'me',
        '--status',
        'In Progress',
        '--status',
        'To "Do"',
        '--type',
        'Bug',
        '--label',
        'web',
      ],
      { fetch },
    );
    expect(run.stdout).toBe('No issues found.\n');
    expect(fetch.calls[1]?.url.searchParams.get('jql')).toBe(
      'project = "abc" AND assignee = "me-id" AND status in ("In Progress", "To \\"Do\\"") AND issuetype in ("Bug") AND labels = "web" ORDER BY updated DESC',
    );
  });

  it('takes the project from the environment', async () => {
    const fetch = search([]);
    await jira(['issue', 'list', '--status', 'Done'], {
      fetch,
      env: { ...ENV, SDLC_JIRA_PROJECT: 'XYZ' },
    });
    expect(fetch.calls[0]?.url.searchParams.get('jql')).toBe(
      'project = "XYZ" AND status in ("Done") ORDER BY updated DESC',
    );
  });

  it('searches unassigned issues and requests extra fields', async () => {
    const fetch = search([]);
    await jira(['issue', 'list', '--assignee', 'none', '--fields', 'duedate, labels'], { fetch });
    const params = fetch.calls[0]?.url.searchParams;
    expect(params?.get('jql')).toBe('assignee is EMPTY ORDER BY updated DESC');
    expect(params?.get('fields')).toBe(
      'summary,status,assignee,issuetype,priority,updated,duedate,labels',
    );
  });

  it('follows page tokens up to the limit and reports when more exist', async () => {
    const pages = [
      { issues: [ISSUE, { ...ISSUE, key: 'ABC-2' }], nextPageToken: 'p2' },
      { issues: [{ ...ISSUE, key: 'ABC-3' }], nextPageToken: 'p3' },
    ];
    let page = 0;
    const fetch = fakeJira({ 'GET /rest/api/3/search/jql': () => pages[page++] });
    const run = await jira(['issue', 'list', '--jql', 'project = ABC', '--limit', '3', '--json'], {
      fetch,
    });

    expect(fetch.calls.map((call) => call.url.searchParams.get('nextPageToken'))).toEqual([
      null,
      'p2',
    ]);
    expect(fetch.calls.map((call) => call.url.searchParams.get('maxResults'))).toEqual(['3', '1']);
    const result = run.json() as {
      count: number;
      hasMore: boolean;
      issues: { key: string; url: string }[];
    };
    expect(result.count).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.issues.map((issue) => issue.key)).toEqual(['ABC-1', 'ABC-2', 'ABC-3']);
    expect(result.issues[0]?.url).toBe(`${SITE}/browse/ABC-1`);
  });

  it('mentions in the text when more issues exist than were shown', async () => {
    const run = await jira(['issue', 'list', '--jql', 'project = ABC', '--limit', '1'], {
      fetch: search([ISSUE], { nextPageToken: 'more' }),
    });
    expect(run.stdout).toContain('more available');
  });

  it.each([
    [
      '--jql with a filter',
      ['--jql', 'project = ABC', '--status', 'Done'],
      '--jql cannot be combined',
    ],
    ['no query and no project', [], 'Missing Jira project key'],
    ['a bad project key', ['--project', 'a b'], 'not a valid Jira project key'],
    ['a bad limit', ['--jql', 'x', '--limit', '0'], '--limit'],
    ['an empty --jql', ['--jql', ' '], '--jql must not be empty'],
  ])('fails locally on %s', async (_name, args, message) => {
    const run = await jira(['issue', 'list', ...args]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.fetchCalls).toHaveLength(0);
  });
});
