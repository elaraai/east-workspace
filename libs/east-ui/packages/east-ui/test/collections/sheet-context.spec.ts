/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, IntegerType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, UIComponentType } from "@elaraai/east-ui/internal";

const Row = StructType({ id: StringType, qty: IntegerType, note: OptionType(StringType), hidden: StringType });
const Fill = OptionType(Sheet.Types.Fill(StringType));
const inspect = East.function([Sheet.Types.DraftContext(Row)], Fill, ($, ctx) => $.const(some({
    value: East.str`${ctx.row.qty}|${ctx.row.hidden}|${ctx.group}|${ctx.driver}`,
    meta: ctx.rows.size().greater(0n).ifElse(() => East.str`${ctx.rows.get(0n).qty}`, () => East.value("empty")),
}), Fill));
const flat = East.function([], UIComponentType, () => Sheet.Root(East.value([
    { id: "a", qty: 1n, note: none, hidden: "original" },
], ArrayType(Row)), { qty: Sheet.column.integer(Row), note: Sheet.column.text(Row, { fill: [inspect] }) }, { id: "id" })).toIR().compile([])();
if (flat.type !== "Sheet") throw new Error("Expected Sheet");
const flatFill = flat.value.columns[1]!.fill[0]!;
if (flatFill.type !== "sync") throw new Error("Expected synchronous fill");
const now = new Date("2026-01-05T00:00:00Z");
const wire: ValueTypeOf<typeof Sheet.Types.Row> = { id: "a", owned: false, cells: new Map([["qty", variant("Integer", 1n)]]), lines: [], band: none, subRows: [] };
const context: ValueTypeOf<typeof Sheet.Types.WireContext> = {
    drafts: new Map(), rowIndex: 0n, rowId: "a", offset: 0n, line: none, row: new Map(), rows: [wire],
    rowsOffset: 0n, partial: false, driver: none, today: now,
};

test("providers receive a new row's missing fields without fabricated values", () => {
    const result = flatFill.value({ ...context, rowId: "new", rows: [] });
    assert.deepEqual(result, some({ value: variant("String", '.missing|.missing|.none|.none'), meta: "empty" }));
});

test("invalid provisional input is visible through both row and resident rows", () => {
    const result = flatFill.value({ ...context, row: new Map([["qty", variant("Invalid", "1.5")]]) });
    assert.deepEqual(result, some({ value: variant("String", '.invalid "1.5"|.value "original"|.none|.none'), meta: '.invalid "1.5"' }));
});

test("current draft hidden fields take precedence over the source snapshot", () => {
    const bytes = encodeBeast2For(Sheet.Types.Draft(Row))({
        id: variant("value", "a"), qty: variant("value", 1n), note: variant("value", none), hidden: variant("value", "draft"),
    });
    const result = flatFill.value({ ...context, drafts: new Map([["a", bytes]]) });
    assert.deepEqual(result, some({ value: variant("String", '.value 1|.value "draft"|.none|.none'), meta: '.value 1' }));
});

// A source row is read where it sits, then nearest outward (#859). Rows that
// repeat an id tell WHICH row answers — a scan of the collection would always
// answer with the first.
const Noted = StructType({ id: StringType, note: StringType });
const reads = East.function([], UIComponentType, () => Sheet.Root(East.value([
    { id: "x", note: "first" }, { id: "a", note: "" }, { id: "b", note: "" }, { id: "x", note: "second" }, { id: "c", note: "c" },
], ArrayType(Noted)), { note: Sheet.column.text(Noted) }, { id: "id" })).toIR().compile([])();
if (reads.type !== "Sheet") throw new Error("Expected Sheet");
const readEntry = reads.value.editing.readEntry;
const decodeNoted = decodeBeast2For(Noted);
const noteOf = (id: string, offset: bigint) => {
    const read = readEntry(id, offset);
    return read.type === "some" ? decodeNoted(read.value).note : undefined;
};

test("a source row is read where it sits, then nearest outward — never the first match of a scan", () => {
    assert.equal(noteOf("x", 3n), "second");
    assert.equal(noteOf("x", 0n), "first");
    // One step above the offset is nearer than two below it; one below, than two above.
    assert.equal(noteOf("x", 2n), "second");
    assert.equal(noteOf("x", 1n), "first");
    // However far a row moved, it is found; an offset outside the rows starts at their edge.
    assert.equal(noteOf("c", 0n), "c");
    assert.equal(noteOf("c", 99n), "c");
    assert.equal(noteOf("a", -4n), "");
    assert.equal(noteOf("gone", 2n), undefined);
});

