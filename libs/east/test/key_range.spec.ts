/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* A key range of a Dict or a Set held in memory (#1616, D1 to D3): `range`
 * and `prefix`, run as an East suite — exported for east-c and east-py like
 * any spec, so the three runtimes hold one table.
 *
 * - The oracle: for collections and bounds made from a seed, a range is what a
 *   walk of the whole collection keeps by the rule itself, written out in East
 *   — the key's leading fields, as a struct, at or past the bound by East's
 *   own order. Over a press's sheets, an index's nested key, a key of the
 *   orders that are easy to get wrong (floats with NaN, both zeros and both
 *   infinities; options; variants; booleans), and keys that are no struct.
 * - Open ends, empty and inverted ranges, an empty collection, a bound that is
 *   the whole key, a range of a range.
 * - A range is a new collection: changed, its source is as it was, and it is
 *   not its source even where it holds every entry.
 * - A bound that is no leading part of the key is refused where the function
 *   is built, in one set of words, and again where an IR made by hand is
 *   analyzed; `prefix` on a key that is no struct is refused naming `get` and
 *   `range`. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet, StringType, StructType, VariantType,
    compareFor, fromEastTypeValue, isTypeEqual, none, some, toEastTypeValue, variant, type EastType, type EastTypeValue, type IR,
} from "../src/index.js";
import { analyzeIR } from "../src/analyze.js";
import { describeEast, assertEast } from "./platforms.spec.js";
import * as ex from "./key_range.examples.js";

/** A seeded generator: the same numbers on every run, on every runtime the suite is exported to. */
function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A key type cut short to its first leaves: its type, and the cut of a key, a value or an expression alike. */
interface Cut {
    readonly type: EastType;
    /** How many leaves the cut holds. */
    readonly leaves: number;
    readonly of: (key: any) => any;
}

/**
 * A key type cut short to its first `count` leaves, written out apart from the
 * rule under test: a struct's fields in order, through nested structs, until
 * the leaves run out.
 */
function cut(type: EastType, count: number): Cut {
    if (type.type !== "Struct") return { type, leaves: 1, of: (key) => key };
    const parts: [name: string, part: Cut][] = [];
    let leaves = 0;
    for (const [name, field] of Object.entries(type.fields as Record<string, EastType>)) {
        if (leaves >= count) break;
        const part = cut(field, count - leaves);
        parts.push([name, part]);
        leaves += part.leaves;
    }
    return {
        type: StructType(Object.fromEntries(parts.map(([name, part]) => [name, part.type]))),
        leaves,
        of: (key) => Object.fromEntries(parts.map(([name, part]) => [name, part.of(key[name])])),
    };
}

/** A host value as an East expression of a type held as a value: the table's types are not known to TypeScript. */
const valueOf = (value: unknown, type: EastType): any => East.value(value as never, type as never);

/** How many leaves a key type has. */
const leafCount = (type: EastType): number => cut(type, Number.MAX_SAFE_INTEGER).leaves;

/** Keys made from a seed, in East's order, each once. */
function keysOf<K>(type: EastType, make: () => K, count: number): K[] {
    const compare = compareFor(type) as (a: K, b: K) => number;
    const sorted = Array.from({ length: count }, make).sort(compare);
    return sorted.filter((key, index) => index === 0 || compare(sorted[index - 1]!, key) !== 0);
}

// --- The key types of the table ----------------------------------------------

/** Sheets printed, keyed by press, day and job. */
const Sheet = StructType({ press: StringType, day: DateTimeType, job: StringType });

/** An index's key: what the rows are grouped by — a struct of its own — then the row's key. */
const Level = VariantType({ day: NullType, week: NullType });
const Indexed = StructType({
    ik: StructType({ on: StructType({ hall: StringType, press: StringType }), key: StringType, level: Level, tile: IntegerType }),
    k: StringType,
});

/** A key whose leaves hold the orders that are easy to get wrong. */
const Odd = StructType({
    x: FloatType,
    tag: OptionType(StringType),
    what: VariantType({ a: IntegerType, b: NullType }),
    flag: BooleanType,
    n: IntegerType,
});

const FLOATS = [NaN, -Infinity, Infinity, -0, 0, -1.5, 2.25, 1e300, -1e-300];

