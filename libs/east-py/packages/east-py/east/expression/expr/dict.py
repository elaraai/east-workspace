#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``DictExpression`` — TS ``DictExpr`` (``libs/east/src/expr/dict.ts``).

Every method emits the Dict builtin its TypeScript twin emits, with the
same type parameters and argument order. Callbacks take the block first and
receive ``(value, key)``; a fold step receives ``(acc, value, key)`` —
exactly the TypeScript callback signatures, so a program ported name for
name keeps its parameter order.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError, _trace_bail
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
from east.ir.builders import ir_error, ir_let
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
    from east.expression.expr.float import FloatExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.null import NullExpression
    from east.expression.expr.set import SetExpression
    from east.expression.expr.variant import VariantExpression

class DictExpression(Expression):
    """A Dict-typed expression: keyed reads, the callback transforms, folds,
    reductions, grouping and in-place mutation."""

    __slots__ = ()
    _kind = "Dict"

    # ── plumbing ────────────────────────────────────────────────────────

    def _key(self) -> EastType:
        return self.east_type.value["key"]

    def _value(self) -> EastType:
        return self.east_type.value["value"]

    def _callback(self, fn: Any, out_hint: EastType | None = None, wrap: Any = None) -> tuple:
        """Trace a ``(value, key)`` callback against the builtin's slot."""
        return _trace_inner_fn(fn, [self._value(), self._key()], out_hint=out_hint, wrap=wrap)

    def _step(self, fn: Any, acc_t: EastType) -> tuple:
        """Trace an ``(acc, value, key)`` fold step against the builtin's slot."""
        return _trace_inner_fn(fn, [acc_t, self._value(), self._key()], out_hint=acc_t)

    def _projection(self, fn: Any) -> tuple:
        """``(body, its traced type)`` of an entry projection (the value when
        omitted) — callable from a composing lambda with ``(b, value, key)``."""
        p = _body(fn if fn is not None else (lambda _b, v: v))
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

    def _missing_key_node(self, v_t: EastType, k_t: EastType) -> Any:
        """The ``merge`` default for an absent key: an initial handler that
        RAISES ``Key <key> not found in dictionary`` — TypeScript's default,
        byte for byte (a String key prints bare)."""
        ck = _var(_fresh_name(), k_t)
        printed = ck if k_t.type == "String" else _builtin("Print", StringType, [k_t], [ck])
        msg = _builtin(
            "StringConcat", StringType, [],
            [_builtin("StringConcat", StringType, [], [_literal("Key ", StringType), printed]),
             _literal(" not found in dictionary", StringType)],
        )
        return _k_function(FunctionType([k_t], v_t), [], [ck], ir_error(NeverType, msg, _loc_id()))

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

    def _value_callback(self, fn: Any, params: list, out_t: EastType) -> Any:
        """A callback that must return the dict's value type (the mutators'
        producers and updaters)."""
        node, got = _trace_inner_fn(fn, params, out_hint=out_t)
        if got != out_t and got.type != "Never":
            raise ExpressionError(
                f"callback returns {got.type}, the builtin expects {out_t.type}")
        return node

    # ── reads ───────────────────────────────────────────────────────────

    def size(self) -> IntegerExpression:
        """Traced DictSize."""
        return self._expr(
            _builtin("DictSize", IntegerType, [self._key(), self._value()], [self.ir]), IntegerType)

    def has(self, key: Any) -> BooleanExpression:
        """Traced DictHas."""
        k = _lift(key, hint=self._key())
        return self._expr(
            _builtin("DictHas", BooleanType, [self._key(), self._value()], [self.ir, k.ir]),
            BooleanType)

    def get(self, key: Any, default_fn: Any = None) -> Expression:
        """Traced DictGet: the value at ``key`` (an East runtime error when
        absent) — or DictGetOrDefault with ``default_fn(b, key)`` producing
        the value for an absent key (TS ``get(key, onMissing?)``)."""
        k_t, v_t = self._key(), self._value()
        k = _lift(key, hint=k_t)
        if default_fn is not None:
            node, out_t = _trace_inner_fn(default_fn, [k_t], out_hint=v_t)
            if out_t != v_t:
                raise ExpressionError(
                    f".get() default returns {out_t.type}, values are {v_t.type}")
            return self._expr(
                _builtin("DictGetOrDefault", v_t, [k_t, v_t], [self.ir, k.ir, node]), v_t)
        return self._expr(_builtin("DictGet", v_t, [k_t, v_t], [self.ir, k.ir]), v_t)

    def get_or_default(self, key: Any, default: Any) -> Expression:
        """Traced DictGetOrDefault: the value at ``key``, or ``default`` when
        absent — ``get(key, lambda b, k: default)``, the constant handler
        traced like any other so the two spellings build one IR."""
        d = _lift(default, hint=self._value())
        return self.get(key, lambda _b, _k: d)

    def try_get(self, key: Any) -> VariantExpression:
        """Traced DictTryGet: ``some(value)`` when present, else ``none``."""
        k_t, v_t = self._key(), self._value()
        k = _lift(key, hint=k_t)
        out = _option_type(v_t)
        return self._expr(_builtin("DictTryGet", out, [k_t, v_t], [self.ir, k.ir]), out)

    def __getitem__(self, name: Any) -> Expression:
        if isinstance(name, slice):
            raise _trace_bail(f"[{name!r}] indexing")
        # `table[key_expr]` — same as .get() (#393). Dict keys are real keys,
        # so a negative Integer key stays legal here.
        return self.get(name)

    def copy(self) -> DictExpression:
        """Traced DictCopy (shallow)."""
        return self._expr(
            _builtin("DictCopy", self.east_type, [self._key(), self._value()], [self.ir]),
            self.east_type)

    def keys(self) -> SetExpression:
        """Traced DictKeys: this dict's keys as a Set (TS ``keys``)."""
        out = SetType(self._key())
        return self._expr(
            _builtin("DictKeys", out, [self._key(), self._value()], [self.ir]), out)

    keys_set = _deprecated_alias("keys_set", "keys")

    def get_keys(self, keys: Any, fill: Any) -> DictExpression:
        """Traced DictGetKeys: the entries at a ``Set`` of keys, with
        ``fill(key)`` producing the value for an absent one."""
        k_t, v_t = self._key(), self._value()
        ks = _lift(keys)
        if ks.east_type != SetType(k_t):
            raise ExpressionError(".get_keys() takes a Set of this dict's key type")
        fill_node, f_out = _trace_inner_fn(fill, [k_t], out_hint=v_t)
        if f_out != v_t:
            raise ExpressionError(
                f".get_keys() fill returns {f_out.type}, values are {v_t.type}")
        return self._expr(
            _builtin("DictGetKeys", self.east_type, [k_t, v_t], [self.ir, ks.ir, fill_node]),
            self.east_type,
        )

    # ── callback transforms ─────────────────────────────────────────────

    def map(self, fn: Any, out: EastType | None = None) -> DictExpression:
        """Traced DictMap: the keys kept, the values mapped by
        ``fn(value)`` (``fn(value, key)`` also accepted). ``out`` pins the
        mapped value type AND types the callback's trace (#536)."""
        k_t, v_t = self._key(), self._value()
        node, out_t = _trace_inner_fn(fn, [v_t, k_t], out_hint=out)
        self._check_out(".map()", out_t, out)
        out_d = DictType(k_t, out_t)
        return self._expr(_builtin("DictMap", out_d, [k_t, v_t, out_t], [self.ir, node]), out_d)

    def filter(self, fn: Any) -> DictExpression:
        """Traced DictFilter: keep the entries where ``fn(value, key)`` holds."""
        node, out_t = self._callback(fn, out_hint=BooleanType)
        if out_t.type != "Boolean":
            raise ExpressionError(f".filter() predicate must return Boolean, got {out_t.type}")
        return self._expr(
            _builtin("DictFilter", self.east_type, [self._key(), self._value()], [self.ir, node]),
            self.east_type,
        )

    def filter_map(self, fn: Any, out: EastType | None = None) -> DictExpression:
        """Traced DictFilterMap: the kept keys mapped to the unwrapped
        ``some`` value ``fn(value, key)`` produces. ``out`` pins the kept
        value type (#536)."""
        k_t, v_t = self._key(), self._value()
        hint = _option_type(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if not _is_option(out_t):
            raise ExpressionError(f"callback must return some(...)/none, got {out_t.type}")
        inner_t = _option_inner(out_t)
        self._check_out(".filter_map()", inner_t, out)
        out_d = DictType(k_t, inner_t)
        return self._expr(
            _builtin("DictFilterMap", out_d, [k_t, v_t, inner_t], [self.ir, node]), out_d)

    def first_map(self, fn: Any, out: EastType | None = None) -> VariantExpression:
        """Traced DictFirstMap: the first ``some(value)`` that
        ``fn(value, key)`` produces — the scan stops at the first ``some``
        (#403). ``out`` pins the ``some`` payload type when the lambda alone
        cannot."""
        k_t, v_t = self._key(), self._value()
        hint = _option_type(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if not _is_option(out_t):
            raise ExpressionError(
                f".first_map() lambda must return some(...)/none, got {out_t.type}")
        inner_t = _option_inner(out_t)
        return self._expr(
            _builtin("DictFirstMap", out_t, [k_t, v_t, inner_t], [self.ir, node]), out_t)

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> ArrayExpression:
        """Traced DictFlattenToArray (TS ``flattenToArray`` — only an Array
        spells it ``flatMap``): concatenate the arrays ``fn(value, key)``
        produces per entry. ``out`` pins the flattened ELEMENT type (#536)."""
        k_t, v_t = self._key(), self._value()
        hint = ArrayType(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if out_t.type != "Array":
            raise ExpressionError(
                f".flatten_to_array() callback must return an Array, got {out_t.type}")
        inner_t = out_t.value
        self._check_out(".flatten_to_array()", inner_t, out)
        out_a = ArrayType(inner_t)
        return self._expr(
            _builtin("DictFlattenToArray", out_a, [k_t, v_t, inner_t], [self.ir, node]), out_a)

    flat_map = _deprecated_alias("flat_map", "flatten_to_array")

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> SetExpression:
        """Traced DictFlattenToSet: union the sets ``fn(value, key)`` produces.
        ``out`` pins the flattened ELEMENT type (#536)."""
        k_t, v_t = self._key(), self._value()
        hint = SetType(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if out_t.type != "Set":
            raise ExpressionError(
                f".flatten_to_set() callback must return a Set, got {out_t.type}")
        inner_t = out_t.value
        self._check_out(".flatten_to_set()", inner_t, out)
        out_s = SetType(inner_t)
        return self._expr(
            _builtin("DictFlattenToSet", out_s, [k_t, v_t, inner_t], [self.ir, node]), out_s)

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> DictExpression:
        """Traced DictFlattenToDict: merge the dicts ``fn(value, key)``
        produces. Without ``combine`` a key produced by two different entries
        errors, matching the eager method and TS; with it, collisions resolve
        as ``combine(existing, incoming)`` (a third parameter receives the
        key)."""
        k_t, v_t = self._key(), self._value()
        node, out_t = self._callback(fn)
        if out_t.type != "Dict":
            raise ExpressionError(
                f".flatten_to_dict() callback must return a Dict, got {out_t.type}")
        k2, v2 = out_t.value["key"], out_t.value["value"]
        combine_node = self._combine_node("flatten_to_dict", combine, v2, k2)
        out = DictType(k2, v2)
        return self._expr(
            _builtin("DictFlattenToDict", out, [k_t, v_t, k2, v2],
                     [self.ir, node, combine_node]),
            out,
        )

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Expression:
        """Traced DictMapReduce: map ``(value, key)``, then pairwise-combine
        (errors at run time on empty). ``out`` pins the mapped type (#536)."""
        k_t, v_t = self._key(), self._value()
        map_node, t2 = self._callback(map_fn, out_hint=out)
        self._check_out(".map_reduce()", t2, out)
        reduce_node, r_out = _trace_inner_fn(reduce_fn, [t2, t2], out_hint=t2)
        if r_out != t2:
            raise ExpressionError(
                f".map_reduce() reduce returns {r_out.type}, mapped values are {t2.type}")
        return self._expr(
            _builtin("DictMapReduce", t2, [k_t, v_t, t2], [self.ir, map_node, reduce_node]), t2)

    def to_array(self, fn: Any = None, out: EastType | None = None, *, key: Any = None) -> ArrayExpression:
        """Traced DictToArray: ``fn(value, key)`` per entry, in key order
        (required). ``out`` pins the projected element type (#536)."""
        k_t, v_t = self._key(), self._value()
        if fn is None and key is not None:
            fn = key
        if fn is None:
            raise ExpressionError(".to_array() on a Dict needs a projection fn(b, value, key)")
        node, t2 = self._callback(fn, out_hint=out)
        self._check_out(".to_array()", t2, out)
        out_a = ArrayType(t2)
        return self._expr(_builtin("DictToArray", out_a, [k_t, v_t, t2], [self.ir, node]), out_a)

    def to_set(self, key: Any = None, out: EastType | None = None) -> SetExpression:
        """Traced DictToSet: the set of ``key(value, key)`` projections
        (required). ``out`` pins the result element type (#525)."""
        if key is None:
            raise ExpressionError(".to_set() on a Dict needs a projection fn(b, value, key)")
        k_t, v_t = self._key(), self._value()
        node, k2 = self._callback(key)
        self._check_out(".to_set()", k2, out)
        out_s = SetType(k2)
        return self._expr(_builtin("DictToSet", out_s, [k_t, v_t, k2], [self.ir, node]), out_s)

    def to_dict(self, key: Any, value: Any = None, combine: Any = None,
                key_out: EastType | None = None,
                value_out: EastType | None = None) -> DictExpression:
        """Traced DictToDict: re-key with ``key(value, key)`` /
        ``value(value, key)`` (the value itself when omitted). Without
        ``combine`` a duplicate key ERRORS, like the eager method and
        TypeScript (#525)."""
        k_t, v_t = self._key(), self._value()
        key_node, k2 = self._callback(key, out_hint=key_out)
        val_node, t2 = self._callback(
            value if value is not None else (lambda _b, v: v), out_hint=value_out)
        self._check_out(".to_dict() key", k2, key_out)
        self._check_out(".to_dict() value", t2, value_out)
        combine_node = self._combine_node("to_dict", combine, t2, k2)
        out = DictType(k2, t2)
        return self._expr(
            _builtin("DictToDict", out, [k_t, v_t, k2, t2],
                     [self.ir, key_node, val_node, combine_node]),
            out,
        )

    def union(self, other: Any, combine: Any = None) -> DictExpression:
        """Traced pure whole-dict union — the twin of the eager
        ``EastDict.union`` (#527), composed the same way: a ``DictCopy``
        bound to a ``Let``, then ``DictUnionInPlace`` into that copy, so
        neither input is modified. Without ``combine`` a key present in both
        errors, exactly as eager and TS's ``unionInPlace`` do."""
        k_t, v_t = self._key(), self._value()
        o = self._same_typed("union", other)
        if combine is None:
            merge_node = self._key_error_node(v_t, k_t, "Key ", " exists in both dictionaries")
        else:
            merge_node, c_out = _trace_inner_fn(combine, [v_t, v_t, k_t], out_hint=v_t)
            if c_out != v_t:
                raise ExpressionError(
                    f".union() combine returns {c_out.type}, values are {v_t.type}")
        name = _fresh_name()
        result = _var(name, self.east_type)
        copy = _builtin("DictCopy", self.east_type, [k_t, v_t], [self.ir])
        merged = _builtin("DictUnionInPlace", NullType, [k_t, v_t], [result, o.ir, merge_node])
        return self._expr(
            _k_block(self.east_type,
                     [ir_let(self.east_type, _var(name, self.east_type), copy, _loc_id()),
                      merged, result]),
            self.east_type,
        )

    # ── folds ───────────────────────────────────────────────────────────

    def reduce(self, fn: Any, init: Any) -> Expression:
        """Traced DictReduce: fold every entry into one accumulator, in key
        order, with ``fn(acc, value, key)`` from ``init`` (TS ``reduce(fn, init)``)."""
        fn, init = _fn_init("reduce", fn, init)
        k_t, v_t = self._key(), self._value()
        init = _lift(init)
        acc_t = init.east_type
        node, out_t = self._step(fn, acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".reduce() step returns {out_t.type}, accumulator is {acc_t.type}")
        return self._expr(
            _builtin("DictReduce", acc_t, [k_t, v_t, acc_t], [self.ir, node, init.ir]), acc_t)

    def scan(self, fn: Any, init: Any) -> ArrayExpression:
        """Traced DictScan: an Array of every intermediate accumulator, one
        per entry in key order — the seed is not emitted; the last element
        equals :meth:`reduce`; the step is ``fn(acc, value, key)`` (TS
        ``scan(fn, init)``)."""
        fn, init = _fn_init("scan", fn, init)
        k_t, v_t = self._key(), self._value()
        init = _lift(init)
        acc_t = init.east_type
        node, out_t = self._step(fn, acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".scan() step returns {out_t.type}, accumulator is {acc_t.type}")
        out = ArrayType(acc_t)
        return self._expr(
            _builtin("DictScan", out, [k_t, v_t, acc_t], [self.ir, node, init.ir]), out)

    # ── quantifiers ─────────────────────────────────────────────────────

    def some(self, pred: Any = None) -> BooleanExpression:
        """Traced any-entry predicate ``pred(value, key)`` (native
        short-circuiting FirstMap scan). Without ``pred`` the VALUES must be
        Boolean (#536)."""
        return self._quantifier("some", pred)

    def every(self, pred: Any = None) -> BooleanExpression:
        """Traced all-entries predicate ``pred(value, key)`` (native
        short-circuiting FirstMap scan). Without ``pred`` the VALUES must be
        Boolean (#536)."""
        return self._quantifier("every", pred)

    def _quantifier(self, op: str, fn: Any) -> BooleanExpression:
        """some/every as a DictFirstMap probe that yields ``some(True)`` on
        the deciding entry — the scan short-circuits like the eager path (#403)."""
        want = op == "some"
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        k_t, v_t = self._key(), self._value()
        if fn is None:
            if v_t.type != "Boolean":
                raise ExpressionError(
                    f".{op}() without a predicate needs Boolean values, got {v_t.type}")
            fn = lambda _b, v: v  # noqa: E731

        def decide(raw: Any) -> Any:
            pred: Any = _lift(raw)
            if pred.east_type.type != "Boolean":
                raise ExpressionError(
                    f".{op}() predicate must return Boolean, got {pred.east_type.type}")
            decided = pred if want else ~pred
            return if_else(decided, _some(True), _none)

        node, out_t = self._callback(fn, wrap=decide)
        scanned = self._expr(
            _builtin("DictFirstMap", out_t, [k_t, v_t, BooleanType], [self.ir, node]), out_t)
        return scanned.is_some() if want else scanned.is_none()

    # ── reductions (#525 phase 1) ───────────────────────────────────────

    def sum(self, fn: Any = None) -> Expression:
        """Traced sum of the values, or of ``fn(value, key)`` over the
        entries; the zero is typed from the projection."""
        proj, t2 = self._numeric_projection("sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self.reduce(lambda b, acc, v, k: acc + proj(b, v, k), zero)

    def mean(self, fn: Any = None) -> FloatExpression:
        """Traced arithmetic mean as a Float (an Integer projection widens
        per entry; an empty dict yields NaN)."""
        proj, t2 = self._numeric_projection("mean", fn)
        widen = t2.type == "Integer"

        def as_float(value: Any) -> Any:
            lifted = _lift(value)
            return lifted.to_float() if widen else lifted

        return self._with_bound_receiver(
            lambda recv: recv.reduce(lambda b, acc, v, k: acc + as_float(proj(b, v, k)), 0.0)
            / recv.size().to_float())

    # ── group_* (#525 phase 3) ──────────────────────────────────────────

    def _group_fold(self, op: str, key: Any, init: Any, fold: Any,
                    key_out: EastType | None = None,
                    acc_out: EastType | None = None) -> DictExpression:
        """The DictGroupFold behind every ``group_*`` method: key
        ``(value, key)``, init ``(group_key)``, fold ``(acc, value, key)``."""
        k_t, v_t = self._key(), self._value()
        key_node, k2 = self._callback(key, out_hint=key_out)
        self._check_out(f".{op}() key", k2, key_out)
        init_node, acc_t = _trace_inner_fn(init, [k2], out_hint=acc_out)
        self._check_out(f".{op}() accumulator", acc_t, acc_out)
        fold_node, out_t = self._step(fold, acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".{op}() step returns {out_t.type}, the accumulator from "
                f"init() is {acc_t.type}"
            )
        out = DictType(k2, acc_t)
        return self._expr(
            _builtin("DictGroupFold", out, [k_t, v_t, k2, acc_t],
                     [self.ir, key_node, init_node, fold_node]),
            out,
        )

    def group_reduce(self, key: Any, init: Any, fold: Any,
                     key_out: EastType | None = None,
                     acc_out: EastType | None = None) -> DictExpression:
        """Traced DictGroupFold: a Dict from the group key to the value
        ``fold(acc, value, key)`` accumulates from ``init(group_key)`` (#535)."""
        return self._group_fold("group_reduce", key, init, fold, key_out, acc_out)

    def group_fold(self, key: Any, init: Any, fold: Any,
                   key_out: EastType | None = None,
                   acc_out: EastType | None = None) -> DictExpression:
        """Deprecated alias for :meth:`group_reduce` (issue #535)."""
        import warnings

        warnings.warn(
            "EastDict.group_fold is deprecated: the grouped fold is spelled "
            "group_reduce on every container (TS groupReduce). See issue #535.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self._group_fold("group_fold", key, init, fold, key_out, acc_out)

    def group_size(self, key: Any) -> DictExpression:
        """Traced count per group key."""
        if key is None:
            raise ExpressionError(
                ".group_size() on a Dict needs a key function — only an Array "
                "defaults to the identity key")
        return self._group_fold("group_size", key, lambda _b, _gk: 0,
                                lambda _b, acc, _v, _k: acc + 1)

    def group_sum(self, key: Any, fn: Any = None) -> DictExpression:
        """Traced sum per group of ``fn(value, key)`` — the VALUES when omitted."""
        proj, t2 = self._numeric_projection("group_sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self._group_fold("group_sum", key, lambda _b, _gk: zero,
                                lambda b, acc, v, k: acc + proj(b, v, k))

    def group_every(self, key: Any, pred: Any) -> DictExpression:
        """Traced per group: True when ``pred(value, key)`` holds for every member."""
        p = _body(pred)
        return self._group_fold("group_every", key, lambda _b, _gk: True,
                                lambda b, acc, v, k: acc & _lift(p(b, v, k)))

    def group_some(self, key: Any, pred: Any) -> DictExpression:
        """Traced per group: True when ``pred(value, key)`` holds for any member."""
        p = _body(pred)
        return self._group_fold("group_some", key, lambda _b, _gk: False,
                                lambda b, acc, v, k: acc | _lift(p(b, v, k)))

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
            lambda b, acc, v, k: {"t": acc.t + as_float(proj(b, v, k)), "n": acc.n + 1},
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

        def step(b: Any, acc: Any, v: Any, k: Any) -> Any:
            val = _lift(proj(b, v, k))
            add = _builtin(add_name, add_out, [v_t], [acc.ir, val.ir])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold(op, key, init, step)

    def group_to_arrays(self, key: Any, value: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced arrays of ``value(value, key)`` per group key (the VALUES
        when omitted). ``value_fn`` is the eager Dict spelling (#536)."""
        return self._group_collect("group_to_arrays", key,
                                   value if value is not None else value_fn, "Array")

    def group_to_sets(self, key: Any, value: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced sets of ``value(value, key)`` per group key; duplicates
        within a group collapse."""
        return self._group_collect("group_to_sets", key,
                                   value if value is not None else value_fn, "Set")

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None,
                       combine: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced nested dicts — ``key2(value, key) -> value(value, key)`` per
        group key. Without ``combine`` a duplicate INNER key errors at run
        time."""
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

        def step(b: Any, acc: Any, v: Any, k: Any) -> Any:
            ik = _lift(k2proj(b, v, k))
            val = _lift(proj(b, v, k))
            add = _builtin(add_name, NullType, [k2_t, v_t], [acc.ir, ik.ir, val.ir, *add_args])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold("group_to_dicts", key, init, step)

    # ── in-place mutation (#578) ────────────────────────────────────────

    def insert(self, key: Any, value: Any) -> NullExpression:
        """Traced DictInsert (yields Null); a key already present is an East
        runtime ERROR — :meth:`insert_or_update` is the tolerant form."""
        kv = self._mutable("insert").value
        k = _lift(key, hint=kv["key"])
        v = _lift(value, hint=kv["value"])
        return self._effect(
            "insert",
            _builtin("DictInsert", NullType, [kv["key"], kv["value"]], [self.ir, k.ir, v.ir]),
            NullType,
        )

    def insert_or_update(self, key: Any, value: Any, combine: Any) -> NullExpression:
        """Traced DictInsertOrUpdate: insert ``value`` at ``key``, or resolve
        a collision as ``combine(b, existing, incoming)`` (a fourth parameter
        receives the key). The counter idiom::

            counts.insert_or_update(sku, 1, lambda b, old, new: old + new)
        """
        kv = self._mutable("insert_or_update").value
        k_t, v_t = kv["key"], kv["value"]
        k = _lift(key, hint=k_t)
        v = _lift(value, hint=v_t)
        node, c_out = _trace_inner_fn(combine, [v_t, v_t, k_t], out_hint=v_t)
        if c_out != v_t:
            raise ExpressionError(
                f".insert_or_update() combine returns {c_out.type}, values are {v_t.type}")
        return self._effect(
            "insert_or_update",
            _builtin("DictInsertOrUpdate", NullType, [k_t, v_t], [self.ir, k.ir, v.ir, node]),
            NullType,
        )

    def delete(self, key: Any) -> NullExpression:
        """Traced DictDelete (yields Null); an absent key is an East runtime
        error — :meth:`try_delete` is the tolerant form."""
        kv = self._mutable("delete").value
        k = _lift(key, hint=kv["key"])
        return self._effect(
            "delete", _builtin("DictDelete", NullType, [kv["key"], kv["value"]], [self.ir, k.ir]),
            NullType)

    def try_delete(self, key: Any) -> BooleanExpression:
        """Traced DictTryDelete, yielding whether anything was removed."""
        kv = self._mutable("try_delete").value
        k = _lift(key, hint=kv["key"])
        return self._effect(
            "try_delete",
            _builtin("DictTryDelete", BooleanType, [kv["key"], kv["value"]], [self.ir, k.ir]),
            BooleanType,
        )

    def clear(self) -> NullExpression:
        """Traced DictClear: drop every entry (yields Null)."""
        kv = self._mutable("clear").value
        return self._effect(
            "clear", _builtin("DictClear", NullType, [kv["key"], kv["value"]], [self.ir]), NullType)

    def update(self, key: Any, value: Any) -> NullExpression:
        """Traced DictUpdate: set the value at an EXISTING key (TS ``update``;
        yields Null)."""
        kv = self._mutable("update").value
        k = self._typed("update", key, kv["key"])
        v = self._typed("update", value, kv["value"])
        return self._effect(
            "update",
            _builtin("DictUpdate", NullType, [kv["key"], kv["value"]], [self.ir, k.ir, v.ir]),
            NullType,
        )

    update_at = _deprecated_alias("update_at", "update")

    def swap(self, key: Any, value: Any) -> Expression:
        """Traced DictSwap: set the value at an existing key, yielding the old one."""
        kv = self._mutable("swap").value
        k = self._typed("swap", key, kv["key"])
        v = self._typed("swap", value, kv["value"])
        return self._effect(
            "swap",
            _builtin("DictSwap", kv["value"], [kv["key"], kv["value"]], [self.ir, k.ir, v.ir]),
            kv["value"],
        )

    def pop(self, key: Any) -> Expression:
        """Traced DictPop: the value at ``key``, removed."""
        kv = self._mutable("pop").value
        k = self._typed("pop", key, kv["key"])
        return self._effect(
            "pop", _builtin("DictPop", kv["value"], [kv["key"], kv["value"]], [self.ir, k.ir]),
            kv["value"])

    def get_or_insert(self, key: Any, producer: Any) -> Expression:
        """Traced DictGetOrInsert: the value at ``key``, inserting
        ``producer(key)`` first when absent."""
        kv = self._mutable("get_or_insert").value
        k = self._typed("get_or_insert", key, kv["key"])
        node = self._value_callback(producer, [kv["key"]], kv["value"])
        return self._effect(
            "get_or_insert",
            _builtin("DictGetOrInsert", kv["value"], [kv["key"], kv["value"]],
                     [self.ir, k.ir, node]),
            kv["value"],
        )

    def merge(self, key: Any, value: Any, update_fn: Any, initial_fn: Any = None) -> NullExpression:
        """Traced DictMerge: fold ``value`` into ``key`` — ``update_fn(existing,
        value, key)`` when the key is present, else insert ``initial_fn(key)``;
        without ``initial_fn`` a missing key is an East runtime error (TS
        ``merge``; yields Null). ``value`` may be of another type."""
        kv = self._mutable("merge").value
        k = self._typed("merge", key, kv["key"])
        v = _lift(value)
        upd = self._value_callback(update_fn, [kv["value"], v.east_type, kv["key"]], kv["value"])
        if initial_fn is None:
            ini = self._missing_key_node(kv["value"], kv["key"])
        else:
            ini = self._value_callback(initial_fn, [kv["key"]], kv["value"])
        return self._effect(
            "merge",
            _builtin("DictMerge", NullType, [kv["key"], kv["value"], v.east_type],
                     [self.ir, k.ir, v.ir, upd, ini]),
            NullType,
        )

    merge_key = _deprecated_alias("merge_key", "merge")

    def merge_all(self, other: Any, update: Any, init: Any) -> NullExpression:
        """Traced DictMergeAll: fold every entry of ``other`` in (yields Null)."""
        kv = self._mutable("merge_all").value
        o = _lift(other)
        if o.east_type.type != "Dict" or o.east_type.value["key"] != kv["key"]:
            raise ExpressionError(".merge_all() takes a Dict with the same key type")
        v2 = o.east_type.value["value"]
        upd = self._value_callback(update, [kv["value"], v2, kv["key"]], kv["value"])
        ini = self._value_callback(init, [kv["key"]], kv["value"])
        return self._effect(
            "merge_all",
            _builtin("DictMergeAll", NullType, [kv["key"], kv["value"], v2],
                     [self.ir, o.ir, upd, ini]),
            NullType,
        )

    def union_in_place(self, other: Any, combine: Any) -> NullExpression:
        """Traced DictUnionInPlace with ``combine(existing, incoming, key)``
        (yields Null)."""
        t = self._mutable("union_in_place")
        kv = t.value
        o = self._typed("union_in_place", other, t)
        if combine is None:
            raise ExpressionError(
                ".union_in_place() on a Dict takes a combine(existing, incoming, key)")
        node = self._value_callback(combine, [kv["value"], kv["value"], kv["key"]], kv["value"])
        return self._effect(
            "union_in_place",
            _builtin("DictUnionInPlace", NullType, [kv["key"], kv["value"]],
                     [self.ir, o.ir, node]),
            NullType,
        )

    def for_each(self, fn: Any) -> NullExpression:
        """Traced DictForEach: run ``fn(value, key)`` per entry for its effect
        (yields Null)."""
        k_t, v_t = self._key(), self._value()
        node, out_t = self._callback(fn)
        return self._effect(
            "for_each",
            _builtin("DictForEach", NullType, [k_t, v_t, out_t], [self.ir, node]), NullType)
