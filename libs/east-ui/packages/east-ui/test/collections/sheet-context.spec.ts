/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, IntegerType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetReadyBatchType, UIComponentType } from "@elaraai/east-ui/internal";

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

// A readiness batch (#882): one call carries every check, and each check sees
// the context a wire context builds for its row — the row's own cells over its
// own draft, the rows around it, its group and its driver.
const encodeBatch = encodeBeast2For(SheetReadyBatchType);
const Ready = Sheet.Types.Readiness;
const Activity = StructType({ name: StringType, crew: IntegerType });
const Planned = StructType({ id: StringType, activity: StringType, qty: IntegerType, note: StringType, hidden: StringType });
const PlannedContext = Sheet.Types.DraftContext(Planned, Activity);
const printPlanned = East.function([PlannedContext], Fill, ($, ctx) => $.const(some({ value: East.print(ctx), meta: "" }), Fill));
const readyPlanned = East.function([Sheet.Types.Draft(Planned), PlannedContext], Ready, ($, _row, ctx) => $.const(variant("incomplete", [{ field: "", message: East.print(ctx) }]), Ready));
const planned = East.function([], UIComponentType, () => Sheet.Root(East.value([
    { id: "a", activity: "Weld", qty: 1n, note: "", hidden: "source a" },
    { id: "b", activity: "Paint", qty: 2n, note: "", hidden: "source b" },
    { id: "c", activity: "Weld", qty: 3n, note: "", hidden: "source c" },
], ArrayType(Planned)), {
    activity: Sheet.column.lookup(Planned),
    qty: Sheet.column.integer(Planned),
    note: Sheet.column.text(Planned, { fill: [printPlanned] }),
}, {
    id: "id",
    driver: Sheet.driver("activity", East.value([{ name: "Weld", crew: 2n }, { name: "Paint", crew: 1n }], ArrayType(Activity)), { key: a => a.name, label: a => a.name }),
    ready: { row: readyPlanned },
})).toIR().compile([])();
if (planned.type !== "Sheet" || planned.value.editing.readyRow.type !== "some") throw new Error("Expected a Sheet with a row check");
const plannedReady = planned.value.editing.readyRow.value;
const plannedFill = planned.value.columns[2]!.fill[0]!;
if (plannedFill.type !== "sync") throw new Error("Expected synchronous fill");
const encodePlanned = encodeBeast2For(Sheet.Types.Draft(Planned));
const plannedDraft = (id: string, activity: string, qty: bigint) => encodePlanned({
    id: variant("value", id), activity: variant("value", activity), qty: variant("value", qty), note: variant("value", ""), hidden: variant("value", `draft ${id}`),
});
const plannedWire = (id: string, activity: string, qty: bigint): ValueTypeOf<typeof Sheet.Types.Row> => ({
    id, owned: false, lines: [], band: none, subRows: [],
    cells: new Map<string, ValueTypeOf<typeof Sheet.Types.Cell>>([["activity", variant("String", activity)], ["qty", variant("Integer", qty)], ["note", variant("String", "")]]),
});

test("a readiness batch calls once for every check, each seeing the context a wire context builds for its row", () => {
    // Rows b and c carry drafts, with edited quantities; row a is read from the source.
    const rows = [plannedWire("a", "Weld", 1n), plannedWire("b", "Paint", 7n), plannedWire("c", "Weld", 8n)];
    const drafts = new Map([["b", plannedDraft("b", "Paint", 2n)], ["c", plannedDraft("c", "Weld", 3n)]]);
    const results = plannedReady(encodeBatch({
        drafts, rows, rowsOffset: 0n, partial: false, today: now,
        checks: [{ index: 1n, line: none, driver: some("Paint") }, { index: 2n, line: none, driver: some("Weld") }],
    }));
    const wireFor = (index: number, driver: string) => plannedFill.value({
        drafts, rowIndex: BigInt(index), rowId: rows[index]!.id, offset: BigInt(index), line: none, row: rows[index]!.cells,
        rows, rowsOffset: 0n, partial: false, driver: some(driver), today: now,
    });
    const expected = [wireFor(1, "Paint"), wireFor(2, "Weld")].map((fill) => {
        if (fill.type !== "some" || fill.value.value.type !== "String") throw new Error("Expected a printed context");
        return variant("incomplete", [{ field: "", message: fill.value.value.value }]);
    });
    assert.deepEqual(results, expected);
    // The contexts are not vacuous: the edited cells over the drafts' hidden
    // fields, the source's row a, and the row's own driver.
    const message = (results[0]! as { value: { message: string }[] }).value[0]!.message;
    for (const part of ['qty=.value 7', 'hidden=.value "draft b"', 'hidden=.value "source a"', 'crew=1']) assert.ok(message.includes(part), `${part} in ${message}`);
});

