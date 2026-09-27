/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType,
    RecursiveType, RefType, SetType, StringType, StructType, VariantType, VectorType,
    East, SortedMap, SortedSet, compareFor, equalFor, none, ref, some, variant, type option,
    Beast2ElementWriter, Beast2ManifestWriter, Beast2RunSorter, RUN_MAX_COUNT, decodeBeast2For,
    decodeCollectionManifest, encodeBeast2For, encodeBeast2PagedFor, encodeBeast2SegmentsFor, encodeEastIR,
    mergeBeast2For, recutBeast2For, segmentKeyTypeOf, spliceBeast2, spliceBeast2Tail,
    type Beast2RecutPiece, type Beast2Segment, type Beast2SegmentRef, type EastIR, type EastType, type ValueTypeOf,
} from "../src/index.js";

/* The beast2 conformance corpus: collection values, emission sequences and
 * merges, each with the bytes every runtime writes for it.
 *
 * TypeScript writes each case's bytes here and checks them against an oracle
 * of its own — the value decoded back, the fold done element by element — and,
 * being the one runtime with a Recut, re-cuts every value from pieces. Under
 * EXPORT_TEST_IR (`make test-export`) the cases are written beside the
 * compliance IR, to <dir>/beast2_corpus/, where east-c's test_beast2_corpus
 * and east-py's test_beast2_corpus.py read them and must write the same bytes.
 *
 * Each file is a self-describing blob of an Array of cases; every value in a
 * case is a blob of its own, which carries its type. A fold travels as the IR
 * of a (K, V, V) -> V East function, which every runtime compiles. */

/** A value, its paged blob, and the manifest its directory is written with. */
const ValueCaseType = StructType({ name: StringType, value: BlobType, paged: BlobType, manifest: BlobType });

/** An emission sequence — an Array of Set elements, or of Dict `{key, value}`
 *  pairs — its fold, the runs a RunSorter closes for it, and their merge. */
const RunsCaseType = StructType({
    name: StringType,
    elements: BlobType,
    merge: OptionType(BlobType),
    union: BooleanType,
    runs: ArrayType(BlobType),
    merged: BlobType,
});

/** Sorted inputs, their fold and key range — a blob of `{from, to}` Options
 *  over the key type — and what they merge to, as a blob and as a manifest. */
const MergeCaseType = StructType({
    name: StringType,
    inputs: ArrayType(BlobType),
    merge: OptionType(BlobType),
    union: BooleanType,
    range: OptionType(BlobType),
    expected: BlobType,
    manifest: BlobType,
});

const valueCases: ValueTypeOf<typeof ValueCaseType>[] = [];
const runsCases: ValueTypeOf<typeof RunsCaseType>[] = [];
const mergeCases: ValueTypeOf<typeof MergeCaseType>[] = [];

type Fold = EastIR<any[], any>;
type Fold3 = (key: unknown, acc: unknown, value: unknown) => unknown;

const TallyType = StructType({ count: IntegerType, total: FloatType });
const RegionKeyType = StructType({ region: StringType, id: IntegerType });

const sumIntegers: Fold = East.function([StringType, IntegerType, IntegerType], IntegerType, (_$, _key, acc, value) => acc.add(value)).toIR();
const sumFloats: Fold = East.function([StringType, FloatType, FloatType], FloatType, (_$, _key, acc, value) => acc.add(value)).toIR();
const concatStrings: Fold = East.function([StringType, StringType, StringType], StringType, (_$, _key, acc, value) => acc.concat(value)).toIR();
const addTallies: Fold = East.function([IntegerType, TallyType, TallyType], TallyType, (_$, _key, acc, value) => ({
    count: acc.count.add(value.count),
    total: acc.total.add(value.total),
})).toIR();
const sumByRegion: Fold = East.function([RegionKeyType, IntegerType, IntegerType], IntegerType, (_$, _key, acc, value) => acc.add(value)).toIR();

/** The strings on either side of the UTF-16 and code-point orders' one
 *  disagreement: characters above U+FFFF against U+E000–U+FFFF. */
const CODE_POINT_STRINGS = [
    "", "a", "ab", "é", "一", "퟿", "", "～", "￿",
    "\u{10000}", "\u{1F600}", "\u{10FFFF}", "a～", "a\u{1F600}", "\u{1F600}a",
];

