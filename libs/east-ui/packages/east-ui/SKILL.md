---
name: east-ui
description: "Type-safe UI components for the East language, authored as JSX tags in .tsx files that compile to East IR: layout (Box, Stack, Grid, SnapGrid, Splitter, Dock), forms (Input, Select, Combobox, Slider, Switch, Field, date and time ranges), data display (Table with nested rows, DataList, TreeView, ValueTree, Matrix, Map, Library, Deck, Blend, Slice.Rail), charts (Chart layers Chart.Line/Column/Bar/Area/Scatter/Band with reference lines, Sparkline), overlays (Dialog, Drawer, Popover, Menu, Tooltip, CommandPalette), feedback (Banner, Status, Progress), disclosure (Tabs, Accordion, SegmentGroup), reactive state (Reactive, State.bind, Match), value formats (Format.*, Chart.format.*) and the status colour vocabulary. Use when writing East programs that define user interfaces; binding them to e3 workspace data is e3-ui's."
---

# East UI

A type-safe UI component library for the East language. The public surface is
**JSX tags** — capitalized, React-style components that desugar to East IR. No
React at runtime: a `<Button>` evaluates to an `ExprType<UIComponentType>`
value, which serializes and renders anywhere.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

For east-ui, search with `package: "east-ui"`: every tag has examples, usually
a `…Basic` one and a `…Variants` one showing each prop. A prop's full contract
is in its doc comment, and a factory refuses a wrong shape at build with an
error that names the fix.

## Quick Start

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East } from "@elaraai/east";
import { VStack, HStack, Text, Button, UIComponentType } from "@elaraai/east-ui";

const MyComponent = East.function([], UIComponentType, (_$) => (
    <VStack gap="4" padding="6">
        <Text textStyle="heading-md" fontWeight="bold">Hello, World!</Text>
        <HStack gap="2">
            <Button variant="outline">Cancel</Button>
            <Button variant="solid" colorPalette="blue">Save</Button>
        </HStack>
    </VStack>
));

