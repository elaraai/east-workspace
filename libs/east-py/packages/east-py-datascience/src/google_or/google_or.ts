/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Google OR-Tools optimization platform functions.
 *
 * Provides constraint programming (CP-SAT), vehicle routing, linear programming,
 * and graph algorithms using Google OR-Tools.
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    DictType,
    IntegerType,
    BooleanType,
    FloatType,
    NullType,
    StringType,
    VectorType,
} from "@elaraai/east";

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Solver status — shared across all OR-Tools solvers.
 */
export const GoogleOrStatusType = VariantType({
    optimal: NullType,
    feasible: NullType,
    infeasible: NullType,
    not_solved: NullType,
    model_invalid: NullType,
});

// ============================================================================
// CP-SAT Types
// ============================================================================

/** Integer variable definition. */
export const CpSatIntVarType = StructType({
    name: StringType,
    lower_bound: IntegerType,
    upper_bound: IntegerType,
});

/** Boolean variable definition. */
export const CpSatBoolVarType = StructType({
    name: StringType,
});

/** Interval variable definition. */
export const CpSatIntervalVarType = StructType({
    name: StringType,
    start: StringType,
    size: StringType,
    end: StringType,
    is_present: OptionType(StringType),
});

/** A term in a linear expression: coeff * var. */
export const CpSatLinearTermType = StructType({
    var: StringType,
    coeff: IntegerType,
});

/** A linear expression: sum(coeff_i * var_i) + constant. */
export const CpSatLinearExprType = StructType({
    terms: ArrayType(CpSatLinearTermType),
    constant: IntegerType,
});

/** A boolean literal (possibly negated). */
export const CpSatLiteralType = StructType({
    var: StringType,
    negated: BooleanType,
});

/** Comparison operator for linear constraints. */
export const CpSatComparisonType = VariantType({
    equal: NullType,
    not_equal: NullType,
    less_equal: NullType,
    greater_equal: NullType,
});

/** Arc for circuit constraints. */
const CpSatCircuitArcType = StructType({
    tail: IntegerType,
    head: IntegerType,
    literal: StringType,
});

/**
 * CP-SAT constraint variant.
 *
 * Supports: linear, boolean logic, cardinality, combinatorial, scheduling, sequencing.
 */
export const CpSatConstraintType = VariantType({
    linear: StructType({
        expr: CpSatLinearExprType,
        op: CpSatComparisonType,
        rhs: IntegerType,
    }),
    bool_or: StructType({
        literals: ArrayType(CpSatLiteralType),
    }),
    bool_and: StructType({
        literals: ArrayType(CpSatLiteralType),
    }),
    implication: StructType({
        if_literal: CpSatLiteralType,
        then_literal: CpSatLiteralType,
    }),
    exactly_k: StructType({
        vars: ArrayType(StringType),
        k: IntegerType,
    }),
    at_most_k: StructType({
        vars: ArrayType(StringType),
        k: IntegerType,
    }),
    at_least_k: StructType({
        vars: ArrayType(StringType),
        k: IntegerType,
    }),
    all_different: StructType({
        vars: ArrayType(StringType),
    }),
    element: StructType({
        index_var: StringType,
        values: ArrayType(IntegerType),
        target_var: StringType,
    }),
    no_overlap: StructType({
        intervals: ArrayType(StringType),
    }),
    cumulative: StructType({
        intervals: ArrayType(StringType),
        demands: ArrayType(IntegerType),
        capacity: IntegerType,
    }),
    circuit: StructType({
        arcs: ArrayType(CpSatCircuitArcType),
    }),
});

/** CP-SAT objective: minimize or maximize a linear expression. */
export const CpSatObjectiveType = VariantType({
    minimize: CpSatLinearExprType,
    maximize: CpSatLinearExprType,
});

/** Declarative CP-SAT model. */
export const CpSatModelType = StructType({
    int_vars: ArrayType(CpSatIntVarType),
    bool_vars: ArrayType(CpSatBoolVarType),
    interval_vars: ArrayType(CpSatIntervalVarType),
    constraints: ArrayType(CpSatConstraintType),
    objective: OptionType(CpSatObjectiveType),
});

