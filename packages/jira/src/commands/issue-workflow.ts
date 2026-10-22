import { CliError, defineCommand } from '@sdlc-tools/core';
import { markdownToAdf } from '../adf/markdown.js';
import type { JiraTransition } from '../client.js';
import { connect, connectionOptions } from '../connection.js';
import { parseFieldEntries, resolveFieldEntries } from '../fields.js';
import { parseIssueKey, readText } from '../input.js';
import { table } from '../render.js';
import { UNASSIGNED, resolveAssignee } from '../users.js';

const keyArg = { name: 'key', description: 'Issue key, such as ABC-123', required: true } as const;

function transitionRows(transitions: readonly JiraTransition[]): string {
  return table(
    transitions.map((transition) => [
      transition.id,
      transition.name,
      `-> ${transition.to?.name ?? '?'}`,
    ]),
  );
}

export const transitions = defineCommand({
  name: 'transitions',
  summary: 'List the transitions an issue can take now',
  positionals: [keyArg],
  options: connectionOptions,
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const { client } = await connect(context, options);
    const available = await client.listTransitions(key);
    return {
      data: { key, transitions: available },
      text:
        available.length === 0 ? `${key} has no transitions available.` : transitionRows(available),
    };
  },
});

/** Picks the one transition matching an id, a transition name or a target status name. */
function pickTransition(
  key: string,
  target: string,
  available: readonly JiraTransition[],
): JiraTransition {
  const wanted = target.trim().toLowerCase();
  const byId = available.filter((transition) => transition.id === target.trim());
  const byName = available.filter(
    (transition) =>
      transition.name.toLowerCase() === wanted || transition.to?.name.toLowerCase() === wanted,
  );
  const matches = byId.length > 0 ? byId : byName;
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;

  if (matches.length === 0) {
    throw new CliError('not-found', `${key} cannot move to "${target}" from its current status.`, {
      code: 'unknown_transition',
      causes: [
        'The workflow has no transition by that name or to that status from here.',
        'A condition or permission of the workflow hides the transition from this account.',
      ],
      next: [
        `Available now:\n${transitionRows(available)}`,
        `Run \`sdlc-jira issue transitions ${key}\` to list them, and pass a name or an id.`,
      ],
      details: { available: available.map((transition) => transition.id) },
    });
  }
  throw new CliError('usage', `"${target}" matches ${matches.length} transitions of ${key}.`, {
    code: 'ambiguous_transition',
    causes: matches.map(
      (transition) => `${transition.id}  ${transition.name} -> ${transition.to?.name ?? '?'}`,
    ),
    next: ['Pass the transition id.'],
  });
}

export const transition = defineCommand({
  name: 'transition',
  summary: 'Move an issue through its workflow',
  description:
    'The target is a transition id, a transition name or the name of the status it leads to, matched without regard to case. When the transition has required fields, set them with --field or --field-json.',
  positionals: [
    keyArg,
    { name: 'target', description: 'Transition id or name, or target status name', required: true },
  ],
  options: {
    ...connectionOptions,
    comment: {
      type: 'string',
      valueName: 'markdown',
      description: 'Add a comment with the transition',
    },
    field: {
      type: 'string',
      valueName: 'name=value',
      multiple: true,
      description: 'Field required by the transition',
    },
    fieldJson: {
      type: 'string',
      valueName: 'name=json',
      multiple: true,
      description: 'Field required by the transition, as JSON',
    },
  },
  examples: [
    'sdlc-jira issue transition ABC-123 "In Progress"',
    'sdlc-jira issue transition ABC-123 Done --field-json \'resolution={"name":"Done"}\'',
  ],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const comment = await readText(context, {
      inline: options.comment,
      file: undefined,
      label: 'comment',
      inlineFlag: '--comment',
      fileFlag: '--comment-file',
    });
    const entries = parseFieldEntries(options.field, options.fieldJson);

    const { client } = await connect(context, options);
    const chosen = pickTransition(key, args.target, await client.listTransitions(key));
    const fields = await resolveFieldEntries(context, client, entries);

    await client.transition(key, chosen.id, {
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
      ...(comment === undefined
        ? {}
        : { update: { comment: [{ add: { body: markdownToAdf(comment) } }] } }),
    });
    const status = chosen.to?.name ?? chosen.name;
    return {
      data: {
        key,
        transition: { id: chosen.id, name: chosen.name },
        status,
        url: client.browseUrl(key),
      },
      text: `${key} -> ${status}`,
    };
  },
});

export const assign = defineCommand({
  name: 'assign',
  summary: 'Assign an issue, or clear the assignee',
  positionals: [
    keyArg,
    {
      name: 'who',
      description: `"me", "${UNASSIGNED[0] ?? 'none'}" to clear, an account id, or a name or e-mail`,
      required: true,
    },
  ],
  options: connectionOptions,
  examples: ['sdlc-jira issue assign ABC-123 me', 'sdlc-jira issue assign ABC-123 none'],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const { client } = await connect(context, options);
    const accountId = await resolveAssignee(client, args.who, { issueKey: key });
    await client.assign(key, accountId);
    return {
      data: { key, accountId, url: client.browseUrl(key) },
      text: accountId === null ? `${key} is now unassigned.` : `${key} assigned to ${args.who}.`,
    };
  },
});
