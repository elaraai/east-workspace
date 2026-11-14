/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Every builder's Search Records (`search-records.ts`, #1398, #1621): the one
 * engine that seeks, lists and picks for the Plan, the Calendar, the
 * Allocation, the Roster, the Flowchart, the Schematic and the Sheet, each
 * builder naming its sources, its lines and its pick, and rendering.
 *
 * - What a query finds among rows held whole, by their keys in East's order at
 *   their key type (`keyMatches`); the key type the box parses at, and a query
 *   as a source keyed by another type reads it (`boxKeyType`, `kindQuery`);
 *   the stretches a list reads, one run after another (`stretchesAt`); and the
 *   token that tells the box a source held whole was read again (`readToken`).
 * - The box over sources held whole (`useSearchRecords`): a find's count and
 *   its lines, in the builder's order; the latest find alone; the latest pick
 *   alone, a query asked again leaving it standing; what tells the builder its
 *   pick stands no more; what moves `requery` and `relist`; a pick whose row
 *   cannot be read again said on the console; and a box the builder names as
 *   another starting again, the last one's pick left behind.
 * - A host's paged source, as a Sheet draws it, sought by its own key search:
 *   asked the box's query as the key search's East value, its matches the one
 *   run it answers, a list reading them by their places there; a pick of one
 *   told by its place at once, with nothing read, to a builder that takes
 *   places; and the box asking its query again as the source moves to another
 *   snapshot.
 * - On e3 itself, a source sought through its record — the Schematic
 *   examples' racks, their source of the rail narrowed by owner: its matches
 *   placed in the record and listed in place, a gap kept; each row its
 *   narrowing hides said so, as e3 says which choices hide it; a narrowing that
 *   moved since the find the one a list asks under; a pick's place known with
 *   nothing read only where its source hides no row (`pickPlace`); and the box
 *   asking its query again as the record moves, and listing its lines again
 *   as the narrowing does.
 * - On a page whose sources hold a scope (#1621) — the scoped-page example's
 *   runs and crew, scoped to a press: the press's runs alone, sought through
 *   the index on exactly the press, a block of matches for each press of the
 *   page's and a list across the blocks, each row it reads carrying its place
 *   among the page's rows; rows a builder holds whole sought among those the
 *   scope holds; and the box asking its query again as the page's scope moves.
 * - Where a key is among a builder's rows (`useSeekPlace`, the Sheet's Go to
 *   issue): its first match's place, the latest ask alone answering, and none
 *   asked before what the matches are read from moved, or as the builder let
 *   it go.
 *
 * Each builder's lines and picks are its own DOM tests'.
 */

import { useMemo } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
    ArrayType, East, EastTypeType, IntegerType, SortedMap, StringType, StructType, compareFor, equalFor, none, printFor, some, toEastTypeValue, variant,
    type ValueTypeOf, type option,
} from "@elaraai/east";
import { SeekQueryType, type SeekRangeType } from "@elaraai/east-ui";
import { RecordSliceWhereType, bindRecord, toSeekQuery, type DatasetKeyQuery, type RecordSliceBindType, type RecordSliceEntry } from "@elaraai/east-ui/internal";
import { formatters, getRegisteredPlatformImplementations, registerReactiveTracker, type KeySearchSource, type ReactiveTracker } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import * as scoped from "@elaraai/e3-ui/examples/calendar/calendar-scope";
import { act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { datasetPathToString } from "../../platform/dataset-store.js";
import { hiddenByText, hiddenLine, hiddenOf, useSourceHidden, type HiddenWords, type SourceHidden } from "./hidden.js";
import { STRING_KEYS, kindKeys, type KindKeys } from "./kind-keys.js";
import {
    boxKeyType, keyMatches, kindQuery, listFound, pickPlace, readToken, readsRows, scopeHeld, searchRuns, stretchesAt, useSearchRecords, useSeekPlace,
    type Found, type PagedSought, type PickTurn, type RecordSought, type SearchRecordsOptions, type SeekingSource, type WholeSought,
} from "./search-records.js";

const h = e3Harness({ "schematic/schematic": ex, "calendar/calendar-scope": scoped }, { measure: false });

type Bind = ValueTypeOf<RecordSliceBindType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const sameType = equalFor(EastTypeType);
const whereEqual = equalFor(RecordSliceWhereType);
const printString = printFor(StringType);
const printInteger = printFor(IntegerType);
const seekQueryEqual = equalFor(SeekQueryType);

/** Where a host's paged source says a query lands, as its key search answers it. */
type SeekRange = ValueTypeOf<SeekRangeType>;

/** The key types the tests key their rows by. */
const atString = STRING_KEYS.keyType;
const integers = kindKeys(toEastTypeValue(IntegerType));
const spots = kindKeys(toEastTypeValue(StructType({ row: IntegerType, col: StringType })));

describe("keyMatches", () => {
    const found = (query: DatasetKeyQuery) => keyMatches(["A03", "A01", "B02", "A02", "a04"], (key) => key, query);

    test("rows held whole are found by their keys in East's order, as the server finds a key in a record's: a key's start, a quoted key, a range", () => {
        expect(found({ prefix: "A0" })).toEqual(["A01", "A02", "A03"]);
        expect(found({ prefix: "a0" })).toEqual(["a04"]);
        expect(found({ prefix: "C" })).toEqual([]);
        expect(found({ prefix: "" })).toEqual(["A01", "A02", "A03", "B02", "a04"]);
        expect(found({ key: printString("A02") })).toEqual(["A02"]);
        expect(found({ key: printString("A09") })).toEqual([]);
        // A key's text unquoted is no String's literal: it finds none.
        expect(found({ key: "A02" })).toEqual([]);
        expect(found({ from: [printString("A02")], to: [printString("B")] })).toEqual(["A02", "A03"]);
        expect(found({ from: [printString("B")] })).toEqual(["B02", "a04"]);
    });

    test("at another key type, in its order — never its texts'", () => {
        const numbers = (query: DatasetKeyQuery) => keyMatches([10n, 2n, 9n].map((n) => printInteger(n)), (key) => key, query, integers);
        expect(numbers({ key: printInteger(10n) })).toEqual(["10"]);
        expect(numbers({ from: [printInteger(2n)] })).toEqual(["2", "9", "10"]);
        expect(numbers({ from: [printInteger(2n)], to: [printInteger(10n)] })).toEqual(["2", "9"]);
        expect(numbers({ prefix: "1" })).toEqual([]);
    });

    test("rows as the builder holds them, each by its key's text: a text no key prints as is no key a query finds, and of rows whose key's text repeats, the last stands for them", () => {
        const rows = [{ id: "7", n: 1 }, { id: "x", n: 2 }, { id: "3", n: 3 }, { id: "7", n: 4 }];
        expect(keyMatches(rows, (row) => row.id, { from: [printInteger(0n)] }, integers).map((row) => row.n)).toEqual([3, 4]);
    });
});

describe("kindQuery", () => {
    test("a query the box parsed at the source's key type is the source's as it is", () => {
        const start: DatasetKeyQuery = { prefix: "M" };
        expect(kindQuery(start, atString, STRING_KEYS)).toBe(start);
        const ten: DatasetKeyQuery = { key: printInteger(10n) };
        expect(kindQuery(ten, integers.keyType, integers)).toBe(ten);
    });

    test("parsed at String over sources keyed by several types, the text as typed, read at the source's own", () => {
        expect(kindQuery({ prefix: "10" }, atString, integers)).toEqual({ key: "10" });
        expect(kindQuery({ from: [printString("2")], to: [printString("9")] }, atString, integers)).toEqual({ from: ["2"], to: ["9"] });
        expect(kindQuery({ prefix: "1, M" }, atString, spots)).toEqual({ fields: ["1"], prefix: "M" });
    });

    test("text that reads as no key of the source's finds none of its rows", () => {
        expect(kindQuery({ prefix: "M1" }, atString, integers)).toBeUndefined();
        expect(kindQuery({ prefix: "" }, atString, integers)).toBeUndefined();
        expect(kindQuery({ key: printString("10") }, atString, integers)).toBeUndefined();
    });
});

describe("boxKeyType", () => {
    test("the sources' key type where they share one, compared as East compares types; else String, and String with no source", () => {
        expect(sameType(boxKeyType([integers, kindKeys(toEastTypeValue(IntegerType))]), integers.keyType)).toBe(true);
        expect(sameType(boxKeyType([spots]), spots.keyType)).toBe(true);
        expect(sameType(boxKeyType([integers, STRING_KEYS]), atString)).toBe(true);
        expect(sameType(boxKeyType([]), atString)).toBe(true);
    });
});

describe("stretchesAt", () => {
    const runs = [{ name: "racks", count: 3 }, { name: "pumps", count: 0 }, { name: "cooling", count: 2 }];
    const at = (row: number, limit: number) => stretchesAt(runs, row, limit).map(({ run, offset, n, at: from }) => `${run.name} ${offset}+${n}@${from}`);

    test("a list's rows are read one run after another, each block after the one before: a run with no match reads nothing", () => {
        expect(at(0, 20)).toEqual(["racks 0+3@0", "cooling 0+2@3"]);
        expect(at(2, 2)).toEqual(["racks 2+1@2", "cooling 0+1@3"]);
        expect(at(4, 1)).toEqual(["cooling 1+1@4"]);
        expect(at(5, 3)).toEqual([]);
        expect(at(1, 0)).toEqual([]);
    });
});

describe("readsRows", () => {
    test("a row a list read no row of lists nothing, its place kept; any other is the builder's item, from its key's text and its row", () => {
        const read = readsRows((id, row) => `${id}:${printInteger(row as bigint)}`);
        const entry: RecordSliceEntry = { ik: variant("by_key", null) };
        expect(read({ id: "r1", key: "r1", row: 7n, entry, place: 0n })).toEqual(some(some("r1:7")));
        expect(read({ id: "r2", key: "r2", row: undefined, entry, place: 1n })).toEqual(some(none));
    });
});

describe("readToken", () => {
    test("moves as a read answers another value, never as it answers the value it answered before; and is `-` while the read is pending", () => {
        const rows = [1, 2];
        const first = readToken(some(rows));
        expect(readToken(some(rows))).toBe(first);
        expect(readToken(some([1, 2]))).not.toBe(first);
        expect(readToken(none)).toBe("-");
    });
});

/** What lets go of the trackers a test registered, as it ends. */
const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length > 0) cleanups.pop()!(); });

