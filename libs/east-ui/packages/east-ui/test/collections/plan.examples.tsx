/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

import {
    ArrayType,
    BooleanType,
    DateTimeType,
    DictType,
    East,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    example,
    none,
    some,
    variant,
} from "@elaraai/east";
import { DragEventType, EventStateType, State, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Box, Chart, Format, HStack, Pick, Plan, Progress, Reactive, Slice, Sparkline, Text, deriveApproval } from "@elaraai/east-ui";

// The corpus — every canvas is DEFINED the one way (`Plan Data Interface.md`
// §3.5): `data` (RAW domain rows — batches, tonnes, lifecycle states; row
// series discriminated by a field; no factory-built values in the data) +
// `series` (one `Plan.series.*` value per row series, `$.const`-bound and typed
// by the `Plan.Types.Series(Row)` constructor — its accessors DERIVE the
// canvas vocabulary from the raw fields client-side: labels, quantity
// displays, element values via the `Plan.run`/`chip`/`event` expression
// builders) + the root RESOLVER functions (`popover` / `hover` /
// `expandRender`). The kind factories are subtree vocabulary only —
// library-template `make` bodies and `Plan.series.rows` one-off chrome.
// Fixtures are defined INLINE in each example's fn body (the automated docs
// extract only the fn body) and DERIVED with East expressions — a `week(n)`
// ISO-week function plus `East.Array.generate` — never hand-written per
// element; only individually-meaningful mock records stay literal, and
// lifecycle states are plain `EventStateType` variants (the shared contracts
// vocabulary a plan dataset stores).

// ============================================================================
// planTargetState — the §1 flagship (every row kind, ONE source, series)
// ============================================================================

