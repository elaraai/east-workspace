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

import { describe } from 'node:test';
import { getStackOutputs, getDeploymentId } from './helpers/stack-outputs.js';
import { getToken, hasCredentials } from './helpers/credentials.js';
import { createTestContext, type TestContext } from '@elaraai/e3-api-tests';
import { cleanupTests, type TestSetup } from '@elaraai/e3-cloud-tests';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

// Lazy config resolution (called once, cached)
const getConfig = (() => {
  let cached: Promise<{ baseUrl: string }> | null = null;
  return () => (cached ??= (async () => {
    const outputs = await getStackOutputs(getDeploymentId());
    const baseUrl = outputs.platformUrl ?? DEFAULT_SERVER;
    if (!hasCredentials(baseUrl)) throw new Error(`Not logged in. Run: e3 login ${baseUrl}`);
    return { baseUrl };
  })());
})();

const setup: TestSetup<TestContext> = async (t) => {
  const { baseUrl } = await getConfig();
  const ctx = await createTestContext({
    baseUrl,
    getToken: async () => getToken(baseUrl),
    cleanup: true,
  });
  t.after(() => ctx.cleanup());
  return ctx;
};

describe('Cloud Cleanup Tests', { timeout: 120_000, concurrency: true }, () => {
  // Run cleanup tests
  cleanupTests(setup);
});
