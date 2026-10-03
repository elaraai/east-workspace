/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inputs of the type matrix (#987): every East type a query reads, each
 * with its typical values, its edge values and its empty value, and the
 * literals the programs probe it with (a key it holds and one it lacks, an
 * element, a field, a case, a function's argument).
 */

import {
  ArrayType, BlobType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, MatrixType, NeverType,
  NullType, OptionType, RecursiveType, RefType, SetType, SortedMap, SortedSet, StringType, StructType, VariantType, VectorType,
  compareFor, matrix, none, ref, some, variant, type EastType, type Expr,
} from "../../src/index.js";
import type { BlockBuilder } from "../../src/expr/block.js";

/** One value of a shape, named for the case ids. */
export interface ShapeValue {
  readonly label: string;
  readonly value: unknown;
  /**
   * How a compliance test binds the value, where `$.const(value, type)`
   * cannot: a function value, built in the test's own body (so a closure
   * captures one of its variables).
   */
  readonly bind?: ($: BlockBuilder<any>) => Expr;
}

/**
 * Literals a program probes a shape with, as jq text, and as the East values
 * they are, which the oracle reads.
 */
export interface Probes {
  /** A key the dict holds. */
  readonly key?: string;
  readonly keyValue?: unknown;
  /** A key it lacks. */
  readonly missing?: string;
  readonly missingValue?: unknown;
  /** A value of the element type, for `index`, `contains` and `bsearch`. */
  readonly element?: string;
  readonly elementValue?: unknown;
  /** A field the struct has. */
  readonly field?: string;
  /** A case of the variant. */
  readonly case?: string;
  /** An argument for the function. */
  readonly argument?: string;
  readonly argumentValue?: unknown;
}

/** An input of the matrix: a type, its values, and its probes, in a kind of the issue's table. */
export interface Shape {
  readonly name: string;
  /** Scalars, arrays, sets, dicts, tensors, structs, variants, recursive, refs, functions or composites: its compliance suite. */
  readonly kind: string;
  readonly type: EastType;
  readonly values: readonly ShapeValue[];
  readonly probes: Probes;
}

/** A shape before its kind is known: {@link kind} gives it one. */
type Unkinded = Omit<Shape, "kind">;

function shape(name: string, type: EastType, values: readonly (readonly [string, unknown] | ShapeValue)[], probes: Probes = {}): Unkinded {
  return { name, type, values: values.map(v => ("label" in v ? v : { label: v[0], value: v[1] })), probes };
}

/** Shapes of one kind. */
function kind(name: string, shapes: readonly Unkinded[]): Shape[] {
  return shapes.map(s => ({ ...s, kind: name }));
}

const date = (ms: number): Date => new Date(ms);
/** A Set in East's order: its elements are values of any type, as a shape's are. */
const set = (type: EastType, items: unknown[]): SortedSet<unknown> => new SortedSet(items, compareFor(type) as (a: unknown, b: unknown) => number);
/** A Dict in East's key order. */
const dict = (key: EastType, entries: [unknown, unknown][]): SortedMap<unknown, unknown> =>
  new SortedMap(entries, compareFor(key) as (a: unknown, b: unknown) => number);

const Point = StructType({ x: IntegerType, y: StringType });
const Shape3 = VariantType({ circle: FloatType, point: NullType, square: FloatType });
const Cell = StructType({ region: StringType, week: IntegerType });
const Status = VariantType({ cancelled: StructType({ reason: StringType }), pending: NullType, shipped: StructType({ date: StringType }) });
const Tree = RecursiveType(self => StructType({ children: ArrayType(self), cost: FloatType, sku: StringType }));
const List = RecursiveType(self => VariantType({ cons: StructType({ head: IntegerType, tail: self }), nil: NullType }));
const JsonLike = RecursiveType(self => VariantType({
  arr: ArrayType(self), bool: BooleanType, nul: NullType, num: FloatType, obj: DictType(StringType, self), str: StringType,
}));
const ModelInput = StructType({ price: FloatType, region: StringType });

/** The dates the DateTime shapes hold: the epoch, a millisecond before it, and one with every part set. */
const EPOCH = date(0);
const BEFORE = date(-1);
const LATE = date(Date.UTC(2026, 8, 28, 12, 34, 56, 789));

const leaf = (sku: string, cost: number): unknown => ({ children: [], cost, sku });
const TREE = { children: [{ children: [leaf("C", 3.5)], cost: 2.0, sku: "B" }, leaf("D", 4.0)], cost: 1.0, sku: "A" };
const cons = (head: bigint, tail: unknown): unknown => variant("cons", { head, tail });
const LIST = cons(1n, cons(2n, cons(3n, variant("nil", null))));
const JSON_LIKE = variant("obj", dict(StringType, [
  ["a", variant("arr", [variant("num", 1.5), variant("bool", true), variant("nul", null)] as unknown[])],
  ["b", variant("str", "x")],
]));

/**
 * The function values: each compiled for a host run, and built again in a
 * compliance test's own body, where a closure captures one of its variables.
 */
const addOne = () => East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
const demand = () => East.function([ModelInput], FloatType, ($, input) => input.price.multiply(2.0));
/** A closure: a function another makes, capturing its argument. */
const makeAdder = East.function([IntegerType], FunctionType([IntegerType], IntegerType), ($, n) => East.function([IntegerType], IntegerType, ($2, x) => x.add(n)));
const ADD_ONE: ShapeValue = { label: "add-one", value: East.compile(addOne(), []), bind: $ => $.let(addOne()) };
const ADD_TEN: ShapeValue = {
  label: "closure",
  value: East.compile(makeAdder, [])(10n),
  bind: $ => {
    const offset = $.const(10n);
    return $.let(East.function([IntegerType], IntegerType, ($2, x) => x.add(offset)));
  },
};
const DEMAND: ShapeValue = { label: "demand", value: East.compile(demand(), []), bind: $ => $.let(demand()) };

/** Every input of the matrix. */
export const SHAPES: readonly Shape[] = [
  // ── Scalars ───────────────────────────────────────────────────────────
  ...kind("scalars", [
    shape("null", NullType, [["null", null]]),
    shape("boolean", BooleanType, [["true", true], ["false", false]]),
    shape("integer", IntegerType, [["zero", 0n], ["positive", 42n], ["negative", -7n], ["max-exact", 2n ** 53n], ["min-exact", -(2n ** 53n)]]),
    shape("integer-wide", IntegerType, [["max", 2n ** 63n - 1n], ["min", -(2n ** 63n)], ["past-exact", 2n ** 53n + 1n]]),
    shape("float", FloatType, [["zero", 0], ["negative-zero", -0], ["half", 1.5], ["negative", -2.25], ["large", 1e300], ["subnormal", 5e-324]]),
    shape("float-special", FloatType, [["nan", NaN], ["infinity", Infinity], ["negative-infinity", -Infinity]]),
    shape("string", StringType, [["empty", ""], ["ascii", "abcab"], ["accented", "héllo wörld"], ["non-bmp", "𝄞 clef"], ["cjk", "日本語"]]),
    shape("string-escapes", StringType, [["escapes", "tab\tquote\"back\\slash"]]),
    shape("datetime", DateTimeType, [["epoch", EPOCH], ["before-epoch", BEFORE], ["late", LATE]]),
    shape("blob", BlobType, [["empty", new Uint8Array([])], ["bytes", new Uint8Array([0, 255, 127])], ["text", new TextEncoder().encode("hello")]]),
  ]),

  // ── Arrays ────────────────────────────────────────────────────────────
  ...kind("arrays", [
    shape("array-integer", ArrayType(IntegerType), [["empty", []], ["values", [3n, 1n, 2n, 1n]]], { element: "1", elementValue: 1n }),
    shape("array-float", ArrayType(FloatType), [["values", [2.5, -0, 0, 1.0]]], { element: "1.0", elementValue: 1.0 }),
    shape("array-float-special", ArrayType(FloatType), [["specials", [NaN, 1.5, Infinity, -Infinity]]], { element: "1.5", elementValue: 1.5 }),
    shape("array-string", ArrayType(StringType), [["values", ["b", "a", "", "b"]]], { element: "\"a\"", elementValue: "a" }),
    shape("array-boolean", ArrayType(BooleanType), [["values", [true, false, true]]], { element: "true", elementValue: true }),
    shape("array-datetime", ArrayType(DateTimeType), [["values", [LATE, EPOCH, BEFORE]]], { element: "\"1970-01-01T00:00:00.000Z\"", elementValue: EPOCH }),
    shape("array-option-integer", ArrayType(OptionType(IntegerType)), [["values", [some(1n), none, some(3n)]]], { element: "null", elementValue: none }),
    shape("array-array-integer", ArrayType(ArrayType(IntegerType)), [["ragged", [[1n], [], [2n, 3n]]], ["square", [[1n, 2n], [3n, 4n]]]], { element: "[1]", elementValue: [1n] }),
    shape("array-struct", ArrayType(Point), [["values", [{ x: 2n, y: "b" }, { x: 1n, y: "a" }, { x: 2n, y: "a" }]]], { element: "{x: 1, y: \"a\"}", elementValue: { x: 1n, y: "a" } }),
    shape("array-variant", ArrayType(Shape3), [["values", [variant("square", 2.0), variant("circle", 1.5), variant("point", null)]]]),
    shape("array-never", ArrayType(NeverType), [["empty", []]]),
    shape("array-blob", ArrayType(BlobType), [["values", [new Uint8Array([255]), new Uint8Array([]), new Uint8Array([0, 1])]]]),
  ]),

  // ── Sets ──────────────────────────────────────────────────────────────
  ...kind("sets", [
    shape("set-integer", SetType(IntegerType), [["empty", set(IntegerType, [])], ["values", set(IntegerType, [3n, 1n, 2n])]], { element: "2", elementValue: 2n }),
    shape("set-float", SetType(FloatType), [["values", set(FloatType, [NaN, 1.5, -0, 0])]], { element: "1.5", elementValue: 1.5 }),
    shape("set-string", SetType(StringType), [["values", set(StringType, ["b", "a", ""])]], { element: "\"a\"", elementValue: "a" }),
    shape("set-datetime", SetType(DateTimeType), [["values", set(DateTimeType, [LATE, EPOCH])]], { element: "\"1970-01-01T00:00:00.000Z\"", elementValue: EPOCH }),
    shape("set-struct", SetType(Point), [["values", set(Point, [{ x: 2n, y: "b" }, { x: 1n, y: "a" }])]], { element: "{x: 1, y: \"a\"}", elementValue: { x: 1n, y: "a" } }),
    shape("set-variant", SetType(Shape3), [["values", set(Shape3, [variant("square", 2.0), variant("point", null), variant("circle", 1.5)])]]),
  ]),

  // ── Dicts ─────────────────────────────────────────────────────────────
  ...kind("dicts", [
    shape("dict-string-integer", DictType(StringType, IntegerType),
      [["empty", dict(StringType, [])], ["values", dict(StringType, [["b", 2n], ["a", 1n], ["c", 3n]])]], { key: "\"a\"", keyValue: "a", missing: "\"zz\"", missingValue: "zz" }),
    shape("dict-string-option-float", DictType(StringType, OptionType(FloatType)),
      [["values", dict(StringType, [["x", some(1.5)], ["y", none]])]], { key: "\"x\"", keyValue: "x", missing: "\"zz\"", missingValue: "zz" }),
    shape("dict-string-array", DictType(StringType, ArrayType(IntegerType)),
      [["values", dict(StringType, [["k", [1n, 2n]], ["e", []]])]], { key: "\"k\"", keyValue: "k", missing: "\"zz\"", missingValue: "zz" }),
    shape("dict-string-dict", DictType(StringType, DictType(StringType, IntegerType)),
      [["values", dict(StringType, [["outer", dict(StringType, [["inner", 1n]])]])]], { key: "\"outer\"", keyValue: "outer", missing: "\"zz\"", missingValue: "zz" }),
    shape("dict-string-struct", DictType(StringType, Point),
      [["values", dict(StringType, [["p", { x: 1n, y: "a" }], ["q", { x: 2n, y: "b" }]])]], { key: "\"p\"", keyValue: "p", missing: "\"zz\"", missingValue: "zz" }),
    shape("dict-integer-string", DictType(IntegerType, StringType),
      [["values", dict(IntegerType, [[10n, "ten"], [2n, "two"], [-1n, "minus one"]])]], { key: "2", keyValue: 2n, missing: "99", missingValue: 99n }),
    shape("dict-float-string", DictType(FloatType, StringType),
      [["values", dict(FloatType, [[1.5, "one and a half"], [-0, "negative zero"], [NaN, "nan"]])]], { key: "1.5", keyValue: 1.5, missing: "9.5", missingValue: 9.5 }),
    shape("dict-boolean-integer", DictType(BooleanType, IntegerType),
      [["values", dict(BooleanType, [[true, 1n], [false, 0n]])]], { key: "true", keyValue: true }),
    shape("dict-datetime-float", DictType(DateTimeType, FloatType),
      [["values", dict(DateTimeType, [[LATE, 2.5], [EPOCH, 1.0]])]], { key: "\"1970-01-01T00:00:00.000Z\"", keyValue: EPOCH, missing: "\"2000-01-01T00:00:00.000Z\"", missingValue: date(Date.UTC(2000, 0, 1)) }),
    shape("dict-blob-integer", DictType(BlobType, IntegerType),
      [["values", dict(BlobType, [[new Uint8Array([2]), 2n], [new Uint8Array([1, 0]), 1n]])]]),
    shape("dict-struct-float", DictType(Cell, FloatType),
      [["values", dict(Cell, [[{ region: "NSW", week: 2n }, 20.0], [{ region: "NSW", week: 1n }, 10.0], [{ region: "VIC", week: 1n }, 5.0]])]],
      { key: "{region: \"NSW\", week: 1}", keyValue: { region: "NSW", week: 1n }, missing: "{region: \"QLD\", week: 1}", missingValue: { region: "QLD", week: 1n } }),
    shape("dict-variant-integer", DictType(Shape3, IntegerType),
      [["values", dict(Shape3, [[variant("square", 2.0), 2n], [variant("point", null), 0n]])]]),
  ]),

  // ── Tensors ───────────────────────────────────────────────────────────
  ...kind("tensors", [
    shape("vector-float", VectorType(FloatType), [["values", new Float64Array([1.5, -2.0, 0.5])], ["empty", new Float64Array([])]], { element: "1.5", elementValue: 1.5 }),
    shape("vector-integer", VectorType(IntegerType), [["values", new BigInt64Array([3n, 1n, 2n])]], { element: "1", elementValue: 1n }),
    shape("vector-boolean", VectorType(BooleanType), [["values", new Uint8ClampedArray([1, 0, 1])]], { element: "true", elementValue: true }),
    shape("matrix-float", MatrixType(FloatType), [["values", matrix(new Float64Array([1, 2, 3, 4, 5, 6]), 2, 3)]]),
    shape("matrix-integer", MatrixType(IntegerType), [["values", matrix(new BigInt64Array([4n, 3n, 2n, 1n]), 2, 2)]]),
  ]),

  // ── Structs ───────────────────────────────────────────────────────────
  ...kind("structs", [
    shape("struct-empty", StructType({}), [["empty", {}]]),
    shape("struct-one", StructType({ a: IntegerType }), [["one", { a: 1n }]], { field: "a" }),
    shape("struct-eight", StructType({ a: IntegerType, b: FloatType, c: StringType, d: BooleanType, e: NullType, f: IntegerType, g: StringType, h: FloatType }),
      [["eight", { a: 1n, b: 2.5, c: "c", d: true, e: null, f: 6n, g: "g", h: -0.5 }]], { field: "c" }),
    shape("struct-nested", StructType({ outer: StructType({ inner: StructType({ x: IntegerType }) }), y: StringType }),
      [["nested", { outer: { inner: { x: 1n } }, y: "s" }]], { field: "outer" }),
    shape("struct-options", StructType({ x: OptionType(IntegerType), y: OptionType(StringType) }),
      [["some-none", { x: some(1n), y: none }], ["none-some", { x: none, y: some("y") }]], { field: "x" }),
    shape("struct-variant", StructType({ id: IntegerType, status: Status }),
      [["pending", { id: 1n, status: variant("pending", null) }], ["shipped", { id: 2n, status: variant("shipped", { date: "2026-09-28" }) }]], { field: "status" }),
    shape("struct-dict", StructType({ name: StringType, tags: DictType(StringType, IntegerType) }),
      [["tags", { name: "n", tags: dict(StringType, [["b", 2n], ["a", 1n]]) }]], { field: "tags" }),
  ]),

  // ── Variants and Options ──────────────────────────────────────────────
  ...kind("variants", [
    shape("variant", Status,
      [["cancelled", variant("cancelled", { reason: "late" })], ["pending", variant("pending", null)], ["shipped", variant("shipped", { date: "2026-09-28" })]],
      { case: "shipped" }),
    shape("variant-scalar", Shape3, [["circle", variant("circle", 1.5)], ["point", variant("point", null)]], { case: "circle" }),
    shape("variant-nested", VariantType({ a: VariantType({ x: IntegerType, y: NullType }), b: NullType }),
      [["a-x", variant("a", variant("x", 1n))], ["a-y", variant("a", variant("y", null))], ["b", variant("b", null)]], { case: "a" }),
    shape("option-integer", OptionType(IntegerType), [["some", some(5n)], ["none", none]]),
    shape("option-string", OptionType(StringType), [["some", some("s")], ["none", none]]),
    shape("option-struct", OptionType(Point), [["some", some({ x: 1n, y: "a" })], ["none", none]], { field: "x" }),
    shape("option-array", OptionType(ArrayType(IntegerType)), [["some", some([1n, 2n])], ["none", none]]),
    shape("option-option-integer", OptionType(OptionType(IntegerType)), [["none", none], ["some-none", some(none)], ["some-some", some(some(1n))]]),
  ]),

  // ── Recursive types ───────────────────────────────────────────────────
  ...kind("recursive", [
    shape("recursive-tree", Tree, [["tree", TREE], ["leaf", leaf("L", 9.0)]]),
    shape("recursive-list", List, [["three", LIST], ["nil", variant("nil", null)]]),
    shape("recursive-json", JsonLike, [["object", JSON_LIKE], ["number", variant("num", 2.0)]]),
    shape("dict-string-tree", DictType(StringType, Tree), [["values", dict(StringType, [["t", leaf("T", 1.0)]])]], { key: "\"t\"", keyValue: "t", missing: "\"zz\"", missingValue: "zz" }),
    shape("set-list", SetType(List), [["values", set(List, [cons(2n, variant("nil", null)), variant("nil", null)])]]),
  ]),

  // ── Refs ──────────────────────────────────────────────────────────────
  ...kind("refs", [
    shape("ref-integer", RefType(IntegerType), [["five", ref(5n)]]),
    shape("ref-array", RefType(ArrayType(IntegerType)), [["values", ref([1n, 2n])]]),
    shape("ref-struct", RefType(StructType({ a: IntegerType })), [["one", ref({ a: 1n })]], { field: "a" }),
  ]),

  // ── Functions ─────────────────────────────────────────────────────────
  ...kind("functions", [
    shape("function-integer", FunctionType([IntegerType], IntegerType), [ADD_ONE, ADD_TEN], { argument: "41", argumentValue: 41n }),
    shape("function-struct", FunctionType([ModelInput], FloatType), [DEMAND], { argument: "{price: 10.0, region: \"NSW\"}", argumentValue: { price: 10.0, region: "NSW" } }),
  ]),

  // ── Composites ────────────────────────────────────────────────────────
  ...kind("composites", [
    shape("composite-orders", ArrayType(StructType({
      attrs: DictType(StringType, OptionType(FloatType)),
      children: ArrayType(StructType({ sku: StringType })),
      id: IntegerType,
      status: Status,
      tags: SetType(StringType),
    })), [["orders", [
      { attrs: dict(StringType, [["w", some(1.5)], ["h", none]]), children: [{ sku: "a" }], id: 1n, status: variant("shipped", { date: "2026-01-02" }), tags: set(StringType, ["x", "y"]) },
      { attrs: dict(StringType, []), children: [], id: 2n, status: variant("pending", null), tags: set(StringType, []) },
    ]]]),
    shape("composite-cells", DictType(Cell, ArrayType(OptionType(FloatType))),
      [["cells", dict(Cell, [[{ region: "NSW", week: 1n }, [some(1.0), none]], [{ region: "VIC", week: 2n }, []]])]],
      { key: "{region: \"NSW\", week: 1}", keyValue: { region: "NSW", week: 1n }, missing: "{region: \"QLD\", week: 1}", missingValue: { region: "QLD", week: 1n } }),
    shape("composite-every-kind", StructType({
      b: BooleanType, d: DateTimeType, di: DictType(StringType, IntegerType), f: FloatType, i: IntegerType, m: MatrixType(IntegerType),
      n: NullType, o: OptionType(IntegerType), r: RefType(IntegerType), s: StringType, st: SetType(StringType), v: VectorType(FloatType),
      va: Shape3, x: BlobType,
    }), [["every-kind", {
      b: true, d: LATE, di: dict(StringType, [["k", 1n]]), f: 1.5, i: 7n, m: matrix(new BigInt64Array([1n, 2n]), 1, 2),
      n: null, o: some(3n), r: ref(4n), s: "s", st: set(StringType, ["z"]), v: new Float64Array([0.5]),
      va: variant("circle", 2.0), x: new Uint8Array([9]),
    }]], { field: "i" }),
  ]),
];
