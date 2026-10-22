import { CliError, defineCommand } from '@sdlc-tools/core';
import { buildRequest, changeOptions, draftChange, isEmptyDraft } from '../change.js';
import { connect, connectionOptions, resolveProject } from '../connection.js';
import { parseIssueKey } from '../input.js';
import { resolveAssignee } from '../users.js';

export const create = defineCommand({
  name: 'create',
  summary: 'Create an issue',
  description:
    'The project comes from --project, SDLC_JIRA_PROJECT or "project" in the configuration. Set any other field with --field, resolved by alias, id or name on your site.',
  options: {
    ...connectionOptions,
    ...changeOptions,
    summary: { ...changeOptions.summary, required: true },
    project: {
      type: 'string',
      valueName: 'key',
      description: 'Project key (or SDLC_JIRA_PROJECT)',
    },
    type: {
      type: 'string',
      valueName: 'name',
      required: true,
      description: 'Issue type name, such as Task or Bug',
    },
    assignee: {
      type: 'string',
      valueName: 'who',
      description: '"me", an account id, or a name or e-mail',
    },
  },
  examples: [
    'sdlc-jira issue create --type Task --summary "Rotate the signing key" --label security',
    'sdlc-jira issue create --type Story --summary "Export to CSV" --description-file spec.md --field "Story Points=3"',
  ],
  async run({ options }, context) {
    const draft = await draftChange(context, options, undefined);
    const project = await resolveProject(context, options.project, true);

    const { client } = await connect(context, options);
    const request = await buildRequest(context, client, draft);
    const fields: Record<string, unknown> = {
      ...request.fields,
      project: { key: project },
      issuetype: { name: options.type },
    };
    if (options.assignee !== undefined) {
      const accountId = await resolveAssignee(client, options.assignee, { project });
      if (accountId === null) {
        throw new CliError(
          'usage',
          'An issue cannot be created unassigned on purpose; omit --assignee.',
          {
            code: 'invalid_assignee',
          },
        );
      }
      fields.assignee = { accountId };
    }

    const created = await client.createIssue(fields);
    const url = client.browseUrl(created.key);
    return {
      data: { id: created.id, key: created.key, url },
      text: `Created ${created.key}\n${url}`,
    };
  },
});

export const edit = defineCommand({
  name: 'edit',
  summary: 'Change fields of an issue',
  description:
    'Only the fields you pass change. Use `issue transition` to move the issue through its workflow and `issue assign` to change the assignee.',
  positionals: [{ name: 'key', description: 'Issue key, such as ABC-123', required: true }],
  options: {
    ...connectionOptions,
    ...changeOptions,
    clearDue: { type: 'boolean', description: 'Remove the due date' },
    addLabel: {
      type: 'string',
      valueName: 'name',
      multiple: true,
      description: 'Add a label',
    },
    removeLabel: {
      type: 'string',
      valueName: 'name',
      multiple: true,
      description: 'Remove a label',
    },
  },
  examples: [
    'sdlc-jira issue edit ABC-123 --summary "Better title" --due 2026-12-31',
    'sdlc-jira issue edit ABC-123 --add-label urgent --remove-label later',
  ],
  async run({ args, options }, context) {
    const key = parseIssueKey(args.key);
    const draft = await draftChange(context, options, options);
    if (isEmptyDraft(draft)) {
      throw new CliError('usage', 'Nothing to change: pass at least one field option.', {
        code: 'nothing_to_change',
        next: [
          'Example: --summary "New title", --due 2026-12-31, --add-label urgent, --field "Name=value".',
        ],
      });
    }

    const { client } = await connect(context, options);
    const request = await buildRequest(context, client, draft);
    await client.updateIssue(key, {
      ...(Object.keys(request.fields).length > 0 ? { fields: request.fields } : {}),
      ...(Object.keys(request.update).length > 0 ? { update: request.update } : {}),
    });
    const changed = [...Object.keys(request.fields), ...Object.keys(request.update)];
    const url = client.browseUrl(key);
    return {
      data: { key, url, changed },
      text: `Updated ${key}: ${changed.join(', ')}\n${url}`,
    };
  },
});
