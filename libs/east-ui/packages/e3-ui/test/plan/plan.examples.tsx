/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

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
    RecursiveType,
    StringType,
    StructType,
    VariantType,
    example,
    none,
    some,
    variant,
} from "@elaraai/east";
import { ApprovalStateType, DragEventType, Editing, EventStateType, State, StatusValueType, Style, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Chart, Configurator, Dock, Format, HStack, Library, Progress, Reactive, SegmentGroup, Select, Slice, Sparkline, Stack, Text, VStack, deriveApproval } from "@elaraai/east-ui";
import { Data, Plan, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// The corpus — every canvas is DEFINED the one way (`Plan Data Interface.md`
// §3.5): `data` (RAW domain rows — batches, tonnes, lifecycle states; row
// series discriminated by a field; no factory-built values in the data) +
// `series` (one `Plan.series.*` value per row series, `$.const`-bound and typed
// by the `Plan.Types.Series(Row)` constructor — its accessors DERIVE the
// canvas vocabulary from the raw fields client-side: labels, quantity
// displays, element values via the `Plan.run`/`chip`/`event` expression
// builders) + the root RESOLVER functions (`popover` / `hover` /
// `expandRender`). The series list IS the layout — one block per series, top
// to bottom — and hierarchy comes only from the data's own nesting (#822): a
// series' `children` walk what an entry holds, and a flat source is grouped in
// a data step first (`groupToDicts`). A row's id is its series and the path of
// entry keys to it (`Plan.ref`). The kind factories are subtree vocabulary only
// — the one-off chrome a `Plan.series.rows` entry places (`planLiteralRows`).
//
// Every canvas binds its data from e3, so each runs on e3-web in the showcase
// (#1178): the source is an `e3.input` or an `e3.record` declared beside the
// example, its small literal default the dataset's initial value, bound in the
// body with `Data.bind`; a record an editing session commits to is paged with
// `Data.bindPaged` and written through its patch door (`Record.onApply`). A
// fixture made by a rule rather than written out — a slice's horizon, a
// stress source — is made where data is made, by an `e3.task` over a count.
// `State` holds only what the viewer owns: a configurator's axes, a pick, a
// gesture log, the interaction state. Instants are stored as instants, and a
// measure as its readings from its first week, which the series turn into
// points and cells; lifecycle states are plain `EventStateType` variants (the
// shared contracts vocabulary a plan dataset stores). Everything else an
// example needs — its series, axis, resolvers, presets and policy tables — is
// an East value bound once in its body. The declarations an example reaches
// travel with it into its docs and the plugin index.

// ============================================================================
// planTargetState — the §1 flagship (every row kind, ONE source, series)
// ============================================================================

/** A despatch order on the §1 horizon — the rows the slice narrows: when, which
 *  line, whether it is at risk of running late, and the tonnage booked so far
 *  (0 = nothing yet). */
export const TargetHorizonRow = StructType({ key: StringType, at: DateTimeType, line: StringType, risk: StringType, tonnes: FloatType });

/** How many despatch orders the horizon holds — a small authored constant;
 *  {@link planTargetHorizon} makes the rows. */
export const planTargetHorizonCount = e3.input("plan_target_horizon_count", IntegerType, variant("value", 36n));

/**
 * The horizon's despatch orders, generated from their count and spread over
 * the 27 weeks from W21: every third at risk of running late (the §1 `Late
 * risk` cohort counts 12 of 36), every seventh with no tonnage booked yet (the
 * `Empty` cohort).
 */
export const generateTargetHorizon = East.function([IntegerType], ArrayType(TargetHorizonRow), ($, count) => {
    // Monday of ISO week 1, 2026.
    const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
    return East.Array.generate(count, TargetHorizonRow, (_$, i) => ({
        key: East.str`h${East.print(i.add(1n))}`,
        at: w1.addWeeks(i.multiply(27n).divide(count).add(20n)),
        line: i.remainder(2n).equal(0n).ifElse(() => "Line 1", () => "Line 2"),
        risk: i.remainder(3n).equal(0n).ifElse(() => "late", () => "on-time"),
        tonnes: i.remainder(7n).equal(6n).ifElse(
            () => 0.0,
            () => i.multiply(11n).remainder(40n).toFloat().add(20.0)),
    }));
});

/** The task that generates the horizon — its output is the rows the slice narrows. */
export const planTargetHorizon = e3.task("plan_target_horizon", [planTargetHorizonCount], generateTargetHorizon);

/** A machine's job — the RAW record an ops dataset stores: its phase and
 *  optional batch, its window, optional tonnage, lifecycle state and alert. */
export const TargetJob = StructType({
    key: StringType, phase: StringType, batch: OptionType(StringType),
    start: DateTimeType, end: DateTimeType,
    tonnes: OptionType(FloatType), state: EventStateType,
    alert: OptionType(StatusValueType),
});

/** A crew's shift — its window, its hours and its lifecycle state. */
export const TargetShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType,
    hours: FloatType, state: EventStateType,
});

/** A dock allocation — its week and its lifecycle state. */
export const TargetAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });

/**
 * The ops row — every series' rows in ONE keyed source, discriminated by the
 * kind variant (the natural ops-dataset shape). The arms carry RAW fields: a
 * measure is its weekly readings from its first week (`from`), and presence
 * (status / expand declaration) is per-row Option DATA the accessors pass
 * through.
 */
export const TargetOpsRow = StructType({
    kind: VariantType({
        kpi: StructType({ name: StringType, headline: StringType, pinned: BooleanType,
                          from: DateTimeType, weekly: ArrayType(FloatType) }),
        machine: StructType({ cap: FloatType,
                              status: OptionType(StatusValueType),
                              detail: OptionType(Plan.Types.Expand),
                              jobs: ArrayType(TargetJob),
                              decisions: ArrayType(Plan.Types.DecisionMark),
                              ports: ArrayType(Plan.Types.Port) }),
        load: StructType({ name: StringType, sub: StringType, from: DateTimeType, weekly: ArrayType(FloatType) }),
        dock: StructType({ name: StringType, allocations: ArrayType(TargetAlloc),
                           markers: ArrayType(Plan.Types.CellMarker) }),
        crew: StructType({ name: StringType, hours: StringType, shifts: ArrayType(TargetShift) }),
        stream: StructType({ name: StringType, marks: ArrayType(Plan.Types.EventMark) }),
    }),
});

/**
 * The ONE ops source — every series' rows in one KEYED collection, RAW: no
 * display strings the accessors can derive, no built elements; the instants an
 * element record stores ride the axis's `time` arm. A key is its entry's
 * identity, never its place: a row's id is the series that made it and this
 * key (`Plan.ref("machines", "L1-M03")`), which is what `links`, `popover` and
 * `onSelect` speak — the §1 layout is the series list. Weeks W27–W38.
 */
