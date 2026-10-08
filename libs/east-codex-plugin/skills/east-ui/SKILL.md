---
name: east-ui
description: "Type-safe UI component library for the East language, authored as JSX tags. Use when writing East programs that define user interfaces. Triggers for: (1) Authoring `.tsx` component trees with `@elaraai/east-ui` tags, (2) Layout with (Box), (Flex), (Stack)/(VStack)/(HStack), (Grid), (SnapGrid) (a page of tiles held as data on the 12-column grid, and its wireframe thumbnail), (Splitter), (ScrollArea), (Sticky), (Expandable), (Dock), (Configurator) (control table + live preview + spec readout), (3) Forms with (Input), (Textarea), (Select), (Combobox), (Checkbox), (Switch), (Slider), (RadioGroup), (RadioCardGroup), (TagsInput), (FileUpload), (Field), (DateRangeInput), (TimeRangeInput), (4) Data display with (Table), (TreeView), (ValueTree), (DataList), (Deck), (Matrix), (Calendar), (Schematic), (Map), (Library) (a drag palette, or a gallery of large cards whose media is any component), (Roster), (Board), (Blend), (Slice.Rail),… See the detailed scope below."
---

## Detailed skill scope

Type-safe UI component library for the East language, authored as JSX tags. Use when writing East programs that define user interfaces. Triggers for: (1) Authoring `.tsx` component trees with `@elaraai/east-ui` tags, (2) Layout with <Box>, <Flex>, <Stack>/<VStack>/<HStack>, <Grid>, <SnapGrid> (a page of tiles held as data on the 12-column grid, and its wireframe thumbnail), <Splitter>, <ScrollArea>, <Sticky>, <Expandable>, <Dock>, <Configurator> (control table + live preview + spec readout), (3) Forms with <Input>, <Textarea>, <Select>, <Combobox>, <Checkbox>, <Switch>, <Slider>, <RadioGroup>, <RadioCardGroup>, <TagsInput>, <FileUpload>, <Field>, <DateRangeInput>, <TimeRangeInput>, (4) Data display with <Table>, <TreeView>, <ValueTree>, <DataList>, <Deck>, <Matrix>, <Calendar>, <Schematic>, <Map>, <Library> (a drag palette, or a gallery of large cards whose media is any component), <Roster>, <Board>, <Blend>, <Slice.Rail>, <Pagination>, <ChipRail>, <Trace>, (5) Charts with <Chart layers={Chart.Line/Column/Bar/Area/Scatter/Band(...)}/> (Column = vertical, Bar = horizontal) plus Chart.refLine/refBand/refDot, <Sparkline>, (6) Overlays with <Dialog>, <Drawer>, <Popover>, <Menu>, <Tooltip>, <HoverCard>, <ToggleTip>, <ActionBar>, <CommandPalette>, <Hotkey>, (7) Feedback with <Banner>, <Status>, <Progress>, <Skeleton>, <EmptyState>, (8) Disclosure with <Tabs>, <Accordion>, <Carousel>, <Collapsible>, <SegmentGroup>, <OptionList>, <Story>, (9) Navigation with <Breadcrumb>, <NavList>, route-stack page switching (Navigation.config / Navigation.bind / <Pages>, plus <Route> to host a remounting per-route slot anywhere), and <App> — the whole application shell (collapsible rail + breadcrumb + logo + routed body from one nav handle, or a rail and breadcrumb the author passes, with an east-ui-components AppProvider for host-injected app-bar chrome), (10) Reactive UI via <Reactive>{$ => …}</Reactive> + State.bind, and conditional hosting of stateful components via <Match on cases> (remounts the active variant case on tag change), (11) Value formatting — Chart.format.* specs (chart axes, Slice fields, Deck metrics, e3-ui's Plan) and Format.* specs (<Numeric>, <Stat>, Table columns) through one interpreter, in the viewer's locale (react-aria's I18nProvider) with every date in UTC, (12) Status colour vocabulary — the five status tokens, the Deck.statuses registry, Library.status, rowStatus tints and tone props.

# East UI

A type-safe UI component library for the East language. The public surface is
**JSX tags** — capitalized, React-style components that desugar to East IR. No
React at runtime: a `<Button>` evaluates to the identical
`ExprType<UIComponentType>` value, which serializes and renders anywhere.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

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

Every public tag is listed with its purpose, its **Props** (each marked
required / optional) and its **Factories** — the `Component.xyz(…)` builders
that construct that component's config values. Props are the factory's flat
option bag — no nested `style` object. Children are always UI components;
non-UI sub-structures (columns, layers, cells, header fields) are **config
props or typed callbacks**, never child sub-tags.

Two shared prop bags recur; a Props list references them by name instead of
re-listing each member's description:

- **BOX bag** (all optional) — `width`, `height`, `minWidth`, `minHeight`,
  `maxWidth`, `maxHeight`, `padding`, `margin`, `overflow`, `overflowX`,
  `overflowY`, `opacity`. CSS sizing/box-model pass-throughs (see the Sizing
  pattern below for the string spellings).
- **COLOR overrides** (all optional) — `color`, `background`, `borderColor`.
  Explicit escape hatches over the palette / variant defaults; take semantic
  tokens (`fg.muted`, `bg.subtle`) or CSS colours.

Every icon is a Font Awesome **solid** icon (#1263): an icon prop takes
`{ prefix: "fas", name: "…" }`, or the bare solid name where it says so. East
UI draws no other set — a factory refuses another prefix at build, naming the
icon.

```
Task → Which tag?
│
├─ Layout (arrange content)
│   ├─ <Box> — generic block container
│   │   └─ Props:
│   │       ├─ children (required) — the boxed content
│   │       ├─ display (optional) — CSS display (block / flex / grid / …)
│   │       ├─ flexDirection / justifyContent / alignItems / gap (optional) — flex props when display is flex
│   │       ├─ flex / flexGrow / flexShrink (optional) — behaviour as a flex CHILD
│   │       ├─ fill (optional) — boolean shorthand for "fill remaining space" (flex:1 + min-height:0)
│   │       ├─ scroll / scrollX / scrollY (optional) — boolean shorthands for a styled scroll region
│   │       ├─ position / top / right / bottom / left / zIndex (optional) — positioning; zIndex is a token
│   │       ├─ borderRadius / border / borderColor / borderWidth (optional) — border styling
│   │       ├─ boxShadow / transform / transition / cursor / animation (optional) — presentation extras
│   │       ├─ fontFamily / fontVariantNumeric (optional) — inherited text styling for the subtree
│   │       ├─ density (optional) — provides "condensed"|"compact"|"comfortable" to densified descendants
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <Flex> — flexbox container
│   │   └─ Props:
│   │       ├─ children (required) — flex items
│   │       ├─ direction (optional) — row | column (+reverse)
│   │       ├─ wrap (optional) — nowrap | wrap | wrap-reverse
│   │       ├─ justifyContent / alignItems / gap (optional) — main/cross alignment + spacing
│   │       ├─ density (optional) — density provider (as Box)
│   │       └─ …plus the same flex-child / position / border / presentation props as <Box>, BOX bag, COLOR overrides
│   ├─ <Stack> / <VStack> / <HStack> — flex with stacking defaults (VStack = column, HStack = row)
│   │   └─ Props:
│   │       ├─ children (required) — stacked items
│   │       ├─ direction (optional, <Stack> only) — stacking axis
│   │       ├─ gap (optional) — spacing token between items
│   │       ├─ align / justify (optional) — cross/main-axis alignment
│   │       ├─ wrap (optional) — allow wrapping
│   │       ├─ density (optional) — density provider (as Box)
│   │       └─ …plus fill/scroll shorthands, flex-child, position, border, presentation props, BOX bag, COLOR overrides
│   ├─ <Grid> — CSS grid container
│   │   ├─ Props:
│   │   │   ├─ children (required) — grid items (wrap one in Grid.Item to place it)
│   │   │   ├─ templateColumns / templateRows / templateAreas (optional) — grid templates ("repeat(auto-fit, minmax(240px, 1fr))" reflows to 1 column on phones)
│   │   │   ├─ gap / columnGap / rowGap (optional) — grid spacing
│   │   │   ├─ justifyItems / alignItems / justifyContent / alignContent (optional) — item + track alignment
│   │   │   ├─ autoColumns / autoRows / autoFlow (optional) — implicit-track sizing + placement
│   │   │   ├─ density (optional) — density provider
│   │   │   └─ …plus BOX bag (width/height/min*/max*/padding)
│   │   └─ Factories:
│   │       └─ Grid.Item(children, { colSpan?, rowSpan?, colStart?, colEnd?, rowStart?, rowEnd?, area? }) — explicit cell placement for one child
│   ├─ <SnapGrid data={rows} cell={r => SnapGrid.cell({ key, row, span, content })} /> — a page of tiles on the 12-column grid, HELD AS DATA: each row of `data` is one tile. Rows stack in the order their keys first appear; a row's tiles sit left to right, continue on a line below once their spans pass 12 (never overlapping), and the row is as tall as its tallest tile. The spans answer to the SnapGrid's own width, not the viewport: under 480px every tile takes the full width, from 480px a span under 6 takes 6 and any other 12, from 960px the span declared. A framed tile has no header strip, and the SnapGrid draws no border of its own — the host draws the panel around it
│   │   ├─ Props:
│   │   │   ├─ data (required) — the rows: an `Array`, or a `Dict` (tiles in key order), inline or a `$.let`-bound whole-value handle (`State.bind` / `Data.bind`); a paged source is refused — a page's tiles are held whole
│   │   │   ├─ cell (required) — r => SnapGrid.cell({…}): one row's tile, reified once and called per row; pick its `content` per row with a `match` on the row's kind
│   │   │   ├─ variant (optional) — "tiles" (default) | "wireframe": each tile an outline at its size with its content left out, its spans kept at any width and its declared height exact — a page's thumbnail. It draws no frame of its own: its host frames it (a Library gallery card's media) and it fills the host's height. With no rows it is the blank page — a band over the body, each dashed
│   │   │   ├─ width (optional) — the design width ("1440px"): a page's grid is that wide, scrolls inside a narrower host, and its spans answer to it; on the editing canvas it is the most the grid lays out at — a narrower column lays it out at the column's width, a wider one centres it — and the toolbar reads it out
│   │   │   ├─ height / maxHeight (optional) — pin or cap the SnapGrid; the grid scrolls within
│   │   │   ├─ edit + editing (optional, given together) — the builder's canvas: every tile keeps its declared span at any width, and each gesture is a DRAFT of the shared editing session — e3-ui's Sheet's and Plan's — each ONE undoable transaction (origin drop / move / resize / remove); the history item (Undo · Redo · Discard · Save) sits in the canvas's toolbar (see The frame), and ⌘Z / Ctrl+Z undo, ⌘⇧Z / Ctrl+Y redo. Editing takes an `Array` source — its order is the tiles' order, so a move is a new order and a new row key; a `Dict` is refused. `edit` names the row fields a gesture writes: { key: "id" (the String identity field), row: "row" (String), span: "span" (Integer), height?: "height" (Option<Integer>; omitted, heights are not edited), align?: "align" (SnapGrid.Types.Align; the field an align request writes — omitted, one is refused), create?: ($, card, at) => R — a dropped library card's new row: `card` the drag grammar's { library, key }, `at` { key (a fresh identity), row (the row it lands in) }; the canvas then writes `at.row` and fits the span }. `editing` is { onApply? | onUpdate?, onPatch?, onDrafted?, mode?, ready? } as on e3-ui's Plan: `onUpdate={handle.write}` with `data={handle}` is the inline adapter; `onPatch` hears SnapGrid.Types.PatchEvent(R); `onDrafted` fn(Array<R>) => Null hears the rows the canvas draws — the source with its drafts, exactly as Save would leave them — as it mounts and whenever they change (a gesture, an undo or redo, a Discard, a source that moved), so a pane beside it reads what it shows; `ready` fn(R) => Editing.Types.Readiness marks the tile it refuses and holds Save. Save leaves exactly the order the canvas shows
│   │   │   ├─ ui (optional) — the bound selection: `State.bind([SnapGrid.Types.UiState], key, SnapGrid.uiState())` — the canvas draws the tile it holds and writes the one the user picks, so an inspector beside it reads and sets it; omitted, the canvas keeps its own. Its `request` asks the editing canvas for a change, as e3-ui's Plan's `focus` asks for a row: `ui.write(SnapGrid.uiState({ selected: key, request: { key, change: variant("span", 8n) } }))` — `span` (held to the row's room), `row` (counting from 1; a row already holding 6 tiles, or one past the last, is a new row after it), `height` (`none` for its content's), `align` (written to `edit.align`) — taken as ONE gesture of the session by the rules the handles and drags keep, undoable with the rest, and written back `none`
│   │   │   ├─ view (optional) — the bound design width and zoom: `State.bind([SnapGrid.Types.ViewState], key, SnapGrid.viewState())` under a key of its own, apart from `ui` — the editing canvas draws at them and writes the width the user presses and the zoom step they take; omitted, the canvas keeps them, starting from `width` and `zoom`
│   │   │   ├─ apply (optional) — the bound Apply request: `State.bind([SnapGrid.Types.ApplyState], key, variant("idle", null))` under a key of its own — a screen that must not leave drafts behind (a publish) writes `variant("asked", id)` with an id of its own, and the editing canvas saves its drafts as its history item does — waiting out a Save already running, retrying one of unknown outcome — and answers under the same id: `applied(id)` once the source confirms them, or at once with none; `refused({ id, reason })` when they cannot land, `reason` in the canvas's words (the conflict's, the rejection's, a check's or the stale source's). The canvas stays the only writer of its drafts; omitted, only the history item saves
│   │   │   ├─ widths (optional) — [{ label, icon?, width }] the design widths the editing canvas's toolbar offers, a device each (`{ label: "Desktop", icon: "desktop", width: "1440px" }`, `{ label: "Tablet", icon: "tablet-screen-button", width: "1024px" }`): the one the canvas draws at is pressed, and pressing another draws it at that width
│   │   │   ├─ toolbar (optional) — { start?, end? } the host's items in the editing canvas's toolbar, each an array of UIComponents: `start` leads the row (a `<Status>`), `end` closes it (Preview, Publish buttons); they never fold
│   │   │   ├─ panes (optional) — { start?, end? } the panes beside the editing canvas, under its toolbar — a palette, an inspector: a `<Dock surface="shell">` pane collapses to its rail and the canvas column takes the room
│   │   │   ├─ surface (optional) — "card" (default; the editing canvas's own bordered panel) | "shell" (no frame — a canvas inside a host's frame). `view`, `apply`, `widths`, `toolbar`, `panes` and `surface` dress the editing canvas: given without `edit` and `editing`, the build refuses them
│   │   │   ├─ sources (optional) — the Library ids whose cards land on the canvas (`edit.create` builds the row); id (optional) — the drag surface's name in a drop's cell refs; canDrop (optional) — fn(DragEventType) => Boolean, the veto over a card's `add` or a tile's `move` where the drag rests (⊘; a throwing predicate fails open). A drop's cell ref: `row` is the row key, or "" for a new row between rows; `slot` the pointed column "1"–"12", or the gap's index ("0" above the first row, n below the last)
│   │   │   ├─ guides (optional) — draw the column ruler above the rows (the selected tile's columns in brand) and the column bands behind them
│   │   │   └─ zoom (optional) — the scale the canvas draws at (1.0 actual size); the canvas scrolls inside its host
│   │   ├─ The frame (editing): one toolbar across the canvas's width, then the `panes` beside a column holding the selection bar over the grid panel. The toolbar leads with `toolbar.start`, the grid chip ("12 col · snap on") and — once the source confirms a Save — the time it was saved ("Saved · 14:32", UTC); it closes with the width readout ("1440 px"), the zoom (− 100% +, 10% steps from 50% to 150%), the history item, the `widths` and `toolbar.end`. A narrower frame folds it by one ladder: the grid chip first, then the width readout, the saved time, the widths to their icons, and the history item last. The selection bar names the selected tile — its `icon` in a tile, its `label` (else its key) and its `meta` — or says "No selection · Click a component on the grid to arrange it". The history shortcuts work anywhere in the frame, a pane's controls too; a key typed into a field stays the field's
│   │   ├─ The canvas: a click selects a tile (brand border and focus shadow, four corner handles, a span handle on the right edge, a height handle on the bottom edge, the bottom-right corner drags both, and a remove button); Esc or a click on empty canvas clears it. A span drag snaps per column — at least 2, at most 12 less the row's other spans. A height drag snaps to 40px steps, or to a neighbour's bottom edge within 16px while a dashed guide runs across the row; a tile with a `minHeight` shrinks to it, any other stops at its content's height; at most 960; released near its content's height it is auto again. A tile or a card drops beside a tile (a brand line with a "+" badge), between rows, or on the end zone under the last row, each a new row; a tile that takes a row past 12 shrinks to the free columns when that leaves it 3 or more, and otherwise every tile in the row takes ⌊12 / n⌋; a row holds at most 6 tiles (⊘), and a row left empty is gone. Keys: the arrows move the selection; [ and ] change the span by 1; Delete / Backspace remove; tiles drag by keyboard too. A tile's content takes the tile's height — a `<Chart height="fill" …/>` takes the tile's once given one, and its natural height in an auto tile
│   │   └─ Factories:
│   │       ├─ SnapGrid.cell({ key, row, span, height?, minHeight?, align?, frame?, label?, icon?, meta?, content }) — one tile: key (its identity) · row (the key of the row it sits in) · span (columns of 12, held to 1–12) · height (Option<Integer> px; none = its content's height) · minHeight (Option<Integer> px; the least height a height drag leaves it — a chart's plot; none = its content's height) · align ("top" default | "center" | "stretch" — where a shorter tile sits in its row) · frame (default true; false = bare) · label (Option<String>; its name for the drag ghost, the announcements, the history and the selection bar; none = its key) · icon (Option<String>; a Font Awesome solid icon name, the selection bar's tile) · meta (Option<String>; the selection bar's line after its name — what it is, what it reads) · content (the UIComponent it shows)
│   │       ├─ SnapGrid.uiState({ selected?, request? }) — the seed of a bound `ui`, or what a host writes to it: a selection, and a change it asks of the editing canvas (SnapGrid.Types.Request { key, change: span | row | height | align })
│   │       ├─ SnapGrid.viewState({ width?, zoom? }) — the seed of a bound `view`; omitted fields follow the SnapGrid's own `width` and `zoom`
│   │       └─ SnapGrid.Types.{ Root, Cell, Align, Variant, UiState, Request, ViewState, ApplyState, Width, Surface, Place, PatchEvent(R), Editing } — the East types
│   ├─ <Splitter> — resizable panel group
│   │   ├─ Props:
│   │   │   ├─ panels (required) — array of Splitter.Panel(…) values
│   │   │   ├─ defaultSize (required) — initial size percentages, one per panel
│   │   │   ├─ children (required) — one body per panel, in order
│   │   │   ├─ orientation (optional) — horizontal | vertical
│   │   │   ├─ collapseBelow (optional) — container px width below which the panels stack vertically
│   │   │   └─ onResize / onResizeStart / onResizeEnd (optional) — drag lifecycle callbacks (sizes payload)
│   │   └─ Factories:
│   │       └─ Splitter.Panel({ id, minSize?, maxSize?, collapsible?, defaultCollapsed? }) — one panel: id (required), min/max size as percentages, collapsibility
│   ├─ <Configurator> — labelled control table + live preview + derived spec readout
│   │   ├─ Props:
│   │   │   ├─ controls (required) — array of Configurator.Control(…) / .Slot(…) rows, in display order
│   │   │   ├─ preview (required) — the component being configured
│   │   │   ├─ live (optional) — render the LIVE pip in the preview header (default true)
│   │   │   ├─ aside (optional) — { label, body } secondary panel under the preview
│   │   │   ├─ spec (optional) — extra Configurator.Spec(…) rows for state with no control row of its own
│   │   │   └─ labelWidth / sidebarWidth / previewMinHeight (optional) — sizing overrides
│   │   └─ Factories:
│   │       ├─ Configurator.Control(label, value, control, hint?) — a row that ALSO reports `value` in the spec column
│   │       ├─ Configurator.Slot(label, control, hint?) — a row that reports nothing (use `spec` instead)
│   │       └─ Configurator.Spec(label, value) — one extra spec row
│   ├─ <Separator> — 1px rule
│   │   └─ Props:
│   │       ├─ orientation (optional) — horizontal | vertical
│   │       ├─ variant (optional) — subtle | brand | dashed | strong
│   │       ├─ label (optional) — inline label on the rule (string or UIComponent)
│   │       └─ align (optional) — label placement along the rule
│   ├─ <ScrollArea> — styled-scrollbar scroll container
│   │   └─ Props:
│   │       ├─ children (required) — scrollable content
│   │       ├─ orientation (optional) — vertical (default) | horizontal
│   │       ├─ scrollbarStyle (optional) — overlay (default) | classic
│   │       └─ thumbColor / trackColor / background (optional) — scrollbar + viewport colours
│   ├─ <Sticky> — position-sticky wrapper
│   │   └─ Props:
│   │       ├─ children (required) — the stuck content
│   │       ├─ offset (optional) — CSS length sticky offset (default "0")
│   │       ├─ boundary (optional) — stick to the parent scroll ancestor (default) or the viewport
│   │       └─ background / borderColor / shadowColor (optional) — styling applied while stuck
│   ├─ <Expandable> — region expands in place to fill the app container (CSS takeover, no remount); Esc collapses
│   │   └─ Props:
│   │       ├─ children (required) — the expandable region
│   │       ├─ expanded (optional) — controlled expanded state
│   │       ├─ onExpandedChange (optional) — fn(Boolean) => Null on user toggle
│   │       ├─ label (optional) — accessible toggle name ("Expand ‹label›")
│   │       ├─ zIndex (optional) — stacking level of the expanded surface (default 900, below Chakra floating tiers)
│   │       └─ background (optional) — expanded-surface background (default bg.canvas)
│   └─ <Dock> — inline pane that collapses along an axis to an icon rail, staying in flow (siblings reflow; never overlays) — a source panel beside a drop target (Library beside a Plan); Esc does NOT collapse. Expanded, it has no header strip: its one row is a tab row with the collapse control at its end. Collapsed, it is a rail: the expand control, then the icon in its tile, the badge, the label and the detail running down it
│       └─ Props:
│           ├─ children (required unless `tabs`) — the pane's body, under the `label` as its only tab; not shown when `tabs` are given
│           ├─ tabs (optional) — [{ key, label, body }] the tab row, each tab with its own body: the first open to begin with, the one opened kept under the storage key, every body kept mounted so each keeps its state; ← / → / Home / End move along the row
│           ├─ orientation (optional) — collapse axis: horizontal (default) | vertical
│           ├─ side (optional) — edge the rail pins to: start (default) | end
│           ├─ expandedSize / railSize (optional) — size along the axis expanded (px or %) / collapsed (default 44px)
│           ├─ icon / label / badge (optional) — the rail's icon tile (FA name) / the pane's name: its only tab without `tabs`, the rail's label, and the controls' accessible names ("Collapse ‹label›" / "Expand ‹label›") / the rail's count chip (an empty one draws none, so a computed badge can come and go)
│           ├─ active / detail (optional) — `active` draws the rail's icon tile and badge in the brand, as when the pane shows something (an inspector's selected tile); `detail` is a second line down the rail after the label — what the pane shows now (the tile's name), muted unless `active`
│           ├─ surface (optional) — "card" (default; its own bordered panel) | "shell" (only the rule along its inner edge — a pane inside a host's frame, beside what it serves)
│           ├─ collapsed (optional) — controlled collapsed state
│           ├─ defaultCollapsed (optional) — uncontrolled initial state (default false)
│           ├─ onCollapsedChange (optional) — fn(Boolean) => Null on user toggle
│           ├─ persist (optional) — where the uncontrolled state persists (default none)
│           ├─ keepMounted (optional) — keep the body mounted while collapsed (default true)
│           ├─ lazy (optional) — mount the body only on first expand (default false)
│           └─ animated (optional) — animate the rail↔expanded size change (default false)
│
├─ Typography (display text)
│   ├─ <Text> — inline/block text
│   │   ├─ Props:
│   │   │   ├─ children (required) — the text (an East string — see the Text pattern below)
│   │   │   ├─ textStyle (optional) — typographic preset token (body-md, heading-sm, …)
│   │   │   ├─ fontWeight / fontStyle / fontFamily (optional) — face overrides (fontFamily: sans | serif | mono)
│   │   │   ├─ fontVariantNumeric (optional) — e.g. tabular-nums for aligned digits
│   │   │   ├─ textAlign / textDecoration / textTransform (optional) — alignment + decoration + casing
│   │   │   ├─ textOverflow / whiteSpace (optional) — ellipsis / wrapping control
│   │   │   ├─ lineHeight / letterSpacing (optional) — rhythm overrides
│   │   │   ├─ borderWidth / borderStyle (optional) — text-block border (with borderColor)
│   │   │   └─ …plus BOX bag + COLOR overrides
│   │   └─ Factories:
│   │       ├─ Text.Presets.Eyebrow(text, style?) — mono uppercase eyebrow (section labels, status words)
│   │       ├─ Text.Presets.EyebrowSm(text, style?) — smaller eyebrow tier
│   │       ├─ Text.Presets.MonoLabel(text, style?) — mono label (sidebar items, dense frame headers)
│   │       ├─ Text.Presets.MonoSm(text, style?) — small mono annotation
│   │       ├─ Text.Presets.MetaSm(text, style?) — small muted meta line
│   │       └─ Text.Presets.MonoKpi(text, style?) — 24px mono tabular-nums KPI number
│   ├─ <Heading> — display heading
│   │   └─ Props:
│   │       ├─ children (required) — the heading text
│   │       ├─ as (optional) — rendered element h1…h6
│   │       ├─ textStyle (optional) — heading preset token
│   │       ├─ fontWeight / fontStyle / fontFamily (optional) — face overrides
│   │       ├─ textAlign / textDecoration / lineHeight / letterSpacing (optional) — alignment + rhythm
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <Link> — hyperlink
│   │   └─ Props:
│   │       ├─ href (required) — target URL
│   │       ├─ children (required) — link text
│   │       ├─ external (optional) — open in a new tab
│   │       ├─ variant (optional) — underline-on-hover presets
│   │       ├─ colorPalette (optional) — hue theming
│   │       ├─ hoverColor / visitedColor (optional) — state colours
│   │       └─ …plus textDecoration / lineHeight / letterSpacing, BOX bag, COLOR overrides
│   ├─ <Code> — inline code token
│   │   └─ Props:
│   │       ├─ children (required) — the code text
│   │       ├─ variant (optional) — visual preset
│   │       ├─ colorPalette / size (optional) — hue + size
│   │       └─ …plus textDecoration / lineHeight / letterSpacing, BOX bag, COLOR overrides
│   ├─ <CodeBlock> — multi-line code block
│   │   └─ Props:
│   │       ├─ children (required) — the source text
│   │       ├─ language (optional) — syntax-highlight language
│   │       ├─ showLineNumbers / highlightLines (optional) — gutter numbers + highlighted line list
│   │       ├─ showCopyButton (optional) — corner copy affordance
│   │       ├─ wordWrap (optional) — soft-wrap long lines
│   │       ├─ title (optional) — header caption
│   │       ├─ headerBackground / lineNumberColor / highlightBackground (optional) — chrome colours
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <List items={…}> — bulleted / numbered list
│   │   └─ Props:
│   │       ├─ items (required) — the entries (strings or nested components — a config prop, not JSX children)
│   │       ├─ variant (optional) — ordered | unordered | dot
│   │       ├─ marker / markerIcon / markerColor (optional) — marker glyph styling
│   │       ├─ colorPalette / gap (optional) — hue + item spacing
│   │       └─ …plus BOX bag + COLOR overrides
│   ├─ <Highlight> — tints query substrings inside its text
│   │   └─ Props:
│   │       ├─ children (required) — the full text
│   │       ├─ query (required) — substrings to highlight
│   │       └─ color / background (optional) — highlight ink + wash, plus BOX bag
│   ├─ <Mark> — semantic <mark> span
│   │   └─ Props:
│   │       ├─ children (required) — the marked text
│   │       ├─ variant (optional) — severity preset
│   │       └─ colorPalette + COLOR overrides + BOX bag (all optional)
│   ├─ <Note> — inset callout / quote
│   │   └─ Props:
│   │       ├─ children (required) — note content
│   │       ├─ variant (optional) — visual preset
│   │       ├─ emphasis (optional) — brand | warn | danger
│   │       ├─ accentColor (optional) — the callout stripe colour
│   │       └─ width / maxWidth / padding / margin / opacity + COLOR overrides (all optional)
│   └─ <Numeric> — tabular-num number with sentiment (shares the Formats vocabulary)
│       └─ Props:
│           ├─ value (required) — the raw number
│           ├─ format (optional) — a Format.* spec: Format.Currency({ currency: "EUR" }), Format.Percent(…), Format.Compact(), … (see the Formats branch)
│           ├─ sentiment (optional) — positive | negative | neutral colouring
│           ├─ showSign (optional) — always render the +/− sign
│           ├─ textStyle (optional) — typographic preset
│           └─ signColor / color / background / opacity (optional) — ink overrides
│
├─ Buttons (user actions)
│   ├─ <Button> — the standard action button
│   │   └─ Props:
│   │       ├─ children (required) — label text
│   │       ├─ variant (optional) — solid | subtle | outline | ghost | plain
│   │       ├─ colorPalette / size (optional) — hue + size token
│   │       ├─ onClick (optional) — East.function([], NullType) handler
│   │       ├─ startIcon / endIcon (optional) — leading / trailing icon ({ prefix: "fas", name })
│   │       ├─ loading / loadingText / loadingIcon (optional) — spinner state + swapped label/icon
│   │       ├─ disabled (optional) — blocks interaction
│   │       └─ hoverBackground + COLOR overrides (optional) — palette escape hatches
│   ├─ <IconButton> — icon-only button
│   │   └─ Props:
│   │       ├─ prefix / name (required) — Font Awesome solid icon ("fas", "chevron-right")
│   │       ├─ label (required) — accessible aria-label
│   │       ├─ variant / colorPalette / size (optional) — as Button
│   │       ├─ onClick / loading / loadingIcon / disabled (optional) — as Button
│   │       ├─ badge (optional) — superscript count text ("99+", "" = dot-only)
│   │       ├─ badgeColorPalette (optional) — badge hue (default red)
│   │       ├─ attention (optional) — "pulse" blinks the badge, "ring" rings the button
│   │       └─ hoverBackground + COLOR overrides (optional)
│   ├─ <CloseButton> — × dismiss button
│   │   └─ Props: variant / size / label (aria, default "Close") / disabled / onClick / hoverBackground + COLOR overrides (all optional)
│   ├─ <CopyButton> — copies to clipboard with ✓ feedback
│   │   └─ Props:
│   │       ├─ value (required) — the text copied
│   │       ├─ label (optional) — text next to the copy icon
│   │       ├─ timeout (optional) — "Copied!" duration ms
│   │       ├─ successColor (optional) — confirmation glyph tint
│   │       └─ variant / colorPalette / size / disabled / hoverBackground + COLOR overrides (optional)
│   ├─ <Toggle> — pressable on/off button (NOT a form toggle — see <Switch>)
│   │   └─ Props:
│   │       ├─ pressed (required) — current state (Toggle has no internal state)
│   │       ├─ children (required) — label
│   │       ├─ onChange (optional) — fn(Boolean) => Null
│   │       ├─ icon (optional) — leading icon
│   │       ├─ pressedBackground / pressedColor (optional) — pressed-state colours
│   │       └─ variant / size / disabled + COLOR overrides (optional)
│   └─ <ButtonGroup> — row/col cluster of buttons
│       └─ Props:
│           ├─ children (required) — the buttons
│           ├─ attached (optional) — join into one control with shared borders
│           └─ gap / borderColor (optional) — spacing when not attached; shared border colour when attached
│
├─ Forms (user input)
│   ├─ <Input> — typed text inputs (namespace tag)
│   │   ├─ Nested tags: <Input.String> <Input.Integer> <Input.Float> <Input.DateTime> — value-typed variants
│   │   └─ Props (shared unless noted):
│   │       ├─ value (required) — current value (String / Integer / Float / DateTime respectively)
│   │       ├─ onChange (optional) — fn(newValue) => Null (typed per variant)
│   │       ├─ onBlur / onFocus (optional) — focus lifecycle
│   │       ├─ variant (optional) — outline | subtle | flushed
│   │       ├─ size (optional) — xs | sm | md | lg
│   │       ├─ disabled (optional) — blocks input
│   │       ├─ autoFocus (optional) — focus on first mount
│   │       ├─ String: placeholder / maxLength / pattern (optional) — text constraints
│   │       ├─ Integer & Float: min / max / step (optional); Float: precision (decimal places)
│   │       ├─ DateTime: min / max / precision (date|time|datetime) / format (token list) (optional)
│   │       └─ focusBorderColor / placeholderColor + COLOR overrides (optional)
│   ├─ <Textarea> — multi-line input
│   │   └─ Props:
│   │       ├─ value (required) — current text
│   │       ├─ onChange / onBlur / onFocus / onValidate (optional) — edit + focus callbacks
│   │       ├─ placeholder / rows / maxLength / autoresize (optional) — sizing + constraints
│   │       ├─ resize (optional) — none | vertical | horizontal | both
│   │       ├─ disabled / readOnly / required / invalid (optional) — form state
│   │       └─ variant / size / focusBorderColor + COLOR overrides (optional)
│   ├─ <Select> — single/multi-select dropdown
│   │   ├─ Props:
│   │   │   ├─ value (required) — selected value ("" = none)
│   │   │   ├─ items (required) — array of Select.Item(…)
│   │   │   ├─ onChange (optional) — fn(String) => Null (single)
│   │   │   ├─ onChangeMultiple (optional) — fn(Array<String>) => Null (multi)
│   │   │   ├─ multiple / placeholder / disabled / size (optional) — behaviour + chrome
│   │   │   ├─ onOpenChange (optional) — dropdown open/close callback
│   │   │   └─ COLOR overrides (optional) — trigger colours
│   │   └─ Factories:
│   │       └─ Select.Item(value, label, { disabled? }) — one option
│   ├─ <Combobox> — typeahead / filter select
│   │   ├─ Props:
│   │   │   ├─ value (required) — current input / selected value
│   │   │   ├─ items (required) — array of Combobox.Item(…)
│   │   │   ├─ onChange / onChangeMultiple (optional) — selection callbacks (single / multi)
│   │   │   ├─ onInputValueChange (optional) — fires as the user types
│   │   │   ├─ allowCustomValue (optional) — accept values not in the list
│   │   │   ├─ multiple / placeholder / disabled / size / onOpenChange (optional) — as Select
│   │   │   └─ COLOR overrides (optional)
│   │   └─ Factories:
│   │       └─ Combobox.Item(value, label, { disabled? }) — one option
│   ├─ <Checkbox> — boolean checkbox
│   │   └─ Props:
│   │       ├─ checked (required) — current state
│   │       ├─ onChange (optional) — fn(Boolean) => Null
│   │       ├─ label (optional) — trailing text
│   │       ├─ indeterminate (optional) — partial-selection dash
│   │       ├─ disabled / colorPalette / size (optional)
│   │       └─ fillColor / checkColor / borderColor (optional) — slot colours
│   ├─ <Switch> — form on/off toggle (binds a boolean)
│   │   └─ Props:
│   │       ├─ checked (required) — current state
│   │       ├─ onChange (optional) — fn(Boolean) => Null
│   │       ├─ label / disabled / colorPalette / size (optional)
│   │       └─ onColor / offColor / thumbColor (optional) — track + knob colours
│   ├─ <Slider> — range slider
│   │   └─ Props:
│   │       ├─ value (required) — current value
│   │       ├─ onChange (optional) — fires during drag; onChangeEnd (optional) — fires on release
│   │       ├─ min / max / step (optional) — range (defaults 0–100)
│   │       ├─ orientation / variant / colorPalette / size / disabled (optional)
│   │       └─ trackColor / fillColor / thumbColor / markColor (optional) — slot colours
│   ├─ <RadioGroup> — single-select radio list
│   │   └─ Props:
│   │       ├─ value (required) — selected value ("" = none)
│   │       ├─ items (required) — [{ value, label?, disabled? }]
│   │       ├─ onChange (optional) — fn(String) => Null
│   │       ├─ orientation / name / disabled / required / colorPalette / size (optional)
│   │       └─ color / fillColor / borderColor (optional) — ink + radio colours
│   ├─ <RadioCardGroup> — radios rendered as picker cards
│   │   └─ Props:
│   │       ├─ value (required) — selected card value
│   │       ├─ items (required) — [{ value, label, description?, disabled? }]
│   │       ├─ onChange (optional) — fn(String) => Null
│   │       ├─ orientation / name / disabled / required / colorPalette / size (optional)
│   │       └─ color / descriptionColor / cardBackground / selectedCardBackground / selectedBorderColor (optional)
│   ├─ <TagsInput> — typeahead chip input
│   │   └─ Props:
│   │       ├─ defaultValue (optional) — initial tags
│   │       ├─ onChange (optional) — fn(Array<String>) => Null with the new tag set
│   │       ├─ suggestions (optional) — autocomplete list (free entry still allowed)
│   │       ├─ max / maxLength / allowOverflow (optional) — tag-count / length constraints
│   │       ├─ editable / delimiter / addOnPaste / blurBehavior (optional) — editing behaviours
│   │       ├─ onInputChange / onHighlightChange (optional) — typing + highlight callbacks
│   │       ├─ label / placeholder / disabled / readOnly / invalid (optional) — chrome + state
│   │       ├─ variant / size / colorPalette (optional)
│   │       └─ tagBackground / tagColor / tagBorderColor + COLOR overrides (optional) — per-chip colours
│   ├─ <FileUpload> — drop-zone file picker
│   │   └─ Props:
│   │       ├─ onFileAccept (optional) — fn(files) => Null; onFileReject (optional) — fn(rejections) => Null
│   │       ├─ accept / maxFiles / maxFileSize / minFileSize (optional) — acceptance constraints
│   │       ├─ directory / allowDrop / capture (optional) — folder upload, drag-drop, mobile camera
│   │       ├─ label / dropzoneText / triggerText / orientation (optional) — copy + layout
│   │       ├─ disabled / required / name (optional) — form state
│   │       └─ variant / size / dropzoneBackground / dropzoneBorderColor / activeBackground + COLOR overrides (optional)
│   ├─ <Field> — form-field wrapper (label + control + helper/error)
│   │   └─ Props:
│   │       ├─ label (required) — the field caption; children (required) — the control
│   │       ├─ helperText / errorText (optional) — descriptive + validation lines
│   │       ├─ required / disabled / invalid / readOnly (optional) — form state
│   │       ├─ orientation (optional) — label/control layout
│   │       └─ labelColor / helperTextColor / errorColor / warningColor / infoColor / requiredIndicatorColor (optional)
│   ├─ <DateRangeInput> — start–end date pair with preset chips
│   │   └─ Props:
│   │       ├─ startValue / endValue (required) — the range (UTC DateTime pair)
│   │       ├─ onChange (optional) — fn(start, end) => Null
│   │       ├─ min / max / precision (optional) — bounds + picker precision (date|minute|second)
│   │       ├─ presets (optional) — [{ label, start, end }] preset rows above the inputs
│   │       ├─ disabled (optional)
│   │       └─ variant / size / focusBorderColor + COLOR overrides (optional)
│   └─ <TimeRangeInput> — start–end time pair (minutes since midnight)
│       └─ Props:
│           ├─ startValue / endValue (required) — minutes 0–1439
│           ├─ onChange (optional) — fn(startMin, endMin) => Null
│           ├─ min / max / step (optional) — bounds + picker step (default 15)
│           ├─ presets (optional) — [{ label, start, end }]
│           ├─ disabled (optional)
│           └─ variant / size / focusBorderColor + COLOR overrides (optional)
│
├─ Collections (display data sets) — structured data on `data=` / `columns=` / `items=` props
│   ├─ <Table data={rows} columns={…} /> — sortable / pinnable / virtualized data grid; generic pass-through (column/cell inference preserved)
│   │   ├─ Props:
│   │   │   ├─ data (required) — array of row structs, or of RecursiveType rows whose node is a struct (nested with `tree`); or a paged source of either (#576)
│   │   │   ├─ columns (required) — keyed config: ["a","b"] or { a: { header, width, value?, render?, format?, aggregate?, … } }; with no `render` a cell PRINTS ITSELF in the viewer's language (#874): a number keeps every digit, never grouped, with the viewer's decimal separator (1234.5 — German 1234,5; a year or an id prints as stored), a string as it is, anything else as East prints it; `format` — a Format.* spec (Format.Number() groups thousands, Format.Currency({ currency: "EUR" }), Format.Percent(…)) — prints the column's number cells AND a parent's subtotals through it (a `count` prints as a count); column `render` is an East fn ({rowIndex, path, columnKey, cellValue} → UIComponent) called per VISIBLE cell, drawing it instead — full-row access = capture the data array + index it (($, ctx) => { const row = $.let(rows.get(ctx.rowIndex)); … }; a flat table's rowIndex IS the data index, a nested row is reached by its `path`); render/on* fns may capture only data + bind-handles — never a UIComponentType value (beast2 can't serialize it)
│   │   │   ├─ tree (optional) — { children: r => r.lines, collapsed?: true | r => Boolean } rows nest to ANY depth from the data's own tree (#954): `children` returns more of the SAME row type (a RecursiveType row's own field, or a lookup among the rows) — a recursive row reaches every accessor as its node — and a different type is refused at build; a parent IS its group row: its own cells, and in an `aggregate` column ("sum"|"mean"|"min"|"max"|"count") its children's subtotal, composed bottom-up (sum of sums, a mean of means — always a Float — min / max of theirs, `count` the leaf rows beneath), drawn through the column's `render` (its `cellValue` the subtotal) or `format` (a `count` prints itself through neither); a caret before a parent's first cell folds its subtree (persisted by path under the storageKey; `collapsed` is where it starts); a sort orders siblings among themselves, each parent carrying its subtree; rows arrive in PRE-ORDER, and a row's position in it is its `rowIndex`. There is no `groupBy`: group flat rows as a data step before the table; grand totals stay in footerRows
│   │   │   ├─ columnGroups (optional) — column-group heading row (type-checked columnKeys)
│   │   │   ├─ footer / footerRows (optional) — one / many footer rows, keys narrowed to the table's columns
│   │   │   ├─ expandedContent (optional) — fn(rowIndex) => UIComponent expandable row detail (the row's pre-order index — a flat table's data index — stable under sorting AND pagination)
│   │   │   ├─ frozen (optional) — column keys pinned left (visible during horizontal scroll)
│   │   │   ├─ height / maxHeight (optional) — uniform sizing (#320): pin or cap the table; chrome-inclusive, rows scroll within
│   │   │   ├─ variant / size / striped / interactive / stickyHeader / showColumnBorder (optional) — grid chrome
│   │   │   ├─ density (optional) — row rhythm preset; rowHeight (optional) — explicit px override (fed to the virtualizer)
│   │   │   ├─ virtualization / columnResize (optional) — row virtualization + header drag-resize
│   │   │   ├─ selection (optional) — { mode, selected, onChange } embedded row-selection state over pre-order indices (a shift-click range spans the rows as displayed; select-all takes every row in the data)
│   │   │   ├─ pagination (optional) — { pageSize, page, onPageChange } embedded pager over TOP-LEVEL rows, each page holding its rows' whole subtrees
│   │   │   ├─ onCellClick / onCellDoubleClick / onRowClick / onRowDoubleClick / onRowSelectionChange / onSortChange (optional) — interaction callbacks; row events carry `rowIndex` (the pre-order index) and `path` ([i] the i-th top-level row, [i, j] its j-th child)
│   │   │   ├─ rowStatus (optional) — fn(rowIndex) => StatusToken row tint over the pre-order index (see the Statuses branch)
│   │   │   ├─ review / reviewStatus / reviewApproval (optional) — pinned-right Decision column + commitBar foot BELOW the pager; rowIndex is the row's pre-order index
│   │   │   ├─ slice + affordances (optional) — bound slice chrome (default ["filter","search"]); filtering flows through the slice interface
│   │   │   ├─ plotGutter (optional) — shared plot gutter (#147); frozen columns fill `left`
│   │   │   └─ colorPalette + headerBackground / headerColor / zebraBackground / hoverBackground / selectedBackground / selectedBorderColor / footerBackground / borderColor (optional) — chrome colours
│   │   └─ Factories: (columns/footers are plain config objects; no builders)
│   ├─ <DataList items={…} /> — label/value pairs
│   │   └─ Props:
│   │       ├─ items (required) — [{ label: String, value: UIComponent }] (plain structs — no builder needed)
│   │       ├─ orientation / size / variant (optional) — pair layout + chrome
│   │       └─ labelColor / valueColor / background / borderColor (optional)
│   ├─ <TreeView nodes={…} /> — expandable hierarchical tree with selection
│   │   ├─ Props:
│   │   │   ├─ nodes (required) — array of TreeView.Item / TreeView.Branch values
│   │   │   ├─ selectionMode (optional) — selection cardinality
│   │   │   ├─ defaultExpandedValue / defaultSelectedValue (optional) — initial expansion / selection
│   │   │   ├─ onExpandedChange / onSelectionChange / onFocusChange (optional) — interaction callbacks
│   │   │   ├─ size / variant / animateContent / label (optional) — chrome
│   │   │   └─ itemColor / itemHoverBackground / selectedBackground / selectedColor / caretColor / connectorColor (optional)
│   │   └─ Factories:
│   │       ├─ TreeView.Item(value, label, indicator?) — leaf node (indicator = a Font Awesome solid icon + style)
│   │       └─ TreeView.Branch(value, label, children, indicator?, disabled?) — expandable node
│   ├─ <Plan> — the planning canvas (ONE shared time | number | ordinal axis over heterogeneous rows: event kinds over records, rows laid out by a series list over data, and read-only rows) is e3-ui's (#1177, #1191): `import { Plan } from "@elaraai/e3-ui"` — its props, factories and patterns are in the e3-ui skill
│   ├─ <Sheet> — the planning spreadsheet, always in its builder frame (typed columns over an e3 record's rows or the host's, a blank tail that invites the next row, typed grammars, an East-function copilot, a slice lens, an editing session, and a library and an inspector pane, each an optional prop) is e3-ui's (#1179, #1216): `import { Sheet } from "@elaraai/e3-ui"` — its props, factories and patterns are in the e3-ui skill
│   ├─ <Matrix data={…} columns={…} cell={(r, col) => Matrix.cell({…})} /> — rows × columns of status-coloured segment bars
│   │   ├─ Props:
│   │   │   ├─ data (required) — row structs, or RecursiveType rows whose node is a struct (nested with `tree`); columns (required) — array of Matrix.column(…) (data-drivable with .map)
│   │   │   ├─ cell (required) — (row, column) => Matrix.cell(…) builder
│   │   │   ├─ rowKey (required) — the row's key, its address in every event (keep keys unique across a nested tree); rowValue / rowSublabel (optional) — the row header's text
│   │   │   ├─ tree (optional) — { children: r => r.members, collapsed?: true | r => Boolean } rows nest to ANY depth from the data's own tree (#955), as on the Table: `children` returns more of the SAME row type (a RecursiveType row's own field, or a lookup among flat rows — `r => people.filter((_$, p) => p.team.equal(r.name))`); a parent is a FULL row — its header indented with a fold caret, and its own cells from the same `cell` builder (no aggregates: a parent's bars are whatever its row builds); the caret folds its subtree (persisted by path under the storageKey). There is no `groupBy`: group flat rows as a data step
│   │   │   ├─ rowHeader (optional) — header label for the left identity column
│   │   │   ├─ orientation (optional) — default segment orientation
│   │   │   └─ legend (optional) — explicit legend entries [{ fill, label }] (omitted ⇒ auto-derived)
│   │   └─ Factories:
│   │       ├─ Matrix.column({ key, label? }) — one x-axis column
│   │       ├─ Matrix.cell({ segments?, markers?, orientation?, slot?, popover? }) — one cell (slot = arbitrary UIComponent; popover = click body)
│   │       ├─ Matrix.segment({ fill?, weight, label?, color?, min?, max?, step? }) — one segment of the cell bar
│   │       └─ Matrix.marker({ status?, message, at?, label? }) — corner status marker
│   ├─ <Calendar data={days} cell={d => ({…})} /> — day-of-week × week HEATMAP (8-step teal ramp, theme-aware; cols always Mon–Sun); viz-only (no events / drag). Hover cross-highlights the row + column; click selects (footer + onSelect)
│   │   ├─ Props:
│   │   │   ├─ data (required) — day rows; cell (optional) — row mapper to { week, day, value, text?, compare?, summary? } (omit when data is already Calendar.Types.Cell). `compare` is the footer baseline (e.g. last year) → drives the delta chip
│   │   │   ├─ values (optional) — print the number in each cell (default true; false = pure heat read)
│   │   │   ├─ scale (optional) — Calendar.scale({…}) heatmap ramp / bucket count
│   │   │   ├─ domain (optional) — explicit intensity { min, max } (default observed)
│   │   │   ├─ totals (optional) — Calendar.totals({…}) the Σ-wk rail (per-WEEK aggregation)
│   │   │   ├─ aggregateRow (optional) — Calendar.aggregateRow({…}) the trailing row (per-WEEKDAY aggregation, e.g. mean)
│   │   │   ├─ footer (optional) — Calendar.footer({…}) the selection footer (value / compare / delta chip + gradient legend)
│   │   │   ├─ actionLabel + onAction (optional) — footer drill affordance (receives the selected cell)
│   │   │   ├─ onSelect (optional) — cell-click callback
│   │   │   ├─ density / height / maxHeight (optional) — rhythm (comfortable=large / compact / condensed=tight) + uniform sizing (#320)
│   │   │   └─ plotGutter (optional) — shared gutter (#147); `left` = the week-label column (drops the totals/mean/footer chrome to keep the day axis aligned)
│   │   └─ Factories:
│   │       ├─ Calendar.scale({ ramp?, steps? }) — heatmap colour scale (ramp = low→high CSS colours, absent = default teal ramp; steps = bucket count)
│   │       ├─ Calendar.totals({ aggregate?, label?, bar? }) — the weekly rail (aggregate sum/mean/min/max/count — SAME vocabulary as Table; label "Σ wk"; bar = proportion bar)
│   │       ├─ Calendar.aggregateRow({ aggregate?, label? }) — the per-weekday row (aggregate default "mean", label "mean")
│   │       └─ Calendar.footer({ valueLabel?, compareLabel?, legend? }) — selection footer labels + the low→high gradient legend (legend: true | { low, high })
│   ├─ <Schematic items={rows} extent={{width,height}} item={r => ({…})} /> — 2D world-coord canvas: items / zones / links / nets from flat tables
│   │   ├─ Props:
│   │   │   ├─ items + extent (required) — item rows + world bounds (canvas scales to fit)
│   │   │   ├─ item (optional) — row mapper to { key, x, y, label, sublabel?, icon?, status?, meter?{value,max}, metric?, width?, footprint?, tone?, color?, bg?, fillOpacity?, weight?, excluded?, layer? } (omit when already Schematic.Types.Item)
│   │   │   ├─ zones + zone (optional) — zone rows + mapper to { key, label, x, y, width, height, pattern?, geometry?, tone?, color?, bg?, fillOpacity?, weight?, layer? }
│   │   │   ├─ links + link (optional) — link rows + mapper to { key, from, to, label?, metric?, style?, route?, via?, layer? }
│   │   │   ├─ nets + net (optional) — manifold/bus rows (ONE row = many sources → many destinations) + mapper to { key, sources, destinations, label?, metric?, style?, route?, via?, layer? }; drawn P&ID-style — a header BAR spans each multi-endpoint side with a stub per endpoint, the trunk runs bar → via… → bar (junction dots ONLY where a tap 3-way joins a bar)
│   │   │   ├─ selectionMode (optional) — "single" (default) | "multiple" | "range"; multiple ⇒ marquee tool (drag-box multi-select w/ live preview + count; plain box/tap replaces, Shift extends)
│   │   │   ├─ onSelect / onSelectionChange (optional) — item click (key) / full selection-set events ({key?, selected, selectedKeys, additive, region?}); works in every tool (grab/zoom/marquee)
│   │   │   ├─ onSelectZone / onZoneSelectionChange (optional) — zone click-select (items win hit-test; innermost zone wins; Shift extends) reporting the zones AND their childItemKeys
│   │   │   ├─ selectZoomFocus (optional) — a canvas selection also moves the camera (tap flies, marquee fits)
│   │   │   ├─ onItemOpen (optional) — double-click drill-in (background double-click keeps Fit/reset)
│   │   │   ├─ onViewportChange (optional) — debounced viewport-settled reporting ({zoom, minX, minY, maxX, maxY}) for sync / lazy-load / persist
│   │   │   ├─ linkMode (optional) — connect-gesture mode: "draw" (adds locally, form-input style) | "connect" (event-only, repeatable: plan operations); Shift+drag ADDS to the session
│   │   │   ├─ onCreateLink / onSelectLink / onEditLink / onDeleteLink (optional) — link lifecycle ({link, links, additive, existing} on create; click-select key; endpoint re-target; Del delete)
│   │   │   ├─ canConnect (optional) — fn(from, to) => Bool vetoes pairs BEFORE they resolve (the draft never snaps; one rule covers links, Shift-session/net extensions, and re-targets; a throwing validator fails OPEN)
│   │   │   ├─ onEditNet (optional) — net membership edits: trunk/bar click selects the WHOLE net, a STUB click selects ONE leg (Del removes just that endpoint; onEditNet reports membership AFTER; a side emptying deletes the whole net via onDeleteLink). Shift-session gestures keep ONE bus (a member never flips sides); with a LINK selected, Shift-drag from its endpoint SEEDS the session with that link (onCreateLink.absorbed lists absorbed keys — delete those rows when upserting); with a NET selected, Shift-drag out of a member adds the target as a leg; a Shift connect-session commits as a net (onCreateLink.net = {key, sources, destinations}, stable session key — upsert by net.key)
│   │   │   ├─ readOnly / readOnlyLinks / readOnlyItems (optional) — flattened per-domain edit gates
│   │   │   ├─ onMoveItem (optional) — move tool (readOnlyItems off): drags items to new positions; a selected item moves the WHOLE selection rigidly, local-first; fires once per gesture ({key, x, y, keys, dx, dy})
│   │   │   ├─ itemHover / zoneHover / linkHover (optional) — East fn key => UIComponent lazy hover cards (charts in a card over a tank / pipe); any camera or edit gesture closes them; hover ignores readOnly + locked layers
│   │   │   ├─ slice + affordances (optional) — bound slice chrome (default ["search"]); flat effect props sliceHidden / sliceOpacity / sliceDesaturate / sliceDot / sliceEmphasis:"halo"|"pulse" / sliceFrame / sliceFrameFit keep filtered-OUT items as ghost/desaturate/dot context + emphasise the remainder instead of hiding — feed the FULL set (Slice.partition) and mark item.excluded (e.g. t.matched.not())
│   │   │   ├─ sliceSelectField (optional) — bound-slice fieldId a marquee/tap selection writes an `in` filter of selected item keys into (one-directional selection→slice) — pair with the ghost effect (not a Slice.rows feed on the same slice)
│   │   │   ├─ layers (optional) — [{ key, label, tone?, visible?, locked?, opacity? }] + tag items/zones/links with layer:"key"; a canvas layer button opens a show/hide/solo/lock panel (persists per panel); lock ⇒ non-selectable (click-through), opacity dims
│   │   │   ├─ scaleUnit / grid / navigator / minimap (optional) — scale bar unit, metric grid (default on), zones→items TOC (default when zones exist), minimap (default 25+ items)
│   │   │   └─ height / maxHeight (optional) — uniform sizing (#320); default aspect-driven, capped 75vh
│   │   └─ Factories:
│   │       ├─ Schematic.circle(r) / .polyline(verts, {width}) / .polygon(verts) / .rect() — item footprints + zone geometry
│   │       ├─ Schematic.outline() / .hatch() — zone boundary patterns
│   │       └─ Schematic.solid() / .dashed() — link / net stroke styles
│   ├─ <Flowchart states={…} links={…} lanes={…} /> — state-transition flowchart: states as nodes in ORDERED phase lanes (layout derived — no coordinates), H/V-routed transition arrows, optional per-link decision triggers (lettered diamonds); dim-ladder highlight built in; hover content is DEV-DEFINED (the Schematic contract); view lenses are saved slice cohorts
│   │   ├─ Props:
│   │   │   ├─ states + links + lanes (required) — the three tables (lanes accept a literal [{ key, label? }] array; array order = band order)
│   │   │   ├─ state / link / lane / trigger (optional) — row mappers to { key, label?, lane, members?, notes? } / { key?, from, to, kind?, trigger?, evidence? } / { key, label? } / { key, label, letter?, owner?, queue?, outcomes? }; omit when rows are already Flowchart.Types.*
│   │   │   ├─ triggers (optional) — decision registry; a link's `trigger` names one (0..1 per link ⇒ the lettered diamond at the longest-run midpoint; clicking it highlights governed links)
│   │   │   ├─ link `kind` "planned" (solid, default) | "observed" (dashed 5/4); DERIVED marks: a from/to ref with no state row ⇒ the neg-dashed ghost "No state row" node (unresolved, counted in the footer); from == to folds to the `↻ n` badge (never routed); `members` ⇒ the ×N state-class badge
│   │   │   ├─ link `evidence` { volume?, count?, measuredAt?, unit? } — stroke weight (log 1.6 / 2 / 2.5 px, floor 1.4) + paper-filled run badges whose chrome inherits the link class (imported, never hand-authored)
│   │   │   ├─ stateHover / linkHover / triggerHover (optional) — hover-card content builders (East fn key => UIComponent, evaluated lazily on hover in the standard 400ms shell); absent ⇒ no hover card; detail drills through the click callbacks (open a <Drawer> in the handler)
│   │   │   ├─ orientation (optional) — "LR" (default) | "TD" initial; the eyebrow segment toggles it (view state, never a filter chip; TD swaps the handle axes); freshness (optional) — eyebrow chip { label, date? }
│   │   │   ├─ legend / minimap (optional) — legend default true (reserves canvas space); minimap auto at ≥ 25 states
│   │   │   ├─ slice + affordances (optional) — bound slice chrome at compact density (default ["filter","search"]; search = "⌕ find state"; "brush" is a build-time error — no continuous 1D axis); the footer derives `N links · narrowed from M · −%` + the planned/observed split
│   │   │   ├─ onSelectState / onSelectLink / onSelectTrigger / onTracePath (optional) — click / ⌥-click callbacks (entity keys); Esc restores everything instantly
│   │   │   ├─ linkMode + onCreateLink + onDeleteLink + canConnect (optional) — drag-to-connect authoring from ANY handle ("draw" | "connect"; links join at the closest FACING handle pair; canConnect(from, to) vetoes BEFORE the draft snaps and fails OPEN; dropping on the SOURCE node commits an ↻ in-place transition; the drag previews the spec-compliant H/V route; Del deletes the selected link)
│   │   │   ├─ onAddLane (optional) — its presence renders the dashed full-height "+ LANE" tail affordance (click fires it); absent ⇒ no affordance
│   │   │   ├─ onRenameLane + onDeleteLane (optional) — lane editing: headers become click-to-edit (Enter/blur commits → { key, label }); × beside each header deletes (lane key). The HOST owns the cascade — the canvas stays safe either way: states referencing a missing lane fall into the LAST lane, dangling links render as neg-dashed ghosts (orphans stay visible)
│   │   │   ├─ onAddState + onEditState + onMoveState (optional) — state editing: hovering a lane band reveals the dashed node-footprint "+ STATE" ghost parked one row below its last node (click → inline editor, code auto-focused + label; ⏎ commits { lane, key, label }, esc/blur-empty dismisses; the committed state starts unconnected); double-click a node opens the same editor ({ key, code, label } — rekeying links is the host's call); dragging a node across lanes highlights candidate bands and drops fire { key, lane }
│   │   │   ├─ readOnly (optional) — runtime edit gate: true suppresses every authoring affordance (connect gesture, Del, + LANE) WITHOUT unwiring callbacks (feed a permission / published-mode flag); read-only is otherwise the DEFAULT — each edit channel exists only when its callback / mode is provided; selection + hover always stay (inspecting isn't editing)
│   │   │   └─ density / height / maxHeight (optional) — rhythm + uniform sizing (#320); default content-sized
│   │   └─ Factories: (tables are plain rows + mappers; closed-set fields are typed values via Flowchart.Types.* — State, Link, Lane, Trigger, Evidence, Kind, Orientation, LinkMode, LinkCreateEvent)
│   ├─ <Map markers={…} center={Map.at(lat,lng)} zoom={n} /> — interactive geographic basemap; read-only / selection-only
│   │   ├─ Props:
│   │   │   ├─ markers + center + zoom (required) — marker rows + initial camera
│   │   │   ├─ marker / area / line / label (optional) — row mappers for each table (omit when rows are already Map.Types.* values)
│   │   │   ├─ areas / lines / labels (optional) — the additional overlay tables
│   │   │   ├─ hexes (optional) — H3 lattice + per-cell detail (Map.hex(…))
│   │   │   ├─ overlays (optional) — positioned East children (Map.overlay(child, { align }))
│   │   │   ├─ tiles (optional) — basemap (default Map.carto("positron"))
│   │   │   ├─ minZoom / maxZoom / lodZoom / fitBounds (optional) — zoom clamps, detail-LOD threshold, camera framing
│   │   │   ├─ onAreaClick / onMarkerClick / onZoom / onSelect (optional) — interaction callbacks
│   │   │   └─ scrollWheelZoom / attributionPrefix / height (optional) — chrome
│   │   └─ Factories:
│   │       ├─ Map.at(lat, lng) — a coordinate; Map.point(…) / Map.bounds(…) — flyTo targets
│   │       ├─ Map.carto(style) / Map.osm() / Map.tile(url, …) — basemaps
│   │       ├─ Map.hexDisk(…) / Map.cells(…) / Map.polygon(…) — H3 shapes; Map.hex(…) — the hex layer
│   │       ├─ Map.marker(…) / Map.area(…) / Map.line(…) / Map.label(…) — overlay values
│   │       ├─ Map.solid() / Map.dashed() — line styles
│   │       └─ Map.overlay(child, { align }) — a positioned East child
│   ├─ <Library id="people" data={rows} item={r => ({…})} /> — draggable palette (DnD source; targets list its id in their `sources`) under ONE toolbar row; a card drags by pointer or by KEYBOARD, announced — see the Drag and drop pattern. `variant="gallery"` draws the same cards LARGE, each with its `media` — any UI component — the library a person browses: a page library (each page's `<SnapGrid variant="wireframe">`), a report catalog (a `<Sparkline>` each)
│   │   ├─ Props:
│   │   │   ├─ id (required) — DnD source identity
│   │   │   ├─ data (required) — item rows
│   │   │   ├─ item (required) — row mapper to { key, label, sublabel?, icon?, status?, trailing?, draggable?, filtered?, placed?, media?, avatar?, byline?, action? } — `trailing` a glyph at the card's right edge (`some(Library.glyph(…))`: a lock on something fixed, a dot for a status); `placed` draws the card in its placed state, the brand border and tint (the item already on the target — say how often in its sublabel). A gallery card's own: `media` (any UIComponent, drawn inert — the card is the click target), `avatar` (the name whose initials the foot's avatar shows), `byline` (the foot's line after it), `action` (a label in the link voice at the foot's end, "Open in builder →", which a click on the card follows — `onCardClick`); a gallery card's `trailing` sits at its foot's end
│   │   │   ├─ variant (optional) — "compact" (default; a line per card — the palette a surface drags from) | "gallery" (a large card per item: its `media` above the face or at its start, the name with its status as a dot and the word, the meta line, and a foot holding the `avatar`, `byline` and `action`). A compact Library refuses the gallery's fields at build, naming each
│   │   │   ├─ layout (optional, gallery) — the layout a gallery starts in: "grid" (default; the style's `columns` across, fewer as the Library narrows, one on a phone) | "list" (a card per row, its media at the start). The toolbar's Grid · List switch changes it, and the viewer's pick is kept with the toolbar under the storage key; an expression that moves moves it
│   │   │   ├─ toolbar (optional) — true (default) | false: no toolbar row, the cards sitting in their host's frame — for a host whose ONE toolbar serves several Libraries (a page library's Templates and Pages): the host narrows `data` itself and gives a gallery its `layout`, which the Library then follows. The options whose controls live in the toolbar — `search`, `groupBy`, `filters`, `dimensions`, `hint` and `slice` — are refused with it at build, naming each
│   │   │   ├─ hint (optional) — a caption at the toolbar row's end (the first thing a narrow row folds away)
│   │   │   ├─ dimensions + defaultDimensions (optional) — toolbar-toggleable card facts ({ kind: "meter" | "chips" | "text", … }); initially-visible keys (default first two)
│   │   │   ├─ groupBy (optional) — [{ key, label, value, summary? }] GROUP BY options (omit for flat)
│   │   │   ├─ filters (optional) — [{ key, label, values: r => Array<String> }] the toolbar's Filter menu: each facet's distinct values, in the order the cards first hold them (one value for a single-valued facet like a category, several for its tags); checked values keep the cards holding one of them (OR within a facet, AND across facets), the rest hide as the search's do and the group counts follow; the trigger counts the checked values ("Filter · 2"), and the footer's Show all clears them with the search
│   │   │   ├─ search (optional) — filter-text accessor; unmatched cards hide (footer shows hidden count + Show all)
│   │   │   ├─ noun (optional) — { singular, plural } what the items are called — the search box counts them ("Search 47 components…"; default item / items)
│   │   │   ├─ onCardClick (optional) — fn(key) => Null when a card is clicked (a drag never clicks); a card that cannot be dragged is then a button, so Enter / Space click it too
│   │   │   ├─ addLabel + onAdd (optional) — footer action; a gallery's dashed last card
│   │   │   ├─ slice + affordances (optional) — bound slice chrome (default ["filter","search"])
│   │   │   └─ style (optional) — { height, maxHeight, virtualization, columns?, mediaPlacement?, mediaSize? } — the last three a gallery's (refused on a compact Library): `columns` its cards across in the grid (Integer, default 3), `mediaPlacement` "top" (default, above the face) | "start" (at its start), `mediaSize` a CSS length — the media's height on top, its width at the start ("156px"). A gallery mounts every card (no virtualization)
│   │   ├─ The toolbar: ONE row, the shared toolbar every toolbar host lays its chrome in — the search box (⌘ / focuses it) and GROUP · …, then at its end the `hint`, SECONDARY, FILTER and a gallery's Grid · List switch (a radio group: one tab stop, ← / → move and pick); with `slice` chrome the rail's affordances lead the same row, a `search` among them in place of the built-in one. A narrower row folds on one ladder: the rail first, then the hint goes, SECONDARY and FILTER fold to their icons, then GROUP does, and last the search box narrows and drops its key cap; the switch never folds. `toolbar: false` draws no row
│   │   └─ Factories:
│   │       ├─ Library.status(label, tone, ring?) — a card status: a compact card's chip, a gallery card's dot and word (tone = a status token; see the Statuses branch); `ring` draws the dot open, a state not reached yet (a Draft beside a Live)
│   │       └─ Library.glyph(icon, label, tone?) — a card's trailing glyph: an FA icon, the words it says (its accessible name and tooltip), and an optional status tone (else the card's quiet ink, the brand ink while placed)
│   ├─ <Deck data={rows} statuses={Deck.statuses({…})} card={r => ({ key, title, status, metrics, fill })} /> — grouped mini-card board (display, NOT a drag source — that's Library); every card carries an EXPLICIT status colour from the deck's STATUS REGISTRY (solid tag + dot, faint face wash, fill-bar colour); two card states: the LIST face + a VIEW state in an anchored POPOVER CARD whose head is inherited from the face
│   │   ├─ Props:
│   │   │   ├─ data (required) — array of rows to project into cards
│   │   │   ├─ card (required) — accessor r => face fields: key (required; identity reported by onCardClick/onOpen) · title (required; identity line) · sublabel (muted mono-uppercase second line) · icon (FA solid name) · status (a KEY into `statuses` — paints the tag/wash/fill) · metrics ([Deck.metric(…)] raw-value strip) · fill ({ value, max, format? } status-coloured bar; format = shared spec over value OR (value, max) => String accessor; omitted → percentage) · facts ([Deck.meter/chips/text(…)]) · filtered (render dimmed — the Slice.partition "keep the excluded" feed)
│   │   │   ├─ statuses (optional) — the status registry, Deck.statuses({…}); card `status` fields reference entries by key
│   │   │   ├─ groupBy (optional) — [{ key, label, value, summary? }] named GROUP BY toolbar + None; grouping by the status accessor decorates group heads with the registry swatch + hint
│   │   │   ├─ layout (optional) — "grid" (default; wrap auto-fill minmax(minCardWidth,1fr) → one phone column) | "list" (full-width rows)
│   │   │   ├─ onClick (optional) — r => <…/> the STICKY popover's BODY (tap opens; Esc / outside / × close); the head — title, sublabel, icon, status tag + wash — is INHERITED from the card face
│   │   │   ├─ onHover (optional) — r => <…/> the transient hover peek's body (hover-capable pointers only, intent-delayed)
│   │   │   ├─ onOpen (optional) — fn(key) => Null; fires when a card's popover opens
│   │   │   ├─ onClose (optional) — fn() => Null; fires once per popover close (Esc / outside / ×)
│   │   │   ├─ onCardClick (optional) — fn(key) => Null; cards are tap targets even without popover content
│   │   │   ├─ render (optional) — r => <…/> fully custom card body beneath the structured face
│   │   │   ├─ footer (optional) — [{ label, value }] board-foot key/value stats
│   │   │   ├─ legend (optional) — boolean; renders the registry legend (swatch + label + hint)
│   │   │   ├─ slice + affordances (optional) — slice={handle} + affordances (default ["filter","search"] — brush/legend/breakdown rejected) mounts the rail + count footer; feed data via Slice.rows (remove) or Slice.partition → filtered (dim); filtering/search flow through the slice interface like Table — no bespoke search
│   │   │   └─ style (optional) — { height, maxHeight, minCardWidth, virtualization }; height/maxHeight make the board its own (virtualized) scroll region, flat AND grouped
│   │   └─ Factories:
│   │       ├─ Deck.statuses({ key: { label, color, pulse?, hint? } }) — build the status registry; color is a standard status token "success"|"warning"|"danger"|"info"|"neutral" OR any custom CSS colour (the faint face tint is derived); pulse animates the tag dot (active states); hint feeds the legend + group heads
│   │       ├─ Deck.metric(label, value, { format?, warn? }) — one metric cell: the RAW Float (or Option Float) value plus a shared format — a Chart.format.* spec or a v => String accessor (same vocabulary as chart axes); a none value renders "—"; warn paints the value in the danger tone
│   │       ├─ Deck.Readout([{ label, value, format?, unit?, warn? }]) — popover readout rail: a bordered grid of big mono values with unit suffixes (raw values + shared format, like Deck.metric)
│   │       ├─ Deck.Rows([{ label, value }]) — popover key/value detail rows (mono-uppercase keys, body-voice values)
│   │       ├─ Deck.Note(text) — popover dashed-top mono footnote
│   │       ├─ Deck.meter(label, value, max, text) — card-face meter fact (utilisation bar + right-aligned reading)
│   │       ├─ Deck.chips(label, values) — card-face chip-set fact
│   │       └─ Deck.text(label, text) — card-face dim text fact
│   ├─ <ValueTree value={anyEastValue} /> — editable tree of ANY East value, materialized from its STATIC type at authoring time (structs/arrays/dicts/options/variants → branches; primitives → typed editable leaves; sets/blobs/vectors/matrices/refs/fns → read-only summaries; non-string-keyed dict entries label as field summaries and edit their VALUES — entry add/remove stays string-keyed)
│   │   ├─ Props:
│   │   │   ├─ value (required) — the East value to render; omit every callback for a read-only inspector
│   │   │   ├─ onUpdate (optional) — fn([T], Null) whole-value handler: receives the WHOLE value with the edit applied (the factory rebuilds it for you); sync or async
│   │   │   ├─ at (optional) — [ValueTree.at(T, probe, fn)] scoped subtree handlers; deepest matching scope wins, unmatched edits bubble to onUpdate
│   │   │   ├─ onEdit (optional) — RAW path callback (escape hatch; overrides per event): fn(path, leaf) => Null leaf edit
│   │   │   ├─ onInsert (optional) — RAW append/insert: array append paths end with an `append` step, dict adds carry the new `key`
│   │   │   ├─ onRemove (optional) — RAW remove with the element/entry path
│   │   │   ├─ onTag (optional) — RAW variant switch + option set/clear ("some"/"none")
│   │   │   └─ style (optional) — { height, maxHeight, openDepth, toolbar }; bounded trees virtualize rows; openDepth = how many levels start expanded (default 1; 0 = all collapsed), toolbar adds a Collapse all / Expand all header row; Alt-click any twist collapses that whole subtree
│   │   └─ Factories:
│   │       ├─ ValueTree.at(T, p => p.machines.entry("m1"), fn([SubT], Null)) — a typed scope: struct fields as properties, .item(i), .entry(k), .some()
│   │       ├─ ValueTree.zero(T) — the default element for inserts (delegates to East defaultValue)
│   │       └─ ValueTree.Types.{Root, Node, Path, Step, Leaf, Style} — the East types for RAW callbacks
│   ├─ <Roster people={…} shifts={…} id person={…} shift={…} /> — people × days-of-week shift grid; joins the two flat tables by person key
│   │   └─ Props:
│   │       ├─ people + shifts + id (required) — the two tables + DnD target identity
│   │       ├─ person (optional) — row mapper to { key, label, sublabel? } (omit when already Roster.Types.Person)
│   │       ├─ shift (optional) — row mapper to { key, person, day, hours|label, state } (state is a PlannerStateType — Roster.Types.State)
│   │       ├─ mode (optional) — published (default) | edit
│   │       ├─ days (optional) — day columns in order (default Mon–Sun)
│   │       ├─ personHeader / personWidth (optional) — frozen column header (default "Operator") + CSS width (default 150px)
│   │       ├─ sources + onDrag + canDrop (optional) — DnD target (add/move/remove funnel); canDrop = fn(DragEvent) => Bool IR veto (⊘ over vetoed cells); a remove-capable drag raises the shared trash sink (drop = remove/trash)
│   │       ├─ onSelect / onAccept / onAddAt (optional) — cell click / ghost-shift accept / empty-cell add (CellRef payloads); granularity contract: onAccept(CellRef) resolves ONE ghost, review.onApprove({rowIndex}) signs off the LINE (interplay host-owned)
│   │       ├─ review (optional) — row-level Decision column + foot (+ person status/approval fields)
│   │       ├─ summary (optional) — status-strip text (dirty / ghost counts)
│   │       └─ density / height / maxHeight (optional) — rhythm + uniform sizing (#320)
│   ├─ <Board areas={…} shifts={…} people={…} assignments={…} id … /> — single-day areas × shifts assignment grid; cells stack MULTIPLE person chips, faces joined to people by person key
│   │   └─ Props:
│   │       ├─ areas + shifts + people + assignments + id (required) — the four tables + DnD target identity
│   │       ├─ area / shift / person (optional) — entity row mappers to { key, label, sublabel? }
│   │       ├─ assignment (optional) — row mapper to { key, person, area, shift, state }
│   │       ├─ requirements + requirement (optional) — coverage rows + mapper to { area, shift, required } (n/required numerals + open-slot placeholders — Font Awesome's circle-plus — under/over tones)
│   │       ├─ mode (optional) — published (default) | edit
│   │       ├─ areaHeader / areaWidth (optional) — frozen column header (omit = blank; zero baked copy) + CSS width (default 150px)
│   │       ├─ maxVisible (optional) — per-cell chip cap before the +N overflow popover
│   │       ├─ sources + onDrag + canDrop (optional) — DnD target (add/move/remove); canDrop = fn(DragEvent) => Bool veto (⊘ while dragging; duplicate-person guard stays built in)
│   │       ├─ canAssign (optional) — DEPRECATED sugar fn(person, area, shift) => Bool the factory compiles into canDrop
│   │       ├─ onSelect / onAccept / onAddAt (optional) — cell click / ghost accept / open-slot click (CellRef payloads)
│   │       ├─ review (optional) — { summary?, onApproveAll, onRejectAll, onRerun? } batch commitBar foot only (per-row fields unused in v1, the factory warns); ghost onAccept unchanged
│   │       ├─ summary (optional) — status-strip text (open / proposed counts); toolbar chrome is page composition
│   │       └─ density / height / maxHeight (optional) — rhythm + uniform sizing (#320)
│   ├─ <Blend targets={…} config={{…}} /> — blend / batch assembly surface; pairs with a Library; target count picks the mode: 1 single | 2 compare (derived diff / Δ table) | 3+ portfolio
│   │   ├─ Props:
│   │   │   ├─ targets + id (required) — target rows + DnD target identity
│   │   │   ├─ target (optional) — row mapper to Blend target fields (omit when already Blend.Types.Target)
│   │   │   ├─ sources (optional) — Library ids accepted for add-drops
│   │   │   ├─ diff (optional) — compare mode: metric keys for the foot table (default all); verdict (optional) — compare verdict line
│   │   │   ├─ onDrag + canDrop (optional) — add/remove drag funnel + IR drop veto (⊘)
│   │   │   ├─ onAmountChange (optional) — allocation amount edits
│   │   │   └─ onAction (optional) — panel actions; the action foot rides the shared commitBar (Apply = approve-primary, Discard = reject-danger, Reset plain — apply/discard are the panel-scope review verbs)
│   │   └─ Factories:
│   │       ├─ Blend.allocation({ source, amount, pinned?, state? }) — one allocation line
│   │       └─ Blend.metric({ key, label, value, numeric?, model?, band? }) — one target metric
│   ├─ <Slice.Rail slice={slice} affordances={[…]} /> — shared narrowing chrome over one bound dataset; feed consumers via Slice.rows
│   │   ├─ Props:
│   │   │   ├─ slice (required) — the bound handle from Slice.bind
│   │   │   ├─ affordances (optional) — ["filter","search","range","breakdown","cohort","presets","brush","legend"]; legends are explicit-only (list "legend" or compose <Slice.Legend>)
│   │   │   ├─ persist (optional) — "local" | "session" | "url" opts the state into reload-surviving / shareable-link storage
│   │   │   └─ brush (optional) — the brush strip is rich by default (the range field's format drives the axis labels; a self-excluding count histogram shows the row distribution); brush={{ axis?, count?, buckets? }} opts down to the bare track. The applied window is a full brush selection: drag its body to slide (width preserved), an edge to resize, empty track to draw (also the Plan's horizon-brush gesture)
│   │   ├─ Nested tags: <Slice.Filter/Search/Range/Breakdown/Legend/Cohort/Presets/Summary slice={slice} /> — per-affordance chrome; <Slice.Cohort mode="toggle"|"manage" allowCreate? group?> (cohorts toggle on chip click; cohorts sharing a `group` render as one captioned run — a FAMILY of alternatives: active members OR within a family, families AND with each other and with standalone cohorts; an empty family member hides on the preset bar unless on; `group="…"` shows one family alone; <Slice.Presets> = toggle-only preset bar); <Slice.Legend> = facet bar (click = in-set multi-select over self-excluding slice.facetGroups(); mode="visibility" = eye rail); Summary/Filter footers read "N of M"
│   │   └─ Factories:
│   │       ├─ Slice.bind([Row], key, config, initialState, data, searchMatcher?) — bind a dataset to a slice key (searchMatcher = optional Option of a per-row match fn; pass `none` for the config-driven default)
│   │       ├─ Slice.config(Row, { fields, rangeFieldId?, searchFieldIds?, breakdownFieldIds? }) — fields: { id: { label, hints?, format? } }; format reuses the shared Chart.format vocabulary (see the Formats branch)
│   │       ├─ Slice.state({…}) — the initial slice state; `cohorts: [{ id, name, filters, group? }]` takes the family as a bare string (omit for a standalone cohort)
│   │       ├─ Slice.rows([Row], slice) — the narrowed feed (excluded rows gone)
│   │       ├─ Slice.partition([Row], slice) — the FULL set tagged [{value, matched}] (the "keep the excluded" feed — drive a de-emphasis effect from `matched`)
│   │       ├─ Slice.apply.where / .matches / .breakdown — the pure filter engine (string ops eq/neq/in/notIn/contains/matches/startsWith/endsWith/isEmpty/isNotEmpty; integer in; datetime between)
│   │       └─ slice.toggleFilter(pred) — idempotent single-predicate toggle for custom wiring; Range picker presets anchor to the DATA's date extent (clamped to now for live data) and pin concrete windows; an All chip clears the range; programmatic datetimePreset seeds stay rolling/wall-clock
│   └─ <Pagination> — page-number control
│       └─ Props:
│           ├─ page / pageSize / count (required) — current page, rows per page, total rows
│           ├─ onPageChange (required) — fn(newPage) => Null
│           ├─ siblings / boundaries (optional) — ellipsis control
│           └─ size / variant / activeBackground / activeColor + COLOR overrides (optional)
│
├─ Charts (visualize data) — layers are a config array of factory values, never child tags
│   ├─ <Chart layers={…} /> — assemble mark + annotation layers; x-scale inferred from the x accessor type (String → band, number → linear, DateTime → time)
│   │   ├─ Props:
│   │   │   ├─ layers (required) — array of Chart.Line/Column/Bar/Area/Scatter/Band/refLine/refBand/refDot/Series values
│   │   │   ├─ x / y / y2 (optional) — axis options: { label?, format? (shared spec — see the Formats branch), domain?, scale?, numTicks?, tickValues?, hideTicks?, hideLine?, tickStyle?, titleStyle?, titleGap? }
│   │   │   │     tickValues (#318): floats on a linear axis ([0,1,2,…]) or DateTime[] on a time axis (pin ticks to exact instants, rendered through the date format); Date ticks on y/y2 are a build-time error
│   │   │   │     tickStyle/titleStyle (#315): { fontSize?, fontFamily?: "sans"|"serif"|"mono", fontWeight?, color?, letterSpacing? } — restyle ticks/captions over the spec chrome
│   │   │   │     titleGap (#327): px between ticks and caption — widens that axis's OWN margin band, never the shared plot gutter, so nudging a title can't shift a gutter-aligned plot lane
│   │   │   ├─ height (optional) — px, or "fill": the parent's height, never less than the chart's natural height — what a parent sized by its content (an auto SnapGrid tile) shows it at; width (optional) — px (omit for responsive)
│   │   │   ├─ grid / legend / tooltip (optional) — background gridlines (default on) / colour-matched legend / hover tooltip
│   │   │   ├─ stackOffset (optional) — "none" | "expand" (percent stacking)
│   │   │   └─ slice + affordances (optional) — bound slice chrome (default ["breakdown","range"]; the brush sets the slice's range)
│   │   └─ Factories:
│   │       ├─ Chart.Line / Chart.Column / Chart.Area / Chart.Scatter(rows, encoding, style?) — marks; encoding: { x, y } · { x, y, by } (split) · { x, columns: { Name: r => r.field } } (wide)
│   │       ├─ Chart.Bar(rows, { x: numeric, y: category }, style?) — HORIZONTAL bars (band y-axis, linear x; flips the whole frame; same { x, y, by } / { y, columns } splits; can't mix with vertical marks); the left margin grows to hold the widest category label, so a parent that clips never cuts one
│   │       ├─ Chart.Band(rows, { x, low, high }, style?) — filled range (e.g. confidence band)
│   │       ├─ mark style (all optional) — { key (legend label), color, curve, width, dash, dots, fillOpacity, opacity, legend, tooltip, stack (group id — layers sharing one stack accumulate), axis: "left"|"right", order (draw order) }; Scatter adds size (uniform px radius; a per-point size accessor overrides)
│   │       ├─ Chart.refLine({ y }|{ x }, label?, dash?) — reference line
│   │       ├─ Chart.refBand({ y: [lo, hi] }|{ x: [lo, hi] }, label?) — reference band
│   │       ├─ Chart.refDot({ x, y, label? }) — reference marker
│   │       ├─ Chart.format.{ number, currency, percent, compact, date, time, datetime } — the SHARED format specs (see the Formats branch)
│   │       └─ Chart.Series(slice, { x, value, mark? }) — a slice-bound layer (x/value are slice field ids; mark: "line"|"bar"|"area"|"scatter", default line)
│   └─ <Sparkline> — inline trend beside a <Stat>
│       └─ Props:
│           ├─ data (required) — the values
│           ├─ type (optional) — line | area
│           └─ color / height / width (optional)
│
├─ Display (show information)
│   ├─ <Badge> — mono uppercase micro-label (status / taxonomy); stays a tier smaller than tags
│   │   └─ Props: variant (solid|subtle|outline) / colorPalette / size / density / borderRadius / borderWidth / borderStyle / justifyContent / alignItems + BOX bag + COLOR overrides (all optional; children required)
│   ├─ <Tag> — operator-set keyword / filter pill (body font)
│   │   └─ Props:
│   │       ├─ children (required) — the tag text
│   │       ├─ closable + onClose (optional) — × affordance + callback
│   │       └─ variant / colorPalette / size / density / borderRadius / borderWidth / borderStyle + BOX bag + COLOR overrides (optional)
│   ├─ <Avatar> / <AvatarGroup> — user avatar / overlapping cluster with "+N more"
│   │   └─ Props:
│   │       ├─ Avatar: src (image URL) / name (initials fallback) / variant / colorPalette / size / density / borderRadius + BOX bag + COLOR overrides (all optional)
│   │       └─ AvatarGroup: children (required) — the avatars; max (optional) — overflow threshold (+N after); size / density / borderColor (optional)
│   ├─ <Image> — raster/vector image or logo
│   │   ├─ Props:
│   │   │   ├─ source (required) — Image.url(u) | Image.dataUri(s) | Image.blob(bytes, "png"|"svg"|…)
│   │   │   ├─ fit (optional) — object-fit: contain | cover | fill | none | scaleDown
│   │   │   ├─ aspectRatio / alt / borderRadius / background (optional) — framing + accessibility
│   │   │   └─ …plus BOX bag
│   │   └─ Factories:
│   │       ├─ Image.url(u) — hosted image
│   │       ├─ Image.dataUri(s) — self-contained base64
│   │       └─ Image.blob(bytes, format) — raw BlobType bytes → revocable object URL
│   ├─ <Icon> — a Font Awesome solid icon (East UI draws no other set, #1263)
│   │   └─ Props:
│   │       ├─ prefix / name (required) — the icon: "fas", the solid set, and its name; another prefix is refused at build, naming the icon
│   │       ├─ variant (optional) — solid, the one set
│   │       ├─ size (optional) — xs…2xl; label (optional) — accessible name
│   │       └─ colorPalette / borderRadius + BOX bag + COLOR overrides (optional)
│   ├─ <Kbd> — keyboard-shortcut chip (⌘ K)
│   │   └─ Props: children (required); variant / size / density / colorPalette / shadowColor + COLOR overrides (optional)
│   ├─ <Stat> — metric tile with label / value / change indicator
│   │   └─ Props:
│   │       ├─ label (required) — metric caption; value (required) — the raw value (Float / Integer / String)
│   │       ├─ format (optional) — a Format.* spec over a numeric value: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }), Format.Compact(), … (see the Formats branch)
│   │       ├─ helpText (optional) — caption beneath the value
│   │       ├─ baseline / delta / info (optional) — secondary line / change pill / ⓘ ToggleTip trigger (UIComponents)
│   │       ├─ indicator (optional) — "up"|"down"|"flat" or { direction, sentiment?: positive|negative|neutral, icon? }
│   │       ├─ density / size (optional) — rhythm + size preset
│   │       └─ valueColor / labelColor / helpTextColor / indicatorColor (optional)
│   ├─ <MetricChip> — compact mono delta chip
│   │   └─ Props:
│   │       ├─ children (required) — the value text; tone (required) — positive | negative | neutral | info (drives the palette)
│   │       ├─ unit (optional) — suffix ("%", "ms"); icon (optional) — leading icon
│   │       ├─ emphasis (optional) — subtle | solid | outline
│   │       └─ density / size / borderRadius / iconColor + COLOR overrides (optional)
│   ├─ <Meter> — horizontal capacity bar with sentiment colour (never a bare bar — value text on by default)
│   │   └─ Props:
│   │       ├─ value (required) — current value; max (optional) — full-bar value (default 100)
│   │       ├─ tone (optional) — a status token driving the fill (see the Statuses branch)
│   │       ├─ label (optional) — UIComponent beside the bar; showValue (optional) — trailing mono percent (default true)
│   │       └─ density / thickness / borderRadius / fillColor / trackColor / labelColor (optional)
│   ├─ <SegmentedMeter> — multi-segment meter (e.g. decomposed confidence)
│   │   └─ Props:
│   │       ├─ segments (required) — [{ value, tone?, color?, label? }]
│   │       ├─ caption (optional) — UIComponent beside the bar; max (optional) — total reference (default sum)
│   │       ├─ labels (optional) — inside | outside | none
│   │       └─ density / thickness / borderRadius / trackColor / captionColor / labelColor (optional)
│   ├─ <BarStrip items={[…]} /> or <BarStrip data={rows} item={r => ({ label, value, tone? })} /> — ranked horizontal-bar list (axis-free; fits inside a <Stat>)
│   │   └─ Props:
│   │       ├─ items (required, the written form) — [{ label (UIComponent), value, tone?, color?, trailing? }]
│   │       ├─ data + item (required, the data form — instead of items) — an East array of the host's rows + a row mapper to the same bar fields, reified ONCE into an East function every row maps through: bars computed in East (a groupSum's totals, `.toArray`'d), which a written array cannot hold
│   │       ├─ showValues (optional) — trailing value text (default true)
│   │       ├─ sort / maxItems (optional) — sort + row cap, applied by the renderer to written and mapped bars alike
│   │       └─ density / orientation / thickness / borderRadius / trackColor / labelColor / valueColor (optional)
│   ├─ <EditableChip> — chip whose text becomes inline input on click
│   │   └─ Props:
│   │       ├─ children (required) — chip text
│   │       ├─ onClick (optional) — activation callback; trigger (optional) — trailing icon (default chevron)
│   │       └─ disabled / density / size / borderRadius / triggerIconColor + COLOR overrides (optional)
│   ├─ <ChipRail> — horizontal rail of mixed chip-shaped children (<Tag>/<Badge>/<MetricChip>/<Avatar>/…); provides its density to the children
│   │   └─ Props:
│   │       ├─ children (required) — the chips
│   │       ├─ separator (optional) — dot | line; labels (optional) — per-chip labels
│   │       ├─ overflow (optional) — behaviour when the rail can't fit every chip (⋯ menu)
│   │       └─ density / separatorColor / overflowTriggerColor / background (optional)
│   └─ <Trace> — read-only inline heatmap (tracks × steps) with a now-line; sits flush beside a <ChipRail> at the same density in table cells
│       └─ Props:
│           ├─ tracks (required) — [{ name, values }] (heat normalises per track's own min/max)
│           ├─ now (optional) — step index of the now-line; [0, now) measured, [now, end) predicted; omit for measured-only
│           ├─ scale (optional) — heat colour encoding; future (optional) — how predicted steps are distinguished
│           ├─ axis (optional) — per-step labels (ruler at comfortable density, tooltips always)
│           ├─ density / brandColor / nowLineColor / labelWidth (optional) — rhythm + colour + name-gutter width
│           └─ plotGutter (optional) — shared gutter (#147): pins the step lane so a Trace stacked under a Chart lines up (left supersedes labelWidth)
│
├─ Feedback (status & async signals)
│   ├─ <Banner> — page-spanning notice
│   │   └─ Props:
│   │       ├─ status (required) — info | warning | success | error | neutral | change | guard | stale
│   │       ├─ title (required) — string or UIComponent
│   │       ├─ description / actions (optional) — body + trailing actions
│   │       ├─ icon / showIcon (optional) — explicit icon override / hide the paired icon
│   │       ├─ dismissible + onDismiss (optional) — close affordance
│   │       └─ variant / size / iconColor / accentColor + COLOR overrides (optional)
│   ├─ <Status> — dot + uppercase label (no fill)
│   │   └─ Props:
│   │       ├─ label (required) — string or UIComponent
│   │       ├─ value (optional) — success | warning | danger | info | neutral (default neutral; see the Statuses branch)
│   │       ├─ pulsing (optional) — animate the dot
│   │       ├─ ring (optional) — an open ring in place of the filled dot: a state that is not live yet (a Draft beside a Live)
│   │       ├─ icon / showIcon (optional) — icon override / hide
│   │       └─ size / dotColor + COLOR overrides (optional)
│   ├─ <Progress> — linear progress bar
│   │   └─ Props:
│   │       ├─ value (required) — current value
│   │       ├─ min / max (optional) — range (defaults 0–100)
│   │       ├─ indeterminate (optional) — unknown-% mode
│   │       ├─ label / valueText / showValue (optional) — captions
│   │       ├─ estimatedDuration / startedAt (optional) — drive an ETA display
│   │       ├─ tone (optional) — brand | pos | neg (bsys-restricted fill tone)
│   │       └─ variant / size / striped / animated / trackColor / fillColor / labelColor (optional)
│   ├─ <Skeleton> — shimmer placeholder
│   │   └─ Props:
│   │       ├─ shape (required) — text | rect | circle
│   │       ├─ lines (optional) — line count (text shape); count (optional) — repeat in a VStack
│   │       └─ width / height / fontSize / background / shimmerColor (optional)
│   └─ <EmptyState> — zero-data state
│       └─ Props:
│           ├─ title (required) — string or UIComponent
│           ├─ icon (optional) — its one mark, a Font Awesome solid icon ({ prefix: "fas", name: "inbox" }); a text `glyph` is removed (#1263) and refused at build
│           ├─ description / actions (optional) — body + action row
│           └─ size / iconColor + COLOR overrides (optional)
│
├─ Disclosure (reveal / switch content) — item metadata is config, not child tags
│   ├─ <Tabs items={…}> — content-panel switcher
│   │   ├─ Props:
│   │   │   ├─ items (required) — array of Tabs.Item(…)
│   │   │   ├─ value / defaultValue (optional) — controlled / initial selected tab
│   │   │   ├─ onValueChange (optional) — fn(String) => Null
│   │   │   ├─ variant (optional) — line | plain; size — sm | md | lg
│   │   │   ├─ orientation / activationMode / fitted / justify (optional) — layout + keyboard behaviour
│   │   │   ├─ lazyMount / unmountOnExit (optional) — panel mount policy
│   │   │   └─ colorPalette / listBackground / indicatorColor / activeTriggerColor / inactiveTriggerColor / contentBackground (optional)
│   │   └─ Factories:
│   │       └─ Tabs.Item(value, title, body, { disabled? }) — one tab
│   ├─ <Accordion items={…}> — single/multi-open sections
│   │   ├─ Props:
│   │   │   ├─ items (required) — array of Accordion.Item(…)
│   │   │   ├─ multiple / collapsible (optional) — allow multiple open / allow all closed
│   │   │   ├─ value / defaultValue / onValueChange (optional) — controlled expansion
│   │   │   └─ variant / size / triggerBackground / triggerHoverBackground / contentBackground + COLOR overrides (optional)
│   │   └─ Factories:
│   │       └─ Accordion.Item(value, trigger, children, { meta?, disabled? }) — one section (meta = right-aligned header caption)
│   ├─ <Carousel> — paginated slide carousel
│   │   └─ Props:
│   │       ├─ children (required) — the slides
│   │       ├─ index / defaultIndex / onIndexChange (optional) — controlled slide position
│   │       ├─ slidesPerView / slidesPerMove / spacing (optional) — layout
│   │       ├─ loop / autoplay / allowMouseDrag (optional) — behaviour
│   │       ├─ showIndicators / showControls (optional) — dots + prev/next chrome
│   │       └─ orientation / padding / indicatorColor / activeIndicatorColor / controlColor / controlBackground (optional)
│   ├─ <Collapsible> — single show/hide section
│   │   └─ Props:
│   │       ├─ trigger (required) — always-visible header (string or UIComponent); children (required) — the body
│   │       ├─ defaultOpen / onOpenChange (optional) — initial state + toggle callback
│   │       └─ triggerColor / contentColor + COLOR overrides (optional)
│   ├─ <SegmentGroup items={…}> — compact single-select mode switcher (no panels)
│   │   ├─ Props:
│   │   │   ├─ value (required) — selected segment; items (required) — array of SegmentGroup.Item(…)
│   │   │   ├─ onChange (optional) — fn(String) => Null
│   │   │   └─ size / colorPalette / orientation / activeBackground / activeColor / inactiveColor + COLOR overrides (optional)
│   │   └─ Factories:
│   │       └─ SegmentGroup.Item(value, label, { disabled? }) — one segment
│   ├─ <OptionList> — keyboard-navigable single-select list (rows + description)
│   │   ├─ Props:
│   │   │   ├─ options (required) — array of OptionList.Option(…)
│   │   │   ├─ selectedId (optional) — currently-selected row; onSelect (optional) — fn(id) => Null
│   │   │   └─ itemColor / itemHoverBackground / selectedBackground / borderColor / impactColor (optional)
│   │   └─ Factories:
│   │       └─ OptionList.Option(id, label, { description?, trailing?, disabled? }) — one row (trailing = e.g. impact chip)
│   ├─ <Story.Root steps={…}> — scroll-driven narrative; prose rail + sticky stage keyframes
│   │   ├─ Props:
│   │   │   ├─ steps (required) — array of Story.Step(…)
│   │   │   ├─ layout (optional) — rail-left | rail-right | stacked
│   │   │   ├─ stepLength (optional) — compact | default | long (scroll runway per step)
│   │   │   ├─ stageHeight / height (optional) — stage sizing
│   │   │   ├─ active / progress (optional) — State.bind bindings for narrative position + within-step scrub
│   │   │   ├─ activeStep (optional) — static override: render one deterministic keyframe by step id
│   │   │   ├─ title (optional) — renders the Story.Progress chrome row
│   │   │   └─ onStepEnter / onStepExit (optional) — step activation callbacks (step id)
│   │   └─ Factories:
│   │       ├─ Story.Step(body, { id, eyebrow?, title?, stage? }) — one beat (stage = its sticky keyframe)
│   │       └─ Story.Progress({ count, active?, title? }) — standalone dots / counter / prev-next chrome
│   └─ <Disclosure> — "Show more / Show less" toggle
│       └─ Props:
│           ├─ children (required) — the truncatable text
│           ├─ lines (optional) — visible lines before truncation
│           ├─ moreLabel / lessLabel (optional) — trigger copy
│           └─ color / triggerColor (optional)
│
├─ Navigation
│   ├─ <Breadcrumb items={…}> — ancestor trail with '/' separators
│   │   └─ Props:
│   │       ├─ items (required) — [{ label, current (Option Bool), onClick (Option fn) }] trail entries
│   │       ├─ leadingSeparator (optional) — adds a leading '/' so it reads as a path (/ workspace / page)
│   │       └─ runAnchor (optional) — trailing run stamp pinned after a vertical rule
│   ├─ <NavList sections={…}> — sidebar nav
│   │   └─ Props:
│   │       ├─ sections (required) — [{ label?, items: [{ key, label, icon?, badge?, active? }] }], or an East `Array<NavList.Types.Section>` computed from data (items built with `East.value({…}, NavList.Types.Item)`) — a rail of the pages a record holds
│   │       ├─ onSelect (optional) — fn(key) => Null
│   │       ├─ surface (optional) — "card" (default, bordered) | "shell" (drops the card chrome so the list reads as one surface with a host app-shell rail)
│   │       └─ background (optional) — surface background token (bg.subtle)
│   ├─ <Pages nav={nav} pages={{…}}> — route-stack page host (first-class navigation)
│   │   ├─ Props:
│   │   │   ├─ nav (required) — the binding from Navigation.bind, bound in the enclosing <Reactive>
│   │   │   └─ pages (required) — one body per route: { route: ($, payload, nav) => <…/> }; renders ONLY the active route (leaf-only) and remounts on change; the nav handle fixes the route types
│   │   └─ Factories:
│   │       ├─ Navigation.config({ route: { value: T, label, icon?, section?, badge? } }) — typed registry (config.Route variant type, config.Page.<route>(payload) constructors); icon `{ prefix: "fas", name }` / section / badge drive the <App> rail row (single source of truth)
│   │       └─ Navigation.bind(config, key, [config.Page.home()]) — reactive path-stack handle { path, current, depth, canPop, pop, go.<route>(payload), navigateTo([…]) } — go/navigateTo are typed per route (the Record.bind pattern); pair <Breadcrumb>/<NavList> on the same key to drive/derive chrome from nav.path()
│   ├─ <Route nav={nav} routes={{…}}> — <Pages> generalized to any slot (#333)
│   │   └─ Props:
│   │       ├─ nav (required) — the same nav handle
│   │       └─ routes (required) — one body per route; renders only the active route's body and REMOUNTS it on navigation, but placeable anywhere (a header widget, a sidebar, a drawer body). The body <Pages> and any number of <Route> slots bind the SAME nav handle — lockstep, each remounts its own slot. Use it to swap a STATEFUL component (its own <Reactive>/binds) by route; each case is self-contained and rebuilds fresh. For a non-route key use <Match>
│   └─ <App nav={nav} config={routes} pages={{…}}> — the application shell (#367): composes the primitives into one surface — a collapsible nav rail (from the config), a breadcrumb app bar (from nav.path()), an optional brand logo, app-bar slots, and the routed body. Author it INSIDE the <Reactive> that binds nav.
│       ├─ Props:
│       │   ├─ nav (required) — the Navigation.bind handle (drives rail + breadcrumb + body)
│       │   ├─ config (required) — the Navigation.config value (labels / rail icon / section / badge — the handle carries no labels)
│       │   ├─ pages (required) — one body per route (same registry <Pages> takes)
│       │   ├─ title (optional) — header surface title / wordmark (also the logo alt)
│       │   ├─ logo / logoCollapsed (optional) — ImageSource (Image.url / Image.dataUri / Image.blob); the shell renders + sizes the <Image>
│       │   ├─ collapsible (optional, default true) — rail collapses (`[` hotkey + chevron above the list)
│       │   ├─ themeToggle (optional) — built-in dark/light app-bar button (pure-East surfaces; hosts normally inject via AppProvider)
│       │   ├─ density (optional, default comfortable) — app-bar density: comfortable (2 rows) | compact (tighter 2 rows) | condensed (breadcrumb + title on ONE row, ~40px shorter); only the app bar changes (rail + body constant); falls back to inherited density
│       │   ├─ barStart / barEnd (optional) — app-bar UIComponent nodes (leading / trailing)
│       │   ├─ rail (optional) — a UIComponent in place of the rail the config derives: a <NavList> over rows that are data (a route per row of a record, which a static config cannot list), its `onSelect` navigating through the same nav
│       │   └─ breadcrumb (optional) — a UIComponent in place of the breadcrumb nav.path() derives, for routes whose static labels do not name what their payload is
│       └─ Rail: routes with a `section` become rail rows (grouped, icon + badge, active = current route, click → navigate); routes WITHOUT a section are reachable but hidden (deep pages). Host React apps inject chrome (avatar / theme / logout / search) via the east-ui-components `AppProvider` (barStart/barCenter/barEnd/logo/railFooter/bannerTop React slots)
│
├─ Overlays (floating content) — `trigger` is a UIComponent prop; body is children
│   ├─ <Dialog> — the one modal: a confirmation step before a destructive or irreversible act, naming it, with Cancel and the act's own verb — never a form (a form that makes or names something is a <Popover> from its trigger)
│   │   └─ Props:
│   │       ├─ trigger (required) — the opening UIComponent; children (required) — the body
│   │       ├─ eyebrow / title / description (optional) — header copy (eyebrow = mono uppercase, e.g. "Confirm · cannot be undone")
│   │       ├─ size / placement / scrollBehavior / motionPreset / role (optional) — presentation
│   │       ├─ open / defaultOpen / onOpenChange (optional) — controlled state: `open={asking.read()} onOpenChange={asking.write}` opens it from any callback
│   │       ├─ closeOnInteractOutside / closeOnEscape (optional) — behaviour; it is always modal, traps focus and holds the page still
│   │       ├─ lazyMount / unmountOnExit (optional) — mount policy
│   │       └─ onExitComplete / onEscapeKeyDown / onInteractOutside (optional) — lifecycle callbacks
│   ├─ <Drawer> — side panel
│   │   ├─ Props:
│   │   │   ├─ trigger (required) — the opening UIComponent; children (required) — the body
│   │   │   ├─ placement (optional) — start | end | top | bottom; size — panel size; contained — render within the parent container
│   │   │   ├─ eyebrow / title / description (optional) — header copy
│   │   │   ├─ bodyPadding / flush (optional) — body padding control (flush = full-bleed so a Table/Plan fills)
│   │   │   ├─ fillBody (optional) — the body becomes a definite-height flex column so a single height:100% child fills + owns its scroll
│   │   │   ├─ stacked + stackIcon (optional) — (#328) while a deeper drawer is open, this drawer collapses to a labeled vertical icon rail (instead of hiding behind) — click the rail to pop the stack back to it; Esc pops one level
│   │   │   ├─ open / defaultOpen / onOpenChange / onExitComplete (optional) — controlled state + lifecycle
│   │   │   └─ closeOnInteractOutside / closeOnEscape / lazyMount / unmountOnExit (optional) — behaviour + mount policy
│   │   └─ Factories:
│   │       └─ Drawer.open(OpenInput) — open one programmatically (nests/stacks by depth)
│   ├─ <Popover> — click-triggered floating panel; a form that makes or names something (a name, then Cancel and its commit) lives in one, hanging from the control that starts it
│   │   └─ Props:
│   │       ├─ trigger (required); children (required) — the panel body
│   │       ├─ title / description (optional) — header copy
│   │       ├─ size / placement / hasArrow / gutter (optional) — positioning + chrome
│   │       ├─ open / defaultOpen / onOpenChange (optional) — controlled state: `open={shown.read()} onOpenChange={shown.write}` opens it from any callback, at its own trigger
│   │       └─ closeOnInteractOutside / closeOnEscape / autoFocus / lazyMount / unmountOnExit (optional) — it is never modal
│   ├─ <HoverCard> — hover preview card
│   │   └─ Props:
│   │       ├─ trigger (required); children (required) — the card body
│   │       ├─ title / description (optional) — mono eyebrow header (same as Popover)
│   │       ├─ openDelay / closeDelay (optional) — hover timing
│   │       └─ size / placement / hasArrow / open / defaultOpen / onOpenChange / lazyMount / unmountOnExit (optional)
│   ├─ <Tooltip> — hover tooltip (content is a string)
│   │   └─ Props: trigger (required) / content (required) / placement / hasArrow (optional)
│   ├─ <ToggleTip> — click-toggle tooltip (sticky)
│   │   └─ Props: trigger (required) / children (required) / placement / hasArrow / open / defaultOpen / onOpenChange / closeOnInteractOutside / closeOnEscape (optional)
│   ├─ <Menu trigger={…} items={…}> — dropdown / context menu
│   │   ├─ Props:
│   │   │   ├─ trigger (required) — the opening element; items (required) — array of Menu.Item / Menu.Separator
│   │   │   └─ placement (optional) — position relative to the trigger
│   │   └─ Factories:
│   │       ├─ Menu.Item(value, label, { disabled?, icon?, command?, destructive? }) — one action (icon = FA solid name; command = right-aligned mono accelerator "⌘D"; destructive renders in the negative ink)
│   │       └─ Menu.Separator() — a group divider
│   ├─ <CommandPalette commands={…}> — ⌘K palette with search + groups
│   │   └─ Props:
│   │       ├─ commands (required) — [{ id, label, icon?, shortcut?, group?, keywords?, action }] (action = fn() => Null)
│   │       ├─ placeholder / triggerKey (optional) — search copy + global open chord ("mod+k")
│   │       ├─ open / onOpenChange (optional) — controlled state
│   │       └─ size / inputBackground / inputColor / itemColor / selectedBackground / selectedColor / groupLabelColor + COLOR overrides (optional)
│   ├─ <Hotkey chord="mod+k" onTrigger={fn}> — invisible keydown listener (no render)
│   │   └─ Props:
│   │       ├─ chord (required) — modifiers mod/ctrl/cmd/shift/alt + key
│   │       └─ onTrigger (required) — East.function([], NullType); pair with Reactive + State.bind to drive open state on CommandPalette/Dialog/Drawer
│   └─ <ActionBar items={…}> — sticky bottom bulk-action bar
│       ├─ Props:
│       │   ├─ items (required) — array of ActionBar.Item(…)
│       │   ├─ selectionCount / selectionLabel (optional) — "N items selected" copy; the bar is open while the count is above 0
│       │   ├─ open / onOpenChange (optional) — controlled state, in place of the count's
│       │   ├─ onSelect (optional) — fn(actionValue) => Null when an action is chosen
│       │   └─ closeOnInteractOutside / closeOnEscape (optional)
│       └─ Factories:
│           └─ ActionBar.Item(value, label, disabled?) — one action button
│
├─ Container
│   └─ <Card> — chrome-bearing content card (vs <Box> which is structural-only)
│       └─ Props:
│           ├─ children (required) — the body
│           ├─ header (optional) — { eyebrow?, meta?, title?, description? } strict option object composed into the header strip
│           ├─ footer (optional) — { content?, actions? } footer strip (actions = trailing button row)
│           ├─ state (optional) — "ready" | "loading" | "empty" | "error" | "stale" | "disabled" | "permission-denied" runtime state
│           ├─ variant (optional) — elevated | outline | subtle
│           ├─ density (optional) — density provider for the body
│           ├─ bodyPadding / flush (optional) — body padding (default "18px 20px"); flush = full-bleed so a Plan / Table / Chart fills
│           ├─ accentColor / headerBackground / footerBackground (optional) — chrome colours
│           ├─ height / minHeight / maxHeight / width / minWidth / maxWidth / flex / overflow (optional) — sizing (a sized Card becomes a flex column constraining its body — see the Sizing pattern)
│           └─ background / borderColor (optional)
│
├─ Formats (value formatting — one interpreter, in the viewer's locale; #190, #850)
│   ├─ The contract: a format-bearing prop takes a SPEC and the payload keeps the RAW value; the renderer prints it at render through ONE interpreter, in the viewer's LOCALE, every date in UTC. Two spec vocabularies — Chart.format.* and Format.* — and a shared arm prints the same whichever one declared it
│   ├─ Chart.format.* (`Chart.Spec.Types.TickFormat`) — chart axes, Slice fields, Deck, the Plan:
│   │   ├─ Chart.format.number() — plain number, grouped in the locale (1,234.5; German 1.234,5)
│   │   ├─ Chart.format.currency({ code?, compact? }) — currency; compact ⇒ $1.8M (one fraction digit)
│   │   ├─ Chart.format.percent() — 0.42 → 42% (whole percents)
│   │   ├─ Chart.format.compact() — 12400 → 12.4K (one fraction digit)
│   │   └─ Chart.format.date(pattern) / Chart.format.time(pattern) / Chart.format.datetime(pattern) — East date-token patterns
│   ├─ Format.* (`Format.Types.Tick`) — <Numeric>, <Stat>, <Table> columns:
│   │   ├─ Format.Number({ minimumFractionDigits?, maximumFractionDigits?, signDisplay? }) · Format.Currency({ currency, display?, compact?, minimumFractionDigits?, maximumFractionDigits? }) · Format.Percent({ minimumFractionDigits?, maximumFractionDigits?, signDisplay? }) · Format.Compact({ display? }) · Format.Unit({ unit, display? }) · Format.Scientific() · Format.Engineering()
│   │   └─ Format.Date(pattern) / Format.Time(pattern) / Format.DateTime(pattern) — East date-token patterns
│   ├─ Where each plugs in:
│   │   ├─ <Chart> x/y/y2 { format } — axis tick labels; an undeclared time axis prints the locale's numeric date (6/29/2026; German 29.6.2026)
│   │   ├─ Slice.config fields { format } — filter chips, brush axis labels, range summaries (string shorthands "number"|"percent"|"compact"|{currency:{code?,compact?}}|{date|time|datetime: pattern} also accepted)
│   │   ├─ <Numeric format> and <Stat format> — KPI values (Format.*)
│   │   ├─ <Table columns={{ c: { format } }}> — a column's number cells and a parent's subtotals (Format.*); an undeclared number cell prints every digit, never grouped, with the viewer's decimal separator
│   │   ├─ Deck.metric / Deck.Readout cells / card fill { format } — board metrics (Chart.format.*)
│   │   ├─ e3-ui's Plan.axis { format } — timeline tick labels (a date pattern on a time axis; Chart.format.* on a number axis)
│   │   ├─ e3-ui's Plan.quantity { format } and Plan.heatCells / weightCells / segmentCells { format } — a run's or a link's caption, and the values a heat arm prints (Format.*)
│   │   └─ e3-ui's Sheet.column.quantity(R, D, { format }) — a quantity column's cells (Format.*); its edit box and copy stay bare and its grammar reads the viewer's separators (#852)
│   ├─ The locale: react-aria's `<I18nProvider locale="de-DE">` above the app sets it for every component — `@elaraai/east-ui-components` re-exports `I18nProvider`, so a host needs no react-aria dependency of its own — and the browser's language stands in otherwise. Numbers, counts (a pager's total, a footer's "N loaded of M") and the default dates follow it: 1.234,5 · 29.6.2026 · 29. Juni 2026. What the AUTHOR wrote prints as written: labels and footer items, and a date PATTERN — East's tokens, English month and weekday names, whatever the locale
│   ├─ Accessor alternative: Deck metric/fill format props ALSO accept a text accessor ((value) => String / (value, max) => String) — reified at authoring time into a pre-rendered `text` field; the raw value still ships, and a `none` value renders "—"
│   ├─ Date tokens: East's date tokens incl. weekdays — dd/ddd/dddd; "ddd DD" → Mon 30. All date rendering is UTC (East DateTime is a UTC instant) — a pattern, an axis, a filter chip, a range preset (Today / 7d / 30d / YTD are UTC days) — so no component depends on the viewer's timezone
│   └─ tickValues (#318): pin chart ticks to exact floats / DateTime instants (rendered through the date format) to line a Chart up with a Plan's bucket columns
│
├─ Statuses & tones (the shared five-token status vocabulary)
│   ├─ The tokens: "success" | "warning" | "danger" | "info" | "neutral" (StatusTokenType / StatusValueType) — the ONE semantic palette for state colour across the library; theme-mapped, never raw hex
│   ├─ Registries (define states ONCE, reference by key):
│   │   └─ Deck.statuses({ key: { label, color, pulse?, hint? } }) — color is a standard token OR any custom CSS colour; one entry drives the card tag + dot/pulse, face wash, fill bar, group-head swatch + hint, and legend
│   ├─ Where a bare token / status value plugs in:
│   │   ├─ Library.status(label, tone, ring?) — palette card status chip, a gallery card's dot (`ring` open) · Library.glyph(icon, label, tone?) — its trailing glyph
│   │   ├─ Table rowStatus — fn(rowIndex) => StatusToken row tint
│   │   ├─ Schematic item { status } (Option token dot) and { tone } (brand|ink|muted|success|warning|danger stroke override)
│   │   ├─ e3-ui's Plan.run { status } (stuck ring) · Plan.marker { status } (cell rings, default danger) · Plan.event { tone } — tile tints, all ORTHOGONAL to `state`
│   │   ├─ Matrix.marker { status } — corner markers
│   │   ├─ <Status value> — dot + word (`ring` an open ring — not live yet); <Banner status> uses the wider notice set (info|warning|success|error|neutral|change|guard|stale)
│   │   └─ <Meter tone> / BarStrip item { tone } / SegmentedMeter segment { tone } — bar fills
│   ├─ Sentiment (value direction, NOT state): <MetricChip tone> positive|negative|neutral|info · <Numeric sentiment> positive|negative|neutral · <Stat indicator.sentiment> positive|negative|neutral · <Progress tone> brand|pos|neg
│   ├─ state ≠ status: the AUDIT LIFECYCLE is orthogonal to the status tint. Roster shifts, Board assignments and Blend allocations speak PlannerStateType ("committed"|"added"|"model"|"removed"|"rejected" — committed solid, proposals dashed/ghost/struck, rejected greyed; only proposed items drag); Plan elements speak the richer EventStateType ladder ("estimated"→"proposed"(added|recommended|removed)→"confirmed"→"in-progress"→"actual", plus "rejected"). A status token is the ORTHOGONAL semantic tint layered on top
│   └─ tone vs colorPalette: tone/status/sentiment = the semantic vocabulary above (meaning-bearing, theme-stable); colorPalette = decorative hue theming (Chakra palettes) for buttons/badges/tags where the colour carries no state meaning
│
├─ Reactive (state-driven re-render)
│   ├─ <Reactive>{$ => { …State.bind reads…; return <…/>; }}</Reactive> — re-renders when read State keys change
│   │   └─ Props:
│   │       └─ children (required) — a builder function ($ => UIComponent); all State.bind reads live inside it
│   └─ <Match on={bind.read()} cases={{…}}> — hosting slot over a variant (#333), the component-level twin of variant.match
│       └─ Props:
│           ├─ on (required) — the variant expression selecting the active case; pass the READING expression (bind.read()) — a $.let snapshot freezes the slot
│           └─ cases (required) — one handler per case name, exhaustive; each gets that case's typed payload. Mounts ONLY the active case and REMOUNTS it on tag change (same-tag payload churn re-renders in place) — use it to swap a STATEFUL component (its own <Reactive>/binds) at one slot; a plain variant.match over mounted components keeps the first one mounted (function-blind reconciliation). A nav-route key is <Route>
│
└─ State (typed reactive store)
    └─ State.bind([T], key, defaultValue) → { read, write, has } closures;
       read() tracks the dependency so <Reactive> re-renders when the value changes
```

## Paged source snapshots

Paged data is BOUND: a component's `data` is local — a collection value or
expression, or a whole-value `Data.bind` / `State.bind` handle — or a paged
source from the platform that owns the data, e3-ui's `Data.bindPaged`. east-ui
produces no paged source; a collection already in hand is local data. A
component recognises a paged source by its East type, a subtype of
`Paged.Types.PinnedSource(C)` or `Paged.Types.Source(C)` over the collection
`C` its `page` serves, and refuses a struct with `page` / `total` that is
neither, naming the contract's fields.

The contract is a PINNED source: `{ id, page, total, seek, revision, refresh }`
— the `pinned` arm. `id` names the logical source; `revision()` names the
snapshot every page, total and seek position belongs to (`none` while it is
found). Call `refresh(some(committedHash))` after a confirmed write to move to
that exact snapshot, or `refresh(none)` to the one the source holds now; a
move invalidates every consumer, same-size rows and cached key searches
included. `Data.bindPaged` returns one — its revision is the dataset's content
hash. A component follows a pinned source from one snapshot to the next, and
edits a paged source only when it is pinned: an `onApply` over a source that
names no snapshot is refused at build time. Read the methods inside a tracked
evaluation; call `refresh` in an event handler.

The same struct without `revision` and `refresh` — `{ id, page, total, seek }`,
the `paged` arm — is the handle a UI exported before them carries. It names no
snapshot: a component reads each window once, and the same `id` serves the
same rows for as long as the component holds it.

`Data.bindPaged` also follows its dataset without a call: the workspace
status poll reports each new content hash and the source moves to that
snapshot, so a `refresh` after your own write only gets there sooner. A
pinned read the server refuses because the dataset has moved on (409
`dataset_hash_mismatch`) rediscovers the current snapshot instead of failing
its window. How a consumer bridges the move is its own: e3-ui's `<Plan>` and
`<Sheet>` keep the rows they show until the new snapshot's windows land; the
Sheet clears a standing key search, and the Plan asks it again there, its
text kept.

## Key Patterns

### Configurator — one array per axis, no parallel tables

For "change a prop, watch it react" surfaces, put each axis in a **plain array
of the values themselves** and let the same array feed both the control and the
preview. For a variant-typed prop that array is just the variants — `getTag()`
supplies the segment key *and* its label, so there is no key/label table to keep
in step:

```tsx
<Reactive>{$ => {
    const variants = $.const([
        variant("outline", null), variant("brand", null), variant("danger", null),
    ], ArrayType(Style.Types.StyleVariant));

    const bind = $.let(State.bind([StringType], "badge_variant", "outline"));
    const key = $.let(bind.read());
    const onPick = $.const(East.function([StringType], NullType, ($, n) => { $(bind.write(n)); }));

    // The selection is a lookup into the array the control renders.
    const selected = $.let(variants.filter((_$, v) => v.getTag().equal(key)).get(0n));

    return (
        <Configurator
            controls={[
                Configurator.Control("Variant", key,
                    <SegmentGroup value={key} onChange={onPick} size="sm"
                        items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
            ]}
            preview={<Badge variant={selected}>{selected.getTag().upperCase()}</Badge>}
            spec={[Configurator.Spec("Radius", "sm")]}
        />
    );
}}</Reactive>
```

Numeric and token axes collapse the same way — an opacity is a percentage
(`[100n, 75n, 50n]`), a padding is a spacing token (`["0", "1", "3"]`). Only an
axis with no single value to name it by (a background/foreground *pair*, say)
needs a struct.

**A variant-typed prop needs a variant value, not a string** — `density={"compact"}`
is a type error once the value comes from state, which is exactly why the array
holds `variant(...)` rather than keys.

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
            Chart.Column(rows, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
            Chart.Line(rows, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid", dots: true }),
        ]}
        y={{ format: Chart.format.currency({ compact: true }) }}
        legend grid tooltip
    />
</Box>
```

### Sizing — one string prop, parsed everywhere

Every size prop is a **plain string** and every renderer parses it the same
way (`parseCssSize`). Four spellings, uniform across data components (`<Table>`,
e3-ui's `<Plan>`, `<Matrix>`, `<Board>`, `<Roster>`, `<Calendar>`,
`<Library>`, `<Schematic>`, `<SnapGrid>`) and layout primitives (`<Box>` / `<Flex>` /
`<Stack>` / `<Grid>` / `<Card>`):

| Value | Means |
|---|---|
| `"fill"` | fill the parent box (`100%`) |
| `"240"` | a bare number → pixels (`240px`) |
| `"50%"` / `"calc(100vh - 4rem)"` | any CSS length passes through |
| `"18px"` | explicit units pass through |
| `"min(420px, 100%)"` / `"clamp(240px, 50%, 420px)"` | fluid sizes pass through — the mobile-safe way to say "420px, but never wider than the container" |

**Fluid layouts** (desktop + mobile from one definition): prefer
`width="min(<ideal>px, 100%)"` over a bare pixel width; a `<Grid>` with
`templateColumns="repeat(auto-fit, minmax(240px, 1fr))"` reflows cards to
1 column on phones; `<Splitter collapseBelow={480}>` stacks its panels
vertically when its container is narrower than 480px.

```tsx
// height bounds the whole component and it scrolls within; maxHeight caps
// it but stays content-sized until the cap is hit.
<Table data={rows} columns={cols} height="fill" />      // fills its parent
<Matrix …   maxHeight="420" />                           // content up to 420px, then scrolls

// Layout primitives add boolean shorthands so you never hand-write the
// flex:1 + min-height:0 + overflow incantation for a scroll region:
<Card height="fill">
    <Box fill scrollY>       {/* fill remaining space, scroll vertically */}
        <Table data={rows} columns={cols} height="fill" />
    </Box>
</Card>
```

A `<Card>` given `height` / `maxHeight` becomes a flex column that constrains
its body, so a single `height="fill"` child (a data component, a scroll region)
resolves against it.

Caveats that save a render cycle:

- **`"fill"` / percentages need a definite parent.** `height="fill"` resolves
  against the nearest box with a real height (a sized `<Box>`/`<Card>`, a flex
  item with `fill`, a Drawer `fillBody`). Inside a content-sized parent it
  silently resolves to auto — bound the parent, don't add pixels to the child.
  A `<Chart height="fill">` is the exception: in a content-sized parent it
  takes its natural height.
- **`height` vs `maxHeight`**: `height` pins the component to exactly that box
  (header pinned, body scrolls); `maxHeight` stays content-sized UP TO the cap,
  then scrolls. Bounded data components virtualize (only visible rows mount)
  and show a reserved-gutter scrollbar; unbounded ones grow to content.
- **A definite `height`/`width` on Box/Flex/Stack also pins `flex-shrink: 0`**
  (a sized box no longer collapses under flex pressure) — opt back in with
  `flexShrink` if you want it squeezable.
- **Bare numbers are pixels, not Chakra spacing tokens** — `width="8"` is 8px.
  `gap` / `padding` / `margin` keep token semantics (`gap="4"` is a spacing
  token, not 4px).

### Nested rows — a P&L in one Table (#954)

A Table's rows nest the way the Plan's do: a row carries its children, to any
depth, and a parent IS the group row. It draws its own cells, and in each
column that declares an `aggregate`, the subtotal of what its children show —
so a collapsed section reads as its subtotal line, and opening it drills down.
Hierarchy comes only from the data; there is no `groupBy`.

```tsx
// Sections hold categories, categories hold accounts: the data's own tree.
const Line = RecursiveType((self) => StructType({
    account: StringType, q1: FloatType, fy: FloatType, lines: ArrayType(self),
}));
const pnl = $.const(PNL, ArrayType(Line));   // a parent's own quarters are 0 — its columns show its lines' subtotals
// One render for every cell: an account's amount, a parent's subtotal.
const money = $.const(East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => (
    <Text width="100%" textAlign="right">{East.Float.printCurrency(ctx.cellValue.unwrap("Float"))}</Text>
)));
return (
    <Table
        data={pnl}
        columns={{
            account: { header: "Account", width: "260px" },
            q1: { header: "Q1", aggregate: "sum", render: money },
            fy: { header: "FY", aggregate: "sum", render: money },
        }}
        tree={{
            children: (r) => r.lines,                            // more of the SAME row type
            collapsed: (r) => r.account.equal("Operating expenses"),
        }}
        footerRows={[{ account: { content: <Text fontWeight="bold">Net income</Text> }, /* … */ }]}
    />
);
```

| Signature | Description | Example |
| --- | --- | --- |
| `tree={{ children: (r) => Array<Row> }}` **❗** | A row's children: more rows of the data's own element type (a recursive row's own field, or a lookup among the rows); another type is refused at build. A recursive row reaches every accessor — columns' `value`, `children`, `collapsed` — as its node. | `tablePnl`, `tableTree` |
| `tree={{ collapsed: true \| (r) => Boolean }}` | Where a parent starts; the viewer's folds persist by path under the `storageKey`. | `tablePnl`, `tableTree` |
| `aggregate: "sum" \| "mean" \| "min" \| "max" \| "count"` | A parent's cell in that column: its children's subtotal, composed bottom-up — a mean of means (a Float), `count` the leaf rows beneath. `sum` / `mean` need a numeric column. | `tablePnl`, `tableTree` |
| `render` / `format` on an `aggregate` column | A subtotal draws like any cell: the render gets it as `ctx.cellValue`, the format prints it. A `count` prints itself through neither. | `tablePnl`, `tableTree` |
| `rowIndex` / `path` | A row's pre-order position (a flat table's data index) — what `rowStatus`, `expandedContent`, `selection`, review and every event carry, stable under sorting and pagination — and its sibling index at each depth. | `tableTree` |
| `pagination` / a paged source **❗** | Both page TOP-LEVEL rows, each with its whole subtree, so a parent's subtotals are exact over whatever has loaded. | `dataBindPagedTable` (e3-ui) |

A sort orders each parent's children among themselves (ties keep data order),
a parent carrying its subtree. A computed statement line (Gross profit) that
is not a plain subtotal is its own row in the data, or a `footerRows` entry.

Removed with #954: `groupBy` (nest the data — a data step before the table)
and a column's `aggregateRender` (a parent is a row: its subtotal draws
through the column's `render` or `format`).

### Editing — one transaction contract (#879)

An editable collection's changes are drafts, applied as one checked batch
through one contract: `Editing.apply` and `Editing.Types.*` — `ChangeSet`,
`PatchEvent`, `Readiness`, `Origin`, `Draft`, `Entry` and the rest. The
SnapGrid's editing canvas and e3-ui's `<Sheet>` and `<Plan>` each
run a session on it, and e3-ui's `Sheet.apply` and `Sheet.Types.*` are its
very values under the Sheet's names. A gesture's `origin` names what made it:
a typed or pasted value, a fill or a proposed row taken, an entry inserted,
moved or removed, a `resize`, a `drop`, an undo, a redo or a discard (a review
`verdict`, which no collection makes since #1260, stays so a journal of earlier
events still reads).

A host's `onApply` takes one checked `ChangeSet` and answers an
`ApplyResult`: it checks the base the drafts began from, applies the whole
batch or none of it, deduplicates by the request id and returns the committed
revision. An unknown outcome retries the same frozen request, and an
append-only journal (`onPatch`) is not an application acknowledgement.
`Editing.apply` is that check and application as an East function, over an
`Array` by its identity field or a keyed `Dict` by key: each change names its
entry by key (a `String` key as it is, any other key by its `.east` text), and
a new entry is placed `keyOrder`.

| Signature | Description | Example |
| --- | --- | --- |
| `Editing.apply(E, "id")` / `Editing.apply(DictType(K, E))` | The shared applier — an Array by its identity field, or a keyed Dict by key (`Editing.Types.ChangeSet(E, K)`): the whole batch, or a conflict saying why. | `editingApplyBatch`, `editingApplyKeyed` |

### Fields — a builder inspector's typed form (#1147)

A builder's inspector shows what is selected as a typed form over its struct.
`Fields.specs(R, hints, omit)` resolves each field into a `Fields.Types.Spec`:
its editor from its East type, a hint adding only what a type cannot say.
e3-ui's builders carry the specs in their payloads, and east-ui-components'
`FieldForm` draws each one as the shared `<Field>` (its label, its path as the
key) around the input its type takes — so an inspector an author writes
themselves from `<Field>` and the form tags looks the same.

| Field type | Editor with no hint | Hint |
| --- | --- | --- |
| `String` | text | `Fields.text({ placeholder? })`; `Fields.reference({ of })` — a key of a keyed set the host lists |
| `Integer`, `Float` | number, with its steppers | `Fields.number({ unit?, step?, min?, max? })` — bigints for an Integer field, numbers for a Float |
| `Boolean` / `DateTime` | checkbox / date and time | — |
| a variant of empty cases | select, each case's name spelled out | `Fields.select({ labels? })` — the cases it labels first |
| `Set<String>`, `Array<String>` | tags, typed freely | `Fields.tags({ options? })` — suggested as a tag is typed |
| `Array` of a struct with one String and one Boolean field | checklist | `Fields.checklist({ text?, done? })` — naming them where there are several |
| a struct | its fields, under its name | a hint per nested field |
| `Option<T>` | `T`'s, which can be cleared | `T`'s |
| anything else | printed | `Fields.readonly()`; `Fields.hidden()` leaves any field out |

Every hint but `hidden` takes `label` and `help`. A hint is checked against its
field's type as it compiles (`Fields.number` on a String field is a type
error), and the specs refuse one again as they resolve, naming the field.

| Signature | Description | Example |
| --- | --- | --- |
| `Fields.specs(R, hints?, omit?): Array<Fields.Types.Spec>` **❗** | The specs: the hinted fields first, in hint order, then the rest as declared; a nested struct's fields by path, under its name; `omit`'s and the hidden fields left out. Refuses a hint that does not fit its field, naming it. | `fieldsSpecs` |
| `Fields.select({ labels })` | A variant's select: the cases it labels first, in its order, then the rest, each name spelled out. | `fieldsSelect` |

### Drag and drop — one grammar, every target (#608)

A `<Library>` is a source; a `<Roster>`, `<Board>`, `<Blend>` or e3-ui's `<Plan>`
that lists its `id` in `sources` is a target. Every drag between them reduces
to one `DragEventType` — `add` (a card onto a cell), `move`, `remove` (to the
trash or back to the palette) or `resize` (a span's edge) — and the renderer
wires the flow, so nothing is wired by hand. A target's `canDrop` is asked of
the REAL event, so a policy on copies holds while the drag is still moving:

```tsx
// A person may be moved onto a shift, never copied there (Alt held).
const canDrop = $.const(East.function([DragEventType], BooleanType, (_$, event) =>
    event.match({ add: (_$, add) => add.duplicate.not() }, (_$) => East.value(true))));
```

| Signature | Description | Example |
| --- | --- | --- |
| **The gesture** | | |
| pointer | A mouse or pen drag starts after 4px of travel, so a click stays a click; a touch after a 300ms hold — a drift first scrolls the page; a touch on a grip at once. Only the pointer that pressed moves, drops or cancels the drag — a second finger never does. | `rosterLibraryDnd` |
| keyboard | Every draggable is a focusable control: Space / Enter picks it up, the arrow keys carry it between the cells that take it (and along a Plan row's buckets), Space / Enter drops it, Escape / Tab cancels. A Plan element is picked up with Space alone, since Enter is its click, and carries its own keys (#825). A key pressed in a control inside it is the control's. | `boardLibraryDnd`, `planRowDrop` (e3-ui) |
| reach | A drag resting near a scroll container's edge scrolls it — the container under the pointer: a bounded Plan's body, the page — and whatever scrolls under a still drag is read again. | `planRowDrop` (e3-ui) |
| **The verdict** | | |
| `canDrop: fn(DragEventType) => Boolean` | Asked of the event a drop where the drag rests would deliver — an `add`'s `duplicate` is whether Alt is held now — so the ⊘ stage shows before the drop, and asked again of the event delivered. A predicate that throws allows. | `rosterLibraryDnd`, `blendLibraryDnd`, `planRowDrop` (e3-ui) |
| the drop | Resolves where it happens: a cell that scrolled away is never dropped on, and a drop with nothing under it says so rather than vanishing. | — |
| **Screen readers** | | |
| announcements | The pick-up, each new cell or bucket the drag rests over (or one that refuses it), the drop and a cancel are said in a live region. Host React code re-words them with `<DragLayerProvider messages={{ pickedUp: ({ item }) => … }}>` (@elaraai/east-ui-components; `dragMessages` is the English table, and any subset overrides it). | — |

### Overlays — trigger prop + body children

`<Dialog>` is the one modal, and it is a confirmation step: before an act that
destroys something or cannot be undone, it names the act and offers Cancel and
the act's own verb. It is never a form. Anything that makes or names something
— a new page, a template, a cohort — is a `<Popover>` hanging from the control
that starts it, its fields in the body.

A callback opens an overlay through the State its `open` reads, and
`onOpenChange` writes the State back as it closes. A callback carries no
element, so an anchored overlay — a popover, a hover card, a toggle tip —
opens at its own trigger, whatever wrote the State:

```tsx
const shown = $.let(State.bind([BooleanType], "details_open", false));
const openIt = $.const(East.function([], NullType, $ => { $(shown.write(true)); }));
<Button onClick={openIt}>Open the details</Button>
<Popover trigger={<Button>Details</Button>} open={shown.read()} onOpenChange={shown.write}>…</Popover>
```

```tsx
<Dialog trigger={<Button variant="outline">Remove cohort…</Button>}
    eyebrow="Can't be undone" title="Remove cohort Late?">
    <HStack gap="2" justify="flex-end">
        <Button variant="outline">Cancel</Button>
        <Button variant="solid">Remove cohort</Button>
    </HStack>
</Dialog>
```

### Density cascade — one prop tightens a whole surface

Display components (`<Tag>`, `<Badge>`, `<Kbd>`, `<MetricChip>`, `<EditableChip>`,
`<Meter>`, `<BarStrip>`, `<SegmentedMeter>`, `<Stat>`, `<Avatar>`, `<Trace>`,
`<ChipRail>`) take `density="condensed" | "compact" | "comfortable"` and inherit
it from the nearest providing surface — a `<Table>` /
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

### App shell — `<App>` in East + host-injected chrome via `AppProvider`

`<App>` composes the nav primitives into one shell from a single
`Navigation.bind` handle — the rail is derived from the config's
`icon` / `section` / `badge`, the breadcrumb from `nav.path()`, and the routed
body from `pages`. Author it **inside** the `<Reactive>` that binds `nav`.
`density` (`comfortable` / `compact` / `condensed`) resizes only the app bar.

When the rows are data — a route per row of a record, which a static config
cannot list — pass the rail yourself: a `<NavList>` whose sections are an East
array mapped from the rows, its `onSelect` navigating through the same `nav`.
Pass `breadcrumb` too when the route's label does not name what its payload is.

A host React app injects its own app-bar / rail chrome (avatar, theme toggle,
logout, search) by wrapping the renderer in **`AppProvider`** (from
`@elaraai/east-ui-components`). Pass bar items as a **Fragment of individual
elements** — not a `<Flex gap>` wrapper — so each shares the bar's single gap
with the built-in theme toggle. With no provider, `<App>` renders standalone
(its IR slots + default logo), so e3 `ui()` tasks keep working.

```tsx
// East side — author the shell (inside the <Reactive> that binds nav).
const routes = Navigation.config({
    overview: { value: NullType, label: "Overview", section: "Analyse", icon: { prefix: "fas", name: "gauge-high" } },
    audit:    { value: NullType, label: "Audit",    section: "Manage",  icon: { prefix: "fas", name: "list-check" } },
});
const shell = East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const nav = $.let(Navigation.bind(routes, "app.route", [routes.Page.overview()]));
        return (
            <App nav={nav} config={routes} title="Acme Ops" density="comfortable"
                logo={Image.dataUri(LOGO_SVG)}
                pages={{ overview: () => <OverviewPage/>, audit: () => <AuditPage/> }} />
        );
    }}</Reactive>
));
```

```tsx
// Host React side (@elaraai/east-ui-components) — inject chrome + render the value.
import { AppProvider, EastChakraComponent } from "@elaraai/east-ui-components";

