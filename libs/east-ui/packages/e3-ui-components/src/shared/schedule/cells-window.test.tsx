/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A window's rows, as the shared schedule reader keeps them (#1599): a kind
 * read a window at a time — one event by its key — is given its window's own
 * stored rows as its cells, kept while its record, its narrowing and the range
 * hold, and standing while they are read again. Over a record that is a plain
 * object here — its revision, its rows, and whether its read is in flight or
 * throws — the reader is held to: what it gives the kind and when; how often it
 * asks the kind's read; how what it hands on stands to what is asked (the one
 * rule, `../view-read.ts`); what a failed read names; and what Saves landed,
 * laid over rows read before them and let go once they are read since. The
 * builders' DOM tests carry the same through e3
 * (`calendar/calendar-records.dom.test.tsx`,
 * `plan/frame/plan-builder-editing.dom.test.tsx`).
 */

import { describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import {
    ArrayType, BlobType, DateTimeType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, toEastTypeValue,
    type ValueTypeOf,
} from "@elaraai/east";
import { SCHEDULE_EVENT_CAP } from "@elaraai/e3-ui/internal";
import { useScheduleCells, type ScheduleCellKind, type ScheduleCellsArgs } from "./cells.js";
import type { ScheduleEventDraftsValue, ScheduleLanded } from "./editing.js";

const Row = StructType({ title: StringType, start: DateTimeType, end: DateTimeType });
type RowValue = ValueTypeOf<typeof Row>;
const Cells = ArrayType(StructType({ key: StringType, row: Row }));
const encodeCells = encodeBeast2For(Cells);
const decodeCells = decodeBeast2For(Cells);
const encodeRow = encodeBeast2For(Row);
const decodeRow = decodeBeast2For(Row);
const sameBytes = equalFor(BlobType);
const compareString = compareFor(StringType);

const at = (text: string) => new Date(text);
const WEEK = { from: at("2026-10-05T00:00:00Z"), to: at("2026-10-12T00:00:00Z") };
const NEXT = { from: at("2026-10-12T00:00:00Z"), to: at("2026-10-19T00:00:00Z") };
const periodOf = (range: { from: Date; to: Date }) => `${range.from.getTime()}:${range.to.getTime()}`;

const BROCHURES: RowValue = { title: "October brochures", start: at("2026-10-06T09:00:00Z"), end: at("2026-10-06T12:00:00Z") };
const CATALOGUE: RowValue = { title: "Weekend catalogue", start: at("2026-10-07T09:00:00Z"), end: at("2026-10-07T12:00:00Z") };
const MOVED: RowValue = { ...BROCHURES, start: at("2026-10-08T09:00:00Z"), end: at("2026-10-08T12:00:00Z") };

/** A record as the reader reads it here: its revision, its rows, and how its reads go. */
interface FakeRecord {
    revision: string;
    rows: Map<string, RowValue>;
    /** Whether its window's read is in flight. */
    flight: boolean;
    /** What its window's read throws. */
    fails: Error | undefined;
    /** How many events its count says the window holds; `undefined` while the count is in flight. */
    counted: number | undefined;
    /** Each call of its window's read, by its range. */
    readonly calls: string[];
}

const record = (rows: [string, RowValue][]): FakeRecord => ({ revision: "r1", rows: new Map(rows), flight: false, fails: undefined, counted: rows.length, calls: [] });

/** The record as a kind read a window at a time: one event by its key, its window's rows its host's to hand the reader. */
function kindOver(of: FakeRecord, over: Partial<ScheduleCellKind> = {}): ScheduleCellKind {
    return {
        key: "job", name: "Job", takes: [], booked: true, shadeKey: (slot) => slot, cellsType: toEastTypeValue(Cells), seriesKey: () => none,
        count: () => (of.counted === undefined ? none : some(BigInt(of.counted))), exact: true, part: undefined, hidden: false, wanted: [],
        stored: (from, to) => {
            of.calls.push(periodOf({ from, to }));
            if (of.fails !== undefined) throw of.fails;
            return of.flight ? none : some(encodeCells([...of.rows].map(([key, row]) => ({ key, row }))));
        },
        revision: () => some(of.revision),
        ...over,
    };
}

const NO_DRAFTS: ScheduleEventDraftsValue = new SortedMap([], compareString);

/** What the reader is asked: a new array of kinds each time, so it reads again as a record's own keys moving make it. */
const asked = (of: FakeRecord, over: Partial<ScheduleCellsArgs> = {}, kind: Partial<ScheduleCellKind> = {}): ScheduleCellsArgs => ({
    host: "Test", kinds: [kindOver(of, kind)], resources: [], paged: undefined, range: WEEK, period: periodOf(WEEK), buckets: [], resolution: undefined,
    drafts: NO_DRAFTS, span: undefined, ...over,
});

/** The rows a kind's cells hold, each by its key. */
const titles = (bytes: Uint8Array | undefined) => (bytes === undefined ? undefined : decodeCells(bytes).map((entry): [string, RowValue] => [entry.key, entry.row]));

describe("a kind read a window at a time is given its window's own rows (#1599)", () => {
    test("within the cap: its rows as its cells, each row by its key's text, the kind named as windowed, and what is handed on current", () => {
        const jobs = record([["J1", BROCHURES], ["J2", CATALOGUE]]);
        const { result } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs) });
        const read = result.current;
        expect(titles(read.reads.get("job"))).toEqual([["J1", BROCHURES], ["J2", CATALOGUE]]);
        expect([[...read.windowed], read.view, read.error, [...read.capped], read.reading, read.drawn]).toEqual([["job"], "current", undefined, [], false, undefined]);
        const held = read.held.get("job")!;
        expect([held.has("J1"), held.has("J2"), held.has("J9"), held.get("J9")]).toEqual([true, true, false, undefined]);
        expect(decodeRow(held.get("J2")!.row)).toEqual(CATALOGUE);
        // Asked again, a row's bytes are the same object: made once.
        expect(held.get("J2")).toBe(held.get("J2"));
        expect([...held].map(([id, { row }]) => [id, decodeRow(row)])).toEqual([["J1", BROCHURES], ["J2", CATALOGUE]]);
    });

    test("before its first read lands it is given nothing — its host waits on the reader, which reads no window of its own — and what is handed on is cold", () => {
        const jobs = record([["J1", BROCHURES]]);
        jobs.flight = true;
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs) });
        expect([result.current.reads.has("job"), result.current.held.has("job"), [...result.current.windowed], result.current.view]).toEqual([false, false, [], "cold"]);
        jobs.flight = false;
        rerender(asked(jobs));
        expect([titles(result.current.reads.get("job")), result.current.view]).toEqual([[["J1", BROCHURES]], "current"]);
    });

    test("its count in flight is a read in flight; past the cap none of its rows is read, and it is no windowed kind", () => {
        const jobs = record([["J1", BROCHURES]]);
        jobs.counted = undefined;
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs) });
        expect([result.current.reads.has("job"), result.current.view, jobs.calls]).toEqual([false, "cold", []]);
        jobs.counted = SCHEDULE_EVENT_CAP + 1;
        rerender(asked(jobs));
        expect([titles(result.current.reads.get("job")), [...result.current.capped], [...result.current.windowed], jobs.calls]).toEqual([[], ["job"], [], []]);
        expect(result.current.notices.map((notice) => [notice.kind, notice.events])).toEqual([["job", SCHEDULE_EVENT_CAP + 1]]);
    });

    test("a kind read whole — given no read of its window — and a hidden one are left to their host: no cells, and no read asked", () => {
        const jobs = record([["J1", BROCHURES]]);
        const whole = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs, {}, { stored: undefined, revision: undefined }) });
        expect([whole.result.current.reads.has("job"), [...whole.result.current.windowed], whole.result.current.view]).toEqual([false, [], "current"]);
        const hidden = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs, {}, { hidden: true }) });
        expect([hidden.result.current.reads.has("job"), [...hidden.result.current.windowed], jobs.calls]).toEqual([false, [], []]);
    });
});

