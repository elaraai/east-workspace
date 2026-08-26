#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The traced Vector/Matrix surface (#598).

Structural reads plus the elementwise arithmetic, masks, reductions and
gather/scatter builtins — every method emits the SAME builtin its eager
``EastVector``/``EastMatrix`` twin calls, so traced and eager agree bit for
bit, including the left-to-right reduction order. Names that also exist on
another container kind (``length``/``get``/``set``/``slice``/``concat``/
``to_array``/``sum``/``mean``/``maximum``/``minimum``/``abs``) dispatch on the
receiver's kind here — this mixin sits first in ``Expression``'s bases — and
non-tensor receivers delegate to the mixin that owns the name.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import _lift
from east.expression.nodes import _builtin
from east.expression.ops import _ExprBase
from east.expression.ops.collections import _CollectionOps
from east.expression.ops.mutation import _MutationOps
from east.expression.ops.reductions import _ReductionOps
from east.expression.ops.scalar import _ScalarOps
from east.expression.ops.sequence import _SequenceOps
from east.expression.ops.text import _TextOps
from east.expression.ops.transforms import _TransformOps
from east.types.types import (
    ArrayType,
    BooleanType,
    EastType,
    FloatType,
    IntegerType,
    MatrixType,
    VectorType,
)

if TYPE_CHECKING:
    from east.expression.expr import Expression


