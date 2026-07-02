---
name: east-ui
description: "Type-safe UI component library for the East language, authored as JSX tags. Use when writing East programs that define user interfaces. Triggers for: (1) Authoring `.tsx` component trees with `@elaraai/east-ui` tags, (2) Layout with <Box>, <Flex>, <Stack>/<VStack>/<HStack>, <Grid>, <Splitter>, <ScrollArea>, <Sticky>, (3) Forms with <Input>, <Textarea>, <Select>, <Combobox>, <Checkbox>, <Switch>, <Slider>, <RadioGroup>, <RadioCardGroup>, <TagsInput>, <FileUpload>, <Field>, <DateRangeInput>, <TimeRangeInput>, (4) Data display with <Table>, <TreeView>, <DataList>, <Gantt>, <Planner>, <Matrix>, <Calendar>, <Schematic>, <Map>, <Library>, <Roster>, <Blend>, <Slice.Rail>, <Pagination>, <ChipRail>, <Trace>, (5) Charts with <Chart layers={Chart.Line/Bar/Area/Scatter/Band(...)}/> plus Chart.refLine/refBand/refDot, <Sparkline>, (6) Overlays with <Dialog>, <Drawer>, <Popover>, <Menu>, <Tooltip>, <HoverCard>, <ToggleTip>, <ActionBar>, <CommandPalette>, <Hotkey>, (7) Feedback with <Banner>, <Status>, <Progress>, <Skeleton>, <EmptyState>, (8) Disclosure with <Tabs>, <Accordion>, <Carousel>, <Collapsible>, <SegmentGroup>, <OptionList>, <Story>, (9) Navigation with <Breadcrumb>, <NavList>, and route-stack page switching (Navigation.config / Navigation.bind / <Pages>), (10) Reactive UI via <Reactive>{$ => …}</Reactive> + State.bind."
---

# East UI

A type-safe UI component library for the East language. The public surface is
**JSX tags** — capitalized, React-style components that desugar to East IR. No
React at runtime: a `<Button>` evaluates to the identical
`ExprType<UIComponentType>` value, which serializes and renders anywhere.

## Quick Start

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
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

Three things make a file JSX-capable:
1. The per-file pragma `/** @jsxImportSource @elaraai/east-ui */` (first line).
2. One tag import line from `@elaraai/east-ui`.
3. A `.tsx` extension.

**Tags vs factories.** Each tag desugars 1:1 to a factory call —
`<Button variant="solid">Save</Button>` builds the same IR as
`Button.Root("Save", { variant: "solid" })`. The factories are an implementation
detail under `@elaraai/east-ui/internal` (used by renderers/tests). **Author with
tags**; props are exactly the factory's flat options bag.

## Decision Tree: Which Tag to Use

Every public tag is listed with its purpose, notable props/variants, and any
data-builders / nested tags. **Props are the factory's flat option bag** — no
nested `style` object. Children are always UI components; non-UI sub-structures
(columns, layers, cells, header fields) are **config props or typed callbacks**,
never child sub-tags.

