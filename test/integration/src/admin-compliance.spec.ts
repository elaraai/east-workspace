/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Admin API Compliance Tests
 *
 * Runs the shared e3-admin-tests suites against the deployed cloud server.
 * These tests verify that the cloud implementation conforms to the admin
 * authorization API contract.
 *
 * Prerequisites:
 * - Must have 4 test users provisioned in Cognito:
 *   - owner@test.elaraai.com (regular user)
 *   - member@test.elaraai.com (regular user)
 *   - outsider@test.elaraai.com (regular user)
 *   - admin@test.elaraai.com (in e3-admins group)
 *
 * - Credentials must be available via environment variables:
 *   E3_TEST_OWNER_TOKEN, E3_TEST_OWNER_SUB, E3_TEST_OWNER_EMAIL
 *   E3_TEST_MEMBER_TOKEN, E3_TEST_MEMBER_SUB, E3_TEST_MEMBER_EMAIL
 *   E3_TEST_OUTSIDER_TOKEN, E3_TEST_OUTSIDER_SUB, E3_TEST_OUTSIDER_EMAIL
 *   E3_TEST_ADMIN_TOKEN, E3_TEST_ADMIN_SUB, E3_TEST_ADMIN_EMAIL
 *
 * Or via credential files:
 *   ~/.e3/test-credentials-owner.json
 *   ~/.e3/test-credentials-member.json
 *   etc.
 *
 * Run:
 *   cd test/integration
 *   AWS_PROFILE=elaraai-dev-elara-e3 npm test -- --test-name-pattern "Admin"
 */

import { describe, beforeEach, afterEach, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getStackOutputs, getDeploymentId, type StackOutputs } from './helpers/stack-outputs.js';
import { getToken as getDefaultToken, hasCredentials } from './helpers/credentials.js';
import { CognitoTestAuth, type AuthResult } from './helpers/cognito-auth.js';
import {
  createAdminTestContext,
  allAdminTests,
  type AdminTestContext,
  type AdminTestConfig,
  type TestUserId,
  type TestUser,
} from '@elaraai/e3-admin-tests';

const DEFAULT_SERVER = 'https://dev.e3.elaraai.com';

/**
 * Test user credentials from environment or credential files.
 */
interface TestUserCredentials {
  token: string;
  sub: string;
  email: string;
}

/** Cached Cognito auth instance */
let cognitoAuth: CognitoTestAuth | null = null;

/** Cached stack outputs for credential checks */
let cachedOutputs: StackOutputs | null = null;

/**
 * Initialize Cognito auth if test users are configured in the stack.
 */
async function initCognitoAuth(outputs: StackOutputs): Promise<CognitoTestAuth | null> {
  if (!outputs.testUserSecretArn) {
    return null;
  }

  if (!cognitoAuth) {
    cognitoAuth = new CognitoTestAuth({
      userPoolId: outputs.userPoolId,
      clientId: outputs.userPoolClientId,
      secretArn: outputs.testUserSecretArn,
    });
  }

  return cognitoAuth;
}

/**
 * Read credentials for a test user.
 *
 * Tries in order:
 * 1. Cognito authentication (if testUserSecretArn is available)
 * 2. Environment variables (E3_TEST_{USER}_TOKEN, etc.)
 * 3. Credential file (~/.e3/test-credentials-{user}.json)
 */
