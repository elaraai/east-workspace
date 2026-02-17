/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud Cleanup Tests
 *
 * Runs cascade deletion and orphan cleanup tests against the deployed cloud server.
 * These tests verify that task configs (compute, timeout, schedule) are properly
 * cleaned up when workspaces are deleted or packages are redeployed.
 *
 * Prerequisites:
 * - Must be logged in: e3 login https://dev.e3.elaraai.com
 * - AWS credentials must be available for stack lookups
 *
 * Run:
 *   cd test/integration
 *   AWS_PROFILE=elaraai-dev-elara-e3 npm run build && \
 *     node --enable-source-maps --test 'dist/cloud-cleanup.spec.js'
 */

import { describe, beforeEach, afterEach } from 'node:test';
import { getStackOutputs, getDeploymentId } from './helpers/stack-outputs.js';
import { getToken, hasCredentials } from './helpers/credentials.js';
import { createTestContext, type TestContext } from '@elaraai/e3-api-tests';
import { cleanupTests } from '@elaraai/e3-cloud-tests';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

describe('Cloud Cleanup Tests', { timeout: 120_000, concurrency: false }, () => {
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

  // Run cleanup tests
  cleanupTests(() => context);
});
