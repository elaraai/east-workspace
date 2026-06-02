#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Structural value types: EastStruct, EastVariant, EastOption, EastRef, EastFunction."""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import TYPE_CHECKING, Any, Generic, TypeGuard

import east.types.values as _ev
from east.types.values._helpers import OptionT, T, V, _call_builtin, _intern_keys
from east.types.values.primitives import east_null

if TYPE_CHECKING:
    from east.types.types import EastType


class EastStruct(Generic[T]):
    """Hashable, immutable struct backed by tuples.

    Field names are interned (shared per schema), values stored in a tuple.
    Provides dict-like read access for compatibility.

    Generic type parameter T should be a TypedDict describing the structure.
    """

    __slots__ = ("_keys", "_values", "_key_index", "_hash")

    def __init__(self, data: dict[str, Any]):
        """Create an immutable struct from a dict."""
        keys = tuple(data.keys())
        interned_keys, key_index = _intern_keys(keys)
        object.__setattr__(self, "_keys", interned_keys)
        object.__setattr__(self, "_values", tuple(data.values()))
        object.__setattr__(self, "_key_index", key_index)
        object.__setattr__(self, "_hash", None)

    @classmethod
    def _from_tuples(cls, keys: tuple[str, ...], values: tuple) -> EastStruct:
        """Create EastStruct directly from keys tuple and values tuple.

        Skips intermediate dict construction. Keys are interned automatically.
        """
        obj = object.__new__(cls)
        interned_keys, key_index = _intern_keys(keys)
        object.__setattr__(obj, "_keys", interned_keys)
        object.__setattr__(obj, "_values", values)
        object.__setattr__(obj, "_key_index", key_index)
        object.__setattr__(obj, "_hash", None)
        return obj

    def __getitem__(self, key: str) -> Any:
        """Get field value by name."""
        try:
            return self._values[self._key_index[key]]
        except KeyError:
            raise KeyError(key) from None

    def __contains__(self, key: object) -> bool:
        """Check if field name exists."""
        return key in self._key_index

    def __len__(self) -> int:
        """Return number of fields."""
        return len(self._keys)

    def __iter__(self):
        """Iterate over field names."""
        return iter(self._keys)

    def items(self):
        """Return (name, value) pairs."""
        return zip(self._keys, self._values, strict=True)

    def keys(self):
        """Return field names."""
        return self._keys

    def values(self):
        """Return field values."""
        return self._values

    def get(self, key: str, default: Any = None) -> Any:
        """Get field value with default."""
        idx = self._key_index.get(key)
        if idx is not None:
            return self._values[idx]
        return default

    def __hash__(self) -> int:
        """Compute hash based on sorted field items."""
        if self._hash is None:
            items = []
            for k in sorted(self._keys):
                v = self._values[self._key_index[k]]
                try:
                    items.append((k, hash(v)))
                except TypeError:
                    items.append((k, id(v)))
            object.__setattr__(self, "_hash", hash(tuple(items)))
        return self._hash

    def __eq__(self, other: object) -> bool:
        """Check equality with another EastStruct or dict."""
        if isinstance(other, EastStruct):
            return self._keys == other._keys and self._values == other._values
        if isinstance(other, dict):
            if len(self) != len(other):
                return False
            for k, v in zip(self._keys, self._values, strict=True):
                if k not in other or other[k] != v:
                    return False
            return True
        return NotImplemented

    def __setattr__(self, name: str, value: Any) -> None:
        """Prevent modification after creation."""
        raise TypeError("EastStruct is immutable")

    def __repr__(self) -> str:
        """Return dict-like representation."""
        inner = ", ".join(
            f"{repr(k)}: {repr(v)}" for k, v in zip(self._keys, self._values, strict=True)
        )
        return f"EastStruct({{{inner}}})"


# Preserve pure-Python version
_PyEastStruct = EastStruct

with contextlib.suppress(ImportError):
    from east.types._values_cy import CyEastStruct  # type: ignore[import-not-found]

    EastStruct = CyEastStruct  # type: ignore[misc,assignment]


# =============================================================================
# EastVariant - Tagged union type (memory-optimized with __slots__)
# =============================================================================


