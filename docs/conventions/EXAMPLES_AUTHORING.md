# Examples authoring guide

**Applies to:** every TypeScript spec/test suite under `libs/east/test/`,
`libs/east-node/packages/*/test/`, `libs/east-ui/packages/*/test/`.

**Does NOT apply to:** `libs/east-py/packages/east-py-datascience/tests/`
(those are Python `pytest` — a different workflow).

This guide is the canonical reference for the `*.spec.ts` ↔
`*.examples.ts` pattern used across the monorepo. Examples serve two
purposes: they're tested as part of the test suite, and they're
extracted into a search index for AI agent context.

---

## 1. File pairing

Every `*.spec.ts` file has a companion `*.examples.ts` file:

| Spec | Examples |
|---|---|
| `array.spec.ts` | `array.examples.ts` |
| `button.spec.ts` | `button.examples.ts` |
| `dict.spec.ts` | `dict.examples.ts` |

The examples file is **not optional**. Every distinct expression method
or stdlib method exercised in a spec must have a corresponding `example()`
export. No exceptions for "internal" or "serialization-heavy" methods.

---

## 2. Import discipline

Tests and examples import from the **published package name**, never
from `../src/...`. This forces the test suite to exercise the same
public API external consumers use.

### Do

```ts
import { East, ArrayType, IntegerType, example } from "@elaraai/east";
import { describeEast, Assert, Console } from "@elaraai/east-node-std";
import { SQL } from "@elaraai/east-node-io";              // namespaced API
import { Button, Stack, UIComponentType } from "@elaraai/east-ui";
```

### Don't

```ts
import { Console } from "../src/console.js";                    // WRONG
import { sqlite_connect } from "../src/sql/sqlite.js";          // WRONG
import { Button } from "../../src/index.js";                    // WRONG
```

**Build first.** Tests run with `tsx` directly from TypeScript, but the
package imports resolve through each package's `dist/` output. Run
`make build` before `make test`.

---

## 3. The `example()` helper

Each example is an exported `const` using the `example()` helper:

```ts
export const arrayReduce = example({
    keywords: ["array", "ArrayType", "reduce", "fold", "aggregation"],
    description: "Reduce an array to a single value with an initial accumulator",
    fn: East.function([], IntegerType, ($) => {
        const a = $.const([1n, 2n, 3n], ArrayType(IntegerType));
        return a.reduce(($, acc, x) => acc.add(x), 10n);
    }),
    inputs: [],
    returns: 16n,
});
```

Field semantics:

| Field | Required? | Notes |
|---|---|---|
| `keywords` | Yes | API method names, type names, concepts. Used for search indexing. |
| `description` | Yes | Human-readable; used as the test name. |
| `fn` | Yes | An `East.function(...)` call — the same thing users would write. |
| `inputs` | Yes | Arguments to call `fn` with. Use `[]` for zero-arg functions. |
| `returns` | Conditional | Expected return value. Omit only when the return type is `NullType` (side-effect example) or `UIComponentType` (cannot literalize). |

---

## 4. Authoring rules

1. **Use `$.let` / `$.const` with explicit East type.**
   ```ts
   const a = $.const([1n, 2n, 3n], ArrayType(IntegerType));   // good
   const b = $.let([], ArrayType(IntegerType));                // good (mutable)
   const c = East.value([1n, 2n, 3n]);                         // avoid
   ```
   See `EAST_TS_INTEROP.md` §4.

2. **Use the spec file as reference.** It has working, tested examples
   for every API method. Port the patterns; don't guess at signatures.

3. **Provide `returns` when the return type is non-null.** If `returns`
   is omitted, `assertEast.examples` wraps the call as a statement
   `$(ex.fn(...ex.inputs))` — this fails unless the return type is
   `NullType` (or `UIComponentType` — see §6).

4. **Type-annotate `returns` when the JS literal is ambiguous.** For
   `Map` values with union types (e.g. `option<T>` mixing `some` /
   `none`), spell the generics out:
   ```ts
   returns: new Map<bigint, option<bigint>>([[0n, some(3n)], [1n, none]]),
   ```
   Import `option` as a type: `import type { option } from "@elaraai/east";`

