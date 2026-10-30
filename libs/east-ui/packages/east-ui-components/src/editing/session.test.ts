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
import {
    ArrayType, DictType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant,
    type ValueTypeOf, type option,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { editingMessages } from "./messages.js";
import { EditSession, type EditSessionBinding, type EntryVersion, type HeldRows, type Origin, type Placement } from "./session.js";

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

// ── The drafts a preview of the Save reads (#1437) ───────────────────────────

/** Whether an entry's version, as the source holds one, is the job given — `none` for an absent one. */
const isJob = (version: option<unknown>, job: option<JobValue>) => equalFor(OptionType(Job))(version as option<JobValue>, job);

test("lists each entry drafted away from its original, each as the source holds an entry, and the revision the drafts began from (#1437)", () => {
    const session = keyed("r1");
    expect(session.drafts.entries.size).toBe(0);
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J4", before: absentJob, after: job(spray) },
        { id: "J2", before: job(band), after: absentJob },
    ], "typed", "Edit jobs");
    const { revision, entries } = session.drafts;
    expect(revision).toBe("r1");
    expect([...entries.keys()].sort()).toEqual(["J1", "J2", "J4"]);
    const [updated, inserted, removed] = [entries.get("J1")!, entries.get("J4")!, entries.get("J2")!];
    expect(updated.key).toBe("J1");
    expect(isJob(updated.before, some(cut)) && isJob(updated.after, some({ ...cut, qty: 5n }))).toBe(true);
    expect(isJob(inserted.before, none) && isJob(inserted.after, some(spray))).toBe(true);
    expect(isJob(removed.before, some(band)) && isJob(removed.after, none)).toBe(true);
    // Each version as the session holds it.
    expect(updated.draft).toBe(session.entries.get("J1"));
    expect(updated.original).toBe(session.originals.get("J1"));
});

test("keeps a drafted entry the same object while its original and its draft hold — another entry's gestures, an Undo and a Redo — and leaves out one undone to its original, discarded or saved (#1437)", async () => {
    const session = keyed("r1");
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    const drafts = session.drafts;
    expect(session.drafts).toBe(drafts);
    const J1 = drafts.entries.get("J1")!;
    session.record([{ id: "J3", before: job(route), after: job({ ...route, qty: 2n }) }], "typed", "Set quantity");
    expect(session.drafts).not.toBe(drafts);
    expect(session.drafts.entries.get("J1")).toBe(J1);
    session.undo();
    expect([...session.drafts.entries.keys()]).toEqual(["J1"]);
    session.undo();
    expect(session.drafts.entries.size).toBe(0);
    session.redo();
    // The history keeps the versions it recorded: the same draft, the same view of it.
    expect(session.drafts.entries.get("J1")).toBe(J1);
    session.discard();
    expect(session.drafts.entries.size).toBe(0);
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 7n }) }], "typed", "Set quantity");
    await session.apply();
    expect(session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 7n }))).toBe(true);
    // Saved: the source holds the draft, at the revision the Save made.
    expect(session.drafts.entries.size).toBe(0);
    expect(session.drafts.revision).toBe("r2");
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


test("view preparation precedes submission; only changed primary entries reach it, and its observer waits for confirmed Save", async () => {
    let release!: () => void;
    let applied = 0;
    let confirmed = 0;
    const seen: string[][] = [];
    const session = create({
        prepare: async targets => {
            seen.push([...targets.keys()]);
            await new Promise<void>(resolve => { release = resolve; });
            return () => { confirmed++; };
        },
        apply: () => { applied++; return variant("applied", { revision: none }); },
    });
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    const save = session.apply();
    expect(applied).toBe(0);
    expect(session.writable).toBe(false);
    release();
    await save;
    expect(seen).toEqual([["a"]]);
    expect(applied).toBe(1);
    expect(confirmed).toBe(0);
    expect(session.reconcile(variant("snapshot", [a]), () => undefined)).toBe(false);
    expect(session.reconcile(variant("snapshot", [{ ...a, end: 5n }]), () => undefined)).toBe(true);
    await Promise.resolve();
    expect(confirmed).toBe(1);
});

