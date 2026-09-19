/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/*
 * Cross-runtime pin for the east-c emit sink and blob merge (#507, #518,
 * #770): runs the checked-in `--emit` and `merge` fixtures through a built
 * `east-c` binary, then decodes the written blobs with the TypeScript reader
 * (@elaraai/east) — proving the native output is readable, pageable and
 * value-identical under another runtime's reader (the compliance-suite
 * philosophy applied to emitted outputs). Set/Dict emissions must ascend
 * (#770): an out-of-order key is the canonical error and the aborted output
 * carries no index; the merge over sorted partials — whole, and over a key
 * range — is the canonical dict under the TS reader. The ctest gates
 * (test_cli_emit.c, test_cli_merge.c) validate the same blobs with east-c's
 * own readers; this script is the other direction.
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

function mergeCli(args) {
  const result = spawnSync(bin, ['merge', ...args], { encoding: 'utf-8' });
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

  // Dict producer: canonical ascending pairs, keyed content intact.
  {
    const out = join(scratch, 'dict.beast2');
    const run = runCli([join(fixtures, 'emit_dict.beast2'), '--emit', 'dict', '-o', out]);
    assert.equal(run.status, 0, `dict failed: ${run.stderr}`);
    const dictBlob = new Uint8Array(readFileSync(out));
    assert.equal(openBeast2PagesFor(DT)(dictBlob).elementCount, 1000);
    const table = decodeBeast2For(DT)(dictBlob);
    assert.equal(table.size, 1000);
    assert.equal(table.get(42n), 'row-42');
    console.log('dict: TS reader OK (1000 pairs, indexed)');
  }

  // Out-of-order dict (#770): Set/Dict emissions must ascend — the sink
  // refuses the second key with the canonical message, in the words the
  // TypeScript sink uses, and the aborted output reads back as no indexed
  // blob.
  {
    const out = join(scratch, 'disorder.beast2');
    const run = runCli([join(fixtures, 'emit_dict_disorder.beast2'), '--emit', 'dict', '-o', out]);
    assert.equal(run.status, 1, 'disorder run should exit 1');
    assert.match(run.stderr, /beast2 v5: Dict key emitted out of order: 1 after 2 — Set\/Dict emissions must ascend in East order/);
    assert.throws(() => openBeast2PagesFor(DT)(new Uint8Array(readFileSync(out))));
    console.log('disorder: canonical rejection OK');
  }

  // The blob merge (#770): three sorted TS-written Dict inputs whose keys
  // overlap (a = 0..19, b = 10..29, c = {5, 15, 25, 40}) fold under the
  // concatenating merge, in input order, to the canonical dict under the TS
  // reader; over the key range [7, 22) only those keys, sought through each
  // input's fences.
  {
    const inputs = ['a', 'b', 'c'].flatMap((name) => ['-i', join(fixtures, `merge_in_${name}.beast2`)]);
    const out = join(scratch, 'merged.beast2');
    const run = mergeCli(['--merge', join(fixtures, 'emit_merge_concat.beast2'), ...inputs, '-o', out]);
    assert.equal(run.status, 0, `merge failed: ${run.stderr}`);
    const blob = new Uint8Array(readFileSync(out));
    assert.equal(openBeast2PagesFor(DT)(blob).elementCount, 31);
    const table = decodeBeast2For(DT)(blob);
    assert.equal(table.size, 31);
    assert.equal(table.get(15n), 'a15b15c15');
    assert.equal(table.get(40n), 'c40');
    assert.deepEqual([...table.keys()].slice(0, 3), [0n, 1n, 2n]);
    console.log('merge: TS reader OK (31 folded pairs, indexed)');

    const ranged = join(scratch, 'merged-range.beast2');
    const rangedRun = mergeCli([
      '--merge', join(fixtures, 'emit_merge_concat.beast2'),
      '--range', join(fixtures, 'merge_range_7_22.beast2'),
      ...inputs, '-o', ranged,
    ]);
    assert.equal(rangedRun.status, 0, `ranged merge failed: ${rangedRun.stderr}`);
    const rangedTable = decodeBeast2For(DT)(new Uint8Array(readFileSync(ranged)));
    assert.deepEqual([...rangedTable.keys()], Array.from({ length: 15 }, (_, i) => BigInt(7 + i)));
    assert.equal(rangedTable.get(15n), 'a15b15c15');
    assert.equal(rangedTable.get(21n), 'b21');
    console.log('merge --range: TS reader OK (keys 7..21)');
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
