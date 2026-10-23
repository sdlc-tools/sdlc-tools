---
'@sdlc-tools/forgejo': patch
'@sdlc-tools/core': patch
---

`auth login` explains the "Unregistered Redirect URI" page a confidential OAuth client gets in the browser, both while waiting and when the sign-in times out, and names the two fixes: a public client, or a fixed registered port with `--callback-port`. `loginWithPkce` accepts a `stallHint` for this.
