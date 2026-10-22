import { jsonResponse, type RecordedRequest } from '@sdlc-tools/core/testing';

/** `FakeAuthorizationServer` from core fixes its OAuth endpoints on this host, so the REST fake lives there too. */
export const HOST = 'https://auth.example.test';

export interface FakeBranch {
  sha: string;
  protected: boolean;
}

export interface FakePull {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergeable: boolean;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  user: string;
  labels: number[];
  reviewers: string[];
  mergeCommitSha: string | null;
  /** The repository the head branch lives in; the pull request's own repository by default. */
  headRepo?: string;
}

export interface FakeReview {
  user: string;
  state: string;
  stale?: boolean;
  dismissed?: boolean;
}

export interface FakeStatus {
  id: number;
  context: string;
  status: string;
  target_url?: string;
}

const SHA = (seed: string): string => seed.repeat(40).slice(0, 40);

/** A Forgejo / Gitea REST API in memory: just the routes `sdlc-forgejo` calls, with the rules a real server enforces. */
export class FakeForgejo {
  readonly owner = 'acme';
  readonly name = 'widgets';
  readonly defaultBranch = 'main';
  readonly tokens = new Map<string, string>();
  readonly branches = new Map<string, FakeBranch>([['main', { sha: SHA('a'), protected: true }]]);
  readonly pulls: FakePull[] = [];
  readonly labels = [
    { id: 1, name: 'bug' },
    { id: 2, name: 'feature' },
  ];
  readonly reviews = new Map<number, FakeReview[]>();
  readonly statuses = new Map<string, FakeStatus[]>();
  readonly unknownUsers = new Set<string>();
  /** Every request, as `METHOD /path`, in order. */
  readonly log: string[] = [];
  readonly bodies: { route: string; body: unknown }[] = [];
  /** Makes the next merge request fail with this status. */
  failMerge: number | undefined;
  /** Keeps the head branch after a merge, as a server with a protection rule does. */
  keepBranchOnMerge = false;
  pageCap = 50;

  constructor() {
    this.acceptToken('pat-1', 'alice');
  }

  get slug(): string {
    return `${this.owner}/${this.name}`;
  }

  acceptToken(token: string, login: string): void {
    this.tokens.set(token, login);
  }

  /** A branch exists on the server, as if it had been pushed. */
  push(name: string, sha: string): void {
    this.branches.set(name, { sha, protected: false });
  }

  addPull(
    init: Partial<Omit<FakePull, 'head' | 'base'>> & { head: string; base?: string },
  ): FakePull {
    const { head, base, ...rest } = init;
    const sha = this.branches.get(head)?.sha ?? SHA('b');
    const pull: FakePull = {
      number: this.pulls.length + 1,
      title: 'feat: change',
      body: 'Body',
      state: 'open',
      merged: false,
      mergeable: true,
      head: { ref: head, sha },
      base: { ref: base ?? 'main', sha: SHA('a') },
      user: 'alice',
      labels: [],
      reviewers: [],
      mergeCommitSha: null,
      ...rest,
    };
    this.pulls.push(pull);
    return pull;
  }

  count(route: string): number {
    return this.log.filter((entry) => entry === route).length;
  }

  handle = (request: RecordedRequest): Response => {
    const path = request.url.pathname.replace(/^\/api\/v1/, '');
    const route = `${request.method} ${path}`;
    this.log.push(route);
    const body: unknown = request.body === undefined ? undefined : JSON.parse(request.body);
    if (body !== undefined) this.bodies.push({ route, body });

    const login = this.tokens.get(
      /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '',
    );
    if (login === undefined) return jsonResponse(401, { message: 'token is required' });

    if (path === '/user') return jsonResponse(200, { login });
    const repoPrefix = `/repos/${this.owner}/${this.name}`;
    if (!path.startsWith(repoPrefix))
      return jsonResponse(404, { message: 'repository does not exist' });
    const rest = path.slice(repoPrefix.length);
    return this.#repoRoute(request, rest, body, login);
  };

  #repoRoute(request: RecordedRequest, rest: string, body: unknown, login: string): Response {
    const method = request.method;
    if (rest === '' && method === 'GET') {
      return jsonResponse(200, { full_name: this.slug, default_branch: this.defaultBranch });
    }

    const branch = /^\/branches\/([^/]+)$/.exec(rest)?.[1];
    if (branch !== undefined) {
      const name = decodeURIComponent(branch);
      const found = this.branches.get(name);
      if (found === undefined) return jsonResponse(404, { message: 'branch does not exist' });
      if (method === 'DELETE') {
        if (found.protected) return jsonResponse(403, { message: 'branch is protected' });
        this.branches.delete(name);
        return new Response(null, { status: 204 });
      }
      return jsonResponse(200, { name, protected: found.protected, commit: { id: found.sha } });
    }

    if (rest === '/pulls' && method === 'GET') return this.#listPulls(request);
    if (rest === '/pulls' && method === 'POST')
      return this.#createPull(body as Record<string, string>, login);

    const pullMatch = /^\/pulls\/(\d+)(\/.*)?$/.exec(rest);
    if (pullMatch !== null) {
      const pull = this.pulls.find((candidate) => candidate.number === Number(pullMatch[1]));
      if (pull === undefined) return jsonResponse(404, { message: 'pull request does not exist' });
      return this.#pullRoute(pull, pullMatch[2] ?? '', method, body);
    }

