export interface RecordedRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export type MockHandler = (request: RecordedRequest) => Response | Promise<Response>;

export interface MockFetch {
  readonly fetch: typeof globalThis.fetch;
  /** Every request received, in order. */
  readonly calls: RecordedRequest[];
}

/**
 * A `fetch` replacement that records requests and answers them with `handler`.
 * Handlers are consumed in order when an array is given; running out of handlers
 * fails the request so that unexpected extra calls surface in tests.
 */
export function mockFetch(handler: MockHandler | readonly MockHandler[]): MockFetch {
  const calls: RecordedRequest[] = [];
  const queue = typeof handler === 'function' ? undefined : [...handler];

  const fetchImpl = async (
    input: URL | Request | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const recorded: RecordedRequest = {
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      body: request.body === null ? undefined : await request.text(),
      signal: init?.signal ?? undefined,
    };
    calls.push(recorded);

    const next = queue === undefined ? handler : queue.shift();
    if (typeof next !== 'function') {
      throw new Error(`mockFetch: no handler left for ${recorded.method} ${recorded.url.href}`);
    }
    return next(recorded);
  };
  return { fetch: fetchImpl, calls };
}

/**
 * A `fetch` that must never be called. Assert `calls` is empty to prove a
 * command failed locally, before any network traffic.
 */
export function forbidFetch(): MockFetch {
  return mockFetch((request) => {
    throw new Error(`forbidFetch: unexpected network call ${request.method} ${request.url.href}`);
  });
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(
  status: number,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });
}

/** A `fetch` failure shaped like the ones Node's fetch raises (`TypeError` with a `cause.code`). */
export function networkFailure(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}