/** One entry of a (partial) solution hint: a suggested value for one variable. */
export const CpSatHintType = StructType({
    /** Int/bool variable name; booleans hint 0/1. */
    var: StringType,
    /** Suggested solution value. */
    value: IntegerType,
});

/** CP-SAT solver configuration. */
export const CpSatConfigType = StructType({
    max_time_seconds: OptionType(FloatType),
    num_workers: OptionType(IntegerType),
    log_search_progress: OptionType(BooleanType),
    seed: OptionType(IntegerType),
    max_solutions: OptionType(IntegerType),
    /** Stop with status OPTIMAL once (best - lower_bound) / |best| ≤ this.
     *  e.g. 0.005 → stop at 0.5% proven gap. */
    relative_gap_limit: OptionType(FloatType),
    /** Stop with status OPTIMAL once (best - lower_bound) ≤ this (in objective units). */
    absolute_gap_limit: OptionType(FloatType),
    /** Partial solution hint to warm-start the search, e.g. the previous
     *  solve's assignments. Advisory only: an infeasible, partial, or
     *  suboptimal hint never changes the returned optimum, only the path to
     *  it. Entries naming unknown or interval variables are ignored. */
    hints: OptionType(ArrayType(CpSatHintType)),
});

/** CP-SAT solution result. */
export const CpSatResultType = StructType({
    status: GoogleOrStatusType,
    objective_value: OptionType(FloatType),
    assignments: DictType(StringType, IntegerType),
    wall_time: FloatType,
});

/**
 * A CP-SAT model in columns: its variables by index and its linear
 * constraints by rows, so the model crosses between the East runtime and the
 * solver as vectors — whole, never an element at a time — where
 * {@link CpSatModelType} names every variable and term.
 *
 * Variable `i` has the domain `[var_lower[i], var_upper[i]]` (a boolean is
 * `[0, 1]`). Linear constraint `r` holds its sum in
 * `[row_lower[r], row_upper[r]]` (an open side is the Integer's min or max)
 * and its terms are `coeff[k] * variable(col_ix[k])` for `k` in
 * `row_ptr[r] .. row_ptr[r + 1]`; so `row_ptr` has one more entry than there
 * are rows, starts at 0 and ends at the term count. The objective, when there
 * is one, is `coeff[i] * variable(i)` summed, minimized or maximized.
 *
 * The other constraint kinds and the interval variables stay as they are in
 * {@link CpSatModelType}, over named variables: `names` gives variable `i`
 * its name, and is `none` when nothing names one.
 */
export const CpSatModelColumnsType = StructType({
    var_lower: VectorType(IntegerType),
    var_upper: VectorType(IntegerType),
    row_lower: VectorType(IntegerType),
    row_upper: VectorType(IntegerType),
    row_ptr: VectorType(IntegerType),
    col_ix: VectorType(IntegerType),
    coeff: VectorType(IntegerType),
    objective: OptionType(StructType({
        coeff: VectorType(IntegerType),
        maximize: BooleanType,
    })),
    names: OptionType(ArrayType(StringType)),
    interval_vars: ArrayType(CpSatIntervalVarType),
    constraints: ArrayType(CpSatConstraintType),
});

/** A partial solution hint by variable index: `value[k]` for variable `index[k]`. */
export const CpSatColumnsHintType = StructType({
    index: VectorType(IntegerType),
    value: VectorType(IntegerType),
});

/** CP-SAT solver configuration for a columnar model: {@link CpSatConfigType}'s
 *  fields, with the hint by variable index and no `max_solutions` (the
 *  columnar form solves for one solution). */
export const CpSatColumnsConfigType = StructType({
    max_time_seconds: OptionType(FloatType),
    num_workers: OptionType(IntegerType),
    log_search_progress: OptionType(BooleanType),
    seed: OptionType(IntegerType),
    relative_gap_limit: OptionType(FloatType),
    absolute_gap_limit: OptionType(FloatType),
    hints: OptionType(CpSatColumnsHintType),
});

