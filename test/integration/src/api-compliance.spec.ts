/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * API Compliance Tests
 *
 * Runs the shared e3-api-tests suites against the deployed cloud server.
 * These tests verify that the cloud implementation conforms to the
 * e3 API contract.
 *
 * Prerequisites:
 * - Must be logged in: e3 login https://dev.e3.elaraai.com
 * - AWS credentials must be available for stack lookups
 */

import { describe, before, after } from 'node:test';
import { getStackOutputs, getDeploymentId } from './helpers/stack-outputs.js';
import { getToken, hasCredentials } from './helpers/credentials.js';
import { createTestContext, allApiTests, type TestContext } from '@elaraai/e3-api-tests';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

describe('API Compliance Tests', { timeout: 300000 }, () => {
  let context: TestContext;
  let baseUrl: string;

  before(async () => {
    // Get deployment info
    const deploymentId = getDeploymentId();
    const outputs = await getStackOutputs(deploymentId);
    baseUrl = outputs.platformUrl ?? DEFAULT_SERVER;

    console.log(`\nRunning API compliance tests against: ${baseUrl}`);

    // Check credentials before running tests
    if (!hasCredentials(baseUrl)) {
      console.error(`\nError: Not logged in to ${baseUrl}`);
      console.error(`Run: e3 login ${baseUrl}\n`);
      throw new Error(`Not logged in. Run: e3 login ${baseUrl}`);
    }

    // Create test context
    context = await createTestContext({
      baseUrl,
      getToken: async () => getToken(baseUrl),
      cleanup: true,
    });

    console.log(`Test repository: ${context.repoName}\n`);
  });

  after(async () => {
    if (context) {
      console.log('\nCleaning up test resources...');
      await context.cleanup();
    }
  });

  // Run all API compliance tests from e3-api-tests
  allApiTests(() => context);
});