test("a view preparation is handed the rows its request began from, at its base, and its observer those its confirmation read back exactly, at the revision committed", async () => {
    const encode = encodeBeast2For(Job);
    let began: HeldRows | undefined;
    let confirmed: HeldRows | undefined;
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined,
        prepare: async (_targets, held) => { began = held; return (read) => { confirmed = read; }; },
    });
    session.observeBase(variant("revision", "r1"));
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J2", before: job(band), after: job({ ...band, qty: 8n }) },
        { id: "J4", before: absentJob, after: job(spray) },
        { id: "J3", before: job(route), after: absentJob },
    ], "typed", "Edit jobs");
    await session.apply();
    // Each entry as the request began from it at r1, encoded — J4 was absent there.
    expect(began?.revision).toBe("r1");
    expect(new Set(began!.rows.keys())).toEqual(new Set(["J1", "J2", "J3"]));
    expect(began!.rows.get("J1")).toEqual(encode(cut));
    expect(began!.rows.get("J3")).toEqual(encode(route));
    // At r2: J1 and J4 read back as the request left them, J2 beside another write's field, J3 gone.
    expect(session.reconcile(variant("revision", "r2"), id => id === "J1" ? some({ ...cut, qty: 5n })
        : id === "J2" ? some({ task: "Edge banding, rework", qty: 8n }) : id === "J4" ? some(spray) : none)).toBe(true);
    await Promise.resolve();
    // Only what the confirmation read back exactly is held: a row another write changed beside the request's is read again.
    expect(confirmed?.revision).toBe("r2");
    expect(new Set(confirmed!.rows.keys())).toEqual(new Set(["J1", "J4"]));
    expect(confirmed!.rows.get("J1")).toEqual(encode({ ...cut, qty: 5n }));
    expect(confirmed!.rows.get("J4")).toEqual(encode(spray));

    // A snapshot names no revision: neither holds a row.
    let snapshotBegan: HeldRows | undefined = { revision: "", rows: new Map() };
    let snapshotConfirmed: HeldRows | undefined = { revision: "", rows: new Map() };
    const whole = create({ prepare: async (_targets, held) => { snapshotBegan = held; return (read) => { snapshotConfirmed = read; }; } });
    whole.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    await whole.apply();
    expect(whole.reconcile(variant("snapshot", [{ ...a, end: 5n }]), () => undefined)).toBe(true);
    await Promise.resolve();
    expect([snapshotBegan, snapshotConfirmed]).toEqual([undefined, undefined]);
});

test("failed preparation sends no mutation, retains every draft and permits a fresh Save", async () => {
    let failed = true;
    let applied = 0;
    const session = create({
        prepare: async () => { if (failed) throw new Error("Could not check the current view"); return () => {}; },
        apply: () => { applied++; return variant("applied", { revision: none }); },
    });
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    await session.apply();
    expect(applied).toBe(0);
    expect(session.pending).toBe(1);
    expect(session.canApply).toBe(true);
    expect(session.error).toBe("Could not check the current view");
    failed = false;
    await session.apply();
    expect(applied).toBe(1);
    expect(session.error).toBeUndefined();
});


test("large Saves confirm in bounded primary-key batches without retaining decoded pages", async () => {
    const session = keyed("r1");
    const ids = Array.from({ length: 40 }, (_, i) => `J${i}`);
    session.record(ids.map(id => ({ id, before: job(cut), after: job({ ...cut, qty: 5n }) })), "typed", "Edit many jobs");
    await session.apply();
    expect(session.readIdsAt("r1")).toEqual([]);
    const read: string[] = [];
    for (let batch = 0; batch < 5; batch++) {
        const loaded = new Set(session.readIdsAt("r2"));
        expect(loaded.size).toBe(8);
        read.push(...loaded);
        expect(session.reconcile(variant("revision", "r2"), id => loaded.has(id) ? some({ ...cut, qty: 5n }) : undefined)).toBe(batch === 4);
        if (batch < 4) expect(session.pending).toBe(40);
        // Only this batch is resident. The next call cannot read it again.
    }
    expect(read).toEqual(ids);
    expect(session.status).toBe("idle");
    expect(session.pending).toBe(0);
    session.undo();
    expect(session.pending).toBe(40);
});

test("partial conflict naming restarts on a new revision and preserves every draft", async () => {
    const session = conflicting([recordIssue, said("J1"), said("J2")]);
    await session.apply();
    expect(session.nameConflicts(variant("revision", "r2"), id => id === "J1" ? some({ ...cut, qty: 9n }) : undefined)).toBe(false);
    expect(session.readIdsAt("r2")).toEqual(["J2"]);
    expect(session.readIdsAt("r3")).toEqual(["J1", "J2"]);
    expect(session.nameConflicts(variant("revision", "r3"), id => id === "J2" ? none : undefined)).toBe(false);
    expect(session.readIdsAt("r3")).toEqual(["J1"]);
    expect(session.nameConflicts(variant("revision", "r3"), id => id === "J1" ? some(cut) : undefined)).toBe(true);
    expect(session.issues).toEqual([said("J2")]);
    expect(session.pending).toBe(2);
});

