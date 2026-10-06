/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import { inputPlanLine } from './workspace.js';

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
