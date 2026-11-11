/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What an automatic Save may send of a session's drafts (`autosave.ts` decides
 * when): every change made before an optimiser's result no person's Save has
 * taken, and none of the result or of what was made over it. A person's Save
 * takes the result, and an Undo takes it back; either ends the wait. Where the
 * history that held a result goes — the drafts carried over, a Save read back
 * beside another write, a reload — every draft waits for a person's Save.
 *
 * And none of what Undo or Redo stepped to (ruled 11 Nov 2026): an automatic
 * Save sends only from where the last change left the steps. Stepped away from
 * it, the drafts wait for a person's Save, which takes where they stand as
 * theirs, or for the next change, which is saved with what stands under it.
 */

import { expect, test } from "vitest";
import { IntegerType, StringType, StructType, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { AUTOSAVE_PAUSE_MS, createAutosave, type AutosaveClock } from "./autosave.js";
import { liftDraft } from "./draft.js";
import { EditHistory } from "./history.js";
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
/** Lets what a promise's answer sets going run to its end. */
const settled = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const saved = (revision: string): Answer => variant("applied", { revision: some(revision) });

/** A keyed session over the jobs at revision `r1`, its Saves answered when the test says. */
function saving(sourceId = "jobs", overrides: Partial<EditSessionBinding<Bar>> = {}) {
    const sent: ValueTypeOf<typeof JobBatch>[] = [];
    let out: { resolve: (result: Answer) => void; reject: (error: Error) => void } | undefined;
    let refreshed = 0;
    const session = new EditSession<Bar>({
        sourceId, entryType: Job, draftType: JobDraft, keyType: StringType, patch: undefined,
        refresh: () => { refreshed += 1; },
        apply: (bytes) => {
            sent.push(decodeBeast2For(JobBatch)(bytes));
            return new Promise<Answer>((resolve, reject) => { out = { resolve, reject }; });
        },
        ...overrides,
    });
    session.observeBase(variant("revision", "r1"));
    return {
        session, sent,
        refreshed: () => refreshed,
        answer: async (result: Answer) => { out!.resolve(result); await settled(); },
        fail: async (reason: string) => { out!.reject(new Error(reason)); await settled(); },
    };
}
/** Sets a job's quantity: one gesture of a person's, or an optimiser's result. */
const setQty = (session: EditSession<Bar>, id: string, from: JobValue, qty: bigint, by: "typed" | "optimise" = "typed"): boolean =>
    session.record([{ id, before: job(from), after: job({ ...from, qty }) }], by, by === "typed" ? "Set quantity" : "Elara run #1");
/** Each batch sent: its entries and the quantity each is left with. */
const batches = (sent: readonly ValueTypeOf<typeof JobBatch>[]) => sent.map((batch) => batch.changes.map((change) => change.id).sort());

test("its count of gestures moves with each gesture, Undo and Redo, and with nothing a Save does", async () => {
    const { session, answer } = saving();
    expect(session.edits).toBe(0);
    setQty(session, "J1", cut, 5n);
    session.undo();
    session.redo();
    expect(session.edits).toBe(3);
    const save = session.apply();
    await answer(saved("r2"));
    await save;
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    expect(session.edits).toBe(3);
    // A gesture during a Save counts as any other.
    setQty(session, "J2", band, 8n);
    expect(session.edits).toBe(4);
});

test("where its requests stand, as an automatic Save reads them: idle, sending, read back; a write left with no answer; a read back that failed", async () => {
    const { session, answer, fail } = saving();
    expect(session.saving).toBe("idle");
    setQty(session, "J1", cut, 5n);
    let save = session.apply();
    expect(session.saving).toBe("sending");
    await fail("The network dropped the answer");
    await save;
    expect(session.saving).toBe("unanswered");
    save = session.apply();
    expect(session.saving).toBe("sending");
    await answer(saved("r2"));
    await save;
    expect(session.saving).toBe("readingBack");
    session.confirmFailed("the read back was refused");
    expect(session.saving).toBe("readBackFailed");
    session.confirmFailed(undefined);
    expect(session.saving).toBe("readingBack");
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    expect(session.saving).toBe("idle");
    // A Save the source refuses leaves nothing unresolved.
    setQty(session, "J1", { ...cut, qty: 5n }, 6n);
    save = session.apply();
    await answer(variant("rejected", [{ entry: "J1", row: none, field: none, message: "At most 4" }]));
    await save;
    expect([session.status, session.saving, session.canAutosave]).toEqual(["rejected", "idle", false]);
});

test("with no optimiser's result drafted, an automatic Save sends what a person's would, and says whether the source took it", async () => {
    const { session, sent, answer } = saving();
    expect([session.canAutosave, session.autosaveHeld]).toEqual([false, false]);
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 8n);
    expect([session.canAutosave, session.autosaveHeld]).toEqual([true, false]);
    const going = session.autosave();
    expect([batches(sent), session.canAutosave]).toEqual([[["J1", "J2"]], false]);
    await answer(saved("r2"));
    expect(await going).toBe(true);
    // Refused: not taken.
    session.reconcile(variant("revision", "r2"), (id) => some(id === "J1" ? { ...cut, qty: 5n } : { ...band, qty: 8n }));
    setQty(session, "J1", { ...cut, qty: 5n }, 6n);
    const refused = session.autosave();
    await answer(variant("rejected", [{ entry: "J1", row: none, field: none, message: "At most 4" }]));
    expect(await refused).toBe(false);
});

