import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliError } from '@sdlc-tools/core';
import { createNodeGit } from '../src/index.js';

const git = createNodeGit();

let root: string;
let origin: string;
let work: string;

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  }).trim();
}

function commit(cwd: string, file: string, message: string): void {
  writeFileSync(join(cwd, file), message);
  sh(cwd, 'add', file);
  sh(cwd, 'commit', '-q', '-m', message);
}

/** A bare origin and a clone with `main` and a feature branch merged into it by a merge commit. */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sdlc-forgejo-git-'));
  origin = join(root, 'origin.git');
  work = join(root, 'work');
  mkdirSync(origin);
  sh(origin, 'init', '-q', '--bare', '-b', 'main');
  sh(root, 'clone', '-q', origin, work);
  commit(work, 'a.txt', 'first');
  sh(work, 'push', '-q', 'origin', 'main');
  sh(work, 'switch', '-q', '-c', 'feat/done');
  commit(work, 'b.txt', 'feature');
  sh(work, 'push', '-q', 'origin', 'feat/done');
  sh(work, 'switch', '-q', 'main');
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge feat/done', 'feat/done');
  sh(work, 'push', '-q', 'origin', 'main');
  sh(work, 'switch', '-q', '-c', 'feat/open');
  commit(work, 'c.txt', 'unmerged');
  sh(work, 'switch', '-q', 'main');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Real `git` processes are slow work, not in-process logic: budget for a starved machine. */
const REAL_TIMEOUT = 30_000;

describe('queries', { timeout: REAL_TIMEOUT }, () => {
  it('reads the remote, the branch and refs', async () => {
    expect(await git.remoteUrl(work, 'origin')).toBe(origin);
    expect(await git.remoteUrl(work, 'upstream')).toBeUndefined();
    expect(await git.currentBranch(work)).toBe('main');
    expect(await git.resolveRef(work, 'refs/heads/feat/done')).toBe(
      sh(work, 'rev-parse', 'feat/done'),
    );
    expect(await git.resolveRef(work, 'refs/heads/nope')).toBeUndefined();
  });

  it('answers undefined outside a repository, and for a detached HEAD', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'sdlc-forgejo-outside-'));
    try {
      expect(await git.remoteUrl(outside, 'origin')).toBeUndefined();
      expect(await git.currentBranch(outside)).toBeUndefined();
      expect(await git.uncommittedChanges(outside)).toBeUndefined();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    sh(work, 'switch', '-q', '--detach');
    expect(await git.currentBranch(work)).toBeUndefined();
    sh(work, 'switch', '-q', 'main');
  });

  it('lists uncommitted changes', async () => {
    expect(await git.uncommittedChanges(work)).toEqual([]);
    writeFileSync(join(work, 'dirty.txt'), 'x');
    expect(await git.uncommittedChanges(work)).toEqual(['?? dirty.txt']);
    rmSync(join(work, 'dirty.txt'));
  });

  it('tells a merged branch from an unmerged one', async () => {
    expect(await git.isAncestor(work, 'refs/heads/feat/done', 'refs/remotes/origin/main')).toBe(
      true,
    );
    expect(await git.isAncestor(work, 'refs/heads/feat/open', 'refs/remotes/origin/main')).toBe(
      false,
    );
    expect(await git.isAncestor(work, 'refs/remotes/origin/main', 'refs/heads/feat/done')).toBe(
      false,
    );
    expect(await git.isAncestor(work, 'refs/heads/missing', 'refs/remotes/origin/main')).toBe(
      false,
    );
  });
});

describe('mutations', { timeout: REAL_TIMEOUT }, () => {
  it('fetches and prunes remote-tracking branches the server dropped', async () => {
    expect(await git.resolveRef(work, 'refs/remotes/origin/feat/done')).toBeDefined();
    sh(origin, 'branch', '-q', '-D', 'feat/done');
    await git.fetchPrune(work, 'origin');
    expect(await git.resolveRef(work, 'refs/remotes/origin/feat/done')).toBeUndefined();
  });

  it('deletes an unmerged local branch only because the caller said so', async () => {
    await git.deleteBranch(work, 'feat/open');
    expect(await git.resolveRef(work, 'refs/heads/feat/open')).toBeUndefined();
  });

  it('removes a clean linked worktree and refuses one with uncommitted changes', async () => {
    const clean = join(root, 'wt-clean');
    const dirty = join(root, 'wt-dirty');
    sh(work, 'worktree', 'add', '-q', '-b', 'wt-clean', clean);
    sh(work, 'worktree', 'add', '-q', '-b', 'wt-dirty', dirty);
    writeFileSync(join(dirty, 'unsaved.txt'), 'x');

    await git.removeWorktree(work, clean);
    await expect(git.removeWorktree(work, dirty)).rejects.toMatchObject({ code: 'git_failed' });
    expect(sh(work, 'worktree', 'list')).toContain('wt-dirty');
  });

  it('reports git failures as errors with the reason git gave', async () => {
    const error = await git.fetchPrune(work, 'nowhere').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('git_failed');
    expect((error as CliError).message).toContain('git fetch failed');
  });

  it('does not take a branch name for an option', async () => {
    await expect(git.deleteBranch(work, '-D')).rejects.toBeInstanceOf(CliError);
  });
});
