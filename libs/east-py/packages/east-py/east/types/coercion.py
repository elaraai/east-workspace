#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Runtime validation and coercion at the Python <-> East boundary.

These functions let plain-Python code carry East *values* as data and hand them
across the boundary (platform functions, serialization) safely:

- ``assert_value_of`` / ``explain_value_of`` — validate a value against a type,
  with a path-pinpointed reason on failure (``$.rows[2].price``).
- ``coerce_to`` — best-effort canonicalization *driven by the declared type*:
  ``int`` -> Float, ``list`` -> Array, name-keyed ``dict`` -> Struct (reordered
  to the type), ``bytes`` -> Blob, ``list``/``ndarray`` -> Vector/Matrix at the
  element's canonical storage dtype, 1-D ``ndarray`` -> Array of
  Float/Integer/Boolean elements filled C-side in one bulk crossing. Produces
  a value the C bridge accepts without surprise.
- ``EastTypeError`` — the failure raised by the above.

Integer-vs-Float is always decided from the *declared* type (Python has no
bigint/float split), never inferred — so a Float-intended ``3`` is coerced to
``3.0`` rather than silently treated as an Integer.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import numpy as np

from east.runtime.errors import EastError
from east.types.types import (
    EastType,
    IntegerType,
    StringType,
    StructType,
)
from east.types.values import (
    EAST_ELEMENT_TO_DTYPE,
    EastArray,
    EastBlob,
    EastDict,
    EastMatrix,
    EastNull,
    EastRef,
    EastSet,
    EastStruct,
    EastValue,
    EastVariant,
    EastVector,
    dtype_matches_element,
    east_null,
    ensure_utc_datetime,
    is_east_struct,
    is_east_variant,
    is_value_of,
)

# Location struct type for boundary errors (no IR location is available).
_LOCATION_TYPE = StructType(
    [("filename", StringType), ("line", IntegerType), ("column", IntegerType)]
)


class EastTypeError(EastError):
    """A value failed to validate against / coerce to an East type at a boundary.

    Carries the offending ``value``, the ``expected`` East type, and the
    JSON-style ``path`` to the failing position so callers get a precise reason
    instead of a downstream ``KeyError``/``AttributeError``.
    """

    def __init__(
        self,
        message: str,
        *,
        value: Any = None,
        expected: EastType | None = None,
        path: str = "$",
    ):
        self.bad_value = value
        self.expected = expected
        self.path = path
        # A boundary error has no IR source location; give it an empty stack.
        super().__init__(message, EastArray(_LOCATION_TYPE, []))


def _describe(value: Any) -> str:
    """A short description of a Python value's type for error messages."""
    if value is None:
        return "None"
    return type(value).__name__


# =============================================================================
# explain_value_of / assert_value_of
# =============================================================================


def explain_value_of(value: EastValue, typ: EastType) -> list[tuple[str, str]]:
    """Return ``[(path, reason), ...]`` for every way ``value`` fails ``typ``.

    An empty list means the value conforms. Example reason:
    ``("$.rows[2].price", "expected Float, got str")``.
    """
    out: list[tuple[str, str]] = []
    _explain(value, typ, "$", [], out)
    return out


def assert_value_of(value: EastValue, typ: EastType, *, path: str = "$") -> EastValue:
    """Validate ``value`` against ``typ``; raise ``EastTypeError`` on the first failure.

    ``path`` is the root label for reported positions (e.g. ``"$.inputs[0]"``).
    Returns ``value`` unchanged so it can be used inline.
    """
    problems: list[tuple[str, str]] = []
    _explain(value, typ, path, [], problems)
    if problems:
        bad_path, reason = problems[0]
        raise EastTypeError(f"{reason} (at {bad_path})", value=value, expected=typ, path=bad_path)
    return value


