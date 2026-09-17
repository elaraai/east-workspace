/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/*
 * Regenerates the checked-in `--emit` test fixtures: tiny East IR programs
 * (beast2-encoded, source map included) plus one TS-paged-written input blob,
 * shared verbatim by the east-c ctest gate (tests/test_cli_emit.c) and the
 * east-py-cli pytest suite (libs/east-py/packages/east-py-cli/tests/fixtures).
 * Keeping the TS writer as the fixture source makes every native-runner test
 * that READS these blobs a cross-runtime decode of TS-written bytes.
 *
 * Run after building the east package:
 *
 *   cd libs/east && make build
 *   node libs/east-c/packages/east-c-cli/tests/generate_fixtures.mjs
 *
 * Requires `pnpm install` (this package devDepends on @elaraai/east).
 * The programs mirror east-node-cli/src/runner.spec.ts so all three runners
 * are pinned against the same shapes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ArrayType,
  BooleanType,
  DictType,
  East,
  FloatType,
  FunctionType,
  IntegerType,
  NullType,
  SortedMap,
  StringType,
  StructType,
  compareFor,
  encodeBeast2PagedFor,
  encodeEastIR,
  spliceBeast2,
} from '@elaraai/east';

const here = dirname(fileURLToPath(import.meta.url));
const targets = [
  join(here, 'fixtures'),
  join(here, '..', '..', '..', '..', 'east-py', 'packages', 'east-py-cli', 'tests', 'fixtures'),
];

const emitInt = FunctionType([IntegerType], NullType);
const emitPair = FunctionType([IntegerType, StringType], NullType);
const NestedT = StructType({
  label: StringType,
  items: ArrayType(StructType({ x: IntegerType, y: FloatType })),
});
const emitNested = FunctionType([IntegerType, NestedT], NullType);

/** A dict producer whose values are structs of arrays of structs, emitted
 *  in the given key order: the sink encodes an out-of-order emission at
 *  the emit and merges runs of bytes, and its output must be byte-identical
 *  to the ascending producer's. */
function nestedProducer(keys) {
  return East.function([emitNested], NullType, ($, emit) => {
    $.for($.const(keys, ArrayType(IntegerType)), ($, i) => {
      $(
        emit(i, {
          label: East.str`row-${i}`,
          items: [
            { x: i, y: 0.5 },
            { x: i.add(1n), y: 1.5 },
            { x: i.add(2n), y: 2.5 },
          ],
        }),
      );
    });
  }).toIR();
}

/** `items` in a deterministic Fisher-Yates shuffle (fixed LCG seed), so the
 *  disorder the sink must absorb is stable across fixture regenerations. */
