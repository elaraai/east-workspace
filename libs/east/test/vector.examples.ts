/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, BooleanType, FloatType, IntegerType, example } from "@elaraai/east";

// ---------------------------------------------------------------------------
// Vector Creation
// ---------------------------------------------------------------------------

export const vectorZeros = example({
    keywords: ["vector", "VectorType", "zeros", "create", "float"],
    description: "Create a vector of zeros",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.zeros(3n));
        return v.get(0n);
    }),
    inputs: [],
    returns: 0.0,
});

export const vectorOnes = example({
    keywords: ["vector", "VectorType", "ones", "create", "float"],
    description: "Create a vector of ones",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.ones(3n));
        return v.get(1n);
    }),
    inputs: [],
    returns: 1.0,
});

export const vectorFill = example({
    keywords: ["vector", "VectorType", "fill", "create", "value"],
    description: "Create a vector filled with a specific value",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fill(4n, 3.14));
        return v.get(0n);
    }),
    inputs: [],
    returns: 3.14,
});

export const vectorFromArray = example({
    keywords: ["vector", "VectorType", "fromArray", "create", "convert"],
    description: "Create a vector from an array",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        return v.get(2n);
    }),
    inputs: [],
    returns: 3.0,
});

// ---------------------------------------------------------------------------
// Dimensions and Element Access
// ---------------------------------------------------------------------------

export const vectorLength = example({
    keywords: ["vector", "VectorType", "length", "size", "count"],
    description: "Get the length of a vector",
    fn: East.function([], IntegerType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        return v.length();
    }),
    inputs: [],
    returns: 3n,
});

export const vectorGet = example({
    keywords: ["vector", "VectorType", "get", "element", "access"],
    description: "Get an element from a vector by index",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([10.0, 20.0, 30.0]));
        return v.get(1n);
    }),
    inputs: [],
    returns: 20.0,
});

export const vectorSet = example({
    keywords: ["vector", "VectorType", "set", "element", "immutable", "functional"],
    description: "Set an element in a vector by index, returning a new vector",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.zeros(3n));
        const v2 = $.let(v.set(1n, 42.0));
        return v2.get(1n);
    }),
    inputs: [],
    returns: 42.0,
});

// ---------------------------------------------------------------------------
// Slicing and Concatenation
// ---------------------------------------------------------------------------

export const vectorSlice = example({
    keywords: ["vector", "VectorType", "slice", "subvector", "range"],
    description: "Slice a vector to get a sub-range",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0, 4.0, 5.0]));
        const s = $.let(v.slice(1n, 4n));
        return s.get(0n);
    }),
    inputs: [],
    returns: 2.0,
});

export const vectorConcat = example({
    keywords: ["vector", "VectorType", "concat", "join", "combine"],
    description: "Concatenate two vectors",
    fn: East.function([], IntegerType, ($) => {
        const a = $.let(East.Vector.fill(2n, 1.0));
        const b = $.let(East.Vector.fill(3n, 2.0));
        const c = $.let(a.concat(b));
        return c.length();
    }),
    inputs: [],
    returns: 5n,
});

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export const vectorToArray = example({
    keywords: ["vector", "VectorType", "toArray", "convert", "array"],
    description: "Convert a vector to an array",
    fn: East.function([], ArrayType(FloatType), ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        return v.toArray();
    }),
    inputs: [],
    returns: [1.0, 2.0, 3.0],
});

export const vectorToMatrix = example({
    keywords: ["vector", "VectorType", "toMatrix", "reshape", "matrix"],
    description: "Reshape a vector into a matrix",
    fn: East.function([], IntegerType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]));
        const m = $.let(v.toMatrix(2n, 3n));
        return m.rows();
    }),
    inputs: [],
    returns: 2n,
});

// ---------------------------------------------------------------------------
// Map and Reduce
// ---------------------------------------------------------------------------