<AppProvider
    barEnd={<><NotificationsButton/><AvatarMenu/></>}   // Fragment — one bar rhythm, not a nested <Flex gap>
    barCenter={<GlobalSearch/>}
    railFooter={<AccountCard/>}
    logo={<BrandLogo/>}                                  // React node — overrides the IR logo
>
    <EastChakraComponent value={compiledShellValue} />
</AppProvider>
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
- **BarStrip vs Chart.Bar vs Chart.Column** — `<BarStrip>` is a small ranked
  horizontal-bar list (no axes) for a KPI card; `Chart.Bar` draws horizontal
  bars inside an axis-bearing `<Chart>` (numeric x, categorical y — grid,
  legend, tooltip, stacking); `Chart.Column` is the vertical twin (formerly
  named `Chart.Bar`).
- **Plan (subsumes the retired Gantt / Planner / AlignedStack, #571)** —
  e3-ui's `<Plan>` (#1177, #1191) is the planning canvas: ONE shared axis — time, number or
  ordinal (#631) — over heterogeneous rows (state-runs, allocation lanes, chart measures,
  heat, bucketed numerals, shift chips, event marks), laid out by the series
  list and nested from the data's own structure, or placed from event kinds
  over records (e3-ui's `Schedule`, a Calendar's too), each named by a typed id,
  with slice/key-search/series-library chrome, an editing session (every
  dropped card, move and resize a draft, saved together — #880 / #825 / #1260) and PAGED sources. A Gantt
  is a Plan with span rows, a Planner a Plan with bucket rows, an
  AlignedStack a Plan mixing chart / heat / table rows on the shared axis.
  Reach for `<Plan>` for anything scheduled on ONE shared axis — calendar
  time, a numbered day / shift / distance, or an ordered list of phases —
  with mixed row kinds, nesting to any depth, a paged source, or rows addressed
  by stable ids; the e3-ui skill documents it.
- **Table vs Sheet** — `<Table>` DISPLAYS rows (sort, pin, nest, review,
  paginate; cells printed in the viewer's language, or drawn by `render`);
  e3-ui's `<Sheet>` (#1179, #1216) is where a planner TYPES
  them, in its builder frame: typed cells with grammars (dates, quantities,
  register lookups, a directed link), a blank tail that inserts rows, an
  East-function copilot, and a slice lens drawn as context bands rather than
  a filtered row set. Reach for `<Sheet>` when the rows are authored in place
  and written back (through an e3 record's patch, or `onUpdate` / `onApply`)
  — the e3-ui skill documents it; for reading, sorting and reviewing a
  dataset, `<Table>`.
- **Flowchart vs Schematic** — `<Schematic>` is a world-coordinate 2D canvas
  (data carries x/y; zones, footprints, camera); `<Flowchart>` derives its
  whole layout from lanes + links (no coordinates) for state-transition /
  process-flow reading, with decision triggers and evidence on the links.
- **Library vs Deck** — `<Library>` is the draggable palette (DnD source),
  or with `variant="gallery"` a library a person browses — large cards, each
  with its media, a byline and an action a click follows;
  `<Deck>` is the status-coloured display board (popover VIEW state, no drag).
- **Card vs Box** — `<Box>` is structural-only; `<Card>` carries chrome.
- **SnapGrid vs Grid** — `<Grid>` places the children written inside it, on
  whatever tracks you template; `<SnapGrid>` lays out tiles mapped from rows —
  a page held as data, on the fixed 12-column grid whose spans reflow to the
  SnapGrid's width, with a wireframe thumbnail drawn from the same rows.

## Related skills

- **east** — the language UI component bodies are written in.
- **e3-ui** — bind components to live workspace data (`Data.bind`) and ship them
  as reactive `ui()` e3 tasks; pair it with east-ui whenever the UI reads,
  writes, or commits real data.
- **e3** — the engine that runs UI tasks.
- **e3-ui-cli** — screenshot a component from the terminal (`e3-ui shot
  --from-source`) or Node (`renderToPng`), with managed headless Chromium.
