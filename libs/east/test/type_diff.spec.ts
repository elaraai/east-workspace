/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NeverType, NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  RefType, ArrayType, SetType, DictType, VectorType, MatrixType,
  StructType, VariantType, RecursiveType, FunctionType, AsyncFunctionType, OptionType,
  isSubtype, isTypeValueEqual, toEastTypeValue, variant, type EastType, type EastTypeValue,
  diffTypes, diffTypeValues, renderTypeDiff, renderTypePath, printTypeValueSummary,
  typeMismatchError, TypeMismatchError, EastError,
  type TypeDiff, type TypePathSegment,
} from "../src/index.js";

// Equality of a diff's carried subtype against the EastType it should be.
function etvIs(received: EastTypeValue, expected: EastType): boolean {
  return isTypeValueEqual(received, toEastTypeValue(expected));
}

// Assert one diff matches an expected shape down to its carried subtypes — the
// `path` segments, the discriminant fields, and the `actual`/`expected` ETVs.
function assertDiff(
  d: TypeDiff,
  exp: {
    kind: TypeDiff["kind"];
    path: TypePathSegment[];
    actual?: EastType;
    expected?: EastType;
    name?: string;
    actualOrder?: string[];
    expectedOrder?: string[];
    actualCount?: number;
    expectedCount?: number;
  },
): void {
  assert.equal(d.kind, exp.kind, "kind");
  assert.deepEqual(d.path, exp.path, "path");
  if (exp.actual !== undefined) assert.ok(etvIs(d.actual, exp.actual), `actual: got ${printTypeValueSummary(d.actual)}`);
  if (exp.expected !== undefined) assert.ok(etvIs(d.expected, exp.expected), `expected: got ${printTypeValueSummary(d.expected)}`);
  if (exp.name !== undefined) assert.equal((d as Extract<TypeDiff, { name: string }>).name, exp.name, "name");
  if (exp.actualOrder !== undefined) assert.deepEqual((d as Extract<TypeDiff, { kind: "field-order" }>).actualOrder, exp.actualOrder, "actualOrder");
  if (exp.expectedOrder !== undefined) assert.deepEqual((d as Extract<TypeDiff, { kind: "field-order" }>).expectedOrder, exp.expectedOrder, "expectedOrder");
  if (exp.actualCount !== undefined) assert.equal((d as Extract<TypeDiff, { kind: "arity" }>).actualCount, exp.actualCount, "actualCount");
  if (exp.expectedCount !== undefined) assert.equal((d as Extract<TypeDiff, { kind: "arity" }>).expectedCount, exp.expectedCount, "expectedCount");
}

// A linked structure that refers to itself — exercises the equirecursive path.
const IntList = RecursiveType((self) => StructType({ value: IntegerType, next: OptionType(self) }));
const FloatList = RecursiveType((self) => StructType({ value: FloatType, next: OptionType(self) }));
// Mutual self-reference through an array element.
const IntTree = RecursiveType((self) => StructType({ value: IntegerType, children: ArrayType(self) }));
const FloatTree = RecursiveType((self) => StructType({ value: FloatType, children: ArrayType(self) }));

// One instance of every EastType constructor, each built once so reference
// identity is stable (matters for the recursive oracle entries).
const ALL_TYPES: readonly EastType[] = [
  NeverType, NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  RefType(IntegerType),
  ArrayType(IntegerType), ArrayType(FloatType),
  SetType(IntegerType),
  DictType(StringType, IntegerType), DictType(StringType, FloatType),
  VectorType(FloatType), MatrixType(FloatType),
  StructType({ a: IntegerType, b: StringType }),
  StructType({ a: IntegerType, b: StringType, c: BooleanType }),
  VariantType({ x: NullType, y: IntegerType }),
  VariantType({ x: NullType }),
  FunctionType([IntegerType], NullType), FunctionType([FloatType], NullType),
  AsyncFunctionType([IntegerType], NullType),
  IntList, FloatList, IntTree, FloatTree,
  OptionType(IntegerType),
];

test("identical types produce no diff (every constructor)", () => {
  for (const t of ALL_TYPES) {
    assert.deepEqual(diffTypes(t, t), [], `expected no diff for ${printTypeValueSummary(toEastTypeValue(t))}`);
  }
});

