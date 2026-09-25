/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, BooleanType, DateTimeType, DictType, East, EastTypeType, FloatType, FunctionType, IntegerType, NullType, OptionType, RecursiveType, StringType, StructType, VariantType, isTypeEqual, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ApprovalStateType, CellRefType, Chart, Editing, Plan, Text, type PlanSeriesValue } from "@elaraai/east-ui/internal";
import { EventStateType, Format, Paged, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import * as ex from "./plan.examples.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const W30 = new Date("2026-07-20T00:00:00Z");
const W31 = new Date("2026-07-27T00:00:00Z");
const END = new Date("2026-09-21T00:00:00Z");

// The Plan arm as `component.ts` spells it, and its named twin in `ir.ts`, as
// East TYPE VALUES — the form the arm-equality test compares them in (#814).
const PLAN_ARM = toEastTypeValue(UIComponentType.node.cases.Plan);
const PLAN_ROOT = toEastTypeValue(Plan.Types.Root);

describeEast("Plan", (test) => {
    Assert.examples(test, {
        planTargetState: ex.planTargetState,
        planVariants: ex.planVariants,
        planSpanRows: ex.planSpanRows,
        planBucketRows: ex.planBucketRows,
        planChartRows: ex.planChartRows,
        planHeatRows: ex.planHeatRows,
        planTableRows: ex.planTableRows,
        planFold: ex.planFold,
        planCardRows: ex.planCardRows,
        planEventRows: ex.planEventRows,
        planGroupedRows: ex.planGroupedRows,
        planSeriesData: ex.planSeriesData,
        planLiteralRows: ex.planLiteralRows,
        planPick: ex.planPick,
        planLibraryDnd: ex.planLibraryDnd,
        planRowDrop: ex.planRowDrop,
        planFill: ex.planFill,
        planReview: ex.planReview,
        planEditing: ex.planEditing,
        planUiState: ex.planUiState,
        // Was never wired — the example shipped without ever being executed.
        planExpand: ex.planExpand,
        planNarrow: ex.planNarrow,
        planNumberAxis: ex.planNumberAxis,
        planOrdinalAxis: ex.planOrdinalAxis,
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
        // `Plan.axis({ … })` is the TIME shorthand — the arm IS the declaration (#631).
        $(Assert.equal(root.axis.getTag(), "time"));
        const axis = $.let(root.axis.unwrap("time"));
        $(Assert.equal(axis.window.unwrap("some").min, W27));
        $(Assert.equal(axis.window.unwrap("some").max, END));
        $(Assert.equal(axis.resolution.hasTag("week"), true));
        $(Assert.equal(axis.resolutions.length(), 2n));
        $(Assert.equal(axis.resolutions.get(1n).hasTag("day"), true));
        $(Assert.equal(axis.now.unwrap("some"), W31));
        $(Assert.equal(axis.format.unwrap("some"), "W"));
        $(Assert.equal(root.grain.unwrap("some").hasTag("group"), true));
        $(Assert.equal(root.id.unwrap("some"), "plan"));
        $(Assert.equal(root.sources.get(0n), "lib"));
        $(Assert.equal(root.footer.get(0n).tone.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(root.footer.get(0n).end, true));
        $(Assert.equal(root.style.unwrap("some").height.unwrap("some"), "fill"));
        $(Assert.equal(root.style.unwrap("some").density.unwrap("some").hasTag("compact"), true));
        $(Assert.equal(root.style.unwrap("some").gutterWidth.unwrap("some"), "168px"));
        // Empty data × no series ⇒ an empty inline canvas: no blocks (#823).
        $(Assert.equal(root.rows.unwrap("inline").size(), 0n));
        // Nothing declared, nothing carried: no element callback, no bound state.
        $(Assert.equal(root.onElementClick.hasTag("none"), true));
        $(Assert.equal(root.ui.hasTag("none"), true));
    });

    test("a root with no `id` is no drop target — `none`, not an empty-string sentinel (#824)", $ => {
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [],
            footer: [{ text: "RUN 412" }],
        }));
        const root = $.let(p.unwrap().unwrap("Plan"));
        $(Assert.equal(root.id.hasTag("none"), true));
        // A footer item not pushed to the end is `false`, never `none`.
        $(Assert.equal(root.footer.get(0n).end, false));
    });

    test("the component.ts Plan arm and PlanRootType are one East type (#814)", $ => {
        // `component.ts` spells the arm inline, because its resolver slots
        // need the recursion `node`; `ir.ts` names the same shape at the
        // resolved `UIComponentType`, and the renderer decodes the arm's values
        // through that name. Neither is built from the other. `Plan.Root`
        // constructs the arm, so a field the arm gains alone fails the build —
        // but a field, or a field type, that only `PlanRootType` has reaches
        // the renderer silently. This is the check that notices.
        const arm = $.const(PLAN_ARM, EastTypeType);
        const root = $.const(PLAN_ROOT, EastTypeType);
        const armFields = $.let(arm.unwrap().unwrap("Struct"));
        const rootFields = $.let(root.unwrap().unwrap("Struct"));
        // The same fields in the same order — a missing one shows in the diff.
        $(Assert.equal(armFields.map((_$, f) => f.name), rootFields.map((_$, f) => f.name)));
        // The same type in every field — a drifted field is named, not printed
        // (a field type that mentions `UIComponentType` prints all of it).
        $(Assert.equal(
            rootFields.filter((_$, f, i) => East.equal(f.type, armFields.get(i).type).not()).map((_$, f) => f.name),
            [],
        ));
    });

    test("a canvas states its axis window or binds a slice — there is no fit to the data (#822)", $ => {
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        // No window and no slice: refused at BUILD time, naming the fix — the
        // same for a time axis and a number axis. An ordinal axis's list IS
        // its window.
        const refusal = (() => {
            try { Plan.Root({ axis: Plan.axis({ resolution: "week" }), data, series: [] }); return ""; }
            catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(refusal.includes("the axis states no `window` and no `slice` is bound")), true));
        const numberRefused = (() => {
            try { Plan.Root({ axis: Plan.axis.number({ step: 1 }), data, series: [] }); return false; }
            catch { return true; }
        })();
        $(Assert.equal(East.value(numberRefused), true));
        const ordinal = $.let(Plan.Root({ axis: Plan.axis.ordinal({ values: ["P1", "P2"] }), data, series: [] }));
        $(Assert.equal(ordinal.unwrap().unwrap("Plan").axis.getTag(), "ordinal"));
        // A stated window builds, inline or paged alike.
        const stated = $.let(Plan.Root({ axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }), data, series: [] }));
        $(Assert.equal(stated.unwrap().unwrap("Plan").axis.unwrap("time").window.hasTag("some"), true));
    });

    test("review config defaults the column and rerun labels; the chrome carries no verdict callback (#880)", $ => {
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [],
            review: { onRerun: East.function([], NullType, (_$) => null) },
        }));
        const review = $.let(p.unwrap().unwrap("Plan").review.unwrap("some"));
        $(Assert.equal(review.columnLabel, "Decision"));
        $(Assert.equal(review.rerunLabel, "Rerun"));
        $(Assert.equal(review.onRerun.hasTag("some"), true));
        $(Assert.equal(review.summary.hasTag("none"), true));
        // Review alone takes no gesture: without `editing` there is no session.
        $(Assert.equal(p.unwrap().unwrap("Plan").editing.hasTag("none"), true));
    });

    test("the root carries the link graph (R1); Plan.link maps over data — a key, two run refs and a quantity (#824)", $ => {
        const Row = StructType({ id: StringType });
        const TransferRow = StructType({ id: StringType, src: StringType, srcRun: StringType, dst: StringType, dstRun: StringType, t: FloatType });
        const transfers = $.const([
            { id: "t1", src: "m03", srcRun: "b214", dst: "m04", dstRun: "b208", t: 24.0 },
            { id: "t2", src: "m04", srcRun: "b208", dst: "dock2", dstRun: "d1", t: 18.0 },
        ], ArrayType(TransferRow));
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [],
            links: transfers.map((_$, tr) => Plan.link({
                key: tr.id,
                from: Plan.ref("machines", tr.src), fromRun: tr.srcRun,
                to: Plan.ref("machines", tr.dst), toRun: tr.dstRun,
                quantity: Plan.quantity(tr.t, { unit: "t", format: Format.Number({ maximumFractionDigits: 0n }) }),
            })),
        }));
        const links = $.let(p.unwrap().unwrap("Plan").links);
        $(Assert.equal(links.length(), 2n));
        $(Assert.equal(links.get(0n).key, "t1"));
        // The ends are RUN refs — a row's id and a run's key.
        $(Assert.equal(links.get(0n).from.row, Plan.ref("machines", "m03")));
        $(Assert.equal(links.get(0n).from.run, "b214"));
        $(Assert.equal(links.get(0n).to.row, Plan.ref("machines", "m04")));
        $(Assert.equal(links.get(0n).to.run, "b208"));
        // ONE quantity: the value weighs the ribbon, the unit and format print
        // its caption — there is no second, display-only string to disagree.
        const q = $.let(links.get(0n).quantity.unwrap("some"));
        $(Assert.equal(q.value, 24.0));
        $(Assert.equal(q.unit.unwrap("some"), "t"));
        $(Assert.equal(q.format.unwrap("some").unwrap("number").maximumFractionDigits.unwrap("some"), 0n));
        $(Assert.equal(q.text.hasTag("none"), true));
        // A link may carry no quantity at all — it then draws at the faintest share.
        const bare = $.let(Plan.link({ key: "x", from: Plan.ref("a", "1"), fromRun: "r", to: Plan.ref("a", "2"), toRun: "r" }));
        $(Assert.equal(bare.quantity.hasTag("none"), true));
    });

    test("rows DECLARE expand-in-place as pure data (R2); the render is the root's expandRender resolver", $ => {
        const rows = $.let(Plan.span({
            key: "m13", label: "L4-M13",
            expand: { height: "152px", axis: "dim" },
        }));
        const declared = $.let(rows.get(0n).expand.unwrap("some"));
        $(Assert.equal(declared.height.unwrap("some"), "152px"));
        $(Assert.equal(declared.axis.hasTag("dim"), true));
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
        // ONE stored function per surface — every ref carries the row's id, so
        // one resolver covers every element kind; returning none opens no surface.
        const Row = StructType({ id: StringType });
        const popover = $.const(East.function([Plan.Types.ElementRef], OptionType(UIComponentType), ($, ref) => {
            const noBody = $.const(none, OptionType(UIComponentType));
            return ref.match({
                run: (_$, ev) => ev.run.equal("b214").ifElse(
                    () => some(Text.Root("RUN DETAIL")),
                    () => noBody),
            }, _$ => noBody);
        }));
        const expandRender = $.const(East.function([Plan.Types.RowId], UIComponentType, (_$, _id) =>
            Text.Root("UTIL RENDER")));
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [],
            popover,
            expandRender,
        }));
        const root = $.let(p.unwrap().unwrap("Plan"));
        // The stored popover resolves per ref: the named run opens, any other
        // element (a chip here) resolves none — presence is lazy, per ref.
        const runRef = $.const(variant("run", { row: Plan.ref("machines", "m03"), run: "b214" }), Plan.Types.ElementRef);
        const chipRef = $.const(variant("chip", { row: Plan.ref("crews", "crew"), chip: "s1" }), Plan.Types.ElementRef);
        $(Assert.equal(root.popover.unwrap("some")(runRef).hasTag("some"), true));
        $(Assert.equal(root.popover.unwrap("some")(chipRef).hasTag("none"), true));
        // Hover is independent and absent here; expandRender builds the body.
        $(Assert.equal(root.hover.hasTag("none"), true));
        const body = $.let(root.expandRender.unwrap("some")(Plan.ref("machines", "m13")), UIComponentType);
        $(Assert.equal(body.unwrap().hasTag("Text"), true));
    });

    // =========================================================================
    // The row id (#822) — every payload that names a row carries it
    // =========================================================================

    test("a row id is its series and the path of entry keys — Plan.ref / Plan.sectionRef build one", $ => {
        const machine = $.let(Plan.ref("machine-jobs", "L1", "m03"));
        $(Assert.equal(machine.getTag(), "entry"));
        $(Assert.equal(machine.unwrap("entry").series, "machine-jobs"));
        $(Assert.equal(machine.unwrap("entry").path, ["L1", "m03"]));
        const header = $.let(Plan.sectionRef("crew-block", "L1"));
        $(Assert.equal(header.getTag(), "section"));
        $(Assert.equal(header.unwrap("section").path, ["L1"]));
        // A top-level section sits at the empty path.
        $(Assert.equal(Plan.sectionRef("docks").unwrap("section").path.size(), 0n));
    });

    test("select carries the row id", $ => {
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Root.fields.onSelect.cases.some.inputs[0], Plan.Types.RowId)), true));
    });

    test("ONE element callback over the element ref, whose every row-bound arm carries the row id (#824)", $ => {
        const Id = Plan.Types.RowId;
        const cases = Plan.Types.ElementRef.cases;
        // `onElementClick` takes the SAME ref the popover / hover resolvers do.
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Root.fields.onElementClick.cases.some.inputs[0], Plan.Types.ElementRef)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Root.fields.popover.cases.some.inputs[0], Plan.Types.ElementRef)), true));
        // The five per-kind callbacks are gone — one function, one variant.
        $(Assert.equal(East.value(["onRunClick", "onEventClick", "onMarkClick", "onChipClick", "onCellClick"]
            .some((f) => f in Plan.Types.Root.fields)), false));
        for (const arm of ["run", "event", "chip", "mark", "cell"] as const) {
            $(Assert.equal(East.value(isTypeEqual(cases[arm].fields.row, Id)), true));
        }
        // A link belongs to no one row: it names itself by key, and its two
        // ends are run refs.
        $(Assert.equal(East.value(isTypeEqual(cases.link.fields.key, StringType)), true));
        $(Assert.equal(East.value(isTypeEqual(cases.link.fields.from, Plan.Types.RunRef)), true));
        $(Assert.equal(East.value(isTypeEqual(cases.link.fields.to, Plan.Types.RunRef)), true));
        $(Assert.equal(East.value(isTypeEqual(cases.run, Plan.Types.RunRef)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.GroupToggleEvent.fields.row, Id)), true));
        // The root carries it, and it runs over any arm.
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const onElementClick = $.const(East.function([Plan.Types.ElementRef], NullType, (_$, _ref) => null));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data, series: [], onElementClick,
        }));
        const link = $.const(variant("link", {
            key: "t1",
            from: { row: Plan.ref("machines", "m03"), run: "b214" },
            to: { row: Plan.ref("machines", "m04"), run: "b208" },
        }), Plan.Types.ElementRef);
        $(Assert.equal(p.unwrap().unwrap("Plan").onElementClick.unwrap("some")(link), null));
    });

    test("links name their ends by run ref — a row id and a run key", $ => {
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Link.fields.from, Plan.Types.RunRef)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Link.fields.to, Plan.Types.RunRef)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.RunRef.fields.row, Plan.Types.RowId)), true));
    });

    test("Plan.uiState seeds a bound interaction state; the root carries the host's handle as is (#824)", $ => {
        // Omitted, every field is empty: nothing selected, every row as it
        // declares, no chart expanded, nothing to bring into view.
        const empty = $.let(Plan.uiState());
        $(Assert.equal(empty.selected.hasTag("none"), true));
        $(Assert.equal(empty.collapsed.size(), 0n));
        $(Assert.equal(empty.expanded.size(), 0n));
        $(Assert.equal(empty.charts.size(), 0n));
        $(Assert.equal(empty.focus.hasTag("none"), true));
        const seeded = $.let(Plan.uiState({
            selected: Plan.ref("machines", "L1", "m03"),
            collapsed: [Plan.ref("lines", "L2")],
            expanded: [Plan.ref("lines", "L3")],
            charts: [Plan.ref("kpi", "cov")],
            focus: Plan.ref("machines", "L3", "m07"),
        }));
        $(Assert.equal(seeded.selected.unwrap("some"), Plan.ref("machines", "L1", "m03")));
        $(Assert.equal(seeded.collapsed, [Plan.ref("lines", "L2")]));
        $(Assert.equal(seeded.expanded, [Plan.ref("lines", "L3")]));
        $(Assert.equal(seeded.charts, [Plan.ref("kpi", "cov")]));
        $(Assert.equal(seeded.focus.unwrap("some"), Plan.ref("machines", "L3", "m07")));
        // The lists hold the canvas's typed ids; an id's path is an Array, so
        // they are Arrays — an East Set's element must be immutable.
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.UiState.fields.collapsed, ArrayType(Plan.Types.RowId))), true));
        // Folded AND opened are both overrides of the declaration — a row in
        // neither follows what it declares.
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.UiState.fields.expanded, ArrayType(Plan.Types.RowId))), true));
        // A handle of State.bind's shape — here a hermetic one over a captured
        // store — rides the root unchanged: what the canvas writes through it,
        // it reads back through it.
        const store = $.let(new Map([["ui", Plan.uiState()]]), DictType(StringType, Plan.Types.UiState));
        const handle = $.const({
            read: East.function([], Plan.Types.UiState, (_$) => store.get("ui")),
            write: East.function([Plan.Types.UiState], NullType, ($, s) => { $(store.update("ui", s)); }),
            has: East.function([], BooleanType, (_$) => true),
        }, Plan.Types.UiBind);
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data, series: [], ui: handle,
        }));
        const ui = $.let(p.unwrap().unwrap("Plan").ui.unwrap("some"));
        $(ui.write(seeded));
        $(Assert.equal(ui.read(), seeded));
        $(Assert.equal(ui.has(), true));
    });

    test("the review chrome carries no verdict callback, and the root no onDrag — both are gestures of `editing` (#880)", $ => {
        // A verdict and a drop are drafts of the session; only Rerun, which
        // changes no data, stays a callback.
        $(Assert.equal(East.value(Object.keys(Plan.Types.Review.fields)), ["columnLabel", "summary", "onRerun", "rerunLabel"]));
        $(Assert.equal(East.value("onDrag" in Plan.Types.Root.fields), false));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Root.fields.editing, OptionType(Plan.Types.Editing))), true));
        // Every gesture reaches a row through the row's own flags.
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Row.fields.edits, Plan.Types.RowEdits)), true));
    });

    test("expand renders receive the row id", $ => {
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Root.fields.expandRender.cases.some.inputs[0], Plan.Types.RowId)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Root.fields.expandGutter.cases.some.inputs[0], Plan.Types.RowId)), true));
    });

    test("a drag names its row by the id's canonical text, which parses back", $ => {
        // The shared drag grammar stays string-based: `CellRef.row` is text,
        // and a Plan writes the id's `.east` text there.
        $(Assert.equal(East.value(isTypeEqual(CellRefType.fields.row, StringType)), true));
        const id = $.let(Plan.ref("machines", "L1", "m03"));
        const text = $.let(East.print(id));
        $(Assert.equal(text.parse(Plan.Types.RowId), id));
    });

    // =========================================================================
    // Editing (#880) — every change a draft of the session; the wire itself is
    // driven from the host in plan-editing.spec.ts
    // =========================================================================

    test("a reviewed series' rows show the field a verdict writes, and every row says which gestures it takes (#880)", $ => {
        const Row = StructType({ approval: ApprovalStateType, marks: ArrayType(Plan.Types.EventMark) });
        const data = $.const(new Map([["a", { approval: variant("rejected", null), marks: [] }]]), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [
                Plan.series.span(Row, { key: "reviewed", title: "Reviewed", label: (_r, k) => k, review: { verdict: "approval" }, runs: _r => [] }),
                Plan.series.events(Row, {
                    key: "dropped", title: "Dropped", label: (_r, k) => k, marks: r => r.marks,
                    edit: { items: "marks", create: (drop) => ({ key: drop.from.key, at: drop.at, kind: variant("milestone", null), icon: none, label: none }) },
                }),
                // A verdict the canvas only SHOWS — nothing to write it into.
                Plan.series.span(Row, { key: "shown", title: "Shown", label: (_r, k) => k, approval: r => some(r.approval), runs: _r => [] }),
                Plan.series.rows(Row, { key: "chrome", title: "Chrome" }, [Plan.events({ key: "ms", label: "MS" })]),
            ],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        $(Assert.equal(rows.get(0n).approval.unwrap("some").hasTag("rejected"), true));
        $(Assert.equal(rows.get(0n).edits, { verdict: true, drop: false }));
        $(Assert.equal(rows.get(1n).approval.hasTag("none"), true));
        $(Assert.equal(rows.get(1n).edits, { verdict: false, drop: true }));
        $(Assert.equal(rows.get(2n).approval.unwrap("some").hasTag("rejected"), true));
        $(Assert.equal(rows.get(2n).edits, { verdict: false, drop: false }));
        // A hand-built row belongs to no entry, so it takes no gesture either.
        $(Assert.equal(rows.get(3n).edits, { verdict: false, drop: false }));
    });

    test("review and edit name fields of the entry — another field, or review beside approval, fails the build naming the series (#880)", $ => {
        const Row = StructType({ approval: ApprovalStateType, jobs: ArrayType(StringType), note: StringType });
        const refusal = (build: () => unknown): string => {
            try { build(); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
        };
        const notVerdict = refusal(() => Plan.series.span(Row, {
            key: "a", title: "A", label: (_r, k) => k, runs: _r => [], review: { verdict: "note" as never },
        }));
        $(Assert.equal(East.value(notVerdict.includes('Plan.series.span "a": `review.verdict` names "note", which is not an ApprovalStateType field')), true));
        const both = refusal(() => Plan.series.span(Row, {
            key: "b", title: "B", label: (_r, k) => k, runs: _r => [], review: { verdict: "approval" }, approval: r => some(r.approval),
        }));
        $(Assert.equal(East.value(both.includes("not both")), true));
        const notList = refusal(() => Plan.series.span(Row, {
            key: "c", title: "C", label: (_r, k) => k, runs: _r => [], edit: { items: "note" as never, create: () => "x" },
        }));
        $(Assert.equal(East.value(notList.includes('`edit.items` names "note", which is not an Array field')), true));
        // An entry that is not a struct has no field to write.
        const Group = DictType(StringType, Row);
        const notStruct = refusal(() => (Plan.series.span as (...args: unknown[]) => unknown)(Group, {
            key: "d", title: "D", label: () => "D", runs: () => [], review: { verdict: "approval" },
        }));
        $(Assert.equal(East.value(notStruct.includes("its entries must be structs")), true));
    });

    test("a gesture below an entry is written back through a field — an editable series under a computed collection is refused (#880)", $ => {
        const Machine = StructType({ approval: ApprovalStateType, runs: IntegerType });
        const Line = StructType({ machines: DictType(StringType, Machine) });
        const refusal = (build: () => unknown): string => {
            try { build(); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
        };
        const reviewed = () => Plan.series.span(Machine, {
            key: "machines", title: "Machines", label: (_m, k) => k, runs: _m => [], review: { verdict: "approval" },
        });
        // A filtered collection is a copy: a verdict written into it would be lost.
        const filtered = refusal(() => Plan.series.span(Line, {
            key: "lines", title: "Lines", label: (_l, k) => k, runs: _l => [],
            children: Plan.children(l => l.machines.filter((_$, m) => m.runs.greater(0n)), [reviewed()]),
        }));
        $(Assert.equal(East.value(filtered.includes("`of` must read a field of the entry")), true));
        // The field itself, or the entry itself, is written in place.
        $(Assert.equal(East.value(refusal(() => Plan.series.span(Line, {
            key: "lines", title: "Lines", label: (_l, k) => k, runs: _l => [],
            children: Plan.children(l => l.machines, [reviewed()]),
        }))), ""));
        $(Assert.equal(East.value(refusal(() => Plan.series.group(DictType(StringType, Machine), {
            key: "groups", title: "Groups", label: (_g, k) => k,
            children: Plan.children(g => g, [reviewed()]),
        }))), ""));
        // A computed collection under series that take no gesture has nothing to write back.
        $(Assert.equal(East.value(refusal(() => Plan.series.span(Line, {
            key: "lines", title: "Lines", label: (_l, k) => k, runs: _l => [],
            children: Plan.children(l => l.machines.filter((_$, m) => m.runs.greater(0n)), [
                Plan.series.span(Machine, { key: "machines", title: "Machines", label: (_m, k) => k, runs: _m => [] }),
            ]),
        }))), ""));
        // A recursive series walks its own children: they too must be a field.
        const Tree = RecursiveType((self) => StructType({ approval: ApprovalStateType, kids: DictType(StringType, self) }));
        const walked = refusal(() => Plan.series.span(Tree, {
            key: "tree", title: "Tree", label: (_t, k) => k, runs: _t => [], review: { verdict: "approval" },
            children: t => t.kids.filter((_$, kid) => kid.unwrap().approval.hasTag("pending")),
        }));
        $(Assert.equal(East.value(walked.includes("`children` — which must read a field of the entry")), true));
    });

    test("editing is checked at build — one apply, a live handle for onUpdate, an apply for auto, a revision for a paged apply, and every callback's signature (#880)", $ => {
        const Row = StructType({ approval: ApprovalStateType });
        const Rows = DictType(StringType, Row);
        const data = $.const(new Map([["a", { approval: variant("pending", null) }]]), Rows);
        const series = [Plan.series.span(Row, { key: "rows", title: "Rows", label: (_r, k) => k, runs: _r => [], review: { verdict: "approval" } })];
        const axis = Plan.axis({ window: { min: W27, max: END }, resolution: "week" });
        type Config = Parameters<typeof Plan.Root>[0];
        const refusal = (editing: NonNullable<Config["editing"]>, source: Config["data"] = data): string => {
            try { Plan.Root({ axis, data: source, series, editing }); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
        };
        const onApply = East.function([Editing.Types.ChangeSet(Row, StringType)], Editing.Types.ApplyResult, () => variant("applied", { revision: none }));
        const onUpdate = East.function([Rows], NullType, () => null);
        $(Assert.equal(East.value(refusal({ onApply, onUpdate }).includes("not both")), true));
        $(Assert.equal(East.value(refusal({ onUpdate }).includes("editing.onUpdate requires data={liveHandle}")), true));
        $(Assert.equal(East.value(refusal({ mode: "auto" }).includes("it needs onApply or onUpdate")), true));
        // A paged source without revision and refresh cannot check a batch.
        const paged = East.value({
            page: East.function([IntegerType, IntegerType], OptionType(Rows), () => none),
            total: East.function([], OptionType(IntegerType), () => none),
        }, StructType({ page: FunctionType([IntegerType, IntegerType], OptionType(Rows)), total: FunctionType([], OptionType(IntegerType)) }));
        $(Assert.equal(East.value(refusal({ onApply }, paged).includes("needs its revision and refresh")), true));
        // A callback over another entry or key type is named with the signature it must have.
        const Other = StructType({ approval: ApprovalStateType, extra: StringType });
        const wrongApply = East.function([Editing.Types.ChangeSet(Other, StringType)], Editing.Types.ApplyResult, () => variant("applied", { revision: none }));
        $(Assert.equal(East.value(refusal({ onApply: wrongApply }).includes("editing.onApply must be an East sync or async function over Editing.Types.ChangeSet(R, K)")), true));
        const wrongPatch = East.function([Plan.Types.PatchEvent(Other)], NullType, () => null);
        $(Assert.equal(East.value(refusal({ onPatch: wrongPatch }).includes("editing.onPatch must be an East function over Plan.Types.PatchEvent(R)")), true));
        const wrongReady = East.function([Row, IntegerType], Editing.Types.Readiness, () => variant("ready", null));
        $(Assert.equal(East.value(refusal({ ready: wrongReady }).includes("editing.ready must be an East function over this canvas's entry and key (R, K)")), true));
        // The right signatures build, and the wire carries them.
        const onPatch = East.function([Plan.Types.PatchEvent(Row)], NullType, () => null);
        const ready = East.function([Row, StringType], Editing.Types.Readiness, () => variant("ready", null));
        const p = $.let(Plan.Root({ axis, data, series, editing: { onApply, onPatch, ready, mode: "auto" } }));
        const wire = $.let(p.unwrap().unwrap("Plan").editing.unwrap("some"));
        $(Assert.equal(wire.onApply.unwrap("some").hasTag("sync"), true));
        $(Assert.equal(wire.onPatch.hasTag("some"), true));
        $(Assert.equal(wire.ready.hasTag("some"), true));
        $(Assert.equal(wire.mode.hasTag("auto"), true));
        $(Assert.equal(wire.snapshot.unwrap("some").decodeBeast(Rows, "v2"), data));
    });

    test("the removed onDrag and review verbs fail with the migration named (#880)", $ => {
        const Row = StructType({ approval: ApprovalStateType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const axis = Plan.axis({ window: { min: W27, max: END }, resolution: "week" });
        const refusal = (config: Record<string, unknown>): string => {
            try { Plan.Root({ axis, data, series: [], ...config } as Parameters<typeof Plan.Root>[0]); return ""; }
            catch (e) { return e instanceof Error ? e.message : String(e); }
        };
        const noop = East.function([], NullType, () => null);
        const drag = refusal({ onDrag: noop });
        $(Assert.equal(East.value(drag.includes("`onDrag` is removed (#880)") && drag.includes("`edit: { items, create }`")), true));
        const verbs = refusal({ review: { onApprove: noop, onRejectAll: noop } });
        $(Assert.equal(East.value(verbs.includes("review.onApprove / review.onRejectAll are removed (#880)") && verbs.includes("review: { verdict: \"approval\" }")), true));
    });

    test("Plan.Types.PatchEvent(R) is the shared patch event over whole-entry drafts (#880)", $ => {
        const Row = StructType({ approval: ApprovalStateType, note: StringType });
        const event = Plan.Types.PatchEvent(Row);
        $(Assert.equal(East.value(isTypeEqual(event.fields.draftChanges, ArrayType(Editing.Types.Change(Editing.Types.DraftField(Row))))), true));
        $(Assert.equal(East.value(isTypeEqual(event.fields.domainChanges, OptionType(ArrayType(Editing.Types.Change(Row))))), true));
        $(Assert.equal(East.value(isTypeEqual(event.fields.origin, Editing.Types.Origin)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Gesture.cases.verdict, ApprovalStateType)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Drop.fields.row, Plan.Types.RowId)), true));
        $(Assert.equal(East.value(isTypeEqual(Plan.Types.Drop.fields.at, Plan.Types.Instant)), true));
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

    test("run carries ONE quantity (value, unit, format, caption override), status ring, moved and a bare-name icon (#824)", $ => {
        const r = $.let(Plan.run({
            key: "r", start: W27, end: W28, label: "RUN",
            quantity: Plan.quantity(96, { unit: "t", format: Format.Number({ maximumFractionDigits: 0n }) }),
            state: "actual", status: "warning", moved: 3, icon: "truck",
        }));
        const q = $.let(r.quantity.unwrap("some"));
        $(Assert.equal(q.value, 96.0));
        $(Assert.equal(q.unit.unwrap("some"), "t"));
        $(Assert.equal(q.format.unwrap("some").hasTag("number"), true));
        $(Assert.equal(q.text.hasTag("none"), true));
        $(Assert.equal(r.status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(r.moved.unwrap("some"), 3n));
        $(Assert.equal(r.icon.unwrap("some").prefix, "fas"));
        $(Assert.equal(r.icon.unwrap("some").name, "truck"));
        // The display string and its numeric twin are gone — one value.
        $(Assert.equal(East.value("qty" in Plan.Types.Run.fields), false));
        // A caption override keeps the number: it still sums and weighs.
        const told = $.let(Plan.quantity(24, { unit: "t", text: "−24 t" }));
        $(Assert.equal(told.value, 24.0));
        $(Assert.equal(told.text.unwrap("some"), "−24 t"));
        // A bare quantity is a number with nothing else declared.
        const bare = $.let(Plan.quantity(3.5));
        $(Assert.equal(bare.unit.hasTag("none"), true));
        $(Assert.equal(bare.format.hasTag("none"), true));
        // A run without one carries none.
        $(Assert.equal(Plan.run({ key: "n", start: W27, end: W28, label: "N", state: "actual" }).quantity.hasTag("none"), true));
    });

    // =========================================================================
    // Composition — the kind factories' row streams (hand-built rows)
    // =========================================================================

    test("span nesting composes into ONE stream — each parent followed by its subtree, ids carrying the path", $ => {
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
        // Pre-order: the parent, then its subtree, in authored order.
        $(Assert.equal(rows.map((_$, r) => r.gutter.label), ["Program", "M1", "M2", "M2A"]));
        // A hand-built row's id is provisional — no series yet (a
        // `Plan.series.rows` names it) — and its path is the keys that lead to it.
        $(Assert.equal(rows.get(0n).id, Plan.ref("", "prog")));
        $(Assert.equal(rows.get(1n).id, Plan.ref("", "prog", "m1")));
        $(Assert.equal(rows.get(3n).id, Plan.ref("", "prog", "m2", "m2a")));
        $(Assert.equal(rows.get(0n).parent.hasTag("none"), true));
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), Plan.ref("", "prog")));
        $(Assert.equal(rows.get(2n).parent.unwrap("some"), Plan.ref("", "prog")));
        // A nested parent keeps its own children.
        $(Assert.equal(rows.get(3n).parent.unwrap("some"), Plan.ref("", "prog", "m2")));
    });

    test("two hand-built rows under ONE key both stay in the stream — never a silent drop", $ => {
        // The stream keeps every row; the two share an id, which the renderer
        // draws as a row diagnostic (#811) rather than losing one.
        const merged = $.let(Plan.group({
            key: "g", label: "G", rows: [
                Plan.span({ key: "dup", label: "first" }),
                Plan.span({ key: "dup", label: "second" }),
            ],
        }));
        $(Assert.equal(merged.size(), 3n));
        $(Assert.equal(merged.get(1n).gutter.label, "first"));
        $(Assert.equal(merged.get(2n).gutter.label, "second"));
        $(Assert.equal(merged.get(1n).id, merged.get(2n).id));
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
        const row = $.let(rows.get(0n));
        $(Assert.equal(row.gutter.label, "COVERAGE"));
        $(Assert.equal(row.gutter.id, true));
        $(Assert.equal(row.gutter.sub.unwrap("some"), "demand"));
        $(Assert.equal(row.gutter.value.unwrap("some"), "94.2%"));
        $(Assert.equal(row.gutter.meta.unwrap("some"), "8 rs"));
        $(Assert.equal(row.gutter.stacked, true));
        $(Assert.equal(row.gutter.swatches.get(0n).color, "teal.solid"));
        $(Assert.equal(row.pinned, true));
        $(Assert.equal(row.status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(row.approval.unwrap("some").hasTag("pending"), true));
        const expand = $.let(row.expand.unwrap("some"));
        $(Assert.equal(expand.height.unwrap("some"), "152px"));
        $(Assert.equal(expand.axis.hasTag("dim"), true));
        // The flags are Booleans (#824): an undeclared one is `false` — `none`
        // used to mean false too, a third state nothing distinguished.
        const plain = $.let(Plan.span({ key: "p", label: "P" }).get(0n));
        $(Assert.equal(plain.gutter.id, false));
        $(Assert.equal(plain.gutter.stacked, false));
        $(Assert.equal(plain.pinned, false));
        $(Assert.equal(plain.collapsed, false));
    });

    // =========================================================================
    // Rollup band math
    // =========================================================================

    test("nesting parents DECLARE their rollup; bands are renderer-derived, their sums per the runs' units", $ => {
        // The IR carries the declaration (Table's column-aggregate idiom on
        // the span channel); the renderer derives the ×k band values from the
        // subtree's runs — never precomputed expressions. A quantity carries
        // its own unit (#824), so the parent declares none.
        const rows = $.let(Plan.span({
            key: "p", label: "P", rollup: "union", rows: [
                Plan.span({ key: "a", label: "A", runs: [
                    Plan.run({ key: "ra", start: W27, end: W29, label: "RA", quantity: Plan.quantity(96, { unit: "t" }), state: "actual" }),
                ] }),
            ],
        }));
        const kind = $.let(rows.get(0n).kind.unwrap("span"));
        $(Assert.equal(kind.rollup.unwrap("some").hasTag("union"), true));
        $(Assert.equal(East.value("unit" in Plan.Types.RowKind.cases.span.fields), false));
        $(Assert.equal(kind.runs.length(), 0n));
        $(Assert.equal(rows.get(1n).kind.unwrap("span").runs.get(0n).quantity.unwrap("some").unit.unwrap("some"), "t"));
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

    test("heat parents DECLARE their aggregate and the scale their derived cells paint on — the ROW's (#824)", $ => {
        // The renderer derives the per-bucket values from the children — the
        // parent's IR carries the mode and, on the KIND, the scale; its cells
        // arm is empty and carries none (it used to carry the scale).
        const rows = $.let(Plan.heat({
            key: "line", label: "Line", aggregate: "mean", scale: { min: 0, max: 100 }, rows: [
                Plan.heat({ key: "a", label: "A", cells: Plan.heatCells([
                    { at: Plan.at.time(W27), value: some(40.0), label: none }, { at: Plan.at.time(W28), value: some(60.0), label: none },
                ], { min: 0, max: 100, warnAt: 90 }) }),
            ],
        }));
        const kind = $.let(rows.get(0n).kind.unwrap("heat"));
        $(Assert.equal(kind.aggregate.unwrap("some").hasTag("mean"), true));
        $(Assert.equal(kind.scale.unwrap("some").min.unwrap("some"), 0.0));
        $(Assert.equal(kind.scale.unwrap("some").max.unwrap("some"), 100.0));
        $(Assert.equal(kind.scale.unwrap("some").warnAt.hasTag("none"), true));
        const cells = $.let(kind.cells.unwrap("heat"));
        $(Assert.equal(cells.cells.length(), 0n));
        $(Assert.equal(cells.scale.min.hasTag("none"), true));
        // The child keeps its real cells, on the scale its arm declares.
        const child = $.let(rows.get(1n).kind.unwrap("heat"));
        $(Assert.equal(child.cells.unwrap("heat").cells.length(), 2n));
        $(Assert.equal(child.cells.unwrap("heat").scale.warnAt.unwrap("some"), 90.0));
        // A leaf declares no parent scale.
        $(Assert.equal(child.scale.hasTag("none"), true));
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
        $(Assert.equal(s0.strong, true));
        $(Assert.equal(s0.rollup, true));
        $(Assert.equal(s0.format.hasTag("none"), true));
        $(Assert.equal(s0.cells.get(0n).value.unwrap("some"), 96.0));
        const s1 = $.let(kind.series.get(1n));
        $(Assert.equal(s1.tone.unwrap("some").hasTag("muted"), true));
        $(Assert.equal(s1.format.unwrap("some").unwrap("number").signDisplay.unwrap("some").hasTag("always"), true));
        $(Assert.equal(s1.cells.get(0n).value.unwrap("some"), -8.0));
        // Undeclared flags are `false` (#824), and a numeral folds by `sum`.
        $(Assert.equal(s1.strong, false));
        $(Assert.equal(s1.rollup, false));
        $(Assert.equal(s1.fold.hasTag("sum"), true));
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
        $(Assert.equal(chip.from.unwrap("time"), W27));
        $(Assert.equal(chip.to.unwrap("time"), W29));
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
        const chart = $.let(rows.get(0n).kind.unwrap("chart"));
        $(Assert.equal(chart.height.unwrap("fixed"), "120px"));
        // The expanded state's pixel override (default 88 when `none`).
        $(Assert.equal(chart.expandedHeight.unwrap("some"), "96px"));
        $(Assert.equal(chart.expandable, true));
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
        $(Assert.equal(line.points.get(0n).t.unwrap("time"), W27));
        $(Assert.equal(line.points.get(0n).y, 10.0));
        $(Assert.equal(line.axis.hasTag("left"), true));
        $(Assert.equal(line.breach.unwrap("some").unwrap("below"), 15.0));
        // A line is a level: a bucket folds its points by their mean (#824).
        $(Assert.equal(line.fold.hasTag("mean"), true));
        const scatter = $.let(chart.layers.get(1n).unwrap("scatter"));
        $(Assert.equal(scatter.axis.hasTag("right"), true));
        const refLine = $.let(chart.layers.get(2n).unwrap("refLine"));
        $(Assert.equal(refLine.y, 100.0));
        $(Assert.equal(refLine.label.unwrap("some"), "TARGET"));
        const refBand = $.let(chart.layers.get(3n).unwrap("refBand"));
        $(Assert.equal(refBand.from.unwrap("time"), W27));
        $(Assert.equal(refBand.to.unwrap("time"), W28));
        const refDot = $.let(chart.layers.get(4n).unwrap("refDot"));
        $(Assert.equal(refDot.t.unwrap("time"), W28));
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
        const chart = $.let(rows.get(0n).kind.unwrap("chart"));
        $(Assert.equal(chart.height.hasTag("spark"), true));
        $(Assert.equal(chart.expandedHeight.hasTag("none"), true));
        // No toggle unless declared (#824 — a Boolean, `false` by default).
        $(Assert.equal(chart.expandable, false));
        $(Assert.equal(chart.layers.get(0n).unwrap("column").series.unwrap("some"), "L1"));
        $(Assert.equal(chart.layers.get(1n).unwrap("column").series.unwrap("some"), "L2"));
        $(Assert.equal(chart.layers.get(2n).unwrap("column").series.hasTag("none"), true));
        // A column is an amount: a bucket folds its points by their sum.
        $(Assert.equal(chart.layers.get(0n).unwrap("column").fold.hasTag("sum"), true));
    });

    test("temporal fold: every cell builder and data layer declares how a bucket folds — defaults by meaning, overrides honoured (#824)", $ => {
        const MeasureRow = StructType({ week: DateTimeType, pct: FloatType });
        const points = $.const([{ week: W27, pct: 10.0 }, { week: W28, pct: 20.0 }], ArrayType(MeasureRow));
        // Heat is a level (mean), weight a fraction (mean), segments amounts (sum).
        $(Assert.equal(Plan.heatCells([]).unwrap("heat").fold.hasTag("mean"), true));
        $(Assert.equal(Plan.weightCells([]).unwrap("weight").fold.hasTag("mean"), true));
        $(Assert.equal(Plan.segmentCells([]).unwrap("segments").fold.hasTag("sum"), true));
        // A table numeral is an amount (sum) — on the series, the `cells`
        // sugar's included.
        $(Assert.equal(Plan.tableSeries({ cells: Plan.tableCells([]) }).fold.hasTag("sum"), true));
        const sugar = $.let(Plan.table({ key: "t", label: "T", cells: Plan.tableCells([]) }).get(0n).kind.unwrap("table"));
        $(Assert.equal(sugar.series.get(0n).fold.hasTag("sum"), true));
        // Overrides — every builder takes one, as a literal or a value.
        $(Assert.equal(Plan.heatCells([], { fold: "max" }).unwrap("heat").fold.hasTag("max"), true));
        $(Assert.equal(Plan.weightCells([], { fold: "last" }).unwrap("weight").fold.hasTag("last"), true));
        $(Assert.equal(Plan.segmentCells([], { fold: variant("mean", null) }).unwrap("segments").fold.hasTag("mean"), true));
        $(Assert.equal(Plan.tableSeries({ cells: Plan.tableCells([]), fold: "count" }).fold.hasTag("count"), true));
        const lastStock = $.let(Plan.table({ key: "s", label: "S", cells: Plan.tableCells([]), fold: "last" }).get(0n).kind.unwrap("table"));
        $(Assert.equal(lastStock.series.get(0n).fold.hasTag("last"), true));
        // The cell arms' `format` prints their values.
        const fmt = $.let(Plan.heatCells([], { format: Format.Number({ maximumFractionDigits: 0n }) }).unwrap("heat").format);
        $(Assert.equal(fmt.unwrap("some").hasTag("number"), true));
        $(Assert.equal(Plan.weightCells([]).unwrap("weight").format.hasTag("none"), true));
        // Data layers — a line and an area are levels (mean), a column an amount (sum).
        const layers = $.let(Plan.chart({ key: "c", label: "C", layers: [
            Chart.Line(points, { x: r => r.week, y: r => r.pct }),
            Chart.Area(points, { x: r => r.week, y: r => r.pct }),
            Chart.Column(points, { x: r => r.week, y: r => r.pct }),
            Plan.layer(Chart.Column(points, { x: r => r.week, y: r => r.pct }), { fold: "max" }),
            Plan.layer(Chart.Line(points, { x: r => r.week, y: r => r.pct }), { fold: "last" }),
        ] }).get(0n).kind.unwrap("chart").layers);
        $(Assert.equal(layers.get(0n).unwrap("line").fold.hasTag("mean"), true));
        $(Assert.equal(layers.get(1n).unwrap("area").fold.hasTag("mean"), true));
        $(Assert.equal(layers.get(2n).unwrap("column").fold.hasTag("sum"), true));
        $(Assert.equal(layers.get(3n).unwrap("column").fold.hasTag("max"), true));
        $(Assert.equal(layers.get(4n).unwrap("line").fold.hasTag("last"), true));
        // A `fold` beside `series` would be a second word on the same
        // positions — each `Plan.tableSeries` says its own.
        const both = (() => {
            try {
                Plan.table({ key: "x", label: "X", fold: "sum", series: [Plan.tableSeries({ cells: Plan.tableCells([]) })] });
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(both.includes("each `Plan.tableSeries` declares its own fold")), true));
    });

    test("Chart.Bar and temporal value-axis domains are build-time errors; a numeric x is a number-arm layer", $ => {
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
        // A numeric x accessor is no longer refused (#631): it lands the layer
        // on the `number` arm, for a `Plan.axis.number` canvas to position.
        const numRows = $.let(Plan.chart({ key: "x", label: "X", layers: Chart.Line(numeric, { x: r => r.x, y: r => r.y }) }));
        $(Assert.equal(numRows.get(0n).kind.unwrap("chart").layers.get(0n).unwrap("line").points.get(1n).t.unwrap("number"), 2.0));
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
    // Groups, sections and nesting from the data (#822)
    // =========================================================================

    test("group strips DECLARE their summary aggregate; a row with children carries its collapse", $ => {
        const rows = $.let(Plan.group({
            key: "line2", label: "Line 2", collapsed: true, summaryAggregate: "mean", rows: [
                Plan.heat({ key: "a", label: "A", cells: Plan.heatCells([
                    { at: Plan.at.time(W27), value: some(40.0), label: none },
                ]) }),
                Plan.heat({ key: "b", label: "B", cells: Plan.heatCells([
                    { at: Plan.at.time(W27), value: some(60.0), label: none },
                ]) }),
            ],
        }));
        $(Assert.equal(rows.size(), 3n));
        const g = $.let(rows.get(0n).kind.unwrap("group"));
        // Collapse is the ROW's — every kind may have children.
        $(Assert.equal(rows.get(0n).collapsed, true));
        // ONE summary declaration (#824) — here the aggregate; the renderer
        // derives the strip cells.
        $(Assert.equal(g.summary.unwrap("aggregate").hasTag("mean"), true));
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), rows.get(0n).id));
        // Explicit strip cells are the other arm; neither is a plain band.
        const cells = $.let(Plan.group({ key: "c", label: "C", summary: Plan.heatCells([
            { at: Plan.at.time(W27), value: some(50.0), label: none },
        ]) }).get(0n).kind.unwrap("group").summary);
        $(Assert.equal(cells.unwrap("cells").unwrap("heat").cells.length(), 1n));
        $(Assert.equal(Plan.group({ key: "p", label: "P" }).get(0n).kind.unwrap("group").summary.hasTag("none"), true));
        // Both at once is refused — a strip shows one or the other.
        const both = (() => {
            try {
                Plan.group({ key: "b", label: "B", summary: Plan.heatCells([]), summaryAggregate: "mean" });
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(both.includes("a collapsed strip shows one or the other")), true));
    });

    test("series.group — one strip PER ENTRY, its members stepped down into from the entry", $ => {
        // Grouping is a data step: the entries ARE the groups (`groupToDicts`),
        // and each strip nests exactly what its entry holds.
        const Row = StructType({ line: StringType, v: FloatType });
        const flat = $.const(new Map([
            ["a", { line: "L1", v: 40.0 }],
            ["b", { line: "L1", v: 60.0 }],
            ["c", { line: "L2", v: 80.0 }],
        ]), DictType(StringType, Row));
        const lines = $.let(flat.groupToDicts(($, r) => r.line, ($, _r, k) => k));
        const Line = DictType(StringType, Row);
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data: lines,
            series: [
                Plan.series.group(Line, {
                    key: "lines", title: "Lines",
                    label: (_g, line) => line,
                    collapsed: true, summaryAggregate: "mean",
                    children: Plan.children((g) => g, [
                        Plan.series.heat(Row, {
                            key: "load", title: "Load",
                            label: (_r, k) => k,
                            cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
                        }),
                    ]),
                }),
            ],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        // L1's strip + 2 members, then L2's strip + 1 member — pre-order.
        $(Assert.equal(rows.map((_$, r) => r.gutter.label), ["L1", "a", "b", "L2", "c"]));
        $(Assert.equal(rows.get(0n).id, Plan.ref("lines", "L1")));
        $(Assert.equal(rows.get(0n).kind.unwrap("group").summary.unwrap("aggregate").hasTag("mean"), true));
        $(Assert.equal(rows.get(0n).collapsed, true));
        // The member count is NOT baked in — it is derived renderer-side.
        $(Assert.equal(rows.get(0n).gutter.meta.hasTag("none"), true));
        // A member's path is its group's key, then its own.
        $(Assert.equal(rows.get(1n).id, Plan.ref("load", "L1", "a")));
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), Plan.ref("lines", "L1")));
        $(Assert.equal(rows.get(4n).parent.unwrap("some"), Plan.ref("lines", "L2")));
    });

    test("a recursive table four deep — every level nests under its parent, which declares a subtotal (#822)", $ => {
        // Arbitrary depth is data: a statement's accounts hold accounts. The
        // entry arrives at every accessor as its NODE, so `a.name` reads the
        // field directly at every depth.
        const Account = RecursiveType((self) => StructType({
            name: StringType,
            values: ArrayType(StructType({ at: DateTimeType, value: OptionType(FloatType) })),
            children: ArrayType(self),
        }));
        const accounts = $.const(new Map([
            ["pnl", { name: "P&L", values: [], children: [
                { name: "Revenue", values: [], children: [
                    { name: "Product", values: [], children: [
                        { name: "Widgets", values: [{ at: W27, value: some(10.0) }], children: [] },
                        { name: "Gadgets", values: [{ at: W27, value: some(5.0) }], children: [] },
                    ] },
                    { name: "Services", values: [{ at: W27, value: some(3.0) }], children: [] },
                ] },
                { name: "Costs", values: [{ at: W27, value: some(-7.0) }], children: [] },
            ] }],
        ]), DictType(StringType, Account));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data: accounts,
            series: [Plan.series.table(Account, {
                key: "accounts", title: "Accounts",
                label: (a) => a.name,
                cells: (a) => Plan.tableCells(a.values),
                aggregate: "sum",
                children: (a) => a.children,
            })],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        // Pre-order to the fourth level: each parent, then its whole subtree.
        $(Assert.equal(rows.map((_$, r) => r.gutter.label),
            ["P&L", "Revenue", "Product", "Widgets", "Gadgets", "Services", "Costs"]));
        // An Array child's path segment is its index, as text.
        $(Assert.equal(rows.get(3n).id, Plan.ref("accounts", "pnl", "0", "0", "0")));
        $(Assert.equal(rows.get(3n).parent.unwrap("some"), Plan.ref("accounts", "pnl", "0", "0")));
        $(Assert.equal(rows.get(5n).parent.unwrap("some"), Plan.ref("accounts", "pnl", "0")));
        $(Assert.equal(rows.get(6n).parent.unwrap("some"), Plan.ref("accounts", "pnl")));
        $(Assert.equal(rows.get(0n).parent.hasTag("none"), true));
        // Every parent declares the subtotal and carries no values of its own
        // — the renderer derives each level from the one below.
        $(Assert.equal(rows.get(0n).kind.unwrap("table").aggregate.unwrap("some").hasTag("sum"), true));
        $(Assert.equal(rows.get(2n).kind.unwrap("table").aggregate.unwrap("some").hasTag("sum"), true));
        $(Assert.equal(rows.get(2n).kind.unwrap("table").series.get(0n).cells.size(), 0n));
        $(Assert.equal(rows.get(3n).kind.unwrap("table").series.get(0n).cells.get(0n).value.unwrap("some"), 10.0));
    });

    test("a recursive span series rolls up only the rows that have children", $ => {
        const Machine = RecursiveType((self) => StructType({
            start: DateTimeType, end: DateTimeType,
            machines: DictType(StringType, self),
        }));
        const data = $.const(new Map([
            ["A", { start: W27, end: W27, machines: new Map([
                ["m1", { start: W27, end: W29, machines: new Map() }],
                ["m2", { start: W28, end: W30, machines: new Map() }],
            ]) }],
            ["solo", { start: W27, end: W28, machines: new Map() }],
        ]), DictType(StringType, Machine));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [Plan.series.span(Machine, {
                key: "machines", title: "Machines",
                label: (_r, k) => k,
                runs: (r, k) => [Plan.run({ key: k, start: r.start, end: r.end, label: k, state: variant("confirmed", null) })],
                children: (r) => r.machines, rollup: "union",
            })],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        $(Assert.equal(rows.map((_$, r) => r.gutter.label), ["A", "m1", "m2", "solo"]));
        // A row with child rows declares the rollup; a leaf — even a top-level
        // one — does not (its bands would only repeat its own runs).
        $(Assert.equal(rows.get(0n).kind.unwrap("span").rollup.unwrap("some").hasTag("union"), true));
        $(Assert.equal(rows.get(1n).kind.unwrap("span").rollup.hasTag("none"), true));
        $(Assert.equal(rows.get(3n).kind.unwrap("span").rollup.hasTag("none"), true));
        // Dict children keep String keys, so `label: (_r, k) => k` reads at every depth.
        $(Assert.equal(rows.get(1n).id, Plan.ref("machines", "A", "m1")));
    });

    test("a step-down: a line's machines as views and its crews as cards, each under a section header", $ => {
        // Line → machines (views: jobs + load) and crews (cards), each child
        // collection under its own section — the ids name every level.
        const Job = StructType({ key: StringType, start: DateTimeType, end: DateTimeType });
        const Machine = StructType({ jobs: ArrayType(Job), load: FloatType });
        const Crew = StructType({ hours: FloatType });
        const Line = StructType({ machines: DictType(StringType, Machine), crews: DictType(StringType, Crew) });
        const lines = $.const(new Map([
            ["L1", {
                machines: new Map([
                    ["m03", { jobs: [{ key: "b1", start: W27, end: W28 }], load: 40.0 }],
                    ["m04", { jobs: [], load: 60.0 }],
                ]),
                crews: new Map([["crewA", { hours: 80.0 }]]),
            }],
        ]), DictType(StringType, Line));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data: lines,
            series: [Plan.series.group(Line, {
                key: "lines", title: "Lines", label: (_l, k) => k,
                children: [
                    Plan.children((l) => l.machines, [
                        Plan.series.section(Machine, { key: "machine-block", title: "Machines" }, [
                            Plan.series.views(Machine, { key: "machines", title: "Machines" }, [
                                Plan.series.span(Machine, {
                                    key: "machine-jobs", title: "Jobs", label: (_m, k) => k,
                                    runs: (m) => m.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.key, state: "confirmed" })),
                                }),
                                Plan.series.heat(Machine, {
                                    key: "machine-load", title: "Load", label: (_m, k) => k,
                                    cells: (m) => Plan.heatCells([{ at: Plan.at.time(W27), value: some(m.load), label: none }]),
                                }),
                            ]),
                        ]),
                    ]),
                    Plan.children((l) => l.crews, [
                        Plan.series.section(Crew, { key: "crew-block", title: "Crews" }, [
                            Plan.series.cards(Crew, { key: "crews", title: "Crews", label: (_c, k) => k, chips: _c => [] }),
                        ]),
                    ]),
                ],
            })],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        $(Assert.equal(rows.map((_$, r) => r.id), [
            Plan.ref("lines", "L1"),
            Plan.sectionRef("machine-block", "L1"),
            Plan.ref("machine-jobs", "L1", "m03"),
            Plan.ref("machine-load", "L1", "m03"),
            Plan.ref("machine-jobs", "L1", "m04"),
            Plan.ref("machine-load", "L1", "m04"),
            Plan.sectionRef("crew-block", "L1"),
            Plan.ref("crews", "L1", "crewA"),
        ]));
        // Each section header sits under the line; its members under it.
        $(Assert.equal(rows.get(1n).parent.unwrap("some"), Plan.ref("lines", "L1")));
        $(Assert.equal(rows.get(2n).parent.unwrap("some"), Plan.sectionRef("machine-block", "L1")));
        $(Assert.equal(rows.get(3n).parent.unwrap("some"), Plan.sectionRef("machine-block", "L1")));
        $(Assert.equal(rows.get(7n).parent.unwrap("some"), Plan.sectionRef("crew-block", "L1")));
        $(Assert.equal(rows.get(1n).gutter.label, "Machines"));
        $(Assert.equal(rows.get(1n).kind.hasTag("group"), true));
        // A section below an entry is part of that entry's subtree, which a
        // window carries whole — so the canvas is still the ONE block of the
        // group series' entries (#823).
        $(Assert.equal(p.unwrap().unwrap("Plan").rows.unwrap("inline").size(), 1n));
    });

    test("views: one row per member per entry, adjacent and in declared order; children under the first view row", $ => {
        const Row = StructType({ v: FloatType, jobs: BooleanType, kids: DictType(StringType, StructType({ v: FloatType })) });
        const Kid = StructType({ v: FloatType });
        const data = $.const(new Map([
            ["m03", { v: 1.0, jobs: true, kids: new Map([["k1", { v: 5.0 }]]) }],
            ["m04", { v: 2.0, jobs: false, kids: new Map() }],
        ]), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [Plan.series.views(Row, {
                key: "machines", title: "Machines",
                children: Plan.children((r) => r.kids, [
                    Plan.series.heat(Kid, { key: "parts", title: "Parts", label: (_k, key) => key, cells: _k => Plan.heatCells([]) }),
                ]),
            }, [
                // A member's own `match` decides whether its row shows.
                Plan.series.span(Row, { key: "machine-jobs", title: "Jobs", match: r => r.jobs, label: (_r, k) => k, runs: _r => [] }),
                Plan.series.heat(Row, { key: "machine-load", title: "Load", label: (_r, k) => k,
                    cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]) }),
                Plan.series.table(Row, { key: "machine-tonnes", title: "Tonnes", label: (_r, k) => k,
                    cells: r => Plan.tableCells([{ at: W27, value: some(r.v) }]) }),
            ])],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        // m03's three views adjacent, then its child; m04 has no jobs row, so
        // its first view row is the load row.
        $(Assert.equal(rows.map((_$, r) => r.id), [
            Plan.ref("machine-jobs", "m03"),
            Plan.ref("machine-load", "m03"),
            Plan.ref("machine-tonnes", "m03"),
            Plan.ref("parts", "m03", "k1"),
            Plan.ref("machine-load", "m04"),
            Plan.ref("machine-tonnes", "m04"),
        ]));
        // The child nests under the entry's FIRST view row, though it follows
        // all three — a parent precedes its descendants, not always directly.
        $(Assert.equal(rows.get(3n).parent.unwrap("some"), Plan.ref("machine-jobs", "m03")));
        $(Assert.equal(rows.get(1n).parent.hasTag("none"), true));
    });

    test("series.section heads its members at its parent's path; series.rows names its hand-built rows", $ => {
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
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data: ops,
            series: [
                Plan.series.rows(OpsRow, { key: "chrome", title: "Milestones" },
                    [Plan.events({ key: "ms", label: "MILESTONES", id: true })]),
                Plan.series.section(OpsRow, { key: "crews", title: "Crews", meta: "1 rs", value: "80h", status: "warning", collapsed: true }, [
                    Plan.series.cards(OpsRow, {
                        key: "crew-shifts", title: "Crew shifts",
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
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        $(Assert.equal(rows.size(), 3n));
        // The hand-built row, named by its series.
        $(Assert.equal(rows.get(0n).id, Plan.ref("chrome", "ms")));
        $(Assert.equal(rows.get(0n).kind.hasTag("events"), true));
        // The section's header: its id, its declared chrome, and its collapse.
        $(Assert.equal(rows.get(1n).id, Plan.sectionRef("crews")));
        $(Assert.equal(rows.get(1n).kind.hasTag("group"), true));
        $(Assert.equal(rows.get(1n).gutter.meta.unwrap("some"), "1 rs"));
        $(Assert.equal(rows.get(1n).gutter.value.unwrap("some"), "80h"));
        $(Assert.equal(rows.get(1n).status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(rows.get(1n).collapsed, true));
        // A section with no strip declared is a plain band.
        $(Assert.equal(rows.get(1n).kind.unwrap("group").summary.hasTag("none"), true));
        // A section adds no path segment — its member keeps its own.
        $(Assert.equal(rows.get(2n).id, Plan.ref("crew-shifts", "crewA")));
        $(Assert.equal(rows.get(2n).parent.unwrap("some"), Plan.sectionRef("crews")));
        // The hand-built rows and the header are FIXED blocks; the member is a
        // block of its own, nested under the header (#823).
        const blocks = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(blocks.map((_$, b) => b.fixed), [true, true, false]));
        $(Assert.equal(blocks.get(2n).parent.unwrap("some"), Plan.sectionRef("crews")));
    });

    // =========================================================================
    // The series list IS the layout (#822)
    // =========================================================================

    test("reordering the series list reorders the blocks", $ => {
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([["a", { v: 1.0 }], ["b", { v: 2.0 }]]), DictType(StringType, Row));
        const heat = Plan.series.heat(Row, {
            key: "load", title: "Load", label: (_r, k) => k,
            cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
        });
        const table = Plan.series.table(Row, {
            key: "tonnes", title: "Tonnes", label: (_r, k) => k,
            cells: r => Plan.tableCells([{ at: W27, value: some(r.v) }]),
        });
        const axis = Plan.axis({ window: { min: W27, max: END }, resolution: "week" });
        const forward = $.let(Plan.Root({ axis, data, series: [heat, table] }).unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        const reverse = $.let(Plan.Root({ axis, data, series: [table, heat] }).unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        // Each series is ONE contiguous block, its rows in source order.
        $(Assert.equal(forward.map((_$, r) => r.id), [
            Plan.ref("load", "a"), Plan.ref("load", "b"), Plan.ref("tonnes", "a"), Plan.ref("tonnes", "b"),
        ]));
        $(Assert.equal(reverse.map((_$, r) => r.id), [
            Plan.ref("tonnes", "a"), Plan.ref("tonnes", "b"), Plan.ref("load", "a"), Plan.ref("load", "b"),
        ]));
        // The blocks travel apart (#823) — a data series is one block of its
        // entries' rows, in the list's order — so a paged canvas can page each
        // on its own.
        const blocks = $.let(Plan.Root({ axis, data, series: [table, heat] }).unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(blocks.size(), 2n));
        $(Assert.equal(blocks.get(0n).rows.map((_$, r) => r.id), [Plan.ref("tonnes", "a"), Plan.ref("tonnes", "b")]));
        $(Assert.equal(blocks.get(1n).rows.map((_$, r) => r.id), [Plan.ref("load", "a"), Plan.ref("load", "b")]));
        $(Assert.equal(blocks.map((_$, b) => b.fixed), [false, false]));
        $(Assert.equal(blocks.get(0n).parent.hasTag("none"), true));
        // The same holds for a list bound as an East value — a picked list is
        // one — whose order is its elements'.
        const bound = $.const([table, heat], ArrayType(Plan.Types.Series(Row)));
        const viaValue = $.let(Plan.Root({ axis, data, series: bound }).unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(viaValue.size(), 2n));
        $(Assert.equal(viaValue.flatMap((_$, b) => b.rows).map((_$, r) => r.id), [
            Plan.ref("tonnes", "a"), Plan.ref("tonnes", "b"), Plan.ref("load", "a"), Plan.ref("load", "b"),
        ]));
    });

    test("a section is its header's FIXED block, then its members' own blocks — so they page apart (#823)", $ => {
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([["a", { v: 1.0 }], ["b", { v: 2.0 }], ["c", { v: 3.0 }]]), DictType(StringType, Row));
        const heat = Plan.series.heat(Row, {
            key: "load", title: "Load", label: (_r, k) => k,
            cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
        });
        const table = Plan.series.table(Row, {
            key: "tonnes", title: "Tonnes", label: (_r, k) => k,
            cells: r => Plan.tableCells([{ at: W27, value: some(r.v) }]),
        });
        const series = [
            Plan.series.section(Row, { key: "ops", title: "Operations" }, [heat, table]),
            Plan.series.rows(Row, { key: "chrome", title: "Milestones" }, [Plan.events({ key: "ms", label: "MS" })]),
        ];
        const axis = Plan.axis({ window: { min: W27, max: END }, resolution: "week" });
        const blocks = $.let(Plan.Root({ axis, data, series }).unwrap().unwrap("Plan").rows.unwrap("inline"));
        // The header, each member, then the hand-built rows — four blocks. No
        // entry produces the header or the hand-built rows: they are FIXED.
        $(Assert.equal(blocks.map((_$, b) => b.fixed), [true, false, false, true]));
        $(Assert.equal(blocks.get(0n).rows.map((_$, r) => r.id), [Plan.sectionRef("ops")]));
        $(Assert.equal(blocks.get(1n).rows.map((_$, r) => r.id), [Plan.ref("load", "a"), Plan.ref("load", "b"), Plan.ref("load", "c")]));
        $(Assert.equal(blocks.get(2n).rows.map((_$, r) => r.id), [Plan.ref("tonnes", "a"), Plan.ref("tonnes", "b"), Plan.ref("tonnes", "c")]));
        $(Assert.equal(blocks.get(3n).rows.map((_$, r) => r.id), [Plan.ref("chrome", "ms")]));
        // A member's block nests under the header, which sits at the top.
        $(Assert.equal(blocks.get(0n).parent.hasTag("none"), true));
        $(Assert.equal(blocks.get(1n).parent.unwrap("some"), Plan.sectionRef("ops")));
        $(Assert.equal(blocks.get(2n).parent.unwrap("some"), Plan.sectionRef("ops")));
        $(Assert.equal(blocks.get(3n).parent.hasTag("none"), true));
        // Paged, a window holds each member's share of its entries and the
        // fixed blocks as ever — so each member pages on its own and the
        // header is one row, not one per window.
        const source = $.let(Paged.of("ops", data));
        const paged = $.let(Plan.Root({ axis, data: source, series }).unwrap().unwrap("Plan").rows.unwrap("paged"));
        const w1 = $.let(paged.page(1n, 1n).unwrap("some"));
        $(Assert.equal(w1.map((_$, b) => b.fixed), [true, false, false, true]));
        $(Assert.equal(w1.get(0n).rows.map((_$, r) => r.id), [Plan.sectionRef("ops")]));
        $(Assert.equal(w1.get(1n).rows.map((_$, r) => r.id), [Plan.ref("load", "b")]));
        $(Assert.equal(w1.get(2n).rows.map((_$, r) => r.id), [Plan.ref("tonnes", "b")]));
        $(Assert.equal(w1.get(3n).rows.map((_$, r) => r.id), [Plan.ref("chrome", "ms")]));
        // A list bound as an East value lays out the same blocks.
        const bound = $.const(series, ArrayType(Plan.Types.Series(Row)));
        const viaValue = $.let(Plan.Root({ axis, data, series: bound }).unwrap().unwrap("Plan").rows.unwrap("inline"));
        $(Assert.equal(viaValue, blocks));
    });

    test("two series over one source both keep every row — their ids differ by series", $ => {
        // The collision a keyed union used to resolve silently (last wins) is
        // gone: a row's id is its series and its path.
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([["m1", { v: 1.0 }], ["m2", { v: 2.0 }]]), DictType(StringType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [
                Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
                Plan.series.events(Row, { key: "alt-marks", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
            ],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).id, Plan.ref("marks", "m1")));
        $(Assert.equal(rows.get(2n).id, Plan.ref("alt-marks", "m1")));
    });

    test("duplicate series keys are a build-time error naming both sites", $ => {
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row));
        const axis = Plan.axis({ window: { min: W27, max: END }, resolution: "week" });
        // At the root: two top-level series.
        const top = (() => {
            try {
                Plan.Root({ axis, data, series: [
                    Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
                    Plan.series.events(Row, { key: "marks", title: "More marks", label: (_r, k) => k, marks: _r => [] }),
                ] });
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(top.includes('two series share the key "marks"')), true));
        $(Assert.equal(East.value(top.includes('events "Marks"') && top.includes('events "More marks"')), true));
        // Anywhere in the tree — here a section repeating its own member's key.
        const nested = (() => {
            try {
                Plan.series.section(Row, { key: "marks", title: "Section" }, [
                    Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
                ]);
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(nested.includes('two series share the key "marks"')), true));
        // …and across a step-down.
        const Line = DictType(StringType, Row);
        const stepped = (() => {
            try {
                Plan.series.group(Line, {
                    key: "rows", title: "Lines", label: (_g, k) => k,
                    children: Plan.children((g) => g, [
                        Plan.series.events(Row, { key: "rows", title: "Rows", label: (_r, k) => k, marks: _r => [] }),
                    ]),
                });
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(stepped.includes('two series share the key "rows"')), true));
        // The series library holds the list to the same rule.
        const picked = (() => {
            try {
                Plan.pickItems([
                    Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
                    Plan.series.events(Row, { key: "marks", title: "More marks", label: (_r, k) => k, marks: _r => [] }),
                ]);
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(picked.includes('two series share the key "marks"')), true));
    });

    test("the removed group forms fail with the migration named", $ => {
        const Row = StructType({ v: FloatType });
        const staticForm = (() => {
            try {
                (Plan.series.group as unknown as (...args: unknown[]) => unknown)(Row, { key: "g", label: "G" }, []);
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(staticForm.includes("Plan.series.section")), true));
        const byForm = (() => {
            try {
                (Plan.series.group as unknown as (...args: unknown[]) => unknown)(Row, { key: "g", title: "G", by: () => "L1" });
                return "";
            } catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(byForm.includes("groupToDicts")), true));
    });

    // =========================================================================
    // Sources keyed by any type (#822)
    // =========================================================================

    test("a Dict<Integer, R> source: path segments are the keys' text, and a key-reading accessor declares keyType", $ => {
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([[1n, { v: 1.0 }], [20n, { v: 2.0 }]]), DictType(IntegerType, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [
                Plan.series.heat(Row, {
                    key: "load", title: "Load", keyType: IntegerType,
                    label: (_r, k) => East.print(k),
                    cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
                }),
                // A series whose accessors ignore the key needs no keyType.
                Plan.series.events(Row, { key: "marks", title: "Marks", label: _r => "M", marks: _r => [] }),
            ],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        const one = $.const(1n, IntegerType);
        const twenty = $.const(20n, IntegerType);
        // Key ORDER is the source's (1 < 20 numerically), and the segment is
        // the key's `.east` text.
        $(Assert.equal(rows.get(0n).id, Plan.ref("load", East.print(one))));
        $(Assert.equal(rows.get(1n).id, Plan.ref("load", East.print(twenty))));
        $(Assert.equal(rows.get(0n).gutter.label, East.print(one)));
        $(Assert.equal(rows.get(2n).id, Plan.ref("marks", East.print(one))));
    });

    test("a Dict<{line, bin}, R> source: a struct key's segment is its `.east` text", $ => {
        const Key = StructType({ line: StringType, bin: IntegerType });
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([
            [{ line: "L1", bin: 2n }, { v: 1.0 }],
            [{ line: "L1", bin: 1n }, { v: 2.0 }],
        ]), DictType(Key, Row));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [Plan.series.table(Row, {
                key: "bins", title: "Bins", keyType: Key,
                label: (_r, k) => East.str`${k.line} · ${East.print(k.bin)}`,
                cells: r => Plan.tableCells([{ at: W27, value: some(r.v) }]),
            })],
        }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        const first = $.const({ line: "L1", bin: 1n }, Key);
        // Struct keys sort field by field — bin 1 before bin 2.
        $(Assert.equal(rows.get(0n).id, Plan.ref("bins", East.print(first))));
        $(Assert.equal(rows.get(0n).gutter.label, "L1 · 1"));
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
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data,
            series: [Plan.series.span(MachineRow, {
                key: "machines", title: "Machines",
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
        // stored derive — nothing precomputed in the data.
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        $(Assert.equal(rows.get(0n).id, Plan.ref("machines", "m1")));
        $(Assert.equal(rows.get(0n).gutter.value.unwrap("some"), "120 t"));
        $(Assert.equal(rows.get(0n).status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(rows.get(1n).status.hasTag("none"), true));
        $(Assert.equal(rows.get(0n).expand.hasTag("some"), true));
        $(Assert.equal(rows.get(0n).expand.unwrap("some").height.unwrap("some"), "152px"));
        $(Assert.equal(rows.get(0n).expand.unwrap("some").axis.hasTag("keep"), true));
        $(Assert.equal(rows.get(1n).expand.hasTag("none"), true));
        $(Assert.equal(rows.get(0n).kind.unwrap("span").runs.get(0n).label, "RUN · B-1"));
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
    // Series — the data + series canvas
    // =========================================================================

    test("data+series: each series is a block, match filters, accessors derive from raw fields", $ => {
        const JobRow = StructType({
            batch: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
        });
        const ShiftRow = StructType({
            key: StringType, from: DateTimeType, to: DateTimeType, hours: FloatType, state: EventStateType,
        });
        const OpsRow = StructType({
            kind: VariantType({
                machine: StructType({ jobs: ArrayType(JobRow) }),
                crew:    StructType({ shifts: ArrayType(ShiftRow) }),
            }),
        });
        const ops = $.const(new Map([
            ["c1", { kind: variant("crew", { shifts: [
                { key: "s1", from: W27, to: W29, hours: 80.0, state: variant("confirmed", null) }] }) }],
            ["m1", { kind: variant("machine", { jobs: [
                { batch: "B-1", start: W27, end: W29, state: variant("actual", null) }] }) }],
            ["m2", { kind: variant("machine", { jobs: [
                { batch: "B-2", start: W28, end: W30, state: variant("confirmed", null) }] }) }],
        ]), DictType(StringType, OpsRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data: ops,
            series: [
                Plan.series.span(OpsRow, {
                    key: "machines", title: "Machines",
                    match: r => r.kind.hasTag("machine"),
                    label: (_r, k) => k, id: true,
                    runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                        key: j.batch, start: j.start, end: j.end,
                        label: East.str`RUN · ${j.batch}`, state: j.state,
                    })),
                }),
                Plan.series.cards(OpsRow, {
                    key: "crews", title: "Crews",
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
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        // The machines' block first (the crew filtered out by match), then the
        // crews' — though "c1" sorts before both machines in the source.
        $(Assert.equal(rows.map((_$, r) => r.id), [
            Plan.ref("machines", "m1"), Plan.ref("machines", "m2"), Plan.ref("crews", "c1"),
        ]));
        $(Assert.equal(rows.get(0n).kind.unwrap("span").runs.get(0n).label, "RUN · B-1"));
        $(Assert.equal(rows.get(2n).kind.unwrap("cards").chips.length(), 1n));
        $(Assert.equal(rows.get(2n).kind.unwrap("cards").chips.get(0n).label, "80h"));
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
                key: "machines", title: "Machines",
                label: (_r, k) => k,
                runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                    key: j.batch, start: j.start, end: j.end,
                    label: East.str`RUN · ${j.batch}`, state: j.state,
                })),
            }),
            Plan.series.rows(OpsRow, { key: "chrome", title: "Milestones" },
                [Plan.events({ key: "ms", label: "MS" })]),
        ], ArrayType(Plan.Types.Series(OpsRow)));
        const p = $.let(Plan.Root({ axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }), data: ops, series }));
        const rows = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows));
        $(Assert.equal(rows.size(), 2n));
        $(Assert.equal(rows.get(0n).kind.unwrap("span").runs.length(), 1n));
        $(Assert.equal(rows.get(1n).id, Plan.ref("chrome", "ms")));
        $(Assert.equal(rows.get(1n).kind.hasTag("events"), true));
    });

    test("a bound series list read for another key type than `data` is refused, naming the fix", $ => {
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([[1n, { v: 1.0 }]]), DictType(IntegerType, Row));
        // Built for String keys (the default) — the source is keyed by Integer.
        const series = $.const([
            Plan.series.events(Row, { key: "marks", title: "Marks", label: _r => "M", marks: _r => [] }),
        ], ArrayType(Plan.Types.Series(Row)));
        const refusal = (() => {
            try { Plan.Root({ axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }), data, series }); return ""; }
            catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(refusal.includes("keyType")), true));
    });

    test("every series arm carries identity — a section, a group and literal rows are each a unit a person picks (#590)", $ => {
        const Row = StructType({ v: FloatType });
        const section = $.let(Plan.series.section(Row, { key: "machines", title: "Machines", subtitle: "8 rs" }, []));
        $(Assert.equal(section.getTag(), "section"));
        $(Assert.equal(section.unwrap("section").key, "machines"));
        $(Assert.equal(section.unwrap("section").title, "Machines"));
        $(Assert.equal(section.unwrap("section").subtitle.unwrap("some"), "8 rs"));
        // One strip per entry is ONE library entry, with its own identity.
        const Line = DictType(StringType, Row);
        const lines = $.let(Plan.series.group(Line, {
            key: "lines", title: "Lines", label: (_g, k) => k,
            children: Plan.children((g) => g, [
                Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
            ]),
        }));
        $(Assert.equal(lines.getTag(), "group"));
        $(Assert.equal(lines.unwrap("group").key, "lines"));
        $(Assert.equal(lines.unwrap("group").subtitle.hasTag("none"), true));
        // Literal chrome names itself, so it can be switched off like anything
        // else rather than being the one row a user cannot turn off.
        const chrome = $.let(Plan.series.rows(Row, { key: "chrome", title: "Milestones" },
            [Plan.events({ key: "ms", label: "MS" })]));
        $(Assert.equal(chrome.getTag(), "rows"));
        $(Assert.equal(chrome.unwrap("rows").key, "chrome"));
        $(Assert.equal(chrome.unwrap("rows").title, "Milestones"));
    });

    test("Plan.pickItems reads identity and kind off every arm, in list order, with no counts (#822)", $ => {
        const Row = StructType({ line: StringType, v: FloatType });
        const all = $.const([
            Plan.series.heat(Row, {
                key: "load", title: "Line load", subtitle: "per line",
                label: (_r, k) => k,
                cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
            }),
            Plan.series.events(Row, {
                key: "marks", title: "Marks",
                label: (_r, k) => k, marks: _r => [],
            }),
            // A SECTION is listed as one entry — the block a person picks.
            Plan.series.section(Row, { key: "machines", title: "Machines", subtitle: "a section" }, [
                Plan.series.span(Row, { key: "inner", title: "Inner", label: (_r, k) => k, runs: _r => [] }),
            ]),
            Plan.series.views(Row, { key: "asset", title: "Asset" }, [
                Plan.series.span(Row, { key: "asset-jobs", title: "Jobs", label: (_r, k) => k, runs: _r => [] }),
            ]),
        ], ArrayType(Plan.Types.Series(Row)));
        // The DESCRIPTORS — the bound path builds `items` from these same
        // accessors, so proving these proves it (State.bind is not runnable here).
        const items = $.let(Plan.pickItems(all));
        $(Assert.equal(items.map((_$, i) => i.id), ["load", "marks", "machines", "asset"]));
        $(Assert.equal(items.get(0n).title, "Line load"));
        $(Assert.equal(items.get(0n).subtitle.unwrap("some"), "per line"));
        // The kind's documented glyph (#590 §4.3).
        $(Assert.equal(items.get(0n).icon.unwrap("some").name, "table-cells-large"));
        $(Assert.equal(items.get(1n).icon.unwrap("some").name, "flag"));
        $(Assert.equal(items.get(2n).icon.unwrap("some").name, "heading"));
        $(Assert.equal(items.get(3n).icon.unwrap("some").name, "clone"));
        // No counts: a count means something only when every entry is in hand,
        // and nothing on a Plan may differ between inline and paged data.
        $(Assert.equal(items.filter((_$, i) => i.count.hasTag("some")).size(), 0n));
        // TWO entries of the same KIND stay two entries — the library keys on `key`.
        const twoHeats = $.const([
            Plan.series.heat(Row, {
                key: "load", title: "Line load", label: (_r, k) => k,
                cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
            }),
            Plan.series.heat(Row, {
                key: "quality", title: "Quality index", label: (_r, k) => k,
                cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
            }),
        ], ArrayType(Plan.Types.Series(Row)));
        const pair = $.let(Plan.pickItems(twoHeats));
        $(Assert.equal(pair.map((_$, i) => i.id), ["load", "quality"]));
        // Same glyph, because the glyph says what a row LOOKS like.
        $(Assert.equal(pair.get(1n).icon.unwrap("some").name, "table-cells-large"));
    });

    test("`series` and `pick` are exclusive — exactly one, or the Plan refuses (#590)", $ => {
        const Row = StructType({ v: FloatType });
        const data = $.const(new Map([["a", { v: 1.0 }], ["b", { v: 2.0 }]]), DictType(StringType, Row));
        const all = $.const([
            Plan.series.heat(Row, {
                key: "load", title: "Load", label: (_r, k) => k,
                cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
            }),
            Plan.series.events(Row, { key: "ms", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
        ], ArrayType(Plan.Types.Series(Row)));
        const axis = Plan.axis({ window: { min: W27, max: END }, resolution: "week" });
        // `series` and `pick` are alternatives — the handle already carries the
        // list, so giving both would say it twice.
        $(Assert.equal(East.value((() => {
            try { Plan.Root({ axis, data, series: all, pick: undefined as never }); return true; }
            catch { return false; }
        })()), true));
        $(Assert.equal(East.value((() => {
            try { Plan.Root({ axis, data }); return false; }
            catch { return true; }
        })()), true));
    });

    test("a paged source keeps its handle's id — the derived source is the author's source (#822)", $ => {
        const Row = StructType({ v: FloatType });
        const Source = DictType(StringType, Row);
        const rows = $.const(new Map([["m1", { v: 1.0 }]]), Source);
        const handle = $.const({
            page: East.function([IntegerType, IntegerType], OptionType(Source), ($, o, _l) => {
                const noPage = $.const(none, OptionType(Source));
                return o.equal(0n).ifElse(() => some(rows), () => noPage);
            }),
            total: East.function([], OptionType(IntegerType), (_$) => some(1n)),
            id: East.value("ops"),
        }, StructType({
            page: FunctionType([IntegerType, IntegerType], OptionType(Source)),
            total: FunctionType([], OptionType(IntegerType)),
            id: StringType,
        }));
        const spanSeries = Plan.series.span(Row, { key: "span", title: "Span", label: (_r, k) => k, runs: _r => [] });
        const heatSeries = Plan.series.heat(Row, {
            key: "heat", title: "Heat", label: (_r, k) => k,
            cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
        });
        // The helper's list is typed for the TIME canvas it builds: the
        // phantom axis kind makes "a series of any kind" a MIXED list, which a
        // `"time"` root refuses at compile time (see the last test).
        const build = (series: PlanSeriesValue<"time">[]) =>
            Plan.Root({ axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }), data: handle, series });
        const both = $.let(build([spanSeries, heatSeries]).unwrap().unwrap("Plan").rows.unwrap("paged"));
        const one  = $.let(build([spanSeries]).unwrap().unwrap("Plan").rows.unwrap("paged"));
        // Equivalence (#809) and revisions keep a window cache honest — the id
        // is the author's, whichever series derive it.
        $(Assert.equal(both.id, "ops"));
        $(Assert.equal(one.id, "ops"));
    });

    test("a paged data handle derives the canvas-row source — page wraps the series, total passes through", $ => {
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
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data: handle,
            series: [
                Plan.series.span(OpsRow, {
                    key: "machines", title: "Machines",
                    label: (_r, k) => k,
                    runs: r => r.kind.unwrap("machine").jobs.map((_$, j) => Plan.run({
                        key: j.batch, start: j.start, end: j.end,
                        label: East.str`RUN · ${j.batch}`, state: j.state,
                    })),
                }),
                Plan.series.events(OpsRow, { key: "marks", title: "Marks", label: (_r, k) => k, marks: _r => [] }),
            ],
        }));
        // The stored source is the DERIVED handle at the canvas's blocks —
        // each window's RAW entries flow through the same accessor derivations.
        const src = $.let(p.unwrap().unwrap("Plan").rows.unwrap("paged"));
        $(Assert.equal(src.total().unwrap("some"), 1n));
        // A window is every block's share of its entries, from ONE read (#823):
        // one block per data series, each its entries' rows in order.
        const w0 = $.let(src.page(0n, 100n).unwrap("some"));
        $(Assert.equal(w0.size(), 2n));
        $(Assert.equal(w0.get(0n).rows.size(), 1n));
        $(Assert.equal(w0.get(0n).rows.get(0n).id, Plan.ref("machines", "m1")));
        $(Assert.equal(w0.get(0n).rows.get(0n).kind.unwrap("span").runs.get(0n).label, "RUN · B-1"));
        $(Assert.equal(w0.get(1n).rows.map((_$, r) => r.id), [Plan.ref("marks", "m1")]));
        // A window the author's handle can't serve stays none (loading).
        $(Assert.equal(src.page(1n, 100n).hasTag("none"), true));
    });

    // =========================================================================
    // The typed axis (#631) — { time | number | ordinal } on every row kind
    // =========================================================================

    test("Plan.axis.number / .ordinal declare the other two arms; Plan.axis stays the time shorthand", $ => {
        const t = $.let(Plan.axis({ window: { min: W27, max: END }, resolution: "week" }));
        $(Assert.equal(t.getTag(), "time"));
        $(Assert.equal(Plan.axis.time({ resolution: "day" }).getTag(), "time"));
        const n = $.let(Plan.axis.number({ window: { min: 1, max: 9 }, step: 1, now: 5, format: Chart.format.number() }));
        $(Assert.equal(n.getTag(), "number"));
        const num = $.let(n.unwrap("number"));
        $(Assert.equal(num.window.unwrap("some").min, 1.0));
        $(Assert.equal(num.window.unwrap("some").max, 9.0));
        $(Assert.equal(num.step, 1.0));
        $(Assert.equal(num.now.unwrap("some"), 5.0));
        // The tick format is the shared Chart vocabulary (ValueFormatType).
        $(Assert.equal(num.format.unwrap("some").hasTag("number"), true));
        // Window / now / format are optional on the declaration — a bound
        // slice's float range supplies an absent window; `step` is the one
        // declaration.
        const bare = $.let(Plan.axis.number({ step: 0.5 }).unwrap("number"));
        $(Assert.equal(bare.window.hasTag("none"), true));
        $(Assert.equal(bare.now.hasTag("none"), true));
        $(Assert.equal(bare.step, 0.5));
        const o = $.let(Plan.axis.ordinal({ values: ["INTAKE", "PREP", "BUILD"], now: "PREP" }));
        $(Assert.equal(o.getTag(), "ordinal"));
        const ord = $.let(o.unwrap("ordinal"));
        $(Assert.equal(ord.values.length(), 3n));
        $(Assert.equal(ord.values.get(1n), "PREP"));
        $(Assert.equal(ord.now.unwrap("some"), "PREP"));
        // An expression list works too — the values ARE the buckets.
        const phases = $.const(["A", "B"], ArrayType(StringType));
        $(Assert.equal(Plan.axis.ordinal({ values: phases }).unwrap("ordinal").values.length(), 2n));
        // Guards: a non-positive literal step and an empty literal list are
        // authoring errors (there would be no buckets).
        $(Assert.equal(East.value((() => {
            try { Plan.axis.number({ step: 0 }); return false; } catch { return true; }
        })()), true));
        $(Assert.equal(East.value((() => {
            try { Plan.axis.ordinal({ values: [] }); return false; } catch { return true; }
        })()), true));
        // The root carries whichever arm it was given.
        const Row = StructType({ id: StringType });
        const data = $.const(new Map(), DictType(StringType, Row));
        const p = $.let(Plan.Root({ axis: Plan.axis.ordinal({ values: ["P1", "P2"] }), data, series: [] }));
        $(Assert.equal(p.unwrap().unwrap("Plan").axis.getTag(), "ordinal"));
    });

    test("element builders wrap an instant by its type — Date / number / string, and DateTime / Float / Integer / String expressions", $ => {
        // The JS sugar: a Date is a `time` instant, a number a `number` one, a string an `ordinal` one.
        const asDate = $.let(Plan.run({ key: "a", start: W27, end: W28, label: "A", state: "actual" }));
        $(Assert.equal(asDate.start.unwrap("time"), W27));
        $(Assert.equal(asDate.end.unwrap("time"), W28));
        const asNumber = $.let(Plan.run({ key: "b", start: 2, end: 5, label: "B", state: "actual" }));
        $(Assert.equal(asNumber.start.unwrap("number"), 2.0));
        $(Assert.equal(asNumber.end.unwrap("number"), 5.0));
        const asOrdinal = $.let(Plan.run({ key: "c", start: "PREP", end: "QC", label: "C", state: "actual" }));
        $(Assert.equal(asOrdinal.start.unwrap("ordinal"), "PREP"));
        $(Assert.equal(asOrdinal.end.unwrap("ordinal"), "QC"));
        // Expressions wrap by their STATIC type — the DateTime accessor every
        // existing canvas passes keeps compiling unchanged, and a Float /
        // Integer / String field lands on the other arms.
        const d = $.const(W29, DateTimeType);
        const f = $.const(3.5, FloatType);
        const i = $.const(4n, IntegerType);
        const str = $.const("BUILD", StringType);
        $(Assert.equal(Plan.event({ key: "e", at: d, state: "confirmed" }).at.unwrap("time"), W29));
        $(Assert.equal(Plan.mark({ key: "m", at: f, kind: "milestone" }).at.unwrap("number"), 3.5));
        $(Assert.equal(Plan.marker({ at: i, message: "x" }).at.unwrap("number"), 4.0));
        $(Assert.equal(Plan.chip({ key: "c", from: str, to: "SHIP", label: "L", state: "confirmed" }).from.unwrap("ordinal"), "BUILD"));
        // An explicit instant passes straight through; `Plan.at.*` builds one.
        const explicit = $.const(Plan.at.number(7), Plan.Types.Instant);
        $(Assert.equal(Plan.decision({ key: "d", at: explicit, applied: true }).at.unwrap("number"), 7.0));
        $(Assert.equal(Plan.port({ at: Plan.at.time(W28) }).at.unwrap("time"), W28));
        $(Assert.equal(Plan.at.ordinal("QC").unwrap("ordinal"), "QC"));
        $(Assert.equal(Plan.at.number(f).unwrap("number"), 3.5));
        // A bare variant VALUE is an instant too.
        $(Assert.equal(Plan.port({ at: variant("ordinal", "PACK") }).at.unwrap("ordinal"), "PACK"));
    });

    test("tableCells wraps a raw cell's `at` by its field type — DateTime, Float, Integer, String, or an instant", $ => {
        // Literal records take the JS sugar…
        const asDate = $.let(Plan.tableCells([{ at: W27, value: some(1.0) }]));
        $(Assert.equal(asDate.get(0n).at.unwrap("time"), W27));
        const asNumber = $.let(Plan.tableCells([{ at: 3, value: some(1.0) }]));
        $(Assert.equal(asNumber.get(0n).at.unwrap("number"), 3.0));
        $(Assert.equal(Plan.tableCells([{ at: "QC", value: none }]).get(0n).at.unwrap("ordinal"), "QC"));
        // …and an East array wraps by its element's STATIC `at` type, so a
        // `{ at: DateTimeType, value }` dataset compiles unchanged and a
        // numeric / string one lands on its arm.
        const DateCell = StructType({ at: DateTimeType, value: OptionType(FloatType) });
        const dates = $.const([{ at: W28, value: some(9.0) }], ArrayType(DateCell));
        $(Assert.equal(Plan.tableCells(dates).get(0n).at.unwrap("time"), W28));
        const FloatCell = StructType({ at: FloatType, value: OptionType(FloatType) });
        const floats = $.const([{ at: 2.0, value: some(9.0) }], ArrayType(FloatCell));
        $(Assert.equal(Plan.tableCells(floats).get(0n).at.unwrap("number"), 2.0));
        const IntCell = StructType({ at: IntegerType, value: OptionType(FloatType) });
        const ints = $.const([{ at: 4n, value: none }], ArrayType(IntCell));
        $(Assert.equal(Plan.tableCells(ints).get(0n).at.unwrap("number"), 4.0));
        $(Assert.equal(Plan.tableCells(ints).get(0n).value.hasTag("none"), true));
        const StrCell = StructType({ at: StringType, value: OptionType(FloatType) });
        const strs = $.const([{ at: "QC", value: some(2.0) }], ArrayType(StrCell));
        $(Assert.equal(Plan.tableCells(strs).get(0n).at.unwrap("ordinal"), "QC"));
        const InstCell = StructType({ at: Plan.Types.Instant, value: OptionType(FloatType) });
        const insts = $.const([{ at: variant("ordinal", "PACK"), value: some(2.0) }], ArrayType(InstCell));
        $(Assert.equal(Plan.tableCells(insts).get(0n).at.unwrap("ordinal"), "PACK"));
    });

    test("chart layers carry the x accessor's arm — a numeric x lands number points, a string x ordinal ones; annotations follow", $ => {
        const DayRow = StructType({ day: FloatType, y: FloatType });
        const IdxRow = StructType({ idx: IntegerType, y: FloatType });
        const PhaseRow = StructType({ phase: StringType, y: FloatType });
        const days = $.const([{ day: 1.0, y: 10.0 }, { day: 2.0, y: 20.0 }], ArrayType(DayRow));
        const idxs = $.const([{ idx: 3n, y: 10.0 }], ArrayType(IdxRow));
        const phases = $.const([{ phase: "PREP", y: 1.0 }, { phase: "QC", y: 2.0 }], ArrayType(PhaseRow));
        const numeric = $.let(Plan.chart({ key: "n", label: "N", layers: [
            Chart.Column(days, { x: r => r.day, y: r => r.y }),
            Chart.refDot({ x: 2, y: 20, label: "PEAK" }),
            Chart.refBand({ x: [1, 2], label: "RAMP" }),
            // An Integer x is a number too (the Chart builder already floats it).
            Chart.Scatter(idxs, { x: r => r.idx, y: r => r.y }),
        ] }));
        const nk = $.let(numeric.get(0n).kind.unwrap("chart"));
        $(Assert.equal(nk.layers.get(0n).unwrap("column").points.get(0n).t.unwrap("number"), 1.0));
        $(Assert.equal(nk.layers.get(0n).unwrap("column").points.get(1n).t.unwrap("number"), 2.0));
        $(Assert.equal(nk.layers.get(1n).unwrap("refDot").t.unwrap("number"), 2.0));
        $(Assert.equal(nk.layers.get(2n).unwrap("refBand").from.unwrap("number"), 1.0));
        $(Assert.equal(nk.layers.get(2n).unwrap("refBand").to.unwrap("number"), 2.0));
        $(Assert.equal(nk.layers.get(3n).unwrap("scatter").points.get(0n).t.unwrap("number"), 3.0));
        const ordinal = $.let(Plan.chart({ key: "o", label: "O", layers: [
            Chart.Line(phases, { x: r => r.phase, y: r => r.y }),
            Chart.refDot({ x: "QC", y: 2 }),
        ] }));
        const ok = $.let(ordinal.get(0n).kind.unwrap("chart"));
        $(Assert.equal(ok.layers.get(0n).unwrap("line").points.get(1n).t.unwrap("ordinal"), "QC"));
        $(Assert.equal(ok.layers.get(1n).unwrap("refDot").t.unwrap("ordinal"), "QC"));
    });

    test("every element instant is the shared variant — cell refs report it, and a data-driven series carries the arm through", $ => {
        // A cell ref's `at` is an instant, so a number-axis cell reports a
        // number and an ordinal-axis cell a value — never an index.
        const ev = $.const(variant("cell", { row: Plan.ref("span", "m1"), at: Plan.at.number(3) }), Plan.Types.ElementRef);
        $(Assert.equal(ev.unwrap("cell").at.unwrap("number"), 3.0));
        // A series over numeric raw rows: the FloatType `start` / `end` fields
        // wrap through `Plan.run` with nothing else written.
        const JobRow = StructType({ start: FloatType, end: FloatType, state: EventStateType });
        const data = $.const(new Map([
            ["m1", { start: 1.0, end: 4.0, state: variant("actual", null) }],
        ]), DictType(StringType, JobRow));
        const p = $.let(Plan.Root({
            axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }),
            data,
            series: [Plan.series.span(JobRow, {
                key: "span", title: "Span", label: (_r, k) => k,
                runs: (r, k) => [Plan.run({ key: k, start: r.start, end: r.end, label: k, state: r.state })],
            })],
        }));
        const run = $.let(p.unwrap().unwrap("Plan").rows.unwrap("inline").flatMap((_$, b) => b.rows).get(0n).kind.unwrap("span").runs.get(0n));
        $(Assert.equal(run.start.unwrap("number"), 1.0));
        $(Assert.equal(run.end.unwrap("number"), 4.0));
    });

    test("the axis kind is a TYPE — a series on another arm is refused at compile time; erased values pass", $ => {
        const JobRow = StructType({ start: FloatType, end: FloatType, when: DateTimeType, state: EventStateType });
        const data = $.const(new Map([
            ["m1", { start: 1.0, end: 4.0, when: W27, state: variant("actual", null) }],
        ]), DictType(StringType, JobRow));
        // The runs' kind rides the series' TYPE: a Float accessor makes a
        // `"number"` series, a DateTime accessor a `"time"` one — nothing is
        // written, the brand is inferred from the accessors' static types.
        const numberRuns = Plan.series.span(JobRow, {
            key: "n", title: "N", label: (_r, k) => k,
            runs: (r, k) => [Plan.run({ key: k, start: r.start, end: r.end, label: k, state: r.state })],
        });
        const timeRuns = Plan.series.span(JobRow, {
            key: "t", title: "T", label: (_r, k) => k,
            runs: (r, k) => [Plan.run({ key: k, start: r.when, end: r.when, label: k, state: r.state })],
        });
        const ok = $.let(Plan.Root({ axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), data, series: [numberRuns] }));
        $(Assert.equal(ok.unwrap().unwrap("Plan").axis.getTag(), "number"));
        // A `"time"` series on a `"number"` axis, and a mixed list on a
        // `"time"` axis, fail to COMPILE — the directives fail the build if
        // the check ever stops firing. (They still evaluate: the RUNTIME holds
        // rows to the axis at render, not here.)
        // @ts-expect-error — a "time" series cannot mount on a "number" axis
        const bad = $.let(Plan.Root({ axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), data, series: [timeRuns] }));
        $(Assert.equal(bad.unwrap().unwrap("Plan").axis.getTag(), "number"));
        // @ts-expect-error — a mixed list cannot mount on a "time" axis
        const mixed = $.let(Plan.Root({ axis: Plan.axis.time({ window: { min: W27, max: END }, resolution: "week" }), data, series: [timeRuns, numberRuns] }));
        $(Assert.equal(mixed.unwrap().unwrap("Plan").axis.getTag(), "time"));
        // Kind-ERASED values constrain nothing — a `$.const`-bound series list
        // and a `$.let`-bound axis both mount; those stay the render-time
        // diagnostic's to hold.
        const erased = $.const([timeRuns], ArrayType(Plan.Types.Series(JobRow)));
        const viaConst = $.let(Plan.Root({ axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), data, series: erased }));
        $(Assert.equal(viaConst.unwrap().unwrap("Plan").axis.getTag(), "number"));
        const axis = $.let(Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), Plan.Types.Axis);
        const viaLet = $.let(Plan.Root({ axis, data, series: [timeRuns] }));
        $(Assert.equal(viaLet.unwrap().unwrap("Plan").axis.getTag(), "number"));
        // Literal rows brand the same way — through `Plan.series.rows` and the
        // kind factories: Date chips refuse a number axis, `Plan.at.number`
        // heat cells mount on it.
        const chips = Plan.series.rows(JobRow, { key: "c", title: "C" }, [
            Plan.cards({ key: "crew", label: "Crew", chips: [Plan.chip({ key: "s", from: W27, to: W28, label: "80h", state: "confirmed" })] }),
        ]);
        // @ts-expect-error — literal "time" chips cannot mount on a "number" axis
        const badRows = $.let(Plan.Root({ axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), data, series: [chips] }));
        $(Assert.equal(badRows.unwrap().unwrap("Plan").axis.getTag(), "number"));
        const heat = Plan.series.rows(JobRow, { key: "h", title: "H" }, [
            Plan.heat({ key: "load", label: "Load", cells: Plan.heatCells([{ at: Plan.at.number(3), value: some(40.0), label: none }]) }),
        ]);
        const okRows = $.let(Plan.Root({ axis: Plan.axis.number({ window: { min: 1, max: 9 }, step: 1 }), data, series: [heat] }));
        $(Assert.equal(okRows.unwrap().unwrap("Plan").axis.getTag(), "number"));
    });

}, { platformFns: TestImpl });
