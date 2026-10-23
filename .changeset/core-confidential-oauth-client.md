---
'@sdlc-tools/core': minor
---

OAuth sign-in supports confidential clients. `OAuthClient` takes a `clientSecret`, sent as `client_secret` to the token endpoint on the code exchange and on every refresh (including those of `OAuthSession`), and a `tokenRequestFormat` of `'json'` for servers that document a JSON token request instead of the form body. `loginWithPkce` takes `pkce: false` to leave the PKCE challenge and verifier out for servers that do not document PKCE; `codeVerifier` of `exchangeAuthorizationCode` and `codeChallenge` of `buildAuthorizationUrl` become optional. `FakeAuthorizationServer` can act as such a server (`clientSecret`, `tokenRequestFormat`, `authorizationEndpoint`, `tokenEndpoint`), can have its secret regenerated with `changeClientSecret`, and records every authorization parameter in `AuthorizationRequest.parameters`.
