# @sdlc-tools/jira

English | [한국어](./README.ko.md)

A Jira Cloud command-line client designed for people and AI agents to use together. It searches, reads, creates, edits, transitions, assigns, links and comments on issues and logs work. You sign in with OAuth 2.0 (3LO) in the browser or with an Atlassian API token, and the credentials are kept in your operating system keychain.

Every command answers briefly by default and prints its complete result as one JSON document with `--json`. A missing site, credential or argument is reported before any request is sent, a wrong flag prints the usage of that command, and exit codes tell a script what to do next. The shared behavior is specified in [`@sdlc-tools/core`](../core#the-contract).

Requires Node.js 22.13 or newer. Jira Cloud only (REST API v3).

```sh
npm install --global @sdlc-tools/jira   # installs the `sdlc-jira` command
```

## Sign in

Two ways to sign in, both stored in the macOS Keychain, Windows Credential Manager or the Linux Secret Service, and both usable by every command:

|               | OAuth 2.0 (3LO)                                                                                  | API token                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Sign-in       | In the browser, with your Atlassian account                                                      | You create a token in your Atlassian account and enter it                        |
| Set-up        | An OAuth app in the Atlassian developer console, then two settings                               | None                                                                             |
| Access        | Limited to the Jira scopes of the app and to the site you allow; revoked per app                 | Acts as your account until it expires or you revoke it                           |
| Renewal       | Automatic; sign in again after 90 days without use                                               | None; create a new token when it expires                                         |
| Needs         | A browser and a keychain on the machine that runs the command                                    | Nothing; `SDLC_JIRA_TOKEN` works without a keychain                              |
| Prefer it for | Your own workstation, where you want no long-lived token in your shell and access you can revoke | CI, containers, SSH sessions and scripts, or when you cannot create an OAuth app |

### API token

Create an API token in your Atlassian account (Security, then API tokens), then sign in. In a terminal the command asks for the token and does not show what you type:

```sh
sdlc-jira auth login --site your-team.atlassian.net --email you@example.com
```

From a script or an AI agent, pipe the token in with `--with-token`:

```sh
<command that prints the token> | sdlc-jira auth login --site your-team.atlassian.net --email you@example.com --with-token
```

The token can also come from the environment, put there without echoing it:

```sh
read -rs SDLC_JIRA_TOKEN && export SDLC_JIRA_TOKEN
sdlc-jira auth login --site your-team.atlassian.net --email you@example.com
```

The sources are tried in this order: `--with-token` (standard input, or the prompt when standard input is a terminal), the `SDLC_JIRA_TOKEN` variable, then the prompt in a terminal. Standard input is read only when `--with-token` is given. Empty input, or input that is not a single word, fails before any request is sent.

`auth login` checks the token against the site first and stores it, together with the e-mail address, in the keychain. The token never appears in the command line, the shell history, the output (including `--json`) or an error message. Credentials are stored per site, so a token is only ever offered to the site it was issued for. Use `--profile <name>` to keep several accounts on one site.

For CI, containers and SSH sessions without a keychain, set `SDLC_JIRA_EMAIL` and `SDLC_JIRA_TOKEN`; they win over the keychain and are never written anywhere.

### OAuth 2.0 (3LO)

Atlassian does not let a command-line tool sign in on its own: every OAuth app has a client secret, and the token exchange needs it. So you create your own private app once, and `sdlc-jira` acts as that app, keeping its client secret in the keychain and nowhere else.

**1. Create the app** in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/):

1. Create, then **OAuth 2.0 integration**. Give it a name and choose the **Resource-level grant**, so that your consent is limited to the site you select.
2. **Authorization**, then **Configure** next to OAuth 2.0 (3LO): set the callback URL to `http://127.0.0.1:8766/callback` and save. Pick any free port. Atlassian only redirects to the URL registered here, character for character, so it has to be `127.0.0.1` (not `localhost`), that port and the path `/callback`.
3. **Permissions**, then **Add** next to the Jira API, and give it the classic scopes `read:jira-work`, `write:jira-work` and `read:jira-user`.
4. **Settings** shows the client id and the client secret. Leave **Distribution** alone: an app is private until you turn sharing on.

