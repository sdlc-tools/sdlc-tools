import { CliError, defineCommand } from '@sdlc-tools/core';
import {
  connect,
  connectionOptions,
  loadJiraConfig,
  resolveProject,
  type FieldAlias,
} from '../connection.js';
import { readAliasedFields } from '../fields.js';
import { parseIssueKey } from '../input.js';
import { renderIssue, renderIssueRows } from '../render.js';
import { resolveAssignee } from '../users.js';

function parseCount(raw: string, flag: string, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new CliError('usage', `${flag} must be a whole number from 1 to ${max}, not "${raw}".`, {
      code: 'invalid_number',
    });
  }
  return value;
}

export const view = defineCommand({
  name: 'view',
  summary: 'Show an issue',
  description:
    'Prints the key, summary, status, people, linked issues, the fields configured under "jira.fields", the description and the latest comments. --json prints the issue as the API returns it, with every field, plus its browse url and the configured fields under "aliases".',
  positionals: [{ name: 'key', description: 'Issue key, such as ABC-123', required: true }],
  options: {
    ...connectionOptions,
    comments: {
      type: 'string',
      valueName: 'count',
      default: '5',
      description: 'How many of the latest comments to print',
    },
  },
  examples: ['sdlc-jira issue view ABC-123', 'sdlc-jira issue view ABC-123 --json'],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const commentLimit = parseCount(options.comments, '--comments', 100);
    const { fields: aliases } = await loadJiraConfig(context);
    const { client } = await connect(context, options);
    const issue = await client.getIssue(key, ['*all']);
    const url = client.browseUrl(issue.key);
    const aliased = readAliasedFields(aliases, issue.fields);
    return {
      data: {
        ...issue,
        url,
        aliases: Object.fromEntries(aliased.map(({ alias, value }) => [alias, value])),
      },
      text: renderIssue(issue, url, commentLimit, aliased),
    };
  },
});

const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const LIST_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'priority', 'updated'];

export const list = defineCommand({
  name: 'list',
  summary: 'Search issues with JQL or filters',
  description:
    'Give a JQL query with --jql, or combine filters. Filters need a project (--project, SDLC_JIRA_PROJECT or "project" in the configuration) unless --assignee is given.',
  options: {
    ...connectionOptions,
    jql: {
      type: 'string',
      valueName: 'query',
      description: 'A JQL query; cannot be combined with filters',
    },
    project: {
      type: 'string',
      valueName: 'key',
      description: 'Project key (or SDLC_JIRA_PROJECT)',
    },
    assignee: {
      type: 'string',
      valueName: 'who',
      description: '"me", "none", an account id, or a name or e-mail',
    },
    status: {
      type: 'string',
      valueName: 'name',
      multiple: true,
      description: 'Status name',
    },
    type: {
      type: 'string',
      valueName: 'name',
      multiple: true,
      description: 'Issue type',
    },
    label: {
      type: 'string',
      valueName: 'name',
      multiple: true,
      description: 'Label (all must match)',
    },
    limit: {
      type: 'string',
      valueName: 'count',
      default: '25',
      description: 'Maximum number of issues',
    },
    fields: {
      type: 'string',
      valueName: 'list',
      description: 'Comma-separated extra field ids or configured aliases to include in the result',
    },
  },
  examples: [
    'sdlc-jira issue list --assignee me --status "In Progress"',
    'sdlc-jira issue list --jql "project = ABC AND updated >= -7d ORDER BY updated DESC"',
  ],
  async run({ options }, context) {
    const limit = parseCount(options.limit, '--limit', 1000);
    const filtered =
      options.project !== undefined ||
      options.assignee !== undefined ||
      options.status.length > 0 ||
      options.type.length > 0 ||
      options.label.length > 0;
    if (options.jql !== undefined && filtered) {
      throw new CliError(
        'usage',
        '--jql cannot be combined with --project or the filter options.',
        {
          code: 'conflicting_options',
          next: ['Put the conditions in the JQL, or drop --jql and use the filters.'],
        },
      );
    }
    if (options.jql?.trim() === '') {
      throw new CliError('usage', '--jql must not be empty.', { code: 'empty_text' });
    }
    const requested = (options.fields ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter((field) => field !== '');
    const aliases =
      requested.length === 0
        ? new Map<string, FieldAlias>()
        : (await loadJiraConfig(context)).fields;
    const extra = requested.map((field) => aliases.get(field.toLowerCase())?.id ?? field);

    const { client } = await connect(context, options);

    let jql = options.jql;
    if (jql === undefined) {
      const project = await resolveProject(
        context,
        options.project,
        options.assignee === undefined,
      );
      const conditions: string[] = [];
      if (project !== undefined) conditions.push(`project = ${quote(project)}`);
      if (options.assignee !== undefined) {
        const who = await resolveAssignee(client, options.assignee, {});
        conditions.push(who === null ? 'assignee is EMPTY' : `assignee = ${quote(who)}`);
      }
      if (options.status.length > 0)
        conditions.push(`status in (${options.status.map(quote).join(', ')})`);
      if (options.type.length > 0)
        conditions.push(`issuetype in (${options.type.map(quote).join(', ')})`);
      for (const label of options.label) conditions.push(`labels = ${quote(label)}`);
      jql = `${conditions.join(' AND ')} ORDER BY updated DESC`;
    }

    const { issues, hasMore } = await client.searchIssues(jql, [...LIST_FIELDS, ...extra], limit);
    const rows = issues.map((issue) => ({ ...issue, url: client.browseUrl(issue.key) }));
    const summary = `${issues.length} issue${issues.length === 1 ? '' : 's'}${hasMore ? `, more available: raise --limit above ${limit}` : ''}`;
    return {
      data: { jql, count: issues.length, hasMore, issues: rows },
      text: issues.length === 0 ? 'No issues found.' : `${renderIssueRows(issues)}\n\n${summary}`,
    };
  },
});