def _explain(
    value: Any, typ: EastType, path: str, type_ctx: list[EastType], out: list[tuple[str, str]]
) -> None:
    kind = typ["type"]

    if kind == "Never":
        out.append((path, "expected Never (no values are valid)"))
        return
    if kind == "Null":
        if not (value is None or isinstance(value, EastNull)):
            out.append((path, f"expected Null, got {_describe(value)}"))
        return
    if kind == "Boolean":
        if not isinstance(value, bool):
            out.append((path, f"expected Boolean, got {_describe(value)}"))
        return
    if kind == "Integer":
        if not isinstance(value, int) or isinstance(value, bool):
            out.append((path, f"expected Integer, got {_describe(value)}"))
        return
    if kind == "Float":
        if not isinstance(value, float):
            out.append((path, f"expected Float, got {_describe(value)}"))
        return
    if kind == "String":
        if not isinstance(value, str):
            out.append((path, f"expected String, got {_describe(value)}"))
        return
    if kind == "DateTime":
        if not isinstance(value, datetime):
            out.append((path, f"expected DateTime, got {_describe(value)}"))
        return
    if kind == "Blob":
        if not isinstance(value, (bytes, bytearray)):
            out.append((path, f"expected Blob, got {_describe(value)}"))
        return
    if kind in ("Vector", "Matrix"):
        cls = EastVector if kind == "Vector" else EastMatrix
        if not isinstance(value, cls):
            out.append((path, f"expected {kind}, got {_describe(value)}"))
        elif value.element_type.type != typ["value"]["type"]:
            out.append(
                (path, f"expected {kind}<{typ['value']['type']}>, got {kind}<{value.element_type.type}>")
            )
        elif not dtype_matches_element(value._data.dtype, value.element_type):
            out.append(
                (path, f"{kind}<{value.element_type.type}> has incompatible storage dtype {value._data.dtype}")
            )
        return
    if kind == "Ref":
        if not isinstance(value, EastRef):
            out.append((path, f"expected Ref, got {_describe(value)}"))
            return
        type_ctx.append(typ)
        try:
            _explain(value.value, typ["value"], f"{path}.&", type_ctx, out)
        finally:
            type_ctx.pop()
        return
    if kind == "Array":
        if not isinstance(value, EastArray):
            out.append((path, f"expected Array, got {_describe(value)}"))
            return
        type_ctx.append(typ)
        try:
            for i, elem in enumerate(value):
                _explain(elem, typ["value"], f"{path}[{i}]", type_ctx, out)
        finally:
            type_ctx.pop()
        return
    if kind == "Set":
        if not isinstance(value, EastSet):
            out.append((path, f"expected Set, got {_describe(value)}"))
            return
        type_ctx.append(typ)
        try:
            for i, elem in enumerate(value):
                _explain(elem, typ["value"], f"{path}{{{i}}}", type_ctx, out)
        finally:
            type_ctx.pop()
        return
    if kind == "Dict":
        if not isinstance(value, EastDict):
            out.append((path, f"expected Dict, got {_describe(value)}"))
            return
        dt = typ["value"]
        type_ctx.append(typ)
        try:
            for k, v in value.items():
                _explain(k, dt["key"], f"{path}<key>", type_ctx, out)
                _explain(v, dt["value"], f"{path}[{k!r}]", type_ctx, out)
        finally:
            type_ctx.pop()
        return
    if kind == "Struct":
        if not is_east_struct(value):
            out.append((path, f"expected Struct, got {_describe(value)}"))
            return
        type_fields = typ["value"]
        type_names = {fd["name"] for fd in type_fields}
        type_ctx.append(typ)
        try:
            for fd in type_fields:
                name = fd["name"]
                if name not in value:
                    out.append((f"{path}.{name}", f"missing field {name!r}"))
                    continue
                _explain(value[name], fd["type"], f"{path}.{name}", type_ctx, out)
            for vk in value:
                if vk not in type_names:
                    out.append((f"{path}.{vk}", f"unexpected field {vk!r}"))
        finally:
            type_ctx.pop()
        return
    if kind == "Variant":
        if not is_east_variant(value):
            out.append((path, f"expected Variant, got {_describe(value)}"))
            return
        cases = typ["value"]
        tag = value.type
        match = next((c for c in cases if c["name"] == tag), None)
        if match is None:
            names = ", ".join(c["name"] for c in cases)
            out.append((path, f"variant case {tag!r} not in {{{names}}}"))
            return
        type_ctx.append(typ)
        try:
            _explain(value.value, match["type"], f"{path}.{tag}", type_ctx, out)
        finally:
            type_ctx.pop()
        return
    if kind == "Recursive":
        # Delegate the recursive subtree to is_value_of (which guards cycles).
        scope_id = typ["value"]
        idx = len(type_ctx) - scope_id
        if idx < 0 or idx >= len(type_ctx):
            out.append((path, f"invalid recursive scope_id {scope_id}"))
            return
        if not is_value_of(value, type_ctx[idx], list(type_ctx)):
            out.append((path, "does not match the recursive type"))
        return
    if kind == "Function":
        out.append((path, "functions cannot be validated at the Python boundary"))
        return
    out.append((path, f"unknown type kind {kind!r}"))


