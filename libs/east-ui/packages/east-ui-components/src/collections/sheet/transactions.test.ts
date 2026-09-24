/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test, vi } from "vitest";
import { ArrayType, IntegerType, OptionType, StringType, StructType, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui/internal";
import { liftDraft, normalizeDraft } from "./draft-values.js";
import { SheetTransactions, type EntryVersion, type Placement, type SheetTransactionBinding } from "./transactions.js";

const Row = StructType({ id: StringType, qty: IntegerType, hidden: ArrayType(StringType), note: OptionType(StringType) });
const Draft = Sheet.Types.Draft(Row);
const Batch = Sheet.Types.ChangeSet(Row);
const Event = Sheet.Types.PatchEvent(Row);
const a = { id: "a", qty: 1n, hidden: ["preserve"], note: none };
const b = { id: "b", qty: 2n, hidden: [], note: none };
const start = some(variant("ordered", variant("start", null)));
const end = some(variant("ordered", variant("end", null)));
const absent: EntryVersion = { draft: undefined, wire: undefined, place: none };
const version = (row: ValueTypeOf<typeof Row>, place: Placement = start): EntryVersion => ({ draft: liftDraft(Draft, row), wire: undefined, place });
const binding = (overrides: Partial<SheetTransactionBinding> = {}): SheetTransactionBinding => ({
    sourceId: "test", entryType: Row, draftType: Draft, idField: "id", auto: false,
    apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined, ...overrides,
});
const create = (overrides: Partial<SheetTransactionBinding> = {}) => {
    const session = new SheetTransactions(binding(overrides));
    session.observeBase(variant("snapshot", [a, b]));
    return session;
};
const editA = (session: SheetTransactions, qty = 9n) => session.record([{ id: "a", before: version(a), after: version({ ...a, qty }) }], "typed", "Edit quantity");

test("one paste across entries emits one event and one complete checked batch", async () => {
    const events: ValueTypeOf<typeof Event>[] = [];
    const batches: ValueTypeOf<typeof Batch>[] = [];
    const session = create({ patch: bytes => events.push(decodeBeast2For(Event)(bytes)), apply: bytes => { batches.push(decodeBeast2For(Batch)(bytes)); return variant("applied", { revision: none }); } });
    session.record([
        { id: "a", before: version(a), after: version({ ...a, qty: 7n }) },
        { id: "b", before: version(b, end), after: version({ ...b, qty: 8n }, end) },
    ], "pasted", "Paste 2 rows");
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0]!.draftChanges).toHaveLength(2);
    expect(events[0]!.origin.type).toBe("pasted");
    expect(events[0]!.domainChanges.type).toBe("some");
    await session.apply();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.changes).toHaveLength(2);
    expect(batches[0]!.base).toEqual(variant("snapshot", [a, b]));
    expect(session.locked).toBe(true);
});

test("editing the same entry composes one patch, and no-op gestures stay clean", async () => {
    const apply = vi.fn(() => variant("applied", { revision: none }));
    const session = create({ apply });
    expect(editA(session, 1n)).toBe(false);
    expect(session.pending).toBe(0);
    expect(session.canUndo).toBe(false);
    editA(session, 3n); editA(session, 4n);
    expect(session.pending).toBe(1);
    session.undo(); expect(session.pending).toBe(1);
    session.undo(); expect(session.pending).toBe(0);
    await session.apply(); expect(apply).not.toHaveBeenCalled();
    session.redo(); session.redo(); await session.apply();
    expect(apply).toHaveBeenCalledTimes(1);
});

test("insert then remove cancels; undo restores its original placement", async () => {
    const session = create();
    const c = version({ ...a, id: "c" }, end);
    session.record([{ id: "c", before: absent, after: c }], "insert", "Insert row");
    session.record([{ id: "c", before: c, after: absent }], "remove", "Remove row");
    expect(session.pending).toBe(0);
    session.undo(); expect(session.pending).toBe(1);
    expect(session.entries.get("c")!.place).toEqual(end);
    session.redo(); expect(session.pending).toBe(0);
});

