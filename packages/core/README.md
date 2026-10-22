# @sdlc-tools/core

English | [한국어](./README.ko.md)

The foundation shared by every sdlc-tools CLI: credentials in the operating system keychain, OAuth 2.0 sign-in with PKCE, an error and exit-code model, an HTTP client that explains failures, and a command layer that implements one output contract for people and AI agents alike.

It is a library. A tool built on it gets the whole contract below by defining its commands, and everything that touches the outside world (environment, streams, `fetch`, keychain, clock) is injected, so a tool can be tested without a network, a keychain or a process.

Requires Node.js 22.13 or newer. ESM only.

```sh
pnpm add @sdlc-tools/core
```

## A tool in one file

<!-- example:cli -->

```ts
import {
  HttpClient,
  bearerAuth,
  defineCli,
  defineCommand,
  normalizeServerUrl,
  resolveCredential,
  resolveSettings,
  urlPath,
} from '@sdlc-tools/core';

const show = defineCommand({
  name: 'show',
  summary: 'Show one item',
  positionals: [{ name: 'id', description: 'Item id', required: true }],
  options: { host: { type: 'string', valueName: 'url', description: 'Server address' } },
  async run({ options, args }, context) {
    const { values } = await resolveSettings(
      context,
      'example',
      {
        host: {
          label: 'server address',
          key: 'host',
          env: 'SDLC_EXAMPLE_HOST',
          flag: '--host',
          required: true,
          fromProjectFile: false,
          validate: (value) => normalizeServerUrl(value).baseUrl,
        },
      },
      { host: options.host },
    );
    const server = normalizeServerUrl(values.host);

    const { credential } = await resolveCredential(context, {
      tool: 'example',
      origin: server.origin,
      tokenEnv: 'SDLC_EXAMPLE_TOKEN',
      loginCommand: 'sdlc-example auth login',
    });

    const http = new HttpClient({
      baseUrl: server.baseUrl,
      fetch: context.fetch,
      signal: context.signal,
      auth: bearerAuth(credential.kind === 'token' ? credential.token : credential.accessToken),
      context: { reauth: ['Sign in with `sdlc-example auth login`.'] },
    });
    const { data } = await http.get<{ title: string }>(urlPath`/api/items/${args.id}`, {
      resource: `item ${args.id}`,
    });
    return { data, text: data.title };
  },
});

export const cli = defineCli({
  name: 'sdlc-example',
  version: '1.0.0',
  summary: 'Example CLI',
  commands: [show],
});
```

The executable is three lines, so the definition stays importable for tests:

```ts
#!/usr/bin/env node
import { runMain } from '@sdlc-tools/core';
import { cli } from './cli.js';

await runMain(cli);
```

What that tool does when you run it:

```console
$ sdlc-example show 12
error: Missing server address.

Next steps:
  - Pass --host.
  - Set the SDLC_EXAMPLE_HOST environment variable.
  - Add "host" under "example" in <user config path>.
$ echo $?
2
```

Every failure above happens before a request is sent: arguments are parsed first, then configuration, then credentials, and only then the network.

## The contract

### Exit codes

| Code  | Meaning                                                                                | What to do next                              |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| `0`   | Success                                                                                |                                              |
| `1`   | Unexpected error (a bug in the tool)                                                   | Report it; `SDLC_DEBUG=1` adds a stack trace |
| `2`   | Usage or configuration error; nothing was sent to the server                           | Fix the command line or the settings         |
| `3`   | Authentication: no credentials, rejected (401), or a session that could not be renewed | Sign in again                                |
| `4`   | Permission denied (403)                                                                | Ask for access                               |
| `5`   | Not found (404)                                                                        | Check the identifier and the server          |
| `6`   | The server failed (5xx) or rejected the request (other 4xx, 429)                       | Retry later or correct the request           |
| `7`   | The server could not be reached, or timed out                                          | Check the network and the address            |
| `130` | Cancelled by the user (Ctrl-C)                                                         |                                              |

### Output