test("an automatic Save with nothing it may send asks the source nothing, and a write left with no answer is not taken", async () => {
    const { session, sent, fail } = saving();
    expect(await session.autosave()).toBe(false);
    expect(sent).toEqual([]);
    setQty(session, "J1", cut, 5n);
    const going = session.autosave();
    await fail("The network dropped the answer");
    expect([await going, session.saving]).toEqual([false, "unanswered"]);
});

test("an automatic Save stops before an optimiser's result: what was changed before it is sent, the result and what was made over it wait for a person's Save", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J1", cut, 5n);
    // The optimiser changes J1 again and J2; then a person changes J3 over its result.
    session.record([
        { id: "J1", before: job({ ...cut, qty: 5n }), after: job({ ...cut, qty: 7n }) },
        { id: "J2", before: job(band), after: job({ ...band, qty: 9n }) },
    ], "optimise", "Elara run #1");
    setQty(session, "J3", route, 2n);
    expect([session.autosaveHeld, session.canAutosave, session.canApply]).toEqual([true, true, true]);
    const going = session.autosave();
    // J1 as the person left it, before the result: 5, and nothing of J2 or J3.
    expect(batches(sent)).toEqual([["J1"]]);
    await answer(saved("r2"));
    expect(await going).toBe(true);
    // Read back as the person left it, 5: exactly what was sent, so the history stands.
    expect(session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }))).toBe(true);
    expect(session.canUndo).toBe(true);
    // Saved: the result and what was made over it are what is left, and they wait.
    expect([session.pending, session.autosaveHeld, session.canAutosave, session.canApply]).toEqual([3, true, false, true]);
    expect(await session.autosave()).toBe(false);
    expect(batches(sent)).toEqual([["J1"]]);
    // A person's Save takes them all, and the wait is over.
    const save = session.apply();
    expect(batches(sent)).toEqual([["J1"], ["J1", "J2", "J3"]]);
    expect(session.autosaveHeld).toBe(false);
    await answer(saved("r3"));
    await save;
    session.reconcile(variant("revision", "r3"), (id) => some(id === "J1" ? { ...cut, qty: 7n } : id === "J2" ? { ...band, qty: 9n } : { ...route, qty: 2n }));
    // What is changed from here on is saved by itself again.
    setQty(session, "J3", { ...route, qty: 2n }, 3n);
    expect([session.autosaveHeld, session.canAutosave]).toEqual([false, true]);
});

