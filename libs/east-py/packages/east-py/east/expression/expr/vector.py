#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``VectorExpression`` — TS ``VectorExpr`` (``libs/east/src/expr/vector.ts``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression, _deprecated_alias, _fn_init
from east.expression.lift import _lift, _trace_inner_fn
from east.expression.nodes import _builtin
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
    from east.expression.expr.array import ArrayExpression
    from east.expression.expr.float import FloatExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.matrix import MatrixExpression


class VectorExpression(Expression):
    """The traced Vector surface (#598): structural reads plus the
    elementwise arithmetic, masks, reductions and gather/scatter builtins —
    every method emits the SAME builtin its eager ``EastVector`` twin calls,
    so traced and eager agree bit for bit, including the left-to-right
    reduction order."""

    __slots__ = ()
    _kind = "Vector"

    def _elem(self) -> EastType:
        return self.east_type.value

    def _numeric(self, op: str) -> EastType:
        t = self.east_type.value
        if t.type not in ("Float", "Integer"):
            raise ExpressionError(
                f".{op}() needs Float or Integer vector elements, got {t.type}")
        return t

    def _scalar_arg(self, op: str, value: Any, t: EastType) -> Expression:
        v = _lift(value, hint=t)
        if v.east_type != t:
            raise ExpressionError(
                f".{op}() scalar must be {t.type} (the element type), got {v.east_type.type}")
        return v

    def _index_vector(self, op: str, value: Any) -> VectorExpression:
        v: Any = _lift(value, hint=VectorType(IntegerType))
        if v.east_type != VectorType(IntegerType):
            raise ExpressionError(
                f".{op}() indices must be a Vector<Integer>, got {v.east_type.type}")
        return v

    def _same(self, builtin: str, t: EastType, args: list) -> VectorExpression:
        return self._expr(_builtin(builtin, self.east_type, [t], [self.ir, *args]), self.east_type)

    # ── structural ──────────────────────────────────────────────────────

    def length(self) -> IntegerExpression:
        """Traced VectorLength."""
        return self._expr(
            _builtin("VectorLength", IntegerType, [self._elem()], [self.ir]), IntegerType)

    def get(self, index: Any) -> Expression:
        """Traced VectorGet."""
        i = _lift(index)
        if i.east_type.type != "Integer":
            raise ExpressionError("Vector.get() takes an Integer index")
        elem_t = self._elem()
        return self._expr(_builtin("VectorGet", elem_t, [elem_t], [self.ir, i.ir]), elem_t)

    def set(self, index: Any, value: Any) -> VectorExpression:
        """Traced functional update — VectorSet returns a NEW vector."""
        elem_t = self._elem()
        i = _lift(index)
        if i.east_type.type != "Integer":
            raise ExpressionError("Vector.set() index must be an Integer")
        v = self._scalar_arg("set", value, elem_t)
        return self._same("VectorSet", elem_t, [i.ir, v.ir])

    def slice(self, start: Any, end: Any) -> VectorExpression:
        """Traced VectorSlice over ``[start, end)``."""
        s = _lift(start)
        e = _lift(end)
        if s.east_type.type != "Integer" or e.east_type.type != "Integer":
            raise ExpressionError(".slice() bounds must be Integers")
        return self._same("VectorSlice", self._elem(), [s.ir, e.ir])

    def concat(self, other: Any) -> VectorExpression:
        """Traced VectorConcat."""
        o = self._same_typed("concat", other)
        return self._same("VectorConcat", self._elem(), [o.ir])

    def to_array(self) -> ArrayExpression:
        """Traced VectorToArray."""
        elem_t = self._elem()
        out_t = ArrayType(elem_t)
        return self._expr(_builtin("VectorToArray", out_t, [elem_t], [self.ir]), out_t)

    def to_matrix(self, rows: Any, cols: Any) -> MatrixExpression:
        """Traced VectorToMatrix: reshape into ``rows x cols`` (row-major)."""
        elem_t = self._elem()
        r = _lift(rows)
        c = _lift(cols)
        if r.east_type.type != "Integer" or c.east_type.type != "Integer":
            raise ExpressionError(".to_matrix() dimensions must be Integers")
        out_t = MatrixType(elem_t)
        return self._expr(
            _builtin("VectorToMatrix", out_t, [elem_t], [self.ir, r.ir, c.ir]), out_t)

    # ── elementwise arithmetic + reductions ─────────────────────────────

    def scale(self, alpha: Any) -> VectorExpression:
        """Traced VectorScale: every element times ``alpha``."""
        t = self._numeric("scale")
        a = self._scalar_arg("scale", alpha, t)
        return self._same("VectorScale", t, [a.ir])

    def sum(self) -> Expression:
        """Traced VectorSum (index order, left to right)."""
        t = self._numeric("sum")
        return self._expr(_builtin("VectorSum", t, [t], [self.ir]), t)

    def add_scaled(self, other: Any, alpha: Any) -> VectorExpression:
        """Traced VectorAddScaled: ``self + alpha * other``."""
        t = self._numeric("add_scaled")
        o = self._same_typed("add_scaled", other)
        a = self._scalar_arg("add_scaled", alpha, t)
        return self._same("VectorAddScaled", t, [o.ir, a.ir])

    def mul(self, other: Any) -> VectorExpression:
        """Traced VectorMul: elementwise product."""
        t = self._numeric("mul")
        o = self._same_typed("mul", other)
        return self._same("VectorMul", t, [o.ir])

    def add_scalar(self, value: Any) -> VectorExpression:
        """Traced VectorAddScalar: ``value`` added to every element."""
        t = self._numeric("add_scalar")
        v = self._scalar_arg("add_scalar", value, t)
        return self._same("VectorAddScalar", t, [v.ir])

    def dot(self, other: Any) -> Expression:
        """Traced VectorDot, accumulating in index order."""
        t = self._numeric("dot")
        o = self._same_typed("dot", other)
        return self._expr(_builtin("VectorDot", t, [t], [self.ir, o.ir]), t)

    def max(self) -> Expression:
        """Traced VectorMax (East total order; an empty vector errors; ties
        resolve to the earliest) — TS ``max``."""
        t = self._numeric("max")
        return self._expr(_builtin("VectorMax", t, [t], [self.ir]), t)

    def min(self) -> Expression:
        """Traced VectorMin — TS ``min``."""
        t = self._numeric("min")
        return self._expr(_builtin("VectorMin", t, [t], [self.ir]), t)

    maximum = _deprecated_alias("maximum", "max")
    minimum = _deprecated_alias("minimum", "min")

    def arg_max(self) -> IntegerExpression:
        """Traced VectorArgMax: the index of the largest element."""
        t = self._numeric("arg_max")
        return self._expr(_builtin("VectorArgMax", IntegerType, [t], [self.ir]), IntegerType)

    def arg_min(self) -> IntegerExpression:
        """Traced VectorArgMin: the index of the smallest element."""
        t = self._numeric("arg_min")
        return self._expr(_builtin("VectorArgMin", IntegerType, [t], [self.ir]), IntegerType)

    def mean(self) -> FloatExpression:
        """Traced VectorMean (a Float; NaN when empty)."""
        t = self._numeric("mean")
        return self._expr(_builtin("VectorMean", FloatType, [t], [self.ir]), FloatType)

    def cum_sum(self) -> VectorExpression:
        """Traced VectorCumSum: the running sum, left to right."""
        return self._same("VectorCumSum", self._numeric("cum_sum"), [])

    def abs(self) -> VectorExpression:
        """Traced VectorAbs."""
        return self._same("VectorAbs", self._numeric("abs"), [])

    def clamp(self, lo: Any, hi: Any) -> VectorExpression:
        """Traced VectorClamp under East's total order."""
        t = self._numeric("clamp")
        lo_e = self._scalar_arg("clamp", lo, t)
        hi_e = self._scalar_arg("clamp", hi, t)
        return self._same("VectorClamp", t, [lo_e.ir, hi_e.ir])

    # ── gather/scatter and sorted search ────────────────────────────────

    def gather(self, indices: Any) -> VectorExpression:
        """Traced VectorGather: ``result[j] = self[indices[j]]``."""
        idx = self._index_vector("gather", indices)
        return self._same("VectorGather", self._elem(), [idx.ir])

    def scatter_add(self, indices: Any, src: Any) -> VectorExpression:
        """Traced VectorScatterAdd: a copy with ``src[j]`` added at
        ``indices[j]``, duplicates accumulating in order."""
        t = self._numeric("scatter_add")
        idx = self._index_vector("scatter_add", indices)
        s = self._same_typed("scatter_add", src)
        return self._same("VectorScatterAdd", t, [idx.ir, s.ir])

    def search_sorted(self, needles: Any) -> VectorExpression:
        """Traced VectorSearchSorted: leftmost insertion index per needle."""
        n = self._same_typed("search_sorted", needles)
        out_t = VectorType(IntegerType)
        return self._expr(
            _builtin("VectorSearchSorted", out_t, [self._elem()], [self.ir, n.ir]), out_t)

    # ── masks and selection ─────────────────────────────────────────────

    def _mask_compare(self, builtin: str, op: str, other: Any) -> VectorExpression:
        o = self._same_typed(op, other)
        out_t = VectorType(BooleanType)
        return self._expr(_builtin(builtin, out_t, [self._elem()], [self.ir, o.ir]), out_t)

    def eq(self, other: Any) -> VectorExpression:
        """Traced VectorEq: elementwise East equality as a Boolean mask."""
        return self._mask_compare("VectorEq", "eq", other)

    def lt(self, other: Any) -> VectorExpression:
        """Traced VectorLt: elementwise less-than as a Boolean mask."""
        return self._mask_compare("VectorLt", "lt", other)

    def gt(self, other: Any) -> VectorExpression:
        """Traced VectorGt: elementwise greater-than as a Boolean mask."""
        return self._mask_compare("VectorGt", "gt", other)

    def select(self, a: Any, b: Any) -> VectorExpression:
        """Traced VectorSelect: this Boolean mask picks each element from
        ``a`` (true) or ``b`` (false)."""
        if self._elem().type != "Boolean":
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

    def compress(self, mask: Any) -> VectorExpression:
        """Traced VectorCompress: keep the elements where ``mask`` is true."""
        m = _lift(mask, hint=VectorType(BooleanType))
        if m.east_type != VectorType(BooleanType):
            raise ExpressionError(
                f".compress() mask must be a Vector<Boolean>, got {m.east_type.type}")
        return self._expr(
            _builtin("VectorCompress", self.east_type, [self._elem()], [m.ir, self.ir]),
            self.east_type,
        )

    def count_true(self) -> IntegerExpression:
        """Traced VectorCountTrue on a Boolean vector."""
        if self._elem().type != "Boolean":
            raise ExpressionError(".count_true() needs a Vector<Boolean>")
        return self._expr(
            _builtin("VectorCountTrue", IntegerType, [], [self.ir]), IntegerType)

    # ── the callback builtins (TS ``map`` / ``reduce``) ─────────────────

    def map(self, fn: Any) -> VectorExpression:
        """Traced VectorMap: ``fn(element, index)`` per element, producing a
        new Vector (the result must be a Float, Integer or Boolean)."""
        elem_t = self._elem()
        node, out_t = _trace_inner_fn(fn, [elem_t, IntegerType])
        if out_t.type not in ("Float", "Integer", "Boolean"):
            raise ExpressionError(
                f".map() on a Vector must produce Float, Integer or Boolean elements, "
                f"got {out_t.type}")
        out = VectorType(out_t)
        return self._expr(_builtin("VectorMap", out, [elem_t, out_t], [self.ir, node]), out)

    def reduce(self, fn: Any, init: Any) -> Expression:
        """Traced VectorFold: ``fn(acc, element, index)`` from ``init``, in
        index order (TS ``reduce``)."""
        fn, init = _fn_init("reduce", fn, init)
        elem_t = self._elem()
        seed = _lift(init)
        acc_t = seed.east_type
        node, out_t = _trace_inner_fn(fn, [acc_t, elem_t, IntegerType], out_hint=acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".reduce() step returns {out_t.type}, accumulator is {acc_t.type}")
        return self._expr(
            _builtin("VectorFold", acc_t, [elem_t, acc_t], [self.ir, seed.ir, node]), acc_t)
