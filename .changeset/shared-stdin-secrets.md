---
'@sdlc-tools/core': minor
---

Add standard input to `Runtime` as `stdin`: `isTTY`, `readAll()` and `readHidden(prompt)`, which reads a line typed on a terminal without echoing it. `readSecret` takes a token from that terminal prompt or from piped input and fails before any request when it is empty or not a single word. `@sdlc-tools/core/testing` gains the `stdin` option on `createTestRuntime` and `execute`. `Runtime` has a new required member, so code that builds a `Runtime` by hand must supply `stdin`; `runMain` and `createTestRuntime` already do.
