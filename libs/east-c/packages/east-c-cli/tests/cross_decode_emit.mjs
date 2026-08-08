/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/*
 * Cross-runtime pin for the east-c emit sink (#507, #518): runs the
 * checked-in `--emit` fixtures through a built `east-c` binary, then
 * decodes the emitted blobs with the TypeScript reader (@elaraai/east) —
 * proving the native sink's output is readable, pageable and
 * value-identical under another runtime's reader (the compliance-suite
 * philosophy applied to emitted outputs). Includes the order-robust paths:
 * the out-of-order demote→spill→merge output must be canonical under the
 * TS reader and byte-identical to the ordered producer's blob. The ctest
 * gate (test_cli_emit.c) validates the same blobs with east-c's own
 * readers; this script is the other direction.
 *
 * Usage (after `pnpm install` and building libs/east):
 *
 *   node tests/cross_decode_emit.mjs <path-to-east-c-binary>
 *
 * or from libs/east-c: `make test-emit-cross`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ArrayType,
  DictType,
  IntegerType,
  StringType,
  decodeBeast2For,
  openBeast2PagesFor,
} from '@elaraai/east';

const bin = process.argv[2];
if (!bin) {
  console.error('usage: node cross_decode_emit.mjs <path-to-east-c-binary>');
  process.exit(2);
}

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const scratch = mkdtempSync(join(tmpdir(), 'east-c-emit-cross-'));

function runCli(args, env = {}) {
  const result = spawnSync(bin, ['run', ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result;
}

try {
  const AT = ArrayType(IntegerType);
  const DT = DictType(IntegerType, StringType);

  // Producer: 2500 emissions land segmented + indexed, value-identical
  // under the TS reader.
  {
    const out = join(scratch, 'producer.beast2');
    const run = runCli([join(fixtures, 'emit_producer.beast2'), '--emit', 'array', '-o', out]);
    assert.equal(run.status, 0, `producer failed: ${run.stderr}`);
    const blob = new Uint8Array(readFileSync(out));
    const pages = openBeast2PagesFor(AT)(blob);
    assert.equal(pages.elementCount, 2500);
    assert.ok(pages.selfContained, 'producer blob is not pageable');
    assert.equal(pages.element(1234), 2468n);
    assert.deepEqual(decodeBeast2For(AT)(blob), Array.from({ length: 2500 }, (_, i) => BigInt(2 * i)));
    console.log('producer: TS reader OK (2500 elements, indexed)');
  }

  // Stream fold over the TS-paged-written events input.
  {
    const out = join(scratch, 'fold.beast2');
    const run = runCli([
      join(fixtures, 'emit_fold.beast2'),
      '--emit', 'array', '--stream', '0',
      '-i', join(fixtures, 'events.beast2'),
      '-o', out,
    ]);
    assert.equal(run.status, 0, `fold failed: ${run.stderr}`);
    const sums = decodeBeast2For(AT)(new Uint8Array(readFileSync(out)));
    assert.equal(sums.length, 2500);
    assert.equal(sums[0], 0n);
    assert.equal(sums[2499], (2499n * 2500n) / 2n);
    console.log('fold: TS reader OK (running sums)');
  }

  // Dict producer: canonical ascending pairs, keyed content intact. The
  // blob is kept for the shuffled byte-identity check below.
  let dictBlob;
  {
    const out = join(scratch, 'dict.beast2');
    const run = runCli([join(fixtures, 'emit_dict.beast2'), '--emit', 'dict', '-o', out]);
    assert.equal(run.status, 0, `dict failed: ${run.stderr}`);
    dictBlob = new Uint8Array(readFileSync(out));
    assert.equal(openBeast2PagesFor(DT)(dictBlob).elementCount, 1000);
    const table = decodeBeast2For(DT)(dictBlob);
    assert.equal(table.size, 1000);
    assert.equal(table.get(42n), 'row-42');
    console.log('dict: TS reader OK (1000 pairs, indexed)');
  }

  // Out-of-order dict (#518): the sink absorbs the disorder (demote →
  // spill → merge), reports the transition on stderr, and the output is
  // the canonical dict under the TS reader.
  {
    const out = join(scratch, 'disorder.beast2');
    const run = runCli([join(fixtures, 'emit_dict_disorder.beast2'), '--emit', 'dict', '-o', out]);
    assert.equal(run.status, 0, `disorder run failed: ${run.stderr}`);
    assert.match(run.stderr, /left ascending order/);
    const table = decodeBeast2For(DT)(new Uint8Array(readFileSync(out)));
    assert.equal(table.size, 2);
    assert.equal(table.get(1n), 'a');
    assert.equal(table.get(2n), 'b');
    console.log('disorder: sink-sorted output OK under the TS reader');
  }

  // Shuffled dict (#518): the same 1000 pairs as emit_dict emitted in
  // shuffled order under a tiny run cap — dozens of spill runs must merge
  // to the byte-identical canonical blob.
  {
    const out = join(scratch, 'shuffled.beast2');
    const run = runCli(
      [join(fixtures, 'emit_dict_shuffled.beast2'), '--emit', 'dict', '-o', out],
      { EAST_EMIT_RUN_ELEMENTS: '32' },
    );
    assert.equal(run.status, 0, `shuffled run failed: ${run.stderr}`);
    assert.deepEqual(new Uint8Array(readFileSync(out)), dictBlob,
      'merged blob must be byte-identical to the ordered producer blob');
    console.log('shuffled: spill/merge blob byte-identical OK');
  }

  // Duplicate dict key (#518): the surviving hard error — non-zero exit,
  // the canonical message, and the aborted output must not read back as an
  // indexed blob.
  {
    const out = join(scratch, 'duplicate.beast2');
    const run = runCli([join(fixtures, 'emit_dict_duplicate.beast2'), '--emit', 'dict', '-o', out]);
    assert.equal(run.status, 1, 'duplicate run should exit 1');
    assert.match(run.stderr, /duplicate Dict key emitted/);
    assert.throws(() => openBeast2PagesFor(DT)(new Uint8Array(readFileSync(out))));
    console.log('duplicate: canonical rejection OK');
  }

  console.log('cross-decode emit: all checks passed');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
