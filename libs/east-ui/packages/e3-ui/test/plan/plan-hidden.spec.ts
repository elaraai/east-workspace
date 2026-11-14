/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a Plan's series show (#1541, U3): `series` is the list and `hidden`
 * names the ones off to start. What is checked here needs no state: a Plan
 * whose library lists no Series tab binds none, and `hidden` names the series
 * it does not draw — a series at the top of the list whole, its subtree with
 * it, and a member of a `views` alone, the entry's children nesting under the
 * first member left. The same rows are made wherever the canvas makes them: a
 * draft's too, while a gesture writes the data whichever series show.
 *
 * Where the library lists `Plan.library.series()` the series are picked: the
 * pick the root carries lists a `views` as its members, is bound under the
 * Plan's `id`, and is seeded with `hidden`. The refusals are word for word.
 * What a viewer switches in the tab is e3-ui-components' to check, on a page.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, walkIR,
    type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { PickItemType } from "@elaraai/east-ui";
import { Plan, planKeys } from "@elaraai/e3-ui/internal";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const axis = Plan.axis({ window: { min: W27, max: new Date("2026-09-21T00:00:00Z") }, resolution: "week" });

type RowId = ValueTypeOf<typeof Plan.Types.RowId>;
type Root = ValueTypeOf<typeof Plan.Types.Root>;
const entry = (series: string, ...path: string[]): RowId => variant("entry", { series, path });
const section = (series: string, ...path: string[]): RowId => variant("section", { series, path });
const sameIds = equalFor(ArrayType(Plan.Types.RowId));
const sameParents = equalFor(ArrayType(OptionType(Plan.Types.RowId)));
const sameFolds = equalFor(ArrayType(BooleanType));
const sameCharts = equalFor(ArrayType(OptionType(IntegerType)));

/** The canvas's blocks. */
function blocksOf(root: Root) {
    if (root.rows.type !== "inline") throw new Error("expected an inline canvas");
    return root.rows.value;
}
/** The canvas's rows, every block's in order. */
const rowsOf = (root: Root) => blocksOf(root).flatMap((block) => block.rows);

// ── Presses, each drawn three ways, its parts beneath ────────────────────────

const Part = StructType({ v: FloatType });
const Press = StructType({ v: FloatType, jobs: BooleanType, parts: DictType(StringType, Part), readings: DictType(DateTimeType, FloatType) });
const Presses = DictType(StringType, Press);
type PressValue = ValueTypeOf<typeof Press>;
const readings = (...values: [Date, number][]) => new SortedMap(values, compareFor(DateTimeType));
const PRESSES: ValueTypeOf<typeof Presses> = new Map<string, PressValue>([
    ["p03", { v: 1.0, jobs: true, parts: new Map([["k1", { v: 5.0 }]]), readings: readings([W27, 10]) }],
    ["p04", { v: 2.0, jobs: false, parts: new Map(), readings: readings() }],
]);

/** Each press three ways, the first folded, its parts beneath; then a section of marks; then hand-built rows. */
const pressSeries = () => [
    Plan.series.views(Press, {
        key: "presses", title: "Presses", collapsed: true,
        children: Plan.children("parts", [
            Plan.series.heat(Part, { key: "parts", title: "Parts", label: (_part, key) => key, cells: () => Plan.heatCells([]) }),
        ]),
    }, [
        Plan.series.span(Press, { key: "press-jobs", title: "Jobs", subtitle: "what runs", match: (press) => press.jobs, label: (_press, key) => key, runs: () => [] }),
        Plan.series.chart(Press, { key: "press-load", title: "Load", icon: "gauge", label: (_press, key) => key, layers: () => [] }),
        Plan.series.table(Press, {
            key: "press-readings", title: "Readings", label: (_press, key) => key, edit: true,
            cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
        }),
    ]),
    Plan.series.section(Press, { key: "notes", title: "Notes" }, [
        Plan.series.events(Press, { key: "marks", title: "Marks", label: (_press, key) => key, marks: () => [] }),
    ]),
    Plan.series.rows(Press, { key: "works", title: "Works" }, [Plan.span({ key: "shutdown", label: "Shutdown" })]),
];

