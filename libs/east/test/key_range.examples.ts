/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    DateTimeType, DictType, East, IntegerType, NullType, SetType, SortedMap, SortedSet, StringType, StructType, VariantType, compareFor, example, variant,
} from "@elaraai/east";

// ---------------------------------------------------------------------------
// A key range of a Dict or a Set: the entries between two bounds (`range`), or
// the ones whose key begins with given fields (`prefix`). A bound is a leading
// part of the key: the whole key or, for a struct key, its first fields. The
// entries are found by a search, never by a walk, so a range costs what it
// holds — the read an index is made for.
// ---------------------------------------------------------------------------

/** Sheets printed, by press, day and job. */
const Sheets = DictType(StructType({ press: StringType, day: DateTimeType, job: StringType }), IntegerType);

const MAY_31 = new Date("2026-05-31T00:00:00Z");
const JUNE_1 = new Date("2026-06-01T00:00:00Z");
const JUNE_2 = new Date("2026-06-02T00:00:00Z");
const JUNE_10 = new Date("2026-06-10T00:00:00Z");
const JUNE_30 = new Date("2026-06-30T00:00:00Z");
const JULY_1 = new Date("2026-07-01T00:00:00Z");

/** Five entries: four of press P1 from the end of May to the start of July, one of press P2. A
 *  struct-keyed Dict is held in East's order of its key. */
const SHEETS = new SortedMap([
    [{ press: "P1", day: MAY_31, job: "J1" }, 400n],
    [{ press: "P1", day: JUNE_1, job: "J2" }, 250n],
    [{ press: "P1", day: JUNE_30, job: "J3" }, 100n],
    [{ press: "P1", day: JULY_1, job: "J4" }, 900n],
    [{ press: "P2", day: JUNE_10, job: "J5" }, 700n],
], compareFor(Sheets.key));

export const dictRange = example({
    keywords: ["dict", "DictType", "range", "from", "to", "between", "key range", "bounds", "struct key", "index", "slice"],
    description: "Read the entries of a Dict between two bounds: a press's sheets from 1 June up to, and not including, 1 July",
    fn: East.function([], IntegerType, ($) => {
        const sheets = $.const(SHEETS, Sheets);
        // A bound gives the key's first fields: here the press and the day, with the job left out.
        const june = $.let(sheets.range({
            from: { press: "P1", day: JUNE_1 },
            to: { press: "P1", day: JULY_1 },
        }));
        return june.sum();
    }),
    inputs: [],
    returns: 350n,
});

export const dictRangeOpenEnd = example({
    keywords: ["dict", "DictType", "range", "from", "open end", "to the end", "key range", "bounds"],
    description: "Leave a bound out of a Dict's range for that end of the Dict: every entry from press P2 on",
    fn: East.function([], IntegerType, ($) => {
        const sheets = $.const(SHEETS, Sheets);
        return sheets.range({ from: { press: "P2" } }).size();
    }),
    inputs: [],
    returns: 1n,
});

export const dictPrefix = example({
    keywords: ["dict", "DictType", "prefix", "begins with", "leading fields", "struct key", "key range", "index"],
    description: "Read the entries of a Dict whose key begins with given fields: every sheet of press P1",
    fn: East.function([], IntegerType, ($) => {
        const sheets = $.const(SHEETS, Sheets);
        return sheets.prefix({ press: "P1" }).sum();
    }),
    inputs: [],
    returns: 1650n,
});

export const dictRangeOfRange = example({
    keywords: ["dict", "DictType", "range", "prefix", "narrow", "range of a range", "key range"],
    description: "Narrow a range again: of press P1's sheets, the ones from 1 June on",
    fn: East.function([], IntegerType, ($) => {
        const sheets = $.const(SHEETS, Sheets);
        const ofPress = $.let(sheets.prefix({ press: "P1" }));
        return ofPress.range({ from: { press: "P1", day: JUNE_1 } }).size();
    }),
    inputs: [],
    returns: 3n,
});

export const dictRangeStartsWith = example({
    keywords: ["dict", "DictType", "range", "String key", "starts with", "startsWith", "prefix", "key range"],
    description: "Read the entries of a Dict whose String key starts with given letters, as a range from them up to the next",
    fn: East.function([], IntegerType, ($) => {
        const stock = $.const(new Map([["aa", 1n], ["ab", 2n], ["abc", 4n], ["ac", 8n], ["b", 16n]]), DictType(StringType, IntegerType));
        // Every key that starts with "ab" is at or past "ab" and before "ac".
        return stock.range({ from: "ab", to: "ac" }).sum();
    }),
    inputs: [],
    returns: 6n,
});

/** An index's key: what the rows are grouped by, then the row's own key. */
const Level = VariantType({ day: NullType, week: NullType });
const Indexed = DictType(
    StructType({ ik: StructType({ on: StructType({ hall: StringType, press: StringType }), level: Level, tile: IntegerType }), k: StringType }),
    IntegerType,
);

export const dictPrefixNested = example({
    keywords: ["dict", "DictType", "prefix", "nested struct", "index", "leading fields", "key range", "tile"],
    description: "Give a prefix through nested structs, as an index's key is read: every entry of one hall",
    fn: East.function([], IntegerType, ($) => {
        const index = $.const(new SortedMap([
            [{ ik: { on: { hall: "H1", press: "P1" }, level: variant("day", null), tile: 4n }, k: "j1" }, 1n],
            [{ ik: { on: { hall: "H1", press: "P2" }, level: variant("week", null), tile: 0n }, k: "j2" }, 2n],
            [{ ik: { on: { hall: "H2", press: "P3" }, level: variant("day", null), tile: 4n }, k: "j3" }, 4n],
        ], compareFor(Indexed.key)), Indexed);
        // The last field a prefix gives may itself be cut short: `on` gives its hall and not its press.
        return index.prefix({ ik: { on: { hall: "H1" } } }).sum();
    }),
    inputs: [],
    returns: 3n,
});

export const setRange = example({
    keywords: ["set", "SetType", "range", "from", "to", "between", "key range", "bounds"],
    description: "Read the elements of a Set between two bounds: the names from b up to, and not including, d",
    fn: East.function([], SetType(StringType), ($) => {
        const names = $.const(new Set(["ant", "bee", "bison", "cat", "dog", "eel"]), SetType(StringType));
        return names.range({ from: "b", to: "d" });
    }),
    inputs: [],
    returns: new Set(["bee", "bison", "cat"]),
});

/** A day a press ran. */
const Run = StructType({ press: StringType, day: DateTimeType });

export const setPrefix = example({
    keywords: ["set", "SetType", "prefix", "begins with", "leading fields", "struct element", "key range"],
    description: "Read the elements of a Set that begin with given fields: the days one press ran",
    fn: East.function([], IntegerType, ($) => {
        const runs = $.const(new SortedSet([
            { press: "P1", day: JUNE_1 },
            { press: "P1", day: JUNE_2 },
            { press: "P2", day: JUNE_1 },
        ], compareFor(Run)), SetType(Run));
        return runs.prefix({ press: "P1" }).size();
    }),
    inputs: [],
    returns: 2n,
});