const TreeType = RecursiveType((tree) => VariantType({ leaf: IntegerType, node: StructType({ left: tree, right: tree }) }));

/** xorshift32 — a fixed stream, so the corpus is the same on every run. */
function rng(seed: number): () => number {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s;
    };
}

const longStrings = rng(0x5eed);

const values: { name: string; type: EastType; value: unknown }[] = [
    {
        name: "a Dict of 50,000 strings to integers",
        type: DictType(StringType, IntegerType),
        value: new SortedMap(Array.from({ length: 50_000 }, (_, i) => [`k${String(i).padStart(7, "0")}`, BigInt(i)] as [string, bigint]), compareFor(StringType)),
    },
    {
        name: "a Set of 50,000 strings",
        type: SetType(StringType),
        value: new SortedSet(Array.from({ length: 50_000 }, (_, i) => `e${String(i).padStart(7, "0")}`), compareFor(StringType)),
    },
    {
        name: "an Array of 50,000 strings",
        type: ArrayType(StringType),
        value: Array.from({ length: 50_000 }, (_, i) => `a${String(i).padStart(7, "0")}`),
    },
    { name: "an empty Dict", type: DictType(StringType, IntegerType), value: new SortedMap<string, bigint>(undefined, compareFor(StringType)) },
    { name: "an empty Set", type: SetType(StringType), value: new SortedSet<string>(undefined, compareFor(StringType)) },
    { name: "an empty Array", type: ArrayType(StringType), value: [] },
    { name: "a Dict of one entry", type: DictType(StringType, IntegerType), value: new SortedMap([["only", 1n]], compareFor(StringType)) },
    {
        name: "a Dict of 20,000 rows of every scalar, a Set, a variant and an option",
        type: DictType(StringType, StructType({
            id: IntegerType,
            name: StringType,
            score: FloatType,
            at: DateTimeType,
            tags: SetType(StringType),
            kind: VariantType({ a: NullType, b: IntegerType, c: StringType }),
            note: OptionType(StringType),
        })),
        value: new SortedMap(Array.from({ length: 20_000 }, (_, i) => [`r${String(i).padStart(7, "0")}`, {
            id: BigInt(i),
            name: `row-${i}`,
            score: (i % 13) * 0.25 - 1.5,
            at: new Date(Date.UTC(2020, 0, 1) + i * 60_000),
            tags: new SortedSet([`t${i % 3}`, `u${i % 5}`], compareFor(StringType)),
            kind: i % 3 === 0 ? variant("a", null) : i % 3 === 1 ? variant("b", BigInt(i)) : variant("c", `c${i}`),
            note: i % 4 === 0 ? none : some(`n${i}`),
        }] as [string, unknown]), compareFor(StringType)),
    },
    {
        name: "a Dict of 40 rows of 256 KiB, cut by size",
        type: DictType(StringType, BlobType),
        value: new SortedMap(Array.from({ length: 40 }, (_, i) => [`w${String(i).padStart(7, "0")}`, new Uint8Array(256 * 1024).fill(i)] as [string, Uint8Array]), compareFor(StringType)),
    },
    {
        name: "an Array of 40 blobs of 256 KiB, cut by size",
        type: ArrayType(BlobType),
        value: Array.from({ length: 40 }, (_, i) => new Uint8Array(256 * 1024).fill(255 - i)),
    },
    {
        name: "a Set of floats, NaN, infinities and both zeros among them",
        type: SetType(FloatType),
        value: new SortedSet([NaN, -Infinity, -1.5, -0, 0, 5e-324, 1.5, Infinity], compareFor(FloatType)),
    },
    {
        name: "a Set of strings in code-point order",
        type: SetType(StringType),
        value: new SortedSet(CODE_POINT_STRINGS, compareFor(StringType)),
    },
    {
        name: "a Dict keyed by integers from the least to the greatest",
        type: DictType(IntegerType, StringType),
        value: new SortedMap([
            [-(2n ** 63n), "least"],
            [-(2n ** 63n) + 1n, "least + 1"],
            ...Array.from({ length: 300 }, (_, i) => [BigInt(i * 7 - 1000), `v${i * 7 - 1000}`] as [bigint, string]),
            [2n ** 63n - 1n, "greatest"],
        ], compareFor(IntegerType)),
    },
    {
        name: "a Set of datetimes from 1900 to 2100",
        type: SetType(DateTimeType),
        value: new SortedSet(Array.from({ length: 2_000 }, (_, i) => new Date(-2_208_988_800_000 + i * 3_155_760_000)), compareFor(DateTimeType)),
    },
    {
        name: "a Set of structs, ordered field by field",
        type: SetType(StructType({ a: IntegerType, b: StringType })),
        value: new SortedSet(Array.from({ length: 3_000 }, (_, i) => ({ a: BigInt(i % 30), b: `b${Math.floor(i / 30)}` })), compareFor(StructType({ a: IntegerType, b: StringType }))),
    },
    {
        name: "a Set of variants, ordered by case and then payload",
        type: SetType(VariantType({ a: IntegerType, b: StringType, c: NullType })),
        value: new SortedSet([
            ...Array.from({ length: 1_000 }, (_, i) => variant("a", BigInt(i - 500))),
            ...Array.from({ length: 1_000 }, (_, i) => variant("b", `s${i}`)),
            variant("c", null),
        ], compareFor(VariantType({ a: IntegerType, b: StringType, c: NullType }))),
    },
    {
        name: "a Set of blobs, ordered by byte and then length",
        type: SetType(BlobType),
        value: new SortedSet(Array.from({ length: 2_000 }, (_, i) => Uint8Array.from({ length: i % 41 }, (_, j) => (i * 31 + j * 7) & 255)), compareFor(BlobType)),
    },
    {
        name: "a Dict keyed by structs, of arrays",
        type: DictType(RegionKeyType, ArrayType(IntegerType)),
        value: new SortedMap(Array.from({ length: 5_000 }, (_, i) => [{ region: `r${i % 7}`, id: BigInt(i) }, [BigInt(i), BigInt(2 * i)]] as [{ region: string; id: bigint }, bigint[]]), compareFor(RegionKeyType)),
    },
    {
        // One struct type twice in the collection type: a manifest records
        // the type without aliasing it, in every runtime.
        name: "a Dict whose key and value are one struct type",
        type: DictType(RegionKeyType, RegionKeyType),
        value: new SortedMap(Array.from({ length: 1_000 }, (_, i) => [{ region: `r${i % 3}`, id: BigInt(i) }, { region: `v${i % 5}`, id: BigInt(-i) }] as [{ region: string; id: bigint }, { region: string; id: bigint }]), compareFor(RegionKeyType)),
    },
    {
        // Each element's two fields are one array, which the element's bytes
        // keep as one; neighbouring elements share one too, which the paged
        // blob writes out in each and the whole-value blob aliases.
        name: "an Array of structs whose fields share their arrays",
        type: ArrayType(StructType({ left: ArrayType(IntegerType), right: ArrayType(IntegerType) })),
        value: Array.from({ length: 2_500 }, (_, j) => [BigInt(j), BigInt(j + 1)])
            .flatMap((shared) => [{ left: shared, right: shared }, { left: shared, right: shared }]),
    },
    {
        name: "an Array of structs whose fields share one Ref",
        type: ArrayType(StructType({ x: RefType(IntegerType), y: RefType(IntegerType) })),
        value: Array.from({ length: 3_000 }, (_, i) => ref(BigInt(i))).map((cell) => ({ x: cell, y: cell })),
    },
    {
        name: "an Array of recursive trees",
        type: ArrayType(TreeType),
        value: Array.from({ length: 3_000 }, (_, i) => i % 3 === 0
            ? variant("leaf", BigInt(i))
            : variant("node", {
                left: variant("leaf", BigInt(2 * i)),
                right: i % 3 === 1
                    ? variant("leaf", BigInt(2 * i + 1))
                    : variant("node", { left: variant("leaf", BigInt(i)), right: variant("leaf", BigInt(-i)) }),
            })),
    },
    {
        name: "an Array of float vectors",
        type: ArrayType(VectorType(FloatType)),
        value: Array.from({ length: 2_000 }, (_, i) => Float64Array.from({ length: i % 17 }, (_, j) => i * 0.5 + j)),
    },
    {
        name: "a Dict of Sets",
        type: DictType(StringType, SetType(StringType)),
        value: new SortedMap(Array.from({ length: 3_000 }, (_, i) => [`s${String(i).padStart(7, "0")}`, new SortedSet([`x${i % 11}`, `y${i % 13}`, `z${i}`], compareFor(StringType))] as [string, SortedSet<string>]), compareFor(StringType)),
    },
    {
        name: "an Array of options",
        type: ArrayType(OptionType(IntegerType)),
        value: Array.from({ length: 4_000 }, (_, i) => i % 3 === 0 ? none : some(BigInt(i))),
    },
    {
        name: "a Dict of 2 KiB keys, cut by size before the minimum count",
        type: DictType(StringType, IntegerType),
        value: new SortedMap(Array.from({ length: 300 }, (_, i) => [String(i).padStart(4, "0").padEnd(2_048, "x"), BigInt(i)] as [string, bigint]), compareFor(StringType)),
    },
    {
        name: "an Array of 10,000 strings of up to 1,400 characters",
        type: ArrayType(StringType),
        value: Array.from({ length: 10_000 }, (_, i) => `${i}:`.padEnd(8 + (longStrings() % 1_400), String.fromCharCode(97 + (i % 26)))),
    },
];

