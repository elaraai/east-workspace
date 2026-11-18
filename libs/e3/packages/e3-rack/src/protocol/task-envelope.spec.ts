/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { RACK_REASON_CODES, describeRackReason, leaseFits, leaseFitsRack, leaseReserve, readRackLeaseResources, readRackReason, readRackRetries } from './task-envelope.js';
import { readRackWaiting } from './rack-json.js';

it('reads a result\'s reason for the fields it knows, keeps a code of a later release, and leaves out what it cannot read, refusing nothing', () => {
  assert.equal(readRackReason(undefined), undefined);
  assert.deepEqual(readRackReason({ code: 'outgrew-cap', capBytes: 3_328_599_654, peakBytes: 3_328_599_654, later: { anything: true } }),
    { code: 'outgrew-cap', capBytes: 3_328_599_654, peakBytes: 3_328_599_654 });
  assert.deepEqual(readRackReason({ code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' }), { code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' });
  // A code this build does not know is still a reason: a rack's fault it cannot name.
  assert.deepEqual(readRackReason({ code: 'thermal-shutdown', detail: 'node 3' }), { code: 'thermal-shutdown', detail: 'node 3' });
  assert.equal(readRackReason({ code: 'guest-crashed', detail: 'x'.repeat(2000) })!.detail!.length, 500, 'a run prints a line, not a log');
  // No code this build can print: no reason.
  for (const none of ['because', null, [], {}, { code: 7 }, { code: 'Not A Code' }, { code: 'task_error' }]) {
    assert.equal(readRackReason(none), undefined, JSON.stringify(none));
  }
  // A field of another kind is left out, and the reason kept.
  assert.deepEqual(readRackReason({ code: 'outgrew-cap', capBytes: -1, peakBytes: 1.5 }), { code: 'outgrew-cap' });
  assert.deepEqual(readRackReason({ code: 'source-unreachable', ms: '120000' }), { code: 'source-unreachable' });
  assert.deepEqual(readRackReason({ code: 'guest-crashed', detail: 7, cause: 'its VM exited' }), { code: 'guest-crashed', cause: 'its VM exited' });
  assert.deepEqual([...RACK_REASON_CODES].sort(), ['environment-failed', 'guest-boot-failed', 'guest-crashed', 'input-transfer-failed', 'memory-limit-exceeded', 'no-room',
    'outgrew-cap', 'output-transfer-failed', 'rack-failed', 'rack-stopping', 'requeued-pressure', 'source-unreachable', 'task-error', 'tier-image-failed', 'work-disk-full']);
  // Each is a word a reason's reader keeps, and a code it does not know is kept as it is read
  for (const code of [...RACK_REASON_CODES, 'a-later-release-s-word']) assert.deepEqual(readRackReason({ code, detail: 'why' }), { code, detail: 'why' });
});

it('says a reason as a run prints it: its code, and the words it carries', () => {
  assert.equal(describeRackReason({ code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' }), 'input-transfer-failed: connection reset');
  assert.equal(describeRackReason({ code: 'guest-crashed', detail: 'the VM exited 137' }), 'guest-crashed: the VM exited 137');
  assert.equal(describeRackReason({ code: 'task-error' }), 'task-error');
  assert.equal(describeRackReason({ code: 'outgrew-cap', capBytes: 1024, peakBytes: 1024 }), 'outgrew-cap', 'a size is for its reader to format');
});

it('reads the retries a result lists, keeps a kind of transfer a later release names, and leaves out a retry it cannot read, refusing nothing', () => {
  assert.deepEqual(readRackRetries(undefined), []);
  const retry = { transfer: 'input', attempt: 2, of: 5, cause: 'connection reset' };
  assert.deepEqual(readRackRetries([retry, { ...retry, transfer: 'output', attempt: 3, later: true }]), [retry, { ...retry, transfer: 'output', attempt: 3 }]);
  assert.deepEqual(readRackRetries([{ ...retry, transfer: 'layer' }]), [{ ...retry, transfer: 'layer' }], 'a kind a later release names');
  assert.deepEqual(readRackRetries('twice'), []);
  assert.deepEqual(readRackRetries([7, { ...retry, transfer: 'Sideways' }, { ...retry, attempt: 0 }, { ...retry, of: 1.5 }, { ...retry, cause: 7 }, retry]), [retry],
    'each retry it cannot read is left out, and the rest kept');
  assert.equal(readRackRetries(Array.from({ length: 5000 }, () => retry)).length, 4096, 'at most what a lease\'s transfers make');
});

it('reads what a lease asks of a rack, and whether a rack\'s offer holds it', () => {
  const unit = { kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, gpu: false } as const;
  assert.equal(readRackLeaseResources(undefined), undefined, 'a source that does not size its leases names none');
  assert.deepEqual(readRackLeaseResources({ ...unit, later: true }), unit);
  for (const bad of ['large', null, { ...unit, kind: 'piece' }, { ...unit, cores: 0 }, { ...unit, memoryBytes: 1.5 }, { ...unit, memoryBytes: -1 }, { ...unit, gpu: 1 }]) {
    assert.throws(() => readRackLeaseResources(bad), /a lease/, JSON.stringify(bad));
  }
  assert.equal(leaseFits(unit, { cores: 1, memoryBytes: 3 * 1024 ** 3, gpus: 0 }), true, 'exactly what is offered fits');
  // A lease that reserves less than its cap fits an offer of its reservation, and a rack only whose whole memory holds its cap.
  const reserving = { ...unit, reserveBytes: 2 * 1024 ** 3 };
  assert.equal(leaseFits(reserving, { cores: 1, memoryBytes: 2 * 1024 ** 3, gpus: 0 }), true, 'an offer of its reservation');
  assert.equal(leaseFits(reserving, { cores: 1, memoryBytes: 2 * 1024 ** 3 - 1, gpus: 0 }), false, 'a byte short of its reservation');
  assert.equal(leaseFitsRack(reserving, { cores: 1, memoryBytes: 2 * 1024 ** 3, gpus: 0 }), false, 'a rack whose memory is short of its cap');
  assert.equal(leaseFitsRack(reserving, { cores: 1, memoryBytes: 3 * 1024 ** 3, gpus: 0 }), true);
  assert.equal(leaseReserve(reserving), 2 * 1024 ** 3);
  assert.equal(leaseReserve(unit), 3 * 1024 ** 3, 'a lease that reserves nothing less reserves its cap');
  assert.deepEqual(readRackLeaseResources({ ...reserving, later: true }), reserving);
  for (const bad of [0, 1.5, -1, 3 * 1024 ** 3 + 1, '1']) {
    assert.throws(() => readRackLeaseResources({ ...unit, reserveBytes: bad }), /a lease reserves a whole number of bytes/, String(bad));
  }
  assert.equal(leaseFits(unit, { cores: 0, memoryBytes: 2 ** 40, gpus: 4 }), false, 'no core');
  assert.equal(leaseFits(unit, { cores: 8, memoryBytes: 3 * 1024 ** 3 - 1, gpus: 0 }), false, 'a byte short of its cap');
  assert.equal(leaseFits({ ...unit, gpu: true }, { cores: 8, memoryBytes: 2 ** 40, gpus: 0 }), false, 'no GPU');
  assert.equal(leaseFits({ ...unit, gpu: true }, { cores: 8, memoryBytes: 2 ** 40, gpus: 1 }), true);
  assert.deepEqual(readRackWaiting('{"cores":1,"memoryBytes":34359738368,"gpus":0,"ms":12000,"later":1}'), { cores: 1, memoryBytes: 34359738368, gpus: 0, ms: 12000 });
  assert.equal(readRackWaiting(null), undefined);
  assert.equal(readRackWaiting('not json'), undefined);
});
