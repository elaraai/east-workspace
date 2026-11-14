/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The key-search grammar's queries as a keyed source's `seek` is asked them,
 * and as one range of the key's flattened leaves (#1621): what a search asks
 * inside a longer key, an index's `{ik, k}` under one `ik`. Each range is held
 * to what {@link findKeyInline} finds for its query, over decoded keys in
 * East's order, for every form a search box makes, at each key type a record
 * holds, edge values among them.
 *
 * Pure `node:test` over decoded values (no East expression methods, so no
 * companion examples file).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    BlobType, BooleanType, DateTimeType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    compareFor, equalFor, none, parseFor, printFor, some, toEastTypeValue, variant,
    type EastType,
} from "@elaraai/east";
import { SeekQueryType } from "@elaraai/east-ui";
import {
    findKeyInline, keyQueryRange, parseKeyInput, toSeekQuery,
    type DatasetKeyMatchRange, type DatasetKeyQuery, type KeyQueryRange,
} from "@elaraai/east-ui/internal";
import { queriesOf } from "./key-queries.js";

const MAX = (1n << 63n) - 1n;
const MIN = -(1n << 63n);
const printString = printFor(StringType);
const printInteger = printFor(IntegerType);

/** A DateTime, read by East from its literal. */
function instant(text: string): Date {
    const parsed = parseFor(DateTimeType)(text);
    if (!parsed.success) throw new Error(parsed.error);
    return parsed.value;
}

/**
 * Where a range lands among keys, as a `range` seek places it: the first key at
 * or past `from`, up to the first at or past `to` — and for an exact key, the
 * first of them where it is that key.
 */
function seekRange(type: EastType, keys: readonly unknown[], range: KeyQueryRange): DatasetKeyMatchRange {
    const query: DatasetKeyQuery = range.to === undefined ? { from: [...range.from] } : { from: [...range.from], to: [...range.to] };
    const at = findKeyInline(toEastTypeValue(type), keys, query);
    if (range.exact === undefined) return at;
    const found = at.count > 0 && equalFor(toEastTypeValue(type))(keys[at.row], range.exact);
    return { found, row: at.row, count: found ? 1 : 0 };
}

/** Holds a query's range to what findKeyInline finds for the query. */
function holds(type: EastType, keys: readonly unknown[], query: DatasetKeyQuery): void {
    const typeValue = toEastTypeValue(type);
    const expected = findKeyInline(typeValue, keys, query);
    const range = keyQueryRange(typeValue, query);
    const label = JSON.stringify(query);
    if (range === null) {
        assert.equal(expected.count, 0, `${label} is no range, though findKeyInline finds ${expected.count}`);
        return;
    }
    assert.deepEqual(seekRange(type, keys, range), expected, `${label} as ${JSON.stringify({ from: range.from, to: range.to })}`);
}