/** The segments the Writer cuts a collection's elements into, as a re-cut
 *  takes them: by reference, never read unless a seam needs it. */
function segmentRefsOf(type: EastType, elements: readonly unknown[]): Beast2SegmentRef[] {
    const segments: Beast2Segment[] = [];
    const writer = new Beast2ElementWriter(type, { segment: (segment) => { segments.push(segment); } });
    for (const element of elements) writer.add(element as never);
    writer.finish();
    return segments.map((segment, i) => ({
        count: segment.count,
        fence: segment.fence,
        logicalBytes: segment.logicalBytes,
        ...(type.type !== "Array" && i + 1 < segments.length && { nextFence: segments[i + 1]!.fence }),
        read: () => segment.blob,
    }));
}

/** The whole a re-cut writes, spliced into one blob. */
async function recut(type: EastType, pieces: Beast2RecutPiece[]): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    const stats = await recutBeast2For(type)(pieces, {
        written: (segment) => { parts.push(segment.blob); },
        carried: async (segment) => { parts.push(await segment.read()); },
    });
    return parts.length > 0
        ? spliceBeast2(parts)
        : new Uint8Array(Buffer.concat([stats.header, spliceBeast2Tail([], stats.header.length)]));
}

const runs: { name: string; type: EastType; sequence: EastType; elements: unknown[]; merge?: Fold; union?: boolean }[] = [
    {
        // 7919 is prime to 135,999: every key once, in a permuted order.
        name: "a permuted Dict that closes a run at the element cap",
        type: DictType(StringType, IntegerType),
        sequence: ArrayType(StructType({ key: StringType, value: IntegerType })),
        elements: Array.from({ length: RUN_MAX_COUNT + 4_927 }, (_, i) => ({ key: `k${String((i * 7919) % (RUN_MAX_COUNT + 4_927)).padStart(7, "0")}`, value: BigInt(i) })),
    },
    {
        name: "a Dict whose keys repeat within and across runs, summed",
        type: DictType(StringType, IntegerType),
        sequence: ArrayType(StructType({ key: StringType, value: IntegerType })),
        elements: Array.from({ length: 200_000 }, (_, i) => ({ key: `k${String((i * 7919) % 60_000).padStart(7, "0")}`, value: BigInt(i) })),
        merge: sumIntegers,
    },
    {
        // Where the runs close decides how the floats group before they sum.
        name: "a Dict of floats summed across the element cap",
        type: DictType(StringType, FloatType),
        sequence: ArrayType(StructType({ key: StringType, value: FloatType })),
        elements: Array.from({ length: 140_000 }, (_, i) => ({ key: `f${i % 7}`, value: [0.1, 1e16, -1e16, 3.3, -0.7][i % 5]! * ((i % 11) + 1) })),
        merge: sumFloats,
    },
    {
        name: "a Dict of strings concatenated in emission order",
        type: DictType(StringType, StringType),
        sequence: ArrayType(StructType({ key: StringType, value: StringType })),
        elements: Array.from({ length: 140_000 }, (_, i) => ({ key: `c${String((i * 7919) % 1_000).padStart(7, "0")}`, value: `${i % 10}` })),
        merge: concatStrings,
    },
    {
        name: "a Set whose elements repeat within and across runs, unioned",
        type: SetType(StringType),
        sequence: ArrayType(StringType),
        elements: Array.from({ length: 200_000 }, (_, i) => `e${String((i * 7919) % 150_000).padStart(7, "0")}`),
        union: true,
    },
    {
        name: "a Dict of structs folded field by field",
        type: DictType(IntegerType, TallyType),
        sequence: ArrayType(StructType({ key: IntegerType, value: TallyType })),
        elements: Array.from({ length: 140_000 }, (_, i) => ({ key: BigInt(((i * 7919) % 5_000) - 2_500), value: { count: 1n, total: (i % 9) * 0.1 } })),
        merge: addTallies,
    },
    {
        name: "a Dict keyed by structs, summed in one run",
        type: DictType(RegionKeyType, IntegerType),
        sequence: ArrayType(StructType({ key: RegionKeyType, value: IntegerType })),
        elements: Array.from({ length: 20_000 }, (_, i) => ({ key: { region: `r${i % 7}`, id: BigInt(i % 3_000) }, value: BigInt(i) })),
        merge: sumByRegion,
    },
    {
        name: "a Set of strings in code-point order, unioned",
        type: SetType(StringType),
        sequence: ArrayType(StringType),
        elements: Array.from({ length: 3 * CODE_POINT_STRINGS.length }, (_, i) => CODE_POINT_STRINGS[(i * 7) % CODE_POINT_STRINGS.length]!),
        union: true,
    },
];

