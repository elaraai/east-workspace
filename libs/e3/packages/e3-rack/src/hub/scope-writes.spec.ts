/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE_HOLDERS_MAX, SCOPE_WRITES_MAX, ScopeWrites } from './scope-writes.js';

it('names the rack that last wrote each object of a scope, and the racks that hold any of what a lease reads', () => {
  const writes = new ScopeWrites();
  writes.wrote('s1', 'rack-1', ['a', 'b']);
  writes.wrote('s1', 'rack-2', ['c']);
  writes.wrote('s2', 'rack-2', ['a']);
  assert.equal(writes.writer('s1', 'a'), 'rack-1');
  assert.equal(writes.writer('s2', 'a'), 'rack-2', 'each scope\'s own');
  assert.equal(writes.writer('s1', 'z'), undefined);
  assert.deepEqual([...writes.writersOf('s1', ['z', 'c', 'a', 'b'])], ['rack-2', 'rack-1']);
  // Written again elsewhere: the latest rack holds it for the scope's next lease
  writes.wrote('s1', 'rack-2', ['a']);
  assert.equal(writes.writer('s1', 'a'), 'rack-2');
});

it('lets go of a scope\'s objects as it ends, and of a rack\'s as it is removed', () => {
  const writes = new ScopeWrites();
  writes.wrote('s1', 'rack-1', ['a']);
  writes.wrote('s2', 'rack-1', ['b']);
  writes.wrote('s2', 'rack-2', ['c']);
  writes.end('s1');
  assert.equal(writes.writer('s1', 'a'), undefined);
  assert.equal(writes.writer('s2', 'b'), 'rack-1', 'another scope keeps its own');
  writes.forget('rack-1');
  assert.equal(writes.writer('s2', 'b'), undefined);
  assert.equal(writes.writer('s2', 'c'), 'rack-2');
  assert.equal(writes.size, 1);
  writes.end('s2');
  assert.equal(writes.size, 0);
});

it('keeps at most its bound of objects, of every scope, the least recently written going first', () => {
  assert.equal(SCOPE_WRITES_MAX, 200_000);
  const writes = new ScopeWrites(3);
  writes.wrote('s1', 'rack-1', ['a', 'b']);
  writes.wrote('s2', 'rack-1', ['c']);
  writes.wrote('s1', 'rack-1', ['a']);
  writes.wrote('s2', 'rack-2', ['d']);
  assert.equal(writes.size, 3);
  assert.equal(writes.writer('s1', 'b'), undefined, 'the least recently written went');
  assert.equal(writes.writer('s1', 'a'), 'rack-1', 'written again, it stayed');
  // A scope whose objects all went still notes what it writes next, and ends whole
  writes.wrote('s3', 'rack-1', ['e', 'f', 'g']);
  assert.deepEqual(['a', 'c', 'd'].map((hash) => writes.writer(hash === 'a' ? 's1' : 's2', hash)), [undefined, undefined, undefined]);
  writes.wrote('s1', 'rack-3', ['h']);
  assert.equal(writes.writer('s1', 'h'), 'rack-3');
  writes.end('s1');
  assert.equal(writes.writer('s1', 'h'), undefined);
  assert.equal(writes.size, 2);
});

it('keeps every rack that holds an object, not only the last, up to its bound of racks, and lets one rack\'s go of a scope alone', () => {
  const writes = new ScopeWrites();
  writes.wrote('hub/r', 'rack-1', ['a']);
  writes.wrote('hub/r', 'rack-2', ['a']);
  assert.deepEqual([...writes.writersOf('hub/r', ['a'])].sort(), ['rack-1', 'rack-2'], 'the first fetcher still holds it');
  assert.equal(writes.writer('hub/r', 'a'), 'rack-2', 'the latest noted');
  for (let i = 0; i < SCOPE_HOLDERS_MAX + 2; i++) writes.wrote('hub/r', `rack-${i + 10}`, ['b']);
  assert.equal(writes.writersOf('hub/r', ['b']).size, SCOPE_HOLDERS_MAX, 'at most its bound of racks, the oldest going');
  writes.wrote('s2', 'rack-1', ['a']);
  writes.forget('rack-1', ['hub/r']);
  assert.deepEqual([...writes.writersOf('hub/r', ['a'])], ['rack-2'], 'one rack\'s holdings of the scope go');
  assert.equal(writes.writer('s2', 'a'), 'rack-1', 'and of no other scope');
  writes.forget('rack-2', ['hub/r']);
  assert.equal(writes.writer('hub/r', 'a'), undefined);
});