export const planTargetState = example({
    keywords: [
        "Plan", "canvas", "data", "series", "match", "axis", "window", "resolution", "now",
        "span", "run", "group", "heat", "buckets", "cards", "chip", "events", "mark", "chart",
        "layers", "rollup", "bands", "review", "footer", "milestone",
        "decision", "exception", "pinned", "port", "hovercard", "popover",
        "slice", "brush", "horizon", "toolbar", "affordances", "expand",
        "expandRender", "resolver", "data-driven", "accessor", "raw", "target state",
    ],
    description: "The whole operation on one axis, defined the one way — ONE variant-discriminated ops source of RAW records (jobs with batch/tonnes/lifecycle, allocations, shifts with hours, load samples), a Plan.series.* entry per row series whose accessors DERIVE the canvas vocabulary client-side (run labels + quantity displays from batch/tonnes via one bound mapping function, chip labels with the proposal + prefix from hours × state, machine capacity values, tiles from allocations), the generalized popover/hover resolvers over element refs, slice chrome + the horizon brush, the R2 expand declaration with the root's expandRender resolver, review and a status footer",
    fn: East.function([], UIComponentType, (_$) => {
        const HorizonRow = StructType({ key: StringType, at: DateTimeType, line: StringType });
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        // The RAW job record — what an ops dataset stores: phase + optional
        // batch, the window, optional tonnage, the lifecycle state, an alert.
        const JobRow = StructType({
            key: StringType, phase: StringType, batch: OptionType(StringType),
            start: DateTimeType, end: DateTimeType,
            tonnes: OptionType(FloatType), state: EventStateType,
            alert: OptionType(StatusValueType),
        });
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType,
            hours: FloatType, state: EventStateType,
        });
        const AllocRow = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
        // ONE source — row series discriminated by the kind variant (the
        // natural ops-dataset shape; the same rows page from a dataset). The
        // arms carry RAW fields; presence (status / expand declaration) is
        // per-row Option DATA the accessors pass through.
        const OpsRow = StructType({
            kind: VariantType({
                kpi: StructType({ name: StringType, headline: StringType, pinned: BooleanType,
                                  points: ArrayType(MeasureRow) }),
                machine: StructType({ cap: FloatType,
                                      status: OptionType(StatusValueType),
                                      detail: OptionType(Plan.Types.Expand),
                                      jobs: ArrayType(JobRow),
                                      decisions: ArrayType(Plan.Types.DecisionMark),
                                      ports: ArrayType(Plan.Types.Port) }),
                load: StructType({ name: StringType, sub: StringType, cells: ArrayType(Plan.Types.HeatCell) }),
                dock: StructType({ name: StringType, allocations: ArrayType(AllocRow),
                                   markers: ArrayType(Plan.Types.CellMarker) }),
                crew: StructType({ name: StringType, hours: StringType, shifts: ArrayType(ShiftRow) }),
                stream: StructType({ name: StringType, marks: ArrayType(Plan.Types.EventMark) }),
            }),
        });
        const cfg = Slice.config(HorizonRow, {
            fields: { at: { label: "Despatched" }, line: { label: "Line" } },
            rangeFieldId: "at",
            searchFieldIds: ["line"],
        });

        return (<Reactive>{$ => {
            // Monday of ISO week n, 2026 (W1 Monday = 2025-12-29). The §1
            // window is W27–W38 (half-open at W39); now = W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const covPcts = $.const(
                [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2],
                ArrayType(FloatType));
            const loadPcts = $.const(
                [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0],
                ArrayType(FloatType));
            const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$, i) =>
                ({ week: week(i.add(27n)), pct: covPcts.get(i) })));
            const loadCells = $.let(East.Array.generate(12n, Plan.Types.HeatCell, (_$, i) => ({
                at: week(i.add(27n)), value: some(loadPcts.get(i)),
                label: some(East.Float.printFixed(loadPcts.get(i), 0n)),
            })));
            // 36 despatch orders spread over W21–W47 — the horizon fixture.
            const horizon = $.let(East.Array.generate(36n, HorizonRow, (_$, i) => ({
                key: East.str`h${East.print(i.add(1n))}`,
                at: week(i.multiply(27n).divide(36n).add(21n)),
                line: i.remainder(2n).equal(0n).ifElse(() => "Line 1", () => "Line 2"),
            })));
            // Raw jobs → runs: ONE bound mapping function — the bar label and
            // the quantity display/number pair derive CLIENT-SIDE from the
            // raw phase/batch/tonnes fields (the series-make application).
            const jobRuns = $.const(East.function([ArrayType(JobRow)], ArrayType(Plan.Types.Run), (_$, jobs) =>
                jobs.map(($, j) => {
                    const noQuantity = $.const(none, OptionType(StringType));
                    const quantity = $.let(j.tonnes.match({
                        some: (_$, t) => East.value(some(East.str`${East.Float.printFixed(t, 0n)} t`), OptionType(StringType)),
                        none: (_$) => noQuantity,
                    }), OptionType(StringType));
                    const label = $.let(j.batch.match({
                        some: (_$, b) => East.str`${j.phase} · ${b}`,
                        none: (_$) => j.phase,
                    }), StringType);
                    const run = $.let({
                        key: j.key, start: j.start, end: j.end, label,
                        quantity, qty: j.tonnes, state: j.state, status: j.alert,
                        moved: none, icon: none,
                    }, Plan.Types.Run);
                    return run;
                })));
            // Raw shifts → chips: hours print as the chip label, an ADDED
            // proposal wearing the `+` prefix — display derives from the
            // lifecycle, down to the proposal's flavour (a `removed` shift is
            // a proposal too, and `+` would read as its opposite).
            const shiftChips = $.const(East.function([ArrayType(ShiftRow)], ArrayType(Plan.Types.Chip), (_$, shifts) =>
                shifts.map(($, s) => {
                    const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
                    const label = $.let(s.state.match({
                        proposed: (_$, p) => p.hasTag("removed").ifElse(
                            () => East.str`${hrs}h`,
                            () => East.str`+${hrs}h`),
                    }, _$ => East.str`${hrs}h`), StringType);
                    return Plan.chip({ key: s.key, from: s.from, to: s.to, label, state: s.state });
                })));
            // The ONE ops source — every series' rows in one KEYED collection,
            // RAW: no display strings the accessors can derive, no built
            // elements. The keys are the canvas's order as well as its
            // identity (#568), so the §1 layout is expressed by naming them:
            // the ordering segment places each series, the rest is the row's
            // real id — which is what `links`, `popover` and `onSelect` speak.
            const ops = $.const(new Map([
                ["coverage", { kind: variant("kpi", { name: "COVERAGE", headline: "94.2%", pinned: true, points: coverage }) }],
                ["L1-M03", { kind: variant("machine", { cap: 120.0, status: some(variant("success", null)), detail: none,
                  jobs: [
                      { key: "set",  phase: "SET", batch: none, start: week(27n), end: week(28n), tonnes: none, state: variant("actual", null), alert: none },
                      { key: "b214", phase: "RUN", batch: some("B-214"), start: week(28n), end: week(31n), tonnes: some(96.0), state: variant("in-progress", null), alert: none },
                      { key: "cln",  phase: "CLN", batch: none, start: week(31n), end: week(32n), tonnes: none, state: variant("confirmed", null), alert: none },
                      { key: "b221", phase: "RUN", batch: some("B-221"), start: week(32n), end: week(35n), tonnes: some(88.0), state: variant("proposed", variant("recommended", null)), alert: none },
                  ],
                  decisions: [{ key: "d1", at: week(32n), applied: false }],
                  ports:     [{ at: week(31n), label: some("−24 t") }] }) }],
                ["L1-M04", { kind: variant("machine", { cap: 120.0, status: none,
                  // The expand declaration — a stored plain-data record
                  // (§3.2); presence is a per-row fact and the ROOT's
                  // expandRender mounts the body.
                  detail: some({ height: some("152px"), axis: variant("keep", null) }),
                  jobs: [
                      { key: "b208", phase: "RUN", batch: some("B-208"), start: week(27n), end: week(30n), tonnes: some(112.0), state: variant("actual", null), alert: none },
                      { key: "hld",  phase: "HLD", batch: none, start: week(30n), end: week(31n), tonnes: none, state: variant("confirmed", null), alert: none },
                      { key: "qc",   phase: "QC", batch: none, start: week(31n), end: week(33n), tonnes: none, state: variant("confirmed", null), alert: none },
                      { key: "b231", phase: "RUN", batch: some("B-231"), start: week(33n), end: week(41n), tonnes: some(104.0), state: variant("proposed", variant("recommended", null)), alert: none },
                  ],
                  decisions: [], ports: [] }) }],
                ["L1-M07", { kind: variant("machine", { cap: 80.0, status: some(variant("warning", null)), detail: none,
                  jobs: [
                      { key: "b197", phase: "HLD", batch: some("B-197"), start: week(27n), end: week(31n), tonnes: none, state: variant("actual", null), alert: some(variant("warning", null)) },
                      { key: "cln", phase: "CLN", batch: none, start: week(34n), end: week(36n), tonnes: none, state: variant("proposed", variant("recommended", null)), alert: none },
                  ],
                  decisions: [], ports: [] }) }],
                ["l2-load", { kind: variant("load", { name: "L2 load", sub: "%/wk", cells: loadCells }) }],
                ["dock2", { kind: variant("dock", { name: "Dock 2",
                  allocations: [
                      { key: "a1", at: week(27n), state: variant("confirmed", null) },
                      { key: "a2", at: week(28n), state: variant("confirmed", null) },
                      { key: "a3", at: week(29n), state: variant("confirmed", null) },
                      { key: "a4", at: week(30n), state: variant("confirmed", null) },
                      { key: "a5", at: week(31n), state: variant("proposed", variant("recommended", null)) },
                      { key: "a6", at: week(33n), state: variant("proposed", variant("recommended", null)) },
                      { key: "a7", at: week(35n), state: variant("confirmed", null) },
                      { key: "a8", at: week(35n), state: variant("proposed", variant("recommended", null)) },
                  ],
                  markers: [{ at: week(35n), lane: none, status: variant("warning", null), message: "capacity breach — 2 allocations" }] }) }],
                ["40-crewA", { kind: variant("crew", { name: "Crew A", hours: "152h → 168h", shifts: [
                    { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
                    { key: "s2", from: week(29n), to: week(31n), hours: 72.0, state: variant("confirmed", null) },
                    { key: "s3", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
                    { key: "s4", from: week(34n), to: week(35n), hours: 48.0, state: variant("estimated", null) },
                    { key: "s5", from: week(36n), to: week(38n), hours: 56.0, state: variant("proposed", variant("recommended", null)) },
                ] }) }],
                ["50-milestones", { kind: variant("stream", { name: "MILESTONES", marks: [
                    { key: "kick", at: week(28n), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                    { key: "d1", at: week(31n), kind: variant("decision", { applied: true }), icon: none, label: none },
                    { key: "rel", at: week(33n), kind: variant("milestone", null), icon: none, label: some("REL 2.4") },
                    { key: "audit", at: week(35n), kind: variant("exception", null), icon: none, label: some("AUDIT") },
                    { key: "d2", at: week(37n), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
                ] }) }],
            ]), DictType(StringType, OpsRow));
            // The series — one entry per row series, canvas order = series
            // order; the whole list is an East value typed by the constructor.
            const series = $.const([
                Plan.series.chart(OpsRow, {
                    key: "chart", title: "Chart",
                    match: r => r.kind.hasTag("kpi"),
                    label: r => r.kind.unwrap("kpi").name, id: true,
                    pinned: r => r.kind.unwrap("kpi").pinned,
                    value: r => some(r.kind.unwrap("kpi").headline),
                    status: _r => some(variant("warning", null)),
                    height: "spark", expandable: true,
                    layers: r => [
                        Plan.layer(Chart.Line(r.kind.unwrap("kpi").points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                        Chart.refLine({ y: 100, label: "TARGET 100" }),
                    ],
                }),
                Plan.series.group(OpsRow, { key: "10-line1", label: "Line 1", meta: "8 rs · 82%" }, [
                    Plan.series.span(OpsRow, {
                        key: "span", title: "Span",
                        match: r => r.kind.hasTag("machine"),
                        label: (_r, k) => k, id: true,
                        value:  r => some(East.str`${East.Float.printFixed(r.kind.unwrap("machine").cap, 0n)} t`),
                        status: r => r.kind.unwrap("machine").status,
                        expand: r => r.kind.unwrap("machine").detail,
                        runs: r => jobRuns(r.kind.unwrap("machine").jobs),
                        decisions: r => r.kind.unwrap("machine").decisions,
                        ports: r => r.kind.unwrap("machine").ports,
                    }),
                ]),
                Plan.series.group(OpsRow, { key: "20-line2", label: "Line 2", value: "98%", status: "warning", collapsed: true, summaryAggregate: "mean" }, [
                    Plan.series.heat(OpsRow, {
                        key: "heat", title: "Heat",
                        match: r => r.kind.hasTag("load"),
                        label: r => r.kind.unwrap("load").name,
                        sub: r => some(r.kind.unwrap("load").sub),
                        cells: r => Plan.heatCells(r.kind.unwrap("load").cells, { min: 0, max: 100, warnAt: 95 }),
                    }),
                ]),
                Plan.series.group(OpsRow, { key: "30-docks", label: "Docks · In", meta: "3 rs" }, [
                    Plan.series.buckets(OpsRow, {
                        key: "buckets", title: "Buckets",
                        match: r => r.kind.hasTag("dock"),
                        label: r => r.kind.unwrap("dock").name,
                        value: _r => some("load/wk"),
                        events: r => r.kind.unwrap("dock").allocations.map((_$, a) =>
                            Plan.event({ key: a.key, at: a.at, state: a.state })),
                        markers: r => r.kind.unwrap("dock").markers,
                    }),
                ]),
                Plan.series.cards(OpsRow, {
                    key: "cards", title: "Cards",
                    match: r => r.kind.hasTag("crew"),
                    label: r => r.kind.unwrap("crew").name, stacked: true,
                    sub: r => some(r.kind.unwrap("crew").hours),
                    chips: r => shiftChips(r.kind.unwrap("crew").shifts),
                }),
                Plan.series.events(OpsRow, {
                    key: "events", title: "Events",
                    match: r => r.kind.hasTag("stream"),
                    label: r => r.kind.unwrap("stream").name, id: true,
                    value: r => some(East.print(r.kind.unwrap("stream").marks.length())),
                    marks: r => r.kind.unwrap("stream").marks,
                }),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) },
                resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
            }));
            const slice = $.let(Slice.bind([HorizonRow], "ex.plan.target", cfg, Slice.state(), horizon, none));
            // The R2 developer render — the ROOT's resolver, called with the
            // focused row's ref; ONE function serves every row whose `expand`
            // accessor returned some(...). The machine series declares it.
            const util = $.let(East.Array.generate(12n, MeasureRow, (_$, i) =>
                ({ week: week(i.add(27n)), pct: i.multiply(17n).remainder(45n).toFloat().add(52.0) })));
            const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, (_$, _ref) => (
                <Chart layers={[Chart.Line(util, { x: r => r.week, y: r => r.pct })]} height={120} grid={false} />
            )));
            // The generalized element resolvers — ONE stored popover / hover
            // function each over Plan.Types.ElementRef (refs carry the row
            // key on every arm); rich bodies build lazily at interaction
            // time, and a none result opens no surface.
            const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
                const noBody = $.const(none, OptionType(UIComponentType));
                return ref.match({
                    run: (_$, ev) => ev.run.equal("b221").ifElse(
                        () => some(<Text>Proposed by run 412 — fills the W32 idle window.</Text>),
                        () => noBody),
                    mark: (_$, ev) => ev.row.equal("L1-M03").and(() => ev.mark.equal("d1")).ifElse(
                        () => some(<Text>Schedule B-221</Text>),
                        () => noBody),
                }, _$ => noBody);
            }));
            const hover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
                const noBody = $.const(none, OptionType(UIComponentType));
                return ref.match({
                    run: (_$, ev) => ev.run.equal("b197").ifElse(
                        () => some(<Text>Waiting on QC gate 4 — 2.6× median dwell.</Text>),
                        () => noBody),
                }, _$ => noBody);
            }));
            // Behavior props — bound once so memoized renderers keep identity.
            const onRowRef = $.const(East.function([Plan.Types.RowRef], NullType, (_$, _r) => null));
            const onRunClick = $.const(East.function([Plan.Types.RunClickEvent], NullType, (_$, _e) => null));
            const onGroupToggle = $.const(East.function([Plan.Types.GroupToggleEvent], NullType, (_$, _e) => null));
            const onBatch = $.const(East.function([], NullType, (_$) => null));
            return (
                <Plan
                    slice={{ slice, affordances: ["cohort", "filter", "search", "range", "resolution", "brush", "summary"] }}
                    axis={axis}
                    // The link graph (R1) — the W31 −24 t transfer: hover a
                    // linked machine for the links-focus control.
                    links={[
                        Plan.link({ from: "L1-M03", fromRun: "b214", to: "L1-M04", toRun: "qc", quantity: 24, label: "−24 t" }),
                    ]}
                    data={ops}
                    series={series}
                    review={{
                        summary: <Text>4 JOBS · 2 FLAGGED NEED A CALL · +6H FLOAT</Text>,
                        onApprove: onRowRef,
                        onReject: onRowRef,
                        onApproveAll: onBatch,
                        onRejectAll: onBatch,
                        onRerun: onBatch,
                    }}
                    expandRender={expandRender}
                    popover={popover}
                    hover={hover}
                    onSelect={onRowRef}
                    onRunClick={onRunClick}
                    onGroupToggle={onGroupToggle}
                    footer={[
                        { text: "512 RESOURCES · 12 GROUPS · 3 IN VIEW" },
                        { text: "318 OBSERVED · 966 PLANNED" },
                        { text: "3 EXCEPTIONS", tone: "warning" },
                        { text: "RUN 412 · W27–W38", end: true },
                    ]}
                />
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// Per-kind examples — one canvas per row kind; the config sweep is DATA
// ============================================================================

export const planSpanRows = example({
    keywords: ["Plan", "data", "series", "span", "run", "state", "estimated", "removed", "rejected", "decision", "port", "rollup", "union", "byStatus", "groupBy", "bands", "group", "stacked", "gutter", "links", "link", "focus", "expand", "expandRender", "match", "raw"],
    description: "Span-row series over ONE raw machine source — jobs carry phase/batch/tonnes/lifecycle and ONE bound mapping function derives every run's label and quantity pair client-side: the proposal flavours (forecast ghost, proposed cut, declined) as a value-gutter series, a stacked series whose row carries its expand declaration in the data (the root's expandRender resolver mounts the body) plus a decision diamond and port, a groupBy series with union rollup parents (renderer-derived ×k bands), a runoff despatch series, and a byStatus groupBy series inside a static series.group strip; the six-edge link graph rides the root",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        // The RAW job record; `series` picks the series, everything else —
        // including the expand declaration — is per-row data.
        const JobRow = StructType({
            key: StringType, phase: StringType, batch: OptionType(StringType),
            start: DateTimeType, end: DateTimeType,
            tonnes: OptionType(FloatType), state: EventStateType,
        });
        const MachineRow = StructType({
            series: StringType, program: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            expand: OptionType(Plan.Types.Expand),
            jobs: ArrayType(JobRow),
            decisions: ArrayType(Plan.Types.DecisionMark),
            ports: ArrayType(Plan.Types.Port),
        });
        const machines = $.const(new Map([
            // Proposal flavours: forecast ghost · proposed cut · declined.
            ["L1-M07", { series: "flavours", program: "", sub: none, value: some("80 t"), expand: none,
              jobs: [
                  { key: "run", phase: "RUN", batch: some("B-197"), start: week(27n), end: week(30n), tonnes: some(64.0), state: variant("in-progress", null) },
                  { key: "gho", phase: "FORECAST", batch: none, start: week(30n), end: week(32n), tonnes: none, state: variant("estimated", null) },
                  { key: "rem", phase: "CUT", batch: none, start: week(33n), end: week(35n), tonnes: none, state: variant("proposed", variant("removed", null)) },
                  { key: "rej", phase: "DECLINED", batch: none, start: week(36n), end: week(38n), tonnes: none, state: variant("rejected", null) },
              ], decisions: [], ports: [] }],
            // Tonnage + an applied decision + a port on a stacked two-line
            // gutter; the EXPAND DECLARATION is row data (R2) — the render is
            // the root's expandRender resolver.
            ["L1-M09", { series: "detail", program: "", sub: some("cap 120 t"), value: none,
              expand: some({ height: some("152px"), axis: variant("dim", null) }),
              jobs: [
                  { key: "a", phase: "RUN", batch: some("B-208"), start: week(27n), end: week(31n), tonnes: some(112.0), state: variant("actual", null) },
                  { key: "b", phase: "RUN", batch: some("B-231"), start: week(31n), end: week(34n), tonnes: some(104.0), state: variant("proposed", variant("recommended", null)) },
              ],
              decisions: [{ key: "d1", at: week(31n), applied: true }],
              ports: [{ at: week(31n), label: some("−24 t") }] }],
            // The rollup series — one union parent per program (renderer-derived bands).
            ["L1-M03", { series: "rollup", program: "Program A", sub: none, value: none, expand: none,
              jobs: [
                  { key: "b214", phase: "RUN", batch: some("B-214"), start: week(28n), end: week(31n), tonnes: some(96.0), state: variant("actual", null) },
                  { key: "b221", phase: "RUN", batch: some("B-221"), start: week(32n), end: week(35n), tonnes: some(88.0), state: variant("proposed", variant("recommended", null)) },
              ], decisions: [], ports: [] }],
            ["L2-M11", { series: "rollup", program: "Program A", sub: none, value: none, expand: none,
              jobs: [{ key: "b241", phase: "RUN", batch: some("B-241"), start: week(29n), end: week(33n), tonnes: some(92.0), state: variant("confirmed", null) }],
              decisions: [], ports: [] }],
            // Linked despatch whose run starts BEYOND the window — in links
            // focus its landing renders as the edge fade.
            ["dsp", { series: "despatch", program: "", sub: none, value: none, expand: none,
              jobs: [{ key: "d1", phase: "DSP", batch: none, start: week(39n), end: week(42n), tonnes: some(91.0), state: variant("proposed", variant("recommended", null)) }],
              decisions: [], ports: [] }],
            // The byStatus series inside the Line 2 strip.
            ["L2-M12", { series: "line2", program: "Program B", sub: none, value: none, expand: none,
              jobs: [
                  { key: "r1", phase: "RUN", batch: some("B-198"), start: week(28n), end: week(32n), tonnes: some(64.0), state: variant("actual", null) },
                  { key: "r2", phase: "RUN", batch: some("B-202"), start: week(30n), end: week(34n), tonnes: some(40.0), state: variant("proposed", variant("recommended", null)) },
              ], decisions: [], ports: [] }],
        ]), DictType(StringType, MachineRow));
        // Raw jobs → runs, once — every span series shares the mapping.
        const jobRuns = $.const(East.function([ArrayType(JobRow)], ArrayType(Plan.Types.Run), (_$, jobs) =>
            jobs.map(($, j) => {
                const noQuantity = $.const(none, OptionType(StringType));
                const quantity = $.let(j.tonnes.match({
                    some: (_$, t) => East.value(some(East.str`${East.Float.printFixed(t, 0n)} t`), OptionType(StringType)),
                    none: (_$) => noQuantity,
                }), OptionType(StringType));
                const label = $.let(j.batch.match({
                    some: (_$, b) => East.str`${j.phase} · ${b}`,
                    none: (_$) => j.phase,
                }), StringType);
                const run = $.let({
                    key: j.key, start: j.start, end: j.end, label,
                    quantity, qty: j.tonnes, state: j.state,
                    status: none, moved: none, icon: none,
                }, Plan.Types.Run);
                return run;
            })));
        const series = $.const([
            Plan.series.span(MachineRow, {
                key: "flavours", title: "Flavours",
                match: r => r.series.equal("flavours"),
                label: (_r, k) => k, id: true,
                value: r => r.value,
                runs: r => jobRuns(r.jobs),
            }),
            Plan.series.span(MachineRow, {
                key: "detail", title: "Detail",
                match: r => r.series.equal("detail"),
                label: (_r, k) => k, id: true, stacked: true,
                sub: r => r.sub, expand: r => r.expand,
                runs: r => jobRuns(r.jobs), decisions: r => r.decisions, ports: r => r.ports,
            }),
            Plan.series.span(MachineRow, {
                key: "rollup", title: "Rollup",
                match: r => r.series.equal("rollup"),
                label: (_r, k) => k, id: true,
                runs: r => jobRuns(r.jobs),
                groupBy: [r => r.program], rollup: "union", unit: "t",
            }),
            Plan.series.span(MachineRow, {
                key: "despatch", title: "Despatch",
                match: r => r.series.equal("despatch"),
                label: (_r, k) => k, id: true,
                runs: r => jobRuns(r.jobs),
            }),
            Plan.series.group(MachineRow, { key: "line2", label: "Line 2", meta: "1 rs" }, [
                Plan.series.span(MachineRow, {
                    key: "line2", title: "Line2",
                    match: r => r.series.equal("line2"),
                    label: (_r, k) => k, id: true,
                    runs: r => jobRuns(r.jobs),
                    groupBy: [r => r.program], rollup: "byStatus", unit: "t",
                }),
            ]),
        ], ArrayType(Plan.Types.Series(MachineRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        // The R2 developer render — the ROOT's resolver, called with the
        // focused row's ref; ONE function serves every declaring row.
        const util = $.let(East.Array.generate(8n, MeasureRow, (_$, i) =>
            ({ week: week(i.add(27n)), pct: i.multiply(13n).remainder(40n).toFloat().add(55.0) })));
        const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, (_$, _ref) => (
            <Chart layers={[Chart.Column(util, { x: r => r.week, y: r => r.pct })]} height={100} grid={false} />
        )));
        // The generalized popover resolver — decision diamonds ride the mark
        // arm of the element ref.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
            const noBody = $.const(none, OptionType(UIComponentType));
            return ref.match({
                mark: (_$, ev) => ev.mark.equal("d1").ifElse(
                    () => some(<Text>Approved by run 411.</Text>),
                    () => noBody),
            }, _$ => noBody);
        }));
        return (
            <Plan
                expandRender={expandRender}
                popover={popover}
                // A denser gutter (value + carets) — widen it (the shared
                // CSS-px height/width vocabulary).
                style={{ gutterWidth: "200px" }}
                axis={axis}
                // The link graph (R1) — hover a linked row for the ⌁ control.
                // The edges deliberately cover the routing permutations:
                // forward, a same-row seam feed, loopbacks, a rising loop,
                // and an off-window landing.
                links={[
                    Plan.link({ from: "L1-M07", fromRun: "run", to: "L1-M09", toRun: "a", quantity: 24, label: "24 t" }),
                    Plan.link({ from: "L1-M09", fromRun: "a", to: "L1-M09", toRun: "b", quantity: 40, label: "40 t" }),
                    Plan.link({ from: "L1-M09", fromRun: "b", to: "L1-M03", toRun: "b221", quantity: 88, label: "88 t" }),
                    Plan.link({ from: "L1-M03", fromRun: "b214", to: "L2-M11", toRun: "b241", quantity: 32, label: "32 t" }),
                    Plan.link({ from: "L2-M11", fromRun: "b241", to: "L1-M09", toRun: "b", quantity: 18, label: "18 t" }),
                    Plan.link({ from: "L1-M09", fromRun: "b", to: "dsp", toRun: "d1", quantity: 91, label: "91 t" }),
                ]}
                data={machines}
                series={series}
            />
        );
    }),
    inputs: [],
});

