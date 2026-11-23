/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE_WRITES_MAX, ScopeWrites } from './scope-writes.js';

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