const ir = MyComponent.toIR();
```

What makes a file JSX-capable:
1. The per-file pragma `/** @jsxImportSource @elaraai/east-ui */` (first line).
2. `"jsx": "react-jsx"` in the project's tsconfig. A scaffolded project has it;
   in a bare folder, add it, or `tsx` compiles JSX to `React.createElement` and
   fails with `React is not defined`.
3. A `.tsx` extension, and the tags imported from `@elaraai/east-ui`.

**Tags vs factories.** Each tag desugars 1:1 to a factory call —
`<Button variant="solid">Save</Button>` builds the same IR as
`Button.Root("Save", { variant: "solid" })`. The factories are an implementation
detail under `@elaraai/east-ui/internal`. Author with tags; props are exactly
the factory's flat options bag.

## Decision Tree: Which Tag to Use

Props are the factory's flat option bag — no nested `style` object. Children
are always UI components; non-UI sub-structures (columns, layers, cells, items)
are **config props or typed callbacks**, never child sub-tags. An `items` prop
takes its component's item factory (`Select.Item(value, label)`,
`SegmentGroup.Item(key, content)`, …), not bare strings.

Two prop bags recur on layout and display tags:

- **BOX bag** (all optional) — `width`, `height`, `minWidth`, `minHeight`,
  `maxWidth`, `maxHeight`, `padding`, `margin`, `overflow`, `overflowX`,
  `overflowY`, `opacity`. See the Sizing pattern for the string spellings.
- **COLOR overrides** (all optional) — `color`, `background`, `borderColor`:
  semantic tokens (`fg.muted`, `bg.subtle`) or CSS colours.

Every icon is a Font Awesome **solid** icon: an icon prop takes
`{ prefix: "fas", name: "…" }`, or the bare solid name where it says so.

```
Task → Which tag?
│
├─ Layout (arrange content)
│   ├─ <Box> — generic block container (display, flex, fill / scroll shorthands, position, border, density)
│   ├─ <Flex> — flexbox container
│   ├─ <Stack> / <VStack> / <HStack> — flex with stacking defaults (VStack = column, HStack = row)
│   ├─ <Grid> — CSS grid container; Grid.Item(children, { colSpan?, rowSpan?, … }) places one child
│   ├─ <SnapGrid data={rows} cell={r => SnapGrid.cell({ key, row, span, content })} /> — a page of tiles held as data on the 12-column grid; variant="wireframe" draws its thumbnail; edit + editing make it an editing canvas
│   ├─ <Splitter> — resizable panel group (collapseBelow stacks it on narrow screens)
│   ├─ <Configurator> — labelled control table + live preview + derived spec readout
│   ├─ <Separator> — 1px rule
│   ├─ <ScrollArea> — styled-scrollbar scroll container
│   ├─ <Sticky> — position-sticky wrapper
│   ├─ <Expandable> — region expands in place to fill the app container (no remount); Esc collapses
│   └─ <Dock> — inline pane that collapses along an axis to an icon rail, staying in flow (a source panel beside a drop target)
├─ Container
│   └─ <Card> — chrome-bearing content card (vs <Box>, which is structural only)
├─ Typography (display text)
│   ├─ <Text> — inline/block text
│   ├─ <Heading> — display heading
│   ├─ <Link> — hyperlink
│   ├─ <Code> / <CodeBlock> — inline code token / multi-line code block
│   ├─ <List items={…}> — bulleted / numbered list
│   ├─ <Highlight> / <Mark> — tints query substrings / a semantic <mark> span
│   ├─ <Note> — inset callout / quote
│   └─ <Numeric> — tabular-num number with sentiment, printed through a Format.* spec
├─ Buttons (user actions)
│   ├─ <Button> — the standard action button (onClick, loading, variant, colorPalette)
│   ├─ <IconButton> / <CloseButton> / <CopyButton> — icon-only / × dismiss / copy with ✓ feedback
│   ├─ <Toggle> — pressable on/off button (not a form toggle — see <Switch>)
│   └─ <ButtonGroup> — row/col cluster of buttons
├─ Forms (user input) — value + onChange, the value usually a State.bind read
│   ├─ <Input> — typed inputs (namespace tag: Input.String, Input.Float, Input.Integer, Input.DateTime)
│   ├─ <Textarea> — multi-line input
│   ├─ <Select items={[Select.Item(value, label), …]}> — single/multi-select dropdown
│   ├─ <Combobox> — typeahead / filter select
│   ├─ <Checkbox> / <Switch> — boolean in a list / a form on/off toggle
│   ├─ <Slider> — range slider (onChange, onChangeEnd)
│   ├─ <RadioGroup> / <RadioCardGroup> — single-select radio list / radios as picker cards
│   ├─ <TagsInput> — typeahead chip input
│   ├─ <FileUpload> — drop-zone file picker
│   ├─ <Field> — form-field wrapper (label + control + helper/error)
│   └─ <DateRangeInput> / <TimeRangeInput> — start–end date pair with presets / time pair (minutes since midnight)
├─ Collections (display data sets) — structured data on `data=` / `columns=` / `items=` props
│   ├─ <Table data={rows} columns={…} /> — sortable / pinnable / virtualized grid
│   │   ├─ columns: ["a","b"] or { a: { header, width, value?, render?, format?, aggregate? } }
│   │   ├─ nested rows from the data's own tree → tree={{ children: r => r.lines, collapsed? }} + a column's aggregate
│   │   ├─ data: an array of row structs, or a paged source (e3-ui's Data.bindPaged)
│   │   └─ selection / pagination / frozen / expandedContent / rowStatus / onRowClick … / slice
│   ├─ <DataList items={…} /> — label/value pairs
│   ├─ <TreeView nodes={…} /> — expandable hierarchical tree with selection
│   ├─ <ValueTree value={anyEastValue} /> — editable tree of any East value, from its static type
│   ├─ <Matrix data={…} columns={…} cell={(r, col) => Matrix.cell({…})} /> — rows × columns of status-coloured segment bars
│   ├─ <Map markers={…} center={Map.at(lat,lng)} zoom={n} /> — geographic basemap; read-only / selection-only
│   ├─ <Library id="…" data={rows} item={r => ({…})} /> — draggable palette (a drag source), or variant="gallery": large browsable cards whose media is any component
│   ├─ <Deck data={rows} statuses={Deck.statuses({…})} card={r => ({ key, title, status, metrics, fill })} /> — status-coloured mini-card board (display, not a drag source)
│   ├─ <Blend targets={…} config={{…}} /> — blend / batch assembly surface fed by a Library; 1 target single, 2 compare, 3+ portfolio
│   ├─ <Slice.Rail slice={slice} affordances={[…]} /> — narrowing chrome over one bound dataset (Slice.bind); consumers read Slice.rows(slice)
│   ├─ <Pagination> — page-number control
│   └─ <Plan>, <Sheet>, <Calendar>, <Roster>, <Allocation>, <Flowchart>, <Schematic> — the planning builders are e3-ui's (`import { Plan } from "@elaraai/e3-ui"`)
├─ Charts (visualize data) — layers are a config array of factory values, never child tags
│   ├─ <Chart layers={[…]} x? y? y2? grid? legend? tooltip? /> — x-scale inferred from the x accessor (String → band, number → linear, DateTime → time); give it a height (a sized parent, or height)
│   │   ├─ Chart.Line / Chart.Column / Chart.Area / Chart.Scatter(rows, encoding, style?) — encoding { x, y } · { x, y, by } (split) · { x, columns: { Name: r => r.field } } (wide)
│   │   ├─ Chart.Bar(rows, { x: numeric, y: category }, style?) — HORIZONTAL bars (Column is the vertical one); can't mix with vertical marks
│   │   ├─ Chart.Band(rows, { x, low, high }, style?) — filled range (a confidence band)
│   │   ├─ Chart.refLine({ y }|{ x }, label?, dash?) · Chart.refBand({ y: [lo, hi] }|{ x: [lo, hi] }, label?) · Chart.refDot({ x, y, label? })
│   │   ├─ axis options x / y / y2: { label?, format?, domain?, scale?, numTicks?, tickValues? }
│   │   └─ Chart.Series(slice, { x, value, mark? }) — a slice-bound layer
│   └─ <Sparkline data type? /> — inline trend beside a <Stat>
├─ Display (show information)
│   ├─ <Stat label value format? /> — metric tile: the raw value with a Format.* spec, plus change indicator
│   ├─ <MetricChip> — compact inline delta chip
│   ├─ <Badge> / <Tag> — mono uppercase micro-label (status / taxonomy) / operator-set keyword pill
│   ├─ <Avatar> / <AvatarGroup> — user avatar / overlapping cluster with "+N more"
│   ├─ <Image> / <Icon> / <Kbd> — image or logo / Font Awesome solid icon / keyboard-shortcut chip
│   ├─ <Meter> / <SegmentedMeter> — capacity bar with sentiment colour / decomposed meter
│   ├─ <BarStrip data={rows} item={r => ({ label, value, tone? })} /> — ranked horizontal-bar list, axis-free (fits a <Stat>)
│   ├─ <EditableChip> — chip whose text becomes an inline input on click
│   ├─ <ChipRail> — rail of mixed chip-shaped children; provides its density to them
│   └─ <Trace> — read-only inline heatmap (tracks × steps) with a now-line
├─ Feedback (status & async signals)
│   ├─ <Banner status title subtitle? icon? dismissible?> — page-spanning notice (staleness, partial data)
│   ├─ <Status value> — dot + uppercase word
│   ├─ <Progress> — linear progress bar
│   ├─ <Skeleton> — shimmer placeholder
│   └─ <EmptyState> — zero-data state
├─ Disclosure (reveal / switch content) — item metadata is config, not child tags
│   ├─ <Tabs items={…}> — content-panel switcher
│   ├─ <Accordion items={…}> — single/multi-open sections
│   ├─ <Carousel> — paginated slide carousel
│   ├─ <Collapsible> / <Disclosure> — single show/hide section / "Show more / Show less" toggle
│   ├─ <SegmentGroup items={…}> — compact single-select mode switcher (no panels)
│   ├─ <OptionList> — keyboard-navigable single-select list (rows + description)
│   └─ <Story.Root steps={…}> — scroll-driven narrative; prose rail + sticky stage keyframes
├─ Navigation — within a page; an app's own navigation is its host's
│   ├─ <Breadcrumb items={…}> — ancestor trail
│   └─ <NavList sections={…}> — sidebar nav
├─ Overlays (floating content) — `trigger` is a UIComponent prop; the body is children
│   ├─ <Dialog> — the one modal: a confirmation before a destructive or irreversible act, never a form
│   ├─ <Popover> — click-triggered panel; a form that makes or names something lives in one
│   ├─ <Drawer> — side panel
│   ├─ <HoverCard> / <Tooltip> / <ToggleTip> — hover preview card / hover tooltip (a string) / click-toggle tooltip
│   ├─ <Menu trigger={…} items={…}> — dropdown / context menu
│   ├─ <CommandPalette commands={…}> — ⌘K palette with search + groups
│   ├─ <Hotkey chord="mod+k" onTrigger={fn}> — invisible keydown listener
│   └─ <ActionBar items={…}> — sticky bottom bulk-action bar
├─ Reactive (state-driven re-render)
│   ├─ <Reactive>{$ => { …State.bind reads…; return <…/>; }}</Reactive> — re-renders when read State keys change
│   │   └─ children (required) — a builder function ($ => UIComponent); all State.bind reads live inside it
│   └─ <Match on={bind.read()} cases={{…}}> — hosting slot over a variant, the component-level twin of variant.match
│       ├─ on (required) — the variant expression selecting the active case; pass the READING expression (bind.read()) — a $.let snapshot freezes the slot
│       └─ cases (required) — one handler per case, exhaustive. Mounts only the active case and remounts it on tag change — use it to swap a stateful component (its own <Reactive>/binds) at one slot; a plain variant.match keeps the first one mounted
│
└─ State (typed reactive store)
    └─ State.bind([T], key, defaultValue) → { read, write, has } closures;
       read() tracks the dependency so <Reactive> re-renders when the value changes
```

## Formats and statuses

**Formats.** A format-bearing prop takes a **spec** and the payload keeps the
**raw value**; the renderer prints it through one interpreter in the viewer's
locale, every date in UTC. Keep numbers as numbers and give the spec — never a
pre-formatted string.

| Vocabulary | Where it plugs in | Specs |
|---|---|---|
| `Format.*` (`Format.Types.Tick`) | `<Numeric format>`, `<Stat format>`, `<Table>` columns' `format` (cells and subtotals), e3-ui's quantities | `Format.Number({ …FractionDigits?, signDisplay? })` · `Format.Currency({ currency, compact? })` · `Format.Percent({ maximumFractionDigits? })` · `Format.Compact()` · `Format.Unit({ unit })` · `Format.Date(pattern)` / `Time` / `DateTime` |
| `Chart.format.*` | `<Chart>` axes' `format`, Slice fields, Deck metrics, e3-ui's `Plan.axis` | `number()` · `currency({ code?, compact? })` · `percent()` (0.42 → 42%) · `compact()` · `date(pattern)` / `time` / `datetime` |

A percent spec takes a fraction (0.183 → 18.3%). An undeclared number prints
every digit, ungrouped, with the locale's decimal separator. A host sets the
locale with `<I18nProvider locale="de-DE">` (re-exported from
`@elaraai/east-ui-components`). Date patterns use East's date tokens
(`"ddd DD"` → Mon 30).

**Status colour.** One semantic palette for state:
`"success" | "warning" | "danger" | "info" | "neutral"` (`StatusTokenType`),
theme-mapped, never raw hex. It plugs into `<Status value>`, `<Meter tone>`,
`BarStrip` / `SegmentedMeter` tones, `Table` `rowStatus`, `Library.status`,
`Matrix.marker`, and a Deck's registry `Deck.statuses({ key: { label, color,
pulse?, hint? } })`, defined once and referenced by key. `<Banner status>` has
its own wider set (info, warning, success, error, neutral, change, guard,
stale).

- **Sentiment** is value direction, not state: `<MetricChip tone>`,
  `<Numeric sentiment>`, `<Stat indicator.sentiment>` (positive / negative /
  neutral).
- **A colour the app gives** (a series, a shift) is `ColorTokenType`, a theme
  hue at a shade: `Style.ColorToken("teal", "500")`.
- **`colorPalette`** is decorative hue theming for buttons, badges and tags;
  tone / status / sentiment carry meaning.
- An audit **state** (Blend's `PlannerStateType`, the Plan's `EventStateType`)
  is orthogonal to the status tint layered on it.

## Paged sources

A component's `data` is local — a collection value, or a whole-value
`Data.bind` / `State.bind` handle — or a paged source, which only e3-ui's
`Data.bindPaged` produces. A component recognises a paged source by its East
type (`Paged.Types.PinnedSource` and its kin) and pages it: each window, total
and search belongs to one snapshot, and the component follows the source to
the next. A Table pages top-level rows with their subtrees, so subtotals are
exact over what has loaded; client sort is off on a paged table. A collection
already in hand is local data.

## Key Patterns

### Reactive interactivity — builder children

`<Reactive>` takes a **builder function** `{$ => …}` (not a nested
`East.function`). All `State.bind` reads live inside it, so the component
re-renders when the bound key changes.

```tsx
const counter = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const count = $.let(State.bind([IntegerType], "count", 0n));
        const value = $.let(count.read());
        const inc = $.const(East.function([], NullType, $ => {
            $(count.write(count.read().add(1n)));
        }));
        return (
            <VStack gap="3">
                <Text textStyle="body-lg">{East.str`Count: ${value}`}</Text>
                <Button onClick={inc}>+1</Button>
            </VStack>
        );
    }}</Reactive>
));
```

A filtered view is the same shape: read the state inside the block and filter
the rows as an East expression (`rows.filter(($, r) => …)`), so the filter runs
again on every change.

### Two callback families

- **Build-time accessors** — `(row) => field expression` for chart encodings
  (`x` / `y` / `by` / `columns`) and a table column's `value`, used while the
  IR is built.
- **East-function handlers** — `onClick`, `onChange`, per-row builders: an
  `East.function(...)` value or a typed arrow, which the factory lifts.

### Text and conditionals are East

Children are East strings — interpolate East-side, never with JSX braces
between text — and a conditional is an East expression returning a component:

```tsx
<Text>{East.str`Hello ${name}`}</Text>   // correct
// <Text>Hello {name}</Text>             // not East
cond.ifElse(_$ => <A/>, _$ => <B/>)      // never {cond && <El/>} or a ternary to null
```

### Data-driven components keep data on config props

```tsx
<Table
    data={rows}
    columns={{ name: { header: "Name" }, revenue: { header: "Revenue", format: Format.Currency({ currency: "AUD" }) } }}
    striped variant="line"