test("a person's Save says nothing of what it takes before it is on its way: whoever hears the session finds the Save out at once, never drafts idle after the press", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 9n, "optimise");
    // What a host that waits for a Save hears, at each change of the session: its status then.
    const heard: string[] = [];
    session.subscribe(() => { heard.push(session.status); });
    const save = session.apply();
    expect(heard).toEqual(["applying"]);
    await answer(saved("r2"));
    await save;
    // A press that can send nothing still says what it took: the result waits for a person's Save no more.
    const waits = saving();
    setQty(waits.session, "J1", cut, 5n, "optimise");
    const sent = waits.session.apply();
    setQty(waits.session, "J2", band, 9n, "optimise");
    expect(waits.session.autosaveHeld).toBe(true);
    let said = 0;
    waits.session.subscribe(() => { said += 1; });
    await waits.session.apply();
    expect([waits.session.autosaveHeld, said > 0, waits.sent.length]).toEqual([false, true, 1]);
    void sent;
});

test("an optimiser's result first among the drafts: nothing is sent by itself", () => {
    const { session } = saving();
    setQty(session, "J1", cut, 7n, "optimise");
    setQty(session, "J2", band, 8n);
    expect([session.autosaveHeld, session.canAutosave, session.canApply]).toEqual([true, false, true]);
});

test("an Undo of the result ends the result's wait, and a Redo begins it again; the Undo itself is a step back, which sends nothing by itself — the next change does", () => {
    const { session, sent } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 9n, "optimise");
    expect(session.autosaveHeld).toBe(true);
    session.undo();
    // No result among the drafts: none waits. The change made before it, never saved, waits as what Undo left does.
    expect([session.autosaveHeld, session.autosaveStepped, session.canAutosave]).toEqual([false, true, false]);
    session.redo();
    expect([session.autosaveHeld, session.autosaveStepped]).toEqual([true, false]);
    // Undone again, and a change made there: the person's newest, saved by itself with the one under it.
    session.undo();
    setQty(session, "J3", route, 2n);
    expect([session.autosaveHeld, session.autosaveStepped, session.canAutosave]).toEqual([false, false, true]);
    void session.autosave();
    expect(batches(sent)).toEqual([["J1", "J3"]]);
});

test("a result a person's Save took, undone and redone, is a result to take again", () => {
    const { session } = saving();
    setQty(session, "J2", band, 9n, "optimise");
    session.undo();
    session.redo();
    expect(session.autosaveHeld).toBe(true);
    void session.apply();
    expect(session.autosaveHeld).toBe(false);
});

test("a result a person's Save took: undone and redone with nothing saved between, nothing is left to save and nothing waits; its Undo waits for a person's Save as any step back does, and saved by one, a Redo of the result waits for a person again", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J2", band, 9n, "optimise");
    const save = session.apply();
    await answer(saved("r2"));
    await save;
    session.reconcile(variant("revision", "r2"), () => some({ ...band, qty: 9n }));
    expect([session.pending, session.autosaveHeld]).toEqual([0, false]);
    // Undone: a step back, which no automatic Save sends. Redone: as it was saved.
    session.undo();
    expect([session.pending, session.autosaveHeld, session.autosaveStepped, session.canAutosave]).toEqual([1, false, true, false]);
    expect(await session.autosave()).toBe(false);
    session.redo();
    expect([session.pending, session.autosaveHeld, session.autosaveStepped, session.canAutosave]).toEqual([0, false, false, false]);
    // Undone, and saved by a person: the record holds none of the result now.
    session.undo();
    const undone = session.apply();
    expect(batches(sent)).toEqual([["J2"], ["J2"]]);
    await answer(saved("r3"));
    await undone;
    session.reconcile(variant("revision", "r3"), () => some(band));
    // Redone: the optimiser's result, which no Save holds any more, waits for a person's.
    session.redo();
    expect([session.pending, session.autosaveHeld, session.canAutosave, session.canApply]).toEqual([1, true, false, true]);
});

// ── Undo and Redo ───────────────────────────────────────────────────────────

