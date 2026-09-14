/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ArrayType, East, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, Paged, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateImpl, initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { useSheetEditing } from "./use-editing.js";
import type { SheetEditValue, SheetRootValue, SheetRowValue } from "./values.js";

afterEach(cleanup);
const Row = StructType({ id: StringType, qty: IntegerType, hidden: ArrayType(StringType) });
const rows = [{ id: "a", qty: 1n, hidden: ["keep"] }, { id: "b", qty: 2n, hidden: [] }];
const renderView = East.function([], UIComponentType, ($) => {
    const data = $.const(State.bind([ArrayType(Row)], "sheet-live-test", rows));
    return Sheet.Root(data, { qty: Sheet.column.integer(Row) }, { id: "id", onUpdate: data.write });
}).toIR().compile(StateImpl);
function view(): SheetRootValue {
    const result = renderView();
    if (result.type !== "Sheet") throw new Error("Expected Sheet");
    return result.value;
}
function useEditing(root: SheetRootValue, key = "main") {
    if (root.rows.type !== "inline") throw new Error("Expected inline rows");
    return useSheetEditing(root.editing, undefined, root.rows.value, 0, key);
}
function commit(row: SheetRowValue, qty: bigint): SheetEditValue {
    return variant("commit", { rowId: row.id, offset: row.id === "a" ? 0n : 1n, key: "qty", row: { ...row, cells: new Map([["qty", variant("Integer", qty)]]) }, source: variant("typed", null) });
}
function sourceRows(root: SheetRootValue): ValueTypeOf<typeof Sheet.Types.Rows> {
    if (root.rows.type !== "inline") throw new Error("Expected inline");
    return root.rows.value;
}

test("live onUpdate applies two edited rows once, reconciles, and supports applied undo", async () => {
    initializeStore(new UIStore());
    const initial = view();
    const hook = renderHook(({ root }) => useEditing(root), { initialProps: { root: initial } });
    act(() => hook.result.current.record(sourceRows(initial).map((row, i) => commit(row, BigInt(i + 8)))));
    expect(hook.result.current.session.pending).toBe(2);
    expect(hook.result.current.layer.edits.size).toBe(2);
    await act(async () => { await hook.result.current.session.apply(); });
    expect(hook.result.current.session.status).toBe("reconciling");
    const applied = view();
    expect(sourceRows(applied).map(row => row.cells.get("qty")!.value)).toEqual([8n, 9n]);
    hook.rerender({ root: applied });
    expect(hook.result.current.session.status).toBe("idle");
    expect(hook.result.current.layer.edits.size).toBe(0);
    act(() => hook.result.current.session.undo());
    expect(hook.result.current.session.pending).toBe(2);
    await act(async () => { await hook.result.current.session.apply(); });
    hook.rerender({ root: view() });
    expect(sourceRows(view()).map(row => row.cells.get("qty")!.value)).toEqual([1n, 2n]);
    expect(hook.result.current.session.pending).toBe(0);
});

test("remount retains pending draft history and source-bound request state", () => {
    initializeStore(new UIStore());
    const root = view();
    const hook = renderHook(() => useEditing(root));
    act(() => hook.result.current.record([commit(sourceRows(root)[0]!, 7n)]));
    const session = hook.result.current.session;
    hook.unmount();
    const remounted = renderHook(() => useEditing(view()));
    expect(remounted.result.current.session).toBe(session);
    expect(remounted.result.current.session.pending).toBe(1);
    act(() => remounted.result.current.session.undo());
    expect(remounted.result.current.session.pending).toBe(0);
});

test("another Sheet cannot apply while this source waits for reconciliation", async () => {
    initializeStore(new UIStore());
    const root = view();
    const first = renderHook(() => useEditing(root, "first"));
    const second = renderHook(() => useEditing(root, "second"));
    act(() => {
        first.result.current.record([commit(sourceRows(root)[0]!, 7n)]);
        second.result.current.record([commit(sourceRows(root)[1]!, 8n)]);
    });
    await act(async () => { await first.result.current.session.apply(); });
    expect(first.result.current.session.status).toBe("reconciling");
    expect(second.result.current.session.canApply).toBe(false);
    await act(async () => { await second.result.current.session.apply(); });
    expect(second.result.current.session.status).toBe("idle");
    expect(sourceRows(view()).map(row => row.cells.get("qty")!.value)).toEqual([7n, 2n]);
});


