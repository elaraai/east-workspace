/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Budget, LocalStorage, repoInit } from '@elaraai/e3-core';
import { commandPlacement, openCommandRack, rackAsked, rackEnvironmentLine, rackPlacementLine, unattachedLine } from './rack-options.js';

const task = { taskName: 'train', role: 'task' as const };
const unit = { taskName: 'score', role: 'unit' as const };

it('prints a line for a task a rack claims, a transfer retried, and a rack\'s work this machine runs after all', () => {
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'a' }), '  [RACK] train → rack-a');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'a', needs: { kind: 'task', cores: 8, memoryBytes: 16 * 1024 ** 3, gpu: false } }),
    '  [RACK] train → rack-a (cap 16 GB)');
  assert.equal(rackPlacementLine({ kind: 'outgrew', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'a', capBytes: 16 * 1024 ** 3 }),
    '  [RACK] train failed: memory-limit-exceeded (cap 16 GB); raise --memory-limit or --size');
  assert.equal(rackPlacementLine({ kind: 'outgrew', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u', capBytes: 3 * 1024 ** 3, againBytes: 4.5 * 1024 ** 3 }),
    '  [RACK] score outgrew its 3 GB cap on rack-a: runs again under 4.5 GB');
  assert.equal(rackPlacementLine({ kind: 'stopped', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u', peakBytes: 2 * 1024 ** 3, againBytes: 2 * 1024 ** 3 }),
    '  [RACK] score stopped on rack-a at 2 GB, its host short of memory: runs again reserving 2 GB');
  assert.equal(rackPlacementLine({ kind: 'retried', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'a', retry: { transfer: 'input', attempt: 2, of: 5, cause: 'connection reset' } }),
    '  [RACK] train input transfer retried (2 of 5): connection reset');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'fallback:input-transfer-failed: connection reset',
    detail: { code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' } }), '  [LOCAL] train (input-transfer-failed: connection reset)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'fallback:guest-crashed: the VM exited 137', detail: { code: 'guest-crashed', detail: 'the VM exited 137' } }),
    '  [LOCAL] train (guest-crashed: the VM exited 137)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'spill' }), '  [LOCAL] train (spill)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'no-rack-holds:gpu' }), '  [LOCAL] train (no-rack-holds:gpu)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'source-unreachable' }), '  [LOCAL] train (source-unreachable)');
  assert.equal(rackPlacementLine({ kind: 'waiting', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'a', needs: { kind: 'task', cores: 2, memoryBytes: 4 * 1024 ** 3, gpu: false },
    free: { cores: 1, memoryBytes: 1024 ** 3, gpus: 0 } }), '  [RACK] train waiting: needs 2 cores and 4 GB, rack-a has 1 core and 1 GB free');
  // What it waits for is what it reserves, not the cap it may grow to: here a core, not memory.
  assert.equal(rackPlacementLine({ kind: 'waiting', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u',
    needs: { kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, reserveBytes: 2 * 1024 ** 3, gpu: false }, free: { cores: 0, memoryBytes: 2.5 * 1024 ** 3, gpus: 0 } }),
  '  [RACK] score waiting: needs 1 core and 2 GB, rack-a has 0 cores and 2.5 GB free');
  assert.equal(rackPlacementLine({ kind: 'waiting', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'g', needs: { kind: 'task', cores: 4, memoryBytes: 8 * 1024 ** 3, gpu: true },
    free: { cores: 8, memoryBytes: 32 * 1024 ** 3, gpus: 0 } }), '  [RACK] train waiting: needs 4 cores, a GPU and 8 GB, rack-a has 8 cores, 0 GPUs and 32 GB free');
  assert.equal(rackPlacementLine({ kind: 'waiting', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u', needs: { kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, gpu: false } }),
    '  [RACK] score waiting: needs 1 core and 3 GB, rack-a has no free slot');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'no-rack-for-tier:py' }), '  [LOCAL] train (no-rack-for-tier:py)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'fallback:rack-unavailable' }), '  [LOCAL] train (fallback:rack-unavailable)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'environment:native-package:fastfit' }), '  [LOCAL] train (environment:native-package:fastfit)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'no-rack-for-environment:py' }), '  [LOCAL] train (no-rack-for-environment:py)');
});

it('prints a line when an environment\'s layers are built for a rack, and what the build came to', () => {
  const envHash = `3f9a2b1c0d4e${'0'.repeat(52)}`;
  assert.equal(rackEnvironmentLine({ kind: 'building', envHash, platform: 'x86_64-manylinux_2_28' }), '  [ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28: building');
  assert.equal(rackEnvironmentLine({ kind: 'built', envHash, platform: 'x86_64-manylinux_2_28', ms: 48_200, layers: 4, bytes: 2.1 * 1024 ** 3, fresh: 1 }),
    '  [ENV] 3f9a2b1c0d4e built in 48 s: 4 layers, 2.1 GB (1 new)');
  assert.equal(rackEnvironmentLine({ kind: 'built', envHash, platform: 'aarch64-apple-darwin', ms: 400, layers: 1, bytes: 2048, fresh: 0 }),
    '  [ENV] 3f9a2b1c0d4e built in 0 s: 1 layer, 2 KB (0 new)');
});

