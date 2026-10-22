/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A history's confirmation of a commit over a source read a window at a time:
 * the entries the collection's own reads hold at the revision
 * committed are judged in one pass, with no request; only the rest are read by
 * their keys, a bounded batch at a time.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IntegerType, StringType, StructType, encodeBeast2For, none, some, toEastTypeValue, variant, type option, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { getStore, initializeStore, trackKey } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
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
        idField: none, children: none, keyType: some(toEastTypeValue(StringType)), snapshot: none, onPatch: none, mode: variant("batch", null),
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