test("an Undo or a Redo is never saved by itself: stepped away from where the last change left the steps, an automatic Save sends nothing; a person's Save sends what stands there as theirs, a step redone past it waits as well, and the next change is saved by itself with what stands", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const first = session.autosave();
    await answer(saved("r2"));
    expect(await first).toBe(true);
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    expect([session.pending, session.stepped, session.autosaveStepped, session.canAutosave]).toEqual([0, false, false, false]);
    // Stepped back to look: the saved change undone is a change to save, and it waits for a person's Save.
    session.undo();
    expect([session.pending, session.stepped, session.autosaveStepped, session.canAutosave, session.canApply]).toEqual([1, true, true, false, true]);
    expect(await session.autosave()).toBe(false);
    // Stepped forward again: as it was saved, nothing to send and nothing waiting.
    session.redo();
    expect([session.pending, session.stepped, session.autosaveStepped, session.canAutosave]).toEqual([0, false, false, false]);
    expect(batches(sent)).toEqual([["J1"]]);
    // Back again, and this time a person's Save: the state stepped to is saved, as theirs.
    session.undo();
    const save = session.apply();
    expect(batches(sent)).toEqual([["J1"], ["J1"]]);
    await answer(saved("r3"));
    await save;
    session.reconcile(variant("revision", "r3"), () => some(cut));
    expect([session.pending, session.stepped, session.autosaveStepped]).toEqual([0, false, false]);
    // The step Redo replays past it is an old change stepped to: it waits too.
    session.redo();
    expect([session.pending, session.stepped, session.autosaveStepped, session.canAutosave]).toEqual([1, true, true, false]);
    expect(await session.autosave()).toBe(false);
    // A new change made there is the person's newest: saved by itself, with what stands under it.
    setQty(session, "J2", band, 8n);
    expect([session.stepped, session.autosaveStepped, session.canAutosave]).toEqual([false, false, true]);
    void session.autosave();
    expect(batches(sent)).toEqual([["J1"], ["J1"], ["J1", "J2"]]);
});

test("stepped away from a change not yet saved and back to it, the change is saved by itself as any is: where the last change left the steps is where an automatic Save sends from", () => {
    const { session, sent } = saving();
    setQty(session, "J1", cut, 5n);
    session.undo();
    expect([session.pending, session.stepped, session.autosaveStepped, session.canAutosave]).toEqual([0, true, false, false]);
    session.redo();
    expect([session.pending, session.stepped, session.canAutosave]).toEqual([1, false, true]);
    void session.autosave();
    expect(batches(sent)).toEqual([["J1"]]);
});

test("a conflict chosen is a change as any is: made after a step back, it is saved by itself", () => {
    const { session } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 8n);
    session.undo();
    expect(session.stepped).toBe(true);
    // Another write changes J1 another way: carried over while stepped away, the draft waits, a conflict to choose.
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), (id) => some(id === "J1" ? { ...cut, qty: 9n } : band))).toBe("merged");
    expect([session.unsettled, session.autosaveStepped, session.canAutosave]).toEqual([1, true, false]);
    expect(session.settleAll("draft")).toBe(true);
    expect([session.unsettled, session.stepped, session.autosaveStepped, session.canAutosave]).toEqual([0, false, false, true]);
});

test("the history gone while the steps stood stepped away — the drafts carried over to a source that moved — the drafts wait for a person's Save, or for the next change", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const first = session.autosave();
    await answer(saved("r2"));
    await first;
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    session.undo();
    // Another write moves the source on: the draft Undo left is carried over, and nothing is left to step back with.
    session.observeBase(variant("revision", "r3"));
    expect(session.merge(variant("revision", "r3"), () => some({ ...cut, qty: 5n }))).toBe("merged");
    expect([session.canUndo, session.canRedo, session.pending, session.autosaveStepped, session.canAutosave, session.canApply]).toEqual([false, false, 1, true, false, true]);
    // The next change is the person's newest: saved by itself, with the draft under it.
    setQty(session, "J2", band, 8n);
    expect([session.autosaveStepped, session.canAutosave]).toEqual([false, true]);
    void session.autosave();
    expect(batches(sent)).toEqual([["J1"], ["J1", "J2"]]);
});

