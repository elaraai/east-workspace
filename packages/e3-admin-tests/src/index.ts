/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * e3-admin-tests: Portable integration tests for e3 admin authorization API
 *
 * This package provides test suites that can be run against any cloud deployment
 * of e3. Tests are parameterized via `AdminTestConfig`, allowing the same tests
 * to work with AWS (Cognito), Azure (Entra ID), GCP (Identity Platform), etc.
 *
 * @example
 * ```typescript
 * import { describe, beforeEach, afterEach } from 'node:test';
 * import { createAdminTestContext, allAdminTests, type AdminTestContext } from '@elaraai/e3-admin-tests';
 *
 * describe('Admin API Compliance', () => {
 *   let context: AdminTestContext;
 *
 *   beforeEach(async () => {
 *     context = await createAdminTestContext({
 *       baseUrl: 'https://dev.e3.elaraai.com',
 *       getToken: (userId) => getTokenFromCognito(userId),
 *       getTestUser: (userId) => getTestUserFromEnv(userId),
 *     });
 *   });
 *
 *   afterEach(async () => {
 *     await context?.cleanup();
 *   });
 *
 *   // Register all test suites
 *   allAdminTests(() => context);
 * });
 * ```
 */

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

// Import suites for allAdminTests
import { whoamiTests } from './suites/whoami.js';
import { repoUsersTests } from './suites/repo-users.js';
import { authorizationTests } from './suites/authorization.js';
import { scheduleTests } from './suites/schedules.js';
import { taskConfigTests } from './suites/task-configs.js';
import type { AdminTestContext } from './context.js';

/**
 * Register all admin API test suites.
 *
 * This is a convenience function that registers all available test suites.
 * Call this in your test file after setting up beforeEach/afterEach hooks.
 *
 * @param getContext - Function that returns the current test context
 */
export function allAdminTests(getContext: () => AdminTestContext): void {
  whoamiTests(getContext);
  repoUsersTests(getContext);
  authorizationTests(getContext);
  scheduleTests(getContext);
  taskConfigTests(getContext);
}
