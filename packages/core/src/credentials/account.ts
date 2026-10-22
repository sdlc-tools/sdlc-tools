import { CliError } from '../errors.js';

export const KEYCHAIN_SERVICE = 'sdlc-tools';
export const DEFAULT_PROFILE = 'default';

export interface CredentialTarget {
  /** Tool name such as `forgejo`; becomes part of the environment variable names too. */
  readonly tool: string;
  /** Origin the credential is valid for, such as `https://git.example.test`. */
  readonly origin: string;
  readonly profile?: string | undefined;
}

const TOOL_PATTERN = /^[a-z][a-z0-9-]*$/;
const PROFILE_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * The keychain account for a credential: `<tool>:<origin>`, plus `#<profile>`
 * for a non-default profile. Binding the origin into the account means a
 * credential is only ever offered to the server it was issued by.
 */
export function credentialAccount(target: CredentialTarget): string {
  if (!TOOL_PATTERN.test(target.tool)) {
    throw new Error(`Invalid tool name "${target.tool}".`);
  }
  const profile = target.profile ?? DEFAULT_PROFILE;
  if (!PROFILE_PATTERN.test(profile)) {
    throw new CliError('usage', `Invalid profile name "${profile}".`, {
      code: 'invalid_profile',
      next: ['Use letters, digits, ".", "_" and "-".'],
    });
  }
  const account = `${target.tool}:${target.origin}`;
  return profile === DEFAULT_PROFILE ? account : `${account}#${profile}`;
}

/** `SDLC_<TOOL>_<NAME>`, for example `toolEnvVar('forgejo', 'token')` is `SDLC_FORGEJO_TOKEN`. */
export function toolEnvVar(tool: string, name: string): string {
  return `SDLC_${tool}_${name}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}
