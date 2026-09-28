# East ↔ TypeScript interop rules

**Applies to:** any TypeScript code that produces or consumes East values
(`@elaraai/east`, `@elaraai/east-node-*`, `@elaraai/east-ui`,
`@elaraai/east-ui-components`, `@elaraai/e3-ui-components`).

> **HARD RULE:** an East value is printed, read, compared, ordered, collected
> and typed through East's utilities — never a JavaScript stand-in — and
> tested over real, decoded East values.

These rules exist because a decoded East value is an ordinary JavaScript
value whose meaning JavaScript does not know:

- An `IntegerType` value is a `bigint`; a `FloatType` value is a `number`,
  which East prints `5.0` where JavaScript prints `5`.
- A `DateTimeType` value is a `Date`. East prints and reads it in UTC with
  no zone (`2026-06-29T00:00:00.000`); JavaScript's `new Date(text)` reads a
  zoneless date-time in local time.
- A variant (an option is one) is `{ type, value }` carrying East's
  `[variant_symbol]` brand — the mark East tells a variant by. A literal
  with the same two fields lacks it.
- A struct is a plain object. A `SetType` / `DictType` value is a `Set` /
  `Map`, or East's `SortedSet` / `SortedMap`.
- East has a total ordering on every type (including `Float`, with `NaN`
  placed deterministically) — JS `<` / `>` / `===` do not honour it.

Each of these type-checks clean when it goes wrong, and the result is silent:
a value printed so East cannot read it back, text read in the wrong
timezone, a struct key that never finds its entry, a sort that misplaces
`NaN`. Each section below has **Do** / **Don't** examples, and the last one
names the lint rule that enforces it.

---

## 1. Use `isValueOf(value, Type)` — not `typeof` or `instanceof`

`isValueOf` is the canonical runtime type check for East values. It
inspects the value against the East type, not its JS runtime type.

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

A value whose type is already known needs no check at all: narrow a variant
on its tag (`v.type === "Integer"`).

### Don't

```ts
// WRONG — asks JavaScript, not East, what the value is
if (typeof value === "bigint") return variant("Integer", value);
if (typeof value === "string") return variant("String",  value);
if (value instanceof Date)     return variant("DateTime", value);
```

---

## 2. Use `compareFor` / `equalFor` / `lessFor` — not raw `===` / `<` / `>`

East defines a *total order* on every type. Raw JS operators are wrong
for two reasons: they mishandle `NaN` (any comparison returns `false`,
breaking sorts) and they don't compose across BigInt / number mixing.
`===` on a struct, a variant, a DateTime or a Set compares which object it
is: two equal values are never `===`.

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
`SortedMap` / `SortedSet` — the entries (or values) first, the comparator
second:

```ts
const m = new SortedMap([[2n, "b"], [1n, "a"]], compareFor(IntegerType));  // good
const s = new SortedSet([], compareFor(IntegerType));                      // good — empty
const bad = new SortedMap([], (a, b) => /* hand-rolled */);                // BAD — drift, no NaN handling
```

### Don't

```ts
if (a === b) { /* WRONG — fails for BigInt vs number, fails for structs */ }
arr.sort((a, b) => a - b);  // WRONG — overflows BigInt, mis-orders NaN
```

### The same object: `Object.is`

Some code means identity, not equality: a memo or a cache asking "is this
the very object I already had?" — a fold that hands back its input
untouched when nothing folds, a value from `useDataStable` that changes
identity only when its data does. Write that as `Object.is(a, b)`, which
says so to the reader and to the lint. It is never a way to compare data:
two values decoded, built or folded separately are never the same object.

```ts
const folded = foldHeatArm(own, period, ordinal, w);
if (!Object.is(folded, own)) heatArms.set(row.key, folded);   // good — "did the fold hand back a new arm?"
```

### Values that carry functions: `equivalentFor`

`equalFor` treats every pair of functions as EQUAL — the right answer for
data. It is the wrong one for a render memo or a cache key over a value that
carries callbacks: a closure that captured new data compares equal to the old
one, and the memo or cache serves stale output. `equivalentFor(T)` is
`equalFor` everywhere except on functions, which it compares by IR and
captured values (a host function without IR only to itself).

```ts
import { equivalentFor } from "@elaraai/east";

const rootEqual = equivalentFor(PlanRootType);   // memo comparer over a value with callbacks
```

A renderer uses both: `equivalentFor` for its memo (a changed callback must
re-render), `equalFor` for anything that resets local state (a changed callback
must not wipe what the user typed) — east-ui-components' `useValueSync` /
`useDataStable` gate on it.

---

## 3. Use `variant()` / `some()` / `none` — never build a variant by hand

A variant is `{ type, value }` plus East's `[variant_symbol]` brand, and a
literal with the same two fields does not carry it. East tells a variant by
the brand: `isVariant` and `isValueOf` reject the literal, and `East.value(x, T)`
— the door every value takes into an East program or a factory — throws
`Expected variant but got object` (untyped, it reads the literal as a struct).
The paths that only read the two fields (printing, comparing, encoding) let
it through, so a hand-built value works until it reaches one that checks —
and a test comparing whole values fails on it (§10).

