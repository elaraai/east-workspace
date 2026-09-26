/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import { useMemo } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ArrayType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, fromEastTypeValue, none, some, variant } from "@elaraai/east";
import { Sheet, State, UIComponentType } from "@elaraai/east-ui/internal";
import { initializeStore, StateImpl } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { useSheetEditing } from "./use-editing.js";
import { draftPresentation } from "./draft-state.js";
import type { SheetRootValue, SheetRowValue } from "./values.js";

beforeEach(() => initializeStore(new UIStore()));
afterEach(cleanup);
const Row = StructType({ id: StringType, qty: IntegerType, note: OptionType(FloatType), hidden: StringType });
const Ready = Sheet.Types.Readiness;
const Draft = Sheet.Types.Draft(Row);
const Context = Sheet.Types.DraftContext(Row);
const permissive = East.function([Draft, Context], Ready, () => variant("ready", null));
const positive = East.function([Draft, Context], Ready, (_$, row) => row.qty.hasTag("value").and(() => row.qty.unwrap("value").greater(0n)).ifElse(
    () => East.value(variant("ready", null), Ready), () => East.value(variant("incomplete", [{ field: "qty", message: "Enter a positive quantity" }]), Ready),
));
const render = (check = positive) => East.function([], UIComponentType, ($) => {
    const data = $.const(State.bind([ArrayType(Row)], "readiness-rows", [{ id: "a", qty: 1n, note: none, hidden: "retained" }]));
    return Sheet.Root(data, { qty: Sheet.column.integer(Row), note: Sheet.column.quantity(Row) }, { id: "id", onUpdate: data.write, ready: { row: check } });
}).toIR().compile(StateImpl);
function unwrap(value: ReturnType<ReturnType<typeof render>>): SheetRootValue {
    if (value.type !== "Sheet") throw new Error("Expected Sheet");
    return value.value;
}
function rows(root: SheetRootValue): SheetRowValue[] {
    if (root.rows.type !== "inline") throw new Error("Expected inline");
    return root.rows.value;
}
/** Each inline row's position — its index (a paged source's may skip a failed window, #853). */
function useIndexes(resident: readonly SheetRowValue[]): number[] {
    return useMemo(() => resident.map((_r, i) => i), [resident]);
}
function mount(root: SheetRootValue) {
    return renderHook(({ value }) => useSheetEditing(value.editing, undefined, rows(value), useIndexes(rows(value)), "readiness"), { initialProps: { value: root } });
}
function edit(row: SheetRowValue, qty: bigint) {
    return variant("commit", { rowId: row.id, offset: 0n, key: "qty", row: { ...row, cells: new Map(row.cells).set("qty", variant("Integer", qty)) }, source: variant("typed", null) });
}

test("author ready cannot bypass missing required hidden fields", () => {
    const root = unwrap(render(permissive)());
    const hook = mount(root);
    const row: SheetRowValue = { id: "new", owned: false, cells: new Map([["qty", variant("Integer", 2n)]]), lines: [], band: none, subRows: [] };
    // An inserted row, recorded the way the renderer records one: a typed
    // insert event under the gesture's `insert` origin.
    act(() => hook.result.current.record([variant("insert", { afterRowId: some("a"), row, source: variant("typed", null) })], undefined, "insert"));
    expect(hook.result.current.session.canApply).toBe(false);
    expect(hook.result.current.session.readiness).toMatchObject({ type: "incomplete", value: expect.arrayContaining([{ entry: "new", row: none, field: some("hidden"), message: "A value is required" }]) });
});

test("author ready cannot bypass invalid optional input", () => {
    const root = unwrap(render(permissive)());
    const hook = mount(root);
    const row = rows(root)[0]!;
    act(() => hook.result.current.record([variant("commit", { rowId: "a", offset: 0n, key: "note", row: { ...row, cells: new Map(row.cells).set("note", variant("Invalid", "not a number")) }, source: variant("typed", null) })]));
    expect(hook.result.current.session.canApply).toBe(false);
    expect(hook.result.current.session.readiness).toMatchObject({ type: "invalid", value: expect.arrayContaining([{ entry: "a", row: none, field: some("note"), message: "Invalid input: not a number" }]) });
});

