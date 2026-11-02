# East values in TypeScript

Host-side functions over East values (no expression, no IR), and building programs over names and types held as values. Part of the `east` skill.

## Values in TypeScript

Host-side functions for East values — build time, no expression, no IR. Each
takes the type and returns a function (`compareFor(T)(a, b)`).

| Signature | Description |
|-----------|-------------|
| **Comparing** |
| `compareFor(T)(a, b): -1 \| 0 \| 1` | East's total order — the order sets, dicts and `.sort()` use (NaN last) |
| `equalFor(T)`, `notEqualFor(T)`, `lessFor(T)`, `lessEqualFor(T)`, `greaterFor(T)`, `greaterEqualFor(T)` | The comparisons as East defines them: by value, NaN equal to itself and −0 apart from 0, variants by case name. Never `===`, `<` or a comparator of your own |
| `isFor(T)(a, b)` | East's `Is`: value for immutable types, identity for mutable containers — but two frozen collections by value, and a `Ref` always by identity |
| `new SortedMap(entries?, compareFor(K))` · `new SortedSet(values?, compareFor(K))` | `Map` / `Set` in East order — what decoders return |
| **Types** |
| `isValueOf(value, T)` | Whether a TypeScript value is a value of `T` |
| `printType(T)` · `isTypeEqual(a, b)` · `isSubtype(a, b)` | Print a type in East text; compare types |
| `diffTypes(actual, expected)` → `renderTypeDiff(diffs)` | The differences between two types, each with its path |
| `defaultValue(T)` · `minimalValue(T)` | A value of `T`: its default, and its least |
| **Codecs** — each `…For(T)` builds a codec for one type |
| `printFor(T)(value)` · `parseFor(T)(text)` | East text, the literal syntax `.east` files hold. `parseFor` returns `{ success, value \| error, position }`; `parseInferred(text)` returns `[type, value]` |
| `toJSONFor(T)(value)` · `fromJSONFor(T)(json)` | East JSON as a JavaScript value (`encodeJSONFor` / `decodeJSONFor` as bytes): lossless — an Integer a quoted decimal, a Blob hex, a flat Option (see JSON Schema) |
| `encodeCsvFor(StructT, config?)(rows)` · `decodeCsvFor(StructT, config?)(blob)` | An array of structs ↔ CSV bytes |
| `encodeBeast2For(T)(value)` · `decodeBeast2For(T)(blob)` | beast2, the binary form every runtime and e3 store — see below |

## Names and types held as values

East names a struct's fields and a variant's cases where its code is written:
`row.site`, `variant("load", x)`. Code that builds programs over types it is
handed — a library generating a program for whatever record its caller
declares — holds the names, and the types, as values. These build the same
program pieces from them, and check each name against the type as the program
is built: a name the type lacks fails there, naming the name and the type
(`East.field: .Struct {name, site, status} has no field 'job'`). Nothing in the
program differs from what the written form builds, so every runtime runs it.

```typescript
const Machine = StructType({ name: StringType, site: StringType, status: StringType });
const Reading = VariantType({ load: FloatType, output: FloatType });

const site = "site";                                       // a name a caller hands you
const siteOf = East.function([Machine], StringType, ($, machine) =>
    East.field(machine, site, StringType));                // typed by the type given, which is checked

const stopped = East.function([Machine], Machine, ($, machine) =>
    East.withField(machine, "status", "down"));            // the other fields as they are

const Place = StructType({ site: StringType, name: StringType });
const placeOf = East.function([Machine], Place, ($, machine) =>
    East.struct(Place, East.fields(machine, ["site", "name"])));   // by name, or in the type's order

const readingOf = (place: string) => East.function([FloatType], Reading, ($, x) =>
    East.inCase(Reading, place, x));                       // a variant's case by name

const { diff, apply, compose, invert } = East.patchesFor(Machine);   // East functions of a type held as a value
```

A recursive value is read, and rebuilt, through its node. `fields` and
`withField` read the value once a field: give them a variable, not a
computation. Code whose names are written keeps writing `row.site`.
