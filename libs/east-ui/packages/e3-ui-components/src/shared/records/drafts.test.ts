/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A record's drafts in what e3 keeps (#1437), on e3 itself: each drafted row's
 * Save previewed with e3's own maintenance, through the binding a page holds,
 * and held to what e3 keeps once the Save commits — every subtotal at every
 * level, by every rollup; a dragged job's items and totals and its ancestors';
 * a press's monthly totals. A row runs again only when its draft moves, a row
 * lands or the revision moves; one not held is read with every other in one
 * request; another session's commit is previewed under the draft, or makes the
 * row stale. Every count is from the request log; another session's change is
 * a real commit through the record's patch door.
 */

import { afterEach, describe, expect, test } from "vitest";
import {
    DateTimeType, DictType, East, NullType, SortedMap, StringType, StructType, applyFor, compareFor, decodeBeast2For, equalFor, none, some, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { datasetGetPage } from "@elaraai/e3-api-client";
import { RecordSummaryOpType, RecordSummaryTotalsType, indexCollectionType, indexWindowType } from "@elaraai/e3-types";
import { Editing } from "@elaraai/east-ui/internal";
import { EditSession, getRegisteredPlatformImplementations, liftDraft, type EntryVersion } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/fixtures/bind/data/data-drafts";
import * as nested from "@elaraai/e3-ui/fixtures/bind/data/data-nested";
import { e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { RecordDrafts, setRecordDraftsProbe, type PreviewedRow, type RecordDraftsBinding } from "./drafts.js";

const h = e3Harness({ "bind/data/data-drafts.fixtures": ex, "bind/data/data-nested.fixtures": nested }, { measure: false });

afterEach(() => { setRecordDraftsProbe(undefined); });

const keyOrder = compareFor(StringType);
const instantOrder = compareFor(DateTimeType);
const stringEqual = equalFor(StringType);

/** A nested series index's entry key, as far as these tests read it: the run it is in, and its level. */
type NestedEntry = { readonly ik: { readonly run: { readonly type: string; readonly value: unknown }; readonly level: { readonly type: string } } };

/** A record as the fixtures declare it: its name, its path, its Dict type and its indexes. */
type Rec = typeof ex.draftLedgers | typeof ex.draftJobs | typeof nested.nestedAssemblies;
/** A record's row. */
type RowOf<R extends Rec> = R extends { type: DictType<StringType, infer V extends EastType> } ? ValueTypeOf<V> : never;

/** A record's binding, as a page holds it: its indexes listed by name, the runtimes it reads through installed over the test's workspace. */
async function bound(fn: ReturnType<typeof East.function>): Promise<RecordDraftsBinding> {
    await h.install({ fn });
    const binding = East.compile(fn, getRegisteredPlatformImplementations())() as unknown as RecordDraftsBinding;
    // Its revision, asked and heard.
    binding.revision();
    await settle();
    return binding;
}
const ledgersBinding = East.function([], undefined, () => Data.bindPaged(ex.draftLedgers, { indexes: ["draft_ledgers_by_name", "draft_ledgers_in_time"] }));
const jobsBinding = East.function([], undefined, () => Data.bindPaged(ex.draftJobs, { indexes: ["draft_jobs_by_press", "draft_jobs_by_press_month"] }));
const assembliesBinding = East.function([], undefined, () => Data.bindPaged(nested.nestedAssemblies, { indexes: ["assemblies_by_name", "assemblies_in_time"] }));

/** The revision a binding reads. */
function revisionOf(binding: RecordDraftsBinding): string {
    const revision = binding.revision();
    if (revision.type !== "some") throw new Error("the binding's revision has not resolved");
    return revision.value;
}

/** The record's editing session, as a builder over its rows keeps one: whole rows drafted, at the revision the binding reads. */
function sessionOf<R extends Rec>(record: R, binding: RecordDraftsBinding) {
    const row = record.type.value as StructType;
    const draftType = Editing.Types.Draft(row);
    const session = new EditSession<undefined>({
        sourceId: record.name, entryType: row, draftType, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("revision", revisionOf(binding)));
    const version = (value: RowOf<R> | undefined): EntryVersion<undefined> =>
        ({ draft: value === undefined ? undefined : liftDraft(draftType, value), wire: undefined, place: some(variant("keyOrder", null)) });
    /** Drafts each row given from its row as e3 holds it to its draft, as one gesture. */
    const draft = (rows: readonly (readonly [string, RowOf<R> | undefined, RowOf<R> | undefined])[]) => {
        expect(session.record(rows.map(([id, before, after]) => ({ id, before: version(before), after: version(after) })), "typed", "Edit")).toBe(true);
    };
    return { session, draft };
}

/** A Dict with one key's value set, the rest as they are. */
function withEntry<V>(dict: ReadonlyMap<string, V>, key: string, value: V): SortedMap<string, V> {
    const next = new SortedMap<string, V>([...dict], keyOrder);
    next.set(key, value);
    return next;
}

/**
 * What e3 keeps in one of a record's indexes now, read through e3's own page
 * reads: each entry under its entry key, in the index's order — of one row's,
 * or every entry of a summary, whose entries name none.
 *
 * @param record - The record
 * @param name - The index
 * @param key - The row whose entries; none for a summary's every total
 * @returns The entries
 */
async function kept(record: Rec, name: string, key?: string): Promise<SortedMap<unknown, unknown>> {
    const index = (record.indexes as Readonly<Record<string, { keyType: EastType; valueType: EastType; summary?: unknown }>>)[name]!;
    const k = index.summary !== undefined ? NullType : StringType;
    const decode = decodeBeast2For(indexWindowType(k, index.keyType, index.valueType, record.type.value)) as
        (bytes: Uint8Array) => { ik: unknown; key: unknown; value: unknown }[];
    const entries = new SortedMap<unknown, unknown>([], compareFor(StructType({ ik: index.keyType, k })) as (a: unknown, b: unknown) => number);
    for (let offset = 0; ;) {
        const page = await datasetGetPage(h.e3.apiUrl, h.e3.repo, h.workspace, record.path, { offset, limit: 2000, index: name }, h.e3.direct);
        for (const entry of decode(page.data)) {
            if (key === undefined || stringEqual(entry.key as string, key)) entries.set({ ik: entry.ik, k: entry.key }, entry.value);
        }
        offset += page.count;
        if (page.count === 0 || offset >= page.totalElements) return entries;
    }
}

/** An index of entries with a row's previewed ops applied, by East's own patch apply — which refuses an op the entries do not hold. */
function applied(record: Rec, name: string, entries: SortedMap<unknown, unknown>, ops: ReadonlyMap<unknown, unknown>): unknown {
    const index = (record.indexes as Readonly<Record<string, { keyType: EastType; valueType: EastType }>>)[name]!;
    return applyFor(indexCollectionType(StringType, index.keyType, index.valueType))(entries, variant("patch", ops));
}

/** A row's previewed changes to an index: it is previewed. */
function changesOf(row: PreviewedRow | undefined, index: string): ReadonlyMap<unknown, unknown> {
    expect(row?.state).toBe("previewed");
    const changes = row!.changes.get(index);
    expect(changes).toBeDefined();
    return changes!;
}

describe("a record's drafts in what e3 keeps", () => {
    test("previews a typed reading's Save as e3 keeps it once the Save commits: every subtotal at every level, summed, averaged, counted and the last summed", async () => {
        const binding = await bound(ledgersBinding);
        const { session, draft } = sessionOf(ex.draftLedgers, binding);
        const held = (await h.read(ex.draftLedgers)).get("L-1")!;
        const m2 = held.measures.get("m2")!;
        // The last day read is the latest reading of its week, its month, its quarter and its year: a value typed over
        // it moves each one's sum, mean and last, and a measure read that day for the first time each one's count — the
        // measures holding a value.
        const NOV_15 = new Date("2026-11-15T00:00:00Z");
        const typed = new SortedMap([...m2.readings], instantOrder);
        typed.set(NOV_15, 99.5);
        const drafted = {
            ...held,
            measures: withEntry(withEntry(held.measures, "m2", { ...m2, readings: typed }), "m4", { name: "Measure 4", readings: new SortedMap([[NOV_15, 4.5]], instantOrder) }),
        };
        draft([["L-1", held, drafted]]);
        const reads = h.requests("rows").length;
        const preview = new RecordDrafts(binding, session).preview();
        // At the revision the drafts began from, the row is the session's own: nothing read.
        expect(h.requests("rows").length).toBe(reads);
        const ops = changesOf(preview.get("L-1"), "draft_ledgers_in_time");
        // Its parents' subtotals, by each rollup's fold, at each level from the week to the year.
        const levels = new Map<string, Set<string>>();
        for (const entry of ops.keys()) {
            const { run, level } = (entry as NestedEntry).ik;
            if (run.type !== "subtotals") continue;
            const fold = (run.value as { readonly fold: { readonly type: string } }).fold.type;
            levels.set(fold, (levels.get(fold) ?? new Set()).add(level.type));
        }
        const everyLevel = ["month", "quarter", "week", "year"];
        expect(Object.fromEntries([...levels].map(([fold, at]) => [fold, [...at].sort()])))
            .toEqual({ sum: everyLevel, mean: everyLevel, count: everyLevel, last: everyLevel });
        const expected = applied(ex.draftLedgers, "draft_ledgers_in_time", await kept(ex.draftLedgers, "draft_ledgers_in_time", "L-1"), ops);
        await h.patch(ex.draftLedgers, withEntry(await h.read(ex.draftLedgers), "L-1", drafted));
        expect(sameEntries(ex.draftLedgers, "draft_ledgers_in_time", await kept(ex.draftLedgers, "draft_ledgers_in_time", "L-1"), expected)).toBe(true);
    });

    test("previews a dragged job's Save as e3 keeps it: its items and totals, and every part above it its subtree's", async () => {
        const binding = await bound(assembliesBinding);
        const { session, draft } = sessionOf(nested.nestedAssemblies, binding);
        const held = (await h.read(nested.nestedAssemblies)).get("A-1")!;
        // The rotor's job, three parts down, dragged into November: its month's totals move with it, and its ancestors'.
        const frame = held.parts.get("frame")!;
        const motor = frame.parts.get("motor")!;
        const rotor = motor.parts.get("rotor")!;
        const turn = rotor.jobs.get("turn")!;
        const moved = { ...turn, start: new Date("2026-11-02T02:00:00Z"), end: new Date("2026-11-02T12:00:00Z") };
        const drafted = {
            ...held,
            parts: withEntry(held.parts, "frame", { ...frame, parts: withEntry(frame.parts, "motor", { ...motor, parts: withEntry(motor.parts, "rotor", {
                ...rotor, jobs: withEntry(rotor.jobs, "turn", moved),
            }) }) }),
        };
        draft([["A-1", held, drafted]]);
        const ops = changesOf(new RecordDrafts(binding, session).preview().get("A-1"), "assemblies_in_time");
        // The job's own entries move, and so do the subtree items of every part above it.
        const runs = new Set([...ops.keys()].map((entry) => (entry as NestedEntry).ik.run.type));
        expect([...runs].sort()).toEqual(["items", "subtree", "subtreeTotals", "totals"]);
        const expected = applied(nested.nestedAssemblies, "assemblies_in_time", await kept(nested.nestedAssemblies, "assemblies_in_time", "A-1"), ops);
        await h.patch(nested.nestedAssemblies, withEntry(await h.read(nested.nestedAssemblies), "A-1", drafted));
        expect(sameEntries(nested.nestedAssemblies, "assemblies_in_time", await kept(nested.nestedAssemblies, "assemblies_in_time", "A-1"), expected)).toBe(true);
    });

    test("previews a summary's totals as e3 keeps them: a job dragged into another month, and one moved to another press", async () => {
        const binding = await bound(jobsBinding);
        const { session, draft } = sessionOf(ex.draftJobs, binding);
        const jobs = await h.read(ex.draftJobs);
        const [one, two] = [jobs.get("J-1")!, jobs.get("J-2")!];
        const draggedTwo = { ...two, start: some(new Date("2026-11-10T00:00:00Z")), end: some(new Date("2026-11-12T00:00:00Z")) };
        const movedOne = { ...one, press: "P2" };
        draft([["J-1", one, movedOne], ["J-2", two, draggedTwo]]);
        const preview = new RecordDrafts(binding, session).preview();
        const totals = await kept(ex.draftJobs, "draft_jobs_by_press_month");
        let expected: unknown = totals;
        for (const id of ["J-1", "J-2"]) expected = addTotals(expected, changesOf(preview.get(id), "draft_jobs_by_press_month"));
        await h.patch(ex.draftJobs, withEntry(withEntry(jobs, "J-1", movedOne), "J-2", draggedTwo));
        expect(equalFor(DictType(summaryEntry, RecordSummaryTotalsType))(await kept(ex.draftJobs, "draft_jobs_by_press_month") as never, expected as never)).toBe(true);
    });

    test("runs a row again only when its draft moves, a row lands or the revision moves", async () => {
        const binding = await bound(ledgersBinding);
        const { session, draft } = sessionOf(ex.draftLedgers, binding);
        const ran: unknown[] = [];
        setRecordDraftsProbe({ ran: (key) => ran.push(key) });
        const drafts = new RecordDrafts(binding, session);
        const ledgers = await h.read(ex.draftLedgers);
        const [one, two] = [ledgers.get("L-1")!, ledgers.get("L-2")!];
        draft([["L-1", one, { ...one, name: "Ledger one" }]]);
        const first = drafts.preview();
        expect(ran).toEqual(["L-1"]);
        expect(drafts.preview()).toBe(first);
        draft([["L-2", two, { ...two, name: "Ledger two" }]]);
        drafts.preview();
        expect(ran).toEqual(["L-1", "L-2"]);
        // Undone: the row left is as it was previewed.
        session.undo();
        expect([...drafts.preview().keys()]).toEqual(["L-1"]);
        expect(ran).toEqual(["L-1", "L-2"]);
        // Another session's commit moves the revision: the row is read there, and runs again once it lands.
        await h.patch(ex.draftLedgers, withEntry(await h.read(ex.draftLedgers), "L-2", { ...two, name: "Ledger 2, audited" }));
        expect(drafts.preview().get("L-1")?.state).toBe("reading");
        await settle();
        expect(drafts.preview().get("L-1")?.state).toBe("previewed");
        expect(ran).toEqual(["L-1", "L-2", "L-1"]);
        drafts.preview();
        expect(ran).toEqual(["L-1", "L-2", "L-1"]);
    });

    test("reads every drafted row it does not hold in one request, each reading until it lands", async () => {
        const binding = await bound(ledgersBinding);
        const { session, draft } = sessionOf(ex.draftLedgers, binding);
        const ledgers = await h.read(ex.draftLedgers);
        const [one, two] = [ledgers.get("L-1")!, ledgers.get("L-2")!];
        draft([["L-1", one, { ...one, name: "Ledger one" }], ["L-2", two, { ...two, name: "Ledger two" }]]);
        const drafts = new RecordDrafts(binding, session);
        expect([...drafts.preview().values()].map((row) => row.state)).toEqual(["previewed", "previewed"]);
        // Another session's commit to a measure of each: both rows are e3's no longer.
        const measured = (ledger: typeof one) => ({ ...ledger, measures: withEntry(ledger.measures, "m3", { ...ledger.measures.get("m3")!, name: "Measure three" }) });
        await h.patch(ex.draftLedgers, withEntry(withEntry(ledgers, "L-1", measured(one)), "L-2", measured(two)));
        const reads = h.requests("rows").length;
        expect([...drafts.preview().values()].map((row) => row.state)).toEqual(["reading", "reading"]);
        await settle();
        expect([...drafts.preview().values()].map((row) => row.state)).toEqual(["previewed", "previewed"]);
        expect(h.requests("rows").length - reads).toBe(1);
    });

    test("previews another session's commit of another value under the draft, and a row whose same value it committed as stale", async () => {
        const binding = await bound(ledgersBinding);
        const { session, draft } = sessionOf(ex.draftLedgers, binding);
        const ledgers = await h.read(ex.draftLedgers);
        const held = ledgers.get("L-1")!;
        const OCT_25 = new Date("2026-10-25T00:00:00Z");
        /** The ledger with one of its measures' readings set. */
        const reading = (ledger: typeof held, measure: string, value: number) => {
            const readings = new SortedMap([...ledger.measures.get(measure)!.readings], instantOrder);
            readings.set(OCT_25, value);
            return { ...ledger, measures: withEntry(ledger.measures, measure, { ...ledger.measures.get(measure)!, readings }) };
        };
        draft([["L-1", held, reading(held, "m1", 50.5)]]);
        const drafts = new RecordDrafts(binding, session);
        // Another measure's reading, committed by another session: the draft's change applies to the row as e3 now holds it.
        await h.patch(ex.draftLedgers, withEntry(ledgers, "L-1", reading(held, "m2", 77.25)));
        drafts.preview();
        await settle();
        const ops = changesOf(drafts.preview().get("L-1"), "draft_ledgers_in_time");
        const now = (await h.read(ex.draftLedgers)).get("L-1")!;
        const expected = applied(ex.draftLedgers, "draft_ledgers_in_time", await kept(ex.draftLedgers, "draft_ledgers_in_time", "L-1"), ops);
        // Saved over it: both changes.
        await h.patch(ex.draftLedgers, withEntry(await h.read(ex.draftLedgers), "L-1", reading(now, "m1", 50.5)));
        expect(sameEntries(ex.draftLedgers, "draft_ledgers_in_time", await kept(ex.draftLedgers, "draft_ledgers_in_time", "L-1"), expected)).toBe(true);
        // The same reading, committed by another session before this Save: the draft's change no longer applies.
        const { session: later, draft: again } = sessionOf(ex.draftLedgers, binding);
        const saved = (await h.read(ex.draftLedgers)).get("L-1")!;
        again([["L-1", saved, reading(saved, "m1", 12.5)]]);
        const stale = new RecordDrafts(binding, later);
        await h.patch(ex.draftLedgers, withEntry(await h.read(ex.draftLedgers), "L-1", reading(saved, "m1", 60.75)));
        stale.preview();
        await settle();
        const row = stale.preview().get("L-1")!;
        expect(row.state).toBe("stale");
        expect(row.changes.size).toBe(0);
    });
});

/** Whether two sets of a nested index's entries are the same, by East's equality at the index's types. */
function sameEntries(record: Rec, name: string, a: unknown, b: unknown): boolean {
    const index = (record.indexes as Readonly<Record<string, { keyType: EastType; valueType: EastType }>>)[name]!;
    return equalFor(indexCollectionType(StringType, index.keyType, index.valueType))(a as never, b as never);
}

/** A summary's entry key: its key, under a Null row key. */
const summaryEntry = StructType({ ik: ex.draftJobs.indexes.draft_jobs_by_press_month.keyType, k: NullType });

/**
 * A summary's totals with a row's previewed adds applied, as e3 applies a
 * delta's: each added to the total held, a key the summary lacks inserted, and
 * one whose count reaches nothing dropped.
 */
const addTotals = East.compile(East.function(
    [DictType(summaryEntry, RecordSummaryTotalsType), DictType(summaryEntry, RecordSummaryOpType)], DictType(summaryEntry, RecordSummaryTotalsType),
    ($, totals, adds) => {
        const next = $.let(totals.copy());
        $.for(adds, ($, op, entry) => {
            $(next.insertOrUpdate(entry, op.unwrap("add"), ($, was, add) => ({ count: was.count.add(add.count), ms: was.ms.add(add.ms) })));
        });
        return next.filter(($, total) => total.count.notEqual(0n));
    }), []) as (totals: unknown, adds: unknown) => unknown;
