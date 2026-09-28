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
 * checked queries and diagnostics byte for byte, and its wire types the
 * header's bytes. `query.corpus.spec.ts` fails when the file is not what the
 * front end makes now.
 *
 * The corpus starts with one case per {@link JqType} case, named after it
 * (`alternative-…`). The parser, the checker and the evaluator fill in each
 * case's canonical text, types, diagnostics and output as they land.
 */

import {
  ArrayType, BlobType, DictType, EastTypeType, OptionType, SortedMap, StringType, StructType,
  JqPatternType, JqType, QueryEditType, QueryErrorType, QueryFixType, QueryMultiplicityType, QueryResultType,
  QuerySpanType, QueryType, QueryV1Type,
  canonicalTypeValue, compareFor, encodeBeast2For, equalFor, none, some, toEastTypeValue,
  type EastType, type ValueTypeOf,
} from "../src/index.js";
import { FixtureRoot } from "./query.fixture.js";

/** One case of the corpus. */
export interface QueryCorpusCase {
  /** Unique, kebab-case, and led by the {@link JqType} case it is about when it
   *  is about one: `field-unknown-suggests`. */
  name: string;
  /** The type the program is checked against: usually {@link FixtureRoot}. */
  input: EastType;
  /** The program, as a person writes it. */
  program: string;
  /** `printJq(parseJq(program))`, required once the printer lands (#920). */
  canonical?: string;
  /** The checked element type. */
  element?: EastType;
  /** The checked multiplicity. */
  multiplicity?: ValueTypeOf<typeof QueryMultiplicityType>["type"];
  /** The expected result as `.east` text, over the fixture when `input` is
   *  {@link FixtureRoot}. */
  output?: string;
  /** The expected diagnostics: a code, a span as `[offset, length]` in UTF-16
   *  code units, and the suggestions. */
  diagnostics?: { code: string; span: [offset: number, length: number]; suggestions?: string[] }[];
  /** The deviation from jq 1.8 this case pins, numbered as `devdocs/QUERY.md`
   *  §13 numbers them. */
  deviation?: number;
}

/** The corpus. */
export const QUERY_CORPUS: readonly QueryCorpusCase[] = [
  { name: "alternative-option-default", input: FixtureRoot, program: "[.orders[] | .discount // 0.0]" },
  { name: "array-collect-ids", input: FixtureRoot, program: "[.orders[] | .id]" },
  { name: "binary-multiply", input: FixtureRoot, program: "[.orders[] | .total * 2]" },
  { name: "bind-lookup-table", input: FixtureRoot, program: ".customers as $c | $c[\"C01\"].name" },
  { name: "break-first-large-order", input: FixtureRoot, program: "label $found | .orders[] | select(.total > 1000) | ., break $found" },
  { name: "call-length", input: FixtureRoot, program: ".orders | length" },
  { name: "comma-two-ids", input: FixtureRoot, program: ".orders[0].id, .orders[1].id" },
  { name: "def-revenue", input: FixtureRoot, program: "def revenue: map(.total) | add; .orders | revenue" },
  { name: "descend-every-sku", input: FixtureRoot, program: "[.bom | .. | .sku?]" },
  { name: "field-nested", input: FixtureRoot, program: ".forecast.regions" },
  { name: "foreach-running-total", input: FixtureRoot, program: "[foreach .orders[].total as $t (0.0; . + $t)]" },
  { name: "format-base64", input: FixtureRoot, program: ".customers[] | .name | @base64" },
  { name: "identity-root", input: FixtureRoot, program: "." },
  { name: "if-size-band", input: FixtureRoot, program: ".orders[] | if .total > 1000 then \"large\" elif .total > 100 then \"medium\" else \"small\" end" },
  { name: "index-integer-key", input: FixtureRoot, program: ".byId[1035].customer_id" },
  { name: "iterate-orders", input: FixtureRoot, program: ".orders[]" },
  { name: "label-without-break", input: FixtureRoot, program: "label $out | .orders | length" },
  { name: "literal-integer", input: FixtureRoot, program: "1001" },
  { name: "negate-total", input: FixtureRoot, program: "[.orders[] | -.total]" },
  { name: "object-literal-keys", input: FixtureRoot, program: ".orders[] | {id, total, customer: .customer_id}" },
  { name: "pipe-index-field", input: FixtureRoot, program: ".orders[0] | .id" },
  { name: "reduce-sum-totals", input: FixtureRoot, program: "reduce .orders[] as $o (0.0; . + $o.total)" },
  { name: "slice-orders", input: FixtureRoot, program: ".orders[2:5] | map(.id)" },
  { name: "string-interpolate", input: FixtureRoot, program: ".orders[] | \"Order \\(.id) for \\(.customer_id)\"" },
  { name: "try-catch-error", input: FixtureRoot, program: "try error(\"no such order\") catch ." },
  { name: "update-arithmetic", input: FixtureRoot, program: ".orders | map(.total |= . * 2)" },
  { name: "variable-bound-order", input: FixtureRoot, program: ".orders[] as $o | $o.id" },
  // A misspelt field after a character outside the Basic Multilingual Plane:
  // its span counts the emoji as two UTF-16 code units in every front end.
  { name: "span-utf16-after-emoji", input: FixtureRoot, program: "\"🚚 \" + .orders[0].customer" },
];

/** What the front end made of one case, as the corpus fixture holds it. */
export const QueryCorpusEntryType = StructType({
  /** `printJq(parseJq(program))`; empty until the printer lands (#920). */
  canonical: StringType,
  /** The case itself: what the python front end needs to check it again, and
   *  the output it must give. */
  case: StructType({
    input: EastTypeType,
    name: StringType,
    output: OptionType(StringType),
    program: StringType,
  }),
  /** The checked query; none until the checker lands (#921), and for a case
   *  that does not check. */
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
  return {
    canonical: "",
    case: {
      input: canonicalTypeValue(toEastTypeValue(c.input)),
      name: c.name,
      output: c.output === undefined ? none : some(c.output),
      program: c.program,
    },
    checked: none,
    diagnostics: [],
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
