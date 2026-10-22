import { CliError, type CommandContext } from '@sdlc-tools/core';
import { markdownToAdf } from './adf/markdown.js';
import type { JiraClient, JiraFieldDefinition } from './client.js';
import { loadFieldAliases } from './connection.js';

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

function coerce(field: JiraFieldDefinition, value: string): unknown {
  const type = field.schema?.type;
  if (field.schema?.custom?.endsWith(':textarea') === true) return markdownToAdf(value);
  switch (type) {
    case 'string':
    case 'date':
    case 'datetime':
      return value;
    case 'number': {
      const parsed = Number(value);
      if (value.trim() === '' || !Number.isFinite(parsed)) {
        throw new CliError('usage', `${field.name} expects a number, not "${value}".`, {
          code: 'invalid_field_value',
        });
      }
      return parsed;
    }
    case 'array':
      if (field.schema?.items === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '');
      }
      break;
    default:
      break;
  }
  throw new CliError(
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
 * ever built into the tool. The field list is fetched only when needed.
 */
export async function resolveFieldEntries(
  context: CommandContext,
  client: JiraClient,
  entries: readonly FieldEntry[],
): Promise<Record<string, unknown>> {
  if (entries.length === 0) return {};
  const aliases = await loadFieldAliases(context);
  const resolved = entries.map((entry) => ({
    entry,
    id: aliases.get(entry.name.toLowerCase()),
  }));

  const needsList = resolved.some(
    ({ entry, id }) => !entry.json || (id === undefined && !CUSTOM_FIELD_ID.test(entry.name)),
  );
  const definitions = needsList ? await client.listFields() : [];

  const result: Record<string, unknown> = {};
  for (const { entry, id: aliased } of resolved) {
    const wanted = aliased ?? entry.name;
    let definition = definitions.find((field) => field.id === wanted);
    if (definition === undefined && aliased === undefined) {
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
      definition?.id ??
      (CUSTOM_FIELD_ID.test(wanted) || aliased !== undefined ? wanted : undefined);
    if (id === undefined) {
      throw new CliError('not-found', `This site has no field named "${entry.name}".`, {
        code: 'unknown_field',
        next: ['List the fields with `sdlc-jira field list --search <text>`.'],
      });
    }
    if (id in result) {
      throw new CliError('usage', `Field "${entry.name}" is given more than once.`, {
        code: 'duplicate_field',
      });
    }
    if (entry.json) {
      result[id] = JSON.parse(entry.value) as unknown;
    } else if (definition === undefined) {
      throw new CliError('not-found', `This site has no field with the id "${id}".`, {
        code: 'unknown_field',
        next: ['List the fields with `sdlc-jira field list`.'],
      });
    } else {
      result[id] = coerce(definition, entry.value);
    }
  }
  return result;
}
