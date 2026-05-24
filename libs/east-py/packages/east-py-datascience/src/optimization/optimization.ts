/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Iterative coordinate descent optimization for discrete combinatorial problems.
 *
 * Provides element-wise optimization over vectors of discrete integer values.
 * Each element is independently optimized by trying all candidate values
 * while holding other elements fixed. Multi-start sampling improves
 * exploration of the search space.
 *
 * Ported from the Julia IterativeDecisionAlgorithm (ArrayParameterSpace branch).
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    VectorType,
    IntegerType,
    BooleanType,
    FloatType,
    NullType,
    FunctionType,
} from "@elaraai/east";

// ============================================================================
// Type Definitions
// ============================================================================

/** Parameter vector: Vector<Integer> */
export const ParameterVectorType = VectorType(IntegerType);

/** Objective function: Vector<Integer> -> Float */
export const IterativeObjectiveType = FunctionType([ParameterVectorType], FloatType);

/** Per-element contribution function: (Vector<Integer>, Integer) -> Float */
export const ElementObjectiveType = FunctionType([ParameterVectorType, IntegerType], FloatType);

/** Per-element candidate spaces: Array<Vector<Integer>> */
export const ParameterSpacesType = ArrayType(ParameterVectorType);

/**
 * Initial value strategy for parameters.
 *
 * - `first`: Use the first candidate value from each space
 * - `random`: Randomly select from each space
 */
export const InitialStrategyType = VariantType({
    first: NullType,
    random: NullType,
});

/**
 * Evaluation order for candidate values within each element's space.
 *
 * - `sequential`: Try candidates in the order they appear
 * - `random`: Shuffle candidates before trying
 */
export const EvaluationOrderType = VariantType({
    sequential: NullType,
    random: NullType,
});

/**
 * Optimization mode.
 *
 * - `coordinate`: Standard coordinate descent — optimize each element independently (default)
 * - `swap`: Swap-based moves — swap pairs of elements, preserving valid permutations
 */
export const ModeType = VariantType({
    coordinate: NullType,
    swap: NullType,
});

/**
 * Configuration for iterative optimization.
 *
 * All fields are optional with sensible defaults.
 */
