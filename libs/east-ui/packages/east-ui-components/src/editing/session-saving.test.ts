/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A Save never stops the editing: a gesture is recorded while a request is on
 * its way, while its saved state is read back, while its answer is unknown,
 * and while the drafts are carried over to a source that moved. What a
 * confirmed Save leaves to save is what was drafted since it was sent, each
 * change beginning from what the Save left. A read back that differs — another
 * write beside the Save's — keeps those drafts, each merged over the source's
 * value, a part both changed a conflict to choose.
 */

import { expect, test } from "vitest";
import {
    DictType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, equalFor, none, some, variant, type ValueTypeOf,
    type option,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { EditSession, type EditSessionBinding, type EntryVersion } from "./session.js";

const Job = StructType({ task: StringType, qty: IntegerType });
const JobDraft = Editing.Types.Draft(Job);
const JobBatch = Editing.Types.ChangeSet(Job, StringType);
type JobValue = ValueTypeOf<typeof Job>;
type Answer = ValueTypeOf<typeof Editing.Types.ApplyResult>;
/** A collection's own projection of an entry — a bar on a canvas. */
interface Bar { key: string; caption: string }
const keyOrder = some(variant("keyOrder", null));
const job = (value: JobValue): EntryVersion<Bar> => ({ draft: liftDraft(JobDraft, value), wire: { key: value.task, caption: `${value.qty}` }, place: keyOrder });
const cut: JobValue = { task: "Panel cutting", qty: 2n };
const band: JobValue = { task: "Edge banding", qty: 4n };
const route: JobValue = { task: "CNC routing", qty: 1n };
const oak: JobValue = { task: "Panel cutting, oak", qty: 5n };
/** A keyed source's whole collection, as East holds a Dict. */
const jobs = (entries: [string, JobValue][]) => new SortedMap(entries, compareFor(StringType));
/** Whether a collection — the source's, with the drafts applied — holds exactly the jobs given. */
const holdsJobs = (collection: unknown, entries: [string, JobValue][]): boolean =>
    (equalFor(DictType(StringType, Job)) as (a: unknown, b: unknown) => boolean)(collection, jobs(entries));
/** Whether an entry, as the source holds one, is the job given — `none` for an absent one. */
const isJob = (held: option<unknown> | undefined, value: option<JobValue>): boolean =>
    held !== undefined && equalFor(OptionType(Job))(held as option<JobValue>, value);
/** Whether a version's draft is the job given, as the session holds a job's draft. */
const drafts = (version: EntryVersion<Bar> | undefined, value: JobValue): boolean =>
    (equalFor(JobDraft) as (a: unknown, b: unknown) => boolean)(version?.draft, liftDraft(JobDraft, value));
/** Sets a job's quantity: one gesture. */
const setQty = (session: EditSession<Bar>, id: string, from: JobValue, qty: bigint): boolean =>
    session.record([{ id, before: job(from), after: job({ ...from, qty }) }], "typed", "Set quantity");
/** Lets what a promise's answer sets going run to its end. */
const settled = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/**
 * A keyed session over the jobs, at revision `r1` or read whole, whose Saves
 * are answered when the test says: each batch it sent, and the answer to the
 * one on its way — or its failure, a write with no answer.
 */
function saving(overrides: Partial<EditSessionBinding<Bar>> = {}, whole = false) {
    const sent: ValueTypeOf<typeof JobBatch>[] = [];
    let out: { resolve: (result: Answer) => void; reject: (error: Error) => void } | undefined;
    const session = new EditSession<Bar>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined, refresh: undefined,
        apply: (bytes) => {
            sent.push(decodeBeast2For(JobBatch)(bytes));
            return new Promise<Answer>((resolve, reject) => { out = { resolve, reject }; });
        },
        ...overrides,
    });
    session.observeBase(whole ? variant("snapshot", jobs([["J1", cut], ["J2", band], ["J3", route]])) : variant("revision", "r1"));
    return {
        session, sent,
        answer: async (result: Answer) => { out!.resolve(result); await settled(); },
        fail: async (reason: string) => { out!.reject(new Error(reason)); await settled(); },
    };
}
const saved = (revision: string): Answer => variant("applied", { revision: some(revision) });
/** Each batch's entries, in the order sent. */
const idsOf = (sent: readonly ValueTypeOf<typeof JobBatch>[]) => sent.map((batch) => batch.changes.map((change) => change.id).sort());