export const planBucketRows = example({
    keywords: ["Plan", "data", "series", "buckets", "Planner", "lane", "lanes", "AM", "PM", "event", "tile", "marker", "tone", "stretch", "pulse", "icon", "hovercard", "popover", "mixed", "unbucketed", "group", "match", "gutter", "raw"],
    description: "Bucket-row series over ONE dock source — an unbucketed weekly dock whose raw allocations map to resting ✓/plan tiles in the accessor, and an AM/PM-laned dock inside a static series.group strip whose tiles are STORED canvas-vocabulary records (the §3.2 pure-data element shapes: tones, a pulsing proposal, a full-cell mixed tile, an icon tile) plus a cell marker ring; tile popovers/hovercards resolve through the root over the event arm of the element ref",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const AllocRow = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
        const DockRow = StructType({
            series: StringType, label: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            lanes: ArrayType(Plan.Types.Lane),
            allocations: ArrayType(AllocRow),
            tiles: ArrayType(Plan.Types.BucketEvent),
            markers: ArrayType(Plan.Types.CellMarker),
        });
        // Raw weekly allocations; every third one is a proposal.
        const inbound = $.let(East.Array.generate(6n, AllocRow, ($, i) => {
            const confirmed = $.const(variant("confirmed", null), EventStateType);
            const recommended = $.const(variant("proposed", variant("recommended", null)), EventStateType);
            return {
                key: East.str`a${East.print(i)}`,
                at: week(i.add(27n)),
                state: i.remainder(3n).equal(2n).ifElse(() => recommended, () => confirmed),
            };
        }));
        const docks = $.const(new Map([
            ["dock2", { series: "inbound", label: "Dock 2", sub: none, value: some("load/wk"),
              lanes: [], allocations: inbound, tiles: [],
              markers: [{ at: week(29n), lane: none, status: variant("warning", null), message: "capacity 90%" }] }],
            // The grammar showcase — tiles stored IN the element vocabulary
            // (plain `PlanBucketEventType` records; no builders in data).
            ["dock5", { series: "outbound", label: "Dock 5", sub: some("day · am/pm"), value: none,
              lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
              allocations: [],
              tiles: [
                  { key: "m1", at: week(27n), lane: some("am"), label: none, icon: none, state: variant("confirmed", null),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
                  { key: "m2", at: week(27n), lane: some("pm"), label: none, icon: none, state: variant("confirmed", null),
                    tone: some(variant("warning", null)), color: none, colorPalette: none, stretch: none, content: none, animation: none },
                  { key: "m3", at: week(28n), lane: some("am"), label: none, icon: none, state: variant("proposed", variant("recommended", null)),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: some(variant("pulse", null)) },
                  { key: "m4", at: week(29n), lane: none, label: some("MIXED"), icon: none, state: variant("confirmed", null),
                    tone: none, color: none, colorPalette: none, stretch: some(variant("horizontal", null)),
                    content: some({ horizontal: some(variant("center", null)), vertical: none }), animation: none },
                  { key: "m5", at: week(30n), lane: some("pm"), label: none,
                    icon: some({ prefix: "fas", name: "truck", label: none, style: none }),
                    state: variant("proposed", variant("recommended", null)),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
                  { key: "m6", at: week(31n), lane: some("am"), label: some("QC"), icon: none, state: variant("estimated", null),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
              ],
              markers: [{ at: week(29n), lane: none, status: variant("danger", null), message: "capacity breach" }] }],
        ]), DictType(StringType, DockRow));
        const series = $.const([
            // Raw allocations → resting tiles, in the accessor.
            Plan.series.buckets(DockRow, {
                key: "inbound", title: "Inbound",
                match: r => r.series.equal("inbound"),
                label: r => r.label,
                value: r => r.value,
                events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                markers: r => r.markers,
            }),
            Plan.series.group(DockRow, { key: "outbound", label: "Docks · Out", meta: "1 rs" }, [
                // Stored vocabulary records pass straight through.
                Plan.series.buckets(DockRow, {
                    key: "outbound", title: "Outbound",
                    match: r => r.series.equal("outbound"),
                    label: r => r.label,
                    sub: r => r.sub,
                    lanes: r => r.lanes, events: r => r.tiles, markers: r => r.markers,
                }),
            ]),
        ], ArrayType(Plan.Types.Series(DockRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        // The generalized resolvers — tiles ride the event arm of the ref.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
            const noBody = $.const(none, OptionType(UIComponentType));
            return ref.match({
                event: (_$, ev) => ev.event.equal("m5").ifElse(
                    () => some(<Text>Load 41 · 8 pallets</Text>),
                    () => noBody),
            }, _$ => noBody);
        }));
        const hover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
            const noBody = $.const(none, OptionType(UIComponentType));
            return ref.match({
                event: (_$, ev) => ev.event.equal("m3").ifElse(
                    () => some(<Text>Urgent — overtime window</Text>),
                    () => noBody),
            }, _$ => noBody);
        }));
        return (
            <Plan
                popover={popover}
                hover={hover}
                axis={axis}
                data={docks}
                series={series}
            />
        );
    }),
    inputs: [],
});

