# @sdlc-tools/jira

A Jira Cloud command-line client designed for people and AI agents to use together. It searches, reads, creates, edits, transitions, assigns and comments on issues and logs work, with an Atlassian API token kept in your operating system keychain.

Every command answers briefly by default and prints its complete result as one JSON document with `--json`. A missing site, credential or argument is reported before any request is sent, a wrong flag prints the usage of that command, and exit codes tell a script what to do next. The shared behavior is specified in [`@sdlc-tools/core`](../core#the-contract).

Requires Node.js 22.13 or newer. Jira Cloud only (REST API v3).

```sh
npm install --global @sdlc-tools/jira   # installs the `sdlc-jira` command
```

## Sign in

Create an API token in your Atlassian account (Security, then API tokens). Put it in the environment without echoing it, then store it:

```sh
read -rs SDLC_JIRA_TOKEN && export SDLC_JIRA_TOKEN
sdlc-jira auth login --site your-team.atlassian.net --email you@example.com
```

`auth login` checks the token against the site first and stores it, together with the e-mail address, in the macOS Keychain, Windows Credential Manager or the Linux Secret Service. The token is read from the environment so it never appears in the command line or the shell history, and it is never printed. Credentials are stored per site, so a token is only ever offered to the site it was issued for. Use `--profile <name>` to keep several accounts on one site.

| Command       | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `auth login`  | Verify an API token and store it in the keychain                     |
| `auth status` | Show which account the current credentials belong to, and where from |
| `auth logout` | Remove the stored credentials for a site                             |

For CI, containers and SSH sessions without a keychain, set `SDLC_JIRA_EMAIL` and `SDLC_JIRA_TOKEN`; they win over the keychain and are never written anywhere.

## Configuration

Nothing about your site is built into the tool. Each setting comes from, in order: the flag, the environment variable, the nearest `.sdlc-tools.json` between the working directory and the repository root, then `~/.config/sdlc-tools/config.json` (`$XDG_CONFIG_HOME` is honoured; `%APPDATA%\sdlc-tools\config.json` on Windows).

| Setting   | Flag        | Environment variable | Files                   |
| --------- | ----------- | -------------------- | ----------------------- |
| `site`    | `--site`    | `SDLC_JIRA_SITE`     | user file only          |
| `project` | `--project` | `SDLC_JIRA_PROJECT`  | project file, user file |
| `profile` | `--profile` | `SDLC_JIRA_PROFILE`  | user file only          |
| `fields`  |             |                      | project file, user file |

```json
{
  "jira": {
    "site": "https://your-team.atlassian.net",
    "project": "ABC",
    "fields": { "points": "customfield_10016" }
  }
}
```

- The site decides where your credentials are sent, so a repository's `.sdlc-tools.json` cannot set it.
- Configuration files must not contain tokens or passwords; a file that does is refused.
- `fields` maps your own short names to field ids (see [Custom fields](#custom-fields)).

## Issues

```sh
sdlc-jira issue view ABC-123
sdlc-jira issue list --assignee me --status "In Progress"
sdlc-jira issue list --jql "project = ABC AND updated >= -7d ORDER BY updated DESC" --limit 50
sdlc-jira issue create --type Task --summary "Rotate the signing key" --label security --assignee me
sdlc-jira issue edit ABC-123 --summary "Better title" --due 2026-12-31 --add-label urgent
sdlc-jira issue transitions ABC-123
sdlc-jira issue transition ABC-123 "In Progress"
sdlc-jira issue assign ABC-123 ada@example.com
sdlc-jira issue comment add ABC-123 "Fixed in **build 42**"
sdlc-jira issue worklog add ABC-123 "1d 2h" --started 2026-03-02T09:00:00+09:00 --comment "Reviewed the migration"
```

| Command                           | What it does                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue view <key>`                | Summary, status, people, description and the latest comments. `--json` returns every field.                                                                                                                                                          |
| `issue list`                      | Search with `--jql`, or with `--project`, `--assignee`, `--status`, `--type`, `--label`. Pages through results up to `--limit`.                                                                                                                      |
| `issue create`                    | Needs `--type`, `--summary` and a project. Also `--description`, `--description-file`, `--priority`, `--due`, `--estimate`, `--label`, `--parent`, `--assignee`, `--field`.                                                                          |
| `issue edit <key>`                | Changes only what you pass. `--label` replaces, `--add-label` and `--remove-label` adjust, `--clear-due` removes the due date.                                                                                                                       |
| `issue transitions <key>`         | The transitions available now, with ids.                                                                                                                                                                                                             |
| `issue transition <key> <target>` | Moves the issue. The target is a transition id, a transition name or the name of the status it leads to; a name that matches several transitions fails and lists their ids. `--comment` adds a comment; `--field` sets fields the workflow requires. |
| `issue assign <key> <who>`        | `who` is `me`, `none` to clear, an account id, or a name or e-mail looked up among users assignable to that issue. Several matches fail and list the candidates instead of guessing.                                                                 |
| `issue comment add <key> [body]`  | Adds a comment from the argument or `--body-file`.                                                                                                                                                                                                   |
| `issue comment list <key>`        | The latest comments, oldest first.                                                                                                                                                                                                                   |
| `issue worklog add <key> <time>`  | Logs time such as `30m`, `2h` or `1d 4h` (weeks, days, hours, minutes). `--started` takes an ISO 8601 time with an offset.                                                                                                                           |
| `issue worklog list <key>`        | Entries and the time logged in them.                                                                                                                                                                                                                 |
| `field list`                      | The site's fields with ids and types; `--search`, `--custom` narrow it.                                                                                                                                                                              |

A project is required by `issue create`, and by `issue list` when you give neither `--jql` nor `--assignee`. When a default project is configured, filtered searches are limited to it; use `--jql` to search across projects.

### Descriptions and comments

Descriptions, comments, worklog notes and rich-text custom fields are written in Markdown and converted to Atlassian Document Format, which the Jira REST API requires. Supported: headings, paragraphs and hard breaks, nested bullet and numbered lists, task lists (`- [ ]`, `- [x]`), fenced code, block quotes, rules, tables, and bold, italic, strikethrough, inline code and links. `issue view` renders ADF back to the same Markdown subset, plus mentions, emoji, status lozenges, dates, panels and attachments as readable text.

### Custom fields

Field ids differ from site to site, so `--field name=value` accepts whatever you know:

1. an alias from `jira.fields` in the configuration,
2. a field id (`customfield_10016`, `duedate`),
3. the field's name as the site shows it (case does not matter), looked up through the site's field list.

`--field` builds the value from the field's type: numbers, strings, dates, string lists (`a, b`) and rich text. For anything structured, pass the JSON the API expects with `--field-json 'Reviewer={"accountId":"..."}'`. A name that matches two fields fails and lists both; an unknown name fails and points to `sdlc-jira field list`.

## Output and exit codes

Results go to stdout, everything else to stderr. `--json` prints one JSON document (indented on a terminal, one line otherwise); under `--json`, errors are JSON on stderr too.

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | Success                                                    |
| `2`  | Usage or configuration error; nothing was changed          |
| `3`  | No credentials, or the site rejected them (401)            |
| `4`  | Permission denied (403)                                    |
| `5`  | Not found (404), or no such transition, field or user      |
| `6`  | Jira failed (5xx) or rejected the request (other 4xx, 429) |
| `7`  | The site could not be reached                              |

`issue transition` and `issue assign` read from the site before they write; a failure in that lookup (an ambiguous name, say) leaves the issue untouched.

## Not included

OAuth 2.0 (3LO) sign-in, Jira Server and Data Center, boards and sprints, and issue links are not part of this package.
