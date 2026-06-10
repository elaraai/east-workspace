#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Google OR-Tools for East - CP-SAT, vehicle routing, LP/MIP, and graph algorithms.

The ``*_impl`` functions are plain Python callables taking and returning East
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
    CpSatIntervalVarType,
    CpSatIntVarType,
    CpSatLinearExprType,
    CpSatLinearTermType,
    CpSatLiteralType,
    CpSatModelType,
    CpSatObjectiveType,
    CpSatResultType,
    cpsat_impl,
    cpsat_solve_all_impl,
    cpsat_solve_impl,
)
from east_py_datascience.google_or.graph import (
    AssignmentInputType,
    AssignmentMatchType,
    AssignmentResultType,
    MaxFlowInputType,
    MaxFlowResultType,
    MinCostFlowInputType,
    MinCostFlowResultType,
    assignment_impl,
    graph_impl,
    max_flow_impl,
    min_cost_flow_impl,
)
from east_py_datascience.google_or.linear import (
    LinearConfigType,
    LinearConstraintDefType,
    LinearModelType,
    LinearObjectiveType,
    LinearResultType,
    LinearSolverType,
    LinearTermType,
    LinearVarType,
    linear_impl,
    linear_solve_impl,
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
    routing_solve_impl,
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
    "cpsat_solve_impl",
    "cpsat_solve_all_impl",
    "routing_solve_impl",
    "linear_solve_impl",
    "min_cost_flow_impl",
    "max_flow_impl",
    "assignment_impl",
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
]
