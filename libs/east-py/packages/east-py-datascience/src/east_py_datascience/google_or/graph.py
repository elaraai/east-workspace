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
- Sparse min-cost assignment — matching over legal arcs only, with scarce
  task capacity and an optional per-worker unassigned penalty
"""

import importlib.util
import time

from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    ArrayType,
    FloatType,
    IntegerType,
    OptionType,
    StructType,
)
from east.types.values import EastArray, EastStruct, EastVariant

from east_py_datascience.google_or.types import GoogleOrStatusType, _get_option

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

# --- Sparse min-cost assignment ---

MinCostAssignmentInputType = StructType(
    [
        ("workers", ArrayType(IntegerType)),
        ("tasks", ArrayType(IntegerType)),
        ("costs", ArrayType(IntegerType)),
        ("unassigned_penalty", OptionType(ArrayType(IntegerType))),
        ("task_capacity", OptionType(ArrayType(IntegerType))),
    ]
)
"""Input for a sparse bipartite min-cost assignment problem.

Fields: ``workers``, ``tasks``, ``costs`` (parallel ``Array<Integer>``, one
entry per legal ``(worker, task)`` arc; ids are 0-based),
``unassigned_penalty`` (``Option<Array<Integer>>`` cost of leaving a worker
unassigned, indexed by worker id — ``none`` means there is no opt-out, so a
worker with no available slot renders the problem infeasible),
``task_capacity`` (``Option<Array<Integer>>`` maximum workers per task,
indexed by task id — ``none`` means every task takes at most one worker).
"""

MinCostAssignmentResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_cost", IntegerType),
        ("assignments", ArrayType(AssignmentMatchType)),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_min_cost_assignment``.

Fields: ``status`` (``GoogleOrStatusType``), ``total_cost`` (``Integer`` the
minimised objective — matched arc costs plus the penalty of every unmatched
worker, so it equals the sum of ``assignments[].cost`` only when every worker
was matched; 0 when not solved), ``assignments``
(``Array<AssignmentMatchType>`` matched pairs only, unassigned workers
omitted; empty when not solved), ``wall_time`` (``Float`` seconds).
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
def min_cost_flow(
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
def max_flow(
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
def assignment(
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


@platform_function(
    name="google_or_min_cost_assignment",
    inputs=[MinCostAssignmentInputType],
    output=MinCostAssignmentResultType,
)
def min_cost_assignment(
    input_data: EastStruct,
) -> EastStruct:
    """Solve a sparse bipartite assignment using OR-Tools' SimpleMinCostFlow.

    Matches workers to scarce task slots at minimum total cost given only the
    legal ``(worker, task)`` pairs. Unlike ``google_or_assignment`` this takes
    sparse arcs instead of a dense cost matrix, lets a task absorb more than one
    worker, and can leave a worker unassigned at a stated penalty.

    It is solved as a min-cost flow over ``source -> workers -> tasks -> sink``
    with one unit of supply per worker, a ``task -> sink`` arc capped at each
    task's capacity, and — when ``unassigned_penalty`` is given — a direct
    ``worker -> sink`` arc carrying that worker's penalty. The network is
    integral so the flow optimum is an exact assignment optimum, and the
    algorithm is polynomial, so no time limit or optimality tolerance is needed.

    Args:
        input_data: ``MinCostAssignmentInputType`` (``EastStruct``) with fields:

            - ``workers`` (``Array<Integer>``): worker id of each candidate arc.
            - ``tasks`` (``Array<Integer>``): task id of each candidate arc.
            - ``costs`` (``Array<Integer>``): cost of each candidate arc. These
              three are parallel arrays and ids are 0-based dense indices.
            - ``unassigned_penalty`` (``Option<Array<Integer>>``): cost of
              leaving a worker unassigned, indexed by worker id. ``none`` means
              there is no opt-out, so a worker with no available slot renders
              the whole problem infeasible.
            - ``task_capacity`` (``Option<Array<Integer>>``): maximum workers
              per task, indexed by task id. ``none`` means every task takes at
              most one worker.

    Returns:
        ``MinCostAssignmentResultType`` (``EastStruct``): ``status``
        (``GoogleOrStatusType`` - ``optimal``, ``feasible``, ``infeasible``, or
        ``not_solved``), ``total_cost`` (``Integer`` the minimised objective —
        matched arc costs plus the penalty of every unmatched worker; 0 when not
        solved), ``assignments`` (``Array<AssignmentMatchType>`` matched pairs
        only, unassigned workers omitted; empty when not solved), ``wall_time``
        (``Float`` seconds).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
        ValueError: the arc arrays differ in length, an id is negative, a
            capacity is negative, or a supplied ``unassigned_penalty`` /
            ``task_capacity`` array is shorter than the ids the arcs reference.
    """
    _check_google_or_support()
    from ortools.graph.python import min_cost_flow

    start_time = time.perf_counter()

    arc_workers = [int(w) for w in input_data.get("workers")]
    arc_tasks = [int(t) for t in input_data.get("tasks")]
    arc_costs = [int(c) for c in input_data.get("costs")]

    if not len(arc_workers) == len(arc_tasks) == len(arc_costs):
        raise ValueError(
            "google_or_min_cost_assignment: workers, tasks and costs must be "
            f"parallel arrays of equal length; got {len(arc_workers)}, "
            f"{len(arc_tasks)} and {len(arc_costs)}."
        )
    if any(w < 0 for w in arc_workers) or any(t < 0 for t in arc_tasks):
        raise ValueError(
            "google_or_min_cost_assignment: worker and task ids must be "
            "non-negative 0-based indices."
        )

    penalty_option = _get_option(input_data.get("unassigned_penalty"), None)
    penalties = None if penalty_option is None else [int(p) for p in penalty_option]
    capacity_option = _get_option(input_data.get("task_capacity"), None)
    capacities = None if capacity_option is None else [int(c) for c in capacity_option]

    # A worker with no legal arc still occupies a slot in the network, so the
    # counts span the penalty/capacity arrays as well as the arcs.
    num_workers = max(
        [w + 1 for w in arc_workers] + [0 if penalties is None else len(penalties)]
    )
    num_tasks = max(
        [t + 1 for t in arc_tasks] + [0 if capacities is None else len(capacities)]
    )

    if penalties is not None and len(penalties) < num_workers:
        raise ValueError(
            "google_or_min_cost_assignment: unassigned_penalty has "
            f"{len(penalties)} entries but the arcs reference {num_workers} "
            "workers."
        )
    if capacities is not None:
        if len(capacities) < num_tasks:
            raise ValueError(
                "google_or_min_cost_assignment: task_capacity has "
                f"{len(capacities)} entries but the arcs reference {num_tasks} "
                "tasks."
            )
        if any(c < 0 for c in capacities):
            raise ValueError(
                "google_or_min_cost_assignment: task_capacity entries must be "
                "non-negative."
            )

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

    # Node layout: source 0 | workers [1, task_base) | tasks [task_base, sink) | sink
    task_base = 1 + num_workers
    sink = task_base + num_tasks

    smcf = min_cost_flow.SimpleMinCostFlow()

    for worker in range(num_workers):
        smcf.add_arc_with_capacity_and_unit_cost(0, 1 + worker, 1, 0)

    # Keep the arc handles: a positive flow on one is a match to read back.
    arc_ids = [
        smcf.add_arc_with_capacity_and_unit_cost(
            1 + arc_workers[i], task_base + arc_tasks[i], 1, arc_costs[i]
        )
        for i in range(len(arc_workers))
    ]

    for task in range(num_tasks):
        smcf.add_arc_with_capacity_and_unit_cost(
            task_base + task, sink, 1 if capacities is None else capacities[task], 0
        )

    if penalties is not None:
        for worker in range(num_workers):
            smcf.add_arc_with_capacity_and_unit_cost(
                1 + worker, sink, 1, penalties[worker]
            )

    smcf.set_node_supply(0, num_workers)
    smcf.set_node_supply(sink, -num_workers)

    status_code = smcf.solve()
    wall_time = time.perf_counter() - start_time

    if status_code in (smcf.OPTIMAL, smcf.FEASIBLE):
        matches = [
            EastStruct(
                {
                    "worker": arc_workers[i],
                    "task": arc_tasks[i],
                    "cost": arc_costs[i],
                }
            )
            for i, arc in enumerate(arc_ids)
            if smcf.flow(arc) > 0
        ]
        return EastStruct(
            {
                "status": EastVariant(
                    "optimal" if status_code == smcf.OPTIMAL else "feasible", None
                ),
                "total_cost": int(smcf.optimal_cost()),
                "assignments": EastArray(AssignmentMatchType, matches),
                "wall_time": wall_time,
            }
        )
    elif status_code == smcf.INFEASIBLE:
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
    "MinCostAssignmentInputType",
    "MinCostAssignmentResultType",
]
