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
 * - a delivered file becomes a dataset without being read — its object is the
 *   delivery's own inode where the file system allows it, and the delivery is
 *   left exactly as it was found;
 * - deploy resolves a package's `file` sources, and a bad one fails the deploy
 *   with the previous deployment intact.
 *
 * Real filesystem throughout, per the e3 test convention: the inode and
 * mtime assertions have no meaning against a mock.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { chmodSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArrayType,
  DictType,
  IntegerType,
  StringType,
  StructType,
  encodeBeast2For,
  encodeBeast2PagedFor,
  variant,
} from '@elaraai/east';
import e3, { type DatasetSource } from '@elaraai/e3';
import { datasetAdoptFile, datasetAdoptObject, objectAdoptFile } from './dataset-adopt.js';
import { DatasetTypeMismatchError } from './errors.js';
import { packageImport } from './packages.js';
import { workspaceDeploy, workspaceGetState } from './workspaces.js';
import { workspaceGetDatasetStatus, workspaceSetDataset } from './trees.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { objectPath } from './storage/local/localHelpers.js';
import type { StorageBackend } from './storage/interfaces.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = ArrayType(RowType);
const rows = (n: number, offset = 0): { id: bigint; name: string }[] =>
  Array.from({ length: n }, (_, i) => ({ id: BigInt(i + offset), name: `row-${i + offset}` }));