const hiddens = East.function([Sheet.Types.DraftContext(Row)], Fill, ($, ctx) => $.const(some({
    value: East.str`${ctx.rows.map((_$, r) => r.hidden)}`,
    meta: "",
}), Fill));
const three = East.function([], UIComponentType, () => Sheet.Root(East.value([
    { id: "a", qty: 1n, note: none, hidden: "ha" }, { id: "b", qty: 2n, note: none, hidden: "hb" }, { id: "c", qty: 3n, note: none, hidden: "hc" },
], ArrayType(Row)), { qty: Sheet.column.integer(Row), note: Sheet.column.text(Row, { fill: [hiddens] }) }, { id: "id" })).toIR().compile([])();
if (three.type !== "Sheet") throw new Error("Expected Sheet");
const threeFill = three.value.columns[1]!.fill[0]!;
if (threeFill.type !== "sync") throw new Error("Expected synchronous fill");

const wireB: ValueTypeOf<typeof Sheet.Types.Row> = { id: "b", owned: false, cells: new Map([["qty", variant("Integer", 2n)]]), lines: [], band: none, subRows: [] };
const wireC: ValueTypeOf<typeof Sheet.Types.Row> = { id: "c", owned: false, cells: new Map([["qty", variant("Integer", 3n)]]), lines: [], band: none, subRows: [] };

test("resident rows that a local removal shifted off their offsets keep their source fields", () => {
    // Row a is removed locally: b and c sit one place above where the source holds them.
    const result = threeFill.value({ ...context, rowId: "b", rows: [wireB, wireC] });
    assert.deepEqual(result, some({ value: variant("String", '[.value "hb", .value "hc"]'), meta: "" }));
});

const Child = StructType({ task: StringType, hidden: StringType });
const Group = StructType({ id: StringType, name: StringType, children: ArrayType(Child) });
const groupInspect = East.function([Sheet.Types.DraftContext(Group, "children")], Fill, ($, ctx) => $.const(some({
    value: East.str`${ctx.row.hidden}|${ctx.row.task}|${ctx.group.unwrap("some").name}`,
    meta: East.str`${ctx.rows.get(0n).task}|${ctx.groups.get(0n).children.get(0n).task}`,
}), Fill));
const grouped = East.function([], UIComponentType, () => Sheet.Root(East.value([
    { id: "g", name: "Group", children: [{ task: "First", hidden: "first hidden" }, { task: "Second", hidden: "second hidden" }] },
], ArrayType(Group)), { task: Sheet.column.text(Child, { fill: [groupInspect] }) }, {
    id: "id", group: Sheet.group(Group, "children", { title: "name" }),
})).toIR().compile([])();
if (grouped.type !== "Sheet") throw new Error("Expected grouped Sheet");
const groupFill = grouped.value.columns[0]!.fill[0]!;
if (groupFill.type !== "sync") throw new Error("Expected synchronous fill");

test("reordered children retain their hidden draft values and provisional group association", () => {
    const bytes = encodeBeast2For(Sheet.Types.DraftGroup(Group, "children"))({
        id: variant("value", "g"), name: variant("value", "Group"), children: [
            { task: variant("value", "Second"), hidden: variant("value", "second hidden") },
            { task: variant("value", "First"), hidden: variant("value", "first hidden") },
        ],
    });
    const groupWire: ValueTypeOf<typeof Sheet.Types.Row> = {
        id: "g", owned: false, cells: new Map([["$title", variant("String", "Group")]]), band: some({ sub: "", folded: false }), subRows: [],
        lines: [
            { key: "1", cells: new Map([["task", variant("String", "Second")]]), subRows: [] },
            { key: "0", cells: new Map([["task", variant("String", "First")]]), subRows: [] },
        ],
    };
    const result = groupFill.value({
        ...context, drafts: new Map([["g", bytes]]), rowId: "g", line: some("1"),
        row: new Map([["task", variant("String", "Edited second")]]), rows: [groupWire],
    });
    assert.deepEqual(result, some({
        value: variant("String", '.value "second hidden"|.value "Edited second"|.value "Group"'),
        meta: '.value "Edited second"|.value "Edited second"',
    }));
});
