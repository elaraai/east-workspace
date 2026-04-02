#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East value types - Python representations of East values.

All East value types are prefixed with 'East' for explicit naming:
- EastNull: Unit type (singleton)
- EastBlob: Immutable binary data (extends bytes)
- EastArray: Ordered collection (extends list)
- EastSet: Sorted unique collection
- EastDict: Sorted key-value collection
- EastStruct: Immutable record type (extends dict)
- EastVariant: Tagged union type (extends dict)
- EastOption: Option variant (some/none)
- EastRef: Mutable reference cell

For primitive types (Boolean, Integer, Float, String, DateTime),
Python's built-in types are used directly (bool, int, float, str, datetime).
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Generic, SupportsIndex, TypeGuard, TypeVar

import numpy as np
from sortedcontainers import SortedDict, SortedSet  # type: ignore[import-untyped]

if TYPE_CHECKING:
    from east.types.types import EastType

T = TypeVar("T")
V = TypeVar("V")
OptionT = TypeVar("OptionT")  # Option inner type


# =============================================================================
# EastNull - Unit type singleton
# =============================================================================


class EastNull:
    """East's canonical unit type.

    Represents the absence of a value, analogous to None but with
    distinct type identity for East's type system.
    """

    _instance: EastNull | None = None

    def __new__(cls) -> EastNull:
        """Ensure EastNull is a singleton."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        """Return East text format representation."""
        return "null"

    def __str__(self) -> str:
        """Return East text format representation."""
        return "null"

    def __eq__(self, other: object) -> bool:
        """EastNull equals only itself."""
        return isinstance(other, EastNull)

    def __hash__(self) -> int:
        """Hash for use in sets/dicts."""
        return hash(None)

    def __lt__(self, other: object) -> bool:
        """EastNull is not less than anything (including itself)."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return False

    def __le__(self, other: object) -> bool:
        """EastNull is less than or equal to itself."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return True

    def __gt__(self, other: object) -> bool:
        """EastNull is not greater than anything."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return False

    def __ge__(self, other: object) -> bool:
        """EastNull is greater than or equal to itself."""
        if not isinstance(other, EastNull):
            return NotImplemented
        return True


# Singleton instance
east_null = EastNull()


# =============================================================================
# EastBlob - Immutable binary data
# =============================================================================


class EastBlob(bytes):
    """East blob type - immutable binary data.

    Extends bytes directly, so it works anywhere bytes is expected.
    Provides East-specific formatting (hexadecimal representation).

    Example:
        data: EastBlob = EastBlob(b"\\x01\\x02\\x03")
        compressed: EastBlob = EastBlob(gzip.compress(data))

        # Works as bytes
        len(data)  # 3
        data[0]    # 1
    """

    __slots__ = ()

    def __new__(cls, data: bytes | bytearray | list[int] | EastBlob) -> EastBlob:
        """Create an EastBlob from various byte sources."""
        if isinstance(data, (EastBlob, bytes, bytearray)):
            return super().__new__(cls, data)
        if isinstance(data, list):
            return super().__new__(cls, bytes(data))
        raise TypeError(f"Cannot create EastBlob from {type(data)}")

    @property
    def data(self) -> bytes:
        """Access underlying bytes (for compatibility)."""
        return bytes(self)

    def __hash__(self) -> int:
        """Hash based on bytes content."""
        return super().__hash__()

    def __repr__(self) -> str:
        """Return East hexadecimal format."""
        if len(self) == 0:
            return "0x"
        # Limit display for very large blobs
        if len(self) > 256:
            hex_str = self[:256].hex()
            return f"0x{hex_str}..."
        return f"0x{self.hex()}"

    def __str__(self) -> str:
        """Return East hexadecimal format."""
        return repr(self)


# =============================================================================
# NumPy dtype mapping for Vector/Matrix element types
# =============================================================================

EAST_ELEMENT_TO_DTYPE: dict[str, np.dtype] = {
    "Float": np.dtype(np.float64),
    "Integer": np.dtype(np.int64),
    "Boolean": np.dtype(np.bool_),
}


# =============================================================================
# EastVector - Contiguous 1D numeric array
# =============================================================================


