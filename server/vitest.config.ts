import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      CLIENT_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-1234',
    },
  },
});
