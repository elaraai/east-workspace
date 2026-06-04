# east-ui JSX — authoring surface design & implementation plan

> **Status:** APPROVED target state (sign-off captured). This doc is the single
> source of truth for the JSX authoring surface across **both**
> `@elaraai/east-ui` and `@elaraai/e3-ui`.

JSX becomes the **primary** authoring surface for east-ui component trees, to
the point that every UIComponentType example in both packages is written as
`.tsx`. The factory API (`Button.Root(...)`) remains permanently as the value
constructor JSX desugars to — a `<Button>` tag evaluates to the *identical*
`ExprType<UIComponentType>` the factory returns. No React at runtime; the IR
serializes and renders exactly as before.

---

## 0. Principles

These govern every decision below.

1. **JSX is sugar over the factories.** `<Box padding="4">…</Box>` builds the
   same IR as `Box.Root([…], { padding: "4" })`. Same value, same serialization,
   same renderer. The factories never go away.

2. **Every value/prop is the factory's `SubtypeExprOrValue<T>` East type —
   strictly.** A value, a style prop, a chart encoding field, a child is typed
   *exactly* as the factory's arg (`SubtypeExprOrValue<T>`) — **never** a JS/TS
   junk union (no bare `string`/`number`/`boolean`/`null`/`undefined`, no
   `X | Y` grab-bags, no parallel `XxxJsxProps`). An East expression
   (`rows.map(...)`, a dataset bind, a field access, `cond.ifElse(...)`) is just
   a value of that slot's type. The JSX layer never coerces or re-types values
   at the boundary, and never runtime-introspects a value to *validate* it (see
   [`feedback_no_runtime_type_introspection`]).

   **The one allowed exception:** an enum/variant style prop adds its
   string-literal proxy — `SubtypeExprOrValue<XxxType> | XxxLiteral` (so
   `variant="solid"` works). That proxy lives on the factory's own option
   interface, not the JSX layer. Nothing else deviates from
   `SubtypeExprOrValue<T>`.

   **Conditionals are East:** `cond.ifElse(<A/>, <B/>)` (a `UIComponentType`),
   never JS `{cond && <El/>}` / ternaries / `null` — those aren't East.

3. **The factory is the single lift/coercion site.** String→variant coercion,
   string→`Text.Root` label coercion, and TS-arrow→`East.function` lifting all
   happen inside the factory, where the target East type is statically known.
   The JSX tag is a thin prop-shape adapter that forwards to the factory — it
   never re-types or re-coerces East-shaped data.

4. **Children are always `UIComponentType`; everything else is props.** Because
   TSX exposes a single global `JSX.Element`, the only way to keep children-
   position tight is to keep `JSX.Element` a single type — `ExprType<
   UIComponentType>` — and *never* widen it (§2.6). So a JSX child is always a UI
   component; non-UIComponent sub-structures (columns, layers, cells, header
   data) are config props / typed callbacks, not child sub-tags (§2.3). Prop- and
   encoding-level inference — the load-bearing part (Table `ColumnSpec<T>`, Chart
   `Row` accessors) — is **fully preserved**. **No JSX form may lose inference the
   factory had** — this is a hard acceptance criterion.

5. **One canonical surface in the docs.** Examples and `@example` blocks are
   JSX-only for UI components. The factory *signature* reference stays (it is
   the contract JSX desugars to), but worked usage is JSX. The generated search
   index must never serve two competing surfaces for the same component.

---

## 1. Architecture

### 1.1 The runtime + tags live in `east-ui` (relocation)

The JSX runtime and capitalized tags currently live in `e3-ui`
(`src/jsx-runtime.ts`, `src/jsx.ts`). They **move down into `east-ui`**, the
base package.

- **Why required, not preferred:** `e3-ui` depends on `east-ui`, never the
  reverse. east-ui's own `.tsx` examples cannot import tags from the higher
  e3-ui package (illegal upward edge). The tags must live where the examples do.
- **Why safe:** the runtime imports only *type-only* `ExprType` (from
  `@elaraai/east`, already a peer dep) and `UIComponentType` (east-ui's own
  type); the tags import only the sibling factories. Nothing pulls in React or
  e3. The feared runtime↔component circular-type does not exist — components
  never import the JSX layer. east-ui keeps zero runtime dependencies.

`e3-ui` keeps `./jsx`, `./jsx-runtime`, `./jsx-dev-runtime`, and `./ui` as
**pure passthroughs** (`export * from '@elaraai/east-ui/jsx'`, etc.) and adds
only `ui()` plus its bridge-specific tags. `ui.ts` continues to
`export * from './jsx.js'`, so `@elaraai/e3-ui/ui` stays a single import for
`ui()` + tags. The existing e3-ui-showcase (`jsxImportSource: "@elaraai/e3-ui"`)
compiles unchanged.

### 1.2 File structure — `src/jsx/` mirrors `src/`, one file per component

