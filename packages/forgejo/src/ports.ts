/**
 * What a checkout on disk can answer. Everything the tool learns about the
 * local repository goes through this port, so commands are tested with a fake
 * and the real implementation (`createNodeGit`) is the only code that spawns
 * `git`.
 *
 * Queries resolve `undefined` when the directory is not a repository or the
 * thing asked about does not exist; mutations reject with a `CliError`.
 */
export interface Git {
  /** The URL configured for `remote`. */
  remoteUrl(cwd: string, remote: string): Promise<string | undefined>;
  /** The checked-out branch; `undefined` on a detached HEAD. */
  currentBranch(cwd: string): Promise<string | undefined>;
  /** The commit a full ref name (`refs/heads/x`, `refs/remotes/origin/x`) points to. */
  resolveRef(cwd: string, ref: string): Promise<string | undefined>;
  /** One line per uncommitted change (`git status --porcelain`). */
  uncommittedChanges(cwd: string): Promise<readonly string[] | undefined>;
  /** Updates the remote-tracking branches of `remote` and drops the ones deleted there. */
  fetchPrune(cwd: string, remote: string): Promise<void>;
  /** Whether the commit `ancestor` is reachable from `descendant`; both are full ref names. */
  isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean>;
  /** Removes a linked worktree; refuses while it has uncommitted changes. */
  removeWorktree(cwd: string, path: string): Promise<void>;
  /** Deletes a local branch regardless of its merge state; the caller has proven it merged. */
  deleteBranch(cwd: string, branch: string): Promise<void>;
}

/** The parts of the outside world that `Runtime` does not carry. */
export interface Ports {
  readonly git: Git;
  /** Reads a UTF-8 text file; a relative path is relative to the working directory. */
  readTextFile(path: string): Promise<string>;
}
