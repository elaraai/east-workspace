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
  ``|``, ``~`` and ``where``).

Traced kernels must be pure: the lambda runs ONCE at trace time (exactly
like a TypeScript ``East.function`` builder), so side effects do not repeat
per element. Each ``kernel()`` call compiles a fresh function; reuse the
returned kernel when calling in a loop.
"""

from __future__ import annotations

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

__all__ = ["kernel", "where", "KernelTraceError", "KernelExpr"]


class KernelTraceError(TypeError):
    """The lambda performed an operation that cannot be traced into East IR."""


# ─── JSON wire-format helpers (matches east-c's IR v4 JSON decoder) ─────────


def _type_json(t: EastType) -> Any:
    """Encode a python EastType in the canonical East JSON wire form."""
    from east.serialization.json import encode_json_for

    return json.loads(encode_json_for(EastTypeType)(t))


def _node(case: str, **fields: Any) -> dict[str, Any]:
    """An IR node: a variant of ``case`` with a struct payload.

    Field order matters to the C JSON decoder: the payload's ``type`` comes
    first, then ``loc_id``, then the node-specific fields in declared order
    (callers pass them in that order).
    """
    payload: dict[str, Any] = {"type": fields.pop("type")}
    payload["loc_id"] = "0"
    payload.update(fields)
    return {"type": case, "value": payload}


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
    raise KernelTraceError(
        f"cannot lift python value of type {type(value).__name__} into an East kernel expression"
    )


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
        if not isinstance(name, str):
            raise _trace_bail(f"[{name!r}] indexing")
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


# ─── Tracing + compilation ──────────────────────────────────────────────────


def _function_ir(param_types: list[EastType], params: list[dict], body: KernelExpr) -> bytes:
    fn_type = FunctionType(list(param_types), body.east_type)
    fn_node = _node(
        "Function",
        type=_type_json(fn_type),
        captures=[],
        parameters=params,
        body=body.ir,
    )
    # east_json_decode_ir's supported shape is the {ir, source_map} wrapper
    # (the same format the TS test suite exports); kernels carry no locations
    # so the source map is empty.
    return json.dumps({"ir": fn_node, "source_map": {"stacks": []}}).encode("utf-8")


def trace(fn: Any, param_types: list[EastType]) -> tuple[bytes, EastType]:
    """Trace ``fn`` over expression proxies; return (IR JSON, output type).

    Raises KernelTraceError when the lambda performs untraceable operations.
    """
    proxies = [KernelExpr(_var(f"__k{i}", t), t) for i, t in enumerate(param_types)]
    try:
        result = fn(*proxies)
    except KernelTraceError:
        raise
    except Exception as e:
        raise KernelTraceError(f"kernel lambda is not traceable: {e}") from e
    result = _lift(result)
    params = [_var(f"__k{i}", t) for i, t in enumerate(param_types)]
    return _function_ir(param_types, params, result), result.east_type


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
    if value is KernelExpr:
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