```
Task → Which tag?
│
├─ Layout (arrange content)
│   ├─ <Box> — generic block; padding / margin / background / borderRadius / display
│   ├─ <Flex> — flexbox; direction / justify / align / wrap / gap
│   ├─ <Stack> / <VStack> / <HStack> — flex with defaults; gap / align / justify
│   ├─ <Grid> — CSS grid; templateColumns / templateRows / gap
│   ├─ <Splitter> — resizable panels; panels carry { id, minSize, maxSize, collapsible }
│   ├─ <Separator> — 1px rule; orientation; variant: subtle | brand | dashed | strong
│   ├─ <ScrollArea> — styled-scrollbar scroll container; overflow x/y
│   └─ <Sticky> — position-sticky wrapper; top / bottom offset
│
├─ Typography (display text)
│   ├─ <Text> — inline/block text; textStyle preset, fontWeight / fontStyle / textAlign / lineClamp
│   │   └─ Text.Presets.Eyebrow/MonoLabel/… — opinionated typographic presets
│   ├─ <Heading> — display heading; textStyle preset + weight / family / lineHeight
│   ├─ <Link href="…"> — hyperlink; underline-on-hover variants; color slots
│   ├─ <Code> — inline `<code>` token; variant + colorPalette
│   ├─ <CodeBlock> — multi-line code; header bg, line numbers, highlight line
│   ├─ <List> — bulleted/numbered list; variant: ordered | unordered | dot
│   ├─ <Highlight query="…"> — tints `query` substrings inside the text
│   ├─ <Mark> — semantic `<mark>` span; severity variants
│   ├─ <Note> — inset callout/quote; emphasis: brand | warn | danger
│   └─ <Numeric> — tabular-num number; textStyle preset + sentiment colour
│
├─ Buttons (user actions)
│   ├─ <Button> — variant: solid | subtle | outline | ghost | plain; colorPalette; size; onClick
│   ├─ <IconButton> — icon-only button; same variants/sizes
│   ├─ <CloseButton> — × dismiss button
│   ├─ <CopyButton value="…"> — copies to clipboard, ✓ feedback
│   ├─ <Toggle> — pressable on/off button (NOT a form toggle — see <Switch>)
│   └─ <ButtonGroup> — row/col cluster; attached shares borders, gap separates
│
├─ Forms (user input)
│   ├─ <Input> — typed text inputs; variant: outline | subtle | flushed
│   │   └─ nested: <Input.String> <Input.Integer> <Input.Float> <Input.DateTime>
│   ├─ <Textarea> — multi-line; resize: none | vertical | horizontal | both
│   ├─ <Select items={[Select.Item(value, label)]}> — single-select dropdown
│   ├─ <Combobox items={[Combobox.Item(value, label)]}> — typeahead/filter select
│   ├─ <Checkbox> — boolean checkbox; colorPalette + fill/check/border slots
│   ├─ <Switch> — form on/off toggle (binds boolean)
│   ├─ <Slider> — range slider; orientation, variant, colorPalette, marks
│   ├─ <RadioGroup items={…}> — single-select radio list; orientation
│   ├─ <RadioCardGroup cards={…}> — radios rendered as picker cards
│   ├─ <TagsInput> — typeahead chip input
│   ├─ <FileUpload> — drop-zone file picker
│   ├─ <Field label="…" > control </Field> — form-field wrapper; orientation, helper/error text
│   ├─ <DateRangeInput> — start–end date pair with preset chips
│   └─ <TimeRangeInput> — start–end time pair
│
├─ Collections (display data sets) — structured data on `data=` / `columns=` / `items=` props
│   ├─ <Table data={rows} columns={…} /> — sortable / pinnable / virtualized;
│   │     columns is a keyed config (["a","b"] or { a: { header, width } }); variant: line | outline;
│   │     selectionMode; striped, stickyHeader. Generic pass-through — column/cell inference preserved.
│   ├─ <DataList items={[DataList.Item(label, value)]} /> — label/value pairs; orientation
│   ├─ <TreeView nodes={…} /> — expandable hierarchical tree with selection
│   ├─ <Gantt /> — Gantt chart; builders Gantt.Task(…), Gantt.Milestone(…); showToday marker
│   ├─ <Planner.Point …> / <Planner.Span …> — discrete rows × ordered-slot scheduler
│   │     └─ Planner.axis.time()/.number({buckets})/.ordinal({range}), Planner.event(…), Planner.marker(…)
│   ├─ <Matrix data={…} columns={…} cell={(r, col) => Matrix.cell({ segments, markers })} />
│   │     └─ Matrix.segment({ fill, weight, label }), Matrix.marker({ status, message }), Matrix.column(…)
│   ├─ <Calendar data={days} cell={d => ({ week, day, value, summary?, delta? })} /> — day-of-week × week intensity grid (cols always Mon–Sun); legend, domain {min,max}, actionLabel, onSelect/onAction(cell); viz-only (no events / drag)
│   ├─ <Schematic items={rows} extent={{width,height}} item={r => ({key,x,y,label})} /> — 2D world-coord canvas; place items/zones/links from flat tables; click-select via onSelect(key) — works in every tool (grab/zoom/marquee); selectionMode "single"|"multiple" (multiple ⇒ marquee tool: drag-box multi-select w/ live preview + count, plain box/tap replaces + Shift extends) + onSelectionChange({key?,selected,selectedKeys,additive,region?}); selectZoomFocus (bool) ⇒ a canvas selection also moves the camera (tap flies, marquee fits); onItemOpen(key) ⇒ double-click drill-in (background double-click keeps Fit/reset); onViewportChange({zoom,minX,minY,maxX,maxY}) ⇒ debounced viewport-settled reporting (sync / lazy-load / persist); zone (area) selection: click an outline-zone body (items win; innermost zone wins; Shift extends per selectionMode) with onSelectZone(key) + onZoneSelectionChange({key?,selected,selectedKeys,childItemKeys,additive}) reporting the zones AND their child items; scaleUnit, grid, navigator, minimap, height
│   │     └─ Schematic.circle(r)/.polyline(verts,{width})/.polygon(verts)/.rect() footprints + zone geometry, Schematic.outline()/.hatch() zone patterns, Schematic.solid()/.dashed() link styles; zone/link mappers; from/to/via links
│   │     └─ slice={slice} + affordances (Slice chrome rail); flat effect props sliceHidden / sliceOpacity / sliceDesaturate / sliceDot / sliceEmphasis:"halo"|"pulse" / sliceFrame / sliceFrameFit (each SubtypeExprOrValue) keep filtered-OUT items as ghost/desaturate/dot context + emphasise the remainder instead of hiding — feed the FULL set (Slice.partition) and mark item.excluded (e.g. t.matched.not())
│   │     └─ link editing: connect tool (drag item→item; draft routed like real links) — linkMode "draw" (adds locally, form-input style) | "connect" (event-only, repeatable: plan operations); Shift+drag ADDS to the session; onCreateLink({link,links,additive,existing}) / click-select + onSelectLink(key) / drag endpoint handles + onEditLink / Del + onDeleteLink; flattened readOnly / readOnlyLinks / readOnlyItems gate editing per domain; move tool (readOnlyItems off) drags items to new positions — a selected item moves the WHOLE selection rigidly, local-first, onMoveItem({key,x,y,keys,dx,dy}) fires once per gesture
│   │     └─ nets={rows} net={m => ({key, sources, destinations, label?, metric?, via?})} — a manifold/bus as ONE row: many sources → many destinations drawn as a trunk (route orthogonal|direct; via = trunk waypoints; junction dots; mid-trunk label) with per-endpoint branches; nets share link selection/delete; a Shift connect-session commits as a net (onCreateLink.net = {key, sources, destinations}, stable session key — upsert by net.key)
│   │     └─ sliceSelectField="<fieldId>" (needs a bound slice): a marquee/tap selection writes an `in` filter of the selected item keys into the slice (one-directional selection→slice) — pair with the ghost effect (not a Slice.rows feed on the same slice) so the non-selected fade rather than vanish
│   │     └─ layers={[{ key, label, tone?, visible?, locked?, opacity? }]} + tag each item/zone/link with layer:"key" — a canvas layer button opens a panel to show/hide/solo/lock each layer (visibility+locks persist per panel); lock ⇒ non-selectable (click-through), opacity dims that layer's items
│   ├─ <Map markers={…} center={Map.at(lat,lng)} zoom={n} /> — interactive geographic basemap (H3 hex / area overlays, pins, lines, labels) + East-child overlays; read-only / selection-only (onAreaClick/onMarkerClick/onZoom/onSelect)
│   │     └─ Map.carto()/osm()/tile(…) basemap, Map.hexDisk()/cells()/polygon() shapes, Map.hex(…), Map.marker/area/line/label(…), Map.solid()/dashed() line styles, Map.point()/bounds() flyTo, Map.overlay(child, { align })
│   ├─ <Library id="people" data={rows} item={r => ({ key, label, sublabel, icon, status })} /> — draggable palette (DnD source; targets a list id in `sources`); dimensions, groupBy, search, addLabel / onAdd
│   │     └─ dimensions { kind: "meter" | "chips" | "text", … }, groupBy { key, label, value, summary }, Library.status(label, tone)
│   ├─ <Roster people={…} shifts={…} id person={p => ({key,label,sublabel})} shift={s => ({key,person,day,hours|label,state})} /> — people × days-of-week shift grid; joins the two flat tables by person key
│   │     └─ mode published | edit; days (default Mon–Sun); state is a PlannerStateType (Roster.Types.State); DnD target — sources={[libraryId]} + onDrag (add/move/remove), onSelect/onAccept/onAddAt
│   ├─ <Blend targets={…} config={{ id, target, sources?, diff?, onDrag?, onAmountChange?, onAction? }} /> — blend / batch assembly surface; pairs with a Library; target count picks mode: 1 single | 2 compare (derived diff / Δ table) | 3+ portfolio
│   │     └─ Blend.allocation({ source, amount, pinned?, state? }), Blend.metric({ key, label, value, numeric?, model?, band? }); sources = DnD add-drop ids
│   ├─ <Slice.Rail slice={slice} affordances={["filter","search","range","breakdown","cohort","presets","brush","legend"]} persist? /> — shared narrowing chrome over one bound dataset; feed consumers via Slice.rows([Row], slice); persist: "local" | "session" | "url" opts the state into reload-surviving / shareable-link storage; legends are explicit-only (list "legend" or compose <Slice.Legend>)
│   │     └─ Slice.bind([Row], key, Slice.config(Row, { fields, rangeFieldId, searchFieldIds, breakdownFieldIds }), Slice.state({…})); fields: { id: { label, hints?, format? } } — format reuses the Chart.format vocabulary ("number"|"percent"|"compact"|{currency:{code?,compact?}}|{date|time|datetime: pattern}); per-affordance tags <Slice.Filter/Search/Range/Breakdown/Legend/Cohort/Presets/Summary slice={slice} />; pure engine Slice.apply.where/matches/breakdown
│   │     └─ cohorts toggle on chip click (<Slice.Cohort mode="toggle"|"manage" allowCreate?>; <Slice.Presets> = toggle-only preset bar); <Slice.Legend> = facet bar (click = in-set multi-select over self-excluding slice.facetGroups(); mode="visibility" = eye rail); slice.toggleFilter(pred) = idempotent single-predicate toggle for custom wiring; string ops eq/neq/in/notIn/contains/matches/startsWith/endsWith/isEmpty/isNotEmpty, integer in, datetime between; Summary/Filter footers read "N of M"
│   │     └─ brush strip is rich by default — the range field's format drives the axis labels, a self-excluding count histogram shows the row distribution; brush={{ axis?, count?, buckets? }} opts down to the bare track; the applied window is a full brush selection: drag its body to slide (width preserved), an edge to resize, empty track to draw (also on the Gantt timeline header)
│   │     └─ Range picker presets anchor to the DATA's date extent (clamped to now for live data) and pin concrete windows; an All chip clears the range; programmatic datetimePreset seeds stay rolling/wall-clock
│   │     └─ Slice.rows([Row], slice) = narrowed feed (excluded gone); Slice.partition([Row], slice) → [{value,matched}] = FULL set tagged (the "keep the excluded" feed — drive a de-emphasis effect from `matched`)
│   └─ <Pagination /> — page-number control; siblings + boundaries control ellipsis
│
├─ Charts (visualize data) — layers are a config array of factory values, never child tags
│   ├─ <Chart layers={…} x={…} y={…} grid legend tooltip /> — assemble mark + annotation layers;
│   │     x-scale inferred from the x accessor type (String → band, number → linear, DateTime → time)
│   ├─ Marks: Chart.Line / Chart.Bar / Chart.Area / Chart.Scatter (rows, encoding, style?)
│   │     encoding: { x, y } · { x, y, by } (split) · { x, columns: { Name: r => r.field } } (wide)
│   │     Chart.Band(rows, { x, low, high }, style?) — filled range (e.g. confidence band)
│   ├─ Annotations: Chart.refLine({ y }|{ x }) · Chart.refBand({ y:[lo,hi] }) · Chart.refDot({ x, y, label })
│   ├─ Chart.format.{ number, currency, percent, compact, date, time, datetime } — axis tick formats
│   ├─ <Sparkline> — inline trend (line | area), fits beside a <Stat>
│   └─ <Slice.Chart.Line/Bar/Area/Scatter> — slice-bound chart; a brush sets the slice's range
│
├─ Display (show information)
│   ├─ <Badge> — pill/tag label; colorPalette + variant: solid | subtle | outline
│   ├─ <Tag> — removable chip with close trigger
│   ├─ <Avatar> / <AvatarGroup> — user avatar / overlapping cluster with "+N more"
│   ├─ <Icon name="…"> — FontAwesome icon; size + colour
│   ├─ <Kbd> — keyboard-shortcut chip (⌘ K)
│   ├─ <Stat label="…" value={…}> — metric tile with label / value / change indicator
│   ├─ <MetricChip> — compact mono delta chip; sentiment: pos | neg | flat
│   ├─ <Meter> — horizontal capacity bar with sentiment colour
│   ├─ <SegmentedMeter> — multi-segment meter (e.g. decomposed confidence)
│   ├─ <BarStrip> — ranked horizontal-bar list (axis-free; fits inside a <Stat>)
│   ├─ <EditableChip> — chip whose text becomes inline input on click
│   ├─ <ChipRail> — horizontal rail of mixed chip-shaped children (<Tag>/<Badge>/<MetricChip>/<Avatar>/…); separator dot | line; provides its density to the children
│   └─ <Trace> — read-only inline heatmap (tracks × steps) with a now-line; sits flush beside a <ChipRail> at the same density in table cells
│
├─ Feedback (status & async signals)
│   ├─ <Banner> — page-spanning notice; status: stale | partial | change | error | guard
│   ├─ <Status label="…" status="success"> — dot + uppercase label (no fill)
│   ├─ <Progress> — linear progress bar; determinate / indeterminate, striped, colorPalette
│   ├─ <Skeleton> — shimmer placeholder
│   └─ <EmptyState> — zero-data state with glyph, description, optional actions
│
├─ Disclosure (reveal / switch content) — item metadata is config, not child tags
│   ├─ <Tabs items={[Tabs.Item(value, title, body)]} defaultValue="…" /> — variant: line | subtle | enclosed | …
│   ├─ <Accordion items={[Accordion.Item(value, trigger, body)]} /> — single/multi-open
│   ├─ <Carousel> — paginated slide carousel
│   ├─ <Collapsible> — single show/hide section
│   ├─ <SegmentGroup items={[…]}> — compact single-select mode switcher (no panels)
│   ├─ <OptionList> — keyboard-navigable single-select list (rows + description)
│   ├─ <Story.Root steps={[…]} title="…"> — scroll-driven narrative; prose rail + sticky stage keyframes; layout rail-left | rail-right | stacked; stepLength compact | default | long; stageHeight; active / progress State.bind
│   │     └─ Story.Step(body, { id, eyebrow, title, stage }) one beat (stage = its keyframe), Story.Progress({ count, active, title }) standalone dots / counter / prev-next chrome
│   └─ <Disclosure> — "Show more / Show less" toggle
│
├─ Navigation
│   ├─ <Breadcrumb items={…} /> — ancestor trail; separator chevron / slash
│   ├─ <NavList sections={…} /> — sidebar nav; active item slots + badges
│   └─ Route-stack pages (first-class navigation). Navigation.config({ route: { value: T, label } }) → typed registry (config.Route, config.Page.<route>(payload)); Navigation.bind(config, key, [config.Page.home()]) → reactive path-stack handle { path, current, depth, canPop, pop, go.<route>(payload), navigateTo([…]) } — go/navigateTo are typed per route from the config (the Record.bind pattern). <Pages nav={nav} pages={{ route: ($, payload, nav) => <…/> }} /> takes the nav binding as a required prop and renders only the active route (leaf-only, remounts on change); the nav handle fixes the route types for the pages handlers. Pair <Breadcrumb>/<NavList> on the same key to drive/derive chrome from nav.path()
│
├─ Overlays (floating content) — `trigger` is a UIComponent prop; body is children
│   ├─ <Dialog trigger={<Button>…</Button>} title="…"> body </Dialog> — modal
│   ├─ <Drawer trigger={…} placement="end"> body </Drawer> — side panel; placement start|end|top|bottom; flush / bodyPadding control body padding; fillBody ⇒ a single height:100% child (Table/Planner) fills + owns its scroll
│   ├─ <Popover trigger={…}> body </Popover> — click-triggered floating panel
│   ├─ <HoverCard trigger={…}> body </HoverCard> — hover preview card
│   ├─ <Tooltip trigger={…} content="…"> — hover tooltip (content is a string)
│   ├─ <ToggleTip trigger={…}> — click-toggle tooltip (sticky)
│   ├─ <Menu trigger={…} items={[Menu.Item(value, label), Menu.Separator()]}> — dropdown/context menu
│   ├─ <CommandPalette commands={…}> — ⌘K palette with search + groups
│   ├─ <Hotkey chord="mod+k" onTrigger={fn} /> — invisible keydown listener (no render); chord modifiers mod/ctrl/cmd/shift/alt + key; onTrigger is East.function([], NullType); pair with Reactive + State.bind to drive open state on CommandPalette/Dialog/Drawer
│   └─ <ActionBar items={…}> — sticky bottom bulk-action bar
│
├─ Container
│   └─ <Card header={{ eyebrow, title, description }} footer={{ … }}> body </Card>
│         header/footer are strict option objects the factory composes; variant: elevated | outline | subtle
│
├─ Reactive (state-driven re-render)
│   └─ <Reactive>{$ => { …State.bind reads…; return <…/>; }}</Reactive>
│         re-renders when read State keys change; all State.bind reads live inside the builder block
│
└─ State (typed reactive store)
    └─ State.bind([T], key, defaultValue) → { read, write, has } closures;
       read() tracks the dependency so <Reactive> re-renders when the value changes
```