    if (rest === '/labels' && method === 'GET') return jsonResponse(200, this.labels);
    const labelMatch = /^\/issues\/(\d+)\/labels(?:\/(\d+))?$/.exec(rest);
    if (labelMatch !== null) {
      const pull = this.pulls.find((candidate) => candidate.number === Number(labelMatch[1]));
      if (pull === undefined) return jsonResponse(404, { message: 'issue does not exist' });
      if (method === 'POST') {
        pull.labels.push(...(body as { labels: number[] }).labels);
        return jsonResponse(200, this.#labelsOf(pull));
      }
      if (method === 'DELETE' && labelMatch[2] !== undefined) {
        pull.labels = pull.labels.filter((id) => id !== Number(labelMatch[2]));
        return new Response(null, { status: 204 });
      }
    }

    const statusMatch = /^\/commits\/([^/]+)\/statuses$/.exec(rest);
    if (statusMatch?.[1] !== undefined) {
      return jsonResponse(200, this.statuses.get(statusMatch[1]) ?? []);
    }
    return jsonResponse(404, { message: `no route for ${method} ${rest}` });
  }

  #labelsOf(pull: FakePull): { id: number; name: string }[] {
    return this.labels.filter((label) => pull.labels.includes(label.id));
  }

  #render(pull: FakePull): Record<string, unknown> {
    return {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      merged: pull.merged,
      mergeable: pull.mergeable,
      head: {
        // A merged pull request whose branch was deleted no longer names it in `ref`.
        ref: pull.merged ? `refs/pull/${pull.number}/head` : pull.head.ref,
        label: pull.head.ref,
        sha: pull.head.sha,
        repo: { full_name: pull.headRepo ?? this.slug },
      },
      base: { ref: pull.base.ref, sha: pull.base.sha, repo: { full_name: this.slug } },
      user: { login: pull.user },
      html_url: `${HOST}/${this.slug}/pulls/${pull.number}`,
      labels: this.#labelsOf(pull),
      requested_reviewers: pull.reviewers.map((reviewer) => ({ login: reviewer })),
      merge_commit_sha: pull.mergeCommitSha,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
  }

  #listPulls(request: RecordedRequest): Response {
    const state = request.url.searchParams.get('state') ?? 'open';
    const page = Number(request.url.searchParams.get('page') ?? '1');
    const limit = Math.min(Number(request.url.searchParams.get('limit') ?? '30'), this.pageCap);
    const matching = this.pulls
      .filter((pull) => state === 'all' || pull.state === state)
      .toSorted((a, b) => b.number - a.number);
    const slice = matching.slice((page - 1) * limit, page * limit);
    return jsonResponse(
      200,
      slice.map((pull) => this.#render(pull)),
      {
        'x-total-count': String(matching.length),
      },
    );
  }

  #createPull(body: Record<string, string>, login: string): Response {
    const head = this.branches.get(body.head ?? '');
    if (head === undefined) return jsonResponse(404, { message: 'head branch does not exist' });
    const pull = this.addPull({
      head: body.head ?? '',
      title: body.title ?? '',
      body: body.body ?? '',
      user: login,
    });
    pull.base.ref = body.base ?? 'main';
    return jsonResponse(201, this.#render(pull));
  }

  #pullRoute(pull: FakePull, suffix: string, method: string, body: unknown): Response {
    if (suffix === '' && method === 'GET') return jsonResponse(200, this.#render(pull));

    if (suffix === '/requested_reviewers') {
      const { reviewers } = body as { reviewers: string[] };
      const unknown = reviewers.find((reviewer) => this.unknownUsers.has(reviewer));
      if (unknown !== undefined)
        return jsonResponse(422, { message: `user does not exist [name: ${unknown}]` });
      if (method === 'POST') {
        pull.reviewers.push(...reviewers.filter((reviewer) => !pull.reviewers.includes(reviewer)));
        return jsonResponse(201, []);
      }
      pull.reviewers = pull.reviewers.filter((reviewer) => !reviewers.includes(reviewer));
      return new Response(null, { status: 204 });
    }

    if (suffix === '/reviews' && method === 'GET') {
      return jsonResponse(
        200,
        (this.reviews.get(pull.number) ?? []).map((review) => ({
          user: { login: review.user },
          state: review.state,
          stale: review.stale ?? false,
          dismissed: review.dismissed ?? false,
        })),
      );
    }

    if (suffix === '/merge' && method === 'POST')
      return this.#merge(pull, body as Record<string, unknown>);
    return jsonResponse(404, { message: 'no such pull request route' });
  }

  #merge(pull: FakePull, body: Record<string, unknown>): Response {
    if (this.failMerge !== undefined) {
      const status = this.failMerge;
      this.failMerge = undefined;
      return jsonResponse(status, { message: 'Not all required approvals were granted' });
    }
    if (pull.merged || pull.state !== 'open')
      return jsonResponse(404, { message: 'pull request is not open' });
    if (body.Do !== 'merge')
      return jsonResponse(422, { message: `merge style ${String(body.Do)} is not allowed` });
    if (body.head_commit_id !== undefined && body.head_commit_id !== pull.head.sha) {
      return jsonResponse(409, { message: 'head commit does not match' });
    }
    pull.merged = true;
    pull.state = 'closed';
    pull.mergeCommitSha = SHA('c');
    if (body.delete_branch_after_merge === true && !this.keepBranchOnMerge) {
      this.branches.delete(pull.head.ref);
    }
    return new Response(null, { status: 200 });
  }
}