let cells = 0;

/**
 * A value read as a binding's is, tracked: `get` records the read, as a binding records a key it reads, and `set` holds
 * another value and tells whoever read it, as a write of the key does.
 *
 * @param initial - What it holds first
 * @returns Its read and its write
 */
function trackedCell<V>(initial: V) {
    const readers = new Set<() => void>();
    let value = initial;
    let version = 0;
    let recording: Map<string, number> | null = null;
    const tracker: ReactiveTracker = {
        id: `cell${cells++}`,
        enableTracking() { recording = new Map(); },
        disableTracking() {
            const read = recording ?? new Map<string, number>();
            recording = null;
            return read;
        },
        getStore: () => ({
            subscribe(_key, callback) {
                readers.add(callback);
                return () => { readers.delete(callback); };
            },
            getKeyVersion: () => version,
        }),
    };
    cleanups.push(registerReactiveTracker(tracker));
    return {
        get(): V {
            if (recording !== null && !recording.has("value")) recording.set("value", version);
            return value;
        },
        set(next: V): void {
            value = next;
            version++;
            for (const callback of [...readers]) callback();
        },
    };
}

/** A row a builder holds whole: its source's name, and its key's text. */
interface Item {
    readonly source: string;
    readonly id: string;
}
const items = (source: string, ids: readonly string[]): readonly Item[] => ids.map((id) => ({ source, id }));

/**
 * A source held whole.
 *
 * @param rows - Its rows, as the builder reads them
 * @param keys - Its keys; String's by default
 * @param token - What tells the box its rows were read again; none by default
 * @returns The source
 */
function held(rows: () => option<readonly Item[]>, keys: KindKeys = STRING_KEYS, token?: () => string): WholeSought<Item> {
    return { rows, idOf: (item) => item.id, keys, token };
}

/** What the builder has been told: each pick and its turn, and how many times its pick stood no more. */
interface Told {
    readonly picks: { readonly found: Found<Item>; readonly turn: PickTurn }[];
    cleared: number;
}

/** What the box is mounted with but its builder's words and pick, which the mount gives. */
type BoxProps = Pick<SearchRecordsOptions<Item>, "sources"> & Partial<Omit<SearchRecordsOptions<Item>, "sources">>;

/**
 * Mounts a builder's Search Records over its sources: each line its source's name and the row's key, `· hidden` where
 * something hides it; its picks and its clears told.
 *
 * @param initial - Its sources, and what else it is mounted with
 * @returns What it has told the builder, the box, and what mounts it again
 */
function mountBox(initial: BoxProps) {
    const told: Told = { picks: [], cleared: 0 };
    const view = renderHook((props: BoxProps) => useSearchRecords<Item>({
        name: "Spec", resetKey: "spec",
        line: ({ item, hidden }) => ({ label: `${item.source} ${item.id}${hidden === undefined ? "" : " · hidden"}`, text: item.id }),
        onPick: (found, turn) => { told.picks.push({ found, turn }); },
        onCleared: () => { told.cleared++; },
        ...props,
    }), { initialProps: initial });
    const box = (): KeySearchSource => {
        const source = view.result.current;
        if (source === undefined) throw new Error("the builder's Search Records has no source");
        return source;
    };
    return { told, box, rerender: view.rerender };
}

