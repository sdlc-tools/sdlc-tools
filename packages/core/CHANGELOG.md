# @sdlc-tools/core

## 0.3.0

### Minor Changes

- [#42](https://github.com/sdlc-tools/sdlc-tools/pull/42) [`1b06293`](https://github.com/sdlc-tools/sdlc-tools/commit/1b06293b5e4a0af9006c6da425a657dc40e99d98) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - OAuth sign-in supports confidential clients. `OAuthClient` takes a `clientSecret`, sent as `client_secret` to the token endpoint on the code exchange and on every refresh (including those of `OAuthSession`), and a `tokenRequestFormat` of `'json'` for servers that document a JSON token request instead of the form body. `loginWithPkce` takes `pkce: false` to leave the PKCE challenge and verifier out for servers that do not document PKCE; `codeVerifier` of `exchangeAuthorizationCode` and `codeChallenge` of `buildAuthorizationUrl` become optional. `FakeAuthorizationServer` can act as such a server (`clientSecret`, `tokenRequestFormat`, `authorizationEndpoint`, `tokenEndpoint`), can have its secret regenerated with `changeClientSecret`, and records every authorization parameter in `AuthorizationRequest.parameters`.

- [#46](https://github.com/sdlc-tools/sdlc-tools/pull/46) [`978a4f7`](https://github.com/sdlc-tools/sdlc-tools/commit/978a4f76093e483445365cdb0877d320ebe3321d) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - `validatePort` is exported: it checks a TCP port given as a setting (whole numbers from 1 to 65535, otherwise a usage error with code `invalid_port`) and can be passed as a setting's `validate`.

## 0.2.1

### Patch Changes

- [#40](https://github.com/sdlc-tools/sdlc-tools/pull/40) [`86c67ce`](https://github.com/sdlc-tools/sdlc-tools/commit/86c67ce3be26ead2612377964cf5e6339c18327c) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - `auth login` explains the "Unregistered Redirect URI" page a confidential OAuth client gets in the browser, both while waiting and when the sign-in times out, and names the two fixes: a public client, or a fixed registered port with `--callback-port`. `loginWithPkce` accepts a `stallHint` for this.

## 0.2.0

### Minor Changes

- [#27](https://github.com/sdlc-tools/sdlc-tools/pull/27) [`f3dfbf0`](https://github.com/sdlc-tools/sdlc-tools/commit/f3dfbf0babd73f78adfb928f972d702f5dd562fa) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - Add standard input to `Runtime` as `stdin`: `isTTY`, `readAll()` and `readHidden(prompt)`, which reads a line typed on a terminal without echoing it. `readSecret` takes a token from that terminal prompt or from piped input and fails before any request when it is empty or not a single word. `@sdlc-tools/core/testing` gains the `stdin` option on `createTestRuntime` and `execute`. `Runtime` has a new required member, so code that builds a `Runtime` by hand must supply `stdin`; `runMain` and `createTestRuntime` already do.

## 0.1.0

### Minor Changes

- [#2](https://github.com/sdlc-tools/sdlc-tools/pull/2) [`77550a8`](https://github.com/sdlc-tools/sdlc-tools/commit/77550a8efbb0e8ae6b6b28cc6908e2703ebe2180) Thanks [@Seungwoo321](https://github.com/Seungwoo321)! - First release of the foundation shared by sdlc-tools CLIs:
  
  - keychain-backed credential storage for macOS, Windows and Linux, with a token environment variable for headless use
  - OAuth 2.0 authorization code sign-in with PKCE and a loopback redirect, plus token refresh with rotation
  - an error model with distinct exit codes, and translation of 401, 403 and 404 responses into likely causes and next steps
  - a command layer that validates arguments before any network call, prints the relevant usage for wrong invocations, and follows one output contract: short by default, the full result with `--json`
  - layered configuration (flag, environment variable, project file, user file) that refuses files containing credentials
  - test helpers under `@sdlc-tools/core/testing`