const JUNE_1 = new Date("2026-06-01T00:00:00Z");
const JUNE_2 = new Date("2026-06-02T00:00:00Z");
const JUNE_3 = new Date("2026-06-03T00:00:00Z");
const JUNE_4 = new Date("2026-06-04T00:00:00Z");

/** The sheets of the cases written out by hand: four of press P1 over two days, two of press P2. */
const Sheets = DictType(Sheet, IntegerType);
const SHEETS: [{ press: string; day: Date; job: string }, bigint][] = [
    [{ press: "P1", day: JUNE_1, job: "a" }, 1n],
    [{ press: "P1", day: JUNE_2, job: "a" }, 2n],
    [{ press: "P1", day: JUNE_2, job: "b" }, 3n],
    [{ press: "P1", day: JUNE_4, job: "c" }, 4n],
    [{ press: "P2", day: JUNE_1, job: "a" }, 5n],
    [{ press: "P2", day: JUNE_3, job: "c" }, 6n],
];

/** Sheets as a Dict holds them: keyed by East's order of a sheet. */
const sheetsOf = (entries: readonly [{ press: string; day: Date; job: string }, bigint][]) => new SortedMap(entries, compareFor(Sheet));

const random = seeded(1616);
const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
const day = (): Date => new Date(Date.UTC(2026, 5, 1 + Math.floor(random() * 4)));

const makeSheet = () => ({ press: pick(["P1", "P2", "P3"]), day: day(), job: pick(["a", "b", "c"]) });
const makeIndexed = () => ({
    ik: {
        on: { hall: pick(["H1", "H2"]), press: pick(["P1", "P2"]) },
        key: pick(["j", "k"]),
        level: pick([variant("day", null), variant("week", null)]),
        tile: BigInt(Math.floor(random() * 3)),
    },
    k: pick(["r1", "r2", "r3"]),
});
const makeOdd = () => ({
    x: pick(FLOATS),
    tag: pick([none, some(""), some("a"), some("b\u{1F600}")]),
    what: pick([variant("a", -1n), variant("a", 7n), variant("b", null)]),
    flag: random() < 0.5,
    n: BigInt(Math.floor(random() * 2)),
});

/** One case of the oracle: a key type, how a key of it is made, and how many keys the collection is made from. */
interface KeyKind {
    readonly name: string;
    readonly type: EastType;
    readonly make: () => unknown;
    readonly count: number;
}

const STRUCT_KINDS: readonly KeyKind[] = [
    { name: "a press's sheets", type: Sheet, make: makeSheet, count: 60 },
    { name: "an index's nested key", type: Indexed, make: makeIndexed, count: 80 },
    { name: "floats, options, variants and booleans", type: Odd, make: makeOdd, count: 120 },
];

const PLAIN_KINDS: readonly KeyKind[] = [
    { name: "a Float key", type: FloatType, make: () => pick([...FLOATS, 3, 4.5, -7]), count: 40 },
    { name: "a String key", type: StringType, make: () => pick(["", "a", "ab", "abc", "ac", "b", "b\u{1F600}", "￿"]), count: 30 },
    { name: "an Integer key", type: IntegerType, make: () => BigInt(Math.floor(random() * 40) - 20), count: 30 },
    { name: "an option key", type: OptionType(IntegerType), make: () => (random() < 0.2 ? none : some(BigInt(Math.floor(random() * 9)))), count: 20 },
    { name: "a variant key", type: VariantType({ a: IntegerType, b: NullType, c: StringType }), make: () => pick([variant("a", 0n), variant("a", 5n), variant("b", null), variant("c", ""), variant("c", "x")]), count: 20 },
    { name: "a DateTime key", type: DateTimeType, make: day, count: 10 },
];