test("a gesture is recorded while a Save is on its way and while its saved state is read back; confirmed, what was drafted since is what is left to save, each change from what the Save left", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    expect([session.status, session.locked, session.writable]).toEqual(["applying", true, true]);
    // Another job changed, and the first changed again, while the request is on its way: the request's state stands.
    expect(setQty(session, "J2", band, 8n)).toBe(true);
    expect(setQty(session, "J1", { ...cut, qty: 5n }, 6n)).toBe(true);
    expect([session.status, session.error, session.issues]).toEqual(["applying", undefined, []]);
    expect(idsOf(sent)).toEqual([["J1"]]);
    await answer(saved("r2"));
    await save;
    expect(session.status).toBe("reconciling");
    // And one more while what it saved is read back.
    expect(setQty(session, "J3", route, 2n)).toBe(true);
    expect(session.status).toBe("reconciling");
    expect(session.reconcile(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 5n }) : undefined))).toBe(true);
    expect([session.status, session.pending, session.canApply]).toEqual(["idle", 3, true]);
    // J1's change now begins from what the Save left of it.
    const { revision, entries } = session.drafts;
    expect(revision).toBe("r2");
    expect([isJob(entries.get("J1")?.before, some({ ...cut, qty: 5n })), isJob(entries.get("J1")?.after, some({ ...cut, qty: 6n }))]).toEqual([true, true]);
    // The next Save sends them alone, from the revision the first made.
    void session.apply();
    expect(idsOf(sent)).toEqual([["J1"], ["J1", "J2", "J3"]]);
    expect(sent[1]!.base).toEqual(variant("revision", "r2"));
});

test("a Save the source refuses over an entry first drafted while an earlier Save was out — one another write changed before that Save landed — is carried over at the revision the session is at, with none newer to wait for: the part both changed is a conflict to choose, and the Save goes once it is chosen", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const first = session.apply();
    // J2's quantity set to 8, from the 4 the session read of it before the Save.
    setQty(session, "J2", band, 8n);
    await answer(saved("r2"));
    await first;
    // Another write set J2's quantity to 6 before the Save landed: r2 holds both. The Save's own entry reads back as sent.
    expect(session.reconcile(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, qty: 5n }) : undefined))).toBe(true);
    expect([session.status, session.pending]).toEqual(["idle", 1]);
    const second = session.apply();
    // The source checks J2's change against the 4 it began from, holds 6, and refuses.
    await answer(variant("conflict", [{ entry: "", row: none, field: none, message: "The record changed since this edit began" }]));
    await second;
    expect([session.status, session.carrying]).toEqual(["conflict", false]);
    // The session is at the revision the Save was refused at. It reads the entry there, where its change no longer applies…
    expect(session.readIdsAt("r2")).toEqual(["J2"]);
    const at = (id: string) => (id === "J2" ? some({ ...band, qty: 6n }) : some({ ...cut, qty: 5n }));
    expect(session.nameConflicts(variant("revision", "r2"), at)).toBe(false);
    // …and carries its drafts over there, as to a revision the source moves to — each entry it holds read there.
    expect([session.status, session.carrying, session.readIdsAt("r2")]).toEqual(["conflict", true, ["J1", "J2"]]);
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), at)).toBe("merged");
    // Both set J2's quantity: a conflict to choose, and nothing sent again meanwhile.
    expect([session.status, session.carrying, session.unsettled, session.pending, session.canApply]).toEqual(["idle", false, 1, 1, false]);
    expect(idsOf(sent)).toEqual([["J1"], ["J2"]]);
    // Kept, the draft is a change from what the source holds: the Save goes, from 6 to 8.
    expect(session.settleAll("draft")).toBe(true);
    expect(session.canApply).toBe(true);
    void session.apply();
    expect(idsOf(sent)).toEqual([["J1"], ["J2"], ["J2"]]);
    const { entries } = session.drafts;
    expect([isJob(entries.get("J2")?.before, some({ ...band, qty: 6n })), isJob(entries.get("J2")?.after, some({ ...band, qty: 8n }))]).toEqual([true, true]);
});

