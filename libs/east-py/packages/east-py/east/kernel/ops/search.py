#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The ``find_*`` family (Array only, mirroring the eager methods).

Every one of these compares under East's TOTAL ORDER via the builtin, so a
traced search agrees with the eager one on floats, strings, variants and
structs alike.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.ir.builders import ir_let
from east.kernel.errors import KernelTraceError
from east.kernel.lift import _lift, _trace_inner_fn, _with_index, if_else
from east.kernel.nodes import (
    _builtin,
    _fresh_name,
    _k_block,
    _k_function,
    _option_type,
    _var,
)
from east.kernel.ops import _ExprBase
from east.types.types import EastType, FunctionType, IntegerType

if TYPE_CHECKING:
    from east.kernel.expr import KernelExpr


class _SearchOps(_ExprBase):
    """Traced index searches over an Array."""

    __slots__ = ()

    # ── find_* (#525 phase 2) ───────────────────────────────────────────
    # Array-only, mirroring the eager methods: every one of these compares
    # under East's TOTAL ORDER via the builtin, so a traced search agrees with
    # the eager one on floats, strings, variants and structs alike.

    def _find_keyed(self, builtin: str, op: str, target: Any, key: Any,
                    out_t: EastType) -> KernelExpr:
        """The shared ``(array, target, key)`` shape of the ArrayFind* family.

        The key projects each element into the target's type; without one the
        elements are compared directly, exactly as eagerly.
        """
        elem_t = self._array_elem(op)
        if key is None:
            v = _var(_fresh_name(), elem_t)
            node = _k_function(FunctionType([elem_t], elem_t), [], [v], v)
            t2 = elem_t
        else:
            node, t2 = _trace_inner_fn(key, [elem_t], declared=1)
        tgt = _lift(target, hint=t2)
        if tgt.east_type != t2:
            raise KernelTraceError(
                f".{op}() target is {tgt.east_type.type} but the key projects "
                f"to {t2.type} — they must be the same East type"
            )
        return self._expr(
            _builtin(builtin, out_t, [elem_t, t2], [self.ir, tgt.ir, node]), out_t
        )

    def find_first(self, target: Any, key: Any = None) -> KernelExpr:
        """Traced ArrayFindFirst: ``some(index)`` of the first element whose
        ``key`` equals ``target`` under East equality, else ``none``. Linear
        scan — the array need not be sorted."""
        return self._find_keyed("ArrayFindFirst", "find_first", target, key,
                                _option_type(IntegerType))

    def find_sorted_first(self, target: Any, key: Any = None) -> KernelExpr:
        """Traced ArrayFindSortedFirst: the leftmost insertion index for
        ``target``. Assumes the array is already sorted in East order, like
        the eager method."""
        return self._find_keyed("ArrayFindSortedFirst", "find_sorted_first",
                                target, key, IntegerType)

    def find_sorted_last(self, target: Any, key: Any = None) -> KernelExpr:
        """Traced ArrayFindSortedLast: the rightmost insertion index."""
        return self._find_keyed("ArrayFindSortedLast", "find_sorted_last",
                                target, key, IntegerType)

    def find_sorted_range(self, target: Any, key: Any = None) -> KernelExpr:
        """Traced ArrayFindSortedRange: the half-open ``{start, end}`` span of
        elements equal to ``target``; ``start == end`` when absent."""
        from east.types.types import StructType as _StructType

        out = _StructType([("start", IntegerType), ("end", IntegerType)])
        return self._find_keyed("ArrayFindSortedRange", "find_sorted_range",
                                target, key, out)

    def find_all(self, value: Any, by: Any = None) -> KernelExpr:
        """Traced ArrayFilterMap: the indices whose element (or ``by``
        projection) equals ``value``, in row order."""
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import ArrayType as _ArrayType

        elem_t = self._array_elem("find_all")
        proj = _with_index(by if by is not None else (lambda el: el))
        _probe, p_t = _trace_inner_fn(proj, [elem_t, IntegerType], declared=2)
        target = _lift(value, hint=p_t)
        if target.east_type != p_t:
            raise KernelTraceError(
                f".find_all() value is {target.east_type.type} but the "
                f"projection yields {p_t.type} — they must be the same East type"
            )
        # Bind the target to a Let before the builtin. Unlike the ArrayFind*
        # family — where the target is a builtin ARGUMENT and so evaluated once
        # — this probe lives inside the per-element callback, and the trace-time
        # CSE cannot rescue it: the target node occurs exactly once, and only
        # nodes seen twice are hoisted. An EXPRESSION target (`a.maximum(...)`,
        # `a.mean(...)`) would therefore be recomputed per element: measured
        # O(N^2), 3.7s at N=4000 against 1.3ms for the same search via
        # find_first. Eager does not have this shape — it receives an
        # already-evaluated value — so leaving it would be a traced-vs-eager
        # divergence in COMPLEXITY, the exact failure #524/#525 exist to remove.
        tname = _fresh_name()
        bound = self._expr(_var(tname, p_t), p_t)
        node, _out_t = _trace_inner_fn(
            lambda el, i: if_else(_lift(proj(el, i)) == bound, _some(i), _none),
            [elem_t, IntegerType], declared=2,
        )
        out = _ArrayType(IntegerType)
        scan = _builtin("ArrayFilterMap", out, [elem_t, IntegerType], [self.ir, node])
        return self._expr(
            _k_block(out, [ir_let(p_t, _var(tname, p_t), target.ir), scan]), out
        )

    def _find_extreme(self, op: str, by: Any, pick: Any) -> KernelExpr:
        """``some(index)`` of the first extreme, ``none`` when empty.

        The eager methods return ``none`` for an empty array rather than
        raising (unlike ``maximum``/``minimum`` themselves), and a kernel
        cannot test the length at trace time — so the emptiness check is a
        ``if_else``, which compiles to IfElse and evaluates exactly one arm
        at run time. The receiver is bound once: it is read three times here.
        """
        from east.types.construct import none as _none

        self._array_elem(op)
        return self._with_bound_receiver(lambda recv: if_else(
            recv.size() == 0,
            _none,
            recv.find_first(pick(recv, by), key=by),
        ))

    def find_maximum(self, by: Any = None) -> KernelExpr:
        """Traced index of the first maximum as ``some(index)``; ``none`` for
        an empty array, like the eager ``find_maximum``."""
        return self._find_extreme("find_maximum", by, lambda r, b: r.maximum(b))

    def find_minimum(self, by: Any = None) -> KernelExpr:
        """Traced index of the first minimum as ``some(index)``; ``none`` when
        empty."""
        return self._find_extreme("find_minimum", by, lambda r, b: r.minimum(b))
