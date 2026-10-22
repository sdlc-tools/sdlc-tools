/** The server's pull request, reduced to the fields the commands use and named consistently. */
export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed';
  readonly merged: boolean;
  /** Forgejo marks a draft with a title prefix such as `WIP:`. */
  readonly draft: boolean;
  /** `null` while the server has not decided yet. */
  readonly mergeable: boolean | null;
  readonly head: { readonly ref: string; readonly sha: string; readonly repo: string | null };
  readonly base: { readonly ref: string; readonly sha: string };
  readonly author: string | null;
  readonly url: string;
  readonly labels: readonly string[];
  /** Logins of the reviewers whose review is requested. */
  readonly reviewers: readonly string[];
  readonly mergeCommitSha: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export type ReviewState =
  'APPROVED' | 'REQUEST_CHANGES' | 'COMMENT' | 'PENDING' | 'REQUEST_REVIEW' | (string & {});

export interface Review {
  /** Ascending in the order the reviews were written. */
  readonly id: number;
  readonly reviewer: string | null;
  readonly state: ReviewState;
  /** The commit the review was written on; `null` when the server does not say. */
  readonly commit: string | null;
  /** The commit changed after the review was written. */
  readonly stale: boolean;
  readonly dismissed: boolean;
}

/** One result a CI system reported for a commit. A rerun adds a record; it does not replace one. */
export interface StatusRecord {
  readonly id: number;
  readonly context: string;
  /** `success`, `pending`, `failure`, `error` or `warning`. */
  readonly state: string;
  readonly url: string | null;
}

/** The ways Forgejo can merge a pull request (`manually-merged` only records a merge and is not offered). */
export const MERGE_METHODS = [
  'merge',
  'rebase',
  'rebase-merge',
  'squash',
  'fast-forward-only',
] as const;

export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface CiCheck {
  readonly context: string;
  readonly url: string | null;
}

/** The latest state of every status check reported for a commit. */
export interface CiSummary {
  readonly checked: number;
  readonly passed: number;
  readonly failed: readonly CiCheck[];
  readonly pending: readonly CiCheck[];
}

export interface Branch {
  readonly name: string;
  readonly sha: string;
  readonly protected: boolean;
}

export interface Repository {
  readonly fullName: string;
  readonly defaultBranch: string;
}

export interface Label {
  readonly id: number;
  readonly name: string;
}
