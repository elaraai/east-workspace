/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { RACK_CALL_VALUE_OBJECTS, RACK_INLINE_OBJECT_DEFAULT, RACK_INLINE_OBJECT_MAX, RACK_TRANSFERS_AT_ONCE, readRackHello, readRackInlineMax, readRackReport } from './rack-json.js';

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

it('reads the largest object a storage request takes inline: what it names, at most the source\'s most, and what every request took before for one that names none or no size', () => {
  assert.equal(readRackInlineMax(null), RACK_INLINE_OBJECT_DEFAULT);
  assert.equal(readRackInlineMax('65536'), 65536);
  assert.equal(readRackInlineMax(' 1024 '), 1024);
  assert.equal(readRackInlineMax('0'), 0, 'a rack may take none inline');
  assert.equal(readRackInlineMax(String(64 * 1024 * 1024)), RACK_INLINE_OBJECT_MAX);
  for (const unread of ['', 'lots', '-1', '1.5', '1e6', '99999999999999999999']) assert.equal(readRackInlineMax(unread), RACK_INLINE_OBJECT_DEFAULT, unread);
  assert(RACK_INLINE_OBJECT_MAX > 5.7 * 1024, 'a typical segment rides the reply that asked for it');
  assert(RACK_TRANSFERS_AT_ONCE >= 32, 'a link of 35 ms and 15 MB/s holds half a MB in flight: some tens of transfers');
});
