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

from east.runtime.platform import platform_function, platform_functions
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
"""Input for a minimum-cost flow problem.

Fields: ``start_nodes`` (``Array<Integer>`` tail node of each arc),
``end_nodes`` (``Array<Integer>`` head node, parallel to ``start_nodes``),
``capacities`` (``Array<Integer>`` max flow on each arc),
``unit_costs`` (``Array<Integer>`` cost per unit of flow on each arc),
``supplies`` (``Array<Integer>`` net supply per node — positive produces
flow, negative consumes; must sum to zero for feasibility).
"""

MinCostFlowResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_cost", IntegerType),
        ("flows", ArrayType(IntegerType)),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_min_cost_flow``.

Fields: ``status`` (``GoogleOrStatusType``), ``total_cost`` (``Integer``
optimal objective when feasible; 0 otherwise), ``flows`` (``Array<Integer>``
per-arc flow in arc-declaration order; empty when infeasible), ``wall_time``
(``Float`` seconds).
"""

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
"""Input for a maximum-flow problem.

Fields: ``start_nodes`` (``Array<Integer>`` tail node of each arc),
``end_nodes`` (``Array<Integer>`` head node, parallel to ``start_nodes``),
``capacities`` (``Array<Integer>`` max flow on each arc), ``source``
(``Integer`` source node index), ``sink`` (``Integer`` sink node index).
"""

MaxFlowResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_flow", IntegerType),
        ("flows", ArrayType(IntegerType)),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_max_flow``.

Fields: ``status`` (``GoogleOrStatusType`` — ``optimal`` when solved),
``total_flow`` (``Integer`` maximum flow value; 0 when not solved),
``flows`` (``Array<Integer>`` per-arc flow in arc-declaration order; empty
when not solved), ``wall_time`` (``Float`` seconds).
"""

# --- Assignment ---

AssignmentInputType = StructType(
    [
        ("costs", ArrayType(ArrayType(IntegerType))),
    ]
)
"""Input for a linear sum assignment problem.

Fields: ``costs`` (``Array<Array<Integer>>`` cost matrix of shape
[num_workers][num_tasks]; ``costs[i][j]`` is the cost of assigning worker
``i`` to task ``j``).
"""

AssignmentMatchType = StructType(
    [
        ("worker", IntegerType),
        ("task", IntegerType),
        ("cost", IntegerType),
    ]
)
"""One worker-to-task pairing in an assignment solution.

Fields: ``worker`` (``Integer`` worker index), ``task`` (``Integer`` task
index), ``cost`` (``Integer`` cost of this specific pairing).
"""

AssignmentResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_cost", IntegerType),
        ("assignments", ArrayType(AssignmentMatchType)),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_assignment``.

Fields: ``status`` (``GoogleOrStatusType`` — ``optimal``, ``infeasible``,
or ``not_solved``), ``total_cost`` (``Integer`` sum of assigned costs when
optimal; 0 otherwise), ``assignments`` (``Array<AssignmentMatchType>`` one
entry per worker when optimal; empty otherwise), ``wall_time`` (``Float``
seconds).
"""



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


@platform_function(
    name="google_or_min_cost_flow",
    inputs=[MinCostFlowInputType],
    output=MinCostFlowResultType,
)
def min_cost_flow_impl(
    input_data: EastStruct,
) -> EastStruct:
    """Solve a minimum-cost flow problem using OR-Tools' SimpleMinCostFlow.

    Finds the cheapest feasible flow through a directed network that satisfies
    all node supply/demand values while respecting arc capacities.

    Args:
        input_data: ``MinCostFlowInputType`` (``EastStruct``) with fields:

            - ``start_nodes`` (``Array<Integer>``): tail node index of each
              arc (parallel array with ``end_nodes``).
            - ``end_nodes`` (``Array<Integer>``): head node index of each arc.
            - ``capacities`` (``Array<Integer>``): maximum flow on each arc.
            - ``unit_costs`` (``Array<Integer>``): cost per unit of flow on
              each arc.
            - ``supplies`` (``Array<Integer>``): net supply at each node; a
              positive value means the node produces flow, negative means it
              consumes; values must sum to zero for the problem to be feasible.

    Returns:
        ``MinCostFlowResultType`` (``EastStruct``): ``status``
        (``GoogleOrStatusType`` - ``optimal``, ``feasible``, ``infeasible``,
        or ``not_solved``), ``total_cost`` (``Integer`` optimal objective
        when feasible/optimal; 0 otherwise), ``flows`` (``Array<Integer>``
        per-arc flow in the same order as ``start_nodes``; empty when
        infeasible), ``wall_time`` (``Float`` seconds).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
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


@platform_function(
    name="google_or_max_flow",
    inputs=[MaxFlowInputType],
    output=MaxFlowResultType,
)
def max_flow_impl(
    input_data: EastStruct,
) -> EastStruct:
    """Solve a maximum-flow problem using OR-Tools' SimpleMaxFlow.

    Finds the maximum flow that can be pushed from a single source to a single
    sink through a directed network with arc capacities.

    Args:
        input_data: ``MaxFlowInputType`` (``EastStruct``) with fields:

            - ``start_nodes`` (``Array<Integer>``): tail node index of each arc.
            - ``end_nodes`` (``Array<Integer>``): head node index of each arc.
            - ``capacities`` (``Array<Integer>``): maximum flow on each arc.
            - ``source`` (``Integer``): index of the source node.
            - ``sink`` (``Integer``): index of the sink node.

    Returns:
        ``MaxFlowResultType`` (``EastStruct``): ``status``
        (``GoogleOrStatusType`` - ``optimal`` when solved, ``not_solved``
        otherwise), ``total_flow`` (``Integer`` maximum flow value when
        optimal; 0 otherwise), ``flows`` (``Array<Integer>`` per-arc flow in
        the same order as ``start_nodes``; empty when not solved), ``wall_time``
        (``Float`` seconds).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
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


@platform_function(
    name="google_or_assignment",
    inputs=[AssignmentInputType],
    output=AssignmentResultType,
)
def assignment_impl(
    input_data: EastStruct,
) -> EastStruct:
    """Solve a linear sum assignment problem using OR-Tools' Hungarian algorithm.

    Finds the optimal one-to-one assignment of workers to tasks that minimizes
    total cost. The number of workers and tasks need not be equal; the solver
    handles rectangular cost matrices.

    Args:
        input_data: ``AssignmentInputType`` (``EastStruct``) with field:

            - ``costs`` (``Array<Array<Integer>>``): cost matrix of shape
              [num_workers][num_tasks]; ``costs[i][j]`` is the cost of
              assigning worker ``i`` to task ``j``.  An empty outer array
              returns an optimal result with zero cost and no assignments.

    Returns:
        ``AssignmentResultType`` (``EastStruct``): ``status``
        (``GoogleOrStatusType`` - ``optimal`` when solved, ``infeasible``
        when no valid assignment exists, ``not_solved`` on other errors),
        ``total_cost`` (``Integer`` sum of assigned costs when optimal; 0
        otherwise), ``assignments`` (``Array<AssignmentMatchType>`` - one
        ``{worker: Integer, task: Integer, cost: Integer}`` per worker when
        optimal; empty otherwise), ``wall_time`` (``Float`` seconds).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
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

graph_impl = platform_functions(__name__)


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