/** The canvas over the presses, the series `hidden` names off. */
function canvas(hidden?: readonly string[], editing = false): Root {
    return East.function([], Plan.Types.Root, ($) => {
        const data = $.const(PRESSES, Presses);
        return Plan.Root({ axis, data, series: pressSeries(), ...(hidden === undefined ? {} : { hidden }), ...(editing ? { editing: {} } : {}) });
    }).toIR().compile([])();
}

/** What `build` throws; `""` when it builds. */
function refusal(build: () => unknown): string {
    try {
        build();
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

/** What `build` throws inside a block, as `<Plan>`'s factory runs; `""` when it builds. */
const refusalIn = (build: ($: BlockBuilder<NullType>) => unknown): string => refusal(() => { East.function([], NullType, ($) => { build($); }); });

const EVERY_ROW = [
    entry("press-jobs", "p03"), entry("press-load", "p03"), entry("press-readings", "p03"), entry("parts", "p03", "k1"),
    entry("press-load", "p04"), entry("press-readings", "p04"),
    section("notes"), entry("marks", "p03"), entry("marks", "p04"),
    entry("works", "shutdown"),
];

describe("`hidden` names the series a Plan does not draw (#1541, U3)", () => {
    test("with none hidden every series draws, the children under the first view row, which carries the fold", () => {
        for (const root of [canvas(), canvas([])]) {
            const rows = rowsOf(root);
            assert.ok(sameIds(rows.map((row) => row.id), EVERY_ROW));
            assert.ok(sameParents(rows.slice(0, 4).map((row) => row.parent), [none, none, none, some(entry("press-jobs", "p03"))]));
            assert.ok(sameFolds(rows.slice(0, 6).map((row) => row.collapsed), [true, false, false, false, true, false]));
            assert.equal(root.pick.type, "none");
        }
    });

    test("a series at the top of the list makes no block: a section's header and members go with it, and hand-built rows", () => {
        const root = canvas(["notes", "works"]);
        assert.ok(sameIds(rowsOf(root).map((row) => row.id), EVERY_ROW.slice(0, 6)));
        // One block: the presses'. A series left out makes none, never an empty one.
        assert.equal(blocksOf(root).length, 1);
        assert.equal(blocksOf(canvas()).length, 4);
    });

    test("a member of a `views` leaves alone: the entry's children nest under the first member left, which carries the fold", () => {
        const rows = rowsOf(canvas(["press-jobs"]));
        assert.ok(sameIds(rows.map((row) => row.id), [
            entry("press-load", "p03"), entry("press-readings", "p03"), entry("parts", "p03", "k1"),
            entry("press-load", "p04"), entry("press-readings", "p04"),
            ...EVERY_ROW.slice(6),
        ]));
        assert.ok(sameParents(rows.slice(0, 3).map((row) => row.parent), [none, none, some(entry("press-load", "p03"))]));
        assert.ok(sameFolds(rows.slice(0, 5).map((row) => row.collapsed), [true, false, false, true, false]));
        // Two members off: the one left is the first.
        const one = rowsOf(canvas(["press-jobs", "press-load"]));
        assert.ok(sameIds(one.slice(0, 3).map((row) => row.id), [entry("press-readings", "p03"), entry("parts", "p03", "k1"), entry("press-readings", "p04")]));
        assert.ok(sameParents(one.slice(0, 2).map((row) => row.parent), [none, some(entry("press-readings", "p03"))]));
    });

    test("every member of a `views` off leaves no row of its entries, and none beneath them", () => {
        const rows = rowsOf(canvas(["press-jobs", "press-load", "press-readings"]));
        assert.ok(sameIds(rows.map((row) => row.id), EVERY_ROW.slice(6)));
    });

    test("a `views` block says the chart rows each entry makes of the members left", () => {
        // The presses' block, the notes' header, the marks' block, the works': one chart row a press, its load.
        assert.ok(sameCharts(blocksOf(canvas()).map((block) => block.charts), [some(1n), none, some(0n), none]));
        assert.ok(sameCharts(blocksOf(canvas(["press-jobs"])).map((block) => block.charts), [some(1n), none, some(0n), none]));
        assert.ok(sameCharts(blocksOf(canvas(["press-load"])).map((block) => block.charts), [some(0n), none, some(0n), none]));
        const steady = (hidden: readonly string[]) => blocksOf(East.function([], Plan.Types.Root, ($) => {
            const data = $.const(PRESSES, Presses);
            return Plan.Root({
                axis, data, hidden,
                series: [Plan.series.views(Press, { key: "presses", title: "Presses" }, [
                    Plan.series.chart(Press, { key: "load", title: "Load", label: (_press, key) => key, layers: () => [] }),
                    Plan.series.chart(Press, { key: "output", title: "Output", label: (_press, key) => key, layers: () => [] }),
                    Plan.series.events(Press, { key: "marks", title: "Marks", label: (_press, key) => key, marks: () => [] }),
                ])],
            });
        }).toIR().compile([])()).map((block) => block.charts);
        assert.ok(sameCharts(steady([]), [some(2n)]));
        assert.ok(sameCharts(steady(["output"]), [some(1n)]));
        assert.ok(sameCharts(steady(["load", "output"]), [some(0n)]));
    });

    test("a list known only as it runs leaves a series out whole, by its key", () => {
        const rows = rowsOf(East.function([], Plan.Types.Root, ($) => {
            const data = $.const(PRESSES, Presses);
            const all = $.const(pressSeries(), ArrayType(Plan.Types.Series(Press)));
            // Its series are not known as the Plan is built: a key naming none is ignored, as a pick's state is.
            return Plan.Root({ axis, data, series: all, hidden: ["presses", "works", "gone"] });
        }).toIR().compile([])());
        assert.ok(sameIds(rows.map((row) => row.id), EVERY_ROW.slice(6, 9)));
    });

    test("a draft draws as the canvas does, and a gesture on a series left out still writes the data (#1440)", () => {
        const root = canvas(["press-readings"], true);
        if (root.editing.type !== "some") throw new Error("expected the canvas to declare editing");
        const wire = root.editing.value;
        const p03 = encodeBeast2For(Press)(PRESSES.get("p03")!);
        // One entry's rows, as a draft is compared by: no readings row.
        assert.ok(sameIds(wire.deriveEntry("p03", p03).flatMap((block) => block.rows).map((row) => row.id), [
            entry("press-jobs", "p03"), entry("press-load", "p03"), entry("parts", "p03", "k1"), section("notes"), entry("marks", "p03"), entry("works", "shutdown"),
        ]));
        // A number typed into the readings as they are switched off lands.
        const row = entry("press-readings", "p03");
        const [out] = wire.write([{ id: "p03", entry: p03, rows: [row], gesture: variant("value", { row, position: 0n, at: variant("time", W28), value: some(7) }) }]);
        assert.ok(out?.type === "some");
        assert.ok(equalFor(Press.fields.readings)(decodeBeast2For(Press)(out.value).readings, readings([W27, 10], [W28, 7])));
    });

    test("a Plan without the Series tab binds no state", () => {
        const stateCalls = (build: ($: BlockBuilder<NullType>) => unknown): string[] => {
            const names: string[] = [];
            walkIR(East.function([], NullType, ($) => { build($); }).toIR().ir, (node) => {
                if (node.type === "Platform" && node.value.name.startsWith("state_")) names.push(node.value.name);
            });
            return names;
        };
        const data = ($: BlockBuilder<NullType>) => $.const(PRESSES, Presses);
        assert.deepEqual(stateCalls(($) => { $.let(Plan.Payload({ axis, data: data($), series: pressSeries(), hidden: ["press-jobs"] })); }), []);
        // Picked, the pick is the one binding, under the Plan's id.
        assert.deepEqual(stateCalls(($) => { $.let(Plan.Payload({ id: "ops", axis, data: data($), series: pressSeries(), hidden: ["press-jobs"], library: [Plan.library.series()] })); }), ["state_bind"]);
    });
});

describe("the series are picked where the library lists the Series tab (#1541, U3)", () => {
    test("the tab's lines: each series at the top of the list, a `views` as its members, by title, role line and icon", () => {
        const items = East.compile(East.function([], ArrayType(PickItemType), () => Plan.pickItems(pressSeries())), [])();
        assert.deepEqual(items.map((item) => item.id), ["press-jobs", "press-load", "press-readings", "notes", "works"]);
        assert.deepEqual(items.map((item) => item.title), ["Jobs", "Load", "Readings", "Notes", "Works"]);
        assert.deepEqual(items.map((item) => (item.subtitle.type === "some" ? item.subtitle.value : null)), ["what runs", null, null, null, null]);
        // A member's own icon, else its kind's.
        assert.deepEqual(items.map((item) => (item.icon.type === "some" ? item.icon.value.name : null)), ["bars-staggered", "gauge", "table-list", "heading", "list"]);
        assert.ok(items.every((item) => item.count.type === "none" && !item.narrowed));
    });

    test("the pick is kept under the Plan's `id`", () => {
        assert.equal(planKeys("ops").pick, "plan.ops.pick");
        assert.equal(planKeys(undefined).pick, "plan.pick");
    });
});

describe("what `hidden` and the removed `pick` are refused in (#1541, U3)", () => {
    const data = ($: BlockBuilder<NullType>) => $.const(PRESSES, Presses);
    const NAMES = '"press-jobs", "press-load", "press-readings", "notes", "works"';

    test("`hidden` names a series at the top of `series`, or a member of a `views` there", () => {
        const hidden = (names: readonly string[]) => refusalIn(($) => Plan.Payload({ axis, data: data($), series: pressSeries(), hidden: names }));
        assert.equal(hidden(["press-jobs", "notes", "works"]), "");
        assert.equal(hidden(["utilisation"]),
            `Plan: \`hidden\` names "utilisation", which is no series of this Plan — it names a series at the top of \`series\`, or a member of a \`views\` there: ${NAMES}`);
        assert.equal(hidden(["marks"]),
            `Plan: \`hidden\` names "marks", a series nested in another, which shows and hides with it — it names a series at the top of \`series\`, or a member of a \`views\` there: ${NAMES}`);
        assert.equal(hidden(["presses"]),
            `Plan: \`hidden\` names "presses", a \`views\`, whose members show and hide each alone — it names a series at the top of \`series\`, or a member of a \`views\` there: ${NAMES}`);
        assert.equal(refusalIn(($) => Plan.Payload({ axis, data: data($), series: pressSeries(), hidden: "notes" as never })),
            'Plan: `hidden` lists the keys of the series off to start — hidden={["utilisation"]}');
    });

    test("`hidden` with no `series`", () => {
        assert.equal(refusalIn(() => Plan.Payload({ axis, rows: [Plan.events({ key: "ms", label: "Milestones" })], hidden: ["ms"] })),
            "Plan: `hidden` names series of `series`, and this Plan has none — give `series` with it, or leave `hidden` out");
    });

    test("the canvas's own `picked`, on the tag", () => {
        assert.equal(refusalIn(($) => Plan.Payload({ axis, data: data($), series: pressSeries(), picked: "mine" } as never)),
            "Plan: `picked` is the canvas's own — `data`'s series are picked where `library` lists Plan.library.series()");
    });
});