test("primitive mismatch carries both leaf types at the root", () => {
  const ds = diffTypes(IntegerType, FloatType);
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "primitive", path: [], actual: IntegerType, expected: FloatType });
});

test("constructor mismatch carries both whole subtypes at the root", () => {
  const ds1 = diffTypes(ArrayType(IntegerType), SetType(IntegerType));
  assert.equal(ds1.length, 1);
  assertDiff(ds1[0]!, { kind: "constructor", path: [], actual: ArrayType(IntegerType), expected: SetType(IntegerType) });

  const ds2 = diffTypes(StructType({ a: IntegerType }), IntegerType);
  assert.equal(ds2.length, 1);
  assertDiff(ds2[0]!, { kind: "constructor", path: [], actual: StructType({ a: IntegerType }), expected: IntegerType });
});

test("Never is assignable to anything; nothing else is assignable to Never", () => {
  assert.deepEqual(diffTypes(NeverType, StructType({ a: IntegerType })), []);
  const ds = diffTypes(StructType({ a: IntegerType }), NeverType);
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "constructor", path: [], actual: StructType({ a: IntegerType }), expected: NeverType });
});

test("invariant containers localize the differing element with its leaf types", () => {
  for (const [wrap, seg] of [
    [ArrayType, { kind: "element" }],
    [SetType, { kind: "element" }],
    [RefType, { kind: "value" }],
    [VectorType, { kind: "element" }],
    [MatrixType, { kind: "element" }],
  ] as const) {
    const ds = diffTypes(wrap(IntegerType), wrap(FloatType));
    assert.equal(ds.length, 1, `${wrap.name} should report one element diff`);
    assertDiff(ds[0]!, { kind: "primitive", path: [seg], actual: IntegerType, expected: FloatType });
  }

  const valDs = diffTypes(DictType(StringType, IntegerType), DictType(StringType, FloatType));
  assert.equal(valDs.length, 1);
  assertDiff(valDs[0]!, { kind: "primitive", path: [{ kind: "value" }], actual: IntegerType, expected: FloatType });

  const keyDs = diffTypes(DictType(StringType, IntegerType), DictType(IntegerType, IntegerType));
  assert.equal(keyDs.length, 1);
  assertDiff(keyDs[0]!, { kind: "primitive", path: [{ kind: "key" }], actual: StringType, expected: IntegerType });
});

test("struct: missing field carries the absent field's expected type", () => {
  const ds = diffTypes(StructType({ a: IntegerType, b: StringType }), StructType({ a: IntegerType, b: StringType, c: BooleanType }));
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "missing-field", path: [], name: "c", expected: BooleanType });
});

test("struct: extra field carries the surplus field's actual type", () => {
  const ds = diffTypes(StructType({ a: IntegerType, b: StringType, c: BooleanType }), StructType({ a: IntegerType, b: StringType }));
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "extra-field", path: [], name: "c", actual: BooleanType });
});

test("struct: same fields in a different order is a field-order diff", () => {
  const ds = diffTypes(StructType({ a: IntegerType, b: StringType }), StructType({ b: StringType, a: IntegerType }));
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "field-order", path: [], actualOrder: ["a", "b"], expectedOrder: ["b", "a"] });
});

test("struct: nested difference localizes to the leaf and prunes matching siblings", () => {
  const actual = StructType({ a: IntegerType, b: StructType({ c: IntegerType, d: StringType }) });
  const expected = StructType({ a: IntegerType, b: StructType({ c: FloatType, d: StringType }) });
  const ds = diffTypes(actual, expected);
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, {
    kind: "primitive",
    path: [{ kind: "field", name: "b" }, { kind: "field", name: "c" }],
    actual: IntegerType,
    expected: FloatType,
  });
});

