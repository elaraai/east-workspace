/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ALNS (Adaptive Large Neighborhood Search) metaheuristic optimization.
 *
 * Provides combinatorial optimization using destroy-repair operators.
 * ALNS is designed for discrete optimization problems where:
 * - Solutions are combinatorial (assignments, schedules, routes)
 * - Domain-specific destroy/repair operators can be defined
 * - The objective function may be complex or black-box
 * - Local search alone gets stuck in local minima
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
    FunctionType,
} from "@elaraai/east";

// ============================================================================
// Acceptance Criteria Types
// ============================================================================

/**
 * Simulated annealing acceptance configuration.
 */
export const SimulatedAnnealingConfigType = StructType({
    /** Starting temperature (default: 100.0) */
    start_temperature: OptionType(FloatType),
    /** Ending temperature (default: 0.01) */
    end_temperature: OptionType(FloatType),
    /** Cooling step multiplier (default: 0.99) */
    step: OptionType(FloatType),
});

/**
 * Record-to-record travel acceptance configuration.
 */
export const RecordToRecordConfigType = StructType({
    /** Threshold as fraction of best objective (default: 0.05) */
    threshold: OptionType(FloatType),
});

/**
 * Acceptance criterion variant.
 *
 * Controls whether to accept or reject new solutions:
 * - `simulated_annealing`: Probabilistic acceptance based on temperature
 * - `hill_climbing`: Only accept improving solutions
 * - `record_to_record`: Accept if within threshold of best
 */
export const AcceptanceCriterionType = VariantType({
    simulated_annealing: SimulatedAnnealingConfigType,
    hill_climbing: NullType,
    record_to_record: RecordToRecordConfigType,
});

// ============================================================================
// Operator Selection Types
// ============================================================================

/**
 * Roulette wheel selection configuration.
 *
 * Scores are applied when an operator finds: [new_best, better, accepted, rejected]
 */
export const RouletteWheelConfigType = StructType({
    /** Scores for [new_best, better, accepted, rejected] (default: [33, 9, 3, 0]) */
    scores: OptionType(ArrayType(IntegerType)),
    /** Weight decay factor (default: 0.8) */
    decay: OptionType(FloatType),
});

/**
 * Operator selection strategy variant.
 */
export const OperatorSelectionType = VariantType({
    roulette_wheel: RouletteWheelConfigType,
});

// ============================================================================
// Stopping Criteria Types
// ============================================================================

/**
 * Stopping criterion variant.
 *
 * Controls when to stop the optimization:
 * - `max_iterations`: Stop after N iterations
 * - `max_runtime`: Stop after N seconds
 * - `no_improvement`: Stop after N iterations without improvement
 */
export const StopCriterionType = VariantType({
    max_iterations: IntegerType,
    max_runtime: FloatType,
    no_improvement: IntegerType,
});

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * ALNS optimization configuration.
 */
