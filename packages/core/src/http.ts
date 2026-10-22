import { CliError } from './errors.js';

/** Supplies the `Authorization` header and, optionally, a way to renew it after a 401. */
export interface AuthProvider {
  authorization(): Promise<string>;
  /** Called once after a 401; resolve `true` when new credentials are ready and the request should be retried. */
  refresh?(): Promise<boolean>;
}

export interface HttpErrorContext {
  /** Label used in messages; defaults to the host of the base URL. */
  readonly server?: string;
  /** Next steps shown for a 401, such as the command that signs in again. */
  readonly reauth?: readonly string[];
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  readonly query?: Readonly<Record<string, QueryValue | readonly QueryValue[]>> | undefined;
  /** JSON request body. */
  readonly body?: unknown;
  /** `application/x-www-form-urlencoded` request body. */
  readonly form?: Readonly<Record<string, string>> | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** What is being accessed, used in 403 and 404 messages (for example "pull request #12"). */
  readonly resource?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface HttpResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly data: T;
}

export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly auth?: AuthProvider | undefined;
  readonly context?: HttpErrorContext | undefined;
  readonly userAgent?: string | undefined;
  /** Default per-request timeout; 30 seconds when omitted. */
  readonly timeoutMs?: number | undefined;
  /** Cancels every request made by this client. */
  readonly signal?: AbortSignal | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MESSAGE_LIMIT = 300;

/** Any 2xx is success: servers answer 201 or 204 where 200 might be expected. */
export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

export class HttpClient {
  readonly #options: HttpClientOptions;
  readonly #server: string;

  constructor(options: HttpClientOptions) {
    this.#options = options;
    this.#server = options.context?.server ?? new URL(options.baseUrl).host;
  }

  get<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  post<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('POST', path, options);
  }

  put<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', path, options);
  }

  patch<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', path, options);
  }

  delete<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }

  /**
   * Sends a request and resolves with the parsed body of any 2xx response.
   * Everything else is thrown as a {@link CliError}: 401/403/404 are translated
   * into messages with likely causes and next steps, and transport failures
   * become network errors. Requests are never retried, except once after a 401
   * when the auth provider can renew its credentials.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = this.#buildUrl(path, options.query);
    let response = await this.#send(method, url, options);

    if (response.status === 401 && this.#options.auth?.refresh !== undefined) {
      if (await this.#options.auth.refresh()) {
        response = await this.#send(method, url, options);
      }
    }

    if (!isSuccess(response.status)) {
      throw translateHttpError({
        status: response.status,
        server: this.#server,
        resource: options.resource,
        reauth: this.#options.context?.reauth,
        serverMessage: extractServerMessage(response.data),
        retryAfter: response.headers.get('retry-after') ?? undefined,
        method,
        path,
      });
    }
    return response as HttpResponse<T>;
  }

  #buildUrl(path: string, query: RequestOptions['query']): URL {
    const url = new URL(`${this.#options.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? (value as QueryValue[]) : [value as QueryValue]) {
        if (item !== undefined) url.searchParams.append(name, String(item));
      }
    }
    return url;
  }

  async #send(method: string, url: URL, options: RequestOptions): Promise<HttpResponse<unknown>> {
    const headers = new Headers({ Accept: 'application/json', ...options.headers });
    if (this.#options.userAgent !== undefined) headers.set('User-Agent', this.#options.userAgent);
    if (this.#options.auth !== undefined) {
      headers.set('Authorization', await this.#options.auth.authorization());
    }

    let body: string | undefined;
    if (options.form !== undefined) {
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
      body = new URLSearchParams(options.form).toString();
    } else if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal =
      this.#options.signal === undefined
        ? timeout
        : AbortSignal.any([timeout, this.#options.signal]);

    try {
      const response = await this.#options.fetch(url, {
        method,
        headers,
        signal,
        ...(body === undefined ? {} : { body }),
      });
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        data: parseBody(response.headers, text),
      };
    } catch (error) {
      if (this.#options.signal?.aborted === true) {
        throw new CliError('cancelled', 'Cancelled.', { cause: error });
      }
      throw describeNetworkError(error, this.#server, timeout.aborted ? timeoutMs : undefined);
    }
  }
}

function parseBody(headers: Headers, text: string): unknown {
  if (text === '') return undefined;
  const contentType = headers.get('content-type') ?? '';
  if (/\bjson\b/i.test(contentType)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/** Pulls the human-readable message out of the error bodies servers commonly send. */
export function extractServerMessage(data: unknown): string | undefined {
  const message = findMessage(data);
  if (message === undefined) return undefined;
  const compact = message.replace(/\s+/g, ' ').trim();
  if (compact === '') return undefined;
  return compact.length > MESSAGE_LIMIT ? `${compact.slice(0, MESSAGE_LIMIT - 1)}…` : compact;
}

