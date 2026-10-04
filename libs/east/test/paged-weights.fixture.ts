/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared fixture of decoded weights (#1129): a value of every kind, each
 * the one element of an indexed Array of one segment, beside the decoded
 * weight `src/serialization/beast2/v5/SPEC.md` ("The pager's cache") gives it.
 *
 * A pager's cache counts what it holds in decoded weight, a number defined on
 * the values so that every runtime gives a segment the same one. east-c,
 * east-py and TypeScript each read `test/fixtures/paged-weights.beast2`, open
 * every case's blob in a pager, read its element through the pager's cache,
 * and hold what the cache then weighs to the case's weight and
 * {@link SEGMENT_OF_ONE}, the Array around it. The weights here are written
 * out by hand from the table, so the fixture is the table's own statement of
 * them rather than any runtime's. `make paged-weights` rewrites the file.
 */

import {
  ArrayType, BlobType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, MatrixType, NullType,
  OptionType, RecursiveType, RefType, SetType, SortedMap, SortedSet, StringType, StructType, VariantType, VectorType,
  compareFor, encodeBeast2For, encodeBeast2PagedFor, matrix, none, ref, setLocationCapture, some, variant,
  type EastType, type ValueTypeOf,
} from "../src/index.js";

/** A case: what it holds, the blob holding it, and the weight of its value. */
export const PagedWeightCase = StructType({
  name: StringType,
  /** An indexed, self-contained Array of one segment, whose one element is the value. */
  blob: BlobType,
  /** The value's decoded weight, without the Array around it. */
  weight: IntegerType,
});

/** The fixture: every case, in the order a reader reports them. */
export const PagedWeightsFixture = ArrayType(PagedWeightCase);

/**
 * What the one-segment Array around each case's value weighs: an Array's node
 * (104) and the one slot it holds the value in (8).
 */
export const SEGMENT_OF_ONE = 104n + 8n;

/**
 * A case of the fixture.
 *
 * @param name - what the case holds
 * @param type - the value's type
 * @param value - the value
 * @param weight - its decoded weight, from the table
 * @returns the case, its value written as the one element of an indexed Array
 */
function weighed<T extends EastType>(name: string, type: T, value: ValueTypeOf<T>, weight: bigint): ValueTypeOf<typeof PagedWeightCase> {
  return { name, blob: encodeBeast2PagedFor(ArrayType(type))([value]), weight };
}

/**
 * `n` integers from 0, as a Set.
 *
 * @param n - how many
 * @returns the Set
 */
function integerSet(n: number): SortedSet<bigint> {
  return new SortedSet(Array.from({ length: n }, (_, i) => BigInt(i)), compareFor(IntegerType));
}

/**
 * `n` integers from 0, each to its double, as a Dict.
 *
 * @param n - how many entries
 * @returns the Dict
 */
function integerDict(n: number): SortedMap<bigint, bigint> {
  return new SortedMap(Array.from({ length: n }, (_, i): [bigint, bigint] => [BigInt(i), BigInt(2 * i)]), compareFor(IntegerType));
}

/**
 * A function of one Integer, built without source locations so that its
 * bytes do not depend on where the fixture is generated.
 *
 * @returns the compiled function, carrying its IR
 */
function increment(): (x: bigint) => bigint {
  setLocationCapture(false);
  try {
    return East.compile(East.function([IntegerType], IntegerType, ($, x) => x.add(1n)), []);
  } finally {
    setLocationCapture(true);
  }
}

/**
 * A function of no arguments that captures `list` and returns its size, built
 * without source locations, as {@link increment} is.
 *
 * @param list - the Array the function captures: the same object, not a copy
 * @returns the compiled function, carrying its IR and its capture
 */
function sizeOf(list: bigint[]): () => bigint {
  setLocationCapture(false);
  try {
    const make = East.compile(East.function([ArrayType(IntegerType)], FunctionType([], IntegerType), ($, xs) => East.function([], IntegerType, (_$) => xs.size())), []);
    return make(list);
  } finally {
    setLocationCapture(true);
  }
}

/** A list of integers: `nil`, or a head and the rest. */
const List = RecursiveType(self => VariantType({ cons: StructType({ head: IntegerType, tail: self }), nil: NullType }));

/** A struct of two arrays, which a case fills with one array twice. */
const Pair = StructType({ a: ArrayType(IntegerType), b: ArrayType(IntegerType) });

/** A function, then an array: a case fills them with a function that captures
 *  the array, so the blob holds the array inside the function and a REF to it
 *  after. */
const FunctionThenArray = StructType({ f: FunctionType([], IntegerType), a: ArrayType(IntegerType) });

/** An array, then a function that captures it, so the blob holds the array
 *  first and a REF to it inside the function. */
const ArrayThenFunction = StructType({ a: ArrayType(IntegerType), f: FunctionType([], IntegerType) });

/**
 * The fixture's cases: every kind of value, a String on each side of the 47
 * bytes held in a node, in characters of one, two, three and four bytes, and
 * a Set and a Dict on each side of the 256 elements held in arrays alone.
 *
 * @returns the cases
 */
export function pagedWeightCases(): ValueTypeOf<typeof PagedWeightCase>[] {
  const shared = [1n, 2n];
  const captured = [1n, 2n];
  const counter = sizeOf(captured);
  return [
    weighed("Null", NullType, null, 0n),
    weighed("Boolean", BooleanType, true, 16n),
    weighed("Integer", IntegerType, 7n, 16n),
    weighed("Float", FloatType, 2.5, 16n),
    weighed("DateTime", DateTimeType, new Date(0), 16n),
    weighed("String, empty", StringType, "", 72n),
    weighed("String of 47 bytes", StringType, "a".repeat(47), 72n),
    weighed("String of 48 bytes", StringType, "a".repeat(48), 72n + 48n + 1n),
    weighed("String of 24 two-byte characters (48 bytes)", StringType, "é".repeat(24), 72n + 48n + 1n),
    weighed("String of 15 three-byte characters (45 bytes)", StringType, "€".repeat(15), 72n),
    weighed("String of 16 three-byte characters (48 bytes)", StringType, "€".repeat(16), 72n + 48n + 1n),
    weighed("String of 12 four-byte characters (48 bytes)", StringType, "😀".repeat(12), 72n + 48n + 1n),
    weighed("Blob, empty", BlobType, new Uint8Array(0), 24n),
    weighed("Blob of 100 bytes", BlobType, new Uint8Array(100).fill(7), 24n + 100n),
    weighed("Array, empty", ArrayType(IntegerType), [], 104n),
    weighed("Array of three Integers", ArrayType(IntegerType), [1n, 2n, 3n], 104n + 3n * 8n + 3n * 16n),
    weighed("Set of 256 Integers", SetType(IntegerType), integerSet(256), 104n + 256n * 8n + 256n * 16n),
    weighed("Set of 257 Integers", SetType(IntegerType), integerSet(257), 104n + 257n * 16n + 257n * 16n),
    weighed("Dict of 256 Integers to Integers", DictType(IntegerType, IntegerType), integerDict(256), 104n + 256n * 16n + 256n * 32n),
    weighed("Dict of 257 Integers to Integers", DictType(IntegerType, IntegerType), integerDict(257), 104n + 257n * 32n + 257n * 32n),
    weighed("Struct, empty", StructType({}), {}, 104n),
    weighed("Struct of an Integer and a String", StructType({ a: IntegerType, b: StringType }), { a: 1n, b: "x" }, 104n + 2n * 8n + 16n + 72n),
    weighed("Variant, a case with no payload", OptionType(IntegerType), none, 0n),
    weighed("Variant, a case with a payload", OptionType(IntegerType), some(5n), 104n + 16n),
    weighed("Ref of an Integer", RefType(IntegerType), ref(3n), 104n + 16n),
    weighed("Vector of three Floats", VectorType(FloatType), new Float64Array([1, 2, 3]), 40n + 3n * 8n),
    weighed("Vector of two Integers", VectorType(IntegerType), new BigInt64Array([1n, 2n]), 40n + 2n * 8n),
    weighed("Vector of three Booleans", VectorType(BooleanType), new Uint8ClampedArray([1, 0, 1]), 40n + 3n),
    weighed("Matrix of 2 × 3 Floats", MatrixType(FloatType), matrix(new Float64Array(6).fill(1.5), 2, 3), 48n + 6n * 8n),
    weighed("Matrix of 2 × 2 Booleans", MatrixType(BooleanType), matrix(new Uint8ClampedArray([1, 0, 0, 1]), 2, 2), 48n + 4n),
    weighed("Function", FunctionType([IntegerType], IntegerType), increment(), 360n),
    // A function weighs 360 whatever it holds, and a container counts where
    // the value first meets it: an Array first met in a function's captures
    // counts nowhere, though the Struct's next field meets it again (the
    // Struct, 120, and the function); one the Struct meets first counts there
    // (the Struct, the Array, 104 + 2 × 8 with its two Integers, and the
    // function).
    weighed("Struct of a Function capturing an Array, then the Array", FunctionThenArray, { f: counter, a: captured }, 120n + 360n),
    weighed("Struct of an Array, then a Function capturing it", ArrayThenFunction, { a: captured, f: counter }, 120n + 104n + 2n * 8n + 2n * 16n + 360n),
    // cons(1, cons(2, nil)): two Variants of 104, each a Struct of two fields
    // (120) and its head (16); nil has no payload.
    weighed("Recursive list of two", List, variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil", null) }) }), 2n * (104n + 120n + 16n)),
    // One Array met twice through a REF is one Array: the Struct (120), and the
    // Array (104 + 2 × 8) with its two Integers, once.
    weighed("Struct holding one Array twice", Pair, { a: shared, b: shared }, 120n + 104n + 2n * 8n + 2n * 16n),
  ];
}

/**
 * Encodes the fixture as `test/fixtures/paged-weights.beast2` holds it:
 * self-describing beast2, so a reader needs no type of its own.
 *
 * @returns the fixture's bytes
 */
export function pagedWeightsBytes(): Uint8Array {
  return encodeBeast2For(PagedWeightsFixture)(pagedWeightCases());
}
