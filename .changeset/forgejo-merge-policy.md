---
'@sdlc-tools/forgejo': minor
---

Merge policy and pull request rules, enforced from configuration:

- `pr merge` merges only when the configured status contexts (`mergeRequiredStatuses`) are `success` and the required approvals (`mergeRequiredApprovals`, `mergeApprovers` with names or `*` patterns) are in, both judged on the pull request's current head; results and approvals recorded for an older commit do not count. Every unmet item is listed, also as `error.details.unmet`, and nothing is sent
- `mergeMethods` locks the merge method (`merge` by default); `pr merge --method` accepts `merge`, `rebase`, `rebase-merge`, `squash` and `fast-forward-only`, and a method the configuration does not allow is refused before any request
- the configured `reviewers` are requested together with `--reviewer`, leaving out the author, whom the server would otherwise refuse as a whole
- required description sections need content, and are recognised as headings or bold labels with a value (`**Name**: value`); text inside code fences and HTML comments is read for what it is
- commit statuses and reviews are read across all pages, and a missing link in a status is no longer printed as `()`
- `README.ko.md` documents the package in Korean
