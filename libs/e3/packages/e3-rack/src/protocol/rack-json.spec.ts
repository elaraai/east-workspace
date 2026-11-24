/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { RACK_CALL_VALUE_OBJECTS, RACK_DATA_ORIGINS, RACK_DATA_ORIGINS_MAX, RACK_INLINE_OBJECT_DEFAULT, RACK_INLINE_OBJECT_MAX, RACK_SCOPES_ENDED_BYTES, RACK_SCOPES_ENDED_MAX, RACK_TRANSFERS_AT_ONCE, rackScopesEndedFitting,
  readRackHello, readRackInlineMax, readRackReport, readRackScopesEnded } from './rack-json.js';

it('reads the features of a hello and of a report as the words they list, passing over an entry a later release names in another form', () => {
  const later = [RACK_CALL_VALUE_OBJECTS, { name: 'x', v: 2 }, 7, 'environments'];
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.109', features: later })),
    { protocol: 3, e3: '1.0.109', limits: { transfersAtOnce: RACK_TRANSFERS_AT_ONCE }, features: [RACK_CALL_VALUE_OBJECTS, 'environments'] });
  assert.deepEqual(readRackReport(JSON.stringify({ features: later })).features, [RACK_CALL_VALUE_OBJECTS, 'environments']);
  // None named is none taken
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.109' })).features, []);
  assert.deepEqual(readRackReport('{}').features, []);
});

it('reads the data origins of a hello that names them: each an HTTP(S) origin, passing over any other entry, and none of a hello that does not name the feature', () => {
  const listed = ['https://relay.example:7421', 'https://relay.example:7441/', 'ftp://relay.example:7461', 'https://relay.example:7461/path',
    'https://user:secret@relay.example:7481', 7, null, 'not a url', 'https://relay.example:7421'];
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.116', features: [RACK_DATA_ORIGINS], dataOrigins: listed })).dataOrigins,
    ['https://relay.example:7421', 'https://relay.example:7441'], 'each as its origin, once');
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.116', dataOrigins: listed })).dataOrigins, undefined, 'a source that does not name the feature lists none');
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.116', features: [RACK_DATA_ORIGINS], dataOrigins: 'https://relay.example:7421' })).dataOrigins, undefined);
  const many = Array.from({ length: 40 }, (_, n) => `https://relay.example:${7500 + n}`);
  assert.deepEqual(readRackHello(JSON.stringify({ protocol: 3, e3: '1.0.116', features: [RACK_DATA_ORIGINS], dataOrigins: many })).dataOrigins, many.slice(0, RACK_DATA_ORIGINS_MAX));
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

it('names as many ended scopes in one answer as its header holds within its bound, well within what an HTTP client takes, and reads them back', () => {
  assert.ok(RACK_SCOPES_ENDED_BYTES <= 12 * 1024, 'within the 16 KiB of headers Node\'s HTTP client takes, with room for the rest');
  // Ids of a UUID's length: about 300 fit
  const uuids = Array.from({ length: 1000 }, (_, i) => `0193b1c2-7f00-7abc-8def-${i.toString(16).padStart(12, '0')}`);
  const told = rackScopesEndedFitting(uuids);
  assert.deepEqual(told, uuids.slice(0, told.length), 'the oldest first, in order');
  assert.ok(told.length >= 300 && told.length < 320, `${told.length}`);
  assert.ok(JSON.stringify(told).length <= RACK_SCOPES_ENDED_BYTES);
  assert.ok(JSON.stringify(uuids.slice(0, told.length + 1)).length > RACK_SCOPES_ENDED_BYTES, 'and no more than fit');
  assert.deepEqual(readRackScopesEnded(JSON.stringify(told)), told);
  // Ids of the longest a scope's may be, 64 characters, fit fewer; short ones stop at the most a reader takes
  assert.ok(JSON.stringify(rackScopesEndedFitting(Array.from({ length: 1000 }, (_, i) => `${i}`.padStart(64, 'a')))).length <= RACK_SCOPES_ENDED_BYTES);
  assert.equal(rackScopesEndedFitting(Array.from({ length: 5000 }, (_, i) => `${i}`)).length, RACK_SCOPES_ENDED_MAX);
  assert.deepEqual(rackScopesEndedFitting([]), []);
});
