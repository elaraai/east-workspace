/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Bayesian optimization using Optuna's TPE sampler.
 *
 * Provides parameter optimization for blackbox functions with mixed parameter
 * types (categorical, integer, continuous). Useful for:
 * - Hyperparameter tuning for ML models
 * - Design optimization
 * - Any blackbox optimization with structured parameter spaces
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
    FloatType,
    StringType,
    BooleanType,
    FunctionType,
    NullType,
} from "@elaraai/east";

// ===========================================
// Parameter Types
// ===========================================

/**
 * Parameter value type (can be int, float, string, or bool).
 */
export const ParamValueType = VariantType({
    int: IntegerType,
    float: FloatType,
    string: StringType,
    bool: BooleanType,
});

/**
 * Parameter space kind for defining search spaces.
 */
export const ParamSpaceKindType = VariantType({
    /** Integer parameter with low/high bounds */
    int: NullType,
    /** Float parameter with low/high bounds */
    float: NullType,
    /** Categorical parameter with choices */
    categorical: NullType,
    /** Log-uniform float parameter (for learning rates, etc.) */
    log_uniform: NullType,
});

/**
 * Parameter search space definition.
 *
 * Defines a single parameter's name, type, and valid range/choices.
 */
export const ParamSpaceType = StructType({
    /** Parameter name */
    name: StringType,
    /** Parameter kind (int, float, categorical, log_uniform) */
    kind: ParamSpaceKindType,
    /** Lower bound (for int, float, log_uniform) */
    low: OptionType(FloatType),
    /** Upper bound (for int, float, log_uniform) */
    high: OptionType(FloatType),
    /** Choices (for categorical) */
    choices: OptionType(ArrayType(ParamValueType)),
});

/**
 * Named parameter (name + value pair).
 *
 * Represents a single parameter with its suggested/best value.
 */
export const NamedParamType = StructType({
    /** Parameter name */
    name: StringType,
    /** Parameter value */
    value: ParamValueType,
});

// ===========================================
// Optimization Config Types
// ===========================================

/**
 * Optimization direction (minimize or maximize).
 */
export const OptimizationDirectionType = VariantType({
    minimize: NullType,
    maximize: NullType,
});

/**
 * Pruner type for early stopping of unpromising trials.
 */
export const PrunerType = VariantType({
    /** No pruning */
    none: NullType,
    /** Median pruner - prune if below median of previous trials */
    median: NullType,
    /** Hyperband pruner - aggressive early stopping */
    hyperband: NullType,
});

/**
 * Optuna study configuration.
 */
export const OptunaStudyConfigType = StructType({
    /** Optimization direction (default: minimize) */
    direction: OptionType(OptimizationDirectionType),
    /** Number of trials to run */
    n_trials: IntegerType,
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
    /** Pruner for early stopping (default: none) */
    pruner: OptionType(PrunerType),
    /** Initial parameters to evaluate before sampling (warm-start) */
    initial_params: OptionType(ArrayType(NamedParamType)),
});

// ===========================================
// Result Types
// ===========================================

/**
 * Single trial result.
 */
export const TrialResultType = StructType({
    /** Trial ID */
    trial_id: IntegerType,
    /** Parameters used in this trial */
    params: ArrayType(NamedParamType),
    /** Objective score */
    score: FloatType,
});

/**
 * Optimization study result.
 */
export const StudyResultType = StructType({
    /** Best parameters found */
    best_params: ArrayType(NamedParamType),
    /** Best objective score */
    best_score: FloatType,
    /** All completed trials */
    trials: ArrayType(TrialResultType),
});

// ===========================================
// Objective Function Type
// ===========================================

/**
 * Objective function type: takes named params, returns score.
 *
 * The objective function is an East function that receives suggested
 * parameters and returns a scalar score to minimize/maximize.
 */
export const ObjectiveFunctionType = FunctionType(
    [ArrayType(NamedParamType)],
    FloatType
);

// ===========================================
// Platform Functions
// ===========================================

