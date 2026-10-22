import { MemoryFiles } from '@sdlc-tools/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMAIL, SITE, TOKEN, fakeJira, jira } from './helpers.js';

const CREDENTIALS = { SDLC_JIRA_EMAIL: EMAIL, SDLC_JIRA_TOKEN: TOKEN };

const repo = '/work/repo';
const home = '/work/home';

let files: MemoryFiles;
beforeEach(() => {
  files = new MemoryFiles().directory(`${repo}/.git`);
});

const userConfig = (value: unknown) =>
  files.set(`${home}/.config/sdlc-tools/config.json`, JSON.stringify(value));
const projectConfig = (value: unknown) =>
  files.set(`${repo}/.sdlc-tools.json`, JSON.stringify(value));
const run = (
  argv: readonly string[],
  fetch = fakeJira({ 'GET /rest/api/3/myself': { accountId: 'a', displayName: 'Ada' } }),
) => jira(argv, { env: CREDENTIALS, cwd: repo, homedir: home, fetch, files });

describe('configuration', () => {
  it('reads the site from the user file', async () => {
    userConfig({ jira: { site: SITE } });
    const result = await run(['auth', 'status']);
    expect(result.code).toBe(0);
    expect(result.fetchCalls[0]?.url.origin).toBe(SITE);
  });

  it('ignores a site set by the repository, so a checkout cannot redirect credentials', async () => {
    projectConfig({ jira: { site: 'https://attacker.example.test' } });
    const result = await run(['auth', 'status']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Missing Jira site address');
    expect(result.fetchCalls).toHaveLength(0);
  });

  it('lets the repository choose the default project', async () => {
    userConfig({ jira: { site: SITE } });
    projectConfig({ jira: { project: 'REPO' } });
    const fetch = fakeJira({ 'GET /rest/api/3/search/jql': { issues: [] } });
    await run(['issue', 'list', '--status', 'Done'], fetch);
    expect(fetch.calls[0]?.url.searchParams.get('jql')).toContain('project = "REPO"');
  });

  it('prefers the flag, then the environment, over the files', async () => {
    userConfig({ jira: { site: 'https://other.example.test' } });
    const result = await run(['auth', 'status', '--site', SITE]);
    expect(result.fetchCalls[0]?.url.origin).toBe(SITE);
  });

  it('refuses a file that holds a credential, without echoing it', async () => {
    userConfig({ jira: { site: SITE, apiToken: 'super-secret-value' } });
    const result = await run(['auth', 'status']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('must not hold credentials');
    expect(result.stderr).not.toContain('super-secret-value');
    expect(result.fetchCalls).toHaveLength(0);
  });

  it('resolves field aliases, with the project file winning over the user file', async () => {
    userConfig({
      jira: { site: SITE, fields: { points: 'customfield_30001', team: 'customfield_30002' } },
    });
    projectConfig({ jira: { fields: { points: 'customfield_30009' } } });
    const fetch = fakeJira({
      'POST /rest/api/3/issue': { id: '1', key: 'ABC-1' },
    });
    const result = await run(
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
        'points=3',
        '--field-json',
        'team="blue"',
      ],
      fetch,
    );
    expect(result.code).toBe(0);
    const sent = JSON.parse(fetch.calls[0]?.body ?? '{}') as { fields: Record<string, unknown> };
    expect(sent.fields.customfield_30009).toBe(3);
    expect(sent.fields.customfield_30002).toBe('blue');
  });

  it.each([
    ['an alias map that is not an object', { jira: { site: SITE, fields: 'oops' } }],
    ['an alias that is not a string', { jira: { site: SITE, fields: { points: 12 } } }],
  ])('rejects %s before any request', async (_name, config) => {
    userConfig(config);
    const result = await run([
      'issue',
      'create',
      '--project',
      'ABC',
      '--type',
      'Task',
      '--summary',
      's',
      '--field-json',
      'points=3',
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('jira.fields');
    expect(result.fetchCalls).toHaveLength(0);
  });
});
