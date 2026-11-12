/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A history's confirmation of a commit over a source read a window at a time:
 * the entries the collection's own reads hold at the revision
 * committed are judged in one pass, with no request; only the rest are read by
 * their keys, a bounded batch at a time — or, where the source reads several
 * at once, in one read, asked again as it was until it lands. And a source's
 * rule for its new entries' keys (`keys`), which is its session's.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IntegerType, StringType, StructType, encodeBeast2For, none, some, toEastTypeValue, variant, type option, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { getStore, initializeStore, trackKey } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
import { autosaveChoiceOf } from "./autosave-choice.js";
import { liftDraft } from "./draft.js";
import type { EntryVersion } from "./session.js";
import { useEditHistory, type EditHistoryPaged, type EditHistorySource } from "./use-edit-history.js";
import type { EditingValue } from "./use-edit-session.js";

const Job = StructType({ task: StringType, qty: IntegerType });
const JobDraft = Editing.Types.Draft(Job);
type JobValue = ValueTypeOf<typeof Job>;
const REVISION_KEY = "jobs.revision";
const ids = Array.from({ length: 40 }, (_, i) => `J${String(i).padStart(2, "0")}`);
const job = (value: JobValue): EntryVersion<null> => ({ draft: liftDraft(JobDraft, value), wire: null, place: some(variant("keyOrder", null)) });

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

/**
 * The jobs, read a window at a time: the record at its revision, which a commit
 * moves; what the collection's own reads hold of it (`holds`); and each read,
 * counted — by the collection's reads, and by key.
 */
function jobs(holds: (id: string) => boolean) {
    let revision = "r1";
    let rows = new Map<string, JobValue>(ids.map(id => [id, { task: id, qty: 1n }]));
    const read = (id: string): option<option<unknown>> => { trackKey(REVISION_KEY); const row = rows.get(id); return some(row === undefined ? none : some(row)); };
    const paged: EditHistoryPaged = {
        revision: () => { trackKey(REVISION_KEY); return some(revision); },
        refresh: (next) => {
            if (next.type === "some") revision = next.value;
            getStore().write(REVISION_KEY, encodeBeast2For(StringType)(revision));
            return null;
        },
        entry: vi.fn(read),
        held: vi.fn((id: string) => (holds(id) ? read(id) : undefined)),
    };
    const editing: EditingValue = {
        sourceId: "jobs", entryType: toEastTypeValue(Job), draftType: toEastTypeValue(JobDraft),
        idField: none, children: none, keyType: some(toEastTypeValue(StringType)), snapshot: none, onPatch: none,
        readEntry: () => none,
        onApply: some(variant("sync", () => {
            rows = new Map<string, JobValue>([...rows].map(([id, row]) => [id, { ...row, qty: 5n }]));
            return variant("applied", { revision: some("r2") });
        })),
    };
    const sources: readonly EditHistorySource<null>[] = [{ editing, paged }];
    return { paged, sources };
}

/** The history over the jobs, every job's quantity drafted, its Save applied: what it read by key and by its own reads once committed. */
async function saveAll(holds: (id: string) => boolean) {
    const { paged, sources } = jobs(holds);
    const hook = renderHook(() => useEditHistory(sources, "held-confirmation"));
    const session = hook.result.current.history.session(hook.result.current.keys[0]!)!;
    await waitFor(() => expect(hook.result.current.available(hook.result.current.keys[0]!)).toBe(true));
    act(() => { session.record(ids.map(id => ({ id, before: job({ task: id, qty: 1n }), after: job({ task: id, qty: 5n }) })), "typed", "Set quantities"); });
    vi.mocked(paged.entry).mockClear();
    vi.mocked(paged.held!).mockClear();
    await act(async () => { await session.apply(); });
    await waitFor(() => expect(session.status).toBe("idle"));
    expect(session.pending).toBe(0);
    return { byKey: vi.mocked(paged.entry).mock.calls.map(([id]) => id), byOwn: vi.mocked(paged.held!).mock.calls.map(([id]) => id) };
}

test("a commit whose every entry the collection's own reads hold is judged in one pass, none read by its key", async () => {
    const { byKey, byOwn } = await saveAll(() => true);
    expect(byKey).toEqual([]);
    // Each entry asked of the collection's reads once: one pass judged them all.
    expect(byOwn).toEqual(ids);
});

