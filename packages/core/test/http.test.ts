import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.js';
import { HttpClient, extractServerMessage, type AuthProvider } from '../src/http.js';
import {
  forbidFetch,
  jsonResponse,
  mockFetch,
  networkFailure,
  textResponse,
} from '../src/testing/index.js';

const BASE_URL = 'https://git.example.test/api/v1';
const SERVER = 'git.example.test';

function client(
  fetch: typeof globalThis.fetch,
  extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {},
) {
  return new HttpClient({ baseUrl: BASE_URL, fetch, ...extra });
}

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected the request to fail');
}

describe('successful responses', () => {
  it.each([200, 201, 202])('treats HTTP %i as success', async (status) => {
    const { fetch } = mockFetch(() => jsonResponse(status, { ok: true }));
    const response = await client(fetch).get('/ping');
    expect(response.status).toBe(status);
    expect(response.data).toEqual({ ok: true });
  });

  it('returns undefined data for 204', async () => {
    const { fetch } = mockFetch(() => new Response(null, { status: 204 }));
    expect((await client(fetch).delete('/thing')).data).toBeUndefined();
  });

  it('returns text for non-JSON bodies', async () => {
    const { fetch } = mockFetch(() => textResponse(200, 'plain'));
    expect((await client(fetch).get('/raw')).data).toBe('plain');
  });
});

describe('request building', () => {
  it('keeps the base path, appends query parameters and skips undefined ones', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, {}));
    await client(fetch).get('/repos', {
      query: { q: 'a b', page: 2, empty: undefined, tag: ['x', 'y'] },
    });
    expect(calls[0]?.url.href).toBe(`${BASE_URL}/repos?q=a+b&page=2&tag=x&tag=y`);
  });

  it('sends JSON bodies with a content type', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(201, {}));
    await client(fetch).post('/items', { body: { name: 'n' } });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(calls[0]?.body).toBe('{"name":"n"}');
  });

  it('sends form bodies urlencoded', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, {}));
    await client(fetch).post('/token', { form: { grant_type: 'x', code: 'a b' } });
    expect(calls[0]?.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(calls[0]?.body).toBe('grant_type=x&code=a+b');
  });

  it('sends the user agent when configured', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse(200, {}));
    await client(fetch, { userAgent: 'tool/1.0' }).get('/x');
    expect(calls[0]?.headers.get('user-agent')).toBe('tool/1.0');
  });
});

describe('HTTP error translation', () => {
  it('translates 401 into an auth error with the supplied re-login steps', async () => {
    const { fetch } = mockFetch(() => jsonResponse(401, { message: 'token expired' }));
    const error = await failure(
      client(fetch, { context: { reauth: ["Run 'tool auth login'."] } }).get('/me'),
    );
    expect(error.kind).toBe('auth');
    expect(error.exitCode).toBe(3);
    expect(error.status).toBe(401);
    expect(error.message).toContain(SERVER);
    expect(error.message).toContain('HTTP 401');
    expect(error.message).toContain('token expired');
    expect(error.causes.length).toBeGreaterThan(0);
    expect(error.next).toContain("Run 'tool auth login'.");
  });

  it('translates 403 into a permission error that names the resource', async () => {
    const { fetch } = mockFetch(() => jsonResponse(403, { message: 'no' }));
    const error = await failure(client(fetch).get('/x', { resource: 'pull request #12' }));
    expect(error.kind).toBe('permission');
    expect(error.exitCode).toBe(4);
    expect(error.message).toContain('pull request #12');
    expect(error.causes.join(' ')).toMatch(/scope/);
    expect(error.next.length).toBeGreaterThan(0);
  });

  it('translates 404 into a not-found error that hints at private resources', async () => {
    const { fetch } = mockFetch(() => jsonResponse(404, {}));
    const error = await failure(client(fetch).get('/x', { resource: 'repository acme/app' }));
    expect(error.kind).toBe('not-found');
    expect(error.exitCode).toBe(5);
    expect(error.message).toContain('repository acme/app');
    expect(error.causes.join(' ')).toMatch(/404 instead of 403/);
    expect(error.next.join(' ')).toMatch(/server address/);
  });

  it.each([500, 502, 503])('translates %i into a server error', async (status) => {
    const { fetch } = mockFetch(() => textResponse(status, 'boom'));
    const error = await failure(client(fetch).get('/x'));
    expect(error.kind).toBe('server');
    expect(error.exitCode).toBe(6);
    expect(error.message).toContain('boom');
  });

  it('translates 429 and reports Retry-After', async () => {
    const { fetch } = mockFetch(() => jsonResponse(429, {}, { 'retry-after': '30' }));
    const error = await failure(client(fetch).get('/x'));
    expect(error.code).toBe('rate_limited');
    expect(error.next.join(' ')).toContain('30');
  });

  it('reports other 4xx statuses with the server message', async () => {
    const { fetch } = mockFetch(() => jsonResponse(422, { message: 'title is required' }));
    const error = await failure(client(fetch).post('/x', { body: {} }));
    expect(error.kind).toBe('server');
    expect(error.code).toBe('request_rejected');
    expect(error.message).toContain('title is required');
  });

  it('does not leak request headers or the query string', async () => {
    const auth: AuthProvider = {
      authorization: () => Promise.resolve('Bearer super-secret-token'),
    };
    const { fetch } = mockFetch(() => jsonResponse(500, {}));
    const error = await failure(
      client(fetch, { auth }).get('/x', { query: { key: 'private-key' } }),
    );
    const rendered = JSON.stringify(error.toJSON());
    expect(rendered).not.toContain('super-secret-token');
    expect(rendered).not.toContain('private-key');
  });
});