test("a step back whose drafts the source came to hold waits for nothing: carried over with none left, the next change is saved by itself", async () => {
    const { session, answer } = saving();
    setQty(session, "J1", cut, 5n);
    const first = session.autosave();
    await answer(saved("r2"));
    await first;
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    session.undo();
    // Another write puts J1 back as Undo left it: no draft is left.
    session.observeBase(variant("revision", "r3"));
    expect(session.merge(variant("revision", "r3"), () => some(cut))).toBe("merged");
    expect([session.pending, session.stepped, session.autosaveStepped]).toEqual([0, false, false]);
    setQty(session, "J2", band, 8n);
    expect(session.canAutosave).toBe(true);
});

test("stepped back and discarded, nothing waits: the next change is saved by itself", () => {
    const { session } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 8n);
    session.undo();
    session.discard();
    expect([session.stepped, session.autosaveStepped]).toEqual([false, false]);
    setQty(session, "J3", route, 2n);
    expect(session.canAutosave).toBe(true);
});

test("what an automatic Save sends passes its checks as it stood then: a draft left incomplete after the result holds nothing back, one left incomplete before it holds it all", () => {
    const incomplete: EntryVersion<Bar> = { draft: { task: variant("value", "Sanding"), qty: variant("missing", null) }, wire: { key: "Sanding", caption: "" }, place: keyOrder };
    const after = saving();
    setQty(after.session, "J1", cut, 5n);
    setQty(after.session, "J2", band, 9n, "optimise");
    after.session.record([{ id: "J3", before: job(route), after: incomplete }], "typed", "Clear the quantity");
    expect([after.session.canApply, after.session.canAutosave]).toEqual([false, true]);
    const before = saving();
    before.session.record([{ id: "J3", before: job(route), after: incomplete }], "typed", "Clear the quantity");
    setQty(before.session, "J2", band, 9n, "optimise");
    expect([before.session.canApply, before.session.canAutosave]).toEqual([false, false]);
});

test("the history gone while it held a result — the drafts carried over to a source that moved — every draft waits for a person's Save; saved, the next change goes by itself", async () => {
    const { session, sent, answer } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 9n, "optimise");
    // Another write moves the source on: the drafts are carried over, and their history goes.
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), (id) => some(id === "J1" ? cut : band))).toBe("merged");
    expect([session.canUndo, session.pending, session.autosaveHeld, session.canAutosave, session.canApply]).toEqual([false, 2, true, false, true]);
    // A change made since waits with them.
    setQty(session, "J3", route, 2n);
    expect([session.autosaveHeld, session.canAutosave]).toEqual([true, false]);
    const save = session.apply();
    expect([batches(sent), session.autosaveHeld]).toEqual([[["J1", "J2", "J3"]], false]);
    await answer(saved("r3"));
    await save;
    session.reconcile(variant("revision", "r3"), (id) => some(id === "J1" ? { ...cut, qty: 5n } : id === "J2" ? { ...band, qty: 9n } : { ...route, qty: 2n }));
    setQty(session, "J3", { ...route, qty: 2n }, 3n);
    expect([session.autosaveHeld, session.canAutosave]).toEqual([false, true]);
});

test("a history gone with no result held holds nothing: the drafts carried over are saved by themselves", () => {
    const { session } = saving();
    setQty(session, "J1", cut, 5n);
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), () => some(cut))).toBe("merged");
    expect([session.pending, session.autosaveHeld, session.canAutosave]).toEqual([1, false, true]);
});

test("a held result discarded, nothing waits: the next change is saved by itself", () => {
    const { session } = saving();
    setQty(session, "J2", band, 9n, "optimise");
    session.discard();
    setQty(session, "J1", cut, 5n);
    expect([session.autosaveHeld, session.canAutosave]).toEqual([false, true]);
});

