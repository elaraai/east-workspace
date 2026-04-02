/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MADS (Mesh Adaptive Direct Search) derivative-free optimization.
 *
 * Provides blackbox optimization using the NOMAD MADS algorithm via PyNomadBBO.
 * MADS is designed for difficult optimization problems where:
 * - Functions have no exploitable derivatives
 * - Evaluations are computationally expensive
 * - Functions may be contaminated by noise
 * - Functions may fail for some feasible points
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    IntegerType,
    BooleanType,
    FloatType,
    NullType,
} from "@elaraai/east";
import { VectorType, ScalarObjectiveType } from "../types.js";

// Re-export shared types for convenience
export { VectorType, ScalarObjectiveType } from "../types.js";

/**
 * MADS optimization bounds.
 *
 * Defines the lower and upper bounds for each dimension of the search space.
 */
export const MADSBoundsType = StructType({
    /** Lower bounds for each dimension */
    lower: VectorType(FloatType),
    /** Upper bounds for each dimension */
    upper: VectorType(FloatType),
});

/**
 * MADS constraint type.
 *
 * A variant where the tag indicates the constraint handling method:
 * - `eb` (Extreme Barrier): Infeasible points are rejected entirely
 * - `pb` (Progressive Barrier): Allows temporary constraint violations during search
 *
 * The value is the constraint function: g(x) <= 0 is feasible.
 */
export const MADSConstraintType = VariantType({
    /** Extreme barrier constraint - infeasible points rejected */
    eb: ScalarObjectiveType,
    /** Progressive barrier constraint - temporary violations allowed */
    pb: ScalarObjectiveType,
});

/**
 * MADS direction type for poll step.
 *
 * Controls how search directions are generated during the poll step.
 */
export const MADSDirectionType = VariantType({
    /** ORTHO 2N: 2n orthogonal directions (default) */
    ortho_2n: NullType,
    /** ORTHO N+1: n+1 directions forming a simplex */
    ortho_n_plus_1: NullType,
    /** LT 2N: Lower triangular with 2n directions */
    lt_2n: NullType,
    /** Single direction */
    single: NullType,
});

/**
 * MADS optimization configuration.
 *
 * Configures the MADS algorithm parameters.
 */
export const MADSConfigType = StructType({
    /** Maximum number of blackbox evaluations */
    max_bb_eval: OptionType(IntegerType),
    /** Display verbosity level (0 = silent) */
    display_degree: OptionType(IntegerType),
    /** Direction type for poll step */
    direction_type: OptionType(MADSDirectionType),
    /** Initial mesh size */
    initial_mesh_size: OptionType(FloatType),
    /** Minimum mesh size (stopping criterion) */
    min_mesh_size: OptionType(FloatType),
    /** Random seed for reproducibility */
    seed: OptionType(IntegerType),
});

/**
 * MADS single-objective optimization result.
 *
 * Contains the best solution found and optimization statistics.
 */
export const MADSResultType = StructType({
    /** Best solution vector found */
    x_best: VectorType(FloatType),
    /** Best objective value */
    f_best: FloatType,
    /** Number of blackbox evaluations performed */
    bb_eval: IntegerType,
    /** Whether optimization succeeded */
    success: BooleanType,
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Single-objective MADS optimization with optional constraints.
 *
 * Minimizes an objective function subject to bound constraints and optional
 * nonlinear constraints using the MADS algorithm.
 *
 * @param objective - Objective function to minimize: x -> f(x)
 * @param x0 - Initial starting point
 * @param bounds - Lower and upper bounds for each dimension
 * @param constraints - Optional array of constraint functions (g(x) <= 0 is feasible)
 * @param config - Optimization configuration
 * @returns Optimization result with best solution found
 *
 * @example
 * ```ts
 * import { East, FloatType, variant } from "@elaraai/east";
 * import { MADS } from "@elaraai/east-py-datascience";
 *
 * // Minimize sum of squares
 * const objective = East.function([MADS.Types.VectorType(FloatType)], FloatType, ($, x) => {
 *     return x.reduce((acc, xi) => acc.add(xi.multiply(xi)), East.value(0.0));
 * });
 *
 * const optimize = East.function([], MADS.Types.ResultType, $ => {
 *     const x0 = $.let([0.71, 0.51, 0.51]);
 *     const bounds = $.let({ lower: [-1.0, -1.0, -1.0], upper: [1.0, 1.0, 1.0] });
 *     const config = $.let({
 *         max_bb_eval: variant('some', 100n),
 *         display_degree: variant('some', 0n),
 *         direction_type: variant('none', null),
 *         initial_mesh_size: variant('none', null),
 *         min_mesh_size: variant('none', null),
 *         seed: variant('some', 42n),
 *     });
 *     return $.return(MADS.optimize(objective, x0, bounds, variant('none', null), config));
 * });
 *
 * const compiled = await East.compileAsync(optimize.toIR(), MADS.Implementation);
 * const result = await compiled();
 * console.log(`Best: ${result.f_best}`);
 * ```
 */
export const mads_optimize = East.platform(
    "mads_optimize",
    [
        ScalarObjectiveType,
        VectorType(FloatType),
        MADSBoundsType,
        OptionType(ArrayType(MADSConstraintType)),
        MADSConfigType,
    ],
    MADSResultType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for MADS optimization.
 */
export const MADSTypes = {
    /** Scalar objective function type */
    ScalarObjectiveType,
    /** Bounds type with lower and upper vectors */
    BoundsType: MADSBoundsType,
    /** Constraint type (eb or pb variant) */
    ConstraintType: MADSConstraintType,
    /** Direction type for poll step */
    DirectionType: MADSDirectionType,
    /** Configuration type */
    ConfigType: MADSConfigType,
    /** Single-objective result type */
    ResultType: MADSResultType,
} as const;

/**
 * MADS derivative-free blackbox optimization.
 *
 * Provides optimization algorithms for expensive blackbox functions
 * where gradient information is unavailable using the NOMAD MADS algorithm.
 *
 * MADS is particularly effective for:
 * - Expensive blackbox functions (simulations, experiments)
 * - Functions with no exploitable derivatives
 * - Noisy or stochastic functions
 * - Functions that may fail for some inputs
 *
 * @example
 * ```ts
 * import { East, FloatType, variant } from "@elaraai/east";
 * import { MADS } from "@elaraai/east-py-datascience";
 *
 * const objective = East.function([MADS.Types.VectorType(FloatType)], FloatType, ($, x) => {
 *     return x.reduce((acc, xi) => acc.add(xi.multiply(xi)), East.value(0.0));
 * });
 *
 * const optimize = East.function([], MADS.Types.ResultType, $ => {
 *     const x0 = $.let([0.5, 0.5]);
 *     const bounds = $.let({ lower: [-1.0, -1.0], upper: [1.0, 1.0] });
 *     const config = $.let({
 *         max_bb_eval: variant('some', 100n),
 *         display_degree: variant('some', 0n),
 *         direction_type: variant('none', null),
 *         initial_mesh_size: variant('none', null),
 *         min_mesh_size: variant('none', null),
 *         seed: variant('some', 42n),
 *     });
 *     return $.return(MADS.optimize(objective, x0, bounds, variant('none', null), config));
 * });
 *
 * const compiled = await East.compileAsync(optimize.toIR(), MADS.Implementation);
 * const result = await compiled();
 * ```
 */
export const MADS = {
    /**
     * Single-objective optimization with optional constraints.
     *
     * Minimizes an objective function subject to bound and nonlinear constraints.
     */
    optimize: mads_optimize,

    /**
     * Type definitions for MADS functions.
     */
    Types: MADSTypes,

} as const;
