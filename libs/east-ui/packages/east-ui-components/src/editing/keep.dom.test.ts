/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Drafts kept through a reload (keep.ts): written to the tab's storage as each
 * change is made, and restored as the page loads again — carried over to what
 * the source holds then — over real sessions of a keyed source of jobs. A
 * reload here is the page's kept state forgotten (`resetKept`), its storage
 * left as it is, and a new session made under the same key.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { IntegerType, SortedMap, StringType, StructType, compareFor, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { clearKept, keptName, resetKept } from "../platform/kept.js";
import { liftDraft } from "./draft.js";
import { draftsKeepingOf, keepDrafts, keptDraftsKey } from "./keep.js";
import { madeFromKeys, randomKeys } from "./keys.js";
import { EditSession, type EditSessionBinding, type EntryVersion } from "./session.js";

const Job = StructType({ name: StringType, qty: IntegerType });
const JobDraft = Editing.Types.Draft(Job);
type JobValue = ValueTypeOf<typeof Job>;
const Wire = StructType({ id: StringType });
type WireValue = ValueTypeOf<typeof Wire>;
type JobDraftValue = ValueTypeOf<typeof JobDraft>;
const sameDraft = equalFor(JobDraft);
/** A job, as the session holds its draft. */
const draftOf = (job: JobValue) => liftDraft(JobDraft, job) as JobDraftValue;
const KEY = keptDraftsKey("", "jobs", "jobs.view");
const keyOrder = some(variant("keyOrder", null));

const cut: JobValue = { name: "Panel cutting", qty: 2n };
const band: JobValue = { name: "Edge banding", qty: 4n };
/** The jobs as the source holds them: a keyed snapshot. */
const jobs = (j1: JobValue = cut, j2: JobValue = band) => variant("snapshot", new SortedMap([["J1", j1], ["J2", j2]], compareFor(StringType)));
const version = (id: string, job: JobValue): EntryVersion<WireValue> => ({ draft: liftDraft(JobDraft, job), wire: { id }, place: keyOrder });

/** A session over the jobs, its drafts kept under the key: a new job's key made from the job it is copied from. */
function session(entryType = Job, draftType = JobDraft, apply: NonNullable<EditSessionBinding<WireValue>["apply"]> = () => variant("applied", { revision: none })): EditSession<WireValue> {
    const binding: EditSessionBinding<WireValue> = {
        sourceId: "jobs", entryType, draftType, keyType: StringType, keys: madeFromKeys(randomKeys()),
        underKey: (id, version) => ({ ...version, wire: { id } }),
        apply, patch: undefined, refresh: undefined,
    };
    const next = new EditSession<WireValue>(binding);
    keepDrafts(next, KEY, Wire);
    return next;
}

/** J1's quantity drafted to 5, over the jobs as they began. */
function drafted(): EditSession<WireValue> {
    const s = session();
    s.observeBase(jobs());
    s.record([{ id: "J1", before: version("J1", cut), after: version("J1", { ...cut, qty: 5n }) }], "typed", "Set quantity");
    return s;
}

const stored = () => window.sessionStorage.getItem(keptName(KEY, { where: "tab" }));
/** A reload: what the page keeps forgotten, the tab's storage as it is. */
const reload = () => resetKept();

beforeEach(() => {
    resetKept();
    window.localStorage.clear();
    window.sessionStorage.clear();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("drafts kept through a reload", () => {
    test("each change is kept as it is made, and a reload over a source that has not moved restores the drafts as they were, the projection with them", () => {
        const before = drafted();
        expect(stored()).not.toBeNull();
        expect(draftsKeepingOf(before).state).toBe("kept");
        reload();
        const after = session();
        // Nothing until the source's base is observed; then the drafts, as they were.
        expect(after.pending).toBe(0);
        after.observeBase(jobs());
        expect([after.pending, after.unsettled, after.canApply, after.canUndo]).toEqual([1, 0, true, false]);
        expect(sameDraft(after.entries.get("J1")!.draft as JobDraftValue, draftOf({ ...cut, qty: 5n }))).toBe(true);
        expect(after.entries.get("J1")!.wire).toEqual({ id: "J1" });
    });

    test("a reload over a source that moved carries the drafts over: a change apart combines, and the part both changed waits to be chosen", () => {
        drafted();
        reload();
        const apart = session();
        apart.observeBase(jobs({ ...cut, name: "Panel cutting, maple" }));
        expect([apart.pending, apart.unsettled]).toEqual([1, 0]);
        expect(sameDraft(apart.entries.get("J1")!.draft as JobDraftValue, draftOf({ name: "Panel cutting, maple", qty: 5n }))).toBe(true);
        reload();
        const clash = session();
        clash.observeBase(jobs({ ...cut, qty: 3n }));
        expect([clash.pending, clash.unsettled, clash.canApply]).toEqual([1, 1, false]);
    });

    test("the keys the session made are kept with its drafts: after a reload, a copied job whose key another write took goes on under the next, both kept — and the keys go from the tab with the drafts", () => {
        const before = session();
        before.observeBase(jobs());
        // J1 copied: its copy's key made from J1's.
        const copy = before.mint("J1")!;
        expect(copy).toBe("J1-2");
        before.record([{ id: copy, before: { draft: undefined, wire: undefined, place: none }, after: version(copy, { ...cut, qty: 9n }) }], "insert", "Duplicate J1");
        const kept = () => window.sessionStorage.getItem(keptName(`${KEY}:made`, { where: "tab" }));
        expect(kept()).not.toBeNull();
        reload();
        const after = session();
        // Another write saved its own J1-2 meanwhile: the record holds it as the page loads again.
        after.observeBase(variant("snapshot", new SortedMap([["J1", cut], ["J1-2", band], ["J2", band]], compareFor(StringType))));
        expect([[...after.entries.keys()], [...after.renumbered], after.unsettled, after.pending]).toEqual([["J1-3"], [["J1-2", "J1-3"]], 0, 1]);
        expect(after.entries.get("J1-3")!.wire).toEqual({ id: "J1-3" });
        expect([...after.ownKeys]).toEqual([["J1-3", "J1"]]);
        // Discarded: no draft, and no key of the session's own kept.
        after.discard();
        expect([stored(), kept()]).toEqual([null, null]);
    });

    test("a key a Save holds with no answer yet is kept as the session's own no more: reloaded then, the record having taken the Save, the copy is saved once — no draft left, and none made under another key", async () => {
        // A Save whose answer never comes.
        const before = session(Job, JobDraft, () => new Promise(() => undefined));
        before.observeBase(jobs());
        const copy = before.mint("J1")!;
        before.record([{ id: copy, before: { draft: undefined, wire: undefined, place: none }, after: version(copy, { ...cut, qty: 9n }) }], "insert", "Duplicate J1");
        const kept = () => window.sessionStorage.getItem(keptName(`${KEY}:made`, { where: "tab" }));
        expect([[...before.ownKeys], kept() === null]).toEqual([[[copy, "J1"]], false]);
        void before.apply();
        for (let i = 0; i < 12; i++) await Promise.resolve();
        // Sent: the record may hold the copy as the request left it, which nothing tells from another write's. The draft
        // is kept — its Save's outcome is not known — and its key as the session's own is not.
        expect([before.status, [...before.ownKeys], kept(), stored() === null]).toEqual(["applying", [], null, false]);
        reload();
        const after = session();
        // The record took the Save: it holds the copy as the request left it. Made another key, the copy would be saved twice.
        after.observeBase(variant("snapshot", new SortedMap([["J1", cut], ["J1-2", { ...cut, qty: 9n }], ["J2", band]], compareFor(StringType))));
        expect([[...after.entries.keys()], [...after.renumbered], after.unsettled, after.pending]).toEqual([[], [], 0, 0]);
    });

    test("a Save that landed before the reload leaves no draft, and nothing kept", () => {
        drafted();
        reload();
        const after = session();
        after.observeBase(jobs({ ...cut, qty: 5n }));
        expect(after.pending).toBe(0);
        expect(stored()).toBeNull();
    });

    test("drafts kept under another schema are not restored: the session says they were lost, and the tab keeps them no more", () => {
        drafted();
        reload();
        const Wider = StructType({ name: StringType, qty: IntegerType, note: StringType });
        const after = session(Wider, Editing.Types.Draft(Wider));
        expect(draftsKeepingOf(after)).toEqual({ state: "lost", reason: "schema" });
        expect(stored()).toBeNull();
        after.observeBase(variant("snapshot", new SortedMap([["J1", { ...cut, note: "" }]], compareFor(StringType))));
        expect(after.pending).toBe(0);
    });

    test("bytes this version does not read are not restored, and are said lost", () => {
        window.sessionStorage.setItem(keptName(KEY, { where: "tab" }), "AAECAwQF");
        const after = session();
        expect(draftsKeepingOf(after)).toEqual({ state: "lost", reason: "unreadable" });
        expect(stored()).toBeNull();
        // A change made after says the drafts are kept again.
        after.observeBase(jobs());
        after.record([{ id: "J2", before: version("J2", band), after: version("J2", { ...band, qty: 6n }) }], "typed", "Set quantity");
        expect(draftsKeepingOf(after).state).toBe("kept");
    });

    test("storage refusing a write says a reload would lose the drafts, and why; a write that lands says they are kept", () => {
        const s = session();
        s.observeBase(jobs());
        const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
        s.record([{ id: "J1", before: version("J1", cut), after: version("J1", { ...cut, qty: 5n }) }], "typed", "Set quantity");
        expect(draftsKeepingOf(s)).toEqual({ state: "unkept", reason: "full" });
        full.mockRestore();
        s.record([{ id: "J2", before: version("J2", band), after: version("J2", { ...band, qty: 6n }) }], "typed", "Set quantity");
        expect(draftsKeepingOf(s).state).toBe("kept");
        reload();
        const after = session();
        after.observeBase(jobs());
        expect(after.pending).toBe(2);
    });

    test("Discard leaves nothing kept, and a reload restores nothing", () => {
        const s = drafted();
        s.discard();
        expect(stored()).toBeNull();
        reload();
        const after = session();
        after.observeBase(jobs());
        expect(after.pending).toBe(0);
    });

    test("an entry edited back to what it began as is no draft to keep", () => {
        const s = drafted();
        s.record([{ id: "J1", before: version("J1", { ...cut, qty: 5n }), after: version("J1", cut) }], "typed", "Set quantity");
        expect(s.pending).toBe(0);
        expect(stored()).toBeNull();
    });

    test("an optimiser's result that waited for a person's Save waits still after a reload: no automatic Save sends the restored drafts until a person's Save takes them", () => {
        const s = drafted();
        s.record([{ id: "J2", before: version("J2", band), after: version("J2", { ...band, qty: 9n }) }], "optimise", "Elara run #1");
        expect([s.autosaveHeld, s.canAutosave]).toEqual([true, true]);
        reload();
        const after = session();
        after.observeBase(jobs());
        // Restored with no history to tell the result from the rest: every draft waits.
        expect([after.pending, after.canUndo, after.autosaveHeld, after.canAutosave, after.canApply]).toEqual([2, false, true, false, true]);
        void after.apply();
        expect(after.autosaveHeld).toBe(false);
    });

    test("restored drafts with no optimiser's result among them are an automatic Save's to send, as they were", () => {
        drafted();
        reload();
        const after = session();
        after.observeBase(jobs());
        expect([after.pending, after.autosaveHeld, after.canAutosave]).toEqual([1, false, true]);
    });

    test("a result its Undo took back before the reload is no result to wait for after it: what the Undo left waits as a step back does", () => {
        const s = drafted();
        s.record([{ id: "J2", before: version("J2", band), after: version("J2", { ...band, qty: 9n }) }], "optimise", "Elara run #1");
        s.undo();
        reload();
        const after = session();
        after.observeBase(jobs());
        expect([after.pending, after.autosaveHeld, after.autosaveStepped, after.canAutosave]).toEqual([1, false, true, false]);
    });

    test("a step back that waited for a person's Save waits still after a reload: no automatic Save sends what Undo left until a person's Save takes it, or the next change is made", () => {
        const s = drafted();
        s.record([{ id: "J2", before: version("J2", band), after: version("J2", { ...band, qty: 9n }) }], "typed", "Set quantity");
        s.undo();
        expect([s.pending, s.autosaveStepped, s.canAutosave]).toEqual([1, true, false]);
        reload();
        const after = session();
        after.observeBase(jobs());
        // Restored with no history to step back with: the draft waits as it did.
        expect([after.pending, after.canUndo, after.autosaveStepped, after.canAutosave, after.canApply]).toEqual([1, false, true, false, true]);
        // The next change is the person's newest: nothing waits.
        after.record([{ id: "J2", before: version("J2", band), after: version("J2", { ...band, qty: 7n }) }], "typed", "Set quantity");
        expect([after.autosaveStepped, after.canAutosave]).toEqual([false, true]);
        // And through another reload, nothing waits either.
        reload();
        const again = session();
        again.observeBase(jobs());
        expect([again.pending, again.autosaveStepped, again.canAutosave]).toEqual([2, false, true]);
    });

    test("a step back a person's Save took is no step to wait for after a reload", () => {
        const s = drafted();
        s.record([{ id: "J2", before: version("J2", band), after: version("J2", { ...band, qty: 9n }) }], "typed", "Set quantity");
        s.undo();
        // A person's Save of what stands there, its answer still to come as the page reloads: the draft is theirs.
        void s.apply();
        expect(s.autosaveStepped).toBe(false);
        reload();
        const after = session();
        after.observeBase(jobs());
        expect([after.pending, after.autosaveStepped]).toEqual([1, false]);
    });

    test("a sign-out clears what is kept: a reload restores nothing", () => {
        drafted();
        clearKept();
        reload();
        const after = session();
        after.observeBase(jobs());
        expect(after.pending).toBe(0);
    });
});
