/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The wire types of typed jq queries over East values.
 *
 * A query's text is parsed and checked once, in an SDK, into a
 * {@link QueryType} value: the program as a {@link JqType} tree, the type it
 * was checked against, the type of each output, how many outputs it gives,
 * and whether it reads an e3 root. That value is how East keeps a checked
 * query, a saved one included. In code, the `Query` builtin carries the
 * program and a root's input names ({@link QueryCallType}) beside the query's
 * translation, whose function type carries the types, and a runtime runs the
 * translation (#1041), so no runtime reads query text.
 *
 * Struct fields are declared alphabetically, as `FunctionManifestType`'s are,
 * and the python twins in `east/query/types.py` declare the same types, so a
 * type encodes to the same bytes in either language. `devdocs/QUERY.md` is the
 * normative account of what the values mean.
 *
 * @packageDocumentation
 */

import { ArrayType, BlobType, BooleanType, IntegerType, NullType, OptionType, RecursiveType, StringType, StructType, VariantType } from "../types.js";
import { EastTypeType } from "../type_of_type.js";

/**
 * A destructuring pattern, as `as`, `reduce` and `foreach` bind one.
 *
 * @remarks
 * - `array` — `[$a, $b]`: each element pattern matches the element at its
 *   index.
 * - `object` — `{name: $n, $id}`: each entry reads the field named by `key`
 *   and matches it against `value`; an entry with no `value` binds the
 *   variable named `key` (`$id` reads `.id`). Keys are literal in this version.
 * - `variable` — `$x`, named without its `$`.
 *
 * `?//` alternatives are a list of patterns on the binding that uses them
 * (see {@link JqType}'s `bind` case).
 */
export const JqPatternType = RecursiveType(pattern => VariantType({
  array: ArrayType(pattern),
  object: ArrayType(StructType({ key: StringType, value: OptionType(pattern) })),
  variable: StringType,
}));

/**
 * A jq program, as a tree.
 *
 * @remarks
 * The parser keeps jq's sugar rather than desugaring it, so printing a parsed
 * program gives back what was written: `.a.b` is two `field` nodes and `f?` is
 * a `try` with no `catch`. Operators, builtin names and error codes are
 * strings, so a new one never changes this type.
 *
 * - `alternative` — `left // right`.
 * - `array` — `[f]`, or `[]` when there is no body.
 * - `binary` — `left op right`, for `op` one of `+ - * / % == != < <= > >=
 *   and or`.
 * - `bind` — `source as $p ?// $q | body`: the first of `patterns` that
 *   matches binds.
 * - `break` — `break $name`, named without its `$`.
 * - `call` — a builtin or a `def` by name, with its `;`-separated arguments.
 * - `comma` — `left, right`.
 * - `def` — `def name(params): body; rest`.
 * - `descend` — `..`, every nested value in pre-order.
 * - `field` — `target.name`, or `target.name?` when `optional`.
 * - `foreach` — `foreach source as pattern (init; update; extract)`.
 * - `format` — `@name`, or `@name "…"` applied to a string.
 * - `identity` — `.`.
 * - `if` — `if c then t elif … else e end`; `otherwise` is the `else`.
 * - `index` — `target[index]`: an index on an array, a key on a dict,
 *   decided by the target's type; `optional` is a trailing `?`.
 * - `iterate` — `target[]`, or `target[]?` when `optional`.
 * - `label` — `label $name | body`, named without its `$`.
 * - `literal` — a constant, as a self-describing beast2 blob, so it carries
 *   its East type: `1001` is an Integer, `1001.0` a Float.
 * - `negate` — `-f`.
 * - `object` — `{…}`: a key is a `name` (`{a: f}`, or `{a}` with no value),
 *   a `variable` (`{$x}`, named without its `$`) or `computed` (`{(k): v}`).
 * - `pipe` — `left | right`.
 * - `reduce` — `reduce source as pattern (init; update)`.
 * - `slice` — `target[from:to]`, either bound optional.
 * - `string` — a string with interpolations, `"a\(f)b"`, as its parts.
 * - `try` — `try body catch handler`; `f?` is `try f` with no `catch`.
 * - `update` — `path op value`, for `op` one of `= |= += -= *= /= %= //=`.
 * - `variable` — `$x`, named without its `$`.
 */
export const JqType = RecursiveType(jq => VariantType({
  alternative: StructType({ left: jq, right: jq }),
  array: OptionType(jq),
  binary: StructType({ left: jq, op: StringType, right: jq }),
  bind: StructType({ body: jq, patterns: ArrayType(JqPatternType), source: jq }),
  break: StringType,
  call: StructType({ args: ArrayType(jq), name: StringType }),
  comma: StructType({ left: jq, right: jq }),
  def: StructType({ body: jq, name: StringType, params: ArrayType(StringType), rest: jq }),
  descend: NullType,
  field: StructType({ name: StringType, optional: BooleanType, target: jq }),
  foreach: StructType({ extract: OptionType(jq), init: jq, pattern: JqPatternType, source: jq, update: jq }),
  format: StructType({ name: StringType, string: OptionType(jq) }),
  identity: NullType,
  if: StructType({ branches: ArrayType(StructType({ condition: jq, then: jq })), otherwise: OptionType(jq) }),
  index: StructType({ index: jq, optional: BooleanType, target: jq }),
  iterate: StructType({ optional: BooleanType, target: jq }),
  label: StructType({ body: jq, name: StringType }),
  literal: BlobType,
  negate: jq,
  object: ArrayType(StructType({
    key: VariantType({ computed: jq, name: StringType, variable: StringType }),
    value: OptionType(jq),
  })),
  pipe: StructType({ left: jq, right: jq }),
  reduce: StructType({ init: jq, pattern: JqPatternType, source: jq, update: jq }),
  slice: StructType({ from: OptionType(jq), optional: BooleanType, target: jq, to: OptionType(jq) }),
  string: ArrayType(VariantType({ interpolate: jq, text: StringType })),
  try: StructType({ body: jq, catch: OptionType(jq) }),
  update: StructType({ op: StringType, path: jq, value: jq }),
  variable: StringType,
}));

/**
 * How many outputs a query gives: `one` exactly, `maybe` none or one, or
 * `many`.
 *
 * @remarks
 * A checked query's result is its element type `T` for `one`, `Option<T>` for
 * `maybe`, and `Array<T>` (the stream collected in order) for `many`. A
 * runtime enforces the multiplicity: a `one` query that yields no output, or
 * two, is a runtime error.
 */
export const QueryMultiplicityType = VariantType({ many: NullType, maybe: NullType, one: NullType });

/**
 * A checked query, version 1: what an SDK's checker produces and a runtime
 * accepts.
 *
 * @remarks
 * - `element_type` — the type of each output.
 * - `input_type` — the type the program was checked against. A runtime
 *   refuses an input of any other type.
 * - `multiplicity` — how many outputs it gives ({@link QueryMultiplicityType}).
 * - `program` — the program as written, so `printJq` prints it back exactly.
 *   The checker's rewrites, which spare every runtime parsing text (an ISO
 *   string compared with a DateTime is a DateTime literal, a `strftime`
 *   format a token array), are the check result's, where the translator
 *   reads them.
 * - `root` — whether it was checked as an e3 root: `input_type` is a struct
 *   of datasets, and each field the program reads is its own input.
 */
export const QueryV1Type = StructType({
  element_type: EastTypeType,
  input_type: EastTypeType,
  multiplicity: QueryMultiplicityType,
  program: JqType,
  root: BooleanType,
});

/**
 * A checked query: the versioned envelope every runtime accepts.
 *
 * @remarks
 * A structural change to a checked query is a new case that sorts after `v1`
 * (a variant's cases are ordered by name, and inserting one before an existing
 * case renumbers it), and readers accept every released version.
 */
export const QueryType = VariantType({ v1: QueryV1Type });

/**
 * A query as the `Query` builtin carries it in code (#1041): the program as
 * written, and a root's input names.
 *
 * @remarks
 * - `inputs` — the names of a root's fields, one per input of the
 *   translation, in order; `none` for a query of one input.
 * - `program` — the program as written, as {@link QueryV1Type}'s is.
 *
 * The builtin's type parameter, the translation's function type, carries the
 * query's input and result types, so they are not held twice. A structural
 * change is a new case that sorts after `v1`, as {@link QueryType}'s is.
 */
export const QueryCallType = VariantType({
  v1: StructType({
    inputs: OptionType(ArrayType(StringType)),
    program: JqType,
  }),
});

/**
 * A range of query text.
 *
 * @remarks
 * Offsets and lengths count UTF-16 code units, the unit browsers and
 * TypeScript index strings in; python converts from code points, so a program
 * holding characters outside the Basic Multilingual Plane gets the same span
 * in both front ends.
 *
 * - `column` — 1-based, in UTF-16 code units of its line.
 * - `length` — in UTF-16 code units.
 * - `line` — 1-based.
 * - `offset` — 0-based, in UTF-16 code units of the whole text.
 */
export const QuerySpanType = StructType({
  column: IntegerType,
  length: IntegerType,
  line: IntegerType,
  offset: IntegerType,
});

/**
 * One text edit: replace `length` UTF-16 code units at `offset` with
 * `insert`.
 */
export const QueryEditType = StructType({ insert: StringType, length: IntegerType, offset: IntegerType });

/**
 * A one-click fix for a diagnostic: its `label` ("Use .demand") and the text
 * `edits` that make it, applied together.
 *
 * @remarks
 * A fix is text edits so every client applies it the same way. The edits of
 * one fix do not overlap.
 */
export const QueryFixType = StructType({ edits: ArrayType(QueryEditType), label: StringType });

/**
 * A diagnostic from checking a query, or an error from evaluating one.
 *
 * @remarks
 * - `code` — `syntax`, `unknown_field`, `unknown_case`, `unknown_function`,
 *   `type_mismatch`, `not_iterable`, `not_indexable`, `arity`,
 *   `ambiguous_output`, `cannot_infer`, `unsupported` or
 *   `array_builtin_on_element`, or a lint (`duplicate_outputs`,
 *   `duplicate_key`, `never_missing`, `long_range`); `devdocs/QUERY.md` §12
 *   lists each message's template. An error a query raised as it ran is
 *   `runtime` (§15).
 * - `fixes` — one-click fixes, best first.
 * - `message` — one sentence, the same wherever the checker runs.
 * - `severity` — `error`, or `warning` for a lint.
 * - `span` — the text it is about, when it is about some.
 * - `suggestions` — replacement texts for the span, best first.
 */
export const QueryErrorType = StructType({
  code: StringType,
  fixes: ArrayType(QueryFixType),
  message: StringType,
  severity: VariantType({ error: NullType, warning: NullType }),
  span: OptionType(QuerySpanType),
  suggestions: ArrayType(StringType),
});
