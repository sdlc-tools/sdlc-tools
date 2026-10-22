import { CliError, defineCommand, defineGroup } from '@sdlc-tools/core';
import { markdownToAdf } from '../adf/markdown.js';
import type { JiraLinkType } from '../client.js';
import { connect, connectionOptions } from '../connection.js';
import { parseIssueKey, readText } from '../input.js';
import { table } from '../render.js';

const keyArg = { name: 'key', description: 'Issue key, such as ABC-123', required: true } as const;

interface LinkChoice {
  readonly type: JiraLinkType;
  /** `outward`: the first issue carries the outward phrase ("blocks"); `inward`: it carries the inward phrase. */
  readonly direction: 'outward' | 'inward';
}

function typeRows(types: readonly JiraLinkType[]): string {
  return table(types.map((type) => [type.name, type.outward, type.inward]));
}

/**
 * A link is named by its type ("Blocks") or by one of the type's phrases
 * ("is blocked by"). A type name takes the direction from --direction, outward
 * by default; a phrase fixes the direction itself.
 */
function chooseLink(
  types: readonly JiraLinkType[],
  wanted: string,
  direction: string | undefined,
): LinkChoice {
  const needle = wanted.trim().toLowerCase();
  const byName = types.filter((type) => type.name.toLowerCase() === needle);
  const phrases: LinkChoice[] = types.flatMap((type) => [
    ...(type.outward.toLowerCase() === needle ? [{ type, direction: 'outward' as const }] : []),
    ...(type.inward.toLowerCase() === needle ? [{ type, direction: 'inward' as const }] : []),
  ]);

  if (byName.length === 0 && phrases.length === 0) {
    throw new CliError('not-found', `This site has no issue link type "${wanted}".`, {
      code: 'unknown_link_type',
      next: [
        `Link types:\n${typeRows(types)}`,
        'Pass a type name or one of its phrases; list them with `sdlc-jira issue link types`.',
      ],
    });
  }
  if (byName.length === 1 && byName[0] !== undefined) {
    const forced = direction === undefined ? undefined : (direction as 'outward' | 'inward');
    return { type: byName[0], direction: forced ?? 'outward' };
  }
  if (direction !== undefined) {
    throw new CliError('usage', '--direction applies to a link type name, not to a phrase.', {
      code: 'conflicting_options',
      next: [`"${wanted}" already fixes the direction.`],
    });
  }
  const [only, second] = phrases;
  if (
    only !== undefined &&
    second !== undefined &&
    phrases.length === 2 &&
    only.type === second.type
  ) {
    return only;
  }
  if (phrases.length === 1 && only !== undefined) return only;
  throw new CliError('usage', `"${wanted}" matches more than one link type.`, {
    code: 'ambiguous_link_type',
    causes: [...byName, ...phrases.map(({ type }) => type)].map((type) => type.name),
    next: ['Pass the type name with --direction.'],
  });
}

const types = defineCommand({
  name: 'types',
  summary: 'List the issue link types of the site',
  description:
    'Each type has a name and two phrases, one for each end of a link: `issue link add ABC-1 Blocks ABC-2` makes ABC-1 "blocks" ABC-2 and ABC-2 "is blocked by" ABC-1.',
  options: connectionOptions,
  async run({ options }, context) {
    const { client } = await connect(context, options);
    const found = await client.listLinkTypes();
    return {
      data: { count: found.length, linkTypes: found },
      text: found.length === 0 ? 'This site has no issue link types.' : typeRows(found),
    };
  },
});

const add = defineCommand({
  name: 'add',
  summary: 'Link two issues',
  description:
    'The type is a link type name or one of its phrases, matched without regard to case. With a type name the first issue carries the outward phrase ("blocks"); --direction inward reverses that. A phrase such as "is blocked by" fixes the direction on its own.',
  positionals: [
    keyArg,
    { name: 'type', description: 'Link type name or phrase, such as Relates', required: true },
    { name: 'target', description: 'The other issue key', required: true },
  ],
  options: {
    ...connectionOptions,
    direction: {
      type: 'string',
      valueName: 'outward|inward',
      description: 'Which phrase the first issue carries when the type is given by name',
    },
    comment: {
      type: 'string',
      valueName: 'markdown',
      description: 'Add a comment with the link',
    },
  },
  examples: [
    'sdlc-jira issue link add ABC-1 Relates ABC-2',
    'sdlc-jira issue link add ABC-1 Blocks ABC-2',
    'sdlc-jira issue link add ABC-1 "is blocked by" ABC-2',
  ],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const target = parseIssueKey(args.target);
    if (key === target) {
      throw new CliError('usage', `${key} cannot be linked to itself.`, { code: 'invalid_link' });
    }
    if (
      options.direction !== undefined &&
      options.direction !== 'outward' &&
      options.direction !== 'inward'
    ) {
      throw new CliError(
        'usage',
        `--direction must be outward or inward, not "${options.direction}".`,
        {
          code: 'invalid_direction',
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

    const { client } = await connect(context, options);
    const { type, direction } = chooseLink(
      await client.listLinkTypes(),
      args.type,
      options.direction,
    );
    const [outward, inward] = direction === 'outward' ? [key, target] : [target, key];
    await client.linkIssues({
      type: type.name,
      outward,
      inward,
      ...(comment === undefined ? {} : { comment: markdownToAdf(comment) }),
    });
    const phrase = direction === 'outward' ? type.outward : type.inward;
    return {
      data: { key, target, type: type.name, direction, outward, inward },
      text: `${key} ${phrase} ${target}`,
    };
  },
});

export const link = defineGroup({
  name: 'link',
  summary: 'Link issues to each other',
  commands: [add, types],
});
