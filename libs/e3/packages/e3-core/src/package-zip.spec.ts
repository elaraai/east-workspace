/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package zips with no local file (#982): an export written to a stream, an
 * import read by ranges where the zip lies, and each stopped part way — as
 * compute with a time limit stops at its deadline — and taken up again by the
 * next call, alone and as a job.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { ArrayType, IntegerType, StringType, StructType, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { ExportStoppedError, PackageInvalidError, RepositoryBusyError, WorkspaceLockError } from './errors.js';
import { repoGc } from './gc.js';
import { packageExport, packageImport, packageZipCheckpointWithin } from './packages.js';
import { workspaceDeploy, workspaceExport } from './workspaces.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { InMemoryTransferBackend } from './transfer/InMemoryTransferBackend.js';
import { handleProcessExport, handleProcessImport } from './transfer/process.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from './test-helpers.js';
import type { ZipSource } from './zip.js';

const TableType = ArrayType(StructType({ id: IntegerType, name: StringType }));
const rows = (n: number): { id: bigint; name: string }[] => Array.from({ length: n }, (_, i) => ({ id: BigInt(i), name: `row-${i}` }));

/** A stream that keeps what is written to it, dropping the first `skip`
 *  bytes: a destination that holds them already. */
class Collector extends Writable {
  readonly chunks: Buffer[] = [];

  constructor(private skip = 0) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (err?: Error | null) => void): void {
    const dropped = Math.min(this.skip, chunk.byteLength);
    this.skip -= dropped;
    if (dropped < chunk.byteLength) this.chunks.push(chunk.subarray(dropped));
    done();
  }

  /** Everything kept so far. */
  get bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Bytes read by ranges where they lie, each range read recorded. */
function sourceOf(bytes: Uint8Array, reads: Array<readonly [number, number]> = []): ZipSource {
  return {
    size: bytes.byteLength,
    read: async (offset, length) => {
      reads.push([offset, offset + length]);
      return bytes.subarray(offset, offset + length);
    },
  };
}

/** What an export that is stopped throws. */
async function stoppedBy(exporting: Promise<unknown>): Promise<ExportStoppedError> {
  try {
    await exporting;
  } catch (err) {
    assert.ok(err instanceof ExportStoppedError, String(err));
    return err;
  }
  return assert.fail('the export was not stopped');
}

describe('package zips with no local file', () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage();
    // A package whose one input holds a table of several segments.
    const pkg = e3.package('tables', '1.0.0', e3.input('table', TableType, variant('value', rows(20_000))));
    const zipPath = join(dir, 'tables.zip');
    await e3.export(pkg, zipPath);
    await packageImport(storage, repo, zipPath);
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  /** The package's zip, as an export never stopped writes it. */
  async function exported(): Promise<Buffer> {
    const sink = new Collector();
    await packageExport(storage, repo, 'tables', '1.0.0', sink);
    return sink.bytes;
  }

  /** A repository elsewhere, in memory, as a cloud's store holds one. */
  async function elsewhere(): Promise<InMemoryStorage> {
    const target = new InMemoryStorage();
    await target.repos.create('r');
    return target;
  }

  it('exports a package to a stream, and imports it from ranges of the zip where it lies, to the same package', async () => {
    const bytes = await exported();
    const zipPath = join(dir, 'exported.zip');
    const toFile = await packageExport(storage, repo, 'tables', '1.0.0', zipPath);
    assert.deepEqual(readFileSync(zipPath), bytes, 'a file and a stream get the same zip');
    assert.equal(toFile.bytes, bytes.byteLength);

    const target = await elsewhere();
    const reads: Array<readonly [number, number]> = [];
    const imported = await packageImport(target, 'r', sourceOf(bytes, reads));
    assert.equal(imported.packageHash, toFile.packageHash);
    assert.equal(imported.objectCount, toFile.objectCount);
    assert.equal(await target.refs.packageResolve('r', 'tables', '1.0.0'), toFile.packageHash);
    assert.equal(await target.objects.count('r'), toFile.objectCount, 'every object the zip holds, and nothing else');
    assert.ok(reads.length <= Math.ceil(bytes.byteLength / (1024 * 1024)) + 2, `a ${bytes.byteLength}-byte zip was read in ${reads.length} ranges`);
  });

  it('takes an import stopped part way up again, reading only the objects it did not write, naming the package only once all is in', async () => {
    const bytes = await exported();
    const target = await elsewhere();
    const objects = target.objects;
    const write = objects.write.bind(objects);
    let writes = 0;
    const stop = new AbortController();
    objects.write = async (at: string, data: Uint8Array): Promise<string> => {
      const hash = await write(at, data);
      if (++writes === 2) stop.abort();
      return hash;
    };

    await assert.rejects(packageImport(target, 'r', sourceOf(bytes), { signal: stop.signal }), { name: 'AbortError' });
    // The writes in flight when it stopped land: objects go side by side.
    const before = writes;
    assert.ok(before >= 2, `${before} objects were written`);
    assert.equal(await target.refs.packageResolve('r', 'tables', '1.0.0'), null, 'nothing names a package not all in');

    writes = 0;
    const imported = await packageImport(target, 'r', sourceOf(bytes));
    assert.equal(writes, imported.objectCount - before, 'the objects written before are not read again');
    assert.equal(await target.refs.packageResolve('r', 'tables', '1.0.0'), imported.packageHash);
    assert.equal(await target.objects.count('r'), imported.objectCount);
  });

  it('imports its objects side by side, and holds gc off until its package ref names them', async () => {
    const bytes = await exported();
    const target = await elsewhere();
    const objects = target.objects;
    const write = objects.write.bind(objects);
    const inFlight = { now: 0, most: 0 };
    const gc: { during?: Promise<unknown> } = {};
    // Each write held until eight are, as a remote store holds its requests,
    // and then all go on: so the most written at once is what the import
    // starts, never a race against a timer. Were eight never written at once,
    // each would go on after a long while, and the count below fail.
    let eight = (): void => {};
    const together = new Promise<void>((resolve) => { eight = resolve; });
    objects.write = async (at: string, data: Uint8Array): Promise<string> => {
      inFlight.most = Math.max(inFlight.most, ++inFlight.now);
      if (inFlight.now >= 8) eight();
      // A gc that starts while the import runs
      gc.during ??= repoGc(target, 'r', { minAge: 0 }).then(() => 'it swept', (err: unknown) => err);
      await Promise.race([together, new Promise((resolve) => setTimeout(resolve, 10_000).unref())]);
      inFlight.now--;
      return write(at, data);
    };

    const imported = await packageImport(target, 'r', sourceOf(bytes));
    assert.ok(inFlight.most >= 8, `at most ${inFlight.most} objects were written at once`);
    const swept = await gc.during;
    assert.ok(swept instanceof RepositoryBusyError, `a gc during the import: ${String(swept)}`);
    assert.equal(await target.objects.count('r'), imported.objectCount, 'every object the import wrote is there');
  });

  it('holds gc off while it exports a package or a workspace, which reads what gc would sweep', async () => {
    await workspaceDeploy(storage, repo, 'ws', 'tables', '1.0.0');
    for (const [what, exporting] of [
      ['a package', (sink: Writable) => packageExport(storage, repo, 'tables', '1.0.0', sink)],
      ['a workspace', (sink: Writable) => workspaceExport(storage, repo, 'ws', sink, 'tables-ws', '2.0.0')],
    ] as const) {
      // A gc that starts as the export writes its zip, which waits for it
      const gc: { during?: Promise<unknown> } = {};
      const sink = new Writable({
        write(_chunk, _encoding, done) {
          if (gc.during !== undefined) return done();
          gc.during = repoGc(storage, repo, { minAge: 0 }).then(() => 'it swept', (err: unknown) => err);
          void gc.during.then(() => done());
        },
      });
      await exporting(sink);
      const swept = await gc.during;
      assert.ok(swept instanceof RepositoryBusyError, `a gc during the export of ${what}: ${String(swept)}`);
    }
    // Once they are done, gc runs.
    await repoGc(storage, repo, { minAge: 0 });
  });

  it('refuses an object whose bytes are not those its entry names', async () => {
    const bytes = Buffer.from(await exported());
    // The first object entry's bytes, one of them changed.
    const at = bytes.indexOf(Buffer.from('objects/'));
    const nameEnd = bytes.indexOf(Buffer.from('.beast2'), at) + '.beast2'.length;
    bytes[nameEnd + 1] = bytes[nameEnd + 1]! ^ 0xff;
    await assert.rejects(packageImport(await elsewhere(), 'r', sourceOf(bytes)), /holds the bytes of another|CRC|crc/);
  });

  it('refuses a zip that does not read as an invalid package, and raises a read its source fails as the source raised it', async () => {
    // A zip whose directory names a local header ten bytes before its end:
    // no retry mends it
    const bytes = Buffer.from(await exported());
    const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(bytes.byteLength - 10, directory + 42);
    await assert.rejects(packageImport(await elsewhere(), 'r', sourceOf(bytes)), (err: unknown) =>
      err instanceof PackageInvalidError && /the zip does not read: the zip names its bytes/.test(err.message));

    // A store that throttles a read: a round that runs the import again mends it
    const throttled = Object.assign(new Error('Please reduce your request rate.'), { name: 'SlowDown' });
    const throttling: ZipSource = { size: bytes.byteLength, read: () => Promise.reject(throttled) };
    await assert.rejects(packageImport(await elsewhere(), 'r', throttling), (err: unknown) => err === throttled);
  });

  it('stops an export at its signal between entries, and resumes it from its checkpoint to the zip it would have written', async () => {
    const whole = await exported();
    const stop = new AbortController();
    const sink = new Collector();
    const stopped = await stoppedBy(packageExport(storage, repo, 'tables', '1.0.0', sink, {
      signal: stop.signal,
      onProgress: async ({ objectsProcessed }) => { if (objectsProcessed === 2) stop.abort(); },
    }));
    const { checkpoint } = stopped;
    assert.equal(sink.bytes.byteLength, Number(checkpoint.bytes), 'the stream holds what the checkpoint counts');
    assert.deepEqual(sink.bytes, whole.subarray(0, sink.bytes.byteLength));
    assert.equal(checkpoint.entries.length, 3, 'the release, and two objects');

    const resumed = await packageExport(storage, repo, 'tables', '1.0.0', sink, { resume: checkpoint });
    assert.deepEqual(sink.bytes, whole);
    assert.equal(resumed.bytes, whole.byteLength);

    // A destination that kept only part of the last entry, as a multipart
    // upload keeps only its whole parts, resumes from the entry before it.
    const held = Number(checkpoint.bytes) - 10;
    const within = packageZipCheckpointWithin(checkpoint, held);
    assert.equal(within.checkpoint.entries.length, 2);
    assert.equal(Number(within.checkpoint.bytes) + within.rewritten, held);
    const partial = new Collector(within.rewritten);
    partial.chunks.push(whole.subarray(0, held));
    await packageExport(storage, repo, 'tables', '1.0.0', partial, { resume: within.checkpoint });
    assert.deepEqual(partial.bytes, whole);
    assert.throws(() => packageZipCheckpointWithin(checkpoint, Number(checkpoint.bytes) + 1), /holds \d+ bytes of a zip whose checkpoint counts \d+/);

    // A checkpoint of another package, or another release's, is refused.
    await assert.rejects(packageExport(storage, repo, 'tables', '1.0.0', new Collector(), { resume: { ...checkpoint, packageHash: 'f'.repeat(64) } }),
      /changed since the export started — export it again from the start/);
    await assert.rejects(packageExport(storage, repo, 'tables', '1.0.0', new Collector(), { resume: { ...checkpoint, release: '0.0.1' } }),
      /written by e3 0\.0\.1/);
  });

  it('keeps a stopped export to a file beside it, and resumes it there', async () => {
    const whole = await exported();
    const zipPath = join(dir, 'stopped.zip');
    const stop = new AbortController();
    const stopped = await stoppedBy(packageExport(storage, repo, 'tables', '1.0.0', zipPath, {
      signal: stop.signal,
      onProgress: async ({ objectsProcessed }) => { if (objectsProcessed === 3) stop.abort(); },
    }));
    assert.equal(existsSync(zipPath), false, 'no zip until it is whole');
    assert.equal(statSync(`${zipPath}.partial`).size, Number(stopped.checkpoint.bytes));

    await packageExport(storage, repo, 'tables', '1.0.0', zipPath, { resume: stopped.checkpoint });
    assert.deepEqual(readFileSync(zipPath), whole);
    assert.equal(existsSync(`${zipPath}.partial`), false);
  });

  it('exports a workspace to a stream as to a file, stopped and resumed alike', async () => {
    await workspaceDeploy(storage, repo, 'ws', 'tables', '1.0.0');
    const zipPath = join(dir, 'ws.zip');
    const toFile = await workspaceExport(storage, repo, 'ws', zipPath, 'tables-ws', '2.0.0');
    const whole = readFileSync(zipPath);
    assert.equal(toFile.bytes, whole.byteLength);

    const stop = new AbortController();
    const sink = new Collector();
    const stopped = await stoppedBy(workspaceExport(storage, repo, 'ws', sink, 'tables-ws', '2.0.0', {
      signal: stop.signal,
      onProgress: async ({ objectsProcessed }) => { if (objectsProcessed === 2) stop.abort(); },
    }));
    await workspaceExport(storage, repo, 'ws', sink, 'tables-ws', '2.0.0', { resume: stopped.checkpoint });
    assert.deepEqual(sink.bytes, whole);
    await assert.rejects(workspaceExport(storage, repo, 'ws', new Collector(), 'tables-ws', undefined, { resume: stopped.checkpoint }),
      /a resumed export of a workspace names the version the export it resumes named/);
  });

  describe('as jobs', () => {
    it('hands an import job stopped part way over, with the job going on, and completes it from where the zip lies', async () => {
      const bytes = await exported();
      const target = await elsewhere();
      const backend = new InMemoryTransferBackend({ storage: target, getRepoPath: (at) => at });
      await backend.packageImport.create('job', { repo: 'r', size: BigInt(bytes.byteLength), status: variant('uploaded', null), createdAt: new Date() });
      const objects = target.objects;
      const write = objects.write.bind(objects);
      const stop = new AbortController();
      objects.write = async (at: string, data: Uint8Array): Promise<string> => {
        const hash = await write(at, data);
        stop.abort();
        return hash;
      };

      await assert.rejects(
        handleProcessImport({ storage: target, importStore: backend.packageImport, signal: stop.signal }, { id: 'job', repo: 'r', zip: sourceOf(bytes) }),
        { name: 'AbortError' },
      );
      assert.notEqual((await backend.packageImport.get('job'))?.status.type, 'failed', 'a call stopped hands the job over');

      objects.write = write;
      await handleProcessImport({ storage: target, importStore: backend.packageImport }, { id: 'job', repo: 'r', zip: sourceOf(bytes) });
      const status = (await backend.packageImport.get('job'))?.status;
      assert.ok(status?.type === 'completed', `the job ${status?.type}`);
      assert.equal(await target.refs.packageResolve('r', 'tables', '1.0.0'), status.value.packageHash);
    });

    it('hands an export job stopped part way over with its checkpoint, and completes it into the same stream', async () => {
      const whole = await exported();
      const backend = new InMemoryTransferBackend({ storage, getRepoPath: () => repo });
      await backend.packageExport.create('job', {
        repo, name: 'tables', version: '1.0.0', workspace: none, status: variant('processing', variant('pending', null)), createdAt: new Date(),
      });
      const stop = new AbortController();
      stop.abort();
      const sink = new Collector();

      const stopped = await stoppedBy(handleProcessExport({ storage, exportStore: backend.packageExport, signal: stop.signal }, { id: 'job', repo, zip: sink }));
      assert.equal((await backend.packageExport.get('job'))?.status.type, 'processing', 'a call stopped hands the job over');

      await handleProcessExport({ storage, exportStore: backend.packageExport }, { id: 'job', repo, zip: sink, resume: stopped.checkpoint });
      assert.deepEqual(sink.bytes, whole);
      assert.deepEqual((await backend.packageExport.get('job'))?.status, variant('completed', { size: BigInt(whole.byteLength) }));
    });

    it('holds a workspace across the calls of its export job, when the caller holds its lock, so nothing changes it in between', async () => {
      await workspaceDeploy(storage, repo, 'ws', 'tables', '1.0.0');
      const whole = new Collector();
      await workspaceExport(storage, repo, 'ws', whole, 'tables-ws', '2.0.0');
      const backend = new InMemoryTransferBackend({ storage, getRepoPath: () => repo });
      await backend.packageExport.create('job', {
        repo, name: 'tables-ws', version: '2.0.0', workspace: some('ws'), status: variant('processing', variant('pending', null)), createdAt: new Date(),
      });
      // The caller takes the workspace as the export would, and holds it until
      // the job ends
      const lock = await storage.locks.acquire(repo, 'ws', variant('export', null));
      assert.ok(lock);
      try {
        const stop = new AbortController();
        stop.abort();
        const sink = new Collector();
        const stopped = await stoppedBy(handleProcessExport({ storage, exportStore: backend.packageExport, lock, signal: stop.signal }, { id: 'job', repo, zip: sink }));
        await assert.rejects(workspaceDeploy(storage, repo, 'ws', 'tables', '1.0.0'), WorkspaceLockError, 'a deploy between the calls finds the workspace held');

        await handleProcessExport({ storage, exportStore: backend.packageExport, lock }, { id: 'job', repo, zip: sink, resume: stopped.checkpoint });
        assert.deepEqual(sink.bytes, whole.bytes);
        assert.deepEqual((await backend.packageExport.get('job'))?.status, variant('completed', { size: BigInt(whole.bytes.byteLength) }));
        assert.notEqual(await storage.locks.getState(repo, 'ws'), null, 'the export leaves the lock to its holder');
      } finally {
        await lock.release();
      }
    });
  });
});
