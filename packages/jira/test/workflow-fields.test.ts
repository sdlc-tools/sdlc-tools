import { MemoryFiles } from '@sdlc-tools/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RecordedRequest } from '@sdlc-tools/core/testing';
import { ISSUE, SITE, body, fakeJira, jira } from './helpers.js';

const noContent = () => new Response(null, { status: 204 });
const created = () => new Response(JSON.stringify({ id: '1', key: 'ABC-9' }), { status: 201 });

const root = '/work';
let files: MemoryFiles;
beforeEach(() => {
  files = new MemoryFiles().directory(`${root}/.git`);
});

const configure = (jiraSection: unknown) =>
  files.set(`${root}/.sdlc-tools.json`, JSON.stringify({ jira: jiraSection }));
const run = (argv: readonly string[], fetch: ReturnType<typeof fakeJira>) =>
  jira(argv, { fetch, cwd: root, homedir: '/work/home', files });

const ALIASES = {
  start: { id: 'customfield_30001', type: 'datetime' },
  begins: { id: 'customfield_30002', type: 'date' },
  points: 'customfield_30003',
};

describe('field aliases, writing', () => {
  const create = [
    'issue',
    'create',
    '--project',
    'ABC',
    '--type',
    'Task',
    '--summary',
    's',
  ] as const;

  it('writes typed aliases without asking the site for its field list', async () => {
    configure({ fields: ALIASES });
    const fetch = fakeJira({ 'POST /rest/api/3/issue': created });
    const result = await run(
      [...create, '--field', 'start=2026-03-02T09:00+09:00', '--field', 'BEGINS=2026-03-02'],
      fetch,
    );
    expect(result.code).toBe(0);
    expect(fetch.calls).toHaveLength(1);
    expect(body(fetch.calls[0]).fields).toMatchObject({
      customfield_30001: '2026-03-02T09:00:00.000+0900',
      customfield_30002: '2026-03-02',
    });
  });

  it.each([
    ['a date that does not exist', 'begins=2026-02-30', 'begins must be a date written YYYY-MM-DD'],
    ['a date in another layout', 'begins=02/03/2026', 'begins must be a date written YYYY-MM-DD'],
    [
      'a datetime without an offset',
      'start=2026-03-02T09:00',
      'start must be an ISO 8601 time with an offset',
    ],
    [
      'a datetime with an impossible hour',
      'start=2026-03-02T25:00:00Z',
      'start must be an ISO 8601 time',
    ],
  ])('fails before any request with %s', async (_name, entry, message) => {
    configure({ fields: ALIASES });
    const fetch = fakeJira({});
    const result = await run([...create, '--field', entry], fetch);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
    expect(fetch.calls).toHaveLength(0);
  });

  it('validates a date field found through the site as well', async () => {
    configure({ fields: { due2: 'customfield_30009' } });
    const fetch = fakeJira({
      'GET /rest/api/3/field': [
        { id: 'customfield_30009', name: 'Review by', custom: true, schema: { type: 'date' } },
      ],
    });
    const result = await run([...create, '--field', 'due2=tomorrow'], fetch);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('due2 must be a date written YYYY-MM-DD');
    expect(fetch.calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('refuses an unknown name before any write', async () => {
    configure({ fields: ALIASES });
    const fetch = fakeJira({ 'GET /rest/api/3/field': [] });
    const result = await run([...create, '--field', 'nothing=1'], fetch);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain('no field named "nothing"');
    expect(fetch.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it.each([
    [
      'a type outside the known ones',
      { x: { id: 'customfield_1', type: 'color' } },
      'one of string',
    ],
    ['an alias without an id', { x: { type: 'date' } }, 'a field id string'],
    ['an alias of the wrong kind', { x: 5 }, 'a field id string or an object'],
  ])('rejects %s in the configuration', async (_name, fields, message) => {
    configure({ fields });
    const fetch = fakeJira({});
    const result = await run([...create, '--field', 'x=1'], fetch);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
    expect(fetch.calls).toHaveLength(0);
  });

  it('writes typed aliases on edit as well', async () => {
    configure({ fields: ALIASES });
    const fetch = fakeJira({ 'PUT /rest/api/3/issue/ABC-1': noContent });
    const result = await run(
      ['issue', 'edit', 'ABC-1', '--field', 'start=2026-03-02T09:00:00Z'],
      fetch,
    );
    expect(result.code).toBe(0);
    expect(body(fetch.calls[0])).toEqual({
      fields: { customfield_30001: '2026-03-02T09:00:00.000+0000' },
    });
  });
});

describe('field aliases, reading', () => {
  const issue = {
    ...ISSUE,
    fields: {
      ...ISSUE.fields,
      customfield_30001: '2026-03-02T09:00:00.000+0900',
      customfield_30003: 8,
    },
  };

  it('shows the configured fields that have a value and returns all of them in --json', async () => {
    configure({ fields: ALIASES });
    const fetch = fakeJira({ 'GET /rest/api/3/issue/ABC-1': issue });
    const text = await run(['issue', 'view', 'ABC-1'], fetch);
    expect(text.stdout).toContain('Fields:\n  start: 2026-03-02T09:00:00.000+0900\n  points: 8\n');
    expect(text.stdout).not.toContain('begins:');

    const json = await run(['issue', 'view', 'ABC-1', '--json'], fetch);
    expect(json.json()).toMatchObject({
      aliases: { start: '2026-03-02T09:00:00.000+0900', begins: null, points: 8 },
    });
  });

  it('accepts aliases in list --fields', async () => {
    configure({ fields: ALIASES });
    const fetch = fakeJira({ 'GET /rest/api/3/search/jql': { issues: [] } });
    await run(['issue', 'list', '--jql', 'project = ABC', '--fields', 'points,labels'], fetch);
    expect(fetch.calls[0]?.url.searchParams.get('fields')).toContain('customfield_30003,labels');
  });

  it('renders a user, an option and rich text value readably', async () => {
    configure({
      fields: { owner: 'customfield_1', size: 'customfield_2', notes: 'customfield_3' },
    });
    const fetch = fakeJira({
      'GET /rest/api/3/issue/ABC-1': {
        ...ISSUE,
        fields: {
          ...ISSUE.fields,
          customfield_1: { displayName: 'Ada Lovelace', accountId: 'x' },
          customfield_2: { value: 'Large' },
          customfield_3: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see notes' }] }],
          },
        },
      },
    });
    const result = await run(['issue', 'view', 'ABC-1'], fetch);
    expect(result.stdout).toContain('  owner: Ada Lovelace\n  size: Large\n  notes: see notes\n');
  });
});

describe('issue transition --to', () => {
  const ORDER = ['To Do', 'In Progress', 'In Review', 'Done'];
  const status = (name: string) => ({ ...ISSUE, fields: { status: { name } } });
  const step = (id: string, to: string) => ({ id, name: `Go ${to}`, to: { name: to } });

  /** A workflow where each status offers the next one and Done is also reachable from review. */
  function workflow(start: string, graph: Record<string, ReturnType<typeof step>[]>) {
    let current = start;
    return fakeJira({
      'GET /rest/api/3/issue/ABC-1': () => status(current),
      'GET /rest/api/3/issue/ABC-1/transitions': () => ({ transitions: graph[current] ?? [] }),
      'POST /rest/api/3/issue/ABC-1/transitions': (request: RecordedRequest) => {
        const id = (body(request).transition as { id: string }).id;
        const next = Object.values(graph)
          .flat()
          .find((candidate) => candidate.id === id);
        current = next?.to.name ?? current;
        return noContent();
      },
    });
  }

  const GRAPH = {
    'To Do': [step('11', 'In Progress')],
    'In Progress': [step('21', 'In Review'), step('22', 'To Do')],
    'In Review': [step('31', 'Done'), step('32', 'In Progress')],
    Done: [],
  };

  it('makes every transition the configured order needs, in order', async () => {
    configure({ workflow: ORDER });
    const fetch = workflow('To Do', GRAPH);
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'done', '--json'], fetch);
    expect(result.code).toBe(0);
    const sent = fetch.calls
      .filter((call) => call.method === 'POST')
      .map((call) => (body(call).transition as { id: string }).id);
    expect(sent).toEqual(['11', '21', '31']);
    expect(result.json()).toMatchObject({
      key: 'ABC-1',
      from: 'To Do',
      status: 'Done',
      steps: [
        { transition: { id: '11' }, status: 'In Progress' },
        { transition: { id: '21' }, status: 'In Review' },
        { transition: { id: '31' }, status: 'Done' },
      ],
    });
  });

  it('prints the path it took', async () => {
    configure({ workflow: ORDER });
    const result = await run(
      ['issue', 'transition', 'ABC-1', '--to', 'In Review'],
      workflow('To Do', GRAPH),
    );
    expect(result.stdout).toBe('ABC-1: To Do -> In Progress -> In Review\n');
  });

  it('does not skip a stage the workflow offers on the way', async () => {
    configure({ workflow: ORDER });
    const graph = { ...GRAPH, 'In Progress': [step('21', 'In Review'), step('23', 'Done')] };
    const fetch = workflow('In Progress', graph);
    await run(['issue', 'transition', 'ABC-1', '--to', 'Done'], fetch);
    const sent = fetch.calls
      .filter((call) => call.method === 'POST')
      .map((call) => (body(call).transition as { id: string }).id);
    expect(sent).toEqual(['21', '31']);
  });

  it('takes a stage out of order when the workflow has no transition to the next one', async () => {
    configure({ workflow: ORDER });
    const graph = { ...GRAPH, 'In Progress': [step('23', 'Done')] };
    const fetch = workflow('In Progress', graph);
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'Done'], fetch);
    expect(result.stdout).toBe('ABC-1: In Progress -> Done\n');
  });

  it('sends the fields and the comment with the last transition only', async () => {
    configure({ workflow: ORDER });
    const fetch = workflow('In Progress', GRAPH);
    await run(
      [
        'issue',
        'transition',
        'ABC-1',
        '--to',
        'Done',
        '--comment',
        'shipped',
        '--field-json',
        'customfield_2={"name":"Done"}',
        '--field-json',
        'customfield_1=1',
      ],
      fetch,
    );
    const posts = fetch.calls.filter((call) => call.method === 'POST').map((call) => body(call));
    expect(posts[0]).toEqual({ transition: { id: '21' } });
    expect(posts[1]).toMatchObject({ transition: { id: '31' }, fields: { customfield_1: 1 } });
    expect(JSON.stringify(posts[1]?.update)).toContain('shipped');
  });

  it('does nothing when the issue is already there', async () => {
    configure({ workflow: ORDER });
    const fetch = workflow('Done', GRAPH);
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'done'], fetch);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('ABC-1 is already in Done.\n');
    expect(fetch.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('takes a direct transition without any configured order', async () => {
    const fetch = workflow('To Do', GRAPH);
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'In Progress'], fetch);
    expect(result.stdout).toBe('ABC-1: To Do -> In Progress\n');
  });

  it('stops with the available path when the target is out of reach and no order is configured', async () => {
    const fetch = workflow('To Do', GRAPH);
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'Done'], fetch);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain('cannot reach "Done" from "To Do"');
    expect(result.stderr).toContain('11  Go In Progress  -> In Progress');
    expect(result.stderr).toContain('jira.workflow');
    expect(fetch.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('reports how far it got when the path breaks half-way', async () => {
    configure({ workflow: ORDER });
    const fetch = workflow('To Do', { ...GRAPH, 'In Progress': [step('22', 'To Do')] });
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'Done'], fetch);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain('cannot reach "Done" from "In Progress"');
    expect(result.stderr).toContain('Reached so far: In Progress');
    expect(result.stderr).toContain('22  Go To Do  -> To Do');
  });

  it('refuses to go backwards through the order', async () => {
    configure({ workflow: ORDER });
    const fetch = workflow('In Review', GRAPH);
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'To Do'], fetch);
    expect(result.code).toBe(5);
    expect(fetch.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('fails locally when both a target and --to are given, or neither', async () => {
    const both = await run(['issue', 'transition', 'ABC-1', 'Done', '--to', 'Done'], fakeJira({}));
    expect(both.code).toBe(2);
    expect(both.stderr).toContain('not both');
    expect(both.fetchCalls).toHaveLength(0);
    const neither = await run(['issue', 'transition', 'ABC-1'], fakeJira({}));
    expect(neither.code).toBe(2);
    expect(neither.fetchCalls).toHaveLength(0);
  });

  it('does not start when a field value is invalid', async () => {
    configure({ workflow: ORDER, fields: ALIASES });
    const fetch = workflow('To Do', GRAPH);
    const result = await run(
      ['issue', 'transition', 'ABC-1', '--to', 'Done', '--field', 'start=nope'],
      fetch,
    );
    expect(result.code).toBe(2);
    expect(fetch.calls).toHaveLength(0);
  });

  it.each([
    ['a single status', ['Done'], 'a list of at least two status names'],
    ['repeated statuses', ['Done', 'done'], 'without repeated status names'],
    ['a non-list', 'To Do, Done', 'a list of at least two status names'],
  ])('rejects %s in jira.workflow', async (_name, value, message) => {
    configure({ workflow: value });
    const result = await run(['issue', 'transition', 'ABC-1', '--to', 'Done'], fakeJira({}));
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.fetchCalls).toHaveLength(0);
  });
});

