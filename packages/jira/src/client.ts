import { type HttpClient, urlPath } from '@sdlc-tools/core';
import type { AdfDocument } from './adf/types.js';

export interface JiraUser {
  readonly accountId: string;
  readonly displayName: string;
  readonly emailAddress?: string;
  readonly active?: boolean;
}

export interface JiraIssue {
  readonly id: string;
  readonly key: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  readonly to?: { readonly id?: string; readonly name: string };
}

export interface JiraFieldDefinition {
  readonly id: string;
  readonly name: string;
  readonly custom: boolean;
  readonly schema?: {
    readonly type?: string;
    readonly items?: string;
    readonly custom?: string;
  };
}

export interface JiraComment {
  readonly id: string;
  readonly author?: { readonly displayName?: string };
  readonly body?: unknown;
  readonly created?: string;
  readonly updated?: string;
}

export interface JiraWorklog {
  readonly id: string;
  readonly author?: { readonly displayName?: string };
  readonly timeSpent?: string;
  readonly timeSpentSeconds?: number;
  readonly started?: string;
  readonly comment?: unknown;
}

export interface JiraLinkType {
  readonly id?: string;
  readonly name: string;
  readonly inward: string;
  readonly outward: string;
}

export interface IssueChange {
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly update?: Readonly<Record<string, unknown>>;
}

const SEARCH_PAGE_SIZE = 100;

/** The Jira Cloud REST API v3 calls this tool makes; each method names the resource for error messages. */
export class JiraClient {
  readonly #http: HttpClient;
  readonly baseUrl: string;

  constructor(http: HttpClient, baseUrl: string) {
    this.#http = http;
    this.baseUrl = baseUrl;
  }

  browseUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  async myself(): Promise<JiraUser> {
    const { data } = await this.#http.get<JiraUser>('/rest/api/3/myself', {
      resource: 'the signed-in account',
    });
    return data;
  }

  async listFields(): Promise<JiraFieldDefinition[]> {
    const { data } = await this.#http.get<JiraFieldDefinition[]>('/rest/api/3/field', {
      resource: 'the field list',
    });
    return data;
  }

  async getIssue(key: string, fields: readonly string[]): Promise<JiraIssue> {
    const { data } = await this.#http.get<JiraIssue>(urlPath`/rest/api/3/issue/${key}`, {
      query: { fields: fields.join(',') },
      resource: `issue ${key}`,
    });
    return data;
  }

  /** Follows `nextPageToken` until `limit` issues are collected or the results end. */
  async searchIssues(
    jql: string,
    fields: readonly string[],
    limit: number,
  ): Promise<{ issues: JiraIssue[]; hasMore: boolean }> {
    const issues: JiraIssue[] = [];
    let token: string | undefined;
    for (;;) {
      const { data } = await this.#http.get<{
        issues?: JiraIssue[];
        nextPageToken?: string;
      }>('/rest/api/3/search/jql', {
        query: {
          jql,
          fields: fields.join(','),
          maxResults: Math.min(limit - issues.length, SEARCH_PAGE_SIZE),
          nextPageToken: token,
        },
        resource: 'the issue search',
      });
      issues.push(...(data.issues ?? []));
      token = data.nextPageToken;
      if (token === undefined) return { issues, hasMore: false };
      if (issues.length >= limit) return { issues, hasMore: true };
    }
  }

  async createIssue(
    fields: Readonly<Record<string, unknown>>,
  ): Promise<{ id: string; key: string }> {
    const { data } = await this.#http.post<{ id: string; key: string }>('/rest/api/3/issue', {
      body: { fields },
      resource: 'the project',
    });
    return data;
  }

  async updateIssue(key: string, change: IssueChange): Promise<void> {
    await this.#http.put(urlPath`/rest/api/3/issue/${key}`, {
      body: change,
      resource: `issue ${key}`,
    });
  }

  async listTransitions(key: string): Promise<JiraTransition[]> {
    const { data } = await this.#http.get<{ transitions?: JiraTransition[] }>(
      urlPath`/rest/api/3/issue/${key}/transitions`,
      { resource: `issue ${key}` },
    );
    return data.transitions ?? [];
  }

  async transition(key: string, transitionId: string, change: IssueChange): Promise<void> {
    await this.#http.post(urlPath`/rest/api/3/issue/${key}/transitions`, {
      body: { transition: { id: transitionId }, ...change },
      resource: `issue ${key}`,
    });
  }

  async listLinkTypes(): Promise<JiraLinkType[]> {
    const { data } = await this.#http.get<{ issueLinkTypes?: JiraLinkType[] }>(
      '/rest/api/3/issueLinkType',
      { resource: 'the issue link types' },
    );
    return data.issueLinkTypes ?? [];
  }

  /** `outward` is the issue the type's outward phrase applies to ("blocks"); `inward` receives it ("is blocked by"). */
  async linkIssues(link: {
    type: string;
    outward: string;
    inward: string;
    comment?: AdfDocument;
  }): Promise<void> {
    await this.#http.post('/rest/api/3/issueLink', {
      body: {
        type: { name: link.type },
        outwardIssue: { key: link.outward },
        inwardIssue: { key: link.inward },
        ...(link.comment === undefined ? {} : { comment: { body: link.comment } }),
      },
      resource: `issues ${link.outward} and ${link.inward}`,
    });
  }

  async assign(key: string, accountId: string | null): Promise<void> {
    await this.#http.put(urlPath`/rest/api/3/issue/${key}/assignee`, {
      body: { accountId },
      resource: `issue ${key}`,
    });
  }

  async findUsers(
    query: string,
    scope: { issueKey?: string; project?: string } = {},
  ): Promise<JiraUser[]> {
    const assignable = scope.issueKey !== undefined || scope.project !== undefined;
    const { data } = await this.#http.get<JiraUser[]>(
      assignable ? '/rest/api/3/user/assignable/search' : '/rest/api/3/user/search',
      {
        query: { query, issueKey: scope.issueKey, project: scope.project },
        resource: 'the user search',
      },
    );
    return data;
  }

  async addComment(key: string, body: AdfDocument): Promise<{ id: string }> {
    const { data } = await this.#http.post<{ id: string }>(
      urlPath`/rest/api/3/issue/${key}/comment`,
      { body: { body }, resource: `issue ${key}` },
    );
    return data;
  }

  async listComments(
    key: string,
    limit: number,
  ): Promise<{ comments: JiraComment[]; total: number }> {
    const { data } = await this.#http.get<{ comments?: JiraComment[]; total?: number }>(
      urlPath`/rest/api/3/issue/${key}/comment`,
      { query: { orderBy: '-created', maxResults: limit }, resource: `issue ${key}` },
    );
    const comments = data.comments ?? [];
    return { comments, total: data.total ?? comments.length };
  }

  async addWorklog(key: string, body: Readonly<Record<string, unknown>>): Promise<{ id: string }> {
    const { data } = await this.#http.post<{ id: string }>(
      urlPath`/rest/api/3/issue/${key}/worklog`,
      { body, resource: `issue ${key}` },
    );
    return data;
  }

  async listWorklogs(
    key: string,
    limit: number,
  ): Promise<{ worklogs: JiraWorklog[]; total: number }> {
    const { data } = await this.#http.get<{ worklogs?: JiraWorklog[]; total?: number }>(
      urlPath`/rest/api/3/issue/${key}/worklog`,
      { query: { maxResults: limit }, resource: `issue ${key}` },
    );
    const worklogs = data.worklogs ?? [];
    return { worklogs, total: data.total ?? worklogs.length };
  }
}
