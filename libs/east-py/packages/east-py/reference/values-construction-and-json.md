# Constructing and validating East values; JSON contracts

`array` / `struct` / `variant` / `coerce_to` / `assert_value_of`, and `json_schema_for` / `type_from_json_schema`. Part of the `east-py` skill.

## Construction & validation (`from east import ...`)

| Signature | Description | Example |
|-----------|-------------|---------|
| **Ergonomic constructors** |
| `array(element_type, items, *, validate=True) -> EastArray` | Each item coerced/validated to `element_type` (dict→struct, int→Float, …); `validate=False` stores as-is | `array(LineItem, [{"name":"a","price":1}])` |
| `struct(fields: dict, typ: StructType\|None=None) -> EastStruct` | Reorders/coerces keys to `typ` (else infers from fields); dual-mode — a field holding an expression (at any depth) builds Struct IR instead | `struct({"price":1,"name":"a"}, LineItem)` |
| `variant(case: str, value, typ: VariantType\|None=None) -> EastVariant` | Tagged value; validates `value` against case `case` (matched **by name**); read back via `.type`/`.value`; dual-mode — an expression payload builds Variant IR, typed by `typ` or by context | `variant("named", "red", Color)` |
| `some(value) -> EastVariant` / `none` | Option `some`; `none` is a **constant**, not a function | `some(5)` / `none` |
| `match(v, cases: dict, default=None)` | Dispatch on `v.type`; the handler is a body, **always** called `handler(b, v.value)` — the `none` arm is `lambda b, v: …`, not `lambda: …`; `default` is a `default(b)` body for the cases without a handler (a plain value is returned as is) | `match(o, {"some": lambda b, x: x, "none": lambda b, v: -1})` |
| `east_ref(value) -> EastRef` | Make a mutable ref cell (same as `EastRef(value)`) | `east_ref(0)` |
| **Validation / coercion** — raise `EastTypeError` (`expected X, got Y (at $.path)`) |
| `coerce_to(value, typ, *, path="$") -> EastValue` | Canonicalize any Python value to a bridge-ready East value, type-driven; a 1-D numpy array fills `Array<Float/Integer/Boolean>` C-side in one bulk crossing (hand struct fields numpy columns directly) | `coerce_to({"qty": np_i64}, InputType)` |
| `assert_value_of(value, typ, *, path="$") -> value` ❗ | Validate; return value, or raise path-pinpointed `EastTypeError` on first mismatch | `assert_value_of(s, LineItem)` |
| `explain_value_of(value, typ) -> list[(path, reason)]` | Every mismatch; `[]` == conforms | `explain_value_of(s, LineItem)` |
| `is_value_of(value, typ) -> bool` | Boolean conformance check | `is_value_of(items, ArrayType(LineItem))` |
| `type_of(value) -> EastType` | Infer the East type of a value | `type_of(items)` |

Container constructors are also direct: `EastArray(elem, items=None)`, `EastSet(elem, items=None)`,
`EastDict(key, value, items=None)`, `EastVector(elem, data=None, length=0)`,
`EastMatrix(elem, data=None, rows=0, cols=0)`, `EastRef(value)`.

## A JSON contract for a type — `json_schema_for` / `type_from_json_schema`

`East.String.print_json` writes **East JSON**, lossless and self-describing.
`json_schema_for(T)` emits the JSON Schema of exactly that encoding, so another
system can validate a payload before sending it; `type_from_json_schema` goes the
other way. Host-side functions, like `compare_for` — no expression, no IR:

```python
import json
from pathlib import Path

from east import ArrayType, IntegerType, StringType, StructType
from east.serialization import json_schema_for, type_from_json_schema

Reading = StructType([("sensor", StringType), ("litres", IntegerType)])
Path("contract.schema.json").write_text(
    json.dumps(json_schema_for(ArrayType(Reading), draft="draft-07"), indent=2))

T = type_from_json_schema(json.loads(Path("partner.schema.json").read_text()))
```

| Signature | Notes |
|-----------|-------|
| `json_schema_for(typ, draft="2020-12") -> JsonSchema` | `draft`: `"2020-12"`, `"draft-07"` or `"openapi-3.0"`, as a consumer's validator pins. `Never`, `Function` and `AsyncFunction` raise `TypeError` naming what has no JSON form |
| `type_from_json_schema(schema) -> EastType` ❗ | Raises `JsonSchemaUnsupportedError` — its `.pointer` the RFC 6901 location, also in the message — on what East cannot express: `allOf`, `not`, `if`/`then`/`else`, `anyOf`, `patternProperties`, `prefixItems`, a union of more than one type, an open record, an optional property, an untagged `oneOf`, a non-local `$ref`, a cycle of definitions no single definition breaks |
| `EAST_JSON_PATTERNS` | The lexical forms of East JSON's scalars — `.integer` `.blob` `.float_specials` (TypeScript: `floatSpecials`) — so a reader enforces exactly what the schema describes. A DateTime has none: its form is `format: "date-time"` |

- **An `Option<T>` is `null` or `T`'s own encoding** wherever `T` can never
  encode as `null`: `none` → `null`, `some(7)` → `"7"`, a struct field
  `"note": null` or `"note": "x"` (an absent key is still an error). Only
  `Option<Null>` and `Option<Option<T>>` keep the tagged `{"type": …, "value":
  …}` object, which keeps `some(none)` apart from `none`; a recursive payload is
  judged by what it wraps. The rule is a total function of the type, applied by
  every codec and reader and by `json_schema_for` (a flat Option is `oneOf
  [null, T]` annotated `x-east-type: "Option"`), and the tagged object under a
  flat Option is refused by the payload's own decoder (`expected string, got
  {"type":"none","value":null}`).
- **A `DateTime` is `format: "date-time"`**: every decoder, on every runtime,
  reads any RFC 3339 date-time — `Z` or any offset (the instant is UTC), `t`/`z`
  in either case, any fractional digits (past the millisecond dropped, never
  rounded, so `isoformat()`'s microseconds read to the millisecond), a leap
  second as the Unix time its fields add up to — in years 0001–9999, the range
  every runtime holds. `print_json` writes UTC, three fractional digits, `+00:00`.
- **Other scalars are described as the encoder emits them**: an `Integer` is a
  quoted i64 decimal, a `Blob` lowercase hex (`parse_json` also takes uppercase,
  which the contract does not), so a producer that validates cannot send what a
  strict reader rejects. Every pattern spells digits `[0-9]` — python's `\d`
  matches any Unicode digit — so validators here and in JavaScript agree.
- **The document is deterministic and byte-identical to TypeScript's
  `jsonSchemaFor`** (key order, `$defs` names in first-encounter order, variant
  case order). Its `x-east-type` annotations make the inverse exact — `Set` vs
  `Array`, `Dict` vs an array of pairs, a flat Option vs any other `oneOf`. A
  foreign schema without them converts under a structural mapping that does not
  promise to round-trip: `format: "date-time"` reads as a `DateTime` (any other
  `format` is a `String`), and `nullable: true`, `["string", "null"]` and a
  `oneOf` of null and one schema read as an Option.
- **Recursion binds one `recursive_type` per cycle group**: definitions that
  reference each other convert when every cycle passes through one definition,
  the binder; three that each reference the other two need two binders and are
  refused, naming them.
- To READ a document larger than memory under this contract: `json_open` /
  `json_next` in **east-py-std**.