export const vectorMap = example({
    keywords: ["vector", "VectorType", "map", "transform", "element"],
    description: "Map over vector elements with a transformation function",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        const doubled = $.let(v.map(($, x) => x.multiply(2.0)));
        return doubled.get(1n);
    }),
    inputs: [],
    returns: 4.0,
});

export const vectorReduce = example({
    keywords: ["vector", "VectorType", "reduce", "fold", "accumulate"],
    description: "Reduce a vector to a single value with an accumulator",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0, 4.0]));
        return v.reduce(($, acc, val) => acc.add(val), 0.0);
    }),
    inputs: [],
    returns: 10.0,
});

// ---------------------------------------------------------------------------
// Elementwise Arithmetic
// ---------------------------------------------------------------------------

export const vectorScale = example({
    keywords: ["vector", "VectorType", "scale", "multiply", "scalar", "elementwise"],
    description: "Scale every vector element by a scalar",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        const scaled = $.let(v.scale(2.0));
        return scaled.get(1n);
    }),
    inputs: [],
    returns: 4.0,
});

export const vectorSum = example({
    keywords: ["vector", "VectorType", "sum", "reduction", "total"],
    description: "Sum vector elements in index order",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.5, 2.5, 3.0]));
        return v.sum();
    }),
    inputs: [],
    returns: 7.0,
});

export const vectorAddScaled = example({
    keywords: ["vector", "VectorType", "addScaled", "axpy", "add", "elementwise"],
    description: "Add a scaled vector elementwise (a + alpha * b)",
    fn: East.function([], FloatType, ($) => {
        const a = $.let(East.Vector.fromArray([1.0, 2.0]));
        const b = $.let(East.Vector.fromArray([10.0, 20.0]));
        const result = $.let(a.addScaled(b, 2.0));
        return result.get(1n);
    }),
    inputs: [],
    returns: 42.0,
});

export const vectorMul = example({
    keywords: ["vector", "VectorType", "mul", "multiply", "elementwise", "product"],
    description: "Multiply two vectors elementwise",
    fn: East.function([], FloatType, ($) => {
        const a = $.let(East.Vector.fromArray([2.0, 3.0]));
        const b = $.let(East.Vector.fromArray([4.0, 5.0]));
        const result = $.let(a.mul(b));
        return result.get(0n);
    }),
    inputs: [],
    returns: 8.0,
});

export const vectorAddScalar = example({
    keywords: ["vector", "VectorType", "addScalar", "add", "offset", "elementwise"],
    description: "Add a scalar to every vector element",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0]));
        const result = $.let(v.addScalar(0.5));
        return result.get(0n);
    }),
    inputs: [],
    returns: 1.5,
});

export const vectorDot = example({
    keywords: ["vector", "VectorType", "dot", "product", "reduction", "inner"],
    description: "Compute the dot product of two vectors",
    fn: East.function([], FloatType, ($) => {
        const a = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        const b = $.let(East.Vector.fromArray([4.0, 5.0, 6.0]));
        return a.dot(b);
    }),
    inputs: [],
    returns: 32.0,
});

export const vectorMax = example({
    keywords: ["vector", "VectorType", "max", "maximum", "reduction"],
    description: "Find the largest vector element",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 5.0, 3.0]));
        return v.max();
    }),
    inputs: [],
    returns: 5.0,
});

export const vectorMin = example({
    keywords: ["vector", "VectorType", "min", "minimum", "reduction"],
    description: "Find the smallest vector element",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([4.0, 2.0, 9.0]));
        return v.min();
    }),
    inputs: [],
    returns: 2.0,
});

export const vectorArgMax = example({
    keywords: ["vector", "VectorType", "argMax", "argmax", "index", "maximum"],
    description: "Find the index of the largest vector element",
    fn: East.function([], IntegerType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 5.0, 3.0]));
        return v.argMax();
    }),
    inputs: [],
    returns: 1n,
});

