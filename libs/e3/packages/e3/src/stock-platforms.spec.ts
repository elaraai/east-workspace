/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_PLATFORM_BY_RUNNER, STOCK_PLATFORM_FAMILIES, STOCK_PLATFORMS_BY_RUNNER } from './runner.js';

it('assigns every stock platform to exactly one runtime', () => {
  const platforms = Object.values(STOCK_PLATFORMS_BY_RUNNER).flat();
  assert.deepEqual([...platforms].sort(), STOCK_PLATFORM_FAMILIES.flat().sort());
  assert.equal(new Set(platforms).size, platforms.length);
});

it('names one standard package for each runtime, among its stock packages, and the standard library\'s family is theirs', () => {
  for (const [runtime, standard] of Object.entries(STANDARD_PLATFORM_BY_RUNNER)) {
    assert.ok((STOCK_PLATFORMS_BY_RUNNER[runtime as keyof typeof STOCK_PLATFORMS_BY_RUNNER] as readonly string[]).includes(standard), runtime);
  }
  assert.deepEqual([...STOCK_PLATFORM_FAMILIES[0]!].sort(), Object.values(STANDARD_PLATFORM_BY_RUNNER).sort());
});
