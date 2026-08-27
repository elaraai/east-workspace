#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared low-level helpers for the value classes: dtype map, key/builtin bridges, key interning, UTC coercion."""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, TypeVar

import numpy as np

if TYPE_CHECKING:
    from east.types.types import EastType

T = TypeVar("T")
V = TypeVar("V")
K = TypeVar("K")
OptionT = TypeVar("OptionT")


# Vector/Matrix buffer widths.
EAST_ELEMENT_TO_DTYPE: dict[str, np.dtype] = {
    "Float": np.dtype(np.float64),
    "Integer": np.dtype(np.int64),
    "Boolean": np.dtype(np.bool_),
}

# NumPy dtype kinds accepted as runtime storage for each logical element.
_ELEMENT_DTYPE_KINDS: dict[str, frozenset[str]] = {
    "Float": frozenset({"f"}),  # float16 / float32 / float64
    "Integer": frozenset({"i", "u"}),  # signed / unsigned integers
    "Boolean": frozenset({"b"}),  # bool
}


def dtype_matches_element(dtype: Any, element_type: EastType) -> bool:
    """Whether a NumPy dtype is valid runtime storage for a logical element.

    A Vector/Matrix element type (Float, Integer, Boolean) accepts any NumPy
    dtype whose kind matches: Float ↔ floating, Integer ↔ signed/unsigned int,
    Boolean ↔ bool. ``uint64`` is rejected for Integer: East Integer is i64, and
    canonicalizing a uint64 buffer to int64 would silently overflow values above
    ``INT64_MAX``.
    """
    kinds = _ELEMENT_DTYPE_KINDS.get(element_type.type)
    if kinds is None:
        return False
    dt = np.dtype(dtype)
    if dt.kind not in kinds:
        return False
    # uint64 can exceed the i64 range it would be cast to crossing into east-c.
    return not (dt.kind == "u" and dt.itemsize >= 8)


# =============================================================================
# EastVector - Contiguous 1D numeric array
# =============================================================================


# Cached import for make_east_key to avoid repeated import overhead
_cached_make_east_key: Any = None


def _make_east_key(element_type: EastType) -> Any:
    """Create a key function for East ordering (lazy import to avoid cycles)."""
    global _cached_make_east_key
    if _cached_make_east_key is None:
        from east.utils.ordering import make_east_key

        _cached_make_east_key = make_east_key
    return _cached_make_east_key(element_type)


# Lazy import for the east-c builtin shim that backs the eager value methods.
# Same cycle-break pattern as make_east_key: values.py loads before the
# compiler/bridge Cython extensions.
_cached_call_builtin: Any = None
_kernel_trace_call: Any = None


def _call_builtin(name: str, type_params: list, args: list, output_type: EastType) -> Any:
    """Invoke an east-c builtin eagerly (lazy import of the Cython shim).

    Every namespace builtin (``East.String.*``, ``East.Float.*``, …) and eager
    collection method funnels through here — so when any argument is a traced
    ``Expression`` (the call is happening inside a captured body), the
    call emits East IR instead of executing (#393). That one seam makes the
    entire builtin surface traceable.
    """
    global _cached_call_builtin, _kernel_trace_call
    if _kernel_trace_call is None:
        from east.expression import trace_builtin_call

        _kernel_trace_call = trace_builtin_call
    traced = _kernel_trace_call(name, type_params, args, output_type)
    if traced is not None:
        return traced
    if _cached_call_builtin is None:
        try:
            from east.runtime._compiler_eastc import call_builtin
        except ImportError as e:  # pragma: no cover - native ext always present in practice
            raise RuntimeError(
                "Eager value methods require the compiled east-c extension "
                "(east.runtime._compiler_eastc); rebuild with `make install`."
            ) from e
        _cached_call_builtin = call_builtin
    return _cached_call_builtin(name, type_params, args, output_type)


# Key interning cache: shared keys tuple and key→index dict per schema
_key_cache: dict[tuple[str, ...], tuple[tuple[str, ...], dict[str, int]]] = {}


def _intern_keys(keys: tuple[str, ...]) -> tuple[tuple[str, ...], dict[str, int]]:
    """Intern a keys tuple so all structs with the same schema share one copy."""
    cached = _key_cache.get(keys)
    if cached is not None:
        return cached
    key_index = {k: i for i, k in enumerate(keys)}
    result = (keys, key_index)
    _key_cache[keys] = result
    return result


# Preserve pure-Python version for testing
_py_intern_keys = _intern_keys

with contextlib.suppress(ImportError):
    from east.types._values_cy import (  # type: ignore[import-not-found]
        cy_intern_keys as _intern_keys,
    )


def ensure_utc_datetime(dt: datetime) -> datetime:
    """Ensure datetime is UTC-aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    if dt.tzinfo != UTC:
        return dt.astimezone(UTC)
    return dt


# =============================================================================
# EastValue - Union of all East value types
# =============================================================================