describe("its rows are kept while its record, and the range, hold — and stand while they are read again (#1599)", () => {
    test("a draft's redraw asks the kind's read nothing: one read a revision and a range, however often the reader reads", () => {
        const jobs = record([["J1", BROCHURES]]);
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs) });
        const first = result.current.reads.get("job");
        for (let n = 0; n < 5; n++) {
            const drafts: ScheduleEventDraftsValue = new SortedMap([["job", new SortedMap([[`new-${n}`, new Uint8Array([n])]], compareString)]], compareString);
            rerender(asked(jobs, { drafts }));
            expect([...result.current.drafts.get("job")!.keys()]).toEqual([`new-${n}`]);
        }
        expect(jobs.calls).toEqual([periodOf(WEEK)]);
        // The same cells, by identity: nothing was read or encoded again.
        expect(result.current.reads.get("job")).toBe(first);
    });

    test("a Save, or another session's write: its rows as read before stand while they are read again — live, the view the same — and the rows read since replace them as they land", () => {
        const jobs = record([["J1", BROCHURES], ["J2", CATALOGUE]]);
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs) });
        const standing = result.current.reads.get("job");
        // The record moves; its window's read at the new revision is on its way.
        jobs.revision = "r2";
        jobs.rows.set("J1", MOVED);
        jobs.flight = true;
        rerender(asked(jobs));
        expect([result.current.view, titles(result.current.reads.get("job")), [...result.current.windowed]])
            .toEqual(["rereading", [["J1", BROCHURES], ["J2", CATALOGUE]], ["job"]]);
        expect(result.current.reads.get("job")).toBe(standing);
        expect(decodeRow(result.current.held.get("job")!.get("J1")!.row)).toEqual(BROCHURES);
        // A draft made meanwhile is handed on at once, over the rows standing.
        const drafts: ScheduleEventDraftsValue = new SortedMap([["job", new SortedMap([["J2", new Uint8Array([7])]], compareString)]], compareString);
        rerender(asked(jobs, { drafts }));
        expect([result.current.view, [...result.current.drafts.get("job")!.keys()], result.current.reads.get("job") === standing]).toEqual(["rereading", ["J2"], true]);
        // It lands.
        jobs.flight = false;
        rerender(asked(jobs, { drafts }));
        expect([result.current.view, titles(result.current.reads.get("job"))]).toEqual(["current", [["J1", MOVED], ["J2", CATALOGUE]]]);
        expect(decodeRow(result.current.held.get("job")!.get("J1")!.row)).toEqual(MOVED);
        expect(jobs.calls).toEqual([periodOf(WEEK), periodOf(WEEK), periodOf(WEEK), periodOf(WEEK)]);
    });

    test("a step to another period: what stands is the last period's — a step — until the period's own rows land", () => {
        const jobs = record([["J1", BROCHURES]]);
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs) });
        jobs.flight = true;
        rerender(asked(jobs, { range: NEXT, period: periodOf(NEXT) }));
        expect([result.current.view, titles(result.current.reads.get("job")), [...result.current.windowed]]).toEqual(["stepping", [["J1", BROCHURES]], ["job"]]);
        jobs.flight = false;
        jobs.rows = new Map();
        rerender(asked(jobs, { range: NEXT, period: periodOf(NEXT) }));
        expect([result.current.view, titles(result.current.reads.get("job")), jobs.calls]).toEqual(["current", [], [periodOf(WEEK), periodOf(NEXT), periodOf(NEXT)]]);
    });

    test("a host whose range is a window panned over its rows names no period: what the last range held stands, read again, never a step", () => {
        const jobs = record([["J1", BROCHURES]]);
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs, { period: undefined }) });
        jobs.flight = true;
        rerender(asked(jobs, { range: NEXT, period: undefined }));
        expect([result.current.view, titles(result.current.reads.get("job"))]).toEqual(["rereading", [["J1", BROCHURES]]]);
    });
});