## Key Patterns

### Reactive interactivity — builder children

`<Reactive>` takes a **builder function** `{$ => …}` (not a nested
`East.function`). All `State.bind` reads live inside it so the component
re-renders when the bound key changes.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType } from "@elaraai/east";
import { VStack, Text, Button, Reactive, State, UIComponentType } from "@elaraai/east-ui";

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

### Two callback families

- **Build-time accessors** — `(row) => SubtypeExprOrValue<Scalar>` for chart
  encodings (`x`/`y`/`by`/`columns`) and table column `value`. Passed through
  verbatim; they return field expressions used while building the IR.
- **East-function handlers** — `onClick`, `onChange`, per-row builders. Pass an
  `East.function(...)` value or a typed arrow; the factory lifts it.

### Text is East, not JSX text nodes

Children are `SubtypeExprOrValue<StringType>` — interpolate East-side, never with
JSX braces between text:

```tsx
<Text>{East.str`Hello ${name}`}</Text>   // correct
// <Text>Hello {name}</Text>             // wrong — not East
```

### Conditionals are East

Use `cond.ifElse(<A/>, <B/>)` (a `UIComponentType`), never JS `{cond && <El/>}`
or ternaries returning `null` — those aren't East values.

### Data-driven components keep data on config props

Tables, charts, matrices, lists and item-parents take structured data on
`data=` / `columns=` / `items=` / `layers=` props; per-row builders are typed
callbacks returning factory values (`cell={(r, col) => Matrix.cell({…})}`).
Non-UI sub-structures are never child sub-tags.

