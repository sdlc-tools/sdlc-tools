import { CliError, isCliError, urlPath, type HttpClient } from '@sdlc-tools/core';
import type {
  Branch,
  CiSummary,
  Label,
  MergeMethod,
  PullRequest,
  Repository,
  Review,
  StatusRecord,
} from './model.js';
import { isDraftTitle } from './rules.js';
import { formatRepo, repoPath, type RepoRef } from './repo.js';
import { summarizeStatuses } from './statuses.js';

const PAGE_SIZE = 50;
const MAX_PAGES = 200;

interface RawUser {
  readonly login?: string;
}

interface RawRef {
  /** `refs/pull/<n>/head` once the pull request is merged and its branch is gone. */
  readonly ref?: string;
  /** The branch name as the author knew it, kept after `ref` stops naming it. */
  readonly label?: string;
  readonly sha?: string;
  readonly repo?: { readonly full_name?: string } | null;
}

interface RawPull {
  readonly number: number;
  readonly title?: string;
  readonly body?: string;
  readonly state?: string;
  readonly merged?: boolean;
  readonly draft?: boolean;
  readonly mergeable?: boolean | null;
  readonly head?: RawRef;
  readonly base?: RawRef;
  readonly user?: RawUser | null;
  readonly html_url?: string;
  readonly labels?: readonly { readonly name?: string }[] | null;
  readonly requested_reviewers?: readonly RawUser[] | null;
  readonly merge_commit_sha?: string | null;
  readonly created_at?: string;
  readonly updated_at?: string;
}

interface RawReview {
  readonly id?: number;
  readonly user?: RawUser | null;
  readonly state?: string;
  readonly commit_id?: string;
  readonly stale?: boolean;
  readonly dismissed?: boolean;
}

interface RawStatus {
  readonly id?: number;
  readonly context?: string;
  readonly status?: string;
  readonly target_url?: string | null;
}

const PULL_REF = /^refs\/pull\/\d+\/head$/;

function headBranch(head: RawRef | undefined): string {
  const ref = head?.ref ?? '';
  return PULL_REF.test(ref) && head?.label !== undefined && head.label !== '' ? head.label : ref;
}

function toPullRequest(raw: RawPull): PullRequest {
  const title = raw.title ?? '';
  return {
    number: raw.number,
    title,
    body: raw.body ?? '',
    state: raw.state === 'closed' ? 'closed' : 'open',
    merged: raw.merged === true,
    // The server's own judgement wins: it knows its configured prefixes. Only servers that omit the field fall back to the default ones.
    draft: raw.draft ?? isDraftTitle(title),
    mergeable: raw.mergeable ?? null,
    head: {
      ref: headBranch(raw.head),
      sha: raw.head?.sha ?? '',
      repo: raw.head?.repo?.full_name ?? null,
    },
    base: { ref: raw.base?.ref ?? '', sha: raw.base?.sha ?? '' },
    author: raw.user?.login ?? null,
    url: raw.html_url ?? '',
    labels: (raw.labels ?? []).flatMap((label) => (label.name === undefined ? [] : [label.name])),
    reviewers: (raw.requested_reviewers ?? []).flatMap((user) =>
      user.login === undefined ? [] : [user.login],
    ),
    mergeCommitSha: raw.merge_commit_sha ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  };
}

export type PullState = 'open' | 'closed' | 'all';

export interface MergeRequest {
  readonly method: MergeMethod;
  readonly deleteBranch: boolean;
  /** The commit the server must still find at the head; protects against merging something unreviewed. */
  readonly headSha: string;
  /** The merge commit's title and message; without them the server writes its own. */
  readonly commitText?: { readonly title: string; readonly message: string };
}

/** Typed access to the parts of the Forgejo / Gitea REST API the commands use. */
export class ForgejoApi {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  async currentUser(): Promise<{ readonly login: string }> {
    const { data } = await this.#http.get<RawUser>('/user', { resource: 'the signed-in user' });
    if (data.login === undefined) {
      throw new CliError('server', 'The server did not say who the credentials belong to.', {
        code: 'unexpected_response',
        next: ['Check that the server address points to a Forgejo or Gitea instance.'],
      });
    }
    return { login: data.login };
  }

