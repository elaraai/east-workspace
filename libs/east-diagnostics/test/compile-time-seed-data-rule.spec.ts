/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const RULE = "no-compile-time-seed-data";

// e3 default import + the east value-constructor / type imports the rule reasons
// about, plus host helpers (`num`/`readCsv`/…) used to build abusive seeds. The
// helpers are unused in most fixtures, which is fine (no `noUnusedLocals`).
const BASE =
  `import e3 from "@elaraai/e3";\n` +
  `import { East, NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType, ArrayType, SetType, DictType, StructType, VariantType, OptionType, VectorType, variant, some, none } from "@elaraai/east";\n` +
  `const num = (s: string): number => Number(s);\n` +
  `const readCsv = (f: string): any[] => [];\n` +
  `const buildSeed = (): Map<string, number> => new Map();\n` +
  `const makeKey = (a: string, b: string): string => a + "|" + b;\n` +
  `const f = (): bigint => 1n;\n` +
  `const BUS = ["o1", "o2"];\n` +
  `const ROLES = ["r1", "r2"];\n` +
  `const ks = ["a", "b"];\n`;

function rule(body: string) {
  return analyze(BASE + body).filter((d) => d.ruleName === RULE);
}
/** A one-liner `e3.input` with an INLINE seed expression. */
const inp = (type: string, seed: string, name = "x") => `export const d = e3.input("${name}", ${type}, ${seed});\n`;

// ===========================================================================
// SILENT — authored constant seeds, across every East type.
// ===========================================================================

// ── scalar primitive defaults ──────────────────────────────────────────────
test("silent: omitted seed (value arrives at runtime)", () => {
  assert.equal(rule(`export const d = e3.input("x", IntegerType);\n`).length, 0);
});
test("silent: Integer literal", () => assert.equal(rule(inp("IntegerType", "5n")).length, 0));
test("silent: negative Integer literal", () => assert.equal(rule(inp("IntegerType", "-5n")).length, 0));
test("silent: Float literal", () => assert.equal(rule(inp("FloatType", "3.14")).length, 0));
test("silent: negative Float literal", () => assert.equal(rule(inp("FloatType", "-1.5")).length, 0));
test("silent: String literal", () => assert.equal(rule(inp("StringType", `"World"`)).length, 0));
test("silent: String constant concatenation", () => assert.equal(rule(inp("StringType", `"a" + "b" + "c"`)).length, 0));
test("silent: String no-substitution template", () => assert.equal(rule(inp("StringType", "`hello`")).length, 0));
test("silent: Boolean true", () => assert.equal(rule(inp("BooleanType", "true")).length, 0));
test("silent: Boolean false", () => assert.equal(rule(inp("BooleanType", "false")).length, 0));
test("silent: Null", () => assert.equal(rule(inp("NullType", "null")).length, 0));

// ── DateTime / Blob / Vector value-representation constructors ──────────────
test("silent: DateTime new Date(string)", () => assert.equal(rule(inp("DateTimeType", `new Date("2026-01-01")`)).length, 0));
test("silent: DateTime new Date(number)", () => assert.equal(rule(inp("DateTimeType", "new Date(0)")).length, 0));
test("silent: Blob new Uint8Array([literals])", () => assert.equal(rule(inp("BlobType", "new Uint8Array([1, 2, 3])")).length, 0));
test("silent: Blob empty new Uint8Array()", () => assert.equal(rule(inp("BlobType", "new Uint8Array()")).length, 0));
test("silent: Vector new Float64Array([literals])", () => assert.equal(rule(inp("VectorType(FloatType)", "new Float64Array([1.0, 2.0])")).length, 0));
test("silent: Vector new BigInt64Array([literals])", () => assert.equal(rule(inp("VectorType(IntegerType)", "new BigInt64Array([1n, 2n])")).length, 0));

