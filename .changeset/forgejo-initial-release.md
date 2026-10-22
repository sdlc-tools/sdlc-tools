---
'@sdlc-tools/forgejo': minor
---

First release of `sdlc-forgejo`, the pull request workflow for Forgejo and Gitea:

- sign in with OAuth 2.0 and PKCE (with automatic token renewal) or a personal access token; credentials stay in the operating system keychain
- list, view and open pull requests, with checks on the title and description, a block on a second pull request for the same branch, and a comparison of the local branch with what the server has
- request reviewers and attach labels, and merge with a merge commit only, pinned to the commit that was checked, with the branch removed afterwards
- delete a merged branch locally and on the server once git has proven it merged
