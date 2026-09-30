/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Path-initialised inputs and the declared-type check at every door
 * (issues #765, #766).
 *
 * The properties under test are the ones the feature rests on, and each of
 * them used to be false:
 *
 * - a write whose wire type is not the dataset's declared type is refused
 *   BEFORE any object exists, naming the dataset and the first differing
 *   field;
 * - a delivered collection is stored as the value path stores its value, so a
 *   new delivery shares every segment the old one had but those around what
 *   changed — and the same bytes delivered again are not read twice;
 * - a delivery of any other value is the delivery's own inode where the file
 *   system allows it, and every delivery is left exactly as it was found;
 * - deploy resolves a package's `file` sources, and a bad one fails the deploy
 *   with the previous deployment intact.
 *
 * Real filesystem throughout, per the e3 test convention: the inode and
 * mtime assertions have no meaning against a mock.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { chmodSync, constants, copyFileSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArrayType,
  DictType,
  IntegerType,
  RUN_MAX_BYTES,
  StringType,
  StructType,
  encodeBeast2For,
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  some,
  spliceBeast2,
  toEastTypeValue,
  variant,
} from '@elaraai/east';
import e3, { DatasetFileTypeMismatchError, type DatasetSource } from '@elaraai/e3';
import type { LockProgress, LockStatus } from '@elaraai/e3-types';
import { datasetAdoptKnown, datasetAdoptObject, type DatasetAdoptProgress } from './dataset-adopt.js';
import { datasetAdoptFile, objectAdoptFile } from './dataset-adopt-file.js';
import { DatasetSegments } from './dataset-open.js';
import { rememberedManifest } from './delivery-intake.js';
import { DatasetTypeMismatchError, DeliveryRefusedError, ObjectNotFoundError, WorkspaceLockError } from './errors.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { MockTaskRunner } from './execution/MockTaskRunner.js';
import { computeHash } from './objects.js';
import { packageImport } from './package-files.js';
import { workspaceGetState, workspaceLockStatus, type DeploySourceProgress } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { datasetWrite, workspaceGetDatasetStatus, workspaceSetDataset, workspaceSetDatasetBytes } from './trees.js';
import { repoGc } from './gc.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir, encodeInSegmentsOf } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { objectPath } from './storage/local/localHelpers.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = ArrayType(RowType);
const rows = (n: number, offset = 0): { id: bigint; name: string }[] =>
  Array.from({ length: n }, (_, i) => ({ id: BigInt(i + offset), name: `row-${i + offset}` }));

/** Runs `fn` with the pieces a delivery is cut into sized about `bytes`. */
async function withPieceBytes<T>(bytes: number, fn: () => Promise<T>): Promise<T> {
  const was = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = String(bytes);
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.E3_TEST_PIECE_BYTES;
    else process.env.E3_TEST_PIECE_BYTES = was;
  }
}

/** Whether the file system under `dir` reflinks — the first way an adoption
 *  shares a delivery's storage. */
function reflinks(dir: string): boolean {
  const probe = join(dir, 'reflink-probe');
  writeFileSync(probe, 'probe');
  try {
    copyFileSync(probe, `${probe}.clone`, constants.COPYFILE_FICLONE_FORCE);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(`${probe}.clone`, { force: true });
    rmSync(probe);
  }
}

