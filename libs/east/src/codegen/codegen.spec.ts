/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The IR → TypeScript → IR round trip (#628): `toSource` prints a module,
 * the module rebuilds through `East.function`, and the rebuilt IR equals
 * the original up to the normalization the cross-runtime contract allows
 * (loc_ids, canonical variable and label names, recursive type ids).
 *
 * Three legs: hand-written functions covering every node kind and spelling
 * family; every exported `*.examples.ts` example (`/tmp/east-examples-ir`,
 * `npm run export:examples`), which also executes and must compute its
 * declared `returns`; every compliance-corpus program (`/tmp/east-test-ir`,
 * `npm run test:export`). The two exported legs skip when the directories
 * are absent — the three-way sweep in east-py runs them under CI's
 * `EAST_CONFORMANCE_REQUIRED=1`.
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  East, Expr, variant, ref, some, none,
  ArrayType, DictType, FloatType, IntegerType, NullType, OptionType, RecursiveType,
  SetType, StringType, StructType, VariantType, VectorType,
  IRType, EastTypeType, fromJSONFor, equalFor, isVariant, toSource, RAW_ONLY,
} from "../index.js";

// ── the harness ─────────────────────────────────────────────────────────────

const INDEX_URL = new URL("../index.js", import.meta.url).href;
const TMP = mkdtempSync(join(tmpdir(), "east-codegen-"));
/** Set to a directory to keep every printed module (`<label>.mjs`). */
const SAVE_DIR = process.env["EAST_CONFORMANCE_SAVE"];
let moduleCounter = 0;

after(() => rmSync(TMP, { recursive: true, force: true }));

/** Evaluates a printed module and returns its `main` export. */
async function rebuild(source: string): Promise<any> {
  moduleCounter += 1;
  const path = join(TMP, `m${moduleCounter}.mjs`);
  writeFileSync(path, source, "utf-8");
  const mod = await import(pathToFileURL(path).href);
  return mod.main;
}

/**
 * The normalized shape of an IR value: loc_ids zeroed, variables and labels
 * renamed in first-occurrence order, recursive type ids renumbered, bigints
 * as strings — what `east-c ir normalize` erases, erased here in TypeScript.
 */
function canonical(node: any): unknown {
  const variables = new Map<string, string>();
  const labels = new Map<string, string>();
  const recursive = new Map<string, string>();
  const rename = (table: Map<string, string>, name: string, prefix: string): string => {
    let hit = table.get(name);
    if (hit === undefined) {
      hit = `${prefix}${table.size}`;
      table.set(name, hit);
    }
    return hit;
  };
  const walk = (v: any, context: string | null): unknown => {
    if (v === null || v === undefined) return null;
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Uint8Array) return Array.from(v);
    if (Array.isArray(v)) return v.map(x => walk(x, context));
    if (isVariant(v)) {
      const tag = v.type as string;
      if (tag === "Variable") {
        const p = v.value;
        return ["Variable", { type: walk(p.type, "type"), name: rename(variables, p.name, "v"), mutable: p.mutable, captured: p.captured }];
      }
      if (tag === "Recursive" && context === "type") {
        const payload = v.value;
        if (payload.type === "ref") return ["Recursive", ["ref", rename(recursive, String(payload.value), "r")]];
        return ["Recursive", ["wrapper", { id: rename(recursive, String(payload.value.id), "r"), inner: walk(payload.value.inner, "type") }]];
      }
      return [tag, walk(v.value, context)];
    }
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        if (key === "loc_id") { out[key] = "0"; continue; }
        if (key === "label" && typeof v[key] === "object" && "name" in v[key]) {
          out[key] = { name: rename(labels, v[key].name, "L") };
          continue;
        }
        out[key] = walk(v[key], key === "type" || key === "type_parameters" ? "type" : context);
      }
      return out;
    }
    return v;
  };
  return walk(node, null);
}

