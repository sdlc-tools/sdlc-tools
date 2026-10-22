# Contributing

## Setup

Node.js 22.13 or newer and pnpm. The pnpm version is pinned in `package.json`; with a recent pnpm it is selected automatically.

```sh
pnpm install
```

| Command          | What it checks                                                        |
| ---------------- | --------------------------------------------------------------------- |
| `pnpm lint`      | ESLint with type-aware rules, including the architecture rules below. |
| `pnpm format`    | Formats everything with Prettier (`pnpm format:check` only verifies). |
| `pnpm typecheck` | TypeScript, no emit.                                                  |
| `pnpm test`      | Vitest, against the live sources.                                     |
| `pnpm build`     | Emits `dist/` for every package with `tsc`.                           |

Pull requests run the same checks in CI on the lowest supported Node version.

### Operating system keychain tests

The tests that use the real credential store are skipped unless you opt in:

```sh
SDLC_TEST_KEYCHAIN=1 pnpm exec vitest run packages/core/test/keychain.integration.test.ts
```

They create and remove items under a throwaway service name. A separate workflow runs them on macOS, Windows and Linux for pull requests that touch credential storage.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), are written in English, and end the header with the issue they belong to:

```
feat(core): add token refresh (#12)
```

Branches are named `<type>/<issue>-<short-slug>`, for example `feat/12-token-refresh`. Pull requests are merged with a merge commit.

`husky` installs the hooks on `pnpm install`: `lint-staged` checks staged files and `commitlint` checks the message.

## Architecture rules

ESLint enforces these, so a violation fails `pnpm lint`:

- Library code in `src/` never touches `process` or `console`; it receives a `Runtime` (see `@sdlc-tools/core`). Only `src/main.ts` binds the real process.
- No URL literal and no `customfield_*` id in `src/`: addresses and field ids are configuration.
- A package imports `@sdlc-tools/core` and no sibling package.

## Releases

Versions are managed per package with [changesets](https://github.com/changesets/changesets). A pull request that changes what a published package does includes a changeset:

```sh
pnpm changeset
```

Choose the packages and the bump, and describe the change for the people who will read the changelog.

## Adding a tool package

1. Create `packages/<tool>` named `@sdlc-tools/<tool>`, with `@sdlc-tools/core` as a dependency and the same `tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts` layout as `packages/core`.
2. Expose the sources in `exports` next to the built files, so sibling packages and tests can run without a build:

   ```json
   ".": {
     "@sdlc-tools/source": "./src/index.ts",
     "types": "./dist/index.d.ts",
     "default": "./dist/index.js"
   }
   ```

3. Build the executable on `defineCli` and `runMain` from `@sdlc-tools/core`, name it `sdlc-<tool>` in `bin`, and test it with `@sdlc-tools/core/testing`.
4. Add a README that describes the tool as a general-purpose CLI.
