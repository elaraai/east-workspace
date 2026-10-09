/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The editing session is every collection's (#879): it carries whatever
 * projection a collection draws an entry with — here a bar, not a sheet's
 * wire row — and records the collections' own gestures under their origins.
 * An Apply retires its drafts once the source reads back as it left them
 * (#1185): a positional snapshot whole, a keyed one by the batch's own
 * entries, and at a revision the entries read there.
 */

import { expect, test } from "vitest";
import { ArrayType, IntegerType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { editingMessages } from "./messages.js";
import { EditSession, type EditSessionBinding, type EntryVersion, type Origin, type Placement } from "./session.js";

const Run = StructType({ id: StringType, start: IntegerType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
const Event = Editing.Types.PatchEvent(Run);
const Batch = Editing.Types.ChangeSet(Run);
/** A collection's own projection of an entry — a bar on a canvas. */
interface Bar { key: string; caption: string }
type RunValue = ValueTypeOf<typeof Run>;
const a: RunValue = { id: "a", start: 1n, end: 3n };
const start = some(variant("ordered", variant("start", null)));
const version = (run: RunValue): EntryVersion<Bar> => ({
    draft: liftDraft(Draft, run), wire: { key: run.id, caption: `${run.start}–${run.end}` }, place: start,
});
const create = (overrides: Partial<EditSessionBinding<Bar>> = {}) => {
    const session = new EditSession<Bar>({
        sourceId: "bars", entryType: Run, draftType: Draft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined, ...overrides,
    });
    session.observeBase(variant("snapshot", [a]));
    return session;
};

test("an entry version carries the collection's own projection through a gesture, its undo and its redo", () => {
    const session = create();
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–5" });
    session.undo();
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–3" });
    session.redo();
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–5" });
    expect(session.originals.get("a")!.wire).toEqual({ key: "a", caption: "1–3" });
});

test("the collections' own gestures — a resize, a drop, a verdict — are reported as the gesture that made them", async () => {
    const events: ValueTypeOf<typeof Event>[] = [];
    const session = create({ patch: (bytes) => events.push(decodeBeast2For(Event)(bytes)) });
    const gestures: [Origin, bigint][] = [["resize", 5n], ["drop", 6n], ["verdict", 7n]];
    let current = a;
    for (const [origin, end] of gestures) {
        const next = { ...current, end };
        session.record([{ id: "a", before: version(current), after: version(next) }], origin, `Set end ${end}`);
        current = next;
    }
    await Promise.resolve();
    expect(events.map((e) => e.origin.type)).toEqual(["resize", "drop", "verdict"]);
    expect(events.every((e) => e.domainChanges.type === "some")).toBe(true);
});

test("an Array batch places anchors first, so Apply leaves the drafted order whichever entry was touched first", async () => {
    const Tile = StructType({ id: StringType });
    const TileDraft = Editing.Types.Draft(Tile);
    const TileBatch = Editing.Types.ChangeSet(Tile);
    const at = (id: string, place: Placement): EntryVersion<Bar> => ({ draft: liftDraft(TileDraft, { id }), wire: { key: id, caption: id }, place });
    const batches: ValueTypeOf<typeof TileBatch>[] = [];
    const session = new EditSession<Bar>({
        sourceId: "tiles", entryType: Tile, draftType: TileDraft, idField: "id", auto: false, patch: undefined, refresh: undefined,
        apply: (bytes) => { batches.push(decodeBeast2For(TileBatch)(bytes)); return variant("applied", { revision: none }); },
    });
    session.observeBase(variant("snapshot", [{ id: "p" }, { id: "a" }, { id: "b" }, { id: "q" }]));
    // q moves beside a: p a q b.
    session.record([{ id: "q", before: at("q", some(variant("ordered", variant("after", "b")))), after: at("q", some(variant("ordered", variant("after", "a")))) }], "move", "Move q");
    // p moves beside a too: a p q b — q now stands after p, and says so.
    session.record([
        { id: "p", before: at("p", some(variant("ordered", variant("before", "a")))), after: at("p", some(variant("ordered", variant("after", "a")))) },
        { id: "q", before: at("q", some(variant("ordered", variant("after", "a")))), after: at("q", some(variant("ordered", variant("after", "p")))) },
    ], "move", "Move p");
    expect(session.applied()).toEqual([{ id: "a" }, { id: "p" }, { id: "q" }, { id: "b" }]);
    await session.apply();
    // q was touched first, but it is anchored on p: p is placed before it.
    expect(batches[0]!.changes.map((c) => c.id)).toEqual(["p", "q"]);
});

test("Apply sends the domain change alone — never the projection — and the source's snapshot acknowledges it", async () => {
    const batches: ValueTypeOf<typeof Batch>[] = [];
    const session = create({ apply: (bytes) => { batches.push(decodeBeast2For(Batch)(bytes)); return variant("applied", { revision: none }); } });
    session.record([{ id: "a", before: version(a), after: version({ ...a, start: 2n }) }], "move", "Move a");
    expect(session.canApply).toBe(true);
    await session.apply();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.changes.map((c) => c.id)).toEqual(["a"]);
    expect(session.status).toBe("reconciling");
    // A positional snapshot is read whole, by the session itself.
    expect(session.reconcile(variant("snapshot", [{ ...a, start: 2n }]), () => undefined)).toBe(true);
    expect(session.pending).toBe(0);
    expect(session.status).toBe("idle");
});

// ── Confirming a commit (#1185) ─────────────────────────────────────────────

const Job = StructType({ task: StringType, qty: IntegerType });
const JobDraft = Editing.Types.Draft(Job);
type JobValue = ValueTypeOf<typeof Job>;
const keyOrder = some(variant("keyOrder", null));
const job = (value: JobValue): EntryVersion<Bar> => ({ draft: liftDraft(JobDraft, value), wire: { key: value.task, caption: `${value.qty}` }, place: keyOrder });
const absentJob: EntryVersion<Bar> = { draft: undefined, wire: undefined, place: none };
/** A keyed source's whole collection, as East holds a Dict. */
const jobs = (entries: [string, JobValue][]) => new SortedMap(entries, compareFor(StringType));
const cut = { task: "Panel cutting", qty: 2n };
const band = { task: "Edge banding", qty: 4n };
const route = { task: "CNC routing", qty: 1n };
const spray = { task: "Spray finish", qty: 6n };
/** A keyed session over the jobs, read whole, or at a revision when `revision` names the one it is at. */
const keyed = (revision?: string) => {
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined,
    });
    session.observeBase(revision === undefined ? variant("snapshot", jobs([["J1", cut], ["J2", band], ["J3", route]])) : variant("revision", revision));
    return session;
};

test("a keyed snapshot confirms a commit by its own entries — an update, an insert, a delete — whatever another write did to the others (#1185)", async () => {
    const session = keyed();
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J4", before: absentJob, after: job(spray) },
        { id: "J2", before: job(band), after: absentJob },
    ], "typed", "Edit jobs");
    await session.apply();
    expect(session.status).toBe("reconciling");
    // The record as the edit began: nothing of the commit in it yet.
    expect(session.reconcile(variant("snapshot", jobs([["J1", cut], ["J2", band], ["J3", route]])), () => undefined)).toBe(false);
    expect(session.status).toBe("reconciling");
    // The commit, and another write's to J3 beside it.
    expect(session.reconcile(variant("snapshot", jobs([["J1", { ...cut, qty: 5n }], ["J3", { ...route, qty: 9n }], ["J4", spray]])), () => undefined)).toBe(true);
    expect(session.status).toBe("idle");
    expect(session.pending).toBe(0);
    // The rows read back as the session holds them: its history stands.
    expect(session.canUndo).toBe(true);
});

