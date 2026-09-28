/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query corpus (#875): jq programs over the shared fixture, each with
 * what the front end must make of it.
 *
 * This file is the reviewable source. `make query-corpus` runs the
 * TypeScript front end over every case and writes what it made to
 * `test/fixtures/query-corpus.beast2`, after a header holding every query wire
 * type's type value as bytes. The python front end must reproduce that file's
 * canonical texts, checked queries and diagnostics byte for byte, and its wire
 * types the header's bytes. `query.corpus.spec.ts` fails when the file is not
 * what the front end makes now.
 *
 * The corpus starts with one case per {@link JqType} case, named after it
 * (`alternative-…`), then covers every worked example of `QUERY.md`, every
 * builtin of the catalog, every diagnostic code and lint with its fixes, and
 * every deviation of `QUERY.md` §13. Each case holds what the parser and the
 * checker must make of it; the translator fills in outputs as it lands.
 */

import {
  ArrayType, BlobType, BooleanType, DateTimeType, DictType, EastTypeType, FloatType, IntegerType, NeverType, NullType,
  OptionType, SortedMap, StringType, StructType,
  JqPatternType, JqType, QueryEditType, QueryErrorType, QueryFixType, QueryMultiplicityType, QueryResultType,
  QuerySpanType, QueryType, QueryV1Type,
  canonicalTypeValue, checkJq, compareFor, encodeBeast2For, equalFor, none, parseJq, printJq, some, toEastTypeValue,
  type EastType, type ValueTypeOf,
} from "../src/index.js";
import { BUILTINS } from "../src/query/jq/catalog.js";
import { MESSAGES } from "../src/query/jq/messages.js";
import { Cell, Customer, FixtureRoot, Forecast, Line, Order, Status } from "./query.fixture.js";

/** One case of the corpus. */
export interface QueryCorpusCase {
  /** Unique, kebab-case, and led by the {@link JqType} case it is about when it
   *  is about one: `field-unknown-suggests`. */
  name: string;
  /** The type the program is checked against: usually {@link FixtureRoot}. */
  input: EastType;
  /** The program, as a person writes it. */
  program: string;
  /** The input is an e3 root (`checkJq`'s `root` option). */
  root?: boolean;
  /** `printJq(parseJq(program))`: the program's canonical text, in the line
   *  layout; empty for a program that does not parse. */
  canonical: string;
  /** The checked element type. */
  element?: EastType;
  /** The checked multiplicity. */
  multiplicity?: ValueTypeOf<typeof QueryMultiplicityType>["type"];
  /** The expected result as `.east` text, over the fixture when `input` is
   *  {@link FixtureRoot}. */
  output?: string;
  /** The expected diagnostics, in the order the checker reports them: a code,
   *  a span as `[offset, length]` in UTF-16 code units, the suggestions, each
   *  fix as its label and the program after its edits, and `warning` for a
   *  lint. */
  diagnostics?: {
    code: string;
    span: [offset: number, length: number];
    suggestions?: string[];
    fixes?: { label: string; result: string }[];
    warning?: boolean;
  }[];
  /** The deviation from jq 1.8 this case pins, numbered as `devdocs/QUERY.md`
   *  §13 numbers them. */
  deviation?: number;
}

/** The corpus. */
export const QUERY_CORPUS: readonly QueryCorpusCase[] = [
  { name: "alternative-option-default", input: FixtureRoot, program: "[.orders[] | .discount // 0.0]", canonical: "[.orders[] | .discount // 0.0]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "array-collect-ids", input: FixtureRoot, program: "[.orders[] | .id]", canonical: "[.orders[] | .id]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "binary-multiply", input: FixtureRoot, program: "[.orders[] | .total * 2]", canonical: "[.orders[] | .total * 2]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "bind-lookup-table", input: FixtureRoot, program: ".customers as $c | $c[\"C01\"].name", canonical: ".customers as $c | $c[\"C01\"].name", element: OptionType(StringType), multiplicity: "one" },
  { name: "break-first-large-order", input: FixtureRoot, program: "label $found | .orders[] | select(.total > 1000) | ., break $found", canonical: "label $found | .orders[] | select(.total > 1000) | ., break $found", element: Order, multiplicity: "many" },
  { name: "call-length", input: FixtureRoot, program: ".orders | length", canonical: ".orders | length", element: IntegerType, multiplicity: "one" },
  { name: "comma-two-ids", input: FixtureRoot, program: ".orders[0].id, .orders[1].id", canonical: ".orders[0].id, .orders[1].id", element: OptionType(IntegerType), multiplicity: "many" },
  { name: "def-revenue", input: FixtureRoot, program: "def revenue: map(.total) | add; .orders | revenue", canonical: "def revenue: map(.total) | add; .orders | revenue", element: FloatType, multiplicity: "one" },
  { name: "descend-every-sku", input: FixtureRoot, program: "[.bom | .. | .sku?]", canonical: "[.bom | .. | .sku?]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "field-nested", input: FixtureRoot, program: ".forecast.regions", canonical: ".forecast.regions", element: DictType(StringType, StructType({ weekly: ArrayType(FloatType) })), multiplicity: "one" },
  { name: "foreach-running-total", input: FixtureRoot, program: "[foreach .orders[].total as $t (0.0; . + $t)]", canonical: "[foreach .orders[].total as $t (0.0; . + $t)]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "format-base64", input: FixtureRoot, program: ".customers[] | .name | @base64", canonical: ".customers[] | .name | @base64", element: StringType, multiplicity: "many" },
  { name: "identity-root", input: FixtureRoot, program: ".", canonical: ".", element: FixtureRoot, multiplicity: "one" },
  { name: "if-size-band", input: FixtureRoot, program: ".orders[] | if .total > 1000 then \"large\" elif .total > 100 then \"medium\" else \"small\" end", canonical: ".orders[] | if .total > 1000 then \"large\" elif .total > 100 then \"medium\" else \"small\" end", element: StringType, multiplicity: "many" },
  { name: "index-integer-key", input: FixtureRoot, program: ".byId[1035].customer_id", canonical: ".byId[1035].customer_id", element: OptionType(StringType), multiplicity: "one" },
  { name: "iterate-orders", input: FixtureRoot, program: ".orders[]", canonical: ".orders[]", element: Order, multiplicity: "many" },
  { name: "label-without-break", input: FixtureRoot, program: "label $out | .orders | length", canonical: "label $out | .orders | length", element: IntegerType, multiplicity: "one" },
  { name: "literal-integer", input: FixtureRoot, program: "1001", canonical: "1001", element: IntegerType, multiplicity: "one" },
  { name: "negate-total", input: FixtureRoot, program: "[.orders[] | -.total]", canonical: "[.orders[] | -.total]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "object-literal-keys", input: FixtureRoot, program: ".orders[] | {id, total, customer: .customer_id}", canonical: ".orders[] | {id, total, customer: .customer_id}", element: StructType({ id: IntegerType, total: FloatType, customer: StringType }), multiplicity: "many" },
  { name: "pipe-index-field", input: FixtureRoot, program: ".orders[0] | .id", canonical: ".orders[0] | .id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "reduce-sum-totals", input: FixtureRoot, program: "reduce .orders[] as $o (0.0; . + $o.total)", canonical: "reduce .orders[] as $o (0.0; . + $o.total)", element: FloatType, multiplicity: "one" },
  { name: "slice-orders", input: FixtureRoot, program: ".orders[2:5] | map(.id)", canonical: ".orders[2:5] | map(.id)", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "string-interpolate", input: FixtureRoot, program: ".orders[] | \"Order \\(.id) for \\(.customer_id)\"", canonical: ".orders[] | \"Order \\(.id) for \\(.customer_id)\"", element: StringType, multiplicity: "many" },
  { name: "try-catch-error", input: FixtureRoot, program: "try error(\"no such order\") catch .", canonical: "try error(\"no such order\") catch .", element: StringType, multiplicity: "maybe" },
  { name: "update-arithmetic", input: FixtureRoot, program: ".orders | map(.total |= . * 2)", canonical: ".orders | map(.total |= . * 2)", element: ArrayType(Order), multiplicity: "one" },
  { name: "variable-bound-order", input: FixtureRoot, program: ".orders[] as $o | $o.id", canonical: ".orders[] as $o | $o.id", element: IntegerType, multiplicity: "many" },
  // A misspelt field after a character outside the Basic Multilingual Plane:
  // its span counts the emoji as two UTF-16 code units in every front end.
  { name: "span-utf16-after-emoji", input: FixtureRoot, program: "\"🚚 \" + .orders[0].customer", canonical: "\"🚚 \" + .orders[0].customer", diagnostics: [{ code: "unknown_field", span: [18, 9], suggestions: [".customer_id"], fixes: [{ label: "Use .customer_id", result: "\"🚚 \" + .orders[0].customer_id" }] }] },
  // Canonical text: programs written another way, and the one text each
  // prints as (#920, `devdocs/QUERY.md` §18).
  { name: "canonical-layout-and-comments", input: FixtureRoot, program: "  .orders|length   # how many orders", canonical: ".orders | length", element: IntegerType, multiplicity: "one" },
  { name: "canonical-redundant-parentheses", input: FixtureRoot, program: "((.orders[0])).total + (2)", canonical: ".orders[0].total + 2", element: FloatType, multiplicity: "one" },
  { name: "canonical-quoted-field", input: FixtureRoot, program: ".forecast.\"regions\"", canonical: ".forecast.regions", element: DictType(StringType, StructType({ weekly: ArrayType(FloatType) })), multiplicity: "one" },
  { name: "canonical-dot-bracket", input: FixtureRoot, program: ".orders.[0].id", canonical: ".orders[0].id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "canonical-string-escapes", input: FixtureRoot, program: "\"\\u0041\\/b\\u00e9\"", canonical: "\"A/bé\"", element: StringType, multiplicity: "one" },
  { name: "canonical-number-forms", input: FixtureRoot, program: "[1e2, 1.50, 0.5e1]", canonical: "[100.0, 1.5, 5.0]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "canonical-try-postfix", input: FixtureRoot, program: "try first(.orders[])", canonical: "first(.orders[])?", element: Order, multiplicity: "maybe" },
  { name: "canonical-object-keys", input: FixtureRoot, program: "{\"id\": 1001, \"customer id\": \"C01\"}", canonical: "{id: 1001, \"customer id\": \"C01\"}", element: StructType({ id: IntegerType, "customer id": StringType }), multiplicity: "one" },
  // The worked examples of `devdocs/QUERY.md` not covered above.
  { name: "iterate-slice-then-each", input: FixtureRoot, program: ".orders[:3][] | .id", canonical: ".orders[:3][] | .id", element: IntegerType, multiplicity: "many" },
  { name: "call-first-case-name", input: FixtureRoot, program: "first(.orders[]) | .status.type", canonical: "first(.orders[]) | .status.type", element: StringType, multiplicity: "maybe" },
  { name: "field-payload-option-one", input: FixtureRoot, program: ".orders[0].status.value.date", canonical: ".orders[0].status.value.date", element: OptionType(DateTimeType), multiplicity: "one" },
  { name: "slice-option-elements", input: FixtureRoot, program: "[.orders[] | .discount] | .[:3]", canonical: "[.orders[] | .discount] | .[:3]", element: ArrayType(OptionType(FloatType)), multiplicity: "one" },
  { name: "update-new-field-type", input: FixtureRoot, program: "first(.orders[]) | .rush = true", canonical: "first(.orders[]) | .rush = true", element: StructType({ customer_id: StringType, discount: OptionType(FloatType), id: IntegerType, lines: ArrayType(Line), status: Status, total: FloatType, rush: BooleanType }), multiplicity: "maybe" },
  // Paths, indexes and keys (§4): a lookup can miss, so it is an Option; a Dict's keys have its key type.
  { name: "index-not-indexable", input: FixtureRoot, program: ".orders | length | .[0]", canonical: ".orders | length | .[0]", diagnostics: [{ code: "not_indexable", span: [19, 4] }] },
  { name: "index-dict-integer-key", input: FixtureRoot, program: ".byId[1035].total", canonical: ".byId[1035].total", element: OptionType(FloatType), multiplicity: "one" },
  { name: "index-dict-struct-key", input: FixtureRoot, program: ".cells[{region: \"NSW\", week: 1}]", canonical: ".cells[{region: \"NSW\", week: 1}]", element: OptionType(FloatType), multiplicity: "one" },
  { name: "index-dict-missing-key", input: FixtureRoot, program: ".customers[\"C99\"]", canonical: ".customers[\"C99\"]", element: OptionType(Customer), multiplicity: "one" },
  { name: "index-dict-key-type", input: FixtureRoot, program: ".byId[\"1035\"]", canonical: ".byId[\"1035\"]", diagnostics: [{ code: "type_mismatch", span: [6, 6] }], deviation: 2 },
  { name: "index-array-option", input: FixtureRoot, program: ".orders[0].id", canonical: ".orders[0].id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "slice-negative-from", input: FixtureRoot, program: ".orders[-2:] | map(.id)", canonical: ".orders[-2:] | map(.id)", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "slice-bound-not-integer", input: FixtureRoot, program: ".orders[0:\"a\"]", canonical: ".orders[0:\"a\"]", diagnostics: [{ code: "type_mismatch", span: [10, 3] }] },
  { name: "slice-first-three", input: FixtureRoot, program: ".orders | map(.id) | .[:3]", canonical: ".orders | map(.id) | .[:3]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "field-unknown-suggests", input: FixtureRoot, program: ".orders[0].customer", canonical: ".orders[0].customer", diagnostics: [{ code: "unknown_field", span: [10, 9], suggestions: [".customer_id"], fixes: [{ label: "Use .customer_id", result: ".orders[0].customer_id" }] }], deviation: 1 },
  { name: "field-optional-missing", input: FixtureRoot, program: ".orders[0].customer?", canonical: ".orders[0].customer?", element: NullType, multiplicity: "one" },
  { name: "field-unknown-dataset", input: FixtureRoot, program: ".orderz", canonical: ".orderz", root: true, diagnostics: [{ code: "unknown_field", span: [0, 7], suggestions: [".orders"], fixes: [{ label: "Use .orders", result: ".orders" }] }] },
  { name: "field-variant-not-type-or-value", input: FixtureRoot, program: ".orders[] | .status.date", canonical: ".orders[] | .status.date", diagnostics: [{ code: "unknown_field", span: [19, 5], suggestions: [".type",".value"] }] },
  { name: "field-payload-unnarrowed", input: FixtureRoot, program: ".orders[] | .status.value.date", canonical: ".orders[] | .status.value.date", element: OptionType(DateTimeType), multiplicity: "many" },
  { name: "field-payload-narrowed", input: FixtureRoot, program: ".orders[] | select(.status.type == \"shipped\") | .status.value.date", canonical: ".orders[] | select(.status.type == \"shipped\") | .status.value.date", element: DateTimeType, multiplicity: "many" },
  { name: "field-payload-no-case-has-it", input: FixtureRoot, program: ".orders[] | .status.value.when", canonical: ".orders[] | .status.value.when", diagnostics: [{ code: "unknown_field", span: [25, 5] }] },
  { name: "field-on-number", input: FixtureRoot, program: ".orders | length | .x", canonical: ".orders | length | .x", diagnostics: [{ code: "type_mismatch", span: [19, 2] }] },
  { name: "iterate-option-needs-skip", input: FixtureRoot, program: ".orders[0].lines[]", canonical: ".orders[0].lines[]", diagnostics: [{ code: "not_iterable", span: [0, 18], fixes: [{ label: "Use .orders[0].lines[]?", result: ".orders[0].lines[]?" }] }] },
  { name: "iterate-not-iterable", input: FixtureRoot, program: ".orders[] | .total[]", canonical: ".orders[] | .total[]", diagnostics: [{ code: "not_iterable", span: [12, 8] }] },
  { name: "iterate-struct-values", input: FixtureRoot, program: ".forecast[] | keys", canonical: ".forecast[] | keys", element: ArrayType(StringType), multiplicity: "many" },
  { name: "iterate-root-refused", input: FixtureRoot, program: ".[]", canonical: ".[]", root: true, diagnostics: [{ code: "unsupported", span: [0, 3] }] },
  // e3 roots (§17): whole-root reads are refused, `keys` and `has` answered from the type, `reads` recorded.
  { name: "identity-root-refused", input: FixtureRoot, program: ".", canonical: ".", root: true, diagnostics: [{ code: "unsupported", span: [0, 1] }] },
  { name: "descend-root-refused", input: FixtureRoot, program: "..", canonical: "..", root: true, diagnostics: [{ code: "unsupported", span: [0, 2] }] },
  { name: "pipe-root-reads", input: FixtureRoot, program: ".customers as $customers | .orders | map($customers[.customer_id].name)", canonical: ".customers as $customers | .orders | map($customers[.customer_id].name)", root: true, element: ArrayType(OptionType(StringType)), multiplicity: "one" },
  { name: "call-keys-root-folds", input: FixtureRoot, program: "keys", canonical: "keys", root: true, element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-keys-unsorted-root-folds", input: FixtureRoot, program: "keys_unsorted", canonical: "keys_unsorted", root: true, element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-has-root-folds", input: FixtureRoot, program: "has(\"orders\")", canonical: "has(\"orders\")", root: true, element: BooleanType, multiplicity: "one" },
  { name: "call-to-entries-root-refused", input: FixtureRoot, program: "to_entries", canonical: "to_entries", root: true, diagnostics: [{ code: "unsupported", span: [0, 10] }] },
  // Outputs share one element type (§3), and construction infers types (§5).
  { name: "comma-mixed-suggests-object", input: FixtureRoot, program: "first(.orders[]) | .id, .customer_id", canonical: "first(.orders[]) | .id, .customer_id", diagnostics: [{ code: "ambiguous_output", span: [19, 17], suggestions: ["{id, customer_id}"], fixes: [{ label: "Use {id, customer_id}", result: "first(.orders[]) | {id, customer_id}" }] }], deviation: 5 },
  { name: "comma-integer-float-unify", input: FixtureRoot, program: "first(.orders[]) | .id, .total", canonical: "first(.orders[]) | .id, .total", element: FloatType, multiplicity: "many" },
  { name: "comma-null-unifies-option", input: FixtureRoot, program: "first(.orders[]) | .id, null", canonical: "first(.orders[]) | .id, null", element: OptionType(IntegerType), multiplicity: "many" },
  { name: "array-mixed-types", input: FixtureRoot, program: "[1, \"a\"]", canonical: "[1, \"a\"]", diagnostics: [{ code: "ambiguous_output", span: [0, 8] }] },
  { name: "array-empty", input: FixtureRoot, program: "[]", canonical: "[]", element: ArrayType(NeverType), multiplicity: "one" },
  { name: "object-mixed-keys", input: FixtureRoot, program: "{(.orders[0].customer_id): 1, b: 2}", canonical: "{(.orders[0].customer_id): 1, b: 2}", diagnostics: [{ code: "type_mismatch", span: [0, 35] }] },
  { name: "object-duplicate-key", input: FixtureRoot, program: "{a: 1, a: 2}", canonical: "{a: 1, a: 2}", element: StructType({ a: IntegerType }), multiplicity: "one", diagnostics: [{ code: "duplicate_key", span: [0, 12], warning: true }] },
  { name: "object-computed-keys-dict", input: FixtureRoot, program: "first(.orders[]) | {(.customer_id): .total}", canonical: "first(.orders[]) | {(.customer_id): .total}", element: DictType(StringType, FloatType), multiplicity: "maybe", deviation: 6 },
  { name: "object-literal-merge", input: FixtureRoot, program: "first(.orders[]) | {id} + {total}", canonical: "first(.orders[]) | {id} + {total}", element: StructType({ id: IntegerType, total: FloatType }), multiplicity: "maybe" },
  { name: "object-deep-merge", input: FixtureRoot, program: "{a: {b: 1}} * {a: {c: \"x\"}}", canonical: "{a: {b: 1}} * {a: {c: \"x\"}}", element: StructType({ a: StructType({ b: IntegerType, c: StringType }) }), multiplicity: "one" },
  { name: "object-variable-key", input: FixtureRoot, program: ".orders[0] | .id as $x | {$x}", canonical: ".orders[0] | .id as $x | {$x}", element: StructType({ x: OptionType(IntegerType) }), multiplicity: "one" },
  { name: "string-interpolate-any", input: FixtureRoot, program: "\"\\(.orders | length) orders\"", canonical: "\"\\(.orders | length) orders\"", element: StringType, multiplicity: "one" },
  // Operators and numbers (§6), DateTime literals (§7), and case tests that narrow (§8).
  { name: "binary-integer-stays-integer", input: FixtureRoot, program: ".orders[0].lines[0].qty? // 0 | . * 3 + 1", canonical: ".orders[0].lines[0].qty? // 0 | . * 3 + 1", element: IntegerType, multiplicity: "one", deviation: 3 },
  { name: "binary-divide-float", input: FixtureRoot, program: "5 / 2", canonical: "5 / 2", element: FloatType, multiplicity: "one", deviation: 3 },
  { name: "binary-null-identity-add", input: FixtureRoot, program: ".orders[0].id + 1", canonical: ".orders[0].id + 1", element: IntegerType, multiplicity: "one" },
  { name: "binary-compare-mismatch", input: FixtureRoot, program: ".orders[0].id == \"1001\"", canonical: ".orders[0].id == \"1001\"", diagnostics: [{ code: "type_mismatch", span: [0, 23] }] },
  { name: "binary-integer-never-equals-fraction", input: FixtureRoot, program: ".orders[] | select(.id == 1001.5)", canonical: ".orders[] | select(.id == 1001.5)", diagnostics: [{ code: "type_mismatch", span: [19, 13] }] },
  { name: "binary-literal-takes-float", input: FixtureRoot, program: "[.orders[] | select(.total > 1000)] | length", canonical: "[.orders[] | select(.total > 1000)] | length", element: IntegerType, multiplicity: "one" },
  { name: "binary-datetime-iso-literal", input: FixtureRoot, program: "[.orders[] | select(.status.type == \"shipped\") | select(.status.value.date >= \"2026-01-01\")] | length", canonical: "[.orders[] | select(.status.type == \"shipped\") | select(.status.value.date >= \"2026-01-01\")] | length", element: IntegerType, multiplicity: "one", deviation: 4 },
  { name: "binary-datetime-bad-iso", input: FixtureRoot, program: "[.orders[] | select(.status.type == \"shipped\") | select(.status.value.date >= \"2026-13-01\")]", canonical: "[.orders[] | select(.status.type == \"shipped\") | select(.status.value.date >= \"2026-13-01\")]", diagnostics: [{ code: "type_mismatch", span: [78, 12] }] },
  { name: "binary-whole-variant-compare", input: FixtureRoot, program: ".orders[] | select(.status == \"shipped\")", canonical: ".orders[] | select(.status == \"shipped\")", diagnostics: [{ code: "type_mismatch", span: [19, 7], fixes: [{ label: "Use .type", result: ".orders[] | select(.status.type == \"shipped\")" }] }] },
  { name: "binary-case-unknown-suggests", input: FixtureRoot, program: ".orders[] | select(.status.type == \"shiped\")", canonical: ".orders[] | select(.status.type == \"shiped\")", diagnostics: [{ code: "unknown_case", span: [35, 8], suggestions: ["\"shipped\""], fixes: [{ label: "Use \"shipped\"", result: ".orders[] | select(.status.type == \"shipped\")" }] }] },
  { name: "binary-case-narrows-and", input: FixtureRoot, program: ".orders[] | select(.status.type == \"shipped\" and .status.value.date > \"2026-06-01\") | .id", canonical: ".orders[] | select(.status.type == \"shipped\" and .status.value.date > \"2026-06-01\") | .id", element: IntegerType, multiplicity: "many" },
  { name: "binary-arithmetic-mismatch", input: FixtureRoot, program: ".orders[0].customer_id - 1", canonical: ".orders[0].customer_id - 1", diagnostics: [{ code: "type_mismatch", span: [0, 26] }] },
  { name: "binary-string-repeat", input: FixtureRoot, program: "\"ab\" * 2", canonical: "\"ab\" * 2", element: OptionType(StringType), multiplicity: "one" },
  { name: "binary-string-split", input: FixtureRoot, program: "\"a,b\" / \",\"", canonical: "\"a,b\" / \",\"", element: ArrayType(StringType), multiplicity: "one" },
  { name: "binary-array-difference", input: FixtureRoot, program: "[1, 2, 3] - [2]", canonical: "[1, 2, 3] - [2]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "negate-string", input: FixtureRoot, program: "-\"a\"", canonical: "-\"a\"", diagnostics: [{ code: "type_mismatch", span: [0, 4] }] },
  { name: "if-narrows-branch", input: FixtureRoot, program: "[.orders[] | if .status.type == \"cancelled\" then .status.value.reason else \"\" end]", canonical: "[.orders[] | if .status.type == \"cancelled\" then .status.value.reason else \"\" end]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "if-else-narrows-rest", input: FixtureRoot, program: "[.orders[] | if .status.type == \"pending\" then \"waiting\" elif .status.type == \"cancelled\" then .status.value.reason else (.status.value.date | todate) end]", canonical: "[.orders[] | if .status.type == \"pending\" then \"waiting\" elif .status.type == \"cancelled\" then .status.value.reason else .status.value.date | todate end]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "try-lenient-type-error", input: FixtureRoot, program: "[.orders[] | try (.customer_id | tonumber) catch -1.0]", canonical: "[.orders[] | try (.customer_id | tonumber) catch -1.0]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "field-payload-optional", input: FixtureRoot, program: "[.orders[] | .status.value.reason?]", canonical: "[.orders[] | .status.value.reason?]", element: ArrayType(OptionType(StringType)), multiplicity: "one" },
  { name: "alternative-option-to-value", input: FixtureRoot, program: "first(.orders[] | select(.id == 1002)) | .discount // 0.0", canonical: "first(.orders[] | select(.id == 1002)) | .discount // 0.0", element: FloatType, multiplicity: "maybe" },
  { name: "if-type-narrows", input: FixtureRoot, program: "first(.orders[]) | [.[] | if type == \"number\" then . * 2 else 0 end]", canonical: "first(.orders[]) | [.[] | if type == \"number\" then . * 2 else 0 end]", element: ArrayType(FloatType), multiplicity: "maybe" },
  // Inference by fixpoint (§5), bindings, labels and variables.
  { name: "reduce-dict-accumulator", input: FixtureRoot, program: "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total) | .[\"C04\"]", canonical: "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total) | .[\"C04\"]", element: OptionType(FloatType), multiplicity: "one" },
  { name: "reduce-null-start", input: FixtureRoot, program: "reduce .orders[] as $o (null; . + $o.total)", canonical: "reduce .orders[] as $o (null; . + $o.total)", element: OptionType(FloatType), multiplicity: "one" },
  { name: "reduce-accumulator-changes-type", input: FixtureRoot, program: "reduce .orders[] as $o (0; [.])", canonical: "reduce .orders[] as $o (0; [.])", diagnostics: [{ code: "cannot_infer", span: [0, 31] }] },
  { name: "foreach-extract", input: FixtureRoot, program: "[foreach .orders[] as $o (0; . + 1; [., $o.id])]", canonical: "[foreach .orders[] as $o (0; . + 1; [., $o.id])]", element: ArrayType(ArrayType(IntegerType)), multiplicity: "one" },
  { name: "bind-destructure-object", input: FixtureRoot, program: "[.orders[] as {id: $i, total: $t} | {$i, $t}]", canonical: "[.orders[] as {id: $i, total: $t} | {$i, $t}]", element: ArrayType(StructType({ i: IntegerType, t: FloatType })), multiplicity: "one" },
  { name: "bind-alternatives", input: FixtureRoot, program: "[.orders[] | . as [$a] ?// $a | $a.id]", canonical: "[.orders[] | . as [$a] ?// $a | $a.id]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "def-filter-parameter", input: FixtureRoot, program: "def f(g): [.[] | g]; .orders | f(.id)", canonical: "def f(g): [.[] | g]; .orders | f(.id)", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "def-value-parameter", input: FixtureRoot, program: "def add_n($n): . + $n; 1 | add_n(2)", canonical: "def add_n($n): . + $n; 1 | add_n(2)", element: IntegerType, multiplicity: "one" },
  { name: "def-recursive-value", input: FixtureRoot, program: "def fact: if . <= 1 then 1 else . * (. - 1 | fact) end; 5 | fact", canonical: "def fact: if . <= 1 then 1 else . * (. - 1 | fact) end; 5 | fact", element: IntegerType, multiplicity: "one" },
  { name: "def-recursive-filter-parameter", input: FixtureRoot, program: "def walkdown(f): f, (.children[] | walkdown(f)); [.bom | walkdown(.sku)]", canonical: "def walkdown(f): f, (.children[] | walkdown(f)); [.bom | walkdown(.sku)]", diagnostics: [{ code: "unsupported", span: [35, 11] }], deviation: 13 },
  { name: "label-break-first", input: FixtureRoot, program: "label $found | .orders[] | select(.total > 1000) | .id, break $found", canonical: "label $found | .orders[] | select(.total > 1000) | .id, break $found", element: IntegerType, multiplicity: "many" },
  { name: "break-unknown-label", input: FixtureRoot, program: "break $nope", canonical: "break $nope", diagnostics: [{ code: "unknown_function", span: [0, 11] }] },
  { name: "variable-unbound", input: FixtureRoot, program: "$nope", canonical: "$nope", diagnostics: [{ code: "unknown_function", span: [0, 5] }] },
  { name: "variable-env-excluded", input: FixtureRoot, program: "$ENV", canonical: "$ENV", diagnostics: [{ code: "unsupported", span: [0, 4] }], deviation: 7 },
  { name: "variable-loc", input: FixtureRoot, program: "$__loc__ | .line", canonical: "$__loc__ | .line", element: IntegerType, multiplicity: "one" },
  // Assignment (§4, §5).
  { name: "update-add-field", input: FixtureRoot, program: "first(.orders[]) | .rush = true | .rush", canonical: "first(.orders[]) | .rush = true | .rush", element: BooleanType, multiplicity: "maybe" },
  { name: "update-arithmetic-field", input: FixtureRoot, program: "first(.orders[]) | .total += 1 | .total", canonical: "first(.orders[]) | .total += 1 | .total", element: FloatType, multiplicity: "maybe" },
  { name: "update-each-element", input: FixtureRoot, program: ".orders | .[] |= .id", canonical: ".orders | .[] |= .id", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "update-alternative-never-missing", input: FixtureRoot, program: ".orders | map(.total //= 0.0)", canonical: ".orders | map(.total //= 0.0)", element: ArrayType(Order), multiplicity: "one", diagnostics: [{ code: "never_missing", span: [14, 6], warning: true }] },
  { name: "update-alternative-option", input: FixtureRoot, program: ".orders | map(.discount //= 0.0) | map(.discount)", canonical: ".orders | map(.discount //= 0.0) | map(.discount)", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "update-case-replace", input: FixtureRoot, program: ".orders | map(.status |= .type) | .[0].status", canonical: ".orders | map(.status |= .type) | .[0].status", element: OptionType(StringType), multiplicity: "one" },
  // Formats (§10).
  { name: "format-html", input: FixtureRoot, program: "\"<a>\" | @html", canonical: "\"<a>\" | @html", element: StringType, multiplicity: "one" },
  { name: "format-uri", input: FixtureRoot, program: "\"a b\" | @uri", canonical: "\"a b\" | @uri", element: StringType, multiplicity: "one" },
  { name: "format-json", input: FixtureRoot, program: ".orders[0] | @json", canonical: ".orders[0] | @json", element: StringType, multiplicity: "one" },
  { name: "format-csv", input: FixtureRoot, program: "[.orders[] | [.id, .total] | @csv]", canonical: "[.orders[] | [.id, .total] | @csv]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "format-tsv", input: FixtureRoot, program: ".orders | map([.customer_id, .status.type] | @tsv)", canonical: ".orders | map([.customer_id, .status.type] | @tsv)", element: ArrayType(StringType), multiplicity: "one" },
  { name: "format-sh", input: FixtureRoot, program: "\"it's\" | @sh", canonical: "\"it's\" | @sh", element: StringType, multiplicity: "one" },
  { name: "format-base32", input: FixtureRoot, program: "\"hi\" | @base32", canonical: "\"hi\" | @base32", element: StringType, multiplicity: "one" },
  { name: "format-text-string", input: FixtureRoot, program: ".orders[0].id | @text \"id: \\(.)\"", canonical: ".orders[0].id | @text \"id: \\(.)\"", element: StringType, multiplicity: "one" },
  { name: "format-base64d-unavailable", input: FixtureRoot, program: "\"aGk=\" | @base64d", canonical: "\"aGk=\" | @base64d", diagnostics: [{ code: "unsupported", span: [9, 8] }], deviation: 17 },
  { name: "format-csv-not-array", input: FixtureRoot, program: "\"x\" | @csv", canonical: "\"x\" | @csv", diagnostics: [{ code: "type_mismatch", span: [6, 4] }] },
  // Every builtin of the catalog (§10): its typing, and the diagnostics it gives.
  { name: "call-unknown-suggests", input: FixtureRoot, program: ".orders | lenght", canonical: ".orders | lenght", diagnostics: [{ code: "unknown_function", span: [10, 6], suggestions: ["length"] }] },
  { name: "call-unknown-function", input: FixtureRoot, program: "nosuch(1)", canonical: "nosuch(1)", diagnostics: [{ code: "unknown_function", span: [0, 9] }] },
  { name: "call-arity", input: FixtureRoot, program: ".orders | map", canonical: ".orders | map", diagnostics: [{ code: "arity", span: [10, 3] }] },
  { name: "call-empty", input: FixtureRoot, program: ".orders | map(.id) | empty", canonical: ".orders | map(.id) | empty", element: NeverType, multiplicity: "maybe" },
  { name: "call-error-message-any-type", input: FixtureRoot, program: "try error({code: 1}) catch .", canonical: "try error({code: 1}) catch .", element: StringType, multiplicity: "maybe", deviation: 14 },
  { name: "call-not", input: FixtureRoot, program: ".orders | map(.total > 100 | not)", canonical: ".orders | map(.total > 100 | not)", element: ArrayType(BooleanType), multiplicity: "one" },
  { name: "call-select-duplicate-outputs", input: FixtureRoot, program: "[.orders[] | select(.lines[].sku == \"BRK-100\")] | length", canonical: "[.orders[] | select(.lines[].sku == \"BRK-100\")] | length", element: IntegerType, multiplicity: "one", diagnostics: [{ code: "duplicate_outputs", span: [13, 33], fixes: [{ label: "Use any(.lines[]; …)", result: "[.orders[] | select(any(.lines[]; .sku == \"BRK-100\"))] | length" }], warning: true }] },
  { name: "call-select-pipe-duplicate-outputs", input: FixtureRoot, program: "[.orders[] | select(.lines[] | .qty > 100)] | length", canonical: "[.orders[] | select(.lines[] | .qty > 100)] | length", element: IntegerType, multiplicity: "one", diagnostics: [{ code: "duplicate_outputs", span: [13, 29], fixes: [{ label: "Use any(.lines[]; …)", result: "[.orders[] | select(any(.lines[]; .qty > 100))] | length" }], warning: true }] },
  { name: "call-first-of-array", input: FixtureRoot, program: ".orders | first | .id", canonical: ".orders | first | .id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-first-of-stream", input: FixtureRoot, program: "first(.orders[] | select(.total > 1000)) | .id", canonical: "first(.orders[] | select(.total > 1000)) | .id", element: IntegerType, multiplicity: "maybe" },
  { name: "call-last-of-array", input: FixtureRoot, program: ".orders | last | .id", canonical: ".orders | last | .id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-last-of-stream", input: FixtureRoot, program: "last(.orders[] | .id)", canonical: "last(.orders[] | .id)", element: IntegerType, multiplicity: "maybe" },
  { name: "call-nth-of-array", input: FixtureRoot, program: ".orders | nth(2) | .id", canonical: ".orders | nth(2) | .id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-nth-of-stream", input: FixtureRoot, program: "nth(2; .orders[] | .id)", canonical: "nth(2; .orders[] | .id)", element: IntegerType, multiplicity: "maybe" },
  { name: "call-limit", input: FixtureRoot, program: "[limit(3; .orders[] | .id)]", canonical: "[limit(3; .orders[] | .id)]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-skip", input: FixtureRoot, program: "[skip(38; .orders[] | .id)]", canonical: "[skip(38; .orders[] | .id)]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-isempty", input: FixtureRoot, program: "isempty(.orders[] | select(.total > 100000))", canonical: "isempty(.orders[] | select(.total > 100000))", element: BooleanType, multiplicity: "one" },
  { name: "call-range-one", input: FixtureRoot, program: "[range(3)]", canonical: "[range(3)]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-range-step", input: FixtureRoot, program: "[range(1; 10; 3)]", canonical: "[range(1; 10; 3)]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-range-float", input: FixtureRoot, program: "[range(10.0; 12.25; 0.5)]", canonical: "[range(10.0; 12.25; 0.5)]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "call-range-empty", input: FixtureRoot, program: "[range(5; 1)]", canonical: "[range(5; 1)]", diagnostics: [{ code: "type_mismatch", span: [1, 11] }] },
  { name: "call-range-long", input: FixtureRoot, program: "[range(100000)] | length", canonical: "[range(100000)] | length", element: IntegerType, multiplicity: "one", diagnostics: [{ code: "long_range", span: [1, 13], warning: true }] },
  { name: "call-recurse-children", input: FixtureRoot, program: "[.bom | recurse(.children[]) | .sku]", canonical: "[.bom | recurse(.children[]) | .sku]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-recurse-condition", input: FixtureRoot, program: "[.bom | recurse(.children[]; .cost > 10) | .sku]", canonical: "[.bom | recurse(.children[]; .cost > 10) | .sku]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-recurse-all", input: FixtureRoot, program: "[.bom | recurse | .sku?]", canonical: "[.bom | recurse | .sku?]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-until", input: FixtureRoot, program: "1 | until(. > 100; . * 2)", canonical: "1 | until(. > 100; . * 2)", element: IntegerType, multiplicity: "one" },
  { name: "call-while", input: FixtureRoot, program: "[1 | while(. < 100; . * 2)]", canonical: "[1 | while(. < 100; . * 2)]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-repeat", input: FixtureRoot, program: "[limit(5; 1 | repeat(. * 2))]", canonical: "[limit(5; 1 | repeat(. * 2))]", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-combinations", input: FixtureRoot, program: "[[1, 2], [3, 4]] | [combinations]", canonical: "[[1, 2], [3, 4]] | [combinations]", element: ArrayType(ArrayType(IntegerType)), multiplicity: "one" },
  { name: "call-combinations-n", input: FixtureRoot, program: "[[1, 2] | combinations(2)]", canonical: "[[1, 2] | combinations(2)]", element: ArrayType(ArrayType(IntegerType)), multiplicity: "one" },
  { name: "call-walk", input: FixtureRoot, program: ".forecast | walk(if type == \"number\" then . * 2 else . end)", canonical: ".forecast | walk(if type == \"number\" then . * 2 else . end)", element: Forecast, multiplicity: "one" },
  { name: "call-in-stream", input: FixtureRoot, program: ".orders[0].id | IN(1001, 1002)", canonical: ".orders[0].id | IN(1001, 1002)", element: BooleanType, multiplicity: "one" },
  { name: "call-in-source", input: FixtureRoot, program: "IN(.orders[].id; 1001)", canonical: "IN(.orders[].id; 1001)", element: BooleanType, multiplicity: "one" },
  { name: "call-index-by", input: FixtureRoot, program: ".orders | INDEX(.id) | .[1035] | .customer_id", canonical: ".orders | INDEX(.id) | .[1035] | .customer_id", element: OptionType(StringType), multiplicity: "one" },
  { name: "call-index-source", input: FixtureRoot, program: "INDEX(.orders[]; .customer_id) | keys", canonical: "INDEX(.orders[]; .customer_id) | keys", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-join-unavailable", input: FixtureRoot, program: ".orders | JOIN(.customers; .customer_id)", canonical: ".orders | JOIN(.customers; .customer_id)", diagnostics: [{ code: "unsupported", span: [10, 30] }], deviation: 17 },
  { name: "call-getpath-unavailable", input: FixtureRoot, program: "getpath([\"orders\", 0])", canonical: "getpath([\"orders\", 0])", diagnostics: [{ code: "unsupported", span: [0, 22] }], deviation: 17 },
  { name: "call-paths-unavailable", input: FixtureRoot, program: "[paths]", canonical: "[paths]", diagnostics: [{ code: "unsupported", span: [1, 5] }], deviation: 17 },
  { name: "call-del-field", input: FixtureRoot, program: "first(.orders[]) | del(.lines) | keys", canonical: "first(.orders[]) | del(.lines) | keys", element: ArrayType(StringType), multiplicity: "maybe" },
  { name: "call-del-index", input: FixtureRoot, program: ".orders | del(.[0]) | length", canonical: ".orders | del(.[0]) | length", element: IntegerType, multiplicity: "one" },
  { name: "call-del-select", input: FixtureRoot, program: ".orders | del(.[] | select(.total < 100)) | length", canonical: ".orders | del(.[] | select(.total < 100)) | length", element: IntegerType, multiplicity: "one" },
  { name: "call-del-each-field", input: FixtureRoot, program: ".orders | del(.[].lines) | map(keys) | .[0]", canonical: ".orders | del(.[].lines) | map(keys) | .[0]", element: OptionType(ArrayType(StringType)), multiplicity: "one" },
  { name: "call-del-mixed", input: FixtureRoot, program: ".orders | del(.[0].lines)", canonical: ".orders | del(.[0].lines)", diagnostics: [{ code: "ambiguous_output", span: [14, 10] }] },
  { name: "call-to-entries-dict", input: FixtureRoot, program: ".cells | to_entries | .[0]", canonical: ".cells | to_entries | .[0]", element: OptionType(StructType({ key: Cell, value: FloatType })), multiplicity: "one" },
  { name: "call-to-entries-struct", input: FixtureRoot, program: "{a: 1, b: 2.5} | to_entries", canonical: "{a: 1, b: 2.5} | to_entries", element: ArrayType(StructType({ key: StringType, value: FloatType })), multiplicity: "one" },
  { name: "call-from-entries", input: FixtureRoot, program: "[{key: \"a\", value: 1}, {key: \"b\", value: 2}] | from_entries", canonical: "[{key: \"a\", value: 1}, {key: \"b\", value: 2}] | from_entries", element: DictType(StringType, IntegerType), multiplicity: "one" },
  { name: "call-with-entries", input: FixtureRoot, program: ".forecast.regions | with_entries(.value |= (.weekly | add))", canonical: ".forecast.regions | with_entries(.value |= (.weekly | add))", element: DictType(StringType, FloatType), multiplicity: "one" },
  { name: "call-pick", input: FixtureRoot, program: "first(.orders[]) | pick(.id)", canonical: "first(.orders[]) | pick(.id)", element: StructType({ id: IntegerType }), multiplicity: "maybe" },
  { name: "call-transpose", input: FixtureRoot, program: "[[1, 2], [3]] | transpose", canonical: "[[1, 2], [3]] | transpose", element: ArrayType(ArrayType(OptionType(IntegerType))), multiplicity: "one" },
  { name: "call-length-array", input: FixtureRoot, program: ".orders | length", canonical: ".orders | length", element: IntegerType, multiplicity: "one" },
  { name: "call-length-dict", input: FixtureRoot, program: ".customers | length", canonical: ".customers | length", element: IntegerType, multiplicity: "one" },
  { name: "call-length-number", input: FixtureRoot, program: "-3.5 | length", canonical: "-3.5 | length", element: FloatType, multiplicity: "one" },
  { name: "call-utf8bytelength", input: FixtureRoot, program: "\"héllo\" | utf8bytelength", canonical: "\"héllo\" | utf8bytelength", element: IntegerType, multiplicity: "one" },
  { name: "call-keys-dict", input: FixtureRoot, program: ".customers | keys", canonical: ".customers | keys", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-keys-struct", input: FixtureRoot, program: "first(.orders[]) | keys", canonical: "first(.orders[]) | keys", element: ArrayType(StringType), multiplicity: "maybe" },
  { name: "call-keys-unsorted-struct", input: FixtureRoot, program: "first(.orders[]) | keys_unsorted", canonical: "first(.orders[]) | keys_unsorted", element: ArrayType(StringType), multiplicity: "maybe", deviation: 12 },
  { name: "call-has-struct", input: FixtureRoot, program: "first(.orders[]) | has(\"total\")", canonical: "first(.orders[]) | has(\"total\")", element: BooleanType, multiplicity: "maybe" },
  { name: "call-has-dict-key-type", input: FixtureRoot, program: ".customers | has(1)", canonical: ".customers | has(1)", diagnostics: [{ code: "type_mismatch", span: [17, 1] }] },
  { name: "call-has-array", input: FixtureRoot, program: ".orders | has(3)", canonical: ".orders | has(3)", element: BooleanType, multiplicity: "one" },
  { name: "call-in", input: FixtureRoot, program: "\"C01\" | in({C01: 1})", canonical: "\"C01\" | in({C01: 1})", element: BooleanType, multiplicity: "one" },
  { name: "call-map", input: FixtureRoot, program: ".orders | map(.total)", canonical: ".orders | map(.total)", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "call-map-values-dict", input: FixtureRoot, program: ".customers | map_values(.name)", canonical: ".customers | map_values(.name)", element: DictType(StringType, StringType), multiplicity: "one" },
  { name: "call-add", input: FixtureRoot, program: "def revenue: map(.total) | add; .orders | revenue", canonical: "def revenue: map(.total) | add; .orders | revenue", element: FloatType, multiplicity: "one" },
  { name: "call-add-strings", input: FixtureRoot, program: ".orders | map(.customer_id) | add", canonical: ".orders | map(.customer_id) | add", element: StringType, multiplicity: "one" },
  { name: "call-add-empty-identity", input: FixtureRoot, program: ".orders | map(select(.total < 0) | .total) | add", canonical: ".orders | map(select(.total < 0) | .total) | add", element: FloatType, multiplicity: "one", deviation: 15 },
  { name: "call-add-nothing", input: FixtureRoot, program: "[] | add", canonical: "[] | add", element: NullType, multiplicity: "one" },
  { name: "call-add-generator", input: FixtureRoot, program: ".orders | add(.[].total)", canonical: ".orders | add(.[].total)", element: FloatType, multiplicity: "one" },
  { name: "call-any", input: FixtureRoot, program: ".orders | map(.total > 1000) | any", canonical: ".orders | map(.total > 1000) | any", element: BooleanType, multiplicity: "one" },
  { name: "call-any-condition", input: FixtureRoot, program: ".orders | any(.total > 1000)", canonical: ".orders | any(.total > 1000)", element: BooleanType, multiplicity: "one" },
  { name: "call-any-generator", input: FixtureRoot, program: "any(.orders[]; .total > 1000)", canonical: "any(.orders[]; .total > 1000)", element: BooleanType, multiplicity: "one" },
  { name: "call-all", input: FixtureRoot, program: ".orders | all(.lines | length > 0)", canonical: ".orders | all(.lines | length > 0)", element: BooleanType, multiplicity: "one" },
  { name: "call-flatten", input: FixtureRoot, program: "[[1, 2], [3]] | flatten", canonical: "[[1, 2], [3]] | flatten", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-flatten-depth", input: FixtureRoot, program: "[[[1]], [[2]]] | flatten(1)", canonical: "[[[1]], [[2]]] | flatten(1)", element: ArrayType(ArrayType(IntegerType)), multiplicity: "one" },
  { name: "call-sort", input: FixtureRoot, program: ".orders | map(.total) | sort | .[0]", canonical: ".orders | map(.total) | sort | .[0]", element: OptionType(FloatType), multiplicity: "one", deviation: 10 },
  { name: "call-sort-by", input: FixtureRoot, program: ".orders | sort_by(.total) | .[0].id", canonical: ".orders | sort_by(.total) | .[0].id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-sort-by-on-element", input: FixtureRoot, program: ".orders[] | sort_by(.total)", canonical: ".orders[] | sort_by(.total)", diagnostics: [{ code: "array_builtin_on_element", span: [12, 15], fixes: [{ label: "Collect .orders[] first", result: "[.orders[]] | sort_by(.total)" }] }] },
  { name: "call-group-by", input: FixtureRoot, program: ".orders | group_by(.customer_id) | map(length)", canonical: ".orders | group_by(.customer_id) | map(length)", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-unique", input: FixtureRoot, program: ".orders | map(.customer_id) | unique", canonical: ".orders | map(.customer_id) | unique", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-unique-by", input: FixtureRoot, program: ".orders | unique_by(.customer_id) | length", canonical: ".orders | unique_by(.customer_id) | length", element: IntegerType, multiplicity: "one" },
  { name: "call-min", input: FixtureRoot, program: ".orders | map(.total) | min", canonical: ".orders | map(.total) | min", element: OptionType(FloatType), multiplicity: "one" },
  { name: "call-max", input: FixtureRoot, program: ".orders | map(.total) | max", canonical: ".orders | map(.total) | max", element: OptionType(FloatType), multiplicity: "one" },
  { name: "call-min-by", input: FixtureRoot, program: ".orders | min_by(.total) | .id", canonical: ".orders | min_by(.total) | .id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-max-by", input: FixtureRoot, program: ".orders | max_by(.total) | .id", canonical: ".orders | max_by(.total) | .id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-reverse-array", input: FixtureRoot, program: ".orders | reverse | .[0].id", canonical: ".orders | reverse | .[0].id", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-reverse-string", input: FixtureRoot, program: "\"abc\" | reverse", canonical: "\"abc\" | reverse", element: StringType, multiplicity: "one" },
  { name: "call-contains-string", input: FixtureRoot, program: "[.orders[] | select(.customer_id | contains(\"C0\"))] | length", canonical: "[.orders[] | select(.customer_id | contains(\"C0\"))] | length", element: IntegerType, multiplicity: "one" },
  { name: "call-contains-array", input: FixtureRoot, program: "[\"a\", \"b\"] | contains([\"a\"])", canonical: "[\"a\", \"b\"] | contains([\"a\"])", element: BooleanType, multiplicity: "one" },
  { name: "call-inside", input: FixtureRoot, program: "\"C0\" | inside(\"C01\")", canonical: "\"C0\" | inside(\"C01\")", element: BooleanType, multiplicity: "one" },
  { name: "call-index-string", input: FixtureRoot, program: "\"a,b\" | index(\",\")", canonical: "\"a,b\" | index(\",\")", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-rindex", input: FixtureRoot, program: "\"a,b,c\" | rindex(\",\")", canonical: "\"a,b,c\" | rindex(\",\")", element: OptionType(IntegerType), multiplicity: "one" },
  { name: "call-indices", input: FixtureRoot, program: "\"a,b,a\" | indices(\"a\")", canonical: "\"a,b,a\" | indices(\"a\")", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-bsearch", input: FixtureRoot, program: "[1, 2, 3] | bsearch(2)", canonical: "[1, 2, 3] | bsearch(2)", element: IntegerType, multiplicity: "one" },
  { name: "call-join", input: FixtureRoot, program: ".orders | map(.customer_id) | join(\", \")", canonical: ".orders | map(.customer_id) | join(\", \")", element: StringType, multiplicity: "one" },
  { name: "call-type", input: FixtureRoot, program: "first(.orders[]) | [(.id | type), (.status | type), (.discount | type)]", canonical: "first(.orders[]) | [(.id | type), (.status | type), (.discount | type)]", element: ArrayType(StringType), multiplicity: "maybe" },
  { name: "call-type-of-each", input: FixtureRoot, program: "first(.orders[]) | .[] | type", canonical: "first(.orders[]) | .[] | type", element: StringType, multiplicity: "many" },
  { name: "call-arrays", input: FixtureRoot, program: "[first(.orders[]) | .[] | arrays] | length", canonical: "[first(.orders[]) | .[] | arrays] | length", element: IntegerType, multiplicity: "one" },
  { name: "call-objects", input: FixtureRoot, program: "[.bom | .. | objects | .sku]", canonical: "[.bom | .. | objects | .sku]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-iterables", input: FixtureRoot, program: "[first(.orders[]) | .[] | iterables] | length", canonical: "[first(.orders[]) | .[] | iterables] | length", element: IntegerType, multiplicity: "one" },
  { name: "call-booleans", input: FixtureRoot, program: "[true, false] | map(booleans)", canonical: "[true, false] | map(booleans)", element: ArrayType(BooleanType), multiplicity: "one" },
  { name: "call-numbers", input: FixtureRoot, program: "first(.orders[]) | .discount | numbers", canonical: "first(.orders[]) | .discount | numbers", element: FloatType, multiplicity: "maybe" },
  { name: "call-strings", input: FixtureRoot, program: "[.bom | .. | strings]", canonical: "[.bom | .. | strings]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-nulls", input: FixtureRoot, program: "[.orders[] | .discount | nulls] | length", canonical: "[.orders[] | .discount | nulls] | length", element: IntegerType, multiplicity: "one" },
  { name: "call-values", input: FixtureRoot, program: "[.orders[] | .discount | values]", canonical: "[.orders[] | .discount | values]", element: ArrayType(FloatType), multiplicity: "one" },
  { name: "call-scalars", input: FixtureRoot, program: "[first(.orders[]) | .total, .discount | scalars]", canonical: "[first(.orders[]) | .total, .discount | scalars]", element: ArrayType(OptionType(FloatType)), multiplicity: "one" },
  { name: "call-normals", input: FixtureRoot, program: "[.orders[] | .total | normals] | length", canonical: "[.orders[] | .total | normals] | length", element: IntegerType, multiplicity: "one" },
  { name: "call-finites", input: FixtureRoot, program: "[.orders[] | .total | finites] | length", canonical: "[.orders[] | .total | finites] | length", element: IntegerType, multiplicity: "one" },
  { name: "call-tostring", input: FixtureRoot, program: "first(.orders[]) | .id | tostring", canonical: "first(.orders[]) | .id | tostring", element: StringType, multiplicity: "maybe", deviation: 9 },
  { name: "call-tojson", input: FixtureRoot, program: "first(.orders[]) | .lines[0] | tojson", canonical: "first(.orders[]) | .lines[0] | tojson", element: StringType, multiplicity: "maybe", deviation: 9 },
  { name: "call-tonumber", input: FixtureRoot, program: "\"12.5\" | tonumber", canonical: "\"12.5\" | tonumber", element: FloatType, multiplicity: "one", deviation: 19 },
  { name: "call-toboolean", input: FixtureRoot, program: "\"true\" | toboolean", canonical: "\"true\" | toboolean", element: BooleanType, multiplicity: "one" },
  { name: "call-builtins", input: FixtureRoot, program: "builtins | length", canonical: "builtins | length", element: IntegerType, multiplicity: "one" },
  { name: "call-infinite", input: FixtureRoot, program: "infinite | isinfinite", canonical: "infinite | isinfinite", element: BooleanType, multiplicity: "one" },
  { name: "call-nan", input: FixtureRoot, program: "nan | isnan", canonical: "nan | isnan", element: BooleanType, multiplicity: "one" },
  { name: "call-isfinite", input: FixtureRoot, program: "1.5 | isfinite", canonical: "1.5 | isfinite", element: BooleanType, multiplicity: "one" },
  { name: "call-isnormal", input: FixtureRoot, program: "1.5 | isnormal", canonical: "1.5 | isnormal", element: BooleanType, multiplicity: "one" },
  { name: "call-abs", input: FixtureRoot, program: "-3 | abs", canonical: "-3 | abs", element: IntegerType, multiplicity: "one" },
  { name: "call-startswith", input: FixtureRoot, program: "[.orders[] | select(.customer_id | startswith(\"C0\"))] | length", canonical: "[.orders[] | select(.customer_id | startswith(\"C0\"))] | length", element: IntegerType, multiplicity: "one" },
  { name: "call-endswith", input: FixtureRoot, program: "\"file.csv\" | endswith(\".csv\")", canonical: "\"file.csv\" | endswith(\".csv\")", element: BooleanType, multiplicity: "one" },
  { name: "call-startswith-datetime", input: FixtureRoot, program: "[.orders[] | select(.status.type == \"shipped\") | .status.value.date | startswith(\"2026\")]", canonical: "[.orders[] | select(.status.type == \"shipped\") | .status.value.date | startswith(\"2026\")]", diagnostics: [{ code: "type_mismatch", span: [70, 18] }], deviation: 4 },
  { name: "call-ltrimstr", input: FixtureRoot, program: "\"C01\" | ltrimstr(\"C\")", canonical: "\"C01\" | ltrimstr(\"C\")", element: StringType, multiplicity: "one" },
  { name: "call-rtrimstr", input: FixtureRoot, program: "\"file.csv\" | rtrimstr(\".csv\")", canonical: "\"file.csv\" | rtrimstr(\".csv\")", element: StringType, multiplicity: "one" },
  { name: "call-trimstr", input: FixtureRoot, program: "\"-x-\" | trimstr(\"-\")", canonical: "\"-x-\" | trimstr(\"-\")", element: StringType, multiplicity: "one" },
  { name: "call-trim", input: FixtureRoot, program: "\"  x \" | trim", canonical: "\"  x \" | trim", element: StringType, multiplicity: "one" },
  { name: "call-ltrim", input: FixtureRoot, program: "\"  x \" | ltrim", canonical: "\"  x \" | ltrim", element: StringType, multiplicity: "one" },
  { name: "call-rtrim", input: FixtureRoot, program: "\"  x \" | rtrim", canonical: "\"  x \" | rtrim", element: StringType, multiplicity: "one" },
  { name: "call-ascii-downcase", input: FixtureRoot, program: "\"ÀBC\" | ascii_downcase", canonical: "\"ÀBC\" | ascii_downcase", element: StringType, multiplicity: "one", deviation: 18 },
  { name: "call-ascii-upcase", input: FixtureRoot, program: "\"abc\" | ascii_upcase", canonical: "\"abc\" | ascii_upcase", element: StringType, multiplicity: "one" },
  { name: "call-split", input: FixtureRoot, program: "\"a,b\" | split(\",\")", canonical: "\"a,b\" | split(\",\")", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-split-regex-unavailable", input: FixtureRoot, program: "\"a1b\" | split(\"[0-9]\"; \"g\")", canonical: "\"a1b\" | split(\"[0-9]\"; \"g\")", diagnostics: [{ code: "unsupported", span: [8, 19] }], deviation: 17 },
  { name: "call-test", input: FixtureRoot, program: "[.orders[] | select(.customer_id | test(\"^C0[1-3]$\"))] | length", canonical: "[.orders[] | select(.customer_id | test(\"^C0[1-3]$\"))] | length", element: IntegerType, multiplicity: "one", deviation: 8 },
  { name: "call-test-flags", input: FixtureRoot, program: "\"abc\" | test(\"B\"; \"i\")", canonical: "\"abc\" | test(\"B\"; \"i\")", element: BooleanType, multiplicity: "one" },
  { name: "call-test-invalid-regex", input: FixtureRoot, program: "\"abc\" | test(\"[\")", canonical: "\"abc\" | test(\"[\")", diagnostics: [{ code: "type_mismatch", span: [13, 3] }] },
  { name: "call-test-flag-unsupported", input: FixtureRoot, program: "\"abc\" | test(\"b\"; \"x\")", canonical: "\"abc\" | test(\"b\"; \"x\")", diagnostics: [{ code: "unsupported", span: [18, 3] }] },
  { name: "call-sub-named-group", input: FixtureRoot, program: "\"order 12\" | sub(\"(?<n>[0-9]+)\"; \"#\\(.n)\")", canonical: "\"order 12\" | sub(\"(?<n>[0-9]+)\"; \"#\\(.n)\")", element: StringType, multiplicity: "one" },
  { name: "call-gsub", input: FixtureRoot, program: "\"a-b-c\" | gsub(\"-\"; \"+\")", canonical: "\"a-b-c\" | gsub(\"-\"; \"+\")", element: StringType, multiplicity: "one" },
  { name: "call-gsub-replacement-computed", input: FixtureRoot, program: "\"a-b\" | gsub(\"-\"; .)", canonical: "\"a-b\" | gsub(\"-\"; .)", diagnostics: [{ code: "type_mismatch", span: [18, 1] }] },
  { name: "call-match-unavailable", input: FixtureRoot, program: "\"abc\" | match(\"b\")", canonical: "\"abc\" | match(\"b\")", diagnostics: [{ code: "unsupported", span: [8, 10] }], deviation: 8 },
  { name: "call-format", input: FixtureRoot, program: "\"x\" | format(\"base32\")", canonical: "\"x\" | format(\"base32\")", element: StringType, multiplicity: "one" },
  { name: "call-floor", input: FixtureRoot, program: "first(.orders[]) | .total | floor", canonical: "first(.orders[]) | .total | floor", element: IntegerType, multiplicity: "maybe" },
  { name: "call-ceil", input: FixtureRoot, program: "2.1 | ceil", canonical: "2.1 | ceil", element: IntegerType, multiplicity: "one" },
  { name: "call-round", input: FixtureRoot, program: "2.5 | round", canonical: "2.5 | round", element: IntegerType, multiplicity: "one" },
  { name: "call-trunc", input: FixtureRoot, program: "-2.7 | trunc", canonical: "-2.7 | trunc", element: IntegerType, multiplicity: "one" },
  { name: "call-sqrt", input: FixtureRoot, program: "9 | sqrt", canonical: "9 | sqrt", element: FloatType, multiplicity: "one" },
  { name: "call-log", input: FixtureRoot, program: "1 | log", canonical: "1 | log", element: FloatType, multiplicity: "one" },
  { name: "call-log2", input: FixtureRoot, program: "8 | log2", canonical: "8 | log2", element: FloatType, multiplicity: "one" },
  { name: "call-log10", input: FixtureRoot, program: "100 | log10", canonical: "100 | log10", element: FloatType, multiplicity: "one" },
  { name: "call-exp", input: FixtureRoot, program: "0 | exp", canonical: "0 | exp", element: FloatType, multiplicity: "one" },
  { name: "call-exp2", input: FixtureRoot, program: "3 | exp2", canonical: "3 | exp2", element: FloatType, multiplicity: "one" },
  { name: "call-exp10", input: FixtureRoot, program: "2 | exp10", canonical: "2 | exp10", element: FloatType, multiplicity: "one" },
  { name: "call-sin", input: FixtureRoot, program: "0 | sin", canonical: "0 | sin", element: FloatType, multiplicity: "one" },
  { name: "call-cos", input: FixtureRoot, program: "0 | cos", canonical: "0 | cos", element: FloatType, multiplicity: "one" },
  { name: "call-tan", input: FixtureRoot, program: "0 | tan", canonical: "0 | tan", element: FloatType, multiplicity: "one" },
  { name: "call-fabs", input: FixtureRoot, program: "-2 | fabs", canonical: "-2 | fabs", element: FloatType, multiplicity: "one" },
  { name: "call-pow", input: FixtureRoot, program: "pow(2; 10)", canonical: "pow(2; 10)", element: FloatType, multiplicity: "one" },
  { name: "call-fmin", input: FixtureRoot, program: "fmin(1; 2.5)", canonical: "fmin(1; 2.5)", element: FloatType, multiplicity: "one" },
  { name: "call-fmax", input: FixtureRoot, program: "fmax(1; 2.5)", canonical: "fmax(1; 2.5)", element: FloatType, multiplicity: "one" },
  { name: "call-fmod", input: FixtureRoot, program: "fmod(7.5; 2)", canonical: "fmod(7.5; 2)", element: FloatType, multiplicity: "one" },
  { name: "call-atan-unavailable", input: FixtureRoot, program: "1 | atan", canonical: "1 | atan", diagnostics: [{ code: "unsupported", span: [4, 4] }], deviation: 17 },
  { name: "call-fromjson-unavailable", input: FixtureRoot, program: "\"[1]\" | fromjson", canonical: "\"[1]\" | fromjson", diagnostics: [{ code: "unsupported", span: [8, 8] }], deviation: 17 },
  { name: "call-explode-unavailable", input: FixtureRoot, program: "\"abc\" | explode", canonical: "\"abc\" | explode", diagnostics: [{ code: "unsupported", span: [8, 7] }], deviation: 17 },
  { name: "call-have-decnum-unavailable", input: FixtureRoot, program: "have_decnum", canonical: "have_decnum", diagnostics: [{ code: "unsupported", span: [0, 11] }], deviation: 17 },
  { name: "call-splits-unavailable", input: FixtureRoot, program: "[\"a1b\" | splits(\"[0-9]\")]", canonical: "[\"a1b\" | splits(\"[0-9]\")]", diagnostics: [{ code: "unsupported", span: [9, 15] }], deviation: 17 },
  { name: "call-todate", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | todate", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | todate", element: StringType, multiplicity: "maybe" },
  { name: "call-todate-epoch", input: FixtureRoot, program: "1700000000 | todate", canonical: "1700000000 | todate", element: StringType, multiplicity: "one" },
  { name: "call-todateiso8601", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | todateiso8601", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | todateiso8601", element: StringType, multiplicity: "maybe" },
  { name: "call-fromdate", input: FixtureRoot, program: "\"2026-09-07T00:00:00.000+00:00\" | fromdate", canonical: "\"2026-09-07T00:00:00.000+00:00\" | fromdate", element: DateTimeType, multiplicity: "one", deviation: 4 },
  { name: "call-fromdateiso8601", input: FixtureRoot, program: "\"2026-09-07T00:00:00Z\" | fromdateiso8601", canonical: "\"2026-09-07T00:00:00Z\" | fromdateiso8601", element: DateTimeType, multiplicity: "one" },
  { name: "call-strftime", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | strftime(\"%A, %d %B %Y\")", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | strftime(\"%A, %d %B %Y\")", element: StringType, multiplicity: "maybe" },
  { name: "call-strptime", input: FixtureRoot, program: "\"2026-03-04\" | strptime(\"%Y-%m-%d\")", canonical: "\"2026-03-04\" | strptime(\"%Y-%m-%d\")", element: DateTimeType, multiplicity: "one", deviation: 4 },
  { name: "call-strftime-unsupported-code", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | strftime(\"%j\")", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | strftime(\"%j\")", diagnostics: [{ code: "unsupported", span: [85, 4] }] },
  { name: "call-year", input: FixtureRoot, program: "[.orders[] | select(.status.type == \"shipped\") | .status.value.date | year] | unique", canonical: "[.orders[] | select(.status.type == \"shipped\") | .status.value.date | year] | unique", element: ArrayType(IntegerType), multiplicity: "one" },
  { name: "call-datetime-parts", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | [month, day, hour, minute, second, millisecond, weekday, epoch_ms]", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | [month, day, hour, minute, second, millisecond, weekday, epoch_ms]", element: ArrayType(IntegerType), multiplicity: "maybe" },
  { name: "call-datetime-add", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | datetime_add(7; \"day\")", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | datetime_add(7; \"day\")", element: DateTimeType, multiplicity: "maybe" },
  { name: "call-datetime-diff", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | datetime_diff(\"2026-01-01\"; \"day\")", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | datetime_diff(\"2026-01-01\"; \"day\")", element: IntegerType, multiplicity: "maybe" },
  { name: "call-datetime-unit", input: FixtureRoot, program: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | datetime_add(1; \"fortnight\")", canonical: "first(.orders[] | select(.status.type == \"shipped\")) | .status.value.date | datetime_add(1; \"fortnight\")", diagnostics: [{ code: "type_mismatch", span: [92, 11] }] },
  { name: "call-gmtime-not-yet", input: FixtureRoot, program: "1700000000 | gmtime", canonical: "1700000000 | gmtime", diagnostics: [{ code: "unsupported", span: [13, 6] }] },
  { name: "call-now-excluded", input: FixtureRoot, program: "now", canonical: "now", diagnostics: [{ code: "unsupported", span: [0, 3] }], deviation: 7 },
  { name: "call-input-excluded", input: FixtureRoot, program: "input", canonical: "input", diagnostics: [{ code: "unsupported", span: [0, 5] }], deviation: 7 },
  { name: "call-call-model", input: FixtureRoot, program: "call(.model; {price: 10.0, region: \"NSW\"})", canonical: "call(.model; {price: 10.0, region: \"NSW\"})", element: FloatType, multiplicity: "one", deviation: 11 },
  { name: "call-call-integer-promotes", input: FixtureRoot, program: "call(.model; {price: 10, region: \"NSW\"})", canonical: "call(.model; {price: 10, region: \"NSW\"})", element: FloatType, multiplicity: "one" },
  { name: "call-call-argument-type", input: FixtureRoot, program: "call(.model; 1)", canonical: "call(.model; 1)", diagnostics: [{ code: "type_mismatch", span: [13, 1] }] },
  { name: "call-call-arity", input: FixtureRoot, program: "call(.model)", canonical: "call(.model)", diagnostics: [{ code: "arity", span: [0, 12] }] },
  { name: "call-call-range", input: FixtureRoot, program: "[range(10.0; 12.25; 0.5) as $p | {price: $p, demand: call(.model; {price: $p, region: \"NSW\"})}] | .[4]", canonical: "[range(10.0; 12.25; 0.5) as $p | {price: $p, demand: call(.model; {price: $p, region: \"NSW\"})}] | .[4]", element: OptionType(StructType({ price: FloatType, demand: FloatType })), multiplicity: "one" },
  { name: "call-signature-tooling", input: FixtureRoot, program: ".model | signature", canonical: ".model | signature", diagnostics: [{ code: "unsupported", span: [9, 9] }], deviation: 11 },
  { name: "call-source-tooling", input: FixtureRoot, program: ".model | source", canonical: ".model | source", diagnostics: [{ code: "unsupported", span: [9, 6] }] },
  { name: "call-calls-tooling", input: FixtureRoot, program: ".model | calls", canonical: ".model | calls", diagnostics: [{ code: "unsupported", span: [9, 5] }] },
  { name: "call-captures-tooling", input: FixtureRoot, program: ".model | captures", canonical: ".model | captures", diagnostics: [{ code: "unsupported", span: [9, 8] }] },
  { name: "call-option-skip-nulls", input: FixtureRoot, program: ".orders[0] | keys", canonical: ".orders[0] | keys", diagnostics: [{ code: "type_mismatch", span: [13, 4], fixes: [{ label: "Skip nulls", result: ".orders[0] | values | keys" }] }], deviation: 16 },
  { name: "call-narrow-first", input: FixtureRoot, program: ".orders | map(.status.value.date | year)", canonical: ".orders | map(.status.value.date | year)", diagnostics: [{ code: "type_mismatch", span: [35, 4], fixes: [{ label: "Narrow first", result: ".orders | map(select(.status.type == \"shipped\") | .status.value.date | year)" }] }], deviation: 16 },
  { name: "call-builtin-on-stream-element", input: FixtureRoot, program: ".cells | to_entries[] | .value | sort", canonical: ".cells | to_entries[] | .value | sort", diagnostics: [{ code: "array_builtin_on_element", span: [33, 4], fixes: [{ label: "Collect to_entries[] first", result: ".cells | [to_entries[] | .value] | sort" }] }] },
  { name: "call-select-type-narrows", input: FixtureRoot, program: "[.bom | .. | select(type == \"object\") | .sku]", canonical: "[.bom | .. | select(type == \"object\") | .sku]", element: ArrayType(StringType), multiplicity: "one" },
  { name: "call-type-unknown-name", input: FixtureRoot, program: ".orders[] | select(type == \"numbr\")", canonical: ".orders[] | select(type == \"numbr\")", diagnostics: [{ code: "unknown_case", span: [27, 7], suggestions: ["\"number\""], fixes: [{ label: "Use \"number\"", result: ".orders[] | select(type == \"number\")" }] }] },
];

/** What the front end made of one case, as the corpus fixture holds it. */
export const QueryCorpusEntryType = StructType({
  /** `printJq(parseJq(program))`: the canonical text; empty for a program
   *  that does not parse. */
  canonical: StringType,
  /** The case itself: what the python front end needs to check it again, and
   *  the output it must give. */
  case: StructType({
    input: EastTypeType,
    name: StringType,
    output: OptionType(StringType),
    program: StringType,
    root: BooleanType,
  }),
  /** The checked query; none for a case that does not check. */
  checked: OptionType(QueryType),
  /** The checker's diagnostics, lints included. */
  diagnostics: ArrayType(QueryErrorType),
});

/** The corpus fixture: `test/fixtures/query-corpus.beast2`. */
export const QueryCorpusFixtureType = StructType({
  /** Every case, in corpus order. */
  cases: ArrayType(QueryCorpusEntryType),
  /** The header: each query wire type's type value, canonically numbered and
   *  encoded as beast2, by the type's name. */
  types: DictType(StringType, BlobType),
});

/** The query wire types the header holds, by name. */
export const QUERY_WIRE_TYPES: Readonly<Record<string, EastType>> = {
  JqPatternType, JqType, QueryEditType, QueryErrorType, QueryFixType, QueryMultiplicityType,
  QueryResultType, QuerySpanType, QueryType, QueryV1Type,
};

/**
 * Encodes a type's type value as the header holds it: canonically numbered,
 * so the bytes depend on the type alone.
 *
 * @param type - the type
 * @returns its type value's bytes
 */
export function typeValueBytes(type: EastType): Uint8Array {
  return encodeBeast2For(EastTypeType)(canonicalTypeValue(toEastTypeValue(type)));
}

/**
 * Runs the front end over one case.
 *
 * @param c - the case
 * @returns what the front end made of it
 */
function entryFor(c: QueryCorpusCase): ValueTypeOf<typeof QueryCorpusEntryType> {
  const parsed = parseJq(c.program);
  const checked = checkJq(parsed, c.input, { root: c.root === true });
  return {
    canonical: parsed.program.type === "some" ? printJq(parsed.program.value).text : "",
    case: {
      input: canonicalTypeValue(toEastTypeValue(c.input)),
      name: c.name,
      output: c.output === undefined ? none : some(c.output),
      program: c.program,
      root: c.root === true,
    },
    checked: checked.query === null ? none : some(checked.query),
    diagnostics: checked.diagnostics,
  };
}

/**
 * Builds the corpus fixture from the corpus and the front end as they are now.
 *
 * @returns the fixture value
 */
export function queryCorpusFixture(): ValueTypeOf<typeof QueryCorpusFixtureType> {
  return {
    cases: QUERY_CORPUS.map(entryFor),
    types: new SortedMap(
      Object.entries(QUERY_WIRE_TYPES).map(([name, type]) => [name, typeValueBytes(type)] as const),
      compareFor(StringType),
    ),
  };
}

/**
 * Encodes the corpus fixture as `test/fixtures/query-corpus.beast2` holds it:
 * self-describing beast2.
 *
 * @returns the fixture's bytes
 */
export function queryCorpusBytes(): Uint8Array {
  return encodeBeast2For(QueryCorpusFixtureType)(queryCorpusFixture());
}

/** The markers around `devdocs/QUERY.md` §10's tables, which {@link catalogTables} writes. */
export const CATALOG_BEGIN = "<!-- catalog: written by `make query-corpus` from src/query/jq/catalog.ts -->";
export const CATALOG_END = "<!-- /catalog -->";

/**
 * `devdocs/QUERY.md` §10's tables, from the catalog: the builtins a query may
 * call, and those it may not, with why.
 *
 * @returns the markdown between {@link CATALOG_BEGIN} and {@link CATALOG_END}
 */
export function catalogTables(): string {
  const cell = (text: string): string => text.replaceAll("|", "\\|");
  const byName = [...BUILTINS].sort(([a], [b]) => {
    const x = a.replace(/^@/, "").toLowerCase();
    const y = b.replace(/^@/, "").toLowerCase();
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
  });
  const callable = byName.filter(([, b]) => b.status === "supported" || b.status === "tooling");
  const refused = byName.filter(([, b]) => b.status !== "supported" && b.status !== "tooling");
  const why = (b: (typeof byName)[number][1]): string =>
    b.status === "excluded" ? "excluded (§11, §13.7)" : b.status === "not_yet" ? "not yet" : `unavailable: ${b.reason ?? ""}`;
  return [
    "| Builtin | Arities | Takes → gives | Outputs | East definition |",
    "|---|---|---|---|---|",
    ...callable.map(([name, b]) =>
      `| \`${name}\` | ${b.arities.join(", ")} | ${cell(b.rule ?? "")} | ${cell(b.outputs ?? "")} | ${cell(b.east)}${b.status === "tooling" ? " (tooling-only, §9)" : ""} |`),
    "",
    "Refused, with the diagnostic's reason (§12):",
    "",
    "| Builtin | Arities | Why |",
    "|---|---|---|",
    ...refused.map(([name, b]) => `| \`${name}\` | ${b.arities.join(", ")} | ${cell(why(b))} |`),
  ].join("\n");
}

/** The markers around `devdocs/QUERY.md` §12's templates, which {@link messageTable} writes. */
export const MESSAGES_BEGIN = "<!-- messages: written by `make query-corpus` from src/query/jq/messages.ts -->";
export const MESSAGES_END = "<!-- /messages -->";

/**
 * Every sentence the checker says, with `{placeholders}` for what varies: each
 * template of `messages.ts`, and each of its forms.
 *
 * @returns the template's key and its text, in the order `messages.ts` lists them
 */
export function messageTemplates(): { key: keyof typeof MESSAGES; text: string }[] {
  const m = MESSAGES;
  const t = (key: keyof typeof MESSAGES, text: string) => ({ key, text });
  return [
    t("unknownField", m.unknownField("{.name}", "{T}")),
    t("unknownField", m.unknownField("{.name}", "{T}", "{.suggestion}")),
    t("unknownDataset", m.unknownDataset("{.name}")),
    t("unknownDataset", m.unknownDataset("{.name}", "{.suggestion}")),
    t("unknownPayloadField", m.unknownPayloadField("{.name}")),
    t("unknownPayloadField", m.unknownPayloadField("{.name}", "{.suggestion}")),
    t("unknownVariantField", m.unknownVariantField("{.name}", "{path}")),
    t("unknownCase", m.unknownCase("{path}", "{\"case\"}", ["{a}", "{b}", "{c}"])),
    t("unknownCase", m.unknownCase("{path}", "{\"case\"}", ["{a}", "{b}", "{c}"], "{\"suggestion\"}")),
    t("unknownType", m.unknownType("{\"name\"}", ["{a}", "{b}", "{c}"])),
    t("unknownType", m.unknownType("{\"name\"}", ["{a}", "{b}", "{c}"], "{\"suggestion\"}")),
    t("unknownFunction", m.unknownFunction("{name}", 0).replace("/0", "/{arity}")),
    t("unknownFunction", m.unknownFunction("{name}", 0, "{suggestion}").replace("/0", "/{arity}")),
    t("unknownVariable", m.unknownVariable("{name}")),
    t("unknownLabel", m.unknownLabel("{name}")),
    t("arity", m.arity("{name}", [1], 0).replace("not 0", "not {n}")),
    t("arity", m.arity("{name}", [1, 2], 0).replace("1 and 2", "{a} and {b}").replace("not 0", "not {n}")),
    t("notAField", m.notAField("{.name}", "{T}")),
    t("notIterable", m.notIterable("{form}", "{T}")),
    t("notIterableNull", m.notIterableNull("{form}", "{T}")),
    t("notIndexable", m.notIndexable("{target}", "{T}")),
    t("keyType", m.keyType("{form}", "{K}", "{key}", "{T}").replace("needs a {K}", "needs {a|an} {K}")),
    t("mutableKey", m.mutableKey("{key}", "{T}")),
    t("sliceBound", m.sliceBound("{T}")),
    t("structKey", m.structKey("{form}")),
    t("compares", m.compares("{op}", "{L}", "{R}")),
    t("neverEqual", m.neverEqual("==")),
    t("neverEqual", m.neverEqual("!=")),
    t("arithmetic", m.arithmetic("{op}", "{L}", "{R}")),
    t("negate", m.negate("{T}")),
    t("wholeVariant", m.wholeVariant("{.F}", "{T}")),
    t("narrowFirst", m.narrowFirst("{path}", "{T}", "{case}", "{.F}", "{field}")),
    t("input", m.input("{name}", "{what}", "{T}")),
    t("dateAsString", m.dateAsString("{name}")),
    t("argument", m.argument("{name}", "{nth}", "{what}", "{T}")),
    t("literalArgument", m.literalArgument("{name}", "{nth}", "{what}")),
    t("isoDate", m.isoDate("{\"text\"}")),
    t("emptyRange", m.emptyRange("{range(…)}")),
    t("regex", m.regex("{\"pattern\"}", "{reason}")),
    t("replacement", m.replacement("{name}")),
    t("mixedDelete", m.mixedDelete("{del(…)}")),
    t("mixedKeys", m.mixedKeys()),
    t("noCommonType", m.noCommonType("{A}", "{B}")),
    t("accumulator", m.accumulator("{reduce|foreach|…}", "{A}", "{B}")),
    t("recursion", m.recursion("{name}")),
    t("excluded", m.excluded("{name}")),
    t("unavailable", m.unavailable("{name}", "{reason}")),
    t("notYet", m.notYet("{name}")),
    t("tooling", m.tooling("{name}")),
    t("wholeRoot", m.wholeRoot(["{a}", "{b}"])),
    t("wholeRoot", m.wholeRoot(["{a}", "{b}", "{c}", "{d}"])),
    t("asyncCall", m.asyncCall()),
    t("recursiveFilter", m.recursiveFilter("{name}")),
    t("regexFlag", m.regexFlag("{flag}")),
    t("formatCode", m.formatCode("{code}")),
    t("duplicateOutputs", m.duplicateOutputs("{generator}")),
    t("arrayOnElement", m.arrayOnElement("{name}", "{stream}", "{T}", "[{…}]")),
    t("duplicateKey", m.duplicateKey("{\"key\"}")),
    t("neverMissing", m.neverMissing("{path}", "{T}")),
    t("longRange", m.longRange("{range(…)}", "{count}")),
  ];
}

/**
 * `devdocs/QUERY.md` §12's table of templates.
 *
 * @returns the markdown between {@link MESSAGES_BEGIN} and {@link MESSAGES_END}
 */
export function messageTable(): string {
  return [
    "| Code | Message |",
    "|---|---|",
    ...messageTemplates().map(({ text }) => `| \`${text.slice(0, text.indexOf(":"))}\` | ${text.replaceAll("|", "\\|")} |`),
  ].join("\n");
}

/** Rewrites the text between two markers. */
function between(text: string, begin: string, end: string, content: string, what: string): string {
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from < 0 || to < from) throw new Error(`devdocs/QUERY.md lacks ${what}'s markers`);
  return `${text.slice(0, from + begin.length)}\n${content}\n${text.slice(to)}`;
}

/**
 * `devdocs/QUERY.md` with §10's tables as {@link catalogTables} writes them,
 * and §12's templates as {@link messageTable} does.
 *
 * @param text - the document as it is
 * @returns the document with the text between the markers rewritten
 * @throws {Error} When the markers are missing.
 */
export function withCatalogTables(text: string): string {
  const catalog = between(text, CATALOG_BEGIN, CATALOG_END, catalogTables(), "§10's catalog");
  return between(catalog, MESSAGES_BEGIN, MESSAGES_END, messageTable(), "§12's templates");
}

/**
 * Checks that a checked-in fixture holds exactly the bytes built now.
 *
 * @param file - the fixture's name in `test/fixtures/`
 * @param checkedIn - the file's bytes
 * @param fresh - the bytes built now
 * @throws {Error} When they differ, saying how to rewrite the file.
 */
export function assertFixtureCurrent(file: string, checkedIn: Uint8Array, fresh: Uint8Array): void {
  if (!equalFor(BlobType)(checkedIn, fresh)) {
    throw new Error(
      `test/fixtures/${file} is not what the query corpus and fixture make now: ` +
      `run \`make query-corpus\` in libs/east and commit the file`,
    );
  }
}
