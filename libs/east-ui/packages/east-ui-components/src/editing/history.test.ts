/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * One history over several editing sessions (#1194): each session a keyed
 * source read whole, as an event kind's record is — a press's jobs, its
 * stops, a crew's shifts. Undo and Redo step through the gestures in the
 * order they were made whatever their session, a gesture across sessions is
 * one step, Discard drops every session's drafts, and Save commits each
 * session as its own request: one session's conflict leaves the others
 * committed, and a write with no answer is retried alone, its request id
 * unchanged.
 */

import { expect, test } from "vitest";
import { FloatType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { EditHistory } from "./history.js";
import { EditSession, type EditSessionBinding, type EntryVersion } from "./session.js";

const Job = StructType({ title: StringType, sheets: FloatType });
const JobDraft = Editing.Types.DraftField(Job);
const Batch = Editing.Types.ChangeSet(Job, StringType);
type JobValue = ValueTypeOf<typeof Job>;
type ApplyResult = ValueTypeOf<typeof Editing.Types.ApplyResult>;

const KEY_ORDER = some(variant("keyOrder", null));
const decodeBatch = decodeBeast2For(Batch);
/** An entry's version: the job drafted whole. */
const job = (value: JobValue): EntryVersion<string> => ({ draft: liftDraft(JobDraft, value), wire: value.title, place: KEY_ORDER });
/** A source's entries, as East holds a Dict. */
const held = (entries: readonly (readonly [string, JobValue])[]) => new SortedMap(entries.map(([k, v]) => [k, v] as [string, JobValue]), compareFor(StringType));

/** The print works' three sources: each one job, read whole. */
const SOURCES = {
    jobs: { id: "J-1", job: { title: "Spring catalogue", sheets: 96000.0 } },
    stops: { id: "S-1", job: { title: "Plate change", sheets: 0.0 } },
    shifts: { id: "SH-1", job: { title: "Early", sheets: 0.0 } },
} as const;
type Source = keyof typeof SOURCES;

/** A keyed session over one source, read whole, its Save answering as given. */
function session(source: Source, overrides: Partial<EditSessionBinding<string>> = {}): EditSession<string> {
    const { id, job: value } = SOURCES[source];
    const made = new EditSession<string>({
        sourceId: source, entryType: Job, draftType: JobDraft, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined, ...overrides,
    });
    made.observeBase(variant("snapshot", held([[id, value]])));
    return made;
}

/** The three sessions under one history. */
function setup(overrides: Partial<Record<Source, Partial<EditSessionBinding<string>>>> = {}) {
    const sessions = {
        jobs: session("jobs", overrides.jobs),
        stops: session("stops", overrides.stops),
        shifts: session("shifts", overrides.shifts),
    };
    const history = new EditHistory<string>();
    history.sync(Object.entries(sessions));
    return { history, sessions };
}

/** One source's entry renamed: its gesture's part. */
function rename(source: Source, from: string, to: string) {
    const { id, job: value } = SOURCES[source];
    return { key: source, updates: [{ id, before: job({ ...value, title: from }), after: job({ ...value, title: to }) }] };
}

/** A source's one entry's title, as its session holds it now. */
function titleOf(sessions: Record<Source, EditSession<string>>, source: Source): string {
    const entry = sessions[source].entries.get(SOURCES[source].id);
    if (entry === undefined) return SOURCES[source].job.title;
    return (entry.draft as { value: JobValue }).value.title;
}

/** Every source's title, in order. */
const titles = (sessions: Record<Source, EditSession<string>>) => (["jobs", "stops", "shifts"] as const).map((s) => titleOf(sessions, s));

test("Undo and Redo step through the gestures in the order they were made, whatever their session", () => {
    const { history, sessions } = setup();
    expect(history.record([rename("jobs", "Spring catalogue", "Spring catalogue, A4")], "typed", "Edit job")).toBe(true);
    expect(history.record([rename("shifts", "Early", "Early, hall A")], "typed", "Edit shift")).toBe(true);
    expect(history.record([rename("jobs", "Spring catalogue, A4", "Spring catalogue, A5")], "typed", "Edit job")).toBe(true);
    expect(history.record([rename("stops", "Plate change", "Plate change, press A1")], "typed", "Edit stop")).toBe(true);
    expect(titles(sessions)).toEqual(["Spring catalogue, A5", "Plate change, press A1", "Early, hall A"]);
    // Back, a gesture at a time: the stop, the job's second, the shift, the job's first.
    const back: string[][] = [];
    while (history.canUndo) { history.undo(); back.push(titles(sessions)); }
    expect(back).toEqual([
        ["Spring catalogue, A5", "Plate change", "Early, hall A"],
        ["Spring catalogue, A4", "Plate change", "Early, hall A"],
        ["Spring catalogue, A4", "Plate change", "Early"],
        ["Spring catalogue", "Plate change", "Early"],
    ]);
    // And forward, in the same order.
    const forward: string[][] = [];
    while (history.canRedo) { history.redo(); forward.push(titles(sessions)); }
    expect(forward).toEqual([
        ["Spring catalogue, A4", "Plate change", "Early"],
        ["Spring catalogue, A4", "Plate change", "Early, hall A"],
        ["Spring catalogue, A5", "Plate change", "Early, hall A"],
        ["Spring catalogue, A5", "Plate change, press A1", "Early, hall A"],
    ]);
    expect(history.pending).toBe(3);
});

test("a gesture across sessions is one step: one Undo takes it back in each, one Redo replays it in each", () => {
    const { history, sessions } = setup();
    expect(history.record([rename("jobs", "Spring catalogue", "Moved"), rename("shifts", "Early", "Moved")], "move", "Shift 2 events")).toBe(true);
    expect(titles(sessions)).toEqual(["Moved", "Plate change", "Moved"]);
    history.undo();
    expect(titles(sessions)).toEqual(["Spring catalogue", "Plate change", "Early"]);
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(titles(sessions)).toEqual(["Moved", "Plate change", "Moved"]);
    // Each session holds it as one transaction of its own.
    expect([sessions.jobs.depth, sessions.stops.depth, sessions.shifts.depth]).toEqual([{ undo: 1, redo: 0 }, { undo: 0, redo: 0 }, { undo: 1, redo: 0 }]);
    // A session named twice in one gesture is refused: its entries are composed first.
    expect(() => history.record([rename("jobs", "Moved", "A"), rename("jobs", "Moved", "B")], "typed", "Twice")).toThrow();
});

test("a new gesture drops what Redo could replay — in every session, not only its own", () => {
    const { history, sessions } = setup();
    history.record([rename("jobs", "Spring catalogue", "One")], "typed", "Edit job");
    history.record([rename("shifts", "Early", "Two")], "typed", "Edit shift");
    history.undo();
    history.undo();
    expect(history.canRedo).toBe(true);
    history.record([rename("stops", "Plate change", "Three")], "typed", "Edit stop");
    expect(history.canRedo).toBe(false);
    // Neither session left anything to replay of its own.
    expect([sessions.jobs.canRedo, sessions.shifts.canRedo]).toEqual([false, false]);
    expect(titles(sessions)).toEqual(["Spring catalogue", "Three", "Early"]);
});

test("Discard drops every session's drafts, and the steps with them", () => {
    const { history, sessions } = setup();
    history.record([rename("jobs", "Spring catalogue", "One")], "typed", "Edit job");
    history.record([rename("stops", "Plate change", "Two")], "typed", "Edit stop");
    history.record([rename("shifts", "Early", "Three")], "typed", "Edit shift");
    expect(history.pending).toBe(3);
    history.discard();
    expect(history.pending).toBe(0);
    expect(titles(sessions)).toEqual(["Spring catalogue", "Plate change", "Early"]);
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
});

test("Save commits each session with a change as its own request; one session's conflict keeps its drafts and leaves the others committed", async () => {
    const sent: Record<Source, number> = { jobs: 0, stops: 0, shifts: 0 };
    const answer = (source: Source, result: ApplyResult) => () => { sent[source] += 1; return result; };
    const conflict: ApplyResult = variant("conflict", [{ entry: "S-1", row: none, field: none, message: "Changed since this edit began" }]);
    const { history, sessions } = setup({
        jobs: { apply: answer("jobs", variant("applied", { revision: none })) },
        stops: { apply: answer("stops", conflict) },
        shifts: { apply: answer("shifts", variant("applied", { revision: none })) },
    });
    history.record([rename("jobs", "Spring catalogue", "One")], "typed", "Edit job");
    history.record([rename("stops", "Plate change", "Two")], "typed", "Edit stop");
    expect(history.canApply).toBe(true);
    await history.apply();
    // The shifts had no change: nothing sent for them; each other source once.
    expect(sent).toEqual({ jobs: 1, stops: 1, shifts: 0 });
    expect([sessions.jobs.status, sessions.stops.status, sessions.shifts.status]).toEqual(["reconciling", "conflict", "idle"]);
    expect(history.status).toBe("reconciling");
    // The jobs read back as their commit left them: they retire; the stop's draft stays under its conflict.
    expect(sessions.jobs.reconcile(variant("snapshot", held([["J-1", { title: "One", sheets: 96000.0 }]])), () => undefined)).toBe(true);
    expect(history.status).toBe("conflict");
    expect(sessions.jobs.pending).toBe(0);
    expect(titleOf(sessions, "stops")).toBe("Two");
    expect(history.pending).toBe(1);
    // The issue is the stops': the history names its session.
    expect(history.sourceOf(history.issues[0]!)).toBe("stops");
    // Nothing else may be sent until the stops' conflict is resolved: the jobs have no change.
    expect(history.canApply).toBe(false);
});

test("a write with no answer leaves its session unknown: Save is Retry for it alone, which resends its request, its id unchanged", async () => {
    const requests: string[] = [];
    let lost = true;
    const { history, sessions } = setup({
        jobs: { apply: (bytes) => {
            requests.push(decodeBatch(bytes).requestId);
            if (lost) { lost = false; throw new Error("The connection closed"); }
            return variant("applied", { revision: none });
        } },
    });
    const shiftsSent: number[] = [];
    sessions.shifts.bind({
        sourceId: "shifts", entryType: Job, draftType: JobDraft, keyType: StringType, auto: false, patch: undefined, refresh: undefined,
        apply: () => { shiftsSent.push(1); return variant("applied", { revision: none }); },
    });
    history.record([rename("jobs", "Spring catalogue", "One")], "typed", "Edit job");
    history.record([rename("shifts", "Early", "Two")], "typed", "Edit shift");
    await history.apply();
    expect(history.status).toBe("unknown");
    expect(sessions.shifts.status).toBe("reconciling");
    expect(shiftsSent).toHaveLength(1);
    // While the jobs' write stands unanswered, no gesture of theirs can be undone.
    expect(sessions.jobs.writable).toBe(false);
    await history.apply();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    // The shifts' request is not sent again.
    expect(shiftsSent).toHaveLength(1);
    expect(sessions.jobs.status).toBe("reconciling");
});

test("Save is held while one session's drafts fail its checks, however ready another's are", () => {
    const { history, sessions } = setup();
    history.record([rename("jobs", "Spring catalogue", "One")], "typed", "Edit job");
    expect(history.canApply).toBe(true);
    // A stop whose draft cannot be read: invalid.
    const value = SOURCES.stops.job;
    const unread: EntryVersion<string> = { draft: variant("invalid", "plate chnage"), wire: value.title, place: KEY_ORDER };
    history.record([{ key: "stops", updates: [{ id: "S-1", before: job(value), after: unread }] }], "typed", "Edit stop");
    expect(sessions.jobs.canApply).toBe(true);
    expect(history.readiness.type).toBe("invalid");
    expect(history.canApply).toBe(false);
});

test("a session whose own history goes leaves the steps — its source moving under no draft, its drafts discarded from its banner — and the others' stand", () => {
    const { history, sessions } = setup();
    history.record([rename("jobs", "Spring catalogue", "One")], "typed", "Edit job");
    history.record([rename("shifts", "Early", "Two")], "typed", "Edit shift");
    history.record([rename("stops", "Plate change", "Three")], "typed", "Edit stop");
    // The job's gesture undone with the rest, then its source moves: the jobs session starts afresh.
    history.undo();
    history.undo();
    history.undo();
    sessions.jobs.observeBase(variant("snapshot", held([["J-1", { title: "Spring catalogue, reprint", sheets: 96000.0 }]])));
    expect(sessions.jobs.depth).toEqual({ undo: 0, redo: 0 });
    // Redo replays the shift's, then the stop's — the job's step is gone.
    history.redo();
    expect(titles(sessions)).toEqual(["Spring catalogue", "Plate change", "Two"]);
    history.redo();
    expect(titles(sessions)).toEqual(["Spring catalogue", "Three", "Two"]);
    expect(history.canRedo).toBe(false);
    // The stops' drafts discarded from their banner: their step goes, the shift's stands.
    history.actOn("stops", "discard");
    expect(titles(sessions)).toEqual(["Spring catalogue", "Plate change", "Two"]);
    history.undo();
    expect(titles(sessions)).toEqual(["Spring catalogue", "Plate change", "Early"]);
    expect(history.canUndo).toBe(false);
});

test("it reads as one session does: its pending changes summed, out of date while one session is, and a sync that takes a session away takes its steps", () => {
    const { history, sessions } = setup();
    let heard = 0;
    history.subscribe(() => { heard += 1; });
    history.record([rename("jobs", "Spring catalogue", "One")], "typed", "Edit job");
    history.record([rename("shifts", "Early", "Two")], "typed", "Edit shift");
    // One notice per gesture, however many its sessions sent.
    expect(heard).toBe(2);
    expect(history.pending).toBe(2);
    expect(history.stale).toBe(false);
    // The shifts' source moves under its draft: out of date.
    sessions.shifts.observeBase(variant("snapshot", held([["SH-1", { title: "Early, moved", sheets: 0.0 }]])));
    expect(history.stale).toBe(true);
    expect(history.canApply).toBe(true);
    // The shifts leave the history: their step with them.
    history.sync([["jobs", sessions.jobs], ["stops", sessions.stops]]);
    expect(history.keys).toEqual(["jobs", "stops"]);
    expect(history.pending).toBe(1);
    history.undo();
    expect(titleOf(sessions, "jobs")).toBe("Spring catalogue");
    expect(history.canUndo).toBe(false);
});