`src/jsx/` is a **parallel tree that mirrors the component tree**: one tag file
per component dir, grouped by category, with per-category barrels — exactly how
`src/<category>/<component>/` + `src/<category>/index.ts` + `src/index.ts` are
organized. Collapsing a category into one file (`collections.tsx`) was rejected:
the heavy Table/Matrix/Gantt/Planner/Chart wrappers make those files unreviewable
and the barrel a flat dump.

```
src/jsx/
  runtime.ts            # jsx / jsxs / jsxDEV / h / Fragment + the single `export namespace JSX`
                        #   → exported as ./jsx-runtime (and ./jsx-dev-runtime)
  children.ts           # coalesceChildren + ElementChild
  combinators.ts        # container / content / leaf (+ shape-3 / items-parent / …) + *Props types
  index.ts              # barrels the category barrels + combinators → exported as ./jsx
  layout/   box.ts flex.ts stack.ts …      + index.ts      # mirrors src/layout/<comp>/
  typography/ text.ts heading.ts code.ts mark.ts … + index.ts
  forms/    checkbox.ts switch.ts slider.ts input.ts select.ts … + index.ts
  buttons/  button.ts icon-button.ts … + index.ts
  display/  badge.ts tag.ts avatar.ts stat.ts … + index.ts
  collections/ table.ts matrix.ts gantt.ts planner.ts data-list.ts … + index.ts
  charts/   chart.ts sparkline.ts + index.ts
  reactive/ reactive.ts + index.ts
  … feedback/ navigation/ disclosure/ overlays/ container/
```

Why a parallel tree is sound (the earlier objection does not apply): the JSX
`namespace` is declared **once** in `runtime.ts`, not per file; tag files import
their factory by relative path (`../../layout/box/index.js`), so there is no
`types.ts`↔`component.ts` cycle (the cycle risk only existed for an `index.tsx`
co-located *inside* the component dir). Each `<category>/index.ts` barrels its
component tags (mirroring `src/<category>/index.ts`); `src/jsx/index.ts` barrels
the categories. The package still exposes ONE public subpath `./jsx`, so authors
import from one place — the export graph is identical in shape to the factory
side (root barrel → category barrel → component), not a flat list.

Tag files are `.ts`: they contain no `<JSX>` literals (they are
`container(Box.Root)`-style calls), which keeps them in the existing
`src/**/*.ts` lint scope and makes accidental untransformed JSX impossible. Only
files that author JSX literals are `.tsx` (the `*.examples.tsx` and the
`test/jsx/*.spec.tsx` foundation tests).

### 1.3 Naming, imports, pragma

- **Same PascalCase name, different entry point.** `import { Button } from
  '@elaraai/east-ui'` → the factory namespace (`Button.Root`).
  `import { Button } from '@elaraai/east-ui/jsx'` → the tag (`<Button>`). A file
  imports from one or the other; if it genuinely needs both, it aliases
  (`import { Button as ButtonFactory }`). Tags are **not** re-exported from the
  package root — the root stays the factory surface, stable for existing call
  sites.
- **One author import line** for all tags: `import { Box, VStack, Text, Button,
  Table, Chart } from '@elaraai/east-ui/jsx'`.
- **Per-file pragma**, not project-wide jsxImportSource:
  `/** @jsxImportSource @elaraai/east-ui */` at the top of each `.tsx` example.
  This isolates the JSX transform to files that actually author JSX and keeps
  east-ui's non-UI `.ts` source out of the JSX type contract. (east-ui/tsconfig
  already sets `jsx: "react-jsx"`.) The runtime (`jsx`/`jsxs`/`Fragment`) is
  resolved by the compiler and never hand-imported.

### 1.4 e3-ui author surface

`@elaraai/e3-ui/ui` exports `ui()` + the re-exported tags. `ui()` is a single
typed form — `ui(name, inputs, fn, options?)` — with `inputs` `[]` when there are
none and `fn` a normal `East.function([], UIComponentType, _$ => <…/>)`; there is
no closure-only overload (it only existed as JSX sugar and forced an untyped
overload-discrimination, so it was dropped). e3 UI tasks may set `jsxImportSource`
to either `@elaraai/east-ui` or `@elaraai/e3-ui` (byte-identical runtime); pick one
consistently.

---

## 2. The JSX runtime (foundation — built first, gates everything)

The shipped runtime is correct only for the all-static subset the one showcase
demo exercises. It is **silently wrong** for expression-valued children and
*throws* on mixed text. These are fixed before any tag scaling.

### 2.1 Children coalescer (`children.ts`)

A container factory's children arg is a *list*:
`SubtypeExprOrValue<ArrayType<UIComponentType>>`. JSX hands that list in one of
two strict East-typed shapes (`ContainerChildrenType = SubtypeExprOrValue<
UIComponentType> | SubtypeExprOrValue<ArrayType<UIComponentType>>`): a single
`UIComponentType` (a lone child, or `cond.ifElse(<A/>, <B/>)`), or an
`ArrayType<UIComponentType>` (a JS array `[A, B]` of elements, or a dynamic
`rows.map(...)`). `coalesceChildren` lowers either to the factory arg:

- `undefined` (empty container) → `East.value([], ArrayType(UIComponentType))`;
- a JS array (multiple static children) → `East.value(child, ArrayType(UIComponentType))`;
- an East array expression — detected with
  `isSubtype(Expr.type(child), ArrayType(UIComponentType))` — passes through;
- otherwise a single `UIComponentType` → wrapped `East.value([child], ArrayType(UIComponentType))`.

No `boolean`/`null`/nesting, no segment-concat, no `.map` special case. Flat-mixed
siblings (`<Box><Header/>{rows.map(...)}</Box>`) are a **type error** — compose a
mixed list East-side (`.concat`) or wrap the dynamic part in its own container.
The only runtime East read is the `isSubtype` array check (lowering, not
validation).

### 2.2 Fragments

`Fragment` routes through the same coalescer and returns a well-typed children
value, independent of the parent (today it leaks a raw JS array that only works
under a container parent). Fragments are meaningful as container/bucketed
children; documented as such.

### 2.3 Sub-structures are props/config, not typed-slot children

A tag's children are always `UIComponentType`: `JSX.Element` stays strictly
`ExprType<UIComponentType>` (§2.6). Anything that **isn't** a UI component — a
card header's fields, a chart's layers, a table's column specs, a matrix cell's
segments — is **not** a JSX child. It is an **option-object prop**, a config
array, or a typed callback authored with the factory.

**Why not type-bucketed child sub-tags** (`<Card><Card.Header/></Card>`, routed
by East type)? For `<Card.Header>` to be a valid child, its value type has to be
admitted into the **global** `JSX.Element` — which taxes *every* tag's
children-position (and grows with every new sub-tag type) just to make one
component special. Rejected as a general mechanism.

**The Card precedent (the pattern to follow):**
`<Card header={{ eyebrow, title, meta }}>body</Card>` — `header` is strictly the
`CardHeaderOptions` object (no component-or-string union, so no runtime "options
or component?" routing), the factory composes it, and `<Card>` is plain
`container(Card.Root)`. Zero new types, zero `JSX.Element` widening.

The same rule governs the data-driven collections and charts: structured data
stays on config props (`data=` / `columns=`), per-row builders are typed
callbacks that return **factory values** (e.g. `cell={(r, col) =>
Matrix.cell({ segments: […] })}`), and chart layers are a config array of factory
layer values — never `<Chart.Line>` / `<Table.Column>` / `<Matrix.Cell>` child
sub-tags (a layer/column/cell isn't a `UIComponentType`, so it can't be a JSX
child without widening). This supersedes the sub-tag sketches in §5.

### 2.4 Content from a child (`content`)

One combinator, `content`, covers both a **text leaf** and a **single-content
slot**: the tag's single child **is** the factory's value arg, forwarded verbatim
as that arg's own `SubtypeExprOrValue<T>` — `SubtypeExprOrValue<StringType>` for a
text leaf (`Text`/`Heading`/`Code`/`Mark`/`Badge`/`Tag`), `SubtypeExprOrValue<
UIComponentType>` for a single-content slot (`ScrollArea`/`Sticky`). No
`joinText`, no `foldStr`, no JS `string`/`number`/multi-child joining; multiple
children is a type error. Interpolate text East-side:
`<Text>{East.str\`Hi ${name}\`}</Text>`, not `<Text>Hi {name}</Text>`. A rich
label is its own component, not text — and `<Button>` is **not** a text leaf: its
label is the factory's `ButtonLabelInput` (string → `Text.Root`, or any
`UIComponentType`), forwarded by the Button tag directly, with no text-joining or
element-sniffing in the JSX layer.

### 2.5 Honest typing (remove `never`)

The `container(factory: (children: never, …))` signature and the `as never`
casts are removed; the combinator types the factory's children param as its true
`SubtypeExprOrValue<ArrayType<UIComponentType>>`, and the coalescer returns that
type. This is what makes 2.1 type-checked end-to-end instead of silently wrong.

### 2.6 `JSX.Element` stays `ExprType<UIComponentType>` (no widening)

`JSX.Element` is **strictly** `ExprType<UIComponentType>` and never widens. The
earlier idea of unioning in element-producing slot/layer types
(`… | ChartLayer | ExprType<ItemStructTypes…>`) is **rejected**: it is a global
tax on every tag's children-position, paid to let a few components accept
non-UIComponent children. Per §2.3, non-UIComponent sub-structures are props/
config/callbacks, so nothing but a `UIComponentType` is ever a JSX child — and
the children-position type stays tight, not union-granular.

### 2.7 Runtime test coverage (none exists today)

Add adversarial tests + snapshots for: a lone expression child, a mixed
static+expression parent, an expression child inside a Fragment, text
interpolation, option-object composition (Card `header`/`footer`), and an
**IR-equivalence** assertion that each `<Tag .../>` builds byte-identical IR to
its `Factory.Root(...)` form.

---

