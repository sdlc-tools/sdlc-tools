import { fileURLToPath } from 'node:url';
import { defineSharedProject } from '../../vitest.shared.js';

const shared = defineSharedProject();

export default {
  ...shared,
  resolve: {
    ...shared.resolve,
    alias: [
      {
        find: /^@sdlc-tools\/jira$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
};
