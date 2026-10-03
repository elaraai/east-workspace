/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The jq front end (#875, #920 P1–P4): the lexer, the parser and the
 * canonical printer, and the round-trip law that joins them. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ArrayType, BlobType, BooleanType, DateTimeType, FloatType, IntegerType, JqType, NullType, QueryErrorType, QuerySpanType,
  StringType,
  encodeBeast2For, equalFor, lexJq, none, parseFor, parseJq, pathAt, printJq, some, spanOf, toQuerySpan, variant,
  type JqNode, type JqPattern, type JqSpans, type JqTokenKind, type ValueTypeOf,
} from "../src/index.js";
import { DateTimeFormatTokenType } from "../src/datetime_format/types.js";
import { jqChildren } from "../src/query/jq/spans.js";
import { QUERY_CORPUS } from "./query.corpus.js";

const equalProgram = equalFor(JqType);
const equalError = equalFor(QueryErrorType);
const equalSpan = equalFor(QuerySpanType);

type QueryError = ValueTypeOf<typeof QueryErrorType>;
type StringPart = Extract<JqNode, { type: "string" }>["value"][number];
type ObjectEntry = Extract<JqNode, { type: "object" }>["value"][number];

/**
 * Parses a program the test expects to parse.
 *
 * @param text - the program
 * @returns its tree
 */
function programOf(text: string): JqNode {
  const parsed = parseJq(text);
  if (parsed.program.type === "none") {
    throw new Error(`${text} does not parse: ${parsed.diagnostics.map(d => d.message).join(" ")}`);
  }
  return parsed.program.value;
}

/**
 * Asserts two programs' spans are the same, path for path.
 *
 * @param actual - the spans found
 * @param expected - the spans wanted
 * @param label - what the spans are of, for the message
 */
function assertSpansEqual(actual: JqSpans, expected: JqSpans, label: string): void {
  assert.equal(actual.size, expected.size, `${label}: ${actual.size} spans, not ${expected.size}`);
  for (const [path, range] of expected) {
    assert.deepEqual(actual.get(path), range, `${label}: the span of "${path}"`);
  }
}

/**
 * Asserts the round-trip law for one program: in both layouts, its canonical
 * text parses back to it, with the spans the printer gave, and the pipeline
 * layout is the line layout with the top-level chain broken.
 *
 * @param program - the program
 * @param label - what it is, for the message
 */
function assertRoundTrip(program: JqNode, label: string): void {
  const line = printJq(program);
  const pipeline = printJq(program, { layout: "pipeline" });
  for (const printed of [line, pipeline]) {
    const parsed = parseJq(printed.text);
    assert.equal(parsed.diagnostics.length, 0,
      `${label}: ${printed.text} does not parse: ${parsed.diagnostics.map(d => d.message).join(" ")}`);
    assert.ok(parsed.program.type === "some" && equalProgram(parsed.program.value, program),
      `${label}: ${printed.text} reads back as another program`);
    assertSpansEqual(parsed.spans, printed.spans, `${label}: ${printed.text}`);
  }
  assert.equal(pipeline.text.replaceAll("\n| ", " | ").replaceAll("\n", " "), line.text, `${label}: the layouts differ`);
}

/**
 * Whether a program holds a node of a case.
 *
 * @param node - the program
 * @param jqCase - the case
 * @returns `true` when some node of it has that case
 */
function holds(node: JqNode, jqCase: string): boolean {
  return node.type === jqCase || jqChildren(node).some(child => child.node !== undefined && holds(child.node, jqCase));
}

describe("the corpus (P1)", () => {
  for (const c of QUERY_CORPUS) {
    test(c.name, () => {
      // A case with no canonical text is a program that does not parse; its problems are C1's.
      if (c.canonical === "") {
        assert.equal(parseJq(c.program).program.type, "none", `${c.program} parses, but its case has no canonical text`);
        return;
      }
      const program = programOf(c.program);
      const jqCase = c.name.split("-")[0]!;
      if (Object.keys(JqType.node.cases).includes(jqCase)) {
        assert.ok(holds(program, jqCase), `${c.program} has no ${jqCase} node`);
      }
      assert.equal(printJq(program).text, c.canonical);
      assertRoundTrip(program, c.name);
    });
  }
});

/** A seeded source of choices (Park–Miller), so every run generates the same
 *  programs. */
