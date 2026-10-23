# @sdlc-tools/forgejo

## 0.2.1

### Patch Changes

- [#40](https://github.com/sdlc-tools/sdlc-tools/pull/40) [`86c67ce`](https://github.com/sdlc-tools/sdlc-tools/commit/86c67ce3be26ead2612377964cf5e6339c18327c) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - `auth login` explains the "Unregistered Redirect URI" page a confidential OAuth client gets in the browser, both while waiting and when the sign-in times out, and names the two fixes: a public client, or a fixed registered port with `--callback-port`. `loginWithPkce` accepts a `stallHint` for this.
- Updated dependencies [[`86c67ce`](https://github.com/sdlc-tools/sdlc-tools/commit/86c67ce3be26ead2612377964cf5e6339c18327c)]:
  - @sdlc-tools/core@0.2.1

## 0.2.0

### Minor Changes

- [#25](https://github.com/sdlc-tools/sdlc-tools/pull/25) [`bbd18f3`](https://github.com/sdlc-tools/sdlc-tools/commit/bbd18f337574fbc3c2579d5243ef0f514b5491ec) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - Add `pr ready [<number>]` to mark a draft pull request ready for review, and `--undo` to turn it back into a draft. Without a number it uses the open pull request of the checked-out branch, and nothing is sent when the pull request is already in the requested state. `pr merge` now points to it when it refuses a draft.

### Patch Changes

- [#27](https://github.com/sdlc-tools/sdlc-tools/pull/27) [`dc325e3`](https://github.com/sdlc-tools/sdlc-tools/commit/dc325e3e29bf20756fd5df09e1875acb4c950399) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - `auth login --with-token` and `pr create --body-file -` read standard input through the shared `Runtime`, so Ctrl-C ends a read that is waiting on a pipe instead of leaving the command hanging. Accepted input and messages are unchanged.
- Updated dependencies [[`f3dfbf0`](https://github.com/sdlc-tools/sdlc-tools/commit/f3dfbf0babd73f78adfb928f972d702f5dd562fa)]:
  - @sdlc-tools/core@0.2.0

## 0.1.0

### Minor Changes

- [#7](https://github.com/sdlc-tools/sdlc-tools/pull/7) [`5629904`](https://github.com/sdlc-tools/sdlc-tools/commit/5629904fcaca7ad064d6a0246279e9f149a6e96e) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - First release of `sdlc-forgejo`, the pull request workflow for Forgejo and Gitea:
  
  - sign in with OAuth 2.0 and PKCE (with automatic token renewal) or a personal access token; credentials stay in the operating system keychain
  - list, view and open pull requests, with checks on the title and description, a block on a second pull request for the same branch, and a comparison of the local branch with what the server has
  - request reviewers and attach labels, and merge with a merge commit only, pinned to the commit that was checked, with the branch removed afterwards
  - delete a merged branch locally and on the server once git has proven it merged

- [#14](https://github.com/sdlc-tools/sdlc-tools/pull/14) [`c59e6b3`](https://github.com/sdlc-tools/sdlc-tools/commit/c59e6b3852fdb8b2adf31e997bff4567c67fbe98) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - Merge policy and pull request rules, enforced from configuration:
  
  - `pr merge` merges only when the configured status contexts (`mergeRequiredStatuses`) are `success` and the required approvals (`mergeRequiredApprovals`, `mergeApprovers` with names or `*` patterns) are in, both judged on the pull request's current head; results and approvals recorded for an older commit do not count. Every unmet item is listed, also as `error.details.unmet`, and nothing is sent
  - `mergeMethods` locks the merge method (`merge` by default); `pr merge --method` accepts `merge`, `rebase`, `rebase-merge`, `squash` and `fast-forward-only`, and a method the configuration does not allow is refused before any request
  - the configured `reviewers` are requested together with `--reviewer`, leaving out the author, whom the server would otherwise refuse as a whole
  - required description sections need content, and are recognised as headings or bold labels with a value (`**Name**: value`); text inside code fences and HTML comments is read for what it is
  - commit statuses and reviews are read across all pages, and a missing link in a status is no longer printed as `()`
  - `README.ko.md` documents the package in Korean

### Patch Changes

- Updated dependencies [[`77550a8`](https://github.com/sdlc-tools/sdlc-tools/commit/77550a8efbb0e8ae6b6b28cc6908e2703ebe2180)]:
  - @sdlc-tools/core@0.1.0
