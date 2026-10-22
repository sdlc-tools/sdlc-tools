# @sdlc-tools/jira

## 0.1.0

### Minor Changes

- [#5](https://github.com/sdlc-tools/sdlc-tools/pull/5) [`cab51fd`](https://github.com/sdlc-tools/sdlc-tools/commit/cab51fdf32786bd3ec7a4e46bb627298a795b5bc) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - First release of the Jira Cloud command-line client:
  
  - sign in with an Atlassian API token that is verified and stored in the OS keychain, with a token environment variable for headless use
  - search with JQL or filters, and view, create and edit issues, with Markdown converted to Atlassian Document Format for descriptions and comments
  - transitions, assignee changes, comments and worklogs
  - custom fields set by alias, id or name, resolved through the site so no field id is built into the tool
  - local failures before any request, usage help for wrong invocations, distinct exit codes and `--json` output on every command

- [#12](https://github.com/sdlc-tools/sdlc-tools/pull/12) [`57ea87a`](https://github.com/sdlc-tools/sdlc-tools/commit/57ea87a99c5fa320ed6805d851563d5d2c269829) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - Run a team's issue workflow from configuration:
  
  - custom field aliases in `jira.fields` can declare a value type; `date` and `datetime` values are validated before any request, and `issue view` and `issue list --fields` read fields back by alias
  - `issue transition <key> --to <status>` makes every transition needed to reach a status, in the order given by `jira.workflow`, and stops with the statuses reached and the transitions open when no path exists
  - worklogs keep the UTC offset of `--started`, and `worklog list` shows it
  - `issue link add` and `issue link types` create links by link type name or phrase with a direction, and `issue view` lists an issue's links

### Patch Changes

- Updated dependencies [[`77550a8`](https://github.com/sdlc-tools/sdlc-tools/commit/77550a8efbb0e8ae6b6b28cc6908e2703ebe2180)]:
  - @sdlc-tools/core@0.1.0