export const planChartRows = example({
    keywords: ["Plan", "data", "series", "chart", "layers", "spark", "expanded", "fixed", "refLine", "refBand", "refDot", "breach", "stacked", "dual-axis", "swatches", "Area", "Band", "Scatter", "Column", "Line", "domain", "tickValues", "group", "match", "gutter", "raw"],
    description: "Chart-row series over ONE raw measure source — one series per mark kind, layers built from each row's own points via the accessor: a Line spark with a breach threshold and custom expandedHeight, an Area cumulative fill, stacked Columns pairing the row's two point sets by the Plan.layer series channel, a Scatter defect cloud, an expanded Line with refLine/refBand/refDot annotations, and a fixed 120px dual-axis composition (Chart.Root's domain/tickValues vocabulary) inside a static series.group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const BandRow = StructType({ week: DateTimeType, lo: FloatType, hi: FloatType });
        // ONE raw source — each series's points ride the row (`extra` carries
        // the second set for stacked / dual compositions).
        const ChartRow = StructType({
            series: StringType, label: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            points: ArrayType(MeasureRow),
            extra: ArrayType(MeasureRow),
            band: ArrayType(BandRow),
        });
        const pcts = $.const([96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2], ArrayType(FloatType));
        const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$, i) => ({ week: week(i.add(27n)), pct: pcts.get(i) })));
        const cum = $.let(East.Array.generate(12n, MeasureRow, (_$, i) => ({ week: week(i.add(27n)), pct: i.toFloat().multiply(14.0).add(40.0) })));
        const out1 = $.let(East.Array.generate(12n, MeasureRow, (_$, i) => ({ week: week(i.add(27n)), pct: i.multiply(23n).remainder(17n).toFloat().add(28.0) })));
        const out2 = $.let(East.Array.generate(12n, MeasureRow, (_$, i) => ({ week: week(i.add(27n)), pct: i.multiply(31n).remainder(13n).toFloat().add(14.0) })));
        const ppm = $.let(East.Array.generate(12n, MeasureRow, (_$, i) => ({ week: week(i.add(27n)), pct: i.multiply(37n).remainder(60n).toFloat().add(120.0) })));
        const band = $.let(East.Array.generate(12n, BandRow, (_$, i) => ({ week: week(i.add(27n)), lo: pcts.get(i).subtract(3.0), hi: pcts.get(i).add(3.0) })));
        const measures = $.const(new Map([
            ["spark", { series: "spark", label: "COVERAGE", sub: none, value: some("94.2%"), points: coverage, extra: [], band: [] }],
            ["cum", { series: "cum", label: "CUMULATIVE · t", sub: none, value: some("194 t"), points: cum, extra: [], band: [] }],
            ["stacked", { series: "stacked", label: "OUTPUT · t", sub: some("t/wk"), value: none, points: out1, extra: out2, band: [] }],
            ["ppm", { series: "ppm", label: "DEFECTS · ppm", sub: none, value: some("161"), points: ppm, extra: [], band: [] }],
            ["refs", { series: "refs", label: "COVERAGE + REFS", sub: none, value: none, points: coverage, extra: [], band: [] }],
            ["dual", { series: "dual", label: "OUT + COVERAGE", sub: none, value: none, points: out1, extra: coverage, band }],
        ]), DictType(StringType, ChartRow));
        const series = $.const([
            // Line — the KPI spark with a breach threshold; the caret opens
            // it to a custom 120px (expandedHeight, default 88).
            Plan.series.chart(ChartRow, {
                key: "spark", title: "Spark",
                match: r => r.series.equal("spark"),
                label: r => r.label, id: true,
                value: r => r.value, status: _r => some(variant("warning", null)),
                height: "spark", expandable: true, expandedHeight: "120px",
                layers: r => [Plan.layer(Chart.Line(r.points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } })],
            }),
            // Area — the cumulative fill.
            Plan.series.chart(ChartRow, {
                key: "cum", title: "Cumulative",
                match: r => r.series.equal("cum"),
                label: r => r.label, id: true, value: r => r.value,
                layers: r => [Chart.Area(r.points, { x: p => p.week, y: p => p.pct })],
            }),
            // Columns — the row's two point sets stacked by one series id,
            // on a two-line gutter (label over sub).
            Plan.series.chart(ChartRow, {
                key: "stacked", title: "Stacked",
                match: r => r.series.equal("stacked"),
                label: r => r.label, id: true, stacked: true, sub: r => r.sub,
                layers: r => [
                    Plan.layer(Chart.Column(r.points, { x: p => p.week, y: p => p.pct }), { series: "L1" }),
                    Plan.layer(Chart.Column(r.extra, { x: p => p.week, y: p => p.pct }), { series: "L2" }),
                ],
            }),
            // Scatter — the defect cloud.
            Plan.series.chart(ChartRow, {
                key: "ppm", title: "Ppm",
                match: r => r.series.equal("ppm"),
                label: r => r.label, id: true, value: r => r.value,
                layers: r => [Chart.Scatter(r.points, { x: p => p.week, y: p => p.pct })],
            }),
            // Line + every annotation kind, at expanded density.
            Plan.series.chart(ChartRow, {
                key: "refs", title: "Refs",
                match: r => r.series.equal("refs"),
                label: r => r.label, id: true,
                height: "expanded",
                layers: r => [
                    Plan.layer(Chart.Line(r.points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                    Chart.refLine({ y: 100, label: "TARGET 100" }),
                    Chart.refBand({ x: [week(34n), week(36n)], label: "CRUNCH" }),
                    Chart.refDot({ x: week(36n), y: 91.4, label: "LOW" }),
                ],
            }),
            // The composed dual-axis chart inside a static group strip; axes
            // take Chart.Root's vocabulary — domain / tickValues. Output
            // columns scale left; the coverage line + its band scale right.
            Plan.series.group(ChartRow, { key: "quality", label: "Quality", meta: "1 rs" }, [
                Plan.series.chart(ChartRow, {
                    key: "dual", title: "Dual",
                    match: r => r.series.equal("dual"),
                    label: r => r.label, id: true,
                    height: Plan.fixed("120px"),
                    left: { domain: [0, 60], tickValues: [0, 25, 50] },
                    right: { domain: [80, 105], tickValues: [85, 95, 105] },
                    swatches: [{ color: "ink.3", label: "out" }, { color: "brand.d", label: "cov · rh" }],
                    layers: r => [
                        Chart.Column(r.points, { x: p => p.week, y: p => p.pct }),
                        Plan.layer(Chart.Line(r.extra, { x: p => p.week, y: p => p.pct }), { axis: "right" }),
                        Plan.layer(Chart.Band(r.band, { x: p => p.week, low: p => p.lo, high: p => p.hi }), { axis: "right" }),
                    ],
                }),
            ]),
        ], ArrayType(Plan.Types.Series(ChartRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        return (
            <Plan
                axis={axis}
                data={measures}
                series={series}
            />
        );
    }),
    inputs: [],
});

export const planHeatRows = example({
    keywords: ["Plan", "data", "series", "heat", "Matrix", "cells", "depth", "aggregate", "mean", "groupBy", "scale", "warnAt", "weightCells", "segmentCells", "segment", "no-data", "hatch", "group", "match", "gutter", "raw"],
    description: "Heat-row series over ONE raw line source — per-bucket samples wrapped by the cells accessors client-side: colour-depth cells with a warn ring and a no-data hatch under a groupBy aggregate-mean parent (renderer-derived), booked-vs-free weight bars with a planned tail on a two-line sub gutter, and status-segment compositions (plain segment records) inside a static series.group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const HeatRow = StructType({
            series: StringType, line: StringType, label: StringType,
            sub: OptionType(StringType),
            cells: ArrayType(Plan.Types.HeatCell),
            weights: ArrayType(Plan.Types.WeightCell),
            segs: ArrayType(Plan.Types.SegmentCell),
        });
        const pcts = $.const(
            [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0],
            ArrayType(FloatType));
        const cells = $.let(East.Array.generate(12n, Plan.Types.HeatCell, (_$, i) => ({
            at: week(i.add(27n)),
            value: i.equal(4n).ifElse(() => none, () => some(pcts.get(i))),   // W31 = no data
            label: i.equal(4n).ifElse(() => none, () => some(East.Float.printFixed(pcts.get(i), 0n))),
        })));
        // Booked-vs-free fractions; the back half is the planned pale tail.
        const weights = $.let(East.Array.generate(6n, Plan.Types.WeightCell, (_$, i) => ({
            at: week(i.multiply(2n).add(27n)),
            fraction: i.toFloat().multiply(-0.11).add(0.9),
            planned: i.greaterEqual(3n),
        })));
        const lines = $.const(new Map([
            ["m03h", { series: "depth", line: "Line 1", label: "L1-M03", sub: none, cells, weights: [], segs: [] }],
            ["m04h", { series: "depth", line: "Line 1", label: "L1-M04", sub: none, cells, weights: [], segs: [] }],
            ["booked", { series: "booked", line: "", label: "Crew A", sub: some("booked h"), cells: [], weights, segs: [] }],
            // Segment compositions — plain `{ fill, weight, label }` records.
            ["pack", { series: "segments", line: "", label: "Pack line", sub: some("capacity"), cells: [], weights: [],
              segs: [
                  { at: week(27n), segments: [
                      { fill: variant("success", null), weight: 60.0, label: some("60%") },
                      { fill: variant("warning", null), weight: 25.0, label: some("25%") },
                      { fill: variant("slack", null), weight: 15.0, label: none },
                  ] },
                  { at: week(28n), segments: [
                      { fill: variant("success", null), weight: 70.0, label: some("70%") },
                      { fill: variant("slack", null), weight: 30.0, label: none },
                  ] },
                  { at: week(29n), segments: [
                      { fill: variant("danger", null), weight: 40.0, label: some("40%") },
                      { fill: variant("free", null), weight: 60.0, label: none },
                  ] },
              ] }],
        ]), DictType(StringType, HeatRow));
        const series = $.const([
            // The aggregate-mean parent derives per discovered line value.
            Plan.series.heat(HeatRow, {
                key: "depth", title: "Depth",
                match: r => r.series.equal("depth"),
                label: r => r.label, id: true,
                cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 95 }),
                groupBy: [r => r.line], aggregate: "mean", scale: { min: 0, max: 100, warnAt: 95 },
            }),
            Plan.series.heat(HeatRow, {
                key: "booked", title: "Booked",
                match: r => r.series.equal("booked"),
                label: r => r.label,
                sub: r => r.sub,
                cells: r => Plan.weightCells(r.weights),
            }),
            Plan.series.group(HeatRow, { key: "packing", label: "Packing", meta: "1 rs" }, [
                Plan.series.heat(HeatRow, {
                    key: "segments", title: "Segments",
                    match: r => r.series.equal("segments"),
                    label: r => r.label,
                    sub: r => r.sub,
                    cells: r => Plan.segmentCells(r.segs),
                }),
            ]),
        ], ArrayType(Plan.Types.Series(HeatRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        return (
            <Plan
                axis={axis}
                data={lines}
                series={series}
            />
        );
    }),
    inputs: [],
});

