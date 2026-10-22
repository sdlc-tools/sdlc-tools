import { CliError, type CommandContext } from '@sdlc-tools/core';
import { markdownToAdf } from './adf/markdown.js';
import { adfToText } from './adf/text.js';
import type { JiraClient, JiraFieldDefinition } from './client.js';
import { loadJiraConfig, type FieldAlias, type FieldType } from './connection.js';
import { parseDate, parseDateTime } from './input.js';

export interface FieldEntry {
  readonly name: string;
  readonly value: string;
  readonly json: boolean;
}

const CUSTOM_FIELD_ID = /^customfield_\d+$/;

function splitEntry(raw: string, flag: string): { name: string; value: string } {
  const separator = raw.indexOf('=');
  const name = separator === -1 ? '' : raw.slice(0, separator).trim();
  if (name === '') {
    throw new CliError('usage', `${flag} expects name=value, not "${raw}".`, {
      code: 'invalid_field_option',
      next: [`Example: ${flag} "Story Points=5". List the names with \`sdlc-jira field list\`.`],
    });
  }
  return { name, value: raw.slice(separator + 1) };
}

/** Parses `--field` and `--field-json` occurrences; a malformed one fails before any request. */
export function parseFieldEntries(
  fields: readonly string[],
  fieldJson: readonly string[],
): FieldEntry[] {
  return [
    ...fields.map((raw) => ({ ...splitEntry(raw, '--field'), json: false })),
    ...fieldJson.map((raw) => {
      const entry = splitEntry(raw, '--field-json');
      try {
        JSON.parse(entry.value);
      } catch (cause) {
        throw new CliError('usage', `--field-json ${entry.name} is not valid JSON.`, {
          code: 'invalid_field_json',
          cause,
        });
      }
      return { ...entry, json: true };
    }),
  ];
}

function describeField(field: JiraFieldDefinition): string {
  return `${field.name} (${field.id})`;
}

/** The value type a site's field definition holds, when `--field` can build it. */
function typeOfDefinition(field: JiraFieldDefinition): FieldType | undefined {
  if (field.schema?.custom?.endsWith(':textarea') === true) return 'richtext';
  switch (field.schema?.type) {
    case 'string':
    case 'number':
    case 'date':
    case 'datetime':
      return field.schema.type;
    case 'array':
      return field.schema.items === 'string' ? 'list' : undefined;
    default:
      return undefined;
  }
}

function buildValue(label: string, type: FieldType, value: string): unknown {
  switch (type) {
    case 'richtext':
      return markdownToAdf(value);
    case 'string':
      return value;
    case 'date':
      return parseDate(value, label);
    case 'datetime':
      return parseDateTime(value, label, 'invalid_datetime');
    case 'number': {
      const parsed = Number(value);
      if (value.trim() === '' || !Number.isFinite(parsed)) {
        throw new CliError('usage', `${label} expects a number, not "${value}".`, {
          code: 'invalid_field_value',
        });
      }
      return parsed;
    }
    case 'list':
      return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
  }
}

function unsupported(field: JiraFieldDefinition): CliError {
  const type = field.schema?.type;
  return new CliError(
    'usage',
    `${describeField(field)} holds ${type ?? 'a structured value'}, which --field cannot build.`,
    {
      code: 'unsupported_field_type',
      next: [`Pass the JSON the Jira API expects with --field-json "${field.name}=<json>".`],
    },
  );
}

/**
 * Turns `--field` / `--field-json` entries into the `fields` object of a create
 * or edit request. A name resolves through the configured aliases, then as a
 * field id, then by display name from the site's own field list, so no id is
 * ever built into the tool. The field list is fetched only when needed: an
 * alias that declares its type, or a JSON value, is built without it.
 */
export async function resolveFieldEntries(
  context: CommandContext,
  client: JiraClient,
  entries: readonly FieldEntry[],
): Promise<Record<string, unknown>> {
  if (entries.length === 0) return {};
  const { fields: aliases } = await loadJiraConfig(context);
  const resolved = entries.map((entry) => ({
    entry,
    alias: aliases.get(entry.name.toLowerCase()),
  }));

  const needsList = resolved.some(({ entry, alias }) =>
    entry.json
      ? alias === undefined && !CUSTOM_FIELD_ID.test(entry.name)
      : alias?.type === undefined,
  );
  const definitions = needsList ? await client.listFields() : [];

  const result: Record<string, unknown> = {};
  for (const { entry, alias } of resolved) {
    const wanted = alias?.id ?? entry.name;
    let definition = definitions.find((field) => field.id === wanted);
    if (definition === undefined && alias === undefined) {
      const matches = definitions.filter(
        (field) => field.name.toLowerCase() === entry.name.toLowerCase(),
      );
      if (matches.length > 1) {
        throw new CliError('usage', `"${entry.name}" matches more than one field.`, {
          code: 'ambiguous_field',
          causes: matches.map(describeField),
          next: [
            'Pass the field id instead, or add an alias under "jira.fields" in the configuration.',
          ],
        });
      }
      definition = matches[0];
    }

    const id =
      definition?.id ?? (CUSTOM_FIELD_ID.test(wanted) || alias !== undefined ? wanted : undefined);
    if (id === undefined) {
      throw new CliError('not-found', `This site has no field named "${entry.name}".`, {
        code: 'unknown_field',
        next: [
          'List the fields with `sdlc-jira field list --search <text>`.',
          'Add the field under "jira.fields" in the configuration to use a short alias.',
        ],
      });
    }
    if (id in result) {
      throw new CliError('usage', `Field "${entry.name}" is given more than once.`, {
        code: 'duplicate_field',
      });
    }
    if (entry.json) {
      result[id] = JSON.parse(entry.value) as unknown;
      continue;
    }
    const type =
      alias?.type ?? (definition === undefined ? undefined : typeOfDefinition(definition));
    if (type !== undefined) {
      result[id] = buildValue(entry.name, type, entry.value);
    } else if (definition === undefined) {
      throw new CliError('not-found', `This site has no field with the id "${id}".`, {
        code: 'unknown_field',
        next: ['List the fields with `sdlc-jira field list`.'],
      });
    } else {
      throw unsupported(definition);
    }
  }
  return result;
}

export interface AliasedValue {
  readonly alias: string;
  readonly id: string;
  readonly value: unknown;
  readonly text: string;
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.type === 'doc') return adfToText(value);
    for (const key of ['displayName', 'name', 'value', 'key']) {
      if (typeof record[key] === 'string') return record[key];
    }
    return JSON.stringify(value);
  }
  return '';
}

/** The configured alias fields of an issue, in the order the configuration lists them; absent values are `null`. */
export function readAliasedFields(
  aliases: ReadonlyMap<string, FieldAlias>,
  fields: Readonly<Record<string, unknown>>,
): AliasedValue[] {
  return [...aliases.values()].map(({ alias, id }) => {
    const value = fields[id] ?? null;
    return { alias, id, value, text: value === null ? '' : valueText(value) };
  });
}
