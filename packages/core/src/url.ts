import { CliError } from './errors.js';

export interface ServerUrl {
  /** Base URL without a trailing slash; keeps any path prefix such as `/gitea`. */
  readonly baseUrl: string;
  readonly origin: string;
  /** Host with port, suitable for messages. */
  readonly host: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates a user-supplied server address. Credentials are only ever sent over
 * https, except to a loopback host used for local development.
 */
export function normalizeServerUrl(raw: string, label = 'server address'): ServerUrl {
  const trimmed = raw.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch (cause) {
    throw new CliError('usage', `The ${label} "${raw}" is not a valid URL.`, {
      code: 'invalid_server_url',
      next: ['Use a full address such as "https://git.example.com".'],
      cause,
    });
  }

  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw new CliError(
      'usage',
      `The ${label} "${raw}" must use https; credentials are never sent over plain http.`,
      {
        code: 'insecure_server_url',
        next: ['Use an https:// address. Plain http is accepted only for localhost.'],
      },
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new CliError('usage', `The ${label} must not contain a user name or password.`, {
      code: 'credentials_in_url',
      next: ['Remove the credentials from the address and sign in with the auth command instead.'],
    });
  }
  if (url.search !== '' || url.hash !== '') {
    throw new CliError('usage', `The ${label} must not contain a query string or fragment.`, {
      code: 'invalid_server_url',
    });
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  return { baseUrl: `${url.origin}${pathname}`, origin: url.origin, host: url.host };
}

/**
 * Tagged template that percent-encodes every interpolated value as one path
 * segment, so user input can neither add segments nor traverse (`..`).
 *
 * @example urlPath`/repos/${owner}/${repo}/pulls/${number}`
 */
export function urlPath(
  strings: TemplateStringsArray,
  ...values: readonly (string | number)[]
): string {
  let result = strings[0] ?? '';
  values.forEach((value, index) => {
    const segment = String(value);
    if (segment === '' || segment === '.' || segment === '..') {
      throw new CliError('usage', `"${segment}" is not a valid value for a path segment.`, {
        code: 'invalid_path_segment',
      });
    }
    result += encodeURIComponent(segment) + (strings[index + 1] ?? '');
  });
  return result;
}

/**
 * Validates a TCP port given as a setting, such as a fixed sign-in callback port. Returns the
 * value unchanged so it can be used as a `SettingSpec.validate`.
 */
export function validatePort(value: string): string {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65_535) {
    throw new CliError('usage', `"${value}" is not a valid port number.`, {
      code: 'invalid_port',
      next: ['Use a number between 1 and 65535.'],
    });
  }
  return value;
}
