/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The host-value rules (#963): host code holding DECODED East values prints,
 * reads, dispatches, collects, compares and types them through East. Each
 * fixture is a shape #962 found and replaced in the renderers, or the one East's
 * skill names (a collection keyed by structs) — the rule fires on the code the
 * sweep replaced, and is silent on its replacement and on host code that holds
 * no East value.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analyze, analyzeProgram } from "./harness.js";
import { allRules, hostValueRuleNames } from "../src/index.js";

const PRELUDE = `import {
  ArrayType, BooleanType, DateTimeType, DictType, FloatType, FunctionType, IntegerType, NullType, OptionType,
  SetType, SortedMap, SortedSet, StringType, StructType, VariantType,
  compareFor, equalFor, parseFor, printFor, some, variant, East, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
const RowType = StructType({ id: StringType, n: IntegerType, x: FloatType, at: DateTimeType, ok: BooleanType, tags: SetType(StringType), v: VariantType({ a: IntegerType, b: StringType }) });
type Row = ValueTypeOf<typeof RowType>;
declare const row: Row;
declare const other: Row;
declare const rows: Row[];
`;

function hits(source: string, ruleName: string) {
  return analyze(`${PRELUDE}${source}`).filter((d) => d.ruleName === ruleName);
}

// ── no-host-print-of-east-values ─────────────────────────────────────────
test("no-host-print-of-east-values: a Float, a DateTime and a struct printed the JavaScript way", () => {
  // The chart keyed its x values this way, so a rule the factory spelled
  // `12.0` never met its band, and a time key read back in local time.
  const src = `export const a = String(row.x);\nexport const b = row.at.toISOString();\nexport const c = \`\${row.x}\`;\nexport const d = JSON.stringify(row);\nexport const e = "key:" + row.x;\n`;
  assert.equal(hits(src, "no-host-print-of-east-values").length, 5);
});

test("no-host-print-of-east-values: silent on East's own printers, and on a String, an Integer or a Boolean", () => {
  const src = `export const a = printFor(FloatType)(row.x);\nexport const b = printFor(DateTimeType)(row.at);\nexport const c = String(row.id);\nexport const d = \`\${row.n}\`;\nexport const e = String(row.ok);\n`;
  assert.equal(hits(src, "no-host-print-of-east-values").length, 0);
});

test("no-host-print-of-east-values: silent on host values", () => {
  const src = `declare const px: number;\nexport const a = String(px);\nexport const b = new Date(0).toISOString();\nexport const c = \`\${px}px\`;\n`;
  assert.equal(hits(src, "no-host-print-of-east-values").length, 0);
});

test("no-host-print-of-east-values: a Float written as a CSS length styles an element — `%`, a spaced unit and a DateTime still print", () => {
  // The chart sized its loading skeleton `${f.height}px`: the browser reads
  // that, and East's `180.0px` or a German `1.234,5px` would be wrong there.
  const silent = `export const h = \`\${row.x}px\`;\nexport const t = \`translate(\${row.x}px, \${row.x}rem) rotate(\${row.x}deg)\`;\nexport const w = \`calc(\${row.x}vh - 1px)\`;\n`;
  assert.equal(hits(silent, "no-host-print-of-east-values").length, 0);
  const printed = `export const pct = \`\${row.x}%\`;\nexport const spaced = \`\${row.x} px\`;\nexport const when = \`\${row.at}px\`;\nexport const word = \`\${row.x}pixels\`;\n`;
  assert.equal(hits(printed, "no-host-print-of-east-values").length, 4);
});

test("no-host-print-of-east-values: follows a const bound to an East value", () => {
  const src = `const x = row.x;\nexport const a = String(x);\n`;
  assert.equal(hits(src, "no-host-print-of-east-values").length, 1);
});

