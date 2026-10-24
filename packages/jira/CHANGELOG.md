# @sdlc-tools/jira

## 0.3.0

### Minor Changes

- [#42](https://github.com/sdlc-tools/sdlc-tools/pull/42) [`fbd6276`](https://github.com/sdlc-tools/sdlc-tools/commit/fbd627619b7af97bdf6f1eade2d07d855938cb29) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - `auth login --oauth` signs in to Jira Cloud with OAuth 2.0 (3LO) in the browser, as a confidential client of an OAuth app you create. The client id and the fixed callback port come from the `clientId` and `callbackPort` settings (user file, `SDLC_JIRA_CLIENT_ID`, `SDLC_JIRA_CALLBACK_PORT`, `--client-id`, `--callback-port`); the client secret is typed at a prompt that does not show it or piped in with `--client-secret-stdin`, and is kept in the keychain only. Later sign-ins for the same client id reuse the stored secret without asking; `--client-secret-stdin` replaces it, and a stored secret the server refuses says so. After sign-in the cloud id of the configured site is resolved (a site that was not allowed fails and names the allowed ones), and every command then calls the Jira API through `api.atlassian.com`. Access tokens are renewed before they expire and once after a 401, and the rotated refresh token is written back to the keychain. `auth status` shows the kind of credential (`oauth` or `token`) and the expiry of an OAuth access token, and `auth logout` removes the client secret too. API token sign-in is unchanged.

### Patch Changes

- [#46](https://github.com/sdlc-tools/sdlc-tools/pull/46) [`978a4f7`](https://github.com/sdlc-tools/sdlc-tools/commit/978a4f76093e483445365cdb0877d320ebe3321d) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - The callback port is validated by `validatePort` from `@sdlc-tools/core`; the message and exit code are unchanged.
- Updated dependencies [[`1b06293`](https://github.com/sdlc-tools/sdlc-tools/commit/1b06293b5e4a0af9006c6da425a657dc40e99d98), [`978a4f7`](https://github.com/sdlc-tools/sdlc-tools/commit/978a4f76093e483445365cdb0877d320ebe3321d)]:
  - @sdlc-tools/core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`86c67ce`](https://github.com/sdlc-tools/sdlc-tools/commit/86c67ce3be26ead2612377964cf5e6339c18327c)]:
  - @sdlc-tools/core@0.2.1

## 0.2.0

### Minor Changes

- [#27](https://github.com/sdlc-tools/sdlc-tools/pull/27) [`555136d`](https://github.com/sdlc-tools/sdlc-tools/commit/555136dccae1b6561acb204103efcf3405000893) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - `auth login` takes the API token from standard input with `--with-token` and from a prompt that does not echo when run in a terminal, in addition to `SDLC_JIRA_TOKEN`. Empty input fails before any request is sent, and the token never appears in the output, `--json` or an error.

### Patch Changes

- Updated dependencies [[`f3dfbf0`](https://github.com/sdlc-tools/sdlc-tools/commit/f3dfbf0babd73f78adfb928f972d702f5dd562fa)]:
  - @sdlc-tools/core@0.2.0

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
