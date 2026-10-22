import { defineCommand, defineGroup } from '@sdlc-tools/core';
import { connect, connectionOptions } from '../connection.js';
import { table } from '../render.js';

const list = defineCommand({
  name: 'list',
  summary: 'List the fields of the site, with their ids',
  description:
    'Custom field ids differ per site. Use this to find the id or the exact name to pass to --field.',
  options: {
    ...connectionOptions,
    search: {
      type: 'string',
      valueName: 'text',
      description: 'Only fields whose name or id contains the text',
    },
    custom: { type: 'boolean', description: 'Only custom fields' },
  },
  examples: ['sdlc-jira field list --search "story point"'],
  async run({ options }, context) {
    const { client } = await connect(context, options);
    const needle = options.search?.toLowerCase();
    const fields = (await client.listFields())
      .filter((field) => !options.custom || field.custom)
      .filter(
        (field) =>
          needle === undefined ||
          field.name.toLowerCase().includes(needle) ||
          field.id.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      data: { count: fields.length, fields },
      text:
        fields.length === 0
          ? 'No matching fields.'
          : table(fields.map((field) => [field.id, field.schema?.type ?? '-', field.name])),
    };
  },
});

export const field = defineGroup({
  name: 'field',
  summary: 'Discover field ids and names',
  commands: [list],
});