const Line = StructType({ task: StringType, hidden: StringType });
const Order = StructType({ id: StringType, name: StringType, lines: ArrayType(Line) });
const OrderContext = Sheet.Types.DraftContext(Order, "lines");
const printOrder = East.function([OrderContext], Fill, ($, ctx) => $.const(some({ value: East.print(ctx), meta: "" }), Fill));
const readyOrder = East.function([Sheet.Types.Draft(Line), OrderContext], Ready, ($, _row, ctx) => $.const(variant("incomplete", [{ field: "", message: East.print(ctx) }]), Ready));
const orders = East.function([], UIComponentType, () => Sheet.Root(East.value([
    { id: "o1", name: "First", lines: [{ task: "Cut", hidden: "cut source" }, { task: "Fold", hidden: "fold source" }] },
    { id: "o2", name: "Second", lines: [{ task: "Pack", hidden: "pack source" }] },
], ArrayType(Order)), { task: Sheet.column.text(Line, { fill: [printOrder] }) }, {
    id: "id", group: Sheet.group(Order, "lines", { title: "name" }), ready: { row: readyOrder },
})).toIR().compile([])();
if (orders.type !== "Sheet" || orders.value.editing.readyRow.type !== "some") throw new Error("Expected a grouped Sheet with a row check");
const ordersReady = orders.value.editing.readyRow.value;
const ordersFill = orders.value.columns[0]!.fill[0]!;
if (ordersFill.type !== "sync") throw new Error("Expected synchronous fill");

test("a grouped readiness batch hands each line the context a wire context builds for it — its group, its group's lines, every group", () => {
    const orderDraft = encodeBeast2For(Sheet.Types.DraftGroup(Order, "lines"))({
        id: variant("value", "o1"), name: variant("value", "First"), lines: [
            { task: variant("value", "Cut"), hidden: variant("value", "cut draft") },
            { task: variant("value", "Fold"), hidden: variant("value", "fold draft") },
        ],
    });
    const line = (key: string, task: string) => ({ key, cells: new Map([["task", variant("String", task)]]), subRows: [] });
    const rows: ValueTypeOf<typeof Sheet.Types.Row>[] = [
        { id: "o1", owned: false, cells: new Map([["$title", variant("String", "First")]]), band: some({ sub: "", folded: false }), subRows: [], lines: [line("0", "Cut edited"), line("1", "Fold")] },
        { id: "o2", owned: false, cells: new Map([["$title", variant("String", "Second")]]), band: some({ sub: "", folded: false }), subRows: [], lines: [line("0", "Pack")] },
    ];
    const drafts = new Map([["o1", orderDraft]]);
    const results = ordersReady(encodeBatch({
        drafts, rows, rowsOffset: 0n, partial: false, today: now,
        checks: [{ index: 0n, line: some(0n), driver: none }, { index: 0n, line: some(1n), driver: none }, { index: 1n, line: some(0n), driver: none }],
    }));
    const wireFor = (index: number, at: number) => ordersFill.value({
        drafts, rowIndex: BigInt(at), rowId: rows[index]!.id, offset: BigInt(index), line: some(rows[index]!.lines[at]!.key), row: rows[index]!.lines[at]!.cells,
        rows, rowsOffset: 0n, partial: false, driver: none, today: now,
    });
    const expected = [wireFor(0, 0), wireFor(0, 1), wireFor(1, 0)].map((fill) => {
        if (fill.type !== "some" || fill.value.value.type !== "String") throw new Error("Expected a printed context");
        return variant("incomplete", [{ field: "", message: fill.value.value.value }]);
    });
    assert.deepEqual(results, expected);
    const message = (results[1]! as { value: { message: string }[] }).value[0]!.message;
    for (const part of ['task=.value "Cut edited"', 'hidden=.value "fold draft"', 'hidden=.value "pack source"', 'rowIndex=1']) assert.ok(message.includes(part), `${part} in ${message}`);
});

const strict = East.function([Sheet.Types.Draft(Row), Sheet.Types.DraftContext(Row)], Ready, ($, row) => {
    $.if(row.qty.hasTag("value").and(() => row.qty.unwrap("value").equal(0n)), ($) => { $.error("a quantity of zero"); });
    return variant("incomplete", [{ field: "qty", message: "Checked" }]);
});
const strictSheet = East.function([], UIComponentType, () => Sheet.Root(East.value([
    { id: "a", qty: 1n, note: none, hidden: "a" }, { id: "b", qty: 1n, note: none, hidden: "b" },
], ArrayType(Row)), { qty: Sheet.column.integer(Row) }, { id: "id", ready: { row: strict } })).toIR().compile([])();
if (strictSheet.type !== "Sheet" || strictSheet.value.editing.readyRow.type !== "some") throw new Error("Expected a Sheet with a row check");
const strictReady = strictSheet.value.editing.readyRow.value;

test("a check that throws fails its own row alone — the batch's other checks still report", () => {
    const wireOf = (id: string, qty: bigint): ValueTypeOf<typeof Sheet.Types.Row> => ({ id, owned: false, cells: new Map([["qty", variant("Integer", qty)]]), lines: [], band: none, subRows: [] });
    const results = strictReady(encodeBatch({
        drafts: new Map(), rows: [wireOf("a", 0n), wireOf("b", 2n)], rowsOffset: 0n, partial: false, today: now,
        checks: [{ index: 0n, line: none, driver: none }, { index: 1n, line: none, driver: none }],
    }));
    assert.deepEqual(results, [
        variant("invalid", [{ field: "", message: "Row readiness failed: a quantity of zero" }]),
        variant("incomplete", [{ field: "qty", message: "Checked" }]),
    ]);
});
