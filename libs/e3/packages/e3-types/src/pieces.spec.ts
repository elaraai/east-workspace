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
import { PIECE_SIZES, pieceSizesFor } from './index.js';

const MiB = 2 ** 20;
const GiB = 2 ** 30;

describe('PIECE_SIZES', () => {
  it('is 16, 64 and 256 MiB, exported from the package', () => {
    assert.deepEqual(PIECE_SIZES, { min: 16 * MiB, target: 64 * MiB, max: 256 * MiB });
  });

  it('orders its sizes: the least a piece holds, its middle, and the most', () => {
    assert.ok(PIECE_SIZES.min < PIECE_SIZES.target && PIECE_SIZES.target < PIECE_SIZES.max);
  });
});

describe('pieceSizesFor', () => {
  /** The target an input of `bytes` is cut at. */
  const target = (bytes: number): number => pieceSizesFor(bytes).target / MiB;

  it('gives an input of at most 16 MiB the platform sizes, so it is one piece', () => {
    for (const bytes of [0, 1, 4 * MiB, 16 * MiB]) assert.equal(pieceSizesFor(bytes), PIECE_SIZES, `${bytes} bytes`);
  });

  it('cuts an input past 16 MiB at a 4 MiB target, until its 32nd part reaches 8 MiB', () => {
    assert.equal(target(16 * MiB + 1), 4);
    assert.equal(target(100 * MiB), 4);
    assert.equal(target(256 * MiB - 1), 4);
  });

  it('steps the target up as an input passes 256 MiB, 512 MiB, 1 GiB and 2 GiB', () => {
    assert.equal(target(256 * MiB), 8);
    assert.equal(target(512 * MiB - 1), 8);
    assert.equal(target(512 * MiB), 16);
    assert.equal(target(1e9), 16);
    assert.equal(target(1 * GiB - 1), 16);
    assert.equal(target(1 * GiB), 32);
    assert.equal(target(2 * GiB - 1), 32);
    assert.equal(target(2 * GiB), 64);
  });

  it('gives an input of 2 GiB or more the platform sizes', () => {
    for (const bytes of [2 * GiB, 16 * GiB, 1024 * GiB]) assert.deepEqual(pieceSizesFor(bytes), PIECE_SIZES, `${bytes / GiB} GiB`);
  });

  it('keeps the platform ratios: min a quarter of the target, max four times it', () => {
    for (const bytes of [17 * MiB, 300 * MiB, 700 * MiB, 1.5 * GiB]) {
      const sizes = pieceSizesFor(bytes);
      assert.deepEqual(sizes, { min: sizes.target / 4, target: sizes.target, max: sizes.target * 4 });
    }
  });

  it('cuts mid-size data into tens of pieces', () => {
    // The 32nd part, rounded down to a power of two: from 32 to 64 targets.
    for (const bytes of [128 * MiB, 300 * MiB, 1e9, 1.9 * GiB]) {
      const pieces = bytes / pieceSizesFor(bytes).target;
      assert.ok(pieces >= 32 && pieces < 64, `${bytes} bytes: ${pieces} targets`);
    }
  });
});