```tsx
// Table — columns config, inference preserved
<Table
    data={[{ name: "Alice", role: "Admin" }, { name: "Bob", role: "User" }]}
    columns={{ name: { header: "Name" }, role: { header: "Role" } }}
    striped variant="line"
/>

// Chart — layers config array
<Box height="220px" width="100%">
    <Chart
        layers={[
            Chart.Bar(rows, { x: r => r.month, y: r => r.revenue }, { name: "Revenue", color: "teal.solid" }),
            Chart.Line(rows, { x: r => r.month, y: r => r.profit }, { name: "Profit", color: "purple.solid", dots: true }),
        ]}
        y={{ format: Chart.format.currency({ compact: true }) }}
        legend grid tooltip
    />
</Box>
```

### Overlays — trigger prop + body children

```tsx
<Dialog trigger={<Button>Open</Button>} title="Confirm" description="Proceed?">
    <Text>This appears as a modal overlay.</Text>
    <HStack gap="2" justify="flex-end">
        <Button variant="outline">Cancel</Button>
        <Button variant="solid">Confirm</Button>
    </HStack>
</Dialog>
```

### Density cascade — one prop tightens a whole surface

Display components (`<Tag>`, `<Badge>`, `<Kbd>`, `<MetricChip>`, `<EditableChip>`,
`<Meter>`, `<BarStrip>`, `<SegmentedMeter>`, `<Stat>`, `<Avatar>`, `<Trace>`,
`<ChipRail>`) take `density="condensed" | "compact" | "comfortable"` and inherit
it from the nearest providing surface — a `<Table>` / `<Gantt>` / `<Planner>` /
`<Matrix>` / `<ChipRail>` with `density` set, or any layout container
(`<Box>` / `<Stack>` / `<Flex>` / `<Grid>` / `<Card>`) given a `density` prop.
All densified components share one sizing rhythm, so mixed table cells (a tag
beside a trace beside a meter) line up; an explicit `density` on a component
wins over the cascade. `<Badge>` and `<Kbd>` scale on a smaller micro-label
tier so they stay subordinate to tags at every density.