it('prints nothing for work that was never a rack\'s, and of a unit only what went wrong on its rack', () => {
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'not-selected' }), undefined);
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'gpu-not-east-py' }), undefined);
  // Split progress already describes a task's units as they run.
  assert.equal(rackPlacementLine({ kind: 'placed', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u' }), undefined);
  assert.equal(rackPlacementLine({ kind: 'placed', ...unit, where: 'local', reason: 'spill' }), undefined);
  assert.equal(rackPlacementLine({ kind: 'retried', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u', retry: { transfer: 'output', attempt: 3, of: 5, cause: 'HTTP 503' } }),
    '  [RACK] score output transfer retried (3 of 5): HTTP 503');
  assert.equal(rackPlacementLine({ kind: 'placed', ...unit, where: 'local', reason: 'fallback:guest-crashed: out of memory', detail: { code: 'guest-crashed', detail: 'out of memory' } }),
    '  [LOCAL] score (guest-crashed: out of memory)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...unit, where: 'local', reason: 'memory-limit-exceeded',
    detail: { code: 'memory-limit-exceeded', needsBytes: 3 * 1024 ** 3, limitBytes: 2 * 1024 ** 3 } }), '  [LOCAL] score (memory-limit-exceeded: needs 3 GB, limit 2 GB)');
});

it('says every reason work runs here to a command that names one piece of work, and when it opened no rack session', () => {
  const call = { taskName: 'fn:read_config', role: 'call' as const };
  const hostCoupled = { kind: 'placed', ...call, where: 'local', reason: 'host-coupled:fs_read_file' } as const;
  assert.equal(rackPlacementLine(hostCoupled), undefined, 'a dataflow run says nothing of work that was never a rack\'s');
  assert.equal(rackPlacementLine(hostCoupled, true), '  [LOCAL] fn:read_config (host-coupled:fs_read_file)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'gpu-not-east-py' }, true), '  [LOCAL] train (gpu-not-east-py)');
  assert.equal(rackPlacementLine({ kind: 'placed', taskName: 'fn:score', role: 'call', where: 'rack', rackLabel: 'rack-a', leaseId: 'c',
    needs: { kind: 'task', cores: 8, memoryBytes: 16 * 1024 ** 3, gpu: false } }, true), '  [RACK] fn:score → rack-a (cap 16 GB)');
  assert.equal(rackPlacementLine({ kind: 'outgrew', taskName: 'fn:score', role: 'call', where: 'rack', rackLabel: 'rack-a', leaseId: 'c', capBytes: 4 * 1024 ** 3 }, true),
    '  [RACK] fn:score failed: memory-limit-exceeded (cap 4 GB); raise --memory-limit or --size');
  // A split task's progress still tells of its units
  assert.equal(rackPlacementLine({ kind: 'placed', ...unit, where: 'local', reason: 'spill' }, true), undefined);

  const lines: string[] = [];
  const placement = commandPlacement((line) => lines.push(line));
  placement(hostCoupled);
  placement({ kind: 'placed', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u' });
  assert.deepEqual(lines, ['  [LOCAL] fn:read_config (host-coupled:fs_read_file)']);
});

it('says a command\'s work ran here with no rack session only of work that ran', () => {
  const unattached = { unattached: 'no rack hub is running' };
  assert.equal(unattachedLine(unattached, 'fn:score', true), '  [LOCAL] fn:score (no-rack-session: no rack hub is running)');
  assert.equal(unattachedLine(unattached, 'train', false), undefined, 'a run the cache answered ran nowhere');
  assert.equal(unattachedLine({}, 'train', true), undefined, 'a session\'s work is placed by its own lines');
});

it('takes a rack as asked for by --rack or --rack-only, and not by --no-rack or no flag, which leave it to the policy', () => {
  assert.equal(rackAsked({ rack: true }), true);
  assert.equal(rackAsked({ rackOnly: true }), true);
  assert.equal(rackAsked({ rack: false }), false);
  assert.equal(rackAsked({}), false);
});

it('throws a command\'s interrupt when it stopped the rack session\'s opening, so its work is never said to run here', async () => {
  const home = mkdtempSync(join(tmpdir(), 'e3-cli-rack-'));
  const rackHome = process.env.E3_RACK_HOME;
  process.env.E3_RACK_HOME = join(home, 'rack');
  try {
    const repoPath = join(home, 'repo');
    assert.ok(repoInit(repoPath).success);
    // Ctrl-C before the hub answered: the opening is given up before any hub
    // is asked or started
    const stop = new AbortController();
    stop.abort(new Error('interrupted'));
    const lines: string[] = [];
    await assert.rejects(() => openCommandRack({ repoPath, workspace: 'dev', storage: new LocalStorage(), label: 'e3 call score',
      budget: new Budget({ cores: 1, memory: 512 * 1024 ** 2 }, { sampler: null }), signal: stop.signal, print: (line) => { lines.push(line); } }), /^Error: interrupted$/);
    assert.deepEqual(lines, []);
  } finally {
    if (rackHome === undefined) delete process.env.E3_RACK_HOME; else process.env.E3_RACK_HOME = rackHome;
    rmSync(home, { recursive: true, force: true });
  }
});
