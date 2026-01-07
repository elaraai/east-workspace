import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests run against deployed infrastructure
    include: ['test/integration/**/*.test.ts'],

    // Longer timeouts for AWS API calls
    testTimeout: 30000,
    hookTimeout: 60000,

    // Run tests sequentially (some tests may have dependencies)
    sequence: {
      concurrent: false,
    },

    // Reporter for CI/local
    reporters: process.env.CI ? ['verbose', 'json'] : ['verbose'],

    // Pass through AWS environment variables
    env: {
      AWS_REGION: process.env.AWS_REGION ?? 'ap-southeast-2',
    },
  },
});