class EastVector:
    """East vector - contiguous 1D numeric array backed by NumPy.

    Represents a 1D array of Float, Integer, or Boolean values stored in a
    contiguous NumPy array for zero-copy interop with ML libraries.
    """

    __slots__ = ("data", "element_type")

    def __init__(
        self, element_type: EastType, data: np.ndarray | None = None, length: int = 0
    ):
        """Create a vector.

        Args:
            element_type: East element type
            data: Optional NumPy array (used directly, not copied)
            length: Length for zero-initialized vector (used if data is None)
        """
        self.element_type = element_type
        if data is not None:
            self.data = data
        else:
            dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]
            self.data = np.zeros(length, dtype=dtype)

    def __len__(self) -> int:
        """Return number of elements."""
        return len(self.data)

    def __repr__(self) -> str:
        """Return representation."""
        return f"EastVector({self.element_type.type}, len={len(self.data)})"

    def __eq__(self, other: object) -> bool:
        """Structural equality."""
        if not isinstance(other, EastVector):
            return NotImplemented
        return (
            self.element_type.type == other.element_type.type
            and len(self.data) == len(other.data)
            and np.array_equal(self.data, other.data)
        )

    def __hash__(self) -> int:
        """Vectors are mutable and cannot be hashed."""
        raise TypeError("EastVector is mutable and cannot be hashed")


# =============================================================================
# EastMatrix - Contiguous 2D numeric array (row-major)
# =============================================================================


class EastMatrix:
    """East matrix - contiguous 2D numeric array backed by NumPy (row-major).

    Represents a 2D array of Float, Integer, or Boolean values stored in a
    contiguous row-major NumPy array for zero-copy interop with ML libraries.
    """

    __slots__ = ("data", "element_type", "rows", "cols")

    def __init__(
        self,
        element_type: EastType,
        data: np.ndarray | None = None,
        rows: int = 0,
        cols: int = 0,
    ):
        """Create a matrix.

        Args:
            element_type: East element type
            data: Optional NumPy array (used directly)
            rows: Number of rows (used with flat data or if data is None)
            cols: Number of columns (used with flat data or if data is None)
        """
        self.element_type = element_type
        if data is not None:
            if data.ndim == 1:
                self.data = data.reshape(rows, cols)
            else:
                self.data = data
            self.rows = self.data.shape[0]
            self.cols = self.data.shape[1] if self.data.ndim > 1 else 0
        else:
            dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]
            self.data = np.zeros((rows, cols), dtype=dtype, order="C")
            self.rows = rows
            self.cols = cols

    def __repr__(self) -> str:
        """Return representation."""
        return f"EastMatrix({self.element_type.type}, {self.rows}x{self.cols})"

    def __eq__(self, other: object) -> bool:
        """Structural equality."""
        if not isinstance(other, EastMatrix):
            return NotImplemented
        return (
            self.element_type.type == other.element_type.type
            and self.rows == other.rows
            and self.cols == other.cols
            and np.array_equal(self.data, other.data)
        )

    def __hash__(self) -> int:
        """Matrices are mutable and cannot be hashed."""
        raise TypeError("EastMatrix is mutable and cannot be hashed")


# =============================================================================
# EastArray - Ordered collection
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


