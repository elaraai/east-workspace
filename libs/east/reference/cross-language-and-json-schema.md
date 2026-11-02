# Cross-language functions and JSON contracts

`East.importFunction` / `East.exportFunctions`, and `jsonSchemaFor` / `typeFromJsonSchema`. Part of the `east` skill.

## Cross-language functions: `East.importFunction` / `East.exportFunctions`

A function authored in python (with its `East.function`) is called from a
TypeScript body by name, and the other way round; the deployed program is pure
IR. Functions travel as a **manifest** — their IR, declared types and platform
dependencies. In an e3 project `e3.export` builds and links manifests itself
(see **e3**); by hand:

```bash
east-py export-functions pricing -o pricing.functions.beast2 -p east-py-std     # python side
east-node export-functions dist/maths.js -o maths.functions.beast2               # reads the module's `eastFunctions`
```

```typescript
const score = East.importFunction("pricing", "score", FunctionType([RowType], FloatType));   // typed, callable
const total = East.function([ArrayType(RowType)], FloatType, ($, rows) => rows.map(($, r) => score(r)).sum());

// in-process: link, then compile — linkImports returns a sync or async function's IR
const { ir } = East.linkImports(total, [East.decodeFunctionManifest(readFileSync("pricing.functions.beast2"))]);
new EastIR(ir as FunctionIR).compile([])(rows);

// export TypeScript functions for python to import
writeFileSync("maths.functions.beast2", East.encodeFunctionManifest(East.exportFunctions("maths", "1.0.0", { double, halve })));
```

- The declared type must equal the exported type **exactly** — a mismatch is a
  build error naming both. Unlinked, the reference is a `Platform` node named
  `east.importFunction`, so compiling it without linking fails loudly.
- Only closed values export: no captures, and no unresolved imports of their own.
- A manifest carries each function's source map: `linkImports` adds its
  locations to the importer's map, which it returns as `sourceMap`, so an
  error or a profile names the exporter's source — the python line included.
- The imported function's platform calls must be provided by the consuming
  runner (stock families count across runtimes: `east-py-std` ≡
  `@elaraai/east-node-std` ≡ `east-c-std`). See `docs/conventions/EAST_CODEGEN.md`.

## A JSON contract for a type: `jsonSchemaFor` / `typeFromJsonSchema`

`East.String.printJson` writes East JSON, lossless and self-describing.
`jsonSchemaFor(T)` emits the JSON Schema of exactly that encoding, so a third
party can validate a payload before sending it; `typeFromJsonSchema` goes the
other way. Both are host-side, like `compareFor`.

```typescript
writeFileSync("contract.schema.json", JSON.stringify(jsonSchemaFor(ArrayType(ReadingType), { draft: "draft-07" }), null, 2));
const T = typeFromJsonSchema(JSON.parse(readFileSync("partner.schema.json", "utf-8")));
```

| Signature | Description |
|-----------|-------------|
| `jsonSchemaFor(type, options?: { draft }): JsonSchema` | The schema of `type`'s East JSON. `draft`: `"2020-12"` (default), `"draft-07"` or `"openapi-3.0"`. Throws on `Never`, `Function`, `AsyncFunction` |
| `typeFromJsonSchema(schema): EastType` | The type a schema describes. Throws `JsonSchemaUnsupportedError`, with the RFC 6901 pointer, on a keyword East cannot express (`allOf`, `not`, `if`/`then`/`else`, `anyOf`, an open record, …) |
| `EAST_JSON_PATTERNS` | The lexical forms of East JSON's scalars (`integer`, `blob`, `floatSpecials`), for a reader enforcing exactly what the schema says |

- **An `Option<T>` is `null` or `T`'s own encoding** wherever `T` can never
  encode as `null` (`none` → `null`, `some(7n)` → `"7"`; a struct field is
  `"note": null` or `"note": "x"`, and an absent key is still an error). Only
  `Option<Null>` and `Option<Option<T>>` keep the tagged
  `{"type": …, "value": …}` object. A `Recursive` payload is judged by what it
  wraps. The rule is a total function of the type, the same on every runtime,
  and the tagged object under a flat Option is refused by the payload's decoder
  (`expected string, got {"type":"none","value":null}`).
- **A `DateTime` is `format: "date-time"`**: every decoder reads any RFC 3339
  date-time — `Z` or any offset (read as UTC), `t`/`z` in either case, any
  fractional digits (past the millisecond dropped, never rounded), a leap second
  as the Unix time its fields add up to — in years 0001–9999. `printJson`
  writes one form: UTC, three fractional digits, `+00:00`.
- **Other scalars are described as the encoder emits them**: an `Integer` a
  quoted i64 decimal, a `Blob` lowercase hex (`parseJson` also takes uppercase,
  which the contract does not), so a producer that validates never sends what
  the strict reader rejects. The patterns spell digits `[0-9]`, so python and
  JavaScript validators accept the same strings.
- **The document is deterministic and identical across languages** (east-py's
  `json_schema_for` emits the same bytes), and its `x-east-type` annotations
  make the inverse exact: `Set` vs `Array`, `Dict` vs an array of pairs, a flat
  Option vs any `oneOf`. A foreign schema without them converts by a
  documented structural mapping; `nullable: true`, `["string", "null"]` and a
  `oneOf` of null and one schema read as an Option, and a
  `format: "date-time"` string as a `DateTime`.
- **Recursion binds one `RecursiveType` per cycle group**; definitions that
  need two binders are refused, naming them.
- To READ a JSON document larger than memory under a contract, use `Json.open`
  / `Json.next` from **east-node-std** (and its east-py-std and east-c-std twins).