test("a child edit after applied reorder preserves the new first child's hidden fields", async () => {
    initializeStore(new UIStore());
    const Child = StructType({ qty: IntegerType, hidden: StringType });
    const Group = StructType({ id: StringType, name: StringType, rows: ArrayType(Child) });
    const renderGroup = East.function([], UIComponentType, ($) => {
        const data = $.const(State.bind([ArrayType(Group)], "sheet-child-echo", [{ id: "g", name: "Group", rows: [{ qty: 1n, hidden: "alpha" }, { qty: 1n, hidden: "beta" }] }]));
        return Sheet.Root(data, { qty: Sheet.column.integer(Child) }, { id: "id", group: Sheet.group(Group, "rows", { title: "name" }), onUpdate: data.write });
    }).toIR().compile(StateImpl);
    const groupView = () => {
        const result = renderGroup();
        if (result.type !== "Sheet") throw new Error("Expected Sheet");
        return result.value;
    };
    const initial = groupView();
    const hook = renderHook(({ root }) => useEditing(root), { initialProps: { root: initial } });
    const group = sourceRows(initial)[0]!;
    const reversed = { ...group, lines: [...group.lines].reverse() };
    act(() => hook.result.current.record([variant("lineCommit", { rowId: "g", offset: 0n, line: "1", key: "qty", row: reversed, source: variant("typed", null) })]));
    await act(async () => { await hook.result.current.session.apply(); });
    hook.rerender({ root: groupView() });
    expect(hook.result.current.session.status).toBe("idle");
    const displayed = hook.result.current.layer.edits.get("g")!;
    expect(displayed.lines.map(line => line.key)).toEqual(["1", "0"]);
    const edited = { ...displayed, lines: displayed.lines.map((line, index) => index === 0 ? { ...line, cells: new Map([["qty", variant("Integer", 9n)]]) } : line) };
    act(() => hook.result.current.record([variant("lineCommit", { rowId: "g", offset: 0n, line: "1", key: "qty", row: edited, source: variant("typed", null) })]));
    await act(async () => { await hook.result.current.session.apply(); });
    const next = groupView();
    hook.rerender({ root: next });
    const raw = next.editing.readEntry("g", 0n);
    expect(raw.type).toBe("some");
    if (raw.type !== "some") throw new Error("Expected source group");
    expect(decodeBeast2For(Group)(raw.value).rows).toEqual([{ qty: 9n, hidden: "beta" }, { qty: 1n, hidden: "alpha" }]);
});

test("paged deletion retires only after its exact committed revision and a loaded absence", async () => {
    initializeStore(new UIStore());
    let domain = [...rows];
    let revision = "r0";
    let loaded = true;
    const compile = East.function([], UIComponentType, ($) => {
        const source = $.const(Paged.of("delete-source", East.value(rows, ArrayType(Row))));
        return Sheet.Root(source, { qty: Sheet.column.integer(Row) }, { id: "id", onApply: East.function([Sheet.Types.ChangeSet(Row)], Sheet.Types.ApplyResult, () => variant("conflict", [])) });
    }).toIR().compile([]);
    const result = compile();
    if (result.type !== "Sheet" || result.value.rows.type !== "paged") throw new Error("Expected paged Sheet");
    const root = result.value;
    const apply = East.compile(Sheet.apply(Row, "id"), []);
    const decodeBatch = decodeBeast2For(Sheet.Types.ChangeSet(Row));
    const encode = encodeBeast2For(Row);
    const projected = sourceRows(view());
    const source = {
        ...result.value.rows.value,
        page: (offset: bigint, count: bigint) => loaded ? some(projected.filter(w => domain.some(r => r.id === w.id)).slice(Number(offset), Number(offset + count))) : none,
        revision: () => some(revision),
        refresh: () => { loaded = false; return null; },
        total: () => loaded ? some(BigInt(domain.length)) : none,
    };
    const editing = { ...root.editing, readEntry: (id: string, offset: bigint) => {
        const row = loaded ? domain[Number(offset)] : undefined;
        return row?.id === id ? some(encode(row)) : none;
    }, onApply: some(variant("sync", (payload: Uint8Array) => {
        const applied = apply(domain, decodeBatch(payload), some(revision));
        if (applied.type === "conflict") return variant("conflict", applied.value);
        domain = applied.value;
        return variant("applied", { revision: some("r1") });
    })) };
    const hook = renderHook(() => useSheetEditing(editing, { ...source }, projected, 0, "paged-delete"));
    act(() => hook.result.current.record([variant("remove", { rowIds: ["a"] })]));
    await act(async () => { await hook.result.current.session.apply(); });
    expect(domain.map(row => row.id)).toEqual(["b"]);
    revision = "unrelated"; loaded = true; hook.rerender();
    expect(hook.result.current.session.status).toBe("reconciling");
    revision = "r1"; loaded = false; hook.rerender();
    expect(hook.result.current.session.status).toBe("reconciling");
    loaded = true; hook.rerender();
    expect(hook.result.current.session.status).toBe("idle");
    expect(hook.result.current.layer.removed.size).toBe(0);
});

