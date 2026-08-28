#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``ArrayExpression`` — TS ``ArrayExpr`` (``libs/east/src/expr/array.ts``).

Every method emits the Array builtin its TypeScript twin emits, with the
same type parameters and argument order, so a program spelled the same in
both languages builds identical IR. Callbacks take the block first and
receive ``(element, index)``; a body may declare fewer trailing parameters.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError, _trace_bail
from east.expression.expr.base import Expression, _deprecated_alias, _fn_init
from east.expression.lift import _body, _lift, _trace_inner_fn, greatest, if_else, least
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
    BlobType,
    BooleanType,
    DictType,
    EastType,
    FunctionType,
    IntegerType,
    NullType,
    SetType,
    StringType,
    StructType,
    VectorType,
)

if TYPE_CHECKING:
    from east.expression.expr.blob import BlobExpression
    from east.expression.expr.boolean import BooleanExpression
    from east.expression.expr.dict import DictExpression
    from east.expression.expr.float import FloatExpression
    from east.expression.expr.integer import IntegerExpression
    from east.expression.expr.null import NullExpression
    from east.expression.expr.set import SetExpression
    from east.expression.expr.string import StringExpression
    from east.expression.expr.struct import StructExpression
    from east.expression.expr.variant import VariantExpression
    from east.expression.expr.vector import VectorExpression