function shuffled(items) {
  const out = items.slice();
  let seed = 12345;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The 0..count keys in the deterministic shuffle. */
function shuffledKeys(count) {
  return shuffled(Array.from({ length: count }, (_, i) => BigInt(i)));
}

const PairT = StructType({ key: IntegerType, value: StringType });

/** A dict producer emitting the given (key, value) pairs in order. */
function pairEmitter(pairs) {
  return East.function([emitPair], NullType, ($, emit) => {
    $.for($.const(pairs, ArrayType(PairT)), ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  }).toIR();
}

/** A set producer emitting the given keys in order. */
function keyEmitter(keys) {
  return East.function([emitInt], NullType, ($, emit) => {
    $.for($.const(keys, ArrayType(IntegerType)), ($, key) => {
      $(emit(key));
    });
  }).toIR();
}

/** The fold contract's emission sequences (#770), as keys. `ascending` emits
 *  0..1199 in order with adjacent duplicates: every third key twice, and key
 *  999 — the last entry of a full 1000-element batch — four times.
 *  `scattered` emits 0..19 in order, each twice, then 7 again (the first key
 *  out of order: the prefix demotes, and 7 must fold across it), then 0..599
 *  shuffled with one to three copies each, so equal keys meet in the prefix,
 *  within a run and across runs. */
function foldSequences() {
  const ascending = [];
  for (let k = 0; k < 1200; k++) {
    const copies = 1 + (k % 3 === 0 ? 1 : 0) + (k % 1000 === 999 ? 2 : 0);
    for (let c = 0; c < copies; c++) ascending.push(BigInt(k));
  }
  const rest = [];
  for (let k = 0; k < 600; k++) {
    const copies = 1 + (k % 4 === 1 ? 1 : 0) + (k % 7 === 2 ? 1 : 0);
    for (let c = 0; c < copies; c++) rest.push(BigInt(k));
  }
  const scattered = [];
  for (let k = 0; k < 20; k++) scattered.push(BigInt(k), BigInt(k));
  scattered.push(7n, ...shuffled(rest));
  return { ascending, scattered };
}

/** A key sequence as dict emissions — each value names its emission — and
 *  its fold under the concatenating merge, ascending by key. */
function foldPairs(keys) {
  const pairs = keys.map((key, i) => ({ key, value: `${i};` }));
  const folded = new Map();
  for (const { key, value } of pairs) folded.set(key, (folded.get(key) ?? '') + value);
  const ascending = [...folded].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { pairs, folded: ascending.map(([key, value]) => ({ key, value })) };
}

/** A key sequence's union: its distinct keys, ascending. */
function unionKeys(keys) {
  return [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A set producer emitting 0..count scattered by a multiplicative step and
 *  offset by 10^12: every element distinct and encoded in the same number of
 *  bytes, so the sink's peak buffered bytes depend on its run cap alone. */
function scatterEmitter(count) {
  return East.function([emitInt], NullType, ($, emit) => {
    $.for(East.Array.range(0n, count), ($, i) => {
      $(emit(i.multiply(7919n).remainder(count).add(1_000_000_000_000n)));
    });
  }).toIR();
}

const folds = foldSequences();
const ascendingPairs = foldPairs(folds.ascending);
const scatteredPairs = foldPairs(folds.scattered);

const fixtures = {
  // Producer: no file inputs, 2500 emissions of i*2 through the trailing
  // emit capability.
  'emit_producer.beast2': encodeEastIR(
    East.function([emitInt], NullType, ($, emit) => {
      $.for(East.Array.range(0n, 2500n), ($, i) => {
        $(emit(i.multiply(2n)));
      });
    }).toIR(),
  ),

  // Stream fold: one Array<Integer> input folded to running sums, each
  // emitted.
  'emit_fold.beast2': encodeEastIR(
    East.function([ArrayType(IntegerType), emitInt], NullType, ($, events, emit) => {
      const acc = $.let(0n);
      $.for(events, ($, v) => {
        $.assign(acc, acc.add(v));
        $(emit(acc));
      });
    }).toIR(),
  ),

  // Dict producer emitting 1000 pairs in ascending key order.
  'emit_dict.beast2': encodeEastIR(
    East.function([emitPair], NullType, ($, emit) => {
      $.for(East.Array.range(0n, 1000n), ($, i) => {
        $(emit(i, East.str`row-${i}`));
      });
    }).toIR(),
  ),

  // Dict producer emitting out of key order on the second emit — since
  // issue #518 the sink absorbs this (sort-in-the-sink) and the output is
  // the canonical two-pair dict.
  'emit_dict_disorder.beast2': encodeEastIR(
    East.function([emitPair], NullType, ($, emit) => {
      $(emit(2n, 'b'));
      $(emit(1n, 'a'));
    }).toIR(),
  ),

  // Dict producer emitting the same 1000 pairs as emit_dict in a
  // deterministically shuffled order — the sink must spill/merge to the
  // byte-identical canonical blob (issue #518; run tiny
  // EAST_EMIT_RUN_ELEMENTS to force multiple spill runs).
  'emit_dict_shuffled.beast2': encodeEastIR(
    East.function([emitPair], NullType, ($, emit) => {
      $.for($.const(shuffledKeys(1000), ArrayType(IntegerType)), ($, i) => {
        $(emit(i, East.str`row-${i}`));
      });
    }).toIR(),
  ),

  // Duplicate key emitted adjacently — a hard error under any emission
  // order (the `strictly` half of the old contract, which survives #518).
  'emit_dict_duplicate.beast2': encodeEastIR(
    East.function([emitPair], NullType, ($, emit) => {
      $(emit(1n, 'a'));
      $(emit(1n, 'b'));
    }).toIR(),
  ),

  // Wide-row producer: 1500 emissions of ~4 KiB strings. The first batch
  // fills the element cap, and byte-adaptive re-batching must then shrink
  // subsequent batches toward the segment byte target — a runner that
  // re-batches by row count alone writes grossly oversized segments.
  'emit_wide.beast2': encodeEastIR(
    East.function([FunctionType([StringType], NullType)], NullType, ($, emit) => {
      $.for(East.Array.range(0n, 1500n), ($, i) => {
        $(emit(East.str`${'x'.repeat(4096)}-${i}`));
      });
    }).toIR(),
  ),

  // A zero-parameter program: `--emit` on it must fail with the shaped
  // emit-capability error (there is no trailing parameter), never a
  // traceback or a negative arity count.
  'zero_param.beast2': encodeEastIR(East.function([], IntegerType, (_$) => 1n).toIR()),

  // A helper called 100 times from a loop: `--profile` must list it with
  // its call count and the source location of its definition.
  'profile_calls.beast2': (() => {
    const inc = East.function([IntegerType], IntegerType, (_$, x) => x.add(1n));
    return encodeEastIR(
      East.function([], IntegerType, ($) => {
        const acc = $.let(0n);
        $.for(East.Array.range(0n, 100n), ($, _i) => {
          $.assign(acc, inc(acc));
        });
        return acc;
      }).toIR(),
    );
  })(),

  // The fold's input: [0..2500), written segmented + indexed by the TS
  // paged writer (500 elements per segment).
  'events.beast2': encodeBeast2PagedFor(ArrayType(IntegerType), { batchSize: 500 })(
    Array.from({ length: 2500 }, (_, i) => BigInt(i)),
  ),

  // ---- Lazy paged-input pins (#516) ----------------------------------

  // Inputs are frozen: mutating a dict input (inside its own $.for) must
  // raise the uniform copy-first error on a lazily-opened input, refused
  // before any hydration.
  'paged_for_mutate.beast2': encodeEastIR(
    East.function([DictType(IntegerType, StringType)], NullType, ($, d) => {
      $.for(d, (_$, _v, _k) => d.insert(999n, 'x'));
      return null;
    }).toIR(),
  ),
  'paged_table.beast2': encodeBeast2PagedFor(DictType(IntegerType, StringType), { batchSize: 2 })(
    new SortedMap(
      Array.from({ length: 10 }, (_, i) => [BigInt(i), `row-${i}`]),
      compareFor(IntegerType),
    ),
  ),

  // A corrupt paged blob (a high key range spliced BEFORE a low one, so the
  // fences are not disjoint ascending): a keyed `has` on it must propagate
  // the pager error, never answer `false`.
  'paged_has.beast2': encodeEastIR(
    East.function([DictType(IntegerType, StringType)], BooleanType, (_$, d) => d.has(5n)).toIR(),
  ),
  'paged_corrupt.beast2': spliceBeast2([
    encodeBeast2PagedFor(DictType(IntegerType, StringType), { batchSize: 2 })(
      new SortedMap(
        Array.from({ length: 6 }, (_, i) => [BigInt(i + 1000), `row-${i + 1000}`]),
        compareFor(IntegerType),
      ),
    ),
    encodeBeast2PagedFor(DictType(IntegerType, StringType), { batchSize: 2 })(
      new SortedMap(
        Array.from({ length: 6 }, (_, i) => [BigInt(i), `row-${i}`]),
        compareFor(IntegerType),
      ),
    ),
  ]),

  // The collapsed shape gate: a nested-container element type opens lazily
  // AND frozen under the threshold, so the write through a read-out element
  // must raise the uniform copy-first error instead of landing.
  'paged_nested_mutate.beast2': encodeEastIR(
    East.function(
      [DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) }))],
      IntegerType,
      ($, d) => {
        const row = $.let(d.get(1n));
        $(row.xs.pushLast(42n));
        $(d.insert(99n, { xs: [] }));
        return d.get(1n).xs.size();
      },
    ).toIR(),
  ),
  'paged_nested.beast2': encodeBeast2PagedFor(
    DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) })),
    { batchSize: 2 },
  )(
    new SortedMap(
      [[1n, { xs: [1n, 2n] }], [2n, { xs: [] }], [3n, { xs: [3n] }]],
      compareFor(IntegerType),
    ),
  ),

  // ---- Encode-at-the-emit pins ----------------------------------------

  // 300 nested-value pairs in ascending order, and the same pairs in a
  // deterministically shuffled order (run under a tiny
  // EAST_EMIT_RUN_ELEMENTS to force several raw spill runs).
  'emit_nested.beast2': encodeEastIR(
    nestedProducer(Array.from({ length: 300 }, (_, i) => BigInt(i))),
  ),
  'emit_nested_shuffled.beast2': encodeEastIR(nestedProducer(shuffledKeys(300))),

  // ---- Folding sinks, bounded runs, the lifeline (#770) ----------------

  // The fold contract: each sequence emitted with --merge (dict) or --union
  // (set), and the fold of that sequence emitted ascending for the flag-less
  // sink — the two outputs must be byte-identical.
  'emit_merge_concat.beast2': encodeEastIR(
    East.function([IntegerType, StringType, StringType], StringType, (_$, _key, acc, value) =>
      acc.concat(value),
    ).toIR(),
  ),
  'emit_merge_ascending.beast2': encodeEastIR(pairEmitter(ascendingPairs.pairs)),
  'emit_merge_ascending_folded.beast2': encodeEastIR(pairEmitter(ascendingPairs.folded)),
  'emit_merge_scattered.beast2': encodeEastIR(pairEmitter(scatteredPairs.pairs)),
  'emit_merge_scattered_folded.beast2': encodeEastIR(pairEmitter(scatteredPairs.folded)),
  'emit_union_ascending.beast2': encodeEastIR(keyEmitter(folds.ascending)),
  'emit_union_ascending_folded.beast2': encodeEastIR(keyEmitter(unionKeys(folds.ascending))),
  'emit_union_scattered.beast2': encodeEastIR(keyEmitter(folds.scattered)),
  'emit_union_scattered_folded.beast2': encodeEastIR(keyEmitter(unionKeys(folds.scattered))),

  // Bounded runs: 50,000 and 400,000 out-of-order emissions, run under a tiny
  // EAST_EMIT_RUN_ELEMENTS so the merge takes more passes as the output grows.
  'emit_scatter_50k.beast2': encodeEastIR(scatterEmitter(50_000n)),
  'emit_scatter_400k.beast2': encodeEastIR(scatterEmitter(400_000n)),

  // The lifeline: two emissions out of order — the sink's demote notice on
  // stderr says the body is running — then a loop that never ends, which only
  // the EAST_EXIT_WITH_PARENT watcher stops.
  'emit_spin.beast2': encodeEastIR(
    East.function([emitInt], NullType, ($, emit) => {
      $(emit(2n));
      $(emit(1n));
      const turns = $.let(0n);
      $.while(true, ($) => {
        $.assign(turns, turns.add(1n));
      });
    }).toIR(),
  ),
};

for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(fixtures)) {
    writeFileSync(join(dir, name), data);
    console.log(`wrote ${join(dir, name)} (${data.length} bytes)`);
  }
}