test("a field another write set beside the commit's is the record's: the commit confirms, and the session's versions go with their history (#1185)", async () => {
    const session = keyed();
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await session.apply();
    // Another write set J1's task before this one landed; the record holds both.
    expect(session.reconcile(variant("snapshot", jobs([["J1", { task: "Panel cutting, oak", qty: 5n }], ["J2", band], ["J3", route]])), () => undefined)).toBe(true);
    expect(session.status).toBe("idle");
    // The session's version of J1 is behind the record: it goes, so the next edit begins from the record's.
    expect(session.entries.size).toBe(0);
    expect(session.canUndo).toBe(false);
});

test("a source at a revision confirms at the one the commit made, its entries read there — a field another write set beside them is the source's (#1185)", async () => {
    const session = keyed("r1");
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await session.apply();
    expect(session.reconcile(variant("revision", "r2"), () => some(cut))).toBe(false);
    expect(session.reconcile(variant("revision", "r2"), () => some({ task: "Panel cutting, oak", qty: 5n }))).toBe(true);
    expect(session.entries.size).toBe(0);
});

test("a positional snapshot confirms only once its whole collection reads back, its order included", async () => {
    const session = create();
    const b: RunValue = { id: "b", start: 4n, end: 6n };
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    await session.apply();
    // Another entry beside the commit's: the collection is not the one the commit left.
    expect(session.reconcile(variant("snapshot", [{ ...a, end: 5n }, b]), () => undefined)).toBe(false);
    expect(session.reconcile(variant("snapshot", [{ ...a, end: 5n }]), () => undefined)).toBe(true);
});

