/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * {@link lazyBuilds} (#1466): each getter's value built once, the first time
 * it is read, with no location captured — so a function's IR is the same
 * whoever reads it first — and a property that is no getter left as it is.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { East, IntegerType, encodeEastIR, sha256Hex, type EastIR } from '@elaraai/east';
import { lazyBuilds } from './lazy-build.js';

describe('lazyBuilds', () => {
  it('builds each getter\'s value once, the first time it is read, and leaves a property that is no getter as it is', () => {
    let builds = 0;
    const library = lazyBuilds({
      kept: 1,
      get built() {
        builds++;
        return { at: builds };
      },
    });
    assert.equal(builds, 0, 'nothing is built until it is read');
    const first = library.built;
    assert.equal(library.built, first);
    assert.equal(builds, 1, 'built once');
    assert.equal(library.kept, 1);
    assert.deepEqual(Object.keys(library), ['kept', 'built'], 'both stay enumerable, in order');
    const descriptor = Object.getOwnPropertyDescriptor(library, 'built');
    assert.equal(descriptor?.get, undefined, 'once built, the value is a property of its own');
    assert.equal(descriptor?.value, first);
  });

  it('builds an East function with no location captured: its IR is the same read first at the top or inside a caller\'s body', () => {
    const make = () => lazyBuilds({
      get double() {
        return East.function([IntegerType], IntegerType, ($, n) => {
          const twice = $.let(n.add(n));
          return twice;
        });
      },
    });
    const irOf = (fn: { toIR(): EastIR<[IntegerType], IntegerType> }) => sha256Hex(encodeEastIR(fn.toIR()));
    const atTop = make();
    const top = irOf(atTop.double);
    const inCaller = make();
    East.function([IntegerType], IntegerType, ($, n) => {
      const double = $.const(inCaller.double);
      return double(n);
    });
    assert.equal(irOf(inCaller.double), top, 'the caller\'s frames and names never reach it');
  });
});