test("variant: width subtyping, extra case payload, nested payload", () => {
  // Fewer cases is assignable to more (width subtyping) — no diff.
  assert.deepEqual(diffTypes(VariantType({ x: NullType }), VariantType({ x: NullType, y: IntegerType })), []);

  // More cases is not assignable to fewer — the surplus case carries its payload.
  const surplus = diffTypes(VariantType({ x: NullType, y: IntegerType }), VariantType({ x: NullType }));
  assert.equal(surplus.length, 1);
  assertDiff(surplus[0]!, { kind: "extra-case", path: [], name: "y", actual: IntegerType });

  // A shared case with a differing payload localizes into the case.
  const payload = diffTypes(VariantType({ x: IntegerType }), VariantType({ x: FloatType }));
  assert.equal(payload.length, 1);
  assertDiff(payload[0]!, { kind: "primitive", path: [{ kind: "case", name: "x" }], actual: IntegerType, expected: FloatType });
});

test("function: arity carries both input counts", () => {
  const ds = diffTypes(FunctionType([IntegerType], NullType), FunctionType([], NullType));
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "arity", path: [], actualCount: 1, expectedCount: 0 });
});

test("function: input is contravariant and localizes to (arg n)", () => {
  const ds = diffTypes(FunctionType([IntegerType], NullType), FunctionType([FloatType], NullType));
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "primitive", path: [{ kind: "input", index: 0 }], actual: IntegerType, expected: FloatType });
});

test("function: output is covariant and localizes to (ret)", () => {
  const ds = diffTypes(FunctionType([], IntegerType), FunctionType([], FloatType));
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "primitive", path: [{ kind: "output" }], actual: IntegerType, expected: FloatType });
});

test("a sync Function is assignable to an async one, but not vice versa", () => {
  assert.deepEqual(diffTypes(FunctionType([IntegerType], NullType), AsyncFunctionType([IntegerType], NullType)), []);
  const ds = diffTypes(AsyncFunctionType([IntegerType], NullType), FunctionType([IntegerType], NullType));
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "constructor", path: [], actual: AsyncFunctionType([IntegerType], NullType), expected: FunctionType([IntegerType], NullType) });
});

test("OptionType is equivalent to its Variant{none, some} form — no diff either way", () => {
  const asVariant = VariantType({ none: NullType, some: IntegerType });
  assert.deepEqual(diffTypes(OptionType(IntegerType), asVariant), []);
  assert.deepEqual(diffTypes(asVariant, OptionType(IntegerType)), []);
});

test("recursive types: difference localizes to the leaf, with no back-reference spam", () => {
  const ds = diffTypes(IntList, FloatList);
  assert.equal(ds.length, 1, `expected a single leaf diff, got:\n${renderTypeDiff(ds)}`);
  assertDiff(ds[0]!, { kind: "primitive", path: [{ kind: "field", name: "value" }], actual: IntegerType, expected: FloatType });
});

test("mutually-recursive (tree via array) terminates and localizes to the leaf", () => {
  const ds = diffTypes(IntTree, FloatTree);
  assert.equal(ds.length, 1, `expected a single leaf diff, got:\n${renderTypeDiff(ds)}`);
  assertDiff(ds[0]!, { kind: "primitive", path: [{ kind: "field", name: "value" }], actual: IntegerType, expected: FloatType });
});

test("headline: a value bound at Integer where a Struct was expected", () => {
  const Ontology = StructType({
    nodes: ArrayType(StructType({ id: StringType })),
    links: ArrayType(StructType({ id: StringType })),
    metadata: OptionType(StringType),
  });
  const actual = StructType({
    read: FunctionType([], IntegerType),
    write: FunctionType([IntegerType], NullType),
    writeAndStart: FunctionType([IntegerType], NullType),
    source: FunctionType([], IntegerType),
    pending: FunctionType([], BooleanType),
    has: FunctionType([], BooleanType),
  });
  const expected = StructType({
    read: FunctionType([], Ontology),
    write: FunctionType([Ontology], NullType),
    writeAndStart: FunctionType([Ontology], NullType),
    source: FunctionType([], Ontology),
    pending: FunctionType([], BooleanType),
    has: FunctionType([], BooleanType),
  });

  const ds = diffTypes(actual, expected);
  // Exactly the four signatures over the bound type differ; pending/has are pruned.
  assert.equal(ds.length, 4);
  assertDiff(ds[0]!, { kind: "constructor", path: [{ kind: "field", name: "read" }, { kind: "output" }], actual: IntegerType, expected: Ontology });
  assertDiff(ds[1]!, { kind: "constructor", path: [{ kind: "field", name: "write" }, { kind: "input", index: 0 }], actual: IntegerType, expected: Ontology });
  assertDiff(ds[2]!, { kind: "constructor", path: [{ kind: "field", name: "writeAndStart" }, { kind: "input", index: 0 }], actual: IntegerType, expected: Ontology });
  assertDiff(ds[3]!, { kind: "constructor", path: [{ kind: "field", name: "source" }, { kind: "output" }], actual: IntegerType, expected: Ontology });

  // The rendered form collapses to the common cause plus one line per location.
  assert.equal(renderTypeDiff(ds), [
    "all 4 differences: found .Integer where .Struct {nodes, links, metadata} was expected",
    ".read(ret): expected .Struct {nodes, links, metadata}, found .Integer",
    ".write(arg 0): expected .Struct {nodes, links, metadata}, found .Integer",
    ".writeAndStart(arg 0): expected .Struct {nodes, links, metadata}, found .Integer",
    ".source(ret): expected .Struct {nodes, links, metadata}, found .Integer",
  ].join("\n"));
});

