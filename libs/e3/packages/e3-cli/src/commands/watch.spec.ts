/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import { watchSaysInput } from './watch.js';

describe('watchSaysInput', () => {
  it('R68 — says an input a save resets or drops, and one it keeps because it feeds a load', () => {
    assert.equal(watchSaysInput({ input: 'inputs/erp_extract', action: variant('retained', { load: 'orders.erp' }) }), true);
    assert.equal(watchSaysInput({ input: 'inputs/rates', action: variant('reset', { reason: 'was set in the workspace', policy: true }) }), true);
    assert.equal(watchSaysInput({ input: 'inputs/gone', action: variant('drop', null) }), true);
    assert.equal(watchSaysInput({ input: 'inputs/note', action: variant('keep', null) }), false, 'one kept under keep-edited is not');
    assert.equal(watchSaysInput({ input: 'inputs/rates', action: variant('package', null) }), false);
  });
});