// ── no-host-parse-to-east-values ─────────────────────────────────────────
test("no-host-parse-to-east-values: text read into an East function's argument, a variant, a struct field", () => {
  // The Integer input fired its callback with `BigInt(raw)`: "" became 0,
  // "0x10" became 16, and a value past 64 bits went through.
  const src = `const OnChangeType = FunctionType([IntegerType], NullType);\ndeclare const onChange: ValueTypeOf<typeof OnChangeType>;\ndeclare const raw: string;\nonChange(BigInt(raw));\nexport const v = variant("Integer", BigInt(raw));\nexport const r: Row = { ...row, at: new Date(raw) };\n`;
  assert.equal(hits(src, "no-host-parse-to-east-values").length, 3);
});

test("no-host-parse-to-east-values: text written in the source is its author's — save a zoneless date-time, which new Date reads in local time", () => {
  const src = `export const a: Row = { ...row, at: new Date("2026-06-30T00:00:00Z") };\nexport const b = variant("Integer", BigInt("42"));\nexport const c: Row = { ...row, at: new Date("2026-06-30T00:00:00") };\n`;
  assert.equal(hits(src, "no-host-parse-to-east-values").length, 1);
});

test("no-host-parse-to-east-values: silent on East's parser, and on text read for the host", () => {
  const src = `const OnChangeType = FunctionType([IntegerType], NullType);\ndeclare const onChange: ValueTypeOf<typeof OnChangeType>;\ndeclare const raw: string;\nconst read = parseFor(IntegerType)(raw);\nif (read.success) onChange(read.value);\nexport const width = Number(raw);\nexport const when = new Date(0);\n`;
  assert.equal(hits(src, "no-host-parse-to-east-values").length, 0);
});

// ── no-js-type-dispatch-on-east-values ───────────────────────────────────
test("no-js-type-dispatch-on-east-values: typeof and instanceof on East values", () => {
  // The Table's asFloat asked `typeof cell.value === "bigint"`; the chart asked
  // `instanceof Date` of a DateTime.
  const src = `export const a = typeof row.v.value === "bigint";\nexport const b = row.at instanceof Date;\nexport const c = typeof row.x;\n`;
  assert.equal(hits(src, "no-js-type-dispatch-on-east-values").length, 3);
});

test("no-js-type-dispatch-on-east-values: silent on a variant's tag and on host values", () => {
  const src = `export const a = row.v.type === "a" ? Number(row.v.value) : 0;\ndeclare const tick: unknown;\nexport const b = tick instanceof Date;\nexport const c = typeof tick === "number";\n`;
  assert.equal(hits(src, "no-js-type-dispatch-on-east-values").length, 0);
});

// ── no-js-collection-for-east-collection ─────────────────────────────────
test("no-js-collection-for-east-collection: a JavaScript Set or Map of struct, DateTime or variant keys built for an East Dict, Set or variant payload", () => {
  // JavaScript finds an object key by identity: the struct decoded from the
  // store never finds the entry keyed by an equal struct built here.
  const src = `const KeyType = StructType({ id: StringType });\nconst StateType = StructType({ byKey: DictType(KeyType, IntegerType), days: SetType(DateTimeType) });\nexport const s: ValueTypeOf<typeof StateType> = { byKey: new Map([[{ id: "a" }, 1n]]), days: new Set([row.at]) };\nexport const v = variant("in", new Set([row.v]));\n`;
  assert.equal(hits(src, "no-js-collection-for-east-collection").length, 3);
});

test("no-js-collection-for-east-collection: silent on string, bigint and number keys (East's idiom), on East's own collections and on host sets", () => {
  const src = `const KeyType = StructType({ id: StringType });\nconst StateType = StructType({ tags: SetType(StringType), counts: DictType(StringType, IntegerType), byN: DictType(IntegerType, FloatType), byKey: DictType(KeyType, IntegerType), days: SetType(DateTimeType) });\nexport const s: ValueTypeOf<typeof StateType> = { tags: new Set(["b", "a"]), counts: new Map(), byN: new Map([[2n, 0.5], [1n, 1.5]]), byKey: new SortedMap([[{ id: "a" }, 1n]], compareFor(KeyType)), days: new SortedSet([row.at], compareFor(DateTimeType)) };\nexport const v = variant("in", new Set(["a"]));\nexport const seen = new Set<Row>();\n`;
  assert.equal(hits(src, "no-js-collection-for-east-collection").length, 0);
});

