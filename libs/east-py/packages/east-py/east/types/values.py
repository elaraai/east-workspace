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

    # ----- Eager value methods --------------------------------------------

    def size(self) -> int:
        """Number of bytes in the blob (east-c BlobSize).

        Returns:
            The byte length, equivalent to ``len(self)``.
        """
        return len(self)

    def get_uint8(self, index: int) -> int:
        """Unsigned byte at ``index`` (east-c BlobGetUint8).

        Args:
            index: Zero-based byte position.

        Returns:
            The byte value at ``index`` as an integer in ``[0, 255]``.
        """
        return self[index]

    def decode_utf8(self) -> str:
        """Decode the bytes as a UTF-8 string (east-c BlobDecodeUtf8).

        Returns:
            The decoded text as an East String.

        Raises:
            EastError: If the bytes are not valid UTF-8.
        """
        from east.types.types import StringType

        return _call_builtin("BlobDecodeUtf8", [], [self], StringType)

    def decode_utf16(self) -> str:
        """Decode the bytes as a UTF-16 string (east-c BlobDecodeUtf16).

        Returns:
            The decoded text as an East String.

        Raises:
            EastError: If the bytes are not valid UTF-16.
        """
        from east.types.types import StringType

        return _call_builtin("BlobDecodeUtf16", [], [self], StringType)

    def decode_csv(self, element_type: EastType, config: Any = None) -> Any:
        """Decode CSV bytes into an Array of ``element_type`` (east-c BlobDecodeCsv).

        Args:
            element_type: East type of each decoded row; each CSV record is
                parsed into a value of this type, yielding the array element.
            config: Optional CSV decode configuration (delimiter, header
                handling, etc.); ``None`` uses the defaults.

        Returns:
            An EastArray whose element type is ``element_type``, one entry per
            parsed CSV record.
        """
        from east.serialization.csv import decode_csv_for

        return decode_csv_for(element_type, config)(bytes(self))

    def decode_beast2(self, typ: EastType) -> Any:
        """Decode beast2-encoded bytes as a value of ``typ`` (east-c BlobDecodeBeast2).

        Reuses the package's beast2 deserialization layer rather than calling
        through to a builtin.

        Args:
            typ: East type the bytes were encoded as; required to drive
                decoding, which is type-directed.

        Returns:
            The decoded East value of type ``typ``.
        """
        from east.serialization.beast2 import decode_beast2_for

        return decode_beast2_for(typ)(bytes(self))

    @staticmethod
    def encode_beast2(value: Any) -> EastBlob:
        """Encode an East value to beast2 bytes (east-c BlobEncodeBeast2).

        Reuses the package's beast2 serialization layer rather than calling
        through to a builtin. The encoding type is inferred from ``value`` via
        ``type_of``.

        Args:
            value: Any East value to serialize.

        Returns:
            An EastBlob holding the beast2-encoded bytes.
        """
        from east.serialization.beast2 import encode_beast2_for

        return EastBlob(encode_beast2_for(type_of(value))(value))


# =============================================================================
# Runtime storage dtype for Vector / Matrix element types
# =============================================================================
#
# Vector/Matrix carry a *logical* element type (Float / Integer / Boolean) in
# the East type system. The backing NumPy buffer may use any storage dtype that
# is compatible with that logical element — e.g. a Vector<Float> may be backed
# by float32 for half-memory, zero-copy torch interop. The logical element is
# what the East type system sees; the storage dtype is a runtime property of the
# buffer. The C bridge canonicalizes the buffer to the dtype below when a value
# crosses into east-c (where Vector/Matrix are stored at these fixed widths).

