/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Test concurrency configuration.
 *
 * Set TEST_CONCURRENCY to control parallelism:
 * - "true" or unset: unlimited concurrency (default)
 * - "false" or "1": sequential execution
 * - any number: that many tests in parallel (e.g., "4")
 */

export function getTestConcurrency(fallback: number | boolean = true): number | boolean {
  const env = process.env.TEST_CONCURRENCY;
  if (env === undefined || env === '') return fallback;
  if (env === 'true') return true;
  if (env === 'false') return false;
  const n = parseInt(env, 10);
  if (isNaN(n) || n < 1) return fallback;
  return n;
}