test("an East package's function takes a decoded value where its parameter is written in East's value types — a host one where it is not", () => {
  // A DOM test helper east-ui-components ships takes its rects keyed by
  // element, and a pixel count is a number: both are the host's (#1177). The
  // same package's functions over a struct-keyed Dict and an Integer take
  // decoded values, and a Map or text read the JavaScript way is still flagged.
  const dir = process.cwd();
  const entry = join(dir, "__east_package_helpers_entry__.ts");
  const files = {
    [join(dir, "node_modules/@elaraai/helpers-fixture/index.d.ts")]: [
      `declare module "@elaraai/helpers-fixture" {`,
      `  import type { DictType, IntegerType, StringType, StructType, ValueTypeOf } from "@elaraai/east";`,
      `  export class Widget { readonly id: string }`,
      `  export interface Rect { left: number; width: number }`,
      `  export function layOut(rects: ReadonlyMap<Widget, Rect>): void;`,
      `  export function widthOf(px: number): void;`,
      `  export type ByKey = ValueTypeOf<DictType<StructType<{ id: StringType }>, IntegerType>>;`,
      `  export function seed(byKey: ByKey): void;`,
      `  export function count(n: ValueTypeOf<IntegerType>): void;`,
      `}`,
      ``,
    ].join("\n"),
    [entry]: `${PRELUDE}import { Widget, count, layOut, seed, widthOf } from "@elaraai/helpers-fixture";\ndeclare const widget: Widget;\ndeclare const raw: string;\nlayOut(new Map([[widget, { left: 0, width: 1 }]]));\nwidthOf(Number(raw));\nseed(new Map([[{ id: "a" }, 1n]]));\ncount(BigInt(raw));\n`,
  };
  const found = analyzeProgram(files, entry, {});
  const text = files[entry]!;
  /** Each finding of `rule`, as the call it sits in. */
  const calls = (rule: string) => found.filter((d) => d.ruleName === rule).map((d) => text.slice(text.lastIndexOf("\n", d.start) + 1, d.start));
  assert.deepEqual(calls("no-js-collection-for-east-collection"), ["seed("]);
  assert.deepEqual(calls("no-host-parse-to-east-values"), ["count("]);
});

// ── no-host-comparison-on-east-values (extended) ─────────────────────────
test("no-host-comparison-on-east-values: a decoded option, a DateTime's identity, a subtracting comparator", () => {
  // Decoded through ValueTypeOf, an option carries no `variant` alias — only its
  // [variant_symbol]; the queue sorted by `b.value - a.value`.
  const src = `const OptionalInt = OptionType(IntegerType);\ndeclare const a: ValueTypeOf<typeof OptionalInt>;\ndeclare const b: ValueTypeOf<typeof OptionalInt>;\nexport const same = a === b;\nexport const at = row.at === other.at;\nexport const sorted = [...rows].sort((p, q) => q.x - p.x);\n`;
  assert.equal(hits(src, "no-host-comparison-on-east-values").length, 3);
});

test("no-host-comparison-on-east-values: silent on East's comparators, presence checks, tags, host sorts and a stated identity", () => {
  // A fold that hands back the struct it was given unchanged is checked by
  // identity on purpose, and says so with Object.is.
  const src = `const compareFloats = compareFor(FloatType);\nexport const sorted = [...rows].sort((p, q) => compareFloats(q.x, p.x));\nexport const tag = row.v.type === "a";\nexport const present = row.v !== undefined;\nexport const nums = [3, 1, 2].sort((p, q) => p - q);\nexport const n = row.n === other.n;\ndeclare const fold: (r: Row) => Row;\nexport const unchanged = Object.is(fold(row), row);\n`;
  assert.equal(hits(src, "no-host-comparison-on-east-values").length, 0);
});

