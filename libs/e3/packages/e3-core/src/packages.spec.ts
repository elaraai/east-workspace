/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for packages.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yazl from 'yazl';
import { StringType, IntegerType, DictType, StructType, East, decodeBeast2For, encodeBeast2For, none, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { DataflowRunType, ExecutionStatusType } from '@elaraai/e3-types';
import {
  packageImport,
  packageExport,
  packageRemove,
  packageList,
  packageResolve,
  packageRead,
} from './packages.js';
import { objectRead } from './storage/local/LocalObjectStore.js';
import { PackageInvalidError, PackageNotFoundError } from './errors.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir, readZipEntries, zipEqual } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';

describe('packages', () => {
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

  describe('packageImport', () => {
    it('imports empty package', async () => {
      // Create and export a package using e3 SDK
      const pkg = e3.package('empty-pkg', '1.0.0') as any;
      const zipPath = join(tempDir, 'empty.zip');
      await e3.export(pkg, zipPath);

      // Import into repository
      const result = await packageImport(storage, testRepo, zipPath);

      assert.strictEqual(result.name, 'empty-pkg');
      assert.strictEqual(result.version, '1.0.0');
      assert.strictEqual(typeof result.packageHash, 'string');
      assert.strictEqual(result.packageHash.length, 64);
      assert.ok(result.objectCount >= 1, `Expected at least 1 object, got ${result.objectCount}`);
    });

    it('imports package with input dataset', async () => {
      const myInput = e3.input('greeting', StringType, variant('value', 'hello'));
      const pkg = e3.package('input-pkg', '2.0.0', myInput);
      const zipPath = join(tempDir, 'input.zip');
      await e3.export(pkg, zipPath);

      const result = await packageImport(storage, testRepo, zipPath);

      assert.strictEqual(result.name, 'input-pkg');
      assert.strictEqual(result.version, '2.0.0');
      assert.ok(result.objectCount >= 2, `Expected at least 2 objects, got ${result.objectCount}`);
    });

    it('creates the package ref, a beast2 String of the package object\'s hash', async () => {
      const pkg = e3.package('ref-test', '1.2.3') as any;
      const zipPath = join(tempDir, 'ref-test.zip');
      await e3.export(pkg, zipPath);

      const result = await packageImport(storage, testRepo, zipPath);

      const refPath = join(testRepo, 'packages', 'ref-test', '1.2.3.beast2');
      assert.ok(existsSync(refPath), 'Package ref file should exist');
      assert.strictEqual(decodeBeast2For(StringType)(readFileSync(refPath)), result.packageHash);
    });

    it('stores objects in correct location', async () => {
      const pkg = e3.package('objects-test', '1.0.0') as any;
      const zipPath = join(tempDir, 'objects-test.zip');
      await e3.export(pkg, zipPath);

      const result = await packageImport(storage, testRepo, zipPath);

      // Package object should be loadable
      const packageObjectData = await objectRead(testRepo, result.packageHash);
      assert.ok(packageObjectData.length > 0, 'Package object should have content');
    });

    it('handles re-import of same package', async () => {
      const pkg = e3.package('reimport-test', '1.0.0') as any;
      const zipPath = join(tempDir, 'reimport-test.zip');
      await e3.export(pkg, zipPath);

      const result1 = await packageImport(storage, testRepo, zipPath);
      const result2 = await packageImport(storage, testRepo, zipPath);

      assert.strictEqual(result1.packageHash, result2.packageHash);
      assert.strictEqual(result1.name, result2.name);
      assert.strictEqual(result1.version, result2.version);
    });

    it('refuses an execution or a run a zip names by a hash or an id not of the form e3 writes', async () => {
      // Each becomes a path: an execution's by its entries' names, and a run's
      // by the id its record holds.
      const zipPath = join(tempDir, 'named.zip');
      await e3.export(e3.package('named', '1.0.0') as any, zipPath);
      const entries = await readZipEntries(zipPath);
      const executionId = '0190a0b0-5555-7000-8000-000000000000';
      const status = encodeBeast2For(ExecutionStatusType)(variant('cancelled', {
        executionId, inputHashes: [], startedAt: new Date(0), completedAt: new Date(0),
      }));
      const run = encodeBeast2For(DataflowRunType)({
        runId: 'not-a-run-id', workspaceName: 'main', packageRef: 'named@1.0.0', startedAt: new Date(0), completedAt: none,
        status: variant('running', {}), inputVersions: new Map(), outputVersions: none, taskExecutions: new Map(),
        summary: { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      });
      for (const [entry, data, refusal] of [
        [`executions/${'A'.repeat(64)}/${'b'.repeat(64)}/${executionId}/status.beast2`, status, /is not a task hash/],
        ['dataflows/main/not-a-run-id.beast2', run, /is not a run id/],
      ] as const) {
        const crafted = join(tempDir, 'crafted.zip');
        const zip = new yazl.ZipFile();
        for (const [name, bytes] of entries) zip.addBuffer(bytes, name);
        zip.addBuffer(Buffer.from(data), entry);
        await new Promise<void>((resolve, reject) => {
          zip.outputStream.pipe(createWriteStream(crafted)).on('close', resolve).on('error', reject);
          zip.end();
        });
        await assert.rejects(packageImport(storage, testRepo, crafted), refusal);
      }
    });

    it('refuses a zip an older e3 exported, whose package ref is text, naming the export', async () => {
      const zipPath = join(tempDir, 'current.zip');
      await e3.export(e3.package('older', '1.0.0') as any, zipPath);
      const older = join(tempDir, 'older.zip');
      const zip = new yazl.ZipFile();
      for (const [name, bytes] of await readZipEntries(zipPath)) {
        if (name === 'packages/older/1.0.0.beast2') zip.addBuffer(Buffer.from(`${decodeBeast2For(StringType)(bytes)}\n`), 'packages/older/1.0.0');
        else zip.addBuffer(bytes, name);
      }
      await new Promise<void>((resolve, reject) => {
        zip.outputStream.pipe(createWriteStream(older)).on('close', resolve).on('error', reject);
        zip.end();
      });
      await assert.rejects(packageImport(storage, testRepo, older), (err: unknown) =>
        err instanceof PackageInvalidError && err.message === 'Invalid package: an older e3 exported it — export it again with the current one');
      assert.deepStrictEqual(await packageList(storage, testRepo), []);
    });
  });

  describe('packageList', () => {
    it('returns empty array for no packages', async () => {
      const packages = await packageList(storage, testRepo);

      assert.deepStrictEqual(packages, []);
    });

    it('lists single package', async () => {
      const pkg = e3.package('list-test', '1.0.0') as any;
      const zipPath = join(tempDir, 'list-test.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      const packages = await packageList(storage, testRepo);

      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0].name, 'list-test');
      assert.strictEqual(packages[0].version, '1.0.0');
    });

    it('lists multiple packages', async () => {
      // Create and import multiple packages
      const pkg1 = e3.package('pkg-a', '1.0.0') as any;
      const pkg2 = e3.package('pkg-b', '2.0.0') as any;
      const pkg3 = e3.package('pkg-a', '1.1.0') as any;

      const zip1 = join(tempDir, 'pkg1.zip');
      const zip2 = join(tempDir, 'pkg2.zip');
      const zip3 = join(tempDir, 'pkg3.zip');

      await e3.export(pkg1, zip1);
      await e3.export(pkg2, zip2);
      await e3.export(pkg3, zip3);

      await packageImport(storage, testRepo, zip1);
      await packageImport(storage, testRepo, zip2);
      await packageImport(storage, testRepo, zip3);

      const packages = await packageList(storage, testRepo);

      assert.strictEqual(packages.length, 3);

      // Sort for consistent comparison
      packages.sort((a, b) => `${a.name}/${a.version}`.localeCompare(`${b.name}/${b.version}`));

      assert.strictEqual(packages[0].name, 'pkg-a');
      assert.strictEqual(packages[0].version, '1.0.0');
      assert.strictEqual(packages[1].name, 'pkg-a');
      assert.strictEqual(packages[1].version, '1.1.0');
      assert.strictEqual(packages[2].name, 'pkg-b');
      assert.strictEqual(packages[2].version, '2.0.0');
    });
  });

  describe('packageResolve', () => {
    it('resolves package to hash', async () => {
      const pkg = e3.package('resolve-test', '1.0.0') as any;
      const zipPath = join(tempDir, 'resolve-test.zip');
      await e3.export(pkg, zipPath);

      const importResult = await packageImport(storage, testRepo, zipPath);
      const resolvedHash = await packageResolve(storage, testRepo, 'resolve-test', '1.0.0');

      assert.strictEqual(resolvedHash, importResult.packageHash);
    });

    it('throws for non-existent package', async () => {
      await assert.rejects(
        async () => await packageResolve(storage, testRepo, 'nonexistent', '1.0.0'),
        PackageNotFoundError
      );
    });
  });

  describe('packageRemove', () => {
    it('removes package ref', async () => {
      const pkg = e3.package('remove-test', '1.0.0') as any;
      const zipPath = join(tempDir, 'remove-test.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      // Verify package exists
      let packages = await packageList(storage, testRepo);
      assert.strictEqual(packages.length, 1);

      // Remove package
      await packageRemove(storage, testRepo, 'remove-test', '1.0.0');

      // Verify package is gone
      packages = await packageList(storage, testRepo);
      assert.strictEqual(packages.length, 0);
    });

    it('throws for non-existent package', async () => {
      await assert.rejects(
        async () => await packageRemove(storage, testRepo, 'nonexistent', '1.0.0'),
        PackageNotFoundError
      );
    });

    it('removes only specified version', async () => {
      const pkg1 = e3.package('multi-ver', '1.0.0') as any;
      const pkg2 = e3.package('multi-ver', '2.0.0') as any;

      const zip1 = join(tempDir, 'multi-ver-1.zip');
      const zip2 = join(tempDir, 'multi-ver-2.zip');

      await e3.export(pkg1, zip1);
      await e3.export(pkg2, zip2);

      await packageImport(storage, testRepo, zip1);
      await packageImport(storage, testRepo, zip2);

      // Remove only v1
      await packageRemove(storage, testRepo, 'multi-ver', '1.0.0');

      const packages = await packageList(storage, testRepo);
      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0].version, '2.0.0');
    });
  });

  describe('packageExport', () => {
    it('exports empty package', async () => {
      const pkg = e3.package('export-test', '1.0.0') as any;
      const importZip = join(tempDir, 'import.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);

      const exportZip = join(tempDir, 'export.zip');
      const result = await packageExport(storage, testRepo, 'export-test', '1.0.0', exportZip);

      assert.ok(existsSync(exportZip), 'Export zip should exist');
      assert.strictEqual(result.packageHash.length, 64);
      assert.ok(result.objectCount >= 1, `Expected at least 1 object, got ${result.objectCount}`);
    });

    it('exports package with input dataset', async () => {
      const myInput = e3.input('greeting', StringType, variant('value', 'hello'));
      const pkg = e3.package('export-input', '1.0.0', myInput);
      const importZip = join(tempDir, 'import-input.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);

      const exportZip = join(tempDir, 'export-input.zip');
      const result = await packageExport(storage, testRepo, 'export-input', '1.0.0', exportZip);

      assert.ok(result.objectCount >= 2, `Expected at least 2 objects, got ${result.objectCount}`);
      // Beside the objects, only the package ref, as the repository keeps it
      const entries = await readZipEntries(exportZip);
      assert.deepStrictEqual([...entries.keys()].filter((name) => !name.startsWith('objects/')), ['packages/export-input/1.0.0.beast2']);
      assert.strictEqual(decodeBeast2For(StringType)(entries.get('packages/export-input/1.0.0.beast2')!), result.packageHash);
    });

    it('produces zip with same content as original', async () => {
      const myInput = e3.input('name', StringType, variant('value', 'world'));
      const pkg = e3.package('roundtrip', '1.0.0', myInput);
      const originalZip = join(tempDir, 'original.zip');
      await e3.export(pkg, originalZip);
      await packageImport(storage, testRepo, originalZip);

      const exportedZip = join(tempDir, 'exported.zip');
      await packageExport(storage, testRepo, 'roundtrip', '1.0.0', exportedZip);

      // Compare zip contents (not raw bytes, as order may differ)
      const result = await zipEqual(originalZip, exportedZip);
      assert.ok(result.equal, `Zips should have equal content: ${result.diff}`);
    });

    it('carries a record\'s migration chain: each step, its function and a split step\'s program', async () => {
      const RowType = StructType({ title: StringType });
      const PlansType = DictType(StringType, RowType);
      const plans = e3.record('plans', PlansType, new Map());
      const repair = e3.migration.value('repair', plans, East.function([PlansType], PlansType, ($, old) => old));
      const retitle = e3.migration.rows('retitle', plans,
        East.function([StringType, RowType], RowType, ($, _id, row) => ({ title: row.title })), { after: repair });
      const originalZip = join(tempDir, 'migrations-original.zip');
      await e3.export(e3.package('migrations', '1.0.0', retitle), originalZip);
      await packageImport(storage, testRepo, originalZip);

      const exportedZip = join(tempDir, 'migrations-exported.zip');
      await packageExport(storage, testRepo, 'migrations', '1.0.0', exportedZip);

      // Every object the SDK wrote travels: a step left behind could not run
      // in the repository the export is imported into.
      const result = await zipEqual(originalZip, exportedZip);
      assert.ok(result.equal, `Zips should have equal content: ${result.diff}`);
    });

    it('exported zip can be re-imported', async () => {
      const pkg = e3.package('reimport', '1.0.0') as any;
      const importZip = join(tempDir, 'reimport-import.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);

      const exportZip = join(tempDir, 'reimport-export.zip');
      await packageExport(storage, testRepo, 'reimport', '1.0.0', exportZip);

      // Create a second repo and import the exported zip
      const testRepo2 = createTestRepo();
      const storage2 = new LocalStorage();
      try {
        const result = await packageImport(storage2, testRepo2, exportZip);

        assert.strictEqual(result.name, 'reimport');
        assert.strictEqual(result.version, '1.0.0');
      } finally {
        removeTestRepo(testRepo2);
      }
    });

    it('throws for non-existent package', async () => {
      const exportZip = join(tempDir, 'nonexistent.zip');

      await assert.rejects(
        async () => await packageExport(storage, testRepo, 'nonexistent', '1.0.0', exportZip),
        PackageNotFoundError
      );
    });
  });

  describe('packages with tasks', () => {
    it('imports and reads package with single East task', async () => {
      // Create package with a single task
      const input_x = e3.input('x', IntegerType, variant('value', 10n));
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('single-task', '1.0.0', task_double);
      const zipPath = join(tempDir, 'single-task.zip');
      await e3.export(pkg, zipPath);

      // Import and read
      const importResult = await packageImport(storage, testRepo, zipPath);
      assert.strictEqual(importResult.name, 'single-task');
      assert.strictEqual(importResult.version, '1.0.0');

      // Read the package object to verify tasks are present
      const pkgObject = await packageRead(storage, testRepo, 'single-task', '1.0.0');
      assert.strictEqual(pkgObject.tasks.size, 1);
      assert.ok(pkgObject.tasks.has('double'), 'Should have double task');
    });

    it('imports and reads package with two tasks (simpler than diamond)', async () => {
      // Simpler test: two independent tasks to isolate the issue
      const input_a = e3.input('a', IntegerType, variant('value', 10n));
      const input_b = e3.input('b', IntegerType, variant('value', 5n));

      const task_left = e3.task(
        'left',
        [input_a],
        East.function(
          [IntegerType],
          IntegerType,
          ($, a) => a.multiply(2n)
        )
      );

      const task_right = e3.task(
        'right',
        [input_b],
        East.function(
          [IntegerType],
          IntegerType,
          ($, b) => b.multiply(3n)
        )
      );

      const pkg = e3.package('two-task-test', '1.0.0', task_left, task_right);
      const zipPath = join(tempDir, 'two-task.zip');
      await e3.export(pkg, zipPath);

      // Import
      const importResult = await packageImport(storage, testRepo, zipPath);
      assert.strictEqual(importResult.name, 'two-task-test');
      assert.strictEqual(importResult.version, '1.0.0');

      // Read the package object
      const pkgObject = await packageRead(storage, testRepo, 'two-task-test', '1.0.0');

      // Should have both tasks
      assert.strictEqual(pkgObject.tasks.size, 2);
      assert.ok(pkgObject.tasks.has('left'), 'Should have left task');
      assert.ok(pkgObject.tasks.has('right'), 'Should have right task');
    });

    it('imports and reads package with diamond dependency (multiple tasks)', async () => {
      // Create diamond dependency pattern:
      // input_a, input_b -> task_left, task_right -> task_merge
      const input_a = e3.input('a', IntegerType, variant('value', 10n));
      const input_b = e3.input('b', IntegerType, variant('value', 5n));

      const task_left = e3.task(
        'left',
        [input_a, input_b],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, a, b) => a.add(b)
        )
      );

      const task_right = e3.task(
        'right',
        [input_a, input_b],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, a, b) => a.multiply(b)
        )
      );

      const task_merge = e3.task(
        'merge',
        [task_left.output, task_right.output],
        East.function(
          [IntegerType, IntegerType],
          IntegerType,
          ($, left, right) => left.add(right)
        )
      );

      const pkg = e3.package('diamond-test', '1.0.0', task_merge);
      const zipPath = join(tempDir, 'diamond.zip');
      await e3.export(pkg, zipPath);

      // Import
      const importResult = await packageImport(storage, testRepo, zipPath);
      assert.strictEqual(importResult.name, 'diamond-test');
      assert.strictEqual(importResult.version, '1.0.0');

      // Read the package object
      const pkgObject = await packageRead(storage, testRepo, 'diamond-test', '1.0.0');

      // Should have all 3 tasks
      assert.strictEqual(pkgObject.tasks.size, 3);
      assert.ok(pkgObject.tasks.has('left'), 'Should have left task');
      assert.ok(pkgObject.tasks.has('right'), 'Should have right task');
      assert.ok(pkgObject.tasks.has('merge'), 'Should have merge task');

      // Verify task hashes are present (tasks Map contains name -> hash)
      const mergeTaskHash = pkgObject.tasks.get('merge')!;
      assert.ok(typeof mergeTaskHash === 'string', 'Task hash should be a string');
      assert.strictEqual(mergeTaskHash.length, 64, 'Task hash should be 64 chars (SHA256)');
    });

    it('roundtrip export of package with tasks preserves content', async () => {
      const input_x = e3.input('x', IntegerType, variant('value', 10n));
      const task_double = e3.task(
        'double',
        [input_x],
        East.function(
          [IntegerType],
          IntegerType,
          ($, x) => x.multiply(2n)
        )
      );

      const pkg = e3.package('task-roundtrip', '1.0.0', task_double);
      const originalZip = join(tempDir, 'task-original.zip');
      await e3.export(pkg, originalZip);
      await packageImport(storage, testRepo, originalZip);

      // Export from repo
      const exportedZip = join(tempDir, 'task-exported.zip');
      await packageExport(storage, testRepo, 'task-roundtrip', '1.0.0', exportedZip);

      // Import into second repo
      const testRepo2 = createTestRepo();
      const storage2 = new LocalStorage();
      try {
        const result = await packageImport(storage2, testRepo2, exportedZip);
        assert.strictEqual(result.name, 'task-roundtrip');
        assert.strictEqual(result.version, '1.0.0');

        // Verify tasks are preserved
        const pkgObject = await packageRead(storage2, testRepo2, 'task-roundtrip', '1.0.0');
        assert.strictEqual(pkgObject.tasks.size, 1);
        assert.ok(pkgObject.tasks.has('double'));
      } finally {
        removeTestRepo(testRepo2);
      }
    });
  });
});
