#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Graph algorithm platform functions for East.

Provides network flow and assignment algorithms using Google OR-Tools for
East programs running in Python.

Includes:
- Min-cost flow — find cheapest flow satisfying supply/demand
- Max flow — find maximum flow from source to sink
- Linear sum assignment — optimal one-to-one matching minimizing total cost
"""

import importlib.util
import time

from east.runtime.platform import PlatformFunction
from east.types.types import (
    ArrayType,
    FloatType,
    IntegerType,
    StructType,
)
from east.types.values import EastArray, EastStruct, EastVariant

from east_py_datascience.google_or.types import GoogleOrStatusType

# ============================================================================
# Type Definitions
# ============================================================================

# --- Min-cost flow ---

MinCostFlowInputType = StructType(
    [
        ("start_nodes", ArrayType(IntegerType)),
        ("end_nodes", ArrayType(IntegerType)),
        ("capacities", ArrayType(IntegerType)),
        ("unit_costs", ArrayType(IntegerType)),
        ("supplies", ArrayType(IntegerType)),
    ]
)

MinCostFlowResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_cost", IntegerType),
        ("flows", ArrayType(IntegerType)),
        ("wall_time", FloatType),
    ]
)

# --- Max flow ---

MaxFlowInputType = StructType(
    [
        ("start_nodes", ArrayType(IntegerType)),
        ("end_nodes", ArrayType(IntegerType)),
        ("capacities", ArrayType(IntegerType)),
        ("source", IntegerType),
        ("sink", IntegerType),
    ]
)

MaxFlowResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_flow", IntegerType),
        ("flows", ArrayType(IntegerType)),
        ("wall_time", FloatType),
    ]
)

# --- Assignment ---

AssignmentInputType = StructType(
    [
        ("costs", ArrayType(ArrayType(IntegerType))),
    ]
)

AssignmentMatchType = StructType(
    [
        ("worker", IntegerType),
        ("task", IntegerType),
        ("cost", IntegerType),
    ]
)

AssignmentResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_cost", IntegerType),
        ("assignments", ArrayType(AssignmentMatchType)),
        ("wall_time", FloatType),
    ]
)



# Lazy import guard for optional dependency
_HAS_GOOGLE_OR_SUPPORT = importlib.util.find_spec("ortools") is not None


def _check_google_or_support() -> None:
    """Check if google_or support is available."""
    if not _HAS_GOOGLE_OR_SUPPORT:
        raise NotImplementedError(
            "Google_Or support requires the 'google-or' extra. "
            "Add east-py-datascience[google-or] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


def min_cost_flow_impl(
    input_data: EastStruct,
) -> EastStruct:
    """Solve a min-cost flow problem.

    Finds the minimum cost flow through a network that satisfies all
    supply/demand constraints and respects arc capacities.

    Args:
        input_data: Network definition (arcs, capacities, costs, supplies)

    Returns:
        EastStruct with status, total_cost, flows, wall_time
    """
    _check_google_or_support()
    from ortools.graph.python import min_cost_flow

    start_time = time.perf_counter()

    start_nodes = [int(n) for n in input_data.get("start_nodes")]
    end_nodes = [int(n) for n in input_data.get("end_nodes")]
    capacities = [int(c) for c in input_data.get("capacities")]
    unit_costs = [int(c) for c in input_data.get("unit_costs")]
    supplies = [int(s) for s in input_data.get("supplies")]

    smcf = min_cost_flow.SimpleMinCostFlow()

    for i in range(len(start_nodes)):
        smcf.add_arc_with_capacity_and_unit_cost(
            start_nodes[i], end_nodes[i], capacities[i], unit_costs[i]
        )

    for i, supply in enumerate(supplies):
        smcf.set_node_supply(i, supply)

    status_code = smcf.solve()
    wall_time = time.perf_counter() - start_time

    if status_code == smcf.OPTIMAL:
        flows = EastArray(
            IntegerType,
            [int(smcf.flow(i)) for i in range(smcf.num_arcs())],
        )
        return EastStruct(
            {
                "status": EastVariant("optimal", None),
                "total_cost": int(smcf.optimal_cost()),
                "flows": flows,
                "wall_time": wall_time,
            }
        )
    elif status_code == smcf.FEASIBLE:
        flows = EastArray(
            IntegerType,
            [int(smcf.flow(i)) for i in range(smcf.num_arcs())],
        )
        return EastStruct(
            {
                "status": EastVariant("feasible", None),
                "total_cost": int(smcf.optimal_cost()),
                "flows": flows,
                "wall_time": wall_time,
            }
        )
    elif status_code == smcf.INFEASIBLE:
        return EastStruct(
            {
                "status": EastVariant("infeasible", None),
                "total_cost": 0,
                "flows": EastArray(IntegerType, []),
                "wall_time": wall_time,
            }
        )
    else:
        return EastStruct(
            {
                "status": EastVariant("not_solved", None),
                "total_cost": 0,
                "flows": EastArray(IntegerType, []),
                "wall_time": wall_time,
            }
        )


def max_flow_impl(
    input_data: EastStruct,
) -> EastStruct:
    """Solve a max-flow problem.

    Finds the maximum flow from source to sink through a network.

    Args:
        input_data: Network definition (arcs, capacities, source, sink)

    Returns:
        EastStruct with status, total_flow, flows, wall_time
    """
    _check_google_or_support()
    from ortools.graph.python import max_flow

    start_time = time.perf_counter()

    start_nodes = [int(n) for n in input_data.get("start_nodes")]
    end_nodes = [int(n) for n in input_data.get("end_nodes")]
    capacities = [int(c) for c in input_data.get("capacities")]
    source = int(input_data.get("source"))
    sink = int(input_data.get("sink"))

    smf = max_flow.SimpleMaxFlow()

    for i in range(len(start_nodes)):
        smf.add_arc_with_capacity(start_nodes[i], end_nodes[i], capacities[i])

    status_code = smf.solve(source, sink)
    wall_time = time.perf_counter() - start_time

    if status_code == smf.OPTIMAL:
        flows = EastArray(
            IntegerType,
            [int(smf.flow(i)) for i in range(smf.num_arcs())],
        )
        return EastStruct(
            {
                "status": EastVariant("optimal", None),
                "total_flow": int(smf.optimal_flow()),
                "flows": flows,
                "wall_time": wall_time,
            }
        )
    else:
        return EastStruct(
            {
                "status": EastVariant("not_solved", None),
                "total_flow": 0,
                "flows": EastArray(IntegerType, []),
                "wall_time": wall_time,
            }
        )


def assignment_impl(
    input_data: EastStruct,
) -> EastStruct:
    """Solve a linear sum assignment problem.

    Finds the optimal one-to-one assignment of workers to tasks that
    minimizes total cost.

    Args:
        input_data: Cost matrix (workers x tasks)

    Returns:
        EastStruct with status, total_cost, assignments, wall_time
    """
    _check_google_or_support()
    from ortools.graph.python import linear_sum_assignment

    start_time = time.perf_counter()

    costs_data = input_data.get("costs")
    num_workers = len(costs_data)
    if num_workers == 0:
        wall_time = time.perf_counter() - start_time
        return EastStruct(
            {
                "status": EastVariant("optimal", None),
                "total_cost": 0,
                "assignments": EastArray(AssignmentMatchType, []),
                "wall_time": wall_time,
            }
        )

    assignment = linear_sum_assignment.SimpleLinearSumAssignment()

    for worker in range(num_workers):
        row = costs_data[worker]
        for task in range(len(row)):
            assignment.add_arc_with_cost(worker, task, int(row[task]))

    status_code = assignment.solve()
    wall_time = time.perf_counter() - start_time

    if status_code == assignment.OPTIMAL:
        matches: list[EastStruct] = []
        total_cost = 0
        for worker in range(assignment.num_nodes()):
            task = assignment.right_mate(worker)
            cost = assignment.assignment_cost(worker)
            total_cost += cost
            matches.append(
                EastStruct(
                    {
                        "worker": worker,
                        "task": task,
                        "cost": int(cost),
                    }
                )
            )

        return EastStruct(
            {
                "status": EastVariant("optimal", None),
                "total_cost": int(total_cost),
                "assignments": EastArray(AssignmentMatchType, matches),
                "wall_time": wall_time,
            }
        )
    elif status_code == assignment.INFEASIBLE:
        return EastStruct(
            {
                "status": EastVariant("infeasible", None),
                "total_cost": 0,
                "assignments": EastArray(AssignmentMatchType, []),
                "wall_time": wall_time,
            }
        )
    else:
        return EastStruct(
            {
                "status": EastVariant("not_solved", None),
                "total_cost": 0,
                "assignments": EastArray(AssignmentMatchType, []),
                "wall_time": wall_time,
            }
        )


# ============================================================================
# Platform Function Registration
# ============================================================================

graph_impl = [
    PlatformFunction(
        name="google_or_min_cost_flow",
        inputs=[MinCostFlowInputType],
        output=MinCostFlowResultType,
        type="sync",
        fn=min_cost_flow_impl,
    ),
    PlatformFunction(
        name="google_or_max_flow",
        inputs=[MaxFlowInputType],
        output=MaxFlowResultType,
        type="sync",
        fn=max_flow_impl,
    ),
    PlatformFunction(
        name="google_or_assignment",
        inputs=[AssignmentInputType],
        output=AssignmentResultType,
        type="sync",
        fn=assignment_impl,
    ),
]


__all__ = [
    # Platform implementation
    "graph_impl",
    # Types
    "MinCostFlowInputType",
    "MinCostFlowResultType",
    "MaxFlowInputType",
    "MaxFlowResultType",
    "AssignmentInputType",
    "AssignmentMatchType",
    "AssignmentResultType",
]
