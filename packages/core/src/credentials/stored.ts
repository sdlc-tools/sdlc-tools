export interface TokenCredential {
  readonly kind: 'token';
  /** A personal access token or API token. */
  readonly token: string;
  /** Paired identity for schemes that need one, such as an account e-mail for Basic auth. */
  readonly username?: string | undefined;
}

export interface OAuthCredential {
  readonly kind: 'oauth';
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken?: string | undefined;
  /** Milliseconds since the Unix epoch. */
  readonly expiresAt?: number | undefined;
  readonly scope?: string | undefined;
}

export type StoredCredential = TokenCredential | OAuthCredential;

const FORMAT_VERSION = 1;

export function serializeCredential(credential: StoredCredential): string {
  return JSON.stringify({ v: FORMAT_VERSION, ...credential });
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

/** Parses what {@link serializeCredential} wrote; `undefined` when the text is not a valid credential. */
export function parseCredential(text: string): StoredCredential | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.v !== FORMAT_VERSION) return undefined;

  if (record.kind === 'token') {
    const username = optionalString(record.username);
    if (typeof record.token !== 'string' || record.token === '' || username === null)
      return undefined;
    return { kind: 'token', token: record.token, ...(username === undefined ? {} : { username }) };
  }

  if (record.kind === 'oauth') {
    const refreshToken = optionalString(record.refreshToken);
    const scope = optionalString(record.scope);
    const expiresAt = record.expiresAt;
    if (
      typeof record.accessToken !== 'string' ||
      record.accessToken === '' ||
      typeof record.tokenType !== 'string' ||
      refreshToken === null ||
      scope === null ||
      (expiresAt !== undefined && typeof expiresAt !== 'number')
    ) {
      return undefined;
    }
    return {
      kind: 'oauth',
      accessToken: record.accessToken,
      tokenType: record.tokenType,
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(scope === undefined ? {} : { scope }),
    };
  }
  return undefined;
}
