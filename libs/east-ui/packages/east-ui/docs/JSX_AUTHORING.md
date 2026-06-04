# east-ui JSX — authoring surface design & implementation plan

> **Status:** APPROVED target state (sign-off captured). Supersedes the
> e3-ui-scoped `e3-ui/docs/JSX_COMPONENTS.md`, which predates the decision to
> host the runtime in east-ui. This doc is the single source of truth for the
> JSX authoring surface across **both** `@elaraai/east-ui` and `@elaraai/e3-ui`.

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

2. **Every slot is `SubtypeExprOrValue<T>` — expressions are first-class.** A
   child, a value, a style prop, a chart encoding field — each accepts a plain
   JS value **or** an East expression of the slot's type, uniformly. An East
   array expression in a children slot is simply a value of type
   `SubtypeExprOrValue<ArrayType<UIComponentType>>`; it is **not** a special
   case. There is no `.map`-specific handling and no JSX-specific map sugar —
   `rows.map(...)`, a dataset bind, a field access and a conditional are all
   just expressions that flow into a slot whose type already accepts them. The
   runtime's only job is to lower JSX's children channel into a value of that
   real type.

3. **The factory is the single lift/coercion site.** String→variant coercion,
   string→`Text.Root` label coercion, and TS-arrow→`East.function` lifting all
   happen inside the factory, where the target East type is statically known.
   The JSX tag is a thin prop-shape adapter that forwards to the factory — it
   never re-types or re-coerces East-shaped data.

4. **Type-safety lives on props; children are JSX-union-granular.** Because TSX
   exposes a single global `JSX.Element`, parent/child *position* type-checking
   is union-granular (a known TSX limitation, same as React). Prop- and
   encoding-level inference — the load-bearing part (Table `ColumnSpec<T>`,
   Chart `Row` accessors) — is **fully preserved**. Children-position mistakes
   are caught by runtime validation in the container/`<Chart>` wrappers and by
   the tags' precise return types when used directly. **No JSX form may lose
   inference the factory had** — this is a hard acceptance criterion.

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

### 1.2 File structure — `src/jsx/`, one file per category

**No per-component `index.tsx`.** A parallel tag file in each
`src/<cat>/<comp>/` dir would double the file count, triple the TypeDoc/parity
burden, fight the `types.ts`↔`component.ts` no-cycle rule, and — fatally — the
TypeScript `JSX` namespace contract can only be declared **once** per
jsxImportSource module graph; it cannot shard across component dirs.

```
src/jsx/
  runtime.tsx     # jsx / jsxs / jsxDEV / h / Fragment + the single `export namespace JSX`
                  #   → exported as ./jsx-runtime (and ./jsx-dev-runtime)
  <category>.tsx  # one file per category: buttons.tsx, layout.tsx, typography.tsx,
                  #   forms.tsx, display.tsx, feedback.tsx, navigation.tsx,
                  #   disclosure.tsx, overlays.tsx, container.tsx, collections.tsx,
                  #   charts.tsx, … — each exports that category's tag functions
  index.ts        # barrels every category file → exported as ./jsx
```

Per-category (not monolith) keeps the heavy Table/Chart/collection wrappers
reviewable and independently merge-able; it mirrors the existing
`src/<category>/` tree and the `./examples/<category>` export map. The runtime
and namespace sit in exactly one place (`runtime.tsx`); category files export
only tag functions; `index.ts` barrels them.

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

### 2.1 Type-aware children coalescer (replaces `flattenElements`)

The children channel is lowered to a value of the slot's real type,
`SubtypeExprOrValue<ArrayType<UIComponentType>>`:

- Walk JS arrays, fragments, and drop `null`/`undefined`/`boolean` (static JSX).
- A child that is an **East expression** whose East type is
  `ArrayType<UIComponentType>` is kept whole (it is already a valid slot value).
  Detect via the East type machinery (the expr's type symbol / `isValueOf`
  against `ArrayType(UIComponentType)`), **never** `Array.isArray` (an `Expr`
  is not a JS array — the current bug).
- Group consecutive static elements into `East.value([...],
  ArrayType(UIComponentType))`; join all segments (static runs + expression
  children) with East array `.concat()` into one
  `ExprType<ArrayType<UIComponentType>>`.
- Fully-static fast path: return a plain JS array (preserves the factory's
  "value" branch and current IR shape).

This is the uniform realization of Principle 2 — not a map special case. A lone
expression child, a static list, and a mix all reduce to "a value of the slot
type."

