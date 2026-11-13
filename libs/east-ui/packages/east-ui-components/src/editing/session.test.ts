/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The editing session is every collection's (#879): it carries whatever
 * projection a collection draws an entry with — here a bar, not a sheet's
 * wire row — and records the collections' own gestures under their origins.
 * An Apply retires its drafts once the source reads back as it left them
 * (#1185): a positional snapshot whole — or, beside another write's, by the
 * batch's own entries where it placed them — a keyed one by the batch's own
 * entries, and at a revision the entries read there; for a host whose rows are
 * read apart from that confirmation, it holds what it landed until they read it.
 * Its complete edits are handed to a source's draft form as the batch a Save of
 * them sends, and nothing is sent (#1620).
 */

import { expect, test } from "vitest";
import {
    ArrayType, DictType, IntegerType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, variant,
    type ValueTypeOf, type option,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { editingMessages } from "./messages.js";
import { madeFromKeys, randomKeys, type EntryKeys } from "./keys.js";
import { EditSession, type EditSessionBinding, type EntryVersion, type HeldRows, type Origin, type Placement, type ToDraftResult } from "./session.js";

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
        sourceId: "bars", entryType: Run, draftType: Draft, idField: "id",
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

test("gestures that join the last under one key are one step: one Undo takes them all back, a step joined back to where it began goes, and another key — or a step undone — starts a step of its own (SH10.1)", () => {
    const session = create();
    const resize = (from: bigint, to: bigint, joins?: string) =>
        session.record([{ id: "a", before: version({ ...a, end: from }), after: version({ ...a, end: to }) }], "typed", `Set end ${to}`, joins);
    // A phone's cell editor: three edits of one cell while it stays open.
    expect([resize(3n, 4n, "edit:1"), resize(4n, 5n, "edit:1"), resize(5n, 6n, "edit:1")]).toEqual([true, true, true]);
    expect(session.depth).toEqual({ undo: 1, redo: 0 });
    session.undo();
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–3" });
    session.redo();
    expect(session.entries.get("a")!.wire).toEqual({ key: "a", caption: "1–6" });
    // Another editor opened: a step of its own; one joined back to where it began goes.
    resize(6n, 7n, "edit:2");
    resize(7n, 6n, "edit:2");
    expect(session.depth).toEqual({ undo: 1, redo: 0 });
    // A step undone is joined by nothing: what follows it is a step of its own.
    resize(6n, 8n, "edit:3");
    session.undo();
    resize(6n, 9n, "edit:3");
    expect(session.depth).toEqual({ undo: 2, redo: 0 });
    // No key: every gesture its own step.
    resize(9n, 10n);
    resize(10n, 11n);
    expect(session.depth).toEqual({ undo: 4, redo: 0 });
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
        sourceId: "tiles", entryType: Tile, draftType: TileDraft, idField: "id", patch: undefined, refresh: undefined,
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
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
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
    // Its read there still on its way: nothing to judge yet.
    expect(session.reconcile(variant("revision", "r2"), () => undefined)).toBe(false);
    expect(session.reconcile(variant("revision", "r2"), () => some({ task: "Panel cutting, oak", qty: 5n }))).toBe(true);
    expect(session.entries.size).toBe(0);
});

test("the revision a source answers a Save with is at or after its commit — a source that took the request before answers with the one it is at now — so an entry read there as its edit began was put back by another write: acknowledged so, never waited on for good", async () => {
    // e3 answers a request it remembers with the state the record holds as it answers: a Save that had landed with no
    // answer, asked again after another session put its row back as it was, reads there as its edit began. Waited on
    // for a read that shows the Save, the session stayed saving for good: no later revision would ever show it.
    const session = keyed("r1");
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await session.apply();
    expect(session.reconcile(variant("revision", "r2"), () => some(cut))).toBe(true);
    // The source's value is the row's now, nothing of it left to save, and the session takes gestures and Saves again.
    expect([session.status, session.locked, session.entries.size, session.pending]).toEqual(["idle", false, 0, 0]);

    // A row the Save added, removed again by another write: the same.
    const added = keyed("r1");
    added.record([{ id: "J4", before: absentJob, after: job(spray) }], "typed", "Add a job");
    await added.apply();
    expect(added.reconcile(variant("revision", "r2"), () => none)).toBe(true);
    expect([added.status, added.entries.size, added.pending]).toEqual(["idle", 0, 0]);

    // And a row it removed, put back as it was.
    const removed = keyed("r1");
    removed.record([{ id: "J2", before: job(band), after: absentJob }], "typed", "Remove a job");
    await removed.apply();
    expect(removed.reconcile(variant("revision", "r2"), () => some(band))).toBe(true);
    expect([removed.status, removed.entries.size, removed.pending]).toEqual(["idle", 0, 0]);
});

test("a revision names content: a source put back exactly as it was reads at the revision a Save was drafted at — answered with that very revision, or read there once it has read at the one it answered with, the Save is acknowledged with every row as it began; a source still at that revision with neither is one that has yet to move", async () => {
    // An e3 record's revision is its state's hash: its rows put back exactly, it is at the revision it was at before.
    // A source that took the request before answers with the revision it is at — here, the one the Save was drafted at.
    const answered = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
        apply: () => variant("applied", { revision: some("r1") }), patch: undefined, refresh: undefined, drawsLanded: true,
    });
    answered.observeBase(variant("revision", "r1"));
    answered.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await answered.apply();
    // Its entries are read there: the revision holds the request, each change put back since.
    expect(answered.readIdsAt("r1")).toEqual(["J1"]);
    expect(answered.reconcile(variant("revision", "r1"), () => some(cut))).toBe(true);
    // Nothing of it is left: no draft, no Save out, and no landed row for its host to draw over rows it reads as they are.
    expect([answered.status, answered.locked, answered.entries.size, answered.pending, answered.landed.size]).toEqual(["idle", false, 0, 0, 0]);

    // Answered with the revision its commit made, read there before its rows landed — then the source is at the
    // revision the Save was drafted at again: another write put the row back.
    const moved = keyed("r1");
    moved.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await moved.apply();
    expect(moved.reconcile(variant("revision", "r2"), () => undefined)).toBe(false);
    expect(moved.readIdsAt("r1")).toEqual(["J1"]);
    expect(moved.reconcile(variant("revision", "r1"), () => some(cut))).toBe(true);
    expect([moved.status, moved.entries.size, moved.pending]).toEqual(["idle", 0, 0]);

    // A source still at the revision the Save was drafted at, never having read at the one it answered with, has yet
    // to move: nothing of the Save is there to read, and it waits.
    const waiting = keyed("r1");
    waiting.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await waiting.apply();
    expect(waiting.readIdsAt("r1")).toEqual([]);
    expect(waiting.reconcile(variant("revision", "r1"), () => some(cut))).toBe(false);
    expect(waiting.status).toBe("reconciling");
});

test("two Saves at once: one reads its own back at the later revision the other made — its change beside the other's, or changed again since, is acknowledged; still as its edit began, it waits", async () => {
    const saved = async () => {
        const session = keyed("r1");
        session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
        await session.apply();
        return session;
    };
    // Its change beside another write's, read at r3: never at r1, where it was drafted.
    const beside = await saved();
    expect([beside.readIdsAt("r1"), beside.readIdsAt("r3")]).toEqual([[], ["J1"]]);
    expect(beside.reconcile(variant("revision", "r1"), () => some({ ...cut, qty: 5n }))).toBe(false);
    expect(beside.reconcile(variant("revision", "r3"), () => some({ task: "Panel cutting, maple", qty: 5n }))).toBe(true);
    expect([beside.status, beside.entries.size]).toEqual(["idle", 0]);
    // Its quantity changed again by another write since: acknowledged, the newer value the source's.
    const again = await saved();
    expect(again.reconcile(variant("revision", "r3"), () => some({ ...cut, qty: 9n }))).toBe(true);
    expect([again.status, again.entries.size, again.pending]).toEqual(["idle", 0, 0]);
    // Still as its edit began — read before the commit landed: a later read judges it.
    const early = await saved();
    expect(early.reconcile(variant("revision", "r3"), () => some(cut))).toBe(false);
    expect(early.status).toBe("reconciling");
    expect(early.reconcile(variant("revision", "r4"), () => some({ ...cut, qty: 5n }))).toBe(true);
});

test("a Save's answer over a source that has moved on since it was drafted installs no revision: the source is asked to follow its state, and the Save is read back once its host says it has read since the answer — and that word is taken where the revision asked for was never installed, the session not told", async () => {
    const asked: string[] = [];
    let reads = "r1";
    const saved = async () => {
        const session = new EditSession<Bar>({
            sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined,
            apply: () => variant("applied", { revision: some("r2") }),
            refresh: (revision) => { asked.push(revision.type === "some" ? revision.value : "follow"); },
            // Its host says when the source has read since an answer: where it reads now.
            reads: () => some(reads),
        });
        session.observeBase(variant("revision", "r1"));
        session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
        asked.length = 0;
        await session.apply();
        return session;
    };
    // Still where the Save was drafted as its answer comes: the revision it committed is installed.
    await saved();
    expect(asked).toEqual(["r2"]);

    // Moved on meanwhile — it heard of r3, another write's: asked to follow, never put back at r2.
    reads = "r3";
    const late = await saved();
    expect(asked).toEqual(["follow"]);
    // At r3 its row reads as its edit began, which says nothing until its host has read since the answer: read before
    // the Save landed, or put back by that other write. Once it has, the row was put back: acknowledged so.
    expect(late.reconcile(variant("revision", "r3"), () => some(cut), { value: undefined })).toBe(false);
    expect(late.status).toBe("reconciling");
    expect(late.reconcile(variant("revision", "r3"), () => some(cut), { value: "r3" })).toBe(true);
    expect([late.status, late.entries.size, late.pending]).toEqual(["idle", 0, 0]);

    // Found where the Save was drafted, and asked for r2 — which its host installed no more, the source moved in the
    // very turn it was asked. The session is not told, and reads at r3 with its row as its edit began: left to a read
    // at r2, which never comes, it stayed saving for good. Its host's word settles it all the same.
    reads = "r1";
    const declined = await saved();
    expect(asked).toEqual(["r2"]);
    expect(declined.reconcile(variant("revision", "r3"), () => some(cut), { value: undefined })).toBe(false);
    expect(declined.status).toBe("reconciling");
    expect(declined.reconcile(variant("revision", "r3"), () => some(cut), { value: "r3" })).toBe(true);
    expect([declined.status, declined.entries.size, declined.pending]).toEqual(["idle", 0, 0]);

    // A row changed again by another write since reads as neither side: asked to follow, that too waits for its host's
    // word — a source that follows may still read at a revision from before the Save.
    reads = "r3";
    const again = await saved();
    expect(again.reconcile(variant("revision", "r3"), () => some({ ...cut, qty: 9n }), { value: undefined })).toBe(false);
    expect(again.reconcile(variant("revision", "r3"), () => some({ ...cut, qty: 9n }), { value: "r3" })).toBe(true);
    expect([again.status, again.entries.size, again.pending]).toEqual(["idle", 0, 0]);
});

test("a source asked to follow its state whose host says nothing of when it read any more has the Save's revision installed after all, and the Save is read back there", async () => {
    const asked: string[] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined,
        apply: () => variant("applied", { revision: some("r2") }),
        refresh: (revision) => { asked.push(revision.type === "some" ? revision.value : "follow"); },
        reads: () => some("r3"),
    });
    session.observeBase(variant("revision", "r1"));
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await session.apply();
    expect(asked).toEqual(["follow"]);
    // No word from its host: left to follow, a row not as the Save left it would wait on a word that never comes.
    expect(session.reconcile(variant("revision", "r3"), () => some(cut))).toBe(false);
    expect(asked).toEqual(["follow", "r2"]);
    // Asked again by a Retry, it is the revision still: its host is asked nothing more.
    session.refresh();
    expect(asked).toEqual(["follow", "r2", "r2"]);
    // Read at the revision the Save committed, and then where another write put the row back.
    expect(session.reconcile(variant("revision", "r2"), () => undefined)).toBe(false);
    expect(session.reconcile(variant("revision", "r3"), () => some(cut))).toBe(true);
    expect([session.status, session.entries.size, session.pending]).toEqual(["idle", 0, 0]);
});

