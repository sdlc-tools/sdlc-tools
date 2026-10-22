import { describe, expect, it } from 'vitest';
import { Lab } from './support/lab.js';

const SHA = 'd'.repeat(40);
const BASE = 'refs/remotes/origin/main';

/** A merged feature branch: on the server, in the checkout, and reachable from origin/main. */
async function merged(): Promise<Lab> {
  const lab = new Lab();
  await lab.signInWithToken();
  lab.forgejo.push('feat/export', SHA);
  lab.git.branch = 'main';
  lab.git.refs.set(BASE, 'a'.repeat(40));
  lab.git.refs.set('refs/heads/feat/export', SHA);
  lab.git.refs.set('refs/remotes/origin/feat/export', SHA);
  lab.git.ancestry.add(`refs/heads/feat/export -> ${BASE}`);
  lab.git.ancestry.add(`refs/remotes/origin/feat/export -> ${BASE}`);
  return lab;
}

const cleanup = ['branch', 'cleanup', 'feat/export', '--repo', 'acme/widgets'];

describe('branch cleanup', () => {
  it('deletes the local branch and the server branch once git proves them merged', async () => {
    const lab = await merged();
    const run = await lab.run(cleanup);

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe('Removed local branch feat/export, server branch feat/export.\n');
    expect(lab.git.calls).toEqual(['fetch origin', 'delete branch feat/export']);
    expect(lab.forgejo.branches.has('feat/export')).toBe(false);
  });

  it('removes a linked worktree first', async () => {
    const lab = await merged();
    const run = await lab.run([...cleanup, '--worktree', '../widgets-export', '--json']);
    expect(lab.git.calls).toEqual([
      'fetch origin',
      'remove worktree ../widgets-export',
      'delete branch feat/export',
    ]);
    expect((run.json() as { removed: string[] }).removed[0]).toBe('worktree ../widgets-export');
  });

  it('handles a branch the server already deleted', async () => {
    const lab = await merged();
    lab.forgejo.branches.delete('feat/export');
    const run = await lab.run(cleanup);
    expect(run.stdout).toBe('Removed local branch feat/export.\n');
    expect(lab.forgejo.count('DELETE /repos/acme/widgets/branches/feat%2Fexport')).toBe(0);
  });

  it('handles a branch that only exists on the server', async () => {
    const lab = await merged();
    lab.git.refs.delete('refs/heads/feat/export');
    const run = await lab.run(cleanup);
    expect(run.stdout).toBe('Removed server branch feat/export.\n');
  });

  it('says so when there is nothing left to remove', async () => {
    const lab = await merged();
    lab.forgejo.branches.delete('feat/export');
    lab.git.refs.delete('refs/heads/feat/export');
    const run = await lab.run(cleanup);
    expect(run.stdout).toBe('Nothing to clean up for feat/export.\n');
  });

  it('uses the base it is given for the proof', async () => {
    const lab = await merged();
    lab.forgejo.push('release', 'e'.repeat(40));
    lab.git.refs.set('refs/remotes/origin/release', 'e'.repeat(40));
    lab.git.ancestry.clear();
    lab.git.ancestry.add('refs/heads/feat/export -> refs/remotes/origin/release');
    lab.git.ancestry.add('refs/remotes/origin/feat/export -> refs/remotes/origin/release');
    const run = await lab.run([...cleanup, '--base', 'release']);
    expect(run.code, run.stderr).toBe(0);
  });
});

describe('branch cleanup refuses and removes nothing', () => {
  async function blocked(lab: Lab, expected: string, argv = cleanup) {
    const run = await lab.run([...argv, '--json']);
    expect(run.code).toBe(6);
    expect(run.errorJson().error.code).toBe('cleanup_blocked');
    expect((run.errorJson().error.causes as string[]).join('\n')).toContain(expected);
    expect(
      lab.git.calls.filter((call) => call.startsWith('delete') || call.startsWith('remove')),
    ).toEqual([]);
    expect(lab.forgejo.count('DELETE /repos/acme/widgets/branches/feat%2Fexport')).toBe(0);
  }

  it('a branch that is not merged locally', async () => {
    const lab = await merged();
    lab.git.ancestry.delete(`refs/heads/feat/export -> ${BASE}`);
    await blocked(lab, 'The local branch "feat/export" is not contained in origin/main');
  });

  it('a server branch that is not merged', async () => {
    const lab = await merged();
    lab.git.ancestry.delete(`refs/remotes/origin/feat/export -> ${BASE}`);
    await blocked(lab, 'origin/feat/export is not contained in origin/main');
  });

  it('a server branch whose remote-tracking branch is missing, since it cannot be checked', async () => {
    const lab = await merged();
    lab.git.refs.delete('refs/remotes/origin/feat/export');
    await blocked(lab, 'was not fetched');
  });

  it('a base that does not exist in the checkout', async () => {
    const lab = await merged();
    lab.git.refs.delete(BASE);
    await blocked(lab, 'origin/main does not exist');
  });

  it('the default branch', async () => {
    const lab = await merged();
    await blocked(lab, 'default branch', ['branch', 'cleanup', 'main', '--repo', 'acme/widgets']);
  });

  it('the base branch', async () => {
    const lab = await merged();
    lab.forgejo.push('release', 'e'.repeat(40));
    await blocked(lab, 'base branch', [
      'branch',
      'cleanup',
      'release',
      '--base',
      'release',
      '--repo',
      'acme/widgets',
    ]);
  });

  it('a branch the server protects', async () => {
    const lab = await merged();
    lab.forgejo.branches.get('feat/export')!.protected = true;
    await blocked(lab, 'The server protects');
  });

  it('the branch that is checked out', async () => {
    const lab = await merged();
    lab.git.branch = 'feat/export';
    await blocked(lab, 'is checked out here');
  });
});