5. **Hand-verify `returns`.** Compute by hand or run the spec test.
   Wrong `returns` cause test failures (or worse, false passes).

6. **Default to zero-arg `fn`.** Most examples use
   `East.function([], ReturnType, ($) => { ... })` with `inputs: []`.
   Only parameterize when the example is *about* a parameterized
   function.

7. **One example per concept.** Cover each API method with a focused
   example. Don't combine multiple unrelated operations.

8. **HARD RULE: every method tested in a spec MUST have an example.** No
   exceptions. If the spec exercises `foo.bar()`, the examples file
   has an example for `bar`.

---

## 5. Wiring examples into spec files

Import the examples and register them with `assert.examples()` (or
`Assert.examples()`, depending on which test harness). **Use named keys
— don't pass the module object directly.**

```ts
import * as ex from "./array.examples.js";

await describe("Array", (test) => {
    assert.examples(test, { arraySize: ex.arraySize, arrayGet: ex.arrayGet });

    test("Array ops", $ => { /* detailed tests */ });

    assert.examples(test, { arraySort: ex.arraySort, arraySortByKey: ex.arraySortByKey });

    test("Sorting", $ => { /* detailed tests */ });
});
```

Place each `assert.examples(...)` call **before** the related test
section so examples appear grouped with their tests.

### How it works (reference)

`assertEast.examples` (defined in `platforms.spec.ts`) does, for each
example:

- If `returns` is defined: call `fn(...inputs)`, store in `$.let`,
  assert `equal(result, returns)`.
- If `returns` is undefined: call `$(fn(...inputs))` as a statement.

---

## 6. UI-specific delta (east-ui only)

These rules layer on top of the above for east-ui examples:

1. **Omit `returns` for `UIComponentType` examples.** The recursive
   variant cannot be represented as a JS literal. The framework
   evaluates the function and verifies it compiles.

2. **All `State.*` calls must be inside `Reactive.Root`'s inner
   function.** Otherwise the outer function becomes async (because
   `State.*` are marked `optional: true`) and the analyzer fails with
   `AsyncFunction body returns type UIComponentType`.

   ```ts
   // CORRECT
   fn: East.function([], UIComponentType, (_$) => {
       return Reactive.Root(East.function([], UIComponentType, $ => {
           const count = $.let(State.read([IntegerType], "counter"), IntegerType);
           // ...
       }));
   }),

   // WRONG — State in outer fn body causes async promotion
   fn: East.function([], UIComponentType, ($) => {
       const count = $.let(State.read([IntegerType], "counter"), IntegerType);
       return Reactive.Root(/* ... */);
   }),
   ```

3. **Store callback closures in `$.const` (or `$.let`).** Bare JS `const`
   isn't tracked by the East block builder.

   ```ts
   // CORRECT
   const increment = $.const(East.function([], NullType, $ => {
       const current = $.let(State.read([IntegerType], "counter"), IntegerType);
       $(State.write([IntegerType], "counter", current.add(1n)));
   }));
   Button.Root("+", { onClick: increment });

   // WRONG — not tracked
   const increment = East.function([], NullType, $ => { ... });
   ```

4. **Use string literals for style properties.** `SubtypeExprOrValue`
   accepts string shorthand:
   ```ts
   Button.Root("Save", { variant: "solid", colorPalette: "blue", size: "md" });
   ```

5. **`@example` parity.** Every TypeDoc `@example` block on a factory
   function (`Button.Root`, `Stack.Root`, etc.) MUST appear as a
   matching `example()` export in the corresponding `.examples.ts`
   file. If you change one, change the other. See east-ui
   `STANDARDS.md`.

---

## 7. Workflow for adding examples to a new spec file

1. Read the spec file thoroughly. Note every tested API method.
2. Create `*.examples.ts` with imports from `@elaraai/east` (and
   `@elaraai/east-ui` if UI).
3. For each API method, create an `example()` export — omit `returns`
   only when justified per §3 / §6.1.
4. For interactive UI components, include at least one `Reactive.Root`
   example.
5. In the spec file: `import * as ex from "./<name>.examples.js";`
6. Add `assert.examples(test, { key: ex.key, ... })` calls before each
   related test section.
7. Run `make build && make test` to verify.