class Choices {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** A whole number from 0 to `n` − 1. */
  int(n: number): number {
    this.state = (this.state * 48271) % 2147483647;
    return this.state % n;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  times<T>(n: number, make: () => T): T[] {
    return Array.from({ length: n }, () => make());
  }
}

const encodeNull = encodeBeast2For(NullType);
const encodeBoolean = encodeBeast2For(BooleanType);
const encodeInteger = encodeBeast2For(IntegerType);
const encodeFloat = encodeBeast2For(FloatType);
const encodeString = encodeBeast2For(StringType);

/** Names a field or a key can have: identifiers, keywords, and names that
 *  must be quoted. */
const KEYS = ["a", "total", "orders", "if", "not", "__loc__", "a b", "", "1x", "é", "🚚", "a\"b", "a\\(b", "x::y"];
/** Names a variable can read, `$__loc__` included. */
const VARIABLES = ["x", "o", "if", "a1", "__loc__"];
/** Names a pattern, a label or a `$` parameter can bind. */
const BINDINGS = ["x", "o", "if", "not", "a1"];
/** Names a function can be called by; `true` only with arguments. */
const FUNCTIONS = ["f", "length", "map", "select", "not", "g1", "x::y"];
const FORMATS = ["base64", "csv", "text", "json", "sh", "uri", "html", "base32d"];
const BINARY_OPS = ["or", "and", "==", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%"];
const UPDATE_OPS = ["=", "|=", "+=", "-=", "*=", "/=", "%=", "//="];
const TEXTS = ["a", "Order ", "a\"b", "back\\slash", "end\\", "\\(not interpolated)", "line\nbreak\ttab", "\u0001\u007f", "é 🚚 €", "#", "$x", "{}"];
const INTEGERS = [0n, 1n, 42n, 1001n, 9223372036854775807n];
const FLOATS = [0, 0.5, 1, 1.5, 100, 1e21, 1.5e-7, 123456.789, 5e-324, 1.7976931348623157e308];

/**
 * Generates a program the parser could have made: its literals are
 * non-negative and finite, its strings well-formed, its interpolating strings
 * alternate text and queries, and its names are ones the lexer reads.
 *
 * @param r - the choices
 * @param depth - how deep it may nest
 * @returns the program
 */
function generate(r: Choices, depth: number): JqNode {
  if (depth === 0 || r.chance(20)) return generateLeaf(r);
  const g = (): JqNode => generate(r, depth - 1);
  switch (r.int(22)) {
    case 0: return variant("alternative", { left: g(), right: g() });
    case 1: return variant("array", r.chance(80) ? some(g()) : none);
    case 2: return variant("binary", { left: g(), op: r.pick(BINARY_OPS), right: g() });
    case 3: return variant("bind", { body: g(), patterns: r.times(1 + r.int(2), () => generatePattern(r, 2)), source: g() });
    case 4: return variant("call", { args: r.times(1 + r.int(3), g), name: r.pick([...FUNCTIONS, "true"]) });
    case 5: return variant("comma", { left: g(), right: g() });
    case 6: return variant("def", { body: g(), name: r.pick(["f", "g", "revenue"]), params: r.times(r.int(3), () => r.pick(["$x", "f", "$y", "g"])), rest: g() });
    case 7: return variant("field", { name: r.pick(KEYS), optional: r.chance(30), target: g() });
    case 8: return variant("foreach", { extract: r.chance(50) ? some(g()) : none, init: g(), pattern: generatePattern(r, 2), source: g(), update: g() });
    case 9: return variant("format", { name: r.pick(FORMATS), string: some(r.chance(50) ? generateString(r, depth - 1) : variant("literal", encodeString(r.pick(TEXTS)))) });
    case 10: return variant("if", { branches: r.times(1 + r.int(2), () => ({ condition: g(), then: g() })), otherwise: r.chance(60) ? some(g()) : none });
    case 11: return variant("index", { index: g(), optional: r.chance(30), target: g() });
    case 12: return variant("iterate", { optional: r.chance(30), target: g() });
    case 13: return variant("label", { body: g(), name: r.pick(BINDINGS) });
    case 14: return variant("negate", g());
    case 15: return variant("object", r.times(r.int(4), () => generateEntry(r, depth - 1)));
    case 16: return variant("pipe", { left: g(), right: g() });
    case 17: return variant("reduce", { init: g(), pattern: generatePattern(r, 2), source: g(), update: g() });
    case 18: {
      const bounds = r.int(3);   // from only, to only, or both
      return variant("slice", { from: bounds !== 1 ? some(g()) : none, optional: r.chance(30), target: g(), to: bounds !== 0 ? some(g()) : none });
    }
    case 19: return generateString(r, depth - 1);
    case 20: return variant("try", { body: g(), catch: r.chance(50) ? some(g()) : none });
    default: return variant("update", { op: r.pick(UPDATE_OPS), path: g(), value: g() });
  }
}

function generateLeaf(r: Choices): JqNode {
  switch (r.int(8)) {
    case 0: return variant("identity", null);
    case 1: return variant("descend", null);
    case 2:
      switch (r.int(5)) {
        case 0: return variant("literal", encodeNull(null));
        case 1: return variant("literal", encodeBoolean(r.chance(50)));
        case 2: return variant("literal", encodeInteger(r.pick(INTEGERS)));
        case 3: return variant("literal", encodeFloat(r.pick(FLOATS)));
        default: return variant("literal", encodeString(r.pick(["", ...TEXTS])));
      }
    case 3: return variant("variable", r.pick(VARIABLES));
    case 4: return variant("call", { args: [], name: r.pick(FUNCTIONS) });
    case 5: return variant("format", { name: r.pick(FORMATS), string: none });
    case 6: return variant("break", r.pick(BINDINGS));
    default: return variant("field", { name: r.pick(KEYS), optional: r.chance(30), target: variant("identity", null) });
  }
}

/** A string with interpolations: no two texts side by side, none empty. */
function generateString(r: Choices, depth: number): JqNode {
  const parts: StringPart[] = [];
  for (let i = 1 + r.int(2); i > 0; i--) {
    if (r.chance(60)) parts.push(variant("text", r.pick(TEXTS)));
    parts.push(variant("interpolate", generate(r, depth)));
  }
  if (r.chance(50)) parts.push(variant("text", r.pick(TEXTS)));
  return variant("string", parts);
}

function generateEntry(r: Choices, depth: number): ObjectEntry {
  switch (r.int(3)) {
    case 0: return { key: variant("name", r.pick(KEYS)), value: r.chance(60) ? some(generate(r, depth)) : none };
    case 1: {
      // `{$__loc__}` takes no value.
      const name = r.pick(VARIABLES);
      return { key: variant("variable", name), value: name !== "__loc__" && r.chance(40) ? some(generate(r, depth)) : none };
    }
    default: {
      const key = r.chance(50) ? generateString(r, depth) : generate(r, depth);
      // Only a string term stands as a key without a value.
      const term = key.type === "string" || (key.type === "format" && key.value.string.type === "some");
      return { key: variant("computed", key), value: !term || r.chance(60) ? some(generate(r, depth)) : none };
    }
  }
}

function generatePattern(r: Choices, depth: number): JqPattern {
  if (depth === 0 || r.chance(40)) return variant("variable", r.pick(BINDINGS));
  if (r.chance(50)) return variant("array", r.times(1 + r.int(2), () => generatePattern(r, depth - 1)));
  return variant("object", r.times(1 + r.int(2), () => r.chance(40)
    ? { key: r.pick(BINDINGS), value: none }
    : { key: r.pick(KEYS), value: some(generatePattern(r, depth - 1)) }));
}

describe("the round-trip law (P1)", () => {
  test("5 000 generated programs, depth ≤ 6, read back in both layouts with their spans", () => {
    const r = new Choices(920);
    for (let i = 0; i < 5000; i++) {
      assertRoundTrip(generate(r, 6), `generated program ${i}`);
    }
  });
});

describe("the pipeline layout (P2)", () => {
  // `Query Editor Spec.md` §4.7: the mock's default query, as the editor prints it.
  const DEFAULT_QUERY = [
    ".customers as $customers",
    "| .orders",
    "| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "| map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "| sort_by(-.total)",
    "| .[:10]",
  ].join("\n");

  test("prints the mock's default query exactly as the spec shows it", () => {
    const oneLine = DEFAULT_QUERY.replaceAll("\n", " ");
    assert.equal(printJq(programOf(oneLine), { layout: "pipeline" }).text, DEFAULT_QUERY);
    assert.equal(printJq(programOf(DEFAULT_QUERY)).text, oneLine);
  });

  test("breaks the chain through the bodies of the as, label and def that lead it", () => {
    assert.equal(printJq(programOf("def f: .a; def g($x): $x; .b | f | g(1)"), { layout: "pipeline" }).text,
      "def f: .a;\ndef g($x): $x;\n.b\n| f\n| g(1)");
    assert.equal(printJq(programOf("label $out | .orders[] | ., break $out"), { layout: "pipeline" }).text,
      "label $out\n| .orders[]\n| ., break $out");
    assert.equal(printJq(programOf(".a | .b as [$x, $y] ?// $x | $x"), { layout: "pipeline" }).text,
      ".a\n| .b as [$x, $y] ?// $x\n| $x");
  });

  test("keeps nested pipes on one line", () => {
    assert.equal(printJq(programOf(".orders | map(.lines | length) | [.[] | . * 2] | (.a | .b), 1"), { layout: "pipeline" }).text,
      ".orders\n| map(.lines | length)\n| [.[] | . * 2]\n| (.a | .b), 1");
  });
});

describe("canonical text", () => {
  // Each program, and the one text the printer makes of it.
  const CANONICAL: readonly (readonly [program: string, canonical: string])[] = [
    ["  .orders|length   # how many", ".orders | length"],
    ["((.orders[0])).total * (2)", ".orders[0].total * 2"],
    [".forecast.\"regions\"", ".forecast.regions"],
    [".orders.[0].id", ".orders[0].id"],
    ["\"\\u0041\\/b\\u00e9\\t\"", "\"A/bé\\t\""],
    ["[1e2, 1.50, 0.5e1, 1e21, 0.0000001]", "[100.0, 1.5, 5.0, 1e+21, 1e-7]"],
    ["try first(.orders[])", "first(.orders[])?"],
    ["try .orders[0]", "try .orders[0]"],
    ["try (.a | .b)", "try (.a | .b)"],
    ["{\"id\": 1, \"a b\": 2, $__loc__, \"if\": 3}", "{id: 1, \"a b\": 2, $__loc__, if: 3}"],
    ["-(1)", "-1"],
    ["- (-1)", "- -1"],
    ["1-(-2)", "1 - -2"],
    ["(.a as $x | $x) | .b", "(.a as $x | $x) | .b"],
    ["1, (.a as $x | $x)", "1, .a as $x | $x"],
    ["(1, .a as $x | $x), 2", "1, (.a as $x | $x), 2"],
    ["(1).a", "(1).a"],
    ["(1.5).a", "1.5.a"],
    ["(..).a", "(..).a"],
    ["try (try .a) catch .b", "try (try .a) catch .b"],
    ["try -(try .a) catch .b", "try -(try .a) catch .b"],
    ["try (try .a catch (try .b)) catch .c", "try try .a catch (try .b) catch .c"],
    ["(try .a)[0]", "(try .a)[0]"],
    ["{a: (1 | 2)}", "{a: 1 | 2}"],
    ["{a: (1, 2)}", "{a: (1, 2)}"],
    ["{a: (.b as $x | $x)}", "{a: (.b as $x | $x)}"],
    ["{\"a\\(1)\"}", "{\"a\\(1)\"}"],
    ["{(@base64): 1, (\"k\"): 2}", "{(@base64): 1, (\"k\"): 2}"],
    [".@base64 \"x\"", ".[@base64 \"x\"]"],
    ["if . then 1 elif . then 2 end", "if . then 1 elif . then 2 end"],
    [". as [$a, {b: $c, $d, \"e f\": $g}] ?// $a | $a", ". as [$a, {b: $c, $d, \"e f\": $g}] ?// $a | $a"],
    ["def f(g; $x): g + $x; f(.; 1)", "def f(g; $x): g + $x; f(.; 1)"],
    [".a[1:]?, .a[:2], .a[]?, .a[0]?", ".a[1:]?, .a[:2], .a[]?, .a[0]?"],
    [".a |= . + 1 | .b //= 2", ".a |= . + 1 | .b //= 2"],
    ["(.a // .b) |= 1", "(.a // .b) |= 1"],
    ["reduce (.[] | .a) as $x (0; . + $x)", "reduce (.[] | .a) as $x (0; . + $x)"],
  ];

  for (const [program, canonical] of CANONICAL) {
    test(`${program} → ${canonical}`, () => {
      const printed = printJq(programOf(program)).text;
      assert.equal(printed, canonical);
      assert.equal(printJq(programOf(canonical)).text, canonical);
      assertRoundTrip(programOf(program), program);
    });
  }

  test("prints a checked program's rewritten literals as the text they were rewritten from", () => {
    const date = parseFor(DateTimeType)("2026-09-01T00:00:00.000");
    assert.ok(date.success);
    const tokens = encodeBeast2For(ArrayType(DateTimeFormatTokenType))([
      variant("year4", null), variant("literal", "-%"), variant("month2", null),
    ]);
    const program: JqNode = variant("comma", {
      left: variant("comma", {
        left: variant("literal", encodeBeast2For(DateTimeType)(date.value)),
        right: variant("call", { args: [variant("literal", tokens)], name: "strftime" }),
      }),
      right: variant("literal", encodeBeast2For(ArrayType(StringType))(["a", "b"])),
    });
    assert.equal(printJq(program).text, "\"2026-09-01T00:00:00.000+00:00\", strftime(\"%Y-%%%m\"), [\"a\", \"b\"]");
  });

  test("prints nothing that reads back as another program", () => {
    const refused: readonly (readonly [JqNode, RegExp])[] = [
      [variant("literal", encodeBeast2For(BlobType)(new Uint8Array([1, 2]))), /a Blob literal has no jq text/],
      [variant("call", { args: [], name: "if" }), /"if" is not a jq function name/],
      [variant("call", { args: [], name: "true" }), /"true" is not a jq function name/],
      [variant("binary", { left: variant("identity", null), op: "**", right: variant("identity", null) }), /"\*\*" is not a jq binary operator/],
      [variant("if", { branches: [], otherwise: none }), /an `if` with no branch/],
      [variant("object", [{ key: variant("computed", variant("identity", null)), value: none }]), /a computed key `\(k\)` needs a value/],
      [variant("variable", "a b"), /"a b" is not a jq variable/],
    ];
    for (const [program, message] of refused) assert.throws(() => printJq(program), message);
  });
});

describe("precedence", () => {
  // Each program, and the same program with every operand in parentheses.
  const PRECEDENCE: readonly (readonly [program: string, parenthesised: string])[] = [
    ["1 + 2 * 3", "1 + (2 * 3)"],
    ["1 * 2 + 3", "(1 * 2) + 3"],
    ["1 - 2 - 3", "(1 - 2) - 3"],
    ["8 / 4 / 2", "(8 / 4) / 2"],
    ["7 % 4 * 2", "(7 % 4) * 2"],
    ["-1 + 2", "(-1) + 2"],
    ["-.a * 2", "(-(.a)) * 2"],
    ["1 - -1", "1 - (-1)"],
    ["1 + 2 == 3", "(1 + 2) == 3"],
    ["1 < 2 and 3 > 2", "(1 < 2) and (3 > 2)"],
    [".a and .b or .c", "(.a and .b) or .c"],
    [".a or .b and .c", ".a or (.b and .c)"],
    [".a == 1 or .b != 2 and .c", "(.a == 1) or ((.b != 2) and .c)"],
    [".a // .b // .c", ".a // (.b // .c)"],
    [".a // .b or .c", ".a // (.b or .c)"],
    [".a = 1 // 2", "(.a = 1) // 2"],
    [".a.b |= .c // 1", "((.a.b) |= .c) // 1"],
    [".a |= . + 1", ".a |= (. + 1)"],
    [".a += 1 | .b", "(.a += 1) | .b"],
    ["1, 2 | 3", "(1, 2) | 3"],
    ["1 | 2, 3", "1 | (2, 3)"],
    ["1, 2, 3", "(1, 2), 3"],
    [".a | .b | .c", ".a | (.b | .c)"],
    ["1 as $x | 2 | 3", "1 as $x | (2 | 3)"],
    ["1, 2 as $x | $x", "1, (2 as $x | $x)"],
    ["1 + 2 as $x | $x", "(1 + 2) as $x | $x"],
    ["-1 as $x | $x", "(-1) as $x | $x"],
    [".[] as [$a] ?// $a | $a + 1", ".[] as [$a] ?// $a | ($a + 1)"],
    ["def f: 1; f | f", "def f: 1; (f | f)"],
    ["label $l | 1, 2", "label $l | (1, 2)"],
    ["try 1 catch 2 + 10", "(try 1 catch 2) + 10"],
    ["try -1 + 1", "(try (-1)) + 1"],
    ["try error(\"x\") catch . | length", "(try error(\"x\") catch .) | length"],
    [".a.b[0]", "((.a).b)[0]"],
    ["$x.a[1:2][]?", "((($x).a)[1:2])[]?"],
    ["reduce .[] as $x (0; . + $x) + 1", "(reduce .[] as $x (0; (. + $x))) + 1"],
    ["reduce 1 + 2 as $x (0; . + $x)", "reduce (1 + 2) as $x (0; (. + $x))"],
    ["foreach .[] as $x (0; . + $x; . * 2)", "foreach (.[]) as $x (0; (. + $x); (. * 2))"],
    ["if . then 1 else 2 end | . + 1", "(if . then 1 else 2 end) | (. + 1)"],
    ["{a: 1 | 2}", "{a: (1 | 2)}"],
    ["[1, 2 | 3]", "[(1, 2) | 3]"],
    ["\"\\(1, 2 | 3)\"", "\"\\((1, 2) | 3)\""],
  ];

  for (const [program, parenthesised] of PRECEDENCE) {
    test(`${program} is ${parenthesised}`, () => {
      assert.ok(equalProgram(programOf(program), programOf(parenthesised)));
    });
  }
});

describe("syntax diagnostics (P3)", () => {
  interface Row {
    program: string;
    message: string;
    /** `[offset, length]` on the first line, or none for no span. */
    span?: readonly [number, number];
    fix?: { label: string; offset: number; length: number; insert: string };
    code?: string;
  }
  const ROWS: readonly Row[] = [
    { program: ".a)", message: "syntax: unexpected \")\".", span: [2, 1] },
    { program: "[.a)", message: "syntax: unexpected \")\" — \"[\" at column 1 is still open.", span: [3, 1] },
    { program: "[.a", message: "syntax: \"[\" is never closed.", span: [0, 1], fix: { label: "Close it", offset: 3, length: 0, insert: "]" } },
    { program: ".a + (1", message: "syntax: \"(\" is never closed.", span: [5, 1], fix: { label: "Close it", offset: 7, length: 0, insert: ")" } },
    { program: "\"abc", message: "syntax: this string is never closed.", span: [0, 4], fix: { label: "Close it", offset: 4, length: 0, insert: "\"" } },
    { program: ".a |", message: "syntax: expected a filter after \"|\".", span: [3, 1], fix: { label: "Remove the |", offset: 3, length: 1, insert: "" } },
    { program: "  # nothing", message: "syntax: empty program." },
    { program: ".a + ", message: "syntax: unexpected end of input; expected a filter.", span: [5, 0] },
    { program: "1 2", message: "syntax: unexpected \"2\"; expected \"|\", \",\" or end of input.", span: [2, 1] },
    { program: ".a as $x", message: "syntax: unexpected end of input; expected \"|\" or \"?//\".", span: [8, 0] },
    { program: ".@base64", message: "syntax: unexpected end of input; expected a string after @base64.", span: [8, 0] },
    { program: "\"a\\qb\"", message: "syntax: invalid escape \"\\q\" in a string.", span: [2, 2] },
    { program: "9223372036854775808", message: "syntax: 9223372036854775808 is too large for an Integer; write 9223372036854775808.0 for a Float.", span: [0, 19] },
    { program: "1e999", message: "syntax: 1e999 is too large for a Float.", span: [0, 5] },
    { program: ". as {(1): $x} | $x", message: "syntax: computed keys in patterns are not supported (#875 Defer).", span: [6, 1] },
    { program: "1 == 2 == 3", message: "syntax: unexpected \"==\"; expected parentheses around one side of \"==\".", span: [7, 2] },
    { program: "import \"m\" as m; .", message: "unsupported: import is excluded — queries are deterministic and have no host access.", span: [0, 6], code: "unsupported" },
  ];

  for (const row of ROWS) {
    test(row.program, () => {
      const parsed = parseJq(row.program);
      assert.equal(parsed.program.type, "none");
      assert.equal(parsed.spans.size, 0);
      const expected: QueryError = {
        code: row.code ?? "syntax",
        fixes: row.fix === undefined ? [] : [{
          edits: [{ insert: row.fix.insert, length: BigInt(row.fix.length), offset: BigInt(row.fix.offset) }],
          label: row.fix.label,
        }],
        message: row.message,
        severity: variant("error", null),
        span: row.span === undefined ? none : some({
          column: BigInt(row.span[0] + 1), length: BigInt(row.span[1]), line: 1n, offset: BigInt(row.span[0]),
        }),
        suggestions: [],
      };
      assert.equal(parsed.diagnostics.length, 1, parsed.diagnostics.map(d => d.message).join(" "));
      assert.ok(equalError(parsed.diagnostics[0]!, expected), `${parsed.diagnostics[0]!.message} is not the diagnostic wanted`);
      if (row.fix !== undefined) {
        const fixed = row.program.slice(0, row.fix.offset) + row.fix.insert + row.program.slice(row.fix.offset + row.fix.length);
        assert.equal(parseJq(fixed).diagnostics.length, 0, `the fixed program ${fixed} parses`);
      }
    });
  }

  test("a problem on a later line has its line and column", () => {
    const [problem] = parseJq(".a\n| .b\n| .c )").diagnostics;
    assert.ok(problem !== undefined && problem.span.type === "some");
    assert.ok(equalSpan(problem.span.value, { column: 6n, length: 1n, line: 3n, offset: 13n }));
  });

  test("the parser resumes at the next top-level |, so one typo is one problem", () => {
    assert.equal(parseJq("1 2 | .a | length").diagnostics.length, 1);
    assert.equal(parseJq("1 2 | 3 4").diagnostics.length, 2);
    assert.equal(parseJq("[1 2 | 3] | .a").diagnostics.length, 1);
  });
});

describe("the lexer (P4)", () => {
  const TEXTS_TO_LEX = [
    ...QUERY_CORPUS.map(c => c.program),
    "§ \"open", "\"a\\qb\"", "1 2 | 3 4", ".a\r\n| .b\r.c # note\\\n more", "\"🚚\\ud83d\"", "\uD800 x", "$__loc__.a", "@base64 \"\\(.)\"",
  ];

  test("covers every character of the input exactly once, in order", () => {
    for (const text of TEXTS_TO_LEX) {
      const tokens = lexJq(text);
      let at = 0;
      for (const token of tokens) {
        assert.equal(token.from, at, `${text}: a gap or an overlap at ${at}`);
        assert.ok(token.to > token.from, `${text}: an empty token at ${at}`);
        assert.equal(token.text, text.slice(token.from, token.to));
        at = token.to;
      }
      assert.equal(at, text.length, `${text}: the tokens stop at ${at}`);
    }
  });

  // Each program's tokens and their kinds.
  const KINDS: readonly (readonly [program: string, tokens: readonly (readonly [string, JqTokenKind])[]])[] = [
    [".orders[] | select(.total > 1000) # big", [
      [".orders", "field"], ["[", "punctuation"], ["]", "punctuation"], [" ", "ws"], ["|", "pipe"], [" ", "ws"],
      ["select", "builtin"], ["(", "punctuation"], [".total", "field"], [" ", "ws"], [">", "operator"], [" ", "ws"],
      ["1000", "number"], [")", "punctuation"], [" ", "ws"], ["# big", "comment"],
    ]],
    ["def f($x): $x + 1; f(2)", [
      ["def", "keyword"], [" ", "ws"], ["f", "identifier"], ["(", "punctuation"], ["$x", "variable"], [")", "punctuation"],
      [":", "punctuation"], [" ", "ws"], ["$x", "variable"], [" ", "ws"], ["+", "operator"], [" ", "ws"], ["1", "number"],
      [";", "punctuation"], [" ", "ws"], ["f", "identifier"], ["(", "punctuation"], ["2", "number"], [")", "punctuation"],
    ]],
    ["\"a\\(.b)c\" | @base64", [
      ["\"a\\(", "string"], [".b", "field"], [")c\"", "string"], [" ", "ws"], ["|", "pipe"], [" ", "ws"], ["@base64", "format"],
    ]],
    [".a // null | not and true or $__loc__", [
      [".a", "field"], [" ", "ws"], ["//", "operator"], [" ", "ws"], ["null", "identifier"], [" ", "ws"], ["|", "pipe"],
      [" ", "ws"], ["not", "keyword"], [" ", "ws"], ["and", "keyword"], [" ", "ws"], ["true", "identifier"], [" ", "ws"],
      ["or", "keyword"], [" ", "ws"], ["$__loc__", "keyword"],
    ]],
    [".[] as [$a, $b] ?// $c | ..", [
      [".", "punctuation"], ["[", "punctuation"], ["]", "punctuation"], [" ", "ws"], ["as", "keyword"], [" ", "ws"],
      ["[", "punctuation"], ["$a", "variable"], [",", "operator"], [" ", "ws"], ["$b", "variable"], ["]", "punctuation"],
      [" ", "ws"], ["?//", "operator"], [" ", "ws"], ["$c", "variable"], [" ", "ws"], ["|", "pipe"], [" ", "ws"],
      ["..", "punctuation"],
    ]],
    ["1.5e3 % 2 #c\n.x?", [
      ["1.5e3", "number"], [" ", "ws"], ["%", "operator"], [" ", "ws"], ["2", "number"], [" ", "ws"], ["#c", "comment"],
      ["\n", "ws"], [".x", "field"], ["?", "operator"],
    ]],
    ["§ \"open", [["§", "other"], [" ", "ws"], ["\"open", "string"]]],
    ["\uD800 x🚚.a", [["\uD800", "other"], [" ", "ws"], ["x", "identifier"], ["🚚", "other"], [".a", "field"]]],
    ["reduce .[] as $o (0; . + 1) | {a: 1}", [
      ["reduce", "keyword"], [" ", "ws"], [".", "punctuation"], ["[", "punctuation"], ["]", "punctuation"], [" ", "ws"],
      ["as", "keyword"], [" ", "ws"], ["$o", "variable"], [" ", "ws"], ["(", "punctuation"], ["0", "number"],
      [";", "punctuation"], [" ", "ws"], [".", "punctuation"], [" ", "ws"], ["+", "operator"], [" ", "ws"], ["1", "number"],
      [")", "punctuation"], [" ", "ws"], ["|", "pipe"], [" ", "ws"], ["{", "punctuation"], ["a", "identifier"],
      [":", "punctuation"], [" ", "ws"], ["1", "number"], ["}", "punctuation"],
    ]],
  ];

  for (const [program, tokens] of KINDS) {
    test(`the kinds of ${program}`, () => {
      assert.deepEqual(lexJq(program).map(t => [t.text, t.kind]), tokens);
    });
  }

  test("every kind is in the table", () => {
    const kinds = new Set(KINDS.flatMap(([, tokens]) => tokens.map(([, kind]) => kind)));
    assert.equal(kinds.size, 14);
  });

  test("a lone surrogate reads as U+FFFD whether written raw or escaped", () => {
    const raw = programOf("\"a\uD800b\"");
    const escaped = programOf("\"a\\ud800b\"");
    const replaced = programOf("\"a\uFFFDb\"");
    assert.ok(equalProgram(raw, replaced));
    assert.ok(equalProgram(escaped, replaced));
  });
});

describe("spans", () => {
  test("pathAt finds a node covering every offset of every corpus program", () => {
    for (const c of QUERY_CORPUS) {
      const { program, spans } = parseJq(c.program);
      // A program that does not parse has no spans (P3).
      if (program.type === "none") continue;
      for (let offset = 0; offset <= c.program.length; offset++) {
        const path = pathAt(spans, offset);
        assert.ok(path !== undefined, `${c.name}: nothing at ${offset}`);
        const range = spanOf(spans, path)!;
        assert.ok(range.from <= offset && offset <= range.to, `${c.name}: "${path}" does not cover ${offset}`);
      }
    }
  });

  test("a node's span takes in its operands' parentheses, and leaves out its own", () => {
    const { spans } = parseJq(".a | (1 + 2) * 3");
    assert.deepEqual(spanOf(spans, "pipe.right"), { from: 5, to: 16 });
    assert.deepEqual(spanOf(spans, "pipe.right.binary.left"), { from: 6, to: 11 });
    assert.deepEqual(spanOf(parseJq("(.a)?").spans, "try.body"), { from: 1, to: 3 });
    assert.equal(pathAt(parseJq(".orders | length").spans, 12), "pipe.right");
    assert.equal(pathAt(parseJq(".orders | length").spans, 0), "pipe.left.field.target");
  });

  test("offsets count UTF-16 code units past a character outside the BMP (T4, TypeScript's half)", () => {
    const text = "\"🚚 \" + .orders[0].customer";
    const { spans } = parseJq(text);
    assert.deepEqual(spanOf(spans, "binary.right"), { from: 8, to: 27 });
    assert.deepEqual(lexJq(text).find(t => t.text === ".customer"), { kind: "field", from: 18, to: 27, text: ".customer" });
    assert.ok(equalSpan(toQuerySpan(text, 18, 27), { column: 19n, length: 9n, line: 1n, offset: 18n }));
  });

  test("toQuerySpan counts lines at \\n, \\r\\n and a lone \\r, and a tab as one column", () => {
    const text = ".a\n\t.b\r\n.c\r🚚.d";
    assert.ok(equalSpan(toQuerySpan(text, 0, 2), { column: 1n, length: 2n, line: 1n, offset: 0n }));
    assert.ok(equalSpan(toQuerySpan(text, 4, 6), { column: 2n, length: 2n, line: 2n, offset: 4n }));
    assert.ok(equalSpan(toQuerySpan(text, 8, 10), { column: 1n, length: 2n, line: 3n, offset: 8n }));
    assert.ok(equalSpan(toQuerySpan(text, 13, 15), { column: 3n, length: 2n, line: 4n, offset: 13n }));
  });
});
