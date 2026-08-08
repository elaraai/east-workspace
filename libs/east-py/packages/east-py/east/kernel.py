#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Trace python lambdas into compiled East kernels (IR push-down).

This is the python twin of the TypeScript expression builders: calling a
lambda once with typed expression proxies records East IR, which east-c
compiles to a native function. Eager collection methods (``map``/``filter``/
``fold``/…) use this automatically — a pure lambda like
``lambda r: r.price * r.qty`` becomes a native kernel and the whole loop
executes inside east-c with no per-element python callback; a lambda that
does real python work simply falls back to the per-element callback path.

Explicit API:

- ``kernel(param_types, fn)`` — trace ``fn`` now and return the compiled
  kernel (raises ``KernelTraceError`` if the lambda is not traceable). The
  result is an ordinary python callable, and every eager method accepts it.
- ``where(cond, then, otherwise)`` — traced conditional expression (python
  ``if``/``and``/``or`` cannot be overloaded; inside kernels use ``&``,
  ``|``, ``~`` and ``where``). ``where`` compiles to IfElse — exactly one
  branch evaluates at run time, so a guarded partial op is safe.

What traces (#393 expanded this to the whole builtin surface):

- Struct field access, arithmetic, comparison, boolean algebra, ``where`` /
  ``greatest`` / ``least``, and the expression methods on ``KernelExpr``
  (string ops, datetime ops, float/integer math — see the class).
- Every ``East.<Type>.*`` namespace builtin (``East.String.substring``,
  ``East.Float.sqrt``, …): the eager funnel emits IR when any argument is a
  traced expression.
- Collection transforms with nested lambdas, one level or deeper — the
  authoritative per-container enumeration is ``_TRACED_SURFACE`` (also the
  error message on an unsupported method, and pinned by the surface test):
  Array: ``map`` / ``filter`` / ``filter_map`` / ``fold`` / ``scan`` /
  ``map_reduce`` / ``flatten_to_array`` / ``flatten_to_set`` / ``to_dict`` /
  ``to_set`` / ``unique`` / ``group_by`` / ``sorted`` / ``is_sorted`` /
  ``some`` / ``every`` / ``first_map`` / ``string_join`` / ``concat`` /
  ``slice`` / ``reversed`` / ``copy`` / ``get_keys`` / ``get`` /
  ``get_or_default`` / ``try_get`` / ``size`` / ``has`` / ``[index_expr]``;
  Set: ``map`` / ``filter`` / ``filter_map`` / ``first_map`` /
  ``map_reduce`` / ``scan`` / ``flatten_to_array`` / ``flatten_to_set`` /
  ``to_array`` / ``to_dict`` / the set algebra (``union`` / ``intersect`` /
  ``diff`` / ``sym_diff`` / ``is_subset`` / ``is_disjoint``) / ``copy`` /
  ``size`` / ``has``;
  Dict: ``map`` / ``filter`` / ``filter_map`` / ``first_map`` /
  ``map_reduce`` / ``scan`` / ``flatten_to_array`` / ``flatten_to_set`` /
  ``to_array`` / ``to_set`` / ``to_dict`` / ``keys_set`` / ``get_keys`` /
  ``copy`` / ``get`` / ``get_or_default`` / ``try_get`` / ``size`` / ``has``.
  Inner lambdas may reference outer parameters.
  ``some``/``every``/``first_map`` compile to the native short-circuiting
  FirstMap scans (#403), so traced and eager forms have identical
  early-exit execution. Mutators and side-effecting methods are
  deliberately absent: the kernel language is pure.
- Captured East constants: ``EastArray`` / ``EastSet`` / ``EastDict`` /
  ``EastStruct`` values closed over by the lambda become build-time
  constants — a SNAPSHOT taken at trace time, constructed once when the
  kernel compiles (hoisted + identity-deduped, so a side-table referenced
  from many sites or inside a ``.map`` lambda never rebuilds per element).
  A multi-million-entry table belongs in a trailing parameter instead,
  pre-bound by reference with ``kernel(...).bind(table)`` (#399): zero-copy
  at any size, and the kernel observes later mutations — the explicit
  opt-in to live semantics, unlike the capture snapshot. Access methods on
  an eager collection accept traced keys and re-route through the tracer
  automatically.
- Options: construct with ``some(expr)`` / ``none`` (typed from a ``where``
  branch), consume with ``.is_some()`` / ``.is_none()`` / ``.unwrap_or()`` /
  ``.match()`` / ``.unwrap()``; ``.try_parse(T)`` parses a String strictly
  to ``Option<T>`` (``none`` on any parse failure).
- Struct results: return a dict literal — ``lambda r: {"a": …, "b": …}`` —
  so one kernel can emit every computed column in a single pass.

Traced kernels must be pure: the lambda runs ONCE at trace time (exactly
like a TypeScript ``East.function`` builder), so side effects do not repeat
per element. Each ``kernel()`` call compiles a fresh function; reuse the
returned kernel when calling in a loop. Shared python subexpressions are
re-emitted per use site (duplicated subtrees are semantically sound for
pure kernels; bind repeated work inside the traced expression itself where
size matters).
"""

from __future__ import annotations

import itertools
from typing import Any

from east.ir.builders import (
    ir_error,
    ir_get_field,
    ir_let,
    ir_trycatch,
    ir_value,
    ir_variable,
    ir_variant,
)
from east.types.type_of_type import EastTypeType
from east.types.types import (
    ArrayType,
    BooleanType,
    EastType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    StringType,
)
from east.types.values import EastArray, EastStruct, EastVariant

__all__ = ["kernel", "where", "greatest", "least", "KernelTraceError", "KernelExpr"]


class KernelTraceError(TypeError):
    """The lambda performed an operation that cannot be traced into East IR."""


# ─── Homoiconic IR construction (#398) ──────────────────────────────────────
#
# Every node is an East value conforming to IRType from the moment it is
# constructed (east/ir/builders.py), so malformed IR is unrepresentable and
# compilation converts the value tree directly (compile_from_value) with no
# serialization round-trip. Kernels carry no source locations: every node
# keeps the builders' default loc_id of 0 with no source map.


def _type_key(t: EastType) -> str:
    """A stable string key for a type (helper-kernel memoization)."""
    from east.serialization.json import encode_json_for

    encoded = encode_json_for(EastTypeType)(t)
    return encoded.decode("utf-8") if isinstance(encoded, bytes) else encoded


def _var(name: str, t: EastType):
    return ir_variable(t, name)


def _builtin(name: str, out: EastType, type_params: list[EastType], args: list):
    return _k_builtin(name, out, type_params, args)


def _literal(value: Any, t: EastType):
    """A Value node holding a literal, coerced per the declared East type."""
    tag = t.type
    coerced: Any
    if tag == "Null":
        coerced = None
    elif tag == "Boolean":
        coerced = bool(value)
    elif tag == "Integer":
        coerced = int(value)
    elif tag == "Float":
        coerced = float(value)
    elif tag == "String":
        coerced = str(value)
    else:
        raise KernelTraceError(f"cannot embed a literal of East type {tag} in a kernel")
    return ir_value(t, coerced)


# ─── Expression proxy ───────────────────────────────────────────────────────

_INT64_MIN = -(2**63)
_INT64_MAX = 2**63 - 1

_ARITH = {
    "add": ("IntegerAdd", "FloatAdd"),
    "sub": ("IntegerSubtract", "FloatSubtract"),
    "mul": ("IntegerMultiply", "FloatMultiply"),
    "mod": ("IntegerRemainder", "FloatRemainder"),
    "pow": ("IntegerPow", "FloatPow"),
}

_COMPARE = {
    "eq": "Equal",
    "ne": "NotEqual",
    "lt": "Less",
    "le": "LessEqual",
    "gt": "Greater",
    "ge": "GreaterEqual",
}


def _lift(value: Any, hint: EastType | None = None) -> KernelExpr:
    """Lift a python literal into a constant expression (bool before int!)."""
    from east.types.values import is_east_null

    if isinstance(value, KernelExpr):
        return value
    if value is None or is_east_null(value):
        return KernelExpr(_literal(None, NullType), NullType)
    if isinstance(value, bool):
        return KernelExpr(_literal(value, BooleanType), BooleanType)
    if isinstance(value, int):
        if hint is not None and hint.type == "Float":
            return KernelExpr(_literal(float(value), FloatType), FloatType)
        if not (_INT64_MIN <= value <= _INT64_MAX):
            raise KernelTraceError(f"integer literal {value} does not fit East's 64-bit Integer")
        return KernelExpr(_literal(value, IntegerType), IntegerType)
    if isinstance(value, float):
        return KernelExpr(_literal(value, FloatType), FloatType)
    if isinstance(value, str):
        return KernelExpr(_literal(value, StringType), StringType)
    lifted = _lift_variant(value, hint)
    if lifted is not None:
        return lifted
    lifted = _lift_collection(value)
    if lifted is not None:
        return lifted
    if isinstance(value, dict):
        return _lift_struct(value)
    raise KernelTraceError(
        f"cannot lift python value of type {type(value).__name__} into an East kernel expression"
    )


class _ConstRegistry:
    """Per-trace registry of captured constants, hoisted to kernel build.

    A captured East collection/struct is SNAPSHOT once: its constructor IR
    becomes a ``Let`` evaluated when the kernel compiles, and every use site
    (including inside nested lambdas) references the bound variable. Without
    hoisting the constructor would sit inline at the use site and re-build
    the constant on every evaluation — per row, or per ELEMENT inside a
    ``.map`` lambda, which is pathological for lookup tables. Entries are
    deduped by python object identity, so one table referenced at N sites
    binds once. Dependency order is construction order (inner constants of a
    nested constant register first).
    """

    __slots__ = ("by_id", "entries")

    def __init__(self) -> None:
        self.by_id: dict[int, tuple[str, EastType]] = {}
        self.entries: list[tuple[str, Any, EastType]] = []

    def register(self, value: Any, node: Any, t: EastType) -> KernelExpr:
        hit = self.by_id.get(id(value))
        if hit is None:
            name = _fresh_name()
            self.by_id[id(value)] = (name, t)
            self.entries.append((name, node, t))
        else:
            name, t = hit
        return KernelExpr(_var(name, t), t)


# The active (outermost) trace's constant registry; inner-lambda traces share
# it so constants hoist to the kernel scope. None outside any trace — then
# constants inline at the use site (correct, just unhoisted).
_const_registry: _ConstRegistry | None = None


def _register_const(value: Any, expr: KernelExpr) -> KernelExpr:
    if _const_registry is None:
        return expr
    return _const_registry.register(value, expr.ir, expr.east_type)


def _lift_collection(value: Any) -> KernelExpr | None:
    """Lift a captured East collection/struct constant (#393).

    The value snapshots into constructor IR (NewArray/NewSet/NewDict/Struct,
    each element lifted recursively) and — inside a trace — hoists to a
    kernel-build-time ``Let`` (see ``_ConstRegistry``), so a TRANS-style
    side-table is built once per compiled kernel, not per evaluation.
    Very large tables should bind by reference instead (no snapshot at
    all): declare a trailing parameter and use ``kernel(...).bind(table)``
    (#399).
    """
    from east.types.types import ArrayType as _ArrayType
    from east.types.types import DictType as _DictType
    from east.types.types import SetType as _SetType
    from east.types.values import EastDict, EastSet, is_east_struct

    if isinstance(value, EastArray):
        elem_t = value.element_type
        arr_t = _ArrayType(elem_t)
        nodes = [_lift(v, hint=elem_t).ir for v in value]
        return _register_const(
            value, KernelExpr(_k_new_array(arr_t, nodes), arr_t)
        )
    if isinstance(value, EastSet):
        elem_t = value.element_type
        set_t = _SetType(elem_t)
        nodes = [_lift(v, hint=elem_t).ir for v in value]
        return _register_const(
            value, KernelExpr(_k_new_set(set_t, nodes), set_t)
        )
    if isinstance(value, EastDict):
        k_t, v_t = value.key_type, value.value_type
        dict_t = _DictType(k_t, v_t)
        entries = [
            (_lift(k, hint=k_t).ir, _lift(v, hint=v_t).ir) for k, v in value.items()
        ]
        return _register_const(
            value,
            KernelExpr(_k_new_dict(dict_t, entries), dict_t),
        )
    if is_east_struct(value):
        # A captured struct constant (e.g. a config row) lifts field by field.
        return _register_const(value, _lift_struct({name: value[name] for name in value}))
    return None


def _lift_struct(value: dict) -> KernelExpr:
    """Lift a dict of traced expressions/literals into Struct IR.

    Lets kernels build rows naturally: ``lambda el, i: {"i": i, "v": el.x}``.
    """
    from east.types.types import StructType as _StructType

    fields = []
    field_types = []
    for name, item in value.items():
        if not isinstance(name, str):
            raise KernelTraceError("struct construction needs string field names")
        e = _lift(item)
        fields.append((name, e.ir))
        field_types.append((name, e.east_type))
    struct_t = _StructType(field_types)
    return KernelExpr(_k_struct(struct_t, fields), struct_t)


def _option_type(inner: EastType) -> EastType:
    from east.types.types import OptionType

    return OptionType(inner)


def _lift_variant(value: Any, hint: EastType | None) -> KernelExpr | None:
    """Lift `some(<traced expr>)` / the `none` constant into Variant IR.

    `east.some()` wraps without validating, so a traced lambda can build
    options with the ordinary constructors; `none` needs a type hint (from
    a `where` branch or the declared callback output).
    """
    from east.types.values import EastVariant, is_east_null, is_east_variant

    if not is_east_variant(value) or not isinstance(value, EastVariant):
        return None
    if value.type == "some":
        payload = value.value
        inner = _lift(payload) if not isinstance(payload, KernelExpr) else payload
        opt_t = _option_type(inner.east_type)
        node = ir_variant(opt_t, "some", inner.ir)
        return KernelExpr(node, opt_t)
    # `none.value` is the east_null sentinel, not Python None — test the sentinel
    # so this branch (and its type-from-context diagnostic) is actually reachable.
    if value.type == "none" and (is_east_null(value.value) or value.value is None):
        if hint is None or not _is_option(hint):
            raise KernelTraceError(
                "`none` in a traced kernel needs a type from context — pair it with a "
                "some(...) branch in where(), or let the method fall back"
            )
        node = ir_variant(hint, "none", _literal(None, NullType))
        return KernelExpr(node, hint)
    if hint is not None and hint.type == "Variant":
        # General variant construction: variant("case", payload) with the
        # type from context (e.g. a where() branch or a declared output);
        # the payload may be a traced expression or a liftable literal.
        case_t = next((c["type"] for c in hint.value if c["name"] == value.type), None)
        if case_t is None:
            names = ", ".join(c["name"] for c in hint.value)
            raise KernelTraceError(f"variant case {value.type!r} not in {{{names}}}")
        payload = _lift(value.value, hint=case_t)
        if payload.east_type != case_t:
            raise KernelTraceError(
                f"variant case {value.type!r} payload has type {payload.east_type.type}, "
                f"expected {case_t.type}"
            )
        node = ir_variant(hint, value.type, payload.ir)
        return KernelExpr(node, hint)
    if isinstance(value.value, KernelExpr):
        raise KernelTraceError(
            f"variant({value.type!r}, …) in a traced kernel needs a VariantType from context"
        )
    return None


def _is_option(t: EastType) -> bool:
    if t.type != "Variant" or len(t.value) != 2:
        return False
    return t.value[0]["name"] == "none" and t.value[1]["name"] == "some"


def _option_inner(t: EastType) -> EastType:
    return t.value[1]["type"]


def _trace_bail(op: str) -> KernelTraceError:
    return KernelTraceError(
        f"python `{op}` cannot be traced into an East kernel — use `&`, `|`, `~` for "
        "boolean logic and `where(cond, a, b)` for conditionals, or let the method "
        "fall back to the per-element python path"
    )


# The traced collection surface per container kind — every name is a real
# ``KernelExpr`` method. This is the enumeration the docs, the unsupported-
# method error, and the surface-coverage test all pin, so it cannot drift
# silently (#452). Mutators and side-effecting methods are deliberately
# absent: the kernel language is pure.
_TRACED_SURFACE = {
    "Array": tuple(sorted({
        "map", "filter", "filter_map", "first_map", "fold", "scan", "map_reduce",
        "flatten_to_array", "flatten_to_set", "to_dict", "to_set", "unique",
        "group_by", "sorted", "is_sorted", "some", "every", "string_join",
        "concat", "slice", "reversed", "copy", "get_keys",
        "size", "has", "get", "get_or_default", "try_get",
    })),
    "Set": tuple(sorted({
        "map", "filter", "filter_map", "first_map", "map_reduce", "scan",
        "flatten_to_array", "flatten_to_set", "to_array", "to_dict",
        "union", "intersect", "diff", "sym_diff", "is_subset", "is_disjoint",
        "copy", "size", "has",
    })),
    "Dict": tuple(sorted({
        "map", "filter", "filter_map", "first_map", "map_reduce", "scan",
        "flatten_to_array", "flatten_to_set", "to_array", "to_set", "to_dict",
        "keys_set", "get_keys", "copy",
        "size", "has", "get", "get_or_default", "try_get",
    })),
}


class KernelExpr:
    """A typed East expression under construction (returned to traced lambdas)."""

    __slots__ = ("ir", "east_type")
    __hash__ = None  # type: ignore[assignment]  # exprs are not usable as dict/set keys

    def __init__(self, ir: Any, east_type: EastType):
        self.ir = ir
        self.east_type = east_type

    def __repr__(self) -> str:
        return f"<KernelExpr {self.east_type.type}>"

    # ── struct field access ────────────────────────────────────────────

    def field(self, name: str) -> KernelExpr:
        """Access a struct field (also available as attribute / item access)."""
        if self.east_type.type != "Struct":
            raise KernelTraceError(
                f"field access `.{name}` on a non-struct expression ({self.east_type.type})"
            )
        for f in self.east_type.value:
            if f["name"] == name:
                out_t = f["type"]
                return KernelExpr(
                    ir_get_field(out_t, name, self.ir),
                    out_t,
                )
        available = ", ".join(f["name"] for f in self.east_type.value)
        raise KernelTraceError(f"struct has no field '{name}' (available: {available})")

    def __getattr__(self, name: str) -> KernelExpr:
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        if self.east_type.type in _TRACED_SURFACE:
            # A method miss on a collection-typed expression: name the traced
            # surface instead of the misleading "field access on a non-struct
            # expression" (#452).
            raise KernelTraceError(
                f"`.{name}` is not on the traced kernel surface for a "
                f"{self.east_type.type}-typed expression — supported: "
                f"{', '.join(_TRACED_SURFACE[self.east_type.type])}"
            )
        return self.field(name)

    def __getitem__(self, name: Any) -> KernelExpr:
        if self.east_type.type in ("Array", "Dict") and not isinstance(name, str):
            # `split(data, FM)[n]` / `table[key_expr]` — same as .get() (#393).
            return self.get(name)
        if not isinstance(name, str):
            raise _trace_bail(f"[{name!r}] indexing")
        if self.east_type.type == "Dict":
            return self.get(name)
        return self.field(name)

    # ── arithmetic ─────────────────────────────────────────────────────

    def _arith(self, op: str, other: Any, reflected: bool = False) -> KernelExpr:
        other = _lift(other, hint=self.east_type)
        lhs, rhs = (other, self) if reflected else (self, other)
        tag = lhs.east_type.type
        if tag != rhs.east_type.type or tag not in ("Integer", "Float"):
            raise KernelTraceError(
                f"arithmetic between {lhs.east_type.type} and {rhs.east_type.type} — East "
                "has no implicit numeric coercion; convert explicitly with .to_float()"
            )
        name = _ARITH[op][0 if tag == "Integer" else 1]
        return KernelExpr(_builtin(name, lhs.east_type, [], [lhs.ir, rhs.ir]), lhs.east_type)

    def __add__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "String":
            rhs = _lift(other)
            if rhs.east_type.type != "String":
                raise KernelTraceError("string concatenation needs a String on both sides")
            return KernelExpr(
                _builtin("StringConcat", StringType, [], [self.ir, rhs.ir]), StringType
            )
        return self._arith("add", other)

    def __radd__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "String":
            return _lift(other).__add__(self)
        return self._arith("add", other, reflected=True)

    def __sub__(self, other: Any) -> KernelExpr:
        return self._arith("sub", other)

    def __rsub__(self, other: Any) -> KernelExpr:
        return self._arith("sub", other, reflected=True)

    def __mul__(self, other: Any) -> KernelExpr:
        return self._arith("mul", other)

    def __rmul__(self, other: Any) -> KernelExpr:
        return self._arith("mul", other, reflected=True)

    def __mod__(self, other: Any) -> KernelExpr:
        return self._arith("mod", other)

    def __rmod__(self, other: Any) -> KernelExpr:
        return self._arith("mod", other, reflected=True)

    def __pow__(self, other: Any) -> KernelExpr:
        return self._arith("pow", other)

    def __rpow__(self, other: Any) -> KernelExpr:
        return self._arith("pow", other, reflected=True)

    def __truediv__(self, other: Any) -> KernelExpr:
        if self.east_type.type == "Integer":
            raise KernelTraceError(
                "`/` on East Integers is ambiguous — use `//` for integer division or "
                ".to_float() for float division"
            )
        other = _lift(other, hint=self.east_type)
        if other.east_type.type != "Float":
            raise KernelTraceError("float division needs Float on both sides")
        return KernelExpr(_builtin("FloatDivide", FloatType, [], [self.ir, other.ir]), FloatType)

    def __rtruediv__(self, other: Any) -> KernelExpr:
        return _lift(other, hint=self.east_type).__truediv__(self)

    def __floordiv__(self, other: Any) -> KernelExpr:
        if self.east_type.type != "Integer":
            raise KernelTraceError("`//` is East IntegerDivide — both sides must be Integer")
        other = _lift(other)
        if other.east_type.type != "Integer":
            raise KernelTraceError("`//` is East IntegerDivide — both sides must be Integer")
        return KernelExpr(
            _builtin("IntegerDivide", IntegerType, [], [self.ir, other.ir]), IntegerType
        )

    def __rfloordiv__(self, other: Any) -> KernelExpr:
        return _lift(other).__floordiv__(self)

    def __neg__(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return KernelExpr(_builtin("IntegerNegate", IntegerType, [], [self.ir]), IntegerType)
        if tag == "Float":
            return KernelExpr(_builtin("FloatNegate", FloatType, [], [self.ir]), FloatType)
        raise KernelTraceError(f"unary minus on {tag}")

    def __abs__(self) -> KernelExpr:
        return self.abs()

    # ── comparisons (East total order, generic over the operand type) ──

    def _compare(self, op: str, other: Any) -> KernelExpr:
        other = _lift(other, hint=self.east_type)
        if self.east_type != other.east_type:
            raise KernelTraceError(
                f"comparison between different East types "
                f"({self.east_type.type} vs {other.east_type.type})"
            )
        return KernelExpr(
            _builtin(_COMPARE[op], BooleanType, [self.east_type], [self.ir, other.ir]),
            BooleanType,
        )

    def __eq__(self, other: Any) -> KernelExpr:  # type: ignore[override]
        return self._compare("eq", other)

    def __ne__(self, other: Any) -> KernelExpr:  # type: ignore[override]
        return self._compare("ne", other)

    def __lt__(self, other: Any) -> KernelExpr:
        return self._compare("lt", other)

    def __le__(self, other: Any) -> KernelExpr:
        return self._compare("le", other)

    def __gt__(self, other: Any) -> KernelExpr:
        return self._compare("gt", other)

    def __ge__(self, other: Any) -> KernelExpr:
        return self._compare("ge", other)

    # ── boolean algebra (& | ^ ~ — python `and`/`or`/`not` can't overload) ──

    def _bool_op(self, name: str, other: Any) -> KernelExpr:
        other = _lift(other)
        if self.east_type.type != "Boolean" or other.east_type.type != "Boolean":
            raise KernelTraceError(f"{name} needs Boolean operands")
        return KernelExpr(_builtin(name, BooleanType, [], [self.ir, other.ir]), BooleanType)

    def __and__(self, other: Any) -> KernelExpr:
        return self._bool_op("BooleanAnd", other)

    def __rand__(self, other: Any) -> KernelExpr:
        return _lift(other)._bool_op("BooleanAnd", self)

    def __or__(self, other: Any) -> KernelExpr:
        return self._bool_op("BooleanOr", other)

    def __ror__(self, other: Any) -> KernelExpr:
        return _lift(other)._bool_op("BooleanOr", self)

    def __xor__(self, other: Any) -> KernelExpr:
        return self._bool_op("BooleanXor", other)

    def __invert__(self) -> KernelExpr:
        if self.east_type.type != "Boolean":
            raise KernelTraceError("`~` (not) needs a Boolean operand")
        return KernelExpr(_builtin("BooleanNot", BooleanType, [], [self.ir]), BooleanType)

    # ── conversions and math methods ────────────────────────────────────

    def to_float(self) -> KernelExpr:
        if self.east_type.type != "Integer":
            raise KernelTraceError(f".to_float() on {self.east_type.type} (needs Integer)")
        return KernelExpr(_builtin("IntegerToFloat", FloatType, [], [self.ir]), FloatType)

    def to_integer(self) -> KernelExpr:
        if self.east_type.type != "Float":
            raise KernelTraceError(f".to_integer() on {self.east_type.type} (needs Float)")
        return KernelExpr(_builtin("FloatToInteger", IntegerType, [], [self.ir]), IntegerType)

    def abs(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return KernelExpr(_builtin("IntegerAbs", IntegerType, [], [self.ir]), IntegerType)
        if tag == "Float":
            return KernelExpr(_builtin("FloatAbs", FloatType, [], [self.ir]), FloatType)
        raise KernelTraceError(f".abs() on {tag}")

    def sqrt(self) -> KernelExpr:
        if self.east_type.type != "Float":
            raise KernelTraceError(".sqrt() needs a Float")
        return KernelExpr(_builtin("FloatSqrt", FloatType, [], [self.ir]), FloatType)

    # ── string methods ─────────────────────────────────────────────────

    def _string_pred(self, name: str, other: Any) -> KernelExpr:
        other = _lift(other)
        if self.east_type.type != "String" or other.east_type.type != "String":
            raise KernelTraceError(f"{name} needs String operands")
        return KernelExpr(_builtin(name, BooleanType, [], [self.ir, other.ir]), BooleanType)

    def contains(self, other: Any) -> KernelExpr:
        return self._string_pred("StringContains", other)

    def starts_with(self, other: Any) -> KernelExpr:
        return self._string_pred("StringStartsWith", other)

    def ends_with(self, other: Any) -> KernelExpr:
        return self._string_pred("StringEndsWith", other)

    def upper(self) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".upper() needs a String")
        return KernelExpr(_builtin("StringUpperCase", StringType, [], [self.ir]), StringType)

    def lower(self) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".lower() needs a String")
        return KernelExpr(_builtin("StringLowerCase", StringType, [], [self.ir]), StringType)

    def strip(self) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".strip() needs a String")
        return KernelExpr(_builtin("StringTrim", StringType, [], [self.ir]), StringType)

    def length(self) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".length() needs a String")
        return KernelExpr(_builtin("StringLength", IntegerType, [], [self.ir]), IntegerType)

    # ── float / integer math tail ───────────────────────────────────────

    def _float_fn(self, name: str) -> KernelExpr:
        if self.east_type.type != "Float":
            raise KernelTraceError(f".{name.lower()}() needs a Float")
        return KernelExpr(_builtin(name, FloatType, [], [self.ir]), FloatType)

    def exp(self) -> KernelExpr:
        return self._float_fn("FloatExp")

    def log(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return KernelExpr(_builtin("IntegerLog", IntegerType, [], [self.ir]), IntegerType)
        return self._float_fn("FloatLog")

    def sin(self) -> KernelExpr:
        return self._float_fn("FloatSin")

    def cos(self) -> KernelExpr:
        return self._float_fn("FloatCos")

    def tan(self) -> KernelExpr:
        return self._float_fn("FloatTan")

    def sign(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Integer":
            return KernelExpr(_builtin("IntegerSign", IntegerType, [], [self.ir]), IntegerType)
        return self._float_fn("FloatSign")

    # ── string tail ────────────────────────────────────────────────────

    def _string_arg(self, name: str, other: Any) -> KernelExpr:
        arg = _lift(other)
        if self.east_type.type != "String" or arg.east_type.type != "String":
            raise KernelTraceError(f"{name} needs String operands")
        return arg

    def split(self, sep: Any) -> KernelExpr:
        from east.types.types import ArrayType as _ArrayType

        arg = self._string_arg("split", sep)
        out = _ArrayType(StringType)
        return KernelExpr(_builtin("StringSplit", out, [], [self.ir, arg.ir]), out)

    def replace(self, old: Any, new: Any) -> KernelExpr:
        a = self._string_arg("replace", old)
        b = self._string_arg("replace", new)
        return KernelExpr(_builtin("StringReplace", StringType, [], [self.ir, a.ir, b.ir]), StringType)

    def substring(self, start: Any, end: Any) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".substring() needs a String")
        s = _lift(start)
        e = _lift(end)
        if s.east_type.type != "Integer" or e.east_type.type != "Integer":
            raise KernelTraceError(".substring() bounds must be Integers")
        return KernelExpr(
            _builtin("StringSubstring", StringType, [], [self.ir, s.ir, e.ir]), StringType
        )

    def index_of(self, other: Any) -> KernelExpr:
        arg = self._string_arg("index_of", other)
        return KernelExpr(_builtin("StringIndexOf", IntegerType, [], [self.ir, arg.ir]), IntegerType)

    def repeat(self, count: Any) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".repeat() needs a String")
        n = _lift(count)
        if n.east_type.type != "Integer":
            raise KernelTraceError(".repeat() count must be an Integer")
        return KernelExpr(_builtin("StringRepeat", StringType, [], [self.ir, n.ir]), StringType)

    def lstrip(self) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".lstrip() needs a String")
        return KernelExpr(_builtin("StringTrimStart", StringType, [], [self.ir]), StringType)

    def rstrip(self) -> KernelExpr:
        if self.east_type.type != "String":
            raise KernelTraceError(".rstrip() needs a String")
        return KernelExpr(_builtin("StringTrimEnd", StringType, [], [self.ir]), StringType)

    def regex_contains(self, pattern: Any, flags: Any = "") -> KernelExpr:
        a = self._string_arg("regex_contains", pattern)
        f = self._string_arg("regex_contains", flags)
        return KernelExpr(
            _builtin("RegexContains", BooleanType, [], [self.ir, a.ir, f.ir]), BooleanType
        )

    def regex_index_of(self, pattern: Any, flags: Any = "") -> KernelExpr:
        a = self._string_arg("regex_index_of", pattern)
        f = self._string_arg("regex_index_of", flags)
        return KernelExpr(
            _builtin("RegexIndexOf", IntegerType, [], [self.ir, a.ir, f.ir]), IntegerType
        )

    def regex_replace(self, pattern: Any, replacement: Any, flags: Any = "") -> KernelExpr:
        a = self._string_arg("regex_replace", pattern)
        f = self._string_arg("regex_replace", flags)
        b = self._string_arg("regex_replace", replacement)
        return KernelExpr(
            _builtin("RegexReplace", StringType, [], [self.ir, a.ir, f.ir, b.ir]), StringType
        )

    # ── datetime ───────────────────────────────────────────────────────

    def _dt_get(self, name: str) -> KernelExpr:
        if self.east_type.type != "DateTime":
            raise KernelTraceError(f".{name}() needs a DateTime")
        builtin = {
            "get_year": "DateTimeGetYear",
            "get_month": "DateTimeGetMonth",
            "get_day_of_month": "DateTimeGetDayOfMonth",
            "get_day_of_week": "DateTimeGetDayOfWeek",
            "get_hour": "DateTimeGetHour",
            "get_minute": "DateTimeGetMinute",
            "get_second": "DateTimeGetSecond",
            "get_millisecond": "DateTimeGetMillisecond",
            "to_epoch_milliseconds": "DateTimeToEpochMilliseconds",
        }[name]
        return KernelExpr(_builtin(builtin, IntegerType, [], [self.ir]), IntegerType)

    def get_year(self) -> KernelExpr:
        return self._dt_get("get_year")

    def get_month(self) -> KernelExpr:
        return self._dt_get("get_month")

    def get_day_of_month(self) -> KernelExpr:
        return self._dt_get("get_day_of_month")

    def get_day_of_week(self) -> KernelExpr:
        return self._dt_get("get_day_of_week")

    def get_hour(self) -> KernelExpr:
        return self._dt_get("get_hour")

    def get_minute(self) -> KernelExpr:
        return self._dt_get("get_minute")

    def get_second(self) -> KernelExpr:
        return self._dt_get("get_second")

    def get_millisecond(self) -> KernelExpr:
        return self._dt_get("get_millisecond")

    def to_epoch_milliseconds(self) -> KernelExpr:
        return self._dt_get("to_epoch_milliseconds")

    def _dt_shift(self, amount: Any, scale: int, negate: bool) -> KernelExpr:
        if self.east_type.type != "DateTime":
            raise KernelTraceError("datetime arithmetic needs a DateTime")
        n = _lift(amount)
        if n.east_type.type == "Float":
            ms = (n * float(scale)).to_integer()
        elif n.east_type.type == "Integer":
            ms = n * scale
        else:
            raise KernelTraceError("datetime shift amount must be Integer or Float")
        if negate:
            ms = -ms
        from east.types.types import DateTimeType

        return KernelExpr(
            _builtin("DateTimeAddMilliseconds", DateTimeType, [], [self.ir, ms.ir]), DateTimeType
        )

    def add_milliseconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1, False)

    def add_seconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1000, False)

    def add_minutes(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 60_000, False)

    def add_hours(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 3_600_000, False)

    def add_days(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 86_400_000, False)

    def add_weeks(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 604_800_000, False)

    def subtract_milliseconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1, True)

    def subtract_seconds(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 1000, True)

    def subtract_minutes(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 60_000, True)

    def subtract_hours(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 3_600_000, True)

    def subtract_days(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 86_400_000, True)

    def subtract_weeks(self, n: Any) -> KernelExpr:
        return self._dt_shift(n, 604_800_000, True)

    def duration_milliseconds(self, other: Any) -> KernelExpr:
        if self.east_type.type != "DateTime":
            raise KernelTraceError(".duration_*() needs a DateTime")
        o = _lift(other)
        if o.east_type.type != "DateTime":
            raise KernelTraceError(".duration_*() other must be a DateTime")
        return KernelExpr(
            _builtin("DateTimeDurationMilliseconds", IntegerType, [], [self.ir, o.ir]), IntegerType
        )

    def _dt_duration(self, other: Any, scale: float) -> KernelExpr:
        return self.duration_milliseconds(other).to_float() / scale

    def duration_seconds(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 1000.0)

    def duration_minutes(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 60_000.0)

    def duration_hours(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 3_600_000.0)

    def duration_days(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 86_400_000.0)

    def duration_weeks(self, other: Any) -> KernelExpr:
        return self._dt_duration(other, 604_800_000.0)

    def print_format(self, fmt: Any) -> KernelExpr:
        """Format a DateTime with a Day.js-style format string.

        Like the TS `printFormatted`, the format must be a python string
        literal — it is tokenized at trace time (the builtin takes the token
        array, not the raw string).
        """
        if self.east_type.type != "DateTime":
            raise KernelTraceError(".print_format() needs a DateTime")
        if not isinstance(fmt, str):
            raise KernelTraceError(
                ".print_format() takes a literal format string (tokenized at trace time)"
            )
        from east.datetime_format import DateTimeFormatTokenType, tokenize_datetime_format
        from east.types.types import ArrayType as _ArrayType

        token_t = DateTimeFormatTokenType
        token_nodes = []
        for tok in tokenize_datetime_format(fmt):
            if tok.value is None or str(tok.value) == "null":
                payload = _literal(None, NullType)
            else:
                payload = _literal(str(tok.value), StringType)
            token_nodes.append(ir_variant(token_t, tok.type, payload))
        arr_t = _ArrayType(token_t)
        tokens_ir = _k_new_array(arr_t, token_nodes)
        return KernelExpr(
            _builtin("DateTimePrintFormat", StringType, [], [self.ir, tokens_ir]), StringType
        )

    # ── option access (Match IR) ───────────────────────────────────────

    def _match_option(self, some_body_fn: Any, none_value: KernelExpr, out_t: EastType) -> KernelExpr:
        if not _is_option(self.east_type):
            raise KernelTraceError(
                f"option access on a non-Option expression ({self.east_type.type})"
            )
        inner_t = _option_inner(self.east_type)
        some_var = _var("__m0", inner_t)
        some_body = some_body_fn(KernelExpr(some_var, inner_t))
        none_var = _var("__m1", NullType)
        node = _k_match(
            out_t,
            self.ir,
            [
                ("none", none_var, none_value.ir),
                ("some", some_var, some_body.ir),
            ],
        )
        return KernelExpr(node, out_t)

    def is_some(self) -> KernelExpr:
        return self._match_option(
            lambda _x: KernelExpr(_literal(True, BooleanType), BooleanType),
            KernelExpr(_literal(False, BooleanType), BooleanType),
            BooleanType,
        )

    def is_none(self) -> KernelExpr:
        return self._match_option(
            lambda _x: KernelExpr(_literal(False, BooleanType), BooleanType),
            KernelExpr(_literal(True, BooleanType), BooleanType),
            BooleanType,
        )

    def unwrap_or(self, default: Any) -> KernelExpr:
        if not _is_option(self.east_type):
            raise KernelTraceError(
                f".unwrap_or() on a non-Option expression ({self.east_type.type})"
            )
        inner_t = _option_inner(self.east_type)
        d = _lift(default, hint=inner_t)
        if d.east_type != inner_t:
            raise KernelTraceError(
                f".unwrap_or() default has type {d.east_type.type}, option holds {inner_t.type}"
            )
        return self._match_option(lambda x: x, d, inner_t)

    # ── general variant access (Match IR, like the TS variant expr) ─────

    def _variant_cases(self) -> list:
        if self.east_type.type != "Variant":
            raise KernelTraceError(
                f"variant access on a non-variant expression ({self.east_type.type})"
            )
        return list(self.east_type.value)

    def get_tag(self) -> KernelExpr:
        """The case name as a String (Match over every case)."""
        cases = []
        for i, c in enumerate(self._variant_cases()):
            var = _var(f"__t{i}", c["type"])
            cases.append((c["name"], var, _literal(c["name"], StringType)))
        node = _k_match(StringType, self.ir, cases)
        return KernelExpr(node, StringType)

    def has_tag(self, tag: str) -> KernelExpr:
        if not isinstance(tag, str):
            raise KernelTraceError(".has_tag() takes a literal case name")
        names = [c["name"] for c in self._variant_cases()]
        if tag not in names:
            raise KernelTraceError(f"variant has no case {tag!r} (cases: {', '.join(names)})")
        cases = []
        for i, c in enumerate(self._variant_cases()):
            var = _var(f"__t{i}", c["type"])
            cases.append((c["name"], var, _literal(c["name"] == tag, BooleanType)))
        node = _k_match(BooleanType, self.ir, cases)
        return KernelExpr(node, BooleanType)

    def match(self, cases: dict) -> KernelExpr:
        """Exhaustive traced match: {case: handler(payload_expr) -> expr}.

        Every case must be handled and all handler results must share one
        East type (a scalar handler value is lifted, with the other
        branches' type as the hint).
        """
        declared = self._variant_cases()
        names = [c["name"] for c in declared]
        missing = [n for n in names if n not in cases]
        extra = [n for n in cases if n not in names]
        if missing or extra:
            raise KernelTraceError(
                f".match() must handle exactly the variant's cases {names}; "
                f"missing {missing}, unknown {extra}"
            )
        results = []
        for i, c in enumerate(declared):
            var = _var(f"__t{i}", c["type"])
            handler = cases[c["name"]]
            raw = handler(KernelExpr(var, c["type"])) if callable(handler) else handler
            results.append((c["name"], var, raw))
        # settle the shared output type from the first traced result
        out_t = None
        for _, _, raw in results:
            if isinstance(raw, KernelExpr):
                out_t = raw.east_type
                break
        case_nodes = []
        for name, var, raw in results:
            body = _lift(raw, hint=out_t)
            if out_t is None:
                out_t = body.east_type
            elif body.east_type != out_t:
                raise KernelTraceError(
                    f".match() case {name!r} returns {body.east_type.type}, "
                    f"other cases return {out_t.type}"
                )
            case_nodes.append((name, var, body.ir))
        node = _k_match(out_t, self.ir, case_nodes)
        return KernelExpr(node, out_t)

    def unwrap(self, tag: str) -> KernelExpr:
        """The payload of `tag`; an East runtime error for any other case."""
        if not isinstance(tag, str):
            raise KernelTraceError(".unwrap() takes a literal case name")
        declared = self._variant_cases()
        target = next((c for c in declared if c["name"] == tag), None)
        if target is None:
            names = ", ".join(c["name"] for c in declared)
            raise KernelTraceError(f"variant has no case {tag!r} (cases: {names})")
        out_t = target["type"]
        case_nodes = []
        for i, c in enumerate(declared):
            var = _var(f"__t{i}", c["type"])
            if c["name"] == tag:
                body = var
            else:
                msg = _literal(f"unwrap: expected variant case '{tag}', got '{c['name']}'", StringType)
                body = ir_error(out_t, msg)
            case_nodes.append((c["name"], var, body))
        node = _k_match(out_t, self.ir, case_nodes)
        return KernelExpr(node, out_t)

    # ── scalar reads on collection-typed fields ─────────────────────────

    def size(self) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Array":
            return KernelExpr(
                _builtin("ArraySize", IntegerType, [self.east_type.value], [self.ir]), IntegerType
            )
        if tag == "Set":
            return KernelExpr(
                _builtin("SetSize", IntegerType, [self.east_type.value], [self.ir]), IntegerType
            )
        if tag == "Dict":
            kv = self.east_type.value
            return KernelExpr(
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
            return KernelExpr(
                _builtin("ArrayHas", BooleanType, [self.east_type.value], [self.ir, i.ir]),
                BooleanType,
            )
        if tag == "Set":
            k = _lift(item, hint=self.east_type.value)
            return KernelExpr(
                _builtin("SetHas", BooleanType, [self.east_type.value], [self.ir, k.ir]),
                BooleanType,
            )
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(item, hint=kv["key"])
            return KernelExpr(
                _builtin("DictHas", BooleanType, [kv["key"], kv["value"]], [self.ir, k.ir]),
                BooleanType,
            )
        raise KernelTraceError(f".has() on {tag}")

    def get(self, key: Any) -> KernelExpr:
        tag = self.east_type.type
        if tag == "Array":
            i = _lift(key)
            if i.east_type.type != "Integer":
                raise KernelTraceError("Array.get() takes an Integer index")
            elem_t = self.east_type.value
            return KernelExpr(
                _builtin("ArrayGet", elem_t, [elem_t], [self.ir, i.ir]), elem_t
            )
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(key, hint=kv["key"])
            return KernelExpr(
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
            return KernelExpr(
                _builtin("ArrayGetOrDefault", elem_t, [elem_t], [self.ir, i.ir, fn]), elem_t
            )
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(key, hint=kv["key"])
            d = _lift(default, hint=kv["value"])
            fn = _const_fn_node([kv["key"]], d, kv["value"])
            return KernelExpr(
                _builtin(
                    "DictGetOrDefault", kv["value"], [kv["key"], kv["value"]], [self.ir, k.ir, fn]
                ),
                kv["value"],
            )
        raise KernelTraceError(f".get_or_default() on {tag}")

    # ── collection transforms (nested lambdas traced recursively, #393) ──

    def _array_elem(self, op: str) -> EastType:
        if self.east_type.type != "Array":
            raise KernelTraceError(f".{op}() on {self.east_type.type} (needs Array)")
        return self.east_type.value

    def map(self, fn: Any) -> KernelExpr:
        """Traced map, shaped like the eager methods: Array → Array of
        ``fn(element)`` (``fn(element, index)`` also accepted), Set → Dict of
        element to ``fn(element)`` (SetMap), Dict → Dict with mapped values and
        the keys kept (DictMap, ``fn(value)`` or ``fn(value, key)``)."""
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import DictType as _DictType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t, IntegerType])
            return KernelExpr(
                _builtin("ArrayMap", _ArrayType(out_t), [elem_t, out_t], [self.ir, node]),
                _ArrayType(out_t),
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1)
            out = _DictType(elem_t, out_t)
            return KernelExpr(
                _builtin("SetMap", out, [elem_t, out_t], [self.ir, node]), out
            )
        if tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [kv["value"], kv["key"]])
            out = _DictType(kv["key"], out_t)
            return KernelExpr(
                _builtin("DictMap", out, [kv["key"], kv["value"], out_t], [self.ir, node]),
                out,
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
            node, out_t = _trace_inner_fn(fn, [elem_t, IntegerType])
            if out_t.type != "Boolean":
                raise KernelTraceError(f".filter() predicate must return Boolean, got {out_t.type}")
            out = _ArrayType(elem_t)
            return KernelExpr(_builtin("ArrayFilter", out, [elem_t], [self.ir, node]), out)
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1)
            if out_t.type != "Boolean":
                raise KernelTraceError(f".filter() predicate must return Boolean, got {out_t.type}")
            out = _SetType(elem_t)
            return KernelExpr(_builtin("SetFilter", out, [elem_t], [self.ir, node]), out)
        if tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2
            )
            if out_t.type != "Boolean":
                raise KernelTraceError(f".filter() predicate must return Boolean, got {out_t.type}")
            out = _DictType(kv["key"], kv["value"])
            return KernelExpr(
                _builtin("DictFilter", out, [kv["key"], kv["value"]], [self.ir, node]), out
            )
        raise KernelTraceError(f".filter() on {tag}")

    def fold(self, initial: Any, fn: Any) -> KernelExpr:
        """Traced ArrayFold: ``fn(acc, element)`` or ``fn(acc, element, index)``."""
        elem_t = self._array_elem("fold")
        init = _lift(initial)
        acc_t = init.east_type
        node, out_t = _trace_inner_fn(fn, [acc_t, elem_t, IntegerType])
        if out_t != acc_t:
            raise KernelTraceError(
                f".fold() step returns {out_t.type}, accumulator is {acc_t.type}"
            )
        return KernelExpr(
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
            node, out_t = _trace_inner_fn(fn, [acc_t, elem_t, IntegerType])
            if out_t != acc_t:
                raise KernelTraceError(
                    f".scan() step returns {out_t.type}, accumulator is {acc_t.type}"
                )
            out = _ArrayType(acc_t)
            return KernelExpr(
                _builtin("ArrayScan", out, [elem_t, acc_t], [self.ir, init.ir, node]), out
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [acc_t, elem_t], declared=2)
            if out_t != acc_t:
                raise KernelTraceError(
                    f".scan() step returns {out_t.type}, accumulator is {acc_t.type}"
                )
            out = _ArrayType(acc_t)
            return KernelExpr(
                _builtin("SetScan", out, [elem_t, acc_t], [self.ir, node, init.ir]), out
            )
        if tag == "Dict":
            kv = self.east_type.value
            # The builtin's callback signature is (acc, value, key); the user
            # fn takes (acc, key, value) like the eager method.
            node, out_t = _trace_inner_fn(
                lambda a, v, k: fn(a, k, v), [acc_t, kv["value"], kv["key"]], declared=3
            )
            if out_t != acc_t:
                raise KernelTraceError(
                    f".scan() step returns {out_t.type}, accumulator is {acc_t.type}"
                )
            out = _ArrayType(acc_t)
            return KernelExpr(
                _builtin(
                    "DictScan", out, [kv["key"], kv["value"], acc_t], [self.ir, node, init.ir]
                ),
                out,
            )
        raise KernelTraceError(f".scan() on {tag}")

    def some(self, fn: Any) -> KernelExpr:
        """Traced any-element predicate (native short-circuiting FirstMap scan)."""
        return self._quantifier("some", fn)

    def every(self, fn: Any) -> KernelExpr:
        """Traced all-elements predicate (native short-circuiting FirstMap scan)."""
        return self._quantifier("every", fn)

    def _quantifier(self, op: str, fn: Any) -> KernelExpr:
        """some/every as an ArrayFirstMap probe that yields ``some(True)`` on
        the deciding element — the scan short-circuits exactly like the eager
        ``_first_map_bool`` path (#403), where the previous fold encoding
        evaluated the predicate for every element.
        """
        elem_t = self._array_elem(op)
        code = getattr(fn, "__code__", None)
        arity = code.co_argcount if code is not None else 1
        want = op == "some"
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        def probe(el: KernelExpr, i: KernelExpr) -> KernelExpr:
            pred = _lift(fn(*([el, i][:arity])))
            if pred.east_type.type != "Boolean":
                raise KernelTraceError(
                    f".{op}() predicate must return Boolean, got {pred.east_type.type}"
                )
            decided = pred if want else ~pred
            return where(decided, _some(True), _none)

        node, out_t = _trace_inner_fn(probe, [elem_t, IntegerType], declared=2)
        scanned = KernelExpr(
            _builtin("ArrayFirstMap", out_t, [elem_t, BooleanType], [self.ir, node]), out_t
        )
        # some: a deciding element exists; every: no counterexample exists.
        # FirstMap on an empty array yields none, so some([])=False and
        # every([])=True fall out — matching the eager path exactly.
        return scanned.is_some() if want else scanned.is_none()

    def first_map(self, fn: Any, out: EastType | None = None) -> KernelExpr:
        """Traced early-exit scan: the first ``some(value)`` that ``fn``
        produces (native ``Array``/``Set``/``Dict`` FirstMap — the scan stops
        at the first ``some``, #403).

        ``fn`` takes an element (or ``(key, value)`` for dicts) and returns
        ``some(expr)`` / ``none`` — typically ``where(pred, some(x), none)``.
        The result is ``Option<T>``; consume it with ``.is_some()`` /
        ``.unwrap_or()`` / ``.match()``. ``out`` pins the ``some`` payload
        type when the lambda alone cannot (e.g. a bare ``none`` arm outside
        ``where``).
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
                raise KernelTraceError(
                    ".first_map() lambda must return some(...)/none, got "
                    f"{out_t.type}"
                )
            inner_t = _option_inner(out_t)
            return KernelExpr(
                _builtin("ArrayFirstMap", out_t, [elem_t, inner_t], [self.ir, node]), out_t
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(lambda el: lift_result(fn(el)), [elem_t], declared=1)
            if not _is_option(out_t):
                raise KernelTraceError(
                    ".first_map() lambda must return some(...)/none, got "
                    f"{out_t.type}"
                )
            inner_t = _option_inner(out_t)
            return KernelExpr(
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
                raise KernelTraceError(
                    ".first_map() lambda must return some(...)/none, got "
                    f"{out_t.type}"
                )
            inner_t = _option_inner(out_t)
            return KernelExpr(
                _builtin(
                    "DictFirstMap", out_t, [kv["key"], kv["value"], inner_t], [self.ir, node]
                ),
                out_t,
            )
        raise KernelTraceError(f".first_map() on {tag}")

    def string_join(self, separator: Any) -> KernelExpr:
        """Traced ArrayStringJoin over an Array<String>."""
        elem_t = self._array_elem("string_join")
        if elem_t.type != "String":
            raise KernelTraceError(".string_join() needs an Array<String>")
        sep = _lift(separator)
        if sep.east_type.type != "String":
            raise KernelTraceError(".string_join() separator must be a String")
        return KernelExpr(
            _builtin("ArrayStringJoin", StringType, [], [self.ir, sep.ir]), StringType
        )

    # ── the rest of the collection surface (#452) ───────────────────────
    # Callback-taking builtins the eager path already emits, exposed on the
    # traced surface with the same shapes. With no loop IR, these ARE the
    # kernel language's iteration constructs — a missing one bounds what a
    # single kernel can express (the two-stage flatten split).

    def _option_callback(self, fn: Any, param_types: list, declared: int) -> tuple:
        node, out_t = _trace_inner_fn(fn, param_types, declared=declared)
        if not _is_option(out_t):
            raise KernelTraceError(
                f"callback must return some(...)/none, got {out_t.type}"
            )
        return node, _option_inner(out_t)

    def filter_map(self, fn: Any) -> KernelExpr:
        """Traced filter+map in one pass: Array → Array of unwrapped ``some``
        values; Set → Dict of kept element to value; Dict → Dict of kept key
        to value (``fn(key, value)``)."""
        from east.types.types import ArrayType as _ArrayType
        from east.types.types import DictType as _DictType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, inner_t = self._option_callback(
                lambda el, _i: fn(el), [elem_t, IntegerType], 2)
            out = _ArrayType(inner_t)
            return KernelExpr(
                _builtin("ArrayFilterMap", out, [elem_t, inner_t], [self.ir, node]), out
            )
        if tag == "Set":
            elem_t = self.east_type.value
            node, inner_t = self._option_callback(fn, [elem_t], 1)
            out = _DictType(elem_t, inner_t)
            return KernelExpr(
                _builtin("SetFilterMap", out, [elem_t, inner_t], [self.ir, node]), out
            )
        if tag == "Dict":
            kv = self.east_type.value
            node, inner_t = self._option_callback(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], 2)
            out = _DictType(kv["key"], inner_t)
            return KernelExpr(
                _builtin("DictFilterMap", out, [kv["key"], kv["value"], inner_t],
                         [self.ir, node]),
                out,
            )
        raise KernelTraceError(f".filter_map() on {tag}")

    def flatten_to_array(self, fn: Any) -> KernelExpr:
        """Traced flatten: concatenate the arrays ``fn`` produces per element
        (per entry for a Dict, ``fn(key, value)``) — the operation whose
        absence forced two-stage kernels with a materialised intermediate."""
        from east.types.types import ArrayType as _ArrayType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda el, _i: fn(el), [elem_t, IntegerType], declared=2)
            builtin, tps = "ArrayFlattenToArray", [elem_t]
        elif tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1)
            builtin, tps = "SetFlattenToArray", [elem_t]
        elif tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2)
            builtin, tps = "DictFlattenToArray", [kv["key"], kv["value"]]
        else:
            raise KernelTraceError(f".flatten_to_array() on {tag}")
        if out_t.type != "Array":
            raise KernelTraceError(
                f".flatten_to_array() callback must return an Array, got {out_t.type}")
        inner_t = out_t.value
        out = _ArrayType(inner_t)
        return KernelExpr(_builtin(builtin, out, [*tps, inner_t], [self.ir, node]), out)

    def flatten_to_set(self, fn: Any) -> KernelExpr:
        """Traced flatten into a set: union the sets ``fn`` produces."""
        from east.types.types import SetType as _SetType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda el, _i: fn(el), [elem_t, IntegerType], declared=2)
            builtin, tps = "ArrayFlattenToSet", [elem_t]
        elif tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _trace_inner_fn(fn, [elem_t], declared=1)
            builtin, tps = "SetFlattenToSet", [elem_t]
        elif tag == "Dict":
            kv = self.east_type.value
            node, out_t = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2)
            builtin, tps = "DictFlattenToSet", [kv["key"], kv["value"]]
        else:
            raise KernelTraceError(f".flatten_to_set() on {tag}")
        if out_t.type != "Set":
            raise KernelTraceError(
                f".flatten_to_set() callback must return a Set, got {out_t.type}")
        inner_t = out_t.value
        out = _SetType(inner_t)
        return KernelExpr(_builtin(builtin, out, [*tps, inner_t], [self.ir, node]), out)

    def map_reduce(self, map_fn: Any, reduce_fn: Any) -> KernelExpr:
        """Traced map-then-pairwise-combine (errors at run time on empty, like
        the eager method). Dict's ``map_fn`` takes ``(key, value)``."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            map_node, t2 = _trace_inner_fn(
                lambda el, _i: map_fn(el), [elem_t, IntegerType], declared=2)
            builtin, tps = "ArrayMapReduce", [elem_t]
        elif tag == "Set":
            elem_t = self.east_type.value
            map_node, t2 = _trace_inner_fn(map_fn, [elem_t], declared=1)
            builtin, tps = "SetMapReduce", [elem_t]
        elif tag == "Dict":
            kv = self.east_type.value
            map_node, t2 = _trace_inner_fn(
                lambda v, k: map_fn(k, v), [kv["value"], kv["key"]], declared=2)
            builtin, tps = "DictMapReduce", [kv["key"], kv["value"]]
        else:
            raise KernelTraceError(f".map_reduce() on {tag}")
        reduce_node, r_out = _trace_inner_fn(reduce_fn, [t2, t2], declared=2)
        if r_out != t2:
            raise KernelTraceError(
                f".map_reduce() reduce returns {r_out.type}, mapped values are {t2.type}")
        return KernelExpr(
            _builtin(builtin, t2, [*tps, t2], [self.ir, map_node, reduce_node]), t2
        )

    def _second_wins_node(self, t2: EastType, k2: EastType):
        v1 = _var(_fresh_name(), t2)
        v2 = _var(_fresh_name(), t2)
        ck = _var(_fresh_name(), k2)
        return _k_function(FunctionType([t2, t2, k2], t2), [], [v1, v2, ck], v2)

    def to_dict(self, key: Any, value: Any = None, combine: Any = None) -> KernelExpr:
        """Traced ArrayToDict / DictToDict, shaped like the eager methods:
        Array keys by ``key(element)`` with ``value(element)`` (the element
        itself when omitted) and later-wins collisions unless ``combine``;
        Dict re-keys with ``key(key, value)`` / ``value(key, value)``."""
        from east.types.types import DictType as _DictType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            key_node, k2 = _trace_inner_fn(
                lambda el, _i: key(el), [elem_t, IntegerType], declared=2)
            val = value if value is not None else (lambda el: el)
            val_node, t2 = _trace_inner_fn(
                lambda el, _i: val(el), [elem_t, IntegerType], declared=2)
            if combine is None:
                combine_node = self._second_wins_node(t2, k2)
            else:
                combine_node, c_out = _trace_inner_fn(
                    lambda a, b, _k: combine(a, b), [t2, t2, k2], declared=3)
                if c_out != t2:
                    raise KernelTraceError(
                        f".to_dict() combine returns {c_out.type}, values are {t2.type}")
            out = _DictType(k2, t2)
            return KernelExpr(
                _builtin("ArrayToDict", out, [elem_t, k2, t2],
                         [self.ir, key_node, val_node, combine_node]),
                out,
            )
        if tag == "Dict":
            kv = self.east_type.value
            key_node, k2 = _trace_inner_fn(
                lambda v, k: key(k, v), [kv["value"], kv["key"]], declared=2)
            if value is None:
                val_node, t2 = _trace_inner_fn(
                    lambda v, _k: v, [kv["value"], kv["key"]], declared=2)
            else:
                val_node, t2 = _trace_inner_fn(
                    lambda v, k: value(k, v), [kv["value"], kv["key"]], declared=2)
            if combine is None:
                combine_node = self._second_wins_node(t2, k2)
            else:
                combine_node, c_out = _trace_inner_fn(combine, [t2, t2, k2], declared=3)
                if c_out != t2:
                    raise KernelTraceError(
                        f".to_dict() combine returns {c_out.type}, values are {t2.type}")
            out = _DictType(k2, t2)
            return KernelExpr(
                _builtin("DictToDict", out, [kv["key"], kv["value"], k2, t2],
                         [self.ir, key_node, val_node, combine_node]),
                out,
            )
        if tag == "Set":
            elem_t = self.east_type.value
            key_node, k2 = _trace_inner_fn(key, [elem_t], declared=1)
            if value is None:
                raise KernelTraceError(".to_dict() on a Set needs a value fn(element)")
            val_node, t2 = _trace_inner_fn(value, [elem_t], declared=1)
            if combine is None:
                combine_node = self._second_wins_node(t2, k2)
            else:
                combine_node, c_out = _trace_inner_fn(combine, [t2, t2, k2], declared=3)
                if c_out != t2:
                    raise KernelTraceError(
                        f".to_dict() combine returns {c_out.type}, values are {t2.type}")
            out = _DictType(k2, t2)
            return KernelExpr(
                _builtin("SetToDict", out, [elem_t, k2, t2],
                         [self.ir, key_node, val_node, combine_node]),
                out,
            )
        raise KernelTraceError(f".to_dict() on {tag}")

    def to_set(self, key: Any = None) -> KernelExpr:
        """Traced ArrayToSet / DictToSet: the set of elements or projections
        (``key(key, value)`` for a Dict, where it is required)."""
        from east.types.types import SetType as _SetType

        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            proj = key if key is not None else (lambda el: el)
            node, k2 = _trace_inner_fn(
                lambda el, _i: proj(el), [elem_t, IntegerType], declared=2)
            out = _SetType(k2)
            return KernelExpr(
                _builtin("ArrayToSet", out, [elem_t, k2], [self.ir, node]), out
            )
        if tag == "Dict":
            if key is None:
                raise KernelTraceError(".to_set() on a Dict needs a projection fn(key, value)")
            kv = self.east_type.value
            node, k2 = _trace_inner_fn(
                lambda v, k: key(k, v), [kv["value"], kv["key"]], declared=2)
            out = _SetType(k2)
            return KernelExpr(
                _builtin("DictToSet", out, [kv["key"], kv["value"], k2], [self.ir, node]),
                out,
            )
        raise KernelTraceError(f".to_set() on {tag}")

    def unique(self) -> KernelExpr:
        """Traced distinct elements (ArrayToSet with the identity key)."""
        return self.to_set()

    def to_array(self, fn: Any = None) -> KernelExpr:
        """Traced SetToArray / DictToArray: elements (or projections) in East
        order; a Dict projects with ``fn(key, value)`` (required)."""
        from east.types.types import ArrayType as _ArrayType

        tag = self.east_type.type
        if tag == "Set":
            elem_t = self.east_type.value
            proj = fn if fn is not None else (lambda el: el)
            node, t2 = _trace_inner_fn(proj, [elem_t], declared=1)
            out = _ArrayType(t2)
            return KernelExpr(
                _builtin("SetToArray", out, [elem_t, t2], [self.ir, node]), out
            )
        if tag == "Dict":
            if fn is None:
                raise KernelTraceError(".to_array() on a Dict needs a projection fn(key, value)")
            kv = self.east_type.value
            node, t2 = _trace_inner_fn(
                lambda v, k: fn(k, v), [kv["value"], kv["key"]], declared=2)
            out = _ArrayType(t2)
            return KernelExpr(
                _builtin("DictToArray", out, [kv["key"], kv["value"], t2], [self.ir, node]),
                out,
            )
        raise KernelTraceError(f".to_array() on {tag}")

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
        return KernelExpr(
            _builtin("ArrayGroupFold", out, [elem_t, k2, bucket_t],
                     [self.ir, key_node, init_node, fold_node]),
            out,
        )

    def sorted(self, key: Any = None, *, reverse: bool = False) -> KernelExpr:
        """Traced ArraySort/ArraySortDefault (+ ArrayReverse for ``reverse``),
        ordering by East's total order like the eager method."""
        from east.types.types import ArrayType as _ArrayType

        elem_t = self._array_elem("sorted")
        out = _ArrayType(elem_t)
        if key is None:
            expr = KernelExpr(
                _builtin("ArraySortDefault", out, [elem_t], [self.ir]), out)
        else:
            node, t2 = _trace_inner_fn(key, [elem_t], declared=1)
            expr = KernelExpr(
                _builtin("ArraySort", out, [elem_t, t2], [self.ir, node]), out)
        if reverse:
            expr = KernelExpr(_builtin("ArrayReverse", out, [elem_t], [expr.ir]), out)
        return expr

    def is_sorted(self, key: Any = None) -> KernelExpr:
        """Traced ArrayIsSorted: whether elements (or key projections) are in
        non-decreasing East order."""
        elem_t = self._array_elem("is_sorted")
        if key is None:
            v = _var(_fresh_name(), elem_t)
            node = _k_function(FunctionType([elem_t], elem_t), [], [v], v)
            t2 = elem_t
        else:
            node, t2 = _trace_inner_fn(key, [elem_t], declared=1)
        return KernelExpr(
            _builtin("ArrayIsSorted", BooleanType, [elem_t, t2], [self.ir, node]),
            BooleanType,
        )

    def _same_typed(self, op: str, other: Any) -> KernelExpr:
        """Lift ``other`` and require it to share this expression's East type."""
        o = _lift(other, hint=self.east_type)
        if o.east_type != self.east_type:
            raise KernelTraceError(
                f".{op}() operand has East type {o.east_type.type}, "
                f"this expression is {self.east_type.type} of a different shape"
            )
        return o

    def concat(self, other: Any) -> KernelExpr:
        """Traced ArrayConcat: this array with ``other`` appended."""
        elem_t = self._array_elem("concat")
        o = self._same_typed("concat", other)
        return KernelExpr(
            _builtin("ArrayConcat", self.east_type, [elem_t], [self.ir, o.ir]),
            self.east_type,
        )

    def slice(self, start: Any, end: Any) -> KernelExpr:
        """Traced ArraySlice over the half-open ``[start, end)`` range; the
        bounds may be python ints or traced Integer expressions."""
        elem_t = self._array_elem("slice")
        s = _lift(start)
        e = _lift(end)
        if s.east_type.type != "Integer" or e.east_type.type != "Integer":
            raise KernelTraceError(".slice() bounds must be Integers")
        return KernelExpr(
            _builtin("ArraySlice", self.east_type, [elem_t], [self.ir, s.ir, e.ir]),
            self.east_type,
        )

    def reversed(self) -> KernelExpr:
        """Traced ArrayReverse: the elements in reverse order."""
        elem_t = self._array_elem("reversed")
        return KernelExpr(
            _builtin("ArrayReverse", self.east_type, [elem_t], [self.ir]),
            self.east_type,
        )

    def copy(self) -> KernelExpr:
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
            raise KernelTraceError(f".copy() on {tag}")
        return KernelExpr(
            _builtin(builtin, self.east_type, tps, [self.ir]), self.east_type
        )

    def get_keys(self, keys: Any, fill: Any = None) -> KernelExpr:
        """Traced gather: Array takes an ``Array<Integer>`` of indices
        (ArrayGetKeys); Dict takes a ``Set`` of keys plus a required
        ``fill(key)`` for the absent ones (DictGetKeys)."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            idx = _lift(keys)
            if idx.east_type != ArrayType(IntegerType):
                raise KernelTraceError(".get_keys() takes an Array<Integer> of indices")
            node, out_t = _trace_inner_fn(
                lambda i: self.get(i), [IntegerType], declared=1)
            return KernelExpr(
                _builtin("ArrayGetKeys", self.east_type, [elem_t],
                         [self.ir, idx.ir, node]),
                self.east_type,
            )
        if tag == "Dict":
            if fill is None:
                raise KernelTraceError(".get_keys() on a Dict needs fill(key)")
            kv = self.east_type.value
            ks = _lift(keys)
            from east.types.types import SetType as _SetType

            if ks.east_type != _SetType(kv["key"]):
                raise KernelTraceError(
                    ".get_keys() takes a Set of this dict's key type")
            fill_node, f_out = _trace_inner_fn(fill, [kv["key"]], declared=1)
            if f_out != kv["value"]:
                raise KernelTraceError(
                    f".get_keys() fill returns {f_out.type}, values are {kv['value'].type}")
            return KernelExpr(
                _builtin("DictGetKeys", self.east_type, [kv["key"], kv["value"]],
                         [self.ir, ks.ir, fill_node]),
                self.east_type,
            )
        raise KernelTraceError(f".get_keys() on {tag}")

    def _set_algebra(self, builtin: str, op: str, other: Any, out_t: EastType | None = None) -> KernelExpr:
        if self.east_type.type != "Set":
            raise KernelTraceError(f".{op}() on {self.east_type.type} (needs Set)")
        o = self._same_typed(op, other)
        out = out_t if out_t is not None else self.east_type
        return KernelExpr(
            _builtin(builtin, out, [self.east_type.value], [self.ir, o.ir]), out
        )

    def union(self, other: Any) -> KernelExpr:
        """Traced SetUnion."""
        return self._set_algebra("SetUnion", "union", other)

    def intersect(self, other: Any) -> KernelExpr:
        """Traced SetIntersect."""
        return self._set_algebra("SetIntersect", "intersect", other)

    def diff(self, other: Any) -> KernelExpr:
        """Traced SetDiff: elements in this set but not ``other``."""
        return self._set_algebra("SetDiff", "diff", other)

    def sym_diff(self, other: Any) -> KernelExpr:
        """Traced SetSymDiff: elements in exactly one of the sets."""
        return self._set_algebra("SetSymDiff", "sym_diff", other)

    def is_subset(self, other: Any) -> KernelExpr:
        """Traced SetIsSubset."""
        return self._set_algebra("SetIsSubset", "is_subset", other, BooleanType)

    def is_disjoint(self, other: Any) -> KernelExpr:
        """Traced SetIsDisjoint."""
        return self._set_algebra("SetIsDisjoint", "is_disjoint", other, BooleanType)

    def keys_set(self) -> KernelExpr:
        """Traced DictKeys: this dict's keys as a Set."""
        from east.types.types import SetType as _SetType

        if self.east_type.type != "Dict":
            raise KernelTraceError(f".keys_set() on {self.east_type.type} (needs Dict)")
        kv = self.east_type.value
        out = _SetType(kv["key"])
        return KernelExpr(
            _builtin("DictKeys", out, [kv["key"], kv["value"]], [self.ir]), out
        )

    def try_get(self, key: Any) -> KernelExpr:
        """Traced optional access: ``some(value)`` in bounds / present, else ``none``."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            i = _lift(key)
            if i.east_type.type != "Integer":
                raise KernelTraceError("Array.try_get() takes an Integer index")
            out = _option_type(elem_t)
            return KernelExpr(_builtin("ArrayTryGet", out, [elem_t], [self.ir, i.ir]), out)
        if tag == "Dict":
            kv = self.east_type.value
            k = _lift(key, hint=kv["key"])
            out = _option_type(kv["value"])
            return KernelExpr(
                _builtin("DictTryGet", out, [kv["key"], kv["value"]], [self.ir, k.ir]), out
            )
        raise KernelTraceError(f".try_get() on {tag}")

    # ── strict optional parse (TryCatch IR, #392/#393) ──────────────────

    def try_parse(self, t: EastType) -> KernelExpr:
        """Parse this String as ``t``; ``some(value)`` on success, ``none`` on
        any parse failure (the strict whole-string parse of #392 wrapped in
        TryCatch IR). ``where(x.is_some(), …)`` / ``.unwrap_or(…)`` consume it.
        """
        if self.east_type.type != "String":
            raise KernelTraceError(".try_parse() needs a String")
        if not isinstance(t, EastType):
            raise KernelTraceError(".try_parse() takes an East type")
        from east.types.types import StructType as _StructType

        out_t = _option_type(t)
        parsed = _builtin("Parse", t, [t], [self.ir])
        some_node = ir_variant(out_t, "some", parsed)
        none_node = ir_variant(out_t, "none", _literal(None, NullType))
        loc_t = _StructType(
            [("filename", StringType), ("line", IntegerType), ("column", IntegerType)]
        )
        node = ir_trycatch(
            out_t,
            some_node,
            none_node,
            _var(_fresh_name(), StringType),
            _var(_fresh_name(), ArrayType(loc_t)),
            finally_body=_literal(None, NullType),
        )
        return KernelExpr(node, out_t)

    # ── operations that cannot be traced (fail loud, fall back) ─────────

    def __bool__(self) -> bool:
        raise _trace_bail("if/and/or/not")

    def __iter__(self):
        raise _trace_bail("iteration")

    def __len__(self) -> int:
        raise _trace_bail("len()")

    def __float__(self) -> float:
        raise _trace_bail("float()")

    def __int__(self) -> int:
        raise _trace_bail("int()")

    def __index__(self) -> int:
        raise _trace_bail("index()")

    def __contains__(self, item: Any) -> bool:
        raise _trace_bail("in")


def _free_vars(node: Any, bound: frozenset, out: dict) -> None:
    """Collect Variable nodes under ``node`` not bound within it, by name.

    A nested Function IR node must LIST outer variables it uses in its
    ``captures`` — east-c resolves captures from the enclosing scope when the
    function value is created, and an unlisted one compiles to "Undefined
    variable". The traced tree may still hold lazy python lists (#411).
    """
    from east.types.values import is_east_struct, is_east_variant

    if isinstance(node, list):
        for x in node:
            _free_vars(x, bound, out)
        return
    if is_east_struct(node):
        for _f, v in node.items():
            _free_vars(v, bound, out)
        return
    if not is_east_variant(node):
        return
    kind = node.type
    p = node.value
    if kind == "Variable":
        name = p["name"]
        if name not in bound and name not in out:
            out[name] = node
        return
    if kind == "Function":
        for c in p["captures"]:
            cname = c.value["name"]
            if cname not in bound and cname not in out:
                out[cname] = c
        inner = bound | {v.value["name"] for v in p["parameters"]} \
                      | {c.value["name"] for c in p["captures"]}
        _free_vars(p["body"], inner, out)
        return
    if kind == "Block":
        scope = set(bound)
        for stmt in p["statements"]:
            if is_east_variant(stmt) and stmt.type == "Let":
                _free_vars(stmt.value["value"], frozenset(scope), out)
                scope.add(stmt.value["variable"].value["name"])
            else:
                _free_vars(stmt, frozenset(scope), out)
        return
    if kind == "Match":
        _free_vars(p["variant"], bound, out)
        for case in p["cases"]:
            _free_vars(case["body"], bound | {case["variable"].value["name"]}, out)
        return
    if kind == "Value":
        return  # literals only
    if not is_east_struct(p):
        return  # scalar/None payload (type atoms, raw values)
    for fname, v in p.items():
        if fname in ("type", "loc_id", "type_parameters"):
            continue
        _free_vars(v, bound, out)


def _capturing_fn(fn_t: EastType, params: list, body_ir: Any):
    """A Function IR node whose ``captures`` are computed from the body."""
    free: dict[str, Any] = {}
    _free_vars(body_ir, frozenset(p.value["name"] for p in params), free)
    return _k_function(fn_t, list(free.values()), params, body_ir)


def _const_fn_node(param_types: list, body: KernelExpr, out_t: EastType) -> Any:
    """A Function IR node ignoring its parameters and returning `body`."""
    from east.types.types import FunctionType as _FnType

    params = [_var(f"__d{i}", t) for i, t in enumerate(param_types)]
    fn_t = _FnType(list(param_types), out_t)
    return _capturing_fn(fn_t, params, body.ir)


# ─── Nested lambdas + the eager-builtin funnel (#393) ───────────────────────

_fresh_names = itertools.count()


def _fresh_name() -> str:
    """A trace-unique variable name so nested lambdas never shadow outer
    parameters (`split(...).map(lambda v: v + r.id)` must keep `r` visible
    inside the inner function's body)."""
    return f"__n{next(_fresh_names)}"


def _trace_inner_fn(fn: Any, param_types: list[EastType], declared: int | None = None) -> tuple[Any, EastType]:
    """Trace an inner (nested) lambda into a Function IR node.

    ``param_types`` is the builtin's full callback signature (e.g. map takes
    ``(element, index)``); a lambda declaring fewer parameters simply ignores
    the tail. Returns ``(Function node, traced output type)``.
    """
    arity = declared
    if arity is None:
        code = getattr(fn, "__code__", None)
        if code is None or code.co_flags & 0x04:  # CO_VARARGS: *args takes all
            arity = len(param_types)
        else:
            arity = code.co_argcount
    if not (1 <= arity <= len(param_types)):
        raise KernelTraceError(
            f"inner lambda takes {arity} parameters; the callback signature has "
            f"{len(param_types)}"
        )
    names = [_fresh_name() for _ in param_types]
    proxies = [KernelExpr(_var(n, t), t) for n, t in zip(names, param_types, strict=True)]
    try:
        result = fn(*proxies[:arity])
    except KernelTraceError:
        raise
    except Exception as e:  # pragma: no cover - message carries the cause
        raise KernelTraceError(f"inner lambda is not traceable: {e}") from e
    body = _lift(result)
    params = [_var(n, t) for n, t in zip(names, param_types, strict=True)]
    fn_t = FunctionType(list(param_types), body.east_type)
    node = _capturing_fn(fn_t, params, body.ir)
    return node, body.east_type


def trace_builtin_call(
    name: str, type_params: list, args: list, output_type: EastType
) -> KernelExpr | None:
    """The eager-builtin funnel's kernel hook (#393).

    ``_call_builtin`` (east/types/values/_helpers.py) routes every namespace
    builtin (``East.String.*``, ``East.Float.*``, …) and eager collection
    method through one funnel. When any argument is a traced expression the
    call is happening INSIDE a kernel lambda — emit a Builtin IR node instead
    of executing eagerly. Returns None (caller runs the eager path) when no
    argument is traced.

    Callback arguments (``EastFunction``) are traced recursively against
    their declared signature; captured East collections/structs inline as
    constructor IR via ``_lift``.
    """
    if not any(isinstance(a, KernelExpr) for a in args):
        return None
    from east.types.values.structural import EastFunction

    ir_args: list[dict] = []
    for a in args:
        if isinstance(a, EastFunction):
            node, out_t = _trace_inner_fn(a.fn, list(a.input_types))
            if out_t != a.output_type:
                raise KernelTraceError(
                    f"traced callback for {name} returns {out_t.type}, "
                    f"declared {a.output_type.type}"
                )
            ir_args.append(node)
        else:
            ir_args.append(_lift(a).ir)
    return KernelExpr(_builtin(name, output_type, list(type_params), ir_args), output_type)


def where(cond: Any, then: Any, otherwise: Any) -> Any:
    """Conditional expression: East IfElse when traced, eager otherwise.

    Inside kernels python's ``if``/``and``/``or`` cannot be overloaded, so
    conditionals are written ``where(r.qty > 0.0, r.price / r.qty, 0.0)``.
    On plain python values (e.g. when a lambda runs on the per-element
    python path) it evaluates eagerly like ``then if cond else otherwise``,
    so the same lambda works on both paths.
    """
    if not isinstance(cond, KernelExpr):
        if isinstance(then, KernelExpr) or isinstance(otherwise, KernelExpr):
            raise KernelTraceError(
                "where() received a python condition with traced branches — "
                "the condition must come from the kernel's parameters"
            )
        return then if cond else otherwise
    if cond.east_type.type != "Boolean":
        raise KernelTraceError(f"where() condition must be Boolean, got {cond.east_type.type}")
    from east.types.values import is_east_variant

    # A bare `none` branch has no standalone type — lift the sibling first and
    # type the `none` from it. Otherwise lift `then`, type `otherwise` from it,
    # then re-lift `then` so a `some`/`none` pair reconciles whichever arm the
    # `none` sits in.
    if is_east_variant(then) and then.type == "none":
        else_e = _lift(otherwise)
        then_e = _lift(then, hint=else_e.east_type)
    else:
        then_e = _lift(then)
        else_e = _lift(otherwise, hint=then_e.east_type)
        then_e = _lift(then, hint=else_e.east_type)
    if then_e.east_type != else_e.east_type:
        raise KernelTraceError(
            f"where() branches must have the same East type "
            f"({then_e.east_type.type} vs {else_e.east_type.type})"
        )
    node = _k_ifelse(then_e.east_type, [(cond.ir, then_e.ir)], else_e.ir)
    return KernelExpr(node, then_e.east_type)


def greatest(a: Any, b: Any) -> Any:
    """max(a, b) by East total order: traced IfElse on expressions, eager on
    plain values (dual-mode like ``where`` — the same lambda works on both
    the traced and python paths)."""
    if isinstance(a, KernelExpr) or isinstance(b, KernelExpr):
        ae = _lift(a, hint=b.east_type if isinstance(b, KernelExpr) else None)
        be = _lift(b, hint=ae.east_type)
        return where(ae >= be, ae, be)
    from east.types.values import type_of
    from east.utils.ordering import greater_equal_for

    return a if greater_equal_for(type_of(a))(a, b) else b


def least(a: Any, b: Any) -> Any:
    """min(a, b) by East total order (dual-mode — see ``greatest``)."""
    if isinstance(a, KernelExpr) or isinstance(b, KernelExpr):
        ae = _lift(a, hint=b.east_type if isinstance(b, KernelExpr) else None)
        be = _lift(b, hint=ae.east_type)
        return where(ae <= be, ae, be)
    from east.types.values import type_of
    from east.utils.ordering import less_equal_for

    return a if less_equal_for(type_of(a))(a, b) else b




# ─── Lazy node construction (identity-preserving, #411) ─────────────────────
#
# EastArray is a C-backed proxy: pushing a child converts it and every read
# materializes a FRESH python object — node identity (what CSE detects) dies
# at every array boundary. During tracing, array-bearing nodes therefore hold
# their children in plain python lists; one finalize pass (_finalize_ir) runs
# the identity-based CSE and converts every list to the proper EastArray in
# the same rebuild. Scalar-child nodes use the shared builders directly —
# EastStruct fields keep object identity.


def _k_builtin(name: str, out: EastType, type_params: list, args: list):
    return EastVariant("Builtin", EastStruct({
        "type": out, "loc_id": 0, "builtin": name,
        "type_parameters": list(type_params), "arguments": list(args),
    }))


def _k_function(fn_t: EastType, captures: list, params: list, body):
    return EastVariant("Function", EastStruct({
        "type": fn_t, "loc_id": 0, "captures": list(captures),
        "parameters": list(params), "body": body,
    }))


def _k_block(t: EastType, statements: list):
    return EastVariant("Block", EastStruct({
        "type": t, "loc_id": 0, "statements": list(statements),
    }))


def _k_match(t: EastType, subject, cases: list):
    return EastVariant("Match", EastStruct({
        "type": t, "loc_id": 0, "variant": subject,
        "cases": [EastStruct({"case": c, "variable": v, "body": b}) for c, v, b in cases],
    }))


def _k_new_array(t: EastType, values: list):
    return EastVariant("NewArray", EastStruct({"type": t, "loc_id": 0, "values": list(values)}))


def _k_new_set(t: EastType, values: list):
    return EastVariant("NewSet", EastStruct({"type": t, "loc_id": 0, "values": list(values)}))


def _k_new_dict(t: EastType, entries: list):
    return EastVariant("NewDict", EastStruct({
        "type": t, "loc_id": 0,
        "values": [EastStruct({"key": k, "value": v}) for k, v in entries],
    }))


def _k_struct(t: EastType, fields: list):
    return EastVariant("Struct", EastStruct({
        "type": t, "loc_id": 0,
        "fields": [EastStruct({"name": n, "value": v}) for n, v in fields],
    }))


def _k_ifelse(t: EastType, ifs: list, else_body):
    return EastVariant("IfElse", EastStruct({
        "type": t, "loc_id": 0,
        "ifs": [EastStruct({"predicate": p, "body": b}) for p, b in ifs],
        "else_body": else_body,
    }))


# ─── Trace-time CSE + finalize: shared subexpressions bind once (#411) ──────
#
# Reusing one KernelExpr object at N sites makes the traced (lazy) tree a
# DAG. The finalize pass walks it once: every non-trivial node referenced
# more than once — whose free variables are the kernel's own parameters or
# hoisted constants — binds to a Let at the top of the kernel body (this
# includes loop-invariant hoisting out of nested lambdas); everything else
# re-emits inline. The SAME rebuild converts every plain-list child into its
# proper EastArray, producing the final homoiconic value.

_CSE_SKIP_KINDS = frozenset({"Value", "Variable"})

#: node kind -> (child field specs, extra array fields converted not walked).
#: A child spec is a field name, ("field", "list", ElementTypeThunk), or
#: ("field", "structs", ElementTypeThunk, (subfields...)).
def _node_specs():
    from east.types.type_of_type import (
        DictEntryType,
        EastTypeType,
        IfCaseType,
        IRType,
        MatchCaseType,
        StructFieldIRType,
    )

    ir = lambda: IRType  # noqa: E731
    return {
        "Value": ((), ()),
        "Variable": ((), ()),
        "Builtin": ((("arguments", "list", ir),), (("type_parameters", EastTypeType),)),
        "GetField": (("struct",), ()),
        "Struct": ((("fields", "structs", lambda: StructFieldIRType, ("value",)),), ()),
        "Variant": (("value",), ()),
        "NewArray": ((("values", "list", ir),), ()),
        "NewSet": ((("values", "list", ir),), ()),
        "NewDict": ((("values", "structs", lambda: DictEntryType, ("key", "value")),), ()),
        "Match": (("variant", ("cases", "structs", lambda: MatchCaseType, ("variable", "body"))), ()),
        "IfElse": ((("ifs", "structs", lambda: IfCaseType, ("predicate", "body")), "else_body"), ()),
        "TryCatch": (("try_body", "catch_body", "message", "stack", "finally_body"), ()),
        "Function": ((("captures", "list", ir), ("parameters", "list", ir), "body"), ()),
        "Let": (("variable", "value"), ()),
        "Block": ((("statements", "list", ir),), ()),
        "Error": (("message",), ()),
    }


_SPECS = None


def _specs():
    global _SPECS
    if _SPECS is None:
        _SPECS = _node_specs()
    return _SPECS


def _node_children(node):
    """Yield the direct child IR nodes of a (lazy or final) node."""
    spec = _specs().get(node.type)
    if spec is None:
        return
    payload = node.value
    for entry in spec[0]:
        if isinstance(entry, str):
            yield payload[entry]
        elif entry[1] == "list":
            yield from payload[entry[0]]
        else:
            for sub in payload[entry[0]]:
                for f in entry[3]:
                    yield sub[f]


def _finalize_ir(top, param_names: set, kernel_fn=None):
    """CSE + arrayify the whole lazy tree; returns the final homoiconic node.

    ``top`` is the (lazy) top-level Function node — or a Block wrapping it
    when constants hoisted; the CSE lets land inside ``kernel_fn``'s body
    (the FIRST Function node encountered from the top).
    """
    counts: dict[int, int] = {}
    keep: dict[int, Any] = {}
    visited: set[int] = set()

    def count(node):
        i = id(node)
        if node.type not in _CSE_SKIP_KINDS:
            counts[i] = counts.get(i, 0) + 1
            keep[i] = node
        if i in visited:
            return
        visited.add(i)
        for child in _node_children(node):
            count(child)

    count(top)

    # A name that is REBOUND between the kernel body and a node's occurrence
    # (an inner-lambda param or match/catch variable shadowing a top param)
    # must block the hoist — at the top the name resolves to the wrong
    # binder. scope[i] accumulates every such rebound name over all of the
    # node's occurrences.
    scope: dict[int, set] = {}

    def binder_names(node):
        if node.type == "Function" and node is not kernel_fn:
            return {p.value["name"] for p in node.value["parameters"]}
        if node.type == "Match":
            return {c["variable"].value["name"] for c in node.value["cases"]}
        if node.type == "TryCatch":
            return {node.value["message"].value["name"], node.value["stack"].value["name"]}
        return None

    def scope_walk(node, inner):
        i = id(node)
        prev = scope.get(i)
        if prev is None:
            scope[i] = set(inner)
        elif inner <= prev:
            return
        else:
            prev |= inner
        bound = binder_names(node)
        if bound:
            inner = inner | bound
        for child in _node_children(node):
            scope_walk(child, inner)

    scope_walk(top, set())

    def free_vars(node, bound):
        if node.type == "Variable":
            name = node.value["name"]
            return set() if name in bound else {name}
        inner = bound
        if node.type == "Function":
            inner = bound | {p.value["name"] for p in node.value["parameters"]}
        out: set = set()
        for child in _node_children(node):
            out |= free_vars(child, inner)
        return out

    hoistable: dict[int, str] = {}
    for i, n in counts.items():
        if n < 2:
            continue
        fv = free_vars(keep[i], set())
        if fv <= param_names and not (fv & scope[i]):
            hoistable[i] = _fresh_name()

    lets: list = []
    emitted: set[int] = set()
    memo: dict[int, Any] = {}
    kernel_fn_seen = False

    def arrayify(node, children):
        spec = _specs()[node.type]
        payload = node.value
        fields = {k: payload[k] for k in payload}
        it = iter(children)
        for entry in spec[0]:
            if isinstance(entry, str):
                fields[entry] = next(it)
            elif entry[1] == "list":
                fields[entry[0]] = EastArray(entry[2](), [next(it) for _ in payload[entry[0]]])
            else:
                rebuilt: list[Any] = []
                for sub in payload[entry[0]]:
                    sf = {k: sub[k] for k in sub}
                    for f in entry[3]:
                        sf[f] = next(it)
                    rebuilt.append(EastStruct(sf))
                fields[entry[0]] = EastArray(entry[2](), rebuilt)
        for fname, etype in spec[1]:
            fields[fname] = EastArray(etype, list(payload[fname]))
        return EastVariant(node.type, EastStruct(fields))

    def emit_let(i):
        if i in emitted:
            return
        emitted.add(i)
        node = keep[i]
        value = rewrite(node, binding=i)
        lets.append(ir_let(node.value["type"], _var(hoistable[i], node.value["type"]), value))

    def rewrite(node, binding=None):
        nonlocal kernel_fn_seen
        i = id(node)
        if i in hoistable and i != binding:
            emit_let(i)
            return _var(hoistable[i], node.value["type"])
        if binding is None and i in memo:
            return memo[i]
        is_kernel_fn = node is kernel_fn or (
            kernel_fn is None and node.type == "Function" and not kernel_fn_seen
        )
        if is_kernel_fn:
            kernel_fn_seen = True
        children = [rewrite(c) for c in _node_children(node)]
        if is_kernel_fn and (lets or hoistable):
            # splice the collected lets at the head of the kernel body —
            # rewriting the body above already emitted every needed let
            body = children[-1]
            if lets:
                from east.types.type_of_type import IRType

                body_type = node.value["type"].value["output"]
                block: Any = EastVariant("Block", EastStruct({
                    "type": body_type, "loc_id": 0,
                    "statements": EastArray(IRType, [*lets, body]),
                }))
                children[-1] = block
        result = arrayify(node, children)
        if binding is None:
            memo[i] = result
        return result

    return rewrite(top)


# ─── Tracing + compilation ──────────────────────────────────────────────────


def _function_ir(
    param_types: list[EastType],
    params: list,
    body: KernelExpr,
    consts: list[tuple[str, Any, EastType]] = (),  # type: ignore[assignment]
) -> Any:
    """The kernel's top-level IR value: a Function node, or — when constants
    hoisted — ``Block[Let …, Function(captures)]`` so each constant evaluates
    ONCE when the kernel compiles, not per call. Finalization runs the
    identity CSE (#411) and converts the lazy tree to real East arrays."""
    fn_type = FunctionType(list(param_types), body.east_type)
    fn_node = _k_function(
        fn_type,
        # Hoisted constants are captured so they survive the enclosing block.
        [_var(name, t) for name, _n, t in consts],
        params,
        body.ir,
    )
    top = fn_node
    if consts:
        lets = [ir_let(t, _var(name, t), node) for name, node, t in consts]
        top = _k_block(fn_type, [*lets, fn_node])
    param_names = {p.value["name"] for p in params} | {name for name, _n, _t in consts}
    return _finalize_ir(top, param_names, kernel_fn=fn_node)


def trace(fn: Any, param_types: list[EastType]) -> tuple[Any, EastType]:
    """Trace ``fn`` over expression proxies; return (IR value, output type).

    The IR value is homoiconic — an ``EastVariant`` conforming to ``IRType``
    (compile with ``compile_from_value``). Raises KernelTraceError when the
    lambda performs untraceable operations.
    """
    global _const_registry
    proxies = [KernelExpr(_var(f"__k{i}", t), t) for i, t in enumerate(param_types)]
    outer = _const_registry is None
    if outer:
        _const_registry = _ConstRegistry()
    try:
        try:
            result = fn(*proxies)
        except KernelTraceError:
            raise
        except Exception as e:
            raise KernelTraceError(f"kernel lambda is not traceable: {e}") from e
        result = _lift(result)
        consts = _const_registry.entries if outer else []
    finally:
        if outer:
            _const_registry = None
    params = [_var(f"__k{i}", t) for i, t in enumerate(param_types)]
    return _function_ir(param_types, params, result, consts), result.east_type


def kernel(param_types: EastType | list[EastType], fn: Any = None, *, out: EastType | None = None) -> Any:
    """Trace and compile a python lambda into a native East kernel.

    The returned object is an ordinary python callable (arguments are
    marshalled through east-c) that every eager collection method accepts —
    when passed to ``map``/``filter``/``fold``/… the loop and the kernel both
    execute natively, with no per-element python.

    Args:
        param_types: East type of the lambda's parameter, or a list of types
            for multi-parameter kernels (e.g. ``fold`` steps take
            ``[acc_type, element_type]``).
        fn: The lambda to trace. When omitted, returns a decorator.
        out: Optional expected output type; a traced output of a different
            type raises TypeError.

    Returns:
        The compiled kernel callable. It is dual-mode (#470): called with
        plain values it executes natively; called with trace proxies — from
        inside another ``kernel()`` lambda, or a wrapper an eager method is
        tracing — it re-runs its source lambda so its expression splices
        into the surrounding trace. Kernels therefore compose: referencing
        one from another kernel or from any pure wrapper keeps the whole
        loop native. Its ``.bind(*values)`` method pre-binds the TRAILING
        parameters to live East values by reference (C-level partial
        application, #399) — the bound callable stays native, is zero-copy
        at any table size, and observes later mutations to bound
        collections (bound callables are not re-traceable).

    Raises:
        KernelTraceError: If the lambda cannot be traced (uses python
            ``if``/``and``/``or``, calls host libraries, etc.).
        TypeError: If ``out`` is given and the traced output type differs.
    """
    types = [param_types] if isinstance(param_types, EastType) else list(param_types)
    if fn is None:
        return lambda f: kernel(types, f, out=out)
    ir_value, out_type = trace(fn, types)
    if out is not None and out != out_type:
        raise TypeError(f"kernel output is {out_type.type}, expected {out.type}")
    from east.runtime.compiler import compile_from_value

    compiled = compile_from_value(ir_value)

    def kernel_callable(*args):
        # Dual-mode (#470): called with expression proxies — i.e. from inside
        # another trace, e.g. a composing wrapper like
        # ``lambda el: {"k": key(el), "v": value(el)}`` — re-run the (pure)
        # source lambda on the proxies so this kernel's expression splices
        # inline into the surrounding trace. On plain values, execute natively.
        if any(isinstance(a, KernelExpr) for a in args):
            return fn(*args)
        return compiled(*args)

    # The wrapper carries the compiled callable's whole public surface, so
    # every existing consumer (the native pass-through via _eastc_handle,
    # _mark_kernel, _kernel_out_type, bind) sees an ordinary kernel.
    kernel_callable._eastc_handle = compiled._eastc_handle
    kernel_callable._east_ir = getattr(compiled, "_east_ir", None)
    kernel_callable._east_captures = getattr(compiled, "_east_captures", {})
    kernel_callable.bind = compiled.bind
    kernel_callable._east_compiled = compiled  # owns the C resources; keep alive
    kernel_callable._east_retrace = fn         # marks the callable trace-safe
    return kernel_callable


# ─── Automatic push-down for eager-method callbacks ─────────────────────────
#
# call_builtin funnels every eager callback through an EastFunction; before
# falling back to the per-element python trampoline it asks try_push_down for
# a native kernel. Tracing runs the lambda ONCE, so it is only attempted when
# a conservative purity gate proves the lambda cannot observe per-element
# python state: it may reference its parameters, plain scalar constants,
# East types/values, `where`, precompiled kernels (re-traced from their
# retained source, #470), and — two levels deep, enough for the group-sugar
# wrappers that compose a user callback through an internal lambda — other
# lambdas that pass the same gate. Anything else — modules, arbitrary
# callables, mutable closures — disables tracing and keeps today's exact
# python semantics.


def _allowed_global(value: Any, depth: int, extra_allowed: Any = None) -> bool:
    if extra_allowed is not None and extra_allowed(value):
        return True
    # A kernel() result retains its source lambda and re-traces when called
    # with proxies (#470) — safe to reference at any nesting depth.
    if getattr(value, "_east_retrace", None) is not None:
        return True
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return True
    if isinstance(value, EastType):  # East variants/types are immutable constants
        return True
    # the Null sentinel is an immutable constant — side-effect callbacks like
    # `lambda el: east_null` must stay traceable
    from east.types.values import is_east_null

    if is_east_null(value):
        return True
    if value is where or value is bool or value is isinstance or value is abs:
        return True
    if value is greatest or value is least:
        return True
    if value is KernelExpr:
        return True
    # The `East` builtin namespace is a stateless singleton whose calls now
    # trace through the eager funnel (#393) — allowing it lets lambdas like
    # `lambda r: East.String.upper_case(r.sku)` push down automatically.
    # Mutable East collections are deliberately NOT allowed here: tracing
    # snapshots them, which would diverge from the live per-element python
    # semantics; only an explicit kernel() opts into snapshot capture.
    from east.namespace import East as _East

    if value is _East:
        return True
    # `some`/`none` are pure option constructors that _lift_variant turns into
    # Variant IR — allow them so option-returning lambdas trace natively instead
    # of falling back to the per-element python path.
    from east.types.construct import none, some

    if value is some or value is none:
        return True
    if callable(value) and depth > 0:
        return _eligible(value, depth - 1, extra_allowed)
    return False


# Opcodes that mutate state outside the lambda's own frame: a lambda that
# writes a closure/global cell observes per-element execution, so tracing
# (which runs it once) would change behaviour.
_MUTATING_OPS = frozenset(
    {
        "STORE_DEREF",
        "DELETE_DEREF",
        "STORE_GLOBAL",
        "DELETE_GLOBAL",
        "STORE_NAME",
        "DELETE_NAME",
        "IMPORT_NAME",
        "IMPORT_FROM",
    }
)


def _code_scan(code: Any) -> tuple[bool, frozenset[str]]:
    """One disassembly pass: (pure shape, names actually loaded as globals).

    Only ``LOAD_GLOBAL``/``LOAD_NAME`` targets count as globals — ``co_names``
    also contains ATTRIBUTE names, and treating those as globals made any
    lambda touching a struct field named after a python builtin (``r.id``,
    ``r.len``, ``r.format``, …) resolve the field name against ``builtins``
    and get refused as impure (#409).
    """
    import dis
    import types as _pytypes

    names: set[str] = set()
    for ins in dis.get_instructions(code):
        if ins.opname in _MUTATING_OPS:
            return False, frozenset()
        if ins.opname in ("LOAD_GLOBAL", "LOAD_NAME"):
            names.add(ins.argval)
    # Nested code objects (inner lambdas, comprehensions) are scanned
    # recursively: their mutations and global loads count against the same
    # gate. (They used to be conservatively ineligible precisely because
    # their references went unchecked.)
    for const in code.co_consts:
        if isinstance(const, _pytypes.CodeType):
            inner_pure, inner_names = _code_scan(const)
            if not inner_pure:
                return False, frozenset()
            names |= inner_names
    return True, frozenset(names)


def _eligible(fn: Any, depth: int = 2, extra_allowed: Any = None) -> bool:
    """Whether tracing ``fn`` is provably semantics-preserving (see above)."""
    code = getattr(fn, "__code__", None)
    if code is None:
        return False
    try:
        import builtins as _builtins

        pure, global_names = _code_scan(code)
        if not pure:
            return False
        fn_globals = getattr(fn, "__globals__", {})
        for name in global_names:
            if name in fn_globals:
                value = fn_globals[name]
            elif hasattr(_builtins, name):
                value = getattr(_builtins, name)
            else:
                continue  # unresolvable global: fails at trace time if reached
            if not _allowed_global(value, depth, extra_allowed):
                return False
        closure = getattr(fn, "__closure__", None) or ()
        for cell in closure:
            if not _allowed_global(cell.cell_contents, depth, extra_allowed):
                return False
    except Exception:
        return False
    return True


def _east_value_capture(value: Any) -> bool:
    """Captured East VALUES — pure to lift, so safe for type-only tracing."""
    from east.types.values import EastDict, EastSet, is_east_struct, is_east_variant

    if isinstance(value, (EastArray, EastSet, EastDict)):
        return True
    return is_east_struct(value) or is_east_variant(value)


def _type_traceable(fn: Any) -> bool:
    """Whether running ``fn`` ONCE against proxies for its output TYPE is safe.

    The same conservative gate as ``_eligible`` with one relaxation: captured
    East values (collections/structs/variants) are allowed, because lifting
    them is pure and only the traced TYPE is taken — snapshot-vs-live
    semantics cannot be observed. Impure lambdas (mutable python captures,
    arbitrary callables) must keep the sampling fallback instead: sampling
    calls them with a REAL element, whereas tracing would run them on
    ``KernelExpr`` proxies and leak those proxies into their python state
    (e.g. a closure list mutated per call).
    """
    return _eligible(fn, extra_allowed=_east_value_capture)


def try_push_down(east_fn: Any) -> Any | None:
    """Compile an eager-method callback into a native kernel when safe.

    ``east_fn`` is an ``EastFunction`` (python callable + declared East
    signature). Returns a native callable (carrying ``_eastc_handle``), or
    ``None`` to use the per-element python path. Never raises.

    A callback that already IS a precompiled kernel — directly, or recorded
    on its wrapper by ``_mark_kernel`` — resolves through the bridge's
    ``_native_kernel_for``: the same signature checks (#467) and arity
    adaptation the trampoline-avoidance path uses, so the mark means the
    same thing to every consumer (#470). ``group_by`` branches on this
    result to run its whole grouping natively; before, a marked wrapper was
    judged on its own (ineligible) closure and reported un-pushable even
    though the bridge would have run the very same kernel natively.
    """
    try:
        from east.runtime._compiler_eastc import native_kernel_for

        native = native_kernel_for(east_fn)
        if native is not None:
            return native
    except Exception:
        pass
    try:
        if not _eligible(east_fn.fn):
            return None
        ir_value, out_type = trace(east_fn.fn, list(east_fn.input_types))
        if out_type != east_fn.output_type:
            return None
        from east.runtime.compiler import compile_from_value

        return compile_from_value(ir_value)
    except Exception:
        return None


# ─── Hand-built helper kernels (internal — used by eager methods) ───────────
#
# These tiny kernels replace the internal python lambdas that eager methods
# previously used for identity keys, default combines and group-append —
# with them the whole method goes native. Memoized by the type's JSON form
# (types are structural, so the string is a stable key).

_helper_memo: dict[str, Any] = {}


def _identity_kernel(t: EastType) -> Any:
    """Compiled (x: t) -> x."""
    from east.runtime.compiler import compile_from_value

    key = "identity:" + _type_key(t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    body = KernelExpr(_var("__k0", t), t)
    k = compile_from_value(_function_ir([t], [_var("__k0", t)], body))
    _helper_memo[key] = k
    return k


def _second_kernel(t: EastType) -> Any:
    """Compiled (a: t, b: t) -> b (default combine: later value wins)."""
    from east.runtime.compiler import compile_from_value

    key = "second:" + _type_key(t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    params = [_var("__k0", t), _var("__k1", t)]
    body = KernelExpr(_var("__k1", t), t)
    k = compile_from_value(_function_ir([t, t], params, body))
    _helper_memo[key] = k
    return k


def _empty_array_kernel(key_t: EastType, element_t: EastType) -> Any:
    """Compiled (k: key_t) -> [] of element_t (group init)."""
    from east.runtime.compiler import compile_from_value

    key = "init:" + _type_key(key_t) + "|" + _type_key(element_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    bucket_t = ArrayType(element_t)
    body = KernelExpr(_k_new_array(bucket_t, []), bucket_t)
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _none_init_kernel(key_t: EastType, inner_t: EastType) -> Any:
    """Compiled (k: key_t) -> none : Option<inner_t> (group max/min init)."""
    from east.runtime.compiler import compile_from_value

    key = "noneinit:" + _type_key(key_t) + "|" + _type_key(inner_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    opt_t = _option_type(inner_t)
    body = KernelExpr(
        ir_variant(opt_t, "none", _literal(None, NullType)),
        opt_t,
    )
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _pair_field(pair_t: EastType, var: Any, name: str) -> tuple:
    f_t = next(f["type"] for f in pair_t.value if f["name"] == name)
    return ir_get_field(f_t, name, var), f_t


def _append_field_kernel(pair_t: EastType, value_field: str) -> Any:
    """Compiled (acc: [V], p: pair_t, i) -> acc with p.<value_field> pushed."""
    from east.runtime.compiler import compile_from_value

    key = "appendfield:" + _type_key(pair_t) + "|" + value_field
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    field_ir, v_t = _pair_field(pair_t, el, value_field)
    bucket_t = ArrayType(v_t)
    acc = _var("__k0", bucket_t)
    push = _builtin("ArrayPushLast", NullType, [v_t], [acc, field_ir])
    block = _k_block(bucket_t, [push, acc])
    k = compile_from_value(_function_ir([bucket_t, pair_t], [acc, el], KernelExpr(block, bucket_t)))
    _helper_memo[key] = k
    return k


def _empty_set_kernel(key_t: EastType, element_t: EastType) -> Any:
    """Compiled (k: key_t) -> {} : Set<element_t> (group init)."""
    from east.runtime.compiler import compile_from_value
    from east.types.types import SetType as _SetType

    key = "setinit:" + _type_key(key_t) + "|" + _type_key(element_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    set_t = _SetType(element_t)
    body = KernelExpr(_k_new_set(set_t, []), set_t)
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _set_insert_field_kernel(pair_t: EastType, value_field: str) -> Any:
    """Compiled (acc: Set<V>, p: pair_t, i) -> acc with p.<value_field> inserted."""
    from east.runtime.compiler import compile_from_value
    from east.types.types import SetType as _SetType

    key = "setinsfield:" + _type_key(pair_t) + "|" + value_field
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    field_ir, v_t = _pair_field(pair_t, el, value_field)
    set_t = _SetType(v_t)
    acc = _var("__k0", set_t)
    ins = _builtin("SetInsert", NullType, [v_t], [acc, field_ir])
    block = _k_block(set_t, [ins, acc])
    k = compile_from_value(_function_ir([set_t, pair_t], [acc, el], KernelExpr(block, set_t)))
    _helper_memo[key] = k
    return k


def _empty_dict_kernel(key_t: EastType, k2_t: EastType, v_t: EastType) -> Any:
    """Compiled (k: key_t) -> {} : Dict<k2_t, v_t> (group init)."""
    from east.runtime.compiler import compile_from_value
    from east.types.types import DictType as _DictType

    key = "dictinit:" + _type_key(key_t) + "|" + _type_key(k2_t) + "|" + _type_key(v_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    dict_t = _DictType(k2_t, v_t)
    body = KernelExpr(_k_new_dict(dict_t, []), dict_t)
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _dict_insert_fields_kernel(pair_t: EastType, key_field: str, value_field: str) -> Any:
    """Compiled (acc: Dict<K2,V>, p, i) -> acc with (p.<key>, p.<value>) inserted.

    Uses DictInsert, so a duplicate inner key errors — mirroring the TS
    groupToDicts default (resolve collisions with a combine instead).
    """
    from east.runtime.compiler import compile_from_value
    from east.types.types import DictType as _DictType

    key = "dictinsfields:" + _type_key(pair_t) + "|" + key_field + "|" + value_field
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    k_ir, k2_t = _pair_field(pair_t, el, key_field)
    v_ir, v_t = _pair_field(pair_t, el, value_field)
    dict_t = _DictType(k2_t, v_t)
    acc = _var("__k0", dict_t)
    ins = _builtin("DictInsert", NullType, [k2_t, v_t], [acc, k_ir, v_ir])
    block = _k_block(dict_t, [ins, acc])
    k = compile_from_value(_function_ir([dict_t, pair_t], [acc, el], KernelExpr(block, dict_t)))
    _helper_memo[key] = k
    return k


def _append_kernel(element_t: EastType) -> Any:
    """Compiled (acc: [t], el: t) -> acc with el pushed (group fold)."""
    from east.runtime.compiler import compile_from_value

    key = "append:" + _type_key(element_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    bucket_t = ArrayType(element_t)
    acc = _var("__k0", bucket_t)
    el = _var("__k1", element_t)
    push = _builtin("ArrayPushLast", NullType, [element_t], [acc, el])
    block = _k_block(bucket_t, [push, acc])
    body = KernelExpr(block, bucket_t)
    k = compile_from_value(_function_ir([bucket_t, element_t], [acc, el], body))
    _helper_memo[key] = k
    return k