export const vectorArgMin = example({
    keywords: ["vector", "VectorType", "argMin", "argmin", "index", "minimum"],
    description: "Find the index of the smallest vector element",
    fn: East.function([], IntegerType, ($) => {
        const v = $.let(East.Vector.fromArray([4.0, 2.0, 9.0]));
        return v.argMin();
    }),
    inputs: [],
    returns: 1n,
});

export const vectorMean = example({
    keywords: ["vector", "VectorType", "mean", "average", "reduction"],
    description: "Compute the arithmetic mean of a vector as a Float",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0, 4.0]));
        return v.mean();
    }),
    inputs: [],
    returns: 2.5,
});

export const vectorCumSum = example({
    keywords: ["vector", "VectorType", "cumSum", "cumulative", "running", "prefix"],
    description: "Compute the running sum of a vector",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        const sums = $.let(v.cumSum());
        return sums.get(2n);
    }),
    inputs: [],
    returns: 6.0,
});

export const vectorAbs = example({
    keywords: ["vector", "VectorType", "abs", "absolute", "magnitude", "elementwise"],
    description: "Take the absolute value of every vector element",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([-1.5, 2.0]));
        const result = $.let(v.abs());
        return result.get(0n);
    }),
    inputs: [],
    returns: 1.5,
});

export const vectorClamp = example({
    keywords: ["vector", "VectorType", "clamp", "bound", "limit", "elementwise"],
    description: "Clamp every vector element between bounds",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([-1.0, 0.5, 2.0]));
        const result = $.let(v.clamp(0.0, 1.0));
        return result.get(2n);
    }),
    inputs: [],
    returns: 1.0,
});

// ---------------------------------------------------------------------------
// Gather, Scatter and Sorted Search
// ---------------------------------------------------------------------------

export const vectorGather = example({
    keywords: ["vector", "VectorType", "gather", "index", "permute", "lookup"],
    description: "Gather vector elements at the given indices",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([10.0, 20.0, 30.0]));
        const gathered = $.let(v.gather(new BigInt64Array([2n, 0n])));
        return gathered.get(0n);
    }),
    inputs: [],
    returns: 30.0,
});

export const vectorScatterAdd = example({
    keywords: ["vector", "VectorType", "scatterAdd", "scatter", "accumulate", "deposit"],
    description: "Add source values into a vector at the given indices",
    fn: East.function([], FloatType, ($) => {
        const dst = $.let(East.Vector.zeros(3n));
        const result = $.let(dst.scatterAdd(new BigInt64Array([1n, 1n]), new Float64Array([2.0, 3.0])));
        return result.get(1n);
    }),
    inputs: [],
    returns: 5.0,
});

export const vectorSearchSorted = example({
    keywords: ["vector", "VectorType", "searchSorted", "searchsorted", "binary", "search", "insertion"],
    description: "Find the sorted insertion index for each needle",
    fn: East.function([], IntegerType, ($) => {
        const haystack = $.let(East.Vector.fromArray([10.0, 20.0, 30.0]));
        const found = $.let(haystack.searchSorted(new Float64Array([25.0])));
        return found.get(0n);
    }),
    inputs: [],
    returns: 2n,
});

// ---------------------------------------------------------------------------
// Masks and Selection
// ---------------------------------------------------------------------------

export const vectorEq = example({
    keywords: ["vector", "VectorType", "eq", "equal", "mask", "comparison", "elementwise"],
    description: "Compare two vectors elementwise for equality",
    fn: East.function([], IntegerType, ($) => {
        const a = $.let(East.Vector.fromArray([1.0, 2.0, 3.0]));
        const mask = $.let(a.eq(new Float64Array([1.0, 5.0, 3.0])));
        return mask.countTrue();
    }),
    inputs: [],
    returns: 2n,
});

export const vectorLt = example({
    keywords: ["vector", "VectorType", "lt", "less", "mask", "comparison", "elementwise"],
    description: "Compare two vectors elementwise with less-than",
    fn: East.function([], BooleanType, ($) => {
        const a = $.let(East.Vector.fromArray([1.0, 5.0]));
        const mask = $.let(a.lt(new Float64Array([2.0, 2.0])));
        return mask.get(0n);
    }),
    inputs: [],
    returns: true,
});

