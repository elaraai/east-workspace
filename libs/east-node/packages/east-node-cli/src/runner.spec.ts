/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Output-encoding policy of the runner: collection outputs above the
 * segmentation threshold are written segmented + indexed (pageable by e3's
 * paged dataset reads); small outputs keep the whole-value encode
 * byte-for-byte.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ArrayType,
  IntegerType,
  East,
  decodeBeast2For,
  encodeBeast2For,
  encodeEastIR,
  openBeast2PagesFor,
} from '@elaraai/east';

import { runProgram } from './runner.js';

describe('runner output encoding', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'east-node-runner-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function runToOutput(count: bigint): Promise<Uint8Array> {
    const fn = East.function([], ArrayType(IntegerType), (_$) => East.Array.range(0n, count));
    const irPath = join(tempDir, 'program.beast2');
    writeFileSync(irPath, encodeEastIR(fn.toIR()));
    const outputPath = join(tempDir, 'output.beast2');
    await runProgram(irPath, [], [], [], outputPath);
    return new Uint8Array(readFileSync(outputPath));
  }

  it('writes large collection outputs segmented and indexed', async () => {
    const output = await runToOutput(2500n);
    const AT = ArrayType(IntegerType);
    const pages = openBeast2PagesFor(AT)(output);
    assert.equal(pages.segmentCount, 3);
    assert.equal(pages.elementCount, 2500);
    assert.ok(pages.selfContained);
    const expected = Array.from({ length: 2500 }, (_, i) => BigInt(i));
    assert.deepEqual(pages.slice(900, 200), expected.slice(900, 1100), 'window spans segments');
    assert.deepEqual(decodeBeast2For(AT)(output), expected, 'whole decode equals the result');
  });

  it('keeps small collection outputs byte-identical to the whole-value encode', async () => {
    const output = await runToOutput(100n);
    const AT = ArrayType(IntegerType);
    const expected = Array.from({ length: 100 }, (_, i) => BigInt(i));
    assert.deepEqual(Array.from(output), Array.from(encodeBeast2For(AT)(expected)));
    assert.throws(() => openBeast2PagesFor(AT)(output), /no index/);
  });
});
