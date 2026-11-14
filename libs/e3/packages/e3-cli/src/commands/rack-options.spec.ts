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
  assert.equal(rackPlacementLine({ kind: 'retried', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'a', retry: { transfer: 'input', attempt: 2, of: 5, cause: 'connection reset' } }),
    '  [RACK] train input transfer retried (2 of 5): connection reset');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'fallback:input-transfer-failed: connection reset',
    detail: { code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' } }), '  [LOCAL] train (input-transfer-failed: connection reset)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'fallback:guest-crashed: the VM exited 137', detail: { code: 'guest-crashed', detail: 'the VM exited 137' } }),
    '  [LOCAL] train (guest-crashed: the VM exited 137)');
  assert.equal(rackPlacementLine({ kind: 'placed', ...task, where: 'local', reason: 'spill' }), '  [LOCAL] train (spill)');
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
});
