/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * No door into the store holds a collection whole.
 *
 * Each door runs in a child process whose heap is capped far below the value
 * it stores, so a door that decoded the value whole dies of it. The child's
 * peak resident memory is compared at two sizes of input, one four times the
 * other: a door that held the input's bytes grows with them, and the foreign
 * inputs are uncompressed so that their bytes are as large as the value.
 *
 * Linux only: the peak is the kernel's high-water mark (VmHWM), the measure
 * the runners report.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Beast2ElementWriter, Beast2Writer, DictType, IntegerType, SortedMap, StringType, StructType,
  compareFor, toEastTypeValue, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { encodeDatasetBlob, mutationDeltaType, type DeltaTarget } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { storeDatasetFile } from './store-collection.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(StringType, RowType);
type Row = ValueTypeOf<typeof RowType>;

/** The child's heap cap: the larger input, decoded whole, needs several times
 *  it. */
const HEAP_CAP_MB = 96;

/** How much more the larger input may cost the child at its peak. */
const GROWTH_LIMIT_KIB = 12 * 1024;

/** A door, run on one input: the child prints its peak resident memory. */
const CHILD = `
import { readFileSync, createReadStream } from 'node:fs';
const [coreUrl, e3Url, door, repo, arg] = process.argv.slice(1);
const core = await import(coreUrl);
const { readDatasetFileType } = await import(e3Url);
const storage = new core.LocalStorage();
const input = JSON.parse(arg);
switch (door) {
  case 'task output':
    await core.storeDatasetFile(storage, repo, input.canonical, { canonical: true });
    break;
  case 'custom task output':
    await core.storeDatasetFile(storage, repo, input.foreign);
    break;
  case 'delivery':
    await core.objectAdoptFile(storage, repo, input.foreign);
    break;
  case 'upload':
    await core.storeCollection(storage, repo, readDatasetFileType(input.foreign), [{ chunks: createReadStream(input.foreign) }]);
    break;
  case 'stored blob':
    await core.storeCollection(storage, repo, readDatasetFileType(input.foreign), [{ stored: input.blob }]);
    break;
  case 'assembly':
    await core.storeCollection(storage, repo, readDatasetFileType(input.canonical), [
      { stored: input.manifest, to: input.half },
      { stored: input.manifest, from: input.half },
    ]);
    break;
  case 'value':
    await core.storeCollection(storage, repo, readDatasetFileType(input.canonical), [{ elements: (function* () {
      for (let i = 0; i < input.rows; i++) yield ['k' + String(i).padStart(9, '0'), { id: BigInt(i), name: 'row-' + i }];
    })() }]);
    break;
  case 'record commit':
    await core.applyDelta(storage, repo, new Map([['primary', input.manifest]]), input.delta);
    break;
  default:
    throw new Error('no door ' + door);
}
const peak = /VmHWM:\\s+(\\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'));
console.log(JSON.stringify({ peakKiB: Number(peak[1]) }));
`;

describe('the memory each door holds', { skip: process.platform === 'linux' ? false : 'the peak is read from /proc' }, () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;
  const inputs: Record<'small' | 'large', Record<string, unknown>> = { small: {}, large: {} };
  const coreUrl = new URL('./index.js', import.meta.url).href;
  const e3Url = import.meta.resolve('@elaraai/e3');

  before(async () => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    for (const [size, rows] of [['small', 250_000], ['large', 1_000_000]] as const) {
      // A stock runner's output: the Writer's own bytes.
      const canonical = join(dir, `${size}.canonical.beast2`);
      let fd = openSync(canonical, 'w');
      const writer = new Beast2ElementWriter(TableType, (bytes) => { writeSync(fd, bytes); });
      for (let i = 0; i < rows; i++) writer.add([`k${String(i).padStart(9, '0')}`, { id: BigInt(i), name: `row-${i}` }]);
      writer.finish();
      closeSync(fd);

      // Anything else: batched by its writer, uncompressed and unindexed.
      const foreign = join(dir, `${size}.foreign.beast2`);
      fd = openSync(foreign, 'w');
      const batches = new Beast2Writer(TableType, (bytes) => { writeSync(fd, bytes); }, { codec: 'none', index: false });
      for (let i = 0; i < rows; i += 1_000) {
        batches.write(new SortedMap(
          Array.from({ length: Math.min(1_000, rows - i) }, (_, j): [string, Row] => [`k${String(i + j).padStart(9, '0')}`, { id: BigInt(i + j), name: `row-${i + j}` }]),
          compareFor(StringType)));
      }
      batches.finish();
      closeSync(fd);

      const manifest = await storeDatasetFile(storage, repo, canonical, { canonical: true });
      const targets: DeltaTarget[] = [{ name: 'primary', keyType: StringType, collectionType: TableType }];
      const deltaType = mutationDeltaType(targets);
      const edited = rows >> 1;
      const delta = await storage.objects.write(repo, await encodeDatasetBlob(deltaType, new SortedMap<unknown, unknown>(
        [[variant('primary', `k${String(edited).padStart(9, '0')}`), variant('primary', variant('update', variant('patch', {
          id: variant('unchanged', null),
          name: variant('replace', { before: `row-${edited}`, after: 'RENAMED' }),
        })))]],
        compareFor(toEastTypeValue((deltaType as unknown as { key: EastType }).key)) as (a: unknown, b: unknown) => -1 | 0 | 1,
      ), (bytes) => storage.objects.write(repo, bytes)));

      inputs[size] = {
        rows,
        canonical,
        foreign,
        manifest,
        half: (await DatasetSegments.open(storage, repo, manifest)).segmentCount >> 1,
        blob: (await storage.objects.adoptFile(repo, foreign)).hash,
        delta,
      };
    }
  });

  after(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  /** The child's peak resident memory running `door` on the inputs of one size. */
  function peakKiB(door: string, size: 'small' | 'large'): number {
    const child = spawnSync(process.execPath, [
      `--max-old-space-size=${HEAP_CAP_MB}`,
      // In some runs V8 decides, from early survival counts, to pretenure an
      // object the door makes per element: it is allocated straight into old
      // space, and the collections that follow grow the heap by about 12 MiB
      // whatever the input's size. What the door holds is measured without
      // that decision.
      '--no-allocation-site-pretenuring',
      '--input-type=module', '-e', CHILD,
      coreUrl, e3Url, door, repo, JSON.stringify(inputs[size]),
    ], { encoding: 'utf8' });
    if (child.status !== 0) {
      throw new Error(`${door}, ${size}: the child ended ${child.status ?? child.signal}: ${child.stderr.slice(-2_000)}`);
    }
    return (JSON.parse(child.stdout.trim().split('\n').pop()!) as { peakKiB: number }).peakKiB;
  }

  for (const door of ['task output', 'custom task output', 'delivery', 'upload', 'stored blob', 'assembly', 'value', 'record commit']) {
    it(`holds as much at four times the input: ${door}`, (t) => {
      const small = peakKiB(door, 'small');
      const large = peakKiB(door, 'large');
      const peaks = `${door}: ${Math.round(small / 1024)} MiB at 250,000 rows, ${Math.round(large / 1024)} MiB at 1,000,000`;
      t.diagnostic(peaks);
      assert.ok(large - small < GROWTH_LIMIT_KIB, peaks);
    });
  }
});
