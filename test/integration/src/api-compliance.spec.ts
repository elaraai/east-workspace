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

import { describe, beforeEach, afterEach } from 'node:test';
import { getStackOutputs, getDeploymentId } from './helpers/stack-outputs.js';
import { getToken, hasCredentials } from './helpers/credentials.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createTestContext, allApiTests, transferTests, type TestContext } from '@elaraai/e3-api-tests';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

describe('API Compliance Tests', { timeout: 900000, concurrency: false }, () => {
  let context: TestContext;
  let baseUrl: string;

  beforeEach(async () => {
    // Get deployment info
    const deploymentId = getDeploymentId();
    const outputs = await getStackOutputs(deploymentId);
    baseUrl = outputs.platformUrl ?? DEFAULT_SERVER;

    // Check credentials before running tests (only log once)
    if (!hasCredentials(baseUrl)) {
      console.error(`\nError: Not logged in to ${baseUrl}`);
      console.error(`Run: e3 login ${baseUrl}\n`);
      throw new Error(`Not logged in. Run: e3 login ${baseUrl}`);
    }

    // Create fresh test context for each test
    context = await createTestContext({
      baseUrl,
      getToken: async () => getToken(baseUrl),
      cleanup: true,
    });
  });

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  // Run all API compliance tests from e3-api-tests
  allApiTests(() => context);

  // Run transfer tests (export/import roundtrip)
  const getCredentialsEnv = () => ({
    E3_CREDENTIALS_PATH: process.env.E3_CREDENTIALS_PATH ?? join(homedir(), '.e3', 'credentials.json'),
  });
  transferTests(() => context, getCredentialsEnv);
});