class ArrayExpression(Expression):
    """An Array-typed expression: reads, the callback transforms, folds,
    reductions, searches, grouping and in-place mutation."""

    __slots__ = ()
    _kind = "Array"

    # ── plumbing ────────────────────────────────────────────────────────

    def _elem(self) -> EastType:
        return self.east_type.value

    def _callback(self, fn: Any, out_hint: EastType | None = None, wrap: Any = None) -> tuple:
        """Trace an ``(element, index)`` callback against the builtin's slot."""
        return _trace_inner_fn(fn, [self._elem(), IntegerType], out_hint=out_hint, wrap=wrap)

    def _projection(self, fn: Any) -> tuple:
        """``(python-facing body, its traced type)`` of an element projection
        (the identity when omitted) — callable from a composing lambda with
        ``(b, element, index)``."""
        p = _body(fn if fn is not None else (lambda _b, el: el))
        _n, t2 = self._callback(p)
        return p, t2

    def _numeric_projection(self, op: str, fn: Any) -> tuple:
        """As :meth:`_projection`, requiring an Integer/Float projection. The
        type comes from TRACING the projection, never from a value — a kernel
        has no data to sample (the #450 single-case-variant trap)."""
        p, t2 = self._projection(fn)
        if t2.type not in ("Integer", "Float"):
            raise ExpressionError(
                f".{op}() needs a numeric (Integer/Float) projection, got {t2.type}")
        return p, t2

    def _identity_node(self) -> Any:
        elem_t = self._elem()
        v = _var(_fresh_name(), elem_t)
        return _k_function(FunctionType([elem_t], elem_t), [], [v], v)

    def _key_error_node(self, t2: EastType, k2: EastType, prefix: str, suffix: str) -> Any:
        """A collision handler that RAISES, naming the offending key.

        The key is printed with the East ``Print`` builtin so the message
        matches the eager path's ``print_east(k, key_type)`` and TypeScript's
        ``Expr.str`… ${key} …``` byte for byte. A String key is emitted BARE:
        ``Print`` would JSON-quote it, and both the eager path and TS leave it
        unquoted.
        """
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
        return _k_function(
            FunctionType([t2, t2, k2], t2), [], [v1, v2, ck], ir_error(t2, msg, _loc_id())
        )

    def _combine_node(self, op: str, combine: Any, t2: EastType, k2: EastType) -> Any:
        """A ``(existing, incoming, key)`` collision handler node. Without
        ``combine`` a duplicate key ERRORS — ``Cannot insert duplicate key …
        into dict`` — like the eager method and TypeScript; keeping the later
        value silently would lose rows without a word (#525)."""
        if combine is None:
            return self._key_error_node(t2, k2, "Cannot insert duplicate key ", " into dict")
        node, c_out = _trace_inner_fn(combine, [t2, t2, k2], out_hint=t2)
        if c_out != t2:
            raise ExpressionError(
                f".{op}() combine returns {c_out.type}, values are {t2.type}")
        return node

    # ── reads ───────────────────────────────────────────────────────────

    def size(self) -> IntegerExpression:
        """Traced ArraySize."""
        return self._expr(_builtin("ArraySize", IntegerType, [self._elem()], [self.ir]), IntegerType)

    def has(self, index: Any) -> BooleanExpression:
        """Traced ArrayHas: whether ``index`` is in bounds."""
        i = _lift(index)
        if i.east_type.type != "Integer":
            raise ExpressionError("Array.has() takes an Integer index")
        return self._expr(
            _builtin("ArrayHas", BooleanType, [self._elem()], [self.ir, i.ir]), BooleanType)

    def get(self, index: Any, default_fn: Any = None) -> Expression:
        """Traced ArrayGet: the element at ``index`` (an East runtime error
        when out of bounds) — or ArrayGetOrDefault with ``default_fn(b,
        index)`` producing the value for an index out of bounds (TS
        ``get(key, defaultFn?)``)."""
        i = _lift(index)
        if i.east_type.type != "Integer":
            raise ExpressionError("Array.get() takes an Integer index")
        elem_t = self._elem()
        if default_fn is not None:
            node, out_t = _trace_inner_fn(default_fn, [IntegerType], out_hint=elem_t)
            if out_t != elem_t:
                raise ExpressionError(
                    f".get() default returns {out_t.type}, elements are {elem_t.type}")
            return self._expr(
                _builtin("ArrayGetOrDefault", elem_t, [elem_t], [self.ir, i.ir, node]), elem_t)
        return self._expr(_builtin("ArrayGet", elem_t, [elem_t], [self.ir, i.ir]), elem_t)

    def at(self, index: Any, default_fn: Any = None) -> Expression:
        """The element at ``index`` (TS ``at`` — the same as :meth:`get`)."""
        return self.get(index, default_fn)

    def length(self) -> IntegerExpression:
        """Traced ArraySize (TS ``length`` — the same as :meth:`size`)."""
        return self.size()

    def get_or_default(self, index: Any, default: Any) -> Expression:
        """Traced ArrayGetOrDefault: the element at ``index``, or ``default``
        when out of bounds — ``get(index, lambda b, i: default)``, the
        constant handler traced like any other so the two spellings build
        one IR."""
        d = _lift(default, hint=self._elem())
        return self.get(index, lambda _b, _i: d)

    def try_get(self, index: Any) -> VariantExpression:
        """Traced ArrayTryGet: ``some(element)`` in bounds, else ``none``."""
        elem_t = self._elem()
        i = _lift(index)
        if i.east_type.type != "Integer":
            raise ExpressionError("Array.try_get() takes an Integer index")
        out = _option_type(elem_t)
        return self._expr(_builtin("ArrayTryGet", out, [elem_t], [self.ir, i.ir]), out)

    def __getitem__(self, name: Any) -> Expression:
        if isinstance(name, slice):
            # `arr[a:b]` — the eager slicing spelling, traced as ArraySlice.
            # Python's from-the-end negatives and steps have no East twin.
            if name.step is not None:
                raise _trace_bail("stepped slice")
            start = name.start if name.start is not None else 0
            if (isinstance(start, int) and start < 0) or \
                    (isinstance(name.stop, int) and name.stop < 0):
                raise _trace_bail("negative slice bound")
            if name.stop is None:
                return self._with_bound_receiver(
                    lambda recv: recv.slice(start, recv.size()))
            return self.slice(start, name.stop)
        if isinstance(name, str):
            raise _trace_bail(f"[{name!r}] indexing")
        # `split(data, FM)[n]` — same as .get() (#393). A literal negative
        # index is python's from-the-end indexing, which has no East twin —
        # ArrayGet(a, -1) is a runtime error, not the last element (#624).
        if isinstance(name, int) and name < 0:
            raise ExpressionError(
                "python's from-the-end indexing (a[-1]) has no East twin — "
                "spell the element you mean, e.g. a.get(a.size() - 1) for "
                "the last element"
            )
        return self.get(name)

    # ── callback transforms (nested bodies traced recursively, #393) ────

    def map(self, fn: Any, out: EastType | None = None) -> ArrayExpression:
        """Traced ArrayMap: the Array of ``fn(element)`` (``fn(element,
        index)`` also accepted). ``out`` pins the mapped element type AND
        types the callback's trace, so the callback can build a general
        variant (#536, #541)."""
        elem_t = self._elem()
        node, out_t = self._callback(fn, out_hint=out)
        self._check_out(".map()", out_t, out)
        out_a = ArrayType(out_t)
        return self._expr(_builtin("ArrayMap", out_a, [elem_t, out_t], [self.ir, node]), out_a)

    def filter(self, fn: Any) -> ArrayExpression:
        """Traced ArrayFilter: keep the elements the predicate accepts."""
        node, out_t = self._callback(fn, out_hint=BooleanType)
        if out_t.type != "Boolean":
            raise ExpressionError(f".filter() predicate must return Boolean, got {out_t.type}")
        return self._expr(
            _builtin("ArrayFilter", self.east_type, [self._elem()], [self.ir, node]),
            self.east_type,
        )

    def filter_map(self, fn: Any, out: EastType | None = None) -> ArrayExpression:
        """Traced ArrayFilterMap: filter+map in one pass — the unwrapped
        ``some`` values ``fn`` produces. ``out`` pins the kept value type and
        types the callback's ``some`` payload (#536)."""
        elem_t = self._elem()
        hint = _option_type(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if not _is_option(out_t):
            raise ExpressionError(f"callback must return some(...)/none, got {out_t.type}")
        inner_t = _option_inner(out_t)
        self._check_out(".filter_map()", inner_t, out)
        out_a = ArrayType(inner_t)
        return self._expr(
            _builtin("ArrayFilterMap", out_a, [elem_t, inner_t], [self.ir, node]), out_a)

    def first_map(self, fn: Any, out: EastType | None = None) -> VariantExpression:
        """Traced ArrayFirstMap: the first ``some(value)`` that ``fn``
        produces — the scan stops at the first ``some`` (#403).

        ``fn`` returns ``some(expr)`` / ``none`` — typically
        ``if_else(pred, some(x), none)``. The result is ``Option<T>``;
        consume it with ``.is_some()`` / ``.unwrap_or()`` / ``.match()``.
        ``out`` pins the ``some`` payload type when the lambda alone cannot
        (e.g. a bare ``none`` arm outside ``if_else``).
        """
        elem_t = self._elem()
        hint = _option_type(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if not _is_option(out_t):
            raise ExpressionError(
                f".first_map() lambda must return some(...)/none, got {out_t.type}")
        inner_t = _option_inner(out_t)
        return self._expr(
            _builtin("ArrayFirstMap", out_t, [elem_t, inner_t], [self.ir, node]), out_t)

    def flat_map(self, fn: Any, out: EastType | None = None) -> ArrayExpression:
        """Traced ArrayFlattenToArray: concatenate the arrays ``fn`` produces
        per element (TS ``flatMap``). ``out`` pins the flattened ELEMENT type
        and types the callback's trace (#536)."""
        elem_t = self._elem()
        hint = ArrayType(out) if out is not None else None
        node, out_t = self._callback(fn, out_hint=hint)
        if out_t.type != "Array":
            raise ExpressionError(
                f".flat_map() callback must return an Array, got {out_t.type}")
        inner_t = out_t.value
        self._check_out(".flat_map()", inner_t, out)
        out_a = ArrayType(inner_t)
        return self._expr(
            _builtin("ArrayFlattenToArray", out_a, [elem_t, inner_t], [self.ir, node]), out_a)

    flatten_to_array = _deprecated_alias("flatten_to_array", "flat_map")

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> SetExpression:
        """Traced ArrayFlattenToSet: union the sets ``fn`` produces. ``out``
        pins the flattened ELEMENT type and types the callback's trace (#536)."""
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
            _builtin("ArrayFlattenToSet", out_s, [elem_t, inner_t], [self.ir, node]), out_s)

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> DictExpression:
        """Traced ArrayFlattenToDict: merge the dicts ``fn`` produces. Without
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
            _builtin("ArrayFlattenToDict", out, [elem_t, k2, v2], [self.ir, node, combine_node]),
            out,
        )

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Expression:
        """Traced ArrayMapReduce: map, then pairwise-combine (errors at run
        time on empty, like the eager method). ``out`` pins the mapped type
        and types the map callback's trace (#536)."""
        elem_t = self._elem()
        map_node, t2 = self._callback(map_fn, out_hint=out)
        self._check_out(".map_reduce()", t2, out)
        reduce_node, r_out = _trace_inner_fn(reduce_fn, [t2, t2], out_hint=t2)
        if r_out != t2:
            raise ExpressionError(
                f".map_reduce() reduce returns {r_out.type}, mapped values are {t2.type}")
        return self._expr(
            _builtin("ArrayMapReduce", t2, [elem_t, t2], [self.ir, map_node, reduce_node]), t2)

    def to_dict(self, key: Any, value: Any = None, combine: Any = None,
                key_out: EastType | None = None,
                value_out: EastType | None = None) -> DictExpression:
        """Traced ArrayToDict: keyed by ``key(element)`` with
        ``value(element)`` (the element itself when omitted). Without
        ``combine`` a duplicate key ERRORS, like the eager method and
        TypeScript. ``key_out`` / ``value_out`` pin the produced key/value
        types and type the projections' traces (#536)."""
        elem_t = self._elem()
        key_node, k2 = self._callback(key, out_hint=key_out)
        val_node, t2 = self._callback(
            value if value is not None else (lambda _b, el: el), out_hint=value_out)
        self._check_out(".to_dict() key", k2, key_out)
        self._check_out(".to_dict() value", t2, value_out)
        combine_node = self._combine_node("to_dict", combine, t2, k2)
        out = DictType(k2, t2)
        return self._expr(
            _builtin("ArrayToDict", out, [elem_t, k2, t2],
                     [self.ir, key_node, val_node, combine_node]),
            out,
        )

    def to_set(self, key: Any = None, out: EastType | None = None) -> SetExpression:
        """Traced ArrayToSet: the set of elements or projections. ``out``
        pins the result element type (the eager keyword, #525)."""
        elem_t = self._elem()
        node, k2 = self._callback(key if key is not None else (lambda _b, el: el))
        self._check_out(".to_set()", k2, out)
        out_s = SetType(k2)
        return self._expr(_builtin("ArrayToSet", out_s, [elem_t, k2], [self.ir, node]), out_s)

    def unique(self) -> SetExpression:
        """Traced distinct elements (ArrayToSet with the identity key)."""
        return self.to_set()

    def to_vector(self) -> VectorExpression:
        """Traced VectorFromArray on an Array of Float/Integer/Boolean
        elements (#601 — the construction seam the sparse builtins need)."""
        elem_t = self._elem()
        if elem_t.type not in ("Float", "Integer", "Boolean"):
            raise ExpressionError(
                f".to_vector() needs Float, Integer or Boolean array "
                f"elements, got {elem_t.type}")
        out_t = VectorType(elem_t)
        return self._expr(_builtin("VectorFromArray", out_t, [elem_t], [self.ir]), out_t)

    def string_join(self, separator: Any) -> StringExpression:
        """Traced ArrayStringJoin over an Array<String>."""
        if self._elem().type != "String":
            raise ExpressionError(".string_join() needs an Array<String>")
        sep = _lift(separator)
        if sep.east_type.type != "String":
            raise ExpressionError(".string_join() separator must be a String")
        return self._expr(
            _builtin("ArrayStringJoin", StringType, [], [self.ir, sep.ir]), StringType)

    def encode_csv(self, config: Any = None, **options: Any) -> BlobExpression:
        """Traced ArrayEncodeCsv: this Array of structs as CSV bytes (TS
        ``encodeCsv``). ``config`` is a ``CsvSerializeConfigType`` value; the
        keyword ``options`` are ``east.serialization.csv.csv_serialize_config``'s."""
        from east.serialization.csv import CsvSerializeConfigType, csv_serialize_config

        elem_t = self._elem()
        if elem_t.type != "Struct":
            raise ExpressionError(".encode_csv() needs an Array of structs (the rows)")
        if config is not None and options:
            raise ExpressionError(".encode_csv() takes a config value OR keyword options, not both")
        cfg = _lift(config if config is not None else csv_serialize_config(**options),
                    hint=CsvSerializeConfigType)
        return self._expr(
            _builtin("ArrayEncodeCsv", BlobType, [elem_t, CsvSerializeConfigType], [self.ir, cfg.ir]),
            BlobType,
        )

    # ── folds ───────────────────────────────────────────────────────────

    def reduce(self, fn: Any, init: Any) -> Expression:
        """Traced ArrayFold: ``fn(acc, element)`` or ``fn(acc, element,
        index)`` from ``init``, left to right (TS ``reduce(fn, init)``)."""
        fn, init = _fn_init("reduce", fn, init)
        elem_t = self._elem()
        seed = _lift(init)
        acc_t = seed.east_type
        node, out_t = _trace_inner_fn(fn, [acc_t, elem_t, IntegerType], out_hint=acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".reduce() step returns {out_t.type}, accumulator is {acc_t.type}")
        return self._expr(
            _builtin("ArrayFold", acc_t, [elem_t, acc_t], [self.ir, seed.ir, node]), acc_t)

    def fold(self, initial: Any, fn: Any) -> Expression:
        """Deprecated alias of :meth:`reduce` (the TypeScript name and
        argument order, ``reduce(fn, init)``)."""
        import warnings

        warnings.warn(
            ".fold(init, fn) is deprecated: the spelling is .reduce(fn, init) "
            "(the TypeScript name and order)",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.reduce(fn, initial)

    def scan(self, fn: Any, init: Any) -> ArrayExpression:
        """Traced ArrayScan: an Array of every intermediate accumulator.
        Element ``i`` is the accumulator AFTER folding element ``i`` — same
        length as the input, the seed is not emitted, and the last element
        equals the matching ``reduce``. The step mirrors ``reduce``'s:
        ``fn(acc, el)`` (+ optional index) (TS ``scan(fn, init)``)."""
        fn, init = _fn_init("scan", fn, init)
        elem_t = self._elem()
        init = _lift(init)
        acc_t = init.east_type
        node, out_t = _trace_inner_fn(fn, [acc_t, elem_t, IntegerType], out_hint=acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".scan() step returns {out_t.type}, accumulator is {acc_t.type}")
        out = ArrayType(acc_t)
        return self._expr(
            _builtin("ArrayScan", out, [elem_t, acc_t], [self.ir, init.ir, node]), out)

    # ── quantifiers ─────────────────────────────────────────────────────

    def some(self, pred: Any = None) -> BooleanExpression:
        """Traced any-element predicate (native short-circuiting FirstMap
        scan). Without ``pred`` the elements must be Boolean, like the eager
        ``some()`` (#536)."""
        return self._quantifier("some", pred)

    def every(self, pred: Any = None) -> BooleanExpression:
        """Traced all-elements predicate (native short-circuiting FirstMap
        scan). Without ``pred`` the elements must be Boolean, like the eager
        ``every()`` (#536)."""
        return self._quantifier("every", pred)

    def _quantifier(self, op: str, fn: Any) -> BooleanExpression:
        """some/every as an ArrayFirstMap probe that yields ``some(True)`` on
        the deciding element — the scan short-circuits exactly like the
        eager ``_first_map_bool`` path (#403)."""
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
            _builtin("ArrayFirstMap", out_t, [elem_t, BooleanType], [self.ir, node]), out_t)
        # some: a deciding element exists; every: no counterexample exists.
        # FirstMap on an empty array yields none, so some([])=False and
        # every([])=True fall out — matching the eager path exactly.
        return scanned.is_some() if want else scanned.is_none()

    # ── reductions (#525 phase 1) ───────────────────────────────────────
    # Hand-rolling these as a fold is where the accidental-quadratic risk
    # lives (#524 measured 6h02m for 729k rows). Every one composes the SAME
    # builtin the eager method uses, so traced and eager agree including
    # float accumulation order.

    def sum(self, fn: Any = None) -> Expression:
        """Traced sum of the elements, or of ``fn(...)`` over them. The zero
        is typed from the projection, so an empty array sums to the
        projection's zero. Without ``fn`` the elements must be Integer or
        Float."""
        proj, t2 = self._numeric_projection("sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self.reduce(lambda b, acc, el, i: acc + proj(b, el, i), zero)

    def mean(self, fn: Any = None) -> FloatExpression:
        """Traced arithmetic mean as a Float. An Integer projection widens
        once per element with IntegerToFloat, so the accumulation happens in
        Float exactly as the eager ``mean`` does; an empty array yields NaN
        (``0.0 / 0.0``)."""
        proj, t2 = self._numeric_projection("mean", fn)
        widen = t2.type == "Integer"

        def as_float(value: Any) -> Any:
            # Lift FIRST: a projection may legitimately return a plain python
            # number (`.mean(lambda b, r: 1)` works eagerly), which has no
            # `.to_float()`.
            lifted = _lift(value)
            return lifted.to_float() if widen else lifted

        # mean touches the receiver twice — the fold and size() — so bind it
        # once (see _with_bound_receiver for why the CSE cannot be relied on
        # inside an inner lambda).
        return self._with_bound_receiver(
            lambda recv: recv.reduce(lambda b, acc, el, i: acc + as_float(proj(b, el, i)), 0.0)
            / recv.size().to_float())

    def _extreme(self, by: Any, keep_first: Any, pick: Any) -> Expression:
        """maximum / minimum as TS composes them: without ``by`` an
        ArrayMapReduce under ``greatest``/``least``; with one, a MapReduce
        over ``{element, key}`` pairs comparing the keys NON-strictly, so a
        tie keeps the first element — and the ELEMENT is returned."""
        if by is None:
            return self.map_reduce(lambda _b, el: el, lambda _b, x, y: pick(x, y))
        p = _body(by)
        pairs = self.map_reduce(
            lambda b, el, i: {"element": el, "key": p(b, el, i)},
            lambda _b, a, c: if_else(keep_first(a.key, c.key), a, c))
        return pairs.element

    def maximum(self, by: Any = None) -> Expression:
        """The largest element under East's total order — of ``by(element)``
        when given, returning the ELEMENT (TS ``maximum``). Errors at run
        time on an empty array; a tie keeps the first."""
        return self._extreme(by, lambda a, c: a >= c, greatest)

    def minimum(self, by: Any = None) -> Expression:
        """The smallest element under East's total order — of ``by(element)``
        when given, returning the ELEMENT (TS ``minimum``). Errors at run
        time on an empty array; a tie keeps the first."""
        return self._extreme(by, lambda a, c: a <= c, least)

    # ── ordering, slicing, copying, gathering ───────────────────────────

    def sort(self, by: Any = None, *, reverse: bool = False) -> ArrayExpression:
        """Traced ArraySort: a new array ordered by East's total order of
        ``by(element)`` — the element itself when omitted, exactly the
        identity projection TypeScript's ``sort()`` emits (TS ``sort``).
        ``reverse`` appends an ArrayReverse."""
        elem_t = self._elem()
        out = ArrayType(elem_t)
        if by is None:
            node, t2 = self._identity_node(), elem_t
        else:
            node, t2 = _trace_inner_fn(by, [elem_t])
        expr = self._expr(_builtin("ArraySort", out, [elem_t, t2], [self.ir, node]), out)
        if reverse:
            expr = self._expr(_builtin("ArrayReverse", out, [elem_t], [expr.ir]), out)
        return expr

    def sorted(self, key: Any = None, *, reverse: bool = False) -> ArrayExpression:
        """Deprecated alias of :meth:`sort` (the TypeScript name). Without a
        key it keeps emitting the python-only ArraySortDefault builtin it
        always emitted, so IR built with it round-trips unchanged."""
        import warnings

        warnings.warn(
            ".sorted() is deprecated: the spelling is .sort() (the TypeScript name)",
            DeprecationWarning,
            stacklevel=2,
        )
        if key is not None:
            return self.sort(key, reverse=reverse)
        elem_t = self._elem()
        out = ArrayType(elem_t)
        expr = self._expr(_builtin("ArraySortDefault", out, [elem_t], [self.ir]), out)
        if reverse:
            expr = self._expr(_builtin("ArrayReverse", out, [elem_t], [expr.ir]), out)
        return expr

    def is_sorted(self, key: Any = None) -> BooleanExpression:
        """Traced ArrayIsSorted: whether elements (or key projections) are in
        non-decreasing East order."""
        elem_t = self._elem()
        if key is None:
            node, t2 = self._identity_node(), elem_t
        else:
            node, t2 = _trace_inner_fn(key, [elem_t])
        return self._expr(
            _builtin("ArrayIsSorted", BooleanType, [elem_t, t2], [self.ir, node]), BooleanType)

    def concat(self, other: Any) -> ArrayExpression:
        """Traced ArrayConcat: this array with ``other`` appended."""
        o = self._same_typed("concat", other)
        return self._expr(
            _builtin("ArrayConcat", self.east_type, [self._elem()], [self.ir, o.ir]),
            self.east_type,
        )

    def slice(self, start: Any, end: Any) -> ArrayExpression:
        """Traced ArraySlice over the half-open ``[start, end)`` range."""
        s = _lift(start)
        e = _lift(end)
        if s.east_type.type != "Integer" or e.east_type.type != "Integer":
            raise ExpressionError(".slice() bounds must be Integers")
        return self._expr(
            _builtin("ArraySlice", self.east_type, [self._elem()], [self.ir, s.ir, e.ir]),
            self.east_type,
        )

    def reverse(self) -> ArrayExpression:
        """Traced ArrayReverse: a new array of the elements in reverse order
        (TS ``reverse``; :meth:`reverse_in_place` mutates)."""
        return self._expr(
            _builtin("ArrayReverse", self.east_type, [self._elem()], [self.ir]), self.east_type)

    reversed = _deprecated_alias("reversed", "reverse")

    def copy(self) -> ArrayExpression:
        """Traced ArrayCopy (shallow)."""
        return self._expr(
            _builtin("ArrayCopy", self.east_type, [self._elem()], [self.ir]), self.east_type)

    def get_keys(self, keys: Any) -> ArrayExpression:
        """Traced ArrayGetKeys: gather the elements at an ``Array<Integer>``
        of indices."""
        elem_t = self._elem()
        idx = _lift(keys)
        if idx.east_type != ArrayType(IntegerType):
            raise ExpressionError(".get_keys() takes an Array<Integer> of indices")
        node, _out_t = _trace_inner_fn(lambda _b, i: self.get(i), [IntegerType])
        return self._expr(
            _builtin("ArrayGetKeys", self.east_type, [elem_t], [self.ir, idx.ir, node]),
            self.east_type,
        )

    # ── find_* (#525 phase 2) ───────────────────────────────────────────
    # Every one of these compares under East's TOTAL ORDER via the builtin,
    # so a traced search agrees with the eager one on floats, strings,
    # variants and structs alike.

    def _find_keyed(self, builtin: str, op: str, target: Any, key: Any, out_t: EastType) -> Any:
        """The shared ``(array, target, key)`` shape of the ArrayFind* family.
        The key projects each element into the target's type; without one
        the elements are compared directly, exactly as eagerly."""
        elem_t = self._elem()
        if key is None:
            node, t2 = self._identity_node(), elem_t
        else:
            node, t2 = _trace_inner_fn(key, [elem_t])
        tgt = _lift(target, hint=t2)
        if tgt.east_type != t2:
            raise ExpressionError(
                f".{op}() target is {tgt.east_type.type} but the key projects "
                f"to {t2.type} — they must be the same East type"
            )
        return self._expr(_builtin(builtin, out_t, [elem_t, t2], [self.ir, tgt.ir, node]), out_t)

    def find_first(self, target: Any, key: Any = None) -> VariantExpression:
        """Traced ArrayFindFirst: ``some(index)`` of the first element whose
        ``key`` equals ``target`` under East equality, else ``none``. Linear
        scan — the array need not be sorted."""
        return self._find_keyed("ArrayFindFirst", "find_first", target, key,
                                _option_type(IntegerType))

    def find_sorted_first(self, target: Any, key: Any = None) -> IntegerExpression:
        """Traced ArrayFindSortedFirst: the leftmost insertion index for
        ``target``. Assumes the array is already sorted in East order."""
        return self._find_keyed("ArrayFindSortedFirst", "find_sorted_first",
                                target, key, IntegerType)

    def find_sorted_last(self, target: Any, key: Any = None) -> IntegerExpression:
        """Traced ArrayFindSortedLast: the rightmost insertion index."""
        return self._find_keyed("ArrayFindSortedLast", "find_sorted_last",
                                target, key, IntegerType)

    def find_sorted_range(self, target: Any, key: Any = None) -> StructExpression:
        """Traced ArrayFindSortedRange: the half-open ``{start, end}`` span of
        elements equal to ``target``; ``start == end`` when absent."""
        out = StructType([("start", IntegerType), ("end", IntegerType)])
        return self._find_keyed("ArrayFindSortedRange", "find_sorted_range", target, key, out)

    def find_all(self, value: Any, by: Any = None) -> ArrayExpression:
        """Traced ArrayFilterMap: the indices whose element (or ``by``
        projection) equals ``value``, in row order."""
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        elem_t = self._elem()
        proj, p_t = self._projection(by)
        target = _lift(value, hint=p_t)
        if target.east_type != p_t:
            raise ExpressionError(
                f".find_all() value is {target.east_type.type} but the "
                f"projection yields {p_t.type} — they must be the same East type"
            )
        # Bind the target to a Let before the builtin. Unlike the ArrayFind*
        # family — where the target is a builtin ARGUMENT and so evaluated once
        # — this probe lives inside the per-element callback, and the trace-time
        # CSE cannot rescue it: the target node occurs exactly once, and only
        # nodes seen twice are hoisted. An EXPRESSION target (`a.maximum(...)`)
        # would therefore be recomputed per element: measured O(N^2), 3.7s at
        # N=4000 against 1.3ms for the same search via find_first — a
        # traced-vs-eager divergence in COMPLEXITY (#524/#525).
        tname = _fresh_name()
        bound = self._expr(_var(tname, p_t), p_t)
        node, _out_t = self._callback(
            lambda b, el, i: if_else(_lift(proj(b, el, i)) == bound, _some(i), _none))
        out = ArrayType(IntegerType)
        scan = _builtin("ArrayFilterMap", out, [elem_t, IntegerType], [self.ir, node])
        return self._expr(
            _k_block(out, [ir_let(p_t, _var(tname, p_t), target.ir, _loc_id()), scan]), out)

    def find_maximum(self, by: Any = None) -> VariantExpression:
        """Traced index of the first maximum as ``some(index)``; ``none`` for
        an empty array, like the eager ``find_maximum``. The emptiness check
        is an ``if_else`` — IfElse IR, one arm evaluated at run time — and
        the receiver is bound once: it is read three times here."""
        from east.types.construct import none as _none

        return self._with_bound_receiver(lambda recv: if_else(
            recv.size() == 0, _none, recv.find_first(recv.maximum(by), key=by)))

    def find_minimum(self, by: Any = None) -> VariantExpression:
        """Traced index of the first minimum as ``some(index)``; ``none`` when
        empty."""
        from east.types.construct import none as _none

        return self._with_bound_receiver(lambda recv: if_else(
            recv.size() == 0, _none, recv.find_first(recv.minimum(by), key=by)))

    # ── group_* (#525 phase 3) ──────────────────────────────────────────
    # The grouped fold is the primitive; everything else composes from it,
    # exactly as the eager methods do, so a whole aggregate is ONE compiled
    # kernel (TS `groupReduce` parity, #535).

    def group_by(self, key: Any) -> DictExpression:
        """Traced ArrayGroupFold: a Dict from ``key(element)`` to the Array of
        its elements, with hand-built empty-init and append bodies."""
        elem_t = self._elem()
        key_node, k2 = self._callback(key)
        bucket_t = ArrayType(elem_t)
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
        out = DictType(k2, bucket_t)
        return self._expr(
            _builtin("ArrayGroupFold", out, [elem_t, k2, bucket_t],
                     [self.ir, key_node, init_node, fold_node]),
            out,
        )

    def _group_fold(self, op: str, key: Any, init: Any, fold: Any,
                    key_out: EastType | None = None,
                    acc_out: EastType | None = None) -> DictExpression:
        """The ArrayGroupFold behind every ``group_*`` method: key
        ``(element, index)``, init ``(group_key)``, fold ``(acc, element,
        index)``."""
        elem_t = self._elem()
        key_node, k2 = self._callback(key, out_hint=key_out)
        self._check_out(f".{op}() key", k2, key_out)
        init_node, acc_t = _trace_inner_fn(init, [k2], out_hint=acc_out)
        self._check_out(f".{op}() accumulator", acc_t, acc_out)
        fold_node, out_t = _trace_inner_fn(fold, [acc_t, elem_t, IntegerType], out_hint=acc_t)
        if out_t != acc_t:
            raise ExpressionError(
                f".{op}() step returns {out_t.type}, the accumulator from "
                f"init() is {acc_t.type}"
            )
        out = DictType(k2, acc_t)
        return self._expr(
            _builtin("ArrayGroupFold", out, [elem_t, k2, acc_t],
                     [self.ir, key_node, init_node, fold_node]),
            out,
        )

    def group_reduce(self, key: Any, init: Any, fold: Any,
                     key_out: EastType | None = None,
                     acc_out: EastType | None = None) -> DictExpression:
        """Traced ArrayGroupFold: a Dict from the group key to the value
        ``fold`` accumulates from ``init(group_key)``. Steps take
        ``fold(acc, element)`` (``fold(acc, element, index)`` also accepted).
        ``key_out`` / ``acc_out`` pin the group key / accumulator types and
        type the projections' traces (#536)."""
        return self._group_fold("group_reduce", key, init, fold, key_out, acc_out)

    def group_size(self, key: Any = None) -> DictExpression:
        """Traced count per group key; omitted, elements are counted by their
        own value."""
        return self._group_fold(
            "group_size", key if key is not None else (lambda _b, el: el),
            lambda _b, _gk: 0, lambda _b, acc, _el, _i: acc + 1)

    def group_sum(self, key: Any, fn: Any = None) -> DictExpression:
        """Traced sum per group of ``fn(...)`` — the elements when omitted.
        The zero is typed from the projection."""
        proj, t2 = self._numeric_projection("group_sum", fn)
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self._group_fold("group_sum", key, lambda _b, _gk: zero,
                                lambda b, acc, el, i: acc + proj(b, el, i))

    def group_every(self, key: Any, pred: Any) -> DictExpression:
        """Traced per group: True when ``pred`` holds for every member."""
        p = _body(pred)
        return self._group_fold("group_every", key, lambda _b, _gk: True,
                                lambda b, acc, el, i: acc & _lift(p(b, el, i)))

    def group_some(self, key: Any, pred: Any) -> DictExpression:
        """Traced per group: True when ``pred`` holds for any member."""
        p = _body(pred)
        return self._group_fold("group_some", key, lambda _b, _gk: False,
                                lambda b, acc, el, i: acc | _lift(p(b, el, i)))

    def _group_extreme(self, key: Any, by: Any, keep_first: Any) -> DictExpression:
        """group_maximum / group_minimum as TS composes them: an ArrayToDict
        over ``{by, elem}`` pairs whose collision handler compares the keys
        NON-strictly (a tie keeps the first element), then the ELEMENT."""
        proj, _p_t = self._projection(by)
        return self.to_dict(
            key,
            lambda b, el, i: {"by": proj(b, el, i), "elem": el},
            lambda _b, a, c: if_else(keep_first(a.by, c.by), a, c),
        ).map(lambda _b, v: v.elem)

    def group_maximum(self, key: Any, by: Any = None) -> DictExpression:
        """The largest element per group under East's total order — of
        ``by(element)`` when given, returning the ELEMENT (TS ``groupMaximum``)."""
        return self._group_extreme(key, by, lambda a, c: a >= c)

    def group_minimum(self, key: Any, by: Any = None) -> DictExpression:
        """The smallest element per group under East's total order — of
        ``by(element)`` when given, returning the ELEMENT (TS ``groupMinimum``)."""
        return self._group_extreme(key, by, lambda a, c: a <= c)

    def group_mean(self, key: Any, fn: Any = None) -> DictExpression:
        """Traced Float mean per group: ``{t, n}`` accumulated in ONE grouped
        pass, divided at the end — the sum is folded in element order exactly
        as the eager ``group_mean`` folds it, so float accumulation agrees."""
        proj, t2 = self._numeric_projection("group_mean", fn)
        widen = t2.type == "Integer"

        def as_float(value: Any) -> Any:
            lifted = _lift(value)
            return lifted.to_float() if widen else lifted

        return self._group_fold(
            "group_mean", key,
            lambda _b, _gk: {"t": 0.0, "n": 0},
            lambda b, acc, el, i: {"t": acc.t + as_float(proj(b, el, i)), "n": acc.n + 1},
        ).map(lambda _b, acc: acc.t / acc.n.to_float())

    # ── group_to_* / group_find_* (#525 phase 3b) ───────────────────────

    def _group_collect(self, op: str, key: Any, value: Any, into: str) -> DictExpression:
        """group_to_arrays / group_to_sets: a grouped fold into a COLLECTION.
        The accumulator is mutated per element, so the step body is hand-built
        IR — a grouped collect IS pure: each group's accumulator is created
        fresh by ``init`` and never escapes."""
        proj, v_t = self._projection(value)
        acc_t: EastType
        if into == "Array":
            acc_t = ArrayType(v_t)
            empty: Any = _k_new_array
            add_name, add_out = "ArrayPushLast", NullType
        else:
            acc_t = SetType(v_t)
            empty = _k_new_set
            # TRY-insert: duplicates within a group collapse, which is the
            # entire point of collecting into a set.
            add_name, add_out = "SetTryInsert", BooleanType

        def init(_b: Any, _gk: Any) -> Any:
            return self._expr(empty(acc_t, []), acc_t)

        def step(b: Any, acc: Any, el: Any, i: Any) -> Any:
            v = _lift(proj(b, el, i))
            add = _builtin(add_name, add_out, [v_t], [acc.ir, v.ir])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold(op, key, init, step)

    def group_to_arrays(self, key: Any, value: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced arrays of ``value(...)`` per group key (the elements
        themselves when omitted — exactly :meth:`group_by`). ``value_fn`` is
        the eager Dict spelling of the same projection (#536)."""
        return self._group_collect("group_to_arrays", key,
                                   value if value is not None else value_fn, "Array")

    def group_to_sets(self, key: Any, value: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced sets of ``value(...)`` per group key; duplicates within a
        group collapse."""
        return self._group_collect("group_to_sets", key,
                                   value if value is not None else value_fn, "Set")

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None,
                       combine: Any = None, *, value_fn: Any = None) -> DictExpression:
        """Traced nested dicts — ``key2(...) -> value(...)`` per group key.
        Without ``combine`` a duplicate INNER key errors at run time,
        matching the eager method and TS; with one, collisions resolve as
        ``combine(existing, incoming)``."""
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

        def step(b: Any, acc: Any, el: Any, i: Any) -> Any:
            ik = _lift(k2proj(b, el, i))
            v = _lift(proj(b, el, i))
            add = _builtin(add_name, NullType, [k2_t, v_t], [acc.ir, ik.ir, v.ir, *add_args])
            return self._expr(_k_block(acc_t, [add, acc.ir]), acc_t)

        return self._group_fold("group_to_dicts", key, init, step)

    def _find_index_pairs(self, op: str, key: Any, value: Any, by: Any) -> tuple:
        """``(Array<{i, k}> of matches, Set<K> of EVERY group, K, pair type)``.
        One native scan emits ``(index, group key)`` for the matching
        elements; the group set comes from a second native pass, so a group
        whose members all failed still appears in the result — the guarantee
        the eager method and TS ``groupFindAll`` both make."""
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        elem_t = self._elem()
        kf = _body(key)
        key_node, k2 = self._callback(kf)
        proj, p_t = self._projection(by)
        target = _lift(value, hint=p_t)
        if target.east_type != p_t:
            raise ExpressionError(
                f".{op}() value is {target.east_type.type} but the projection "
                f"yields {p_t.type} — they must be the same East type")
        pair_t = StructType([("i", IntegerType), ("k", k2)])
        # Bind the target to a Let first: the probe lives INSIDE the per-element
        # callback, so an expression target spliced in would be recomputed per
        # element — the same O(N^2) trap `find_all` documents.
        tname = _fresh_name()
        bound = self._expr(_var(tname, p_t), p_t)
        node, _o = self._callback(
            lambda b, el, i: if_else(_lift(proj(b, el, i)) == bound,
                                   _some({"i": i, "k": kf(b, el, i)}), _none))
        pairs_t = ArrayType(pair_t)
        scan = _builtin("ArrayFilterMap", pairs_t, [elem_t, pair_t], [self.ir, node])
        pairs = self._expr(
            _k_block(pairs_t, [ir_let(p_t, _var(tname, p_t), target.ir, _loc_id()), scan]),
            pairs_t)
        groups = self._expr(
            _builtin("ArrayToSet", SetType(k2), [elem_t, k2], [self.ir, key_node]), SetType(k2))
        return pairs, groups, k2, pair_t

    def group_find_all(self, key: Any, value: Any, by: Any = None) -> DictExpression:
        """Traced indices of every element equal to ``value``, per group.
        Every group the array has appears: one with no match maps to an EMPTY
        array, not a missing key (eager and TS ``groupFindAll`` parity)."""
        idx_t = ArrayType(IntegerType)

        def build(recv: Any) -> Any:
            pairs, groups, _k2, _pair_t = recv._find_index_pairs(
                "group_find_all", key, value, by)
            found = pairs.group_to_arrays(lambda _b, p: p.k, lambda _b, p: p.i)
            return found.get_keys(
                groups, lambda _b, _k: self._expr(_k_new_array(idx_t, []), idx_t))

        # the receiver is scanned twice (matches, and the group set), so bind it
        return self._with_bound_receiver(build)

    def group_find_first(self, key: Any, value: Any, by: Any = None) -> DictExpression:
        """Traced ``some(first matching index)`` per group, ``none`` for a
        group with no match (TS parity). ``group_find_all`` already yields
        matches in row order within a group, so the first is element 0."""
        return self.group_find_all(key, value, by).map(lambda _b, idxs: idxs.try_get(0))

    def _group_find_extreme(self, op: str, key: Any, by: Any, want_max: bool) -> DictExpression:
        """Index of each group's extreme, via ArrayToDict over ``{by, index}``.
        The collision handler compares NON-STRICTLY, so the incumbent
        (earlier) pair wins a tie and the reported index is the EARLIEST
        extreme — matching the eager ``_group_extreme_combine`` and TS."""
        elem_t = self._elem()
        key_node, k2 = self._callback(key)
        proj, _p_t = self._projection(by)
        # Take the pair type from the TRACE rather than declaring it, so the
        # struct's field order cannot drift from what the lambda builds.
        val_node, pair_t = self._callback(lambda b, el, i: {"by": proj(b, el, i), "index": i})
        keep = (lambda x, y: if_else(x.by >= y.by, x, y)) if want_max \
            else (lambda x, y: if_else(x.by <= y.by, x, y))
        comb_node, c_out = _trace_inner_fn(
            lambda _b, x, y, _k: keep(x, y), [pair_t, pair_t, k2])
        if c_out != pair_t:
            raise ExpressionError(
                f".{op}() collision handler returns {c_out.type}, pairs are Struct")
        out = DictType(k2, pair_t)
        pairs = self._expr(
            _builtin("ArrayToDict", out, [elem_t, k2, pair_t],
                     [self.ir, key_node, val_node, comb_node]),
            out,
        )
        return pairs.map(lambda _b, v: v.index)

    def group_find_maximum(self, key: Any, by: Any = None) -> DictExpression:
        """Traced index of the largest element/projection per group (East
        total order; a tie keeps the earliest index)."""
        return self._group_find_extreme("group_find_maximum", key, by, want_max=True)

    def group_find_minimum(self, key: Any, by: Any = None) -> DictExpression:
        """Traced index of the smallest element/projection per group."""
        return self._group_find_extreme("group_find_minimum", key, by, want_max=False)

    # ── in-place mutation (#578) ────────────────────────────────────────
    # The rest of the surface is pure by design; these are for the
    # accumulator a loop builds — east-c arrays are reference values a loop
    # can extend in place in O(1). Each mirrors its EAGER twin exactly (same
    # name, arguments and return: Null for the inserts, the element for the
    # pops); sequence them with b.do(...) or East.block(...).

    def push_last(self, value: Any) -> NullExpression:
        """Traced ArrayPushLast: add ``value`` to the end (TS ``pushLast``;
        yields Null). :meth:`append` is the python-protocol spelling."""
        elem_t = self._mutable("push_last").value
        v = self._typed("push_last", value, elem_t)
        return self._effect(
            "push_last", _builtin("ArrayPushLast", NullType, [elem_t], [self.ir, v.ir]), NullType)

    def append(self, array: Any) -> NullExpression:
        """Traced ArrayAppend: add every element of ``array`` at the end (TS
        ``append``; yields Null). A single element is :meth:`push_last`."""
        arr_t = self._mutable("append")
        o = _lift(array, hint=arr_t)
        if o.east_type != arr_t:
            raise ExpressionError(
                f".append() takes an {arr_t.type} of the same element type, "
                f"got {o.east_type.type} — a single element is .push_last(value)")
        return self._effect(
            "append", _builtin("ArrayAppend", NullType, [arr_t.value], [self.ir, o.ir]), NullType)

    extend = _deprecated_alias("extend", "append")

    def push_first(self, value: Any) -> NullExpression:
        """Traced ArrayPushFirst: add ``value`` at the front (TS ``pushFirst``;
        yields Null)."""
        elem_t = self._mutable("push_first").value
        v = self._typed("push_first", value, elem_t)
        return self._effect(
            "push_first", _builtin("ArrayPushFirst", NullType, [elem_t], [self.ir, v.ir]), NullType)

    def prepend(self, array: Any) -> NullExpression:
        """Traced ArrayPrepend: add every element of ``array`` at the front
        (TS ``prepend``; yields Null). A single element is :meth:`push_first`."""
        arr_t = self._mutable("prepend")
        o = _lift(array, hint=arr_t)
        if o.east_type != arr_t:
            raise ExpressionError(
                f".prepend() takes an {arr_t.type} of the same element type, "
                f"got {o.east_type.type} — a single element is .push_first(value)")
        return self._effect(
            "prepend", _builtin("ArrayPrepend", NullType, [arr_t.value], [self.ir, o.ir]), NullType)

    def pop_last(self) -> Expression:
        """Traced ArrayPopLast: the last element, removed (TS ``popLast``)."""
        elem_t = self._mutable("pop_last").value
        return self._effect("pop_last", _builtin("ArrayPopLast", elem_t, [elem_t], [self.ir]), elem_t)

    pop = _deprecated_alias("pop", "pop_last")

    def pop_first(self) -> Expression:
        """Traced ArrayPopFirst: the first element, removed."""
        elem_t = self._mutable("pop_first").value
        return self._effect(
            "pop_first", _builtin("ArrayPopFirst", elem_t, [elem_t], [self.ir]), elem_t)

    def update(self, index: Any, value: Any) -> NullExpression:
        """Traced ArrayUpdate: replace the element at ``index`` (TS
        ``update``; yields Null)."""
        elem_t = self._mutable("update").value
        i = self._typed("update", index, IntegerType)
        v = self._typed("update", value, elem_t)
        return self._effect(
            "update", _builtin("ArrayUpdate", NullType, [elem_t], [self.ir, i.ir, v.ir]), NullType)

    set_at = _deprecated_alias("set_at", "update")

    def merge(self, index: Any, value: Any, update_fn: Any) -> NullExpression:
        """Traced ArrayMerge: replace the element at ``index`` with
        ``update_fn(existing, value, index)`` — ``value`` may be of another
        type (TS ``merge``; yields Null)."""
        elem_t = self._mutable("merge").value
        i = self._typed("merge", index, IntegerType)
        v = _lift(value)
        node, got = _trace_inner_fn(update_fn, [elem_t, v.east_type, IntegerType], out_hint=elem_t)
        if got != elem_t and got.type != "Never":
            raise ExpressionError(
                f".merge() update returns {got.type}, elements are {elem_t.type}")
        return self._effect(
            "merge",
            _builtin("ArrayMerge", NullType, [elem_t, v.east_type], [self.ir, i.ir, v.ir, node]),
            NullType,
        )

    def merge_all(self, array: Any, merge_fn: Any) -> NullExpression:
        """Traced ArrayMergeAll: replace every element with
        ``merge_fn(existing, incoming, index)`` over the same-length
        ``array``, whose elements may be of another type (TS ``mergeAll``;
        yields Null)."""
        elem_t = self._mutable("merge_all").value
        other = _lift(array)
        if other.east_type.type != "Array":
            raise ExpressionError(f".merge_all() takes an Array, got {other.east_type.type}")
        elem2_t = other.east_type.value
        node, got = _trace_inner_fn(merge_fn, [elem_t, elem2_t, IntegerType], out_hint=elem_t)
        if got != elem_t and got.type != "Never":
            raise ExpressionError(
                f".merge_all() merge returns {got.type}, elements are {elem_t.type}")
        return self._effect(
            "merge_all",
            _builtin("ArrayMergeAll", NullType, [elem_t, elem2_t], [self.ir, other.ir, node]),
            NullType,
        )

    def clear(self) -> NullExpression:
        """Traced ArrayClear: drop every element (yields Null)."""
        elem_t = self._mutable("clear").value
        return self._effect("clear", _builtin("ArrayClear", NullType, [elem_t], [self.ir]), NullType)

    def reverse_in_place(self) -> NullExpression:
        """Traced ArrayReverseInPlace (yields Null)."""
        elem_t = self._mutable("reverse_in_place").value
        return self._effect(
            "reverse_in_place", _builtin("ArrayReverseInPlace", NullType, [elem_t], [self.ir]),
            NullType)

    def sort_in_place(self, key: Any) -> NullExpression:
        """Traced ArraySortInPlace: sort by ``key(element)`` (yields Null)."""
        elem_t = self._mutable("sort_in_place").value
        node, key_t = _trace_inner_fn(key, [elem_t])
        return self._effect(
            "sort_in_place",
            _builtin("ArraySortInPlace", NullType, [elem_t, key_t], [self.ir, node]), NullType)

    def for_each(self, fn: Any) -> NullExpression:
        """Traced ArrayForEach: run ``fn(element, index)`` per element for its
        effect (yields Null)."""
        elem_t = self._elem()
        node, out_t = self._callback(fn)
        return self._effect(
            "for_each",
            _builtin("ArrayForEach", NullType, [elem_t, out_t], [self.ir, node]), NullType)
