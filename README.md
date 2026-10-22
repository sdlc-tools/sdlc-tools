<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/banner-dark.svg">
    <img src="./assets/banner.svg" alt="sdlc-tools: CLIs designed for humans and AI agents" width="560">
  </picture>
</p>

# sdlc-tools

Command-line tools for the development lifecycle, designed to be used by humans and AI agents alike. Every tool answers briefly by default, prints its complete result as one JSON document with `--json`, fails before touching the network when an argument or a credential is missing, and tells you what to do next when a server says 401, 403 or 404.

## Why one contract

A person at a terminal and an agent driving a shell need the same things from a CLI, and both are let down by the same habits: output that is either too long to read or too short to act on, errors that say `Error: Request failed`, a wrong flag that prints nothing useful, and exit codes that are `1` for everything. The tools in this repository share one contract so that what you learn from one carries over to the next.

| Behavior                       | What you get                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Short by default               | A few lines meant to be read. `--json` prints the full result as a single JSON document on stdout.                      |
| Fails locally first            | A missing argument, option or credential is reported before any request is sent.                                        |
| Help when you are wrong        | An unknown command or flag prints the usage of the command in question, with a suggestion for typos.                    |
| Exit codes that mean something | `0` success, `2` usage, `3` authentication, `4` permission, `5` not found, `6` server, `7` network.                     |
| Errors that help               | 401, 403 and 404 become sentences with likely causes and next steps. Under `--json`, errors are JSON on stderr as well. |
| Credentials in the keychain    | Tokens live in the operating system credential store, never in a configuration file.                                    |
| No built-in addresses          | Hosts, project keys and field ids come from flags, environment variables or configuration, never from the code.         |

The full specification is in [`packages/core`](./packages/core#readme).

## Packages

| Package                                      | Purpose                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@sdlc-tools/core`](./packages/core#readme) | The foundation the tools are built on: keychain credentials, OAuth 2.0 PKCE sign-in, error and exit-code model, HTTP client, argument parsing and the output contract. |

Each tool is its own package under `packages/`, versioned independently, and depends only on `@sdlc-tools/core`.

## Command names

A tool package installs one executable named `sdlc-<tool>`.

A bare product name would collide with programs that already own it: the Forgejo server binary is called `forgejo`, and several popular Jira command-line clients install `jira`. Putting both on one `PATH` would make one of them silently win. Prefixing with `sdlc-` keeps every tool installable next to what is already there and keeps the family recognizable in shell completion.

The form also matches how `git` finds external subcommands (`git foo` runs `git-foo`), so a future `sdlc <tool>` dispatcher can be added without renaming anything.

## Working in this repository

You need Node.js 22.13 or newer and [pnpm](https://pnpm.io). The repository pins its pnpm version in `package.json`.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All five work from a clean clone, in this order, without any prior build: packages expose their TypeScript sources to each other through an `@sdlc-tools/source` export condition, so linting, type checking and tests always see the live sources. See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions, releases and how a new tool package is added.

## Security

Credentials are stored in the macOS Keychain, Windows Credential Manager or the Linux Secret Service (with the kernel keyring as a fallback), keyed by tool and server so that a token is only ever offered to the server that issued it. Configuration files that contain credential-like keys are refused. Details and the threat notes on project-level configuration are in the [`@sdlc-tools/core` README](./packages/core#security-notes).

## License

[MIT](./LICENSE)
