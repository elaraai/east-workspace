#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Container access and the core callback-taking transforms.

Reads (``size``/``has``/``get``/``get_or_default``) plus the transforms every
container shares — ``map`` / ``filter`` / ``fold`` / ``scan`` and the
short-circuiting quantifiers. Nested lambdas are traced recursively against
the builtin's declared callback signature.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.kernel.errors import KernelTraceError
from east.kernel.finalize import _const_fn_node
from east.kernel.lift import _lift, _trace_inner_fn, _with_index, where
from east.kernel.nodes import _builtin
from east.kernel.ops import _ExprBase
from east.types.types import BooleanType, EastType, IntegerType

if TYPE_CHECKING:
    from east.kernel.expr import KernelExpr


class _CollectionOps(_ExprBase):
    """Traced container reads and the shared callback transforms."""

    __slots__ = ()

    # ── scalar reads on collection-typed fields ─────────────────────────

    def size(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Array":
            return self._expr(
                _builtin("ArraySize", IntegerType, [self.east_type.value], [self.ir]), IntegerType
            )
        if tag == "Set":
            return self._expr(
                _builtin("SetSize", IntegerType, [self.east_type.value], [self.ir]), IntegerType
            )
        if tag == "Dict":
            kv = self.east_type.value
            return self._expr(
                _builtin("DictSize", IntegerType, [kv["key"], kv["value"]], [self.ir]), IntegerType
            )
        if tag == "String":
            return self.length()
        raise KernelTraceError(f".size() on {tag}")

    def has(self, item: Any) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Array":
            i = _lift(item)
            if i.east_type.type != "Integer":
                raise KernelTraceError("Array.has() takes an Integer index")
            return self._expr(
                _builtin("ArrayHas", BooleanType, [self.east_type.value], [self.ir, i.ir]),
                BooleanType,
            )
        if tag == "Set":
            k = _lift(item, hint=self.east_type.value)
            return self._expr(
                _builtin("SetHas", BooleanType, [self.east_type.value], [self.ir, k.ir]),
                BooleanType,
            )
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(item, hint=kv["key"])
            return self._expr(
                _builtin("DictHas", BooleanType, [kv["key"], kv["value"]], [self.ir, k.ir]),
                BooleanType,
            )
        raise KernelTraceError(f".has() on {tag}")

    def get(self, key: Any = None) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Ref":
            # `East.ref(x).get()` — the cell read, spelled as the eager
            # ``EastRef.get`` is, and taking no key.
            inner_t = self.east_type.value
            return self._expr(
                _builtin("RefGet", inner_t, [inner_t], [self.ir]), inner_t)
        if tag == "Array":
            i = _lift(key)
            if i.east_type.type != "Integer":
                raise KernelTraceError("Array.get() takes an Integer index")
            elem_t = self.east_type.value
            return self._expr(
                _builtin("ArrayGet", elem_t, [elem_t], [self.ir, i.ir]), elem_t
            )
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(key, hint=kv["key"])
            return self._expr(
                _builtin("DictGet", kv["value"], [kv["key"], kv["value"]], [self.ir, k.ir]),
                kv["value"],
            )
        raise KernelTraceError(f".get() on {tag}")

    def get_or_default(self, key: Any, default: Any) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            i = _lift(key)
            d = _lift(default, hint=elem_t)
            fn = _const_fn_node([IntegerType], d, elem_t)
            return self._expr(
                _builtin("ArrayGetOrDefault", elem_t, [elem_t], [self.ir, i.ir, fn]), elem_t
            )
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(key, hint=kv["key"])
            d = _lift(default, hint=kv["value"])
            fn = _const_fn_node([kv["key"]], d, kv["value"])
            return self._expr(
                _builtin(
                    "DictGetOrDefault", kv["value"], [kv["key"], kv["value"]], [self.ir, k.ir, fn]
                ),
                kv["value"],
            )
        raise KernelTraceError(f".get_or_default() on {tag}")

    # ── collection transforms (nested lambdas traced recursively, #393) ──

    @staticmethod
    def _check_out(op: str, traced_t: EastType, out: EastType | None) -> None:
        """Reject an ``out=`` that disagrees with the traced projection.

        The eager twins accept ``out=`` to PIN a type they would otherwise
        sample; a kernel always knows it, so ``out`` can only confirm or
        contradict. Contradicting it silently would label the result with a
        type that does not describe it — the #467 failure mode.
        """
        if out is not None and out != traced_t:
            raise KernelTraceError(
                f"{op} projection yields {traced_t.type}, out= declares {out.type}")

    def _array_elem(self, op: str) -> EastType:
        if self.east_type.type != "Array":
            raise KernelTraceError(f".{op}() on {self.east_type.type} (needs Array)")
        return self.east_type.value

    def map(self, fn: Any, out: EastType | None = None) -> KernelExpr:
        """Traced map, shaped like the eager methods: Array → Array of
        ``fn(element)`` (``fn(element, index)`` also accepted), Set → Dict of
        element to ``fn(element)`` (SetMap), Dict → Dict with mapped values and
        the keys kept (DictMap, ``fn(value)`` or ``fn(value, key)``). ``out``
        pins the mapped element type AND types the callback's trace, so the
        callback can build a general variant (#536, #541)."""
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import DictType as _DictType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t, IntegerType], out_hint=out)
            self._check_out(".map()", out_t, out)
            return self._expr(
                _builtin("ArrayMap", _ArrayType(out_t), [elem_t, out_t], [self.ir, node]),
                _ArrayType(out_t),
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1, out_hint=out)
            self._check_out(".map()", out_t, out)
            out_d = _DictType(elem_t, out_t)
            return self._expr(
                _builtin("SetMap", out_d, [elem_t, out_t], [self.ir, node]), out_d
            )
        if tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [kv["value"], kv["key"]], out_hint=out)
            self._check_out(".map()", out_t, out)
            out_d = _DictType(kv["key"], out_t)
            return self._expr(
                _builtin("DictMap", out_d, [kv["key"], kv["value"], out_t], [self.ir, node]),
                out_d,
            )
        raise KernelTraceError(f".map() on {tag}")

    def filter(self, fn: Any) -> KernelExpr:
        """Traced filter: Array/Set keep elements the predicate accepts;
        Dict keeps entries where ``fn(key, value)`` holds (DictFilter)."""
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import DictType as _DictType
        from east.types.types import SetType as _SetType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t, IntegerType], out_hint=BooleanType)
            if out_t.type != "Boolean":
                raise KernelTraceError(f".filter() predicate must return Boolean, got {out_t.type}")
            out = _ArrayType(elem_t)
            return self._expr(_builtin("ArrayFilter", out, [elem_t], [self.ir, node]), out)
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1, out_hint=BooleanType)
            if out_t.type != "Boolean":
                raise KernelTraceError(f".filter() predicate must return Boolean, got {out_t.type}")
            out = _SetType(elem_t)
            return self._expr(_builtin("SetFilter", out, [elem_t], [self.ir, node]), out)
        if tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2,
                out_hint=BooleanType
            )
            if out_t.type != "Boolean":
                raise KernelTraceError(f".filter() predicate must return Boolean, got {out_t.type}")
            out = _DictType(kv["key"], kv["value"])
            return self._expr(
                _builtin("DictFilter", out, [kv["key"], kv["value"]], [self.ir, node]), out
            )
        raise KernelTraceError(f".filter() on {tag}")

    def fold(self, initial: Any, fn: Any) -> KernelExpr:
        """Traced ArrayFold: ``fn(acc, element)`` or ``fn(acc, element, index)``."""
        elem_t = self._array_elem("fold")
        init = _lift(initial)
        acc_t = init.east_type
        node, out_t = _trace_inner_fn(fn, [acc_t, elem_t, IntegerType], out_hint=acc_t)
        if out_t != acc_t:
            raise KernelTraceError(
                f".fold() step returns {out_t.type}, accumulator is {acc_t.type}"
            )
        return self._expr(
            _builtin("ArrayFold", acc_t, [elem_t, acc_t], [self.ir, init.ir, node]), acc_t
        )

    def scan(self, initial: Any, fn: Any) -> KernelExpr:
        """Traced running fold (ArrayScan / SetScan / DictScan): an Array of
        every intermediate accumulator. Element ``i`` is the accumulator
        AFTER folding element ``i`` — same length as the input, the seed is
        not emitted, and the last element equals the matching ``fold``/
        ``reduce``. Steps mirror the fold callbacks exactly: Array
        ``fn(acc, el)`` (+ optional index), Set ``fn(acc, el)``, Dict
        ``fn(acc, key, value)`` in ascending key order."""
        from east.types.types import ArrayType as _ArrayType

        tag = self.east_type.type
        init = _lift(initial)
        acc_t = init.east_type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [acc_t, elem_t, IntegerType], out_hint=acc_t)
            if out_t != acc_t:
                raise KernelTraceError(
                    f".scan() step returns {out_t.type}, accumulator is {acc_t.type}"
                )
            out = _ArrayType(acc_t)
            return self._expr(
                _builtin("ArrayScan", out, [elem_t, acc_t], [self.ir, init.ir, node]), out
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [acc_t, elem_t], declared=2, out_hint=acc_t)
            if out_t != acc_t:
                raise KernelTraceError(
                    f".scan() step returns {out_t.type}, accumulator is {acc_t.type}"
                )
            out = _ArrayType(acc_t)
            return self._expr(
                _builtin("SetScan", out, [elem_t, acc_t], [self.ir, node, init.ir]), out
            )
        if tag == "Dict":
            kv = self.east_type.value
            # The builtin's callback signature is (acc, value, key); the user
            # fn takes (acc, key, value) like the eager method.
            node, out_t = _trace_inner_fn(
                lambda a, v, k: fn(a, k, v), [acc_t, kv["value"], kv["key"]], declared=3,
                out_hint=acc_t
            )
            if out_t != acc_t:
                raise KernelTraceError(
                    f".scan() step returns {out_t.type}, accumulator is {acc_t.type}"
                )
            out = _ArrayType(acc_t)
            return self._expr(
                _builtin(
                    "DictScan", out, [kv["key"], kv["value"], acc_t], [self.ir, node, init.ir]
                ),
                out,
            )
        raise KernelTraceError(f".scan() on {tag}")

    def some(self, pred: Any = None) -> KernelExpr:
        """Traced any-element predicate (native short-circuiting FirstMap scan).

        Without ``pred`` the elements — a Dict's VALUES — must be Boolean,
        like the eager ``some()`` (whose keyword this mirrors, #536).
        """
        return self._quantifier("some", pred)

    def every(self, pred: Any = None) -> KernelExpr:
        """Traced all-elements predicate (native short-circuiting FirstMap scan).

        Without ``pred`` the elements — a Dict's VALUES — must be Boolean,
        like the eager ``every()`` (whose keyword this mirrors, #536).
        """
        return self._quantifier("every", pred)

    def _quantifier(self, op: str, fn: Any) -> KernelExpr:
        """some/every as a FirstMap probe that yields ``some(True)`` on the
        deciding element — the scan short-circuits exactly like the eager
        ``_first_map_bool`` path (#403), where the previous fold encoding
        evaluated the predicate for every element. Array/Set take
        ``fn(element)`` (Array also accepts the index); Dict takes
        ``fn(key, value)``, like every other eager Dict callback (#525).
        """
        want = op == "some"
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        if fn is None:
            # The no-predicate form: Boolean elements (a Dict's VALUES) are the
            # predicate, exactly as the eager `every()`/`some()` allow.
            probed = self.east_type.value
            probed = probed["value"] if self.east_type.type == "Dict" else probed
            if getattr(probed, "type", None) != "Boolean":
                raise KernelTraceError(
                    f".{op}() without a predicate needs Boolean "
                    f"{'values' if self.east_type.type == 'Dict' else 'elements'}, "
                    f"got {getattr(probed, 'type', self.east_type.type)}"
                )
            fn = (lambda _k, v: v) if self.east_type.type == "Dict" else (lambda el: el)

        def decide(raw: Any) -> KernelExpr:
            pred = _lift(raw)
            if pred.east_type.type != "Boolean":
                raise KernelTraceError(
                    f".{op}() predicate must return Boolean, got {pred.east_type.type}"
                )
            decided = pred if want else ~pred
            return where(decided, _some(True), _none)

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            pred = _with_index(fn)
            node, out_t = _trace_inner_fn(
                lambda el, i: decide(pred(el, i)), [elem_t, IntegerType], declared=2
            )
            builtin, tps = "ArrayFirstMap", [elem_t, BooleanType]
        elif tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(lambda el: decide(fn(el)), [elem_t], declared=1)
            builtin, tps = "SetFirstMap", [elem_t, BooleanType]
        elif tag == "Dict":
            kv = self.east_type.value
            # The builtin's slot is (value, key); the user fn takes (key, value).
            node, out_t = _trace_inner_fn(
                lambda v, k: decide(fn(k, v)), [kv["value"], kv["key"]], declared=2
            )
            builtin, tps = "DictFirstMap", [kv["key"], kv["value"], BooleanType]
        else:
            raise KernelTraceError(f".{op}() on {tag}")
        scanned = self._expr(_builtin(builtin, out_t, tps, [self.ir, node]), out_t)
        # some: a deciding element exists; every: no counterexample exists.
        # FirstMap on an empty collection yields none, so some([])=False and
        # every([])=True fall out — matching the eager path exactly.
        return scanned.is_some() if want else scanned.is_none()
