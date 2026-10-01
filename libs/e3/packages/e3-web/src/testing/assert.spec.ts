/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The assertions the adapters' contract asserts with, in Node and in a page:
 * each fails when what it asserts does not hold, so no case passes by an
 * assertion that cannot fail.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AssertionError, deepEqual, equal, ok, rejects, throws } from './assert.js';

describe('the portable assertions', () => {
  it('equal holds for the same value, and fails otherwise, naming both', () => {
    equal(1, 1);
    equal(null, null);
    equal(Number.NaN, Number.NaN);
    assert.throws(() => equal<unknown>(1, '1'), { name: 'AssertionError', message: 'expected "1", found 1' });
    assert.throws(() => equal(new Uint8Array([1]), new Uint8Array([1]), 'two arrays'), { message: /^two arrays: expected bytes\[1\], found bytes\[1\]$/ });
  });

  it('deepEqual compares bytes, arrays and plain objects member by member', () => {
    deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]));
    deepEqual([['a'], { size: 1, key: ['b'] }], [['a'], { key: ['b'], size: 1 }]);
    for (const [actual, expected] of [
      [new Uint8Array([1, 2]), new Uint8Array([1, 3])],
      [new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])],
      [new Uint8Array([1]), [1]],
      [['a', 'b'], ['a']],
      [{ size: 1 }, { size: 1, key: [] }],
      [{ size: 1 }, { size: 2 }],
      [null, {}],
      [[null], [undefined]],
    ] as const) {
      assert.throws(() => deepEqual<unknown>(actual, expected), AssertionError);
    }
  });

  it('ok fails for what does not hold', () => {
    ok(true);
    ok(1);
    for (const value of [false, 0, '', null, undefined]) assert.throws(() => ok(value), AssertionError);
  });

  it('rejects holds for work that fails as expected, sync or async, and fails for work that succeeds or fails otherwise', async () => {
    await rejects(() => Promise.reject(new TypeError('a type')), { name: 'TypeError', message: /type/ });
    await rejects(() => {
      throw new RangeError('at once');
    }, { name: 'RangeError' });
    await assert.rejects(rejects(() => Promise.resolve('fine')), { name: 'AssertionError', message: /and it succeeded/ });
    await assert.rejects(rejects(() => Promise.reject(new TypeError('a type')), { name: 'RangeError' }), { name: 'AssertionError' });
    await assert.rejects(rejects(() => Promise.reject(new Error('other')), { message: /expected/ }), { name: 'AssertionError' });
  });

  it('throws holds for a function that throws as expected there and then, and fails otherwise', () => {
    throws(() => {
      throw new TypeError('now');
    }, { name: 'TypeError' });
    assert.throws(() => throws(() => 'returned'), { name: 'AssertionError', message: /and it returned/ });
    assert.throws(() => throws(() => {
      throw new Error('other');
    }, { name: 'TypeError' }), AssertionError);
  });
});
