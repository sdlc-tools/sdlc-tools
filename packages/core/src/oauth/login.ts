import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandContext } from '../command.js';
import { CliError } from '../errors.js';
import type { Runtime } from '../runtime.js';
import { computeCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';
import { exchangeAuthorizationCode, type OAuthClient, type OAuthTokens } from './tokens.js';

export interface PkceLoginOptions {
  readonly client: OAuthClient & { readonly authorizationEndpoint: string };
  readonly scopes?: readonly string[];
  /**
   * Fixed loopback port. Leave unset to let the OS pick a free one; set it when
   * the server only accepts redirect addresses that were registered exactly.
   */
  readonly port?: number;
  /** Path of the redirect address; `/callback` by default. */
  readonly callbackPath?: string;
  /**
   * Send a PKCE challenge and prove the verifier (RFC 7636); `true` by default.
   * Set `false` for a confidential client of a server that does not document
   * PKCE: it authenticates with `client.clientSecret` instead, and the
   * authorization request then carries no `code_challenge`.
   */
  readonly pkce?: boolean;
  /** How long to wait for the browser; five minutes by default. */
  readonly timeoutMs?: number;
  /** Extra authorization request parameters, such as `prompt`. */
  readonly extraParams?: Readonly<Record<string, string>>;
  /**
   * What a browser page that never calls back usually means on this server and
   * how to fix it. Printed while waiting and named as the cause of a timeout.
   */
  readonly stallHint?: string;
}

export type LoginRuntime = Pick<Runtime, 'fetch' | 'now' | 'signal' | 'openUrl'> &
  Pick<CommandContext, 'log'>;

/** RFC 8252 §7.3: the loopback interface is addressed by IP literal, never by the name `localhost`. */
const LOOPBACK_ADDRESS = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  Connection: 'close',
} as const;

function page(title: string, detail: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>${title}</title>` +
    '<style>body{font:16px system-ui,sans-serif;margin:4rem auto;max-width:32rem;padding:0 1rem}</style>' +
    `</head><body><h1>${title}</h1><p>${detail}</p></body></html>`
  );
}

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, PAGE_HEADERS);
  response.end(body);
}

function sameState(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface CallbackListener {
  readonly redirectUri: string;
  readonly code: Promise<string>;
  close(): void;
}

function listenForCallback(options: {
  readonly port: number;
  readonly path: string;
  readonly state: string;
  readonly timeoutMs: number;
  readonly stallHint: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly log: (message: string) => void;
}): Promise<CallbackListener> {
  const { path, state } = options;
  let settle: { resolve(code: string): void; reject(error: CliError): void };
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // The caller always awaits `code`, but a rejection that lands before then must not be reported as unhandled.
  code.catch(() => undefined);

  let expectedHost = '';
  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    // A browser reaching this server through another host name means DNS rebinding.
    if (request.headers.host !== expectedHost) {
      respond(
        response,
        421,
        page('Misdirected request', 'This address only accepts local sign-in callbacks.'),
      );
      return;
    }
    if (request.method !== 'GET') {
      respond(response, 405, page('Method not allowed', 'Only GET is accepted here.'));
      return;
    }
    const url = new URL(request.url ?? '/', `http://${expectedHost}`);
    if (url.pathname !== path) {
      respond(response, 404, page('Not found', 'Nothing is served at this address.'));
      return;
    }
    if (!sameState(url.searchParams.get('state'), state)) {
      options.log('Ignored a sign-in callback with an unexpected state value.');
      respond(
        response,
        400,
        page(
          'Sign-in not completed',
          'This request did not belong to the sign-in in progress. Return to the terminal.',
        ),
      );
      return;
    }

    const error = url.searchParams.get('error');
    const authorizationCode = url.searchParams.get('code');
    if (error !== null) {
      respond(
        response,
        400,
        page('Sign-in was not completed', 'Return to the terminal for details.'),
      );
      const description = url.searchParams.get('error_description');
      settle.reject(
        new CliError(
          'auth',
          `The server did not authorize the sign-in: ${description ?? error} (${error}).`,
          {
            code: error === 'access_denied' ? 'login_denied' : `oauth_${error}`,
            details: { oauthError: error },
            next: ['Run the sign-in command again and approve the request in the browser.'],
          },
        ),
      );
      return;
    }
    if (authorizationCode === null || authorizationCode === '') {
      respond(
        response,
        400,
        page('Sign-in not completed', 'The response carried no authorization code.'),
      );
      return;
    }
    respond(
      response,
      200,
      page('Signed in', 'You can close this window and return to the terminal.'),
    );
    settle.resolve(authorizationCode);
  };

  const server: Server = createServer(handle);
  let timer: NodeJS.Timeout | undefined;
  const onAbort = (): void => {
    settle.reject(new CliError('cancelled', 'Cancelled.'));
  };

  const close = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    server.close();
    server.closeIdleConnections();
    // Responses carry `Connection: close`, so sockets end by themselves once the
    // page is delivered; this only reaps a client that stalls.
    setTimeout(() => {
      server.closeAllConnections();
    }, 1000).unref();
  };

  return new Promise<CallbackListener>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      close();
      reject(
        error.code === 'EADDRINUSE'
          ? new CliError(
              'auth',
              `Port ${options.port} is already in use, so the sign-in callback cannot listen on it.`,
              {
                code: 'login_port_in_use',
                next: ['Stop the program using that port, or choose a different callback port.'],
                cause: error,
              },
            )
          : new CliError(
              'auth',
              `Could not start the local sign-in callback listener: ${error.message}`,
              {
                code: 'login_listener_failed',
                cause: error,
              },
            ),
      );
    });

    server.listen({ port: options.port, host: LOOPBACK_ADDRESS, exclusive: true }, () => {
      const { port } = server.address() as AddressInfo;
      expectedHost = `${LOOPBACK_ADDRESS}:${port}`;

      timer = setTimeout(() => {
        settle.reject(
          new CliError(
            'auth',
            `Sign-in timed out after ${Math.round(options.timeoutMs / 1000)} seconds.`,
            {
              code: 'login_timeout',
              ...(options.stallHint === undefined ? {} : { causes: [options.stallHint] }),
              next: ['Run the sign-in command again and finish the sign-in in the browser.'],
            },
          ),
        );
      }, options.timeoutMs);

      if (options.signal?.aborted === true) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });

      resolve({ redirectUri: `http://${expectedHost}${path}`, code, close });
    });
  });
}

