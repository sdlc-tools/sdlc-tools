import { CliError, defineCommand } from '@sdlc-tools/core';
import { markdownToAdf } from '../adf/markdown.js';
import type { JiraTransition } from '../client.js';
import { connect, connectionOptions, loadJiraConfig } from '../connection.js';
import { parseFieldEntries, resolveFieldEntries } from '../fields.js';
import { parseIssueKey, readText } from '../input.js';
import { statusOf, table } from '../render.js';
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

/** Where a `--to` request stands after reading the issue's current status. */
interface PathStep {
  readonly transition: JiraTransition;
  readonly status: string;
}

const same = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * Chooses the next transition toward `target`. A transition straight to the
 * target wins when no configured order is available. With an order, the next
 * hop is the available transition to the nearest status ahead of the current
 * one that does not pass the target, so each stage of the workflow is visited
 * in turn.
 */
function nextHop(
  current: string,
  target: string,
  order: readonly string[],
  available: readonly JiraTransition[],
): JiraTransition | undefined {
  const indexOf = (status: string): number => order.findIndex((name) => same(name, status));
  const from = indexOf(current);
  const goal = indexOf(target);
  const direct = available.filter(
    (candidate) => candidate.to !== undefined && same(candidate.to.name, target),
  );

  if (from === -1 || goal === -1 || goal <= from)
    return direct.length === 1 ? direct[0] : undefined;

  const ahead = available
    .map((candidate) => ({
      candidate,
      index: candidate.to === undefined ? -1 : indexOf(candidate.to.name),
    }))
    .filter(({ index }) => index > from && index <= goal)
    .sort((a, b) => a.index - b.index);
  return ahead[0]?.candidate;
}

function unreachable(
  key: string,
  target: string,
  current: string,
  walked: readonly string[],
  available: readonly JiraTransition[],
  order: readonly string[],
): CliError {
  const hint =
    order.length === 0
      ? 'List the workflow statuses in order under "jira.workflow" in the configuration so a target several steps away can be reached.'
      : `Check that "${target}" and "${current}" are both listed in "jira.workflow" and that the workflow offers a transition ahead of "${current}".`;
  return new CliError('not-found', `${key} cannot reach "${target}" from "${current}".`, {
    code: 'unreachable_status',
    causes: [
      walked.length > 0
        ? `Reached so far: ${walked.join(' -> ')}.`
        : 'No transition has been made.',
      'The workflow has no transition ahead toward that status, or a condition or permission hides it from this account.',
    ],
    next: [
      available.length === 0
        ? `${key} has no transitions available from "${current}".`
        : `Available from "${current}":\n${transitionRows(available)}`,
      hint,
    ],
    details: { current, target, walked, available: available.map((transition) => transition.id) },
  });
}

export const transition = defineCommand({
  name: 'transition',
  summary: 'Move an issue through its workflow',
  description: [
    'Name one transition as <target>: a transition id, a transition name or the name of the status it leads to, matched without regard to case.',
    'Or give --to <status> to reach a status that may be several transitions away: the statuses listed in order under "jira.workflow" in the configuration guide the path, and each step is made in turn after reading the issue\'s current status.',
    'Required fields (--field, --field-json) and --comment go with the last transition.',
  ].join(' '),
  positionals: [
    keyArg,
    {
      name: 'target',
      description: 'Transition id or name, or target status name (or use --to)',
      required: false,
    },
  ],
  options: {
    ...connectionOptions,
    to: {
      type: 'string',
      valueName: 'status',
      description: 'Reach this status, making every transition the workflow needs in order',
    },
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
    'sdlc-jira issue transition ABC-123 --to Done --field-json \'resolution={"name":"Done"}\'',
  ],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    if (args.target !== undefined && options.to !== undefined) {
      throw new CliError('usage', 'Give the target as <target> or with --to, not both.', {
        code: 'conflicting_options',
      });
    }
    const goal = options.to ?? args.target;
    if (goal === undefined || goal.trim() === '') {
      throw new CliError(
        'usage',
        'Missing the transition target: pass <target> or --to <status>.',
        {
          code: 'missing_target',
          next: [
            'Example: sdlc-jira issue transition ABC-123 "In Progress"',
            'Or reach a status several steps away: sdlc-jira issue transition ABC-123 --to Done',
          ],
        },
      );
    }
    const comment = await readText(context, {
      inline: options.comment,
      file: undefined,
      label: 'comment',
      inlineFlag: '--comment',
      fileFlag: '--comment-file',
    });
    const entries = parseFieldEntries(options.field, options.fieldJson);

    const { workflow } = await loadJiraConfig(context);
    const { client } = await connect(context, options);
    // Fields are resolved before the first transition so a bad one never leaves the issue half-way.
    const fields = await resolveFieldEntries(context, client, entries);
    const finish = (chosen: JiraTransition): Promise<void> =>
      client.transition(key, chosen.id, {
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
        ...(comment === undefined
          ? {}
          : { update: { comment: [{ add: { body: markdownToAdf(comment) } }] } }),
      });

    if (options.to === undefined) {
      const chosen = pickTransition(key, goal, await client.listTransitions(key));
      await finish(chosen);
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
    }

    // Each pass reads the status first, so a workflow that moves the issue on its own, or a transition that landed elsewhere, is seen as it is.
    const steps: PathStep[] = [];
    const startedAt = statusOf(await client.getIssue(key, ['status']));
    let current = startedAt;
    for (let pass = 0; pass <= workflow.length; pass += 1) {
      if (same(current, goal)) break;
      const available = await client.listTransitions(key);
      const hop = nextHop(current, goal, workflow, available);
      if (hop === undefined) {
        throw unreachable(
          key,
          goal,
          current,
          steps.map((step) => step.status),
          available,
          workflow,
        );
      }
      const last = hop.to !== undefined && same(hop.to.name, goal);
      if (last) await finish(hop);
      else await client.transition(key, hop.id, {});
      const reached = hop.to?.name ?? hop.name;
      steps.push({ transition: hop, status: reached });
      current = statusOf(await client.getIssue(key, ['status']));
      if (last && !same(current, goal)) break;
    }
    if (!same(current, goal)) {
      throw unreachable(
        key,
        goal,
        current,
        steps.map((step) => step.status),
        await client.listTransitions(key),
        workflow,
      );
    }
    const path = [startedAt, ...steps.map((step) => step.status)];
    return {
      data: {
        key,
        from: startedAt,
        status: current,
        steps: steps.map((step) => ({
          transition: { id: step.transition.id, name: step.transition.name },
          status: step.status,
        })),
        url: client.browseUrl(key),
      },
      text:
        steps.length === 0 ? `${key} is already in ${current}.` : `${key}: ${path.join(' -> ')}`,
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
