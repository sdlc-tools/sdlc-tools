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

**Troubleshooting: "Unregistered Redirect URI".** If the browser shows this page and `auth login` only times out after five minutes, the application is registered as a confidential client. For such a client the server compares the redirect address including its port, and `auth login` listens on a free port. Either of two fixes works:

- Register the application as a public client (Confidential client off). Where that option appears depends on the server version; some edit forms do not show it, in which case create the application again with it off.
- Keep the confidential client, register a fixed redirect such as `http://127.0.0.1:8765/callback`, and sign in with `auth login --callback-port 8765`.

`auth login` prints this hint while it waits and names it as the likely cause when the sign-in times out.

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

| Key                      | Flag              | Environment variable                    | Meaning                                                                         |
| ------------------------ | ----------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `host`                   | `--host`          | `SDLC_FORGEJO_HOST`                     | Server address. Required; https only (plain http for `localhost`).              |
| `repo`                   | `--repo`          | `SDLC_FORGEJO_REPO`                     | `owner/name`. Defaults to the `origin` remote when it is on `host`.             |
| `profile`                | `--profile`       | `SDLC_FORGEJO_PROFILE`                  | Credential profile.                                                             |
| `clientId`               | `--client-id`     | `SDLC_FORGEJO_CLIENT_ID`                | OAuth application for `auth login`.                                             |
| `callbackPort`           | `--callback-port` | `SDLC_FORGEJO_CALLBACK_PORT`            | Fixed port for the sign-in callback.                                            |
| `scopes`                 | `--scopes`        | `SDLC_FORGEJO_SCOPES`                   | OAuth scopes, separated by commas or spaces.                                    |
| `base`                   | `--base`          | `SDLC_FORGEJO_BASE`                     | Default target branch; the repository default branch otherwise.                 |
| `reviewers`              |                   | `SDLC_FORGEJO_REVIEWERS`                | Default reviewers for `pr create`, comma separated; `--reviewer` adds to them.  |
| `labels`                 |                   | `SDLC_FORGEJO_LABELS`                   | Default labels for `pr create`, comma separated.                                |
| `prTitlePattern`         |                   | `SDLC_FORGEJO_PR_TITLE_PATTERN`         | Regular expression every pull request title must match.                         |
| `prRequiredSections`     |                   | `SDLC_FORGEJO_PR_REQUIRED_SECTIONS`     | Section names the description must contain, each with content under it.         |
| `mergeRequiredStatuses`  |                   | `SDLC_FORGEJO_MERGE_REQUIRED_STATUSES`  | Status contexts that must be `success` on the head commit before `pr merge`.    |
| `mergeRequiredApprovals` |                   | `SDLC_FORGEJO_MERGE_REQUIRED_APPROVALS` | Approvals the head commit needs. 1 when `mergeApprovers` is set.                |
| `mergeApprovers`         |                   | `SDLC_FORGEJO_MERGE_APPROVERS`          | Users whose approvals count: names or patterns with `*`. Anyone when unset.     |
| `mergeMethods`           |                   | `SDLC_FORGEJO_MERGE_METHODS`            | Merge methods `pr merge` may use; the first is the default. `merge` when unset. |

The server, the account and the OAuth application decide where credentials go, so they are never read from the project file: a repository you did not write cannot choose them. The repository read from a remote is accepted only when the remote lives on the configured server, for the same reason.

## Merge policy

A team's rules for merging live in the configuration, and `pr merge` enforces them instead of leaving them to whoever runs the command. The policy settings have no flags, so the command line cannot switch them off.

```json
{
  "forgejo": {
    "reviewers": "alice,bob,carol",
    "prTitlePattern": "^(feat|fix|docs|chore): .+ \\[[A-Z]+-\\d+\\]$",
    "prRequiredSections": "Summary, Testing, Breaking change",
    "mergeRequiredStatuses": "review-bot/review, ci/build",
    "mergeRequiredApprovals": "2",
    "mergeApprovers": "alice, bob, carol",
    "mergeMethods": "merge"
  }
}
```

Everything is judged on the pull request's **current head commit**; nothing recorded for an older commit counts.

