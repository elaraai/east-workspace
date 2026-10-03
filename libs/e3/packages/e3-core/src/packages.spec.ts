/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for packages.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringType, IntegerType, DictType, StructType, East, decodeBeast2For, encodeBeast2For, equalFor, none, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { DataflowRunType, E3_RELEASE, ExecutionStatusType, type RecordIndexPlan, type RecordPlan } from '@elaraai/e3-types';
import {
  packageRemove,
  packageList,
  packageResolve,
  packageRead,
  packageZipOpenFrom,
} from './packages.js';
import { openZip, packageImport, packageZipOpen, packageExport } from './package-files.js';
import { workspaceDeploy } from './workspace-files.js';
import { repoGc } from './gc.js';
import { computeHash } from './objects.js';
import { computeHash as nodeComputeHash } from './objects-node.js';
import { objectRead } from './storage/local/LocalObjectStore.js';
import { PackageInvalidError, PackageNotFoundError } from './errors.js';
import { ExecutionStatusBeforeReasonsType } from './upgrades/execution-stop-reasons.js';
import {
  HeldLogStore, createTestRepo, removeTestRepo, createTempDir, removeTempDir, logsAtEachEnd, readZipEntries, withLogStore, withRelease,
  writeZip, zipBytes, zipEqual,
} from './test-helpers.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { ZipSource } from './zip.js';

