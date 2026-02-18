/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud Compute Tests
 *
 * Runs the Fargate compute execution tests against the deployed cloud server.
 * These tests verify that tasks configured with non-serverless compute sizes
 * execute successfully on ECS Fargate.
 *
 * Prerequisites:
 * - Must be logged in: e3 login https://dev.e3.elaraai.com
 * - AWS credentials must be available for stack lookups
 * - Fargate infrastructure must be deployed (ECS cluster, task definitions)
 *
 * Run:
 *   cd test/integration
 *   AWS_PROFILE=elaraai-dev-elara-e3 npm run build && \
 *     node --enable-source-maps --test 'dist/cloud-compute.spec.js'
 */

import { describe, beforeEach, afterEach } from 'node:test';
import { getStackOutputs, getDeploymentId } from './helpers/stack-outputs.js';
import { getToken, hasCredentials } from './helpers/credentials.js';
import { createTestContext, type TestContext } from '@elaraai/e3-api-tests';
import { computeTests, computeFailureTests } from '@elaraai/e3-cloud-tests';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

describe('Cloud Compute Tests', { timeout: 1_800_000, concurrency: false }, () => {
  let context: TestContext;

  beforeEach(async () => {
    // Get deployment info
    const deploymentId = getDeploymentId();
    const outputs = await getStackOutputs(deploymentId);
    const baseUrl = outputs.platformUrl ?? DEFAULT_SERVER;

    // Check credentials before running tests
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

  // Run Fargate compute execution tests
  computeTests(() => context);

  // Run failure propagation tests
  computeFailureTests(() => context);
});