test("required hidden fields always block application and missing optional fields normalize to none", async () => {
    const apply = vi.fn(() => variant("applied", { revision: none }));
    const session = create({ apply });
    const draft = { id: variant("value", "new"), qty: variant("value", 1n), hidden: variant("missing", null), note: variant("missing", null) };
    session.record([{ id: "new", before: absent, after: { draft, wire: undefined, place: end } }], "insert", "Insert incomplete row");
    expect(session.readiness.type).toBe("incomplete");
    expect(session.canApply).toBe(false);
    await session.apply(); expect(apply).not.toHaveBeenCalled();
    const ready = { ...draft, hidden: variant("value", []) };
    expect(normalizeDraft(Draft, ready, "new").domain).toEqual({ id: "new", qty: 1n, hidden: [], note: none });
    expect(normalizeDraft(Draft, { ...ready, note: variant("invalid", "bad") }, "new").readiness.type).toBe("invalid");
});

test("incomplete edits emit draft patches without manufacturing domain values", async () => {
    const events: ValueTypeOf<typeof Event>[] = [];
    const session = create({ patch: bytes => events.push(decodeBeast2For(Event)(bytes)) });
    const old = version(a);
    const draft = { ...(old.draft as ValueTypeOf<typeof Draft>), qty: variant("invalid", "several") };
    session.record([{ id: "a", before: old, after: { ...old, draft } }], "typed", "Enter quantity");
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0]!.domainChanges.type).toBe("none");
    expect(events[0]!.readiness.type).toBe("invalid");
    session.undo(); expect(session.pending).toBe(0);
});

test("retry freezes request bytes and callback; unresolved requests lock mutations and history", async () => {
    const bytes: Uint8Array[] = [];
    const apply = vi.fn((payload: Uint8Array) => {
        bytes.push(payload.slice()); payload.fill(0);
        if (bytes.length === 1) throw new Error("acknowledgement lost");
        return variant("applied", { revision: none });
    });
    const session = create({ apply }); editA(session);
    await session.apply(); expect(session.status).toBe("unknown");
    expect(session.canUndo).toBe(false);
    expect(editA(session, 42n)).toBe(false);
    session.discard(); expect(session.pending).toBe(1);
    const replacement = vi.fn(() => variant("applied", { revision: none }));
    session.bind(binding({ apply: replacement }));
    await session.apply();
    expect(bytes[1]).toEqual(bytes[0]);
    expect(replacement).not.toHaveBeenCalled();
    expect(session.status).toBe("reconciling");
});

test("confirmed rejection cannot resubmit unchanged; a revised gesture gets a new request id", async () => {
    const requests: ValueTypeOf<typeof Batch>[] = [];
    const session = create({ apply: bytes => { requests.push(decodeBeast2For(Batch)(bytes)); return variant("rejected", []); } });
    editA(session); await session.apply(); await session.apply();
    expect(requests).toHaveLength(1);
    editA(session, 10n); await session.apply();
    expect(requests).toHaveLength(2);
    expect(requests[0]!.requestId).not.toBe(requests[1]!.requestId);
});

test("an old inline snapshot cannot acknowledge a move; undo after apply submits the inverse", async () => {
    const requests: ValueTypeOf<typeof Batch>[] = [];
    const session = create({ apply: bytes => { requests.push(decodeBeast2For(Batch)(bytes)); return variant("applied", { revision: none }); } });
    session.record([{ id: "a", before: version(a, start), after: version(a, end) }], "move", "Move row");
    await session.apply();
    expect(session.reconcile(variant("snapshot", [a, b]), () => true)).toBe(false);
    expect(session.reconcile(variant("snapshot", [b, a]), () => true)).toBe(true);
    expect(session.pending).toBe(0);
    session.undo(); expect(session.pending).toBe(1);
    await session.apply();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.requestId).not.toBe(requests[0]!.requestId);
    expect(requests[1]!.base).toEqual(variant("snapshot", [b, a]));
    expect(requests[1]!.changes[0]!.place).toEqual(start);
});

test("paged overlays require the acknowledged hash and affected entries; refresh retry never reapplies", async () => {
    const apply = vi.fn(() => variant("applied", { revision: some("r2") }));
    const refresh = vi.fn(() => { throw new Error("refresh offline"); });
    const session = new SheetTransactions(binding({ apply, refresh }));
    session.observeBase(variant("revision", "r1")); editA(session); await session.apply();
    expect(session.status).toBe("reconciling");
    expect(refresh).toHaveBeenCalledWith(some("r2"));
    expect(session.reconcile(variant("revision", "r3"), () => true)).toBe(false);
    expect(session.reconcile(variant("revision", "r2"), () => false)).toBe(false);
    session.refresh(); await session.apply(); expect(apply).toHaveBeenCalledTimes(1);
    expect(session.reconcile(variant("revision", "r2"), () => true)).toBe(true);
    expect(session.pending).toBe(0);
});