/**
 * The box's lines `[row, row + limit)`, each its place and its words.
 *
 * @param box - The box's source
 * @param row - The first line
 * @param limit - How many
 * @returns The lines
 */
async function lines(box: KeySearchSource, row: number, limit: number): Promise<[number, string][]> {
    return (await box.listRange(row, limit)).map((line): [number, string] => {
        if (typeof line === "string") throw new Error(`Search Records listed a line with no place: ${line}`);
        return [line.row, line.label];
    });
}

/** The picks handed to the builder: each row's place, its key and how the box asked it. */
const picked = (told: Told) => told.picks.map(({ found, turn }) => [found.at, found.item.id, turn.how]);

describe("useSearchRecords", () => {
    test("no source, no box; it parses typed text at the sources' key type where they share one, else at String, and lists the first matches of an empty box where it parses at String", () => {
        const of = (keys: readonly KindKeys[]) => renderHook(() => useSearchRecords<Item>({
            name: "Spec", resetKey: "spec", sources: keys.map((k) => held(() => some([]), k)), line: () => ({ label: "", text: "" }), onPick: () => {},
        })).result.current;
        expect(of([])).toBeUndefined();
        const text = of([STRING_KEYS, STRING_KEYS])!;
        expect(sameType(text.keyType, atString)).toBe(true);
        expect(text.browseQuery).toEqual({ prefix: "" });
        const numbers = of([integers, kindKeys(toEastTypeValue(IntegerType))])!;
        expect(sameType(numbers.keyType, integers.keyType)).toBe(true);
        expect(numbers.browseQuery).toBeUndefined();
        const mixed = of([integers, STRING_KEYS])!;
        expect(sameType(mixed.keyType, atString)).toBe(true);
        expect(mixed.browseQuery).toEqual({ prefix: "" });
    });

    test("a find counts every source's matches, and its lines hold them in the builder's order, each source's in its keys' order at its key type — one keyed otherwise reading the text as typed", async () => {
        const texts = held(() => some(items("text", ["2", "10", "1"])));
        const numbers = held(() => some(items("number", [10n, 2n, 1n].map((n) => printInteger(n)))), integers);
        const { box } = mountBox({ sources: [texts, numbers] });
        expect(sameType(box().keyType, atString)).toBe(true);
        // `1`: the texts that start so, and the number 1.
        expect(await box().find({ prefix: "1" })).toEqual({ found: true, row: 0, count: 3 });
        expect(await lines(box(), 0, 10)).toEqual([[0, "text 1"], [1, "text 10"], [2, "number 1"]]);
        // `"1".."3"`: the texts between, in their texts' order, then the numbers between, in theirs.
        expect(await box().find({ from: [printString("1")], to: [printString("3")] })).toEqual({ found: true, row: 0, count: 5 });
        expect(await lines(box(), 0, 10)).toEqual([[0, "text 1"], [1, "text 10"], [2, "text 2"], [3, "number 1"], [4, "number 2"]]);
        // A list from the middle: its rows from there, at their places.
        expect(await lines(box(), 2, 2)).toEqual([[2, "text 2"], [3, "number 1"]]);
        // Text no key starts with, and no number is: nothing.
        expect(await box().find({ prefix: "1a" })).toEqual({ found: false, row: 0, count: 0 });
        expect(await lines(box(), 0, 10)).toEqual([]);
    });

    test("the latest find alone is listed: one answered after a newer one was asked, or after a clear, leaves the list as it is", async () => {
        const slow = trackedCell<option<readonly Item[]>>(none);
        const { box, rerender } = mountBox({ sources: [held(() => slow.get())] });
        const first = box().find({ prefix: "" });
        rerender({ sources: [held(() => some(items("rack", ["A01", "A02"])))] });
        expect(await box().find({ prefix: "A02" })).toEqual({ found: true, row: 0, count: 1 });
        await act(async () => { slow.set(some(items("late", ["A01", "A02", "A03"]))); });
        // The first answers its own count, and the list holds the newer find's matches.
        expect(await first).toEqual({ found: true, row: 0, count: 3 });
        expect(await lines(box(), 0, 10)).toEqual([[0, "rack A02"]]);
        const gate = trackedCell<option<readonly Item[]>>(none);
        rerender({ sources: [held(() => gate.get())] });
        const cleared = box().find({ prefix: "" });
        act(() => { box().clear(); });
        await act(async () => { gate.set(some(items("rack", ["A01"]))); });
        expect(await cleared).toEqual({ found: true, row: 0, count: 1 });
        expect(await lines(box(), 0, 10)).toEqual([]);
    });

    test("a pick reads its row again and hands it to the builder, the latest pick alone: a newer pick, a new query or a clear leaves one on its way behind, and a query asked again leaves it standing", async () => {
        const { box, told } = mountBox({ sources: [held(() => some(items("rack", ["A01", "A02", "A03"])))] });
        await box().find({ prefix: "A" });
        // A pick, then a step before it lands: the step's row alone is handed over, as a step.
        act(() => { box().jump(0, "pick"); box().jump(1, "step"); });
        await settle();
        expect(picked(told)).toEqual([[1, "A02", "step"]]);
        // A pick, then a clear: nothing.
        act(() => { box().jump(0, "pick"); box().clear(); });
        await settle();
        expect(picked(told)).toEqual([[1, "A02", "step"]]);
        // A pick, then its query asked again, as what its matches are read from moved: it lands.
        await box().find({ prefix: "A" });
        act(() => { box().jump(2, "pick"); void box().find({ prefix: "A" }, true); });
        await settle();
        expect(picked(told)).toEqual([[1, "A02", "step"], [2, "A03", "pick"]]);
        // It is the box's latest pick until another is made.
        const turn = told.picks[1]!.turn;
        expect(turn.current()).toBe(true);
        act(() => { box().jump(0, "pick"); });
        expect(turn.current()).toBe(false);
        await settle();
        expect(picked(told)).toEqual([[1, "A02", "step"], [2, "A03", "pick"], [0, "A01", "pick"]]);
        // A pick, then a new query: nothing.
        act(() => { box().jump(1, "pick"); void box().find({ prefix: "A0" }); });
        await settle();
        expect(picked(told)).toHaveLength(3);
    });

    test("the builder is told its pick stands no more as the search is cleared, or a new query is asked in its place — never as one is asked again", async () => {
        const { box, told } = mountBox({ sources: [held(() => some(items("rack", ["A01"])))] });
        await box().find({ prefix: "A" });
        expect(told.cleared).toBe(1);
        await box().find({ prefix: "A" }, true);
        expect(told.cleared).toBe(1);
        act(() => { box().clear(); });
        expect(told.cleared).toBe(2);
        await box().find({ prefix: "A0" });
        expect(told.cleared).toBe(3);
    });

    test("it asks its query again as a source held whole is read again, or as what else the builder says its matches are read from moves — never as it renders again, nor as a read answers the rows it answered before — and lists its lines again as what else they read moves", async () => {
        const shown = items("rack", ["A01"]);
        const cell = trackedCell<option<readonly Item[]>>(some(shown));
        const racks = held(() => cell.get(), STRING_KEYS, () => readToken(cell.get()));
        const layout = {};
        const { box, rerender } = mountBox({ sources: [racks], requeryBy: [layout], relistBy: [layout] });
        const requery = box().requery!;
        const relist = box().relist!;
        rerender({ sources: [racks], requeryBy: [layout], relistBy: [layout] });
        expect([box().requery, box().relist]).toEqual([requery, relist]);
        // Read again, the same rows: nothing moves.
        await act(async () => { cell.set(some(shown)); });
        expect(box().requery).toBe(requery);
        // Read again, other rows: the query is asked again, and that lists nothing again.
        await act(async () => { cell.set(some(items("rack", ["A01", "A02"]))); });
        await waitFor(() => expect(box().requery).toBe(requery + 1));
        expect(box().relist).toBe(relist);
        // What else its matches are read from moves.
        const moved = {};
        rerender({ sources: [racks], requeryBy: [moved], relistBy: [layout] });
        expect([box().requery, box().relist]).toEqual([requery + 2, relist]);
        // What else its lines read moves: they are listed again, the query not asked again.
        rerender({ sources: [racks], requeryBy: [moved], relistBy: [moved] });
        expect([box().requery, box().relist]).toEqual([requery + 2, relist + 1]);
    });

    test("a pick whose row cannot be read again is said on the console, naming who seeks, and nothing is handed over", async () => {
        const said = vi.spyOn(console, "error").mockImplementation(() => {});
        const refused = new Error("the lanes could not be read");
        const { box, told } = mountBox({ sources: [held(() => some(items("rack", ["A01"])))], hidings: () => { throw refused; } });
        await box().find({ prefix: "A" });
        act(() => { box().jump(0, "pick"); });
        await waitFor(() => expect(said).toHaveBeenCalledWith("[Spec] Search Records could not read the row it found:", refused));
        expect(told.picks).toEqual([]);
    });

    test("a box the builder names as another starts again: what the last one found is let go, a pick of its on its way is left behind, and the builder is told its pick stands no more — never as it renders again under the same name", async () => {
        const gate = trackedCell(false);
        const orders = pagedOrders(["A01", "A02"], () => some({ found: true, row: 0n, count: 2n }));
        // Its rows' page answers once the gate opens: a pick that reads its row is on its way until then.
        const slow: PagedSought<Item> = { ...orders.source, page: (from, count) => (gate.get() ? orders.source.page(from, count) : none) };
        const { box, told, rerender } = mountBox({ sources: [slow], resetKey: "rev-1" });
        await box().find({ prefix: "A" });
        expect(told.cleared).toBe(1);
        rerender({ sources: [slow], resetKey: "rev-1" });
        expect(told.cleared).toBe(1);
        act(() => { box().jump(1, "pick"); });
        rerender({ sources: [slow], resetKey: "rev-2" });
        expect(told.cleared).toBe(2);
        await act(async () => { gate.set(true); });
        await settle();
        expect(told.picks).toEqual([]);
        expect(await lines(box(), 0, 10)).toEqual([]);
        // The new box finds and picks as any does.
        await box().find({ prefix: "A" });
        act(() => { box().jump(1, "pick"); });
        await settle();
        expect(picked(told)).toEqual([[1, "A02", "pick"]]);
    });
});

