/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan.series.views` over a tree (#1219, #1436): `children` names the field
 * holding more of the views' own entries, each drawn as its members' rows, to
 * any depth — the views' `match` and `collapsed` at every level, a span
 * member's `rollup` over the children nested under its row, and a gesture on a
 * nested member row written back into its entry, through that field. A
 * gesture whose row names an entry the tree lacks writes nothing, through a
 * views' walk or a data series' own.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, OptionType, RecursiveType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";

const axis = Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-12T00:00:00Z") }, resolution: "day" });

type RowId = ValueTypeOf<typeof Plan.Types.RowId>;
type Root = ValueTypeOf<typeof Plan.Types.Root>;
const id = (series: string, ...path: string[]): RowId => variant("entry", { series, path });
const sameIds = equalFor(ArrayType(Plan.Types.RowId));
const sameParents = equalFor(ArrayType(OptionType(Plan.Types.RowId)));

/** The canvas's rows, every block's in order. */
function rowsOf(root: Root) {
    if (root.rows.type !== "inline") throw new Error("expected an inline canvas");
    return root.rows.value.flatMap((b) => b.rows);
}

// ── Resources, each holding the ones nested under it ─────────────────────────

const Res = RecursiveType((self) => StructType({ name: StringType, kids: DictType(StringType, self) }));
const Resources = DictType(StringType, Res);
type ResValue = ValueTypeOf<typeof Res>;
const leaf = (name: string): ResValue => ({ name, kids: new Map() });
/** A ← B ← (C, E), and D on its own. */
const RES: ValueTypeOf<typeof Resources> = new Map([
    ["a", { name: "A", kids: new Map([["b", { name: "B", kids: new Map([["c", leaf("C")], ["e", leaf("E")]]) }]]) }],
    ["d", leaf("D")],
]);

test("a tree's children draw as the members' rows, to any depth, each entry's after all of its parent's, under its first", () => {
    const root = East.compile(East.function([], Plan.Types.Root, ($) => {
        const roots = $.const(RES, Resources);
        return Plan.Root({
            axis, data: roots,
            series: [Plan.series.views(Res, { key: "res", title: "Resources", children: "kids" }, [
                Plan.series.span(Res, { key: "res.span", title: "Bars", label: (r) => r.name, runs: () => [] }),
                Plan.series.events(Res, { key: "res.marks", title: "Marks", label: (r) => r.name, marks: () => [] }),
            ])],
        });
    }), [])();
    const rows = rowsOf(root);
    assert.ok(sameIds(rows.map((r) => r.id), [
        id("res.span", "a"), id("res.marks", "a"),
        id("res.span", "a", "b"), id("res.marks", "a", "b"),
        id("res.span", "a", "b", "c"), id("res.marks", "a", "b", "c"),
        id("res.span", "a", "b", "e"), id("res.marks", "a", "b", "e"),
        id("res.span", "d"), id("res.marks", "d"),
    ]));
    assert.ok(sameParents(rows.map((r) => r.parent), [
        none, none,
        some(id("res.span", "a")), some(id("res.span", "a")),
        some(id("res.span", "a", "b")), some(id("res.span", "a", "b")),
        some(id("res.span", "a", "b")), some(id("res.span", "a", "b")),
        none, none,
    ]));
    assert.deepEqual(rows.map((r) => `${r.kind.type} ${r.gutter.label}`), [
        "span A", "events A", "span B", "events B", "span C", "events C", "span E", "events E", "span D", "events D",
    ]);
});

test("each member's match picks an entry's rows, and its children nest under the first that shows; the views' match and collapsed hold at every level", () => {
    const root = East.compile(East.function([], Plan.Types.Root, ($) => {
        const roots = $.const(RES, Resources);
        return Plan.Root({
            axis, data: roots,
            series: [Plan.series.views(Res, {
                key: "res", title: "Resources",
                // C draws nothing, at the third level.
                match: (r) => r.name.equal("C").not(),
                // B starts folded, at the second.
                collapsed: (r) => r.name.equal("B"),
                children: "kids",
            }, [
                // B has no bars row, so its children nest under its marks.
                Plan.series.span(Res, { key: "res.span", title: "Bars", label: (r) => r.name, runs: () => [], match: (r) => r.name.equal("B").not() }),
                Plan.series.events(Res, { key: "res.marks", title: "Marks", label: (r) => r.name, marks: () => [] }),
            ])],
        });
    }), [])();
    const rows = rowsOf(root);
    assert.ok(sameIds(rows.map((r) => r.id), [
        id("res.span", "a"), id("res.marks", "a"),
        id("res.marks", "a", "b"),
        id("res.span", "a", "b", "e"), id("res.marks", "a", "b", "e"),
        id("res.span", "d"), id("res.marks", "d"),
    ]));
    assert.ok(sameParents(rows.map((r) => r.parent), [
        none, none,
        some(id("res.span", "a")),
        some(id("res.marks", "a", "b")), some(id("res.marks", "a", "b")),
        none, none,
    ]));
    assert.deepEqual(rows.map((r) => r.collapsed), [false, false, true, false, false, false, false]);
});

test("a span member that declares rollup rolls up the children nested under its row — only a row with children, and only when declared", () => {
    const build = (rollup: boolean) => rowsOf(East.compile(East.function([], Plan.Types.Root, ($) => {
        const roots = $.const(RES, Resources);
        return Plan.Root({
            axis, data: roots,
            series: [Plan.series.views(Res, { key: "res", title: "Resources", children: "kids" }, [Plan.series.span(Res, {
                key: "res.span", title: "Bars", label: (r) => r.name, runs: () => [],
                ...(rollup ? { rollup: "byStatus" as const } : {}),
            })])],
        });
    }), [])());
    const rollupOf = (rows: ReturnType<typeof build>) => rows.map((r) =>
        `${r.gutter.label} ${r.kind.type === "span" && r.kind.value.rollup.type === "some" ? r.kind.value.rollup.value.type : "-"}`);
    // A and B have children; C, E and D are leaves.
    assert.deepEqual(rollupOf(build(true)), ["A byStatus", "B byStatus", "C -", "E -", "D -"]);
    assert.deepEqual(rollupOf(build(false)), ["A -", "B -", "C -", "E -", "D -"]);
});

// ── Entries that hold more of themselves — a gesture on a nested member row ──

const Job = StructType({ start: DateTimeType, end: DateTimeType });
const Node = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, Job), kids: DictType(StringType, self) }));
const Nodes = DictType(StringType, Node);
type JobValue = ValueTypeOf<typeof Job>;
type Jobs = [string, JobValue][];
/** Where a card lands, and the job it becomes there: an hour long, under the id the renderer minted. */
const AT = new Date("2026-10-06T06:00:00Z");
const DROPPED: Jobs = [["minted", { start: AT, end: new Date("2026-10-06T07:00:00Z") }]];
/** A ← B ← C, their jobs as given. */
const treeOf = (a: Jobs, b: Jobs, c: Jobs) => ({
    name: "A", jobs: new Map(a), kids: new Map([["b", {
        name: "B", jobs: new Map(b), kids: new Map([["c", { name: "C", jobs: new Map(c), kids: new Map() }]]),
    }]]),
});
/** A card dropped on a row, at {@link AT}, its item's id minted. */
const dropOn = (row: RowId) => variant("drop", { from: { library: "jobs", key: "card" }, row, at: variant("time", AT), duplicate: false, id: "minted" });
const encodeNode = encodeBeast2For(Node);
const decodeNode = decodeBeast2For(Node);
const sameNode = equalFor(Node);

test("a card dropped on a nested member row is written into its entry, through the field `children` names — at every depth", () => {
    const root = East.compile(East.function([], Plan.Types.Root, ($) => {
        const data = $.const(new Map([["a", treeOf([], [], [])]]), Nodes);
        return Plan.Root({
            axis, data,
            series: [Plan.series.views(Node, { key: "v", title: "Nodes", children: "kids" }, [
                Plan.series.span(Node, {
                    key: "v.span", title: "Bars", label: (n) => n.name,
                    runs: Plan.items("jobs", { from: "start", to: "end" }, (_job, id) => ({ label: id, state: "confirmed" })),
                    edit: { create: (drop) => ({ start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addHours(1n) }) },
                }),
                Plan.series.events(Node, { key: "v.marks", title: "Marks", label: (n) => n.name, marks: () => [] }),
            ])],
            editing: {},
        });
    }), [])();
    // Drawn: every level's member rows.
    assert.ok(sameIds(rowsOf(root).map((r) => r.id), [
        id("v.span", "a"), id("v.marks", "a"), id("v.span", "a", "b"), id("v.marks", "a", "b"), id("v.span", "a", "b", "c"), id("v.marks", "a", "b", "c"),
    ]));
    if (root.editing.type !== "some") return assert.fail("expected the canvas to declare editing");
    const wire = root.editing.value;
    const written = (row: RowId) => {
        const [out] = wire.write([{ id: "a", entry: encodeNode(treeOf([], [], [])), rows: [row], gesture: dropOn(row) }]);
        return out?.type === "some" ? decodeNode(out.value) : undefined;
    };
    const top = written(id("v.span", "a"));
    assert.ok(top !== undefined && sameNode(top, treeOf(DROPPED, [], [])));
    const second = written(id("v.span", "a", "b"));
    assert.ok(second !== undefined && sameNode(second, treeOf([], DROPPED, [])));
    const third = written(id("v.span", "a", "b", "c"));
    assert.ok(third !== undefined && sameNode(third, treeOf([], [], DROPPED)));
    // A member that takes no gesture, and an entry the tree lacks — at the end of the path or on the way — write nothing.
    assert.equal(written(id("v.marks", "a", "b")), undefined);
    assert.equal(written(id("v.span", "a", "x")), undefined);
    assert.equal(written(id("v.span", "a", "x", "c")), undefined);
});

test("a data series' own walk writes a nested drop, and nothing for a row naming an entry the tree lacks — where it used to throw", () => {
    const root = East.compile(East.function([], Plan.Types.Root, ($) => {
        const data = $.const(new Map([["a", treeOf([], [], [])]]), Nodes);
        return Plan.Root({
            axis, data,
            series: [Plan.series.span(Node, {
                key: "s", title: "Nodes", label: (n) => n.name, children: "kids",
                runs: Plan.items("jobs", { from: "start", to: "end" }, (_job, id) => ({ label: id, state: "confirmed" })),
                edit: { create: (drop) => ({ start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addHours(1n) }) },
            })],
            editing: {},
        });
    }), [])();
    if (root.editing.type !== "some") return assert.fail("expected the canvas to declare editing");
    const wire = root.editing.value;
    const written = (row: RowId) => {
        const [out] = wire.write([{ id: "a", entry: encodeNode(treeOf([], [], [])), rows: [row], gesture: dropOn(row) }]);
        return out;
    };
    const nested = written(id("s", "a", "b", "c"));
    assert.ok(nested?.type === "some" && sameNode(decodeNode(nested.value), treeOf([], [], DROPPED)));
    assert.equal(written(id("s", "a", "x", "c"))?.type, "none");
    assert.equal(written(id("s", "a", "b", "x"))?.type, "none");
});