test("drafts carried over after a Save refused for a conflict keep what the source said of each entry, for the conflicts there (#1199)", async () => {
    const session = conflicting([recordIssue, said("J1"), said("J2")]);
    await session.apply();
    // The source moves on: another write set J1's quantity; J2 stands as its edit began.
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : some(band)))).toBe("merged");
    expect([session.status, session.issues, session.unsettled]).toEqual(["idle", [], 1]);
    const conflict = session.conflicts.get("J1")!;
    expect(conflict.said).toBe(said("J1").message);
    // Chosen, it keeps them; undone, the conflict says them again.
    expect(session.settle("J1", conflict.points[0]!.path, "draft")).toBe(true);
    expect(session.settled.map((settled) => [settled.id, settled.said])).toEqual([["J1", said("J1").message]]);
    session.undo();
    expect(session.conflicts.get("J1")!.said).toBe(said("J1").message);
});

test("drafts carried over with no refused Save before them hold nothing the source said", () => {
    const session = conflicting([]);
    session.observeBase(variant("revision", "r2"));
    session.merge(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : some(band)));
    expect(session.conflicts.get("J1")!.said).toBeUndefined();
});

// ── Drafts carried over a source that moved (#1438) ─────────────────────────

const Bench = StructType({ name: StringType, jobs: DictType(StringType, IntegerType) });
const BenchDraft = Editing.Types.Draft(Bench);
type BenchValue = ValueTypeOf<typeof Bench>;
/** A bench whose jobs are each one's hours. */
const benchOf = (jobs: [string, bigint][]): BenchValue => ({ name: "Bench 1", jobs: new SortedMap(jobs, compareFor(StringType)) });
const benchVersion = (value: BenchValue): EntryVersion<Bar> => ({ draft: liftDraft(BenchDraft, value), wire: { key: "B1", caption: "" }, place: keyOrder });
const sameBenchDraft = equalFor(BenchDraft);
/** A version's draft, as the session holds a bench's: its fields' drafts. */
const benchDraftOf = (version: EntryVersion<Bar> | undefined) => version?.draft as ValueTypeOf<typeof BenchDraft>;
/** A keyed session over the benches at revision r1, one job moved off bench B1 and drafted. */
const movedOff = () => {
    const session = new EditSession<Bar>({
        sourceId: "benches", entryType: Bench, draftType: BenchDraft, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: some("r3") }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record([{ id: "B1", before: benchVersion(benchOf([["j1", 1n], ["j2", 2n]])), after: benchVersion(benchOf([["j2", 2n]])) }], "typed", "Move j1 off");
    // Another write moves the source on.
    session.observeBase(variant("revision", "r2"));
    return session;
};

test("drafts carried over a source that moved, where each change still applies: another write's change of another job stands beside them (#1438)", () => {
    const session = movedOff();
    expect([session.carrying, session.stale]).toEqual([true, false]);
    // While the bench is read at the new revision, nothing moves.
    expect(session.merge(variant("revision", "r2"), () => undefined)).toBe("waiting");
    expect([session.carrying, session.stale]).toEqual([true, false]);
    // Another write changed j2's hours: the move of j1 still applies.
    const now = benchOf([["j1", 1n], ["j2", 5n]]);
    expect(session.merge(variant("revision", "r2"), () => some(now))).toBe("merged");
    expect([session.carrying, session.stale, session.writable, session.pending]).toEqual([false, false, true, 1]);
    expect(sameBenchDraft(benchDraftOf(session.originals.get("B1")), benchDraftOf(benchVersion(now)))).toBe(true);
    expect(sameBenchDraft(benchDraftOf(session.entries.get("B1")), benchDraftOf(benchVersion(benchOf([["j2", 5n]]))))).toBe(true);
    // The history starts over at the drafts: an undo would take the bench back to its version at the old revision.
    expect(session.canUndo).toBe(false);
});

/** The bench as another write left it at r2: j1's hours changed, where the draft moved j1 off. */
const changedJ1 = () => some(benchOf([["j1", 3n], ["j2", 2n]]));

test("a part another write changed differently is a conflict: the draft carried over keeps its value there, and Save waits for it", () => {
    const session = movedOff();
    expect(session.merge(variant("revision", "r2"), changedJ1)).toBe("merged");
    expect([session.carrying, session.writable, session.unsettled, session.canApply]).toEqual([false, true, 1, false]);
    expect(session.conflicts.get("B1")!.points.map((point) => point.kind)).toEqual(["changed"]);
    expect(sameBenchDraft(benchDraftOf(session.entries.get("B1")), benchDraftOf(benchVersion(benchOf([["j2", 2n]]))))).toBe(true);
});

test("settling a conflict for the source's value writes it into the draft; Undo brings the conflict back, Redo settles it again", () => {
    const session = movedOff();
    session.merge(variant("revision", "r2"), changedJ1);
    const [point] = session.conflicts.get("B1")!.points;
    expect(session.settle("B1", point!.path, "source")).toBe(true);
    // The draft is the source's value now: nothing pending, nothing to settle.
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
    session.undo();
    expect([session.unsettled, session.pending]).toEqual([1, 1]);
    session.redo();
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
});

test("keeping the draft's value settles the conflict: Save sends the draft's change against the source's newer value", () => {
    const session = movedOff();
    session.merge(variant("revision", "r2"), changedJ1);
    const [point] = session.conflicts.get("B1")!.points;
    expect(session.settle("B1", point!.path, "draft")).toBe(true);
    expect([session.unsettled, session.canApply]).toEqual([0, true]);
    const drafted = session.drafts.entries.get("B1")!;
    expect((equalFor(OptionType(Bench)) as (a: unknown, b: unknown) => boolean)(drafted.before, changedJ1())).toBe(true);
    expect(sameBenchDraft(benchDraftOf(drafted.draft), benchDraftOf(benchVersion(benchOf([["j2", 2n]]))))).toBe(true);
    session.undo();
    expect([session.unsettled, session.canApply]).toEqual([1, false]);
});

test("another write to another part, while a conflict stands, is carried over beside it and is no new conflict", () => {
    const session = movedOff();
    session.merge(variant("revision", "r2"), changedJ1);
    session.observeBase(variant("revision", "r3"));
    expect([session.carrying, session.stale]).toEqual([true, false]);
    expect(session.merge(variant("revision", "r3"), () => some({ ...benchOf([["j1", 3n], ["j2", 2n]]), name: "Bench one" }))).toBe("merged");
    expect(session.unsettled).toBe(1);
    expect(sameBenchDraft(benchDraftOf(session.entries.get("B1")), benchDraftOf(benchVersion({ ...benchOf([["j2", 2n]]), name: "Bench one" })))).toBe(true);
});

test("settling every conflict one way is one step of the history", () => {
    const session = new EditSession<Bar>({
        sourceId: "benches", entryType: Bench, draftType: BenchDraft, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: some("r3") }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record([
        { id: "B1", before: benchVersion(benchOf([["j1", 1n]])), after: benchVersion(benchOf([["j1", 4n]])) },
        { id: "B2", before: benchVersion(benchOf([["k1", 1n]])), after: benchVersion(benchOf([["k1", 4n]])) },
    ], "typed", "Change both");
    session.observeBase(variant("revision", "r2"));
    session.merge(variant("revision", "r2"), (id) => some(id === "B1" ? benchOf([["j1", 2n]]) : benchOf([["k1", 2n]])));
    expect(session.unsettled).toBe(2);
    expect(session.settleAll("draft")).toBe(true);
    expect([session.unsettled, session.canApply]).toEqual([0, true]);
    session.undo();
    expect(session.unsettled).toBe(2);
});

test("an inline source that moved under the drafts carries them over at once: a change apart combines, one of the same field conflicts", () => {
    const apart = create();
    apart.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    apart.observeBase(variant("snapshot", [{ ...a, start: 2n }]));
    expect([apart.carrying, apart.unsettled, apart.canApply]).toEqual([false, 0, true]);
    expect(apart.entries.get("a")!.draft).toEqual(liftDraft(Draft, { ...a, start: 2n, end: 5n }));
    const clash = create();
    clash.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    clash.observeBase(variant("snapshot", [{ ...a, end: 4n }]));
    expect([clash.carrying, clash.unsettled, clash.canApply]).toEqual([false, 1, false]);
});