### 2.2 Fragments

`Fragment` routes through the same coalescer and returns a well-typed children
value, independent of the parent (today it leaks a raw JS array that only works
under a container parent). Fragments are meaningful as container/bucketed
children; documented as such.

### 2.3 Type-driven child bucketing (sub-tags)

For tags whose children are heterogeneous item structs, the parent routes each
child **by its East value type**:

- `<Matrix.Cell>` → `MatrixSegmentType` children to `segments`,
  `MatrixMarkerType` children to `markers`.
- A Gantt row fragment → `GanttTaskType` to `tasks`, `GanttMilestoneType` to
  `milestones`.
- `<Tree.Branch>` children (`TreeNodeType`) → the branch's recursive `children`.
- `<Chart>` collects layer children (`SeriesLayer`/`BandLayer`/`RefLayer` — TS
  objects) into the array `Chart.Root` expects (pure JS collection; layers are
  deferred TS objects, not UIComponentType).

Because each sub-tag returns a distinct East type (or TS layer type), the
bucketer discriminates by type — sound provenance with no JS tag-branding and no
reliance on tag identity surviving the `jsx()` call.

### 2.4 Text leaves (`joinText` → `East.str`)

Text children fold into a single `StringType` value. The current throw on mixed
literal+expression (`<Text>Hi {row.name}!</Text>`) is replaced by an automatic
`East.str` fold (which also string-converts non-string exprs). Keep the
all-static `join('')` fast path and the single-child pass-through.

Text-leaf tags additionally accept the value as text children **or** a single
element child where the factory's value arg is a `UIComponentType` (e.g.
`<Button>` accepts both `Save` and a rich `<HStack>` label, mirroring
`ButtonLabelInput`).

### 2.5 Honest typing (remove `never`)

The `container(factory: (children: never, …))` signature and the `as never`
casts are removed; the combinator types the factory's children param as its true
`SubtypeExprOrValue<ArrayType<UIComponentType>>`, and the coalescer returns that
type. This is what makes 2.1 type-checked end-to-end instead of silently wrong.

### 2.6 Heterogeneous `JSX.Element`

`JSX.Element` widens from `ExprType<UIComponentType>` to the union of
element-producing return types (`ExprType<UIComponentType> | ChartLayer |
ExprType<ItemStructTypes…>`). Prop typing stays precise; children-position is
union-granular (Principle 4); wrappers validate at build.

### 2.7 Runtime test coverage (none exists today)

Add adversarial tests + snapshots for: a lone expression child, a mixed
static+expression parent, an expression child inside a Fragment, text
interpolation, type-bucketed sub-tags, and an **IR-equivalence** assertion that
each `<Tag .../>` builds byte-identical IR to its `Factory.Root(...)` form.

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

- `ContainerProps<F> = NonNullable<Parameters<F>[1]> & { children?: … }`
- `TextProps<F>     = NonNullable<Parameters<F>[1]> & { children?: TextChild }`
- shape-3 (Button/Card/overlays): `FlattenProps<F>` =
  `NonNullable<Parameters<F>[1]>['style']` ⋃ `Omit<NonNullable<Parameters<F>[1]>,
  'style'>` ⋃ `{ children? }`.

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

## 4. Children & values — the uniform rule

Container children are typed `ElementChild | SubtypeExprOrValue<ArrayType<
UIComponentType>>`; value-leaf children are the value's `SubtypeExprOrValue<T>`.
The author writes static elements, an expression, or a mix; §2.1 lowers all
three to the slot's real type. The same rule applies to item-children
components (the item array is `SubtypeExprOrValue<ArrayType<ItemType>>`) and to
every value/encoding slot. There is no separate `items=` prop and no special map
path.

---

## 5. Complex components — done properly (full target state)

Both the data/config surface and the markup/callback surface are built. The
data/config surface stays the **inference-preserving canonical** path; markup
and sub-tag callbacks are additive.

### 5.1 Table

- **Data mode (canonical, type-inferred):** `<Table data={rows} columns={{…}}
  pagination={…} selection={…} />`. `columns` is the keyed `ColumnSpec<T>`
  config object — keys and per-cell types inferred from the data struct. The tag
  is a **generic pass-through** (`function Table<T extends
  SubtypeExprOrValue<ArrayType<StructType>>, C extends ColumnSpec<T>>(props: {
  data: T; columns: C; … })`), so inference is intact. `value` arrows pass
  through (build-time accessors, must stay primitive-returning); `render` is a
  factory-lifted East-function handler.
