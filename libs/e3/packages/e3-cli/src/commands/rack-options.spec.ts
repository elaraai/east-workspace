/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { rackPlacementLine } from './rack-options.js';

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
    free: { cores: 1, memoryBytes: 1024 ** 3, gpus: 0 } }), '  [RACK] train waiting: needs 4 GB, rack-a has 1 GB free');
  assert.equal(rackPlacementLine({ kind: 'waiting', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u', needs: { kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, gpu: false } }),
    '  [RACK] score waiting: needs 3 GB, rack-a has no free slot');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'no-rack-for-tier:py' }), '  [LOCAL] train (no-rack-for-tier:py)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'fallback:rack-unavailable' }), '  [LOCAL] train (fallback:rack-unavailable)');
});

it('prints nothing for work that was never a rack\'s, and of a unit only what went wrong on its rack', () => {
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'not-selected' }), undefined);
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
