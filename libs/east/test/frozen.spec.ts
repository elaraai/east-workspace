/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frozen task inputs (#539) — host-level semantics.
 *
 * Frozen decodes (`decodeBeast2For(type, { frozen: true })`, the text/JSON
 * paths, and `openBeast2LazyFor(type, { frozen: true })`) produce deeply
 * immutable values: every mutating builtin throws the uniform runtime error,
 * frozen collections compare as value types under `Is` (the Blob precedent),
 * and the lazy shape gate collapses to excluding only `Ref`- and
 * function-bearing element shapes. Everything else — equality, ordering,
 * printing, encoding — is byte-identical to the mutable twin.
 *
 * The cross-runtime (east-c / east-py) fixtures live in the exported
 * "Frozen" compliance suite; this file pins the TS host surfaces.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  East, isFrozenValue, equalFor, compareFor, printFor, parseFor, fromJSONFor, toJSONFor,
  encodeBeast2For, decodeBeast2For, encodeBeast2PagedFor, openBeast2LazyFor, isBeast2LazySafe,
  ArrayType, SetType, DictType, StructType, RecursiveType, RefType, FunctionType, OptionType,
  IntegerType, FloatType, StringType, NullType, BooleanType, VectorType, MatrixType, BlobType, DateTimeType,
  ref,
  type EastType, type ValueTypeOf,
} from "../src/index.js";

const FROZEN_PATTERN = /cannot mutate a frozen value \(task inputs are immutable\) — copy first/;

/** Round-trips a value through beast2 into a frozen decode. */
function freezeVia<T extends EastType>(type: T, value: ValueTypeOf<T>, version?: 4 | 5): ValueTypeOf<T> {
  const blob = encodeBeast2For(type, version === 4 ? { version: 4 } : undefined)(value);
  return decodeBeast2For(type, { frozen: true })(blob);
}

const Row = StructType({ id: IntegerType, xs: ArrayType(FloatType) });
const Table = DictType(StringType, Row);
const tableValue = new Map<string, ValueTypeOf<typeof Row>>([
  ["a", { id: 1n, xs: [1.5, 2.5] }],
  ["b", { id: 2n, xs: [] }],
  ["c", { id: 3n, xs: [-1.0] }],
]);

describe("frozen decode — construction", () => {
  test("beast2 v5 and v4 decodes brand every level", () => {
    for (const version of [5, 4] as const) {
      const frozen = freezeVia(Table, tableValue, version);
      assert.ok(isFrozenValue(frozen), `v${version} root`);
      const row = frozen.get("a")!;
      assert.ok(Object.isFrozen(row), `v${version} struct`);
      assert.ok(isFrozenValue(row.xs), `v${version} nested array`);
    }
  });

  test("text and JSON parses brand every level (incl. typed arrays)", () => {
    const T = StructType({ blob: BlobType, vec: VectorType(FloatType), mat: MatrixType(IntegerType), when: DateTimeType });
    const value: ValueTypeOf<typeof T> = {
      blob: new Uint8Array([1, 2, 3]),
      vec: new Float64Array([1.5, -2.5]),
      mat: { data: new BigInt64Array([1n, 2n, 3n, 4n]), rows: 2, cols: 2 } as ValueTypeOf<typeof T>["mat"],
      when: new Date(1700000000000),
    };
    const parsed = parseFor(T, true)(printFor(T)(value));
    assert.ok(parsed.success);
    if (parsed.success) {
      assert.ok(isFrozenValue(parsed.value.blob), "text blob");
      assert.ok(isFrozenValue(parsed.value.vec), "text vector");
      assert.ok(isFrozenValue(parsed.value.mat), "text matrix");
    }
    const fromJson = fromJSONFor(T, true)(toJSONFor(T)(value));
    assert.ok(isFrozenValue(fromJson.blob), "json blob");
    assert.ok(isFrozenValue(fromJson.vec), "json vector");
    assert.ok(isFrozenValue(fromJson.mat), "json matrix");
  });

  test("unfrozen decodes stay mutable", () => {
    const plain = decodeBeast2For(Table)(encodeBeast2For(Table)(tableValue));
    assert.ok(!isFrozenValue(plain));
    plain.get("a")!.xs.push(9.0);
    assert.equal(plain.get("a")!.xs.length, 3);
  });
});