export const ALNSConfigType = StructType({
    /** Stopping criterion (default: max_iterations 1000) */
    stop: OptionType(StopCriterionType),
    /** Acceptance criterion (default: simulated_annealing) */
    acceptance: OptionType(AcceptanceCriterionType),
    /** Operator selection strategy (default: roulette_wheel) */
    operator_selection: OptionType(OperatorSelectionType),
    /** Random seed for reproducibility */
    seed: OptionType(IntegerType),
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * ALNS optimization result type.
 * Note: For generic platform usage, the result type is defined inline
 * with "S" placeholder. This function is kept for backwards compatibility.
 */
export const ALNSResultType = StructType({
    /** Best solution found */
    best_solution: "S",
    /** Best objective value */
    best_objective: FloatType,
    /** Number of iterations performed */
    iterations: IntegerType,
    /** Total runtime in seconds */
    runtime: FloatType,
    /** Whether optimization succeeded */
    success: BooleanType,
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * ALNS optimization platform function (generic over solution type S).
 *
 * Minimizes an objective function using destroy-repair operators.
 * Operators are defined as S -> S functions that modify the solution.
 *
 * @example
 * ```ts
 * import { East, StructType, ArrayType, StringType, FloatType, variant } from "@elaraai/east";
 * import { ALNS } from "@elaraai/east-py-datascience";
 *
 * const SolutionType = StructType({
 *     assignments: ArrayType(StringType),
 *     cost: FloatType,
 * });
 *
 * const optimize = East.function([SolutionType], ALNS.Types.ResultType, ($, initial) => {
 *     // Define operators inline (they can access outer scope variables)
 *     const objective = East.function([SolutionType], FloatType, ($, s) => $.return(s.cost));
 *     const destroy = East.function([SolutionType], SolutionType, ($, s) => $.return(s));
 *     const repair = East.function([SolutionType], SolutionType, ($, s) => $.return(s));
 *
 *     const config = $.let({
 *         stop: variant('some', variant('max_iterations', 1000n)),
 *         acceptance: variant('none', null),
 *         operator_selection: variant('none', null),
 *         seed: variant('some', 42n),
 *     });
 *
 *     const result = $.let(ALNS.optimize([SolutionType], initial, objective, [destroy], [repair], config));
 *     $.return(result);
 * });
 * ```
 */
export const alns_optimize = East.genericPlatform(
    "alns_optimize",
    ["S"],
    [
        "S",                                 // initial_solution: S
        FunctionType(["S"], FloatType),      // objective: S -> Float
        ArrayType(FunctionType(["S"], "S")), // destroy_operators: Array<S -> S>
        ArrayType(FunctionType(["S"], "S")), // repair_operators: Array<S -> S>
        ALNSConfigType,
    ],
    ALNSResultType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for ALNS optimization.
 */
export const ALNSTypes = {
    /** Simulated annealing config */
    SimulatedAnnealingConfigType,
    /** Record-to-record config */
    RecordToRecordConfigType,
    /** Acceptance criterion variant */
    AcceptanceCriterionType,
    /** Roulette wheel selection config */
    RouletteWheelConfigType,
    /** Operator selection variant */
    OperatorSelectionType,
    /** Stop criterion variant */
    StopCriterionType,
    /** Main configuration type */
    ConfigType: ALNSConfigType,
    /** Result type (with "S" placeholder for solution type) */
    ResultType: ALNSResultType,
} as const;

/**
 * ALNS (Adaptive Large Neighborhood Search) optimization.
 *
 * Provides combinatorial optimization using destroy-repair operators.
 * ALNS is particularly effective for:
 * - Scheduling and rostering problems
 * - Vehicle routing problems
 * - Resource allocation problems
 * - Any problem where domain-specific operators can be designed
 *
 * @example
 * ```ts
 * import { East, StructType, FloatType, variant } from "@elaraai/east";
 * import { ALNS } from "@elaraai/east-py-datascience";
 *
 * const SolutionType = StructType({ value: FloatType });
 *
 * const optimize = East.function([SolutionType], ALNS.Types.ResultType, ($, initial) => {
 *     const objective = East.function([SolutionType], FloatType, ($, s) => $.return(s.value));
 *     const destroy = East.function([SolutionType], SolutionType, ($, s) => $.return(s));
 *     const repair = East.function([SolutionType], SolutionType, ($, s) => $.return(s));
 *
 *     const config = $.let({
 *         stop: variant('some', variant('max_iterations', 100n)),
 *         acceptance: variant('none', null),
 *         operator_selection: variant('none', null),
 *         seed: variant('some', 42n),
 *     });
 *
 *     return $.return(ALNS.optimize([SolutionType], initial, objective, [destroy], [repair], config));
 * });
 * ```
 */
export const ALNS = {
    /**
     * ALNS optimization (generic over solution type).
     *
     * Call with type parameter array first, then arguments:
     * `ALNS.optimize([MySolutionType], initial, objective, destroys, repairs, config)`
     */
    optimize: alns_optimize,

    /**
     * Type definitions for ALNS functions.
     */
    Types: ALNSTypes,
} as const;