test("ask again: a write left with no answer is sent again, its id unchanged, and a read back is asked for again", async () => {
    const { session, sent, answer, fail, refreshed } = saving();
    setQty(session, "J1", cut, 5n);
    const going = session.autosave();
    await fail("The network dropped the answer");
    await going;
    session.retry();
    expect([sent.length, sent[1]!.requestId === sent[0]!.requestId, session.saving]).toEqual([2, true, "sending"]);
    await answer(saved("r2"));
    await settled();
    const asked = refreshed();
    session.retry();
    expect([session.saving, refreshed()]).toEqual(["readingBack", asked + 1]);
    // Nothing unresolved: nothing is asked.
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    session.retry();
    expect([sent.length, refreshed()]).toEqual([2, asked + 1]);
});

test("a person's Retry of an automatic Save left with no answer takes nothing more: the result still waits", async () => {
    const { session, sent, fail } = saving();
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 9n, "optimise");
    const going = session.autosave();
    await fail("The network dropped the answer");
    await going;
    void session.apply();
    expect([batches(sent), session.autosaveHeld]).toEqual([[["J1"], ["J1"]], true]);
});

// ── One history over several sessions ───────────────────────────────────────

/** Two sessions, the jobs' and the shifts', under one history. */
function several() {
    const jobs = saving("jobs");
    const shifts = saving("shifts");
    const stops = saving("stops");
    const history = new EditHistory<Bar>();
    history.sync([["jobs", jobs.session], ["shifts", shifts.session], ["stops", stops.session]]);
    const change = (key: string, id: string, from: JobValue, qty: bigint) => ({ key, updates: [{ id, before: job(from), after: job({ ...from, qty }) }] });
    return { history, jobs, shifts, stops, change };
}

test("over several records the wait is the history's: what was changed before the result, in any record, is sent; the result and every change made after it, in any record, wait", async () => {
    const { history, jobs, shifts, stops, change } = several();
    const edits = history.edits;
    history.record([change("jobs", "J1", cut, 5n)], "typed", "Set quantity");
    expect(history.edits).toBeGreaterThan(edits);
    // The optimiser's result across the jobs and the shifts; then a person changes a stop, a record it never touched.
    history.record([change("jobs", "J2", band, 9n), change("shifts", "J1", cut, 3n)], "optimise", "Elara run #1");
    history.record([change("stops", "J3", route, 2n)], "typed", "Set quantity");
    expect([history.autosaveHeld, history.canAutosave]).toEqual([true, true]);
    const going = history.autosave();
    expect([batches(jobs.sent), batches(shifts.sent), batches(stops.sent)]).toEqual([[["J1"]], [], []]);
    await jobs.answer(saved("r2"));
    expect(await going).toBe(true);
    jobs.session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    expect([history.pending, history.autosaveHeld, history.canAutosave]).toEqual([3, true, false]);
    // A person's Save takes every record's.
    void history.apply();
    expect([batches(jobs.sent), batches(shifts.sent), batches(stops.sent), history.autosaveHeld]).toEqual([[["J1"], ["J2"]], [["J1"]], [["J3"]], false]);
});

test("over several records an Undo of the result ends the wait for them all", () => {
    const { history, change } = several();
    history.record([change("jobs", "J2", band, 9n), change("shifts", "J1", cut, 3n)], "optimise", "Elara run #1");
    history.record([change("stops", "J3", route, 2n)], "typed", "Set quantity");
    expect([history.autosaveHeld, history.canAutosave]).toEqual([true, false]);
    history.undo();
    history.undo();
    expect(history.autosaveHeld).toBe(false);
    history.record([change("stops", "J3", route, 4n)], "typed", "Set quantity");
    expect([history.autosaveHeld, history.canAutosave]).toEqual([false, true]);
});

test("over several records the step back is the history's: an Undo in one record holds every record's changes back, and back at the newest change they go by themselves", () => {
    const { history, jobs, shifts, change } = several();
    history.record([change("jobs", "J1", cut, 5n)], "typed", "Set quantity");
    history.record([change("shifts", "J1", cut, 3n)], "typed", "Set quantity");
    expect([history.autosaveStepped, history.canAutosave]).toEqual([false, true]);
    // The shifts' change undone: the jobs' own steps stand where its last change left them, but the history's do not.
    history.undo();
    expect([jobs.session.stepped, history.pending, history.autosaveStepped, history.canAutosave, history.canApply]).toEqual([false, 1, true, false, true]);
    history.redo();
    expect([history.pending, history.autosaveStepped, history.canAutosave]).toEqual([2, false, true]);
    void history.autosave();
    expect([batches(jobs.sent), batches(shifts.sent)]).toEqual([[["J1"]], [["J1"]]]);
});

