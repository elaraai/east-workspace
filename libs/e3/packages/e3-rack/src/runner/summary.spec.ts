/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ranLocally, type RackPlacementEvent } from './rack-body.js';
import { RackTally, describeRackSummary } from './summary.js';

const task = { taskName: 'train', role: 'task' as const };
const unit = { taskName: 'score', role: 'unit' as const };
const retry = { transfer: 'input' as const, attempt: 2, of: 5, cause: 'connection reset' };

it('counts a run\'s placements into its summary, each run of a session on its own', () => {
  const tally = new RackTally();
  const events: RackPlacementEvent[] = [
    { kind: 'placed', ...task, where: 'rack', rackLabel: 'rack-a', leaseId: 'a' },
    ...Array.from({ length: 3 }, (_, n): RackPlacementEvent => ({ kind: 'placed', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: `u${n}` })),
    { kind: 'placed', ...unit, where: 'rack', rackLabel: 'rack-b', leaseId: 'b' },
    { kind: 'retried', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u0', retry },
    { kind: 'retried', ...unit, where: 'rack', rackLabel: 'rack-a', leaseId: 'u0', retry: { ...retry, attempt: 3 } },
    // A rack's work this machine ran after all, each way it can come to that.
    { kind: 'placed', ...unit, where: 'local', reason: 'fallback:input-transfer-failed: connection reset', detail: { code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' } },
    { kind: 'placed', ...task, where: 'local', reason: 'spill' },
    { kind: 'placed', ...task, where: 'local', reason: 'no-rack-for-tier:py' },
    { kind: 'placed', ...task, where: 'local', reason: 'fallback:rack-unavailable' },
    // Work that was never a rack's is not counted.
    { kind: 'placed', ...task, where: 'local', reason: 'not-selected' },
    { kind: 'placed', ...task, where: 'local', reason: 'hub-unreachable' },
  ];
  for (const event of events) tally.add(event);
  assert.deepEqual(events.map(ranLocally), [false, false, false, false, false, false, false, true, true, true, true, false, false]);
  const summary = tally.take();
  assert.deepEqual(summary, { placed: [{ rackLabel: 'rack-a', tasks: 1, units: 3 }, { rackLabel: 'rack-b', tasks: 0, units: 1 }], transfersRetried: 2, ranLocally: 4 });
  assert.equal(describeRackSummary(summary), 'Rack summary: 1 task and 3 units on rack-a · 1 unit on rack-b · 2 transfers retried · 4 ran locally');
  // The next run of the same session starts from nothing.
  assert.deepEqual(tally.take(), { placed: [], transfersRetried: 0, ranLocally: 0 });
});

it('says nothing of a run none of whose work went to a rack or came back from one', () => {
  assert.equal(describeRackSummary({ placed: [], transfersRetried: 0, ranLocally: 0 }), undefined);
  assert.equal(describeRackSummary({ placed: [], transfersRetried: 0, ranLocally: 2 }), 'Rack summary: nothing ran on a rack · 0 transfers retried · 2 ran locally');
  assert.equal(describeRackSummary({ placed: [{ rackLabel: 'rack-a', tasks: 2, units: 0 }], transfersRetried: 1, ranLocally: 0 }), 'Rack summary: 2 tasks on rack-a · 1 transfer retried · 0 ran locally');
});