const merges: {
    name: string;
    type: EastType;
    keyType: EastType;
    inputs: Uint8Array[];
    merge?: Fold;
    union?: boolean;
    range?: { from: option<unknown>; to: option<unknown> };
}[] = [
    {
        name: "two interleaved halves of a Dict",
        type: DictType(StringType, IntegerType),
        keyType: StringType,
        inputs: [0, 1].map((parity) => encodeBeast2PagedFor(DictType(StringType, IntegerType))(new SortedMap(Array.from({ length: 25_000 }, (_, i) => [`k${String(2 * i + parity).padStart(7, "0")}`, BigInt(2 * i + parity)] as [string, bigint]), compareFor(StringType)))),
    },
    {
        name: "three overlapping Dicts, summed in input order",
        type: DictType(StringType, IntegerType),
        keyType: StringType,
        inputs: [0, 1, 2].map((j) => encodeBeast2PagedFor(DictType(StringType, IntegerType))(new SortedMap(Array.from({ length: 25_000 }, (_, i) => [`k${String(j * 10_000 + i).padStart(7, "0")}`, BigInt(i + j)] as [string, bigint]), compareFor(StringType)))),
        merge: sumIntegers,
    },
    {
        name: "three overlapping Dicts, concatenated in input order",
        type: DictType(StringType, StringType),
        keyType: StringType,
        inputs: [0, 1, 2].map((j) => encodeBeast2PagedFor(DictType(StringType, StringType))(new SortedMap(Array.from({ length: Math.ceil(12_000 / (j + 2)) }, (_, i) => [`c${String(i * (j + 2)).padStart(7, "0")}`, `${j}`] as [string, string]), compareFor(StringType)))),
        merge: concatStrings,
    },
    {
        name: "three overlapping Sets, unioned",
        type: SetType(StringType),
        keyType: StringType,
        inputs: [0, 1, 2].map((j) => encodeBeast2PagedFor(SetType(StringType))(new SortedSet(Array.from({ length: 15_000 }, (_, i) => `e${String(j * 7_000 + i).padStart(7, "0")}`), compareFor(StringType)))),
        union: true,
    },
    {
        name: "two halves of a Dict over a key range",
        type: DictType(StringType, IntegerType),
        keyType: StringType,
        inputs: [0, 1].map((parity) => encodeBeast2PagedFor(DictType(StringType, IntegerType))(new SortedMap(Array.from({ length: 25_000 }, (_, i) => [`k${String(2 * i + parity).padStart(7, "0")}`, BigInt(2 * i + parity)] as [string, bigint]), compareFor(StringType)))),
        range: { from: some("k0010000"), to: some("k0020000") },
    },
    {
        name: "two halves of a Dict over a range open below",
        type: DictType(StringType, IntegerType),
        keyType: StringType,
        inputs: [0, 1].map((parity) => encodeBeast2PagedFor(DictType(StringType, IntegerType))(new SortedMap(Array.from({ length: 25_000 }, (_, i) => [`k${String(2 * i + parity).padStart(7, "0")}`, BigInt(2 * i + parity)] as [string, bigint]), compareFor(StringType)))),
        range: { from: none, to: some("k0005000") },
    },
    {
        name: "two halves of a Dict over a range open above",
        type: DictType(StringType, IntegerType),
        keyType: StringType,
        inputs: [0, 1].map((parity) => encodeBeast2PagedFor(DictType(StringType, IntegerType))(new SortedMap(Array.from({ length: 25_000 }, (_, i) => [`k${String(2 * i + parity).padStart(7, "0")}`, BigInt(2 * i + parity)] as [string, bigint]), compareFor(StringType)))),
        range: { from: some("k0045000"), to: none },
    },
    {
        // A geometry of its own — segments of a thousand, as a writer before
        // the cut rule wrote them — merges into the canonical one.
        name: "a Dict batched by count and a canonical one",
        type: DictType(StringType, IntegerType),
        keyType: StringType,
        inputs: [
            encodeBeast2SegmentsFor(DictType(StringType, IntegerType))(Array.from({ length: 20 }, (_, b) => new SortedMap(Array.from({ length: 1_000 }, (_, i) => [`k${String(b * 1_000 + i).padStart(7, "0")}`, BigInt(b * 1_000 + i)] as [string, bigint]), compareFor(StringType)))),
            encodeBeast2PagedFor(DictType(StringType, IntegerType))(new SortedMap(Array.from({ length: 10_000 }, (_, i) => [`k${String(20_000 + i).padStart(7, "0")}`, BigInt(20_000 + i)] as [string, bigint]), compareFor(StringType))),
        ],
    },
    {
        name: "Sets of floats, NaN and both zeros among them, unioned",
        type: SetType(FloatType),
        keyType: FloatType,
        inputs: [
            encodeBeast2PagedFor(SetType(FloatType))(new SortedSet([NaN, -0, 1.5], compareFor(FloatType))),
            encodeBeast2PagedFor(SetType(FloatType))(new SortedSet([0, -Infinity, 1.5], compareFor(FloatType))),
            encodeBeast2PagedFor(SetType(FloatType))(new SortedSet([NaN, Infinity], compareFor(FloatType))),
        ],
        union: true,
    },
    {
        name: "Sets of strings in code-point order, unioned",
        type: SetType(StringType),
        keyType: StringType,
        inputs: [
            encodeBeast2PagedFor(SetType(StringType))(new SortedSet(CODE_POINT_STRINGS.filter((_, i) => i % 2 === 0), compareFor(StringType))),
            encodeBeast2PagedFor(SetType(StringType))(new SortedSet(CODE_POINT_STRINGS.filter((_, i) => i % 3 === 0), compareFor(StringType))),
        ],
        union: true,
    },
    {
        name: "Dicts keyed by structs, summed",
        type: DictType(RegionKeyType, IntegerType),
        keyType: RegionKeyType,
        inputs: [0, 1].map((j) => encodeBeast2PagedFor(DictType(RegionKeyType, IntegerType))(new SortedMap(Array.from({ length: 4_000 }, (_, i) => [{ region: `r${i % 5}`, id: BigInt(i + j * 2_000) }, BigInt(i)] as [{ region: string; id: bigint }, bigint]), compareFor(RegionKeyType)))),
        merge: sumByRegion,
    },
];

