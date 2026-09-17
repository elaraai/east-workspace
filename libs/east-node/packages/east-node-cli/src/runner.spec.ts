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

/** `items` in a deterministic Fisher-Yates shuffle (fixed LCG seed) — the
 *  shuffle east-c-cli's generate_fixtures.mjs uses, so all three runners are
 *  pinned against the same disorder. */
function shuffled<T>(items: T[]): T[] {
  const out = items.slice();
  let seed = 12345;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

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

/** Runs `run` with the given environment variables set (`undefined` unsets
 *  one), restoring them afterwards. */
async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>): void => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(vars);
  try {
    return await run();
  } finally {
    apply(saved);
  }
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

  /** The 0..count keys in the deterministic shuffle, so the disorder the
   *  sink must absorb is stable across runs. */
  function shuffledKeys(count: number): bigint[] {
    return shuffled(Array.from({ length: count }, (_, i) => BigInt(i)));
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

describe('folding emit, bounded runs and the stdin lifeline (#770)', () => {
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

  /** The fold contract's emission sequences, as keys — the sequences
   *  generate_fixtures.mjs writes for east-c and east-py. `ascending` emits
   *  0..1199 in order with adjacent duplicates: every third key twice, and
   *  key 999 — the last entry of a full 1000-element batch — four times.
   *  `scattered` emits 0..19 in order, each twice, then 7 again (the first
   *  key out of order: the prefix demotes, and 7 must fold across it), then
   *  0..599 shuffled with one to three copies each, so equal keys meet in the
   *  prefix, within a run and across runs. */
  function foldSequence(name: 'ascending' | 'scattered'): bigint[] {
    const keys: bigint[] = [];
    if (name === 'ascending') {
      for (let k = 0; k < 1200; k++) {
        const copies = 1 + (k % 3 === 0 ? 1 : 0) + (k % 1000 === 999 ? 2 : 0);
        for (let c = 0; c < copies; c++) keys.push(BigInt(k));
      }
      return keys;
    }
    const rest: bigint[] = [];
    for (let k = 0; k < 600; k++) {
      const copies = 1 + (k % 4 === 1 ? 1 : 0) + (k % 7 === 2 ? 1 : 0);
      for (let c = 0; c < copies; c++) rest.push(BigInt(k));
    }
    for (let k = 0; k < 20; k++) keys.push(BigInt(k), BigInt(k));
    keys.push(7n, ...shuffled(rest));
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

  // The ascending sequence folds on the straight-through path — key 999 into
  // a full batch's last entry; the scattered one demotes, and the run cap
  // moves its folds into the tail (the default), across runs (16), or across
  // the runs of a two-pass merge (2).
  const foldCases = [
    { sequence: 'ascending', runCap: undefined, demotes: false },
    { sequence: 'scattered', runCap: undefined, demotes: true },
    { sequence: 'scattered', runCap: '16', demotes: true },
    { sequence: 'scattered', runCap: '2', demotes: true },
  ] as const;

  for (const { sequence, runCap, demotes } of foldCases) {
    it(`--merge writes the folded ${sequence} sequence's bytes (run cap ${runCap ?? 'default'})`, async () => {
      const pairs = foldSequence(sequence).map((key, i) => ({ key, value: `${i};` }));
      const folded = new Map<bigint, string>();
      for (const { key, value } of pairs) folded.set(key, (folded.get(key) ?? '') + value);
      const foldedPairs = [...folded].sort(([a], [b]) => ascendingBigints(a, b)).map(([key, value]) => ({ key, value }));

      const expectedPath = join(tempDir, 'expected.beast2');
      await runProgram(writeIr('folded.beast2', pairEmitter(foldedPairs)), [], [], [], expectedPath, { emit: 'dict' });
      const mergePath = writeIr('merge.beast2',
        East.function([IntegerType, StringType, StringType], StringType, (_$, _key, acc, value) => acc.concat(value)));
      const outputPath = join(tempDir, 'output.beast2');
      const err = await withEnv({ EAST_EMIT_RUN_ELEMENTS: runCap }, () => stderrOf(() =>
        runProgram(writeIr('program.beast2', pairEmitter(pairs)), [], [], [], outputPath, { emit: 'dict', merge: mergePath })));

      assert.equal(err.includes('left ascending order'), demotes, err);
      assert.deepEqual(new Uint8Array(readFileSync(outputPath)), new Uint8Array(readFileSync(expectedPath)),
        'the folded output must be byte-identical to the flag-less sink\'s output for the folded sequence');
      assert.ok(!existsSync(`${outputPath}.run0`) && !existsSync(`${outputPath}.run0.p1`), 'temporary runs are removed');
    });

    it(`--union writes the ${sequence} sequence's distinct keys' bytes (run cap ${runCap ?? 'default'})`, async () => {
      const keys = foldSequence(sequence);
      const distinct = [...new Set(keys)].sort(ascendingBigints);

      const expectedPath = join(tempDir, 'expected.beast2');
      await runProgram(writeIr('folded.beast2', keyEmitter(distinct)), [], [], [], expectedPath, { emit: 'set' });
      const outputPath = join(tempDir, 'output.beast2');
      const err = await withEnv({ EAST_EMIT_RUN_ELEMENTS: runCap }, () => stderrOf(() =>
        runProgram(writeIr('program.beast2', keyEmitter(keys)), [], [], [], outputPath, { emit: 'set', union: true })));

      assert.equal(err.includes('left ascending order'), demotes, err);
      assert.deepEqual(new Uint8Array(readFileSync(outputPath)), new Uint8Array(readFileSync(expectedPath)),
        'the union output must be byte-identical to the flag-less sink\'s output for the distinct keys');
      assert.ok(!existsSync(`${outputPath}.run0`) && !existsSync(`${outputPath}.run0.p1`), 'temporary runs are removed');
    });
  }

  it('the merge takes more passes as the output grows while the peak stays at the run caps', async () => {
    // Gate (a): the sink's memory is bounded by its run caps, not by the
    // output. Under a 64-entry run cap, 50,000 and 400,000 out-of-order
    // emissions (every element encoded in the same number of bytes) report
    // the same peak entries and bytes and merge 64 runs at once; only the
    // passes grow — 783 sources (the demoted prefix, 781 spills, the tail) in
    // 2, 6,251 in 3. A byte cap below one run's bytes spills by bytes: fewer
    // entries per run than the element cap allows.
    const scatter = (count: bigint) => East.function([emitKeyType], NullType, ($, emit) => {
      $.for(East.Array.range(0n, count), ($, i) => {
        $(emit(i.multiply(7919n).remainder(count).add(1_000_000_000_000n)));
      });
    });
    const epilogue = /emit: merged (\d+) source\(s\) in (\d+) pass\(es\) \((\d+) runs per pass\); (\d+) spill\(s\), peak (\d+) entries \/ ([\d.]+ [KM]?B) buffered/;
    const account = async (count: bigint, name: string, runBytes?: string) => {
      const outputPath = join(tempDir, name);
      const err = await withEnv({ EAST_EMIT_RUN_ELEMENTS: '64', EAST_EMIT_RUN_BYTES: runBytes }, () => stderrOf(() =>
        runProgram(writeIr('scatter.beast2', scatter(count)), [], [], [], outputPath, { emit: 'set', verbose: true })));
      const match = epilogue.exec(err);
      assert.ok(match !== null, `-v printed no emit epilogue:\n${err}`);
      const [, sources, passes, runsPerPass, spills, peakEntries, peakBytes] = match;
      return { sources: Number(sources), passes: Number(passes), runsPerPass: Number(runsPerPass), spills: Number(spills), peakEntries: Number(peakEntries), peakBytes };
    };

    const small = await account(50_000n, 'small.beast2');
    const large = await account(400_000n, 'large.beast2');
    const byBytes = await account(50_000n, 'by-bytes.beast2', '256');

    assert.equal(small.peakBytes, large.peakBytes, 'the peak bytes do not depend on the output');
    assert.deepEqual([small.peakEntries, small.runsPerPass, large.peakEntries, large.runsPerPass], [64, 64, 64, 64]);
    assert.deepEqual([small.sources, small.passes], [783, 2]);
    assert.deepEqual([large.sources, large.passes], [6251, 3]);
    assert.ok(byBytes.peakEntries > 0 && byBytes.peakEntries < 64, `a 256-byte cap spills by bytes: peak ${byBytes.peakEntries} entries`);
    assert.ok(byBytes.spills > small.spills, `${byBytes.spills} spills under the byte cap, ${small.spills} under the element cap alone`);
    assert.equal(openBeast2PagesFor(SetType(IntegerType))(new Uint8Array(readFileSync(join(tempDir, 'large.beast2')))).elementCount, 400_000);
    assert.ok(!existsSync(join(tempDir, 'large.beast2.run0')) && !existsSync(join(tempDir, 'large.beast2.run0.p1')), 'temporary runs are removed');
  });

  it('a runner given the stdin lifeline exits once its stdin closes, mid-computation', async () => {
    // Gate (c): with EAST_EXIT_WITH_PARENT=1 and a stdin pipe nobody writes,
    // the runner exits once that pipe closes. The body's out-of-order second
    // emission prints the sink's demote notice (the body is running), then
    // the body loops forever — only the watcher stops it.
    const spin = East.function([emitKeyType], NullType, ($, emit) => {
      $(emit(2n));
      $(emit(1n));
      const turns = $.let(0n);
      $.while(true, ($) => {
        $.assign(turns, turns.add(1n));
      });
    });
    const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));
    // As in the wide-input test: point the platform loader at east-node-std.
    const stdDir = fileURLToPath(new URL('../../east-node-std', import.meta.url));
    const child = spawn(process.execPath,
      [bin, 'run', writeIr('spin.beast2', spin), '-p', '@elaraai/east-node-std', '--emit', 'set', '-o', join(tempDir, 'spin-output.beast2')],
      { env: { ...process.env, EAST_EXIT_WITH_PARENT: '1', E3_RUNNER_SEARCH_DIRS: stdDir }, stdio: ['pipe', 'ignore', 'pipe'] });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    let stderr = '';
    const running = new Promise<boolean>((resolve) => {
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (chunk: string) => {
        stderr += chunk;
        if (stderr.includes('left ascending order')) resolve(true);
      });
      void exited.then(() => resolve(false));
    });
    try {
      // Bounded liveness waits: start-up, then the watcher.
      assert.equal(await within(running, 30_000), true, `the runner never reported its body running:\n${stderr}`);
      child.stdin!.destroy(); // the lifeline closes
      const outcome = await within(exited, 10_000);
      assert.ok(outcome !== undefined, 'the runner outlived its closed stdin by 10 s');
      // The watcher kills the whole process: nothing else sends it SIGKILL.
      if (process.platform !== 'win32') assert.equal(outcome.signal, 'SIGKILL', stderr);
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
    const child = spawn(process.execPath, [bin, 'run', writeIr('busy.beast2', busy), '-p', 'empty-platform', '-o', outputPath],
      { env: { ...process.env, EAST_EXIT_WITH_PARENT: '1', E3_RUNNER_SEARCH_DIRS: tempDir }, stdio: ['pipe', 'ignore', 'pipe'] });
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
