# Plan Data Interface Review — make it work like Table

**Status:** review v3 · 2026-08-14 · revises `Plan Spec.md` §4/§6
**v3 note:** v2's array-of-sources is simplified to **ONE raw data source
+ a `series` config** — each series declares one row family (a match
predicate + a kind config) over the same source, the way Table declares
columns over one dataset and a chart declares layers over one table. The
whole canvas compiles to ONE stored build function.
**v2 note:** v1 proposed materializing `PlanRowType` rows (and a skeleton
dataset) server-side via a dataflow task. Both are REJECTED — baked rows
make every local interaction a server round trip, which inverts Table's
model. v2's rule: **the wire carries raw domain data; ALL config
application happens client-side** (the renderer evaluates the stored East
functions, exactly as it evaluates Table's `render` fns). The server's only
legitimate jobs are storing, ordering, and windowing data.
**Verdict up front:** Plan's authoring surface borrowed Table's *accessor
ergonomics* but not Table's *mechanism*. Under paged data (10⁴ rows,
10²⁺ events/row, `datasetGetPage` windows) three structural decisions
break, and all three have a direct Table-shaped correction. This document
reviews every Plan interface against that standard and specifies the
redesign.

---

## 1 · What "like Table" means, mechanically

From `collections/table/index.ts` (read in full), Table's contract is five
properties working together:

| # | Property | Table's form |
|---|---|---|
| T1 | **Dumb data channel** | `rows: Array<Dict<String, LiteralValue>>` — type-erased primitives only. No UI, no functions, no recursion in a row. |
| T2 | **Config carries the types** | Columns store `dataType` / `valueType` as `EastTypeValue` — the renderer reconstructs comparators/formats without the host types. |
| T3 | **Rich content = config-level reified functions** | `render: Fn(ctx) → UIComponent` per column (default synthesized, capture-free); `rowStatus / expandedContent / reviewStatus / reviewApproval: Fn(rowIdentity) → …`. The renderer *invokes* them per visible element. Rows never embed UI. |
| T4 | **Accessors reify once** | `reifyAccessor` turns each authoring callback into ONE stored East function; the data mapping is an East expression over the data expression (evaluated with the value, not at authoring). |
| T5 | **Structure as declarations** | `groupBy` stamps printed keys; `aggregate` is a column declaration; the renderer folds and subtotals. |

The consequence of T1+T3: the data channel can be **swapped for a paged
source without touching config** — pages of dict-rows flow through the same
stored render functions. That is exactly what `datasetGetPage` +
`useDatasetPage` need: a dataset whose element type *is* the component's row
shape, windowed by `{offset, limit}`, cache-keyed by content hash.

## 2 · Where Plan violates it

**V1 — Rows carry rich, recursive content.** `PlanRowType` embeds
`OptionType(UIComponentType)` five ways (run/event/chip/mark/decision
`popover`, run/event `hovercard`) and `FunctionType` twice (`expand.render`,
via templates `make`). A paged dataset of such rows would ship UI trees and
captured closures per element — the opposite of T1, and the reason
`equalFor` memo and decode costs scale with content rather than data.

**V2 — Authoring fuses config into materialized data.** `span.of`,
`heat.of`, `table.of`, `Plan.rows` apply their accessors *while building the
rows array*. The accessors don't survive into the IR (violates T4-as-stored
+ T3); with a paged source there is nothing to apply them to at build time.
Group parents are materialized rows rather than declarations over
whatever-page-arrives.

**V3 — Structure requires the whole dataset in hand.** Renderer-derived
rollups/aggregates/summaries assume all children present; visible-order
flattening (collapse × grain) walks the full index; the elision gap bands
count hidden rows by walking them. All three need totals-and-windows
semantics instead.

Not broken: the shared scale, the state machine, links (small root data),
the recipe system, the series-centric table cells (raw values — pages
cleanly), slice chrome, DnD role, focus modes.

## 3 · Interface-by-interface review

Legend — **KEEP** unchanged · **RESHAPE** same intent, new mechanism ·
**MOVE** relocates to config/resolver.

### 3.1 Root