test("a refused Save whose every change still applies at the revision it was drafted at is carried over nowhere there: each entry is read once, and the session waits for the revision the source moved to", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    await answer(variant("conflict", [{ entry: "", row: none, field: none, message: "The record changed since this edit began" }]));
    await save;
    expect(session.status).toBe("conflict");
    expect(session.readIdsAt("r1")).toEqual(["J1"]);
    // At r1 the job is as the edit began: the write that refused it is at a revision the session has not read yet.
    expect(session.nameConflicts(variant("revision", "r1"), () => some(cut))).toBe(false);
    session.merge(variant("revision", "r1"), () => some(cut));
    expect([session.status, session.carrying, session.readIdsAt("r1")]).toEqual(["conflict", false, []]);
    // There, its entries are named as before.
    expect(session.readIdsAt("r2")).toEqual(["J1"]);
    expect(session.nameConflicts(variant("revision", "r2"), () => some({ ...cut, qty: 3n }))).toBe(true);
    expect(session.issues.map((issue) => issue.entry)).toEqual(["J1"]);
});

test("a Save confirmed with nothing drafted since leaves nothing to save, and its history stands", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    await answer(saved("r2"));
    await save;
    expect(session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }))).toBe(true);
    expect([session.status, session.pending, session.canApply, session.canUndo]).toEqual(["idle", 0, false, true]);
});

test("Undo and Redo work while a Save is out: a step undone since it was sent is a change to save once it is confirmed", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 8n);
    const save = session.apply();
    expect([session.canUndo, session.canRedo]).toEqual([true, false]);
    session.undo();
    expect([session.status, session.canRedo]).toEqual(["applying", true]);
    expect(drafts(session.entries.get("J2"), band)).toBe(true);
    await answer(saved("r2"));
    await save;
    expect(session.reconcile(variant("revision", "r2"), (id) => some(id === "J1" ? { ...cut, qty: 5n } : { ...band, qty: 8n }))).toBe(true);
    // The Save wrote J2's 8; undone since, putting it back is the change left.
    expect([session.pending, session.canApply]).toEqual([1, true]);
    const undone = session.drafts.entries.get("J2")!;
    expect([isJob(undone.before, some({ ...band, qty: 8n })), isJob(undone.after, some(band))]).toEqual([true, true]);
    // Redone, nothing is left: the draft is what the Save wrote.
    session.redo();
    expect(session.pending).toBe(0);
    session.undo();
    void session.apply();
    expect(idsOf(sent)).toEqual([["J1", "J2"], ["J2"]]);
});

test("Discard is off while a request is unresolved; confirmed, it drops what was drafted since and leaves what the Save wrote", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    setQty(session, "J1", { ...cut, qty: 5n }, 6n);
    expect(session.canDiscard).toBe(false);
    session.discard();
    expect(session.pending).toBe(1);
    await answer(saved("r2"));
    await save;
    expect(session.canDiscard).toBe(false);
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    expect([session.canDiscard, session.pending]).toEqual([true, 1]);
    session.discard();
    expect(session.pending).toBe(0);
    expect(drafts(session.entries.get("J1"), { ...cut, qty: 5n })).toBe(true);
});

test("a read back that differs — another write's field beside the Save's — keeps what was drafted since: a change of another part merged over the source's value, an entry not drafted since the source's", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J3", route, 2n);
    const save = session.apply();
    // Since it was sent: J1's quantity again, and J2, which the request holds nothing of.
    setQty(session, "J1", { ...cut, qty: 5n }, 6n);
    setQty(session, "J2", band, 8n);
    await answer(saved("r2"));
    await save;
    // Another write renamed J1's task before the Save landed: the source holds both.
    expect(session.reconcile(variant("revision", "r2"), (id) => some(id === "J1" ? oak : { ...route, qty: 2n }))).toBe(true);
    expect([session.status, session.unsettled, session.pending, session.canApply]).toEqual(["idle", 0, 2, true]);
    // J1: the source's value its original, my newer quantity over it.
    expect([drafts(session.originals.get("J1"), oak), drafts(session.entries.get("J1"), { ...oak, qty: 6n })]).toEqual([true, true]);
    expect(drafts(session.entries.get("J2"), { ...band, qty: 8n })).toBe(true);
    // J3 read back as it was sent, and nothing was drafted of it since: the source's.
    expect([...session.entries.keys()].sort()).toEqual(["J1", "J2"]);
    // The history starts over at the drafts: an undo would take J1 back to a version from before the other write.
    expect(session.canUndo).toBe(false);
});