describe('extractServerMessage', () => {
  it.each([
    [{ message: 'plain' }, 'plain'],
    [{ error_description: 'oauth style' }, 'oauth style'],
    [{ error: 'invalid_grant' }, 'invalid_grant'],
    [{ errorMessages: ['one', 'two'] }, 'one; two'],
    [{ errors: { summary: 'required' } }, 'summary: required'],
    [{ errors: [{ message: 'nested' }] }, 'nested'],
    ['text body', 'text body'],
    ['<html><body>Bad gateway</body></html>', undefined],
    [{ unrelated: true }, undefined],
    [undefined, undefined],
  ])('reads %j', (data, expected) => {
    expect(extractServerMessage(data)).toBe(expected);
  });

  it('collapses whitespace and truncates long messages', () => {
    const message = extractServerMessage({ message: `a\n\n  b ${'x'.repeat(400)}` });
    expect(message?.startsWith('a b x')).toBe(true);
    expect(message?.length).toBe(300);
    expect(message?.endsWith('…')).toBe(true);
  });
});

describe('transport failures', () => {
  it.each([
    ['ECONNREFUSED', 'the connection was refused'],
    ['ENOTFOUND', 'the host name could not be resolved'],
    ['ETIMEDOUT', 'the connection timed out'],
  ])('reports %s as a network error', async (code, reason) => {
    const { fetch } = mockFetch(() => {
      throw networkFailure(code);
    });
    const error = await failure(client(fetch).get('/x'));
    expect(error.kind).toBe('network');
    expect(error.exitCode).toBe(7);
    expect(error.message).toContain(`Could not reach ${SERVER}`);
    expect(error.message).toContain(reason);
    expect(error.message).toContain(code);
  });

  it('points at NODE_EXTRA_CA_CERTS for untrusted certificates', async () => {
    const { fetch } = mockFetch(() => {
      throw networkFailure('SELF_SIGNED_CERT_IN_CHAIN');
    });
    const error = await failure(client(fetch).get('/x'));
    expect(error.code).toBe('tls_error');
    expect(error.next.join(' ')).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('times out requests that never answer', async () => {
    const { fetch } = mockFetch(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'TimeoutError'));
          });
        }),
    );
    const error = await failure(client(fetch, { timeoutMs: 20 }).get('/slow'));
    expect(error.kind).toBe('network');
    expect(error.code).toBe('timeout');
  });

  it('reports cancellation separately from network failures', async () => {
    const controller = new AbortController();
    const { fetch } = mockFetch(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
          controller.abort();
        }),
    );
    const error = await failure(client(fetch, { signal: controller.signal }).get('/x'));
    expect(error.kind).toBe('cancelled');
    expect(error.exitCode).toBe(130);
  });
});

describe('authentication', () => {
  it('sends the header produced by the auth provider', async () => {
    const auth: AuthProvider = { authorization: () => Promise.resolve('Bearer abc') };
    const { fetch, calls } = mockFetch(() => jsonResponse(200, {}));
    await client(fetch, { auth }).get('/me');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer abc');
  });

  it('fails before any network call when the provider has no credentials', async () => {
    const auth: AuthProvider = {
      authorization: () => Promise.reject(new CliError('auth', 'No credentials.')),
    };
    const never = forbidFetch();
    const error = await failure(client(never.fetch, { auth }).get('/me'));
    expect(error.exitCode).toBe(3);
    expect(never.calls).toHaveLength(0);
  });

  it('retries once with renewed credentials after a 401', async () => {
    let token = 'old';
    const auth: AuthProvider = {
      authorization: () => Promise.resolve(`Bearer ${token}`),
      refresh: () => {
        token = 'new';
        return Promise.resolve(true);
      },
    };
    const { fetch, calls } = mockFetch([
      () => jsonResponse(401, {}),
      () => jsonResponse(200, { me: 1 }),
    ]);
    const response = await client(fetch, { auth }).get('/me');
    expect(response.data).toEqual({ me: 1 });
    expect(calls.map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer old',
      'Bearer new',
    ]);
  });

  it('does not retry when the provider cannot renew', async () => {
    const auth: AuthProvider = {
      authorization: () => Promise.resolve('Bearer old'),
      refresh: () => Promise.resolve(false),
    };
    const { fetch, calls } = mockFetch(() => jsonResponse(401, {}));
    const error = await failure(client(fetch, { auth }).get('/me'));
    expect(error.kind).toBe('auth');
    expect(calls).toHaveLength(1);
  });

  it('retries at most once', async () => {
    const auth: AuthProvider = {
      authorization: () => Promise.resolve('Bearer x'),
      refresh: () => Promise.resolve(true),
    };
    const { fetch, calls } = mockFetch(() => jsonResponse(401, {}));
    const error = await failure(client(fetch, { auth }).get('/me'));
    expect(error.kind).toBe('auth');
    expect(calls).toHaveLength(2);
  });
});