**2. Configure the client id and the port** in `~/.config/sdlc-tools/config.json` (see [Configuration](#configuration)). The port is a string, like every setting:

```json
{
  "jira": {
    "site": "https://your-team.atlassian.net",
    "clientId": "<the client id>",
    "callbackPort": "8766"
  }
}
```

**3. Sign in.** In a terminal the command asks for the client secret and does not show what you type:

```sh
sdlc-jira auth login --oauth
```

From a script, pipe the secret in with `--client-secret-stdin`:

```sh
<command that prints the secret> | sdlc-jira auth login --oauth --client-secret-stdin
```

Your browser opens Atlassian's consent screen, where you choose the site and approve. The command then finds the site among the ones you allowed (if you chose another one it stops, names the allowed sites and stores nothing), checks the sign-in against the API, and stores the tokens, the client secret and the site's cloud id in the keychain.

- The client secret has no flag and no environment variable: it comes from the prompt or from `--client-secret-stdin`. It never appears in the command line, the output (including `--json`), an error message or a configuration file; a file that contains `clientSecret` is refused. Without a terminal the command does not read standard input unless `--client-secret-stdin` asks for it.
- Requests go through Atlassian's API gateway for the site's cloud id instead of the site address. Everything else works the same, and issue links still point at your site.
- The access token lasts an hour. It is renewed shortly before it expires, and once more when Jira answers 401. Atlassian replaces the refresh token on every renewal; the new one is written to the keychain, and a command that finds another process has already renewed it uses that process's token. After 90 days without use the refresh token expires, and the command says to sign in again (exit code `3`).
- `auth login --oauth` replaces an earlier sign-in; signing in with an API token replaces an OAuth sign-in and removes its client secret. `auth logout` removes both. `SDLC_JIRA_TOKEN` still wins over the keychain when it is set.
- OAuth sign-in needs a keychain and a browser on the same machine, and the callback port free while you approve. For anything else use an API token.

| Command       | Purpose                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth login`  | Verify an API token and store it, or with `--oauth` sign in through the browser                                                                     |
| `auth status` | Show which account the current credentials belong to, how you signed in (`oauth` or `token`) and from where, and when an OAuth access token expires |
| `auth logout` | Remove the stored credentials for a site, including an OAuth client secret                                                                          |

## Configuration

Nothing about your site is built into the tool. Each setting comes from, in order: the flag, the environment variable, the nearest `.sdlc-tools.json` between the working directory and the repository root, then `~/.config/sdlc-tools/config.json` (`$XDG_CONFIG_HOME` is honoured; `%APPDATA%\sdlc-tools\config.json` on Windows).

| Setting        | Flag              | Environment variable      | Files                   |
| -------------- | ----------------- | ------------------------- | ----------------------- |
| `site`         | `--site`          | `SDLC_JIRA_SITE`          | user file only          |
| `project`      | `--project`       | `SDLC_JIRA_PROJECT`       | project file, user file |
| `profile`      | `--profile`       | `SDLC_JIRA_PROFILE`       | user file only          |
| `clientId`     | `--client-id`     | `SDLC_JIRA_CLIENT_ID`     | user file only          |
| `callbackPort` | `--callback-port` | `SDLC_JIRA_CALLBACK_PORT` | user file only          |
| `fields`       |                   |                           | project file, user file |
| `workflow`     |                   |                           | project file, user file |

```json
{
  "jira": {
    "site": "https://your-team.atlassian.net",
    "project": "ABC",
    "fields": {
      "points": "customfield_10016",
      "started": { "id": "customfield_10020", "type": "datetime" },
      "begins": { "id": "customfield_10021", "type": "date" }
    },
    "workflow": ["To Do", "In Progress", "In Review", "Done"]
  }
}
```

- The site decides where your credentials are sent, and the client id and callback port decide which OAuth app receives a sign-in, so a repository's `.sdlc-tools.json` cannot set any of them.
- `clientId` and `callbackPort` are only used by `auth login --oauth`, and both are required for it. A missing one fails before anything is sent and names where to set it.
- Configuration files must not contain tokens, passwords or client secrets; a file that does is refused.
- `fields` maps your own short names to field ids (see [Custom fields](#custom-fields)).
- `workflow` lists the statuses of your workflow in the order an issue moves through them (see [Reaching a status](#reaching-a-status)).

## Issues

```sh
sdlc-jira issue view ABC-123
sdlc-jira issue list --assignee me --status "In Progress"
sdlc-jira issue list --jql "project = ABC AND updated >= -7d ORDER BY updated DESC" --limit 50
sdlc-jira issue create --type Task --summary "Rotate the signing key" --label security --assignee me
sdlc-jira issue edit ABC-123 --summary "Better title" --due 2026-12-31 --add-label urgent
sdlc-jira issue transitions ABC-123
sdlc-jira issue transition ABC-123 "In Progress"
sdlc-jira issue transition ABC-123 --to Done
sdlc-jira issue link add ABC-123 Relates ABC-456
sdlc-jira issue assign ABC-123 ada@example.com
sdlc-jira issue comment add ABC-123 "Fixed in **build 42**"
sdlc-jira issue worklog add ABC-123 "1d 2h" --started 2026-03-02T09:00:00+09:00 --comment "Reviewed the migration"
```

| Command                                | What it does                                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue view <key>`                     | Summary, status, people, linked issues, the fields configured under `jira.fields`, description and the latest comments. `--json` returns every field, and the configured ones again by alias under `aliases`.                                             |
| `issue list`                           | Search with `--jql`, or with `--project`, `--assignee`, `--status`, `--type`, `--label`. Pages through results up to `--limit`.                                                                                                                           |
| `issue create`                         | Needs `--type`, `--summary` and a project. Also `--description`, `--description-file`, `--priority`, `--due`, `--estimate`, `--label`, `--parent`, `--assignee`, `--field`.                                                                               |
| `issue edit <key>`                     | Changes only what you pass. `--label` replaces, `--add-label` and `--remove-label` adjust, `--clear-due` removes the due date.                                                                                                                            |
| `issue transitions <key>`              | The transitions available now, with ids.                                                                                                                                                                                                                  |
| `issue transition <key> <target>`      | Makes one transition. The target is a transition id, a transition name or the name of the status it leads to; a name that matches several transitions fails and lists their ids. `--comment` adds a comment; `--field` sets fields the workflow requires. |
| `issue transition <key> --to <status>` | Reaches a status that may be several transitions away, making each one in order (see [Reaching a status](#reaching-a-status)).                                                                                                                            |
| `issue link add <key> <type> <target>` | Links two issues by link type name or phrase, with a direction (see [Issue links](#issue-links)).                                                                                                                                                         |
| `issue link types`                     | The link types of the site with their two phrases.                                                                                                                                                                                                        |
| `issue assign <key> <who>`             | `who` is `me`, `none` to clear, an account id, or a name or e-mail looked up among users assignable to that issue. Several matches fail and list the candidates instead of guessing.                                                                      |
| `issue comment add <key> [body]`       | Adds a comment from the argument or `--body-file`.                                                                                                                                                                                                        |
| `issue comment list <key>`             | The latest comments, oldest first.                                                                                                                                                                                                                        |
| `issue worklog add <key> <time>`       | Logs time such as `30m`, `2h` or `1d 4h` (weeks, days, hours, minutes). `--started` takes an ISO 8601 time with a UTC offset and records it as given, so a work window keeps its own time zone; `worklog list` shows the offset.                          |
| `issue worklog list <key>`             | Entries and the time logged in them.                                                                                                                                                                                                                      |
| `field list`                           | The site's fields with ids and types; `--search`, `--custom` narrow it.                                                                                                                                                                                   |

A project is required by `issue create`, and by `issue list` when you give neither `--jql` nor `--assignee`. When a default project is configured, filtered searches are limited to it; use `--jql` to search across projects.

### Descriptions and comments

Descriptions, comments, worklog notes and rich-text custom fields are written in Markdown and converted to Atlassian Document Format, which the Jira REST API requires. Supported: headings, paragraphs and hard breaks, nested bullet and numbered lists, task lists (`- [ ]`, `- [x]`), fenced code, block quotes, rules, tables, and bold, italic, strikethrough, inline code and links. `issue view` renders ADF back to the same Markdown subset, plus mentions, emoji, status lozenges, dates, panels and attachments as readable text.

### Custom fields

Field ids differ from site to site, so `--field name=value` accepts whatever you know:

1. an alias from `jira.fields` in the configuration,
2. a field id (`customfield_10016`, `duedate`),
3. the field's name as the site shows it (case does not matter), looked up through the site's field list.

`--field` builds the value from the field's type: numbers, strings, dates, datetimes, string lists (`a, b`) and rich text. For anything structured, pass the JSON the API expects with `--field-json 'Reviewer={"accountId":"..."}'`. A name that matches two fields fails and lists both; an unknown name fails, before anything is written, and points to `sdlc-jira field list`.

An alias is either a field id or an object with the id and the value type (`string`, `number`, `date`, `datetime`, `richtext` or `list`). A typed alias is built without asking the site for its field list, and its value is checked locally:

- `date` takes `YYYY-MM-DD` and rejects impossible dates such as `2026-02-30`.
- `datetime` takes ISO 8601 with a UTC offset (`2026-03-02T09:00:00+09:00`, or `Z`) and sends it in the form Jira stores (`2026-03-02T09:00:00.000+0900`); a time without an offset is refused so the result never depends on the machine's time zone.

```sh
sdlc-jira issue edit ABC-123 --field "started=2026-03-02T09:00:00+09:00" --field "begins=2026-03-02"
```

The same aliases read fields back: `issue view` prints the configured fields that have a value, and `issue view --json` returns all of them under `aliases` (`null` when empty). `issue list --fields points` accepts an alias as well as an id.

### Reaching a status

`issue transition <key> <target>` makes one transition. `issue transition <key> --to <status>` goes as far as it takes:

```sh
sdlc-jira issue transition ABC-123 --to Done --comment "Shipped" --field-json 'resolution={"name":"Done"}'
```

Jira only lists the transitions open from the current status, so the path comes from `jira.workflow`, the statuses of your workflow in order. From the current status the command takes the transition to the nearest status ahead that does not pass the target, reads the status again, and repeats until the issue is there. A status the workflow offers no transition to is skipped. `--comment` and `--field` go with the last transition, and field values are checked before the first one is made.

- Already in the target status: nothing is changed.
- No order configured: only a transition straight to the target is taken.
- No way forward, or a target behind the current status: the command stops with the statuses reached so far and the transitions open now. Transitions already made stay made.

### Issue links

```sh
sdlc-jira issue link types
sdlc-jira issue link add ABC-123 Blocks ABC-456
sdlc-jira issue link add ABC-123 Blocks ABC-456 --direction inward
sdlc-jira issue link add ABC-123 "is blocked by" ABC-456 --comment "Waiting on the API"
```

Every link type has a name and one phrase for each end. With the type's name, the first issue carries the outward phrase (`ABC-123 blocks ABC-456`) and `--direction inward` swaps the ends. Giving a phrase such as `is blocked by` fixes the direction by itself. The type is matched without regard to case against the site's own link types; an unknown one fails before anything is written and lists them. `issue view` lists an issue's links from its own side.

## Output and exit codes

Results go to stdout, everything else to stderr. `--json` prints one JSON document (indented on a terminal, one line otherwise); under `--json`, errors are JSON on stderr too.

| Code | Meaning                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                  |
| `2`  | Usage or configuration error; nothing was changed                                        |
| `3`  | No credentials, a sign-in that can no longer be renewed, or the site rejected them (401) |
| `4`  | Permission denied (403)                                                                  |
| `5`  | Not found (404), or no such transition, status path, field, user or link type            |
| `6`  | Jira failed (5xx) or rejected the request (other 4xx, 429)                               |
| `7`  | The site could not be reached                                                            |

`issue transition` and `issue assign` read from the site before they write; a failure in that lookup (an ambiguous name, say) leaves the issue untouched.

## Not included

Jira Server and Data Center, boards and sprints, and removing issue links are not part of this package.
