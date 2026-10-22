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

### How a release happens

`publish.yml` runs on every push to `main`:

1. While changesets are pending, it opens or updates the **Version Packages** pull request, which bumps versions, rewrites the changelogs and consumes the changesets.
2. Merging that pull request publishes every bumped package. The `pack` job builds and packs the tarballs (`workspace:*` becomes the real version), and the `publish` job uploads them to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers): an OIDC token from GitHub, provenance attached, no npm token stored. Only the `publish` job has `id-token: write`. It also pushes the git tags and creates the GitHub releases.

Release runs share one concurrency group and never overlap. The repository setting **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** must be on. A pull request opened with the workflow token does not start the `CI` workflow; close and reopen it, or push to its branch, to run the checks.

### One-time bootstrap

npm configures a trusted publisher on a package that already exists, so each package's first version is pushed with a token:

1. Create a granular npm access token with read and write access to the `@sdlc-tools` packages and save it as the repository secret `NPM_TOKEN`.
2. Run **Publish Init** from `main` (Actions → Publish Init → Run workflow).
3. Add the trusted publisher to each of `@sdlc-tools/core`, `@sdlc-tools/forgejo` and `@sdlc-tools/jira` on npmjs.com (package → Settings → Trusted publishing → GitHub Actions):

   | Field             | Value                          |
   | ----------------- | ------------------------------ |
   | Organization      | `sdlc-tools`                   |
   | Repository        | `sdlc-tools`                   |
   | Workflow filename | `publish.yml`                  |
   | Environment       | empty                          |
   | Allowed actions   | direct publish (`npm publish`) |

4. Delete the `NPM_TOKEN` secret and revoke the token. Nothing after this step needs it.

Publish Init runs `changeset version` in the runner only, appends `-beta.0` to each planned version (for example `0.1.0-beta.0`) and publishes under the `beta` dist-tag. A prerelease sorts below its stable version, so `0.1.0` remains for the first regular release, which goes through OIDC. A package that is already on the registry at that version is skipped, so the workflow can be run again after a partial failure.

`npm publish --tag beta` does not move `latest` ([npm-dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag)); the registry's handling of `latest` on a package's very first version is not documented, so check `npm dist-tag ls @sdlc-tools/core` after the bootstrap. The first regular release sets `latest` to the stable version either way.

npm expires a trusted publisher configuration that has not completed a publish within two days of saving it, so merge the Version Packages pull request soon after step 3.

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

   Repeat the same `exports` in `publishConfig.exports` without the `@sdlc-tools/source` line. Packing replaces `exports` with it, so the published manifest never points at `src`, which the tarball does not contain.

3. Build the executable on `defineCli` and `runMain` from `@sdlc-tools/core`, name it `sdlc-<tool>` in `bin`, and test it with `@sdlc-tools/core/testing`.
4. Add a README that describes the tool as a general-purpose CLI.