/** A columnar CP-SAT solution: the variables' values by index, beside the
 *  status, objective and wall time of {@link CpSatResultType}. `values` is
 *  empty unless the status is `optimal` or `feasible`. */
export const CpSatColumnsResultType = StructType({
    status: GoogleOrStatusType,
    objective_value: OptionType(FloatType),
    values: VectorType(IntegerType),
    wall_time: FloatType,
});

// ============================================================================
// Routing Types
// ============================================================================

/** First solution strategy for routing. */
export const RoutingFirstSolutionType = VariantType({
    path_cheapest_arc: NullType,
    savings: NullType,
    christofides: NullType,
    parallel_cheapest_insertion: NullType,
    local_cheapest_insertion: NullType,
    first_unbound_min_value: NullType,
});

/** Local search metaheuristic for routing. */
export const RoutingMetaheuristicType = VariantType({
    greedy_descent: NullType,
    guided_local_search: NullType,
    simulated_annealing: NullType,
    tabu_search: NullType,
});

/** Time window constraint for a node. */
export const RoutingTimeWindowType = StructType({
    start: IntegerType,
    end: IntegerType,
});

/** Pickup-delivery pair. */
export const RoutingPickupDeliveryType = StructType({
    pickup: IntegerType,
    delivery: IntegerType,
});

/** Vehicle routing model. */
export const RoutingModelType = StructType({
    distance_matrix: ArrayType(ArrayType(IntegerType)),
    num_vehicles: IntegerType,
    depot: IntegerType,
    demands: OptionType(ArrayType(IntegerType)),
    vehicle_capacities: OptionType(ArrayType(IntegerType)),
    time_matrix: OptionType(ArrayType(ArrayType(IntegerType))),
    time_windows: OptionType(ArrayType(RoutingTimeWindowType)),
    pickup_deliveries: OptionType(ArrayType(RoutingPickupDeliveryType)),
});

/** Routing solver configuration. */
export const RoutingConfigType = StructType({
    first_solution: OptionType(RoutingFirstSolutionType),
    metaheuristic: OptionType(RoutingMetaheuristicType),
    max_time_seconds: OptionType(FloatType),
});

/** A single vehicle route in the solution. */
export const RoutingRouteType = StructType({
    vehicle: IntegerType,
    nodes: ArrayType(IntegerType),
    distance: IntegerType,
});

/** Vehicle routing result. */
export const RoutingResultType = StructType({
    status: GoogleOrStatusType,
    total_distance: IntegerType,
    routes: ArrayType(RoutingRouteType),
    wall_time: FloatType,
});

// ============================================================================
// Linear Programming Types
// ============================================================================

/** LP/MIP variable definition. */
export const LinearVarType = StructType({
    name: StringType,
    lower_bound: FloatType,
    upper_bound: FloatType,
    is_integer: BooleanType,
});

/** A term in a linear expression: coeff * var. */
export const LinearTermType = StructType({
    var: StringType,
    coeff: FloatType,
});

/** Linear constraint: lower_bound <= sum(terms) <= upper_bound. */
export const LinearConstraintDefType = StructType({
    terms: ArrayType(LinearTermType),
    lower_bound: FloatType,
    upper_bound: FloatType,
});

/** Linear objective function. */
export const LinearObjectiveType = StructType({
    terms: ArrayType(LinearTermType),
    maximize: BooleanType,
});

/** Linear programming model. */
export const LinearModelType = StructType({
    variables: ArrayType(LinearVarType),
    constraints: ArrayType(LinearConstraintDefType),
    objective: LinearObjectiveType,
});

/** LP solver backend. */
export const LinearSolverType = VariantType({
    glop: NullType,
    scip: NullType,
    highs: NullType,
});

/** One entry of a (partial) solution hint: a suggested value for one variable. */
export const LinearHintType = StructType({
    /** Variable name. */
    var: StringType,
    /** Suggested solution value. */
    value: FloatType,
});

