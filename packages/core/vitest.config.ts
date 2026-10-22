import { fileURLToPath } from 'node:url';
import { defineSharedProject } from '../../vitest.shared.js';

// Lets tests import the package by its own name, like a consumer would.
const shared = defineSharedProject();

export default {
  ...shared,
  resolve: {
    ...shared.resolve,
    alias: [
      {
        find: /^@sdlc-tools\/core$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^@sdlc-tools\/core\/testing$/,
        replacement: fileURLToPath(new URL('./src/testing/index.ts', import.meta.url)),
      },
    ],
  },
};