# Canonical (default) storage dtype per logical element, matching the east-c
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

        The logical ``element_type`` (Float, Integer, Boolean) is fixed; the
        backing array may use any compatible storage dtype (e.g. float32 for a
        Float vector). Zero-initialized vectors use the canonical storage dtype.

        Args:
            element_type: Logical East element type (Float, Integer, or Boolean)
            data: Optional NumPy array. Used as the backing buffer (made
                contiguous); its dtype must be compatible with ``element_type``.
            length: Length for a zero-initialized vector (used if data is None)
        """
        if element_type.type not in EAST_ELEMENT_TO_DTYPE:
            raise TypeError(
                f"Vector element type must be Float, Integer, or Boolean, got {element_type.type}"
            )
        self.element_type = element_type
        if data is not None:
            arr = np.asarray(data)
            if not dtype_matches_element(arr.dtype, element_type):
                raise TypeError(
                    f"Vector<{element_type.type}> backing array has dtype {arr.dtype} "
                    f"(kind {arr.dtype.kind!r}), which is not valid {element_type.type} storage"
                )
            if arr.ndim != 1:
                raise ValueError(f"EastVector data must be 1-D, got a {arr.ndim}-D array")
            self.data = np.ascontiguousarray(arr)
        else:
            self.data = np.zeros(length, dtype=EAST_ELEMENT_TO_DTYPE[element_type.type])

    @property
    def dtype(self) -> np.dtype:
        """Runtime storage dtype of the backing NumPy buffer."""
        return self.data.dtype

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

    # ----- Eager value methods --------------------------------------------
    #
    # Vector/Matrix are the numpy boundary: structural ops use numpy on the
    # backing buffer (cheap, no marshalling), and there are NO arithmetic
    # methods — do tensor math with numpy/torch on `.data` directly, which is
    # the whole point of the contiguous buffer (and east-c has no vector/matrix
    # arithmetic builtins to delegate to).

    def length(self) -> int:
        """Number of elements (numpy).

        Returns:
            The length of the backing buffer.
        """
        return len(self.data)

    def get(self, index: int) -> Any:
        """Logical scalar at ``index`` (numpy).

        The stored value is promoted from its storage dtype to the canonical
        Python representation of the logical element type (Float/Integer/Boolean).

        Args:
            index: Zero-based position into the vector.

        Returns:
            The element at ``index`` as a Python scalar.
        """
        return self.data[index].item()

    def set(self, index: int, value: Any) -> None:
        """Write ``value`` at ``index`` (numpy).

        Mutates the vector in place. ``value`` is cast into the backing storage
        dtype.

        Args:
            index: Zero-based position to overwrite.
            value: New value, cast to the storage dtype.
        """
        self.data[index] = value

    def slice(self, start: int, end: int) -> EastVector:
        """Sub-vector over the half-open range ``[start, end)`` (numpy).

        Args:
            start: Inclusive start index.
            end: Exclusive end index.

        Returns:
            A new vector holding a contiguous copy of the selected range.
        """
        return EastVector(self.element_type, np.ascontiguousarray(self.data[start:end]))

    def concat(self, other: EastVector) -> EastVector:
        """Concatenate with ``other`` (numpy).

        Args:
            other: Vector whose elements follow this vector's.

        Returns:
            A new vector with ``self`` then ``other`` (this vector's element
            type).
        """
        return EastVector(self.element_type, np.concatenate([self.data, other.data]))

    def to_array(self) -> EastArray:
        """Convert to an EastArray of logical scalars (numpy).

        Returns:
            A new EastArray of the same element type, each entry promoted to its
            Python scalar form (severs the zero-copy buffer link).
        """
        return EastArray(self.element_type, [x.item() for x in self.data])

    def to_matrix(self, rows: int, cols: int) -> EastMatrix:
        """Reshape into a ``rows × cols`` matrix (numpy).

        Reshapes the existing backing buffer (row-major); ``rows * cols`` must
        equal this vector's length.

        Args:
            rows: Number of rows.
            cols: Number of columns.

        Returns:
            A matrix of the same element type viewing the reshaped buffer.
        """
        return EastMatrix(self.element_type, self.data.reshape(rows, cols))

    def map(self, fn: Any, out: EastType | None = None) -> EastVector:
        """Apply ``fn`` to each logical scalar (numpy).

        The callback runs in Python (not delegated to east-c).

        Args:
            fn: Callback ``fn(element) -> new value`` invoked once per element
                with the promoted Python scalar; no index is provided.
            out: Optional element type for the result vector, pinning its
                storage dtype. Defaults to this vector's element type.

        Returns:
            A new vector of the ``out`` (or original) element type holding the
            mapped values.
        """
        results = [fn(x.item()) for x in self.data]
        elem = out if out is not None else self.element_type
        return EastVector(elem, np.asarray(results, dtype=EAST_ELEMENT_TO_DTYPE[elem.type]))

    def fold(self, initial: Any, fn: Any) -> Any:
        """Left-fold over logical scalars (numpy).

        The callback runs in Python (not delegated to east-c).

        Args:
            initial: Seed accumulator value.
            fn: Callback ``fn(accumulator, element) -> new accumulator``, applied
                left to right over the promoted Python scalars.

        Returns:
            The final accumulator (``initial`` if the vector is empty).
        """
        acc = initial
        for x in self.data:
            acc = fn(acc, x.item())
        return acc

    @classmethod
    def zeros(cls, element_type: EastType, length: int) -> EastVector:
        """A zero-filled vector (numpy).

        Args:
            element_type: Logical element type (Float/Integer/Boolean).
            length: Number of elements.

        Returns:
            A new vector of ``length`` zeros in the canonical storage dtype.
        """
        return cls(element_type, length=length)

    @classmethod
    def ones(cls, element_type: EastType, length: int) -> EastVector:
        """A ones-filled vector (numpy).

        Args:
            element_type: Logical element type (Float/Integer/Boolean).
            length: Number of elements.

        Returns:
            A new vector of ``length`` ones in the canonical storage dtype.
        """
        return cls(element_type, np.ones(length, dtype=EAST_ELEMENT_TO_DTYPE[element_type.type]))

    @classmethod
    def fill(cls, element_type: EastType, length: int, value: Any) -> EastVector:
        """A vector of ``length`` copies of ``value`` (numpy).

        Args:
            element_type: Logical element type (Float/Integer/Boolean).
            length: Number of elements.
            value: Fill value, cast to the storage dtype.

        Returns:
            A new vector with every element set to ``value``.
        """
        return cls(element_type, np.full(length, value, dtype=EAST_ELEMENT_TO_DTYPE[element_type.type]))

    @classmethod
    def from_array(cls, element_type: EastType, items: Any) -> EastVector:
        """A vector built from an array of logical scalars (numpy).

        Args:
            element_type: Logical element type (Float/Integer/Boolean).
            items: Iterable of scalars, materialized and cast to the storage
                dtype.

        Returns:
            A new vector holding ``items`` in the canonical storage dtype.
        """
        return cls(element_type, np.asarray(list(items), dtype=EAST_ELEMENT_TO_DTYPE[element_type.type]))


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

        The logical ``element_type`` (Float, Integer, Boolean) is fixed; the
        backing array may use any compatible storage dtype (e.g. float32). A
        1-D ``data`` array is reshaped to ``(rows, cols)``.

        Args:
            element_type: Logical East element type (Float, Integer, or Boolean)
            data: Optional NumPy array (1-D flat or 2-D). Its dtype must be
                compatible with ``element_type``; made row-major contiguous.
            rows: Number of rows (used with flat/None data)
            cols: Number of columns (used with flat/None data)
        """
        if element_type.type not in EAST_ELEMENT_TO_DTYPE:
            raise TypeError(
                f"Matrix element type must be Float, Integer, or Boolean, got {element_type.type}"
            )
        self.element_type = element_type
        if data is not None:
            arr = np.asarray(data)
            if not dtype_matches_element(arr.dtype, element_type):
                raise TypeError(
                    f"Matrix<{element_type.type}> backing array has dtype {arr.dtype} "
                    f"(kind {arr.dtype.kind!r}), which is not valid {element_type.type} storage"
                )
            if arr.ndim == 1:
                arr = arr.reshape(rows, cols)
            elif arr.ndim != 2:
                raise ValueError(f"EastMatrix data must be 1-D or 2-D, got a {arr.ndim}-D array")
            self.data = np.ascontiguousarray(arr)
            self.rows = self.data.shape[0]
            self.cols = self.data.shape[1]
        else:
            self.data = np.zeros((rows, cols), dtype=EAST_ELEMENT_TO_DTYPE[element_type.type], order="C")
            self.rows = rows
            self.cols = cols

    @property
    def dtype(self) -> np.dtype:
        """Runtime storage dtype of the backing NumPy buffer."""
        return self.data.dtype

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

    # ----- Eager value methods (numpy on the backing buffer) ---------------
    #
    # Matrix is the numpy boundary (same rule as Vector): structural ops use
    # numpy on `.data` (cheap, no marshalling), and there are NO arithmetic
    # methods — do tensor math with numpy/torch on `.data` directly (and east-c
    # has no matrix arithmetic builtins to delegate to).

    def num_rows(self) -> int:
        """Number of rows (numpy).

        Returns:
            The row count of the backing buffer.
        """
        return self.rows

    def num_cols(self) -> int:
        """Number of columns (numpy).

        Returns:
            The column count of the backing buffer.
        """
        return self.cols

    def get(self, row: int, col: int) -> Any:
        """Logical scalar at ``(row, col)`` (numpy).

        Args:
            row: Zero-based row index.
            col: Zero-based column index.

        Returns:
            The element as a plain Python scalar (storage dtype unwrapped via
            ``.item()``), i.e. a logical value of ``element_type``.
        """
        return self.data[row, col].item()

    def set(self, row: int, col: int, value: Any) -> None:
        """Write ``value`` at ``(row, col)`` (numpy).

        Mutates the matrix in place. ``value`` is coerced into the backing
        storage dtype (e.g. a Float written into a float32 buffer is rounded).

        Args:
            row: Zero-based row index.
            col: Zero-based column index.
            value: New element value, compatible with ``element_type``.
        """
        self.data[row, col] = value

    def get_row(self, row: int) -> EastVector:
        """Row ``row`` as a vector (numpy).

        Args:
            row: Zero-based row index.

        Returns:
            A new ``EastVector`` over a contiguous copy of the row (not a view;
            mutating it does not write back into the matrix).
        """
        return EastVector(self.element_type, np.ascontiguousarray(self.data[row, :]))

    def get_col(self, col: int) -> EastVector:
        """Column ``col`` as a vector (numpy).

        Args:
            col: Zero-based column index.

        Returns:
            A new ``EastVector`` over a contiguous copy of the column (not a
            view; mutating it does not write back into the matrix).
        """
        return EastVector(self.element_type, np.ascontiguousarray(self.data[:, col]))

    def transpose(self) -> EastMatrix:
        """Transpose (numpy).

        Returns:
            A new ``cols x rows`` matrix; the transposed data is made row-major
            contiguous so the result is a copy, not a view.
        """
        return EastMatrix(self.element_type, np.ascontiguousarray(self.data.T))

    def to_vector(self) -> EastVector:
        """Flatten (row-major) into a vector (numpy).

        Returns:
            A new ``EastVector`` of length ``rows * cols`` with elements in
            row-major (C) order.
        """
        return EastVector(self.element_type, self.data.reshape(-1))

    def to_array(self) -> EastArray:
        """Nested array of rows of logical scalars (numpy).

        Returns:
            An ``EastArray`` of element type ``Array<element_type>``: one inner
            ``EastArray`` per row, each holding the row's elements unwrapped to
            plain Python scalars.
        """
        from east.types.types import ArrayType

        return EastArray(
            ArrayType(self.element_type),
            [EastArray(self.element_type, [x.item() for x in self.data[r, :]]) for r in range(self.rows)],
        )

    def to_rows(self) -> EastArray:
        """Array of row vectors (numpy).

        Returns:
            An ``EastArray`` of element type ``Vector<element_type>``: one
            ``EastVector`` per row, each over a contiguous copy of that row.
        """
        from east.types.types import VectorType

        return EastArray(
            VectorType(self.element_type),
            [EastVector(self.element_type, np.ascontiguousarray(self.data[r, :])) for r in range(self.rows)],
        )

    def map_elements(self, fn: Any, out: EastType | None = None) -> EastMatrix:
        """Apply ``fn`` to each logical scalar (numpy).

        Runs ``fn`` in Python (not delegated) over every element in row-major
        order, building a new matrix of the same shape.

        Args:
            fn: Callback ``fn(element) -> new value``. Receives the unwrapped
                Python scalar; no row/column index is passed.
            out: Optional East element type pinning the result element type and
                its storage dtype; defaults to this matrix's ``element_type``.

        Returns:
            A new ``EastMatrix`` of element type ``out`` (or ``element_type``)
            and the same dimensions. An empty matrix (zero rows or columns) is
            returned unchanged in shape without invoking ``fn``.
        """
        elem = out if out is not None else self.element_type
        if self.rows == 0 or self.cols == 0:
            return EastMatrix(elem, rows=self.rows, cols=self.cols)
        results = [[fn(self.data[r, c].item()) for c in range(self.cols)] for r in range(self.rows)]
        return EastMatrix(elem, np.asarray(results, dtype=EAST_ELEMENT_TO_DTYPE[elem.type]))

    def map_rows(self, fn: Any, out: EastType | None = None) -> EastMatrix:
        """Apply ``fn`` to each row vector, returning a row vector (numpy).

        Runs ``fn`` in Python (not delegated) once per row, building a new
        matrix from the returned rows.

        Args:
            fn: Callback ``fn(row_vector) -> new row``. Receives the row as an
                ``EastVector`` (no row index is passed) and must return that
                row's replacement as an ``EastVector`` or a sequence of values;
                all returned rows must share one width.
            out: Optional East element type pinning the result element type and
                its storage dtype; defaults to this matrix's ``element_type``.

        Returns:
            A new ``EastMatrix`` of element type ``out`` (or ``element_type``)
            whose rows are the callback results. A zero-row matrix is returned
            with the same column count and without invoking ``fn``.
        """
        elem = out if out is not None else self.element_type
        if self.rows == 0:
            return EastMatrix(elem, rows=0, cols=self.cols)
        new_rows = [fn(EastVector(self.element_type, np.ascontiguousarray(self.data[r, :]))) for r in range(self.rows)]
        data = np.asarray(
            [row.data if isinstance(row, EastVector) else row for row in new_rows],
            dtype=EAST_ELEMENT_TO_DTYPE[elem.type],
        )
        return EastMatrix(elem, data)

    @classmethod
    def zeros(cls, element_type: EastType, rows: int, cols: int) -> EastMatrix:
        """A zero-filled matrix (numpy).

        Args:
            element_type: East element type (Float, Integer, or Boolean).
            rows: Number of rows.
            cols: Number of columns.

        Returns:
            A new ``rows x cols`` ``EastMatrix`` of zeros in the element type's
            storage dtype.
        """
        return cls(element_type, rows=rows, cols=cols)

    @classmethod
    def ones(cls, element_type: EastType, rows: int, cols: int) -> EastMatrix:
        """A ones-filled matrix (numpy).

        Args:
            element_type: East element type (Float, Integer, or Boolean).
            rows: Number of rows.
            cols: Number of columns.

        Returns:
            A new ``rows x cols`` ``EastMatrix`` of ones in the element type's
            storage dtype.
        """
        return cls(element_type, np.ones((rows, cols), dtype=EAST_ELEMENT_TO_DTYPE[element_type.type]))

    @classmethod
    def fill(cls, element_type: EastType, rows: int, cols: int, value: Any) -> EastMatrix:
        """A matrix filled with ``value`` (numpy).

        Args:
            element_type: East element type (Float, Integer, or Boolean).
            rows: Number of rows.
            cols: Number of columns.
            value: Fill value, coerced into the element type's storage dtype.

        Returns:
            A new ``rows x cols`` ``EastMatrix`` with every cell set to
            ``value``.
        """
        return cls(element_type, np.full((rows, cols), value, dtype=EAST_ELEMENT_TO_DTYPE[element_type.type]))

    @classmethod
    def from_array(cls, element_type: EastType, rows: list) -> EastMatrix:
        """Build from a nested array of row lists (numpy).

        Args:
            element_type: East element type (Float, Integer, or Boolean) for
                the cells and the backing storage dtype.
            rows: Iterable of rows, each an iterable of cell values; all rows
                must share one length.

        Returns:
            A new ``EastMatrix`` with one row per inner sequence, cells coerced
            into the element type's storage dtype.
        """
        data = np.asarray(
            [list(r) for r in rows],
            dtype=EAST_ELEMENT_TO_DTYPE[element_type.type],
        )
        return cls(element_type, data)

    @classmethod
    def from_rows(cls, element_type: EastType, rows: list) -> EastMatrix:
        """Build from a list of row vectors or row lists (numpy).

        Args:
            element_type: East element type (Float, Integer, or Boolean) for
                the cells and the backing storage dtype.
            rows: Iterable of rows, each either an ``EastVector`` (its backing
                buffer is used) or a plain sequence of cell values; all rows
                must share one width.

        Returns:
            A new ``EastMatrix`` with one row per entry, cells coerced into the
            element type's storage dtype.
        """
        data = np.asarray(
            [r.data if isinstance(r, EastVector) else r for r in rows],
            dtype=EAST_ELEMENT_TO_DTYPE[element_type.type],
        )
        return cls(element_type, data)


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


