#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Numeric buffer value types backed by numpy: EastVector, EastMatrix."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
import numpy.typing as npt

from east.types.values._helpers import (
    EAST_ELEMENT_TO_DTYPE,
    _call_builtin,
    _deprecated_alias,
    _fn_init,
    dtype_matches_element,
)
from east.types.values.collections import (
    EastArray,
    EastFunction,
    _acc_idx_cb,
    _check_kernel_out,
    _elem_in,
    _idx_cb,
    _is_traced,
    _kernel_out_type,
    _lift_traced,
)

if TYPE_CHECKING:
    import torch

    from east.types.types import EastType


def _infer_element_type(dtype: np.dtype) -> EastType:
    """Infer the logical East element type from a numpy dtype's kind.

    float kinds map to Float, signed/unsigned integers to Integer, and bool to
    Boolean. The physical width (e.g. float32) is preserved separately as the
    tensor's storage dtype.
    """
    from east.types.types import BooleanType, FloatType, IntegerType

    if dtype.kind == "f":
        return FloatType
    if dtype.kind in ("i", "u"):
        return IntegerType
    if dtype.kind == "b":
        return BooleanType
    raise TypeError(f"cannot infer an East element type from numpy dtype {dtype!r}")


class EastVector:
    """East vector - contiguous 1D numeric array backed by NumPy.

    Represents a 1D array of Float, Integer, or Boolean values stored in a
    contiguous NumPy array for zero-copy interop with ML libraries.
    """

    __slots__ = ("_data", "element_type")

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
            self._data = np.ascontiguousarray(arr)
        else:
            self._data = np.zeros(length, dtype=EAST_ELEMENT_TO_DTYPE[element_type.type])

    @property
    def dtype(self) -> np.dtype:
        """Runtime storage dtype of the backing NumPy buffer."""
        return self._data.dtype

    # ----- NumPy / torch interop -----------------------------------------
    #
    # The backing buffer is exposed only through these accessors so the
    # immutable vector cannot be mutated through an aliased array: the no-copy
    # path returns a read-only view; any cast or explicit copy is writeable.

    def to_numpy(self, dtype: npt.DTypeLike | None = None, copy: bool = False) -> npt.NDArray[Any]:
        """Return the backing buffer as a NumPy array.

        Args:
            dtype: Optional NumPy dtype to cast to (forces a writeable copy).
            copy: If True, return a writeable copy even when no cast is needed.

        Returns:
            A 1-D array: a read-only view of the backing buffer by default, or a
            writeable copy when ``dtype`` differs or ``copy`` is True.
        """
        if dtype is not None and np.dtype(dtype) != self._data.dtype:
            return self._data.astype(dtype, copy=True)
        if copy:
            return self._data.copy()
        view = self._data.view()
        view.flags.writeable = False
        return view

    def to_torch(self, dtype: npt.DTypeLike | None = None) -> torch.Tensor:
        """Return the vector as a 1-D ``torch.Tensor`` (a writeable copy).

        Args:
            dtype: Optional NumPy dtype to cast to before conversion.

        Returns:
            A ``torch.Tensor`` that shares no memory with this vector.
        """
        import torch

        return torch.from_numpy(self.to_numpy(dtype=dtype, copy=True))

    def __array__(
        self, dtype: npt.DTypeLike | None = None, copy: bool | None = None
    ) -> npt.NDArray[Any]:
        """NumPy array protocol so ``np.asarray(vector)`` returns the buffer."""
        if copy is False and dtype is not None and np.dtype(dtype) != self._data.dtype:
            raise ValueError("cannot return a no-copy view with a different dtype")
        return self.to_numpy(dtype=dtype, copy=bool(copy))

    @classmethod
    def from_numpy(cls, array: npt.ArrayLike, element_type: EastType | None = None) -> EastVector:
        """Build a vector from a NumPy array, preserving its storage dtype.

        The logical element type is inferred from the array's dtype
        (float→Float, int→Integer, bool→Boolean) unless ``element_type`` is given.
        """
        arr = np.asarray(array)
        return cls(element_type if element_type is not None else _infer_element_type(arr.dtype), arr)

    @classmethod
    def from_torch(cls, tensor: torch.Tensor, element_type: EastType | None = None) -> EastVector:
        """Build a vector from a 1-D ``torch.Tensor`` (copied to host memory).

        The element type is inferred from the tensor's dtype unless given.
        """
        arr = np.asarray(tensor.detach().cpu().numpy())
        return cls(element_type if element_type is not None else _infer_element_type(arr.dtype), arr)

    def __len__(self) -> int:
        """Return number of elements."""
        return len(self._data)

    def __repr__(self) -> str:
        """Return representation."""
        return f"EastVector({self.element_type.type}, len={len(self._data)})"

    def __eq__(self, other: object) -> bool:
        """Structural equality."""
        if not isinstance(other, EastVector):
            return NotImplemented
        return (
            self.element_type.type == other.element_type.type
            and len(self._data) == len(other._data)
            and np.array_equal(self._data, other._data)
        )

    def __hash__(self) -> int:
        """Not hashable (numpy buffer): use as an East Set/Dict key, which orders by value."""
        raise TypeError(
            "EastVector is not hashable; use it as an East Set/Dict key (ordered by value via compare_for)"
        )

    # ----- Eager value methods --------------------------------------------
    #
    # Vector/Matrix are the numpy boundary: structural ops use numpy on the
    # backing buffer (cheap, no marshalling). The ARITHMETIC methods below
    # delegate to the east-c builtins instead — the cross-runtime contract
    # pins reduction order (left to right) and East's total order, which
    # numpy's reassociating reductions cannot honour. Free-form tensor math
    # beyond that surface still belongs in numpy/torch via
    # to_numpy()/to_torch().

    def length(self) -> int:
        """Number of elements (numpy).

        Returns:
            The length of the backing buffer.
        """
        return len(self._data)

    def _check_index(self, index: int) -> None:
        """The runtime's bounds rule: a negative or past-the-end index is an
        East error (numpy would wrap the negative one)."""
        n = len(self._data)
        if index < 0 or index >= n:
            from east.runtime.errors import EastError

            raise EastError(f"Vector index {index} out of bounds (length {n})", [])

    def get(self, index: int) -> Any:
        """Logical scalar at ``index`` (numpy).

        The stored value is promoted from its storage dtype to the canonical
        Python representation of the logical element type (Float/Integer/Boolean).
        A traced ``index`` (inside a captured body) lifts this vector as
        a constant and the access emits IR, like the eager collections.

        Args:
            index: Zero-based position into the vector.

        Returns:
            The element at ``index`` as a Python scalar.
        """
        if _is_traced(index):
            return _lift_traced(self).get(index)
        self._check_index(index)
        return self._data[index].item()

    def set(self, index: int, value: Any) -> EastVector:
        """Return a new vector with ``value`` at ``index`` (numpy).

        The original vector is unchanged. ``value`` is cast into the backing
        storage dtype, which is preserved. Traced arguments emit IR against
        this vector as a constant.

        Args:
            index: Zero-based position to overwrite.
            value: New value, cast to the storage dtype.

        Returns:
            A new vector with the element at ``index`` replaced.
        """
        if _is_traced(index) or _is_traced(value):
            return _lift_traced(self).set(index, value)
        self._check_index(index)
        new_data = self._data.copy()
        new_data[index] = value
        return EastVector(self.element_type, new_data)

    def slice(self, start: int, end: int) -> EastVector:
        """Sub-vector over the half-open range ``[start, end)`` (numpy).

        Traced bounds emit IR against this vector as a constant.

        Args:
            start: Inclusive start index.
            end: Exclusive end index.

        Returns:
            A new vector holding a contiguous copy of the selected range.
        """
        if _is_traced(start) or _is_traced(end):
            return _lift_traced(self).slice(start, end)
        return EastVector(self.element_type, np.ascontiguousarray(self._data[start:end]))

    def concat(self, other: EastVector) -> EastVector:
        """Concatenate with ``other`` (numpy).

        A traced ``other`` emits IR against this vector as a constant.

        Args:
            other: Vector whose elements follow this vector's.

        Returns:
            A new vector with ``self`` then ``other`` (this vector's element
            type).
        """
        if _is_traced(other):
            return _lift_traced(self).concat(other)
        return EastVector(self.element_type, np.concatenate([self._data, other._data]))

    def to_array(self) -> EastArray:
        """Convert to an EastArray of logical scalars (numpy).

        Returns:
            A new EastArray of the same element type, each entry promoted to its
            Python scalar form (severs the zero-copy buffer link).
        """
        return EastArray(self.element_type, [x.item() for x in self._data])

    def to_matrix(self, rows: int, cols: int) -> EastMatrix:
        """Reshape into a ``rows × cols`` matrix (numpy).

        Reshapes the existing backing buffer (row-major); ``rows * cols`` must
        equal this vector's length. Traced dimensions emit IR against this
        vector as a constant.

        Args:
            rows: Number of rows.
            cols: Number of columns.

        Returns:
            A matrix of the same element type viewing the reshaped buffer.
        """
        if _is_traced(rows) or _is_traced(cols):
            return _lift_traced(self).to_matrix(rows, cols)
        return EastMatrix(self.element_type, self._data.reshape(rows, cols))

    def map(self, fn: Any, out: EastType | None = None) -> EastVector:
        """``fn(element)`` per element into a new Vector (east-c VectorMap; TS
        ``map``). ``fn(element, index)`` is also accepted; the result must be
        Float, Integer or Boolean.

        Args:
            fn: The element body, taking the block first.
            out: Pins the result element type; the callback's captured output
                type when omitted.

        Returns:
            A new vector of the mapped values.
        """
        from east.types.types import IntegerType, VectorType

        _check_kernel_out(fn, out)
        t2 = out if out is not None else _kernel_out_type(fn, _elem_in(fn, self.element_type))
        if t2.type not in EAST_ELEMENT_TO_DTYPE:
            raise TypeError(
                f".map() on a Vector must produce Float, Integer or Boolean elements, got {t2.type}")
        callback = EastFunction(_idx_cb(fn), [self.element_type, IntegerType], t2)
        return _call_builtin("VectorMap", [self.element_type, t2], [self, callback], VectorType(t2))

    def reduce(self, fn: Any, init: Any) -> Any:
        """Left-fold the elements from ``init`` in index order (east-c
        VectorFold; TS ``reduce(fn, init)``).

        Args:
            fn: ``fn(accumulator, element) -> new accumulator``
                (``fn(accumulator, element, index)`` also accepted).
            init: The starting accumulator; its type fixes the result type.

        Returns:
            The final accumulator (``init`` if the vector is empty).
        """
        import east.types.values as _ev
        from east.types.types import IntegerType

        fn, init = _fn_init("reduce", fn, init)
        t2 = _ev.type_of(init)
        callback = EastFunction(_acc_idx_cb(fn), [t2, self.element_type, IntegerType], t2)
        return _call_builtin("VectorFold", [self.element_type, t2], [self, init, callback], t2)

    def fold(self, initial: Any, fn: Any) -> Any:
        """Deprecated alias of :meth:`reduce` (the TypeScript name and
        argument order, ``reduce(fn, init)``)."""
        import warnings

        warnings.warn(
            ".fold(init, fn) is deprecated: the spelling is .reduce(fn, init) "
            "(the TypeScript name and order)",
            DeprecationWarning, stacklevel=2,
        )
        return self.reduce(fn, initial)

    # ----- Elementwise arithmetic + reductions (east-c) --------------------

    def _vt(self) -> Any:
        from east.types.types import VectorType

        return VectorType(self.element_type)

    def scale(self, alpha: Any) -> EastVector:
        """Multiply every element by a scalar (east-c VectorScale).

        Args:
            alpha: The scalar factor, of the element type.

        Returns:
            A new vector with every element scaled by ``alpha``.
        """
        return _call_builtin("VectorScale", [self.element_type], [self, alpha], self._vt())

    def sum(self) -> Any:
        """Sum the elements in index order, left to right (east-c VectorSum).

        The accumulation order is part of the cross-runtime contract: a
        reassociated float sum gives a different last bit. An empty vector
        sums to zero.

        Returns:
            The sum, as a scalar of the element type.
        """
        return _call_builtin("VectorSum", [self.element_type], [self], self.element_type)

    def add_scaled(self, other: EastVector, alpha: Any) -> EastVector:
        """Add a scaled vector elementwise, ``self + alpha * other`` (east-c VectorAddScaled).

        Args:
            other: The vector to scale and add (same length and element type).
            alpha: The scalar factor applied to ``other``.

        Returns:
            A new vector of the combined elements.

        Raises:
            EastError: If the vector lengths differ.
        """
        return _call_builtin(
            "VectorAddScaled", [self.element_type], [self, other, alpha], self._vt()
        )

    def mul(self, other: EastVector) -> EastVector:
        """Multiply two vectors elementwise (east-c VectorMul).

        Args:
            other: The vector to multiply with (same length and element type).

        Returns:
            A new vector of the elementwise products.

        Raises:
            EastError: If the vector lengths differ.
        """
        return _call_builtin("VectorMul", [self.element_type], [self, other], self._vt())

    def add_scalar(self, value: Any) -> EastVector:
        """Add a scalar to every element (east-c VectorAddScalar).

        Args:
            value: The scalar addend, of the element type.

        Returns:
            A new vector with ``value`` added to every element.
        """
        return _call_builtin("VectorAddScalar", [self.element_type], [self, value], self._vt())

    def dot(self, other: EastVector) -> Any:
        """Dot product, accumulating in index order (east-c VectorDot).

        Args:
            other: The vector to multiply with (same length and element type).

        Returns:
            The dot product, as a scalar of the element type.

        Raises:
            EastError: If the vector lengths differ.
        """
        return _call_builtin("VectorDot", [self.element_type], [self, other], self.element_type)

    def max(self) -> Any:
        """The largest element under East's total order (east-c VectorMax; TS
        ``max``).

        NaN is greatest; ties keep the earliest occurrence.

        Returns:
            The maximum element.

        Raises:
            EastError: If the vector is empty.
        """
        return _call_builtin("VectorMax", [self.element_type], [self], self.element_type)

    def min(self) -> Any:
        """The smallest element under East's total order (east-c VectorMin; TS
        ``min``).

        Ties keep the earliest occurrence.

        Returns:
            The minimum element.

        Raises:
            EastError: If the vector is empty.
        """
        return _call_builtin("VectorMin", [self.element_type], [self], self.element_type)

    maximum = _deprecated_alias("maximum", "max")
    minimum = _deprecated_alias("minimum", "min")

    def arg_max(self) -> int:
        """The index of the largest element under East's total order (east-c VectorArgMax).

        Returns:
            The zero-based index of the maximum; ties keep the earliest.

        Raises:
            EastError: If the vector is empty.
        """
        from east.types.types import IntegerType
        return _call_builtin("VectorArgMax", [self.element_type], [self], IntegerType)

    def arg_min(self) -> int:
        """The index of the smallest element under East's total order (east-c VectorArgMin).

        Returns:
            The zero-based index of the minimum; ties keep the earliest.

        Raises:
            EastError: If the vector is empty.
        """
        from east.types.types import IntegerType
        return _call_builtin("VectorArgMin", [self.element_type], [self], IntegerType)

    def mean(self) -> float:
        """The arithmetic mean as a Float, accumulating in index order (east-c VectorMean).

        Integer elements widen per element; an empty vector yields NaN.

        Returns:
            The mean, as a Float.
        """
        from east.types.types import FloatType
        return _call_builtin("VectorMean", [self.element_type], [self], FloatType)

    def cum_sum(self) -> EastVector:
        """The running sum in index order, left to right (east-c VectorCumSum).

        Returns:
            A new vector where element ``i`` sums elements 0 through ``i``.
        """
        return _call_builtin("VectorCumSum", [self.element_type], [self], self._vt())

    def abs(self) -> EastVector:
        """The absolute value of every element (east-c VectorAbs).

        Returns:
            A new vector with every element replaced by its magnitude.
        """
        return _call_builtin("VectorAbs", [self.element_type], [self], self._vt())

    def clamp(self, lo: Any, hi: Any) -> EastVector:
        """Clamp every element between bounds under East's total order (east-c VectorClamp).

        Args:
            lo: The lower bound, of the element type.
            hi: The upper bound, of the element type.

        Returns:
            A new vector with each element below ``lo`` replaced by ``lo`` and
            each above ``hi`` by ``hi``.
        """
        return _call_builtin("VectorClamp", [self.element_type], [self, lo, hi], self._vt())

    def gather(self, indices: EastVector) -> EastVector:
        """Gather elements at the given indices (east-c VectorGather).

        Args:
            indices: An Integer vector; element ``j`` of the result is
                ``self[indices[j]]``.

        Returns:
            A new vector with one element per index.

        Raises:
            EastError: If any index is out of bounds.
        """
        return _call_builtin("VectorGather", [self.element_type], [self, indices], self._vt())

    def scatter_add(self, indices: EastVector, src: EastVector) -> EastVector:
        """A copy with ``src[j]`` added at ``indices[j]``, in order (east-c VectorScatterAdd).

        Duplicate indices accumulate in input order.

        Args:
            indices: The target index for each source element.
            src: The values to add (same length as ``indices``).

        Returns:
            A new vector with the additions applied.

        Raises:
            EastError: If the index and source lengths differ, or any index is
                out of bounds.
        """
        return _call_builtin(
            "VectorScatterAdd", [self.element_type], [self, indices, src], self._vt()
        )

    def search_sorted(self, needles: EastVector) -> EastVector:
        """The leftmost sorted insertion index per needle (east-c VectorSearchSorted).

        Assumes this vector is sorted under East's total order; the result is
        unspecified otherwise.

        Args:
            needles: The values to locate.

        Returns:
            An Integer vector of one insertion index per needle.
        """
        from east.types.types import IntegerType, VectorType
        return _call_builtin(
            "VectorSearchSorted", [self.element_type], [self, needles], VectorType(IntegerType)
        )

    def _mask_builtin(self, name: str, other: EastVector) -> EastVector:
        from east.types.types import BooleanType, VectorType
        return _call_builtin(name, [self.element_type], [self, other], VectorType(BooleanType))

    def eq(self, other: EastVector) -> EastVector:
        """Elementwise equality under East's equality (east-c VectorEq).

        NaN equals NaN; negative zero differs from positive zero.

        Args:
            other: The vector to compare with (same length and element type).

        Returns:
            A Boolean vector, true where elements are equal.

        Raises:
            EastError: If the vector lengths differ.
        """
        return self._mask_builtin("VectorEq", other)

    def lt(self, other: EastVector) -> EastVector:
        """Elementwise less-than under East's total order (east-c VectorLt).

        Args:
            other: The vector to compare with (same length and element type).

        Returns:
            A Boolean vector, true where this element is less.

        Raises:
            EastError: If the vector lengths differ.
        """
        return self._mask_builtin("VectorLt", other)

    def gt(self, other: EastVector) -> EastVector:
        """Elementwise greater-than under East's total order (east-c VectorGt).

        Args:
            other: The vector to compare with (same length and element type).

        Returns:
            A Boolean vector, true where this element is greater.

        Raises:
            EastError: If the vector lengths differ.
        """
        return self._mask_builtin("VectorGt", other)

    def select(self, a: EastVector, b: EastVector) -> EastVector:
        """Select elementwise from two vectors using this Boolean mask (east-c VectorSelect).

        Args:
            a: The vector supplying elements where this mask is true.
            b: The vector supplying elements where this mask is false.

        Returns:
            A new vector of the selected elements, of ``a``'s element type.

        Raises:
            EastError: If the vector lengths differ.
        """
        from east.types.types import VectorType
        return _call_builtin(
            "VectorSelect", [a.element_type], [self, a, b], VectorType(a.element_type)
        )

    def compress(self, mask: EastVector) -> EastVector:
        """Keep the elements where ``mask`` is true, in order (east-c VectorCompress).

        Args:
            mask: The Boolean vector deciding which elements survive.

        Returns:
            A new vector of the surviving elements.

        Raises:
            EastError: If the mask and vector lengths differ.
        """
        return _call_builtin("VectorCompress", [self.element_type], [mask, self], self._vt())

    def count_true(self) -> int:
        """Count the true elements of this Boolean vector (east-c VectorCountTrue).

        Returns:
            The number of true elements.
        """
        from east.types.types import IntegerType
        return _call_builtin("VectorCountTrue", [], [self], IntegerType)

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

    __slots__ = ("_data", "element_type", "_rows", "_cols")

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
            self._data = np.ascontiguousarray(arr)
            self._rows = self._data.shape[0]
            self._cols = self._data.shape[1]
        else:
            self._data = np.zeros((rows, cols), dtype=EAST_ELEMENT_TO_DTYPE[element_type.type], order="C")
            self._rows = rows
            self._cols = cols

    @property
    def dtype(self) -> np.dtype:
        """Runtime storage dtype of the backing NumPy buffer."""
        return self._data.dtype

    # ----- NumPy / torch interop -----------------------------------------
    #
    # The backing buffer is exposed only through these accessors so the
    # immutable matrix cannot be mutated through an aliased array: the no-copy
    # path returns a read-only view; any cast or explicit copy is writeable.

    def to_numpy(self, dtype: npt.DTypeLike | None = None, copy: bool = False) -> npt.NDArray[Any]:
        """Return the backing buffer as a 2-D NumPy array.

        Args:
            dtype: Optional NumPy dtype to cast to (forces a writeable copy).
            copy: If True, return a writeable copy even when no cast is needed.

        Returns:
            A 2-D row-major array: a read-only view of the backing buffer by
            default, or a writeable copy when ``dtype`` differs or ``copy`` is
            True.
        """
        if dtype is not None and np.dtype(dtype) != self._data.dtype:
            return self._data.astype(dtype, copy=True)
        if copy:
            return self._data.copy()
        view = self._data.view()
        view.flags.writeable = False
        return view

    def to_torch(self, dtype: npt.DTypeLike | None = None) -> torch.Tensor:
        """Return the matrix as a 2-D ``torch.Tensor`` (a writeable copy).

        Args:
            dtype: Optional NumPy dtype to cast to before conversion.

        Returns:
            A ``torch.Tensor`` that shares no memory with this matrix.
        """
        import torch

        return torch.from_numpy(self.to_numpy(dtype=dtype, copy=True))

    def __array__(
        self, dtype: npt.DTypeLike | None = None, copy: bool | None = None
    ) -> npt.NDArray[Any]:
        """NumPy array protocol so ``np.asarray(matrix)`` returns the buffer."""
        if copy is False and dtype is not None and np.dtype(dtype) != self._data.dtype:
            raise ValueError("cannot return a no-copy view with a different dtype")
        return self.to_numpy(dtype=dtype, copy=bool(copy))

    @classmethod
    def from_numpy(cls, array: npt.ArrayLike, element_type: EastType | None = None) -> EastMatrix:
        """Build a matrix from a 2-D NumPy array, preserving its storage dtype.

        The logical element type is inferred from the array's dtype unless given.
        """
        arr = np.asarray(array)
        return cls(element_type if element_type is not None else _infer_element_type(arr.dtype), arr)

    @classmethod
    def from_torch(cls, tensor: torch.Tensor, element_type: EastType | None = None) -> EastMatrix:
        """Build a matrix from a 2-D ``torch.Tensor`` (copied to host memory).

        The element type is inferred from the tensor's dtype unless given.
        """
        arr = np.asarray(tensor.detach().cpu().numpy())
        return cls(element_type if element_type is not None else _infer_element_type(arr.dtype), arr)

    def __repr__(self) -> str:
        """Return representation."""
        return f"EastMatrix({self.element_type.type}, {self._rows}x{self._cols})"

    def __eq__(self, other: object) -> bool:
        """Structural equality."""
        if not isinstance(other, EastMatrix):
            return NotImplemented
        return (
            self.element_type.type == other.element_type.type
            and self._rows == other.rows
            and self._cols == other.cols
            and np.array_equal(self._data, other._data)
        )

    def __hash__(self) -> int:
        """Not hashable (numpy buffer): use as an East Set/Dict key, which orders by value."""
        raise TypeError(
            "EastMatrix is not hashable; use it as an East Set/Dict key (ordered by value via compare_for)"
        )

    # ----- Eager value methods (numpy on the backing buffer) ---------------
    #
    # Matrix is the numpy boundary (same rule as Vector): structural ops use
    # numpy on the backing buffer (cheap, no marshalling); the arithmetic
    # methods delegate to the east-c builtins, whose cross-runtime contract
    # pins reduction order and East's total order.

    def rows(self) -> int:
        """Number of rows (east-c MatrixRows; TS ``rows``).

        Returns:
            The row count of the backing buffer.
        """
        return self._rows

    def cols(self) -> int:
        """Number of columns (east-c MatrixCols; TS ``cols``).

        Returns:
            The column count of the backing buffer.
        """
        return self._cols

    num_rows = _deprecated_alias("num_rows", "rows")
    num_cols = _deprecated_alias("num_cols", "cols")

    def _check_index(self, row: int, col: int) -> None:
        """The runtime's bounds rule for ``(row, col)``: negative or
        past-the-end indices are an East error (numpy would wrap them)."""
        if row < 0 or row >= self._rows or col < 0 or col >= self._cols:
            from east.runtime.errors import EastError

            raise EastError(
                f"Matrix index ({row}, {col}) out of bounds ({self._rows}×{self._cols})", [])

    def get(self, row: int, col: int) -> Any:
        """Logical scalar at ``(row, col)`` (numpy).

        Traced indices (inside a captured body) lift this matrix as a
        constant and the access emits IR, like the eager collections.

        Args:
            row: Zero-based row index.
            col: Zero-based column index.

        Returns:
            The element as a plain Python scalar (storage dtype unwrapped via
            ``.item()``), i.e. a logical value of ``element_type``.
        """
        if _is_traced(row) or _is_traced(col):
            return _lift_traced(self).get(row, col)
        self._check_index(row, col)
        return self._data[row, col].item()

    def set(self, row: int, col: int, value: Any) -> EastMatrix:
        """Return a new matrix with ``value`` at ``(row, col)`` (numpy).

        The original matrix is unchanged. ``value`` is coerced into the backing
        storage dtype (e.g. a Float written into a float32 buffer is rounded),
        which is preserved. Traced arguments emit IR against this matrix as a
        constant.

        Args:
            row: Zero-based row index.
            col: Zero-based column index.
            value: New element value, compatible with ``element_type``.

        Returns:
            A new matrix with the element at ``(row, col)`` replaced.
        """
        if _is_traced(row) or _is_traced(col) or _is_traced(value):
            return _lift_traced(self).set(row, col, value)
        self._check_index(row, col)
        new_data = self._data.copy()
        new_data[row, col] = value
        return EastMatrix(self.element_type, new_data)

    def get_row(self, row: int) -> EastVector:
        """Row ``row`` as a vector (numpy).

        A traced ``row`` emits IR against this matrix as a constant.

        Args:
            row: Zero-based row index.

        Returns:
            A new ``EastVector`` over a contiguous copy of the row (not a view;
            mutating it does not write back into the matrix).
        """
        if _is_traced(row):
            return _lift_traced(self).get_row(row)
        if row < 0 or row >= self._rows:
            from east.runtime.errors import EastError

            raise EastError(f"Matrix row {row} out of bounds ({self._rows} rows)", [])
        return EastVector(self.element_type, np.ascontiguousarray(self._data[row, :]))

    def get_col(self, col: int) -> EastVector:
        """Column ``col`` as a vector (numpy).

        A traced ``col`` emits IR against this matrix as a constant.

        Args:
            col: Zero-based column index.

        Returns:
            A new ``EastVector`` over a contiguous copy of the column (not a
            view; mutating it does not write back into the matrix).
        """
        if _is_traced(col):
            return _lift_traced(self).get_col(col)
        if col < 0 or col >= self._cols:
            from east.runtime.errors import EastError

            raise EastError(f"Matrix column {col} out of bounds ({self._cols} cols)", [])
        return EastVector(self.element_type, np.ascontiguousarray(self._data[:, col]))

    def transpose(self) -> EastMatrix:
        """Transpose (numpy).

        Returns:
            A new ``cols x rows`` matrix; the transposed data is made row-major
            contiguous so the result is a copy, not a view.
        """
        return EastMatrix(self.element_type, np.ascontiguousarray(self._data.T))

    def to_vector(self) -> EastVector:
        """Flatten (row-major) into a vector (numpy).

        Returns:
            A new ``EastVector`` of length ``rows * cols`` with elements in
            row-major (C) order.
        """
        return EastVector(self.element_type, self._data.reshape(-1))

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
            [EastArray(self.element_type, [x.item() for x in self._data[r, :]]) for r in range(self._rows)],
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
            [EastVector(self.element_type, np.ascontiguousarray(self._data[r, :])) for r in range(self._rows)],
        )

    def map_elements(self, fn: Any, out: EastType | None = None) -> EastMatrix:
        """Deprecated (#625): a per-element python loop with no native path.

        Use the east-c arithmetic surface (``scale`` / ``add_scaled`` /
        ``mul_elementwise``), or an explicit python loop over ``to_numpy()``.

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
        import warnings

        warnings.warn(
            "EastMatrix.map_elements is deprecated — a per-element python loop "
            "with no native path: use the tensor arithmetic builtins (scale/"
            "add_scaled/mul_elementwise) or an explicit loop over to_numpy() "
            "(#625)",
            DeprecationWarning, stacklevel=2,
        )
        elem = out if out is not None else self.element_type
        if self._rows == 0 or self._cols == 0:
            return EastMatrix(elem, rows=self._rows, cols=self._cols)
        results = [[fn(self._data[r, c].item()) for c in range(self._cols)] for r in range(self._rows)]
        return EastMatrix(elem, np.asarray(results, dtype=EAST_ELEMENT_TO_DTYPE[elem.type]))

    def map_rows(self, fn: Any, out: EastType | None = None) -> EastMatrix:
        """``fn(row_vector)`` per row into a new Matrix (east-c MatrixMapRows;
        TS ``mapRows``). ``fn(row_vector, row_index)`` is also accepted; every
        returned row Vector must share one width.

        Args:
            fn: The row body, taking the block first and returning a Vector.
            out: Pins the result element type; the element type of the row
                Vector the callback captures when omitted.

        Returns:
            A new ``EastMatrix`` whose rows are the callback results.
        """
        from east.types.types import IntegerType, MatrixType, VectorType

        row_t = VectorType(self.element_type)
        if out is not None:
            _check_kernel_out(fn, VectorType(out))
        out_elem = out if out is not None else _kernel_out_type(fn, _elem_in(fn, row_t)).value
        callback = EastFunction(_idx_cb(fn), [row_t, IntegerType], VectorType(out_elem))
        return _call_builtin(
            "MatrixMapRows", [self.element_type, out_elem], [self, callback], MatrixType(out_elem))

    # ----- Elementwise arithmetic + reductions (east-c) --------------------

    def _mt(self) -> Any:
        from east.types.types import MatrixType

        return MatrixType(self.element_type)

    def scale(self, alpha: Any) -> EastMatrix:
        """Multiply every element by a scalar (east-c MatrixScale).

        Args:
            alpha: The scalar factor, of the element type.

        Returns:
            A new matrix with every element scaled by ``alpha``.
        """
        return _call_builtin("MatrixScale", [self.element_type], [self, alpha], self._mt())

    def add_scaled(self, other: EastMatrix, alpha: Any) -> EastMatrix:
        """Add a scaled matrix elementwise, ``self + alpha * other`` (east-c MatrixAddScaled).

        Args:
            other: The matrix to scale and add (same dimensions and element type).
            alpha: The scalar factor applied to ``other``.

        Returns:
            A new matrix of the combined elements.

        Raises:
            EastError: If the matrix dimensions differ.
        """
        return _call_builtin(
            "MatrixAddScaled", [self.element_type], [self, other, alpha], self._mt()
        )

    def mul_elementwise(self, other: EastMatrix) -> EastMatrix:
        """Multiply two matrices elementwise, the Hadamard product (east-c MatrixMulElementwise).

        Args:
            other: The matrix to multiply with (same dimensions and element type).

        Returns:
            A new matrix of the elementwise products.

        Raises:
            EastError: If the matrix dimensions differ.
        """
        return _call_builtin(
            "MatrixMulElementwise", [self.element_type], [self, other], self._mt()
        )

    def row_sums(self) -> EastVector:
        """Sum each row into a vector of length rows (east-c MatrixRowSums).

        Each row accumulates in ascending column order, left to right — the
        same cross-runtime contract as the Vector reductions.

        Returns:
            A vector holding one sum per row.
        """
        from east.types.types import VectorType
        return _call_builtin(
            "MatrixRowSums", [self.element_type], [self], VectorType(self.element_type)
        )

    def col_sums(self) -> EastVector:
        """Sum each column into a vector of length cols (east-c MatrixColSums).

        Each column accumulates in ascending row order.

        Returns:
            A vector holding one sum per column.
        """
        from east.types.types import VectorType
        return _call_builtin(
            "MatrixColSums", [self.element_type], [self], VectorType(self.element_type)
        )

    def vec_mul(self, vector: EastVector) -> EastVector:
        """Multiply this matrix by a vector (east-c MatrixVecMul).

        Element ``r`` of the result is the dot product of row ``r`` with the
        vector, accumulated in ascending column order.

        Args:
            vector: The vector to multiply by (length must equal cols).

        Returns:
            A vector of length rows.

        Raises:
            EastError: If the vector length does not equal the column count.
        """
        from east.types.types import VectorType
        return _call_builtin(
            "MatrixVecMul", [self.element_type], [self, vector], VectorType(self.element_type)
        )

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
            [r._data if isinstance(r, EastVector) else r for r in rows],
            dtype=EAST_ELEMENT_TO_DTYPE[element_type.type],
        )
        return cls(element_type, data)


# =============================================================================
# EastArray - Ordered collection
# =============================================================================


