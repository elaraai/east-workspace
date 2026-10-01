/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for LocalLockService - workspace locking mechanism
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import { syncBuiltinESMExports } from 'module';
import * as path from 'path';
import * as os from 'os';
import { variant, encodeBeast2For, none } from '@elaraai/east';
import { LockStateType, type LockState } from '@elaraai/e3-types';
import {
  LocalLockService,
  acquireWorkspaceLock,
  getWorkspaceLockHolder,
  isLockHolderAlive,
  workspaceLockPath,
  EMPTY_LOCK_GRACE_MS,
} from './LocalLockService.js';
import { InvalidNameError, WorkspaceLockError } from '../../errors.js';

describe('LocalLockService', () => {
  let testDir: string;
  let repoPath: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e3-lock-test-'));
    repoPath = path.join(testDir, 'repo');
    await fs.mkdir(path.join(repoPath, 'workspaces'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('workspaceLockPath', () => {
    it('keeps a resource\'s exclusive lock in its own directory under locks/', () => {
      const lockPath = workspaceLockPath('/repo', 'myws');
      // workspaceLockPath uses path.join (OS separator); normalize before
      // comparing so the assertion holds on Windows too.
      assert.strictEqual(lockPath.replace(/\\/g, '/'), '/repo/locks/myws/exclusive.beast2');
    });

    it('refuses a resource that is no one path segment', () => {
      assert.throws(() => workspaceLockPath('/repo', '../elsewhere'), InvalidNameError);
      assert.throws(() => workspaceLockPath('/repo', '..'), InvalidNameError);
    });
  });

  describe('acquireWorkspaceLock', () => {
    it('acquires lock on unlocked workspace', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      assert.strictEqual(lock.workspace, 'test-ws');
      assert.strictEqual(lock.lockPath, workspaceLockPath(repoPath, 'test-ws'));
      await lock.release();
    });

    it('creates lock file with metadata', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));

      // Use getWorkspaceLockHolder to read the metadata (it handles beast2 format)
      const holder = await getWorkspaceLockHolder(repoPath, 'test-ws');
      assert.ok(holder);
      assert.strictEqual(holder!.pid, process.pid);
      assert.ok(holder!.bootId);
      assert.ok(holder!.acquiredAt);
      assert.ok(holder!.command);
      assert.strictEqual(holder!.operation, 'dataflow');

      await lock.release();
    });

    it('removes the lock file, and its resource\'s directory, on release', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      const lockPath = workspaceLockPath(repoPath, 'test-ws');

      // Lock file should exist
      await fs.access(lockPath);

      await lock.release();

      // Lock file should be gone, and the directory with it
      await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
      await assert.rejects(fs.access(path.dirname(lockPath)), { code: 'ENOENT' });
    });

    it('makes its resource\'s directory again when a release removes it while it is made', async () => {
      // A recursive mkdir that finds the directory there checks it with a
      // stat, and fails ENOENT when a release removes the directory between
      // the two. Each acquirer below meets that once.
      const fsPromises = process.getBuiltinModule('node:fs/promises');
      const mkdir = fsPromises.mkdir;
      const raced = new Set<string>();
      const mocked = mock.method(fsPromises, 'mkdir', async (dir: string, options: { recursive: true }) => {
        if (!raced.has(dir)) {
          raced.add(dir);
          throw Object.assign(new Error(`ENOENT: no such file or directory, mkdir '${dir}'`), { code: 'ENOENT', syscall: 'mkdir', path: dir });
        }
        return mkdir(dir, options);
      });
      syncBuiltinESMExports();
      try {
        const exclusive = await acquireWorkspaceLock(repoPath, 'ws-remade', variant('deployment', null));
        await exclusive.release();
        const shared = await acquireWorkspaceLock(repoPath, 'ws-remade-shared', variant('dataset_write', null), { mode: 'shared' });
        await shared.release();
      } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
      }
      assert.strictEqual(raced.size, 2);
    });

    it('waits out a release removing its resource\'s directory, which Windows refuses to make or write in meanwhile', async () => {
      // While a release removes a resource's directory, Windows refuses to
      // make it, or anything in it, until it is gone: EPERM, at the mkdir or
      // at a file's open, more often while another acquirer lists it. The
      // race is narrow, so the refusal is made here: the exclusive acquirer
      // meets it at its file's write, the shared one at the making.
      const fsPromises = process.getBuiltinModule('node:fs/promises');
      const { mkdir, writeFile } = fsPromises;
      const met: string[] = [];
      const refuse = (syscall: string, target: string) => {
        met.push(syscall);
        return Object.assign(new Error(`EPERM: operation not permitted, ${syscall} '${target}'`), { code: 'EPERM', syscall, path: target });
      };
      const mockedMkdir = mock.method(fsPromises, 'mkdir', async (dir: string, options: { recursive: true }) => {
        if (path.basename(dir) === 'ws-removing-shared' && !met.includes('mkdir')) throw refuse('mkdir', dir);
        return mkdir(dir, options);
      });
      const mockedWriteFile = mock.method(fsPromises, 'writeFile', async (file: string, data: Uint8Array) => {
        if (path.basename(path.dirname(file)) === 'ws-removing' && !met.includes('open')) throw refuse('open', file);
        return writeFile(file, data);
      });
      syncBuiltinESMExports();
      try {
        const exclusive = await acquireWorkspaceLock(repoPath, 'ws-removing', variant('deployment', null));
        await exclusive.release();
        const shared = await acquireWorkspaceLock(repoPath, 'ws-removing-shared', variant('dataset_write', null), { mode: 'shared' });
        await shared.release();
      } finally {
        mockedMkdir.mock.restore();
        mockedWriteFile.mock.restore();
        syncBuiltinESMExports();
      }
      assert.deepStrictEqual(met, ['open', 'mkdir']);
    });

    it('makes its resource\'s directory again when macOS reports a create in it, just removed, as EINVAL', async () => {
      // A release removes the directory once its last lock has gone; a create
      // in it a moment later fails ENOENT on Linux and EINVAL on macOS, as a
      // probe on GitHub's macOS runners found for two shared acquirers side by
      // side. The exclusive and the shared acquirer below each meet it once.
      const fsPromises = process.getBuiltinModule('node:fs/promises');
      const writeFile = fsPromises.writeFile;
      const raced = new Set<string>();
      const mocked = mock.method(fsPromises, 'writeFile', async (file: string, data: Uint8Array | string) => {
        const dir = path.dirname(file);
        if ((path.basename(dir) === 'ws-gone' || path.basename(dir) === 'ws-gone-shared') && !raced.has(dir)) {
          raced.add(dir);
          throw Object.assign(new Error(`EINVAL: invalid argument, open '${file}'`), { code: 'EINVAL', syscall: 'open', path: file });
        }
        return writeFile(file, data);
      });
      syncBuiltinESMExports();
      try {
        const exclusive = await acquireWorkspaceLock(repoPath, 'ws-gone', variant('deployment', null));
        await exclusive.release();
        const shared = await acquireWorkspaceLock(repoPath, 'ws-gone-shared', variant('dataset_write', null), { mode: 'shared' });
        await shared.release();
      } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
      }
      assert.strictEqual(raced.size, 2);
    });

    it('still fails a create refused every time, once its waits are spent', async () => {
      // A permission error looks the same as a removal in progress, so it
      // surfaces after the waits, never hangs.
      const fsPromises = process.getBuiltinModule('node:fs/promises');
      const writeFile = fsPromises.writeFile;
      let creates = 0;
      const mocked = mock.method(fsPromises, 'writeFile', async (file: string, data: Uint8Array | string) => {
        if (path.basename(path.dirname(file)) === 'ws-denied') {
          creates++;
          throw Object.assign(new Error(`EPERM: operation not permitted, open '${file}'`), { code: 'EPERM', syscall: 'open', path: file });
        }
        return writeFile(file, data);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(acquireWorkspaceLock(repoPath, 'ws-denied', variant('deployment', null)), { code: 'EPERM' });
      } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
      }
      assert.strictEqual(creates, 25);
    });

    it('leaves a refused rename to its own retries, never waiting it out again', async () => {
      // A shared lock is written whole by a rename once its .partial is in the
      // directory, which then cannot be removed: only the making and the create
      // are waited out, so the rename's retries are not multiplied.
      const fsPromises = process.getBuiltinModule('node:fs/promises');
      const rename = fsPromises.rename;
      let renames = 0;
      const mocked = mock.method(fsPromises, 'rename', async (from: string, to: string) => {
        if (path.basename(path.dirname(to)) === 'ws-rename-refused') {
          renames++;
          throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
        }
        return rename(from, to);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          acquireWorkspaceLock(repoPath, 'ws-rename-refused', variant('dataset_write', null), { mode: 'shared' }),
          { code: 'EPERM', syscall: 'rename' },
        );
      } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
      }
      assert.strictEqual(renames, 25);
    });

    it('counts only its own resource\'s shared holders, not those of a resource its name begins', async () => {
      const shared = await acquireWorkspaceLock(repoPath, 'a.b', variant('dataflow', null), { mode: 'shared' });
      try {
        const exclusive = await acquireWorkspaceLock(repoPath, 'a', variant('deployment', null));
        await exclusive.release();
      } finally {
        await shared.release();
      }
    });

    it('refuses a resource that is no one path segment', async () => {
      await assert.rejects(acquireWorkspaceLock(repoPath, '../elsewhere', variant('dataflow', null)), InvalidNameError);
    });

    it('release is idempotent', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      await lock.release();
      await lock.release(); // Should not throw
      await lock.release(); // Should not throw
    });

    it('throws WorkspaceLockError when already locked', async () => {
      const lock1 = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));

      try {
        await assert.rejects(
          acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null)),
          (err: Error) => {
            assert.ok(err instanceof WorkspaceLockError);
            assert.strictEqual((err as WorkspaceLockError).workspace, 'test-ws');
            // Should have holder info since we wrote metadata
            const holder = (err as WorkspaceLockError).holder;
            assert.ok(holder);
            assert.strictEqual(holder!.pid, process.pid);
            return true;
          }
        );
      } finally {
        await lock1.release();
      }
    });

    it('allows acquiring lock after release', async () => {
      const lock1 = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      await lock1.release();

      const lock2 = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      assert.ok(lock2);
      await lock2.release();
    });

    it('allows different workspaces to be locked independently', async () => {
      const lock1 = await acquireWorkspaceLock(repoPath, 'ws1', variant('dataflow', null));
      const lock2 = await acquireWorkspaceLock(repoPath, 'ws2', variant('dataflow', null));

      assert.strictEqual(lock1.workspace, 'ws1');
      assert.strictEqual(lock2.workspace, 'ws2');

      await lock1.release();
      await lock2.release();
    });
  });

  describe('LocalLockService.acquire', () => {
    it('gives null for a lock another holder has, and throws any other error as it is', async () => {
      const service = new LocalLockService();
      const held = await service.acquire(repoPath, 'svc-held', variant('dataflow', null));
      assert.ok(held !== null);
      try {
        assert.strictEqual(await service.acquire(repoPath, 'svc-held', variant('dataflow', null)), null, 'held elsewhere');
      } finally {
        await held.release();
      }
      // A filesystem error is no holder: it is thrown, never reported as the
      // lock being held elsewhere, which once named "a garbage collection or an
      // upgrade" for a create macOS refused.
      const fsPromises = process.getBuiltinModule('node:fs/promises');
      const writeFile = fsPromises.writeFile;
      const mocked = mock.method(fsPromises, 'writeFile', async (file: string, data: Uint8Array | string) => {
        if (path.basename(path.dirname(file)) === 'svc-full') {
          throw Object.assign(new Error(`ENOSPC: no space left on device, open '${file}'`), { code: 'ENOSPC', syscall: 'open', path: file });
        }
        return writeFile(file, data);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(service.acquire(repoPath, 'svc-full', variant('dataflow', null), { mode: 'shared' }), { code: 'ENOSPC' });
      } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
      }
      await assert.rejects(service.acquire(repoPath, '../elsewhere', variant('dataflow', null)), InvalidNameError);
    });
  });

  describe('getWorkspaceLockHolder', () => {
    it('returns null for unlocked workspace', async () => {
      const holder = await getWorkspaceLockHolder(repoPath, 'test-ws');
      assert.strictEqual(holder, null);
    });

    it('returns holder info for locked workspace', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));

      const holder = await getWorkspaceLockHolder(repoPath, 'test-ws');
      assert.ok(holder);
      assert.strictEqual(holder!.pid, process.pid);
      assert.ok(holder!.acquiredAt);

      await lock.release();
    });

    it('returns null after lock is released', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      await lock.release();

      const holder = await getWorkspaceLockHolder(repoPath, 'test-ws');
      assert.strictEqual(holder, null);
    });

    it('cleans up stale lock with dead PID', async () => {
      // Write a fake lock file in beast2 format with a non-existent PID
      const lockPath = workspaceLockPath(repoPath, 'test-ws');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });

      const fakeLockState: LockState = {
        operation: variant('dataflow', null),
        holder: variant('process', {
          pid: 99999999n, // Very unlikely to exist
          bootId: 'fake-boot-id',
          startTime: 0n,
          command: 'fake command',
        }),
        acquiredAt: new Date(),
        expiresAt: none,
      };
      await fs.writeFile(lockPath, encodeBeast2For(LockStateType)(fakeLockState));

      // getWorkspaceLockHolder should detect this as stale and clean up
      const holder = await getWorkspaceLockHolder(repoPath, 'test-ws');
      assert.strictEqual(holder, null);

      // Lock file should be cleaned up
      await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
    });

    it('takes a cloud function\'s holder for alive, which its lease bounds instead', async () => {
      assert.strictEqual(await isLockHolderAlive(variant('lambda', { requestId: 'r-1', functionName: 'e3-dataflow' })), true);
    });
  });

  // Regression guard for the Windows-only lost-update flake (records.spec.ts:217
  // "N concurrent increments"). An exclusive lock is created atomically *with its
  // holder bytes*, so it is never observed empty and a concurrent acquirer can
  // never steal it mid-creation (which previously admitted a second holder and
  // clobbered a record commit). These exercise that guarantee deterministically,
  // on every platform — not probabilistically like the K=8 record test.
  describe('exclusive lock atomicity', () => {
    it('a held exclusive lock file already contains holder bytes (never empty)', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'ws-content', variant('dataflow', null));
      try {
        const bytes = await fs.readFile(lock.lockPath);
        assert.ok(bytes.length > 0, 'lock file must be non-empty the instant it exists');
        const holder = await getWorkspaceLockHolder(repoPath, 'ws-content');
        assert.ok(holder && holder.pid === process.pid);
      } finally {
        await lock.release();
      }
    });

    it('does NOT reclaim a freshly-created empty lock (no mid-creation steal)', async () => {
      const lockPath = workspaceLockPath(repoPath, 'ws-fresh-empty');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, '');               // empty, fresh mtime
      await assert.rejects(
        acquireWorkspaceLock(repoPath, 'ws-fresh-empty', variant('dataflow', null), { wait: false }),
        WorkspaceLockError,
      );
      await fs.access(lockPath);                        // still there — not stolen
    });

    it('DOES reclaim an empty lock older than the grace (crashed-mid-create remnant)', async () => {
      const lockPath = workspaceLockPath(repoPath, 'ws-stale-empty');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, '');
      const old = new Date(Date.now() - EMPTY_LOCK_GRACE_MS - 5_000);
      await fs.utimes(lockPath, old, old);             // backdate past the grace
      const lock = await acquireWorkspaceLock(repoPath, 'ws-stale-empty', variant('dataflow', null), { wait: false });
      assert.strictEqual(lock.lockPath, lockPath);
      await lock.release();
    });

    it('concurrent exclusive acquirers are mutually exclusive — no double-hold', async () => {
      const N = 8;
      let held = false;
      let concurrent = 0;
      let maxConcurrent = 0;
      let committed = 0;
      await Promise.all(Array.from({ length: N }, () => (async () => {
        const lock = await acquireWorkspaceLock(repoPath, 'ws-cas', variant('dataflow', null), { wait: true, timeout: 30_000 });
        try {
          assert.strictEqual(held, false, 'two holders in the critical section at once');
          held = true;
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise(r => setTimeout(r, 5));    // hold briefly so any racer would overlap
          committed += 1;
          concurrent -= 1;
          held = false;
        } finally {
          await lock.release();
        }
      })()));
      assert.strictEqual(committed, N, 'every acquirer ran its critical section');
      assert.strictEqual(maxConcurrent, 1, 'mutual exclusion held throughout');
    });

    it('an exclusive and a shared acquirer started together are never both granted', async () => {
      // The exclusive side checks for shared holders, then creates its file;
      // the shared side writes its file, then checks for an exclusive holder.
      // Started together, the shared side can write between the exclusive
      // side's check and its create, and re-check before that create lands:
      // a deploy beside a mutation, gc beside a record write.
      for (let i = 0; i < 200; i++) {
        const resource = `ws-both-${i}`;
        const outcomes = await Promise.allSettled([
          acquireWorkspaceLock(repoPath, resource, variant('deployment', null)),
          acquireWorkspaceLock(repoPath, resource, variant('dataset_write', null), { mode: 'shared' }),
        ]);
        const granted = outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
        for (const lock of granted) await lock.release();
        assert.ok(granted.length <= 1, `attempt ${i}: the exclusive and the shared lock were both granted`);
      }
    });
  });
});
