/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the module loads east-ui's entry, which needs one as
 * it loads.
 *
 * The groups of keys a schedule's reader reads a series index's cells for
 * (#1710), worked out with no read: a group's keys as a series index in time
 * order holds them — its first and last by the type of the field the index
 * files by, never by their text, and which keys are its own — the rows it
 * stands under as each leading field holds them, and its searches through an
 * index of either order. The reader's reads are carried through e3 by
 * `test/record-series.spec.ts`.
 */
import { describe, test, expect } from "vitest";
import {
    ArrayType, DateTimeType, IntegerType, OptionType, StringType, StructType, VariantType, NullType, decodeBeast2For, encodeBeast2For, none, some,
    toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceIndexType, levelRuns } from "@elaraai/east-ui/internal";
import { NO_UNDER, groupQueries, keyOrderOf, keyRunOf, sameUnder, underOf, type SeriesGroup } from "./series-groups.js";

/** A job: the press it is on, by its number or not at all, the hall and the line it stands in, and when it runs. */
const Job = StructType({
    press: IntegerType, lane: OptionType(StringType), hall: StringType, line: IntegerType, shift: OptionType(IntegerType),
    kind: VariantType({ run: NullType, wash: NullType }), start: DateTimeType, end: DateTimeType,
});
const cellsType = toEastTypeValue(ArrayType(StructType({ key: StringType, row: Job })));

describe("a group's keys as a series index in time order holds them (#1710)", () => {
    test("its first and last by the field's own order, never by their text, and the keys that are its own", () => {
        const order = keyOrderOf(cellsType, "press");
        // By their text "10" sorts before "9": by the Integer they are, 9 is first.
        const run = keyRunOf(order, ["10", "9", "100", "12"])!;
        expect([run.first, run.last]).toEqual(["9", "100"]);
        expect([9n, 10n, 12n, 100n].map((key) => run.holds(key))).toEqual([true, true, true, true]);
        // A key between the first and the last that is none of the group's: a range holds its entries, and the reader drops them.
        expect([11n, 50n, 8n, 101n].map((key) => run.holds(key))).toEqual([false, false, false, false]);
        expect(keyRunOf(order, [])).toBeUndefined();
        const one = keyRunOf(order, ["7"])!;
        expect([one.first, one.last, one.holds(7n)]).toEqual(["7", "7", true]);
    });

    test("an Option field's keys in its own order, none first", () => {
        const run = keyRunOf(keyOrderOf(cellsType, "lane"), ['.some "b"', ".none", '.some "a"'])!;
        expect([run.first, run.last]).toEqual([".none", '.some "b"']);
        expect([run.holds(none), run.holds(some("a")), run.holds(some("c"))]).toEqual([true, true, false]);
    });

    test("a field the rows do not hold, and a literal that is no value of the field, are refused", () => {
        expect(() => keyOrderOf(cellsType, "bay")).toThrow(/files its events by 'bay', and the kind's rows hold no such field/);
        expect(() => keyRunOf(keyOrderOf(cellsType, "press"), ["9", '"P-9"'])).toThrow(/"P-9" is no value of the field a series index files its events by/);
    });
});

describe("the rows a group stands under, as a leading field holds them (#1710)", () => {
    test("a String field holds the key's text; any other the key it reads back as; an Option either as its value", () => {
        expect(underOf(cellsType, "H-01")("hall")).toBe('"H-01"');
        // A text that would read as a number is still the text a String field holds.
        expect(underOf(cellsType, "12")("hall")).toBe('"12"');
        expect(underOf(cellsType, "12")("line")).toBe("12");
        expect(underOf(cellsType, ".wash")("kind")).toBe(".wash");
        expect(underOf(cellsType, "A")("lane")).toBe('.some "A"');
        expect(underOf(cellsType, "3")("shift")).toBe(".some 3");
        // An Option's own literal stands as it is.
        expect(underOf(cellsType, ".none")("shift")).toBe(".none");
    });

    test("a field that can hold no such key, and one the rows do not hold, give none", () => {
        expect(underOf(cellsType, "H-01")("line")).toBeUndefined();
        expect(underOf(cellsType, "H-01")("shift")).toBeUndefined();
        expect(underOf(cellsType, "H-01")("kind")).toBeUndefined();
        expect(underOf(cellsType, "H-01")("bay")).toBeUndefined();
    });

    test("two groups stand under the same rows when each step is the same key's", () => {
        expect(sameUnder(NO_UNDER, [])).toBe(true);
        expect(sameUnder(["H-01"], ["H-01"])).toBe(true);
        expect(sameUnder(["H-01"], ["H-02"])).toBe(false);
        expect(sameUnder(["S-1", "H-01"], ["H-01"])).toBe(false);
    });
});

describe("a group's searches through the series index that serves it (#1710)", () => {
    const indexType = ArrayType(RecordSliceIndexType);
    const plain = { interval: none, area: none, series: none, summary: none, entries: false };
    const week = { key: "press", from: "start", to: "end", tile: variant("week", null), order: variant("key", null) };
    const [byPress, byHall] = decodeBeast2For(indexType)(encodeBeast2For(indexType)([
        { name: "jobs_by_press_week", fields: [], sets: new Set(), structured: true, ...plain, series: some(week) },
        { name: "jobs_by_hall_week", fields: ["hall"], sets: new Set(), structured: true, ...plain, series: some({ ...week, order: variant("time", null) }) },
    ])) as [ValueTypeOf<typeof RecordSliceIndexType>, ValueTypeOf<typeof RecordSliceIndexType>];
    const literals = ["10", "9", "12"];
    // The week of Monday 5 October 2026: the weeks' run is two before it to one after, Mondays 21 September to 12 October.
    const run = levelRuns("week", new Date("2026-10-05T00:00:00Z"), new Date("2026-10-12T00:00:00Z"))[0]!;

    test("a range a key through an index in key order; a range a tile, from its first key through its last, through one in time order", () => {
        const group = { id: "presses:0.0", literals, under: NO_UNDER };
        const byKey: SeriesGroup = { ...group, where: new Map(), run: undefined };
        expect(groupQueries(byPress, byKey, run)).toEqual(literals.map((press) =>
            variant("range", { from: [press, ".week", "2026-09-21T00:00:00.000"], to: [press, ".week", "2026-10-19T00:00:00.000"] })));
        const inTime: SeriesGroup = {
            ...group, under: ["H-01"], where: new Map([["hall", variant("values", ['"H-01"'])]]),
            run: keyRunOf(keyOrderOf(cellsType, "press"), literals),
        };
        const mondays = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].map((monday) => `${monday}T00:00:00.000`);
        expect(groupQueries(byHall, inTime, run)).toEqual(mondays.map((tile) =>
            variant("range", { from: ['"H-01"', ".week", tile, "9"], to: ['"H-01"', ".week", tile, "12", "true"] })));
    });
});