// ── no-handrolled-value-type-mirror (extended) ───────────────────────────
test("no-handrolled-value-type-mirror: a `{ type, value }` assertion and an East-typed `*Like` stand-in", () => {
  // The Story cast each child `as unknown as { type: string; value: unknown }`;
  // the Slice engine read its state through `StateLike`.
  const src = `declare const child: unknown;\nexport const tagged = child as { type: string; value: unknown };\ntype V = ValueTypeOf<typeof RowType>["v"];\nexport interface StateLike { v: V; at: Date }\n`;
  assert.equal(hits(src, "no-handrolled-value-type-mirror").length, 2);
});

test("no-handrolled-value-type-mirror: silent on a factory's options interface and a host `*Like`", () => {
  const src = `import type { SubtypeExprOrValue } from "@elaraai/east";\nexport const FooStyleType = StructType({ gap: IntegerType });\nexport interface FooStyle { gap?: SubtypeExprOrValue<IntegerType> }\nexport interface PointLike { x: number; y: number }\n`;
  assert.equal(hits(src, "no-handrolled-value-type-mirror").length, 0);
});

test("no-handrolled-value-type-mirror: silent on a declaration whose method builds IR beside its wire type — and a value's mirror with a method still flagged", () => {
  // e3-ui's Flowchart.details hands back FlowchartDetails, whose build() closes
  // the reads into a FlowchartDetailsType: a declaration of IR, never a decoded
  // value (#1507).
  const declared = `export const FooDetailsType = StructType({ gap: IntegerType });\nexport interface FooDetails { readonly inspectorReads: boolean; build(where: string): ExprType<typeof FooDetailsType> }\n`;
  assert.equal(hits(declared, "no-handrolled-value-type-mirror").length, 0);
  const mirrored = `export const FooType = StructType({ gap: IntegerType });\nexport interface Foo { gap: bigint; describe(): string }\n`;
  assert.equal(hits(mirrored, "no-handrolled-value-type-mirror").length, 1);
});

// ── no-module-scope-east-macro (scoped) ──────────────────────────────────
test("no-module-scope-east-macro: silent on helpers building decoded values over host data, and on host keys", () => {
  const src = `export const str = (s: string) => variant("String", s);\nexport const present = (n: bigint) => some(n);\nexport const channelKey = (w: string, n: string) => \`func:\${w}:\${n}\`;\nexport const cache = new Map<string, number>();\nexport const hit = cache.get(channelKey("ws", "f"));\n`;
  assert.equal(hits(src, "no-module-scope-east-macro").length, 0);
});

test("no-module-scope-east-macro: still flags helpers building IR, and keys that feed East data", () => {
  const src = `export const wrap = (x: ExprType<IntegerType>) => some(x);\nexport const key = (o: string, l: string) => \`\${o}|\${l}\`;\nexport const seed = East.value(new Map([[key("a", "b"), 1n]]), DictType(StringType, IntegerType));\n`;
  assert.equal(hits(src, "no-module-scope-east-macro").length, 2);
});

// ── no-struct-type-from-object ───────────────────────────────────────────
test("no-struct-type-from-object: a struct built from an object of runtime names, a spread of one, a computed name, a generic object — the entries offered as the list", () => {
  // An object lists a name like an integer ("2024") first wherever it was
  // written, so a pivot by year built this way would put its years first (#1574)
  const src = `import type { EastType } from "@elaraai/east";\ndeclare const years: string[];\ndeclare const byName: Record<string, EastType>;\ndeclare const name: string;\nexport const pivot = StructType(Object.fromEntries(years.map((y) => [y, FloatType] as const)));\nexport const given = StructType(byName);\nexport const spread = StructType({ ...byName, extra: IntegerType });\nexport const computed = StructType({ [name]: IntegerType });\nexport const generic = <F extends Record<string, EastType>>(fields: F) => StructType(fields);\n`;
  const found = hits(src, "no-struct-type-from-object");
  assert.equal(found.length, 5);
  assert.ok(found.every((d) => d.category === "warning"));
  // Object.fromEntries of a list: the list itself is the fix
  const text = `${PRELUDE}${src}`;
  const fix = found[0]!.fix;
  assert.ok(fix !== undefined);
  assert.equal(text.slice(fix.changes[0]!.start, fix.changes[0]!.start + fix.changes[0]!.length), "Object.fromEntries(years.map((y) => [y, FloatType] as const))");
  assert.equal(fix.changes[0]!.newText, "years.map((y) => [y, FloatType] as const)");
  assert.ok(found.slice(1).every((d) => d.fix === undefined), "no list to offer for an object, a spread or a computed name");
});