## 3. Type-safety & prop derivation

### 3.1 Canonical prop type

A JSX-facing prop that must accept value | East-expr | literal is:

```ts
prop?: SubtypeExprOrValue<XxxType> | XxxLiteral   // XxxLiteral = "a" | "b" | …
```

`SubtypeExprOrValue<XxxType>` already covers a plain JS value (auto-coerced) and
a dynamic East expression; the `| XxxLiteral` string-union is the ergonomic
proxy. UIComponent slots use `SubtypeExprOrValue<UIComponentType>` (single) or
`SubtypeExprOrValue<ArrayType<UIComponentType>>` (children) — never a plain
`ExprType<UIComponentType>[]`.

### 3.2 Derive tag props from the factory, don't author a parallel type

The hand-written TS option/style interface in each `types.ts`
(`ButtonStyle`/`ButtonOptions`/`BoxStyle`) stays the single canonical prop
vocabulary (and carries the full TypeDoc). Tag props are mechanically derived
from the factory signature via the combinator pattern already proven in the
shipped `jsx.ts`:

- `ContainerProps<F> = NonNullable<Parameters<F>[1]> & { children?: ContainerChildrenType }`
- `ContentProps<F>  = NonNullable<Parameters<F>[1]> & { children: Parameters<F>[0] }` (the value — text leaf or single-content slot)
- `ValueProps<F,K>  = Record<K, Parameters<F>[0]> & NonNullable<Parameters<F>[1]>`
- shape-3 (Button/ButtonGroup/Toggle/IconButton/… — factories whose options
  nest a visual `style` sub-object): `FlattenProps<F>` =
  `NonNullable<NonNullable<Parameters<F>[1]>['style']>` ⋃
  `Omit<NonNullable<Parameters<F>[1]>, 'style'>` ⋃ `{ children: Parameters<F>[0] }`,
  built by the `flatten(factory, topLevelKeys)` combinator. (`Card` is **not**
  shape-3 — its options bag is flat, so `<Card>` is plain `container(Card.Root)`.)

No standalone `XxxJsxProps` interface; no StructType code-gen (the TS interface
is strictly richer than the struct). The one piece of per-component hand-state
is the shape-3 top-level-vs-style key split (a `string[]`, not a type).

### 3.3 Callback families — lifted at the factory

Two families, kept distinct (no blanket runtime lift — the runtime lacks the
East param type; the factory has it):

- **Build-time accessors** — `(row) => SubtypeExprOrValue<Scalar>` (chart
  `x`/`y`/`by`/`columns`/`size`/`low`/`high`, table column `value`). Passed
  through verbatim, never lifted. These return field expressions used during IR
  construction.
- **East-function handlers** — `onClick`, `render`, `expandedContent`,
  `rowStatus`, builder children (`<Reactive>{$ => …}</Reactive>`). The factory
  prop widens to accept either an `East.function(...)` value **or** a typed
  arrow, and the factory normalizes the arrow to `East.function([Args], Ret,
  …)` because it knows `[Args]`/`Ret` for that prop. JSX forwards.

This is the resolution of the auto-lift soundness hole: the lift is at the
factory (type known), not the runtime (type unknown), and it improves the
imperative API too.

### 3.4 Reserved props

`key`, `ref`, `children` are reserved by the JSX transform. The Chart layer
series-label (`MarkStyle.key`) is exposed on the JSX layer tag as `name` and
remapped to `key` in the wrapper; the imperative factory keeps `key`. No data
prop may be literally named `children`. Codify in STANDARDS.

---

## 4. Children & values — the strict rule

Every slot is the factory's own `SubtypeExprOrValue<T>`, by combinator:

- **container children** → `ContainerChildrenType` = `SubtypeExprOrValue<
  UIComponentType> | SubtypeExprOrValue<ArrayType<UIComponentType>>` (a single
  component, or a list — §2.1).
- **text leaf / single-content slot** (Text/Badge…; ScrollArea/Sticky/Card
  header…) → the factory value as children via the one `content` combinator
  (§2.4; no array, no coalescing) — `SubtypeExprOrValue<StringType>` for text,
  `SubtypeExprOrValue<UIComponentType>` for a single-content slot. Interpolate
  text East-side with `East.str`.
- **value leaf** → the factory value `SubtypeExprOrValue<T>` under a named prop.
- **item-children components** → the item array `SubtypeExprOrValue<ArrayType<
  ItemType>>`.

No JS/TS junk arms (`string`/`number`/`boolean`/`null`), no separate `items=`
prop, no `.map` special case, no flat-mixed children. The only deviation from
`SubtypeExprOrValue<T>` anywhere is the enum `| XxxLiteral` style proxy (§3.1),
which lives on the factory option interface.

---

## 5. Complex components — config props & callbacks, never child sub-tags

