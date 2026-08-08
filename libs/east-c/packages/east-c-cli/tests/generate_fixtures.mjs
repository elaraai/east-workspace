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

/** The 0..count keys in a deterministic Fisher-Yates shuffle (fixed LCG
 *  seed), so the disorder the sink must absorb is stable across fixture
 *  regenerations. */
function shuffledKeys(count) {
  const keys = Array.from({ length: count }, (_, i) => BigInt(i));
  let seed = 12345;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

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

  // The fold's input: [0..2500), written segmented + indexed by the TS
  // paged writer (500 elements per segment).
  'events.beast2': encodeBeast2PagedFor(ArrayType(IntegerType), { batchSize: 500 })(
    Array.from({ length: 2500 }, (_, i) => BigInt(i)),
  ),

  // ---- Lazy paged-input pins (#516) ----------------------------------

  // Mutating a dict inside its own $.for must raise the canonical
  // iteration-lock error on a lazily-opened input exactly as on eager.
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

  // The shape gate: a mutable-nested element type must decode eagerly, so a
  // write through a read-out element lands in the input (result 3) even
  // when the size threshold would otherwise open it lazily.
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
};

for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(fixtures)) {
    writeFileSync(join(dir, name), data);
    console.log(`wrote ${join(dir, name)} (${data.length} bytes)`);
  }
}
