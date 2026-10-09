/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { STOCK_PLATFORM_FAMILIES, STOCK_PLATFORMS_BY_RUNNER } from './runner.js';

it('assigns every stock platform to exactly one runtime', () => {
  const platforms = Object.values(STOCK_PLATFORMS_BY_RUNNER).flat();
  assert.deepEqual([...platforms].sort(), STOCK_PLATFORM_FAMILIES.flat().sort());
  assert.equal(new Set(platforms).size, platforms.length);
});
