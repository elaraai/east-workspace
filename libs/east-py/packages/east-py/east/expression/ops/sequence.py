#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Ordering, slicing, copying, gathering — and the set algebra.

The whole-container operations that take no element callback (or only a key
projection): sorting, the array slicing family, ``copy``/``get_keys``, the set
algebra, and the optional reads.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import _lift, _trace_inner_fn, _with_key_arg
from east.expression.location import location_id as _loc_id
from east.expression.nodes import (
    _builtin,
    _fresh_name,
    _k_block,
    _k_function,
    _option_type,
    _var,
)
from east.expression.ops import _ExprBase
from east.ir.builders import ir_let
from east.types.types import ArrayType, BooleanType, EastType, FunctionType, IntegerType, NullType

if TYPE_CHECKING:
    from east.expression.expr import Expression


class _SequenceOps(_ExprBase):
    """Traced ordering, slicing, copying, gathering and set algebra."""

    __slots__ = ()

    def sorted(self, key: Any = None, *, reverse: bool = False) -> Expression:
        """Traced ArraySort/ArraySortDefault (+ ArrayReverse for ``reverse``),
        ordering by East's total order like the eager method."""
        from east.types.types import ArrayType as _ArrayType

        elem_t = self._array_elem("sorted")
        out = _ArrayType(elem_t)
        if key is None:
            expr = self._expr(
                _builtin("ArraySortDefault", out, [elem_t], [self.ir]), out)
        else:
            node, t2 = _trace_inner_fn(key, [elem_t], declared=1)
            expr = self._expr(
                _builtin("ArraySort", out, [elem_t, t2], [self.ir, node]), out)
        if reverse:
            expr = self._expr(_builtin("ArrayReverse", out, [elem_t], [expr.ir]), out)
        return expr

    def is_sorted(self, key: Any = None) -> Expression:
        """Traced ArrayIsSorted: whether elements (or key projections) are in
        non-decreasing East order."""
        elem_t = self._array_elem("is_sorted")
        if key is None:
            v = _var(_fresh_name(), elem_t)
            node = _k_function(FunctionType([elem_t], elem_t), [], [v], v)
            t2 = elem_t
        else:
            node, t2 = _trace_inner_fn(key, [elem_t], declared=1)
        return self._expr(
            _builtin("ArrayIsSorted", BooleanType, [elem_t, t2], [self.ir, node]),
            BooleanType,
        )

    def _same_typed(self, op: str, other: Any) -> Expression:
        """Lift ``other`` and require it to share this expression's East type."""
        o = _lift(other, hint=self.east_type)
        if o.east_type != self.east_type:
            raise ExpressionError(
                f".{op}() operand has East type {o.east_type.type}, "
                f"this expression is {self.east_type.type} of a different shape"
            )
        return o

    def concat(self, other: Any) -> Expression:
        """Traced ArrayConcat: this array with ``other`` appended."""
        elem_t = self._array_elem("concat")
        o = self._same_typed("concat", other)
        return self._expr(
            _builtin("ArrayConcat", self.east_type, [elem_t], [self.ir, o.ir]),
            self.east_type,
        )

    def slice(self, start: Any, end: Any) -> Expression:
        """Traced ArraySlice over the half-open ``[start, end)`` range; the
        bounds may be python ints or traced Integer expressions."""
        elem_t = self._array_elem("slice")
        s = _lift(start)
        e = _lift(end)
        if s.east_type.type != "Integer" or e.east_type.type != "Integer":
            raise ExpressionError(".slice() bounds must be Integers")
        return self._expr(
            _builtin("ArraySlice", self.east_type, [elem_t], [self.ir, s.ir, e.ir]),
            self.east_type,
        )

    def reversed(self) -> Expression:
        """Traced ArrayReverse: the elements in reverse order."""
        elem_t = self._array_elem("reversed")
        return self._expr(
            _builtin("ArrayReverse", self.east_type, [elem_t], [self.ir]),
            self.east_type,
        )

    def copy(self) -> Expression:
        """Traced shallow copy (ArrayCopy / SetCopy / DictCopy)."""
        tag = self.east_type.type
        if tag == "Array":
            tps: list = [self.east_type.value]
            builtin = "ArrayCopy"
        elif tag == "Set":
            tps = [self.east_type.value]
            builtin = "SetCopy"
        elif tag == "Dict":
            kv = self.east_type.value
            tps = [kv["key"], kv["value"]]
            builtin = "DictCopy"
        else:
            raise ExpressionError(f".copy() on {tag}")
        return self._expr(
            _builtin(builtin, self.east_type, tps, [self.ir]), self.east_type
        )

    def get_keys(self, keys: Any, fill: Any = None) -> Expression:
        """Traced gather: Array takes an ``Array<Integer>`` of indices
        (ArrayGetKeys); Dict takes a ``Set`` of keys plus a required
        ``fill(key)`` for the absent ones (DictGetKeys)."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            idx = _lift(keys)
            if idx.east_type != ArrayType(IntegerType):
                raise ExpressionError(".get_keys() takes an Array<Integer> of indices")
            node, out_t = _trace_inner_fn(
                lambda _b, i: self.get(i), [IntegerType], declared=1)
            return self._expr(
                _builtin("ArrayGetKeys", self.east_type, [elem_t],
                         [self.ir, idx.ir, node]),
                self.east_type,
            )
        if tag == "Dict":
            if fill is None:
                raise ExpressionError(".get_keys() on a Dict needs fill(key)")
            kv = self.east_type.value
            ks = _lift(keys)
            from east.types.types import SetType as _SetType

            if ks.east_type != _SetType(kv["key"]):
                raise ExpressionError(
                    ".get_keys() takes a Set of this dict's key type")
            fill_node, f_out = _trace_inner_fn(fill, [kv["key"]], declared=1,
                                               out_hint=kv["value"])
            if f_out != kv["value"]:
                raise ExpressionError(
                    f".get_keys() fill returns {f_out.type}, values are {kv['value'].type}")
            return self._expr(
                _builtin("DictGetKeys", self.east_type, [kv["key"], kv["value"]],
                         [self.ir, ks.ir, fill_node]),
                self.east_type,
            )
        raise ExpressionError(f".get_keys() on {tag}")

    def _set_algebra(self, builtin: str, op: str, other: Any, out_t: EastType | None = None) -> Expression:
        if self.east_type.type != "Set":
            raise ExpressionError(f".{op}() on {self.east_type.type} (needs Set)")
        o = self._same_typed(op, other)
        out = out_t if out_t is not None else self.east_type
        return self._expr(
            _builtin(builtin, out, [self.east_type.value], [self.ir, o.ir]), out
        )

    def union(self, other: Any, combine: Any = None) -> Expression:
        """Traced union: SetUnion, or the pure whole-dict union for a Dict.

        The Dict form is the traced twin of the ``EastDict.union`` added in
        #527, composed the same way the eager method composes it — a
        ``DictCopy`` bound to a ``Let``, then ``DictUnionInPlace`` into that
        copy — so neither input is modified. Without ``combine`` a key present
        in both errors, exactly as eager and TS's ``unionInPlace`` do.
        """
        if self.east_type.type == "Set":
            if combine is not None:
                raise ExpressionError(".union() on a Set takes no combine — sets have no values")
            return self._set_algebra("SetUnion", "union", other)
        if self.east_type.type != "Dict":
            raise ExpressionError(f".union() on {self.east_type.type}")
        kv = self.east_type.value
        k_t, v_t = kv["key"], kv["value"]
        o = self._same_typed("union", other)
        if combine is None:
            merge_node = self._key_error_node(
                v_t, k_t, "Key ", " exists in both dictionaries")
        else:
            merge_node, c_out = _trace_inner_fn(
                _with_key_arg(combine), [v_t, v_t, k_t], declared=3, out_hint=v_t)
            if c_out != v_t:
                raise ExpressionError(
                    f".union() combine returns {c_out.type}, values are {v_t.type}")
        name = _fresh_name()
        result = _var(name, self.east_type)
        copy = _builtin("DictCopy", self.east_type, [k_t, v_t], [self.ir])
        merged = _builtin(
            "DictUnionInPlace", NullType, [k_t, v_t], [result, o.ir, merge_node])
        return self._expr(
            _k_block(self.east_type,
                     [ir_let(self.east_type, _var(name, self.east_type), copy, _loc_id()),
                      merged, result]),
            self.east_type,
        )

    def intersect(self, other: Any) -> Expression:
        """Traced SetIntersect."""
        return self._set_algebra("SetIntersect", "intersect", other)

    def diff(self, other: Any) -> Expression:
        """Traced SetDiff: elements in this set but not ``other``."""
        return self._set_algebra("SetDiff", "diff", other)

    def sym_diff(self, other: Any) -> Expression:
        """Traced SetSymDiff: elements in exactly one of the sets."""
        return self._set_algebra("SetSymDiff", "sym_diff", other)

    def is_subset(self, other: Any) -> Expression:
        """Traced SetIsSubset."""
        return self._set_algebra("SetIsSubset", "is_subset", other, BooleanType)

    def is_superset_of(self, other: Any) -> Expression:
        """Traced SetIsSubset with the operands swapped — the traced twin of
        the eager ``EastSet.is_superset_of`` added in #526.

        Without this the whole set algebra traced except this one member, so a
        lambda that works eagerly silently dropped off the kernel surface —
        and with it the enclosing capture.
        """
        if self.east_type.type != "Set":
            raise ExpressionError(f".is_superset_of() on {self.east_type.type} (needs Set)")
        o = self._same_typed("is_superset_of", other)
        return self._expr(
            _builtin("SetIsSubset", BooleanType, [self.east_type.value], [o.ir, self.ir]),
            BooleanType,
        )

    def is_disjoint(self, other: Any) -> Expression:
        """Traced SetIsDisjoint."""
        return self._set_algebra("SetIsDisjoint", "is_disjoint", other, BooleanType)

    def keys_set(self) -> Expression:
        """Traced DictKeys: this dict's keys as a Set."""
        from east.types.types import SetType as _SetType

        if self.east_type.type != "Dict":
            raise ExpressionError(f".keys_set() on {self.east_type.type} (needs Dict)")
        kv = self.east_type.value
        out = _SetType(kv["key"])
        return self._expr(
            _builtin("DictKeys", out, [kv["key"], kv["value"]], [self.ir]), out
        )

    def try_get(self, key: Any) -> Expression:
        """Traced optional access: ``some(value)`` in bounds / present, else ``none``."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            i = _lift(key)
            if i.east_type.type != "Integer":
                raise ExpressionError("Array.try_get() takes an Integer index")
            out = _option_type(elem_t)
            return self._expr(_builtin("ArrayTryGet", out, [elem_t], [self.ir, i.ir]), out)
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(key, hint=kv["key"])
            out = _option_type(kv["value"])
            return self._expr(
                _builtin("DictTryGet", out, [kv["key"], kv["value"]], [self.ir, k.ir]), out
            )
        raise ExpressionError(f".try_get() on {tag}")