/**
 * A host's paged source of orders, as a Sheet draws it: `ids` in their keys' order, read by their places, and its key
 * search answering `answer` — each query it is asked, and each page it reads, kept.
 *
 * @param ids - Its rows' keys, in their order
 * @param answer - What its key search answers, tracked
 * @param snapshot - Its id — `orders` by default — and the snapshot it serves, where it names one
 * @returns The source, the queries its key search was asked, and the pages read
 */
function pagedOrders(ids: readonly string[], answer: () => option<SeekRange>, snapshot: Partial<Pick<SeekingSource, "id" | "revision" | "query">> = {}) {
    const asked: ValueTypeOf<SeekQueryType>[] = [];
    const pages: [bigint, bigint][] = [];
    const source: PagedSought<Item> = {
        keys: STRING_KEYS,
        paged: {
            id: snapshot.id ?? "orders", revision: snapshot.revision, query: snapshot.query,
            seek: (query) => {
                asked.push(query);
                return answer();
            },
        },
        page: (from, count) => {
            pages.push([from, count]);
            return some(items("orders", ids.slice(Number(from), Number(from + count))));
        },
    };
    return { source, asked, pages };
}

/** Whether every query a key search was asked is the box's, as the key search's East value. */
const askedAs = (asked: readonly ValueTypeOf<SeekQueryType>[], query: DatasetKeyQuery) =>
    asked.length > 0 && asked.every((seek) => seekQueryEqual(seek, toSeekQuery(query)));