test("renderTypePath formats each segment kind exactly", () => {
  assert.equal(renderTypePath([]), "(root)");
  assert.equal(renderTypePath([{ kind: "field", name: "binding" }, { kind: "field", name: "patch" }]), ".binding.patch");
  assert.equal(renderTypePath([{ kind: "case", name: "some" }]), ":some");
  assert.equal(renderTypePath([{ kind: "element" }]), "[element]");
  assert.equal(renderTypePath([{ kind: "key" }]), "[key]");
  assert.equal(renderTypePath([{ kind: "value" }]), "[value]");
  assert.equal(renderTypePath([{ kind: "input", index: 2 }]), "(arg 2)");
  assert.equal(renderTypePath([{ kind: "output" }]), "(ret)");
});

test("printTypeValueSummary stays terse and truncates members", () => {
  const sum = (t: EastType): string => printTypeValueSummary(toEastTypeValue(t));
  assert.equal(sum(IntegerType), ".Integer");
  assert.equal(sum(ArrayType(IntegerType)), ".Array .Integer");
  assert.equal(sum(DictType(StringType, IntegerType)), ".Dict (key=.String, value=.Integer)");
  assert.equal(sum(StructType({ nodes: IntegerType, links: IntegerType, metadata: StringType })), ".Struct {nodes, links, metadata}");
  assert.equal(sum(VariantType({ a: NullType, b: NullType })), ".Variant (a | b)");
  assert.equal(sum(FunctionType([IntegerType], NullType)), ".Function (.Integer) => .Null");
  assert.equal(sum(StructType({ a: IntegerType, b: IntegerType, c: IntegerType, d: IntegerType, e: IntegerType })), ".Struct {a, b, c, d, …+1}");
});

test("maxDiffs caps the number of records", () => {
  const actual = StructType({ a: IntegerType, b: IntegerType, c: IntegerType });
  const expected = StructType({ a: FloatType, b: FloatType, c: FloatType });
  const all = diffTypes(actual, expected);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((d) => d.kind), ["primitive", "primitive", "primitive"]);
  assert.equal(diffTypes(actual, expected, { maxDiffs: 2 }).length, 2);
});

test("every distinct primitive pairing is a single root-level primitive diff", () => {
  const prims: readonly EastType[] = [NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType];
  for (const a of prims) {
    for (const b of prims) {
      if (a === b) {
        assert.deepEqual(diffTypes(a, b), []);
        continue;
      }
      const ds = diffTypes(a, b);
      assert.equal(ds.length, 1, `${printTypeValueSummary(toEastTypeValue(a))} vs ${printTypeValueSummary(toEastTypeValue(b))}`);
      assertDiff(ds[0]!, { kind: "primitive", path: [], actual: a, expected: b });
    }
  }
});

test("variant in an invariant container reports both surplus and required cases", () => {
  const actual = ArrayType(VariantType({ a: NullType, b: IntegerType }));
  const expected = ArrayType(VariantType({ a: NullType, c: StringType }));
  const ds = diffTypes(actual, expected);
  assert.equal(ds.length, 2);
  const byKind = Object.fromEntries(ds.map((d) => [d.kind, d]));
  assertDiff(byKind["extra-case"]!, { kind: "extra-case", path: [{ kind: "element" }], name: "b", actual: IntegerType });
  assertDiff(byKind["missing-case"]!, { kind: "missing-case", path: [{ kind: "element" }], name: "c", expected: StringType });
});

