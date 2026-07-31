# east-ui test suite — UI-specific rules

The general `*.spec.ts` ↔ `*.examples.ts` pattern is documented in
[`../../../../../docs/conventions/EXAMPLES_AUTHORING.md`](../../../../../docs/conventions/EXAMPLES_AUTHORING.md).
Read that first. This file only covers what's different for east-ui.

## Consolidated example structure (five slots)

Example files follow the **five-slot consolidation rules** of
[`EXAMPLES_AUTHORING.md §8`](../../../../../docs/conventions/EXAMPLES_AUTHORING.md#8-consolidation-the-five-example-slots-east-ui--e3-ui):
per component at most `<name>Basic`, ONE static `<name>Variants`
enumeration panel (captioned rows), ONE interactive
`<name>Configurator`, per-behavioral-contract isolates, and
`<name>Stress`. Merged examples keep the **union** of keywords and a
feature-enumerating description; visually regression-guarded
combinations never hide behind a configurator switch. Export names
referenced from `east-ui-components/scripts/probe-*.ts`, `snapshot.ts`,
or `east-ui-showcase/tests/responsive/*` are frozen — retarget the
referencing script in the same PR or don't touch the name. Every
consolidation rewrites the sibling `*.spec.ts` in lockstep (the
examples↔tests contract) and runs the §8 cascade (goldens, plugin
index, rendered captures).

## Test platform

Tests use `TestImpl` (only `testPass` / `testFail` implementations). It
does NOT include `State` or other UI platform implementations:

- Examples that use `State.read`, `State.write`, `State.has` still
  compile and register as tests.
- The State calls inside `Reactive.Root` are wrapped in a precompiled
  function body that is **not** executed during testing — only the outer
  function is evaluated.
- The test verifies that the example compiles and produces valid East
  IR, not that the State interactions work at runtime.

```ts
describeEast("Button", (test) => {
    // ...tests...
}, { platformFns: TestImpl });
```

## Imports

Use **package self-reference**. `@elaraai/east-ui` resolves through this
package's own `exports` map. `make build` must have produced
`dist/src/index.js` for resolution to work.

```ts
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Text, Stack, Reactive, State, UIComponentType } from "@elaraai/east-ui";
```

## TypeDoc ↔ examples parity (HARD RULE)

Every `@example` block shown in TypeDoc (factory functions like
`Button.Root`, the `Xxx.Root` property JSDoc inside namespace objects)
MUST have a matching entry in the corresponding
`test/<cat>/<comp>.examples.ts` file. This is the same rule codified in
[`../STANDARDS.md`](../STANDARDS.md#typedoc-documentation-standards).

- Add an `@example` in `src/.../index.ts` → add the same construction
  as an `example()` export in `test/.../.examples.ts`.
- Rename / remove / migrate an API → update both places in lockstep.
- TypeDoc-required coverage on public exports:
  - Factory functions (`Xxx.Root`) carry `@param` / `@returns` /
    `@remarks` / `@example` inline.
  - East types (`XxxType`, `XxxStyleType`, `XxxVariantType`) carry
    `@property` tags for every field / variant tag.
  - TS interfaces (`XxxStyle`, `XxxOptions`) carry per-field JSDoc.
  - The `Xxx.Types.*` properties on the namespace object carry their
    own JSDoc.

## UI example rules (delta from EXAMPLES_AUTHORING.md)

1. **Omit `returns` for `UIComponentType`.** The recursive variant
   cannot be a JS literal. The framework still evaluates the function
   and verifies it compiles.

2. **All `State.*` usage MUST be inside `Reactive.Root`'s inner
   function.** Otherwise the outer function becomes async (State
   functions are `optional: true`) and the analyzer fails with
   `AsyncFunction body returns type UIComponentType`.

   ```ts
   // CORRECT
   fn: East.function([], UIComponentType, (_$) => {
       return Reactive.Root(East.function([], UIComponentType, $ => {
           $.if(State.has("counter").not(), $ => {
               $(State.write([IntegerType], "counter", 0n));
           });
           const count = $.let(State.read([IntegerType], "counter"), IntegerType);
           // ... build and return UI
       }));
   }),

   // WRONG — State in outer fn body → async promotion error
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

5. **Wire with `Assert.examples()` using named keys** — never pass the
   module object directly:
   ```ts
   import * as ex from "./button.examples.js";

   describeEast("Button", (test) => {
       Assert.examples(test, {
           buttonBasic: ex.buttonBasic,
           buttonSolidVariant: ex.buttonSolidVariant,
           buttonReactiveCounter: ex.buttonReactiveCounter,
       });
       // ... tests
   }, { platformFns: TestImpl });
   ```

## Example patterns by component category

### Leaf component (Button, Text, Badge, Tag)

```ts
export const badgeBasic = example({
    keywords: ["Badge", "Root", "label", "create"],
    description: "Create a simple badge",
    fn: East.function([], UIComponentType, ($) => Badge.Root("New")),
    inputs: [],
});
```

### Container component (Stack, Box, Card, Grid)

```ts
export const stackWithGap = example({
    keywords: ["Stack", "HStack", "gap", "layout"],
    description: "Create a horizontal stack with gap spacing",
    fn: East.function([], UIComponentType, ($) =>
        Stack.HStack([Text.Root("Left"), Text.Root("Right")], { gap: "4" })),
    inputs: [],
});
```

### Interactive (Reactive.Root)

```ts
export const checkboxReactive = example({
    keywords: ["Checkbox", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive checkbox that tracks checked state",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            $.if(State.has("checked").not(), $ => {
                $(State.write([BooleanType], "checked", false));
            });
            const checked = $.let(State.read([BooleanType], "checked"), BooleanType);
            const toggle = $.const(East.function([], NullType, $ => {
                const current = $.let(State.read([BooleanType], "checked"), BooleanType);
                $(State.write([BooleanType], "checked", current.not()));
            }));
            return Checkbox.Root({ checked, onChange: toggle });
        }));
    }),
    inputs: [],
});
```
