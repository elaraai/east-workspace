#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``Expression`` — the typed expression proxy handed to traced bodies.

One class per East type kind, mirroring ``libs/east/src/expr/*.ts`` file
for file: ``ArrayExpression`` is the TypeScript ``ArrayExpr``,
``DictExpression`` is ``DictExpr``, ``IntegerExpression`` is
``IntegerExpr``, … Each class carries exactly the methods its kind
supports; a method that does not exist on the receiver's kind is a
build-time error naming the receiver's surface, and there is no
tag-dispatch inside a method — the class IS the tag.

``Expression(ir, east_type)`` dispatches on the type's kind, so every proxy
built anywhere (a lifted literal, a parameter, a builtin's result) is the
class that serves its type. The base class holds what every kind shares:
the IR node and its East type, the total-order comparisons, and the python
protocol points that must fail loudly rather than constant-fold trace-time
state into the result.
"""

from __future__ import annotations

import warnings
from typing import TYPE_CHECKING, Any, ClassVar

from east.expression.errors import ExpressionError, _trace_bail
from east.expression.lift import _hoisted_const_names, _lift, _note_effect
from east.expression.location import location_id as _loc_id
from east.expression.nodes import _builtin, _fresh_name, _k_block, _root_var_name, _var
from east.ir.builders import ir_let
from east.types.types import BooleanType, EastType

if TYPE_CHECKING:
    from east.expression.expr.boolean import BooleanExpression

_COMPARE = {
    "eq": "Equal",
    "ne": "NotEqual",
    "lt": "Less",
    "le": "LessEqual",
    "gt": "Greater",
    "ge": "GreaterEqual",
}

#: East type kind → the ``Expression`` subclass that serves it. Filled as
#: each subclass is defined (``__init_subclass__`` on its ``_kind``).
_CLASSES: dict[str, type[Expression]] = {}

_SURFACES: dict[type, tuple[str, ...]] = {}


def _class_for(east_type: EastType) -> type[Expression]:
    return _CLASSES.get(east_type.type, Expression)


def _surface(cls: type) -> tuple[str, ...]:
    """The public method names of an expression class — what its
    ``__getattr__`` names on a miss. Computed once per class from the class
    itself, so a method added later is covered without a hand-kept list."""
    hit = _SURFACES.get(cls)
    if hit is None:
        hit = tuple(sorted(
            n for n in dir(cls)
            if not n.startswith("_") and callable(getattr(cls, n, None))
        ))
        _SURFACES[cls] = hit
    return hit


def _deprecated_alias(name: str, target: str) -> Any:
    """A method that warns and delegates: the python-idiom spelling of a
    method whose canonical name is the TypeScript one."""

    def method(self: Any, *args: Any, **kwargs: Any) -> Any:
        warnings.warn(
            f".{name}() is deprecated: the spelling is .{target}() (the TypeScript name)",
            DeprecationWarning,
            stacklevel=2,
        )
        return getattr(self, target)(*args, **kwargs)

    method.__name__ = name
    method.__qualname__ = name
    method.__doc__ = f"Deprecated alias of :meth:`{target}` (the TypeScript name)."
    return method


def _is_body(x: Any) -> bool:
    """Whether ``x`` fills a callback slot: a python body, an ``East.function``
    artifact, or a Function-typed expression."""
    if isinstance(x, Expression):
        return x.east_type.type in ("Function", "AsyncFunction")
    return callable(x)


def _fn_init(op: str, a: Any, b: Any) -> tuple[Any, Any]:
    """``(fn, init)`` of a fold's two arguments. The TypeScript order is
    ``(fn, init)``; the python order ``(init, fn)`` is accepted with a
    deprecation warning."""
    if _is_body(a) and not _is_body(b):
        return a, b
    if _is_body(b) and not _is_body(a):
        warnings.warn(
            f".{op}(init, fn) is deprecated: the argument order is .{op}(fn, init) "
            "(the TypeScript order)",
            DeprecationWarning,
            stacklevel=3,
        )
        return b, a
    raise ExpressionError(f".{op}() takes (fn, init): a step body and the initial accumulator")


class Expression:
    """A typed East expression under construction (TS ``Expr``).

    Every concrete kind is a subclass; ``Expression(ir, east_type)`` returns
    the subclass for ``east_type``'s kind.
    """

    __slots__ = ("ir", "east_type")
    __hash__ = None  # type: ignore[assignment]  # exprs are not usable as dict/set keys

    #: The East type kind this class serves (``None`` on the base and on
    #: private intermediate classes).
    _kind: ClassVar[str | None] = None

    def __new__(cls, _ir: Any, east_type: EastType) -> Expression:
        if cls is Expression:
            cls = _class_for(east_type)
        return object.__new__(cls)

    def __init__(self, ir: Any, east_type: EastType):
        self.ir = ir
        self.east_type = east_type

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        kind = cls.__dict__.get("_kind")
        if kind is not None:
            _CLASSES[kind] = cls

    def __repr__(self) -> str:
        return f"<{type(self).__name__}>"

    # ── construction helpers shared by every kind ───────────────────────

    def _expr(self, ir: Any, east_type: EastType) -> Any:
        """A sibling expression — the class for ``east_type``, new node."""
        return Expression(ir, east_type)

    @staticmethod
    def _check_out(op: str, traced_t: EastType, out: EastType | None) -> None:
        """Reject an ``out=`` that disagrees with the traced projection.

        The eager twins accept ``out=`` to PIN a type; the capture always
        knows it, so ``out`` can only confirm or contradict. Contradicting it
        silently would label the result with a type that does not describe
        it — the #467 failure mode.
        """
        if out is not None and out != traced_t:
            raise ExpressionError(
                f"{op} projection yields {traced_t.type}, out= declares {out.type}")

    def _same_typed(self, op: str, other: Any) -> Any:
        """Lift ``other`` and require it to share this expression's East type."""
        o = _lift(other, hint=self.east_type)
        if o.east_type != self.east_type:
            raise ExpressionError(
                f".{op}() operand has East type {o.east_type.type}, "
                f"this expression is {self.east_type.type} of a different shape"
            )
        return o

    def _with_bound_receiver(self, build: Any) -> Any:
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

    # ── mutation plumbing (#578) ────────────────────────────────────────

    def _mutable(self, op: str) -> EastType:
        """Check the receiver can legitimately be mutated; return its type.

        A CAPTURED East collection is a build-time SNAPSHOT hoisted to a
        ``Let`` that the compiled function closes over, so ONE value is shared
        by every call to the kernel — mutating it would leak state between
        calls, silently and only at scale. Refusing it here turns that into a
        trace-time error naming the two spellings that do work.
        """
        root = _root_var_name(self.ir)
        if root is not None and root in _hoisted_const_names():
            raise ExpressionError(
                f".{op}() would mutate a captured constant. A captured East "
                "collection is a build-time snapshot shared by every call to "
                "the compiled kernel, so the mutation would leak between "
                "calls. Build the collection inside the kernel with "
                "East.new_array/new_set/new_dict, or pass it as a trailing "
                "parameter and bind it by reference (East.function(...).bind(table))."
            )
        return self.east_type

    def _effect(self, op: str, node: Any, out_t: EastType) -> Any:
        """The traced mutation, registered so a DISCARDED one is caught.

        A traced callback is ONE expression, so a mutation written as a
        statement — ``acc.append(x)`` on its own line — is evaluated at trace
        time and thrown away, leaving a compiled loop that silently does
        nothing. Recording it lets the trace check that back.
        """
        _note_effect(node, op)
        return self._expr(node, out_t)

    def _typed(self, op: str, value: Any, t: EastType) -> Any:
        v = _lift(value, hint=t)
        if v.east_type != t:
            raise ExpressionError(f".{op}() takes {t.type}, got {v.east_type.type}")
        return v

    # ── attribute misses name the surface ───────────────────────────────

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            # Dunder lookups and internal capability probes
            # (`getattr(x, "_east_c_paged", None)` and friends) must see a
            # missing attribute, not a trace error.
            raise AttributeError(name)
        kind = self.east_type.type
        raise ExpressionError(
            f".{name}() on {kind} — not a method of a {kind}-typed expression "
            f"(supported: {', '.join(_surface(type(self)))})"
        )

    def __getitem__(self, name: Any) -> Any:
        raise _trace_bail(f"[{name!r}] indexing")

    def __call__(self, *_args: Any) -> Any:
        """Only a Function-typed expression is callable (``FunctionExpression``)."""
        raise ExpressionError(f"calling a non-function expression ({self.east_type.type})")

    # ── comparisons (East total order, generic over the operand type) ──

    def _compare(self, op: str, other: Any) -> BooleanExpression:
        other = _lift(other, hint=self.east_type)
        if self.east_type != other.east_type:
            raise ExpressionError(
                f"comparison between different East types "
                f"({self.east_type.type} vs {other.east_type.type})"
            )
        return self._expr(
            _builtin(_COMPARE[op], BooleanType, [self.east_type], [self.ir, other.ir]),
            BooleanType,
        )

    def __eq__(self, other: Any) -> BooleanExpression:  # type: ignore[override]
        return self._compare("eq", other)

    def __ne__(self, other: Any) -> BooleanExpression:  # type: ignore[override]
        return self._compare("ne", other)

    def __lt__(self, other: Any) -> BooleanExpression:
        return self._compare("lt", other)

    def __le__(self, other: Any) -> BooleanExpression:
        return self._compare("le", other)

    def __gt__(self, other: Any) -> BooleanExpression:
        return self._compare("gt", other)

    def __ge__(self, other: Any) -> BooleanExpression:
        return self._compare("ge", other)

    # ── the named comparisons (TS ``equals`` … ``lessThanOrEqual``) ───────

    def equals(self, other: Any) -> BooleanExpression:
        """East structural equality (TS ``equals``; also ``==``)."""
        return self._compare("eq", other)

    def not_equals(self, other: Any) -> BooleanExpression:
        """East inequality (TS ``notEquals``; also ``!=``)."""
        return self._compare("ne", other)

    def less_than(self, other: Any) -> BooleanExpression:
        """East total-order ``<`` (TS ``lessThan``)."""
        return self._compare("lt", other)

    def less_than_or_equal(self, other: Any) -> BooleanExpression:
        """East total-order ``<=`` (TS ``lessThanOrEqual``)."""
        return self._compare("le", other)

    def greater_than(self, other: Any) -> BooleanExpression:
        """East total-order ``>`` (TS ``greaterThan``)."""
        return self._compare("gt", other)

    def greater_than_or_equal(self, other: Any) -> BooleanExpression:
        """East total-order ``>=`` (TS ``greaterThanOrEqual``)."""
        return self._compare("ge", other)

    # the TypeScript aliases
    eq = equals
    equal = equals
    ne = not_equals
    not_equal = not_equals
    lt = less_than
    less = less_than
    lte = less_than_or_equal
    le = less_than_or_equal
    less_equal = less_than_or_equal
    gt = greater_than
    greater = greater_than
    gte = greater_than_or_equal
    ge = greater_than_or_equal
    greater_equal = greater_than_or_equal

    # ── operations that cannot be traced (fail loud) ────────────────────
    # Every python protocol point with a NON-RAISING default must appear
    # here: an unlisted one silently constant-folds trace-time state into
    # the result (#530's f-string). `__repr__` stays usable for diagnostics.

    def __str__(self) -> str:
        raise ExpressionError(
            "f-strings / str() cannot be traced into an East function body — the "
            "expression proxy would constant-fold into the result. Build "
            "strings with `+` concatenation, or East.String.print(T, value) "
            "for a value's text"
        )

    def __format__(self, format_spec: str) -> str:
        raise ExpressionError(
            "f-strings / format() cannot be traced into an East function body — the "
            "expression proxy would constant-fold into the result. Build "
            "strings with `+` concatenation, or East.String.print(T, value) "
            "for a value's text"
        )

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
