---
'@sdlc-tools/forgejo': minor
---

Add `pr ready [<number>]` to mark a draft pull request ready for review, and `--undo` to turn it back into a draft. Without a number it uses the open pull request of the checked-out branch, and nothing is sent when the pull request is already in the requested state. `pr merge` now points to it when it refuses a draft.