async function getTestUserCredentialsAsync(
  userId: TestUserId,
  outputs: StackOutputs
): Promise<TestUserCredentials | null> {
  // Try Cognito authentication first (preferred method)
  const auth = await initCognitoAuth(outputs);
  if (auth) {
    try {
      const result = await auth.authenticate(userId);
      return {
        token: result.accessToken,
        sub: result.sub,
        email: result.email,
      };
    } catch (err) {
      console.warn(`Cognito auth failed for ${userId}, falling back to manual credentials:`, err);
    }
  }

  // Fall back to environment variables
  const envPrefix = `E3_TEST_${userId.toUpperCase()}`;
  const envToken = process.env[`${envPrefix}_TOKEN`];
  const envSub = process.env[`${envPrefix}_SUB`];
  const envEmail = process.env[`${envPrefix}_EMAIL`];

  if (envToken && envSub && envEmail) {
    return { token: envToken, sub: envSub, email: envEmail };
  }

  // Try credential file
  const credPath = join(homedir(), '.e3', `test-credentials-${userId}.json`);
  if (existsSync(credPath)) {
    try {
      const creds = JSON.parse(readFileSync(credPath, 'utf-8')) as TestUserCredentials;
      if (creds.token && creds.sub && creds.email) {
        return creds;
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Synchronous check for credentials (used during test setup).
 * Returns true if Cognito test users are available or manual credentials exist.
 */
function getTestUserCredentials(userId: TestUserId, baseUrl: string): TestUserCredentials | null {
  const envPrefix = `E3_TEST_${userId.toUpperCase()}`;

  // Try environment variables first
  const envToken = process.env[`${envPrefix}_TOKEN`];
  const envSub = process.env[`${envPrefix}_SUB`];
  const envEmail = process.env[`${envPrefix}_EMAIL`];

  if (envToken && envSub && envEmail) {
    return { token: envToken, sub: envSub, email: envEmail };
  }

  // Try credential file
  const credPath = join(homedir(), '.e3', `test-credentials-${userId}.json`);
  if (existsSync(credPath)) {
    try {
      const creds = JSON.parse(readFileSync(credPath, 'utf-8')) as TestUserCredentials;
      if (creds.token && creds.sub && creds.email) {
        return creds;
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Check if multi-user test credentials are available.
 * Returns true if Cognito test users are enabled OR manual credentials exist.
 */
function hasMultiUserCredentials(outputs?: StackOutputs): boolean {
  // If Cognito test users are enabled, we have credentials
  if (outputs?.testUserSecretArn) {
    return true;
  }

  // Check for manual credentials
  const requiredUsers: TestUserId[] = ['owner', 'member', 'outsider', 'admin'];
  return requiredUsers.every(userId => {
    const envPrefix = `E3_TEST_${userId.toUpperCase()}`;
    const hasEnv = !!(process.env[`${envPrefix}_TOKEN`] && process.env[`${envPrefix}_SUB`]);
    const hasFile = existsSync(join(homedir(), '.e3', `test-credentials-${userId}.json`));
    return hasEnv || hasFile;
  });
}

describe('Admin API Compliance Tests', { timeout: 300000, concurrency: false }, () => {
  let context: AdminTestContext;
  let baseUrl: string;
  let outputs: StackOutputs;

  beforeEach(async () => {
    // Get deployment info
    const deploymentId = getDeploymentId();
    outputs = await getStackOutputs(deploymentId);
    cachedOutputs = outputs;
    baseUrl = outputs.platformUrl ?? DEFAULT_SERVER;

    // Check if multi-user credentials are available
    if (!hasMultiUserCredentials(outputs)) {
      console.warn('\nWarning: Multi-user test credentials not configured.');
      console.warn('Admin compliance tests require 4 test users to be configured.');
      console.warn('See test/integration/README.md for setup instructions.\n');
      console.warn('Skipping admin tests...\n');
      return;
    }

    // Log authentication method
    if (outputs.testUserSecretArn) {
      console.log('Using Cognito test users for authentication');
    } else {
      console.log('Using manual credentials for authentication');
    }

    // Create test config with multi-user support
    const config: AdminTestConfig = {
      baseUrl,
      getToken: async (userId: TestUserId): Promise<string> => {
        const creds = await getTestUserCredentialsAsync(userId, outputs);
        if (!creds) {
          throw new Error(
            `No credentials for test user '${userId}'. ` +
            `Set E3_TEST_${userId.toUpperCase()}_TOKEN or create ~/.e3/test-credentials-${userId}.json`
          );
        }
        return creds.token;
      },
      getTestUser: async (userId: TestUserId): Promise<TestUser> => {
        const creds = await getTestUserCredentialsAsync(userId, outputs);
        if (!creds) {
          throw new Error(
            `No credentials for test user '${userId}'. ` +
            `Set E3_TEST_${userId.toUpperCase()}_SUB and E3_TEST_${userId.toUpperCase()}_EMAIL`
          );
        }
        return { sub: creds.sub, email: creds.email };
      },
      cleanup: true,
    };

    // Create fresh test context for each test
    context = await createAdminTestContext(config);
  });

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  // Skip tests if credentials not configured
  it('should have multi-user credentials configured', async () => {
    // This test verifies credentials are available
    // Other tests will skip if context is not initialized
    if (!hasMultiUserCredentials(cachedOutputs ?? undefined)) {
      console.log('Skipping: Multi-user credentials not configured');
      console.log('Either enable testUsers in deployment config or set manual credentials.');
      return;
    }
  });

  // Always register the admin compliance tests
  // They will check for context in their setup and skip if not available
  allAdminTests(() => context);
});
