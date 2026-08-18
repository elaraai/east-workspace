/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Chart, Plan, Text } from "@elaraai/east-ui/internal";
import { EventStateType, Format, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import * as ex from "./plan.examples.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const W30 = new Date("2026-07-20T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const END = new Date("2026-09-21T00:00:00Z");

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
        planSeriesData: ex.planSeriesData,
        planLibraryDnd: ex.planLibraryDnd,
        planFill: ex.planFill,
        planReview: ex.planReview,
    });

    // =========================================================================
    // Root + axis
    // =========================================================================

    test("root carries axis, grain, footer, dnd identity and style; data + series is the definition", $ => {
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week", resolutions: ["week", "day"], now: W31, format: "W" }),
            data,
            series: [],
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
        // Empty data × no series ⇒ an empty inline canvas (a keyed collection).
        $(Assert.equal(root.rows.unwrap("inline").size(), 0n));
    });

    test("review config defaults the column and rerun labels", $ => {
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data,
            series: [],
            review: { onApprove: East.function([Plan.Types.RowRef], NullType, (_$, _r) => null) },
        }));
        const review = $.let(p.unwrap().unwrap("Plan").review.unwrap("some"));
        $(Assert.equal(review.columnLabel, "Decision"));
        $(Assert.equal(review.rerunLabel, "Rerun"));
        $(Assert.equal(review.onApprove.hasTag("some"), true));
        $(Assert.equal(review.onRerun.hasTag("none"), true));
    });

    test("the root carries the link graph (R1); Plan.link maps over data", $ => {
        const Row = StructType({ id: StringType });
        const TransferRow = StructType({ src: StringType, srcRun: StringType, dst: StringType, dstRun: StringType, t: FloatType });
        const transfers = $.const([
            { src: "m03", srcRun: "b214", dst: "m04", dstRun: "b208", t: 24.0 },
            { src: "m04", srcRun: "b208", dst: "dock2", dstRun: "d1", t: 18.0 },
        ], ArrayType(TransferRow));
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data,
            series: [],
            links: transfers.map((_$, tr) => Plan.link({
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
        const declared = $.let(rows.get("m13").expand.unwrap("some"));
        $(Assert.equal(declared.height.unwrap("some"), "152px"));
        $(Assert.equal(declared.axis.hasTag("dim"), true));
        // Defaults: axis keep, height none (the renderer's default) — the
        // empty declaration just marks the row expandable.
        const dflt = $.let(Plan.span({ key: "d", label: "D", expand: {} }));
        $(Assert.equal(dflt.get("d").expand.unwrap("some").axis.hasTag("keep"), true));
        $(Assert.equal(dflt.get("d").expand.unwrap("some").height.hasTag("none"), true));
        // Rows without a declaration carry none — no expand control renders.
        const bare = $.let(Plan.span({ key: "b", label: "B" }));
        $(Assert.equal(bare.get("b").expand.hasTag("none"), true));
    });

    test("the root carries the generalized popover/hover resolvers over element refs and the expandRender", $ => {
        // ONE stored function per surface — refs carry
        // the row key on every arm, so one resolver covers every element
        // kind; returning none opens no surface.
        const Row = StructType({ id: StringType });
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
            const noBody = $.const(none, OptionType(UIComponentType));
            return ref.match({
                run: (_$, ev) => ev.run.equal("b214").ifElse(
                    () => some(Text.Root("RUN DETAIL")),
                    () => noBody),
            }, _$ => noBody);
        }));
        const expandRender = $.const(East.function([Plan.Types.RowRef], UIComponentType, (_$, _ref) =>
            Text.Root("UTIL RENDER")));
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data,
            series: [],
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
        const runs = $.let([
            Plan.run({ key: "a", start: W27, end: W28, label: "A", state: "estimated" }),
            Plan.run({ key: "b", start: W27, end: W28, label: "B", state: "added" }),
            Plan.run({ key: "c", start: W27, end: W28, label: "C", state: "recommended" }),
            Plan.run({ key: "d", start: W27, end: W28, label: "D", state: "removed" }),
            Plan.run({ key: "e", start: W27, end: W28, label: "E", state: "confirmed" }),
            Plan.run({ key: "f", start: W27, end: W28, label: "F", state: "in-progress" }),
            Plan.run({ key: "g", start: W27, end: W28, label: "G", state: "actual" }),
            Plan.run({ key: "h", start: W27, end: W28, label: "H", state: "rejected" }),
        ], ArrayType(Plan.Types.Run));
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
    // Composition — nested rows, parent keys, one keyed collection (the
    // SUBTREE vocabulary — template `make` bodies and `series.rows` chrome)
    // =========================================================================

    test("span nesting composes into ONE keyed collection with re-parented roots", $ => {
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
        $(Assert.equal(rows.size(), 4n));
        // A row is addressed by its KEY, never by position.
        $(Assert.equal(rows.get("prog").parent.hasTag("none"), true));
        $(Assert.equal(rows.get("m1").parent.unwrap("some"), "prog"));
        $(Assert.equal(rows.get("m2").parent.unwrap("some"), "prog"));
        // Re-parenting only touches subtree ROOTS: m2's own child keeps ITS
        // parent, and no key is ever rewritten.
        $(Assert.equal(rows.get("m2a").parent.unwrap("some"), "m2"));
    });

    test("two rows under ONE key collapse to a single entry (#568 — the D3 regression)", $ => {
        // A Dict cannot hold two entries under one key, so the duplicate a
        // per-window pipeline used to synthesize is unconstructable rather
        // than gated. Composition is last-wins, so the LATER row stands.
        const one = $.let(Plan.span({ key: "dup", label: "first" }));
        const merged = $.let(Plan.group({
            key: "g", label: "G", rows: [
                Plan.span({ key: "dup", label: "first" }),
                Plan.span({ key: "dup", label: "second" }),
            ],
        }));
        $(Assert.equal(one.size(), 1n));
        // The group plus ONE member — not two.
        $(Assert.equal(merged.size(), 2n));
        $(Assert.equal(merged.get("dup").gutter.label, "second"));
        $(Assert.equal(merged.get("dup").parent.unwrap("some"), "g"));
    });

    test("gutter and row envelope fields round-trip", $ => {
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const series = $.const([
            { week: W27, pct: 10.0 }, { week: W28, pct: 20.0 }, { week: W29, pct: 30.0 },
        ], ArrayType(MeasureRow));
        const rows = $.let(Plan.chart({
            key: "cov", label: "COVERAGE", id: true, sub: "demand", value: "94.2%",
            meta: "8 rs", stacked: true, pinned: true, status: "warning", approval: "pending",
            swatches: [{ color: "teal.solid", label: "col" }],
            expand: { height: "152px", axis: "dim" },
            layers: Chart.Line(series, { x: r => r.week, y: r => r.pct }),
        }));
        const row = $.let(rows.get("cov"));
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
        const expand = $.let(row.expand.unwrap("some"));
        $(Assert.equal(expand.height.unwrap("some"), "152px"));
        $(Assert.equal(expand.axis.hasTag("dim"), true));
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
        const kind = $.let(rows.get("p").kind.unwrap("span"));
        $(Assert.equal(kind.rollup.unwrap("some").hasTag("union"), true));
        $(Assert.equal(kind.unit.unwrap("some"), "t"));
        $(Assert.equal(kind.runs.length(), 0n));
        // Leaves declare no rollup.
        $(Assert.equal(rows.get("a").kind.unwrap("span").rollup.hasTag("none"), true));
        const byStatus = $.let(Plan.span({
            key: "q", label: "Q", rollup: "byStatus", rows: [
                Plan.span({ key: "b", label: "B", runs: [
                    Plan.run({ key: "r1", start: W27, end: W29, label: "R1", state: "actual" }),
                ] }),
            ],
        }));
        $(Assert.equal(byStatus.get("q").kind.unwrap("span").rollup.unwrap("some").hasTag("byStatus"), true));
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
        const kind = $.let(rows.get("line").kind.unwrap("heat"));
        $(Assert.equal(kind.aggregate.unwrap("some").hasTag("mean"), true));
        const cells = $.let(kind.cells.unwrap("heat"));
        $(Assert.equal(cells.cells.length(), 0n));
        $(Assert.equal(cells.min.unwrap("some"), 0.0));
        $(Assert.equal(cells.max.unwrap("some"), 100.0));
        // The child keeps its real cells.
        $(Assert.equal(rows.get("a").kind.unwrap("heat").cells.unwrap("heat").cells.length(), 2n));
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
        const kind = $.let(rows.get("desp").kind.unwrap("table"));
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
        const leafA = $.let(rows.get("a").kind.unwrap("table").series.get(0n).cells);
        $(Assert.equal(leafA.get(1n).value.unwrap("some"), -4.0));
        $(Assert.equal(leafA.get(1n).text.hasTag("none"), true));
        $(Assert.equal(leafA.get(1n).tone.hasTag("none"), true));
        $(Assert.equal(rows.get("a").kind.unwrap("table").series.get(0n).tone.hasTag("none"), true));
        const leafB = $.let(rows.get("b").kind.unwrap("table").series.get(0n).cells);
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
        const kind = $.let(rows.get("flow").kind.unwrap("table"));
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
        const b = $.let(rows.get("dock").kind.unwrap("buckets"));
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
        const chip = $.let(cardRows.get("crew").kind.unwrap("cards").chips.get(0n));
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
        const marks = $.let(eventRows.get("ms").kind.unwrap("events").marks);
        $(Assert.equal(marks.get(0n).kind.hasTag("milestone"), true));
        $(Assert.equal(marks.get(0n).label.unwrap("some"), "GO"));
        $(Assert.equal(marks.get(1n).kind.unwrap("decision").applied, true));
        $(Assert.equal(marks.get(2n).kind.hasTag("exception"), true));
    });

    // =========================================================================
    // Chart consumption
    // =========================================================================

    test("chart rows consume Chart layers as {t, y} data with axes and channels", $ => {
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const series = $.const([
            { week: W27, pct: 10.0 }, { week: W28, pct: 20.0 }, { week: W29, pct: 30.0 },
        ], ArrayType(MeasureRow));
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
        const chart = $.let(rows.get("c").kind.unwrap("chart"));
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
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const series = $.const([
            { week: W27, pct: 10.0 }, { week: W28, pct: 20.0 }, { week: W29, pct: 30.0 },
        ], ArrayType(MeasureRow));
        const rows = $.let(Plan.chart({
            key: "out", label: "OUT",
            layers: [
                Chart.Column(series, { x: r => r.week, y: r => r.pct }, { stack: "out", key: "L1" }),
                Chart.Column(series, { x: r => r.week, y: r => r.pct }, { stack: "out", key: "L2" }),
                Chart.Column(series, { x: r => r.week, y: r => r.pct }),
            ],
        }));
        const chart = $.let(rows.get("out").kind.unwrap("chart"));
        $(Assert.equal(chart.height.hasTag("spark"), true));
        $(Assert.equal(chart.expandedHeight.hasTag("none"), true));
        $(Assert.equal(chart.layers.get(0n).unwrap("column").series.unwrap("some"), "L1"));
        $(Assert.equal(chart.layers.get(1n).unwrap("column").series.unwrap("some"), "L2"));
        $(Assert.equal(chart.layers.get(2n).unwrap("column").series.hasTag("none"), true));
    });

    test("Chart.Bar, non-DateTime x accessors and temporal value-axis domains are build-time errors", $ => {
        const NumericRow = StructType({ x: FloatType, y: FloatType });
        const CategoryRow = StructType({ site: StringType, v: FloatType });
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const numeric = $.const([{ x: 1.0, y: 10.0 }, { x: 2.0, y: 20.0 }], ArrayType(NumericRow));
        const category = $.const([{ site: "A", v: 1.0 }, { site: "B", v: 2.0 }], ArrayType(CategoryRow));
        const measures = $.const([{ week: W27, pct: 10.0 }, { week: W28, pct: 20.0 }], ArrayType(MeasureRow));
        // The guards throw at AUTHORING time — probe them in place.
        $(Assert.equal(East.value((() => {
            try {
                Plan.chart({ key: "x", label: "X", layers: Chart.Bar(category, { x: r => r.v, y: r => r.site }) });
                return false;
            } catch { return true; }
        })()), true));
        $(Assert.equal(East.value((() => {
            try {
                Plan.chart({ key: "x", label: "X", layers: Chart.Line(numeric, { x: r => r.x, y: r => r.y }) });
                return false;
            } catch { return true; }
        })()), true));
        // A temporal extent on a VALUE axis mirrors Chart.Root's y-axis guard.
        $(Assert.equal(East.value((() => {
            try {
                Plan.chart({
                    key: "x", label: "X",
                    left: { domain: [W27, END] },
                    layers: Chart.Line(measures, { x: r => r.week, y: r => r.pct }),
                });
                return false;
            } catch { return true; }
        })()), true));
    });

    // =========================================================================
    // Groups + the data-driven forms
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
        $(Assert.equal(rows.size(), 3n));
        const g = $.let(rows.get("line2").kind.unwrap("group"));
        $(Assert.equal(g.collapsed.unwrap("some"), true));
        // The declaration; the renderer derives the strip cells.
        $(Assert.equal(g.summaryAggregate.unwrap("some").hasTag("mean"), true));
        $(Assert.equal(g.summary.hasTag("none"), true));
        $(Assert.equal(rows.get("a").parent.unwrap("some"), "line2"));
    });

    test("series.group discovered form builds one collapsed strip per by value with member-count meta", $ => {
        // The source is KEYED: the entry keys become the canvas row keys, so
        // the row's identity is the dataset's, not something re-derived.
        const LineRow = StructType({ line: StringType, v: FloatType });
        const data = $.const(new Map([
            ["a", { line: "L1", v: 40.0 }],
            ["b", { line: "L1", v: 60.0 }],
            ["c", { line: "L2", v: 80.0 }],
        ]), DictType(StringType, LineRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data,
            series: [
                Plan.series.group(LineRow, {
                    key: "lines", title: "Lines",
                    by: r => r.line, prefix: "line-", collapsed: true, summaryAggregate: "mean",
                }, [
                    Plan.series.heat(LineRow, {
                        key: "heat", title: "Heat",
                        label: (_r, k) => k,
                        cells: r => Plan.heatCells([{ at: W27, value: some(r.v), label: none }]),
                    }),
                ]),
            ],
        }));
        // L1 strip + 2 members, L2 strip + 1 member. Member keys are the
        // DATA's; strip keys carry the series' `prefix`, so two series
        // grouping the same column cannot land on one key.
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(rows.size(), 5n));
        $(Assert.equal(rows.get("line-L1").kind.unwrap("group").summaryAggregate.unwrap("some").hasTag("mean"), true));
        $(Assert.equal(rows.get("line-L1").kind.unwrap("group").collapsed.unwrap("some"), true));
        // The member count is NOT baked in — it is a renderer-side derivation
        // like every other aggregate (#568), so the IR carries no meta.
        $(Assert.equal(rows.get("line-L1").gutter.meta.hasTag("none"), true));
        $(Assert.equal(rows.get("a").parent.unwrap("some"), "line-L1"));
        $(Assert.equal(rows.get("b").parent.unwrap("some"), "line-L1"));
        $(Assert.equal(rows.get("c").parent.unwrap("some"), "line-L2"));
    });

    test("series span groupBy builds rollup parents per discovered value", $ => {
        const SpanRow = StructType({
            program: StringType,
            start: DateTimeType, end: DateTimeType, tonnes: FloatType,
        });
        const data = $.const(new Map([
            ["m1", { program: "A", start: W27, end: W29, tonnes: 96.0 }],
            ["m2", { program: "A", start: W28, end: W30, tonnes: 50.0 }],
            ["m3", { program: "B", start: W27, end: W28, tonnes: 10.0 }],
        ]), DictType(StringType, SpanRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data,
            series: [Plan.series.span(SpanRow, {
                key: "span", title: "Span",
                label: (_r, k) => k, id: true,
                runs: (r, k) => [Plan.run({ key: k, start: r.start, end: r.end, label: k, qty: r.tonnes, state: variant("confirmed", null) })],
                groupBy: [r => r.program], rollup: "union", unit: "t",
            })],
        }));
        // A parent + 2 members, B parent + 1 member. LEAF keys are the data's
        // own — untouched — and the synthesized parents key on the group value;
        // parents DECLARE the rollup + unit (the renderer derives the bands).
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(rows.size(), 5n));
        $(Assert.equal(rows.get("A").gutter.label, "A"));
        $(Assert.equal(rows.get("A").kind.unwrap("span").rollup.unwrap("some").hasTag("union"), true));
        $(Assert.equal(rows.get("A").kind.unwrap("span").unit.unwrap("some"), "t"));
        $(Assert.equal(rows.get("m1").parent.unwrap("some"), "A"));
        $(Assert.equal(rows.get("m2").parent.unwrap("some"), "A"));
        $(Assert.equal(rows.get("m3").parent.unwrap("some"), "B"));
    });

    test("a series `prefix` namespaces its whole series — leaves included (#568)", $ => {
        // Two series over the SAME keyed source would otherwise emit two rows
        // under one key. A prefix is the author moving one series off the
        // source key space deliberately; the default keeps the source's keys.
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([["m1", { v: 1.0 }], ["m2", { v: 2.0 }]]),
            DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data,
            series: [
                Plan.series.events(Row, {
                        key: "events", title: "Events", label: (_r, k) => k, marks: _r => [] }),
                Plan.series.events(Row, {
                        key: "events-2", title: "Events", prefix: "alt/", label: (_r, k) => k, marks: _r => [] }),
            ],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(rows.size(), 4n));
        // The unprefixed series keeps the SOURCE's keys — the property a paged
        // canvas needs, since `seek` addresses that key space.
        $(Assert.equal(rows.get("m1").gutter.label, "m1"));
        $(Assert.equal(rows.get("alt/m1").gutter.label, "m1"));
        $(Assert.equal(rows.get("alt/m2").gutter.label, "m2"));
    });

    test("series accessor channel: value/status/expand Options flow per row from raw fields", $ => {
        const JobRow = StructType({
            batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
        });
        const MachineRow = StructType({
            cap: FloatType, warn: BooleanType,
            expand: OptionType(Plan.Types.Expand),
            jobs: ArrayType(JobRow),
        });
        const data = $.const(new Map([
            // The expand declaration is a stored plain-data record (§3.2) —
            // presence is a per-row fact; no builders in the data.
            ["m1", { cap: 120.0, warn: true,
              expand: some({ height: some("152px"), axis: variant("keep", null) }),
              jobs: [{ batch: "B-1", start: W27, end: W28, state: variant("actual", null) }] }],
            ["m2", { cap: 80.0, warn: false, expand: none,
              jobs: [{ batch: "B-2", start: W28, end: W29, state: variant("confirmed", null) }] }],
        ]), DictType(StringType, MachineRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data,
            series: [Plan.series.span(MachineRow, {
                key: "span-2", title: "Span",
                label: (_r, k) => k, id: true,
                value: r => some(East.str`${East.Float.printFixed(r.cap, 0n)} t`),
                status: r => r.warn.ifElse(
                    () => East.value(some(variant("warning", null)), OptionType(StatusValueType)),
                    () => East.value(none, OptionType(StatusValueType))),
                expand: r => r.expand,
                runs: r => r.jobs.map((_$, j) => Plan.run({
                    key: j.batch, start: j.start, end: j.end,
                    label: East.str`RUN · ${j.batch}`, state: j.state,
                })),
            })],
        }));
        // Per-row presence + display, derived from the raw fields in the
        // stored make — nothing precomputed in the data.
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(rows.get("m1").gutter.value.unwrap("some"), "120 t"));
        $(Assert.equal(rows.get("m1").status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(rows.get("m2").status.hasTag("none"), true));
        $(Assert.equal(rows.get("m1").expand.hasTag("some"), true));
        $(Assert.equal(rows.get("m1").expand.unwrap("some").height.unwrap("some"), "152px"));
        $(Assert.equal(rows.get("m1").expand.unwrap("some").axis.hasTag("keep"), true));
        $(Assert.equal(rows.get("m2").expand.hasTag("none"), true));
        $(Assert.equal(rows.get("m1").kind.unwrap("span").runs.get(0n).label, "RUN · B-1"));
    });

    test("bucket lanes accept East arrays of PlanLaneType values", $ => {
        const lanes = $.const([{ key: "am", label: some("AM") }, { key: "pm", label: none }],
            ArrayType(Plan.Types.Lane));
        const rows = $.let(Plan.buckets({ key: "d", label: "D", lanes }));
        const b = $.let(rows.get("d").kind.unwrap("buckets"));
        $(Assert.equal(b.lanes.length(), 2n));
        $(Assert.equal(b.lanes.get(0n).label.unwrap("some"), "AM"));
        $(Assert.equal(b.lanes.get(1n).label.hasTag("none"), true));
    });

    // =========================================================================
    // Series — the data + series canvas
    // =========================================================================

    test("data+series: series build in series order, match filters, rollup parents declare", $ => {
        const JobRow = StructType({
            batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
        });
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType, hours: FloatType, state: EventStateType,
        });
        const OpsRow = StructType({
            line: StringType,
            kind: VariantType({
                machine: StructType({ jobs: ArrayType(JobRow) }),
                crew:    StructType({ shifts: ArrayType(ShiftRow) }),
            }),
        });
        const ops = $.const(new Map([
            ["m1", { line: "L1", kind: variant("machine", { jobs: [
                { batch: "B-1", start: W27, end: W29, state: variant("actual", null) }] }) }],
            ["m2", { line: "L1", kind: variant("machine", { jobs: [
                { batch: "B-2", start: W28, end: W30, state: variant("confirmed", null) }] }) }],
            ["c1", { line: "L1", kind: variant("crew", { shifts: [
                { key: "s1", from: W27, to: W29, hours: 80.0, state: variant("confirmed", null) }] }) }],
        ]), DictType(StringType, OpsRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data: ops,
            series: [
                Plan.series.span(OpsRow, {
                    key: "span-3", title: "Span",
                    match: r => r.kind.hasTag("machine"),
                    label: (_r, k) => k, id: true,
                    runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                        key: j.batch, start: j.start, end: j.end,
                        label: East.str`RUN · ${j.batch}`, state: j.state,
                    })),
                    groupBy: [r => r.line], rollup: "union", unit: "t",
                }),
                Plan.series.cards(OpsRow, {
                    key: "cards", title: "Cards",
                    match: r => r.kind.hasTag("crew"),
                    label: (_r, k) => k,
                    chips: r => r.kind.unwrap("crew").shifts.map(($, s) => {
                        const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
                        return Plan.chip({
                            key: s.key, from: s.from, to: s.to,
                            label: East.str`${hrs}h`, state: s.state,
                        });
                    }),
                }),
            ],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        // The span series's rollup parent + its two machines (the crew row
        // filtered out by match), plus the cards series's row; the chip label
        // derives from the raw hours in the stored make.
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get("L1").kind.unwrap("span").rollup.unwrap("some").hasTag("union"), true));
        $(Assert.equal(rows.get("L1").kind.unwrap("span").unit.unwrap("some"), "t"));
        $(Assert.equal(rows.get("m1").parent.unwrap("some"), "L1"));
        $(Assert.equal(rows.get("m1").kind.unwrap("span").runs.get(0n).label, "RUN · B-1"));
        $(Assert.equal(rows.get("m2").parent.unwrap("some"), "L1"));
        $(Assert.equal(rows.get("c1").kind.unwrap("cards").chips.length(), 1n));
        $(Assert.equal(rows.get("c1").kind.unwrap("cards").chips.get(0n).label, "80h"));
    });

    test("a $.const-bound series expression applies via the East fold", $ => {
        const JobRow = StructType({
            batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
        });
        const OpsRow = StructType({
            kind: VariantType({ machine: StructType({ jobs: ArrayType(JobRow) }) }),
        });
        const ops = $.const(new Map([
            ["m1", { kind: variant("machine", { jobs: [
                { batch: "B-1", start: W27, end: W29, state: variant("actual", null) }] }) }],
        ]), DictType(StringType, OpsRow));
        // The series list is itself an East VALUE — typed by the constructor.
        const series = $.const([
            Plan.series.span(OpsRow, {
                key: "span-4", title: "Span",
                label: (_r, k) => k,
                runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                    key: j.batch, start: j.start, end: j.end,
                    label: East.str`RUN · ${j.batch}`, state: j.state,
                })),
            }),
            Plan.series.rows(OpsRow, { key: "chrome", title: "Milestones" },
                [Plan.events({ key: "ms", label: "MS" })]),
        ], ArrayType(Plan.Types.Series(OpsRow)));
        const p = $.let(Plan.Root({ axis: Plan.axis({ resolution: "week" }), data: ops, series }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(rows.size(), 2n));
        $(Assert.equal(rows.get("m1").kind.unwrap("span").runs.length(), 1n));
        $(Assert.equal(rows.get("ms").kind.hasTag("events"), true));
    });

    test("series.group wraps child series under a strip; series.rows carries literal chrome", $ => {
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType, hours: FloatType, state: EventStateType,
        });
        const OpsRow = StructType({
            kind: VariantType({ crew: StructType({ shifts: ArrayType(ShiftRow) }) }),
        });
        const ops = $.const(new Map([
            ["crewA", { kind: variant("crew", { shifts: [
                { key: "s1", from: W27, to: W29, hours: 80.0, state: variant("confirmed", null) }] }) }],
        ]), DictType(StringType, OpsRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data: ops,
            series: [
                Plan.series.rows(OpsRow, { key: "chrome", title: "Milestones" },
                    [Plan.events({ key: "ms", label: "MILESTONES", id: true })]),
                Plan.series.group(OpsRow, { key: "crews", label: "Crews", meta: "1 rs" }, [
                    Plan.series.cards(OpsRow, {
                        key: "cards-2", title: "Cards",
                        label: (_r, k) => k,
                        chips: r => r.kind.unwrap("crew").shifts.map(($, s) => {
                            const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
                            return Plan.chip({
                                key: s.key, from: s.from, to: s.to,
                                label: East.str`${hrs}h`, state: s.state,
                            });
                        }),
                    }),
                ]),
            ],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(rows.size(), 3n));
        $(Assert.equal(rows.get("ms").kind.hasTag("events"), true));
        $(Assert.equal(rows.get("crews").kind.hasTag("group"), true));
        // Static chrome keeps its AUTHORED meta line verbatim.
        $(Assert.equal(rows.get("crews").gutter.meta.unwrap("some"), "1 rs"));
        $(Assert.equal(rows.get("crewA").parent.unwrap("some"), "crews"));
    });

    test("every series arm carries identity — a GROUP is the unit a person picks (#590)", $ => {
        const Row = StructType({ v: FloatType });
        // A STATIC group borrows the strip's own identity, so an existing
        // canvas becomes pickable without the author writing anything new.
        const g = $.let(Plan.series.group(Row, { key: "machines", label: "Machines", meta: "8 rs" }, []));
        $(Assert.equal(g.getTag(), "group"));
        $(Assert.equal(g.unwrap("group").key, "machines"));
        $(Assert.equal(g.unwrap("group").title, "Machines"));
        $(Assert.equal(g.unwrap("group").subtitle.unwrap("some"), "8 rs"));

        // A group with no meta simply has no sub-line.
        const bare = $.let(Plan.series.group(Row, { key: "docks", label: "Docks" }, []));
        $(Assert.equal(bare.unwrap("group").subtitle.hasTag("none"), true));

        // The DISCOVERED form makes MANY strips, so it cannot borrow one
        // strip's identity — it declares its own.
        const disc = $.let(Plan.series.group(Row, {
            key: "lines", title: "Lines", by: (_r) => East.value("L1"),
        }, []));
        $(Assert.equal(disc.unwrap("group").key, "lines"));
        $(Assert.equal(disc.unwrap("group").title, "Lines"));

        // Literal chrome names itself, so it can be switched off like anything
        // else rather than being the one row a user cannot turn off.
        const chrome = $.let(Plan.series.rows(Row, { key: "chrome", title: "Milestones" },
            [Plan.events({ key: "ms", label: "MS" })]));
        $(Assert.equal(chrome.getTag(), "rows"));
        $(Assert.equal(chrome.unwrap("rows").key, "chrome"));
        $(Assert.equal(chrome.unwrap("rows").title, "Milestones"));
    });

    test("Plan.pick reads identity off every arm and derives each series' row count (#590)", $ => {
        const Row = StructType({ line: StringType, v: FloatType });
        const data = $.const(new Map([
            ["a", { line: "L1", v: 40.0 }],
            ["b", { line: "L1", v: 60.0 }],
            ["c", { line: "L2", v: 80.0 }],
        ]), DictType(StringType, Row));
        const all = $.const([
            Plan.series.heat(Row, {
                key: "load", title: "Line load", subtitle: "per line",
                label: (_r, k) => k,
                cells: r => Plan.heatCells([{ at: W27, value: some(r.v), label: none }]),
            }),
            // A series matching nothing — the `0 rs` case the count exists to surface.
            Plan.series.events(Row, {
                key: "empty", title: "Nothing",
                match: (_r, _k) => false,
                label: (_r, k) => k, marks: _r => [],
            }),
            // A GROUP borrows the strip's identity, so the section is what the
            // library offers — the whole point of #590 §6.1.
            Plan.series.group(Row, { key: "machines", label: "Machines", meta: "3 rs" }, [
                Plan.series.span(Row, { key: "inner", title: "Inner", label: (_r, k) => k, runs: _r => [] }),
            ]),
        ], ArrayType(Plan.Types.Series(Row)));

        // The DESCRIPTORS — the bound path builds `items` from these same
        // accessors, so proving these proves it (State.bind is not runnable here).
        const items = $.let(Plan.pickItems(all, { data }));
        $(Assert.equal(items.length(), 3n));

        // Identity flows through from each arm's own fields.
        $(Assert.equal(items.get(0n).id, "load"));
        $(Assert.equal(items.get(0n).title, "Line load"));
        $(Assert.equal(items.get(0n).subtitle.unwrap("some"), "per line"));
        // The kind's documented glyph, rendered for the first time (#590 §4.3).
        $(Assert.equal(items.get(0n).icon.unwrap("some").name, "table-cells-large"));
        $(Assert.equal(items.get(1n).icon.unwrap("some").name, "flag"));
        // A group is listed as its strip: key, label and meta become the
        // series' identity, so "Machines" is the thing a person picks.
        $(Assert.equal(items.get(2n).id, "machines"));
        $(Assert.equal(items.get(2n).title, "Machines"));
        $(Assert.equal(items.get(2n).subtitle.unwrap("some"), "3 rs"));
        $(Assert.equal(items.get(2n).icon.unwrap("some").name, "layer-group"));

        // Counts are DERIVED by running each series' own pipeline: three heat
        // rows, nothing from the unmatched series, and the group's strip plus
        // its three members.
        $(Assert.equal(items.get(0n).count.unwrap("some"), 3n));
        $(Assert.equal(items.get(1n).count.unwrap("some"), 0n));
        $(Assert.equal(items.get(2n).count.unwrap("some"), 4n));

        // Omitting `data` omits the counts — what a paged canvas must say.
        const noData = $.let(Plan.pickItems(all));
        $(Assert.equal(noData.get(0n).count.hasTag("none"), true));
    });

    test("a paged data handle derives the canvas-row source — page wraps the series makes, total passes through", $ => {
        const JobRow = StructType({
            batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
        });
        const OpsRow = StructType({
            kind: VariantType({ machine: StructType({ jobs: ArrayType(JobRow) }) }),
        });
        const OpsSource = DictType(StringType, OpsRow);
        const ops = $.const(new Map([
            ["m1", { kind: variant("machine", { jobs: [
                { batch: "B-1", start: W27, end: W29, state: variant("actual", null) }] }) }],
        ]), OpsSource);
        // A hermetic paged handle — pure East fns windowing the captured KEYED
        // collection (the shape Data.bindPaged produces over a Dict dataset;
        // no platform involved).
        const handle = $.const({
            page: East.function([IntegerType, IntegerType], OptionType(OpsSource), ($, o, _l) => {
                const noPage = $.const(none, OptionType(OpsSource));
                return o.equal(0n).ifElse(() => some(ops), () => noPage);
            }),
            total: East.function([], OptionType(IntegerType), (_$) => some(1n)),
        }, StructType({
            page: FunctionType([IntegerType, IntegerType], OptionType(OpsSource)),
            total: FunctionType([], OptionType(IntegerType)),
        }));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ resolution: "week" }),
            data: handle,
            series: [Plan.series.span(OpsRow, {
                key: "span-5", title: "Span",
                label: (_r, k) => k,
                runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                    key: j.batch, start: j.start, end: j.end,
                    label: East.str`RUN · ${j.batch}`, state: j.state,
                })),
            })],
        }));
        // The stored source is the DERIVED handle at the canvas-row type —
        // each window's RAW rows flow through the same accessor derivations.
        const src = $.let(p.unwrap().unwrap("Plan").rows.unwrap("paged"));
        $(Assert.equal(src.total().unwrap("some"), 1n));
        // A window is the canvas's KEYED collection, not an array (#568).
        const w0 = $.let(src.page(0n, 100n));
        $(Assert.equal(w0.unwrap("some").size(), 1n));
        $(Assert.equal(w0.unwrap("some").get("m1").kind.unwrap("span").runs.length(), 1n));
        $(Assert.equal(w0.unwrap("some").get("m1").kind.unwrap("span").runs.get(0n).label, "RUN · B-1"));
        // A window the author's handle can't serve stays none (loading).
        $(Assert.equal(src.page(1n, 100n).hasTag("none"), true));
    });

}, { platformFns: TestImpl });
