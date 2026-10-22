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
  readonly reviewer: string | null;
  readonly state: ReviewState;
  /** The commit changed after the review was written. */
  readonly stale: boolean;
  readonly dismissed: boolean;
}

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