describe("a paged source, sought by its own key search", () => {
    test("is asked the box's query as the key search's East value: its matches are the one run it answers, and a list reads them by their places there", async () => {
        const orders = pagedOrders(["A01", "A02", "A03", "B01", "B02", "C01"], () => some({ found: true, row: 3n, count: 2n }));
        const { box } = mountBox({ sources: [orders.source] });
        expect(await box().find({ prefix: "B" })).toEqual({ found: true, row: 0, count: 2 });
        expect(askedAs(orders.asked, { prefix: "B" })).toBe(true);
        expect(await lines(box(), 0, 10)).toEqual([[0, "orders B01"], [1, "orders B02"]]);
        // A list from the middle of the run: its rows from there, at their places among the source's.
        expect(await lines(box(), 1, 1)).toEqual([[1, "orders B02"]]);
        expect(orders.pages).toEqual([[3n, 2n], [4n, 1n]]);
    });

    test("finds nothing where its key search finds nothing, or answers a run of none; and a find waits on a key search still pending", async () => {
        const missing = pagedOrders(["A01"], () => some({ found: false, row: 1n, count: 0n }));
        expect(await mountBox({ sources: [missing.source] }).box().find({ key: printString("Z01") })).toEqual({ found: false, row: 0, count: 0 });
        const empty = pagedOrders(["A01"], () => some({ found: true, row: 0n, count: 0n }));
        expect(await mountBox({ sources: [empty.source] }).box().find({ prefix: "A" })).toEqual({ found: false, row: 0, count: 0 });
        // Neither is a run of the list's: a run of none would hold a place no row fills.
        expect(await searchRuns([missing.source], { key: printString("Z01") }, atString)).toEqual([]);
        expect(await searchRuns([empty.source], { prefix: "A" }, atString)).toEqual([]);
        const answer = trackedCell<option<SeekRange>>(none);
        const slow = pagedOrders(["A01", "A02"], () => answer.get());
        const { box } = mountBox({ sources: [slow.source] });
        const finding = box().find({ prefix: "A" });
        await act(async () => { answer.set(some({ found: true, row: 0n, count: 2n })); });
        expect(await finding).toEqual({ found: true, row: 0, count: 2 });
        expect(await lines(box(), 0, 10)).toEqual([[0, "orders A01"], [1, "orders A02"]]);
    });

    test("the box asks its query again as the source moves to another snapshot — its revision, a live source's narrowing, another source — never as the builder renders again, nor as the snapshot it serves is read again unmoved", async () => {
        const revision = trackedCell<option<string>>(some("rev-1"));
        const narrowing = trackedCell("status: Open");
        const answer = () => some({ found: true, row: 0n, count: 1n });
        const live = pagedOrders(["A01"], answer, { revision: () => revision.get(), query: () => narrowing.get() });
        const { box, rerender } = mountBox({ sources: [live.source] });
        await settle();
        const requery = box().requery!;
        rerender({ sources: [live.source] });
        expect(box().requery).toBe(requery);
        await act(async () => { revision.set(some("rev-1")); });
        expect(box().requery).toBe(requery);
        await act(async () => { revision.set(some("rev-2")); });
        await waitFor(() => expect(box().requery).toBe(requery + 1));
        await act(async () => { narrowing.set("status: Closed"); });
        await waitFor(() => expect(box().requery).toBe(requery + 2));
        const returns = pagedOrders(["A01"], answer, { id: "returns", revision: () => revision.get(), query: () => narrowing.get() });
        rerender({ sources: [returns.source] });
        await waitFor(() => expect(box().requery).toBe(requery + 3));
    });

    test("a pick of its match goes to a builder that takes places by its place at once, with nothing read — its row's page still on its way — the latest pick alone current; a builder that takes none, or names a source as hiding a row, has its row read again", async () => {
        const gate = trackedCell(false);
        const reads: [bigint, bigint][] = [];
        const orders = pagedOrders(["A01", "A02", "A03", "B01", "B02", "C01"], () => some({ found: true, row: 3n, count: 2n }));
        // Its rows' page answers once the gate opens: a pick that read its row would wait on it.
        const slow: PagedSought<Item> = {
            ...orders.source,
            page: (from, count) => {
                reads.push([from, count]);
                return gate.get() ? orders.source.page(from, count) : none;
            },
        };
        const places: { readonly place: bigint; readonly turn: PickTurn }[] = [];
        const onPickPlace = (place: bigint, turn: PickTurn) => { places.push({ place, turn }); };
        const { box, told, rerender } = mountBox({ sources: [slow], onPickPlace });
        await box().find({ prefix: "B" });
        // B02, the run's second match: the source's fifth row.
        act(() => { box().jump(1, "pick"); });
        expect(places.map(({ place, turn }) => [place, turn.how, turn.current()])).toEqual([[4n, "pick", true]]);
        act(() => { box().jump(0, "step"); });
        expect(places.map(({ place, turn }) => [place, turn.how, turn.current()])).toEqual([[4n, "pick", false], [3n, "step", true]]);
        // A row the find did not find is no pick's.
        act(() => { box().jump(2, "pick"); });
        await settle();
        expect(places).toHaveLength(2);
        expect(reads).toEqual([]);
        expect(told.picks).toEqual([]);
        // A builder that takes no place: its row is read again, and handed over once it is.
        rerender({ sources: [slow] });
        act(() => { box().jump(1, "pick"); });
        await settle();
        expect(reads).toEqual([[4n, 1n]]);
        expect(told.picks).toEqual([]);
        await act(async () => { gate.set(true); });
        await waitFor(() => expect(picked(told)).toEqual([[1, "B02", "pick"]]));
        // One that names a source as hiding a row: the row is read, since what hides it is asked of it.
        rerender({ sources: [slow], onPickPlace, hidings: (rows) => rows.map(() => []) });
        act(() => { box().jump(0, "pick"); });
        await waitFor(() => expect(picked(told)).toEqual([[1, "B02", "pick"], [0, "B01", "pick"]]));
        expect(places).toHaveLength(2);
    });
});

