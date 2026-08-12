/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frozen task inputs (#539) — the shared cross-runtime semantics, as East
 * code replayed by every runtime's compliance harness.
 *
 * Frozen values enter East through the `freeze*` test platform functions.
 * Each runtime's harness implements them as an encode + frozen decode
 * through its own beast2 path, so the fixtures exercise the real frozen
 * construction everywhere: TS below via
 * `decodeBeast2For(type, { frozen: true })`, east-c via
 * `east_beast2_decode_full(..., frozen)`, east-py via the east-c bridge.
 *
 * The pinned contract: mutating a frozen value throws the uniform runtime
 * error naming the copy-first remedy; frozen collections (incl. Vector and
 * Matrix) are value types under `Is` while mutable and mixed operands keep
 * identity semantics; `Ref` remains an identity cell; equality, ordering,
 * printing and encoding are identical to the mutable twin.
 */

import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import {
  East, encodeBeast2For, decodeBeast2For, ref,
  ArrayType, SetType, DictType, StructType, RefType, VectorType, MatrixType,
  IntegerType, FloatType, StringType,
  type EastType, type ValueTypeOf,
} from "../src/index.js";

const Arr = ArrayType(IntegerType);
const Tags = SetType(StringType);
const Row = StructType({ id: IntegerType, xs: ArrayType(FloatType) });
const Table = DictType(StringType, Row);
const Cell = RefType(IntegerType);
const Vec = VectorType(FloatType);
const Mat = MatrixType(IntegerType);

// The freeze capability, declared per fixture type so every runtime's
// harness mirrors plain monomorphic signatures.
const freezeArray = East.platform("freezeArray", [Arr], Arr);
const freezeSet = East.platform("freezeSet", [Tags], Tags);
const freezeDict = East.platform("freezeDict", [Table], Table);
const freezeRef = East.platform("freezeRef", [Cell], Cell);
const freezeVector = East.platform("freezeVector", [Vec], Vec);
const freezeMatrix = East.platform("freezeMatrix", [Mat], Mat);

function freezeVia<T extends EastType>(type: T): (x: ValueTypeOf<T>) => ValueTypeOf<T> {
  const encode = encodeBeast2For(type);
  const decode = decodeBeast2For(type, { frozen: true });
  return (x) => decode(encode(x));
}

const extraPlatform = [
  freezeArray.implement(freezeVia(Arr)),
  freezeSet.implement(freezeVia(Tags)),
  freezeDict.implement(freezeVia(Table)),
  freezeRef.implement(freezeVia(Cell)),
  freezeVector.implement(freezeVia(Vec)),
  freezeMatrix.implement(freezeVia(Mat)),
];

const FROZEN = /cannot mutate a frozen value/;

describe("Frozen", (test) => {
  test("frozen array mutations throw; the mutable twin accepts them", $ => {
    const a = $.let([1n, 2n], Arr);
    const f = $.let(freezeArray(a));
    $(assert.throws(f.pushLast(3n), FROZEN));
    $(assert.throws(f.popLast(), FROZEN));
    $(assert.throws(f.update(0n, 9n), FROZEN));
    $(assert.throws(f.clear(), FROZEN));
    $(a.pushLast(3n));
    $(assert.equal(a, [1n, 2n, 3n]));
    $(assert.equal(f, [1n, 2n]));
  });

  test("copying a frozen array yields a mutable scratch value", $ => {
    const f = $.let(freezeArray([1n, 2n]));
    const scratch = $.let(f.copy());
    $(scratch.pushLast(3n));
    $(assert.equal(scratch, [1n, 2n, 3n]));
    $(assert.equal(f, [1n, 2n]));
  });

  test("frozen set mutations throw; reads still serve", $ => {
    const f = $.let(freezeSet(new Set(["a", "b"])));
    $(assert.throws(f.insert("z"), FROZEN));
    $(assert.throws(f.delete("a"), FROZEN));
    $(assert.throws(f.clear(), FROZEN));
    $(assert.equal(f.has("a"), true));
    $(assert.equal(f.size(), 2n));
  });

  test("frozen dict mutations throw, including through a read-out element", $ => {
    const d = $.let(new Map([["a", { id: 1n, xs: [1.5] }]]), Table);
    const f = $.let(freezeDict(d));
    $(assert.throws(f.insert("z", { id: 9n, xs: [] }), FROZEN));
    $(assert.throws(f.update("a", { id: 9n, xs: [] }), FROZEN));
    $(assert.throws(f.delete("a"), FROZEN));
    $(assert.throws(f.clear(), FROZEN));
    // The nested array read out of a frozen dict is itself frozen.
    $(assert.throws(f.get("a").xs.pushLast(9.0), FROZEN));
    // The mutable twin accepts the same nested write.
    $(d.get("a").xs.pushLast(9.0));
    $(assert.equal(d.get("a").xs.size(), 2n));
    $(assert.equal(f.get("a").xs.size(), 1n));
  });

  test("frozen ref assignment throws", $ => {
    const f = $.let(freezeRef(East.value(ref(1n), Cell)));
    $(assert.throws(f.update(East.value(2n)), FROZEN));
    $(assert.equal(f.get(), 1n));
  });

  test("Is on two frozen collections is deep value equality", $ => {
    const a = $.let([1n, 2n], Arr);
    const f1 = $.let(freezeArray(a));
    const f2 = $.let(freezeArray(a));
    $(assert.is(f1, f1));
    // Two separate freezes are distinct objects but equal values.
    $(assert.is(f1, f2));
    $(assert.equal(East.is(f1, freezeArray([9n])), false));
  });

  test("Is keeps identity semantics for mutable and mixed operands", $ => {
    const a = $.let([1n, 2n], Arr);
    const b = $.let([1n, 2n], Arr);
    const f = $.let(freezeArray(a));
    $(assert.is(a, a));
    $(assert.equal(East.is(a, b), false));
    $(assert.equal(East.is(f, a), false));
  });

  test("Is recurses into nested frozen containers by value", $ => {
    const d = $.let(new Map([["a", { id: 1n, xs: [1.5, 2.5] }]]), Table);
    const f1 = $.let(freezeDict(d));
    const f2 = $.let(freezeDict(d));
    $(assert.is(f1, f2));
    // Rows read out of two distinct frozen decodes compare by value too —
    // struct Is recurses field-wise into the frozen nested arrays.
    $(assert.is(f1.get("a"), f2.get("a")));
  });

  test("frozen Vector and Matrix are value types under Is", $ => {
    const v = $.let(East.Vector.fromArray([1.5, 2.5]));
    const fv1 = $.let(freezeVector(v));
    const fv2 = $.let(freezeVector(v));
    $(assert.is(fv1, fv2));
    $(assert.equal(East.is(v, fv1), false));
    $(assert.equal(East.is(fv1, freezeVector(East.Vector.fromArray([9.0]))), false));

    const m = $.let(East.Matrix.fromArray([[1n, 2n], [3n, 4n]]));
    const fm1 = $.let(freezeMatrix(m));
    const fm2 = $.let(freezeMatrix(m));
    $(assert.is(fm1, fm2));
    $(assert.equal(East.is(m, fm1), false));
  });

  test("a frozen Ref stays an identity cell under Is", $ => {
    const r = $.let(East.value(ref(1n), Cell));
    const f1 = $.let(freezeRef(r));
    const f2 = $.let(freezeRef(r));
    $(assert.is(f1, f1));
    $(assert.equal(East.is(f1, f2), false));
  });

  test("equality, ordering, printing and encoding match the mutable twin", $ => {
    const d = $.let(new Map([
      ["a", { id: 1n, xs: [1.5] }],
      ["b", { id: 2n, xs: [] }],
    ]), Table);
    const f = $.let(freezeDict(d));
    $(assert.equal(f, d));
    $(assert.equal(East.less(f, d), false));
    $(assert.equal(East.less(d, f), false));
    $(assert.equal(East.print(f), East.print(d)));
    $(assert.equal(East.Blob.encodeBeast(f, 'v2'), East.Blob.encodeBeast(d, 'v2')));
  });

  test("frozen collections keep serving reads and iteration", $ => {
    const f = $.let(freezeDict(new Map([
      ["a", { id: 1n, xs: [1.0, 2.0] }],
      ["b", { id: 2n, xs: [3.0] }],
    ])));
    const total = $.let(0.0, FloatType);
    $.for(f, (inner$, row) => {
      inner$.assign(total, total.add(row.xs.reduce((_$, acc, x) => acc.add(x), 0.0)));
    });
    $(assert.equal(total, 6.0));
    $(assert.equal(f.get("b").id, 2n));
    $(assert.equal(f.keys().has("a"), true));
  });
}, { extraPlatform });