export const vectorGt = example({
    keywords: ["vector", "VectorType", "gt", "greater", "mask", "comparison", "elementwise"],
    description: "Compare two vectors elementwise with greater-than",
    fn: East.function([], BooleanType, ($) => {
        const a = $.let(East.Vector.fromArray([1.0, 5.0]));
        const mask = $.let(a.gt(new Float64Array([2.0, 2.0])));
        return mask.get(1n);
    }),
    inputs: [],
    returns: true,
});

export const vectorSelect = example({
    keywords: ["vector", "VectorType", "select", "mask", "where", "blend", "elementwise"],
    description: "Select elements from two vectors using a Boolean mask",
    fn: East.function([], FloatType, ($) => {
        const mask = $.let(East.Vector.fromArray([true, false]));
        const a = $.let(East.Vector.fromArray([1.0, 2.0]));
        const b = $.let(East.Vector.fromArray([10.0, 20.0]));
        const result = $.let(mask.select(a, b));
        return result.get(1n);
    }),
    inputs: [],
    returns: 20.0,
});

export const vectorCompress = example({
    keywords: ["vector", "VectorType", "compress", "filter", "mask", "keep"],
    description: "Keep the vector elements where the mask is true",
    fn: East.function([], FloatType, ($) => {
        const v = $.let(East.Vector.fromArray([1.0, 2.0, 3.0, 4.0]));
        const kept = $.let(v.compress(East.Vector.fromArray([true, false, true, false])));
        return kept.get(1n);
    }),
    inputs: [],
    returns: 3.0,
});

export const vectorCountTrue = example({
    keywords: ["vector", "VectorType", "countTrue", "count", "mask", "boolean"],
    description: "Count the true elements of a Boolean vector",
    fn: East.function([], IntegerType, ($) => {
        const mask = $.let(East.Vector.fromArray([true, false, true]));
        return mask.countTrue();
    }),
    inputs: [],
    returns: 2n,
});

// ---------------------------------------------------------------------------
// Sparse Accumulators
// ---------------------------------------------------------------------------

export const vectorSparseAxpy = example({
    keywords: ["vector", "VectorType", "sparseAxpy", "sparse", "axpy", "merge", "accumulator", "union"],
    description: "Merge two sparse accumulators with a scaled right-hand side",
    fn: East.function([], FloatType, ($) => {
        const merged = $.let(East.Vector.sparseAxpy(
            new BigInt64Array([0n, 2n]), new Float64Array([1.0, 2.0]),
            new BigInt64Array([1n, 2n]), new Float64Array([10.0, 20.0]),
            0.5,
        ));
        return merged.v.get(1n);
    }),
    inputs: [],
    returns: 5.0,
});

export const vectorSparseFromPairs = example({
    keywords: ["vector", "VectorType", "sparseFromPairs", "sparse", "construct", "pairs", "accumulate"],
    description: "Build a sparse accumulator from unsorted index and value pairs",
    fn: East.function([], FloatType, ($) => {
        const sparse = $.let(East.Vector.sparseFromPairs(
            new BigInt64Array([2n, 0n, 2n]), new Float64Array([1.0, 2.0, 3.0]),
        ));
        return sparse.v.get(1n);
    }),
    inputs: [],
    returns: 4.0,
});

export const vectorSparseFilterGt = example({
    keywords: ["vector", "VectorType", "sparseFilterGt", "sparse", "filter", "threshold", "compact"],
    description: "Drop sparse accumulator entries at or below a threshold",
    fn: East.function([], IntegerType, ($) => {
        const filtered = $.let(East.Vector.sparseFilterGt(
            new BigInt64Array([0n, 1n, 2n]), new Float64Array([0.5, 2.0, 0.1]), 1.0,
        ));
        return filtered.ix.get(0n);
    }),
    inputs: [],
    returns: 1n,
});