/** LP solver configuration. */
export const LinearConfigType = StructType({
    solver: OptionType(LinearSolverType),
    max_time_seconds: OptionType(FloatType),
    /** Stop with status OPTIMAL once the proven relative MIP gap
     *  `(best − bound) / |best|` ≤ this, e.g. `0.01` for 1%. MIP only
     *  (OR-Tools `RELATIVE_MIP_GAP`, honoured by SCIP/CBC); ignored for a
     *  pure-LP (Glop) solve, which has no branch-and-bound gap. */
    relative_gap_limit: OptionType(FloatType),
    /** Partial solution hint to warm-start the search, e.g. the previous
     *  epoch's solution in a receding-horizon loop. Advisory only: an
     *  infeasible, partial, or suboptimal hint never changes the returned
     *  optimum, only the path to it. Entries naming unknown variables are
     *  ignored (variables may drop out between re-solves). Honoured by
     *  backends with hint support (SCIP); hint-less backends (Glop) ignore
     *  it. */
    hints: OptionType(ArrayType(LinearHintType)),
});

/** LP/MIP result. */
export const LinearResultType = StructType({
    status: GoogleOrStatusType,
    objective_value: OptionType(FloatType),
    assignments: DictType(StringType, FloatType),
    wall_time: FloatType,
});

/**
 * A linear program in columns, the form a solver takes in bulk: its
 * variables by index and its constraints by rows, so the model crosses
 * between the East runtime and the solver as vectors — whole, never an
 * element at a time — where {@link LinearModelType} names every variable and
 * term.
 *
 * Variable `i` has the bounds `[var_lower[i], var_upper[i]]` and is integer
 * when `var_integer[i]`. Constraint `r` holds its sum in
 * `[row_lower[r], row_upper[r]]` (an unbounded side is `-1e20` or `1e20`, as
 * {@link LinearConstraintDefType} spells it) and its terms are
 * `coeff[k] * variable(col_ix[k])` for `k` in `row_ptr[r] .. row_ptr[r + 1]`;
 * so `row_ptr` has one more entry than there are rows, starts at 0 and ends
 * at the term count. The objective is `objective[i] * variable(i)` summed,
 * maximized when `maximize`.
 */
export const LinearModelColumnsType = StructType({
    var_lower: VectorType(FloatType),
    var_upper: VectorType(FloatType),
    var_integer: VectorType(BooleanType),
    row_lower: VectorType(FloatType),
    row_upper: VectorType(FloatType),
    row_ptr: VectorType(IntegerType),
    col_ix: VectorType(IntegerType),
    coeff: VectorType(FloatType),
    objective: VectorType(FloatType),
    maximize: BooleanType,
});

/** A partial solution hint by variable index: `value[k]` for variable `index[k]`. */
export const LinearColumnsHintType = StructType({
    index: VectorType(IntegerType),
    value: VectorType(FloatType),
});

/** LP solver configuration for a columnar model: {@link LinearConfigType}'s
 *  fields, with the hint by variable index. A hint reaches the backend that
 *  takes one (SCIP); Glop and HiGHS ignore it. */
export const LinearColumnsConfigType = StructType({
    solver: OptionType(LinearSolverType),
    max_time_seconds: OptionType(FloatType),
    relative_gap_limit: OptionType(FloatType),
    hints: OptionType(LinearColumnsHintType),
});

/** A columnar LP/MIP solution: the variables' values by index, beside the
 *  status, objective and wall time of {@link LinearResultType}. `values` is
 *  empty unless the status is `optimal` or `feasible`. */
export const LinearColumnsResultType = StructType({
    status: GoogleOrStatusType,
    objective_value: OptionType(FloatType),
    values: VectorType(FloatType),
    wall_time: FloatType,
});

// ============================================================================
// Graph Algorithm Types
// ============================================================================