```tsx
// One prop on the Table sizes every chip, trace and meter in its cells.
<Table density="compact" data={lines} columns={{ /* render cells with <Tag>, <Trace>, <Meter>… */ }} />

// Or scope it to a row:
<HStack density="condensed" gap="2">
    <Tag>Line A</Tag>
    <Badge>WK 12</Badge>
    <Meter value={72.0} tone="success" />
</HStack>
```

### Picking between similar components

- **Switch vs Toggle vs Checkbox** — `<Switch>` binds a boolean form value;
  `<Toggle>` is a pressable toolbar button; `<Checkbox>` binds a boolean in a list.
- **SegmentGroup vs Tabs vs RadioGroup** — `<SegmentGroup>` is a compact mode
  switcher (no panels); `<Tabs>` switches content panels; `<RadioGroup>` is a form input.
- **Banner vs Status vs Progress** — `<Banner>` spans the page for staleness /
  partial-data; `<Status>` is a dot + word; `<Progress>` shows task completion.
- **Meter vs Progress vs SegmentedMeter** — `<Meter>` is a static value vs a
  range; `<Progress>` is completion; `<SegmentedMeter>` decomposes a meter.
- **Stat vs MetricChip** — `<Stat>` is a tile with hero number; `<MetricChip>` is
  a compact inline delta pill.
- **Tag vs Badge** — `<Tag>` is an operator-set keyword / filter pill (body
  font, optionally closable); `<Badge>` is a mono uppercase micro-label for
  status / taxonomy (ok / warn / danger / count) that stays a tier smaller
  than tags at the same density.
- **BarStrip vs Chart.Bar** — `<BarStrip>` is a small ranked bar list (no axes);
  `Chart.Bar` is a layer inside `<Chart>` with axes and legend.
- **Card vs Box** — `<Box>` is structural-only; `<Card>` carries chrome.

## Related skills

- **east** — the language UI component bodies are written in.
- **e3-ui** — bind components to live workspace data (`Data.bind`) and ship them
  as reactive `ui()` e3 tasks; pair it with east-ui whenever the UI reads,
  writes, or commits real data.
- **e3** — the engine that runs UI tasks.
- **e3-ui-cli** — screenshot a component from the terminal (`e3-ui shot
  --from-source`) or Node (`renderToPng`), with managed headless Chromium.
