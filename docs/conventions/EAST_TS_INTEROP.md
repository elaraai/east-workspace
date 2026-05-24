# East ↔ TypeScript interop rules

**Applies to:** any TypeScript code that produces or consumes East values
(`@elaraai/east`, `@elaraai/east-node-*`, `@elaraai/east-ui`,
`@elaraai/east-ui-components`).

These rules exist because East values have *runtime representations* that
do not match standard JavaScript primitives:

- East `IntegerType` values are `bigint`, not `number`.
- East variant types are tagged structs `{ tag, data }`, not JS
  enum-likes.
- East `StructType` and `OptionType` values require structural
  validation.
- East has a total ordering on every type (including `Float`, with
  `NaN` placed deterministically) — JS `<` / `>` / `===` do not honour
  it.

Violating these rules causes silent type drift, NaN comparison bugs,
BigInt mixing, and subtle variant-tag mismatches. Each section below has
**Do** / **Don't** examples.

---

## 1. Use `isValueOf(value, Type)` — not `typeof` or `instanceof`

`isValueOf` is the canonical runtime type check for East values. It
inspects the structural shape, not the JS runtime type.

### Do

```ts
import { isValueOf, IntegerType, StringType, NullType, variant } from "@elaraai/east";

function convertNative(value: unknown) {
    if (isValueOf(value, NullType))    return variant("Null",    null);
    if (isValueOf(value, IntegerType)) return variant("Integer", value);  // bigint
    if (isValueOf(value, StringType))  return variant("String",  value);
    return variant("Null", null);
}
```

### Don't

```ts
// WRONG — checks JS type, not East type
if (typeof value === "bigint") return variant("Integer", value);
if (typeof value === "string") return variant("String",  value);
if (value instanceof Date)     return variant("DateTime", value);  // East DateTimeType has a different shape
```

### When converting from external sources

Combine column metadata (e.g. SQL `INTEGER`) with `isValueOf` for the
narrow check:

```ts
if (columnType === "INTEGER" && (isValueOf(value, IntegerType) || isValueOf(value, FloatType))) {
    return variant("Integer", BigInt(value));  // convert if the source produced number
}
```

---

## 2. Use `compareFor` / `equalFor` / `lessFor` — not raw `===` / `<` / `>`

East defines a *total order* on every type. Raw JS operators are wrong
for two reasons: they mishandle `NaN` (any comparison returns `false`,
breaking sorts) and they don't compose across BigInt / number mixing.

### Do

```ts
import { compareFor, equalFor, lessFor, IntegerType } from "@elaraai/east";

const cmpInt = compareFor(IntegerType);
arr.sort(cmpInt);

const eqInt = equalFor(IntegerType);
if (eqInt(a, b)) { /* ... */ }

const ltInt = lessFor(IntegerType);
if (ltInt(a, b)) { /* ... */ }
```

For sorted containers, **always** pass `compareFor(KeyType)` to
`SortedMap` / `SortedSet`:

```ts
const m = new SortedMap(compareFor(IntegerType));  // good
const m = new SortedMap((a, b) => /* hand-rolled */);  // BAD — drift, no NaN handling
```

### Don't

```ts
if (a === b) { /* WRONG — fails for BigInt vs number, fails for structs */ }
arr.sort((a, b) => a - b);  // WRONG — overflows BigInt, mis-orders NaN
```

---

## 3. Use `variant()` / `some()` / `none` — never hand-roll tagged objects

East variants have an internal shape that may evolve. Hand-rolling
`{ tag, data }` literals locks consumer code to today's representation
and will silently break if the runtime changes.

### Do

```ts
import { variant, some, none, type option } from "@elaraai/east";

const v = variant("Integer", 42n);
const present = some(42n);
const absent  = none;
```

### Don't

```ts
const v = { tag: "Integer", data: 42n };       // WRONG
const present = { tag: "some", data: 42n };    // WRONG
const absent  = { tag: "none", data: null };   // WRONG
```

This rule is **absolute** — there is no scenario where hand-rolled
variants are correct.

---

## 4. Use `$.let(value, Type)` / `$.const(value, Type)` — not `East.value()`

Inside `East.function(...)` blocks, declare variables with `$.let` (mutable)
or `$.const` (immutable) and pass the East type as the second argument.
`East.value()` is the older API and obscures the type at the call site.

### Do

```ts
import { East, ArrayType, IntegerType } from "@elaraai/east";

East.function([], IntegerType, ($) => {
    const xs = $.const([1n, 2n, 3n], ArrayType(IntegerType));   // good
    const acc = $.let(0n, IntegerType);                          // good (mutable)
    return xs.reduce(($, a, x) => a.add(x), acc);
});
```

### Don't

```ts
const xs = East.value([1n, 2n, 3n]);   // avoid — type erased at call site
```

---

## 5. Callbacks pulled from East structs: memoize and unwrap

When a renderer or factory receives an `option<Fn>` callback from a
`SubtypeExprOrValue` style field, extract with `getSomeorUndefined` and
memoize the result:

```ts
const onClickFn = useMemo(() => getSomeorUndefined(value.onClick), [value.onClick]);
```

Then defer execution to outside the render path (UI rule, but the
extraction pattern is universal):

```ts
if (onClickFn) queueMicrotask(() => onClickFn(arg));
```

See `libs/east-ui/packages/east-ui-components/CLAUDE.md` for the full
interactive-state renderer pattern.

---

## 6. Quick reference

| Operation | Correct API | Don't |
|---|---|---|
| Runtime type check | `isValueOf(v, T)` | `typeof v`, `instanceof` |
| Equality | `equalFor(T)(a, b)` | `a === b` |
| Less-than | `lessFor(T)(a, b)` | `a < b` |
| Sort comparator | `compareFor(T)` | hand-rolled `(a,b)=>...` |
| Construct variant | `variant("Tag", data)` | `{ tag, data }` |
| Construct option | `some(x)` / `none` | `{ tag: "some", data: x }` |
| Declare expr var | `$.let(v, T)` / `$.const(v, T)` | `East.value(v)` |