| Field | Verdict | Change |
|---|---|---|
| `rows: Array<PlanRowType>` | **RESHAPE** | Becomes `rows: variant<rows: Array<PlanRowType>, source: {data: TreePath, build}>` (§3.8) — inline unchanged for small canvases; ONE raw dataset + the config's build function otherwise. |
| `links` | KEEP | Small root data; under paged rows the focus gather fetches progressively (§3.7). |
| `axis / grain / slice / footer / style / Dn D / callbacks` | KEEP | — |
| `library` (templates) | KEEP | `make` returns inline subtrees; dropped rows are host-added data by definition. |
| `journeys` | KEEP | Already the correct pattern — a config-level resolver `Fn(String) → Journey`. It is the precedent V1's fix generalizes. |
| `review` | KEEP | Keyed rows (`{key}`) already — survives paging (Table's is index-keyed; ours is better here). |

### 3.2 The row envelope (`PlanRowType`)

| Field | Verdict | Change |
|---|---|---|
| `key / parent / gutter / pinned / height / status / approval` | KEEP | Plain data — pages cleanly. |
| `drill` | KEEP (data-only already) | Lines/meter/series/events are strings + floats. |
| `expand.render: Fn([], UIComponent)` | **MOVE** | Row keeps `expand: Option<{height, axis}>` (the declaration); the render moves to a ROOT resolver `expandRender: Fn(PlanRowRefType) → UIComponent` (the journeys pattern). One function total, not one per row; rows stay data. |

### 3.3 Kind payloads (the element arrays)

All element structs are data **except** their UI embeds:

| Element | Verdict | Change |
|---|---|---|
| ALL element `popover` / `hovercard` embeds (runs, events, chips, marks, decisions) | **MOVE** | TWO generalized root resolvers over one element-ref variant — every ref already carries the row id, so one function covers every subject: |

```ts
PlanElementRefType = VariantType({
    run:   PlanRunClickEventType,     // {row, run}
    event: PlanEventClickEventType,   // {row, event}
    chip:  PlanChipClickEventType,    // {row, chip}
    mark:  PlanMarkClickEventType,    // {row, mark} — decisions ride this arm
    cell:  PlanCellClickEventType,    // {row, at}
});

popover: Option<Fn(PlanElementRefType) → Option<UIComponentType>>  // click-opened
hover:   Option<Fn(PlanElementRefType) → Option<UIComponentType>>  // hovercard
```

Naming follows the codebase's resolver convention (Schematic `itemHover` /
`zoneHover` / `linkHover`, Flowchart `stateHover` — UI-returning resolvers
never take the `on` prefix; `on*` is reserved for action callbacks
returning Null). Bare `popover` / `hover` because the variant generalizes
the subject. Returning `none` for a ref means no surface opens — presence
is the author's per-element decision, made lazily at interaction time.
Everything else (runs, decisions, ports, lanes, events, markers, chips,
marks, chart layers, heat/table cells + series) is already raw data —
KEEP.

After 3.2 + 3.3, **`PlanRowType` contains no `UIComponentType` and no
`FunctionType`** — it is a storable, pageable dataset element type (T1
achieved). This is the wire-breaking core of the redesign.

### 3.4 Kind factories (`Plan.span/buckets/chart/heat/table/cards/events/group`)

**KEEP** as the inline authoring surface (they build data-only rows after
3.3 strips the embeds; the popover inputs move to root-level resolver
props). Their nested `rows:` composition stays — inline canvases keep
today's DX minus per-element popover args.

### 3.5 The data-driven forms — one source, series for the families

**RESHAPE.** ONE `data` source + a `series` prop declaring the row
families (Table's columns / Chart's layers, applied to rows). Each series
is a match predicate + a kind config; matched rows flow through that
family's accessors; literal chrome rides as a `rows` series. Canvas order
= series order.

Every kind has a series form — `Plan.series.span/buckets/chart/heat/table/
cards/events/group` — and each is data-driven: one canvas row per matched
data row, key/label/content all from accessors. `Plan.series.rows([…])` is
only for genuinely literal one-off chrome; a data-driven chart family is
just another series:

There is no config object and no `.rows()` / `.paged()` calls — the tag
takes **`data` and `series` as separate props**, exactly `Table.Root(data,
columns)`. `data` accepts a `SubtypeExprOrValue<ArrayType<R>>` (inline —
plain arrays, expressions, `Slice.rows`) **or** a `DatasetDef`/`TaskDef`
(paged). Defs are plain `{path, type, kind}` objects, never East
expressions, so the dispatch is unambiguous — the same discrimination
`Data.bind` does. The row type comes from the data (`Expr.type` /
`def.type`), the way Table infers its columns' field types.

