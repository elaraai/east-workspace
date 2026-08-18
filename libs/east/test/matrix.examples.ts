/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, FloatType, VectorType, IntegerType, example } from "@elaraai/east";

// ---------------------------------------------------------------------------
// Matrix Creation
// ---------------------------------------------------------------------------

export const matrixZeros = example({
    keywords: ["matrix", "MatrixType", "zeros", "create", "float"],
    description: "Create a matrix of zeros",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.zeros(2n, 3n));
        return m.get(0n, 0n);
    }),
    inputs: [],
    returns: 0.0,
});

export const matrixOnes = example({
    keywords: ["matrix", "MatrixType", "ones", "create", "float"],
    description: "Create a matrix of ones",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.ones(2n, 2n));
        return m.get(1n, 1n);
    }),
    inputs: [],
    returns: 1.0,
});

export const matrixFill = example({
    keywords: ["matrix", "MatrixType", "fill", "create", "value"],
    description: "Create a matrix filled with a specific value",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fill(2n, 3n, 5.0));
        return m.get(1n, 2n);
    }),
    inputs: [],
    returns: 5.0,
});

export const matrixFromArray = example({
    keywords: ["matrix", "MatrixType", "fromArray", "create", "nested"],
    description: "Create a matrix from a nested array",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        return m.get(1n, 2n);
    }),
    inputs: [],
    returns: 6.0,
});

export const matrixFromRows = example({
    keywords: ["matrix", "MatrixType", "fromRows", "create", "vector"],
    description: "Create a matrix from an array of row vectors",
    fn: East.function([], FloatType, ($) => {
        const rows = $.let([], ArrayType(VectorType(FloatType)));
        $(rows.pushLast(East.Vector.fromArray([1.0, 2.0, 3.0])));
        $(rows.pushLast(East.Vector.fromArray([4.0, 5.0, 6.0])));
        const m = $.let(East.Matrix.fromRows(rows));
        return m.get(1n, 2n);
    }),
    inputs: [],
    returns: 6.0,
});

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const matrixRows = example({
    keywords: ["matrix", "MatrixType", "rows", "dimensions", "height"],
    description: "Get the number of rows in a matrix",
    fn: East.function([], IntegerType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        return m.rows();
    }),
    inputs: [],
    returns: 2n,
});

export const matrixCols = example({
    keywords: ["matrix", "MatrixType", "cols", "dimensions", "width"],
    description: "Get the number of columns in a matrix",
    fn: East.function([], IntegerType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        return m.cols();
    }),
    inputs: [],
    returns: 3n,
});

// ---------------------------------------------------------------------------
// Element Access
// ---------------------------------------------------------------------------

export const matrixGet = example({
    keywords: ["matrix", "MatrixType", "get", "element", "access"],
    description: "Get an element from a matrix by row and column index",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        return m.get(1n, 0n);
    }),
    inputs: [],
    returns: 3.0,
});

export const matrixSet = example({
    keywords: ["matrix", "MatrixType", "set", "element", "immutable", "functional"],
    description: "Set an element in a matrix by row and column index, returning a new matrix",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.zeros(2n, 2n));
        const m2 = $.let(m.set(0n, 1n, 42.0));
        return m2.get(0n, 1n);
    }),
    inputs: [],
    returns: 42.0,
});

// ---------------------------------------------------------------------------
// Row and Column Access
// ---------------------------------------------------------------------------

export const matrixGetRow = example({
    keywords: ["matrix", "MatrixType", "getRow", "row", "vector"],
    description: "Get a row from a matrix as a vector",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        const row = $.let(m.getRow(1n));
        return row.get(2n);
    }),
    inputs: [],
    returns: 6.0,
});

export const matrixGetCol = example({
    keywords: ["matrix", "MatrixType", "getCol", "column", "vector"],
    description: "Get a column from a matrix as a vector",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        const col = $.let(m.getCol(0n));
        return col.get(1n);
    }),
    inputs: [],
    returns: 4.0,
});

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export const matrixTranspose = example({
    keywords: ["matrix", "MatrixType", "transpose", "transform", "swap"],
    description: "Transpose a matrix (swap rows and columns)",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        const t = $.let(m.transpose());
        return t.get(2n, 1n);
    }),
    inputs: [],
    returns: 6.0,
});

