import { CliError, defineCommand, defineGroup } from '@sdlc-tools/core';
import { markdownToAdf } from '../adf/markdown.js';
import { connect, connectionOptions } from '../connection.js';
import { parseIssueKey, readText } from '../input.js';
import { commentViews, renderComments } from '../render.js';

const keyArg = { name: 'key', description: 'Issue key, such as ABC-123', required: true } as const;

const add = defineCommand({
  name: 'add',
  summary: 'Add a comment',
  positionals: [keyArg, { name: 'body', description: 'Comment in Markdown (or use --body-file)' }],
  options: {
    ...connectionOptions,
    bodyFile: {
      type: 'string',
      valueName: 'path',
      description: 'Read the comment from a Markdown file',
    },
  },
  examples: ['sdlc-jira issue comment add ABC-123 "Fixed in the **next** build"'],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const body = await readText(context, {
      inline: args.body,
      file: options.bodyFile,
      label: 'comment',
      inlineFlag: 'the body argument',
      fileFlag: '--body-file',
    });
    if (body === undefined) {
      throw new CliError('usage', 'Missing the comment text.', {
        code: 'missing_option',
        next: ['Pass the comment as an argument, or use --body-file <path>.'],
      });
    }
    const { client } = await connect(context, options);
    const { id } = await client.addComment(key, markdownToAdf(body));
    return {
      data: { key, id, url: client.browseUrl(key) },
      text: `Added comment ${id} to ${key}.`,
    };
  },
});

const list = defineCommand({
  name: 'list',
  summary: 'List the latest comments',
  positionals: [keyArg],
  options: {
    ...connectionOptions,
    limit: {
      type: 'string',
      valueName: 'count',
      default: '10',
      description: 'How many of the latest comments',
    },
  },
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new CliError(
        'usage',
        `--limit must be a whole number from 1 to 100, not "${options.limit}".`,
        {
          code: 'invalid_number',
        },
      );
    }
    const { client } = await connect(context, options);
    const { comments, total } = await client.listComments(key, limit);
    const chronological = [...comments].reverse();
    return {
      data: { key, total, comments },
      text:
        comments.length === 0
          ? `${key} has no comments.`
          : `${renderComments(commentViews(chronological))}\n\n${comments.length} of ${total} comment${total === 1 ? '' : 's'}`,
    };
  },
});

export const comment = defineGroup({
  name: 'comment',
  summary: 'Add or read comments on an issue',
  commands: [add, list],
});