class EastArray(list, Generic[T]):
    """East array with element type tracking.

    Arrays are mutable, ordered, 0-indexed collections.
    They behave like Python lists but track the element type.

    Generic type parameter T is for static type hints only (e.g., EastArray[float]).
    At runtime, element_type provides the actual East type.
    """

    __slots__ = ("element_type", "_iteration_lock")

    def __init__(self, element_type: EastType, items: list | None = None):
        """Create an array with a specific element type.

        Args:
            element_type: The type of elements in this array
            items: Initial items (optional)
        """
        if items is not None:
            super().__init__(items)
        else:
            super().__init__()
        self.element_type = element_type
        self._iteration_lock = 0  # Counter for nested iterations

    def _lock_for_iteration(self) -> None:
        """Lock array for iteration (prevents modifications)."""
        self._iteration_lock += 1

    def _unlock_for_iteration(self) -> None:
        """Unlock array after iteration."""
        self._iteration_lock -= 1

    def _check_not_iterating(self) -> None:
        """Check if array is being iterated and raise error if so."""
        if self._iteration_lock > 0:
            raise RuntimeError("Cannot modify Array during iteration")

    # Override all mutation methods to check for iteration

    def append(self, item: Any) -> None:
        """Add item to end of array."""
        self._check_not_iterating()
        super().append(item)

    def extend(self, items: Any) -> None:
        """Extend array with items."""
        self._check_not_iterating()
        super().extend(items)

    def insert(self, index: SupportsIndex, item: Any) -> None:
        """Insert item at index."""
        self._check_not_iterating()
        super().insert(index, item)

    def remove(self, item: Any) -> None:
        """Remove first occurrence of item."""
        self._check_not_iterating()
        super().remove(item)

    def pop(self, index: SupportsIndex = -1) -> Any:
        """Remove and return item at index."""
        self._check_not_iterating()
        return super().pop(index)

    def clear(self) -> None:
        """Remove all items."""
        self._check_not_iterating()
        super().clear()

    def __setitem__(self, index: Any, value: Any) -> None:
        """Set item at index."""
        self._check_not_iterating()
        super().__setitem__(index, value)

    def __delitem__(self, index: Any) -> None:
        """Delete item at index."""
        self._check_not_iterating()
        super().__delitem__(index)

    def reverse(self) -> None:
        """Reverse array in place."""
        self._check_not_iterating()
        super().reverse()

    def sort(self, *args: Any, **kwargs: Any) -> None:
        """Sort array in place."""
        self._check_not_iterating()
        super().sort(*args, **kwargs)

    def __repr__(self) -> str:
        """Return East text format representation."""
        if len(self) == 0:
            return "[]"
        items = ", ".join(repr(item) for item in self)
        return f"[{items}]"


# =============================================================================
# EastSet - Sorted unique collection
# =============================================================================


class EastSet(Generic[T]):
    """East set with element type tracking.

    Sets are mutable, sorted collections of unique elements.
    Elements are sorted using East's total ordering.

    Generic type parameter T is for static type hints only (e.g., EastSet[str]).
    At runtime, element_type provides the actual East type.
    """

    __slots__ = ("element_type", "_data", "_iteration_lock")

    def __init__(self, element_type: EastType, items: Iterable[Any] | None = None):
        """Create a set with a specific element type.

        Args:
            element_type: The type of elements in this set
            items: Initial items (optional)
        """
        self.element_type = element_type
        self._data: SortedSet = SortedSet(key=_make_east_key(element_type))
        self._iteration_lock = 0  # Counter for nested iterations
        if items is not None:
            for item in items:
                self._data.add(item)

    def _lock_for_iteration(self) -> None:
        """Lock set for iteration (prevents modifications)."""
        self._iteration_lock += 1

    def _unlock_for_iteration(self) -> None:
        """Unlock set after iteration."""
        self._iteration_lock -= 1

    def _check_not_iterating(self) -> None:
        """Check if set is being iterated and raise error if so."""
        if self._iteration_lock > 0:
            raise RuntimeError("Cannot modify Set during iteration")

    def add(self, item: Any) -> None:
        """Add an item to the set."""
        self._check_not_iterating()
        self._data.add(item)

    def remove(self, item: Any) -> None:
        """Remove an item from the set."""
        self._check_not_iterating()
        self._data.remove(item)

    def discard(self, item: Any) -> None:
        """Remove an item from the set if present."""
        self._check_not_iterating()
        self._data.discard(item)

    def clear(self) -> None:
        """Remove all items from the set."""
        self._check_not_iterating()
        self._data.clear()

    def __contains__(self, item: Any) -> bool:
        """Check if item is in the set."""
        return item in self._data

    def __len__(self) -> int:
        """Return number of items in the set."""
        return len(self._data)

    def __iter__(self) -> Iterator[Any]:
        """Iterate over items in sorted order."""
        return iter(self._data)

    def __eq__(self, other: object) -> bool:
        """Sets are equal if they contain the same elements."""
        if not isinstance(other, EastSet):
            return NotImplemented
        return self._data == other._data

    def __repr__(self) -> str:
        """Return East text format representation."""
        if len(self) == 0:
            return "{}"
        items = ", ".join(repr(item) for item in self)
        return f"{{{items}}}"


