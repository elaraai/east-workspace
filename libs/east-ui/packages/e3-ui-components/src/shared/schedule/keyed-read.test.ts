/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The shared keyed read (#1323): an entry in flight is told from one the
 * record is confirmed not to hold — the Roster's week and the Allocation's day;
 * and a span of entries read as one page — the Allocation picker's month.
 */

import { describe, test, expect } from "vitest";
import { DateTimeType, SortedMap, compareFor, none, parseFor, printFor, some, type option } from "@elaraai/east";
import { readKeyedEntry, readKeyedRange, type KeyedWindow } from "./keyed-read.js";

const TUE = new Date("2027-05-11T00:00:00.000Z");
const WED = new Date("2027-05-12T00:00:00.000Z");
const THU = new Date("2027-05-13T00:00:00.000Z");
const FRI = new Date("2027-05-14T00:00:00.000Z");
const SAT = new Date("2027-05-15T00:00:00.000Z");
const keyOf = printFor(DateTimeType);
type Page = SortedMap<Date, string>;
/** A window over two plan days, whose search and pages land as the test says. */
function windowOf(state: { searched: boolean; paged: boolean }, seen: string[] = []): KeyedWindow<Page> {
    const days = new SortedMap<Date, string>([[TUE, "Tue's plan"]], compareFor(DateTimeType));
    return {
        seek: some((query) => {
            seen.push(query.type === "key" ? query.value : query.type);
            return state.searched ? some({ found: query.type === "key" && query.value === keyOf(TUE), row: 0n, count: 1n }) : none;
        }),
        page: (offset, limit): option<Page> => (state.paged && offset === 0n && limit === 1n ? some(days) : none),
    };
}
const read = (w: KeyedWindow<Page>, day: Date) => readKeyedEntry(w, keyOf(day), (page) => page.get(day), "Plans");

describe("the shared keyed read", () => {
    test("A2 — a search or a page in flight reads as `none`, never an empty day", () => {
        expect(read(windowOf({ searched: false, paged: true }), TUE)).toEqual(none);
        expect(read(windowOf({ searched: true, paged: false }), TUE)).toEqual(none);
    });
    test("A2 — a day the record holds reads as `some(some(day))`; one it does not, `some(none)` — Not started", () => {
        const seen: string[] = [];
        const w = windowOf({ searched: true, paged: true }, seen);
        expect(read(w, TUE)).toEqual(some(some("Tue's plan")));
        expect(read(w, WED)).toEqual(some(none));
        expect(seen).toEqual([keyOf(TUE), keyOf(WED)]);
    });
    test("a source with no key search is refused, naming it", () => {
        expect(() => readKeyedEntry({ seek: none, page: () => none }, keyOf(TUE), () => undefined, "Plans")).toThrow("Plans requires keyed seek support.");
        expect(() => readKeyedRange({ seek: none, page: () => none }, keyOf(TUE), keyOf(WED), () => undefined, "Plans")).toThrow("Plans requires keyed seek support.");
    });
});

/** A window over Tue, Wed and Fri's plans, its range search answered as a server does: the span's first row and how many it holds. */
function spanWindow(state: { searched: boolean; paged: boolean }, asked: string[] = [], pages: [bigint, bigint][] = []): KeyedWindow<Page> {
    const compare = compareFor(DateTimeType), parse = parseFor(DateTimeType);
    const days = new SortedMap<Date, string>([[TUE, "Tue's plan"], [WED, "Wed's plan"], [FRI, "Fri's plan"]], compare);
    const keys = [...days.keys()];
    const at = (text: string) => { const parsed = parse(text); if (!parsed.success) throw new Error(`not a day: ${text}`); return parsed.value; };
    return {
        seek: some((query) => {
            if (query.type !== "range") throw new Error(`a span is searched as a range, not ${query.type}`);
            asked.push(`${query.value.from.join(",")}..${query.value.to.join(",")}`);
            const from = at(query.value.from[0]!), to = at(query.value.to[0]!);
            const inside = (key: Date) => compare(key, from) >= 0 && compare(key, to) < 0;
            let row = 0n, count = 0n;
            for (const key of keys) { if (compare(key, from) < 0) row += 1n; else if (inside(key)) count += 1n; }
            return state.searched ? some({ found: keys.some(inside), row, count }) : none;
        }),
        page: (offset, limit): option<Page> => {
            pages.push([offset, limit]);
            return state.paged ? some(new SortedMap([...days].slice(Number(offset), Number(offset + limit)), compare)) : none;
        },
    };
}
const span = (w: KeyedWindow<Page>, from: Date, to: Date) => readKeyedRange(w, keyOf(from), keyOf(to), (page) => [...page.values()], "Plans");

describe("the shared keyed read of a span", () => {
    test("A2 — a span's search or its page in flight reads as `none`, never an empty span", () => {
        expect(span(spanWindow({ searched: false, paged: true }), TUE, SAT)).toEqual(none);
        expect(span(spanWindow({ searched: true, paged: false }), TUE, SAT)).toEqual(none);
    });
    test("A2 — the entries of `[from, to)`, as one search for the span and one page of its rows", () => {
        const asked: string[] = [], pages: [bigint, bigint][] = [];
        expect(span(spanWindow({ searched: true, paged: true }, asked, pages), WED, SAT)).toEqual(some(some(["Wed's plan", "Fri's plan"])));
        expect(asked).toEqual([`${keyOf(WED)}..${keyOf(SAT)}`]);
        expect(pages).toEqual([[1n, 2n]]);
        // The span ends before its `to`: Fri is not in Tue to Fri.
        expect(span(spanWindow({ searched: true, paged: true }), TUE, FRI)).toEqual(some(some(["Tue's plan", "Wed's plan"])));
    });
    test("A2 — a span the record holds nothing in reads `some(none)` — Not started — and reads no page", () => {
        const pages: [bigint, bigint][] = [];
        expect(span(spanWindow({ searched: true, paged: true }, [], pages), THU, FRI)).toEqual(some(none));
        expect(pages).toEqual([]);
    });
});
