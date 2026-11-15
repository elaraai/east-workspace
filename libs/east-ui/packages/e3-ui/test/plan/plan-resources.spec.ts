/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a Plan's event kinds land on (#1541, U1, U2): `Plan.series.resources`
 * and `Plan.series.kinds`, as the canvas draws them before any event is placed.
 *
 * A resources series makes one landing row per entry, at the entry's path under
 * the series' key — a row of no elements of its own, or of tiles in its lanes —
 * and its series beneath it, each at the same path under its own key, nested
 * under the landing row so folding it folds them. A tree makes more of them, a
 * resource at a time. A kinds block draws each entry by the case its variant
 * field holds, in the source's order, every accessor handed the case's value. A
 * gesture on a resource's series' row is written by that series.
 *
 * Where the events land is the Plan's (`plan-landing.spec.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, RecursiveType, SortedMap, StringType, StructType, VariantType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const axis = Plan.axis({ window: { min: W27, max: new Date("2026-09-21T00:00:00Z") }, resolution: "week" });

type RowId = ValueTypeOf<typeof Plan.Types.RowId>;
type Root = ValueTypeOf<typeof Plan.Types.Root>;
const entry = (series: string, ...path: string[]): RowId => variant("entry", { series, path });
const sameIds = equalFor(ArrayType(Plan.Types.RowId));
const sameParents = equalFor(ArrayType(OptionType(Plan.Types.RowId)));
const sameLabels = equalFor(ArrayType(StringType));

/** The canvas's rows, every block's in order. */
function rowsOf(root: Root) {
    if (root.rows.type !== "inline") throw new Error("expected an inline canvas");
    return root.rows.value.flatMap((block) => block.rows);
}
const ids = (root: Root) => rowsOf(root).map((r) => r.id);
const parents = (root: Root) => rowsOf(root).map((r) => r.parent);
const labels = (root: Root) => rowsOf(root).map((r) => r.gutter.label);

// ── Presses, each with its readings beneath it, the bindery's lines a tree ───

const readings = (...values: [Date, number][]) => new SortedMap(values, compareFor(DateTimeType));

const Press = StructType({ name: StringType, readings: DictType(DateTimeType, FloatType) });
const Presses = DictType(StringType, Press);
const PRESSES: ValueTypeOf<typeof Presses> = new Map([
    ["P03", { name: "Heidelberg 3", readings: readings([W27, 10]) }],
    ["P04", { name: "Heidelberg 4", readings: readings() }],
]);

/** The presses, a landing row each, its readings typed into beneath it. */
const pressRows = () => [
    Plan.series.resources(Press, {
        key: "presses", title: "Presses", label: (press) => press.name,
        sub: (_press, key) => some(key),
        series: [
            Plan.series.table(Press, {
                key: "readings", title: "Readings", label: () => "Readings", edit: true,
                cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
            }),
        ],
    }),
];

const pressRoot = East.function([], Plan.Types.Root, ($) => {
    const data = $.const(PRESSES, Presses);
    return Plan.Root({ axis, data, series: pressRows(), editing: {} });
}).toIR().compile([])();

