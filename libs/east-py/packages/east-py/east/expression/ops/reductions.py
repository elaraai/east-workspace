#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Whole-container reductions.

Hand-rolling these as a fold is where the accidental-quadratic risk lives
(#524 measured 6h02m for 729k rows), so they are the highest-value additions
to the surface. Every one composes the SAME builtin the eager method uses, so
traced and eager agree including float accumulation order.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import _lift, _trace_inner_fn, _with_index, greatest, least
from east.expression.location import location_id as _loc_id
from east.expression.nodes import _builtin, _fresh_name, _k_block, _var
from east.expression.ops import _ExprBase
from east.ir.builders import ir_let
from east.types.types import IntegerType

if TYPE_CHECKING:
    from east.expression.expr import Expression


class _ReductionOps(_ExprBase):
    """Traced reduce / sum / mean / maximum / minimum."""

    __slots__ = ()

    # ── reductions (#525 phase 1) ───────────────────────────────────────
    # Hand-rolling these as a fold is where the accidental-quadratic risk
    # lives (#524 measured 6h02m for 729k rows), so they are the highest-value
    # additions to the surface. Every one composes the SAME builtin the eager
    # method uses, so traced and eager agree including float accumulation
    # order.

    def reduce(self, initial: Any, fn: Any) -> Expression:
        """Traced SetReduce / DictReduce: fold every element into one
        accumulator, in East order. Set steps take ``fn(acc, element)``, Dict
        steps ``fn(acc, key, value)``. An Array's spelling is :meth:`fold`.
        """
        tag = self.east_type.type
        init = _lift(initial)
        acc_t = init.east_type
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [acc_t, elem_t], declared=2, out_hint=acc_t)
            builtin, tps, args = "SetReduce", [elem_t, acc_t], [self.ir, node, init.ir]
        elif tag == "Dict":
            kv = self.east_type.value
            # The builtin's slot is (acc, value, key); the user fn takes
            # (acc, key, value), matching the eager Dict callbacks.
            node, out_t = _trace_inner_fn(
                lambda a, v, k: fn(a, k, v), [acc_t, kv["value"], kv["key"]], declared=3,
                out_hint=acc_t
            )
            builtin = "DictReduce"
            tps = [kv["key"], kv["value"], acc_t]
            args = [self.ir, node, init.ir]
        else:
            raise ExpressionError(
                f".reduce() on {tag}" + (" — an Array folds with .fold()" if tag == "Array" else "")
            )
        if out_t != acc_t:
            raise ExpressionError(
                f".reduce() step returns {out_t.type}, accumulator is {acc_t.type}"
            )
        return self._expr(_builtin(builtin, acc_t, tps, args), acc_t)

    def _numeric_projection(self, op: str, fn: Any) -> tuple:
        """``(projection, its traced numeric type)`` for sum/mean.

        The returned projection is normalised to the container's own element
        callback shape — ``(el, idx)`` for an Array, ``(el)`` for a Set,
        ``(key, value)`` for a Dict — so an index-taking projection, which the
        eager methods accept, traces here too (#525).

        The type comes from TRACING the projection, never from a value — a
        kernel has no data to sample, which is exactly why the traced surface
        cannot fall into the #450 single-case-variant trap here.
        """
        tag = self.east_type.type
        proj: Any
        if tag == "Array":
            elem_t = self.east_type.value
            proj = _with_index(fn if fn is not None else (lambda el: el))
            _n, t2 = _trace_inner_fn(proj, [elem_t, IntegerType], declared=2)
        elif tag == "Set":
            elem_t = self.east_type.value
            proj = fn if fn is not None else (lambda el: el)
            _n, t2 = _trace_inner_fn(proj, [elem_t], declared=1)
        elif tag == "Dict":
            kv = self.east_type.value
            proj = fn if fn is not None else (lambda _k, v: v)
            _n, t2 = _trace_inner_fn(
                lambda v, k: proj(k, v), [kv["value"], kv["key"]], declared=2
            )
        else:
            raise ExpressionError(f".{op}() on {tag}")
        if t2.type not in ("Integer", "Float"):
            raise ExpressionError(
                f".{op}() needs a numeric (Integer/Float) projection, got {t2.type}"
            )
        return proj, t2

    def _with_bound_receiver(self, build: Any) -> Expression:
        """Evaluate the receiver ONCE and hand the binding to ``build``.

        Any composed method that reads the receiver more than a single time
        needs this. ``_finalize_ir``'s CSE only hoists a shared subtree whose
        free variables are the kernel's own parameters, so at the top level a
        repeated receiver is bound for free — but inside an inner lambda it
        closes over that lambda's parameter, the hoist is refused, and the
        subtree is emitted AND EXECUTED once per use, squaring with nesting
        depth. That is the group-then-aggregate shape this surface exists for,
        so the binding is explicit rather than left to the optimiser (#525).
        """
        name = _fresh_name()
        recv = self._expr(_var(name, self.east_type), self.east_type)
        body = build(recv)
        return self._expr(
            _k_block(
                body.east_type,
                [ir_let(self.east_type, _var(name, self.east_type), self.ir, _loc_id()),
                 body.ir],
            ),
            body.east_type,
        )

    def _reduce_numeric(self, zero: Any, proj: Any, wrap: Any) -> Expression:
        """Fold ``wrap(proj(...))`` from ``zero`` with the container's own
        callback shape (Array folds with the index in scope)."""
        tag = self.east_type.type
        if tag == "Dict":
            return self.reduce(zero, lambda acc, k, v: acc + wrap(proj(k, v)))
        if tag == "Array":
            return self.fold(zero, lambda acc, el, i: acc + wrap(proj(el, i)))
        return self.reduce(zero, lambda acc, el: acc + wrap(proj(el)))

    def sum(self, fn: Any = None) -> Expression:
        """Traced sum of the elements, or of ``fn(...)`` over them.

        The zero is typed from the projection, so an empty collection sums to
        the projection's zero (not the element type's). Without ``fn`` the
        elements — a Dict's VALUES — must be Integer or Float.
        """
        proj, t2 = self._numeric_projection("sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self._reduce_numeric(zero, proj, lambda v: v)

    def mean(self, fn: Any = None) -> Expression:
        """Traced arithmetic mean as a Float.

        An Integer projection widens once per element with IntegerToFloat, so
        the accumulation happens in Float exactly as the eager ``mean`` does.
        An empty collection yields NaN — ``0.0 / 0.0`` — matching the eager
        methods' explicit NaN rather than raising.
        """
        proj, t2 = self._numeric_projection("mean", fn)
        widen = t2.type == "Integer"

        def as_float(value: Any) -> Expression:
            # One IntegerToFloat per element, decided once from the TYPE — the
            # traced twin of the eager `_float_proj` rule (#470). Lift FIRST:
            # a projection may legitimately return a plain python number
            # (`.mean(lambda r: 1)` works eagerly), which has no `.to_float()`.
            lifted = _lift(value)
            return lifted.to_float() if widen else lifted

        # mean touches the receiver twice — the fold and size() — so bind it
        # once (see _with_bound_receiver for why the CSE cannot be relied on
        # inside an inner lambda).
        return self._with_bound_receiver(
            lambda recv: recv._reduce_numeric(0.0, proj, as_float) / recv.size().to_float())

    def maximum(self, by: Any = None) -> Expression:
        """Traced ArrayMapReduce under ``greatest`` (East total order).

        Errors at run time on an empty array, like the eager ``maximum`` —
        there is no identity element for a max.
        """
        self._array_elem("maximum")
        return self.map_reduce(by if by is not None else (lambda el: el),
                               lambda a, b: greatest(a, b))

    def minimum(self, by: Any = None) -> Expression:
        """Traced ArrayMapReduce under ``least``; errors on empty, like the
        eager ``minimum``."""
        self._array_elem("minimum")
        return self.map_reduce(by if by is not None else (lambda el: el),
                               lambda a, b: least(a, b))