describe("frozen mutation — the uniform runtime error", () => {
  const compileMutator = (fn: unknown) => (fn as { toIR(): { compile(platform: never[]): (...args: unknown[]) => unknown } }).toIR().compile([]);

  test("array, set, dict, ref and nested mutating builtins throw", () => {
    const Arr = ArrayType(IntegerType);
    const Tags = SetType(StringType);
    const Cell = RefType(IntegerType);

    const cases: Array<{ label: string; type: EastType; value: unknown; fn: unknown }> = [
      { label: "array push", type: Arr, value: [1n, 2n], fn: East.function([Arr], NullType, ($, a) => { $(a.pushLast(3n)); return null; }) },
      { label: "array update", type: Arr, value: [1n, 2n], fn: East.function([Arr], NullType, ($, a) => { $(a.update(0n, 9n)); return null; }) },
      { label: "array clear", type: Arr, value: [1n], fn: East.function([Arr], NullType, ($, a) => { $(a.clear()); return null; }) },
      { label: "set insert", type: Tags, value: new Set(["a"]), fn: East.function([Tags], NullType, ($, s) => { $(s.insert("z")); return null; }) },
      { label: "set delete", type: Tags, value: new Set(["a"]), fn: East.function([Tags], NullType, ($, s) => { $(s.delete("a")); return null; }) },
      { label: "dict insert", type: Table, value: tableValue, fn: East.function([Table], NullType, ($, d) => { $(d.insert("z", { id: 9n, xs: [] })); return null; }) },
      { label: "dict update", type: Table, value: tableValue, fn: East.function([Table], NullType, ($, d) => { $(d.update("a", { id: 9n, xs: [] })); return null; }) },
      { label: "ref assign", type: Cell, value: ref(1n), fn: East.function([Cell], NullType, ($, r) => { $(r.update(East.value(2n))); return null; }) },
      { label: "nested array push through dict get", type: Table, value: tableValue, fn: East.function([Table], NullType, ($, d) => { $(d.get("a").xs.pushLast(9.0)); return null; }) },
    ];

    for (const c of cases) {
      const frozen = freezeVia(c.type, c.value as never);
      assert.throws(() => compileMutator(c.fn)(frozen), FROZEN_PATTERN, c.label);
      const mutable = decodeBeast2For(c.type)(encodeBeast2For(c.type)(c.value as never));
      compileMutator(c.fn)(mutable); // the same body on a mutable twin succeeds
    }
  });

  test("copy is the escape hatch", () => {
    const Arr = ArrayType(IntegerType);
    const fn = East.function([Arr], Arr, ($, a) => {
      const scratch = $.let(a.copy());
      $(scratch.pushLast(3n));
      return scratch;
    });
    const result = compileMutator(fn)(freezeVia(Arr, [1n, 2n])) as bigint[];
    assert.deepEqual(result, [1n, 2n, 3n]);
  });

  test("host-level strict-mode writes throw on frozen plain arrays", () => {
    const frozen = freezeVia(ArrayType(IntegerType), [1n, 2n]);
    assert.throws(() => { frozen[0] = 9n; }, TypeError);
    assert.throws(() => { (frozen as bigint[]).push(3n); }, TypeError);
  });
});

