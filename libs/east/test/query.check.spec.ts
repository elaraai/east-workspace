/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The jq checker and its builtin catalog (#921): every corpus case's element
 * type, multiplicity and diagnostics with their fixes (C1); narrowing and its
 * fix (C2); the stages of the query editor's default query (C3); e3 roots
 * (C4); the check-time rewrites; inference by fixpoint; and the catalog against
 * jq 1.8.1's own list of builtins. The bundle test (C5) is
 * query.bundle.spec.ts. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ArrayType, DateTimeType, DictType, FloatType, IntegerType, OptionType, QueryType, StringType, StructType,
  checkJq, decodeBeast2, equalFor, fromEastTypeValue, isTypeEqual, parseJq, printJq, printType,
  type EastType, type JqNode,
} from "../src/index.js";
import { DateTimeFormatTokenType } from "../src/datetime_format/types.js";
import { BUILTINS } from "../src/query/jq/catalog.js";
import { MESSAGES } from "../src/query/jq/messages.js";
import { jqChildren } from "../src/query/jq/spans.js";
import { QUERY_CORPUS, messageTemplates, withCatalogTables, type QueryCorpusCase } from "./query.corpus.js";
import { FixtureRoot, Order } from "./query.fixture.js";

/** jq 1.8.1's builtins and their arities: `jq -n 'builtins'`, less its `_` helpers. */
const JQ_1_8_1_BUILTINS: Readonly<Record<string, readonly number[]>> = {
  abs: [0], acos: [0], acosh: [0], add: [0, 1], all: [0, 1, 2], any: [0, 1, 2], arrays: [0], ascii_downcase: [0],
  ascii_upcase: [0], asin: [0], asinh: [0], atan: [0], atan2: [2], atanh: [0], booleans: [0], bsearch: [1],
  builtins: [0], capture: [1, 2], cbrt: [0], ceil: [0], combinations: [0, 1], contains: [1], copysign: [2], cos: [0],
  cosh: [0], debug: [0, 1], del: [1], delpaths: [1], drem: [2], empty: [0], endswith: [1], env: [0], erf: [0],
  erfc: [0], error: [0, 1], exp: [0], exp10: [0], exp2: [0], explode: [0], expm1: [0], fabs: [0], fdim: [2],
  finites: [0], first: [0, 1], flatten: [0, 1], floor: [0], fma: [3], fmax: [2], fmin: [2], fmod: [2], format: [1],
  frexp: [0], from_entries: [0], fromdate: [0], fromdateiso8601: [0], fromjson: [0], fromstream: [1], gamma: [0],
  get_jq_origin: [0], get_prog_origin: [0], get_search_list: [0], getpath: [1], gmtime: [0], group_by: [1],
  gsub: [2, 3], halt: [0], halt_error: [0, 1], has: [1], have_decnum: [0], have_literal_numbers: [0], hypot: [2],
  implode: [0], IN: [1, 2], in: [1], INDEX: [1, 2], index: [1], indices: [1], infinite: [0], input: [0],
  input_filename: [0], input_line_number: [0], inputs: [0], inside: [1], isempty: [1], isfinite: [0],
  isinfinite: [0], isnan: [0], isnormal: [0], iterables: [0], j0: [0], j1: [0], jn: [2], JOIN: [2, 3, 4], join: [1],
  keys: [0], keys_unsorted: [0], last: [0, 1], ldexp: [2], length: [0], lgamma: [0], lgamma_r: [0], limit: [2],
  localtime: [0], log: [0], log10: [0], log1p: [0], log2: [0], logb: [0], ltrim: [0], ltrimstr: [1], map: [1],
  map_values: [1], match: [1, 2], max: [0], max_by: [1], min: [0], min_by: [1], mktime: [0], modf: [0],
  modulemeta: [0], nan: [0], nearbyint: [0], nextafter: [2], nexttoward: [2], normals: [0], not: [0], now: [0],
  nth: [1, 2], nulls: [0], numbers: [0], objects: [0], path: [1], paths: [0, 1], pick: [1], pow: [2],
  range: [1, 2, 3], recurse: [0, 1, 2], remainder: [2], repeat: [1], reverse: [0], rindex: [1], rint: [0],
  round: [0], rtrim: [0], rtrimstr: [1], scalars: [0], scalb: [2], scalbln: [2], scan: [1, 2], select: [1],
  setpath: [2], significand: [0], sin: [0], sinh: [0], skip: [2], sort: [0], sort_by: [1], split: [1, 2],
  splits: [1, 2], sqrt: [0], startswith: [1], stderr: [0], strflocaltime: [1], strftime: [1], strings: [0],
  strptime: [1], sub: [2, 3], tan: [0], tanh: [0], test: [1, 2], tgamma: [0], to_entries: [0], toboolean: [0],
  todate: [0], todateiso8601: [0], tojson: [0], tonumber: [0], tostream: [0], tostring: [0], transpose: [0],
  trim: [0], trimstr: [1], trunc: [0], truncate_stream: [1], type: [0], unique: [0], unique_by: [1], until: [2],
  utf8bytelength: [0], values: [0], walk: [1], while: [2], with_entries: [1], y0: [0], y1: [0], yn: [2],
};

