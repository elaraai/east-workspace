#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Reshaping transforms: early-exit scans, flattens, and the ``to_*`` family.

Callback-taking builtins the eager path already emits, exposed on the traced
surface with the same shapes. A missing one bounds what a single kernel can
express — the two-stage flatten split is what their absence used to force.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import _lift, _trace_inner_fn, _with_index, _with_key_arg
from east.expression.location import location_id as _loc_id
from east.expression.nodes import (
    _builtin,
    _fresh_name,
    _is_option,
    _k_function,
    _literal,
    _option_inner,
    _option_type,
    _var,
)
from east.expression.ops import _ExprBase
from east.ir.builders import ir_error
from east.types.types import EastType, FunctionType, IntegerType, StringType

if TYPE_CHECKING:
    from east.expression.expr import Expression


class _TransformOps(_ExprBase):
    """Traced first-map / filter-map / flatten / map-reduce / ``to_*``."""

    __slots__ = ()

    def first_map(self, fn: Any, out: EastType | None = None) -> Expression:
        """Traced early-exit scan: the first ``some(value)`` that ``fn``
        produces (native ``Array``/``Set``/``Dict`` FirstMap — the scan stops
        at the first ``some``, #403).

        ``fn`` takes an element (or ``(key, value)`` for dicts) and returns
        ``some(expr)`` / ``none`` — typically ``if_else(pred, some(x), none)``.
        The result is ``Option<T>``; consume it with ``.is_some()`` /
        ``.unwrap_or()`` / ``.match()``. ``out`` pins the ``some`` payload
        type when the lambda alone cannot (e.g. a bare ``none`` arm outside
        ``if_else``).
        """
        tag = self.east_type.type

        def lift_result(raw: Any) -> Any:
            if out is not None:
                return _lift(raw, hint=_option_type(out))
            return raw

        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda el, _i: lift_result(fn(el)), [elem_t, IntegerType], declared=2
            )
            if not _is_option(out_t):
                raise ExpressionError(
                    ".first_map() lambda must return some(...)/none, got "
                    f"{out_t.type}"
                )
            inner_t = _option_inner(out_t)
            return self._expr(
                _builtin("ArrayFirstMap", out_t, [elem_t, inner_t], [self.ir, node]), out_t
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(lambda el: lift_result(fn(el)), [elem_t], declared=1)
            if not _is_option(out_t):
                raise ExpressionError(
                    ".first_map() lambda must return some(...)/none, got "
                    f"{out_t.type}"
                )
            inner_t = _option_inner(out_t)
            return self._expr(
                _builtin("SetFirstMap", out_t, [elem_t, inner_t], [self.ir, node]), out_t
            )
        if tag == "Dict":
            kv = self.east_type.value
            # The builtin's callback signature is (value, key); the user fn
            # takes (key, value) like the eager method.
            node, out_t = _trace_inner_fn(
                lambda v, k: lift_result(fn(k, v)), [kv["value"], kv["key"]], declared=2
            )
            if not _is_option(out_t):
                raise ExpressionError(
                    ".first_map() lambda must return some(...)/none, got "
                    f"{out_t.type}"
                )
            inner_t = _option_inner(out_t)
            return self._expr(
                _builtin(
                    "DictFirstMap", out_t, [kv["key"], kv["value"], inner_t], [self.ir, node]
                ),
                out_t,
            )
        raise ExpressionError(f".first_map() on {tag}")

    def string_join(self, separator: Any) -> Expression:
        """Traced ArrayStringJoin over an Array<String>."""
        elem_t = self._array_elem("string_join")
        if elem_t.type != "String":
            raise ExpressionError(".string_join() needs an Array<String>")
        sep = _lift(separator)
        if sep.east_type.type != "String":
            raise ExpressionError(".string_join() separator must be a String")
        return self._expr(
            _builtin("ArrayStringJoin", StringType, [], [self.ir, sep.ir]), StringType
        )

    # ── the rest of the collection surface (#452) ───────────────────────
    # Callback-taking builtins the eager path already emits, exposed on the
    # traced surface with the same shapes. A missing one bounds what a single
    # kernel can express (the two-stage flatten split).

    def _option_callback(self, fn: Any, param_types: list, declared: int,
                         out: EastType | None = None) -> tuple:
        hint = _option_type(out) if out is not None else None
        node, out_t = _trace_inner_fn(fn, param_types, declared=declared, out_hint=hint)
        if not _is_option(out_t):
            raise ExpressionError(
                f"callback must return some(...)/none, got {out_t.type}"
            )
        return node, _option_inner(out_t)

    def filter_map(self, fn: Any, out: EastType | None = None) -> Expression:
        """Traced filter+map in one pass: Array → Array of unwrapped ``some``
        values; Set → Dict of kept element to value; Dict → Dict of kept key
        to value (``fn(key, value)``). ``out`` pins the kept value type and
        types the callback's ``some`` payload (#536)."""
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import DictType as _DictType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, inner_t = self._option_callback(
                lambda el, _i: fn(el), [elem_t, IntegerType], 2, out)
            self._check_out(".filter_map()", inner_t, out)
            out_a = _ArrayType(inner_t)
            return self._expr(
                _builtin("ArrayFilterMap", out_a, [elem_t, inner_t], [self.ir, node]), out_a
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, inner_t = self._option_callback(fn, [elem_t], 1, out)
            self._check_out(".filter_map()", inner_t, out)
            out_d = _DictType(elem_t, inner_t)
            return self._expr(
                _builtin("SetFilterMap", out_d, [elem_t, inner_t], [self.ir, node]), out_d
            )
        if tag == "Dict":
            kv = self.east_type.value
            node, inner_t = self._option_callback(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], 2, out)
            self._check_out(".filter_map()", inner_t, out)
            out_d = _DictType(kv["key"], inner_t)
            return self._expr(
                _builtin("DictFilterMap", out_d, [kv["key"], kv["value"], inner_t],
                         [self.ir, node]),
                out_d,
            )
        raise ExpressionError(f".filter_map() on {tag}")

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> Expression:
        """Traced flatten: concatenate the arrays ``fn`` produces per element
        (per entry for a Dict, ``fn(key, value)``) — the operation whose
        absence forced two-stage kernels with a materialised intermediate.
        ``out`` pins the flattened ELEMENT type and types the callback's
        trace (#536)."""
        from east.types.types import ArrayType as _ArrayType

        hint = _ArrayType(out) if out is not None else None
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda el, _i: fn(el), [elem_t, IntegerType], declared=2, out_hint=hint)
            builtin, tps = "ArrayFlattenToArray", [elem_t]
        elif tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1, out_hint=hint)
            builtin, tps = "SetFlattenToArray", [elem_t]
        elif tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2, out_hint=hint)
            builtin, tps = "DictFlattenToArray", [kv["key"], kv["value"]]
        else:
            raise ExpressionError(f".flatten_to_array() on {tag}")
        if out_t.type != "Array":
            raise ExpressionError(
                f".flatten_to_array() callback must return an Array, got {out_t.type}")
        inner_t = out_t.value
        self._check_out(".flatten_to_array()", inner_t, out)
        out_a = _ArrayType(inner_t)
        return self._expr(_builtin(builtin, out_a, [*tps, inner_t], [self.ir, node]), out_a)

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> Expression:
        """Traced flatten into a set: union the sets ``fn`` produces. ``out``
        pins the flattened ELEMENT type and types the callback's trace
        (#536)."""
        from east.types.types import SetType as _SetType

        hint = _SetType(out) if out is not None else None
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda el, _i: fn(el), [elem_t, IntegerType], declared=2, out_hint=hint)
            builtin, tps = "ArrayFlattenToSet", [elem_t]
        elif tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1, out_hint=hint)
            builtin, tps = "SetFlattenToSet", [elem_t]
        elif tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2, out_hint=hint)
            builtin, tps = "DictFlattenToSet", [kv["key"], kv["value"]]
        else:
            raise ExpressionError(f".flatten_to_set() on {tag}")
        if out_t.type != "Set":
            raise ExpressionError(
                f".flatten_to_set() callback must return a Set, got {out_t.type}")
        inner_t = out_t.value
        self._check_out(".flatten_to_set()", inner_t, out)
        out_s = _SetType(inner_t)
        return self._expr(_builtin(builtin, out_s, [*tps, inner_t], [self.ir, node]), out_s)

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Expression:
        """Traced map-then-pairwise-combine (errors at run time on empty, like
        the eager method). Dict's ``map_fn`` takes ``(key, value)``. ``out``
        pins the mapped type and types the map callback's trace (#536)."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            # `_with_index`: the eager ArrayMapReduce passes the index through
            # `_idx_cb`, so an (element, index) map_fn is a supported eager
            # call and must trace too (#525).
            map_node, t2 = _trace_inner_fn(
                _with_index(map_fn), [elem_t, IntegerType], declared=2, out_hint=out)
            builtin, tps = "ArrayMapReduce", [elem_t]
        elif tag == "Set":
            elem_t = self.east_type.value
            map_node, t2 = _trace_inner_fn(map_fn, [elem_t], declared=1, out_hint=out)
            builtin, tps = "SetMapReduce", [elem_t]
        elif tag == "Dict":
            kv = self.east_type.value
            map_node, t2 = _trace_inner_fn(
                lambda v, k: map_fn(k, v), [kv["value"], kv["key"]], declared=2,
                out_hint=out)
            builtin, tps = "DictMapReduce", [kv["key"], kv["value"]]
        else:
            raise ExpressionError(f".map_reduce() on {tag}")
        self._check_out(".map_reduce()", t2, out)
        reduce_node, r_out = _trace_inner_fn(reduce_fn, [t2, t2], declared=2, out_hint=t2)
        if r_out != t2:
            raise ExpressionError(
                f".map_reduce() reduce returns {r_out.type}, mapped values are {t2.type}")
        return self._expr(
            _builtin(builtin, t2, [*tps, t2], [self.ir, map_node, reduce_node]), t2
        )

    def _key_error_node(self, t2: EastType, k2: EastType, prefix: str, suffix: str):
        """A collision handler that RAISES, naming the offending key.

        The key is printed with the East ``Print`` builtin so the message
        matches the eager path's ``print_east(k, key_type)`` and TypeScript's
        ``Expr.str`… ${key} …``` byte for byte.
        """
        v1 = _var(_fresh_name(), t2)
        v2 = _var(_fresh_name(), t2)
        ck = _var(_fresh_name(), k2)
        # A String key is emitted BARE. `Print` would JSON-quote it, and both
        # the eager path (`printed = k if isinstance(k, str) else print_east(…)`)
        # and TS (`Expr.str` splices a String expression directly, wrapping only
        # non-String types) leave it unquoted — so wrapping unconditionally made
        # the traced message the odd one out of three runtimes.
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

    def _duplicate_key_node(self, t2: EastType, k2: EastType):
        """The default ``to_dict``/``flatten_to_dict`` collision handler: ERROR.

        This used to be a "second value wins" function, which made a traced
        ``to_dict`` over data with a duplicate key return a WRONG ANSWER —
        silently keeping the last value — where the eager method and TypeScript
        both raise ``Cannot insert duplicate key … into dict``. Losing rows
        without a word is the worse of the two failure modes, and it diverged
        from both other runtimes (#525).
        """
        return self._key_error_node(
            t2, k2, "Cannot insert duplicate key ", " into dict")

    def to_dict(self, key: Any, value: Any = None, combine: Any = None,
                key_out: EastType | None = None,
                value_out: EastType | None = None) -> Expression:
        """Traced ArrayToDict / DictToDict, shaped like the eager methods:
        Array keys by ``key(element)`` with ``value(element)`` (the element
        itself when omitted); Dict re-keys with ``key(key, value)`` /
        ``value(key, value)``. Without ``combine`` a duplicate key ERRORS, like
        the eager method and TypeScript — it does not keep the later value.
        ``key_out`` / ``value_out`` pin the produced key/value types and type
        the projections' traces (#536)."""
        from east.types.types import DictType as _DictType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            key_node, k2 = _trace_inner_fn(
                lambda el, _i: key(el), [elem_t, IntegerType], declared=2,
                out_hint=key_out)
            val = value if value is not None else (lambda el: el)
            val_node, t2 = _trace_inner_fn(
                lambda el, _i: val(el), [elem_t, IntegerType], declared=2,
                out_hint=value_out)
        elif tag == "Dict":
            kv = self.east_type.value
            key_node, k2 = _trace_inner_fn(
                lambda v, k: key(k, v), [kv["value"], kv["key"]], declared=2,
                out_hint=key_out)
            if value is None:
                val_node, t2 = _trace_inner_fn(
                    lambda v, _k: v, [kv["value"], kv["key"]], declared=2,
                    out_hint=value_out)
            else:
                val_node, t2 = _trace_inner_fn(
                    lambda v, k: value(k, v), [kv["value"], kv["key"]], declared=2,
                    out_hint=value_out)
        elif tag == "Set":
            elem_t = self.east_type.value
            key_node, k2 = _trace_inner_fn(key, [elem_t], declared=1, out_hint=key_out)
            if value is None:
                raise ExpressionError(".to_dict() on a Set needs a value fn(element)")
            val_node, t2 = _trace_inner_fn(value, [elem_t], declared=1,
                                           out_hint=value_out)
        else:
            raise ExpressionError(f".to_dict() on {tag}")
        self._check_out(".to_dict() key", k2, key_out)
        self._check_out(".to_dict() value", t2, value_out)
        if combine is None:
            combine_node = self._duplicate_key_node(t2, k2)
        else:
            combine_node, c_out = _trace_inner_fn(
                _with_key_arg(combine), [t2, t2, k2], declared=3, out_hint=t2)
            if c_out != t2:
                raise ExpressionError(
                    f".to_dict() combine returns {c_out.type}, values are {t2.type}")
        out = _DictType(k2, t2)
        if tag == "Array":
            args = [self.ir, key_node, val_node, combine_node]
            return self._expr(
                _builtin("ArrayToDict", out, [self.east_type.value, k2, t2], args), out)
        if tag == "Dict":
            kv = self.east_type.value
            args = [self.ir, key_node, val_node, combine_node]
            return self._expr(
                _builtin("DictToDict", out, [kv["key"], kv["value"], k2, t2], args), out)
        args = [self.ir, key_node, val_node, combine_node]
        return self._expr(
            _builtin("SetToDict", out, [self.east_type.value, k2, t2], args), out)

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> Expression:
        """Traced flatten into a dict: merge the dicts ``fn`` produces.

        The third member of the flatten family (``flatten_to_array`` /
        ``flatten_to_set`` already traced), and the one whose absence forced a
        two-stage kernel with a materialised intermediate. Without ``combine`` a
        key produced by two different elements errors, matching the eager method
        and TS; with it, collisions resolve as ``combine(existing, incoming)``.
        """
        from east.types.types import DictType as _DictType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda el, _i: fn(el), [elem_t, IntegerType], declared=2)
            builtin, tps = "ArrayFlattenToDict", [elem_t]
        elif tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1)
            builtin, tps = "SetFlattenToDict", [elem_t]
        elif tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2)
            builtin, tps = "DictFlattenToDict", [kv["key"], kv["value"]]
        else:
            raise ExpressionError(f".flatten_to_dict() on {tag}")
        if out_t.type != "Dict":
            raise ExpressionError(
                f".flatten_to_dict() callback must return a Dict, got {out_t.type}")
        k2, v2 = out_t.value["key"], out_t.value["value"]
        if combine is None:
            combine_node = self._duplicate_key_node(v2, k2)
        else:
            combine_node, c_out = _trace_inner_fn(
                _with_key_arg(combine), [v2, v2, k2], declared=3, out_hint=v2)
            if c_out != v2:
                raise ExpressionError(
                    f".flatten_to_dict() combine returns {c_out.type}, values are {v2.type}")
        out = _DictType(k2, v2)
        return self._expr(
            _builtin(builtin, out, [*tps, k2, v2], [self.ir, node, combine_node]), out
        )

    def to_set(self, key: Any = None, out: EastType | None = None) -> Expression:
        """Traced ArrayToSet / SetToSet / DictToSet: the set of elements or
        projections (``key(key, value)`` for a Dict, where it is required).

        ``out`` pins the result element type. It is accepted because the eager
        ``EastSet.to_set(fn, out=…)`` accepts it — a keyword the traced twin
        rejected would make a working eager call stop tracing, silently, which
        is the failure this surface exists to prevent (#525).
        """
        from east.types.types import SetType as _SetType

        tag = self.east_type.type
        if tag == "Set":
            # SetToSet — the eager `EastSet.to_set(fn)` twin. Without it the
            # whole to_* family traced except this one member, so a working
            # eager lambda silently dropped its loop to the python path.
            if key is None:
                raise ExpressionError(".to_set() on a Set needs a projection fn(element)")
            elem_t = self.east_type.value
            node, k2 = _trace_inner_fn(key, [elem_t], declared=1)
            self._check_out(".to_set()", k2, out)
            out_t = _SetType(k2)
            return self._expr(
                _builtin("SetToSet", out_t, [elem_t, k2], [self.ir, node]), out_t
            )
        if tag == "Array":
            elem_t = self.east_type.value
            proj = key if key is not None else (lambda el: el)
            node, k2 = _trace_inner_fn(
                lambda el, _i: proj(el), [elem_t, IntegerType], declared=2)
            self._check_out(".to_set()", k2, out)
            out_t = _SetType(k2)
            return self._expr(
                _builtin("ArrayToSet", out_t, [elem_t, k2], [self.ir, node]), out_t
            )
        if tag == "Dict":
            if key is None:
                raise ExpressionError(".to_set() on a Dict needs a projection fn(key, value)")
            kv = self.east_type.value
            node, k2 = _trace_inner_fn(
                lambda v, k: key(k, v), [kv["value"], kv["key"]], declared=2)
            self._check_out(".to_set()", k2, out)
            out_t = _SetType(k2)
            return self._expr(
                _builtin("DictToSet", out_t, [kv["key"], kv["value"], k2], [self.ir, node]),
                out_t,
            )
        raise ExpressionError(f".to_set() on {tag}")

    def unique(self) -> Expression:
        """Traced distinct elements (ArrayToSet with the identity key)."""
        return self.to_set()

    def to_array(self, fn: Any = None, out: EastType | None = None, *,
                 key: Any = None) -> Expression:
        """Traced SetToArray / DictToArray: elements (or projections) in East
        order; a Dict projects with ``fn(key, value)`` (required). ``key`` is
        the eager Set spelling of the projection; ``out`` pins the projected
        element type and types the projection's trace (#536)."""
        from east.types.types import ArrayType as _ArrayType

        if fn is None and key is not None:
            fn = key
        tag = self.east_type.type
        if tag == "Set":
            elem_t = self.east_type.value
            proj = fn if fn is not None else (lambda el: el)
            node, t2 = _trace_inner_fn(proj, [elem_t], declared=1, out_hint=out)
            self._check_out(".to_array()", t2, out)
            out_a = _ArrayType(t2)
            return self._expr(
                _builtin("SetToArray", out_a, [elem_t, t2], [self.ir, node]), out_a
            )
        if tag == "Dict":
            if fn is None:
                raise ExpressionError(".to_array() on a Dict needs a projection fn(key, value)")
            kv = self.east_type.value
            node, t2 = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2, out_hint=out)
            self._check_out(".to_array()", t2, out)
            out_a = _ArrayType(t2)
            return self._expr(
                _builtin("DictToArray", out_a, [kv["key"], kv["value"], t2], [self.ir, node]),
                out_a,
            )
        raise ExpressionError(f".to_array() on {tag}")