- **Markup mode (additive, static):** `<Table.Column field="…" header="…"
  render={…} />` + `<Table.Row><Table.Cell>…</Table.Cell></Table.Row>`. Requires
  new `Table.Column` / `Table.Row` / `Table.Cell` factories and an IR-assembly
  path where each cell carries both a `LiteralValueType` sort/filter value and
  optional content. Type-bucketed: column children → column specs, row children
  → rows. Used for static tables; dynamic/typed tables use data mode.

### 5.2 Chart

`<Chart legend tooltip grid x={…} y={…} y2={…}>` with layer children
`<Chart.Line data={rows} x={r => r.month} y={r => r.rev} name="Revenue" …/>`,
`<Chart.Bar>`, `<Chart.Area>`, `<Chart.Scatter>`, `<Chart.Band>`, and refs
`<Chart.RefLine>`/`<Chart.RefBand>`/`<Chart.RefDot>`. Encoding fields accept
`SubtypeExprOrValue` field expressions (Principle 2); `Row` inference is
preserved. Layers are collected as a JS array (§2.3). `key`→`name` (§3.4).
`Sparkline` is a flat-prop leaf.

### 5.3 Matrix / Gantt / Planner — sub-tag callbacks via type bucketing

The config stays props (`data`, `columns`, `rowKey`, `legend`, axis builders).
The builder callbacks receive the East `row` expression and return sub-tags the
wrapper buckets by East type (§2.3):

- **Matrix:** `cell={(r, col) => <Matrix.Cell><Matrix.Segment …/><Matrix.Marker
  …/></Matrix.Cell>}` — `<Matrix.Cell>` buckets segment vs marker children. Note
  `col` is a plain JS string (the factory iterates columns in JS); markers nest
  inside the cell (there is no separate top-level `marker=` prop).
- **Gantt:** `row={row => <><Gantt.Task …/><Gantt.Milestone …/></>}` — the
  fragment buckets into `{ tasks, milestones }`.
- **Planner:** `events={r => <><Planner.Event …/>…</>}` and `markers={r =>
  <Planner.Marker …/>}` — two *separate* callbacks, each coalescing into one
  typed array. `Planner.Point` / `Planner.Span` are the two entry tags;
  `axis`/`at` coordinate builders stay expression props.

### 5.4 Others

- **DataList:** add a real `DataList.Item(label, valueChildren)` factory (none
  exists today; items are bare `{label, value}` literals). `<DataList.Item
  label="…">…</DataList.Item>`.
- **TreeView:** `<Tree.Branch>`/`<Tree.Item>` wrap existing factories;
  recursive children bucket into `Branch.children` by `TreeNodeType`.
- **Tabs / Accordion:** `<Tab value title>…</Tab>` — `title` accepts
  string|element (→ trigger), body → content. Item-children, dynamic item
  expressions supported.
- **Select / Combobox:** `<Select.Option value>label</Select.Option>` (alias of
  `Select.Item`); `value`→arg1, `onChange`/`placeholder`→style bag; `multiple`
  switches `onChange`↔`onChangeMultiple`.
- **Card:** body→children; `header` (string|element) / `footer` →slot props;
  `<Card.Header>`/`<Card.Title>`/`<Card.Actions>` produce the slot UIComponents.
- **Overlays (Dialog/Drawer/Popover/HoverCard/Tooltip/Menu/…):** `trigger={<…/>}`
  slot prop + body children + flat config/visual props.
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
5. **New factories:** `DataList.Item`; `Table.Column`/`Table.Row`/`Table.Cell`
   (markup mode). All additive; no breaking change.

---

## 7. STANDARDS.md changes

- **Gold-standard pair** → `test/buttons/button-group.examples.tsx` +
  `button-group.spec.ts`.
