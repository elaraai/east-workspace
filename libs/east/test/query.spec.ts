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
  SortedMap, StringType, StructType, SummaryLeafType, SummaryType, checkJq, compareFor, constValueOf, equalFor, evaluateJq, none, printFor, printJq, QueryError, some,
  QueryErrorType, QuerySpanType, runtimeErrorAt, summaryProgram, toSource, translateJq, variant,
  type ArrayExpr, type EastType, type IR, type ValueTypeOf,
} from "../src/index.js";
import { canonicalDifference, canonicalIR } from "../src/codegen/canonical.js";
import { BUILTINS } from "../src/query/jq/catalog.js";
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
      assert.equal(c.output !== undefined, checked.query !== null, c.name);
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
        if (checked.query === null) continue;
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

  test("East.jq's IR is a call of the Query builtin: the checked query, its translation, and every input (#1041)", () => {
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
    const expected = variant("v1", { inputs: some(["customers", "forecast", "orders"]), program: checked.query!.value.program });
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
  const doubled = variant("v1", { inputs: none, program: checkJq("map(. * 2)", Numbers).query!.value.program });

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
      if (checked.query === null) continue;
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

  test("a literal the checker made a Float for one kind of value stays whole for another", () => {
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