# =============================================================================
# EastDict - Sorted key-value collection
# =============================================================================


K = TypeVar("K")


class EastDict(Generic[K, V]):
    """East dict with key and value type tracking.

    Dicts are mutable, sorted collections of key-value pairs.
    Keys are sorted using East's total ordering.

    Generic type parameters K and V are for static type hints only
    (e.g., EastDict[str, int]). At runtime, key_type and value_type
    provide the actual East types.
    """

    __slots__ = ("key_type", "value_type", "_data", "_iteration_lock")

    def __init__(
        self,
        key_type: EastType,
        value_type: EastType,
        items: dict | None = None,
    ):
        """Create a dict with specific key and value types."""
        self.key_type = key_type
        self.value_type = value_type
        self._data: SortedDict = SortedDict(_make_east_key(key_type))
        self._iteration_lock = 0
        if items is not None:
            for key, value in items.items():
                self._data[key] = value

    def _lock_for_iteration(self) -> None:
        """Lock dict for iteration."""
        self._iteration_lock += 1

    def _unlock_for_iteration(self) -> None:
        """Unlock dict after iteration."""
        self._iteration_lock -= 1

    def _check_not_iterating(self) -> None:
        """Check if dict is being iterated."""
        if self._iteration_lock > 0:
            raise RuntimeError("Cannot modify Dict during iteration")

    def __getitem__(self, key: Any) -> Any:
        """Get value for key."""
        return self._data[key]

    def __setitem__(self, key: Any, value: Any) -> None:
        """Set value for key."""
        self._check_not_iterating()
        self._data[key] = value

    def __delitem__(self, key: Any) -> None:
        """Delete key from dict."""
        self._check_not_iterating()
        del self._data[key]

    def __contains__(self, key: Any) -> bool:
        """Check if key is in the dict."""
        return key in self._data

    def __len__(self) -> int:
        """Return number of key-value pairs."""
        return len(self._data)

    def __iter__(self) -> Iterator[Any]:
        """Iterate over keys in sorted order."""
        return iter(self._data)

    def __eq__(self, other: object) -> bool:
        """Dicts are equal if they have the same key-value pairs."""
        if not isinstance(other, EastDict):
            return NotImplemented
        return self._data == other._data

    def keys(self) -> Iterator[Any]:
        """Return iterator over keys in sorted order."""
        return iter(self._data.keys())

    def values(self) -> Iterator[Any]:
        """Get iterator over values."""
        return iter(self._data.values())

    def items(self) -> Iterator[Any]:
        """Return iterator over (key, value) pairs in sorted order."""
        return iter(self._data.items())

    def get(self, key: Any, default: Any = None) -> Any:
        """Get value for key, returning default if not found."""
        return self._data.get(key, default)

    def pop(self, key: Any, *args: Any) -> Any:
        """Remove and return value for key."""
        self._check_not_iterating()
        return self._data.pop(key, *args)

    def clear(self) -> None:
        """Remove all key-value pairs."""
        self._check_not_iterating()
        self._data.clear()

    def __repr__(self) -> str:
        """Return East text format representation."""
        if len(self) == 0:
            return "{:}"
        items = ", ".join(f"{repr(k)}: {repr(v)}" for k, v in self.items())
        return f"{{{items}}}"


# =============================================================================
# EastStruct - Immutable record type (tuple-backed)
# =============================================================================

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

# Union of all East value types (for type annotations)
EastValue = (
    EastNull
    | bool
    | int
    | float
    | str
    | EastBlob
    | datetime
    | EastVector
    | EastMatrix
    | EastArray
    | EastSet
    | EastDict
    | EastStruct
    | EastVariant
    | EastOption
    | EastRef
)


# =============================================================================
# TypeGuard functions for East value types
# =============================================================================


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
    """Check if a value is an EastVariant."""
    # Primary check: is it an EastVariant instance?
    if isinstance(v, (EastVariant, _PyEastVariant)):
        return True
    # Backward compatibility: dict with 'type' and 'value' keys
    return isinstance(v, dict) and "type" in v and "value" in v and len(v) == 2