- Results go to **stdout**, everything else (progress lines, errors, help for wrong usage) to **stderr**.
- By default a command prints the short text it chose. With `--json` it prints its complete result as one JSON document: a single line when stdout is not a terminal, indented when it is.
- Under `--json`, errors are JSON on stderr as well, so a caller can parse both streams:

  ```json
  {
    "error": {
      "kind": "not-found",
      "exitCode": 5,
      "status": 404,
      "message": "...",
      "causes": ["..."],
      "next": ["..."]
    }
  }
  ```

  `kind` is one of `usage`, `config`, `auth`, `permission`, `not-found`, `server`, `network`, `cancelled`, `unexpected`. `code` is a stable subtype such as `no_credentials` or `refresh_failed` when there is one.

- No colour codes are emitted.

### Wrong usage

- `--help` and `-h` print help to stdout and exit `0`, at every level: `tool --help`, `tool group --help`, `tool group command --help`. `tool help group command` does the same.
- An unknown command, an unknown flag, a flag without its value, a value outside the allowed choices, a missing required argument or option, or a surplus argument is a usage error: the message, the usage of the command in question, and a suggestion for a likely typo go to stderr, and the exit code is `2`.
- Options go after the command name: `tool group command --flag`. Flags belong to the command that declares them, so a flag from another command is unknown.
- A value that starts with `-` must be written as `--flag=value`; `--` ends option parsing.

### Server errors

401, 403 and 404 become sentences that name the server and the resource, list the likely causes and give next steps. The caller supplies the context: the resource (`resource: 'pull request #12'`) and what to do about a 401 (`context.reauth`). A 404 mentions that some servers answer 404 for resources an account cannot see; a transport failure names the cause (refused, not found, timed out) and, for an untrusted certificate, points to `NODE_EXTRA_CA_CERTS`.

The error never contains request headers, tokens or the query string.

## Commands

`defineCommand`, `defineGroup` and `defineCli` declare the tree once; parsing, validation and help all come from that declaration.

- Option keys are camelCase and appear as kebab-case flags (`dryRun` is `--dry-run`). Option types are `string` (optionally `multiple`, `choices`, `default`, `required`, `short`) and `boolean`. The handler receives them typed: choices narrow to a union, `multiple` is an array, `required` and `default` are never `undefined`.
- Positional arguments are named and typed the same way, and may be `required` or `variadic`.
- `--json` and `--help` are available on every command and cannot be redeclared.
- A handler returns `{ data, text }`: `data` is the full result, `text` the short rendering (an empty `text` prints nothing).
- `context.log(message)` writes a diagnostic line to stderr. `context.json` tells a handler whether `--json` was passed.
- A handler throws `CliError` for expected failures. Anything else becomes exit code `1`.
- `runCli(cli, argv, runtime)` runs a CLI in memory and resolves with the exit code; `runMain(cli)` binds the real process and handles Ctrl-C.

## Configuration

`resolveSettings(runtime, section, specs, flags)` resolves each setting, in this order:

1. the flag,
2. the environment variable,
3. the project file: the nearest `.sdlc-tools.json` between the working directory and the repository root,
4. the user file: `$XDG_CONFIG_HOME/sdlc-tools/config.json` (`~/.config/sdlc-tools/config.json` by default, `%APPDATA%\sdlc-tools\config.json` on Windows),
5. the setting's default, if it declares one.

Files are JSON objects with one section per tool; values are strings:

```json
{ "forgejo": { "host": "https://git.example.com" }, "jira": { "project": "ABC" } }
```

- A required setting that is missing fails with exit code `2` and names the flag, the environment variable and the file key that would provide it.
- Files are read only when a setting was not already given by a flag or the environment.
- **Files must not contain credentials.** Keys ending in `token`, `secret`, `password`, `passwd`, `apikey` or `credential(s)` make the file unreadable for the tool, with a message that does not repeat the value. Credentials belong in the keychain or an environment variable.
- A setting can opt out of the project file with `fromProjectFile: false`. Use it for settings that decide where credentials are sent, such as a server address.
- The tools hold no server address, project key or field id of their own; the ESLint rules of this repository enforce that.

`normalizeServerUrl` validates a server address: https is required (plain http only for `localhost`, `127.0.0.1` and `[::1]`), user names and passwords in the address are rejected, and a path prefix is kept. `urlPath` is a tagged template that percent-encodes each value as one path segment and rejects `.`, `..` and empty segments.

## Credentials

Credentials are kept in the operating system credential store: macOS Keychain, Windows Credential Manager, and on Linux the Secret Service API with the kernel keyring as a fallback when no service is running. The native binding (`@napi-rs/keyring`, prebuilt, no install scripts) is loaded on first use, so commands that never touch credentials never load it.

