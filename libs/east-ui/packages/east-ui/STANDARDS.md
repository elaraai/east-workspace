# East UI Development Standards

**This document is MANDATORY and MUST be followed for all East UI development.**

These standards ensure consistency, correctness, and maintainability across
the East UI codebase — for both the public **tag** layer and the internal
**factory** layer it desugars to.

---

## The two layers

East UI ships **JSX tags** as its public API and keeps the **factories** that
back them internal:

| Layer | Lives in | Imported from | Shape |
|---|---|---|---|
| **Tags** (public) | `src/runtime/<category>/` | `@elaraai/east-ui` | `<Button variant="solid">Save</Button>` |
| **Factories** (internal) | `src/<category>/<component>/` | `@elaraai/east-ui/internal` | `Button.Root("Save", { variant: "solid" })` |

A tag desugars to **exactly** the IR its factory returns — `<Button .../>` and
`Button.Root(...)` produce the identical `ExprType<UIComponentType>`. The tag is
what consumers see; the factory is the implementation and the desugar target
(used by the renderer and the in-repo specs).

Every tag also carries a type-safe **`Types`** namespace (`Slider.Types`,
`Table.Types.CellRenderContext`), any **data-builders** the factory exposes
(`Select.Item`, `Gantt.Task`), and any **nested tags** for component-producing
presets (`<Text.Eyebrow>`).

---

## Table of Contents

