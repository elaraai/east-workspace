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
  East,
  FunctionType,
  IntegerType,
  NullType,
  StringType,
  encodeBeast2PagedFor,
  encodeEastIR,
} from '@elaraai/east';

const here = dirname(fileURLToPath(import.meta.url));
const targets = [
  join(here, 'fixtures'),
  join(here, '..', '..', '..', '..', 'east-py', 'packages', 'east-py-cli', 'tests', 'fixtures'),
];

const emitInt = FunctionType([IntegerType], NullType);
const emitPair = FunctionType([IntegerType, StringType], NullType);

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

  // Dict producer violating the strictly-ascending key contract on the
  // second emit.
  'emit_dict_disorder.beast2': encodeEastIR(
    East.function([emitPair], NullType, ($, emit) => {
      $(emit(2n, 'b'));
      $(emit(1n, 'a'));
    }).toIR(),
  ),

  // The fold's input: [0..2500), written segmented + indexed by the TS
  // paged writer (500 elements per segment).
  'events.beast2': encodeBeast2PagedFor(ArrayType(IntegerType), { batchSize: 500 })(
    Array.from({ length: 2500 }, (_, i) => BigInt(i)),
  ),
};

for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(fixtures)) {
    writeFileSync(join(dir, name), data);
    console.log(`wrote ${join(dir, name)} (${data.length} bytes)`);
  }
}