def is_east_option(v: Any) -> TypeGuard[EastOption]:
    """Check if a value is an EastOption (variant with 'some' or 'none' tag)."""
    return isinstance(v, EastOption)


# =============================================================================
# Type checking and inference
# =============================================================================


def is_value_of(
    value: EastValue,
    typ: EastType,
    type_ctx: list[EastType] | None = None,
    nodes_visited: set[int] | None = None,
) -> bool:
    """Check if a value conforms to an East type.

    Args:
        value: The value to check
        typ: The East type to validate against
        type_ctx: Internal parameter for resolving recursive type references
        nodes_visited: Internal parameter for cycle detection in values

    Returns:
        True if value matches type, False otherwise
    """
    # Initialize type context if needed
    if type_ctx is None:
        type_ctx = []

    # Handle Never type
    if typ["type"] == "Never":
        return False

    # Handle primitive types
    if typ["type"] == "Null":
        return value is None or isinstance(value, EastNull)
    if typ["type"] == "Boolean":
        return isinstance(value, bool)
    if typ["type"] == "Integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if typ["type"] == "Float":
        return isinstance(value, float)
    if typ["type"] == "String":
        return isinstance(value, str)
    if typ["type"] == "DateTime":
        return isinstance(value, datetime)
    if typ["type"] == "Blob":
        return isinstance(value, (bytes, bytearray, EastBlob))

    # Handle Vector type
    if typ["type"] == "Vector":
        return isinstance(value, EastVector)

    # Handle Matrix type
    if typ["type"] == "Matrix":
        return isinstance(value, EastMatrix)

    # Handle EastRef type
    if typ["type"] == "Ref":
        if not isinstance(value, EastRef):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            return is_value_of(value.value, typ["value"], type_ctx, nodes_visited)  # type: ignore[typeddict-item]
        finally:
            type_ctx.pop()

    # Handle Array type
    if typ["type"] == "Array":
        if not isinstance(value, EastArray):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for elem in value:
                if not is_value_of(elem, typ["value"], type_ctx, nodes_visited):  # type: ignore[typeddict-item]
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Set type
    if typ["type"] == "Set":
        if not isinstance(value, EastSet):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for elem in value:
                if not is_value_of(elem, typ["value"], type_ctx, nodes_visited):  # type: ignore[typeddict-item]
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Dict type
    if typ["type"] == "Dict":
        if not isinstance(value, EastDict):
            return False
        dict_type = typ["value"]
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for k, v in value.items():
                if not is_value_of(k, dict_type["key"], type_ctx, nodes_visited):
                    return False
                if not is_value_of(v, dict_type["value"], type_ctx, nodes_visited):
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Struct type
    if typ["type"] == "Struct":
        if not is_east_struct(value):
            return False
        # Check fields match
        value_fields = list(value.items())
        type_fields = typ["value"]
        if len(value_fields) != len(type_fields):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for i, field_def in enumerate(type_fields):
                field_name = field_def["name"]
                field_type = field_def["type"]
                if i >= len(value_fields):
                    return False
                val_name, val_value = value_fields[i]
                if val_name != field_name:
                    return False
                if not is_value_of(val_value, field_type, type_ctx, nodes_visited):
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Variant type
    if typ["type"] == "Variant":
        if not is_east_variant(value):
            return False
        variant_tag = value.type
        variant_value = value.value
        # Find the case type
        cases = typ["value"]
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for case in cases:
                if case["name"] == variant_tag:
                    return is_value_of(variant_value, case["type"], type_ctx, nodes_visited)
            return False  # Case not found
        finally:
            type_ctx.pop()

    # Handle Recursive type
    if typ["type"] == "Recursive":
        scope_id = typ["value"]
        if not isinstance(scope_id, int):
            raise ValueError(f"Recursive type must have integer scope_id, got {type(scope_id)}")

        # Resolve the scope_id to the actual type from the context stack
        stack_index = len(type_ctx) - scope_id
        if stack_index < 0 or stack_index >= len(type_ctx):
            raise ValueError(
                f"Invalid recursive scope_id {scope_id} (type_ctx len={len(type_ctx)}, calculated index={stack_index})"
            )

        resolved_type = type_ctx[stack_index]

        # Check for value cycles to avoid infinite recursion
        value_id = id(value)
        if nodes_visited is None:
            nodes_visited = set()
        if value_id in nodes_visited:
            return True  # Already validated this object
        nodes_visited.add(value_id)

        return is_value_of(value, resolved_type, type_ctx, nodes_visited)

    # Handle Function type
    if typ["type"] == "Function":
        raise TypeError("JavaScript/Python functions cannot be converted to East functions")

    # Unknown type
    raise NotImplementedError(f"is_value_of not implemented for type: {typ}")


