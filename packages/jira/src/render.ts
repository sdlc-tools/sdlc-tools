import { adfToText } from './adf/text.js';
import type { JiraIssue } from './client.js';
import type { AliasedValue } from './fields.js';

type Fields = Readonly<Record<string, unknown>>;

function record(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}

function nameOf(value: unknown, key = 'name'): string | undefined {
  const found = record(value)?.[key];
  return typeof found === 'string' && found !== '' ? found : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function summaryOf(issue: JiraIssue): string {
  return text(issue.fields.summary) ?? '';
}

export function statusOf(issue: JiraIssue): string {
  return nameOf(issue.fields.status) ?? '';
}

export function assigneeOf(issue: JiraIssue): string {
  return nameOf(issue.fields.assignee, 'displayName') ?? 'Unassigned';
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/** Aligned columns for terminals; the last column is left unpadded. */
export function table(rows: readonly (readonly string[])[]): string {
  const widths = rows.reduce<number[]>((acc, row) => {
    row.forEach((cell, column) => {
      acc[column] = Math.max(acc[column] ?? 0, cell.length);
    });
    return acc;
  }, []);
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : pad(cell, widths[column] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function renderIssueRows(issues: readonly JiraIssue[]): string {
  return table(
    issues.map((issue) => [issue.key, statusOf(issue), assigneeOf(issue), summaryOf(issue)]),
  );
}

function indentBlock(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line) => (line === '' ? '' : `${prefix}${line}`))
    .join('\n');
}

export interface CommentView {
  readonly author: string;
  readonly created: string;
  readonly body: string;
}

export function commentViews(comments: readonly unknown[]): CommentView[] {
  return comments.map((raw) => {
    const comment = record(raw) ?? {};
    return {
      author: nameOf(comment.author, 'displayName') ?? 'Unknown',
      created: text(comment.created) ?? '',
      body: adfToText(comment.body),
    };
  });
}

export function renderComments(views: readonly CommentView[]): string {
  return views
    .map((view) => `${view.author}  ${view.created}\n${indentBlock(view.body, '  ')}`)
    .join('\n\n');
}

/** One line per link, worded from this issue's side: "blocks ABC-2  Fix the build". */
function renderIssueLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    const link = record(entry);
    const type = record(link?.type);
    const outward = record(link?.outwardIssue);
    const other = outward ?? record(link?.inwardIssue);
    const phrase = text(outward === undefined ? type?.inward : type?.outward) ?? text(type?.name);
    const key = text(other?.key);
    if (phrase === undefined || key === undefined) return [];
    const summary = nameOf(other?.fields, 'summary');
    return [`${phrase} ${key}${summary === undefined ? '' : `  ${summary}`}`];
  });
}

/** The short rendering of `issue view`; the full issue is available with `--json`. */
export function renderIssue(
  issue: JiraIssue,
  url: string,
  commentLimit: number,
  aliased: readonly AliasedValue[] = [],
): string {
  const fields = issue.fields;
  const lines = [`${issue.key}  ${summaryOf(issue)}`];

  lines.push(
    [
      `Status: ${statusOf(issue)}`,
      `Type: ${nameOf(fields.issuetype) ?? '-'}`,
      `Priority: ${nameOf(fields.priority) ?? '-'}`,
    ].join('  '),
  );
  lines.push(
    `Assignee: ${assigneeOf(issue)}  Reporter: ${nameOf(fields.reporter, 'displayName') ?? '-'}`,
  );

  const labels = Array.isArray(fields.labels)
    ? fields.labels.filter((l) => typeof l === 'string')
    : [];
  const extras = [
    labels.length > 0 ? `Labels: ${labels.join(', ')}` : undefined,
    text(fields.duedate) === undefined ? undefined : `Due: ${text(fields.duedate)}`,
    text(fields.updated) === undefined ? undefined : `Updated: ${text(fields.updated)}`,
  ].filter((item) => item !== undefined);
  if (extras.length > 0) lines.push(extras.join('  '));

  const parent = record(fields.parent);
  if (parent !== undefined) {
    const parentSummary = nameOf(parent.fields, 'summary');
    lines.push(
      `Parent: ${text(parent.key) ?? ''}${parentSummary === undefined ? '' : `  ${parentSummary}`}`,
    );
  }
  const subtasks = Array.isArray(fields.subtasks) ? (fields.subtasks as unknown[]) : [];
  if (subtasks.length > 0) {
    lines.push('Subtasks:');
    for (const raw of subtasks) {
      const subtask = record(raw);
      lines.push(
        `  ${text(subtask?.key) ?? ''}  ${nameOf(subtask?.fields, 'summary') ?? ''}`.trimEnd(),
      );
    }
  }
  const links = renderIssueLinks(fields.issuelinks);
  if (links.length > 0) lines.push('Links:', ...links.map((line) => `  ${line}`));
  const present = aliased.filter(({ value }) => value !== null);
  if (present.length > 0) {
    lines.push('Fields:', ...present.map(({ alias, text }) => `  ${alias}: ${text}`));
  }
  lines.push(url);

  const description = adfToText(fields.description);
  if (description !== '') lines.push('', description);

  const comments = record(fields.comment)?.comments;
  if (Array.isArray(comments) && comments.length > 0) {
    const shown = comments.slice(-commentLimit);
    lines.push(
      '',
      `Comments (${shown.length === comments.length ? shown.length : `last ${shown.length} of ${comments.length}`}):`,
      renderComments(commentViews(shown)),
    );
  }
  return lines.join('\n');
}
