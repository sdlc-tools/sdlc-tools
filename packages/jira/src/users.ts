import { CliError } from '@sdlc-tools/core';
import type { JiraClient, JiraUser } from './client.js';

const ACCOUNT_ID = /^([0-9a-f]{24}|\d+:[0-9a-f-]{36})$/i;

export const UNASSIGNED = ['none', 'unassigned'];

function describeUser(user: JiraUser): string {
  return `${user.displayName}${user.emailAddress === undefined ? '' : ` <${user.emailAddress}>`} (${user.accountId})`;
}

/**
 * Resolves who an issue is assigned to: `me`, an account id, or a name or
 * e-mail address looked up on the site. `null` means unassigned. A lookup that
 * matches several people fails and lists them rather than guessing.
 */
export async function resolveAssignee(
  client: JiraClient,
  who: string,
  scope: { issueKey?: string; project?: string },
): Promise<string | null> {
  const value = who.trim();
  if (UNASSIGNED.includes(value.toLowerCase())) return null;
  if (value.toLowerCase() === 'me') return (await client.myself()).accountId;
  if (ACCOUNT_ID.test(value)) return value;

  const found = (await client.findUsers(value, scope)).filter((user) => user.active !== false);
  const exact = found.filter(
    (user) =>
      user.emailAddress?.toLowerCase() === value.toLowerCase() ||
      user.displayName.toLowerCase() === value.toLowerCase(),
  );
  const candidates = exact.length > 0 ? exact : found;
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) return only.accountId;
  if (candidates.length === 0) {
    throw new CliError('not-found', `No assignable user matches "${who}".`, {
      code: 'user_not_found',
      causes: [
        'The name or e-mail is spelled differently on this site.',
        'The user cannot be assigned in this project, or hides their e-mail address.',
      ],
      next: ['Try part of the display name, or pass the account id.'],
    });
  }
  throw new CliError('usage', `"${who}" matches ${candidates.length} users.`, {
    code: 'ambiguous_user',
    causes: candidates.slice(0, 10).map(describeUser),
    next: ['Pass the e-mail address or the account id of the one you mean.'],
  });
}