test("only the entries the collection's reads do not hold are read by their keys, a bounded batch at a time", async () => {
    const unheld = new Set(ids.slice(30));
    const { byKey } = await saveAll((id) => !unheld.has(id));
    // No held entry read by key; each of the rest read by key once, in batches of eight.
    expect(byKey.filter((id) => !unheld.has(id))).toEqual([]);
    expect(new Set(byKey)).toEqual(unheld);
    expect(byKey).toHaveLength(unheld.size);
});

test("a read of several entries by their keys in flight is asked again as it was until it lands, whatever the collection's reads come to hold or let go meanwhile; an entry it did not ask is asked once it has (#1596)", async () => {
    const VIEW_KEY = "jobs.view";
    // The collection's reads hold all but the last eleven: J29 they are still reading, and J30 to J39 they do not hold.
    const view = { reading: "J29", unheld: new Set(ids.slice(30)), landed: false };
    let revision = "r1";
    let rows = new Map<string, JobValue>(ids.map(id => [id, { task: id, qty: 1n }]));
    const rowOf = (id: string): option<unknown> => { const row = rows.get(id); return row === undefined ? none : some(row); };
    // Each read of several entries by their keys, as asked: a pass with none left to read asks for none.
    const asked: string[] = [];
    const paged: EditHistoryPaged = {
        revision: () => { trackKey(REVISION_KEY); return some(revision); },
        refresh: (next) => {
            if (next.type === "some") revision = next.value;
            getStore().write(REVISION_KEY, encodeBeast2For(StringType)(revision));
            return null;
        },
        entry: () => { throw new Error("a source that reads several entries at once reads none by its key alone"); },
        entriesAll: (asking) => {
            trackKey(VIEW_KEY);
            if (asking.length > 0) asked.push(asking.join());
            return view.landed ? some(new Map(asking.map(id => [id, rowOf(id)] as const))) : none;
        },
        held: (id) => {
            trackKey(VIEW_KEY);
            if (view.unheld.has(id)) return undefined;
            return id === view.reading ? none : some(rowOf(id));
        },
    };
    const editing: EditingValue = {
        sourceId: "jobs-in-flight", entryType: toEastTypeValue(Job), draftType: toEastTypeValue(JobDraft),
        idField: none, children: none, keyType: some(toEastTypeValue(StringType)), snapshot: none, onPatch: none,
        readEntry: () => none,
        onApply: some(variant("sync", () => {
            rows = new Map<string, JobValue>([...rows].map(([id, row]) => [id, { ...row, qty: 5n }]));
            return variant("applied", { revision: some("r2") });
        })),
    };
    const sources: readonly EditHistorySource<null>[] = [{ editing, paged }];
    /** The collection's view moves: what its reads hold is read again. */
    const move = async (change: () => void) => {
        await act(async () => { change(); getStore().write(VIEW_KEY, encodeBeast2For(IntegerType)(BigInt(asked.length))); });
    };
    const hook = renderHook(() => useEditHistory(sources, "in-flight"));
    const session = hook.result.current.history.session(hook.result.current.keys[0]!)!;
    await waitFor(() => expect(hook.result.current.available(hook.result.current.keys[0]!)).toBe(true));
    act(() => { session.record(ids.map(id => ({ id, before: job({ task: id, qty: 1n }), after: job({ task: id, qty: 5n }) })), "typed", "Set quantities"); });
    asked.length = 0;
    await act(async () => { await session.apply(); });
    // The ten entries the collection's reads do not hold are asked for in one read, which is in flight.
    const unheld = ids.slice(30).join();
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]).toBe(unheld);
    // The view moves: a window that holds J39 starts loading, and the one that was reading J29 is let go.
    await move(() => { view.reading = "J39"; view.unheld = new Set([...ids.slice(30, 39), "J29"]); });
    await move(() => {});
    // The read in flight is asked again as it was, every pass: never another in its place.
    expect(asked.length).toBeGreaterThan(1);
    expect(asked.filter((batch) => batch !== unheld)).toEqual([]);
    expect(session.status).toBe("reconciling");
    // It lands: its entries are judged, and J29, which it did not ask, is asked for then.
    await move(() => { view.landed = true; });
    await waitFor(() => expect(session.status).toBe("idle"));
    expect(session.pending).toBe(0);
    expect(asked.filter((batch, i) => batch !== asked[i - 1])).toEqual([unheld, "J29"]);
});