describe('path-initialised inputs', () => {
  let testRepo: string;
  let tempDir: string;
  let storage: StorageBackend;
  // Takes each collection in on east-c, or east-node where there is none.
  let runner: LocalTaskRunner;

  beforeEach(() => {
    testRepo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
    runner = new LocalTaskRunner(testRepo);
  });

  afterEach(() => {
    removeTestRepo(testRepo);
    removeTempDir(tempDir);
  });

  const tablePath = [variant('field', 'inputs'), variant('field', 'table')] as const;

  /** A package with one `table` input of {@link TableType}, exported to the
   *  temp dir — unassigned, or path-initialised by `source`. */
  async function exportTablePackage(name: string, source?: DatasetSource<typeof TableType>): Promise<string> {
    const pkg = e3.package(name, '1.0.0', e3.input('table', TableType, source));
    const zipPath = join(tempDir, `${name}.zip`);
    await e3.export(pkg, zipPath);
    return zipPath;
  }

  /** A deployed workspace with one unassigned `table` input. */
  async function deployTableWorkspace(name: string): Promise<void> {
    await packageImport(storage, testRepo, await exportTablePackage(name));
    await workspaceDeploy(storage, testRepo, 'ws', name, '1.0.0');
  }

  /** An indexed delivery of `n` rows on disk. */
  function writeDelivery(file: string, n: number, offset = 0): string {
    const path = join(tempDir, file);
    writeFileSync(path, encodeInSegmentsOf(TableType, 8)(rows(n, offset)));
    return path;
  }

  /** `storage`, with some of its stores swapped. */
  function withStores(stores: Partial<Pick<StorageBackend, 'objects' | 'refs'>>): StorageBackend {
    return {
      upgrades: storage.upgrades,
      objects: stores.objects ?? storage.objects,
      refs: stores.refs ?? storage.refs,
      locks: storage.locks,
      logs: storage.logs,
      repos: storage.repos,
      datasets: storage.datasets,
      validateRepository: (repo) => storage.validateRepository(repo),
    };
  }

  describe('datasetAdoptFile', () => {
    it('points the dataset at the manifest the delivery is stored as, with its geometry', async () => {
      await deployTableWorkspace('adopt-basic');
      const file = writeDelivery('table.beast2', 40);

      const result = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });

      assert.equal(result.size, statSync(file).size);
      assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(40), TableType),
        'the delivery is stored as the value path stores its value');
      assert.equal(result.rows, 40);
      assert.equal(result.segments, (await DatasetSegments.open(storage, testRepo, result.hash)).segmentCount);

      const status = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath], { geometry: true });
      assert.equal(status.refType, 'value');
      assert.equal(status.hash, result.hash);
      assert.equal(status.rows, 40);
      assert.equal(status.segments, result.segments);
    });

    it('never writes to the delivery', async () => {
      await deployTableWorkspace('adopt-untouched');
      const file = writeDelivery('table.beast2', 24);
      // A distinctive mode and mtime: an adopt that touched the delivery
      // would move one of them.
      chmodSync(file, 0o640);
      utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
      const before = statSync(file);

      await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });

      const after = statSync(file);
      assert.equal(after.mode, before.mode, 'the delivery\'s mode is untouched');
      assert.equal(after.mtimeMs, before.mtimeMs, 'the delivery\'s mtime is untouched');
      assert.equal(after.size, before.size);
    });

    it('does not split an unchanged delivery again', async () => {
      await deployTableWorkspace('adopt-again');
      const file = writeDelivery('table.beast2', 16);

      const first = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      const countAfterFirst = await storage.objects.count(testRepo);
      // A split writes every segment it cuts, stored already or not; the
      // store is a class instance, so an own property shadows its method.
      const objects = storage.objects;
      const write = objects.write.bind(objects);
      let writes = 0;
      objects.write = (repo: string, bytes: Uint8Array) => {
        writes++;
        return write(repo, bytes);
      };
      const second = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      objects.write = write;

      assert.equal(second.hash, first.hash, 'same bytes, same value, same hash');
      assert.equal(writes, 0, 'the delivery\'s hash names the manifest it became, and nothing is written');
      assert.equal(await storage.objects.count(testRepo), countAfterFirst, 'no second object');
    });

    it('splits a delivery again once the store has lost what it became', async () => {
      await deployTableWorkspace('adopt-stale');
      const file = writeDelivery('table.beast2', 16);
      const first = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });

      // What a gc does to a collection no ref names — the memo is not a root.
      const lost = (await DatasetSegments.open(storage, testRepo, first.hash)).manifest!.entries[0]!.hash;
      rmSync(objectPath(testRepo, lost));
      assert.equal(await rememberedManifest(storage, testRepo, computeHash(readFileSync(file))), null,
        'a memo naming a collection with a missing object is a miss');

      const second = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      assert.equal(second.hash, first.hash);
      assert.ok(await storage.objects.exists(testRepo, lost), 'the lost segment is written again');
    });

    it('lands on the hash the value path writes', async () => {
      await deployTableWorkspace('adopt-hash');
      const file = writeDelivery('table.beast2', 30);

      const { hash } = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      const written = await datasetWrite(storage, testRepo, rows(30), TableType);

      assert.equal(hash, written, 'adopt and write are one content address');
      // The repository-level adopt deploy uses lands on the same object.
      assert.deepEqual(
        await objectAdoptFile(storage, testRepo, file),
        { hash: written, size: statSync(file).size, taken: 'known' },
        'objectAdoptFile agrees on the address, reports the size, and knows the delivery by its hash'
      );
    });

    it('re-pointing at a new delivery moves the hash', async () => {
      await deployTableWorkspace('adopt-repoint');
      const first = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], writeDelivery('v1.beast2', 20), { runner });
      const second = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], writeDelivery('v2.beast2', 21), { runner });

      assert.notEqual(second.hash, first.hash);
      const status = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);
      assert.equal(status.hash, second.hash);
    });

    it('stores a new delivery that differs in one row as all but the segments around it', async () => {
      await deployTableWorkspace('adopt-redeliver');
      const first = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], writeDelivery('v1.beast2', 20_000), { runner });
      const changed = rows(20_000);
      changed[10_000] = { id: 10_000n, name: 'RENAMED' };
      const file = join(tempDir, 'v2.beast2');
      writeFileSync(file, encodeInSegmentsOf(TableType, 8)(changed));
      const second = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });

      const was = new Set((await DatasetSegments.open(storage, testRepo, first.hash)).manifest!.entries.map((entry) => entry.hash));
      const now = (await DatasetSegments.open(storage, testRepo, second.hash)).manifest!.entries.map((entry) => entry.hash);
      assert.ok(now.length > 4, `20,000 rows should span segments, not ${now.length}`);
      const fresh = now.filter((hash) => !was.has(hash)).length;
      assert.ok(fresh >= 1 && fresh <= 2, `a one-row change should store a segment or two, not ${fresh} of ${now.length}`);
    });

    it('refuses a delivery whose type has drifted, naming the dataset and the field', async () => {
      await deployTableWorkspace('adopt-drift');
      // The supplier added a field: assignable in neither direction under the
      // exact-equality rule a type-directed decode needs.
      const DriftedRow = StructType({ id: IntegerType, name: StringType, region: StringType });
      const file = join(tempDir, 'drifted.beast2');
      writeFileSync(file, encodeInSegmentsOf(ArrayType(DriftedRow), 8)(
        Array.from({ length: 8 }, (_, i) => ({ id: BigInt(i), name: `row-${i}`, region: 'R1' }))
      ));

      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner }),
        (err: unknown) => {
          assert.ok(err instanceof DatasetTypeMismatchError);
          assert.equal(err.workspace, 'ws');
          assert.equal(err.path, '.inputs.table');
          assert.match(err.message, /dataset '\.inputs\.table' declares/);
          assert.match(err.message, /first difference at/);
          assert.match(err.message, /region/, 'the first differing field is named');
          return true;
        }
      );
      assert.equal(await storage.objects.count(testRepo), before, 'nothing was written');
    });

    it('takes a delivery encoded whole in as the manifest of its value', async () => {
      await deployTableWorkspace('adopt-whole');
      const file = join(tempDir, 'whole.beast2');
      writeFileSync(file, encodeBeast2For(TableType)(rows(10)));

      const { hash } = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      assert.equal(hash, await datasetWrite(storage, testRepo, rows(10), TableType));
    });

    it('refuses a delivery holding a segment larger than a collection is read in, writing nothing', async () => {
      await deployTableWorkspace('adopt-oversized');
      // A whole-value encode is one frame; this one declares more logical
      // bytes than the limit, and none of them follow.
      const head = encodeBeast2For(TableType, { codec: 'none' })([]);
      const frameHeader = new Uint8Array(21);
      let at = 0;
      for (const n of [0, RUN_MAX_BYTES + 1, RUN_MAX_BYTES + 1]) {
        let v = n;
        for (; v >= 0x80; v = Math.floor(v / 128)) frameHeader[at++] = (v & 0x7f) | 0x80;
        frameHeader[at++] = v;
      }
      const file = join(tempDir, 'oversized.beast2');
      // Up to the one frame: its codec, lengths, TAG_NEW and terminator are the
      // last five bytes of an empty value's encode.
      writeFileSync(file, Buffer.concat([head.subarray(0, head.length - 5), frameHeader.subarray(0, at)]));

      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner }),
        (err: unknown) => {
          assert.ok(err instanceof DeliveryRefusedError, String(err));
          assert.ok(err.message.includes(file), 'the refusal names the delivery');
          assert.match(err.refusal, /^intake: segment 0 of the delivery, at offset \d+, holds 67108865 bytes, more than the 67108864 a segment is read in — write it again with a current Writer/);
          return true;
        }
      );
      assert.equal(await storage.objects.count(testRepo), before, 'a refused adopt writes nothing');
    });

    it('refuses a missing file, by name', async () => {
      await deployTableWorkspace('adopt-missing');
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], join(tempDir, 'nope.beast2'), { runner }),
        /no file at .*nope\.beast2/
      );
    });

    it('refuses a digest the caller was not promised, before writing', async () => {
      await deployTableWorkspace('adopt-expect');
      const file = writeDelivery('table.beast2', 12);
      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { expectHash: 'f'.repeat(64), runner }),
        /hash mismatch: expected f{64}/
      );
      assert.equal(await storage.objects.count(testRepo), before, 'a refused commit writes nothing');
    });
  });

  describe('objectAdoptFile', () => {
    it('takes any other value in as the delivery itself, sharing its storage', async () => {
      const bytes = encodeBeast2For(RowType)({ id: 7n, name: 'row-7' });
      const file = join(tempDir, 'row.beast2');
      writeFileSync(file, bytes);
      chmodSync(file, 0o640);
      utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
      const before = statSync(file);

      const result = await objectAdoptFile(storage, testRepo, file);

      assert.deepEqual(result, { hash: computeHash(bytes), size: bytes.length, taken: 'carried' }, 'the object is the file, by its hash');
      const after = statSync(file);
      assert.equal(after.mode, before.mode, 'the delivery\'s mode is untouched');
      assert.equal(after.mtimeMs, before.mtimeMs, 'the delivery\'s mtime is untouched');
      // Same volume (both under the OS temp dir in this suite): a file system
      // that reflinks gives the object an inode of its own sharing the
      // delivery's storage, and any other gives it the delivery's own inode.
      if (reflinks(tempDir)) {
        assert.deepEqual(readFileSync(objectPath(testRepo, result.hash)), Buffer.from(bytes), 'the object is a reflink of the delivery');
      } else {
        const object = statSync(objectPath(testRepo, result.hash), { bigint: true });
        const delivery = statSync(file, { bigint: true });
        assert.ok(object.dev === delivery.dev && object.ino === delivery.ino, 'the object is the delivery\'s own inode');
      }
    });

    // A supplier replaces a delivery by writing a new file and renaming it over
    // the old one. A rename landing after the adoption hashed the first file
    // would pair that file's hash with the second file's bytes.

    it('refuses a collection replaced after it was hashed, and remembers nothing of it', async () => {
      const file = writeDelivery('table.beast2', 16);
      const first = computeHash(readFileSync(file));
      // Replaced when the adoption asks the memo what the hashed bytes became.
      const refs = Object.create(storage.refs, {
        adoptionRead: {
          value: async (repo: string, sourceHash: string): Promise<string | null> => {
            writeFileSync(`${file}.next`, encodeInSegmentsOf(TableType, 8)(rows(16, 1000)));
            renameSync(`${file}.next`, file);
            return storage.refs.adoptionRead(repo, sourceHash);
          },
        },
      }) as StorageBackend['refs'];

      await assert.rejects(objectAdoptFile(withStores({ refs }), testRepo, file, { runner }), /changed while it was adopted/);
      assert.equal(await storage.refs.adoptionRead(testRepo, first), null,
        'the memo pairs the first bytes with nothing, rather than with the second');
    });

    it('never stores another value under the hash of the file it replaced', async () => {
      const file = join(tempDir, 'row.beast2');
      writeFileSync(file, encodeBeast2For(RowType)({ id: 7n, name: 'row-7' }));
      const first = computeHash(readFileSync(file));
      // Replaced as the store takes the file in.
      const objects = Object.create(storage.objects, {
        adoptFile: {
          value: async (repo: string, path: string, hash?: string): Promise<{ hash: string; size: number }> => {
            writeFileSync(`${file}.next`, encodeBeast2For(RowType)({ id: 8n, name: 'row-8' }));
            renameSync(`${file}.next`, file);
            return storage.objects.adoptFile(repo, path, hash);
          },
        },
      }) as StorageBackend['objects'];

      await assert.rejects(objectAdoptFile(withStores({ objects }), testRepo, file), /changed while it was adopted/);
      assert.equal(await storage.objects.exists(testRepo, first), false,
        'nothing is stored under the first file\'s hash, which a later adoption of it would reuse');
    });

    it('checks the declared type on the file it stores', async () => {
      const file = join(tempDir, 'row.beast2');
      writeFileSync(file, encodeBeast2For(RowType)({ id: 7n, name: 'row-7' }));
      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        objectAdoptFile(storage, testRepo, file, { declared: { subject: "input 'table'", type: toEastTypeValue(TableType) } }),
        (err: unknown) => err instanceof DatasetFileTypeMismatchError && /input 'table' declares/.test(err.message),
      );
      assert.equal(await storage.objects.count(testRepo), before, 'nothing was stored');
    });
  });

  describe('a delivered collection, taken in by the runners', () => {
    it("lands on the manifest writing it again gives, the Writer's or another writer's", async () => {
      await deployTableWorkspace('intake-writers');
      const file = join(tempDir, 'writer.beast2');
      writeFileSync(file, encodeBeast2PagedFor(TableType)(rows(20_000)));

      const result = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      assert.equal(result.taken, 'taken');
      assert.equal(result.runners?.length, 1, 'one runner took it in');
      assert.ok(['east-c', 'east-node'].includes(result.runners![0]!), `taken in by ${result.runners![0]}`);
      assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(20_000), TableType), 'the same manifest as the value path');
      assert.equal(result.rows, 20_000);

      const batched = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], writeDelivery('batched.beast2', 2_000), { runner });
      assert.equal(batched.hash, await datasetWrite(storage, testRepo, rows(2_000), TableType), 'a writer that batched its segments lands there too');
    });

    it('says how far it has got: its hash, then its pieces, to its size', async () => {
      await deployTableWorkspace('intake-progress');
      const file = join(tempDir, 'writer.beast2');
      writeFileSync(file, encodeBeast2PagedFor(TableType)(rows(20_000)));
      const size = statSync(file).size;
      const heard: DatasetAdoptProgress[] = [];

      await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner, onProgress: (progress) => heard.push(progress) });

      const phases = heard.map((progress) => progress.phase);
      assert.ok(phases.indexOf('take-in') > phases.lastIndexOf('hash'), 'the hash comes first, whole');
      assert.deepEqual(heard.filter((progress) => progress.phase === 'hash').at(-1), { phase: 'hash', bytes: size, total: size });
      assert.deepEqual(heard.filter((progress) => progress.phase === 'take-in'), [
        { phase: 'take-in', bytes: 0, total: size, pieces: { done: 0, total: 1 } },
        { phase: 'take-in', bytes: size, total: size, pieces: { done: 1, total: 1 } },
      ], 'a delivery smaller than a piece is one');
    });

    it('is cut into pieces of its segments, taken in side by side, which assemble to the same manifest', async () => {
      await deployTableWorkspace('intake-pieces');
      const file = writeDelivery('pieces.beast2', 20_000);
      const size = statSync(file).size;
      const heard: DatasetAdoptProgress[] = [];

      const result = await withPieceBytes(16 * 1024, () =>
        datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner, onProgress: (progress) => heard.push(progress) }));

      assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(20_000), TableType), 'the pieces meet as the value path cuts');
      const takeIn = heard.filter((progress) => progress.phase === 'take-in');
      const pieces = takeIn.at(-1)!.pieces!;
      assert.ok(pieces.total > 2, `20,000 rows in 16 KiB pieces should be several, not ${pieces.total}`);
      assert.deepEqual(takeIn.at(-1), { phase: 'take-in', bytes: size, total: size, pieces: { done: pieces.total, total: pieces.total } });
      assert.deepEqual(takeIn.map((progress) => progress.pieces!.done), Array.from({ length: pieces.total + 1 }, (_, i) => i), 'each piece is heard once');
    });

    it('takes up an intake that stopped part way from the pieces it finished', async () => {
      await deployTableWorkspace('intake-resume');
      const file = writeDelivery('resume.beast2', 20_000);
      await withPieceBytes(16 * 1024, async () => {
        // Every piece but the first finishes, and then the first fails.
        let pieces = 0;
        let finished = 0;
        let othersFinished!: () => void;
        const others = new Promise<void>((resolve) => { othersFinished = resolve; });
        const stopping = new MockTaskRunner();
        stopping.setIntakeResult(async (store, spec) => {
          if (spec.segments?.from === 0) {
            await others;
            throw new Error('the runner stopped');
          }
          const taken = await runner.intake(store, spec);
          if (++finished === pieces - 1) othersFinished();
          return taken;
        });
        await assert.rejects(
          datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, {
            runner: stopping,
            onProgress: (progress) => { if (progress.pieces !== undefined) pieces = progress.pieces.total; },
          }),
          /the runner stopped/,
        );
        assert.ok(pieces > 2, `several pieces, not ${pieces}`);
        assert.equal((await storage.refs.adoptionList(testRepo)).length, pieces - 1, 'the pieces that finished are remembered');

        const again = new MockTaskRunner();
        again.setIntakeResult((store, spec) => runner.intake(store, spec));
        const result = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner: again });
        assert.deepEqual(again.getIntakeCalls().map((spec) => spec.segments?.from), [0], 'only the piece that did not finish runs again');
        assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(20_000), TableType));
        assert.deepEqual(await storage.refs.adoptionList(testRepo), [{ sourceHash: computeHash(readFileSync(file)), manifestHash: result.hash }],
          'once the delivery is in, its own entry answers for it, and its pieces are forgotten');
      });
    });

    it('is forgotten by gc once its manifest is gone, and remembered while it is kept', async () => {
      await deployTableWorkspace('intake-memo-gc');
      const file = writeDelivery('kept.beast2', 40);
      const kept = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      const sourceHash = computeHash(readFileSync(file));
      // An entry whose manifest a sweep took: what an intake stopped part way
      // leaves once gc collects the pieces it stored.
      const gone = computeHash(new TextEncoder().encode('a delivery gc took'));
      await storage.refs.adoptionWrite(testRepo, gone, computeHash(new TextEncoder().encode('its manifest')));

      await repoGc(storage, testRepo, { minAge: 0, dryRun: true });
      assert.equal((await storage.refs.adoptionList(testRepo)).length, 2, 'a dry run forgets nothing');
      await repoGc(storage, testRepo, { minAge: 0 });
      assert.deepEqual(await storage.refs.adoptionList(testRepo), [{ sourceHash, manifestHash: kept.hash }]);
      assert.equal((await rememberedManifest(storage, testRepo, sourceHash))?.hash, kept.hash, 'the delivery whose manifest gc kept is still known');
    });

    it("refuses a Dict whose keys fall back, where two pieces meet as within one", async () => {
      const KeyedType = DictType(StringType, IntegerType);
      const file = join(tempDir, 'keyed.beast2');
      // Each segment ascends; the second starts before the first ends. No
      // Writer writes that, so two of its blobs are spliced.
      const segment = (entries: [string, bigint][]): Uint8Array => encodeBeast2SegmentsFor(KeyedType)([new Map(entries)]);
      writeFileSync(file, spliceBeast2([segment([['x', 1n], ['z', 2n]]), segment([['a', 3n], ['b', 4n]])]));
      const refused = (by: (runner: string) => boolean) => (err: unknown): boolean => {
        assert.ok(err instanceof DeliveryRefusedError, String(err));
        assert.ok(by(err.runner), `refused by ${err.runner}`);
        assert.match(err.refusal, /^intake: the delivery's Dict keys must ascend strictly in East order, and "a" follows "z"$/);
        return true;
      };
      const before = await storage.objects.count(testRepo);
      // Taken in whole, the runner refuses it; in a piece a segment, e3 does.
      await assert.rejects(objectAdoptFile(storage, testRepo, file, { runner }), refused((by) => by !== 'e3'));
      await withPieceBytes(4, () => assert.rejects(objectAdoptFile(storage, testRepo, file, { runner }), refused((by) => by === 'e3')));
      assert.equal(await storage.refs.adoptionRead(testRepo, computeHash(readFileSync(file))), null, 'a refused delivery is not remembered');
      assert.ok(await storage.objects.count(testRepo) >= before, 'what the pieces stored is named by nothing');
    });

    it('needs a runner to take a collection in, unless the store already knows it', async () => {
      const file = writeDelivery('table.beast2', 16);
      await assert.rejects(objectAdoptFile(storage, testRepo, file), /holds a collection, which intake units take in, and no runner was given to run them/);
      await objectAdoptFile(storage, testRepo, file, { runner });
      assert.equal((await objectAdoptFile(storage, testRepo, file)).taken, 'known', 'a delivery the store knows needs no runner');
    });

    it('refuses a delivery it cannot cut into pieces, above what the runner takes in whole, before any unit runs, naming the fix', async () => {
      // A delivery encoded whole has no index, so it is taken in by one unit.
      const file = join(tempDir, 'whole.beast2');
      writeFileSync(file, encodeBeast2For(TableType)(rows(2_000)));
      const size = statSync(file).size;
      const bounded = new MockTaskRunner();
      bounded.setIntakeResult((store, spec) => runner.intake(store, spec));
      bounded.wholeIntakeLimit = size - 1;

      await assert.rejects(objectAdoptFile(storage, testRepo, file, { runner: bounded }), (err: unknown) => {
        assert.ok(err instanceof DeliveryRefusedError, String(err));
        assert.equal(err.runner, 'e3');
        assert.equal(err.refusal,
          `intake: the delivery has no index that reads, so it is taken in whole, by one unit, and at ${size} bytes it is more than the ${size - 1} ` +
          'a unit of this runner takes in whole — write it again with a current Writer, which indexes it');
        assert.ok(err.message.includes(file), 'the refusal names the delivery');
        return true;
      });
      assert.deepEqual(bounded.getIntakeCalls(), [], 'no unit ran');

      // One no larger than the limit is taken in whole; one with an index is
      // cut into pieces, whatever its size.
      bounded.wholeIntakeLimit = size;
      assert.equal((await objectAdoptFile(storage, testRepo, file, { runner: bounded })).hash, await datasetWrite(storage, testRepo, rows(2_000), TableType));
      bounded.wholeIntakeLimit = 1;
      const indexed = writeDelivery('indexed.beast2', 2_000, 5_000);
      const taken = await withPieceBytes(1024, () => objectAdoptFile(storage, testRepo, indexed, { runner: bounded }));
      assert.equal(taken.hash, await datasetWrite(storage, testRepo, rows(2_000, 5_000), TableType));
      const pieces = bounded.getIntakeCalls().slice(1);
      assert.ok(pieces.length > 1 && pieces.every((spec) => spec.segments !== undefined), `in pieces, not ${pieces.length} whole`);
    });

    it('is taken in by the runners when the store holds it whole, through the dedup door', async () => {
      await deployTableWorkspace('intake-object');
      const whole = await storage.objects.write(testRepo, encodeBeast2PagedFor(TableType)(rows(5_000)));
      const result = await datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], whole, runner);
      assert.equal(result.taken, 'taken');
      assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(5_000), TableType));
    });
  });

  describe('datasetAdoptObject (the transfer dedup door)', () => {
    it('splits a collection object of the declared type, and refuses one of another', async () => {
      await deployTableWorkspace('adopt-object');
      const good = await storage.objects.write(testRepo, encodeInSegmentsOf(TableType, 8)(rows(12)));
      const OtherType = DictType(StringType, IntegerType);
      const bad = await storage.objects.write(testRepo, encodeInSegmentsOf(OtherType, 8)(
        new Map([['a', 1n], ['b', 2n]])
      ));

      const result = await datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], good, runner);
      assert.equal(result.rows, 12);
      assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(12), TableType), 'stored as its value is');
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).hash, result.hash);

      await assert.rejects(
        () => datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], bad, runner),
        (err: unknown) => err instanceof DatasetTypeMismatchError && /declares/.test(err.message)
      );
      // The refused dedup left the ref where it was.
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).hash, result.hash);
    });

    it('adopts a delivery the store split before by its hash alone, checking the type it became', async () => {
      await deployTableWorkspace('adopt-known');
      const bytes = encodeInSegmentsOf(TableType, 8)(rows(20));
      const file = join(tempDir, 'table.beast2');
      writeFileSync(file, bytes);
      const sourceHash = computeHash(bytes);
      assert.equal(await rememberedManifest(storage, testRepo, sourceHash), null);

      const adopted = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { runner });
      assert.equal(await storage.objects.exists(testRepo, sourceHash), false, 'the delivery is split, not stored as it came');
      assert.equal((await rememberedManifest(storage, testRepo, sourceHash))?.hash, adopted.hash);

      await workspaceSetDataset(storage, testRepo, 'ws', [...tablePath], rows(3), TableType);
      const result = await datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], sourceHash, runner);
      assert.equal(result.hash, adopted.hash);
      assert.equal(result.rows, 20);
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).hash, adopted.hash);

      // The same delivery offered to a dataset of another type.
      const other = e3.package('adopt-known-other', '1.0.0', e3.input('narrow', ArrayType(StructType({ id: IntegerType }))));
      const zipPath = join(tempDir, 'adopt-known-other.zip');
      await e3.export(other, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'ws2', 'adopt-known-other', '1.0.0');
      await assert.rejects(
        () => datasetAdoptObject(storage, testRepo, 'ws2', [variant('field', 'inputs'), variant('field', 'narrow')], sourceHash, runner),
        (err: unknown) => err instanceof DatasetTypeMismatchError && /declares/.test(err.message)
      );
    });

    it('takes a collection the store holds whole in, in pieces, saying how far it has got as each piece finishes', async () => {
      await deployTableWorkspace('adopt-object-progress');
      await withPieceBytes(16 * 1024, async () => {
        const bytes = encodeInSegmentsOf(TableType, 8)(rows(20_000));
        const whole = await storage.objects.write(testRepo, bytes);
        const heard: DatasetAdoptProgress[] = [];

        const result = await datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], whole, runner, { onProgress: (progress) => heard.push(progress) });

        assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(20_000), TableType));
        assert.ok(heard.every((progress) => progress.phase === 'take-in' && progress.total === bytes.length), 'an object is named by its hash: there is nothing to hash');
        const pieces = heard.at(-1)!.pieces!;
        assert.ok(pieces.total > 2, `20,000 rows in 16 KiB pieces should be several, not ${pieces.total}`);
        assert.deepEqual(heard.map((progress) => progress.pieces!.done), Array.from({ length: pieces.total + 1 }, (_, i) => i), 'each piece is heard as it finishes');
        assert.equal(heard.at(-1)!.bytes, bytes.length);
      });
    });

    it('stops at its signal with the pieces it finished remembered, so the next adopt takes in only the rest', async () => {
      await deployTableWorkspace('adopt-object-stopped');
      await withPieceBytes(16 * 1024, async () => {
        const whole = await storage.objects.write(testRepo, encodeInSegmentsOf(TableType, 8)(rows(20_000)));
        // Every piece but the first finishes, and then the adopt is stopped, as
        // a round of compute with a time limit stops at its deadline.
        let pieces = 0;
        let finished = 0;
        const round = new AbortController();
        const stopping = new MockTaskRunner();
        stopping.setIntakeResult(async (store, spec, options) => {
          if (spec.segments?.from === 0) {
            return new Promise<never>((_resolve, reject) => {
              const stop = (): void => reject(Object.assign(new Error('intake: aborted'), { name: 'AbortError' }));
              if (options?.signal?.aborted) stop();
              else options?.signal?.addEventListener('abort', stop, { once: true });
            });
          }
          const taken = await runner.intake(store, spec);
          if (++finished === pieces - 1) round.abort();
          return taken;
        });
        await assert.rejects(
          datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], whole, stopping, {
            signal: round.signal,
            onProgress: (progress) => { if (progress.pieces !== undefined) pieces = progress.pieces.total; },
          }),
          (err: unknown) => err instanceof Error && err.name === 'AbortError',
        );
        assert.ok(pieces > 2, `several pieces, not ${pieces}`);
        assert.equal((await storage.refs.adoptionList(testRepo)).length, pieces - 1, 'the pieces that finished are remembered');
        assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).refType, 'unassigned', 'a stopped adopt points nothing');

        const next = new MockTaskRunner();
        next.setIntakeResult((store, spec) => runner.intake(store, spec));
        const result = await datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], whole, next);
        assert.deepEqual(next.getIntakeCalls().map((spec) => spec.segments?.from), [0], 'only the piece that did not finish runs');
        assert.equal(result.hash, await datasetWrite(storage, testRepo, rows(20_000), TableType));
      });
    });
  });

  describe('datasetAdoptKnown (the transfer init\'s dedup)', () => {
    it('adopts at once what the memo names, and leaves a collection the store holds whole to a commit, taking nothing in', async () => {
      await deployTableWorkspace('adopt-known-init');
      const whole = await storage.objects.write(testRepo, encodeInSegmentsOf(TableType, 8)(rows(24)));

      assert.equal(await datasetAdoptKnown(storage, testRepo, 'ws', [...tablePath], whole), null, 'held whole, it is an intake: a commit\'s');
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).refType, 'unassigned', 'nothing was written');
      assert.equal(await datasetAdoptKnown(storage, testRepo, 'ws', [...tablePath], 'f'.repeat(64)), null, 'a delivery the store does not hold');

      // Once it is taken in, the memo names what it became.
      const taken = await datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], whole, runner);
      await workspaceSetDataset(storage, testRepo, 'ws', [...tablePath], rows(3), TableType);
      const known = await datasetAdoptKnown(storage, testRepo, 'ws', [...tablePath], whole);
      assert.deepEqual([known?.taken, known?.hash], ['known', taken.hash]);
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).hash, taken.hash);
    });

    it('adopts an object of another value as the value it is, and refuses one of another type', async () => {
      const pkg = e3.package('adopt-known-value', '1.0.0', e3.input('tally', IntegerType));
      const zipPath = join(tempDir, 'adopt-known-value.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'ws', 'adopt-known-value', '1.0.0');
      const tallyPath = [variant('field', 'inputs'), variant('field', 'tally')];

      const five = await storage.objects.write(testRepo, encodeBeast2For(IntegerType)(5n));
      const adopted = await datasetAdoptKnown(storage, testRepo, 'ws', tallyPath, five);
      assert.deepEqual([adopted?.taken, adopted?.hash], ['carried', five]);

      const text = await storage.objects.write(testRepo, encodeBeast2For(StringType)('five'));
      await assert.rejects(datasetAdoptKnown(storage, testRepo, 'ws', tallyPath, text), DatasetTypeMismatchError);
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', tallyPath)).hash, five);
    });

    it('looks once more at an object that reads as gone right after its touch found it, as a delete that raced the touch leaves it', async () => {
      const pkg = e3.package('adopt-known-raced', '1.0.0', e3.input('tally', IntegerType));
      const zipPath = join(tempDir, 'adopt-known-raced.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'ws', 'adopt-known-raced', '1.0.0');
      const tallyPath = [variant('field', 'inputs'), variant('field', 'tally')];
      const five = await storage.objects.write(testRepo, encodeBeast2For(IntegerType)(5n));

      // The first look after the touch falls in the moment a racing delete
      // has the object aside, before it puts it back
      let looks = 0;
      const objects = Object.create(storage.objects, {
        stat: {
          value: async (repo: string, hash: string): Promise<{ size: number }> => {
            if (hash === five && looks++ === 0) throw new ObjectNotFoundError(hash);
            return storage.objects.stat(repo, hash);
          },
        },
      }) as StorageBackend['objects'];

      const adopted = await datasetAdoptKnown(withStores({ objects }), testRepo, 'ws', tallyPath, five);
      assert.deepEqual([adopted?.taken, adopted?.hash], ['carried', five], 'adopted, not taken for a delivery the store does not hold');
      assert.equal(looks, 2, 'it looked once more');
    });
  });

  describe('workspaceSetDataset type check', () => {
    it('refuses a value encoded under another type, before any object is written', async () => {
      const pkg = e3.package('set-check', '1.0.0', e3.input('count', IntegerType, variant('value', 1n)));
      const zipPath = join(tempDir, 'set-check.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'ws', 'set-check', '1.0.0');

      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => workspaceSetDataset(storage, testRepo, 'ws', [
          variant('field', 'inputs'), variant('field', 'count'),
        ], 'not an integer', StringType),
        (err: unknown) => {
          assert.ok(err instanceof DatasetTypeMismatchError);
          assert.equal(err.path, '.inputs.count');
          assert.match(err.message, /dataset '\.inputs\.count' declares \.Integer but the value carries \.String/);
          return true;
        }
      );
      assert.equal(await storage.objects.count(testRepo), before, 'a refused set writes nothing');

      // The same dataset with the right type still goes through.
      await workspaceSetDataset(storage, testRepo, 'ws', [
        variant('field', 'inputs'), variant('field', 'count'),
      ], 7n, IntegerType);
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [
        variant('field', 'inputs'), variant('field', 'count'),
      ])).refType, 'value');
    });

    it('names struct field ORDER, which is significant on the wire and assignable either way', async () => {
      const Declared = StructType({ a: IntegerType, b: StringType });
      const Swapped = StructType({ b: StringType, a: IntegerType });
      const pkg = e3.package('set-order', '1.0.0', e3.input('row', Declared));
      const zipPath = join(tempDir, 'set-order.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'ws', 'set-order', '1.0.0');

      await assert.rejects(
        () => workspaceSetDataset(storage, testRepo, 'ws', [
          variant('field', 'inputs'), variant('field', 'row'),
        ], { a: 1n, b: 'x' }, Swapped),
        /field order differs \(expected a, b; found b, a\)/
      );
    });
  });

  describe('deploy resolves file sources', () => {
    /** A package whose `table` input is path-initialised at `file`. */
    const exportWithFileSource = (name: string, file: string): Promise<string> =>
      exportTablePackage(name, variant('file', file));

    it('adopts the delivery at deploy, and re-adopts a changed one on redeploy', async () => {
      const file = join(tempDir, 'delivery.beast2');
      writeFileSync(file, encodeInSegmentsOf(TableType, 8)(rows(24)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-src', file));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-src', '1.0.0', { runner });

      const first = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath], { geometry: true });
      assert.equal(first.refType, 'value', 'the path-initialised input is set, not unassigned');
      assert.equal(first.rows, 24);

      // A new delivery under the same path is a new hash — which is exactly
      // what makes change detection exact for its consumers.
      writeFileSync(file, encodeInSegmentsOf(TableType, 8)(rows(30)));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-src', '1.0.0', { runner });
      const second = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath], { geometry: true });
      assert.notEqual(second.hash, first.hash);
      assert.equal(second.rows, 30);
    });

    it('fails the deploy with the previous deployment intact when a delivery has drifted', async () => {
      const good = join(tempDir, 'good.beast2');
      writeFileSync(good, encodeInSegmentsOf(TableType, 8)(rows(16)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-ok', good));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-ok', '1.0.0', { runner });
      const before = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);

      // A second package whose delivery is simply gone by deploy time. The
      // export validated it; the machine deploying does not have it.
      const missing = join(tempDir, 'vanishes.beast2');
      writeFileSync(missing, encodeInSegmentsOf(TableType, 8)(rows(16)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-gone', missing));
      writeFileSync(missing, new Uint8Array([1, 2, 3]));

      await assert.rejects(
        () => workspaceDeploy(storage, testRepo, 'ws', 'deploy-gone', '1.0.0', { runner }),
        /input 'table'/
      );
      const after = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);
      assert.equal(after.hash, before.hash, 'the workspace is exactly as the failed deploy found it');
    });

    it('adopts the deliveries before touching the workspace, so a failed adopt leaves the previous deployment intact', async () => {
      const first = join(tempDir, 'first.beast2');
      writeFileSync(first, encodeInSegmentsOf(TableType, 8)(rows(16)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-first', first));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-first', '1.0.0', { runner });
      const before = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);
      assert.equal(before.refType, 'value');

      // A second package whose delivery is readable and of the declared type,
      // deployed through a store whose writes fail for an I/O reason — the
      // delivery's segments are the first thing a deploy writes.
      const second = join(tempDir, 'second.beast2');
      writeFileSync(second, encodeInSegmentsOf(TableType, 8)(rows(24)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-second', second));
      const objects = Object.create(storage.objects, {
        write: { value: async (): Promise<never> => { throw new Error('disk full'); } },
      }) as StorageBackend['objects'];
      const failing: StorageBackend = {
        upgrades: storage.upgrades,
        objects,
        refs: storage.refs,
        locks: storage.locks,
        logs: storage.logs,
        repos: storage.repos,
        datasets: storage.datasets,
        validateRepository: (repo) => storage.validateRepository(repo),
      };

      await assert.rejects(
        () => workspaceDeploy(failing, testRepo, 'ws', 'deploy-second', '1.0.0', { runner }),
        /disk full/
      );
      const after = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);
      assert.equal(after.hash, before.hash, 'the wipe never happened');
      assert.equal(
        (await workspaceGetState(storage, testRepo, 'ws'))?.packageName,
        'deploy-first',
        'the workspace still names the previous package'
      );
    });

    it('takes its file sources several at a time, saying how far each has got', async () => {
      const files = ['a', 'b', 'c'].map((name, i) => {
        const file = join(tempDir, `${name}.beast2`);
        writeFileSync(file, encodeBeast2PagedFor(TableType)(rows(3_000 + i)));
        return file;
      });
      const pkg = e3.package('deploy-many', '1.0.0', ...files.map((file, i) => e3.input(['a', 'b', 'c'][i]!, TableType, variant('file', file))));
      const zipPath = join(tempDir, 'deploy-many.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      const heard: DeploySourceProgress[] = [];
      const inFlight = new Set<string>();
      let peak = 0;
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-many', '1.0.0', {
        runner,
        sourceConcurrency: 3,
        onSourceProgress: (progress) => {
          heard.push(progress);
          if (progress.phase === 'done') inFlight.delete(progress.path);
          else inFlight.add(progress.path);
          peak = Math.max(peak, inFlight.size);
        },
      });

      const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
      assert.ok(heard.every((progress) => progress.sources.count === 3 && progress.sources.bytes === bytes), 'every report names all three sources');
      const done = heard.filter((progress) => progress.phase === 'done');
      assert.deepEqual(done.map((progress) => progress.path).sort(), ['inputs/a', 'inputs/b', 'inputs/c']);
      assert.ok(done.every((progress) => progress.taken === 'taken' && progress.runners?.length === 1), 'each taken in by a runner');
      assert.ok(peak >= 2, `the sources were taken in side by side, not one at a time (at most ${peak} at once)`);
      for (const [i, name] of ['a', 'b', 'c'].entries()) {
        const status = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [variant('field', 'inputs'), variant('field', name)], { geometry: true });
        assert.equal(status.rows, 3_000 + i, `inputs.${name} is its own delivery`);
      }
    });

    it('stops its other file sources at the first refusal, rather than waiting on their intakes', async () => {
      const files = ['bad', 'slow'].map((name, i) => {
        const file = join(tempDir, `${name}.beast2`);
        writeFileSync(file, encodeBeast2PagedFor(TableType)(rows(10 + i)));
        return file;
      });
      const pkg = e3.package('deploy-refused', '1.0.0', ...files.map((file, i) => e3.input(['bad', 'slow'][i]!, TableType, variant('file', file))));
      const zipPath = join(tempDir, 'deploy-refused.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      // One delivery is refused; the other's intake ends only when it is stopped.
      let stopped = false;
      const refusing = new MockTaskRunner();
      refusing.setIntakeResult((_store, spec, options) => {
        if ('file' in spec.source && spec.source.file === files[0]) {
          return Promise.reject(new DeliveryRefusedError('east-c', 'intake: segment 0 of the delivery is malformed: its frame runs past the end of the delivery', ''));
        }
        return new Promise<never>((_resolve, reject) => {
          const stop = (): void => {
            stopped = true;
            reject(Object.assign(new Error('intake: aborted'), { name: 'AbortError' }));
          };
          if (options?.signal?.aborted) stop();
          else options?.signal?.addEventListener('abort', stop, { once: true });
        });
      });

      await assert.rejects(
        workspaceDeploy(storage, testRepo, 'ws', 'deploy-refused', '1.0.0', { runner: refusing, sourceConcurrency: 2 }),
        (err: unknown) => err instanceof DeliveryRefusedError && err.message.includes(files[0]!),
      );
      assert.ok(stopped, 'the other intake was stopped, not waited on');
    });

    it('says how far it has taken its sources in through its lock, for whoever watches the workspace', async () => {
      const files = ['a', 'b'].map((name, i) => {
        const file = join(tempDir, `${name}.beast2`);
        writeFileSync(file, encodeBeast2PagedFor(TableType)(rows(20_000 + i)));
        return file;
      });
      const pkg = e3.package('deploy-watched', '1.0.0', ...files.map((file, i) => e3.input(['a', 'b'][i]!, TableType, variant('file', file))));
      const zipPath = join(tempDir, 'deploy-watched.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      const bytes = BigInt(files.reduce((sum, file) => sum + statSync(file).size, 0));

      // The deploy's own lock, read by a watcher each time a report lands.
      const held = await storage.locks.acquire(testRepo, 'ws', variant('deployment', null));
      assert.ok(held);
      const reports: LockProgress[] = [];
      const watched: Array<LockStatus | null> = [];
      const lock: LockHandle = {
        resource: held.resource,
        release: () => held.release(),
        report: async (progress) => {
          reports.push(progress);
          await held.report(progress);
          watched.push(await workspaceLockStatus(storage, testRepo, 'ws'));
        },
      };
      try {
        await workspaceDeploy(storage, testRepo, 'ws', 'deploy-watched', '1.0.0', { lock, sourceConcurrency: 2, runner });
      } finally {
        await held.release();
      }

      const sizes = files.map((file) => BigInt(statSync(file).size));
      const first = reports[0]!.value;
      assert.deepEqual(first.package, { name: 'deploy-watched', version: '1.0.0' });
      assert.deepEqual(first.files, [
        { path: 'inputs/a', step: variant('waiting', null), bytes: 0n, total: sizes[0] },
        { path: 'inputs/b', step: variant('waiting', null), bytes: 0n, total: sizes[1] },
      ], 'the first report names every source, before any is started');
      // Taken in by one runner, whichever this machine has.
      const took = reports.at(-1)!.value.files[0]!.step;
      assert.ok(took.type === 'done' && took.value.type === 'taken' && took.value.value.length === 1, 'taken in by a runner');
      assert.deepEqual(reports.at(-1)!.value.files, [
        { path: 'inputs/a', step: took, bytes: sizes[0], total: sizes[0] },
        { path: 'inputs/b', step: took, bytes: sizes[1], total: sizes[1] },
      ], 'the last has them all in');
      assert.equal(sizes[0]! + sizes[1]!, bytes);
      assert.ok(reports.every((progress) => progress.value.startedAt.getTime() === first.startedAt.getTime()), 'the intake started once');
      const done = reports.map((progress) => progress.value.files.filter((file) => file.step.type === 'done').length);
      assert.ok(done.every((count, i) => i === 0 || count >= done[i - 1]!), 'the sources in only climb');
      assert.ok(watched.every((status) => status?.state.operation.type === 'deployment'), 'a watcher sees the deploy hold the workspace');
      assert.deepEqual(watched.map((status) => status?.progress), reports.map((progress) => some(progress)), 'and reads each report as it lands');
      assert.equal(await workspaceLockStatus(storage, testRepo, 'ws'), null, 'nothing holds the workspace once the deploy lets go');
    });

    it('is refused before it writes anything when it has a collection to take in and no runner', async () => {
      const file = join(tempDir, 'delivery.beast2');
      writeFileSync(file, encodeInSegmentsOf(TableType, 8)(rows(8)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-no-runner', file));
      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => workspaceDeploy(storage, testRepo, 'ws', 'deploy-no-runner', '1.0.0'),
        /^Error: input 'table': a collection delivery is taken in by intake units, and the deploy was given no runner to run them$/,
      );
      assert.equal(await storage.objects.count(testRepo), before, 'nothing was written');
    });

    it('leaves a file source unassigned, with a warning, when the caller cannot read it', async () => {
      // The API server's contract: a path in the package is the DEVELOPER's,
      // and the CLI completes those inputs over the transfer protocol.
      const missing = join(tempDir, 'developer-only.beast2');
      writeFileSync(missing, encodeInSegmentsOf(TableType, 8)(rows(8)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-warn', missing));
      writeFileSync(missing, new Uint8Array([9, 9, 9]));

      const warnings: string[] = [];
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-warn', '1.0.0', {
        sourceWarning: (message) => warnings.push(message),
      });

      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /input 'table' is left unassigned/);
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).refType, 'unassigned');
    });

    it('leaves a file source unassigned, with a warning, when resolution is off — even one this process could read', async () => {
      // The API server's contract: the path names a file on the machine that
      // exported the package, so a server never opens it. That this process
      // CAN read a good delivery at the path proves nothing about whose file
      // it is, and must change nothing.
      const readable = join(tempDir, 'readable.beast2');
      writeFileSync(readable, encodeInSegmentsOf(TableType, 8)(rows(8)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-remote', readable));
      const objectsBefore = await storage.objects.count(testRepo);

      const warnings: string[] = [];
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-remote', '1.0.0', {
        resolveFileSources: false,
        sourceWarning: (message) => warnings.push(message),
      });

      assert.equal(warnings.length, 1);
      assert.match(
        warnings[0]!,
        /^input 'table' is left unassigned: a file source \(.*readable\.beast2\) is resolved by the deploying client, not by this server$/
      );
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).refType, 'unassigned');
      assert.equal(await storage.objects.count(testRepo), objectsBefore, 'nothing was adopted');
    });
  });

  describe('a door write holds off a sweep', () => {
    // A door write stores a collection's segments before the ref that names
    // them, which for a large delivery is minutes. Until the ref is written no
    // root reaches them, so a sweep in between deletes objects the ref is
    // about to name. Each write here is stopped at its first object write.

    /** `storage`, with every object write held until `release` is called. */
    function held(): { storage: StorageBackend; writing: Promise<void>; release: () => void } {
      let entered!: () => void;
      const writing = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      const inner = storage;
      const objects = Object.create(inner.objects, {
        write: {
          value: async (repo: string, bytes: Uint8Array): Promise<string> => {
            entered();
            await released;
            return inner.objects.write(repo, bytes);
          },
        },
      }) as StorageBackend['objects'];
      return {
        storage: {
          upgrades: inner.upgrades,
          objects,
          refs: inner.refs,
          locks: inner.locks,
          logs: inner.logs,
          repos: inner.repos,
          datasets: inner.datasets,
          validateRepository: (repo) => inner.validateRepository(repo),
        },
        writing,
        release,
      };
    }

    /** Asserts a sweep is refused while `write` is stopped at its first object,
     *  and runs once it has finished — so it was the lock that refused it. */
    async function sweepWaitsFor(hold: ReturnType<typeof held>, write: Promise<unknown>): Promise<void> {
      await Promise.race([hold.writing, write]);
      try {
        await assert.rejects(repoGc(storage, testRepo, { minAge: 0 }), /a task is running/);
      } finally {
        hold.release();
      }
      await write;
      await repoGc(storage, testRepo, { minAge: 0 });
    }

    /** The table's rows, read back after the sweep. */
    async function tableRows(): Promise<number | null | undefined> {
      return (await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath], { geometry: true })).rows;
    }

    it('a set', async () => {
      await deployTableWorkspace('fence-set');
      const hold = held();
      await sweepWaitsFor(hold, workspaceSetDataset(hold.storage, testRepo, 'ws', [...tablePath], rows(40), TableType));
      assert.equal(await tableRows(), 40);
    });

    it('an upload', async () => {
      await deployTableWorkspace('fence-upload');
      const hold = held();
      await sweepWaitsFor(hold, workspaceSetDatasetBytes(hold.storage, testRepo, 'ws', [...tablePath],
        [encodeInSegmentsOf(TableType, 8)(rows(40))]));
      assert.equal(await tableRows(), 40);
    });

    it('an adopted delivery', async () => {
      await deployTableWorkspace('fence-adopt');
      const hold = held();
      await sweepWaitsFor(hold, datasetAdoptFile(hold.storage, testRepo, 'ws', [...tablePath], writeDelivery('table.beast2', 40), { runner }));
      assert.equal(await tableRows(), 40);
    });

    it("a deploy, from a delivery's first segment to its ref", async () => {
      await packageImport(storage, testRepo, await exportTablePackage('fence-deploy', variant('file', writeDelivery('table.beast2', 24))));
      const hold = held();
      await sweepWaitsFor(hold, workspaceDeploy(hold.storage, testRepo, 'ws', 'fence-deploy', '1.0.0', { runner }));
      assert.equal(await tableRows(), 24);
    });

    it('the transfer dedup door, which also takes the workspace lock', async () => {
      await deployTableWorkspace('fence-dedup');
      // A delivery the store holds whole, as a repository written before the
      // door holds it: the dedup door re-cuts it, for minutes when it is large,
      // and neither a deploy nor a removal may finish inside that.
      const whole = await storage.objects.write(testRepo, encodeInSegmentsOf(TableType, 8)(rows(12)));
      const deploying = await storage.locks.acquire(testRepo, 'ws', variant('deployment', null));
      assert.ok(deploying);
      try {
        await assert.rejects(datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], whole, runner), WorkspaceLockError);
      } finally {
        await deploying.release();
      }

      const hold = held();
      await sweepWaitsFor(hold, datasetAdoptObject(hold.storage, testRepo, 'ws', [...tablePath], whole, runner));
      assert.equal(await tableRows(), 12);
    });
  });
});