describe("a resources series", () => {
    test("each entry is one landing row at its path under the series' key, its series beneath it at the same path, nested under it", () => {
        assert.ok(sameIds(ids(pressRoot), [
            entry("presses", "P03"), entry("readings", "P03"),
            entry("presses", "P04"), entry("readings", "P04"),
        ]));
        assert.ok(sameParents(parents(pressRoot), [
            none, some(entry("presses", "P03")),
            none, some(entry("presses", "P04")),
        ]));
        assert.ok(sameLabels(labels(pressRoot), ["Heidelberg 3", "Readings", "Heidelberg 4", "Readings"]));
        const [p03] = rowsOf(pressRoot);
        assert.equal(p03!.gutter.sub.type === "some" ? p03!.gutter.sub.value : undefined, "P03");
    });

    test("a landing row holds no element of its own: a row of bars, none in it, which rolls nothing up", () => {
        const [p03] = rowsOf(pressRoot);
        assert.equal(p03!.kind.type, "span");
        if (p03!.kind.type !== "span") return;
        assert.equal(p03!.kind.value.runs.length, 0);
        assert.equal(p03!.kind.value.rollup.type, "none");
    });

    test("declaring lanes, a landing row is a row of tiles in them, every one drawn from the start", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(PRESSES, Presses);
            return Plan.Root({
                axis, data, series: [Plan.series.resources(Press, {
                    key: "presses", title: "Presses", label: (press) => press.name,
                    lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                })],
            });
        }).toIR().compile([])();
        const [p03] = rowsOf(root);
        assert.equal(p03!.kind.type, "buckets");
        if (p03!.kind.type !== "buckets") return;
        assert.deepEqual(p03!.kind.value.lanes.map((lane) => lane.key), ["am", "pm"]);
        assert.equal(p03!.kind.value.events.length, 0);
    });

    test("a number typed into a resource's series is written by that series, into the resource's entry", () => {
        if (pressRoot.editing.type !== "some") return assert.fail("the canvas edits");
        const wire = pressRoot.editing.value;
        const encode = encodeBeast2For(Press);
        const decode = decodeBeast2For(Press);
        const row = entry("readings", "P04");
        const [out] = wire.write([{
            id: "P04", entry: encode(PRESSES.get("P04")!), rows: [row],
            gesture: variant("value", { row, position: 0n, at: variant("time", W28), value: some(7) }),
        }]);
        assert.ok(out?.type === "some");
        if (out?.type !== "some") return;
        assert.ok(equalFor(Press)(decode(out.value), { name: "Heidelberg 4", readings: readings([W28, 7]) }));
        // The landing row takes no gesture: its events are its kinds' records'.
        const [none_] = wire.write([{
            id: "P04", entry: encode(PRESSES.get("P04")!), rows: [entry("presses", "P04")],
            gesture: variant("value", { row: entry("presses", "P04"), position: 0n, at: variant("time", W28), value: some(7) }),
        }]);
        assert.equal(none_?.type, "none");
    });

    test("a tree makes a landing row of each resource beneath, nested under its parent, its bands rolling them up", () => {
        const LineNode = RecursiveType((self) => StructType({ name: StringType, lines: DictType(StringType, self) }));
        type LineValue = ValueTypeOf<typeof LineNode>;
        const line = (name: string, lines: [string, LineValue][] = []): LineValue => ({ name, lines: new Map(lines) }) as LineValue;
        const Bindery = DictType(StringType, LineNode);
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map([["B1", line("Bindery", [["B1a", line("Folder")], ["B1b", line("Stitcher")]])]]), Bindery);
            return Plan.Root({
                axis, data, series: [Plan.series.resources(LineNode, { key: "lines", title: "Lines", label: (l) => l.name, children: "lines" })],
            });
        }).toIR().compile([])();
        assert.ok(sameIds(ids(root), [entry("lines", "B1"), entry("lines", "B1", "B1a"), entry("lines", "B1", "B1b")]));
        assert.ok(sameParents(parents(root), [none, some(entry("lines", "B1")), some(entry("lines", "B1"))]));
        assert.ok(sameLabels(labels(root), ["Bindery", "Folder", "Stitcher"]));
        const [b1, b1a] = rowsOf(root);
        assert.ok(b1!.kind.type === "span" && b1!.kind.value.rollup.type === "some" && b1!.kind.value.rollup.value.type === "union");
        assert.ok(b1a!.kind.type === "span" && b1a!.kind.value.rollup.type === "none");
        // A tree is more of the series' own rows: a Dict field holding the row's own type.
        const Flat = StructType({ name: StringType, under: DictType(StringType, StructType({ name: StringType })) });
        assert.throws(() => Plan.series.resources(Flat, { key: "lines", title: "Lines", label: (l) => l.name, children: "under" as never }),
            /children "under" holds \{ name \}, not \{ name, under \}/);
    });

    test("its series are rows over the resource's own row: a group, a section or another resources series is refused", () => {
        assert.throws(() => Plan.series.resources(Press, {
            key: "presses", title: "Presses", label: (press) => press.name,
            series: [Plan.series.section(Press, { key: "notes", title: "Notes" }, [])],
        }), /Plan\.series\.resources "presses": series\[0\] is a section "Notes" series — a resource's series are rows over its own row/);
    });
});