test("a positional snapshot confirms once its whole collection reads back as the commit left it, and the history stands", async () => {
    const session = create();
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    await session.apply();
    // The collection as the edit began: nothing of the commit in it yet.
    expect(session.reconcile(variant("snapshot", [a]), () => undefined)).toBe(false);
    expect(session.reconcile(variant("snapshot", [{ ...a, end: 5n }]), () => undefined)).toBe(true);
    expect([session.status, session.pending, session.canUndo]).toEqual(["idle", 0, true]);
});

test("two Saves at once over a positional snapshot: beside another write's — another field of its entry, another entry — it confirms by its own entries, and its versions go; another write's alone, it waits", async () => {
    const b: RunValue = { id: "b", start: 4n, end: 6n };
    const saved = async () => {
        const session = create();
        session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
        await session.apply();
        return session;
    };
    // Another write's start of the same entry, landed before the commit: nothing of the commit in it yet.
    const field = await saved();
    expect(field.reconcile(variant("snapshot", [{ ...a, start: 2n }]), () => undefined)).toBe(false);
    expect(field.status).toBe("reconciling");
    // The commit, the other write's start beside it: the collection is the source's, and the session's versions go with their history.
    expect(field.reconcile(variant("snapshot", [{ ...a, start: 2n, end: 5n }]), () => undefined)).toBe(true);
    expect([field.status, field.pending, field.entries.size, field.canUndo]).toEqual(["idle", 0, 0, false]);
    // The commit, and another write's entry beside it.
    const entry = await saved();
    expect(entry.reconcile(variant("snapshot", [{ ...a, end: 5n }, b]), () => undefined)).toBe(true);
    expect([entry.status, entry.pending, entry.entries.size]).toEqual(["idle", 0, 0]);
});

test("a keyed snapshot whose commit another write overtook — the same part changed again, or the entry removed, before the record was read — confirms with the newer value, never waiting for good (#1599)", async () => {
    const saved = async () => {
        const session = keyed();
        session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
        await session.apply();
        expect(session.status).toBe("reconciling");
        return session;
    };
    // Another write set the same quantity after the commit landed: neither as the edit began nor as the commit left it.
    const again = await saved();
    expect(again.reconcile(variant("snapshot", jobs([["J1", { ...cut, qty: 9n }], ["J2", band], ["J3", route]])), () => undefined)).toBe(true);
    expect([again.status, again.locked, again.pending, again.entries.size]).toEqual(["idle", false, 0, 0]);
    // Another write removed the entry after the commit landed.
    const gone = await saved();
    expect(gone.reconcile(variant("snapshot", jobs([["J2", band], ["J3", route]])), () => undefined)).toBe(true);
    expect([gone.status, gone.locked, gone.pending]).toEqual(["idle", false, 0]);
    // Still as the edit began — another write's task beside it, landed first: nothing of the commit in it yet.
    const early = await saved();
    expect(early.reconcile(variant("snapshot", jobs([["J1", { ...cut, task: "Panel cutting, maple" }], ["J2", band], ["J3", route]])), () => undefined)).toBe(false);
    expect(early.status).toBe("reconciling");
});

test("one commit lands whole: an entry that reads as the commit left it says the rest landed too, so one another write has since put back as it was is the record's — never waited on (#1599)", async () => {
    const session = keyed();
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J2", before: job(band), after: job({ ...band, qty: 8n }) },
    ], "typed", "Set quantities");
    await session.apply();
    // J1 as the commit left it; J2 back at 4, as its edit began: put back by another write since.
    expect(session.reconcile(variant("snapshot", jobs([["J1", { ...cut, qty: 5n }], ["J2", band], ["J3", route]])), () => undefined)).toBe(true);
    expect([session.status, session.locked, session.pending, session.entries.size]).toEqual(["idle", false, 0, 0]);
});

// ── A source read whole whose host says what it holds (#1599) ───────────────

/** A keyed session over the jobs, read whole, its quantity for J1 saved and answered. */
const savedQuantity = async () => {
    const session = keyed();
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await session.apply();
    expect(session.status).toBe("reconciling");
    return session;
};
/** The jobs as the edit began. */
const began = () => jobs([["J1", cut], ["J2", band], ["J3", route]]);

test("a Save whose every part another write put back exactly is read back at the collection its host says the source holds, read since the Save was answered — never waited on for good (#1599)", async () => {
    const session = await savedQuantity();
    // The collection as the edit began, its host still to read the source since the answer: read before the Save, for all it says.
    expect(session.reconcile(variant("snapshot", began()), () => undefined, { value: undefined })).toBe(false);
    expect([session.status, session.locked]).toEqual(["reconciling", true]);
    // Read since: the source holds the row as it was — the Save landed, and another write put its quantity back.
    expect(session.reconcile(variant("snapshot", began()), () => undefined, { value: began() })).toBe(true);
    expect([session.status, session.locked, session.pending, session.entries.size]).toEqual(["idle", false, 0, 0]);
    // The row is the source's: nothing left to save, and no step to take back over it.
    expect([session.canApply, session.canUndo]).toEqual([false, false]);
});