def type_of(value: EastValue) -> EastType:
    """Infer the East type of a Python value.

    Args:
        value: Python value

    Returns:
        East type

    Raises:
        TypeError: If value type cannot be inferred
    """
    # Lazy imports to avoid circular dependencies
    from east.types.types import (
        ArrayType,
        BlobType,
        BooleanType,
        DateTimeType,
        DictType,
        FloatType,
        IntegerType,
        NullType,
        RefType,
        SetType,
        StringType,
        StructType,
        VariantType,
    )

    if value is None or isinstance(value, EastNull):
        return NullType
    if isinstance(value, bool):
        return BooleanType
    if isinstance(value, int):
        return IntegerType
    if isinstance(value, float):
        return FloatType
    if isinstance(value, str):
        return StringType
    if isinstance(value, bytes):
        return BlobType
    if isinstance(value, datetime):
        return DateTimeType
    if isinstance(value, EastVector):
        from east.types.types import VectorType

        return VectorType(value.element_type)
    if isinstance(value, EastMatrix):
        from east.types.types import MatrixType

        return MatrixType(value.element_type)
    if isinstance(value, EastArray):
        return ArrayType(value.element_type)
    if isinstance(value, EastSet):
        return SetType(value.element_type)
    if isinstance(value, EastDict):
        return DictType(value.key_type, value.value_type)
    if isinstance(value, EastRef):
        # EastRef doesn't store type info at runtime - infer from contained value
        return RefType(type_of(value.value))
    if isinstance(value, EastStruct):
        # It's a struct value
        field_types_list = []
        for key, val in value.items():
            field_types_list.append((key, type_of(val)))
        return StructType(field_types_list)
    if isinstance(value, dict):
        # Check if it's a variant value
        if "type" in value and "value" in value and len(value) == 2:
            # It's a variant - but we don't know the full variant type
            # Return a generic variant with just this case
            case_value_type = type_of(value["value"])
            return VariantType([(value["type"], case_value_type)])
        # It's a struct value (backward compat for plain dicts)
        field_types_list = []
        for key, val in value.items():
            field_types_list.append((key, type_of(val)))
        return StructType(field_types_list)
    if callable(value):
        # Can't infer function types from Python callables
        raise TypeError(f"Cannot infer type of callable {value}")

    raise TypeError(f"Cannot infer type of {type(value).__name__}")


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # EastValue union type
    "EastValue",
    # EastNull
    "EastNull",
    "east_null",
    # EastBlob
    "EastBlob",
    # Numeric containers
    "EAST_ELEMENT_TO_DTYPE",
    "EastVector",
    "EastMatrix",
    # Containers
    "EastArray",
    "EastSet",
    "EastDict",
    # Structural
    "EastStruct",
    "EastVariant",
    "EastOption",
    "EastSome",
    "EastNone",
    # EastRef
    "EastRef",
    "REF_SYMBOL",
    "east_ref",
    "is_east_ref",
    "deref",
    "set_ref",
    # DateTime
    "ensure_utc_datetime",
    # TypeGuard functions
    "is_east_null",
    "is_east_blob",
    "is_east_vector",
    "is_east_matrix",
    "is_east_array",
    "is_east_set",
    "is_east_dict",
    "is_east_struct",
    "is_east_variant",
    "is_east_option",
    # Type checking and inference
    "is_value_of",
    "type_of",
]
