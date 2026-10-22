import { describe, expect, it } from 'vitest';
import { HOST } from './support/fake-forgejo.js';
import { Lab } from './support/lab.js';

const HEAD = 'd'.repeat(40);
const MERGE = 'POST /repos/acme/widgets/pulls/1/merge';

async function open(): Promise<Lab> {
  const lab = new Lab();
  await lab.signInWithToken();
  lab.forgejo.push('feat/export', HEAD);
  lab.forgejo.addPull({ head: 'feat/export', title: 'feat: export' });
  return lab;
}

const merge = ['pr', 'merge', '1', '--repo', 'acme/widgets'];

describe('pr merge', () => {
  it('merges with a merge commit, pinned to the head it checked, and deletes the branch', async () => {
    const lab = await open();
    const run = await lab.run(merge);

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe('Merged #1 into main (cccccccc). Deleted branch feat/export.\n');
    expect(lab.forgejo.bodies.find((b) => b.route === MERGE)?.body).toEqual({
      Do: 'merge',
      MergeTitleField: 'Merge pull request #1 from feat/export',
      MergeMessageField: 'feat: export',
      delete_branch_after_merge: true,
      head_commit_id: HEAD,
    });
    expect(lab.forgejo.branches.has('feat/export')).toBe(false);
  });

  it('reads the pull request again to prove the merge before reporting it', async () => {
    const lab = await open();
    await lab.run(merge);
    const log = lab.forgejo.log;
    const mergeAt = log.indexOf(MERGE);
    expect(log.slice(mergeAt + 1)).toContain('GET /repos/acme/widgets/pulls/1');
  });

  it('prints the full result with --json', async () => {
    const lab = await open();
    const run = await lab.run([...merge, '--json']);
    expect(run.json()).toEqual({
      merged: true,
      repo: 'acme/widgets',
      number: 1,
      method: 'merge',
      mergeCommitSha: 'c'.repeat(40),
      head: 'feat/export',
      base: 'main',
      url: `${HOST}/acme/widgets/pulls/1`,
      branchDeleted: true,
      warnings: [],
    });
  });

  it('keeps the branch with --keep-branch', async () => {
    const lab = await open();
    const run = await lab.run([...merge, '--keep-branch', '--json']);
    expect(lab.forgejo.bodies.find((b) => b.route === MERGE)?.body).toMatchObject({
      delete_branch_after_merge: false,
    });
    expect(lab.forgejo.branches.has('feat/export')).toBe(true);
    expect(run.json()).toMatchObject({ branchDeleted: false, warnings: [] });
  });

  it('warns when the server kept a branch it was asked to delete', async () => {
    const lab = await open();
    lab.forgejo.keepBranchOnMerge = true;
    const run = await lab.run([...merge, '--json']);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('The server kept the branch "feat/export"');
    expect(run.json()).toMatchObject({ branchDeleted: false });
  });

  it('offers no way to squash or rebase', async () => {
    const lab = await open();
    const run = await lab.run([...merge, '--squash']);
    expect(run.code).toBe(2);
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('accepts the number as #1 and a prefix of the head commit', async () => {
    const lab = await open();
    const run = await lab.run([
      'pr',
      'merge',
      '#1',
      '--repo',
      'acme/widgets',
      '--match-head-commit',
      'dddddddd',
    ]);
    expect(run.code, run.stderr).toBe(0);
  });
});

describe('pr merge refuses before sending the merge request', () => {
  async function blocked(lab: Lab, extra: string[], expected: string) {
    const run = await lab.run([...merge, ...extra, '--json']);
    expect(run.code).toBe(6);
    const error = run.errorJson().error;
    expect(error.code).toBe('merge_blocked');
    expect((error.causes as string[]).join('\n')).toContain(expected);
    expect(lab.forgejo.count(MERGE)).toBe(0);
  }

  it('a draft', async () => {
    const lab = await open();
    lab.forgejo.pulls[0]!.title = 'WIP: feat: export';
    await blocked(lab, [], 'is a draft');
  });

  it('a pull request that is already merged or closed', async () => {
    const merged = await open();
    merged.forgejo.pulls[0]!.merged = true;
    merged.forgejo.pulls[0]!.state = 'closed';
    await blocked(merged, [], 'already merged');

    const closed = await open();
    closed.forgejo.pulls[0]!.state = 'closed';
    await blocked(closed, [], 'is closed, not open');
  });

  it('a pull request the server cannot merge', async () => {
    const lab = await open();
    lab.forgejo.pulls[0]!.mergeable = false;
    await blocked(lab, [], 'cannot be merged');
  });

  it('a pull request into another base than expected', async () => {
    const lab = await open();
    await blocked(lab, ['--expect-base', 'release'], 'targets "main", not "release"');
  });

  it('a head that is not the commit that was reviewed', async () => {
    const lab = await open();
    await blocked(lab, ['--match-head-commit', 'abcdef1'], 'changed since you reviewed it');
  });

  it('lists every reason at once', async () => {
    const lab = await open();
    lab.forgejo.pulls[0]!.mergeable = false;
    lab.forgejo.pulls[0]!.title = 'WIP: x';
    const run = await lab.run([...merge, '--expect-base', 'release', '--json']);
    expect((run.errorJson().error.details as { violations: string[] }).violations).toHaveLength(3);
  });
});

describe('pr merge and what the server says', () => {
  it('warns about failed and running CI checks but still merges', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [
      { id: 1, context: 'ci/test', status: 'failure', target_url: 'https://ci.example.test/1' },
      { id: 2, context: 'ci/lint', status: 'pending' },
      { id: 3, context: 'ci/build', status: 'success' },
    ]);
    const run = await lab.run([...merge, '--json']);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('warning: CI check failed: ci/test (https://ci.example.test/1)');
    expect(run.stderr).toContain('warning: CI check still running: ci/lint');
    expect((run.json() as { warnings: string[] }).warnings).toHaveLength(2);
  });

  it('lets a rerun replace an earlier failure of the same check', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [
      { id: 1, context: 'ci/test', status: 'failure' },
      { id: 5, context: 'ci/test', status: 'success' },
    ]);
    const run = await lab.run(merge);
    expect(run.stderr).not.toContain('CI check failed');
  });

  it('turns a rule the server enforces into advice', async () => {
    const lab = await open();
    lab.forgejo.failMerge = 405;
    const run = await lab.run([...merge, '--json']);
    expect(run.code).toBe(6);
    const error = run.errorJson().error;
    expect(error.code).toBe('merge_rejected');
    expect(error.message).toContain('Not all required approvals were granted');
    expect(JSON.stringify(error.next)).toContain('sdlc-forgejo pr view 1');
  });

  it('is refused by the server when the head moved after it was read', async () => {
    const lab = await open();
    const original = lab.forgejo.handle;
    let moved = false;
    lab.forgejo.handle = (request) => {
      if (request.method === 'POST' && request.url.pathname.endsWith('/merge') && !moved) {
        moved = true;
        lab.forgejo.pulls[0]!.head.sha = 'e'.repeat(40);
      }
      return original(request);
    };
    const run = await lab.run(merge);
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('head commit does not match');
    expect(lab.forgejo.pulls[0]?.merged).toBe(false);
  });

  it('does not report a merge the server did not perform', async () => {
    const lab = await open();
    const original = lab.forgejo.handle;
    lab.forgejo.handle = (request) => {
      if (request.url.pathname.endsWith('/merge')) return new Response(null, { status: 200 });
      return original(request);
    };
    const run = await lab.run(merge);
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('it is not merged');
  });

  it('a pull request that does not exist', async () => {
    const lab = await open();
    const run = await lab.run(['pr', 'merge', '99', '--repo', 'acme/widgets']);
    expect(run.code).toBe(5);
    expect(lab.forgejo.count('POST /repos/acme/widgets/pulls/99/merge')).toBe(0);
  });
});