function findMessage(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return /^\s*</.test(data) ? undefined : data;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ['message', 'error_description', 'errorMessage', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  for (const key of ['errorMessages', 'errors']) {
    const value = record[key];
    if (Array.isArray(value) && value.length > 0) {
      const parts = (value as unknown[])
        .map((item) => findMessage(item))
        .filter((part) => part !== undefined);
      if (parts.length > 0) return parts.join('; ');
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const parts = Object.entries(value as Record<string, unknown>)
        .map(([field, item]) => (typeof item === 'string' ? `${field}: ${item}` : undefined))
        .filter((part) => part !== undefined);
      if (parts.length > 0) return parts.join('; ');
    }
  }
  return undefined;
}

export interface TranslateInput {
  readonly status: number;
  readonly server: string;
  readonly resource?: string | undefined;
  readonly reauth?: readonly string[] | undefined;
  readonly serverMessage?: string | undefined;
  readonly retryAfter?: string | undefined;
  readonly method?: string | undefined;
  readonly path?: string | undefined;
}

/**
 * Turns an unsuccessful HTTP status into an error that says what probably went
 * wrong and what to do next. The message never contains request headers or the
 * query string, so it is safe to log.
 */
export function translateHttpError(input: TranslateInput): CliError {
  const { status, server, resource, serverMessage } = input;
  const suffix = serverMessage === undefined ? '' : ` Server message: "${serverMessage}"`;
  const details = {
    status,
    server,
    ...(input.method === undefined || input.path === undefined
      ? {}
      : { request: `${input.method} ${input.path}` }),
    ...(serverMessage === undefined ? {} : { serverMessage }),
  };

  if (status === 401) {
    return new CliError('auth', `${server} rejected the credentials (HTTP 401).${suffix}`, {
      code: 'unauthorized',
      status,
      details,
      causes: [
        'The token or password is wrong, expired or revoked.',
        'The credentials were issued by a different server than the one being called.',
      ],
      next: [
        ...(input.reauth ?? ['Sign in again.']),
        'Check that the configured server address is the one that issued the credentials.',
      ],
    });
  }
  if (status === 403) {
    return new CliError(
      'permission',
      `${server} denied access${resource === undefined ? '' : ` to ${resource}`} (HTTP 403).${suffix}`,
      {
        code: 'forbidden',
        status,
        details,
        causes: [
          'The signed-in account lacks the required role or permission on this resource.',
          'The token is missing a required scope.',
          'A server-side rule blocks the action, such as a protected or archived resource.',
        ],
        next: [
          'Ask an owner or administrator of the resource for access.',
          'Sign in with a token that has the required scopes.',
          'Confirm that you are signed in as the intended account.',
        ],
      },
    );
  }
  if (status === 404) {
    return new CliError(
      'not-found',
      `${server} could not find ${resource ?? 'the requested resource'} (HTTP 404).${suffix}`,
      {
        code: 'not_found',
        status,
        details,
        causes: [
          'An identifier, key or name in the command is misspelled.',
          'The resource was deleted, renamed or moved.',
          'The account cannot see it; some servers answer 404 instead of 403 for private resources.',
          'The configured server address points to a different instance or base path.',
        ],
        next: [
          'Check the spelling of the identifiers in the command.',
          'Confirm that the signed-in account can open the resource in the web interface.',
          'Confirm the configured server address.',
        ],
      },
    );
  }
  if (status === 429) {
    const wait = input.retryAfter === undefined ? 'a moment' : `${input.retryAfter} (Retry-After)`;
    return new CliError('server', `${server} is rate limiting requests (HTTP 429).${suffix}`, {
      code: 'rate_limited',
      status,
      details,
      next: [`Wait ${wait} and retry.`],
    });
  }
  if (status >= 500) {
    return new CliError(
      'server',
      `${server} reported an internal error (HTTP ${status}).${suffix}`,
      {
        code: 'server_error',
        status,
        details,
        causes: ['A temporary fault or maintenance window on the server.'],
        next: [
          'Retry in a moment.',
          'If it persists, check the server status or contact its administrator.',
        ],
      },
    );
  }
  return new CliError('server', `${server} rejected the request (HTTP ${status}).${suffix}`, {
    code: 'request_rejected',
    status,
    details,
    causes: [
      'A value in the request is invalid or conflicts with the current state of the resource.',
    ],
    next: ['Correct the value named in the server message and run the command again.'],
  });
}

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const NETWORK_REASONS: Readonly<Record<string, string>> = {
  ENOTFOUND: 'the host name could not be resolved',
  EAI_AGAIN: 'the host name could not be resolved',
  ECONNREFUSED: 'the connection was refused',
  ECONNRESET: 'the connection was reset',
  ETIMEDOUT: 'the connection timed out',
  EHOSTUNREACH: 'the host is unreachable',
  ENETUNREACH: 'the network is unreachable',
};

/**
 * Describes a failure that happened before any HTTP response arrived.
 * Pass `timeoutMs` when the request was aborted by its timeout.
 */
export function describeNetworkError(error: unknown, server: string, timeoutMs?: number): CliError {
  if (timeoutMs !== undefined) {
    return new CliError(
      'network',
      `The request to ${server} timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      {
        code: 'timeout',
        causes: [
          'The server is slow or overloaded.',
          'A proxy or firewall is dropping the connection.',
        ],
        next: ['Retry in a moment.', 'Check your network connection and the server address.'],
        cause: error,
      },
    );
  }

  const code = errorCode(error);
  if (code !== undefined && TLS_ERROR_CODES.has(code)) {
    return new CliError(
      'network',
      `Could not establish a trusted TLS connection to ${server} (${code}).`,
      {
        code: 'tls_error',
        causes: [
          'The server certificate is signed by an authority this machine does not trust, such as a private CA.',
          'The certificate has expired or does not match the host name.',
        ],
        next: [
          'If the server uses a private CA, point NODE_EXTRA_CA_CERTS at the CA certificate file.',
          'Check the server address for typos.',
        ],
        cause: error,
      },
    );
  }

  const reason = code === undefined ? undefined : NETWORK_REASONS[code];
  return new CliError(
    'network',
    `Could not reach ${server}${reason === undefined ? '' : `: ${reason}`}${code === undefined ? '' : ` (${code})`}.`,
    {
      code: 'unreachable',
      causes: [
        'The server address is misspelled or the server is down.',
        'You are offline, or a VPN or proxy is required to reach the server.',
      ],
      next: ['Check the server address and your network connection.', 'Retry in a moment.'],
      cause: error,
    },
  );
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
