/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The dataset transfer protocol's two invariants that live in e3-types.
 *
 * Part arithmetic is shared by the client that cuts the bytes and the server
 * that places them, so an off-by-one on either side would corrupt uploads
 * silently until the commit's hash check. And protocol 2 only adds variant
 * cases: a version-1 client decodes a version-1 answer from a new server, and a
 * new client decodes an old server's answers, only while every added case sorts
 * after the version-1 cases and so leaves their tags unchanged.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { NullType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, variant } from '@elaraai/east';
import {
  TransferDoneResponseType,
  TransferUploadResponseType,
  transferPartCount,
  transferPartRange,
} from './transfer.js';

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

describe('transfer wire compatibility across protocol versions', () => {
  // The version-1 shapes, as a client and server built before protocol 2 hold them.
  const UploadResponseV1 = VariantType({
    completed: NullType,
    upload: StructType({ id: StringType, uploadUrl: StringType }),
  });
  const DoneResponseV1 = VariantType({
    completed: NullType,
    error: StructType({ message: StringType }),
  });

  it('keeps the init answers a version-1 client decodes', () => {
    const upload = variant('upload', { id: 'abc', uploadUrl: 'http://h/api/uploads/abc' });
    assert.deepStrictEqual(
      decodeBeast2For(UploadResponseV1)(encodeBeast2For(TransferUploadResponseType)(upload)),
      upload,
    );
    assert.deepStrictEqual(
      decodeBeast2For(TransferUploadResponseType)(encodeBeast2For(UploadResponseV1)(upload)),
      upload,
    );
    const completed = variant('completed', null);
    assert.deepStrictEqual(
      decodeBeast2For(UploadResponseV1)(encodeBeast2For(TransferUploadResponseType)(completed)),
      completed,
    );
  });

  it('keeps the commit answers a version-1 client decodes', () => {
    for (const done of [variant('completed', null), variant('error', { message: 'hash mismatch' })] as const) {
      assert.deepStrictEqual(decodeBeast2For(DoneResponseV1)(encodeBeast2For(TransferDoneResponseType)(done)), done);
      assert.deepStrictEqual(decodeBeast2For(TransferDoneResponseType)(encodeBeast2For(DoneResponseV1)(done)), done);
    }
  });
});
