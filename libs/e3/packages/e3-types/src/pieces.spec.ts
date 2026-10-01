/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The platform's piece sizes, which e3-core's piece rule closes pieces at and
 * a caller planning a split call weighs a dataset against.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PIECE_SIZES } from './index.js';

describe('PIECE_SIZES', () => {
  it('is 16, 64 and 256 MiB, exported from the package', () => {
    assert.deepEqual(PIECE_SIZES, { min: 16 * 2 ** 20, target: 64 * 2 ** 20, max: 256 * 2 ** 20 });
  });

  it('orders its sizes: the least a piece holds, its middle, and the most', () => {
    assert.ok(PIECE_SIZES.min < PIECE_SIZES.target && PIECE_SIZES.target < PIECE_SIZES.max);
  });
});