- An item is stored under the service `sdlc-tools` and the account `<tool>:<origin>`, plus `#<profile>` for a non-default profile. The origin is part of the key, so a credential is only offered to the server that issued it.
- Secrets longer than one keychain item are split across several, so a pair of OAuth tokens fits Windows Credential Manager's size limit.
- For CI, containers and SSH sessions without a keychain, a tool can accept a token from an environment variable (`resolveCredential`'s `tokenEnv`). The variable wins over the keychain and is never written anywhere. `toolEnvVar('forgejo', 'token')` gives the conventional name `SDLC_FORGEJO_TOKEN`.
- With no credentials, `resolveCredential` fails with exit code `3` before any request. If the keychain itself is unavailable, the error says why and suggests the environment variable.
- `bearerAuth` and `basicAuth` build `Authorization` headers; a tool chooses the scheme its server expects.

## OAuth 2.0 sign-in

`loginWithPkce` implements the authorization code grant with PKCE using the `S256` method ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)) and a loopback redirect ([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)).

1. It listens on `127.0.0.1` on a free port, or on the port you give when the server needs an exactly registered redirect address, prints the authorization address to stderr and tries to open the browser.
2. It accepts one callback. A request with a missing or wrong `state`, another path, another method or another `Host` header is refused and ignored, so a stray or forged request cannot complete or abort the sign-in.
3. It exchanges the code together with the PKCE verifier, and stops listening whatever the outcome: success, denial, timeout (five minutes by default) or cancellation.

`OAuthSession` is an `AuthProvider` for a stored OAuth credential. It renews the access token a minute before it expires and once more when the server answers 401, writes rotated tokens back to the credential store, and renews once at a time within a process. If another process already rotated the refresh token, it adopts that process's credential instead of failing. A session that cannot be renewed fails with exit code `3` and tells the user to sign in again.

Endpoints, client id, scopes and the callback port are always parameters.

## HTTP client

`HttpClient` wraps an injected `fetch`: a base URL (path prefixes are kept), JSON and form bodies, query parameters, a default timeout of 30 seconds, cancellation, an `AuthProvider`, and the error translation above. Any 2xx status is success. Requests are never retried, except once after a 401 when the auth provider can renew its credentials.

## Testing a tool

`@sdlc-tools/core/testing` provides what a tool needs to test itself without a network, a keychain, a disk or a process:

| Export                                           | Purpose                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `execute(cli, argv, ...)`                        | Runs a CLI in memory; returns the exit code, stdout, stderr, the network calls made and the store.                                  |
| `mockFetch`, `forbidFetch`                       | A recording `fetch`; `forbidFetch` fails on any call, to prove a command failed locally.                                            |
| `jsonResponse`, `textResponse`, `networkFailure` | Builders for responses and transport failures.                                                                                      |
| `MemorySecretStore`                              | An in-memory credential store.                                                                                                      |
| `MemoryFiles`                                    | An in-memory file reader for configuration files; starts empty, so no test depends on the disk.                                     |
| `FakeAuthorizationServer`                        | An OAuth server that enforces PKCE verification, single-use codes and refresh-token rotation, and a browser that approves sign-ins. |

By default `execute` uses `forbidFetch`, so a test must say when it expects network traffic, and an empty `MemoryFiles`, so configuration files exist only when a test adds them. Library code reads files through `runtime.files` rather than `node:fs`, which keeps in-process tests independent of disk and scheduler latency.

## Security notes

- Project files choose the server. A repository you did not write can contain a `.sdlc-tools.json` that points a tool at another server. Keychain credentials are bound to the server they were issued for and are not offered to it, but a token supplied through an environment variable is sent to whichever server is configured. Tools should set `fromProjectFile: false` on the server address, and you should inspect a repository's `.sdlc-tools.json` before running a tool in a checkout you do not trust.
- The loopback listener binds to `127.0.0.1` only, validates `state` and `Host`, serves static pages that never echo request content, sets `Referrer-Policy: no-referrer`, and is closed as soon as the sign-in ends.
- Plain http is refused for any server address except loopback hosts.
- The OAuth authorization address printed to the terminal contains the `state` and the PKCE challenge, which are not secrets. The verifier, codes and tokens are never printed or included in errors.
