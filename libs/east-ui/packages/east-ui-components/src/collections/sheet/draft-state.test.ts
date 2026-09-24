/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test, vi } from "vitest";
import { ArrayType, IntegerType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui/internal";
import { discardDraft, draftPresentation } from "./draft-state.js";
import { liftDraft } from "./draft-values.js";
import { SheetTransactions, type EntryVersion, type SheetTransactionBinding } from "./transactions.js";

const Row = StructType({ id: StringType, qty: IntegerType, hidden: StringType });
const Draft = Sheet.Types.Draft(Row);
const absent: EntryVersion = { draft: undefined, wire: undefined, place: none };
const row = (id: string, qty = 1n) => ({ id, qty, hidden: `hidden ${id}` });
const version = (id: string, qty = 1n): EntryVersion => ({
    draft: liftDraft(Draft, row(id, qty)),
    wire: { id, owned: false, cells: new Map(), lines: [], band: none, subRows: [] },
    place: some(variant("ordered", variant("end", null))),
});
const binding = (overrides: Partial<SheetTransactionBinding> = {}): SheetTransactionBinding => ({
    sourceId: "draft-discard", entryType: Row, draftType: Draft, auto: false,
    apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined,
    ...overrides,
});
const create = (overrides: Partial<SheetTransactionBinding> = {}) => {
    const session = new SheetTransactions(binding(overrides));
    session.observeBase(variant("revision", "r1"));
    return session;
};

test("discard is available only before the row has been acknowledged by the source", async () => {
    const session = create();
    const fresh = version("new");
    session.record([{ id: "new", before: absent, after: fresh }], "insert", "Add row");
    expect(draftPresentation(session, Draft, undefined, "new").discardable).toBe(true);
    await session.apply();
    expect(discardDraft(session, undefined, "new")).toBe(false);
    expect(draftPresentation(session, Draft, undefined, "new").discardable).toBe(false);
    expect(session.reconcile(variant("revision", "r2"), () => true)).toBe(true);
    expect(draftPresentation(session, Draft, undefined, "new").pending).toBe(false);
    expect(discardDraft(session, undefined, "new")).toBe(false);
    session.record([{ id: "new", before: fresh, after: version("new", 2n) }], "typed", "Edit row");
    expect(draftPresentation(session, Draft, undefined, "new").pending).toBe(true);
    expect(draftPresentation(session, Draft, undefined, "new").discardable).toBe(false);
});

test("a child discard follows stable identity after reorder and Undo restores exact order and hidden data", () => {
    const Group = StructType({ id: StringType, rows: ArrayType(Row) });
    const GroupDraft = Sheet.Types.DraftGroup(Group, "rows");
    const session = create({ entryType: Group, draftType: GroupDraft, children: "rows" });
    const group = (keys: string[]): EntryVersion => ({
        draft: liftDraft(GroupDraft, { id: "g", rows: keys.map(key => row(key)) }),
        wire: { id: "g", owned: false, cells: new Map(), lines: keys.map(key => ({ key, cells: new Map(), subRows: [] })), band: some({ sub: "", folded: false }), subRows: [] },
        place: some(variant("ordered", variant("end", null))),
    });
    const before = group(["a", "b"]);
    const after = group(["b", "new", "a"]);
    session.record([{ id: "g", before, after }], "insert", "Insert child");
    expect(draftPresentation(session, GroupDraft, "rows", "g", "new").discardable).toBe(true);
    expect(draftPresentation(session, GroupDraft, "rows", "g", "a").discardable).toBe(false);
    expect(discardDraft(session, "rows", "g", "a")).toBe(false);
    expect(discardDraft(session, "rows", "g", "new")).toBe(true);
    expect(session.entries.get("g")).toEqual(group(["b", "a"]));
    session.undo();
    expect(session.entries.get("g")).toEqual(after);
    session.redo();
    expect(session.entries.get("g")).toEqual(group(["b", "a"]));
});

test("another Sheet's unresolved request disables draft discard", () => {
    let available = true;
    const session = create({ gate: { available: () => available, acquire: () => {}, release: () => {} } });
    session.record([{ id: "new", before: absent, after: version("new") }], "insert", "Add row");
    available = false;
    expect(draftPresentation(session, Draft, undefined, "new").discardable).toBe(false);
    expect(discardDraft(session, undefined, "new")).toBe(false);
    expect(session.pending).toBe(1);
});

test.each([true, false])("discard never invokes onApply when removing an incomplete row unblocks automatic mode (queued work drained: %s)", async (drained) => {
    const apply = vi.fn(() => variant("applied", { revision: some("r2") }));
    const session = create({ auto: true, apply });
    const incomplete: EntryVersion = { ...version("new"), draft: {
        id: variant("value", "new"), qty: variant("value", 1n), hidden: variant("missing", null),
    } };
    session.record([{ id: "new", before: absent, after: incomplete }], "insert", "Add incomplete row");
    session.record([{ id: "a", before: version("a"), after: version("a", 7n) }], "typed", "Edit existing row");
    if (drained) await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    expect(discardDraft(session, undefined, "new")).toBe(true);
    await Promise.resolve();
    expect(session.canApply).toBe(true);
    expect(apply).not.toHaveBeenCalled();
});