### Do

```ts
import { variant, some, none, type option } from "@elaraai/east";

const v = variant("Integer", 42n);
const present = some(42n);
const absent  = none;
```

### Don't

```ts
const v = { type: "Integer", value: 42n };       // WRONG — no brand
const present = { type: "some", value: 42n };    // WRONG
const absent  = variant("none", null);           // WRONG — `none`, and `some(x)` for the other arm
```

This rule is **absolute** — there is no scenario where a hand-built variant
is correct, in source or in a test.

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

## 6. Frozen values: value-`Is`, copy-first mutation

Task inputs always decode **deeply frozen** (and any code can produce a
frozen value via the `frozen` decode option). Two semantics change for
frozen values, nothing else:

- **East `Is` compares frozen collections by value.** `isFor(T)` on two
  frozen Array/Set/Dict/Vector/Matrix values is deep value equality (the
  Blob precedent — a frozen collection is a value, not a mutable cell). A
  frozen `Ref` remains an identity cell. `equalFor` / `compareFor` / print /
  encode are unchanged.
- **Mutation throws** `cannot mutate a frozen value (task inputs are
  immutable) — copy first`. `.copy()` is the escape hatch.

Check frozenness with `isFrozenValue(v)` — never `Object.isFrozen`, which
misses typed arrays (they cannot be frozen and carry a WeakSet brand
instead) and pager-backed lazy values.

---

## 7. Print and read through East

JavaScript prints and reads East values its own way: a Float `5` for East's
`5.0` (and `0` for `-0.0`), a DateTime in local time or with a `Z`, a Blob as
`1,2,3`, a struct or variant as `[object Object]` or as JSON East cannot read
back. Reading is worse: `BigInt("")` is `0n` and `BigInt("0x10")` is `16n`,
`Number("")` is `0`, and `new Date("2026-06-29T00:00:00")` is local time.

### Do

```ts
import { DateTimeType, FloatType, parseFor, printFor } from "@elaraai/east";

const printAt = printFor(DateTimeType);
const key = printAt(row.at);                    // "2026-06-29T00:00:00.000" — East's text, UTC

const readAt = parseFor(DateTimeType);
const read = readAt(text);                      // East's text in, a result out
if (read.success) onChange(read.value);         // act on success; `read.error` says why not
```

- East's text — a key, a DOM attribute, anything read back — is
  `printFor(T)` and `parseFor(T)`.
