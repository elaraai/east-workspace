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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ArrayType,
  DictType,
  FloatType,
  FunctionType,
  IntegerType,
  NullType,
  OptionType,
  SetType,
  StringType,
  StructType,
  East,
  SortedMap,
  SortedSet,
  compareFor,
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  encodeEastIR,
  none,
  openBeast2PagesFor,
  some,
  spliceBeast2,
} from '@elaraai/east';

import { runProgram, lazyThreshold } from './runner.js';
import { mergeBlobs } from './merge.js';

/** Runs `run` with console.error captured; returns what it printed. */
async function stderrOf(run: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lines.join('\n');
}

/** `promise`'s value, or `undefined` once `ms` pass first — a bounded wait. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

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
    await runProgram(writeIr(fn), [], [], [inputPath], outputPath, { emit: 'array', streamInputs: [0] });

    const decoded = decodeBeast2For(AT)(new Uint8Array(readFileSync(outputPath)));
    assert.equal(decoded.length, 2500);
    assert.equal(decoded[0], 0n);
    assert.equal(decoded[2499], (2499n * 2500n) / 2n);
  });

  /** A dict producer emitting `row-${i}` for each key in the given order. */
  function dictEmitter(order: bigint[]) {
    const emitType = FunctionType([IntegerType, StringType], NullType);
    return East.function([emitType], NullType, ($, emit) => {
      $.for($.const(order, ArrayType(IntegerType)), ($, i) => {
        $(emit(i, East.str`row-${i}`));
      });
    });
  }

  it('an ascending dict emit writes the canonical blob, segmented and indexed', async () => {
    const outputPath = join(tempDir, 'ordered.beast2');
    const ascending = Array.from({ length: 1000 }, (_, i) => BigInt(i));
    await runProgram(writeIr(dictEmitter(ascending)), [], [], [], outputPath, { emit: 'dict' });

    const output = new Uint8Array(readFileSync(outputPath));
    const DT = DictType(IntegerType, StringType);
    const decoded = decodeBeast2For(DT)(output);
    assert.equal(decoded.size, 1000);
    assert.equal(decoded.get(42n), 'row-42');
    assert.ok(openBeast2PagesFor(DT)(output).selfContained);
  });

  it('a dict emit rejects an out-of-order key with the ascending contract\'s error (#770)', async () => {
    // Set/Dict emissions must ascend in East order: the sink writes one pass
    // and never buffers, so a key below the previous one is the error — in
    // the same words on every runner — and nothing is reported on stderr on
    // the way there.
    const err = await stderrOf(() => assert.rejects(
      runProgram(writeIr(dictEmitter([2n, 1n])), [], [], [], join(tempDir, 'disorder.beast2'), { emit: 'dict' }),
      { message: 'beast2 v5: Dict key emitted out of order: 1 after 2 — Set/Dict emissions must ascend in East order' },
    ));
    assert.equal(err, '');
  });

  it('a duplicate dict key is a hard error', async () => {
    const emitType = FunctionType([IntegerType, StringType], NullType);
    const adjacent = East.function([emitType], NullType, ($, emit) => {
      $(emit(1n, 'a'));
      $(emit(1n, 'b'));
    });
    await assert.rejects(
      runProgram(writeIr(adjacent), [], [], [], join(tempDir, 'dup.beast2'), { emit: 'dict' }),
      { message: 'beast2 v5: duplicate Dict key emitted: 1 — Dict keys must be unique' },
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

  it('reports a lazily opened input in verbose output', async () => {
    const DT = DictType(IntegerType, StringType);
    const table = new SortedMap<bigint, string>(
      Array.from({ length: 500 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]),
      compareFor(IntegerType),
    );
    const inputPath = join(tempDir, 'table.beast2');
    writeFileSync(inputPath, encodeBeast2PagedFor(DT, { batchSize: 100 })(table));
    const fn = East.function([DT], StringType, ($, table) => table.get(42n));
    const outputPath = join(tempDir, 'output.beast2');

    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      await runProgram(writeIr(fn), [], [], [inputPath], outputPath, { lazyInputBytes: 1, verbose: true });
    } finally {
      console.error = original;
    }
    assert.ok(lines.some((l) => l.includes('input 0: opened lazily')), `verbose output names the lazy input:\n${lines.join('\n')}`);
    assert.equal(decodeBeast2For(StringType)(new Uint8Array(readFileSync(outputPath))), 'row-42');
  });

  it('a lazily opened wide input reads a fraction of the file and stays below the eager run\'s residency', { skip: process.platform === 'win32' ? 'no RSS comparison on Windows' : false }, () => {
    // A keyed read twice through the CLI binary, each run its own process:
    // the lazy run pages the wide file from its descriptor, the eager
    // control reads and decodes it whole. The runner's verbose summary
    // accounts for every byte the lazy input read (geometry, fence probes,
    // the one decoded segment), and that count must be a fraction of the
    // file — the exact gate a positioned-read runtime allows, where RSS
    // alone would not be (Node's own baseline wanders by more than a
    // segment between identical runs). The eager control's RSS must still
    // sit above the lazy run's: it pays the file's bytes plus every row.
    const DT = DictType(IntegerType, StringType);
    const rows = 160_000;
    const table = new SortedMap<bigint, string>(
      Array.from({ length: rows }, (_, i) => [BigInt(i), `row-${i}-` + String.fromCharCode(97 + (i % 26)).repeat(190)] as [bigint, string]),
      compareFor(IntegerType),
    );
    const inputPath = join(tempDir, 'wide.beast2');
    writeFileSync(inputPath, encodeBeast2PagedFor(DT, { codec: 'none' })(table));
    const wireMb = statSync(inputPath).size / (1024 * 1024);
    assert.ok(wireMb > 16, `wide fixture too small: ${wireMb.toFixed(1)} MB`);
    const irPath = writeIr(East.function([DT], StringType, ($, table) => table.get(42n)));
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    // The CLI resolves stock platforms from its bin directory, then from the
    // search dirs e3 passes it; in a pnpm layout east-node-std is not a
    // dependency of this package, so point the loader at the package itself.
    const stdDir = fileURLToPath(new URL('../../east-node-std', import.meta.url));

    const run = (threshold: string): string => {
      const outputPath = join(tempDir, `wide-${threshold}.beast2`);
      const result = spawnSync(process.execPath, [bin, 'run', irPath, '-p', '@elaraai/east-node-std', '-i', inputPath, '-o', outputPath, '-v'], {
        env: { ...process.env, EAST_LAZY_INPUT_BYTES: threshold, E3_RUNNER_SEARCH_DIRS: stdDir },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(decodeBeast2For(StringType)(new Uint8Array(readFileSync(outputPath))), table.get(42n));
      return result.stderr;
    };
    const lazyErr = run('1');
    const eagerErr = run('0');
    assert.ok(lazyErr.includes('input 0: opened lazily'), lazyErr);
    assert.ok(!eagerErr.includes('opened lazily'), eagerErr);
    const sizeMb = (m: RegExpExecArray | null): number | null =>
      m ? Number(m[1]) / (m[2] === 'B' ? 1024 * 1024 : m[2] === 'KB' ? 1024 : 1) : null;
    const read = sizeMb(/input 0: ([\d.]+) (B|KB|MB) read of/.exec(lazyErr));
    assert.ok(read !== null, `the summary accounts for the lazy input's reads:\n${lazyErr}`);
    assert.ok(read! < wireMb / 2, `the lazy input read ${read!.toFixed(1)} MB of a ${wireMb.toFixed(1)} MB file — was it read whole?`);
    const peak = (err: string): number | null => sizeMb(/Peak RSS:\s+([\d.]+) (MB)/.exec(err));
    const lazy = peak(lazyErr);
    const eager = peak(eagerErr);
    assert.ok(lazy !== null && eager !== null, 'the runner reports its RSS');
    assert.ok(lazy! < eager!, `lazy peak ${lazy} MB not below eager peak ${eager} MB for a ${wireMb.toFixed(1)} MB input`);
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
    // The one sentence east-c and east-py give for the same shape — a
    // zero-parameter function has no trailing parameter to be the capability,
    // and so does one whose trailing parameter is not a function.
    const message = "--emit requires the function's trailing parameter to be the emit capability (a function type)";
    await assert.rejects(
      runProgram(writeIr(East.function([], IntegerType, (_$) => 1n)), [], [], [], join(tempDir, 'out.beast2'), { emit: 'array' }),
      { message },
    );
    await assert.rejects(
      runProgram(writeIr(East.function([IntegerType], IntegerType, (_$, n) => n)), [], [], [], join(tempDir, 'out.beast2'), { emit: 'array' }),
      { message },
    );
  });

  it('a set emit rejects an out-of-order element and names duplicates with the element noun', async () => {
    const emitType = FunctionType([IntegerType], NullType);
    const disordered = East.function([emitType], NullType, ($, emit) => {
      $(emit(2n));
      $(emit(1n));
      $(emit(3n));
    });
    await assert.rejects(
      runProgram(writeIr(disordered), [], [], [], join(tempDir, 'set.beast2'), { emit: 'set' }),
      { message: 'beast2 v5: Set element emitted out of order: 1 after 2 — Set/Dict emissions must ascend in East order' },
    );

    const dup = East.function([emitType], NullType, ($, emit) => {
      $(emit(1n));
      $(emit(2n));
      $(emit(2n));
    });
    await assert.rejects(
      runProgram(writeIr(dup), [], [], [], join(tempDir, 'dupset.beast2'), { emit: 'set' }),
      { message: 'beast2 v5: duplicate Set element emitted: 2 — Set elements must be unique' },
    );
  });
});

describe('folding emit, the blob merge and the stdin lifeline (#770)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'east-node-fold-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeIr(name: string, fn: { toIR(): any }): string {
    const irPath = join(tempDir, name);
    writeFileSync(irPath, encodeEastIR(fn.toIR()));
    return irPath;
  }

  const PairType = StructType({ key: IntegerType, value: StringType });
  const emitPairType = FunctionType([IntegerType, StringType], NullType);
  const emitKeyType = FunctionType([IntegerType], NullType);
  const ascendingBigints = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
  const DT = DictType(IntegerType, StringType);
  const ST = SetType(IntegerType);

  /** The fold contract's emission sequence, as keys — the sequence
   *  generate_fixtures.mjs writes for east-c and east-py: 0..1199 in order
   *  with adjacent duplicates, every third key twice, and key 999 — the last
   *  entry of a full 1000-element batch — four times. */
  function foldSequence(): bigint[] {
    const keys: bigint[] = [];
    for (let k = 0; k < 1200; k++) {
      const copies = 1 + (k % 3 === 0 ? 1 : 0) + (k % 1000 === 999 ? 2 : 0);
      for (let c = 0; c < copies; c++) keys.push(BigInt(k));
    }
    return keys;
  }

  /** A dict producer emitting the given (key, value) pairs in order. */
  function pairEmitter(pairs: { key: bigint; value: string }[]) {
    return East.function([emitPairType], NullType, ($, emit) => {
      $.for($.const(pairs, ArrayType(PairType)), ($, pair) => {
        $(emit(pair.key, pair.value));
      });
    });
  }

  /** A set producer emitting the given keys in order. */
  function keyEmitter(keys: bigint[]) {
    return East.function([emitKeyType], NullType, ($, emit) => {
      $.for($.const(keys, ArrayType(IntegerType)), ($, key) => {
        $(emit(key));
      });
    });
  }

  /** The concatenating `(Integer, String, String) -> String` fold. */
  function writeConcat(): string {
    return writeIr('merge.beast2',
      East.function([IntegerType, StringType, StringType], StringType, (_$, _key, acc, value) => acc.concat(value)));
  }

  it('--merge writes the folded ascending sequence\'s bytes', async () => {
    // The fold is over ADJACENT equal keys, and lands in place — key 999
    // into a full batch's last entry included — so the output is
    // byte-identical to what the flag-less sink writes for the folded
    // sequence.
    const pairs = foldSequence().map((key, i) => ({ key, value: `${i};` }));
    const folded = new Map<bigint, string>();
    for (const { key, value } of pairs) folded.set(key, (folded.get(key) ?? '') + value);
    const foldedPairs = [...folded].sort(([a], [b]) => ascendingBigints(a, b)).map(([key, value]) => ({ key, value }));

    const expectedPath = join(tempDir, 'expected.beast2');
    await runProgram(writeIr('folded.beast2', pairEmitter(foldedPairs)), [], [], [], expectedPath, { emit: 'dict' });
    const outputPath = join(tempDir, 'output.beast2');
    await runProgram(writeIr('program.beast2', pairEmitter(pairs)), [], [], [], outputPath, { emit: 'dict', merge: writeConcat() });

    assert.deepEqual(new Uint8Array(readFileSync(outputPath)), new Uint8Array(readFileSync(expectedPath)),
      'the folded output must be byte-identical to the flag-less sink\'s output for the folded sequence');
  });

  it('--union writes the ascending sequence\'s distinct keys\' bytes', async () => {
    const keys = foldSequence();
    const distinct = [...new Set(keys)].sort(ascendingBigints);

    const expectedPath = join(tempDir, 'expected.beast2');
    await runProgram(writeIr('folded.beast2', keyEmitter(distinct)), [], [], [], expectedPath, { emit: 'set' });
    const outputPath = join(tempDir, 'output.beast2');
    await runProgram(writeIr('program.beast2', keyEmitter(keys)), [], [], [], outputPath, { emit: 'set', union: true });

    assert.deepEqual(new Uint8Array(readFileSync(outputPath)), new Uint8Array(readFileSync(expectedPath)),
      'the union output must be byte-identical to the flag-less sink\'s output for the distinct keys');
  });

  it('a fold does not admit an out-of-order key', async () => {
    const pairs = [{ key: 2n, value: 'a' }, { key: 1n, value: 'b' }];
    await assert.rejects(
      runProgram(writeIr('program.beast2', pairEmitter(pairs)), [], [], [], join(tempDir, 'output.beast2'), { emit: 'dict', merge: writeConcat() }),
      { message: 'beast2 v5: Dict key emitted out of order: 1 after 2 — Set/Dict emissions must ascend in East order' },
    );
  });

  // ---- The blob merge ---------------------------------------------------

  /** Three sorted Dict inputs whose keys overlap — a = 0..19, b = 10..29,
   *  c = {5, 15, 25, 40} — each value naming its input, written by the paged
   *  writer in four-entry segments; the fixtures east-c and east-py merge. */
  const mergeKeys = {
    a: Array.from({ length: 20 }, (_, k) => BigInt(k)),
    b: Array.from({ length: 20 }, (_, k) => BigInt(k + 10)),
    c: [5n, 15n, 25n, 40n],
  };
  function writeDictInput(name: 'a' | 'b' | 'c'): string {
    const path = join(tempDir, `in_${name}.beast2`);
    writeFileSync(path, encodeBeast2PagedFor(DT, { batchSize: 4 })(
      new SortedMap(mergeKeys[name].map((k) => [k, `${name}${k}`] as [bigint, string]), compareFor(IntegerType))));
    return path;
  }
  function writeSetInput(name: 'a' | 'b' | 'c'): string {
    const path = join(tempDir, `set_${name}.beast2`);
    writeFileSync(path, encodeBeast2PagedFor(ST, { batchSize: 4 })(new SortedSet(mergeKeys[name], compareFor(IntegerType))));
    return path;
  }

  it('merge writes the fold of overlapping dict inputs byte-identical to the ascending sink', async () => {
    const folded = new Map<bigint, string>();
    for (const name of ['a', 'b', 'c'] as const) {
      for (const k of mergeKeys[name]) folded.set(k, (folded.get(k) ?? '') + `${name}${k}`);
    }
    const foldedPairs = [...folded].sort(([a], [b]) => ascendingBigints(a, b)).map(([key, value]) => ({ key, value }));
    const expectedPath = join(tempDir, 'expected.beast2');
    await runProgram(writeIr('folded.beast2', pairEmitter(foldedPairs)), [], [], [], expectedPath, { emit: 'dict' });

    const outputPath = join(tempDir, 'merged.beast2');
    const inputs = [writeDictInput('a'), writeDictInput('b'), writeDictInput('c')];
    const stats = mergeBlobs(inputs, outputPath, { mergePath: writeConcat() });
    assert.deepEqual(stats, { inputs: 3, entries: 31, folds: 13 });
    assert.deepEqual(new Uint8Array(readFileSync(outputPath)), new Uint8Array(readFileSync(expectedPath)),
      'the merge must write exactly what the sink writes for the folded sequence emitted ascending');
    const table = decodeBeast2For(DT)(new Uint8Array(readFileSync(outputPath)));
    assert.equal(table.get(15n), 'a15b15c15');
    assert.equal(table.get(40n), 'c40');
  });

  it('merge --union writes the distinct elements of set inputs byte-identical to the ascending sink', async () => {
    const distinct = [...new Set([...mergeKeys.a, ...mergeKeys.b, ...mergeKeys.c])].sort(ascendingBigints);
    const expectedPath = join(tempDir, 'expected.beast2');
    await runProgram(writeIr('folded.beast2', keyEmitter(distinct)), [], [], [], expectedPath, { emit: 'set' });

    const outputPath = join(tempDir, 'union.beast2');
    const stats = mergeBlobs([writeSetInput('a'), writeSetInput('b'), writeSetInput('c')], outputPath, { union: true });
    assert.deepEqual(stats, { inputs: 3, entries: 31, folds: 13 });
    assert.deepEqual(new Uint8Array(readFileSync(outputPath)), new Uint8Array(readFileSync(expectedPath)));
    assert.equal(openBeast2PagesFor(ST)(new Uint8Array(readFileSync(outputPath))).elementCount, 31);
  });

  it('merge without a fold refuses a shared key and leaves the output unfinalised', () => {
    const outputPath = join(tempDir, 'dup.beast2');
    assert.throws(
      () => mergeBlobs([writeDictInput('a'), writeDictInput('b')], outputPath),
      { message: 'beast2 v5: duplicate Dict key emitted: 10 — Dict keys must be unique' },
    );
    assert.throws(() => openBeast2PagesFor(DT)(new Uint8Array(readFileSync(outputPath))), 'the aborted output carries no index');
  });

  it('merge refuses an input of another type, an Array input and a descending input, naming the input', () => {
    const other = join(tempDir, 'other.beast2');
    writeFileSync(other, encodeBeast2PagedFor(DictType(StringType, FloatType))(new SortedMap([['x', 1.5]], compareFor(StringType))));
    assert.throws(
      () => mergeBlobs([writeDictInput('a'), other], join(tempDir, 'x.beast2'), { mergePath: writeConcat() }),
      (err: Error) => err.message.startsWith(`merge: input 1 (${other}) has type `) && err.message.endsWith(' (input 0)'),
    );

    const rows = join(tempDir, 'rows.beast2');
    writeFileSync(rows, encodeBeast2PagedFor(ArrayType(IntegerType))([1n, 2n]));
    assert.throws(() => mergeBlobs([rows], join(tempDir, 'array.beast2')), { message: 'merge: inputs must be Set or Dict blobs, got Array' });

    // A high key range spliced before a low one: the reader's canonical-order
    // error, prefixed with the input — the same sentence east-c and east-py give.
    const descending = join(tempDir, 'descending.beast2');
    writeFileSync(descending, spliceBeast2([
      encodeBeast2PagedFor(DT, { batchSize: 2 })(new SortedMap([[1000n, 'x'], [1001n, 'y']], compareFor(IntegerType))),
      encodeBeast2PagedFor(DT, { batchSize: 2 })(new SortedMap([[1n, 'a'], [2n, 'b']], compareFor(IntegerType))),
    ]));
    assert.throws(
      () => mergeBlobs([descending], join(tempDir, 'desc.beast2')),
      { message: `merge: input 0 (${descending}): beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)` },
    );

    const missing = join(tempDir, 'missing.beast2');
    assert.throws(() => mergeBlobs([missing], join(tempDir, 'm.beast2')), { message: `merge: input 0 (${missing}): cannot open the file` });

    // A file that is not a blob is refused in the reader's own words — the
    // sentence east-c and east-py give for the same bytes; a directory
    // cannot be opened.
    const empty = join(tempDir, 'empty-file.beast2');
    writeFileSync(empty, '');
    assert.throws(() => mergeBlobs([empty], join(tempDir, 'e.beast2')), { message: `merge: input 0 (${empty}): Data too short for Beast2 format: 0 bytes` });
    const text = join(tempDir, 'text.beast2');
    writeFileSync(text, 'not a blob');
    assert.throws(() => mergeBlobs([writeDictInput('a'), text], join(tempDir, 't.beast2'), { mergePath: writeConcat() }), { message: `merge: input 1 (${text}): Invalid Beast2 magic at offset 0: expected 0x89, got 0x6e` });
    assert.throws(() => mergeBlobs([tempDir], join(tempDir, 'd.beast2')), { message: `merge: input 0 (${tempDir}): cannot open the file` });

    // A blob without the paging index — a whole-value encode, not what a
    // runner writes — is refused in the reader's words, as east-c and
    // east-py refuse it.
    const whole = join(tempDir, 'whole.beast2');
    writeFileSync(whole, encodeBeast2For(DT)(new SortedMap([[1n, 'a']], compareFor(IntegerType))));
    assert.throws(() => mergeBlobs([whole], join(tempDir, 'w.beast2')), { message: `merge: input 0 (${whole}): beast2 v5: blob carries no index — ranged reads need one (write with the index enabled, the default)` });
  });

  it('merge names a fold of the wrong signature and refuses a fold of the wrong kind', () => {
    const wrong = writeIr('wrong.beast2', East.function([StringType, StringType, StringType], StringType, (_$, _key, acc, value) => acc.concat(value)));
    assert.throws(
      () => mergeBlobs([writeDictInput('a')], join(tempDir, 'w.beast2'), { mergePath: wrong }),
      (err: Error) => err.message.startsWith('--merge: expected a function (K, V, V) -> V matching the inputs (K = '),
    );
    assert.throws(() => mergeBlobs([writeSetInput('a')], join(tempDir, 'ms.beast2'), { mergePath: writeConcat() }), { message: '--merge applies to Dict inputs only' });
    assert.throws(() => mergeBlobs([writeDictInput('a')], join(tempDir, 'ud.beast2'), { union: true }), { message: '--union applies to Set inputs only' });
    assert.throws(() => mergeBlobs([writeDictInput('a')], join(tempDir, 'both.beast2'), { mergePath: writeConcat(), union: true }), { message: 'merge: --merge and --union are two folds — give one' });
  });

  it('an empty input contributes nothing, and a lone empty input yields the empty collection, indexed', () => {
    const empty = join(tempDir, 'empty.beast2');
    writeFileSync(empty, encodeBeast2PagedFor(DT)(new SortedMap([], compareFor(IntegerType))));
    const withEmpty = join(tempDir, 'with-empty.beast2');
    mergeBlobs([empty, writeDictInput('a')], withEmpty, { mergePath: writeConcat() });
    const alone = join(tempDir, 'alone.beast2');
    mergeBlobs([writeDictInput('a')], alone);
    assert.deepEqual(new Uint8Array(readFileSync(withEmpty)), new Uint8Array(readFileSync(alone)));
    assert.equal(openBeast2PagesFor(DT)(new Uint8Array(readFileSync(alone))).elementCount, 20);
    const emptyOut = join(tempDir, 'empty-out.beast2');
    assert.deepEqual(mergeBlobs([empty], emptyOut), { inputs: 1, entries: 0, folds: 0 });
    assert.equal(openBeast2PagesFor(DT)(new Uint8Array(readFileSync(emptyOut))).elementCount, 0);
  });

  // ---- Key ranges ---------------------------------------------------------

  /** A `--range` blob over Integer keys: `[from, to)`, a `null` bound open. */
  const RangeT = StructType({ from: OptionType(IntegerType), to: OptionType(IntegerType) });
  function writeRange(name: string, from: bigint | null, to: bigint | null): string {
    const path = join(tempDir, `range_${name}.beast2`);
    writeFileSync(path, encodeBeast2For(RangeT)({ from: from === null ? none : some(from), to: to === null ? none : some(to) }));
    return path;
  }
  /** Whether `k` lies in `[from, to)`. */
  const inRange = (k: bigint, from: bigint | null, to: bigint | null): boolean => (from === null || k >= from) && (to === null || k < to);
  /** An input holding only its keys in the range — the sliced twin a ranged merge must equal. */
  function writeDictSlice(name: 'a' | 'b' | 'c', from: bigint | null, to: bigint | null): string {
    const path = join(tempDir, `in_${name}_${from}_${to}.beast2`);
    writeFileSync(path, encodeBeast2PagedFor(DT, { batchSize: 4 })(
      new SortedMap(mergeKeys[name].filter((k) => inRange(k, from, to)).map((k) => [k, `${name}${k}`] as [bigint, string]), compareFor(IntegerType))));
    return path;
  }
  function writeSetSlice(name: 'a' | 'b' | 'c', from: bigint | null, to: bigint | null): string {
    const path = join(tempDir, `set_${name}_${from}_${to}.beast2`);
    writeFileSync(path, encodeBeast2PagedFor(ST, { batchSize: 4 })(new SortedSet(mergeKeys[name].filter((k) => inRange(k, from, to)), compareFor(IntegerType))));
    return path;
  }

  it('merge --range writes the keys in [from, to) byte-identical to merging inputs that hold only those keys', () => {
    // The inputs are written in four-entry segments, so the bounds fall
    // inside segments, on a fence, before the first key, past the last,
    // and one range holds nothing.
    const cases: [bigint | null, bigint | null][] = [[7n, 22n], [null, 12n], [25n, null], [8n, 16n], [-5n, 3n], [40n, 41n], [30n, 39n], [12n, 12n], [null, null]];
    const inputs = [writeDictInput('a'), writeDictInput('b'), writeDictInput('c')];
    const sets = [writeSetInput('a'), writeSetInput('b'), writeSetInput('c')];
    for (const [from, to] of cases) {
      const label = `[${from}, ${to})`;
      const twin = join(tempDir, `twin_${from}_${to}.beast2`);
      const twinStats = mergeBlobs([writeDictSlice('a', from, to), writeDictSlice('b', from, to), writeDictSlice('c', from, to)], twin, { mergePath: writeConcat() });
      const ranged = join(tempDir, `ranged_${from}_${to}.beast2`);
      const stats = mergeBlobs(inputs, ranged, { mergePath: writeConcat(), rangePath: writeRange(`${from}_${to}`, from, to) });
      assert.deepEqual(stats, twinStats, label);
      assert.deepEqual(new Uint8Array(readFileSync(ranged)), new Uint8Array(readFileSync(twin)), `${label}: the ranged merge must write exactly the sliced twin's bytes`);
      const table = decodeBeast2For(DT)(new Uint8Array(readFileSync(ranged)));
      for (const k of [...mergeKeys.a, ...mergeKeys.b, ...mergeKeys.c]) assert.equal(table.has(k), inRange(k, from, to), `${label}: key ${k}`);

      const unionTwin = join(tempDir, `union_twin_${from}_${to}.beast2`);
      const unionTwinStats = mergeBlobs([writeSetSlice('a', from, to), writeSetSlice('b', from, to), writeSetSlice('c', from, to)], unionTwin, { union: true });
      const unionRanged = join(tempDir, `union_ranged_${from}_${to}.beast2`);
      assert.deepEqual(mergeBlobs(sets, unionRanged, { union: true, rangePath: writeRange(`u_${from}_${to}`, from, to) }), unionTwinStats, label);
      assert.deepEqual(new Uint8Array(readFileSync(unionRanged)), new Uint8Array(readFileSync(unionTwin)), `${label}: union`);
    }
    // The open range is the whole merge, and [7, 22) folds 15 keys, 11 of them shared.
    const whole = join(tempDir, 'whole.beast2');
    mergeBlobs(inputs, whole, { mergePath: writeConcat() });
    assert.deepEqual(new Uint8Array(readFileSync(join(tempDir, 'ranged_null_null.beast2'))), new Uint8Array(readFileSync(whole)));
    assert.equal(decodeBeast2For(DT)(new Uint8Array(readFileSync(join(tempDir, 'ranged_7_22.beast2')))).get(15n), 'a15b15c15');
    assert.equal(openBeast2PagesFor(DT)(new Uint8Array(readFileSync(join(tempDir, 'ranged_7_22.beast2')))).elementCount, 15);
    assert.equal(openBeast2PagesFor(DT)(new Uint8Array(readFileSync(join(tempDir, 'ranged_30_39.beast2')))).elementCount, 0, 'a range holding nothing writes the empty collection, indexed');
  });

  it('merge --range refuses bounds of another key type, a missing file, an empty file and a file that is not a blob', () => {
    const inputs = [writeDictInput('a'), writeDictInput('b')];
    const mismatch = join(tempDir, 'range_mismatch.beast2');
    writeFileSync(mismatch, encodeBeast2For(StructType({ from: OptionType(StringType), to: OptionType(StringType) }))({ from: none, to: none }));
    assert.throws(
      () => mergeBlobs(inputs, join(tempDir, 'rm.beast2'), { mergePath: writeConcat(), rangePath: mismatch }),
      (err: Error) => err.message.startsWith(`merge: --range (${mismatch}) has type `) && err.message.endsWith(" (bounds over the inputs' key type)"),
    );
    const missing = join(tempDir, 'range_missing.beast2');
    assert.throws(() => mergeBlobs(inputs, join(tempDir, 'rm2.beast2'), { mergePath: writeConcat(), rangePath: missing }), { message: `merge: --range (${missing}): cannot open the file` });
    // Not a blob: the reader's own words, as east-c and east-py say them.
    const text = join(tempDir, 'range_text.beast2');
    writeFileSync(text, 'not a blob');
    assert.throws(
      () => mergeBlobs(inputs, join(tempDir, 'rm3.beast2'), { mergePath: writeConcat(), rangePath: text }),
      { message: `merge: --range (${text}): Invalid Beast2 magic at offset 0: expected 0x89, got 0x6e` },
    );
    const empty = join(tempDir, 'range_empty.beast2');
    writeFileSync(empty, '');
    assert.throws(
      () => mergeBlobs(inputs, join(tempDir, 'rm4.beast2'), { mergePath: writeConcat(), rangePath: empty }),
      { message: `merge: --range (${empty}): Data too short for Beast2 format: 0 bytes` },
    );
  });

  it('the merge command prints its account, takes a range and refuses two folds', () => {
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    const outputPath = join(tempDir, 'cli-merged.beast2');
    const inputs = [writeDictInput('a'), writeDictInput('b'), writeDictInput('c')];
    const result = spawnSync(process.execPath, [bin, 'merge', '--merge', writeConcat(), ...inputs.flatMap((p) => ['-i', p]), '-o', outputPath, '-v'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes('merge: 3 input(s), 31 entries, 13 fold(s)'), result.stderr);
    assert.equal(openBeast2PagesFor(DT)(new Uint8Array(readFileSync(outputPath))).elementCount, 31);

    const rangedPath = join(tempDir, 'cli-ranged.beast2');
    const ranged = spawnSync(process.execPath, [bin, 'merge', '--merge', writeConcat(), '--range', writeRange('cli', 7n, 22n), ...inputs.flatMap((p) => ['-i', p]), '-o', rangedPath, '-v'], { encoding: 'utf8' });
    assert.equal(ranged.status, 0, ranged.stderr);
    assert.ok(ranged.stderr.includes('merge: 3 input(s), 15 entries, 11 fold(s)'), ranged.stderr);

    const both = spawnSync(process.execPath, [bin, 'merge', '--merge', writeConcat(), '--union', '-i', inputs[0]!, '-o', join(tempDir, 'both.beast2')], { encoding: 'utf8' });
    assert.equal(both.status, 1);
    assert.ok(both.stderr.includes('Error: --merge and --union are two folds — give one'), both.stderr);
  });

  it('a container two entries share stays one NEW and one REF', () => {
    // The writer scopes beast2 aliasing per SEGMENT, so a container two
    // entries of one segment share is written once and referenced. A merge
    // of such an input alone must write its bytes back exactly, because the
    // merge writes through the same writer `run --emit` does. east-c encoded
    // each entry under its own scope and wrote the shared value twice — a
    // bigger blob and a different hash for one value, and the two runners
    // disagreeing; the same fixture is `merge_aliased.beast2` in east-c's
    // and east-py's suites.
    const VT = StructType({ tags: ArrayType(StringType) });
    const shared = ['x', 'y', 'zzzzzzzzzzzzzzzzzzzz'];
    const inputPath = join(tempDir, 'aliased.beast2');
    writeFileSync(inputPath, encodeBeast2PagedFor(DictType(IntegerType, VT), { batchSize: 10 })(
      new SortedMap([[1n, { tags: shared }], [2n, { tags: shared }]], compareFor(IntegerType))));

    const outputPath = join(tempDir, 'aliased-merged.beast2');
    assert.deepEqual(mergeBlobs([inputPath], outputPath), { inputs: 1, entries: 2, folds: 0 });
    assert.deepEqual(new Uint8Array(readFileSync(outputPath)), new Uint8Array(readFileSync(inputPath)));
  });

  it('the merge command refuses its arguments in the other runners\' words', () => {
    // One sentence per condition, identical on east-c, east-node and east-py:
    // the three runners are interchangeable, so a task that names one of them
    // must fail the same way on any of them. One line, no JS stack — a
    // refusal of the command line is the user's error, not the program's.
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    const out = join(tempDir, 'args.beast2');
    const input = writeDictInput('a');
    const cases: [string[], string][] = [
      [[], 'Error: merge requires at least one -i input'],
      [['-o', out], 'Error: merge requires at least one -i input'],
      [['-i', input], 'Error: merge requires -o FILE'],
      [['-i', input, '-o', out, '--merge', writeConcat(), '--union'],
        'Error: --merge and --union are two folds — give one'],
      [['-i', input, '-o', join(tempDir, 'args.bin')],
        'Error: merge requires a .beast2 output file (-o)'],
    ];
    for (const [args, message] of cases) {
      const result = spawnSync(process.execPath, [bin, 'merge', ...args], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stderr);
      assert.deepEqual(result.stderr.trimEnd().split('\n'), [message]);
    }
  });

  it('a repeated flag takes one value, so it never swallows the ir file', () => {
    // `--stream <index...>` (and `-i`/`-p` variadic) ate the positional that
    // followed, so `run --stream 0 program.beast2` reported its IR file
    // missing — while east-c and east-py, whose flags take one value and
    // repeat, accepted the same line. Every runner README documents the
    // repeated form.
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    const irPath = writeIr('streamed.beast2', pairEmitter([{ key: 1n, value: 'a' }]));
    const stdDir = fileURLToPath(new URL('../../east-node-std', import.meta.url));
    const result = spawnSync(process.execPath,
      [bin, 'run', '--stream', '0', irPath, '-p', '@elaraai/east-node-std',
       '--emit', 'dict', '-o', join(tempDir, 'streamed-out.beast2')],
      { env: { ...process.env, E3_RUNNER_SEARCH_DIRS: stdDir }, encoding: 'utf8' });
    // The IR file was parsed as the positional — the run gets as far as the
    // stream index, and refuses it in the words east-c uses.
    assert.ok(!result.stderr.includes('Missing <ir_file>'), result.stderr);
    assert.deepEqual(result.stderr.trimEnd().split('\n'),
      ['Error: --stream index 0 out of range (0 inputs)']);
  });

  // ---- The stdin lifeline -----------------------------------------------

  it('a runner given the stdin lifeline exits once its stdin closes, mid-computation', async () => {
    // Gate (c): with --exit-with-parent and a stdin pipe nobody writes, the
    // runner exits once that pipe closes. The sink opens the output file
    // before the body runs, so the file's existence is the sign the runner
    // is up and computing; the body loops forever after one emission — only
    // the watcher stops it.
    const spin = East.function([emitKeyType], NullType, ($, emit) => {
      $(emit(1n));
      const turns = $.let(0n);
      $.while(true, ($) => {
        $.assign(turns, turns.add(1n));
      });
    });
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    // As in the wide-input test: point the platform loader at east-node-std.
    const stdDir = fileURLToPath(new URL('../../east-node-std', import.meta.url));
    const outputPath = join(tempDir, 'spin-output.beast2');
    const child = spawn(process.execPath,
      [bin, 'run', '--exit-with-parent', writeIr('spin.beast2', spin), '-p', '@elaraai/east-node-std', '--emit', 'set', '-o', outputPath],
      { env: { ...process.env, E3_RUNNER_SEARCH_DIRS: stdDir }, stdio: ['pipe', 'ignore', 'pipe'] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    let stderr = '';
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
    const running = (async () => {
      while (!existsSync(outputPath)) {
        if (child.exitCode !== null || child.signalCode !== null) return false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return true;
    })();
    try {
      // Bounded liveness waits: start-up, then the watcher.
      assert.equal(await within(running, 30_000), true, `the runner never opened its output:\n${stderr}`);
      child.stdin!.destroy(); // the lifeline closes
      const outcome = await within(exited, 10_000);
      assert.ok(outcome !== undefined, 'the runner outlived its closed stdin by 10 s');
      // The watcher kills the whole process: nothing else sends it SIGKILL.
      // Windows has no signals: there the kill terminates the process with
      // exit code 1, and the runner reports no error of its own.
      if (process.platform === 'win32') assert.deepEqual({ ...outcome, stderr }, { code: 1, signal: null, stderr: '' });
      else assert.equal(outcome.signal, 'SIGKILL', stderr);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  it('a runner given the stdin lifeline exits when its body returns, its watcher long since reading', async () => {
    // Gate (c): the watcher never holds up the runner's own exit. The only
    // platform is an empty package, so nothing in the runner touches stdin and
    // it stays the pipe the parent made. The body computes long enough for the
    // watcher to be reading stdin when it returns, and stdin stays open: the
    // runner must still exit 0 with its output written. (A watcher blocked in
    // a synchronous read kept such a runner alive forever: process exit joins
    // the worker thread.)
    const platformDir = join(tempDir, 'node_modules', 'empty-platform');
    mkdirSync(platformDir, { recursive: true });
    writeFileSync(join(platformDir, 'package.json'), JSON.stringify({
      name: 'empty-platform',
      version: '0.0.0',
      type: 'module',
      exports: { './platform': './platform.js', './package.json': './package.json' },
    }));
    writeFileSync(join(platformDir, 'platform.js'), 'export default [];\n');
    const busy = East.function([], IntegerType, ($) => {
      const turns = $.let(0n);
      $.while(turns.lessThan(30_000_000n), ($) => {
        $.assign(turns, turns.add(1n));
      });
      return turns;
    });
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    const outputPath = join(tempDir, 'busy-output.beast2');
    const child = spawn(process.execPath, [bin, 'run', writeIr('busy.beast2', busy), '--exit-with-parent', '-p', 'empty-platform', '-o', outputPath],
      { env: { ...process.env, E3_RUNNER_SEARCH_DIRS: tempDir }, stdio: ['pipe', 'ignore', 'pipe'] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    let stderr = '';
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
    try {
      // A bounded liveness wait; the lifeline stays open throughout.
      const outcome = await within(exited, 60_000);
      assert.ok(outcome !== undefined, `the runner did not exit within 60 s of starting:\n${stderr}`);
      assert.deepEqual(outcome, { code: 0, signal: null }, stderr);
      assert.equal(decodeBeast2For(IntegerType)(new Uint8Array(readFileSync(outputPath))), 30_000_000n);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdin!.destroy();
    }
  });

  it('a runner given the stdin lifeline keeps full use of its stdin while the watcher reads it', async () => {
    // The platform opens the process's stdin two seconds in, once the watcher is
    // surely reading — as the first ESM import of `node:process` does, the
    // builtin's facade reading every export — over the plain 'pipe' a parent
    // gives, which on Windows is synchronous: a read pending on it holds the
    // pipe's file-object lock, and that open waited for the parent to go. The
    // runner opens stdin before its watcher reads, so it must load, run and
    // exit 0 with the lifeline still open.
    const platformDir = join(tempDir, 'node_modules', 'late-stdin-platform');
    mkdirSync(platformDir, { recursive: true });
    writeFileSync(join(platformDir, 'package.json'), JSON.stringify({
      name: 'late-stdin-platform',
      version: '0.0.0',
      type: 'module',
      exports: { './platform': './platform.js', './package.json': './package.json' },
    }));
    writeFileSync(join(platformDir, 'platform.js'), [
      'await new Promise((resolve) => setTimeout(resolve, 2000));',
      'process.stdin;',
      'export default [];',
    ].join('\n'));
    const one = East.function([], IntegerType, (_$) => 1n);
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    const outputPath = join(tempDir, 'late-stdin-output.beast2');
    const child = spawn(process.execPath, [bin, 'run', writeIr('one.beast2', one), '--exit-with-parent', '-p', 'late-stdin-platform', '-o', outputPath],
      { env: { ...process.env, E3_RUNNER_SEARCH_DIRS: tempDir }, stdio: ['pipe', 'ignore', 'pipe'] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    let stderr = '';
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
    try {
      // A bounded liveness wait; the lifeline stays open throughout.
      const outcome = await within(exited, 30_000);
      assert.ok(outcome !== undefined, `the runner never finished loading its platform — opening stdin waited on the watcher's read:\n${stderr}`);
      assert.deepEqual(outcome, { code: 0, signal: null }, stderr);
      assert.equal(decodeBeast2For(IntegerType)(new Uint8Array(readFileSync(outputPath))), 1n);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdin!.destroy();
    }
  });
});

describe('frozen inputs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'east-node-frozen-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeIr(fn: { toIR(): any }): string {
    const irPath = join(tempDir, 'program.beast2');
    writeFileSync(irPath, encodeEastIR(fn.toIR()));
    return irPath;
  }

  const NestedT = DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) }));

  function writeNestedInput(): string {
    const table = new SortedMap<bigint, { xs: bigint[] }>(
      [[1n, { xs: [1n, 2n] }], [2n, { xs: [] }], [3n, { xs: [3n] }]],
      compareFor(IntegerType),
    );
    const inputPath = join(tempDir, 'nested.beast2');
    writeFileSync(inputPath, encodeBeast2PagedFor(NestedT, { batchSize: 2 })(table));
    return inputPath;
  }

  it('an input refuses mutation with the uniform copy-first error', async () => {
    const fn = East.function([NestedT], NullType, ($, d) => {
      $(d.insert(99n, { xs: [] }));
    });
    await assert.rejects(
      runProgram(writeIr(fn), [], [], [writeNestedInput()], join(tempDir, 'out.beast2')),
      /cannot mutate a frozen value \(task inputs are immutable\) — copy first/,
    );
  });

  it('a copied input accepts the mutation — the documented escape hatch', async () => {
    const fn = East.function([NestedT], IntegerType, ($, d) => {
      const mine = $.let(d.copy());
      $(mine.insert(99n, { xs: [] }));
      return mine.size();
    });
    const outputPath = join(tempDir, 'out.beast2');
    await runProgram(writeIr(fn), [], [], [writeNestedInput()], outputPath);
    assert.equal(decodeBeast2For(IntegerType)(new Uint8Array(readFileSync(outputPath))), 4n);
  });

  it('the frozen shape gate admits nested containers lazily: reads serve, writes refuse', async () => {
    // Frozen is what makes lazy service safe for nested element shapes, so
    // with a 1-byte threshold this opens pager-backed AND immutable.
    const read = East.function([NestedT], IntegerType, ($, d) => d.get(1n).xs.size());
    const outputPath = join(tempDir, 'out.beast2');
    await runProgram(writeIr(read), [], [], [writeNestedInput()], outputPath,
      { lazyInputBytes: 1 });
    assert.equal(decodeBeast2For(IntegerType)(new Uint8Array(readFileSync(outputPath))), 2n);

    const write = East.function([NestedT], IntegerType, ($, d) => {
      const row = $.let(d.get(1n));
      $(row.xs.pushLast(42n));
      return d.get(1n).xs.size();
    });
    await assert.rejects(
      runProgram(writeIr(write), [], [], [writeNestedInput()], join(tempDir, 'out2.beast2'),
        { lazyInputBytes: 1 }),
      /cannot mutate a frozen value \(task inputs are immutable\) — copy first/,
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
