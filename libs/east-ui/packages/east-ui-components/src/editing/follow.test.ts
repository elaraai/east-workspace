/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A session's entries followed through its history from a point of it
 * (`EditSession.point`, `EditSession.follow`; ruling 16 of
 * east-workspace#1709), over a keyed source of the print works' jobs: an entry
 * a gesture moved under another id — a row its builder moved under the key its
 * fields build, which says where it came from (`EntryUpdate.from`) — is followed
 * there, back again by Undo and on again by Redo, along every step done since
 * the point and through a gesture that joins the last; back through the point's
 * own step once Undo takes it back; through a carry-over that gave a new entry
 * another id; and in each session of one history. An entry whose id another
 * entry comes to stand under stands under no id of its own; a point whose step
 * the history dropped follows nothing.
 *
 * And the moves a session's drafts hold (`EditSession.moved`): a moved entry
 * is the entry its source holds under the id it had — through Undo and Redo,
 * a move on, a carry-over and a Save — and what the last Undo or Redo put back
 * under another id (`EditSession.rekeyed`), which a host follows its selection
 * by.
 */

import { expect, test } from "vitest";
import { FloatType, SortedMap, StringType, StructType, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft.js";
import { EditHistory } from "./history.js";
import type { EntryKeys } from "./keys.js";
import { EditSession, type EditSessionBinding, type EntryUpdate, type EntryVersion } from "./session.js";

const Job = StructType({ title: StringType, sheets: FloatType });
const JobDraft = Editing.Types.DraftField(Job);
type JobValue = ValueTypeOf<typeof Job>;

const KEY_ORDER = some(variant("keyOrder", null));
/** An entry's version: the job drafted whole. */
const job = (value: JobValue): EntryVersion<string> => ({ draft: liftDraft(JobDraft, value), wire: value.title, place: KEY_ORDER });
/** An entry absent: removed, or not made yet. */
const ABSENT: EntryVersion<string> = { draft: undefined, wire: undefined, place: none };

const SPRING = { title: "Spring catalogue", sheets: 96000.0 };
const POSTERS = { title: "Shop posters", sheets: 24000.0 };
const COVERS = { title: "Catalogue covers", sheets: 12000.0 };

/** A keyed session over the jobs, read whole: J-1 the spring catalogue, J-2 the shop posters. */
function jobs(overrides: Partial<EditSessionBinding<string>> = {}): EditSession<string> {
    const made = new EditSession<string>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined, ...overrides,
    });
    made.observeBase(variant("snapshot", new SortedMap<string, JobValue>([["J-1", SPRING], ["J-2", POSTERS]], compareFor(StringType))));
    return made;
}

/** A gesture's updates that move a job from one id to another, as it was: what a builder records as a row goes under the key its fields build. */
const moved = (from: string, to: string, value: JobValue): EntryUpdate<string>[] => [
    { id: from, before: job(value), after: ABSENT },
    { id: to, before: ABSENT, after: job(value), from },
];

test("ruling 16 — an entry a gesture moved under another id is followed there from a point before it; Undo takes it back under the id it had, Redo there again; an entry the gesture did not move stands where it stood", () => {
    const session = jobs();
    const point = session.point();
    expect(session.record(moved("J-1", "Spring", SPRING), "typed", "Edit job")).toBe(true);
    const now = () => session.follow(point)!;
    expect([now()("J-1"), now()("J-2")]).toEqual(["Spring", "J-2"]);
    session.undo();
    expect(now()("J-1")).toBe("J-1");
    session.redo();
    expect(now()("J-1")).toBe("Spring");
});

test("ruling 16 — moves chain along the steps done since a point, and a point taken between them follows from where the entries stood then", () => {
    const session = jobs();
    const first = session.point();
    session.record(moved("J-1", "A", SPRING), "typed", "Edit job");
    const between = session.point();
    session.record(moved("A", "B", SPRING), "typed", "Edit job");
    expect([session.follow(first)!("J-1"), session.follow(between)!("A")]).toEqual(["B", "B"]);
    // One step back: from the first point, under A; from the second, where it stood.
    session.undo();
    expect([session.follow(first)!("J-1"), session.follow(between)!("A")]).toEqual(["A", "A"]);
});

