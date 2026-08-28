#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``MatrixExpression`` — TS ``MatrixExpr`` (``libs/east/src/expr/matrix.ts``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression, _deprecated_alias
from east.expression.lift import _lift, _trace_inner_fn
from east.expression.nodes import _builtin
from east.types.types import ArrayType, EastType, IntegerType, MatrixType, VectorType

if TYPE_CHECKING:
    from east.expression.expr.array import ArrayExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.vector import VectorExpression


class MatrixExpression(Expression):
    """The traced Matrix surface (#598): structural reads, transposition,
    the row/column extractions and the arithmetic builtins — each the SAME
    builtin the eager ``EastMatrix`` twin calls."""

    __slots__ = ()
    _kind = "Matrix"

    def _elem(self) -> EastType:
        return self.east_type.value

    def _numeric(self, op: str) -> EastType:
        t = self.east_type.value
        if t.type not in ("Float", "Integer"):
            raise ExpressionError(
                f".{op}() needs Float or Integer matrix elements, got {t.type}")
        return t

    def _index(self, op: str, value: Any, what: str) -> IntegerExpression:
        i: Any = _lift(value)
        if i.east_type.type != "Integer":
            raise ExpressionError(f".{op}() takes an Integer {what}")
        return i

    # ── structural ──────────────────────────────────────────────────────

    def rows(self) -> IntegerExpression:
        """Traced MatrixRows (TS ``rows``)."""
        return self._expr(_builtin("MatrixRows", IntegerType, [self._elem()], [self.ir]), IntegerType)

    def cols(self) -> IntegerExpression:
        """Traced MatrixCols (TS ``cols``)."""
        return self._expr(_builtin("MatrixCols", IntegerType, [self._elem()], [self.ir]), IntegerType)

    num_rows = _deprecated_alias("num_rows", "rows")
    num_cols = _deprecated_alias("num_cols", "cols")

    def get(self, row: Any, col: Any) -> Expression:
        """Traced MatrixGet (``get(row, col)``)."""
        r = _lift(row)
        c = _lift(col)
        if r.east_type.type != "Integer" or c.east_type.type != "Integer":
            raise ExpressionError("Matrix.get() takes (row, col) Integer indices")
        elem_t = self._elem()
        return self._expr(
            _builtin("MatrixGet", elem_t, [elem_t], [self.ir, r.ir, c.ir]), elem_t)

    def set(self, row: Any, col: Any, value: Any) -> MatrixExpression:
        """Traced functional update — MatrixSet returns a NEW matrix."""
        elem_t = self._elem()
        r = _lift(row)
        c = _lift(col)
        if r.east_type.type != "Integer" or c.east_type.type != "Integer":
            raise ExpressionError("Matrix.set() indices must be Integers")
        v = _lift(value, hint=elem_t)
        if v.east_type != elem_t:
            raise ExpressionError(
                f".set() scalar must be {elem_t.type} (the element type), got {v.east_type.type}")
        return self._expr(
            _builtin("MatrixSet", self.east_type, [elem_t], [self.ir, r.ir, c.ir, v.ir]),
            self.east_type,
        )

    def get_row(self, row: Any) -> VectorExpression:
        """Traced MatrixGetRow: one row as a Vector copy."""
        elem_t = self._elem()
        r = self._index("get_row", row, "row index")
        out_t = VectorType(elem_t)
        return self._expr(_builtin("MatrixGetRow", out_t, [elem_t], [self.ir, r.ir]), out_t)

    def get_col(self, col: Any) -> VectorExpression:
        """Traced MatrixGetCol: one column as a Vector copy."""
        elem_t = self._elem()
        c = self._index("get_col", col, "column index")
        out_t = VectorType(elem_t)
        return self._expr(_builtin("MatrixGetCol", out_t, [elem_t], [self.ir, c.ir]), out_t)

    def transpose(self) -> MatrixExpression:
        """Traced MatrixTranspose."""
        return self._expr(
            _builtin("MatrixTranspose", self.east_type, [self._elem()], [self.ir]),
            self.east_type,
        )

    def to_vector(self) -> VectorExpression:
        """Traced MatrixToVector (row-major flatten)."""
        elem_t = self._elem()
        out_t = VectorType(elem_t)
        return self._expr(_builtin("MatrixToVector", out_t, [elem_t], [self.ir]), out_t)

    def to_array(self) -> ArrayExpression:
        """Traced MatrixToArray: an Array of row Arrays."""
        elem_t = self._elem()
        out_t = ArrayType(ArrayType(elem_t))
        return self._expr(_builtin("MatrixToArray", out_t, [elem_t], [self.ir]), out_t)

    def to_rows(self) -> ArrayExpression:
        """Traced MatrixToRows: an Array of row Vectors."""
        elem_t = self._elem()
        out_t = ArrayType(VectorType(elem_t))
        return self._expr(_builtin("MatrixToRows", out_t, [elem_t], [self.ir]), out_t)

    # ── arithmetic ──────────────────────────────────────────────────────

    def scale(self, alpha: Any) -> MatrixExpression:
        """Traced MatrixScale: every element times ``alpha``."""
        t = self._numeric("scale")
        a = _lift(alpha, hint=t)
        if a.east_type != t:
            raise ExpressionError(
                f".scale() scalar must be {t.type} (the element type), got {a.east_type.type}")
        return self._expr(
            _builtin("MatrixScale", self.east_type, [t], [self.ir, a.ir]), self.east_type)

    def add_scaled(self, other: Any, alpha: Any) -> MatrixExpression:
        """Traced MatrixAddScaled: ``self + alpha * other``."""
        t = self._numeric("add_scaled")
        o = self._same_typed("add_scaled", other)
        a = _lift(alpha, hint=t)
        if a.east_type != t:
            raise ExpressionError(
                f".add_scaled() scalar must be {t.type} (the element type), got {a.east_type.type}")
        return self._expr(
            _builtin("MatrixAddScaled", self.east_type, [t], [self.ir, o.ir, a.ir]),
            self.east_type,
        )

    def mul_elementwise(self, other: Any) -> MatrixExpression:
        """Traced MatrixMulElementwise: the Hadamard product."""
        t = self._numeric("mul_elementwise")
        o = self._same_typed("mul_elementwise", other)
        return self._expr(
            _builtin("MatrixMulElementwise", self.east_type, [t], [self.ir, o.ir]),
            self.east_type,
        )

    def row_sums(self) -> VectorExpression:
        """Traced MatrixRowSums: one left-to-right sum per row."""
        t = self._numeric("row_sums")
        out_t = VectorType(t)
        return self._expr(_builtin("MatrixRowSums", out_t, [t], [self.ir]), out_t)

    def col_sums(self) -> VectorExpression:
        """Traced MatrixColSums: one ascending-row sum per column."""
        t = self._numeric("col_sums")
        out_t = VectorType(t)
        return self._expr(_builtin("MatrixColSums", out_t, [t], [self.ir]), out_t)

    def vec_mul(self, vector: Any) -> VectorExpression:
        """Traced MatrixVecMul: row-by-vector dot products."""
        t = self._numeric("vec_mul")
        v = _lift(vector, hint=VectorType(t))
        if v.east_type != VectorType(t):
            raise ExpressionError(
                f".vec_mul() takes a Vector of the matrix element type, got {v.east_type.type}")
        out_t = VectorType(t)
        return self._expr(_builtin("MatrixVecMul", out_t, [t], [self.ir, v.ir]), out_t)

    def map_rows(self, fn: Any) -> MatrixExpression:
        """Traced MatrixMapRows: ``fn(row_vector, row_index)`` per row,
        producing a new Matrix from the row Vectors it returns (TS ``mapRows``)."""
        elem_t = self._elem()
        node, out_t = _trace_inner_fn(fn, [VectorType(elem_t), IntegerType])
        if out_t.type != "Vector":
            raise ExpressionError(f".map_rows() must produce a row Vector, got {out_t.type}")
        out = MatrixType(out_t.value)
        return self._expr(
            _builtin("MatrixMapRows", out, [elem_t, out_t.value], [self.ir, node]), out)
