/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The drafts a sheet's callbacks read its rows over (`shown-drafts.ts`,
 * #1599): the entry each row's window was read with, lifted, made once an
 * entry; the layer's draft over it where the layer holds one; and a row whose
 * window carries no entry left to the bridge's own read.
 */

import { beforeEach, expect, test } from "vitest";
import { ArrayType, East, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { State } from "@elaraai/east-ui/internal";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { StateImpl, UIStore } from "@elaraai/east-ui-components";
import { liftDraft } from "./draft-values.js";
import { shownDrafts } from "./shown-drafts.js";
import type { SheetRowValue } from "./values.js";

beforeEach(() => initializeStore(new UIStore()));

/** A job: its quantity has a column, its bay none — a field that reaches a callback only through the row's entry. */
const Job = StructType({ id: StringType, qty: IntegerType, bay: StringType });
const JobDraft = Sheet.Types.Draft(Job);
const encodeJob = encodeBeast2For(Job);
const encodeJobDraft = encodeBeast2For(JobDraft);
const decodeJobDraft = decodeBeast2For(JobDraft);
const sameDraft = equalFor(JobDraft);

/** A sheet over the jobs: what its editing declaration says its entries and drafts are. */
const editing = East.function([], Sheet.Types.Root, ($) => {
    const data = $.const(State.bind([ArrayType(Job)], "shown-drafts-jobs", [{ id: "a", qty: 1n, bay: "North" }]));
    return Sheet.Root(data, { qty: Sheet.column.integer(Job) }, { id: "id", onUpdate: data.write, edits: { insertRows: false } });
}).toIR().compile(StateImpl)().editing;

type JobValue = { id: string; qty: bigint; bay: string };
/** A job's row as the sheet draws it: its quantity alone. */
const rowOf = (job: JobValue): SheetRowValue => ({
    id: job.id, owned: false, cells: new Map([["qty", variant("Integer", job.qty)]]), lines: [], band: none, subRows: [],
});
const A: JobValue = { id: "a", qty: 1n, bay: "North" };
const B: JobValue = { id: "b", qty: 2n, bay: "South" };
const C: JobValue = { id: "c", qty: 3n, bay: "East" };
/** A job's draft, as the session holds one. */
const draftOf = (job: JobValue) => liftDraft(JobDraft, job) as ReturnType<typeof decodeJobDraft>;

/**
 * The entries some windows carried, as a sheet's paging answers for them: each job's stored bytes by its id and its
 * place in the source — nothing for a job no window carries, or asked for at another place than its own.
 */
function carried(jobs: readonly (readonly [number, JobValue])[]) {
    const held = new Map(jobs.map(([at, job]) => [job.id, { at, entry: encodeJob(job) }] as const));
    const asked: (readonly [string, number])[] = [];
    const entryOf = (id: string, at: number): Uint8Array | undefined => {
        asked.push([id, at]);
        const found = held.get(id);
        return found !== undefined && found.at === at ? found.entry : undefined;
    };
    return { entryOf, asked, reread: (at: number, job: JobValue) => { held.set(job.id, { at, entry: encodeJob(job) }); } };
}

test("a row's own draft is the entry its window read with it, lifted — every field, the ones no column shows among them — made once an entry; a row no window carries has none, and a window read again is lifted again", () => {
    const windows = carried([[0, A], [1, B]]);
    const shown = shownDrafts(editing, windows.entryOf);
    const own = shown.base("a", 0)!;
    expect(sameDraft(decodeJobDraft(own), draftOf(A))).toBe(true);
    // Asked again: the same bytes, lifted once.
    expect(shown.base("a", 0)).toBe(own);
    // No window carries C, and A's stands at another place than the one asked.
    expect(shown.base("c", 2)).toBeUndefined();
    expect(shown.base("a", 5)).toBeUndefined();
    // Its window read again carries other bytes: lifted again, as the record holds it now.
    windows.reread(0, { ...A, bay: "West" });
    const again = shown.base("a", 0)!;
    expect(again).not.toBe(own);
    expect(sameDraft(decodeJobDraft(again), draftOf({ ...A, bay: "West" }))).toBe(true);
    // A sheet whose windows carry nothing has none to give.
    expect(shownDrafts(editing, undefined).base("a", 0)).toBeUndefined();
});

test("a callback over the rows reads each over the layer's draft where the layer holds one, else over the row's own at its place in its run; a row with neither is left out — and the same rows, runs and layer give the same drafts", () => {
    // Two runs, a failed window between them: A and B at 0 and 1, C at 400.
    const windows = carried([[0, A], [1, B], [400, C]]);
    const shown = shownDrafts(editing, windows.entryOf);
    const D: JobValue = { id: "d", qty: 4n, bay: "Yard" };
    const rows = [rowOf(A), rowOf(B), rowOf(C), rowOf(D)];
    const segments = [{ start: 0, end: 2, position: 0 }, { start: 2, end: 3, position: 400 }];
    // The session drafted B: its quantity is 20 there.
    const drafted = encodeJobDraft(draftOf({ ...B, qty: 20n }));
    const layer = new Map([["b", drafted]]);
    const drafts = shown.over(rows, segments, layer);
    // D stands past the last run's end, at 401: the last run holds every row after its start, and no window carries D.
    expect([...drafts.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(drafts.get("b")).toBe(drafted);
    expect(sameDraft(decodeJobDraft(drafts.get("a")!), draftOf(A))).toBe(true);
    expect(sameDraft(decodeJobDraft(drafts.get("c")!), draftOf(C))).toBe(true);
    // Each row asked at its own place, the drafted one not at all.
    expect(windows.asked).toEqual([["a", 0], ["c", 400], ["d", 401]]);
    // The layer is not written to.
    expect([...layer.keys()]).toEqual(["b"]);
    expect(shown.over(rows, segments, layer)).toBe(drafts);
    // Another layer — a draft made, a Save landed — is other drafts; so is another list of the same rows, or other runs.
    expect(shown.over(rows, segments, new Map(layer))).not.toBe(drafts);
    expect(shown.over([...rows], segments, layer)).not.toBe(drafts);
    expect(shown.over(rows, [...segments], layer)).not.toBe(drafts);
    // A sheet whose windows carry nothing hands on the layer's drafts alone.
    expect([...shownDrafts(editing, undefined).over(rows, segments, layer).keys()]).toEqual(["b"]);
});

test("a check of one row reads it over the layer where the layer holds its draft, else over the row's own alone — the same drafts each time it is asked — and a row with neither over the layer as it is", () => {
    const windows = carried([[0, A], [1, B]]);
    const shown = shownDrafts(editing, windows.entryOf);
    const layer = new Map([["b", encodeJobDraft(draftOf({ ...B, qty: 20n }))]]);
    expect(shown.of("b", 1, layer)).toBe(layer);
    const alone = shown.of("a", 0, layer);
    expect([...alone.keys()]).toEqual(["a"]);
    expect(sameDraft(decodeJobDraft(alone.get("a")!), draftOf(A))).toBe(true);
    expect(shown.of("a", 0, layer)).toBe(alone);
    expect(shown.of("c", 2, layer)).toBe(layer);
});