test("business readiness blocks Apply, clears on correction and rechecks undo/redo", async () => {
    const view = render();
    const root = unwrap(view());
    const hook = mount(root);
    const row = rows(root)[0]!;
    act(() => hook.result.current.record([edit(row, 0n)]));
    expect(hook.result.current.session.readiness).toEqual(variant("incomplete", [{ entry: "a", row: none, field: some("qty"), message: "Enter a positive quantity" }]));
    await act(async () => hook.result.current.session.apply());
    expect(rows(unwrap(view()))[0]!.cells.get("qty")).toEqual(variant("Integer", 1n));
    act(() => hook.result.current.record([edit(row, 3n)]));
    expect(hook.result.current.session.canApply).toBe(true);
    act(() => hook.result.current.session.undo());
    expect(hook.result.current.session.canApply).toBe(false);
    act(() => hook.result.current.session.redo());
    expect(hook.result.current.session.canApply).toBe(true);
    await act(async () => hook.result.current.session.apply());
    const applied = unwrap(view());
    hook.rerender({ value: applied });
    expect(rows(applied)[0]!.cells.get("qty")).toEqual(variant("Integer", 3n));
    expect(hook.result.current.session.pending).toBe(0);
});

test("row and group readiness receive current reordered drafts with separately addressed issues", () => {
    const Child = StructType({ qty: IntegerType, hidden: StringType });
    const Group = StructType({ id: StringType, name: StringType, rows: ArrayType(Child) });
    const rowCheck = East.function([Sheet.Types.Draft(Child), Sheet.Types.DraftContext(Group, "rows")], Ready, (_$, row, ctx) =>
        row.hidden.hasTag("value").and(() => row.hidden.unwrap("value").equal("second")).and(() => ctx.rowIndex.equal(0n)).ifElse(
            () => East.value(variant("incomplete", [{ field: "qty", message: East.str`${ctx.group.unwrap("some").name.unwrap("value")} / ${ctx.rows.size()} / ${ctx.groups.size()}` }]), Ready),
            () => East.value(variant("ready", null), Ready),
        ));
    const groupCheck = East.function([Sheet.Types.DraftGroup(Group, "rows")], Ready, (_$, group) => group.name.hasTag("value").and(() => group.name.unwrap("value").equal("Approved")).ifElse(
        () => East.value(variant("ready", null), Ready), () => East.value(variant("incomplete", [{ field: "name", message: "Approve this group" }]), Ready),
    ));
    const view = East.function([], UIComponentType, ($) => {
        const data = $.const(State.bind([ArrayType(Group)], "readiness-groups", [{ id: "g", name: "Review", rows: [{ qty: 1n, hidden: "first" }, { qty: 1n, hidden: "second" }] }]));
        return Sheet.Root(data, { qty: Sheet.column.integer(Child) }, { id: "id", group: Sheet.group(Group, "rows", { title: "name" }), ready: { row: rowCheck, group: groupCheck }, onUpdate: data.write });
    }).toIR().compile(StateImpl);
    const value = view(); if (value.type !== "Sheet") throw new Error("Expected Sheet");
    const hook = mount(value.value);
    const group = rows(value.value)[0]!;
    act(() => hook.result.current.record([variant("lineCommit", { rowId: "g", offset: 0n, line: "1", key: "qty", row: { ...group, lines: [...group.lines].reverse() }, source: variant("typed", null) })]));
    expect(hook.result.current.session.readiness).toEqual(variant("incomplete", [
        { entry: "g", row: none, field: some("name"), message: "Approve this group" },
        { entry: "g", row: some(0n), field: some("qty"), message: "Review / 2 / 1" },
    ]));
    const reordered = hook.result.current.layer.edits.get("g")!;
    act(() => hook.result.current.record([variant("commit", { rowId: "g", offset: 0n, key: "$title", row: { ...reordered, cells: new Map([["$title", variant("String", "Approved")]]) }, source: variant("typed", null) })]));
    expect(hook.result.current.session.readiness).toEqual(variant("incomplete", [{ entry: "g", row: some(0n), field: some("qty"), message: "Approved / 2 / 1" }]));
});

