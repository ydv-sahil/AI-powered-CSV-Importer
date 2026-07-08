import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `config/env.ts` validates at import time and would otherwise demand a real
    // API key just to run the unit tests.
    env: {
      NODE_ENV: 'test',
      LLM_PROVIDER: 'mock',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