test("ruling 16 — an entry removed whose id another entry then comes to stand under, moved there or made there, stands under no id of its own; the entry moved there is followed to it", () => {
    const session = jobs();
    const point = session.point();
    session.record([{ id: "J-1", before: job(SPRING), after: ABSENT }], "remove", "Delete row");
    // Removed, it stands under its id still: nothing has come there.
    expect(session.follow(point)!("J-1")).toBe("J-1");
    session.record(moved("J-2", "J-1", POSTERS), "typed", "Edit job");
    expect([session.follow(point)!("J-1"), session.follow(point)!("J-2")]).toEqual([undefined, "J-1"]);

    const made = jobs();
    const before = made.point();
    made.record([{ id: "J-1", before: job(SPRING), after: ABSENT }], "remove", "Delete row");
    made.record([{ id: "J-1", before: ABSENT, after: job(COVERS) }], "insert", "Insert row");
    expect(made.follow(before)!("J-1")).toBeUndefined();
});

test("ruling 16 — a gesture that joins the last step moves its entry on from where the last one found it: one step, J-1 to C, and one Undo back to J-1", () => {
    const session = jobs();
    const point = session.point();
    session.record(moved("J-1", "B", SPRING), "typed", "Edit cell", "cell");
    session.record(moved("B", "C", SPRING), "typed", "Edit cell", "cell");
    expect([session.depth.undo, session.follow(point)!("J-1")]).toEqual([1, "C"]);
    session.undo();
    expect(session.follow(point)!("J-1")).toBe("J-1");
});

test("ruling 16 — Undo of the step a point was taken after follows its entries back through it: one it moved back under the id it had, one it made under none, one it removed where it stood; Redo on again", () => {
    const session = jobs();
    session.record([...moved("J-1", "A", SPRING), { id: "J-3", before: ABSENT, after: job(COVERS) }, { id: "J-2", before: job(POSTERS), after: ABSENT }], "optimise", "Elara run #1");
    const point = session.point();
    session.undo();
    const back = session.follow(point)!;
    expect([back("A"), back("J-3"), back("J-2")]).toEqual(["J-1", undefined, "J-2"]);
    session.redo();
    const on = session.follow(point)!;
    expect([on("A"), on("J-3"), on("J-2")]).toEqual(["A", "J-3", "J-2"]);
});

test("ruling 16 — a point whose step the history dropped follows nothing: undone, then another gesture recorded in its place; undone as the history started over; and drafts discarded since", () => {
    const replaced = jobs();
    replaced.record(moved("J-1", "A", SPRING), "typed", "Edit job");
    const point = replaced.point();
    replaced.undo();
    replaced.record(moved("J-2", "C", POSTERS), "typed", "Edit job");
    expect(replaced.follow(point)).toBeUndefined();

    // Nothing drafted once it is undone: another write's rows are the session's, its history started over.
    const restarted = jobs();
    restarted.record(moved("J-1", "A", SPRING), "typed", "Edit job");
    const undone = restarted.point();
    restarted.undo();
    restarted.observeBase(variant("snapshot", new SortedMap<string, JobValue>([["J-1", SPRING], ["J-2", COVERS]], compareFor(StringType))));
    expect([restarted.depth.redo, restarted.follow(undone)]).toEqual([0, undefined]);

    const discarded = jobs();
    discarded.record(moved("J-1", "A", SPRING), "typed", "Edit job");
    const later = discarded.point();
    discarded.discard();
    expect(discarded.follow(later)).toBeUndefined();
});

