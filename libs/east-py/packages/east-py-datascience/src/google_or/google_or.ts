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
});

/** CP-SAT solution result. */
export const CpSatResultType = StructType({
    status: GoogleOrStatusType,
    objective_value: OptionType(FloatType),
    assignments: DictType(StringType, IntegerType),
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

/** LP solver configuration. */
export const LinearConfigType = StructType({
    solver: OptionType(LinearSolverType),
    max_time_seconds: OptionType(FloatType),
});

/** LP/MIP result. */
export const LinearResultType = StructType({
    status: GoogleOrStatusType,
    objective_value: OptionType(FloatType),
    assignments: DictType(StringType, FloatType),
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
    CpSatConfigType,
    CpSatResultType,
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
    LinearConfigType,
    LinearResultType,
    // Graph
    MinCostFlowInputType,
    MinCostFlowResultType,
    MaxFlowInputType,
    MaxFlowResultType,
    AssignmentInputType,
    AssignmentMatchType,
    AssignmentResultType,
} as const;

/**
 * Google OR-Tools optimization.
 *
 * Provides:
 * - CP-SAT: Constraint programming with SAT-based solving
 * - Routing: Vehicle routing (TSP, CVRP, VRPTW, VRPPD)
 * - Linear: Linear programming and mixed-integer programming
 * - Graph: Min-cost flow, max flow, linear sum assignment
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
     *         }, CpSatConfigType);
     *         return $.return(GoogleOr.cpsatSolveAll(model, config));
     *     }
     * );
     * ```
     */
    cpsatSolveAll: google_or_cpsat_solve_all,
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
     *         }, LinearConfigType);
     *         return $.return(GoogleOr.linearSolve(model, config));
     *     }
     * );
     * ```
     */
    linearSolve: google_or_linear_solve,
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
    /** Type definitions. */
    Types: GoogleOrTypes,
} as const;
