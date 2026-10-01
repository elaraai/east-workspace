# QUERY — typed jq over East values

**Normative.** This document says what a query means. Where an implementation
and this document disagree, the implementation is the bug. The design, its
motivation and the plan are issue #875.

A **query** is a jq 1.8 program run on an East value. Values and types are
East's, and every departure from jq 1.8 is deliberate and listed in §13.

A query's text is parsed and checked **once, in an SDK**, against the type of
its input. Checking gives a **checked query**: a `QueryType` value holding
the program as written, the input type, the type of each output and how many
outputs there are. That value is East's narrow waist for queries, as the
token array of a datetime format string is for `DateTime.printFormatted`. An
SDK translates a checked query to ordinary East IR, which every runtime runs
as it runs any program (§15). In code, a query is a call of the `Query`
builtin, which carries the program beside its translation and gives the
translation (§15.7), so no runtime reads query text or evaluates jq.

| Piece | Where |
|---|---|
| Wire types (§14) | `src/query/types.ts`; python twins in `east/query/types.py` |
| Lexer, parser, printer (§18) | `src/query/jq/` (#920) |
| Checker and builtin catalog (§10, §12) | `src/query/jq/` (#921) |
| Completions, descriptions, summaries (§19) | `src/query/jq/complete.ts`, `describe.ts`, `summary.ts` (#922) |
| Translator (§15) | `src/query/jq/translate.ts`, each builtin's rule in `translate-builtins.ts` (#923) |
| `East.jq`, `evaluateJq`, `QueryError` (§15) | `src/expr/query.ts`, `src/query/evaluate.ts` (#923) |
| Splitting over a dataset's pieces (§17.1) | `src/query/jq/split.ts` (#941) |
| The `Query` builtin (§15.7) | `src/builtins.ts`, `src/compile/builtins/query.ts`, `src/analyze.ts`; east-c `src/builtins/query.c`; printed by `src/codegen/printer.ts` (#1041) |
| Corpus | `test/query.corpus.ts`, generating `test/fixtures/query-corpus.beast2` |
| Shared fixture | `test/query.fixture.ts`, generating `test/fixtures/query-fixture.beast2` |
| Conformance (§16) | `test/jq-conformance/` and `test/query.conformance.spec.ts` (#924) |
| Constructs, paging on east-c (§16, §15.6) | `test/query.constructs.spec.ts`; `libs/east-c/packages/east-c/tests/test_query_paged.c` (#925) |
| Performance (§16.4) | `test/query-bench/`, run by `make query-bench` (#925) |
| The type matrix (§16.5) | `test/query-types/` and `test/query.types.spec.ts`, over `test/fixtures/query-types.json`, which `make query-types` writes (#987) |
| This document's examples | `test/query.doc.spec.ts` (#932) |

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
15. Translation
16. Conformance
17. Running a query
18. Grammar and canonical text
19. Completions, descriptions and summaries

---

## 1. The examples' data

Every example runs over the shared fixture, `queryFixture()` in
`test/query.fixture.ts`. It is the data the query editor's mock shows
(`libs/east-ui/docs/proposals/Query Editor Spec.html`, generated from seed
875), with two extra datasets whose keys are not strings. Its root is
`FixtureRoot`, and a query over it is checked as an e3 root (§15.6):

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
then the result's type, as a diagnostic prints a type (§12), and the
multiplicity. A query that does not check gives its diagnostic's message, and
its first suggestion; a lint, its message and the program its fix makes.
`test/query.doc.spec.ts` checks and runs every example, and holds it to what
is written here:

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
→ `ambiguous_output: Integer and String have no common type.` Suggestion:
`{id, customer_id}`.

**The multiplicity is the checker's.** A one query gives exactly one output.
A query is translated from the checker's own result (§15), so a hand-built
`QueryType` that claims other types or another multiplicity is checked again
before it runs, and refused.

---

## 4. Paths, indexing and keys

**Fields.** `.name` on a Struct reads the field. A name the Struct lacks is
`unknown_field`, with the field names closest by edit distance as suggestions.
`.name?` gives `null` instead: jq's leniency, but only when asked for.

```jq
.orders[0].customer
```
→ `unknown_field: .customer is not a field of Struct{customer_id: String, discount: Option<Float>, id: Integer, lines: Array<Struct{price: Float, qty: Integer, sku: String}>, status: Variant{cancelled, pending, shipped}, total: Float}. Did you mean .customer_id?`
Suggestion: `.customer_id`.

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
→ `.none` · Option<Struct{name: String, region: String, tier: Variant{gold, standard}}>, one

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
→ `.some (key=(region="NSW", week=1), value=1080.0)` · Option<Struct{key: Struct{region: String, week: Integer}, value: Float}>, one

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
1.8's path semantics, typed as §5 types construction, over the paths §15.5
lists (§13.23).

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
- **`%` truncates to integers**, as jq's does: `5.5 % 2` is `1.0`. With a Float
  operand it gives a Float: NaN when either side is NaN, and ±Infinity taken
  as the ends of the 64-bit range.
- **`*` repeats a string** by a number on either side, truncated:
  `"ab" * 2.7` is `"abab"`, and a negative count gives `null`.
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
→ `type_mismatch: == compares Option<Integer> with String.`

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
- `.value.date` on a variant where only some cases have `date` is `null` for
  the other cases, as in jq, so it is an `Option<DateTime>` and one output.
  Where a DateTime is needed (`year`, `strftime`, arithmetic) that is a
  `type_mismatch` whose fix, "Narrow first", puts
  `select(.status.type == "shipped") | ` before the read.
- After `select(.type == "shipped")`, or inside
  `if .type == "shipped" then … end`, the checker **narrows** the variant, and
  `.value.date` is exactly a DateTime. `and` narrows its right side by its
  left, an `elif` and `else` by the cases the earlier conditions ruled out,
  and a test through an Option narrows too.
- `type == "number"` narrows the same way: `select(type == "object")` keeps
  the struct and dict members of `..`, and a branch no member reaches is not
  checked.

```jq
first(.orders[]) | .status.type
```
→ `.some "shipped"` · Option<String>, maybe

```jq
.orders[0].status.value.date
```
→ `.some 2026-04-27T09:00:00.000` · Option<DateTime>, one (un-narrowed: only
the `shipped` case has a `date`, and the others give `null`)

```jq
.orders[] | select(.status.type == "shiped")
```
→ `unknown_case: .status has no case "shiped". Did you mean "shipped"?` Suggestion: `"shipped"`.

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
- **Platform dependencies.** A function value runs in the runtime that runs
  the query, compiled against that runtime's platform when the value is
  decoded. A value whose IR calls a platform function the runtime has not
  loaded fails, naming it (§17).
- **Inspection is tooling.** `signature`, `source`, `calls` and `captures`
  need the TypeScript IR printers. They are tooling-only builtins: the checker
  refuses them with `unsupported` unless the query is checked with `tooling`,
  and then the translator makes them calls of platform functions a host gives
  (§15.9), which no runtime provides yet (#875 §10.3).

---

## 10. Builtins

The catalog (`src/query/jq/catalog.ts`) holds exactly jq 1.8.1's builtins,
with their arities, and East's additions; `test/query.check.spec.ts` holds it
to `jq -n 'builtins'`. Each builtin a query may call has a typing rule and is
defined by existing East builtins or `East.<Type>` library functions: none is
reimplemented. The rest are refused with `unsupported`, saying why (§12).

- **Numbers.** Where a rule says "a number", Integer and Float both apply, and
  an Integer argument where a Float is needed is promoted.
- **Literal arguments.** A regular expression, its flags, a `strftime` /
  `strptime` format and a `datetime_add` unit are written in the query: the
  checker validates each and rewrites a format into its tokens (§14).
- **Options.** A builtin that needs a value refuses an `Option<T>` input with
  the fix "Skip nulls", which puts `values | ` before it (§13.16).
- **Streams.** A builtin that needs an array, on each element of a stream, is
  `array_builtin_on_element`, whose fix collects the stream (§12).
- **Regular expressions** are East's, ECMAScript-style (§13.8): `test`, `sub`
  and `gsub` take the flags `g` and `i`, and a replacement interpolates the
  pattern's named groups as `\(.name)`, which becomes `$<name>`.
- **`type`** gives `null`, `boolean`, `number`, `string`, `array`, `object`,
  and for East's own types `datetime`, `blob` and `function`.

A catalog name is a **string** in the wire type (§14), so adding one never
changes `QueryType`.

<!-- catalog: written by `make query-corpus` from src/query/jq/catalog.ts -->
| Builtin | Arities | Takes → gives | Outputs | East definition |
|---|---|---|---|---|
| `abs` | 0 | Integer → Integer; Float → Float; strings, arrays, objects as they are | one | IntegerAbs / FloatAbs; other values as they are |
| `add` | 0, 1 | Array<T> → T for numbers, strings, arrays and dicts (their identity when empty, §13.15), Option<T> for structs; `add(f)` over f's outputs | one | ArrayFold of the matching add builtin (adding nothing gives its identity, §13.15) |
| `all` | 0, 1, 2 | `all`, `all(f)`, `all(g; c)` → Boolean | one | a loop on jq's truthiness, stopping at the first false |
| `any` | 0, 1, 2 | `any`, `any(f)`, `any(g; c)` → Boolean | one | a loop on jq's truthiness, stopping at the first true |
| `arrays` | 0 | the input when it is an array; narrows | maybe | a type test |
| `ascii_downcase` | 0 | String → String (§13.18) | one | StringLowerCase |
| `ascii_upcase` | 0 | String → String (§13.18) | one | StringUpperCase |
| `@base64` | 0 | any → String | one | a Blob's bytes, or tostring's StringEncodeUtf8, then RFC 4648 over BlobGetUint8 |
| `booleans` | 0 | the input when it is a Boolean; narrows | maybe | a type test |
| `bsearch` | 1 | Array<T>, T → Integer | one | ArrayFindSortedFirst, with jq's −1 − insertion point when absent |
| `builtins` | 0 | → Array<String> | one | the catalog's names, as a literal |
| `call` | 1, 2, 3, 4, 5, 6, 7, 8 | `call(f; a…)`: Function([I…], O), arguments of I (Integer → Float) → O | one | a call of the function value |
| `calls` | 0 | a function value → Array<String> (tooling) | one | the host platform function jq_calls (tooling-only, §9) |
| `captures` | 0 | a function value → Array<String> (tooling) | one | the host platform function jq_captures (tooling-only, §9) |
| `ceil` | 0 | a number → Integer | one | East.Float.roundCeil |
| `combinations` | 0, 1 | Array<Array<T>> → Array<T>; `combinations(n)`: Array<T> → Array<T> | many | nested loops over the arrays |
| `contains` | 1 | two strings, arrays, structs or dicts, or equal values → Boolean | one | StringContains for strings; loops of it for arrays, structs and dicts; Equal for other values |
| `cos` | 0 | a number → Float | one | FloatCos |
| `@csv` | 0 | Array of scalars → String | one | ArrayStringJoin of the quoted cells |
| `datetime_add` | 2 | `datetime_add(n; unit)`: DateTime, Integer, a literal unit → DateTime | one | DateTimeAddMilliseconds of n units |
| `datetime_diff` | 2 | `datetime_diff(other; unit)`: DateTime, DateTime, a literal unit → Integer | one | DateTimeDurationMilliseconds in units, truncated |
| `day` | 0 | DateTime → Integer | one | DateTimeGetDayOfMonth |
| `del` | 1 | `del(p)` → the input without what `p` names; a struct loses the field | one | a rebuild without the positions the path names |
| `empty` | 0 | any → nothing | none | no output |
| `endswith` | 1 | String, String → Boolean | one | StringEndsWith |
| `epoch_ms` | 0 | DateTime → Integer | one | DateTimeToEpochMilliseconds |
| `error` | 0, 1 | any; `error(v)` of any type (§13.14) → a runtime error | none | an East error whose message is the value's East text (§13.14) |
| `exp` | 0 | a number → Float | one | FloatExp |
| `exp10` | 0 | a number → Float | one | FloatPow(10, x) |
| `exp2` | 0 | a number → Float | one | FloatPow(2, x) |
| `fabs` | 0 | a number → Float | one | FloatAbs |
| `finites` | 0 | a number, when finite | maybe | a type test and a comparison with ±Infinity |
| `first` | 0, 1 | Array<T> → Option<T>; `first(f)` → f's first output | one; maybe | ArrayTryGet(0); for first(f), the first output of f, then stop |
| `flatten` | 0, 1 | Array<Array<…T>> → Array<T>; `flatten(d)` d levels deep | one | ArrayFlattenToArray, depth times |
| `floor` | 0 | a number → Integer | one | East.Float.roundFloor |
| `fmax` | 2 | two numbers → Float | one | a comparison, as C's fmax |
| `fmin` | 2 | two numbers → Float | one | a comparison, as C's fmin |
| `fmod` | 2 | two numbers → Float | one | FloatRemainder |
| `format` | 1 | `format("name")` → as `@name` | one | the format of that name |
| `from_entries` | 0 | Array of `{key, value}` (or `k`, `name`, `v`, …) → Dict<K, V> | one | ArrayToDict by the entries' key and value |
| `fromdate` | 0 | String → DateTime (§13.4) | one | StringParseJSON as a DateTime: RFC 3339 with milliseconds and offsets (§13.4) |
| `fromdateiso8601` | 0 | String → DateTime (§13.4) | one | StringParseJSON as a DateTime: RFC 3339 with milliseconds and offsets (§13.4) |
| `group_by` | 1 | `group_by(f)`: Array<T> → Array<Array<T>>, in key order | one | ArrayGroupFold by the key, in key order |
| `gsub` | 2, 3 | String, a literal regex, a replacement of text and named groups `\(.name)` → String | one | RegexReplace, captures as $<name> |
| `has` | 1 | `has(k)` → Boolean: a Dict's key of its key type, a struct's field name, an array's index | one | DictHas, the struct's field names, ArraySize |
| `hour` | 0 | DateTime → Integer | one | DateTimeGetHour |
| `@html` | 0 | any → String, HTML-escaped | one | tostring, then StringReplace of < > & ' " |
| `IN` | 1, 2 | `IN(s)`, `IN(src; s)` → Boolean | one | Equal against each output, stopping at the first match |
| `in` | 1 | `in(o)` → `o \| has(.)` | one | has, on the argument |
| `INDEX` | 1, 2 | `INDEX(f)`: Array<T> → Dict<K, T> for f's key K; `INDEX(src; f)` | one | ArrayToDict keyed by the index filter (keys keep their type, §13.2) |
| `index` | 1 | String, String → Option<Integer>; Array<T> and a T or an Array<T> → Option<Integer> | one | StringIndexOf (strings); Equal in a loop (arrays) |
| `indices` | 1 | String, String → Array<Integer>; Array<T> and a T or an Array<T> → Array<Integer> | one | StringIndexOf in a loop (strings); Equal in a loop (arrays) |
| `infinite` | 0 | → Float | one | the Float Infinity |
| `inside` | 1 | two strings, arrays, structs or dicts, or equal values → Boolean | one | contains, the other way round |
| `isempty` | 1 | `isempty(f)` → Boolean | one | whether f gives no output, stopping at the first |
| `isfinite` | 0 | a number → Boolean | one | FloatAbs and comparisons |
| `isinfinite` | 0 | a number → Boolean | one | FloatAbs and comparisons |
| `isnan` | 0 | a number → Boolean | one | FloatAbs and comparisons |
| `isnormal` | 0 | a number → Boolean | one | FloatAbs and comparisons |
| `iterables` | 0 | the input when it is an array, struct or dict; narrows | maybe | a type test |
| `join` | 1 | Array of strings, numbers, booleans or nulls; String → String | one | ArrayStringJoin of the elements as text (null as "") |
| `@json` | 0 | any → String, as `tojson` | one | StringPrintJSON |
| `keys` | 0 | Dict<K, V> → Array<K>; a struct's field names, sorted; an array's indices | one | DictKeys, the struct's field names sorted, the indices |
| `keys_unsorted` | 0 | as `keys`, with a struct's fields in declared order (§13.12) | one | DictKeys, the struct's field names in declared order (§13.12), the indices |
| `last` | 0, 1 | Array<T> → Option<T>; `last(f)` → f's last output | one; maybe | ArrayTryGet(size − 1); for last(f), the last output of f |
| `length` | 0 | String, Array, Set, Dict, Blob → Integer; a struct's field count; a number's absolute value; null → 0 | one | StringLength, ArraySize, SetSize, DictSize, BlobSize, the field count, abs |
| `limit` | 2 | `limit(n; f)` → f's first n outputs | as `f`'s | the first n outputs of f, then stop |
| `log` | 0 | a number → Float | one | FloatLog |
| `log10` | 0 | a number → Float | one | FloatLog / FloatLog(10) |
| `log2` | 0 | a number → Float | one | FloatLog / FloatLog(2) |
| `ltrim` | 0 | String → String | one | StringTrimStart |
| `ltrimstr` | 1 | String, String → String | one | StringStartsWith / StringEndsWith and StringSubstring |
| `map` | 1 | `map(f)`: Array<T>, Set<T>, or a Dict's or struct's values → Array of f's outputs | one | ArrayMap / SetToArray / DictToArray of f (f's outputs collected) |
| `map_values` | 1 | `map_values(f)`: Array, Dict or struct → the same with f's first output in each place | one | ArrayMap / DictMap / the struct rebuilt field by field, with f's first output |
| `max` | 0 | Array<T> → Option<T> | one | ArrayFold keeping the greatest (null for an empty array) |
| `max_by` | 1 | `max_by(f)`: Array<T> → Option<T> | one | ArrayFold by the key f gives |
| `millisecond` | 0 | DateTime → Integer | one | DateTimeGetMillisecond |
| `min` | 0 | Array<T> → Option<T> | one | ArrayFold keeping the least (null for an empty array) |
| `min_by` | 1 | `min_by(f)`: Array<T> → Option<T> | one | ArrayFold by the key f gives |
| `minute` | 0 | DateTime → Integer | one | DateTimeGetMinute |
| `month` | 0 | DateTime → Integer | one | DateTimeGetMonth |
| `nan` | 0 | → Float | one | the Float NaN |
| `normals` | 0 | a number, when normal | maybe | a type test and FloatAbs ≥ 2⁻¹⁰²² |
| `not` | 0 | any → Boolean, by jq's truthiness | one | BooleanNot of jq's truthiness |
| `nth` | 1, 2 | `nth(n)`: Array<T> → Option<T>; `nth(n; f)` → f's nth output | one; maybe | ArrayTryGet(n); for nth(n; f), the nth output of f |
| `nulls` | 0 | the input when it is null; narrows | maybe | a type test |
| `numbers` | 0 | the input when it is a number; narrows | maybe | a type test |
| `objects` | 0 | the input when it is a struct, dict or variant; narrows | maybe | a type test |
| `pick` | 1 | `pick(.a.b)` → Struct{a: Struct{b: T}} | one | a struct of the picked fields |
| `pow` | 2 | two numbers → Float | one | FloatPow |
| `range` | 1, 2, 3 | Integer bounds → Integer; a Float bound → Float | many | ArrayRange, or a Float loop, streamed |
| `recurse` | 0, 1, 2 | every value nested in the input; `recurse(f[; c])` → the input, then f again, of the one type a fixpoint settles on | many | a depth-first walk with an explicit stack |
| `repeat` | 1 | `repeat(f)` → the input, f of it, and so on | many | a loop: the value, then f of it, and so on |
| `reverse` | 0 | Array<T> → Array<T>; String → String; null → [] | one | ArrayReverse; a string's code points reversed |
| `rindex` | 1 | String, String → Option<Integer>; Array<T> and a T or an Array<T> → Option<Integer> | one | StringIndexOf in a loop (strings); Equal in a loop (arrays) |
| `round` | 0 | a number → Integer | one | East.Float.roundHalf |
| `rtrim` | 0 | String → String | one | StringTrimEnd |
| `rtrimstr` | 1 | String, String → String | one | StringStartsWith / StringEndsWith and StringSubstring |
| `scalars` | 0 | the input when it is not an array, struct or dict; narrows | maybe | a type test |
| `second` | 0 | DateTime → Integer | one | DateTimeGetSecond |
| `select` | 1 | `select(f)` → its input, narrowed by what `f` proves | maybe; many when `f` is | a branch on jq's truthiness |
| `@sh` | 0 | a scalar or an array of scalars → String | one | StringReplace of ' and ArrayStringJoin |
| `signature` | 0 | a function value → String (tooling) | one | the host platform function jq_signature (tooling-only, §9) |
| `sin` | 0 | a number → Float | one | FloatSin |
| `skip` | 2 | `skip(n; f)` → f's outputs after the first n | as `f`'s | the outputs of f after the first n |
| `sort` | 0 | Array<T> → Array<T> | one | ArraySort by the value (East's total order, §11) |
| `sort_by` | 1 | `sort_by(f)`: Array<T>, f giving an ordered key → Array<T> | one | ArraySort by the key f gives |
| `source` | 0 | a function value → String (tooling) | one | the host platform function jq_source (tooling-only, §9) |
| `split` | 1, 2 | `split(s)`: String → Array<String> | one | StringSplit (a literal separator) |
| `sqrt` | 0 | a number → Float | one | FloatSqrt |
| `startswith` | 1 | String, String → Boolean | one | StringStartsWith |
| `strftime` | 1 | DateTime or epoch seconds, a literal format → String | one | DateTimePrintFormat with the format's tokens, made when the query is checked |
| `strings` | 0 | the input when it is a String; narrows | maybe | a type test |
| `strptime` | 1 | String, a literal format → DateTime (§13.4) | one | DateTimeParseFormat with the format's tokens (gives a DateTime, §13.4) |
| `sub` | 2, 3 | String, a literal regex, a replacement of text and named groups `\(.name)` → String | one | RegexReplace of ^([\s\S]*?)(?:re), captures as $<name> |
| `tan` | 0 | a number → Float | one | FloatTan |
| `test` | 1, 2 | String, a literal regex, flags `g` `i` → Boolean | one | RegexContains |
| `@text` | 0 | any → String, as `tostring` | one | tostring |
| `to_entries` | 0 | Dict<K, V> → Array<Struct{key: K, value: V}>; a struct's fields, keyed by name; an array's elements, by index | one | DictToArray / the struct's fields as {key, value} |
| `toboolean` | 0 | String or Boolean → Boolean | one | Parse as a Boolean; booleans as they are |
| `todate` | 0 | DateTime or epoch seconds → String, RFC 3339 | one | DateTimePrintFormat as RFC 3339 (East JSON's form); epoch seconds via DateTimeFromEpochMilliseconds |
| `todateiso8601` | 0 | DateTime or epoch seconds → String, RFC 3339 | one | DateTimePrintFormat as RFC 3339 (East JSON's form); epoch seconds via DateTimeFromEpochMilliseconds |
| `tojson` | 0 | any → String, East's JSON (§13.9) | one | StringPrintJSON (East's JSON codec, §13.9) |
| `tonumber` | 0 | String → Float (§13.19); a number as it is | one | Parse as a Float; numbers as they are |
| `tostring` | 0 | any → String: a string as it is, anything else as East text (§13.9) | one | the string, or Print (East text, §13.9) |
| `transpose` | 0 | Array<Array<T>> → Array<Array<Option<T>>> | one | nested loops, padding short rows with null |
| `trim` | 0 | String → String | one | StringTrim |
| `trimstr` | 1 | String, String → String | one | StringStartsWith / StringEndsWith and StringSubstring |
| `trunc` | 0 | a number → Integer | one | East.Float.roundTrunc |
| `@tsv` | 0 | Array of scalars → String | one | ArrayStringJoin of the quoted cells |
| `type` | 0 | any → String: `null`, `boolean`, `number`, `string`, `array`, `object`, `datetime`, `blob` or `function`; `type == "…"` narrows | one | the jq type name of the value's East type, as a literal or by the option's case (§2) |
| `unique` | 0 | Array<T> → Array<T>, sorted | one | ArrayToSet, as an array |
| `unique_by` | 1 | `unique_by(f)`: Array<T> → Array<T> | one | ArrayToDict by the key by the key f gives |
| `until` | 2 | `until(c; u)` → u applied until c holds, of one type by fixpoint | one | a loop: update while cond is false |
| `@uri` | 0 | any → String, percent-encoded | one | tostring, then each code point kept or percent-encoded from StringEncodeUtf8 |
| `utf8bytelength` | 0 | String → Integer | one | BlobSize of StringEncodeUtf8 |
| `values` | 0 | the input when it is not null: Option<T> → T | maybe | a type test |
| `walk` | 1 | any → rebuilt bottom-up with `f`, which gives one output of a type each value's place can hold | one | a bottom-up rebuild, applying f to each value |
| `weekday` | 0 | DateTime → Integer | one | DateTimeGetDayOfWeek |
| `while` | 2 | `while(c; u)` → each value while c holds, of one type by fixpoint | many | a loop: each value while cond holds |
| `with_entries` | 1 | `to_entries \| map(f) \| from_entries` | one | to_entries, map(f), from_entries |
| `year` | 0 | DateTime → Integer | one | DateTimeGetYear |

Refused, with the diagnostic's reason (§12):

| Builtin | Arities | Why |
|---|---|---|
| `acos` | 0 | unavailable: East has no builtin for it |
| `acosh` | 0 | unavailable: East has no builtin for it |
| `asin` | 0 | unavailable: East has no builtin for it |
| `asinh` | 0 | unavailable: East has no builtin for it |
| `atan` | 0 | unavailable: East has no builtin for it |
| `atan2` | 2 | unavailable: East has no builtin for it |
| `atanh` | 0 | unavailable: East has no builtin for it |
| `@base64d` | 0 | unavailable: no East builtin makes a Blob from bytes |
| `capture` | 1, 2 | unavailable: East regular expressions have no capture groups (§13.8) |
| `cbrt` | 0 | unavailable: East has no builtin for it |
| `copysign` | 2 | unavailable: East has no builtin for it |
| `cosh` | 0 | unavailable: East has no builtin for it |
| `debug` | 0, 1 | excluded (§11, §13.7) |
| `delpaths` | 1 | unavailable: a path array mixes strings and integers, which no one East type holds; write the path as field reads and indexes, .a.b[0] |
| `drem` | 2 | unavailable: East has no builtin for it |
| `env` | 0 | excluded (§11, §13.7) |
| `erf` | 0 | unavailable: East has no builtin for it |
| `erfc` | 0 | unavailable: East has no builtin for it |
| `explode` | 0 | unavailable: East has no builtin between a string and its code points |
| `expm1` | 0 | unavailable: East has no builtin for it |
| `fdim` | 2 | unavailable: East has no builtin for it |
| `fma` | 3 | unavailable: East has no builtin for it |
| `frexp` | 0 | unavailable: East has no builtin for it |
| `fromjson` | 0 | unavailable: its result has no static type; parse into a known type in the program that runs the query |
| `fromstream` | 1 | unavailable: a path array mixes strings and integers, which no one East type holds |
| `gamma` | 0 | unavailable: East has no builtin for it |
| `get_jq_origin` | 0 | excluded (§11, §13.7) |
| `get_prog_origin` | 0 | excluded (§11, §13.7) |
| `get_search_list` | 0 | excluded (§11, §13.7) |
| `getpath` | 1 | unavailable: a path array mixes strings and integers, which no one East type holds; write the path as field reads and indexes, .a.b[0] |
| `gmtime` | 0 | not yet |
| `halt` | 0 | excluded (§11, §13.7) |
| `halt_error` | 0, 1 | excluded (§11, §13.7) |
| `have_decnum` | 0 | unavailable: it describes jq's build, not the data |
| `have_literal_numbers` | 0 | unavailable: it describes jq's build, not the data |
| `hypot` | 2 | unavailable: East has no builtin for it |
| `implode` | 0 | unavailable: East has no builtin between a string and its code points |
| `input` | 0 | excluded (§11, §13.7) |
| `input_filename` | 0 | excluded (§11, §13.7) |
| `input_line_number` | 0 | excluded (§11, §13.7) |
| `inputs` | 0 | excluded (§11, §13.7) |
| `j0` | 0 | unavailable: East has no builtin for it |
| `j1` | 0 | unavailable: East has no builtin for it |
| `jn` | 2 | unavailable: East has no builtin for it |
| `JOIN` | 2, 3, 4 | unavailable: its pairs [row, match] hold two types, which one East array cannot |
| `ldexp` | 2 | unavailable: East has no builtin for it |
| `lgamma` | 0 | unavailable: East has no builtin for it |
| `lgamma_r` | 0 | unavailable: East has no builtin for it |
| `localtime` | 0 | excluded (§11, §13.7) |
| `log1p` | 0 | unavailable: East has no builtin for it |
| `logb` | 0 | unavailable: East has no builtin for it |
| `match` | 1, 2 | unavailable: East regular expressions have no capture groups (§13.8) |
| `mktime` | 0 | not yet |
| `modf` | 0 | unavailable: East has no builtin for it |
| `modulemeta` | 0 | excluded (§11, §13.7) |
| `nearbyint` | 0 | unavailable: East has no builtin for it |
| `nextafter` | 2 | unavailable: East has no builtin for it |
| `nexttoward` | 2 | unavailable: East has no builtin for it |
| `now` | 0 | excluded (§11, §13.7) |
| `path` | 1 | unavailable: a path array mixes strings and integers, which no one East type holds |
| `paths` | 0, 1 | unavailable: a path array mixes strings and integers, which no one East type holds |
| `remainder` | 2 | unavailable: East has no builtin for it |
| `rint` | 0 | unavailable: East has no builtin for it |
| `scalb` | 2 | unavailable: East has no builtin for it |
| `scalbln` | 2 | unavailable: East has no builtin for it |
| `scan` | 1, 2 | unavailable: East regular expressions have no capture groups (§13.8) |
| `setpath` | 2 | unavailable: a path array mixes strings and integers, which no one East type holds; write the path as field reads and indexes, .a.b[0] |
| `significand` | 0 | unavailable: East has no builtin for it |
| `sinh` | 0 | unavailable: East has no builtin for it |
| `splits` | 1, 2 | unavailable: East regular expressions have no regex split |
| `stderr` | 0 | excluded (§11, §13.7) |
| `strflocaltime` | 1 | excluded (§11, §13.7) |
| `tanh` | 0 | unavailable: East has no builtin for it |
| `tgamma` | 0 | unavailable: East has no builtin for it |
| `tostream` | 0 | unavailable: a path array mixes strings and integers, which no one East type holds |
| `truncate_stream` | 1 | unavailable: a path array mixes strings and integers, which no one East type holds |
| `@urid` | 0 | unavailable: no East builtin makes a Blob from bytes |
| `y0` | 0 | unavailable: East has no builtin for it |
| `y1` | 0 | unavailable: East has no builtin for it |
| `yn` | 2 | unavailable: East has no builtin for it |
<!-- /catalog -->

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
| `unsupported` | An excluded builtin (§11), an async function, a tooling builtin outside tooling, a builtin East cannot define (§13.17) |
| `array_builtin_on_element` | An array builtin run on each element of a stream, as in `to_entries[] \| … \| sort_by(…)`: an error, since its input has the wrong type; the fix collects the stream |

**Lints** are warnings; the program still checks:

- **`duplicate_outputs`**: `select(f)`, where `f` gives many values, emits
  its input once per match. The fix tests the generator with `any`.

  ```jq
  [.orders[] | select(.lines[].sku == "BRK-100")]
  ```
  → warning `duplicate_outputs: select(.lines[] | …) emits the row once per matching element. Use any(.lines[]; …).`
  Fix: `[.orders[] | select(any(.lines[]; .sku == "BRK-100"))]`.

- **`duplicate_key`**: an object sets the same key twice; the last wins.
- **`never_missing`**: `//=` on a value that is never null changes nothing.
- **`long_range`**: a `range` of literals gives more values than a query
  returns by default (1 000).

**Fixes** are text edits, and the query editor turns them into edits of its
steps (#933):

| Diagnostic | Fix | Edit |
|---|---|---|
| `unknown_field`, `unknown_case`, `ambiguous_output` of fields side by side | "Use {suggestion}" | replaces the span with the first suggestion (`{id, customer_id}` for `.id, .customer_id`) |
| a payload field read un-narrowed where its value is needed | "Narrow first" | puts `select(.F.type == "c") \| ` before the read (inside `map(` when the read is), or splits `.a[].F.value.x` at its `[]` |
| a whole variant compared with a string | "Use .type" | appends `.type` |
| an `Option<T>` where a value is needed | "Skip nulls" | puts `values \| ` before the builtin |
| `.[]` on an `Option` | "Use {form}?" | appends `?` |
| `array_builtin_on_element` | "Collect {stream} first" | wraps the pipe segments from the stream to the builtin in `[…]` |
| `duplicate_outputs` | "Use any({generator}; …)" | rewrites `select(.x[] \| c)` and `select(.x[].y == v)` as `select(any(.x[]; …))` |

**The templates.** Every sentence the checker says, from `messages.ts`, with
`{placeholders}` for what varies; the python twin says the same (#926). A type
prints as `describeType` prints it: `Integer`, `Option<Float>`,
`Array<String>`, `Dict<String, Float>`, `Struct{id: Integer, total: Float}`
(six fields, then `…`; two levels, then `Struct{…}`), `Variant{a, b}`. `a`
before a type is `an` before a vowel.

<!-- messages: written by `make query-corpus` from src/query/jq/messages.ts -->
| Code | Message |
|---|---|
| `unknown_field` | unknown_field: {.name} is not a field of {T}. |
| `unknown_field` | unknown_field: {.name} is not a field of {T}. Did you mean {.suggestion}? |
| `unknown_field` | unknown_field: {.name} is not a dataset in this workspace. |
| `unknown_field` | unknown_field: {.name} is not a dataset in this workspace. Did you mean {.suggestion}? |
| `unknown_field` | unknown_field: {.name} is not a field of any case of this variant. |
| `unknown_field` | unknown_field: {.name} is not a field of any case of this variant. Did you mean {.suggestion}? |
| `unknown_field` | unknown_field: {.name} is not a field of {path}: a variant reads as {type, value}. |
| `unknown_case` | unknown_case: {path} has no case {"case"}; its cases are {a}, {b} and {c}. |
| `unknown_case` | unknown_case: {path} has no case {"case"}. Did you mean {"suggestion"}? |
| `unknown_case` | unknown_case: type gives "{a}", "{b}" and "{c}", never {"name"}. |
| `unknown_case` | unknown_case: type never gives {"name"}. Did you mean {"suggestion"}? |
| `unknown_function` | unknown_function: {name}/{arity} is not a builtin or a def. |
| `unknown_function` | unknown_function: {name}/{arity} is not a builtin or a def. Did you mean {suggestion}? |
| `unknown_function` | unknown_function: ${name} is not bound here. |
| `unknown_function` | unknown_function: there is no label ${name} around this break. |
| `arity` | arity: {name} takes 1 argument, not {n}. |
| `arity` | arity: {name} takes {a} and {b} arguments, not {n}. |
| `type_mismatch` | type_mismatch: {.name} reads a field, but its input is {T}. |
| `not_iterable` | not_iterable: {form} needs an array; its input is {T}. |
| `not_iterable` | not_iterable: {form} needs an array; its input is {T}. Use {form}? to skip null. |
| `not_indexable` | not_indexable: {target} is {T}. |
| `type_mismatch` | type_mismatch: {form} needs {a\|an} {K} key; {key} is {T}. |
| `type_mismatch` | type_mismatch: {key} is {T}, and a dict's keys must be immutable. |
| `type_mismatch` | type_mismatch: .[a:b] needs Integer bounds, got {T}. |
| `type_mismatch` | type_mismatch: {form} is updated with an array, not {T}. |
| `type_mismatch` | type_mismatch: {form} cannot update part of a string; update the whole string. |
| `unsupported` | unsupported: {key} gives more or fewer than one value; an update's keys and bounds give one each. |
| `type_mismatch` | type_mismatch: an update through {path} keeps each value's type, but here {A} would become {B}. |
| `type_mismatch` | type_mismatch: {form} on a struct needs a literal field name; a computed name needs a dict. |
| `type_mismatch` | type_mismatch: {op} compares {L} with {R}. |
| `type_mismatch` | type_mismatch: Integer == Float is never true here. |
| `type_mismatch` | type_mismatch: Integer != Float is always true here. |
| `type_mismatch` | type_mismatch: {L} {op} {R} is not defined. |
| `type_mismatch` | type_mismatch: - negates a number, not {T}. |
| `type_mismatch` | type_mismatch: {.F} is {T}; variants read as {type, value} — compare {.F}.type with a case name. |
| `type_mismatch` | type_mismatch: {path} is {T} here — only the "{case}" case of {.F} has {field}. Narrow first with select({.F}.type == "{case}"). |
| `type_mismatch` | type_mismatch: {name} needs {what}; its input is {T}. |
| `type_mismatch` | type_mismatch: {name} needs a string; its input is DateTime. Compare its parts (year == 2026 and month == 9), or its text (todate \| {name}(…)). |
| `type_mismatch` | type_mismatch: {name}'s {nth} argument must be {what}, not {T}. |
| `type_mismatch` | type_mismatch: {name} takes an array as a run of elements, which must be {E}, not {T}. To find one element, wrap it: {wrapped}. |
| `type_mismatch` | type_mismatch: {name}'s {nth} argument must be {what}, written in the query. |
| `type_mismatch` | type_mismatch: {"text"} is not an ISO-8601 date — DateTime literals are parsed at check time. |
| `type_mismatch` | type_mismatch: {range(…)} yields nothing. |
| `type_mismatch` | type_mismatch: {"pattern"} is not an East regular expression: {reason}. |
| `type_mismatch` | type_mismatch: {name}'s replacement can interpolate only the pattern's named groups, as \(.name). |
| `ambiguous_output` | ambiguous_output: {del(…)} leaves values of different types where one type must hold them all. |
| `type_mismatch` | type_mismatch: an object's keys are all written as names, or all computed — a struct or a dict, not both. |
| `ambiguous_output` | ambiguous_output: {A} and {B} have no common type. |
| `cannot_infer` | cannot_infer: the accumulator of this {reduce\|foreach\|…} is {A}, then {B}; start it with a value of the final type. |
| `cannot_infer` | cannot_infer: {name} does not settle on one type for this input. Use recurse, while or until. |
| `unsupported` | unsupported: {name} is excluded — queries are deterministic and have no host access. |
| `unsupported` | unsupported: {name} is not available in queries: {reason}. |
| `unsupported` | unsupported: {name} is not available in queries yet. |
| `unsupported` | unsupported: {name} is tooling: it needs the TypeScript IR printers, which queries do not have yet. |
| `unsupported` | unsupported: reading the whole root loads every dataset — name them: .{a}, .{b}. |
| `unsupported` | unsupported: reading the whole root loads every dataset — name them: .{a}, .{b}, .{c}, …. |
| `unsupported` | unsupported: call cannot run an async function. |
| `unsupported` | unsupported: {name} calls itself and takes a filter parameter. Use recurse, while or until. |
| `unsupported` | unsupported: regex flag "{flag}" — East regular expressions take the flags g and i. |
| `unsupported` | unsupported: %{code} — strftime and strptime take %Y %m %d %H %M %S %b %B %a %A %F %T and %%. |
| `duplicate_outputs` | duplicate_outputs: select({generator} \| …) emits the row once per matching element. Use any({generator}; …). |
| `array_builtin_on_element` | array_builtin_on_element: {name} needs an array, but runs here on each element of {stream}, which is {T}. Collect the stream first: [{…}]. |
| `duplicate_key` | duplicate_key: {"key"} is set twice in this object; the last one wins. |
| `never_missing` | never_missing: {path} is {T}, never null, so //= changes nothing. |
| `long_range` | long_range: {range(…)} gives {count} values; a query returns 1 000 at most by default. |
<!-- /messages -->

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

Integer operations stay Integer, and `/` gives a Float (§6). They are exact
to 64 bits, and wrap past them as East's Integer builtins do, where jq
computes with doubles: `9007199254740993 + 1` is `9007199254740994`, where jq
gives `9007199254740992`, and `9223372036854775807 + 1` is
`-9223372036854775808`. `length` of −2⁶³ is itself.

### 13.4 DateTime is a type

It compares with ISO-8601 literals parsed when the query is checked, and
`fromdateiso8601` accepts milliseconds and offsets (§7). `fromdate`,
`fromdateiso8601` and `strptime` give a DateTime, not epoch seconds or jq's
broken-down time, which `strftime` does not take either, and `gmtime` and
`mktime`, which work on it, are not yet available; `todate` writes East's RFC
3339 form (`2026-04-27T09:00:00.000+00:00`, not jq's `2026-04-27T09:00:00Z`);
`strftime` and `strptime` take a format written in the query, with `%Y %m %d
%H %M %S %b %B %a %A %F %T` and `%%`; and a string builtin on a DateTime is a
`type_mismatch` that names `todate` and the parts.

### 13.5 A program's outputs share one element type

Outputs unify to one type, or the program is `ambiguous_output` (§3).

### 13.6 Literal keys build Structs; computed keys build Dicts

`{a: 1}` is a Struct and `{("a"): 1}` a Dict (§5), and an object has one kind
of key: `{a, (.k): 1}` is refused. A Struct's field is read by its name, and
`.[e]` with a computed name needs a Dict (§4).

### 13.7 Host access and nondeterminism are excluded

The builtins of §11 are `unsupported`.

### 13.8 Regular expressions are East's

ECMAScript-style, not Oniguruma (§10), with the flags `g` and `i`. East's
regular expressions have no capture groups, so `match`, `capture`, `scan`,
`splits` and `split/2` are unavailable, and a `sub` / `gsub` replacement
interpolates only the pattern's named groups.

### 13.9 `tostring` and `tojson` are East's

`tostring` prints a non-string as East text, and so do string interpolation,
`@text`, `@html`, `@uri` and `@base64`, which jq defines by it (a Blob's
`@base64` encodes its bytes, §2): a whole Float prints as `3.0`, where jq
prints `3`. `tojson` and `@json` use East's JSON codec, which writes an
Integer as a string (`"5"`). `join`, `@csv`, `@tsv` and `@sh` print a number
as jq 1.8 prints one it computed: `3`, `2.5`, `1e-05`, `1e+17`, −0.0 as `-0`,
±Infinity as `±1.7976931348623157e+308`, and NaN as `null` (`join`, `@sh`) or
nothing (`@csv`, `@tsv`). jq prints a number it read from its input as the
input wrote it (`1E+300`), which East, whose numbers are values, does not.

### 13.10 Order is East's total order

`sort`, `group_by`, `unique`, `min`, `max`, `bsearch` and `keys` order values
as East does (§11), and `==` compares them as East does:

- NaN is the greatest number, where jq orders it below every number:
  `[1.0, nan] | sort` keeps NaN last, and jq puts it first.
- NaN equals itself (`nan == nan` is true, and `unique` keeps one NaN), where
  jq's NaN equals nothing.
- −0.0 is a value of its own, below 0.0 and not equal to it (`-0.0 < 0` is
  true, and `unique` keeps both), where jq's zeros are one number; and `-.`
  on 0.0 is −0.0, where jq keeps or drops a zero's sign as the number was
  written.

### 13.11 Function values are callable, and inspecting them is tooling

`call(f; …)` calls a function value; `signature`, `source`, `calls` and
`captures` are tooling-only (§9).

### 13.12 `keys_unsorted` on a Struct gives the declared field order

(§11)

### 13.13 A recursive `def` with a filter parameter is unsupported

A `def` that calls itself and takes a filter parameter (`def f(g): …, f(g)`)
is `unsupported`, suggesting `recurse`, `while` or `until`. One with value
parameters only is inferred by a fixpoint (§5).

### 13.14 `error(v)` takes any type, and its message is `v`'s East text

`try error(v) catch .` gives `v` printed as East text, a String.

### 13.15 `add` of no values of a type with an identity gives the identity

`add` on an empty array of numbers, strings, arrays or dicts gives `0`, `0.0`,
`""`, `[]` or `{}`, where jq gives `null`: its type is the element type. With
no identity (structs) it is an `Option`. `[] | add`, whose elements have no
type, is `null`.

### 13.16 A value that can be null is checked where a value is needed

jq raises an error at run time when a builtin that needs a value meets `null`.
The checker refuses an `Option<T>` there when the query is checked, with the
fixes "Skip nulls" (`values | `), "Use .x[]?" and "Narrow first" (§12). `+`,
`//`, `length`, comparisons and field reads take `null`, as in jq.

### 13.17 Builtins East cannot define are unavailable

A builtin with no definition by East's builtins is `unsupported`, saying why
(§10): the path builtins (`path`, `paths`, `getpath`, `setpath`, `delpaths`,
`tostream`, `fromstream`, `truncate_stream`), whose path arrays mix strings
and integers; `JOIN`, whose pairs mix two types; `fromjson`, whose result has
no static type; `implode`, `explode`, `@base64d` and `@urid`; the capture
builtins (§13.8); `have_decnum` and `have_literal_numbers`; and the math
builtins East's Float lacks (`atan`, `cbrt`, `gamma`, …). `builtins` lists
those a query may call, each arity once: 158 names where jq 1.8.1 lists 226.

### 13.18 `ascii_downcase`, `ascii_upcase` and the trims are East's string builtins

`ascii_downcase` and `ascii_upcase` are East's `StringLowerCase` and
`StringUpperCase`, so `"À"` becomes `"à"` too. `trim`, `ltrim` and `rtrim` are
`StringTrim`, `StringTrimStart` and `StringTrimEnd`, which remove JavaScript's
whitespace in every runtime: U+FEFF too, and not U+0085, which jq's (Unicode's
White_Space) removes.

### 13.19 `tonumber` on a string gives a Float

`"12" | tonumber` is `12.0`; a number is returned as it is.

### 13.20 `repeat(f)` gives its input, then `f` of it, and so on

`repeat(f)` is `def repeat(f): def r: ., (f | r); r;`, as the jq manual
describes it: `1 | repeat(. * 2)` gives 1, 2, 4, 8, … jq 1.8.1 gives `f` of the
input every time (2, 2, 2, …).

### 13.21 `reverse` reverses a string

`"abc" | reverse` is `"cba"`, by code points, as jq 1.7 defines it. jq 1.8.1
raises an error.

### 13.22 A variant is not iterable

A variant reads as `{type, value}` (§8), but `.[]` on one is `not_iterable`,
and `iterables` drops it: read `.type` and `.value`.

### 13.23 Paths are a subset of jq's, and keep types

An update's path is made of field reads, indexes, slices, `.[]`, a variant's
`.value`, `select`, the type selectors (`numbers`, `strings`, …), `empty`,
`..`, `recurse`, `recurse(.a[])` and `|` (§15.5). `,`, `if`, `//`,
`first(f)`, `map(f)`, an `as` binding and a `def` there are `unsupported`, and
an index or a slice bound gives one value. `del`'s path is made of field
reads, indexes, slices, `.[]`, `select`, `|` and `,`; `pick`'s of field reads.
Along these paths:

- a struct field an update never gives a value is removed, as jq removes the
  key; one it gives no value only sometimes raises an error there, since a
  struct cannot lose a field for some values and keep it for others, and so
  `map_values(f)` on a struct needs an output of `f` for every field;
- an index past the end of an array raises an error, where jq pads the array
  with nulls;
- an update through `..` or `recurse` gives each value it reaches back with
  its own type: `(.. | numbers) |= . * 1.5` on Integers is a type error, where
  jq mixes the types;
- a variant's `.type` is not updated, and `..` walks through a variant to its
  payload, not its case's name;
- `walk(f)` rebuilds an option's value, a variant's payload (not its case's
  name), an array's elements, a dict's values and a struct's fields, and runs
  `f` on a set, a vector or a matrix whole, where jq rebuilds their elements
  as an array's.

### 13.24 `reduce` and `foreach` keep their state through an update with no output

Where the update gives no output for an element, the state stays as it was:
`reduce range(3) as $x (1; if $x == 1 then empty else . * 2 end)` is `4`. jq
1.8 makes the state `null` there, and raises an error at `null * 2`.

### 13.25 A pattern's keys are names

A key in an object pattern is a name, `$name` or a string:
`. as {("e" + "xp"): $x}` is a `syntax` problem (#875 defers computed keys in
patterns).

### 13.26 A number literal fits East's numbers

jq 1.8 keeps a literal's decimal text, so `12345678909876543212345` compares
exactly and `1E1000` prints as written. In a query, a literal without `.` or
an exponent must fit 64 bits, and any other must fit a Float: beyond either
it is a `syntax` problem (§18.3). An input number that does not fit 64 bits is
a Float.

### 13.27 Values of two types do not compare

`==`, `!=`, `<`, `<=`, `>` and `>=` take values of one type, an Integer and a
Float, or a value and `null` where it can be null (§6). Any other pair is
`type_mismatch`: `{"a": 1} == {"b": 1}` and `null == false` are refused, where
jq orders every value against every other.

### 13.28 A runtime error's message is East's

An error a query raises carries East's message: `try -. catch .` on `"foo"`
gives `string cannot be negated`, where jq gives `string ("foo") cannot be
negated`, and a builtin names what it needs (`number cannot be used with
trim: it needs a string`). `error(v)`'s message is §13.14's.

### 13.29 An index or a slice bound is an Integer

`.[1.5]`, `.[1.2:3.5]`, `.[nan]` and `has(nan)` on an array are `type_mismatch`
(inside `try`, or after `?`, an error at run time), where jq truncates a Float
index, rounds a slice's bounds outward, and takes NaN as the start or the end.

### 13.30 An argument of a type a builtin cannot take is found when the query is checked

`ltrimstr(1)` and `strftime([])` are `type_mismatch` when the query is checked,
even inside `try` or after `?`, where jq raises an error at run time. (An
input of a type a builtin cannot take is a run-time error there, as in jq.)

### 13.31 Rounding gives an Integer

`floor`, `ceil`, `round` and `trunc` give an Integer (§6), so one of a Float
that is NaN, ±Infinity or past 64 bits raises an error, where jq gives a
number: `1e300 | floor` raises, and jq gives `1e+300`.

### 13.32 `bsearch` finds the first of equal elements

Where the sorted input holds the value more than once, `bsearch` gives the
first index holding it, where jq gives the one its binary search reaches:
`[1, 1, 2, 3] | bsearch(1)` is `0`, and jq's is `1`.

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
  program: JqType,                // as written: printJq prints it back exactly
  root: BooleanType,              // checked as an e3 root: each field of the input is its own input
});
export const QueryType = VariantType({ v1: QueryV1Type });

export const QueryCallType = VariantType({ v1: StructType({   // what the Query builtin carries (§15.7)
  inputs: OptionType(ArrayType(StringType)),                  // a root's field names, in order; none for one input
  program: JqType,                                            // as written
}) });

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
```

**Why a checked query carries its types.** A runtime then never needs the
checker, and a client knows the result's shape before anything runs: the
result type follows from `element_type` and `multiplicity` (§3).

**What code carries.** A query in code is a call of the `Query` builtin
(§15.7), whose query is a `QueryCallType`: the program as written, and a
root's field names. The builtin's type parameter, the translation's function
type, carries the input and result types, so the call does not hold them
twice.

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

**The checker's rewrites.** A checked query holds its program as written, so
that it prints back as its author wrote it. The checker's rewrites are the
check result's `rewritten` tree, which the translator reads, so that no
runtime parses text:

- an ISO string compared with a DateTime, used as a DateTime key or passed as
  a DateTime argument, alone or as an element of an array literal
  (`index(["2026-09-01"])`), becomes a DateTime literal (`"2026-09-01"` is
  midnight UTC, and a date-time with no offset is UTC); one that is a
  filter's input (`"2026-09-01" | in($byDay)`) stays a String;
- a number literal takes its operand's type, unless another check of it
  keeps it an Integer (a `def` called with an Integer and with a Float, a
  `walk` meeting both): then it stays as written, and each translation
  widens it where it needs a Float;
- a `strftime` or `strptime` format becomes a token array;
- a regular expression is validated;
- on an e3 root, `keys`, `keys_unsorted` and `has("name")` are answered from
  its type (§15.6).

The rewritten tree prints (§18.4) as text that checks to it again: a DateTime
literal prints as its RFC 3339 string, a token array as its format, and a
folded `keys` as an array of strings. That text is not always what was
written (`"2026-01-01"` compared with a DateTime comes back as
`"2026-01-01T00:00:00.000+00:00"`), which is why a checked query keeps the
program as written.

**Evolution.** Operators, builtin names and error codes are strings. A
structural change is a new case of `QueryType`, sorting after `v1`, and every
reader accepts every released version. Inserting a case before an existing one
would renumber it, because a variant's cases are ordered by name.
(`PathSegmentType` in e3-types is the example: its `index`, `key` and `case`
are still marked "Future" because adding them would renumber its existing
cases.)

---

## 15. Translation

`translateJq(checked, options?)` turns a checked query into ordinary East IR
with East's own builder, typed by the checker's types. `East.jq` and
`evaluateJq` are built on it. TypeScript compiles the IR as it compiles any
program, east-c runs it natively, and python runs it through east-c. `East.jq`
emits the translation inside a call of the `Query` builtin, which gives it
(§15.7): no runtime reads query text, and none evaluates jq.

```ts
const checked = checkJq(".orders | map(.total) | add", FixtureRoot, { root: true });
const translation = translateJq(checked);
translation.inputs;       // [{ name: "orders", type: Array<Order> }]
translation.resultType;   // Float
translation.fn();         // East.function([Array<Order>], Float, …)
```

### 15.1 The model

- **A filter is a loop body.** Each node is generated with a continuation that
  receives each of its outputs. `a | b` generates `b` in `a`'s continuation,
  and `a, b` gives `a`'s outputs, then `b`'s. `.[]` is a `for` over the
  collection: an array's elements, a set's in order, a dict's values in key
  order, a struct's fields in declared order.
- **The result is the sink.** A `one` query's result is its output, `maybe`
  fills an `Option`, and `many` pushes each output onto an `Array`.
- **Every value has the checker's type.** Each node's outputs are converted to
  the type the checker gave it: Integer widened to Float, `T` and `null` to
  `Option<T>`, arrays, dicts, structs and variants part by part. Narrowing is
  kept: a `null` the checker ruled out never reaches the next filter, and an
  option narrowing proved present gives its payload.
- **Tests narrow.** `type == "number"` on an option opens it first, so each
  branch sees what it tests; a case test (`.status.type == "shipped"`) limits
  `.value` to the cases it allows; a branch narrowing rules out is not
  generated. A comparison or `type` that the types decide is folded when the
  query is translated.
- **One type per input.** Where one record of the checker cannot serve every
  input a node is given (a `walk` meeting values of several types, `map` over
  a struct's fields), the checker checks the node again for that input's type,
  and the translation is typed from what it finds.

```jq
[.orders[] | if .status.type == "cancelled" then .status.value.reason else "" end] | .[:3]
```
→ `["", "", ""]` · Array<String>, one (only the `cancelled` case is read for `.reason`)

### 15.2 Early exit

`first(f)`, `limit(n; f)`, `nth(n; f)`, `isempty(f)`, `any`, `all`, `IN` and
`label $l | … break $l` run their stream inside a labelled loop, and break out
of it, and so out of every loop between, when they have what they need. A
lazy input stops being read there (§15.6).

```jq
first(.orders[] | select(.total > 1000)) | .id
```
→ `.some 1002` · Option<Integer>, maybe (the loop over the orders stops at the second)

### 15.3 Control and errors

- **`if`** is `if`/`else`; a condition with several outputs runs a branch for
  each.
- **`try body catch h`** runs `body` in an East `try`. The outputs it gave
  before an error stand, and are given on after the `try`, so an error their
  consumer raises is not `body`'s to catch. `h` receives the error's message
  (§13.14). `f?` is `try f`.
- **`a // b`** gives `a`'s outputs that are neither `false` nor `null`, with
  `a`'s errors suppressed, or else `b`'s.
- **`?//`** binds each pattern in turn, and runs the body with the first that
  raises no error.
- **`reduce` and `foreach`** loop over the source with an accumulator of the
  checker's settled type (§5). The update runs on the state as it was, and its
  last output becomes the state, which stays as it was when the update gives
  none (§13.24); `foreach` gives each of its outputs, through `extract` when
  there is one.
- **Errors are East errors.** `error(v)` raises `v`'s East text (§13.14). An
  arithmetic error is the builtin's own (`Division by zero` from an integer
  `%`); `/` by zero raises `Division by zero`, as jq raises an error.
- **Locations.** Each node that can raise carries a location in the jq text:
  file `jq`, the node's line and column. An error names it, so `1 | . % 0`
  raises `Division by zero` at `jq 1:5`, and `evaluateJq` gives it as its
  `runtime` diagnostic's span.

### 15.4 Functions and recursion

- A `def` is inlined at each call, typed as the checker typed that call; a
  filter parameter is a closure over the caller's scope.
- A recursive `def` with value parameters is an East function held in a
  reference, which its body calls through the reference. It returns its whole
  stream as an array, so early exit does not reach into its recursion. One
  that takes a filter parameter is refused (§13.13).
- `recurse`, `..`, `while`, `until` and `repeat` walk with an explicit stack.
  Over a recursive type, the stack holds the kinds of value the walk meets as
  the cases of one variant, and needs no recursion in the IR. The walk is
  pre-order, fields in declared order.
- `walk(f)` rebuilds bottom-up: a value's parts first, then `f` on the value
  rebuilt, once. Its parts are an option's value, a variant's payload, an
  array's elements, a dict's values and a struct's fields (§13.23). A
  recursive type is rebuilt by a function reached through a reference.

```jq
def fact: if . <= 1 then 1 else . * (. - 1 | fact) end; 5 | fact
```
→ `120` · Integer, one

### 15.5 Updates

`=`, `|=` and the arithmetic updates rebuild the value along their path. A
path is made of (§13.23):

- field reads, `.[k]` indexes and keys, `.[a:b]` slices and `.[]`, each with
  `?` naming nothing on a value it does not apply to. An index's key and a
  slice's bounds are taken on that step's own input, as in jq, and give one
  value each;
- a variant's `.value`: the payload, in each case narrowing leaves;
- `select(f)` and the type selectors (`numbers`, `strings`, `objects`, …):
  the value where the filter keeps it, narrowed as the filter narrows it, and
  as it was elsewhere;
- `empty`, which names nothing;
- `..`, `recurse` and `recurse(.a.b[])`, which walk the value in pre-order:
  each value is updated, then the values inside it that it had before its own
  update, so what an update adds is not walked. Each value keeps its type, and
  a recursive value is walked by a function reached through a reference;
- `|` of these.

A new field gives the Struct type the checker inferred (§5).

- `|=` takes the update's first output at each position. Where it gives none,
  an array element, a slice or a dict key is deleted, all at once as jq 1.8
  deletes them (`(.[] | select(. > 1)) |= empty` on `[3, 1, 2]` is `[1]`); a
  struct field is removed where the update never gives a value (§13.23); and
  `.` itself is `null`.
- `=` and `op=` take their value on `.`, once for each of its outputs.
- `del(p)` deletes every path `p` names at once, each path's indexes and bounds
  taken on the input, as jq deletes them: `del(.[0], .[2])` on `[1, 2, 3, 4]`
  is `[2, 4]`.

```jq
.orders[:4] | map(.id) | .[1:3] |= map(. * 10)
```
→ `[1001, 10020, 10030, 1004]` · Array<Integer>, one

```jq
.bom | (recurse(.children[]) | .cost) |= . * 2 | [recurse(.children[]) | .cost] | add
```
→ `554.3000000000001` · Float, one (every part's cost doubled)

### 15.6 Inputs and paging

- **Checked as an e3 root** (`East.jq({ orders, customers }, …)`, e3's root),
  each field is its own parameter, and `.orders` reads it directly: the root
  is never built as a value. `translation.fn()` takes the fields the query
  reads, which the checker's `reads` lists. `translation.call(…)`, which
  `East.jq` emits (§15.7), takes every field of the root, in order, and gives
  the translation those it reads; `keys` and `has` on a root answer from the
  whole root's type (§14), so it is never narrowed to its reads.
- **A lazy input stays lazy.** It is iterated, indexed, looked up and counted
  with the builtins that read a lazy value without reading it whole, and early
  exit stops reading it: `first(.orders[])` reads the first segment of the
  orders, and `.orders | length` their index alone. east-c's
  `tests/test_query_paged.c` runs the corpus's translations over the
  fixture's datasets opened paged, and holds each to the segments
  `east_paged_stats` says it decoded: one for `first(… select …)` and for a
  key lookup, none for `length`, and nothing hydrated.

### 15.7 `East.jq`

```ts
East.jq<T extends EastType>(input: Expr | { [name: string]: Expr }, program: string, resultType: T): ExprType<T>
```

`East.jq` parses, checks and translates when the program is built. For an
object of inputs, the query is checked as an e3 root: a Struct of their types,
in the given order. A diagnostic of error severity throws `QueryError`, and so
does a `resultType` that is not the query's result type, naming both.

**The result type is required, and types the expression.** A query's type is
known only once its text is checked, so the program states it: the result
type of §3 (`T`, `Option<T>` or `Array<T>`), which the query must check to
exactly. The expression is then of that type (an `ArrayExpr` for an `Array`,
and so on), and its methods chain:
`East.jq(orders, "map(.total)", ArrayType(FloatType)).sum()`. python's
`East.jq(input, program, result_type)` takes it the same way.

The expression is a call of the `Query` builtin, which `translation.call(…)`
builds (#1041):

```
Call(Builtin("Query", [F], [<query>, <translation>]), [<inputs>])
```

- **`F`** is the translation's function type: one parameter per input, in
  order, and the result type (§3).
- **`<query>`** is a `QueryCallType` constant (§14): the program as written,
  and for an object of inputs their names, in order (`none` for one input).
- **`<translation>`** is an East function of type `F`, which runs the
  translation over the inputs the query reads.
- **The call's arguments** are the inputs: every field of a root, not only
  those it reads (§15.6).

The builtin is `Query<F>(query: QueryCallType, translation: F) -> F`. It gives
its second argument, so calling it runs the translation.

- **Every runtime implements it that way,** as it does any builtin:
  TypeScript's compiler and east-c's builtin table, and python through
  east-c. None reads the query. Like any constant argument, the program is
  built each time the call is evaluated, as `DateTime.printFormatted`'s tokens
  are: a cost that grows with the program, not with the data.
- **IR analysis refuses a `Query` whose translation does not fit its
  query:**
  - the query is not a constant `QueryCallType`;
  - `F` does not take one input per name (one input for a query of one);
  - the translation, or what the builtin gives, is not of type `F`.
- **The printers** print the call back as `East.jq(<input>, "<jq>", <R>)`
  from the constant (`docs/conventions/EAST_CODEGEN.md` §2).
- **Tools find a query** in any code by the builtin's name.

### 15.8 `evaluateJq` and `QueryError`

`evaluateJq(program, input, { inputType, root, tooling, platform })` checks the
program when given its text, translates it, compiles it with `East.compile`
and runs it. The compiled function is cached by the query's canonical text,
its input type and the options, 64 at most, so a query run again compiles
once. With `root`, each field the query reads is passed alone, so a lazy one
stays lazy. It returns `T`, `Option<T>` or `Array<T>` by the multiplicity.

`QueryError` carries `diagnostics`, `QueryErrorType` values. For a query that
does not check they are the checker's; for an error the query raised as it
ran, one diagnostic with code `runtime`, the East error's message and the
span of the node that raised it. Its message lists each error as
`jq <line>:<column>: <message>`.

### 15.9 Options, determinism and tooling

- **`maxOutputs`.** With `maxOutputs = n`, a `many` query stops after `n + 1`
  outputs, so a caller can tell the result was cut short, and reads nothing
  past them.
- **`tooling`.** `signature`, `source`, `calls` and `captures` become calls of
  the host platform functions `jq_signature`, `jq_source`, `jq_calls` and
  `jq_captures`, given the function value's type. A host gives them to the
  compiled query (`evaluateJq`'s `platform`); no runtime provides them yet
  (§9).
- **`builtins`** gives `name/arity` for each arity of each builtin a query may
  call (with `tooling`, the tooling builtins too), in East's string order.
- **Deterministic.** The same checked program and options give the same IR,
  but for variable names and locations, which the IR normaliser ignores. The
  corpus fixture holds each case's translation (`translated`), built without
  source locations but the jq text's, and python's translator is held to it
  (#926). It also holds each case's `Query` call (`called`): an East function
  of the checked input's fields, or of the one input, whose body is
  `translation.call(…)`. Python's call is held to it too (#1041).

---

## 16. Conformance

jq 1.8.1's own test suites, `jq.test`, `man.test`, `onig.test` and
`optional.test`, run through the checker and the translation
(`test/query.conformance.spec.ts`). They are vendored with jq's licence in
`test/jq-conformance/jq-1.8/`, and read as jq's runner reads them
(`src/jq_test.c`): a program, its input and its expected outputs; after
`%%FAIL`, a program that must fail to compile.

### 16.1 Typing an input

JSON has one number type and mixed arrays; East has neither. An input becomes
an East value by these rules (`test/jq-conformance/typing.ts`):

- a number without `.` or an exponent that fits 64 bits is an Integer, and
  any other a Float, `nan` and `Infinity` (which jq's reader takes) included;
- `null`, `true` and `false`, and a string, are Null, Boolean and String;
- an object is a Struct of its keys in order, and `{}` is `Struct{}`;
- an array is an array of the one type its elements unify to, as the checker
  unifies outputs (§3): Integer and Float to Float, `T` and `null` to
  `Option<T>`, and Structs of the same fields field by field; `[]` is
  `Array<Never>`;
- an input that does not unify (a mixed array, differently shaped objects in
  one array) is *untypeable*, and its case is skipped.

An expected output is read as a value of the query's element type, as jq
prints one: a whole number where the type is Float, `null` for NaN, and
±1.7976931348623157e+308 for ±Infinity. Outputs compare with `equalFor`.

### 16.2 Where a case lands

| Bucket | When |
|---|---|
| pass | the program checks and its outputs equal jq's; a `%%FAIL` program does not check (the messages are not compared) |
| deviation | it differs as a deviation of §13 says: `test/jq-conformance/deviations.ts` lists each such case with the deviation and why, and one a builtin §13.8 or §13.17 makes unavailable is placed by its diagnostic |
| skipped | its input is untypeable; it uses an excluded builtin (§11), `$ENV` or a module; or a runner's limit (`resource`, `runner`) is in the way, with the reason |
| fail | anything else |

No case fails. `test/jq-conformance/summary.json` holds where each case lands,
and `make query-corpus` rewrites it and the tables below, which the spec holds
to both. A case that passes on an input runs again as a compliance test: its
translation, called on its typed input, gives jq's expected outputs.
`make test-export` writes these tests, a suite per file, to
`/tmp/east-test-ir/query-conformance/`, where east-c and east-py run them
(#925). Every IR node kind and builtin a translation uses, the corpus's,
these and the type matrix's (§16.5), is exercised by a compliance suite that
is not about queries:
`test/query.constructs.spec.ts` checks the translations against the other
exported suites, so no runtime runs a construct only queries test.

<!-- conformance: written by `make query-corpus` from test/jq-conformance/summary.json -->
| Suite | Cases | Pass | Deviation | Skipped | Fail |
|---|---|---|---|---|---|
| `jq.test` | 522 | 290 | 142 | 90 | 0 |
| `man.test` | 231 | 158 | 42 | 31 | 0 |
| `onig.test` | 47 | 17 | 30 | 0 | 0 |
| `optional.test` | 2 | 0 | 2 | 0 | 0 |
| All | 802 | 465 | 216 | 121 | 0 |

| Deviation | Cases |
|---|---|
| §13.1 A missing Struct field is an error | 5: jq.test:609, jq.test:1168, man.test:33, man.test:162, man.test:805 |
| §13.2 Dict keys have any East type, and `.[k]` is an index or a key by type | 2: jq.test:127, jq.test:2044 |
| §13.3 Integers are exact to 64 bits | 2: jq.test:2169, jq.test:2177 |
| §13.4 DateTime is a type | 12: jq.test:1805, jq.test:1813, jq.test:1817, jq.test:1821, jq.test:1847, jq.test:1851, jq.test:1857, man.test:742, man.test:746, man.test:750, optional.test:4, optional.test:9 |
| §13.5 A program's outputs share one element type | 44: jq.test:213, jq.test:217, jq.test:229, jq.test:248, jq.test:269, jq.test:273, jq.test:315, jq.test:319, jq.test:405, jq.test:440, jq.test:478, jq.test:524, jq.test:716, jq.test:851, jq.test:944, jq.test:948, jq.test:966, jq.test:973, jq.test:994, jq.test:1001, jq.test:1022, jq.test:1029, jq.test:1138, jq.test:1154, jq.test:1399, jq.test:1431, jq.test:1515, jq.test:1519, jq.test:1639, jq.test:2004, jq.test:2008, jq.test:2012, jq.test:2016, jq.test:2020, jq.test:2047, jq.test:2194, jq.test:2199, man.test:104, man.test:582, man.test:586, man.test:669, man.test:809, man.test:813, man.test:919 |
| §13.6 Literal keys build Structs; computed keys build Dicts | 4: jq.test:118, jq.test:122, jq.test:1663, jq.test:2266 |
| §13.8 Regular expressions are East's | 26: onig.test:2, onig.test:6, onig.test:10, onig.test:14, onig.test:18, onig.test:23, onig.test:28, onig.test:32, onig.test:36, onig.test:41, onig.test:47, onig.test:54, onig.test:60, onig.test:67, onig.test:75, onig.test:104, onig.test:141, onig.test:145, onig.test:149, onig.test:153, onig.test:157, onig.test:166, onig.test:170, onig.test:183, onig.test:187, onig.test:191 |
| §13.9 `tostring` and `tojson` are East's | 2: jq.test:1482, man.test:341 |
| §13.14 `error(v)` takes any type, and its message is `v`'s East text | 2: jq.test:205, jq.test:1476 |
| §13.16 A value that can be null is checked where a value is needed | 11: jq.test:329, jq.test:333, jq.test:341, jq.test:898, jq.test:1615, jq.test:1619, jq.test:2029, jq.test:2123, jq.test:2173, man.test:658, man.test:915 |
| §13.17 Builtins East cannot define are unavailable | 50: jq.test:72, jq.test:90, jq.test:98, jq.test:838, jq.test:1101, jq.test:1106, jq.test:1110, jq.test:1114, jq.test:1118, jq.test:1122, jq.test:1126, jq.test:1130, jq.test:1144, jq.test:1160, jq.test:1164, jq.test:1180, jq.test:2154, jq.test:2158, jq.test:2162, jq.test:2182, jq.test:2186, jq.test:2273, jq.test:2277, jq.test:2282, jq.test:2361, jq.test:2369, jq.test:2383, jq.test:2388, jq.test:2452, jq.test:2456, jq.test:2491, man.test:13, man.test:21, man.test:260, man.test:264, man.test:276, man.test:280, man.test:284, man.test:288, man.test:292, man.test:296, man.test:630, man.test:634, man.test:738, man.test:956, man.test:961, onig.test:196, onig.test:200, onig.test:204, onig.test:208 |
| §13.18 `ascii_downcase`, `ascii_upcase` and the trims are East's string builtins | 3: jq.test:1531, jq.test:1785, man.test:646 |
| §13.20 `repeat(f)` gives its input, then `f` of it, and so on | 1: man.test:654 |
| §13.23 Paths are a subset of jq's, and keep types | 19: jq.test:490, jq.test:1188, jq.test:1197, jq.test:1232, jq.test:1236, jq.test:1261, jq.test:1265, jq.test:1269, jq.test:1273, jq.test:1277, jq.test:1281, jq.test:1285, jq.test:2088, man.test:248, man.test:252, man.test:256, man.test:706, man.test:985, man.test:991 |
| §13.25 A pattern's keys are names | 1: jq.test:530 |
| §13.26 A number literal fits East's numbers | 8: jq.test:661, jq.test:668, jq.test:674, jq.test:2190, jq.test:2229, jq.test:2233, man.test:9, man.test:25 |
| §13.27 Values of two types do not compare | 2: jq.test:1394, man.test:754 |
| §13.28 A runtime error's message is East's | 6: jq.test:1464, jq.test:1537, jq.test:1801, jq.test:1959, jq.test:1963, jq.test:1967 |
| §13.29 An index or a slice bound is an Integer | 14: jq.test:1695, jq.test:2393, jq.test:2397, jq.test:2401, jq.test:2405, jq.test:2409, jq.test:2413, jq.test:2417, jq.test:2421, jq.test:2425, jq.test:2429, jq.test:2433, jq.test:2437, jq.test:2441 |
| §13.30 An argument of a type a builtin cannot take is found when the query is checked | 2: jq.test:1839, jq.test:2462 |

| Skipped | Cases |
|---|---|
| excluded | 18: jq.test:1843, jq.test:1862, jq.test:1866, jq.test:1870, jq.test:1874, jq.test:1879, jq.test:1883, jq.test:1887, jq.test:1891, jq.test:1931, jq.test:1935, jq.test:1939, jq.test:1955, jq.test:2295, jq.test:2299, jq.test:2506, man.test:686, man.test:690 |
| resource | 1: jq.test:1603 |
| runner | 1: jq.test:2317 |
| untypeable | 101: jq.test:106, jq.test:179, jq.test:183, jq.test:187, jq.test:191, jq.test:195, jq.test:200, jq.test:345, jq.test:455, jq.test:701, jq.test:705, jq.test:728, jq.test:736, jq.test:741, jq.test:749, jq.test:894, jq.test:920, jq.test:924, jq.test:929, jq.test:936, jq.test:940, jq.test:952, jq.test:959, jq.test:980, jq.test:987, jq.test:1008, jq.test:1015, jq.test:1036, jq.test:1040, jq.test:1044, jq.test:1048, jq.test:1134, jq.test:1150, jq.test:1192, jq.test:1241, jq.test:1297, jq.test:1301, jq.test:1353, jq.test:1357, jq.test:1361, jq.test:1368, jq.test:1435, jq.test:1439, jq.test:1635, jq.test:1655, jq.test:1679, jq.test:1687, jq.test:1691, jq.test:1729, jq.test:1733, jq.test:1737, jq.test:1741, jq.test:1745, jq.test:1749, jq.test:1753, jq.test:1757, jq.test:1761, jq.test:1765, jq.test:1769, jq.test:1773, jq.test:1826, jq.test:1830, jq.test:1834, jq.test:1976, jq.test:1992, jq.test:1996, jq.test:2051, jq.test:2093, jq.test:2348, jq.test:2365, jq.test:2474, jq.test:2481, man.test:199, man.test:219, man.test:223, man.test:320, man.test:345, man.test:349, man.test:365, man.test:393, man.test:397, man.test:405, man.test:442, man.test:447, man.test:454, man.test:460, man.test:526, man.test:530, man.test:642, man.test:714, man.test:718, man.test:722, man.test:762, man.test:823, man.test:831, man.test:835, man.test:847, man.test:857, man.test:862, man.test:965, man.test:969 |
<!-- /conformance -->

### 16.3 Oniguruma features East's regular expressions lack

jq's regular expressions are Oniguruma's, and East's ECMAScript-style (§13.8).
`onig.test`'s cases that use these differ by §13.8, or by §13.17 where the
builtin is unavailable:

- capture groups read as values: `match`, `capture`, `scan`, `splits` and
  `split/2`;
- the flags `x` (extended), `n` (ignore empty matches), `s` (single line),
  `l` (longest) and `p`: `test`, `sub` and `gsub` take `g` and `i`;
- a replacement that is a filter over the groups (`"\(.x | ascii_downcase)"`),
  or gives several strings (`"b", "c"`): a replacement interpolates the named
  groups as they are.

### 16.4 Performance

`make query-bench` (`test/query-bench/bench.ts`, #925) times the translated
queries against jq 1.8.1 over the fixture scaled to 100 000 orders: the mock's
generator drawing on from its seed, so the first 40 are the fixture's, written
as beast2 for East and as JSON for jq (as jq sees it, §2). Each query runs
whole-process in east-c, with its inputs decoded whole (`--decode whole`) and
lazy (the default), in east-node and in jq, and in process in TypeScript's compiler
over inputs decoded once. Every East runner's result equals TypeScript's. The
table is a run's, pasted here by hand; nothing asserts a time.

100,000 orders (2.6 MB as beast2, 24.0 MB of JSON with the customers); the
median of 5 runs after one to warm the file cache, in milliseconds.

| Query | east-c | east-c, lazy | east-node | TypeScript, compiled | jq |
|---|--:|--:|--:|--:|--:|
| `length` | 133 | 4.2 | 473 | 0.00 | 318 |
| `first(… select …)` | 133 | 4.4 | 481 | 0.02 | 317 |
| filter and count | 154 | 95 | 654 | 178 | 373 |
| `reduce` by customer | 218 | 113 | 922 | 405 | 496 |
| `group_by` totals | 278 | 265 | 776 | 299 | 523 |
| top 3 by `sort_by` | 219 | 223 | 678 | 229 | 465 |
| the mock's default query | 279 | 233 | 1442 | 831 | 581 |

Intel Core Ultra 5 235T (14 threads), 14 GiB, Linux 7.0; node v22.22.3;
east-c 1.0.80 built in Release; jq 1.8.1; 2026-09-28.

- **Lazy inputs read what a query needs.** `length` reads the orders' index
  and `first(… select …)` their first segment, where eager east-c decodes all
  100 000 orders before it starts. A query that walks every order reads them a
  segment at a time: filter and count and `reduce` took 95 and 113 ms lazily
  against 154 and 218 eagerly, and `group_by` and `sort_by`, which need the
  whole array, about what eager east-c takes.
- **east-c is the quickest whole-process runner** on every query. east-node's
  times include starting Node and loading East.
- **The queries** are `.orders | length`;
  `first(.orders[] | select(.total > 1000))`;
  `[.orders[] | select(.status.type == "shipped" and .total > 1000)] | length`;
  `reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)`;
  `.orders | group_by(.customer_id) | map({customer: .[0].customer_id, total: map(.total) | add})`;
  `.orders | sort_by(-.total) | .[:3] | map(.id)`; and the mock's default
  query (§18.4). jq has no `year`, so it runs the last with
  `(.status.value.date | .[0:4]) == "2026"`.

### 16.5 The type matrix

jq's suites and the corpus give a query JSON-shaped inputs over one fixture.
The type matrix (#987, `test/query-types/`) gives it every East type: a
**shape** is a type and its values (typical ones, its edge values and its
empty one), and a **program** is a jq program with the kinds of type it
applies to. Every shape × every program that applies to it is a **pair**,
run on each of the shape's values: a **case**.

- **Shapes**: scalars (NaN, ±Infinity and −0.0; integers at ±2⁵³ and at 64
  bits; non-BMP text), arrays, sets and dicts of each kind, dicts keyed by
  every orderable type, vectors and matrices, structs, variants and options
  (`Option<Option<T>>` included), recursive types, references, function
  values (a closure included), and composites of them.
- **jq judges** a case where it can see the input and the result (§2): the
  input is East's JSON (`encodeJSONFor`) behind a jq filter, generated from
  the type, that turns it into the value jq sees, and each output comes back
  through a filter that turns it into East JSON, which East's decoder reads
  as a value of the query's element type (`decodeJSONFor`). jq's text must
  be that value's own encoding, so a set jq gives out of order, or with
  duplicates, is not read as the set it would decode to. `make query-types`
  runs jq 1.8.1 on every such case and records its outputs, or its error, in
  `test/fixtures/query-types.json`; CI, without jq, holds East to the record,
  and fails while a case's input or program is not the one recorded.
- **Where jq differs** by a deviation of §13, the case lists it, and East
  gives the value that section says; each listed deviation must still differ
  in some case.
- **Where jq cannot see** the input or the result (a DateTime, a Blob, a dict
  keyed by another type, a function), the case gives the value of the
  section its oracle follows.
- **East refuses** a program for a type only where jq raises an error too,
  or where a section says so; every case of a refused pair is refused.
- **Every case** that runs is a compliance test: each kind's pairs are a
  suite, each pair's translation (`translateJq(checked).fn()`) called on each
  value, and equal to the expected result or raising an error. The query
  suites hold raw translations; `East_jq.json`, beside them, holds the `Query`
  builtin. `make test-export`
  writes them to `/tmp/east-test-ir/query-types/`, and the corpus's cases
  that have an output to `/tmp/east-test-ir/query-corpus/`, each reading the
  fixture from the bytes of `test/fixtures/query-fixture.beast2` and held to
  the value TypeScript's translation gives over it. east-c runs these suites
  and jq's (§16.2), compiled and under ASan/LSan; east-py runs them compiled,
  in the eager replay and through the IR round trips; and CI stages them as
  a local run does.

<!-- matrix: written by `make query-types` from test/query-types/ and test/fixtures/query-types.json -->
| Kind | Shapes | Pairs | Cases | Pass | Deviation | East-only | Error | Refused | Fail |
|---|---|---|---|---|---|---|---|---|---|
| scalars | 10 | 383 | 1307 | 993 | 117 | 180 | 6 | 11 | 0 |
| arrays | 12 | 782 | 923 | 717 | 78 | 123 | 0 | 5 | 0 |
| sets | 6 | 373 | 439 | 334 | 44 | 60 | 0 | 1 | 0 |
| dicts | 12 | 448 | 487 | 204 | 30 | 252 | 0 | 1 | 0 |
| tensors | 5 | 243 | 309 | 279 | 30 | 0 | 0 | 0 | 0 |
| structs | 7 | 250 | 322 | 272 | 50 | 0 | 0 | 0 | 0 |
| variants | 8 | 194 | 462 | 392 | 67 | 0 | 0 | 3 | 0 |
| recursive | 5 | 174 | 256 | 213 | 41 | 0 | 0 | 2 | 0 |
| refs | 3 | 152 | 152 | 137 | 15 | 0 | 0 | 0 | 0 |
| functions | 2 | 6 | 9 | 0 | 0 | 6 | 0 | 3 | 0 |
| composites | 3 | 142 | 142 | 57 | 7 | 78 | 0 | 0 | 0 |
| All | 73 | 3147 | 4808 | 3598 | 479 | 699 | 6 | 26 | 0 |

| Deviation | Cases |
|---|---|
| §13.3 Integers are exact to 64 bits | 25 |
| §13.9 `tostring` and `tojson` are East's | 314 |
| §13.10 Order is East's total order | 33 |
| §13.14 `error(v)` takes any type, and its message is `v`'s East text | 89 |
| §13.15 `add` of no values of a type with an identity gives the identity | 4 |
| §13.18 `ascii_downcase`, `ascii_upcase` and the trims are East's string builtins | 1 |
| §13.31 Rounding gives an Integer | 12 |
| §13.32 `bsearch` finds the first of equal elements | 1 |

| Refused by | Pairs |
|---|---|
| jq raises an error too | 3: boolean:every.length, string:string.at-base32, string-escapes:string.at-base32 |
| §10 Builtins | 3: datetime:every.length, function-integer:every.length, function-struct:every.length |
| §13.5 A program's outputs share one element type | 2: variant:variant.payload, recursive-json:variant.payload |
| §13.27 Values of two types do not compare | 2: array-array-integer:sequence.index-of, array-array-integer:sequence.indices-of |
| §14 Wire types | 3: array-datetime:sequence.inside-probe, set-datetime:sequence.inside-probe, dict-datetime-float:dict.in |
<!-- /matrix -->

---

## 17. Running a query

A query's translation is an ordinary East function, so whatever runs East
runs a query: no runtime, and no server, has query code of its own.

- **Its inputs.** Checked as an e3 root, a query's translation takes each
  dataset it reads as a parameter of its own, so a lazy dataset stays lazy
  (§15.6). A query that reads the whole root is refused, naming the datasets
  to read instead (§12).
- **Platform-free.** A translation calls East's builtins only, so it needs no
  platform, unless a function value in its input calls a platform function
  (§9) or the tooling builtins are translated (§15.9). In a runtime that has
  not loaded it, that function fails the run, naming it.
- **In e3,** a translation runs as any function does: as a one-shot call
  (#1031), whose dataset arguments e3 pins by hash as the call starts and
  hands the runner by reference, reading nothing itself. A platform-free call
  runs for any caller who may read the workspace. The query builder in e3-ui
  makes such a call from the datasets a page binds
  (`libs/east-ui/docs/proposals/Query Editor Spec.md`); a query over a dataset
  larger than one piece runs as a split call, which the builder plans with
  `splitJq` (§17.1).
- **Limits.** `maxOutputs` stops a `many` query one output past its limit
  (§15.9); the caller sets the call's time and size limits.

### 17.1 Splitting a query over a dataset's pieces

`splitJq(checked, { maxOutputs })` (`src/query/jq/split.ts`, #941) splits a
query checked as an e3 root over the pieces of one dataset it reads, as an e3
split call runs a program (`libs/e3/design/e3-data-architecture.md` §3.7):
- each piece runs the query's row work over its piece, and emits into an
  output kind;
- e3 combines the pieces' outputs by that kind;
- a final function runs the rest of the query once, over the combined result
  and the inputs.

The result is the translation's (`translateJq`), of its `resultType`. Floats
added up in pieces may differ from the one unit's in their last bits, since
the engine groups the additions.

- **The row work** starts at the dataset: `.D`, `.D[]` or `[.D[] | f]`. It
  goes on through `map(f)`, `[.[] | f]`, `flatten`, and every step of a
  stream.
- **Bindings before it** (`.C as $c | …`) reach every piece, and their
  datasets, the split's `broadcast`, are read whole by each piece.
- **How the rows combine** is decided by the step after the row work:

| Step after the row work | Output kind | Combined by |
|---|---|---|
| totals: `length`, `add`, `min`, `max`, `min_by(f)`, `max_by(f)`, `first` and `.[0]`, `last` and `.[-1]`, `any`, `all` and `unique`, each perhaps after `map(g)`, in any expression of them (`{n: length, mean: (map(.total) \| add / length)}`) | `fold` | each total's parts, field by field: counted; added as `add` adds (numbers, strings, arrays and dicts, and the last of structs); the least, or the greatest (by a key, the first least and the last greatest, as `min_by` and `max_by` keep them); the first; the last; or; and; united |
| `group_by(k) \| map(E)`, `k` giving one immutable value | `dict`, by `k` | `E`'s totals, field by field; each group's rows, concatenated, when `E` is not made of totals |
| `unique` | `set` | united |
| `unique_by(g)` | `dict`, by `g` | the first row of each key |
| `reduce .[] as $x ({}; .[k] += v)`, or `= v`, or over `.D[]` | `dict`, by `k` | added with `+`, or the last kept |
| anything else, after some row work | `array` | concatenated in input order |

- **What runs once.** The final function makes the value the combined result
  stands for: the totals finished and their expression generated over them,
  the groups in key order (`group_by`'s order), the set's rows in order, or
  the dict's values. It runs the rest of the pipeline on that value, then the
  query's sink (§15.1), `maxOutputs` included. A query whose combined rows are
  its result has no final function.
- **The programs are the translator's.** Each is generated from the checked
  program, a total's node standing for its finished value. So a piece
  computes what the one unit computes on its rows, and a runtime error names
  its place in the jq (§15.3). They are built without the locations of the
  code that builds them, so a query's programs are the same bytes wherever,
  and however often, they are built: e3 caches each unit on its program's
  hash.
- **One unit.** A query that does not split runs as one unit, and `splitJq`
  says why:

| Reason | When |
|---|---|
| `no_stream` | it reads no dataset row by row: a count (`.D \| length`), a key (`.D[k]`, `has(k)`), or a value whole |
| `nested` | it reads a dataset's rows inside an expression, not as its pipeline |
| `stops_early` | a stream, `first(…)` or `limit(…)`: one unit stops as soon as it has the outputs it keeps, and a caller caps a stream's |
| `position` | a step takes rows by position (`.[a:b]`, `first`, `last`), with no row work before it |
| `every_row` | a step needs every row at once (`sort_by`, `reverse`, …), with no row work before it |
| `state` | `foreach`, or a builtin that reads the program's further inputs |
| `calls` | the row work calls a function value, which may call a platform function the runner does not load (§9) |
| `reads_again` | a binding before the stream reads the dataset it streams |
| `key` | `group_by` or `unique_by` by a key that is not one immutable value |
| `shape` | anything else: a `def` before the stream, or a binding of several values or patterns |

- **Pruning.** Either way, `pruning` names the reads that skip what they don't
  need:
  - `count`: `.D | length` reads the index;
  - `seek`: `.D[k]` or `.D | has(k)` reads one segment;
  - `stop`: a stream that stops early reads only the segments it reaches.

`test/query.split.spec.ts` runs every rule over the shared fixture cut into
pieces and assembled as e3 assembles them, and holds the results to the
translation's; it holds each rule's and each reason's explanation, and the
programs' bytes, to what this section says.

---

## 18. Grammar and canonical text

`src/query/jq/`: `lexJq`, `parseJq` and `printJq`, with `spanOf`, `pathAt`
and `toQuerySpan`, exported from `@elaraai/east`. The python twins (#926)
give the same programs, spans, diagnostics and text.

### 18.1 The grammar

jq 1.8's (`src/parser.y`), from the loosest level to the tightest:

| Level | Forms | Associativity |
|---|---|---|
| pipe | `a \| b` | right |
| comma | `a, b` | left |
| binding | `src as $p ?// $q \| body`, `label $l \| body`, `def f(g; $x): body; rest` | the body runs to the end of the enclosing query |
| alternative | `a // b` | right |
| update | `=` `\|=` `+=` `-=` `*=` `/=` `%=` `//=` | none |
| or | `a or b` | left |
| and | `a and b` | left |
| comparison | `==` `!=` `<` `<=` `>` `>=` | none |
| additive | `+` `-` | left |
| multiplicative | `*` `/` `%` | left |
| term | `-a`; `try a catch b`, whose body and handler are terms | — |
| postfix | `.name`, `."name"`, `[e]`, `[]`, `[a:b]`, `[a:]`, `[:b]`, each with an optional `?`; `f?` | — |
| primary | `.`, `..`, literals, `$x`, `name(a; b)`, `[…]`, `{…}`, strings, `@format`, `reduce`, `foreach`, `if`, `break $l`, `(…)` | — |

- `as` takes the whole expression on its left, as jq 1.8 does:
  `1 + 2 as $x | $x` binds 3. `,` binds more loosely:
  `1, 2 as $x | $x` is `1, (2 as $x | $x)`.
- The source of `reduce` and `foreach` is an expression:
  `reduce 1 + 2 as $x (…)`.
- A `try` with no `catch` takes the first `catch` after its body, so
  `try (try a) catch b` needs its parentheses.
- An object's value is an expression, or expressions joined by `|`. A `,` or a
  binding needs parentheses there.
- A format where a field's name or a key goes must have its string:
  `.@base64 "x"` and `{@base64 "x": v}`, never `.@base64`.
- `$__loc__` is the variable `__loc__`. `import`, `include` and `module` are
  `unsupported`.

### 18.2 What the parser keeps

The parser keeps jq's sugar, so printing gives back what was written:

- `.a.b` is two `field` nodes, and `.a?` sets `optional`;
- `."a"` is the field `a`, and `."a\(f)"` an index by the string;
- `f?` and `try f` are both a `try` with no `catch`;
- `.a.[0]` is `.a[0]`, as in jq 1.7 and later.

**Literals** are self-describing beast2 blobs:

- a number written without `.` or an exponent is an Integer, exact to 64
  bits; a larger one is a problem;
- any other number is a Float;
- `true`, `false` and `null` are Boolean and Null;
- a string without interpolations is a String.

A string's escapes are JSON's, and its text is well-formed UTF-16: a lone
surrogate, written raw or escaped, reads as U+FFFD.

**Spans.** `parseJq` gives the span of every node by its path from the root
(`pipe.left.call.args[1]`), in the units of §14. A node's span leaves out the
parentheses around it and takes in those around its operands, and `printJq`
gives the same spans for the text it prints. `pathAt` finds the innermost node
at an offset.

### 18.3 Syntax diagnostics

A problem is a `QueryErrorType` with code `syntax`, one sentence, its span,
and a fix where one is obvious. A program with any problem has no `program`.
After a problem the parser resumes at the next `|` outside every bracket,
`if … end` and `def … ;`, so one typo reports one problem.

| Case | Message | Fix |
|---|---|---|
| a closing bracket with no opener, or the wrong one | `syntax: unexpected "{c}".` / `syntax: unexpected "{c}" — "{o}" at column {n} is still open.` | — |
| an unclosed bracket | `syntax: "{c}" is never closed.` | "Close it": the bracket, at the end |
| an unterminated string | `syntax: this string is never closed.` | "Close it": `"`, at the end of its line |
| a trailing `\|` | `syntax: expected a filter after "\|".` | "Remove the \|" |
| an empty program | `syntax: empty program.`, with no span | — |
| an escape JSON lacks | `syntax: invalid escape "\q" in a string.` | — |
| an Integer beyond 64 bits | `syntax: {n} is too large for an Integer; write {n}.0 for a Float.` | — |
| a Float beyond range | `syntax: {n} is too large for a Float.` | — |
| a computed key in a pattern | `syntax: computed keys in patterns are not supported (#875 Defer).` | — |
| `$name: pattern` in a pattern | `syntax: "$name: pattern" is not supported; write "name: pattern" and bind $name separately.` | — |
| a module keyword | `unsupported: {keyword} is excluded — queries are deterministic and have no host access.`, code `unsupported` | — |
| anything else | `syntax: unexpected {token}; expected {what the grammar allows}.` | — |

### 18.4 The canonical text

Every program has one canonical text:

- one space around binary operators, `|`, `//`, `as` and `?//`; `, ` and `; `
  between items; `: ` in objects; no space inside brackets;
- a field or a key bare when it is an identifier (keywords included), and a
  JSON string otherwise;
- literals as East prints them: Integers as digits, and Floats in East's
  shortest round-trip form with `.0` when integral (`100.0`, `1e+21`). NaN and
  ±Infinity print as `nan`, `infinite` and `-infinite`. A literal the checker
  rewrote prints as the text it came from (§14);
- strings with JSON's minimal escapes;
- parentheses only where the grammar needs them: around a looser operand, a
  binding with more text after it, and an Integer or `..` before a postfix;
- a `try` with no `catch` as `f?` when its body is a call, a variable, a
  literal or a constructor, and as `try f` otherwise;
- no comments.

The **pipeline layout** breaks the top-level pipe chain, one segment per line,
joined by `\n| `. It descends through the bodies of the `as`, `label` and `def`
that lead the chain, and a `def` ends its line with `;`. Nested pipes stay on
one line. The query editor prints this way:

```jq
.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})
| map({order: .id, customer: .name, region, total, shipped: .status.value.date})
| sort_by(-.total)
| .[:10]
```

**The round-trip law.** For every program the parser accepts,
`parseJq(printJq(p).text)` gives `p` back, with the same spans, in both
layouts. `test/query.parse.spec.ts` holds it over the corpus and 5 000
generated programs.

---

## 19. Completions, descriptions and summaries

`src/query/jq/`, exported from `@elaraai/east`. All three run in a browser.

### 19.1 Completions

`completeJq(text, offset, input, options?)` gives the completions at a cursor
from the type there, and the range they replace: from the start of the word
being typed to the cursor. The text is usually mid-edit, so the text before
the cursor is repaired to parse (brackets closed, an `if` ended, a `def` given
its rest) and checked, and the value before the cursor is typed.

| At | Offers | `detail` · `doc` |
|---|---|---|
| `.` at an e3 root | the data sources (`dataset`) | the East type · `describeRoot`, else the plain kind |
| `.` or a path | a struct's fields (`field`) | the type as read (an `Option` through `null`) · the plain kind |
| `.F.` on a variant | `type` and `value` | · `case name: a, b, c` |
| `.F.value.` un-narrowed | every case's fields, as `Option<T>`, `warn` | · `only when .F.type == "c"` |
| `.F.value.` narrowed | the case's fields, exactly | · the plain kind |
| `.` on a dict | `[` (`key`) | the dict's type · `look up by K key` |
| `.F.type == "` | the case names (`case`) | `case of Variant{…}` |
| `== "` on another path | `values(path, prefix)` (`value`) | `{n} in data` |
| `$d["` | `values("$d", prefix)` (`key`) | `{n} in data` |
| `$` | the variables in scope (`variable`) | the type · the plain kind |
| a word | the builtins and defs that start with it (`builtin`), not an exact match | the signature (`select(f)`) · the catalog's rule |

A builtin that takes arguments inserts `name(`; a case, a value or a key
inside a string inserts its text escaped as the string's (`say \"hi\"`), then
its closing quote. Items are ordered by kind (case, value,
key, dataset, field, variable, builtin) and then label, 40 at most.

### 19.2 The type as jq sees it

`describeJqType(type, { maxDepth })` describes a type as jq reads it: one
line per path, indented by depth, with its type. A struct's fields are
`.name`, an array's elements `[]`, a dict's values `[<K>]`; a variant's case
is `.type`, listed as its names, and each case's payload is under `.value`,
marked `(when case)`; a recursive type is described once and marked
`(recursive: path)` where it recurs.
`plainKind` gives the words the query editor uses: `text`, `number`, `whole
number`, `date`, `yes or no`, `one of`, `list`, `lookup table`, `record`,
`calculation`, with `, sometimes missing` for an Option.

```text
.  Struct{customer_id, discount, id, lines, status, total}
  .customer_id  String
  .discount  Option<Float>
  …
  .status  Variant{cancelled, pending, shipped}
    .status.type  "cancelled" | "pending" | "shipped"
    .status.value  Struct{date} (when shipped)
      .status.value.date  DateTime (when shipped)
```

### 19.3 Summaries

`summaryProgram(type, { maxLeaves, topValues })` is one jq program that
profiles a value of `type`, and checks against it to `SummaryType`: the row
count, and a `SummaryLeafType` for each leaf path, keyed by the path's jq from
a row.

- **Rows** are an array's or a set's elements, a dict's values, or else the
  value itself.
- **Leaves** are each path from a row to a scalar, each variant's `.type`,
  each case's payload leaves (counted where the case holds), and each list;
  shallowest first, `maxLeaves` (100) at most.
- **Each leaf** gives `count` and `missing`, and by kind: `values` (the
  `topValues`, 20, most common, by count then value) and `distinct` for text;
  `cases` for a variant, in declared order with zero counts kept; `numbers`
  (min, max, mean, median) for numbers, and `distinct` for whole numbers;
  `dates` (first, last, and counts per month and per year); `lengths` for
  lists.
- **Composable.** `prefix + " | " + summaryProgram(typeAfterPrefix)`
  summarises the rows at any stage, which is how the query editor fills its
  value slots (`Query Editor Spec.md` §4.5).
- The program binds its rows once, and lists two prototype leaves first, one
  with every optional part and one with none, and then drops them: they give
  each part its `Option` type whatever the rows hold.
