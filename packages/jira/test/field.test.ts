import { describe, expect, it } from 'vitest';
import { fakeJira, jira } from './helpers.js';

const FIELDS = [
  { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string' } },
  { id: 'customfield_20001', name: 'Story Points', custom: true, schema: { type: 'number' } },
  { id: 'customfield_20002', name: 'Sprint', custom: true },
];

describe('field list', () => {
  it('lists fields sorted by name', async () => {
    const run = await jira(['field', 'list'], {
      fetch: fakeJira({ 'GET /rest/api/3/field': FIELDS }),
    });
    expect(run.stdout).toBe(
      [
        'customfield_20002  -       Sprint',
        'customfield_20001  number  Story Points',
        'summary            string  Summary',
        '',
      ].join('\n'),
    );
  });

  it('filters by text and by custom', async () => {
    const fetch = fakeJira({ 'GET /rest/api/3/field': FIELDS });
    const search = await jira(['field', 'list', '--search', 'POINT', '--json'], { fetch });
    expect(search.json()).toMatchObject({ count: 1 });
    const custom = await jira(['field', 'list', '--custom', '--json'], { fetch });
    expect(custom.json()).toMatchObject({ count: 2 });
    const none = await jira(['field', 'list', '--search', 'zzz'], { fetch });
    expect(none.stdout).toBe('No matching fields.\n');
  });
});
