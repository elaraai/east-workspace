/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A closure keeps the lines it was written at, in whatever blob it is
 * written. It carries its IR and its program's source map; a blob has one
 * map — its header's stacks, then each closure's delta — which every closure
 * decoded from it resolves against. A closure of another program adds the
 * stacks the blob lacks, and is written with its locations where they stand
 * in the blob's map. A self-contained stream writes its header before its
 * elements, so a closure whose stacks the header lacks is written with no
 * location — never another program's.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, FunctionType, IntegerType } from "../../../types.js";
import { East } from "../../../index.js";
import { EastError } from "../../../error.js";
import { EastIR } from "../../../eastir.js";
import { decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor, encodeBeast2SegmentsFor } from "../index.js";

const Lookup = FunctionType([IntegerType], IntegerType);
const Lookups = ArrayType(Lookup);

/** Two programs, each returning a closure written on its own line. */
const programA = East.function([], Lookup, (_$) => East.function([IntegerType], IntegerType, (_$, x) => East.value([10n]).get(x))).toIR();
const programB = East.function([], Lookup, (_$) => East.function([IntegerType], IntegerType, (_$, x) => East.value([20n, 30n]).get(x))).toIR();
const a = programA.compile([])();
const b = programB.compile([])();
/** A closure whose program carries no map: its IR names locations nothing resolves. */
const bare = new EastIR<[bigint], bigint>(East.function([IntegerType], IntegerType, (_$, x) => East.value([40n]).get(x)).toIR().ir).compile([]);

/** Where the error a closure raises says it is. */
function raisedAt(fn: (x: bigint) => bigint): EastError["location"] {
  try {
    fn(5n);
  } catch (err) {
    if (err instanceof EastError) return err.location;
    throw err;
  }
  throw new Error("expected the call to raise");
}

describe("a closure keeps the lines it was written at", () => {
  test("closures of two programs in one value each keep their own, either way round", () => {
    assert.ok(raisedAt(a).length > 0, "A's closure has a location");
    assert.notDeepEqual(raisedAt(a), raisedAt(b), "two lines");
    for (const value of [[a, b], [b, a], [a, b, b, a]]) {
      const decoded = decodeBeast2For(Lookups)(encodeBeast2For(Lookups)(value));
      decoded.forEach((fn, i) => assert.deepEqual(raisedAt(fn), raisedAt(value[i]!), `closure ${i}`));
    }
  });

  test("a closure with no map is written with no location, whatever closure is beside it", () => {
    for (const value of [[bare, a], [a, bare], [bare]]) {
      const decoded = decodeBeast2For(Lookups)(encodeBeast2For(Lookups)(value));
      decoded.forEach((fn, i) => assert.deepEqual(raisedAt(fn), value[i] === bare ? [] : raisedAt(a), `closure ${i}`));
    }
  });

  test("a decode then an encode gives back the bytes read", () => {
    for (const value of [[a, a], [a, b], [bare, a], [bare]]) {
      const blob = encodeBeast2For(Lookups)(value);
      assert.deepEqual(encodeBeast2For(Lookups)(decodeBeast2For(Lookups)(blob)), blob);
    }
  });

  test("a stream of closures under their program's map keeps their lines, and without it writes none", () => {
    const under = decodeBeast2For(Lookups)(encodeBeast2PagedFor(Lookups, { sourceMap: programA.source_map })([a, a]));
    under.forEach((fn) => assert.deepEqual(raisedAt(fn), raisedAt(a)));
    const without = decodeBeast2For(Lookups)(encodeBeast2PagedFor(Lookups)([a, a]));
    without.forEach((fn) => assert.deepEqual(raisedAt(fn), []));
  });

  test("a stream writes a closure whose stacks its header lacks with no location, never the header program's", () => {
    const decoded = decodeBeast2For(Lookups)(encodeBeast2PagedFor(Lookups, { sourceMap: programA.source_map })([a, b]));
    assert.deepEqual(raisedAt(decoded[0]!), raisedAt(a));
    assert.deepEqual(raisedAt(decoded[1]!), []);
  });

  test("a stream that is not self-contained writes a closure's missing stacks as its own", () => {
    const blob = encodeBeast2SegmentsFor(Lookups, { selfContained: false, sourceMap: programA.source_map })([[a, b], [b]]);
    const decoded = decodeBeast2For(Lookups)(blob);
    assert.deepEqual(decoded.map(raisedAt), [raisedAt(a), raisedAt(b), raisedAt(b)]);
  });
});
