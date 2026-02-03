/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Test context and configuration for admin API integration tests.
 *
 * This module provides the infrastructure for running portable integration tests
 * across different cloud providers (AWS, Azure, GCP).
 */

import type { RequestOptions } from '@elaraai/e3-admin-client';

/**
 * Test user identifiers for multi-user scenarios.
 *
 * - owner: A regular user who owns test repositories
 * - member: A regular user who is added as a member
 * - outsider: A regular user with no repository access
 * - admin: A server admin (in the admins group)
 */
export type TestUserId = 'owner' | 'member' | 'outsider' | 'admin';

/**
 * Test user identity information.
 */
export interface TestUser {
  /** User's unique identifier (Cognito sub, Azure OID, etc.) */
  sub: string;
  /** User's email address */
  email: string;
}

/**
 * Configuration for creating a test context.
 *
 * This configuration is provided by cloud-specific consumers (e.g., AWS tests)
 * and allows the portable test suites to work with any identity provider.
 */
export interface AdminTestConfig {
  /** Base URL of the e3 server (e.g., 'https://dev.e3.elaraai.com') */
  baseUrl: string;

  /**
   * Get an access token for a test user.
   *
   * The implementation should handle token refresh if needed.
   */
  getToken: (userId: TestUserId) => Promise<string>;

  /**
   * Get identity information for a test user.
   *
   * This is used to verify API responses and set up test data.
   */
  getTestUser: (userId: TestUserId) => Promise<TestUser>;

  /**
   * Whether to clean up test repositories after tests.
   * Default: true
   */
  cleanup?: boolean;
}

/**
 * Runtime context for admin API tests.
 *
 * Created by `createAdminTestContext` and passed to test suites.
 */
export interface AdminTestContext {
  /** The configuration used to create this context */
  config: AdminTestConfig;

  /** Unique repository name for this test run */
  repoName: string;

  /**
   * Get request options for a test user.
   *
   * @param userId - Which test user to authenticate as (default: 'owner')
   * @returns RequestOptions with authentication token
   */
  opts: (userId?: TestUserId) => Promise<RequestOptions>;

  /**
   * Get identity information for a test user.
   */
  getTestUser: (userId: TestUserId) => Promise<TestUser>;

  /**
   * Clean up test resources.
   *
   * Should be called after tests complete (typically in afterEach).
   */
  cleanup: () => Promise<void>;
}

/**
 * Generate a unique test repository name.
 */
function generateRepoName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `admin-test-${timestamp}-${random}`;
}

/**
 * Create a test context for running admin API tests.
 *
 * @param config - Cloud-specific configuration
 * @returns Test context with helper methods
 *
 * @example
 * ```typescript
 * const ctx = await createAdminTestContext({
 *   baseUrl: 'https://dev.e3.elaraai.com',
 *   getToken: (userId) => getTokenFromCognito(userId),
 *   getTestUser: (userId) => getTestUserFromEnv(userId),
 * });
 *
 * // Use in tests
 * const response = await whoami(ctx.config.baseUrl, await ctx.opts('owner'));
 * ```
 */
export async function createAdminTestContext(
  config: AdminTestConfig
): Promise<AdminTestContext> {
  const repoName = generateRepoName();

  const opts = async (userId: TestUserId = 'owner'): Promise<RequestOptions> => {
    const token = await config.getToken(userId);
    return { token };
  };

  const cleanup = async (): Promise<void> => {
    if (config.cleanup === false) return;

    // Try to delete the test repository if it was created
    // This is a best-effort cleanup - we don't fail if it doesn't work
    try {
      const token = await config.getToken('owner');
      await fetch(`${config.baseUrl}/api/repos/${encodeURIComponent(repoName)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    config,
    repoName,
    opts,
    getTestUser: config.getTestUser,
    cleanup,
  };
}
