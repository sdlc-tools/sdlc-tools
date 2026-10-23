# @sdlc-tools/site

The sdlc-tools landing page. A private workspace package: it is never published to npm. The build writes plain HTML and CSS to `dist/site`, in English at `/` and in Korean at `/ko/`, with no script, no external font and no tracking.

```sh
pnpm --filter @sdlc-tools/site build   # writes packages/site/dist/site
pnpm --filter @sdlc-tools/site test
```

The logos are copied from the repository `assets/` folder. Open `dist/site/index.html` in a browser to look at it; every reference is relative, so the files work from a folder or under any base path.

## Layout

| Path                   | Purpose                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `src/content.ts`       | All text. Both languages implement one `Content` type, so they cannot drift apart.           |
| `src/data.ts`          | Facts shared by both languages: package names, install commands, addresses.                  |
| `src/page.ts`          | The page template, shared by both languages.                                                 |
| `src/design/tokens.ts` | The design system tokens and the contrast each pair of them must reach.                      |
| `styles/`              | Element defaults (`base.css`) and components (`components.css`), using semantic tokens only. |
| `src/site.ts`          | Writes the pages, the stylesheet and the logos, copied from the repository `assets/`.        |

## Design system

Two token layers. Primitive tokens (`--prim-*`) are the raw palette and scales and carry no meaning. Semantic tokens (`--color-*`, `--space-*`, `--text-*`, ...) say what a value is for, and the stylesheets reference only those. The dark theme is a second mapping from the same semantic color tokens to primitives, selected by `prefers-color-scheme`; nothing else changes.

The tests enforce the rules: every pair of color roles meets its WCAG 2.2 AA contrast ratio in both themes, a new color role without a contrast requirement fails, and a stylesheet that names a primitive, a literal color or a missing token fails.

## Changing the content

Add or edit text in `src/content.ts` in both languages; the compiler rejects a section or an item that exists in only one. A new tool package also needs an entry in `src/data.ts` and in the `packages.summaries` of both languages.

## Deployment

`.github/workflows/pages.yml` builds this package and deploys `dist/site` to GitHub Pages on every push to `main`. The repository setting **Settings → Pages → Build and deployment → Source** must be **GitHub Actions**.
