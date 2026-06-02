#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""isinstance-style TypeGuards for the East value classes."""

from __future__ import annotations

from typing import Any, TypeGuard

from east.types.values.collections import EastArray, EastDict, EastSet
from east.types.values.primitives import EastBlob, EastNull
from east.types.values.structural import EastStruct, EastVariant, _PyEastVariant
from east.types.values.tensor import EastMatrix, EastVector


def is_east_null(v: Any) -> TypeGuard[EastNull]:
    """Check if a value is EastNull."""
    return isinstance(v, EastNull)


def is_east_blob(v: Any) -> TypeGuard[EastBlob]:
    """Check if a value is an EastBlob."""
    return isinstance(v, EastBlob)


def is_east_vector(v: Any) -> TypeGuard[EastVector]:
    """Check if a value is an EastVector."""
    return isinstance(v, EastVector)


def is_east_matrix(v: Any) -> TypeGuard[EastMatrix]:
    """Check if a value is an EastMatrix."""
    return isinstance(v, EastMatrix)


def is_east_array(v: Any) -> TypeGuard[EastArray]:
    """Check if a value is an EastArray."""
    return isinstance(v, EastArray)


def is_east_set(v: Any) -> TypeGuard[EastSet]:
    """Check if a value is an EastSet."""
    return isinstance(v, EastSet)


def is_east_dict(v: Any) -> TypeGuard[EastDict]:
    """Check if a value is an EastDict."""
    return isinstance(v, EastDict)


def is_east_struct(v: Any) -> TypeGuard[EastStruct]:
    """Check if a value is an EastStruct."""
    return isinstance(v, EastStruct)


def is_east_variant(v: Any) -> TypeGuard[EastVariant]:
    """Check if a value is an EastVariant.

    Only real variant objects qualify — a hand-rolled ``{"type": ..., "value":
    ...}`` dict is not a variant (build variants with ``variant()``/``some``/
    ``none``).
    """
    return isinstance(v, (EastVariant, _PyEastVariant))


def is_east_option(v: Any) -> TypeGuard[EastVariant]:
    """Check if a value is an Option variant (a variant tagged 'some' or 'none')."""
    return is_east_variant(v) and getattr(v, "type", None) in ("some", "none")


# =============================================================================
# Type checking and inference
# =============================================================================