describe('path-initialised inputs', () => {
  let testRepo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
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
    writeFileSync(path, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(n, offset)));
    return path;
  }

  describe('datasetAdoptFile', () => {
    it('points the dataset at the file, by hash, with the geometry its index carries', async () => {
      await deployTableWorkspace('adopt-basic');
      const file = writeDelivery('table.beast2', 40);

      const result = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file);

      assert.equal(result.size, statSync(file).size);
      assert.equal(result.rows, 40, 'the index knows the element count without a decode');
      assert.equal(result.segments, 5, '40 rows at batchSize 8');

      const status = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath], { geometry: true });
      assert.equal(status.refType, 'value');
      assert.equal(status.hash, result.hash);
      assert.equal(status.rows, 40);
      assert.equal(status.segments, 5);
    });

    it('shares the delivery\'s storage and never writes to it', async () => {
      await deployTableWorkspace('adopt-link');
      const file = writeDelivery('table.beast2', 24);
      // A distinctive mode and mtime: an adopt that touched the delivery
      // would move one of them.
      chmodSync(file, 0o640);
      utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
      const before = statSync(file);

      const { hash } = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file);

      const after = statSync(file);
      assert.equal(after.mode, before.mode, 'the delivery\'s mode is untouched');
      assert.equal(after.mtimeMs, before.mtimeMs, 'the delivery\'s mtime is untouched');
      assert.equal(after.size, before.size);

      // Same volume (both under the OS temp dir in this suite), so the object
      // is the delivery's own inode — a reflinking file system gives distinct
      // inodes with identical bytes instead, which is equally correct.
      const object = statSync(objectPath(testRepo, hash));
      const sameInode = object.ino === after.ino && object.dev === after.dev;
      assert.ok(
        sameInode || object.size === after.size,
        'the object is a link to the delivery, or a copy of exactly its bytes'
      );
    });

    it('is a no-op when the delivery is already in the store', async () => {
      await deployTableWorkspace('adopt-again');
      const file = writeDelivery('table.beast2', 16);

      const first = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file);
      const countAfterFirst = await storage.objects.count(testRepo);
      const second = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file);

      assert.equal(second.hash, first.hash, 'the file IS the value: same bytes, same hash');
      assert.equal(await storage.objects.count(testRepo), countAfterFirst, 'no second object');
    });

    it('lands on the hash the streaming writer would have produced', async () => {
      await deployTableWorkspace('adopt-hash');
      const file = writeDelivery('table.beast2', 30);
      const bytes = encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(30));

      const { hash } = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file);
      const written = await storage.objects.write(testRepo, bytes);

      assert.equal(hash, written, 'adopt and write are one content address');
      // The repository-level adopt deploy uses lands on the same object.
      assert.deepEqual(
        await objectAdoptFile(storage, testRepo, file),
        { hash: written, size: bytes.length },
        'objectAdoptFile agrees on the address and reports the size'
      );
    });

    it('re-pointing at a new delivery moves the hash', async () => {
      await deployTableWorkspace('adopt-repoint');
      const first = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], writeDelivery('v1.beast2', 20));
      const second = await datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], writeDelivery('v2.beast2', 21));

      assert.notEqual(second.hash, first.hash);
      const status = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);
      assert.equal(status.hash, second.hash);
    });

    it('refuses a delivery whose type has drifted, naming the dataset and the field', async () => {
      await deployTableWorkspace('adopt-drift');
      // The supplier added a field: assignable in neither direction under the
      // exact-equality rule a type-directed decode needs.
      const DriftedRow = StructType({ id: IntegerType, name: StringType, region: StringType });
      const file = join(tempDir, 'drifted.beast2');
      writeFileSync(file, encodeBeast2PagedFor(ArrayType(DriftedRow), { batchSize: 8 })(
        Array.from({ length: 8 }, (_, i) => ({ id: BigInt(i), name: `row-${i}`, region: 'R1' }))
      ));

      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file),
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

    it('refuses a collection delivery with no paging index', async () => {
      await deployTableWorkspace('adopt-flat');
      const file = join(tempDir, 'flat.beast2');
      // The whole-value encoder: a valid blob of the right type, but not
      // pageable and not carvable, so it cannot be a collection dataset.
      writeFileSync(file, encodeBeast2For(TableType)(rows(10)));

      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file),
        /not a readable indexed beast2 collection|carries no index/
      );
      assert.equal(await storage.objects.count(testRepo), before, 'a refused adopt writes nothing');
    });

    it('refuses a missing file, by name', async () => {
      await deployTableWorkspace('adopt-missing');
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], join(tempDir, 'nope.beast2')),
        /no file at .*nope\.beast2/
      );
    });

    it('refuses a digest the caller was not promised, before writing', async () => {
      await deployTableWorkspace('adopt-expect');
      const file = writeDelivery('table.beast2', 12);
      const before = await storage.objects.count(testRepo);
      await assert.rejects(
        () => datasetAdoptFile(storage, testRepo, 'ws', [...tablePath], file, { expectHash: 'f'.repeat(64) }),
        /hash mismatch: expected f{64}/
      );
      assert.equal(await storage.objects.count(testRepo), before, 'a refused commit writes nothing');
    });
  });

  describe('datasetAdoptObject (the transfer dedup door)', () => {
    it('accepts an object of the declared type and refuses one of another', async () => {
      await deployTableWorkspace('adopt-object');
      const good = await storage.objects.write(testRepo, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(12)));
      const OtherType = DictType(StringType, IntegerType);
      const bad = await storage.objects.write(testRepo, encodeBeast2PagedFor(OtherType, { batchSize: 8 })(
        new Map([['a', 1n], ['b', 2n]])
      ));

      const result = await datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], good);
      assert.equal(result.rows, 12);
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).hash, good);

      await assert.rejects(
        () => datasetAdoptObject(storage, testRepo, 'ws', [...tablePath], bad),
        (err: unknown) => err instanceof DatasetTypeMismatchError && /declares/.test(err.message)
      );
      // The refused dedup left the ref where it was.
      assert.equal((await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath])).hash, good);
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
      writeFileSync(file, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(24)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-src', file));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-src', '1.0.0');

      const first = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath], { geometry: true });
      assert.equal(first.refType, 'value', 'the path-initialised input is set, not unassigned');
      assert.equal(first.rows, 24);

      // A new delivery under the same path is a new hash — which is exactly
      // what makes change detection exact for its consumers.
      writeFileSync(file, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(30)));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-src', '1.0.0');
      const second = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath], { geometry: true });
      assert.notEqual(second.hash, first.hash);
      assert.equal(second.rows, 30);
    });

    it('fails the deploy with the previous deployment intact when a delivery has drifted', async () => {
      const good = join(tempDir, 'good.beast2');
      writeFileSync(good, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(16)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-ok', good));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-ok', '1.0.0');
      const before = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);

      // A second package whose delivery is simply gone by deploy time. The
      // export validated it; the machine deploying does not have it.
      const missing = join(tempDir, 'vanishes.beast2');
      writeFileSync(missing, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(16)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-gone', missing));
      writeFileSync(missing, new Uint8Array([1, 2, 3]));

      await assert.rejects(
        () => workspaceDeploy(storage, testRepo, 'ws', 'deploy-gone', '1.0.0'),
        /input 'table'/
      );
      const after = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);
      assert.equal(after.hash, before.hash, 'the workspace is exactly as the failed deploy found it');
    });

    it('adopts the deliveries before touching the workspace, so a failed adopt leaves the previous deployment intact', async () => {
      const first = join(tempDir, 'first.beast2');
      writeFileSync(first, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(16)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-first', first));
      await workspaceDeploy(storage, testRepo, 'ws', 'deploy-first', '1.0.0');
      const before = await workspaceGetDatasetStatus(storage, testRepo, 'ws', [...tablePath]);
      assert.equal(before.refType, 'value');

      // A second package whose delivery is readable and of the declared type,
      // deployed through a store whose adopt fails for an I/O reason.
      const second = join(tempDir, 'second.beast2');
      writeFileSync(second, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(24)));
      await packageImport(storage, testRepo, await exportWithFileSource('deploy-second', second));
      const objects = Object.create(storage.objects, {
        adoptFile: { value: async (): Promise<never> => { throw new Error('disk full'); } },
      }) as StorageBackend['objects'];
      const failing: StorageBackend = {
        objects,
        refs: storage.refs,
        locks: storage.locks,
        logs: storage.logs,
        repos: storage.repos,
        datasets: storage.datasets,
        validateRepository: (repo) => storage.validateRepository(repo),
      };

      await assert.rejects(
        () => workspaceDeploy(failing, testRepo, 'ws', 'deploy-second', '1.0.0'),
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

    it('leaves a file source unassigned, with a warning, when the caller cannot read it', async () => {
      // The API server's contract: a path in the package is the DEVELOPER's,
      // and the CLI completes those inputs over the transfer protocol.
      const missing = join(tempDir, 'developer-only.beast2');
      writeFileSync(missing, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(8)));
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
      writeFileSync(readable, encodeBeast2PagedFor(TableType, { batchSize: 8 })(rows(8)));
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
});
