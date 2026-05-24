# East UI

East UI is a UI component library for the East language. Components are
typed **data structures describing UI layouts** — they don't render
themselves. The companion package `@elaraai/east-ui-components` is the
React renderer that turns these values into Chakra UI v3 JSX.

## Purpose

Separating IR from rendering gives:

- **Portability** — UI definitions serialize and render anywhere.
- **Type safety** — full compile-time checking of structure and styling.
- **Composability** — components are East functions returning typed
  values.
- **Separation of concerns** — UI logic (east-ui) is independent from
  rendering (east-ui-components).

## Design

Components return variant types that **describe** the UI. Rendering is
deferred to the renderer layer. Built on East's type system:

- Base styling enums are East variant types (`FontWeight`, `TextAlign`,
  …).
- All style properties accept East expressions for dynamic styling.
- Components return structs/variants serializable as East IR.
- Compatible with Chakra UI for React rendering.

## Structure

Component source is organized by category under `src/<category>/<component>/`:

| Category | Components |
|---|---|
| `buttons/` | Button |
| `collections/` | DataList |
| `container/` | Card |
| `disclosure/` | Accordion |
| `display/` | Avatar, Badge, Stat, Tag |
| `feedback/` | Alert, Progress |
| `forms/` | Checkbox, Input, Select, Slider, Switch |
| `layout/` | Box, Grid, Separator, Splitter, Stack |
| `typography/` | Text |

For the full file tree and base style enum list, see
[`docs/component-layout.md`](docs/component-layout.md).

## Commands

`make build`, `make test`, `make lint` from this directory. See
[`../../../../docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

## See also

- [`STANDARDS.md`](STANDARDS.md) — mandatory dev standards. **Read
  before editing any public export.**
- [`SKILL.md`](SKILL.md) — authoring cheat-sheet for end users.
  **Matches the `east:east-ui` plugin skill — DO NOT EDIT casually.**
- [`USAGE.md`](USAGE.md) — end-user guide to East UI.
- [`../../../../docs/conventions/EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md)
  — `isValueOf`, `compareFor`, `variant`, `$.let`/`$.const` rules.
- [`../../../../docs/conventions/EXAMPLES_AUTHORING.md`](../../../../docs/conventions/EXAMPLES_AUTHORING.md)
  — the `*.spec.ts` ↔ `*.examples.ts` pattern.
- [`test/CLAUDE.md`](test/CLAUDE.md) — UI-specific example rules
  (Reactive.Root, omit `returns` for `UIComponentType`, etc.).
- [`../east-ui-components/CLAUDE.md`](../east-ui-components/CLAUDE.md) —
  the React renderer for these types.

---

## Component architecture (load-bearing rules)

### Export pattern

Each component lives in `src/<category>/<component>/` with two files:

```
src/category/component-name/
  index.ts    # Component logic, factory functions, namespace export
  types.ts    # East types — NO import from component.ts
```

**Important:** `types.ts` MUST NOT import from `component.ts` (circular
dependency — `component.ts` imports the types). `index.ts` CAN import
from `component.ts` because the import only resolves at runtime (function
bodies), not at module load.

### Container vs leaf components

Components fall into two categories:

**Leaf components** (no UI children) — Badge, Tag, Avatar, Stat, Text,
Button, Progress, Alert, inputs, etc.

- Main type (e.g. `BadgeType`) defined in `types.ts`.
- `component.ts` imports the type directly: `Badge: BadgeType`.

**Container components** (have UI children) — Box, Stack, Card, Grid,
Splitter, Accordion.

- Main type defined **inline** in `component.ts` using `node` for
  recursion.
- Only style types live in `types.ts` (e.g. `CardStyleType`,
  `BoxStyleType`).
- Required because children need `ArrayType(node)` which only exists
  inside `RecursiveType`.

```typescript
export const UIComponentType = RecursiveType(node => VariantType({
    // Leaf — import type directly
    Badge: BadgeType,

    // Container — define inline with `node`
    Card: StructType({
        title: OptionType(StringType),
        description: OptionType(StringType),
        body: ArrayType(node),
        style: OptionType(CardStyleType),
    }),
}));
```

### `types.ts` pattern

The types file exports:

1. East StructTypes / VariantTypes for component data and styling.
2. TypeScript interfaces for style options (accept `SubtypeExprOrValue<T>`).
3. Optional helper functions for variant values.

```typescript
// types.ts — NO import from component.ts
import { type SubtypeExprOrValue, OptionType, StringType, StructType, VariantType, NullType } from "@elaraai/east";

export const ComponentVariantType = VariantType({
    solid: NullType,
    outline: NullType,
    subtle: NullType,
});
export type ComponentVariantType = typeof ComponentVariantType;

export const ComponentStyleType = StructType({
    gap: OptionType(StringType),
    variant: OptionType(ComponentVariantType),
});
export type ComponentStyleType = typeof ComponentStyleType;

export interface ComponentStyle {
    gap?: SubtypeExprOrValue<StringType>;
    variant?: SubtypeExprOrValue<ComponentVariantType> | "solid" | "outline" | "subtle";
}
```

