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

import { describe } from 'node:test';
import { getStackOutputs, getDeploymentId } from './helpers/stack-outputs.js';
import { getToken, hasCredentials } from './helpers/credentials.js';
import { getTestConcurrency } from './helpers/concurrency.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createTestContext, allApiTests, transferTests, type TestContext, type TestSetup } from '@elaraai/e3-api-tests';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

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

const getCredentialsEnv = () => ({
  E3_CREDENTIALS_PATH: process.env.E3_CREDENTIALS_PATH ?? join(homedir(), '.e3', 'credentials.json'),
});

describe('API Compliance Tests', { timeout: 900_000, concurrency: getTestConcurrency(1) }, () => {
  allApiTests(setup);
  transferTests(setup, getCredentialsEnv);
});
