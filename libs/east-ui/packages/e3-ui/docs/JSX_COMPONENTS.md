# east-ui JSX — component coverage proposal

> **Status:** DRAFT for approval. No implementation beyond the 7 tags already
> shipped (`Box`, `Stack`, `VStack`, `HStack`, `Text`, `Heading`, `Button`).
> This doc proposes JSX tags + (where useful) new east-ui factory functions for
> **every** east-ui component, for sign-off before building.

## 1. Goals & ground rules

- **JSX is authoring sugar over East IR.** `<Box>` evaluates to the *same*
  `ExprType<UIComponentType>` value `Box.Root(...)` returns. No React at
  runtime; the value serializes and renders exactly like the factory output.
  (Proven end-to-end: `ui('hello', () => <VStack>…</VStack>)` → deployed →
  `e3 dataflow run` → `e3 dataset get` returns the expected `.Stack/.Heading/
  .Text/.Button` IR.)
- **`.tsx` only.** Literal `<Box>` requires a `.tsx` file — the `.ts` parser
  reads `<` as a type assertion. No pragma/decorator changes that. Authoring
  with JSX therefore happens in `.tsx`; everything else (`.ts`) keeps using the
  factory API. (`.tsx` is a strict superset of `.ts` — the only thing it
  removes is `<T>x` casts, which East code never uses.)
- **Flat props, like React.** Style props sit at the top level of the tag:
  `<Box padding="4">`, `<Button variant="solid" colorPalette="blue">`. The
  wrapper splits them back into the factory's `(value/children, style)` (or
  `options.style`) shape.
- **One import for authoring.** `import { ui, Box, VStack, Text, … } from
  '@elaraai/e3-ui/ui'`. The runtime (`/jsx-runtime`) is compiler-only.
- **Type-safe.** Each tag's props are derived from the real factory types, so
  `variant="solid"`, `padding="4"`, etc. are checked against east-ui's style
  types and autocomplete.

## 2. The wrapper shapes (combinators)

Almost every component reduces to one of four shapes. The first three are
mechanical (one line each); only the fourth needs per-component design.

| Combinator | Factory shape | JSX | Status |
|---|---|---|---|
| `container(f)` | `(children, style?)` | `<Box p="4">{kids}</Box>` | ✅ shipped |
| `textLeaf(f)` | `(value: string-ish, style?)` | `<Text bold>hi</Text>` | ✅ shipped |
| `leaf(f)` | `(value?, style?)` or single `options` — **no UI children** | `<Checkbox checked={c} />` | ➕ proposed |
| *bespoke* | multi-positional / compound / data-driven | see §5 | ➕ proposed |

**Style location.** Most factories take `style` as the 2nd positional arg; some
newer ones nest visual style under `options.style` (like `Button`). The wrapper
knows which, and either passes the flat rest-props as `style` directly, or
splits known option keys (`onClick`, `onChange`, `min`, …) to the top level and
folds the remaining visual props into `style` — exactly the split already done
for `<Button>`.

**Wrap-your-own.** `container`, `textLeaf`, and `leaf` are exported, so any
factory not pre-wrapped (including user components) is a one-liner:
`export const Flex = container(FlexFactory.Root)`.

## 3. Mixing TS and East — props *and* children take either, freely

The core design principle: east-ui authoring blends two layers, and JSX must let
them interleave anywhere.

- **TS / JS layer** — literals, JS arrays, `.map` over JS data, `&&`/ternary,
  spreads. Evaluated at authoring (IR-build) time.
- **East layer** — East expressions: field access (`t.value`), East `.map` over
  an East array, `ifElse`, bound dataset values. Compiled into IR, evaluated at
  runtime.

Neither is privileged; you mix them in the same tree.

### 3a. Props accept a TS value *or* an East expression (already true today)
`SubtypeExprOrValue` makes every prop bivalent:
```tsx
<Text>hi</Text>                                   {/* TS string literal */}
<Text>{row.name}</Text>                           {/* East string expression */}
<Badge colorPalette={ok.ifElse("green","red")}>…</Badge>  {/* East conditional */}
```

### 3b. Children, TS side — element values & JS arrays
```tsx
<VStack gap="2">
  <Text>One</Text>
  {labels.map(l => <Text>{l}</Text>)}    {/* labels: JS string[] — a TS map */}
  {showFooter && <Text>footer</Text>}    {/* TS conditional */}
</VStack>
```
A child may be an element or a JS array of them; nested arrays flatten,
`null`/`false` drop.

