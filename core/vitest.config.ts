import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    server: {
      deps: {
        // Vite's builtin-module list predates node:sqlite (Node 22.5+).
        external: [/^node:sqlite$/],
      },
    },
  },
});