  async getRepository(repo: RepoRef): Promise<Repository> {
    const { data } = await this.#http.get<{ full_name?: string; default_branch?: string }>(
      repoPath(repo),
      { resource: `repository ${formatRepo(repo)}` },
    );
    return {
      fullName: data.full_name ?? formatRepo(repo),
      defaultBranch: data.default_branch ?? 'main',
    };
  }

  /** The branch, or `undefined` when the repository has no branch of that name. */
  async getBranch(repo: RepoRef, name: string): Promise<Branch | undefined> {
    try {
      const { data } = await this.#http.get<{
        name?: string;
        protected?: boolean;
        commit?: { id?: string };
      }>(`${repoPath(repo)}${urlPath`/branches/${name}`}`, {
        resource: `branch ${name} of ${formatRepo(repo)}`,
      });
      return {
        name: data.name ?? name,
        sha: data.commit?.id ?? '',
        protected: data.protected === true,
      };
    } catch (error) {
      if (isCliError(error) && error.kind === 'not-found') return undefined;
      throw error;
    }
  }

  async deleteBranch(repo: RepoRef, name: string): Promise<void> {
    await this.#http.delete(`${repoPath(repo)}${urlPath`/branches/${name}`}`, {
      resource: `branch ${name} of ${formatRepo(repo)}`,
    });
  }

  async getPull(repo: RepoRef, number: number): Promise<PullRequest> {
    const { data } = await this.#http.get<RawPull>(
      `${repoPath(repo)}${urlPath`/pulls/${number}`}`,
      {
        resource: `pull request #${number}`,
      },
    );
    return toPullRequest(data);
  }

  /**
   * Walks the pull requests newest first and yields the ones `accept` keeps, stopping after `limit`
   * of them (`undefined`: all) or after `maxPages` pages.
   */
  async listPulls(
    repo: RepoRef,
    options: {
      readonly state: PullState;
      readonly accept?: (pull: PullRequest) => boolean;
      readonly limit?: number | undefined;
      readonly maxPages?: number | undefined;
    },
  ): Promise<PullRequest[]> {
    const found: PullRequest[] = [];
    let seen = 0;
    const maxPages = options.maxPages ?? MAX_PAGES;
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await this.#http.get<RawPull[]>(`${repoPath(repo)}/pulls`, {
        query: { state: options.state, page, limit: PAGE_SIZE },
        resource: `the pull requests of ${formatRepo(repo)}`,
      });
      const batch = Array.isArray(response.data) ? response.data : [];
      for (const raw of batch) {
        const pull = toPullRequest(raw);
        if (options.accept?.(pull) ?? true) {
          found.push(pull);
          if (options.limit !== undefined && found.length >= options.limit) return found;
        }
      }
      seen += batch.length;
      const total = Number(response.headers.get('x-total-count'));
      const more = Number.isFinite(total) && total > 0 ? seen < total : batch.length >= PAGE_SIZE;
      if (batch.length === 0 || !more) break;
    }
    return found;
  }

  /**
   * The pull requests whose head is this branch of this repository. Every open one is found; the
   * closed ones come from the most recent pages only, because they are advice, not a gate.
   */
  async pullsForHead(
    repo: RepoRef,
    head: string,
  ): Promise<{ open: PullRequest[]; closed: PullRequest[] }> {
    const full = formatRepo(repo).toLowerCase();
    const accept = (pull: PullRequest): boolean =>
      pull.head.ref === head && pull.head.repo?.toLowerCase() === full;
    const [open, closed] = await Promise.all([
      this.listPulls(repo, { state: 'open', accept }),
      this.listPulls(repo, { state: 'closed', accept, maxPages: 4 }),
    ]);
    return { open, closed };
  }

  async createPull(
    repo: RepoRef,
    input: {
      readonly title: string;
      readonly body: string;
      readonly head: string;
      readonly base: string;
    },
  ): Promise<PullRequest> {
    const { data } = await this.#http.post<RawPull>(`${repoPath(repo)}/pulls`, {
      body: input,
      resource: `the pull requests of ${formatRepo(repo)}`,
    });
    return toPullRequest(data);
  }

  async setPullTitle(repo: RepoRef, number: number, title: string): Promise<PullRequest> {
    const { data } = await this.#http.patch<RawPull>(
      `${repoPath(repo)}${urlPath`/pulls/${number}`}`,
      { body: { title }, resource: `pull request #${number}` },
    );
    return toPullRequest(data);
  }

  async requestReviewers(
    repo: RepoRef,
    number: number,
    reviewers: readonly string[],
  ): Promise<void> {
    await this.#http.post(`${repoPath(repo)}${urlPath`/pulls/${number}`}/requested_reviewers`, {
      body: { reviewers },
      resource: `pull request #${number}`,
    });
  }

  async removeReviewers(
    repo: RepoRef,
    number: number,
    reviewers: readonly string[],
  ): Promise<void> {
    await this.#http.delete(`${repoPath(repo)}${urlPath`/pulls/${number}`}/requested_reviewers`, {
      body: { reviewers },
      resource: `pull request #${number}`,
    });
  }

  async listReviews(repo: RepoRef, number: number): Promise<Review[]> {
    const raws = await this.#collect<RawReview>(
      `${repoPath(repo)}${urlPath`/pulls/${number}`}/reviews`,
      `the reviews of pull request #${number}`,
    );
    return raws.map((raw) => ({
      id: raw.id ?? 0,
      reviewer: raw.user?.login ?? null,
      state: raw.state ?? 'COMMENT',
      commit: raw.commit_id === undefined || raw.commit_id === '' ? null : raw.commit_id,
      stale: raw.stale === true,
      dismissed: raw.dismissed === true,
    }));
  }

  /** Every result reported for a commit, reruns included. Rejects when this account may not read them. */
  async listStatuses(repo: RepoRef, sha: string): Promise<StatusRecord[]> {
    const raws = await this.#collect<RawStatus>(
      `${repoPath(repo)}${urlPath`/commits/${sha}`}/statuses`,
      `the CI results of commit ${sha.slice(0, 8)}`,
    );
    return raws.flatMap((raw) =>
      raw.context === undefined
        ? []
        : [
            {
              id: raw.id ?? 0,
              context: raw.context,
              state: raw.status ?? '',
              // A status without a link comes back as "" on a real server.
              url: raw.target_url === undefined || raw.target_url === '' ? null : raw.target_url,
            },
          ],
    );
  }

  /** CI results of a commit; `undefined` when this account may not read them. */
  async getCiSummary(repo: RepoRef, sha: string): Promise<CiSummary | undefined> {
    if (sha === '') return undefined;
    try {
      return summarizeStatuses(await this.listStatuses(repo, sha));
    } catch (error) {
      if (isCliError(error) && (error.kind === 'not-found' || error.kind === 'permission')) {
        return undefined;
      }
      throw error;
    }
  }

  /** All pages of a list the server pages; a decision made on a partial list could be wrong. */
  async #collect<T>(path: string, resource: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await this.#http.get<T[]>(path, {
        query: { page, limit: PAGE_SIZE },
        resource,
      });
      const batch = Array.isArray(response.data) ? response.data : [];
      items.push(...batch);
      const total = Number(response.headers.get('x-total-count'));
      const more =
        Number.isFinite(total) && total > 0 ? items.length < total : batch.length >= PAGE_SIZE;
      if (batch.length === 0 || !more) break;
    }
    return items;
  }

  async listLabels(repo: RepoRef): Promise<Label[]> {
    const labels: Label[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data } = await this.#http.get<{ id?: number; name?: string }[]>(
        `${repoPath(repo)}/labels`,
        { query: { page, limit: PAGE_SIZE }, resource: `the labels of ${formatRepo(repo)}` },
      );
      const batch = Array.isArray(data) ? data : [];
      for (const raw of batch) {
        if (raw.id !== undefined && raw.name !== undefined)
          labels.push({ id: raw.id, name: raw.name });
      }
      if (batch.length < PAGE_SIZE) break;
    }
    return labels;
  }

  async addLabels(repo: RepoRef, number: number, ids: readonly number[]): Promise<void> {
    await this.#http.post(`${repoPath(repo)}${urlPath`/issues/${number}`}/labels`, {
      body: { labels: ids },
      resource: `pull request #${number}`,
    });
  }

  async removeLabel(repo: RepoRef, number: number, id: number): Promise<void> {
    await this.#http.delete(`${repoPath(repo)}${urlPath`/issues/${number}/labels/${id}`}`, {
      resource: `pull request #${number}`,
    });
  }

  /**
   * Merges with the requested method, pinned to the head the caller checked. `force_merge` and
   * `merge_when_checks_succeed` are never sent: the first would let an administrator skip the
   * server's protection, the second would merge later, on a head nobody judged.
   */
  async mergePull(repo: RepoRef, number: number, request: MergeRequest): Promise<void> {
    try {
      await this.#http.post(`${repoPath(repo)}${urlPath`/pulls/${number}`}/merge`, {
        body: {
          Do: request.method,
          ...(request.commitText === undefined
            ? {}
            : {
                MergeTitleField: request.commitText.title,
                MergeMessageField: request.commitText.message,
              }),
          delete_branch_after_merge: request.deleteBranch,
          head_commit_id: request.headSha,
        },
        resource: `pull request #${number}`,
      });
    } catch (error) {
      if (isCliError(error) && [405, 409, 422].includes(error.status ?? 0)) {
        throw error.with({
          code: 'merge_rejected',
          causes: [
            'A branch protection rule is not satisfied, such as required approvals or status checks.',
            'The pull request is a draft, has conflicts, or its head changed since it was read.',
            'The repository does not enable the requested merge method.',
          ],
          next: [`Run \`sdlc-forgejo pr view ${number}\` to see where the pull request stands.`],
        });
      }
      throw error;
    }
  }
}