Per §2.3, the JSX surface composes `UIComponentType` trees; everything that
*isn't* a UI component (columns, layers, cells, item metadata) is a **config
prop or a typed callback that returns a factory value** — never a JSX child
sub-tag (which would force `JSX.Element` to widen, §2.6). The data/config surface
is the inference-preserving canonical path. `Card` (§5.4) is the ratified
precedent; exact per-component prop spellings are settled when each is built.

### 5.1 Table

`<Table data={rows} columns={{…}} pagination={…} selection={…} />`. `columns` is
the keyed `ColumnSpec<T>` config object — keys and per-cell types inferred from
the data struct. The tag is a **generic pass-through** (`function Table<T extends
SubtypeExprOrValue<ArrayType<StructType>>, C extends ColumnSpec<T>>(props: {
data: T; columns: C; … })`), so inference is intact. `value` arrows pass through
(build-time accessors, primitive-returning); `render` is a factory-lifted
East-function handler. **No `<Table.Column>`/`<Table.Row>` markup mode** — it
needed `JSX.Element` widening; static and dynamic tables alike use the config
form.

### 5.2 Chart

Layers are a **config array of factory layer values**, not layer children (a
layer is a deferred TS object, not a `UIComponentType`):
`<Chart legend grid layers={[Chart.line(rows, {x, y}, {name}), Chart.bar(…)]}
x={…} y={…} y2={…} />`. Encoding accessors are typed callbacks returning
`SubtypeExprOrValue` field expressions (Principle 2); `Row` inference preserved.
`key`→`name` (§3.4); `Sparkline` is a flat-prop leaf. (Final prop name —
`layers=` vs `series=` — settled when built.)

### 5.3 Matrix / Gantt / Planner — callbacks return factory values

Config stays props (`data`, `columns`, `rowKey`, `legend`, axis builders). The
per-row builder callbacks receive the East `row` expression and return the
factory's expected struct/array — **East code, no JSX, no bucketing**:

- **Matrix:** `cell={(r, col) => Matrix.cell({ segments: […], markers: […] })}`.
- **Gantt:** `row={row => ({ tasks: [Gantt.Task(…)], milestones: [Gantt.Milestone(…)] })}`.
- **Planner:** `events={r => [Planner.event(…)]}` and `markers={r => [Planner.marker(…)]}`.

### 5.4 Others

- **Card (ratified, built):** body→children; `header` is the `CardHeaderOptions`
  object, `footer` the `CardFooterInput` object — strict option objects the
  factory composes (§2.3). `<Card>` is plain `container(Card.Root)`.
- **DataList:** items as a config array of `DataList.Item(label, valueChildren)`
  factory values on an `items=` prop (new `DataList.Item` factory).
- **TreeView:** nodes as a recursive data array (`nodes=` prop), built with the
  `Tree.Branch` / `Tree.Item` factories.
- **Tabs / Accordion / Select / Combobox:** items as a config array of factory
  item values (`Tabs.Item(value, title, body)`, `Select.Item(value, label)`) on
  an `items=` prop — item metadata is not a `UIComponentType`, so it is config,
  not item child sub-tags.
- **Overlays (Dialog/Drawer/Popover/HoverCard/Tooltip/Menu/…):** both `trigger`
  and the body **are** UI components, so they stay JSX-native: `trigger` is a
  `SubtypeExprOrValue<UIComponentType>` prop, body is children, flat config/
  visual props.
- **Pagination:** flat-prop leaf (four positionals → named props).

---

## 6. Factory interface improvements (benefit both surfaces)

1. **Arrow-accepting callback aliases** at the factory lift site (§3.3) for every
   East-function handler prop.
2. **Literal-union backfill** + the `XxxLiteral` naming standard for every
   nullary VariantType in a user-facing interface. Enumerated gaps to close:
   `Numeric.format` → `TickFormatLiteral` (a named-preset proxy; it is a shaped,
   not nullary, enum); Grid root style enums + `Splitter.orientation` (add the
   `| XLiteral` member); `Banner` status literal export; rename code-block's
   `CodeLanguage` → `CodeLanguageLiteral`; Gantt `TimeStepType` gets an
   object/`Gantt.Step('days', n)` proxy (payload-carrying — a bare string can't
   express it). Chart spec enums stay internal until surfaced.
3. **Widen `Card.Body` / `Card.Footer` / `Card.Section`** children from plain
   `ExprType<UIComponentType>[]` → `SubtypeExprOrValue<ArrayType<
   UIComponentType>>` so `.map`/expression children work uniformly.
4. **Chart layer `key`→`name`** on the JSX surface (§3.4).
5. **New factories:** `DataList.Item` (for the `items=` config array). No
   `Table.Column`/`Table.Row`/`Table.Cell` — the markup mode is dropped (§5.1).
6. **Card header/footer as option objects** (done): `CardOptions.header:
   CardHeaderOptions`, `footer: CardFooterInput`; `CardHeaderOptions` fields
   tightened to `SubtypeExprOrValue<StringType>`. Strictly the option objects, no
   component-or-string union — the factory composes them (§2.3, §5.4).

---

## 7. STANDARDS.md changes