test("creation defaults survive a multi-event gesture, later clearing, and applied undo/redo", async () => {
    initializeStore(new UIStore());
    const Item = StructType({ id: StringType, qty: IntegerType, note: StringType, hidden: ArrayType(StringType) });
    const compile = East.function([], UIComponentType, ($) => {
        const data = $.const(State.bind([ArrayType(Item)], "seeded-flat", []));
        const count = $.const(State.bind([IntegerType], "seed-calls", 0n));
        const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(Item), ($, _context) => {
            $(count.write(count.read().add(1n)));
            return Sheet.patch(Item, { qty: 5n, note: "default note", hidden: [East.print(count.read())] });
        }));
        return Sheet.Root(data, { qty: Sheet.column.integer(Item), note: Sheet.column.text(Item) }, { id: "id", onUpdate: data.write, newRow });
    }).toIR().compile(StateImpl);
    const getView = () => { const result = compile(); if (result.type !== "Sheet") throw new Error("Expected Sheet"); return result.value; };
    const root = getView();
    const hook = renderHook(({ root }) => useEditing(root), { initialProps: { root } });
    const inserted: SheetRowValue = { id: "new", owned: false, cells: new Map([["qty", variant("Integer", 9n)], ["note", variant("Null", null)]]), lines: [], band: none };
    act(() => hook.result.current.record([
        variant("insert", { afterRowId: none, row: inserted, source: variant("row", null) }),
        variant("commit", { rowId: "new", offset: 0n, key: "qty", row: { ...inserted, cells: new Map(inserted.cells).set("qty", variant("Integer", 12n)) }, source: variant("row", null) }),
    ]));
    const wire = hook.result.current.layer.appended[0]!;
    expect(wire.cells.get("note")).toEqual(variant("String", "default note"));
    expect(wire.cells.get("qty")).toEqual(variant("Integer", 12n));
    expect(hook.result.current.session.canApply).toBe(true);
    act(() => hook.result.current.session.undo());
    expect(hook.result.current.layer.appended).toHaveLength(0);
    act(() => hook.result.current.session.redo());
    await act(async () => { await hook.result.current.session.apply(); });
    const applied = getView();
    hook.rerender({ root: applied });
    const raw = applied.editing.readEntry("new", 0n);
    if (raw.type !== "some") throw new Error("Expected applied row");
    expect(decodeBeast2For(Item)(raw.value)).toEqual({ id: "new", qty: 12n, note: "default note", hidden: ["1"] });
    act(() => hook.result.current.record([variant("commit", { rowId: "new", offset: 0n, key: "note", row: { ...wire, cells: new Map(wire.cells).set("note", variant("Null", null)) }, source: variant("typed", null) })]));
    expect(hook.result.current.session.canApply).toBe(false);
    expect(hook.result.current.layer.edits.get("new")!.cells.get("note")).toEqual(variant("Null", null));
});

test("group and child constructors keep hidden fields and receive the actual child destination", async () => {
    initializeStore(new UIStore());
    const Child = StructType({ qty: IntegerType, hidden: StringType });
    const Group = StructType({ id: StringType, name: StringType, owner: StringType, rows: ArrayType(Child) });
    const compile = East.function([], UIComponentType, ($) => {
        const data = $.const(State.bind([ArrayType(Group)], "seeded-groups", []));
        return Sheet.Root(data, { qty: Sheet.column.integer(Child) }, {
            id: "id", onUpdate: data.write, group: Sheet.group(Group, "rows", { title: "name" }),
            newGroup: East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(Group), () => Sheet.patch(Group, {
                name: "New group", owner: "planner", rows: [{ qty: 3n, hidden: "supplied child" }],
            })),
            newRow: East.function([Sheet.Types.NewRow], Sheet.Types.Patch(Child), (_$, ctx) => Sheet.patch(Child, {
                qty: 5n, hidden: ctx.destination.match({ child: (_$, at) => East.str`${at.group}:${at.index}`, entry: () => "entry" }),
            })),
        });
    }).toIR().compile(StateImpl);
    const result = compile();
    if (result.type !== "Sheet") throw new Error("Expected Sheet");
    const hook = renderHook(() => useEditing(result.value));
    const row: SheetRowValue = { id: "g", owned: false, cells: new Map([["$title", variant("Null", null)]]), lines: [{ key: "new-child", cells: new Map([["qty", variant("Integer", 8n)]]) }], band: some({ sub: "", folded: false }) };
    act(() => hook.result.current.record([
        variant("insert", { afterRowId: none, row, source: variant("typed", null) }),
        variant("commit", { rowId: "g", offset: 0n, key: "$title", row: { ...row, cells: new Map([["$title", variant("String", "Named group")]]) }, source: variant("typed", null) }),
    ]));
    expect(hook.result.current.session.canApply).toBe(true);
    expect(hook.result.current.layer.appended[0]!.cells.get("$title")).toEqual(variant("String", "Named group"));
    expect(hook.result.current.layer.appended[0]!.lines).toHaveLength(2);
    await act(async () => { await hook.result.current.session.apply(); });
    const applied = compile();
    if (applied.type !== "Sheet") throw new Error("Expected Sheet");
    const raw = applied.value.editing.readEntry("g", 0n);
    if (raw.type !== "some") throw new Error("Expected group");
    expect(decodeBeast2For(Group)(raw.value)).toEqual({ id: "g", name: "Named group", owner: "planner", rows: [{ qty: 3n, hidden: "supplied child" }, { qty: 8n, hidden: "g:1" }] });
});