// ── A works of several kinds of resource, in one record ─────────────────────

const What = VariantType({ press: StructType({ sheets: IntegerType }), crew: StructType({ size: IntegerType }), bay: NullType });
const Resource = StructType({ name: StringType, what: What, readings: DictType(DateTimeType, FloatType) });
const Works = DictType(StringType, Resource);
const WORKS: ValueTypeOf<typeof Works> = new Map([
    ["B1", { name: "Bay 1", what: variant("bay", null), readings: readings() }],
    ["C1", { name: "Day crew", what: variant("crew", { size: 4n }), readings: readings() }],
    ["P03", { name: "Heidelberg 3", what: variant("press", { sheets: 8000n }), readings: readings([W27, 10]) }],
    ["P04", { name: "Heidelberg 4", what: variant("press", { sheets: 6000n }), readings: readings() }],
]);

const worksRoot = (bay: false | "drawn") => East.function([], Plan.Types.Root, ($) => {
    const data = $.const(WORKS, Works);
    return Plan.Root({
        axis, data,
        series: [Plan.series.kinds(Resource, "what", {
            press: {
                title: "Presses", label: (press, _key, kind) => East.str`${press.name} · ${East.print(kind.sheets)}`,
                series: [Plan.series.heat(Resource, { key: "utilisation", title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([]) })],
            },
            crew: { title: "Crews", label: (crew, _key, kind) => East.str`${crew.name} (${East.print(kind.size)})` },
            bay: bay === false ? false : { key: "bays", title: "Bays", label: (b) => b.name },
        })],
    });
}).toIR().compile([])();

describe("a kinds block", () => {
    test("each entry is drawn by its case, in the source's order, each accessor handed the case's value", () => {
        const root = worksRoot("drawn");
        assert.ok(sameIds(ids(root), [
            entry("bays", "B1"), entry("crew", "C1"), entry("press", "P03"), entry("utilisation", "P03"), entry("press", "P04"), entry("utilisation", "P04"),
        ]));
        assert.ok(sameLabels(labels(root), ["Bay 1", "Day crew (4)", "Heidelberg 3 · 8000", "Utilisation", "Heidelberg 4 · 6000", "Utilisation"]));
    });

    test("a case drawn false leaves its entries out", () => {
        assert.ok(sameIds(ids(worksRoot(false)), [
            entry("crew", "C1"), entry("press", "P03"), entry("utilisation", "P03"), entry("press", "P04"), entry("utilisation", "P04"),
        ]));
    });

    test("its cases are the variant's, every one listed: one missing, one it lacks, and none drawn are refused", () => {
        assert.throws(() => Plan.series.kinds(Resource, "what", {
            press: { title: "Presses", label: () => "" }, crew: false,
        } as never), /Plan\.series\.kinds "what": every case of "what" is listed — a resources series, or false for one not drawn — and "bay" is not/);
        assert.throws(() => Plan.series.kinds(Resource, "what", {
            press: false, crew: false, bay: false, van: false,
        } as never), /Plan\.series\.kinds "what": "van" is no case of "what" \(bay, crew, press\)/);
        assert.throws(() => Plan.series.kinds(Resource, "what", { press: false, crew: false, bay: false }),
            /Plan\.series\.kinds "what": every case of "what" says false — draw at least one/);
        assert.throws(() => Plan.series.kinds(Resource, "name" as never, {} as never),
            /Plan\.series\.kinds "name": "name" is no variant field of its rows/);
    });

    test("a case's key is unique across the series tree, as every series' is", () => {
        assert.throws(() => East.function([], Plan.Types.Root, ($) => {
            const data = $.const(WORKS, Works);
            return Plan.Root({
                axis, data,
                series: [
                    Plan.series.kinds(Resource, "what", {
                        press: { title: "Presses", label: (r) => r.name }, crew: false, bay: false,
                    }),
                    Plan.series.span(Resource, { key: "press", title: "Jobs", label: (r) => r.name, runs: () => [] }),
                ],
            });
        }), /two series share the key "press"/);
    });
});
