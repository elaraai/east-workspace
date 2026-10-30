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
const KEY = keptDraftsKey("jobs", "jobs.view");
const keyOrder = some(variant("keyOrder", null));

const cut: JobValue = { name: "Panel cutting", qty: 2n };
const band: JobValue = { name: "Edge banding", qty: 4n };
/** The jobs as the source holds them: a keyed snapshot. */
const jobs = (j1: JobValue = cut, j2: JobValue = band) => variant("snapshot", new SortedMap([["J1", j1], ["J2", j2]], compareFor(StringType)));
const version = (id: string, job: JobValue): EntryVersion<WireValue> => ({ draft: liftDraft(JobDraft, job), wire: { id }, place: keyOrder });

/** A session over the jobs, its drafts kept under the key. */
function session(entryType = Job, draftType = JobDraft): EditSession<WireValue> {
    const binding: EditSessionBinding<WireValue> = {
        sourceId: "jobs", entryType, draftType, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
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

    test("a sign-out clears what is kept: a reload restores nothing", () => {
        drafted();
        clearKept();
        reload();
        const after = session();
        after.observeBase(jobs());
        expect(after.pending).toBe(0);
    });
});