test("where its host says what the source holds, a collection that is not that one confirms only by holding the Save's every entry as it was left — one from before the Save never does, whatever its host holds (#1599)", async () => {
    // The page still draws the collection from before the Save, while its host holds the one the Save left: the page's next.
    const lagging = await savedQuantity();
    const left = jobs([["J1", { ...cut, qty: 5n }], ["J2", band], ["J3", route]]);
    expect(lagging.reconcile(variant("snapshot", began()), () => undefined, { value: left })).toBe(false);
    expect(lagging.status).toBe("reconciling");
    expect(lagging.reconcile(variant("snapshot", left), () => undefined, { value: left })).toBe(true);
    expect([lagging.status, lagging.pending, lagging.canUndo]).toEqual(["idle", 0, true]);
    // The Save's every entry as it was left: read after the Save, whenever its host says so.
    const certain = await savedQuantity();
    expect(certain.reconcile(variant("snapshot", left), () => undefined, { value: undefined })).toBe(true);
    expect([certain.status, certain.pending]).toEqual(["idle", 0]);
    // The same part changed again by another write: read after the Save for all a host that cannot say knows — but
    // where its host can, read back at the collection it says, once it has read the source since.
    const again = await savedQuantity();
    const overtaken = jobs([["J1", { ...cut, qty: 9n }], ["J2", band], ["J3", route]]);
    expect(again.reconcile(variant("snapshot", overtaken), () => undefined, { value: undefined })).toBe(false);
    expect(again.reconcile(variant("snapshot", overtaken), () => undefined, { value: overtaken })).toBe(true);
    expect([again.status, again.locked, again.pending, again.entries.size]).toEqual(["idle", false, 0, 0]);
});

test("a host that cannot say leaves a Save to what the collection's entries show: every part put back exactly, it waits (#1599)", async () => {
    const session = await savedQuantity();
    expect(session.reconcile(variant("snapshot", began()), () => undefined)).toBe(false);
    expect(session.reconcile(variant("snapshot", began()), () => undefined, undefined)).toBe(false);
    expect([session.status, session.locked]).toEqual(["reconciling", true]);
});

test("a change made while a Save was read back stands over the row as another write put it back: the next Save's, from what the source holds (#1599)", async () => {
    const batches: ValueTypeOf<typeof JobBatch>[] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined, refresh: undefined,
        apply: (bytes) => { batches.push(decodeBeast2For(JobBatch)(bytes)); return variant("applied", { revision: some("r2") }); },
    });
    session.observeBase(variant("snapshot", began()));
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await session.apply();
    // While it is read back: the task set here, over the row as the Save left it.
    session.record([{ id: "J1", before: job({ ...cut, qty: 5n }), after: job({ task: "Panel cutting, maple", qty: 5n }) }], "typed", "Set task");
    // The quantity put back by another write before the source was read again.
    expect(session.reconcile(variant("snapshot", began()), () => undefined, { value: began() })).toBe(true);
    expect([session.status, session.pending, session.unsettled]).toEqual(["idle", 1, 0]);
    expect((equalFor(OptionType(JobDraft)) as (a: unknown, b: unknown) => boolean)(
        some(session.entries.get("J1")!.draft), some(liftDraft(JobDraft, { task: "Panel cutting, maple", qty: 2n })))).toBe(true);
    // Its Save sends the task alone, from the row the source holds.
    await session.apply();
    expect(batches).toHaveLength(2);
    expect(session.reconcile(variant("snapshot", jobs([["J1", { task: "Panel cutting, maple", qty: 2n }], ["J2", band], ["J3", route]])), () => undefined, { value: undefined })).toBe(true);
    expect([session.status, session.pending]).toEqual(["idle", 0]);
});

test("a positional snapshot put back exactly is read back at the collection its host says the source holds (#1599)", async () => {
    const session = create();
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    await session.apply();
    expect(session.reconcile(variant("snapshot", [a]), () => undefined, { value: undefined })).toBe(false);
    expect(session.reconcile(variant("snapshot", [a]), () => undefined, { value: [a] })).toBe(true);
    expect([session.status, session.locked, session.pending, session.entries.size]).toEqual(["idle", false, 0, 0]);
});

test("a draft first made while a Save was read back, from a row another write has since changed, is carried over to the collection the Save is confirmed at: a conflict to choose, never a Save refused with nothing newer to move to (#1599)", async () => {
    const batches: ValueTypeOf<typeof JobBatch>[] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined, refresh: undefined,
        apply: (bytes) => { batches.push(decodeBeast2For(JobBatch)(bytes)); return variant("applied", { revision: some("r2") }); },
    });
    session.observeBase(variant("snapshot", jobs([["J1", cut], ["J2", band], ["J3", route]])));
    session.record([{ id: "J4", before: absentJob, after: job(spray) }], "typed", "Add a job");
    await session.apply();
    // While it is read back: J1's quantity set here, from the row as the page showed it.
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    // The commit, and another write's quantity for J1 beside it: the draft of J1 began from a row the record no longer holds.
    const now = variant("snapshot", jobs([["J1", { ...cut, qty: 9n }], ["J2", band], ["J3", route], ["J4", spray]]));
    expect(session.reconcile(now, () => undefined)).toBe(true);
    expect([session.status, session.pending, session.unsettled]).toEqual(["idle", 1, 1]);
    // Kept as drafted, it is the next Save's: a change of the record's 9, which the record takes.
    const [conflict] = [...session.conflicts.values()];
    expect(session.settle("J1", conflict!.points[0]!.path, "draft")).toBe(true);
    expect(session.canApply).toBe(true);
    await session.apply();
    expect(batches).toHaveLength(2);
    expect(session.status).toBe("reconciling");
    expect(session.reconcile(variant("snapshot", jobs([["J1", { ...cut, qty: 5n }], ["J2", band], ["J3", route], ["J4", spray]])), () => undefined)).toBe(true);
    expect([session.status, session.pending]).toEqual(["idle", 0]);
});

