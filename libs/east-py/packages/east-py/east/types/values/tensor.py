#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Numeric buffer value types backed by numpy: EastVector, EastMatrix."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

from east.types.values._helpers import (
    EAST_ELEMENT_TO_DTYPE,
    dtype_matches_element,
)
from east.types.values.collections import EastArray

if TYPE_CHECKING:
    from east.types.types import EastType


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