/** Each key type, its probes (two in three of them keys), and keys no literal writes. */
const CASES: { name: string; type: EastType; probes: unknown[]; unwritten?: unknown[] }[] = [
    {
        name: "a String, by code point: the surrogates' block, the last code point, NUL",
        type: StringType,
        probes: ["", "a", "a\u0000", "ab", "abc", "b", "ba", "퟿", "퟿x", "", "￿", "\u{10000}", "\u{10FFFF}",
            "\u{10FFFF}\u{10FFFF}", "z", "z\u{10FFFF}", "z\u{10FFFF}a", "{"],
    },
    { name: "an Integer, its least and its last", type: IntegerType, probes: [MIN, MIN + 1n, -1n, 0n, 1n, 2n, MAX - 1n, MAX] },
    {
        name: "a Float: -0 before 0, NaN after +Infinity, the steps by the zeros",
        type: FloatType,
        probes: [-Infinity, -Number.MAX_VALUE, -1.5, -5e-324, -0, 0, 5e-324, 1.5, Number.MAX_VALUE, Infinity, NaN],
    },
    {
        name: "a DateTime, the last instant East writes among them",
        type: DateTimeType,
        probes: [instant("0000-01-01T00:00:00.000"), instant("2024-02-29T12:00:00.000"), instant("2024-02-29T12:00:00.001"),
            instant("9999-12-31T23:59:59.998"), instant("9999-12-31T23:59:59.999")],
        unwritten: [new Date(Date.UTC(10000, 0, 1))],
    },
    { name: "a Boolean", type: BooleanType, probes: [false, true] },
    {
        name: "a Struct of a String and an Integer",
        type: StructType({ press: StringType, seq: IntegerType }),
        probes: [{ press: "", seq: 0n }, { press: "p", seq: MAX }, { press: "press-1", seq: 1n }, { press: "press-1", seq: 2n },
            { press: "press-1", seq: MAX }, { press: "press-10", seq: MIN }, { press: "press-2", seq: 5n }, { press: "q", seq: 0n }],
    },
    {
        name: "a Struct ending in a Boolean, whose last value carries",
        type: StructType({ s: StringType, flag: BooleanType }),
        probes: [{ s: "a", flag: false }, { s: "a", flag: true }, { s: "a\u0000", flag: false }, { s: "ab", flag: true }, { s: "b", flag: true }],
    },
    {
        name: "a nested Struct, its leading field a Struct",
        type: StructType({ g: StructType({ x: IntegerType, y: StringType }), id: StringType }),
        probes: [{ g: { x: 1n, y: "a" }, id: "p" }, { g: { x: 1n, y: "a" }, id: "q" }, { g: { x: 1n, y: "b" }, id: "p" },
            { g: { x: 2n, y: "" }, id: "" }, { g: { x: MAX, y: "z" }, id: "z" }, { g: { x: MAX, y: "z\u{10FFFF}" }, id: "a" }],
    },
    {
        name: "a Struct with an Option, a Variant whose next case starts at its least",
        type: StructType({ site: StringType, slot: OptionType(IntegerType) }),
        probes: [{ site: "a", slot: none }, { site: "a", slot: some(MIN) }, { site: "a", slot: some(0n) }, { site: "a", slot: some(MAX) },
            { site: "a\u0000", slot: none }, { site: "b", slot: some(3n) }],
    },
    {
        name: "a Struct with a Blob",
        type: StructType({ name: StringType, tag: BlobType }),
        probes: [{ name: "a", tag: new Uint8Array([]) }, { name: "a", tag: new Uint8Array([0]) }, { name: "a", tag: new Uint8Array([0, 0]) },
            { name: "a", tag: new Uint8Array([1]) }, { name: "b", tag: new Uint8Array([255]) }],
    },
];