test("an external revision never silently rebases drafts or positional history", () => {
    const session = new SheetTransactions(binding());
    session.observeBase(variant("revision", "r1")); editA(session);
    session.observeBase(variant("revision", "r2"));
    expect(session.stale).toBe(true);
    expect(session.canUndo).toBe(false);
    expect(session.canApply).toBe(false);
    expect(session.pending).toBe(1);
    session.discard(); expect(session.pending).toBe(0);
});

test("draft group readiness addresses missing child fields by array index", () => {
    const Group = StructType({ id: StringType, rows: ArrayType(Row) });
    const GroupDraft = Sheet.Types.DraftGroup(Group, "rows");
    const child = liftDraft(Draft, a) as ValueTypeOf<typeof Draft>;
    const value = { id: variant("value", "g"), rows: [{ ...child, hidden: variant("missing", null) }] };
    const checked = normalizeDraft(GroupDraft, value, "g");
    expect(checked.readiness.type).toBe("incomplete");
    if (checked.readiness.type !== "ready") expect(checked.readiness.value[0]).toMatchObject({ entry: "g", row: some(0n), field: some("hidden") });
});


test("draft-only optional normalization remains undoable without enabling an empty apply", async () => {
    const apply = vi.fn(() => variant("applied", { revision: none }));
    const session = create({ apply });
    const original = version(a);
    const draft = { ...(original.draft as ValueTypeOf<typeof Draft>), note: variant("missing", null) };
    session.record([{ id: "a", before: original, after: { ...original, draft } }], "typed", "Clear note");
    expect(session.pending).toBe(1);
    expect(session.readiness.type).toBe("ready");
    expect(session.canApply).toBe(false);
    await session.apply(); expect(apply).not.toHaveBeenCalled();
    expect(session.canUndo).toBe(true);
    session.undo(); expect(session.pending).toBe(0);
});

test("paged acknowledgement only demands entries changed in this request", async () => {
    const session = new SheetTransactions(binding({ apply: () => variant("applied", { revision: some("r2") }) }));
    session.observeBase(variant("revision", "r1"));
    editA(session);
    editA(session, 1n);
    session.record([{ id: "b", before: version(b, end), after: version({ ...b, qty: 7n }, end) }], "typed", "Edit b");
    await session.apply();
    const matches = vi.fn((id: string) => id === "b");
    expect(session.reconcile(variant("revision", "r2"), matches)).toBe(true);
    expect(matches).toHaveBeenCalledTimes(1);
    expect(matches).toHaveBeenCalledWith("b", { ...b, qty: 7n });
    expect(session.pending).toBe(0);
});

test("another Sheet's unresolved request freezes discard until the source is available", () => {
    let available = true;
    const session = create({ gate: { available: () => available, acquire: () => {}, release: () => {} } });
    editA(session);
    available = false;
    session.discard();
    expect(session.pending).toBe(1);
    available = true;
    session.discard();
    expect(session.pending).toBe(0);
});

test("HTTP browsers without randomUUID can record, undo, redo, apply and retry the same request", async () => {
    const events: ValueTypeOf<typeof Event>[] = [];
    const requests: Uint8Array[] = [];
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    try {
        const session = create({
            patch: bytes => events.push(decodeBeast2For(Event)(bytes)),
            apply: bytes => {
                requests.push(bytes);
                if (requests.length === 1) throw new Error("Lost acknowledgement");
                return variant("applied", { revision: none });
            },
        });
        expect(editA(session)).toBe(true);
        session.undo();
        session.redo();
        await Promise.resolve();
        expect(events.map(event => event.origin.type)).toEqual(["typed", "undo", "redo"]);
        expect(new Set(events.map(event => event.transactionId)).size).toBe(3);
        expect(events.every(event => event.transactionId.length > 0)).toBe(true);
        await session.apply();
        expect(session.status).toBe("unknown");
        await session.apply();
        expect(session.status).toBe("reconciling");
        expect(requests).toHaveLength(2);
        expect(requests[1]).toEqual(requests[0]);
        const requestId = decodeBeast2For(Batch)(requests[0]!).requestId;
        expect(requestId.length).toBeGreaterThan(0);
        expect(events.map(event => event.transactionId)).not.toContain(requestId);
    } finally { vi.unstubAllGlobals(); }
});
