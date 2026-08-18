/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, FloatType, SetType, DictType, VectorType, StringType } from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./vector.examples.js";

await describe("Vector", (test) => {
    assert.examples(test, {
        vectorZeros: ex.vectorZeros,
        vectorOnes: ex.vectorOnes,
        vectorFill: ex.vectorFill,
        vectorFromArray: ex.vectorFromArray,
    });

    test("Vector creation zeros", $ => {
        const v = $.let(East.Vector.zeros(3n));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), 0.0))
        $(assert.equal(v.get(1n), 0.0))
        $(assert.equal(v.get(2n), 0.0))
    });

    test("Vector creation ones", $ => {
        const v = $.let(East.Vector.ones(3n));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), 1.0))
        $(assert.equal(v.get(1n), 1.0))
        $(assert.equal(v.get(2n), 1.0))
    });

    test("Vector creation fill", $ => {
        const v = $.let(East.Vector.fill(4n, 3.14));
        $(assert.equal(v.length(), 4n))
        $(assert.equal(v.get(0n), 3.14))
        $(assert.equal(v.get(3n), 3.14))

        // Integer fill
        const vi = $.let(East.Vector.fill(3n, 42n));
        $(assert.equal(vi.length(), 3n))
        $(assert.equal(vi.get(0n), 42n))

        // Boolean fill
        const vb = $.let(East.Vector.fill(2n, true));
        $(assert.equal(vb.length(), 2n))
        $(assert.equal(vb.get(0n), true))
    });

    test("Vector creation empty", $ => {
        const v = $.let(East.Vector.zeros(0n));
        $(assert.equal(v.length(), 0n))
    });

    test("Vector from array", $ => {
        const arr = $.let([1.0, 2.0, 3.0]);
        const v = $.let(East.Vector.fromArray(arr));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), 1.0))
        $(assert.equal(v.get(1n), 2.0))
        $(assert.equal(v.get(2n), 3.0))
    });

    test("Vector from integer array", $ => {
        const arr = $.let([10n, 20n, 30n]);
        const v = $.let(East.Vector.fromArray(arr));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), 10n))
        $(assert.equal(v.get(1n), 20n))
        $(assert.equal(v.get(2n), 30n))
    });

    assert.examples(test, {
        vectorLength: ex.vectorLength,
        vectorGet: ex.vectorGet,
        vectorSet: ex.vectorSet,
    });

    test("Vector get and set", $ => {
        const v = $.let(East.Vector.zeros(3n));
        const v1 = $.let(v.set(0n, 10.0));
        const v2 = $.let(v1.set(1n, 20.0));
        const v3 = $.let(v2.set(2n, 30.0));
        $(assert.equal(v3.get(0n), 10.0))
        $(assert.equal(v3.get(1n), 20.0))
        $(assert.equal(v3.get(2n), 30.0))
        // set is functional: the original is unchanged
        $(assert.equal(v.get(0n), 0.0))
    });

    test("Vector bounds checking", $ => {
        const v = $.let(East.Vector.zeros(3n));
        $(assert.throws(v.get(-1n), /Vector index .* out of bounds/))
        $(assert.throws(v.get(3n), /Vector index .* out of bounds/))
        $(assert.throws(v.set(-1n, 0.0), /Vector index .* out of bounds/))
        $(assert.throws(v.set(3n, 0.0), /Vector index .* out of bounds/))
    });

    assert.examples(test, {
        vectorSlice: ex.vectorSlice,
        vectorConcat: ex.vectorConcat,
    });

    test("Vector slice", $ => {
        const v0 = $.let(East.Vector.fill(5n, 0.0));
        const v1 = $.let(v0.set(0n, 1.0));
        const v2 = $.let(v1.set(1n, 2.0));
        const v3 = $.let(v2.set(2n, 3.0));
        const v4 = $.let(v3.set(3n, 4.0));
        const v = $.let(v4.set(4n, 5.0));
        const s = $.let(v.slice(1n, 4n));
        $(assert.equal(s.length(), 3n))
        $(assert.equal(s.get(0n), 2.0))
        $(assert.equal(s.get(1n), 3.0))
        $(assert.equal(s.get(2n), 4.0))
    });

    test("Vector concat", $ => {
        const a = $.let(East.Vector.fill(2n, 1.0));
        const b = $.let(East.Vector.fill(3n, 2.0));
        const c = $.let(a.concat(b));
        $(assert.equal(c.length(), 5n))
        $(assert.equal(c.get(0n), 1.0))
        $(assert.equal(c.get(1n), 1.0))
        $(assert.equal(c.get(2n), 2.0))
        $(assert.equal(c.get(4n), 2.0))
    });

    assert.examples(test, {
        vectorToArray: ex.vectorToArray,
        vectorToMatrix: ex.vectorToMatrix,
    });

    test("Vector to array", $ => {
        const arr = $.let([1.0, 2.0, 3.0]);
        const v = $.let(East.Vector.fromArray(arr));
        const result = $.let(v.toArray());
        $(assert.equal(result, [1.0, 2.0, 3.0]))
    });

    test("Vector to array integer", $ => {
        const arr = $.let([10n, 20n, 30n]);
        const v = $.let(East.Vector.fromArray(arr));
        const result = $.let(v.toArray());
        $(assert.equal(result, [10n, 20n, 30n]))
    });

    test("Vector to matrix reshape", $ => {
        const arr = $.let([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        const v = $.let(East.Vector.fromArray(arr));
        const m = $.let(v.toMatrix(2n, 3n));
        $(assert.equal(m.rows(), 2n))
        $(assert.equal(m.cols(), 3n))
        $(assert.equal(m.get(0n, 0n), 1.0))
        $(assert.equal(m.get(0n, 1n), 2.0))
        $(assert.equal(m.get(0n, 2n), 3.0))
        $(assert.equal(m.get(1n, 0n), 4.0))
        $(assert.equal(m.get(1n, 2n), 6.0))
    });

    assert.examples(test, {
        vectorMap: ex.vectorMap,
        vectorReduce: ex.vectorReduce,
    });

    test("Vector map", $ => {
        const arr = $.let([1.0, 2.0, 3.0]);
        const v = $.let(East.Vector.fromArray(arr));
        const doubled = $.let(v.map(($, x) => x.multiply(2.0)));
        $(assert.equal(doubled.get(0n), 2.0))
        $(assert.equal(doubled.get(1n), 4.0))
        $(assert.equal(doubled.get(2n), 6.0))
    });

    test("Vector map with index", $ => {
        const v = $.let(East.Vector.zeros(3n));
        const indexed = $.let(v.map(($, _x, i) => i));
        $(assert.equal(indexed.get(0n), 0n))
        $(assert.equal(indexed.get(1n), 1n))
        $(assert.equal(indexed.get(2n), 2n))
    });

    test("Vector reduce", $ => {
        const arr = $.let([1.0, 2.0, 3.0, 4.0]);
        const v = $.let(East.Vector.fromArray(arr));
        const sum = $.let(v.reduce(($, acc, val) => acc.add(val), 0.0));
        $(assert.equal(sum, 10.0))
    });

    test("Vector integer ops", $ => {
        const v0 = $.let(East.Vector.fill(3n, 0n));
        const v1 = $.let(v0.set(0n, 100n));
        const v2 = $.let(v1.set(1n, 200n));
        const v = $.let(v2.set(2n, 300n));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), 100n))
        $(assert.equal(v.get(1n), 200n))
        $(assert.equal(v.get(2n), 300n))
    });

    test("Vector boolean ops", $ => {
        const v0 = $.let(East.Vector.fill(3n, false));
        const v = $.let(v0.set(0n, true));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), true))
        $(assert.equal(v.get(1n), false))
        $(assert.equal(v.get(2n), false))
    });

    test("Vector literal float", $ => {
        const v = $.let(new Float64Array([1.0, 2.0, 3.0]));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), 1.0))
        $(assert.equal(v.get(1n), 2.0))
        $(assert.equal(v.get(2n), 3.0))
    });

    test("Vector literal integer", $ => {
        const v = $.let(new BigInt64Array([10n, 20n, 30n]));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), 10n))
        $(assert.equal(v.get(1n), 20n))
        $(assert.equal(v.get(2n), 30n))
    });

    test("Vector slice empty", $ => {
        const arr = $.let([1.0, 2.0, 3.0]);
        const v = $.let(East.Vector.fromArray(arr));
        const s = $.let(v.slice(1n, 1n));
        $(assert.equal(s.length(), 0n))
    });

    test("Vector concat with empty", $ => {
        const a = $.let(East.Vector.fill(3n, 1.0));
        const b = $.let(East.Vector.zeros(0n));
        const c = $.let(a.concat(b));
        $(assert.equal(c.length(), 3n))
        $(assert.equal(c.get(0n), 1.0))
    });

    test("Vector map add one", $ => {
        const v = $.let(East.Vector.ones(3n));
        const result = $.let(v.map(($, x) => x.add(1.0)));
        $(assert.equal(result.get(0n), 2.0))
        $(assert.equal(result.get(1n), 2.0))
        $(assert.equal(result.get(2n), 2.0))
    });

    test("Vector reduce product", $ => {
        const arr = $.let([1.0, 2.0, 3.0, 4.0]);
        const v = $.let(East.Vector.fromArray(arr));
        // Product: 1 * 2 * 3 * 4 = 24
        const result = $.let(v.reduce(($, acc, val) => acc.multiply(val), 1.0));
        $(assert.equal(result, 24.0))
    });

    test("Vector from boolean array", $ => {
        const arr = $.let([true, false, true]);
        const v = $.let(East.Vector.fromArray(arr));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), true))
        $(assert.equal(v.get(1n), false))
        $(assert.equal(v.get(2n), true))
    });

    test("Vector to array boolean", $ => {
        const v0 = $.let(East.Vector.fill(3n, false));
        const v1 = $.let(v0.set(0n, true));
        const v = $.let(v1.set(2n, true));
        const result = $.let(v.toArray());
        $(assert.equal(result, [true, false, true]))
    });

    test("Vector literal boolean", $ => {
        const v = $.let(new Uint8ClampedArray([1, 0, 1]));
        $(assert.equal(v.length(), 3n))
        $(assert.equal(v.get(0n), true))
        $(assert.equal(v.get(1n), false))
        $(assert.equal(v.get(2n), true))
    });

    test("Vector boolean slice", $ => {
        const v0 = $.let(East.Vector.fill(4n, false));
        const v1 = $.let(v0.set(0n, true));
        const v2 = $.let(v1.set(1n, false));
        const v3 = $.let(v2.set(2n, true));
        const v = $.let(v3.set(3n, true));
        const s = $.let(v.slice(1n, 3n));
        $(assert.equal(s.length(), 2n))
        $(assert.equal(s.get(0n), false))
        $(assert.equal(s.get(1n), true))
    });

    test("Vector boolean concat", $ => {
        const a = $.let(East.Vector.fill(2n, true));
        const b = $.let(East.Vector.fill(2n, false));
        const c = $.let(a.concat(b));
        $(assert.equal(c.length(), 4n))
        $(assert.equal(c.get(0n), true))
        $(assert.equal(c.get(1n), true))
        $(assert.equal(c.get(2n), false))
        $(assert.equal(c.get(3n), false))
    });

    test("Vector boolean map", $ => {
        const v0 = $.let(East.Vector.fill(3n, true));
        const v = $.let(v0.set(1n, false));
        const negated = $.let(v.map(($, x) => x.not()));
        $(assert.equal(negated.get(0n), false))
        $(assert.equal(negated.get(1n), true))
        $(assert.equal(negated.get(2n), false))
    });

    test("Vector boolean reduce", $ => {
        const v0 = $.let(East.Vector.fill(3n, true));
        const v = $.let(v0.set(1n, false));
        // count trues via ifElse: true→1n, false→0n, sum them
        const count = $.let(v.reduce(($, acc, val) => acc.add(val.ifElse(() => 1n, () => 0n)), 0n));
        $(assert.equal(count, 2n))
    });

    test("Vector boolean to matrix", $ => {
        const v0 = $.let(East.Vector.fill(4n, false));
        const v1 = $.let(v0.set(0n, true));
        const v = $.let(v1.set(3n, true));
        const m = $.let(v.toMatrix(2n, 2n));
        $(assert.equal(m.rows(), 2n))
        $(assert.equal(m.cols(), 2n))
        $(assert.equal(m.get(0n, 0n), true))
        $(assert.equal(m.get(0n, 1n), false))
        $(assert.equal(m.get(1n, 0n), false))
        $(assert.equal(m.get(1n, 1n), true))
    });

    test("Vector integer slice", $ => {
        const v0 = $.let(East.Vector.fill(4n, 0n));
        const v1 = $.let(v0.set(0n, 10n));
        const v2 = $.let(v1.set(1n, 20n));
        const v3 = $.let(v2.set(2n, 30n));
        const v = $.let(v3.set(3n, 40n));
        const s = $.let(v.slice(1n, 3n));
        $(assert.equal(s.length(), 2n))
        $(assert.equal(s.get(0n), 20n))
        $(assert.equal(s.get(1n), 30n))
    });

    test("Vector integer concat", $ => {
        const a = $.let(East.Vector.fill(2n, 1n));
        const b = $.let(East.Vector.fill(2n, 2n));
        const c = $.let(a.concat(b));
        $(assert.equal(c.length(), 4n))
        $(assert.equal(c.get(0n), 1n))
        $(assert.equal(c.get(2n), 2n))
    });

    test("Vector integer map", $ => {
        const arr = $.let([1n, 2n, 3n]);
        const v = $.let(East.Vector.fromArray(arr));
        const doubled = $.let(v.map(($, x) => x.multiply(2n)));
        $(assert.equal(doubled.get(0n), 2n))
        $(assert.equal(doubled.get(1n), 4n))
        $(assert.equal(doubled.get(2n), 6n))
    });

    test("Vector integer reduce", $ => {
        const arr = $.let([1n, 2n, 3n, 4n]);
        const v = $.let(East.Vector.fromArray(arr));
        const sum = $.let(v.reduce(($, acc, val) => acc.add(val), 0n));
        $(assert.equal(sum, 10n))
    });

    test("Vector integer to matrix", $ => {
        const arr = $.let([1n, 2n, 3n, 4n]);
        const v = $.let(East.Vector.fromArray(arr));
        const m = $.let(v.toMatrix(2n, 2n));
        $(assert.equal(m.rows(), 2n))
        $(assert.equal(m.cols(), 2n))
        $(assert.equal(m.get(0n, 0n), 1n))
        $(assert.equal(m.get(0n, 1n), 2n))
        $(assert.equal(m.get(1n, 0n), 3n))
        $(assert.equal(m.get(1n, 1n), 4n))
    });

    test("Vector fromArray with empty array", $ => {
        const arr = $.let([], ArrayType(FloatType));
        const v = $.let(East.Vector.fromArray(arr));
        $(assert.equal(v.length(), 0n))
    });

    // Immutable vectors are valid Set/Dict keys (ordered by value via compareFor).
    test("Vector as Set key", $ => {
        const s = $.let(new Set([new Float64Array([1.0, 2.0]), new Float64Array([3.0, 4.0])]), SetType(VectorType(FloatType)));
        $(assert.equal(s.size(), 2n))
        $(assert.equal(s.has(new Float64Array([1.0, 2.0])), true))
        $(assert.equal(s.has(new Float64Array([3.0, 4.0])), true))
        $(assert.equal(s.has(new Float64Array([9.0, 9.0])), false))
    });

    test("Vector as Dict key", $ => {
        // The Dict<Vector, String> constant round-trips through IR serialization
        // (the compliance harness runs it on every backend) and keys are ordered
        // by value via compareFor in the B-tree.
        const dt = DictType(VectorType(FloatType), StringType);
        const d = $.let(new Map([[new Float64Array([1.0, 2.0]), "a"], [new Float64Array([3.0, 4.0]), "b"]]), dt);
        $(assert.equal(d.size(), 2n))
        $(assert.equal(d.get(new Float64Array([1.0, 2.0])), "a"))
        $(assert.equal(d.get(new Float64Array([3.0, 4.0])), "b"))
        $(assert.equal(d.has(new Float64Array([1.0, 2.0])), true))
        $(assert.equal(d.has(new Float64Array([9.0, 9.0])), false))
    });

    assert.examples(test, {
        vectorScale: ex.vectorScale,
        vectorSum: ex.vectorSum,
        vectorAddScaled: ex.vectorAddScaled,
        vectorMul: ex.vectorMul,
        vectorAddScalar: ex.vectorAddScalar,
        vectorDot: ex.vectorDot,
        vectorMax: ex.vectorMax,
        vectorMin: ex.vectorMin,
        vectorArgMax: ex.vectorArgMax,
        vectorArgMin: ex.vectorArgMin,
        vectorMean: ex.vectorMean,
        vectorCumSum: ex.vectorCumSum,
        vectorAbs: ex.vectorAbs,
        vectorClamp: ex.vectorClamp,
    });

    test("Vector arithmetic on integers", $ => {
        const v = $.let(East.Vector.fromArray([1n, 2n, 3n]));
        $(assert.equal(v.scale(2n), new BigInt64Array([2n, 4n, 6n])))
        $(assert.equal(v.sum(), 6n))
        $(assert.equal(v.addScaled(East.Vector.fromArray([10n, 20n, 30n]), 2n), new BigInt64Array([21n, 42n, 63n])))
        $(assert.equal(v.mul(new BigInt64Array([4n, 5n, 6n])), new BigInt64Array([4n, 10n, 18n])))
        $(assert.equal(v.addScalar(10n), new BigInt64Array([11n, 12n, 13n])))
        $(assert.equal(v.dot(new BigInt64Array([4n, 5n, 6n])), 32n))
        $(assert.equal(v.max(), 3n))
        $(assert.equal(v.min(), 1n))
        $(assert.equal(v.argMax(), 2n))
        $(assert.equal(v.argMin(), 0n))
        $(assert.equal(v.mean(), 2.0))
        $(assert.equal(v.cumSum(), new BigInt64Array([1n, 3n, 6n])))
        $(assert.equal(East.Vector.fromArray([-2n, 5n]).abs(), new BigInt64Array([2n, 5n])))
        $(assert.equal(East.Vector.fromArray([-2n, 1n, 5n]).clamp(0n, 3n), new BigInt64Array([0n, 1n, 3n])))
    });

    test("Vector sum order is left to right", $ => {
        // (1e16 + 1) + -1e16 absorbs the 1; any reassociation yields 1.0
        const v = $.let(East.Vector.fromArray([1e16, 1.0, -1e16]));
        $(assert.equal(v.sum(), 0.0))
        $(assert.equal(v.cumSum(), new Float64Array([1e16, 1e16, 0.0])))
        const ones = $.let(East.Vector.fromArray([1.0, 1.0, 1.0]));
        $(assert.equal(v.dot(ones), 0.0))
    });

    test("Vector reductions follow East float order", $ => {
        // NaN is greatest under East's total order; ties keep the first index
        const v = $.let(East.Vector.fromArray([1.0, Number.NaN, 3.0]));
        $(assert.equal(v.argMax(), 1n))
        $(assert.equal(v.min(), 1.0))
        const ties = $.let(East.Vector.fromArray([5.0, 5.0, 1.0]));
        $(assert.equal(ties.argMax(), 0n))
        $(assert.equal(ties.argMin(), 2n))
    });

    test("Vector empty reductions", $ => {
        const empty = $.let(East.Vector.zeros(0n));
        $(assert.equal(empty.sum(), 0.0))
        $(assert.throws(empty.max(), /Cannot reduce empty Vector/))
        $(assert.throws(empty.min(), /Cannot reduce empty Vector/))
        $(assert.throws(empty.argMax(), /Cannot reduce empty Vector/))
        $(assert.throws(empty.argMin(), /Cannot reduce empty Vector/))
    });

    test("Vector elementwise length mismatch", $ => {
        const a = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        const b = $.let(East.Vector.fromArray([1.0, 2.0]));
        $(assert.throws(a.addScaled(b, 1.0), /Vector length mismatch \(3 vs 2\)/))
        $(assert.throws(a.mul(b), /Vector length mismatch/))
        $(assert.throws(a.dot(b), /Vector length mismatch/))
        $(assert.throws(a.eq(b), /Vector length mismatch/))
        $(assert.throws(a.lt(b), /Vector length mismatch/))
        $(assert.throws(a.gt(b), /Vector length mismatch/))
    });

    assert.examples(test, {
        vectorGather: ex.vectorGather,
        vectorScatterAdd: ex.vectorScatterAdd,
        vectorSearchSorted: ex.vectorSearchSorted,
    });

    test("Vector gather and scatter bounds", $ => {
        const v = $.let(East.Vector.fromArray([10.0, 20.0, 30.0]));
        $(assert.throws(v.gather(new BigInt64Array([3n])), /Vector index 3 out of bounds/))
        $(assert.throws(v.gather(new BigInt64Array([-1n])), /Vector index -1 out of bounds/))
        $(assert.throws(v.scatterAdd(new BigInt64Array([3n]), new Float64Array([1.0])), /Vector index 3 out of bounds/))
        $(assert.throws(v.scatterAdd(new BigInt64Array([0n, 1n]), new Float64Array([1.0])), /Vector length mismatch \(2 vs 1\)/))
    });

    test("Vector scatterAdd accumulates duplicates in order", $ => {
        const dst = $.let(East.Vector.fromArray([100.0, 0.0]));
        const result = $.let(dst.scatterAdd(new BigInt64Array([0n, 0n, 1n]), new Float64Array([1.0, 2.0, 5.0])));
        $(assert.equal(result, new Float64Array([103.0, 5.0])))
        // the original is unchanged
        $(assert.equal(dst.get(0n), 100.0))
    });

    test("Vector searchSorted edges", $ => {
        const haystack = $.let(East.Vector.fromArray([10.0, 20.0, 20.0, 30.0]));
        // leftmost insertion point: before the equal run
        $(assert.equal(haystack.searchSorted(new Float64Array([20.0])), new BigInt64Array([1n])))
        $(assert.equal(haystack.searchSorted(new Float64Array([5.0, 35.0])), new BigInt64Array([0n, 4n])))
        const empty = $.let(East.Vector.zeros(0n));
        $(assert.equal(empty.searchSorted(new Float64Array([1.0])), new BigInt64Array([0n])))
    });

    assert.examples(test, {
        vectorEq: ex.vectorEq,
        vectorLt: ex.vectorLt,
        vectorGt: ex.vectorGt,
        vectorSelect: ex.vectorSelect,
        vectorCompress: ex.vectorCompress,
        vectorCountTrue: ex.vectorCountTrue,
    });

    test("Vector masks follow East float semantics", $ => {
        // NaN equals NaN; -0 differs from +0; NaN is greatest in the order
        const a = $.let(East.Vector.fromArray([Number.NaN, -0.0, 1.0]));
        const b = $.let(East.Vector.fromArray([Number.NaN, 0.0, 2.0]));
        $(assert.equal(a.eq(b), new Uint8ClampedArray([1, 0, 0])))
        $(assert.equal(a.lt(b), new Uint8ClampedArray([0, 1, 1])))
        $(assert.equal(a.gt(b), new Uint8ClampedArray([0, 0, 0])))
    });

    test("Vector select and compress on integers", $ => {
        const mask = $.let(East.Vector.fromArray([true, false, true]));
        const a = $.let(East.Vector.fromArray([1n, 2n, 3n]));
        const b = $.let(East.Vector.fromArray([10n, 20n, 30n]));
        $(assert.equal(mask.select(a, b), new BigInt64Array([1n, 20n, 3n])))
        $(assert.equal(a.compress(mask), new BigInt64Array([1n, 3n])))
        $(assert.throws(mask.select(East.Vector.fromArray([1n, 2n]), East.Vector.fromArray([1n, 2n])), /Vector length mismatch/))
        $(assert.throws(a.compress(East.Vector.fromArray([true])), /Vector length mismatch/))
    });

    assert.examples(test, {
        vectorSparseAxpy: ex.vectorSparseAxpy,
        vectorSparseFromPairs: ex.vectorSparseFromPairs,
        vectorSparseFilterGt: ex.vectorSparseFilterGt,
    });

    test("Sparse axpy merges the index union", $ => {
        const merged = $.let(East.Vector.sparseAxpy(
            new BigInt64Array([0n, 2n, 5n]), new Float64Array([1.0, 2.0, 3.0]),
            new BigInt64Array([1n, 2n]), new Float64Array([10.0, 20.0]),
            2.0,
        ));
        $(assert.equal(merged.ix, new BigInt64Array([0n, 1n, 2n, 5n])))
        $(assert.equal(merged.v, new Float64Array([1.0, 20.0, 42.0, 3.0])))
        // alpha of one is a plain merge; an empty side passes the other through
        const identity = $.let(East.Vector.sparseAxpy(
            new BigInt64Array([1n]), new Float64Array([5.0]),
            new BigInt64Array(0), new Float64Array(0),
            1.0,
        ));
        $(assert.equal(identity.ix, new BigInt64Array([1n])))
        $(assert.equal(identity.v, new Float64Array([5.0])))
    });

    test("Sparse axpy on integers", $ => {
        const merged = $.let(East.Vector.sparseAxpy(
            new BigInt64Array([0n]), new BigInt64Array([7n]),
            new BigInt64Array([0n, 3n]), new BigInt64Array([2n, 4n]),
            10n,
        ));
        $(assert.equal(merged.ix, new BigInt64Array([0n, 3n])))
        $(assert.equal(merged.v, new BigInt64Array([27n, 40n])))
    });

    test("Sparse invariant validation", $ => {
        $(assert.throws(East.Vector.sparseAxpy(
            new BigInt64Array([2n, 1n]), new Float64Array([1.0, 2.0]),
            new BigInt64Array(0), new Float64Array(0),
            1.0,
        ), /Sparse index vector must be strictly ascending/))
        $(assert.throws(East.Vector.sparseAxpy(
            new BigInt64Array([0n, 0n]), new Float64Array([1.0, 2.0]),
            new BigInt64Array(0), new Float64Array(0),
            1.0,
        ), /Sparse index vector must be strictly ascending/))
        $(assert.throws(East.Vector.sparseAxpy(
            new BigInt64Array([0n]), new Float64Array([1.0, 2.0]),
            new BigInt64Array(0), new Float64Array(0),
            1.0,
        ), /Sparse index and value lengths differ \(1 vs 2\)/))
        $(assert.throws(East.Vector.sparseFilterGt(
            new BigInt64Array([1n, 0n]), new Float64Array([1.0, 2.0]), 0.0,
        ), /Sparse index vector must be strictly ascending/))
        $(assert.throws(East.Vector.sparseFromPairs(
            new BigInt64Array([0n]), new Float64Array([1.0, 2.0]),
        ), /Sparse index and value lengths differ/))
    });

    test("Sparse from pairs accumulates duplicates in input order", $ => {
        const sparse = $.let(East.Vector.sparseFromPairs(
            new BigInt64Array([3n, 0n, 3n, 0n]), new Float64Array([1e16, 5.0, 1.0, 6.0]),
        ));
        $(assert.equal(sparse.ix, new BigInt64Array([0n, 3n])))
        // index 3 sums (1e16 + 1.0) in input order, absorbing the 1.0
        $(assert.equal(sparse.v, new Float64Array([11.0, 1e16])))
        const empty = $.let(East.Vector.sparseFromPairs(new BigInt64Array(0), new Float64Array(0)));
        $(assert.equal(empty.ix.length(), 0n))
    });

    test("Sparse filter keeps strictly greater entries", $ => {
        const filtered = $.let(East.Vector.sparseFilterGt(
            new BigInt64Array([0n, 1n, 2n]), new Float64Array([1.0, 0.5, 2.0]), 1.0,
        ));
        $(assert.equal(filtered.ix, new BigInt64Array([2n])))
        $(assert.equal(filtered.v, new Float64Array([2.0])))
    });
});
