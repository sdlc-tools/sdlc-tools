import type { Git } from '../../src/index.js';

/** A checkout in memory. Mutations are recorded in `calls` so tests can assert what was and was not touched. */
export class FakeGit implements Git {
  remote: string | undefined = 'git@auth.example.test:acme/widgets.git';
  branch: string | undefined = 'feat/export';
  refs = new Map<string, string>();
  /** Pairs `ancestor -> descendant` that git would call reachable. */
  ancestry = new Set<string>();
  changes: string[] | undefined = [];
  readonly calls: string[] = [];

  remoteUrl = (): Promise<string | undefined> => Promise.resolve(this.remote);

  currentBranch = (): Promise<string | undefined> => Promise.resolve(this.branch);

  resolveRef = (_cwd: string, ref: string): Promise<string | undefined> =>
    Promise.resolve(this.refs.get(ref));

  uncommittedChanges = (): Promise<readonly string[] | undefined> => Promise.resolve(this.changes);

  fetchPrune = (_cwd: string, remote: string): Promise<void> => {
    this.calls.push(`fetch ${remote}`);
    return Promise.resolve();
  };

  isAncestor = (_cwd: string, ancestor: string, descendant: string): Promise<boolean> =>
    Promise.resolve(this.ancestry.has(`${ancestor} -> ${descendant}`));

  removeWorktree = (_cwd: string, path: string): Promise<void> => {
    this.calls.push(`remove worktree ${path}`);
    return Promise.resolve();
  };

  deleteBranch = (_cwd: string, branch: string): Promise<void> => {
    this.calls.push(`delete branch ${branch}`);
    this.refs.delete(`refs/heads/${branch}`);
    return Promise.resolve();
  };
}