test("over several records a person's Save takes a step back as theirs, a step redone past it waits, and a change made in any record after is saved with what stands in every one", async () => {
    const { history, jobs, shifts, stops, change } = several();
    history.record([change("jobs", "J1", cut, 5n)], "typed", "Set quantity");
    history.record([change("shifts", "J1", cut, 3n)], "typed", "Set quantity");
    const first = history.autosave();
    await jobs.answer(saved("r2"));
    await shifts.answer(saved("r2"));
    await first;
    jobs.session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    shifts.session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 3n }));
    expect(history.pending).toBe(0);
    // Back over the shifts' change, and a person's Save of what stands there.
    history.undo();
    expect([history.pending, history.autosaveStepped, history.canAutosave]).toEqual([1, true, false]);
    expect(await history.autosave()).toBe(false);
    const save = history.apply();
    expect(batches(shifts.sent)).toEqual([["J1"], ["J1"]]);
    await shifts.answer(saved("r3"));
    await save;
    shifts.session.reconcile(variant("revision", "r3"), () => some(cut));
    expect([history.pending, history.autosaveStepped]).toEqual([0, false]);
    // Redone past the Save: an old change stepped to, which waits.
    history.redo();
    expect([history.pending, history.autosaveStepped, history.canAutosave]).toEqual([1, true, false]);
    // A change in a record the step never touched: the newest change is the history's, and what stands in each goes with it.
    history.record([change("stops", "J3", route, 2n)], "typed", "Set quantity");
    expect([history.autosaveStepped, history.canAutosave]).toEqual([false, true]);
    void history.autosave();
    expect([batches(jobs.sent), batches(shifts.sent), batches(stops.sent)]).toEqual([[["J1"]], [["J1"], ["J1"], ["J1"]], [["J3"]]]);
});

test("over several records, a record discarded on its own while the history stood stepped back over it leaves the others where their last change did", () => {
    const { history, jobs, change } = several();
    history.record([change("jobs", "J1", cut, 5n)], "typed", "Set quantity");
    history.record([change("shifts", "J1", cut, 3n)], "typed", "Set quantity");
    history.undo();
    expect([history.autosaveStepped, history.canAutosave]).toEqual([true, false]);
    // The shifts' drafts dropped, its undone step with them: every step the history has left is done.
    history.actOn("shifts", "discard");
    expect([history.canRedo, history.autosaveStepped, history.canAutosave]).toEqual([false, false, true]);
    void history.autosave();
    expect(batches(jobs.sent)).toEqual([["J1"]]);
});

test("over several records, where their requests stand is the most pressing one's, and ask again asks each", async () => {
    const { history, jobs, shifts, change } = several();
    expect(history.saving).toBe("idle");
    history.record([change("jobs", "J1", cut, 5n)], "typed", "Set quantity");
    history.record([change("shifts", "J1", cut, 3n)], "typed", "Set quantity");
    const going = history.autosave();
    expect(history.saving).toBe("sending");
    await jobs.fail("The network dropped the answer");
    expect(history.saving).toBe("unanswered");
    await shifts.answer(saved("r2"));
    expect([await going, history.saving]).toEqual([false, "unanswered"]);
    history.retry();
    expect([jobs.sent.length, jobs.sent[1]!.requestId === jobs.sent[0]!.requestId]).toEqual([2, true]);
    await jobs.answer(saved("r2"));
    await settled();
    expect(history.saving).toBe("readingBack");
});

// ── The timer over a session ───────────────────────────────────────────────