describe("keyQueryRange", () => {
    for (const { name, type, probes, unwritten } of CASES) {
        test(`finds what findKeyInline finds, for every query of ${name}`, () => {
            const compare = compareFor(toEastTypeValue(type));
            const keys = [...probes.filter((_, i) => i % 3 !== 1), ...(unwritten ?? [])].sort(compare);
            const queries = queriesOf(type, probes);
            assert.ok(queries.length > probes.length * 3, "the queries span every form");
            for (const query of queries) holds(type, keys, query);
        });
    }

    test("finds what a search box asks of a Struct key, typed", () => {
        const type = StructType({ press: StringType, seq: IntegerType });
        const keys = [{ press: "press-1", seq: 1n }, { press: "press-1", seq: 2n }, { press: "press-1", seq: 7n }, { press: "press-10", seq: 1n },
            { press: "press-2", seq: 4n }, { press: "q", seq: 0n }];
        for (const text of ["", "p", "press-1", "press-1,", "press-1, 2", "\"press-1\", 2", "(press=\"press-1\", seq=7)", "press-1..press-2",
            "..press-10", "press-1, 2..press-1, 7", "press-1, 2..", "press-3", "press-1, 3"]) {
            const parsed = parseKeyInput(toEastTypeValue(type), text);
            assert.equal(parsed.kind, "query", text);
            if (parsed.kind === "query") holds(type, keys, parsed.query);
        }
    });

    test("ends a prefix at its last code point raised, past the surrogates, a last code point carrying", () => {
        const at = (prefix: string) => keyQueryRange(toEastTypeValue(StringType), { prefix });
        assert.deepEqual(at("a퟿"), { from: [printString("a퟿")], to: [printString("a")] });
        assert.deepEqual(at("a￿"), { from: [printString("a￿")], to: [printString("a\u{10000}")] });
        assert.deepEqual(at("z\u{10FFFF}"), { from: [printString("z\u{10FFFF}")], to: [printString("{")] });
        // Every String past these starts with them: the run is open at its end.
        assert.deepEqual(at("\u{10FFFF}"), { from: [printString("\u{10FFFF}")], to: undefined });
        assert.deepEqual(at(""), { from: [printString("")], to: undefined });
    });

    test("ends leading fields where the last of them changes, a last value carrying into the one before", () => {
        const type = toEastTypeValue(StructType({ s: StringType, flag: BooleanType }));
        const after = [printString("a\u0000")];
        assert.deepEqual(keyQueryRange(type, { fields: [printString("a"), "true"] }), { from: [printString("a"), "true"], to: after });
        assert.deepEqual(keyQueryRange(type, { key: "(s=\"a\", flag=true)" }), { from: [printString("a"), "true"], to: after });
        assert.deepEqual(keyQueryRange(type, { fields: [printString("a"), "false"] }), { from: [printString("a"), "false"], to: [printString("a"), "true"] });
        // A prefix nothing ends — every String past it starts with it — ends where the leading fields do.
        assert.deepEqual(keyQueryRange(type, { fields: [], prefix: "" }), { from: [printString("")], to: undefined });
        const nested = toEastTypeValue(StructType({ k: StructType({ s: StringType, t: StringType }), n: IntegerType }));
        assert.deepEqual(keyQueryRange(nested, { fields: ["(s=\"a\", t=\"\u{10FFFF}\")"] }),
            { from: [printString("a"), printString("\u{10FFFF}")], to: [printString("a"), printString("\u{10FFFF}\u0000")] });
    });

    test("reads a nested key's leading field at its own type, and lays it out as its leaves", () => {
        const type = toEastTypeValue(StructType({ g: StructType({ x: IntegerType, y: StringType }), id: StringType }));
        assert.deepEqual(keyQueryRange(type, { fields: ["(x=1, y=\"a\")"] }), { from: ["1", printString("a")], to: ["1", printString("a\u0000")] });
        assert.deepEqual(keyQueryRange(type, { fields: ["(x=1, y=\"a\")"], prefix: "p" }),
            { from: ["1", printString("a"), printString("p")], to: ["1", printString("a"), printString("q")] });
        assert.equal(keyQueryRange(type, { fields: ["1"] }), null, "a leaf's literal is no literal of its field");
    });

    test("ends each type's value at the one after it in East's order", () => {
        const end = (type: EastType, key: string) => keyQueryRange(toEastTypeValue(type), { key })?.to;
        assert.deepEqual(end(IntegerType, printInteger(MAX - 1n)), [printInteger(MAX)]);
        assert.equal(end(IntegerType, printInteger(MAX)), undefined, "no Integer is past the last");
        assert.deepEqual(end(FloatType, "-0.0"), ["0.0"]);
        assert.deepEqual(end(FloatType, "0.0"), ["5e-324"]);
        assert.deepEqual(end(FloatType, "-5e-324"), ["-0.0"]);
        assert.deepEqual(end(FloatType, "-Infinity"), [printFor(FloatType)(-Number.MAX_VALUE)]);
        assert.deepEqual(end(FloatType, "Infinity"), ["NaN"]);
        assert.equal(end(FloatType, "NaN"), undefined, "NaN is last");
        assert.deepEqual(end(BooleanType, "false"), ["true"]);
        assert.equal(end(BooleanType, "true"), undefined);
        assert.deepEqual(end(DateTimeType, "2024-02-29T23:59:59.999"), ["2024-03-01T00:00:00.000"]);
        const Slot = StructType({ site: StringType, slot: OptionType(IntegerType) });
        assert.deepEqual(end(Slot, "(site=\"a\", slot=.none)"), [printString("a"), printFor(OptionType(IntegerType))(some(MIN))]);
        assert.deepEqual(end(Slot, `(site="a", slot=.some ${printInteger(MAX)})`), [printString("a\u0000")]);
    });

    test("finds a whole key East writes nothing after as the first key at or past it", () => {
        const last = instant("9999-12-31T23:59:59.999");
        const range = keyQueryRange(toEastTypeValue(DateTimeType), { key: "9999-12-31T23:59:59.999" });
        assert.deepEqual(range?.from, ["9999-12-31T23:59:59.999"]);
        assert.equal(range?.to, undefined);
        assert.equal(equalFor(DateTimeType)(range?.exact as Date, last), true);
        const Kind = VariantType({ a: NullType, b: DateTimeType });
        const variantRange = keyQueryRange(toEastTypeValue(StructType({ kind: Kind, n: IntegerType })), { key: `(kind=.a, n=${printInteger(MAX)})` });
        assert.equal(variantRange?.to, undefined, "the case after .a starts at a DateTime no literal writes");
        assert.equal(equalFor(StructType({ kind: Kind, n: IntegerType }))(variantRange?.exact as never, { kind: variant("a", null), n: MAX }), true);
    });

    test("refuses leading fields East writes nothing after, naming the part", () => {
        const Timed = toEastTypeValue(StructType({ n: IntegerType, when: DateTimeType, id: StringType }));
        assert.throws(() => keyQueryRange(Timed, { fields: ["1", "9999-12-31T23:59:59.999"] }), /'when' \(DateTime\).*from\.\.to/);
        const Kind = toEastTypeValue(StructType({ kind: VariantType({ a: NullType, b: DateTimeType }), id: StringType }));
        assert.throws(() => keyQueryRange(Kind, { fields: [".a"] }), /'kind' \(Variant\)/);
        // A range of them is searched as written.
        assert.deepEqual(keyQueryRange(Timed, { from: ["1", "9999-12-31T23:59:59.999"] }), { from: ["1", "9999-12-31T23:59:59.999"], to: undefined });
    });

    test("is no range where no key matches, as findKeyInline finds none", () => {
        const Machine = toEastTypeValue(StructType({ name: StringType, idx: IntegerType }));
        const keys = [{ name: "a", idx: 1n }, { name: "b", idx: 2n }];
        for (const query of [
            { key: "not a key" }, { fields: [printString("a"), "1", "2"] }, { fields: ["x"] }, { fields: [printString("a")], prefix: "1" },
            { from: ["\"a\"", "1", "2"] }, { to: ["nope"] },
        ] satisfies DatasetKeyQuery[]) {
            assert.equal(keyQueryRange(Machine, query), null, JSON.stringify(query));
            assert.equal(findKeyInline(Machine, keys, query).count, 0, JSON.stringify(query));
        }
        // Leading fields are a Struct key's alone, as the server refuses them of a String key.
        const Name = toEastTypeValue(StringType);
        assert.equal(keyQueryRange(Name, { fields: [printString("a")], prefix: "b" }), null);
        assert.equal(findKeyInline(Name, ["a", "b", "bc"], { fields: [printString("a")], prefix: "b" }).count, 0);
        assert.equal(keyQueryRange(toEastTypeValue(IntegerType), { prefix: "1" }), null, "a prefix is a String's");
    });
});