test("a gesture begins from the row its person is looking at: the session's own version, else what its last Save left while the host has yet to show it, else the row the host shows (#1599)", async () => {
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined, drawsLanded: true,
        apply: () => variant("applied", { revision: some("r2") }), refresh: () => undefined,
    });
    session.observeBase(variant("revision", "r1"));
    /** Whether a version holds a job. */
    const holds = (version: EntryVersion<Bar> | undefined, value: JobValue) =>
        version !== undefined && (equalFor(OptionType(JobDraft)) as (a: unknown, b: unknown) => boolean)(some(version.draft), some(liftDraft(JobDraft, value)));
    // Nothing of J1 held: the row the host shows — or none, where it shows none.
    const shown = job(cut);
    expect(session.startOf("J1", () => shown)).toBe(shown);
    expect(session.startOf("J1", () => undefined)).toBeUndefined();
    // Drafted: the session's own version, whatever the host shows.
    session.record([{ id: "J1", before: shown, after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    expect(holds(session.startOf("J1", () => shown), { ...cut, qty: 5n })).toBe(true);
    // Saved, and read back beside another write's task: the session holds no version of it any more, and the host's rows
    // are still from before the commit — what the Save left, as the source holds it, never the row as it stood.
    await session.apply();
    const landed = { task: "Panel cutting, maple", qty: 5n };
    expect(session.reconcile(variant("revision", "r2"), () => some(landed))).toBe(true);
    expect(session.entries.has("J1")).toBe(false);
    expect(holds(session.startOf("J1", () => shown), landed)).toBe(true);
    // The host's rows read again, and said so: the row it shows.
    session.shown(["J1"]);
    const read = job(landed);
    expect(session.startOf("J1", () => read)).toBe(read);
});

test("a positional snapshot whose commit another write overtook — the same part changed again, or the entry removed — confirms with the newer value, never waiting for good (#1599)", async () => {
    const saved = async () => {
        const session = create();
        session.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
        await session.apply();
        return session;
    };
    const again = await saved();
    expect(again.reconcile(variant("snapshot", [{ ...a, end: 9n }]), () => undefined)).toBe(true);
    expect([again.status, again.locked, again.pending, again.entries.size]).toEqual(["idle", false, 0, 0]);
    const gone = await saved();
    expect(gone.reconcile(variant("snapshot", []), () => undefined)).toBe(true);
    expect([gone.status, gone.locked, gone.pending]).toEqual(["idle", false, 0]);
});

test("a move alone over a positional snapshot confirms once its entry stands where the commit placed it, beside another write's entry; as the edit began, it waits", async () => {
    const b: RunValue = { id: "b", start: 4n, end: 6n };
    const c: RunValue = { id: "c", start: 7n, end: 8n };
    const session = create();
    session.observeBase(variant("snapshot", [a, b]));
    const placed = (place: Placement): EntryVersion<Bar> => ({ ...version(a), place });
    session.record([{ id: "a", before: placed(some(variant("ordered", variant("before", "b")))), after: placed(some(variant("ordered", variant("after", "b")))) }], "move", "Move a");
    await session.apply();
    expect(session.status).toBe("reconciling");
    // Its value is not the change, its place is: as the edit began, a stands before b.
    expect(session.reconcile(variant("snapshot", [a, b]), () => undefined)).toBe(false);
    expect(session.reconcile(variant("snapshot", [c, b, a]), () => undefined)).toBe(true);
    expect([session.status, session.pending]).toEqual(["idle", 0]);
});

test("an entry the record still holds as its edit began never confirms, though the change, undone, would apply to it — a line taken out of an order's lines (#1185)", async () => {
    const Order = StructType({ name: StringType, ops: ArrayType(StringType) });
    const OrderDraft = Editing.Types.Draft(Order);
    const order = (ops: string[]): EntryVersion<Bar> => ({ draft: liftDraft(OrderDraft, { name: "WO-1", ops }), wire: { key: "WO-1", caption: ops.join(" · ") }, place: keyOrder });
    const orders = (ops: string[]) => new SortedMap([["WO-1", { name: "WO-1", ops }]], compareFor(StringType));
    const session = new EditSession<Bar>({
        sourceId: "orders", entryType: Order, draftType: OrderDraft, keyType: StringType,
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
        sourceId: "bars", entryType: Run, draftType: Draft, idField: "id",
        apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record([{ id: "a", before: version(a), after: { ...version(a), place: moved } }], "move", "Move a");
    await session.apply();
    expect(session.status).toBe("reconciling");
    expect(session.reconcile(variant("revision", "r2"), () => some(a))).toBe(true);
    expect(session.status).toBe("idle");
});

// ── What a Save landed, for rows read apart from its confirmation ─────────────

/** A keyed session over the jobs at revision r1, for a host that draws what a Save landed over rows read before it. */
const drawing = (overrides: Partial<EditSessionBinding<Bar>> = {}) => {
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, drawsLanded: true,
        apply: () => variant("applied", { revision: some("r2") }), patch: undefined, refresh: undefined, ...overrides,
    });
    session.observeBase(variant("revision", "r1"));
    return session;
};

test("a Save confirmed at a revision holds what it landed for a host that draws it — each entry as it began and as it was saved, and the revision it was drafted at — until the host's rows show each", async () => {
    const session = drawing();
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J4", before: absentJob, after: job(spray) },
        { id: "J2", before: job(band), after: absentJob },
    ], "typed", "Edit jobs");
    await session.apply();
    // Nothing is held before the source reads back as the Save left it.
    expect(session.reconcile(variant("revision", "r2"), () => undefined)).toBe(false);
    expect(session.landed.size).toBe(0);
    expect(session.reconcile(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 5n }) : id === "J4" ? some(spray) : none))).toBe(true);
    expect([...session.landed.keys()].sort()).toEqual(["J1", "J2", "J4"]);
    expect([...session.landed.values()].every((entry) => entry.from === "r1")).toBe(true);
    // Read back as the request left it: its version is the session's, and what it began from the source's then.
    const updated = session.landed.get("J1")!;
    expect(updated.after).toBe(session.entries.get("J1"));
    expect(updated.before.wire).toEqual({ key: "Panel cutting", caption: "2" });
    expect([session.landed.get("J4")!.before.draft, session.landed.get("J2")!.after.wire]).toEqual([undefined, undefined]);
    // The host's rows read J1 and J4 again: they go, and J2 is held still.
    session.shown(["J1", "J4"]);
    expect([...session.landed.keys()]).toEqual(["J2"]);
    session.shown(["J2"]);
    expect(session.landed.size).toBe(0);
});

test("what a Save landed is held only for a host that draws it, and only at a revision: an entry read back otherwise — another write beside it, or since — is held as the source holds it", async () => {
    // A host that does not draw it holds nothing.
    const plain = keyed("r1");
    plain.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await plain.apply();
    expect(plain.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }))).toBe(true);
    expect(plain.landed.size).toBe(0);
    // An inline snapshot is the very rows its host draws: nothing is held.
    const whole = create({ drawsLanded: true });
    whole.record([{ id: "a", before: version(a), after: version({ ...a, end: 5n }) }], "resize", "Resize a");
    await whole.apply();
    expect(whole.reconcile(variant("snapshot", [{ ...a, end: 5n }]), () => undefined)).toBe(true);
    expect(whole.landed.size).toBe(0);
    // Another write renamed J1's task beside the Save, and removed J2 since: the session's versions go, and each is
    // held as the source holds it — drawn by the collection's own projection.
    const beside = drawing({ wireOf: (id) => ({ key: id, caption: "as the source holds it" }) });
    beside.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J2", before: job(band), after: job({ ...band, qty: 8n }) },
    ], "typed", "Edit jobs");
    await beside.apply();
    const oak = { task: "Panel cutting, oak", qty: 5n };
    expect(beside.reconcile(variant("revision", "r2"), (id) => (id === "J1" ? some(oak) : none))).toBe(true);
    expect(beside.entries.size).toBe(0);
    const renamed = beside.landed.get("J1")!;
    expect((equalFor(JobDraft) as (a: unknown, b: unknown) => boolean)(renamed.after.draft, liftDraft(JobDraft, oak))).toBe(true);
    expect(renamed.after.wire).toEqual({ key: "J1", caption: "as the source holds it" });
    expect(renamed.before.wire).toEqual({ key: "Panel cutting", caption: "2" });
    expect(beside.landed.get("J2")!.after).toEqual({ draft: undefined, wire: undefined, place: none });
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
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
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
    // At the revision the Save was drafted at, each entry reads as its edit began: nothing is named there, and none is carried over.
    expect(session.nameConflicts(variant("revision", "r1"), (id) => some(id === "J1" ? cut : band))).toBe(false);
    expect(session.carrying).toBe(false);
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
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
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
    // The request is unresolved: the next Save waits for it, a gesture does not.
    expect([session.locked, session.canApply, session.writable]).toEqual([true, false, true]);
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
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
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

// ── A refused Save sent again ───────────────────────────────────────────────

const JobBatch = Editing.Types.ChangeSet(Job, StringType);
type Answer = ValueTypeOf<typeof Editing.Types.ApplyResult>;
const lastConflict = (): Answer => variant("conflict", [recordIssue, said("J1")]);
/**
 * A keyed session over the jobs at revision r1, J1's and J2's quantities
 * drafted, whose Saves the source answers in turn with `answers` — refused,
 * once they run out, as another write got there first — and the revision each
 * Save it was sent was drafted at.
 */
const answering = (answers: Answer[]) => {
    const bases: string[] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
        apply: (bytes) => {
            const base = decodeBeast2For(JobBatch)(bytes).base;
            bases.push(base.type === "revision" ? base.value : "snapshot");
            return answers.shift() ?? lastConflict();
        },
        patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J2", before: job(band), after: job({ ...band, qty: 8n }) },
    ], "typed", "Edit jobs");
    return { session, bases };
};
/** The source moved to `revision`, J1's task renamed there by another write: the drafts carried over, nothing to choose. */
const renamedAt = (session: EditSession<Bar>, revision: string) => {
    session.observeBase(variant("revision", revision));
    return session.merge(variant("revision", revision), (id) => (id === "J1" ? some({ ...cut, task: `Panel cutting, ${revision}` }) : some(band)));
};
/** Lets the session's own Save run to its answer. */
const answered = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

test("a Save refused because another write got there first is sent again by itself, at the revision its drafts carried over to, once nothing is left to choose", async () => {
    const { session, bases } = answering([lastConflict(), variant("applied", { revision: some("r3") })]);
    await session.apply();
    expect([session.status, bases]).toEqual(["conflict", ["r1"]]);
    expect(renamedAt(session, "r2")).toBe("merged");
    await answered();
    // Sent again with no Save of the person's: the drafts as they carried over, at r2.
    expect([session.status, bases]).toEqual(["reconciling", ["r1", "r2"]]);
    expect(session.pending).toBe(2);
});

