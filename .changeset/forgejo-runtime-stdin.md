---
'@sdlc-tools/forgejo': patch
---

`auth login --with-token` and `pr create --body-file -` read standard input through the shared `Runtime`, so Ctrl-C ends a read that is waiting on a pipe instead of leaving the command hanging. Accepted input and messages are unchanged.
