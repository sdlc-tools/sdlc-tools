---
'@sdlc-tools/forgejo': patch
---

`auth login --with-token` reads standard input through the shared `Runtime`, so Ctrl-C ends a read that is waiting on a pipe instead of leaving the command hanging. Accepted input and messages are unchanged.