test("ruling 16 — one gesture that moves two entries each under the other's id follows each to the other's, on and back; one that moves an entry under the id of one it removes leaves that one under none", () => {
    const swapped = jobs();
    const before = swapped.point();
    swapped.record([{ id: "J-1", before: job(SPRING), after: job(POSTERS), from: "J-2" }, { id: "J-2", before: job(POSTERS), after: job(SPRING), from: "J-1" }], "typed", "Swap jobs");
    const after = swapped.point();
    expect([swapped.follow(before)!("J-1"), swapped.follow(before)!("J-2")]).toEqual(["J-2", "J-1"]);
    swapped.undo();
    expect([swapped.follow(after)!("J-1"), swapped.follow(after)!("J-2")]).toEqual(["J-2", "J-1"]);

    const replacing = jobs();
    const start = replacing.point();
    replacing.record([{ id: "J-1", before: job(SPRING), after: job(POSTERS), from: "J-2" }, { id: "J-2", before: job(POSTERS), after: ABSENT }], "typed", "Edit job");
    expect([replacing.follow(start)!("J-1"), replacing.follow(start)!("J-2")]).toEqual([undefined, "J-1"]);
});

test("ruling 16 — a gesture that would join the step a point was taken after is a step of its own, so the point stands between the two: one Undo takes back the later alone", () => {
    const session = jobs();
    session.record(moved("J-1", "B", SPRING), "typed", "Edit cell", "cell");
    const point = session.point();
    session.record(moved("B", "C", SPRING), "typed", "Edit cell", "cell");
    expect([session.depth.undo, session.follow(point)!("B")]).toEqual([2, "C"]);
    session.undo();
    expect(session.follow(point)!("B")).toBe("B");
});

test("ruling 16 — a new entry a carry-over gave another id, another write having added its own under the first, is followed to it", async () => {
    // The jobs' rule for a new key: the first J-<n> past J-2 not taken.
    const keys: EntryKeys = {
        make: (known) => {
            for (let n = 3; ; n++) if (!known.has(`J-${n}`)) return `J-${n}`;
        },
    };
    const session = new EditSession<string>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType, keys,
        // Another write got there first, every time.
        apply: () => variant("conflict", [{ entry: "", row: none, field: none, message: "The record changed since this edit began" }]),
        patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    const id = session.mint()!;
    session.record([{ id, before: ABSENT, after: job(COVERS) }], "insert", "Insert row");
    const point = session.point();
    await session.apply();
    // At r2 the record holds another write's J-3: the session's own goes on as J-4.
    session.observeBase(variant("revision", "r2"));
    expect(session.merge(variant("revision", "r2"), (entry) => (entry === "J-3" ? some(POSTERS) : none))).toBe("merged");
    expect([...session.renumbered]).toEqual([["J-3", "J-4"]]);
    expect(session.follow(point)!("J-3")).toBe("J-4");
});

test("ruling 16 — a gesture across two sessions of one history moves an entry in each: each session follows its own, one Undo takes both back, and a point of one session is nothing to another", () => {
    const [press, finish] = [jobs(), jobs()];
    const history = new EditHistory<string>();
    history.sync([["press", press], ["finish", finish]]);
    const [atPress, atFinish] = [press.point(), finish.point()];
    expect(history.record([{ key: "press", updates: moved("J-1", "X", SPRING) }, { key: "finish", updates: moved("J-2", "Y", POSTERS) }], "typed", "Edit two")).toBe(true);
    expect([press.follow(atPress)!("J-1"), finish.follow(atFinish)!("J-2")]).toEqual(["X", "Y"]);
    history.undo();
    expect([press.follow(atPress)!("J-1"), finish.follow(atFinish)!("J-2")]).toEqual(["J-1", "J-2"]);
    expect(finish.follow(atPress)).toBeUndefined();
});

test("a moved entry is the entry its source holds under the id it had: the session says so while the drafts hold the move — not once Undo takes it back, again once Redo makes it — and the same object while the moves hold", () => {
    const session = jobs();
    expect(session.moved.size).toBe(0);
    session.record(moved("J-1", "Spring", SPRING), "typed", "Edit job");
    const held = session.moved;
    expect([...held]).toEqual([["Spring", "J-1"]]);
    // An edit of another entry moves nothing: the very object.
    session.record([{ id: "J-2", before: job(POSTERS), after: job({ ...POSTERS, sheets: 1.0 }) }], "typed", "Edit job");
    expect(session.moved).toBe(held);
    session.undo();
    session.undo();
    expect([...session.moved]).toEqual([]);
    session.redo();
    expect([...session.moved]).toEqual([["Spring", "J-1"]]);
});

