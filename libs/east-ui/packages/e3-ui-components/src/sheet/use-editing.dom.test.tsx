/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test } from "vitest";
import { useMemo } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ArrayType, East, IntegerType, NullType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { Paged, State, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { StateImpl, UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { applyLayer } from "./local-rows.js";
import { useSheetEditing, type SheetRowsRead } from "./use-editing.js";
import type { SheetCellValue, SheetEditValue, SheetRootValue, SheetRowValue } from "./values.js";

afterEach(cleanup);
const stringEqual = equalFor(StringType);
// No column sets a row's `hidden` (#1536): the sheets over it edit their rows, and add none.
const Row = StructType({ id: StringType, qty: IntegerType, hidden: ArrayType(StringType) });
const Rows = ArrayType(Row);
const rows = [{ id: "a", qty: 1n, hidden: ["keep"] }, { id: "b", qty: 2n, hidden: [] }];

// A pinned source over the rows, built by hand to the row-source contract —
// paged data is bound (`Data.bindPaged`), so no package produces one. It serves
// one snapshot that never moves; the deletion test answers its own reads.
const ROWS_PAGE = East.function([IntegerType, IntegerType], OptionType(Rows), ($, offset, limit) => {
    const all = $.const(rows, Rows);
    const n = $.let(all.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.slice(start, end));
});
const ROWS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(rows, Rows);
    return some(all.size());
});
const ROWS_REVISION = East.function([], OptionType(StringType), () => some("r0"));
const ROWS_REFRESH = East.function([OptionType(StringType)], NullType, () => null);
const PINNED_ROWS = { id: "delete-source", page: ROWS_PAGE, total: ROWS_TOTAL, seek: none, revision: ROWS_REVISION, refresh: ROWS_REFRESH };
const renderView = East.function([], Sheet.Types.Root, ($) => {
    const data = $.const(State.bind([ArrayType(Row)], "sheet-live-test", rows));
    return Sheet.Root(data, { qty: Sheet.column.integer(Row) }, { id: "id", onUpdate: data.write, edits: { insertRows: false } });
}).toIR().compile(StateImpl);
function view(): SheetRootValue {
    return renderView();
}
/** Each row's position — its index (a paged source's may skip a failed window, #853). */
function useIndexes(resident: readonly SheetRowValue[]): number[] {
    return useMemo(() => resident.map((_r, i) => i), [resident]);
}
function useEditing(root: SheetRootValue, key = "main") {
    if (root.rows.type !== "inline") throw new Error("Expected inline rows");
    return useSheetEditing(root.editing, undefined, root.rows.value, useIndexes(root.rows.value), key);
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
    const renderGroup = East.function([], Sheet.Types.Root, ($) => {
        const data = $.const(State.bind([ArrayType(Group)], "sheet-child-echo", [{ id: "g", name: "Group", rows: [{ qty: 1n, hidden: "alpha" }, { qty: 1n, hidden: "beta" }] }]));
        // No column sets a line's `hidden`: the sheet adds no lines.
        return Sheet.Root(data, { qty: Sheet.column.integer(Child) }, { id: "id", group: Sheet.group(Group, "rows", { title: "name" }), onUpdate: data.write, edits: { insertRows: false } });
    }).toIR().compile(StateImpl);
    const groupView = () => renderGroup();
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

test("paged deletion retires only once read past the revision it was drafted at, with a loaded absence", async () => {
    initializeStore(new UIStore());
    let domain = [...rows];
    let revision = "r0";
    let loaded = true;
    const compile = East.function([], Sheet.Types.Root, ($) => {
        const source = $.const(PINNED_ROWS, Paged.Types.PinnedSource(Rows));
        return Sheet.Root(source, { qty: Sheet.column.integer(Row) }, { id: "id", onApply: East.function([Sheet.Types.ChangeSet(Row)], Sheet.Types.ApplyResult, () => variant("conflict", [])), edits: { insertRows: false } });
    }).toIR().compile([]);
    const root = compile();
    if (root.rows.type !== "pinned") throw new Error("Expected a pinned Sheet");
    const apply = East.compile(Sheet.apply(Row, "id"), []);
    const decodeBatch = decodeBeast2For(Sheet.Types.ChangeSet(Row));
    const encode = encodeBeast2For(Row);
    const projected = sourceRows(view());
    const source = {
        ...root.rows.value,
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
    const hook = renderHook(() => useSheetEditing(editing, { ...source }, projected, useIndexes(projected), "paged-delete"));
    act(() => hook.result.current.record([variant("remove", { rowIds: ["a"] })]));
    await act(async () => { await hook.result.current.session.apply(); });
    expect(domain.map(row => row.id)).toEqual(["b"]);
    // The revision drafted at holds nothing of the commit, whatever its page reads.
    revision = "r0"; loaded = true; hook.rerender();
    expect(hook.result.current.session.status).toBe("reconciling");
    revision = "r1"; loaded = false; hook.rerender();
    expect(hook.result.current.session.status).toBe("reconciling");
    loaded = true; hook.rerender();
    expect(hook.result.current.session.status).toBe("idle");
    expect(hook.result.current.layer.removed.size).toBe(0);
});

test("a row the sheet no longer draws is removed from the version held of it while it was (#1579), and Apply deletes it", async () => {
    initializeStore(new UIStore());
    let domain = [...rows];
    const compile = East.function([], Sheet.Types.Root, ($) => {
        const source = $.const(PINNED_ROWS, Paged.Types.PinnedSource(Rows));
        return Sheet.Root(source, { qty: Sheet.column.integer(Row) }, { id: "id", onApply: East.function([Sheet.Types.ChangeSet(Row)], Sheet.Types.ApplyResult, () => variant("conflict", [])), edits: { insertRows: false } });
    }).toIR().compile([]);
    const root = compile();
    if (root.rows.type !== "pinned") throw new Error("Expected a pinned Sheet");
    const apply = East.compile(Sheet.apply(Row, "id"), []);
    const decodeBatch = decodeBeast2For(Sheet.Types.ChangeSet(Row));
    const encode = encodeBeast2For(Row);
    const projected = sourceRows(view());
    const source = {
        ...root.rows.value,
        page: (offset: bigint, count: bigint) => some(projected.filter(w => domain.some(r => r.id === w.id)).slice(Number(offset), Number(offset + count))),
        revision: () => some("r0"),
        refresh: () => null,
        total: () => some(BigInt(domain.length)),
    };
    const editing = { ...root.editing, readEntry: (id: string, offset: bigint) => {
        const row = domain[Number(offset)];
        return row?.id === id ? some(encode(row)) : none;
    }, onApply: some(variant("sync", (payload: Uint8Array) => {
        const applied = apply(domain, decodeBatch(payload), some("r0"));
        if (applied.type === "conflict") return variant("conflict", applied.value);
        domain = applied.value;
        return variant("applied", { revision: some("r1") });
    })) };
    let drawn: readonly SheetRowValue[] = projected;
    const hook = renderHook(() => useSheetEditing(editing, { ...source }, drawn, useIndexes(drawn), "paged-held"));
    // b held while drawn, then scrolled out of the rows read: the sheet holds nothing of it now.
    const held = new Map([["b", hook.result.current.original("b")]]);
    drawn = projected.slice(0, 1);
    hook.rerender();
    expect(hook.result.current.original("b").wire).toBeUndefined();
    act(() => { hook.result.current.record([variant("remove", { rowIds: ["b"] })], undefined, undefined, undefined, undefined, undefined, undefined, held); });
    expect([...hook.result.current.layer.removed]).toEqual(["b"]);
    await act(async () => { await hook.result.current.session.apply(); });
    expect(domain.map(row => row.id)).toEqual(["a"]);
});

test("a paged Save's rows are drawn as it left them over the rows read before it — its pages standing in, or read still at the revision it was drafted at — and a new edit over them; read again, they are the source's", async () => {
    initializeStore(new UIStore());
    let domain = [...rows];
    let revision = "r0";
    const compile = East.function([], Sheet.Types.Root, ($) => {
        const source = $.const(PINNED_ROWS, Paged.Types.PinnedSource(Rows));
        return Sheet.Root(source, { qty: Sheet.column.integer(Row) }, { id: "id", onApply: East.function([Sheet.Types.ChangeSet(Row)], Sheet.Types.ApplyResult, () => variant("conflict", [])), edits: { insertRows: false } });
    }).toIR().compile([]);
    const root = compile();
    if (root.rows.type !== "pinned") throw new Error("Expected a pinned Sheet");
    const apply = East.compile(Sheet.apply(Row, "id"), []);
    const decodeBatch = decodeBeast2For(Sheet.Types.ChangeSet(Row));
    const encode = encodeBeast2For(Row);
    const decodeWire = decodeBeast2For(Sheet.Types.Row);
    // The source's rows as the sheet projects them, at the revision it serves.
    const projected = () => domain.map((row) => decodeWire(root.editing.project(encode(row), row.id)) as SheetRowValue);
    const source = {
        ...root.rows.value,
        page: (offset: bigint, count: bigint) => some(projected().slice(Number(offset), Number(offset + count))),
        revision: () => some(revision),
        refresh: () => null,
        total: () => some(BigInt(domain.length)),
    };
    const editing = { ...root.editing, readEntry: (id: string, offset: bigint) => {
        const row = domain[Number(offset)];
        return row?.id === id ? some(encode(row)) : none;
    }, onApply: some(variant("sync", (payload: Uint8Array) => {
        const applied = apply(domain, decodeBatch(payload), some(revision));
        if (applied.type === "conflict") return variant("conflict", applied.value);
        domain = applied.value;
        return variant("applied", { revision: some("r1") });
    })) };
    // What the sheet draws, and how it was read: the rows read at r0.
    const before = projected();
    let drawn: { rows: readonly SheetRowValue[]; read: SheetRowsRead } = { rows: before, read: { revision: "r0", before: () => false } };
    const hook = renderHook(() => useSheetEditing(editing, { ...source }, drawn.rows, useIndexes(drawn.rows), "paged-landed", undefined, undefined, false, false, undefined, undefined, drawn.read));
    const qty = () => hook.result.current.layer.edits.get("a")?.cells.get("qty");
    act(() => hook.result.current.record([commit(before[0]!, 7n), variant("remove", { rowIds: ["b"] })]));
    expect(hook.result.current.savedFrom.size).toBe(0);
    await act(async () => { await hook.result.current.session.apply(); });
    expect(domain.map((row) => [row.id, row.qty])).toEqual([["a", 7n]]);
    // Committed, and read back at no revision yet: the drafts are the Save's, drafted at r0 — a count read there holds
    // nothing of them, one read since holds them (#1536).
    expect(hook.result.current.session.status).toBe("reconciling");
    expect([...hook.result.current.savedFrom].sort()).toEqual([["a", "r0"], ["b", "r0"]]);
    // The source moves to the revision the Save committed, and its rows read back there by position, while the pages
    // read again there stand in with the rows read at r0.
    revision = "r1";
    drawn = { rows: before, read: { revision: "r1", before: () => true } };
    hook.rerender();
    expect(hook.result.current.session.status).toBe("idle");
    expect([...hook.result.current.session.landed.keys()].sort()).toEqual(["a", "b"]);
    expect(qty()).toEqual(variant("Integer", 7n));
    expect([...hook.result.current.layer.removed]).toEqual(["b"]);
    expect([...hook.result.current.savedFrom].sort()).toEqual([["a", "r0"], ["b", "r0"]]);
    // Rows read still at the revision the Save was drafted at hold nothing of it either.
    drawn = { rows: before, read: { revision: "r0", before: () => false } };
    hook.rerender();
    expect(qty()).toEqual(variant("Integer", 7n));
    // A new edit over them draws its draft, which no count holds; undone, the Save's value again.
    act(() => hook.result.current.record([commit(before[0]!, 8n)]));
    expect(qty()).toEqual(variant("Integer", 8n));
    expect([...hook.result.current.savedFrom]).toEqual([["b", "r0"]]);
    act(() => hook.result.current.session.undo());
    expect(qty()).toEqual(variant("Integer", 7n));
    // Read again at r1: the rows are the source's, and nothing of the Save is held.
    drawn = { rows: projected(), read: { revision: "r1", before: () => false } };
    hook.rerender();
    expect(hook.result.current.session.landed.size).toBe(0);
    expect(hook.result.current.layer.edits.size).toBe(0);
    expect(hook.result.current.layer.removed.size).toBe(0);
    expect(hook.result.current.savedFrom.size).toBe(0);
});

test.each([["exactly", false], ["beside another write", true]] as const)("a Save's new row and the row it changed, read back %s, are edited from what the Save left — the new row drawn where it was placed, its edit one more change of it and never a second add — and drawn once over another query's rows that read it already (#1583)", async (_how, beside) => {
    initializeStore(new UIStore());
    const Item = StructType({ id: StringType, qty: IntegerType, note: StringType });
    const Items = ArrayType(Item);
    let domain: ValueTypeOf<typeof Items> = [{ id: "a", qty: 1n, note: "first" }, { id: "b", qty: 2n, note: "second" }];
    let revision = "r0";
    let saves = 0;
    const compile = East.function([], Sheet.Types.Root, ($) => {
        const source = $.const({
            id: "items-source",
            page: East.function([IntegerType, IntegerType], OptionType(Items), () => none),
            total: East.function([], OptionType(IntegerType), () => none),
            seek: none,
            revision: East.function([], OptionType(StringType), () => none),
            refresh: East.function([OptionType(StringType)], NullType, () => null),
        }, Paged.Types.PinnedSource(Items));
        return Sheet.Root(source, { qty: Sheet.column.integer(Item), note: Sheet.column.text(Item) }, { id: "id", onApply: East.function([Sheet.Types.ChangeSet(Item)], Sheet.Types.ApplyResult, () => variant("conflict", [])) });
    }).toIR().compile([]);
    const root = compile();
    if (root.rows.type !== "pinned") throw new Error("Expected a pinned Sheet");
    const apply = East.compile(Sheet.apply(Item, "id"), []);
    const decodeBatch = decodeBeast2For(Sheet.Types.ChangeSet(Item));
    const encode = encodeBeast2For(Item);
    const decodeWire = decodeBeast2For(Sheet.Types.Row);
    // The source's rows as the sheet projects them, at the revision it serves.
    const projected = () => domain.map((row) => decodeWire(root.editing.project(encode(row), row.id)) as SheetRowValue);
    const source = {
        ...root.rows.value,
        page: (offset: bigint, count: bigint) => some(projected().slice(Number(offset), Number(offset + count))),
        revision: () => some(revision),
        refresh: () => null,
        total: () => some(BigInt(domain.length)),
    };
    const editing = { ...root.editing, readEntry: (id: string, offset: bigint) => {
        const row = domain[Number(offset)];
        return row !== undefined && stringEqual(row.id, id) ? some(encode(row)) : none;
    }, onApply: some(variant("sync", (payload: Uint8Array) => {
        const applied = apply(domain, decodeBatch(payload), some(revision));
        if (applied.type === "conflict") return variant("conflict", applied.value);
        domain = applied.value;
        saves += 1;
        return variant("applied", { revision: some(`saved-${saves}`) });
    })) };
    // A Record's reader of its record by key: what a Save's new row is read back by, wherever the rows drawn are.
    const slice: ValueTypeOf<RecordSliceBindType> = {
        key: "items", sourceId: "items-source",
        config: { fields: [], indexes: [], range: none, search: [], presets: [] },
        read: () => ({ where: new Map(), preset: none, resolution: none }),
        write: () => null, choose: () => null, range: () => null, prefix: () => null, clear: () => null, clearAll: () => null,
        count: () => none, countWhere: () => none, total: () => none, domain: () => none, values: () => [], suggest: () => none,
        replaces: () => [], togglePreset: () => null, setResolution: () => null, retry: () => null,
        readEntry: (id) => {
            const row = domain.find((held) => stringEqual(held.id, id));
            return some(row === undefined ? none : some(encode(row)));
        },
        contains: () => none, containsRow: () => none,
    };
    // What the sheet draws, and how it was read: the rows read at r0.
    const before = projected();
    let drawn: { rows: readonly SheetRowValue[]; positions: readonly number[]; read: SheetRowsRead; replacing: boolean } =
        { rows: before, positions: [0, 1], read: { revision: "r0", before: () => false }, replacing: false };
    const hook = renderHook(() => useSheetEditing(editing, { ...source }, drawn.rows, drawn.positions, "landed-edited", undefined, slice, drawn.replacing, false, undefined, undefined, drawn.read));
    const ids = () => applyLayer(drawn.rows, hook.result.current.layer).map((row) => row.id);
    const cellsOf = (id: string, key: string) => applyLayer(drawn.rows, hook.result.current.layer).filter((row) => stringEqual(row.id, id)).map((row) => row.cells.get(key));
    act(() => hook.result.current.record([
        variant("commit", { rowId: "a", offset: 0n, key: "qty", row: { ...before[0]!, cells: new Map(before[0]!.cells).set("qty", variant("Integer", 7n)) }, source: variant("typed", null) }),
        variant("insert", { afterRowId: some("b"), row: { id: "c", owned: false, cells: new Map<string, SheetCellValue>([["qty", variant("Integer", 3n)], ["note", variant("String", "third")]]), lines: [], band: none, subRows: [] }, source: variant("typed", null) }),
    ]));
    await act(async () => { await hook.result.current.session.apply(); });
    expect(domain).toEqual([{ id: "a", qty: 7n, note: "first" }, { id: "b", qty: 2n, note: "second" }, { id: "c", qty: 3n, note: "third" }]);
    // Another write lands beside the Save before its confirmation reads it back: a's note, at a revision of its own.
    if (beside) domain = domain.map((row) => (stringEqual(row.id, "a") ? { ...row, note: "elsewhere" } : row));
    revision = beside ? "written" : "saved-1";
    // The rows read at r0 stand in while the pages are read again there.
    drawn = { ...drawn, read: { revision, before: () => true } };
    hook.rerender();
    expect(hook.result.current.session.status).toBe("idle");
    expect([...hook.result.current.session.landed.keys()].sort()).toEqual(["a", "c"]);
    // Read back otherwise, the session holds no version of either: what the Save left is drawn from what it landed.
    expect(hook.result.current.session.entries.size).toBe(beside ? 0 : 2);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(cellsOf("a", "note")).toEqual([variant("String", beside ? "elsewhere" : "first")]);
    // Over another query's rows, read since the Save: they hold the new row already, and it is drawn once.
    drawn = { rows: projected(), positions: [0, 1, 2], read: { revision, before: () => true }, replacing: true };
    hook.rerender();
    expect(ids()).toEqual(["a", "b", "c"]);
    drawn = { rows: before, positions: [0, 1], read: { revision, before: () => true }, replacing: false };
    hook.rerender();
    // The new row edited: from what the Save left, one more change of it — drawn where it stands, never a second add.
    const added = hook.result.current.layer.appended[0]!;
    act(() => hook.result.current.record([variant("commit", { rowId: "c", offset: 2n, key: "qty", row: { ...added, cells: new Map(added.cells).set("qty", variant("Integer", 9n)) }, source: variant("typed", null) })]));
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(cellsOf("c", "qty")).toEqual([variant("Integer", 9n)]);
    expect(hook.result.current.session.drafts.entries.get("c")?.before.type).toBe("some");
    // So is the row it changed: from what the Save left of it, never the rows' value from before it.
    const changed = hook.result.current.layer.edits.get("a")!;
    act(() => hook.result.current.record([variant("commit", { rowId: "a", offset: 0n, key: "note", row: { ...changed, cells: new Map(changed.cells).set("note", variant("String", "mine")) }, source: variant("typed", null) })]));
    expect(cellsOf("a", "qty")).toEqual([variant("Integer", 7n)]);
    // Drafted again, over another query's rows that read it already, the new row is drawn once still.
    drawn = { rows: projected(), positions: [0, 1, 2], read: { revision, before: () => true }, replacing: true };
    hook.rerender();
    expect(ids()).toEqual(["a", "b", "c"]);
    drawn = { rows: before, positions: [0, 1], read: { revision, before: () => true }, replacing: false };
    hook.rerender();
    // Saved: a change of each, as the record holds them.
    await act(async () => { await hook.result.current.session.apply(); });
    expect(hook.result.current.session.status).toBe("reconciling");
    expect(domain).toEqual([{ id: "a", qty: 7n, note: "mine" }, { id: "b", qty: 2n, note: "second" }, { id: "c", qty: 9n, note: "third" }]);
});

test("a row the rows hold twice — a window read again beside one still standing from before it — is drawn as a Save left it in both, until neither copy was read before it (#1583)", async () => {
    initializeStore(new UIStore());
    let domain = [...rows];
    let revision = "r0";
    const compile = East.function([], Sheet.Types.Root, ($) => {
        const source = $.const(PINNED_ROWS, Paged.Types.PinnedSource(Rows));
        return Sheet.Root(source, { qty: Sheet.column.integer(Row) }, { id: "id", onApply: East.function([Sheet.Types.ChangeSet(Row)], Sheet.Types.ApplyResult, () => variant("conflict", [])), edits: { insertRows: false } });
    }).toIR().compile([]);
    const root = compile();
    if (root.rows.type !== "pinned") throw new Error("Expected a pinned Sheet");
    const apply = East.compile(Sheet.apply(Row, "id"), []);
    const decodeBatch = decodeBeast2For(Sheet.Types.ChangeSet(Row));
    const encode = encodeBeast2For(Row);
    const decodeWire = decodeBeast2For(Sheet.Types.Row);
    // The source's rows as the sheet projects them, at the revision it serves.
    const projected = () => domain.map((row) => decodeWire(root.editing.project(encode(row), row.id)) as SheetRowValue);
    const source = {
        ...root.rows.value,
        page: (offset: bigint, count: bigint) => some(projected().slice(Number(offset), Number(offset + count))),
        revision: () => some(revision),
        refresh: () => null,
        total: () => some(BigInt(domain.length)),
    };
    const editing = { ...root.editing, readEntry: (id: string, offset: bigint) => {
        const row = domain[Number(offset)];
        return row !== undefined && stringEqual(row.id, id) ? some(encode(row)) : none;
    }, onApply: some(variant("sync", (payload: Uint8Array) => {
        const applied = apply(domain, decodeBatch(payload), some(revision));
        if (applied.type === "conflict") return variant("conflict", applied.value);
        domain = applied.value;
        return variant("applied", { revision: some("r1") });
    })) };
    const before = projected();
    let drawn: { rows: readonly SheetRowValue[]; positions: readonly number[]; read: SheetRowsRead } = { rows: before, positions: [0, 1], read: { revision: "r0", before: () => false } };
    const hook = renderHook(() => useSheetEditing(editing, { ...source }, drawn.rows, drawn.positions, "landed-twice", undefined, undefined, false, false, undefined, undefined, drawn.read));
    const qtys = () => applyLayer(drawn.rows, hook.result.current.layer).filter((row) => stringEqual(row.id, "a")).map((row) => row.cells.get("qty"));
    act(() => hook.result.current.record([variant("commit", { rowId: "a", offset: 0n, key: "qty", row: { ...before[0]!, cells: new Map(before[0]!.cells).set("qty", variant("Integer", 7n)) }, source: variant("typed", null) })]));
    await act(async () => { await hook.result.current.session.apply(); });
    // Read again at r1, the first window holds a; a window from 50 on still stands from r0, and holds it too — a move
    // had carried it from the one to the other.
    revision = "r1";
    const again = projected();
    drawn = { rows: [...again, before[0]!], positions: [0, 1, 60], read: { revision: "r1", before: (position) => position !== undefined && position >= 50 } };
    hook.rerender();
    expect(hook.result.current.session.status).toBe("idle");
    expect([...hook.result.current.session.landed.keys()]).toEqual(["a"]);
    expect(qtys()).toEqual([variant("Integer", 7n), variant("Integer", 7n)]);
    // The standing window read again: the Save's version goes, the rows holding it.
    drawn = { rows: again, positions: [0, 1], read: { revision: "r1", before: () => false } };
    hook.rerender();
    expect(hook.result.current.session.landed.size).toBe(0);
    expect(hook.result.current.layer.edits.size).toBe(0);
    expect(qtys()).toEqual([variant("Integer", 7n)]);
});

test("creation defaults survive a multi-event gesture, later clearing, and applied undo/redo", async () => {
    initializeStore(new UIStore());
    const Item = StructType({ id: StringType, qty: IntegerType, note: StringType, hidden: ArrayType(StringType) });
    const compile = East.function([], Sheet.Types.Root, ($) => {
        const data = $.const(State.bind([ArrayType(Item)], "seeded-flat", []));
        const count = $.const(State.bind([IntegerType], "seed-calls", 0n));
        const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(Item), ($, _context) => {
            $(count.write(count.read().add(1n)));
            return Sheet.patch(Item, { qty: 5n, note: "default note", hidden: [East.print(count.read())] });
        }));
        return Sheet.Root(data, { qty: Sheet.column.integer(Item), note: Sheet.column.text(Item) }, { id: "id", onUpdate: data.write, newRow });
    }).toIR().compile(StateImpl);
    const getView = () => compile();
    const root = getView();
    const hook = renderHook(({ root }) => useEditing(root), { initialProps: { root } });
    const inserted: SheetRowValue = { id: "new", owned: false, cells: new Map<string, SheetCellValue>([["qty", variant("Integer", 9n)], ["note", variant("Null", null)]]), lines: [], band: none, subRows: [] };
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
    const compile = East.function([], Sheet.Types.Root, ($) => {
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
    const hook = renderHook(() => useEditing(result));
    const row: SheetRowValue = { id: "g", owned: false, cells: new Map([["$title", variant("Null", null)]]), lines: [{ key: "new-child", cells: new Map([["qty", variant("Integer", 8n)]]), subRows: [] }], band: some({ sub: "", folded: false }), subRows: [] };
    act(() => hook.result.current.record([
        variant("insert", { afterRowId: none, row, source: variant("typed", null) }),
        variant("commit", { rowId: "g", offset: 0n, key: "$title", row: { ...row, cells: new Map([["$title", variant("String", "Named group")]]) }, source: variant("typed", null) }),
    ]));
    expect(hook.result.current.session.canApply).toBe(true);
    expect(hook.result.current.layer.appended[0]!.cells.get("$title")).toEqual(variant("String", "Named group"));
    expect(hook.result.current.layer.appended[0]!.lines).toHaveLength(2);
    await act(async () => { await hook.result.current.session.apply(); });
    const applied = compile();
    const raw = applied.editing.readEntry("g", 0n);
    if (raw.type !== "some") throw new Error("Expected group");
    expect(decodeBeast2For(Group)(raw.value)).toEqual({ id: "g", name: "Named group", owner: "planner", rows: [{ qty: 3n, hidden: "supplied child" }, { qty: 8n, hidden: "g:1" }] });
});