test("a refused Save whose drafts carry over to a part both changed waits for the person: chosen, Save is theirs to press", async () => {
    const { session, bases } = answering([lastConflict()]);
    await session.apply();
    session.observeBase(variant("revision", "r2"));
    // Another write set J1's quantity too: a conflict.
    expect(session.merge(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : some(band)))).toBe("merged");
    await answered();
    expect([session.status, session.unsettled, bases]).toEqual(["idle", 1, ["r1"]]);
    expect(session.settleAll("draft")).toBe(true);
    await answered();
    expect([session.status, session.canApply, bases]).toEqual(["idle", true, ["r1"]]);
});

test("a Save refused again and again is sent again three times in a row at most; the person's Save then sends it, and may be sent again as many times after it", async () => {
    const { session, bases } = answering([]);
    await session.apply();
    for (const revision of ["r2", "r3", "r4"]) {
        renamedAt(session, revision);
        await answered();
        expect(session.status).toBe("conflict");
    }
    expect(bases).toEqual(["r1", "r2", "r3", "r4"]);
    // The fourth carry-over sends nothing by itself.
    renamedAt(session, "r5");
    await answered();
    expect([session.status, session.canApply, bases.length]).toEqual(["idle", true, 4]);
    // The person's Save, refused, is sent again by itself.
    await session.apply();
    renamedAt(session, "r6");
    await answered();
    expect(bases).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
});

test("a refused Save carried over again before it is sent again goes once, at the revision it carried over to last; a Discard drops it", async () => {
    const twice = answering([lastConflict(), variant("applied", { revision: some("r4") })]);
    await twice.session.apply();
    // The source moves twice before the re-send runs: it goes once, from r3.
    renamedAt(twice.session, "r2");
    twice.session.observeBase(variant("revision", "r3"));
    await answered();
    expect([twice.session.carrying, twice.bases]).toEqual([true, ["r1"]]);
    twice.session.merge(variant("revision", "r3"), (id) => (id === "J1" ? some({ ...cut, task: "Panel cutting, r3" }) : some(band)));
    await answered();
    expect([twice.session.status, twice.bases]).toEqual(["reconciling", ["r1", "r3"]]);

    const dropped = answering([lastConflict()]);
    await dropped.session.apply();
    renamedAt(dropped.session, "r2");
    dropped.session.discard();
    await answered();
    expect([dropped.session.pending, dropped.bases]).toEqual([0, ["r1"]]);
});

// ── A new entry's key, the session's own (#1583) ─────────────────────────────

/** The jobs' own rule for a new key: the first `J<n>` not taken — the record holds J1 to J3. */
const jobKeys: EntryKeys = {
    make: (known) => {
        for (let n = 1; ; n++) {
            const id = `J${n}`;
            if (n > 3 && !known.has(id)) return id;
        }
    },
};
/** A session over the jobs at a revision, its Saves recorded: the first refused for another write, the rest applied. */
const adding = (overrides: Partial<EditSessionBinding<Bar>> = {}) => {
    const sent: string[][] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, keys: jobKeys,
        // Its bar is named after its key: under another key, it is another bar.
        underKey: (id, version) => ({ ...version, wire: { key: id, caption: version.wire!.caption } }),
        apply: (bytes) => {
            sent.push(decodeBeast2For(JobBatch)(bytes).changes.map((change) => change.id));
            return sent.length === 1 ? lastConflict() : variant("applied", { revision: some("r3") });
        },
        patch: undefined, refresh: undefined, ...overrides,
    });
    session.observeBase(variant("revision", "r1"));
    return { session, sent };
};
/** A job added under an id, its bar named after the id. */
const added = (session: EditSession<Bar>, id: string, value: JobValue = spray): void => {
    session.record([{ id, before: absentJob, after: { ...job(value), wire: { key: id, caption: `${value.qty}` } } }], "insert", "Insert row");
};
/** Another write added J4 before this session's own J4 was saved: the record holds theirs there now. */
const theirJ4 = (id: string) => (id === "J4" ? some(route) : none);

test("the session makes a new entry's key by its collection's rule: past every key its drafts hold and a gesture has made already — and none where the collection has no rule", () => {
    const { session } = adding();
    expect(session.mint()).toBe("J4");
    // Not taken until its entry is recorded: a gesture given up leaves the key free.
    expect(session.mint()).toBe("J4");
    added(session, "J4");
    expect(session.mint()).toBe("J5");
    // A gesture that adds several says which it has made.
    expect(session.mint(undefined, new Set(["J5", "J6"]))).toBe("J7");
    // A draft that removes an entry holds its key still: the record does, until the removal is saved.
    session.record([{ id: "J5", before: job(band), after: absentJob }], "remove", "Delete row");
    expect(session.mint()).toBe("J6");
    expect(adding({ keys: undefined }).session.mint()).toBeUndefined();
});

test("a key is made past the keys of a source the session holds whole, and from the key the entry is made from", () => {
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, keys: madeFromKeys(randomKeys()),
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", jobs([["brackets", cut], ["brackets-2", band]])));
    expect(session.mint("brackets")).toBe("brackets-3");
});

test("a new entry under a key the session made, which another write added meanwhile, goes on under the next its rule makes — a new entry still, sent again with nothing to choose; under a key it did not make, the two are a conflict (#1583)", async () => {
    const made = adding();
    added(made.session, made.session.mint()!);
    expect([...made.session.ownKeys.keys()]).toEqual(["J4"]);
    await made.session.apply();
    expect(made.session.status).toBe("conflict");
    made.session.observeBase(variant("revision", "r2"));
    expect(made.session.merge(variant("revision", "r2"), theirJ4)).toBe("merged");
    // Mine goes on as J5, new to the record still, its bar with it; theirs stands as J4, and nothing waits to be chosen.
    expect([...made.session.entries.keys()]).toEqual(["J5"]);
    expect(made.session.originals.get("J5")!.draft).toBeUndefined();
    expect(made.session.entries.get("J5")!.wire).toEqual({ key: "J5", caption: "6" });
    expect([...made.session.renumbered]).toEqual([["J4", "J5"]]);
    expect([made.session.unsettled, [...made.session.ownKeys.keys()]]).toEqual([0, ["J5"]]);
    await answered();
    // Sent again by itself: J5 added.
    expect([made.session.status, made.sent]).toEqual(["reconciling", [["J4"], ["J5"]]]);

    // A key the session did not make — a person's, or a seed's — is given no other: the two are a conflict at the entry.
    const given = adding();
    added(given.session, "J4");
    expect(given.session.ownKeys.size).toBe(0);
    await given.session.apply();
    given.session.observeBase(variant("revision", "r2"));
    expect(given.session.merge(variant("revision", "r2"), theirJ4)).toBe("merged");
    expect([...given.session.entries.keys()]).toEqual(["J4"]);
    expect([given.session.renumbered.size, given.session.unsettled]).toEqual([0, 1]);
    await answered();
    expect(given.sent).toEqual([["J4"]]);
});

test("a rule that can make no other key — it throws, or makes none — leaves the two entries a conflict, the drafts carried over all the same", () => {
    for (const failing of [() => { throw new Error("no key"); }, () => undefined]) {
        let fails = false;
        const { session } = adding({ keys: { make: (known, from, taken) => (fails ? failing() : jobKeys.make(known, from, taken)) } });
        added(session, session.mint()!);
        fails = true;
        session.observeBase(variant("revision", "r2"));
        expect(session.merge(variant("revision", "r2"), theirJ4)).toBe("merged");
        expect([[...session.entries.keys()], session.unsettled, session.renumbered.size]).toEqual([["J4"], 1, 0]);
    }
});

test("the keys a session made are its own only while its drafts add their entries: one undone, discarded or saved is its own no more", async () => {
    const { session } = adding({ apply: () => variant("applied", { revision: some("r2") }) });
    added(session, session.mint()!);
    expect([...session.ownKeys]).toEqual([["J4", undefined]]);
    session.undo();
    expect(session.ownKeys.size).toBe(0);
    session.redo();
    expect([...session.ownKeys.keys()]).toEqual(["J4"]);
    session.discard();
    expect(session.ownKeys.size).toBe(0);
    // Saved: the record's own entry, whose key is no draft's to make again.
    added(session, session.mint()!);
    await session.apply();
    session.observeBase(variant("revision", "r2"));
    session.reconcile(variant("revision", "r2"), (id) => (id === "J4" ? some(spray) : none));
    expect([session.pending, session.ownKeys.size]).toEqual([0, 0]);
});