describe("frozen Is — value semantics (the Blob precedent)", () => {
  const isOf = (type: EastType) => {
    const fn = East.function([type, type], BooleanType, (_$, a, b) => East.is(a as never, b as never));
    return fn.toIR().compile([]) as (a: unknown, b: unknown) => boolean;
  };

  test("both frozen compares by deep value; mixed or mutable stays identity", () => {
    const is = isOf(Table);
    const f1 = freezeVia(Table, tableValue);
    const f2 = freezeVia(Table, tableValue);
    const m1 = decodeBeast2For(Table)(encodeBeast2For(Table)(tableValue));
    const m2 = decodeBeast2For(Table)(encodeBeast2For(Table)(tableValue));

    assert.equal(is(f1, f1), true, "same frozen object");
    assert.equal(is(f1, f2), true, "equal frozen twins");
    assert.equal(is(m1, m2), false, "mutable twins keep identity semantics");
    assert.equal(is(f1, m1), false, "mixed frozen/mutable keeps identity semantics");

    const different = new Map(tableValue);
    different.set("a", { id: 99n, xs: [] });
    assert.equal(is(f1, freezeVia(Table, different)), false, "unequal frozen values");
  });

  test("nested frozen containers compare by value through structs", () => {
    const is = isOf(Row);
    const f1 = freezeVia(Row, { id: 1n, xs: [1.5] });
    const f2 = freezeVia(Row, { id: 1n, xs: [1.5] });
    // Struct Is recurses field-wise: the nested frozen arrays compare by value.
    assert.equal(is(f1, f2), true);
  });

  test("frozen Vector and Matrix compare by value", () => {
    const Vec = VectorType(FloatType);
    const Mat = MatrixType(IntegerType);
    const isVec = isOf(Vec);
    const isMat = isOf(Mat);
    assert.equal(isVec(freezeVia(Vec, new Float64Array([1, 2])), freezeVia(Vec, new Float64Array([1, 2]))), true);
    assert.equal(isVec(freezeVia(Vec, new Float64Array([1, 2])), freezeVia(Vec, new Float64Array([1, 3]))), false);
    assert.equal(isVec(new Float64Array([1, 2]), new Float64Array([1, 2])), false, "mutable vectors keep identity");
    const m = { data: new BigInt64Array([1n, 2n]), rows: 1, cols: 2 } as ValueTypeOf<typeof Mat>;
    assert.equal(isMat(freezeVia(Mat, m), freezeVia(Mat, m)), true);
  });

  test("frozen Refs keep identity semantics", () => {
    const Cell = RefType(IntegerType);
    const is = isOf(Cell);
    const f1 = freezeVia(Cell, ref(1n));
    const f2 = freezeVia(Cell, ref(1n));
    assert.equal(is(f1, f1), true);
    assert.equal(is(f1, f2), false, "a Ref is the explicit identity cell");
  });

  test("recursive container element types build and compare", () => {
    // Regression guard for the deferred equalFor build inside isFor: a
    // recursive wrapper's back-reference must resolve when the frozen path
    // first compares.
    const NodeType = RecursiveType((self: any) => StructType({ label: StringType, children: ArrayType(self) }));
    const is = isOf(NodeType);
    const value = { label: "root", children: [{ label: "kid", children: [] }] };
    assert.equal(is(freezeVia(NodeType, value as never), freezeVia(NodeType, value as never)), true);
  });
});

describe("frozen parity — equality, ordering, print, encode", () => {
  test("frozen values are equal, ordered and printed like their mutable twins", () => {
    const frozen = freezeVia(Table, tableValue);
    const mutable = decodeBeast2For(Table)(encodeBeast2For(Table)(tableValue));
    assert.ok(equalFor(Table)(frozen, mutable));
    assert.equal(compareFor(Table)(frozen, mutable), 0);
    assert.equal(printFor(Table)(frozen), printFor(Table)(mutable));
    assert.deepEqual(encodeBeast2For(Table)(frozen), encodeBeast2For(Table)(mutable));
  });
});

