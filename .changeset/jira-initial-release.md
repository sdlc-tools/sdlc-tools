---
'@sdlc-tools/jira': minor
---

First release of the Jira Cloud command-line client:

- sign in with an Atlassian API token that is verified and stored in the OS keychain, with a token environment variable for headless use
- search with JQL or filters, and view, create and edit issues, with Markdown converted to Atlassian Document Format for descriptions and comments
- transitions, assignee changes, comments and worklogs
- custom fields set by alias, id or name, resolved through the site so no field id is built into the tool
- local failures before any request, usage help for wrong invocations, distinct exit codes and `--json` output on every command
