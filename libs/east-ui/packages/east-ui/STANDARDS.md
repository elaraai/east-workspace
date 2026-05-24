# East UI Development Standards

**This document is MANDATORY and MUST be followed for all East UI development.**

All contributors MUST follow these standards for documentation and testing. These standards ensure consistency, correctness, and maintainability across the East UI codebase.

---

## Table of Contents

- [TypeDoc Documentation Standards](#typedoc-documentation-standards)
  - [Component Namespace Objects](#component-namespace-objects)
  - [Factory Functions](#factory-functions)
  - [Types (StructType/VariantType)](#types-structtypevarianttype)
  - [TypeScript Interfaces](#typescript-interfaces)
  - [General Rules](#general-rules)
- [TypeDoc Example Validation](#typedoc-example-validation)
- [Testing Standards](#testing-standards)
  - [Test File Structure](#test-file-structure)
  - [Examples Files (companion `*.examples.ts`)](#examples-files-companion-examplests)
  - [Test Coverage Requirements](#test-coverage-requirements)

---

## TypeDoc Documentation Standards

All public APIs MUST include TypeDoc comments following these precise rules.

### CRITICAL: Example Validation Requirement

**ALL `@example` blocks MUST:**
1. Use `East.function()` — NO inline code examples, EVER.
2. Have a matching `example()` export in the spec's companion
   `test/<category>/<component>.examples.ts` file (see
   [Testing Standards § Examples Files](#examples-files-companion-examplests)).
3. Be wired into the spec file via `Assert.examples(test, {…})` so the
   example runs as part of the test suite.

If an `@example` block is not mirrored by an `example()` export in the
companion `.examples.ts` file, the API drift is invisible until the
docs render — that is the bug. Examples that cannot be validated MUST
NOT be added.

### Gold Standard

East UI focuses on **UI Components** that return typed data structures describing UI layouts. The gold standard pair for a contributor to read end-to-end is:
- `/src/buttons/button/index.ts` — namespace + factory documentation
- `/src/buttons/button/types.ts` — East types + TS interface documentation
- `/test/buttons/button-group.examples.ts` — companion examples file
- `/test/buttons/button-group.spec.ts` — spec wiring examples via `Assert.examples`

### Component Namespace Objects

Each component exports a namespace object (e.g., `export const Button = { ... }`). This is the **standard pattern** for East UI components.

**Requirements:**
- Namespace-level documentation with overview and simple examples
- `Root` property with factory function documentation
- `Types` object with documented type properties
- Examples showing `Component.Root(...)` usage and `Component.Types.X` access

**Example (from `/src/buttons/button/index.ts`):**

```typescript
/**
 * Button component for triggering actions.
 *
 * @remarks
 * Use `Button.Root(label, style)` to create a button, or access `Button.Types.Button` for the East type.
 */
export const Button = {
    /**
     * Creates a Button component with a label and optional styling.
     *
     * @param label - The text to display on the button
     * @param style - Optional styling configuration
     * @returns An East expression representing the styled button component
     *
     * @remarks
     * Button is an interactive component for triggering actions.
     * It supports multiple variants, color schemes, and sizes.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Button, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Button.Root("Save", {
     *         variant: "solid",
     *         colorPalette: "blue",
     *         size: "md",
     *     });
     * });
     * ```
     */
    Root: createButton,
    Types: {
        /**
         * The concrete East type for Button component data.
         *
         * @remarks
         * This struct type represents the serializable data structure for a Button component.
         *
         * @property label - The text displayed on the button
         * @property style - Optional styling configuration wrapped in OptionType
         */
        Button: ButtonType,
        /**
         * Style type for Button component configuration.
         *
         * @remarks
         * This struct type defines the styling configuration for a Button component.
         *
         * @property variant - Button appearance variant (solid, subtle, outline, ghost)
         * @property colorPalette - Color scheme for the button
         * @property size - Size of the button (xs, sm, md, lg)
         * @property loading - Whether the button shows a loading state
         * @property disabled - Whether the button is disabled
         */
        Style: ButtonStyleType,
        /**
         * Variant type for Button appearance styles.
         *
         * @remarks
         * Create instances using string literals like "solid", "outline", etc.
         *
         * @property solid - Solid filled button (default)
         * @property subtle - Subtle/light background button
         * @property outline - Outlined button with border
         * @property ghost - Transparent button, visible on hover
         */
        Variant: ButtonVariantType,
    },
} as const;
```

**Rules for namespace objects:**

1. **Namespace-level docs** - Brief description with `@remarks` explaining usage
2. **Root property docs** - Full documentation with `@param`, `@returns`, `@remarks`, and `@example`
3. **Types property docs** - Each type in `Types` has its own **full JSDoc block**: a summary, `@remarks` explaining the type's role in the namespace, and `@property` tag for EVERY field of the struct / tag of the variant. TypeDoc treats namespace `Types.*` properties as distinct exports — a one-liner here produces visibly worse TypeDoc output than the source `types.ts` already carries.
4. **All examples use `East.function()`** - Examples MUST be wrapped in `East.function()` so they can be validated

#### ❌ NON-EXAMPLE — one-liner `Types.*` blocks are forbidden

Do **not** write the following form. It shaves documentation and violates rule 3 above:

```typescript
// ❌ WRONG — do not commit code shaped like this
export const Toast = {
    make: createToast,
    Types: {
        /** The concrete East type for Toast. */
        Toast: ToastType,
        /** Visual-only style struct. */
        Style: ToastStyleType,
    },
} as const;
```

Every `Types.*` property must carry the same JSDoc completeness as the declaration in `types.ts`. Prefer copying the full block:

```typescript
// ✅ RIGHT — full block on every Types.* property
Types: {
    /**
     * East StructType for a Toast value — the serialisable IR used by
     * platform emit calls.
     *
     * @remarks
     * Exposed on the namespace so hosts can reference the IR type via
     * `Toast.Types.Toast` without reaching into module internals.
     *
     * @property status - Semantic classification (shared with Alert / Banner)
     * @property title - Toast title text
     * @property description - Optional description line
     * @property actions - Optional action buttons (up to three)
     * @property duration - Duration in milliseconds (none ⇒ persistent)
     * @property style - Optional visual style sub-struct (see `Style`)
     */
    Toast: ToastType,
    /**
     * East StructType holding every visual field for a Toast.
     *
     * @remarks
     * Mirror of `ToastStyleType` from `./types.js`. Covers the four colour
     * slots (text, background, border, icon).
     *
     * @property color - Explicit text colour override
     * @property background - Explicit background colour override
     * @property borderColor - Explicit border colour override
     * @property iconColor - Explicit icon colour override
     */
    Style: ToastStyleType,
},
```

### Factory Functions

The private factory function (e.g., `createButton`) should also be documented, as it serves as the implementation for `Component.Root`.

**Requirements:**
- Start with a verb describing what the function does
- Document all parameters with `@param name - description`
- Document return value with `@returns description`
- Include `@remarks` for component behavior notes
- Include `@example` with `East.function()` - ALL examples MUST be validatable

**Example:**

```typescript
/**
 * Creates a Button component with a label and optional styling.
 *
 * @param label - The text to display on the button
 * @param style - Optional styling configuration
 * @returns An East expression representing the styled button component
 *
 * @remarks
 * Button is an interactive component for triggering actions.
 * It supports multiple variants, color schemes, and sizes.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     const counter = $.let(0);
 *     return Button.Root("Save", {
 *         variant: "solid",
 *         colorPalette: "blue",
 *         onClick: _$ => {
 *             $.assign(counter, counter.add(1));
 *         },
 *     });
 * });
 * ```
 */
function createButton(
    label: SubtypeExprOrValue<StringType>,
    style?: ButtonStyle
): ExprType<UIComponentType> { ... }
```

### Types (StructType/VariantType)

East types defined with `StructType` or `VariantType` MUST use `@property` tags in the JSDoc comment block. TypeDoc does NOT see inline comments inside function call arguments.

**Requirements:**
- Summary describing what the type represents
- `@remarks` for important usage notes
- `@property` tag for EACH property/variant in the type
- Type alias exported alongside the const

**Example (from `/src/buttons/button/types.ts`):**

```typescript
/**
 * Variant type for Button appearance styles.
 *
 * @remarks
 * Create instances using string literals like "solid", "outline", etc.
 *
 * @property solid - Solid filled button (default)
 * @property subtle - Subtle/light background button
 * @property outline - Outlined button with border
 * @property ghost - Transparent button, visible on hover
 */
export const ButtonVariantType = VariantType({
    solid: NullType,
    subtle: NullType,
    outline: NullType,
    ghost: NullType,
});

/**
 * Type representing button variant values.
 */
export type ButtonVariantType = typeof ButtonVariantType;

/**
 * String literal type for button variant values.
 */
export type ButtonVariantLiteral = "solid" | "subtle" | "outline" | "ghost";
```

```typescript
/**
 * Style type for Button component configuration.
 *
 * @remarks
 * This struct type defines the styling configuration for a Button component.
 *
 * @property variant - Button appearance variant (solid, subtle, outline, ghost)
 * @property colorPalette - Color scheme for the button
 * @property size - Size of the button (xs, sm, md, lg)
 * @property loading - Whether the button shows a loading state
 * @property disabled - Whether the button is disabled
 * @property onClick - Callback triggered when the button is clicked
 */
export const ButtonStyleType = StructType({
    variant: OptionType(ButtonVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    loading: OptionType(BooleanType),
    disabled: OptionType(BooleanType),
    onClick: OptionType(FunctionType([], NullType)),
});

/**
 * Type representing the Button style structure.
 */
export type ButtonStyleType = typeof ButtonStyleType;
```

### TypeScript Interfaces

TypeScript interfaces for style options need BOTH `@property` tags in the JSDoc AND inline comments for each property.

**Requirements:**
- Summary describing the interface purpose
- `@remarks` for usage notes
- `@property` tag for each property (provides quick reference)
- Inline `/** comment */` for each property (provides hover documentation)

**Example (from `/src/buttons/button/types.ts`):**

```typescript
/**
 * TypeScript interface for Button style options.
 *
 * @remarks
 * Use this interface when creating Button components.
 *
 * @property variant - Button appearance variant
 * @property colorPalette - Color scheme for theming
 * @property size - Size of the button
 * @property loading - Shows loading spinner when true
 * @property disabled - Disables button interaction when true
 * @property onClick - Callback triggered when the button is clicked
 */
export interface ButtonStyle {
    /** Button appearance variant (solid, subtle, outline, ghost) */
    variant?: SubtypeExprOrValue<ButtonVariantType> | ButtonVariantLiteral;
    /** Color scheme for theming */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Size of the button */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Shows loading spinner when true */
    loading?: SubtypeExprOrValue<BooleanType>;
    /** Disables button interaction when true */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when the button is clicked */
    onClick?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}
```

### General Rules

**MUST follow:**
- Write in present tense ("Creates a button" not "Will create a button")
- Be concise but complete - avoid redundant information
- Use proper markdown formatting for code references: `Type`, `null`, etc.
- Use `{@link SymbolName}` to create links to other documented types
- Include `@internal` for implementation details not part of public API

**Linking Example:**

```typescript
/**
 * Style type for Slider component.
 *
 * @remarks
 * See {@link SliderStyle} for the TypeScript interface.
 * Uses {@link ColorSchemeType} for color options.
 */
export const SliderStyleType = StructType({ ... });
```

---

## TypeDoc Example Validation

All TypeDoc `@example` blocks that contain compilable East code MUST be validated by including them in the corresponding component's companion `*.examples.ts` file (alongside the spec).

### Per-Spec Example Files

Example validation files live **next to the spec**, one per component:

```
test/
  buttons/
    button.spec.ts           # spec
    button.examples.ts       # companion examples — wired in via Assert.examples
    button-group.spec.ts
    button-group.examples.ts
  collections/
    table.spec.ts
    table.examples.ts
  ...
```

The older `/examples/[module].ts` directory has been retired in favour
of this per-spec layout. See
[Testing Standards § Examples Files](#examples-files-companion-examplests)
for the full convention.

## Testing Standards

All East UI functionality MUST be thoroughly tested using East code.

### Test File Structure

**Requirements:**
- One test file per component: `test/[category]/[component].spec.ts`
- Import `describeEast` and `Assert` from `@elaraai/east-node-std`
- Test bodies MUST be written in East code using the `$` block builder
- Use `Assert.equal()`, `Assert.is()`, etc. for assertions

**Example:**

```typescript
import { East, variant } from "@elaraai/east";
import { Button } from "../../src/index.js";
import { describeEast, Assert } from "@elaraai/east-node-std";

describeEast("Button", (test) => {
    test("creates button with label", $ => {
        const button = $.let(Button.Root("Click me"));
        $(Assert.equal(button.unwrap("Button").label, "Click me"));
    });

    test("creates button with style", $ => {
        const button = $.let(Button.Root("Save", {
            variant: "solid",
            colorPalette: "blue",
        }));
        $(Assert.equal(button.unwrap("Button").label, "Save"));
        $(Assert.equal(
            button.unwrap("Button").style.unwrap("some").variant.unwrap("some").getTag(),
            "solid"
        ));
    });
});
```

### Examples Files (companion `*.examples.ts`)

Every spec file MUST have a companion `*.examples.ts` file living next
to it — for example, `test/buttons/button-group.spec.ts` is paired with
`test/buttons/button-group.examples.ts`. Examples serve double duty:
they run as part of the test suite **and** they are extracted into a
search index that AI agents read for context, so they are also the
public-facing usage corpus.

#### Parity rule (load-bearing)

Every `@example` block on a public factory (`Xxx.Root`) or
`Xxx.Types.*` namespace property in `src/` MUST have a matching
`example()` export in the companion `.examples.ts`. Renaming or
migrating an API means updating both places in lockstep — a stale
`@example` that no longer type-checks against the corresponding
`example()` is a bug.

#### `example()` shape

Each example is an exported `const` using the `example()` helper from
`@elaraai/east`:

```ts
import { East, example } from "@elaraai/east";
import { Button, ButtonGroup, UIComponentType } from "@elaraai/east-ui";

export const buttonGroupPrevNext = example({
    keywords: ["ButtonGroup", "Root", "attached", "Prev", "Next"],
    description: "Attached Prev/Next pair — two buttons sharing a border",
    fn: East.function([], UIComponentType, (_$) => {
        return ButtonGroup.Root(
            [
                Button.Root("◀ Prev", { style: { variant: "outline", size: "md" } }),
                Button.Root("Next ▶", { style: { variant: "outline", size: "md" } }),
            ],
            { style: { attached: true } },
        );
    }),
    inputs: [],
});
```

Fields:
- `keywords` — component / method / property names used for search.
- `description` — human-readable, also used as the test name.
- `fn` — an `East.function(...)` call (the same shape a user would write).
- `inputs` — args passed to `fn`. Use `[]` for zero-arg functions.
- `returns` — **omit for UI examples.** `UIComponentType` is a recursive
  variant and has no plain-JS literal representation; the framework
  evaluates `fn(...inputs)` as a statement when `returns` is absent.

#### Reactive.Root rule for State examples

State functions (`State.read`, `State.write`, `State.has`) are marked
`optional: true`. Calling them in the outer `fn` body promotes the
function to an `AsyncFunction`, which the test analyzer rejects with
`AsyncFunction body returns type UIComponentType`. **All State usage
must live inside `Reactive.Root`'s inner `East.function`:**

```ts
fn: East.function([], UIComponentType, (_$) => {
    return Reactive.Root(East.function([], UIComponentType, $ => {
        $.if(State.has("counter").not(), $ => {
            $(State.write([IntegerType], "counter", 0n));
        });
        const count = $.let(State.read([IntegerType], "counter"), IntegerType);
        // ...
    }));
}),
```

#### Wiring examples into the spec

Import the examples module and register each entry with
`Assert.examples(test, {…})` using **named keys** — not the module
object directly. Place the call BEFORE the manual `test()` blocks so
examples are grouped with their corresponding tests:

```ts
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Button, ButtonGroup } from "@elaraai/east-ui";
import * as ex from "./button-group.examples.js";

describeEast("ButtonGroup", (test) => {
    Assert.examples(test, {
        buttonGroupPrevNext: ex.buttonGroupPrevNext,
        buttonGroupTimescale: ex.buttonGroupTimescale,
        buttonGroupSplit: ex.buttonGroupSplit,
    });

    test("creates button group with children array", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A"), Button.Root("B")]));
        $(Assert.equal(g.unwrap().unwrap("ButtonGroup").buttons.size(), 2n));
    });

    // ... further manual tests ...
}, { platformFns: TestImpl });
```

```ts
// ❌ WRONG — never pass the whole module object
Assert.examples(test, ex);
```

#### Further detail

`test/CLAUDE.md` is the operational source of truth for example
authoring — it covers package self-reference imports, the
examples-search index format, the seven detailed rules for writing UI
examples, and the per-component-category example patterns. Read it
before adding examples to a previously uncovered component.

### Test Coverage Requirements

**MUST test:**
- **Basic operations**: Core component creation with typical inputs
- **Style options**: All style properties are correctly applied
- **Edge cases**: Empty values, boundary conditions
- **Type access**: Verify `Component.Types.X` types are accessible

---

## Compliance

**These standards are MANDATORY.**

- All pull requests MUST comply with these standards
- Code review MUST verify compliance
- No exceptions without explicit approval from the project maintainer

**Before committing:**
1. All public APIs have TypeDoc comments following these standards
2. Every public `@example` block has a matching `example()` export in the spec's companion `test/<cat>/<comp>.examples.ts` file, wired in via `Assert.examples(test, {…})`
3. `@property` tags are present for all StructType/VariantType definitions
4. TypeScript interfaces have both `@property` tags AND inline comments
5. All new functionality has comprehensive test coverage
6. All tests pass: `npm run test`
7. Build succeeds: `npm run build`
8. Linting passes: `npm run lint`

**Gold Standard Reference:**
- `/src/buttons/button/index.ts` — namespace + factory documentation
- `/src/buttons/button/types.ts` — East types + TS interface documentation
- `/test/buttons/button-group.examples.ts` — companion examples file
- `/test/buttons/button-group.spec.ts` — spec wiring examples via `Assert.examples`
