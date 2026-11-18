/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { RACK_CALL_VALUE_OBJECTS, RACK_TRANSFERS_AT_ONCE, readRackHello, readRackReport } from './rack-json.js';

it('reads the features of a hello and of a report as the words they list, passing over an entry a later release names in another form', () => {
  const later = [RACK_CALL_VALUE_OBJECTS, { name: 'x', v: 2 }, 7, 'environments'];
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.109', features: later })),
    { protocol: 3, e3: '1.0.109', limits: { transfersAtOnce: RACK_TRANSFERS_AT_ONCE }, features: [RACK_CALL_VALUE_OBJECTS, 'environments'] });
  assert.deepEqual(readRackReport(JSON.stringify({ features: later })).features, [RACK_CALL_VALUE_OBJECTS, 'environments']);
  // None named is none taken
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.109' })).features, []);
  assert.deepEqual(readRackReport('{}').features, []);
});

it('refuses features that are not a list', () => {
  assert.throws(() => readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.109', features: 'call-value-objects' })), /^Error: the hello's features are not a list$/);
  assert.throws(() => readRackReport(JSON.stringify({ features: { resources: true } })), /^Error: the report's features are not a list$/);
});
