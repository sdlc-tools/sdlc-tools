# @sdlc-tools/forgejo

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
