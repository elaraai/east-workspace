/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/*
 * Regenerates the checked-in `--emit` and `merge` test fixtures: tiny East
 * IR programs (beast2-encoded, source map included) plus TS-paged-written
 * input blobs, shared verbatim by the east-c ctest gates (tests/test_cli_emit.c,
 * tests/test_cli_merge.c) and the east-py-cli pytest suite
 * (libs/east-py/packages/east-py-cli/tests/fixtures). Keeping the TS writer
 * as the fixture source makes every native-runner test that READS these
 * blobs a cross-runtime decode of TS-written bytes.
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
  SetType,
  SortedMap,
  SortedSet,
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

/** The fold contract's emission sequence (#770), as keys: 0..1199 in order
 *  with adjacent duplicates — every third key twice, and key 999, the last
 *  entry of a full 1000-element batch, four times. */
function foldSequence() {
  const ascending = [];
  for (let k = 0; k < 1200; k++) {
    const copies = 1 + (k % 3 === 0 ? 1 : 0) + (k % 1000 === 999 ? 2 : 0);
    for (let c = 0; c < copies; c++) ascending.push(BigInt(k));
  }
  return ascending;
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

const foldKeys = foldSequence();
const ascendingPairs = foldPairs(foldKeys);

/** The blob merge's inputs (#770): three sorted Dicts whose keys overlap —
 *  a = 0..19, b = 10..29, c = {5, 15, 25, 40} — each value naming its input,
 *  and their fold under the concatenating merge in input order. */
const mergeKeys = {
  a: Array.from({ length: 20 }, (_, k) => k),
  b: Array.from({ length: 20 }, (_, k) => k + 10),
  c: [5, 15, 25, 40],
};
const IntStringDict = DictType(IntegerType, StringType);
const intCmp = compareFor(IntegerType);
function mergeInput(name) {
  return encodeBeast2PagedFor(IntStringDict, { batchSize: 4 })(
    new SortedMap(mergeKeys[name].map((k) => [BigInt(k), `${name}${k}`]), intCmp),
  );
}
function mergeSetInput(name) {
  return encodeBeast2PagedFor(SetType(IntegerType), { batchSize: 4 })(
    new SortedSet(mergeKeys[name].map((k) => BigInt(k)), intCmp),
  );
}
const mergeFolded = new Map();
for (const name of ['a', 'b', 'c']) {
  for (const k of mergeKeys[name]) mergeFolded.set(k, (mergeFolded.get(k) ?? '') + `${name}${k}`);
}
const mergeFoldedPairs = [...mergeFolded]
  .sort(([x], [y]) => x - y)
  .map(([k, v]) => ({ key: BigInt(k), value: v }));
const mergeDistinct = unionKeys([...mergeKeys.a, ...mergeKeys.b, ...mergeKeys.c].map((k) => BigInt(k)));

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

  // Dict producer emitting out of key order on the second emit — Set/Dict
  // emissions must ascend in East order (#770): the sink writes one pass,
  // and this is the out-of-order error naming both keys.
  'emit_dict_disorder.beast2': encodeEastIR(
    East.function([emitPair], NullType, ($, emit) => {
      $(emit(2n, 'b'));
      $(emit(1n, 'a'));
    }).toIR(),
  ),

  // Duplicate key emitted adjacently — a hard error.
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

  // ---- Folding sinks and the lifeline (#770) ---------------------------

  // The fold contract: the ascending sequence emitted with --merge (dict) or
  // --union (set), and the fold of that sequence emitted for the flag-less
  // sink — the two outputs must be byte-identical.
  'emit_merge_concat.beast2': encodeEastIR(
    East.function([IntegerType, StringType, StringType], StringType, (_$, _key, acc, value) =>
      acc.concat(value),
    ).toIR(),
  ),
  'emit_merge_ascending.beast2': encodeEastIR(pairEmitter(ascendingPairs.pairs)),
  'emit_merge_ascending_folded.beast2': encodeEastIR(pairEmitter(ascendingPairs.folded)),
  'emit_union_ascending.beast2': encodeEastIR(keyEmitter(foldKeys)),
  'emit_union_ascending_folded.beast2': encodeEastIR(keyEmitter(unionKeys(foldKeys))),

  // ---- The blob merge (#770) --------------------------------------------

  // Sorted inputs written by the TS paged writer in four-entry segments;
  // `merge --merge` over the three Dicts and `merge --union` over the three
  // Sets must write exactly the bytes `run --emit` writes for the folded
  // (respectively distinct) sequence emitted ascending. An empty input, and a
  // Dict of another type for the mismatch refusal.
  'merge_in_a.beast2': mergeInput('a'),
  'merge_in_b.beast2': mergeInput('b'),
  'merge_in_c.beast2': mergeInput('c'),
  'merge_expected_dict.beast2': encodeEastIR(pairEmitter(mergeFoldedPairs)),
  'merge_set_a.beast2': mergeSetInput('a'),
  'merge_set_b.beast2': mergeSetInput('b'),
  'merge_set_c.beast2': mergeSetInput('c'),
  'merge_expected_set.beast2': encodeEastIR(keyEmitter(mergeDistinct)),
  'merge_empty.beast2': encodeBeast2PagedFor(IntStringDict, { batchSize: 4 })(new SortedMap([], intCmp)),
  'merge_mismatch.beast2': encodeBeast2PagedFor(DictType(StringType, FloatType), { batchSize: 4 })(
    new SortedMap([['x', 1.5]], compareFor(StringType)),
  ),

  // The lifeline: one emission, then a loop that never ends, which only the
  // exit-with-parent watcher stops. The sink opens the output file before the
  // body runs, so the file's existence is the gate's sign that the runner is
  // up and computing.
  'emit_spin.beast2': encodeEastIR(
    East.function([emitInt], NullType, ($, emit) => {
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