test("an entry the record still holds as its edit began never confirms, though the change, undone, would apply to it — a line taken out of an order's lines (#1185)", async () => {
    const Order = StructType({ name: StringType, ops: ArrayType(StringType) });
    const OrderDraft = Editing.Types.Draft(Order);
    const order = (ops: string[]): EntryVersion<Bar> => ({ draft: liftDraft(OrderDraft, { name: "WO-1", ops }), wire: { key: "WO-1", caption: ops.join(" · ") }, place: keyOrder });
    const orders = (ops: string[]) => new SortedMap([["WO-1", { name: "WO-1", ops }]], compareFor(StringType));
    const session = new EditSession<Bar>({
        sourceId: "orders", entryType: Order, draftType: OrderDraft, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", orders(["Cut", "Band"])));
    session.record([{ id: "WO-1", before: order(["Cut", "Band"]), after: order(["Cut"]) }], "remove", "Remove line");
    await session.apply();
    // Putting the line back would apply to the record as it stands — but it stands as the edit began.
    expect(session.reconcile(variant("snapshot", orders(["Cut", "Band"])), () => undefined)).toBe(false);
    expect(session.reconcile(variant("snapshot", orders(["Cut"])), () => undefined)).toBe(true);
});

test("a move alone confirms at the revision it committed: its entry's value is not the change, its place is (#1185)", async () => {
    const moved = some(variant("ordered", variant("end", null)));
    const session = new EditSession<Bar>({
        sourceId: "bars", entryType: Run, draftType: Draft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record([{ id: "a", before: version(a), after: { ...version(a), place: moved } }], "move", "Move a");
    await session.apply();
    expect(session.status).toBe("reconciling");
    expect(session.reconcile(variant("revision", "r2"), () => some(a))).toBe(true);
    expect(session.status).toBe("idle");
});

// ── Naming a Save's conflicts at a revision (#1199) ─────────────────────────

/** What a source read a window at a time answers a conflicting Save with: its own issue, and its words for each entry it changed. */
const lastBy = " — last changed by Ann";
const recordIssue = { entry: "", row: none, field: none, message: `The record changed since this edit began${lastBy}` };
const said = (entry: string) => ({ entry, row: none, field: none, message: `Changed since this edit began${lastBy}` });
/** A keyed session over the jobs at revision r1, whose Save the source answers with `issues`, a conflict. */
const conflicting = (issues: ReturnType<typeof said>[]) => {
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, auto: false,
        apply: () => variant("conflict", issues), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J2", before: job(band), after: job({ ...band, qty: 8n }) },
    ], "typed", "Edit jobs");
    return session;
};

test("a Save's conflict at a revision names the entries another write moved — read at the revision the source moves to — in the source's words for each (#1199)", async () => {
    const session = conflicting([recordIssue, said("J1"), said("J2")]);
    await session.apply();
    expect(session.status).toBe("conflict");
    // Until its entries are read, the source's own issue says what happened.
    expect(session.issues).toEqual([recordIssue]);
    expect(session.naming).toEqual({ revision: "r1", ids: ["J1", "J2"] });
    // At the revision the Save was drafted at, there is nothing to read.
    expect(session.nameConflicts(variant("revision", "r1"), () => some(cut))).toBe(false);
    // At the new one, not while an entry is still unread.
    expect(session.nameConflicts(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : undefined))).toBe(false);
    expect(session.issues).toEqual([recordIssue]);
    // Both read: another write set J1's quantity, and J2 stands as its edit began.
    expect(session.nameConflicts(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : some(band)))).toBe(true);
    expect(session.issues).toEqual([said("J1")]);
    expect(session.naming).toBeUndefined();
    // Named once: a later read names nothing again.
    expect(session.nameConflicts(variant("revision", "r3"), () => some(cut))).toBe(false);
    expect(session.status).toBe("conflict");
});