/**
 * Signs in with the OAuth 2.0 authorization code grant and PKCE (RFC 6749 §4.1,
 * RFC 7636) using a loopback redirect (RFC 8252 §7.3):
 *
 * 1. listens on 127.0.0.1 for one callback and prints the authorization URL
 *    while trying to open it in the browser;
 * 2. accepts only a callback whose `state` matches, so stray or forged requests
 *    are answered with 400 and ignored;
 * 3. exchanges the code, proving possession of the PKCE verifier (and the
 *    client secret, when the client has one).
 *
 * The listener is closed on every outcome: success, denial, timeout and cancel.
 */
export async function loginWithPkce(
  runtime: LoginRuntime,
  options: PkceLoginOptions,
): Promise<OAuthTokens> {
  const verifier = options.pkce === false ? undefined : generateCodeVerifier();
  const state = generateState();

  const listener = await listenForCallback({
    port: options.port ?? 0,
    path: options.callbackPath ?? '/callback',
    state,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stallHint: options.stallHint,
    signal: runtime.signal,
    log: runtime.log,
  });

  try {
    const authorizationUrl = buildAuthorizationUrl(options, {
      redirectUri: listener.redirectUri,
      state,
      ...(verifier === undefined ? {} : { codeChallenge: computeCodeChallenge(verifier) }),
    });

    runtime.log(`Open this address in your browser to sign in:\n\n  ${authorizationUrl}\n`);
    runtime.openUrl(authorizationUrl).catch(() => {
      runtime.log('Could not open a browser automatically; open the address above yourself.');
    });
    runtime.log('Waiting for the sign-in to finish...');
    if (options.stallHint !== undefined) runtime.log(options.stallHint);

    const code = await listener.code;
    return await exchangeAuthorizationCode(runtime, options.client, {
      code,
      redirectUri: listener.redirectUri,
      codeVerifier: verifier,
    });
  } finally {
    listener.close();
  }
}

export function buildAuthorizationUrl(
  options: PkceLoginOptions,
  request: {
    readonly redirectUri: string;
    readonly state: string;
    readonly codeChallenge?: string | undefined;
  },
): string {
  const url = new URL(options.client.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.client.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('state', request.state);
  if (request.codeChallenge !== undefined) {
    url.searchParams.set('code_challenge', request.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (options.scopes !== undefined && options.scopes.length > 0) {
    url.searchParams.set('scope', options.scopes.join(' '));
  }
  for (const [name, value] of Object.entries(options.extraParams ?? {})) {
    url.searchParams.set(name, value);
  }
  return url.href;
}