class EastVariant(Generic[V]):
    """Hashable, immutable variant wrapper.

    Represents a tagged union with "type" and "value" fields.
    Uses __slots__ for memory efficiency.
    Provides dict-like access
    """

    __slots__ = ("type", "value", "_hash")

    def __init__(self, tag: str, value: Any):
        """Create an immutable variant."""
        self.type = tag  # Direct attribute, no property overhead
        self.value = value
        self._hash: int | None = None

    def __hash__(self) -> int:
        """Compute hash based on type and value."""
        if self._hash is None:
            try:
                self._hash = hash((self.type, self.value))
            except TypeError:
                self._hash = hash((self.type, id(self.value)))
        return self._hash

    def __eq__(self, other: object) -> bool:
        """Check equality with another variant."""
        if isinstance(other, EastVariant):
            return self.type == other.type and self.value == other.value
        if isinstance(other, dict):
            return (
                other.get("type") == self.type
                and other.get("value") == self.value
                and len(other) == 2
            )
        return NotImplemented

    # Dict-like access for backward compatibility
    def __getitem__(self, key: str) -> Any:
        """Get value by key (dict-like access)."""
        if key == "type":
            return self.type
        if key == "value":
            return self.value
        raise KeyError(key)

    def __contains__(self, key: object) -> bool:
        """Check if key exists."""
        return key in ("type", "value")

    def __len__(self) -> int:
        """Return number of fields (always 2)."""
        return 2

    def __iter__(self) -> Iterator[str]:
        """Iterate over keys."""
        return iter(("type", "value"))

    def keys(self) -> tuple[str, str]:
        """Return keys."""
        return ("type", "value")

    def values(self) -> tuple[Any, Any]:
        """Return values."""
        return (self.type, self.value)

    def items(self) -> tuple[tuple[str, str], tuple[str, Any]]:
        """Return items as tuples."""
        return (("type", self.type), ("value", self.value))

    def get(self, key: str, default: Any = None) -> Any:
        """Get value by key with default."""
        if key == "type":
            return self.type
        if key == "value":
            return self.value
        return default

    def __repr__(self) -> str:
        """Return variant representation."""
        return f"EastVariant(type={self.type!r}, value={self.value!r})"


# =============================================================================
# EastOption - Option variant (some/none)
# =============================================================================


class EastOption(EastVariant, Generic[OptionT]):
    """Option variant - either some(OptionT) or none.

    A specialized variant for optional values. The type parameter OptionT
    represents the inner type when the option is "some".
    """

    __slots__ = ()  # No additional slots needed

    def __init__(self, tag: str, value: OptionT | None):
        """Create an Option variant."""
        if tag not in ("some", "none"):
            raise ValueError(f"EastOption tag must be 'some' or 'none', got '{tag}'")
        super().__init__(tag, value)

    def __hash__(self) -> int:
        """Inherit hash from EastVariant."""
        return super().__hash__()

    def __repr__(self) -> str:
        """Return option representation."""
        return f"EastOption(type={self.type!r}, value={self.value!r})"


def EastSome(value: OptionT) -> EastVariant[OptionT]:
    """Create a 'some' variant for optional values.

    Args:
        value: The value to wrap

    Returns:
        EastVariant with type="some"
    """
    return EastVariant("some", value)


# Singleton for 'none' variant - reuse same instance to save memory
_east_none_singleton: EastVariant[None] | None = None


def EastNone() -> EastVariant[None]:
    """Create a 'none' variant for optional values.

    Returns the same singleton instance for memory efficiency.

    Returns:
        EastVariant with type="none" and value=east_null
    """
    global _east_none_singleton
    if _east_none_singleton is None:
        _east_none_singleton = EastVariant("none", east_null)
    return _east_none_singleton


# Pre-create the singleton at module load time
_east_none_singleton = EastVariant("none", east_null)


# Preserve pure-Python version
_PyEastVariant = EastVariant

with contextlib.suppress(ImportError):
    from east.types._values_cy import CyEastVariant  # type: ignore[import-not-found]

    EastVariant = CyEastVariant  # type: ignore[misc,assignment]
    _east_none_singleton = EastVariant("none", east_null)