/**
 * Run Bayesian optimization with Optuna.
 *
 * Uses TPE (Tree-structured Parzen Estimator) to efficiently search
 * the parameter space, balancing exploration and exploitation.
 *
 * @param search_space - Array of parameter space definitions
 * @param objective - East function that takes params and returns score
 * @param config - Study configuration (n_trials, direction, etc.)
 * @returns Study result with best params, best score, and all trials
 *
 * @example
 * ```ts
 * import { East, FloatType, variant } from "@elaraai/east";
 * import { Optuna } from "@elaraai/east-py-datascience";
 *
 * // Define objective: minimize (x - 2)^2 + (y - 3)^2
 * const objective = East.function(
 *     [ArrayType(Optuna.Types.NamedParamType)],
 *     FloatType,
 *     ($, params) => {
 *         // Extract params by name
 *         const x = $.let(params.get(0n).value); // First param
 *         const y = $.let(params.get(1n).value); // Second param
 *         // Compute objective (assuming float params)
 *         return $.return(
 *             x.match({ float: v => v }).subtract(2.0).multiply(
 *                 x.match({ float: v => v }).subtract(2.0)
 *             ).add(
 *                 y.match({ float: v => v }).subtract(3.0).multiply(
 *                     y.match({ float: v => v }).subtract(3.0)
 *                 )
 *             )
 *         );
 *     }
 * );
 *
 * const optimize = East.function([], Optuna.Types.StudyResultType, $ => {
 *     const search_space = $.let([
 *         { name: "x", kind: variant("float", null), low: variant("some", 0.0), high: variant("some", 5.0), choices: variant("none", null) },
 *         { name: "y", kind: variant("float", null), low: variant("some", 0.0), high: variant("some", 5.0), choices: variant("none", null) },
 *     ]);
 *     const config = $.let({
 *         direction: variant("some", variant("minimize", null)),
 *         n_trials: 50n,
 *         random_state: variant("some", 42n),
 *         pruner: variant("none", null),
 *     });
 *     return $.return(Optuna.optimize(search_space, objective, config));
 * });
 * ```
 */
export const optuna_optimize = East.platform(
    "optuna_optimize",
    [
        ArrayType(ParamSpaceType),
        ObjectiveFunctionType,
        OptunaStudyConfigType,
    ],
    StudyResultType
);

// ===========================================
// Grouped Export
// ===========================================

/**
 * Type definitions for Optuna optimization.
 */
export const OptunaTypes = {
    /** Parameter value variant type */
    ParamValueType,
    /** Parameter space kind type */
    ParamSpaceKindType,
    /** Parameter space definition type */
    ParamSpaceType,
    /** Named parameter type */
    NamedParamType,
    /** Optimization direction type */
    OptimizationDirectionType,
    /** Pruner type */
    PrunerType,
    /** Study config type */
    StudyConfigType: OptunaStudyConfigType,
    /** Trial result type */
    TrialResultType,
    /** Study result type */
    StudyResultType,
    /** Objective function type */
    ObjectiveFunctionType,
} as const;

/**
 * Bayesian optimization using Optuna.
 *
 * Provides efficient parameter optimization using TPE (Tree-structured
 * Parzen Estimator) for blackbox functions with mixed parameter types.
 *
 * Supports:
 * - Integer, float, and categorical parameters
 * - Log-uniform sampling for learning rates
 * - Minimization and maximization
 * - Early stopping with pruners
 *
 * @example
 * ```ts
 * import { East, FloatType, variant } from "@elaraai/east";
 * import { Optuna } from "@elaraai/east-py-datascience";
 *
 * const objective = East.function(
 *     [ArrayType(Optuna.Types.NamedParamType)],
 *     FloatType,
 *     ($, params) => {
 *         // Your objective function here
 *         return $.return(score);
 *     }
 * );
 *
 * const result = Optuna.optimize(search_space, objective, config);
 * ```
 */
export const Optuna = {
    /**
     * Run Bayesian optimization.
     *
     * Efficiently searches the parameter space using TPE.
     */
    optimize: optuna_optimize,

    /**
     * Type definitions for Optuna functions.
     */
    Types: OptunaTypes,
} as const;
