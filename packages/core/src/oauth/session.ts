import { CliError } from '../errors.js';
import type { AuthProvider } from '../http.js';
import type { Runtime } from '../runtime.js';
import type { CredentialTarget } from '../credentials/account.js';
import { loadStoredCredential, saveCredential } from '../credentials/resolve.js';
import type { OAuthCredential } from '../credentials/stored.js';
import { oauthErrorCode, refreshAccessToken, type OAuthClient } from './tokens.js';

export interface OAuthSessionOptions {
  readonly runtime: Pick<Runtime, 'fetch' | 'now' | 'signal' | 'store'>;
  readonly target: CredentialTarget;
  readonly client: OAuthClient;
  readonly credential: OAuthCredential;
  /** Renew this long before the recorded expiry; one minute by default. */
  readonly skewMs?: number;
  /** Command that signs in, quoted when the session cannot be renewed. */
  readonly loginCommand?: string;
}

const DEFAULT_SKEW_MS = 60_000;

/**
 * An {@link AuthProvider} for a stored OAuth credential. It renews the access
 * token shortly before it expires, and once more on demand after a 401, and
 * writes rotated tokens back to the credential store.
 *
 * Renewals in one process are single-flight. If another process rotates the
 * refresh token first, the refresh here fails with `invalid_grant`; the session
 * then adopts the newer credential from the store instead of failing.
 */
export class OAuthSession implements AuthProvider {
  readonly #options: OAuthSessionOptions;
  #credential: OAuthCredential;
  #renewal: Promise<void> | undefined;

  constructor(options: OAuthSessionOptions) {
    this.#options = options;
    this.#credential = options.credential;
  }

  get credential(): OAuthCredential {
    return this.#credential;
  }

  async authorization(): Promise<string> {
    const { expiresAt } = this.#credential;
    const skew = this.#options.skewMs ?? DEFAULT_SKEW_MS;
    if (expiresAt !== undefined && this.#options.runtime.now() >= expiresAt - skew) {
      if (this.#credential.refreshToken === undefined) {
        if (this.#options.runtime.now() >= expiresAt) throw this.#expired();
      } else {
        await this.#renew();
      }
    }
    const { accessToken, tokenType } = this.#credential;
    return `${/^bearer$/i.test(tokenType) ? 'Bearer' : tokenType} ${accessToken}`;
  }

  async refresh(): Promise<boolean> {
    if (this.#credential.refreshToken === undefined) return false;
    await this.#renew();
    return true;
  }

  #renew(): Promise<void> {
    this.#renewal ??= this.#performRenewal().finally(() => {
      this.#renewal = undefined;
    });
    return this.#renewal;
  }

  async #performRenewal(): Promise<void> {
    const { runtime, target, client } = this.#options;
    const used = this.#credential.refreshToken;
    if (used === undefined) throw this.#expired();

    let tokens;
    try {
      tokens = await refreshAccessToken(runtime, client, used);
    } catch (error) {
      if (oauthErrorCode(error) !== 'invalid_grant') throw error;
      const latest = await loadStoredCredential(runtime, target).catch(() => undefined);
      if (latest?.kind === 'oauth' && latest.refreshToken !== used) {
        this.#credential = latest;
        return;
      }
      throw new CliError('auth', 'Your session has expired and could not be renewed.', {
        code: 'refresh_failed',
        causes: ['The refresh token expired, was revoked, or was already used.'],
        next: this.#signInAgain(),
        cause: error,
      });
    }

    const renewed: OAuthCredential = {
      kind: 'oauth',
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      refreshToken: tokens.refreshToken ?? used,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope ?? this.#credential.scope,
    };
    this.#credential = renewed;
    await saveCredential(runtime, target, renewed);
  }

  #expired(): CliError {
    return new CliError('auth', 'The access token has expired and there is no refresh token.', {
      code: 'token_expired',
      next: this.#signInAgain(),
    });
  }

  #signInAgain(): string[] {
    const { loginCommand } = this.#options;
    return [
      loginCommand === undefined ? 'Sign in again.' : `Sign in again with \`${loginCommand}\`.`,
    ];
  }
}
