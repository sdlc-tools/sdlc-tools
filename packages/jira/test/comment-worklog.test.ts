import { MemoryFiles } from '@sdlc-tools/core/testing';
import { describe, expect, it } from 'vitest';
import { SITE, body, fakeJira, jira } from './helpers.js';

const created = (id: string) =>
  new Response(JSON.stringify({ id }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });

describe('issue comment add', () => {
  it('posts the Markdown as an ADF body', async () => {
    const fetch = fakeJira({ 'POST /rest/api/3/issue/ABC-1/comment': () => created('77') });
    const run = await jira(['issue', 'comment', 'add', 'ABC-1', 'Fixed in **build 42**'], {
      fetch,
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('Added comment 77 to ABC-1.\n');
    const sent = body(fetch.calls[0]).body as { type: string; version: number; content: unknown[] };
    expect(sent.type).toBe('doc');
    expect(JSON.stringify(sent)).toContain('"marks":[{"type":"strong"}]');
  });

  it('reads the comment from a file', async () => {
    const files = new MemoryFiles().set('/work/note.md', '- one\n- two');
    const fetch = fakeJira({ 'POST /rest/api/3/issue/ABC-1/comment': () => created('78') });
    const run = await jira(
      ['issue', 'comment', 'add', 'ABC-1', '--body-file', 'note.md', '--json'],
      {
        fetch,
        files,
      },
    );
    expect(run.json()).toEqual({ key: 'ABC-1', id: '78', url: `${SITE}/browse/ABC-1` });
    expect(JSON.stringify(body(fetch.calls[0]))).toContain('bulletList');
  });

  it.each([
    ['no text', ['ABC-1'], 'Missing the comment text'],
    ['blank text', ['ABC-1', '   '], 'comment is empty'],
    ['both sources', ['ABC-1', 'x', '--body-file', 'y'], 'not both'],
    ['a bad key', ['1', 'x'], 'not an issue key'],
  ])('fails before any request with %s', async (_name, args, message) => {
    const run = await jira(['issue', 'comment', 'add', ...args]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.fetchCalls).toHaveLength(0);
  });
});

describe('issue comment list', () => {
  const doc = (text: string) => ({
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  it('prints the latest comments oldest first', async () => {
    const fetch = fakeJira({
      'GET /rest/api/3/issue/ABC-1/comment': {
        total: 3,
        comments: [
          { id: '3', author: { displayName: 'Ada' }, created: 'c3', body: doc('newest') },
          { id: '2', author: { displayName: 'Bob' }, created: 'c2', body: doc('older') },
        ],
      },
    });
    const run = await jira(['issue', 'comment', 'list', 'ABC-1', '--limit', '2'], { fetch });
    expect(fetch.calls[0]?.url.searchParams.get('orderBy')).toBe('-created');
    expect(fetch.calls[0]?.url.searchParams.get('maxResults')).toBe('2');
    expect(run.stdout).toBe('Bob  c2\n  older\n\nAda  c3\n  newest\n\n2 of 3 comments\n');
  });

  it('says so when there are none, and rejects a bad limit locally', async () => {
    const none = await jira(['issue', 'comment', 'list', 'ABC-1'], {
      fetch: fakeJira({ 'GET /rest/api/3/issue/ABC-1/comment': { comments: [] } }),
    });
    expect(none.stdout).toBe('ABC-1 has no comments.\n');
    const bad = await jira(['issue', 'comment', 'list', 'ABC-1', '--limit', '500']);
    expect(bad.code).toBe(2);
    expect(bad.fetchCalls).toHaveLength(0);
  });
});

describe('issue worklog add', () => {
  it('logs time with a normalised start and a note', async () => {
    const fetch = fakeJira({ 'POST /rest/api/3/issue/ABC-1/worklog': () => created('900') });
    const run = await jira(
      [
        'issue',
        'worklog',
        'add',
        'ABC-1',
        '1D  2h',
        '--started',
        '2026-03-02T09:00+09:00',
        '--comment',
        'Reviewed `db`',
      ],
      { fetch },
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('Logged 1d 2h on ABC-1 (worklog 900).\n');
    const sent = body(fetch.calls[0]);
    expect(sent.timeSpent).toBe('1d 2h');
    expect(sent.started).toBe('2026-03-02T09:00:00.000+0900');
    expect(JSON.stringify(sent.comment)).toContain('"code"');
  });

  it.each([
    ['a positive offset', '2026-03-02T09:00:00+09:00', '2026-03-02T09:00:00.000+0900'],
    ['a negative offset', '2026-03-02T09:00:00-03:30', '2026-03-02T09:00:00.000-0330'],
    ['an offset without a colon', '2026-03-02T09:00:00+0530', '2026-03-02T09:00:00.000+0530'],
    ['UTC written as Z', '2026-03-02T00:15Z', '2026-03-02T00:15:00.000+0000'],
    ['fractional seconds', '2026-03-02T09:00:00.5+09:00', '2026-03-02T09:00:00.500+0900'],
  ])(
    'sends the start with %s unchanged in wall-clock time and offset',
    async (_name, given, sent) => {
      const fetch = fakeJira({ 'POST /rest/api/3/issue/ABC-1/worklog': () => created('902') });
      const run = await jira(
        ['issue', 'worklog', 'add', 'ABC-1', '1h', '--started', given, '--json'],
        { fetch },
      );
      expect(run.code).toBe(0);
      expect(body(fetch.calls[0]).started).toBe(sent);
      expect(run.json()).toMatchObject({ started: sent });
    },
  );

  it('leaves the start to the server when omitted', async () => {
    const fetch = fakeJira({ 'POST /rest/api/3/issue/ABC-1/worklog': () => created('901') });
    const run = await jira(['issue', 'worklog', 'add', 'ABC-1', '30m', '--json'], { fetch });
    expect(body(fetch.calls[0])).toEqual({ timeSpent: '30m' });
    expect(run.json()).toMatchObject({ id: '901', timeSpent: '30m', started: null });
  });

  it.each([
    ['a missing time', ['ABC-1'], 'Missing required argument <time>'],
    ['a malformed time', ['ABC-1', 'soon'], 'not a duration'],
    [
      'a start without an offset',
      ['ABC-1', '1h', '--started', '2026-03-02T09:00:00'],
      'ISO 8601 time with an offset',
    ],
    [
      'an impossible start',
      ['ABC-1', '1h', '--started', '2026-02-30T09:00:00Z'],
      'ISO 8601 time with an offset',
    ],
  ])('fails before any request with %s', async (_name, args, message) => {
    const run = await jira(['issue', 'worklog', 'add', ...args]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(message);
    expect(run.fetchCalls).toHaveLength(0);
  });
});

describe('issue worklog list', () => {
  it('tabulates the entries and totals the time', async () => {
    const run = await jira(['issue', 'worklog', 'list', 'ABC-1'], {
      fetch: fakeJira({
        'GET /rest/api/3/issue/ABC-1/worklog': {
          total: 2,
          worklogs: [
            {
              id: '1',
              author: { displayName: 'Ada' },
              timeSpent: '1h',
              timeSpentSeconds: 3600,
              started: '2026-03-02T09:00:00.000+0900',
              comment: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'design' }] }],
              },
            },
            {
              id: '2',
              author: { displayName: 'Bob' },
              timeSpent: '30m',
              timeSpentSeconds: 1800,
              started: '2026-03-03T10:30:00.000+0900',
            },
          ],
        },
      }),
    });
    expect(run.stdout).toBe(
      [
        '2026-03-02 09:00+09:00  1h   Ada  design',
        '2026-03-03 10:30+09:00  30m  Bob',
        '',
        '2 of 2 worklogs, 1.5h logged in these',
        '',
      ].join('\n'),
    );
  });
});
