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
import { DragEventType, EventStateType, State, StatusValueType, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Chart, Configurator, Format, Library, Plan, Progress, Reactive, SegmentGroup, Select, Slice, Sparkline, Text, VStack, deriveApproval } from "@elaraai/east-ui";

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
    description: "Every row kind on one axis from a single raw ops source, with slice chrome, expand, review and a status footer",
    fn: East.function([], UIComponentType, (_$) => {
        // The horizon fixture — the despatch orders the slice narrows (the
        // canvas rows are the ops source; the slice is chrome over THESE):
        // when, which line, whether the order is at risk of running late,
        // and the tonnage booked so far (0 = nothing yet).
        const HorizonRow = StructType({ key: StringType, at: DateTimeType, line: StringType, risk: StringType, tonnes: FloatType });
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
            fields: {
                at: { label: "Despatched", format: { date: "MMM D" } },
                line: { label: "Line" },
                risk: { label: "Risk", hints: ["late", "on-time"] },
                tonnes: { label: "Tonnes" },
            },
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
                at: Plan.at.time(week(i.add(27n))), value: some(loadPcts.get(i)),
                label: some(East.Float.printFixed(loadPcts.get(i), 0n)),
            })));
            // 36 despatch orders spread over W21–W47 — the horizon fixture.
            // Every third order is at risk of running late (the §1 `Late
            // risk` cohort counts 12); every seventh has no tonnage booked
            // yet (the `Empty` cohort).
            const horizon = $.let(East.Array.generate(36n, HorizonRow, (_$, i) => ({
                key: East.str`h${East.print(i.add(1n))}`,
                at: week(i.multiply(27n).divide(36n).add(21n)),
                line: i.remainder(2n).equal(0n).ifElse(() => "Line 1", () => "Line 2"),
                risk: i.remainder(3n).equal(0n).ifElse(() => "late", () => "on-time"),
                tonnes: i.remainder(7n).equal(6n).ifElse(
                    () => 0.0,
                    () => i.multiply(11n).remainder(40n).toFloat().add(20.0)),
            })));
            // Raw jobs → runs: ONE bound mapping function — the bar label and
            // the quantity display/number pair derive CLIENT-SIDE from the
            // raw phase/batch/tonnes fields (the series-make application). The
            // run is written as a RECORD, so its instants are spelled with
            // `Plan.at.time` — the `Plan.run` builder would wrap a DateTime
            // field by itself.
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
                        key: j.key, start: Plan.at.time(j.start), end: Plan.at.time(j.end), label,
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
                  decisions: [{ key: "d1", at: Plan.at.time(week(32n)), applied: false }],
                  ports:     [{ at: Plan.at.time(week(31n)), label: some("−24 t") }] }) }],
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
                  markers: [{ at: Plan.at.time(week(35n)), lane: none, status: variant("warning", null), message: "capacity breach — 2 allocations" }] }) }],
                ["40-crewA", { kind: variant("crew", { name: "Crew A", hours: "152h → 168h", shifts: [
                    { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
                    { key: "s2", from: week(29n), to: week(31n), hours: 72.0, state: variant("confirmed", null) },
                    { key: "s3", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
                    { key: "s4", from: week(34n), to: week(35n), hours: 48.0, state: variant("estimated", null) },
                    { key: "s5", from: week(36n), to: week(38n), hours: 56.0, state: variant("proposed", variant("recommended", null)) },
                ] }) }],
                ["50-milestones", { kind: variant("stream", { name: "MILESTONES", marks: [
                    { key: "kick", at: Plan.at.time(week(28n)), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                    { key: "d1", at: Plan.at.time(week(31n)), kind: variant("decision", { applied: true }), icon: none, label: none },
                    { key: "rel", at: Plan.at.time(week(33n)), kind: variant("milestone", null), icon: none, label: some("REL 2.4") },
                    { key: "audit", at: Plan.at.time(week(35n)), kind: variant("exception", null), icon: none, label: some("AUDIT") },
                    { key: "d2", at: Plan.at.time(week(37n)), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
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
            // The §1 toolbar is SEEDED slice state: the applied window is the
            // range chip (`JUN 29 → SEP 21 · 84d`), and two saved cohorts sit
            // beside the filter builder with `Late risk` active — their
            // counts are live over the horizon fixture, never printed.
            const slice = $.let(Slice.bind([HorizonRow], "ex.plan.target", cfg, Slice.state({
                range: some(variant("datetime", { from: week(27n), to: week(39n) })),
                cohorts: [
                    { id: "late", name: "Late risk", filters: [variant("string", { fieldId: "risk", op: variant("eq", "late") })] },
                    { id: "empty", name: "Empty", filters: [variant("float", { fieldId: "tonnes", op: variant("lte", 0.0) })] },
                ],
                activeCohorts: new Set(["late"]),
            }), horizon, none));
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
// planVariants — THE Plan configurator (#571): axis presets × style sweeps
// ============================================================================

/**
 * THE Plan configurator — the slot-2 variant-space surface the retired Gantt /
 * Planner configurators held (#571). ONE live canvas; every axis feeds it as
 * an expression. The window presets are whole `Plan.axis` VALUES riding a
 * typed preset struct: the ops week window, the year roadmap at month
 * resolution, and the 14-day sprint at day resolution with `ddd DD` labels
 * (the #309 pinned-day-columns contract the Planner's `day` preset and the
 * AlignedStack date-axis panel guarded). The style sweeps ride `style` —
 * density rhythm and gutter width — and every callback (select / run click /
 * group toggle / grain change) logs to the aside, the retired configurators'
 * pattern. Fill sizing stays `planFill`'s; the per-kind visual grammars stay
 * the static per-kind panels.
 */
export const planVariants = example({
    keywords: [
        "Plan", "configurator", "Configurator", "variants", "preset", "axis", "window",
        "resolution", "month", "week", "day", "roadmap", "sprint", "ops", "format",
        "ddd", "#309", "density", "condensed", "compact", "comfortable", "gutterWidth",
        "gutter", "style", "onSelect", "onRunClick", "onGroupToggle", "onGrainChange",
        "callback", "aside", "Reactive", "State", "SegmentGroup", "Select", "getTag",
    ],
    description: "Plan configurator — axis window presets (ops week / year roadmap / 14-day sprint) with density and gutter-width sweeps on one live canvas; every callback logs to the aside",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Monday of ISO week n, 2026 — the ops window is W27–W38
            // (half-open at W39), now = W31; the roadmap preset walks the
            // whole ISO year and the sprint preset a 14-day slice of it.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            const JobRow = StructType({
                key: StringType, label: StringType,
                start: DateTimeType, end: DateTimeType, state: EventStateType,
            });
            const OpsRow = StructType({
                series: StringType, label: StringType,
                sub: OptionType(StringType),
                jobs: ArrayType(JobRow),
                points: ArrayType(MeasureRow),
                cells: ArrayType(Plan.Types.HeatCell),
            });
            const noJobs = $.const([], ArrayType(JobRow));
            const noPoints = $.const([], ArrayType(MeasureRow));
            const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
            const pcts = $.const([46.0, 58.0, 66.0, 72.0, 84.0, 96.0], ArrayType(FloatType));
            const points = $.let(East.Array.generate(6n, MeasureRow, (_$, i) =>
                ({ week: week(i.multiply(2n).add(27n)), pct: pcts.get(i) })));
            const cells = $.let(East.Array.generate(6n, Plan.Types.HeatCell, (_$, i) => ({
                at: Plan.at.time(week(i.multiply(2n).add(27n))),
                value: some(pcts.get(i)),
                label: some(East.Float.printFixed(pcts.get(i), 0n)),
            })));
            // Mixed kinds on purpose: the density sweep re-rhythms the span /
            // heat rows and the gutter sweep re-widths every label at once.
            const ops = $.const(new Map([
                ["10-util", { series: "util", label: "UTIL %", sub: none, jobs: noJobs, points, cells: noCells }],
                ["20-m03", { series: "mach", label: "L1-M03", sub: some("cap 120 t"),
                  jobs: [
                      { key: "b214", label: "RUN · B-214", start: week(28n), end: week(31n), state: variant("in-progress", null) },
                      { key: "b221", label: "RUN · B-221", start: week(32n), end: week(35n), state: variant("proposed", variant("recommended", null)) },
                  ], points: noPoints, cells: noCells }],
                ["20-m04", { series: "mach", label: "L1-M04", sub: none,
                  jobs: [
                      { key: "b208", label: "RUN · B-208", start: week(27n), end: week(30n), state: variant("actual", null) },
                  ], points: noPoints, cells: noCells }],
                ["30-load", { series: "load", label: "L2 load", sub: some("%/wk"), jobs: noJobs, points: noPoints, cells }],
                ["g1-m11", { series: "gmach", label: "L3-M11", sub: none,
                  jobs: [
                      { key: "b301", label: "RUN · B-301", start: week(29n), end: week(33n), state: variant("confirmed", null) },
                  ], points: noPoints, cells: noCells }],
            ]), DictType(StringType, OpsRow));
            const series = $.const([
                Plan.series.chart(OpsRow, {
                    key: "util", title: "Utilisation",
                    match: r => r.series.equal("util"),
                    label: r => r.label, id: true, height: "spark",
                    layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.span(OpsRow, {
                    key: "mach", title: "Machine jobs",
                    match: r => r.series.equal("mach"),
                    label: r => r.label, id: true, sub: r => r.sub,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                    })),
                }),
                Plan.series.heat(OpsRow, {
                    key: "load", title: "Line load",
                    match: r => r.series.equal("load"),
                    label: r => r.label, sub: r => r.sub,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
                // A strip so the group-toggle callback has something to fire on.
                Plan.series.group(OpsRow, { key: "g1-line3", label: "Line 3", meta: "1 rs" }, [
                    Plan.series.span(OpsRow, {
                        key: "gmach", title: "Grouped jobs",
                        match: r => r.series.equal("gmach"),
                        label: r => r.label, id: true,
                        runs: r => r.jobs.map((_$, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                        })),
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            // Every preset is DATA — a whole axis value in a typed struct, so
            // switching presets swaps window, resolution, format and now
            // through ONE expression-fed prop.
            const presets = $.const([
                { key: "ops", axis: Plan.axis({
                    window: { min: week(27n), max: week(39n) },
                    resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
                }) },
                { key: "roadmap", axis: Plan.axis({
                    window: { min: week(1n), max: week(53n) },
                    resolution: "month", format: "MMM", now: week(31n),
                }) },
                { key: "sprint", axis: Plan.axis({
                    window: { min: week(30n), max: week(32n) },
                    resolution: "day", format: "ddd DD", now: week(31n),
                }) },
            ], ArrayType(StructType({ key: StringType, axis: Plan.Types.Axis })));
            const presetKeys = $.const(["ops", "roadmap", "sprint"], ArrayType(StringType));
            const densities = $.const([
                variant("condensed", null), variant("compact", null), variant("comfortable", null),
            ], ArrayType(Style.Types.Density));
            const gutters = $.const(["168px", "200px", "240px"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "plan_variants_preset", "ops"));
            const densityBind = $.let(State.bind([StringType], "plan_variants_density", "compact"));
            const gutterBind = $.let(State.bind([StringType], "plan_variants_gutter", "168px"));
            const lastEventBind = $.let(State.bind([StringType], "plan_variants_last_event", ""));
            const pKey = $.let(presetBind.read());
            const dKey = $.let(densityBind.read());
            const gKey = $.let(gutterBind.read());
            const lastEvent = $.let(lastEventBind.read());
            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const onGutter = $.const(East.function([StringType], NullType, ($, next) => { $(gutterBind.write(next)); }));

            // The interactive surface — every callback writes the aside line.
            const onSelect = $.const(East.function([Plan.Types.RowRef], NullType, ($, ref) => {
                $(lastEventBind.write(East.str`onSelect · ${ref.key}`));
            }));
            const onRunClick = $.const(East.function([Plan.Types.RunClickEvent], NullType, ($, ev) => {
                $(lastEventBind.write(East.str`onRunClick · ${ev.row} / ${ev.run}`));
            }));
            const onGroupToggle = $.const(East.function([Plan.Types.GroupToggleEvent], NullType, ($, ev) => {
                const state = $.let(ev.expanded.ifElse(() => "expanded", () => "collapsed"), StringType);
                $(lastEventBind.write(East.str`onGroupToggle · ${ev.row} → ${state}`));
            }));
            const onGrainChange = $.const(East.function([Plan.Types.Grain], NullType, ($, grain) => {
                $(lastEventBind.write(East.str`onGrainChange · ${grain.getTag()}`));
            }));

            const sel = $.let(presets.filter((_$, o) => o.key.equal(pKey)).get(0n, _$ => presets.get(0n)));
            const densitySel = $.let(densities.filter((_$, v) => v.getTag().equal(dKey)).get(0n));
            return (
                <Configurator
                    controls={[
                        Configurator.Control("Preset", pKey,
                            <Select value={pKey} onChange={onPreset} size="sm"
                                items={presetKeys.map((_$, s) => Select.Item(s, s))} />),
                        Configurator.Control("Density", dKey,
                            <SegmentGroup value={dKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                        Configurator.Control("Gutter", gKey,
                            <SegmentGroup value={gKey} onChange={onGutter} size="sm"
                                items={gutters.map((_$, g) => SegmentGroup.Item(g, <Text>{g}</Text>))} />),
                    ]}
                    preview={
                        <Plan
                            axis={sel.axis}
                            data={ops}
                            series={series}
                            onSelect={onSelect}
                            onRunClick={onRunClick}
                            onGroupToggle={onGroupToggle}
                            onGrainChange={onGrainChange}
                            style={{ density: densitySel, gutterWidth: gKey }}
                        />
                    }
                    live
                    aside={{
                        label: "Events · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(lastEvent.length(), 0n).ifElse(_$ => "Interact with the canvas", _$ => lastEvent)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Resolution", sel.axis.unwrap("time").resolution.getTag()),
                        Configurator.Spec("Rows", East.print(ops.size())),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Per-kind examples — one canvas per row kind; the config sweep is DATA
// ============================================================================

export const planSpanRows = example({
    keywords: ["Plan", "data", "series", "span", "run", "state", "estimated", "removed", "rejected", "decision", "port", "rollup", "union", "byStatus", "groupBy", "bands", "group", "stacked", "gutter", "links", "link", "focus", "expand", "expandRender", "match", "raw"],
    description: "Span rows over one raw machine source — proposal flavours, decision diamonds and ports, rollup parents, and a link graph",
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
              decisions: [{ key: "d1", at: Plan.at.time(week(31n)), applied: true }],
              ports: [{ at: Plan.at.time(week(31n)), label: some("−24 t") }] }],
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
                    key: j.key, start: Plan.at.time(j.start), end: Plan.at.time(j.end), label,
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
    keywords: ["Plan", "data", "series", "buckets", "Planner", "lane", "lanes", "AM", "PM", "event", "tile", "marker", "tone", "color", "colorPalette", "stretch", "pulse", "icon", "hovercard", "popover", "mixed", "unbucketed", "group", "match", "gutter", "raw"],
    description: "Bucket rows over one dock source — tiles derived in the accessor, and stored tile records with lanes, tones, colours and markers",
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
              markers: [{ at: Plan.at.time(week(29n)), lane: none, status: variant("warning", null), message: "capacity 90%" }] }],
            // The grammar showcase — tiles stored IN the element vocabulary
            // (plain `PlanBucketEventType` records; no builders in data).
            ["dock5", { series: "outbound", label: "Dock 5", sub: some("day · am/pm"), value: none,
              lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
              allocations: [],
              tiles: [
                  { key: "m1", at: Plan.at.time(week(27n)), lane: some("am"), label: none, icon: none, state: variant("confirmed", null),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
                  { key: "m2", at: Plan.at.time(week(27n)), lane: some("pm"), label: none, icon: none, state: variant("confirmed", null),
                    tone: some(variant("warning", null)), color: none, colorPalette: none, stretch: none, content: none, animation: none },
                  { key: "m3", at: Plan.at.time(week(28n)), lane: some("am"), label: none, icon: none, state: variant("proposed", variant("recommended", null)),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: some(variant("pulse", null)) },
                  { key: "m4", at: Plan.at.time(week(29n)), lane: none, label: some("MIXED"), icon: none, state: variant("confirmed", null),
                    tone: none, color: none, colorPalette: none, stretch: some(variant("horizontal", null)),
                    content: some({ horizontal: some(variant("center", null)), vertical: none }), animation: none },
                  { key: "m5", at: Plan.at.time(week(30n)), lane: some("pm"), label: none,
                    icon: some({ prefix: "fas", name: "truck", label: none, style: none }),
                    state: variant("proposed", variant("recommended", null)),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
                  { key: "m6", at: Plan.at.time(week(31n)), lane: some("am"), label: some("QC"), icon: none, state: variant("estimated", null),
                    tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
                  // The colour channels (#571, from the Planner's colors
                  // preset): `color` is a raw token override, `colorPalette`
                  // recolours the whole lifecycle treatment.
                  { key: "m7", at: Plan.at.time(week(32n)), lane: some("am"), label: some("S-A"), icon: none, state: variant("confirmed", null),
                    tone: none, color: some("teal.solid"), colorPalette: none, stretch: none, content: none, animation: none },
                  { key: "m8", at: Plan.at.time(week(32n)), lane: some("pm"), label: some("S-B"), icon: none, state: variant("confirmed", null),
                    tone: none, color: none, colorPalette: some(variant("brand", null)), stretch: none, content: none, animation: none },
              ],
              markers: [{ at: Plan.at.time(week(29n)), lane: none, status: variant("danger", null), message: "capacity breach" }] }],
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
    description: "Chart rows over one measure source — one series per mark kind, plus annotations and a fixed dual-axis composition",
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
    description: "Heat rows over one line source — colour-depth cells under an aggregate parent, weight bars, and status segments",
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
            at: Plan.at.time(week(i.add(27n))),
            value: i.equal(4n).ifElse(() => none, () => some(pcts.get(i))),   // W31 = no data
            label: i.equal(4n).ifElse(() => none, () => some(East.Float.printFixed(pcts.get(i), 0n))),
        })));
        // Booked-vs-free fractions; the back half is the planned pale tail.
        const weights = $.let(East.Array.generate(6n, Plan.Types.WeightCell, (_$, i) => ({
            at: Plan.at.time(week(i.multiply(2n).add(27n))),
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
                  { at: Plan.at.time(week(27n)), segments: [
                      { fill: variant("success", null), weight: 60.0, label: some("60%") },
                      { fill: variant("warning", null), weight: 25.0, label: some("25%") },
                      { fill: variant("slack", null), weight: 15.0, label: none },
                  ] },
                  { at: Plan.at.time(week(28n)), segments: [
                      { fill: variant("success", null), weight: 70.0, label: some("70%") },
                      { fill: variant("slack", null), weight: 30.0, label: none },
                  ] },
                  { at: Plan.at.time(week(29n)), segments: [
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
    description: "Table rows over one order source — nested groupBy subtotals, footer emphasis, and every split × gutter combination",
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
    description: "Cards rows over one crew source — chip labels derived from hours × lifecycle, plus stored chip records",
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
                { key: "b1", from: Plan.at.time(week(28n)), to: Plan.at.time(week(31n)), label: "96h", state: variant("confirmed", null),
                  icon: some({ prefix: "fas", name: "user-group", label: none, style: none }) },
                { key: "b2", from: Plan.at.time(week(33n)), to: Plan.at.time(week(36n)), label: "+32h", state: variant("proposed", variant("recommended", null)), icon: none },
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
    description: "Event rows over one stream source — milestone dots, decision diamonds, an exception, and a custom glyph",
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
                { key: "kick", at: Plan.at.time(week(28n)), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                { key: "d1", at: Plan.at.time(week(31n)), kind: variant("decision", { applied: true }), icon: none, label: none },
                { key: "rel", at: Plan.at.time(week(33n)), kind: variant("milestone", null),
                  icon: some({ prefix: "fas", name: "rocket", label: none, style: none }), label: some("REL 2.4") },
                { key: "audit", at: Plan.at.time(week(35n)), kind: variant("exception", null), icon: none, label: some("AUDIT") },
                { key: "d2", at: Plan.at.time(week(37n)), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
            ] }],
            ["release", { series: "programs", name: "RELEASES", sub: some("6-wk cadence"), value: none, marks: [
                { key: "r1", at: Plan.at.time(week(29n)), kind: variant("milestone", null), icon: none, label: some("2.3") },
                { key: "r2", at: Plan.at.time(week(36n)), kind: variant("milestone", null), icon: none, label: some("2.4") },
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
    description: "Group strips in all three forms — static expanded, static collapsed, and discovered by a `by` accessor",
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
            at: Plan.at.time(week(i.add(27n))),
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
    description: "The data + series canvas, minimally — one raw source and one `Plan.series.*` entry per row series",
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
        "toggle", "eye", "kind icon", "count", "group", "grouped", "discovered", "by", "rows",
        "chrome", "span", "buckets", "chart", "heat", "table", "cards", "events", "duplicate",
        "keySuffix", "keyPrefix", "same entity", "multiple views", "adjacent", "seek",
        "DnD", "drag", "drop", "onDrag", "canDrop", "sources", "add", "Reactive", "State", "#590",
    ],
    description: "The series library across every row kind — duplicate kinds, groups, and a `keySuffix` pair showing one asset three ways",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            const JobRow = StructType({
                key: StringType, label: StringType,
                start: DateTimeType, end: DateTimeType, state: EventStateType,
            });
            const ShiftRow = StructType({
                key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
            });
            const AllocRow = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
            // ONE flat source (the `planExpand` shape): `pick` names the series
            // that claims the row, and every other channel is empty for the
            // series that do not use it. Each series therefore matches a
            // DISJOINT slice — two series over the same rows would emit the same
            // keys and collapse last-wins, which is a different demo.
            const OpsRow = StructType({
                pick: StringType, label: StringType, line: StringType,
                jobs: ArrayType(JobRow),
                points: ArrayType(MeasureRow),
                cells: ArrayType(Plan.Types.HeatCell),
                allocs: ArrayType(AllocRow),
                nums: ArrayType(Plan.Types.TableCell),
                shifts: ArrayType(ShiftRow),
                marks: ArrayType(Plan.Types.EventMark),
            });
            const noJobs = $.const([], ArrayType(JobRow));
            const noPoints = $.const([], ArrayType(MeasureRow));
            const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
            const noAllocs = $.const([], ArrayType(AllocRow));
            const noNums = $.const([], ArrayType(Plan.Types.TableCell));
            const noShifts = $.const([], ArrayType(ShiftRow));
            const noMarks = $.const([], ArrayType(Plan.Types.EventMark));
            const pcts = $.const([46.0, 58.0, 66.0, 72.0, 84.0, 96.0], ArrayType(FloatType));
            const points = $.let(East.Array.generate(6n, MeasureRow, (_$, i) =>
                ({ week: week(i.multiply(2n).add(27n)), pct: pcts.get(i) })));
            const cells = $.let(East.Array.generate(6n, Plan.Types.HeatCell, (_$, i) => ({
                at: Plan.at.time(week(i.multiply(2n).add(27n))),
                value: some(pcts.get(i)),
                label: some(East.Float.printFixed(pcts.get(i), 0n)),
            })));
            // The lifecycle states as consts, so each tag stays a LITERAL —
            // `variant(someString, null)` widens to `variant<string, null>` and
            // stops satisfying `EventStateType`.
            const ACTUAL = variant("actual", null);
            const CONFIRMED = variant("confirmed", null);
            const RUNNING = variant("in-progress", null);
            const PROPOSED = variant("proposed", variant("recommended", null));
            const base = {
                line: "", jobs: noJobs, points: noPoints, cells: noCells,
                allocs: noAllocs, nums: noNums, shifts: noShifts, marks: noMarks,
            };
            // Keys ORDER the canvas (#568), so they are numbered to place each
            // series' rows; group strips sort among the ROOTS by their own key.
            const ops = $.const(new Map([
                ["10-util",   { ...base, pick: "util",     label: "UTIL %",   points }],
                // ONE asset, THREE views — the span the machines series draws,
                // plus a chart and a table over these same two rows (see the
                // `keySuffix` pair below). The extra channels are what those
                // two read; nothing about the row is duplicated.
                ["20-m03",    { ...base, pick: "machines", label: "L1-M03",
                                jobs: [{ key: "b214", label: "RUN · B-214", start: week(28n), end: week(31n), state: RUNNING }],
                                points,
                                nums: [
                                    { at: Plan.at.time(week(28n)), value: some(96.0), text: none, tone: none },
                                    { at: Plan.at.time(week(31n)), value: some(88.0), text: none, tone: none },
                                ] }],
                ["20-m04",    { ...base, pick: "machines", label: "L1-M04",
                                jobs: [{ key: "b208", label: "RUN · B-208", start: week(27n), end: week(30n), state: ACTUAL }],
                                points,
                                nums: [
                                    { at: Plan.at.time(week(28n)), value: some(112.0), text: none, tone: none },
                                    { at: Plan.at.time(week(31n)), value: some(-24.0), text: none, tone: none },
                                ] }],
                // SAME KIND as the machines series, different entry — a kind is
                // not an identity, which is why the library keys on `key`.
                ["25-c01",    { ...base, pick: "contract", label: "CON-01",
                                jobs: [{ key: "c1", label: "RUN · C-1", start: week(30n), end: week(34n), state: CONFIRMED }] }],
                ["30-load",   { ...base, pick: "load",     label: "L2 load",  cells }],
                ["35-qual",   { ...base, pick: "quality",  label: "Quality",  cells }],
                ["40-dock2",  { ...base, pick: "docks",    label: "Dock 2",
                                allocs: [
                                    { key: "a1", at: week(28n), state: variant("confirmed", null) },
                                    { key: "a2", at: week(31n), state: variant("proposed", variant("recommended", null)) },
                                ] }],
                ["50-desp",   { ...base, pick: "table",    label: "Despatch t",
                                nums: [
                                    { at: Plan.at.time(week(28n)), value: some(128.0), text: none, tone: none },
                                    { at: Plan.at.time(week(30n)), value: some(-96.0), text: none, tone: none },
                                ] }],
                ["60-crewA",  { ...base, pick: "cards",    label: "Crew A",
                                shifts: [
                                    { key: "s1", from: week(27n), to: week(29n), label: "80h", state: variant("confirmed", null) },
                                    { key: "s2", from: week(31n), to: week(33n), label: "+64h", state: variant("proposed", variant("recommended", null)) },
                                ] }],
                ["70-ms",     { ...base, pick: "events",   label: "MILESTONES",
                                marks: [
                                    { key: "k", at: Plan.at.time(week(29n)), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                                    { key: "a", at: Plan.at.time(week(34n)), kind: variant("exception", null), icon: none, label: some("AUDIT") },
                                ] }],
                // Members of the three STATIC groups — they hang under their
                // strip, so their keys only order within that subtree.
                ["g1-m11",    { ...base, pick: "gspan",    label: "L3-M11",
                                jobs: [{ key: "b301", label: "RUN · B-301", start: week(29n), end: week(33n), state: CONFIRMED }] }],
                ["g1-m12",    { ...base, pick: "gspan",    label: "L3-M12",
                                jobs: [{ key: "b302", label: "RUN · B-302", start: week(31n), end: week(36n), state: ACTUAL }] }],
                ["g2-l1",     { ...base, pick: "gheat",    label: "L4 load",  cells }],
                ["g3-d5",     { ...base, pick: "gbuckets", label: "Dock 5",
                                allocs: [{ key: "a3", at: week(33n), state: variant("confirmed", null) }] }],
                // The DISCOVERED group's members — one strip per `line`.
                ["p1-a",      { ...base, pick: "programs", label: "PR-A1", line: "Program A",
                                jobs: [{ key: "p1", label: "RUN · P-1", start: week(28n), end: week(32n), state: CONFIRMED }] }],
                ["p2-a",      { ...base, pick: "programs", label: "PR-A2", line: "Program A",
                                jobs: [{ key: "p2", label: "RUN · P-2", start: week(33n), end: week(37n), state: PROPOSED }] }],
                ["p3-b",      { ...base, pick: "programs", label: "PR-B1", line: "Program B",
                                jobs: [{ key: "p3", label: "RUN · P-3", start: week(30n), end: week(35n), state: ACTUAL }] }],
            ]), DictType(StringType, OpsRow));

            // The whole library: every kind once, two kinds TWICE, each of three
            // static groups wrapping a different kind, the discovered form, and
            // literal chrome. Fourteen entries, nine distinct arms.
            const all = $.const([
                // Literal one-off chrome — it names itself, so it can be
                // switched off like anything else.
                Plan.series.rows(OpsRow, { key: "chrome", title: "Section header", subtitle: "literal chrome" },
                    [Plan.events({ key: "00-hdr", label: "PLAN", id: true })]),
                Plan.series.chart(OpsRow, {
                    key: "util", title: "Utilisation", subtitle: "% per fortnight",
                    match: r => r.pick.equal("util"),
                    label: r => r.label, id: true, height: "spark",
                    layers: r => [Chart.Column(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.span(OpsRow, {
                    key: "machines", title: "Machine jobs", subtitle: "one row per machine",
                    match: r => r.pick.equal("machines"),
                    label: r => r.label, id: true,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                    })),
                }),
                // ── THE SAME ASSET, SEEN TWO MORE WAYS ────────────────────
                // Both of these match the machines slice the span series
                // already claims, so all three emit a row per machine. Without
                // an affix they would land on one key and the last would
                // silently replace the others (#568's union is last-wins).
                //
                // `keySuffix` separates them while keeping the DATA key first,
                // which is the whole point: the canvas is in key order, so an
                // asset's three views sit ADJACENT (`20-m03`, `20-m03/chart`,
                // `20-m03/table`) instead of the series banking together — and
                // seek still lands, because it positions on the first row
                // at-or-after the sought key. A `keyPrefix` would do neither.
                Plan.series.chart(OpsRow, {
                    key: "machine-util", title: "Machine · utilisation", subtitle: "same asset, 2nd view",
                    match: r => r.pick.equal("machines"),
                    keySuffix: "/chart",
                    // The label stays the ASSET — all three rows are the same
                    // machine, and pretending otherwise would hide that. What
                    // distinguishes them is the VIEW, which is what the gutter
                    // sub-line is for.
                    label: r => r.label, stacked: true, sub: _r => some("utilisation %"), height: "spark",
                    layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.table(OpsRow, {
                    key: "machine-tonnes", title: "Machine · tonnes", subtitle: "same asset, 3rd view",
                    match: r => r.pick.equal("machines"),
                    keySuffix: "/table",
                    label: r => r.label, stacked: true, sub: _r => some("tonnes · plan Δ"),
                    cells: r => r.nums,
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.span(OpsRow, {
                    key: "contract", title: "Contractor jobs", subtitle: "same KIND, own entry",
                    match: r => r.pick.equal("contract"),
                    label: r => r.label, id: true,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                    })),
                }),
                Plan.series.heat(OpsRow, {
                    key: "load", title: "Line load", subtitle: "% per fortnight",
                    match: r => r.pick.equal("load"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
                Plan.series.heat(OpsRow, {
                    key: "quality", title: "Quality index", subtitle: "same KIND, own entry",
                    match: r => r.pick.equal("quality"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
                Plan.series.buckets(OpsRow, {
                    key: "docks", title: "Dock allocations", subtitle: "tiles per bucket",
                    match: r => r.pick.equal("docks"),
                    label: r => r.label,
                    events: r => r.allocs.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                }),
                Plan.series.table(OpsRow, {
                    key: "table", title: "Despatch tonnes", subtitle: "per bucket",
                    match: r => r.pick.equal("table"),
                    label: r => r.label,
                    cells: r => r.nums,
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(OpsRow, {
                    key: "cards", title: "Crew shifts", subtitle: "assignments",
                    match: r => r.pick.equal("cards"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) =>
                        Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
                }),
                Plan.series.events(OpsRow, {
                    key: "events", title: "Milestones", subtitle: "instant marks",
                    match: r => r.pick.equal("events"),
                    label: r => r.label, id: true,
                    marks: r => r.marks,
                }),
                // STATIC groups — each wrapping a DIFFERENT kind. The strip's
                // own key / label / meta ARE the library entry's identity, so
                // "Line 3" is the thing a person picks and switching it off
                // takes its whole subtree with it.
                //
                // The metas are terse because they are read TWICE: as the
                // strip's meta line in the gutter (which is 168px and truncates
                // the label if the meta crowds it) and as the entry's subtitle
                // in the panel. Borrowing identity means one string serves both
                // — the cost of the group needing nothing extra written.
                Plan.series.group(OpsRow, { key: "g1-line3", label: "Line 3", meta: "span" },
                    [
                        Plan.series.span(OpsRow, {
                            key: "gspan", title: "Grouped span", subtitle: "member",
                            match: r => r.pick.equal("gspan"),
                            label: r => r.label, id: true,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                            })),
                        }),
                    ]),
                Plan.series.group(OpsRow, { key: "g2-lines", label: "Load", meta: "heat" },
                    [
                        Plan.series.heat(OpsRow, {
                            key: "gheat", title: "Grouped heat", subtitle: "member",
                            match: r => r.pick.equal("gheat"),
                            label: r => r.label,
                            cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                        }),
                    ]),
                Plan.series.group(OpsRow, { key: "g3-docks", label: "Docks", meta: "buckets" },
                    [
                        Plan.series.buckets(OpsRow, {
                            key: "gbuckets", title: "Grouped buckets", subtitle: "member",
                            match: r => r.pick.equal("gbuckets"),
                            label: r => r.label,
                            events: r => r.allocs.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                        }),
                    ]),
                // The DISCOVERED form — one strip per distinct `line`, and ONE
                // library entry for all of them, which is why it declares its
                // own identity instead of borrowing a strip's.
                Plan.series.group(OpsRow, {
                    key: "programs", title: "Programs", subtitle: "one strip per line",
                    by: r => r.line, match: r => r.pick.equal("programs"), keyPrefix: "p-",
                }, [
                    Plan.series.span(OpsRow, {
                        key: "programs", title: "Program runs", subtitle: "member",
                        match: r => r.pick.equal("programs"),
                        label: r => r.label, id: true,
                        runs: r => r.jobs.map((_$, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                        })),
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(OpsRow)));

            // `data` gives each entry its row count, so a series that selects
            // nothing says `0` rather than switching on to no visible effect.
            const shown = $.let(Plan.pick("ex.plan.library", all, {
                data: ops,
                hidden: ["quality", "cards", "g3-docks"],
            }));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            const onDrag = $.const(East.function([DragEventType], NullType, (_$, _e) => null));
            const canDrop = $.const(East.function([DragEventType], BooleanType, (_$, _e) => true));
            // `pick` REPLACES `series`: the handle already carries the list, so
            // the canvas feeds itself the picked ones and mounts the library.
            // Nothing here wires the panel to the canvas.
            return (
                <Plan
                    axis={axis}
                    data={ops}
                    pick={shown}
                    id="plan" sources={["row-library"]}
                    onDrag={onDrag}
                    canDrop={canDrop}
                    style={{ height: "620px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planRowDrop — the canvas as a drag TARGET, and which rows can receive
// ============================================================================

/**
 * A Plan is a drag target, and a heterogeneous one — which is what makes it
 * different from every other target in the grammar.
 *
 * Roster, Board and Blend have ONE kind of cell, so "can you drop here" is a
 * question about the cell's contents. A Plan's rows are nine different things,
 * so the question is answered TWICE, at two different levels:
 *
 *  1. **Structurally, by kind.** Only rows holding discrete scheduled objects
 *     register a drop cell at all — `span` (runs), `buckets` (tiles), `events`
 *     (marks), `cards` (chips). A `chart` / `heat` / `table` row renders
 *     DERIVED values, so there is nothing for a card to become; it registers
 *     no cell, never lights up during a drag, and is not reachable by any
 *     predicate. Group strips are wayfinding, so they are inert too — their
 *     MEMBERS receive.
 *  2. **By policy, with `canDrop`.** Of the rows that can receive, this canvas
 *     admits only the matching FAMILY: a job goes on a machine, a delivery on
 *     a dock, a shift on a crew, a milestone on a stream. The `PALLET` card
 *     belongs to no family and is therefore refused everywhere — the ⊘ stage
 *     on every row, which is what a card with nowhere to go should look like.
 *
 * The drop is not cosmetic. `onDrag` writes to bound state, the series
 * accessors read that state back, and the row re-derives — the documented flow
 * for every target ("no drop writes state directly"). Nothing is painted
 * optimistically, so what appears on the canvas is only ever what the data
 * says.
 */
export const planRowDrop = example({
    keywords: [
        "Plan", "Library", "DnD", "drag", "drop", "onDrag", "canDrop", "sources", "id",
        "add", "target", "surface", "cell", "slot", "row kind", "selective", "veto",
        "invalid", "span", "buckets", "events", "cards", "chart", "heat", "table", "group",
        "droppable", "inert", "bucket instant", "Reactive", "State", "commit", "re-derive",
    ],
    description: "Library + Plan DnD — only the kinds holding discrete objects receive, and `canDrop` admits only the matching family",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            const JobRow = StructType({
                key: StringType, label: StringType,
                start: DateTimeType, end: DateTimeType, state: EventStateType,
            });
            const ShiftRow = StructType({
                key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
            });
            const AllocRow = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
            // What a completed drop leaves behind: an instant and a name. The
            // KIND it becomes is the receiving series' business, which is why
            // one shape serves all four.
            const DropRow = StructType({ key: StringType, at: DateTimeType, label: StringType });
            const OpsRow = StructType({
                series: StringType, label: StringType, line: StringType,
                jobs: ArrayType(JobRow),
                points: ArrayType(MeasureRow),
                cells: ArrayType(Plan.Types.HeatCell),
                allocs: ArrayType(AllocRow),
                nums: ArrayType(Plan.Types.TableCell),
                shifts: ArrayType(ShiftRow),
                marks: ArrayType(Plan.Types.EventMark),
            });
            const noJobs = $.const([], ArrayType(JobRow));
            const noPoints = $.const([], ArrayType(MeasureRow));
            const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
            const noAllocs = $.const([], ArrayType(AllocRow));
            const noNums = $.const([], ArrayType(Plan.Types.TableCell));
            const noShifts = $.const([], ArrayType(ShiftRow));
            const noMarks = $.const([], ArrayType(Plan.Types.EventMark));
            const noDrops = $.const([], ArrayType(DropRow));
            const pcts = $.const([46.0, 58.0, 66.0, 72.0, 84.0, 96.0], ArrayType(FloatType));
            const points = $.let(East.Array.generate(6n, MeasureRow, (_$, i) =>
                ({ week: week(i.multiply(2n).add(27n)), pct: pcts.get(i) })));
            const cells = $.let(East.Array.generate(6n, Plan.Types.HeatCell, (_$, i) => ({
                at: Plan.at.time(week(i.multiply(2n).add(27n))),
                value: some(pcts.get(i)),
                label: some(East.Float.printFixed(pcts.get(i), 0n)),
            })));
            const CONFIRMED = variant("confirmed", null);
            const RUNNING = variant("in-progress", null);
            // Everything a drop creates is a PROPOSAL — it is a suggestion the
            // host has not committed, and the lifecycle is how the canvas says so.
            const ADDED = variant("proposed", variant("added", null));
            const base = {
                line: "", jobs: noJobs, points: noPoints, cells: noCells,
                allocs: noAllocs, nums: noNums, shifts: noShifts, marks: noMarks,
            };
            // Keys order the canvas (#568), numbered so the droppable and inert
            // kinds INTERLEAVE — a solid block of receiving rows would not show
            // that the line is drawn per kind.
            const ops = $.const(new Map([
                ["10-util",  { ...base, series: "util",  label: "UTIL %",     points }],
                ["20-m03",   { ...base, series: "mach",  label: "L1-M03",
                               jobs: [{ key: "b214", label: "RUN · B-214", start: week(28n), end: week(31n), state: RUNNING }] }],
                ["20-m04",   { ...base, series: "mach",  label: "L1-M04",
                               jobs: [{ key: "b208", label: "RUN · B-208", start: week(27n), end: week(30n), state: CONFIRMED }] }],
                ["30-load",  { ...base, series: "load",  label: "L2 load",    cells }],
                ["40-dock2", { ...base, series: "dock",  label: "Dock 2",
                               allocs: [{ key: "a1", at: week(29n), state: CONFIRMED }] }],
                ["50-desp",  { ...base, series: "table", label: "Despatch t",
                               nums: [
                                   { at: Plan.at.time(week(28n)), value: some(128.0), text: none, tone: none },
                                   { at: Plan.at.time(week(31n)), value: some(-96.0), text: none, tone: none },
                               ] }],
                ["60-crewA", { ...base, series: "crew",  label: "Crew A",
                               shifts: [{ key: "s1", from: week(27n), to: week(29n), label: "80h", state: CONFIRMED }] }],
                ["70-ms",    { ...base, series: "strm",  label: "MILESTONES",
                               marks: [{ key: "k", at: Plan.at.time(week(29n)), kind: variant("milestone", null), icon: none, label: some("KICKOFF") }] }],
                // A group MEMBER — the strip itself takes no drops, but the
                // span row inside it receives like any other span row.
                ["g1-m11",   { ...base, series: "gmach", label: "L3-M11", line: "Line 3",
                               jobs: [{ key: "b301", label: "RUN · B-301", start: week(30n), end: week(34n), state: CONFIRMED }] }],
            ]), DictType(StringType, OpsRow));

            // ── The two policy tables the host owns ───────────────────────
            // Which FAMILY of card each row will take. A row absent from this
            // map takes nothing — which is how the inert kinds would behave
            // even if they did register a cell.
            const rowAccepts = $.const(new Map([
                ["20-m03", "job"], ["20-m04", "job"], ["g1-m11", "job"],
                ["40-dock2", "delivery"],
                ["60-crewA", "shift"],
                ["70-ms", "milestone"],
            ]), DictType(StringType, StringType));
            const CardRow = StructType({
                key: StringType, name: StringType, family: StringType, note: StringType, icon: StringType,
            });
            const cards = $.const([
                { key: "job-weld",  name: "Weld cell",   family: "job",       note: "job · machines",   icon: "gear" },
                { key: "job-cure",  name: "Cure oven",   family: "job",       note: "job · machines",   icon: "fire" },
                { key: "dlv-truck", name: "Truck 12",    family: "delivery",  note: "delivery · docks", icon: "truck" },
                { key: "shf-night", name: "Night shift", family: "shift",     note: "shift · crews",    icon: "moon" },
                { key: "mst-audit", name: "Audit gate",  family: "milestone", note: "milestone · streams", icon: "flag" },
                // Belongs to no family, so no row accepts it — the ⊘ stage
                // everywhere, which is what a card with nowhere to go looks like.
                { key: "pallet",    name: "PALLET",      family: "none",      note: "fits nowhere",     icon: "box" },
            ], ArrayType(CardRow));
            const cardFamily = $.const(cards.toDict((_$, c) => c.key, (_$, c) => c.family));
            const cardName = $.const(cards.toDict((_$, c) => c.key, (_$, c) => c.name));

            // ── The drop veto ────────────────────────────────────────────
            // Consulted with the candidate event the pointer's CURRENT bucket
            // would produce, so the ⊘ appears while dragging rather than after.
            // Only `add` can reach a Plan (nothing on the canvas starts a drag,
            // so the surface declares no move / resize), and refusing the rest
            // says that rather than pretending they are permitted.
            const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) => {
                const no = $.const(false, BooleanType);
                return event.match({
                    add: ($, add) => {
                        const row = $.let(add.into.row);
                        const card = $.let(add.from.key);
                        return rowAccepts.has(row)
                            .and(_$ => cardFamily.has(card))
                            .and(_$ => rowAccepts.get(row).equal(cardFamily.get(card)));
                    },
                }, _$ => no);
            }));

            // ── The commit ───────────────────────────────────────────────
            // The drop reports; the HOST writes. Nothing is painted
            // optimistically — this state is what the series read back, so a
            // dropped card only appears because the data now says it is there.
            const dropBind = $.let(State.bind([DictType(StringType, ArrayType(DropRow))],
                "ex.plan.drops", new Map()));
            const lastBind = $.let(State.bind([StringType], "ex.plan.lastdrop", "none yet"));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.match(event, {
                    add: ($, add) => {
                        const next = $.let(dropBind.read());
                        const row = $.let(add.into.row);
                        const card = $.let(add.from.key);
                        // The slot IS an East DateTime in text — that is the
                        // contract the Z-less ISO spelling exists to keep.
                        const at = $.let(add.into.slot.parse(DateTimeType));
                        const one = $.let([{
                            key: East.str`drop-${card}-${add.into.slot}`,
                            at, label: cardName.get(card),
                        }], ArrayType(DropRow));
                        $(next.insertOrUpdate(row, one,
                            (_$, existing, incoming) => existing.concat(incoming)));
                        $(dropBind.write(next));
                        $(lastBind.write(East.str`add ${card} → ${row} · ${add.into.slot}`));
                    },
                    move: (_$) => {}, remove: (_$) => {}, resize: (_$) => {},
                });
            }));
            // Read DIRECTLY in the accessors below — never through a helper
            // East.function. A series accessor is reified into a standalone
            // function, so whatever it captures crosses that boundary: a
            // captured DICT travels as the value it is, but a captured
            // FUNCTION drags the enclosing block along with it, once per
            // accessor, and four accessors was enough to take this example's
            // render payload past 100MB. `planReview` is the shape to copy.
            const drops = $.let(dropBind.read());
            const last = $.let(lastBind.read());

            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
            }));
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="plan-library"
                        data={cards}
                        item={c => ({ key: c.key, label: c.name, sublabel: c.note, icon: c.icon })}
                    />
                    <Plan
                        axis={axis}
                        data={ops}
                        // The DnD target role: `id` names this surface in every
                        // cell ref, `sources` says which palettes it will take
                        // from, and the two callbacks are the policy and the
                        // commit. Omitting either `id` or `onDrag` registers no
                        // target at all — a drop with nowhere to report is a
                        // gesture that silently loses work.
                        id="ops-plan"
                        sources={["plan-library"]}
                        canDrop={canDrop}
                        onDrag={onDrag}
                        series={[
                            // INERT — a chart plots a derived series, so there
                            // is nothing a card could become here.
                            Plan.series.chart(OpsRow, {
                                key: "util", title: "Utilisation",
                                match: r => r.series.equal("util"),
                                label: r => r.label, id: true, height: "spark",
                                layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                            }),
                            // RECEIVES — runs are discrete scheduled objects.
                            // The row's own runs, plus one proposed run per
                            // card dropped on it — a fortnight long, starting
                            // at the bucket the pointer named.
                            Plan.series.span(OpsRow, {
                                key: "mach", title: "Machine jobs",
                                match: r => r.series.equal("mach"),
                                label: r => r.label, id: true,
                                runs: (r, k) => r.jobs.map((_$, j) => Plan.run({
                                    key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                                })).concat(drops.has(k).ifElse(() => drops.get(k), () => noDrops)
                                    .map((_$, d) => Plan.run({
                                        key: d.key, start: d.at, end: d.at.addWeeks(2n),
                                        label: d.label, state: ADDED,
                                    }))),
                            }),
                            // INERT — an intensity field has no object to add to.
                            Plan.series.heat(OpsRow, {
                                key: "load", title: "Line load",
                                match: r => r.series.equal("load"),
                                label: r => r.label,
                                cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                            }),
                            // RECEIVES — a dropped delivery becomes a tile in
                            // the bucket under the pointer.
                            Plan.series.buckets(OpsRow, {
                                key: "dock", title: "Dock allocations",
                                match: r => r.series.equal("dock"),
                                label: r => r.label,
                                events: (r, k) => r.allocs.map((_$, a) =>
                                    Plan.event({ key: a.key, at: a.at, state: a.state }))
                                    .concat(drops.has(k).ifElse(() => drops.get(k), () => noDrops)
                                        .map((_$, d) => Plan.event({ key: d.key, at: d.at, state: ADDED }))),
                            }),
                            // INERT — the cells are computed numbers.
                            Plan.series.table(OpsRow, {
                                key: "table", title: "Despatch tonnes",
                                match: r => r.series.equal("table"),
                                label: r => r.label,
                                cells: r => r.nums,
                                format: Format.Number({ maximumFractionDigits: 0n }),
                            }),
                            // RECEIVES — a dropped shift becomes a chip.
                            Plan.series.cards(OpsRow, {
                                key: "crew", title: "Crew shifts",
                                match: r => r.series.equal("crew"),
                                label: r => r.label,
                                chips: (r, k) => r.shifts.map((_$, s) => Plan.chip({
                                    key: s.key, from: s.from, to: s.to, label: s.label, state: s.state,
                                })).concat(drops.has(k).ifElse(() => drops.get(k), () => noDrops)
                                    .map((_$, d) => Plan.chip({
                                        key: d.key, from: d.at, to: d.at.addWeeks(2n),
                                        label: d.label, state: ADDED,
                                    }))),
                            }),
                            // RECEIVES — a dropped milestone becomes a mark at
                            // the instant, the one kind with no duration.
                            Plan.series.events(OpsRow, {
                                key: "strm", title: "Milestones",
                                match: r => r.series.equal("strm"),
                                label: r => r.label, id: true,
                                marks: (r, k) => r.marks.concat(
                                    drops.has(k).ifElse(() => drops.get(k), () => noDrops)
                                        .map((_$, d) => Plan.mark({
                                            key: d.key, at: d.at, kind: "milestone", label: d.label,
                                        }))),
                            }),
                            // The STRIP is inert; the span row inside it is not.
                            Plan.series.group(OpsRow, { key: "g1-line3", label: "Line 3", meta: "span" }, [
                                Plan.series.span(OpsRow, {
                                    key: "gmach", title: "Grouped machine jobs",
                                    match: r => r.series.equal("gmach"),
                                    label: r => r.label, id: true,
                                    runs: (r, k) => r.jobs.map((_$, j) => Plan.run({
                                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                                    })).concat(drops.has(k).ifElse(() => drops.get(k), () => noDrops)
                                        .map((_$, d) => Plan.run({
                                            key: d.key, start: d.at, end: d.at.addWeeks(2n),
                                            label: d.label, state: ADDED,
                                        }))),
                                }),
                            ]),
                        ]}
                        style={{ height: "420px" }}
                    />
                    <Text.MonoLabel>{East.str`LAST DROP · ${last}`}</Text.MonoLabel>
                </VStack>
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
    description: "Fill sizing over variable row heights — 200 virtualized rows of mixed kinds under 8 rollup parents",
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
                    at: Plan.at.time(week(j.multiply(2n).add(27n))),
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
    description: "Live review chrome — verdicts live in bound `State`, and the canvas re-derives buttons, bar and dot",
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
    description: "Expand-in-place — a row declares `expand`, the root renders plot and gutter, and unfocused rows collapse to strips",
    fn: East.function([], UIComponentType, ($) => {
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // ONE raw source; `series` picks the series and `expand` is per-row
        // DATA — presence is what grows the ⤢ control on that row.
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const OpsRow = StructType({
            series: StringType,
            label: StringType,
            expand: OptionType(Plan.Types.Expand),
            jobs: ArrayType(StructType({
                key: StringType, label: StringType,
                start: DateTimeType, end: DateTimeType, state: EventStateType,
            })),
            points: ArrayType(MeasureRow),
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
        const noPoints = $.const([], ArrayType(MeasureRow));
        const covPcts = $.const(
            [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2],
            ArrayType(FloatType));
        const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$, i) =>
            ({ week: week(i.add(27n)), pct: covPcts.get(i) })));
        const ops = $.const(new Map([
            // A CHART row — the one kind whose marks are a VALUE scale. Its
            // plot, its gutter ticks and its ref-label gate answer to the band
            // the marks keep at the top, not to the grown row (#591).
            ["COVERAGE", { series: "chart", label: "COVERAGE",
              expand: some({ height: some("150px"), axis: variant("keep", null) }),
              jobs: noJobs, points: coverage, cells: noCells, nums: noNums, marks: noMarks }],
            // axis: keep — the grid and now-line run THROUGH the render.
            ["L1-M03", { series: "span", label: "L1-M03",
              expand: some({ height: some("168px"), axis: variant("keep", null) }),
              jobs: [
                  { key: "b208", label: "RUN · B-208", start: week(27n), end: week(30n), state: variant("actual", null) },
                  { key: "qc", label: "QC", start: week(30n), end: week(32n), state: variant("confirmed", null) },
                  { key: "b231", label: "RUN · B-231", start: week(33n), end: week(38n), state: variant("proposed", variant("recommended", null)) },
              ], points: noPoints, cells: noCells, nums: noNums, marks: noMarks }],
            // axis: dim — washed to 40% behind a dense render.
            ["L1-M04", { series: "span", label: "L1-M04",
              expand: some({ height: some("140px"), axis: variant("dim", null) }),
              jobs: [
                  { key: "b214", label: "RUN · B-214", start: week(28n), end: week(33n), state: variant("in-progress", null) },
              ], points: noPoints, cells: noCells, nums: noNums, marks: noMarks }],
            // No declaration — no control. The contrast is the point: one row
            // that cannot be expanded beside five that can.
            ["L1-M07", { series: "span", label: "L1-M07", expand: none,
              jobs: [
                  { key: "hld", label: "HLD · B-197", start: week(27n), end: week(31n), state: variant("actual", null) },
              ], points: noPoints, cells: noCells, nums: noNums, marks: noMarks }],
            // The kinds that COLLAPSE differently — heat keeps its ramp, the
            // table re-encodes its numerals, the marks keep their silhouettes.
            ["LOAD", { series: "heat", label: "Line load",
              expand: some({ height: some("132px"), axis: variant("keep", null) }),
              jobs: noJobs, points: noPoints, nums: noNums, marks: noMarks,
              cells: [
                  { at: Plan.at.time(week(27n)), value: some(46.0), label: some("46") },
                  { at: Plan.at.time(week(28n)), value: some(58.0), label: some("58") },
                  { at: Plan.at.time(week(29n)), value: some(66.0), label: some("66") },
                  { at: Plan.at.time(week(30n)), value: some(72.0), label: some("72") },
                  { at: Plan.at.time(week(31n)), value: some(84.0), label: some("84") },
                  { at: Plan.at.time(week(32n)), value: some(90.0), label: some("90") },
                  { at: Plan.at.time(week(33n)), value: some(96.0), label: some("96") },
                  { at: Plan.at.time(week(34n)), value: none, label: none },
                  { at: Plan.at.time(week(35n)), value: some(92.0), label: some("92") },
              ] }],
            // axis: off — the render draws its own canvas, so the shared lines
            // are suppressed INSIDE this row only (the ruler never moves).
            ["DESPATCH", { series: "table", label: "Despatch t",
              expand: some({ height: some("120px"), axis: variant("off", null) }),
              jobs: noJobs, points: noPoints, cells: noCells, marks: noMarks,
              nums: [
                  { at: Plan.at.time(week(27n)), value: some(128.0), text: none, tone: none },
                  { at: Plan.at.time(week(28n)), value: some(134.0), text: none, tone: none },
                  { at: Plan.at.time(week(29n)), value: some(119.0), text: none, tone: none },
                  { at: Plan.at.time(week(30n)), value: some(-96.0), text: none, tone: none },
                  { at: Plan.at.time(week(31n)), value: some(-88.0), text: none, tone: none },
                  { at: Plan.at.time(week(32n)), value: none, text: none, tone: none },
                  { at: Plan.at.time(week(33n)), value: some(151.0), text: none, tone: none },
                  { at: Plan.at.time(week(34n)), value: some(162.0), text: none, tone: none },
                  { at: Plan.at.time(week(35n)), value: some(144.0), text: none, tone: none },
              ] }],
            ["MILESTONES", { series: "events", label: "MILESTONES",
              expand: some({ height: some("112px"), axis: variant("dim", null) }),
              jobs: noJobs, points: noPoints, cells: noCells, nums: noNums,
              marks: [
                  { key: "k", at: Plan.at.time(week(28n)), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                  { key: "d", at: Plan.at.time(week(31n)), kind: variant("decision", { applied: true }), icon: none, label: none },
                  { key: "a", at: Plan.at.time(week(34n)), kind: variant("exception", null), icon: none, label: some("AUDIT") },
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
                ["COVERAGE", { a: "TARGET 100 · MIN 92", b: "BREACH W34–W36 · 3 wk", fill: 0.94 }],
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
                    Plan.series.chart(OpsRow, {
                        key: "chart-2", title: "Chart",
                        match: r => r.series.equal("chart"),
                        label: r => r.label, id: true, expand: r => r.expand,
                        height: "spark",
                        left: { domain: [80, 110], tickValues: [80, 100] },
                        layers: r => [
                            Plan.layer(Chart.Line(r.points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                            Chart.refLine({ y: 100, label: "TARGET 100" }),
                        ],
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

// ============================================================================
// planNarrow — the §10 narrow layout: a phone-width box makes the Plan a
// review tool, not a canvas (#570)
// ============================================================================

/**
 * Below 480px of CONTAINER width — not the viewport: this example is a 360px
 * `<Box>` on a desktop page — the Plan reflows to the §10 layout: three tabs
 * over ONE slice (Groups · Rows · Measures), the group grain as hottest-first
 * strip cards, one group's rows as cards whose head is the row's gutter
 * identity and whose body is its plot on the shared window, chart rows
 * full-width at expanded density. A row declaring `expand` drills in place on
 * a second tap; horizontal pan is two-finger. The DEFINITION is the desktop
 * one — the same `data` + `series`, the same slice — only the box changed.
 */
export const planNarrow = example({
    keywords: ["Plan", "narrow", "mobile", "phone", "responsive", "compact", "container", "breakpoint", "tabs", "Groups", "Rows", "Measures", "cards", "strip", "hottest", "two-finger", "pan", "review", "cohort", "slice", "§10", "raw"],
    description: "The narrow layout — a phone-width box turns the same canvas into a review tool: Groups · Rows · Measures tabs, hottest-first strip cards, rows as cards, charts at expanded density",
    fn: East.function([], UIComponentType, (_$) => {
        const HorizonRow = StructType({ key: StringType, at: DateTimeType, risk: StringType });
        const cfg = Slice.config(HorizonRow, {
            fields: { at: { label: "Despatched", format: { date: "MMM D" } }, risk: { label: "Risk", hints: ["late", "on-time"] } },
            rangeFieldId: "at",
        });
        return (<Reactive>{$ => {
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            const JobRow = StructType({
                key: StringType, label: StringType,
                start: DateTimeType, end: DateTimeType, state: EventStateType,
            });
            // ONE raw source: `series` picks the series, `line` the group a row
            // belongs to (the KPI belongs to none — it rides the Measures tab
            // and an "Other rows" card), and every envelope field is per-row DATA.
            const OpsRow = StructType({
                series: StringType, line: StringType, label: StringType,
                value: OptionType(StringType), status: OptionType(StatusValueType),
                expand: OptionType(Plan.Types.Expand),
                jobs: ArrayType(JobRow),
                cells: ArrayType(Plan.Types.HeatCell),
                points: ArrayType(MeasureRow),
            });
            const noJobs = $.const([], ArrayType(JobRow));
            const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
            const noPoints = $.const([], ArrayType(MeasureRow));
            const loadPcts = $.const(
                [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0],
                ArrayType(FloatType));
            // Line 2 runs hotter than Line 1 — the Groups tab sorts it first.
            const loadA = $.let(East.Array.generate(12n, Plan.Types.HeatCell, (_$, i) => ({
                at: Plan.at.time(week(i.add(27n))), value: some(loadPcts.get(i).multiply(0.85)),
                label: some(East.Float.printFixed(loadPcts.get(i).multiply(0.85), 0n)),
            })));
            const loadB = $.let(East.Array.generate(12n, Plan.Types.HeatCell, (_$, i) => ({
                at: Plan.at.time(week(i.add(27n))), value: some(loadPcts.get(i)),
                label: some(East.Float.printFixed(loadPcts.get(i), 0n)),
            })));
            const covPcts = $.const(
                [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2],
                ArrayType(FloatType));
            const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$, i) =>
                ({ week: week(i.add(27n)), pct: covPcts.get(i) })));
            const ops = $.const(new Map([
                ["L1-M03", { series: "mach", line: "Line 1 · Fill", label: "L1-M03",
                  value: some("120 t"), status: some(variant("success", null)),
                  expand: some({ height: some("140px"), axis: variant("keep", null) }),
                  jobs: [
                      { key: "b208", label: "RUN · B-208", start: week(27n), end: week(30n), state: variant("actual", null) },
                      { key: "qc", label: "QC", start: week(30n), end: week(32n), state: variant("confirmed", null) },
                      { key: "b231", label: "RUN · B-231", start: week(33n), end: week(38n), state: variant("proposed", variant("recommended", null)) },
                  ], cells: noCells, points: noPoints }],
                ["L1-M04", { series: "mach", line: "Line 1 · Fill", label: "L1-M04",
                  value: some("120 t"), status: some(variant("warning", null)), expand: none,
                  jobs: [
                      { key: "b214", label: "RUN · B-214", start: week(28n), end: week(33n), state: variant("in-progress", null) },
                  ], cells: noCells, points: noPoints }],
                ["l1-load", { series: "load", line: "Line 1 · Fill", label: "Line load",
                  value: none, status: none, expand: none,
                  jobs: noJobs, cells: loadA, points: noPoints }],
                ["L2-M11", { series: "mach", line: "Line 2 · Assy", label: "L2-M11",
                  value: some("80 t"), status: none, expand: none,
                  jobs: [
                      { key: "b241", label: "RUN · B-241", start: week(29n), end: week(34n), state: variant("confirmed", null) },
                  ], cells: noCells, points: noPoints }],
                ["l2-load", { series: "load", line: "Line 2 · Assy", label: "Line load",
                  value: none, status: some(variant("warning", null)), expand: none,
                  jobs: noJobs, cells: loadB, points: noPoints }],
                ["coverage", { series: "kpi", line: "", label: "COVERAGE",
                  value: some("94.2%"), status: none, expand: none,
                  jobs: noJobs, cells: noCells, points: coverage }],
            ]), DictType(StringType, OpsRow));
            // The slice's own rows — despatch orders with a late-risk cohort
            // seeded active, so the chips row has something to say.
            const horizon = $.let(East.Array.generate(24n, HorizonRow, (_$, i) => ({
                key: East.str`h${East.print(i.add(1n))}`,
                at: week(i.divide(2n).add(27n)),
                risk: i.remainder(3n).equal(0n).ifElse(() => "late", () => "on-time"),
            })));
            const slice = $.let(Slice.bind([HorizonRow], "ex.plan.narrow", cfg, Slice.state({
                range: some(variant("datetime", { from: week(27n), to: week(39n) })),
                cohorts: [{ id: "late", name: "Late risk", filters: [variant("string", { fieldId: "risk", op: variant("eq", "late") })] }],
                activeCohorts: new Set(["late"]),
            }), horizon, none));
            const series = $.const([
                // One strip per line, DISCOVERED from the data; its summary
                // strip is the max of its heat rows — what "hottest first" reads.
                Plan.series.group(OpsRow, {
                    key: "lines", title: "Lines",
                    by: r => r.line, match: r => r.line.equal("").not(),
                    keyPrefix: "g-", summaryAggregate: "max",
                }, [
                    Plan.series.span(OpsRow, {
                        key: "mach", title: "Machines",
                        match: r => r.series.equal("mach"),
                        label: r => r.label, id: true,
                        value: r => r.value, status: r => r.status, expand: r => r.expand,
                        runs: r => r.jobs.map((_$, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                        })),
                    }),
                    Plan.series.heat(OpsRow, {
                        key: "load", title: "Line load",
                        match: r => r.series.equal("load"),
                        label: r => r.label, status: r => r.status,
                        cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 95 }),
                    }),
                ]),
                Plan.series.chart(OpsRow, {
                    key: "kpi", title: "Coverage",
                    match: r => r.series.equal("kpi"),
                    label: r => r.label, id: true, value: r => r.value,
                    height: "spark",
                    left: { domain: [80, 110], tickValues: [80, 100] },
                    layers: r => [
                        Plan.layer(Chart.Line(r.points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                        Chart.refLine({ y: 100, label: "TARGET 100" }),
                    ],
                }),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            const util = $.let(East.Array.generate(12n, FloatType, (_$, i) =>
                i.multiply(19n).remainder(48n).toFloat().add(50.0)));
            const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, (_$, _ref) => (
                <Sparkline data={util} type="area" color="link" width="100%" height="100%" />
            )));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) },
                resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
            }));
            // The 360px box is the whole point: the reflow is a property of
            // the CONTAINER, so a phone, a splitter pane and this box agree.
            return (
                <Box width="360px">
                    <Plan
                        axis={axis}
                        data={ops}
                        series={series}
                        slice={{ slice, affordances: ["cohort", "filter", "range", "resolution", "summary"] }}
                        expandRender={expandRender}
                        footer={[
                            { text: "6 ROWS · 2 LINES" },
                            { text: "RUN 412 · W27–W38", end: true },
                        ]}
                        style={{ height: "560px" }}
                    />
                </Box>
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// planNumberAxis — the `number` axis (#631): day 1..8 with AM/PM lanes
// ============================================================================

/**
 * The `number` axis — the retired Planner's `plannerPoint` canvas on the
 * Plan: eight days at step 1, AM/PM lanes in the bucket rows, `now` at day
 * 5. Every kind positions on the one numeric scale, and every instant in the
 * raw data is a plain number: a `FloatType` field wraps to the `number` arm
 * through the element builders (`Plan.run({ start: j.start })`), a chart
 * layer's numeric x accessor lands its columns on the same arm, `Plan.tableCells`
 * reads a numeric `at`, and the heat cells stored as RECORDS spell it out with
 * `Plan.at.number`. The slice's range field is a float, so the horizon brush
 * and the range chip ride the slice's `float` arm exactly as they ride
 * `datetime` on a time axis; there is no resolution segment — `step` is the
 * declaration.
 */
export const planNumberAxis = example({
    keywords: [
        "Plan", "axis", "number", "numeric", "step", "Plan.axis.number", "Plan.at", "instant",
        "day", "AM", "PM", "lanes", "buckets", "Planner", "plannerPoint", "brush", "float", "range",
        "format", "now", "typed axis", "#631", "raw",
    ],
    description: "The number axis — day 1..8 at step 1 with AM/PM lanes (the retired Planner's plannerPoint), every row kind on the numeric scale, the horizon brush over the slice's float range",
    fn: East.function([], UIComponentType, (_$) => {
        const HorizonRow = StructType({ key: StringType, day: FloatType, line: StringType });
        const cfg = Slice.config(HorizonRow, {
            fields: { day: { label: "Day" }, line: { label: "Line" } },
            rangeFieldId: "day",
        });
        return (<Reactive>{$ => {
            // RAW rows — every instant is a plain number (a day index).
            const AllocRow = StructType({ key: StringType, day: FloatType, lane: StringType, state: EventStateType });
            const JobRow = StructType({ key: StringType, label: StringType, start: FloatType, end: FloatType, state: EventStateType });
            const ShiftRow = StructType({ key: StringType, from: FloatType, to: FloatType, hours: FloatType, state: EventStateType });
            const MarkRow = StructType({ key: StringType, day: FloatType, label: StringType });
            const PointRow = StructType({ day: FloatType, t: FloatType });
            const RawCell = StructType({ at: FloatType, value: OptionType(FloatType) });
            const OpsRow = StructType({
                series: StringType, label: StringType, value: OptionType(StringType),
                allocations: ArrayType(AllocRow), jobs: ArrayType(JobRow), shifts: ArrayType(ShiftRow),
                marks: ArrayType(MarkRow), points: ArrayType(PointRow), tonnes: ArrayType(RawCell),
                cells: ArrayType(Plan.Types.HeatCell),
            });
            const noAllocs = $.const([], ArrayType(AllocRow));
            const noJobs = $.const([], ArrayType(JobRow));
            const noShifts = $.const([], ArrayType(ShiftRow));
            const noMarks = $.const([], ArrayType(MarkRow));
            const noPoints = $.const([], ArrayType(PointRow));
            const noTonnes = $.const([], ArrayType(RawCell));
            const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
            const CONFIRMED = variant("confirmed", null);
            const ACTUAL = variant("actual", null);
            const RUNNING = variant("in-progress", null);
            const PROPOSED = variant("proposed", variant("recommended", null));
            // Per-day series over days 1..8 — derived, never hand-written.
            const points = $.let(East.Array.generate(8n, PointRow, (_$, i) =>
                ({ day: i.toFloat().add(1.0), t: i.multiply(17n).remainder(40n).toFloat().add(60.0) })));
            const tonnes = $.let(East.Array.generate(8n, RawCell, (_$, i) =>
                ({ at: i.toFloat().add(1.0), value: some(i.multiply(23n).remainder(70n).toFloat().add(80.0)) })));
            // Heat cells as STORED records — the instant spelled explicitly.
            const cells = $.let(East.Array.generate(8n, Plan.Types.HeatCell, ($, i) => {
                const load = $.let(i.multiply(29n).remainder(55n).toFloat().add(40.0), FloatType);
                return { at: Plan.at.number(i.toFloat().add(1.0)), value: some(load), label: some(East.Float.printFixed(load, 0n)) };
            }));
            const base = {
                value: none, allocations: noAllocs, jobs: noJobs, shifts: noShifts,
                marks: noMarks, points: noPoints, tonnes: noTonnes, cells: noCells,
            };
            // Keys order the canvas (#568) — numbered so each series lands where the
            // §1 layout puts it.
            const ops = $.const(new Map([
                ["10-dock2", { ...base, series: "dock", label: "Dock 2", value: some("load/day"), allocations: [
                    { key: "a1", day: 1.0, lane: "am", state: CONFIRMED },
                    { key: "a2", day: 1.0, lane: "pm", state: CONFIRMED },
                    { key: "a3", day: 2.0, lane: "am", state: CONFIRMED },
                    { key: "a4", day: 3.0, lane: "pm", state: PROPOSED },
                    { key: "a5", day: 5.0, lane: "am", state: PROPOSED },
                    { key: "a6", day: 6.0, lane: "pm", state: CONFIRMED },
                    { key: "a7", day: 8.0, lane: "am", state: PROPOSED },
                ] }],
                ["10-dock5", { ...base, series: "dock", label: "Dock 5", value: some("load/day"), allocations: [
                    { key: "b1", day: 2.0, lane: "pm", state: CONFIRMED },
                    { key: "b2", day: 4.0, lane: "am", state: CONFIRMED },
                    { key: "b3", day: 4.0, lane: "pm", state: PROPOSED },
                    { key: "b4", day: 7.0, lane: "am", state: PROPOSED },
                ] }],
                ["20-m03", { ...base, series: "mach", label: "L1-M03", value: some("120 t"), jobs: [
                    { key: "set", label: "SET", start: 1.0, end: 2.0, state: ACTUAL },
                    { key: "b214", label: "RUN · B-214", start: 2.0, end: 5.0, state: RUNNING },
                    { key: "b221", label: "RUN · B-221", start: 6.0, end: 8.0, state: PROPOSED },
                ] }],
                ["20-m04", { ...base, series: "mach", label: "L1-M04", value: some("80 t"), jobs: [
                    { key: "b208", label: "RUN · B-208", start: 1.0, end: 4.0, state: ACTUAL },
                    { key: "qc", label: "QC", start: 4.0, end: 5.0, state: CONFIRMED },
                    { key: "b231", label: "RUN · B-231", start: 5.0, end: 9.0, state: PROPOSED },
                ] }],
                ["30-load", { ...base, series: "load", label: "Line load", cells }],
                ["40-out", { ...base, series: "out", label: "OUTPUT · t", value: some("612 t"), points }],
                ["50-desp", { ...base, series: "table", label: "Despatch t", tonnes }],
                ["60-crewA", { ...base, series: "crew", label: "Crew A", shifts: [
                    { key: "s1", from: 1.0, to: 3.0, hours: 24.0, state: CONFIRMED },
                    { key: "s2", from: 3.0, to: 6.0, hours: 36.0, state: CONFIRMED },
                    { key: "s3", from: 6.0, to: 8.0, hours: 24.0, state: PROPOSED },
                ] }],
                ["70-ms", { ...base, series: "ms", label: "MILESTONES", marks: [
                    { key: "kick", day: 2.0, label: "KICKOFF" },
                    { key: "rel", day: 6.0, label: "REL" },
                ] }],
            ]), DictType(StringType, OpsRow));
            const series = $.const([
                Plan.series.group(OpsRow, { key: "10-docks", label: "Docks · In", meta: "2 rs" }, [
                    Plan.series.buckets(OpsRow, {
                        key: "dock", title: "Docks",
                        match: r => r.series.equal("dock"),
                        label: r => r.label, value: r => r.value,
                        // The Planner's AM/PM lanes — sub-slots of each day column.
                        lanes: _r => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                        // `a.day` is a FloatType field — the builder wraps it to the number arm.
                        events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.day, lane: a.lane, state: a.state })),
                    }),
                ]),
                Plan.series.span(OpsRow, {
                    key: "mach", title: "Machines",
                    match: r => r.series.equal("mach"),
                    label: r => r.label, id: true, value: r => r.value,
                    runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
                }),
                Plan.series.heat(OpsRow, {
                    key: "load", title: "Line load",
                    match: r => r.series.equal("load"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 90 }),
                }),
                Plan.series.chart(OpsRow, {
                    key: "out", title: "Output",
                    match: r => r.series.equal("out"),
                    label: r => r.label, id: true, value: r => r.value, height: "expanded",
                    // A numeric x accessor lands the columns on the number arm.
                    layers: r => [Chart.Column(r.points, { x: p => p.day, y: p => p.t })],
                }),
                Plan.series.table(OpsRow, {
                    key: "table", title: "Despatch",
                    match: r => r.series.equal("table"),
                    label: r => r.label,
                    // A `{ at: FloatType, value }` record wraps by its field type.
                    cells: r => Plan.tableCells(r.tonnes),
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(OpsRow, {
                    key: "crew", title: "Crews",
                    match: r => r.series.equal("crew"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) => Plan.chip({
                        key: s.key, from: s.from, to: s.to,
                        label: East.str`${East.Float.printFixed(s.hours, 0n)}h`, state: s.state,
                    })),
                }),
                Plan.series.events(OpsRow, {
                    key: "ms", title: "Milestones",
                    match: r => r.series.equal("ms"),
                    label: r => r.label, id: true,
                    marks: r => r.marks.map((_$, m) => Plan.mark({ key: m.key, at: m.day, kind: "milestone", label: m.label })),
                }),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            // The slice's horizon — twelve days of orders behind an eight-day
            // window. Its range field is a FLOAT, so the brush, the range chip
            // and the window keys write the slice's `float` arm.
            const horizon = $.let(East.Array.generate(24n, HorizonRow, (_$, i) => ({
                key: East.str`o${East.print(i.add(1n))}`,
                day: i.divide(2n).toFloat().add(1.0),
                line: i.remainder(2n).equal(0n).ifElse(() => "Line 1", () => "Line 2"),
            })));
            const slice = $.let(Slice.bind([HorizonRow], "ex.plan.number", cfg, Slice.state({
                range: some(variant("float", { from: 1.0, to: 9.0 })),
            }), horizon, none));
            // The declaration: `[1, 9)` ÷ 1 = eight day columns, the divider at 5.
            const axis = $.const(Plan.axis.number({
                window: { min: 1, max: 9 }, step: 1, now: 5, format: Chart.format.number(),
            }));
            return (
                <Plan
                    axis={axis}
                    data={ops}
                    series={series}
                    slice={{ slice, affordances: ["filter", "range", "brush", "summary"] }}
                    footer={[
                        { text: "8 DAYS · STEP 1 · NOW 5" },
                        { text: "NUMBER AXIS", end: true },
                    ]}
                />
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// planOrdinalAxis — the `ordinal` axis (#631): workflow phases
// ============================================================================

/**
 * The `ordinal` axis — a workflow of six phases, each a bucket, in declared
 * order. Instants are the phase VALUES: a run's `start` / `end` are phase
 * names (an interval covers `[start, end]` in phase order — on an ordinal
 * axis the end names the LAST bucket covered, since values are buckets, not
 * edges), a tile sits in a phase, a chart's string x accessor lands its
 * columns on the phase arm, `Plan.tableCells` reads a string `at`, and
 * `Plan.at.ordinal` spells one out where a record is written as data. There
 * is no slice range for an ordinal axis — the list IS the window, so the
 * horizon brush does not mount and the window keys idle; `now` names a phase.
 */
export const planOrdinalAxis = example({
    keywords: [
        "Plan", "axis", "ordinal", "phase", "phases", "workflow", "stage", "Plan.axis.ordinal",
        "Plan.at", "instant", "values", "list", "span", "buckets", "heat", "chart", "table",
        "cards", "events", "Planner", "typed axis", "#631", "raw",
    ],
    description: "The ordinal axis — six workflow phases as the buckets, in declared order; orders span phases, tiles and cells sit in them, a string x accessor lands a chart on them",
    fn: East.function([], UIComponentType, ($) => {
        const PHASES = $.const(["INTAKE", "PREP", "BUILD", "QC", "PACK", "SHIP"], ArrayType(StringType));
        // RAW rows — every instant is a phase NAME.
        const JobRow = StructType({ key: StringType, label: StringType, start: StringType, end: StringType, state: EventStateType });
        const AllocRow = StructType({ key: StringType, phase: StringType, state: EventStateType });
        const ShiftRow = StructType({ key: StringType, from: StringType, to: StringType, label: StringType, state: EventStateType });
        const MarkRow = StructType({ key: StringType, phase: StringType, label: StringType, exception: BooleanType });
        const PointRow = StructType({ phase: StringType, n: FloatType });
        const RawCell = StructType({ at: StringType, value: OptionType(FloatType) });
        const OrderRow = StructType({
            series: StringType, label: StringType, value: OptionType(StringType),
            jobs: ArrayType(JobRow), allocations: ArrayType(AllocRow), shifts: ArrayType(ShiftRow),
            marks: ArrayType(MarkRow), points: ArrayType(PointRow), counts: ArrayType(RawCell),
            cells: ArrayType(Plan.Types.HeatCell),
        });
        const noJobs = $.const([], ArrayType(JobRow));
        const noAllocs = $.const([], ArrayType(AllocRow));
        const noShifts = $.const([], ArrayType(ShiftRow));
        const noMarks = $.const([], ArrayType(MarkRow));
        const noPoints = $.const([], ArrayType(PointRow));
        const noCounts = $.const([], ArrayType(RawCell));
        const noCells = $.const([], ArrayType(Plan.Types.HeatCell));
        const CONFIRMED = variant("confirmed", null);
        const ACTUAL = variant("actual", null);
        const RUNNING = variant("in-progress", null);
        const PROPOSED = variant("proposed", variant("recommended", null));
        // Per-phase series derived over the declared list — the index picks the value.
        const points = $.let(East.Array.generate(6n, PointRow, (_$, i) =>
            ({ phase: PHASES.get(i), n: i.multiply(7n).remainder(20n).toFloat().add(4.0) })));
        const counts = $.let(East.Array.generate(6n, RawCell, (_$, i) => ({
            at: PHASES.get(i),
            value: i.equal(4n).ifElse(() => none, () => some(i.multiply(11n).remainder(30n).toFloat().add(12.0))),
        })));
        // Heat cells as STORED records — the phase spelled with `Plan.at.ordinal`.
        const cells = $.let(East.Array.generate(6n, Plan.Types.HeatCell, ($, i) => {
            const load = $.let(i.multiply(31n).remainder(60n).toFloat().add(35.0), FloatType);
            return { at: Plan.at.ordinal(PHASES.get(i)), value: some(load), label: some(East.Float.printFixed(load, 0n)) };
        }));
        const base = {
            value: none, jobs: noJobs, allocations: noAllocs, shifts: noShifts,
            marks: noMarks, points: noPoints, counts: noCounts, cells: noCells,
        };
        const orders = $.const(new Map([
            ["10-or-1188", { ...base, series: "order", label: "OR-1188", value: some("96 t"), jobs: [
                { key: "prep", label: "PREP", start: "INTAKE", end: "PREP", state: ACTUAL },
                { key: "build", label: "BUILD · B-214", start: "BUILD", end: "QC", state: RUNNING },
                { key: "ship", label: "PACK + SHIP", start: "PACK", end: "SHIP", state: PROPOSED },
            ] }],
            ["10-or-1204", { ...base, series: "order", label: "OR-1204", value: some("54 t"), jobs: [
                { key: "intake", label: "INTAKE", start: "INTAKE", end: "INTAKE", state: ACTUAL },
                { key: "build", label: "BUILD · B-221", start: "PREP", end: "PACK", state: PROPOSED },
            ] }],
            ["20-bench", { ...base, series: "bench", label: "Bench 2", value: some("slots"), allocations: [
                { key: "a1", phase: "PREP", state: CONFIRMED }, { key: "a2", phase: "BUILD", state: CONFIRMED },
                { key: "a3", phase: "BUILD", state: PROPOSED }, { key: "a4", phase: "PACK", state: PROPOSED },
            ] }],
            ["30-load", { ...base, series: "load", label: "Phase load", cells }],
            ["40-wip", { ...base, series: "wip", label: "WIP · orders", value: some("31"), points }],
            ["50-count", { ...base, series: "count", label: "Orders in phase", counts }],
            ["60-crew", { ...base, series: "crew", label: "Crew B", shifts: [
                { key: "s1", from: "INTAKE", to: "PREP", label: "prep crew", state: CONFIRMED },
                { key: "s2", from: "BUILD", to: "SHIP", label: "+ finish crew", state: PROPOSED },
            ] }],
            ["70-gates", { ...base, series: "gates", label: "GATES", marks: [
                { key: "g1", phase: "QC", label: "HOLD", exception: true },
                { key: "g2", phase: "SHIP", label: "RELEASE", exception: false },
            ] }],
        ]), DictType(StringType, OrderRow));
        const EXCEPTION = $.const(variant("exception", null), Plan.Types.EventMarkKind);
        const MILESTONE = $.const(variant("milestone", null), Plan.Types.EventMarkKind);
        const series = $.const([
            Plan.series.group(OrderRow, { key: "10-orders", label: "Orders", meta: "2 rs" }, [
                Plan.series.span(OrderRow, {
                    key: "order", title: "Orders",
                    match: r => r.series.equal("order"),
                    label: r => r.label, id: true, value: r => r.value,
                    // `j.start` / `j.end` are StringType fields — the builder wraps them to the ordinal arm.
                    runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
                }),
            ]),
            Plan.series.buckets(OrderRow, {
                key: "bench", title: "Benches",
                match: r => r.series.equal("bench"),
                label: r => r.label, value: r => r.value,
                events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.phase, state: a.state })),
            }),
            Plan.series.heat(OrderRow, {
                key: "load", title: "Phase load",
                match: r => r.series.equal("load"),
                label: r => r.label,
                cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 90 }),
            }),
            Plan.series.chart(OrderRow, {
                key: "wip", title: "WIP",
                match: r => r.series.equal("wip"),
                label: r => r.label, id: true, value: r => r.value, height: "expanded",
                // A string x accessor lands the columns on the ordinal arm.
                layers: r => [Chart.Column(r.points, { x: p => p.phase, y: p => p.n })],
            }),
            Plan.series.table(OrderRow, {
                key: "count", title: "Counts",
                match: r => r.series.equal("count"),
                label: r => r.label,
                cells: r => Plan.tableCells(r.counts),
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            Plan.series.cards(OrderRow, {
                key: "crew", title: "Crews",
                match: r => r.series.equal("crew"),
                label: r => r.label,
                chips: r => r.shifts.map((_$, s) => Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
            }),
            Plan.series.events(OrderRow, {
                key: "gates", title: "Gates",
                match: r => r.series.equal("gates"),
                label: r => r.label, id: true,
                marks: r => r.marks.map((_$, m) => Plan.mark({
                    key: m.key, at: m.phase, label: m.label,
                    kind: m.exception.ifElse(() => EXCEPTION, () => MILESTONE),
                })),
            }),
        ], ArrayType(Plan.Types.Series(OrderRow)));
        // The declaration: the list IS the axis — one bucket per phase, `now` at BUILD.
        const axis = $.const(Plan.axis.ordinal({ values: PHASES, now: "BUILD" }));
        return (
            <Plan
                axis={axis}
                data={orders}
                series={series}
                footer={[
                    { text: "6 PHASES · ORDINAL AXIS" },
                    { text: "NOW · BUILD", end: true },
                ]}
            />
        );
    }),
    inputs: [],
});
