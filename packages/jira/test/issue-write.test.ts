import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV, SITE, body, fakeJira, jira } from './helpers.js';

const FIELDS = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
  { id: 'customfield_20001', name: 'Story Points', custom: true, schema: { type: 'number' } },
  {
    id: 'customfield_20002',
    name: 'Notes',
    custom: true,
    schema: { type: 'string', custom: 'x:textarea' },
  },
  {
    id: 'customfield_20003',
    name: 'Components Team',
    custom: true,
    schema: { type: 'array', items: 'string' },
  },
  { id: 'customfield_20004', name: 'Dup', custom: true, schema: { type: 'string' } },
  { id: 'customfield_20005', name: 'dup', custom: true, schema: { type: 'string' } },
  { id: 'customfield_20006', name: 'Reviewer', custom: true, schema: { type: 'user' } },
];

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sdlc-jira-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('issue create', () => {
  const created = { id: '10002', key: 'ABC-2' };

  it('creates an issue and prints its key and address', async () => {
    const fetch = fakeJira({
      'POST /rest/api/3/issue': new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const run = await jira(
      ['issue', 'create', '--project', 'ABC', '--type', 'Task', '--summary', 'Rotate the key'],
      { fetch },
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`Created ABC-2\n${SITE}/browse/ABC-2\n`);
    expect(body(fetch.calls[0])).toEqual({
      fields: {
        summary: 'Rotate the key',
        project: { key: 'ABC' },
        issuetype: { name: 'Task' },
      },
    });
  });

  it('builds every option into the request, converting the description to ADF', async () => {
    const file = join(directory, 'spec.md');
    await writeFile(file, '## Goal\n\n- ship it');
    const fetch = fakeJira({
      'POST /rest/api/3/issue': created,
      'GET /rest/api/3/user/assignable/search': [
        { accountId: 'acc-1', displayName: 'Ada Lovelace', emailAddress: 'ada@example.test' },
      ],
    });
    const run = await jira(
      [
        'issue',
        'create',
        '--type',
        'Story',
        '--summary',
        'Export',
        '--description-file',
        'spec.md',
        '--priority',
        'High',
        '--due',
        '2026-12-31',
        '--estimate',
        '2d 4H',
        '--label',
        'a',
        '--label',
        'b',
        '--parent',
        'abc-1',
        '--assignee',
        'ada@example.test',
        '--json',
      ],
      { fetch, cwd: directory, env: { ...ENV, SDLC_JIRA_PROJECT: 'ABC' } },
    );
    expect(run.code).toBe(0);
    expect(run.json()).toEqual({ id: '10002', key: 'ABC-2', url: `${SITE}/browse/ABC-2` });

    expect(fetch.calls[0]?.url.searchParams.get('project')).toBe('ABC');
    expect(fetch.calls[0]?.url.searchParams.get('query')).toBe('ada@example.test');
    const sent = body(fetch.calls[1]).fields as Record<string, unknown>;
    expect(sent).toMatchObject({
      summary: 'Export',
      priority: { name: 'High' },
      duedate: '2026-12-31',
      timetracking: { originalEstimate: '2d 4h' },
      labels: ['a', 'b'],
      parent: { key: 'ABC-1' },
      assignee: { accountId: 'acc-1' },
      project: { key: 'ABC' },
      issuetype: { name: 'Story' },
    });
    expect(
      (sent.description as { type: string; content: { type: string }[] }).content.map(
        (node) => node.type,
      ),
    ).toEqual(['heading', 'bulletList']);
  });

  it('resolves custom fields by name through the site, with typed values', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/field': FIELDS,
      'POST /rest/api/3/issue': created,
    });
    const run = await jira(
      [
        'issue',
        'create',
        '--project',
        'ABC',
        '--type',
        'Task',
        '--summary',
        's',
        '--field',
        'story points=5',
        '--field',
        'Notes=**hi**',
        '--field',
        'Components Team=a, b',
        '--field-json',
        'customfield_20006={"accountId":"acc-9"}',
      ],
      { fetch },
    );
    expect(run.code).toBe(0);
    expect(fetch.calls).toHaveLength(2);
    const sent = body(fetch.calls[1]).fields as Record<string, unknown>;
    expect(sent.customfield_20001).toBe(5);
    expect(sent.customfield_20003).toEqual(['a', 'b']);
    expect(sent.customfield_20006).toEqual({ accountId: 'acc-9' });
    expect((sent.customfield_20002 as { type: string }).type).toBe('doc');
  });

  it('reads field aliases from the configuration and skips the lookup for JSON values', async () => {
    await writeFile(
      join(directory, '.sdlc-tools.json'),
      JSON.stringify({ jira: { fields: { points: 'customfield_20001' } } }),
    );
    await writeFile(join(directory, '.git'), '');
    const fetch = fakeJira({ 'POST /rest/api/3/issue': created });
    const run = await jira(
      [
        'issue',
        'create',
        '--project',
        'ABC',
        '--type',
        'Task',
        '--summary',
        's',
        '--field-json',
        'points=8',
      ],
      { fetch, cwd: directory },
    );
    expect(run.code).toBe(0);
    expect(fetch.calls).toHaveLength(1);
    expect((body(fetch.calls[0]).fields as Record<string, unknown>).customfield_20001).toBe(8);
  });

  it.each([
    ['an unknown field', ['--field', 'Nope=1'], 5, 'no field named "Nope"'],
    ['an ambiguous field name', ['--field', 'dup=1'], 2, 'matches more than one field'],
    ['a non-numeric number', ['--field', 'Story Points=lots'], 2, 'expects a number'],
    ['a field that needs JSON', ['--field', 'Reviewer=ada'], 2, '--field-json'],
    [
      'a field given twice',
      ['--field', 'Story Points=1', '--field-json', 'Story Points=2'],
      2,
      'more than once',
    ],
    [
      'a field also set by an option',
      ['--field', 'Summary=other'],
      2,
      'both an option and --field',
    ],
  ])('rejects %s without creating anything', async (_name, extra, code, message) => {
    const fetch = fakeJira({ 'GET /rest/api/3/field': FIELDS });
    const run = await jira(
      ['issue', 'create', '--project', 'ABC', '--type', 'Task', '--summary', 's', ...extra],
      { fetch },
    );
    expect(run.code).toBe(code);
    expect(run.stderr).toContain(message);
    expect(fetch.calls.map((call) => call.method)).toEqual(['GET']);
  });

  it.each([
    [
      'a missing summary',
      ['--project', 'ABC', '--type', 'Task'],
      "Missing required option '--summary'",
    ],
    ['a missing type', ['--project', 'ABC', '--summary', 's'], '--type'],
    ['a missing project', ['--type', 'Task', '--summary', 's'], 'Missing Jira project key'],
    [
      'both description sources',
      [
        '--project',
        'ABC',
        '--type',
        'T',
        '--summary',
        's',
        '--description',
        'x',
        '--description-file',
        'y',
      ],
      'not both',
    ],
    [
      'an unreadable description file',
      ['--project', 'ABC', '--type', 'T', '--summary', 's', '--description-file', 'missing.md'],
      'Cannot read',
    ],
    [
      'an impossible date',
      ['--project', 'ABC', '--type', 'T', '--summary', 's', '--due', '2026-02-30'],
      'YYYY-MM-DD',
    ],
    [
      'a bad estimate',
      ['--project', 'ABC', '--type', 'T', '--summary', 's', '--estimate', 'soon'],
      'not a duration',
    ],
    [
      'a bad parent',
      ['--project', 'ABC', '--type', 'T', '--summary', 's', '--parent', 'nope'],
      'not an issue key',
    ],
    [
      'a field without a value',
      ['--project', 'ABC', '--type', 'T', '--summary', 's', '--field', 'Name'],
      'name=value',
    ],
    [
      'invalid field JSON',
      ['--project', 'ABC', '--type', 'T', '--summary', 's', '--field-json', 'a={'],
      'not valid JSON',
    ],
    [
      'an empty summary',
      ['--project', 'ABC', '--type', 'T', '--summary', ' '],
      '--summary must not be empty',
    ],
  ])('fails before any request on %s', async (_name, args, message) => {
    const run = await jira(['issue', 'create', ...args], { cwd: directory });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.fetchCalls).toHaveLength(0);
  });
});

