/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/*
 * Regenerates the checked-in runner test fixtures: tiny East IR programs
 * (beast2-encoded, source map included), a TS-written input blob and a unit,
 * shared verbatim by the east-c ctest gates (tests/test_cli_*.c) and the
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
  UnitType,
  compareFor,
  encodeBeast2For,
  encodeBeast2SegmentsFor,
  encodeEastIR,
  variant,
} from '@elaraai/east';

const here = dirname(fileURLToPath(import.meta.url));
const targets = [
  join(here, 'fixtures'),
  join(here, '..', '..', '..', '..', 'east-py', 'packages', 'east-py-cli', 'tests', 'fixtures'),
];

const emitInt = FunctionType([IntegerType], NullType);

const IntStringDict = DictType(IntegerType, StringType);
const intCmp = compareFor(IntegerType);

/** A collection written in `size`-element segments — the fixture's own
 *  geometry, not the cut rule's, so a small input still spans several
 *  segments for the lazy reads to cross. `chunk` builds one segment's value
 *  from its slice of `items`. */
function segmented(type, size, items, chunk) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(chunk(items.slice(i, i + size)));
  return encodeBeast2SegmentsFor(type)(batches);
}

const fixtures = {
  // A program emitting 2500 values through its trailing emit parameter: an
  // IR the `ir` toolbox normalizes, diffs and converts.
  'emit_producer.beast2': encodeEastIR(
    East.function([emitInt], NullType, ($, emit) => {
      $.for(East.Array.range(0n, 2500n), ($, i) => {
        $(emit(i.multiply(2n)));
      });
    }).toIR(),
  ),

  // A zero-parameter program.
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

  // ---- Lazy paged-input pins (#516) ----------------------------------

  // A keyed `has`, which the residency tests run over their inputs. The
  // keyed read of a corrupt blob, and the writes to a frozen input, are
  // runner protocol corpus cases (east/test/runner_corpus.spec.ts).
  'paged_has.beast2': encodeEastIR(
    East.function([IntStringDict], BooleanType, (_$, d) => d.has(5n)).toIR(),
  ),

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
  'paged_nested.beast2': segmented(
    DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) })),
    2,
    [[1n, { xs: [1n, 2n] }], [2n, { xs: [] }], [3n, { xs: [3n] }]],
    (chunk) => new SortedMap(chunk, intCmp),
  ),

  // ---- The lifeline (#770) ----------------------------------------------

  // One emission, then a loop that never ends, which only the
  // exit-with-parent watcher stops.
  'emit_spin.beast2': encodeEastIR(
    East.function([emitInt], NullType, ($, emit) => {
      $(emit(1n));
      const turns = $.let(0n);
      $.while(true, ($) => {
        $.assign(turns, turns.add(1n));
      });
    }).toIR(),
  ),

  // The unit that runs it, its one element going to a set output. Its paths
  // are relative, so the unit runs wherever it is copied beside the program.
  // The sink creates the output directory before the program runs, so the
  // directory's appearance is the sign the runner is up.
  'lifeline_unit.beast2': encodeBeast2For(UnitType)({
    work: variant('run', { program: 'emit_spin.beast2', inputs: [], output: variant('set', 'lifeline_output') }),
    platforms: [],
    threads: 1n,
    result: 'lifeline_result.beast2',
  }),
};

for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(fixtures)) {
    writeFileSync(join(dir, name), data);
    console.log(`wrote ${join(dir, name)} (${data.length} bytes)`);
  }
}