test("an entry a change still applies to is not named — a field another write set beside the change's — and with none named the source's own issue stays (#1199)", async () => {
    const session = conflicting([recordIssue, said("J1"), said("J2")]);
    await session.apply();
    // Another write renamed J1's task: the quantity the Save set still applies over it.
    expect(session.nameConflicts(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, task: "Panel cutting, oak" }) : some(band)))).toBe(true);
    expect(session.issues).toEqual([recordIssue]);
});

test("an entry deleted since is named; with no words of the source's, in the session's own (#1199)", async () => {
    const session = conflicting([]);
    await session.apply();
    // The source said nothing of its own: the session says the source changed, until it names an entry.
    expect(session.issues).toEqual([]);
    expect(session.nameConflicts(variant("revision", "r2"), (id) => (id === "J2" ? none : some(cut)))).toBe(true);
    expect(session.issues).toEqual([{ entry: "J2", row: none, field: none, message: editingMessages.issueChanged() }]);
});

test("a conflict whose entries all still take their changes, from a source that said nothing, says the source changed (#1199)", async () => {
    const session = conflicting([]);
    await session.apply();
    expect(session.nameConflicts(variant("revision", "r2"), (id) => (id === "J1" ? some(cut) : some(band)))).toBe(true);
    expect(session.issues).toEqual([{ entry: "", row: none, field: none, message: editingMessages.issueSourceChanged() }]);
});

test("a snapshot's conflict is named by its source, and a gesture after a revision's ends its naming (#1199)", async () => {
    const whole = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, auto: false,
        apply: () => variant("conflict", [said("J1")]), patch: undefined, refresh: undefined,
    });
    whole.observeBase(variant("snapshot", jobs([["J1", cut], ["J2", band], ["J3", route]])));
    whole.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await whole.apply();
    expect(whole.issues).toEqual([said("J1")]);
    expect(whole.naming).toBeUndefined();
    expect(whole.nameConflicts(variant("revision", "r2"), () => some(cut))).toBe(false);

    const paged = conflicting([recordIssue, said("J1")]);
    await paged.apply();
    expect(paged.naming).toBeDefined();
    // Discarded: nothing is left to name.
    paged.discard();
    expect(paged.naming).toBeUndefined();
    expect(paged.nameConflicts(variant("revision", "r2"), () => some({ ...cut, qty: 3n }))).toBe(false);
});