describe('issue link', () => {
  const TYPES = {
    issueLinkTypes: [
      { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
      { id: '2', name: 'Relates', inward: 'relates to', outward: 'relates to' },
    ],
  };
  const routes = () => ({
    'GET /rest/api/3/issueLinkType': TYPES,
    'POST /rest/api/3/issueLink': created,
  });

  it('lists the link types', async () => {
    const result = await jira(['issue', 'link', 'types'], { fetch: fakeJira(routes()) });
    expect(result.stdout).toBe(
      ['Blocks   blocks      is blocked by', 'Relates  relates to  relates to', ''].join('\n'),
    );
  });

  it('links by type name, the first issue carrying the outward phrase', async () => {
    const fetch = fakeJira(routes());
    const result = await jira(['issue', 'link', 'add', 'abc-1', 'blocks', 'ABC-2'], { fetch });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('ABC-1 blocks ABC-2\n');
    expect(body(fetch.calls[1])).toEqual({
      type: { name: 'Blocks' },
      outwardIssue: { key: 'ABC-1' },
      inwardIssue: { key: 'ABC-2' },
    });
  });

  it('reverses the direction with --direction inward', async () => {
    const fetch = fakeJira(routes());
    const result = await jira(
      ['issue', 'link', 'add', 'ABC-1', 'Blocks', 'ABC-2', '--direction', 'inward', '--json'],
      { fetch },
    );
    expect(body(fetch.calls[1])).toMatchObject({
      outwardIssue: { key: 'ABC-2' },
      inwardIssue: { key: 'ABC-1' },
    });
    expect(result.json()).toMatchObject({
      type: 'Blocks',
      direction: 'inward',
      outward: 'ABC-2',
      inward: 'ABC-1',
    });
  });

  it('takes the direction from a phrase', async () => {
    const fetch = fakeJira(routes());
    const result = await jira(['issue', 'link', 'add', 'ABC-1', 'is blocked by', 'ABC-2'], {
      fetch,
    });
    expect(result.stdout).toBe('ABC-1 is blocked by ABC-2\n');
    expect(body(fetch.calls[1])).toMatchObject({
      outwardIssue: { key: 'ABC-2' },
      inwardIssue: { key: 'ABC-1' },
    });
  });

  it('accepts a symmetric phrase and adds a comment', async () => {
    const fetch = fakeJira(routes());
    const result = await jira(
      ['issue', 'link', 'add', 'ABC-1', 'relates to', 'ABC-2', '--comment', 'see **both**'],
      { fetch },
    );
    expect(result.code).toBe(0);
    expect(body(fetch.calls[1])).toMatchObject({ type: { name: 'Relates' } });
    expect(JSON.stringify(body(fetch.calls[1]).comment)).toContain('"strong"');
  });

  it('lists the types when the name is unknown, before any write', async () => {
    const fetch = fakeJira(routes());
    const result = await jira(['issue', 'link', 'add', 'ABC-1', 'Duplicates', 'ABC-2'], { fetch });
    expect(result.code).toBe(5);
    expect(result.stderr).toContain('no issue link type "Duplicates"');
    expect(result.stderr).toContain('Blocks');
    expect(fetch.calls).toHaveLength(1);
  });

  it.each([
    ['linking an issue to itself', ['ABC-1', 'Relates', 'abc-1'], 'cannot be linked to itself'],
    ['a malformed key', ['ABC-1', 'Relates', 'nope'], 'is not an issue key'],
    [
      'a bad direction',
      ['ABC-1', 'Relates', 'ABC-2', '--direction', 'sideways'],
      'outward or inward',
    ],
    ['a missing target', ['ABC-1', 'Relates'], 'Missing required argument <target>'],
  ])('fails before any request for %s', async (_name, args, message) => {
    const result = await jira(['issue', 'link', 'add', ...args]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.fetchCalls).toHaveLength(0);
  });

  it('refuses --direction together with a phrase, which already fixes it', async () => {
    const result = await jira(
      ['issue', 'link', 'add', 'ABC-1', 'is blocked by', 'ABC-2', '--direction', 'inward'],
      { fetch: fakeJira(routes()) },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--direction applies to a link type name');
  });

  it('shows the links of an issue in view, worded from its side', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/issue/ABC-1': {
        ...ISSUE,
        fields: {
          ...ISSUE.fields,
          issuelinks: [
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              outwardIssue: { key: 'ABC-2', fields: { summary: 'Fix the build' } },
            },
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              inwardIssue: { key: 'ABC-3', fields: { summary: 'Cut the release' } },
            },
          ],
        },
      },
    });
    const result = await jira(['issue', 'view', 'ABC-1'], { fetch });
    expect(result.stdout).toContain(
      `Links:\n  blocks ABC-2  Fix the build\n  is blocked by ABC-3  Cut the release\n${SITE}/browse/ABC-1`,
    );
  });
});
