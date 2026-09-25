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
| click payloads (`Run` / `Event` / `Mark` / `Chip` / `Cell`), `ElementRef` arms, `GroupToggleEvent` | `row: String` | `row: PlanRowIdType` |
| `onSelect`, review `onApprove` / `onReject`, `expandRender`, `expandGutter` | `PlanRowRefType` (`{ key }`) | `PlanRowIdType` — `PlanRowRefType` / `Plan.Types.RowRef` are removed |
| `PlanLinkType.fromRow` / `toRow` | `String` | `PlanRowIdType` |
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
| `groupBy: [r => r.top, r => r.program]` on span / heat / table | reshape first — `rows.groupToDicts(($, r) => r.top, ($, _r, k) => k)` — and nest: `children: Plan.children((g) => g, [series…])`; a recursive entry nests with `children: (r) => r.children`, to any depth. A parent declares `rollup` / `unit` (span), `aggregate` (heat, default `"mean"`; table, default `"sum"`) and `format` as before, and derives exactly, since its whole subtree rides in its entry. A paged source is grouped in its dataflow. | `planGroupedRows`, `planSeriesData`, `planTableRows` |
| `Plan.series.group(R, { by, keyPrefix?, collapsed?, summaryAggregate? })` | `Plan.series.group(G, { key, title, label, children, summaryAggregate?, summary?, collapsed? })` over grouped entries — one strip PER ENTRY, its members the entry's children. The old form throws, naming this replacement. | `planGroupedRows`, `planNarrow` |
| `Plan.series.group(R, chrome, children)` — a static group over series | `Plan.series.section(R, { key, title, collapsed?, meta?, value?, status?, summary?, summaryAggregate? }, [series…])` | `planTargetState`, `planLibraryDnd` |
| `keySuffix` (`"m03"` → `"m03/chart"`) and `keyPrefix` | `Plan.series.views(R, { key, title, match?, children?, collapsed? }, [series…])` — one row per member per entry, adjacent and in order; each row's id is its MEMBER's key and the entry's path, and a seek on the entry lands on its first view row | `planLibraryDnd`, `planFill` |
| numbered keys to force a layout (`"10-line1"`, `"40-crewA"`) | order the series list — each series is one block, top to bottom | `planTargetState` |
| `Plan.link({ from: "m03", to: "m04", … })` | `Plan.link({ from: Plan.ref("machines", "m03"), to: Plan.ref("machines", "m04"), … })` | `planSpanRows` |
| `{ key }` / a row key String in a callback | the `Plan.Types.RowId`: compare with `East.equal(ev.row, Plan.ref(…))`, or read the entry's key with `id.unwrap("entry").path.get(0n)` | `planTargetState`, `planReview`, `planExpand` |
| a drop's `into.row` equal to the data key | the id's text — key host tables by `East.print(Plan.ref(series, …path))` (an id is a variant, so it cannot be a `Dict` key itself), or read it back with `row.parse(Plan.Types.RowId)` | `planRowDrop` |
| `Plan.pick(key, all, { data, hidden })` — per-series row counts | `Plan.pick(key, all, { hidden })` — the library lists series by title, subtitle and kind icon; a count means something only with every entry in hand | `planPick`, `planLibraryDnd` |
| fit-to-data — an axis with no `window` and no bound slice fitted itself to the rows (inline only) | state `axis.window`, or bind a slice whose range supplies it. Written in place, the canvas is refused at build; a bound or stored axis draws the `NO WINDOW` diagnostic. A slice-bound canvas with no stated window takes its window from the slice's range — the Plan's own brush then cannot clear it (other slice chrome still can). | `planTargetState`, `planNumberAxis` |
| heat series `scale` — the derived parent cells' scale | the parent's own (possibly empty) cells carry it: `cells: r => Plan.heatCells(r.cells, { min, max, warnAt })` | `planHeatRows` |
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
  `quantity` ("62%") or a paired heat/table series.
- **axis.tier / striped / showToday**: resolution ≙ tier; `now` draws the
  divider (omit for none); striping is not part of the Plan language.
- **Task move/resize drags**: not in Plan R1. The DnD target role covers
  Library `add` drops (snapped bucket instants); in-canvas move/resize of
  runs is future scope. `onTaskProgressChange` has no equivalent.
- **Review**: identical chrome; callbacks receive the row's id
  (`Plan.Types.RowId`, #822), never `{ rowIndex }`.

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
| `ganttReactiveDrag` | `planRowDrop` (drop → State → re-derive; move/resize deferred) |
| `ganttReview` | `planReview` |
| `ganttLibraryDnd` | `planRowDrop` |
| `plannerPoint` | `planBucketRows`; its `number` axis → `planNumberAxis` (#631) |
| `plannerVariants` (states/stretch/tones/colors/markers/buckets/mixed/percell/popover/hovercard) | `planBucketRows` (incl. the colour channels), `planCardRows`, root resolvers in the per-kind panels; day/hour axes → `planVariants` sprint preset; number ranges → `planNumberAxis`, ordinal phases → `planOrdinalAxis` (#631) |
| `plannerReview` | `planReview` |
| `plannerLibraryDnd` (add + veto + review loop) | `planRowDrop` + `planReview` |
| `plannerSpan` | `planSpanRows` |
| `plannerFill` | `planFill` |
| `alignedStackAll` | `planTargetState` (all kinds, one axis), `planChartRows` (chart compositions) |
| `alignedStackLibraryDnd` | `planRowDrop`; `dockBesidePlan` (source panel beside the target) |

`sliceGanttChrome` → `slicePlanChrome`; `dockBesidePlanner` → `dockBesidePlan`.
