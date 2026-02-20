/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * e3-cloud-tests: Portable integration tests for e3 cloud deployments
 *
 * This package provides test suites that can be run against any cloud deployment
 * of e3. Admin tests are parameterized via `AdminTestConfig`, allowing the same
 * tests to work with AWS (Cognito), Azure (Entra ID), GCP (Identity Platform),
 * etc. Compute tests use `TestContext` from e3-api-tests for package deployment.
 *
 * @example
 * ```typescript
 * import { describe } from 'node:test';
 * import { createAdminTestContext, allAdminTests, type AdminTestContext, type TestSetup } from '@elaraai/e3-cloud-tests';
 *
 * const setup: TestSetup<AdminTestContext> = async (t) => {
 *   const ctx = createAdminTestContext({
 *     baseUrl: 'https://dev.e3.elaraai.com',
 *     getToken: (userId) => getTokenFromCognito(userId),
 *     getTestUser: (userId) => getTestUserFromEnv(userId),
 *   });
 *   t.after(() => ctx.cleanup());
 *   return ctx;
 * };
 *
 * describe('Admin API Compliance', { concurrency: true }, () => {
 *   allAdminTests(setup);
 * });
 * ```
 */

// TestSetup type
export { type TestSetup } from './setup.js';

// Context and configuration
export {
  createAdminTestContext,
  type AdminTestConfig,
  type AdminTestContext,
  type TestUserId,
  type TestUser,
} from './context.js';

// Test helpers
export { expectError } from './helpers.js';

// Individual test suites
export { whoamiTests } from './suites/whoami.js';
export { repoUsersTests } from './suites/repo-users.js';
export { authorizationTests } from './suites/authorization.js';
export { scheduleTests } from './suites/schedules.js';
export { taskConfigTests } from './suites/task-configs.js';
export { computeTests } from './suites/compute.js';
export { computeFailureTests } from './suites/compute-failure.js';
export { cleanupTests } from './suites/cleanup.js';

// Re-export TestContext type for convenience
export type { TestContext } from '@elaraai/e3-api-tests';

// Import suites for allAdminTests
import { whoamiTests } from './suites/whoami.js';
import { repoUsersTests } from './suites/repo-users.js';
import { authorizationTests } from './suites/authorization.js';
import { scheduleTests } from './suites/schedules.js';
import { taskConfigTests } from './suites/task-configs.js';
import type { AdminTestContext } from './context.js';
import type { TestSetup } from './setup.js';

/**
 * Register all admin API test suites.
 *
 * This is a convenience function that registers all available test suites.
 * Call this in your test file after creating a TestSetup factory.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function allAdminTests(setup: TestSetup<AdminTestContext>): void {
  whoamiTests(setup);
  repoUsersTests(setup);
  authorizationTests(setup);
  scheduleTests(setup);
  taskConfigTests(setup);
}