// ── collection literals ────────────────────────────────────────────────────
test("silent: empty array", () => assert.equal(rule(inp("ArrayType(IntegerType)", "[]")).length, 0));
test("silent: array of literals", () => assert.equal(rule(inp("ArrayType(IntegerType)", "[1n, 2n, 3n]")).length, 0));
test("silent: array of literal structs", () =>
  assert.equal(rule(inp("ArrayType(StructType({ a: IntegerType, b: StringType }))", `[{ a: 1n, b: "x" }, { a: 2n, b: "y" }]`)).length, 0));
test("silent: empty Map", () => assert.equal(rule(inp("DictType(StringType, IntegerType)", "new Map()")).length, 0));
test("silent: Map with literal entries", () => assert.equal(rule(inp("DictType(StringType, IntegerType)", `new Map([["a", 1n], ["b", 2n]])`)).length, 0));
test("silent: empty Set", () => assert.equal(rule(inp("SetType(StringType)", "new Set()")).length, 0));
test("silent: Set with literal entries", () => assert.equal(rule(inp("SetType(StringType)", `new Set(["a", "b"])`)).length, 0));
test("silent: empty struct object", () => assert.equal(rule(inp("StructType({})", "{}")).length, 0));
test("silent: struct of primitive literals", () =>
  assert.equal(rule(inp("StructType({ threshold: IntegerType, enabled: BooleanType, label: StringType, ratio: FloatType })", `{ threshold: 5n, enabled: true, label: "x", ratio: -0.5 }`)).length, 0));
test("silent: deeply nested all-literal struct", () =>
  assert.equal(rule(inp("StructType({ rows: ArrayType(IntegerType), meta: StructType({ ok: BooleanType }) })", "{ rows: [1n, 2n, 3n], meta: { ok: true } }")).length, 0));

// ── East value constructors (variant / some / none / East.value) ───────────
test("silent: OptionType some(literal)", () => assert.equal(rule(inp("OptionType(IntegerType)", "some(5n)")).length, 0));
test("silent: OptionType none", () => assert.equal(rule(inp("OptionType(IntegerType)", "none")).length, 0));
test("silent: Variant via variant(tag, null)", () => assert.equal(rule(inp("VariantType({ a: NullType, b: IntegerType })", `variant("a", null)`)).length, 0));
test("silent: Variant via variant(tag, literal)", () => assert.equal(rule(inp("VariantType({ a: NullType, b: IntegerType })", `variant("b", 5n)`)).length, 0));
test("silent: East.value(literal)", () => assert.equal(rule(inp("IntegerType", "East.value(5n)")).length, 0));
test("silent: East.value(literal, Type)", () => assert.equal(rule(inp("IntegerType", "East.value(5n, IntegerType)")).length, 0));
test("silent: some(constant concatenation)", () => assert.equal(rule(inp("OptionType(StringType)", `some("a" + "b")`)).length, 0));
test("silent: struct mixing strings + some(...) + variant(...) (the ontology shape)", () =>
  assert.equal(
    rule(
      inp(
        "StructType({ id: StringType, desc: OptionType(StringType), kind: VariantType({ objective: NullType }) })",
        `{ id: "obj-1", desc: some("the objective"), kind: variant("objective", null) }`,
      ),
    ).length,
    0,
  ));
test("silent: template label with a constant identifier substitution (ROLE_LIST shape)", () => {
  const body = `const LABEL = "junior < senior";\n` + inp("OptionType(StringType)", "some(`roles: ${LABEL}`)");
  assert.equal(rule(body).length, 0);
});

