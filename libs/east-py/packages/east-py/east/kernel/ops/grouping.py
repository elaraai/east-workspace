#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The grouped-fold family.

The grouped fold is the primitive; everything else composes from it, exactly
as the eager methods do, so a whole aggregate is ONE compiled kernel. The
general fold is spelled ``group_reduce`` on every container (TS ``groupReduce``
parity, #535); ``group_fold`` survives on Set/Dict as a deprecated alias.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.ir.builders import ir_let, ir_variant
from east.kernel.errors import KernelTraceError
from east.kernel.lift import (
    _lift,
    _trace_inner_fn,
    _with_acc_index,
    _with_index,
    _with_key_arg,
    greatest,
    least,
    where,
)
from east.kernel.nodes import (
    _builtin,
    _fresh_name,
    _k_block,
    _k_function,
    _k_new_array,
    _k_new_dict,
    _k_new_set,
    _literal,
    _option_type,
    _var,
)
from east.kernel.ops import _ExprBase
from east.types.types import BooleanType, EastType, FunctionType, IntegerType, NullType

if TYPE_CHECKING:
    from east.kernel.expr import KernelExpr


class _GroupOps(_ExprBase):
    """Traced grouping — the grouped fold and everything composed from it."""

    __slots__ = ()

    def group_by(self, key: Any) -> KernelExpr:
        """Traced ArrayGroupFold: a Dict from ``key(element)`` to the Array of
        its elements, with hand-built empty-init and append bodies — grouping
        inside a kernel makes a whole aggregate one compiled unit."""
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import DictType as _DictType

        elem_t = self._array_elem("group_by")
        key_node, k2 = _trace_inner_fn(
            lambda el, _i: key(el), [elem_t, IntegerType], declared=2)
        bucket_t = _ArrayType(elem_t)
        gk = _var(_fresh_name(), k2)
        init_node = _k_function(
            FunctionType([k2], bucket_t), [], [gk], _k_new_array(bucket_t, []))
        acc = _var(_fresh_name(), bucket_t)
        el = _var(_fresh_name(), elem_t)
        idx = _var(_fresh_name(), IntegerType)
        push = _builtin("ArrayPushLast", NullType, [elem_t], [acc, el])
        fold_node = _k_function(
            FunctionType([bucket_t, elem_t, IntegerType], bucket_t),
            [], [acc, el, idx], _k_block(bucket_t, [push, acc]))
        out = _DictType(k2, bucket_t)
        return self._expr(
            _builtin("ArrayGroupFold", out, [elem_t, k2, bucket_t],
                     [self.ir, key_node, init_node, fold_node]),
            out,
        )

    # ── group_* (#525 phase 3) ──────────────────────────────────────────
    # The grouped fold is the primitive; everything else composes from it,
    # exactly as the eager methods do, so a whole aggregate is ONE compiled
    # kernel. The general fold is spelled `group_reduce` on every container
    # (TS `groupReduce` parity, #535); `group_fold` survives on Set/Dict as
    # a deprecated alias. Set/Dict have no group_maximum/group_minimum
    # because their eager surfaces do not either.

    def _group_fold_parts(self, op: str, key: Any,
                          key_out: EastType | None = None) -> tuple:
        """``(builtin, type-param prefix, key node, K2, element param types)``
        for the container's GroupFold, with the container's own callback
        shape. ``key_out`` pins and types the key projection (#536)."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            key_node, k2 = _trace_inner_fn(_with_index(key), [elem_t, IntegerType],
                                           declared=2, out_hint=key_out)
            return "ArrayGroupFold", [elem_t], key_node, k2, [elem_t, IntegerType]
        if tag == "Set":
            elem_t = self.east_type.value
            key_node, k2 = _trace_inner_fn(key, [elem_t], declared=1, out_hint=key_out)
            return "SetGroupFold", [elem_t], key_node, k2, [elem_t]
        if tag == "Dict":
            kv = self.east_type.value
            # The builtin's key slot is (value, key); the user fn takes
            # (key, value), like every other eager Dict callback.
            key_node, k2 = _trace_inner_fn(
                lambda v, k: key(k, v), [kv["value"], kv["key"]], declared=2,
                out_hint=key_out)
            return ("DictGroupFold", [kv["key"], kv["value"]], key_node, k2,
                    [kv["value"], kv["key"]])
        raise KernelTraceError(f".{op}() on {tag}")

    def _group_fold(self, op: str, key: Any, init: Any, fold: Any,
                    key_out: EastType | None = None,
                    acc_out: EastType | None = None) -> KernelExpr:
        """The shared grouped fold behind every ``group_*`` method."""
        from east.types.types import DictType as _DictType

        builtin, tps, key_node, k2, elem_params = self._group_fold_parts(op, key, key_out)
        self._check_out(f".{op}() key", k2, key_out)
        init_node, acc_t = _trace_inner_fn(init, [k2], declared=1, out_hint=acc_out)
        self._check_out(f".{op}() accumulator", acc_t, acc_out)
        if self.east_type.type == "Dict":
            fold_node, out_t = _trace_inner_fn(
                lambda a, v, k: fold(a, k, v), [acc_t, *elem_params], declared=3,
                out_hint=acc_t)
        else:
            fold_node, out_t = _trace_inner_fn(
                _with_acc_index(fold) if self.east_type.type == "Array" else fold,
                [acc_t, *elem_params],
                declared=3 if self.east_type.type == "Array" else 2,
                out_hint=acc_t)
        if out_t != acc_t:
            raise KernelTraceError(
                f".{op}() step returns {out_t.type}, the accumulator from "
                f"init() is {acc_t.type}"
            )
        out = _DictType(k2, acc_t)
        return self._expr(
            _builtin(builtin, out, [*tps, k2, acc_t],
                     [self.ir, key_node, init_node, fold_node]),
            out,
        )

    def group_reduce(self, key: Any, init: Any, fold: Any,
                     key_out: EastType | None = None,
                     acc_out: EastType | None = None) -> KernelExpr:
        """Traced Array/Set/DictGroupFold: a Dict from the group key to the
        value ``fold`` accumulates from ``init(group_key)`` — the one grouped
        fold, spelled the same on every container (#535). Array steps take
        ``fold(acc, element)`` (``fold(acc, element, index)`` also accepted),
        Set steps ``fold(acc, element)``, Dict steps ``fold(acc, key, value)``.
        ``key_out`` / ``acc_out`` pin the group key / accumulator types and
        type the projections' traces (#536)."""
        return self._group_fold("group_reduce", key, init, fold, key_out, acc_out)

    def group_fold(self, key: Any, init: Any, fold: Any,
                   key_out: EastType | None = None,
                   acc_out: EastType | None = None) -> KernelExpr:
        """Deprecated Set/Dict alias for :meth:`group_reduce` (issue #535).

        The grouped fold had two names — TS ``groupReduce`` everywhere,
        east-py ``group_reduce`` on Array but ``group_fold`` on Set/Dict — so
        a call ported by name worked on one container and raised on the next.
        The operation is unchanged; only the spelling moves.
        """
        if self.east_type.type == "Array":
            raise KernelTraceError(
                ".group_fold() on Array — an Array groups with .group_reduce()"
            )
        import warnings

        warnings.warn(
            f"East{self.east_type.type}.group_fold is deprecated: the grouped "
            "fold is spelled group_reduce on every container (TS groupReduce). "
            "See issue #535.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self._group_fold("group_fold", key, init, fold, key_out, acc_out)

    def _grouped(self, op: str, key: Any, init: Any, fold: Any) -> KernelExpr:
        """Dispatch to the container's own grouped-fold spelling."""
        return self._group_fold(op, key, init, fold)

    def _per_element(self, fn: Any) -> Any:
        """Normalise a user element callback to the container's fold shape."""
        if self.east_type.type == "Dict":
            return fn if fn is not None else (lambda _k, v: v)
        return fn if fn is not None else (lambda el: el)

    def group_size(self, key: Any = None) -> KernelExpr:
        """Traced count per group key.

        ``key`` is optional on an Array — omitted, elements are counted by
        their own value — and required on a Set or Dict, mirroring the eager
        signatures exactly. Without the default a lambda that works eagerly
        stops tracing, which silently drops the enclosing loop to the
        per-element python path (#525).
        """
        if key is None:
            if self.east_type.type != "Array":
                raise KernelTraceError(
                    f".group_size() on a {self.east_type.type} needs a key "
                    "function — only an Array defaults to the identity key"
                )
            key = lambda el: el  # noqa: E731
        zero = lambda _gk: 0  # noqa: E731
        if self.east_type.type == "Dict":
            return self._grouped("group_size", key, zero, lambda acc, _k, _v: acc + 1)
        if self.east_type.type == "Array":
            return self._grouped("group_size", key, zero, lambda acc, _el, _i: acc + 1)
        return self._grouped("group_size", key, zero, lambda acc, _el: acc + 1)

    def group_sum(self, key: Any, fn: Any = None) -> KernelExpr:
        """Traced sum per group of ``fn(...)`` — the elements (a Dict's
        VALUES) when omitted. The zero is typed from the projection."""
        proj, t2 = self._numeric_projection("group_sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        if self.east_type.type == "Dict":
            return self._grouped("group_sum", key, lambda _gk: zero,
                                 lambda acc, k, v: acc + proj(k, v))
        if self.east_type.type == "Array":
            return self._grouped("group_sum", key, lambda _gk: zero,
                                 lambda acc, el, i: acc + proj(el, i))
        return self._grouped("group_sum", key, lambda _gk: zero,
                             lambda acc, el: acc + proj(el))

    def _group_quantifier(self, op: str, key: Any, pred: Any, seed: bool) -> KernelExpr:
        """group_every / group_some as a grouped boolean fold."""
        step: Any
        if self.east_type.type == "Dict":
            step = (lambda acc, k, v: acc & _lift(pred(k, v))) if seed \
                else (lambda acc, k, v: acc | _lift(pred(k, v)))
        elif self.east_type.type == "Array":
            p = _with_index(pred)
            step = (lambda acc, el, i: acc & _lift(p(el, i))) if seed \
                else (lambda acc, el, i: acc | _lift(p(el, i)))
        else:
            step = (lambda acc, el: acc & _lift(pred(el))) if seed \
                else (lambda acc, el: acc | _lift(pred(el)))
        return self._grouped(op, key, lambda _gk: seed, step)

    def group_every(self, key: Any, pred: Any) -> KernelExpr:
        """Traced per group: True when ``pred`` holds for every member."""
        return self._group_quantifier("group_every", key, pred, True)

    def group_some(self, key: Any, pred: Any) -> KernelExpr:
        """Traced per group: True when ``pred`` holds for any member."""
        return self._group_quantifier("group_some", key, pred, False)

    def _group_extreme(self, op: str, key: Any, by: Any, pick: Any) -> KernelExpr:
        """group_maximum / group_minimum (Array only, like the eager twins).

        Folds an ``Option`` so the first element of each group seeds the
        accumulator without inventing an identity, then unwraps — the same
        shape the eager method uses, so ties break identically.
        """
        from east.types.construct import some as _some

        self._array_elem(op)
        proj = _with_index(by if by is not None else (lambda el: el))
        _n, p_t = _trace_inner_fn(proj, [self.east_type.value, IntegerType], declared=2)
        opt_t = _option_type(p_t)
        grouped = self._grouped(
            op, key,
            lambda _gk: self._expr(ir_variant(opt_t, "none", _literal(None, NullType)), opt_t),
            lambda acc, el, i: _some(pick(acc.unwrap_or(proj(el, i)), proj(el, i))),
        )
        return grouped.map(lambda v: v.unwrap("some"))

    def group_maximum(self, key: Any, by: Any = None) -> KernelExpr:
        """Traced largest element/projection per group (East total order)."""
        return self._group_extreme("group_maximum", key, by, lambda a, b: greatest(a, b))

    def group_minimum(self, key: Any, by: Any = None) -> KernelExpr:
        """Traced smallest element/projection per group (East total order)."""
        return self._group_extreme("group_minimum", key, by, lambda a, b: least(a, b))

    def group_mean(self, key: Any, fn: Any = None) -> KernelExpr:
        """Traced Float mean per group.

        Accumulates ``{t, n}`` in ONE grouped pass and divides at the end —
        the sum is folded in element order exactly as the eager ``group_mean``
        folds it, so float accumulation agrees. (Eager reaches the same answer
        by merging a counts dict, which is a mutation and so has no traced
        form.)
        """
        proj, t2 = self._numeric_projection("group_mean", fn)
        widen = t2.type == "Integer"

        def as_float(value: Any) -> KernelExpr:
            lifted = _lift(value)
            return lifted.to_float() if widen else lifted

        seed = lambda _gk: {"t": 0.0, "n": 0}  # noqa: E731
        step: Any
        if self.east_type.type == "Dict":
            step = lambda acc, k, v: {"t": acc.t + as_float(proj(k, v)), "n": acc.n + 1}  # noqa: E731
        elif self.east_type.type == "Array":
            step = lambda acc, el, i: {"t": acc.t + as_float(proj(el, i)), "n": acc.n + 1}  # noqa: E731
        else:
            step = lambda acc, el: {"t": acc.t + as_float(proj(el)), "n": acc.n + 1}  # noqa: E731
        return self._grouped("group_mean", key, seed, step).map(
            lambda acc: acc.t / acc.n.to_float())

    # ── group_to_* / group_find_* (#525 phase 3b) ───────────────────────
    # The collect-into-a-collection and per-group search families — the last
    # seven eager `group_*` names that did not trace. An untraced name does not
    # raise: `try_push_down` simply fails and east-c trampolines once per
    # element, so the only symptom is that the job takes hours (#524).

    def _group_value_projection(self, op: str, fn: Any) -> tuple:
        """``(projection, its traced type)`` in the container's callback shape.

        Array ``(el, idx)``, Set ``(el)``, Dict ``(key, value)`` — the same
        normalisation :meth:`_numeric_projection` applies, so an index-taking
        projection (a supported EAGER call) traces here too.
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
                lambda v, k: proj(k, v), [kv["value"], kv["key"]], declared=2)
        else:
            raise KernelTraceError(f".{op}() on {tag}")
        return proj, t2

    def _group_collect(self, op: str, key: Any, value: Any, into: str) -> KernelExpr:
        """group_to_arrays / group_to_sets: a grouped fold into a COLLECTION.

        The accumulator is mutated per element, so the step body is hand-built
        IR rather than a traced lambda — the traced surface exposes no mutators
        on purpose (the kernel language is pure), but a grouped collect IS pure:
        each group's accumulator is created fresh by ``init`` and never escapes.
        This is the shape traced :meth:`group_by` already builds inline, and the
        one the eager ``_append_field_kernel`` / ``_set_insert_field_kernel``
        helpers compile.
        """
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import SetType as _SetType

        proj, v_t = self._group_value_projection(op, value)
        acc_t: EastType
        if into == "Array":
            acc_t = _ArrayType(v_t)
            empty: Any = _k_new_array
            add_name, add_out = "ArrayPushLast", NullType
        else:
            acc_t = _SetType(v_t)
            empty = _k_new_set
            # TRY-insert: duplicates within a group collapse, which is the
            # entire point of collecting into a set. The plain SetInsert errors
            # on an existing element — the defect the eager helper carried.
            add_name, add_out = "SetTryInsert", BooleanType

        def init(_gk: Any) -> KernelExpr:
            return self._expr(empty(acc_t, []), acc_t)

        def step(acc: Any, *rest: Any) -> KernelExpr:
            v = _lift(proj(*rest))
            add = _builtin(add_name, add_out, [v_t], [acc.ir, v.ir])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold(op, key, init, step)

    def group_to_arrays(self, key: Any, value: Any = None, *,
                        value_fn: Any = None) -> KernelExpr:
        """Traced arrays of ``value(...)`` per group key.

        Without ``value`` the elements themselves — a Dict's VALUES — are
        collected, which on an Array is exactly :meth:`group_by`.
        ``value_fn`` is the eager Dict spelling of the same projection (#536).
        """
        return self._group_collect("group_to_arrays", key,
                                   value if value is not None else value_fn, "Array")

    def group_to_sets(self, key: Any, value: Any = None, *,
                      value_fn: Any = None) -> KernelExpr:
        """Traced sets of ``value(...)`` per group key; duplicates within a
        group collapse. ``value_fn`` is the eager Dict spelling (#536)."""
        return self._group_collect("group_to_sets", key,
                                   value if value is not None else value_fn, "Set")

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None,
                       combine: Any = None, *, value_fn: Any = None) -> KernelExpr:
        """Traced nested dicts — ``key2(...) -> value(...)`` per group key.

        Without ``combine`` a duplicate INNER key errors at run time, matching
        the eager method and TS; with one, collisions resolve as
        ``combine(existing, incoming)``.
        """
        from east.types.types import DictType as _DictType

        proj, v_t = self._group_value_projection(
            "group_to_dicts", value if value is not None else value_fn)
        k2proj, k2_t = self._group_value_projection("group_to_dicts", key2)
        acc_t = _DictType(k2_t, v_t)
        add_args: list = []
        if combine is None:
            add_name = "DictInsert"
        else:
            node, c_out = _trace_inner_fn(
                _with_key_arg(combine), [v_t, v_t, k2_t], declared=3, out_hint=v_t)
            if c_out != v_t:
                raise KernelTraceError(
                    f".group_to_dicts() combine returns {c_out.type}, "
                    f"values are {v_t.type}")
            add_name, add_args = "DictInsertOrUpdate", [node]

        def init(_gk: Any) -> KernelExpr:
            return self._expr(_k_new_dict(acc_t, []), acc_t)

        def step(acc: Any, *rest: Any) -> KernelExpr:
            ik = _lift(k2proj(*rest))
            v = _lift(proj(*rest))
            add = _builtin(add_name, NullType, [k2_t, v_t],
                           [acc.ir, ik.ir, v.ir, *add_args])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold("group_to_dicts", key, init, step)

    def _find_index_pairs(self, op: str, key: Any, value: Any, by: Any) -> tuple:
        """``(Array<{i, k}> of matches, Set<K> of EVERY group, K, pair type)``.

        One native scan emits ``(index, group key)`` for the matching elements;
        the group set comes from a second native pass, so a group whose members
        all failed still appears in the result — the guarantee the eager method
        and TS ``groupFindAll`` both make.
        """
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import SetType as _SetType
        from east.types.types import StructType as _StructType

        elem_t = self._array_elem(op)
        kf = _with_index(key)
        key_node, k2 = _trace_inner_fn(kf, [elem_t, IntegerType], declared=2)
        proj = _with_index(by if by is not None else (lambda el: el))
        _n, p_t = _trace_inner_fn(proj, [elem_t, IntegerType], declared=2)
        target = _lift(value, hint=p_t)
        if target.east_type != p_t:
            raise KernelTraceError(
                f".{op}() value is {target.east_type.type} but the projection "
                f"yields {p_t.type} — they must be the same East type")
        pair_t = _StructType([("i", IntegerType), ("k", k2)])
        # Bind the target to a Let first: the probe lives INSIDE the per-element
        # callback, so an expression target spliced in would be recomputed per
        # element — the same O(N^2) trap `find_all` documents.
        tname = _fresh_name()
        bound = self._expr(_var(tname, p_t), p_t)
        node, _o = _trace_inner_fn(
            lambda el, i: where(_lift(proj(el, i)) == bound,
                                _some({"i": i, "k": kf(el, i)}), _none),
            [elem_t, IntegerType], declared=2)
        pairs_t = _ArrayType(pair_t)
        scan = _builtin("ArrayFilterMap", pairs_t, [elem_t, pair_t], [self.ir, node])
        pairs = self._expr(
            _k_block(pairs_t, [ir_let(p_t, _var(tname, p_t), target.ir), scan]), pairs_t)
        groups = self._expr(
            _builtin("ArrayToSet", _SetType(k2), [elem_t, k2], [self.ir, key_node]),
            _SetType(k2))
        return pairs, groups, k2, pair_t

    def group_find_all(self, key: Any, value: Any, by: Any = None) -> KernelExpr:
        """Traced indices of every element equal to ``value``, per group.

        Every group the array has appears: one with no match maps to an EMPTY
        array, not a missing key (eager and TS ``groupFindAll`` parity).
        """
        from east.types.types import ArrayType as _ArrayType

        self._array_elem("group_find_all")
        idx_t = _ArrayType(IntegerType)

        def build(recv: KernelExpr) -> KernelExpr:
            pairs, groups, _k2, _pair_t = recv._find_index_pairs(
                "group_find_all", key, value, by)
            found = pairs.group_to_arrays(lambda p: p.k, lambda p: p.i)
            return found.get_keys(
                groups, lambda _k: self._expr(_k_new_array(idx_t, []), idx_t))

        # the receiver is scanned twice (matches, and the group set), so bind it
        return self._with_bound_receiver(build)

    def group_find_first(self, key: Any, value: Any, by: Any = None) -> KernelExpr:
        """Traced ``some(first matching index)`` per group, ``none`` for a group
        with no match (TS parity).

        ``group_find_all`` already yields matches in row order within a group,
        so the first is element 0.
        """
        return self.group_find_all(key, value, by).map(lambda idxs: idxs.try_get(0))

    def _group_find_extreme(self, op: str, key: Any, by: Any, want_max: bool) -> KernelExpr:
        """Index of each group's extreme, via ArrayToDict over ``{by, index}``.

        The collision handler compares NON-STRICTLY, so the incumbent (earlier)
        pair wins a tie and the reported index is the EARLIEST extreme —
        matching the eager ``_group_extreme_combine`` and TS.
        """
        from east.types.types import DictType as _DictType

        elem_t = self._array_elem(op)
        kf = _with_index(key)
        key_node, k2 = _trace_inner_fn(kf, [elem_t, IntegerType], declared=2)
        proj = _with_index(by if by is not None else (lambda el: el))
        # Take the pair type from the TRACE rather than declaring it, so the
        # struct's field order cannot drift from what the lambda builds.
        val_node, pair_t = _trace_inner_fn(
            lambda el, i: {"by": proj(el, i), "index": i},
            [elem_t, IntegerType], declared=2)
        keep = (lambda a, b: where(a.by >= b.by, a, b)) if want_max \
            else (lambda a, b: where(a.by <= b.by, a, b))
        comb_node, c_out = _trace_inner_fn(
            lambda a, b, _k: keep(a, b), [pair_t, pair_t, k2], declared=3)
        if c_out != pair_t:
            raise KernelTraceError(
                f".{op}() collision handler returns {c_out.type}, pairs are Struct")
        out = _DictType(k2, pair_t)
        pairs = self._expr(
            _builtin("ArrayToDict", out, [elem_t, k2, pair_t],
                     [self.ir, key_node, val_node, comb_node]),
            out,
        )
        return pairs.map(lambda v: v.index)

    def group_find_maximum(self, key: Any, by: Any = None) -> KernelExpr:
        """Traced index of the largest element/projection per group (East total
        order; a tie keeps the earliest index)."""
        return self._group_find_extreme("group_find_maximum", key, by, want_max=True)

    def group_find_minimum(self, key: Any, by: Any = None) -> KernelExpr:
        """Traced index of the smallest element/projection per group."""
        return self._group_find_extreme("group_find_minimum", key, by, want_max=False)
