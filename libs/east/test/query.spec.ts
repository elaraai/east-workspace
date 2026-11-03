/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The jq translator (#923): queries as East IR. East.jq's examples run as an
 * East suite (exported for east-c and east-py like any spec); the corpus runs
 * through East.jq and through evaluateJq over the shared fixture (E1); the
 * query editor's default query gives its ten rows (E2); a runtime error names
 * its place in the jq text, and QueryError carries the checker's words (E4);
 * East.jq's IR is a call of the Query builtin, which analysis holds to its
 * query (#1041). */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ArrayType, BlobType, DictType, EastError, EastIR, East, Expr, FloatType, FunctionType, IRType, IntegerType, NeverType, NullType, OptionType, QueryCallType, RecursiveType,
  SortedMap, StringType, StructType, SummaryLeafType, SummaryType, checkJq, compareFor, constValueOf, decodeBeast2For, encodeBeast2For, equalFor, evaluateJq, none,
  printFor, printJq, QueryError, some, QueryErrorType, QuerySpanType, runtimeErrorAt, summaryProgram, toSource, translateJq, variant, walkIR,
  splitJq, type ArrayExpr, type CheckJqResult, type EastType, type IR, type ValueTypeOf,
} from "../src/index.js";
import { canonicalDifference, canonicalIR } from "../src/codegen/canonical.js";
import { BUILTINS } from "../src/query/jq/catalog.js";
import { narrowRows } from "../src/query/jq/narrow.js";
import { BUILTIN_RULES, FORMATS } from "../src/query/jq/translate-builtins.js";
import { inExportSubdirectory } from "./export-subdirectory.js";
import { describeEast, assertEast } from "./platforms.spec.js";
import { QUERY_CORPUS, calledIR, translatedBytes } from "./query.corpus.js";
import { FixtureRoot, Order, queryFixture, queryFixtureBytes } from "./query.fixture.js";
import * as ex from "./query.examples.js";

/** The module a printed program imports East from: this build's. */
const INDEX_URL = new URL("../src/index.js", import.meta.url).href;

/** Asserts two East values of a type are equal, as East compares them. */
function assertValue(type: EastType, actual: unknown, expected: unknown, message = ""): void {
  const print = printFor(type);
  assert.ok(equalFor(type)(actual as never, expected as never), `${message} ${print(actual as never)} is not ${print(expected as never)}`);
}

// ─── East.jq in East programs ────────────────────────────────────────────

describeEast("East.jq", (test) => {
  assertEast.examples(test, {
    queryJqSelect: ex.queryJqSelect,
    queryJqRoot: ex.queryJqRoot,
    queryJqFirst: ex.queryJqFirst,
    queryJqReduce: ex.queryJqReduce,
    queryJqGroupBy: ex.queryJqGroupBy,
    queryJqVariant: ex.queryJqVariant,
    queryJqDateLiteral: ex.queryJqDateLiteral,
    queryJqUpdate: ex.queryJqUpdate,
    queryJqTryCatch: ex.queryJqTryCatch,
    queryJqLimit: ex.queryJqLimit,
    queryJqRecurse: ex.queryJqRecurse,
  });

  test("a runtime error in a query is an East error a program can catch", $ => {
    const n = $.const(7n, IntegerType);
    $(assertEast.throws(East.jq(n, ". % 0", IntegerType), /Division by zero/));
  });

  test("error(v) raises v's East text", $ => {
    const n = $.const(7n, IntegerType);
    $(assertEast.throws(East.jq(n, "error({code: .})", OptionType(NeverType)), /\(code=7\)/));
  });

  test("the result is an expression of its result type, so its methods chain", $ => {
    const xs = $.const([1n, 2n, 3n], ArrayType(IntegerType));
    $(assertEast.equal(East.jq(xs, "map(. * 2)", ArrayType(IntegerType)).sum(), 12n));
    $(assertEast.equal(East.jq(xs, "length", IntegerType).add(1n), 4n));
    $(assertEast.equal(East.jq(xs, "first(.[] | select(. > 1))", OptionType(IntegerType)).unwrap("some"), 2n));
  });
});

describe("East.jq's static type", () => {
  test("a query without its result type does not type-check", () => {
    // The directive is the assertion: the build fails if East.jq accepts a
    // query without the result type that types its expression.
    // @ts-expect-error East.jq's result type is required
    const untyped = (xs: ArrayExpr<IntegerType>) => East.jq(xs, "map(. * 2)");
    assert.equal(typeof untyped, "function");
  });
});

// ─── The corpus over the fixture (E1) ────────────────────────────────────

describe("the query corpus over the fixture (E1)", () => {
  const fixture = queryFixture();
  const cases = QUERY_CORPUS.filter(c => c.output !== undefined);

  test("every case that checks has its output", () => {
    for (const c of QUERY_CORPUS) {
      const checked = checkJq(c.program, c.input, { root: c.root === true });
      assert.equal(c.output !== undefined, checked.program !== null, c.name);
    }
  });

  for (const c of cases) {
    test(c.name, () => {
      const checked = checkJq(c.program, c.input, { root: c.root === true });
      const resultType = translateJq(checked).resultType;
      const print = printFor(resultType);
      // Through evaluateJq, a host's entry.
      assert.equal(print(evaluateJq(checked, fixture)), c.output, `${c.name} through evaluateJq`);
      // Through East.jq, inside an East function over the fixture.
      const fn = East.function([FixtureRoot], resultType, ($, root) => {
        const input = c.root === true
          ? Object.fromEntries(Object.keys(FixtureRoot.fields).map(name => [name, (root as any)[name] as Expr]))
          : root;
        return East.jq(input, c.program, resultType);
      });
      assert.equal(print(East.compile(fn, [])(fixture)), c.output, `${c.name} through East.jq`);
    });
  }
});

// ─── The corpus as a compliance suite (#987) ─────────────────────────────

/** Whether values of a type hold a function, which a test cannot write as a constant. */
function holdsFunction(type: EastType): boolean {
  const seen = new Set<EastType>();
  const visit = (t: EastType): boolean => {
    if (seen.has(t)) return false;
    seen.add(t);
    switch (t.type) {
      case "Function": case "AsyncFunction": return true;
      case "Array": case "Ref": return visit(t.value as EastType);
      case "Set": return visit(t.key as EastType);
      case "Dict": return visit(t.key as EastType) || visit(t.value as EastType);
      case "Struct": return Object.values(t.fields as Record<string, EastType>).some(visit);
      case "Variant": return Object.values(t.cases as Record<string, EastType>).some(visit);
      case "Recursive": return visit(t.node as EastType);
      default: return false;
    }
  };
  return visit(type);
}

// Each corpus case over the fixture with an output, run by its translation in
// an East test and equal to the value evaluateJq gives, which E1 holds to the
// corpus's text: a suite in <dir>/query-corpus/, which every runtime runs. The
// Query builtin East.jq wraps a translation in is the East.jq suite's to run,
// and the corpus fixture's (#1041).
{
  const fixture = queryFixture();
  const bytes = queryFixtureBytes();
  const corpus = QUERY_CORPUS.flatMap(c => {
    if (c.output === undefined || c.input !== FixtureRoot) return [];
    const checked = checkJq(c.program, c.input, { root: c.root === true });
    const translation = translateJq(checked);
    return holdsFunction(translation.resultType) ? [] : [{ c, translation, expected: evaluateJq(checked, fixture) }];
  });
  await inExportSubdirectory("query-corpus", () => describeEast("jq corpus", test => {
    for (const { c, translation, expected } of corpus) {
      test(c.name, $ => {
        // The fixture as test/fixtures/query-fixture.beast2 holds it, its model
        // with it: its value written into each test would be a hundred times the bytes.
        const root = $.let($.const(bytes, BlobType).decodeBeast(FixtureRoot, "v2"));
        // A root's each field the query reads is an input of its own; otherwise the fixture is the one input.
        const inputs = translation.inputs.map(i => i.name === null ? root : (root as any)[i.name] as Expr);
        $(assertEast.equal(translation.build(...inputs), expected as never));
      });
    }
  }));
}

describe("every corpus case's call of the Query builtin prints as the East.jq that made it, and rebuilds (#1041 B2)", () => {
  test("in TypeScript", async () => {
    const dir = mkdtempSync(join(tmpdir(), "east-jq-"));
    try {
      for (const c of QUERY_CORPUS) {
        const checked = checkJq(c.program, c.input, { root: c.root === true });
        if (checked.program === null) continue;
        const ir = calledIR(checked);
        const source = toSource(ir, { importFrom: INDEX_URL });
        assert.match(source, /East\.jq\(/, c.name);
        assert.doesNotMatch(source, /"Query"|east_jq/, c.name);
        const path = join(dir, `${c.name}.mjs`);
        writeFileSync(path, source, "utf-8");
        const main = (await import(pathToFileURL(path).href)).main;
        assert.equal(canonicalDifference(canonicalIR(main.toIR().ir), canonicalIR(ir)), null, `${c.name}:\n${source}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── The query editor's default query (E2) ───────────────────────────────

/** `Query Editor Spec.md` §4.7: the default query, as the editor prints it. */
const DEFAULT_QUERY = [
  ".customers as $customers",
  "| .orders",
  "| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
  "| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
  "| map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
  "| sort_by(-.total)",
  "| .[:10]",
].join("\n");

describe("the query editor's default query (E2)", () => {
  const fixture = queryFixture();

  test("gives its ten rows, as jq 1.8.1 gives them", () => {
    const rows = evaluateJq(DEFAULT_QUERY, fixture, { inputType: FixtureRoot, root: true }) as { order: bigint; total: number }[];
    assert.equal(rows.length, 10);
    assertValue(ArrayType(IntegerType), rows.map(r => r.order), [1035n, 1026n, 1014n, 1031n, 1023n, 1021n, 1002n, 1007n, 1012n, 1036n]);
    assertValue(ArrayType(FloatType), rows.map(r => r.total), [2381.61, 1913.4, 1765.97, 1537.52, 1352.32, 1225.5, 1171.58, 1162.92, 1109.6, 1041.68]);
  });

  test("East.jq's IR is a call of the Query builtin: the program as written, its translation, and every input (#1041)", () => {
    const datasets = StructType({ customers: FixtureRoot.fields.customers, forecast: FixtureRoot.fields.forecast, orders: FixtureRoot.fields.orders });
    const checked = checkJq(DEFAULT_QUERY, datasets, { root: true });
    const resultType = translateJq(checked).resultType;
    const fn = East.function([FixtureRoot], resultType, ($, root) => {
      const r = root as any;
      return East.jq({ customers: r.customers, forecast: r.forecast, orders: r.orders }, DEFAULT_QUERY, resultType);
    });
    const body = fn.toIR().ir.value.body as IR;
    assert.equal(body.type, "Call");
    const call = body as Extract<IR, { type: "Call" }>;
    const builtin = call.value.function as IR;
    assert.ok(builtin.type === "Builtin" && builtin.value.builtin === "Query");
    // The query as the constant its first argument holds: the program as written, and the root's input names.
    const query = constValueOf(builtin.value.arguments[0]!) as ValueTypeOf<typeof QueryCallType>;
    const expected = variant("v1", { inputs: some(["customers", "forecast", "orders"]), program: checked.program! });
    assert.ok(equalFor(QueryCallType)(query, expected));
    assert.equal(printJq(query.value.program).text, DEFAULT_QUERY.replaceAll("\n", " "));
    // The translation, whose type carries the query's types, takes every input, forecast too, which the query
    // does not read; the call passes each.
    assert.equal(builtin.value.arguments[1]!.type, "Function");
    assert.ok(builtin.value.type_parameters[0]!.type === "Function" && builtin.value.type_parameters[0]!.value.inputs.length === 3);
    assert.deepEqual(call.value.arguments.map(a => a.type), ["GetField", "GetField", "GetField"]);
    assert.deepEqual(call.value.arguments.map(a => (a as Extract<IR, { type: "GetField" }>).value.field), ["customers", "forecast", "orders"]);
  });
});

// ─── The Query builtin (#1041) ───────────────────────────────────────────

describe("the Query builtin (#1041)", () => {
  const Numbers = ArrayType(IntegerType);
  // The query as the builtin carries it: its program as written, and no input names for a query of one input.
  const doubled = variant("v1", { inputs: none, program: checkJq("map(. * 2)", Numbers).program! });

  test("running a call runs its translation", () => {
    const F = FunctionType([Numbers], Numbers);
    const translation = East.function([Numbers], Numbers, ($, xs) => xs.map(($, x) => x.multiply(2n)));
    const fn = East.function([Numbers], Numbers, ($, xs) => (East.builtin("Query", [F], [doubled, translation], F) as any)(xs));
    assertValue(Numbers, East.compile(fn, [])([1n, 2n]), [2n, 4n]);
  });

  test("IR analysis refuses a translation that does not take the query's inputs (B4)", () => {
    const F = FunctionType([Numbers, Numbers], Numbers);
    const translation = East.function([Numbers, Numbers], Numbers, ($, xs, _ys) => xs);
    const fn = East.function([Numbers], Numbers, ($, xs) => (East.builtin("Query", [F], [doubled, translation], F) as any)(xs, xs));
    assert.throws(() => East.compile(fn, []), /Builtin function 'Query': its query takes one input, but its translation is of type \.Function/);
  });

  test("IR analysis refuses a query that is not a constant", () => {
    const F = FunctionType([Numbers], Numbers);
    const translation = East.function([Numbers], Numbers, ($, xs) => xs);
    const fn = East.function([QueryCallType, Numbers], Numbers, ($, query, xs) => (East.builtin("Query", [F], [query, translation], F) as any)(xs));
    assert.throws(() => East.compile(fn, []), /Builtin function 'Query' takes its query as a constant/);
  });

  test("IR analysis refuses a call without its one type parameter", () => {
    // East.builtin refuses such a call as it is built; IR that arrives built, as from a file, meets the analyzer.
    const F = FunctionType([Numbers], Numbers);
    const translation = East.function([Numbers], Numbers, ($, xs) => xs);
    const ir = East.function([Numbers], Numbers, ($, xs) => (East.builtin("Query", [F], [doubled, translation], F) as any)(xs)).toIR().ir;
    const call = ir.value.body as Extract<IR, { type: "Call" }>;
    const builtin = call.value.function as Extract<IR, { type: "Builtin" }>;
    const untyped = variant("Function", { ...ir.value, body: variant("Call", { ...call.value, function: variant("Builtin", { ...builtin.value, type_parameters: [] }) }) });
    assert.throws(() => new EastIR(untyped as any).compile([]), /Builtin function 'Query' takes 1 type parameter, got 0/);
  });
});

// ─── The summary program (#922) ──────────────────────────────────────────

describe("the summary program over the orders", () => {
  test("gives #922's counts: the rows, the status cases, the totals' range and the shipped months", () => {
    const fixture = queryFixture();
    const summary = evaluateJq(summaryProgram(ArrayType(Order)), fixture.orders, { inputType: ArrayType(Order) }) as ValueTypeOf<typeof SummaryType>;
    assertValue(IntegerType, summary.count, 40n);
    const leaf = (path: string): ValueTypeOf<typeof SummaryLeafType> => {
      const found = summary.leaves.get(path);
      assert.ok(found !== undefined, path);
      return found;
    };
    const Counts = OptionType(ArrayType(StructType({ n: IntegerType, value: StringType })));
    assertValue(Counts, leaf(".status.type").cases, some([{ n: 3n, value: "cancelled" }, { n: 14n, value: "pending" }, { n: 23n, value: "shipped" }]));
    const total = leaf(".total").numbers;
    assert.ok(total.type === "some");
    assertValue(ArrayType(FloatType), [total.value.min, total.value.max], [36.26, 3646.84]);
    const dates = leaf(".status.value.date").dates;
    assert.ok(dates.type === "some");
    assertValue(IntegerType, dates.value.months.reduce((n, m) => n + m.n, 0n), 23n);
    assertValue(IntegerType, leaf(".status.value.date").count, 23n);
  });
});

// ─── Errors (E4) ─────────────────────────────────────────────────────────

describe("errors (E4)", () => {
  test("a runtime error names its line and column in the jq text", () => {
    const program = "1 | . % 0";
    const fn = East.function([IntegerType], IntegerType, ($, x) => East.jq(x, program, IntegerType));
    const compiled = East.compile(fn, []);
    assert.throws(() => compiled(1n), (e: unknown) => {
      assert.ok(e instanceof EastError);
      assert.equal(e.eastMessage, "Division by zero");
      assert.deepEqual(e.location[0], { filename: "jq", line: 1n, column: 5n });
      return true;
    });
  });

  test("evaluateJq gives a runtime error as one runtime diagnostic at the node that raised it", () => {
    assert.throws(() => evaluateJq("[.[] | 10 / .]", [5n, 0n], { inputType: ArrayType(IntegerType) }), (e: unknown) => {
      assert.ok(e instanceof QueryError);
      assert.equal(e.diagnostics.length, 1);
      const d = e.diagnostics[0]!;
      assert.equal(d.code, "runtime");
      assert.equal(d.message, "runtime: Division by zero");
      assert.ok(d.span.type === "some");
      assert.equal(d.span.value.offset, 7n);
      assert.equal(d.span.value.length, 6n);
      assert.equal(e.message, "jq 1:8: runtime: Division by zero");
      return true;
    });
  });

  test("runtimeErrorAt places an error a run reported at the jq node that raised it, as evaluateJq does", () => {
    const checked = checkJq("[.[] | 10 / .]", ArrayType(IntegerType));
    const raised = (() => {
      try {
        evaluateJq(checked, [5n, 0n]);
      } catch (e) {
        if (e instanceof QueryError) return e.diagnostics;
      }
      throw new Error("the query raises no error");
    })();
    // The run names line 1, column 8, where `10 / .` and the literal `10` start: the literal cannot raise.
    const placed = runtimeErrorAt(checked, "Division by zero", { line: 1, column: 8 });
    assert.ok(equalFor(ArrayType(QueryErrorType))([placed], raised), printFor(QueryErrorType)(placed));
    // No node starts at column 5, a space: an empty span there. An error that names no place in the jq is on no span.
    const between = runtimeErrorAt(checked, "Division by zero", { line: 1, column: 5 });
    assert.ok(equalFor(OptionType(QuerySpanType))(between.span, some({ column: 5n, length: 0n, line: 1n, offset: 4n })));
    assert.equal(runtimeErrorAt(checked, "out of memory").span.type, "none");
    assert.equal(runtimeErrorAt(checked, "out of memory").message, "runtime: out of memory");
  });

  test("East.jq throws QueryError with checkJq's message for a query that does not check", () => {
    const Order = StructType({ id: IntegerType, total: OptionType(StringType) });
    assert.throws(
      () => East.function([ArrayType(Order)], IntegerType, ($, orders) => East.jq(orders, ".[0].totl", IntegerType)),
      (e: unknown) => {
        assert.ok(e instanceof QueryError);
        assert.equal(e.diagnostics[0]!.code, "unknown_field");
        assert.equal(e.message, `jq 1:5: ${checkJq(".[0].totl", ArrayType(Order)).diagnostics[0]!.message}`);
        return true;
      },
    );
  });

  test("East.jq throws QueryError naming both types for a wrong result type", () => {
    assert.throws(
      () => East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => East.jq(xs, "map(. * 2)", IntegerType)),
      { name: "QueryError", message: "type_mismatch: the query gives Array<Integer>, not the Integer it was given." },
    );
  });

  test("evaluateJq needs an input type with a program's text", () => {
    assert.throws(() => evaluateJq(".", 1n), /needs options.inputType/);
  });
});

// ─── The translation ─────────────────────────────────────────────────────

describe("the translation", () => {
  test("every builtin a query may call, and every format, has a rule", () => {
    for (const [name, builtin] of BUILTINS) {
      if (builtin.status !== "supported" && builtin.status !== "tooling") continue;
      assert.ok(BUILTIN_RULES[name] !== undefined, `${name} has no rule`);
      if (name.startsWith("@")) assert.ok(FORMATS[name.slice(1)] !== undefined, `${name} has no format`);
    }
  });

  test("is deterministic: a checked program gives the same IR bytes each time, its translation and its call", () => {
    for (const c of QUERY_CORPUS.slice(0, 40)) {
      const checked = checkJq(c.program, c.input, { root: c.root === true });
      if (checked.program === null) continue;
      const again = checkJq(c.program, c.input, { root: c.root === true });
      assert.deepEqual(translatedBytes(checked), translatedBytes(again), c.name);
      assert.ok(equalFor(IRType)(calledIR(checked), calledIR(again)), c.name);
    }
  });

  test("build gives a translation that is one value as that value, not a block of it, as the builders give it", () => {
    const translation = translateJq(checkJq("1", NullType));
    assert.equal(Expr.ast(translation.build(East.value(null))).ast_type, "Value");
  });

  test("a root's inputs are the fields the query reads, in the order it reads them", () => {
    const checked = checkJq(".customers as $c | .orders | map($c[.customer_id].name)", FixtureRoot, { root: true });
    assert.deepEqual(translateJq(checked).inputs.map(i => i.name), ["customers", "orders"]);
  });

  test("maxOutputs stops a many query one output past the limit", () => {
    const fixture = queryFixture();
    const checked = checkJq(".orders[] | .id", FixtureRoot);
    const fn = translateJq(checked, { maxOutputs: 3 }).fn();
    assertValue(ArrayType(IntegerType), East.compile(fn as any, [])(fixture), [1001n, 1002n, 1003n, 1004n]);
  });

  test("the tooling builtins call the host's platform functions", () => {
    const checked = checkJq(".model | signature", FixtureRoot, { tooling: true });
    const signature = East.genericPlatform("jq_signature", ["F"], ["F"], StringType);
    const platform = [signature.implement(() => () => "(price, region) => demand")];
    assert.equal(evaluateJq(checked, queryFixture(), { tooling: true, platform }), "(price, region) => demand");
  });

  test("builtins lists each builtin a query may call, with its arity, in order", () => {
    const names = evaluateJq("builtins", null, { inputType: NullType }) as string[];
    assert.ok(names.includes("map/1") && names.includes("range/3") && !names.includes("now/0") && !names.includes("signature/0"));
    assertValue(ArrayType(StringType), names, [...names].sort(compareFor(StringType)));
  });

  test("a recursive def with value parameters is a function reached through a reference", () => {
    const checked = checkJq("def fib($n): if $n < 2 then $n else fib($n - 1) + fib($n - 2) end; fib(15)", NullType);
    assertValue(IntegerType, evaluateJq(checked, null), 610n);
  });

  test("walk rebuilds a recursive value bottom up", () => {
    const fixture = queryFixture();
    const doubled = evaluateJq(".bom | walk(if type == \"number\" then . * 2 else . end) | [recurse(.children[]) | .cost] | add", fixture, { inputType: FixtureRoot });
    const original = evaluateJq(".bom | [recurse(.children[]) | .cost] | add", fixture, { inputType: FixtureRoot }) as number;
    assert.equal(doubled, original * 2);
  });

  test("del deletes every path at once, as jq does", () => {
    const Numbers = ArrayType(IntegerType);
    assertValue(Numbers, evaluateJq("del(.[0], .[2])", [1n, 2n, 3n, 4n], { inputType: Numbers }), [2n, 4n]);
    assertValue(Numbers, evaluateJq("del(.[] | select(. == 2))", [1n, 2n, 3n], { inputType: Numbers }), [1n, 3n]);
    assertValue(Numbers, evaluateJq("del(.[1:])", [1n, 2n, 3n], { inputType: Numbers }), [1n]);
  });

  test("|= deletes an array element when the update gives no output", () => {
    const Numbers = ArrayType(IntegerType);
    assertValue(Numbers, evaluateJq("map_values(select(. > 1))", [1n, 2n, 3n], { inputType: Numbers }), [2n, 3n]);
    assertValue(Numbers, evaluateJq(".[] |= empty", [1n, 2n, 3n], { inputType: Numbers }), []);
  });

  test("an update's index past the end of an array is an error, where jq pads with nulls (§13.23)", () => {
    assert.throws(() => evaluateJq(".[5] |= 3", [1n, 2n], { inputType: ArrayType(IntegerType) }), (e: unknown) => {
      assert.ok(e instanceof QueryError);
      assert.equal(e.diagnostics[0]!.code, "runtime");
      return true;
    });
  });

  test("a struct field an update gives no value only sometimes raises an error there (§13.23)", () => {
    const Point = StructType({ x: IntegerType, y: IntegerType });
    assertValue(Point, evaluateJq(".x |= select(. > 0)", { x: 1n, y: 2n }, { inputType: Point }), { x: 1n, y: 2n });
    assert.throws(() => evaluateJq(".x |= select(. > 0)", { x: -1n, y: 2n }, { inputType: Point }), /cannot be deleted/);
  });

  test("a walk updates the values inside a value that it had before its own update, as jq's paths are", () => {
    const Part = RecursiveType(self => StructType({ children: ArrayType(self), sku: StringType }));
    const tree = { children: [{ children: [{ children: [], sku: "C" }], sku: "B" }], sku: "A" };
    const skus = evaluateJq("(.. | objects | .children) |= . + . | [recurse(.children[]) | .sku]", tree, { inputType: Part });
    assertValue(ArrayType(StringType), skus, ["A", "B", "C", "C", "B", "C"]);
  });

  test("`..` and recurse walk a value typed as a recursive type's node", () => {
    // The node's children are the recursive type, which equals the node: a kind
    // already seen, which must still make the walk the recursive one.
    const Part = RecursiveType(self => StructType({ children: ArrayType(self), sku: StringType }));
    const tree = { children: [{ children: [{ children: [], sku: "C" }], sku: "B" }], sku: "A" };
    const Skus = ArrayType(StringType);
    assertValue(Skus, evaluateJq("[.. | objects | .sku]", tree, { inputType: Part.node as EastType }), ["A", "B", "C"]);
    assertValue(Skus, evaluateJq("[recurse | .sku?]", tree, { inputType: Part.node as EastType }), ["A", "B", "C"]);
  });

  test("a literal read as a Float where one kind of value meets it stays an Integer for another (#1138)", () => {
    const Row = StructType({ n: IntegerType, x: FloatType });
    assertValue(Row, evaluateJq("(.. | numbers) |= . + 1", { n: 1n, x: 0.5 }, { inputType: Row }), { n: 2n, x: 1.5 });
  });

  test("evaluateJq caches a query's compiled function", () => {
    const Numbers = ArrayType(IntegerType);
    const first = evaluateJq("map(. + 1)", [1n], { inputType: Numbers });
    const again = evaluateJq("map(. + 1)", [2n], { inputType: Numbers });
    assertValue(ArrayType(ArrayType(IntegerType)), [first, again], [[2n], [3n]]);
  });

  test("a query over a dict of struct keys looks up by the key's type", () => {
    const Cell = StructType({ region: StringType, week: IntegerType });
    const cells = new SortedMap([[{ region: "NSW", week: 1n }, 1080.0]], compareFor(Cell));
    const found = evaluateJq(".[{region: \"NSW\", week: 1}]", cells, { inputType: DictType(Cell, FloatType) });
    assertValue(OptionType(FloatType), found, some(1080.0));
  });
});

// ─── Folds that set a key of their state in place (#1093) ────────────────

/**
 * How many times a translation copies a dict: in all, and in the bodies of
 * its loops, where a copy in a loop inside another counts once for each.
 */
function dictCopies(ir: IR): { all: number; inLoops: number } {
  const count = (root: IR): number => {
    let n = 0;
    walkIR(root, node => { if (node.type === "Builtin" && node.value.builtin === "DictCopy") n += 1; });
    return n;
  };
  let inLoops = 0;
  walkIR(ir, node => {
    if (node.type === "ForArray" || node.type === "ForSet" || node.type === "ForDict" || node.type === "While") inLoops += count(node.value.body);
  });
  return { all: count(ir), inLoops };
}

describe("folds that set a key of their state in place (#1093)", () => {
  const Row = StructType({ k: StringType, k2: StringType, v: IntegerType });
  const Rows = StructType({ rows: ArrayType(Row), start: DictType(StringType, IntegerType) });
  const Counts = DictType(StringType, IntegerType);
  const counts = (entries: [string, bigint][]): ValueTypeOf<typeof Counts> => new SortedMap(entries, compareFor(StringType));
  const rows = (): ValueTypeOf<typeof Rows> => ({
    rows: [{ k: "a", k2: "b", v: 1n }, { k: "b", k2: "a", v: 2n }, { k: "a", k2: "a", v: 3n }],
    start: counts([["b", 10n]]),
  });
  // A dict whose values are dicts like it: the one way a fold's update can put its state inside its state.
  const Tree = RecursiveType(self => DictType(StringType, self));
  const Names = StructType({ names: ArrayType(StringType), start: DictType(StringType, Tree) });
  const Trees = DictType(StringType, Tree);
  const trees = (entries: [string, ValueTypeOf<typeof Trees>][]): ValueTypeOf<typeof Trees> => new SortedMap(entries, compareFor(StringType));

  test("an update whose value holds nothing of the state sets the state's key in place: one copy of init, none in the loop", () => {
    const cases: [program: string, type: EastType, expected: unknown][] = [
      ["reduce .rows[] as $x ({}; .[$x.k] += $x.v)", Counts, counts([["a", 4n], ["b", 2n]])],
      ["reduce .rows[] as $x ({}; .[$x.k] = $x.v)", Counts, counts([["a", 3n], ["b", 2n]])],
      // The value reads the state, at a key, before the key is set.
      ["reduce .rows[] as $x (.start; .[$x.k] += (.[$x.k2] // 0))", Counts, counts([["a", 20n], ["b", 20n]])],
      ["reduce .rows[] as $x ({}; .[$x.k] |= . + $x.v)", Counts, counts([["a", 4n], ["b", 2n]])],
      // Only the state's own key is set in place; the value at it is rebuilt.
      ["reduce .rows[] as $x ({}; .[$x.k].n += $x.v)", DictType(StringType, StructType({ n: IntegerType })),
        new SortedMap([["a", { n: 4n }], ["b", { n: 2n }]], compareFor(StringType))],
      // A foreach whose extract reads the state, never giving it.
      ["[foreach .rows[] as $x ({}; .[$x.k] += $x.v; .[$x.k])]", ArrayType(OptionType(IntegerType)), [some(1n), some(2n), some(4n)]],
    ];
    for (const [program, type, expected] of cases) {
      const checked = checkJq(program, Rows);
      assert.deepEqual(dictCopies(translateJq(checked).fn().toIR().ir), { all: 1, inLoops: 0 }, program);
      assertValue(type, evaluateJq(checked, rows()), expected, program);
    }
  });

  test("an update the state may reach copies it, as before: a value that is the state or several values, a foreach that gives it", () => {
    const cases: [program: string, input: EastType, value: unknown, type: EastType, expected: unknown][] = [
      ["reduce .names[] as $n (.start; .[$n] = .)", Names, { names: ["a", "b"], start: trees([]) }, Trees,
        trees([["a", trees([])], ["b", trees([["a", trees([])]])]])],
      ["reduce .names[] as $n (.start; . as $s | .[$n] = $s)", Names, { names: ["a", "b"], start: trees([]) }, Trees,
        trees([["a", trees([])], ["b", trees([["a", trees([])]])]])],
      ["def id: .; reduce .names[] as $n (.start; .[$n] = id)", Names, { names: ["a", "b"], start: trees([]) }, Trees,
        trees([["a", trees([])], ["b", trees([["a", trees([])]])]])],
      // Each of the update's values is set on the state as it was, and the last stays.
      ["reduce .rows[] as $x ({}; .[$x.k] += ($x.v, 10))", Rows, rows(), Counts, counts([["a", 20n], ["b", 10n]])],
      ["[foreach .rows[] as $x ({}; .[$x.k] += $x.v)]", Rows, rows(), ArrayType(Counts),
        [counts([["a", 1n]]), counts([["a", 1n], ["b", 2n]]), counts([["a", 4n], ["b", 2n]])]],
    ];
    for (const [program, input, value, type, expected] of cases) {
      const checked = checkJq(program, input);
      const copies = dictCopies(translateJq(checked).fn().toIR().ir);
      // The state is copied at each update, and init is the state as it is, with no copy before the loop.
      assert.ok(copies.inLoops > 0, program);
      assert.equal(copies.all, copies.inLoops, program);
      assertValue(type, evaluateJq(checked, value), expected, program);
    }
  });

  test("the state starts as a copy of init, so a frozen input it starts from is never changed", () => {
    const value = rows();
    const frozen = decodeBeast2For(Rows, { frozen: true })(encodeBeast2For(Rows)(value));
    const checked = checkJq("reduce .rows[] as $x (.start; .[$x.k] += $x.v)", Rows);
    assert.deepEqual(dictCopies(translateJq(checked).fn().toIR().ir), { all: 1, inLoops: 0 });
    assertValue(Counts, evaluateJq(checked, frozen), counts([["a", 4n], ["b", 12n]]));
    assertValue(Counts, evaluateJq(checked, value), counts([["a", 4n], ["b", 12n]]));
    // Run again on the same input, which the first run left as it was.
    assertValue(Counts, evaluateJq(checked, value), counts([["a", 4n], ["b", 12n]]));
    assertValue(Counts, value.start, counts([["b", 10n]]));
  });
});

// ─── A stage's rows folded as they are made (#1140) ──────────────────────

/**
 * The pushes onto arrays in a translation: in all, and those an `if` guards
 * with an array's size below a count — the most rows a step keeps.
 */
function arrayPushes(ir: IR): { all: number; capped: number } {
  const count = (root: IR): number => {
    let n = 0;
    walkIR(root, node => { if (node.type === "Builtin" && node.value.builtin === "ArrayPushLast") n += 1; });
    return n;
  };
  let capped = 0;
  walkIR(ir, node => {
    if (node.type !== "IfElse") return;
    for (const { predicate, body } of node.value.ifs) {
      const size = predicate.type === "Builtin" && predicate.value.builtin === "Less" ? predicate.value.arguments[0] : undefined;
      if (size?.type === "Builtin" && size.value.builtin === "ArraySize") capped += count(body);
    }
  });
  return { all: count(ir), capped };
}

describe("a stage's rows folded as they are made (#1140)", () => {
  const fixture = queryFixture();
  const none = { ...fixture, orders: [] };
  /** A stage over the orders and a step after it: as one pipe, and with the stage's rows collected first, bound to a variable no step folds. */
  const programs = (stage: string, step: string): [fused: string, collected: string] =>
    [`.orders | ${stage} | ${step}`, `.orders | ${stage} as $rows | $rows | ${step}`];
  /** What a program gives over a value: its answer, printed, or the message it raised. */
  const outcome = (program: string, value: unknown): string => {
    const checked = checkJq(program, FixtureRoot);
    assert.ok(checked.program !== null, `${program} checks`);
    try {
      return printFor(translateJq(checked).resultType)(evaluateJq(checked, value) as never);
    } catch (e) {
      // The message alone: the two programs place the step at different columns.
      if (e instanceof QueryError) return `raised ${e.diagnostics.map(d => d.message).join("; ")}`;
      throw e;
    }
  };
  /** Steps that fold every row the stage makes: no array is built. */
  const FOLDS: [stage: string, step: string][] = [
    ["map(.total)", "add"], ["map(.customer_id)", "add"], ["map(select(.total < 0) | .total)", "add"], ["map(empty)", "add"],
    ["map(.total)", "min"], ["map(.id)", "max"],
    ["map(.total)", "length"], ["map(select(.total > 1000))", "length"], ["[.[] | select(.total > 1000)]", "length"], ["[.[] | .lines[]]", "length"],
    ["map(.total > 1000)", "any"], ["map(.lines | length > 0)", "all"],
    ["map(.total)", "reduce .[] as $t (0.0; . + $t)"], ["map(select(.total > 1000))", "reduce .[] as $o ({}; .[$o.customer_id] += $o.total)"],
    ["map(.total)", "add | floor"], ["map(.total)", ". | add"], ["map(.id)", ".[:0]"],
  ];
  /** Steps that keep the first rows the stage makes: at most that many are collected. */
  const FIRSTS: [stage: string, step: string][] = [
    ["map(select(.total > 1000))", "first"], ["map(.id)", ".[:3]"], ["[.[] | .id, .total]", ".[:5]"], ["map(.id)", "first | . + 1"],
  ];
  /** Stages whose rows may raise, past the rows a step needs: jq makes every row first, so they are made, and raise. */
  const RAISING: [stage: string, step: string][] = [
    ["map(if .total > 1000 then error(\"too much\") else .id end)", "first"],
    ["map(if .total > 1000 then error(\"too much\") else .id end)", ".[:1]"],
    ["map(.id / (.id - 1040))", "any"],
    ["map(.id % (.id - 1040))", "all"],
  ];

  test("a fold builds no array of the stage's rows, and first and .[:n] keep at most n: what the rows collected first build", () => {
    for (const [stage, step] of [...FOLDS, ...FIRSTS, ...RAISING]) {
      const [fused, collected] = programs(stage, step);
      const pushes = arrayPushes(translateJq(checkJq(fused, FixtureRoot)).fn().toIR().ir);
      const where = `${fused}: ${JSON.stringify(pushes)}`;
      const is = (list: readonly [string, string][]): boolean => list.some(([s, t]) => s === stage && t === step);
      if (is(FOLDS)) assert.deepEqual(pushes, { all: 0, capped: 0 }, fused);
      // Every push is capped: one for each place the stage gives a row (`.id, .total` gives two).
      else if (is(FIRSTS)) assert.ok(pushes.all > 0 && pushes.all === pushes.capped, where);
      // Rows that may raise are all made: a fold pushes none of them, and first and .[:n] keep theirs capped all the same.
      else assert.equal(pushes.all, pushes.capped, where);
      // Collected first, the rows are all pushed, none capped: the array the fold does without.
      const before = arrayPushes(translateJq(checkJq(collected, FixtureRoot)).fn().toIR().ir);
      if (stage !== "map(empty)") assert.ok(before.all > before.capped, `${collected}: ${JSON.stringify(before)}`);
    }
  });

  test("each answers as the rows collected first do, over the orders and over none, a row that raises included", () => {
    for (const [stage, step] of [...FOLDS, ...FIRSTS, ...RAISING]) {
      const [fused, collected] = programs(stage, step);
      for (const value of [fixture, none]) assert.equal(outcome(fused, value), outcome(collected, value), fused);
    }
    for (const [stage, step] of RAISING) assert.match(outcome(programs(stage, step)[0], fixture), /^raised /, stage);
  });

  test("in a lenient place, where a row may raise for its kind, the stage makes every row", () => {
    // `.discount * 2` raises for an order with no discount, which `try` lets by: jq makes every row, and the try catches.
    const cases: [fused: string, collected: string][] = [
      ["[try (.orders | map(.discount * 2) | first)]", "[try (.orders | map(.discount * 2) as $rows | $rows | first)]"],
      ["def d: .orders | map(.discount * 2) | .[:1]; [try d]", "def d: .orders | map(.discount * 2) as $rows | $rows | .[:1]; [try d]"],
    ];
    for (const [fused, collected] of cases) {
      assert.equal(outcome(fused, fixture), "[]", fused);
      assert.equal(outcome(fused, fixture), outcome(collected, fixture), fused);
    }
  });

  test("a break out of the stage leaves it as a raise does: the stage makes every row, unless the break stays inside its filter", () => {
    const cases: [fused: string, collected: string][] = [
      ["[label $out | .orders | map(if .id == 1005 then break $out else .id end) | first]",
        "[label $out | .orders | map(if .id == 1005 then break $out else .id end) as $rows | $rows | first]"],
      ["[.orders | map(label $l | (.id, break $l)) | first]", "[.orders | map(label $l | (.id, break $l)) as $rows | $rows | first]"],
      ["[label $out | .orders | map(try (if .id == 1005 then break $out else .id end)) | .[:2]]",
        "[label $out | .orders | map(try (if .id == 1005 then break $out else .id end)) as $rows | $rows | .[:2]]"],
      ["[.orders | map(try (if .id == 1005 then error(\"refunded\") else .id end)) | .[:2]]",
        "[.orders | map(try (if .id == 1005 then error(\"refunded\") else .id end)) as $rows | $rows | .[:2]]"],
    ];
    for (const [fused, collected] of cases) assert.equal(outcome(fused, fixture), outcome(collected, fixture), fused);
    assert.equal(outcome(cases[0]![0], fixture), "[]");
  });

  test("a stage a step does not fold, or a def of a step's name, collects its rows as written", () => {
    for (const program of [
      ".orders | map(.total) | sort",
      ".orders | map(.total) | .[1:]",
      ".orders | map(.total) | .[:-1]",
      ".orders | map(.total) | reduce .[] as $t (length; . + $t)",
      ".orders | map(.total) | add(.[])",
      "def add: length; .orders | map(.total) | add",
      "def map(f): [.[] | f]; .orders | map(.total) | add",
    ]) {
      assert.ok(arrayPushes(translateJq(checkJq(program, FixtureRoot)).fn().toIR().ir).all > 0, program);
    }
  });
});

// ─── A query's rows narrowed to the fields its later steps read (#1141) ──

/** The fields of each struct a translation builds, each struct's joined. */
function structsBuilt(ir: IR): string[] {
  const built: string[] = [];
  walkIR(ir, node => { if (node.type === "Struct") built.push(node.value.fields.map(f => f.name).join(",")); });
  return built;
}

describe("a query's rows narrowed to the fields its later steps read (#1141)", () => {
  const fixture = queryFixture();
  /** The program as written: one that defines a function, which is never narrowed, and never calls it. */
  const written = (program: string): string => `def unread: .; ${program}`;
  /** A program checked as an e3 root over the fixture's datasets. */
  const checked = (program: string): CheckJqResult => {
    const c = checkJq(program, FixtureRoot, { root: true });
    assert.ok(c.program !== null, `${program} checks`);
    return c;
  };
  /** What a program gives over the fixture: its answer, printed, or the message it raised and the text it raised at. */
  const outcome = (program: string): string => {
    const c = checked(program);
    try {
      return printFor(translateJq(c).resultType)(evaluateJq(c, fixture) as never);
    } catch (e) {
      if (!(e instanceof QueryError)) throw e;
      return `raised ${e.diagnostics.map(d => `${d.message} at ${d.span.type === "some" ? program.slice(Number(d.span.value.offset), Number(d.span.value.offset + d.span.value.length)) : "-"}`).join("; ")}`;
    }
  };
  /** Rows built or kept with fields no later step reads: each is narrowed. */
  const NARROWED: readonly string[] = [
    ".customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, n: length})",
    ".orders | map(. + {big: (.total > 1000)}) | group_by(.big) | map({big: .[0].big, n: length})",
    ".orders | map(. + {total: (.total * 2)}) | map(.total) | add",
    ".orders | map(. + {id: \"s\"}) | map(.id)",
    ".orders | map({id, total, n: (.lines | length)}) | map(.id + .n)",
    ".orders | map(select(.total > 1000)) | sort_by(-.total) | .[:3] | map(.id)",
    ".orders | [.[] | select(.total > 100)] | map(.id)",
    ".orders | map(if .total > 1000 then . else empty end) | map(.id)",
    ".orders | map(select(.discount != null)) | map(.discount + 1)",
    ".orders | map(select(.status.type == \"shipped\")) | map(.status.value)",
    ".orders | map(. + {x: .total}) | unique_by(.customer_id) | map(.x)",
    ".orders | map(. + {x: .total}) | max_by(.x) | {id, x}",
    ".orders | map(. + {x: .total}) | reverse | .[2:5] | map(.x)",
    ".orders | map(. + {x: .total}) | first(.[] | select(.x > 1000)) | .id",
    ".orders | map(. + {x: .total}) | map(\"\\(.id)-\\(.x)\")",
    ".orders | map(. + {x: .total}) | map(try .x catch 0) | add",
    "[.orders[] | {a: .id, b: .total} | .a]",
    ".orders | map({a: .id, $__loc__}) | map(.a)",
    // A field none reads that raises, or gives no value or many, is made all the same.
    ".orders | map(. + {x: error(\"refused\")}) | map(.id)",
    ".orders | map(. + {x: (1 / (.id - 1040))}) | map(.id)",
    ".orders | map(. + {x: (.lines[] | .qty)}) | map(.id) | length",
    ".orders | map(. + {x: empty}) | map(.id)",
  ];
  /** Rows read whole, or with nothing left out but what may raise or give other than one value: each runs as written. */
  const WRITTEN: readonly string[] = [
    ".orders | map(. + {x: 1})",
    ".orders | map(select(.total > 1000)) | .[0]",
    ".orders | map(select(.total > 1000)) | map(keys)",
    ".orders | map(. + {x: 1}) | map(tojson) | length",
    ".orders | map(. + {x: 1}) | map(length)",
    ".orders | map(. + {x: 1}) | map(has(\"id\"))",
    ".orders | map(. + {x: 1}) | map(. == .)",
    ".orders | map(. + {x: .total}) | . as $all | $all | map(.x) | add",
    ".orders | map(. + {x: .total}) | reduce .[] as $o (0; . + $o.x)",
    ".orders | map({id, qty: .lines[].qty}) | map(.id) | length",
    ".orders | map({id, r: (.total / 0)}) | map(.id)",
    "[.orders[] | try ({a: .id, b: .total} | .a)]",
    ".orders | map(. * {x: 1}) | map(.x)",
    ".orders | map(select(.total > 1000)) | length",
    // Leaving `b` out would leave a dataset unread: the program's inputs are what it reads.
    "{a: (.orders | length), b: (.customers | length)} | .a",
    "def unread: .; .orders | map(. + {x: 1}) | map(.x)",
  ];

  test("each builds and keeps only the fields read after it, and answers as the program as written does", () => {
    for (const program of NARROWED) {
      const c = checked(program);
      assert.notEqual(narrowRows(c), c, `${program} is narrowed`);
      assert.equal(outcome(program), outcome(written(program)), program);
    }
    for (const program of WRITTEN) {
      const c = checked(program);
      assert.equal(narrowRows(c), c, `${program}: ${printJq(narrowRows(c).program!).text}`);
    }
  });

  test("a field none reads that raises is made, and its error names the query as written", () => {
    assert.equal(outcome(NARROWED[19]!), "raised runtime: Division by zero at 1 / (.id - 1040)");
    assert.match(outcome(NARROWED[18]!), /^raised runtime: refused at error\("refused"\)/);
  });

  test("revenue by region builds no struct of an order's unread fields, as one unit or in its pieces", () => {
    const program = NARROWED[0]!;
    // The order's fields that revenue by region never reads.
    const unread = ["discount", "id", "lines", "status"];
    const holdsUnread = (fields: string): boolean => fields.split(",").some(f => unread.includes(f));
    const one = structsBuilt(translateJq(checked(program)).fn().toIR().ir);
    assert.ok(one.length > 0 && !one.some(holdsUnread), JSON.stringify(one));
    const s = splitJq(checked(program));
    assert.ok(s.kind === "split");
    const piece = structsBuilt(s.piece().toIR().ir);
    assert.ok(piece.length > 0 && !piece.some(holdsUnread), JSON.stringify(piece));
    // As written, each order widened is built of all its fields.
    assert.ok(structsBuilt(translateJq(checked(written(program))).fn().toIR().ir).some(holdsUnread));
  });
});
