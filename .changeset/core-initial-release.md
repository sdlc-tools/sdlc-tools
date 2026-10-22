---
'@sdlc-tools/core': minor
---

First release of the foundation shared by sdlc-tools CLIs:

- keychain-backed credential storage for macOS, Windows and Linux, with a token environment variable for headless use
- OAuth 2.0 authorization code sign-in with PKCE and a loopback redirect, plus token refresh with rotation
- an error model with distinct exit codes, and translation of 401, 403 and 404 responses into likely causes and next steps
- a command layer that validates arguments before any network call, prints the relevant usage for wrong invocations, and follows one output contract: short by default, the full result with `--json`
- layered configuration (flag, environment variable, project file, user file) that refuses files containing credentials
- test helpers under `@sdlc-tools/core/testing`
