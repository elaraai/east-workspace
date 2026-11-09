/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A variant's cases have one order on every runtime (east-workspace#1574): its
 * case names as strings sort.
 *
 * A case's position in that order is what beast2 writes for it — the header
 * lists the cases so, and a case's tag is its position there — and what an
 * ordering of two values compares first. The names `50`, `100`, `300`, `400`
 * and `a` are in the order `100`, `300`, `400`, `50`, `a`, however much a name
 * looks like a number: TypeScript holds a variant's cases as an object, which
 * lists an integer-like key — an array index, the canonical decimal of an
 * integer from 0 to 2^32 − 2 — before every other, in numeric order, and a
 * runtime that took that order for the cases' writes bytes no other runtime
 * writes, whose cases the others read at other positions.
 *
 * Each test holds a runtime to that order where it shows: a sort, a set's and
 * a dict's order, a comparison, the bytes beast2 writes for a case, and the
 * case bytes decode to. A struct's fields, which keep the order the type gives
 * them — a TypeScript struct with a field named like an integer is declared as
 * a list to keep it — are held beside them. Bytes v1.0.105 wrote, which list
 * such cases in the order a TypeScript object lists them, are refused by every
 * reader, whole or lazy, rather than read by their positions in this order.
 */
import {
    ArrayType, BlobType, DictType, East, Expr, IntegerType, NullType, SetType, StringType, StructType, VariantType,
    encodeBeast2For, encodeBeast2PagedFor, variant, type ValueTypeOf,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";

/** east-ui's shades, as its ColorTokenType names them: integer-like cases, and one that is not. */
const Shade = VariantType({ "50": NullType, "100": NullType, "300": NullType, "400": NullType, a: NullType });

/** {@link Shade}'s cases, as their names sort. */
const SHADES = ["100", "300", "400", "50", "a"] as const;

/** Names on both sides of an array index's edge: those that are one, and those that only look like one. */
const Edge = VariantType({
    b: NullType, A: NullType, "1.5": NullType, "-1": NullType, "007": NullType, "10": NullType,
    "9": NullType, "1": NullType, "0": NullType, "4294967295": NullType, "4294967294": NullType, a: NullType,
});

/** {@link Edge}'s cases, as their names sort. */
const EDGES = ["-1", "0", "007", "1", "1.5", "10", "4294967294", "4294967295", "9", "A", "a", "b"] as const;

/** {@link Edge}'s cases in the order a TypeScript object lists them: the five
 *  array indices in numeric order, then the rest as their names sort. */
const EDGES_AS_AN_OBJECT_LISTS_THEM = ["0", "1", "9", "10", "4294967294", "-1", "007", "1.5", "4294967295", "A", "a", "b"] as const;

/** A struct whose field names are integer-like, and one that is not, listed in that order. */
const Counts = StructType([["b", IntegerType], ["10", IntegerType], ["2", IntegerType]]);

/** {@link Shade}'s integer-like cases alone. */
const Grade = VariantType({ "50": NullType, "100": NullType, "300": NullType, "400": NullType });

/** A Dict of strings to {@link Grade}. */
const Shades = DictType(StringType, Grade);

/** `{a: 50, b: 100, c: 300, d: 400}` of {@link Shades}, paged, as v1.0.105
 *  wrote it: its header lists the cases `50`, `100`, `300`, `400`, and their
 *  tags are 0 to 3 in that order (the same bytes as
 *  src/serialization/beast2/v5/header-type.spec.ts). */
const OLD_PAGED = new Uint8Array([
    0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05, 0x00, 0x1c, 0x03, 0x04, 0x01, 0x00, 0x08, 0x04, 0x02, 0x35, 0x30, 0x01,
    0x03, 0x31, 0x30, 0x30, 0x01, 0x03, 0x33, 0x30, 0x30, 0x01, 0x03, 0x34, 0x30, 0x30, 0x01, 0x0b, 0x00, 0x02, 0x01, 0x00,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x0d, 0x0d, 0x04, 0x01, 0x61, 0x00, 0x01, 0x62, 0x01, 0x01, 0x63, 0x02, 0x01, 0x64, 0x03,
    0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x2c, 0x04, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x89, 0x45, 0x61, 0x73,
    0x74, 0x0d, 0x0a, 0xf5,
]);

/** The same value written whole, as v1.0.105 wrote it. */
const OLD_WHOLE = new Uint8Array([
    0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05, 0x00, 0x1c, 0x03, 0x04, 0x01, 0x00, 0x08, 0x04, 0x02, 0x35, 0x30, 0x01,
    0x03, 0x31, 0x30, 0x30, 0x01, 0x03, 0x33, 0x30, 0x30, 0x01, 0x03, 0x34, 0x30, 0x30, 0x01, 0x0b, 0x00, 0x02, 0x01, 0x00,
    0x00, 0x0f, 0x0f, 0x00, 0x04, 0x01, 0x61, 0x00, 0x01, 0x62, 0x01, 0x01, 0x63, 0x02, 0x01, 0x64, 0x03, 0x00,
]);

/** A Dict keyed by {@link Shade}. */
const ShadeCounts = DictType(Shade, IntegerType);

/**
 * The beast2 bytes of one case of a variant whose every case is Null, with the
 * cases listed in its header in the order given — as beast2's v5 container
 * lays them out (devdocs/BEAST2.md):
 *
 * - the magic, version 5;
 * - the type section: kind 0 (structural), its length, the root (type 1), the
 *   count (2): Null (type 0), then the Variant (tag 8), its case count, and
 *   each case's name (its length, its UTF-8) and type (0);
 * - the source map: payload length 1, no stacks;
 * - one frame: codec none, its length twice, and the case's position.
 *
 * Every length here fits one varint byte.
 *
 * @param names - The cases, in the order the header lists them
 * @param name - The case the bytes hold
 * @returns The bytes
 */
function nullCaseBeast2(names: readonly string[], name: string): Uint8Array {
    const utf8 = new TextEncoder();
    const cases = names.flatMap((caseName) => {
        const bytes = [...utf8.encode(caseName)];
        return [bytes.length, ...bytes, 0];
    });
    const types = [0x01, 0x02, 0x00, 0x08, names.length, ...cases];
    const position = names.indexOf(name);
    const bytes = [
        0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,
        0x00, types.length, ...types,
        0x01, 0x00,
        0x00, 0x01, 0x01, position,
    ];
    if (position < 0 || bytes.some((byte) => byte > 0xff) || types.length > 0x7f) {
        throw new Error(`no one-byte layout for case '${name}' of ${names.join(", ")}`);
    }
    return new Uint8Array(bytes);
}

/**
 * What reading `read` comes to: `"refused"` when it throws, `"read"` when it
 * gives a value. The outcome is asserted outside the try that catches the
 * refusal, so a runtime that reads such bytes fails the test: inside an
 * `assert.throws`, a runtime whose test failures are East errors would catch
 * its own failure.
 *
 * @param read - The read
 * @returns Its outcome
 */
function outcomeOf(read: Expr<any>) {
    return Expr.tryCatch(Expr.block(($) => {
        $.let(read);
        return "read";
    }), () => "refused");
}

await describe("Variant case order", (test) => {
    test("sorts cases as their names sort, integer-like or not", $ => {
        const shades = $.let(East.value([variant("a"), variant("400"), variant("50"), variant("300"), variant("100")], ArrayType(Shade)));
        $(assert.equal(shades.sort(($, x) => x).map(($, x) => x.getTag()), [...SHADES]));
        const edges = $.let(East.value([...EDGES_AS_AN_OBJECT_LISTS_THEM].reverse().map((name) => variant(name)), ArrayType(Edge)));
        $(assert.equal(edges.sort(($, x) => x).map(($, x) => x.getTag()), [...EDGES]));
    });

    test("compares two cases as their names sort", $ => {
        $(assert.less(East.value(variant("100"), Shade), variant("50")));
        $(assert.less(East.value(variant("400"), Shade), variant("50")));
        $(assert.less(East.value(variant("50"), Shade), variant("a")));
        $(assert.greater(East.value(variant("50"), Shade), variant("100")));
        $(assert.less(East.value(variant("10"), Edge), variant("9")));
        $(assert.less(East.value(variant("-1"), Edge), variant("0")));
        $(assert.less(East.value(variant("4294967294"), Edge), variant("4294967295")));
    });

    test("keeps a set of cases as their names sort", $ => {
        const shades = $.let(East.value(new Set([variant("a"), variant("400"), variant("50"), variant("300"), variant("100")]), SetType(Shade)));
        $(assert.equal(shades.toArray(($, x) => x.getTag()), [...SHADES]));
    });

    test("keeps a dict keyed by cases as their names sort", $ => {
        const counts = $.let(East.value(new Map<ValueTypeOf<typeof Shade>, bigint>([[variant("a", null), 1n], [variant("50", null), 2n], [variant("100", null), 3n]]), ShadeCounts));
        $(assert.equal(counts.toArray(($, _count, shade) => shade.getTag()), ["100", "50", "a"]));
    });

    test("writes each case as beast2 at its position as the names sort, the header listing them so", $ => {
        for (const name of SHADES) {
            $(assert.equal(East.Blob.encodeBeast(East.value(variant(name), Shade), 'v2'), East.value(nullCaseBeast2(SHADES, name), BlobType)));
        }
        for (const name of EDGES) {
            $(assert.equal(East.Blob.encodeBeast(East.value(variant(name), Edge), 'v2'), East.value(nullCaseBeast2(EDGES, name), BlobType)));
        }
    });

    test("reads each position of beast2 as the case its header names there", $ => {
        for (const name of SHADES) {
            $(assert.equal(East.value(nullCaseBeast2(SHADES, name), BlobType).decodeBeast(Shade, 'v2').getTag(), name));
        }
        for (const name of EDGES) {
            $(assert.equal(East.value(nullCaseBeast2(EDGES, name), BlobType).decodeBeast(Edge, 'v2').getTag(), name));
        }
    });

    test("reads a dict keyed by cases, as TypeScript writes it, as their names sort", $ => {
        const written = encodeBeast2For(ShadeCounts)(new Map<ValueTypeOf<typeof Shade>, bigint>([[variant("a", null), 1n], [variant("50", null), 2n], [variant("100", null), 3n]]));
        const counts = $.let(East.value(written, BlobType).decodeBeast(ShadeCounts, 'v2'));
        $(assert.equal(counts.toArray(($, count, shade) => East.str`${shade.getTag()}=${count}`), ["100=3", "50=2", "a=1"]));
    });

    test("writes and reads a struct's fields in the order its type gives them, as TypeScript writes them", $ => {
        const encodeCounts = encodeBeast2For(Counts);
        const counts = $.let(East.value({ b: 1n, "10": 2n, "2": 3n }, Counts));
        $(assert.equal(East.Blob.encodeBeast(counts, 'v2'), East.value(encodeCounts({ b: 1n, "10": 2n, "2": 3n }), BlobType)));
        const read = $.let(East.value(encodeCounts({ b: 4n, "10": 5n, "2": 6n }), BlobType).decodeBeast(Counts, 'v2'));
        $(assert.equal(East.str`${read.b} ${read["10"]} ${read["2"]}`, "4 5 6"));
    });

    test("refuses bytes whose header lists the cases in another order, read whole", $ => {
        $(assert.equal(outcomeOf(East.value(OLD_WHOLE, BlobType).decodeBeast(Shades, 'v2')), "refused"));
        $(assert.equal(outcomeOf(East.value(OLD_PAGED, BlobType).decodeBeast(Shades, 'v2')), "refused"));
    });

    test("refuses bytes whose header lists the cases in another order, opened lazily, at every read", $ => {
        $(assert.equal(outcomeOf(East.value(OLD_PAGED, BlobType).openBeast(Shades).get("a")), "refused"));
        $(assert.equal(outcomeOf(East.value(OLD_PAGED, BlobType).openBeast(Shades).size()), "refused"));
        $(assert.equal(outcomeOf(East.value(OLD_PAGED, BlobType).openBeast(Shades).toArray(($, shade, key) => East.str`${key}=${shade.getTag()}`)), "refused"));
    });

    test("reads the same value, paged as TypeScript writes it now, whole and lazily", $ => {
        const paged = East.value(encodeBeast2PagedFor(Shades)(new Map<string, ValueTypeOf<typeof Grade>>([["a", variant("50", null)], ["b", variant("100", null)], ["c", variant("300", null)], ["d", variant("400", null)]])), BlobType);
        $(assert.equal(outcomeOf(paged.decodeBeast(Shades, 'v2')), "read"));
        $(assert.equal(paged.decodeBeast(Shades, 'v2').toArray(($, shade, key) => East.str`${key}=${shade.getTag()}`), ["a=50", "b=100", "c=300", "d=400"]));
        $(assert.equal(paged.openBeast(Shades).get("a").getTag(), "50"));
        $(assert.equal(paged.openBeast(Shades).toArray(($, shade, key) => East.str`${key}=${shade.getTag()}`), ["a=50", "b=100", "c=300", "d=400"]));
    });
});
