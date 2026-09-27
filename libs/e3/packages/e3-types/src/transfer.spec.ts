/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The dataset transfer protocol's part arithmetic, which the client that cuts
 * the bytes and the server that places them share, so an off-by-one on either
 * side would corrupt uploads silently until the commit's hash check.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { transferPartCount, transferPartRange } from './transfer.js';

describe('transferPartCount / transferPartRange', () => {
  it('cuts an upload into full parts and a remainder', () => {
    assert.strictEqual(transferPartCount(10, 4), 3);
    assert.deepStrictEqual(transferPartRange(10, 4, 1), { start: 0, end: 4 });
    assert.deepStrictEqual(transferPartRange(10, 4, 2), { start: 4, end: 8 });
    assert.deepStrictEqual(transferPartRange(10, 4, 3), { start: 8, end: 10 });
  });

  it('gives an exact multiple no empty trailing part', () => {
    assert.strictEqual(transferPartCount(8, 4), 2);
    assert.deepStrictEqual(transferPartRange(8, 4, 2), { start: 4, end: 8 });
    assert.strictEqual(transferPartRange(8, 4, 3), null);
  });

  it('sends an upload no larger than a part as one part', () => {
    assert.strictEqual(transferPartCount(3, 4), 1);
    assert.strictEqual(transferPartCount(4, 4), 1);
    assert.deepStrictEqual(transferPartRange(3, 4, 1), { start: 0, end: 3 });
  });

  it('has no part 0, no fractional part and none past the end', () => {
    assert.strictEqual(transferPartRange(10, 4, 0), null);
    assert.strictEqual(transferPartRange(10, 4, 1.5), null);
    assert.strictEqual(transferPartRange(10, 4, 4), null);
  });

  it('stays exact past 2^32 bytes, taking sizes as bigint or number', () => {
    const size = 5n * 1024n ** 4n + 1n; // 5 TiB and a byte
    const partBytes = 512n * 1024n ** 2n;
    assert.strictEqual(transferPartCount(size, partBytes), 10241);
    assert.deepStrictEqual(transferPartRange(Number(size), Number(partBytes), 10241), {
      start: Number(size) - 1,
      end: Number(size),
    });
  });
});
