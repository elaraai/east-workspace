# QUERY — typed jq over East values

**Normative.** This document says what a query means. Where an implementation
and this document disagree, the implementation is the bug. The design, its
motivation and the plan are issue #875. Its children fill the sections marked
*to be written*: the builtin catalog (#921), conformance (#924) and the e3
surfaces (#932).

A **query** is a jq 1.8 program run on an East value. Values and types are
East's, and every departure from jq 1.8 is deliberate and listed in §13.

A query's text is parsed and checked **once, in an SDK**, against the type of
its input. Checking gives a **checked query**: a `QueryType` value holding
the program, the input type, the type of each output and how many outputs
there are. That value is East's narrow waist for queries, as the token array
of a datetime format string is for `DateTime.printFormatted`. Two builtins,
`Query` and `QueryDynamic`, evaluate a checked query in every runtime (§15).
No runtime reads query text.

| Piece | Where |
|---|---|
| Wire types (§14) | `src/query/types.ts`; python twins in `east/query/types.py` |
| Lexer, parser, printer | `src/query/jq/` (#920) |
| Checker and builtin catalog (§10, §12) | `src/query/jq/` (#921) |
| Evaluator, `Query` / `QueryDynamic`, `East.jq` | `src/query/eval.ts`, `src/compile/builtins/query.ts` (#923); east-c (#925) |
| Corpus | `test/query.corpus.ts`, generating `test/fixtures/query-corpus.beast2` |
| Shared fixture | `test/query.fixture.ts`, generating `test/fixtures/query-fixture.beast2` |

## Contents

1. The examples' data
2. Values as jq sees them
3. Streams, multiplicity and the result type
4. Paths, indexing and keys
5. Construction and inference
6. Operators and numbers
7. DateTime
8. Variants, Options and recursion
9. Function values
10. Builtins
11. Order and determinism
12. Diagnostics and lints
13. Deviations from jq 1.8
14. Wire types
15. The runtime contract
16. Conformance
17. e3 surfaces

---

## 1. The examples' data

Every example runs over the shared fixture, `queryFixture()` in
`test/query.fixture.ts`. It is the data the query editor's mock shows
(`libs/east-ui/docs/proposals/Query Editor Spec.html`, generated from seed
875), with two extra datasets whose keys are not strings. Its root is
`FixtureRoot`:

| Field | Type |
|---|---|
| `bom` | `Part`, recursive: `Struct{children: Array<Part>, cost: Float, sku: String}` |
| `byId` | `Dict<Integer, Order>`: `orders` keyed by id |
| `cells` | `Dict<Struct{region: String, week: Integer}, Float>`: `forecast` flattened, weeks numbered from 1 |
| `customers` | `Dict<String, Struct{name: String, region: String, tier: Variant{gold, standard}}>` |
| `forecast` | `Struct{regions: Dict<String, Struct{weekly: Array<Float>}>}` |
| `model` | `Function([Struct{price: Float, region: String}], Float)` |
| `orders` | `Array<Order>` |

An `Order` is `Struct{customer_id: String, discount: Option<Float>, id: Integer,
lines: Array<Struct{price: Float, qty: Integer, sku: String}>, status: Status,
total: Float}`, and a `Status` is `Variant{cancelled: Struct{reason: String},
pending: Null, shipped: Struct{date: DateTime}}`. There are 40 orders, ids 1001
to 1040: 23 shipped, 14 pending and 3 cancelled.

Examples are written as a program, then `→` and the result as `.east` text,
then the result's type and the multiplicity:

```jq
.byId[1035].customer_id
```
→ `.some "C06"` · Option<String>, one

(A key lookup can miss, so it gives an Option, §4.)

---

## 2. Values as jq sees them

| East type | As jq sees it |
|---|---|
| Null, Boolean, String | As in jq |
| Integer | A number, **exact to 64 bits**. jq itself rounds integers above 2⁵³ |
| Float | A number: IEEE 754, with NaN, ±Infinity and -0.0. `nan`, `isnan`, `infinite`, `isinfinite` and `isnormal` apply |
| DateTime | Its own type (§7) |
| Blob | Its own type: `length` is its size in bytes, `@base64` encodes it, `tostring` prints it as `0x…` |
| Array, Vector | An array: 0-based, negative indices count from the end, slices apply, and `.[i]` out of range is `null` |
| Matrix | An array of its rows |
| Set | An array, sorted in East's order (§11); every array builtin applies |
| Dict<K, V> | An object whose **keys have type K** (§4) |
| Struct | An object with fixed fields; reading a field it lacks is an error (§4) |
| Variant | `{type: "<case>", value: <payload>}` (§8) |
| Option<T> | `null`, or the value, as East's JSON flattens it |
| Recursive | Nested values; `..` and `recurse` walk them (§8) |
| Ref | Read through, as if it were its value |
| Function | A value `call` calls (§9) |

```jq
.orders | map(.id) | .[:3]
```
→ `[1001, 1002, 1003]` · Array<Integer>, one

```jq
[.orders[] | .discount] | .[:3]
```
→ `[.some 0.1, .none, .none]` · Array<Option<Float>>, one (`.none` is jq's `null`)

```jq
first(.orders[]) | .status.type
```
→ `.some "shipped"` · Option<String>, maybe

---

## 3. Streams, multiplicity and the result type

A jq filter gives a stream of outputs. Every filter has a static
**multiplicity**:

| Multiplicity | Outputs | Filters |
|---|---|---|
| **one** | exactly one | `.a`, `length`, `[f]`, literals and constructors |
| **maybe** | none or one | `select(f)`, `first(f)`, `.a?`, `limit(1; f)` |
| **many** | any number | `.[]`, `..`, `range`, `f, g`, `recurse` |

`a | b` and `a, b` compose the multiplicities: `one | one` is one, anything
with `many` in it is many, and `a, b` is always many.

A checked query records its **element type** — the type of each output — and
its multiplicity. Its **result** is the element type `T` for one, `Option<T>`
for maybe, and `Array<T>` for many: the stream collected in order.

```jq
.orders | length
```
→ `40` · Integer, one

```jq
first(.orders[] | select(.total > 1000)) | .id
```
→ `.some 1002` · Option<Integer>, maybe

```jq
.orders[:3][] | .id
```
→ `[1001, 1002, 1003]` · Array<Integer>, many

**One element type.** All the outputs of a program unify to one element type:

- Integer and Float unify to Float.
- `T` and `null` unify to `Option<T>`.
- Structs with the same fields unify, field by field.
- Anything else is `ambiguous_output`, which suggests wrapping the outputs in
  an object.

```jq
first(.orders[]) | .id, .total
```
→ `[1001.0, 80.1]` · Array<Float>, many

```jq
first(.orders[]) | .id, null
```
→ `[.some 1001, .none]` · Array<Option<Integer>>, many

```jq
first(.orders[]) | .id, .customer_id
```
→ `ambiguous_output`: Integer and String have no common type. Suggestion:
`{id, customer_id}`.

**The runtime enforces the multiplicity.** A one query that gives no output,
or two, is a runtime error. The checker never produces such a query, but a
hand-built `QueryType` can claim anything, and a runtime checks it (§15).

---

## 4. Paths, indexing and keys

**Fields.** `.name` on a Struct reads the field. A name the Struct lacks is
`unknown_field`, with the field names closest by edit distance as suggestions.
`.name?` gives `null` instead: jq's leniency, but only when asked for.

```jq
.orders[0].customer
```
→ `unknown_field`. Suggestion: `.customer_id`.

```jq
.orders[0].customer?
```
→ `null` · Null, one

**`.[e]` is decided by the target's type:**

- on an Array, Vector or Set, it is an **index**, and an index out of range
  gives `null`;
- on a Dict, it is a **key lookup**, and a missing key gives `null`;
- on a Struct, it needs a literal string, the field's name. A computed field
  name needs a Dict.

An index or a lookup can miss, so it gives `Option<T>`. `null` passes through
a field read, as in jq (`null | .a` is `null`), so `.orders[0].id` is
`Option<Integer>`.

**Dict keys have the Dict's key type**, whatever that is:

```jq
.byId[1035].total
```
→ `.some 2381.61` · Option<Float>, one

```jq
.cells[{region: "NSW", week: 1}]
```
→ `.some 1080.0` · Option<Float>, one

```jq
.customers["C99"]
```
→ `.none` · Option<Customer>, one

- On a `Dict<DateTime, V>`, an ISO-8601 string is a key: `.byDay["2026-09-01"]`
  is parsed when the query is checked (§7).
- A key of another type is `type_mismatch`: `.byId["1035"]` needs an Integer.

**Dict builtins** work for every key type. `.[]` gives the values in key
order. `keys` gives the keys in East's order, `has(k)` tests one, and
`to_entries` gives `Array<Struct{key: K, value: V}>`. `from_entries`,
`with_entries`, `del(.[k])` and `map_values` complete the set.

```jq
.customers | keys
```
→ `["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08"]` · Array<String>, one

```jq
.cells | to_entries | .[0]
```
→ `.some (key=(region="NSW", week=1), value=1080.0)` · Option<Struct{key: Cell, value: Float}>, one

**Slices** are half-open, and negative bounds count from the end.

```jq
.orders[-2:] | map(.id)
```
→ `[1039, 1040]` · Array<Integer>, one

**Walks.** `..` visits every nested value in pre-order: a value, then each of
its children, Struct fields in declared order and Dict entries in key order.
`recurse(f)` follows `f` from each value, as in jq.

```jq
[.bom | recurse(.children[]) | .sku]
```
→ `["PUMP-A", "MOTOR-1", "ROTOR-1", "STATOR-1", "BRG-6203", "HOUSING-2",
"GASKET-9", "BOLT-M8", "IMPELLER-3", "SEAL-KIT", "ORING-12", "ORING-18"]` ·
Array<String>, one

**Assignment.** `=`, `|=`, `+=`, `-=`, `*=`, `/=`, `%=` and `//=` follow jq
1.8's path semantics, typed as §5 types construction.

```jq
first(.orders[]) | .total += 1 | .total
```
→ `.some 81.1` · Option<Float>, maybe

---

## 5. Construction and inference

**Objects with literal keys build Structs**: `{a: f, b: g}`, `{a}` and
`{$x}`. jq's cartesian product over the value streams applies.

```jq
first(.orders[]) | {id, total}
```
→ `.some (id=1001, total=80.1)` · Option<Struct{id: Integer, total: Float}>, maybe

**Objects with computed keys build Dicts**: `{(k): v}` builds
`Dict<type(k), type(v)>`.

```jq
first(.orders[]) | {(.customer_id): .total}
```
→ `.some {"C01":80.1}` · Option<Dict<String, Float>>, maybe

**Empty literals take their type from where they are used.** `{}` unifies
with any Dict and with `Struct{}`. `[]` takes its element type from its
context, and is `Array<Never>` when nothing constrains it.

**Arrays are homogeneous.** `[f]` builds `Array<type(f)>`. Mixed element
types are `ambiguous_output`.

**`+` and `*` on objects merge.**

- Struct + Struct merges the fields into a new Struct type; the right wins.
- Dict + Dict is the union; the right wins.
- Struct + Dict is `type_mismatch`.
- `*` merges deeply.

```jq
first(.orders[]) | {id} + {total}
```
→ `.some (id=1001, total=80.1)` · Option<Struct{id: Integer, total: Float}>, maybe

**Assigning a new field** gives a Struct type with the field added:
`first(.orders[]) | .rush = true` gives an `Order` with a `rush: Boolean`
field.

**`reduce` and `foreach`** infer their accumulator's type by a fixpoint from
`init` and `update`, over the finite graph of East types. If it does not
converge, the checker reports `cannot_infer` and asks for a concrete `init`.

```jq
reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total) | .["C04"]
```
→ `.some 409.51` · Option<Float>, one (the accumulator is `Dict<String, Float>`)

**`def` functions** are checked at each call, with the types of that call's
arguments. A recursive `def` is inferred by a fixpoint for each input type;
if that fails, `cannot_infer` suggests `recurse`.

```jq
def revenue: map(.total) | add; .orders | revenue
```
→ `42250.28999999999` · Float, one

---

## 6. Operators and numbers

- **Integer arithmetic stays Integer.** Integer `+ - * %` Integer uses the
  Integer builtins; overflow and division by zero behave as they do.
- **`/` is always Float**, as in jq: `5 / 2` is `2.5`. Integer mixed with
  Float gives Float.
- **Rounding gives Integer**: `floor`, `ceil` and `round` are
  `East.Float.roundFloor`, `roundCeil` and `roundHalf`.
- **`null` is the identity for `+`**, as in jq, so `+` works on an Option.
  `a // b` unifies `Option<T>` with `T` to `T`.
- **Comparisons** apply to values of one type, and Integer compares with Float
  numerically. Any other mix is `type_mismatch`: typed data has no order
  across types.
- **`and`, `or` and `not`** follow jq's truthiness: `false` and `null` are
  false, everything else is true.
- **`length` on a number** is its absolute value, as in jq. jq 1.8's math
  builtins map onto the Float builtins.

```jq
.orders[0].id + 1
```
→ `1002` · Integer, one (`null` is the identity for `+`, so the Option goes)

```jq
first(.orders[]) | .total | floor
```
→ `.some 80` · Option<Integer>, maybe

```jq
first(.orders[] | select(.id == 1002)) | .discount + 1
```
→ `.some 1.0` · Option<Float>, maybe (order 1002's discount is `null`)

```jq
first(.orders[] | select(.id == 1002)) | .discount // 0.0
```
→ `.some 0.0` · Option<Float>, maybe

```jq
.orders[0].id == "1001"
```
→ `type_mismatch`: Integer compares with Integer or Float, not String.

---

## 7. DateTime

**DateTime is a type.** It compares with DateTimes, and with **ISO-8601
string literals**, which the checker parses when it checks the query:
`"2026-09-01"` is midnight UTC.

```jq
[.orders[] | select(.status.type == "shipped") | select(.status.value.date >= "2026-01-01")] | length
```
→ `19` · Integer, one

**String operations on a DateTime** (`startswith`, `test`) are
`type_mismatch`, suggesting `year == 2026 and month == 9`, or
`todate | startswith(…)`.

**Conversions.**

- `todate` and `todateiso8601` give RFC 3339 text, as East's JSON codec writes
  a DateTime: `2026-04-27T09:00:00.000+00:00`.
- `fromdate` and `fromdateiso8601` read RFC 3339 text, with milliseconds and
  offsets. jq 1.8 rejects `2026-09-07T00:00:00.000+00:00`; East reads it.

**Formatting.** `strftime(fmt)` and `strptime(fmt)` map jq's `%` codes onto
East's datetime format tokens when the query is checked, and evaluate with
`DateTimePrintFormat` and `DateTimeParseFormat`:

| jq | `%Y` | `%m` | `%d` | `%H` | `%M` | `%S` | `%b` | `%B` | `%a` | `%A` |
|---|---|---|---|---|---|---|---|---|---|---|
| East | `YYYY` | `MM` | `DD` | `HH` | `mm` | `ss` | `MMM` | `MMMM` | `ddd` | `dddd` |

Any other code is an error when the query is checked.

```jq
first(.orders[]) | select(.status.type == "shipped") | .status.value.date | strftime("%Y-%m")
```
→ `.some "2026-04"` · Option<String>, maybe

**East's additions**: `year`, `month`, `day`, `hour`, `minute`, `second`,
`millisecond`, `weekday`, `epoch_ms`, `datetime_add(n; unit)` and
`datetime_diff(other; unit)`, for the fixed units from millisecond to week.

**Not yet**: `gmtime`, `mktime` and `localtime`. `now` is excluded (§11).

---

## 8. Variants, Options and recursion

**A variant reads as `{type, value}`.**

- `.type` is a String drawn from the case names. Comparing it with a name the
  variant does not have is `unknown_case`, with suggestions.
- `.value` is the payload.
- `.value.date` on a variant where only some cases have `date` is maybe: it
  is `null` for the other cases.
- After `select(.type == "shipped")`, or inside
  `if .type == "shipped" then … end`, the checker **narrows** the variant, and
  `.value.date` is exactly a DateTime.

```jq
first(.orders[]) | .status.type
```
→ `.some "shipped"` · Option<String>, maybe

```jq
first(.orders[]) | .status.value.date
```
→ `.some 2026-04-27T09:00:00.000` · Option<DateTime>, maybe (un-narrowed:
only the `shipped` case has a `date`)

```jq
.orders[] | select(.status.type == "shiped")
```
→ `unknown_case`: Status has no case `"shiped"`. Suggestion: `"shipped"`.

```jq
[.orders[] | select(.status.type == "cancelled") | .status.value.reason]
```
→ `["Customer request", "Payment failed", "Out of stock"]` · Array<String>, one

**An Option** is `null` or the value. `select(. != null)`, `//` and `values`
read it.

**Recursive types** are nested values: `recurse(.children[])` and `..` walk
them (§4).

---

## 9. Function values

**`call(f; a₁; …; aₙ)`** calls a value of type `Function([I₁ … Iₙ], O)`.

- Each argument is checked against its `Iᵢ`; the one promotion is Integer to
  Float.
- The result has type `O`.
- The multiplicity is the product of the arguments' streams.

```jq
call(.model; {price: 10.0, region: "NSW"})
```
→ `1200.0` · Float, one

```jq
[range(10.0; 12.25; 0.5) as $p | {price: $p, demand: call(.model; {price: $p, region: "NSW"})}] | .[4]
```
→ `.some (price=12.0, demand=929.67)` · Option<Struct{price: Float, demand: Float}>, one

- **Async functions** are `unsupported` in this version.
- **Platform dependencies.** A function value runs in the runtime that
  evaluates the query, compiled against that runtime's platform when the value
  is decoded. e3 answers a value whose IR needs platform functions it has not
  loaded with `needs_platform` (§17).
- **Inspection is tooling.** `signature`, `source`, `calls` and `captures`
  need the TypeScript IR printers. They are tooling-only builtins: `e3 query`
  and host-side evaluation (`evaluateJq` with the tooling catalog) offer them,
  and the checker rejects them everywhere else with `unsupported`.

---

## 10. Builtins

*To be written by #921.* The catalog is jq 1.8's documented builtins, less the
exclusions of §11, plus East's additions. Each builtin gets a row: its name,
its typing rule, its multiplicity, and its definition by existing East
builtins or `East.<Type>` library functions. No catalog builtin is
reimplemented.

Regular expressions (`test`, `match`, `capture`, `scan`, `sub`, `gsub`,
`splits`) use East's regex builtins, which are ECMAScript-style, not
Oniguruma. The table below will list the differences.

A catalog name is a **string** in the wire type (§14), so adding one never
changes `QueryType`.

| Builtin | Typing rule | Multiplicity | East definition |
|---|---|---|---|
| *(filled by #921)* | | | |

---

## 11. Order and determinism

**Order.** `sort`, `sort_by`, `group_by`, `unique`, `unique_by`, `min`,
`max`, `min_by`, `max_by` and `keys` use **East's total order**: Structs
compare field by field in declared order, and every type orders its values
(`devdocs/BEAST2.md` and the `compareFor` family). `keys_unsorted` on a Struct
gives the fields in declared order.

**Stream order** is jq's: left to right, depth first. A Dict iterates in key
order and a Struct in field order.

**Excluded**, because a query is deterministic and has no access to its host:
`now`, `localtime`, `env` and `$ENV`, `input` and `inputs`,
`input_filename`, `input_line_number`, `debug`, `stderr`, `halt`,
`halt_error`, `$__prog_args`, and `import` and `include` (modules). Using one
is `unsupported`, naming it.

The same query over the same bytes gives the same result bytes, in every
runtime.

---

## 12. Diagnostics and lints

A diagnostic is a `QueryErrorType` (§14): a code, a severity, a span, one
sentence, suggestions, and one-click fixes where the checker has one. The words
are the same wherever the checker runs.

| Code | When |
|---|---|
| `syntax` | The text does not parse |
| `unknown_field` | A Struct has no such field |
| `unknown_case` | A variant has no such case |
| `unknown_function` | No builtin or `def` has the name |
| `type_mismatch` | An operand, argument or key has the wrong type |
| `not_iterable` | `.[]` or an array builtin on a value that is not a collection |
| `not_indexable` | `.[e]` on a value that is not an array, set, dict or struct |
| `arity` | A builtin or `def` called with the wrong number of arguments |
| `ambiguous_output` | Outputs, or array elements, of types with no common type |
| `cannot_infer` | A `reduce`, `foreach` or recursive `def` whose type does not converge |
| `unsupported` | An excluded builtin (§11), an async function, a tooling builtin outside tooling |

**Lints** are warnings:

- **`duplicate_outputs`**: `select(f)`, where `f` gives many values, emits
  its input once per match. The lint suggests `any(f; cond)`.

  ```jq
  [.orders[] | select(.lines[].sku == "BRK-100")]
  ```
  → warning `duplicate_outputs`. Fix: `[.orders[] | select(any(.lines[]; .sku == "BRK-100"))]`.

- **`array_builtin_on_element`**: an array builtin applied to each element of
  a stream, as in `to_entries[] | … | sort_by(…)`. It is really a
  `type_mismatch`; the message suggests wrapping the stream in `[…]`.

---

## 13. Deviations from jq 1.8

The complete list. Each deviation has a corpus case that cites its number here
(`deviation` in `test/query.corpus.ts`).

### 13.1 A missing Struct field is an error

`.x` on a Struct without `x` is `unknown_field`; `.x?` gives `null` (§4).

### 13.2 Dict keys have any East type, and `.[k]` is an index or a key by type

A Dict is an object whose keys have its key type, and `.[k]` indexes an array
or looks up a key according to the target's type (§4).

### 13.3 Integers are exact to 64 bits

Integer operations stay Integer, and `/` gives a Float (§6).

### 13.4 DateTime is a type

It compares with ISO-8601 literals parsed when the query is checked, and
`fromdateiso8601` accepts milliseconds and offsets (§7).

### 13.5 A program's outputs share one element type

Outputs unify to one type, or the program is `ambiguous_output` (§3).

### 13.6 Literal keys build Structs; computed keys build Dicts

`{a: 1}` is a Struct and `{("a"): 1}` a Dict (§5).

### 13.7 Host access and nondeterminism are excluded

The builtins of §11 are `unsupported`.

### 13.8 Regular expressions are East's

ECMAScript-style, not Oniguruma (§10).

### 13.9 `tostring` and `tojson` are East's

`tostring` prints a non-string as East text, and `tojson` uses East's JSON
codec.

### 13.10 Order is East's total order

`sort`, `group_by`, `unique`, `min`, `max` and `keys` order values as East
does (§11).

### 13.11 Function values are callable, and inspecting them is tooling

`call(f; …)` calls a function value; `signature`, `source`, `calls` and
`captures` are tooling-only (§9).

### 13.12 `keys_unsorted` on a Struct gives the declared field order

(§11)

---

## 14. Wire types

`src/query/types.ts`, exported from `@elaraai/east`. The python twins in
`east/query/types.py` build the same types. Struct fields are declared
alphabetically in both, as `FunctionManifestType`'s are, so each type encodes
to the same bytes in both languages. The corpus fixture's header holds every
wire type's type value as bytes, and `tests/test_query_types.py` compares
python's against them.

```ts
export const JqPatternType = RecursiveType(pattern => VariantType({          // as / reduce / foreach patterns
  array: ArrayType(pattern),                                                 // [$a, $b]
  object: ArrayType(StructType({ key: StringType, value: OptionType(pattern) })),   // {name: $n, $id}
  variable: StringType,                                                      // $x
}));

export const JqType = RecursiveType(jq => VariantType({
  alternative: StructType({ left: jq, right: jq }),                                  // a // b
  array: OptionType(jq),                                                             // [f], or [] with none
  binary: StructType({ left: jq, op: StringType, right: jq }),                       // + - * / % == != < <= > >= and or
  bind: StructType({ body: jq, patterns: ArrayType(JqPatternType), source: jq }),    // f as $p ?// $q | body
  break: StringType,                                                                 // break $name
  call: StructType({ args: ArrayType(jq), name: StringType }),                       // name(a; b)
  comma: StructType({ left: jq, right: jq }),                                        // a, b
  def: StructType({ body: jq, name: StringType, params: ArrayType(StringType), rest: jq }),
  descend: NullType,                                                                 // ..
  field: StructType({ name: StringType, optional: BooleanType, target: jq }),        // t.name, t.name?
  foreach: StructType({ extract: OptionType(jq), init: jq, pattern: JqPatternType, source: jq, update: jq }),
  format: StructType({ name: StringType, string: OptionType(jq) }),                  // @base64, @csv "…"
  identity: NullType,                                                                // .
  if: StructType({ branches: ArrayType(StructType({ condition: jq, then: jq })), otherwise: OptionType(jq) }),
  index: StructType({ index: jq, optional: BooleanType, target: jq }),               // t[e]: an index or a key, by type
  iterate: StructType({ optional: BooleanType, target: jq }),                        // t[], t[]?
  label: StructType({ body: jq, name: StringType }),                                 // label $name | body
  literal: BlobType,                                                                 // a self-describing beast2 constant
  negate: jq,                                                                        // -f
  object: ArrayType(StructType({ key: VariantType({ computed: jq, name: StringType, variable: StringType }), value: OptionType(jq) })),
  pipe: StructType({ left: jq, right: jq }),                                         // a | b
  reduce: StructType({ init: jq, pattern: JqPatternType, source: jq, update: jq }),
  slice: StructType({ from: OptionType(jq), optional: BooleanType, target: jq, to: OptionType(jq) }),
  string: ArrayType(VariantType({ interpolate: jq, text: StringType })),            // "a\(f)b"
  try: StructType({ body: jq, catch: OptionType(jq) }),                              // try f catch g; f? is try f
  update: StructType({ op: StringType, path: jq, value: jq }),                       // = |= += -= *= /= %= //=
  variable: StringType,                                                              // $x
}));

export const QueryMultiplicityType = VariantType({ many: NullType, maybe: NullType, one: NullType });

export const QueryV1Type = StructType({
  element_type: EastTypeType,     // the type of each output
  input_type: EastTypeType,       // the type the program was checked against
  multiplicity: QueryMultiplicityType,
  program: JqType,                // with the checker's rewrites applied
});
export const QueryType = VariantType({ v1: QueryV1Type });

export const QuerySpanType = StructType({ column: IntegerType, length: IntegerType, line: IntegerType, offset: IntegerType });
export const QueryEditType = StructType({ insert: StringType, length: IntegerType, offset: IntegerType });
export const QueryFixType = StructType({ edits: ArrayType(QueryEditType), label: StringType });
export const QueryErrorType = StructType({
  code: StringType,
  fixes: ArrayType(QueryFixType),
  message: StringType,
  severity: VariantType({ error: NullType, warning: NullType }),
  span: OptionType(QuerySpanType),
  suggestions: ArrayType(StringType),
});
export const QueryResultType = VariantType({ error: QueryErrorType, ok: BlobType });
```

**Why a checked query carries its types.** A runtime then never needs the
checker, and a client knows the result's shape before anything runs: the
result type follows from `element_type` and `multiplicity` (§3).

**Type values are numbered canonically.** `element_type` and `input_type` are
written with `canonicalTypeValue`: each recursive wrapper numbered in
pre-order from 0. A wrapper's id is otherwise an artefact of the process that
built the type, and the same query must encode to the same bytes in every
SDK.

**Literals carry their type.** A `literal` is a self-describing beast2 blob, so
`1001` is an Integer, `1001.0` a Float, and `"2026-09-01"` a String until the
checker parses it against a DateTime.

**Spans count UTF-16 code units**, the unit browsers and TypeScript index
strings in. `offset` is 0-based over the whole text; `line` and `column` are
1-based, and `column` counts code units of its line. The python front end
converts from code points, so a program holding a character outside the Basic
Multilingual Plane gets the same spans in both.

**A fix is text edits**, so every client applies it the same way. The query
editor turns the fixes it recognises into edits of its steps.

**The checker's rewrites**, so that no runtime parses text:

- an ISO string compared with a DateTime becomes a DateTime literal;
- a number literal takes its operand's type;
- a `strftime` or `strptime` format becomes a token array;
- a regular expression is validated;
- on an e3 root, `keys` and `has("name")` are answered from its type (§17).

**Evolution.** Operators, builtin names and error codes are strings. A
structural change is a new case of `QueryType`, sorting after `v1`, and every
reader accepts every released version. Inserting a case before an existing one
would renumber it, because a variant's cases are ordered by name.
(`PathSegmentType` in e3-types is the example: its `index`, `key` and `case`
are still marked "Future" because adding them would renumber its existing
cases.)

---

## 15. The runtime contract

Two builtins evaluate a checked query:

```ts
Query:        { type_parameters: ["T", "R"], inputs: ["T", QueryType], output: "R" },
QueryDynamic: { type_parameters: ["T"],      inputs: ["T", QueryType], output: QueryResultType },
```

**Runtimes evaluate; they do not check.**

- The query's `input_type` must equal `T`. That is one type comparison per
  query value, and a runtime caches it.
- For `Query`, the builder guarantees that `R` is the result type that
  `element_type` and `multiplicity` imply, and the runtime verifies it.
- The evaluator runs jq's stream semantics, calling the runtime's own
  builtins for the catalog (§10).
- **Every output is validated** against `element_type` before it is returned
  or encoded, and the multiplicity is enforced. A hand-built `QueryType` with
  the wrong types therefore gives an error, never a value of the wrong type.
  In east-c, a value of the wrong type could reach invalid memory.
- **Errors.** `Query` throws an East runtime error. `QueryDynamic` returns
  `error` for an input of the wrong type and for any evaluation error,
  `error/1` and errors thrown by a called function value included.
- **Encoding.** `QueryDynamic`'s `ok` is encoded exactly as
  `BlobEncodeBeast2` encodes.

**Implementations.**

- **TypeScript**: `src/query/eval.ts`, registered by
  `src/compile/builtins/query.ts`, with a prepared plan cached per query value
  in a `WeakMap`.
- **east-c**: `src/query/eval.c` and `src/builtins/query.c`, registered in
  `east_register_all_builtins`. A builtin's implementation takes no context,
  so the prepared plan is cached in a `_Thread_local` table keyed by the query
  value's identity and `T`.
- **python** evaluates through east-c; east-py implements no builtin in python.

**Paged inputs.** The evaluator does not load a lazy or paged collection
that it only iterates, indexes, slices, looks up by key or counts. In
TypeScript these are the lazy values of `openBeast2LazyFor` and
`BlobOpenBeast2`. In east-c, both builtins serve paged arguments
(`east_builtin_serves_paged`). `first(f)`, `limit(n; f)` and `label` /
`break` stop reading input as soon as they are satisfied, and `length` on an
unfiltered collection reads only its segment index.

---

## 16. Conformance

*To be written by #924*: the jq 1.8 test suites (`jq.test`, `man.test`,
`onig.test`, `optional.test`) run through the checker and the evaluators. This
section will count the cases that pass, those skipped because their inputs or
outputs are not typeable as East values, and those that differ by a deviation
of §13, and list the last by deviation.

---

## 17. e3 surfaces

*To be written by #932*: `e3 query`, `e3 dataset describe` and
`e3 dataset summarize`; the query route, its root, its limits and its
permission; evaluation on a runner with the datasets passed by reference;
`needs_platform`; and query plans on the engine (issue #875 §10).