# =============================================================================
# coerce_to
# =============================================================================


def coerce_to(value: object, typ: EastType, *, path: str = "$") -> EastValue:
    """Canonicalize ``value`` to a bridge-ready East value of type ``typ``.

    Coercion is driven by the *declared* type: ``int`` -> Float, ``list`` ->
    Array/Vector, name-keyed ``dict`` -> Struct (reordered + coerced field by
    field), ``bytes``/``bytearray`` -> Blob, ``list``/``ndarray`` ->
    Vector/Matrix at the element's canonical storage dtype. A 1-D ``ndarray``
    against ``Array<Float/Integer/Boolean>`` fills C-side through the bulk
    buffer path — one crossing per column, so struct fields can be handed
    numpy columns directly. Raises ``EastTypeError`` (path-pinpointed) on
    the irreconcilable.
    """
    return _coerce(value, typ, path, [])


def _coerce(value: Any, typ: EastType, path: str, type_ctx: list[EastType]) -> EastValue:
    kind = typ["type"]

    if kind == "Null":
        if value is None or isinstance(value, EastNull):
            return east_null
        raise EastTypeError(f"expected Null, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, np.bool_):
            return bool(value)
        raise EastTypeError(f"expected Boolean, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Integer":
        if isinstance(value, bool):
            raise EastTypeError("expected Integer, got bool", value=value, expected=typ, path=path)
        if isinstance(value, int):
            return value
        if isinstance(value, np.integer):
            return int(value)
        raise EastTypeError(f"expected Integer, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Float":
        if isinstance(value, bool):
            raise EastTypeError("expected Float, got bool", value=value, expected=typ, path=path)
        if isinstance(value, float):
            return value
        if isinstance(value, (int, np.integer, np.floating)):
            return float(value)
        raise EastTypeError(f"expected Float, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "String":
        if isinstance(value, str):
            return value
        raise EastTypeError(f"expected String, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "DateTime":
        if isinstance(value, datetime):
            return ensure_utc_datetime(value)
        raise EastTypeError(f"expected DateTime, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Blob":
        if isinstance(value, EastBlob):
            return value
        if isinstance(value, (bytes, bytearray, list)):
            try:
                return EastBlob(value)
            except (TypeError, ValueError) as e:
                raise EastTypeError(f"cannot make Blob from {_describe(value)}: {e}", value=value, expected=typ, path=path) from None
        raise EastTypeError(f"expected Blob, got {_describe(value)}", value=value, expected=typ, path=path)

    if kind in ("Vector", "Matrix"):
        elem = typ["value"]
        if elem["type"] not in EAST_ELEMENT_TO_DTYPE:
            raise EastTypeError(f"{kind} element must be Float/Integer/Boolean, got {elem['type']}", value=value, expected=typ, path=path)
        canonical = EAST_ELEMENT_TO_DTYPE[elem["type"]]
        cls = EastVector if kind == "Vector" else EastMatrix
        if isinstance(value, cls):
            if value.element_type.type == elem["type"] and dtype_matches_element(value._data.dtype, value.element_type):
                return value
            # Wrong logical element or dtype — re-cast onto the declared element.
            return cls(elem, np.asarray(value._data).astype(canonical))
        if isinstance(value, (np.ndarray, list, tuple)):
            arr = np.asarray(value)
            if not dtype_matches_element(arr.dtype, elem):
                arr = arr.astype(canonical)
            want_ndim = 1 if kind == "Vector" else 2
            if arr.ndim != want_ndim:
                raise EastTypeError(
                    f"{kind}<{elem['type']}> needs a {want_ndim}-D array, got a {arr.ndim}-D input",
                    value=value, expected=typ, path=path,
                )
            try:
                return cls(elem, arr)
            except (TypeError, ValueError) as e:
                raise EastTypeError(f"cannot make {kind}<{elem['type']}>: {e}", value=value, expected=typ, path=path) from None
        raise EastTypeError(f"expected {kind} or array-like, got {_describe(value)}", value=value, expected=typ, path=path)

    if kind == "Array":
        elem = typ["value"]
        if isinstance(value, np.ndarray):
            return _coerce_array_from_numpy(value, typ, elem, path)
        if (
            isinstance(value, EastArray)
            and elem["type"] in EAST_ELEMENT_TO_DTYPE
            and value.element_type == elem
        ):
            # Same scalar element type: the per-element rebuild below could
            # only reproduce each element unchanged, so copy C-to-C instead
            # (extend's no-boxing path).
            out: EastArray = EastArray(elem, [])
            out.extend(value)
            return out
        if isinstance(value, (list, tuple, EastArray)):
            type_ctx.append(typ)
            try:
                return EastArray(elem, [_coerce(it, elem, f"{path}[{i}]", type_ctx) for i, it in enumerate(value)])
            finally:
                type_ctx.pop()
        raise EastTypeError(f"expected Array or list, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Set":
        elem = typ["value"]
        if isinstance(value, (EastSet, set, frozenset, list, tuple)):
            type_ctx.append(typ)
            try:
                return EastSet(elem, [_coerce(it, elem, f"{path}{{{i}}}", type_ctx) for i, it in enumerate(value)])
            finally:
                type_ctx.pop()
        raise EastTypeError(f"expected Set or iterable, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Dict":
        dt = typ["value"]
        if isinstance(value, (dict, EastDict)):
            result: EastDict = EastDict(dt["key"], dt["value"])
            type_ctx.append(typ)
            try:
                for k, v in value.items():
                    ck = _coerce(k, dt["key"], f"{path}<key>", type_ctx)
                    cv = _coerce(v, dt["value"], f"{path}[{k!r}]", type_ctx)
                    result[ck] = cv
            finally:
                type_ctx.pop()
            return result
        raise EastTypeError(f"expected Dict or dict, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Struct":
        type_fields = typ["value"]
        if is_east_struct(value) or isinstance(value, dict):
            data: dict[str, Any] = {}
            type_names = {fd["name"] for fd in type_fields}
            type_ctx.append(typ)
            try:
                for fd in type_fields:
                    name = fd["name"]
                    if name not in value:
                        raise EastTypeError(f"missing field {name!r}", value=value, expected=typ, path=f"{path}.{name}")
                    data[name] = _coerce(value[name], fd["type"], f"{path}.{name}", type_ctx)
                for vk in value:
                    if vk not in type_names:
                        raise EastTypeError(f"unexpected field {vk!r}", value=value, expected=typ, path=f"{path}.{vk}")
            finally:
                type_ctx.pop()
            return EastStruct(data)
        raise EastTypeError(f"expected Struct or dict, got {_describe(value)}", value=value, expected=typ, path=path)
    if kind == "Variant":
        cases = typ["value"]
        if is_east_variant(value):
            tag, inner = value.type, value.value
        elif isinstance(value, dict) and "type" in value and "value" in value and len(value) == 2:
            tag, inner = value["type"], value["value"]
        else:
            raise EastTypeError(f"expected Variant, got {_describe(value)}", value=value, expected=typ, path=path)
        match = next((c for c in cases if c["name"] == tag), None)
        if match is None:
            names = ", ".join(c["name"] for c in cases)
            raise EastTypeError(f"variant case {tag!r} not in {{{names}}}", value=value, expected=typ, path=path)
        type_ctx.append(typ)
        try:
            return EastVariant(tag, _coerce(inner, match["type"], f"{path}.{tag}", type_ctx))
        finally:
            type_ctx.pop()
    if kind == "Ref":
        inner_t = typ["value"]
        type_ctx.append(typ)
        try:
            inner = value.value if isinstance(value, EastRef) else value
            return EastRef(_coerce(inner, inner_t, f"{path}.&", type_ctx))
        finally:
            type_ctx.pop()
    if kind == "Recursive":
        scope_id = typ["value"]
        idx = len(type_ctx) - scope_id
        if idx < 0 or idx >= len(type_ctx):
            raise EastTypeError(f"invalid recursive scope_id {scope_id}", value=value, expected=typ, path=path)
        return _coerce(value, type_ctx[idx], path, type_ctx)
    if kind == "Function":
        raise EastTypeError("cannot coerce a value to a Function at the Python boundary", value=value, expected=typ, path=path)
    raise EastTypeError(f"cannot coerce to unknown type kind {kind!r}", value=value, expected=typ, path=path)


def _coerce_array_from_numpy(value: np.ndarray, typ: EastType, elem: EastType, path: str) -> EastArray:
    """Fill an ``Array<Float/Integer/Boolean>`` from a 1-D numpy array C-side.

    One crossing per column instead of per element: the buffer is normalized
    to the element's canonical dtype (and C-contiguity) and handed to the
    east-c bulk push — the same raw-buffer path as ``EastArray.extend``.
    Acceptance mirrors the scalar branches elementwise: Integer takes integer
    dtypes (uint64 rejected — it can exceed the i64 range), Float takes
    integer and float dtypes, Boolean takes bool; anything else raises
    ``EastTypeError``.
    """
    ekind = elem["type"]
    canonical = EAST_ELEMENT_TO_DTYPE.get(ekind)
    if canonical is None:
        raise EastTypeError(
            f"Array<{ekind}> cannot be filled from a numpy array — the columnar path "
            "covers Float/Integer/Boolean elements; convert with .tolist()",
            value=value, expected=typ, path=path,
        )
    if value.ndim != 1:
        raise EastTypeError(
            f"Array<{ekind}> needs a 1-D array, got a {value.ndim}-D input",
            value=value, expected=typ, path=path,
        )
    # Elementwise-consistent with the scalar branches: int -> Float is the one
    # cross-kind coercion (Float accepts int); everything else must match kind.
    if not (dtype_matches_element(value.dtype, elem) or (ekind == "Float" and value.dtype.kind in "iu")):
        raise EastTypeError(
            f"cannot coerce a numpy array of dtype {value.dtype} to Array<{ekind}>",
            value=value, expected=typ, path=path,
        )
    buf = value
    if buf.dtype != canonical or not buf.flags["C_CONTIGUOUS"]:
        buf = np.ascontiguousarray(buf, dtype=canonical)
    out: EastArray = EastArray(elem, [])
    out.extend(buf)
    return out


__all__ = [
    "EastTypeError",
    "assert_value_of",
    "explain_value_of",
    "coerce_to",
]
