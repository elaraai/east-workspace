/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for LocalLockService - workspace locking mechanism
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { variant, encodeBeast2For, printFor, VariantType } from '@elaraai/east';
import { LockStateType, ProcessHolderType, type LockState } from '@elaraai/e3-types';
import {
  acquireWorkspaceLock,
  getWorkspaceLockHolder,
  workspaceLockPath,
  EMPTY_LOCK_GRACE_MS,
} from './LocalLockService.js';
import { WorkspaceLockError } from '../../errors.js';

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
    it('returns correct path', () => {
      const lockPath = workspaceLockPath('/repo', 'myws');
      // workspaceLockPath uses path.join (OS separator); normalize before
      // comparing so the assertion holds on Windows too.
      assert.strictEqual(lockPath.replace(/\\/g, '/'), '/repo/workspaces/myws.lock');
    });
  });

  describe('acquireWorkspaceLock', () => {
    it('acquires lock on unlocked workspace', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      assert.strictEqual(lock.workspace, 'test-ws');
      assert.ok(lock.lockPath.endsWith('test-ws.lock'));
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

    it('removes lock file on release', async () => {
      const lock = await acquireWorkspaceLock(repoPath, 'test-ws', variant('dataflow', null));
      const lockPath = workspaceLockPath(repoPath, 'test-ws');

      // Lock file should exist
      await fs.access(lockPath);

      await lock.release();

      // Lock file should be gone
      await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
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

      // Create holder as East text string
      const HolderVariantType = VariantType({ process: ProcessHolderType });
      const printHolder = printFor(HolderVariantType);
      const holderString = printHolder(variant('process', {
        pid: 99999999n, // Very unlikely to exist
        bootId: 'fake-boot-id',
        startTime: 0n,
        command: 'fake command',
      }));

      const fakeLockState: LockState = {
        operation: variant('dataflow', null),
        holder: holderString,
        acquiredAt: new Date(),
        expiresAt: variant('none', null),
      };
      const encoder = encodeBeast2For(LockStateType);
      await fs.writeFile(lockPath, encoder(fakeLockState));

      // getWorkspaceLockHolder should detect this as stale and clean up
      const holder = await getWorkspaceLockHolder(repoPath, 'test-ws');
      assert.strictEqual(holder, null);

      // Lock file should be cleaned up
      await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
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
      await fs.writeFile(lockPath, '');               // empty, fresh mtime
      await assert.rejects(
        acquireWorkspaceLock(repoPath, 'ws-fresh-empty', variant('dataflow', null), { wait: false }),
        WorkspaceLockError,
      );
      await fs.access(lockPath);                        // still there — not stolen
    });

    it('DOES reclaim an empty lock older than the grace (crashed-mid-create remnant)', async () => {
      const lockPath = workspaceLockPath(repoPath, 'ws-stale-empty');
      await fs.writeFile(lockPath, '');
      const old = new Date(Date.now() - EMPTY_LOCK_GRACE_MS - 5_000);
      await fs.utimes(lockPath, old, old);             // backdate past the grace
      const lock = await acquireWorkspaceLock(repoPath, 'ws-stale-empty', variant('dataflow', null), { wait: false });
      assert.ok(lock.lockPath.endsWith('ws-stale-empty.lock'));
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
  });
});
