/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, BooleanType, DateTimeType, East, FloatType, NullType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Chart, Plan, Text } from "@elaraai/east-ui/internal";
import { Format, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import * as ex from "./plan.examples.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const W30 = new Date("2026-07-20T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const END = new Date("2026-09-21T00:00:00Z");

// Chart-consumption fixtures (module scope — no host helpers in East bodies).
const SPEC_SERIES_ROW = StructType({ week: DateTimeType, pct: FloatType });
const SPEC_SERIES_DATA = [
    { week: W27, pct: 10.0 }, { week: W28, pct: 20.0 }, { week: W29, pct: 30.0 },
];

// Factory-throw probes run at authoring time; capture the verdicts as
// booleans here and assert them inside the East tests below.
const SPEC_NUMERIC = East.value([{ x: 1.0, y: 10.0 }, { x: 2.0, y: 20.0 }], ArrayType(StructType({ x: FloatType, y: FloatType })));
const SPEC_CATEGORY = East.value([{ site: "A", v: 1.0 }, { site: "B", v: 2.0 }], ArrayType(StructType({ site: StringType, v: FloatType })));
let CHART_BAR_THREW = false;
try {
    Plan.chart({ key: "x", label: "X", layers: Chart.Bar(SPEC_CATEGORY, { x: r => r.v, y: r => r.site }) });
} catch { CHART_BAR_THREW = true; }
let CHART_NUMERIC_X_THREW = false;
try {
    Plan.chart({ key: "x", label: "X", layers: Chart.Line(SPEC_NUMERIC, { x: r => r.x, y: r => r.y }) });
} catch { CHART_NUMERIC_X_THREW = true; }
// A temporal extent on a VALUE axis mirrors Chart.Root's y-axis guard.
const SPEC_TIME_SERIES = East.value(SPEC_SERIES_DATA, ArrayType(SPEC_SERIES_ROW));
let AXIS_TEMPORAL_THREW = false;
try {
    Plan.chart({
        key: "x", label: "X",
        left: { domain: [new Date("2026-06-29T00:00:00Z"), new Date("2026-09-21T00:00:00Z")] },
        layers: Chart.Line(SPEC_TIME_SERIES, { x: r => r.week, y: r => r.pct }),
    });
} catch { AXIS_TEMPORAL_THREW = true; }

describeEast("Plan", (test) => {
    Assert.examples(test, {
        planTargetState: ex.planTargetState,
        planSpanRows: ex.planSpanRows,
        planBucketRows: ex.planBucketRows,
        planChartRows: ex.planChartRows,
        planHeatRows: ex.planHeatRows,
        planTableRows: ex.planTableRows,
        planCardRows: ex.planCardRows,
        planEventRows: ex.planEventRows,
        planGroupedRows: ex.planGroupedRows,
        planLibraryDnd: ex.planLibraryDnd,
    });

    // =========================================================================
    // Root + axis
    // =========================================================================

    test("root carries axis, grain, footer, dnd identity and style", $ => {
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week", resolutions: ["week", "day"], now: W31, format: "W" }),
            rows: [],
            grain: "group",
            id: "plan", sources: ["lib"],
            footer: [{ text: "3 EXCEPTIONS", tone: "warning", end: true }],
            style: { height: "fill", density: "compact", gutterWidth: "168px" },
        }));
        const root = $.let(p.unwrap().unwrap("Plan"));
        $(Assert.equal(root.axis.window.unwrap("some").min, W27));
        $(Assert.equal(root.axis.window.unwrap("some").max, END));
        $(Assert.equal(root.axis.resolution.hasTag("week"), true));
        $(Assert.equal(root.axis.resolutions.length(), 2n));
        $(Assert.equal(root.axis.resolutions.get(1n).hasTag("day"), true));
        $(Assert.equal(root.axis.now.unwrap("some"), W31));
        $(Assert.equal(root.axis.format.unwrap("some"), "W"));
        $(Assert.equal(root.grain.unwrap("some").hasTag("group"), true));
        $(Assert.equal(root.id, "plan"));
        $(Assert.equal(root.sources.get(0n), "lib"));
        $(Assert.equal(root.footer.get(0n).tone.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(root.footer.get(0n).end.unwrap("some"), true));
        $(Assert.equal(root.style.unwrap("some").height.unwrap("some"), "fill"));
        $(Assert.equal(root.style.unwrap("some").density.unwrap("some").hasTag("compact"), true));
        $(Assert.equal(root.style.unwrap("some").gutterWidth.unwrap("some"), "168px"));
    });

    test("review config defaults the column and rerun labels", $ => {
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            rows: [],
            review: { onApprove: East.function([Plan.Types.RowRef], NullType, (_$, _r) => null) },
        }));
        const review = $.let(p.unwrap().unwrap("Plan").review.unwrap("some"));
        $(Assert.equal(review.columnLabel, "Decision"));
        $(Assert.equal(review.rerunLabel, "Rerun"));
        $(Assert.equal(review.onApprove.hasTag("some"), true));
        $(Assert.equal(review.onRerun.hasTag("none"), true));
    });

    test("the root carries the link graph (R1); Plan.link maps over data", $ => {
        const TransferRow = StructType({ src: StringType, srcRun: StringType, dst: StringType, dstRun: StringType, t: FloatType });
        const transfers = $.const([
            { src: "m03", srcRun: "b214", dst: "m04", dstRun: "b208", t: 24.0 },
            { src: "m04", srcRun: "b208", dst: "dock2", dstRun: "d1", t: 18.0 },
        ], ArrayType(TransferRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            rows: [],
            links: transfers.map((_$2, tr) => Plan.link({
                from: tr.src, fromRun: tr.srcRun, to: tr.dst, toRun: tr.dstRun,
                quantity: tr.t, label: East.str`${East.Float.printFixed(tr.t, 0n)} t`,
            })),
        }));
        const links = $.let(p.unwrap().unwrap("Plan").links);
        $(Assert.equal(links.length(), 2n));
        $(Assert.equal(links.get(0n).fromRow, "m03"));
        $(Assert.equal(links.get(0n).fromRun, "b214"));
        $(Assert.equal(links.get(0n).toRow, "m04"));
        $(Assert.equal(links.get(0n).quantity, 24.0));
        $(Assert.equal(links.get(0n).label, "24 t"));
    });

    test("rows DECLARE expand-in-place as pure data (R2); the render is the root's expandRender resolver", $ => {
        const rows = $.let(Plan.span({
            key: "m13", label: "L4-M13",
            expand: { height: "152px", axis: "dim" },
        }));
        const ex = $.let(rows.get(0n).expand.unwrap("some"));
        $(Assert.equal(ex.height.unwrap("some"), "152px"));
        $(Assert.equal(ex.axis.hasTag("dim"), true));
        // Defaults: axis keep, height none (the renderer's default) — the
        // empty declaration just marks the row expandable.
        const dflt = $.let(Plan.span({ key: "d", label: "D", expand: {} }));
        $(Assert.equal(dflt.get(0n).expand.unwrap("some").axis.hasTag("keep"), true));
        $(Assert.equal(dflt.get(0n).expand.unwrap("some").height.hasTag("none"), true));
        // Rows without a declaration carry none — no expand control renders.
        const bare = $.let(Plan.span({ key: "b", label: "B" }));
        $(Assert.equal(bare.get(0n).expand.hasTag("none"), true));
    });

    test("the root carries the generalized popover/hover resolvers over element refs and the expandRender", $ => {
        // ONE stored function per surface (the journeys pattern) — refs carry
        // the row key on every arm, so one resolver covers every element
        // kind; returning none opens no surface.
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($2, ref) => {
            const noBody = $2.const(none, OptionType(UIComponentType));
            return ref.match({
                run: (_$3, ev) => ev.run.equal("b214").ifElse(
                    () => some(Text.Root("RUN DETAIL")),
                    () => noBody),
            }, _$3 => noBody);
        }));
        const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, (_$2, _ref) =>
            Text.Root("UTIL RENDER")));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            rows: [],
            popover,
            expandRender,
        }));
        const root = $.let(p.unwrap().unwrap("Plan"));
        // The stored popover resolves per ref: the named run opens, any other
        // element (a chip here) resolves none — presence is lazy, per ref.
        const runRef = $.const(variant("run", { row: "m03", run: "b214" }), Plan.Types.ElementRef);
        const chipRef = $.const(variant("chip", { row: "crew", chip: "s1" }), Plan.Types.ElementRef);
        $(Assert.equal(root.popover.unwrap("some")(runRef).hasTag("some"), true));
        $(Assert.equal(root.popover.unwrap("some")(chipRef).hasTag("none"), true));
        // Hover is independent and absent here; expandRender builds the body.
        $(Assert.equal(root.hover.hasTag("none"), true));
        const body = $.let(root.expandRender.unwrap("some")({ key: "m13" }), UIComponentType);
        $(Assert.equal(body.unwrap().hasTag("Text"), true));
    });

    // =========================================================================
    // Run-state truth table (the lifecycle shorthands)
    // =========================================================================

    test("run state shorthands resolve the full lifecycle ladder", $ => {
        const runs = $.let(East.value([
            Plan.run({ key: "a", start: W27, end: W28, label: "A", state: "estimated" }),
            Plan.run({ key: "b", start: W27, end: W28, label: "B", state: "added" }),
            Plan.run({ key: "c", start: W27, end: W28, label: "C", state: "recommended" }),
            Plan.run({ key: "d", start: W27, end: W28, label: "D", state: "removed" }),
            Plan.run({ key: "e", start: W27, end: W28, label: "E", state: "confirmed" }),
            Plan.run({ key: "f", start: W27, end: W28, label: "F", state: "in-progress" }),
            Plan.run({ key: "g", start: W27, end: W28, label: "G", state: "actual" }),
            Plan.run({ key: "h", start: W27, end: W28, label: "H", state: "rejected" }),
        ], ArrayType(Plan.Types.Run)));
        $(Assert.equal(runs.get(0n).state.hasTag("estimated"), true));
        $(Assert.equal(runs.get(1n).state.unwrap("proposed").hasTag("added"), true));
        $(Assert.equal(runs.get(2n).state.unwrap("proposed").hasTag("recommended"), true));
        $(Assert.equal(runs.get(3n).state.unwrap("proposed").hasTag("removed"), true));
        $(Assert.equal(runs.get(4n).state.hasTag("confirmed"), true));
        $(Assert.equal(runs.get(5n).state.hasTag("in-progress"), true));
        $(Assert.equal(runs.get(6n).state.hasTag("actual"), true));
        $(Assert.equal(runs.get(7n).state.hasTag("rejected"), true));
    });

    test("run carries display quantity, numeric qty, status ring, moved and a bare-name icon", $ => {
        const r = $.let(Plan.run({
            key: "r", start: W27, end: W28, label: "RUN", quantity: "96 t", qty: 96,
            state: "actual", status: "warning", moved: 3, icon: "truck",
        }));
        $(Assert.equal(r.quantity.unwrap("some"), "96 t"));
        $(Assert.equal(r.qty.unwrap("some"), 96.0));
        $(Assert.equal(r.status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(r.moved.unwrap("some"), 3n));
        $(Assert.equal(r.icon.unwrap("some").prefix, "fas"));
        $(Assert.equal(r.icon.unwrap("some").name, "truck"));
    });

    // =========================================================================
    // Flatten — nested rows, parent keys, depth-first order
    // =========================================================================

    test("span nesting flattens depth-first with re-parented roots", $ => {
        const rows = $.let(Plan.span({
            key: "prog", label: "Program", rows: [
                Plan.span({ key: "m1", label: "M1", runs: [
                    Plan.run({ key: "r1", start: W27, end: W28, label: "R1", state: "actual" }),
                ] }),
                Plan.span({ key: "m2", label: "M2", rows: [
                    Plan.span({ key: "m2a", label: "M2A", runs: [
                        Plan.run({ key: "r2", start: W28, end: W29, label: "R2", state: "confirmed" }),
                    ] }),
                ] }),
            ],
        }));
        $(Assert.equal(rows.length(), 4n));
        $(Assert.equal(rows.get(0n).key, "prog"));
        $(Assert.equal(rows.get(0n).parent.hasTag("none"), true));
        $(Assert.equal(rows.get(1n).key, "m1"));
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), "prog"));
        $(Assert.equal(rows.get(2n).key, "m2"));
        $(Assert.equal(rows.get(2n).parent.unwrap("some"), "prog"));
        // Depth-first: m2's own child keeps ITS parent (m2), re-parenting only
        // touches subtree roots.
        $(Assert.equal(rows.get(3n).key, "m2a"));
        $(Assert.equal(rows.get(3n).parent.unwrap("some"), "m2"));
    });

    test("gutter and row envelope fields round-trip", $ => {
        const series = $.const(SPEC_SERIES_DATA, ArrayType(SPEC_SERIES_ROW));
        const rows = $.let(Plan.chart({
            key: "cov", label: "COVERAGE", id: true, sub: "demand", value: "94.2%",
            meta: "8 rs", stacked: true, pinned: true, status: "warning", approval: "pending",
            swatches: [{ color: "teal.solid", label: "col" }],
            drill: { lines: ["a"], meter: 0.5, events: ["e"], journey: "B-208" },
            layers: Chart.Line(series, { x: r => r.week, y: r => r.pct }),
        }));
        const row = $.let(rows.get(0n));
        $(Assert.equal(row.gutter.label, "COVERAGE"));
        $(Assert.equal(row.gutter.id.unwrap("some"), true));
        $(Assert.equal(row.gutter.sub.unwrap("some"), "demand"));
        $(Assert.equal(row.gutter.value.unwrap("some"), "94.2%"));
        $(Assert.equal(row.gutter.meta.unwrap("some"), "8 rs"));
        $(Assert.equal(row.gutter.stacked.unwrap("some"), true));
        $(Assert.equal(row.gutter.swatches.get(0n).color, "teal.solid"));
        $(Assert.equal(row.pinned.unwrap("some"), true));
        $(Assert.equal(row.status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(row.approval.unwrap("some").hasTag("pending"), true));
        const drill = $.let(row.drill.unwrap("some"));
        $(Assert.equal(drill.meter.unwrap("some"), 0.5));
        $(Assert.equal(drill.journey.unwrap("some"), "B-208"));
    });

    // =========================================================================
    // Rollup band math
    // =========================================================================

    test("nesting parents DECLARE their rollup + unit; bands are renderer-derived", $ => {
        // The IR carries the declaration (Table's column-aggregate idiom on
        // the span channel); the renderer derives the ×k band values from the
        // subtree's runs — never precomputed expressions.
        const rows = $.let(Plan.span({
            key: "p", label: "P", rollup: "union", unit: "t", rows: [
                Plan.span({ key: "a", label: "A", runs: [
                    Plan.run({ key: "ra", start: W27, end: W29, label: "RA", qty: 96, state: "actual" }),
                ] }),
            ],
        }));
        const kind = $.let(rows.get(0n).kind.unwrap("span"));
        $(Assert.equal(kind.rollup.unwrap("some").hasTag("union"), true));
        $(Assert.equal(kind.unit.unwrap("some"), "t"));
        $(Assert.equal(kind.runs.length(), 0n));
        // Leaves declare no rollup.
        $(Assert.equal(rows.get(1n).kind.unwrap("span").rollup.hasTag("none"), true));
        const byStatus = $.let(Plan.span({
            key: "q", label: "Q", rollup: "byStatus", rows: [
                Plan.span({ key: "b", label: "B", runs: [
                    Plan.run({ key: "r1", start: W27, end: W29, label: "R1", state: "actual" }),
                ] }),
            ],
        }));
        $(Assert.equal(byStatus.get(0n).kind.unwrap("span").rollup.unwrap("some").hasTag("byStatus"), true));
    });

    // =========================================================================
    // Heat aggregation + table subtotals
    // =========================================================================

    test("heat parents DECLARE their aggregate; scale rides the empty cells arm", $ => {
        // The renderer derives the per-bucket values from the children — the
        // parent's IR carries the mode + the scale on an empty heat arm.
        const rows = $.let(Plan.heat({
            key: "line", label: "Line", aggregate: "mean", scale: { min: 0, max: 100 }, rows: [
                Plan.heat({ key: "a", label: "A", cells: Plan.heatCells([
                    { at: W27, value: some(40.0), label: none }, { at: W28, value: some(60.0), label: none },
                ]) }),
            ],
        }));
        const kind = $.let(rows.get(0n).kind.unwrap("heat"));
        $(Assert.equal(kind.aggregate.unwrap("some").hasTag("mean"), true));
        const cells = $.let(kind.cells.unwrap("heat"));
        $(Assert.equal(cells.cells.length(), 0n));
        $(Assert.equal(cells.min.unwrap("some"), 0.0));
        $(Assert.equal(cells.max.unwrap("some"), 100.0));
        // The child keeps its real cells.
        $(Assert.equal(rows.get(1n).kind.unwrap("heat").cells.unwrap("heat").cells.length(), 2n));
    });

    test("table parents DECLARE their subtotal mode + shared Format spec; cells carry raw values", $ => {
        const rows = $.let(Plan.table({
            key: "desp", label: "Despatches", aggregate: "sum",
            format: Format.Number({ maximumFractionDigits: 0n }),
            rows: [
                Plan.table({ key: "a", label: "A", cells: Plan.tableCells([
                    { at: W27, value: some(96.0) }, { at: W28, value: some(-4.0) },
                ]) }),
                Plan.table({ key: "b", label: "B", cells: Plan.tableCells([
                    { at: W27, value: some(54.0) }, { at: W28, value: none },
                ]) }),
            ],
        }));
        const kind = $.let(rows.get(0n).kind.unwrap("table"));
        // The parent carries the declaration; the renderer derives the cells
        // and prints every numeral through the shared `TickFormatType` spec.
        $(Assert.equal(kind.series.length(), 0n));
        $(Assert.equal(kind.split.hasTag("horizontal"), true));
        $(Assert.equal(kind.aggregate.unwrap("some").hasTag("sum"), true));
        const format = $.let(kind.format.unwrap("some").unwrap("number"));
        $(Assert.equal(format.maximumFractionDigits.unwrap("some"), 0n));
        // The `cells` sugar wraps into ONE unstyled series; leaf cells carry
        // raw values — text and tone are renderer-derived (explicit
        // overrides stay `none` from the builder).
        const leafA = $.let(rows.get(1n).kind.unwrap("table").series.get(0n).cells);
        $(Assert.equal(leafA.get(1n).value.unwrap("some"), -4.0));
        $(Assert.equal(leafA.get(1n).text.hasTag("none"), true));
        $(Assert.equal(leafA.get(1n).tone.hasTag("none"), true));
        $(Assert.equal(rows.get(1n).kind.unwrap("table").series.get(0n).tone.hasTag("none"), true));
        const leafB = $.let(rows.get(2n).kind.unwrap("table").series.get(0n).cells);
        $(Assert.equal(leafB.get(1n).value.hasTag("none"), true));
    });

    test("multi-series table rows declare per-position style ONCE; cells stay raw", $ => {
        const rows = $.let(Plan.table({
            key: "flow", label: "Flow", split: "vertical",
            format: Format.Number({ maximumFractionDigits: 0n }),
            series: [
                Plan.tableSeries({ strong: true, rollup: true,
                    cells: Plan.tableCells([{ at: W27, value: some(96.0) }]) }),
                Plan.tableSeries({ tone: "muted",
                    format: Format.Number({ signDisplay: "always" }),
                    cells: Plan.tableCells([{ at: W27, value: some(-8.0) }]) }),
            ],
        }));
        const kind = $.let(rows.get(0n).kind.unwrap("table"));
        $(Assert.equal(kind.split.hasTag("vertical"), true));
        $(Assert.equal(kind.series.length(), 2n));
        const s0 = $.let(kind.series.get(0n));
        $(Assert.equal(s0.strong.unwrap("some"), true));
        $(Assert.equal(s0.rollup.unwrap("some"), true));
        $(Assert.equal(s0.format.hasTag("none"), true));
        $(Assert.equal(s0.cells.get(0n).value.unwrap("some"), 96.0));
        const s1 = $.let(kind.series.get(1n));
        $(Assert.equal(s1.tone.unwrap("some").hasTag("muted"), true));
        $(Assert.equal(s1.format.unwrap("some").unwrap("number").signDisplay.unwrap("some").hasTag("always"), true));
        $(Assert.equal(s1.cells.get(0n).value.unwrap("some"), -8.0));
    });

    test("tableCells carries raw values with renderer-owned text and tone", $ => {
        const cells = $.let(Plan.tableCells([{ at: W27, value: some(1.5) }]));
        $(Assert.equal(cells.get(0n).value.unwrap("some"), 1.5));
        $(Assert.equal(cells.get(0n).text.hasTag("none"), true));
        $(Assert.equal(cells.get(0n).tone.hasTag("none"), true));
    });

    // =========================================================================
    // Buckets, cards, events
    // =========================================================================

    test("bucket rows carry lanes and the full event grammar", $ => {
        const rows = $.let(Plan.buckets({
            key: "dock", label: "Dock",
            lanes: [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm" })],
            events: [Plan.event({
                key: "e1", at: W27, lane: "am", label: "X", state: "recommended",
                tone: "warning", color: "teal.solid", colorPalette: "teal",
                stretch: "horizontal", content: { horizontal: "center", vertical: "end" },
                animation: "pulse",
            })],
            markers: [Plan.marker({ at: W28, lane: "pm", message: "breach" })],
        }));
        const b = $.let(rows.get(0n).kind.unwrap("buckets"));
        $(Assert.equal(b.lanes.length(), 2n));
        $(Assert.equal(b.lanes.get(0n).label.unwrap("some"), "AM"));
        $(Assert.equal(b.lanes.get(1n).label.hasTag("none"), true));
        const e = $.let(b.events.get(0n));
        $(Assert.equal(e.lane.unwrap("some"), "am"));
        $(Assert.equal(e.state.unwrap("proposed").hasTag("recommended"), true));
        $(Assert.equal(e.tone.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(e.color.unwrap("some"), "teal.solid"));
        $(Assert.equal(e.colorPalette.unwrap("some").hasTag("teal"), true));
        $(Assert.equal(e.stretch.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(e.content.unwrap("some").horizontal.unwrap("some").hasTag("center"), true));
        $(Assert.equal(e.content.unwrap("some").vertical.unwrap("some").hasTag("end"), true));
        $(Assert.equal(e.animation.unwrap("some").hasTag("pulse"), true));
        const m = $.let(b.markers.get(0n));
        $(Assert.equal(m.lane.unwrap("some"), "pm"));
        $(Assert.equal(m.status.hasTag("danger"), true));
        $(Assert.equal(m.message, "breach"));
    });

    test("cards chips and event marks round-trip; markKind.decision carries applied", $ => {
        const cardRows = $.let(Plan.cards({
            key: "crew", label: "Crew", chips: [
                Plan.chip({ key: "c1", from: W27, to: W29, label: "80h", state: "removed" }),
            ],
        }));
        const chip = $.let(cardRows.get(0n).kind.unwrap("cards").chips.get(0n));
        $(Assert.equal(chip.from, W27));
        $(Assert.equal(chip.to, W29));
        $(Assert.equal(chip.state.unwrap("proposed").hasTag("removed"), true));
        const eventRows = $.let(Plan.events({
            key: "ms", label: "MS", marks: [
                Plan.mark({ key: "m1", at: W28, kind: "milestone", label: "GO" }),
                Plan.mark({ key: "m2", at: W29, kind: Plan.markKind.decision(true) }),
                Plan.mark({ key: "m3", at: W30, kind: "exception" }),
            ],
        }));
        const marks = $.let(eventRows.get(0n).kind.unwrap("events").marks);
        $(Assert.equal(marks.get(0n).kind.hasTag("milestone"), true));
        $(Assert.equal(marks.get(0n).label.unwrap("some"), "GO"));
        $(Assert.equal(marks.get(1n).kind.unwrap("decision").applied, true));
        $(Assert.equal(marks.get(2n).kind.hasTag("exception"), true));
    });

    // =========================================================================
    // Chart consumption
    // =========================================================================

    test("chart rows consume Chart layers as {t, y} data with axes and channels", $ => {
        const series = $.const(SPEC_SERIES_DATA, ArrayType(SPEC_SERIES_ROW));
        const rows = $.let(Plan.chart({
            key: "c", label: "C", height: Plan.fixed("120px"), expandedHeight: "96px", expandable: true,
            // The Chart.Root y-axis vocabulary, verbatim (domain / tickValues / format).
            left: { domain: [0, 160], tickValues: [0, 80, 160], format: Chart.format.number() },
            right: { tickValues: [0, 20, 40] },
            layers: [
                Plan.layer(Chart.Line(series, { x: r => r.week, y: r => r.pct }), { breach: { below: 15 } }),
                Plan.layer(Chart.Scatter(series, { x: r => r.week, y: r => r.pct }), { axis: "right" }),
                Chart.refLine({ y: 100, label: "TARGET" }),
                Chart.refBand({ x: [W27, W28], label: "CRUNCH" }),
                Chart.refDot({ x: W28, y: 20, label: "LOW" }),
            ],
        }));
        const chart = $.let(rows.get(0n).kind.unwrap("chart"));
        $(Assert.equal(chart.height.unwrap("fixed"), "120px"));
        // The expanded state's pixel override (default 88 when `none`).
        $(Assert.equal(chart.expandedHeight.unwrap("some"), "96px"));
        $(Assert.equal(chart.expandable.unwrap("some"), true));
        // The IR carries the Chart axis types — ChartTickValuesType /
        // ChartDomainType number arms — never a hand-rolled twin.
        $(Assert.equal(chart.left.unwrap("some").tickValues.unwrap("some").unwrap("number").length(), 3n));
        $(Assert.equal(chart.left.unwrap("some").domain.unwrap("some").unwrap("number").min, 0.0));
        $(Assert.equal(chart.left.unwrap("some").domain.unwrap("some").unwrap("number").max, 160.0));
        $(Assert.equal(chart.right.unwrap("some").domain.hasTag("none"), true));
        // Axis format is the CHART contract (`Chart.format.*` — ValueFormatType).
        $(Assert.equal(chart.left.unwrap("some").format.unwrap("some").hasTag("number"), true));
        $(Assert.equal(chart.layers.length(), 5n));
        const line = $.let(chart.layers.get(0n).unwrap("line"));
        $(Assert.equal(line.points.length(), 3n));
        $(Assert.equal(line.points.get(0n).t, W27));
        $(Assert.equal(line.points.get(0n).y, 10.0));
        $(Assert.equal(line.axis.hasTag("left"), true));
        $(Assert.equal(line.breach.unwrap("some").unwrap("below"), 15.0));
        const scatter = $.let(chart.layers.get(1n).unwrap("scatter"));
        $(Assert.equal(scatter.axis.hasTag("right"), true));
        const refLine = $.let(chart.layers.get(2n).unwrap("refLine"));
        $(Assert.equal(refLine.y, 100.0));
        $(Assert.equal(refLine.label.unwrap("some"), "TARGET"));
        const refBand = $.let(chart.layers.get(3n).unwrap("refBand"));
        $(Assert.equal(refBand.from, W27));
        $(Assert.equal(refBand.to, W28));
        const refDot = $.let(chart.layers.get(4n).unwrap("refDot"));
        $(Assert.equal(refDot.t, W28));
        $(Assert.equal(refDot.y, 20.0));
    });

    test("stacked columns carry their series keys; spark is the default height", $ => {
        const series = $.const(SPEC_SERIES_DATA, ArrayType(SPEC_SERIES_ROW));
        const rows = $.let(Plan.chart({
            key: "out", label: "OUT",
            layers: [
                Chart.Column(series, { x: r => r.week, y: r => r.pct }, { stack: "out", key: "L1" }),
                Chart.Column(series, { x: r => r.week, y: r => r.pct }, { stack: "out", key: "L2" }),
                Chart.Column(series, { x: r => r.week, y: r => r.pct }),
            ],
        }));
        const chart = $.let(rows.get(0n).kind.unwrap("chart"));
        $(Assert.equal(chart.height.hasTag("spark"), true));
        $(Assert.equal(chart.expandedHeight.hasTag("none"), true));
        $(Assert.equal(chart.layers.get(0n).unwrap("column").series.unwrap("some"), "L1"));
        $(Assert.equal(chart.layers.get(1n).unwrap("column").series.unwrap("some"), "L2"));
        $(Assert.equal(chart.layers.get(2n).unwrap("column").series.hasTag("none"), true));
    });

    test("Chart.Bar, non-DateTime x accessors and temporal value-axis domains are build-time errors", $ => {
        $(Assert.equal(East.value(CHART_BAR_THREW), true));
        $(Assert.equal(East.value(CHART_NUMERIC_X_THREW), true));
        $(Assert.equal(East.value(AXIS_TEMPORAL_THREW), true));
    });

    // =========================================================================
    // Groups + data-driven forms
    // =========================================================================

    test("group strips DECLARE their summary aggregate and re-parent members", $ => {
        const rows = $.let(Plan.group({
            key: "line2", label: "Line 2", collapsed: true, summaryAggregate: "mean", rows: [
                Plan.heat({ key: "a", label: "A", cells: Plan.heatCells([
                    { at: W27, value: some(40.0), label: none },
                ]) }),
                Plan.heat({ key: "b", label: "B", cells: Plan.heatCells([
                    { at: W27, value: some(60.0), label: none },
                ]) }),
            ],
        }));
        $(Assert.equal(rows.length(), 3n));
        const g = $.let(rows.get(0n).kind.unwrap("group"));
        $(Assert.equal(g.collapsed.unwrap("some"), true));
        // The declaration; the renderer derives the strip cells.
        $(Assert.equal(g.summaryAggregate.unwrap("some").hasTag("mean"), true));
        $(Assert.equal(g.summary.hasTag("none"), true));
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), "line2"));
    });

    test("Plan.rows grouped form builds group strips per discovered value", $ => {
        const data = $.const([
            { id: "a", line: "L1", v: 40.0 },
            { id: "b", line: "L1", v: 60.0 },
            { id: "c", line: "L2", v: 80.0 },
        ]);
        const rows = $.let(Plan.rows(data, {
            groupBy: [{ by: r => r.line, collapsed: true }],
            summaryAggregate: "mean",
            row: (_$2, r) => Plan.heat({ key: r.id, label: r.id, cells: Plan.heatCells(
                East.value([{ at: W27, value: some(r.v), label: none }], ArrayType(Plan.Types.HeatCell)),
            ) }),
        }));
        // L1 strip + 2 members, L2 strip + 1 member.
        $(Assert.equal(rows.length(), 5n));
        $(Assert.equal(rows.get(0n).key, "L1"));
        $(Assert.equal(rows.get(0n).gutter.meta.unwrap("some"), "2 rs"));
        $(Assert.equal(rows.get(0n).kind.unwrap("group").summaryAggregate.unwrap("some").hasTag("mean"), true));
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), "L1"));
        $(Assert.equal(rows.get(2n).parent.unwrap("some"), "L1"));
        $(Assert.equal(rows.get(3n).key, "L2"));
        $(Assert.equal(rows.get(4n).parent.unwrap("some"), "L2"));
    });

    test("span.of groups by accessor with rollup parents", $ => {
        const data = $.const([
            { id: "m1", program: "A", start: W27, end: W29, qty: 96.0 },
            { id: "m2", program: "A", start: W28, end: W30, qty: 50.0 },
            { id: "m3", program: "B", start: W27, end: W28, qty: 10.0 },
        ]);
        const rows = $.let(Plan.span.of(data, {
            key: r => r.id, label: r => r.id, id: true,
            runs: r => East.value([Plan.run({ key: r.id, start: r.start, end: r.end, label: r.id, qty: r.qty, state: variant("confirmed", null) })], ArrayType(Plan.Types.Run)),
            groupBy: [r => r.program], rollup: "union", unit: "t",
        }));
        // A parent + 2 members, B parent + 1 member; parents DECLARE the
        // rollup + unit (the renderer derives the band values).
        $(Assert.equal(rows.length(), 5n));
        $(Assert.equal(rows.get(0n).key, "A"));
        $(Assert.equal(rows.get(0n).gutter.label, "A"));
        $(Assert.equal(rows.get(0n).kind.unwrap("span").rollup.unwrap("some").hasTag("union"), true));
        $(Assert.equal(rows.get(0n).kind.unwrap("span").unit.unwrap("some"), "t"));
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), "A"));
        $(Assert.equal(rows.get(3n).key, "B"));
    });

    test("span.of accessor channel: value/status/drill Options flow per row; Plan.drill builds payloads", $ => {
        const MachineRow = StructType({
            id: StringType, cap: FloatType, warn: BooleanType,
            drill: OptionType(Plan.Types.Drill),
            runs: ArrayType(Plan.Types.Run),
        });
        const data = $.const([
            { id: "m1", cap: 120.0, warn: true,
              drill: some(Plan.drill({ lines: ["120 t · FILL"], meter: 0.5, journey: "B-208" })),
              runs: [Plan.run({ key: "r1", start: W27, end: W28, label: "R1", state: "actual" })] },
            { id: "m2", cap: 80.0, warn: false, drill: none,
              runs: [Plan.run({ key: "r2", start: W28, end: W29, label: "R2", state: "confirmed" })] },
        ], ArrayType(MachineRow));
        const rows = $.let(Plan.span.of(data, {
            key: r => r.id, label: r => r.id, id: true,
            value: r => some(East.str`${East.Float.printFixed(r.cap, 0n)} t`),
            status: r => r.warn.ifElse(
                () => East.value(some(variant("warning", null)), OptionType(StatusValueType)),
                () => East.value(none, OptionType(StatusValueType))),
            drill: r => r.drill,
            runs: r => r.runs,
        }));
        // Per-row presence, straight from the data / computed expressions.
        $(Assert.equal(rows.get(0n).gutter.value.unwrap("some"), "120 t"));
        $(Assert.equal(rows.get(0n).status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(rows.get(1n).status.hasTag("none"), true));
        $(Assert.equal(rows.get(0n).drill.hasTag("some"), true));
        $(Assert.equal(rows.get(0n).drill.unwrap("some").journey.unwrap("some"), "B-208"));
        $(Assert.equal(rows.get(0n).drill.unwrap("some").meter.unwrap("some"), 0.5));
        $(Assert.equal(rows.get(1n).drill.hasTag("none"), true));
    });

    test("bucket lanes accept East arrays of PlanLaneType values", $ => {
        const lanes = $.const([{ key: "am", label: some("AM") }, { key: "pm", label: none }],
            ArrayType(Plan.Types.Lane));
        const rows = $.let(Plan.buckets({ key: "d", label: "D", lanes }));
        const b = $.let(rows.get(0n).kind.unwrap("buckets"));
        $(Assert.equal(b.lanes.length(), 2n));
        $(Assert.equal(b.lanes.get(0n).label.unwrap("some"), "AM"));
        $(Assert.equal(b.lanes.get(1n).label.hasTag("none"), true));
    });

    // =========================================================================
    // Templates
    // =========================================================================

    test("templates carry their kind, icon and binding", $ => {
        const make = $.const(East.function([], ArrayType(Plan.Types.Row), (_$2) =>
            Plan.events({ key: "ms", label: "MS", marks: [] })));
        const t = $.let(Plan.template({
            key: "ms", label: "Events", sublabel: "milestones", kind: "events", icon: "flag", make,
        }));
        $(Assert.equal(t.kind.hasTag("events"), true));
        $(Assert.equal(t.sublabel.unwrap("some"), "milestones"));
        $(Assert.equal(t.icon.unwrap("some").name, "flag"));
        const made = $.let(t.make());
        $(Assert.equal(made.length(), 1n));
        $(Assert.equal(made.get(0n).key, "ms"));
    });
}, { platformFns: TestImpl });