- **`@example` blocks** on every public `Xxx.Root` show JSX (` ```tsx ` fence);
  the factory *signature* is still documented via `@param`/`@returns`. JSX and
  factory forms round-trip to identical IR.
- **New `## JSX Authoring Standards` section:**
  - per-file `/** @jsxImportSource … */` pragma; one tag import from `…/jsx`.
  - every enum prop is `SubtypeExprOrValue<XType> | XLiteral`; string shorthands
    are the default authoring form.
  - children/values/encodings are `SubtypeExprOrValue<T>`; expressions are
    first-class; never a plain TS object array for East-shaped data; no special
    map handling.
  - two callback families: build-time accessors (pass through) vs East-function
    handlers (factory-lifted typed arrows / `East.function`).
  - data-driven components keep structured data on config props (`data=` /
    `columns=` / `items=`); type-bucketed sub-tags for markup/builder callbacks.
  - reserved props: `key`/`ref`/`children` remapped on the JSX layer.
  - **no per-component `index.tsx`**; tags live in `src/jsx/<category>.tsx`.
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
  (§2.7). New IR-construction paths (children concat, style-split, bucketing)
  mean snapshots must be eyeballed, not trusted.
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

**Done (green + committed):**
- **Phase 1 — relocation.** Runtime + tags moved to `east-ui/src/jsx/`
  (`runtime.ts`, `children.ts`, `combinators.ts`, `layout.ts`, `typography.ts`,
  `display.ts`, `buttons.ts`, `reactive.ts`, `index.ts`); `./jsx`,
  `./jsx-runtime`, `./jsx-dev-runtime` exports added; e3-ui `jsx.ts` /
  `jsx-runtime.ts` are passthroughs. e3-ui-showcase compiles unchanged; round-trip
  demo runs.
- **Phase 0 — runtime foundation.** East-array-aware `coalesceChildren`
  (lone `.map` child kept whole; mixed static+expr concat in source order;
  Fragment routed through the coalescer), `joinText`→`East.str` fold,
  `never`-casts removed. `test/jsx/runtime.spec.tsx` pins the four dynamic cases
  + IR/value-equivalence against the factory output, using the self-referential
  `/** @jsxImportSource @elaraai/east-ui */` pragma (validated on a clean build).
- **Phase 3 (partial) — tags.** `<Box> <Flex> <Stack> <VStack> <HStack>`,
  `<Text> <Heading> <Code> <Mark>`, `<Badge> <Tag>`, `<Button>`, and the
  `<Reactive>{$ => …}</Reactive>` builder-children tag. Generic builder type
  renamed `Tag<P>`→`JsxTag<P>` (collided with the `<Tag>` component).
- **Phase 5 (prep) — tooling globs widened** to `*.examples.{ts,tsx}` across the
  five discovery points (plugin `index.config.json`, `plugin-artifacts.yml`
  paths, east-ui `Makefile`, showcase `discover-example-files.ts` +
  `vite-plugin-example-sources.ts`). Verified non-breaking (index byte-identical).

**Remaining:**
- **Phase 3 (rest of tags).** A `leaf` combinator (shape-2 value+options:
  forms `Checkbox/Switch/Slider/Input/Select/…`, display `Avatar/Stat/Meter/…`,
  feedback `Progress/Status/Banner/…`); the shape-3 generalization
  (`CloseButton/CopyButton/Toggle/Card/ScrollArea/Sticky/ChipRail`); IconButton +
  ButtonGroup; items-parent (`Grid/Splitter/Tabs/Accordion/Select/SegmentGroup/…`);
  trigger+body overlays (`Dialog/Drawer/Popover/Menu/Tooltip/…`); the complex
  collections/charts with type-driven sub-tag bucketing (§2.3, §5) and the new
  factories (`DataList.Item`, `Table.Column/.Row/.Cell`).
- **Phase 2 — factory interface improvements** (§6): arrow-accepting callback
  aliases at the factory lift site; literal-union backfill; Card child widening;
  Chart `key`→`name`.
- **Phase 4 — STANDARDS / SKILL / USAGE / @example** rewrites (§7–8).
- **Phase 5 — example migration** of every `UIComponentType`-returning example to
  `.tsx` with snapshot + IR verification (§9), pilot `buttons/button-group` first.

## 12. Risks

- **Silent IR drift** in new construction paths → mitigated by the
  IR-equivalence assertion + mandatory PNG re-verification.
- **Index emptying** if files are renamed before globs widen → globs first +
  a CI assert that the discovered example count is unchanged.
- **Canonical-surface divergence** → JSX-only corpus; `@example` + SKILL convert
  in lockstep with the examples.
- **TSX children-position looseness** (§Principle 4) → runtime validation in
  container/`<Chart>` wrappers; precise tag return types.
- **tsconfig strictness** (`exactOptionalPropertyTypes`/`verbatimModuleSyntax`)
  fighting the wrapper's optional-prop spreading → resolve in the combinator.
