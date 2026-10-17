/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The shared keyed read (#1323): an entry in flight is told from one the
 * record is confirmed not to hold — the Roster's week and the Allocation's day.
 */

import { describe, test, expect } from "vitest";
import { DateTimeType, SortedMap, compareFor, none, printFor, some, type option } from "@elaraai/east";
import { readKeyedEntry, type KeyedWindow } from "./keyed-read.js";

const TUE = new Date("2027-05-11T00:00:00.000Z");
const WED = new Date("2027-05-12T00:00:00.000Z");
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
    });
});
