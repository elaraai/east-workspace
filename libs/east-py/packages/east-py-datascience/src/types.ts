/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared type definitions for East Data Science.
 *
 * Provides common East type definitions used across data science modules
 * including vectors, matrices, and scalar function types.
 *
 * @packageDocumentation
 */

import {
    FloatType,
    FunctionType,
    VectorType,
} from "@elaraai/east";

// Re-export commonly used types for convenience
export {
    ArrayType,
    StructType,
    VariantType,
    OptionType,
    FloatType,
    IntegerType,
    BooleanType,
    StringType,
    FunctionType,
    VectorType,
    MatrixType,
} from "@elaraai/east";

/**
 * Scalar objective function type: Vector<Float> -> Float.
 *
 * Used for optimization objectives, constraints, and loss functions
 * that take a vector of decision variables and return a scalar value.
 *
 * @example
 * ```ts
 * const sumSquares = East.function([VectorType(FloatType)], FloatType, ($, x) => {
 *     return x.reduce((acc, xi) => acc.add(xi.multiply(xi)), East.value(0.0));
 * });
 * ```
 */
export const ScalarObjectiveType = FunctionType([VectorType(FloatType)], FloatType);

/**
 * Vector objective function type: Vector<Float> -> Vector<Float>.
 *
 * Used for multi-output predictions and transformations.
 *
 * @example
 * ```ts
 * const predict = East.function([VectorType(FloatType)], VectorType(FloatType), ($, x) => {
 *     // Return multiple predictions
 *     return $.return([...]);
 * });
 * ```
 */
export const VectorObjectiveType = FunctionType([VectorType(FloatType)], VectorType(FloatType));