/** A clock the test moves. */
function testClock() {
    let now = 0;
    let serial = 0;
    const waits = new Map<number, { at: number; run: () => void }>();
    const clock: AutosaveClock = {
        now: () => now,
        after: (ms, run) => {
            const id = serial++;
            waits.set(id, { at: now + ms, run });
            return () => { waits.delete(id); };
        },
    };
    const advance = (ms: number): void => {
        const end = now + ms;
        for (;;) {
            let next: { id: number; at: number; run: () => void } | undefined;
            for (const [id, wait] of waits) if (wait.at <= end && (next === undefined || wait.at < next.at)) next = { id, ...wait };
            if (next === undefined) break;
            waits.delete(next.id);
            now = Math.max(now, next.at);
            next.run();
        }
        now = end;
    };
    return { clock, advance };
}

test("turned on over a session, changes are saved a pause after the last, one request at a time, and a change made while one is out goes once it is read back", async () => {
    const { session, sent, answer } = saving();
    const { clock, advance } = testClock();
    const autosave = createAutosave(session, clock);
    autosave.enable(true);
    setQty(session, "J1", cut, 5n);
    advance(AUTOSAVE_PAUSE_MS - 1);
    expect(sent).toHaveLength(0);
    advance(1);
    expect(batches(sent)).toEqual([["J1"]]);
    // A change while the Save is out: taken, and sent once the first is read back.
    setQty(session, "J2", band, 8n);
    advance(60_000);
    expect(sent).toHaveLength(1);
    await answer(saved("r2"));
    advance(60_000);
    expect(sent).toHaveLength(1);
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    advance(0);
    expect(batches(sent)).toEqual([["J1"], ["J2"]]);
    autosave.dispose();
});

test("turned on over a session, an optimiser's result is never sent by itself: what was changed before it goes, and after a person's Save the timer carries on", async () => {
    const { session, sent, answer } = saving();
    const { clock, advance } = testClock();
    const autosave = createAutosave(session, clock);
    autosave.enable(true);
    setQty(session, "J1", cut, 5n);
    setQty(session, "J2", band, 9n, "optimise");
    advance(AUTOSAVE_PAUSE_MS);
    expect(batches(sent)).toEqual([["J1"]]);
    await answer(saved("r2"));
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    advance(600_000);
    expect(sent).toHaveLength(1);
    void session.apply();
    expect(batches(sent)).toEqual([["J1"], ["J2"]]);
    await answer(saved("r3"));
    session.reconcile(variant("revision", "r3"), () => some({ ...band, qty: 9n }));
    setQty(session, "J3", route, 2n);
    advance(AUTOSAVE_PAUSE_MS);
    expect(batches(sent)).toEqual([["J1"], ["J2"], ["J3"]]);
    autosave.dispose();
});

test("turned on over a session, a step back or forward sends nothing however long it stands there, nor does a tab hidden; a new change is saved a pause after it, with what stands", async () => {
    const { session, sent, answer } = saving();
    const { clock, advance } = testClock();
    const autosave = createAutosave(session, clock);
    autosave.enable(true);
    setQty(session, "J1", cut, 5n);
    advance(AUTOSAVE_PAUSE_MS);
    await answer(saved("r2"));
    session.reconcile(variant("revision", "r2"), () => some({ ...cut, qty: 5n }));
    expect(batches(sent)).toEqual([["J1"]]);
    // Back to look, for ten minutes: nothing is sent, and a tab hidden meanwhile sends nothing either.
    session.undo();
    advance(600_000);
    autosave.flush();
    expect([sent.length, session.pending]).toEqual([1, 1]);
    // Forward again: as saved.
    session.redo();
    advance(600_000);
    expect([sent.length, session.pending]).toEqual([1, 0]);
    // Back, then a new change: the pause after it, and one Save of what stands — the step back and the change.
    session.undo();
    setQty(session, "J2", band, 8n);
    advance(AUTOSAVE_PAUSE_MS - 1);
    expect(sent).toHaveLength(1);
    advance(1);
    expect(batches(sent)).toEqual([["J1"], ["J1", "J2"]]);
    autosave.dispose();
});
