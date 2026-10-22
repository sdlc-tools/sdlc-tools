import { defineProject } from 'vitest/config';

/**
 * Workspace packages expose their TypeScript sources through the
 * `@sdlc-tools/source` export condition, so tests run against the live sources
 * and never depend on a prior `build`. Linked workspace packages are inlined so
 * Vite resolves them with that condition instead of treating them as external.
 */
export const SOURCE_CONDITION = '@sdlc-tools/source';

export function defineSharedProject() {
  return defineProject({
    resolve: { conditions: [SOURCE_CONDITION] },
    ssr: { resolve: { conditions: [SOURCE_CONDITION] } },
    test: {
      include: ['test/**/*.test.ts'],
      server: { deps: { inline: [/^@sdlc-tools\//] } },
    },
  });
}