/** Min-cost flow network input. */
export const MinCostFlowInputType = StructType({
    start_nodes: ArrayType(IntegerType),
    end_nodes: ArrayType(IntegerType),
    capacities: ArrayType(IntegerType),
    unit_costs: ArrayType(IntegerType),
    supplies: ArrayType(IntegerType),
});

/** Min-cost flow result. */
export const MinCostFlowResultType = StructType({
    status: GoogleOrStatusType,
    total_cost: IntegerType,
    flows: ArrayType(IntegerType),
    wall_time: FloatType,
});

/** Max-flow network input. */
export const MaxFlowInputType = StructType({
    start_nodes: ArrayType(IntegerType),
    end_nodes: ArrayType(IntegerType),
    capacities: ArrayType(IntegerType),
    source: IntegerType,
    sink: IntegerType,
});

/** Max-flow result. */
export const MaxFlowResultType = StructType({
    status: GoogleOrStatusType,
    total_flow: IntegerType,
    flows: ArrayType(IntegerType),
    wall_time: FloatType,
});

/** Linear sum assignment cost matrix. */
export const AssignmentInputType = StructType({
    costs: ArrayType(ArrayType(IntegerType)),
});

/** A single worker-task assignment. */
export const AssignmentMatchType = StructType({
    worker: IntegerType,
    task: IntegerType,
    cost: IntegerType,
});

/** Assignment result. */
export const AssignmentResultType = StructType({
    status: GoogleOrStatusType,
    total_cost: IntegerType,
    assignments: ArrayType(AssignmentMatchType),
    wall_time: FloatType,
});

/** Sparse bipartite assignment input — one entry per legal `(worker, task)` arc. */
export const MinCostAssignmentInputType = StructType({
    /** Worker id of each candidate arc; 0-based, parallel to `tasks` and `costs`. */
    workers: ArrayType(IntegerType),
    /** Task id of each candidate arc; 0-based, parallel to `workers` and `costs`. */
    tasks: ArrayType(IntegerType),
    /** Cost of each candidate arc. */
    costs: ArrayType(IntegerType),
    /** Cost of leaving a worker unassigned, indexed by worker id. `none` means
     *  there is no opt-out — a worker with no available slot renders the whole
     *  problem infeasible. */
    unassigned_penalty: OptionType(ArrayType(IntegerType)),
    /** Maximum workers per task, indexed by task id. `none` means every task
     *  takes at most one worker. */
    task_capacity: OptionType(ArrayType(IntegerType)),
});

/** Sparse bipartite assignment result. */
export const MinCostAssignmentResultType = StructType({
    status: GoogleOrStatusType,
    /** The minimised objective: matched arc costs plus the `unassigned_penalty`
     *  of every unmatched worker. Equals the sum of `assignments[].cost` only
     *  when every worker was matched. */
    total_cost: IntegerType,
    /** Matched pairs only — unassigned workers are omitted. */
    assignments: ArrayType(AssignmentMatchType),
    wall_time: FloatType,
});

// ============================================================================
// Platform Functions
// ============================================================================

/** Solve a CP-SAT model and return the best solution. */
export const google_or_cpsat_solve = East.platform(
    "google_or_cpsat_solve",
    [CpSatModelType, CpSatConfigType],
    CpSatResultType
);

/** Solve a CP-SAT model and return all feasible solutions found. */
export const google_or_cpsat_solve_all = East.platform(
    "google_or_cpsat_solve_all",
    [CpSatModelType, CpSatConfigType],
    ArrayType(CpSatResultType)
);

/** Solve a CP-SAT model given in columns and return the best solution. */
export const google_or_cpsat_solve_columns = East.platform(
    "google_or_cpsat_solve_columns",
    [CpSatModelColumnsType, CpSatColumnsConfigType],
    CpSatColumnsResultType
);

/** Solve a vehicle routing problem. */
export const google_or_routing_solve = East.platform(
    "google_or_routing_solve",
    [RoutingModelType, RoutingConfigType],
    RoutingResultType
);