# =============================================================================
# EastRef - Mutable reference cell
# =============================================================================

# Symbol for nominal typing (brand)
REF_SYMBOL = object()


class EastRef(Generic[T]):
    """Mutable reference cell containing a value.

    EastRef-cells are mutable containers with identity semantics:
    - Two refs are equal only if they're the same object
    - Refs support aliasing in serialization
    - Refs are invariant in the type system
    """

    __slots__ = ("value", "_brand")

    def __init__(self, value: T):
        """Create a new east_ref-cell."""
        self.value: T = value
        self._brand = REF_SYMBOL

    def __repr__(self) -> str:
        """String representation for debugging."""
        return f"EastRef({self.value!r})"

    def __str__(self) -> str:
        """Human-readable string."""
        return f"&{self.value}"

    # ----- Eager value methods (delegate to east-c; results are live values) ---
    #
    # The cell read/write are O(1): `self.value` is a plain slot on a bare
    # EastRef and a live-C property on an EastRefProxy, so get/set/update touch
    # the cell directly and never marshal it. Only `merge` carries east-c
    # semantics (combine a typed patch into the cell) and goes through RefMerge.

    def get(self) -> Any:
        """Read the contained value (east-c RefGet).

        Returns:
            The current cell contents. On an EastRefProxy this reads the
            live C-backed cell, so a chained value stays C-side; on a bare
            EastRef it is the plain Python slot. O(1) — never marshals.
        """
        return self.value

    def set(self, value: Any) -> None:
        """Replace the contained value in place.

        Writes the cell directly (the live C-backed cell on an EastRefProxy,
        the plain slot on a bare EastRef); O(1), not delegated.

        Args:
            value: The new value to store in the cell.
        """
        self.value = value

    def update(self, fn: Any) -> None:
        """Replace the contained value with the result of applying ``fn`` (in place).

        Reads the cell, applies the callback, and writes the result back; not
        delegated to a builtin.

        Args:
            fn: Callback ``fn(current) -> new value`` receiving the current
                cell contents and returning the replacement.
        """
        self.value = fn(self.value)

    def merge(self, patch: Any, combine: Any) -> None:
        """Combine ``patch`` into the cell in place (east-c RefMerge).

        Args:
            patch: The value to merge into the cell. Its East type is inferred
                by ``type_of`` and may differ from the cell's element type.
            combine: Callback ``combine(current, patch) -> new value`` that
                folds ``patch`` into the current contents; its result becomes
                the new cell value and must match the cell's element type.
        """
        from east.types.types import NullType

        t = _ev.type_of(self.value)
        t2 = _ev.type_of(patch)
        callback = EastFunction(lambda cur, p: combine(cur, p), [t, t2], t)
        _call_builtin("RefMerge", [t, t2], [self, patch, callback], NullType)

class EastFunction:
    """A Python callable plus its East signature, for eager builtin callbacks.

    Eager value methods that delegate a callback builtin (``map``/``filter``/
    ``fold``/keyed ``sort``/…) pass one of these as the callback argument;
    ``call_builtin`` wraps it as an east-c function value (via the invoke hook)
    so east-c drives the loop and calls back into Python per element.
    """

    __slots__ = ("fn", "input_types", "output_type")

    def __init__(self, fn: Any, input_types: list[EastType], output_type: EastType):
        self.fn = fn
        self.input_types = list(input_types)
        self.output_type = output_type

    def __repr__(self) -> str:
        """Return a debug representation."""
        return f"EastFunction({self.fn!r})"


def east_ref(value: T) -> EastRef[T]:
    """Create a new mutable reference cell."""
    return EastRef(value)


def is_east_ref(v: Any) -> TypeGuard[EastRef]:
    """Check if a value is a ref-cell."""
    return isinstance(v, EastRef) and hasattr(v, "_brand") and v._brand is REF_SYMBOL


def deref(r: EastRef[T]) -> T:
    """Retrieve the current value from a east_ref-cell."""
    return r.value


def set_ref(r: EastRef[T], value: T) -> None:
    """Update the value stored in a east_ref-cell."""
    r.value = value


# =============================================================================
# DateTime helpers
# =============================================================================