test("a read back that differs with nothing drafted since: the session's versions go with their history, as before", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    await answer(saved("r2"));
    await save;
    expect(session.reconcile(variant("revision", "r2"), () => some(oak))).toBe(true);
    expect([session.status, session.entries.size, session.pending, session.canUndo]).toEqual(["idle", 0, 0, false]);
});

test("a read back that differs at the part drafted since is a conflict to choose: the draft's value stands there, and Save waits", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    // Since it was sent, the task renamed here — and by another write, differently, before the Save landed.
    session.record([{ id: "J1", before: job({ ...cut, qty: 5n }), after: job({ task: "Panel cutting, pine", qty: 5n }) }], "typed", "Rename");
    await answer(saved("r2"));
    await save;
    expect(session.reconcile(variant("revision", "r2"), () => some(oak))).toBe(true);
    expect([session.status, session.unsettled, session.canApply]).toEqual(["idle", 1, false]);
    expect(drafts(session.entries.get("J1"), { task: "Panel cutting, pine", qty: 5n })).toBe(true);
    const [point] = session.conflicts.get("J1")!.points;
    expect(session.settle("J1", point!.path, "source")).toBe(true);
    expect([session.unsettled, session.pending]).toEqual([0, 0]);
});

test("an entry another write removed since the Save landed, drafted again meanwhile, is a conflict at the entry", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    setQty(session, "J1", { ...cut, qty: 5n }, 6n);
    await answer(saved("r2"));
    await save;
    // Read at a later revision, where another write has removed it: acknowledged, the source's.
    expect(session.reconcile(variant("revision", "r3"), () => none)).toBe(true);
    expect([session.unsettled, session.conflicts.get("J1")!.points.map((point) => point.kind)]).toEqual([1, ["removed-by-source"]]);
});

test("a source read whole: a gesture while its Save is out draws over the collection as the Save leaves it, and stays the change left once the collection reads back", async () => {
    const { session, sent, answer } = saving({}, true);
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    setQty(session, "J2", band, 8n);
    expect(holdsJobs(session.applied(), [["J1", { ...cut, qty: 5n }], ["J2", { ...band, qty: 8n }], ["J3", route]])).toBe(true);
    await answer(variant("applied", { revision: none }));
    await save;
    const landed = jobs([["J1", { ...cut, qty: 5n }], ["J2", band], ["J3", route]]);
    expect(session.reconcile(variant("snapshot", landed), () => undefined)).toBe(true);
    expect([session.status, session.pending, session.canUndo]).toEqual(["idle", 1, true]);
    expect(holdsJobs(session.applied(), [["J1", { ...cut, qty: 5n }], ["J2", { ...band, qty: 8n }], ["J3", route]])).toBe(true);
    void session.apply();
    expect(idsOf(sent)).toEqual([["J1"], ["J2"]]);
});

test("a source read whole whose collection reads back with another write's field beside the Save's keeps what was drafted since, merged over it", async () => {
    const { session, answer } = saving({}, true);
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    setQty(session, "J1", { ...cut, qty: 5n }, 6n);
    await answer(variant("applied", { revision: none }));
    await save;
    expect(session.reconcile(variant("snapshot", jobs([["J1", oak], ["J2", band], ["J3", route]])), () => undefined)).toBe(true);
    expect([session.status, session.pending, session.unsettled]).toEqual(["idle", 1, 0]);
    expect([drafts(session.originals.get("J1"), oak), drafts(session.entries.get("J1"), { ...oak, qty: 6n })]).toEqual([true, true]);
});