Every public export carries full TypeDoc per `[Full TypeDoc always]`
memory.

### `index.ts` pattern

Contains:

1. Imports from `types.ts` (and re-exports them).
2. Private factory function (can import `UIComponentType`).
3. Public namespace object with `Root`, optional sub-factories, `Types`.
4. Optional convenience exports (`HStack`, `VStack`).

```typescript
import { type ExprType, East, ArrayType, variant, type SubtypeExprOrValue } from "@elaraai/east";
import { UIComponentType } from "../../component.js";
import { ComponentStyleType, type ComponentStyle } from "./types.js";

export { ComponentStyleType, type ComponentStyle } from "./types.js";

function createComponent(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    style?: ComponentStyle
): ExprType<UIComponentType> {
    // ... build the variant value
}

export const Component = {
    Root: createComponent,
    Types: {
        Component: ComponentType,
        Style: ComponentStyleType,
    },
} as const;
```

### Compound components

For components with sub-components (Accordion, Select, Grid), all
factories sit on the namespace:

```typescript
export const Accordion = {
    Root: createAccordionRoot,
    Item: createAccordionItem,  // Accordion.Item(value, trigger, children, style?)
    Variant: AccordionVariant,
    Types: {
        Root: AccordionRootType,
        Item: AccordionItemType,
        Style: AccordionStyleType,
        Variant: AccordionVariantType,
    },
} as const;
```

Per `[East module signatures]` memory, factory callbacks return
`SubtypeExprOrValue<T>` — never plain TS object arrays. The `.Item(...)`
constructor pattern is the ergonomic JS-side companion.

### Category index

Category index files (`display/index.ts`) export namespace objects:

```typescript
export { Badge } from "./badge/index.js";
export { Tag }   from "./tag/index.js";
export { Avatar } from "./avatar/index.js";
export { Stat }  from "./stat/index.js";
```

Users access types through the namespace:

```typescript
Badge.Types.Badge    // East type
Badge.Root(...)      // Factory function
```

### Usage

```typescript
import { Stack, Text } from "@elaraai/east-ui";

const stack = Stack.Root([
    Text.Root("Hello"),
    Text.Root("World"),
], {
    gap: "4",
    direction: "row",
});

// Types via .Types
const stackType = Stack.Types.Stack;
const styleType = Stack.Types.Style;
```

---

## `SubtypeExprOrValue` pattern

This is the key type that makes east-ui ergonomic. It accepts **either**
plain JS values **or** East expressions, eliminating `East.value(...)`
wrapping for static values.

### Why

Without it, every parameter would need wrapping:

```typescript
// Verbose
Button.Root(East.value("Click me", StringType), {
    variant: East.value(variant("solid", null), ButtonVariantType),
    disabled: East.value(false, BooleanType),
});
```

With `SubtypeExprOrValue`:

```typescript
// Ergonomic
Button.Root("Click me", {
    variant: "solid",
    disabled: false,
});
```

### When to use

For function parameters that should accept static values OR dynamic
expressions:

```typescript
interface ButtonStyle {
    label?: SubtypeExprOrValue<StringType>;       // plain string OR expr
    disabled?: SubtypeExprOrValue<BooleanType>;   // plain bool OR expr
    variant?: SubtypeExprOrValue<ButtonVariantType> | "solid" | "subtle" | "outline";
    children?: SubtypeExprOrValue<ArrayType<UIComponentType>>;
}
```

### String literal unions for variants

For variant types, add string literal unions for shorthand:

```typescript
variant: "solid"                           // String literal
variant: variant("solid", null)            // Explicit variant
variant: cond.ifElse(variant("solid", null), variant("outline", null))  // Dynamic
```

### Component function signatures

All component factory functions use `SubtypeExprOrValue`:

```typescript
function createButton(
    label: SubtypeExprOrValue<StringType>,
    style?: ButtonStyle
): ExprType<UIComponentType>

// Usage
Button.Root("Click me")                    // Plain string
Button.Root(row.name)                      // East expression
Button.Root(count.greater(0).ifElse("Active", "Inactive"))  // Conditional
```

### Arrays and collections

```typescript
function createBox(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    style?: BoxStyle
): ExprType<UIComponentType>

// Usage
Box.Root([Text.Root("Hello"), Button.Root("Click")])  // Plain array
Box.Root(data.map(item => Text.Root(item.name)))      // East mapped array
```

### Testing with plain values

Use plain values in tests for clarity:

```typescript
test("creates button with label", $ => {
    const button = $.let(Button.Root("Click me"));
    $(Assert.equal(button.unwrap("Button").label, "Click me"));
});
```