describe("toSeekQuery", () => {
    const printSeek = printFor(SeekQueryType);
    /** What a source's `seek` is asked for text typed at a key type, printed. */
    function askedFor(keyType: EastType, text: string): string {
        const parsed = parseKeyInput(toEastTypeValue(keyType), text);
        if (parsed.kind !== "query") throw new Error(`"${text}" parsed as no query: ${parsed.hint}`);
        return printSeek(toSeekQuery(parsed.query));
    }

    test("asks a key's start, a quoted key and a range as themselves", () => {
        assert.equal(askedFor(StringType, "A0"), printSeek(variant("prefix", "A0")));
        assert.equal(askedFor(StringType, "\"A02\""), printSeek(variant("key", "\"A02\"")));
        assert.equal(askedFor(IntegerType, "10"), printSeek(variant("key", "10")));
        assert.equal(askedFor(IntegerType, "2..9"), printSeek(variant("range", { from: ["2"], to: ["9"] })));
        assert.equal(askedFor(IntegerType, "..9"), printSeek(variant("range", { from: [], to: ["9"] })));
    });

    test("keeps a struct key's leading fields with the prefix on the next field", () => {
        const Spot = StructType({ row: IntegerType, col: StringType });
        // Never a bare prefix, which would drop the leading field.
        assert.equal(askedFor(Spot, "1, M"), printSeek(variant("fields", { values: ["1"], prefix: some("M") })));
        assert.equal(askedFor(Spot, "1,"), printSeek(variant("fields", { values: ["1"], prefix: none })));
    });
});
