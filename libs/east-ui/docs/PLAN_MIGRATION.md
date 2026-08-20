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

The public API break alongside it: the `Gantt` / `Planner` / `AlignedStack`
exports (tags, factories, `*.Types`) are gone from `@elaraai/east-ui` and
`@elaraai/east-ui/internal`, as are `EastChakraGantt` / `EastChakraPlanner`
from `@elaraai/east-ui-components`. `AlignedGutterType` is gone from
`shared/plot-gutter.js` (`PlotGutterType` and the per-component `plotGutter`
prop remain).

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

Every Plan is defined ONE way: keyed `data` (`Dict<String, R>` — key it at
the call site with `rows.toDict((_$, r) => r.id)`) + `series`
(`Plan.series.*` per row series) + root resolvers. **Re-keying is real
migration work**: the chosen key becomes the canvas row key — what `links`
address, what `onSelect` / review callbacks report, and what `seek` lands
on. Pick the row's stable domain id, never an index.

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
- **Review**: identical chrome; callbacks receive `{ key }` (the row key),
  never `{ rowIndex }`.

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
- **Number / ordinal axes are not carried over.** Plan is a temporal
  canvas by design. A "day 1..8" numeric axis was almost always relative
  time — anchor it to real dates (`epoch.addDays(n)`) and use `resolution:
  "day"`. A truly ordinal axis (workflow phases) is not a Plan — reach for
  `<Flowchart>`, `<Board>` or `<Matrix>`.
- **DnD**: drops report the bucket START INSTANT as the slot (Z-less ISO,
  parses as an East DateTime) — no composite `"5:pm"` keys; the receiving
  series decides the lane. Temporal vetoes ("no drops left of now") are a
  `canDrop` predicate over `add.into.slot.parse(DateTimeType)`.

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
| `plannerPoint` | `planBucketRows` |
| `plannerVariants` (states/stretch/tones/colors/markers/buckets/mixed/percell/popover/hovercard) | `planBucketRows` (incl. the colour channels), `planCardRows`, root resolvers in the per-kind panels; day/hour axes → `planVariants` sprint preset |
| `plannerReview` | `planReview` |
| `plannerLibraryDnd` (add + veto + review loop) | `planRowDrop` + `planReview` |
| `plannerSpan` | `planSpanRows` |
| `plannerFill` | `planFill` |
| `alignedStackAll` | `planTargetState` (all kinds, one axis), `planChartRows` (chart compositions) |
| `alignedStackLibraryDnd` | `planRowDrop`; `dockBesidePlan` (source panel beside the target) |

`sliceGanttChrome` → `slicePlanChrome`; `dockBesidePlanner` → `dockBesidePlan`.