/** Bytes read by ranges where they lie. */
function sourceOf(bytes: Uint8Array): ZipSource {
  return { size: bytes.byteLength, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

/** The compression method of each entry of a zip with no comment, as its
 *  directory names it, read from its bytes. */
function methodsOf(zip: Buffer): number[] {
  const end = zip.byteLength - 22;
  assert.strictEqual(zip.readUInt32LE(end), 0x06054b50, 'the zip ends with its end record');
  const methods: number[] = [];
  for (let at = zip.readUInt32LE(end + 16), i = 0; i < zip.readUInt16LE(end + 10); i++) {
    assert.strictEqual(zip.readUInt32LE(at), 0x02014b50, `the directory's entry ${i}`);
    methods.push(zip.readUInt16LE(at + 10));
    at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return methods;
}

/** The zips the 1.0.84 release exported, and what it made of them, as
 *  `test/generate-release-fixtures.mjs` wrote them with the released
 *  packages. */
const RELEASED = fileURLToPath(new URL('../../test/fixtures/release-1.0.84/', import.meta.url));

/** Every file under a directory, by its path, with a hash of its bytes. */
function filesUnder(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(path, computeHash(readFileSync(path)));
    }
  };
  walk(dir);
  return files;
}

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

    it('refuses an execution a zip names by a hash not of the form e3 writes', async () => {
      // An execution's entries' names become its path.
      const zipPath = join(tempDir, 'named.zip');
      await e3.export(e3.package('named', '1.0.0') as any, zipPath);
      const executionId = '0190a0b0-5555-7000-8000-000000000000';
      const status = encodeBeast2For(ExecutionStatusType)(variant('cancelled', {
        executionId, inputHashes: [], startedAt: new Date(0), completedAt: new Date(0), unit: false,
        reason: { kind: variant('aborted', null), message: 'cancelled' },
      }));
      const crafted = await writeZip(join(tempDir, 'crafted.zip'), [
        ...await readZipEntries(zipPath),
        [`executions/${'A'.repeat(64)}/${'b'.repeat(64)}/${executionId}/status.beast2`, Buffer.from(status)],
      ]);
      await assert.rejects(packageImport(storage, testRepo, crafted), { name: 'InvalidNameError', kind: 'task hash', value: 'A'.repeat(64) });
    });

    it('files no run a zip carries, however it is named: a run\'s history stays where it ran', async () => {
      // An older e3's workspace export carried its current run's record, which
      // an import filed under the exporting workspace's name — a workspace of
      // this repository's that is another, or none, which gc never prunes.
      const zipPath = join(tempDir, 'runs.zip');
      await e3.export(e3.package('runs', '1.0.0') as any, zipPath);
      const run = (runId: string) => encodeBeast2For(DataflowRunType)({
        runId, workspaceName: 'main', packageRef: 'runs@1.0.0', startedAt: new Date(0), completedAt: none,
        status: variant('running', {}), inputVersions: new Map(), outputVersions: none, taskExecutions: new Map(),
        summary: { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      });
      const runId = '0190a0b0-6666-7000-8000-000000000000';
      const crafted = await writeZip(join(tempDir, 'with-runs.zip'), [
        ...await readZipEntries(zipPath),
        [`dataflows/main/${runId}.beast2`, Buffer.from(run(runId))],
        ['dataflows/main/not-a-run-id.beast2', Buffer.from(run('not-a-run-id'))],
      ]);

      const result = await packageImport(storage, testRepo, crafted);
      assert.strictEqual(result.name, 'runs');
      assert.deepStrictEqual(await storage.refs.dataflowRunList(testRepo, 'main'), []);
      assert.ok(!existsSync(join(testRepo, 'dataflows', 'main')), 'nothing is filed under the workspace name');
    });

    it('files an execution a zip carries with its logs written whole and flushed before its status, so an import stopped between them is taken up whole', async () => {
      // A reader that finds the status reads the whole log. An import stopped
      // before the status left the logs, which the next writes again rather
      // than after what the first wrote.
      const zipPath = join(tempDir, 'ran.zip');
      await e3.export(e3.package('ran', '1.0.0'), zipPath);
      const [task, inputs, executionId] = ['c'.repeat(64), 'd'.repeat(64), '0190a0b0-7777-7000-8000-000000000000'];
      const status = variant('cancelled', {
        executionId, inputHashes: [], startedAt: new Date(0), completedAt: new Date(0), unit: false,
        reason: { kind: variant('aborted', null), message: 'cancelled' },
      });
      const at = `executions/${task}/${inputs}/${executionId}`;
      const crafted = await writeZip(join(tempDir, 'with-logs.zip'), [
        ...await readZipEntries(zipPath),
        [`${at}/status.beast2`, Buffer.from(encodeBeast2For(ExecutionStatusType)(status))],
        [`${at}/stdout.txt`, Buffer.from('one\ntwo\n')],
        [`${at}/stderr.txt`, Buffer.from('e3: cancelled\n')],
      ]);
      // The store fails the status's first write; its logs hold appends until
      // they are flushed, as a store that gathers appends into fewer writes does.
      const write = storage.refs.executionWrite.bind(storage.refs);
      let failing = true;
      storage.refs.executionWrite = (repo, taskHash, inputsHash, id, written) => {
        if (!failing) return write(repo, taskHash, inputsHash, id, written);
        failing = false;
        return Promise.reject(new Error('the store failed the write'));
      };
      const logs = new HeldLogStore(storage.logs);
      const ends = logsAtEachEnd(storage.refs, logs);
      const importing = withLogStore(storage, logs);

      await assert.rejects(packageImport(importing, testRepo, crafted), /the store failed the write/);
      assert.strictEqual(await storage.refs.executionGet(testRepo, task, inputs, executionId), null, 'the stopped import wrote no status');
      await packageImport(importing, testRepo, crafted);

      const whole = { stdout: 'one\ntwo\n', stderr: 'e3: cancelled\n' };
      assert.deepStrictEqual(ends.map(({ status: written, stdout, stderr }) => ({ status: written, stdout, stderr })),
        [{ status: 'cancelled', ...whole }, { status: 'cancelled', ...whole }], 'each write of the status found the whole log readable');
      for (const stream of ['stdout', 'stderr'] as const) {
        assert.strictEqual((await storage.logs.read(testRepo, task, inputs, executionId, stream)).data, whole[stream], `the ${stream} log is written once`);
      }
      assert.deepStrictEqual(await storage.refs.executionGet(testRepo, task, inputs, executionId), status);
    });

    it('carries the executions a zip an earlier release exported into the current form, a stopped one\'s reason unrecorded, as an upgrade carries a repository\'s', async () => {
      const zipPath = join(tempDir, 'earlier.zip');
      await e3.export(e3.package('earlier', '1.0.0'), zipPath);
      const [task, inputs] = ['c'.repeat(64), 'd'.repeat(64)];
      const own = { inputHashes: [], startedAt: new Date(0), completedAt: new Date(0), unit: false };
      const succeeded = variant('success', { ...own, executionId: '0190a0b0-9999-7000-8000-000000000001', outputHash: 'e'.repeat(64), peakBytes: none, plan: none });
      const cancelled = variant('cancelled', { ...own, executionId: '0190a0b0-9999-7000-8000-000000000002' });
      const interrupted = variant('interrupted', { ...own, executionId: '0190a0b0-9999-7000-8000-000000000003', pid: 7n });
      const encodeEarlier = encodeBeast2For(ExecutionStatusBeforeReasonsType);
      const earlier = await writeZip(join(tempDir, 'earlier-statuses.zip'), withRelease(new Map([
        ...await readZipEntries(zipPath),
        ...[succeeded, cancelled, interrupted].map((status): [string, Buffer] =>
          [`executions/${task}/${inputs}/${status.value.executionId}/status.beast2`, Buffer.from(encodeEarlier(status))]),
      ]), '1.0.84'));

      await packageImport(storage, testRepo, earlier);
      const equal = equalFor(ExecutionStatusType);
      const unrecorded = { kind: variant('unrecorded', null), message: '' };
      for (const status of [succeeded, variant('cancelled', { ...cancelled.value, reason: unrecorded }), variant('interrupted', { ...interrupted.value, reason: unrecorded })]) {
        const filed = await storage.refs.executionGet(testRepo, task, inputs, status.value.executionId);
        assert.ok(filed !== null && equal(filed, status), `the ${status.type} is filed in the current form`);
      }
    });

    it('refuses a zip an older e3 exported, whose package ref is text, naming the export', async () => {
      const zipPath = join(tempDir, 'current.zip');
      await e3.export(e3.package('older', '1.0.0') as any, zipPath);
      const older = await writeZip(join(tempDir, 'older.zip'), [...await readZipEntries(zipPath)].map(([name, bytes]): [string, Buffer] =>
        name === 'packages/older/1.0.0.beast2' ? ['packages/older/1.0.0', Buffer.from(`${decodeBeast2For(StringType)(bytes)}\n`)] : [name, bytes]));
      await assert.rejects(packageImport(storage, testRepo, older), (err: unknown) =>
        err instanceof PackageInvalidError && err.message === 'Invalid package: an older e3 exported it — export it again with the current one');
      assert.deepStrictEqual(await packageList(storage, testRepo), []);
    });

    it('refuses a zip a newer release exported, naming it, before anything of it is written', async () => {
      const zipPath = join(tempDir, 'current.zip');
      await e3.export(e3.package('newer', '1.0.0', e3.input('note', StringType, variant('value', 'kept'))), zipPath);
      // The release last, as a newer e3 might place it: the import reads the
      // zip's directory before it writes anything.
      const newer = await writeZip(join(tempDir, 'newer.zip'), withRelease(await readZipEntries(zipPath), '999.0.0'));

      await assert.rejects(packageImport(storage, testRepo, newer), (err: unknown) =>
        err instanceof PackageInvalidError &&
        err.message === `Invalid package: e3 999.0.0 exported it, and this e3 is ${E3_RELEASE} — import it with e3 999.0.0 or a newer one`);
      assert.deepStrictEqual(await packageList(storage, testRepo), []);
      assert.deepStrictEqual(await storage.objects.list(testRepo), [], 'no object is written');
    });

    it('reads a zip an older release exported, and one from before zips named their release', async () => {
      const zipPath = join(tempDir, 'current.zip');
      await e3.export(e3.package('older', '1.0.0'), zipPath);
      const entries = await readZipEntries(zipPath);
      assert.strictEqual(decodeBeast2For(StringType)(entries.get('release.beast2')!), E3_RELEASE, 'the SDK names its release');

      for (const release of ['0.0.1', null]) {
        const repo = createTestRepo();
        try {
          const result = await packageImport(storage, repo, await writeZip(join(tempDir, `older-${release}.zip`), withRelease(entries, release)));
          assert.strictEqual(result.name, 'older', `${release}`);
        } finally {
          removeTestRepo(repo);
        }
      }
    });

    it('refuses a zip whose release entry names no release', async () => {
      const zipPath = join(tempDir, 'current.zip');
      await e3.export(e3.package('unnamed', '1.0.0'), zipPath);
      const unnamed = await writeZip(join(tempDir, 'unnamed.zip'), withRelease(await readZipEntries(zipPath), 'latest'));
      await assert.rejects(packageImport(storage, testRepo, unnamed), (err: unknown) =>
        err instanceof PackageInvalidError && /^Invalid package: "latest" is not a release/.test(err.message));
    });

    it('imports a zip e3.export writes, its entries deflated, to the objects its entries name', async () => {
      const zipPath = join(tempDir, 'deflated.zip');
      await e3.export(e3.package('deflated', '1.0.0',
        e3.input('words', StringType, variant('value', 'the same few words, again and again; '.repeat(200))),
        e3.input('counts', DictType(StringType, IntegerType), variant('value', new Map([['a', 1n], ['b', 2n]])))), zipPath);
      const methods = methodsOf(readFileSync(zipPath));
      assert.ok(methods.length > 3 && methods.every((method) => method === 8), `the SDK deflates every entry: ${methods.join(', ')}`);

      const result = await packageImport(storage, testRepo, zipPath);
      const objects = [...await readZipEntries(zipPath)].filter(([name]) => name.startsWith('objects/'));
      assert.strictEqual(result.objectCount, objects.length);
      for (const [name, bytes] of objects) {
        const hash = name.slice('objects/'.length).replace('/', '').replace(/\.beast2$/, '');
        assert.strictEqual(computeHash(bytes), hash, `${name} inflates to the bytes its name hashes`);
        assert.ok(Buffer.from(await storage.objects.read(testRepo, hash)).equals(bytes), `${name} is in the store`);
      }
    });

    it('refuses an object its entry names by another\'s hash, and nothing names what it wrote, which gc sweeps', async () => {
      const zipPath = join(tempDir, 'named.zip');
      await e3.export(e3.package('misnamed', '1.0.0', e3.input('memo', StringType, variant('value', 'kept'))), zipPath);
      const entries = await readZipEntries(zipPath);
      const packageHash = decodeBeast2For(StringType)(entries.get('packages/misnamed/1.0.0.beast2')!);
      // The package object's entry holds other bytes, under a CRC-32 of their
      // own, so the zip reads: only their hash says they are not what it names.
      const packageEntry = `objects/${packageHash.slice(0, 2)}/${packageHash.slice(2)}.beast2`;
      const other = Buffer.from('another object');
      const misnamed = await writeZip(join(tempDir, 'misnamed.zip'), [...entries].map(([name, bytes]): [string, Buffer] =>
        name === packageEntry ? [name, other] : [name, bytes]));

      await assert.rejects(packageImport(storage, testRepo, misnamed), (err: unknown) =>
        err instanceof PackageInvalidError && err.message === `Invalid package: its object ${packageHash} holds the bytes of another`);
      assert.deepStrictEqual(await packageList(storage, testRepo), [], 'no package ref names what it wrote');
      assert.strictEqual(await storage.objects.exists(testRepo, packageHash), false, 'nothing is held under the hash its entry names');
      // The store named the bytes by their own hash as it wrote them, and
      // nothing names that: gc sweeps them, with all else the import wrote.
      assert.strictEqual(await storage.objects.exists(testRepo, computeHash(other)), true, 'the bytes are held under their own hash');
      await repoGc(storage, testRepo, { minAge: 0 });
      assert.deepStrictEqual(await storage.objects.list(testRepo), [], 'gc swept every object the refused import wrote');
    });
  });

  describe('zips an earlier release exported', () => {
    /** What the release made of its zips. */
    const release = JSON.parse(readFileSync(join(RELEASED, 'release.json'), 'utf8')) as {
      release: string;
      name: string;
      version: string;
      packageHash: string;
      objectCount: number;
      objects: string[];
      zips: Record<string, number>;
    };
    const imported = { name: release.name, version: release.version, packageHash: release.packageHash, objectCount: release.objectCount };

    for (const [zip, how, method] of [['sdk.zip', 'the SDK\'s e3.export, deflated', 8], ['core.zip', 'e3-core\'s packageExport, stored', 0]] as const) {
      it(`imports the zip ${release.release} wrote by ${how}, from a file and by ranges, to the objects that release took in`, async () => {
        const bytes = readFileSync(join(RELEASED, zip));
        assert.strictEqual(bytes.byteLength, release.zips[zip]);
        assert.deepStrictEqual([...new Set(methodsOf(bytes))], [method], `its entries are ${how.split(', ')[1]}`);

        assert.deepStrictEqual(await packageImport(storage, testRepo, join(RELEASED, zip)), imported);
        assert.deepStrictEqual((await storage.objects.list(testRepo)).sort(), release.objects);
        assert.strictEqual(await packageResolve(storage, testRepo, release.name, release.version), release.packageHash);

        const elsewhere = new InMemoryStorage();
        await elsewhere.repos.create('r');
        assert.deepStrictEqual(await packageImport(elsewhere, 'r', sourceOf(bytes)), imported);
        assert.deepStrictEqual((await elsewhere.objects.list('r')).sort(), release.objects);
        for (const hash of release.objects) {
          assert.strictEqual(computeHash(await elsewhere.objects.read('r', hash)), hash, `object ${hash} is the bytes its hash names`);
        }
      });
    }

    it(`writes, for the entries ${release.release}'s zip writer wrote, the bytes it wrote`, async () => {
      const zip = readFileSync(join(RELEASED, 'core.zip'));
      const entries = await readZipEntries(join(RELEASED, 'core.zip'));
      assert.ok((await zipBytes(entries)).equals(zip), 'the zip is the one the release wrote');
    });
  });

  describe('packageZipOpen', () => {
    it('reads a package from a zip where it is, as an import would leave the repository, and writes nothing', async () => {
      const OrderType = StructType({ status: StringType });
      const orders = e3.record('orders', DictType(StringType, OrderType), new Map([['o-1', { status: 'open' }]]));
      const byStatus = e3.recordIndex('by_status', orders, {
        key: East.function([StringType, OrderType], StringType, ($, _id, order) => order.status),
      });
      const zipPath = join(tempDir, 'orders.zip');
      await e3.export(e3.package('orders', '1.0.0', orders, byStatus), zipPath);
      const imported = createTestRepo();
      try {
        const expected = await packageImport(storage, imported, zipPath);
        const before = filesUnder(testRepo);

        const zip = await packageZipOpen(zipPath);
        try {
          assert.deepStrictEqual([zip.name, zip.version, zip.packageHash, zip.objectCount],
            ['orders', '1.0.0', expected.packageHash, expected.objectCount]);
          const view = zip.view(storage);
          assert.strictEqual(await packageResolve(view, testRepo, 'orders', '1.0.0'), expected.packageHash);
          for (const hash of await storage.objects.list(imported)) {
            const read = Buffer.from(await view.objects.read(testRepo, hash));
            assert.ok(read.equals(Buffer.from(await storage.objects.read(imported, hash))), `object ${hash} reads as imported`);
          }

          // A deploy's plan reads the package, its record and index objects
          // and the record's initial value through the view.
          const records: RecordPlan[] = [];
          const indexes: RecordIndexPlan[] = [];
          await workspaceDeploy(view, testRepo, 'main', 'orders', '1.0.0', {
            plan: true, onRecordPlan: (plan) => records.push(plan), onRecordIndex: (plan) => indexes.push(plan),
          });
          assert.deepStrictEqual(records.map((plan) => [plan.record, plan.action.type]), [['records/orders', 'mint']]);
          assert.deepStrictEqual(indexes.map((plan) => [plan.record, plan.index, plan.action.type]), [['records/orders', 'by_status', 'build']]);

          await assert.rejects(view.objects.write(testRepo, new Uint8Array([1])), /^Error: a view of a package zip writes nothing, and was asked to write an object$/);
          await assert.rejects(view.refs.packageWrite(testRepo, 'orders', '1.0.0', expected.packageHash), /was asked to write a package ref$/);
          await assert.rejects(view.datasets.write(testRepo, 'main', 'records/orders', variant('unassigned', null)), /was asked to write a dataset ref$/);
          await assert.rejects(view.logs.flush(testRepo, 'c'.repeat(64), 'd'.repeat(64), '0190a0b0-8888-7000-8000-000000000000'), /was asked to flush a log$/);
        } finally {
          zip.close();
        }
        assert.deepStrictEqual(filesUnder(testRepo), before, 'the repository is as it was');
      } finally {
        removeTestRepo(imported);
      }
    });

    it('refuses what an import refuses, and an object that is not the bytes its name hashes', async () => {
      const zipPath = join(tempDir, 'refused.zip');
      await e3.export(e3.package('refused', '1.0.0', e3.input('note', StringType, variant('value', 'kept'))), zipPath);
      const entries = await readZipEntries(zipPath);
      const ref = 'packages/refused/1.0.0.beast2';
      const packageHash = decodeBeast2For(StringType)(entries.get(ref)!);
      const rewritten = (file: string, entryOf: (name: string, bytes: Buffer) => [string, Buffer] | null): Promise<string> =>
        writeZip(join(tempDir, file), [...entries].flatMap(([name, bytes]) => {
          const entry = entryOf(name, bytes);
          return entry === null ? [] : [entry];
        }));

      const refless = await rewritten('refless.zip', (name, bytes) => name === ref ? null : [name, bytes]);
      await assert.rejects(packageZipOpen(refless), (err: unknown) =>
        err instanceof PackageInvalidError && err.message === 'Invalid package: missing package ref');

      const older = await rewritten('older.zip', (name, bytes) => name === ref ? ['packages/refused/1.0.0', Buffer.from(`${packageHash}\n`)] : [name, bytes]);
      await assert.rejects(packageZipOpen(older), (err: unknown) =>
        err instanceof PackageInvalidError && err.message === 'Invalid package: an older e3 exported it — export it again with the current one');

      const newer = await writeZip(join(tempDir, 'newer.zip'), withRelease(entries, '999.0.0'));
      await assert.rejects(packageZipOpen(newer), (err: unknown) =>
        err instanceof PackageInvalidError &&
        err.message === `Invalid package: e3 999.0.0 exported it, and this e3 is ${E3_RELEASE} — import it with e3 999.0.0 or a newer one`);

      // Opening reads no object, so the zip opens; the object is refused when
      // it is read.
      const packageEntry = `objects/${packageHash.slice(0, 2)}/${packageHash.slice(2)}.beast2`;
      const swapped = await rewritten('swapped.zip', (name, bytes) => name === packageEntry ? [name, Buffer.from('another object')] : [name, bytes]);
      const zip = await packageZipOpen(swapped);
      try {
        await assert.rejects(packageRead(zip.view(storage), testRepo, 'refused', '1.0.0'), (err: unknown) =>
          err instanceof PackageInvalidError && err.message === `Invalid package: its object ${packageHash} holds the bytes of another`);
      } finally {
        zip.close();
      }
    });

    it('checks each object a view reads by the hash it is given', async () => {
      const zipPath = join(tempDir, 'hashed.zip');
      await e3.export(e3.package('hashed', '1.0.0'), zipPath);
      const hashed: string[] = [];
      const zip = await packageZipOpenFrom(() => openZip(zipPath), undefined, (data) => {
        const hash = nodeComputeHash(data);
        hashed.push(hash);
        return hash;
      });
      try {
        await packageRead(zip.view(storage), testRepo, 'hashed', '1.0.0');
        assert.deepStrictEqual(hashed, [zip.packageHash], 'the package object, read through the view, checked by the hash given');
      } finally {
        zip.close();
      }
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
      // Beside the objects, only the release that exported it, first, and the
      // package ref, as the repository keeps it
      const entries = await readZipEntries(exportZip);
      assert.deepStrictEqual([...entries.keys()].filter((name) => !name.startsWith('objects/')), ['release.beast2', 'packages/export-input/1.0.0.beast2']);
      assert.strictEqual([...entries.keys()][0], 'release.beast2');
      assert.strictEqual(decodeBeast2For(StringType)(entries.get('release.beast2')!), E3_RELEASE);
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
