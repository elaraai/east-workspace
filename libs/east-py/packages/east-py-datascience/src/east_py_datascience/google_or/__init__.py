#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Google OR-Tools for East - CP-SAT, vehicle routing, LP/MIP, and graph algorithms.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(model, config, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.google_or.cpsat import (
    CpSatBoolVarType,
    CpSatComparisonType,
    CpSatConfigType,
    CpSatConstraintType,
    CpSatHintType,
    CpSatIntervalVarType,
    CpSatIntVarType,
    CpSatLinearExprType,
    CpSatLinearTermType,
    CpSatLiteralType,
    CpSatModelType,
    CpSatObjectiveType,
    CpSatResultType,
    cpsat_impl,
    cpsat_solve,
    cpsat_solve_all,
)
from east_py_datascience.google_or.graph import (
    AssignmentInputType,
    AssignmentMatchType,
    AssignmentResultType,
    MaxFlowInputType,
    MaxFlowResultType,
    MinCostAssignmentInputType,
    MinCostAssignmentResultType,
    MinCostFlowInputType,
    MinCostFlowResultType,
    assignment,
    graph_impl,
    max_flow,
    min_cost_assignment,
    min_cost_flow,
)
from east_py_datascience.google_or.linear import (
    LinearConfigType,
    LinearConstraintDefType,
    LinearHintType,
    LinearModelType,
    LinearObjectiveType,
    LinearResultType,
    LinearSolverType,
    LinearTermType,
    LinearVarType,
    linear_impl,
    linear_solve,
)
from east_py_datascience.google_or.routing import (
    RoutingConfigType,
    RoutingFirstSolutionType,
    RoutingMetaheuristicType,
    RoutingModelType,
    RoutingPickupDeliveryType,
    RoutingResultType,
    RoutingRouteType,
    RoutingTimeWindowType,
    routing_impl,
    routing_solve,
)
from east_py_datascience.google_or.types import (
    GoogleOrStatusType,
)

google_or_impl = [*cpsat_impl, *routing_impl, *linear_impl, *graph_impl]

__all__ = [
    # Aggregated platform registration
    "google_or_impl",
    # Sub-module registrations
    "cpsat_impl",
    "routing_impl",
    "linear_impl",
    "graph_impl",
    # Directly-callable implementations
    "cpsat_solve",
    "cpsat_solve_all",
    "routing_solve",
    "linear_solve",
    "min_cost_flow",
    "max_flow",
    "assignment",
    "min_cost_assignment",
    # Shared types
    "GoogleOrStatusType",
    # CP-SAT types
    "CpSatIntVarType",
    "CpSatBoolVarType",
    "CpSatIntervalVarType",
    "CpSatLinearTermType",
    "CpSatLinearExprType",
    "CpSatLiteralType",
    "CpSatComparisonType",
    "CpSatConstraintType",
    "CpSatObjectiveType",
    "CpSatModelType",
    "CpSatHintType",
    "CpSatConfigType",
    "CpSatResultType",
    # Routing types
    "RoutingFirstSolutionType",
    "RoutingMetaheuristicType",
    "RoutingTimeWindowType",
    "RoutingPickupDeliveryType",
    "RoutingModelType",
    "RoutingConfigType",
    "RoutingRouteType",
    "RoutingResultType",
    # Linear types
    "LinearVarType",
    "LinearTermType",
    "LinearConstraintDefType",
    "LinearObjectiveType",
    "LinearModelType",
    "LinearSolverType",
    "LinearHintType",
    "LinearConfigType",
    "LinearResultType",
    # Graph types
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
