---
'@sdlc-tools/jira': patch
---

`auth login --oauth` remembers the OAuth app. After a sign-in the keychain holds the callback port next to the client id and secret, and a later sign-in takes the client id and the port from the flag, the environment, the user file, then that stored app, so it needs no flag and no configuration. A different client id from a flag or the configuration still wins and asks for its secret; a stored app from an earlier version has no port, which then comes from a flag or the configuration and is stored. The first sign-in without a client id still fails before any request, and now says where to find it in the Atlassian developer console. `auth status` shows the client id of an OAuth sign-in.