test("a source's rule for its new entries' keys is its session's: a new entry under a key the session made, which another write took, goes on under the next, both kept and nothing to choose — and under a key it did not make, the two are a conflict (#1583)", async () => {
    /** The jobs' rule: the first `J<nn>` not taken, past the one job the record holds. */
    const keys: EditHistorySource<null>["keys"] = {
        make: (known) => {
            for (let n = 2; ; n++) {
                const id = `J${String(n).padStart(2, "0")}`;
                if (!known.has(id)) return id;
            }
        },
    };
    /** A job added here, then another write's own job under the same key: the session once it has carried its draft over. */
    const taken = async (view: string, minted: boolean) => {
        let revision = "r1";
        const rows = new Map<string, JobValue>([["J01", { task: "J01", qty: 1n }]]);
        const key = `${REVISION_KEY}.${view}`;
        const paged: EditHistoryPaged = {
            revision: () => { trackKey(key); return some(revision); },
            refresh: (next) => {
                if (next.type === "some") revision = next.value;
                getStore().write(key, encodeBeast2For(StringType)(revision));
                return null;
            },
            entry: (id) => { trackKey(key); const row = rows.get(id); return some(row === undefined ? none : some(row)); },
        };
        const editing: EditingValue = {
            sourceId: `jobs-${view}`, entryType: toEastTypeValue(Job), draftType: toEastTypeValue(JobDraft),
            idField: none, children: none, keyType: some(toEastTypeValue(StringType)), snapshot: none, onPatch: none,
            readEntry: () => none,
            onApply: some(variant("sync", () => variant("applied", { revision: some("r9") }))),
        };
        const sources: readonly EditHistorySource<null>[] = [{ editing, paged, keys }];
        const hook = renderHook(() => useEditHistory(sources, view));
        const session = hook.result.current.history.session(hook.result.current.keys[0]!)!;
        await waitFor(() => expect(hook.result.current.available(hook.result.current.keys[0]!)).toBe(true));
        // The session's own key, or one a person gave: J02 either way.
        const id = minted ? session.mint()! : "J02";
        expect(id).toBe("J02");
        act(() => { session.record([{ id, before: { draft: undefined, wire: undefined, place: none }, after: job({ task: "Mine", qty: 2n }) }], "insert", "Add a job"); });
        // Another write adds its own J02: the source moves on under the draft.
        await act(async () => { rows.set("J02", { task: "Theirs", qty: 7n }); paged.refresh(some("r2")); });
        return session;
    };
    const made = await taken("made", true);
    await waitFor(() => expect([...made.renumbered]).toEqual([["J02", "J03"]]));
    expect([[...made.entries.keys()], made.originals.get("J03")!.draft, made.unsettled, made.pending]).toEqual([["J03"], undefined, 0, 1]);

    const given = await taken("given", false);
    await waitFor(() => expect(given.unsettled).toBe(1));
    expect([[...given.entries.keys()], [...given.renumbered]]).toEqual([["J02"], []]);
});

test("a history's builder's choice of an automatic Save begins where its author says — off, said nothing — from the history's first render, and moves as the author's word does", () => {
    const { sources } = jobs(() => true);
    const begins: boolean[] = [];
    const hook = renderHook(({ autosave }: { autosave: boolean }) => {
        const state = useEditHistory(sources, "begun", undefined, { autosave });
        // As the history's bar reads it, in the render that makes the history.
        begins.push(autosaveChoiceOf(state.history)!.begins());
        return state;
    }, { initialProps: { autosave: true } });
    expect(begins[0]).toBe(true);
    const choice = autosaveChoiceOf(hook.result.current.history)!;
    let heard = 0;
    const stop = choice.subscribe(() => { heard++; });
    hook.rerender({ autosave: false });
    expect([choice.begins(), heard]).toEqual([false, 1]);
    stop();
    const silent = renderHook(() => useEditHistory(sources, "silent"));
    expect(autosaveChoiceOf(silent.result.current.history)!.begins()).toBe(false);
});