export const IterativeConfigType = StructType({
    /** Maximum coordinate descent iterations per sample (default: 100) */
    iterations: OptionType(IntegerType),
    /** Number of independent restarts (default: 1) */
    samples: OptionType(IntegerType),
    /** How to initialize parameter values (default: first) */
    initial: OptionType(InitialStrategyType),
    /** Order to evaluate candidates (default: sequential) */
    order: OptionType(EvaluationOrderType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
    /** Optimization mode: coordinate (default) or swap for permutations */
    mode: OptionType(ModeType),
});

/**
 * Result of iterative optimization.
 */
export const IterativeResultType = StructType({
    /** Best parameter values found */
    best_parameters: ParameterVectorType,
    /** Objective value at best parameters */
    best_objective: FloatType,
    /** Total coordinate descent iterations across all samples */
    iterations: IntegerType,
    /** Total number of objective evaluations */
    evaluations: IntegerType,
    /** Whether optimization succeeded */
    success: BooleanType,
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Iterative optimization over integer parameter vectors.
 *
 * Maximizes an objective function over a vector of discrete integer parameters.
 * Each parameter position has its own set of candidate values (vector).
 *
 * Two modes are available:
 * - **coordinate** (default): Coordinate descent — optimizes each element independently
 *   by trying all candidate values while holding others fixed. Best for assignment problems
 *   where each position can take any value independently.
 * - **swap**: Swap-based moves — swaps pairs of elements, preserving valid permutations.
 *   Use this for permutation problems (scheduling, ordering) where each value must appear
 *   exactly once.
 *
 * @example Coordinate mode (assignment)
 * ```ts
 * const config = $.let({
 *     iterations: variant('some', 10n),
 *     samples: variant('some', 3n),
 *     initial: variant('some', variant('random', null)),
 *     order: variant('some', variant('sequential', null)),
 *     random_state: variant('some', 42n),
 *     mode: variant('none', null), // coordinate is the default
 * });
 * const result = $.let(Optimization.iterative(objective, spaces, config));
 * ```
 *
 * @example Swap mode (permutation)
 * ```ts
 * const config = $.let({
 *     iterations: variant('some', 50n),
 *     samples: variant('some', 10n),
 *     initial: variant('some', variant('random', null)),
 *     order: variant('some', variant('random', null)),
 *     random_state: variant('some', 42n),
 *     mode: variant('some', variant('swap', null)),
 * });
 * const result = $.let(Optimization.iterative(objective, spaces, config));
 * ```
 */
export const optimization_iterative = East.platform(
    "optimization_iterative",
    [
        IterativeObjectiveType,   // objective: Vector<Integer> -> Float
        ParameterSpacesType,      // parameter_spaces: Array<Vector<Integer>>
        IterativeConfigType,      // config
    ],
    IterativeResultType
);

/**
 * Incremental iterative optimization over integer parameter vectors.
 *
 * Like {@link optimization_iterative}, but takes a **per-element contribution function**
 * instead of a full objective. The optimizer maintains a running sum and only
 * recomputes contributions for changed indices — dramatically faster when
 * individual moves affect only a small part of the total cost.
 *
 * The total objective is `sum(elementObjective(vector, i) for all i)`.
 *
 * Two modes are available:
 * - **coordinate** (default): When changing element `i`, recomputes 1 contribution.
 * - **swap**: When swapping elements `i` and `j`, recomputes 2 contributions.
 *
 * @example Incremental rostering
 * ```ts
 * // Per-person cost: only recomputes the changed person
 * const elementObjective = East.function(
 *     [VectorType(IntegerType), IntegerType], FloatType,
 *     ($, assignments, personIdx) => {
 *         const role = $.let(assignments.get(personIdx));
 *         return $.return(salaryLookup.get(personIdx).get(role).negate());
 *     }
 * );
 * const result = $.let(Optimization.iterativeIncremental(
 *     elementObjective, spaces, config
 * ));
 * ```
 */
export const optimization_iterative_incremental = East.platform(
    "optimization_iterative_incremental",
    [
        ElementObjectiveType,     // elementObjective: (Vector<Integer>, Integer) -> Float
        ParameterSpacesType,      // parameter_spaces: Array<Vector<Integer>>
        IterativeConfigType,      // config
    ],
    IterativeResultType
);

/**
 * Group-based incremental iterative optimization.
 *
 * Like {@link optimization_iterative_incremental}, but contributions are grouped
 * by **value** rather than by index. The group objective receives the full vector
 * and a group key (a value that appears in the vector), and returns the total
 * contribution of all elements assigned to that group.
 *
 * When element `i` changes from value A to value B, only 2 groups are recomputed:
 * `groupObjective(vector, A)` and `groupObjective(vector, B)`.
 *
 * Use this when cost is associated with values (e.g., employees, bins, vehicles)
 * rather than positions (e.g., slots, items, stops).
 *
 * @example Rostering — slot → employee assignment
 * ```ts
 * const groupObjective = East.function(
 *     [VectorType(IntegerType), IntegerType], FloatType,
 *     ($, slotAssignments, employeeId) => {
 *         const cost = $.let(0.0);
 *         $.for(East.Array.range(0n, nSlots), ($, slot) => {
 *             $.if(East.equal(slotAssignments.get(slot), employeeId), $ => {
 *                 $.assign(cost, cost.add(shiftRates.get(slot)));
 *             });
 *         });
 *         return $.return(cost.negate());
 *     }
 * );
 * const result = $.let(Optimization.iterativeGrouped(
 *     groupObjective, spaces, config
 * ));
 * ```
 */
export const optimization_iterative_grouped = East.platform(
    "optimization_iterative_grouped",
    [
        ElementObjectiveType,     // groupObjective: (Vector<Integer>, Integer) -> Float
        ParameterSpacesType,      // parameter_spaces: Array<Vector<Integer>>
        IterativeConfigType,      // config
    ],
    IterativeResultType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for iterative optimization.
 */
export const OptimizationTypes = {
    /** Parameter vector type */
    ParameterVectorType,
    /** Objective function type */
    ObjectiveType: IterativeObjectiveType,
    /** Per-element contribution function type */
    ElementObjectiveType,
    /** Parameter spaces type */
    SpacesType: ParameterSpacesType,
    /** Initial value strategy variant */
    InitialStrategyType,
    /** Evaluation order variant */
    EvaluationOrderType,
    /** Optimization mode variant */
    ModeType,
    /** Configuration type */
    ConfigType: IterativeConfigType,
    /** Result type */
    ResultType: IterativeResultType,
} as const;

/**
 * Iterative optimization for discrete combinatorial problems.
 *
 * Supports two modes:
 * - **coordinate** (default): Element-wise coordinate descent. Best for
 *   assignment problems where positions are independent.
 * - **swap**: Pair-wise swap moves preserving permutations. Best for
 *   scheduling/ordering where each value must appear exactly once.
 *
 * Use cases:
 * - Task-worker assignment (coordinate mode)
 * - Scheduling and ordering (swap mode)
 * - Combinatorial selection problems
 * - Any discrete optimization with per-element candidate sets
 */
export const Optimization = {
    /**
     * Iterative optimization over integer parameter vectors.
     *
     * `Optimization.iterative(objective, spaces, config)`
     *
     * @example Coordinate mode — task-worker assignment
     * ```ts
     * // 3 tasks, 2 workers. Maximize total skill match.
     * const skill = $.let([[3.0, 1.0], [1.0, 3.0], [2.0, 2.0]]);
     * const objective = East.function(
     *     [VectorType(IntegerType)], FloatType,
     *     ($, assignments) => {
     *         const total = $.let(0.0);
     *         $.for(East.Array.range(0n, East.value(3n)), ($, i) => {
     *             $.assign(total, total.add(skill.get(i).get(assignments.get(i))));
     *         });
     *         return $.return(total);
     *     }
     * );
     * const spaces = $.let([
     *     new BigInt64Array([0n, 1n]),
     *     new BigInt64Array([0n, 1n]),
     *     new BigInt64Array([0n, 1n]),
     * ]);
     * const config = $.let({
     *     iterations: variant('some', 10n),
     *     samples: variant('some', 3n),
     *     initial: variant('some', variant('random', null)),
     *     order: variant('some', variant('sequential', null)),
     *     random_state: variant('some', 42n),
     *     mode: variant('none', null),
     * });
     * const result = $.let(Optimization.iterative(objective, spaces, config));
     * // result.best_objective = 8.0 (task 0→worker 0, task 1→worker 1, task 2→either)
     * ```
     *
     * @example Swap mode — scheduling permutation
     * ```ts
     * // 4 jobs: find execution order minimizing weighted completion time.
     * const durations = $.let([10.0, 5.0, 20.0, 3.0]);
     * const values = $.let([1.0, 8.0, 2.0, 10.0]);
     * const objective = East.function(
     *     [VectorType(IntegerType)], FloatType,
     *     ($, perm) => {
     *         const cum = $.let(0.0);
     *         const total = $.let(0.0);
     *         $.for(East.Array.range(0n, East.value(4n)), ($, i) => {
     *             const idx = $.let(perm.get(i));
     *             $.assign(cum, cum.add(durations.get(idx)));
     *             $.assign(total, total.add(values.get(idx).multiply(cum)));
     *         });
     *         return $.return(total.negate());
     *     }
     * );
     * const spaces = $.let([
     *     new BigInt64Array([0n, 1n, 2n, 3n]),
     *     new BigInt64Array([0n, 1n, 2n, 3n]),
     *     new BigInt64Array([0n, 1n, 2n, 3n]),
     *     new BigInt64Array([0n, 1n, 2n, 3n]),
     * ]);
     * const config = $.let({
     *     iterations: variant('some', 50n),
     *     samples: variant('some', 10n),
     *     initial: variant('some', variant('random', null)),
     *     order: variant('some', variant('random', null)),
     *     random_state: variant('some', 42n),
     *     mode: variant('some', variant('swap', null)),
     * });
     * const result = $.let(Optimization.iterative(objective, spaces, config));
     * // result.best_objective = -188.0 (optimal WSPT order)
     * ```
     */
    iterative: optimization_iterative,

    /**
     * Incremental iterative optimization with per-element contributions.
     *
     * `Optimization.iterativeIncremental(elementObjective, spaces, config)`
     *
     * Takes a per-element contribution function `(Vector<Integer>, Integer) -> Float`
     * instead of a full objective. The total objective is the sum of all element
     * contributions. Only recomputes contributions for changed indices during search.
     *
     * Use this when individual moves (coordinate or swap) affect only a small
     * part of the total cost — e.g., rostering where changing one person's
     * allocation only changes that person's salary.
     *
     * @example Incremental task-worker assignment
     * ```ts
     * // Per-task skill score: only recomputes the changed task
     * const skill = $.let([[3.0, 1.0], [1.0, 3.0], [2.0, 2.0]]);
     * const elementObjective = East.function(
     *     [VectorType(IntegerType), IntegerType], FloatType,
     *     ($, assignments, taskIdx) => {
     *         const worker = $.let(assignments.get(taskIdx));
     *         return $.return(skill.get(taskIdx).get(worker));
     *     }
     * );
     * const spaces = $.let([
     *     new BigInt64Array([0n, 1n]),
     *     new BigInt64Array([0n, 1n]),
     *     new BigInt64Array([0n, 1n]),
     * ]);
     * const config = $.let({
     *     iterations: variant('some', 10n),
     *     samples: variant('some', 3n),
     *     initial: variant('some', variant('random', null)),
     *     order: variant('some', variant('sequential', null)),
     *     random_state: variant('some', 42n),
     *     mode: variant('none', null),
     * });
     * const result = $.let(Optimization.iterativeIncremental(
     *     elementObjective, spaces, config
     * ));
     * // result.best_objective = 8.0 (same result, fewer evaluations)
     * ```
     */
    iterativeIncremental: optimization_iterative_incremental,

    /**
     * Group-based incremental optimization with per-value contributions.
     *
     * `Optimization.iterativeGrouped(groupObjective, spaces, config)`
     *
     * Takes a group objective `(Vector<Integer>, Integer) -> Float` where the
     * second argument is a **value** (group key), not an index. Returns the total
     * contribution of all elements assigned to that value.
     *
     * When element `i` changes from value A to B, recomputes only groups A and B.
     * Use this when cost is per-value (employee, bin, vehicle) not per-position.
     *
     * @example Group-based task assignment
     * ```ts
     * // 6 tasks assigned to workers 0-2. Cost = per-worker total.
     * const taskCosts = $.let([10.0, 20.0, 15.0, 25.0, 30.0, 5.0]);
     * const groupObjective = East.function(
     *     [VectorType(IntegerType), IntegerType], FloatType,
     *     ($, assignments, workerId) => {
     *         const total = $.let(0.0);
     *         $.for(East.Array.range(0n, East.value(6n)), ($, task) => {
     *             $.if(East.equal(assignments.get(task), workerId), $ => {
     *                 $.assign(total, total.add(taskCosts.get(task)));
     *             });
     *         });
     *         return $.return(total.negate());
     *     }
     * );
     * const result = $.let(Optimization.iterativeGrouped(
     *     groupObjective, spaces, config
     * ));
     * ```
     */
    iterativeGrouped: optimization_iterative_grouped,

    /**
     * Type definitions for optimization functions.
     */
    Types: OptimizationTypes,
} as const;