test("the keys a session made are kept with its drafts through a reload: restored, a new entry whose key another write took meanwhile goes on under the next, as before the reload", () => {
    const before = adding();
    added(before.session, before.session.mint("template")!);
    const kept = { entries: before.session.keptEntries, own: before.session.ownKeys };
    expect([...kept.own]).toEqual([["J4", "template"]]);
    // The page loads again: the drafts and the keys the session made, restored before its first base.
    const { session } = adding();
    const reloaded = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, keys: jobKeys,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    expect(session.restoreOwnKeys(kept.own)).toBe(false);
    expect(reloaded.restore(kept.entries)).toBe(true);
    expect(reloaded.restoreOwnKeys(kept.own)).toBe(true);
    reloaded.observeBase(variant("revision", "r2"));
    expect(reloaded.merge(variant("revision", "r2"), theirJ4)).toBe("merged");
    expect([[...reloaded.entries.keys()], [...reloaded.renumbered], reloaded.unsettled, [...reloaded.ownKeys]]).toEqual([["J5"], [["J4", "J5"]], 0, [["J5", "template"]]]);
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
        sourceId: "benches", entryType: Bench, draftType: BenchDraft, keyType: StringType,
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
        sourceId: "benches", entryType: Bench, draftType: BenchDraft, keyType: StringType,
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

// ── The fields that go with a range: a duty's shift with its times ──────────

const Duty = StructType({ start: IntegerType, end: IntegerType, shift: StringType, person: StringType });
const DutyDraft = Editing.Types.Draft(Duty);
type DutyValue = ValueTypeOf<typeof Duty>;
const dutyVersion = (value: DutyValue): EntryVersion<Bar> => ({ draft: liftDraft(DutyDraft, value), wire: { key: "d1", caption: "" }, place: keyOrder });
/** Whether a version holds a duty: its fields' drafts, as the session holds them. */
const holds = (version: EntryVersion<Bar> | undefined, value: DutyValue): boolean =>
    (equalFor(DutyDraft) as (a: unknown, b: unknown) => boolean)(version?.draft, liftDraft(DutyDraft, value));
/** A late duty, its times in hours: what both began from. */
const late: DutyValue = { start: 14n, end: 22n, shift: "late", person: "w1" };
/**
 * A keyed session over the duties at r1, its times a range its shift goes with: the duty drafted here, then another
 * write moving the source on to `theirs` at r2, carried over.
 */
const carriedDuty = (mine: DutyValue, theirs: DutyValue) => {
    const session = new EditSession<Bar>({
        sourceId: "duties", entryType: Duty, draftType: DutyDraft, keyType: StringType,
        apply: () => variant("applied", { revision: some("r3") }), patch: undefined, refresh: undefined,
        ranges: [{ start: "start", end: "end", with: ["shift"] }],
    });
    session.observeBase(variant("revision", "r1"));
    session.record([{ id: "d1", before: dutyVersion(late), after: dutyVersion(mine) }], "typed", "Move");
    session.observeBase(variant("revision", "r2"));
    session.merge(variant("revision", "r2"), () => some(theirs));
    return session;
};
const paths = (session: EditSession<Bar>) => session.conflicts.get("d1")!.points.map((point) => point.path);

test("a duty moved to another shift here, and later there: its times one conflict, Theirs takes their shift with their times — nothing left to save — and Yours keeps mine whole", () => {
    const early: DutyValue = { start: 6n, end: 14n, shift: "early", person: "w1" };
    const theirs: DutyValue = { ...late, start: 15n, end: 23n };
    const session = carriedDuty(early, theirs);
    // One to choose: its times, start and end.
    expect([session.unsettled, paths(session).length]).toEqual([1, 2]);
    // While it waits, the draft is mine whole.
    expect(holds(session.entries.get("d1"), early)).toBe(true);
    expect(session.settleTogether("d1", paths(session), "source")).toBe(true);
    // Their times, and their shift with them: the duty is theirs whole, and nothing is left to save.
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
    session.undo();
    expect(holds(session.entries.get("d1"), early)).toBe(true);
    expect(session.settleTogether("d1", paths(session), "draft")).toBe(true);
    expect([session.unsettled, session.canApply]).toEqual([0, true]);
    const drafted = session.drafts.entries.get("d1")!;
    expect((equalFor(OptionType(Duty)) as (a: unknown, b: unknown) => boolean)(drafted.before, some(theirs))).toBe(true);
    expect(holds(drafted.draft, early)).toBe(true);
});

test("a duty moved to another shift there, and later here: while its times wait, the shift both began from stands with mine, and Yours sends it back", () => {
    const later: DutyValue = { ...late, start: 16n, end: 23n };
    const theirs: DutyValue = { start: 6n, end: 14n, shift: "early", person: "w1" };
    const session = carriedDuty(later, theirs);
    // Mine whole: my times, and the shift both began from — never their early shift with my late times.
    expect(holds(session.entries.get("d1"), later)).toBe(true);
    expect(session.settleTogether("d1", paths(session), "draft")).toBe(true);
    const drafted = session.drafts.entries.get("d1")!;
    expect((equalFor(OptionType(Duty)) as (a: unknown, b: unknown) => boolean)(drafted.before, some(theirs))).toBe(true);
    expect(holds(drafted.draft, later)).toBe(true);
    session.undo();
    expect(session.settleTogether("d1", paths(session), "source")).toBe(true);
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
});

test("a change to a field that goes with the times, with no conflict at the times, combines as any other", () => {
    // Moved to the early shift here with its times as they were; a later time there.
    const session = carriedDuty({ ...late, shift: "early" }, { ...late, start: 15n, end: 23n });
    expect(session.unsettled).toBe(0);
    expect(holds(session.entries.get("d1"), { ...late, start: 15n, end: 23n, shift: "early" })).toBe(true);
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

// ── A conflict left by a gesture, with no choice made ─────────────────────────

/**
 * A keyed session over the jobs at r1 whose drafts met another write as they were carried over to r2.
 *
 * @param mine - What was drafted here, over the jobs as they began
 * @param theirs - The jobs as the source holds them at r2
 */
const met = (mine: Parameters<EditSession<Bar>["record"]>[0], theirs: (id: string) => option<unknown>) => {
    const batches: ValueTypeOf<typeof JobBatch>[] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined, refresh: undefined,
        apply: (bytes) => { batches.push(decodeBeast2For(JobBatch)(bytes)); return variant("applied", { revision: some("r3") }); },
    });
    session.observeBase(variant("revision", "r1"));
    session.record(mine, "typed", "Edit jobs");
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), theirs)).toBe("merged");
    return { session, batches };
};
/** Whether a session holds a job as given: its draft, or none of it. */
const jobIs = (session: EditSession<Bar>, id: string, value: JobValue | undefined): boolean => {
    const draft = session.entries.get(id)?.draft;
    return value === undefined ? draft === undefined : (equalFor(JobDraft) as (a: unknown, b: unknown) => boolean)(draft, liftDraft(JobDraft, value));
};
/** J1's quantity set to 5 here, and to 3 there: one conflict to choose. */
const quantities = () => met(
    [{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }],
    (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : some(band)),
);

test("a value in conflict typed back to what both sides began from makes no choice and overwrites nothing: the other side's value stands there, settled so — Undo brings the conflict back, and settled the other way the value typed is kept, a choice", async () => {
    // Left as typed, the three values read no conflict — the draft is as both began — yet the draft differed from the
    // source's: Save was on, and wrote 2 over the other side's 3, which its person was never asked about.
    const { session, batches } = quantities();
    expect([session.unsettled, session.canApply]).toEqual([1, false]);
    expect(session.record([{ id: "J1", before: job({ ...cut, qty: 5n }), after: job(cut) }], "typed", "Set quantity")).toBe(true);
    expect([session.unsettled, session.pending, session.canApply, jobIs(session, "J1", { ...cut, qty: 3n })]).toEqual([0, 0, false, true]);
    expect(session.settled.map((settled) => [settled.id, settled.choice])).toEqual([["J1", "source"]]);
    // One step, which Undo takes back whole: the conflict waits again, the draft as it stood.
    session.undo();
    expect([session.unsettled, session.settled.length, jobIs(session, "J1", { ...cut, qty: 5n })]).toEqual([1, 0, true]);
    session.redo();
    expect([session.unsettled, session.pending, jobIs(session, "J1", { ...cut, qty: 3n })]).toEqual([0, 0, true]);
    // Settled the other way: what was typed, kept over the other side's — theirs to save now, by their choice.
    expect(session.settleAll("draft")).toBe(true);
    expect([session.unsettled, session.pending, session.canApply, jobIs(session, "J1", cut)]).toEqual([0, 1, true, true]);
    await session.apply();
    expect(batches).toHaveLength(1);
});