test("an entry moved on again is still the entry its source holds; moved back where it began, it is no move; removed, none; and a new entry moved is none either", () => {
    const session = jobs();
    session.record(moved("J-1", "A", SPRING), "typed", "Edit job");
    session.record(moved("A", "B", SPRING), "typed", "Edit job");
    expect([...session.moved]).toEqual([["B", "J-1"]]);
    session.record(moved("B", "J-1", SPRING), "typed", "Edit job");
    expect([...session.moved]).toEqual([]);
    session.undo();
    session.record([{ id: "B", before: job(SPRING), after: ABSENT }], "remove", "Delete row");
    expect([...session.moved]).toEqual([]);

    // A new entry stood nowhere in its source: under whichever id, it is new.
    const added = jobs();
    added.record([{ id: "N", before: ABSENT, after: job(COVERS) }], "insert", "Insert row");
    added.record(moved("N", "Covers", COVERS), "typed", "Edit job");
    expect([...added.moved]).toEqual([]);
});

test("another entry made under the id an undone move gave is new: never the entry the drafts removed, moved", () => {
    const session = jobs();
    session.record(moved("J-1", "A", SPRING), "typed", "Edit job");
    session.undo();
    session.record([{ id: "J-1", before: job(SPRING), after: ABSENT }], "remove", "Delete row");
    session.record([{ id: "A", before: ABSENT, after: job(COVERS) }], "insert", "Insert row");
    expect([...session.moved]).toEqual([]);
});

test("an Undo of a step that moved an entry says it stands under the id it had again, and its Redo under the other: a new map at each, the same one through a step that moves none", () => {
    const session = jobs();
    session.record(moved("J-1", "Spring", SPRING), "typed", "Edit job");
    session.record([{ id: "J-2", before: job(POSTERS), after: job({ ...POSTERS, sheets: 1.0 }) }], "typed", "Edit job");
    expect(session.rekeyed.size).toBe(0);
    session.undo();
    expect(session.rekeyed.size).toBe(0);
    session.undo();
    const back = session.rekeyed;
    expect([...back]).toEqual([["Spring", "J-1"]]);
    session.redo();
    expect([...session.rekeyed]).toEqual([["J-1", "Spring"]]);
    const on = session.rekeyed;
    session.redo();
    expect(session.rekeyed).toBe(on);
});

test("a carry-over takes the moves into the history's next run: the source moved under the drafts, the history started over, and the moved entry is the one its source holds still", () => {
    const session = new EditSession<string>({
        sourceId: "jobs", entryType: Job, draftType: JobDraft, keyType: StringType,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", "r1"));
    session.record(moved("J-1", "Spring", SPRING), "typed", "Edit job");
    session.record([{ id: "J-2", before: job(POSTERS), after: job({ ...POSTERS, sheets: 1.0 }) }], "typed", "Edit job");
    // At r2 another write has changed the posters' title: the drafts are carried over, and the history starts over.
    session.observeBase(variant("revision", "r2"));
    const held = (id: string) => (id === "J-1" ? some(SPRING) : id === "J-2" ? some({ ...POSTERS, title: "Shop posters, A2" }) : none);
    expect(session.merge(variant("revision", "r2"), held)).toBe("merged");
    expect([session.depth.undo, [...session.moved]]).toEqual([0, [["Spring", "J-1"]]]);
});

test("a Save lands a move: the entry is its source's under the id it moved to, and moved on from there it is the entry its source holds there", async () => {
    const session = jobs();
    session.record(moved("J-1", "Spring", SPRING), "typed", "Edit job");
    await session.apply();
    const saved = variant("snapshot", new SortedMap<string, JobValue>([["J-2", POSTERS], ["Spring", SPRING]], compareFor(StringType)));
    expect(session.reconcile(saved, () => undefined)).toBe(true);
    expect([session.pending, [...session.moved]]).toEqual([0, []]);
    session.record(moved("Spring", "Summer", SPRING), "typed", "Edit job");
    expect([...session.moved]).toEqual([["Summer", "Spring"]]);
});
