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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ArrayType,
  DictType,
  FunctionType,
  IntegerType,
  NullType,
  SetType,
  StringType,
  StructType,
  East,
  SortedMap,
  compareFor,
  decodeBeast2For,
  encodeBeast2PagedFor,
  encodeEastIR,
  openBeast2PagesFor,
} from '@elaraai/east';

import { runProgram, lazyThreshold } from './runner.js';

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

  /** The 0..count keys in a deterministic Fisher-Yates shuffle, so the
   *  disorder the sink must absorb is stable across runs. */
  function shuffledKeys(count: number): bigint[] {
    const keys = Array.from({ length: count }, (_, i) => BigInt(i));
    let seed = 12345;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [keys[i], keys[j]] = [keys[j]!, keys[i]!];
    }
    return keys;
  }

  /** A dict producer emitting `row-${i}` for each key in the given order. */
  function dictEmitter(order: bigint[]) {
    const emitType = FunctionType([IntegerType, StringType], NullType);
    return East.function([emitType], NullType, ($, emit) => {
      $.for($.const(order, ArrayType(IntegerType)), ($, i) => {
        $(emit(i, East.str`row-${i}`));
      });
    });
  }

  it('a dict emit accepts any emission order and writes the canonical blob (#518)', async () => {
    const shuffledPath = join(tempDir, 'shuffled.beast2');
    await runProgram(writeIr(dictEmitter(shuffledKeys(1000))), [], [], [], shuffledPath, { emit: 'dict' });
    const orderedPath = join(tempDir, 'ordered.beast2');
    const ascending = Array.from({ length: 1000 }, (_, i) => BigInt(i));
    await runProgram(writeIr(dictEmitter(ascending)), [], [], [], orderedPath, { emit: 'dict' });

    const shuffled = new Uint8Array(readFileSync(shuffledPath));
    assert.deepEqual(shuffled, new Uint8Array(readFileSync(orderedPath)),
      'out-of-order emission must produce the byte-identical canonical blob');
    const DT = DictType(IntegerType, StringType);
    const decoded = decodeBeast2For(DT)(shuffled);
    assert.equal(decoded.size, 1000);
    assert.equal(decoded.get(42n), 'row-42');
    assert.ok(openBeast2PagesFor(DT)(shuffled).selfContained);
    assert.ok(!existsSync(`${shuffledPath}.run0`), 'spill runs must be cleaned up');
  });

  it('a tiny EAST_EMIT_RUN_ELEMENTS cap forces spilled runs and the merge is still canonical', async () => {
    const saved = process.env.EAST_EMIT_RUN_ELEMENTS;
    process.env.EAST_EMIT_RUN_ELEMENTS = '16';
    try {
      const shuffledPath = join(tempDir, 'spilled.beast2');
      await runProgram(writeIr(dictEmitter(shuffledKeys(300))), [], [], [], shuffledPath, { emit: 'dict' });
      const orderedPath = join(tempDir, 'ordered300.beast2');
      const ascending = Array.from({ length: 300 }, (_, i) => BigInt(i));
      await runProgram(writeIr(dictEmitter(ascending)), [], [], [], orderedPath, { emit: 'dict' });
      assert.deepEqual(new Uint8Array(readFileSync(shuffledPath)), new Uint8Array(readFileSync(orderedPath)));
      assert.ok(!existsSync(`${shuffledPath}.run1`), 'spill runs must be cleaned up');
    } finally {
      if (saved === undefined) delete process.env.EAST_EMIT_RUN_ELEMENTS;
      else process.env.EAST_EMIT_RUN_ELEMENTS = saved;
    }
  });

  it('a duplicate dict key is a hard error, adjacent or across spilled runs', async () => {
    const emitType = FunctionType([IntegerType, StringType], NullType);
    const adjacent = East.function([emitType], NullType, ($, emit) => {
      $(emit(1n, 'a'));
      $(emit(1n, 'b'));
    });
    await assert.rejects(
      runProgram(writeIr(adjacent), [], [], [], join(tempDir, 'dup.beast2'), { emit: 'dict' }),
      /duplicate Dict key emitted/,
    );

    // An inversion first (buffered mode), so the duplicate is only visible
    // to the finalize-time merge.
    const crossRun = East.function([emitType], NullType, ($, emit) => {
      $(emit(5n, 'x'));
      $(emit(3n, 'y'));
      $(emit(5n, 'dup'));
    });
    await assert.rejects(
      runProgram(writeIr(crossRun), [], [], [], join(tempDir, 'dup2.beast2'), { emit: 'dict' }),
      /duplicate Dict key emitted/,
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

  it('the shape gate keeps mutable-nested inputs eager even under the threshold', async () => {
    const NestedT = DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) }));
    const table = new SortedMap<bigint, { xs: bigint[] }>(
      [[1n, { xs: [1n, 2n] }], [2n, { xs: [] }], [3n, { xs: [3n] }]],
      compareFor(IntegerType),
    );
    const inputPath = join(tempDir, 'nested.beast2');
    writeFileSync(inputPath, encodeBeast2PagedFor(NestedT, { batchSize: 2 })(table));

    // Write through a read-out element, then force a re-materialization
    // (insert would hydrate a lazy value from the blob, dropping the write)
    // and observe: only an eagerly-opened input keeps the write.
    const fn = East.function([NestedT], IntegerType, ($, d) => {
      const row = $.let(d.get(1n));
      $(row.xs.pushLast(42n));
      $(d.insert(99n, { xs: [] }));
      return d.get(1n).xs.size();
    });
    const outputPath = join(tempDir, 'output.beast2');
    await runProgram(writeIr(fn), [], [], [inputPath], outputPath, { lazyInputBytes: 1 });

    const result = decodeBeast2For(IntegerType)(new Uint8Array(readFileSync(outputPath)));
    assert.equal(result, 3n, 'the write through the read-out element must land in the input');
  });

  it('refuses --emit with a non-.beast2 output, like east-c and east-py', async () => {
    const fn = East.function([FunctionType([IntegerType], NullType)], NullType, ($, emit) => {
      $(emit(1n));
    });
    await assert.rejects(
      runProgram(writeIr(fn), [], [], [], join(tempDir, 'out.json'), { emit: 'array' }),
      /--emit requires a \.beast2 output file \(-o\)/,
    );
  });

  it('refuses --emit on a zero-parameter function with the emit-capability error', async () => {
    const fn = East.function([], IntegerType, (_$) => 1n);
    await assert.rejects(
      runProgram(writeIr(fn), [], [], [], join(tempDir, 'out.beast2'), { emit: 'array' }),
      /trailing parameter to be the emit capability[\s\S]*takes no parameters/,
    );
  });

  it('a set emit accepts any order and names duplicates with the element noun', async () => {
    const emitType = FunctionType([IntegerType], NullType);
    const disordered = East.function([emitType], NullType, ($, emit) => {
      $(emit(2n));
      $(emit(1n));
      $(emit(3n));
    });
    const outputPath = join(tempDir, 'set.beast2');
    await runProgram(writeIr(disordered), [], [], [], outputPath, { emit: 'set' });
    const decoded = decodeBeast2For(SetType(IntegerType))(new Uint8Array(readFileSync(outputPath)));
    assert.deepEqual([...decoded], [1n, 2n, 3n]);

    const dup = East.function([emitType], NullType, ($, emit) => {
      $(emit(2n));
      $(emit(1n));
      $(emit(2n));
    });
    await assert.rejects(
      runProgram(writeIr(dup), [], [], [], join(tempDir, 'dupset.beast2'), { emit: 'set' }),
      /duplicate Set element emitted/,
    );
  });
});