test("a third value typed at a conflict keeps it: Save waits on the choice still", () => {
    const { session } = quantities();
    session.record([{ id: "J1", before: job({ ...cut, qty: 5n }), after: job({ ...cut, qty: 7n }) }], "typed", "Set quantity");
    expect([session.unsettled, session.canApply, session.settled.length, jobIs(session, "J1", { ...cut, qty: 7n })]).toEqual([1, false, 0, true]);
});

test("a conflict left by typing the other side's value settles nothing and leaves nothing to save — and a later change there is a change of the value shown: typed to what both once began from, it is kept", () => {
    const { session } = quantities();
    session.record([{ id: "J1", before: job({ ...cut, qty: 5n }), after: job({ ...cut, qty: 3n }) }], "typed", "Set quantity");
    expect([session.unsettled, session.pending, session.settled.length]).toEqual([0, 0, 0]);
    // The quantity shown is 3: typed to 2 now, that is a change of the 3 its person sees — never the conflict's "as it began".
    session.record([{ id: "J1", before: job({ ...cut, qty: 3n }), after: job(cut) }], "typed", "Set quantity");
    expect([session.unsettled, session.pending, session.canApply, jobIs(session, "J1", cut)]).toEqual([0, 1, true, true]);
    // And Undo walks back through both: the conflict again at the first.
    session.undo();
    session.undo();
    expect([session.unsettled, jobIs(session, "J1", { ...cut, qty: 5n })]).toEqual([1, true]);
});

test("a new entry both sides added, removed again here, removes nothing of the other side's: their entry stands, and nothing is left to save", async () => {
    // Left removed, the draft read as a removal of the entry under that key — the other side's, which its person had
    // never seen — and Save removed it.
    const theirs = { task: "Their spray", qty: 9n };
    const { session, batches } = met([{ id: "J4", before: absentJob, after: job(spray) }], (id) => (id === "J4" ? some(theirs) : some(band)));
    expect(session.unsettled).toBe(1);
    session.record([{ id: "J4", before: job(spray), after: absentJob }], "typed", "Remove a job");
    expect([session.unsettled, session.pending, session.canApply, jobIs(session, "J4", theirs)]).toEqual([0, 0, false, true]);
    expect(session.settled.map((settled) => [settled.id, settled.choice, settled.point.kind])).toEqual([["J4", "source", "added-by-both"]]);
    await session.apply();
    expect(batches).toHaveLength(0);
});

test("an entry changed here that the other side removed, its change typed back, is gone as they left it; one removed here that they changed, put back as it was, stands as they left it", () => {
    const changed = met([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], (id) => (id === "J1" ? none : some(band)));
    expect(changed.session.unsettled).toBe(1);
    changed.session.record([{ id: "J1", before: job({ ...cut, qty: 5n }), after: job(cut) }], "typed", "Set quantity");
    expect([changed.session.unsettled, changed.session.pending, jobIs(changed.session, "J1", undefined)]).toEqual([0, 0, true]);
    // Settled the other way: the entry as it was typed back, kept — the next Save puts it back, by their choice.
    expect(changed.session.settleAll("draft")).toBe(true);
    expect([changed.session.pending, jobIs(changed.session, "J1", cut)]).toEqual([1, true]);

    const removed = met([{ id: "J1", before: job(cut), after: absentJob }], (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : some(band)));
    expect(removed.session.unsettled).toBe(1);
    removed.session.record([{ id: "J1", before: absentJob, after: job(cut) }], "typed", "Add a job");
    expect([removed.session.unsettled, removed.session.pending, jobIs(removed.session, "J1", { ...cut, qty: 3n })]).toEqual([0, 0, true]);
});

test("times put at the other side's by hand take the other side's shift with them: nothing of theirs is written over, and nothing is left to save", () => {
    // Moved to the early shift there, and later here: its times one conflict, the shift both began from standing with
    // mine while it waits. Typed to their times, the conflict is left — and the shift, never changed here, read as a
    // change of their early shift still to save.
    const later: DutyValue = { ...late, start: 16n, end: 23n };
    const theirs: DutyValue = { start: 6n, end: 14n, shift: "early", person: "w1" };
    const session = carriedDuty(later, theirs);
    expect([session.unsettled, holds(session.entries.get("d1"), later)]).toEqual([1, true]);
    session.record([{ id: "d1", before: dutyVersion(later), after: dutyVersion({ ...later, start: 6n, end: 14n }) }], "move", "Move");
    expect([session.unsettled, session.pending, holds(session.entries.get("d1"), theirs)]).toEqual([0, 0, true]);
});

// ── The history through another write of other entries ────────────────────────

test("a source that moves under the drafts by another write of other entries takes no step of the history: Undo and Redo stand, and the next Save is drafted at the base it moved to", async () => {
    // Started over at every carry-over, the history went whenever anyone saved anything: Undo was off the moment a
    // colleague's Save landed, whatever row it wrote.
    const bases: string[] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined, refresh: undefined,
        apply: (bytes) => {
            const base = decodeBeast2For(JobBatch)(bytes).base;
            bases.push(base.type === "revision" ? base.value : "snapshot");
            return variant("applied", { revision: some("r3") });
        },
    });
    session.observeBase(variant("revision", "r1"));
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    session.record([{ id: "J1", before: job({ ...cut, qty: 5n }), after: job({ ...cut, qty: 6n }) }], "typed", "Set quantity");
    session.undo();
    expect(session.depth).toEqual({ undo: 1, redo: 1 });
    // Another write, of J2: J1 is as its edits began.
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), (id) => (id === "J1" ? some(cut) : some({ ...band, qty: 9n })))).toBe("merged");
    expect([session.depth, session.pending, session.unsettled, jobIs(session, "J1", { ...cut, qty: 5n })]).toEqual([{ undo: 1, redo: 1 }, 1, 0, true]);
    session.redo();
    expect(jobIs(session, "J1", { ...cut, qty: 6n })).toBe(true);
    session.undo();
    session.undo();
    expect([session.pending, session.canUndo, session.depth.redo]).toEqual([0, false, 2]);
    session.redo();
    await session.apply();
    expect(bases).toEqual(["r2"]);
});

test("another write of an entry the session holds starts the history over at the drafts, as it has: its steps began from a row the source no longer holds", () => {
    const session = keyed("r1");
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    session.observeBase(variant("revision", "r2"));
    // J1's task renamed by another write: beside the draft's quantity, nothing to choose.
    expect(session.merge(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, task: "Panel cutting, maple" }) : some(band)))).toBe("merged");
    expect([session.depth, session.pending, jobIs(session, "J1", { task: "Panel cutting, maple", qty: 5n })]).toEqual([{ undo: 0, redo: 0 }, 1, true]);
});

test("a conflict that waits, and one settled, stand through another write of other entries: neither is read afresh, and Undo of the choice brings the conflict back", () => {
    const { session } = quantities();
    expect(session.settleAll("draft")).toBe(true);
    expect([session.unsettled, session.settled.length, session.canUndo]).toEqual([0, 1, true]);
    // Another write of J2: J1 is as the source held it when the conflict was read.
    session.observeBase(variant("revision", "r3"));
    expect(session.merge(variant("revision", "r3"), (id) => (id === "J1" ? some({ ...cut, qty: 3n }) : some({ ...band, qty: 9n })))).toBe("merged");
    expect([session.unsettled, session.settled.length, session.canUndo, session.pending]).toEqual([0, 1, true, 1]);
    session.undo();
    expect([session.unsettled, session.settled.length]).toEqual([1, 0]);
});

// ── The complete edits, handed over as a draft (#1620) ───────────────────────

/** What a source's draft form answers with: bytes that stand for the draft it makes of a batch. */
const DRAFT_BYTES = new Uint8Array([1, 6, 2, 0]);
const samePlace = equalFor(OptionType(Editing.Types.Placement));
const sameJobPatch = equalFor(PatchType(OptionType(Job)));
/**
 * A keyed session over the jobs, read whole, whose source has a draft form: the batches the form was handed, and the
 * batches its Save sent.
 *
 * @param overrides - What the session's binding says otherwise
 * @param answer - What the draft form answers a batch with; the draft by default
 */
const drafting = (overrides: Partial<EditSessionBinding<Bar>> = {}, answer: () => ToDraftResult = () => variant("draft", DRAFT_BYTES)) => {
    const handed: ValueTypeOf<typeof JobBatch>[] = [];
    const sent: ValueTypeOf<typeof JobBatch>[] = [];
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined, refresh: undefined,
        apply: (bytes) => { sent.push(decodeBeast2For(JobBatch)(bytes)); return variant("applied", { revision: some("r2") }); },
        toDraft: (bytes) => { handed.push(decodeBeast2For(JobBatch)(bytes)); return answer(); },
        ...overrides,
    });
    session.observeBase(variant("snapshot", began()));
    return { session, handed, sent };
};
/** The ids a batch changes, in order of their text. */
const changed = (batch: ValueTypeOf<typeof JobBatch> | undefined) => batch?.changes.map((change) => change.id).sort();