```tsx
<Plan
    data={ops}                 // def ⇒ paged · array/expr ⇒ inline
    series={[
        Plan.series.chart({                               // family: KPI charts —
            match: r => r.kind.hasTag("kpi"),             //   one chart ROW per
            key: r => r.id, label: r => r.name, id: true, //   matched data row,
            pinned: r => r.pinned,                        //   keys from the data
            value: r => r.kind.unwrap("kpi").headline,
            layers: r => [Plan.layer(
                Chart.Line(r.kind.unwrap("kpi").points, { x: p => p.at, y: p => p.v }),
                { breach: { below: 92 } })],
        }),
        Plan.series.span({                                // family: machines
            match: r => r.kind.hasTag("machine"),
            key: r => r.id, label: r => r.id, id: true,
            runs: r => r.kind.unwrap("machine").runs,
            groupBy: [r => r.line], rollup: "union", unit: "t",
        }),
        Plan.series.group({ key: "docks", label: "Docks · In" }, [
            Plan.series.buckets({                         // family: docks, under the band
                match: r => r.kind.hasTag("dock"),
                key: r => r.id, label: r => r.name,
                events: r => r.kind.unwrap("dock").events,
            }),
        ]),
        Plan.series.table({                               // family: orders
            match: r => r.kind.hasTag("order"),
            key: r => r.id, label: r => r.name,
            cells: r => Plan.tableCells(r.kind.unwrap("order").raw),
            groupBy: [r => r.section], aggregate: "sum",
        }),
    ],
});

    ]}
    axis={Plan.axis({ resolution: "week" })}
/>
```

Beneath both arms the factory reifies the series ONCE into the single
stored build function (`Fn(Blob) → Array<PlanRowType>`): the inline arm
applies it to the data expression in the value; the source arm stores
`def.path` + the function for the renderer to run per fetched window. The
literal `rows={[…]}` prop remains for pure hand-built canvases (mutually
exclusive with `data`/`series`).

Heterogeneity lives in the DATA (a variant field discriminates families —
the natural shape of an ops dataset), and the config mirrors it with one
series per family. `span.of` / `heat.of` / `table.of` / `Plan.rows` remain
as sugar: each is a single-series `Plan.config` applied inline.

### 3.5b Helper inventory — what changes, what goes

**Removed from the namespace: nothing.** The changes are argument-level and
mechanical:

| Helpers | Count | Fate |
|---|---|---|
| `axis · link · lane · marker · port · drill · segment · markKind · heatCells · weightCells · segmentCells · tableCells · tableSeries · layer · fixed · template · Root · Types.*` | 17 + types | **Unchanged** — pure data builders; they page as-is. |
| `run · event · chip · mark · decision` | 5 | **Keep, slimmed** — lose their `popover` / `hovercard` inputs (UI moves to root resolvers). Names, other fields identical. |
| `span · buckets · chart · heat · table · cards · events · group` | 8 | **Keep** — the inline factories, now also the task-side composition vocabulary. Lose per-element popover pass-through only. |
| `span.of · heat.of · table.of · rows` | 4 | **Keep as sugar** over the new `.config` forms — same signatures, new mechanism beneath. |
| NEW: `data` + `series` root props (+ `Plan.series.span/buckets/chart/heat/table/cards/events/group/rows`) | 9 | `Table.Root(data, columns)` applied to rows: one source prop (def ⇒ paged, expr ⇒ inline), series per row family, the whole canvas reified to one stored build function. |
| NEW root props: `popover · hover` (over `PlanElementRefType`) · `expandRender` | 3 | The resolver props replacing per-element UI embeds (the `journeys` pattern; naming per Schematic/Flowchart's `*Hover` resolver convention). |

### 3.5c Usage — one paged canvas, multiple row kinds, ONE source

```tsx
// ── e3 package: ONE raw input; families discriminated by a variant field ──
const ops = e3.input("ops", ArrayType(OpsRow), []);   // OpsRow.kind: machine|dock|order

// ── the series config, reusable as a plain const ──
const SERIES = [/* chrome · kpi charts · machines · docks · orders */];

// ── the ui() task: reference + config only; pages arrive raw, build runs locally ──
const dash = e3.ui("plan", { ops }, _$ => (
    <Plan
        axis={Plan.axis({ resolution: "week", resolutions: ["week", "day"] })}
        data={ops}                     // a DatasetDef ⇒ paged automatically
        series={SERIES}
        links={transfers.map((_$, t) => Plan.link({ from: t.src, fromRun: t.run,
                                                    to: t.dst, toRun: t.dstRun,
                                                    quantity: t.qty, label: t.label }))}
        popover={East.function([Plan.Types.ElementRef], OptionType(UIComponentType),
            (_$, ref) => ref.match({
                run: (ev) => some(<Text>{East.str`Run ${ev.run} on ${ev.row}`}</Text>),
            }, (_v) => East.value(none, OptionType(UIComponentType))))}
    />
));
```

Small canvas, same props: `data={fewOps} series={SERIES}` — an array or
East expression takes the inline arm. One vocabulary, one spelling; where
the data lives decides the wire form.

### 3.6 Aggregation / rollups / summaries (V3a)

**Client-side, over loaded members, honestly partial.** Declarations are
unchanged; the renderer derives — exactly today's model — but over the
members it has loaded. A parent whose members aren't all loaded shows its
band/subtotal marked partial and refines as pages arrive; expanding a
group triggers loading its remaining pages. No server aggregation, no
baked rows. (Where exact-at-rest numbers matter for collapsed groups, the
author's recourse is an ordinary derived dataset feeding a summary row —
data engineering, not component machinery.)

### 3.7 Visible order, collapse, elision (V3b) — structure without sidecars

There is no skeleton dataset. The client learns structure from the pages
it loads, and the pager's `totalElements` bounds what it hasn't:

- **Ordering is a data property.** A paged source's dataset must be
  ordered so the config's `groupBy` keys are contiguous — the same ask any
  database makes; for derived data it's one sort in the producing
  expression, for inputs a stated contract. Contiguity makes an unloaded
  group a contiguous unknown range, never scattered holes.
- **Scrollbar / totals:** the stored count gives the extent estimate, and
  virtualizers are estimate-then-correct machines (`estimateSize` +
  `measureElement`) — heights refine as windows load. Collapsing a
  fully-loaded group is exact; a partially-loaded one corrects as its
  extent becomes known.
- **Gap bands / links focus** operate on loaded structure. Activating
  links focus starts a progressive background fetch of the remaining
  pages (a family gather is inherently a scan); counts refine as they
  land, and hash-pinned pages make the re-focus cache-warm.

### 3.8 The paged source contract

References are `Data.bind`'s vocabulary — a dataset reference IS a
`TreePathType` on the wire; the author passes the `DatasetDef`/`TaskDef`
as `data` and the factory takes `def.path` + `def.type` (the series
accessors compile-check against it, the `BoundValue<T>` guarantee).

```ts
// IR — the root's rows field:
PlanRowsType = VariantType({
    rows:   ArrayType(PlanRowType),          // inline (today's path)
    source: StructType({
        data:  TreePathType,                 // ONE raw domain dataset
        build: FunctionType([BlobType], ArrayType(PlanRowType)),
        //     ^ the config's ONE stored function — decode the window as
        //       Array<R>, run the series pipeline; evaluated by the
        //       renderer per fetched page.
    }),
});
```

Renderer plumbing: `useDatasetPage` per `{offset, limit}` window,
query-keyed by content hash with `keepPreviousData`; page bytes → `build`
→ canvas rows, in the browser. The ordering ask (§3.7) applies to the one
dataset: rows sorted so series membership and groupBy keys are contiguous.
Slice narrowing stays client-side over loaded rows; server narrowing is an
author's derived dataset, never component machinery.

### 3.9 Table-kind series, links focus, expand, brush, ruler, footer

**KEEP.** Series cells are raw floats (pages cleanly); links focus gathers
family via the progressive fetch (§3.7); expand renders via the moved
resolver; the chrome never touches row data.

## 4 · What I got wrong, plainly

The accessor DX was built as an authoring-time macro that expands over the
data, and per-element popovers/renders were left embedded in rows. Table's
actual mechanism — type-erased data + config-level reified functions — was
the requested model and is the correct one; this review adopts it fully.

## 5 · Phasing (all on the epic branch, wire-breaking allowed pre-P5)

1. **P-a — data-only rows:** strip UI/Function embeds from `PlanRowType`
   (3.2/3.3), add the root resolvers, migrate examples/fixtures. This is
   the breaking core and is independent of paging.
2. **P-b — series reification:** the `data` + `series` root props; the
   series pipeline reifies once into the stored build function;
   `.of`/`Plan.rows` become single-series sugar. Spec tests assert the
   stored function identity (one fn, applied — never expanded) and that
   the build round-trips page bytes.
3. **P-c — the source entries:** `rows` becomes the ordered entry list
   (inline | source) with client-side `build` evaluation over
   `useDatasetPage` windows (`keepPreviousData`), partial aggregates, and
   the progressive links-focus fetch. An in-memory page-server stub keeps
   the showcase and dom tests hermetic.
4. **P-d — e3 example:** a real `ui()` task over raw inputs through the
   extension's local server; the ordering contract documented; decimation
   (when render density demands it) as an authored derived dataset, never
   component machinery.

Open questions for review: (a) partial-aggregate presentation (muted
prefix vs blank until loaded); (b) the links-focus progressive-fetch cap
for very large sources. (Resolver granularity is settled: generalized
`popover` / `hover` over `PlanElementRefType`.)
