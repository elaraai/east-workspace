#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared type definitions for Google OR-Tools platform functions.

Types used across multiple OR-Tools solvers (CP-SAT, routing, linear, graph).
"""

from typing import Any

from east.types.types import (
    NullType,
    VariantType,
)
from east.types.values import EastVariant, is_east_variant

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


# ============================================================================
# Helper Functions
# ============================================================================


def _get_option(opt: EastVariant | None, default: Any) -> Any:
    """Extract value from Option variant, returning default if None.

    Note: The runtime creates EastVariant instances, not EastOption instances,
    even for Option types. So we check the tag directly rather than using
    is_east_option().
    """
    if opt is None:
        return default
    if is_east_variant(opt) and opt.type == "some":
        return opt.value
    return default


__all__ = [
    "GoogleOrStatusType",
    "_get_option",
]