test("variant in a contravariant function input reports a missing case", () => {
  const actual = FunctionType([VariantType({ a: NullType })], NullType);
  const expected = FunctionType([VariantType({ a: NullType, b: IntegerType })], NullType);
  const ds = diffTypes(actual, expected);
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "missing-case", path: [{ kind: "input", index: 0 }], name: "b", expected: IntegerType });
});

test("renderTypeDiff phrases every diff kind", () => {
  assert.equal(renderTypeDiff(diffTypes(IntegerType, FloatType)), "(root): expected .Float, found .Integer");
  assert.equal(renderTypeDiff(diffTypes(ArrayType(IntegerType), SetType(IntegerType))), "(root): expected .Set .Integer, found .Array .Integer");
  assert.equal(renderTypeDiff(diffTypes(StructType({ a: IntegerType }), StructType({ a: IntegerType, b: BooleanType }))), '(root): missing field "b": .Boolean');
  assert.equal(renderTypeDiff(diffTypes(StructType({ a: IntegerType, b: BooleanType }), StructType({ a: IntegerType }))), '(root): unexpected field "b": .Boolean');
  assert.equal(renderTypeDiff(diffTypes(StructType({ a: IntegerType, b: StringType }), StructType({ b: StringType, a: IntegerType }))), "(root): field order differs (expected b, a; found a, b)");
  assert.equal(renderTypeDiff(diffTypes(FunctionType([IntegerType], NullType), FunctionType([], NullType))), "(root): expected 0 arguments, found 1");
  assert.equal(renderTypeDiff(diffTypes(VariantType({ x: NullType, y: IntegerType }), VariantType({ x: NullType }))), '(root): unexpected variant case "y": .Integer');
  assert.equal(renderTypeDiff(diffTypes(ArrayType(VariantType({ a: NullType })), ArrayType(VariantType({ a: NullType, b: IntegerType })))), '[element]: missing variant case "b": .Integer');
});

test("renderTypeDiff: empty input, suppressed lead, and truncation", () => {
  assert.equal(renderTypeDiff([]), "");

  // Two diffs with different leaf pairs ⇒ no common-cause lead.
  const mixed = diffTypes(StructType({ a: IntegerType, b: StringType }), StructType({ a: FloatType, b: DateTimeType }));
  assert.equal(mixed.length, 2);
  const mixedOut = renderTypeDiff(mixed);
  assert.ok(!mixedOut.startsWith("all "), `unexpected common-cause lead: ${mixedOut}`);
  assert.equal(mixedOut.split("\n").length, 2);

  const capped = renderTypeDiff(mixed, { maxShown: 1 });
  assert.equal(capped.split("\n").length, 2);
  assert.match(capped, /…and 1 more$/);
});

test("printTypeValueSummary covers every constructor and depth truncation", () => {
  const s = (t: EastType): string => printTypeValueSummary(toEastTypeValue(t));
  assert.equal(s(NeverType), ".Never");
  assert.equal(s(NullType), ".Null");
  assert.equal(s(BooleanType), ".Boolean");
  assert.equal(s(FloatType), ".Float");
  assert.equal(s(StringType), ".String");
  assert.equal(s(DateTimeType), ".DateTime");
  assert.equal(s(BlobType), ".Blob");
  assert.equal(s(RefType(IntegerType)), ".Ref .Integer");
  assert.equal(s(SetType(IntegerType)), ".Set .Integer");
  assert.equal(s(VectorType(FloatType)), ".Vector .Float");
  assert.equal(s(MatrixType(FloatType)), ".Matrix .Float");
  assert.equal(s(AsyncFunctionType([IntegerType], NullType)), ".AsyncFunction (.Integer) => .Null");
  assert.equal(s(IntList), ".Recursive .Struct {value, next}");
  assert.equal(printTypeValueSummary(variant("Recursive", variant("ref", 3n)) as EastTypeValue), ".Recursive ref(3)");
  assert.equal(printTypeValueSummary(toEastTypeValue(ArrayType(IntegerType)), 0), ".Array …");
  assert.equal(printTypeValueSummary(toEastTypeValue(DictType(StringType, IntegerType)), 0), ".Dict …");
});