describe("frozen lazy opens — the collapsed gate", () => {
  const SWEEP_BATCH = { batchSize: 2 };
  const NestedTable = DictType(StringType, StructType({ xs: ArrayType(IntegerType) }));
  const nested = new Map<string, { xs: bigint[] }>([
    ["a", { xs: [1n, 2n] }], ["b", { xs: [] }], ["c", { xs: [3n] }], ["d", { xs: [4n, 5n] }], ["e", { xs: [6n] }],
  ]);

  test("the gate relaxes to excluding only Ref- and function-bearing shapes", () => {
    assert.equal(isBeast2LazySafe(NestedTable), false, "unfrozen: nested arrays refuse");
    assert.equal(isBeast2LazySafe(NestedTable, { frozen: true }), true, "frozen: nested arrays open");
    assert.equal(isBeast2LazySafe(ArrayType(VectorType(FloatType)), { frozen: true }), true, "frozen: vectors open");
    assert.equal(isBeast2LazySafe(ArrayType(ArrayType(SetType(IntegerType))), { frozen: true }), true, "frozen: deep nesting opens");
    assert.equal(isBeast2LazySafe(ArrayType(RefType(IntegerType)), { frozen: true }), false, "Ref still refuses");
    assert.equal(isBeast2LazySafe(ArrayType(StructType({ f: FunctionType([], IntegerType) })), { frozen: true }), false, "functions still refuse");
    assert.equal(isBeast2LazySafe(DictType(StringType, OptionType(ArrayType(FloatType))), { frozen: true }), true, "frozen: option-of-array opens");
    assert.equal(isBeast2LazySafe(StringType, { frozen: true }), false, "non-collection roots refuse");
  });

  test("a frozen lazy dict serves frozen values, and matches the eager frozen decode", () => {
    const blob = encodeBeast2PagedFor(NestedTable, SWEEP_BATCH)(nested);
    const lazy = openBeast2LazyFor(NestedTable, { frozen: true })(blob);
    const eager = decodeBeast2For(NestedTable, { frozen: true })(blob);

    assert.ok(isFrozenValue(lazy), "the lazy value is branded frozen");
    assert.equal(lazy.size, nested.size, "size from the index");
    const row = lazy.get("a")!;
    assert.ok(Object.isFrozen(row), "pager-served struct is frozen");
    assert.ok(isFrozenValue(row.xs), "pager-served nested array is frozen");
    assert.ok(equalFor(NestedTable)(lazy, eager), "full iteration equals the eager decode");
  });

  test("mutating a frozen lazy value throws without hydrating", () => {
    const blob = encodeBeast2PagedFor(NestedTable, SWEEP_BATCH)(nested);
    const lazy = openBeast2LazyFor(NestedTable, { frozen: true })(blob);
    assert.throws(() => (lazy as Map<string, unknown>).set("z", { xs: [] }), /Cannot modify frozen SortedMap/);
    assert.throws(() => (lazy as Map<string, unknown>).delete("a"), /Cannot modify frozen SortedMap/);
    assert.throws(() => (lazy as Map<string, unknown>).clear(), /Cannot modify frozen SortedMap/);
    // Still lazily serviceable after the refused writes.
    assert.equal(lazy.get("c")!.xs.length, 1);

    const mutate = East.function([NestedTable], NullType, ($, d) => { $(d.insert("z", { xs: [] })); return null; });
    assert.throws(() => mutate.toIR().compile([])(lazy), FROZEN_PATTERN, "East-level mutation reports the uniform error");
  });

  test("frozen lazy arrays serve reads, refuse writes, and compare by value", () => {
    const Rows = ArrayType(StructType({ xs: ArrayType(IntegerType) }));
    const rows = [{ xs: [1n] }, { xs: [] }, { xs: [2n, 3n] }, { xs: [4n] }, { xs: [5n] }];
    assert.equal(isBeast2LazySafe(Rows), false);
    assert.equal(isBeast2LazySafe(Rows, { frozen: true }), true);

    const blob = encodeBeast2PagedFor(Rows, SWEEP_BATCH)(rows);
    const lazy = openBeast2LazyFor(Rows, { frozen: true })(blob);
    assert.equal(lazy.length, rows.length);
    assert.ok(Object.isFrozen(lazy[2]), "pager-served element is frozen");
    assert.throws(() => { (lazy as unknown[])[0] = null; }, /Cannot modify frozen Array/);

    const push = East.function([Rows], NullType, ($, a) => { $(a.pushLast({ xs: [] })); return null; });
    assert.throws(() => push.toIR().compile([])(lazy), FROZEN_PATTERN);

    const is = East.function([Rows, Rows], BooleanType, (_$, a, b) => East.is(a, b)).toIR().compile([]) as (a: unknown, b: unknown) => boolean;
    assert.equal(is(lazy, decodeBeast2For(Rows, { frozen: true })(blob)), true, "frozen lazy vs frozen eager compares by value");
  });
});
