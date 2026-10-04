/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for LocalRepoStore.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { existsSync, promises as fsPromises, readFileSync, readdirSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NullType, encodeBeast2For, none, variant } from '@elaraai/east';
import { E3_RELEASE, ExecutionStatusType, type ExecutionStatus } from '@elaraai/e3-types';
import { LocalRepoStore, METADATA_FILE } from './LocalRepoStore.js';
import { LocalStorage } from './LocalBackend.js';
import { REPOSITORY_RECORD_FILE, encodeRepositoryRecord } from './LocalRefStore.js';
import { GC_ASIDE_SUFFIX, executionPath, objectPath, runningPath, runsPath, unreachableNotePath } from './localHelpers.js';
import { repoGc } from '../../gc.js';
import { repoInit } from './repository.js';
import { repositoryOpen } from '../../repository-record.js';
import {
  InvalidNameError,
  ObjectNotFoundError,
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';
import { createTempDir, removeTempDir } from '../../test-helpers.js';
import { uuidv7 } from '../../uuid.js';

describe('LocalRepoStore', () => {
  let testDir: string;
  let storage: LocalStorage;
  let store: LocalRepoStore;

  beforeEach(() => {
    testDir = createTempDir();
    storage = new LocalStorage(testDir);
    store = storage.repos as LocalRepoStore;
  });

  afterEach(() => {
    removeTempDir(testDir);
  });

  describe('list', () => {
    it('returns empty array initially', async () => {
      const repos = await store.list();
      assert.deepStrictEqual(repos, []);
    });

    it('returns all created repos', async () => {
      await store.create('repo1');
      await store.create('repo2');
      await store.create('repo3');

      const repos = await store.list();
      assert.deepStrictEqual(repos.sort(), ['repo1', 'repo2', 'repo3']);
    });

    it('does not include invalid directories', async () => {
      await store.create('valid-repo');
      // Create an incomplete repo (missing workspaces dir)
      const invalidDir = join(testDir, 'invalid-repo');
      mkdirSync(invalidDir);
      mkdirSync(join(invalidDir, 'objects'));
      mkdirSync(join(invalidDir, 'packages'));
      mkdirSync(join(invalidDir, 'executions'));
      // Missing 'workspaces' directory

      const repos = await store.list();
      assert.deepStrictEqual(repos, ['valid-repo']);
    });
  });

  describe('exists', () => {
    it('returns false for non-existent repo', async () => {
      const exists = await store.exists('nonexistent');
      assert.strictEqual(exists, false);
    });

    it('returns true for existing repo', async () => {
      await store.create('my-repo');
      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, true);
    });
  });

  describe('getMetadata', () => {
    it('returns null for non-existent repo', async () => {
      const metadata = await store.getMetadata('nonexistent');
      assert.strictEqual(metadata, null);
    });

    it('returns metadata for existing repo', async () => {
      await store.create('my-repo');
      const metadata = await store.getMetadata('my-repo');

      assert.ok(metadata);
      assert.strictEqual(metadata.name, 'my-repo');
      assert.strictEqual(metadata.status.type, 'active');
      assert.ok(metadata.createdAt);
      assert.ok(metadata.statusChangedAt);
    });

    it('returns metadata for a repo repoInit created', async () => {
      assert.strictEqual(repoInit(join(testDir, 'cli-repo')).success, true);

      const metadata = await store.getMetadata('cli-repo');

      assert.ok(metadata);
      assert.strictEqual(metadata.name, 'cli-repo');
      assert.strictEqual(metadata.status.type, 'active');
      assert.strictEqual(metadata.statusChangedAt.getTime(), metadata.createdAt.getTime());
    });

    it('refuses a repo whose metadata an older e3 left, naming the fix', async () => {
      // The repo an older e3 left: the directories, and its metadata as JSON
      const olderDir = join(testDir, 'older-repo');
      mkdirSync(olderDir);
      mkdirSync(join(olderDir, 'objects'));
      mkdirSync(join(olderDir, 'packages'));
      mkdirSync(join(olderDir, 'executions'));
      mkdirSync(join(olderDir, 'workspaces'));
      writeFileSync(join(olderDir, '.e3-metadata.json'), '{"name":"older-repo","status":"active"}');

      await assert.rejects(store.getMetadata('older-repo'), {
        name: 'RepoLayoutError',
        message: `the repository at ${olderDir} has no repository record: an older e3 wrote it — ` +
          're-create it: deploy again and import its data again',
      });
    });

    it('reads the metadata without opening the repository, whose record the open reads', async () => {
      await store.create('newer-repo');
      const repoDir = join(testDir, 'newer-repo');
      const record = await repositoryOpen(storage, repoDir);
      writeFileSync(join(repoDir, REPOSITORY_RECORD_FILE), encodeRepositoryRecord({
        ...record, upgrades: [...record.upgrades, { name: 'from-a-newer-e3', release: '999.0.0' }],
      }));

      const metadata = await store.getMetadata('newer-repo');
      assert.strictEqual(metadata?.name, 'newer-repo');
      await assert.rejects(repositoryOpen(storage, repoDir), { name: 'RepoLayoutError' });
    });

    it('refuses a repository name that is no one path segment, before it becomes a path', async () => {
      await assert.rejects(store.getMetadata('..'), InvalidNameError);
      await assert.rejects(store.create('../elsewhere'), InvalidNameError);
      await assert.rejects(store.remove('..'), InvalidNameError);
      await assert.rejects(store.deleteRefsBatch('a/b'), InvalidNameError);
      assert.strictEqual(existsSync(join(testDir, '..', 'elsewhere')), false);
    });
  });

  describe('create', () => {
    it('creates a new repo with active status', async () => {
      await store.create('my-repo');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'active');
    });

    it('creates all required directories', async () => {
      await store.create('my-repo');

      const repoDir = join(testDir, 'my-repo');
      assert.strictEqual(existsSync(join(repoDir, 'objects')), true);
      assert.strictEqual(existsSync(join(repoDir, 'packages')), true);
      assert.strictEqual(existsSync(join(repoDir, 'executions')), true);
      assert.strictEqual(existsSync(join(repoDir, 'workspaces')), true);
    });

    it('creates the repository record, naming this release, and the metadata beside it', async () => {
      await store.create('my-repo');

      const repoDir = join(testDir, 'my-repo');
      assert.strictEqual(existsSync(join(repoDir, REPOSITORY_RECORD_FILE)), true);
      assert.strictEqual(existsSync(join(repoDir, METADATA_FILE)), true);
      assert.strictEqual(existsSync(join(repoDir, '.e3-metadata.json')), false);

      const { release } = await repositoryOpen(storage, repoDir);
      assert.strictEqual(release, E3_RELEASE);
      const metadata = await store.getMetadata('my-repo');
      assert.strictEqual(metadata?.name, 'my-repo');
      assert.strictEqual(metadata?.status.type, 'active');
    });

    it('throws RepoAlreadyExistsError if repo exists', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.create('my-repo'),
        RepoAlreadyExistsError
      );
    });
  });

  describe('setStatus', () => {
    it('updates status', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'gc');
    });

    it('updates statusChangedAt', async () => {
      await store.create('my-repo');
      const before = await store.getMetadata('my-repo');
      assert.ok(before);

      // Wait for the clock to pass the first timestamp, so the second differs
      while (Date.now() <= before.statusChangedAt.getTime()) await new Promise(resolve => setTimeout(resolve, 1));

      await store.setStatus('my-repo', 'gc');
      const after = await store.getMetadata('my-repo');

      assert.ok(after);
      assert.notStrictEqual(before.statusChangedAt.getTime(), after.statusChangedAt.getTime());
    });

    it('throws RepoNotFoundError for non-existent repo', async () => {
      await assert.rejects(
        () => store.setStatus('nonexistent', 'gc'),
        RepoNotFoundError
      );
    });

    it('succeeds with correct expected status', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc', 'active');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'gc');
    });

    it('throws RepoStatusConflictError with wrong expected status', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.setStatus('my-repo', 'gc', 'deleting'),
        RepoStatusConflictError
      );
    });

    it('leaves the repository record as it is', async () => {
      await store.create('my-repo');
      const repoDir = join(testDir, 'my-repo');
      const record = readFileSync(join(repoDir, REPOSITORY_RECORD_FILE));

      await store.setStatus('my-repo', 'gc');

      assert.deepStrictEqual(readFileSync(join(repoDir, REPOSITORY_RECORD_FILE)), record);
      assert.strictEqual((await store.getMetadata('my-repo'))?.status.type, 'gc');
    });

    it('succeeds with expected status array', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc', ['active', 'creating']);

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'gc');
    });
  });

  describe('remove', () => {
    it('removes a repo and its directory', async () => {
      await store.create('my-repo');
      await store.remove('my-repo');

      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, false);

      const dirExists = existsSync(join(testDir, 'my-repo'));
      assert.strictEqual(dirExists, false);
    });

    it('does not throw for non-existent repo', async () => {
      await store.remove('nonexistent');
      // Should not throw
    });
  });

  describe('deleteRefsBatch', () => {
    it('deletes every record directory\'s contents', async () => {
      await store.create('my-repo');
      const repoDir = join(testDir, 'my-repo');

      // One record in each record directory
      const records = [
        join('packages', 'test-pkg', '1.0.0.beast2'),
        join('workspaces', 'main.beast2'),
        join('executions', 'a'.repeat(64), 'b'.repeat(64), 'plan.beast2'),
        join('running', 'a'.repeat(64), `${'b'.repeat(64)}.0190a0b0-4444-7000-8000-000000000000.beast2`),
        join('runs', 'a'.repeat(64), `0190a0b0-4444-7000-8000-000000000000.${'b'.repeat(64)}.beast2`),
        join('dataflows', 'main', '0190a0b0-4444-7000-8000-000000000000.beast2'),
        join('adoptions', 'cc', `${'c'.repeat(62)}.beast2`),
        join('locks', 'main', 'exclusive.beast2'),
      ];
      for (const record of records) {
        mkdirSync(join(repoDir, record, '..'), { recursive: true });
        writeFileSync(join(repoDir, record), 'record');
      }

      const result = await store.deleteRefsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.deleted, records.length);
      for (const record of records) {
        assert.strictEqual(existsSync(join(repoDir, record)), false, record);
      }
    });
  });

  describe('deleteObjectsBatch', () => {
    it('deletes objects directory contents', async () => {
      await store.create('my-repo');
      const repoDir = join(testDir, 'my-repo');

      // Create an object
      const objectDir = join(repoDir, 'objects', 'ab');
      mkdirSync(objectDir, { recursive: true });
      writeFileSync(join(objectDir, 'cd1234.beast2'), 'test data');

      const result = await store.deleteObjectsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.ok(result.deleted >= 1);
    });
  });

  describe('GC primitives', () => {
    // GC primitives receive the full repo path (same as ObjectStore/RefStore),
    // not a repo name relative to reposDir.

    it('gcScanPackageRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanPackageRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('gcScanWorkspaceRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanWorkspaceRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
    });

    it('gcScanExecutionRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanExecutionRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
    });

    it('gcScanObjects returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanObjects(repoPath);
      assert.deepStrictEqual(result.objects, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('gcScanObjects enumerates objects', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      // Create a fake object file
      const objDir = join(repoPath, 'objects', 'ab');
      mkdirSync(objDir, { recursive: true });
      writeFileSync(join(objDir, 'cd' + '0'.repeat(60) + '.beast2'), 'data');

      const result = await store.gcScanObjects(repoPath);
      assert.strictEqual(result.objects.length, 1);
      assert.strictEqual(result.objects[0].hash, 'ab' + 'cd' + '0'.repeat(60));
    });

    it('gcDeleteObjects removes objects, and their notes', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const hash = 'ab' + 'cd' + '0'.repeat(60);
      const objDir = join(repoPath, 'objects', 'ab');
      mkdirSync(objDir, { recursive: true });
      writeFileSync(join(objDir, 'cd' + '0'.repeat(60) + '.beast2'), 'data');
      await store.gcNoteUnreachable(repoPath, [hash], 1_000_000);

      await store.gcDeleteObjects(repoPath, [hash]);

      const result = await store.gcScanObjects(repoPath);
      assert.strictEqual(result.objects.length, 0);
      assert.strictEqual(existsSync(unreachableNotePath(repoPath, hash)), false, 'the note went with it');
    });
  });

  describe('gc beside running work', () => {
    it('pages the object scan by prefix, each object with the note that stands for it', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const [first, second] = ['ab', 'cd'].map((prefix) => prefix + '0'.repeat(62));
      for (const hash of [first!, second!]) {
        mkdirSync(join(repoPath, 'objects', hash.slice(0, 2)), { recursive: true });
        writeFileSync(objectPath(repoPath, hash), 'data');
      }
      assert.deepStrictEqual(await store.gcNoteUnreachable(repoPath, [second!], 1_000_000), [1_000_000]);

      const page = await store.gcScanObjects(repoPath);
      assert.deepStrictEqual(page.objects.map(({ hash, unreachableSince }) => [hash, unreachableSince]), [[first, null]]);
      assert.strictEqual(page.cursor, 'ab');
      const last = await store.gcScanObjects(repoPath, page.cursor);
      assert.deepStrictEqual(last.objects.map(({ hash, unreachableSince }) => [hash, unreachableSince]), [[second, 1_000_000]]);
      assert.strictEqual(last.cursor, undefined);
    });

    it('passes over a note whose object is gone as it scans, and drops it in the sweep, but not in a dry run', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const gone = 'ef' + '0'.repeat(62);
      const there = 'ab' + '0'.repeat(62);
      mkdirSync(join(repoPath, 'objects', 'ab'), { recursive: true });
      writeFileSync(objectPath(repoPath, there), 'data');
      await store.gcNoteUnreachable(repoPath, [gone, there], 1_000_000);

      const scanned = [(await store.gcScanObjects(repoPath)).objects, (await store.gcScanObjects(repoPath, 'ab')).objects];
      assert.deepStrictEqual(scanned.map((objects) => objects.map(({ hash }) => hash)), [[there], []]);
      assert.ok(existsSync(unreachableNotePath(repoPath, gone)), 'the scan changes nothing');
      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: true, held: false });
      assert.ok(existsSync(unreachableNotePath(repoPath, gone)), 'nor does a dry run');

      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: false, held: false });
      assert.strictEqual(existsSync(unreachableNotePath(repoPath, gone)), false);
      assert.ok(existsSync(unreachableNotePath(repoPath, there)), 'a note whose object is there stands');
    });

    it('leaves an adopted delivery\'s file as it was when it touches or writes the object again', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      // Adopted on the repository's volume, the object may be the delivery's
      // own file, by a hard link
      const delivery = join(testDir, 'delivery.beast2');
      writeFileSync(delivery, 'a delivery');
      const { hash } = await storage.objects.adoptFile(repoPath, delivery);
      const before = statSync(delivery, { bigint: true });

      await store.gcNoteUnreachable(repoPath, [hash], 1_000_000);
      assert.deepStrictEqual(await storage.objects.touch(repoPath, [hash]), [true]);
      assert.strictEqual(await storage.objects.write(repoPath, new TextEncoder().encode('a delivery')), hash);
      await storage.objects.adoptFile(repoPath, delivery, hash);

      const after = statSync(delivery, { bigint: true });
      assert.deepStrictEqual([after.ino, after.mtimeNs, after.size], [before.ino, before.mtimeNs, before.size]);
      assert.strictEqual(existsSync(unreachableNotePath(repoPath, hash)), false, 'the touch cleared the note');
    });

    it('places a delivery again when the object its touch found reads as gone, as a delete that raced the touch leaves it aside', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const delivery = join(testDir, 'delivery.beast2');
      writeFileSync(delivery, 'a delivery');
      const { hash, size } = await storage.objects.adoptFile(repoPath, delivery);

      // The touch finds the object, and the look after it falls in the moment
      // a racing delete has it aside
      let looks = 0;
      storage.objects.stat = (_repo: string, looked: string): Promise<{ size: number }> => {
        looks++;
        return Promise.reject(new ObjectNotFoundError(looked));
      };

      assert.deepStrictEqual(await storage.objects.adoptFile(repoPath, delivery, hash), { hash, size });
      assert.strictEqual(looks, 1, 'it looked after the touch');
      assert.strictEqual(readFileSync(objectPath(repoPath, hash), 'utf8'), 'a delivery');
    });

    /** The error Windows answers a move or an unlink of a file another handle holds open with. */
    const refused = (syscall: string, at: string): Error =>
      Object.assign(new Error(`EPERM: operation not permitted, ${syscall} '${at}'`), { code: 'EPERM', syscall, path: at });

    it('deletes an object another handle holds a moment, trying its move and its unlink again, as Windows refuses both while it is held', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const hash = await storage.objects.write(repoPath, new TextEncoder().encode('held a moment'));
      await store.gcNoteUnreachable(repoPath, [hash], 1_000_000);
      const file = objectPath(repoPath, hash);
      // A scanner holds the object through two moves, and the object moved
      // aside through one unlink
      const [rename, unlink] = [fsPromises.rename, fsPromises.unlink];
      let [moves, unlinks] = [0, 0];
      const renames = mock.method(fsPromises, 'rename', async (from: string, to: string) => {
        if (from === file && ++moves <= 2) throw refused('rename', from);
        return rename(from, to);
      });
      const unlinked = mock.method(fsPromises, 'unlink', async (at: string) => {
        if (at.endsWith(GC_ASIDE_SUFFIX) && ++unlinks <= 1) throw refused('unlink', at);
        return unlink(at);
      });
      try {
        assert.strictEqual(await store.gcDeleteUnreachable(repoPath, hash, 1_000_000), true);
      } finally {
        renames.mock.restore();
        unlinked.mock.restore();
      }
      assert.deepStrictEqual([moves, unlinks], [3, 2], 'each refusal is tried again');
      assert.strictEqual(existsSync(file), false);
      assert.strictEqual(existsSync(unreachableNotePath(repoPath, hash)), false, 'the note went with it');
    });

    it('leaves an object another handle holds past the retries for the next sweep, its note standing', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const hash = await storage.objects.write(repoPath, new TextEncoder().encode('held throughout'));
      await store.gcNoteUnreachable(repoPath, [hash], 1_000_000);
      const file = objectPath(repoPath, hash);
      const rename = fsPromises.rename;
      const renames = mock.method(fsPromises, 'rename', async (from: string, to: string) => {
        if (from === file) throw refused('rename', from);
        return rename(from, to);
      });
      try {
        assert.strictEqual(await store.gcDeleteUnreachable(repoPath, hash, 1_000_000), false);
      } finally {
        renames.mock.restore();
      }
      assert.strictEqual(readFileSync(file, 'utf8'), 'held throughout');
      assert.deepStrictEqual((await store.gcScanObjects(repoPath)).objects.map(({ unreachableSince }) => unreachableSince), [1_000_000]);
      // Once the handle is gone, the next sweep's delete goes through
      assert.strictEqual(await store.gcDeleteUnreachable(repoPath, hash, 1_000_000), true);
      assert.strictEqual(existsSync(file), false);
    });

    it('puts back an object a delete left aside, as when a crash cut it short', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const hash = await storage.objects.write(repoPath, new TextEncoder().encode('left aside'));
      await storage.refs.packageWrite(repoPath, 'names-it', '1.0.0', hash);
      const file = objectPath(repoPath, hash);
      renameSync(file, `${file}.1000.abcdefgh${GC_ASIDE_SUFFIX}`);

      await repoGc(storage, repoPath, { minAge: 0 });
      assert.strictEqual(readFileSync(file, 'utf8'), 'left aside');
    });
  });

  describe('gc holding the repository still', () => {
    it('takes the places in the index of running attempts at which none runs, as a crash leaves them, and none beside running work', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const [task, lone] = ['a', 'b'].map((digit) => digit.repeat(64)) as [string, string];
      const [runs, ended, unwritten] = ['1', '2', '3'].map((digit) => digit.repeat(64)) as [string, string, string];
      const running = (executionId: string): ExecutionStatus => variant('running', {
        executionId, inputHashes: [], startedAt: new Date(), pid: 4242n, pidStartTime: 1n, bootId: 'boot', unit: false,
      });
      const place = encodeBeast2For(NullType)(null);

      // An attempt running; one whose outcome was written, and whose place a
      // crash left; and a place whose attempt's record a crash never wrote,
      // beside another task's, alone in its index.
      const runsId = uuidv7();
      await storage.refs.executionWrite(repoPath, task, runs, runsId, running(runsId));
      const endedId = uuidv7();
      await storage.refs.executionWrite(repoPath, task, ended, endedId, running(endedId));
      writeFileSync(join(executionPath(repoPath, task, ended, endedId), 'status.beast2'), encodeBeast2For(ExecutionStatusType)(variant('failed', {
        executionId: endedId, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit: false,
      })));
      writeFileSync(runningPath(repoPath, task, unwritten, uuidv7()), place);
      mkdirSync(runningPath(repoPath, lone), { recursive: true });
      writeFileSync(runningPath(repoPath, lone, unwritten, uuidv7()), place);
      const places = (): string[] => readdirSync(join(repoPath, 'running'), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${entry.parentPath.slice(-64)}/${entry.name.slice(0, 64)}`)
        .sort();
      const every = [`${task}/${runs}`, `${task}/${ended}`, `${task}/${unwritten}`, `${lone}/${unwritten}`].sort();

      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: false, held: false });
      assert.deepStrictEqual(places(), every, 'beside running work, an attempt may be between its place and its record');
      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: true, held: true });
      assert.deepStrictEqual(places(), every, 'a dry run takes none');

      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: false, held: true });
      assert.deepStrictEqual(places(), [`${task}/${runs}`], 'the place of the attempt running stays');
      assert.deepStrictEqual(readdirSync(join(repoPath, 'running')), [task], 'a task\'s index left empty goes');
      assert.deepStrictEqual((await storage.refs.executionListRunning(repoPath, task)).map(({ inputsHash }) => inputsHash), [runs]);
    });

    it('takes the places in a task\'s index of runs whose run has no record, as a crash leaves them, and none beside running work', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const [task, lone] = ['a', 'b'].map((digit) => digit.repeat(64)) as [string, string];
      const [recorded, unwritten] = ['1', '2'].map((digit) => digit.repeat(64)) as [string, string];
      const place = encodeBeast2For(NullType)(null);

      // A run with its record; and a place whose run's record a crash never
      // wrote, beside another task's, alone in its index.
      const recordedId = uuidv7();
      await storage.refs.executionWrite(repoPath, task, recorded, recordedId, variant('failed', {
        executionId: recordedId, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit: false,
      }));
      writeFileSync(runsPath(repoPath, task, uuidv7(), unwritten), place);
      mkdirSync(runsPath(repoPath, lone), { recursive: true });
      writeFileSync(runsPath(repoPath, lone, uuidv7(), unwritten), place);
      // A place's name is the run's id, 36 characters, then its inputs.
      const places = (): string[] => readdirSync(join(repoPath, 'runs'), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => `${entry.parentPath.slice(-64)}/${entry.name.slice(37, 37 + 64)}`)
        .sort();
      const every = [`${task}/${recorded}`, `${task}/${unwritten}`, `${lone}/${unwritten}`].sort();

      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: false, held: false });
      assert.deepStrictEqual(places(), every, 'beside running work, a run may be between its place and its record');
      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: true, held: true });
      assert.deepStrictEqual(places(), every, 'a dry run takes none');

      await store.gcSweepBackend(repoPath, new Set(), { minAge: 0, dryRun: false, held: true });
      assert.deepStrictEqual(places(), [`${task}/${recorded}`], 'the place of the run recorded stays');
      assert.deepStrictEqual(readdirSync(join(repoPath, 'runs')), [task], 'a task\'s index left empty goes');
      assert.deepStrictEqual((await storage.refs.executionListRuns(repoPath, task, { limit: 10 })).map(({ inputsHash }) => inputsHash), [recorded]);
    });
  });

  describe('without the directory the repositories are in', () => {
    it('runs gc\'s primitives, and refuses a repository\'s lifecycle, naming what it needs', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');
      const hash = await storage.objects.write(repoPath, new Uint8Array([1]));
      const alone = new LocalStorage().repos;

      assert.deepStrictEqual((await alone.gcScanObjects(repoPath)).objects.map((object) => object.hash), [hash]);
      const needs = { message: 'a repository\'s lifecycle needs the directory the repositories are in: give LocalStorage its reposDir' };
      await assert.rejects(alone.list(), needs);
      await assert.rejects(alone.create('other'), needs);
      await assert.rejects(alone.getMetadata('my-repo'), needs);
      await assert.rejects(alone.remove('my-repo'), needs);
    });
  });
});