describe("a read that fails names the kind, and its window (#1599)", () => {
    test("the kind's window's read throwing: why, the kind, and that it was its window — the last rows standing; the same failure is the same object", () => {
        const jobs = record([["J1", BROCHURES]]);
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs) });
        jobs.revision = "r2";
        jobs.fails = new Error("the store is down");
        rerender(asked(jobs));
        const failure = result.current.error;
        expect(failure).toEqual({ reason: "the store is down", kinds: ["job"], window: true });
        expect([titles(result.current.reads.get("job")), result.current.view]).toEqual([[["J1", BROCHURES]], "current"]);
        rerender(asked(jobs));
        expect(result.current.error).toBe(failure);
        // Asked again, the fault gone: read, and no failure said.
        jobs.fails = undefined;
        rerender(asked(jobs));
        expect([result.current.error, result.current.view]).toEqual([undefined, "current"]);
    });

    test("its count throwing is its window's failure too", () => {
        const jobs = record([["J1", BROCHURES]]);
        const failing = kindOver(jobs, { count: () => { throw new Error("no count"); } });
        const { result } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: { ...asked(jobs), kinds: [failing] } });
        expect(result.current.error).toEqual({ reason: "no count", kinds: ["job"], window: true });
    });
});

describe("what a Save landed, over a window's rows read before it (#1599)", () => {
    const savedRow = encodeRow(MOVED);
    const savedDraft = new Uint8Array([1, 2, 3]);
    /** What the editing keeps of a Save drafted at `r1`: the brochures moved, and the catalogue deleted. */
    const landed: ScheduleLanded = new Map([["job", {
        rows: new Map([["J1", { draft: savedDraft, row: savedRow }], ["J2", { draft: new Uint8Array([9]), row: undefined }]]),
        from: new Set(["r1"]),
    }]]);

    test("each event the Save landed draws as the Save left it — its draft laid under the drafts, its row held as saved, one it deleted gone — until the rows are read since, when it is let go", () => {
        const jobs = record([["J1", BROCHURES], ["J2", CATALOGUE]]);
        const let_go: [string, string[]][] = [];
        const shown = (kind: string, ids: Iterable<string>) => { let_go.push([kind, [...ids]]); };
        const { result, rerender } = renderHook((props: ScheduleCellsArgs) => useScheduleCells(props), { initialProps: asked(jobs, { shown }) });
        // Confirmed by key: the record is at r2, its window's read there on its way, the Save's events handed on.
        jobs.revision = "r2";
        jobs.rows = new Map([["J1", MOVED]]);
        jobs.flight = true;
        rerender(asked(jobs, { landed, shown }));
        const drafts = result.current.drafts.get("job")!;
        expect([[...drafts.keys()], sameBytes(drafts.get("J1")!, savedDraft)]).toEqual([["J1", "J2"], true]);
        const held = result.current.held.get("job")!;
        expect([held.has("J1"), held.has("J2"), held.get("J2"), sameBytes(held.get("J1")!.row, savedRow)]).toEqual([true, false, undefined, true]);
        expect([...held].map(([id, { row }]) => [id, decodeRow(row)])).toEqual([["J1", MOVED]]);
        // The cells themselves stand as read: the rows from before the Save.
        expect(titles(result.current.reads.get("job"))).toEqual([["J1", BROCHURES], ["J2", CATALOGUE]]);
        expect(let_go).toEqual([]);
        // A draft made since draws in the landed event's place.
        const own: ScheduleEventDraftsValue = new SortedMap([["job", new SortedMap([["J1", new Uint8Array([5])]], compareString)]], compareString);
        rerender(asked(jobs, { landed, shown, drafts: own }));
        expect(sameBytes(result.current.drafts.get("job")!.get("J1")!, new Uint8Array([5]))).toBe(true);
        // The rows read since land: what the Save landed is let go, and nothing of it is laid.
        jobs.flight = false;
        rerender(asked(jobs, { landed, shown }));
        expect(let_go).toEqual([["job", ["J1", "J2"]]]);
        expect([titles(result.current.reads.get("job")), result.current.drafts.get("job")?.size ?? 0]).toEqual([[["J1", MOVED]], 0]);
        expect(decodeRow(result.current.held.get("job")!.get("J1")!.row)).toEqual(MOVED);
    });
});
