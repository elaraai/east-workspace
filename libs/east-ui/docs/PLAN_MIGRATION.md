# Plan migration — retiring `<Gantt>`, `<Planner>` and `<AlignedStack>` (#571)

The `Plan` composite temporal canvas (epic #567) subsumes the three
single-surface components. As of #571 they are **deleted end-to-end**:
JSX tags, factories (`Gantt.*`, `Planner.*`, `AlignedStack`), East types
(`collections/gantt/types.ts`, `collections/planner/types.ts`,
`layout/aligned-stack/types.ts`), renderers, slot recipes
(`gantt` / `planner`), runtime tags, examples, and showcase goldens.

## The wire break — read this first

`UIComponentType` lost three **mid-list variant arms** (`AlignedStack`,
`Gantt`, `Planner`). beast2 variant arms are POSITIONAL tags
(`libs/east/src/serialization/beast2/v5/codec.ts`), and `decodeBeast2For`
ignores the embedded root type — so a `UIComponentType` value serialized by
an older release does **not fail loudly** against the new type: every arm
after the removed positions decodes as the WRONG component (silent
mis-decode). The arm positions were deliberately NOT reserved: this PR
(#562) already breaks the UI wire (`TableRootType.rows`, #576), and every
serialized `UIComponentType` from before it must be **re-emitted** by
rebuilding the producing package — there is no mixed-version compatibility
for stored UI values across this release.

**#631 breaks the Plan wire once more**, by the same rule: `PlanAxisType`
is now a VARIANT (`{ time | number | ordinal }`) and every element instant
(`PlanRunType.start` / `end`, every `at`, `PlanChipType.from` / `to`, chart
points, the cell-click payload) is `PlanInstantType` — a `Plan` value
serialized before #631 does not decode against it. Positions are not
reserved; stored `UIComponentType` values re-emit.

**#821 breaks the paged arm the same way**: `PagedSourceType(c)` — the
`paged` arm of a `Plan`, `Table` or `Sheet`'s rows — gains
`revision: () → Option<String>` and `refresh: (Option<String>) → Null` after
`seek`. A paged value serialized before #821 does not decode against it;
re-emit. Authoring is unaffected: `Data.bindPaged` and `Paged.of` produce
both fields, and a hand-written `{ id, page, total, seek }` source still
builds — `buildRowSource` gives it `revision = none` and a `refresh` that
raises.

**#822 breaks the Plan wire again**, and its authoring API with it — the
rows become an ordered stream with typed ids, and hierarchy comes only from
the data's nesting. The wire changes and every removal, each with its
replacement, are in [Rows as a stream (#822)](#rows-as-a-stream-822) below.
Positions are not reserved; stored `UIComponentType` values re-emit.

**#823 breaks it once more**: a canvas's rows are its series' BLOCKS —
`PlanBlockType` (`{ fixed, parent, rows }`) — and a series derives a list of
them, so the inline arm, every paged window and every `derive` are
`Array<PlanBlock>` rather than `Array<PlanRow>`. The wire and what it changes
for a paged canvas are in [Blocks (#823)](#blocks-823) below. Authoring is
unaffected. Stored `UIComponentType` values re-emit.

**#824 breaks it again**, with its authoring API: a run's and a link's
numbers are one `PlanQuantityType`, cells, table series and chart layers
declare how a coarser bucket folds them, the five element callbacks are one
`onElementClick`, the root gains a bound `ui` state, and the `Option<Boolean>`
flags are Booleans. The wire and every removal are in
[Values, folds, one element callback and a bound ui (#824)](#values-folds-one-element-callback-and-a-bound-ui-824)
below. Stored `UIComponentType` values re-emit.

**#879 moves the Sheet's transactions into a shared editing contract** that
the Plan's editing session (#880) speaks too. The gesture origin gains the
Plan's gestures, so a patch event's wire type changes, and a Sheet's editing
declaration reorders its fields around the shared ones. See
[One editing session (#879)](#one-editing-session-879) below. Stored
`UIComponentType` values re-emit; no Sheet author changes a line.

**#880 breaks the Plan wire again**, with its authoring API: every change on
the canvas is a draft of that editing session. The review verbs and `onDrag`
leave the root for `editing`, a series carries its writer, and a row says
which gestures it takes. The shared session's `keyed` flag becomes the key
type, so a Sheet's editing declaration changes on the wire too, though no
Sheet author changes a line. See
[Every change is a draft (#880)](#every-change-is-a-draft-880) below. Stored
`UIComponentType` values re-emit.

**#825 breaks it again**: a run, chip, tile or mark moves and resizes as a
gesture of that session. The gesture gains a `move` arm, a row says whether
its elements move, and every series writer takes the item a cross-row move
carries. See [Moves and resizes (#825)](#moves-and-resizes-825) below. Stored
`UIComponentType` values re-emit; a series that declares no move changes no
line.

The public API break alongside it: the `Gantt` / `Planner` / `AlignedStack`
exports (tags, factories, `*.Types`) are gone from `@elaraai/east-ui` and
`@elaraai/east-ui/internal`, as are `EastChakraGantt` / `EastChakraPlanner`
from `@elaraai/east-ui-components`. `AlignedGutterType` is gone from
`shared/plot-gutter.js` (`PlotGutterType` and the per-component `plotGutter`
prop remain).

## Rows as a stream (#822)

Before #822 a canvas sat in canonical KEY order, and one String was a row's
identity, its position, its seek anchor and its link end at once: authors
numbered their keys to get a layout, spelled views of one entity with key
affixes, and lost a row silently when two series emitted the same key.
Hierarchy was synthesized from field values (`groupBy`), which is only exact
over data that is all in hand — so a paged canvas could not behave like an
inline one. Now the series list is the layout, hierarchy comes from the data's
own nesting, every row has a typed identity, and the same canvas renders the
same rows whether its data is inline or paged.

### The wire

| Type | Before | After |
|---|---|---|
| `PlanRowsCollectionType` | `Dict<String, PlanRow>` (key order) | `Array<PlanRow>` — the stream IS the render order |
| `PlanRowType.key` | `String` | removed — `id: PlanRowIdType` |
| `PlanRowType.parent` | `Option<String>` | `Option<PlanRowIdType>` |
| `PlanRowType.collapsed` | on the `group` kind only | on the row — any row with children may start collapsed; the `group` kind is `{ summary, summaryAggregate }` |
| `PlanRowIdType` | — | `Variant { entry: { series, path: Array<String> }, section: { series, path } }` |
| click payloads (`Run` / `Event` / `Mark` / `Chip` / `Cell` — since #824 the arms of `ElementRef`), `GroupToggleEvent` | `row: String` | `row: PlanRowIdType` |
| `onSelect`, review `onApprove` / `onReject`, `expandRender`, `expandGutter` | `PlanRowRefType` (`{ key }`) | `PlanRowIdType` — `PlanRowRefType` / `Plan.Types.RowRef` are removed; since #880 review has no per-row callbacks (a verdict is a draft) |
| `PlanLinkType.fromRow` / `toRow` | `String` | `PlanRowIdType` — since #824 the `row` of the link's `from` / `to` (`PlanRunRefType`) |
| `Plan.Types.Series(R)` | 9 arms; `derive: Fn(Dict<String, R>) → Dict<String, PlanRow>` | 11 arms (`+ section`, `views`); `derive: Fn(Dict<K, R>) → Array<PlanRow>`; `Plan.Types.Series(R, K)` for a key type other than String |
| drag `CellRef.row` | the row key | still a `String` — the row id's canonical `.east` text (`East.print(Plan.ref(…))`), so the shared drag grammar is unchanged in shape |

A path segment is an entry's key: at the top the source key — the String
itself, or its `.east` text for any other key type (`3`, `(line="L1", bin=3)`)
— and below that a `Dict` child's key or an `Array` child's index. A section
header adds no segment: its id is `section { series, path }` at its parent's
path.

### Removals and their replacements

| Removed | Replacement | Example |
|---|---|---|
| `groupBy: [r => r.top, r => r.program]` on span / heat / table | reshape first — `rows.groupToDicts(($, r) => r.top, ($, _r, k) => k)` — and nest: `children: Plan.children((g) => g, [series…])`; a recursive entry nests with `children: (r) => r.children`, to any depth. A parent declares `rollup` (span), `aggregate` (heat, default `"mean"`; table, default `"sum"`) and `format` as before, and derives exactly, since its whole subtree rides in its entry. A paged source is grouped in its dataflow. | `planGroupedRows`, `planSeriesData`, `planTableRows` |
| `Plan.series.group(R, { by, keyPrefix?, collapsed?, summaryAggregate? })` | `Plan.series.group(G, { key, title, label, children, summaryAggregate?, summary?, collapsed? })` over grouped entries — one strip PER ENTRY, its members the entry's children. The old form throws, naming this replacement. | `planGroupedRows`, `planNarrow` |
| `Plan.series.group(R, chrome, children)` — a static group over series | `Plan.series.section(R, { key, title, collapsed?, meta?, value?, status?, summary?, summaryAggregate? }, [series…])` | `planTargetState`, `planLibraryDnd` |
| `keySuffix` (`"m03"` → `"m03/chart"`) and `keyPrefix` | `Plan.series.views(R, { key, title, match?, children?, collapsed? }, [series…])` — one row per member per entry, adjacent and in order; each row's id is its MEMBER's key and the entry's path, and a seek on the entry lands on its first view row | `planLibraryDnd`, `planFill` |
| numbered keys to force a layout (`"10-line1"`, `"40-crewA"`) | order the series list — each series is one block, top to bottom | `planTargetState` |
| `Plan.link({ from: "m03", to: "m04", … })` | `Plan.link({ from: Plan.ref("machines", "m03"), to: Plan.ref("machines", "m04"), … })` | `planSpanRows` |
| `{ key }` / a row key String in a callback | the `Plan.Types.RowId`: compare with `East.equal(ev.row, Plan.ref(…))`, or read the entry's key with `id.unwrap("entry").path.get(0n)` | `planTargetState`, `planExpand` |
| a drop's `into.row` equal to the data key | the id's text — key host tables by `East.print(Plan.ref(series, …path))` (an id is a variant, so it cannot be a `Dict` key itself), or read it back with `row.parse(Plan.Types.RowId)` | `planRowDrop` |
| `Plan.pick(key, all, { data, hidden })` — per-series row counts | `Plan.pick(key, all, { hidden })` — the library lists series by title, subtitle and kind icon; a count means something only with every entry in hand | `planPick`, `planLibraryDnd` |
| fit-to-data — an axis with no `window` and no bound slice fitted itself to the rows (inline only) | state `axis.window`, or bind a slice whose range supplies it. Written in place, the canvas is refused at build; a bound or stored axis draws the `NO WINDOW` diagnostic. A slice-bound canvas with no stated window takes its window from the slice's range — the Plan's own brush then cannot clear it (other slice chrome still can). | `planTargetState`, `planNumberAxis` |
| series keys unique per source; a repeat silently replaced rows (`LAST_WINS`) | series keys unique across the WHOLE series tree — a repeat is a build-time error naming both sites; a repeated run-time id (hand-built rows sharing a key) draws a `DUPLICATE ID` row diagnostic | — |
| `data: Dict<String, R>` only | `Dict<K, R>` for any `K`; accessors receive `(entry, key: K)`; a series whose accessors read a non-String key declares `keyType` (and a bound list types itself `Plan.Types.Series(R, K)`) | — |
| `seriesSignature` and the derived `#signature` paged id | the derived source keeps the handle's id — equivalence (#809) and revisions (#821) cover what the signature tried to | — |
| `shared/reify.ts`: `flatMapRowsBlock`, `foldEntriesToDict` | removed with the machinery they served; the series build (`series.ts`) reifies each function once and calls it | — |

### Behaviour that changed

- **Order.** A canvas's order is its series list's. Examples whose old order
  was accidental key order now follow their series (`planChartRows`,
  `planExpand`); `planGroupedRows` became one strip per line (a
  `groupToDicts` group per entry); `planNarrow`'s coverage KPI is a hand-built
  row placed by `Plan.series.rows`.
- **Paged canvases.** A paged canvas reads its windows in window order, each
  window its entries' rows with their whole subtrees. (#823 lays several
  top-level series out as blocks that page on their own — see below.)
- **Partial marks.** While a paged source is not exhausted, only a TOP-LEVEL
  section's member count and strip print `~`-marked — its members are entries
  the windows share out. Every other parent's numbers are exact, so it draws
  exactly as it does inline.
- **e3-ui.** `dataBindPagedPlan` groups its ops dataset by line
  (`Dict<String, OpsLine>`); the `Data.bindPaged` TypeDoc example follows it.

### Renderer (`@elaraai/east-ui-components`)

- DOM attributes that name a row (`data-plan-row`, `data-plan-group`,
  `data-plan-card`, `data-plan-item="r:…"`, …) carry the id's canonical text.
- The message table: `noWindowPaged` / `noWindowNumber` / `noWindowTime` are one
  `noWindow`; `duplicateRow({ id })` is new; `focusLinks` and `focusExpanded`
  take the focused row's `label` (was `key`); `PlanPart`'s `row` arm carries
  `label` beside `key`, and `partName` names a row by it; `rollupCaption` loses
  `partial` (a rollup is always exact).

## Blocks (#823)

A canvas is its series list's blocks, one after another — inline and paged
alike. Before #823 a paged canvas read each window as one stream, so two
top-level series over one source drew a window's jobs, then its loads, then
the next window's jobs: the layout depended on where the data came from. Now
each data series is a BLOCK of its entries' rows, a paged canvas pages every
block on its own over the same windows, and the canvas draws exactly as it
does inline.

### The wire

| Type | Before | After |
|---|---|---|
| `PlanBlockType` (`Plan.Types.Block`) | — | `{ fixed: Boolean, parent: Option<PlanRowIdType>, rows: Array<PlanRow> }` |
| the root's `rows` — inline arm | `Array<PlanRow>` | `Array<PlanBlock>`, block after block |
| the root's `rows` — paged arm (`PlanPagedSourceType`) | windows of `Array<PlanRow>` | windows of `Array<PlanBlock>` — each block's share of the window |
| `Plan.Types.Series(R).derive` | `Fn(Dict<K, R>) → Array<PlanRow>` | `Fn(Dict<K, R>) → Array<PlanBlock>` |

- A data series (`span`, `buckets`, `chart`, `heat`, `table`, `cards`,
  `events`, `group`, `views`) is ONE block of its entries' rows, each entry
  followed by its subtree (`fixed: false`) — the part a paged canvas pages.
- A section is its header's FIXED block, then its member series' blocks,
  each nested under the header (`parent`). A section inside an entry (a
  step-down's) stays rows of that entry.
- `Plan.series.rows` is a FIXED block: no entry produces hand-built rows, so
  every window serves them alike and the canvas draws them once.
- A host that hand-builds a Plan root serves blocks too — one
  `{ fixed: false, parent: none, rows }` block for a list of rows.

### Behaviour

- **Parents are the page unit.** A window is N top-level entries, each with
  its whole subtree, so a parent never straddles two windows: its bands,
  means, subtotals and member count are exact, and read on a partial canvas
  exactly as inline. Group a flat paged source in its dataflow, so a group is
  one entry holding its members; a parent is bounded by a page.
- **Blocks page apart.** Each paged block keeps its own ledger, bands and
  resident run; the viewport moves only the demand of the block it is in, and
  a far jump rebases the block it lands in. One read of a window serves every
  block (the window cache is shared), and a seek lands on the first block
  that shows the sought entry.
- **Bands follow the UI.** Every window a block has seen keeps its rows'
  height facts (never their content), so an evicted window's band follows a
  collapse, "collapse all", the grain, a chart toggle and an expand focus
  exactly; the rest rate a never-visited window is estimated at comes from
  the first window's height at rest. A links focus measures evicted windows as
  unfocused (its elision spans windows).
- **Nothing on screen moves.** The Plan anchors its bounded frame (#878): a
  window landing above the rows in view at a height its estimate missed moves
  the scroll by as much, not the rows.
- **Sticky parent.** A bounded frame pins the parent of the rows in view —
  and, on a deep tree, the path of its ancestors — under the header once the
  parent's own row has scrolled off; a click goes to it. Inline and paged.
- **Links into evicted windows.** A ribbon whose end sits in an evicted window
  is drawn to that window's place in its block's band, then clamps and stubs
  like any end out of view. A row never seen has no place, and its edges are
  not drawn.

### Renderer (`@elaraai/east-ui-components`)

- A band's grid item names its block: `data-plan-item="b:{block}:{head|tail}"`,
  a failed window's `f:{block}:{w}`.
- The persisted scroll anchor (#813) records the block it rests in; an anchor
  stored before #823 restores into every block's window.
- `buildRowSource` (east-ui `contracts/source.ts`) loses its `idSuffix`
  parameter: a derived source keeps the handle's id.

## Values, folds, one element callback and a bound ui (#824)

Before #824 a number on the canvas was a Float beside a display String — a
run's `qty` and `quantity`, a link's `quantity` and `label` — so a caption
could say something its sum did not. A coarser resolution stacked cells
instead of folding them: switch WEEK → MONTH over weekly cells and four heat
cells overlapped, a table cell printed four numerals and four columns
overdrew. Five callbacks reported five element kinds, a link reported
nothing, and selection, folds and focus lived only in the renderer. Now a
quantity is one value, every value folds to the axis's resolution, one
callback reports every element, and the interaction state can live with the
host.

### The wire

| Type | Before | After |
|---|---|---|
| `PlanQuantityType` (`Plan.Types.Quantity`) | — | `{ value: Float, unit: Option<String>, format: Option<TickFormat>, text: Option<String> }` |
| `PlanRunType` | `quantity: Option<String>`, `qty: Option<Float>` | `quantity: Option<PlanQuantity>` |
| `PlanLinkType` | `{ fromRow, fromRun, toRow, toRun, quantity: Float, label: String }` | `{ key: String, from: PlanRunRef, to: PlanRunRef, quantity: Option<PlanQuantity> }` |
| `PlanRunRefType` (`Plan.Types.RunRef`) | — | `{ row: PlanRowId, run: String }` — a run ref, and each end of a link |
| `PlanElementRefType` | five arms, one `Plan*ClickEventType` each | six arms: `run` (a `PlanRunRef`), `event`, `chip`, `mark`, `cell`, and `link { key, from, to }`. The five `*ClickEvent` types are removed |
| `PlanFoldType` (`Plan.Types.Fold`) | — | `sum \| mean \| min \| max \| last \| count` |
| `PlanHeatCellsType` | `heat { cells, min, max, warnAt }` \| `weight: Array<…>` \| `segments: Array<…>` | `heat { cells, scale: PlanHeatScale, fold, format }` \| `weight { cells, fold, format }` \| `segments { cells, fold, format }` |
| `PlanHeatScaleType` (`Plan.Types.HeatScale`) | — | `{ min, max, warnAt: Option<Float> }` |
| the `heat` row kind | `{ cells, aggregate }` — a parent's scale rode its empty cells | `{ cells, aggregate, scale: Option<PlanHeatScale> }` — the scale a parent's derived cells paint on |
| the `span` row kind | `unit: Option<String>` | removed — each quantity carries its unit |
| the `group` row kind | `summary: Option<PlanHeatCells>`, `summaryAggregate: Option<PlanAggregate>` | `summary: PlanGroupSummaryType` = `none \| cells(PlanHeatCells) \| aggregate(PlanAggregate)` (`Plan.Types.GroupSummary`) |
| `PlanTableSeriesType` | `strong`, `rollup: Option<Boolean>` | `strong`, `rollup: Boolean`, `fold: PlanFold` |
| chart layers `line` / `area` / `column` | — | `fold: PlanFold` |
| gutter `id` / `stacked`, row `collapsed` / `pinned`, chart `expandable`, footer `end` | `Option<Boolean>` (`none` meant `false`) | `Boolean` |
| root `onRunClick` / `onEventClick` / `onMarkClick` / `onChipClick` / `onCellClick` | five `Option<Fn>` | one `onElementClick: Option<Fn(PlanElementRef) → Null>` |
| root `ui` | — | `Option<PlanUiBindType>` — a `State.bind` handle `{ read, write, has }` (`Plan.Types.UiBind`) |
| `PlanUiStateType` (`Plan.Types.UiState`) | — | `{ selected: Option<RowId>, collapsed: Array<RowId>, expanded: Array<RowId>, charts: Array<RowId>, focus: Option<RowId> }` |
| root `id` | `String`, `""` for no drop target | `Option<String>` — `none` is no drop target |

### Removals and their replacements

| Removed | Replacement | Example |
|---|---|---|
| `Plan.run({ qty: 12, quantity: "12 t" })` | `Plan.run({ quantity: Plan.quantity(12, { unit: "t", format?, text? }) })`. The caption is `text`, or else the value printed through `format`, then the unit | `planSeriesData`, `planSpanRows` |
| `Plan.link({ from, fromRun, to, toRun, quantity: 34, label: "34 t" })` | `Plan.link({ key: "l1", from, fromRun, to, toRun, quantity: Plan.quantity(34, { unit: "t" }) })`. The `key` names the ribbon in its click ref. A ribbon with no quantity draws at the faintest weight, with no caption | `planSpanRows`, `planTargetState` |
| `Plan.series.span(R, { unit })` / `Plan.span({ unit })` | each run's `Plan.quantity(v, { unit })` — a band sums unit by unit (`208 t · 12 h`) | `planSpanRows` |
| `onRunClick` / `onEventClick` / `onMarkClick` / `onChipClick` / `onCellClick` | `onElementClick` over `Plan.Types.ElementRef`: `$.match(ref, { run: …, cell: … })` answers only the arms it names, and a ribbon click is the `link` arm | `planVariants` |
| `Plan.Types.RunClickEvent` … `CellClickEvent` | the arms of `Plan.Types.ElementRef`; a run's is `Plan.Types.RunRef` | — |
| a group given both `summary` and `summaryAggregate` | one or the other; both is refused at build | `planGroupedRows` |
| cells stacking at a coarser resolution | `fold`: `Plan.heatCells(c, { min, max, warnAt, fold, format })`, `Plan.weightCells(c, { fold, format })`, `Plan.segmentCells(c, { fold, format })`, `Plan.table({ cells, fold })`, `Plan.tableSeries({ fold })`, `Plan.series.table(R, { fold })`, `Plan.layer(layer, { fold })` | `planFold` |

A heat parent's `scale` (`Plan.series.heat(R, { scale })`,
`Plan.heat({ rows, scale })`) is written as before; it is now the parent's own
scale on the wire, not its empty cells'.

### Behaviour

- **Folds.** A row's values in one bucket fold to one value. The defaults
  are: heat and weight `mean`; segments, table numerals and columns `sum`;
  lines and areas `mean`. A bucket holding one value keeps it whole, with its
  instant, label and text. A folded cell sits at the bucket's start, and its
  click ref names that instant. A parent derives from its children's folded
  cells, so it summarises what they show. Tone strips and the narrow cards
  read the same folded cells. Scatter and band layers draw every point.
- **Quantities.** A caption prints in the viewer's language. A rollup band
  sums its runs' quantities unit by unit, and only when every run carries one.
  A ribbon's weight is its quantity's value.
- **A bound `ui`.** The canvas draws the host's state from the first frame and
  writes the user's selection, folds, opens and chart toggles back. It
  writes in a microtask after the gesture, never when nothing changed, and
  never echoes a host write back.
  - `collapsed` and `expanded` override what a row declares. A row in
    neither list follows its declaration; a row in both is collapsed.
  - `focus` is a request. The canvas opens the row's folded ancestors, and
    switches the GROUP grain to RESOURCE if that grain folds the row (the
    host's selection is kept). It scrolls the row to the top of the view and
    makes it the tab stop without moving DOM focus, then writes
    `focus: none`. On a paged canvas it first opens a window the row was
    seen in, or seeks its entry.
  - A bound canvas keeps folds and charts out of `storageKey`; the scroll
    anchor is still kept.
  - Unbound, the canvas owns this state as before (#813).

### Renderer (`@elaraai/east-ui-components`)

- The message table gains `quantity({ value, unit })` (a value and its unit)
  and `quantities({ parts })` (a band's per-unit sums, joined ` · `).

## One editing session (#879)

The Sheet's transaction session (drafts, one undoable transaction per
gesture, and Apply as one checked, idempotent batch) is now every editable
collection's. The contract moved to `@elaraai/east-ui` as the `Editing`
namespace (`src/contracts/editing.ts`). The Sheet keeps its names for it,
and each is the same value: `Sheet.apply === Editing.apply`, and
`Sheet.Types.ChangeSet === Editing.Types.ChangeSet`.

### The wire

| Type | Before | After |
|---|---|---|
| `Sheet.Types.Origin` = `Editing.Types.Origin` (a patch event's `origin`) | `typed \| pasted \| fill \| row \| pattern \| insert \| move \| remove \| undo \| redo \| discard` | adds `resize`, `drop` and `verdict` — the Plan's gestures |
| `SheetEditingType` (a Sheet root's `editing`) | its fields in the Sheet's order | the shared session's fields first (`EditingSessionFields`), then the Sheet's own; the same set of fields |
| the inline adapter's request ledger | platform `sheet_requests_read` / `sheet_requests_write` | `editing_requests_read` / `editing_requests_write` (`EditingRequestStore`) |

### What is new

- **`Editing.apply` over a keyed `Dict`.** `Editing.apply(DictType(K, E))`
  applies a batch to a keyed source. Each change names its entry by key: a
  `String` key as it is, any other key by its `.east` text. A new entry's
  placement is `keyOrder`, and an ordered placement is refused.
  `Editing.Types.Base` / `ChangeSet` / `Applied` take the key type as a
  second argument (`ChangeSet(E, K)`).
- **Renderer (`@elaraai/east-ui-components`, `src/editing/`).** The session
  (`EditSession`, was `SheetTransactions`) carries its collection's own
  projection of an entry (`W`: the Sheet's wire row, the Plan's row).
  `useEditSession` holds the per-source registry, the gate, and the base and
  reconcile reads. `HistoryBar` (was `SheetHistory`) speaks its collection's
  words, with its slots in a shared `editHistory` slot recipe. The Sheet's
  message table carries the editing session's words (`EditingMessages`), so
  a `SheetMessagesProvider` still translates the Sheet's history bar.

## Every change is a draft (#880)

Before #880 the Plan handed every change straight to the host: a verdict
called the review callbacks, and a card dropped on a row called `onDrag`. The
canvas drew nothing where a change was made, could undo nothing, and checked
no batch before it reached the source. Now every verdict and every dropped
card is a draft in the Sheet's editing session (#879), over the source's
top-level entries. A draft is drawn where it was made, undone from the
history bar or the keyboard, and applied as one checked batch.

### The wire

| Type | Before | After |
|---|---|---|
| `PlanReviewType` (`Plan.Types.Review`) | the shared review contract at the row id: `{ columnLabel, summary, onApprove, onReject, onApproveAll, onRejectAll, onRerun, rerunLabel }` | `{ columnLabel, summary, onRerun, rerunLabel }`. Table, Roster and Board keep the shared contract's callbacks |
| root `onDrag` | `Option<Fn(DragEvent) → Null>` | removed — a drop is a gesture of `editing` |
| root `editing` | — | `Option<PlanEditingType>` (`Plan.Types.Editing`): the shared session's fields (`EditingSessionFields`), then the canvas's own — `derive`, `deriveEntry`, `write`, `entryIds`, `ready`. Entries cross as bytes, so the arm stays a closed type |
| `PlanRowType.edits` | — | `PlanRowEditsType` (`Plan.Types.RowEdits`) = `{ verdict: Boolean, drop: Boolean }` — the gestures a row takes |
| `Plan.Types.Series(R, K)`, every arm | `{ key, title, subtitle, icon, derive }` | adds `write: Fn(R, K, RowId, Gesture) → Option<R>` — a gesture on one of its rows, written into the entry — so a stored or picked list carries its writer |
| `PlanGestureType` (`Plan.Types.Gesture`) | — | `verdict(ApprovalState) \| drop(PlanDrop)` |
| `PlanDropType` (`Plan.Types.Drop`) | — | `{ from: LibraryRef, row: RowId, at: Instant, duplicate: Boolean }` |
| `Plan.Types.PatchEvent(R)` | — | the shared patch event over whole-entry drafts — what `editing.onPatch` receives |
| `EditingSessionFields` (a Sheet's and a Plan's `editing`) | `keyed: Boolean` | `keyType: Option<EastTypeType>` — the key type of a keyed source. A keyed paged Sheet's batches travel keyed and are restated as the author's `ChangeSet(R)` |

### Removals and their replacements

| Removed | Replacement | Example |
|---|---|---|
| `review={{ onApprove, onReject }}` | name the entry's `ApprovalStateType` field on the reviewed series — `review: { verdict: "approval" }` — and give the root `editing`. Approve / Reject draft the entry with the field set, and the row shows the field as its approval | `planReview`, `planEditing` |
| `review={{ onApproveAll, onRejectAll }}` | nothing more: Approve all / Reject all is one gesture over every row the canvas holds that takes a verdict — on a paged canvas the loaded rows, and the foot says how many | `planReview` |
| `onDrag={fn(DragEvent)}` | `edit: { items, create }` on each series a card may land on (span / buckets / cards / events): `items` names the entry's `Array` field, and `create` builds the item from the `Plan.Types.Drop`, the entry and its key. `onPatch` observes the gesture; `onApply` / `onUpdate` commits it. `canDrop` vets it as before | `planRowDrop`, `planEditing` |
| a callback writing the verdict or the dropped item into `State` | `editing={{ onUpdate: handle.write }}` with `data={handle}` — the inline adapter applies each batch over the handle's latest `Dict` — or `onApply` for a host transaction | `planReview`, `planRowDrop` |
| `approval: r => some(r.approval)` feeding the buttons of a verdict the canvas takes | `review: { verdict: "approval" }`; `approval` stays for a verdict the canvas only shows. Giving both fails the build | `planReview` |

Each removed callback throws at build, naming its replacement.

### Behaviour

- **Drafts are drawn where they are made.** The canvas derives a drafted
  entry's rows again, exactly as Apply will leave them: a verdict repaints its
  buttons, bar and dot, and a dropped card appears where it landed. A row the
  draft changed carries the Sheet's mark (pending, incomplete or invalid), and
  so does its card in the narrow layout.
- **One gesture, one transaction.** The history bar (#879's `HistoryBar`) is
  at the end of the toolbar, and among the chips in the narrow layout. It
  holds issues, Undo, Redo, Discard, Apply (or Retry request / Retry refresh)
  and the status line. ⌘Z / Ctrl+Z undo; ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redo.
- **The base is the source's state.** An inline `Dict` is checked by its
  snapshot, a paged source by its revision. A paged `onApply` needs the
  source's `revision` and `refresh`; without them the canvas is refused at
  build. A batch against a source that moved is refused, never rebased, and
  the drafts say "Source changed — review or discard these drafts". An Apply
  that throws retries the same request. Drafts retire only once the source
  reads back at the committed revision.
- **The entries are the source's top-level entries.** A gesture on a row at
  any depth drafts the entry the row came from, and the series that made the
  row writes it. The write reaches a nested row through the series'
  `children`, which must read a field of the entry (`r => r.children`,
  `Plan.children(r => r.lines, …)`) or be the entry itself (`g => g`). A
  computed collection fails the build.
- **Without `editing` the canvas takes no gesture.** The decision buttons are
  disabled, the foot has no batch, no card lands, and there is no history bar.
  Rerun changes no data, so it stays a callback.
- **Each entry is marked for its own issues.** A batch's readiness holds
  every entry's issues under one kind. So an entry whose own check found it
  only incomplete used to read as invalid beside another entry's invalid
  issue. Now each issue carries the kind it was raised with. The fix is
  shared, so the Sheet has it too.

### Renderer (`@elaraai/east-ui-components`)

- `PlanMessages` extends `EditingMessages`, so a `PlanMessagesProvider`
  translates the canvas's history bar. It gains `approveLoaded` /
  `rejectLoaded` (`Approve 200 loaded`), the paged foot's words. A patch
  event's `label` stays in canonical English, as the Sheet's does.
- A drafted row, and its narrow card, carry `data-draft`, plus
  `data-incomplete` or `data-invalid`.
- `src/editing/draft.ts` gains `raiseIssue` / `kindOfIssue`: an issue raised
  with a kind is marked for that kind, whatever its batch's.

## Moves and resizes (#825)

Before #825 nothing on the canvas moved. The Plan took library cards and
nothing else, so a run's dates changed only in the host. Now an element on an
editable row can be picked up with the pointer, a touch or the keyboard:

- A run, chip, tile or mark moves along its row, or onto another row of the
  same item type.
- A run or chip resizes by either end.

Each move and each resize is one draft of the editing session (#880). It is
drawn where it was made, undone from the history bar, and applied in the same
checked batch as verdicts and drops.

### The wire

| Type | Before | After |
|---|---|---|
| `PlanGestureType` (`Plan.Types.Gesture`) | `verdict(ApprovalState) \| drop(PlanDrop)` | adds `move(PlanMove)` |
| `PlanMoveType` (`Plan.Types.Move`) | — | `{ key: String, from: RowId, to: RowId, start: Instant, end: Instant }`. `key` is the element's item key; `from` is the row it left and `to` the row it lands on (`from` again for a resize or a move along the row); `start` / `end` are its instants after the gesture. A tile's or a mark's `end` repeats `start` |
| `PlanRowEditsType` (`Plan.Types.RowEdits`) | `{ verdict: Boolean, drop: Boolean }` | adds `move: Option<PlanMoveEdits>` |
| `PlanMoveEditsType` (`Plan.Types.MoveEdits`) | — | `{ items: String, resize: Boolean }`. `items` is the row's item type as East prints it: an element changes rows only between rows whose items print the same. `resize` says whether its elements have two ends |
| `Plan.Types.Series(R, K)`, every arm's `write` | `Fn(R, K, RowId, Gesture) → Option<R>` | `Fn(R, K, RowId, Gesture, Ref<Option<Blob>>) → Option<R>`. The ref carries a moved item from the source row's write to the target row's, within one batch |
| `edit.create` | required | optional: a series may take moves and no cards |

### Authoring

A series whose elements move names, beside `items`, the item's key field and
the instant fields a gesture writes:

```ts
Plan.series.span(Machine, {
    key: "machines", title: "Machines", label: (m) => m.name,
    runs: (m) => m.jobs.map(($, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.name, state: j.state })),
    edit: { items: "jobs", key: "key", start: "start", end: "end", create },
})
```

- `key` names the item's `String` key field. An element's key must be its
  item's key, since the write finds the item by it. A move whose key names
  no item refuses the batch.
- With `key` declared, a row's list keeps its keys unique. A card whose item
  repeats a key the list holds is refused, and so is a move onto a row whose
  list already holds the moved item's key; the drag shows the ⊘ stage there.
  So `key` is the item's identity across every row it can move to: a job's
  own id, not its place in one machine's list.
- `start` and `end` (span, cards), or `at` (buckets, events), name the
  instant fields the move writes. A field may be one of:
  - a `DateTime`;
  - a `Float` or an `Integer` on a number axis (an `Integer` rounds half
    away from zero);
  - a `String` on an ordinal axis;
  - a `Plan.Types.Instant`.
- The build refuses a declaration a move could not write, naming the field:
  - `at` on a span or cards series, or `start` / `end` on buckets or events;
  - one of `start` / `end` without the other, or both naming one field;
  - no `key`, or a `key` that is not a `String` field;
  - an instant field of another type, or one naming the key field;
  - items that are not structs;
  - neither `create` nor instant fields.

### Behaviour

- **Snapping.** A drag moves in whole buckets of the axis's resolution. With
  Shift held it moves by one finer unit: a day under a week, month, quarter
  or year; an hour under a day; 15 minutes under an hour. A number or
  ordinal axis has no finer unit. A resize keeps at least one unit.
- **Pointer and touch.** Drag an element's body to move it, or a run's or a
  chip's start or end handle to resize it. A touch drag starts on a long
  press (#608's sensor).
- **Where it lands.** The row under the pointer draws a landing band across
  the proposed span, with the span printed in it. The ghost under the pointer
  carries the element's label and the span.
- **The veto.** `canDrop` vets the candidate before it becomes a draft. The
  candidate is a `DragEvent` `move` (the element's cell and the target cell)
  or `resize` (the moved edge's slot). A refusal is announced, and no draft
  is made.
- **Keyboard.** Focus an element and press Space to pick it up. Then:
  - ←/→ move it one bucket;
  - Shift+←/→ move its end, and Alt+←/→ its start;
  - ↑/↓ carry it to the nearest row above or below that takes it;
  - Space or Enter drops it, and Esc or Tab cancels.

  Every step is announced in the canvas's own live region. A refused place is
  announced, and the carry goes on.
- **One gesture.** A move along its row, or a resize, drafts the item's
  instants in place. A move to another row takes the item out of its list and
  appends it, with its new instants, to the target row's list. That is one
  gesture and one undo step, over two entries when the rows come from two. A
  batch that takes an item and places it nowhere, because the target refuses
  it, is refused whole.
- **Discard.** Discard drops every draft and clears the history, as on the
  Sheet; it is not itself undone.
- **No `id` needed.** The canvas's own elements move whether or not the root
  declares an `id`; a Library's card still lands only on a canvas that does.
- **Narrow layout.** The card layout takes no moves. Drops and verdicts are
  unchanged.

### Renderer (`@elaraai/east-ui-components`)

- `PlanMessages` gains `moveHelp`, `movePickedUp`, `moveOver`,
  `moveRefused`, `moveDropped`, `moveFailed` and `moveCancelled`.
- A movable element carries `data-draggable`, and `data-dragging` while it
  is carried. The landing band's text is `data-plan-drop-preview-text`, and
  the carry's live region is `data-plan-carry-announce`.
- The shared drag layer (#608) takes a payload-aware drop cell:
  `useDropCell`'s options gain `accepts(payload)`, and `resolveCoord`,
  `onHover` and `name` receive the payload.

## Extracted contracts (do this first when migrating imports)

The shared audit vocabulary outlived the Planner and moved to `contracts/`:

| Old import (planner/types.js) | New home |
|---|---|
| `PlannerStateType`, `PlannerFlavourType` | `contracts/states.ts` (same names, wire-identical) |
| `PlannerApprovalType` | use `ApprovalStateType` (`contracts/review.ts` / `approval.ts`) — structural twin, wire-identical |
| `PlannerApproveEventType` | use `RowRefType` (`contracts/review.ts` / `approval.ts`) — structural twin, wire-identical |

`Roster.Types.State`, `Board.Types.State` and `Blend.Types.State` still
resolve to `PlannerStateType` and their data round-trips unchanged.

## 1:1 recipes

Every Plan is defined ONE way: keyed `data` (`Dict<K, R>` — key it at the
call site with `rows.toDict((_$, r) => r.id)`) + `series` (`Plan.series.*`
per row series, the list the layout) + root resolvers. **Re-keying is real
migration work**: the chosen key is the path segment of every row the entry
makes — what `Plan.ref` names in `links`, what `onSelect` / review callbacks
report inside the row id, and what `seek` lands on. Pick the row's stable
domain id, never an index.

### `<Gantt>` → `<Plan>` with a span series

```tsx
// Before                                         // After
<Gantt data={rows} columns={["task","owner"]}     <Plan axis={Plan.axis({ window, resolution: "week", now })}
  rowSpec={r => ({ tasks: [Gantt.Task({            data={rows.toDict((_$, r) => r.task, (_$, r) => r)}
    start: r.start, end: r.end })] })} />           series={[Plan.series.span(Row, {
                                                      key: "jobs", title: "Jobs",
                                                      label: r => r.task, sub: r => some(r.owner),
                                                      runs: (r, k) => [Plan.run({ key: k,
                                                        start: r.start, end: r.end,
                                                        label: r.task, state: variant("confirmed", null) })],
                                                    })]} />
```

- **Lifecycle**: `Gantt.Task.state` (`PlannerStateType` shorthands) maps
  onto the richer `EventStateType` — `"committed"` → `"confirmed"` (or
  `"actual"` for observed history), `"added"` → `proposed(added)`,
  `"model"` → `proposed(recommended)`, `"removed"` → `proposed(removed)`,
  `"rejected"` → `"rejected"`. `Plan.run` accepts the same string
  shorthands plus `"estimated"` / `"in-progress"` / `"actual"`.
- **Milestones** → an `events` series (`Plan.mark({ kind: "milestone" })`);
  the interim/release distinction becomes `icon` / `label`.
- **Columns pane**: the Plan gutter carries `label` + `sub` + `value` per
  row (widen with `style.gutterWidth`). A multi-column data pane has no
  Plan equivalent by design — put extra measures in a `Plan.series.table`
  row series or a paired `<Table>`.
- **Progress fills**: `Plan.run` has no progress fraction — carry it in
  its `quantity` (`Plan.quantity(62, { unit: "%" })`) or a paired heat/table
  series.
- **axis.tier / striped / showToday**: resolution ≙ tier; `now` draws the
  divider (omit for none); striping is not part of the Plan language.
- **Task move/resize drags**: Library `add` drops (snapped bucket instants)
  are drafts of the editing session: the series declares
  `edit: { items, create }` (#880). A run moves and resizes on the same
  declaration once it names the item's key and instant fields
  (`edit: { items, key, start, end }`, #825). `onTaskProgressChange` has no
  equivalent.
- **Review**: the same chrome, but a verdict is a draft (#880). Name the
  entry's `ApprovalStateType` field on the series
  (`review: { verdict: "approval" }`) and give the root `editing`. There are
  no per-row callbacks, and nothing is addressed by `{ rowIndex }`.

### `<Planner.Point>` → `<Plan>` with a buckets series

```tsx
Plan.series.buckets(Row, {
  key: "dock", title: "Dock", label: r => r.name,
  lanes: r => [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
  events: r => r.slots.map((_$, s) => Plan.event({ key: s.key, at: s.at, lane: some(s.lane), state: s.state })),
  markers: r => r.markers,
})
```

- `Planner.event` tiles → `Plan.event` (same `tone` / `color` /
  `colorPalette` / `stretch` / `content` / `animation` channels);
  AM/PM buckets → `lanes`; `Planner.marker` → `Plan.marker`.
- `popover` / `hovercard` move OFF the tile onto the root's generalized
  `popover` / `hover` resolvers over `Plan.Types.ElementRef`.
- **Number / ordinal axes ARE carried over (#631 — reversing the call
  #571 recorded here).** A Plan's axis is `{ time | number | ordinal }`,
  declared once and carried by every element instant (`Plan.Types.Instant`
  — the Planner's slot type, verbatim):
  - `Planner.axis.time({ resolution })` → `Plan.axis({ resolution, … })`
    (the time shorthand; `Plan.axis.time` spells it);
  - `Planner.axis.number({ range, buckets })` → `Plan.axis.number({ window:
    { min, max }, step, now?, format? })` — window ÷ step = buckets, edges on
    whole steps; the horizon brush and the window keys ride the bound
    slice's `float` / `integer` range exactly as they ride `datetime`;
  - `Planner.axis.ordinal({ … })` → `Plan.axis.ordinal({ values, now? })` —
    the values are the buckets; no slice arm, no brush; an interval END
    names its LAST bucket (inclusive);
  - `Planner.at.time / .number / .ordinal` → `Plan.at.time / .number /
    .ordinal` — needed only for element RECORDS written as data (a
    `Plan.Types.HeatCell` array, a stored `Plan.Types.Run`). The element
    builders (`Plan.run` / `event` / `chip` / `mark` / `marker` / `decision`
    / `port`, `Plan.tableCells`) and the chart x accessors wrap a `Date` /
    number / string, or a `DateTime` / `Float` / `Integer` / `String`
    expression, by its type — `Plan.run({ start: j.start })` over a
    `start: FloatType` field lands on the number arm with nothing written.
  - The Planner's single-axis-kind rule holds TWICE: the kind is a TYPE —
    `Plan.axis.number(…)` fixes the tag's `K`, builders brand their results
    with the kind their instants' static types imply, series collect their
    elements' kinds, and a series on another arm fails to compile at the
    `<Plan>` tag (the brand is phantom: no wire change) — and kind-erased
    values (stored records, `$.let`-bound axes / `$.const`-bound series
    lists, East-mapped element lists, chart rows) are held to the axis at
    render by a diagnostic naming the row and the arm.
  A "day 1..8" Planner canvas is `planNumberAxis`; a workflow-phase one
  `planOrdinalAxis`.
- **DnD**: drops report the bucket START INSTANT as the slot, per the axis
  arm — time: Z-less ISO (`add.into.slot.parse(DateTimeType)`); number: a
  decimal (`parse(FloatType)`); ordinal: the value — no composite `"5:pm"`
  keys; the receiving series decides the lane. Temporal vetoes ("no drops
  left of now") are a `canDrop` predicate over the parsed slot.

### `<Planner.Span>` → `<Plan>` with a span series

Same as the Gantt recipe; `endSlot` spans become `Plan.run` start/end.

### `<AlignedStack>` → ONE `<Plan>`

The alignment contract is the Plan's whole premise: a Chart lane is a
`Plan.series.chart` row (Chart.Line/Column/Area/Scatter/Band layers AS DATA
on the shared scale), a Matrix/Trace/Calendar lane is a `heat` row, a Table
lane a `table` row, a Gantt lane a `span` row, a Planner lane a `buckets` /
`cards` row. `planTargetState` is the worked flagship. The standalone
components keep their per-component `plotGutter` prop and the renderer-side
`PlotGutterProvider` context for hand-built layouts, but there is no
gutter-imposing stack container any more.

## Example map (what guards what now)

| Retired example | Plan equivalent |
|---|---|
| `ganttBasic` | `planSeriesData`, `planSpanRows` |
| `ganttVariants` (presets/axis/fill/stress/callbacks) | `planVariants` (configurator + aside), `planSpanRows` (lifecycle flavours), `planFill` (fill + 200-row stress), `planTargetState` |
| `ganttReactiveDrag` | `planRowDrop` (a drop is a draft; Apply writes the State handle); `planEditing` (runs move and resize, #825) |
| `ganttReview` | `planReview` |
| `ganttLibraryDnd` | `planRowDrop` |
| `plannerPoint` | `planBucketRows`; its `number` axis → `planNumberAxis` (#631) |
| `plannerVariants` (states/stretch/tones/colors/markers/buckets/mixed/percell/popover/hovercard) | `planBucketRows` (incl. the colour channels), `planCardRows`, root resolvers in the per-kind panels; day/hour axes → `planVariants` sprint preset; number ranges → `planNumberAxis`, ordinal phases → `planOrdinalAxis` (#631) |
| `plannerReview` | `planReview` |
| `plannerLibraryDnd` (add + veto + review loop) | `planEditing` (drops and verdicts in one session), `planRowDrop` + `planReview` |
| `plannerSpan` | `planSpanRows` |
| `plannerFill` | `planFill` |
| `alignedStackAll` | `planTargetState` (all kinds, one axis), `planChartRows` (chart compositions) |
| `alignedStackLibraryDnd` | `planRowDrop`; `dockBesidePlan` (source panel beside the target) |

`sliceGanttChrome` → `slicePlanChrome`; `dockBesidePlanner` → `dockBesidePlan`.
