#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared type definitions for Google OR-Tools platform functions.

Types used across multiple OR-Tools solvers (CP-SAT, routing, linear, graph).
"""


from east.types.types import (
    NullType,
    VariantType,
)

from east_py_datascience._common import extra_guard

# One guard for the whole google_or package: every solver module imports it.
_check_google_or_support = extra_guard("ortools", "google-or", "Google OR-Tools")

# ============================================================================
# Shared Types
# ============================================================================

# Solver status — shared across all OR-Tools solvers
GoogleOrStatusType = VariantType(
    [
        ("optimal", NullType),
        ("feasible", NullType),
        ("infeasible", NullType),
        ("not_solved", NullType),
        ("model_invalid", NullType),
    ]
)
"""Solver outcome status shared across all OR-Tools platform functions.

Cases: ``optimal`` (proven optimal solution found), ``feasible`` (valid but
not proven optimal), ``infeasible`` (no feasible solution exists),
``not_solved`` (timed out or aborted without a solution), ``model_invalid``
(the model description is malformed or the requested backend is unavailable).
"""


__all__ = [
    "GoogleOrStatusType",
    "_check_google_or_support",
]