/** The first path at which two canonical forms differ, or `null`. */
function firstDifference(a: any, b: any, path = "ir"): string | null {
  if (Object.is(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDifference(a[k], b[k], `${path}.${k}`);
      if (d !== null) return d;
    }
    return null;
  }
  return `${path}: ${String(a)} vs ${String(b)}`;
}

/** A host value for a message: bigints, Maps and Sets made printable. */
function show(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    typeof x === "bigint" ? `${x}n` : x instanceof Map ? [...x] : x instanceof Set ? [...x] : x);
}

/** Prints, rebuilds, and checks the rebuilt IR against the original. */
async function roundTrip(fn: any, label: string): Promise<any> {
  const ir = fn.toIR ? fn.toIR().ir : fn;
  const source = toSource(ir, { importFrom: INDEX_URL });
  if (SAVE_DIR) {
    const out = join(SAVE_DIR, `${label}.mjs`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, source, "utf-8");
  }
  assert.equal(toSource(ir, { importFrom: INDEX_URL }), source, `${label}: printing is deterministic`);
  let main: any;
  let rebuilt: unknown;
  try {
    main = await rebuild(source);
    rebuilt = canonical(main.toIR().ir);
  } catch (e) {
    throw new Error(`${label}: the printed module does not rebuild — ${(e as Error).message}\n${source}`);
  }
  const original = canonical(ir);
  const diff = firstDifference(rebuilt, original);
  assert.equal(diff, null, `${label}: rebuilt IR differs (rebuilt vs original) at ${diff}\n${source}`);
  return main;
}

/**
 * Runs `check` over every file, collecting failures, and fails once with
 * the list — one line per failure (the sources are kept under
 * `EAST_CONFORMANCE_SAVE`).
 */
async function sweep(files: string[], labelOf: (file: string) => string, check: (file: string) => Promise<void>): Promise<void> {
  const failures: string[] = [];
  for (const file of files) {
    try {
      await check(file);
    } catch (e) {
      const line = (e as Error).message.split("\n")[0]!;
      failures.push(line.startsWith(labelOf(file)) ? line : `${labelOf(file)}: ${line}`);
    }
  }
  assert.equal(failures.length, 0, `${failures.length} of ${files.length} failed:\n  ${failures.join("\n  ")}`);
}

// ── hand-written coverage of every node kind ────────────────────────────────

