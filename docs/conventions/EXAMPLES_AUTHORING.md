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

---

## 8. Consolidation: the five example slots (east-ui / e3-ui)

Examples serve three masters — the plugin search index, visual
demonstration (showcase / rendered captures / goldens), and the
examples↔tests contract — and none of them require one-prop-per-example
granularity. UI example files stay small by construction: a component's
examples file may contain ONLY the following slots, each at most once
unless a slot is justified per-feature. (Files with fewer than 5
examples are under the slot budget already and are exempt.)

### The five example slots per component (keep-rules)

1. **`<name>Basic`** — smallest meaningful usage; the search-index
   front door.
2. **`<name>Variants`** — ONE variant-space example, in one of two
   forms:
   - **A live `<Configurator>` surface** — the preferred form for
     style-axis components: every prop axis is a plain array of the
     values themselves (`getTag()` supplies the key and label), one
     `State.bind` per axis, the same array feeding the control widget
     and the preview; switch pairs report through `Slot` + `Spec` rows
     and reactive counters live in the `aside`. The control widget
     matches the axis: `SegmentGroup` for ≤5 short-token options that
     should all be visible at once, `Select` for longer or wordier
     enumerations (presets, modes, palettes), `Input.Integer` /
     `Input.Float` / `Slider` for expression-fed numeric props, and
     `Switch` for booleans. Exemplar: `display/badge.examples.tsx`.
   - **A static enumeration panel** (`VStack` of
     `<Separator label>`-bounded groups) ONLY where seeing every row at
     once is the point — the aligned-stack catalogue
     (`alignedStackAll`), the slice-effect pair (`schematicSlice`) and
     the slice rails. Everything else — status grammars, event/lifecycle
     grammars, data-shape enumerations, canvas-content variants, sizing
     contracts — is a configurator axis (a preset/data axis swaps whole
     fixtures or component subtrees; `fill`/`scroll` are presets): see
     `plannerVariants`, `ganttVariants`, `bannerStatusVariants`,
     `mapOverlayVariants`, `schematicVariants`, `columnBarVariants`.
     Control lanes carry controls ONLY — no hint strings, no caption
     `Text` beside switches; scope notes live in short label
     parentheticals (`"Movable (move)"`).
3. **`<name>Configurator`** — a SEPARATE interactive combo-configurator
   only when a behavioral space needs its own surface beside the
   Variants slot (exemplar: `schematicInteractions`). A probe-referenced name that becomes a configurator
   keeps its name so the probe stays valid; probes that need a specific
   combination on screen retarget in the same PR.
4. **`<name><Behavior>`** — one example per behavioral contract needing
   isolation: DnD flows, review chrome, slice binding, deep-linking,
   overlay stacking. Anything referenced by name from
   `east-ui-components/scripts/probe-*.ts`, `snapshot.ts`, or
   `east-ui-showcase/tests/responsive/*` stays isolated (or the
   referencing script is updated in the same PR — never silently
   broken).
5. **`<name>Stress`** — perf/scale demonstrations (virtualized rows,
   500-unit schematic). Keep.

### Panel construction

A panel (Variants slot, or any merged multi-row example) is a
`VStack gap='4'` of labelled groups: each merged example contributes a
`<Separator label="GROUP LABEL" align="start" />` boundary followed by
its render tree, verbatim. Separator coerces the string label to the
caption style AND draws a hairline, so a section boundary never reads
like the content's own field labels (a hand-rolled caption `Text` is
typographically identical to field labels — don't use one). All data
fixtures are hoisted to module scope as `SCREAMING_SNAKE` consts (no TS
helper calls inside East bodies — east#990020). Every merged example's
rendering remains individually visible in the capture.

### Keyword-union rule

When examples merge, the surviving example's `keywords` = the **union**
of all merged examples' keywords (dedup, order: component, feature
terms, synonyms), and its `description` must enumerate the covered
features in prose ("variants solid/outline/ghost/plain; sizes sm–lg;
loading, disabled, icons"). Search findability lives in
keywords/description, not example count — no capability term may be
dropped.

### Visual-guard rule

Any combination that must stay visually regression-guarded may not hide
behind a switch — it belongs in a static Variants panel row (always
rendered, always captured) or keeps its own example.

### Uniform cascade per consolidation PR

1. Rewrite the sibling `*.spec.ts` (it imports every example by name —
   the examples↔tests contract).
2. Update any probe/golden references (probe/golden-coupled export
   names are frozen or explicitly retargeted — never silently broken).
3. `make test && make lint` in `libs/east-ui` (East diagnostics live —
   no TS helper calls inside East bodies, east#990020).
4. Re-bank responsive goldens if the component is in the catalog
   (`make test-responsive-bank`, review diff).
5. Regenerate the plugin search index (`plugin-artifacts` workflow) —
   **coordinate before touching** per root CLAUDE.md (skills/index are
   plugin-facing).
6. Regenerate rendered design captures (`make east-ui-examples-html-all`
   + `node scripts/design-example-cards.mjs`) — consolidations improve
   the per-component card.