- **Gold-standard pair** → `test/buttons/button-group.examples.tsx` +
  `button-group.spec.ts`.
- **`@example` blocks** on every public `Xxx.Root` show JSX (` ```tsx ` fence);
  the factory *signature* is still documented via `@param`/`@returns`. JSX and
  factory forms round-trip to identical IR.
- **New `## JSX Authoring Standards` section:**
  - per-file `/** @jsxImportSource … */` pragma; one tag import from `…/jsx`.
  - **every value/prop is the factory's `SubtypeExprOrValue<T>` — strictly; no
    JS/TS junk unions, no boundary coercion, no runtime introspection to
    validate.** The ONLY exception is an enum/variant style prop, which adds its
    `| XxxLiteral` string-union proxy (on the factory option interface).
  - container children are `SubtypeExprOrValue<UIComponentType> |
    SubtypeExprOrValue<ArrayType<UIComponentType>>`; conditionals are East
    (`ifElse`), never JS `{cond && <El/>}`; text interpolates with `East.str`.
  - two callback families: build-time accessors (pass through) vs East-function
    handlers (factory-lifted typed arrows / `East.function`).
  - data-driven components keep structured data on config props (`data=` /
    `columns=` / `items=`) and per-row builders as typed callbacks returning
    factory values; non-UIComponent sub-structures are never child sub-tags
    (`JSX.Element` never widens — §2.3/§2.6).
  - reserved props: `key`/`ref`/`children` remapped on the JSX layer.
  - tags live in a parallel `src/jsx/` tree mirroring `src/` —
    `src/jsx/<category>/<component>.ts` — never co-located inside the component
    dir (that would hit the `types.ts`↔`component.ts` cycle).
- **EXAMPLES_AUTHORING.md** + **test/CLAUDE.md**: UI example bodies return a JSX
  tag; the `example({ keywords, description, fn: East.function([],
  UIComponentType, …), inputs })` wrapper is kept verbatim (the index parser
  keys on it); compiled output is still `.examples.js`, so spec imports and
  export maps are unchanged.

---

## 8. SKILL.md / USAGE.md / @example — JSX-only corpus

The skill files (the east-ui one is the larger; the e3-ui one is smaller) are
**symlinked** into the plugin — editing the lib copy *is* editing the deployed
skill. They are rewritten to lead with JSX; the factory *signature* reference is
retained (SKILLS_STANDARD requires inline signature tables, and complex
components must keep their generic signatures).

**`east-ui/SKILL.md`** (replace, don't append — it's already near the size cap):
- Quick Start → `.tsx` (pragma/tsconfig, single `…/jsx` import, flat props) + a
  2-line factory-equivalence note.
- New `## JSX vs Factory` (1:1 sugar, same IR, when to drop to the factory).
- New `## Typed arrows` (accessor arrows; **builder children `<Reactive>{$ =>
  …}</Reactive>`** — explicitly noting this deletes the old `Reactive.Root(
  East.function(…))` nesting).
- Decision tree → retitled "Component reference (factory contract)" with a
  desugaring preamble; complex rows annotated "generic pass-through, inference
  preserved." Kept.
- Common Patterns → each rewritten JSX-first (the Reactive counter is the
  headline rewrite); one-line factory-equivalent pointers, not dual blocks.

**`e3-ui/SKILL.md`:** update entry-point map (`…/jsx` base tags+runtime;
`@elaraai/e3-ui/ui` = `ui()` + re-exported tags); rewrite Quick Start to
builder-children (`Data.bind` reads live in the `{$ => …}` block, no inner
`East.function`); fix example paths; update Packages table.

Every JSX snippet must mirror a `*.examples.tsx` that compiles in CI
(SKILLS_STANDARD: unit tests are the source of truth).

---

## 9. Examples migration — JSX-only, wholesale for UI

- **Discriminator:** every example whose `fn` returns `UIComponentType` → `.tsx`
  JSX. Genuinely non-UI examples (pure `format`/value tests) stay `.ts`. There
  is no dual ts+tsx form for the same component — the index serves one surface.
- **Body change only:** rename `*.examples.ts` → `*.examples.tsx`; the `fn` body
  returns a JSX tag instead of `Factory.Root(...)`; the `example({...})` +
  `East.function([], UIComponentType, …)` wrapper is **kept verbatim** (the index
  parser brace-matches from the first `(` after `fn:` — a bare `fn: _$ => <Box/>`
  would misparse). Specs stay `.ts` (they assert on IR via `.unwrap()`/`.match()`)
  and import `./x.examples.js` unchanged (tsc still emits `.js`).
- **Verification per the always-visually-verify rule:** rebuild → re-snapshot →
  Read the PNG for every converted example, plus the IR-equivalence assertion
  (§2.7). New IR-construction paths (children concat, style-split, option-object
  composition) mean snapshots must be eyeballed, not trusted.
- **Order:** pilot `buttons/button-group` end-to-end (build → spec green → index
  entry → PNG → IR diff), then fan out by ascending factory shape (layout/typo →
  buttons/forms → disclosure/overlays → collections/charts last). e3-ui examples
  migrate after the base tags are stable.

---

## 10. Tooling touchpoints (widen before renaming)

Four independent discovery points hardcode `*.examples.ts`. **Widen all four to
`*.examples.{ts,tsx}` first** (a harmless superset that keeps a half-migrated
tree green), then convert:

1. `libs/east-claude-plugin/index.config.json` — the east-ui/e3-ui source
   `pattern` (array form supported). The regex/brace parser handles JSX bodies
   unchanged.
2. `.github/workflows/plugin-artifacts.yml` — `paths:` filters (`push` +
   `pull_request`) must add `libs/**/*.examples.tsx`, else `.tsx`-only changes
   skip the stale-index CI gate.
3. `libs/east-ui/Makefile` (and e3-ui) — the `EAST_UI/E3_UI_EXAMPLE_KEYS`
   `find -name '*.examples.ts'` + the `sed` key strip.
4. `east-ui-showcase/scripts/vite-plugin-example-sources.ts` — the
   `.endsWith(".examples.ts")` source-view glob (feeds the snapshot pipeline).

Plus: east-ui `package.json` gains `./jsx`, `./jsx-runtime`, `./jsx-dev-runtime`
exports (none today); e3-ui's become passthroughs; tsconfig keeps `jsx:
react-jsx` and relies on per-file pragmas. Watch `exactOptionalPropertyTypes` +
`verbatimModuleSyntax` against the wrapper's `style : undefined` pattern.

**Atomicity:** glob-widening lands first (prerequisite). The SKILL.md structural
rewrite lands with the button-group pilot. Examples then migrate
incrementally per category — each PR regenerates the index under the CI gate,
the factory-contract reference stays valid throughout, and the skill never
teaches JSX while the index serves nothing.

---

## 11. Phases

| Phase | Work | Gate |
|---|---|---|
| 0 | Runtime foundation (§2): coalescer, Fragment, `East.str`, remove `never`, `JSX.Element` union, type-bucketing, tests + IR-parity | green build + adversarial tests pass |
| 1 | Relocate runtime+tags to `east-ui/src/jsx/`; e3-ui passthroughs; package.json exports; widen the 4 globs (§10) | e3-ui-showcase compiles unchanged; index count unchanged |
| 2 | Factory interface improvements (§6): callback arrow aliases, literal-union backfill, Card widening, `key`→`name`, new factories | factory tests green |
| 3 | Tags per category (§1.2), ascending shape; complex components (§5) | per-category snapshots + IR parity |
| 4 | STANDARDS / SKILL / USAGE / @example rewrite (§7–8) | SKILLS_STANDARD compliance; snippets ↔ examples |
| 5 | Wholesale UI example migration to `.tsx` (§9), pilot-first then fan-out | every PNG re-verified; index green |

---

## 11a. Implementation status

Tracks what has landed on `claude/east-ui-react-types-olfJV`. Update as phases
complete.

Branch `claude/east-ui-jsx-foundation` (PR #19).

**Done (green + committed):**
- **Relocation + mirror tree (§1.1–1.2).** Runtime + tags in `east-ui/src/jsx/`,
  a parallel tree mirroring `src/`: `runtime.ts`/`children.ts`/`combinators.ts`/
  `index.ts` + `layout/box.ts`, `typography/text.ts`, `forms/checkbox.ts`,
  `collections/table.ts` … with per-category `index.ts` barrels. One public
  `./jsx` (+ `./jsx-runtime`) subpath. e3-ui exports are passthroughs;
  e3-ui-showcase compiles unchanged; round-trip demo runs.
- **Strict typing (§0.2, §4).** Every value/prop is the factory's
  `SubtypeExprOrValue<T>`. `coalesceChildren` lowers `ContainerChildrenType`
  (single `UIComponentType` | `ArrayType<UIComponentType>`) to the factory arg
  via `East.value(...)` + `isSubtype(Expr.type(x), ArrayType(UIComponentType))`.
  `joinText`/`foldStr`/`TextChild`/the Button element-sniff/the `boolean`/`null`
  children arms are all **deleted**; text is `SubtypeExprOrValue<StringType>`;
  Button label is the factory's `ButtonLabelInput`. No runtime introspection to
  validate (see [`feedback_no_runtime_type_introspection`]).
- **Combinators + tags.** `container` / `content` / `leaf(factory, key)` (+
  `ContainerProps`/`ContentProps`/`ValueProps` derived from the factory). `content`
  is one combinator for both a text leaf (`SubtypeExprOrValue<StringType>`) and a
  single-content slot (`SubtypeExprOrValue<UIComponentType>`) — the child is the
  factory value either way. Tags: `<Box> <Flex> <Stack> <VStack> <HStack>
  <ScrollArea> <Sticky>`, `<Text> <Heading> <Code> <Mark>`, `<Badge> <Tag>`,
  `<Checkbox> <Switch> <Slider>`, `<Button>`, `<Reactive>{$ => …}</Reactive>`.
- **More clean-shape tags.** leaf: `<Meter> <Progress> <Sparkline> <Kbd>
  <Numeric>`; content: `<CodeBlock> <EditableChip> <Link> <Highlight>
  <MetricChip>`. New jsx categories `feedback/`, `charts/`, `container/`.
- **Factory normalizations (Option 1, §6).** Multi-positional leaf/content
  factories folded to `(value, options)`, **keeping the existing `XxxStyle`/
  `XxxOptions` interface name — never renaming** (see
  [`feedback_no_rename_style_interfaces`]): `Link` (`href`→`LinkStyle`),
  `Highlight` (`query`→`HighlightStyle`, dropped the `| string | string[]` arm),
  `MetricChip` (`tone`→`MetricChipOptions`, kept the `| MetricChipToneLiteral`
  proxy). `Numeric` dropped its redundant `| number` arm. Combinator tweak:
  `content`/`leaf` type the factory's 2nd arg as required so they accept a
  required-options factory.
- **Shape-3 `flatten` combinator (§3.2).** `flatten(factory, topLevelKeys)` +
  `FlattenProps<F>` lift a nested `.style` flat; `<Button>` refactored onto it
  (behaviour preserved). Exported from `./jsx`.
- **Card via option objects (§2.3, §5.4).** `header`/`footer` are strict
  `CardHeaderOptions` / `CardFooterInput` objects the factory composes (no
  component-or-string union, no runtime routing); `CardHeaderOptions` fields
  tightened to `SubtypeExprOrValue<StringType>`. `<Card>` is plain
  `container(Card.Root)`. The type-bucketed slot-children approach (a global
  `JSX.Element` union) was prototyped and **rejected** — see §2.3/§2.6.
- **`ui()` collapsed** to a single typed `ui(name, inputs, fn, options?)` (no
  closure overload, no `unknown`).
- **Tests.** `test/jsx/children.spec.tsx` (coalescer) + `combinators.spec.tsx`
  (one representative per combinator), value-equivalence vs the factory; eslint
  lints `test/**/*.tsx`.
- **Tooling globs** widened to `*.examples.{ts,tsx}` across the five discovery
  points (verified non-breaking).

**Remaining:**
- **Rest of shape-3 tags** (via `flatten`): `ButtonGroup`, `ChipRail`,
  `Carousel`, `CloseButton`; `CopyButton` (value child, `flatten`); `Toggle` /
  `IconButton` need their positional fold first (Option 1) then `flatten`.
- **Remaining leaves / options-only tags:** display (`Avatar`/`Stat`/`BarStrip`/
  `Icon`/…), feedback (`Banner`/`Status`/`Skeleton`/`EmptyState`), navigation,
  typography (`List`/`Note`), forms (`Input`/`Textarea`/`Select`/`RadioGroup`/…),
  layout (`Grid`/`Separator`/`Splitter`).
- **Config-driven complex components (§5) — no child sub-tags, no `JSX.Element`
  widening:** items-parents (`Tabs`/`Accordion`/`Select`/`SegmentGroup`) via an
  `items=` config array of factory item values; collections (`Table`/`DataList`/
  `Matrix`/`Gantt`/`Planner`/`TreeView`) via config props + callbacks that
  return factory values; charts via a layer config array. New factory:
  `DataList.Item`.
- **Overlays (§5.4):** `trigger` (UIComponent prop) + body children.
- **Strict-rule cleanups (separate pass):** `MetricChipOptions.icon` is `unknown`
  → `SubtypeExprOrValue<IconType>`; the library-wide `padding`/`margin`
  `| string` shorthand on style interfaces.
- **Phase 2 — other factory interface improvements** (§6): callback arrow
  aliases at the factory lift site; literal-union backfill; `Card.Body/Footer/
  Section` child widening; Chart `key`→`name`.
- **Phase 4 — STANDARDS / SKILL / USAGE / @example** rewrites (§7–8).
- **Phase 5 — example migration** of every `UIComponentType` example to `.tsx`
  with snapshot + IR verification (§9), pilot `buttons/button-group` first.

## 12. Risks

- **Silent IR drift** in new construction paths → mitigated by the
  IR-equivalence assertion + mandatory PNG re-verification.
- **Index emptying** if files are renamed before globs widen → globs first +
  a CI assert that the discovered example count is unchanged.
- **Canonical-surface divergence** → JSX-only corpus; `@example` + SKILL convert
  in lockstep with the examples.
- **`JSX.Element` widening creep** — the temptation to admit a slot/layer/item
  type into `JSX.Element` to enable a child sub-tag. It taxes every tag's
  children-position globally; **rejected** (§2.3/§2.6/Principle 4). Non-UIComponent
  sub-structures are props/config/callbacks, so children-position stays tight.
- **tsconfig strictness** (`exactOptionalPropertyTypes`/`verbatimModuleSyntax`)
  fighting the wrapper's optional-prop spreading → resolve in the combinator.