test("recursive: vs non-recursive, identical-but-rebuilt, and a non-leaf body difference", () => {
  // A recursive type unfolds against a concrete head.
  const a = diffTypes(IntList, IntegerType);
  assert.equal(a.length, 1);
  assert.equal(a[0]!.kind, "constructor");
  assert.deepEqual(a[0]!.path, []);

  // An independently-built but identical recursive type is the same type.
  const IntList2 = RecursiveType((self) => StructType({ value: IntegerType, next: OptionType(self) }));
  assert.equal(isSubtype(IntList, IntList2), true);
  assert.deepEqual(diffTypes(IntList, IntList2), []);

  // A structural (non-leaf) difference inside the recursive body localizes.
  const IntListTagged = RecursiveType((self) => StructType({ value: IntegerType, next: OptionType(self), tag: StringType }));
  const ds = diffTypes(IntList, IntListTagged);
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, { kind: "missing-field", path: [], name: "tag", expected: StringType });
});

test("path threads correctly through mixed segment kinds", () => {
  const actual = DictType(StringType, ArrayType(VariantType({ hit: StructType({ x: IntegerType }) })));
  const expected = DictType(StringType, ArrayType(VariantType({ hit: StructType({ x: FloatType }) })));
  const ds = diffTypes(actual, expected);
  assert.equal(ds.length, 1);
  assertDiff(ds[0]!, {
    kind: "primitive",
    path: [{ kind: "value" }, { kind: "element" }, { kind: "case", name: "hit" }, { kind: "field", name: "x" }],
    actual: IntegerType,
    expected: FloatType,
  });
  assert.equal(renderTypePath(ds[0]!.path), "[value][element]:hit.x");
});

test("typeMismatchError builds a diff-carrying EastError (assignability path)", () => {
  const actual = StructType({ a: IntegerType, b: StringType });
  const expected = StructType({ a: FloatType, b: StringType });
  const err = typeMismatchError(actual, expected);
  assert.ok(err instanceof TypeMismatchError);
  assert.ok(err instanceof EastError);
  assert.equal(err.actual, actual);
  assert.equal(err.expected, expected);
  assert.equal(err.diffs?.length, 1);
  assertDiff(err.diffs![0]!, { kind: "primitive", path: [{ kind: "field", name: "a" }], actual: IntegerType, expected: FloatType });
  assert.match(err.message, /\.a: expected \.Float, found \.Integer/);
  assert.deepEqual(err.location, []);
});

test("TypeMismatchError keeps the unify-path API (reason / path / addPathSegment)", () => {
  const err = new TypeMismatchError("incompatible types");
  assert.ok(err instanceof EastError);
  assert.equal(err.reason, "incompatible types");
  assert.deepEqual(err.path, []);
  assert.equal(err.actual, undefined);
  err.addPathSegment(".foo");
  err.addPathSegment("[0]");
  assert.deepEqual(err.path, ["[0]", ".foo"]);
  assert.equal(err.message, "at [0].foo: incompatible types");
  assert.equal(err.toString().split("\n")[0], "TypeMismatchError: at [0].foo: incompatible types");
});

// The completeness guarantee: a diff is empty exactly when `actual` is a subtype
// of `expected`. Delegating the verdict to `isSubtype` (via `compatible`) means
// the walk can never disagree with East's real assignability relation — this
// pins that across every constructor pairing, including functions and recursion.
test("ORACLE: diff is empty iff isSubtype, across all constructor pairings", () => {
  let checked = 0;
  for (const a of ALL_TYPES) {
    for (const b of ALL_TYPES) {
      const empty = diffTypeValues(toEastTypeValue(a), toEastTypeValue(b)).length === 0;
      const sub = isSubtype(a, b);
      assert.equal(empty, sub, `diff/subtype disagree for ${printTypeValueSummary(toEastTypeValue(a))} <: ${printTypeValueSummary(toEastTypeValue(b))} (diff-empty=${empty}, isSubtype=${sub})`);
      checked++;
    }
  }
  assert.equal(checked, ALL_TYPES.length * ALL_TYPES.length);
});