test("no-struct-type-from-object: an object naming a field like an integer, which StructType refuses — written out, under an alias, spread from a struct that lists one, or named by its type", () => {
  const src = `import { StructType as Struct } from "@elaraai/east";\nexport const a = StructType({ b: IntegerType, "10": StringType });\nexport const b = Struct({ 2024: FloatType });\nconst Counts = StructType([["b", IntegerType], ["10", IntegerType]]);\nexport const c = StructType({ ...Counts.fields, x: IntegerType });\ndeclare const typed: { b: typeof IntegerType; "7": typeof IntegerType };\nexport const d = StructType(typed);\n`;
  const found = hits(src, "no-struct-type-from-object");
  assert.equal(found.length, 4);
  assert.ok(found.every((d) => d.category === "error"));
  assert.match(found[0]!.messageText, /"10"/);
  assert.match(found[1]!.messageText, /"2024"/);
  assert.match(found[2]!.messageText, /"10"/);
  assert.match(found[3]!.messageText, /"7"/);
});

test("no-struct-type-from-object: silent on names written out or named by their type (a const record, a declared struct's fields, a spread of them, a literal key), the list form, a list held in a variable, a struct's own fields mapped as a list, and anything else called StructType", () => {
  const src = `import type { EastType } from "@elaraai/east";\ndeclare const entries: (readonly [string, EastType])[];\nexport const a = StructType({ id: StringType, "n-2": IntegerType, "1.5": FloatType, "007": BooleanType });\nexport const b = StructType([["b", IntegerType], ["10", StringType]]);\nexport const c = StructType(entries);\nexport const d = StructType(Object.entries(RowType.fields).map(([k, v]) => [k, OptionType(v)] as const));\nexport const e = StructType(Object.entries(RowType.fields).filter(([k]) => k !== "id"));\nconst local = { StructType: (o: object) => o };\nexport const f = local.StructType(Object.fromEntries([["x", 1]]));\nconst Fields = { id: StringType, n: IntegerType };\nexport const g = StructType(Fields);\nexport const h = StructType({ ...RowType.fields, extra: IntegerType });\nexport const i = StructType(RowType.fields);\nconst key = "key" as const;\nexport const j = StructType({ [key]: IntegerType });\n`;
  assert.deepEqual(hits(src, "no-struct-type-from-object").map((d) => d.messageText), []);
});

// ── the host-value set ───────────────────────────────────────────────────
test("hostValueRuleNames names the nine host-value rules, and `only` runs just them", () => {
  assert.deepEqual([...hostValueRuleNames].sort(), [
    "no-handrolled-value-type-mirror", "no-handrolled-variant", "no-host-comparison-on-east-values", "no-host-parse-to-east-values",
    "no-host-print-of-east-values", "no-js-collection-for-east-collection", "no-js-type-dispatch-on-east-values", "no-struct-type-from-object", "prefer-some-none",
  ]);
  // Plain names, so every one must name a rule — a rename cannot leave the set behind.
  for (const name of hostValueRuleNames) assert.ok(allRules.some((rule) => rule.name === name), `${name} names a rule`);
  // An IR-authoring finding (a module-scope helper building IR) beside two
  // host-value ones (an option spelled as a variant, a Float printed).
  const src = `${PRELUDE}export const wrap = (x: ExprType<IntegerType>) => some(x);\nexport const o = variant("none", null);\nexport const k = String(row.x);\n`;
  assert.ok(analyze(src).some((d) => d.ruleName === "no-module-scope-east-macro"));
  const only = analyze(src, { only: hostValueRuleNames });
  assert.deepEqual(only.map((d) => d.ruleName).sort(), ["no-host-print-of-east-values", "prefer-some-none"]);
});
