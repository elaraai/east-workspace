#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``SetExpression`` — TS ``SetExpr`` (``libs/east/src/expr/set.ts``).

Every method emits the Set builtin its TypeScript twin emits, with the same
type parameters and argument order. Callbacks take the block first and
receive the element.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.expr.base import Expression, _deprecated_alias, _fn_init
from east.expression.lift import _body, _lift, _trace_inner_fn, if_else
from east.expression.location import location_id as _loc_id
from east.expression.nodes import (
    _builtin,
    _fresh_name,
    _is_option,
    _k_block,
    _k_function,
    _k_new_array,
    _k_new_dict,
    _k_new_set,
    _literal,
    _option_inner,
    _option_type,
    _var,
)
from east.ir.builders import ir_error
from east.types.types import (
    ArrayType,
    BooleanType,
    DictType,
    EastType,
    FunctionType,
    IntegerType,
    NeverType,
    NullType,
    SetType,
    StringType,
)

if TYPE_CHECKING:
    from east.expression.expr.array import ArrayExpression
    from east.expression.expr.boolean import BooleanExpression
    from east.expression.expr.dict import DictExpression
    from east.expression.expr.float import FloatExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.null import NullExpression
    from east.expression.expr.variant import VariantExpression


class SetExpression(Expression):
    """A Set-typed expression: membership, the set algebra, the callback
    transforms, folds, reductions, grouping and in-place mutation."""

    __slots__ = ()
    _kind = "Set"

    # ── plumbing ────────────────────────────────────────────────────────

    def _elem(self) -> EastType:
        return self.east_type.value

    def _callback(self, fn: Any, out_hint: EastType | None = None, wrap: Any = None) -> tuple:
        """Trace an ``(element)`` callback against the builtin's slot."""
        return _trace_inner_fn(fn, [self._elem()], out_hint=out_hint, wrap=wrap)

    def _projection(self, fn: Any) -> tuple:
        """``(python-facing body, its traced type)`` of an element projection
        (the identity when omitted) — callable from a composing lambda with
        ``(b, element)``."""
        p = _body(fn if fn is not None else (lambda _b, el: el))
        _n, t2 = self._callback(p)
        return p, t2

    def _numeric_projection(self, op: str, fn: Any) -> tuple:
        """As :meth:`_projection`, requiring an Integer/Float projection."""
        p, t2 = self._projection(fn)
        if t2.type not in ("Integer", "Float"):
            raise ExpressionError(
                f".{op}() needs a numeric (Integer/Float) projection, got {t2.type}")
        return p, t2

    def _key_error_node(self, t2: EastType, k2: EastType, prefix: str, suffix: str) -> Any:
        """A collision handler that RAISES, naming the offending key — the
        message matches the eager path and TypeScript byte for byte (a
        String key prints bare)."""
        v1 = _var(_fresh_name(), t2)
        v2 = _var(_fresh_name(), t2)
        ck = _var(_fresh_name(), k2)
        printed = ck if k2.type == "String" else _builtin("Print", StringType, [k2], [ck])
        msg = _builtin(
            "StringConcat", StringType, [],
            [_builtin("StringConcat", StringType, [],
                      [_literal(prefix, StringType), printed]),
             _literal(suffix, StringType)],
        )
        # The handler diverges: its Error node is Never-typed, as TypeScript's
        # `$.error` body is — the same IR from either language.
        return _k_function(
            FunctionType([t2, t2, k2], t2), [], [v1, v2, ck], ir_error(NeverType, msg, _loc_id())
        )

    def _combine_node(self, op: str, combine: Any, t2: EastType, k2: EastType) -> Any:
        """A ``(existing, incoming, key)`` collision handler node; the
        erroring default when ``combine`` is omitted (#525)."""
        if combine is None:
            return self._key_error_node(t2, k2, "Cannot insert duplicate key ", " into dict")
        node, c_out = _trace_inner_fn(combine, [t2, t2, k2], out_hint=t2)
        if c_out != t2:
            raise ExpressionError(
                f".{op}() combine returns {c_out.type}, values are {t2.type}")
        return node

    # ── reads ───────────────────────────────────────────────────────────

    def size(self) -> IntegerExpression:
        """Traced SetSize."""
        return self._expr(_builtin("SetSize", IntegerType, [self._elem()], [self.ir]), IntegerType)

    def has(self, element: Any) -> BooleanExpression:
        """Traced SetHas."""
        elem_t = self._elem()
        k = _lift(element, hint=elem_t)
        return self._expr(_builtin("SetHas", BooleanType, [elem_t], [self.ir, k.ir]), BooleanType)

    def copy(self) -> SetExpression:
        """Traced SetCopy (shallow)."""
        return self._expr(
            _builtin("SetCopy", self.east_type, [self._elem()], [self.ir]), self.east_type)

    # ── set algebra ─────────────────────────────────────────────────────

    def _algebra(self, builtin: str, op: str, other: Any) -> SetExpression:
        o = self._same_typed(op, other)
        return self._expr(
            _builtin(builtin, self.east_type, [self._elem()], [self.ir, o.ir]), self.east_type)

    def union(self, other: Any) -> SetExpression:
        """Traced SetUnion."""
        return self._algebra("SetUnion", "union", other)

    def intersection(self, other: Any) -> SetExpression:
        """Traced SetIntersect (TS ``intersection``)."""
        return self._algebra("SetIntersect", "intersection", other)

    def difference(self, other: Any) -> SetExpression:
        """Traced SetDiff: elements in this set but not ``other`` (TS ``difference``)."""
        return self._algebra("SetDiff", "difference", other)

    def symmetric_difference(self, other: Any) -> SetExpression:
        """Traced SetSymDiff: elements in exactly one of the sets (TS
        ``symmetricDifference``)."""
        return self._algebra("SetSymDiff", "symmetric_difference", other)

    def is_subset_of(self, other: Any) -> BooleanExpression:
        """Traced SetIsSubset (TS ``isSubsetOf``)."""
        o = self._same_typed("is_subset_of", other)
        return self._expr(
            _builtin("SetIsSubset", BooleanType, [self._elem()], [self.ir, o.ir]), BooleanType)

    def is_superset_of(self, other: Any) -> BooleanExpression:
        """Traced SetIsSubset with the operands swapped (TS ``isSupersetOf``)."""
        o = self._same_typed("is_superset_of", other)
        return self._expr(
            _builtin("SetIsSubset", BooleanType, [self._elem()], [o.ir, self.ir]), BooleanType)

    def is_disjoint_from(self, other: Any) -> BooleanExpression:
        """Traced SetIsDisjoint (TS ``isDisjointFrom``)."""
        o = self._same_typed("is_disjoint_from", other)
        return self._expr(
            _builtin("SetIsDisjoint", BooleanType, [self._elem()], [self.ir, o.ir]), BooleanType)

    intersect = _deprecated_alias("intersect", "intersection")
    diff = _deprecated_alias("diff", "difference")
    sym_diff = _deprecated_alias("sym_diff", "symmetric_difference")
    is_subset = _deprecated_alias("is_subset", "is_subset_of")
    is_disjoint = _deprecated_alias("is_disjoint", "is_disjoint_from")

    # ── callback transforms ─────────────────────────────────────────────

    def map(self, fn: Any, out: EastType | None = None) -> DictExpression:
        """Traced SetMap: a Dict from each element to ``fn(element)``. ``out``
        pins the mapped value type AND types the callback's trace (#536)."""
        elem_t = self._elem()
        node, out_t = self._callback(fn, out_hint=out)
        self._check_out(".map()", out_t, out)
        out_d = DictType(elem_t, out_t)
        return self._expr(_builtin("SetMap", out_d, [elem_t, out_t], [self.ir, node]), out_d)

    def filter(self, fn: Any) -> SetExpression:
        """Traced SetFilter: keep the elements the predicate accepts."""
        node, out_t = self._callback(fn, out_hint=BooleanType)
        if out_t.type != "Boolean":
            raise ExpressionError(f".filter() predicate must return Boolean, got {out_t.type}")
        return self._expr(
            _builtin("SetFilter", self.east_type, [self._elem()], [self.ir, node]), self.east_type)

    def filter_map(self, fn: Any, out: EastType | None = None) -> DictExpression:
        """Traced SetFilterMap: a Dict from each kept element to the unwrapped
        ``some`` value ``fn`` produces. ``out`` pins the kept value type (#536)."""
        elem_t = self._elem()
        hint = _option_type(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if not _is_option(out_t):
            raise ExpressionError(f"callback must return some(...)/none, got {out_t.type}")
        inner_t = _option_inner(out_t)
        self._check_out(".filter_map()", inner_t, out)
        out_d = DictType(elem_t, inner_t)
        return self._expr(
            _builtin("SetFilterMap", out_d, [elem_t, inner_t], [self.ir, node]), out_d)

    def first_map(self, fn: Any, out: EastType | None = None) -> VariantExpression:
        """Traced SetFirstMap: the first ``some(value)`` that ``fn`` produces
        — the scan stops at the first ``some`` (#403). ``out`` pins the
        ``some`` payload type when the lambda alone cannot."""
        elem_t = self._elem()
        hint = _option_type(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if not _is_option(out_t):
            raise ExpressionError(
                f".first_map() lambda must return some(...)/none, got {out_t.type}")
        inner_t = _option_inner(out_t)
        return self._expr(
            _builtin("SetFirstMap", out_t, [elem_t, inner_t], [self.ir, node]), out_t)

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> ArrayExpression:
        """Traced SetFlattenToArray (TS ``flattenToArray`` — only an Array
        spells it ``flatMap``): concatenate the arrays ``fn`` produces per
        element. ``out`` pins the flattened ELEMENT type (#536)."""
        elem_t = self._elem()
        hint = ArrayType(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if out_t.type != "Array":
            raise ExpressionError(
                f".flatten_to_array() callback must return an Array, got {out_t.type}")
        inner_t = out_t.value
        self._check_out(".flatten_to_array()", inner_t, out)
        out_a = ArrayType(inner_t)
        return self._expr(
            _builtin("SetFlattenToArray", out_a, [elem_t, inner_t], [self.ir, node]), out_a)

    flat_map = _deprecated_alias("flat_map", "flatten_to_array")

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> SetExpression:
        """Traced SetFlattenToSet: union the sets ``fn`` produces. ``out``
        pins the flattened ELEMENT type (#536)."""
        elem_t = self._elem()
        hint = SetType(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if out_t.type != "Set":
            raise ExpressionError(
                f".flatten_to_set() callback must return a Set, got {out_t.type}")
        inner_t = out_t.value
        self._check_out(".flatten_to_set()", inner_t, out)
        out_s = SetType(inner_t)
        return self._expr(
            _builtin("SetFlattenToSet", out_s, [elem_t, inner_t], [self.ir, node]), out_s)

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> DictExpression:
        """Traced SetFlattenToDict: merge the dicts ``fn`` produces. Without
        ``combine`` a key produced by two different elements errors, matching
        the eager method and TS; with it, collisions resolve as
        ``combine(existing, incoming)`` (a third parameter receives the key)."""
        elem_t = self._elem()
        node, out_t = self._callback(fn)
        if out_t.type != "Dict":
            raise ExpressionError(
                f".flatten_to_dict() callback must return a Dict, got {out_t.type}")
        k2, v2 = out_t.value["key"], out_t.value["value"]
        combine_node = self._combine_node("flatten_to_dict", combine, v2, k2)
        out = DictType(k2, v2)
        return self._expr(
            _builtin("SetFlattenToDict", out, [elem_t, k2, v2], [self.ir, node, combine_node]),
            out,
        )

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Expression:
        """Traced SetMapReduce: map, then pairwise-combine (errors at run time
        on empty). ``out`` pins the mapped type (#536)."""
        elem_t = self._elem()
        map_node, t2 = self._callback(map_fn, out_hint=out)
        self._check_out(".map_reduce()", t2, out)
        reduce_node, r_out = _trace_inner_fn(reduce_fn, [t2, t2], out_hint=t2)
        if r_out != t2:
            raise ExpressionError(
                f".map_reduce() reduce returns {r_out.type}, mapped values are {t2.type}")
        return self._expr(
            _builtin("SetMapReduce", t2, [elem_t, t2], [self.ir, map_node, reduce_node]), t2)

    def to_array(self, fn: Any = None, out: EastType | None = None, *, key: Any = None) -> ArrayExpression:
        """Traced SetToArray: elements (or projections) in East order.
        ``key`` is the eager spelling of the projection; ``out`` pins the
        projected element type (#536)."""
        elem_t = self._elem()
        if fn is None and key is not None:
            fn = key
        node, t2 = self._callback(fn if fn is not None else (lambda _b, el: el), out_hint=out)
        self._check_out(".to_array()", t2, out)
        out_a = ArrayType(t2)
        return self._expr(_builtin("SetToArray", out_a, [elem_t, t2], [self.ir, node]), out_a)

    def to_set(self, key: Any = None, out: EastType | None = None) -> SetExpression:
        """Traced SetToSet: the set of projections. ``out`` pins the result
        element type (#525)."""
        if key is None:
            raise ExpressionError(".to_set() on a Set needs a projection fn(element)")
        elem_t = self._elem()
        node, k2 = self._callback(key)
        self._check_out(".to_set()", k2, out)
        out_s = SetType(k2)
        return self._expr(_builtin("SetToSet", out_s, [elem_t, k2], [self.ir, node]), out_s)

    def to_dict(self, key: Any, value: Any = None, combine: Any = None,
                key_out: EastType | None = None,
                value_out: EastType | None = None) -> DictExpression:
        """Traced SetToDict: keyed by ``key(element)`` with
        ``value(element)``. Without ``combine`` a duplicate key ERRORS, like
        the eager method and TypeScript (#525)."""
        if value is None:
            raise ExpressionError(".to_dict() on a Set needs a value fn(element)")
        elem_t = self._elem()
        key_node, k2 = self._callback(key, out_hint=key_out)
        val_node, t2 = self._callback(value, out_hint=value_out)
        self._check_out(".to_dict() key", k2, key_out)
        self._check_out(".to_dict() value", t2, value_out)
        combine_node = self._combine_node("to_dict", combine, t2, k2)
        out = DictType(k2, t2)
        return self._expr(
            _builtin("SetToDict", out, [elem_t, k2, t2],
                     [self.ir, key_node, val_node, combine_node]),
            out,
        )

    # ── folds ───────────────────────────────────────────────────────────

    def reduce(self, fn: Any, init: Any) -> Expression:
        """Traced SetReduce: fold every element into one accumulator, in East
        order, with ``fn(acc, element)`` from ``init`` (TS ``reduce(fn, init)``)."""
        fn, init = _fn_init("reduce", fn, init)
        elem_t = self._elem()
        init = _lift(init)
        acc_t = init.east_type
        node, out_t = _trace_inner_fn(fn, [acc_t, elem_t], out_hint=acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".reduce() step returns {out_t.type}, accumulator is {acc_t.type}")
        return self._expr(
            _builtin("SetReduce", acc_t, [elem_t, acc_t], [self.ir, node, init.ir]), acc_t)

    def scan(self, fn: Any, init: Any) -> ArrayExpression:
        """Traced SetScan: an Array of every intermediate accumulator, one per
        element in East order — the seed is not emitted; the last element
        equals :meth:`reduce` (TS ``scan(fn, init)``)."""
        fn, init = _fn_init("scan", fn, init)
        elem_t = self._elem()
        init = _lift(init)
        acc_t = init.east_type
        node, out_t = _trace_inner_fn(fn, [acc_t, elem_t], out_hint=acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".scan() step returns {out_t.type}, accumulator is {acc_t.type}")
        out = ArrayType(acc_t)
        return self._expr(
            _builtin("SetScan", out, [elem_t, acc_t], [self.ir, node, init.ir]), out)

    # ── quantifiers ─────────────────────────────────────────────────────

    def some(self, pred: Any = None) -> BooleanExpression:
        """Traced any-element predicate (native short-circuiting FirstMap
        scan). Without ``pred`` the elements must be Boolean (#536)."""
        return self._quantifier("some", pred)

    def every(self, pred: Any = None) -> BooleanExpression:
        """Traced all-elements predicate (native short-circuiting FirstMap
        scan). Without ``pred`` the elements must be Boolean (#536)."""
        return self._quantifier("every", pred)

    def _quantifier(self, op: str, fn: Any) -> BooleanExpression:
        """some/every as a SetFirstMap probe that yields ``some(True)`` on the
        deciding element — the scan short-circuits like the eager path (#403)."""
        want = op == "some"
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        elem_t = self._elem()
        if fn is None:
            if elem_t.type != "Boolean":
                raise ExpressionError(
                    f".{op}() without a predicate needs Boolean elements, got {elem_t.type}")
            fn = lambda _b, el: el  # noqa: E731

        def decide(raw: Any) -> Any:
            pred: Any = _lift(raw)
            if pred.east_type.type != "Boolean":
                raise ExpressionError(
                    f".{op}() predicate must return Boolean, got {pred.east_type.type}")
            decided = pred if want else ~pred
            return if_else(decided, _some(True), _none)

        node, out_t = self._callback(fn, wrap=decide)
        scanned = self._expr(
            _builtin("SetFirstMap", out_t, [elem_t, BooleanType], [self.ir, node]), out_t)
        return scanned.is_some() if want else scanned.is_none()

    # ── reductions (#525 phase 1) ───────────────────────────────────────

    def sum(self, fn: Any = None) -> Expression:
        """Traced sum of the elements, or of ``fn(element)`` over them; the
        zero is typed from the projection."""
        proj, t2 = self._numeric_projection("sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self.reduce(lambda b, acc, el: acc + proj(b, el), zero)

    def mean(self, fn: Any = None) -> FloatExpression:
        """Traced arithmetic mean as a Float (an Integer projection widens
        per element; an empty set yields NaN)."""
        proj, t2 = self._numeric_projection("mean", fn)
        widen = t2.type == "Integer"

        def as_float(value: Any) -> Any:
            lifted = _lift(value)
            return lifted.to_float() if widen else lifted

        return self._with_bound_receiver(
            lambda recv: recv.reduce(lambda b, acc, el: acc + as_float(proj(b, el)), 0.0)
            / recv.size().to_float())

    # ── group_* (#525 phase 3) ──────────────────────────────────────────

    def _group_fold(self, op: str, key: Any, init: Any, fold: Any,
                    key_out: EastType | None = None,
                    acc_out: EastType | None = None) -> DictExpression:
        """The SetGroupFold behind every ``group_*`` method: key
        ``(element)``, init ``(group_key)``, fold ``(acc, element)``."""
        elem_t = self._elem()
        key_node, k2 = self._callback(key, out_hint=key_out)
        self._check_out(f".{op}() key", k2, key_out)
        init_node, acc_t = _trace_inner_fn(init, [k2], out_hint=acc_out)
        self._check_out(f".{op}() accumulator", acc_t, acc_out)
        fold_node, out_t = _trace_inner_fn(fold, [acc_t, elem_t], out_hint=acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".{op}() step returns {out_t.type}, the accumulator from "
                f"init() is {acc_t.type}"
            )
        out = DictType(k2, acc_t)
        return self._expr(
            _builtin("SetGroupFold", out, [elem_t, k2, acc_t],
                     [self.ir, key_node, init_node, fold_node]),
            out,
        )

    def group_reduce(self, key: Any, init: Any, fold: Any,
                     key_out: EastType | None = None,
                     acc_out: EastType | None = None) -> DictExpression:
        """Traced SetGroupFold: a Dict from the group key to the value
        ``fold(acc, element)`` accumulates from ``init(group_key)`` (#535)."""
        return self._group_fold("group_reduce", key, init, fold, key_out, acc_out)

    def group_fold(self, key: Any, init: Any, fold: Any,
                   key_out: EastType | None = None,
                   acc_out: EastType | None = None) -> DictExpression:
        """Deprecated alias for :meth:`group_reduce` (issue #535)."""
        import warnings

        warnings.warn(
            "EastSet.group_fold is deprecated: the grouped fold is spelled "
            "group_reduce on every container (TS groupReduce). See issue #535.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self._group_fold("group_fold", key, init, fold, key_out, acc_out)

    def group_size(self, key: Any) -> DictExpression:
        """Traced count per group key."""
        if key is None:
            raise ExpressionError(
                ".group_size() on a Set needs a key function — only an Array "
                "defaults to the identity key")
        return self._group_fold("group_size", key, lambda _b, _gk: 0,
                                lambda _b, acc, _el: acc + 1)

    def group_sum(self, key: Any, fn: Any = None) -> DictExpression:
        """Traced sum per group of ``fn(element)`` — the elements when omitted."""
        proj, t2 = self._numeric_projection("group_sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self._group_fold("group_sum", key, lambda _b, _gk: zero,
                                lambda b, acc, el: acc + proj(b, el))

    def group_every(self, key: Any, pred: Any) -> DictExpression:
        """Traced per group: True when ``pred`` holds for every member."""
        p = _body(pred)
        return self._group_fold("group_every", key, lambda _b, _gk: True,
                                lambda b, acc, el: acc & _lift(p(b, el)))

    def group_some(self, key: Any, pred: Any) -> DictExpression:
        """Traced per group: True when ``pred`` holds for any member."""
        p = _body(pred)
        return self._group_fold("group_some", key, lambda _b, _gk: False,
                                lambda b, acc, el: acc | _lift(p(b, el)))

    def group_mean(self, key: Any, fn: Any = None) -> DictExpression:
        """Traced Float mean per group, ``{t, n}`` accumulated in ONE grouped
        pass and divided at the end."""
        proj, t2 = self._numeric_projection("group_mean", fn)
        widen = t2.type == "Integer"

        def as_float(value: Any) -> Any:
            lifted = _lift(value)
            return lifted.to_float() if widen else lifted

        return self._group_fold(
            "group_mean", key,
            lambda _b, _gk: {"t": 0.0, "n": 0},
            lambda b, acc, el: {"t": acc.t + as_float(proj(b, el)), "n": acc.n + 1},
        ).map(lambda _b, acc: acc.t / acc.n.to_float())

    def _group_collect(self, op: str, key: Any, value: Any, into: str) -> DictExpression:
        """group_to_arrays / group_to_sets: a grouped fold into a COLLECTION,
        the step body hand-built IR (each group's accumulator is created
        fresh by ``init`` and never escapes)."""
        proj, v_t = self._projection(value)
        acc_t: EastType
        if into == "Array":
            acc_t = ArrayType(v_t)
            empty: Any = _k_new_array
            add_name, add_out = "ArrayPushLast", NullType
        else:
            acc_t = SetType(v_t)
            empty = _k_new_set
            add_name, add_out = "SetTryInsert", BooleanType

        def init(_b: Any, _gk: Any) -> Any:
            return self._expr(empty(acc_t, []), acc_t)

        def step(b: Any, acc: Any, el: Any) -> Any:
            v = _lift(proj(b, el))
            add = _builtin(add_name, add_out, [v_t], [acc.ir, v.ir])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold(op, key, init, step)

    def group_to_arrays(self, key: Any, value: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced arrays of ``value(element)`` per group key (the elements
        themselves when omitted)."""
        return self._group_collect("group_to_arrays", key,
                                   value if value is not None else value_fn, "Array")

    def group_to_sets(self, key: Any, value: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced sets of ``value(element)`` per group key; duplicates within
        a group collapse."""
        return self._group_collect("group_to_sets", key,
                                   value if value is not None else value_fn, "Set")

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None,
                       combine: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced nested dicts — ``key2(element) -> value(element)`` per group
        key. Without ``combine`` a duplicate INNER key errors at run time."""
        proj, v_t = self._projection(value if value is not None else value_fn)
        k2proj, k2_t = self._projection(key2)
        acc_t = DictType(k2_t, v_t)
        add_args: list = []
        if combine is None:
            add_name = "DictInsert"
        else:
            node, c_out = _trace_inner_fn(combine, [v_t, v_t, k2_t], out_hint=v_t)
            if c_out != v_t:
                raise ExpressionError(
                    f".group_to_dicts() combine returns {c_out.type}, values are {v_t.type}")
            add_name, add_args = "DictInsertOrUpdate", [node]

        def init(_b: Any, _gk: Any) -> Any:
            return self._expr(_k_new_dict(acc_t, []), acc_t)

        def step(b: Any, acc: Any, el: Any) -> Any:
            ik = _lift(k2proj(b, el))
            v = _lift(proj(b, el))
            add = _builtin(add_name, NullType, [k2_t, v_t], [acc.ir, ik.ir, v.ir, *add_args])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold("group_to_dicts", key, init, step)

    # ── in-place mutation (#578) ────────────────────────────────────────

    def insert(self, element: Any) -> NullExpression:
        """Traced SetInsert (yields Null); an element already present is an
        East runtime ERROR — :meth:`try_insert` is the tolerant form."""
        elem_t = self._mutable("insert").value
        k = _lift(element, hint=elem_t)
        return self._effect(
            "insert", _builtin("SetInsert", NullType, [elem_t], [self.ir, k.ir]), NullType)

    def try_insert(self, element: Any) -> BooleanExpression:
        """Traced SetTryInsert: add ``element``, yielding whether it was new."""
        elem_t = self._mutable("try_insert").value
        v = _lift(element, hint=elem_t)
        return self._effect(
            "try_insert", _builtin("SetTryInsert", BooleanType, [elem_t], [self.ir, v.ir]),
            BooleanType)

    def delete(self, element: Any) -> NullExpression:
        """Traced SetDelete (yields Null); an absent element is an East
        runtime error — :meth:`try_delete` is the tolerant form."""
        elem_t = self._mutable("delete").value
        k = _lift(element, hint=elem_t)
        return self._effect(
            "delete", _builtin("SetDelete", NullType, [elem_t], [self.ir, k.ir]), NullType)

    def try_delete(self, element: Any) -> BooleanExpression:
        """Traced SetTryDelete, yielding whether anything was removed."""
        elem_t = self._mutable("try_delete").value
        k = _lift(element, hint=elem_t)
        return self._effect(
            "try_delete", _builtin("SetTryDelete", BooleanType, [elem_t], [self.ir, k.ir]),
            BooleanType)

    def clear(self) -> NullExpression:
        """Traced SetClear: drop every element (yields Null)."""
        elem_t = self._mutable("clear").value
        return self._effect("clear", _builtin("SetClear", NullType, [elem_t], [self.ir]), NullType)

    def union_in_place(self, other: Any) -> NullExpression:
        """Traced SetUnionInPlace (yields Null)."""
        t = self._mutable("union_in_place")
        o = self._typed("union_in_place", other, t)
        return self._effect(
            "union_in_place", _builtin("SetUnionInPlace", NullType, [t.value], [self.ir, o.ir]),
            NullType)

    def for_each(self, fn: Any) -> NullExpression:
        """Traced SetForEach: run ``fn(element)`` per element for its effect
        (yields Null)."""
        elem_t = self._elem()
        node, out_t = self._callback(fn)
        return self._effect(
            "for_each", _builtin("SetForEach", NullType, [elem_t, out_t], [self.ir, node]),
            NullType)