test("external state read by readiness is tracked without a new Sheet value", async () => {
    const view = East.function([], UIComponentType, ($) => {
        const limit = $.const(State.bind([IntegerType], "readiness-limit", 10n));
        const data = $.const(State.bind([ArrayType(Row)], "readiness-reactive", [{ id: "a", qty: 1n, note: none, hidden: "retained" }]));
        const check = $.const(East.function([Draft, Context], Ready, (_$, row) => row.qty.hasTag("value").and(() => row.qty.unwrap("value").lessEqual(limit.read())).ifElse(
            () => East.value(variant("ready", null), Ready), () => variant("incomplete", [{ field: "qty", message: "Above current limit" }]),
        )));
        return Sheet.Root(data, { qty: Sheet.column.integer(Row) }, { id: "id", onUpdate: data.write, ready: { row: check } });
    }).toIR().compile(StateImpl);
    const value = view(); if (value.type !== "Sheet") throw new Error("Expected Sheet");
    const hook = renderHook(() => {
        const editing = useSheetEditing(value.value.editing, undefined, rows(value.value), useIndexes(rows(value.value)), "readiness");
        return { ...editing, renderedCanApply: editing.session.canApply };
    });
    act(() => hook.result.current.record([edit(rows(value.value)[0]!, 5n)]));
    expect(hook.result.current.renderedCanApply).toBe(true);
    const setLimit = East.function([], NullType, ($) => { const limit = $.const(State.bind([IntegerType], "readiness-limit", 10n)); $(limit.write(2n)); }).toIR().compile(StateImpl);
    await act(async () => { setLimit(); });
    expect(hook.result.current.session.canApply).toBe(false);
    expect(hook.result.current.session.readiness.type).toBe("incomplete");
    expect(hook.result.current.renderedCanApply).toBe(false);
});

test("a check that throws on one row marks that row invalid, and the other rows still report (#882)", () => {
    const zeroFails = East.function([Draft, Context], Ready, ($, row) => {
        $.if(row.qty.hasTag("value").and(() => row.qty.unwrap("value").equal(0n)), ($) => { $.error("a quantity of zero"); });
        return East.value(variant("incomplete", [{ field: "qty", message: "Needs review" }]), Ready);
    });
    const view = East.function([], UIComponentType, ($) => {
        const data = $.const(State.bind([ArrayType(Row)], "readiness-throws", [{ id: "a", qty: 1n, note: none, hidden: "a" }, { id: "b", qty: 1n, note: none, hidden: "b" }]));
        return Sheet.Root(data, { qty: Sheet.column.integer(Row) }, { id: "id", onUpdate: data.write, ready: { row: zeroFails } });
    }).toIR().compile(StateImpl);
    const root = unwrap(view());
    const hook = mount(root);
    const [a, b] = rows(root);
    act(() => hook.result.current.record([edit(a!, 0n), edit(b!, 3n)]));
    expect(hook.result.current.session.canApply).toBe(false);
    expect(hook.result.current.session.readiness).toEqual(variant("invalid", [
        { entry: "a", row: none, field: some(""), message: "Row readiness failed: a quantity of zero" },
        { entry: "b", row: none, field: some("qty"), message: "Needs review" },
    ]));
    // Each row is marked for its OWN refusal, never the batch's (#880): the
    // row whose check threw is invalid, the other only incomplete.
    const { session } = hook.result.current;
    const draftType = fromEastTypeValue(root.editing.draftType);
    expect(draftPresentation(session, draftType, undefined, "a", undefined, session.readiness)).toMatchObject({ invalid: true, incomplete: false });
    expect(draftPresentation(session, draftType, undefined, "b", undefined, session.readiness)).toMatchObject({ invalid: false, incomplete: true });
});

test("non-ready empty issue lists and failing callbacks never enable Apply", () => {
    for (const check of [
        East.function([Draft, Context], Ready, () => variant("invalid", [])),
        East.function([Draft, Context], Ready, ($) => { $.error("readiness unavailable"); return variant("ready", null); }),
    ]) {
        const root = unwrap(render(check)());
        const hook = mount(root);
        act(() => hook.result.current.record([edit(rows(root)[0]!, 5n)]));
        expect(hook.result.current.session.canApply).toBe(false);
        expect(hook.result.current.session.readiness.type).toBe("invalid");
        hook.unmount(); initializeStore(new UIStore());
    }
});
