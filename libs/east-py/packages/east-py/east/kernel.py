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
- Collection transforms with nested lambdas, one level or deeper:
  ``.map`` / ``.filter`` / ``.fold`` / ``.some`` / ``.every`` /
  ``.string_join`` / ``.get`` / ``.get_or_default`` / ``.try_get`` /
  ``[index_expr]`` — inner lambdas may reference outer parameters.
- Captured East constants: ``EastArray`` / ``EastSet`` / ``EastDict`` /
  ``EastStruct`` values closed over by the lambda become build-time
  constants — a SNAPSHOT taken at trace time, constructed once when the
  kernel compiles (hoisted + identity-deduped, so a side-table referenced
  from many sites or inside a ``.map`` lambda never rebuilds per element).
  A multi-million-entry table still belongs in a parameter, not a capture:
  the snapshot rides the kernel's IR. Access methods on an eager collection
  accept traced keys and re-route through the tracer automatically.
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
import json
import math
from typing import Any

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

__all__ = ["kernel", "where", "greatest", "least", "KernelTraceError", "KernelExpr"]


class KernelTraceError(TypeError):
    """The lambda performed an operation that cannot be traced into East IR."""


# ─── JSON wire-format helpers (matches east-c's IR v4 JSON decoder) ─────────


def _type_json(t: EastType) -> Any:
    """Encode a python EastType in the canonical East JSON wire form."""
    from east.serialization.json import encode_json_for

    return json.loads(encode_json_for(EastTypeType)(t))


def _node(kind: str, **fields: Any) -> dict[str, Any]:
    """An IR node: a variant of ``kind`` with a struct payload.

    Field order matters to the C JSON decoder: the payload's ``type`` comes
    first, then ``loc_id``, then the node-specific fields in declared order
    (callers pass them in that order). The parameter is named ``kind`` so
    node fields literally called ``case`` (Variant/Match) can pass through
    ``**fields``.
    """
    payload: dict[str, Any] = {"type": fields.pop("type")}
    payload["loc_id"] = "0"
    payload.update(fields)
    return {"type": kind, "value": payload}


def _var(name: str, t: EastType) -> dict[str, Any]:
    return _node("Variable", type=_type_json(t), name=name, mutable=False, captured=False)


def _builtin(name: str, out: EastType, type_params: list[EastType], args: list[dict]) -> dict:
    return _node(
        "Builtin",
        type=_type_json(out),
        builtin=name,
        type_parameters=[_type_json(t) for t in type_params],
        arguments=args,
    )