- **Statuses.** Each context in `mergeRequiredStatuses` must have `success` as its latest result on the head. Missing, `pending`, `failure`, `error` and `warning` all refuse the merge; a rerun replaces the earlier result of the same context. A comma inside parentheses or brackets belongs to the name, so `build (node 22, linux)` is one context. If the account may not read the statuses, the command stops with the permission error instead of guessing.
- **Approvals.** An approval counts when it is the reviewer's latest decisive review, is not dismissed, is not marked stale and was written on the head commit; an approval the server does not tie to a commit does not count. A later request for changes replaces an earlier approval; comments change nothing. Entries of `mergeApprovers` are user names or patterns in which `*` stands for any run of characters, matched against the whole login without regard to case, for example `alice, team-*`. Setting `mergeApprovers` alone requires one approval. A request for changes by someone else that is still open is reported as a warning.
- **Merge methods.** `merge` is the default and the only method unless `mergeMethods` lists more: `merge`, `rebase`, `rebase-merge`, `squash`, `fast-forward-only`. See [Merging](#merging).

When anything is unmet, nothing is sent: the command exits with 6 and `merge_blocked`, lists every missing item, and `error.details.unmet` holds them one by one for programs:

```json
{ "kind": "status", "context": "review-bot/review", "state": "pending", "url": null }
{
  "kind": "approval",
  "required": 2,
  "approvedBy": ["alice"],
  "waitingFor": ["bob", "carol"],
  "notCounted": [{ "reviewer": "bob", "reason": "approved 03aae758, not the current head" }]
}
```

`state` is `missing` when nothing was reported for the head. A setting that can never be met, such as 3 approvals from 2 named users, fails with exit 2 before the first request.

## Commands

Options go after the command name. `sdlc-forgejo <command> --help` shows every option.

| Command                   | What it does                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- |
| `pr list`                 | Lists pull requests (`--state open\|closed\|all`, `--head`, `--base`, `--limit`). |
| `pr view <number>`        | Shows state, mergeability, reviews and the latest result of each CI check.        |
| `pr check`                | Says whether a pull request can be opened for a branch, without opening it.       |
| `pr create`               | Opens a pull request. See below.                                                  |
| `pr ready [<number>]`     | Marks a draft ready for review; `--undo` makes it a draft again. See below.       |
| `pr reviewers <number>`   | Requests (`--add`) or withdraws (`--remove`) review requests.                     |
| `pr labels <number>`      | Attaches (`--add`) or removes (`--remove`) labels, by name.                       |
| `pr merge <number>`       | Merges once the configured policy holds. See below.                               |
| `branch cleanup <branch>` | Deletes a merged branch locally and on the server. See below.                     |

### Opening a pull request

`pr create --title <text> (--body <text> | --body-file <path|->) [--head] [--base] [--reviewer ...] [--label ...] [--draft]`

Before anything is sent:

- the title and the description must be non-empty, and the title a single line of at most 255 characters; `prTitlePattern` and `prRequiredSections` add the rules of your project: a title such as `<type>: <subject> [KEY]` is enforced with one pattern, and every required section must appear as a heading or a bold label (`**Name**`, `**Name:** value`, `**Name**: value`) with something under it. Blank lines and HTML comments do not count as content, and a line starting with `#` inside a code fence is not a heading;
- the head branch is the checked-out branch unless `--head` says otherwise, and the base defaults to the repository's default branch.

Then the server and git are asked, and the pull request is refused when

- the head branch is not on the server, or the server has other commits than your local branch (push first);
- a pull request for that branch is already open, whatever its base. Closed or merged ones only produce a warning, because their discussion is worth reading first;
- the base branch does not exist.

The configured `reviewers` and every `--reviewer` are requested together, each user once. The author is left out of the configured list, because Forgejo refuses a review request for the author as a whole and would leave the others unrequested; a reviewer named with `--reviewer` is sent as given.

Labels are resolved by name before the pull request is created, so a misspelled label cannot leave a half-finished pull request behind. A failure while requesting reviewers or attaching labels afterwards keeps the pull request, exits with 6, and names the pull request and the command that finishes the job. `--draft` prefixes the title with `WIP:`, which is how Forgejo marks a draft.

### Marking a pull request ready

`pr ready [<number>] [--undo]`

Forgejo derives a draft from the title: a pull request is a draft while its title starts with one of the server's work-in-progress prefixes, `WIP:` and `[WIP]` by default, matched without regard to case. `pr ready` removes the prefix and leaves the rest of the title as it is; `--undo` adds `WIP:` again. Without a number it uses the open pull request of the checked-out branch. Nothing is sent when the pull request is already in the requested state, and the result says so (`changed: false` with `--json`). A merged or closed pull request is refused (exit 6, `pull_request_not_open`), and so is a title change that would not move the pull request to the requested state because the server uses other draft prefixes; the server's own answer decides, and nothing is sent when the title would stay the same, and a title edit the server's answer shows to have no effect is undone (exit 6, `draft_unchanged`). `pr merge` accepts the pull request once it is ready.

### Merging

`pr merge <number> [--method <method>] [--match-head-commit <sha>] [--expect-base <branch>] [--keep-branch]`

Merging creates a merge commit unless the configuration allows other methods. Squash and rebase leave the same change under different hashes and turn later rebases into conflict resolution, so they are opt-in: `mergeMethods` lists the methods a team permits, the first is used when `--method` is not given, and a request for any other method is refused before anything is sent (exit 2, `merge_method_not_allowed`). With a method other than `merge` the server writes the commit message.

The merge is refused, before any merge request is sent, when the pull request is closed, already merged, a draft, reported unmergeable by the server, targets another branch than `--expect-base`, has a head other than `--match-head-commit`, or does not satisfy the [merge policy](#merge-policy). Every reason is listed at once. Failed or running CI checks that the policy does not require are reported as warnings; whether they block is a branch protection decision on the server.

Statuses and approvals are read for the head commit seen at the start, and that same commit is sent along with the merge, so the server refuses to merge a head that moved in the meantime. Afterwards the pull request is read again, and the merge is reported only if the server shows it merged. The branch is deleted on the server unless `--keep-branch` is given; if the server keeps it (for example because it is protected) that is reported as a warning.

### Cleaning up branches

`branch cleanup <branch> [--base <branch>] [--worktree <path>]`

Deletes the local branch, the server branch and, with `--worktree`, a linked worktree, but only after git proves the branch is contained in `origin/<base>`. Nothing is removed when any part of that proof fails. The default branch, the base, a branch the server protects and the checked-out branch are refused, and a worktree with uncommitted changes is never removed.

## Exit codes

The exit codes are the ones defined by [`@sdlc-tools/core`](../core#exit-codes): `0` success, `2` usage or configuration, `3` authentication, `4` permission, `5` not found, `6` the server rejected the request, `7` the server could not be reached. This tool uses `6` with a stable `code` for the preconditions it checks itself:

| `code`                     | Meaning                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `create_blocked`           | A pull request cannot be opened for the branch yet; the reasons are listed.                                  |
| `pull_request_not_open`    | `pr ready` was asked about a merged or closed pull request.                                                  |
| `draft_unchanged`          | The title cannot move the pull request to the requested state: the server uses other draft prefixes.         |
| `merge_blocked`            | The pull request is not mergeable or the merge policy is not met; the reasons are listed.                    |
| `merge_rejected`           | The server refused the merge (protection rules, a head that moved, a method the repository has not enabled). |
| `merge_method_not_allowed` | `--method` names a method that `mergeMethods` does not allow (exit 2).                                       |
| `pull_request_incomplete`  | The pull request was opened, but reviewers or labels could not be applied.                                   |
| `cleanup_blocked`          | The branch is not provably merged, or must never be deleted.                                                 |

With `--json` the reasons are in `error.details.violations`, and the unmet policy items in `error.details.unmet`.

## Compatibility

Works with Forgejo and with Gitea servers that offer the same REST API (`/api/v1`) and OAuth2 provider (`/login/oauth/authorize`, `/login/oauth/access_token`). It is verified against Forgejo 15, including signing in with OAuth, requesting reviewers and merging with an OAuth token, and the merge policy: commit statuses read across pages, approvals that stay valid only for the commit they were written on, and merging by merge commit or squash.