- Text for a person prints in the viewer's language through the locale
  formatters (east-ui-components' `useFormatters()` / `formatters(locale)`),
  never through `printFor`.
- A String, an Integer and a Boolean print the same either way.
- A number written as a CSS length (`` `${w}px` ``) is style the browser
  reads, not a print: JavaScript's number is right there, and East's `5.0` or
  a German `1.234,5` would be wrong.
- Text written in the source is its author's: `new Date("2026-06-29T00:00:00Z")`
  is fine. A zoneless date-time handed to `new Date` is not — it reads in
  local time.

### Don't

```ts
const key = `${row.x}`;                    // WRONG — `5` where East prints `5.0`
const at = row.at.toISOString();           // WRONG — a `Z` East never prints
const blob = JSON.stringify(row);          // WRONG — JSON East cannot read back
onChange(BigInt(input.value));             // WRONG — "" is 0n, "0x10" is 16n
const when = new Date(input.value);        // WRONG — a zoneless date-time reads local
```

---

## 8. Collect through East

A `SetType` / `DictType` value is a JavaScript `Set` / `Map` when its keys
are primitives — `new Map([["a", 1n]])`, `new Set([1n])` is East's idiom
for String, Integer, Float and Boolean keys. A JavaScript collection looks a
key up by identity, though, so a key that is an object — a struct, a
variant, a DateTime, a Blob — needs East's own collection, ordered by the
key type:

### Do

```ts
import { SortedMap, SortedSet, compareFor } from "@elaraai/east";

const byMachine = new SortedMap([[{ machine: "press", shift: 2n }, 1980n]], compareFor(MachineKeyType));
const days = new SortedSet([row.at], compareFor(DateTimeType));
```

### Don't

```ts
const byMachine = new Map([[{ machine: "press", shift: 2n }, 1980n]]);   // WRONG — an equal struct never finds it
const days = new Set([row.at]);                                         // WRONG — an equal Date never finds it
```

Until #968 lands, a plain `Set` / `Map` built out of East order is walked
in insertion order by some TypeScript paths (compiled loops, `printFor`,
`compareFor`, the beast2 v4 encoder). Build a primitive-keyed collection in
East order, or as a `SortedSet` / `SortedMap`, where its order is observable.

---

## 9. Type decoded values from the East type

A decoded value's TypeScript type is `ValueTypeOf<typeof FooType>` — never a
hand-written mirror. A mirror drifts the moment the East type gains a field
or an arm, with no compiler complaint: a renderer's hand-rolled `ConfigValue`
silently missed three new config fields this way.

### Do

```ts
import { type option, type ValueTypeOf } from "@elaraai/east";

type SliceStateValue = ValueTypeOf<typeof SliceStateType>;
type PlanRootValue = ValueTypeOf<typeof Plan.Types.Root>;

// Narrow a decoded union on its tag — the arms' types come with it.
if (root.rows.type !== "paged") throw new Error(`expected a paged canvas, got its ${root.rows.type} arm`);
const source = root.rows.value;

declare function page(offset: bigint, limit: bigint): option<readonly Row[]>;
```

### Don't

```ts
const paged = root.rows as { type: string; value: Record<string, unknown> };  // WRONG — hides the real type
interface StateLike { range: { type: string; value: unknown }; search: string } // WRONG — a mirror that drifts
```

---

## 10. Test over real, decoded values

A test's fixtures are East values, so everything above holds in tests too —
and a test built from hand-shaped stand-ins passes against code that would
fail on the real thing.

- Type every fixture `ValueTypeOf<…>` (or build it with the package's typed
  helper, like east-ui-components' `sliceConfig(…)`): the compiler then
  checks every field. A partial fixture once hid a missing `fieldHints` the
  engine tolerated, until the engine stopped tolerating it.
- Compare whole values. `expect(ref).toEqual(variant("run", { row, run: "b214" }))`
  compares East's brand too, so a hand-built `{ type, value }` coming back
  from the code under test fails the assertion — reading `.type` and
  `.value` field by field does not catch it.
- Narrow a decoded union on its tag instead of casting it
  (`if (ui.type !== "Plan") throw …`).
- Write instants as East prints a DateTime and read them with East's parser
  (the Plan tests' `timeAt("2026-06-29T00:00:00")`), not with `new Date`.
- Assert identity with `toBe` / `Object.is` only where the code promises
  the same object (§2).

---

## 11. What enforces this

`east/east-rules` (`@elaraai/eslint-plugin-east`) runs the host-value rules
— its exported `hostValueRules` — over source and tests in the UI packages'
`make lint`, at `error`. Each rule recognises an East value by where its
type comes from (a `ValueTypeOf` struct, a `[variant_symbol]` member, a
`SortedSet` / `SortedMap`, or a field, payload or element read out of one),
never by a name list.

| Section | Rule |
|---|---|
| §1 | `no-js-type-dispatch-on-east-values` |
| §2 | `no-host-comparison-on-east-values` |
| §3 | `no-handrolled-variant`, `prefer-some-none` |
| §7 | `no-host-print-of-east-values`, `no-host-parse-to-east-values` |
| §8 | `no-js-collection-for-east-collection` |
| §9, §10 | `no-handrolled-value-type-mirror` |

A finding is fixed, never exempted: no file lists, no disable comments. A
rule that flags correct code gets more precise, with a spec for the case.

---

## 12. Quick reference

| Operation | Correct API | Don't |
|---|---|---|
| Runtime type check | `isValueOf(v, T)`, or the tag `v.type` | `typeof v`, `instanceof` |
| Equality | `equalFor(T)(a, b)` | `a === b` |
| The same object (memo, cache) | `Object.is(a, b)` | `a === b` on East values |
| Memo / cache key over a value with functions | `equivalentFor(T)(a, b)` | `equalFor(T)` (every function compares equal) |
| Less-than | `lessFor(T)(a, b)` | `a < b` |
| Sort comparator | `compareFor(T)` | hand-rolled `(a,b)=>...`, `a - b` |
| Construct variant | `variant("Tag", data)` | `{ type: "Tag", value: data }` |
| Construct option | `some(x)` / `none` | `{ type: "some", value: x }`, `variant("some", x)` |
| Print East's text | `printFor(T)(v)` | `String(v)`, `` `${v}` ``, `v.toISOString()`, `JSON.stringify(v)` |
| Print for a person | the locale formatters | `String(v)`, `toLocaleString()` |
| Read text | `parseFor(T)(text)`, then `success` | `BigInt(text)`, `Number(text)`, `new Date(text)`, `JSON.parse(text)` |
| Set / Dict keyed by a struct, variant or DateTime | `new SortedSet(xs, compareFor(K))`, `new SortedMap(entries, compareFor(K))` | `new Set(xs)`, `new Map(entries)` |
| Decoded value's type | `ValueTypeOf<typeof T>`, narrowed on `.type` | `{ type: string; value: … }` casts, `*Like` mirrors |
| Test assertion | `toEqual(variant(…))` over real values | reading a hand-built value field by field |
| Declare expr var | `$.let(v, T)` / `$.const(v, T)` | `East.value(v)` |
| Frozen check | `isFrozenValue(v)` | `Object.isFrozen(v)` (misses typed arrays, lazy values) |
