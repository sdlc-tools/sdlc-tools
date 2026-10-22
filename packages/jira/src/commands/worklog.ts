import { defineCommand, defineGroup } from '@sdlc-tools/core';
import { markdownToAdf } from '../adf/markdown.js';
import { adfToText } from '../adf/text.js';
import { connect, connectionOptions } from '../connection.js';
import { parseDuration, parseIssueKey, parseStarted, readText } from '../input.js';
import { table } from '../render.js';

const keyArg = { name: 'key', description: 'Issue key, such as ABC-123', required: true } as const;

/** `2026-03-02T09:00:00.000+0900` as `2026-03-02 09:00+09:00`, so the offset the work was logged with stays visible. */
function showStarted(started: string | undefined): string {
  if (started === undefined) return '';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})\S*?([+-]\d{2}):?(\d{2})$/.exec(started);
  return match === null
    ? started.slice(0, 16).replace('T', ' ')
    : `${match[1]} ${match[2]}${match[3]}:${match[4]}`;
}

const add = defineCommand({
  name: 'add',
  summary: 'Log time spent on an issue',
  positionals: [
    keyArg,
    { name: 'time', description: 'Time spent, such as "30m", "2h" or "1d 4h"', required: true },
  ],
  options: {
    ...connectionOptions,
    started: {
      type: 'string',
      valueName: 'time',
      description:
        'When the work started, ISO 8601 with a UTC offset such as +09:00 or Z (default: now)',
    },
    comment: {
      type: 'string',
      valueName: 'markdown',
      description: 'Note about the work, in Markdown',
    },
  },
  examples: [
    'sdlc-jira issue worklog add ABC-123 2h --comment "Reviewed the migration"',
    'sdlc-jira issue worklog add ABC-123 "1d 2h" --started 2026-03-02T09:00:00+09:00',
  ],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const timeSpent = parseDuration(args.time, 'The time spent');
    const started = options.started === undefined ? undefined : parseStarted(options.started);
    const note = await readText(context, {
      inline: options.comment,
      file: undefined,
      label: 'comment',
      inlineFlag: '--comment',
      fileFlag: '--comment-file',
    });

    const { client } = await connect(context, options);
    const { id } = await client.addWorklog(key, {
      timeSpent,
      ...(started === undefined ? {} : { started }),
      ...(note === undefined ? {} : { comment: markdownToAdf(note) }),
    });
    return {
      data: { key, id, timeSpent, started: started ?? null, url: client.browseUrl(key) },
      text: `Logged ${timeSpent} on ${key} (worklog ${id}).`,
    };
  },
});

const list = defineCommand({
  name: 'list',
  summary: 'List the worklogs of an issue',
  positionals: [keyArg],
  options: connectionOptions,
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const { client } = await connect(context, options);
    const { worklogs, total } = await client.listWorklogs(key, 100);
    if (worklogs.length === 0)
      return { data: { key, total, worklogs }, text: `${key} has no worklogs.` };

    const seconds = worklogs.reduce((sum, worklog) => sum + (worklog.timeSpentSeconds ?? 0), 0);
    const hours = Math.round((seconds / 3600) * 100) / 100;
    const rows = worklogs.map((worklog) => [
      showStarted(worklog.started),
      worklog.timeSpent ?? '',
      worklog.author?.displayName ?? 'Unknown',
      adfToText(worklog.comment).replace(/\n+/g, ' '),
    ]);
    return {
      data: { key, total, totalSeconds: seconds, worklogs },
      text: `${table(rows)}\n\n${worklogs.length} of ${total} worklog${total === 1 ? '' : 's'}, ${hours}h logged in these`,
    };
  },
});

export const worklog = defineGroup({
  name: 'worklog',
  summary: 'Log or read time spent on an issue',
  commands: [add, list],
});