/** Solve a linear programming / MIP problem. */
export const google_or_linear_solve = East.platform(
    "google_or_linear_solve",
    [LinearModelType, LinearConfigType],
    LinearResultType
);

/** Solve a linear programming / MIP problem given in columns. */
export const google_or_linear_solve_columns = East.platform(
    "google_or_linear_solve_columns",
    [LinearModelColumnsType, LinearColumnsConfigType],
    LinearColumnsResultType
);

/** Solve a min-cost flow problem. */
export const google_or_min_cost_flow = East.platform(
    "google_or_min_cost_flow",
    [MinCostFlowInputType],
    MinCostFlowResultType
);

/** Solve a max-flow problem. */
export const google_or_max_flow = East.platform(
    "google_or_max_flow",
    [MaxFlowInputType],
    MaxFlowResultType
);

/** Solve a linear sum assignment problem. */
export const google_or_assignment = East.platform(
    "google_or_assignment",
    [AssignmentInputType],
    AssignmentResultType
);

/** Solve a sparse bipartite min-cost assignment problem. */
export const google_or_min_cost_assignment = East.platform(
    "google_or_min_cost_assignment",
    [MinCostAssignmentInputType],
    MinCostAssignmentResultType
);

// ============================================================================
// Grouped Exports
// ============================================================================

/** Type definitions for Google OR-Tools. */
export const GoogleOrTypes = {
    // Shared
    StatusType: GoogleOrStatusType,
    // CP-SAT
    CpSatIntVarType,
    CpSatBoolVarType,
    CpSatIntervalVarType,
    CpSatLinearTermType,
    CpSatLinearExprType,
    CpSatLiteralType,
    CpSatComparisonType,
    CpSatConstraintType,
    CpSatObjectiveType,
    CpSatModelType,
    CpSatHintType,
    CpSatConfigType,
    CpSatResultType,
    CpSatModelColumnsType,
    CpSatColumnsHintType,
    CpSatColumnsConfigType,
    CpSatColumnsResultType,
    // Routing
    RoutingFirstSolutionType,
    RoutingMetaheuristicType,
    RoutingTimeWindowType,
    RoutingPickupDeliveryType,
    RoutingModelType,
    RoutingConfigType,
    RoutingRouteType,
    RoutingResultType,
    // Linear
    LinearVarType,
    LinearTermType,
    LinearConstraintDefType,
    LinearObjectiveType,
    LinearModelType,
    LinearSolverType,
    LinearHintType,
    LinearConfigType,
    LinearResultType,
    LinearModelColumnsType,
    LinearColumnsHintType,
    LinearColumnsConfigType,
    LinearColumnsResultType,
    // Graph
    MinCostFlowInputType,
    MinCostFlowResultType,
    MaxFlowInputType,
    MaxFlowResultType,
    AssignmentInputType,
    AssignmentMatchType,
    AssignmentResultType,
    MinCostAssignmentInputType,
    MinCostAssignmentResultType,
} as const;

/**
 * Google OR-Tools optimization.
 *
 * Provides:
 * - CP-SAT: Constraint programming with SAT-based solving
 * - Routing: Vehicle routing (TSP, CVRP, VRPTW, VRPPD)
 * - Linear: Linear programming and mixed-integer programming
 * - Graph: Min-cost flow, max flow, linear sum assignment, sparse min-cost assignment
 */
