/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

import {
    ArrayType,
    BooleanType,
    DateTimeType,
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
import { DragEventType, EventStateType, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Chart, Format, Plan, Reactive, Slice, Text } from "@elaraai/east-ui";

// The corpus — every canvas is DEFINED the one way (`Plan Data Interface.md`
// §3.5): `data` (RAW domain rows — batches, tonnes, lifecycle states; row
// families discriminated by a field; no factory-built values in the data) +
// `series` (one `Plan.series.*` value per family, `$.const`-bound and typed
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
        "layers", "drill", "rollup", "bands", "review", "footer", "milestone",
        "decision", "exception", "pinned", "port", "hovercard", "popover",
        "slice", "brush", "horizon", "toolbar", "affordances", "journeys",
        "journey", "resolver", "data-driven", "accessor", "raw", "target state",
    ],
    description: "The whole operation on one axis, defined the one way — ONE variant-discriminated ops source of RAW records (jobs with batch/tonnes/lifecycle, allocations, shifts with hours, load samples), a Plan.series.* entry per row family whose accessors DERIVE the canvas vocabulary client-side (run labels + quantity displays from batch/tonnes via one bound mapping function, chip labels with the proposal + prefix from hours × state, machine capacity values, tiles from allocations), the generalized popover/hover resolvers over element refs, slice chrome + the horizon brush, review, journeys and a status footer",
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
        // ONE source — row families discriminated by the kind variant (the
        // natural ops-dataset shape; the same rows page from a dataset). The
        // arms carry RAW fields; presence (status / drill payload) is
        // per-row Option DATA the accessors pass through.
        const OpsRow = StructType({
            id: StringType,
            kind: VariantType({
                kpi: StructType({ name: StringType, headline: StringType, pinned: BooleanType,
                                  points: ArrayType(MeasureRow) }),
                machine: StructType({ cap: FloatType,
                                      status: OptionType(StatusValueType),
                                      detail: OptionType(Plan.Types.Drill),
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
            // The ONE ops source — every family's rows in one array, RAW: no
            // display strings the accessors can derive, no built elements.
            const ops = $.const([
                { id: "coverage", kind: variant("kpi", { name: "COVERAGE", headline: "94.2%", pinned: true, points: coverage }) },
                { id: "L1-M03", kind: variant("machine", { cap: 120.0, status: some(variant("success", null)), detail: none,
                  jobs: [
                      { key: "set",  phase: "SET", batch: none, start: week(27n), end: week(28n), tonnes: none, state: variant("actual", null), alert: none },
                      { key: "b214", phase: "RUN", batch: some("B-214"), start: week(28n), end: week(31n), tonnes: some(96.0), state: variant("in-progress", null), alert: none },
                      { key: "cln",  phase: "CLN", batch: none, start: week(31n), end: week(32n), tonnes: none, state: variant("confirmed", null), alert: none },
                      { key: "b221", phase: "RUN", batch: some("B-221"), start: week(32n), end: week(35n), tonnes: some(88.0), state: variant("proposed", variant("recommended", null)), alert: none },
                  ],
                  decisions: [{ key: "d1", at: week(32n), applied: false }],
                  ports:     [{ at: week(31n), label: some("−24 t") }] }) },
                { id: "L1-M04", kind: variant("machine", { cap: 120.0, status: none,
                  // The drill payload — a stored presentation record (plain
                  // data, §3.2); presence is a per-row fact.
                  detail: some({
                      lines: ["120 t · FILL", "B-208 · 88 t · 73%"],
                      meter: some(0.73),
                      series: some([
                          { at: week(27n), value: 10.0 }, { at: week(29n), value: 96.0 },
                          { at: week(31n), value: 88.0 }, { at: week(34n), value: 64.0 }, { at: week(38n), value: 92.0 },
                      ]),
                      events: ["LEVEL t · DAILY", "START 04 JUL", "TRANSFER W31 · −24 t", "QC W33"],
                      journey: some("B-208"),
                  }),
                  jobs: [
                      { key: "b208", phase: "RUN", batch: some("B-208"), start: week(27n), end: week(30n), tonnes: some(112.0), state: variant("actual", null), alert: none },
                      { key: "hld",  phase: "HLD", batch: none, start: week(30n), end: week(31n), tonnes: none, state: variant("confirmed", null), alert: none },
                      { key: "qc",   phase: "QC", batch: none, start: week(31n), end: week(33n), tonnes: none, state: variant("confirmed", null), alert: none },
                      { key: "b231", phase: "RUN", batch: some("B-231"), start: week(33n), end: week(41n), tonnes: some(104.0), state: variant("proposed", variant("recommended", null)), alert: none },
                  ],
                  decisions: [], ports: [] }) },
                { id: "L1-M07", kind: variant("machine", { cap: 80.0, status: some(variant("warning", null)), detail: none,
                  jobs: [
                      { key: "b197", phase: "HLD", batch: some("B-197"), start: week(27n), end: week(31n), tonnes: none, state: variant("actual", null), alert: some(variant("warning", null)) },
                      { key: "cln", phase: "CLN", batch: none, start: week(34n), end: week(36n), tonnes: none, state: variant("proposed", variant("recommended", null)), alert: none },
                  ],
                  decisions: [], ports: [] }) },
                { id: "l2-load", kind: variant("load", { name: "L2 load", sub: "%/wk", cells: loadCells }) },
                { id: "dock2", kind: variant("dock", { name: "Dock 2",
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
                  markers: [{ at: week(35n), lane: none, status: variant("warning", null), message: "capacity breach — 2 allocations" }] }) },
                { id: "crewA", kind: variant("crew", { name: "Crew A", hours: "152h → 168h", shifts: [
                    { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
                    { key: "s2", from: week(29n), to: week(31n), hours: 72.0, state: variant("confirmed", null) },
                    { key: "s3", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
                    { key: "s4", from: week(34n), to: week(35n), hours: 48.0, state: variant("estimated", null) },
                    { key: "s5", from: week(36n), to: week(38n), hours: 56.0, state: variant("proposed", variant("recommended", null)) },
                ] }) },
                { id: "milestones", kind: variant("stream", { name: "MILESTONES", marks: [
                    { key: "kick", at: week(28n), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                    { key: "d1", at: week(31n), kind: variant("decision", { applied: true }), icon: none, label: none },
                    { key: "rel", at: week(33n), kind: variant("milestone", null), icon: none, label: some("REL 2.4") },
                    { key: "audit", at: week(35n), kind: variant("exception", null), icon: none, label: some("AUDIT") },
                    { key: "d2", at: week(37n), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
                ] }) },
            ], ArrayType(OpsRow));
            // The series — one entry per row family, canvas order = series
            // order; the whole list is an East value typed by the constructor.
            const series = $.const([
                Plan.series.chart(OpsRow, {
                    match: r => r.kind.hasTag("kpi"),
                    key: r => r.id, label: r => r.kind.unwrap("kpi").name, id: true,
                    pinned: r => r.kind.unwrap("kpi").pinned,
                    value: r => some(r.kind.unwrap("kpi").headline),
                    status: _r => some(variant("warning", null)),
                    height: "spark", expandable: true,
                    layers: r => [
                        Plan.layer(Chart.Line(r.kind.unwrap("kpi").points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                        Chart.refLine({ y: 100, label: "TARGET 100" }),
                    ],
                }),
                Plan.series.group(OpsRow, { key: "line1", label: "Line 1", meta: "8 rs · 82%" }, [
                    Plan.series.span(OpsRow, {
                        match: r => r.kind.hasTag("machine"),
                        key: r => r.id, label: r => r.id, id: true,
                        value:  r => some(East.str`${East.Float.printFixed(r.kind.unwrap("machine").cap, 0n)} t`),
                        status: r => r.kind.unwrap("machine").status,
                        drill:  r => r.kind.unwrap("machine").detail,
                        runs: r => jobRuns(r.kind.unwrap("machine").jobs),
                        decisions: r => r.kind.unwrap("machine").decisions,
                        ports: r => r.kind.unwrap("machine").ports,
                    }),
                ]),
                Plan.series.group(OpsRow, { key: "line2", label: "Line 2", value: "98%", status: "warning", collapsed: true, summaryAggregate: "mean" }, [
                    Plan.series.heat(OpsRow, {
                        match: r => r.kind.hasTag("load"),
                        key: r => r.id, label: r => r.kind.unwrap("load").name,
                        sub: r => some(r.kind.unwrap("load").sub),
                        cells: r => Plan.heatCells(r.kind.unwrap("load").cells, { min: 0, max: 100, warnAt: 95 }),
                    }),
                ]),
                Plan.series.group(OpsRow, { key: "docks", label: "Docks · In", meta: "3 rs" }, [
                    Plan.series.buckets(OpsRow, {
                        match: r => r.kind.hasTag("dock"),
                        key: r => r.id, label: r => r.kind.unwrap("dock").name,
                        value: _r => some("load/wk"),
                        events: r => r.kind.unwrap("dock").allocations.map((_$, a) =>
                            Plan.event({ key: a.key, at: a.at, state: a.state })),
                        markers: r => r.kind.unwrap("dock").markers,
                    }),
                ]),
                Plan.series.cards(OpsRow, {
                    match: r => r.kind.hasTag("crew"),
                    key: r => r.id, label: r => r.kind.unwrap("crew").name, stacked: true,
                    sub: r => some(r.kind.unwrap("crew").hours),
                    chips: r => shiftChips(r.kind.unwrap("crew").shifts),
                }),
                Plan.series.events(OpsRow, {
                    match: r => r.kind.hasTag("stream"),
                    key: r => r.id, label: r => r.kind.unwrap("stream").name, id: true,
                    value: r => some(East.print(r.kind.unwrap("stream").marks.length())),
                    marks: r => r.kind.unwrap("stream").marks,
                }),
            ], ArrayType(Plan.Types.Series(OpsRow)));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) },
                resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
            }));
            const slice = $.let(Slice.bind([HorizonRow], "ex.plan.target", cfg, Slice.state(), horizon, none));
            // The K8 journey resolver — called with an item key at interaction time.
            const journeys = $.const(East.function([StringType], Plan.Types.Journey, (_$, item) => ({
                title: East.str`JOURNEY · ITEM ${item} · BORN 04 JUL · 118 T`,
                rows: [
                    { key: "anc", label: "B-208 · M05", sublabel: some("ancestor"),
                      runs: [Plan.run({ key: "a1", start: week(27n), end: week(29n), label: "RUN · 34 t", qty: 34, state: "actual" })] },
                    { key: "focus", label: "B-214 · M03", sublabel: some("focus item"),
                      runs: [Plan.run({ key: "f1", start: week(29n), end: week(33n), label: "RUN · 118 t", qty: 118, state: "in-progress" })] },
                    { key: "d60", label: "→ M04", sublabel: some("split 60%"),
                      runs: [Plan.run({ key: "s1", start: week(33n), end: week(35n), label: "DSP · 71 t", qty: 71, state: "recommended" })] },
                ],
                ribbons: [
                    { fromRow: "anc", fromRun: "a1", toRow: "focus", toRun: "f1", quantity: 34.0, label: "34 t" },
                    { fromRow: "focus", fromRun: "f1", toRow: "d60", toRun: "s1", quantity: 71.0, label: "71 t" },
                ],
                decisions: [Plan.decision({ key: "split", at: week(33n), applied: false })],
            })));
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
                    journeys={journeys}
                    popover={popover}
                    hover={hover}
                    onSelect={onRowRef}
                    onDrill={onRowRef}
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
    description: "Span-row families over ONE raw machine source — jobs carry phase/batch/tonnes/lifecycle and ONE bound mapping function derives every run's label and quantity pair client-side: the proposal flavours (forecast ghost, proposed cut, declined) as a value-gutter family, a stacked family whose row carries its expand declaration in the data (the root's expandRender resolver mounts the body) plus a decision diamond and port, a groupBy family with union rollup parents (renderer-derived ×k bands), a runoff despatch family, and a byStatus groupBy family inside a static series.group strip; the six-edge link graph rides the root",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        // The RAW job record; `family` picks the series, everything else —
        // including the expand declaration — is per-row data.
        const JobRow = StructType({
            key: StringType, phase: StringType, batch: OptionType(StringType),
            start: DateTimeType, end: DateTimeType,
            tonnes: OptionType(FloatType), state: EventStateType,
        });
        const MachineRow = StructType({
            id: StringType, family: StringType, program: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            expand: OptionType(Plan.Types.Expand),
            jobs: ArrayType(JobRow),
            decisions: ArrayType(Plan.Types.DecisionMark),
            ports: ArrayType(Plan.Types.Port),
        });
        const machines = $.const([
            // Proposal flavours: forecast ghost · proposed cut · declined.
            { id: "L1-M07", family: "flavours", program: "", sub: none, value: some("80 t"), expand: none,
              jobs: [
                  { key: "run", phase: "RUN", batch: some("B-197"), start: week(27n), end: week(30n), tonnes: some(64.0), state: variant("in-progress", null) },
                  { key: "gho", phase: "FORECAST", batch: none, start: week(30n), end: week(32n), tonnes: none, state: variant("estimated", null) },
                  { key: "rem", phase: "CUT", batch: none, start: week(33n), end: week(35n), tonnes: none, state: variant("proposed", variant("removed", null)) },
                  { key: "rej", phase: "DECLINED", batch: none, start: week(36n), end: week(38n), tonnes: none, state: variant("rejected", null) },
              ], decisions: [], ports: [] },
            // Tonnage + an applied decision + a port on a stacked two-line
            // gutter; the EXPAND DECLARATION is row data (R2) — the render is
            // the root's expandRender resolver.
            { id: "L1-M09", family: "detail", program: "", sub: some("cap 120 t"), value: none,
              expand: some({ height: some("152px"), axis: variant("dim", null) }),
              jobs: [
                  { key: "a", phase: "RUN", batch: some("B-208"), start: week(27n), end: week(31n), tonnes: some(112.0), state: variant("actual", null) },
                  { key: "b", phase: "RUN", batch: some("B-231"), start: week(31n), end: week(34n), tonnes: some(104.0), state: variant("proposed", variant("recommended", null)) },
              ],
              decisions: [{ key: "d1", at: week(31n), applied: true }],
              ports: [{ at: week(31n), label: some("−24 t") }] },
            // The rollup family — one union parent per program (renderer-derived bands).
            { id: "L1-M03", family: "rollup", program: "Program A", sub: none, value: none, expand: none,
              jobs: [
                  { key: "b214", phase: "RUN", batch: some("B-214"), start: week(28n), end: week(31n), tonnes: some(96.0), state: variant("actual", null) },
                  { key: "b221", phase: "RUN", batch: some("B-221"), start: week(32n), end: week(35n), tonnes: some(88.0), state: variant("proposed", variant("recommended", null)) },
              ], decisions: [], ports: [] },
            { id: "L2-M11", family: "rollup", program: "Program A", sub: none, value: none, expand: none,
              jobs: [{ key: "b241", phase: "RUN", batch: some("B-241"), start: week(29n), end: week(33n), tonnes: some(92.0), state: variant("confirmed", null) }],
              decisions: [], ports: [] },
            // Linked despatch whose run starts BEYOND the window — in links
            // focus its landing renders as the edge fade.
            { id: "dsp", family: "despatch", program: "", sub: none, value: none, expand: none,
              jobs: [{ key: "d1", phase: "DSP", batch: none, start: week(39n), end: week(42n), tonnes: some(91.0), state: variant("proposed", variant("recommended", null)) }],
              decisions: [], ports: [] },
            // The byStatus family inside the Line 2 strip.
            { id: "L2-M12", family: "line2", program: "Program B", sub: none, value: none, expand: none,
              jobs: [
                  { key: "r1", phase: "RUN", batch: some("B-198"), start: week(28n), end: week(32n), tonnes: some(64.0), state: variant("actual", null) },
                  { key: "r2", phase: "RUN", batch: some("B-202"), start: week(30n), end: week(34n), tonnes: some(40.0), state: variant("proposed", variant("recommended", null)) },
              ], decisions: [], ports: [] },
        ], ArrayType(MachineRow));
        // Raw jobs → runs, once — every span family shares the mapping.
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
                match: r => r.family.equal("flavours"),
                key: r => r.id, label: r => r.id, id: true,
                value: r => r.value,
                runs: r => jobRuns(r.jobs),
            }),
            Plan.series.span(MachineRow, {
                match: r => r.family.equal("detail"),
                key: r => r.id, label: r => r.id, id: true, stacked: true,
                sub: r => r.sub, expand: r => r.expand,
                runs: r => jobRuns(r.jobs), decisions: r => r.decisions, ports: r => r.ports,
            }),
            Plan.series.span(MachineRow, {
                match: r => r.family.equal("rollup"),
                key: r => r.id, label: r => r.id, id: true,
                runs: r => jobRuns(r.jobs),
                groupBy: [r => r.program], rollup: "union", unit: "t",
            }),
            Plan.series.span(MachineRow, {
                match: r => r.family.equal("despatch"),
                key: r => r.id, label: r => r.id, id: true,
                runs: r => jobRuns(r.jobs),
            }),
            Plan.series.group(MachineRow, { key: "line2", label: "Line 2", meta: "1 rs" }, [
                Plan.series.span(MachineRow, {
                    match: r => r.family.equal("line2"),
                    key: r => r.id, label: r => r.id, id: true,
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
    description: "Bucket-row families over ONE dock source — an unbucketed weekly dock whose raw allocations map to resting ✓/plan tiles in the accessor, and an AM/PM-laned dock inside a static series.group strip whose tiles are STORED canvas-vocabulary records (the §3.2 pure-data element shapes: tones, a pulsing proposal, a full-cell mixed tile, an icon tile) plus a cell marker ring; tile popovers/hovercards resolve through the root over the event arm of the element ref",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const AllocRow = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
        const DockRow = StructType({
            id: StringType, family: StringType, label: StringType,
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
        const docks = $.const([
            { id: "dock2", family: "inbound", label: "Dock 2", sub: none, value: some("load/wk"),
              lanes: [], allocations: inbound, tiles: [],
              markers: [{ at: week(29n), lane: none, status: variant("warning", null), message: "capacity 90%" }] },
            // The grammar showcase — tiles stored IN the element vocabulary
            // (plain `PlanBucketEventType` records; no builders in data).
            { id: "dock5", family: "outbound", label: "Dock 5", sub: some("day · am/pm"), value: none,
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
              markers: [{ at: week(29n), lane: none, status: variant("danger", null), message: "capacity breach" }] },
        ], ArrayType(DockRow));
        const series = $.const([
            // Raw allocations → resting tiles, in the accessor.
            Plan.series.buckets(DockRow, {
                match: r => r.family.equal("inbound"),
                key: r => r.id, label: r => r.label,
                value: r => r.value,
                events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                markers: r => r.markers,
            }),
            Plan.series.group(DockRow, { key: "outbound", label: "Docks · Out", meta: "1 rs" }, [
                // Stored vocabulary records pass straight through.
                Plan.series.buckets(DockRow, {
                    match: r => r.family.equal("outbound"),
                    key: r => r.id, label: r => r.label,
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
    description: "Chart-row families over ONE raw measure source — one series per mark kind, layers built from each row's own points via the accessor: a Line spark with a breach threshold and custom expandedHeight, an Area cumulative fill, stacked Columns pairing the row's two point sets by the Plan.layer series channel, a Scatter defect cloud, an expanded Line with refLine/refBand/refDot annotations, and a fixed 120px dual-axis composition (Chart.Root's domain/tickValues vocabulary) inside a static series.group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const BandRow = StructType({ week: DateTimeType, lo: FloatType, hi: FloatType });
        // ONE raw source — each family's points ride the row (`extra` carries
        // the second set for stacked / dual compositions).
        const ChartRow = StructType({
            id: StringType, family: StringType, label: StringType,
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
        const measures = $.const([
            { id: "spark", family: "spark", label: "COVERAGE", sub: none, value: some("94.2%"), points: coverage, extra: [], band: [] },
            { id: "cum", family: "cum", label: "CUMULATIVE · t", sub: none, value: some("194 t"), points: cum, extra: [], band: [] },
            { id: "stacked", family: "stacked", label: "OUTPUT · t", sub: some("t/wk"), value: none, points: out1, extra: out2, band: [] },
            { id: "ppm", family: "ppm", label: "DEFECTS · ppm", sub: none, value: some("161"), points: ppm, extra: [], band: [] },
            { id: "refs", family: "refs", label: "COVERAGE + REFS", sub: none, value: none, points: coverage, extra: [], band: [] },
            { id: "dual", family: "dual", label: "OUT + COVERAGE", sub: none, value: none, points: out1, extra: coverage, band },
        ], ArrayType(ChartRow));
        const series = $.const([
            // Line — the KPI spark with a breach threshold; the caret opens
            // it to a custom 120px (expandedHeight, default 88).
            Plan.series.chart(ChartRow, {
                match: r => r.family.equal("spark"),
                key: r => r.id, label: r => r.label, id: true,
                value: r => r.value, status: _r => some(variant("warning", null)),
                height: "spark", expandable: true, expandedHeight: "120px",
                layers: r => [Plan.layer(Chart.Line(r.points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } })],
            }),
            // Area — the cumulative fill.
            Plan.series.chart(ChartRow, {
                match: r => r.family.equal("cum"),
                key: r => r.id, label: r => r.label, id: true, value: r => r.value,
                layers: r => [Chart.Area(r.points, { x: p => p.week, y: p => p.pct })],
            }),
            // Columns — the row's two point sets stacked by one series id,
            // on a two-line gutter (label over sub).
            Plan.series.chart(ChartRow, {
                match: r => r.family.equal("stacked"),
                key: r => r.id, label: r => r.label, id: true, stacked: true, sub: r => r.sub,
                layers: r => [
                    Plan.layer(Chart.Column(r.points, { x: p => p.week, y: p => p.pct }), { series: "L1" }),
                    Plan.layer(Chart.Column(r.extra, { x: p => p.week, y: p => p.pct }), { series: "L2" }),
                ],
            }),
            // Scatter — the defect cloud.
            Plan.series.chart(ChartRow, {
                match: r => r.family.equal("ppm"),
                key: r => r.id, label: r => r.label, id: true, value: r => r.value,
                layers: r => [Chart.Scatter(r.points, { x: p => p.week, y: p => p.pct })],
            }),
            // Line + every annotation kind, at expanded density.
            Plan.series.chart(ChartRow, {
                match: r => r.family.equal("refs"),
                key: r => r.id, label: r => r.label, id: true,
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
                    match: r => r.family.equal("dual"),
                    key: r => r.id, label: r => r.label, id: true,
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
    description: "Heat-row families over ONE raw line source — per-bucket samples wrapped by the cells accessors client-side: colour-depth cells with a warn ring and a no-data hatch under a groupBy aggregate-mean parent (renderer-derived), booked-vs-free weight bars with a planned tail on a two-line sub gutter, and status-segment compositions (plain segment records) inside a static series.group strip",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const HeatRow = StructType({
            id: StringType, family: StringType, line: StringType, label: StringType,
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
        const lines = $.const([
            { id: "m03h", family: "depth", line: "Line 1", label: "L1-M03", sub: none, cells, weights: [], segs: [] },
            { id: "m04h", family: "depth", line: "Line 1", label: "L1-M04", sub: none, cells, weights: [], segs: [] },
            { id: "booked", family: "booked", line: "", label: "Crew A", sub: some("booked h"), cells: [], weights, segs: [] },
            // Segment compositions — plain `{ fill, weight, label }` records.
            { id: "pack", family: "segments", line: "", label: "Pack line", sub: some("capacity"), cells: [], weights: [],
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
              ] },
        ], ArrayType(HeatRow));
        const series = $.const([
            // The aggregate-mean parent derives per discovered line value.
            Plan.series.heat(HeatRow, {
                match: r => r.family.equal("depth"),
                key: r => r.id, label: r => r.label, id: true,
                cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 95 }),
                groupBy: [r => r.line], aggregate: "mean", scale: { min: 0, max: 100, warnAt: 95 },
            }),
            Plan.series.heat(HeatRow, {
                match: r => r.family.equal("booked"),
                key: r => r.id, label: r => r.label,
                sub: r => r.sub,
                cells: r => Plan.weightCells(r.weights),
            }),
            Plan.series.group(HeatRow, { key: "packing", label: "Packing", meta: "1 rs" }, [
                Plan.series.heat(HeatRow, {
                    match: r => r.family.equal("segments"),
                    key: r => r.id, label: r => r.label,
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
    keywords: ["Plan", "data", "series", "table", "cells", "tableCells", "subtotal", "aggregate", "sum", "format", "emphasis", "footer", "groupBy", "nested", "depth", "em-dash", "neg", "match", "gutter", "tableSeries", "split", "horizontal", "vertical", "multi-value", "strong", "muted", "rollup", "raw"],
    description: "Table-row families over ONE raw order source (per-bucket value arrays only — style lives in the SERIES CONFIG, never the data) — two-level groupBy nesting (top → program subtotal parents, every level renderer-derived), a footer-emphasis net family with a negative tone and the muted em-dash, and multi-series families whose accessors declare the per-POSITION style once (a strong rolled-up actual beside a muted always-signed Δ horizontally; a vertical stack that grows the row)",
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
            key: StringType, family: StringType, name: StringType, top: StringType, program: StringType,
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
        const orders = $.const([
            // The nested family — two groupBy levels derive their subtotals.
            { key: "or-1188", family: "orders", name: "OR-1188", top: "Despatches", program: "Program A", sub: none, act, plan: [] },
            { key: "or-1204", family: "orders", name: "OR-1204", top: "Despatches", program: "Program A", sub: none, act, plan: [] },
            { key: "or-1219", family: "orders", name: "OR-1219", top: "Despatches", program: "Program B", sub: none, act, plan: [] },
            { key: "rt-0031", family: "orders", name: "RT-0031", top: "Returns", program: "Program B", sub: none, act, plan: [] },
            // Footer emphasis + negative tone + the muted em-dash.
            { key: "net", family: "net", name: "Net flow", top: "", program: "", sub: none, plan: [],
              act: [
                  { at: week(27n), value: some(22.0) }, { at: week(28n), value: some(-26.0) },
                  { at: week(29n), value: none },
              ] },
            // Multi-value families — raw act + plan arrays per row.
            { key: "actplan", family: "actplan", name: "Act · Δ plan", top: "", program: "", sub: some("t/wk"), act, plan: deltas },
            { key: "inout", family: "inout", name: "In / out", top: "", program: "", sub: none, act, plan: outflow },
        ], ArrayType(OrderRow));
        const series = $.const([
            Plan.series.table(OrderRow, {
                match: r => r.family.equal("orders"),
                key: r => r.key, label: r => r.name,
                cells: r => Plan.tableCells(r.act),
                groupBy: [r => r.top, r => r.program], aggregate: "sum",
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            Plan.series.table(OrderRow, {
                match: r => r.family.equal("net"),
                key: r => r.key, label: r => r.name, emphasis: "footer",
                cells: r => Plan.tableCells(r.act),
                format: Format.Number({ maximumFractionDigits: 0n }),
            }),
            // Per-POSITION style declared ONCE, in the CONFIG — a strong
            // rolled-up actual beside its muted, always-signed plan Δ.
            Plan.series.table(OrderRow, {
                match: r => r.family.equal("actplan"),
                key: r => r.key, label: r => r.name, stacked: true, sub: r => r.sub,
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
                match: r => r.family.equal("inout"),
                key: r => r.key, label: r => r.name, split: "vertical",
                series: r => [
                    Plan.tableSeries({ cells: Plan.tableCells(r.act) }),
                    Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(r.plan) }),
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
    description: "Cards-row families over ONE crew source — a raw-shift family whose accessor derives every chip label from hours × lifecycle (the proposal + prefix; confirmed tint, proposed dashed, removed strikethrough, estimated ghost) on a stacked two-line gutter, plus a stored-vocabulary family (plain chip records with an icon) inside a static series.group strip, under a custom `axis.format` ruler; chip detail resolves through the root popover over the chip arm",
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
            id: StringType, family: StringType, name: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            shifts: ArrayType(ShiftRow),
            chips: ArrayType(Plan.Types.Chip),
        });
        const crews = $.const([
            // RAW shifts — hours + lifecycle; chip labels derive client-side.
            { id: "crewA", family: "main", name: "Crew A", sub: some("152h → 168h"), value: none, chips: [], shifts: [
                { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
                { key: "s2", from: week(29n), to: week(31n), hours: 56.0, state: variant("proposed", variant("removed", null)) },
                { key: "s3", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
                { key: "s4", from: week(34n), to: week(35n), hours: 48.0, state: variant("estimated", null) },
            ] },
            // STORED vocabulary — plain chip records (the §3.2 element
            // shapes), here carrying the shift-type icon.
            { id: "crewB", family: "pool", name: "Crew B", sub: none, value: some("128h"), shifts: [], chips: [
                { key: "b1", from: week(28n), to: week(31n), label: "96h", state: variant("confirmed", null),
                  icon: some({ prefix: "fas", name: "user-group", label: none, style: none }) },
                { key: "b2", from: week(33n), to: week(36n), label: "+32h", state: variant("proposed", variant("recommended", null)), icon: none },
            ] },
        ], ArrayType(CrewRow));
        const series = $.const([
            Plan.series.cards(CrewRow, {
                match: r => r.family.equal("main"),
                key: r => r.id, label: r => r.name, stacked: true,
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
                    match: r => r.family.equal("pool"),
                    key: r => r.id, label: r => r.name,
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
    description: "Event-row families over ONE stream source of plain mark records (the §3.2 element shapes — kind variants carry milestone/decision{applied}/exception directly) — milestone dots, pending and applied decision diamonds, an exception triangle, a custom FA glyph swap and a clustered ×3 label on a single-line gutter, plus a stacked two-line release stream inside a static series.group strip; mark detail resolves through the root popover over the mark arm",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const StreamRow = StructType({
            id: StringType, family: StringType, name: StringType,
            sub: OptionType(StringType), value: OptionType(StringType),
            marks: ArrayType(Plan.Types.EventMark),
        });
        const streams = $.const([
            { id: "ms", family: "main", name: "MILESTONES", sub: none, value: some("5"), marks: [
                { key: "kick", at: week(28n), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
                { key: "d1", at: week(31n), kind: variant("decision", { applied: true }), icon: none, label: none },
                { key: "rel", at: week(33n), kind: variant("milestone", null),
                  icon: some({ prefix: "fas", name: "rocket", label: none, style: none }), label: some("REL 2.4") },
                { key: "audit", at: week(35n), kind: variant("exception", null), icon: none, label: some("AUDIT") },
                { key: "d2", at: week(37n), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
            ] },
            { id: "release", family: "programs", name: "RELEASES", sub: some("6-wk cadence"), value: none, marks: [
                { key: "r1", at: week(29n), kind: variant("milestone", null), icon: none, label: some("2.3") },
                { key: "r2", at: week(36n), kind: variant("milestone", null), icon: none, label: some("2.4") },
            ] },
        ], ArrayType(StreamRow));
        const series = $.const([
            Plan.series.events(StreamRow, {
                match: r => r.family.equal("main"),
                key: r => r.id, label: r => r.name, id: true,
                value: r => r.value,
                marks: r => r.marks,
            }),
            Plan.series.group(StreamRow, { key: "programs", label: "Programs", meta: "1 rs" }, [
                Plan.series.events(StreamRow, {
                    match: r => r.family.equal("programs"),
                    key: r => r.id, label: r => r.name, id: true, stacked: true,
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
    description: "Group-strip forms over ONE raw line source — a static expanded series.group with meta chrome around mixed-kind child families (a span family mapping raw jobs + a heat family), a static collapsed group resting as its DECLARED mean strip, and the DISCOVERED form (series.group with a `by` accessor) building one collapsed strip per distinct line value with the member-count meta",
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
            id: StringType, family: StringType, line: StringType, label: StringType,
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
        const lines = $.const([
            // Static Line 1 — mixed kinds (a span child + a heat child).
            { id: "m03", family: "l1span", line: "", label: "L1-M03",
              jobs: [{ key: "r", batch: "B-214", start: week(28n), end: week(31n), state: variant("in-progress", null) }],
              cells: [] },
            { id: "m03h", family: "l1heat", line: "", label: "L1-M03 load", jobs: [], cells },
            // Static collapsed Line 2 — rests as its DECLARED mean strip.
            { id: "l2", family: "l2", line: "", label: "L2 load", jobs: [], cells },
            // The DISCOVERED form — one strip per distinct line value. Named
            // apart from the static strips above so the panel reads as three
            // distinct forms rather than two repeated ones.
            { id: "d-m21", family: "byline", line: "Line 3", label: "L3-M21", jobs: [], cells },
            { id: "d-m22", family: "byline", line: "Line 3", label: "L3-M22", jobs: [], cells },
            { id: "d-m31", family: "byline", line: "Line 4", label: "L4-M31", jobs: [], cells },
        ], ArrayType(LineRow));
        const series = $.const([
            Plan.series.group(LineRow, { key: "line1", label: "Line 1", meta: "2 rs · 82%" }, [
                Plan.series.span(LineRow, {
                    match: r => r.family.equal("l1span"),
                    key: r => r.id, label: r => r.label, id: true,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end,
                        label: East.str`RUN · ${j.batch}`, state: j.state,
                    })),
                }),
                Plan.series.heat(LineRow, {
                    match: r => r.family.equal("l1heat"),
                    key: r => r.id, label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
            ]),
            Plan.series.group(LineRow, { key: "line2", label: "Line 2", value: "98%", status: "warning", collapsed: true, summaryAggregate: "mean" }, [
                Plan.series.heat(LineRow, {
                    match: r => r.family.equal("l2"),
                    key: r => r.id, label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 95 }),
                }),
            ]),
            // DISCOVERED strips — one collapsed group per distinct `by`
            // value, wearing the member-count meta.
            Plan.series.group(LineRow, { by: r => r.line, match: r => r.family.equal("byline"), collapsed: true, summaryAggregate: "mean" }, [
                Plan.series.heat(LineRow, {
                    match: r => r.family.equal("byline"),
                    key: r => r.id, label: r => r.label, id: true,
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
    keywords: ["Plan", "data", "series", "match", "families", "variant", "span", "cards", "group", "rows", "groupBy", "rollup", "Series", "data-driven", "accessor", "raw", "one source"],
    description: "The data + series canvas, minimally — ONE variant-discriminated RAW source (jobs with batch/tonnes/state, shifts with hours); each Plan.series.* builder (row type first) declares a row family over it via match + accessors that DERIVE the canvas vocabulary client-side (run labels + quantity pairs from batch/tonnes, chip labels with the proposal + prefix from hours × lifecycle; span with groupBy rollup parents, cards under a static series.group strip), series.rows carries literal one-off chrome, and the whole list is a $.const-bound East value typed ArrayType(Plan.Types.Series(OpsRow))",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // The RAW domain shape — families discriminated by a variant field
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
            id: StringType, line: StringType,
            kind: VariantType({
                machine: StructType({ jobs: ArrayType(JobRow) }),
                crew:    StructType({ shifts: ArrayType(ShiftRow) }),
            }),
        });
        const ops = $.const([
            { id: "L1-M03", line: "Line 1", kind: variant("machine", { jobs: [
                { batch: "B-214", start: week(28n), end: week(31n), tonnes: 96.0, state: variant("in-progress", null) },
                { batch: "B-221", start: week(32n), end: week(35n), tonnes: 88.0, state: variant("proposed", variant("recommended", null)) },
            ] }) },
            { id: "L1-M04", line: "Line 1", kind: variant("machine", { jobs: [
                { batch: "B-208", start: week(27n), end: week(30n), tonnes: 112.0, state: variant("actual", null) },
            ] }) },
            { id: "L2-M11", line: "Line 2", kind: variant("machine", { jobs: [
                { batch: "B-241", start: week(29n), end: week(33n), tonnes: 92.0, state: variant("confirmed", null) },
            ] }) },
            { id: "crewA", line: "Line 1", kind: variant("crew", { shifts: [
                { key: "s1", from: week(27n), to: week(29n), hours: 80.0, state: variant("confirmed", null) },
                { key: "s2", from: week(31n), to: week(33n), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
            ] }) },
        ], ArrayType(OpsRow));
        // The series — real East values bound in the body, typed by the
        // constructor; canvas order = series order. The accessors are where
        // raw fields become canvas vocabulary: labels, quantity displays and
        // chip text all derive CLIENT-SIDE inside each family's stored make.
        const series = $.const([
            Plan.series.rows(OpsRow, [Plan.events({ key: "ms", label: "MILESTONES", id: true, marks: [
                Plan.mark({ key: "kick", at: week(28n), kind: "milestone", label: "KICKOFF" }),
                Plan.mark({ key: "rel", at: week(33n), kind: "milestone", label: "REL 2.4" }),
            ] })]),
            Plan.series.span(OpsRow, {
                match: r => r.kind.hasTag("machine"),
                key: r => r.id, label: r => r.id, id: true,
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
                    match: r => r.kind.hasTag("crew"),
                    key: r => r.id, label: r => r.id,
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
// planLibraryDnd — row-library composition (the DnD behavioral isolate)
// ============================================================================

export const planLibraryDnd = example({
    keywords: [
        "Plan", "data", "series", "library", "template", "make", "binding", "DnD", "drag", "drop",
        "onDrag", "canDrop", "sources", "add", "reorder", "compose",
    ],
    description: "Row-library composition — templates carrying their binding via make() (the kind factories are the SUBTREE vocabulary for template bodies), the base canvas defined as raw data + a span series, and the Plan declared as a DnD target with the shared onDrag funnel and a canDrop veto",
    fn: East.function([], UIComponentType, ($) => {
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
        });
        // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        // The base canvas — raw data + a span series, like every Plan.
        const JobRow = StructType({
            batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
        });
        const MachineRow = StructType({ id: StringType, jobs: ArrayType(JobRow) });
        const machines = $.const([
            { id: "L1-M03", jobs: [
                { batch: "B-214", start: week(28n), end: week(31n), state: variant("in-progress", null) },
            ] },
        ], ArrayType(MachineRow));
        const series = $.const([
            Plan.series.span(MachineRow, {
                key: r => r.id, label: r => r.id, id: true,
                runs: r => r.jobs.map((_$, j) => Plan.run({
                    key: j.batch, start: j.start, end: j.end,
                    label: East.str`RUN · ${j.batch}`, state: j.state,
                })),
            }),
        ], ArrayType(Plan.Types.Series(MachineRow)));
        const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
        const loadPcts = $.const([46.0, 58.0, 66.0, 78.0, 90.0, 98.0], ArrayType(FloatType));
        const load = $.let(East.Array.generate(6n, MeasureRow, (_$, i) =>
            ({ week: week(i.multiply(2n).add(27n)), pct: loadPcts.get(i) })));
        const shifts = $.const([
            { key: "s1", from: week(27n), to: week(29n), label: "80h", state: variant("confirmed", null) },
            { key: "s2", from: week(31n), to: week(33n), label: "+64h", state: variant("proposed", variant("recommended", null)) },
        ], ArrayType(ShiftRow));
        // Templates carry their BINDING: `make` builds the live subtree from
        // the captured data — the kind factories' remaining public role — so
        // a dropped row renders immediately.
        const makeUtil = $.const(East.function([], ArrayType(Plan.Types.Row), (_$) =>
            Plan.chart({
                key: "util", label: "UTIL %", id: true, height: "spark",
                layers: [Chart.Column(load, { x: r => r.week, y: r => r.pct })],
            })));
        const makeCrew = $.const(East.function([], ArrayType(Plan.Types.Row), (_$) =>
            Plan.cards({
                key: "crew", label: "Crew A", sub: "152h", stacked: true,
                chips: shifts.map((_$, s) => Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
            })));
        const onDrag = $.const(East.function([DragEventType], NullType, (_$, _e) => null));
        const canDrop = $.const(East.function([DragEventType], BooleanType, (_$, _e) => true));
        return (
            <Plan
                axis={axis}
                data={machines}
                series={series}
                library={[
                    Plan.template({ key: "util", label: "Chart", sublabel: "utilisation %", kind: "chart", make: makeUtil }),
                    Plan.template({ key: "crew", label: "Cards", sublabel: "crew assignments", kind: "cards", icon: "user-group", make: makeCrew }),
                ]}
                id="plan" sources={["row-library"]}
                onDrag={onDrag}
                canDrop={canDrop}
            />
        );
    }),
    inputs: [],
});