test("a session hands its complete edits to its source's draft form as the batch a Save of them sends — nothing sent, no step taken, the session where it was — and a source with no draft form hands nothing over (#1620)", async () => {
    expect(keyed().toDraft()).toBeUndefined();
    const { session, handed, sent } = drafting();
    session.record([
        { id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) },
        { id: "J4", before: absentJob, after: job(spray) },
        { id: "J2", before: job(band), after: absentJob },
    ], "typed", "Edit jobs");
    const stood = () => [session.getSnapshot(), session.status, session.pending, session.locked, session.canApply, session.depth];
    const before = stood();
    const answer = session.toDraft();
    expect([answer?.type, answer?.value]).toEqual(["draft", DRAFT_BYTES]);
    expect([handed.length, sent.length]).toEqual([1, 0]);
    expect(stood()).toEqual(before);
    expect(changed(handed[0])).toEqual(["J1", "J2", "J4"]);
    // The Save of the same edits sends that batch, under a request and a label of its own.
    await session.apply();
    expect(sent).toHaveLength(1);
    expect(equalFor(JobBatch)(handed[0]!, { ...sent[0]!, requestId: "", label: "" })).toBe(true);
});

test("with no complete edit that changes the source there is no draft, and the draft form is not asked: nothing drafted, an edit undone, a source not yet read (#1620)", () => {
    const { session, handed } = drafting();
    expect(session.toDraft()?.type).toBe("unchanged");
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    session.undo();
    expect(session.toDraft()?.type).toBe("unchanged");
    const unread = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, apply: undefined, patch: undefined, refresh: undefined,
        toDraft: (bytes) => { handed.push(decodeBeast2For(JobBatch)(bytes)); return variant("draft", DRAFT_BYTES); },
    });
    expect(unread.toDraft()?.type).toBe("unchanged");
    expect(handed).toHaveLength(0);
});

test("a check holding Save holds no draft back, and neither does a conflict that waits: the draft's value stands there, a change of what the source holds now (#1620)", () => {
    const refused = { entry: "J1", row: none, field: some("qty"), message: "Over the bench's hours" };
    const held = drafting({ ready: () => variant("invalid", [refused]) });
    held.session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    expect(held.session.canApply).toBe(false);
    expect(held.session.toDraft()?.type).toBe("draft");
    expect(changed(held.handed[0])).toEqual(["J1"]);

    // J1's quantity set to 5 here, and to 3 by another write: a conflict nobody has chosen at.
    const waiting = drafting();
    waiting.session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    waiting.session.observeBase(variant("snapshot", jobs([["J1", { ...cut, qty: 3n }], ["J2", band], ["J3", route]])));
    expect([waiting.session.unsettled, waiting.session.canApply]).toEqual([1, false]);
    expect(waiting.session.toDraft()?.type).toBe("draft");
    const [change] = waiting.handed[0]!.changes;
    expect(change!.id).toBe("J1");
    expect(sameJobPatch(change!.patch, diffFor(OptionType(Job))(some({ ...cut, qty: 3n }), some({ ...cut, qty: 5n })))).toBe(true);
    expect(waiting.session.unsettled).toBe(1);
});

test("an entry with a field still missing, or text that could not be read, has no row to hand over: one the source holds stands as it began, a new one is left out, and the complete edits beside them go (#1620)", () => {
    const { session, handed } = drafting();
    const missing: EntryVersion<Bar> = { draft: { task: variant("value", cut.task), qty: variant("missing", null) }, wire: { key: cut.task, caption: "" }, place: keyOrder };
    const unread: EntryVersion<Bar> = { draft: { task: variant("value", spray.task), qty: variant("invalid", "six") }, wire: { key: spray.task, caption: "six" }, place: keyOrder };
    session.record([
        { id: "J1", before: job(cut), after: missing },
        { id: "J4", before: absentJob, after: unread },
    ], "typed", "Edit jobs");
    // Nothing of it is complete: no draft, and the form is not asked.
    expect([session.pending, session.toDraft()?.type, handed.length]).toEqual([2, "unchanged", 0]);
    session.record([{ id: "J3", before: job(route), after: job({ ...route, qty: 2n }) }], "typed", "Set quantity");
    expect(session.toDraft()?.type).toBe("draft");
    expect(changed(handed[0])).toEqual(["J3"]);
    // Each completed, it goes with the next.
    session.record([{ id: "J1", before: missing, after: job({ ...cut, qty: 7n }) }, { id: "J4", before: unread, after: job(spray) }], "typed", "Edit jobs");
    expect(session.toDraft()?.type).toBe("draft");
    expect(changed(handed[1])).toEqual(["J1", "J3", "J4"]);
});

test("an entry placed beside a new entry that is left out stands where that one stood; placed by one another alone, it stays where it began (#1620)", () => {
    const b: RunValue = { id: "b", start: 4n, end: 6n };
    const c: RunValue = { id: "c", start: 7n, end: 8n };
    const after = (id: string): Placement => some(variant("ordered", variant("after", id)));
    const placed = (run: RunValue, place: Placement): EntryVersion<Bar> => ({ ...version(run), place });
    /** A new run whose end is still missing, placed where given. */
    const unfinished = (place: Placement): EntryVersion<Bar> => ({
        draft: { id: variant("value", "n"), start: variant("value", 2n), end: variant("missing", null) }, wire: { key: "n", caption: "2–" }, place,
    });
    const absent: EntryVersion<Bar> = { draft: undefined, wire: undefined, place: none };
    const over = () => {
        const handed: ValueTypeOf<typeof Batch>[] = [];
        const session = create({ toDraft: (bytes) => { handed.push(decodeBeast2For(Batch)(bytes)); return variant("draft", DRAFT_BYTES); } });
        session.observeBase(variant("snapshot", [a, b, c]));
        return { session, handed };
    };
    // A new run after a, and c moved up to stand after it: the batch holds no n, so c stands where n stood.
    const moved = over();
    moved.session.record([
        { id: "n", before: absent, after: unfinished(after("a")) },
        { id: "c", before: placed(c, after("b")), after: placed(c, after("n")) },
    ], "move", "Add a run");
    expect(moved.session.toDraft()?.type).toBe("draft");
    expect(moved.handed[0]!.changes.map((change) => change.id)).toEqual(["c"]);
    expect(samePlace(moved.handed[0]!.changes[0]!.place, after("a"))).toBe(true);
    // The new run placed after c, and c after it: neither says where, and c stays where it began — no change at all.
    const circular = over();
    circular.session.record([
        { id: "n", before: absent, after: unfinished(after("c")) },
        { id: "c", before: placed(c, after("b")), after: placed(c, after("n")) },
    ], "move", "Add a run");
    expect([circular.session.toDraft()?.type, circular.handed.length]).toEqual(["unchanged", 0]);
});

test("what the draft form answers is the session's answer — the refusal a Save of the batch would get before it wrote, as it is — and a form that throws is refused in its words (#1620)", () => {
    const moved = [{ entry: "J1", row: none, field: none, message: "Changed since this edit began" }];
    const conflict = drafting({}, () => variant("conflict", moved));
    conflict.session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    const refusal = conflict.session.toDraft();
    expect([refusal?.type, refusal?.value]).toEqual(["conflict", moved]);
    // Nothing of it reaches the session: no status, no issue, and Save is where it was.
    expect([conflict.session.status, conflict.session.issues, conflict.session.canApply]).toEqual(["idle", [], true]);

    const thrown = drafting({}, () => { throw new Error("the record is not bound"); });
    thrown.session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    const answer = thrown.session.toDraft();
    expect(answer?.type).toBe("rejected");
    expect(answer?.type === "rejected" ? answer.value.map((issue) => issue.message) : []).toEqual(["the record is not bound"]);
    expect(thrown.session.status).toBe("idle");
});

test("while a Save of the session's own is unresolved it hands over still, from what its edits began from: whoever asks decides whether to wait (#1620)", async () => {
    const { session, handed } = drafting();
    session.record([{ id: "J1", before: job(cut), after: job({ ...cut, qty: 5n }) }], "typed", "Set quantity");
    await session.apply();
    expect([session.status, session.locked]).toEqual(["reconciling", true]);
    expect(session.toDraft()?.type).toBe("draft");
    expect(changed(handed[0])).toEqual(["J1"]);
});