### 3c. Children, East side — one array *expression*
```tsx
// rows : ExprType<ArrayType<Row>>  — a runtime East array (e.g. a dataset)
<VStack>{rows.map(r => <Text>{r.name}</Text>)}</VStack>
```
`rows.map(...)` is **East's** map: `r` is an East element expression and the
child is a single `ExprType<ArrayType<UIComponentType>>`. You can't JS-iterate
`rows` (it's a runtime value) — East `.map` yields an expression. Factories
already accept an East array for their children arg, so it slots in as a child.

### 3d. Mix them in one parent
```tsx
<Tabs>
  <Tab value="all" title="All">{…}</Tab>           {/* TS static element */}
  {presetTabs.map(p => <Tab value={p.id} .../>)}   {/* TS map over JS array */}
  {liveGroups.map(g => <Tab value={g.id} .../>)}   {/* East map over East array */}
</Tabs>
```
The wrapper coalesces in order: a run of TS element values becomes an East array
value (`East.value([...], ArrayType(TabType))`), East array-expressions are
concatenated with it (via East's array concat), yielding one `ArrayType<Tab>`
for `Tabs.Root`. All-TS-static stays a plain JS array passed straight through
(factories already accept a JS array — no `East.value` needed).

> **Design note / open question (§7):** to support 3c and 3d the wrapper must be
> **East-array-type aware** — inspect each child's East type and concatenate
> `ArrayType` children instead of pushing them as a single element. The shipped
> `container`/`textLeaf` do only the all-static case today; East-array children
> + mixed coalescing is new work this proposal adds. Note there's no separate
> "static vs dynamic" authoring mode for item components — both are just
> children. (Structured `data`/`columns` table input is a different shape; §5.)

## 4. Per-component reference

> Tables below are completed from a precise signature survey (in progress).
> Each row: **Component · current east-ui args · proposed JSX · new fn?**

### 4.1 Containers — `container()` (shipped pattern)

| Component | east-ui `.Root` | JSX | New fn? |
|---|---|---|---|
| Box | `(children, style?)` | `<Box padding="4">…</Box>` | — |
| Flex | `(children, style?)` | `<Flex gap="2">…</Flex>` | — |
| Stack / VStack / HStack | `(children, style?)` | `<VStack gap="4">…</VStack>` | — |
| Card | `(children, style?)` | `<Card>…</Card>` | — |
| List | `(items, style?)` | `<List>…</List>` | — |
| Note | `(body, style?)` | `<Note>…</Note>` | — |
| ScrollArea | `(content, {style})` | `<ScrollArea maxH="300px">…</ScrollArea>` | — (nested-style split) |
| Sticky | `(content, {style})` | `<Sticky top="0">…</Sticky>` | — (nested-style split) |
| ChipRail | `(chips, {style})` | `<ChipRail>…</ChipRail>` | — (nested-style split) |

### 4.2 Text leaves — `textLeaf()` (shipped pattern)

| Component | east-ui `.Root` | JSX | New fn? |
|---|---|---|---|
| Text | `(value, style?)` | `<Text color="fg.muted">hi</Text>` | — |
| Heading | `(value, style?)` | `<Heading>Title</Heading>` | — |
| Code | `(value, style?)` | `<Code>const x = 1</Code>` | — |
| Mark | `(value, style?)` | `<Mark>highlight</Mark>` | — |
| Badge | `(value, style?)` | `<Badge colorPalette="green">New</Badge>` | — |
| Tag | `(label, style?)` | `<Tag>v1</Tag>` | — |
| Kbd | `(value, style?)` | `<Kbd>⌘K</Kbd>` | — |

### 4.3 Value / display leaves — `leaf()` (proposed) — *pending survey*

_To be completed: Checkbox, Switch, Slider, Input, Textarea, TagsInput,
Progress, Avatar, AvatarGroup, Icon, Meter, SegmentedMeter, EditableChip,
MetricChip, Numeric, BarStrip, Breadcrumb, Skeleton, Status, FileUpload._

### 4.4 Multi-argument tags — bespoke, extra args → props — *pending survey*

_To be completed: Link (href), Highlight (query), CodeBlock (lang), Stat
(label/value), IconButton (icon/label), CopyButton, CloseButton, Toggle
(pressed), Field (control), Separator, DateRangeInput, TimeRangeInput,
TimeScaleControl, Banner, EmptyState._

### 4.5 Compound / data-driven — sub-tags + new factories — *pending survey, see §5*

## 5. Compound component designs

Pattern: **the parent's children are its item sub-tags**, each sub-tag emitting
one item struct; the parent's *other* `.Root` args (`value`, `options`,
`trigger`) become **props**. Children obey §3 — static, East `.map`, or mixed.
Where a sub-tag has no `.ts` counterpart yet, an *additive* item factory is
proposed (named to match the tag). Signatures below are the real current ones.

### 5.1 Item-children components

| Parent tag (props) | Item sub-tag (props) → factory | Current `.Root` / item factory | New fn? |
|---|---|---|---|
| `<Tabs value defaultValue onChange>` | `<Tab value title disabled>{body}</Tab>` | `Tabs.Root(items, opts)` · `Tabs.Item(value, trigger, content, opts?)` | `Tabs.Tab` alias of `.Item` (title→trigger) |
| `<Accordion multiple collapsible value onChange>` | `<Accordion.Item value title meta disabled>{body}</Accordion.Item>` | `Accordion.Root(items, opts)` · `Accordion.Item(value, title, content, opts?)` | — (rename arg only) |
| `<Select value onChange>` | `<Select.Option value disabled>label</Select.Option>` | `Select.Root(value, items, style?)` · `Select.Item(value, label, style?)` | `Select.Option` alias |
| `<Combobox value onChange>` | `<Combobox.Option value disabled>label</Combobox.Option>` | `Combobox.Root(value, items, style?)` · `Combobox.Item(...)` | `Combobox.Option` alias |
| `<SegmentGroup value onChange>` | `<SegmentGroup.Item value disabled>label</SegmentGroup.Item>` | `SegmentGroup.Root(value, items, opts?)` · `.Item(value, label, opts?)` | — |
| `<OptionList>` | `<OptionList.Option id description trailing disabled>label</…>` | `OptionList.Root(options, opts?)` · `.Option(id, label, opts?)` | — |
| `<RadioGroup value onChange>` | `<Radio value disabled>label</Radio>` | `RadioGroup.Root(value, items: JS[], style?)` | **`RadioGroup.Item`** (items are JS objects today) |
| `<RadioCardGroup value onChange>` | `<RadioCard value description disabled>label</RadioCard>` | `RadioCardGroup.Root(value, items: JS[], style?)` | **`RadioCardGroup.Item`** |
| `<Menu trigger=…>` | `<Menu.Item value disabled>label</Menu.Item>`, `<Menu.Separator/>` | `Menu.Root(trigger, items, style?)` · `.Item(value,label,disabled?)` · `.Separator()` | — |
| `<Tree>` | `<Tree.Item value label indicator/>`, `<Tree.Branch value label>{nodes}</Tree.Branch>` | `TreeView.Root(nodes, opts?)` · `.Item(...)` · `.Branch(value,label,children,opts?)` | — |
| `<Grid templateColumns gap>` | `<Grid.Item colSpan rowSpan area>{content}</Grid.Item>` | `Grid.Root(items, style?)` · `.Item(content, style?)` | — |
| `<Splitter defaultSize={[…]}>` | `<Splitter.Panel minSize maxSize collapsible>{content}</Splitter.Panel>` | `Splitter.Root(panels, defaultSize, style?)` · `.Panel(content, config)` | — |
| `<DataList>` | `<DataList.Item label>{value}</DataList.Item>` | `DataList.Root(items, style?)` · item `{label,value}` | **`DataList.Item`** |
| `<ButtonGroup>` | plain `<Button>` children | `ButtonGroup.Root(buttons: UIComp[], opts?)` | — (it's a `container()`) |
| `<Carousel loop autoplay slidesPerView>` | plain element children | `Carousel.Root(items: UIComp[], opts?)` | — (it's a `container()`) |

Example (Select, all three child styles from §3):
```tsx
<Select value={sel} onChange={setSel}>
  <Select.Option value="all">All</Select.Option>          {/* TS static */}
  {presets.map(p => <Select.Option value={p}>{p}</Select.Option>)}      {/* TS map */}
  {liveItems.map(i => <Select.Option value={i.id}>{i.name}</Select.Option>)} {/* East map */}
</Select>
```

### 5.2 Trigger + body components (overlays + collapsible)

The `trigger` is a single element → a **slot prop** holding JSX; the body is
children; extra text fields (`title`, `description`, `eyebrow`) are props.

| Tag | Current `.Root` | JSX |
|---|---|---|
| Dialog | `(trigger, body, style?)` + eyebrow/title/description | `<Dialog trigger={<Button>Open</Button>} title="…">{body}</Dialog>` |
| Drawer | `(trigger, body, style?)` + title/description | `<Drawer trigger={…} title="…">{body}</Drawer>` |
| Popover | `(trigger, body, style?)` + title/description | `<Popover trigger={…}>{body}</Popover>` |
| HoverCard | `(trigger, body, style?)` | `<HoverCard trigger={…}>{body}</HoverCard>` |
| Tooltip | `(trigger, content: string, style?)` | `<Tooltip content="hint">{trigger…}` or `trigger=` prop |
| Collapsible | `(trigger, content, options?)` | `<Collapsible trigger={…} defaultOpen>{content}</Collapsible>` |

> **Open question (§7):** trigger as a **prop** (`trigger={<Button/>}`) vs a
> **sub-tag** (`<Dialog.Trigger>…</Dialog.Trigger>` + `<Dialog.Body>`). Prop is
> terser for the common single-trigger case; sub-tags are more uniform. Leaning
> prop. (Tooltip's `content` is a plain string, so `content="…"` as a prop with
> the trigger as children reads best there.)

### 5.3 Layered chart

Layers are already sub-factories returning layer values, so they map directly to
layer **children**; `rows` is structured data → a `data` prop.
```tsx
<Chart data={series}>
  <Chart.Line x="t" y="value" />
  <Chart.Bar x="t" y="count" />
  <Chart.RefLine y={threshold} />
</Chart>
```
`Chart.Root(rows, layers, options?)` · existing `Chart.Line/Bar/Area/Scatter/
Band/refLine/refBand/refDot`. New fns: none — just wrap the layer factories.

### 5.4 Structured data tables — the `<Table.Row>` question

`Table`, `Gantt`, `Matrix`, `Planner` are **not** item-element lists — their
`.Root` takes structured rows + a `columns` schema:
```ts
Table.Root(rows: ArrayType<Dict<String, TableCell>>, columns: ArrayType<TableColumn>, options?)
```
So the natural JSX is **data-prop driven** (and the dynamic/runtime case *must*
be, since rows are an East array): `<Table data={rows} columns={cols} />`.

Your `<Table.Row>`/`<Table.Cell>` idea is a **second, markup authoring mode**:
```tsx
<Table>
  <Table.Column key="name">Name</Table.Column>
  <Table.Column key="qty">Qty</Table.Column>
  <Table.Row><Table.Cell>Widget</Table.Cell><Table.Cell>{count}</Table.Cell></Table.Row>
</Table>
```
This needs **new east-ui factories** — `Table.Row(cells)`, `Table.Cell(value,
content?)`, and `Table.Column(key, …)` returning the row/column structs — plus
parent logic to assemble `rows` + `columns` from children. It's genuinely new
surface (Table is data-only today), and it only suits **static/known** tables;
dynamic data still flows through `data=`. **Flagged for explicit approval in §7
— build the markup mode, or data-prop only?**

## 6. New east-ui factory functions proposed (summary)

Per "we can change component function shapes if it's easier" — these *additive*
factories give each JSX sub-tag a 1:1 `.ts` counterpart. **No breaking changes**
to existing `.Root` signatures; most sub-factories already exist.

**Already exist** (sub-tag just wraps them): `Accordion.Item`, `SegmentGroup.Item`,
`OptionList.Option`, `Menu.Item`/`.Separator`, `TreeView.Item`/`.Branch`,
`Grid.Item`, `Splitter.Panel`, `Select.Item`, `Combobox.Item`,
`Chart.Line`/`.Bar`/`.Area`/`.Scatter`/`.Band`/`.refLine`/`.refBand`/`.refDot`,
`Gantt.task`/`.milestone`.

**Proposed new (thin aliases — same struct, tag-matching name):**
`Tabs.Tab` (= `Tabs.Item`), `Select.Option` (= `Select.Item`),
`Combobox.Option` (= `Combobox.Item`).

**Proposed new (genuinely new, items are JS objects / data-only today):**
`RadioGroup.Item`, `RadioCardGroup.Item`, `DataList.Item`.

**Proposed new (the markup-mode table — biggest decision):**
`Table.Row`, `Table.Cell`, `Table.Column` (and possibly the same for
`Matrix`/`Gantt`/`Planner`). See §5.4.

> Aliases are optional sugar — if you'd rather not add `Tabs.Tab`/`*.Option`,
> the JSX tag can map straight to the existing `.Item` and we skip the alias.

## 7. Decisions needed for sign-off

Resolved already (your steers): scope = all four tiers; props & children mix TS
and East freely (§3); dynamic item lists are East `.map` children, **not** an
`items=` prop, for item-based components.

Still need your call:

1. **Table markup mode** (`<Table.Row>`/`<Table.Cell>`/`<Table.Column>`): build
   it as a second authoring mode *alongside* `data=`, or keep Table/Matrix/Gantt
   **data-prop only**? Markup mode = new east-ui factories + static-only. (§5.4)
2. **Children coalescing (§3d):** confirm the wrapper should support *mixing* TS
   static elements **and** East `.map` arrays in one parent (needs East-array-
   type-aware concat). Cheaper alternative: allow *either* all-static *or* a
   single East `.map`, but not interleaved. Which?
3. **Trigger slot (§5.2):** `trigger={<Button/>}` **prop** (leaning this) vs
   `<Dialog.Trigger>` **sub-tag**.
4. **Sub-tag naming:** namespaced `<Tabs.Tab>`, `<Select.Option>` (proposed,
   unambiguous) vs bare `<Tab>`, `<Option>` (prettier, collision-prone).
5. **Alias factories:** add `Tabs.Tab` / `Select.Option` / `Combobox.Option`
   (1:1 with tags), or map those tags straight onto existing `.Item` and skip
   the aliases?