export const planTargetOps = e3.input("plan_target_ops", DictType(StringType, TargetOpsRow), variant("value", new Map([
    ["coverage", { kind: variant("kpi", { name: "Coverage", headline: "94.2%", pinned: true,
      from: new Date("2026-06-29T00:00:00Z"), weekly: [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2] }) }],
    ["L1-M03", { kind: variant("machine", { cap: 120.0, status: some(variant("success", null)), detail: none,
      jobs: [
          { key: "set",  phase: "SET", batch: none, start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-06T00:00:00Z"), tonnes: none, state: variant("actual", null), alert: none },
          { key: "b214", phase: "RUN", batch: some("B-214"), start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), tonnes: some(96.0), state: variant("in-progress", null), alert: none },
          { key: "cln",  phase: "CLN", batch: none, start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), tonnes: none, state: variant("confirmed", null), alert: none },
          { key: "b221", phase: "RUN", batch: some("B-221"), start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), tonnes: some(88.0), state: variant("proposed", variant("recommended", null)), alert: none },
      ],
      decisions: [{ key: "d1", at: variant("time", new Date("2026-08-03T00:00:00Z")), applied: false }],
      ports:     [{ at: variant("time", new Date("2026-07-27T00:00:00Z")), label: some("−24 t") }] }) }],
    ["L1-M04", { kind: variant("machine", { cap: 120.0, status: none,
      // The expand declaration — a stored plain-data record (§3.2); presence
      // is a per-row fact and the ROOT's expandRender mounts the body.
      detail: some({ height: some("152px"), axis: variant("keep", null) }),
      jobs: [
          { key: "b208", phase: "RUN", batch: some("B-208"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), tonnes: some(112.0), state: variant("actual", null), alert: none },
          { key: "hld",  phase: "HLD", batch: none, start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), tonnes: none, state: variant("confirmed", null), alert: none },
          { key: "qc",   phase: "QC", batch: none, start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), tonnes: none, state: variant("confirmed", null), alert: none },
          { key: "b231", phase: "RUN", batch: some("B-231"), start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-10-05T00:00:00Z"), tonnes: some(104.0), state: variant("proposed", variant("recommended", null)), alert: none },
      ],
      decisions: [], ports: [] }) }],
    ["L1-M07", { kind: variant("machine", { cap: 80.0, status: some(variant("warning", null)), detail: none,
      jobs: [
          { key: "b197", phase: "HLD", batch: some("B-197"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), tonnes: none, state: variant("actual", null), alert: some(variant("warning", null)) },
          { key: "cln", phase: "CLN", batch: none, start: new Date("2026-08-17T00:00:00Z"), end: new Date("2026-08-31T00:00:00Z"), tonnes: none, state: variant("proposed", variant("recommended", null)), alert: none },
      ],
      decisions: [], ports: [] }) }],
    ["l2-load", { kind: variant("load", { name: "L2 load", sub: "%/wk",
      from: new Date("2026-06-29T00:00:00Z"), weekly: [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0] }) }],
    ["dock2", { kind: variant("dock", { name: "Dock 2",
      allocations: [
          { key: "a1", at: new Date("2026-06-29T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a2", at: new Date("2026-07-06T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a3", at: new Date("2026-07-13T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a4", at: new Date("2026-07-20T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a5", at: new Date("2026-07-27T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a6", at: new Date("2026-08-10T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a7", at: new Date("2026-08-24T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a8", at: new Date("2026-08-24T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ],
      markers: [{ at: variant("time", new Date("2026-08-24T00:00:00Z")), lane: none, status: variant("warning", null), message: "capacity breach — 2 allocations" }] }) }],
    ["crewA", { kind: variant("crew", { name: "Crew A", hours: "152h → 168h", shifts: [
        { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), hours: 80.0, state: variant("confirmed", null) },
        { key: "s2", from: new Date("2026-07-13T00:00:00Z"), to: new Date("2026-07-27T00:00:00Z"), hours: 72.0, state: variant("confirmed", null) },
        { key: "s3", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
        { key: "s4", from: new Date("2026-08-17T00:00:00Z"), to: new Date("2026-08-24T00:00:00Z"), hours: 48.0, state: variant("estimated", null) },
        { key: "s5", from: new Date("2026-08-31T00:00:00Z"), to: new Date("2026-09-14T00:00:00Z"), hours: 56.0, state: variant("proposed", variant("recommended", null)) },
    ] }) }],
    ["milestones", { kind: variant("stream", { name: "Milestones", marks: [
        { key: "kick", at: variant("time", new Date("2026-07-06T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
        { key: "d1", at: variant("time", new Date("2026-07-27T00:00:00Z")), kind: variant("decision", { applied: true }), icon: none, label: none },
        { key: "rel", at: variant("time", new Date("2026-08-10T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("REL 2.4") },
        { key: "audit", at: variant("time", new Date("2026-08-24T00:00:00Z")), kind: variant("exception", null), icon: none, label: some("AUDIT") },
        { key: "d2", at: variant("time", new Date("2026-09-07T00:00:00Z")), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
    ] }) }],
])));

export const planTargetState = example({
    keywords: [
        "Plan", "canvas", "data", "series", "match", "axis", "window", "resolution", "now",
        "span", "run", "group", "section", "heat", "buckets", "cards", "chip", "events", "mark", "chart",
        "layers", "rollup", "bands", "review", "footer", "milestone",
        "decision", "exception", "pinned", "port", "hovercard", "popover",
        "slice", "brush", "horizon", "toolbar", "affordances", "expand",
        "expandRender", "resolver", "data-driven", "accessor", "raw", "target state",
        "layout", "row id", "Plan.ref", "links", "quantity", "Plan.quantity", "onElementClick",
        "Data.bind", "bound", "e3.input", "e3.task", "generated", "dataset",
    ],
    description: "Every row kind on one axis from a single raw ops source bound from e3, with slice chrome over a horizon an e3 task generates, expand, review and a status footer",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(TargetHorizonRow, {
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
            // The ONE ops source, bound from e3 — every series reads it.
            const ops = $.let(Data.bind(planTargetOps));
            // The horizon the slice narrows — the despatch orders a task
            // generates (the canvas rows are the ops source; the slice is
            // chrome over THESE).
            const horizon = $.let(Data.bind(planTargetHorizon));
            // Monday of ISO week n, 2026 (W1 Monday = 2025-12-29). The §1
            // window is W27–W38 (half-open at W39); now = W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            // A measure's weekly readings, from its first week, as a chart's
            // points and as heat cells printing their values.
            const weeklyPoints = $.const(East.function([DateTimeType, ArrayType(FloatType)], ArrayType(MeasureRow), ($, from, weekly) =>
                East.Array.generate(weekly.size(), MeasureRow, (_$, i) => ({ week: from.addWeeks(i), pct: weekly.get(i) }))));
            const weeklyCells = $.const(East.function([DateTimeType, ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), ($, from, weekly) =>
                East.Array.generate(weekly.size(), Plan.Types.HeatCell, (_$, i) => ({
                    at: Plan.at.time(from.addWeeks(i)), value: some(weekly.get(i)),
                    label: some(East.Float.printFixed(weekly.get(i), 0n)),
                }))));
            // Raw jobs → runs: ONE bound mapping function — the bar label and
            // the quantity derive CLIENT-SIDE from the raw phase/batch/tonnes
            // fields (the series-make application). A quantity is ONE value —
            // the number, its unit and how it prints (#824) — so the bar's
            // caption and a rollup's sum can never disagree. The run is written
            // as a RECORD, so its instants are spelled with `Plan.at.time` —
            // the `Plan.run` builder would wrap a DateTime field by itself.
            const tonnesFormat = $.const(Format.Number({ maximumFractionDigits: 0n }));
            const jobRuns = $.const(East.function([ArrayType(TargetJob)], ArrayType(Plan.Types.Run), (_$, jobs) =>
                jobs.map(($, j) => {
                    const noQuantity = $.const(none, OptionType(Plan.Types.Quantity));
                    const quantity = $.let(j.tonnes.match({
                        some: (_$, t) => East.value(some(Plan.quantity(t, { unit: "t", format: tonnesFormat })), OptionType(Plan.Types.Quantity)),
                        none: (_$) => noQuantity,
                    }), OptionType(Plan.Types.Quantity));
                    const label = $.let(j.batch.match({
                        some: (_$, b) => East.str`${j.phase} · ${b}`,
                        none: (_$) => j.phase,
                    }), StringType);
                    const run = $.let({
                        key: j.key, start: Plan.at.time(j.start), end: Plan.at.time(j.end), label,
                        quantity, state: j.state, status: j.alert,
                        moved: none, icon: none,
                    }, Plan.Types.Run);
                    return run;
                })));
            // Raw shifts → chips: hours print as the chip label, an ADDED
            // proposal wearing the `+` prefix — display derives from the
            // lifecycle, down to the proposal's flavour (a `removed` shift is
            // a proposal too, and `+` would read as its opposite).
            const shiftChips = $.const(East.function([ArrayType(TargetShift)], ArrayType(Plan.Types.Chip), (_$, shifts) =>
                shifts.map(($, s) => {
                    const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
                    const label = $.let(s.state.match({
                        proposed: (_$, p) => p.hasTag("removed").ifElse(
                            () => East.str`${hrs}h`,
                            () => East.str`+${hrs}h`),
                    }, _$ => East.str`${hrs}h`), StringType);
                    return Plan.chip({ key: s.key, from: s.from, to: s.to, label, state: s.state });
                })));
            // The series — the list IS the layout (#822): one block per
            // series, top to bottom in this order, a section titling the
            // blocks beneath it. The whole list is an East value typed by the
            // constructor.
            const series = $.const([
                Plan.series.chart(TargetOpsRow, {
                    key: "coverage", title: "Coverage",
                    match: r => r.kind.hasTag("kpi"),
                    label: r => r.kind.unwrap("kpi").name, id: true,
                    pinned: r => r.kind.unwrap("kpi").pinned,
                    value: r => some(r.kind.unwrap("kpi").headline),
                    status: _r => some(variant("warning", null)),
                    height: "spark", expandable: true,
                    layers: r => [
                        Plan.layer(Chart.Line(weeklyPoints(r.kind.unwrap("kpi").from, r.kind.unwrap("kpi").weekly), { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                        Chart.refLine({ y: 100, label: "TARGET 100" }),
                    ],
                }),
                Plan.series.section(TargetOpsRow, { key: "line1", title: "Line 1", meta: "3 rows · 82%" }, [
                    Plan.series.span(TargetOpsRow, {
                        key: "machines", title: "Machines",
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
                Plan.series.section(TargetOpsRow, { key: "line2", title: "Line 2", value: "98%", status: "warning", collapsed: true, summaryAggregate: "mean" }, [
                    Plan.series.heat(TargetOpsRow, {
                        key: "load", title: "Load",
                        match: r => r.kind.hasTag("load"),
                        label: r => r.kind.unwrap("load").name,
                        sub: r => some(r.kind.unwrap("load").sub),
                        cells: r => Plan.heatCells(weeklyCells(r.kind.unwrap("load").from, r.kind.unwrap("load").weekly), { min: 0, max: 100, warnAt: 95 }),
                    }),
                ]),
                Plan.series.section(TargetOpsRow, { key: "docks-in", title: "Docks · In", meta: "1 row" }, [
                    Plan.series.buckets(TargetOpsRow, {
                        key: "docks", title: "Docks",
                        match: r => r.kind.hasTag("dock"),
                        label: r => r.kind.unwrap("dock").name,
                        sub: _r => some("load/wk"),
                        events: r => r.kind.unwrap("dock").allocations.map((_$, a) =>
                            Plan.event({ key: a.key, at: a.at, state: a.state })),
                        markers: r => r.kind.unwrap("dock").markers,
                    }),
                ]),
                Plan.series.cards(TargetOpsRow, {
                    key: "crews", title: "Crews",
                    match: r => r.kind.hasTag("crew"),
                    label: r => r.kind.unwrap("crew").name, stacked: true,
                    sub: r => some(r.kind.unwrap("crew").hours),
                    chips: r => shiftChips(r.kind.unwrap("crew").shifts),
                }),
                Plan.series.events(TargetOpsRow, {
                    key: "milestones", title: "Milestones",
                    match: r => r.kind.hasTag("stream"),
                    label: r => r.kind.unwrap("stream").name, id: true,
                    value: r => some(East.print(r.kind.unwrap("stream").marks.length())),
                    marks: r => r.kind.unwrap("stream").marks,
                }),
            ], ArrayType(Plan.Types.Series(TargetOpsRow)));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) },
                resolution: "week", resolutions: ["month", "week", "day"], now: week(31n),
            }));
            // The §1 toolbar is SEEDED slice state: the applied window is the
            // range chip (`JUN 29 – SEP 20 · 84d`), and two saved cohorts sit
            // beside the filter builder with `Late risk` active — their
            // counts are live over the horizon, never printed. A slice range
            // is CLOSED — both ends inclusive — so the twelve weeks W27–W38
            // end the millisecond before W39.
            const slice = $.let(Slice.bind([TargetHorizonRow], "ex.plan.target", cfg, Slice.state({
                range: some(variant("datetime", { from: week(27n), to: week(39n).addMilliseconds(-1n) })),
                cohorts: [
                    { id: "late", name: "Late risk", filters: [variant("string", { fieldId: "risk", op: variant("eq", "late") })] },
                    { id: "empty", name: "Empty", filters: [variant("float", { fieldId: "tonnes", op: variant("lte", 0.0) })] },
                ],
                activeCohorts: new Set(["late"]),
            }), horizon.read(), none));
            // The R2 developer render — the ROOT's resolver, called with the
            // focused row's id; ONE function serves every row whose `expand`
            // accessor returned some(...). The machine series declares it.
            const util = $.let(East.Array.generate(12n, MeasureRow, (_$, i) =>
                ({ week: week(i.add(27n)), pct: i.multiply(17n).remainder(45n).toFloat().add(52.0) })));
            const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, (_$, _id) => (
                <Chart layers={[Chart.Line(util, { x: r => r.week, y: r => r.pct })]} height={120} grid={false} />
            )));
            // The generalized element resolvers — ONE stored popover / hover
            // function each over Plan.Types.ElementRef (every arm carries the
            // row's id); rich bodies build lazily at interaction time, and a
            // none result opens no surface.
            const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
                const noBody = $.const(none, OptionType(UIComponentType));
                const m03 = $.const(Plan.ref("machines", "L1-M03"));
                return ref.match({
                    run: (_$, ev) => ev.run.equal("b221").ifElse(
                        () => some(<Text>Proposed by run 412 — fills the W32 idle window.</Text>),
                        () => noBody),
                    mark: (_$, ev) => East.equal(ev.row, m03).and(() => ev.mark.equal("d1")).ifElse(
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
            const onRow = $.const(East.function([Plan.Types.RowId], NullType, (_$, _id) => null));
            // ONE element callback (#824) — a run, tile, mark, chip, cell or
            // link ribbon, by the same ref the popover resolver receives.
            const onElementClick = $.const(East.function([Plan.Types.ElementRef], NullType, (_$, _ref) => null));
            const onGroupToggle = $.const(East.function([Plan.Types.GroupToggleEvent], NullType, (_$, _e) => null));
            const onBatch = $.const(East.function([], NullType, (_$) => null));
            return (
                <Plan.View
                    slice={{ slice, affordances: ["cohort", "filter", "search", "range", "resolution", "brush", "summary"] }}
                    axis={axis}
                    // The link graph (R1) — the W31 −24 t transfer, its ends
                    // named by row id: hover a linked machine for the
                    // links-focus control. Its quantity weighs the ribbon, and
                    // `text` says it the author's way.
                    links={[
                        Plan.link({
                            key: "t-w31",
                            from: Plan.ref("machines", "L1-M03"), fromRun: "b214",
                            to: Plan.ref("machines", "L1-M04"), toRun: "qc",
                            quantity: Plan.quantity(24, { unit: "t", text: "−24 t" }),
                        }),
                    ]}
                    data={ops}
                    series={series}
                    // The review chrome — its foot and Rerun. A verdict is a
                    // draft of an editing session (`planReview`, `planEditing`).
                    review={{
                        summary: <Text>4 JOBS · 2 FLAGGED NEED A CALL · +6H FLOAT</Text>,
                        onRerun: onBatch,
                    }}
                    expandRender={expandRender}
                    popover={popover}
                    hover={hover}
                    onSelect={onRow}
                    onElementClick={onElementClick}
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

/** A machine job, its label already composed. */
export const VariantsJob = StructType({
    key: StringType, label: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** One fortnightly reading of a measure. */
export const VariantsMeasure = StructType({ week: DateTimeType, pct: FloatType });
/** A dock allocation. */
export const VariantsAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
/** A crew shift, its label already composed. */
export const VariantsShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
});
/** One table reading — a bucket's instant and its value, if it has one. */
export const VariantsReading = StructType({ at: DateTimeType, value: OptionType(FloatType) });
/**
 * ONE flat source (the `planExpand` shape): `series` names the series that
 * claims the row, and every channel a row's kind does not read stays empty.
 */
export const VariantsOpsRow = StructType({
    series: StringType, label: StringType,
    sub: OptionType(StringType),
    jobs: ArrayType(VariantsJob),
    points: ArrayType(VariantsMeasure),
    cells: ArrayType(Plan.Types.HeatCell),
    allocs: ArrayType(VariantsAlloc),
    act: ArrayType(VariantsReading),
    plan: ArrayType(VariantsReading),
    shifts: ArrayType(VariantsShift),
    marks: ArrayType(Plan.Types.EventMark),
});

/**
 * Every row kind on purpose: the density sweep re-rhythms them all at once —
 * compact tightens the shared row and the bars in it, while a two-line gutter
 * keeps its floor and a stacked table a line per position — and the gutter
 * sweep re-widths every label. The readings are fortnightly from W27.
 */
export const planVariantsOps = e3.input("plan_variants_ops", DictType(StringType, VariantsOpsRow), variant("value", new Map([
    ["util", { series: "util", label: "Util %", sub: none, jobs: [],
      points: [
          { week: new Date("2026-06-29T00:00:00Z"), pct: 46.0 }, { week: new Date("2026-07-13T00:00:00Z"), pct: 58.0 },
          { week: new Date("2026-07-27T00:00:00Z"), pct: 66.0 }, { week: new Date("2026-08-10T00:00:00Z"), pct: 72.0 },
          { week: new Date("2026-08-24T00:00:00Z"), pct: 84.0 }, { week: new Date("2026-09-07T00:00:00Z"), pct: 96.0 },
      ],
      cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["m03", { series: "mach", label: "L1-M03", sub: some("cap 120 t"),
      jobs: [
          { key: "b214", label: "RUN · B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) },
          { key: "b221", label: "RUN · B-221", start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ],
      points: [], cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["m04", { series: "mach", label: "L1-M04", sub: none,
      jobs: [
          { key: "b208", label: "RUN · B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) },
      ],
      points: [], cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["load", { series: "load", label: "L2 load", sub: some("%/wk"), jobs: [], points: [],
      cells: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), value: some(46.0), label: some("46") },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), value: some(58.0), label: some("58") },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(66.0), label: some("66") },
          { at: variant("time", new Date("2026-08-10T00:00:00Z")), value: some(72.0), label: some("72") },
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), value: some(84.0), label: some("84") },
          { at: variant("time", new Date("2026-09-07T00:00:00Z")), value: some(96.0), label: some("96") },
      ],
      allocs: [], act: [], plan: [], shifts: [], marks: [] }],
    ["dock2", { series: "dock", label: "Dock 2", sub: none, jobs: [], points: [], cells: [],
      allocs: [
          { key: "a1", at: new Date("2026-07-06T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a2", at: new Date("2026-07-27T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a3", at: new Date("2026-08-10T00:00:00Z"), state: variant("confirmed", null) },
      ],
      act: [], plan: [], shifts: [], marks: [] }],
    // Despatched tonnes and their signed Δ against plan — the table row's
    // two positions.
    ["desp", { series: "desp", label: "Despatch t", sub: none, jobs: [], points: [], cells: [], allocs: [],
      act: [
          { at: new Date("2026-06-29T00:00:00Z"), value: some(69.0) }, { at: new Date("2026-07-13T00:00:00Z"), value: some(87.0) },
          { at: new Date("2026-07-27T00:00:00Z"), value: some(99.0) }, { at: new Date("2026-08-10T00:00:00Z"), value: some(108.0) },
          { at: new Date("2026-08-24T00:00:00Z"), value: some(126.0) }, { at: new Date("2026-09-07T00:00:00Z"), value: some(144.0) },
      ],
      plan: [
          { at: new Date("2026-06-29T00:00:00Z"), value: some(-24.0) }, { at: new Date("2026-07-13T00:00:00Z"), value: some(-12.0) },
          { at: new Date("2026-07-27T00:00:00Z"), value: some(-4.0) }, { at: new Date("2026-08-10T00:00:00Z"), value: some(2.0) },
          { at: new Date("2026-08-24T00:00:00Z"), value: some(14.0) }, { at: new Date("2026-09-07T00:00:00Z"), value: some(26.0) },
      ],
      shifts: [], marks: [] }],
    ["crewA", { series: "crew", label: "Crew A", sub: none, jobs: [], points: [], cells: [], allocs: [], act: [], plan: [],
      shifts: [
          { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), label: "80h", state: variant("confirmed", null) },
          { key: "s2", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), label: "+64h", state: variant("proposed", variant("recommended", null)) },
      ],
      marks: [] }],
    ["ms", { series: "ms", label: "Milestones", sub: none, jobs: [], points: [], cells: [], allocs: [], act: [], plan: [], shifts: [],
      marks: [
          { key: "k", at: variant("time", new Date("2026-07-13T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
          { key: "a", at: variant("time", new Date("2026-08-17T00:00:00Z")), kind: variant("exception", null), icon: none, label: some("AUDIT") },
      ] }],
    ["m11", { series: "gmach", label: "L3-M11", sub: none,
      jobs: [
          { key: "b301", label: "RUN · B-301", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), state: variant("confirmed", null) },
      ],
      points: [], cells: [], allocs: [], act: [], plan: [], shifts: [], marks: [] }],
])));

/**
 * THE Plan configurator — the slot-2 variant-space surface the retired Gantt /
 * Planner configurators held (#571). ONE live canvas; every axis feeds it as
 * an expression. The window presets are whole `Plan.axis` VALUES riding a
 * typed preset struct: the ops week window, the year roadmap at month
 * resolution, and the 14-day sprint at day resolution with `ddd DD` labels
 * (the #309 pinned-day-columns contract the Planner's `day` preset and the
 * AlignedStack date-axis panel guarded). The style sweeps ride `style` —
 * density rhythm and gutter width — over a canvas holding every row kind, so
 * one click re-rhythms them all; every callback (select / element click /
 * group toggle / grain change) logs to the aside, the retired configurators'
 * pattern. The canvas reads a source bound from e3; the configurator's axes
 * are the viewer's own state. Fill sizing stays `planFill`'s; the per-kind
 * visual grammars stay the static per-kind panels.
 */
export const planVariants = example({
    keywords: [
        "Plan", "configurator", "Configurator", "variants", "preset", "axis", "window",
        "resolution", "month", "week", "day", "roadmap", "sprint", "ops", "format",
        "ddd", "#309", "density", "condensed", "compact", "comfortable", "gutterWidth",
        "gutter", "style", "onSelect", "onElementClick", "ElementRef", "onGroupToggle", "onGrainChange",
        "callback", "aside", "Reactive", "State", "SegmentGroup", "Select", "getTag",
        "every row kind", "span", "chart", "expandable", "heat", "buckets", "table",
        "tableSeries", "vertical", "cards", "events", "group", "section", "row id", "print",
        "Data.bind", "bound", "e3.input",
    ],
    description: "Plan configurator — axis window presets (ops week / year roadmap / 14-day sprint) with density and gutter-width sweeps over every row kind on one live canvas bound from e3; every callback logs to the aside",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The source, bound from e3 — every row kind, one flat dataset.
            const ops = $.let(Data.bind(planVariantsOps));
            // Monday of ISO week n, 2026 — the ops window is W27–W38
            // (half-open at W39), now = W31; the roadmap preset walks the
            // whole ISO year and the sprint preset a 14-day slice of it.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                // The spark's gutter opens it to the expanded chart, at any density.
                Plan.series.chart(VariantsOpsRow, {
                    key: "util", title: "Utilisation",
                    match: r => r.series.equal("util"),
                    label: r => r.label, id: true, height: "spark", expandable: true,
                    layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                }),
                Plan.series.span(VariantsOpsRow, {
                    key: "mach", title: "Machine jobs",
                    match: r => r.series.equal("mach"),
                    label: r => r.label, id: true, sub: r => r.sub,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                    })),
                }),
                Plan.series.heat(VariantsOpsRow, {
                    key: "load", title: "Line load",
                    match: r => r.series.equal("load"),
                    label: r => r.label, sub: r => r.sub,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
                Plan.series.buckets(VariantsOpsRow, {
                    key: "dock", title: "Dock allocations",
                    match: r => r.series.equal("dock"),
                    label: r => r.label,
                    events: r => r.allocs.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                }),
                // The positions STACKED — the row grows a line per position.
                Plan.series.table(VariantsOpsRow, {
                    key: "desp", title: "Despatch",
                    match: r => r.series.equal("desp"),
                    label: r => r.label, split: "vertical",
                    series: r => [
                        Plan.tableSeries({ strong: true, cells: Plan.tableCells(r.act) }),
                        Plan.tableSeries({
                            tone: "muted",
                            format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                            cells: Plan.tableCells(r.plan),
                        }),
                    ],
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(VariantsOpsRow, {
                    key: "crew", title: "Crew shifts",
                    match: r => r.series.equal("crew"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) =>
                        Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
                }),
                Plan.series.events(VariantsOpsRow, {
                    key: "ms", title: "Milestones",
                    match: r => r.series.equal("ms"),
                    label: r => r.label, id: true,
                    marks: r => r.marks,
                }),
                // A section header, so the group-toggle callback has something to fire on.
                Plan.series.section(VariantsOpsRow, { key: "line3", title: "Line 3", meta: "1 row" }, [
                    Plan.series.span(VariantsOpsRow, {
                        key: "gmach", title: "Grouped jobs",
                        match: r => r.series.equal("gmach"),
                        label: r => r.label, id: true,
                        runs: r => r.jobs.map((_$, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                        })),
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(VariantsOpsRow)));
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

            // The interactive surface — every callback writes the aside line,
            // naming the row by its id (the series that made it and the path
            // of keys to it) in its `.east` text.
            const onSelect = $.const(East.function([Plan.Types.RowId], NullType, ($, id) => {
                $(lastEventBind.write(East.str`onSelect · ${East.print(id)}`));
            }));
            // ONE callback for every element (#824) — the ref's arm says which
            // kind was clicked, and each arm names its row and element.
            const onElementClick = $.const(East.function([Plan.Types.ElementRef], NullType, ($, ref) => {
                $(lastEventBind.write(East.str`onElementClick · ${ref.getTag()} · ${East.print(ref)}`));
            }));
            const onGroupToggle = $.const(East.function([Plan.Types.GroupToggleEvent], NullType, ($, ev) => {
                const state = $.let(ev.expanded.ifElse(() => "expanded", () => "collapsed"), StringType);
                $(lastEventBind.write(East.str`onGroupToggle · ${East.print(ev.row)} → ${state}`));
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
                        <Plan.View
                            axis={sel.axis}
                            data={ops}
                            series={series}
                            onSelect={onSelect}
                            onElementClick={onElementClick}
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
                        Configurator.Spec("Rows", East.print(ops.read().size())),
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

/** A machine's job — the RAW record: phase, optional batch, window, optional
 *  tonnage and lifecycle state. */
export const SpanJob = StructType({
    key: StringType, phase: StringType, batch: OptionType(StringType),
    start: DateTimeType, end: DateTimeType,
    tonnes: OptionType(FloatType), state: EventStateType,
});
/**
 * A machine — or a PROGRAM, a record too, holding its machines (`machines`):
 * the hierarchy is the data's own (#822), so a program's row nests them, and
 * the entry type is recursive, to whatever depth the data has. `series` picks
 * the series; everything else — the expand declaration included — is per-row
 * data.
 */
export const SpanMachine = RecursiveType((self) => StructType({
    series: StringType,
    sub: OptionType(StringType), value: OptionType(StringType),
    expand: OptionType(Plan.Types.Expand),
    jobs: ArrayType(SpanJob),
    decisions: ArrayType(Plan.Types.DecisionMark),
    ports: ArrayType(Plan.Types.Port),
    machines: DictType(StringType, self),
}));

/** The machines and programs, weeks W27–W38 (and one run beyond them). */
export const planSpanMachines = e3.input("plan_span_machines", DictType(StringType, SpanMachine), variant("value", new Map([
    // Proposal flavours: forecast ghost · proposed cut · declined.
    ["L1-M07", { series: "flavours", sub: none, value: some("80 t"), expand: none,
      jobs: [
          { key: "run", phase: "RUN", batch: some("B-197"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), tonnes: some(64.0), state: variant("in-progress", null) },
          { key: "gho", phase: "FORECAST", batch: none, start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), tonnes: none, state: variant("estimated", null) },
          { key: "rem", phase: "CUT", batch: none, start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), tonnes: none, state: variant("proposed", variant("removed", null)) },
          { key: "rej", phase: "DECLINED", batch: none, start: new Date("2026-08-31T00:00:00Z"), end: new Date("2026-09-14T00:00:00Z"), tonnes: none, state: variant("rejected", null) },
      ], decisions: [], ports: [], machines: new Map() }],
    // Tonnage + an applied decision + a port on a stacked two-line gutter;
    // the EXPAND DECLARATION is row data (R2) — the render is the root's
    // expandRender resolver.
    ["L1-M09", { series: "detail", sub: some("cap 120 t"), value: none,
      expand: some({ height: some("152px"), axis: variant("dim", null) }),
      jobs: [
          { key: "a", phase: "RUN", batch: some("B-208"), start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), tonnes: some(112.0), state: variant("actual", null) },
          { key: "b", phase: "RUN", batch: some("B-231"), start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), tonnes: some(104.0), state: variant("proposed", variant("recommended", null)) },
      ],
      decisions: [{ key: "d1", at: variant("time", new Date("2026-07-27T00:00:00Z")), applied: true }],
      ports: [{ at: variant("time", new Date("2026-07-27T00:00:00Z")), label: some("−24 t") }], machines: new Map() }],
    // A program and its machines — the program's row rolls their runs up
    // into union bands (renderer-derived).
    ["Program A", { series: "rollup", sub: none, value: none, expand: none, jobs: [], decisions: [], ports: [],
      machines: new Map([
          ["L1-M03", { series: "rollup", sub: none, value: none, expand: none,
            jobs: [
                { key: "b214", phase: "RUN", batch: some("B-214"), start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), tonnes: some(96.0), state: variant("actual", null) },
                { key: "b221", phase: "RUN", batch: some("B-221"), start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), tonnes: some(88.0), state: variant("proposed", variant("recommended", null)) },
            ], decisions: [], ports: [], machines: new Map() }],
          ["L2-M11", { series: "rollup", sub: none, value: none, expand: none,
            jobs: [{ key: "b241", phase: "RUN", batch: some("B-241"), start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), tonnes: some(92.0), state: variant("confirmed", null) }],
            decisions: [], ports: [], machines: new Map() }],
      ]) }],
    // Linked despatch whose run starts BEYOND the window — in links focus
    // its landing renders as the edge fade.
    ["dsp", { series: "despatch", sub: none, value: none, expand: none,
      jobs: [{ key: "d1", phase: "DSP", batch: none, start: new Date("2026-09-21T00:00:00Z"), end: new Date("2026-10-12T00:00:00Z"), tonnes: some(91.0), state: variant("proposed", variant("recommended", null)) }],
      decisions: [], ports: [], machines: new Map() }],
    // The program under the Line 2 section, rolled up byStatus.
    ["Program B", { series: "line2", sub: none, value: none, expand: none, jobs: [], decisions: [], ports: [],
      machines: new Map([
          ["L2-M12", { series: "line2", sub: none, value: none, expand: none,
            jobs: [
                { key: "r1", phase: "RUN", batch: some("B-198"), start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), tonnes: some(64.0), state: variant("actual", null) },
                { key: "r2", phase: "RUN", batch: some("B-202"), start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), tonnes: some(40.0), state: variant("proposed", variant("recommended", null)) },
            ], decisions: [], ports: [], machines: new Map() }],
      ]) }],
])));

export const planSpanRows = example({
    keywords: ["Plan", "data", "series", "span", "run", "state", "estimated", "removed", "rejected", "decision", "port", "rollup", "union", "byStatus", "children", "nested", "recursive", "RecursiveType", "bands", "section", "stacked", "gutter", "links", "link", "Plan.ref", "row id", "focus", "expand", "expandRender", "match", "raw", "quantity", "Plan.quantity", "unit", "sum per unit", "Data.bind", "bound", "e3.input"],
    description: "Span rows over one raw machine source bound from e3 — proposal flavours, decision diamonds and ports, programs rolling their machines up into bands, and a link graph",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const machines = $.let(Data.bind(planSpanMachines));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            // Raw jobs → runs, once — every span series shares the mapping. A
            // job's tonnage is its run's QUANTITY: the bar prints it, and a
            // program's bands sum its machines' tonnes unit by unit (#824).
            const tonnesFormat = $.const(Format.Number({ maximumFractionDigits: 0n }));
            const jobRuns = $.const(East.function([ArrayType(SpanJob)], ArrayType(Plan.Types.Run), (_$, jobs) =>
                jobs.map(($, j) => {
                    const noQuantity = $.const(none, OptionType(Plan.Types.Quantity));
                    const quantity = $.let(j.tonnes.match({
                        some: (_$, t) => East.value(some(Plan.quantity(t, { unit: "t", format: tonnesFormat })), OptionType(Plan.Types.Quantity)),
                        none: (_$) => noQuantity,
                    }), OptionType(Plan.Types.Quantity));
                    const label = $.let(j.batch.match({
                        some: (_$, b) => East.str`${j.phase} · ${b}`,
                        none: (_$) => j.phase,
                    }), StringType);
                    const run = $.let({
                        key: j.key, start: Plan.at.time(j.start), end: Plan.at.time(j.end), label,
                        quantity, state: j.state,
                        status: none, moved: none, icon: none,
                    }, Plan.Types.Run);
                    return run;
                })));
            const series = $.const([
                Plan.series.span(SpanMachine, {
                    key: "flavours", title: "Flavours",
                    match: r => r.series.equal("flavours"),
                    label: (_r, k) => k, id: true,
                    value: r => r.value,
                    runs: r => jobRuns(r.jobs),
                }),
                Plan.series.span(SpanMachine, {
                    key: "detail", title: "Detail",
                    match: r => r.series.equal("detail"),
                    label: (_r, k) => k, id: true, stacked: true,
                    sub: r => r.sub, expand: r => r.expand,
                    runs: r => jobRuns(r.jobs), decisions: r => r.decisions, ports: r => r.ports,
                }),
                // A program's machines nest under it (`children` — more of this
                // series, to any depth), and its row rolls their runs up.
                Plan.series.span(SpanMachine, {
                    key: "rollup", title: "Rollup",
                    match: r => r.series.equal("rollup"),
                    label: (_r, k) => k, id: true,
                    runs: r => jobRuns(r.jobs),
                    children: r => r.machines, rollup: "union",
                }),
                Plan.series.span(SpanMachine, {
                    key: "despatch", title: "Despatch",
                    match: r => r.series.equal("despatch"),
                    label: (_r, k) => k, id: true,
                    runs: r => jobRuns(r.jobs),
                }),
                Plan.series.section(SpanMachine, { key: "line2", title: "Line 2", meta: "1 row" }, [
                    Plan.series.span(SpanMachine, {
                        key: "programs", title: "Programs",
                        match: r => r.series.equal("line2"),
                        label: (_r, k) => k, id: true,
                        runs: r => jobRuns(r.jobs),
                        children: r => r.machines, rollup: "byStatus",
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(SpanMachine)));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            // The R2 developer render — the ROOT's resolver, called with the
            // focused row's id; ONE function serves every declaring row.
            const util = $.let(East.Array.generate(8n, MeasureRow, (_$, i) =>
                ({ week: week(i.add(27n)), pct: i.multiply(13n).remainder(40n).toFloat().add(55.0) })));
            const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, (_$, _id) => (
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
            // The linked rows, by id — the series that made each and the path of
            // entry keys to it (a program's machine sits under the program).
            const m07 = $.const(Plan.ref("flavours", "L1-M07"));
            const m09 = $.const(Plan.ref("detail", "L1-M09"));
            const m03 = $.const(Plan.ref("rollup", "Program A", "L1-M03"));
            const m11 = $.const(Plan.ref("rollup", "Program A", "L2-M11"));
            const dsp = $.const(Plan.ref("despatch", "dsp"));
            return (
                <Plan.View
                    expandRender={expandRender}
                    popover={popover}
                    // A denser gutter (value + carets) — widen it (the shared
                    // CSS-px height/width vocabulary).
                    style={{ gutterWidth: "200px" }}
                    axis={axis}
                    // The link graph (R1) — hover a linked row for the ⌁ control.
                    // The edges deliberately cover the routing permutations:
                    // forward, a same-row seam feed, loopbacks, a rising loop,
                    // and an off-window landing. Each moves a QUANTITY (#824):
                    // its value weighs the ribbon and its caption prints on it.
                    links={[
                        Plan.link({ key: "l1", from: m07, fromRun: "run", to: m09, toRun: "a", quantity: Plan.quantity(24, { unit: "t" }) }),
                        Plan.link({ key: "l2", from: m09, fromRun: "a", to: m09, toRun: "b", quantity: Plan.quantity(40, { unit: "t" }) }),
                        Plan.link({ key: "l3", from: m09, fromRun: "b", to: m03, toRun: "b221", quantity: Plan.quantity(88, { unit: "t" }) }),
                        Plan.link({ key: "l4", from: m03, fromRun: "b214", to: m11, toRun: "b241", quantity: Plan.quantity(32, { unit: "t" }) }),
                        Plan.link({ key: "l5", from: m11, fromRun: "b241", to: m09, toRun: "b", quantity: Plan.quantity(18, { unit: "t" }) }),
                        Plan.link({ key: "l6", from: m09, fromRun: "b", to: dsp, toRun: "d1", quantity: Plan.quantity(91, { unit: "t" }) }),
                    ]}
                    data={machines}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** A dock allocation — its week and its lifecycle state. */
export const BucketAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
/** A dock — raw allocations the accessor turns into tiles, or tiles stored in
 *  the element vocabulary itself, with its lanes and cell markers. */
export const BucketDock = StructType({
    series: StringType, label: StringType,
    sub: OptionType(StringType),
    lanes: ArrayType(Plan.Types.Lane),
    allocations: ArrayType(BucketAlloc),
    tiles: ArrayType(Plan.Types.BucketEvent),
    markers: ArrayType(Plan.Types.CellMarker),
});

/** The docks — weeks W27–W38. */
export const planBucketDocks = e3.input("plan_bucket_docks", DictType(StringType, BucketDock), variant("value", new Map([
    // Raw weekly allocations; every third one is a proposal.
    ["dock2", { series: "inbound", label: "Dock 2", sub: some("load/wk"), lanes: [],
      allocations: [
          { key: "a0", at: new Date("2026-06-29T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a1", at: new Date("2026-07-06T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a2", at: new Date("2026-07-13T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
          { key: "a3", at: new Date("2026-07-20T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a4", at: new Date("2026-07-27T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a5", at: new Date("2026-08-03T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ],
      tiles: [],
      markers: [{ at: variant("time", new Date("2026-07-13T00:00:00Z")), lane: none, status: variant("warning", null), message: "capacity 90%" }] }],
    // The grammar showcase — tiles stored IN the element vocabulary (plain
    // `PlanBucketEventType` records; no builders in data).
    ["dock5", { series: "outbound", label: "Dock 5", sub: some("day · am/pm"),
      lanes: [{ key: "am", label: some("AM") }, { key: "pm", label: some("PM") }],
      allocations: [],
      tiles: [
          { key: "m1", at: variant("time", new Date("2026-06-29T00:00:00Z")), lane: some("am"), label: none, icon: none, state: variant("confirmed", null),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m2", at: variant("time", new Date("2026-06-29T00:00:00Z")), lane: some("pm"), label: none, icon: none, state: variant("confirmed", null),
            tone: some(variant("warning", null)), color: none, colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m3", at: variant("time", new Date("2026-07-06T00:00:00Z")), lane: some("am"), label: none, icon: none, state: variant("proposed", variant("recommended", null)),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: some(variant("pulse", null)) },
          { key: "m4", at: variant("time", new Date("2026-07-13T00:00:00Z")), lane: none, label: some("MIXED"), icon: none, state: variant("confirmed", null),
            tone: none, color: none, colorPalette: none, stretch: some(variant("horizontal", null)),
            content: some({ horizontal: some(variant("center", null)), vertical: none }), animation: none },
          { key: "m5", at: variant("time", new Date("2026-07-20T00:00:00Z")), lane: some("pm"), label: none,
            icon: some({ prefix: "fas", name: "truck", label: none, style: none }),
            state: variant("proposed", variant("recommended", null)),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m6", at: variant("time", new Date("2026-07-27T00:00:00Z")), lane: some("am"), label: some("QC"), icon: none, state: variant("estimated", null),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none },
          // The colour channels (#571, from the Planner's colors preset):
          // `color` is a raw token override, `colorPalette` recolours the
          // whole lifecycle treatment.
          { key: "m7", at: variant("time", new Date("2026-08-03T00:00:00Z")), lane: some("am"), label: some("S-A"), icon: none, state: variant("confirmed", null),
            tone: none, color: some("teal.solid"), colorPalette: none, stretch: none, content: none, animation: none },
          { key: "m8", at: variant("time", new Date("2026-08-03T00:00:00Z")), lane: some("pm"), label: some("S-B"), icon: none, state: variant("confirmed", null),
            tone: none, color: none, colorPalette: some(variant("brand", null)), stretch: none, content: none, animation: none },
      ],
      markers: [{ at: variant("time", new Date("2026-07-13T00:00:00Z")), lane: none, status: variant("danger", null), message: "capacity breach" }] }],
])));

export const planBucketRows = example({
    keywords: ["Plan", "data", "series", "buckets", "Planner", "lane", "lanes", "AM", "PM", "event", "tile", "marker", "tone", "color", "colorPalette", "stretch", "pulse", "icon", "hovercard", "popover", "mixed", "unbucketed", "section", "match", "gutter", "raw", "Data.bind", "bound", "e3.input"],
    description: "Bucket rows over one dock source bound from e3 — tiles derived in the accessor, and stored tile records with lanes, tones, colours and markers",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const docks = $.let(Data.bind(planBucketDocks));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                // Raw allocations → resting tiles, in the accessor.
                Plan.series.buckets(BucketDock, {
                    key: "inbound", title: "Inbound",
                    match: r => r.series.equal("inbound"),
                    label: r => r.label,
                    sub: r => r.sub,
                    events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                    markers: r => r.markers,
                }),
                Plan.series.section(BucketDock, { key: "docks-out", title: "Docks · Out", meta: "1 row" }, [
                    // Stored vocabulary records pass straight through.
                    Plan.series.buckets(BucketDock, {
                        key: "outbound", title: "Outbound",
                        match: r => r.series.equal("outbound"),
                        label: r => r.label,
                        sub: r => r.sub,
                        lanes: r => r.lanes, events: r => r.tiles, markers: r => r.markers,
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(BucketDock)));
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
                <Plan.View
                    popover={popover}
                    hover={hover}
                    axis={axis}
                    data={docks}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * One measure — its readings, weekly from W27, the window's first week:
 * `weekly` the series the row draws, `extra` a second set for stacked or
 * dual-axis compositions, and `lo` / `hi` a band's bounds.
 */
export const ChartMeasure = StructType({
    series: StringType, label: StringType,
    sub: OptionType(StringType), value: OptionType(StringType),
    weekly: ArrayType(FloatType),
    extra: ArrayType(FloatType),
    lo: ArrayType(FloatType),
    hi: ArrayType(FloatType),
});

/** The measures, one per mark kind and composition. */
export const planChartMeasures = e3.input("plan_chart_measures", DictType(StringType, ChartMeasure), variant("value", new Map([
    ["spark", { series: "spark", label: "Coverage", sub: none, value: some("94.2%"),
      weekly: [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2], extra: [], lo: [], hi: [] }],
    ["cum", { series: "cum", label: "Cumulative · t", sub: none, value: some("194 t"),
      weekly: [40.0, 54.0, 68.0, 82.0, 96.0, 110.0, 124.0, 138.0, 152.0, 166.0, 180.0, 194.0], extra: [], lo: [], hi: [] }],
    ["stacked", { series: "stacked", label: "Output · t", sub: some("t/wk"), value: none,
      weekly: [28.0, 34.0, 40.0, 29.0, 35.0, 41.0, 30.0, 36.0, 42.0, 31.0, 37.0, 43.0],
      extra: [14.0, 19.0, 24.0, 16.0, 21.0, 26.0, 18.0, 23.0, 15.0, 20.0, 25.0, 17.0], lo: [], hi: [] }],
    ["ppm", { series: "ppm", label: "Defects · ppm", sub: none, value: some("161"),
      weekly: [120.0, 157.0, 134.0, 171.0, 148.0, 125.0, 162.0, 139.0, 176.0, 153.0, 130.0, 167.0], extra: [], lo: [], hi: [] }],
    ["refs", { series: "refs", label: "Coverage + refs", sub: none, value: none,
      weekly: [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2], extra: [], lo: [], hi: [] }],
    // Output columns on the left axis; the coverage line and its ±3 band on
    // the right.
    ["dual", { series: "dual", label: "Out + coverage", sub: none, value: none,
      weekly: [28.0, 34.0, 40.0, 29.0, 35.0, 41.0, 30.0, 36.0, 42.0, 31.0, 37.0, 43.0],
      extra: [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2],
      lo: [93.1, 93.4, 93.8, 94.0, 93.2, 92.1, 90.4, 88.0, 85.9, 88.4, 90.8, 91.2],
      hi: [99.1, 99.4, 99.8, 100.0, 99.2, 98.1, 96.4, 94.0, 91.9, 94.4, 96.8, 97.2] }],
])));

export const planChartRows = example({
    keywords: ["Plan", "data", "series", "chart", "layers", "spark", "expanded", "fixed", "refLine", "refBand", "refDot", "breach", "stacked", "dual-axis", "swatches", "Area", "Band", "Scatter", "Column", "Line", "domain", "tickValues", "section", "match", "gutter", "raw", "readings", "Data.bind", "bound", "e3.input"],
    description: "Chart rows over one measure source bound from e3 — weekly readings turned into each layer's points, one series per mark kind, plus annotations and a fixed dual-axis composition",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const measures = $.let(Data.bind(planChartMeasures));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            const BandRow = StructType({ week: DateTimeType, lo: FloatType, hi: FloatType });
            // A measure's weekly readings from W27 as a layer's points, and a
            // band's bounds as its points.
            const points = $.const(East.function([ArrayType(FloatType)], ArrayType(MeasureRow), ($, readings) =>
                East.Array.generate(readings.size(), MeasureRow, (_$, i) => ({ week: week(i.add(27n)), pct: readings.get(i) }))));
            const band = $.const(East.function([ArrayType(FloatType), ArrayType(FloatType)], ArrayType(BandRow), ($, lo, hi) =>
                East.Array.generate(lo.size(), BandRow, (_$, i) => ({ week: week(i.add(27n)), lo: lo.get(i), hi: hi.get(i) }))));
            const series = $.const([
                // Line — the KPI spark with a breach threshold; the caret opens
                // it to a custom 120px (expandedHeight, default 88).
                Plan.series.chart(ChartMeasure, {
                    key: "spark", title: "Spark",
                    match: r => r.series.equal("spark"),
                    label: r => r.label, id: true,
                    value: r => r.value, status: _r => some(variant("warning", null)),
                    height: "spark", expandable: true, expandedHeight: "120px",
                    layers: r => [Plan.layer(Chart.Line(points(r.weekly), { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } })],
                }),
                // Area — the cumulative fill.
                Plan.series.chart(ChartMeasure, {
                    key: "cum", title: "Cumulative",
                    match: r => r.series.equal("cum"),
                    label: r => r.label, id: true, value: r => r.value,
                    layers: r => [Chart.Area(points(r.weekly), { x: p => p.week, y: p => p.pct })],
                }),
                // Columns — the row's two reading sets stacked by one series
                // id, on a two-line gutter (label over sub).
                Plan.series.chart(ChartMeasure, {
                    key: "stacked", title: "Stacked",
                    match: r => r.series.equal("stacked"),
                    label: r => r.label, id: true, stacked: true, sub: r => r.sub,
                    layers: r => [
                        Plan.layer(Chart.Column(points(r.weekly), { x: p => p.week, y: p => p.pct }), { series: "L1" }),
                        Plan.layer(Chart.Column(points(r.extra), { x: p => p.week, y: p => p.pct }), { series: "L2" }),
                    ],
                }),
                // Scatter — the defect cloud.
                Plan.series.chart(ChartMeasure, {
                    key: "ppm", title: "Ppm",
                    match: r => r.series.equal("ppm"),
                    label: r => r.label, id: true, value: r => r.value,
                    layers: r => [Chart.Scatter(points(r.weekly), { x: p => p.week, y: p => p.pct })],
                }),
                // Line + every annotation kind, at expanded density.
                Plan.series.chart(ChartMeasure, {
                    key: "refs", title: "Refs",
                    match: r => r.series.equal("refs"),
                    label: r => r.label, id: true,
                    height: "expanded",
                    layers: r => [
                        Plan.layer(Chart.Line(points(r.weekly), { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                        Chart.refLine({ y: 100, label: "TARGET 100" }),
                        Chart.refBand({ x: [week(34n), week(36n)], label: "CRUNCH" }),
                        Chart.refDot({ x: week(36n), y: 91.4, label: "LOW" }),
                    ],
                }),
                // The composed dual-axis chart under a section header; axes take
                // Chart.Root's vocabulary — domain / tickValues. Output columns
                // scale left; the coverage line + its band scale right.
                Plan.series.section(ChartMeasure, { key: "quality", title: "Quality", meta: "1 row" }, [
                    Plan.series.chart(ChartMeasure, {
                        key: "dual", title: "Dual",
                        match: r => r.series.equal("dual"),
                        label: r => r.label, id: true,
                        height: Plan.fixed("120px"),
                        left: { domain: [0, 60], tickValues: [0, 25, 50] },
                        right: { domain: [80, 105], tickValues: [85, 95, 105] },
                        swatches: [{ color: "ink.3", label: "out" }, { color: "brand.d", label: "cov · rh" }],
                        layers: r => [
                            Chart.Column(points(r.weekly), { x: p => p.week, y: p => p.pct }),
                            Plan.layer(Chart.Line(points(r.extra), { x: p => p.week, y: p => p.pct }), { axis: "right" }),
                            Plan.layer(Chart.Band(band(r.lo, r.hi), { x: p => p.week, low: p => p.lo, high: p => p.hi }), { axis: "right" }),
                        ],
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(ChartMeasure)));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            return (
                <Plan.View
                    axis={axis}
                    data={measures}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * A heat row — a LINE holds its machines' rows (`children`): the hierarchy is
 * the data's (#822), so the line's row derives its own cells from theirs.
 * `load` is a machine's weekly readings from W27 (a week with none is a gap);
 * `weights` and `segs` are stored in the element vocabulary itself.
 */
export const HeatRow = RecursiveType((self) => StructType({
    series: StringType, label: StringType,
    sub: OptionType(StringType),
    load: ArrayType(OptionType(FloatType)),
    weights: ArrayType(Plan.Types.WeightCell),
    segs: ArrayType(Plan.Types.SegmentCell),
    children: DictType(StringType, self),
}));

/** The lines, the crew's booked hours and the pack line's capacity. */
export const planHeatLines = e3.input("plan_heat_lines", DictType(StringType, HeatRow), variant("value", new Map([
    // A line with no readings of its own — its row shows the per-bucket mean
    // of its machines' (the series declares `aggregate`). W31 has no reading.
    ["line1", { series: "depth", label: "Line 1", sub: none, load: [], weights: [], segs: [],
      children: new Map([
          ["m03h", { series: "depth", label: "L1-M03", sub: none, weights: [], segs: [], children: new Map(),
            load: [some(46.0), some(52.0), some(58.0), some(61.0), none, some(72.0), some(78.0), some(84.0), some(90.0), some(96.0), some(98.0), some(92.0)] }],
          ["m04h", { series: "depth", label: "L1-M04", sub: none, weights: [], segs: [], children: new Map(),
            load: [some(46.0), some(52.0), some(58.0), some(61.0), none, some(72.0), some(78.0), some(84.0), some(90.0), some(96.0), some(98.0), some(92.0)] }],
      ]) }],
    // Booked-vs-free fractions, fortnightly; the back half is the planned
    // pale tail.
    ["booked", { series: "booked", label: "Crew A", sub: some("booked h"), load: [], segs: [], children: new Map(),
      weights: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), fraction: 0.9, planned: false },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), fraction: 0.79, planned: false },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), fraction: 0.68, planned: false },
          { at: variant("time", new Date("2026-08-10T00:00:00Z")), fraction: 0.57, planned: true },
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), fraction: 0.46, planned: true },
          { at: variant("time", new Date("2026-09-07T00:00:00Z")), fraction: 0.35, planned: true },
      ] }],
    // Segment compositions — plain `{ fill, weight, label }` records.
    ["pack", { series: "segments", label: "Pack line", sub: some("capacity"), load: [], weights: [], children: new Map(),
      segs: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), segments: [
              { fill: variant("success", null), weight: 60.0, label: some("60%") },
              { fill: variant("warning", null), weight: 25.0, label: some("25%") },
              { fill: variant("slack", null), weight: 15.0, label: none },
          ] },
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), segments: [
              { fill: variant("success", null), weight: 70.0, label: some("70%") },
              { fill: variant("slack", null), weight: 30.0, label: none },
          ] },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), segments: [
              { fill: variant("danger", null), weight: 40.0, label: some("40%") },
              { fill: variant("free", null), weight: 60.0, label: none },
          ] },
      ] }],
])));

export const planHeatRows = example({
    keywords: ["Plan", "data", "series", "heat", "Matrix", "cells", "depth", "aggregate", "mean", "children", "nested", "recursive", "RecursiveType", "scale", "warnAt", "weightCells", "segmentCells", "segment", "no-data", "hatch", "section", "match", "gutter", "raw", "readings", "Data.bind", "bound", "e3.input"],
    description: "Heat rows over one line source bound from e3 — colour-depth cells from weekly readings under a line that averages them, weight bars, and status segments",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const lines = $.let(Data.bind(planHeatLines));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // A machine's weekly readings from W27 as heat cells, each printing
            // its value — a week with no reading is the no-data hatch.
            const loadCells = $.const(East.function([ArrayType(OptionType(FloatType))], ArrayType(Plan.Types.HeatCell), ($, load) =>
                East.Array.generate(load.size(), Plan.Types.HeatCell, ($, i) => {
                    const value = $.let(load.get(i), OptionType(FloatType));
                    const label = $.let(none, OptionType(StringType));
                    $.match(value, { some: ($, v) => { $.assign(label, some(East.Float.printFixed(v, 0n))); } });
                    return { at: Plan.at.time(week(i.add(27n))), value, label };
                })));
            const series = $.const([
                // A line's machines nest under it, and its row is their per-bucket
                // mean — painted on `scale`, the scale a parent's DERIVED cells
                // take (#824; a mean of rows on 0–100 would inherit it anyway).
                Plan.series.heat(HeatRow, {
                    key: "depth", title: "Depth",
                    match: r => r.series.equal("depth"),
                    label: r => r.label, id: true,
                    cells: r => Plan.heatCells(loadCells(r.load), { min: 0, max: 100, warnAt: 95 }),
                    children: r => r.children, aggregate: "mean",
                    scale: { min: 0, max: 100, warnAt: 95 },
                }),
                Plan.series.heat(HeatRow, {
                    key: "booked", title: "Booked",
                    match: r => r.series.equal("booked"),
                    label: r => r.label,
                    sub: r => r.sub,
                    cells: r => Plan.weightCells(r.weights),
                }),
                Plan.series.section(HeatRow, { key: "packing", title: "Packing", meta: "1 row" }, [
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
                <Plan.View
                    axis={axis}
                    data={lines}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The RAW order record — actuals and the plan Δ as weekly readings from W27
 * (a week with none prints the muted em-dash); every display decision lives
 * in the series configs. Orders nest (`children`): a top holds its programs,
 * a program its orders — the hierarchy is the data's own (#822), to whatever
 * depth it has.
 */
export const TableOrder = RecursiveType((self) => StructType({
    series: StringType, name: StringType,
    sub: OptionType(StringType),
    act: ArrayType(OptionType(FloatType)),
    plan: ArrayType(OptionType(FloatType)),
    children: DictType(StringType, self),
}));

/** The orders, programs and flows. */
export const planTableOrders = e3.input("plan_table_orders", DictType(StringType, TableOrder), variant("value", new Map([
    // Two levels of nesting — a top holds its programs, a program its
    // orders; every level with no values of its own is a subtotal.
    ["despatches", { series: "orders", name: "Despatches", sub: none, act: [], plan: [],
      children: new Map([
          ["program-a", { series: "orders", name: "Program A", sub: none, act: [], plan: [],
            children: new Map([
                ["or-1188", { series: "orders", name: "OR-1188", sub: none, plan: [], children: new Map(),
                  act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)] }],
                ["or-1204", { series: "orders", name: "OR-1204", sub: none, plan: [], children: new Map(),
                  act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)] }],
            ]) }],
          ["program-b", { series: "orders", name: "Program B", sub: none, act: [], plan: [],
            children: new Map([
                ["or-1219", { series: "orders", name: "OR-1219", sub: none, plan: [], children: new Map(),
                  act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)] }],
            ]) }],
      ]) }],
    ["returns", { series: "orders", name: "Returns", sub: none, act: [], plan: [],
      children: new Map([
          ["program-b", { series: "orders", name: "Program B", sub: none, act: [], plan: [],
            children: new Map([
                ["rt-0031", { series: "orders", name: "RT-0031", sub: none, plan: [], children: new Map(),
                  act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)] }],
            ]) }],
      ]) }],
    // Footer emphasis + negative tone + the muted em-dash.
    ["net", { series: "net", name: "Net flow", sub: none, plan: [], children: new Map(),
      act: [some(22.0), some(-26.0), none] }],
    // Multi-value series — act + plan readings per row. The SPLIT (how the
    // positions sit against each other) and the GUTTER (one line or two) are
    // independent choices, so all four combinations are here: the pair that
    // reads well depends on the numbers, not on the split.
    ["actplan", { series: "actplan", name: "Act · Δ plan", sub: some("t/wk"), children: new Map(),
      act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
      plan: [some(-8.0), some(-6.5), some(-5.0), none, some(-2.0), some(-0.5), some(1.0), none, some(4.0), some(5.5), some(7.0), none] }],
    ["inout", { series: "inout", name: "In / out", sub: none, children: new Map(),
      act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
      plan: [some(-12.0), some(-15.0), some(-18.0), some(-21.0), some(-24.0), some(-27.0), some(-30.0), some(-33.0), some(-36.0), some(-39.0), some(-42.0), some(-45.0)] }],
    // Horizontal, on a ONE-line gutter — the pair reads as a single fact
    // ("booked beside free"), so a sub label would only repeat it.
    ["sidebyside", { series: "sidebyside", name: "Booked · free", sub: none, children: new Map(),
      act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
      plan: [some(-12.0), some(-15.0), some(-18.0), some(-21.0), some(-24.0), some(-27.0), some(-30.0), some(-33.0), some(-36.0), some(-39.0), some(-42.0), some(-45.0)] }],
    // Vertical, on a TWO-line gutter — the stack needs the unit spelled out,
    // because the positions are the same measure at two times.
    ["overunder", { series: "overunder", name: "Act / plan", sub: some("t/wk"), children: new Map(),
      act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
      plan: [some(-8.0), some(-6.5), some(-5.0), none, some(-2.0), some(-0.5), some(1.0), none, some(4.0), some(5.5), some(7.0), none] }],
    // NESTED and multi-value: the subtotal parent mirrors its members, an act
    // subtotal beside a Δ subtotal.
    ["flows", { series: "flow", name: "Flows", sub: none, act: [], plan: [],
      children: new Map([
          ["fl-1", { series: "flow", name: "FL-2201", sub: none, children: new Map(),
            act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
            plan: [some(-8.0), some(-6.5), some(-5.0), none, some(-2.0), some(-0.5), some(1.0), none, some(4.0), some(5.5), some(7.0), none] }],
          ["fl-2", { series: "flow", name: "FL-2202", sub: none, children: new Map(),
            act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
            plan: [some(-8.0), some(-6.5), some(-5.0), none, some(-2.0), some(-0.5), some(1.0), none, some(4.0), some(5.5), some(7.0), none] }],
      ]) }],
    // The same, STACKED: members and their subtotal both put the two positions
    // on their own lines, so the parent has to grow too.
    ["stacks", { series: "stack", name: "Stacks", sub: none, act: [], plan: [],
      children: new Map([
          ["st-1", { series: "stack", name: "ST-3301", sub: none, children: new Map(),
            act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
            plan: [some(-12.0), some(-15.0), some(-18.0), some(-21.0), some(-24.0), some(-27.0), some(-30.0), some(-33.0), some(-36.0), some(-39.0), some(-42.0), some(-45.0)] }],
          ["st-2", { series: "stack", name: "ST-3302", sub: none, children: new Map(),
            act: [some(40.0), some(47.0), some(54.0), some(61.0), some(68.0), some(75.0), some(82.0), some(89.0), some(96.0), none, some(110.0), some(117.0)],
            plan: [some(-12.0), some(-15.0), some(-18.0), some(-21.0), some(-24.0), some(-27.0), some(-30.0), some(-33.0), some(-36.0), some(-39.0), some(-42.0), some(-45.0)] }],
      ]) }],
])));

export const planTableRows = example({
    keywords: ["Plan", "data", "series", "table", "cells", "tableCells", "subtotal", "aggregate", "sum", "format", "emphasis", "footer", "children", "nested", "recursive", "RecursiveType", "depth", "em-dash", "neg", "match", "gutter", "tableSeries", "split", "horizontal", "vertical", "multi-value", "multi-cell", "stacked", "two-line", "strong", "muted", "rollup", "mirror", "position", "raw", "readings", "Data.bind", "bound", "e3.input"],
    description: "Table rows over one order source bound from e3 — weekly readings as cells, subtotals at every level of the data's nesting, footer emphasis, and every split × gutter combination",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Data.bind(planTableOrders));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // Weekly readings from W27 as the raw `{ at, value }` cells
            // `Plan.tableCells` reads.
            const RawCell = StructType({ at: DateTimeType, value: OptionType(FloatType) });
            const readings = $.const(East.function([ArrayType(OptionType(FloatType))], ArrayType(RawCell), ($, values) =>
                East.Array.generate(values.size(), RawCell, (_$, i) => ({ at: week(i.add(27n)), value: values.get(i) }))));
            const series = $.const([
                // Each order nests under its program, each program under its top
                // (`children`, to any depth), and every parent sums its children.
                Plan.series.table(TableOrder, {
                    key: "orders", title: "Orders",
                    match: r => r.series.equal("orders"),
                    label: r => r.name,
                    cells: r => Plan.tableCells(readings(r.act)),
                    children: r => r.children, aggregate: "sum",
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.table(TableOrder, {
                    key: "net", title: "Net",
                    match: r => r.series.equal("net"),
                    label: r => r.name, emphasis: "footer",
                    cells: r => Plan.tableCells(readings(r.act)),
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                // Per-POSITION style declared ONCE, in the CONFIG — a strong
                // rolled-up actual beside its muted, always-signed plan Δ.
                Plan.series.table(TableOrder, {
                    key: "actplan", title: "Actual vs plan",
                    match: r => r.series.equal("actplan"),
                    label: r => r.name, stacked: true, sub: r => r.sub,
                    series: r => [
                        Plan.tableSeries({ strong: true, rollup: true, cells: Plan.tableCells(readings(r.act)) }),
                        Plan.tableSeries({
                            tone: "muted",
                            format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                            cells: Plan.tableCells(readings(r.plan)),
                        }),
                    ],
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                // The VERTICAL split stacks the positions; the row grows.
                Plan.series.table(TableOrder, {
                    key: "inout", title: "Inout",
                    match: r => r.series.equal("inout"),
                    label: r => r.name, split: "vertical",
                    series: r => [
                        Plan.tableSeries({ cells: Plan.tableCells(readings(r.act)) }),
                        Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(readings(r.plan)) }),
                    ],
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                // HORIZONTAL on a ONE-line gutter — the other half of the pair
                // above: the split is a cell-layout choice and the gutter a label
                // choice, so neither implies the other.
                Plan.series.table(TableOrder, {
                    key: "sidebyside", title: "Side by side",
                    match: r => r.series.equal("sidebyside"),
                    label: r => r.name, split: "horizontal",
                    series: r => [
                        Plan.tableSeries({ strong: true, cells: Plan.tableCells(readings(r.act)) }),
                        Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(readings(r.plan)) }),
                    ],
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                // A MULTI-VALUE series under a subtotal parent — every position
                // rolls up, so the parent shows an act subtotal beside a Δ subtotal
                // instead of collapsing to one number and looking complete. Flag a
                // position `rollup: true` to narrow it back to that one.
                Plan.series.table(TableOrder, {
                    key: "flow", title: "Flow",
                    match: r => r.series.equal("flow"),
                    label: r => r.name,
                    series: r => [
                        Plan.tableSeries({ strong: true, cells: Plan.tableCells(readings(r.act)) }),
                        Plan.tableSeries({
                            tone: "muted",
                            format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                            cells: Plan.tableCells(readings(r.plan)),
                        }),
                    ],
                    children: r => r.children, aggregate: "sum",
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                // NESTED and VERTICAL — the subtotal stacks its positions the way
                // its members do. The parent's positions carry no values of their
                // own (they are derived), so its height comes from its members'
                // count: a parent that read its own empty cells as one line would
                // render as two.
                Plan.series.table(TableOrder, {
                    key: "stack", title: "Stack",
                    match: r => r.series.equal("stack"),
                    label: r => r.name, split: "vertical",
                    series: r => [
                        Plan.tableSeries({ strong: true, cells: Plan.tableCells(readings(r.act)) }),
                        Plan.tableSeries({ tone: "muted", cells: Plan.tableCells(readings(r.plan)) }),
                    ],
                    children: r => r.children, aggregate: "sum",
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                // VERTICAL on a TWO-line gutter — the remaining combination, and
                // the one that grows the row in BOTH directions at once.
                Plan.series.table(TableOrder, {
                    key: "overunder", title: "Over / under",
                    match: r => r.series.equal("overunder"),
                    label: r => r.name, split: "vertical", stacked: true, sub: r => r.sub,
                    series: r => [
                        Plan.tableSeries({ strong: true, rollup: true, cells: Plan.tableCells(readings(r.act)) }),
                        Plan.tableSeries({
                            tone: "muted",
                            format: Format.Number({ maximumFractionDigits: 0n, signDisplay: "always" }),
                            cells: Plan.tableCells(readings(r.plan)),
                        }),
                    ],
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
            ], ArrayType(Plan.Types.Series(TableOrder)));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            return (
                <Plan.View
                    axis={axis}
                    data={orders}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planFold — a coarser resolution FOLDS each bucket's values (#824)
// ============================================================================

/** One measure — its weekly readings from W27; `series` picks its row's series. */
export const FoldMeasure = StructType({ series: StringType, label: StringType, readings: ArrayType(FloatType) });

/** Twelve weeks of each measure, W27–W38. */
export const planFoldMeasures = e3.input("plan_fold_measures", DictType(StringType, FoldMeasure), variant("value", new Map([
    ["load",  { series: "load",  label: "Line load %", readings: [45.0, 62.0, 79.0, 46.0, 63.0, 80.0, 47.0, 64.0, 81.0, 48.0, 65.0, 82.0] }],
    ["peak",  { series: "peak",  label: "Peak load %", readings: [45.0, 62.0, 79.0, 46.0, 63.0, 80.0, 47.0, 64.0, 81.0, 48.0, 65.0, 82.0] }],
    ["book",  { series: "book",  label: "Booked", readings: [0.4, 0.82, 0.64, 0.46, 0.88, 0.7, 0.52, 0.94, 0.76, 0.58, 0.4, 0.82] }],
    ["desp",  { series: "desp",  label: "Despatch t", readings: [80.0, 109.0, 138.0, 107.0, 136.0, 105.0, 134.0, 103.0, 132.0, 101.0, 130.0, 99.0] }],
    ["stock", { series: "stock", label: "Closing stock t", readings: [420.0, 398.0, 376.0, 354.0, 332.0, 310.0, 288.0, 266.0, 244.0, 222.0, 200.0, 178.0] }],
    ["out",   { series: "out",   label: "Output · t", readings: [60.0, 83.0, 66.0, 89.0, 72.0, 95.0, 78.0, 61.0, 84.0, 67.0, 90.0, 73.0] }],
    ["cov",   { series: "cov",   label: "Coverage %", readings: [88.0, 92.0, 96.0, 91.0, 95.0, 90.0, 94.0, 89.0, 93.0, 88.0, 92.0, 96.0] }],
])));

/**
 * Temporal fold (#824). The data is weekly; the canvas shows it at whatever
 * resolution the axis states, and at MONTH every row shows ONE value per
 * month — the fold of its weeks there — where it used to stack four or five
 * on top of each other. Each cell builder and chart layer declares its fold,
 * defaulting to what its values mean: a heat level and a line fold by `mean`,
 * a table numeral and a column by `sum`, a weight fraction by `mean`. A row
 * overrides it where the meaning differs — peak load by `max`, closing stock
 * by `last`. The switch is the resolution; nothing in the data changes, and a
 * row whose weeks were never folded (WEEK) shows them as they are.
 */
export const planFold = example({
    keywords: [
        "Plan", "fold", "temporal fold", "resolution", "week", "month", "rebucket", "bucket",
        "sum", "mean", "max", "last", "count", "default", "override", "heatCells", "weightCells",
        "tableCells", "tableSeries", "layer", "Plan.layer", "column", "line", "format",
        "Reactive", "State", "SegmentGroup", "#824", "readings", "Data.bind", "bound", "e3.input",
    ],
    description: "Temporal fold — weekly readings bound from e3 at MONTH resolution show one folded cell per month per row: heat and lines by mean, tables and columns by sum, with per-row overrides (peak load by max, closing stock by last)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const measures = $.let(Data.bind(planFoldMeasures));
            // Monday of ISO week n, 2026 — twelve weeks, W27–W38.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const Weekly = StructType({ at: DateTimeType, value: OptionType(FloatType) });
            const MeasureRow = StructType({ week: DateTimeType, v: FloatType });
            // A measure's weekly readings from W27, as each row kind reads
            // them: heat cells, booked fractions (the weeks after now are the
            // planned, pale tail), table cells and chart points.
            const heat = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), ($, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$, i) => ({
                    at: Plan.at.time(week(i.add(27n))), value: some(readings.get(i)), label: none,
                }))));
            const booked = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.WeightCell), ($, readings) =>
                East.Array.generate(readings.size(), Plan.Types.WeightCell, (_$, i) => ({
                    at: Plan.at.time(week(i.add(27n))), fraction: readings.get(i), planned: i.add(27n).greater(31n),
                }))));
            const weekly = $.const(East.function([ArrayType(FloatType)], ArrayType(Weekly), ($, readings) =>
                East.Array.generate(readings.size(), Weekly, (_$, i) => ({ at: week(i.add(27n)), value: some(readings.get(i)) }))));
            const points = $.const(East.function([ArrayType(FloatType)], ArrayType(MeasureRow), ($, readings) =>
                East.Array.generate(readings.size(), MeasureRow, (_$, i) => ({ week: week(i.add(27n)), v: readings.get(i) }))));
            const whole = $.const(Format.Number({ maximumFractionDigits: 0n }));
            const series = $.const([
                // A level — a month shows its weeks' MEAN (the default). The
                // declared format prints the folded values.
                Plan.series.heat(FoldMeasure, {
                    key: "load", title: "Line load",
                    match: r => r.series.equal("load"), label: r => r.label,
                    cells: r => Plan.heatCells(heat(r.readings), { min: 0, max: 100, format: whole }),
                }),
                // The same weeks, folded by their MAX — the peak a month hit.
                Plan.series.heat(FoldMeasure, {
                    key: "peak", title: "Peak load",
                    match: r => r.series.equal("peak"), label: r => r.label,
                    cells: r => Plan.heatCells(heat(r.readings), { min: 0, max: 100, fold: "max", format: whole }),
                }),
                // A fraction of each bucket booked — a month's is its weeks' mean.
                Plan.series.heat(FoldMeasure, {
                    key: "book", title: "Booked",
                    match: r => r.series.equal("book"), label: r => r.label,
                    cells: r => Plan.weightCells(booked(r.readings)),
                }),
                // An amount — a month shows its weeks' SUM (the default).
                Plan.series.table(FoldMeasure, {
                    key: "desp", title: "Despatch",
                    match: r => r.series.equal("desp"), label: r => r.label,
                    cells: r => Plan.tableCells(weekly(r.readings)), format: whole,
                }),
                // A balance — a month shows where it CLOSED, its last week.
                Plan.series.table(FoldMeasure, {
                    key: "stock", title: "Closing stock",
                    match: r => r.series.equal("stock"), label: r => r.label,
                    cells: r => Plan.tableCells(weekly(r.readings)), fold: "last", format: whole,
                }),
                // Columns sum; a line averages.
                Plan.series.chart(FoldMeasure, {
                    key: "out", title: "Output",
                    match: r => r.series.equal("out"), label: r => r.label, id: true,
                    layers: r => [Chart.Column(points(r.readings), { x: p => p.week, y: p => p.v })],
                }),
                Plan.series.chart(FoldMeasure, {
                    key: "cov", title: "Coverage",
                    match: r => r.series.equal("cov"), label: r => r.label, id: true,
                    layers: r => [Plan.layer(Chart.Line(points(r.readings), { x: p => p.week, y: p => p.v }), { fold: "mean" })],
                }),
            ], ArrayType(Plan.Types.Series(FoldMeasure)));
            // The resolution is the switch — two whole axis values, picked by
            // key; the pick is the viewer's own state.
            const axes = $.const([
                { key: "month", axis: Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "month", now: week(31n) }) },
                { key: "week", axis: Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }) },
            ], ArrayType(StructType({ key: StringType, axis: Plan.Types.Axis })));
            const resBind = $.let(State.bind([StringType], "plan_fold_resolution", "month"));
            const resKey = $.let(resBind.read());
            const onRes = $.const(East.function([StringType], NullType, ($, next) => { $(resBind.write(next)); }));
            const sel = $.let(axes.filter((_$, a) => a.key.equal(resKey)).get(0n, _$ => axes.get(0n)));
            return (
                <VStack gap="2" align="stretch">
                    <SegmentGroup value={resKey} onChange={onRes} size="sm"
                        items={[SegmentGroup.Item("month", <Text>MONTH</Text>), SegmentGroup.Item("week", <Text>WEEK</Text>)]} />
                    <Plan.View axis={sel.axis} data={measures} series={series} />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** A crew's shift — hours and lifecycle; its chip label derives client-side. */
export const CardShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType,
    hours: FloatType, state: EventStateType,
});
/** A crew — raw shifts, or chips stored in the element vocabulary itself. */
export const CardCrew = StructType({
    series: StringType, name: StringType,
    sub: OptionType(StringType), value: OptionType(StringType),
    shifts: ArrayType(CardShift),
    chips: ArrayType(Plan.Types.Chip),
});

/** The crews — weeks W27–W38. */
export const planCardCrews = e3.input("plan_card_crews", DictType(StringType, CardCrew), variant("value", new Map([
    // RAW shifts — hours + lifecycle; chip labels derive client-side.
    ["crewA", { series: "main", name: "Crew A", sub: some("152h → 168h"), value: none, chips: [], shifts: [
        { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), hours: 80.0, state: variant("confirmed", null) },
        { key: "s2", from: new Date("2026-07-13T00:00:00Z"), to: new Date("2026-07-27T00:00:00Z"), hours: 56.0, state: variant("proposed", variant("removed", null)) },
        { key: "s3", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
        { key: "s4", from: new Date("2026-08-17T00:00:00Z"), to: new Date("2026-08-24T00:00:00Z"), hours: 48.0, state: variant("estimated", null) },
    ] }],
    // STORED vocabulary — plain chip records (the §3.2 element shapes), here
    // carrying the shift-type icon.
    ["crewB", { series: "pool", name: "Crew B", sub: none, value: some("128h"), shifts: [], chips: [
        { key: "b1", from: variant("time", new Date("2026-07-06T00:00:00Z")), to: variant("time", new Date("2026-07-27T00:00:00Z")), label: "96h", state: variant("confirmed", null),
          icon: some({ prefix: "fas", name: "user-group", label: none, style: none }) },
        { key: "b2", from: variant("time", new Date("2026-08-10T00:00:00Z")), to: variant("time", new Date("2026-08-31T00:00:00Z")), label: "+32h", state: variant("proposed", variant("recommended", null)), icon: none },
    ] }],
])));

export const planCardRows = example({
    keywords: ["Plan", "data", "series", "cards", "Roster", "chip", "lifecycle", "confirmed", "recommended", "removed", "estimated", "icon", "popover", "stacked", "format", "axis", "section", "match", "gutter", "raw", "Data.bind", "bound", "e3.input"],
    description: "Cards rows over one crew source bound from e3 — chip labels derived from hours × lifecycle, plus stored chip records",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const crews = $.let(Data.bind(planCardCrews));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                Plan.series.cards(CardCrew, {
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
                Plan.series.section(CardCrew, { key: "relief", title: "Relief pool", meta: "1 row" }, [
                    Plan.series.cards(CardCrew, {
                        key: "pool", title: "Pool",
                        match: r => r.series.equal("pool"),
                        label: r => r.name,
                        value: r => r.value,
                        chips: r => r.chips,
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(CardCrew)));
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
                <Plan.View
                    popover={popover}
                    axis={axis}
                    data={crews}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** A stream of instant marks, stored in the element vocabulary itself. */
export const EventStream = StructType({
    series: StringType, name: StringType,
    sub: OptionType(StringType), value: OptionType(StringType),
    marks: ArrayType(Plan.Types.EventMark),
});

/** The milestone and release streams — weeks W27–W38. */
export const planEventStreams = e3.input("plan_event_streams", DictType(StringType, EventStream), variant("value", new Map([
    ["ms", { series: "main", name: "Milestones", sub: none, value: some("5"), marks: [
        { key: "kick", at: variant("time", new Date("2026-07-06T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
        { key: "d1", at: variant("time", new Date("2026-07-27T00:00:00Z")), kind: variant("decision", { applied: true }), icon: none, label: none },
        { key: "rel", at: variant("time", new Date("2026-08-10T00:00:00Z")), kind: variant("milestone", null),
          icon: some({ prefix: "fas", name: "rocket", label: none, style: none }), label: some("REL 2.4") },
        { key: "audit", at: variant("time", new Date("2026-08-24T00:00:00Z")), kind: variant("exception", null), icon: none, label: some("AUDIT") },
        { key: "d2", at: variant("time", new Date("2026-09-07T00:00:00Z")), kind: variant("decision", { applied: false }), icon: none, label: some("×3") },
    ] }],
    ["release", { series: "programs", name: "Releases", sub: some("6-wk cadence"), value: none, marks: [
        { key: "r1", at: variant("time", new Date("2026-07-13T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("2.3") },
        { key: "r2", at: variant("time", new Date("2026-08-31T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("2.4") },
    ] }],
])));

export const planEventRows = example({
    keywords: ["Plan", "data", "series", "events", "mark", "milestone", "decision", "exception", "markKind", "applied", "icon", "label", "popover", "section", "match", "stacked", "gutter", "raw", "Data.bind", "bound", "e3.input"],
    description: "Event rows over one stream source bound from e3 — milestone dots, decision diamonds, an exception, and a custom glyph",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const streams = $.let(Data.bind(planEventStreams));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                Plan.series.events(EventStream, {
                    key: "milestones", title: "Milestones",
                    match: r => r.series.equal("main"),
                    label: r => r.name, id: true,
                    value: r => r.value,
                    marks: r => r.marks,
                }),
                Plan.series.section(EventStream, { key: "programs", title: "Programs", meta: "1 row" }, [
                    Plan.series.events(EventStream, {
                        key: "releases", title: "Releases",
                        match: r => r.series.equal("programs"),
                        label: r => r.name, id: true, stacked: true,
                        sub: r => r.sub,
                        marks: r => r.marks,
                    }),
                ]),
            ], ArrayType(Plan.Types.Series(EventStream)));
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
                <Plan.View
                    popover={popover}
                    axis={axis}
                    data={streams}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** A machine's job — its batch, window and lifecycle state. */
export const GroupedJob = StructType({
    key: StringType, batch: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** The RAW rows, flat — each names its line, and carries jobs, load
 *  readings (weekly from W27), or both. */
export const GroupedRow = StructType({
    line: StringType, label: StringType,
    jobs: ArrayType(GroupedJob),
    load: ArrayType(FloatType),
});

/** The rows, flat — four lines' machines and loads. */
export const planLineRows = e3.input("plan_line_rows", DictType(StringType, GroupedRow), variant("value", new Map([
    // Line 1 — mixed kinds: a machine's jobs and its load.
    ["m03", { line: "Line 1", label: "L1-M03", load: [],
      jobs: [{ key: "r", batch: "B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) }] }],
    ["m03h", { line: "Line 1", label: "L1-M03 load", jobs: [], load: [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0] }],
    ["l2", { line: "Line 2", label: "L2 load", jobs: [], load: [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0] }],
    ["m21", { line: "Line 3", label: "L3-M21", jobs: [], load: [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0] }],
    ["m22", { line: "Line 3", label: "L3-M22", jobs: [], load: [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0] }],
    ["m31", { line: "Line 4", label: "L4-M31", jobs: [], load: [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0] }],
])));

export const planGroupedRows = example({
    keywords: ["Plan", "data", "series", "group", "groups", "strip", "summary", "summaryAggregate", "collapsed", "groupToDicts", "grouping", "data step", "children", "Plan.children", "step down", "member count", "heterogeneous", "match", "nesting", "raw", "readings", "Data.bind", "bound", "e3.input"],
    description: "Group strips over grouped data — a flat source bound from e3, one `groupToDicts` makes each line an entry holding its rows, and each line's strip nests them, collapsed strips resting as their mean",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const rows = $.let(Data.bind(planLineRows));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // A row's weekly load readings from W27 as heat cells, each printing its value.
            const loadCells = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), ($, load) =>
                East.Array.generate(load.size(), Plan.Types.HeatCell, (_$, i) => ({
                    at: Plan.at.time(week(i.add(27n))),
                    value: some(load.get(i)),
                    label: some(East.Float.printFixed(load.get(i), 0n)),
                }))));
            // Grouping is a DATA step (#822): one `groupToDicts` makes each line an
            // entry holding its rows, keyed as the source keys them. A strip nests
            // exactly what its entry holds, so it reads the same inline or paged.
            const lines = $.let(rows.read().groupToDicts(($, r) => r.line, ($, _r, k) => k));
            const LineGroup = DictType(StringType, GroupedRow);
            const series = $.const([
                // One strip PER LINE, its members the line's rows — stepped down
                // into (`Plan.children`) and laid out like a top-level list: the
                // jobs block, then the load block. Line 1 rests open; the others
                // rest as their DECLARED mean strip, wearing their member count.
                Plan.series.group(LineGroup, {
                    key: "lines", title: "Lines",
                    label: (_g, line) => line,
                    collapsed: (_g, line) => line.equal("Line 1").not(),
                    summaryAggregate: "mean",
                    children: Plan.children((g) => g, [
                        Plan.series.span(GroupedRow, {
                            key: "line-jobs", title: "Jobs",
                            match: r => r.jobs.size().greater(0n),
                            label: r => r.label, id: true,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end,
                                label: East.str`RUN · ${j.batch}`, state: j.state,
                            })),
                        }),
                        Plan.series.heat(GroupedRow, {
                            key: "line-load", title: "Load",
                            match: r => r.load.size().greater(0n),
                            label: r => r.label,
                            cells: r => Plan.heatCells(loadCells(r.load), { min: 0, max: 100 }),
                        }),
                    ]),
                }),
            ], ArrayType(Plan.Types.Series(LineGroup)));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            return (
                <Plan.View
                    axis={axis}
                    data={lines}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planSeriesData — the minimal data + series introduction
// ============================================================================

/** A machine's job — its batch, window, tonnage and lifecycle state. */
export const SeriesJob = StructType({ batch: StringType, start: DateTimeType, end: DateTimeType, tonnes: FloatType, state: EventStateType });
/** A crew's shift — its window, hours and lifecycle state. */
export const SeriesShift = StructType({ key: StringType, from: DateTimeType, to: DateTimeType, hours: FloatType, state: EventStateType });
/** The RAW domain shape — series discriminated by a variant field (the natural ops-dataset form). */
export const SeriesOpsRow = StructType({
    line: StringType,
    kind: VariantType({
        machine: StructType({ jobs: ArrayType(SeriesJob) }),
        crew:    StructType({ shifts: ArrayType(SeriesShift) }),
    }),
});
/** The ops dataset — its default is the dataset's initial value. */
export const planSeriesOps = e3.input("plan_series_ops", DictType(StringType, SeriesOpsRow), variant("value", new Map([
    ["L1-M03", { line: "Line 1", kind: variant("machine", { jobs: [
        { batch: "B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), tonnes: 96.0, state: variant("in-progress", null) },
        { batch: "B-221", start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), tonnes: 88.0, state: variant("proposed", variant("recommended", null)) },
    ] }) }],
    ["L1-M04", { line: "Line 1", kind: variant("machine", { jobs: [
        { batch: "B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), tonnes: 112.0, state: variant("actual", null) },
    ] }) }],
    ["L2-M11", { line: "Line 2", kind: variant("machine", { jobs: [
        { batch: "B-241", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), tonnes: 92.0, state: variant("confirmed", null) },
    ] }) }],
    ["crewA", { line: "Line 1", kind: variant("crew", { shifts: [
        { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), hours: 80.0, state: variant("confirmed", null) },
        { key: "s2", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
    ] }) }],
])));

export const planSeriesData = example({
    keywords: ["Plan", "data", "series", "match", "variant", "span", "cards", "group", "rows", "groupToDicts", "grouping", "data step", "children", "Plan.children", "step down", "nesting", "rollup", "Series", "data-driven", "accessor", "raw", "one source", "layout", "Data.bind", "bound", "e3.input", "dataset"],
    description: "The data + series canvas, minimally — one raw source bound from e3, grouped into blocks in one data step, and one `Plan.series.*` entry per block, the list the layout",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The source, bound from e3 — its rows are what the dataset holds.
            const ops = $.let(Data.bind(planSeriesOps));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // Hierarchy is the DATA's (#822): one `groupToDicts` groups the rows
            // into the canvas's blocks — each machine under its line, the crews
            // under one "Crews" block. An entry of the result holds its rows.
            const blocks = $.let(ops.read().groupToDicts(
                ($, r) => r.kind.hasTag("crew").ifElse(() => "Crews", () => r.line),
                ($, _r, k) => k));
            const Block = DictType(StringType, SeriesOpsRow);
            // The series — real East values bound in the body, typed by the
            // constructor. The list IS the layout: one block per series, top to
            // bottom. The accessors are where raw fields become canvas vocabulary:
            // labels, quantity displays and chip text all derive CLIENT-SIDE,
            // inside each series' `derive`.
            const series = $.const([
                // One row per line, its machines stepped down into
                // (`Plan.children`) and their runs rolled up into its bands —
                // which sum the runs' quantities, unit by unit.
                Plan.series.span(Block, {
                    key: "lines", title: "Lines",
                    match: (_b, name) => name.equal("Crews").not(),
                    label: (_b, name) => name,
                    runs: _b => [],
                    rollup: "union",
                    children: Plan.children((b) => b, [
                        Plan.series.span(SeriesOpsRow, {
                            key: "machines", title: "Machines",
                            match: r => r.kind.hasTag("machine"),
                            label: (_r, k) => k, id: true,
                            runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                                key: j.batch, start: j.start, end: j.end,
                                label: East.str`RUN · ${j.batch}`,
                                // A quantity is one value: the bar prints `96 t`,
                                // and the line's band sums the tonnes.
                                quantity: Plan.quantity(j.tonnes, { unit: "t", format: Format.Number({ maximumFractionDigits: 0n }) }),
                                state: j.state,
                            })),
                        }),
                    ]),
                }),
                // One strip per matching block — here the one "Crews" block,
                // wearing its member count.
                Plan.series.group(Block, {
                    key: "crews", title: "Crews",
                    match: (_b, name) => name.equal("Crews"),
                    label: (_b, name) => name,
                    children: Plan.children((b) => b, [
                        Plan.series.cards(SeriesOpsRow, {
                            key: "crew-shifts", title: "Crew shifts",
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
                }),
                Plan.series.rows(Block, { key: "chrome", title: "Milestones", subtitle: "one-off chrome" },
                    [Plan.events({ key: "ms", label: "Milestones", id: true, marks: [
                        Plan.mark({ key: "kick", at: week(28n), kind: "milestone", label: "KICKOFF" }),
                        Plan.mark({ key: "rel", at: week(33n), kind: "milestone", label: "REL 2.4" }),
                    ] })]),
            ], ArrayType(Plan.Types.Series(Block)));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            return (
                <Plan.View
                    axis={axis}
                    data={blocks}
                    series={series}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planLiteralRows — the kind factories: rows no dataset holds
// ============================================================================

/** A machine's job — its batch, window and lifecycle state. */
export const LiteralJob = StructType({ batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });
/** A machine — its jobs. */
export const LiteralMachine = StructType({ jobs: ArrayType(LiteralJob) });
/** The machines dataset. */
export const planLiteralMachines = e3.input("plan_literal_machines", DictType(StringType, LiteralMachine), variant("value", new Map([
    ["L1-M03", { jobs: [{ batch: "B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) }] }],
    ["L1-M04", { jobs: [{ batch: "B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) }] }],
])));

export const planLiteralRows = example({
    keywords: [
        "Plan", "span", "Plan.span", "literal", "rows", "series.rows", "chrome", "one-off",
        "kind factory", "subtree", "nested", "parent", "rollup", "union", "bands", "run", "layout",
        "Data.bind", "bound", "e3.input",
    ],
    description: "Literal rows — `Plan.span` builds a one-off subtree (a shutdown parent rolling up two trades' runs) that `Plan.series.rows` places beside the series over a source bound from e3",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const machines = $.let(Data.bind(planLiteralMachines));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            return (
                <Plan.View
                    axis={axis}
                    data={machines}
                    series={[
                        Plan.series.span(LiteralMachine, {
                            key: "machines", title: "Machines",
                            label: (_r, k) => k, id: true,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.batch, start: j.start, end: j.end,
                                label: East.str`RUN · ${j.batch}`, state: j.state,
                            })),
                        }),
                        // Rows no dataset holds — the planned shutdown, written out once.
                        // `Plan.span` nests: the parent DECLARES its rollup and the canvas
                        // derives the band from its two rows' runs. The series list is the
                        // layout, so this block sits below the machines.
                        Plan.series.rows(LiteralMachine, { key: "works", title: "Planned works", subtitle: "literal rows" }, [
                            Plan.span({
                                key: "shutdown", label: "Shutdown", rollup: "union", rows: [
                                    Plan.span({ key: "elec", label: "Electrical", runs: [
                                        Plan.run({ key: "iso", start: week(33n), end: week(34n), label: "ISOLATE", state: "confirmed" }),
                                    ] }),
                                    Plan.span({ key: "mech", label: "Mechanical", runs: [
                                        Plan.run({ key: "reline", start: week(34n), end: week(36n), label: "RELINE", state: "recommended" }),
                                    ] }),
                                ],
                            }),
                        ]),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planPick — the series library, minimally (#590)
// ============================================================================

/** A machine's job — its batch, window and lifecycle state. */
export const PickJob = StructType({ batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });
/** A row of the ops dataset — a machine's jobs, or a line's load cells. */
export const PickOpsRow = StructType({ series: StringType, jobs: ArrayType(PickJob), cells: ArrayType(Plan.Types.HeatCell) });
/** The ops dataset — two machines and a line's fortnightly load. */
export const planPickOps = e3.input("plan_pick_ops", DictType(StringType, PickOpsRow), variant("value", new Map([
    ["L1-M03", { series: "machines", cells: [],
                 jobs: [{ batch: "B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) }] }],
    ["L1-M04", { series: "machines", cells: [],
                 jobs: [{ batch: "B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) }] }],
    ["L2-load", { series: "load", jobs: [], cells: [
        { at: variant("time", new Date("2026-06-29T00:00:00Z")), value: some(46.0), label: none },
        { at: variant("time", new Date("2026-07-13T00:00:00Z")), value: some(58.0), label: none },
        { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(66.0), label: none },
        { at: variant("time", new Date("2026-08-10T00:00:00Z")), value: some(72.0), label: none },
        { at: variant("time", new Date("2026-08-24T00:00:00Z")), value: some(84.0), label: none },
        { at: variant("time", new Date("2026-09-07T00:00:00Z")), value: some(96.0), label: none },
    ] }],
])));

export const planPick = example({
    keywords: [
        "Plan", "pick", "Plan.pick", "Pick", "library", "panel", "series", "hidden",
        "toggle", "eye", "show", "hide", "choose", "persisted", "Reactive", "State", "#590",
        "Data.bind", "bound", "e3.input",
    ],
    description: "The series library, minimally — `Plan.pick` binds which series show, and `<Plan.View pick>` mounts the library beside a canvas over a source bound from e3",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const ops = $.let(Data.bind(planPickOps));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // Every series that COULD show — the library lists these, and the
            // canvas shows the ones switched on in this order.
            const all = $.const([
                Plan.series.span(PickOpsRow, {
                    key: "machines", title: "Machine jobs", subtitle: "one row per machine",
                    match: r => r.series.equal("machines"),
                    label: (_r, k) => k, id: true,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.batch, start: j.start, end: j.end,
                        label: East.str`RUN · ${j.batch}`, state: j.state,
                    })),
                }),
                Plan.series.heat(PickOpsRow, {
                    key: "load", title: "Line load", subtitle: "% per fortnight",
                    match: r => r.series.equal("load"),
                    label: (_r, k) => k,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                }),
            ], ArrayType(Plan.Types.Series(PickOpsRow)));
            // The handle is STATE — which series are switched off, persisted
            // under its key: the viewer's own. "load" starts off.
            const shown = $.let(Plan.pick("ex.plan.pick", all, { hidden: ["load"] }));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            // `pick` REPLACES `series`: the canvas shows the picked series and
            // mounts the library itself, so nothing else is wired.
            return (
                <Plan.View
                    axis={axis}
                    data={ops}
                    pick={shown}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planLibraryDnd — the pickable series library over every row kind
// ============================================================================

/** A job, its label already composed. */
export const LibraryJob = StructType({
    key: StringType, label: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** A dock allocation. */
export const LibraryAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
/** A crew shift, its label already composed. */
export const LibraryShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
});
/**
 * ONE flat source (the `planExpand` shape): `pick` names the series that
 * claims the row, and every other channel is empty for the series that do not
 * use it. `readings` are fortnightly from W27. A program holds its members
 * (`members`), so the entry type is recursive.
 */
export const LibraryOpsRow = RecursiveType((self) => StructType({
    pick: StringType, label: StringType,
    jobs: ArrayType(LibraryJob),
    readings: ArrayType(FloatType),
    allocs: ArrayType(LibraryAlloc),
    nums: ArrayType(Plan.Types.TableCell),
    shifts: ArrayType(LibraryShift),
    marks: ArrayType(Plan.Types.EventMark),
    members: DictType(StringType, self),
}));

/** The ops dataset — every row kind, twice for two of them, sections' members
 *  and two programs. The keys are the entries' identities; the LAYOUT is the
 *  series list (#822). */
export const planLibraryOps = e3.input("plan_library_ops", DictType(StringType, LibraryOpsRow), variant("value", new Map([
    ["util", { pick: "util", label: "Util %", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
      allocs: [], nums: [], shifts: [], marks: [], members: new Map() }],
    // ONE asset, THREE views — the `views` series below gives each machine a
    // jobs row, a utilisation chart and a tonnes table, from these channels;
    // nothing about the row is duplicated.
    ["m03", { pick: "machines", label: "L1-M03",
      jobs: [{ key: "b214", label: "RUN · B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) }],
      readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0], allocs: [],
      nums: [
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(96.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(88.0), text: none, tone: none },
      ], shifts: [], marks: [], members: new Map() }],
    ["m04", { pick: "machines", label: "L1-M04",
      jobs: [{ key: "b208", label: "RUN · B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) }],
      readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0], allocs: [],
      nums: [
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(112.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(-24.0), text: none, tone: none },
      ], shifts: [], marks: [], members: new Map() }],
    // SAME KIND as the machines' jobs, different entry — a kind is not an
    // identity, which is why the library keys on `key`.
    ["c01", { pick: "contract", label: "CON-01",
      jobs: [{ key: "c1", label: "RUN · C-1", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), state: variant("confirmed", null) }],
      readings: [], allocs: [], nums: [], shifts: [], marks: [], members: new Map() }],
    ["load", { pick: "load", label: "L2 load", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
      allocs: [], nums: [], shifts: [], marks: [], members: new Map() }],
    ["qual", { pick: "quality", label: "Quality", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
      allocs: [], nums: [], shifts: [], marks: [], members: new Map() }],
    ["dock2", { pick: "docks", label: "Dock 2", jobs: [], readings: [],
      allocs: [
          { key: "a1", at: new Date("2026-07-06T00:00:00Z"), state: variant("confirmed", null) },
          { key: "a2", at: new Date("2026-07-27T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ], nums: [], shifts: [], marks: [], members: new Map() }],
    ["desp", { pick: "table", label: "Despatch t", jobs: [], readings: [], allocs: [],
      nums: [
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(128.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-20T00:00:00Z")), value: some(-96.0), text: none, tone: none },
      ], shifts: [], marks: [], members: new Map() }],
    ["crewA", { pick: "cards", label: "Crew A", jobs: [], readings: [], allocs: [], nums: [],
      shifts: [
          { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), label: "80h", state: variant("confirmed", null) },
          { key: "s2", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), label: "+64h", state: variant("proposed", variant("recommended", null)) },
      ], marks: [], members: new Map() }],
    ["ms", { pick: "events", label: "Milestones", jobs: [], readings: [], allocs: [], nums: [], shifts: [],
      marks: [
          { key: "k", at: variant("time", new Date("2026-07-13T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
          { key: "a", at: variant("time", new Date("2026-08-17T00:00:00Z")), kind: variant("exception", null), icon: none, label: some("AUDIT") },
      ], members: new Map() }],
    // Members of the three sections — each section lays its series out under
    // its header.
    ["m11", { pick: "gspan", label: "L3-M11",
      jobs: [{ key: "b301", label: "RUN · B-301", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), state: variant("confirmed", null) }],
      readings: [], allocs: [], nums: [], shifts: [], marks: [], members: new Map() }],
    ["m12", { pick: "gspan", label: "L3-M12",
      jobs: [{ key: "b302", label: "RUN · B-302", start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-31T00:00:00Z"), state: variant("actual", null) }],
      readings: [], allocs: [], nums: [], shifts: [], marks: [], members: new Map() }],
    ["l4", { pick: "gheat", label: "L4 load", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
      allocs: [], nums: [], shifts: [], marks: [], members: new Map() }],
    ["d5", { pick: "gbuckets", label: "Dock 5", jobs: [], readings: [],
      allocs: [{ key: "a3", at: new Date("2026-08-10T00:00:00Z"), state: variant("confirmed", null) }],
      nums: [], shifts: [], marks: [], members: new Map() }],
    // Two PROGRAMS, each holding its runs — one strip per program, its members
    // nested in it.
    ["Program A", { pick: "programs", label: "Program A", jobs: [], readings: [], allocs: [], nums: [], shifts: [], marks: [],
      members: new Map([
          ["p1", { pick: "programs", label: "PR-A1", readings: [], allocs: [], nums: [], shifts: [], marks: [], members: new Map(),
                   jobs: [{ key: "p1", label: "RUN · P-1", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), state: variant("confirmed", null) }] }],
          ["p2", { pick: "programs", label: "PR-A2", readings: [], allocs: [], nums: [], shifts: [], marks: [], members: new Map(),
                   jobs: [{ key: "p2", label: "RUN · P-2", start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-09-07T00:00:00Z"), state: variant("proposed", variant("recommended", null)) }] }],
      ]) }],
    ["Program B", { pick: "programs", label: "Program B", jobs: [], readings: [], allocs: [], nums: [], shifts: [], marks: [],
      members: new Map([
          ["p3", { pick: "programs", label: "PR-B1", readings: [], allocs: [], nums: [], shifts: [], marks: [], members: new Map(),
                   jobs: [{ key: "p3", label: "RUN · P-3", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), state: variant("actual", null) }] }],
      ]) }],
])));

export const planLibraryDnd = example({
    keywords: [
        "Plan", "data", "series", "library", "Pick", "pick", "Panel", "pickItems", "hidden",
        "toggle", "eye", "kind icon", "group", "section", "views", "nested", "children", "rows",
        "chrome", "span", "buckets", "chart", "heat", "table", "cards", "events", "duplicate",
        "same entity", "multiple views", "adjacent", "seek", "layout", "order",
        "Reactive", "State", "#590", "Data.bind", "bound", "e3.input",
    ],
    description: "The series library across every row kind over a source bound from e3 — duplicate kinds, sections, a group per entry, and a `views` series showing one asset three ways",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const ops = $.let(Data.bind(planLibraryOps));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            // A row's fortnightly readings from W27, as a chart's points and as
            // heat cells printing their values.
            const points = $.const(East.function([ArrayType(FloatType)], ArrayType(MeasureRow), ($, readings) =>
                East.Array.generate(readings.size(), MeasureRow, (_$, i) => ({ week: week(i.multiply(2n).add(27n)), pct: readings.get(i) }))));
            const cells = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), ($, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$, i) => ({
                    at: Plan.at.time(week(i.multiply(2n).add(27n))),
                    value: some(readings.get(i)),
                    label: some(East.Float.printFixed(readings.get(i), 0n)),
                }))));

            // The whole library, in layout order: every kind once, two kinds
            // TWICE, a views series, three sections each wrapping a different
            // kind, a group per entry, and literal chrome. Fourteen entries,
            // eleven distinct arms.
            const all = $.const([
                // Literal one-off chrome — it names itself, so it can be
                // switched off like anything else.
                Plan.series.rows(LibraryOpsRow, { key: "chrome", title: "Section header", subtitle: "literal chrome" },
                    [Plan.events({ key: "hdr", label: "Plan", id: true })]),
                Plan.series.chart(LibraryOpsRow, {
                    key: "util", title: "Utilisation", subtitle: "% per fortnight",
                    match: r => r.pick.equal("util"),
                    label: r => r.label, id: true, height: "spark",
                    layers: r => [Chart.Column(points(r.readings), { x: p => p.week, y: p => p.pct })],
                }),
                // ── THE SAME ASSET, SEEN THREE WAYS ───────────────────────
                // A `views` series gives each machine one row per member
                // series, ADJACENT and in this order — its jobs, its
                // utilisation, its tonnes — and a seek on a machine lands on
                // its first view row. Each row's id is its member series and
                // the machine's key, so all three are addressable apart.
                Plan.series.views(LibraryOpsRow, {
                    key: "machines", title: "Machines", subtitle: "one asset, three views",
                    match: r => r.pick.equal("machines"),
                }, [
                    Plan.series.span(LibraryOpsRow, {
                        key: "machine-jobs", title: "Machine jobs",
                        label: r => r.label, id: true,
                        runs: r => r.jobs.map((_$, j) => Plan.run({
                            key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                        })),
                    }),
                    // The label stays the ASSET — all three rows are the same
                    // machine, and pretending otherwise would hide that. What
                    // distinguishes them is the VIEW, which is what the gutter
                    // sub-line is for.
                    Plan.series.chart(LibraryOpsRow, {
                        key: "machine-util", title: "Machine · utilisation",
                        label: r => r.label, stacked: true, sub: _r => some("utilisation %"), height: "spark",
                        layers: r => [Chart.Line(points(r.readings), { x: p => p.week, y: p => p.pct })],
                    }),
                    Plan.series.table(LibraryOpsRow, {
                        key: "machine-tonnes", title: "Machine · tonnes",
                        label: r => r.label, stacked: true, sub: _r => some("tonnes · plan Δ"),
                        cells: r => r.nums,
                        format: Format.Number({ maximumFractionDigits: 0n }),
                    }),
                ]),
                Plan.series.span(LibraryOpsRow, {
                    key: "contract", title: "Contractor jobs", subtitle: "same KIND, own entry",
                    match: r => r.pick.equal("contract"),
                    label: r => r.label, id: true,
                    runs: r => r.jobs.map((_$, j) => Plan.run({
                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                    })),
                }),
                Plan.series.heat(LibraryOpsRow, {
                    key: "load", title: "Line load", subtitle: "% per fortnight",
                    match: r => r.pick.equal("load"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(cells(r.readings), { min: 0, max: 100 }),
                }),
                Plan.series.heat(LibraryOpsRow, {
                    key: "quality", title: "Quality index", subtitle: "same KIND, own entry",
                    match: r => r.pick.equal("quality"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(cells(r.readings), { min: 0, max: 100 }),
                }),
                Plan.series.buckets(LibraryOpsRow, {
                    key: "docks", title: "Dock allocations", subtitle: "tiles per bucket",
                    match: r => r.pick.equal("docks"),
                    label: r => r.label,
                    events: r => r.allocs.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                }),
                Plan.series.table(LibraryOpsRow, {
                    key: "table", title: "Despatch tonnes", subtitle: "per bucket",
                    match: r => r.pick.equal("table"),
                    label: r => r.label,
                    cells: r => r.nums,
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(LibraryOpsRow, {
                    key: "cards", title: "Crew shifts", subtitle: "assignments",
                    match: r => r.pick.equal("cards"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) =>
                        Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
                }),
                Plan.series.events(LibraryOpsRow, {
                    key: "events", title: "Milestones", subtitle: "instant marks",
                    match: r => r.pick.equal("events"),
                    label: r => r.label, id: true,
                    marks: r => r.marks,
                }),
                // SECTIONS — each wrapping a DIFFERENT kind. A section is the
                // unit a person picks — "Line 3" — and switching it off takes
                // its whole block with it, because its members are built by its
                // own `derive`.
                //
                // The metas are terse because the gutter is 168px and truncates
                // the title if the meta crowds it.
                Plan.series.section(LibraryOpsRow, { key: "line3", title: "Line 3", subtitle: "a section of spans", meta: "span" },
                    [
                        Plan.series.span(LibraryOpsRow, {
                            key: "gspan", title: "Line 3 jobs", subtitle: "member",
                            match: r => r.pick.equal("gspan"),
                            label: r => r.label, id: true,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                            })),
                        }),
                    ]),
                Plan.series.section(LibraryOpsRow, { key: "loads", title: "Load", subtitle: "a section of heat", meta: "heat" },
                    [
                        Plan.series.heat(LibraryOpsRow, {
                            key: "gheat", title: "Load rows", subtitle: "member",
                            match: r => r.pick.equal("gheat"),
                            label: r => r.label,
                            cells: r => Plan.heatCells(cells(r.readings), { min: 0, max: 100 }),
                        }),
                    ]),
                Plan.series.section(LibraryOpsRow, { key: "dock-group", title: "Docks", subtitle: "a section of buckets", meta: "buckets" },
                    [
                        Plan.series.buckets(LibraryOpsRow, {
                            key: "gbuckets", title: "Dock rows", subtitle: "member",
                            match: r => r.pick.equal("gbuckets"),
                            label: r => r.label,
                            events: r => r.allocs.map((_$, a) => Plan.event({ key: a.key, at: a.at, state: a.state })),
                        }),
                    ]),
                // One strip PER PROGRAM, its runs nested in the program's entry
                // — and ONE library entry for all of them.
                Plan.series.group(LibraryOpsRow, {
                    key: "programs", title: "Programs", subtitle: "one strip per program",
                    match: r => r.pick.equal("programs"),
                    label: r => r.label,
                    children: Plan.children((r) => r.members, [
                        Plan.series.span(LibraryOpsRow, {
                            key: "program-runs", title: "Program runs", subtitle: "member",
                            label: r => r.label, id: true,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                            })),
                        }),
                    ]),
                }),
            ], ArrayType(Plan.Types.Series(LibraryOpsRow)));

            // The library lists every series by title, subtitle and kind; the
            // only option is which start switched off — the viewer's own
            // state. There are no row counts (#822): a count means something
            // only when every entry is in hand.
            const shown = $.let(Plan.pick("ex.plan.library", all, {
                hidden: ["quality", "cards", "dock-group"],
            }));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            // `pick` REPLACES `series`: the handle already carries the list, so
            // the canvas feeds itself the picked ones and mounts the library.
            // Nothing here wires the panel to the canvas.
            return (
                <Plan.View
                    axis={axis}
                    data={ops}
                    pick={shown}
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

/** A job, its label already composed. */
export const DropJob = StructType({
    key: StringType, label: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** A dock allocation. */
export const DropAlloc = StructType({ key: StringType, at: DateTimeType, state: EventStateType });
/** A crew shift, its label already composed. */
export const DropShift = StructType({
    key: StringType, from: DateTimeType, to: DateTimeType, label: StringType, state: EventStateType,
});
/** One flat row of the ops record — `series` names the series that claims it;
 *  `readings` are fortnightly from W27. */
export const DropOpsRow = StructType({
    series: StringType, label: StringType,
    jobs: ArrayType(DropJob),
    readings: ArrayType(FloatType),
    allocs: ArrayType(DropAlloc),
    nums: ArrayType(Plan.Types.TableCell),
    shifts: ArrayType(DropShift),
    marks: ArrayType(Plan.Types.EventMark),
});

/**
 * The ops RECORD a drop drafts and Apply commits to — its initial state the
 * genesis commit. The droppable and inert kinds interleave, and the Line 3
 * machine is a section's member.
 */
export const planDropOps = e3.record("plan_drop_ops", DictType(StringType, DropOpsRow), new Map([
    ["util",  { series: "util", label: "Util %", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
                allocs: [], nums: [], shifts: [], marks: [] }],
    ["m03",   { series: "mach", label: "L1-M03", readings: [], allocs: [], nums: [], shifts: [], marks: [],
                jobs: [{ key: "b214", label: "RUN · B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) }] }],
    ["m04",   { series: "mach", label: "L1-M04", readings: [], allocs: [], nums: [], shifts: [], marks: [],
                jobs: [{ key: "b208", label: "RUN · B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("confirmed", null) }] }],
    ["load",  { series: "load", label: "L2 load", jobs: [], readings: [46.0, 58.0, 66.0, 72.0, 84.0, 96.0],
                allocs: [], nums: [], shifts: [], marks: [] }],
    ["dock2", { series: "dock", label: "Dock 2", jobs: [], readings: [], nums: [], shifts: [], marks: [],
                allocs: [{ key: "a1", at: new Date("2026-07-13T00:00:00Z"), state: variant("confirmed", null) }] }],
    ["desp",  { series: "table", label: "Despatch t", jobs: [], readings: [], allocs: [], shifts: [], marks: [],
                nums: [
                    { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(128.0), text: none, tone: none },
                    { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(-96.0), text: none, tone: none },
                ] }],
    ["crewA", { series: "crew", label: "Crew A", jobs: [], readings: [], allocs: [], nums: [], marks: [],
                shifts: [{ key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), label: "80h", state: variant("confirmed", null) }] }],
    ["ms",    { series: "strm", label: "Milestones", jobs: [], readings: [], allocs: [], nums: [], shifts: [],
                marks: [{ key: "k", at: variant("time", new Date("2026-07-13T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") }] }],
    // A section MEMBER — the header itself takes no drops, but the span row
    // under it receives like any other span row.
    ["m11",   { series: "gmach", label: "L3-M11", readings: [], allocs: [], nums: [], shifts: [], marks: [],
                jobs: [{ key: "b301", label: "RUN · B-301", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), state: variant("confirmed", null) }] }],
]));

/** The ops record's patch door — every Apply commits through it. */
export const planDropOpsPatch = e3.mutation.patch(planDropOps);

/** A card in the palette — a thing a row of its family takes. */
export const DropCard = StructType({
    key: StringType, name: StringType, family: StringType, note: StringType, icon: StringType,
});

/** The palette's cards. */
export const planDropCards = e3.input("plan_drop_cards", ArrayType(DropCard), variant("value", [
    { key: "job-weld",  name: "Weld cell",   family: "job",       note: "job · machines",      icon: "gear" },
    { key: "job-cure",  name: "Cure oven",   family: "job",       note: "job · machines",      icon: "fire" },
    { key: "dlv-truck", name: "Truck 12",    family: "delivery",  note: "delivery · docks",    icon: "truck" },
    { key: "shf-night", name: "Night shift", family: "shift",     note: "shift · crews",       icon: "moon" },
    { key: "mst-audit", name: "Audit gate",  family: "milestone", note: "milestone · streams", icon: "flag" },
    // Belongs to no family, so no row accepts it — the ⊘ stage everywhere,
    // which is what a card with nowhere to go looks like.
    { key: "pallet",    name: "PALLET",      family: "none",      note: "fits nowhere",        icon: "box" },
]));

/**
 * A Plan is a drag target, and a heterogeneous one — which is what makes it
 * different from every other target in the grammar.
 *
 * Roster, Board and Blend have ONE kind of cell, so "can you drop here" is a
 * question about the cell's contents. A Plan's rows are nine different things,
 * so the question is answered at three levels:
 *
 *  1. **Structurally, by series.** A card lands only on a row whose series
 *     declares `edit` — WHERE it lands (`items`, the entry's list the row's
 *     elements come from) and HOW it becomes one (`create`, from the drop: the
 *     card, the row and the bucket's instant). Only the kinds holding discrete
 *     scheduled objects can — `span` (runs), `buckets` (tiles), `events`
 *     (marks), `cards` (chips). A `chart` / `heat` / `table` row renders
 *     DERIVED values, and section headers and group strips are wayfinding:
 *     they register no cell and never light up during a drag.
 *  2. **By policy, with `canDrop`.** Of the rows that can receive, this canvas
 *     admits only the matching FAMILY: a job goes on a machine, a delivery on
 *     a dock, a shift on a crew, a milestone on a stream. The `PALLET` card
 *     belongs to no family and is therefore refused everywhere — the ⊘ stage
 *     on every row, which is what a card with nowhere to go should look like.
 *  3. **As a draft (#880).** A drop is a gesture of the editing session: the
 *     entry is drafted with the new item in its list and its rows derived
 *     again — drawn at once with the pending mark, undone with ⌘Z — and Apply
 *     writes every draft as ONE checked batch, one commit through the
 *     record's patch door (`Record.onApply`).
 *
 * The canvas is bounded shorter than its rows, so the Line 3 machine starts
 * below the fold: a card held at the canvas's bottom edge scrolls it there
 * (#608). A card is also a keyboard control — Space picks it up, the arrows
 * carry it from row to row and along a row's buckets, Space drops it and
 * Escape cancels — and every step is said to a screen reader.
 */
export const planRowDrop = example({
    keywords: [
        "Plan", "Library", "DnD", "drag", "drop", "canDrop", "sources", "id", "edit", "items", "create",
        "add", "target", "surface", "cell", "slot", "row kind", "selective", "veto",
        "invalid", "span", "buckets", "events", "cards", "chart", "heat", "table", "section", "row id", "row text",
        "droppable", "inert", "bucket instant", "editing", "onApply", "onPatch", "draft", "Apply", "undo",
        "Plan.Types.PatchEvent", "Reactive", "State", "re-derive", "#880",
        "auto-scroll", "keyboard", "screen reader", "announcements", "#608",
        "Record", "Record.bind", "Record.onApply", "e3.record", "patch", "commit", "Data.bindPaged", "Data.bind",
    ],
    description: "Library + Plan DnD over an e3 record — a card lands only on a series that declares `edit`, `canDrop` admits only the matching family, and every drop is a draft applied as one checked batch, one commit through the record's patch door",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The source is a RECORD: the canvas pages it, and each Apply is
            // one commit through its patch door.
            const ops = $.let(Data.bindPaged(planDropOps));
            const record = $.let(Record.bind(planDropOps, [planDropOpsPatch]));
            // The palette the cards come from.
            const cards = $.let(Data.bind(planDropCards));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            // A row's fortnightly readings from W27, as a chart's points and as
            // heat cells printing their values.
            const points = $.const(East.function([ArrayType(FloatType)], ArrayType(MeasureRow), ($, readings) =>
                East.Array.generate(readings.size(), MeasureRow, (_$, i) => ({ week: week(i.multiply(2n).add(27n)), pct: readings.get(i) }))));
            const cells = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), ($, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$, i) => ({
                    at: Plan.at.time(week(i.multiply(2n).add(27n))),
                    value: some(readings.get(i)),
                    label: some(East.Float.printFixed(readings.get(i), 0n)),
                }))));
            // Everything a drop creates is a PROPOSAL — it is a suggestion the
            // host has not committed, and the lifecycle is how the canvas says so.
            const ADDED = variant("proposed", variant("added", null));

            // ── The two policy tables the host owns ───────────────────────
            // Which FAMILY of card each row will take. A drop cell names its
            // row by the canonical TEXT of the row's id — the series that made
            // it and the path of keys to it — so the table is keyed by that
            // text. A row absent from this map takes nothing — which is how
            // the inert kinds would behave even if they did register a cell.
            const rowAccepts = $.const(new Map([
                [East.print(Plan.ref("mach", "m03")), "job"],
                [East.print(Plan.ref("mach", "m04")), "job"],
                [East.print(Plan.ref("gmach", "m11")), "job"],
                [East.print(Plan.ref("dock", "dock2")), "delivery"],
                [East.print(Plan.ref("crew", "crewA")), "shift"],
                [East.print(Plan.ref("strm", "ms")), "milestone"],
            ]), DictType(StringType, StringType));
            const palette = $.let(cards.read());
            const cardFamily = $.let(palette.toDict((_$, c) => c.key, (_$, c) => c.family));
            const cardName = $.let(palette.toDict((_$, c) => c.key, (_$, c) => c.name));

            // ── The drop veto ────────────────────────────────────────────
            // Consulted with the candidate event the pointer's CURRENT bucket
            // would produce, so the ⊘ appears while dragging rather than after,
            // and once more before the drop becomes a draft. Only `add` reaches
            // a Plan from a library, and refusing the rest says so.
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

            // ── The session ──────────────────────────────────────────────
            // Every drop is a DRAFT of the entry it landed on: the canvas
            // draws the new item at once, marked pending, and the history bar
            // undoes, redoes, discards and applies it. Apply commits every
            // draft to the record as one checked batch; `onPatch` hears each
            // gesture as it is made, into a log the viewer keeps.
            const lastBind = $.let(State.bind([StringType], "ex.plan.lastdrop", "none yet"));
            const onPatch = $.const(East.function([Plan.Types.PatchEvent(DropOpsRow)], NullType, ($, event) => {
                $(lastBind.write(East.str`${event.origin.getTag()} · ${event.label}`));
            }));
            const last = $.let(lastBind.read());

            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
            }));
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="plan-library"
                        data={palette}
                        item={c => ({ key: c.key, label: c.name, sublabel: c.note, icon: c.icon })}
                    />
                    <Plan.View
                        axis={axis}
                        data={ops}
                        // The DnD target role: `id` names this surface in every
                        // cell ref, `sources` says which palettes it will take
                        // from, and `canDrop` is the policy. A drop becomes a
                        // draft of the session — without `editing` no card
                        // lands, since nothing could hold it.
                        id="ops-plan"
                        sources={["plan-library"]}
                        canDrop={canDrop}
                        editing={{ onApply: Record.onApply(record, { keyed: true }), onPatch }}
                        series={[
                            // INERT — a chart plots a derived series, so there
                            // is nothing a card could become here.
                            Plan.series.chart(DropOpsRow, {
                                key: "util", title: "Utilisation",
                                match: r => r.series.equal("util"),
                                label: r => r.label, id: true, height: "spark",
                                layers: r => [Chart.Line(points(r.readings), { x: p => p.week, y: p => p.pct })],
                            }),
                            // RECEIVES — runs are discrete scheduled objects. A
                            // dropped job joins the machine's `jobs`: a
                            // fortnight long, from the bucket the pointer named.
                            Plan.series.span(DropOpsRow, {
                                key: "mach", title: "Machine jobs",
                                match: r => r.series.equal("mach"),
                                label: r => r.label, id: true,
                                runs: r => r.jobs.map((_$, j) => Plan.run({
                                    key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                                })),
                                edit: {
                                    items: "jobs",
                                    create: (drop, r) => ({
                                        key: East.str`drop-${drop.from.key}-${East.print(r.jobs.size())}`,
                                        label: cardName.get(drop.from.key),
                                        start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addWeeks(2n),
                                        state: ADDED,
                                    }),
                                },
                            }),
                            // INERT — an intensity field has no object to add to.
                            Plan.series.heat(DropOpsRow, {
                                key: "load", title: "Line load",
                                match: r => r.series.equal("load"),
                                label: r => r.label,
                                cells: r => Plan.heatCells(cells(r.readings), { min: 0, max: 100 }),
                            }),
                            // RECEIVES — a dropped delivery becomes a tile in
                            // the bucket under the pointer.
                            Plan.series.buckets(DropOpsRow, {
                                key: "dock", title: "Dock allocations",
                                match: r => r.series.equal("dock"),
                                label: r => r.label,
                                events: r => r.allocs.map((_$, a) =>
                                    Plan.event({ key: a.key, at: a.at, state: a.state })),
                                edit: {
                                    items: "allocs",
                                    create: (drop, r) => ({
                                        key: East.str`drop-${drop.from.key}-${East.print(r.allocs.size())}`,
                                        at: drop.at.unwrap("time"), state: ADDED,
                                    }),
                                },
                            }),
                            // INERT — the cells are computed numbers.
                            Plan.series.table(DropOpsRow, {
                                key: "table", title: "Despatch tonnes",
                                match: r => r.series.equal("table"),
                                label: r => r.label,
                                cells: r => r.nums,
                                format: Format.Number({ maximumFractionDigits: 0n }),
                            }),
                            // RECEIVES — a dropped shift becomes a chip.
                            Plan.series.cards(DropOpsRow, {
                                key: "crew", title: "Crew shifts",
                                match: r => r.series.equal("crew"),
                                label: r => r.label,
                                chips: r => r.shifts.map((_$, s) => Plan.chip({
                                    key: s.key, from: s.from, to: s.to, label: s.label, state: s.state,
                                })),
                                edit: {
                                    items: "shifts",
                                    create: (drop, r) => ({
                                        key: East.str`drop-${drop.from.key}-${East.print(r.shifts.size())}`,
                                        from: drop.at.unwrap("time"), to: drop.at.unwrap("time").addWeeks(2n),
                                        label: cardName.get(drop.from.key), state: ADDED,
                                    }),
                                },
                            }),
                            // RECEIVES — a dropped milestone becomes a mark at
                            // the instant, the one kind with no duration.
                            Plan.series.events(DropOpsRow, {
                                key: "strm", title: "Milestones",
                                match: r => r.series.equal("strm"),
                                label: r => r.label, id: true,
                                marks: r => r.marks,
                                edit: {
                                    items: "marks",
                                    create: (drop, r) => ({
                                        key: East.str`drop-${drop.from.key}-${East.print(r.marks.size())}`,
                                        at: drop.at, kind: variant("milestone", null), icon: none,
                                        label: some(cardName.get(drop.from.key)),
                                    }),
                                },
                            }),
                            // The HEADER is inert; the span row under it is not.
                            Plan.series.section(DropOpsRow, { key: "line3", title: "Line 3", meta: "span" }, [
                                Plan.series.span(DropOpsRow, {
                                    key: "gmach", title: "Line 3 machine jobs",
                                    match: r => r.series.equal("gmach"),
                                    label: r => r.label, id: true,
                                    runs: r => r.jobs.map((_$, j) => Plan.run({
                                        key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                                    })),
                                    edit: {
                                        items: "jobs",
                                        create: (drop, r) => ({
                                            key: East.str`drop-${drop.from.key}-${East.print(r.jobs.size())}`,
                                            label: cardName.get(drop.from.key),
                                            start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addWeeks(2n),
                                            state: ADDED,
                                        }),
                                    },
                                }),
                            ]),
                        ]}
                        // Shorter than its rows: the last ones start below the
                        // fold, and a card held at the bottom edge scrolls there.
                        style={{ height: "300px" }}
                    />
                    <Text.MonoLabel>{East.str`LAST GESTURE · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planFill — the bounded sizing isolate (#320 / #567 D1)
// ============================================================================

/** One fortnightly reading of a unit's measure. */
export const FillPoint = StructType({ week: DateTimeType, pct: FloatType });
/** A unit — its line, the kind its row draws, its run and its readings. */
export const FillUnit = StructType({
    line: StringType, series: StringType,
    sub: OptionType(StringType),
    start: DateTimeType, end: DateTimeType, tonnes: FloatType,
    points: ArrayType(FillPoint),
    cells: ArrayType(Plan.Types.HeatCell),
});

/** How many units the canvas virtualizes — a small authored constant;
 *  {@link planFillUnits} makes the rows. */
export const planFillUnitCount = e3.input("plan_fill_unit_count", IntegerType, variant("value", 200n));

/**
 * The units, generated from their count — the row count is the point. The KEYS
 * sort as written (`UNIT-1000` … `UNIT-1199`) rather than lexicographically
 * (`UNIT-1`, `UNIT-10`, `UNIT-100`, …), and a line's rows keep that order.
 *
 * `line` is the grouping level: 8 strips of 25, so a single collapse takes an
 * eighth of the list out of the virtualizer at once.
 *
 * Everything else here exists to make the row heights DISAGREE, which is the
 * case a virtualizer gets wrong. `series` cycles span / chart / heat (32 / 32 /
 * 28px), `sub` alternates so every other row floors at the 42px two-line
 * gutter, and the strips add another height again — so consecutive estimates
 * differ in both directions and no constant can stand in for `estimateSize`.
 */
export const generateFillUnits = East.function([IntegerType], DictType(StringType, FillUnit), ($, count) => {
    // Monday of ISO week n, 2026 (W1 Monday = 2025-12-29).
    const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
        const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
        return w1.addWeeks(n.subtract(1n));
    }));
    return East.Array.range(0n, count).toDict(
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
                points: East.Array.generate(6n, FillPoint, (_$, j) => ({
                    week: week(j.multiply(2n).add(27n)),
                    pct: j.multiply(17n).add(i).remainder(60n).toFloat().add(40.0),
                })),
                cells: East.Array.generate(6n, Plan.Types.HeatCell, (_$, j) => ({
                    at: Plan.at.time(week(j.multiply(2n).add(27n))),
                    value: some(j.multiply(13n).add(i).remainder(100n).toFloat()),
                    label: none,
                })),
            };
        });
});

/** The task that generates the units — its output is the dataset the canvas reads. */
export const planFillUnits = e3.task("plan_fill_units", [planFillUnitCount], generateFillUnits);

/** Fill (#320) — `height="fill"` resolves against the bounded Box and
 *  virtualizes 200 rows of mixed kinds under 8 line strips. The bound must land
 *  on the canvas WRAPPER: a percentage passed inward resolves against an
 *  auto-height parent, computes to `auto`, and silently unbinds — the frame
 *  reports bounded, renders its spacer, and never scrolls (#567 D1).
 *
 *  The grouping is here for what it does to VIRTUALIZATION, not for the
 *  chrome. Collapsing a strip removes its 25 children from the virtualizer's
 *  item list, so `count` and the total size change while the scroll offset does
 *  not — the case where an estimate that disagrees with the rendered height
 *  shows up as drift or a jumping scrollbar. The strips also give the list
 *  another row height again, so the `estimateSize` path is exercised rather
 *  than a single constant. The 200 units are a dataset an `e3.task` generates
 *  from their count — made where data is made, never written into the package. */
export const planFill = example({
    keywords: ["Plan", "fill", "height", "maxHeight", "#320", "virtual", "virtualization", "bounded", "Box", "scroll", "sizing", "data", "series", "span", "chart", "heat", "spark", "sub", "two-line", "mixed", "variable", "estimateSize", "group", "groupToDicts", "grouping", "data step", "views", "interleave", "Plan.children", "collapse", "parent", "Data.bind", "bound", "e3.task", "generated"],
    description: "Fill sizing over variable row heights — 200 virtualized rows of mixed kinds an e3 task generates, under 8 line strips",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const units = $.let(Data.bind(planFillUnits));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open).
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // Grouping is a DATA step (#822): one `groupToDicts` makes each line an
            // entry holding its 25 units.
            const lines = $.let(units.read().groupToDicts(($, u) => u.line, ($, _u, k) => k));
            const LineGroup = DictType(StringType, FillUnit);
            // ONE strip per line, its units stepped down into. A `views` series
            // gives each unit the ONE row its kind's member draws, so within a
            // strip the kinds interleave in the units' order — a block per kind
            // would bank the tall rows together again.
            const series = $.const([
                Plan.series.group(LineGroup, {
                    key: "lines", title: "Lines",
                    label: (_g, line) => line,
                    children: Plan.children((g) => g, [
                        Plan.series.views(FillUnit, { key: "units", title: "Units" }, [
                            Plan.series.span(FillUnit, {
                                key: "unit-span", title: "Span",
                                match: r => r.series.equal("span"),
                                label: (_r, k) => k, id: true, sub: r => r.sub,
                                runs: (r, k) => [Plan.run({
                                    key: k, start: r.start, end: r.end,
                                    label: East.str`RUN · ${k}`,
                                    quantity: Plan.quantity(r.tonnes, { unit: "t", format: Format.Number({ maximumFractionDigits: 0n }) }),
                                    state: variant("confirmed", null),
                                })],
                            }),
                            // Heat rows are 28px — shorter than everything around them.
                            Plan.series.heat(FillUnit, {
                                key: "unit-heat", title: "Heat",
                                match: r => r.series.equal("heat"),
                                label: (_r, k) => k, id: true, sub: r => r.sub,
                                cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
                            }),
                            // Four chart heights. `height` is a SERIES declaration,
                            // not a per-row accessor, so distinct heights mean
                            // distinct members — which is the point here: a spark,
                            // then three EXPANDED rows several times taller,
                            // scattered through the same unit order.
                            Plan.series.chart(FillUnit, {
                                key: "unit-spark", title: "Spark",
                                match: r => r.series.equal("spark"),
                                label: (_r, k) => k, id: true, sub: r => r.sub,
                                height: "spark", expandable: true,
                                layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                            }),
                            Plan.series.chart(FillUnit, {
                                key: "unit-chart-m", title: "Chart · medium",
                                match: r => r.series.equal("chartM"),
                                label: (_r, k) => k, id: true, sub: r => r.sub,
                                height: Plan.fixed("72px"),
                                layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })],
                            }),
                            Plan.series.chart(FillUnit, {
                                key: "unit-chart-l", title: "Chart · large",
                                match: r => r.series.equal("chartL"),
                                label: (_r, k) => k, id: true, sub: r => r.sub,
                                height: "expanded",
                                layers: r => [Chart.Area(r.points, { x: p => p.week, y: p => p.pct })],
                            }),
                            Plan.series.chart(FillUnit, {
                                key: "unit-chart-xl", title: "Chart · x-large",
                                match: r => r.series.equal("chartXL"),
                                label: (_r, k) => k, id: true, sub: r => r.sub,
                                height: "expanded", expandedHeight: "140px",
                                layers: r => [Chart.Column(r.points, { x: p => p.week, y: p => p.pct })],
                            }),
                        ]),
                    ]),
                }),
            ], ArrayType(Plan.Types.Series(LineGroup)));
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            return (
                <Box height="240px">
                    <Plan.View axis={axis} data={lines} series={series} style={{ height: "fill" }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planReview — the review chrome, and what a verdict is FOR (#569)
// ============================================================================

/** A job — its window, its tonnage, whether it is flagged, and the verdict:
 *  what the reviewer decides about it is a FIELD of the job. */
export const ReviewJob = StructType({
    start: DateTimeType, end: DateTimeType, tonnes: FloatType, flagged: BooleanType,
    approval: ApprovalStateType,
});

/** The jobs under review — a RECORD: a verdict drafts a job with `approval`
 *  changed, and Apply commits the drafts to it. */
export const planReviewJobs = e3.record("plan_review_jobs", DictType(StringType, ReviewJob), new Map([
    ["L1-M03", { start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), tonnes: 96.0,  flagged: true,  approval: variant("pending", null) }],
    ["L1-M04", { start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), tonnes: 112.0, flagged: true,  approval: variant("approved", null) }],
    ["L1-M07", { start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), tonnes: 64.0,  flagged: true,  approval: variant("rejected", null) }],
    ["L2-M11", { start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), tonnes: 88.0,  flagged: false, approval: variant("approved", null) }],
]));

/** The jobs' patch door — every Apply commits through it. */
export const planReviewJobsPatch = e3.mutation.patch(planReviewJobs);

/** Rerun — a fresh proposal: every job's verdict back to what its flag derives
 *  ("clean rests pre-approved, flagged awaits an explicit call"). */
export const planReviewRerun = e3.mutation.reduce("rerun", planReviewJobs,
    East.function([DictType(StringType, ReviewJob)], DictType(StringType, ReviewJob), (_$, jobs) =>
        jobs.map((_$2, j) => ({
            start: j.start, end: j.end, tonnes: j.tonnes, flagged: j.flagged,
            approval: deriveApproval(j.flagged).unwrap("some"),
        }))));

/**
 * Review as drafts (#880): a verdict is a FIELD of the record the reviewer
 * decides about — `approval`, an `ApprovalStateType` — and the series whose
 * rows are reviewed names it (`review: { verdict: "approval" }`). Approve or
 * Reject on a row, and Approve all / Reject all at the foot, draft the entries
 * with the field changed: the canvas derives the drafted rows again at once —
 * buttons, bar, dot and run — marked pending, the history bar undoes, redoes
 * and discards them, and Apply commits them to the record as one checked batch,
 * through its patch door. The foot's summary is the HOST's, over what it holds:
 * the committed record, which moves only when Apply lands.
 */
export const planReview = example({
    keywords: [
        "Plan", "review", "approval", "approve", "reject", "verdict", "decision", "ApprovalStateType",
        "deriveApproval", "flagged", "chrome", "batch", "foot", "Approve all", "Reject all", "onRerun",
        "editing", "onApply", "draft", "pending", "Apply", "undo", "redo", "discard", "Reactive",
        "derived", "accessor", "data", "row id", "#880",
        "Record", "Record.bind", "Record.onApply", "e3.record", "e3.mutation.reduce", "patch", "commit", "Data.bindPaged",
    ],
    description: "Review as drafts over an e3 record — a verdict drafts the job's `approval` field, the canvas re-derives buttons, bar and dot from the draft, Apply commits the batch through the record's patch door, and Rerun is a mutation of the record",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The jobs are a RECORD: the canvas pages it, and each Apply is
            // one commit through its patch door.
            const jobs = $.let(Data.bindPaged(planReviewJobs));
            const record = $.let(Record.bind(planReviewJobs, [planReviewJobsPatch, planReviewRerun]));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));

            // Rerun is not a verdict — it asks for a fresh proposal, so it stays
            // a callback, and writes the RECORD through its own mutation. Drafts
            // made before it sit over a record that moved, and say so.
            const onRerun = $.const(East.function([], NullType, ($) => {
                $(record.mutate.rerun());
            }));

            const series = $.const([
                Plan.series.span(ReviewJob, {
                    key: "jobs", title: "Jobs",
                    label: (_r, k) => k, id: true,
                    value: r => some(East.str`${East.Float.printFixed(r.tonnes, 0n)} t`),
                    // The verdict's FIELD: the decision buttons show it, and a
                    // verdict drafts the job with it changed.
                    review: { verdict: "approval" },
                    // ...and the SAME field drives the bar and the dot, because
                    // appearance is derived like everything else. Click Approve
                    // and the draft repaints — the chrome never touched it.
                    status: r => r.approval.hasTag("rejected").ifElse(
                        () => some(variant("danger", null)),
                        () => r.flagged.and(_$ => r.approval.hasTag("pending")).ifElse(
                            () => some(variant("warning", null)),
                            () => none)),
                    runs: (r, k) => [Plan.run({
                        key: k, start: r.start, end: r.end,
                        label: East.str`RUN · ${k}`,
                        quantity: Plan.quantity(r.tonnes, { unit: "t", format: Format.Number({ maximumFractionDigits: 0n }) }),
                        state: r.approval.hasTag("approved").ifElse(
                            () => variant("confirmed", null),
                            () => r.approval.hasTag("rejected").ifElse(
                                () => variant("rejected", null),
                                () => variant("proposed", variant("recommended", null)))),
                    })],
                }),
            ], ArrayType(Plan.Types.Series(ReviewJob)));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
            }));
            // The host's summary reads what it holds — the committed jobs.
            const saved = $.let(record.read());
            const pending = $.let(saved.filter((_$, j) => j.approval.hasTag("pending")).size());
            const rejected = $.let(saved.filter((_$, j) => j.approval.hasTag("rejected")).size());
            return (
                <Plan.View
                    axis={axis}
                    data={jobs}
                    series={series}
                    review={{
                        summary: <Text>{East.str`SAVED · ${East.Float.printFixed(pending.toFloat(), 0n)} PENDING · ${East.Float.printFixed(rejected.toFloat(), 0n)} REJECTED`}</Text>,
                        onRerun,
                    }}
                    editing={{ onApply: Record.onApply(record, { keyed: true }) }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planEditing — every change a draft, one checked Apply (#880, #825)
// ============================================================================

/** A job on a machine. */
export const EditJob = StructType({
    key: StringType, label: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** A machine — the verdict on it, and its jobs. */
export const EditMachine = StructType({ approval: ApprovalStateType, jobs: ArrayType(EditJob) });
/** A line — its name, and its machines. */
export const EditLine = StructType({ name: StringType, machines: DictType(StringType, EditMachine) });

/** The lines — a RECORD every gesture drafts and Apply commits to. M11 already
 *  holds four jobs, so one more is refused. */
export const planEditingLines = e3.record("plan_editing_lines", DictType(StringType, EditLine), new Map([
    ["L1", { name: "Line 1", machines: new Map([
        ["M03", { approval: variant("pending", null), jobs: [
            { key: "b214", label: "B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
        ] }],
        ["M04", { approval: variant("approved", null), jobs: [
            { key: "b208", label: "B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("confirmed", null) },
            { key: "b219", label: "B-219", start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
        ] }],
    ]) }],
    ["L2", { name: "Line 2", machines: new Map([
        ["M11", { approval: variant("pending", null), jobs: [
            { key: "b241", label: "B-241", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-13T00:00:00Z"), state: variant("confirmed", null) },
            { key: "b244", label: "B-244", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
            { key: "b247", label: "B-247", start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
            { key: "b250", label: "B-250", start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
        ] }],
    ]) }],
]));

/** The lines' patch door — every Apply commits through it. */
export const planEditingLinesPatch = e3.mutation.patch(planEditingLines);

/** A card in the palette the jobs come from. */
export const EditCard = StructType({ key: StringType, name: StringType, note: StringType, icon: StringType });

/** The palette's cards. */
export const planEditingCards = e3.input("plan_editing_cards", ArrayType(EditCard), variant("value", [
    { key: "weld", name: "Weld run", note: "two weeks", icon: "gear" },
    { key: "cure", name: "Cure run", note: "two weeks", icon: "fire" },
]));

/**
 * The Plan's editing session (#880) — the Sheet's, over the canvas's entries.
 *
 * The source holds LINES, each holding its machines. A machine is reviewed
 * (its `approval` field), receives dropped jobs (its `jobs` list) and has its
 * jobs moved and resized, and every gesture lands on the MACHINE rows, one
 * level down — yet each drafts the LINE, the source's top-level entry, which
 * the whole subtree rides in:
 *
 *  - Approve / Reject on a machine, and Approve all / Reject all at the foot,
 *    draft its `approval` (`review: { verdict: "approval" }` on the machines).
 *  - A job card dropped on a machine drafts a new job in its `jobs` at the
 *    bucket's instant (`edit: { items: "jobs", create }`).
 *  - A job's run moves along its machine or onto another machine, and resizes
 *    by either end (#825): the series names the job's key and the instant
 *    fields a move writes (`key`, `start`, `end`). It moves in whole weeks, or
 *    in days with Shift held. A move onto a machine of the other line takes
 *    the job out of one line and puts it into the other, as one gesture over
 *    both. From the keyboard, Space on a focused run picks it up: ←/→ move it
 *    a week, Shift+←/→ its end, Alt+←/→ its start, ↑/↓ carry it to another
 *    machine, and Space drops it.
 *
 * Every gesture is one transaction, drawn at once with the pending mark; the
 * toolbar's history bar undoes, redoes and discards it (so do ⌘Z and ⌘⇧Z).
 * `ready` is the author's check over a drafted line: a machine holding more
 * than four jobs is refused, by name, and Apply waits until it is fixed — M11
 * already holds four, so a job moved onto it holds Apply until one leaves.
 * The lines are an e3 record: Apply commits the batch to it through its patch
 * door (`Record.onApply`), and `onPatch` hears each gesture as it is made.
 */
export const planEditing = example({
    keywords: [
        "Plan", "editing", "session", "draft", "drafts", "transaction", "onApply", "onPatch", "ready",
        "Readiness", "Editing.Types.Readiness", "invalid", "review", "verdict", "approval", "ApprovalStateType",
        "Approve all", "Reject all", "edit", "items", "create", "drop", "Library", "DnD", "id", "sources",
        "undo", "redo", "discard", "Apply", "history bar", "pending", "nested", "children", "Plan.children",
        "top-level entry", "Plan.Types.PatchEvent", "Reactive", "State", "#880",
        "move", "resize", "drag", "run", "key", "start", "end", "Shift", "snap", "keyboard", "Space",
        "cross-row", "Plan.Types.Move", "#825",
        "Record", "Record.bind", "Record.onApply", "e3.record", "patch", "commit", "Data.bindPaged",
    ],
    description: "The Plan's editing session over an e3 record — verdicts, dropped jobs and moved or resized runs on nested machine rows draft their line (both lines when a job changes line), the history bar undoes and applies them as one commit, and `ready` refuses a crowded machine",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The lines are a RECORD: the canvas pages it, and each Apply is
            // one commit through its patch door.
            const lines = $.let(Data.bindPaged(planEditingLines));
            const record = $.let(Record.bind(planEditingLines, [planEditingLinesPatch]));
            // The palette the jobs come from.
            const cards = $.let(Data.bind(planEditingCards));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // What a drop creates is a proposal the host has not committed.
            const ADDED = variant("proposed", variant("added", null));
            const palette = $.let(cards.read());
            const cardName = $.let(palette.toDict((_$, c) => c.key, (_$, c) => c.name));

            // The author's check over one drafted LINE — every check of the
            // batch runs in one call. A refusal names the machine.
            const ready = $.const(East.function([EditLine, StringType], Editing.Types.Readiness, ($, line, _key) => {
                const crowded = $.let(line.machines.filter((_$, m) => m.jobs.size().greater(4n)));
                const result = $.let(variant("ready", null), Editing.Types.Readiness);
                $.if(crowded.size().greater(0n), ($) => {
                    $.assign(result, variant("invalid", crowded.toArray((_$, m, k) => ({
                        field: "jobs", message: East.str`${k} holds ${East.print(m.jobs.size())} jobs — at most 4`,
                    }))));
                });
                return result;
            }));
            // Every gesture, as it is made — a verdict, a drop, an undo — into
            // a log the viewer keeps.
            const lastBind = $.let(State.bind([StringType], "ex.plan.editing.last", "none yet"));
            const onPatch = $.const(East.function([Plan.Types.PatchEvent(EditLine)], NullType, ($, event) => {
                $(lastBind.write(East.str`${event.origin.getTag()} · ${event.label}`));
            }));
            const last = $.let(lastBind.read());

            // The host's summary reads what it holds — the committed lines.
            const saved = $.let(record.read());
            const pending = $.let(saved.toArray((_$, l) => l.machines.filter((_$, m) => m.approval.hasTag("pending")).size()).sum());
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
            }));
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="plan-editing-jobs"
                        data={palette}
                        item={c => ({ key: c.key, label: c.name, sublabel: c.note, icon: c.icon })}
                    />
                    <Plan.View
                        axis={axis}
                        data={lines}
                        id="plan-editing"
                        sources={["plan-editing-jobs"]}
                        series={[
                            // One row per line, its machines stepped down into
                            // through a plain field — which is what lets a
                            // gesture on a machine write back into its line.
                            Plan.series.span(EditLine, {
                                key: "lines", title: "Lines",
                                label: l => l.name,
                                runs: _l => [],
                                rollup: "union",
                                children: Plan.children(l => l.machines, [
                                    Plan.series.span(EditMachine, {
                                        key: "machines", title: "Machines",
                                        label: (_m, k) => k, id: true,
                                        review: { verdict: "approval" },
                                        status: m => m.approval.hasTag("rejected").ifElse(
                                            () => some(variant("danger", null)),
                                            () => none),
                                        runs: m => m.jobs.map((_$, j) => Plan.run({
                                            key: j.key, start: j.start, end: j.end,
                                            label: East.str`RUN · ${j.label}`, state: j.state,
                                        })),
                                        edit: {
                                            items: "jobs",
                                            // A run moves and resizes: the job is
                                            // found by `key` — the run's own key —
                                            // and a move writes `start` and `end`.
                                            // Keys stay unique on a machine: a drop
                                            // or a move that would repeat one is
                                            // refused, so the new job's key names
                                            // its card, bucket and place.
                                            key: "key", start: "start", end: "end",
                                            create: (drop, m) => ({
                                                key: East.str`${drop.from.key}-${East.print(drop.at.unwrap("time"))}-${East.print(m.jobs.size())}`,
                                                label: cardName.get(drop.from.key),
                                                start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addWeeks(2n),
                                                state: ADDED,
                                            }),
                                        },
                                    }),
                                ]),
                            }),
                        ]}
                        review={{
                            summary: <Text>{East.str`SAVED · ${East.print(pending)} PENDING`}</Text>,
                        }}
                        editing={{ onApply: Record.onApply(record, { keyed: true }), onPatch, ready }}
                        style={{ height: "360px" }}
                    />
                    <Text.MonoLabel>{East.str`LAST GESTURE · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planUiState — the interaction state, held by the host (#824)
// ============================================================================

/** A machine's job. */
export const UiJob = StructType({ key: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });
/** A machine — its line, and its jobs. */
export const UiMachine = StructType({ line: StringType, jobs: ArrayType(UiJob) });

/** The machines of three lines. */
export const planUiMachines = e3.input("plan_ui_machines", DictType(StringType, UiMachine), variant("value", new Map([
    ["L1-M03", { line: "Line 1", jobs: [{ key: "b214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("in-progress", null) }] }],
    ["L1-M04", { line: "Line 1", jobs: [{ key: "b208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) }] }],
    ["L2-M11", { line: "Line 2", jobs: [{ key: "b241", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), state: variant("confirmed", null) }] }],
    ["L2-M12", { line: "Line 2", jobs: [{ key: "b198", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), state: variant("proposed", variant("recommended", null)) }] }],
    ["L3-M21", { line: "Line 3", jobs: [{ key: "b301", start: new Date("2026-07-27T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), state: variant("confirmed", null) }] }],
    ["L3-M22", { line: "Line 3", jobs: [{ key: "b302", start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-09-07T00:00:00Z"), state: variant("proposed", variant("recommended", null)) }] }],
])));

/**
 * A bound `ui` state (#824): the canvas's selection, the rows folded or opened
 * against what they declare, the expanded charts, and a row to bring into
 * view — held by the HOST, in `State.bind` at `Plan.Types.UiState`, seeded by
 * `Plan.uiState(…)`: the viewer's own state, beside data bound from e3. The
 * canvas reads it and writes the user's actions back; anything else may write
 * it too. Here a picker beside the canvas brings a machine into view (`focus`
 * — the canvas opens the line it sits in, scrolls to it and spends the
 * request) and selects it, three buttons fold, open and expand from outside,
 * and a readout says what the state holds — including whatever the user
 * clicked on the canvas itself.
 */
export const planUiState = example({
    keywords: [
        "Plan", "ui", "UiState", "Plan.uiState", "state", "bound", "State", "bind", "controlled",
        "selected", "selection", "collapsed", "expanded", "fold", "open", "charts", "focus",
        "scroll to row", "deep link", "external", "write back", "Reactive", "Select", "Button", "#824",
        "Data.bind", "e3.input",
    ],
    description: "A bound ui state over machines bound from e3 — the host selects a machine and brings it into view, folds and opens lines and expands a chart from outside, and reads back what the user did on the canvas",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const machines = $.let(Data.bind(planUiMachines));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            const fleet = $.let(machines.read());
            const lines = $.let(fleet.groupToDicts(($, m) => m.line, ($, _m, k) => k));
            const LineGroup = DictType(StringType, UiMachine);
            const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$, i) => ({
                week: week(i.add(27n)), pct: i.multiply(13n).remainder(9n).toFloat().add(88.0),
            })));
            const series = $.const([
                Plan.series.rows(LineGroup, { key: "kpi", title: "Coverage" }, [
                    Plan.chart({
                        key: "coverage", label: "Coverage", id: true, height: "spark", expandable: true,
                        layers: [Chart.Line(coverage, { x: p => p.week, y: p => p.pct })],
                    }),
                ]),
                Plan.series.group(LineGroup, {
                    key: "lines", title: "Lines",
                    label: (_g, line) => line,
                    children: Plan.children((g) => g, [
                        Plan.series.span(UiMachine, {
                            key: "machines", title: "Machines",
                            label: (_m, k) => k, id: true,
                            runs: m => m.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end, label: East.str`RUN · ${j.key}`, state: j.state,
                            })),
                        }),
                    ]),
                }),
            ], ArrayType(Plan.Types.Series(LineGroup)));
            // The STATE — Line 3 starts folded. Every row is named by its id:
            // a line is `Plan.ref("lines", line)`, a machine
            // `Plan.ref("machines", line, machine)`.
            const ui = $.let(State.bind([Plan.Types.UiState], "ex.plan.ui",
                Plan.uiState({ collapsed: [Plan.ref("lines", "Line 3")] })));
            const now = $.let(ui.read());
            const lineIds = $.let(lines.toArray((_$, _g, line) => Plan.ref("lines", line)));
            const kpi = $.const(Plan.ref("kpi", "coverage"));
            // Bring a machine into view: select it, and REQUEST its focus — the
            // canvas opens its line if it is folded, scrolls to it, and clears
            // the request once it has.
            const goTo = $.const(East.function([StringType], NullType, ($, key) => {
                const s = $.let(ui.read());
                const id = $.let(Plan.ref("machines", fleet.get(key).line, key));
                $(ui.write(East.value({
                    selected: some(id), collapsed: s.collapsed, expanded: s.expanded, charts: s.charts, focus: some(id),
                }, Plan.Types.UiState)));
            }));
            const foldAll = $.const(East.function([], NullType, ($) => {
                const s = $.let(ui.read());
                $(ui.write(East.value({
                    selected: s.selected, collapsed: lineIds, expanded: [], charts: s.charts, focus: s.focus,
                }, Plan.Types.UiState)));
            }));
            const openAll = $.const(East.function([], NullType, ($) => {
                const s = $.let(ui.read());
                $(ui.write(East.value({
                    selected: s.selected, collapsed: [], expanded: lineIds, charts: s.charts, focus: s.focus,
                }, Plan.Types.UiState)));
            }));
            const noCharts = $.const([], ArrayType(Plan.Types.RowId));
            const kpiChart = $.const([kpi], ArrayType(Plan.Types.RowId));
            const chart = $.const(East.function([], NullType, ($) => {
                const s = $.let(ui.read());
                const charts = $.let(s.charts.size().greater(0n).ifElse(() => noCharts, () => kpiChart));
                $(ui.write(East.value({
                    selected: s.selected, collapsed: s.collapsed, expanded: s.expanded, charts, focus: s.focus,
                }, Plan.Types.UiState)));
            }));
            // The picker's machines are the dataset's own keys.
            const keys = $.let(fleet.toArray((_$, _m, k) => k));
            const picked = $.let(now.selected.match({
                some: (_$, id) => East.print(id),
                none: (_$) => "nothing",
            }), StringType);
            const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
            return (
                <VStack gap="2" align="stretch">
                    <HStack gap="2">
                        <Select value="L3-M22" onChange={goTo} size="sm"
                            items={keys.map((_$, k) => Select.Item(k, East.str`Go to ${k}`))} />
                        <Button size="xs" onClick={foldAll}>Fold lines</Button>
                        <Button size="xs" onClick={openAll}>Open lines</Button>
                        <Button size="xs" onClick={chart}>Coverage chart</Button>
                    </HStack>
                    <Plan.View axis={axis} data={lines} series={series} ui={ui} style={{ height: "300px" }} />
                    <Text.MonoLabel>{East.str`SELECTED · ${picked} · ${East.print(now.collapsed.size())} FOLDED · ${East.print(now.expanded.size())} OPENED`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** A job, its label already composed. */
export const ExpandJob = StructType({
    key: StringType, label: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** One weekly reading of a measure. */
export const ExpandMeasure = StructType({ week: DateTimeType, pct: FloatType });
/** ONE raw source; `series` picks the series and `expand` is per-row DATA —
 *  presence is what grows the ⤢ control on that row. */
export const ExpandOpsRow = StructType({
    series: StringType,
    label: StringType,
    expand: OptionType(Plan.Types.Expand),
    jobs: ArrayType(ExpandJob),
    points: ArrayType(ExpandMeasure),
    cells: ArrayType(Plan.Types.HeatCell),
    nums: ArrayType(Plan.Types.TableCell),
    marks: ArrayType(Plan.Types.EventMark),
});

/** The rows — one of each kind that collapses differently, W27–W38. */
export const planExpandOps = e3.input("plan_expand_ops", DictType(StringType, ExpandOpsRow), variant("value", new Map([
    // A CHART row — the one kind whose marks are a VALUE scale. Its plot, its
    // gutter ticks and its ref-label gate answer to the band the marks keep at
    // the top, not to the grown row (#591).
    ["COVERAGE", { series: "chart", label: "Coverage",
      expand: some({ height: some("150px"), axis: variant("keep", null) }),
      jobs: [], cells: [], nums: [], marks: [],
      points: [
          { week: new Date("2026-06-29T00:00:00Z"), pct: 96.1 }, { week: new Date("2026-07-06T00:00:00Z"), pct: 96.4 }, { week: new Date("2026-07-13T00:00:00Z"), pct: 96.8 },
          { week: new Date("2026-07-20T00:00:00Z"), pct: 97.0 }, { week: new Date("2026-07-27T00:00:00Z"), pct: 96.2 }, { week: new Date("2026-08-03T00:00:00Z"), pct: 95.1 },
          { week: new Date("2026-08-10T00:00:00Z"), pct: 93.4 }, { week: new Date("2026-08-17T00:00:00Z"), pct: 91.0 }, { week: new Date("2026-08-24T00:00:00Z"), pct: 88.9 },
          { week: new Date("2026-08-31T00:00:00Z"), pct: 91.4 }, { week: new Date("2026-09-07T00:00:00Z"), pct: 93.8 }, { week: new Date("2026-09-14T00:00:00Z"), pct: 94.2 },
      ] }],
    // axis: keep — the grid and now-line run THROUGH the render.
    ["L1-M03", { series: "span", label: "L1-M03",
      expand: some({ height: some("168px"), axis: variant("keep", null) }),
      jobs: [
          { key: "b208", label: "RUN · B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) },
          { key: "qc", label: "QC", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), state: variant("confirmed", null) },
          { key: "b231", label: "RUN · B-231", start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-09-14T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ], points: [], cells: [], nums: [], marks: [] }],
    // axis: dim — washed to 40% behind a dense render.
    ["L1-M04", { series: "span", label: "L1-M04",
      expand: some({ height: some("140px"), axis: variant("dim", null) }),
      jobs: [
          { key: "b214", label: "RUN · B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), state: variant("in-progress", null) },
      ], points: [], cells: [], nums: [], marks: [] }],
    // No declaration — no control. The contrast is the point: one row that
    // cannot be expanded beside five that can.
    ["L1-M07", { series: "span", label: "L1-M07", expand: none,
      jobs: [
          { key: "hld", label: "HLD · B-197", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), state: variant("actual", null) },
      ], points: [], cells: [], nums: [], marks: [] }],
    // The kinds that COLLAPSE differently — heat keeps its ramp, the table
    // re-encodes its numerals, the marks keep their silhouettes.
    ["LOAD", { series: "heat", label: "Line load",
      expand: some({ height: some("132px"), axis: variant("keep", null) }),
      jobs: [], points: [], nums: [], marks: [],
      cells: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), value: some(46.0), label: some("46") },
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(58.0), label: some("58") },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), value: some(66.0), label: some("66") },
          { at: variant("time", new Date("2026-07-20T00:00:00Z")), value: some(72.0), label: some("72") },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(84.0), label: some("84") },
          { at: variant("time", new Date("2026-08-03T00:00:00Z")), value: some(90.0), label: some("90") },
          { at: variant("time", new Date("2026-08-10T00:00:00Z")), value: some(96.0), label: some("96") },
          { at: variant("time", new Date("2026-08-17T00:00:00Z")), value: none, label: none },
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), value: some(92.0), label: some("92") },
      ] }],
    // axis: off — the render draws its own canvas, so the shared lines are
    // suppressed INSIDE this row only (the ruler never moves).
    ["DESPATCH", { series: "table", label: "Despatch t",
      expand: some({ height: some("120px"), axis: variant("off", null) }),
      jobs: [], points: [], cells: [], marks: [],
      nums: [
          { at: variant("time", new Date("2026-06-29T00:00:00Z")), value: some(128.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-06T00:00:00Z")), value: some(134.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-13T00:00:00Z")), value: some(119.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-20T00:00:00Z")), value: some(-96.0), text: none, tone: none },
          { at: variant("time", new Date("2026-07-27T00:00:00Z")), value: some(-88.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-03T00:00:00Z")), value: none, text: none, tone: none },
          { at: variant("time", new Date("2026-08-10T00:00:00Z")), value: some(151.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-17T00:00:00Z")), value: some(162.0), text: none, tone: none },
          { at: variant("time", new Date("2026-08-24T00:00:00Z")), value: some(144.0), text: none, tone: none },
      ] }],
    ["MILESTONES", { series: "events", label: "Milestones",
      expand: some({ height: some("112px"), axis: variant("dim", null) }),
      jobs: [], points: [], cells: [], nums: [],
      marks: [
          { key: "k", at: variant("time", new Date("2026-07-06T00:00:00Z")), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
          { key: "d", at: variant("time", new Date("2026-07-27T00:00:00Z")), kind: variant("decision", { applied: true }), icon: none, label: none },
          { key: "a", at: variant("time", new Date("2026-08-17T00:00:00Z")), kind: variant("exception", null), icon: none, label: some("AUDIT") },
      ] }],
])));

/**
 * R2 expand-in-place — the one example that shows the whole gesture.
 *
 * Expand is two halves and needs BOTH: a per-row `expand` declaration (data,
 * so it flows through an accessor like every other envelope field) and the
 * ROOT's `expandRender` resolver, which builds the mounted body from the row's
 * id. Neither alone shows the control.
 *
 * The rows here are deliberately heterogeneous — span, chart, heat, table,
 * events — because focusing one is what makes the other five collapse, and
 * each row KIND collapses differently (#591): geometry shrinks, values
 * re-encode as a tone strip, shapes keep their silhouette.
 */
export const planExpand = example({
    keywords: ["Plan", "expand", "expandRender", "expandGutter", "axis", "keep", "dim", "off", "focus", "R2", "collapse", "context strip", "row", "row id", "data", "series", "chart", "heat", "table", "events", "span", "raw", "Data.bind", "bound", "e3.input"],
    description: "Expand-in-place over rows bound from e3 — a row declares `expand`, the root renders plot and gutter, and unfocused rows collapse to strips",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const ops = $.let(Data.bind(planExpandOps));
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            // ONE resolver serves every declaring row, called with the row's id at
            // interaction time. The canvas hands it the PLOT column with the
            // shared grid + now-line drawn behind it — so a component that fills
            // that column edge to edge shares the canvas's x-space and lines up
            // with the buckets above. `Sparkline` is the axis-free chart, which is
            // what makes the alignment visible; a `Chart` would draw its own axes
            // and margins inside the column and align to those instead.
            const util = $.let(East.Array.generate(12n, FloatType, (_$, i) =>
                i.multiply(19n).remainder(48n).toFloat().add(50.0)));
            const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, (_$, _id) => (
                <Sparkline data={util} type="area" color="link" width="100%" height="100%" />
            )));
            // The GUTTER half. An expanded row's gutter cell grows with the row,
            // and what fills the space it opens up is the author's — the identity
            // and measures that only earn their place once the row has the canvas.
            // Same row id as `expandRender`, so it can differ per row.
            // The old spec's drilled-row card, which is what the grown gutter is
            // for: identity lines then a fill meter. The lines need no styling —
            // the gutter body already carries the sub-line vocabulary — so the
            // author writes content, not typography.
            const GutterFacts = StructType({ a: StringType, b: StringType, fill: FloatType });
            const expandGutter = $.const(East.function([Plan.Types.RowId], UIComponentType, ($, id) => {
                const facts = $.const(new Map([
                    ["COVERAGE", { a: "TARGET 100 · MIN 92", b: "BREACH W34–W36 · 3 wk", fill: 0.94 }],
                    ["L1-M03", { a: "120 t · FILL", b: "B-208 · 88 t · 73%", fill: 0.73 }],
                    ["L1-M04", { a: "120 t · FILL", b: "B-214 · 89 t · 74%", fill: 0.74 }],
                    ["LOAD",   { a: "MEAN 74 · PEAK 96", b: "BREACH W33 · 1 wk", fill: 0.96 }],
                    ["DESPATCH", { a: "NET 1 629 t", b: "2 SHORT WEEKS", fill: 0.55 }],
                    ["MILESTONES", { a: "5 MARKS", b: "1 EXCEPTION · W34", fill: 0.2 }],
                ]), DictType(StringType, GutterFacts));
                // A row's id is its series and the path of keys to it — here the
                // entry's one key, which is what the facts are keyed by.
                const f = $.let(facts.get(id.unwrap("entry").path.get(0n)));
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
                <Plan.View
                    axis={Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) })}
                    data={ops}
                    series={[
                        Plan.series.span(ExpandOpsRow, {
                            key: "machines", title: "Machines",
                            match: r => r.series.equal("span"),
                            label: r => r.label, id: true, expand: r => r.expand,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                            })),
                        }),
                        Plan.series.chart(ExpandOpsRow, {
                            key: "coverage", title: "Coverage",
                            match: r => r.series.equal("chart"),
                            label: r => r.label, id: true, expand: r => r.expand,
                            height: "spark",
                            left: { domain: [80, 110], tickValues: [80, 100] },
                            layers: r => [
                                Plan.layer(Chart.Line(r.points, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                                Chart.refLine({ y: 100, label: "TARGET 100" }),
                            ],
                        }),
                        Plan.series.heat(ExpandOpsRow, {
                            key: "load", title: "Line load",
                            match: r => r.series.equal("heat"),
                            label: r => r.label, expand: r => r.expand,
                            cells: r => Plan.heatCells(r.cells, { min: 40.0, max: 100.0 }),
                        }),
                        Plan.series.table(ExpandOpsRow, {
                            key: "despatch", title: "Despatch",
                            match: r => r.series.equal("table"),
                            label: r => r.label, expand: r => r.expand,
                            cells: r => r.nums,
                        }),
                        Plan.series.events(ExpandOpsRow, {
                            key: "milestones", title: "Milestones",
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
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planNarrow — the §10 narrow layout: a phone-width box makes the Plan a
// review tool, not a canvas (#570)
// ============================================================================

/** A despatch order on the narrow canvas's horizon — the rows its slice narrows. */
export const NarrowHorizonRow = StructType({ key: StringType, at: DateTimeType, risk: StringType });

/** How many despatch orders the horizon holds; {@link planNarrowHorizon} makes them. */
export const planNarrowHorizonCount = e3.input("plan_narrow_horizon_count", IntegerType, variant("value", 24n));

/** The horizon's orders, generated from their count — two a week from W27,
 *  every third at risk of running late. */
export const generateNarrowHorizon = East.function([IntegerType], ArrayType(NarrowHorizonRow), ($, count) => {
    // Monday of ISO week 1, 2026.
    const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
    return East.Array.generate(count, NarrowHorizonRow, (_$, i) => ({
        key: East.str`h${East.print(i.add(1n))}`,
        at: w1.addWeeks(i.divide(2n).add(26n)),
        risk: i.remainder(3n).equal(0n).ifElse(() => "late", () => "on-time"),
    }));
});

/** The task that generates the horizon. */
export const planNarrowHorizon = e3.task("plan_narrow_horizon", [planNarrowHorizonCount], generateNarrowHorizon);

/** A job, its label already composed. */
export const NarrowJob = StructType({
    key: StringType, label: StringType,
    start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** The raw rows: `series` picks the series, `line` the line a row belongs to,
 *  and every envelope field is per-row DATA; `load` is weekly from W27. */
export const NarrowOpsRow = StructType({
    series: StringType, line: StringType, label: StringType,
    value: OptionType(StringType), status: OptionType(StatusValueType),
    expand: OptionType(Plan.Types.Expand),
    jobs: ArrayType(NarrowJob),
    load: ArrayType(FloatType),
});

/** Two lines' machines and loads — Line 2 runs hotter, so the Groups tab sorts it first. */
export const planNarrowOps = e3.input("plan_narrow_ops", DictType(StringType, NarrowOpsRow), variant("value", new Map([
    ["L1-M03", { series: "mach", line: "Line 1 · Form", label: "L1-M03",
      value: some("120 t"), status: some(variant("success", null)),
      expand: some({ height: some("140px"), axis: variant("keep", null) }),
      jobs: [
          { key: "b208", label: "RUN · B-208", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), state: variant("actual", null) },
          { key: "qc", label: "QC", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), state: variant("confirmed", null) },
          { key: "b231", label: "RUN · B-231", start: new Date("2026-08-10T00:00:00Z"), end: new Date("2026-09-14T00:00:00Z"), state: variant("proposed", variant("recommended", null)) },
      ], load: [] }],
    ["L1-M04", { series: "mach", line: "Line 1 · Form", label: "L1-M04",
      value: some("120 t"), status: some(variant("warning", null)), expand: none,
      jobs: [
          { key: "b214", label: "RUN · B-214", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), state: variant("in-progress", null) },
      ], load: [] }],
    ["l1-load", { series: "load", line: "Line 1 · Form", label: "Line load",
      value: none, status: none, expand: none, jobs: [],
      load: [39.1, 44.2, 49.3, 51.85, 56.1, 61.2, 66.3, 71.4, 76.5, 81.6, 83.3, 78.2] }],
    ["L2-M11", { series: "mach", line: "Line 2 · Assy", label: "L2-M11",
      value: some("80 t"), status: none, expand: none,
      jobs: [
          { key: "b241", label: "RUN · B-241", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-17T00:00:00Z"), state: variant("confirmed", null) },
      ], load: [] }],
    ["l2-load", { series: "load", line: "Line 2 · Assy", label: "Line load",
      value: none, status: some(variant("warning", null)), expand: none, jobs: [],
      load: [46.0, 52.0, 58.0, 61.0, 66.0, 72.0, 78.0, 84.0, 90.0, 96.0, 98.0, 92.0] }],
])));

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
    keywords: ["Plan", "narrow", "mobile", "phone", "responsive", "compact", "container", "breakpoint", "tabs", "Groups", "Rows", "Measures", "cards", "strip", "hottest", "two-finger", "pan", "review", "cohort", "slice", "§10", "groupToDicts", "raw", "Data.bind", "bound", "e3.input", "e3.task"],
    description: "The narrow layout — a phone-width box turns the same canvas, over a source bound from e3, into a review tool: Groups · Rows · Measures tabs, hottest-first strip cards, rows as cards, charts at expanded density",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(NarrowHorizonRow, {
            fields: { at: { label: "Despatched", format: { date: "MMM D" } }, risk: { label: "Risk", hints: ["late", "on-time"] } },
            rangeFieldId: "at",
        });
        return (<Reactive>{$ => {
            const ops = $.let(Data.bind(planNarrowOps));
            // The slice's own rows — despatch orders a task generates, with a
            // late-risk cohort seeded active, so the chips row has something
            // to say.
            const horizon = $.let(Data.bind(planNarrowHorizon));
            // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
            // A line's weekly load from W27 as heat cells, each printing its value.
            const loadCells = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), ($, load) =>
                East.Array.generate(load.size(), Plan.Types.HeatCell, (_$, i) => ({
                    at: Plan.at.time(week(i.add(27n))), value: some(load.get(i)),
                    label: some(East.Float.printFixed(load.get(i), 0n)),
                }))));
            const covPcts = $.const(
                [96.1, 96.4, 96.8, 97.0, 96.2, 95.1, 93.4, 91.0, 88.9, 91.4, 93.8, 94.2],
                ArrayType(FloatType));
            const coverage = $.let(East.Array.generate(12n, MeasureRow, (_$, i) =>
                ({ week: week(i.add(27n)), pct: covPcts.get(i) })));
            // Grouping is a DATA step (#822): one `groupToDicts` makes each
            // line an entry holding its rows — the strips nest exactly those.
            const lines = $.let(ops.read().groupToDicts(($, r) => r.line, ($, _r, k) => k));
            const LineGroup = DictType(StringType, NarrowOpsRow);
            // A slice range is CLOSED — both ends inclusive — so the twelve
            // weeks W27–W38 end the millisecond before W39.
            const slice = $.let(Slice.bind([NarrowHorizonRow], "ex.plan.narrow", cfg, Slice.state({
                range: some(variant("datetime", { from: week(27n), to: week(39n).addMilliseconds(-1n) })),
                cohorts: [{ id: "late", name: "Late risk", filters: [variant("string", { fieldId: "risk", op: variant("eq", "late") })] }],
                activeCohorts: new Set(["late"]),
            }), horizon.read(), none));
            const series = $.const([
                // The KPI no line holds — a hand-built chart row over the
                // coverage points: it rides the Measures tab and an "Other
                // rows" card.
                Plan.series.rows(LineGroup, { key: "kpi", title: "Coverage" }, [
                    Plan.chart({
                        key: "coverage", label: "Coverage", id: true, value: "94.2%",
                        height: "spark",
                        left: { domain: [80, 110], tickValues: [80, 100] },
                        layers: [
                            Plan.layer(Chart.Line(coverage, { x: p => p.week, y: p => p.pct }), { breach: { below: 92 } }),
                            Chart.refLine({ y: 100, label: "TARGET 100" }),
                        ],
                    }),
                ]),
                // One strip per line, its rows stepped down into; its summary
                // strip is the max of its heat rows — what "hottest first" reads.
                Plan.series.group(LineGroup, {
                    key: "lines", title: "Lines",
                    label: (_g, line) => line,
                    summaryAggregate: "max",
                    children: Plan.children((g) => g, [
                        Plan.series.span(NarrowOpsRow, {
                            key: "mach", title: "Machines",
                            match: r => r.series.equal("mach"),
                            label: r => r.label, id: true,
                            value: r => r.value, status: r => r.status, expand: r => r.expand,
                            runs: r => r.jobs.map((_$, j) => Plan.run({
                                key: j.key, start: j.start, end: j.end, label: j.label, state: j.state,
                            })),
                        }),
                        Plan.series.heat(NarrowOpsRow, {
                            key: "load", title: "Line load",
                            match: r => r.series.equal("load"),
                            label: r => r.label, status: r => r.status,
                            cells: r => Plan.heatCells(loadCells(r.load), { min: 0, max: 100, warnAt: 95 }),
                        }),
                    ]),
                }),
            ], ArrayType(Plan.Types.Series(LineGroup)));
            const util = $.let(East.Array.generate(12n, FloatType, (_$, i) =>
                i.multiply(19n).remainder(48n).toFloat().add(50.0)));
            const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, (_$, _id) => (
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
                    <Plan.View
                        axis={axis}
                        data={lines}
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

/** An order on the horizon — its day (an integer day index) and its line. */
export const NumberHorizonRow = StructType({ key: StringType, day: IntegerType, line: StringType });

/** How many orders the horizon holds; {@link planNumberHorizon} makes them. */
export const planNumberHorizonCount = e3.input("plan_number_horizon_count", IntegerType, variant("value", 24n));

/** The horizon's orders, generated from their count — two a day from day 1,
 *  the lines in turn: twelve days behind an eight-day window. */
export const generateNumberHorizon = East.function([IntegerType], ArrayType(NumberHorizonRow), (_$, count) =>
    East.Array.generate(count, NumberHorizonRow, (_$2, i) => ({
        key: East.str`o${East.print(i.add(1n))}`,
        day: i.divide(2n).add(1n),
        line: i.remainder(2n).equal(0n).ifElse(() => "Line 1", () => "Line 2"),
    })));

/** The task that generates the horizon. */
export const planNumberHorizon = e3.task("plan_number_horizon", [planNumberHorizonCount], generateNumberHorizon);

/** A dock allocation — its day (a plain number), lane and lifecycle state. */
export const NumberAlloc = StructType({ key: StringType, day: FloatType, lane: StringType, state: EventStateType });
/** A job — its days. */
export const NumberJob = StructType({ key: StringType, label: StringType, start: FloatType, end: FloatType, state: EventStateType });
/** A crew shift — its days and hours. */
export const NumberShift = StructType({ key: StringType, from: FloatType, to: FloatType, hours: FloatType, state: EventStateType });
/** A milestone — its day. */
export const NumberMark = StructType({ key: StringType, day: FloatType, label: StringType });
/** A chart point — a day and a value. */
export const NumberPoint = StructType({ day: FloatType, t: FloatType });
/** A table reading — a day and its value. */
export const NumberReading = StructType({ at: FloatType, value: OptionType(FloatType) });
/** RAW rows — every instant is a plain number (a day index). */
export const NumberOpsRow = StructType({
    series: StringType, label: StringType, value: OptionType(StringType), sub: OptionType(StringType),
    allocations: ArrayType(NumberAlloc), jobs: ArrayType(NumberJob), shifts: ArrayType(NumberShift),
    marks: ArrayType(NumberMark), points: ArrayType(NumberPoint), tonnes: ArrayType(NumberReading),
    cells: ArrayType(Plan.Types.HeatCell),
});

/** The rows — the keys are the entries' identities; the series list is the layout. */
export const planNumberOps = e3.input("plan_number_ops", DictType(StringType, NumberOpsRow), variant("value", new Map([
    ["dock2", { series: "dock", label: "Dock 2", value: none, sub: some("load/day"),
      jobs: [], shifts: [], marks: [], points: [], tonnes: [], cells: [],
      allocations: [
          { key: "a1", day: 1.0, lane: "am", state: variant("confirmed", null) },
          { key: "a2", day: 1.0, lane: "pm", state: variant("confirmed", null) },
          { key: "a3", day: 2.0, lane: "am", state: variant("confirmed", null) },
          { key: "a4", day: 3.0, lane: "pm", state: variant("proposed", variant("recommended", null)) },
          { key: "a5", day: 5.0, lane: "am", state: variant("proposed", variant("recommended", null)) },
          { key: "a6", day: 6.0, lane: "pm", state: variant("confirmed", null) },
          { key: "a7", day: 8.0, lane: "am", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["dock5", { series: "dock", label: "Dock 5", value: none, sub: some("load/day"),
      jobs: [], shifts: [], marks: [], points: [], tonnes: [], cells: [],
      allocations: [
          { key: "b1", day: 2.0, lane: "pm", state: variant("confirmed", null) },
          { key: "b2", day: 4.0, lane: "am", state: variant("confirmed", null) },
          { key: "b3", day: 4.0, lane: "pm", state: variant("proposed", variant("recommended", null)) },
          { key: "b4", day: 7.0, lane: "am", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["m03", { series: "mach", label: "L1-M03", value: some("120 t"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], tonnes: [], cells: [],
      jobs: [
          { key: "set", label: "SET", start: 1.0, end: 2.0, state: variant("actual", null) },
          { key: "b214", label: "RUN · B-214", start: 2.0, end: 5.0, state: variant("in-progress", null) },
          { key: "b221", label: "RUN · B-221", start: 6.0, end: 8.0, state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["m04", { series: "mach", label: "L1-M04", value: some("80 t"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], tonnes: [], cells: [],
      jobs: [
          { key: "b208", label: "RUN · B-208", start: 1.0, end: 4.0, state: variant("actual", null) },
          { key: "qc", label: "QC", start: 4.0, end: 5.0, state: variant("confirmed", null) },
          { key: "b231", label: "RUN · B-231", start: 5.0, end: 9.0, state: variant("proposed", variant("recommended", null)) },
      ] }],
    // Heat cells as STORED records — the instant spelled explicitly.
    ["load", { series: "load", label: "Line load", value: none, sub: none,
      allocations: [], jobs: [], shifts: [], marks: [], points: [], tonnes: [],
      cells: [
          { at: variant("number", 1.0), value: some(40.0), label: some("40") },
          { at: variant("number", 2.0), value: some(69.0), label: some("69") },
          { at: variant("number", 3.0), value: some(43.0), label: some("43") },
          { at: variant("number", 4.0), value: some(72.0), label: some("72") },
          { at: variant("number", 5.0), value: some(46.0), label: some("46") },
          { at: variant("number", 6.0), value: some(75.0), label: some("75") },
          { at: variant("number", 7.0), value: some(49.0), label: some("49") },
          { at: variant("number", 8.0), value: some(78.0), label: some("78") },
      ] }],
    ["out", { series: "out", label: "Output · t", value: some("612 t"), sub: none,
      allocations: [], jobs: [], shifts: [], marks: [], tonnes: [], cells: [],
      points: [
          { day: 1.0, t: 60.0 }, { day: 2.0, t: 77.0 }, { day: 3.0, t: 94.0 }, { day: 4.0, t: 71.0 },
          { day: 5.0, t: 88.0 }, { day: 6.0, t: 65.0 }, { day: 7.0, t: 82.0 }, { day: 8.0, t: 99.0 },
      ] }],
    ["desp", { series: "table", label: "Despatch t", value: none, sub: none,
      allocations: [], jobs: [], shifts: [], marks: [], points: [], cells: [],
      tonnes: [
          { at: 1.0, value: some(80.0) }, { at: 2.0, value: some(103.0) }, { at: 3.0, value: some(126.0) }, { at: 4.0, value: some(149.0) },
          { at: 5.0, value: some(102.0) }, { at: 6.0, value: some(125.0) }, { at: 7.0, value: some(148.0) }, { at: 8.0, value: some(101.0) },
      ] }],
    ["crewA", { series: "crew", label: "Crew A", value: none, sub: none,
      allocations: [], jobs: [], marks: [], points: [], tonnes: [], cells: [],
      shifts: [
          { key: "s1", from: 1.0, to: 3.0, hours: 24.0, state: variant("confirmed", null) },
          { key: "s2", from: 3.0, to: 6.0, hours: 36.0, state: variant("confirmed", null) },
          { key: "s3", from: 6.0, to: 8.0, hours: 24.0, state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["ms", { series: "ms", label: "Milestones", value: none, sub: none,
      allocations: [], jobs: [], shifts: [], points: [], tonnes: [], cells: [],
      marks: [
          { key: "kick", day: 2.0, label: "KICKOFF" },
          { key: "rel", day: 6.0, label: "REL" },
      ] }],
])));

/**
 * The `number` axis — the retired Planner's `plannerPoint` canvas on the
 * Plan: eight days at step 1, AM/PM lanes in the bucket rows, `now` at day
 * 5. Every kind positions on the one numeric scale, and every instant in the
 * raw data is a plain number: a `FloatType` field wraps to the `number` arm
 * through the element builders (`Plan.run({ start: j.start })`), a chart
 * layer's numeric x accessor lands its columns on the same arm, `Plan.tableCells`
 * reads a numeric `at`, and the heat cells stored as RECORDS spell it out with
 * the `number` arm. The slice's range field is an integer day, so the horizon
 * brush and the range chip ride the slice's `integer` arm exactly as they ride
 * `datetime` on a time axis — a closed range, so the eight days `[1, 9)` read
 * `1–8`; there is no resolution segment — `step` is the declaration.
 */
export const planNumberAxis = example({
    keywords: [
        "Plan", "axis", "number", "numeric", "step", "Plan.axis.number", "Plan.at", "instant",
        "day", "AM", "PM", "lanes", "buckets", "Planner", "plannerPoint", "brush", "integer", "range", "inclusive",
        "format", "now", "typed axis", "#631", "raw", "Data.bind", "bound", "e3.input", "e3.task",
    ],
    description: "The number axis over rows bound from e3 — day 1..8 at step 1 with AM/PM lanes (the retired Planner's plannerPoint), every row kind on the numeric scale, the horizon brush over the slice's integer range, read inclusive",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(NumberHorizonRow, {
            fields: { day: { label: "Day" }, line: { label: "Line" } },
            rangeFieldId: "day",
        });
        return (<Reactive>{$ => {
            const ops = $.let(Data.bind(planNumberOps));
            // The slice's horizon — twelve days of orders behind an eight-day
            // window, which a task generates.
            const horizon = $.let(Data.bind(planNumberHorizon));
            const series = $.const([
                Plan.series.section(NumberOpsRow, { key: "docks-in", title: "Docks · In", meta: "2 rows" }, [
                    Plan.series.buckets(NumberOpsRow, {
                        key: "dock", title: "Docks",
                        match: r => r.series.equal("dock"),
                        label: r => r.label, sub: r => r.sub,
                        // The Planner's AM/PM lanes — sub-slots of each day column.
                        lanes: _r => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                        // `a.day` is a FloatType field — the builder wraps it to the number arm.
                        events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.day, lane: a.lane, state: a.state })),
                    }),
                ]),
                Plan.series.span(NumberOpsRow, {
                    key: "mach", title: "Machines",
                    match: r => r.series.equal("mach"),
                    label: r => r.label, id: true, value: r => r.value,
                    runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
                }),
                Plan.series.heat(NumberOpsRow, {
                    key: "load", title: "Line load",
                    match: r => r.series.equal("load"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 90 }),
                }),
                Plan.series.chart(NumberOpsRow, {
                    key: "out", title: "Output",
                    match: r => r.series.equal("out"),
                    label: r => r.label, id: true, value: r => r.value, height: "expanded",
                    // A numeric x accessor lands the columns on the number arm.
                    layers: r => [Chart.Column(r.points, { x: p => p.day, y: p => p.t })],
                }),
                Plan.series.table(NumberOpsRow, {
                    key: "table", title: "Despatch",
                    match: r => r.series.equal("table"),
                    label: r => r.label,
                    // A `{ at: FloatType, value }` record wraps by its field type.
                    cells: r => Plan.tableCells(r.tonnes),
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(NumberOpsRow, {
                    key: "crew", title: "Crews",
                    match: r => r.series.equal("crew"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) => Plan.chip({
                        key: s.key, from: s.from, to: s.to,
                        label: East.str`${East.Float.printFixed(s.hours, 0n)}h`, state: s.state,
                    })),
                }),
                Plan.series.events(NumberOpsRow, {
                    key: "ms", title: "Milestones",
                    match: r => r.series.equal("ms"),
                    label: r => r.label, id: true,
                    marks: r => r.marks.map((_$, m) => Plan.mark({ key: m.key, at: m.day, kind: "milestone", label: m.label })),
                }),
            ], ArrayType(Plan.Types.Series(NumberOpsRow)));
            // The horizon's range field is an INTEGER day, so the brush, the
            // range chip and the window keys write the slice's `integer` arm:
            // a closed range, both ends inclusive — the eight days `[1, 9)`
            // are `1–8`.
            const slice = $.let(Slice.bind([NumberHorizonRow], "ex.plan.number", cfg, Slice.state({
                range: some(variant("integer", { from: 1n, to: 8n })),
            }), horizon.read(), none));
            // The declaration: `[1, 9)` ÷ 1 = eight day columns, the divider at 5.
            const axis = $.const(Plan.axis.number({
                window: { min: 1, max: 9 }, step: 1, now: 5, format: Chart.format.number(),
            }));
            return (
                <Plan.View
                    axis={axis}
                    data={ops}
                    series={series}
                    slice={{ slice, affordances: ["filter", "range", "brush", "summary"] }}
                    footer={[{ text: "8 STEPS · NOW 5" }]}
                />
            );
        }}</Reactive>);
    }),
    inputs: [],
});

// ============================================================================
// planOrdinalAxis — the `ordinal` axis (#631): workflow phases
// ============================================================================

/** A job — the phases it spans, by name. */
export const OrdinalJob = StructType({ key: StringType, label: StringType, start: StringType, end: StringType, state: EventStateType });
/** A bench allocation — the phase it sits in. */
export const OrdinalAlloc = StructType({ key: StringType, phase: StringType, state: EventStateType });
/** A crew shift — the phases it covers. */
export const OrdinalShift = StructType({ key: StringType, from: StringType, to: StringType, label: StringType, state: EventStateType });
/** A gate — its phase, and whether it holds the work. */
export const OrdinalMark = StructType({ key: StringType, phase: StringType, label: StringType, exception: BooleanType });
/** A chart point — a phase and a count. */
export const OrdinalPoint = StructType({ phase: StringType, n: FloatType });
/** A table reading — a phase and its value. */
export const OrdinalReading = StructType({ at: StringType, value: OptionType(FloatType) });
/** RAW rows — every instant is a phase NAME. */
export const OrdinalOrderRow = StructType({
    series: StringType, label: StringType, value: OptionType(StringType), sub: OptionType(StringType),
    jobs: ArrayType(OrdinalJob), allocations: ArrayType(OrdinalAlloc), shifts: ArrayType(OrdinalShift),
    marks: ArrayType(OrdinalMark), points: ArrayType(OrdinalPoint), counts: ArrayType(OrdinalReading),
    cells: ArrayType(Plan.Types.HeatCell),
});

/** The orders, benches, loads and gates of a six-phase workflow. */
export const planOrdinalOrders = e3.input("plan_ordinal_orders", DictType(StringType, OrdinalOrderRow), variant("value", new Map([
    ["or-1188", { series: "order", label: "OR-1188", value: some("96 t"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], counts: [], cells: [],
      jobs: [
          { key: "prep", label: "PREP", start: "INTAKE", end: "PREP", state: variant("actual", null) },
          { key: "build", label: "BUILD · B-214", start: "BUILD", end: "QC", state: variant("in-progress", null) },
          { key: "ship", label: "PACK + SHIP", start: "PACK", end: "SHIP", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["or-1204", { series: "order", label: "OR-1204", value: some("54 t"), sub: none,
      allocations: [], shifts: [], marks: [], points: [], counts: [], cells: [],
      jobs: [
          { key: "intake", label: "INTAKE", start: "INTAKE", end: "INTAKE", state: variant("actual", null) },
          { key: "build", label: "BUILD · B-221", start: "PREP", end: "PACK", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["bench", { series: "bench", label: "Bench 2", value: none, sub: some("slots"),
      jobs: [], shifts: [], marks: [], points: [], counts: [], cells: [],
      allocations: [
          { key: "a1", phase: "PREP", state: variant("confirmed", null) }, { key: "a2", phase: "BUILD", state: variant("confirmed", null) },
          { key: "a3", phase: "BUILD", state: variant("proposed", variant("recommended", null)) }, { key: "a4", phase: "PACK", state: variant("proposed", variant("recommended", null)) },
      ] }],
    // Heat cells as STORED records — the phase spelled on the `ordinal` arm.
    ["load", { series: "load", label: "Phase load", value: none, sub: none,
      jobs: [], allocations: [], shifts: [], marks: [], points: [], counts: [],
      cells: [
          { at: variant("ordinal", "INTAKE"), value: some(35.0), label: some("35") },
          { at: variant("ordinal", "PREP"), value: some(66.0), label: some("66") },
          { at: variant("ordinal", "BUILD"), value: some(37.0), label: some("37") },
          { at: variant("ordinal", "QC"), value: some(68.0), label: some("68") },
          { at: variant("ordinal", "PACK"), value: some(39.0), label: some("39") },
          { at: variant("ordinal", "SHIP"), value: some(70.0), label: some("70") },
      ] }],
    ["wip", { series: "wip", label: "WIP · orders", value: some("31"), sub: none,
      jobs: [], allocations: [], shifts: [], marks: [], counts: [], cells: [],
      points: [
          { phase: "INTAKE", n: 4.0 }, { phase: "PREP", n: 11.0 }, { phase: "BUILD", n: 18.0 },
          { phase: "QC", n: 5.0 }, { phase: "PACK", n: 12.0 }, { phase: "SHIP", n: 19.0 },
      ] }],
    ["count", { series: "count", label: "Orders in phase", value: none, sub: none,
      jobs: [], allocations: [], shifts: [], marks: [], points: [], cells: [],
      counts: [
          { at: "INTAKE", value: some(12.0) }, { at: "PREP", value: some(23.0) }, { at: "BUILD", value: some(34.0) },
          { at: "QC", value: some(15.0) }, { at: "PACK", value: none }, { at: "SHIP", value: some(37.0) },
      ] }],
    ["crew", { series: "crew", label: "Crew B", value: none, sub: none,
      jobs: [], allocations: [], marks: [], points: [], counts: [], cells: [],
      shifts: [
          { key: "s1", from: "INTAKE", to: "PREP", label: "prep crew", state: variant("confirmed", null) },
          { key: "s2", from: "BUILD", to: "SHIP", label: "+ finish crew", state: variant("proposed", variant("recommended", null)) },
      ] }],
    ["gates", { series: "gates", label: "Gates", value: none, sub: none,
      jobs: [], allocations: [], shifts: [], points: [], counts: [], cells: [],
      marks: [
          { key: "g1", phase: "QC", label: "HOLD", exception: true },
          { key: "g2", phase: "SHIP", label: "RELEASE", exception: false },
      ] }],
])));

/**
 * The `ordinal` axis — a workflow of six phases, each a bucket, in declared
 * order. Instants are the phase VALUES: a run's `start` / `end` are phase
 * names (an interval covers `[start, end]` in phase order — on an ordinal
 * axis the end names the LAST bucket covered, since values are buckets, not
 * edges), a tile sits in a phase, a chart's string x accessor lands its
 * columns on the phase arm, `Plan.tableCells` reads a string `at`, and a
 * record written as data spells its phase on the `ordinal` arm. There is no
 * slice range for an ordinal axis — the list IS the window, so the horizon
 * brush does not mount and the window keys idle; `now` names a phase.
 */
export const planOrdinalAxis = example({
    keywords: [
        "Plan", "axis", "ordinal", "phase", "phases", "workflow", "stage", "Plan.axis.ordinal",
        "Plan.at", "instant", "values", "list", "span", "buckets", "heat", "chart", "table",
        "cards", "events", "Planner", "typed axis", "#631", "raw", "Data.bind", "bound", "e3.input",
    ],
    description: "The ordinal axis over rows bound from e3 — six workflow phases as the buckets, in declared order; orders span phases, tiles and cells sit in them, a string x accessor lands a chart on them",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Data.bind(planOrdinalOrders));
            const PHASES = $.const(["INTAKE", "PREP", "BUILD", "QC", "PACK", "SHIP"], ArrayType(StringType));
            const EXCEPTION = $.const(variant("exception", null), Plan.Types.EventMarkKind);
            const MILESTONE = $.const(variant("milestone", null), Plan.Types.EventMarkKind);
            const series = $.const([
                Plan.series.section(OrdinalOrderRow, { key: "order-block", title: "Orders", meta: "2 rows" }, [
                    Plan.series.span(OrdinalOrderRow, {
                        key: "order", title: "Orders",
                        match: r => r.series.equal("order"),
                        label: r => r.label, id: true, value: r => r.value,
                        // `j.start` / `j.end` are StringType fields — the builder wraps them to the ordinal arm.
                        runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
                    }),
                ]),
                Plan.series.buckets(OrdinalOrderRow, {
                    key: "bench", title: "Benches",
                    match: r => r.series.equal("bench"),
                    label: r => r.label, sub: r => r.sub,
                    events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.phase, state: a.state })),
                }),
                Plan.series.heat(OrdinalOrderRow, {
                    key: "load", title: "Phase load",
                    match: r => r.series.equal("load"),
                    label: r => r.label,
                    cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 90 }),
                }),
                Plan.series.chart(OrdinalOrderRow, {
                    key: "wip", title: "WIP",
                    match: r => r.series.equal("wip"),
                    label: r => r.label, id: true, value: r => r.value, height: "expanded",
                    // A string x accessor lands the columns on the ordinal arm.
                    layers: r => [Chart.Column(r.points, { x: p => p.phase, y: p => p.n })],
                }),
                Plan.series.table(OrdinalOrderRow, {
                    key: "count", title: "Counts",
                    match: r => r.series.equal("count"),
                    label: r => r.label,
                    cells: r => Plan.tableCells(r.counts),
                    format: Format.Number({ maximumFractionDigits: 0n }),
                }),
                Plan.series.cards(OrdinalOrderRow, {
                    key: "crew", title: "Crews",
                    match: r => r.series.equal("crew"),
                    label: r => r.label,
                    chips: r => r.shifts.map((_$, s) => Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
                }),
                Plan.series.events(OrdinalOrderRow, {
                    key: "gates", title: "Gates",
                    match: r => r.series.equal("gates"),
                    label: r => r.label, id: true,
                    marks: r => r.marks.map((_$, m) => Plan.mark({
                        key: m.key, at: m.phase, label: m.label,
                        kind: m.exception.ifElse(() => EXCEPTION, () => MILESTONE),
                    })),
                }),
            ], ArrayType(Plan.Types.Series(OrdinalOrderRow)));
            // The declaration: the list IS the axis — one bucket per phase, `now` at BUILD.
            const axis = $.const(Plan.axis.ordinal({ values: PHASES, now: "BUILD" }));
            return (
                <Plan.View
                    axis={axis}
                    data={orders}
                    series={series}
                    footer={[{ text: "6 PHASES · NOW BUILD" }]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// slicePlanChrome — a Plan with the `slice` chrome option
//    Exercises: the rail on the timeline canvas (filter · search · range
//    over the row type's datetime field) plus the horizon brush.
// ============================================================================

/** A task on the plan — its owner and its window. */
export const SliceJob = StructType({ task: StringType, owner: StringType, start: DateTimeType, end: DateTimeType });

/** The plan's tasks — the rows the slice narrows. */
export const planSliceJobs = e3.input("plan_slice_jobs", ArrayType(SliceJob), variant("value", [
    { task: "Planning",    owner: "Team A", start: new Date("2024-01-01T00:00:00Z"), end: new Date("2024-01-15T00:00:00Z") },
    { task: "Design",      owner: "Team B", start: new Date("2024-01-10T00:00:00Z"), end: new Date("2024-02-01T00:00:00Z") },
    { task: "Development", owner: "Team C", start: new Date("2024-01-20T00:00:00Z"), end: new Date("2024-03-15T00:00:00Z") },
    { task: "Testing",     owner: "Team A", start: new Date("2024-03-01T00:00:00Z"), end: new Date("2024-03-30T00:00:00Z") },
]));

export const slicePlanChrome = example({
    keywords: ["Slice", "Plan", "slice", "chrome", "filter", "search", "range", "brush", "timeline", "Data.bind", "bound", "e3.input"],
    description: "Ops plan — Plan with the `slice` chrome option over tasks bound from e3: a header rail (`filter`, `search`, `range`) plus the `brush` affordance — drag a window on the horizon strip to set the slice's range; rows fed explicitly via `Slice.rows` and re-keyed into the canvas's keyed collection",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(SliceJob, {
            fields: { task: { label: "Task" }, owner: { label: "Owner" }, start: { label: "Start" } },
            searchFieldIds: ["task", "owner"],
            rangeFieldId: "start",
        });
        return (
            <Reactive>{$ => {
                const tasks = $.let(Data.bind(planSliceJobs));
                const slice = $.let(Slice.bind([SliceJob], "ex.slice.plan.chrome", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "owner", op: variant("eq", "Team A") })],
                }), tasks.read(), none));
                // The narrowed rows re-key into the canvas's keyed collection
                // (#568) — the task name is the row identity here.
                const narrowed = $.let(Slice.rows([SliceJob], slice));
                const jobs = $.let(narrowed.toDict((_$, j) => j.task, (_$, j) => j));
                const series = $.const([
                    Plan.series.span(SliceJob, {
                        key: "jobs", title: "Jobs",
                        label: r => r.task, id: true,
                        sub: r => some(r.owner),
                        runs: (r, k) => [Plan.run({
                            key: k, start: r.start, end: r.end,
                            label: r.task, state: variant("confirmed", null),
                        })],
                    }),
                ], ArrayType(Plan.Types.Series(SliceJob)));
                const axis = $.const(Plan.axis({
                    window: { min: new Date("2024-01-01"), max: new Date("2024-04-01") },
                    resolution: "week", now: new Date("2024-01-20"),
                }));
                return (
                    <Plan.View
                        axis={axis}
                        data={jobs}
                        series={series}
                        slice={{ slice, affordances: ["filter", "search", "range", "brush"] }}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// dockBesidePlan — a Dock source panel beside a Plan board (#325)
// ============================================================================

/** A machine on the board — its operation and its planned run. */
export const DockMachine = StructType({ operation: StringType, start: DateTimeType, end: DateTimeType });

/** The board's machines, W28–W33. */
export const planDockMachines = e3.input("plan_dock_machines", DictType(StringType, DockMachine), variant("value", new Map([
    ["Machine A", { operation: "Cutting",  start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z") }],
    ["Machine B", { operation: "Welding",  start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z") }],
    ["Machine C", { operation: "Painting", start: new Date("2026-07-20T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z") }],
])));

/**
 * The concrete driver (#325): a `<Dock>` source panel beside a `<Plan.View>` drop
 * target in an `<HStack>`. The dock holds an order list and the Plan is the
 * schedule board; collapsing the dock reclaims horizontal space for the board
 * without covering it (in flow — never an overlay). The Plan sibling is
 * `flex="1" minWidth="0"` so it grows into the freed width.
 */
export const dockBesidePlan = example({
    keywords: ["Dock", "layout", "Plan", "beside", "drag", "source", "drop", "target", "in-flow", "sidebar", "board", "Data.bind", "bound", "e3.input"],
    description: "A Dock order-source panel beside a Plan board over machines bound from e3 — collapsing the dock frees width for the board without covering it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const machines = $.let(Data.bind(planDockMachines));
            // Monday of ISO week n, 2026.
            const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
                const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
                return w1.addWeeks(n.subtract(1n));
            }));
            const series = $.const([
                Plan.series.span(DockMachine, {
                    key: "machines", title: "Machines",
                    label: (_r, k) => k, id: true,
                    sub: r => some(r.operation),
                    runs: (r, k) => [Plan.run({
                        key: k, start: r.start, end: r.end,
                        label: "PLAN", state: variant("proposed", variant("added", null)),
                    })],
                }),
            ], ArrayType(Plan.Types.Series(DockMachine)));
            const axis = $.const(Plan.axis({
                window: { min: week(27n), max: week(34n) }, resolution: "week", now: week(29n),
            }));
            return (
                <Box height="260px" width="100%">
                    <HStack gap="4" width="100%" height="100%">
                        <Dock icon="book" label="Orders" badge="3" expandedSize="30%">
                            <Stack gap="2" padding="3">
                                <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Order 1042 — Lot 3</Text></Box>
                                <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Order 1057 — Lot 7</Text></Box>
                                <Box padding="2" background="bg.subtle" borderRadius="md"><Text>Order 1063 — Lot 1</Text></Box>
                            </Stack>
                        </Dock>
                        <Box flex="1" minWidth="0">
                            <Plan.View axis={axis} data={machines} series={series} style={{ height: "fill" }} />
                        </Box>
                    </HStack>
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