test("a write with no answer takes gestures: Retry sends the same request again, and what was drafted since goes in the next", async () => {
    const { session, sent, answer, fail } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    await fail("The network dropped the answer");
    await save;
    expect([session.status, session.locked, session.writable]).toEqual(["unknown", true, true]);
    expect(setQty(session, "J2", band, 8n)).toBe(true);
    // The write's state stands: Save is still Retry, saying why.
    expect([session.status, session.error]).toEqual(["unknown", "The network dropped the answer"]);
    const retry = session.apply();
    expect(sent).toHaveLength(2);
    expect([sent[1]!.requestId === sent[0]!.requestId, idsOf(sent)]).toEqual([true, [["J1"], ["J1"]]]);
    await answer(saved("r2"));
    await retry;
    expect(session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }))).toBe(true);
    expect([session.status, session.pending]).toEqual(["idle", 1]);
    void session.apply();
    expect(idsOf(sent)[2]).toEqual(["J2"]);
});

test("a Save the source refuses leaves every draft, those made since it was sent among them, and says why", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    setQty(session, "J2", band, 8n);
    const refusal = { entry: "J1", row: none, field: none, message: "At most 4" };
    await answer(variant("rejected", [refusal]));
    await save;
    expect([session.status, session.locked, session.issues, session.pending]).toEqual(["rejected", false, [refusal], 2]);
    // The next gesture clears the refusal, as it always has.
    setQty(session, "J1", { ...cut, qty: 5n }, 4n);
    expect([session.status, session.issues, session.canApply]).toEqual(["idle", [], true]);
});

test("a gesture made while the drafts are carried over to a source that moved is carried over with them", () => {
    const { session } = saving();
    setQty(session, "J1", cut, 5n);
    // Another write moves the source on: each drafted entry is read there.
    session.observeBase(variant("revision", "r2"));
    expect([session.carrying, session.writable, session.canApply]).toEqual([true, true, false]);
    expect(setQty(session, "J2", band, 8n)).toBe(true);
    expect(session.readIdsAt("r2")).toEqual(["J1", "J2"]);
    // J1 read, another write's task on it; then changed again here before J2 is read.
    expect(session.merge(variant("revision", "r2"), (id) => (id === "J1" ? some({ ...cut, task: "Panel cutting, oak" }) : undefined))).toBe("waiting");
    expect(setQty(session, "J1", { ...cut, qty: 5n }, 6n)).toBe(true);
    expect(session.merge(variant("revision", "r2"), (id) => (id === "J2" ? some(band) : undefined))).toBe("merged");
    expect([session.carrying, session.unsettled, session.pending, session.canApply]).toEqual([false, 0, 2, true]);
    expect(drafts(session.entries.get("J1"), { task: "Panel cutting, oak", qty: 6n })).toBe(true);
    expect(drafts(session.entries.get("J2"), { ...band, qty: 8n })).toBe(true);
});

test("another view's request for the source holds this view's Save and Discard, never its gestures", () => {
    let taken = true;
    const { session } = saving({ gate: { available: () => !taken, acquire: () => undefined, release: () => undefined } });
    expect(session.writable).toBe(true);
    expect(setQty(session, "J1", cut, 5n)).toBe(true);
    expect([session.canApply, session.canDiscard, session.canUndo]).toEqual([false, false, true]);
    taken = false;
    session.availabilityChanged();
    expect([session.canApply, session.canDiscard]).toEqual([true, true]);
});

test("what a Save landed is held as it was saved while a newer draft of the same entry stands over it", async () => {
    const { session, answer } = saving({ drawsLanded: true });
    setQty(session, "J1", cut, 5n);
    const save = session.apply();
    setQty(session, "J1", { ...cut, qty: 5n }, 6n);
    await answer(saved("r2"));
    await save;
    expect(session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }))).toBe(true);
    const landed = session.landed.get("J1")!;
    expect([drafts(landed.before, cut), drafts(landed.after, { ...cut, qty: 5n }), landed.from]).toEqual([true, true, "r1"]);
    expect(drafts(session.entries.get("J1"), { ...cut, qty: 6n })).toBe(true);
});