describe("beast2 conformance corpus", () => {
    after(() => {
        if (!process.env.EXPORT_TEST_IR) return;
        const dir = join(process.env.EXPORT_TEST_IR, "beast2_corpus");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "values.beast2"), encodeBeast2For(ArrayType(ValueCaseType))(valueCases));
        writeFileSync(join(dir, "runs.beast2"), encodeBeast2For(ArrayType(RunsCaseType))(runsCases));
        writeFileSync(join(dir, "merges.beast2"), encodeBeast2For(ArrayType(MergeCaseType))(mergeCases));
    });

    describe("values", () => {
        for (const c of values) {
            test(c.name, async () => {
                const whole = encodeBeast2For(c.type)(c.value as never);
                const paged = encodeBeast2PagedFor(c.type)(c.value as never);
                const decode = decodeBeast2For(c.type);
                const equal = equalFor(c.type);
                assert.ok(equal(decode(whole), c.value as never), "the whole-value blob decodes to the value");
                const decoded = decode(paged);
                assert.ok(equal(decoded, c.value as never), "the paged blob decodes to the value");
                const elements: unknown[] = c.type.type === "Dict" ? [...(decoded as Map<unknown, unknown>).entries()] : [...(decoded as Iterable<unknown>)];

                // The directory is the paged blob taken apart.
                const objects = new Map<string, Uint8Array>();
                let manifest = null as Uint8Array | null;
                const writer = new Beast2ManifestWriter(c.type, {
                    object: (hash, bytes) => { objects.set(hash, bytes); },
                    manifest: (bytes) => { manifest = bytes; },
                });
                for (const element of elements) writer.add(element as never);
                writer.finish();
                assert.ok(manifest !== null, "the manifest was written");
                const entries = decodeCollectionManifest(manifest).entries;
                if (entries.length > 0) assert.deepEqual(spliceBeast2(entries.map((entry) => objects.get(entry.hash)!)), paged);

                // Re-cut from the Writer's own segments, every one carried;
                // then from pieces cut at a third and two thirds, the middle
                // one as elements.
                assert.deepEqual(await recut(c.type, [{ segments: segmentRefsOf(c.type, elements) }]), paged, "re-cut from the whole's segments");
                const a = Math.floor(elements.length / 3);
                const b = Math.floor((2 * elements.length) / 3);
                assert.deepEqual(await recut(c.type, [
                    { segments: segmentRefsOf(c.type, elements.slice(0, a)) },
                    { elements: elements.slice(a, b) as never[] },
                    { segments: segmentRefsOf(c.type, elements.slice(b)) },
                ]), paged, "re-cut from pieces");

                valueCases.push({ name: c.name, value: whole, paged, manifest });
            });
        }
    });

    describe("runs", () => {
        for (const c of runs) {
            test(c.name, () => {
                const dict = c.type.type === "Dict";
                const apply = c.merge?.compile([]) as Fold3 | undefined;
                const closed: Uint8Array[] = [];
                const sorter = new Beast2RunSorter(c.type, () => {
                    const chunks: Uint8Array[] = [];
                    return {
                        write: (bytes) => { chunks.push(bytes.slice()); },
                        close: () => { closed.push(new Uint8Array(Buffer.concat(chunks))); },
                    };
                }, { ...(apply !== undefined && { merge: apply }), ...(c.union !== undefined && { union: c.union }) });
                for (const element of c.elements) {
                    sorter.add((dict ? [(element as { key: unknown }).key, (element as { value: unknown }).value] : element) as never);
                }
                sorter.finish();

                // The oracle: each run the fold of its share of the elements,
                // in emission order, and the whole those runs folded in order.
                const cmp = compareFor(segmentKeyTypeOf(c.type)!);
                const total = dict ? new SortedMap<unknown, unknown>(undefined, cmp) : new SortedSet<unknown>(undefined, cmp);
                const expected: Uint8Array[] = [];
                for (let start = 0; start < c.elements.length; start += RUN_MAX_COUNT) {
                    const run = dict ? new SortedMap<unknown, unknown>(undefined, cmp) : new SortedSet<unknown>(undefined, cmp);
                    for (const element of c.elements.slice(start, start + RUN_MAX_COUNT)) {
                        if (run instanceof SortedMap) {
                            const { key, value } = element as { key: unknown; value: unknown };
                            run.set(key, run.has(key) ? apply!(key, run.get(key), value) : value);
                        } else {
                            run.add(element);
                        }
                    }
                    expected.push(encodeBeast2PagedFor(c.type)(run as never));
                    if (run instanceof SortedMap && total instanceof SortedMap) {
                        for (const [key, value] of run) total.set(key, total.has(key) ? apply!(key, total.get(key), value) : value);
                    } else if (run instanceof SortedSet && total instanceof SortedSet) {
                        for (const element of run) total.add(element);
                    }
                }
                assert.equal(closed.length, expected.length, "runs closed");
                closed.forEach((run, i) => assert.deepEqual(run, expected[i], `run ${i}`));

                const chunks: Uint8Array[] = [];
                mergeBeast2For(c.type, {
                    ...(apply !== undefined && { merge: apply }),
                    ...(c.union !== undefined && { union: c.union }),
                })(closed, (bytes) => { chunks.push(bytes.slice()); });
                const merged = new Uint8Array(Buffer.concat(chunks));
                assert.deepEqual(merged, encodeBeast2PagedFor(c.type)(total as never), "the runs merged");

                runsCases.push({
                    name: c.name,
                    elements: encodeBeast2For(c.sequence)(c.elements as never),
                    merge: c.merge === undefined ? none : some(encodeEastIR(c.merge)),
                    union: c.union ?? false,
                    runs: closed,
                    merged,
                });
            });
        }
    });

    describe("merges", () => {
        for (const c of merges) {
            test(c.name, () => {
                const apply = c.merge?.compile([]) as Fold3 | undefined;
                const from = c.range?.from.type === "some" ? c.range.from.value : undefined;
                const to = c.range?.to.type === "some" ? c.range.to.value : undefined;
                const merge = mergeBeast2For(c.type, {
                    ...(apply !== undefined && { merge: apply }),
                    ...(c.union !== undefined && { union: c.union }),
                    ...(from !== undefined && { from }),
                    ...(to !== undefined && { to }),
                });
                const chunks: Uint8Array[] = [];
                merge(c.inputs, (bytes) => { chunks.push(bytes.slice()); });
                const expected = new Uint8Array(Buffer.concat(chunks));
                const objects = new Map<string, Uint8Array>();
                let manifest = null as Uint8Array | null;
                merge(c.inputs, {
                    object: (hash, bytes) => { objects.set(hash, bytes); },
                    manifest: (bytes) => { manifest = bytes; },
                });
                assert.ok(manifest !== null, "the manifest was written");
                const entries = decodeCollectionManifest(manifest).entries;
                assert.deepEqual(spliceBeast2(entries.map((entry) => objects.get(entry.hash)!)), expected, "the manifest's objects spliced");

                // The oracle: every input's keys in the range, folded across
                // the inputs in input order.
                const dict = c.type.type === "Dict";
                const cmp = compareFor(c.keyType);
                const total = dict ? new SortedMap<unknown, unknown>(undefined, cmp) : new SortedSet<unknown>(undefined, cmp);
                for (const input of c.inputs) {
                    const decoded = decodeBeast2For(c.type)(input) as Map<unknown, unknown> | Set<unknown>;
                    for (const entry of decoded instanceof SortedMap ? decoded.entries() : (decoded as Set<unknown>).values()) {
                        const key = dict ? (entry as [unknown, unknown])[0] : entry;
                        if ((from !== undefined && cmp(key as never, from as never) < 0) || (to !== undefined && cmp(key as never, to as never) >= 0)) continue;
                        if (total instanceof SortedMap) {
                            const value = (entry as [unknown, unknown])[1];
                            total.set(key, total.has(key) ? apply!(key, total.get(key), value) : value);
                        } else {
                            total.add(key);
                        }
                    }
                }
                assert.deepEqual(expected, encodeBeast2PagedFor(c.type)(total as never), "the inputs merged");

                mergeCases.push({
                    name: c.name,
                    inputs: c.inputs,
                    merge: c.merge === undefined ? none : some(encodeEastIR(c.merge)),
                    union: c.union ?? false,
                    range: c.range === undefined ? none : some(encodeBeast2For(StructType({ from: OptionType(c.keyType), to: OptionType(c.keyType) }))(c.range as never)),
                    expected,
                    manifest,
                });
            });
        }
    });
});