export const planTableRows = example({
    keywords: ["Plan", "data", "series", "table", "cells", "tableCells", "subtotal", "aggregate", "sum", "format", "emphasis", "footer", "groupBy", "nested", "depth", "em-dash", "neg", "match", "gutter", "tableSeries", "split", "horizontal", "vertical", "multi-value", "multi-cell", "stacked", "two-line", "strong", "muted", "rollup", "mirror", "position", "raw"],
    description: "Table-row series over ONE raw order source (per-bucket value arrays only — style lives in the SERIES CONFIG, never the data) — two-level groupBy nesting (top → program subtotal parents, every level renderer-derived), a footer-emphasis net series with a negative tone and the muted em-dash, and multi-series series whose accessors declare the per-POSITION style once — all four combinations of the two INDEPENDENT choices, since a cell split implies nothing about a gutter: horizontal beside a two-line gutter (a strong rolled-up actual and its muted always-signed \u0394) and beside a one-line one, vertical under a one-line gutter and under a two-line one (the row then grows in both directions at once) — plus the two GROUPED multi-value series, laid out side by side and stacked, whose subtotal parents mirror their members position for position rather than collapsing to one number",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const RawCell = StructType({ at: DateTimeType, value: OptionType(FloatType) });
        // The RAW order record — actuals and the plan Δ as per-bucket value
        // arrays; every display decision lives in the series configs.
        const OrderRow = StructType({
            series: StringType, name: StringType, top: StringType, program: StringType,
            sub: OptionType(StringType),
            act: ArrayType(RawCell),
            plan: ArrayType(RawCell),
        });
        const act = $.let(East.Array.generate(12n, RawCell, (_$, i) => ({
            at: week(i.add(27n)),
            value: i.equal(9n).ifElse(() => none, () => some(i.toFloat().multiply(7.0).add(40.0))),
        })));
        const deltas = $.let(East.Array.generate(12n, RawCell, (_$, i) => ({
            at: week(i.add(27n)),
            value: i.remainder(4n).equal(3n).ifElse(
                () => none,
                () => some(i.toFloat().multiply(1.5).subtract(8.0))),
        })));
        const outflow = $.let(East.Array.generate(12n, RawCell, (_$, i) => ({
            at: week(i.add(27n)),
            value: some(i.toFloat().multiply(-3.0).subtract(12.0)),
        })));
        const orders = $.const(new Map([
            // The nested series — two groupBy levels derive their subtotals.
            ["or-1188", { series: "orders", name: "OR-1188", top: "Despatches", program: "Program A", sub: none, act, plan: [] }],
            ["or-1204", { series: "orders", name: "OR-1204", top: "Despatches", program: "Program A", sub: none, act, plan: [] }],
            ["or-1219", { series: "orders", name: "OR-1219", top: "Despatches", program: "Program B", sub: none, act, plan: [] }],
            ["rt-0031", { series: "orders", name: "RT-0031", top: "Returns", program: "Program B", sub: none, act, plan: [] }],
            // Footer emphasis + negative tone + the muted em-dash.
            ["net", { series: "net", name: "Net flow", top: "", program: "", sub: none, plan: [],
              act: [
                  { at: week(27n), value: some(22.0) }, { at: week(28n), value: some(-26.0) },
                  { at: week(29n), value: none },
              ] }],
            // Multi-value series — raw act + plan arrays per row. The SPLIT
            // (how the positions sit against each other) and the GUTTER (one
            // line or two) are independent choices, so all four combinations
            // are here: the pair that reads well depends on the numbers, not
            // on the split.
            ["actplan", { series: "actplan", name: "Act · Δ plan", top: "", program: "", sub: some("t/wk"), act, plan: deltas }],
            ["inout", { series: "inout", name: "In / out", top: "", program: "", sub: none, act, plan: outflow }],
            // Horizontal, on a ONE-line gutter — the pair reads as a single
            // fact ("booked beside free"), so a sub label would only repeat it.
            ["sidebyside", { series: "sidebyside", name: "Booked · free", top: "", program: "", sub: none, act, plan: outflow }],
            // Vertical, on a TWO-line gutter — the stack needs the unit spelled
            // out, because the positions are the same measure at two times.
            ["overunder", { series: "overunder", name: "Act / plan", top: "", program: "", sub: some("t/wk"), act, plan: deltas }],
            // GROUPED and multi-value: the subtotal parent mirrors its members,
            // an act subtotal beside a Δ subtotal.
            ["fl-1", { series: "flow", name: "FL-2201", top: "Flows", program: "", sub: none, act, plan: deltas }],
            ["fl-2", { series: "flow", name: "FL-2202", top: "Flows", program: "", sub: none, act, plan: deltas }],
            // The same, STACKED: members and their subtotal both put the two
            // positions on their own lines, so the parent has to grow too.
            ["st-1", { series: "stack", name: "ST-3301", top: "Stacks", program: "", sub: none, act, plan: outflow }],
            ["st-2", { series: "stack", name: "ST-3302", top: "Stacks", program: "", sub: none, act, plan: outflow }],
        ]), DictType(StringType, OrderRow));
        const series = $.const([
            Plan.series.table(OrderRow, {
                key: "orders", title: "Orders",
                match: r => r.series.equal("orders"),
                label: r => r.name,
                cells: r => Plan.tableCells(r.act),
                groupBy: [r => r.top, r => r.program], aggregate: "sum",
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            Plan.series.table(OrderRow, {
                key: "net", title: "Net",
                match: r => r.series.equal("net"),
                label: r => r.name, emphasis: "footer",
                cells: r => Plan.tableCells(r.act),
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            // Per-POSITION style declared ONCE, in the CONFIG — a strong
            // rolled-up actual beside its muted, always-signed plan Δ.
            Plan.series.table(OrderRow, {
                key: "actplan", title: "Actual vs plan",
                match: r => r.series.equal("actplan"),
                label: r => r.name, stacked: true, sub: r => r.sub,
                series: r => [
                    Plan.tableSeries({ strong: true, rollup: true, cells: Plan.tableCells(r.act) }),
                    Plan.tableSeries({
                        tone: "muted",
                        format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                        cells: Plan.tableCells(r.plan),
                    }),
                ],
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            // The VERTICAL split stacks the positions; the row grows.
            Plan.series.table(OrderRow, {
                key: "inout", title: "Inout",
                match: r => r.series.equal("inout"),
                label: r => r.name, split: "vertical",
                series: r => [
                    Plan.tableSeries({ cells: Plan.tableCells(r.act) }),
                    Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(r.plan) }),
                ],
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            // HORIZONTAL on a ONE-line gutter — the other half of the pair
            // above: the split is a cell-layout choice and the gutter a label
            // choice, so neither implies the other.
            Plan.series.table(OrderRow, {
                key: "sidebyside", title: "Side by side",
                match: r => r.series.equal("sidebyside"),
                label: r => r.name, split: "horizontal",
                series: r => [
                    Plan.tableSeries({ strong: true, cells: Plan.tableCells(r.act) }),
                    Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(r.plan) }),
                ],
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            // A MULTI-VALUE series under a subtotal parent — every position
            // rolls up, so the parent shows an act subtotal beside a Δ subtotal
            // instead of collapsing to one number and looking complete. Flag a
            // position `rollup: true` to narrow it back to that one.
            Plan.series.table(OrderRow, {
                key: "flow", title: "Flow",
                match: r => r.series.equal("flow"),
                label: r => r.name,
                series: r => [
                    Plan.tableSeries({ strong: true, cells: Plan.tableCells(r.act) }),
                    Plan.tableSeries({
                        tone: "muted",
                        format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                        cells: Plan.tableCells(r.plan),
                    }),
                ],
                groupBy: [r => r.top], aggregate: "sum",
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            // GROUPED and VERTICAL — the subtotal stacks its positions the way
            // its members do. The parent carries no series of its own (they are
            // derived), so its height comes from the DERIVED count: estimating
            // from its own empty list would call this a one-line row and render
            // it as two.
            Plan.series.table(OrderRow, {
                key: "stack", title: "Stack",
                match: r => r.series.equal("stack"),
                label: r => r.name, split: "vertical",
                series: r => [
                    Plan.tableSeries({ strong: true, cells: Plan.tableCells(r.act) }),
                    Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(r.plan) }),
                ],
                groupBy: [r => r.top], aggregate: "sum",
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            // VERTICAL on a TWO-line gutter — the remaining combination, and
            // the one that grows the row in BOTH directions at once.
            Plan.series.table(OrderRow, {
                key: "overunder", title: "Over / under",
                match: r => r.series.equal("overunder"),
                label: r => r.name, split: "vertical", stacked: true, sub: r => r.sub,
                series: r => [
                    Plan.tableSeries({ strong: true, rollup: true, cells: Plan.tableCells(r.act) }),
                    Plan.tableSeries({
                        tone: "muted",
                        format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                        cells: Plan.tableCells(r.plan),
                    }),
                ],
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
        ], ArrayType(Plan.Types.Series(OrderRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        return (
            <Plan
                axis={axis}
                data={orders}
                series={series}
            />
        );
    }),
    inputs: [],
});

export const planCardRows = example({
    keywords: ["Plan", "data", "series", "cards", "Roster", "chip", "lifecycle", "confirmed", "recommended", "removed", "estimated", "icon", "popover", "stacked", "format", "axis", "group", "match", "gutter", "raw"],
    description: "Cards-row series over ONE crew source — a raw-shift series whose accessor derives every chip label from hours × lifecycle (the proposal + prefix; confirmed tint, proposed dashed, removed strikethrough, estimated ghost) on a stacked two-line gutter, plus a stored-vocabulary series (plain chip records with an icon) inside a static series.group strip, under a custom `axis.format` ruler; chip detail resolves through the root popover over the chip arm",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType,
            hours: FloatType, state: EventStateType,
        });
        const CrewRow = StructType({
            series: StringType, name: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            shifts: ArrayType(ShiftRow),
            chips: ArrayType(Plan.Types.Chip),
        });
        const crews = $.const(new Map([
            // RAW shifts — hours + lifecycle; chip labels derive client-side.
            ["crewA", { series: "main", name: "Crew A", sub: some("152h → 168h"), value: none, chips: [], shifts: [
                { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
                { key: "s2", from: week(29n), to: week(31n), hours: 56.0, state: variant("proposed", variant("removed", null)) },
                { key: "s3", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
                { key: "s4", from: week(34n), to: week(35n), hours: 48.0, state: variant("estimated", null) },
            ] }],
            // STORED vocabulary — plain chip records (the §3.2 element
            // shapes), here carrying the shift-type icon.
            ["crewB", { series: "pool", name: "Crew B", sub: none, value: some("128h"), shifts: [], chips: [
                { key: "b1", from: week(28n), to: week(31n), label: "96h", state: variant("confirmed", null),
                  icon: some({ prefix: "fas", name: "user-group", label: none, style: none }) },
                { key: "b2", from: week(33n), to: week(36n), label: "+32h", state: variant("proposed", variant("recommended", null)), icon: none },
            ] }],
        ]), DictType(StringType, CrewRow));
        const series = $.const([
            Plan.series.cards(CrewRow, {
                key: "main", title: "Main",
                match: r => r.series.equal("main"),
                label: r => r.name, stacked: true,
                sub: r => r.sub,
                chips: r => r.shifts.map(($, s) => {
                    const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
                    // The `+` means ADDED hours, so it rides the proposal's
                    // flavour, not the mere fact of being a proposal — a
                    // `removed` shift is a proposal too, and prefixing it `+`
                    // would read as the opposite of what it does.
                    const label = $.let(s.state.match({
                        proposed: (_$, p) => p.hasTag("removed").ifElse(
                            () => East.str`${hrs}h`,
                            () => East.str`+${hrs}h`),
                    }, _$ => East.str`${hrs}h`), StringType);
                    return Plan.chip({ key: s.key, from: s.from, to: s.to, label, state: s.state });
                }),
            }),
            Plan.series.group(CrewRow, { key: "pool", label: "Relief pool", meta: "1 rs" }, [
                Plan.series.cards(CrewRow, {
                    key: "pool", title: "Pool",
                    match: r => r.series.equal("pool"),
                    label: r => r.name,
                    value: r => r.value,
                    chips: r => r.chips,
                }),
            ]),
        ], ArrayType(Plan.Types.Series(CrewRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n), format: "D MMM" }));
        // The generalized popover resolver — chips ride the chip arm.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
            const noBody = $.const(none, OptionType(UIComponentType));
            return ref.match({
                chip: (_$, ev) => ev.chip.equal("s3").ifElse(
                    () => some(<Text>Overtime proposal.</Text>),
                    () => noBody),
            }, _$ => noBody);
        }));
        return (
            <Plan
                popover={popover}
                axis={axis}
                data={crews}
                series={series}
            />
        );
    }),
    inputs: [],
});

export const planEventRows = example({
    keywords: ["Plan", "data", "series", "events", "mark", "milestone", "decision", "exception", "markKind", "applied", "icon", "label", "popover", "group", "match", "stacked", "gutter", "raw"],
    description: "Event-row series over ONE stream source of plain mark records (the §3.2 element shapes — kind variants carry milestone/decision{applied}/exception directly) — milestone dots, pending and applied decision diamonds, an exception triangle, a custom FA glyph swap and a clustered ×3 label on a single-line gutter, plus a stacked two-line release stream inside a static series.group strip; mark detail resolves through the root popover over the mark arm",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const StreamRow = StructType({
            series: StringType, name: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            marks: ArrayType(Plan.Types.EventMark),
        });
        const streams = $.const(new Map([
            ["ms", { series: "main", name: "MILESTONES", sub: none, value: some("5"), marks: [
                { key: "kick", at: week(28n), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                { key: "d1", at: week(31n), kind: variant("decision", { applied: true }), icon: none, label: none },
                { key: "rel", at: week(33n), kind: variant("milestone", null),
                  icon: some({ prefix: "fas", name: "rocket", label: none, style: none }), label: some("REL 2.4") },
                { key: "audit", at: week(35n), kind: variant("exception", null), icon: none, label: some("AUDIT") },
                { key: "d2", at: week(37n), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
            ] }],
            ["release", { series: "programs", name: "RELEASES", sub: some("6-wk cadence"), value: none, marks: [
                { key: "r1", at: week(29n), kind: variant("milestone", null), icon: none, label: some("2.3") },
                { key: "r2", at: week(36n), kind: variant("milestone", null), icon: none, label: some("2.4") },
            ] }],
        ]), DictType(StringType, StreamRow));
        const series = $.const([
            Plan.series.events(StreamRow, {
                key: "main-2", title: "Main",
                match: r => r.series.equal("main"),
                label: r => r.name, id: true,
                value: r => r.value,
                marks: r => r.marks,
            }),
            Plan.series.group(StreamRow, { key: "programs", label: "Programs", meta: "1 rs" }, [
                Plan.series.events(StreamRow, {
                    key: "programs", title: "Programs",
                    match: r => r.series.equal("programs"),
                    label: r => r.name, id: true, stacked: true,
                    sub: r => r.sub,
                    marks: r => r.marks,
                }),
            ]),
        ], ArrayType(Plan.Types.Series(StreamRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        // The generalized popover resolver — event marks ride the mark arm.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
            const noBody = $.const(none, OptionType(UIComponentType));
            return ref.match({
                mark: (_$, ev) => ev.mark.equal("rel").ifElse(
                    () => some(<Text>Go/no-go review.</Text>),
                    () => noBody),
            }, _$ => noBody);
        }));
        return (
            <Plan
                popover={popover}
                axis={axis}
                data={streams}
                series={series}
            />
        );
    }),
    inputs: [],
});

export const planGroupedRows = example({
    keywords: ["Plan", "data", "series", "group", "groups", "strip", "by", "discovered", "summary", "summaryAggregate", "collapsed", "groupBy", "heterogeneous", "match", "meta", "nesting", "raw"],
    description: "Group-strip forms over ONE raw line source — a static expanded series.group with meta chrome around mixed-kind child series (a span series mapping raw jobs + a heat series), a static collapsed group resting as its DECLARED mean strip, and the DISCOVERED form (series.group with a `by` accessor) building one collapsed strip per distinct line value with the member-count meta",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const JobRow = StructType({
            key: StringType, batch: StringType,
            start: DateTimeType, end: DateTimeType, state: EventStateType,
        });
        const LineRow = StructType({
            series: StringType, line: StringType, label: StringType,
            jobs: ArrayType(JobRow),
            cells: ArrayType(Plan.Types.HeatCell),
        });
        const pcts = $.const(
            [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0],
            ArrayType(FloatType));
        const cells = $.let(East.Array.generate(12n, Plan.Types.HeatCell, (_$, i) => ({
            at: week(i.add(27n)),
            value: some(pcts.get(i)),
            label: some(East.Float.printFixed(pcts.get(i), 0n)),
        })));
        const lines = $.const(new Map([
            // Static Line 1 — mixed kinds (a span child + a heat child).
            ["m03", { series: "l1span", line: "", label: "L1-M03",
              jobs: [{ key: "r", batch: "B-214", start: week(28n), end: week(31n), state: variant("in-progress", null) }],
              cells: [] }],
            ["m03h", { series: "l1heat", line: "", label: "L1-M03 load", jobs: [], cells }],
            // Static collapsed Line 2 — rests as its DECLARED mean strip.
            ["l2", { series: "l2", line: "", label: "L2 load", jobs: [], cells }],
            // The DISCOVERED form — one strip per distinct line value. Named
            // apart from the static strips above so the panel reads as three
            // distinct forms rather than two repeated ones.
            ["d-m21", { series: "byline", line: "Line 3", label: "L3-M21", jobs: [], cells }],
            ["d-m22", { series: "byline", line: "Line 3", label: "L3-M22", jobs: [], cells }],
            ["d-m31", { series: "byline", line: "Line 4", label: "L4-M31", jobs: [], cells }],
        ]), DictType(StringType, LineRow));
        const series = $.const([
            Plan.series.group(LineRow, { key: "line1", label: "Line 1", meta: "2 rs · 82%" }, [
                Plan.series.span(LineRow, {
                    key: "l1span", title: "L1span",
                    match: r => r.series.equal("l1span"),
                    label: r => r.label, id: true,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end,
                        label: East.str`RUN · ${j.batch}`, state: j.state,
                    })),
                }),
                Plan.series.heat(LineRow, {
                    key: "l1heat", title: "L1heat",
                    match: r => r.series.equal("l1heat"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
            ]),
            Plan.series.group(LineRow, { key: "line2", label: "Line 2", value: "98%", status: "warning", collapsed: true, summaryAggregate: "mean" }, [
                Plan.series.heat(LineRow, {
                    key: "l2", title: "L2",
                    match: r => r.series.equal("l2"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 95 }),
                }),
            ]),
            // DISCOVERED strips — one collapsed group per distinct `by`
            // value, wearing the member-count meta.
            Plan.series.group(LineRow, {
                key: "discovered", title: "Discovered lines",
                by: r => r.line, match: r => r.series.equal("byline"),
                collapsed: true, summaryAggregate: "mean",
            }, [
                Plan.series.heat(LineRow, {
                    key: "byline", title: "By line",
                    match: r => r.series.equal("byline"),
                    label: r => r.label, id: true,
                    cells: r => Plan.heatCells(r.cells),
                }),
            ]),
        ], ArrayType(Plan.Types.Series(LineRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        return (
            <Plan
                axis={axis}
                data={lines}
                series={series}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// planSeriesData — the minimal data + series introduction
// ============================================================================

export const planSeriesData = example({
    keywords: ["Plan", "data", "series", "match", "series", "variant", "span", "cards", "group", "rows", "groupBy", "rollup", "Series", "data-driven", "accessor", "raw", "one source"],
    description: "The data + series canvas, minimally — ONE variant-discriminated RAW source (jobs with batch/tonnes/state, shifts with hours); each Plan.series.* builder (row type first) declares a row series over it via match + accessors that DERIVE the canvas vocabulary client-side (run labels + quantity pairs from batch/tonnes, chip labels with the proposal + prefix from hours × lifecycle; span with groupBy rollup parents, cards under a static series.group strip), series.rows carries literal one-off chrome, and the whole list is a $.const-bound East value typed ArrayType(Plan.Types.Series(OpsRow))",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // The RAW domain shape — series discriminated by a variant field
        // (the natural ops-dataset form; the same rows page from a dataset).
        const JobRow = StructType({
            batch: StringType, start: DateTimeType, end: DateTimeType,
            tonnes: FloatType, state: EventStateType,
        });
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType,
            hours: FloatType, state: EventStateType,
        });
        const OpsRow = StructType({
            line: StringType,
            kind: VariantType({
                machine: StructType({ jobs: ArrayType(JobRow) }),
                crew:    StructType({ shifts: ArrayType(ShiftRow) }),
            }),
        });
        const ops = $.const(new Map([
            ["L1-M03", { line: "Line 1", kind: variant("machine", { jobs: [
                { batch: "B-214", start: week(28n), end: week(31n), tonnes: 96.0, state: variant("in-progress", null) },
                { batch: "B-221", start: week(32n), end: week(35n), tonnes: 88.0, state: variant("proposed", variant("recommended", null)) },
            ] }) }],
            ["L1-M04", { line: "Line 1", kind: variant("machine", { jobs: [
                { batch: "B-208", start: week(27n), end: week(30n), tonnes: 112.0, state: variant("actual", null) },
            ] }) }],
            ["L2-M11", { line: "Line 2", kind: variant("machine", { jobs: [
                { batch: "B-241", start: week(29n), end: week(33n), tonnes: 92.0, state: variant("confirmed", null) },
            ] }) }],
            ["crewA", { line: "Line 1", kind: variant("crew", { shifts: [
                { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
                { key: "s2", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
            ] }) }],
        ]), DictType(StringType, OpsRow));
        // The series — real East values bound in the body, typed by the
        // constructor; canvas order = series order. The accessors are where
        // raw fields become canvas vocabulary: labels, quantity displays and
        // chip text all derive CLIENT-SIDE inside each series's stored make.
        const series = $.const([
            Plan.series.rows(OpsRow, { key: "chrome", title: "Milestones", subtitle: "one-off chrome" },
                [Plan.events({ key: "ms", label: "MILESTONES", id: true, marks: [
                    Plan.mark({ key: "kick", at: week(28n), kind: "milestone", label: "KICKOFF" }),
                    Plan.mark({ key: "rel", at: week(33n), kind: "milestone", label: "REL 2.4" }),
                ] })]),
            Plan.series.span(OpsRow, {
                key: "span-2", title: "Span",
                match: r => r.kind.hasTag("machine"),
                label: (_r, k) => k, id: true,
                runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                    key: j.batch, start: j.start, end: j.end,
                    label: East.str`RUN · ${j.batch}`,
                    quantity: East.str`${East.Float.printFixed(j.tonnes, 0n)} t`,
                    qty: j.tonnes, state: j.state,
                })),
                groupBy: [r => r.line], rollup: "union", unit: "t",
            }),
            Plan.series.group(OpsRow, { key: "crews", label: "Crews", meta: "1 rs" }, [
                Plan.series.cards(OpsRow, {
                    key: "cards-2", title: "Cards",
                    match: r => r.kind.hasTag("crew"),
                    label: (_r, k) => k,
                    chips: r => r.kind.unwrap("crew").shifts.map(($, s) => {
                        const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
                        // `+` marks ADDED hours — a removed proposal keeps the
                        // plain figure (see planCardRows for the full ladder).
                        const label = $.let(s.state.match({
                            proposed: (_$, p) => p.hasTag("removed").ifElse(
                                () => East.str`${hrs}h`,
                                () => East.str`+${hrs}h`),
                        }, _$ => East.str`${hrs}h`), StringType);
                        return Plan.chip({ key: s.key, from: s.from, to: s.to, label, state: s.state });
                    }),
                }),
            ]),
        ], ArrayType(Plan.Types.Series(OpsRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        return (
            <Plan
                axis={axis}
                data={ops}
                series={series}
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// planSeriesLibrary — the pickable series library (the DnD behavioral isolate)
// ============================================================================

export const planLibraryDnd = example({
    keywords: [
        "Plan", "data", "series", "library", "Pick", "pick", "Panel", "pickItems", "hidden",
        "toggle", "eye", "kind icon", "count", "DnD", "drag", "drop", "onDrag", "canDrop",
        "sources", "add", "Reactive", "State", "#590",
    ],
    description: "The series library — Plan.pick binds every series to a persisted pick, Pick.Panel lists them with their kind icon and derived row count, and Pick.active feeds the survivors back so a toggle changes the canvas with no data change; the Plan is also a DnD target with the shared onDrag funnel and a canDrop veto",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            const JobRow = StructType({
                batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
            });
            const ShiftRow = StructType({
                key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
            });
            // ONE variant-discriminated source, as every canvas has — what was
            // a template palette is now just more series over the same data.
            const OpsRow = StructType({
                kind: VariantType({
                    machine: StructType({ jobs: ArrayType(JobRow) }),
                    util:    StructType({ points: ArrayType(MeasureRow) }),
                    crew:    StructType({ shifts: ArrayType(ShiftRow) }),
                }),
            });
            const loadPcts = $.const([46.0, 58.0, 66.0, 78.0, 90.0, 98.0], ArrayType(FloatType));
            const load = $.let(East.Array.generate(6n, MeasureRow, (_$, i) =>
                ({ week: week(i.multiply(2n).add(27n)), pct: loadPcts.get(i) })));
            const ops = $.const(new Map([
                ["L1-M03", { kind: variant("machine", { jobs: [
                    { batch: "B-214", start: week(28n), end: week(31n), state: variant("in-progress", null) },
                ] }) }],
                ["L1-M04", { kind: variant("machine", { jobs: [
                    { batch: "B-208", start: week(27n), end: week(30n), state: variant("actual", null) },
                ] }) }],
                ["UTIL", { kind: variant("util", { points: load }) }],
                ["crewA", { kind: variant("crew", { shifts: [
                    { key: "s1", from: week(27n), to: week(29n), label: "80h", state: variant("confirmed", null) },
                    { key: "s2", from: week(31n), to: week(33n), label: "+64h", state: variant("proposed", variant("recommended", null)) },
                ] }) }],
            ]), DictType(StringType, OpsRow));
            const all = $.const([
                Plan.series.span(OpsRow, {
                    key: "machines", title: "Machine jobs", subtitle: "one row per machine",
                    match: r => r.kind.hasTag("machine"),
                    label: (_r, k) => k, id: true,
                    runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                        key: j.batch, start: j.start, end: j.end,
                        label: East.str`RUN · ${j.batch}`, state: j.state,
                    })),
                }),
                Plan.series.chart(OpsRow, {
                    key: "util", title: "Utilisation", subtitle: "% per fortnight",
                    match: r => r.kind.hasTag("util"),
                    label: (_r, k) => k, id: true, height: "spark",
                    layers: r => [Chart.Column(r.kind.unwrap("util").points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.cards(OpsRow, {
                    key: "crew", title: "Crew shifts", subtitle: "assignments",
                    match: r => r.kind.hasTag("crew"),
                    label: (_r, k) => k,
                    chips: r => r.kind.unwrap("crew").shifts.map((_$, s) =>
                        Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
                }),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            // The library. `data` gives each entry its row count, so a series
            // that selects nothing says `0` rather than switching on silently.
            const shown = $.let(Plan.pick("ex.plan.library", all, { data: ops, hidden: ["crew"] }));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            const onDrag = $.const(East.function([DragEventType], NullType, (_$, _e) => null));
            const canDrop = $.const(East.function([DragEventType], BooleanType, (_$, _e) => true));
            return (
                <HStack gap="4">
                    {/* The panel takes its width from the host — it mounts beside
                        a canvas, in a Drawer, or behind a toolbar chip. 320px is
                        the width the spec's figure uses. */}
                    <Box width="320px" flexShrink="0">
                        <Pick.Panel value={shown} title="Series" />
                    </Box>
                    <Plan
                        axis={axis}
                        data={ops}
                        series={Pick.active(shown)}
                        id="plan" sources={["row-library"]}
                        onDrag={onDrag}
                        canDrop={canDrop}
                    />
                </HStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planFill — the bounded sizing isolate (#320 / #567 D1)
// ============================================================================

/** Fill (#320) — `height="fill"` resolves against the bounded Box and
 *  virtualizes 200 span rows under 8 rollup parents. The bound must land on the
 *  canvas WRAPPER: a percentage passed inward resolves against an auto-height
 *  parent, computes to `auto`, and silently unbinds — the frame reports bounded,
 *  renders its spacer, and never scrolls (#567 D1).
 *
 *  The grouping is here for what it does to VIRTUALIZATION, not for the
 *  chrome. Collapsing a strip removes its 25 children from the virtualizer's
 *  item list, so `count` and the total size change while the scroll offset does
 *  not — the case where an estimate that disagrees with the rendered height
 *  shows up as drift or a jumping scrollbar. The parents also give the list two
 *  different row heights (a rollup band is taller than a leaf), so the
 *  `estimateSize` path is exercised rather than a single constant. */
export const planFill = example({
    keywords: ["Plan", "fill", "height", "maxHeight", "#320", "virtual", "virtualization", "bounded", "Box", "scroll", "sizing", "data", "series", "span", "chart", "heat", "spark", "sub", "two-line", "mixed", "variable", "estimateSize", "group", "groupBy", "rollup", "union", "collapse", "parent"],
    description: "Fill sizing over VARIABLE row heights — height=\"fill\" resolves against the bounded Box and virtualizes 200 rows of mixed kinds (span / chart spark / heat) whose gutters alternate one-line and two-line, nested under 8 groupBy rollup parents: four different heights interleaved, so a collapse changes the item count and total size mid-scroll and no constant estimate can stand in for the real one",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open).
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const UnitRow = StructType({
            line: StringType, series: StringType,
            sub: OptionType(StringType),
            start: DateTimeType, end: DateTimeType, tonnes: FloatType,
            points: ArrayType(MeasureRow),
            cells: ArrayType(Plan.Types.HeatCell),
        });
        // 200 raw rows, generated in East — the row count is the point. The
        // KEYS are the point too: they order the canvas, so they are numbered
        // to sort as written (`UNIT-1000` … `UNIT-1199`) rather than
        // lexicographically (`UNIT-1`, `UNIT-10`, `UNIT-100`, …).
        //
        // `line` is the grouping level: 8 strips of 25, so a single collapse
        // takes an eighth of the list out of the virtualizer at once.
        //
        // Everything else here exists to make the row heights DISAGREE, which
        // is the case a virtualizer gets wrong. `series` cycles span / chart /
        // heat (32 / 32 / 28px), `sub` alternates so every other row floors at
        // the 42px two-line gutter, and the rollup parents add a fourth height
        // again — so consecutive estimates differ in both directions and no
        // constant can stand in for `estimateSize`.
        const units = $.const(East.Array.range(0n, 200n).toDict(
            (_$, i) => East.str`UNIT-${East.print(i.add(1000n))}`,
            ($, i) => {
              const m = $.let(i.modulo(10n), IntegerType);
              return {
                line: East.str`LINE ${East.print(i.modulo(8n).add(1n))}`,
                // The kind cycles with the KEY, so every stretch of the canvas
                // holds the same mix — clustering the tall rows at one end
                // would leave most of the scroll a single height again.
                series: m.equal(4n).ifElse(() => "heat",
                    () => m.equal(5n).ifElse(() => "spark",
                    () => m.equal(6n).ifElse(() => "chartM",
                    () => m.equal(7n).ifElse(() => "chartL",
                    () => m.equal(8n).ifElse(() => "chartXL", () => "span"))))),
                // Alternating one-line / two-line gutters.
                sub: i.modulo(2n).equal(0n).ifElse(
                    () => some(East.str`cap ${East.print(i.modulo(9n).add(40n))} t`),
                    () => $.const(none, OptionType(StringType))),
                start: week(i.modulo(9n).add(27n)),
                end: week(i.modulo(9n).add(30n)),
                tonnes: i.toFloat().multiply(1.5).add(40.0),
                points: East.Array.generate(6n, MeasureRow, (_$, j) => ({
                    week: week(j.multiply(2n).add(27n)),
                    pct: j.multiply(17n).add(i).remainder(60n).toFloat().add(40.0),
                })),
                cells: East.Array.generate(6n, Plan.Types.HeatCell, (_$, j) => ({
                    at: week(j.multiply(2n).add(27n)),
                    value: some(j.multiply(13n).add(i).remainder(100n).toFloat()),
                    label: none,
                })),
              };
            }), DictType(StringType, UnitRow));
        // ONE discovered group per line, wrapping EVERY kind — the strip form
        // takes child series, so each line's members are all its rows whatever
        // kind they are. (`groupBy` on the span series alone would nest only
        // the spans and leave every chart / heat row a root, which sorts them
        // as a block after all eight subtrees; the chart series has no
        // `groupBy` at all.) Inside a strip the members are in KEY order, so
        // the kinds interleave the way the keys do.
        const series = $.const([
            Plan.series.group(UnitRow, { key: "lines", title: "Lines", by: r => r.line }, [
                Plan.series.span(UnitRow, {
                    key: "span-4", title: "Span",
                    match: r => r.series.equal("span"),
                    label: (_r, k) => k, id: true, sub: r => r.sub,
                    runs: (r, k) => [Plan.run({
                        key: k, start: r.start, end: r.end,
                        label: East.str`RUN · ${k}`,
                        quantity: East.str`${East.Float.printFixed(r.tonnes, 0n)} t`,
                        qty: r.tonnes, state: variant("confirmed", null),
                    })],
                }),
                // Heat rows are 28px — shorter than everything around them.
                Plan.series.heat(UnitRow, {
                    key: "heat-2", title: "Heat",
                    match: r => r.series.equal("heat"),
                    label: (_r, k) => k, id: true, sub: r => r.sub,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
                // Four chart heights. `height` is a SERIES declaration, not a
                // per-row accessor, so distinct heights mean distinct series —
                // which is the point here: a spark, then three EXPANDED rows
                // several times taller, scattered through the same key order.
                Plan.series.chart(UnitRow, {
                    key: "spark-2", title: "Spark",
                    match: r => r.series.equal("spark"),
                    label: (_r, k) => k, id: true, sub: r => r.sub,
                    height: "spark", expandable: true,
                    layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.chart(UnitRow, {
                    key: "chartM", title: "Chart · medium",
                    match: r => r.series.equal("chartM"),
                    label: (_r, k) => k, id: true, sub: r => r.sub,
                    height: Plan.fixed("72px"),
                    layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.chart(UnitRow, {
                    key: "chartL", title: "Chart · large",
                    match: r => r.series.equal("chartL"),
                    label: (_r, k) => k, id: true, sub: r => r.sub,
                    height: "expanded",
                    layers: r => [Chart.Area(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.chart(UnitRow, {
                    key: "chartXL", title: "Chart · x-large",
                    match: r => r.series.equal("chartXL"),
                    label: (_r, k) => k, id: true, sub: r => r.sub,
                    height: "expanded", expandedHeight: "140px",
                    layers: r => [Chart.Column(r.points, { x: p => p.week, y: p => p.pct })],
                }),
            ]),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        return (
            <Box height="240px">
                <Plan axis={axis} data={units} series={series} style={{ height: "fill" }} />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// planReview — the review chrome, and what a verdict is FOR (#569)
// ============================================================================

export const planReview = example({
    keywords: [
        "Plan", "review", "approval", "approve", "reject", "verdict", "decision",
        "deriveApproval", "flagged", "chrome", "batch", "foot", "onApprove",
        "onReject", "onApproveAll", "onRejectAll", "Reactive", "State", "bind",
        "write", "live", "derived", "accessor", "data",
    ],
    description: "Live review chrome — verdicts in a bound `State` dict, callbacks write it, and the canvas re-derives buttons, bar state and status dot inside a `Reactive`",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // The RAW record carries NO verdict — deciding is not a property of
            // the job, it is something the reviewer does to it. So the verdicts
            // live in their own bound state and the job rows stay untouched.
            const JobRow = StructType({
                start: DateTimeType, end: DateTimeType, tonnes: FloatType, flagged: BooleanType,
            });
            const jobs = $.const(new Map([
                ["L1-M03", { start: week(28n), end: week(31n), tonnes: 96.0,  flagged: true  }],
                ["L1-M04", { start: week(29n), end: week(33n), tonnes: 112.0, flagged: true  }],
                ["L1-M07", { start: week(30n), end: week(34n), tonnes: 64.0,  flagged: true  }],
                ["L2-M11", { start: week(27n), end: week(30n), tonnes: 88.0,  flagged: false }],
            ]), DictType(StringType, JobRow));

            // Every key is seeded, so a read is always a hit and the accessors
            // never carry a "missing" branch.
            const verdicts = $.let(State.bind([DictType(StringType, StringType)], "plan_review_verdicts",
                new Map([
                    ["L1-M03", "pending"], ["L1-M04", "approved"],
                    ["L1-M07", "rejected"], ["L2-M11", "approved"],
                ])));
            const live = $.let(verdicts.read());

            // The callbacks WRITE. `onApprove` fires with the row ref, so one
            // key changes; the batch verbs rewrite every key. Nothing else in
            // the canvas is told — it re-derives because `Reactive` re-runs.
            const setOne = $.const(East.function([StringType, StringType], NullType, ($, key, verdict) => {
                const next = $.let(verdicts.read());
                $(next.insertOrUpdate(key, verdict));
                $(verdicts.write(next));
            }));
            const setAll = $.const(East.function([StringType], NullType, ($, verdict) => {
                const next = $.let(new Map<string, string>(), DictType(StringType, StringType));
                $(jobs.forEach((_$, _r, k) => next.insertOrUpdate(k, verdict)));
                $(verdicts.write(next));
            }));
            const onApprove = $.const(East.function([Plan.Types.RowRef], NullType,
                ($, ref) => { $(setOne(ref.key, "approved")); }));
            const onReject = $.const(East.function([Plan.Types.RowRef], NullType,
                ($, ref) => { $(setOne(ref.key, "rejected")); }));
            const onApproveAll = $.const(East.function([], NullType, ($) => { $(setAll("approved")); }));
            const onRejectAll = $.const(East.function([], NullType, ($) => { $(setAll("rejected")); }));
            const onRerun = $.const(East.function([], NullType, ($) => { $(setAll("pending")); }));

            const series = $.const([
                Plan.series.span(JobRow, {
                    key: "span-5", title: "Span",
                    label: (_r, k) => k, id: true,
                    value: r => some(East.str`${East.Float.printFixed(r.tonnes, 0n)} t`),
                    // Seeds the BUTTONS from the live verdict. `deriveApproval`
                    // covers the undecided case — "clean rests pre-approved,
                    // flagged awaits an explicit call".
                    approval: (r, k) => live.get(k).equal("approved").ifElse(
                        () => some(variant("approved", null)),
                        () => live.get(k).equal("rejected").ifElse(
                            () => some(variant("rejected", null)),
                            () => deriveApproval(r.flagged))),
                    // ...and the SAME fact drives the bar and the dot, because
                    // appearance is derived like everything else. Click Approve
                    // and this repaints — the chrome never touched it.
                    status: (r, k) => live.get(k).equal("rejected").ifElse(
                        () => some(variant("danger", null)),
                        () => r.flagged.and(_$ => live.get(k).equal("pending")).ifElse(
                            () => some(variant("warning", null)),
                            () => none)),
                    runs: (r, k) => [Plan.run({
                        key: k, start: r.start, end: r.end,
                        label: East.str`RUN · ${k}`,
                        quantity: East.str`${East.Float.printFixed(r.tonnes, 0n)} t`,
                        qty: r.tonnes,
                        state: live.get(k).equal("approved").ifElse(
                            () => variant("confirmed", null),
                            () => live.get(k).equal("rejected").ifElse(
                                () => variant("rejected", null),
                                () => variant("proposed", variant("recommended", null)))),
                    })],
                }),
            ], ArrayType(Plan.Types.Series(JobRow)));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
            }));
            const counts = $.let(live.filter((_$, v) => v.equal("pending")).size());
            const rejected = $.let(live.filter((_$, v) => v.equal("rejected")).size());
            return (
                <Plan
                    axis={axis}
                    data={jobs}
                    series={series}
                    review={{
                        summary: <Text>{East.str`${East.Float.printFixed(counts.toFloat(), 0n)} PENDING · ${East.Float.printFixed(rejected.toFloat(), 0n)} REJECTED`}</Text>,
                        onApprove, onReject, onApproveAll, onRejectAll, onRerun,
                    }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * R2 expand-in-place — the one example that shows the whole gesture.
 *
 * Expand is two halves and needs BOTH: a per-row `expand` declaration (data,
 * so it flows through an accessor like every other envelope field) and the
 * ROOT's `expandRender` resolver, which builds the mounted body from the row
 * ref. Neither alone shows the control.
 *
 * The rows here are deliberately heterogeneous — span, chart, heat, table,
 * events — because focusing one is what makes the other five collapse, and
 * each row KIND collapses differently (#591): geometry shrinks, values
 * re-encode as a tone strip, shapes keep their silhouette.
 */
export const planExpand = example({
    keywords: ["Plan", "expand", "expandRender", "axis", "keep", "dim", "off", "focus", "R2", "collapse", "context strip", "row", "data", "series", "chart", "heat", "table", "events", "span", "raw"],
    description: "Expand-in-place — rows declare `expand` with an axis mode, one root `expandRender` fills the plot and `expandGutter` the grown gutter; unfocused rows collapse to 16px strips",
    fn: East.function([], UIComponentType, ($) => {
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // ONE raw source; `series` picks the series and `expand` is per-row
        // DATA — presence is what grows the ⤢ control on that row.
        const OpsRow = StructType({
            series: StringType,
            label: StringType,
            expand: OptionType(Plan.Types.Expand),
            jobs: ArrayType(StructType({
                key: StringType, label: StringType,
                start: DateTimeType, end: DateTimeType, state: EventStateType,
            })),
            cells: ArrayType(Plan.Types.HeatCell),
            nums: ArrayType(Plan.Types.TableCell),
            marks: ArrayType(Plan.Types.EventMark),
        });
        const noJobs = $.const([], ArrayType(StructType({
            key: StringType, label: StringType,
            start: DateTimeType, end: DateTimeType, state: EventStateType,
        })));
        const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
        const noNums = $.const([], ArrayType(Plan.Types.TableCell));
        const noMarks = $.const([], ArrayType(Plan.Types.EventMark));
        const ops = $.const(new Map([
            // axis: keep — the grid and now-line run THROUGH the render.
            ["L1-M03", { series: "span", label: "L1-M03",
              expand: some({ height: some("168px"), axis: variant("keep", null) }),
              jobs: [
                  { key: "b208", label: "RUN · B-208", start: week(27n), end: week(30n), state: variant("actual", null) },
                  { key: "qc", label: "QC", start: week(30n), end: week(32n), state: variant("confirmed", null) },
                  { key: "b231", label: "RUN · B-231", start: week(33n), end: week(38n), state: variant("proposed", variant("recommended", null)) },
              ], cells: noCells, nums: noNums, marks: noMarks }],
            // axis: dim — washed to 40% behind a dense render.
            ["L1-M04", { series: "span", label: "L1-M04",
              expand: some({ height: some("140px"), axis: variant("dim", null) }),
              jobs: [
                  { key: "b214", label: "RUN · B-214", start: week(28n), end: week(33n), state: variant("in-progress", null) },
              ], cells: noCells, nums: noNums, marks: noMarks }],
            // No declaration — no control. The contrast is the point: one row
            // that cannot be expanded beside five that can.
            ["L1-M07", { series: "span", label: "L1-M07", expand: none,
              jobs: [
                  { key: "hld", label: "HLD · B-197", start: week(27n), end: week(31n), state: variant("actual", null) },
              ], cells: noCells, nums: noNums, marks: noMarks }],
            // The kinds that COLLAPSE differently — heat keeps its ramp, the
            // table re-encodes its numerals, the marks keep their silhouettes.
            ["LOAD", { series: "heat", label: "Line load",
              expand: some({ height: some("132px"), axis: variant("keep", null) }),
              jobs: noJobs, nums: noNums, marks: noMarks,
              cells: [
                  { at: week(27n), value: some(46.0), label: some("46") },
                  { at: week(28n), value: some(58.0), label: some("58") },
                  { at: week(29n), value: some(66.0), label: some("66") },
                  { at: week(30n), value: some(72.0), label: some("72") },
                  { at: week(31n), value: some(84.0), label: some("84") },
                  { at: week(32n), value: some(90.0), label: some("90") },
                  { at: week(33n), value: some(96.0), label: some("96") },
                  { at: week(34n), value: none, label: none },
                  { at: week(35n), value: some(92.0), label: some("92") },
              ] }],
            // axis: off — the render draws its own canvas, so the shared lines
            // are suppressed INSIDE this row only (the ruler never moves).
            ["DESPATCH", { series: "table", label: "Despatch t",
              expand: some({ height: some("120px"), axis: variant("off", null) }),
              jobs: noJobs, cells: noCells, marks: noMarks,
              nums: [
                  { at: week(27n), value: some(128.0), text: none, tone: none },
                  { at: week(28n), value: some(134.0), text: none, tone: none },
                  { at: week(29n), value: some(119.0), text: none, tone: none },
                  { at: week(30n), value: some(-96.0), text: none, tone: none },
                  { at: week(31n), value: some(-88.0), text: none, tone: none },
                  { at: week(32n), value: none, text: none, tone: none },
                  { at: week(33n), value: some(151.0), text: none, tone: none },
                  { at: week(34n), value: some(162.0), text: none, tone: none },
                  { at: week(35n), value: some(144.0), text: none, tone: none },
              ] }],
            ["MILESTONES", { series: "events", label: "MILESTONES",
              expand: some({ height: some("112px"), axis: variant("dim", null) }),
              jobs: noJobs, cells: noCells, nums: noNums,
              marks: [
                  { key: "k", at: week(28n), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                  { key: "d", at: week(31n), kind: variant("decision", { applied: true }), icon: none, label: none },
                  { key: "a", at: week(34n), kind: variant("exception", null), icon: none, label: some("AUDIT") },
              ] }],
        ]), DictType(StringType, OpsRow));
        // ONE resolver serves every declaring row, called with the row ref at
        // interaction time. The canvas hands it the PLOT column with the
        // shared grid + now-line drawn behind it — so a component that fills
        // that column edge to edge shares the canvas's x-space and lines up
        // with the buckets above. `Sparkline` is the axis-free chart, which is
        // what makes the alignment visible; a `Chart` would draw its own axes
        // and margins inside the column and align to those instead.
        const util = $.let(East.Array.generate(12n, FloatType, (_$, i) =>
            i.multiply(19n).remainder(48n).toFloat().add(50.0)));
        const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, (_$, _ref) => (
            <Sparkline data={util} type="area" color="link" width="100%" height="100%" />
        )));
        // The GUTTER half. An expanded row's gutter cell grows with the row,
        // and what fills the space it opens up is the author's — the identity
        // and measures that only earn their place once the row has the canvas.
        // Same row ref as `expandRender`, so it can differ per row.
        // The old spec's drilled-row card, which is what the grown gutter is
        // for: identity lines then a fill meter. The lines need no styling —
        // the gutter body already carries the sub-line vocabulary — so the
        // author writes content, not typography.
        const GutterFacts = StructType({ a: StringType, b: StringType, fill: FloatType });
        const expandGutter = $.const(East.function([Plan.Types.RowRef], UIComponentType, ($, ref) => {
            const facts = $.const(new Map([
                ["L1-M03", { a: "120 t · FILL", b: "B-208 · 88 t · 73%", fill: 0.73 }],
                ["L1-M04", { a: "120 t · FILL", b: "B-214 · 89 t · 74%", fill: 0.74 }],
                ["LOAD",   { a: "MEAN 74 · PEAK 96", b: "BREACH W33 · 1 wk", fill: 0.96 }],
                ["DESPATCH", { a: "NET 1 629 t", b: "2 SHORT WEEKS", fill: 0.55 }],
                ["MILESTONES", { a: "5 MARKS", b: "1 EXCEPTION · W34", fill: 0.2 }],
            ]), DictType(StringType, GutterFacts));
            const f = $.let(facts.get(ref.key));
            return (
                <Box>
                    <Text>{f.a}</Text>
                    <Text>{f.b}</Text>
                    {/* The old drilled card's fill meter — the shared Progress
                        component at its smallest size, not a hand-rolled bar. */}
                    <Box width="108px">
                        <Progress value={f.fill.multiply(100.0)} size="xs" tone="brand" />
                    </Box>
                </Box>
            );
        }));
        return (
            <Plan
                axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                data={ops}
                series={[
                    Plan.series.span(OpsRow, {
                        key: "span-6", title: "Span",
                        match: r => r.series.equal("span"),
                        label: r => r.label, id: true, expand: r => r.expand,
                        runs: r => r.jobs.map((_$, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                        })),
                    }),
                    Plan.series.heat(OpsRow, {
                        key: "heat-3", title: "Heat",
                        match: r => r.series.equal("heat"),
                        label: r => r.label, expand: r => r.expand,
                        cells: r => Plan.heatCells(r.cells, { min: 40.0, max: 100.0 }),
                    }),
                    Plan.series.table(OpsRow, {
                        key: "table", title: "Table",
                        match: r => r.series.equal("table"),
                        label: r => r.label, expand: r => r.expand,
                        cells: r => r.nums,
                    }),
                    Plan.series.events(OpsRow, {
                        key: "events-2", title: "Events",
                        match: r => r.series.equal("events"),
                        label: r => r.label, id: true, expand: r => r.expand,
                        marks: r => r.marks,
                    }),
                ]}
                expandRender={expandRender}
                expandGutter={expandGutter}
                style={{ height: "460px" }}
            />
        );
    }),
    inputs: [],
});
