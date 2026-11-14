/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { RACK_REASON_CODES, describeRackReason, readRackReason, readRackRetries } from './task-envelope.js';

it('reads a result\'s reason for the fields it knows, keeps a code of a later release, and refuses what is not one', () => {
  assert.equal(readRackReason(undefined), undefined);
  assert.deepEqual(readRackReason({ code: 'outgrew-cap', capBytes: 3_328_599_654, peakBytes: 3_328_599_654, later: { anything: true } }),
    { code: 'outgrew-cap', capBytes: 3_328_599_654, peakBytes: 3_328_599_654 });
  assert.deepEqual(readRackReason({ code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' }), { code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' });
  // A code this build does not know is still a reason: a rack's fault it cannot name.
  assert.deepEqual(readRackReason({ code: 'thermal-shutdown', detail: 'node 3' }), { code: 'thermal-shutdown', detail: 'node 3' });
  assert.equal(readRackReason({ code: 'guest-crashed', detail: 'x'.repeat(2000) })!.detail!.length, 500, 'a run prints a line, not a log');
  for (const bad of ['because', null, [], {}, { code: 7 }, { code: 'Not A Code' }, { code: 'outgrew-cap', capBytes: -1 }, { code: 'outgrew-cap', peakBytes: 1.5 },
    { code: 'source-unreachable', ms: '120000' }, { code: 'guest-crashed', detail: 7 }]) {
    assert.throws(() => readRackReason(bad), /a reason/, JSON.stringify(bad));
  }
  assert.deepEqual([...RACK_REASON_CODES].sort(), ['guest-crashed', 'input-transfer-failed', 'memory-limit-exceeded', 'outgrew-cap', 'output-transfer-failed',
    'requeued-pressure', 'source-unreachable', 'task-error']);
});

it('says a reason as a run prints it: its code, and the words it carries', () => {
  assert.equal(describeRackReason({ code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' }), 'input-transfer-failed: connection reset');
  assert.equal(describeRackReason({ code: 'guest-crashed', detail: 'the VM exited 137' }), 'guest-crashed: the VM exited 137');
  assert.equal(describeRackReason({ code: 'task-error' }), 'task-error');
  assert.equal(describeRackReason({ code: 'outgrew-cap', capBytes: 1024, peakBytes: 1024 }), 'outgrew-cap', 'a size is for its reader to format');
});

it('reads the retries a result lists, and refuses a list that is not one', () => {
  assert.deepEqual(readRackRetries(undefined), []);
  const retry = { transfer: 'input', attempt: 2, of: 5, cause: 'connection reset' };
  assert.deepEqual(readRackRetries([retry, { ...retry, transfer: 'output', attempt: 3, later: true }]), [retry, { ...retry, transfer: 'output', attempt: 3 }]);
  for (const bad of ['twice', [7], [{ ...retry, transfer: 'sideways' }], [{ ...retry, attempt: 0 }], [{ ...retry, of: 1.5 }], [{ ...retry, cause: 7 }], Array.from({ length: 4097 }, () => retry)]) {
    assert.throws(() => readRackRetries(bad), /retr/);
  }
});