export const GoogleOr = {
    /**
     * Solve a CP-SAT model and return the best solution.
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { GoogleOr, CpSatModelType, CpSatConfigType } from "@elaraai/east-py-datascience";
     *
     * const solve = East.function(
     *     [CpSatModelType],
     *     GoogleOr.Types.CpSatResultType,
     *     ($, model) => {
     *         const config = $.let({
     *             max_time_seconds: variant("some", 10.0),
     *             num_workers: variant("none", null),
     *             log_search_progress: variant("none", null),
     *             seed: variant("none", null),
     *             max_solutions: variant("none", null),
     *             relative_gap_limit: variant("none", null),
     *             absolute_gap_limit: variant("none", null),
     *             hints: variant("none", null),
     *         }, CpSatConfigType);
     *         return $.return(GoogleOr.cpsatSolve(model, config));
     *     }
     * );
     * ```
     */
    cpsatSolve: google_or_cpsat_solve,
    /**
     * Solve a CP-SAT model and return all feasible solutions found.
     *
     * @example
     * ```ts
     * import { East, ArrayType, variant } from "@elaraai/east";
     * import { GoogleOr, CpSatModelType, CpSatConfigType } from "@elaraai/east-py-datascience";
     *
     * const solveAll = East.function(
     *     [CpSatModelType],
     *     ArrayType(GoogleOr.Types.CpSatResultType),
     *     ($, model) => {
     *         const config = $.let({
     *             max_time_seconds: variant("some", 10.0),
     *             num_workers: variant("none", null),
     *             log_search_progress: variant("none", null),
     *             seed: variant("none", null),
     *             max_solutions: variant("some", 100n),
     *             relative_gap_limit: variant("none", null),
     *             absolute_gap_limit: variant("none", null),
     *             hints: variant("none", null),
     *         }, CpSatConfigType);
     *         return $.return(GoogleOr.cpsatSolveAll(model, config));
     *     }
     * );
     * ```
     */
    cpsatSolveAll: google_or_cpsat_solve_all,
    /**
     * Solve a CP-SAT model given in columns — its variables by index and its
     * linear constraints by rows, as vectors — and return the best solution,
     * the variables' values by index.
     *
     * @example
     * ```ts
     * import { East, none, some, variant } from "@elaraai/east";
     * import { GoogleOr } from "@elaraai/east-py-datascience";
     *
     * // maximize 2x + 3y with x + y <= 10, x and y in [0, 10]
     * const solve = East.function([], GoogleOr.Types.CpSatColumnsResultType, ($) => {
     *     const model = $.let({
     *         var_lower: new BigInt64Array([0n, 0n]),
     *         var_upper: new BigInt64Array([10n, 10n]),
     *         row_lower: new BigInt64Array([-9223372036854775808n]),
     *         row_upper: new BigInt64Array([10n]),
     *         row_ptr: new BigInt64Array([0n, 2n]),
     *         col_ix: new BigInt64Array([0n, 1n]),
     *         coeff: new BigInt64Array([1n, 1n]),
     *         objective: some({ coeff: new BigInt64Array([2n, 3n]), maximize: true }),
     *         names: none,
     *         interval_vars: [],
     *         constraints: [],
     *     }, GoogleOr.Types.CpSatModelColumnsType);
     *     const config = $.let({
     *         max_time_seconds: some(10.0), num_workers: none, log_search_progress: none,
     *         seed: some(42n), relative_gap_limit: none, absolute_gap_limit: none, hints: none,
     *     }, GoogleOr.Types.CpSatColumnsConfigType);
     *     return $.return(GoogleOr.cpsatSolveColumns(model, config));
     * });
     * ```
     */
    cpsatSolveColumns: google_or_cpsat_solve_columns,
    /**
     * Solve a vehicle routing problem.
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { GoogleOr, RoutingModelType, RoutingConfigType } from "@elaraai/east-py-datascience";
     *
     * const solve = East.function(
     *     [RoutingModelType],
     *     GoogleOr.Types.RoutingResultType,
     *     ($, model) => {
     *         const config = $.let({
     *             first_solution: variant("some", variant("path_cheapest_arc", null)),
     *             metaheuristic: variant("some", variant("guided_local_search", null)),
     *             max_time_seconds: variant("some", 30.0),
     *         }, RoutingConfigType);
     *         return $.return(GoogleOr.routingSolve(model, config));
     *     }
     * );
     * ```
     */
    routingSolve: google_or_routing_solve,
    /**
     * Solve a linear programming / MIP problem.
     *
     * @example
     * ```ts
     * import { East, variant } from "@elaraai/east";
     * import { GoogleOr, LinearModelType, LinearConfigType } from "@elaraai/east-py-datascience";
     *
     * const solve = East.function(
     *     [LinearModelType],
     *     GoogleOr.Types.LinearResultType,
     *     ($, model) => {
     *         const config = $.let({
     *             solver: variant("some", variant("highs", null)),
     *             max_time_seconds: variant("some", 60.0),
     *             relative_gap_limit: variant("none", null),
     *             hints: variant("none", null),
     *         }, LinearConfigType);
     *         return $.return(GoogleOr.linearSolve(model, config));
     *     }
     * );
     * ```
     */
    linearSolve: google_or_linear_solve,
    /**
     * Solve a linear programming / MIP problem given in columns — its
     * variables by index and its constraints by rows, as vectors — and
     * return the variables' values by index.
     *
     * @example
     * ```ts
     * import { East, none, variant } from "@elaraai/east";
     * import { GoogleOr } from "@elaraai/east-py-datascience";
     *
     * // maximize 3x + 2y with x + y <= 4, x and y in [0, 3]
     * const solve = East.function([], GoogleOr.Types.LinearColumnsResultType, ($) => {
     *     const model = $.let({
     *         var_lower: new Float64Array([0.0, 0.0]),
     *         var_upper: new Float64Array([3.0, 3.0]),
     *         var_integer: [false, false],
     *         row_lower: new Float64Array([-1e20]),
     *         row_upper: new Float64Array([4.0]),
     *         row_ptr: new BigInt64Array([0n, 2n]),
     *         col_ix: new BigInt64Array([0n, 1n]),
     *         coeff: new Float64Array([1.0, 1.0]),
     *         objective: new Float64Array([3.0, 2.0]),
     *         maximize: true,
     *     }, GoogleOr.Types.LinearModelColumnsType);
     *     const config = $.let({
     *         solver: none, max_time_seconds: none, relative_gap_limit: none, hints: none,
     *     }, GoogleOr.Types.LinearColumnsConfigType);
     *     return $.return(GoogleOr.linearSolveColumns(model, config));
     * });
     * ```
     */
    linearSolveColumns: google_or_linear_solve_columns,
    /**
     * Solve a min-cost flow problem.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { GoogleOr, MinCostFlowInputType } from "@elaraai/east-py-datascience";
     *
     * const solve = East.function(
     *     [MinCostFlowInputType],
     *     GoogleOr.Types.MinCostFlowResultType,
     *     ($, input) => {
     *         return $.return(GoogleOr.minCostFlow(input));
     *     }
     * );
     * ```
     */
    minCostFlow: google_or_min_cost_flow,
    /**
     * Solve a max-flow problem.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { GoogleOr, MaxFlowInputType } from "@elaraai/east-py-datascience";
     *
     * const solve = East.function(
     *     [MaxFlowInputType],
     *     GoogleOr.Types.MaxFlowResultType,
     *     ($, input) => {
     *         return $.return(GoogleOr.maxFlow(input));
     *     }
     * );
     * ```
     */
    maxFlow: google_or_max_flow,
    /**
     * Solve a linear sum assignment problem.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { GoogleOr, AssignmentInputType } from "@elaraai/east-py-datascience";
     *
     * const solve = East.function(
     *     [AssignmentInputType],
     *     GoogleOr.Types.AssignmentResultType,
     *     ($, input) => {
     *         return $.return(GoogleOr.assignment(input));
     *     }
     * );
     * ```
     */
    assignment: google_or_assignment,
    /**
     * Solve a sparse bipartite min-cost assignment problem.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { GoogleOr, MinCostAssignmentInputType } from "@elaraai/east-py-datascience";
     *
     * const solve = East.function(
     *     [MinCostAssignmentInputType],
     *     GoogleOr.Types.MinCostAssignmentResultType,
     *     ($, input) => {
     *         return $.return(GoogleOr.minCostAssignment(input));
     *     }
     * );
     * ```
     */
    minCostAssignment: google_or_min_cost_assignment,
    /** Type definitions. */
    Types: GoogleOrTypes,
} as const;