/>

<Box height="220px" width="100%">
    <Chart
        layers={[
            Chart.Column(rows, { x: r => r.month, columns: { Revenue: r => r.revenue } }),
            Chart.refLine({ y: 100, label: "Target", dash: "4 4" }),
        ]}
        y={{ format: Chart.format.currency({ compact: true }) }}
        legend grid tooltip
    />
</Box>
```

### Nested rows — one Table, the data's own tree

A row carries its children (a `RecursiveType` row's own field, or a lookup
among the rows); a parent is the group row, and each column with an
`aggregate` (`"sum" | "mean" | "min" | "max" | "count"`) shows its children's
subtotal, through the column's `format` or `render`. Hierarchy comes only from
the data — there is no `groupBy`. A computed line that is not a plain subtotal
(gross profit) is its own row, or a `footerRows` entry. Examples: `tablePnl`,
`tableTree`.

### Sizing — one string prop, parsed everywhere

Every size prop is a string: `"fill"` (the parent's box), `"240"` (pixels),
or any CSS length (`"50%"`, `"min(420px, 100%)"`). `"fill"` and percentages
need a parent with a definite height — inside a content-sized parent they
resolve to auto, so bound the parent. `height` pins a data component (its body
scrolls and virtualizes); `maxHeight` stays content-sized up to the cap.
`gap` / `padding` / `margin` take spacing tokens (`gap="4"`), not pixels. For
one definition on desktop and mobile, prefer `width="min(<ideal>px, 100%)"`
and `templateColumns="repeat(auto-fit, minmax(240px, 1fr))"`.

### Overlays — trigger prop, body children, State for programmatic open

A callback opens an overlay through the State its `open` reads, and
`onOpenChange` writes it back as it closes; an anchored overlay opens at its
own trigger whatever wrote the State:

```tsx
const shown = $.let(State.bind([BooleanType], "details_open", false));
<Popover trigger={<Button>Details</Button>} open={shown.read()} onOpenChange={shown.write}>…</Popover>
```

### Density cascade

Display components (`<Tag>`, `<Badge>`, `<MetricChip>`, `<Meter>`,
`<BarStrip>`, `<Stat>`, `<Avatar>`, `<Trace>`, `<ChipRail>`, …) take
`density="condensed" | "compact" | "comfortable"` and inherit it from the
nearest providing surface — a `<Table>` / `<Matrix>` / `<ChipRail>`, or a
layout container given `density`. An explicit `density` on a component wins.

### Editing, fields and drag and drop

- **Editing**: an editable collection's changes are drafts applied as one
  checked batch through `Editing.apply` and `Editing.Types.*` (`ChangeSet`,
  `PatchEvent`, `Readiness`, …). A host's `onApply` takes one `ChangeSet` and
  answers an `ApplyResult`, applying the whole batch or none of it.
- **Fields**: `Fields.specs(R, hints?, omit?)` turns a struct into an
  inspector's typed form, each field's editor from its East type, a hint
  (`Fields.number`, `Fields.select`, `Fields.reference`, …) adding what the
  type cannot say. A variant whose cases hold data is a choice, the fields of
  the case it holds in a block under it, each case's value hinted through the
  select's `cases` (`Fields.select({ cases: { sliced: Fields.number({ min: 1n }) } })`).
  A reference holds a key of any type a Dict may be keyed by: the host's
  choices are keyed by its text — a String as itself, any other as East
  prints it — and the one chosen is read back at the field's type.
- **Drag and drop**: a `<Library>` is a source; a target (`<Blend>`, e3-ui's
  builders) lists its `id` in `sources`. Every drag reduces to one
  `DragEventType` (`add`, `move`, `remove`, `resize`), and a target's
  `canDrop: fn(DragEventType) => Boolean` vetoes it.

### Picking between similar components

| Choice | Pick |
|---|---|
| `<Switch>` · `<Toggle>` · `<Checkbox>` | a boolean form value · a pressable toolbar button · a boolean in a list |
| `<SegmentGroup>` · `<Tabs>` · `<RadioGroup>` | a compact mode switcher · content panels · a form input |
| `<Banner>` · `<Status>` · `<Progress>` | a page-wide notice · a dot and word · task completion |
| `<Meter>` · `<Progress>` · `<SegmentedMeter>` | a value against a range · completion · a decomposed meter |
| `<Stat>` · `<MetricChip>` | a tile with a hero number · an inline delta pill |
| `<Tag>` · `<Badge>` | an operator-set keyword pill · a status / taxonomy micro-label |
| `<BarStrip>` · `Chart.Bar` · `Chart.Column` | a ranked list with no axes · horizontal bars in a chart · vertical columns |
| `<Table>` · e3-ui `<Sheet>` | displaying rows · rows typed in place and written back |
| `<Library>` · `<Deck>` | a draggable palette or browsable gallery · a status-coloured display board |
| `<Grid>` · `<SnapGrid>` | children placed on templated tracks · tiles held as data on 12 columns |
| `<Box>` · `<Card>` | structure only · a chrome-bearing card |
| e3-ui `<Plan>` · `<Flowchart>` · `<Schematic>` | anything on one shared axis · a state flow laid out from lanes · records at world coordinates |

## Related skills

- **east** — the language component bodies are written in.
- **e3-ui** — bind components to live workspace data and ship them as `ui()`
  e3 tasks, and the planning builders (`<Plan>`, `<Sheet>`, …); pair it with
  east-ui whenever the UI reads, writes or commits real data.
- **e3** — the engine that runs UI tasks.
- **e3-ui-cli** — screenshot a component from the terminal (`e3-ui shot`).