await describeEast("Key ranges", (test) => {
    assertEast.examples(test, {
        dictRange: ex.dictRange,
        dictRangeOpenEnd: ex.dictRangeOpenEnd,
        dictPrefix: ex.dictPrefix,
        dictRangeOfRange: ex.dictRangeOfRange,
        dictRangeStartsWith: ex.dictRangeStartsWith,
        dictPrefixNested: ex.dictPrefixNested,
        setRange: ex.setRange,
        setPrefix: ex.setPrefix,
    });

    for (const kind of STRUCT_KINDS) {
        const keys = keysOf(kind.type, kind.make, kind.count);
        const leaves = leafCount(kind.type);

        test(`${kind.name}: a Dict's range is what a walk of the whole keeps, for bounds of every length`, $ => {
            const dict: any = $.let(valueOf(new SortedMap(keys.map((key, index): [unknown, bigint] => [key, BigInt(index)]), compareFor(kind.type)), DictType(kind.type, IntegerType)));
            for (let trial = 0; trial < 3 * leaves; trial++) {
                const from = cut(kind.type, 1 + (trial % leaves));
                const to = cut(kind.type, 1 + Math.floor(random() * leaves));
                // Bounds made as keys are, so they fall on, between and beyond the keys held.
                const fromBound = from.of(kind.make());
                const toBound = to.of(kind.make());
                const kept = dict.filter((_$: any, _value: any, key: any) => East.greaterEqual(valueOf(from.of(key), from.type), valueOf(fromBound, from.type))
                    .bitAnd(East.less(valueOf(to.of(key), to.type), valueOf(toBound, to.type))));
                $(assertEast.equal(dict.range({ from: fromBound, to: toBound }), kept));
            }
        });

        test(`${kind.name}: a Set's range, its open ends and its prefix are what a walk of the whole keeps`, $ => {
            const set: any = $.let(valueOf(new SortedSet(keys, compareFor(kind.type)), SetType(kind.type)));
            for (let count = 1; count <= leaves; count++) {
                const part = cut(kind.type, count);
                const bound = part.of(kind.make());
                const lead = (key: any) => valueOf(part.of(key), part.type);
                const given = valueOf(bound, part.type);
                $(assertEast.equal(set.range({ from: bound }), set.filter((_$: any, key: any) => East.greaterEqual(lead(key), given))));
                $(assertEast.equal(set.range({ to: bound }), set.filter((_$: any, key: any) => East.less(lead(key), given))));
                $(assertEast.equal(set.prefix(bound), set.filter((_$: any, key: any) => East.equal(lead(key), given))));
                // A prefix of a key the set holds is never empty.
                $(assertEast.greater(set.prefix(part.of(keys[count % keys.length])).size(), 0n));
            }
        });
    }

    for (const kind of PLAIN_KINDS) {
        const keys = keysOf(kind.type, kind.make, kind.count);

        test(`${kind.name}: a range is what a walk of the whole keeps, the bound the key's own type`, $ => {
            // Made from an array: a host Set or Map would hold the two zeros as one key.
            const set: any = $.let(valueOf(keys, ArrayType(kind.type)).toSet((_$: any, key: any) => key));
            const dict: any = $.let(set.map((_$: any, _key: any) => 1n));
            for (let trial = 0; trial < 8; trial++) {
                const from = valueOf(kind.make(), kind.type);
                const to = valueOf(kind.make(), kind.type);
                $(assertEast.equal(set.range({ from, to }), set.filter((_$: any, key: any) => East.greaterEqual(key, from).bitAnd(East.less(key, to)))));
                $(assertEast.equal(dict.range({ from }).keys(), set.filter((_$: any, key: any) => East.greaterEqual(key, from))));
                $(assertEast.equal(dict.range({ to }).keys(), set.filter((_$: any, key: any) => East.less(key, to))));
            }
        });
    }

    test("the two zeros, the infinities and NaN bound a range as East orders them", $ => {
        const floats = $.let(East.value([NaN, -Infinity, Infinity, -0, 0, -1.5, 2.25], ArrayType(FloatType)).toSet((_$, x) => x));
        // -0 is before 0, and a range from one up to the other holds it alone.
        $(assertEast.equal(floats.range({ from: -0, to: 0 }).size(), 1n));
        $(assertEast.equal(floats.range({ from: 0 }).size(), 4n));          // 0, 2.25, Infinity, NaN
        $(assertEast.equal(floats.range({ to: -0 }).size(), 2n));           // -Infinity, -1.5
        // NaN is after every number: nothing is at or past it but itself.
        $(assertEast.equal(floats.range({ from: NaN }).size(), 1n));
        $(assertEast.equal(floats.range({ from: Infinity, to: NaN }).size(), 1n));
        $(assertEast.equal(floats.range({ to: -Infinity }).size(), 0n));
    });

    test("an end left out is that end, both left out is every entry, and an inverted or an empty range holds nothing", $ => {
        const sheets = $.let(East.value(sheetsOf(SHEETS), Sheets));
        $(assertEast.equal(sheets.range(), sheets));
        $(assertEast.equal(sheets.range({}), sheets));
        $(assertEast.equal(sheets.range({ from: { press: "P2" } }).size(), 2n));
        $(assertEast.equal(sheets.range({ to: { press: "P2" } }).size(), 4n));
        // `from` past `to`, and the two the same.
        $(assertEast.equal(sheets.range({ from: { press: "P2" }, to: { press: "P1" } }).size(), 0n));
        $(assertEast.equal(sheets.range({ from: { press: "P1", day: JUNE_2 }, to: { press: "P1", day: JUNE_2 } }).size(), 0n));
        // Past the last key, before the first, and between two keys where none lies.
        $(assertEast.equal(sheets.range({ from: { press: "P9" } }).size(), 0n));
        $(assertEast.equal(sheets.range({ to: { press: "A" } }).size(), 0n));
        $(assertEast.equal(sheets.range({ from: { press: "P1", day: JUNE_3 }, to: { press: "P1", day: JUNE_4 } }).size(), 0n));
        $(assertEast.equal(sheets.prefix({ press: "P9" }).size(), 0n));
        // An empty collection.
        const empty = $.let(East.value(sheetsOf([]), Sheets));
        $(assertEast.equal(empty.range({ from: { press: "P1" }, to: { press: "P2" } }).size(), 0n));
        $(assertEast.equal(empty.prefix({ press: "P1" }).size(), 0n));
        $(assertEast.equal(East.value(new Set<string>(), SetType(StringType)).range({ from: "a" }).size(), 0n));
    });

    test("a bound that is the whole key is the range from that key, or up to it; a bound's fields are read in the key's order however they are written", $ => {
        const sheets = $.let(East.value(sheetsOf(SHEETS), Sheets));
        const key = { press: "P1", day: JUNE_2, job: "b" };
        $(assertEast.equal(sheets.range({ from: key }).size(), 4n));
        $(assertEast.equal(sheets.range({ to: key }).size(), 2n));
        $(assertEast.equal(sheets.range({ from: key, to: { press: "P1", day: JUNE_2, job: "c" } }), sheetsOf([[key, 3n]])));
        $(assertEast.equal(sheets.prefix(key), sheetsOf([[key, 3n]])));
        // The same bound, its fields written in another order.
        $(assertEast.equal(sheets.range({ from: { day: JUNE_2, press: "P1" } }), sheets.range({ from: { press: "P1", day: JUNE_2 } })));
        $(assertEast.equal(sheets.prefix({ day: JUNE_2, press: "P1" }).size(), 2n));
        // A bound given as an expression of the key's type cut short.
        const bound = $.let(East.value({ press: "P1", day: JUNE_2 }, StructType({ press: StringType, day: DateTimeType })));
        $(assertEast.equal(sheets.range({ from: bound }).size(), 5n));
        $(assertEast.equal(sheets.prefix(bound).size(), 2n));
        // And with a field an expression.
        const press = $.let(East.value("P2"));
        $(assertEast.equal(sheets.prefix({ press }).size(), 2n));
    });

    test("a bound written as an expression of a subtype of the key's type is read at the key's type, as `get` reads a key", $ => {
        // An untyped variant is a variant of its one case, a subtype of the key's variant.
        const Run = StructType({ level: Level, n: IntegerType });
        const runs = $.let(East.value(new SortedSet([
            { level: variant("day", null), n: 1n },
            { level: variant("week", null), n: 0n },
            { level: variant("week", null), n: 2n },
        ], compareFor(Run)), SetType(Run)));
        const week = $.let(variant("week", null));
        $(assertEast.equal(runs.prefix({ level: week }).size(), 2n));
        // The field before the last a bound gives, and the whole key.
        $(assertEast.equal(runs.range({ from: { level: week, n: 1n } }).size(), 1n));
        $(assertEast.equal(runs.range({ to: $.let({ level: variant("week", null), n: 2n }) }).size(), 2n));
        // A struct of the key's first fields, its field a subtype of the key's.
        $(assertEast.equal(runs.prefix($.let({ level: variant("week", null) })).size(), 2n));
        // An option key, its bound written as `some`: a variant of the one case.
        const Count = OptionType(IntegerType);
        const counts = $.let(East.value(new SortedSet([none, some(1n), some(3n), some(5n)], compareFor(Count)), SetType(Count)));
        $(assertEast.equal(counts.range({ from: $.let(some(3n)) }).size(), 2n));
        $(assertEast.equal(counts.range({ to: $.let(some(1n)) }).size(), 1n));
    });

    test("a range is read as any Dict or Set is, and narrowed again: a range of a range, a prefix of a prefix", $ => {
        const sheets = $.let(East.value(sheetsOf(SHEETS), Sheets));
        const ofPress = $.let(sheets.prefix({ press: "P1" }));
        $(assertEast.equal(ofPress.size(), 4n));
        $(assertEast.equal(ofPress.has({ press: "P1", day: JUNE_2, job: "a" }), true));
        // A key outside the range is absent from it, though the source holds it.
        $(assertEast.equal(ofPress.has({ press: "P2", day: JUNE_1, job: "a" }), false));
        $(assertEast.equal(ofPress.get({ press: "P1", day: JUNE_2, job: "b" }), 3n));
        $(assertEast.equal(ofPress.tryGet({ press: "P2", day: JUNE_1, job: "a" }), none));
        $(assertEast.equal(ofPress.sum(), 10n));
        // Narrowed: by a longer prefix, by a range, and by a range that reaches past it.
        $(assertEast.equal(ofPress.prefix({ press: "P1", day: JUNE_2 }).sum(), 5n));
        $(assertEast.equal(ofPress.range({ from: { press: "P1", day: JUNE_2 } }).size(), 3n));
        $(assertEast.equal(ofPress.range({ to: { press: "P3" } }), ofPress));
        $(assertEast.equal(ofPress.prefix({ press: "P2" }).size(), 0n));
        // A loop over a range runs its entries alone, in key order.
        const jobs = $.let("");
        $.for(sheets.range({ from: { press: "P1", day: JUNE_2 }, to: { press: "P2" } }), ($, _count, at) => {
            $.assign(jobs, jobs.concat(at.job));
        });
        $(assertEast.equal(jobs, "abc"));
    });

    test("a range is a new collection: changed, its source is as it was, and it is not its source even where it holds every entry", $ => {
        const sheets = $.let(East.value(sheetsOf(SHEETS), Sheets));
        const ofPress = $.let(sheets.prefix({ press: "P1" }));
        $(ofPress.insert({ press: "P5", day: JUNE_1, job: "z" }, 99n));
        $(ofPress.delete({ press: "P1", day: JUNE_1, job: "a" }));
        $(ofPress.update({ press: "P1", day: JUNE_2, job: "a" }, 20n));
        $(assertEast.equal(ofPress.size(), 4n));
        $(assertEast.equal(sheets.size(), 6n));
        $(assertEast.equal(sheets.has({ press: "P5", day: JUNE_1, job: "z" }), false));
        $(assertEast.equal(sheets.get({ press: "P1", day: JUNE_2, job: "a" }), 2n));
        // The source changed afterwards changes no range taken before.
        const before = $.let(sheets.prefix({ press: "P2" }));
        $(sheets.insert({ press: "P2", day: JUNE_4, job: "n" }, 7n));
        $(assertEast.equal(before.size(), 2n));
        $(assertEast.equal(sheets.prefix({ press: "P2" }).size(), 3n));
        // The source may be changed inside a loop over a range of it.
        $.for(before, ($, count, at) => {
            $(sheets.insertOrUpdate({ press: "P9", day: at.day, job: at.job }, count));
        });
        $(assertEast.equal(sheets.prefix({ press: "P9" }).size(), 2n));
        // Every entry, and still another collection.
        const all = $.let(sheets.range());
        $(assertEast.equal(all, sheets));
        $(assertEast.equal(East.is(all, sheets), false));
        // A Set's range, the same.
        const names = $.let(East.value(new Set(["ant", "bee", "cat"]), SetType(StringType)));
        const some = $.let(names.range({ from: "b" }));
        $(some.insert("dog"));
        $(assertEast.equal(names.size(), 3n));
        $(assertEast.equal(East.is(names.range(), names), false));
    });
});

