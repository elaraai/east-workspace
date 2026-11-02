/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { inputPlanLine, remoteTaskStatus } from './workspace.js';

describe('inputPlanLine', () => {
  it('takes an input from its file when the deploy reads it', () => {
    assert.strictEqual(
      inputPlanLine({ input: 'inputs/note', action: variant('file', { path: '/d/note.beast2', taken: true }) }),
      'take input inputs/note from its file, /d/note.beast2',
    );
  });

  it('leaves one unset when the deploy reads no file', () => {
    assert.strictEqual(
      inputPlanLine({ input: 'inputs/note', action: variant('file', { path: '/d/note.beast2', taken: false }) }),
      'leave input inputs/note unset for its file, /d/note.beast2, which this deploy does not read',
    );
  });

  it('says why it resets one', () => {
    assert.strictEqual(
      inputPlanLine({ input: 'inputs/note', action: variant('reset', { reason: 'was set in the workspace', policy: true }) }),
      'reset input inputs/note: it was set in the workspace',
    );
  });
});

describe('remoteTaskStatus', () => {
  it('reads each status a server answers with what it holds', () => {
    const at = new Date('2026-10-27T01:02:03.000Z');
    assert.deepEqual(remoteTaskStatus(variant('up-to-date', { cached: true })), { type: 'up-to-date', cached: true });
    assert.deepEqual(remoteTaskStatus(variant('ready', null)), { type: 'ready' });
    assert.deepEqual(remoteTaskStatus(variant('waiting', { reason: 'Waiting on .inputs.a' })), { type: 'waiting', reason: 'Waiting on .inputs.a' });
    assert.deepEqual(remoteTaskStatus(variant('in-progress', { pid: some(42n), startedAt: some(at) })), { type: 'in-progress', pid: 42, startedAt: at });
    assert.deepEqual(remoteTaskStatus(variant('failed', { exitCode: 2n, completedAt: some(at) })), { type: 'failed', exitCode: 2, completedAt: at });
    assert.deepEqual(remoteTaskStatus(variant('error', { message: 'boom', completedAt: none })), { type: 'error', message: 'boom', completedAt: undefined });
    assert.deepEqual(remoteTaskStatus(variant('stale-running', { pid: none, startedAt: some(at) })), { type: 'stale-running', pid: undefined, startedAt: at });
  });
});