def _literal(value: Any, t: EastType) -> dict:
    """A Value node holding a literal, encoded per the East JSON rules."""
    tag = t.type
    encoded: Any
    if tag == "Null":
        encoded = None
    elif tag == "Boolean":
        encoded = bool(value)
    elif tag == "Integer":
        encoded = str(int(value))  # East JSON encodes Integer as a string
    elif tag == "Float":
        f = float(value)
        if math.isnan(f):
            encoded = "NaN"
        elif math.isinf(f):
            encoded = "Infinity" if f > 0 else "-Infinity"
        elif f == 0.0 and math.copysign(1.0, f) < 0:
            encoded = "-0.0"
        else:
            encoded = f
    elif tag == "String":
        encoded = str(value)
    else:
        raise KernelTraceError(f"cannot embed a literal of East type {tag} in a kernel")
    return _node("Value", type=_type_json(t), value={"type": tag, "value": encoded})


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
    if isinstance(value, KernelExpr):
        return value
    if value is None:
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
        self.entries: list[tuple[str, dict, EastType]] = []

    def register(self, value: Any, node: dict, t: EastType) -> KernelExpr:
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
    Binding very large tables by reference (no snapshot at all) is a
    separate design — see #393's discussion.
    """
    from east.types.types import ArrayType as _ArrayType
    from east.types.types import DictType as _DictType
    from east.types.types import SetType as _SetType
    from east.types.values import EastArray, EastDict, EastSet, is_east_struct

    if isinstance(value, EastArray):
        elem_t = value.element_type
        arr_t = _ArrayType(elem_t)
        nodes = [_lift(v, hint=elem_t).ir for v in value]
        return _register_const(
            value, KernelExpr(_node("NewArray", type=_type_json(arr_t), values=nodes), arr_t)
        )
    if isinstance(value, EastSet):
        elem_t = value.element_type
        set_t = _SetType(elem_t)
        nodes = [_lift(v, hint=elem_t).ir for v in value]
        return _register_const(
            value, KernelExpr(_node("NewSet", type=_type_json(set_t), values=nodes), set_t)
        )
    if isinstance(value, EastDict):
        k_t, v_t = value.key_type, value.value_type
        dict_t = _DictType(k_t, v_t)
        entries = [
            {"key": _lift(k, hint=k_t).ir, "value": _lift(v, hint=v_t).ir}
            for k, v in value.items()
        ]
        return _register_const(
            value,
            KernelExpr(_node("NewDict", type=_type_json(dict_t), values=entries), dict_t),
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
        fields.append({"name": name, "value": e.ir})
        field_types.append((name, e.east_type))
    struct_t = _StructType(field_types)
    node = _node("Struct", type=_type_json(struct_t), fields=fields)
    return KernelExpr(node, struct_t)


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
        node = _node("Variant", type=_type_json(opt_t), case="some", value=inner.ir)
        return KernelExpr(node, opt_t)
    # `none.value` is the east_null sentinel, not Python None — test the sentinel
    # so this branch (and its type-from-context diagnostic) is actually reachable.
    if value.type == "none" and (is_east_null(value.value) or value.value is None):
        if hint is None or not _is_option(hint):
            raise KernelTraceError(
                "`none` in a traced kernel needs a type from context — pair it with a "
                "some(...) branch in where(), or let the method fall back"
            )
        node = _node("Variant", type=_type_json(hint), case="none", value=_literal(None, NullType))
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
        node = _node("Variant", type=_type_json(hint), case=value.type, value=payload.ir)
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


class KernelExpr:
    """A typed East expression under construction (returned to traced lambdas)."""

    __slots__ = ("ir", "east_type")
    __hash__ = None  # type: ignore[assignment]  # exprs are not usable as dict/set keys

    def __init__(self, ir: dict[str, Any], east_type: EastType):
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
                    _node("GetField", type=_type_json(out_t), field=name, struct=self.ir),
                    out_t,
                )
        available = ", ".join(f["name"] for f in self.east_type.value)
        raise KernelTraceError(f"struct has no field '{name}' (available: {available})")

    def __getattr__(self, name: str) -> KernelExpr:
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
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
        token_t_json = _type_json(token_t)
        token_nodes = []
        for tok in tokenize_datetime_format(fmt):
            if tok.value is None or str(tok.value) == "null":
                payload = _literal(None, NullType)
            else:
                payload = _literal(str(tok.value), StringType)
            token_nodes.append(
                {"type": "Variant", "value": {"type": token_t_json, "loc_id": "0",
                                              "case": tok.type, "value": payload}}
            )
        arr_t = _ArrayType(token_t)
        tokens_ir = _node("NewArray", type=_type_json(arr_t), values=token_nodes)
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
        node = _node(
            "Match",
            type=_type_json(out_t),
            variant=self.ir,
            cases=[
                {"case": "none", "variable": none_var, "body": none_value.ir},
                {"case": "some", "variable": some_var, "body": some_body.ir},
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
            cases.append({"case": c["name"], "variable": var,
                          "body": _literal(c["name"], StringType)})
        node = _node("Match", type=_type_json(StringType), variant=self.ir, cases=cases)
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
            cases.append({"case": c["name"], "variable": var,
                          "body": _literal(c["name"] == tag, BooleanType)})
        node = _node("Match", type=_type_json(BooleanType), variant=self.ir, cases=cases)
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
            case_nodes.append({"case": name, "variable": var, "body": body.ir})
        node = _node("Match", type=_type_json(out_t), variant=self.ir, cases=case_nodes)
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
                body = _node("Error", type=_type_json(out_t), message=msg)
            case_nodes.append({"case": c["name"], "variable": var, "body": body})
        node = _node("Match", type=_type_json(out_t), variant=self.ir, cases=case_nodes)
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
        """Traced ArrayMap: ``fn(element)`` or ``fn(element, index)``."""
        from east.types.types import ArrayType as _ArrayType

        elem_t = self._array_elem("map")
        node, out_t = _trace_inner_fn(fn, [elem_t, IntegerType])
        return KernelExpr(
            _builtin("ArrayMap", _ArrayType(out_t), [elem_t, out_t], [self.ir, node]),
            _ArrayType(out_t),
        )

    def filter(self, fn: Any) -> KernelExpr:
        """Traced ArrayFilter: keep elements where the predicate holds."""
        from east.types.types import ArrayType as _ArrayType

        elem_t = self._array_elem("filter")
        node, out_t = _trace_inner_fn(fn, [elem_t, IntegerType])
        if out_t.type != "Boolean":
            raise KernelTraceError(f".filter() predicate must return Boolean, got {out_t.type}")
        out = _ArrayType(elem_t)
        return KernelExpr(_builtin("ArrayFilter", out, [elem_t], [self.ir, node]), out)

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

    def some(self, fn: Any) -> KernelExpr:
        """Traced any-element predicate (ArrayFold over Boolean or)."""
        return self._quantifier("some", fn)

    def every(self, fn: Any) -> KernelExpr:
        """Traced all-elements predicate (ArrayFold over Boolean and)."""
        return self._quantifier("every", fn)

    def _quantifier(self, op: str, fn: Any) -> KernelExpr:
        elem_t = self._array_elem(op)
        code = getattr(fn, "__code__", None)
        arity = code.co_argcount if code is not None else 1

        def step(acc: KernelExpr, el: KernelExpr, i: KernelExpr) -> KernelExpr:
            pred = _lift(fn(*([el, i][:arity])))
            if pred.east_type.type != "Boolean":
                raise KernelTraceError(
                    f".{op}() predicate must return Boolean, got {pred.east_type.type}"
                )
            return acc | pred if op == "some" else acc & pred

        node, _out = _trace_inner_fn(step, [BooleanType, elem_t, IntegerType], declared=3)
        init = _literal(op == "every", BooleanType)
        return KernelExpr(
            _builtin("ArrayFold", BooleanType, [elem_t, BooleanType], [self.ir, init, node]),
            BooleanType,
        )

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
        some_node = _node("Variant", type=_type_json(out_t), case="some", value=parsed)
        none_node = _node(
            "Variant", type=_type_json(out_t), case="none", value=_literal(None, NullType)
        )
        loc_t = _StructType(
            [("filename", StringType), ("line", IntegerType), ("column", IntegerType)]
        )
        node = _node(
            "TryCatch",
            type=_type_json(out_t),
            try_body=some_node,
            catch_body=none_node,
            message=_var(_fresh_name(), StringType),
            stack=_var(_fresh_name(), ArrayType(loc_t)),
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


def _const_fn_node(param_types: list, body: KernelExpr, out_t: EastType) -> dict:
    """A Function IR node ignoring its parameters and returning `body`."""
    from east.types.types import FunctionType as _FnType

    params = [_var(f"__d{i}", t) for i, t in enumerate(param_types)]
    fn_t = _FnType(list(param_types), out_t)
    return _node(
        "Function", type=_type_json(fn_t), captures=[], parameters=params, body=body.ir
    )


# ─── Nested lambdas + the eager-builtin funnel (#393) ───────────────────────

_fresh_names = itertools.count()


def _fresh_name() -> str:
    """A trace-unique variable name so nested lambdas never shadow outer
    parameters (`split(...).map(lambda v: v + r.id)` must keep `r` visible
    inside the inner function's body)."""
    return f"__n{next(_fresh_names)}"


def _trace_inner_fn(fn: Any, param_types: list[EastType], declared: int | None = None) -> tuple[dict, EastType]:
    """Trace an inner (nested) lambda into a Function IR node.

    ``param_types`` is the builtin's full callback signature (e.g. map takes
    ``(element, index)``); a lambda declaring fewer parameters simply ignores
    the tail. Returns ``(Function node, traced output type)``.
    """
    arity = declared
    if arity is None:
        code = getattr(fn, "__code__", None)
        arity = code.co_argcount if code is not None else len(param_types)
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
    node = _node(
        "Function", type=_type_json(fn_t), captures=[], parameters=params, body=body.ir
    )
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
    node = _node(
        "IfElse",
        type=_type_json(then_e.east_type),
        ifs=[{"predicate": cond.ir, "body": then_e.ir}],
        else_body=else_e.ir,
    )
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


# ─── Tracing + compilation ──────────────────────────────────────────────────


def _function_ir(
    param_types: list[EastType],
    params: list[dict],
    body: KernelExpr,
    consts: list[tuple[str, dict, EastType]] = (),  # type: ignore[assignment]
) -> bytes:
    fn_type = FunctionType(list(param_types), body.east_type)
    fn_node = _node(
        "Function",
        type=_type_json(fn_type),
        # Hoisted constants are captured so they survive the enclosing block:
        # they evaluate ONCE when the kernel compiles, not per call.
        captures=[_var(name, t) for name, _n, t in consts],
        parameters=params,
        body=body.ir,
    )
    top = fn_node
    if consts:
        lets = [
            _node("Let", type=_type_json(t), variable=_var(name, t), value=node)
            for name, node, t in consts
        ]
        top = _node("Block", type=_type_json(fn_type), statements=[*lets, fn_node])
    # east_json_decode_ir's supported shape is the {ir, source_map} wrapper
    # (the same format the TS test suite exports); kernels carry no locations
    # so the source map is empty.
    return json.dumps({"ir": top, "source_map": {"stacks": []}}).encode("utf-8")


def trace(fn: Any, param_types: list[EastType]) -> tuple[bytes, EastType]:
    """Trace ``fn`` over expression proxies; return (IR JSON, output type).

    Raises KernelTraceError when the lambda performs untraceable operations.
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
        The compiled kernel callable.

    Raises:
        KernelTraceError: If the lambda cannot be traced (uses python
            ``if``/``and``/``or``, calls host libraries, etc.).
        TypeError: If ``out`` is given and the traced output type differs.
    """
    types = [param_types] if isinstance(param_types, EastType) else list(param_types)
    if fn is None:
        return lambda f: kernel(types, f, out=out)
    ir_json, out_type = trace(fn, types)
    if out is not None and out != out_type:
        raise TypeError(f"kernel output is {out_type.type}, expected {out.type}")
    from east.runtime.compiler import compile_from_json

    return compile_from_json(ir_json)


# ─── Automatic push-down for eager-method callbacks ─────────────────────────
#
# call_builtin funnels every eager callback through an EastFunction; before
# falling back to the per-element python trampoline it asks try_push_down for
# a native kernel. Tracing runs the lambda ONCE, so it is only attempted when
# a conservative purity gate proves the lambda cannot observe per-element
# python state: it may reference its parameters, plain scalar constants,
# East types/values, `where`, and (one level deep) other lambdas that pass
# the same gate. Anything else — modules, arbitrary callables, mutable
# closures — disables tracing and keeps today's exact python semantics.


def _allowed_global(value: Any, depth: int) -> bool:
    if value is None or isinstance(value, (bool, int, float, str, bytes)):
        return True
    if isinstance(value, EastType):  # East variants/types are immutable constants
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
        return _eligible(value, depth - 1)
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


def _code_is_pure_shape(code: Any) -> bool:
    import dis
    import types as _pytypes

    for ins in dis.get_instructions(code):
        if ins.opname in _MUTATING_OPS:
            return False
    # Nested code objects (inner lambdas, comprehensions) are conservatively
    # ineligible — their references are not checked against the allowlist.
    return not any(isinstance(const, _pytypes.CodeType) for const in code.co_consts)


def _eligible(fn: Any, depth: int = 1) -> bool:
    """Whether tracing ``fn`` is provably semantics-preserving (see above)."""
    code = getattr(fn, "__code__", None)
    if code is None:
        return False
    try:
        import builtins as _builtins

        if not _code_is_pure_shape(code):
            return False
        fn_globals = getattr(fn, "__globals__", {})
        for name in code.co_names:
            if name in fn_globals:
                value = fn_globals[name]
            elif hasattr(_builtins, name):
                value = getattr(_builtins, name)
            else:
                continue  # not resolvable as a global: an attribute name
            if not _allowed_global(value, depth):
                return False
        closure = getattr(fn, "__closure__", None) or ()
        for cell in closure:
            if not _allowed_global(cell.cell_contents, depth):
                return False
    except Exception:
        return False
    return True


def try_push_down(east_fn: Any) -> Any | None:
    """Compile an eager-method callback into a native kernel when safe.

    ``east_fn`` is an ``EastFunction`` (python callable + declared East
    signature). Returns the compiled kernel callable, or ``None`` to use the
    per-element python path. Never raises.
    """
    try:
        if not _eligible(east_fn.fn):
            return None
        ir_json, out_type = trace(east_fn.fn, list(east_fn.input_types))
        if out_type != east_fn.output_type:
            return None
        from east.runtime.compiler import compile_from_json

        return compile_from_json(ir_json)
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
    from east.runtime.compiler import compile_from_json

    key = "identity:" + json.dumps(_type_json(t))
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    body = KernelExpr(_var("__k0", t), t)
    k = compile_from_json(_function_ir([t], [_var("__k0", t)], body))
    _helper_memo[key] = k
    return k


def _second_kernel(t: EastType) -> Any:
    """Compiled (a: t, b: t) -> b (default combine: later value wins)."""
    from east.runtime.compiler import compile_from_json

    key = "second:" + json.dumps(_type_json(t))
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    params = [_var("__k0", t), _var("__k1", t)]
    body = KernelExpr(_var("__k1", t), t)
    k = compile_from_json(_function_ir([t, t], params, body))
    _helper_memo[key] = k
    return k


def _empty_array_kernel(key_t: EastType, element_t: EastType) -> Any:
    """Compiled (k: key_t) -> [] of element_t (group init)."""
    from east.runtime.compiler import compile_from_json

    key = "init:" + json.dumps([_type_json(key_t), _type_json(element_t)])
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    bucket_t = ArrayType(element_t)
    body = KernelExpr(_node("NewArray", type=_type_json(bucket_t), values=[]), bucket_t)
    k = compile_from_json(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _none_init_kernel(key_t: EastType, inner_t: EastType) -> Any:
    """Compiled (k: key_t) -> none : Option<inner_t> (group max/min init)."""
    from east.runtime.compiler import compile_from_json

    key = "noneinit:" + json.dumps([_type_json(key_t), _type_json(inner_t)])
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    opt_t = _option_type(inner_t)
    body = KernelExpr(
        _node("Variant", type=_type_json(opt_t), case="none", value=_literal(None, NullType)),
        opt_t,
    )
    k = compile_from_json(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _pair_field(pair_t: EastType, var: dict, name: str) -> tuple:
    f_t = next(f["type"] for f in pair_t.value if f["name"] == name)
    return _node("GetField", type=_type_json(f_t), field=name, struct=var), f_t


def _append_field_kernel(pair_t: EastType, value_field: str) -> Any:
    """Compiled (acc: [V], p: pair_t, i) -> acc with p.<value_field> pushed."""
    from east.runtime.compiler import compile_from_json

    key = "appendfield:" + json.dumps([_type_json(pair_t), value_field])
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    field_ir, v_t = _pair_field(pair_t, el, value_field)
    bucket_t = ArrayType(v_t)
    acc = _var("__k0", bucket_t)
    push = _builtin("ArrayPushLast", NullType, [v_t], [acc, field_ir])
    block = _node("Block", type=_type_json(bucket_t), statements=[push, acc])
    k = compile_from_json(_function_ir([bucket_t, pair_t], [acc, el], KernelExpr(block, bucket_t)))
    _helper_memo[key] = k
    return k


def _empty_set_kernel(key_t: EastType, element_t: EastType) -> Any:
    """Compiled (k: key_t) -> {} : Set<element_t> (group init)."""
    from east.runtime.compiler import compile_from_json
    from east.types.types import SetType as _SetType

    key = "setinit:" + json.dumps([_type_json(key_t), _type_json(element_t)])
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    set_t = _SetType(element_t)
    body = KernelExpr(_node("NewSet", type=_type_json(set_t), values=[]), set_t)
    k = compile_from_json(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _set_insert_field_kernel(pair_t: EastType, value_field: str) -> Any:
    """Compiled (acc: Set<V>, p: pair_t, i) -> acc with p.<value_field> inserted."""
    from east.runtime.compiler import compile_from_json
    from east.types.types import SetType as _SetType

    key = "setinsfield:" + json.dumps([_type_json(pair_t), value_field])
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    field_ir, v_t = _pair_field(pair_t, el, value_field)
    set_t = _SetType(v_t)
    acc = _var("__k0", set_t)
    ins = _builtin("SetInsert", NullType, [v_t], [acc, field_ir])
    block = _node("Block", type=_type_json(set_t), statements=[ins, acc])
    k = compile_from_json(_function_ir([set_t, pair_t], [acc, el], KernelExpr(block, set_t)))
    _helper_memo[key] = k
    return k


def _empty_dict_kernel(key_t: EastType, k2_t: EastType, v_t: EastType) -> Any:
    """Compiled (k: key_t) -> {} : Dict<k2_t, v_t> (group init)."""
    from east.runtime.compiler import compile_from_json
    from east.types.types import DictType as _DictType

    key = "dictinit:" + json.dumps([_type_json(key_t), _type_json(k2_t), _type_json(v_t)])
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    dict_t = _DictType(k2_t, v_t)
    body = KernelExpr(_node("NewDict", type=_type_json(dict_t), values=[]), dict_t)
    k = compile_from_json(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _dict_insert_fields_kernel(pair_t: EastType, key_field: str, value_field: str) -> Any:
    """Compiled (acc: Dict<K2,V>, p, i) -> acc with (p.<key>, p.<value>) inserted.

    Uses DictInsert, so a duplicate inner key errors — mirroring the TS
    groupToDicts default (resolve collisions with a combine instead).
    """
    from east.runtime.compiler import compile_from_json
    from east.types.types import DictType as _DictType

    key = "dictinsfields:" + json.dumps([_type_json(pair_t), key_field, value_field])
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    k_ir, k2_t = _pair_field(pair_t, el, key_field)
    v_ir, v_t = _pair_field(pair_t, el, value_field)
    dict_t = _DictType(k2_t, v_t)
    acc = _var("__k0", dict_t)
    ins = _builtin("DictInsert", NullType, [k2_t, v_t], [acc, k_ir, v_ir])
    block = _node("Block", type=_type_json(dict_t), statements=[ins, acc])
    k = compile_from_json(_function_ir([dict_t, pair_t], [acc, el], KernelExpr(block, dict_t)))
    _helper_memo[key] = k
    return k


def _append_kernel(element_t: EastType) -> Any:
    """Compiled (acc: [t], el: t) -> acc with el pushed (group fold)."""
    from east.runtime.compiler import compile_from_json

    key = "append:" + json.dumps(_type_json(element_t))
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    bucket_t = ArrayType(element_t)
    acc = _var("__k0", bucket_t)
    el = _var("__k1", element_t)
    push = _builtin("ArrayPushLast", NullType, [element_t], [acc, el])
    block = _node(
        "Block",
        type=_type_json(bucket_t),
        statements=[push, acc],
    )
    body = KernelExpr(block, bucket_t)
    k = compile_from_json(_function_ir([bucket_t, element_t], [acc, el], body))
    _helper_memo[key] = k
    return k
