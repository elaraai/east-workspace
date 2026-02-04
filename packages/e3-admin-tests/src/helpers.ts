/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Test helpers for e3 admin API tests.
 */

import { strict as assert } from 'node:assert';
import { ApiError, AuthError } from '@elaraai/e3-admin-client';

/**
 * Assert that a promise rejects with an ApiError having the specified code.
 *
 * For 'unauthorized' errors, also accepts AuthError (which is thrown for 401 responses).
 *
 * @param promise - The promise expected to reject
 * @param expectedCode - The expected error code
 * @param message - Optional assertion message
 * @returns The caught ApiError for further inspection (or ApiError-like for AuthError)
 *
 * @example
 * ```typescript
 * await expectError(
 *   addUser(baseUrl, repo, { email: 'unknown@example.com', ... }, opts),
 *   'user_not_found'
 * );
 * ```
 */
export async function expectError(
  promise: Promise<unknown>,
  expectedCode: string,
  message?: string
): Promise<ApiError> {
  try {
    await promise;
    assert.fail(message ?? `Expected error '${expectedCode}' but operation succeeded`);
  } catch (error) {
    // AuthError is thrown for 401 responses (authentication failures)
    if (expectedCode === 'unauthorized' && error instanceof AuthError) {
      // Return a compatible object for tests that inspect the error
      return new ApiError('unauthorized', error.message);
    }
    assert.ok(error instanceof ApiError, `Expected ApiError, got ${error}`);
    assert.strictEqual(error.code, expectedCode, message);
    return error;
  }
}
