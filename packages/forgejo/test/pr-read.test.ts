import { describe, expect, it } from 'vitest';
import { HOST } from './support/fake-forgejo.js';
import { Lab } from './support/lab.js';

async function labWithPulls(): Promise<Lab> {
  const lab = new Lab();
  await lab.signInWithToken();
  lab.forgejo.addPull({ head: 'feat/a', title: 'feat: a' });
  lab.forgejo.addPull({ head: 'feat/b', title: 'fix: b', base: 'release', user: 'bob' });
  lab.forgejo.addPull({ head: 'feat/c', title: 'WIP: c' });
  lab.forgejo.addPull({ head: 'feat/d', title: 'feat: d', state: 'closed', merged: true });
  return lab;
}

const repo = ['--repo', 'acme/widgets'];

describe('pr list', () => {
  it('lists open pull requests, newest first, one per line', async () => {
    const lab = await labWithPulls();
    const run = await lab.run(['pr', 'list', ...repo]);
    expect(run.stdout).toBe(
      [
        '#3  draft  feat/c → main  WIP: c  by alice',
        '#2  open  feat/b → release  fix: b  by bob',
        '#1  open  feat/a → main  feat: a  by alice',
        '',
      ].join('\n'),
    );
  });

  it('filters by state, head and base', async () => {
    const lab = await labWithPulls();
    expect((await lab.run(['pr', 'list', ...repo, '--state', 'closed'])).stdout).toContain(
      '#4  merged',
    );
    expect(
      (await lab.run(['pr', 'list', ...repo, '--state', 'all'])).stdout.trim().split('\n'),
    ).toHaveLength(4);
    expect((await lab.run(['pr', 'list', ...repo, '--head', 'feat/a'])).stdout).toBe(
      '#1  open  feat/a → main  feat: a  by alice\n',
    );
    expect((await lab.run(['pr', 'list', ...repo, '--base', 'release'])).stdout).toContain('#2');
  });

  it('stops at the limit', async () => {
    const lab = await labWithPulls();
    const run = await lab.run(['pr', 'list', ...repo, '--limit', '2', '--json']);
    expect((run.json() as { pulls: unknown[] }).pulls).toHaveLength(2);
  });

  it('follows pages when the server caps the page size below the one asked for', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    lab.forgejo.pageCap = 2;
    for (let i = 0; i < 5; i += 1) lab.forgejo.addPull({ head: `feat/${i}` });
    const run = await lab.run(['pr', 'list', ...repo, '--limit', '100', '--json']);
    expect((run.json() as { pulls: unknown[] }).pulls).toHaveLength(5);
  });

  it('says so when there is nothing to list', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    expect((await lab.run(['pr', 'list', ...repo])).stdout).toBe('No pull requests.\n');
  });
});

describe('pr view', () => {
  it('shows the state, the reviews and the CI results', async () => {
    const lab = await labWithPulls();
    const pull = lab.forgejo.pulls[0]!;
    pull.reviewers = ['carol'];
    lab.forgejo.labels.length = 2;
    pull.labels = [1];
    lab.forgejo.reviews.set(1, [
      { user: 'bob', state: 'REQUEST_CHANGES' },
      { user: 'bob', state: 'APPROVED' },
      { user: 'dave', state: 'APPROVED', dismissed: true },
      { user: 'erin', state: 'COMMENT' },
    ]);
    lab.forgejo.statuses.set(pull.head.sha, [
      { id: 1, context: 'ci/test', status: 'success' },
      { id: 2, context: 'ci/lint', status: 'failure' },
    ]);

    const run = await lab.run(['pr', 'view', '1', ...repo]);

    expect(run.stdout).toBe(
      [
        '#1  open  feat/a → main  feat: a  by alice',
        `${HOST}/acme/widgets/pulls/1`,
        'Mergeable: yes   Draft: no',
        'Labels: bug',
        'Review requested from: carol',
        'Approved by: bob   Changes requested by: none',
        'CI: 1 passed, 1 failed (ci/lint)',
        '',
      ].join('\n'),
    );
  });

  it('prints everything with --json', async () => {
    const lab = await labWithPulls();
    const run = await lab.run(['pr', 'view', '2', ...repo, '--json']);
    const data = run.json() as {
      pull: { number: number; base: { ref: string } };
      reviews: unknown[];
      ci: unknown;
    };
    expect(data.pull).toMatchObject({
      number: 2,
      base: { ref: 'release' },
      author: 'bob',
      draft: false,
    });
    expect(data.reviews).toEqual([]);
    expect(data.ci).toMatchObject({ checked: 0 });
  });

  it('does not fail when the account may not read CI results', async () => {
    const lab = await labWithPulls();
    const original = lab.forgejo.handle;
    lab.forgejo.handle = (request) =>
      request.url.pathname.endsWith('/statuses')
        ? new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } })
        : original(request);
    const run = await lab.run(['pr', 'view', '1', ...repo]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('CI: unavailable');
  });

  it('reports a pull request that does not exist with exit code 5', async () => {
    const lab = await labWithPulls();
    const run = await lab.run(['pr', 'view', '42', ...repo]);
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('could not find pull request #42');
  });

  it('reports a forbidden repository with exit code 4', async () => {
    const lab = await labWithPulls();
    const original = lab.forgejo.handle;
    lab.forgejo.handle = (request) =>
      request.url.pathname.endsWith('/pulls/1')
        ? new Response('{"message":"no access"}', {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        : original(request);
    const run = await lab.run(['pr', 'view', '1', ...repo]);
    expect(run.code).toBe(4);
  });

  it('reports an unreachable server with exit code 7', async () => {
    const lab = await labWithPulls();
    lab.forgejo.handle = () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      });
    };
    const run = await lab.run(['pr', 'view', '1', ...repo]);
    expect(run.code).toBe(7);
    expect(run.stderr).toContain('the connection was refused');
  });
});

describe('pr reviewers and pr labels', () => {
  it('requests and withdraws reviews', async () => {
    const lab = await labWithPulls();
    const added = await lab.run([
      'pr',
      'reviewers',
      '1',
      ...repo,
      '--add',
      'bob',
      '--add',
      'carol',
    ]);
    expect(added.stdout).toBe('#1 review requested from: bob, carol\n');
    const removed = await lab.run(['pr', 'reviewers', '1', ...repo, '--remove', 'bob', '--json']);
    expect(removed.json()).toEqual({ repo: 'acme/widgets', number: 1, reviewers: ['carol'] });
  });

  it('reports a reviewer the server does not know', async () => {
    const lab = await labWithPulls();
    lab.forgejo.unknownUsers.add('ghost');
    const run = await lab.run(['pr', 'reviewers', '1', ...repo, '--add', 'ghost']);
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('user does not exist [name: ghost]');
  });

  it('attaches and removes labels by name', async () => {
    const lab = await labWithPulls();
    const added = await lab.run(['pr', 'labels', '1', ...repo, '--add', 'bug', '--add', 'feature']);
    expect(added.stdout).toBe('#1 labels: bug, feature\n');
    const removed = await lab.run(['pr', 'labels', '1', ...repo, '--remove', 'bug', '--json']);
    expect(removed.json()).toEqual({ repo: 'acme/widgets', number: 1, labels: ['feature'] });
  });

  it('refuses an unknown label before changing anything', async () => {
    const lab = await labWithPulls();
    const run = await lab.run(['pr', 'labels', '1', ...repo, '--add', 'bug', '--add', 'urgent']);
    expect(run.code).toBe(5);
    expect(lab.forgejo.pulls[0]?.labels).toEqual([]);
  });
});
