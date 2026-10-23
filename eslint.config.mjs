import { readdirSync } from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Workspace packages live in `packages/<name>` and publish as `@sdlc-tools/<name>`.
 * `core` is the only package the others may import, so the boundary rules below
 * are derived from the directory listing and need no edit when a package is added.
 */
const packages = readdirSync(new URL('./packages', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const siblingImportBans = packages.map((name) => ({
  files: [`packages/${name}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: packages
          .filter((other) => other !== name && other !== 'core')
          .map((other) => ({
            group: [`@sdlc-tools/${other}`, `@sdlc-tools/${other}/*`],
            message:
              name === 'core'
                ? `@sdlc-tools/core is the base of every package and must not depend on @sdlc-tools/${other}.`
                : `@sdlc-tools/${name} must not depend on @sdlc-tools/${other}; share code through @sdlc-tools/core.`,
          })),
      },
    ],
  },
}));

const URL_LITERAL = '[/][/][a-z0-9]';

/**
 * Server addresses, project keys and field ids are configuration, never code
 * (see "Configuration" in packages/core/README.md).
 */
const hardcodedUrlRules = [
  {
    selector: `Literal[value=/^https?:${URL_LITERAL}/]`,
    message: 'Do not hard-code URLs in sources; receive the address through configuration.',
  },
  {
    selector: `TemplateElement[value.raw=/https?:${URL_LITERAL}/]`,
    message: 'Do not hard-code URLs in sources; receive the address through configuration.',
  },
];

const hardcodedFieldRules = [
  {
    selector: 'Literal[value=/customfield_/]',
    message: 'Do not hard-code field ids in sources; receive them through configuration.',
  },
];

const restrictedGlobals = [
  {
    name: 'process',
    message:
      'Library code receives its environment through Runtime; only src/main.ts binds the process.',
  },
  {
    name: 'console',
    message: 'Write through Runtime.stdout / Runtime.stderr so output stays testable.',
  },
];

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'pnpm-lock.yaml'] },

  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...restrictedGlobals],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'exit',
          message: 'Return an exit code; the entry point sets process.exitCode so output flushes.',
        },
      ],
      'no-restricted-syntax': ['error', ...hardcodedUrlRules, ...hardcodedFieldRules],
    },
  },
  {
    files: ['packages/core/src/main.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // RFC 8252 loopback redirect URIs are a protocol constant, not a deployment address.
    files: ['packages/core/src/oauth/login.ts'],
    rules: { 'no-restricted-syntax': ['error', ...hardcodedFieldRules] },
  },
  {
    // The Atlassian Cloud OAuth 2.0 (3LO) endpoints are fixed by Atlassian and the same for every
    // site, so they are protocol constants like the loopback redirect above. The Jira site itself
    // stays configuration.
    files: ['packages/jira/src/oauth.ts'],
    rules: { 'no-restricted-syntax': ['error', ...hardcodedFieldRules] },
  },
  {
    // Test doubles use reserved `.test` addresses that resolve nowhere.
    files: ['packages/*/src/testing/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...hardcodedFieldRules] },
  },
  {
    // The site names the project's own addresses.
    files: ['packages/site/src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...hardcodedFieldRules] },
  },
  {
    // Only the build script reports on the console: it writes files and says where.
    files: ['packages/site/src/build.ts'],
    rules: {
      'no-restricted-globals': ['error', ...restrictedGlobals.filter((g) => g.name !== 'console')],
    },
  },
  {
    files: ['packages/*/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  ...siblingImportBans,
);