# Lazy import for the east-c builtin shim that backs the eager value methods.
# Same cycle-break pattern as make_east_key: values.py loads before the
# compiler/bridge Cython extensions.
_cached_call_builtin: Any = None


def _call_builtin(name: str, type_params: list, args: list, output_type: EastType) -> Any:
    """Invoke an east-c builtin eagerly (lazy import of the Cython shim)."""
    global _cached_call_builtin
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

    def sort(self, *, key: Any = None, reverse: bool = False) -> None:
        """Sort in place using East's total order (not Python's default ordering).

        Delegates to east-c (``ArraySortDefault`` keyless, ``ArraySort`` keyed)
        and assigns the result back to keep the in-place list contract.
        """
        self._check_not_iterating()
        self[:] = list(self.sorted(key=key, reverse=reverse))

    # ----- Eager value methods (delegate to east-c; results are live values) ---

    def sorted(self, key: Any = None, *, reverse: bool = False) -> EastArray:
        """New array sorted ascending by East's total order (east-c ArraySort).

        Args:
            key: Optional projection ``fn(element) -> sort key``; elements are
                ordered by the East total order of the projected keys. When
                omitted, elements are sorted by their own East total order.
            reverse: When True, the sorted result is reversed (descending).

        Returns:
            A new array; the original is left unchanged.

        Note:
            Ordering follows East's total order, not Python's ``<``. The keyless
            path uses ``ArraySortDefault``; a ``key`` whose result type is sampled
            from the first element uses ``ArraySort``.
        """
        from east.types.types import ArrayType

        if key is None:
            result = _call_builtin("ArraySortDefault", [self.element_type], [self], ArrayType(self.element_type))
        else:
            t2 = type_of(key(self[0])) if len(self) else self.element_type
            callback = EastFunction(key, [self.element_type], t2)
            result = _call_builtin("ArraySort", [self.element_type, t2], [self, callback], ArrayType(self.element_type))
        return result.reversed() if reverse else result

    def is_sorted(self, key: Any = None) -> bool:
        """Whether elements are in non-decreasing East order (east-c ArrayIsSorted).

        Args:
            key: Optional projection ``fn(element) -> sort key`` to compare by;
                without it, elements are compared directly.

        Returns:
            True if each element's key is in East total order relative to the next.
        """
        from east.types.types import BooleanType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = type_of(key(self[0])) if len(self) else self.element_type
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("ArrayIsSorted", [self.element_type, t2], [self, callback], BooleanType)

    def find_sorted_first(self, target: Any, key: Any = None) -> int:
        """Leftmost insertion index for ``target`` in a sorted array (east-c ArrayFindSortedFirst).

        Assumes the array is already sorted in East order (by ``key`` if given).

        Args:
            target: Value to locate; compared against ``key(element)`` (or the
                element itself when ``key`` is omitted).
            key: Optional projection ``fn(element) -> comparable`` matching the
                sort order; when given, ``target`` is compared in the key's type.

        Returns:
            The first index where ``target`` could be inserted while keeping
            order, i.e. the leftmost position of an equal key.
        """
        from east.types.types import IntegerType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("ArrayFindSortedFirst", [self.element_type, t2], [self, target, callback], IntegerType)

    def find_sorted_last(self, target: Any, key: Any = None) -> int:
        """Rightmost insertion index for ``target`` in a sorted array (east-c ArrayFindSortedLast).

        Assumes the array is already sorted in East order (by ``key`` if given).

        Args:
            target: Value to locate; compared against ``key(element)`` (or the
                element itself when ``key`` is omitted).
            key: Optional projection ``fn(element) -> comparable`` matching the
                sort order; when given, ``target`` is compared in the key's type.

        Returns:
            The last index where ``target`` could be inserted while keeping
            order, i.e. just past the rightmost equal key.
        """
        from east.types.types import IntegerType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("ArrayFindSortedLast", [self.element_type, t2], [self, target, callback], IntegerType)

    def find_sorted_range(self, target: Any, key: Any = None) -> EastStruct:
        """Half-open index range of elements equal to ``target`` in a sorted array (east-c ArrayFindSortedRange).

        Assumes the array is already sorted in East order (by ``key`` if given).

        Args:
            target: Value to locate; compared against ``key(element)`` (or the
                element itself when ``key`` is omitted).
            key: Optional projection ``fn(element) -> comparable`` matching the
                sort order; when given, ``target`` is compared in the key's type.

        Returns:
            A struct ``{start, end}`` of integers giving the ``[start, end)``
            span of matching elements; ``start == end`` when ``target`` is absent.
        """
        from east.types.types import IntegerType, StructType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        out_type = StructType([("start", IntegerType), ("end", IntegerType)])
        return _call_builtin("ArrayFindSortedRange", [self.element_type, t2], [self, target, callback], out_type)

    def find_first(self, target: Any, key: Any = None) -> EastVariant:
        """First index whose ``key`` equals ``target`` by linear scan (east-c ArrayFindFirst).

        Does not require a sorted array.

        Args:
            target: Value to match against ``key(element)`` (or the element
                itself when ``key`` is omitted), using East equality.
            key: Optional projection ``fn(element) -> comparable``; when given,
                ``target`` is matched in the key's type.

        Returns:
            ``some(index)`` for the first match, else ``none``.
        """
        from east.types.types import IntegerType, NullType, VariantType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        out_type = VariantType([("none", NullType), ("some", IntegerType)])
        return _call_builtin("ArrayFindFirst", [self.element_type, t2], [self, target, callback], out_type)

    def concat(self, other: EastArray) -> EastArray:
        """New array with ``other`` appended after this array's elements (east-c ArrayConcat).

        Args:
            other: Array of the same element type to append.

        Returns:
            A new array; neither input is modified.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayConcat", [self.element_type], [self, other], ArrayType(self.element_type))

    def slice(self, start: int, end: int) -> EastArray:
        """New array holding the half-open sub-range ``[start, end)`` (east-c ArraySlice).

        Args:
            start: Inclusive start index.
            end: Exclusive end index.

        Returns:
            A new array of the elements in the range.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArraySlice", [self.element_type], [self, int(start), int(end)], ArrayType(self.element_type))

    def get_keys(self, indices: EastArray) -> EastArray:
        """Gather elements at the given indices into a new array (east-c ArrayGetKeys).

        Args:
            indices: Array of integer indices to read, in order.

        Returns:
            A new array with one element per index, ``self[index]`` for each.
        """
        from east.types.types import ArrayType, IntegerType

        callback = EastFunction(lambda idx: self[idx], [IntegerType], self.element_type)
        return _call_builtin("ArrayGetKeys", [self.element_type], [self, indices, callback], ArrayType(self.element_type))

    def copy(self) -> EastArray:
        """A shallow copy of this array (east-c ArrayCopy).

        Returns:
            A new array with the same elements.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayCopy", [self.element_type], [self], ArrayType(self.element_type))

    def reversed(self) -> EastArray:
        """New array with the elements in reverse order (east-c ArrayReverse).

        Returns:
            A new array; the original is left unchanged.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayReverse", [self.element_type], [self], ArrayType(self.element_type))

    def has(self, index: int) -> bool:
        """Whether ``index`` is within bounds (``0 <= index < len``)."""
        return 0 <= int(index) < len(self)

    def get(self, index: int) -> Any:
        """Element at ``index`` (the container read delegates to the live value on a proxy)."""
        return self[index]

    def get_or_default(self, index: int, default: Any) -> Any:
        """Element at ``index``, or ``default`` when ``index`` is out of bounds."""
        return self[index] if self.has(index) else default

    def try_get(self, index: int) -> EastVariant:
        """``some(element)`` when ``index`` is in bounds, else ``none``."""
        return EastVariant("some", self[index]) if self.has(index) else EastVariant("none", east_null)

    def to_set(self, key: Any = None) -> EastSet:
        """Set of the elements, or of their projected keys (east-c ArrayToSet).

        Args:
            key: Optional projection ``fn(element) -> key``; the index is not
                passed. Without it, the elements themselves form the set.

        Returns:
            A set of the distinct (East-equal) elements or keys. The element
            type is taken from the projection sampled on the first element.
        """
        from east.types.types import IntegerType, SetType

        if key is None:
            k2 = self.element_type
            callback = EastFunction(lambda el, idx: el, [self.element_type, IntegerType], k2)
        else:
            k2 = type_of(key(self[0])) if len(self) else self.element_type
            callback = EastFunction(lambda el, idx: key(el), [self.element_type, IntegerType], k2)
        return _call_builtin("ArrayToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def unique(self) -> EastSet:
        """The set of distinct elements (east-c ArrayToSet with an identity key).

        Returns:
            A set of the distinct (East-equal) elements.
        """
        return self.to_set()

    def to_dict(self, key: Any, value: Any = None, combine: Any = None) -> EastDict:
        """Build a dict keyed by ``key(element)`` from the array (east-c ArrayToDict).

        Args:
            key: ``fn(element) -> dict key``; its result type, sampled on the
                first element, becomes the dict key type.
            value: Optional ``fn(element) -> value``; defaults to the element
                itself. Its result type becomes the dict value type.
            combine: Optional ``fn(existing, incoming) -> value`` to resolve a
                key collision. Without it, the later element wins.

        Returns:
            A dict with East-ordered keys. An empty array yields an empty dict.
        """
        from east.types.types import DictType, IntegerType

        if len(self) == 0:
            k2 = self.element_type
            t2 = self.element_type
            return EastDict(k2, t2)
        k2 = type_of(key(self[0]))
        value_fn = (lambda el: el) if value is None else value
        t2 = self.element_type if value is None else type_of(value(self[0]))
        key_cb = EastFunction(lambda el, idx: key(el), [self.element_type, IntegerType], k2)
        val_cb = EastFunction(lambda el, idx: value_fn(el), [self.element_type, IntegerType], t2)
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin("ArrayToDict", [self.element_type, k2, t2], [self, key_cb, val_cb, combine_cb], DictType(k2, t2))

    def map(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Apply ``fn`` to each element, producing a new array (east-c ArrayMap).

        Args:
            fn: ``fn(element) -> new value``; the index is not passed.
            out: Optional result element type. When omitted, it is inferred by
                applying ``fn`` to the first element.

        Returns:
            A new array of the same length; an empty array yields an empty array
            of element type ``out`` (or Null when ``out`` is omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        t2 = out if out is not None else type_of(fn(self[0]))
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], t2)
        return _call_builtin("ArrayMap", [self.element_type, t2], [self, callback], ArrayType(t2))

    def filter(self, predicate: Any) -> EastArray:
        """Keep elements for which ``predicate`` is truthy (east-c ArrayFilter).

        Args:
            predicate: ``fn(element) -> bool``; the index is not passed.

        Returns:
            A new array of the matching elements in original order.
        """
        from east.types.types import ArrayType, BooleanType, IntegerType

        callback = EastFunction(lambda el, idx: bool(predicate(el)), [self.element_type, IntegerType], BooleanType)
        return _call_builtin("ArrayFilter", [self.element_type], [self, callback], ArrayType(self.element_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Transform and filter in one pass, keeping ``some`` results (east-c ArrayFilterMap).

        Args:
            fn: ``fn(element) -> some(value) | none``; the index is not passed.
                Elements mapped to ``none`` are dropped.
            out: Optional result element type. When omitted, it is inferred from
                the ``some`` payload of ``fn`` on the first element.

        Returns:
            A new array of the unwrapped ``some`` values; an empty input yields
            an empty array of element type ``out`` (or Null when omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType, VariantType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        t2 = out if out is not None else type_of(fn(self[0]).value)
        out_variant = VariantType([("none", NullType), ("some", t2)])
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], out_variant)
        return _call_builtin("ArrayFilterMap", [self.element_type, t2], [self, callback], ArrayType(t2))

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First ``some(value)`` that ``fn`` produces while scanning (east-c ArrayFirstMap).

        Args:
            fn: ``fn(element) -> some(value) | none``; the index is not passed.
                The scan stops at the first ``some``.
            out: Optional payload type for the result variant. When omitted, it
                is inferred from the ``some`` payload of ``fn`` on the first element.

        Returns:
            ``some(value)`` for the first matching element, else ``none``; an
            empty array yields ``none``.
        """
        from east.types.types import IntegerType, NullType, VariantType

        if len(self) == 0:
            t2 = out if out is not None else self.element_type
            return EastVariant("none", east_null)
        t2 = out if out is not None else type_of(fn(self[0]).value)
        out_variant = VariantType([("none", NullType), ("some", t2)])
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], out_variant)
        return _call_builtin("ArrayFirstMap", [self.element_type, t2], [self, callback], out_variant)

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Any:
        """Map each element then pairwise-combine the mapped values (east-c ArrayMapReduce).

        Args:
            map_fn: ``fn(element) -> mapped value``; the index is not passed.
            reduce_fn: ``fn(left, right) -> combined`` applied pairwise over the
                mapped values; it should be associative for a well-defined result.
            out: Optional type of the mapped/result value. When omitted, it is
                inferred from ``map_fn`` on the first element.

        Returns:
            The single reduced value.

        Raises:
            Errors on an empty array, since there is no identity value to
            return; guard with ``len`` if the array may be empty.
        """
        from east.types.types import IntegerType

        if len(self) == 0:
            raise ValueError("map_reduce on an empty array has no result (no identity element)")
        t2 = out if out is not None else type_of(map_fn(self[0]))
        map_cb = EastFunction(lambda el, idx: map_fn(el), [self.element_type, IntegerType], t2)
        reduce_cb = EastFunction(lambda a, b: reduce_fn(a, b), [t2, t2], t2)
        return _call_builtin("ArrayMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def fold(self, initial: Any, fn: Any) -> Any:
        """Left-fold the elements from ``initial`` (east-c ArrayFold).

        Args:
            initial: The starting accumulator; its type fixes the result type.
            fn: ``fn(accumulator, element) -> new accumulator``; applied
                left-to-right, the index is not passed.

        Returns:
            The final accumulator; ``initial`` itself for an empty array.
        """
        from east.types.types import IntegerType

        t2 = type_of(initial)
        callback = EastFunction(lambda acc, el, idx: fn(acc, el), [t2, self.element_type, IntegerType], t2)
        return _call_builtin("ArrayFold", [self.element_type, t2], [self, initial, callback], t2)

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Map each element to an array and concatenate the results (east-c ArrayFlattenToArray).

        Args:
            fn: ``fn(element) -> array``; the index is not passed.
            out: Optional element type of the inner arrays. When omitted, it is
                taken from the array ``fn`` returns for the first element.

        Returns:
            A new flat array; an empty input yields an empty array of element
            type ``out`` (or Null when omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        t2 = out if out is not None else fn(self[0]).element_type
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], ArrayType(t2))
        return _call_builtin("ArrayFlattenToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Map each element to a set and union the results (east-c ArrayFlattenToSet).

        Args:
            fn: ``fn(element) -> set``; the index is not passed.
            out: Optional element type of the inner sets. When omitted, it is
                taken from the set ``fn`` returns for the first element.

        Returns:
            A set of the distinct (East-equal) elements across all produced sets;
            an empty input yields an empty set.
        """
        from east.types.types import IntegerType, SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.element_type)
        k2 = out if out is not None else fn(self[0]).element_type
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], SetType(k2))
        return _call_builtin("ArrayFlattenToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> EastDict:
        """Map each element to a dict and merge the results (east-c ArrayFlattenToDict).

        Args:
            fn: ``fn(element) -> dict``; the index is not passed. The key and
                value types are sampled from the dict produced for the first element.
            combine: Optional ``fn(existing, incoming) -> value`` to resolve a
                shared key. Without it, the later value wins.

        Returns:
            A merged dict with East-ordered keys; an empty input yields an empty dict.
        """
        from east.types.types import DictType, IntegerType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sample = fn(self[0])
        k2 = sample.key_type
        t2 = sample.value_type
        map_cb = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], DictType(k2, t2))
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin("ArrayFlattenToDict", [self.element_type, k2, t2], [self, map_cb, combine_cb], DictType(k2, t2))

    def for_each(self, fn: Any) -> None:
        """Call ``fn`` once per element for its side effects (east-c ArrayForEach).

        Args:
            fn: ``fn(element) -> any``; the index is not passed and the return
                value is discarded.

        Returns:
            None.
        """
        from east.types.types import IntegerType, NullType

        callback = EastFunction(lambda el, idx: (fn(el), east_null)[1], [self.element_type, IntegerType], NullType)
        _call_builtin("ArrayForEach", [self.element_type, NullType], [self, callback], NullType)

    def group_by(self, key: Any) -> EastDict:
        """Group elements into a dict of arrays keyed by ``key(element)``.

        Args:
            key: ``fn(element) -> group key``; its result type, sampled on the
                first element, becomes the dict key type.

        Returns:
            A dict mapping each group key to an array of its elements, with keys
            in East total order. Bucketing runs in Python because east-c exposes
            no single-callback group-by (only the two-callback ArrayGroupFold).
        """
        from east.types.types import ArrayType

        buckets: dict[Any, list] = {}
        order: list = []
        for item in self:
            k = key(item)
            if k not in buckets:
                buckets[k] = []
                order.append(k)
            buckets[k].append(item)
        key_type = type_of(order[0]) if order else self.element_type
        result: EastDict = EastDict(key_type, ArrayType(self.element_type))
        for k in order:
            result[k] = EastArray(self.element_type, buckets[k])
        return result

    def string_join(self, separator: str) -> str:
        """Join an Array<String> into one string (east-c ArrayStringJoin).

        Args:
            separator: String placed between consecutive elements.

        Returns:
            The concatenated string.
        """
        from east.types.types import StringType

        return _call_builtin("ArrayStringJoin", [], [self, separator], StringType)

    @classmethod
    def generate(cls, count: int, fn: Any, element_type: EastType | None = None) -> EastArray:
        """Build an array by calling ``fn`` for each index (east-c ArrayGenerate).

        Args:
            count: Number of elements to produce.
            fn: ``fn(index) -> element`` for index ``0 .. count-1``.
            element_type: Optional element type. When omitted, it is inferred
                from ``fn(0)``.

        Returns:
            A new array of length ``count``; ``count == 0`` yields an empty array
            of element type ``element_type`` (or Null when omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType

        n = int(count)
        if n == 0:
            return cls(element_type if element_type is not None else NullType, [])
        t = element_type if element_type is not None else type_of(fn(0))
        callback = EastFunction(fn, [IntegerType], t)
        return _call_builtin("ArrayGenerate", [t], [n, callback], ArrayType(t))

    @classmethod
    def range(cls, start: int, end: int, step: int = 1) -> EastArray:
        """Array of integers over the half-open range ``[start, end)`` (east-c ArrayRange).

        Args:
            start: Inclusive first value.
            end: Exclusive bound.
            step: Increment between consecutive values (default 1).

        Returns:
            An Array<Integer> of the stepped values.
        """
        from east.types.types import ArrayType, IntegerType

        return _call_builtin("ArrayRange", [], [int(start), int(end), int(step)], ArrayType(IntegerType))

    @classmethod
    def linspace(cls, start: float, end: float, count: int) -> EastArray:
        """``count`` evenly spaced Floats from ``start`` to ``end`` inclusive (east-c ArrayLinspace).

        Args:
            start: First value.
            end: Last value.
            count: Number of points to generate.

        Returns:
            An Array<Float> of the evenly spaced values.
        """
        from east.types.types import ArrayType, FloatType

        return _call_builtin("ArrayLinspace", [], [float(start), float(end), int(count)], ArrayType(FloatType))

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

    # ----- Eager value methods (delegate to east-c; results are live values) ---

    @staticmethod
    def generate(n: int, fn: Any, element_type: EastType | None = None) -> EastSet:
        """Build a set from ``fn(i)`` over ``i`` in ``[0, n)`` (east-c SetGenerate).

        Args:
            n: Number of indices to apply ``fn`` to; ``0`` yields an empty set.
            fn: ``fn(index) -> element``; duplicate elements collapse into one.
            element_type: Pins the element type. When omitted it is inferred by
                sampling ``fn(0)``.

        Returns:
            A new set of the distinct ``fn(i)`` values, in East total order.
        """
        from east.types.types import IntegerType, NullType, SetType

        if int(n) == 0:
            return EastSet(element_type if element_type is not None else NullType)
        k = element_type if element_type is not None else type_of(fn(0))
        gen = EastFunction(fn, [IntegerType], k)
        side = EastFunction(lambda el: east_null, [k], NullType)
        return _call_builtin("SetGenerate", [k], [int(n), gen, side], SetType(k))

    def has(self, value: Any) -> bool:
        """Whether ``value`` is a member (east-c SetHas, via the live value on a proxy)."""
        return value in self

    def insert(self, value: Any) -> None:
        """Add ``value`` in place (east-c SetInsert)."""
        self.add(value)

    def delete(self, value: Any) -> None:
        """Remove ``value`` in place if present (east-c SetDelete)."""
        self.discard(value)

    def union(self, other: EastSet) -> EastSet:
        """Set union as a new set (east-c SetUnion)."""
        return self._set_op("SetUnion", other)

    def intersect(self, other: EastSet) -> EastSet:
        """Set intersection as a new set (east-c SetIntersect)."""
        return self._set_op("SetIntersect", other)

    def diff(self, other: EastSet) -> EastSet:
        """Set difference (elements in self but not ``other``) as a new set (east-c SetDiff)."""
        return self._set_op("SetDiff", other)

    def sym_diff(self, other: EastSet) -> EastSet:
        """Symmetric difference (elements in exactly one set) as a new set (east-c SetSymDiff)."""
        return self._set_op("SetSymDiff", other)

    def _set_op(self, name: str, other: EastSet) -> EastSet:
        from east.types.types import SetType

        return _call_builtin(name, [self.element_type], [self, other], SetType(self.element_type))

    def union_in_place(self, other: EastSet) -> None:
        """Add every element of ``other`` to self in place.

        On a C-backed proxy (``_data is None``) this mutates the live east-c set via
        ``SetUnionInPlace``. A bare Python-constructed set has no live C value to
        mutate, so delegate the union to east-c (``SetUnion``) and rebind the local
        store from the result — both paths run the union in east-c.
        """
        self._check_not_iterating()
        if self._data is None:
            from east.types.types import NullType

            _call_builtin("SetUnionInPlace", [self.element_type], [self, other], NullType)
        else:
            self._data = SortedSet(self.union(other), key=_make_east_key(self.element_type))

    def is_subset(self, other: EastSet) -> bool:
        """Whether every element of self is also in ``other`` (east-c SetIsSubset)."""
        from east.types.types import BooleanType

        return _call_builtin("SetIsSubset", [self.element_type], [self, other], BooleanType)

    def is_disjoint(self, other: EastSet) -> bool:
        """Whether self and ``other`` share no elements (east-c SetIsDisjoint)."""
        from east.types.types import BooleanType

        return _call_builtin("SetIsDisjoint", [self.element_type], [self, other], BooleanType)

    def copy(self) -> EastSet:
        """An independent copy of the set (east-c SetCopy)."""
        from east.types.types import SetType

        return _call_builtin("SetCopy", [self.element_type], [self], SetType(self.element_type))

    def for_each(self, fn: Any) -> None:
        """Call ``fn(element)`` for each element, for side effects only (east-c SetForEach).

        Args:
            fn: ``fn(element)``; its return value is discarded.
        """
        from east.types.types import NullType

        callback = EastFunction(lambda el: (fn(el), east_null)[1], [self.element_type], NullType)
        _call_builtin("SetForEach", [self.element_type, NullType], [self, callback], NullType)

    def to_array(self, key: Any = None) -> EastArray:
        """Elements as an array in East total order (east-c SetToArray).

        Args:
            key: Optional ``key(element) -> value`` projecting each element; when
                omitted the elements themselves are returned. The result element
                type is inferred by sampling ``key`` on the first element.

        Returns:
            A new array of the (projected) elements, ordered by East total order.
        """
        from east.types.types import ArrayType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        elif len(self) == 0:
            return EastArray(self.element_type, [])
        else:
            t2 = type_of(key(next(iter(self))))
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("SetToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    def to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Set of ``fn(element)`` over all elements (east-c SetToSet).

        Args:
            fn: ``fn(element) -> new element``; collisions in the result collapse.
            out: Pins the result element type; otherwise inferred by sampling
                ``fn`` on the first element.

        Returns:
            A new set of the distinct mapped values.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.element_type)
        k2 = out if out is not None else type_of(fn(next(iter(self))))
        callback = EastFunction(fn, [self.element_type], k2)
        return _call_builtin("SetToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def to_dict(self, key: Any, value: Any, combine: Any = None) -> EastDict:
        """Build a dict keyed by ``key(element)`` with ``value(element)`` (east-c SetToDict).

        Args:
            key: ``key(element) -> dict key``; key and value types are inferred by
                sampling the first element.
            value: ``value(element) -> dict value``.
            combine: On a key collision, ``combine(existing, incoming, key) -> value``
                decides the kept value; without ``combine`` the later element wins.

        Returns:
            A new dict keyed by the projected keys.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sample = next(iter(self))
        k2 = type_of(key(sample))
        t2 = type_of(value(sample))
        key_cb = EastFunction(key, [self.element_type], k2)
        value_cb = EastFunction(value, [self.element_type], t2)
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2, k)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin(
            "SetToDict", [self.element_type, k2, t2], [self, key_cb, value_cb, combine_cb], DictType(k2, t2)
        )

    def map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Map each element to a value, keyed by the element itself (east-c SetMap → Dict).

        Args:
            fn: ``fn(element) -> value``; the value type is inferred by sampling
                ``fn`` on the first element unless ``out`` is given.
            out: Pins the result value type.

        Returns:
            A new dict from each element to its mapped value.
        """
        from east.types.types import DictType

        if len(self) == 0:
            t2 = out if out is not None else self.element_type
            return EastDict(self.element_type, t2)
        t2 = out if out is not None else type_of(fn(next(iter(self))))
        callback = EastFunction(fn, [self.element_type], t2)
        return _call_builtin("SetMap", [self.element_type, t2], [self, callback], DictType(self.element_type, t2))

    def filter(self, predicate: Any) -> EastSet:
        """Keep elements satisfying ``predicate`` (east-c SetFilter).

        Args:
            predicate: ``predicate(element) -> bool``.

        Returns:
            A new set of the elements for which ``predicate`` is true.
        """
        from east.types.types import BooleanType, SetType

        callback = EastFunction(lambda el: bool(predicate(el)), [self.element_type], BooleanType)
        return _call_builtin("SetFilter", [self.element_type], [self, callback], SetType(self.element_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Map then keep ``some`` results, keyed by the element (east-c SetFilterMap → Dict).

        Args:
            fn: ``fn(element) -> some(value) | none``; ``some`` keeps the element
                with that value, ``none`` drops it. The value type is inferred from
                the ``some`` payload by sampling the first element unless ``out`` is given.
            out: Pins the result value type.

        Returns:
            A new dict from each kept element to its unwrapped value.
        """
        from east.types.types import DictType, OptionType

        if len(self) == 0:
            v2 = out if out is not None else self.element_type
            return EastDict(self.element_type, v2)
        if out is not None:
            v2 = out
        else:
            sampled = type_of(fn(next(iter(self))))
            from east.types.types import get_option_inner_type

            v2 = get_option_inner_type(sampled)
        callback = EastFunction(fn, [self.element_type], OptionType(v2))
        return _call_builtin(
            "SetFilterMap", [self.element_type, v2], [self, callback], DictType(self.element_type, v2)
        )

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First ``some(value)`` produced by ``fn`` over elements, else ``none`` (east-c SetFirstMap).

        Elements are visited in East total order, so the result is deterministic.

        Args:
            fn: ``fn(element) -> some(value) | none``; the value type is inferred
                from the ``some`` payload by sampling the first element unless ``out`` is given.
            out: Pins the ``some`` payload type.

        Returns:
            ``some(value)`` for the first element that yields one, otherwise ``none``.
        """
        from east.types.types import OptionType

        if len(self) == 0:
            return EastVariant("none", east_null)
        if out is not None:
            t2 = out
        else:
            from east.types.types import get_option_inner_type

            t2 = get_option_inner_type(type_of(fn(next(iter(self)))))
        callback = EastFunction(fn, [self.element_type], OptionType(t2))
        return _call_builtin("SetFirstMap", [self.element_type, t2], [self, callback], OptionType(t2))

    def map_reduce(self, fn: Any, reduce: Any) -> Any:
        """Map each element then combine the results pairwise (east-c SetMapReduce).

        Args:
            fn: ``fn(element) -> value``; the value/result type is inferred by
                sampling ``fn`` on the first element.
            reduce: ``reduce(a, b) -> combined`` folding the mapped values together.

        Returns:
            The single combined value.

        Raises:
            ValueError: If the set is empty (the operation has no identity element).
        """
        if len(self) == 0:
            raise ValueError("map_reduce on an empty set has no result (no identity element)")
        sample = next(iter(self))
        t2 = type_of(fn(sample))
        map_cb = EastFunction(fn, [self.element_type], t2)
        reduce_cb = EastFunction(lambda a, b: reduce(a, b), [t2, t2], t2)
        return _call_builtin("SetMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def reduce(self, initial: Any, fn: Any) -> Any:
        """Fold over elements from a seed accumulator (east-c SetReduce).

        Elements are visited in East total order.

        Args:
            initial: Seed accumulator; its type fixes the accumulator/result type.
            fn: ``fn(acc, element) -> new acc`` applied for each element.

        Returns:
            The final accumulator.
        """
        t2 = type_of(initial)
        callback = EastFunction(lambda acc, el: fn(acc, el), [t2, self.element_type], t2)
        return _call_builtin("SetReduce", [self.element_type, t2], [self, callback, initial], t2)

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Concatenate the arrays returned by ``fn`` over all elements (east-c SetFlattenToArray).

        Args:
            fn: ``fn(element) -> array``; the result element type is inferred from
                that array's element type by sampling the first element unless
                ``out`` is given.
            out: Pins the result element type.

        Returns:
            A new array concatenating each element's array, in East element order.
        """
        from east.types.types import ArrayType

        if len(self) == 0:
            return EastArray(out if out is not None else self.element_type, [])
        t2 = out if out is not None else type_of(fn(next(iter(self)))).element_type
        callback = EastFunction(fn, [self.element_type], ArrayType(t2))
        return _call_builtin("SetFlattenToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Union the sets returned by ``fn`` over all elements (east-c SetFlattenToSet).

        Args:
            fn: ``fn(element) -> set``; the result element type is inferred from
                that set's element type by sampling the first element unless
                ``out`` is given.
            out: Pins the result element type.

        Returns:
            A new set of the distinct elements across every produced set.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.element_type)
        k2 = out if out is not None else type_of(fn(next(iter(self)))).element_type
        callback = EastFunction(fn, [self.element_type], SetType(k2))
        return _call_builtin("SetFlattenToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> EastDict:
        """Merge the dicts returned by ``fn`` over all elements (east-c SetFlattenToDict).

        Key and value types are inferred from the dict produced for the first element.

        Args:
            fn: ``fn(element) -> dict`` whose entries are merged into the result.
            combine: On a shared key, ``combine(existing, incoming, key) -> value``
                decides the kept value; without ``combine`` the later element's value wins.

        Returns:
            A new dict merging every produced dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sampled = type_of(fn(next(iter(self))))
        k2 = sampled.key_type
        t2 = sampled.value_type
        callback = EastFunction(fn, [self.element_type], DictType(k2, t2))
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2, k)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin(
            "SetFlattenToDict", [self.element_type, k2, t2], [self, callback, combine_cb], DictType(k2, t2)
        )

    def group_fold(self, key: Any, initial: Any, fold: Any) -> EastDict:
        """Group elements by ``key(element)`` and fold within each group (east-c SetGroupFold).

        Key and accumulator types are inferred by sampling the first element.

        Args:
            key: ``key(element) -> group key`` assigning each element to a bucket.
            initial: ``initial(group_key) -> seed`` producing each bucket's seed
                accumulator.
            fold: ``fold(acc, element) -> new acc`` accumulating each element into
                its bucket.

        Returns:
            A new dict from each group key to its folded accumulator.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sample = next(iter(self))
        k2 = type_of(key(sample))
        t2 = type_of(initial(key(sample)))
        key_cb = EastFunction(key, [self.element_type], k2)
        init_cb = EastFunction(initial, [k2], t2)
        fold_cb = EastFunction(lambda acc, el: fold(acc, el), [t2, self.element_type], t2)
        return _call_builtin(
            "SetGroupFold", [self.element_type, k2, t2], [self, key_cb, init_cb, fold_cb], DictType(k2, t2)
        )

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

    # ----- Eager value methods (delegate to east-c; results are live values) ---

    def size(self) -> int:
        """Number of key-value pairs (east-c DictSize).

        Returns:
            The entry count. On a C-backed proxy this reads the live value.
        """
        return len(self)

    def has(self, key: Any) -> bool:
        """Whether ``key`` is present (east-c DictHas).

        Args:
            key: The key to look up, compared under East's total ordering.

        Returns:
            True if an entry for ``key`` exists. On a C-backed proxy this
            reads the live value.
        """
        return key in self

    def get_or_default(self, key: Any, default: Any) -> Any:
        """Value for ``key``, or ``default`` if absent (east-c DictGetOrDefault).

        Args:
            key: The key to look up, compared under East's total ordering.
            default: Value returned when ``key`` is not present.

        Returns:
            The stored value for ``key``, otherwise ``default``.
        """
        # Use the container protocol (not self.get): on a C-backed proxy `self[key]`/
        # `key in self` route to the live value, whereas `.get` would read empty _data.
        return self[key] if key in self else default  # noqa: SIM401

    def try_get(self, key: Any) -> EastVariant:
        """Optionally fetch the value for ``key`` (east-c DictTryGet).

        Args:
            key: The key to look up, compared under East's total ordering.

        Returns:
            ``some(value)`` if present, else ``none``.
        """
        return EastVariant("some", self[key]) if key in self else EastVariant("none", east_null)

    def insert(self, key: Any, value: Any) -> None:
        """Set ``key`` to ``value`` in place (east-c DictInsert).

        Args:
            key: The key to write, ordered under East's total ordering.
            value: The value to store, replacing any existing value.
        """
        self[key] = value

    def get_or_insert(self, key: Any, fn: Any) -> Any:
        """Fetch the value at ``key``, computing and inserting one if absent (east-c DictGetOrInsert).

        Args:
            key: The key to look up, ordered under East's total ordering.
            fn: Called as ``fn(key) -> value`` only when ``key`` is missing;
                its result is inserted before being returned.

        Returns:
            The existing value, or the newly inserted ``fn(key)``.
        """
        if key not in self:
            self[key] = fn(key)
        return self[key]

    def insert_or_update(self, key: Any, value: Any, combine: Any) -> None:
        """Insert ``value`` at ``key`` or combine it with the existing one, in place (east-c DictInsertOrUpdate).

        Args:
            key: The key to write, ordered under East's total ordering.
            value: The incoming value used when ``key`` is absent.
            combine: Called as ``combine(existing, incoming, key) -> value``
                when ``key`` already has a value; its result is stored.
        """
        self[key] = value if key not in self else combine(self[key], value, key)

    def update(self, key: Any, fn: Any) -> None:
        """Replace the value at ``key`` with ``fn(current)``, in place (east-c DictUpdate).

        Args:
            key: The key whose value is transformed; must already be present.
            fn: Called as ``fn(current) -> new value``.
        """
        self[key] = fn(self[key])

    def swap(self, key: Any, value: Any) -> Any:
        """Set ``key`` to ``value`` and return the previous value, in place (east-c DictSwap).

        Args:
            key: The key to overwrite; must already be present.
            value: The new value to store.

        Returns:
            The value previously stored at ``key``.
        """
        old = self[key]
        self[key] = value
        return old

    def delete(self, key: Any) -> None:
        """Remove ``key`` in place (east-c DictDelete).

        Args:
            key: The key to remove; must be present.
        """
        del self[key]

    def try_delete(self, key: Any) -> bool:
        """Remove ``key`` if present, in place (east-c DictTryDelete).

        Args:
            key: The key to remove.

        Returns:
            True if ``key`` was present and removed, else False.
        """
        if key in self:
            del self[key]
            return True
        return False

    def merge(self, other: EastDict, combine: Any = None) -> EastDict:
        """New dict merging ``other`` into a copy of this one (east-c DictCopy + DictUnionInPlace).

        Args:
            other: The dict whose entries are merged in. Its key/value types
                must match this dict's.
            combine: For a key present in both, called as
                ``combine(existing, incoming) -> value`` to pick the result.
                When omitted, the incoming value from ``other`` wins.

        Returns:
            A new dict; this dict and ``other`` are unchanged.
        """
        from east.types.types import DictType, NullType

        result = _call_builtin("DictCopy", [self.key_type, self.value_type], [self], DictType(self.key_type, self.value_type))
        callback = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2)),
            [self.value_type, self.value_type, self.key_type],
            self.value_type,
        )
        _call_builtin("DictUnionInPlace", [self.key_type, self.value_type], [result, other, callback], NullType)
        return result

    def copy(self) -> EastDict:
        """A shallow copy of this dict (east-c DictCopy).

        Returns:
            A new dict with the same entries; mutating it does not affect
            the original.
        """
        from east.types.types import DictType

        return _call_builtin("DictCopy", [self.key_type, self.value_type], [self], DictType(self.key_type, self.value_type))

    def keys_set(self) -> EastSet:
        """The set of keys (east-c DictKeys).

        Returns:
            A set of the keys, ordered under East's total ordering.
        """
        from east.types.types import SetType

        return _call_builtin("DictKeys", [self.key_type, self.value_type], [self], SetType(self.key_type))

    def get_keys(self, keys: EastSet, fill: Any) -> EastDict:
        """Restrict to a given set of keys, filling in any that are missing (east-c DictGetKeys).

        Args:
            keys: The set of keys the result is restricted to.
            fill: Called as ``fill(key) -> value`` for each requested key not
                present in this dict.

        Returns:
            A new dict keyed exactly by ``keys``: existing values where
            present, ``fill(key)`` otherwise.
        """
        from east.types.types import DictType

        callback = EastFunction(fill, [self.key_type], self.value_type)
        return _call_builtin("DictGetKeys", [self.key_type, self.value_type], [self, keys, callback], DictType(self.key_type, self.value_type))

    def for_each(self, fn: Any) -> None:
        """Call ``fn`` for each entry in key order (east-c DictForEach).

        Args:
            fn: Called as ``fn(key, value)`` once per entry, in ascending
                key order under East's total ordering. Its return value is
                ignored.
        """
        from east.types.types import NullType

        callback = EastFunction(lambda v, k: (fn(k, v), east_null)[1], [self.value_type, self.key_type], NullType)
        _call_builtin("DictForEach", [self.key_type, self.value_type, NullType], [self, callback], NullType)

    def map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Transform each value, keeping keys, returning a new dict (east-c DictMap).

        Args:
            fn: Called as ``fn(value) -> new value`` for each entry; the key
                is not passed.
            out: Optional East type pinning the result value type. When
                omitted it is inferred by sampling ``fn`` on the first value.

        Returns:
            A new dict with the same keys and mapped values. Empty input
            yields an empty dict with value type ``out`` (or the original).
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.key_type, out if out is not None else self.value_type)
        first_key = next(iter(self))
        v2 = out if out is not None else type_of(fn(self[first_key]))
        callback = EastFunction(lambda v, k: fn(v), [self.value_type, self.key_type], v2)
        return _call_builtin("DictMap", [self.key_type, self.value_type, v2], [self, callback], DictType(self.key_type, v2))

    def filter(self, predicate: Any) -> EastDict:
        """Keep only entries the predicate accepts, returning a new dict (east-c DictFilter).

        Args:
            predicate: Called as ``predicate(key, value) -> bool``; entries
                for which it is falsy are dropped.

        Returns:
            A new dict containing the retained entries in key order.
        """
        from east.types.types import BooleanType, DictType

        callback = EastFunction(lambda v, k: bool(predicate(k, v)), [self.value_type, self.key_type], BooleanType)
        return _call_builtin("DictFilter", [self.key_type, self.value_type], [self, callback], DictType(self.key_type, self.value_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Filter and remap values in one pass, returning a new dict (east-c DictFilterMap).

        Args:
            fn: Called as ``fn(key, value) -> some(value) | none``; ``none``
                entries are dropped, ``some`` values are kept under the same
                key.
            out: Optional East type pinning the result value type. When
                omitted it is inferred from the first ``some`` sample,
                falling back to the original value type.

        Returns:
            A new dict of the surviving, remapped entries. Empty input yields
            an empty dict.
        """
        from east.types.types import DictType, OptionType

        if len(self) == 0:
            return EastDict(self.key_type, out if out is not None else self.value_type)
        if out is not None:
            v2 = out
        else:
            v2 = next(
                (type_of(r.value) for k in self if (r := fn(k, self[k])).type == "some"),
                self.value_type,
            )
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], OptionType(v2))
        return _call_builtin("DictFilterMap", [self.key_type, self.value_type, v2], [self, callback], DictType(self.key_type, v2))

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First non-empty result of mapping entries in key order (east-c DictFirstMap).

        Args:
            fn: Called as ``fn(key, value) -> some(result) | none`` for
                entries in ascending key order until one returns ``some``.
            out: Optional East type pinning the result type. When omitted it
                is inferred from the first ``some`` sample, falling back to
                the value type.

        Returns:
            ``some(result)`` for the first entry that produced one, else
            ``none`` (also ``none`` for an empty dict).
        """
        from east.types.types import OptionType

        if len(self) == 0:
            return EastVariant("none", east_null)
        if out is not None:
            t2 = out
        else:
            t2 = next(
                (type_of(r.value) for k in self if (r := fn(k, self[k])).type == "some"),
                self.value_type,
            )
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], OptionType(t2))
        return _call_builtin("DictFirstMap", [self.key_type, self.value_type, t2], [self, callback], OptionType(t2))

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Any:
        """Map each entry then combine the results pairwise (east-c DictMapReduce).

        Args:
            map_fn: Called as ``map_fn(key, value) -> T2`` to project each
                entry.
            reduce_fn: Called as ``reduce_fn(a, b) -> T2`` to fold the
                projections together.
            out: Optional East type pinning ``T2``. When omitted it is
                inferred by sampling ``map_fn`` on the first entry.

        Returns:
            The single combined ``T2`` value.

        Raises:
            ValueError: If the dict is empty (the reduction has no identity).
        """
        if len(self) == 0:
            raise ValueError("map_reduce on an empty Dict")
        first_key = next(iter(self))
        t2 = out if out is not None else type_of(map_fn(first_key, self[first_key]))
        map_cb = EastFunction(lambda v, k: map_fn(k, v), [self.value_type, self.key_type], t2)
        reduce_cb = EastFunction(reduce_fn, [t2, t2], t2)
        return _call_builtin("DictMapReduce", [self.key_type, self.value_type, t2], [self, map_cb, reduce_cb], t2)

    def reduce(self, initial: Any, fn: Any) -> Any:
        """Fold an accumulator over entries in key order (east-c DictReduce).

        Args:
            initial: The seed accumulator; its type pins the accumulator and
                result type.
            fn: Called as ``fn(acc, key, value) -> acc`` for each entry in
                ascending key order.

        Returns:
            The final accumulator (``initial`` if the dict is empty).
        """
        t2 = type_of(initial)
        callback = EastFunction(lambda acc, v, k: fn(acc, k, v), [t2, self.value_type, self.key_type], t2)
        return _call_builtin("DictReduce", [self.key_type, self.value_type, t2], [self, callback, initial], t2)

    def to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Project each entry to an array element in key order (east-c DictToArray).

        Args:
            fn: Called as ``fn(key, value) -> element`` for each entry.
            out: Optional East type pinning the element type. When omitted it
                is inferred by sampling ``fn`` on the first entry.

        Returns:
            A new array, one element per entry, in ascending key order.
            Empty input yields an empty array.
        """
        from east.types.types import ArrayType, NullType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        first_key = next(iter(self))
        t2 = out if out is not None else type_of(fn(first_key, self[first_key]))
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], t2)
        return _call_builtin("DictToArray", [self.key_type, self.value_type, t2], [self, callback], ArrayType(t2))

    def to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Collect a projection of each entry into a set (east-c DictToSet).

        Args:
            fn: Called as ``fn(key, value) -> element`` for each entry;
                duplicate results collapse.
            out: Optional East type pinning the element type. When omitted it
                is inferred by sampling ``fn`` on the first entry.

        Returns:
            The set of distinct ``fn`` results, ordered under East's total
            ordering. Empty input yields an empty set.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.key_type)
        first_key = next(iter(self))
        k2 = out if out is not None else type_of(fn(first_key, self[first_key]))
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], k2)
        return _call_builtin("DictToSet", [self.key_type, self.value_type, k2], [self, callback], SetType(k2))

    def to_dict(self, key_fn: Any, value_fn: Any, combine: Any, key_out: EastType | None = None, value_out: EastType | None = None) -> EastDict:
        """Re-key and re-value into a new dict, combining collisions (east-c DictToDict).

        Args:
            key_fn: Called as ``key_fn(key, value) -> new key`` to build each
                new entry's key.
            value_fn: Called as ``value_fn(key, value) -> new value`` to
                build each new entry's value.
            combine: Called as ``combine(existing, incoming, new_key) ->
                value`` when two source entries map to the same new key.
            key_out: Optional East type pinning the new key type; inferred
                from a first-entry sample when omitted.
            value_out: Optional East type pinning the new value type;
                inferred from a first-entry sample when omitted.

        Returns:
            A new dict keyed by ``key_fn`` with values from ``value_fn``.
            Empty input yields an empty dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(
                key_out if key_out is not None else self.key_type,
                value_out if value_out is not None else self.value_type,
            )
        first_key = next(iter(self))
        k2 = key_out if key_out is not None else type_of(key_fn(first_key, self[first_key]))
        v2 = value_out if value_out is not None else type_of(value_fn(first_key, self[first_key]))
        key_cb = EastFunction(lambda v, k: key_fn(k, v), [self.value_type, self.key_type], k2)
        value_cb = EastFunction(lambda v, k: value_fn(k, v), [self.value_type, self.key_type], v2)
        combine_cb = EastFunction(combine, [v2, v2, k2], v2)
        return _call_builtin("DictToDict", [self.key_type, self.value_type, k2, v2], [self, key_cb, value_cb, combine_cb], DictType(k2, v2))

    def flatten_to_array(self, fn: Any) -> EastArray:
        """Concatenate per-entry arrays into one array (east-c DictFlattenToArray).

        Args:
            fn: Called as ``fn(key, value) -> array`` for each entry; the
                resulting arrays are concatenated in key order. The element
                type is taken from the first entry's sample array.

        Returns:
            A single array of all elements. Empty input yields an empty
            array.
        """
        from east.types.types import ArrayType, NullType

        if len(self) == 0:
            return EastArray(NullType, [])
        first_key = next(iter(self))
        sample = fn(first_key, self[first_key])
        t2 = sample.element_type
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], ArrayType(t2))
        return _call_builtin("DictFlattenToArray", [self.key_type, self.value_type, t2], [self, callback], ArrayType(t2))

    def flatten_to_set(self, fn: Any) -> EastSet:
        """Union per-entry sets into one set (east-c DictFlattenToSet).

        Args:
            fn: Called as ``fn(key, value) -> set`` for each entry; the
                results are unioned. The element type is taken from the first
                entry's sample set.

        Returns:
            The union set of distinct elements, ordered under East's total
            ordering. Empty input yields an empty set.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(self.key_type)
        first_key = next(iter(self))
        sample = fn(first_key, self[first_key])
        k2 = sample.element_type
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], SetType(k2))
        return _call_builtin("DictFlattenToSet", [self.key_type, self.value_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any) -> EastDict:
        """Merge per-entry dicts into one dict, resolving collisions (east-c DictFlattenToDict).

        Args:
            fn: Called as ``fn(key, value) -> dict`` for each entry; the
                results are merged. The key/value types are taken from the
                first entry's sample dict.
            combine: Called as ``combine(existing, incoming, key) -> value``
                when a key appears in more than one of the produced dicts.

        Returns:
            The merged dict. Empty input yields an empty dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.key_type, self.value_type)
        first_key = next(iter(self))
        sample = fn(first_key, self[first_key])
        k2, v2 = sample.key_type, sample.value_type
        map_cb = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], DictType(k2, v2))
        combine_cb = EastFunction(combine, [v2, v2, k2], v2)
        return _call_builtin("DictFlattenToDict", [self.key_type, self.value_type, k2, v2], [self, map_cb, combine_cb], DictType(k2, v2))

    def group_fold(self, key_fn: Any, init_fn: Any, fold_fn: Any, key_out: EastType | None = None, acc_out: EastType | None = None) -> EastDict:
        """Group entries by a derived key and fold each group (east-c DictGroupFold).

        Args:
            key_fn: Called as ``key_fn(key, value) -> group key`` to assign
                each entry to a group.
            init_fn: Called as ``init_fn(group_key) -> acc`` to seed each
                group's accumulator the first time the group is seen.
            fold_fn: Called as ``fold_fn(acc, key, value) -> acc`` to fold
                each entry into its group's accumulator.
            key_out: Optional East type pinning the group key type; inferred
                from a first-entry sample when omitted.
            acc_out: Optional East type pinning the accumulator type;
                inferred from a first-entry sample when omitted.

        Returns:
            A new dict from group key to its folded accumulator. Empty input
            yields an empty dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(
                key_out if key_out is not None else self.key_type,
                acc_out if acc_out is not None else self.value_type,
            )
        first_key = next(iter(self))
        k2 = key_out if key_out is not None else type_of(key_fn(first_key, self[first_key]))
        t2 = acc_out if acc_out is not None else type_of(init_fn(key_fn(first_key, self[first_key])))
        key_cb = EastFunction(lambda v, k: key_fn(k, v), [self.value_type, self.key_type], k2)
        init_cb = EastFunction(init_fn, [k2], t2)
        fold_cb = EastFunction(lambda acc, v, k: fold_fn(acc, k, v), [t2, self.value_type, self.key_type], t2)
        return _call_builtin("DictGroupFold", [self.key_type, self.value_type, k2, t2], [self, key_cb, init_cb, fold_cb], DictType(k2, t2))

    @classmethod
    def generate(
        cls,
        n: int,
        key_fn: Any,
        value_fn: Any,
        combine: Any,
        key_type: EastType,
        value_type: EastType,
    ) -> EastDict:
        """Build a dict of ``n`` entries from index functions (east-c DictGenerate).

        Args:
            n: The number of indices ``0..n-1`` to generate from.
            key_fn: Called as ``key_fn(i) -> key`` for each index.
            value_fn: Called as ``value_fn(i) -> value`` for each index.
            combine: Called as ``combine(existing, incoming, key) -> value``
                when two indices produce the same key.
            key_type: The East type of generated keys.
            value_type: The East type of generated values.

        Returns:
            A new dict of the generated entries, ordered under East's total
            ordering on keys.
        """
        from east.types.types import DictType, IntegerType

        key_cb = EastFunction(key_fn, [IntegerType], key_type)
        value_cb = EastFunction(value_fn, [IntegerType], value_type)
        combine_cb = EastFunction(combine, [value_type, value_type, key_type], value_type)
        return _call_builtin(
            "DictGenerate",
            [key_type, value_type],
            [int(n), key_cb, value_cb, combine_cb],
            DictType(key_type, value_type),
        )

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

        t = type_of(self.value)
        t2 = type_of(patch)
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

    # Handle Vector type — logical element must match and the backing buffer's
    # storage dtype must be valid for that element (a Float vector backed by an
    # int buffer, or a Vector<Integer> matched against Vector<Float>, both fail).
    if typ["type"] == "Vector":
        return (
            isinstance(value, EastVector)
            and value.element_type.type == typ["value"]["type"]
            and dtype_matches_element(value.data.dtype, value.element_type)
        )

    # Handle Matrix type
    if typ["type"] == "Matrix":
        return (
            isinstance(value, EastMatrix)
            and value.element_type.type == typ["value"]["type"]
            and dtype_matches_element(value.data.dtype, value.element_type)
        )

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

    # Handle Struct type — fields are matched by NAME, not position (the C
    # bridge marshals structs by name, so the validator must too).
    if typ["type"] == "Struct":
        if not is_east_struct(value):
            return False
        type_fields = typ["value"]
        if len(value) != len(type_fields):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for field_def in type_fields:
                field_name = field_def["name"]
                if field_name not in value:
                    return False
                if not is_value_of(value[field_name], field_def["type"], type_ctx, nodes_visited):
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


def type_of(value: EastValue, nodes_visited: set[int] | None = None) -> EastType:
    """Infer the East type of a Python value.

    For a variant, the inferred type is a single-case ``VariantType`` — variant
    inference is lossy by nature (the other cases are unknowable from one value).

    Args:
        value: Python value
        nodes_visited: Internal parameter for reference-cycle detection

    Returns:
        East type

    Raises:
        TypeError: If the value's type cannot be inferred (including cyclic refs)
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
        MatrixType,
        NullType,
        RefType,
        SetType,
        StringType,
        StructType,
        VariantType,
        VectorType,
    )

    # --- leaf / non-recursing values ---
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
    if isinstance(value, (bytes, bytearray)):
        return BlobType
    if isinstance(value, datetime):
        return DateTimeType
    if isinstance(value, EastVector):
        return VectorType(value.element_type)
    if isinstance(value, EastMatrix):
        return MatrixType(value.element_type)
    if isinstance(value, EastArray):
        return ArrayType(value.element_type)
    if isinstance(value, EastSet):
        return SetType(value.element_type)
    if isinstance(value, EastDict):
        return DictType(value.key_type, value.value_type)

    # --- recursing / structural values: guard against reference cycles ---
    if nodes_visited is None:
        nodes_visited = set()
    value_id = id(value)
    if value_id in nodes_visited:
        raise TypeError("Cannot infer the type of a cyclic value")
    nodes_visited.add(value_id)
    try:
        if isinstance(value, EastRef):
            # EastRef carries no type at runtime — infer from the contained value
            return RefType(type_of(value.value, nodes_visited))
        if is_east_variant(value):
            return VariantType([(value.type, type_of(value.value, nodes_visited))])
        if isinstance(value, EastStruct):
            return StructType([(key, type_of(val, nodes_visited)) for key, val in value.items()])
        if isinstance(value, dict):
            # Backward compat for plain dicts treated as structs
            return StructType([(key, type_of(val, nodes_visited)) for key, val in value.items()])
        if callable(value):
            raise TypeError(f"Cannot infer type of callable {value}")
        raise TypeError(f"Cannot infer type of {type(value).__name__}")
    finally:
        nodes_visited.discard(value_id)


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
    "dtype_matches_element",
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