/** The racks as a builder's source of the rail: by owner, through their index. */
const racksProgram = East.function([], undefined, ($) => {
    const racks = $.let(Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_owner"] }));
    return bindRecord("search-records.racks", racks, { fields: { owner: { label: "Owner" } } });
});

/**
 * The racks' source of the rail, bound over the test's workspace as a mounted page binds it.
 *
 * @returns Its part of the slice
 */
async function racks(): Promise<Bind> {
    await h.install({ fn: racksProgram });
    return East.compile(racksProgram, getRegisteredPlatformImplementations())() as unknown as Bind;
}

/** The racks, as the request log names them. */
const RACKS = datasetPathToString(ex.schematicRacks.path);

/** Harbour Labs' racks, A01 and A02 — never Northwind Media's A03 and A04, Elmway College's A05 and A06, nor A07, let to no one. */
const HARBOUR: Where = new SortedMap([["owner", variant("values", [printString("Harbour Labs")])]], compareString);
/** Northwind Media's racks, A03 and A04. */
const NORTHWIND: Where = new SortedMap([["owner", variant("values", [printString("Northwind Media")])]], compareString);

/**
 * Writes the source's narrowing, as the rail's chips write it.
 *
 * @param part - The source's part of the slice
 * @param to - Its narrowing
 */
async function narrow(part: Bind, to: Where): Promise<void> {
    await act(async () => { part.write({ ...part.read(), where: to, preset: none }); });
    await settle();
}

/**
 * The racks as Search Records seeks them through e3.
 *
 * @param part - Their part of the slice
 * @param pick - Their hidden pick
 * @param read - A row as the builder reads it; by default, its key's text
 * @returns The source
 */
function sought(part: Bind, pick: SourceHidden, read: RecordSought<string>["read"] = ({ id }) => some(some(id))): RecordSought<string> {
    return { part, keys: STRING_KEYS, pick, read };
}

/** The rows a list says something hides. */
const hiddenRows = (listed: readonly Found<string>[]) => listed.flatMap(({ item, hidden }) => (hidden === undefined ? [] : [item]));
/** Whether e3 has said which choices hide a row of a source. */
const said = (pick: SourceHidden, id: string) => hiddenOf([{ pick, id }])?.[0]?.answer !== undefined;

/** The app's formatters, and a builder's words for a row the rail hides, in English. */
const format = formatters("en-US");
const WORDS: HiddenWords = { hiddenByFilters: () => "hidden by the filters", hiddenBy: ({ filters, also }) => hiddenByText(filters, also) };

describe("a source sought through e3", () => {
    test("its matches are placed in its record and listed in place, and each row its narrowing hides is said so: e3 is asked which choices hide it, and its line names them as the rail words them", async () => {
        const part = await racks();
        await narrow(part, HARBOUR);
        const { result } = renderHook(() => useSourceHidden("Spec", part));
        await waitFor(() => expect(result.current.ready).toBe(true));
        const runs = await searchRuns([sought(part, result.current)], { prefix: "A0" }, atString);
        expect(runs.map(({ start, count }) => [start, count])).toEqual([[0n, 7]]);
        // A query that finds no row places no block.
        expect(await searchRuns([sought(part, result.current)], { prefix: "B" }, atString)).toEqual([]);
        const listed = await listFound(runs, 0, 7);
        expect(listed.map(({ at, item }) => [at, item])).toEqual([[0, "A01"], [1, "A02"], [2, "A03"], [3, "A04"], [4, "A05"], [5, "A06"], [6, "A07"]]);
        // Harbour Labs' racks the narrowing holds, and it hides every other. What a line says before e3 has said which
        // choices hide a row is the hidden pick's (`hidden-pick.dom.test.tsx`).
        expect(hiddenRows(listed)).toEqual(["A03", "A04", "A05", "A06", "A07"]);
        await settle();
        await waitFor(() => expect(said(result.current, "A03")).toBe(true));
        const again = await listFound(runs, 2, 1, { sources: [sought(part, result.current)] });
        expect(hiddenLine(again[0]!.hidden!, format, WORDS)).toBe("hidden by Owner: Harbour Labs — picking it clears that filter");
    });

    test("a list reads each source as the builder names it now — a narrowing that moved since the find is the one asked — and a row the builder lists nothing of keeps its place", async () => {
        const part = await racks();
        await narrow(part, HARBOUR);
        const { result } = renderHook(() => useSourceHidden("Spec", part));
        await waitFor(() => expect(result.current.ready).toBe(true));
        const runs = await searchRuns([sought(part, result.current)], { prefix: "A0" }, atString);
        await narrow(part, NORTHWIND);
        await waitFor(() => expect(whereEqual(result.current.where!, NORTHWIND)).toBe(true));
        // Northwind Media's racks the narrowing holds now, and it hides every other.
        expect(hiddenRows(await listFound(runs, 0, 7, { sources: [sought(part, result.current)] }))).toEqual(["A01", "A02", "A05", "A06", "A07"]);
        // A row the builder lists nothing of: the rows after it keep their places.
        const gap = await listFound(runs, 0, 7, { sources: [sought(part, result.current, ({ id }) => some(stringEqual(id, "A04") ? none : some(id)))] });
        expect(gap.map(({ at, item }) => [at, item])).toEqual([[0, "A01"], [1, "A02"], [2, "A03"], [4, "A05"], [5, "A06"], [6, "A07"]]);
    });

    test("the box asks its query again as the record moves to another revision — never as the narrowing moves, which lists its lines again", async () => {
        const part = await racks();
        const { result } = renderHook(() => {
            const pick = useSourceHidden("Spec", part);
            const sources = useMemo(() => [sought(part, pick)], [pick]);
            return { pick, box: useSearchRecords<string>({ name: "Spec", resetKey: "spec", sources, line: ({ item }) => ({ label: item, text: item }), onPick: () => {} }) };
        });
        await waitFor(() => expect(result.current.pick.ready).toBe(true));
        const box = (): KeySearchSource => result.current.box!;
        expect(await box().find({ prefix: "A0" })).toEqual({ found: true, row: 0, count: 7 });
        const requery = box().requery!;
        const relist = box().relist!;
        await narrow(part, HARBOUR);
        await waitFor(() => expect(box().relist).toBeGreaterThan(relist));
        expect(box().requery).toBe(requery);
        // Another session takes A07 off the floor.
        const floor = await h.read(ex.schematicRacks);
        await h.patch(ex.schematicRacks, new SortedMap([...floor].filter(([key]) => !stringEqual(key, "A07")), compareString));
        await waitFor(() => expect(box().requery).toBeGreaterThan(requery));
        expect(await box().find({ prefix: "A0" }, true)).toEqual({ found: true, row: 0, count: 6 });
    });

    test("a pick's place is known with nothing read where its source hides no row — one with no hidden pick, as the builder names it now — never where its narrowing may hide the row, nor for a row held whole, nor one the find did not find", async () => {
        const part = await racks();
        const { result } = renderHook(() => useSourceHidden("Spec", part));
        await waitFor(() => expect(result.current.ready).toBe(true));
        const plain: RecordSought<string> = { part, keys: STRING_KEYS, read: ({ id }) => some(some(id)) };
        const runs = await searchRuns([plain], { prefix: "A0" }, atString);
        expect([pickPlace(runs, 0), pickPlace(runs, 6)]).toEqual([0n, 6n]);
        expect(pickPlace(runs, 7)).toBeUndefined();
        // Named now with a hidden pick — its rows narrowed since the find: the narrowing may hide the row, so it is read.
        expect(pickPlace(runs, 2, [sought(part, result.current)])).toBeUndefined();
        const narrowed = await searchRuns([sought(part, result.current)], { prefix: "A0" }, atString);
        expect(pickPlace(narrowed, 2)).toBeUndefined();
        // …and named now with none, its place again.
        expect(pickPlace(narrowed, 2, [plain])).toBe(2n);
        // Rows held whole have no place.
        const whole = await searchRuns([held(() => some(items("rack", ["A01", "A02"])))], { prefix: "A" }, atString);
        expect(whole.map(({ count }) => count)).toEqual([2]);
        expect(pickPlace(whole, 0)).toBeUndefined();
    });

    test("a pick of a match with no hidden pick goes to a builder that takes places by its place at once, and its row is never read; with a hidden pick its row is read, and what hides it handed over", async () => {
        const part = await racks();
        const hidden = renderHook(() => useSourceHidden("Spec", part));
        await waitFor(() => expect(hidden.result.current.ready).toBe(true));
        const places: bigint[] = [];
        const picks: Found<string>[] = [];
        const { result, rerender } = renderHook(({ pick }: { pick: SourceHidden | undefined }) => {
            const sources = useMemo((): RecordSought<string>[] => [{ part, keys: STRING_KEYS, pick, read: ({ id }) => some(some(id)) }], [pick]);
            return useSearchRecords<string>({
                name: "Spec", resetKey: "spec", sources, line: ({ item }) => ({ label: item, text: item }),
                onPick: (found) => { picks.push(found); }, onPickPlace: (place) => { places.push(place); },
            });
        }, { initialProps: { pick: undefined as SourceHidden | undefined } });
        const box = (): KeySearchSource => result.current!;
        expect(await box().find({ prefix: "A0" })).toEqual({ found: true, row: 0, count: 7 });
        const before = h.requests(undefined, RACKS).length;
        act(() => { box().jump(2, "pick"); });
        expect(places).toEqual([2n]);
        await settle();
        expect(h.requests(undefined, RACKS).slice(before)).toEqual([]);
        expect(picks).toEqual([]);
        // Harbour Labs' racks alone: the narrowing hides A03, so a pick of it reads its row and says so.
        await narrow(part, HARBOUR);
        await waitFor(() => expect(whereEqual(hidden.result.current.where!, HARBOUR)).toBe(true));
        rerender({ pick: hidden.result.current });
        act(() => { box().jump(2, "pick"); });
        await waitFor(() => expect(picks.map(({ at, item, hidden: by }) => [at, item, by !== undefined])).toEqual([[2, "A03", true]]));
        expect(places).toEqual([2n]);
    });
});

/**
 * A page for some presses: its runs and its crew, each scoped to them, and its run templates, which every press offers,
 * unscoped. The runs are P-1's r1, r2, r3, r6 and r7, and P-2's r4, r5 and r8; the crew P-1's c1 and c2, and P-2's c3 and
 * c4.
 */
const pressPage = East.function([ArrayType(StringType)], undefined, ($, presses) => {
    const runs = $.let(Data.bindPaged(scoped.pressRuns, { indexes: ["press_runs_by_press"] }));
    const crew = $.let(Data.bindPaged(scoped.pressCrew, { indexes: ["press_crew_by_press"] }));
    const templates = $.let(Data.bindPaged(scoped.pressRunTemplates, { indexes: ["press_run_templates_by_group"] }));
    return {
        runs: bindRecord("search-records.runs", runs, { scope: { press: presses } }),
        crew: bindRecord("search-records.crew", crew, { scope: { press: presses } }),
        templates: bindRecord("search-records.templates", templates, {}),
    };
});

/** A page's sources of the rail. */
interface PressPage {
    readonly runs: Bind;
    readonly crew: Bind;
    readonly templates: Bind;
}

/**
 * The pages for presses, bound over the test's workspace as a mounted page binds them, one page's parameter changing.
 *
 * @returns A page's sources, by its presses
 */
async function pressPages(): Promise<(presses: readonly string[]) => PressPage> {
    await h.install({ fn: pressPage });
    const page = East.compile(pressPage, getRegisteredPlatformImplementations()) as unknown as (presses: string[]) => PressPage;
    return (presses) => page([...presses]);
}

/** The runs, as the request log names them. */
const RUNS = datasetPathToString(scoped.pressRuns.path);

describe("on a page whose sources hold a scope (#1621)", () => {
    /** The runs as Search Records seeks them through e3: each listed as its key, or as `read` reads it. */
    const runsOf = (part: Bind, read: RecordSought<string>["read"] = ({ id }) => some(some(id))): RecordSought<string> => ({ part, keys: STRING_KEYS, read });
    /** What a query finds: each block, where it starts among the page's rows and how many it holds, and every run they hold, by their places. */
    async function found(part: Bind, query: DatasetKeyQuery) {
        const runs = await searchRuns([runsOf(part)], query, atString);
        const listed = await listFound(runs, 0, runs.reduce((sum, run) => sum + run.count, 0));
        return { blocks: runs.map(({ start, count }) => [start, count]), keys: listed.map(({ item }) => item) };
    }
    /** Every read of the runs after the first `from`: a search, a page, or a read of runs, rows or the record whole. */
    const runReads = (from: number) => h.requests(undefined, RUNS).slice(from).filter((request) => ["find", "page", "runs", "rows", "read"].includes(request.kind));

    test("a key's start finds the press's runs alone, in their keys' order, through the index on exactly the press — each search bounding the press and the key together, and the runs never read whole", async () => {
        const { runs } = (await pressPages())(["P-1"]);
        const before = h.requests(undefined, RUNS).length;
        expect(await found(runs, { prefix: "r" })).toEqual({ blocks: [[0n, 5]], keys: ["r1", "r2", "r3", "r6", "r7"] });
        const reads = runReads(before);
        expect([...new Set(reads.flatMap((request) => { const index = request.query.get("index"); return index === null ? [] : [index]; }))]).toEqual(["press_runs_by_press"]);
        const ranges = reads.flatMap((request) => request.searches.flatMap((search) => ("from" in search ? [search.from] : [])));
        expect(ranges.length).toBeGreaterThan(0);
        expect(ranges.every((from) => from[0] !== undefined && stringEqual(from[0], printString("P-1")))).toBe(true);
        expect(reads.filter((request) => request.kind === "read")).toEqual([]);
    });

    test("a key finds its run among the press's, at its place there, and another press's run is no match", async () => {
        const { runs } = (await pressPages())(["P-1"]);
        expect(await found(runs, { key: printString("r6") })).toEqual({ blocks: [[3n, 1]], keys: ["r6"] });
        expect(await found(runs, { key: printString("r4") })).toEqual({ blocks: [], keys: [] });
        expect(await found(runs, { prefix: "x" })).toEqual({ blocks: [], keys: [] });
    });

    test("on a page of two presses, a block of matches each, in the order the index files the presses — however the scope lists them — and a list across the blocks reads each from where it starts, a run the builder lists nothing of leaving its place", async () => {
        const { runs } = (await pressPages())(["P-2", "P-1"]);
        expect(await found(runs, { prefix: "r" })).toEqual({ blocks: [[0n, 5], [5n, 3]], keys: ["r1", "r2", "r3", "r6", "r7", "r4", "r5", "r8"] });
        expect(await found(runs, { prefix: "r5" })).toEqual({ blocks: [[6n, 1]], keys: ["r5"] });
        const blocks = await searchRuns([runsOf(runs)], { prefix: "r" }, atString);
        const placed = (listed: readonly Found<string>[]) => listed.map(({ at, item }) => [at, item]);
        expect(placed(await listFound(blocks, 3, 4))).toEqual([[3, "r6"], [4, "r7"], [5, "r4"], [6, "r5"]]);
        const gap = await listFound(blocks, 3, 4, { sources: [runsOf(runs, ({ id }) => some(stringEqual(id, "r7") ? none : some(id)))] });
        expect(placed(gap)).toEqual([[3, "r6"], [5, "r4"], [6, "r5"]]);
    });

    test("each row a list reads carries its place among the page's rows — what a builder whose rows are those rows goes to it by, the Sheet's — however far apart the blocks it reads them from", async () => {
        const { runs } = (await pressPages())(["P-2", "P-1"]);
        const atPlace = runsOf(runs, ({ id, place }) => some(some(`${id}@${printInteger(place)}`)));
        // `"r3".."r6"`: P-1's r3, then P-2's r4 and r5 — a block of each press's, with P-1's r6 and r7 between them.
        const blocks = await searchRuns([atPlace], { from: [printString("r3")], to: [printString("r6")] }, atString);
        expect(blocks.map(({ start, count }) => [start, count])).toEqual([[2n, 1], [5n, 2]]);
        const placed = (listed: readonly Found<string>[]) => listed.map(({ at, item }) => [at, item]);
        expect(placed(await listFound(blocks, 0, 3))).toEqual([[0, "r3@2"], [1, "r4@5"], [2, "r5@6"]]);
        // A list from inside a block: the row at its own place still.
        expect(placed(await listFound(blocks, 2, 1))).toEqual([[2, "r5@6"]]);
        // A pick that reads nothing goes to the place a list reads the row at.
        expect([0, 1, 2].map((row) => pickPlace(blocks, row))).toEqual([2n, 5n, 6n]);
    });

    test("rows a builder holds whole — the Roster's people — are sought among those the scope holds, asked of e3: a key of no row is held by none, and a source with no scope holds every row", async () => {
        const { crew, templates } = (await pressPages())(["P-1"]);
        const kept = await scopeHeld(crew, ["c1", "c2", "c3", "c4", "c9"]);
        expect([...kept!].sort(compareString)).toEqual(["c1", "c2"]);
        const people: WholeSought<Item> = { ...held(() => some(items("crew", ["c3", "c1", "c4", "c2"]))), scope: crew };
        const runs = await searchRuns([people], { prefix: "c" }, atString);
        expect(runs.map(({ start, count, rows }) => [start, count, rows?.map((person) => person.id)])).toEqual([[0n, 2, ["c1", "c2"]]]);
        expect(await scopeHeld(templates, ["flyers"])).toBeUndefined();
        expect(await scopeHeld(undefined, ["c1"])).toBeUndefined();
    });

    test("the box asks its query again as the page's scope moves — another press's page over the same record", async () => {
        const page = await pressPages();
        const { result, rerender } = renderHook(({ part }: { part: Bind }) => {
            const sources = useMemo(() => [runsOf(part)], [part]);
            return useSearchRecords<string>({ name: "Spec", resetKey: "spec", sources, line: ({ item }) => ({ label: item, text: item }), onPick: () => {} });
        }, { initialProps: { part: page(["P-1"]).runs } });
        const box = (): KeySearchSource => result.current!;
        expect(await box().find({ prefix: "r" })).toEqual({ found: true, row: 0, count: 5 });
        // The record's revision known, so only the scope moves what tells the box to ask again.
        await settle();
        const requery = box().requery!;
        rerender({ part: page(["P-2"]).runs });
        await waitFor(() => expect(box().requery).toBeGreaterThan(requery));
        expect(await box().find({ prefix: "r" }, true)).toEqual({ found: true, row: 0, count: 3 });
    });
});

describe("useSeekPlace", () => {
    test("where a key is among a builder's rows, as the box seeks it: its first match's place — on a scoped page among the scope's rows, of a paged source among its own — none for a key no row holds, and no seek with no source", async () => {
        const { runs } = (await pressPages())(["P-2", "P-1"]);
        const scopedSeek = renderHook(() => useSeekPlace([{ part: runs, keys: STRING_KEYS, read: () => some(none) }])).result.current!;
        // Asked as the page mounts, before the record has said its revision: what it then says is no move of its rows.
        expect(await scopedSeek({ key: printString("r5") })).toBe(6n);
        expect(await scopedSeek({ prefix: "r" })).toBe(0n);
        expect(await scopedSeek({ key: printString("r9") })).toBeUndefined();
        const orders = pagedOrders(["A01", "A02", "B01"], () => some({ found: true, row: 2n, count: 1n }));
        const pagedSeek = renderHook(() => useSeekPlace([orders.source])).result.current!;
        expect(await pagedSeek({ key: printString("B01") })).toBe(2n);
        expect(askedAs(orders.asked, { key: printString("B01") })).toBe(true);
        expect(renderHook(() => useSeekPlace<Item>([])).result.current).toBeUndefined();
    });

    test("the latest ask alone answers: an older one, one whose source moved between the ask and the answer, and one the builder let go of as it unmounted answer none", async () => {
        const revision = trackedCell<option<string>>(some("rev-1"));
        const answer = trackedCell<option<SeekRange>>(none);
        const orders = pagedOrders(["A01", "A02", "A03"], () => answer.get(), { revision: () => revision.get() });
        const { result, unmount } = renderHook(() => {
            const sources = [orders.source];
            // The box beside it, whose `requery` says the source moved.
            const box = useSearchRecords<Item>({ name: "Spec", resetKey: "spec", sources, line: ({ item }) => ({ label: item.id, text: item.id }), onPick: () => {} });
            return { seek: useSeekPlace(sources)!, box: box! };
        });
        // Two asks before the source answers: the later alone is answered.
        const older = result.current.seek({ key: printString("A01") });
        const newer = result.current.seek({ key: printString("A02") });
        await act(async () => { answer.set(some({ found: true, row: 1n, count: 1n })); });
        expect(await older).toBeUndefined();
        expect(await newer).toBe(1n);
        // Asked, and the source moves to another revision before it answers: the place is its old rows', and it answers none.
        await act(async () => { answer.set(none); });
        const before = result.current.seek({ key: printString("A03") });
        const requery = result.current.box.requery!;
        await act(async () => { revision.set(some("rev-2")); });
        await waitFor(() => expect(result.current.box.requery).toBe(requery + 1));
        await settle();
        await act(async () => { answer.set(some({ found: true, row: 2n, count: 1n })); });
        expect(await before).toBeUndefined();
        expect(await result.current.seek({ key: printString("A03") })).toBe(2n);
        // Asked, and let go of as the builder unmounts: none.
        await act(async () => { answer.set(none); });
        const dropped = result.current.seek({ key: printString("A03") });
        unmount();
        await act(async () => { answer.set(some({ found: true, row: 2n, count: 1n })); });
        expect(await dropped).toBeUndefined();
    });
});