describe("codegen: toSource round trips the builder surface", () => {
  test("arithmetic, comparisons and literals", async () => {
    const fn = East.function([IntegerType, FloatType], StringType, ($, n, x) => {
      const twice = $.const(n.multiply(2n).add(1n).subtract(3n));
      const ratio = $.let(x.divide(2.5).add(n.toFloat()).sqrt());
      $.assign(ratio, ratio.negate().abs());
      const flag = $.const(East.less(twice, 10n).bitAnd(East.greaterEqual(ratio, 0.0)).not());
      return East.str`${twice} ${ratio} ${flag} ${East.value("x").length()}`;
    });
    const main = await roundTrip(fn, "arithmetic");
    assert.equal(main.toIR().compile([])(4n, 9.0), fn.toIR().compile([])(4n, 9.0));
  });

  test("statements: if / while / for / match / try / return / break / continue", async () => {
    const Shape = VariantType({ circle: FloatType, square: FloatType, none: NullType });
    const fn = East.function([ArrayType(IntegerType), Shape], IntegerType, ($, xs, shape) => {
      const total = $.let(0n);
      $.for(xs, ($, x, i, label) => {
        $.if(East.equal(x, 0n), $ => { $.continue(label); })
          .elseIf(East.greater(x, 100n), $ => { $.break(label); })
          .else($ => { $.assign(total, total.add(x.multiply(i))); });
      });
      const count = $.let(0n);
      $.while(East.less(count, 3n), ($, label) => {
        $.assign(count, count.add(1n));
        $.if(East.equal(count, 2n), $ => { $.continue(label); });
      });
      $.match(shape, {
        circle: ($, r) => { $.assign(total, total.add(r.toInteger())); },
        square: ($, s) => { $.assign(total, total.subtract(s.toInteger())); },
      });
      $.try($ => {
        $.if(East.less(total, 0n), $ => { $.error("negative"); });
      }).catch(($, message, stack) => {
        $(message.length());
        $.assign(total, stack.size());
      }).finally($ => {
        $.assign(count, 0n);
      });
      $.if(East.equal(total, 7n), $ => { $.return(-1n); });
      $.return(total.add(count));
    });
    const main = await roundTrip(fn, "statements");
    const run = main.toIR().compile([]);
    assert.equal(run([1n, 2n, 0n, 3n], variant("circle", 2.0)), fn.toIR().compile([])([1n, 2n, 0n, 3n], variant("circle", 2.0)));
  });

  test("expressions: ifElse / match / tryCatch / block / nested function / callbacks", async () => {
    const fn = East.function([ArrayType(IntegerType), OptionType(StringType)], StringType, ($, xs, name) => {
      const label = $.const(name.match({ some: ($, s) => s, none: ($) => "anonymous" }));
      const evens = $.const(xs.filter(($, x) => East.equal(x.remainder(2n), 0n)));
      const sum = $.const(evens.reduce(($, acc, x) => acc.add(x), 0n));
      const doubled = $.const(xs.map(($, x) => x.multiply(2n)));
      const big = $.const(East.less(sum, 10n).ifElse($ => "small", $ => Expr.block($ => {
        const s = $.const(East.value("big").concat("!"));
        return s;
      })));
      const safe = $.const(Expr.tryCatch(xs.get(99n), ($, message, stack) => stack.size()));
      const helper = $.const(East.function([IntegerType], IntegerType, ($, y) => y.add(sum)));
      const applied = $.const(helper(safe));
      const grouped = $.const(xs.groupReduce(($, x) => x.remainder(3n), ($, _k) => 0n, ($, acc, x) => acc.add(x)));
      const keys = $.const(grouped.keys().size());
      return East.str`${label} ${big} ${applied} ${doubled.size()} ${keys}`;
    });
    const main = await roundTrip(fn, "expressions");
    const args: [bigint[], any] = [[1n, 2n, 3n, 4n], variant("some", "z")];
    assert.equal(main.toIR().compile([])(...args), fn.toIR().compile([])(...args));
  });

  test("values: struct / variant / array / set / dict / ref / vector / recursive / as", async () => {
    const Point = StructType({ x: FloatType, y: FloatType, "odd-name": IntegerType });
    const ListType = RecursiveType(self => VariantType({ nil: NullType, cons: StructType({ head: IntegerType, tail: self }) }));
    const Wide = VariantType({ a: IntegerType, b: StringType });
    const fn = East.function([IntegerType], IntegerType, ($, n) => {
      const p = $.const(East.value({ x: 1.5, y: 2.5, "odd-name": n }, Point));
      const arr = $.const(East.value([n, n.add(1n)], ArrayType(IntegerType)));
      const set = $.const(East.value(new Set([1n, 2n]), SetType(IntegerType)));
      const dict = $.const(East.value(new Map([["k", n]]), DictType(StringType, IntegerType)));
      const cell = $.const(East.value(ref(n)));
      const vec = $.const(East.value(new Float64Array([1.0, 2.0]), VectorType(FloatType)));
      const nil = $.const(East.wrapRecursive(variant("nil", null), ListType));
      const list = $.const(East.wrapRecursive(variant("cons", { head: n, tail: nil }), ListType));
      const wide = $.const(East.as(East.value(variant("a", n)), Wide));
      const head = $.const(list.unwrap().match({ nil: ($) => 0n, cons: ($, c) => c.head }));
      const unwide = $.const(wide.match({ a: ($, v) => v, b: ($, s) => s.length() }));
      const opt = $.const(some(n), OptionType(IntegerType));
      const nothing = $.const(none, OptionType(IntegerType));
      const picked = $.const(East.value([some(n), none], ArrayType(OptionType(IntegerType))));
      const nested = $.const(new Map([["a", new Set([1n, 2n])], ["b", new Set([3n])]]), DictType(StringType, SetType(IntegerType)));
      const rows = $.const([{ x: 1.5, y: 2.5, "odd-name": n }, { x: 0.0, y: 0.0, "odd-name": 0n }], ArrayType(Point));
      const deep = $.const(some({ x: 1.0, y: 2.0, "odd-name": n }), OptionType(Point));
      return p["odd-name"].add(arr.size()).add(set.size()).add(dict.size()).add(vec.length()).add(head)
        .add(unwide).add(cell.get()).add(opt.unwrap()).add(nothing.match({ some: ($, v) => v, none: ($) => 0n }))
        .add(picked.size()).add(nested.size()).add(rows.size()).add(deep.unwrap()["odd-name"]);
    });
    const source = toSource(fn, { importFrom: INDEX_URL });
    // A bound construction is the host literal with the type on the binding; an Option is `some` / `none`.
    assert.doesNotMatch(source, /\$\.(?:let|const)\(East\.value\(/, source);
    // A type whose source fits on a line prints inline wherever it is used; a recursive one is hoisted.
    assert.match(source, /const p = \$\.const\(\{ x: 1\.5, y: 2\.5, "odd-name": n \}, StructType\(\{ x: FloatType, y: FloatType, "odd-name": IntegerType \}\)\);/);
    assert.match(source, /const dict = \$\.const\(new Map\(\[\["k", n\]\]\), DictType\(StringType, IntegerType\)\);/);
    assert.match(source, /const cell = \$\.const\(ref\(n\), RefType\(IntegerType\)\);/);
    assert.match(source, /const wide = \$\.const\(variant\("a", n\), VariantType\(\{ a: IntegerType, b: StringType \}\)\);/);  // a literal under East.as is retyped, no As node
    assert.match(source, /const opt = \$\.const\(some\(n\), OptionType\(IntegerType\)\);/);
    assert.match(source, /const nothing = \$\.const\(none, OptionType\(IntegerType\)\);/);
    // The binding's type governs the whole literal: a construction nested anywhere inside prints bare.
    assert.match(source, /const picked = \$\.const\(\[some\(n\), none\], ArrayType\(OptionType\(IntegerType\)\)\);/);
    assert.match(source, /const nested = \$\.const\(new Map\(\[\["a", new Set\(\[1n, 2n\]\)\], \["b", new Set\(\[3n\]\)\]\]\), DictType\(StringType, SetType\(IntegerType\)\)\);/);
    assert.match(source, /const rows = \$\.const\(\[\{ x: 1\.5, y: 2\.5, "odd-name": n \}, \{ x: 0, y: 0, "odd-name": 0n \}\], ArrayType\(StructType\(\{ x: FloatType, y: FloatType, "odd-name": IntegerType \}\)\)\);/);
    assert.match(source, /const deep = \$\.const\(some\(\{ x: 1, y: 2, "odd-name": n \}\), OptionType\(StructType\(\{ x: FloatType, y: FloatType, "odd-name": IntegerType \}\)\)\);/);
    assert.doesNotMatch(source, /\$\.const\([^\n]*East\.value\(/, "no East.value inside a bound literal");
    // The module imports exactly what it uses: the literal helpers and type constructors this program spells, nothing else.
    assert.match(source, /^import \{ East, variant, some, none, ref, NullType, IntegerType, FloatType, StringType, ArrayType, SetType, DictType, StructType, VariantType, OptionType, RefType, VectorType, RecursiveType \} from /m);
    assert.doesNotMatch(source, /^const _t\d+ = (?:OptionType|ArrayType|DictType)\(/m);
    assert.match(source, /^const _t\d+ = RecursiveType\(self => /m);  // a recursive type is always hoisted
    assert.match(source, /const nil = \$\.const\(East\.wrapRecursive\(variant\("nil", null\), _t\d+\)\);/);  // the wrapper's inner type governs the wrapped literal
    assert.match(source, /const list = \$\.const\(East\.wrapRecursive\(variant\("cons", \{ head: n, tail: nil \}\), _t\d+\)\);/);
    const main = await roundTrip(fn, "values");
    assert.equal(main.toIR().compile([])(5n), fn.toIR().compile([])(5n));
  });

  test("platform calls, generic platform calls and async functions", async () => {
    const log = East.platform("log", [StringType], NullType);
    const fetchAs = East.asyncGenericPlatform("fetchAs", ["T"], [StringType], "T");
    const sync = East.function([StringType], NullType, ($, s) => {
      $(log(s));
      $(log(East.str`again ${s}`));
    });
    await roundTrip(sync, "platform");
    const fn = East.asyncFunction([StringType], IntegerType, ($, url) => {
      const n = $.const(fetchAs([IntegerType], url));
      return n.add(1n);
    });
    await roundTrip(fn, "async platform");
  });

  test("regex and csv arguments print as the host values the surface takes", async () => {
    const fn = East.function([StringType, ArrayType(StructType({ a: IntegerType }))], StringType, ($, s, rows) => {
      const hit = $.const(s.contains(/a+b/i));
      const idx = $.const(s.indexOf(/x/));
      const rep = $.const(s.replace(/o/, "0"));
      const csv = $.const(rows.encodeCsv({ delimiter: ";", includeHeader: false }));
      const back = $.const(csv.decodeCsv(StructType({ a: IntegerType }), { delimiter: ";", hasHeader: false }));
      return East.str`${hit} ${idx} ${rep} ${back.size()}`;
    });
    const main = await roundTrip(fn, "regex+csv");
    assert.equal(main.toIR().compile([])("aab foo", [{ a: 1n }]), fn.toIR().compile([])("aab foo", [{ a: 1n }]));
  });

  test("another builder's fresh names print as one v_N sequence, and the printed module prints to itself", async () => {
    const fn = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) =>
      xs.map(($, x) => x.multiply(2n)).reduce(($, acc, x) => acc.add(x), 0n));
    // python spells a slot the body did not name `__nN` (TypeScript: `_N`),
    // and an author may have used the printer's own `v_N` spelling.
    const foreign = (v: any): any => Array.isArray(v) ? v.map(foreign)
      : isVariant(v) ? variant(v.type, foreign(v.value))
        : v !== null && typeof v === "object" && !(v instanceof Date) && !(v instanceof Uint8Array)
          ? Object.fromEntries(Object.entries(v).map(([k, x]) =>
            [k, k === "name" && typeof x === "string" ? (/^_\d+$/.test(x) ? `__n${x.slice(1)}` : x === "acc" ? "v_0" : x) : foreign(x)]))
          : v;
    const ir = foreign(fn.toIR().ir);
    const source = toSource(ir, { importFrom: INDEX_URL });
    assert.match(source, /xs\.map\(\(\$, x, v_1\) => x\.multiply\(2n\)\)\.reduce\(\(\$, v_0, x, v_2\) => v_0\.add\(x\), 0n\)/);
    const main = await roundTrip(ir, "foreign names");
    assert.equal(toSource(main.toIR().ir, { importFrom: INDEX_URL }), source, "print → build → print is the identity");
  });

  test("a raw builtin prints through East.builtin and rebuilds", async () => {
    const fn = East.function([ArrayType(IntegerType)], ArrayType(IntegerType), ($, xs) => {
      return xs.getKeys([0n, 1n]);
    });
    const source = toSource(fn, { importFrom: INDEX_URL });
    assert.match(source, /East\.builtin\("ArrayGetKeys"/);
    await roundTrip(fn, "raw builtin");
  });
});

// ── the exported corpora ────────────────────────────────────────────────────

const EXAMPLES_DIR = process.env["EAST_EXAMPLES_IR_DIR"] ?? "/tmp/east-examples-ir";
const CORPUS_DIR = process.env["EAST_TEST_IR_DIR"] ?? "/tmp/east-test-ir";
const REQUIRED = process.env["EAST_CONFORMANCE_REQUIRED"] === "1";

const decodeIR = fromJSONFor(IRType);
const decodeType = fromJSONFor(EastTypeType);

function hasPlatform(node: any): boolean {
  if (node === null || typeof node !== "object") return false;
  if (isVariant(node) && node.type === "Platform") return true;
  if (isVariant(node)) return hasPlatform(node.value);
  if (Array.isArray(node)) return node.some(hasPlatform);
  return Object.keys(node).some(k => k !== "type" && k !== "type_parameters" && hasPlatform(node[k]));
}

describe("codegen: every exported example round trips and runs", () => {
  const present = existsSync(EXAMPLES_DIR);
  if (REQUIRED && !present) throw new Error(`EAST_CONFORMANCE_REQUIRED=1 but no exported examples in ${EXAMPLES_DIR}`);
  const files: string[] = present
    ? readdirSync(EXAMPLES_DIR).flatMap(suite =>
      readdirSync(join(EXAMPLES_DIR, suite)).filter(f => f.endsWith(".json")).map(f => join(EXAMPLES_DIR, suite, f)))
    : [];
  const rawSeen = new Set<string>();

  test(`round trip (${files.length} examples)`, { skip: !present && `no exported examples in ${EXAMPLES_DIR}` }, async () => {
    const labelOf = (file: string): string => `${file.split("/").at(-2)}/${file.split("/").at(-1)!.slice(0, -5)}`;
    await sweep(files, labelOf, async file => {
      const record = JSON.parse(readFileSync(file, "utf-8"));
      const ir = decodeIR(record.ir);
      const label = labelOf(file);
      const source = toSource(ir, { importFrom: INDEX_URL });
      for (const m of source.matchAll(/East\.builtin\("(\w+)"/g)) rawSeen.add(m[1]!);
      const main = await roundTrip(ir, label);
      if (record.async || record.returns === null || record.inputs.some((v: unknown) => v === null) || hasPlatform(ir)) return;
      const inputTypes = record.input_types.map((t: unknown) => decodeType(t));
      const outputType = decodeType(record.output_type);
      const inputs = record.inputs.map((v: unknown, i: number) => fromJSONFor(inputTypes[i])(v));
      const expected = fromJSONFor(outputType)(record.returns);
      const got = main.toIR().compile([])(...inputs);
      assert.ok(equalFor(outputType)(got, expected), `${label}: computed ${show(got)}, the example declares ${show(expected)}`);
    });
    // the raw ratchet: the printer may only ever spell MORE
    for (const name of rawSeen) assert.ok(RAW_ONLY.has(name), `${name} printed raw but is not in RAW_ONLY`);
  });
});

describe("codegen: every compliance-corpus program round trips", () => {
  const present = existsSync(CORPUS_DIR);
  if (REQUIRED && !present) throw new Error(`EAST_CONFORMANCE_REQUIRED=1 but no exported IR corpus in ${CORPUS_DIR}`);
  const files = present ? readdirSync(CORPUS_DIR).filter(f => f.endsWith(".json")).sort() : [];

  test(`round trip (${files.length} programs)`, { skip: !present && `no exported IR corpus in ${CORPUS_DIR}` }, async () => {
    const labelOf = (file: string): string => `corpus/${file.slice(0, -5)}`;
    await sweep(files, labelOf, async file => {
      const record = JSON.parse(readFileSync(join(CORPUS_DIR, file), "utf-8"));
      await roundTrip(decodeIR(record.ir), labelOf(file));
    });
  });
});
