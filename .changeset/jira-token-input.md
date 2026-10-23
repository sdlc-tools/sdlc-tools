---
'@sdlc-tools/jira': minor
---

`auth login` takes the API token from standard input with `--with-token` and from a prompt that does not echo when run in a terminal, in addition to `SDLC_JIRA_TOKEN`. Empty input fails before any request is sent, and the token never appears in the output, `--json` or an error.