/** East's additions to jq's builtins (`devdocs/QUERY.md` §7 and §9). */
const EAST_ADDITIONS: readonly string[] = [
  "call", "calls", "captures", "datetime_add", "datetime_diff", "day", "epoch_ms", "hour", "millisecond", "minute",
  "month", "second", "signature", "source", "weekday", "year",
];

// A Windows checkout may give the document CRLF line endings; the tables are written with LF.
const doc = readFileSync(new URL("../../devdocs/QUERY.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");

/** The deviations `devdocs/QUERY.md` §13 lists, by number: its `### 13.N` headings. */
const DEVIATIONS = [...doc.matchAll(/^### 13\.(\d+) /gm)].map(m => Number(m[1]));

/** The diagnostic codes and lints `devdocs/QUERY.md` §12 lists, less `syntax` (#920's). */
const CODES: readonly string[] = [
  "unknown_field", "unknown_case", "unknown_function", "type_mismatch", "not_iterable", "not_indexable", "arity",
  "ambiguous_output", "cannot_infer", "unsupported",
  "duplicate_outputs", "array_builtin_on_element", "duplicate_key", "never_missing", "long_range",
];

/** A program's text with a fix's edits applied. */
function applyFix(text: string, fix: { edits: readonly { insert: string; length: bigint; offset: bigint }[] }): string {
  let out = text;
  for (const e of [...fix.edits].sort((a, b) => Number(b.offset - a.offset))) {
    out = out.slice(0, Number(e.offset)) + e.insert + out.slice(Number(e.offset + e.length));
  }
  return out;
}

/** Every node of a program. */
function nodesOf(node: JqNode): JqNode[] {
  return [node, ...jqChildren(node).flatMap(child => child.node === undefined ? [] : nodesOf(child.node))];
}

/** The names a program calls, formats as `@name`. */
function calledNames(program: string): Set<string> {
  const parsed = parseJq(program);
  const names = new Set<string>();
  if (parsed.program.type === "none") return names;
  for (const node of nodesOf(parsed.program.value)) {
    if (node.type === "call") names.add(node.value.name);
    if (node.type === "format") names.add(`@${node.value.name}`);
  }
  return names;
}

function check(c: QueryCorpusCase) {
  return checkJq(c.program, c.input, { root: c.root === true });
}

describe("checkJq: the corpus (C1)", () => {
  for (const c of QUERY_CORPUS) {
    test(c.name, () => {
      const result = check(c);
      assert.ok(c.element !== undefined || c.diagnostics !== undefined, "every case says what the checker makes of it");
      if (c.element !== undefined) {
        assert.ok(result.elementType !== null, `no element type: ${result.diagnostics.map(d => d.message).join(" ")}`);
        assert.ok(isTypeEqual(result.elementType, c.element), `${printType(result.elementType)} is not ${printType(c.element)}`);
        assert.equal(result.multiplicity, c.multiplicity);
        assert.ok(result.query !== null);
      } else {
        assert.equal(result.query, null);
        assert.equal(result.elementType, null);
      }
      const expected = c.diagnostics ?? [];
      assert.deepEqual(result.diagnostics.map(d => d.code), expected.map(d => d.code), result.diagnostics.map(d => d.message).join(" "));
      result.diagnostics.forEach((d, i) => {
        const e = expected[i]!;
        assert.equal(d.span.type, "some");
        if (d.span.type === "some") assert.deepEqual([Number(d.span.value.offset), Number(d.span.value.length)], e.span, d.message);
        assert.deepEqual([...d.suggestions], e.suggestions ?? []);
        assert.deepEqual(d.fixes.map(f => ({ label: f.label, result: applyFix(c.program, f) })), e.fixes ?? []);
        assert.equal(d.severity.type, e.warning === true ? "warning" : "error");
        assert.ok(d.message.startsWith(`${d.code}: `), d.message);
      });
    });
  }

  test("every fix gives a program with one problem of its kind fewer", () => {
    for (const c of QUERY_CORPUS) {
      const diagnostics = check(c).diagnostics;
      for (const d of diagnostics) {
        for (const fix of d.fixes) {
          const fixed = applyFix(c.program, fix);
          assert.equal(parseJq(fixed).diagnostics.length, 0, `${c.name}: "${fix.label}" gives text that does not parse: ${fixed}`);
          const again = checkJq(fixed, c.input, { root: c.root === true });
          const before = diagnostics.filter(x => x.code === d.code).length;
          const after = again.diagnostics.filter(x => x.code === d.code).length;
          assert.ok(after < before, `${c.name}: "${fix.label}" leaves ${d.code} in ${fixed}`);
        }
      }
    }
  });

  test("every builtin a query may call has a case, and so does every reason one is refused", () => {
    const called = new Set(QUERY_CORPUS.flatMap(c => [...calledNames(c.program)]));
    for (const [name, builtin] of BUILTINS) {
      if (builtin.status === "supported" || builtin.status === "tooling") assert.ok(called.has(name), `no corpus case calls ${name}`);
    }
    const refusals = new Map<string, string[]>();
    for (const [name, builtin] of BUILTINS) {
      if (builtin.status === "supported" || builtin.status === "tooling") continue;
      const key = `${builtin.status}: ${builtin.reason ?? ""}`;
      refusals.set(key, [...(refusals.get(key) ?? []), name]);
    }
    for (const [key, names] of refusals) {
      assert.ok(names.some(name => called.has(name)), `no corpus case calls any of ${names.join(", ")} (${key})`);
    }
  });

  test("every deviation of QUERY.md §13 and every diagnostic code has a case", () => {
    assert.deepEqual(DEVIATIONS, DEVIATIONS.map((_, i) => i + 1), "§13's deviations are numbered 1, 2, … in order");
    for (const n of DEVIATIONS) assert.ok(QUERY_CORPUS.some(c => c.deviation === n), `no case for deviation ${n}`);
    for (const c of QUERY_CORPUS) {
      if (c.deviation !== undefined) assert.ok(DEVIATIONS.includes(c.deviation), `${c.name} cites §13.${c.deviation}, which QUERY.md lacks`);
    }
    const codes = new Set(QUERY_CORPUS.flatMap(c => (c.diagnostics ?? []).map(d => d.code)));
    for (const code of CODES) assert.ok(codes.has(code), `no case reports ${code}`);
  });

  test("a checked program prints as text that checks to a query of the same types and text", () => {
    for (const c of QUERY_CORPUS) {
      const result = check(c);
      if (result.query === null) continue;
      const text = printJq(result.query.value.program).text;
      const again = checkJq(text, c.input, { root: c.root === true });
      assert.ok(again.query !== null, `${c.name}: ${text} does not check: ${again.diagnostics.map(d => d.message).join(" ")}`);
      // A folded `keys` prints as an array of strings, which parses as an array rather than one literal.
      assert.equal(printJq(again.query.value.program).text, text, c.name);
      assert.ok(isTypeEqual(again.elementType!, result.elementType!), c.name);
      assert.equal(again.multiplicity, result.multiplicity, c.name);
    }
  });

  test("checking is deterministic", () => {
    for (const c of QUERY_CORPUS) {
      const a = check(c);
      const b = check(c);
      if (a.query === null || b.query === null) assert.equal(a.query, b.query);
      else assert.ok(equalFor(QueryType)(a.query, b.query), c.name);
    }
  });
});

describe("checkJq: the catalog", () => {
  test("holds jq 1.8.1's builtins with their arities, and East's additions", () => {
    for (const [name, arities] of Object.entries(JQ_1_8_1_BUILTINS)) {
      const builtin = BUILTINS.get(name);
      assert.ok(builtin !== undefined, `the catalog lacks ${name}`);
      assert.deepEqual([...builtin.arities].sort(), [...arities].sort(), `${name}'s arities`);
    }
    for (const name of BUILTINS.keys()) {
      if (name.startsWith("@")) continue;
      assert.ok(name in JQ_1_8_1_BUILTINS || EAST_ADDITIONS.includes(name), `${name} is neither jq's nor East's`);
    }
  });

  test("a builtin a query may call names its East definition and has a typing rule; one it may not, why", () => {
    for (const [name, builtin] of BUILTINS) {
      if (builtin.status === "supported" || builtin.status === "tooling") {
        assert.ok(builtin.typing !== undefined, name);
        assert.notEqual(builtin.east, "—", name);
      }
      if (builtin.status === "unavailable") assert.ok((builtin.reason ?? "") !== "", name);
    }
  });

  test("a refused builtin says so whatever it is given", () => {
    const message = checkJq("now(1)", FixtureRoot).diagnostics[0]!.message;
    assert.equal(message, "unsupported: now is excluded — queries are deterministic and have no host access.");
  });
});

describe("checkJq: narrowing (C2)", () => {
  test("an un-narrowed payload field is an Option, one; narrowed, exactly its type", () => {
    const unnarrowed = checkJq(".orders[] | .status.value.date", FixtureRoot);
    assert.deepEqual(unnarrowed.diagnostics, []);
    const read = unnarrowed.typeAt("pipe.right");
    assert.ok(read !== null && isTypeEqual(read.type, OptionType(DateTimeType)));
    assert.equal(read.multiplicity, "one");

    const narrowed = checkJq(".orders[] | select(.status.type == \"shipped\") | .status.value.date", FixtureRoot);
    assert.deepEqual(narrowed.diagnostics, []);
    const exact = narrowed.typeAt("pipe.right.pipe.right");
    assert.ok(exact !== null && isTypeEqual(exact.type, DateTimeType));
    assert.equal(exact.multiplicity, "one");
  });

  test("reading it un-narrowed where a DateTime is needed offers Narrow first, whose edit checks clean", () => {
    const program = ".orders | map(.status.value.date | year)";
    const result = checkJq(program, FixtureRoot);
    assert.equal(result.diagnostics.length, 1);
    const d = result.diagnostics[0]!;
    assert.equal(d.message,
      "type_mismatch: .status.value.date is Option<DateTime> here — only the \"shipped\" case of .status has date. " +
      "Narrow first with select(.status.type == \"shipped\").");
    assert.equal(d.fixes.length, 1);
    assert.equal(d.fixes[0]!.label, "Narrow first");
    const fixed = applyFix(program, d.fixes[0]!);
    assert.equal(fixed, ".orders | map(select(.status.type == \"shipped\") | .status.value.date | year)");
    const again = checkJq(fixed, FixtureRoot);
    assert.deepEqual(again.diagnostics, []);
    assert.ok(again.elementType !== null && isTypeEqual(again.elementType, ArrayType(IntegerType)));
  });

  test("an if narrows its branch, and the else branch to the other cases", () => {
    const result = checkJq(
      "[.orders[] | if .status.type == \"pending\" then \"\" elif .status.type == \"cancelled\" then .status.value.reason else (.status.value.date | todate) end]",
      FixtureRoot);
    assert.deepEqual(result.diagnostics, []);
  });

  test("a case test through an Option narrows too", () => {
    const result = checkJq(".orders[0] | if .status.type == \"shipped\" then .status.value.date else null end", FixtureRoot);
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.elementType !== null && isTypeEqual(result.elementType, OptionType(DateTimeType)));
  });
});

/** The query editor's default query (`Query Editor Spec.md` §8.1), in the pipeline layout. */
const DEFAULT_QUERY = [
  ".customers as $customers",
  "| .orders",
  "| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
  "| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
  "| map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
  "| sort_by(-.total)",
  "| .[:10]",
].join("\n");

describe("checkJq: stages (C3)", () => {
  test("the default query's stages have the types the editor's shape lines show, each with its segment's span", () => {
    const result = checkJq(DEFAULT_QUERY, FixtureRoot);
    assert.deepEqual(result.diagnostics, []);
    const OrderLookedUp = StructType({ ...Order.fields, name: OptionType(StringType), region: OptionType(StringType) });
    const Row = StructType({
      order: IntegerType, customer: OptionType(StringType), region: OptionType(StringType), total: FloatType, shipped: DateTimeType,
    });
    const expected: EastType[] = [ArrayType(Order), ArrayType(Order), ArrayType(OrderLookedUp), ArrayType(Row), ArrayType(Row), ArrayType(Row)];
    assert.equal(result.stages.length, expected.length);
    const segments = DEFAULT_QUERY.split("\n").slice(1).map(line => line.slice(2));
    result.stages.forEach((stage, i) => {
      assert.ok(isTypeEqual(stage.type, expected[i]!), `stage ${i}: ${printType(stage.type)}`);
      assert.equal(stage.multiplicity, "one");
      assert.equal(DEFAULT_QUERY.slice(stage.from, stage.to), segments[i]);
    });
    assert.ok(result.elementType !== null && isTypeEqual(result.elementType, ArrayType(Row)));
  });

  test("the stages' multiplicity is the program's so far", () => {
    const result = checkJq(".orders[] | .lines | length", FixtureRoot);
    assert.deepEqual(result.stages.map(s => s.multiplicity), ["many", "many", "many"]);
  });
});

describe("checkJq: e3 roots (C4)", () => {
  test(".[] on the root is refused, naming the root's datasets", () => {
    const result = checkJq(".[]", FixtureRoot, { root: true });
    assert.deepEqual(result.diagnostics.map(d => d.message), [
      "unsupported: reading the whole root loads every dataset — name them: .bom, .byId, .cells, ….",
    ]);
  });

  test("keys on the root checks to a literal of the root's names, and reads nothing", () => {
    const result = checkJq("keys", FixtureRoot, { root: true });
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.reads, []);
    const program = result.query!.value.program;
    assert.equal(program.type, "literal");
    if (program.type === "literal") {
      const { type, value } = decodeBeast2(program.value);
      assert.ok(isTypeEqual(fromEastTypeValue(type), ArrayType(StringType)));
      assert.deepEqual(value, ["bom", "byId", "cells", "customers", "forecast", "model", "orders"]);
    }
  });

  test("the default query reads customers and orders", () => {
    assert.deepEqual(checkJq(DEFAULT_QUERY, FixtureRoot, { root: true }).reads, ["customers", "orders"]);
  });

  test("the checked program re-checks against the root narrowed to what it reads, keeping keys folded", () => {
    const result = checkJq(".orders | length", FixtureRoot, { root: true });
    const narrowed = StructType({ orders: FixtureRoot.fields.orders });
    const again = checkJq(printJq(result.query!.value.program).text, narrowed, { root: true });
    assert.deepEqual(again.diagnostics, []);
    const keys = checkJq("keys | length", FixtureRoot, { root: true });
    const keysAgain = checkJq(printJq(keys.query!.value.program).text, StructType({}), { root: true });
    assert.deepEqual(keysAgain.diagnostics, []);
  });
});

describe("checkJq: rewrites and inference", () => {
  test("an ISO string compared with a DateTime is a DateTime literal in the checked program", () => {
    const result = checkJq(".orders[] | select(.status.type == \"shipped\" and .status.value.date >= \"2026-01-01\") | .id", FixtureRoot);
    const literals = nodesOf(result.query!.value.program).filter(n => n.type === "literal").map(n => decodeBeast2(n.value as Uint8Array));
    const date = literals.find(l => fromEastTypeValue(l.type).type === "DateTime");
    assert.ok(date !== undefined);
    assert.equal((date.value as Date).getTime(), Date.UTC(2026, 0, 1));
  });

  test("a strftime format is a token array in the checked program", () => {
    const result = checkJq("first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | strftime(\"%Y-%m\")", FixtureRoot);
    const literals = nodesOf(result.query!.value.program).filter(n => n.type === "literal").map(n => decodeBeast2(n.value as Uint8Array));
    const tokens = literals.find(l => isTypeEqual(fromEastTypeValue(l.type), ArrayType(DateTimeFormatTokenType)));
    assert.ok(tokens !== undefined);
    assert.deepEqual((tokens.value as { type: string }[]).map(t => t.type), ["year4", "literal", "month2"]);
  });

  test("an Integer literal an operand makes a Float is a Float literal", () => {
    const result = checkJq(".orders | map(.total * 2)", FixtureRoot);
    assert.equal(printJq(result.query!.value.program).text, ".orders | map(.total * 2.0)");
  });

  test("reduce infers its accumulator by fixpoint: {} becomes Dict<String, Float>", () => {
    const result = checkJq("reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)", FixtureRoot);
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.elementType !== null && isTypeEqual(result.elementType, DictType(StringType, FloatType)));
  });

  test("a def is checked at each call, with that call's types", () => {
    const result = checkJq("def twice: . + .; [(1 | twice), (\"a\" | twice | length)] | length", FixtureRoot);
    assert.deepEqual(result.diagnostics, []);
    const integer = result.typeAt("def.body", ">def.rest.pipe.left.array.some.comma.left.pipe.right");
    const string = result.typeAt("def.body", ">def.rest.pipe.left.array.some.comma.right.pipe.right.pipe.left");
    assert.ok(integer !== null && isTypeEqual(integer.type, IntegerType));
    assert.ok(string !== null && isTypeEqual(string.type, StringType));
  });

  test("typeAt gives the type of any node, and null for one never checked", () => {
    const result = checkJq(".orders | map(.total)", FixtureRoot);
    const total = result.typeAt("pipe.right.call.args[0]");
    assert.ok(total !== null && isTypeEqual(total.type, FloatType));
    assert.equal(result.typeAt("no.such.path"), null);
  });

  test("a program that does not parse gives its syntax diagnostics and nothing else", () => {
    const result = checkJq(".orders |", FixtureRoot);
    assert.equal(result.query, null);
    assert.deepEqual(result.diagnostics.map(d => d.code), ["syntax"]);
    assert.deepEqual(result.stages, []);
  });
});

describe("QUERY.md", () => {
  test("§10's catalog tables and §12's templates are what the catalog and messages.ts make now", () => {
    assert.ok(withCatalogTables(doc) === doc, "devdocs/QUERY.md is stale: run `make query-corpus` in libs/east");
  });

  test("§12 lists every template of messages.ts", () => {
    const keys = new Set(messageTemplates().map(t => t.key));
    for (const key of Object.keys(MESSAGES)) assert.ok(keys.has(key as keyof typeof MESSAGES), `messageTemplates() lacks ${key}`);
  });

  test("every diagnostic the corpus gives is one of the templates", () => {
    const patterns = messageTemplates().map(({ text }) => new RegExp(`^${text.split(/\{[^{}]*\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*?")}$`));
    for (const c of QUERY_CORPUS) {
      for (const d of check(c).diagnostics) {
        if (d.code === "syntax") continue;
        assert.ok(patterns.some(pattern => pattern.test(d.message)), `${c.name}: "${d.message}" is no template`);
      }
    }
  });
});