// ── named-but-static identifier seeds ──────────────────────────────────────
test("silent: identifier seed resolving to an all-literal object", () => {
  const body = `const def = { a: 1n, b: 2n };\n` + `export const d = e3.input("x", StructType({ a: IntegerType, b: IntegerType }), def);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: identifier seed = Map with literal entries, never mutated", () => {
  const body = `const m = new Map([["a", 1n]]);\n` + `export const d = e3.input("x", DictType(StringType, IntegerType), m);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: identifier seed = empty Map, never filled", () => {
  const body = `const m = new Map();\n` + `export const d = e3.input("x", DictType(StringType, IntegerType), m);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: imperative LITERAL fill outside any loop (authored Map)", () => {
  const body = `const m = new Map();\nm.set("a", 1n);\nm.set("b", 2n);\n` + `export const d = e3.input("x", DictType(StringType, IntegerType), m);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: literal seed wrapped in `as const`", () => assert.equal(rule(inp("StructType({ a: IntegerType })", "{ a: 1n } as const")).length, 0));
test("silent: literal seed wrapped in `satisfies`", () =>
  assert.equal(rule(inp("StructType({ a: IntegerType })", "({ a: 1n } satisfies { a: bigint })")).length, 0));
test("silent: object literal spreading an authored-literal const", () => {
  const body = `const base = { a: 1n, b: 2n };\n` + inp("StructType({ a: IntegerType, b: IntegerType, c: IntegerType })", "{ ...base, c: 3n }");
  assert.equal(rule(body).length, 0);
});

// ── not-our-call / opaque seeds ────────────────────────────────────────────
test("silent: a host-filled value handed to e3.record (not e3.input)", () => {
  const body = `const m = new Map();\nfor (const k of ks) m.set(k, 0);\n` + `export const r = e3.record("x", DictType(StringType, IntegerType), m);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: a host-filled value handed to e3.task (not e3.input)", () => {
  const body = `const m = new Map();\nfor (const k of ks) m.set(k, 0);\n` + `export const tk = e3.task("x", [], DictType(StringType, IntegerType), ($: any) => m as any);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: unrelated local `input` function (not the e3 import)", () => {
  const body = `function input(_a: string, _b: unknown, _c: unknown) { return 0; }\nconst m = new Map();\nfor (const k of ks) m.set(k, 0);\n` + `export const d = input("x", DictType(StringType, IntegerType), m);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: a local object literal named `e3` with an `input` method", () => {
  const body = `const e3local = { input: (_a: string, _b: unknown, _c: unknown) => 0 };\nconst m = new Map();\nfor (const k of ks) m.set(k, 0);\n` + `export const d = e3local.input("x", DictType(StringType, IntegerType), m);\n`;
  // (renamed receiver so the `e3` default import isn't shadowed in the fixture)
  assert.equal(rule(body).length, 0);
});
test("silent: opaque imported seed (unresolvable to a local literal)", () => {
  const body = `import { seed } from "./elsewhere.js";\n` + `export const d = e3.input("x", IntegerType, seed as any);\n`;
  assert.equal(rule(body).length, 0);
});
test("silent: aliased default import with a literal seed", () => {
  const body = `import myE3 from "@elaraai/e3";\n` + `export const d = myE3.input("x", IntegerType, 5n);\n`;
  assert.equal(rule(body).length, 0);
});

// ===========================================================================
// FIRES — host-computed seed data.
// ===========================================================================

// ── inline host computation ────────────────────────────────────────────────
test("fires: inline new Map(readCsv(...)) — host call inside the Map arg", () =>
  assert.equal(rule(inp("DictType(StringType, IntegerType)", `new Map(readCsv("a"))`)).length, 1));
test("fires: inline object literal with a JS builtin call value (Number)", () =>
  assert.equal(rule(inp("StructType({ a: FloatType })", `{ a: Number("1") }`)).length, 1));
test("fires: inline BigInt(Math.round(...)) seed", () =>
  assert.equal(rule(inp("IntegerType", "BigInt(Math.round(1.2))")).length, 1));
test("fires: inline array literal containing a host call", () =>
  assert.equal(rule(inp("ArrayType(IntegerType)", "[f(), f()]")).length, 1));
test("fires: inline bare host call seed", () =>
  assert.equal(rule(inp("DictType(StringType, IntegerType)", "buildSeed()")).length, 1));
test("fires: inline object with a host-computed (key-builder) computed property name", () =>
  assert.equal(rule(inp("DictType(StringType, IntegerType)", `{ [makeKey("a", "b")]: 1n }`)).length, 1));
test("fires: inline Map literal whose entry value is a host call", () =>
  assert.equal(rule(inp("DictType(StringType, FloatType)", `new Map([["a", num("1")]])`)).length, 1));
test("fires: inline new (non-value-ctor) class", () => {
  const body = `class Thing {}\n` + inp("IntegerType", "new Thing() as any");
  assert.equal(rule(body).length, 1);
});

// ── identifier seed, host-computed initializer ─────────────────────────────
test("fires: identifier seed = a bare host call", () => {
  const body = `const s = buildSeed();\n` + `export const d = e3.input("x", DictType(StringType, IntegerType), s);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: identifier seed = object literal of host calls (the leversSeed shape)", () => {
  const body = `const s = { a: num("1"), b: num("2") };\n` + `export const d = e3.input("x", StructType({ a: FloatType, b: FloatType }), s);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: identifier seed = struct with BigInt(Math.round(num(...))) (the engineSeed shape)", () => {
  const body = `const s = { seed: BigInt(Math.round(num("42"))) };\n` + `export const d = e3.input("x", StructType({ seed: IntegerType }), s);\n`;
  assert.equal(rule(body).length, 1);
});

// ── identifier seed, host-FILLED (loop / host-valued mutation) ──────────────
test("fires: empty Map filled by a for-of loop", () => {
  const body = `const m = new Map();\nfor (const k of ks) m.set(k, 0);\n` + `export const d = e3.input("x", DictType(StringType, IntegerType), m);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: empty Map filled by a loop over readCsv() with host-call values", () => {
  const body = `const m = new Map();\nfor (const r of readCsv("a")) m.set(r.k, num(r.v));\n` + `export const d = e3.input("x", DictType(StringType, FloatType), m);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: empty array filled by a counting for-loop push", () => {
  const body = `const a: bigint[] = [];\nfor (let i = 0n; i < 3n; i++) a.push(i);\n` + `export const d = e3.input("x", ArrayType(IntegerType), a);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: Map .set with a host-call value OUTSIDE a loop", () => {
  const body = `const m = new Map();\nm.set("a", num("1"));\n` + `export const d = e3.input("x", DictType(StringType, FloatType), m);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: object filled by element-access assignment inside a loop", () => {
  const body = `const o: any = {};\nfor (const k of ks) o[k] = 0;\n` + `export const d = e3.input("x", DictType(StringType, IntegerType), o);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: aliased default import with a host-filled seed (alias-robust)", () => {
  const body = `import myE3 from "@elaraai/e3";\nconst m = new Map();\nfor (const k of ks) m.set(k, 0);\n` + `export const d = myE3.input("x", DictType(StringType, IntegerType), m);\n`;
  assert.equal(rule(body).length, 1);
});

// ── exactly-one-diagnostic + the full inputs.ts pattern ────────────────────
test("fires exactly once per e3.input (no duplicate diagnostics)", () => {
  const body = `const m = new Map();\nfor (const k of ks) m.set(k, 0);\n` + `export const d = e3.input("x", DictType(StringType, IntegerType), m);\n`;
  const hits = rule(body);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.ruleName, RULE);
});
test("fires: the real inputs.ts pattern — Cartesian prefill + CSV overlay + key-builder + num", () => {
  const body =
    `const buRoleKey = (o: string, l: string): string => o + "|" + l;\n` +
    `const fy26Seed = new Map<string, number>();\n` +
    `for (const o of BUS) for (const l of ROLES) fy26Seed.set(buRoleKey(o, l), 0);\n` +
    `for (const r of readCsv("fy26.csv")) fy26Seed.set(buRoleKey(r.business_unit, r.role), num(r.hours));\n` +
    `export const fy26 = e3.input("fy26_actuals", DictType(StringType, FloatType), fy26Seed);\n`;
  assert.equal(rule(body).length, 1);
});
test("fires: two host-built inputs in one file → two diagnostics", () => {
  const body =
    `const a = new Map();\nfor (const k of ks) a.set(k, 0);\n` +
    `const b = { x: num("1") };\n` +
    `export const da = e3.input("a", DictType(StringType, IntegerType), a);\n` +
    `export const db = e3.input("b", StructType({ x: FloatType }), b);\n`;
  assert.equal(rule(body).length, 2);
});
