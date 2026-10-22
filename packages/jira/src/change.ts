import { CliError, type CommandContext, type OptionMap } from '@sdlc-tools/core';
import { markdownToAdf } from './adf/markdown.js';
import type { JiraClient } from './client.js';
import { parseFieldEntries, resolveFieldEntries, type FieldEntry } from './fields.js';
import { parseDate, parseDuration, parseIssueKey, readText } from './input.js';

/** Options shared by `issue create` and `issue edit`. */
export const changeOptions = {
  summary: { type: 'string', valueName: 'text', description: 'Summary (the issue title)' },
  description: {
    type: 'string',
    valueName: 'markdown',
    description: 'Description in Markdown, converted to Atlassian Document Format',
  },
  descriptionFile: {
    type: 'string',
    valueName: 'path',
    description: 'Read the description from a Markdown file',
  },
  priority: { type: 'string', valueName: 'name', description: 'Priority name, such as High' },
  due: { type: 'string', valueName: 'YYYY-MM-DD', description: 'Due date' },
  estimate: {
    type: 'string',
    valueName: 'duration',
    description: 'Original time estimate, such as "2d 4h"',
  },
  label: {
    type: 'string',
    valueName: 'name',
    multiple: true,
    description: 'Label; on edit it replaces all labels',
  },
  parent: { type: 'string', valueName: 'key', description: 'Parent issue key (epic or story)' },
  field: {
    type: 'string',
    valueName: 'name=value',
    multiple: true,
    description: 'Set any field by alias, id or name; see `field list`',
  },
  fieldJson: {
    type: 'string',
    valueName: 'name=json',
    multiple: true,
    description: 'Set a field to a JSON value',
  },
} as const satisfies OptionMap;

export interface ChangeOptions {
  readonly summary: string | undefined;
  readonly description: string | undefined;
  readonly descriptionFile: string | undefined;
  readonly priority: string | undefined;
  readonly due: string | undefined;
  readonly estimate: string | undefined;
  readonly label: readonly string[];
  readonly parent: string | undefined;
  readonly field: readonly string[];
  readonly fieldJson: readonly string[];
}

export interface EditOnlyOptions {
  readonly clearDue: boolean;
  readonly addLabel: readonly string[];
  readonly removeLabel: readonly string[];
}

/** Everything a create or edit asks for, validated without touching the network. */
export interface Draft {
  readonly summary: string | undefined;
  readonly description: string | undefined;
  readonly priority: string | undefined;
  readonly due: string | null | undefined;
  readonly estimate: string | undefined;
  readonly labels: readonly string[] | undefined;
  readonly addLabels: readonly string[];
  readonly removeLabels: readonly string[];
  readonly parent: string | undefined;
  readonly entries: readonly FieldEntry[];
}

function blank(name: string, value: string | undefined): void {
  if (value?.trim() === '') {
    throw new CliError('usage', `--${name} must not be empty.`, { code: 'empty_text' });
  }
}

export async function draftChange(
  context: CommandContext,
  options: ChangeOptions,
  edit: EditOnlyOptions | undefined,
): Promise<Draft> {
  blank('summary', options.summary);
  blank('priority', options.priority);
  const description = await readText(context, {
    inline: options.description,
    file: options.descriptionFile,
    label: 'description',
    inlineFlag: '--description',
    fileFlag: '--description-file',
  });

  if (edit !== undefined) {
    if (options.due !== undefined && edit.clearDue) {
      throw new CliError('usage', 'Use --due or --clear-due, not both.', {
        code: 'conflicting_options',
      });
    }
    if (options.label.length > 0 && (edit.addLabel.length > 0 || edit.removeLabel.length > 0)) {
      throw new CliError(
        'usage',
        'Use --label to replace the labels, or --add-label and --remove-label to change them.',
        {
          code: 'conflicting_options',
        },
      );
    }
  }

  return {
    summary: options.summary,
    description,
    priority: options.priority,
    due:
      edit?.clearDue === true
        ? null
        : options.due === undefined
          ? undefined
          : parseDate(options.due, '--due'),
    estimate:
      options.estimate === undefined ? undefined : parseDuration(options.estimate, '--estimate'),
    labels: options.label.length > 0 ? options.label : undefined,
    addLabels: edit?.addLabel ?? [],
    removeLabels: edit?.removeLabel ?? [],
    parent: options.parent === undefined ? undefined : parseIssueKey(options.parent),
    entries: parseFieldEntries(options.field, options.fieldJson),
  };
}

export function isEmptyDraft(draft: Draft): boolean {
  return (
    draft.summary === undefined &&
    draft.description === undefined &&
    draft.priority === undefined &&
    draft.due === undefined &&
    draft.estimate === undefined &&
    draft.labels === undefined &&
    draft.addLabels.length === 0 &&
    draft.removeLabels.length === 0 &&
    draft.parent === undefined &&
    draft.entries.length === 0
  );
}

export interface Request {
  readonly fields: Record<string, unknown>;
  readonly update: Record<string, unknown>;
}

/** Builds the `fields` and `update` objects of a request; resolving field names may call the site. */
export async function buildRequest(
  context: CommandContext,
  client: JiraClient,
  draft: Draft,
): Promise<Request> {
  const fields = await resolveFieldEntries(context, client, draft.entries);
  const set = (id: string, value: unknown): void => {
    if (id in fields) {
      throw new CliError('usage', `Field "${id}" is set by both an option and --field.`, {
        code: 'duplicate_field',
      });
    }
    fields[id] = value;
  };

  if (draft.summary !== undefined) set('summary', draft.summary);
  if (draft.description !== undefined) set('description', markdownToAdf(draft.description));
  if (draft.priority !== undefined) set('priority', { name: draft.priority });
  if (draft.due !== undefined) set('duedate', draft.due);
  if (draft.estimate !== undefined) set('timetracking', { originalEstimate: draft.estimate });
  if (draft.labels !== undefined) set('labels', draft.labels);
  if (draft.parent !== undefined) set('parent', { key: draft.parent });

  const update: Record<string, unknown> = {};
  const labelOperations = [
    ...draft.addLabels.map((add) => ({ add })),
    ...draft.removeLabels.map((remove) => ({ remove })),
  ];
  if (labelOperations.length > 0) update.labels = labelOperations;
  return { fields, update };
}