- [Tag documentation (public layer)](#tag-documentation-public-layer)
- [Factory & type documentation (internal layer)](#factory--type-documentation-internal-layer)
  - [Factory namespace objects](#factory-namespace-objects)
  - [Types (StructType/VariantType)](#types-structtypevarianttype)
  - [TypeScript interfaces](#typescript-interfaces)
  - [General rules](#general-rules)
- [Example validation (`@example` ↔ `*.examples.tsx`)](#example-validation-example--examplestsx)
- [Testing standards](#testing-standards)
- [Compliance](#compliance)

---

## Tag documentation (public layer)

Each tag in `src/runtime/<category>/` is a public export and MUST carry full
TypeDoc — **never a one-liner blurb.** A tag's JSDoc MUST include:

1. **A component description** — what it is and when to reach for it. Describe
   the component, not the combinator mechanics ("a numeric slider", not "a
   `leaf` wrapper that forwards `value`").
2. **An `@example`** in JSX form — the way a consumer actually writes it, with
   the `@jsxImportSource` pragma and imports from `@elaraai/east-ui`. The
   example MUST be mirrored by an `example()` export in the companion
   `test/<category>/<component>.examples.tsx` (see
   [Example validation](#example-validation-example--examplestsx)).
3. **A note on what's attached** — `Types`, any data-builders, and any nested
   tags, so they surface on hover.

Document props through the tag's prop type (the factory's `XxxOptions`
interface, which carries per-field JSDoc — see the factory layer below). Do
**not** re-describe every prop in the tag's JSDoc; point at the interface.

### Gold standard

Read these end-to-end before documenting a tag:
- `src/runtime/buttons/button.ts` — the tag (public)
- `src/buttons/button/index.ts` — the factory namespace (internal desugar target)
- `src/buttons/button/types.ts` — East types + the `ButtonOptions` interface
- `test/buttons/button.examples.tsx` — companion examples (JSX, wired via `Assert.examples`)

### Tag shape

```typescript
/** @jsxImportSource — not needed in the tag module itself; tags are values. */
import { Button as ButtonFactory, type ButtonOptions, type ButtonLabelInput } from "../../buttons/button/index.js";
import { content, type JsxTag } from "../combinators.js";

/**
 * Action button — triggers a behaviour on click. Supports rich labels,
 * leading/trailing icons, a loading state, and five visual variants. Props
 * are flat ({@link ButtonOptions}); the label is the child.
 *
 * @example
 * ```tsx
 * /** @jsxImportSource @elaraai/east-ui *​/
 * import { East } from "@elaraai/east";
 * import { Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const save = East.function([], UIComponentType, _$ => (
 *     <Button variant="solid" colorPalette="blue" onClick={onSave}>Save</Button>
 * ));
 * ```
 *
 * @remarks Carries `Button.Types` (the East type / style / variant namespace).
 */
export const Button: JsxTag<ButtonOptions & { children: ButtonLabelInput }> & { Types: typeof ButtonFactory.Types } =
    Object.assign(content(ButtonFactory.Root), { Types: ButtonFactory.Types });
```

Rules:
- The `@example` is **JSX** (`<Button .../>`), mirrored by a `.examples.tsx`
  entry — never a bare `Button.Root(...)` example in a tag file.
- The tag's type annotation includes `& { Types: typeof XFactory.Types }` (and
  any builders/nested tags) so they are visible on hover.
- Nested preset tags (`<Text.Eyebrow>`) each carry their own JSDoc + `@example`.

---

## Factory & type documentation (internal layer)

The factories under `src/<category>/` are the desugar target and the home of
the prop/type documentation. They keep full TypeDoc even though they're
internal — the renderer and specs read them, and the tag's prop types resolve
to the factory's `XxxOptions` interface.

### Factory namespace objects

Each component exports a namespace object (`export const Button = { Root, Types }`).

**Requirements:**
- Namespace-level docs: a description with `@remarks`.
- `Root`: full docs with `@param`, `@returns`, `@remarks`, and an `@example`
  (factory form — `Button.Root(...)` — mirrored by a `.examples.tsx` entry that
  exercises the same construction).
- `Types`: each member carries its **own full JSDoc block** — a summary,
  `@remarks` on its role, and a `@property` tag for EVERY field of the struct /
  tag of the variant. A one-liner here is forbidden (rule below).

#### ❌ one-liner `Types.*` blocks are forbidden

```typescript
// ❌ WRONG — shaves documentation
Types: {
    /** The concrete East type for Toast. */
    Toast: ToastType,
    /** Visual-only style struct. */
    Style: ToastStyleType,
}
```

```typescript
// ✅ RIGHT — full block on every Types.* property, @property per field
Types: {
    /**
     * East StructType for a Toast value — the serialisable IR used by
     * platform emit calls.
     *
     * @remarks Exposed so hosts reference the IR type via `Toast.Types.Toast`.
     * @property status - Semantic classification (shared with Alert / Banner)
     * @property title - Toast title text
     * @property description - Optional description line
     * @property duration - Duration in ms (none ⇒ persistent)
     * @property style - Optional visual style sub-struct (see `Style`)
     */
    Toast: ToastType,
}
```

### Types (StructType/VariantType)

East types MUST use `@property` tags — TypeDoc does not see inline comments
inside function-call arguments.

**Requirements:** summary, `@remarks`, a `@property` for EACH field/variant,
and a `typeof` type alias exported alongside the const.

```typescript
/**
 * Variant type for Button appearance styles.
 *
 * @remarks Create instances with string literals — `"solid"`, `"outline"`, …
 * @property solid - Solid filled button (default)
 * @property subtle - Subtle/light background button
 * @property outline - Outlined button with border
 * @property ghost - Transparent button, visible on hover
 */
export const ButtonVariantType = VariantType({
    solid: NullType, subtle: NullType, outline: NullType, ghost: NullType,
});
export type ButtonVariantType = typeof ButtonVariantType;
```

### TypeScript interfaces

Style/options interfaces need BOTH `@property` tags (quick reference) AND inline
`/** */` comments (hover docs) on each field.

```typescript
/**
 * Flat options bag for `Button.Root` / `<Button>` — content, state, behaviour
 * and visual fields all sit at the top level.
 *
 * @property variant - Button appearance variant
 * @property disabled - Disables interaction when true
 * @property onClick - Click-handler callback
 */
export interface ButtonOptions extends ButtonStyle {
    /** Disables interaction when true */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Click-handler callback (zero-arg East function) */
    onClick?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}
```

### General rules

- Present tense ("Creates a button", not "Will create").
- Concise but complete — no redundant restating; comment **why**, not **what**
  the code plainly says.
- No concrete style values (px / hex / token literals) in prose — the recipe /
  type definition is the source; values rot.
- Use `{@link SymbolName}` to link related types.
- `@internal` for implementation details not part of any public surface.

---

## Example validation (`@example` ↔ `*.examples.tsx`)

Every `@example` that contains compilable East code MUST be mirrored by an
`example()` export in the component's companion `test/<category>/<component>.examples.tsx`,
wired into the spec via `Assert.examples(test, {…})`. An `@example` with no
matching `example()` is the bug — the drift is invisible until docs render.

- **Tag `@example`s are JSX** (`.tsx`, with the `@jsxImportSource` pragma),
  importing tags from `@elaraai/east-ui`.
- **Factory `@example`s are factory calls** (`Button.Root(...)`), importing from
  `@elaraai/east-ui/internal` — the same construction the JSX desugars to.

```
test/buttons/
  button.spec.ts          # spec — imports factories from @elaraai/east-ui/internal
  button.examples.tsx     # companion examples — JSX tags, wired via Assert.examples
```

### `example()` shape (JSX)

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { example } from "@elaraai/east";
import { Button, ButtonGroup, UIComponentType } from "@elaraai/east-ui";

export const buttonGroupPrevNext = example({
    keywords: ["ButtonGroup", "attached", "Prev", "Next"],
    description: "Attached Prev/Next pair — two buttons sharing a border",
    fn: East.function([], UIComponentType, (_$) => (
        <ButtonGroup attached>
            <Button variant="outline" size="md">◀ Prev</Button>
            <Button variant="outline" size="md">Next ▶</Button>
        </ButtonGroup>
    )),
    inputs: [],
});
```

Fields: `keywords` (search), `description` (also the test name), `fn` (an
`East.function(...)`), `inputs` (`[]` for zero-arg). **Omit `returns` for
`UIComponentType`** — it's a recursive variant with no plain-JS literal; the
framework evaluates `fn(...inputs)` as a statement.

### Reactive rule for State examples

`State.*` is `optional: true`; calling it in the outer `fn` body promotes the
function to async, which the analyzer rejects. All `State` usage lives inside
`<Reactive>`'s inner builder:

```tsx
fn: East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        $.if(State.has("counter").not(), $ => { $(State.write([IntegerType], "counter", 0n)); });
        const count = $.let(State.read([IntegerType], "counter"), IntegerType);
        return <Text>{East.str`${count}`}</Text>;
    }}</Reactive>
)),
```

`test/CLAUDE.md` is the operational source of truth for example authoring — read
it before adding examples to a previously uncovered component.

---

## Testing standards

- One spec per component: `test/<category>/<component>.spec.ts`.
- Specs import **factories** from `@elaraai/east-ui/internal` and assert on the
  IR they produce; test bodies are East code via the `$` block builder.
- The tag/factory **equivalence** specs (`test/runtime/combinators.spec.tsx`,
  `children.spec.tsx`) assert `<Tag/>` produces the same IR as `Factory.Root(...)`
  — they import tags from `@elaraai/east-ui` and factories from `/internal`.

```typescript
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Button, ButtonGroup } from "@elaraai/east-ui/internal";
import * as ex from "./button-group.examples.js";

describeEast("ButtonGroup", (test) => {
    Assert.examples(test, { buttonGroupPrevNext: ex.buttonGroupPrevNext });

    test("creates a button group with children", $ => {
        const g = $.let(ButtonGroup.Root([Button.Root("A"), Button.Root("B")]));
        $(Assert.equal(g.unwrap().unwrap("ButtonGroup").buttons.size(), 2n));
    });
}, { platformFns: TestImpl });
```

```typescript
// ❌ WRONG — never pass the whole module object
Assert.examples(test, ex);
```

**MUST test:** basic construction, style options applied, edge cases, and
`Component.Types.X` accessibility.

---

## Compliance

**These standards are MANDATORY.** All PRs MUST comply; review MUST verify it.

**Before committing:**
1. Every public **tag** carries full TypeDoc with a JSX `@example` — no one-liner blurbs.
2. Every factory `Root` + `Types.*` carries full TypeDoc; `@property` on every struct field / variant tag.
3. Every `@example` has a matching `example()` in the companion `*.examples.tsx`, wired via `Assert.examples`.
4. TypeScript option interfaces have both `@property` tags and inline comments.
5. Tests pass (`make test`), build succeeds (`make build`), lint passes (`make lint`).

**Gold standard:** `src/runtime/buttons/button.ts` (tag) ·
`src/buttons/button/index.ts` (factory) · `src/buttons/button/types.ts` (types) ·
`test/buttons/button.examples.tsx` (examples).