// --- Refusals: where a function is built, and where an IR made by hand is analyzed ---

/** The IR of a range builtin inside a function's IR: the first node of that builtin, found by a walk. */
function builtinNode(ir: unknown, name: string, seen = new Set<unknown>()): Extract<IR, { type: "Builtin" }> | undefined {
    if (typeof ir !== "object" || ir === null || seen.has(ir)) return undefined;
    seen.add(ir);
    const node = ir as { type?: unknown; value?: { builtin?: unknown } };
    if (node.type === "Builtin" && node.value?.builtin === name) return ir as Extract<IR, { type: "Builtin" }>;
    for (const child of Object.values(ir)) {
        const found = builtinNode(child, name, seen);
        if (found !== undefined) return found;
    }
    return undefined;
}

describe("a bound that is no leading part of the key (#1616)", () => {
    const LEADING = "is no leading part of the key: a bound gives the key's first fields in order — press, day, job";
    const build = (body: (sheets: any) => unknown) => () => East.function([Sheets], Sheets, (_$, sheets) => body(sheets) as never);

    test("is refused where the function is built, in one set of words, naming the key's fields in order", () => {
        // A later field alone, a field that is not the key's, no field at all, and a field skipped.
        assert.throws(build((sheets) => sheets.range({ from: { day: JUNE_1 } })), { message: `a range's \`from\` ${LEADING}` });
        assert.throws(build((sheets) => sheets.range({ to: { colour: "red" } })), { message: `a range's \`to\` ${LEADING}` });
        assert.throws(build((sheets) => sheets.range({ to: {} })), { message: `a range's \`to\` ${LEADING}` });
        assert.throws(build((sheets) => sheets.prefix({ press: "P1", job: "a" })), { message: `a prefix ${LEADING}` });
        // An expression of a struct type that is not the key's cut short.
        assert.throws(build((sheets) => sheets.range({ from: East.value({ job: "a" }, StructType({ job: StringType })) })), { message: `a range's \`from\` ${LEADING}` });
        assert.throws(build((sheets) => sheets.prefix(East.value({ press: 1n }, StructType({ press: IntegerType })))), { message: `a prefix ${LEADING}` });
    });

    test("only the last field a bound gives may be cut short", () => {
        const Index = DictType(Indexed, IntegerType);
        const build = (body: (index: any) => unknown) => () => East.function([Index], Index, (_$, index) => body(index) as never);
        // `on` given in part, then `key` after it.
        assert.throws(build((index) => index.prefix({ ik: { on: { hall: "H1" }, key: "j" } })),
            { message: "a prefix is no leading part of the key: a bound gives the key's first fields in order — ik.on.hall, ik.on.press, ik.key, ik.level, ik.tile, k" });
        assert.doesNotThrow(build((index) => index.prefix({ ik: { on: { hall: "H1", press: "P1" }, key: "j" } })));
        assert.doesNotThrow(build((index) => index.prefix({ ik: { on: { hall: "H1" } } })));
    });

    test("on a key that is not a struct: a range's bound is the key's own type, and a prefix is refused naming `get` and `range`", () => {
        const Stock = DictType(StringType, IntegerType);
        const build = (body: (stock: any) => unknown) => () => East.function([Stock], Stock, (_$, stock) => body(stock) as never);
        assert.throws(build((stock) => stock.range({ from: East.value(1n) })), { message: "a range's `from` is not the key's type: a bound of a String key is a String" });
        assert.throws(build((stock) => stock.prefix("ab")),
            { message: "a prefix gives the first fields of a struct key, and this key is a String: read one key with `get`, or the keys between two with `range`" });
        const names = () => East.function([SetType(IntegerType)], SetType(IntegerType), (_$, set) => (set as any).prefix(1n));
        assert.throws(names, { message: "a prefix gives the first fields of a struct key, and this key is a Integer: read one key with `get`, or the keys between two with `range`" });
    });

    test("in an IR made by hand, is refused where the IR is analyzed, in the same words", () => {
        const Press = toEastTypeValue(StructType({ press: StringType }));
        const analyzed = (name: string, change: (parameters: EastTypeValue[]) => void, body: (sheets: any) => unknown = (sheets) => sheets.range({ from: { press: "P1" }, to: { press: "P2" } })) => () => {
            const ir = East.function([Sheets], Sheets, (_$, sheets) => body(sheets) as never).toIR().ir;
            const node = builtinNode(ir, name)!;
            change(node.value.type_parameters);
            analyzeIR(ir, []);
        };
        // As built, it is accepted.
        assert.doesNotThrow(analyzed("DictRange", () => undefined));
        // A bound's type that is no leading part of the key.
        assert.throws(analyzed("DictRange", (parameters) => { parameters[2] = toEastTypeValue(StructType({ day: DateTimeType })); }),
            /^Error: Builtin function 'DictRange': a range's `from` is no leading part of the key: a bound gives the key's first fields in order — press, day, job at loc_id /);
        assert.throws(analyzed("DictRange", (parameters) => { parameters[3] = toEastTypeValue(IntegerType); }),
            /^Error: Builtin function 'DictRange': a range's `to` is no leading part of the key: /);
        assert.throws(analyzed("DictPrefix", (parameters) => { parameters[2] = toEastTypeValue(StructType({ job: StringType })); }, (sheets) => sheets.prefix({ press: "P1" })),
            /^Error: Builtin function 'DictPrefix': a prefix is no leading part of the key: /);
        // A bound's type the key allows, which its argument is not of.
        assert.throws(analyzed("DictRange", (parameters) => { parameters[2] = toEastTypeValue(Sheets.key); }),
            /^Error: Builtin function 'DictRange': its `from` is of type .*, but its type parameters say /);
        // A key that is not the collection's, and a type parameter short.
        assert.throws(analyzed("DictRange", (parameters) => { parameters[0] = Press; parameters[2] = Press; parameters[3] = Press; }),
            /^Error: Builtin function 'DictRange': its type parameters say .*, but its first argument is of type /);
        assert.throws(analyzed("DictRange", (parameters) => { parameters.pop(); }),
            /^Error: Builtin function 'DictRange' takes 4 type parameters, got 3 at loc_id /);
        // A Set's, the same.
        const set = () => {
            const ir = East.function([SetType(Sheet)], SetType(Sheet), (_$, runs) => runs.prefix({ press: "P1" })).toIR().ir;
            builtinNode(ir, "SetPrefix")!.value.type_parameters[1] = toEastTypeValue(StructType({ day: DateTimeType }));
            analyzeIR(ir, []);
        };
        assert.throws(set, /^Error: Builtin function 'SetPrefix': a prefix is no leading part of the key: /);
    });
});

describe("a bound over a key with a field named like an array index (#1616)", () => {
    /** The type a range builtin reads one of its bounds at, as the function is built. */
    const boundType = (key: EastType, builtin: string, at: number, body: (dict: any) => unknown): EastType => {
        const Dict = DictType(key, IntegerType);
        const ir = East.function([Dict], Dict, (_$, dict) => body(dict) as never).toIR().ir;
        return fromEastTypeValue(builtinNode(ir, builtin)!.value.type_parameters[at]!);
    };

    test("is built in the key's order, as `get` builds a key, however the object lists its fields", () => {
        // An object lists a field named like an array index first, wherever the key has it.
        const Last = StructType([["region", StringType], ["2024", FloatType]]);
        assert.ok(isTypeEqual(boundType(Last, "DictRange", 3, (dict) => dict.range({ to: { "2024": 1.5, region: "N" } })), Last));
        assert.ok(isTypeEqual(boundType(Last, "DictPrefix", 2, (dict) => dict.prefix({ region: "N", "2024": 1.5 })), Last));
        assert.ok(isTypeEqual(boundType(Last, "DictRange", 2, (dict) => dict.range({ from: { region: "N" } })), StructType([["region", StringType]])));
        const First = StructType([["2024", FloatType], ["region", StringType]]);
        assert.ok(isTypeEqual(boundType(First, "DictPrefix", 2, (dict) => dict.prefix({ "2024": 1.5 })), StructType([["2024", FloatType]])));
        assert.ok(isTypeEqual(boundType(First, "DictRange", 2, (dict) => dict.range({ from: { region: "N", "2024": 1.5 } })), First));
    });
});