class _TensorOps(_ExprBase):
    """Traced Vector/Matrix structural ops, arithmetic, masks and reductions."""

    __slots__ = ()

    def _vector_elem(self, op: str) -> EastType:
        if self.east_type.type != "Vector":
            raise ExpressionError(f".{op}() on {self.east_type.type} (needs Vector)")
        return self.east_type.value

    def _vector_numeric(self, op: str) -> EastType:
        t = self._vector_elem(op)
        if t.type not in ("Float", "Integer"):
            raise ExpressionError(
                f".{op}() needs Float or Integer vector elements, got {t.type}")
        return t

    def _matrix_numeric(self, op: str) -> EastType:
        if self.east_type.type != "Matrix":
            raise ExpressionError(f".{op}() on {self.east_type.type} (needs Matrix)")
        t = self.east_type.value
        if t.type not in ("Float", "Integer"):
            raise ExpressionError(
                f".{op}() needs Float or Integer matrix elements, got {t.type}")
        return t

    def _scalar_arg(self, op: str, value: Any, t: EastType) -> Expression:
        v = _lift(value, hint=t)
        if v.east_type != t:
            raise ExpressionError(
                f".{op}() scalar must be {t.type} (the element type), got {v.east_type.type}")
        return v

    def _index_vector(self, op: str, value: Any) -> Expression:
        v = _lift(value, hint=VectorType(IntegerType))
        if v.east_type != VectorType(IntegerType):
            raise ExpressionError(
                f".{op}() indices must be a Vector<Integer>, got {v.east_type.type}")
        return v

    # ── structural: Vector ──────────────────────────────────────────────

    def length(self) -> Expression:
        """Traced VectorLength on a Vector; String length otherwise."""
        if self.east_type.type == "Vector":
            return self._expr(
                _builtin("VectorLength", IntegerType, [self.east_type.value], [self.ir]),
                IntegerType,
            )
        return _TextOps.length(self)

    def get(self, key: Any = None, col: Any = None) -> Expression:
        """Traced VectorGet / MatrixGet (``get(row, col)``); defers other
        receivers to the collection surface."""
        tag = self.east_type.type
        if tag == "Vector":
            if col is not None:
                raise ExpressionError("Vector.get() takes one Integer index")
            i = _lift(key)
            if i.east_type.type != "Integer":
                raise ExpressionError("Vector.get() takes an Integer index")
            elem_t = self.east_type.value
            return self._expr(
                _builtin("VectorGet", elem_t, [elem_t], [self.ir, i.ir]), elem_t)
        if tag == "Matrix":
            if col is None:
                raise ExpressionError("Matrix.get() takes (row, col) Integer indices")
            r = _lift(key)
            c = _lift(col)
            if r.east_type.type != "Integer" or c.east_type.type != "Integer":
                raise ExpressionError("Matrix.get() takes (row, col) Integer indices")
            elem_t = self.east_type.value
            return self._expr(
                _builtin("MatrixGet", elem_t, [elem_t], [self.ir, r.ir, c.ir]), elem_t)
        return _CollectionOps.get(self, key)

    def set(self, *args: Any) -> Expression:
        """Traced functional update — VectorSet ``set(index, value)`` /
        MatrixSet ``set(row, col, value)`` return a NEW vector/matrix; a Ref
        receiver defers to the cell setter."""
        tag = self.east_type.type
        if tag == "Vector":
            if len(args) != 2:
                raise ExpressionError("Vector.set() takes (index, value)")
            elem_t = self.east_type.value
            i = _lift(args[0])
            if i.east_type.type != "Integer":
                raise ExpressionError("Vector.set() index must be an Integer")
            v = self._scalar_arg("set", args[1], elem_t)
            return self._expr(
                _builtin("VectorSet", self.east_type, [elem_t], [self.ir, i.ir, v.ir]),
                self.east_type,
            )
        if tag == "Matrix":
            if len(args) != 3:
                raise ExpressionError("Matrix.set() takes (row, col, value)")
            elem_t = self.east_type.value
            r = _lift(args[0])
            c = _lift(args[1])
            if r.east_type.type != "Integer" or c.east_type.type != "Integer":
                raise ExpressionError("Matrix.set() indices must be Integers")
            v = self._scalar_arg("set", args[2], elem_t)
            return self._expr(
                _builtin("MatrixSet", self.east_type, [elem_t],
                         [self.ir, r.ir, c.ir, v.ir]),
                self.east_type,
            )
        if len(args) != 1:
            raise ExpressionError(f".set() on {tag}")
        return _MutationOps.set(self, args[0])

    def slice(self, start: Any, end: Any) -> Expression:
        """Traced VectorSlice over ``[start, end)``; Array slice otherwise."""
        if self.east_type.type == "Vector":
            s = _lift(start)
            e = _lift(end)
            if s.east_type.type != "Integer" or e.east_type.type != "Integer":
                raise ExpressionError(".slice() bounds must be Integers")
            return self._expr(
                _builtin("VectorSlice", self.east_type, [self.east_type.value],
                         [self.ir, s.ir, e.ir]),
                self.east_type,
            )
        return _SequenceOps.slice(self, start, end)

    def concat(self, other: Any) -> Expression:
        """Traced VectorConcat; Array concat otherwise."""
        if self.east_type.type == "Vector":
            o = self._same_typed("concat", other)
            return self._expr(
                _builtin("VectorConcat", self.east_type, [self.east_type.value],
                         [self.ir, o.ir]),
                self.east_type,
            )
        return _SequenceOps.concat(self, other)

    def to_array(self, fn: Any = None, out: EastType | None = None, *,
                 key: Any = None) -> Expression:
        """Traced VectorToArray / MatrixToArray (no projection); defers other
        receivers to the collection surface."""
        tag = self.east_type.type
        if tag == "Vector":
            if fn is not None or key is not None:
                raise ExpressionError("Vector.to_array() takes no projection")
            elem_t = self.east_type.value
            out_t = ArrayType(elem_t)
            return self._expr(
                _builtin("VectorToArray", out_t, [elem_t], [self.ir]), out_t)
        if tag == "Matrix":
            if fn is not None or key is not None:
                raise ExpressionError("Matrix.to_array() takes no projection")
            elem_t = self.east_type.value
            out_t = ArrayType(ArrayType(elem_t))
            return self._expr(
                _builtin("MatrixToArray", out_t, [elem_t], [self.ir]), out_t)
        return _TransformOps.to_array(self, fn, out, key=key)

    def to_matrix(self, rows: Any, cols: Any) -> Expression:
        """Traced VectorToMatrix: reshape into ``rows x cols`` (row-major)."""
        elem_t = self._vector_elem("to_matrix")
        r = _lift(rows)
        c = _lift(cols)
        if r.east_type.type != "Integer" or c.east_type.type != "Integer":
            raise ExpressionError(".to_matrix() dimensions must be Integers")
        out_t = MatrixType(elem_t)
        return self._expr(
            _builtin("VectorToMatrix", out_t, [elem_t], [self.ir, r.ir, c.ir]), out_t)

    # ── structural: Matrix ──────────────────────────────────────────────

    def _matrix_only(self, op: str) -> EastType:
        if self.east_type.type != "Matrix":
            raise ExpressionError(f".{op}() on {self.east_type.type} (needs Matrix)")
        return self.east_type.value

    def num_rows(self) -> Expression:
        """Traced MatrixRows."""
        elem_t = self._matrix_only("num_rows")
        return self._expr(
            _builtin("MatrixRows", IntegerType, [elem_t], [self.ir]), IntegerType)

    def num_cols(self) -> Expression:
        """Traced MatrixCols."""
        elem_t = self._matrix_only("num_cols")
        return self._expr(
            _builtin("MatrixCols", IntegerType, [elem_t], [self.ir]), IntegerType)

    def get_row(self, row: Any) -> Expression:
        """Traced MatrixGetRow: one row as a Vector copy."""
        elem_t = self._matrix_only("get_row")
        r = _lift(row)
        if r.east_type.type != "Integer":
            raise ExpressionError(".get_row() takes an Integer row index")
        out_t = VectorType(elem_t)
        return self._expr(
            _builtin("MatrixGetRow", out_t, [elem_t], [self.ir, r.ir]), out_t)

    def get_col(self, col: Any) -> Expression:
        """Traced MatrixGetCol: one column as a Vector copy."""
        elem_t = self._matrix_only("get_col")
        c = _lift(col)
        if c.east_type.type != "Integer":
            raise ExpressionError(".get_col() takes an Integer column index")
        out_t = VectorType(elem_t)
        return self._expr(
            _builtin("MatrixGetCol", out_t, [elem_t], [self.ir, c.ir]), out_t)

    def transpose(self) -> Expression:
        """Traced MatrixTranspose."""
        elem_t = self._matrix_only("transpose")
        return self._expr(
            _builtin("MatrixTranspose", self.east_type, [elem_t], [self.ir]),
            self.east_type,
        )

    def to_vector(self) -> Expression:
        """Traced VectorFromArray on an Array of Float/Integer/Boolean
        elements (#601 — the construction seam the sparse builtins need);
        MatrixToVector (row-major flatten) on a Matrix."""
        if self.east_type.type == "Array":
            elem_t = self.east_type.value
            if elem_t.type not in ("Float", "Integer", "Boolean"):
                raise ExpressionError(
                    f".to_vector() needs Float, Integer or Boolean array "
                    f"elements, got {elem_t.type}")
            out_t = VectorType(elem_t)
            return self._expr(
                _builtin("VectorFromArray", out_t, [elem_t], [self.ir]), out_t)
        elem_t = self._matrix_only("to_vector")
        out_t = VectorType(elem_t)
        return self._expr(
            _builtin("MatrixToVector", out_t, [elem_t], [self.ir]), out_t)

    def to_rows(self) -> Expression:
        """Traced MatrixToRows: an Array of row Vectors."""
        elem_t = self._matrix_only("to_rows")
        out_t = ArrayType(VectorType(elem_t))
        return self._expr(
            _builtin("MatrixToRows", out_t, [elem_t], [self.ir]), out_t)

    # ── elementwise arithmetic + reductions ─────────────────────────────

    def scale(self, alpha: Any) -> Expression:
        """Traced VectorScale / MatrixScale: every element times ``alpha``."""
        if self.east_type.type == "Matrix":
            t = self._matrix_numeric("scale")
            a = self._scalar_arg("scale", alpha, t)
            return self._expr(
                _builtin("MatrixScale", self.east_type, [t], [self.ir, a.ir]),
                self.east_type,
            )
        t = self._vector_numeric("scale")
        a = self._scalar_arg("scale", alpha, t)
        return self._expr(
            _builtin("VectorScale", self.east_type, [t], [self.ir, a.ir]),
            self.east_type,
        )

    def sum(self, fn: Any = None) -> Expression:
        """Traced VectorSum (index order, left to right) on a Vector; the
        collection sum otherwise."""
        if self.east_type.type == "Vector":
            if fn is not None:
                raise ExpressionError("Vector.sum() takes no projection")
            t = self._vector_numeric("sum")
            return self._expr(_builtin("VectorSum", t, [t], [self.ir]), t)
        return _ReductionOps.sum(self, fn)

    def add_scaled(self, other: Any, alpha: Any) -> Expression:
        """Traced VectorAddScaled / MatrixAddScaled: ``self + alpha * other``."""
        if self.east_type.type == "Matrix":
            t = self._matrix_numeric("add_scaled")
            o = self._same_typed("add_scaled", other)
            a = self._scalar_arg("add_scaled", alpha, t)
            return self._expr(
                _builtin("MatrixAddScaled", self.east_type, [t], [self.ir, o.ir, a.ir]),
                self.east_type,
            )
        t = self._vector_numeric("add_scaled")
        o = self._same_typed("add_scaled", other)
        a = self._scalar_arg("add_scaled", alpha, t)
        return self._expr(
            _builtin("VectorAddScaled", self.east_type, [t], [self.ir, o.ir, a.ir]),
            self.east_type,
        )

    def mul(self, other: Any) -> Expression:
        """Traced VectorMul: elementwise product."""
        t = self._vector_numeric("mul")
        o = self._same_typed("mul", other)
        return self._expr(
            _builtin("VectorMul", self.east_type, [t], [self.ir, o.ir]), self.east_type)

    def add_scalar(self, value: Any) -> Expression:
        """Traced VectorAddScalar: ``value`` added to every element."""
        t = self._vector_numeric("add_scalar")
        v = self._scalar_arg("add_scalar", value, t)
        return self._expr(
            _builtin("VectorAddScalar", self.east_type, [t], [self.ir, v.ir]),
            self.east_type,
        )

    def dot(self, other: Any) -> Expression:
        """Traced VectorDot, accumulating in index order."""
        t = self._vector_numeric("dot")
        o = self._same_typed("dot", other)
        return self._expr(_builtin("VectorDot", t, [t], [self.ir, o.ir]), t)

    def maximum(self, by: Any = None) -> Expression:
        """Traced VectorMax (East total order, empty errors) on a Vector; the
        Array maximum otherwise."""
        if self.east_type.type == "Vector":
            if by is not None:
                raise ExpressionError("Vector.maximum() takes no projection")
            t = self._vector_numeric("maximum")
            return self._expr(_builtin("VectorMax", t, [t], [self.ir]), t)
        return _ReductionOps.maximum(self, by)

    def minimum(self, by: Any = None) -> Expression:
        """Traced VectorMin on a Vector; the Array minimum otherwise."""
        if self.east_type.type == "Vector":
            if by is not None:
                raise ExpressionError("Vector.minimum() takes no projection")
            t = self._vector_numeric("minimum")
            return self._expr(_builtin("VectorMin", t, [t], [self.ir]), t)
        return _ReductionOps.minimum(self, by)

    def arg_max(self) -> Expression:
        """Traced VectorArgMax: the index of the largest element."""
        t = self._vector_numeric("arg_max")
        return self._expr(_builtin("VectorArgMax", IntegerType, [t], [self.ir]), IntegerType)

    def arg_min(self) -> Expression:
        """Traced VectorArgMin: the index of the smallest element."""
        t = self._vector_numeric("arg_min")
        return self._expr(_builtin("VectorArgMin", IntegerType, [t], [self.ir]), IntegerType)

    def mean(self, fn: Any = None) -> Expression:
        """Traced VectorMean (a Float; NaN when empty) on a Vector; the
        collection mean otherwise."""
        if self.east_type.type == "Vector":
            if fn is not None:
                raise ExpressionError("Vector.mean() takes no projection")
            t = self._vector_numeric("mean")
            return self._expr(_builtin("VectorMean", FloatType, [t], [self.ir]), FloatType)
        return _ReductionOps.mean(self, fn)

    def cum_sum(self) -> Expression:
        """Traced VectorCumSum: the running sum, left to right."""
        t = self._vector_numeric("cum_sum")
        return self._expr(
            _builtin("VectorCumSum", self.east_type, [t], [self.ir]), self.east_type)

    def abs(self) -> Expression:
        """Traced VectorAbs on a Vector; the scalar abs otherwise."""
        if self.east_type.type == "Vector":
            t = self._vector_numeric("abs")
            return self._expr(
                _builtin("VectorAbs", self.east_type, [t], [self.ir]), self.east_type)
        return _ScalarOps.abs(self)

    def clamp(self, lo: Any, hi: Any) -> Expression:
        """Traced VectorClamp under East's total order."""
        t = self._vector_numeric("clamp")
        lo_e = self._scalar_arg("clamp", lo, t)
        hi_e = self._scalar_arg("clamp", hi, t)
        return self._expr(
            _builtin("VectorClamp", self.east_type, [t], [self.ir, lo_e.ir, hi_e.ir]),
            self.east_type,
        )

    # ── gather/scatter and sorted search ────────────────────────────────

    def gather(self, indices: Any) -> Expression:
        """Traced VectorGather: ``result[j] = self[indices[j]]``."""
        self._vector_elem("gather")
        idx = self._index_vector("gather", indices)
        return self._expr(
            _builtin("VectorGather", self.east_type, [self.east_type.value],
                     [self.ir, idx.ir]),
            self.east_type,
        )

    def scatter_add(self, indices: Any, src: Any) -> Expression:
        """Traced VectorScatterAdd: a copy with ``src[j]`` added at
        ``indices[j]``, duplicates accumulating in order."""
        t = self._vector_numeric("scatter_add")
        idx = self._index_vector("scatter_add", indices)
        s = self._same_typed("scatter_add", src)
        return self._expr(
            _builtin("VectorScatterAdd", self.east_type, [t],
                     [self.ir, idx.ir, s.ir]),
            self.east_type,
        )

    def search_sorted(self, needles: Any) -> Expression:
        """Traced VectorSearchSorted: leftmost insertion index per needle."""
        elem_t = self._vector_elem("search_sorted")
        n = self._same_typed("search_sorted", needles)
        out_t = VectorType(IntegerType)
        return self._expr(
            _builtin("VectorSearchSorted", out_t, [elem_t], [self.ir, n.ir]), out_t)

    # ── masks and selection ─────────────────────────────────────────────

    def _mask_compare(self, builtin: str, op: str, other: Any) -> Expression:
        elem_t = self._vector_elem(op)
        o = self._same_typed(op, other)
        out_t = VectorType(BooleanType)
        return self._expr(_builtin(builtin, out_t, [elem_t], [self.ir, o.ir]), out_t)

    def eq(self, other: Any) -> Expression:
        """Traced VectorEq: elementwise East equality as a Boolean mask."""
        return self._mask_compare("VectorEq", "eq", other)

    def lt(self, other: Any) -> Expression:
        """Traced VectorLt: elementwise less-than as a Boolean mask."""
        return self._mask_compare("VectorLt", "lt", other)

    def gt(self, other: Any) -> Expression:
        """Traced VectorGt: elementwise greater-than as a Boolean mask."""
        return self._mask_compare("VectorGt", "gt", other)

    def select(self, a: Any, b: Any) -> Expression:
        """Traced VectorSelect: this Boolean mask picks each element from
        ``a`` (true) or ``b`` (false)."""
        elem_t = self._vector_elem("select")
        if elem_t.type != "Boolean":
            raise ExpressionError(".select() needs a Vector<Boolean> mask receiver")
        a_e = _lift(a)
        if a_e.east_type.type != "Vector":
            raise ExpressionError(".select() arms must be Vectors")
        b_e = _lift(b, hint=a_e.east_type)
        if b_e.east_type != a_e.east_type:
            raise ExpressionError(
                f".select() arms disagree ({a_e.east_type.value.type} vs "
                f"{b_e.east_type.value.type} elements)")
        return self._expr(
            _builtin("VectorSelect", a_e.east_type, [a_e.east_type.value],
                     [self.ir, a_e.ir, b_e.ir]),
            a_e.east_type,
        )

    def compress(self, mask: Any) -> Expression:
        """Traced VectorCompress: keep the elements where ``mask`` is true."""
        elem_t = self._vector_elem("compress")
        m = _lift(mask, hint=VectorType(BooleanType))
        if m.east_type != VectorType(BooleanType):
            raise ExpressionError(
                f".compress() mask must be a Vector<Boolean>, got {m.east_type.type}")
        return self._expr(
            _builtin("VectorCompress", self.east_type, [elem_t], [m.ir, self.ir]),
            self.east_type,
        )

    def count_true(self) -> Expression:
        """Traced VectorCountTrue on a Boolean vector."""
        elem_t = self._vector_elem("count_true")
        if elem_t.type != "Boolean":
            raise ExpressionError(".count_true() needs a Vector<Boolean>")
        return self._expr(
            _builtin("VectorCountTrue", IntegerType, [], [self.ir]), IntegerType)

    # ── Matrix arithmetic ───────────────────────────────────────────────

    def mul_elementwise(self, other: Any) -> Expression:
        """Traced MatrixMulElementwise: the Hadamard product."""
        t = self._matrix_numeric("mul_elementwise")
        o = self._same_typed("mul_elementwise", other)
        return self._expr(
            _builtin("MatrixMulElementwise", self.east_type, [t], [self.ir, o.ir]),
            self.east_type,
        )

    def row_sums(self) -> Expression:
        """Traced MatrixRowSums: one left-to-right sum per row."""
        t = self._matrix_numeric("row_sums")
        out_t = VectorType(t)
        return self._expr(_builtin("MatrixRowSums", out_t, [t], [self.ir]), out_t)

    def col_sums(self) -> Expression:
        """Traced MatrixColSums: one ascending-row sum per column."""
        t = self._matrix_numeric("col_sums")
        out_t = VectorType(t)
        return self._expr(_builtin("MatrixColSums", out_t, [t], [self.ir]), out_t)

    def vec_mul(self, vector: Any) -> Expression:
        """Traced MatrixVecMul: row-by-vector dot products."""
        t = self._matrix_numeric("vec_mul")
        v = _lift(vector, hint=VectorType(t))
        if v.east_type != VectorType(t):
            raise ExpressionError(
                f".vec_mul() takes a Vector of the matrix element type, got {v.east_type.type}")
        out_t = VectorType(t)
        return self._expr(
            _builtin("MatrixVecMul", out_t, [t], [self.ir, v.ir]), out_t)
