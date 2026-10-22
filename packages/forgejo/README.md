# @sdlc-tools/forgejo

`sdlc-forgejo` is a command-line client for pull requests on [Forgejo](https://forgejo.org) and [Gitea](https://about.gitea.com), designed to be used by people and AI agents together. It answers briefly by default, prints its complete result as one JSON document with `--json`, refuses to send a request when an argument, a setting or a credential is missing, and explains what to do next when the server says 401, 403 or 404.

It is built on [`@sdlc-tools/core`](../core#readme), which defines the output contract, the exit codes and the credential handling shared by every tool in this repository.

Requires Node.js 22.13 or newer.

```sh
npm install --global @sdlc-tools/forgejo
```

## A first pull request

```sh
export SDLC_FORGEJO_HOST=https://git.example.com

sdlc-forgejo auth login --client-id <id>     # opens the browser once
git push -u origin feat/export
sdlc-forgejo pr create --title "feat: export" --body-file description.md --reviewer alice
sdlc-forgejo pr merge 12
```

Inside a checkout the repository is read from the `origin` remote, so no `--repo` is needed. Everything below can also be given outside a checkout with `--host` and `--repo`.

## Signing in

Credentials are kept in the operating system keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service), bound to the server that issued them. Nothing is written to a configuration file.

### OAuth with PKCE (recommended)

`auth login` runs the OAuth 2.0 authorization code grant with PKCE (`S256`) and a loopback redirect. A browser window opens, you approve the request, and the tokens are stored and renewed automatically; the access token is refreshed shortly before it expires and again if the server answers 401.

The OAuth application has to exist on the server first. In the Forgejo web interface open **Settings, Applications, Manage OAuth2 applications** and create one:

| Field               | Value                                          |
| ------------------- | ---------------------------------------------- |
| Confidential client | off (a command-line tool cannot keep a secret) |
| Redirect URI        | `http://127.0.0.1/callback`                    |

Copy the client id and pass it once with `--client-id`, or keep it in the configuration (`clientId`). The sign-in remembers which application issued it, so later commands need nothing.

- The redirect is registered without a port; Forgejo accepts any port on the loopback address for it. A server that insists on an exact address needs the registered port in the redirect and `--callback-port <port>` on `auth login`.
- Scopes are not requested unless you pass `--scopes`.
- The command ends only after the REST API has accepted the new token, so a sign-in that cannot be used is never stored.

If the server signs users in through single sign-on, nothing changes: the browser shows the server's usual login page, and you choose the single sign-on button there. The command never sees that login; it only receives the code and tokens the Forgejo server itself issues.

### Personal access token

Create a token under **Settings, Applications** and pipe it in; it is read from standard input so that it never appears in the process list or the shell history:

```sh
printf %s "$TOKEN" | sdlc-forgejo auth login --with-token
```

For CI and containers without a keychain, set `SDLC_FORGEJO_TOKEN`. It wins over the keychain and is never stored.

### Other commands

| Command                    | What it does                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sdlc-forgejo auth status` | Asks the server who the stored credentials belong to; exits with 3 when you are not signed in.                           |
| `sdlc-forgejo auth logout` | Removes the credentials from the keychain. Revoke the token under Settings, Applications to invalidate it on the server. |

`--profile <name>` keeps several accounts on one server apart.

## Configuration

Each setting is resolved in this order: flag, environment variable, project file (`.sdlc-tools.json`, searched upward to the repository root), user file (`~/.config/sdlc-tools/config.json`). Files hold one section per tool and only strings:

```json
{
  "forgejo": {
    "host": "https://git.example.com",
    "clientId": "<id>",
    "repo": "my-team/my-project",
    "reviewers": "alice,bob"
  }
}
```

| Key                  | Flag              | Environment variable                | Meaning                                                               |
| -------------------- | ----------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `host`               | `--host`          | `SDLC_FORGEJO_HOST`                 | Server address. Required; https only (plain http for `localhost`).    |
| `repo`               | `--repo`          | `SDLC_FORGEJO_REPO`                 | `owner/name`. Defaults to the `origin` remote when it is on `host`.   |
| `profile`            | `--profile`       | `SDLC_FORGEJO_PROFILE`              | Credential profile.                                                   |
| `clientId`           | `--client-id`     | `SDLC_FORGEJO_CLIENT_ID`            | OAuth application for `auth login`.                                   |
| `callbackPort`       | `--callback-port` | `SDLC_FORGEJO_CALLBACK_PORT`        | Fixed port for the sign-in callback.                                  |
| `scopes`             | `--scopes`        | `SDLC_FORGEJO_SCOPES`               | OAuth scopes, separated by commas or spaces.                          |
| `base`               | `--base`          | `SDLC_FORGEJO_BASE`                 | Default target branch; the repository default branch otherwise.       |
| `reviewers`          |                   | `SDLC_FORGEJO_REVIEWERS`            | Default reviewers for `pr create`, comma separated.                   |
| `labels`             |                   | `SDLC_FORGEJO_LABELS`               | Default labels for `pr create`, comma separated.                      |
| `prTitlePattern`     |                   | `SDLC_FORGEJO_PR_TITLE_PATTERN`     | Regular expression every pull request title must match.               |
| `prRequiredSections` |                   | `SDLC_FORGEJO_PR_REQUIRED_SECTIONS` | Section names the description must contain as headings or bold lines. |

The server, the account and the OAuth application decide where credentials go, so they are never read from the project file: a repository you did not write cannot choose them. The repository read from a remote is accepted only when the remote lives on the configured server, for the same reason.

## Commands

Options go after the command name. `sdlc-forgejo <command> --help` shows every option.

| Command                   | What it does                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- |
| `pr list`                 | Lists pull requests (`--state open\|closed\|all`, `--head`, `--base`, `--limit`). |
| `pr view <number>`        | Shows state, mergeability, reviews and the latest result of each CI check.        |
| `pr check`                | Says whether a pull request can be opened for a branch, without opening it.       |
| `pr create`               | Opens a pull request. See below.                                                  |
| `pr reviewers <number>`   | Requests (`--add`) or withdraws (`--remove`) review requests.                     |
| `pr labels <number>`      | Attaches (`--add`) or removes (`--remove`) labels, by name.                       |
| `pr merge <number>`       | Merges with a merge commit. See below.                                            |
| `branch cleanup <branch>` | Deletes a merged branch locally and on the server. See below.                     |

### Opening a pull request

`pr create --title <text> (--body <text> | --body-file <path|->) [--head] [--base] [--reviewer ...] [--label ...] [--draft]`

Before anything is sent:

- the title and the description must be non-empty, and the title a single line of at most 255 characters; `prTitlePattern` and `prRequiredSections` add the rules of your project;
- the head branch is the checked-out branch unless `--head` says otherwise, and the base defaults to the repository's default branch.

Then the server and git are asked, and the pull request is refused when

- the head branch is not on the server, or the server has other commits than your local branch (push first);
- a pull request for that branch is already open, whatever its base. Closed or merged ones only produce a warning, because their discussion is worth reading first;
- the base branch does not exist.

Labels are resolved by name before the pull request is created, so a misspelled label cannot leave a half-finished pull request behind. A failure while requesting reviewers or attaching labels afterwards keeps the pull request, exits with 6, and names the pull request and the command that finishes the job. `--draft` prefixes the title with `WIP:`, which is how Forgejo marks a draft.

### Merging

`pr merge <number> [--match-head-commit <sha>] [--expect-base <branch>] [--keep-branch]`

Merging always creates a merge commit. Squash and rebase are not offered: they leave the same change under different hashes and turn later rebases into conflict resolution.

The merge is refused, before any merge request is sent, when the pull request is closed, already merged, a draft, reported unmergeable by the server, targets another branch than `--expect-base`, or its head is not `--match-head-commit`. The commit that was checked is sent along with the merge, so the server refuses to merge a head that moved in the meantime. Failed or running CI checks are reported as warnings; whether they block is a branch protection decision on the server.

Afterwards the pull request is read again, and the merge is reported only if the server shows it merged. The branch is deleted on the server unless `--keep-branch` is given; if the server keeps it (for example because it is protected) that is reported as a warning.

### Cleaning up branches

`branch cleanup <branch> [--base <branch>] [--worktree <path>]`

Deletes the local branch, the server branch and, with `--worktree`, a linked worktree, but only after git proves the branch is contained in `origin/<base>`. Nothing is removed when any part of that proof fails. The default branch, the base, a branch the server protects and the checked-out branch are refused, and a worktree with uncommitted changes is never removed.

## Exit codes

The exit codes are the ones defined by [`@sdlc-tools/core`](../core#exit-codes): `0` success, `2` usage or configuration, `3` authentication, `4` permission, `5` not found, `6` the server rejected the request, `7` the server could not be reached. This tool uses `6` with a stable `code` for the preconditions it checks itself:

| `code`                    | Meaning                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `create_blocked`          | A pull request cannot be opened for the branch yet; the reasons are listed. |
| `merge_blocked`           | The pull request is not mergeable; the reasons are listed.                  |
| `merge_rejected`          | The server refused the merge (protection rules, a head that moved).         |
| `pull_request_incomplete` | The pull request was opened, but reviewers or labels could not be applied.  |
| `cleanup_blocked`         | The branch is not provably merged, or must never be deleted.                |

With `--json` the reasons are in `error.details.violations`.

## Compatibility

Works with Forgejo and with Gitea servers that offer the same REST API (`/api/v1`) and OAuth2 provider (`/login/oauth/authorize`, `/login/oauth/access_token`). It is verified against Forgejo 15, including signing in with OAuth, requesting reviewers and merging with an OAuth token.