describe('issue edit', () => {
  const noContent = () => new Response(null, { status: 204 });

  it('sends only the fields that were given', async () => {
    const fetch = fakeJira({ 'PUT /rest/api/3/issue/ABC-1': noContent });
    const run = await jira(['issue', 'edit', 'abc-1', '--summary', 'New', '--due', '2027-01-31'], {
      fetch,
    });
    expect(run.code).toBe(0);
    expect(body(fetch.calls[0])).toEqual({ fields: { summary: 'New', duedate: '2027-01-31' } });
    expect(run.stdout).toBe(`Updated ABC-1: summary, duedate\n${SITE}/browse/ABC-1\n`);
  });

  it('clears the due date and changes labels incrementally', async () => {
    const fetch = fakeJira({ 'PUT /rest/api/3/issue/ABC-1': noContent });
    await jira(
      ['issue', 'edit', 'ABC-1', '--clear-due', '--add-label', 'x', '--remove-label', 'y'],
      { fetch },
    );
    expect(body(fetch.calls[0])).toEqual({
      fields: { duedate: null },
      update: { labels: [{ add: 'x' }, { remove: 'y' }] },
    });
  });

  it.each([
    ['nothing to change', ['ABC-1'], 'Nothing to change'],
    ['--due with --clear-due', ['ABC-1', '--due', '2027-01-01', '--clear-due'], 'not both'],
    [
      '--label with --add-label',
      ['ABC-1', '--label', 'a', '--add-label', 'b'],
      'replace the labels',
    ],
    ['a bad key', ['ABC', '--summary', 'x'], 'not an issue key'],
  ])('fails before any request on %s', async (_name, args, message) => {
    const run = await jira(['issue', 'edit', ...args]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.fetchCalls).toHaveLength(0);
  });

  it('turns a 403 into an exit code 4 with next steps', async () => {
    const run = await jira(['issue', 'edit', 'ABC-1', '--summary', 'x'], {
      fetch: fakeJira({
        'PUT /rest/api/3/issue/ABC-1': new Response('{}', {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      }),
    });
    expect(run.code).toBe(4);
    expect(run.stderr).toContain('issue ABC-1');
  });
});