describe('lazy input threshold resolution', () => {
  const saved = process.env.EAST_LAZY_INPUT_BYTES;

  afterEach(() => {
    if (saved === undefined) delete process.env.EAST_LAZY_INPUT_BYTES;
    else process.env.EAST_LAZY_INPUT_BYTES = saved;
  });

  it('defaults to 64 MiB when the environment variable is unset or empty', () => {
    delete process.env.EAST_LAZY_INPUT_BYTES;
    assert.equal(lazyThreshold({}), 64 * 1024 * 1024);
    process.env.EAST_LAZY_INPUT_BYTES = '';
    assert.equal(lazyThreshold({}), 64 * 1024 * 1024, 'empty must fall through to the default, not disable lazy opening');
  });

  it('honours numeric overrides, 0 as the kill switch, and falls back on invalid values', () => {
    process.env.EAST_LAZY_INPUT_BYTES = '0';
    assert.equal(lazyThreshold({}), 0, '0 disables lazy opening');
    process.env.EAST_LAZY_INPUT_BYTES = '123';
    assert.equal(lazyThreshold({}), 123);
    process.env.EAST_LAZY_INPUT_BYTES = '-5';
    assert.equal(lazyThreshold({}), 64 * 1024 * 1024, 'negative values fall back to the default');
    process.env.EAST_LAZY_INPUT_BYTES = 'not-a-number';
    assert.equal(lazyThreshold({}), 64 * 1024 * 1024, 'garbage falls back to the default');
    process.env.EAST_LAZY_INPUT_BYTES = '999';
    assert.equal(lazyThreshold({ lazyInputBytes: 7 }), 7, 'the explicit option wins over the environment');
  });
});
