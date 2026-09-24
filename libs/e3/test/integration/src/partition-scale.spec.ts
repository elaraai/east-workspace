/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partition assembly at scale (issue #770, gates (a) and (e)) — opt-in, never
 * run in CI.
 *
 * The job #770 was reported on: the #765 harness row (16 fields, six nested
 * arrays of 11 structs) re-keyed by a scattered id into a Dict of more than
 * 3 GiB, assembled by a `partitionTask({ merge })` on east-c. The CLI runs
 * under `NODE_OPTIONS=--max-old-space-size=256`, a fraction of one decoded
 * partial, and must finish with every row in the output. `e3 repo gc` then
 * collects the repository under `--max-old-space-size=128`, over datasets many
 * times its heap.
 *
 * Runs only with `E3_PARTITION_SCALE=1` and east-c on PATH. It writes about
 * 25 GB into its repository, scratch directories included, which it creates
 * under the temp directory, so point `TMPDIR` at a disk — a tmpfs `/tmp` would
 * hold the run in memory:
 *
 *     TMPDIR=/data/tmp E3_PARTITION_SCALE=1 node --test dist/partition-scale.spec.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import {
  ArrayType,
  Beast2Writer,
  BooleanType,
  DateTimeType,
  DictType,
  East,
  FloatType,
  IntegerType,
  StringType,
  StructType,
  type ValueTypeOf,
} from '@elaraai/east';
import { DatasetSegments, LocalStorage, workspaceGetDatasetHash } from '@elaraai/e3-core';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

const ItemType = StructType({ sku: StringType, qty: IntegerType, price: FloatType, ok: BooleanType, when: DateTimeType });
const RowType = StructType({
  id: IntegerType, site: StringType, region: StringType,
  f1: FloatType, f2: FloatType, f3: FloatType,
  n1: IntegerType, n2: IntegerType, flag: BooleanType, ts: DateTimeType,
  a0: ArrayType(ItemType), a1: ArrayType(ItemType), a2: ArrayType(ItemType),
  a3: ArrayType(ItemType), a4: ArrayType(ItemType), a5: ArrayType(ItemType),
});
const TableType = ArrayType(RowType);
const OutType = DictType(StringType, RowType);

/** Rows in the table: about 1.2 KB each on the wire, so the output passes 3 GiB. */
const ROWS = 2_720_000;
const BATCH = 1_600;
const GIB = 1024 ** 3;

/** Row `i` of the #765 harness table: noise seeded by `i`, so every run writes the same table. */
function row(i: number): ValueTypeOf<typeof RowType> {
  let seed = ((i * 2654435761) ^ 0x9e3779b9) >>> 0 || 7;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const items = (): ValueTypeOf<typeof ItemType>[] => Array.from({ length: 11 }, () => ({
    sku: `SKU-${Math.floor(rnd() * 5000)}`,
    qty: BigInt(Math.floor(rnd() * 100)),
    price: rnd() * 100,
    ok: rnd() > 0.5,
    when: new Date(1700000000000 + Math.floor(rnd() * 1e9)),
  }));
  return {
    id: BigInt(i), site: `site-${i % 40}`, region: `R${i % 7}`,
    f1: rnd(), f2: rnd(), f3: rnd(),
    n1: BigInt(i % 1000), n2: BigInt(Math.floor(rnd() * 1e6)), flag: rnd() > 0.3,
    ts: new Date(1700000000000 + i * 1000),
    a0: items(), a1: items(), a2: items(), a3: items(), a4: items(), a5: items(),
  };
}

const optedIn = process.env.E3_PARTITION_SCALE === '1';
const eastC = optedIn && spawnSync('east-c', ['version'], { stdio: 'ignore' }).status === 0;

describe('partition assembly at scale', { skip: !optedIn ? 'opt-in: set E3_PARTITION_SCALE=1' : !eastC ? 'east-c not on PATH' : false }, () => {
  let dir: string;
  let repo: string;
  const storage = new LocalStorage();

  // Every row re-keyed by a bijection mod the prime 4294967311, printed: each
  // partition's keys spread over the whole key space, so every partial
  // overlaps every other and the whole output goes through merge units.
  const table = e3.input('table', TableType);
  const rekeyed = e3.partitionTask('rekeyed', {
    partitions: [table],
    output: OutType,
    merge: ($, _key, a, _b) => a,
    targetPartitionBytes: 128 * 1024 * 1024,
    runner: { runtime: 'east-c', platforms: ['east-c-std'] },
  }, ($, slice) => {
    const out = $.let(new Map(), OutType);
    $.for(slice, ($, r) => {
      $(out.insert(East.str`k${r.id.multiply(2654435761n).remainder(4294967311n)}`, r));
    });
    return out;
  });

  /** The stored output's hash. */
  const outputHash = async (): Promise<string> => {
    const { hash } = await workspaceGetDatasetHash(storage, repo, 'ws', rekeyed.output.path);
    assert.ok(hash !== null, 'the output is set');
    return hash;
  };

  before(async () => {
    dir = createTestDir();
    mkdirSync(dir, { recursive: true });
    repo = join(dir, 'repo');

    // The table streams to disk a batch at a time.
    const tablePath = join(dir, 'table.beast2');
    const fd = openSync(tablePath, 'w');
    try {
      const writer = new Beast2Writer(TableType, (bytes) => {
        for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      });
      for (let first = 0; first < ROWS; first += BATCH) {
        writer.write(Array.from({ length: Math.min(BATCH, ROWS - first) }, (_, j) => row(first + j)));
      }
      writer.finish();
    } finally {
      closeSync(fd);
    }

    const zip = join(dir, 'scale.zip');
    await e3.export(e3.package('scale', '1.0.0', rekeyed), zip);
    for (const args of [
      ['repo', 'create', repo],
      ['package', 'import', repo, zip],
      ['workspace', 'create', repo, 'ws'],
      ['workspace', 'deploy', repo, 'ws', 'scale@1.0.0'],
      ['dataset', 'set', repo, 'ws.table', '--from-file', tablePath],
    ]) {
      const result = await runE3Command(args, dir);
      assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
    }
  });

  after(() => {
    if (dir !== undefined) removeTestDir(dir);
  });

  it('assembles a re-keyed output larger than 3 GiB under a 256 MiB orchestrator heap', async () => {
    const run = await runE3Command(['dataflow', 'run', repo, 'ws'], dir, { env: { NODE_OPTIONS: '--max-old-space-size=256' } });
    assert.equal(run.exitCode, 0, `${run.stderr}\n${run.stdout}`);
    assert.match(run.stdout, /\[MERGE\] rekeyed/, 'the partials were merged by merge units');

    const output = await DatasetSegments.open(storage, repo, await outputHash());
    assert.ok(output.bytes >= 3 * GIB, `the output is ${output.bytes} bytes`);
    assert.equal(output.elementCount, ROWS, 'every row is in the output, under its own key');
  });

  it('collects the repository under a 128 MiB heap', async () => {
    const gc = await runE3Command(['repo', 'gc', repo, '--min-age', '0'], dir, { env: { NODE_OPTIONS: '--max-old-space-size=128' } });
    assert.equal(gc.exitCode, 0, `${gc.stderr}\n${gc.stdout}`);
    assert.ok(await storage.objects.exists(repo, await outputHash()), 'the output is kept');
  });
});
