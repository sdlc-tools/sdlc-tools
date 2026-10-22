import {
  execute,
  jsonResponse,
  mockFetch,
  type RecordedRequest,
  type TestRun,
} from '@sdlc-tools/core/testing';
import { cli } from '../src/index.js';

export const SITE = 'https://team.example.test';
export const EMAIL = 'dev@example.test';
export const TOKEN = 'api-token-value';
export const BASIC = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

export const ENV = {
  SDLC_JIRA_SITE: SITE,
  SDLC_JIRA_EMAIL: EMAIL,
  SDLC_JIRA_TOKEN: TOKEN,
} as const;

type Route = (request: RecordedRequest) => unknown;

/**
 * A fake Jira site: routes are keyed `METHOD /path`. A request without a route
 * fails the test run loudly instead of answering with something plausible.
 */
export function fakeJira(routes: Readonly<Record<string, unknown>>) {
  return mockFetch((request) => {
    const key = `${request.method} ${request.url.pathname}`;
    if (!(key in routes)) throw new Error(`fakeJira: no route for ${key}`);
    const route = routes[key];
    const reply = typeof route === 'function' ? (route as Route)(request) : route;
    return reply instanceof Response ? reply : jsonResponse(200, reply);
  });
}

export function body(request: RecordedRequest | undefined): Record<string, unknown> {
  return JSON.parse(request?.body ?? 'null') as Record<string, unknown>;
}

export function jira(
  argv: readonly string[],
  options: Parameters<typeof execute>[2] = {},
): Promise<TestRun> {
  return execute(cli, argv, { env: ENV, ...options });
}

export const ISSUE = {
  id: '10001',
  key: 'ABC-1',
  fields: {
    summary: 'Fix the login page',
    status: { name: 'In Progress' },
    issuetype: { name: 'Bug' },
    priority: { name: 'High' },
    assignee: { displayName: 'Ada Lovelace', accountId: '5b10a2844c20165700ede21f' },
    reporter: { displayName: 'Grace Hopper' },
    labels: ['web', 'urgent'],
    duedate: '2026-12-31',
    updated: '2026-03-01T10:00:00.000+0900',
    description: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It breaks on submit.' }] }],
    },
    comment: {
      comments: [
        {
          id: '1',
          author: { displayName: 'Grace Hopper' },
          created: '2026-03-01T09:00:00.000+0900',
          body: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reproduced.' }] }],
          },
        },
      ],
    },
  },
} as const;
