/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Output-encoding policy of the runner: collection-rooted outputs are ALWAYS
 * written segmented + indexed (pageable by e3's paged dataset reads), at
 * every size — one uniform encoding per logical value.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ArrayType,
  DictType,
  FunctionType,
  IntegerType,
  NullType,
  StringType,
  East,
  SortedMap,
  compareFor,
  decodeBeast2For,
  encodeBeast2PagedFor,
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

  it('writes small collection outputs segmented and indexed too', async () => {
    const output = await runToOutput(100n);
    const AT = ArrayType(IntegerType);
    const expected = Array.from({ length: 100 }, (_, i) => BigInt(i));
    const pages = openBeast2PagesFor(AT)(output);
    assert.equal(pages.segmentCount, 1);
    assert.equal(pages.elementCount, 100);
    assert.deepEqual(pages.slice(0, 100), expected);
    assert.deepEqual(decodeBeast2For(AT)(output), expected, 'whole decode equals the result');
  });
});

describe('runner streaming execution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'east-node-stream-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeIr(fn: { toIR(): any }): string {
    const irPath = join(tempDir, 'program.beast2');
    writeFileSync(irPath, encodeEastIR(fn.toIR()));
    return irPath;
  }

  it('a producer body emits an indexed Array output incrementally', async () => {
    const fn = East.function(
      [FunctionType([IntegerType], NullType)],
      NullType,
      ($, emit) => {
        $.for(East.Array.range(0n, 2500n), ($, i) => {
          $(emit(i.multiply(2n)));
        });
      },
    );
    const outputPath = join(tempDir, 'output.beast2');
    await runProgram(writeIr(fn), [], [], [], outputPath, { emit: 'array' });

    const output = new Uint8Array(readFileSync(outputPath));
    const pages = openBeast2PagesFor(ArrayType(IntegerType))(output);
    assert.equal(pages.elementCount, 2500);
    assert.ok(pages.selfContained);
    assert.equal(pages.element(1234), 2468n);
    const expected = Array.from({ length: 2500 }, (_, i) => BigInt(i * 2));
    assert.deepEqual(decodeBeast2For(ArrayType(IntegerType))(output), expected);
  });

  it('a stream input folds through emit with the input opened lazily', async () => {
    const AT = ArrayType(IntegerType);
    const events = Array.from({ length: 2500 }, (_, i) => BigInt(i));
    const inputPath = join(tempDir, 'events.beast2');
    writeFileSync(inputPath, encodeBeast2PagedFor(AT, { batchSize: 500 })(events));

    const fn = East.function(
      [AT, FunctionType([IntegerType], NullType)],
      NullType,
      ($, events, emit) => {
        const acc = $.let(0n);
        $.for(events, ($, v) => {
          $.assign(acc, acc.add(v));
          $(emit(acc));
        });
      },
    );
    const outputPath = join(tempDir, 'output.beast2');
    await runProgram(writeIr(fn), [], [], [inputPath], outputPath, { emit: 'array', streamInput: 0 });

    const decoded = decodeBeast2For(AT)(new Uint8Array(readFileSync(outputPath)));
    assert.equal(decoded.length, 2500);
    assert.equal(decoded[0], 0n);
    assert.equal(decoded[2499], (2499n * 2500n) / 2n);
  });

  it('a dict emit enforces strictly ascending key order', async () => {
    const emitType = FunctionType([IntegerType, StringType], NullType);
    const ordered = East.function([emitType], NullType, ($, emit) => {
      $.for(East.Array.range(0n, 1000n), ($, i) => {
        $(emit(i, East.str`row-${i}`));
      });
    });
    const outputPath = join(tempDir, 'output.beast2');
    await runProgram(writeIr(ordered), [], [], [], outputPath, { emit: 'dict' });
    const DT = DictType(IntegerType, StringType);
    const decoded = decodeBeast2For(DT)(new Uint8Array(readFileSync(outputPath)));
    assert.equal(decoded.size, 1000);
    assert.equal(decoded.get(42n), 'row-42');

    const descending = East.function([emitType], NullType, ($, emit) => {
      $(emit(2n, 'b'));
      $(emit(1n, 'a'));
    });
    await assert.rejects(
      runProgram(writeIr(descending), [], [], [], join(tempDir, 'bad.beast2'), { emit: 'dict' }),
      /strictly ascending in East key order/,
    );
  });

  it('a lazy dict input serves keyed reads without a whole decode', async () => {
    const DT = DictType(IntegerType, StringType);
    const table = new SortedMap<bigint, string>(
      Array.from({ length: 2000 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]),
      compareFor(IntegerType),
    );
    const inputPath = join(tempDir, 'table.beast2');
    writeFileSync(inputPath, encodeBeast2PagedFor(DT, { batchSize: 250 })(table));

    const fn = East.function([DT], StringType, ($, table) => table.get(1234n));
    const outputPath = join(tempDir, 'output.beast2');
    // Threshold of 1 byte forces the lazy open for any input size.
    await runProgram(writeIr(fn), [], [], [inputPath], outputPath, { lazyInputBytes: 1 });

    const result = decodeBeast2For(StringType)(new Uint8Array(readFileSync(outputPath)));
    assert.equal(result, 'row-1234');
  });
});