export const matrixToVector = example({
    keywords: ["matrix", "MatrixType", "toVector", "flatten", "vector"],
    description: "Flatten a matrix into a vector (row-major order)",
    fn: East.function([], IntegerType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const v = $.let(m.toVector());
        return v.length();
    }),
    inputs: [],
    returns: 4n,
});

export const matrixToArray = example({
    keywords: ["matrix", "MatrixType", "toArray", "convert", "nested"],
    description: "Convert a matrix to a nested array",
    fn: East.function([], ArrayType(ArrayType(FloatType)), ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        return m.toArray();
    }),
    inputs: [],
    returns: [[1.0, 2.0], [3.0, 4.0]],
});

export const matrixToRows = example({
    keywords: ["matrix", "MatrixType", "toRows", "convert", "vectors"],
    description: "Convert a matrix to an array of row vectors",
    fn: East.function([], IntegerType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        const rows = $.let(m.toRows());
        return rows.length();
    }),
    inputs: [],
    returns: 2n,
});

export const matrixMapRows = example({
    keywords: ["matrix", "MatrixType", "mapRows", "transform", "row"],
    description: "Transform each row of a matrix with a mapping function",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const result = $.let(m.mapRows(($, row) => row.map(($, x) => x.multiply(10.0))));
        return result.get(1n, 1n);
    }),
    inputs: [],
    returns: 40.0,
});

// ---------------------------------------------------------------------------
// Elementwise Arithmetic and Reductions
// ---------------------------------------------------------------------------

export const matrixScale = example({
    keywords: ["matrix", "MatrixType", "scale", "multiply", "scalar", "elementwise"],
    description: "Scale every matrix element by a scalar",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const scaled = $.let(m.scale(2.0));
        return scaled.get(1n, 0n);
    }),
    inputs: [],
    returns: 6.0,
});

export const matrixAddScaled = example({
    keywords: ["matrix", "MatrixType", "addScaled", "axpy", "add", "elementwise"],
    description: "Add a scaled matrix elementwise (a + alpha * b)",
    fn: East.function([], FloatType, ($) => {
        const a = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const b = $.let(East.Matrix.fromArray([[10.0, 20.0], [30.0, 40.0]]));
        const result = $.let(a.addScaled(b, 0.5));
        return result.get(0n, 1n);
    }),
    inputs: [],
    returns: 12.0,
});

export const matrixMulElementwise = example({
    keywords: ["matrix", "MatrixType", "mulElementwise", "multiply", "hadamard", "elementwise"],
    description: "Multiply two matrices elementwise",
    fn: East.function([], FloatType, ($) => {
        const a = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const b = $.let(East.Matrix.fromArray([[5.0, 6.0], [7.0, 8.0]]));
        const result = $.let(a.mulElementwise(b));
        return result.get(1n, 1n);
    }),
    inputs: [],
    returns: 32.0,
});

export const matrixRowSums = example({
    keywords: ["matrix", "MatrixType", "rowSums", "sum", "reduction", "row"],
    description: "Sum each matrix row into a vector",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        const sums = $.let(m.rowSums());
        return sums.get(1n);
    }),
    inputs: [],
    returns: 15.0,
});

export const matrixColSums = example({
    keywords: ["matrix", "MatrixType", "colSums", "sum", "reduction", "column"],
    description: "Sum each matrix column into a vector",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]));
        const sums = $.let(m.colSums());
        return sums.get(2n);
    }),
    inputs: [],
    returns: 9.0,
});

export const matrixVecMul = example({
    keywords: ["matrix", "MatrixType", "vecMul", "multiply", "vector", "gemv"],
    description: "Multiply a matrix by a vector",
    fn: East.function([], FloatType, ($) => {
        const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const v = $.let(East.Vector.fromArray([10.0, 20.0]));
        const result = $.let(m.vecMul(v));
        return result.get(1n);
    }),
    inputs: [],
    returns: 110.0,
});
