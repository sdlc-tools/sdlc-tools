import { defineCli, defineGroup } from '@sdlc-tools/core';
import { auth } from './commands/auth.js';
import { comment } from './commands/comment.js';
import { field } from './commands/field.js';
import { link } from './commands/issue-link.js';
import { create, edit } from './commands/issue-write.js';
import { assign, transition, transitions } from './commands/issue-workflow.js';
import { list, view } from './commands/issue-read.js';
import { worklog } from './commands/worklog.js';
import { VERSION } from './version.js';

const issue = defineGroup({
  name: 'issue',
  summary: 'View, search, create and change issues',
  commands: [view, list, create, edit, transitions, transition, assign, link, comment, worklog],
});

export const cli = defineCli({
  name: 'sdlc-jira',
  version: VERSION,
  summary: 'Jira Cloud from the command line, for people and AI agents',
  description: [
    'Authenticates with an Atlassian API token kept in the OS keychain.',
    'Results are short by default; --json prints the complete result as one JSON document.',
  ].join(' '),
  commands: [auth, issue, field],
});
