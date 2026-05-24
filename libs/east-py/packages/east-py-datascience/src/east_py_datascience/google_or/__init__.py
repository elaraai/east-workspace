#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Google OR-Tools platform functions for East Data Science.

Provides constraint programming (CP-SAT), vehicle routing, linear programming,
and graph algorithms using Google OR-Tools.
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
)
from east_py_datascience.google_or.graph import (
    AssignmentInputType,
    AssignmentMatchType,
    AssignmentResultType,
    MaxFlowInputType,
    MaxFlowResultType,
    MinCostFlowInputType,
    MinCostFlowResultType,
    graph_impl,
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
)
from east_py_datascience.google_or.types import (
    GoogleOrStatusType,
)

google_or_impl = [*cpsat_impl, *routing_impl, *linear_impl, *graph_impl]

__all__ = [
    # Aggregated platform implementation
    "google_or_impl",
    # Sub-module implementations
    "cpsat_impl",
    "routing_impl",
    "linear_impl",
    "graph_impl",
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
