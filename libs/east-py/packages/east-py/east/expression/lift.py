#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Lifting python values into traced expressions, and the dual-mode operators.

``_lift`` is the funnel every traced value passes through: a literal, a
captured East collection/struct, a ``some``/``none``/``variant`` construction,
a dict struct literal, or an expression that is already traced. ``if_else`` /
``greatest`` / ``least`` sit here too — they emit IfElse when handed traced
operands and evaluate eagerly otherwise, so one lambda works on both paths.

``Expression`` is imported inside the functions that need it: ``expr.py``
imports this module (through the op mixins), so the class is not yet bound
when this module executes.
"""

from __future__ import annotations

from datetime import datetime as _pydatetime
from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.finalize import _capturing_fn
from east.expression.nodes import (
    _fresh_name,
    _is_option,
    _k_block,
    _k_call,
    _k_ifelse,
    _k_new_array,
    _k_new_dict,
    _k_new_matrix,
    _k_new_set,
    _k_new_vector,
    _k_struct,
    _literal,
    _option_inner,
    _option_type,
    _var,
)
from east.ir.builders import ir_variant
from east.types.types import (
    BooleanType,
    DateTimeType,
    EastType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    StringType,
)
from east.types.values import EastArray, EastVariant

if TYPE_CHECKING:
    from east.expression.expr import Expression


# ─── Expression proxy ───────────────────────────────────────────────────────

_INT64_MIN = -(2**63)
_INT64_MAX = 2**63 - 1


def _lift(value: Any, hint: EastType | None = None) -> Expression:
    """Lift a python literal into a constant expression (bool before int!)."""
    from east.expression.expr import Expression
    from east.types.values import is_east_null

    if isinstance(value, Expression):
        return value
    if isinstance(value, (_DeferredIfElse, _Jump)):
        return value.resolve(hint)
    if value is None or is_east_null(value):
        return Expression(_literal(None, NullType), NullType)
    if isinstance(value, bool):
        return Expression(_literal(value, BooleanType), BooleanType)
    if isinstance(value, int):
        if hint is not None and hint.type == "Float":
            return Expression(_literal(float(value), FloatType), FloatType)
        if not (_INT64_MIN <= value <= _INT64_MAX):
            raise ExpressionError(f"integer literal {value} does not fit East's 64-bit Integer")
        return Expression(_literal(value, IntegerType), IntegerType)
    if isinstance(value, float):
        return Expression(_literal(value, FloatType), FloatType)
    if isinstance(value, str):
        return Expression(_literal(value, StringType), StringType)
    if isinstance(value, _pydatetime):
        # `Option<DateTime>.unwrap_or(datetime(...))`, a datetime `if_else`
        # arm, a captured datetime constant — all lift as DateTime
        # literals (#422); every other scalar already did.
        return Expression(_literal(value, DateTimeType), DateTimeType)
    lifted = _lift_variant(value, hint)
    if lifted is not None:
        return lifted
    lifted = _lift_collection(value)
    if lifted is not None:
        return lifted
    if isinstance(value, dict):
        return _lift_struct(value, hint)
    import asyncio

    if asyncio.iscoroutine(value):
        # An async compiled function called in the trace returned its
        # coroutine unexecuted — name the actual problem (#561).
        value.close()
        raise ExpressionError(
            "an AsyncFunction value was called inside a sync traced kernel — "
            "its result is a coroutine, which has no traced form; call it "
            "from python (per-element) instead"
        )
    raise ExpressionError(
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

    def register(self, value: Any, node: Any, t: EastType) -> Expression:
        from east.expression.expr import Expression

        hit = self.by_id.get(id(value))
        if hit is None:
            name = _fresh_name()
            self.by_id[id(value)] = (name, t)
            self.entries.append((name, node, t))
        else:
            name, t = hit
        return Expression(_var(name, t), t)


# The active (outermost) trace's constant registry; inner-lambda traces share
# it so constants hoist to the kernel scope. None outside any trace — then
# constants inline at the use site (correct, just unhoisted).
_const_registry: _ConstRegistry | None = None


# Hoisting is suspended while a loop's INITIAL STATE is lifted. That state is
# the loop's mutable working set, and a hoisted constant is built ONCE when
# the kernel compiles and shared by every call — so seeding an accumulator
# with a captured `EastArray(T)` (the spelling #578 itself uses) would have
# every call append to the same array. Inlined, it is rebuilt per call, which
# is what a working set means. Constants read from the loop's body or
# condition still hoist: those uses are read-only.
_hoisting = True


def _suspend_hoisting() -> bool:
    """Build captured constants inline until hoisting is resumed."""
    global _hoisting
    was = _hoisting
    _hoisting = False
    return was


def _resume_hoisting(previous: bool) -> None:
    """Restore what :func:`_suspend_hoisting` replaced."""
    global _hoisting
    _hoisting = previous


def _register_const(value: Any, expr: Expression) -> Expression:
    if _const_registry is None or not _hoisting:
        return expr
    return _const_registry.register(value, expr.ir, expr.east_type)


class _FnConstRegistry:
    """Per-trace registry of called compiled East function values (#561).

    A traced lambda that CALLS an already-compiled East function value — a
    ``kernel(...).bind(...)`` result, a ``compile_from_*`` function, a
    runner-supplied ``FunctionType`` input such as a streamTask ``emit`` —
    cannot re-trace the callee (its body is native), so the call lowers to
    the IR's ``Call`` node instead: the callee becomes a HIDDEN TRAILING
    PARAMETER of the kernel, referenced by name at every call site, and
    ``East.function`` / ``capture_callback`` bind the recorded function values
    right after compiling (the #399 machinery), so the compiled loop invokes
    the callee natively. Entries are deduped by the callee's C function-value
    pointer, so one sink called at N sites binds once; each entry's hold
    retains the pointer until the bind takes its own reference.
    """

    __slots__ = ("by_ptr", "entries")

    def __init__(self) -> None:
        self.by_ptr: dict[int, str] = {}
        self.entries: list[tuple[str, Any, EastType]] = []

    def register(self, fn_val_ptr: int, hold: Any, fn_t: EastType) -> str:
        name = _fresh_name()
        self.by_ptr[fn_val_ptr] = name
        self.entries.append((name, hold, fn_t))
        return name


# The active trace's called-function registry, managed in lockstep with
# ``_const_registry`` by ``trace()``. None outside any trace — then a call on
# a compiled function value simply runs natively on the plain values it was
# handed; only a proxy-argument call needs lowering (#561).
_fn_registry: _FnConstRegistry | None = None


def _push_registries() -> bool:
    """Install fresh registries for an OUTER trace.

    Returns whether this call opened one: an inner-lambda trace shares the
    outer trace's registries, so its constants hoist to the kernel scope.
    """
    global _const_registry, _fn_registry
    if _const_registry is not None:
        return False
    _const_registry = _ConstRegistry()
    _fn_registry = _FnConstRegistry()
    return True


def _registry_entries() -> tuple[list, list]:
    """The open trace's hoisted constants and called-function binds."""
    assert _const_registry is not None and _fn_registry is not None
    return _const_registry.entries, _fn_registry.entries


def _clear_registries() -> None:
    """Close the outer trace's registries."""
    global _const_registry, _fn_registry, _hoisting
    _const_registry = None
    _fn_registry = None
    _hoisting = True
    _loop_frames.clear()
    _effect_frames.clear()


# One frame per traced callback, holding the mutations it emitted. Python
# evaluates a statement and throws its value away, so
# ``def step(acc, x): acc.append(x); return acc`` traces to a body of just
# ``acc`` — the append is GONE and the compiled loop silently does nothing.
# That is #565's failure reachable from the #578 mutators, and silence is the
# worst version of it, so every mutation is checked back against the body it
# was supposed to land in.
_effect_frames: list[list] = []


def _push_effects() -> None:
    """Begin collecting the mutations a callback emits."""
    _effect_frames.append([])


def _note_effect(node: Any, op: str) -> None:
    """Record a mutation, so the trace can prove it was not discarded."""
    if _effect_frames:
        _effect_frames[-1].append((node, op))


def _pop_effects(body_ir: Any) -> None:
    """Fail if a mutation traced in this scope never reached ``body_ir``."""
    noted = _effect_frames.pop()
    if not noted:
        return
    from east.expression.finalize import _node_children

    seen: set[int] = set()
    stack = [body_ir]
    while stack:
        node = stack.pop()
        if id(node) in seen:
            continue
        seen.add(id(node))
        stack.extend(_node_children(node))
    for node, op in noted:
        if id(node) not in seen:
            raise ExpressionError(
                f".{op}() was evaluated and thrown away — a traced callback is "
                "ONE expression, so a mutation written as a statement does not "
                "reach the compiled body and the loop would silently do "
                f"nothing. Sequence it: East.block(x.{op}(...), result)")


def _tracing() -> bool:
    """Whether a trace is open.

    The dual-mode control-flow constructs (``East.while_`` and friends) decide
    which mode they are in with this, because their operands are LAMBDAS —
    unlike ``if_else``, which can look at its conditions and see a proxy.
    """
    return _const_registry is not None


def _hoisted_const_names() -> frozenset[str]:
    """The names the open trace bound to build-time constants.

    A captured East collection hoists to a ``Let`` evaluated ONCE when the
    kernel compiles (see :class:`_ConstRegistry`), so the compiled function
    closes over one shared value. Mutating it would leak between calls, which
    is what the traced mutators check for.
    """
    if _const_registry is None:
        return frozenset()
    return frozenset(name for name, _t in _const_registry.by_id.values())


def _lower_compiled_call(fn_val_ptr: int, input_type_ptrs: list,
                         output_type_ptr: int, args: tuple) -> Expression | None:
    """Lower a proxy-argument call on a compiled East function to Call IR.

    The cold path behind the bridge's ``NonRetraceableCallError``: the call
    wrappers (and ``_invoke_c_function_py``) ask here before raising. Returns
    the traced ``Call`` expression — registering the callee as a hidden
    trailing parameter — or ``None`` to decline: no active trace, a callee
    the pointer/type plumbing cannot describe, an arity mismatch, or an
    argument that does not lift to the parameter's East type. A declined
    shape then surfaces as the capture's error with
    ``NonRetraceableCallError`` in its cause chain (#558 C). Calling an
    ``AsyncFunction`` value raises the named error — a sync trace has no
    spelling for it.
    """
    if _fn_registry is None or fn_val_ptr == 0 or output_type_ptr == 0:
        return None
    from east._eastc_bridge import c_function_value_type, c_type_ptr_to_py_type
    from east.expression.expr import Expression

    declared = c_function_value_type(fn_val_ptr)
    if declared is not None and declared.type == "AsyncFunction":
        raise ExpressionError(
            "an AsyncFunction value cannot be called inside a sync traced "
            "kernel — call it from python (per-element) instead"
        )
    inputs = [c_type_ptr_to_py_type(p) for p in input_type_ptrs]
    if len(args) != len(inputs):
        return None
    arg_exprs = []
    try:
        for a, t in zip(args, inputs, strict=True):
            e = _lift(a, hint=t)
            if e.east_type != t:
                return None
            arg_exprs.append(e)
    except ExpressionError:
        return None
    out_t = c_type_ptr_to_py_type(output_type_ptr)
    fn_t = FunctionType(list(inputs), out_t)
    name = _fn_registry.by_ptr.get(fn_val_ptr)
    if name is None:
        from east.runtime._compiler_eastc import hold_function_value

        name = _fn_registry.register(fn_val_ptr, hold_function_value(fn_val_ptr), fn_t)
    node = _k_call(out_t, _var(name, fn_t), [e.ir for e in arg_exprs])
    return Expression(node, out_t)


def _lift_collection(value: Any) -> Expression | None:
    """Lift a captured East collection/struct constant (#393).

    The value snapshots into constructor IR (NewArray/NewSet/NewDict/Struct,
    each element lifted recursively) and — inside a trace — hoists to a
    kernel-build-time ``Let`` (see ``_ConstRegistry``), so a TRANS-style
    side-table is built once per compiled kernel, not per evaluation.
    Very large tables should bind by reference instead (no snapshot at
    all): declare a trailing parameter and use
    ``East.function(...).bind(table)`` (#399).
    """
    from east.expression.expr import Expression
    from east.types.types import ArrayType as _ArrayType
    from east.types.types import DictType as _DictType
    from east.types.types import MatrixType as _MatrixType
    from east.types.types import SetType as _SetType
    from east.types.types import VectorType as _VectorType
    from east.types.values import EastDict, EastMatrix, EastSet, EastVector, is_east_struct

    if isinstance(value, EastArray):
        elem_t = value.element_type
        arr_t = _ArrayType(elem_t)
        nodes = [_lift(v, hint=elem_t).ir for v in value]
        return _register_const(
            value, Expression(_k_new_array(arr_t, nodes), arr_t)
        )
    if isinstance(value, EastVector):
        elem_t = value.element_type
        vec_t = _VectorType(elem_t)
        nodes = [_lift(x, hint=elem_t).ir for x in value.to_numpy().tolist()]
        return _register_const(
            value, Expression(_k_new_vector(vec_t, nodes), vec_t)
        )
    if isinstance(value, EastMatrix):
        elem_t = value.element_type
        mat_t = _MatrixType(elem_t)
        flat = value.to_numpy().reshape(-1).tolist()
        nodes = [_lift(x, hint=elem_t).ir for x in flat]
        return _register_const(
            value,
            Expression(_k_new_matrix(mat_t, value.rows, value.cols, nodes), mat_t),
        )
    if isinstance(value, EastSet):
        elem_t = value.element_type
        set_t = _SetType(elem_t)
        nodes = [_lift(v, hint=elem_t).ir for v in value]
        return _register_const(
            value, Expression(_k_new_set(set_t, nodes), set_t)
        )
    if isinstance(value, EastDict):
        k_t, v_t = value.key_type, value.value_type
        dict_t = _DictType(k_t, v_t)
        entries = [
            (_lift(k, hint=k_t).ir, _lift(v, hint=v_t).ir) for k, v in value.items()
        ]
        return _register_const(
            value,
            Expression(_k_new_dict(dict_t, entries), dict_t),
        )
    if is_east_struct(value):
        # A captured struct constant (e.g. a config row) lifts field by field.
        return _register_const(value, _lift_struct({name: value[name] for name in value}))
    return None


def _lift_struct(value: dict, hint: EastType | None = None) -> Expression:
    """Lift a dict of traced expressions/literals into Struct IR.

    Lets kernels build rows naturally: ``lambda el, i: {"i": i, "v": el.x}``.
    With a Struct hint from context (the kernel's declared ``out=``), each
    field lifts under its declared type — which is what lets a field hold a
    general ``variant(case, …)`` or a bare ``none`` (#541).
    """
    from east.expression.expr import Expression
    from east.types.types import StructType as _StructType

    field_hints: dict[str, EastType] = {}
    if hint is not None and getattr(hint, "type", None) == "Struct":
        field_hints = {f["name"]: f["type"] for f in hint.value}

    fields = []
    field_types = []
    for name, item in value.items():
        if not isinstance(name, str):
            raise ExpressionError("struct construction needs string field names")
        e = _lift(item, hint=field_hints.get(name))
        fields.append((name, e.ir))
        field_types.append((name, e.east_type))
    struct_t = _StructType(field_types)
    return Expression(_k_struct(struct_t, fields), struct_t)


def _lift_variant(value: Any, hint: EastType | None) -> Expression | None:
    """Lift `some(<traced expr>)` / the `none` constant into Variant IR.

    `east.some()` wraps without validating, so a traced lambda can build
    options with the ordinary constructors; `none` needs a type hint (from
    an `if_else` arm or the declared callback output).
    """
    from east.expression.expr import Expression
    from east.types.values import is_east_null, is_east_variant

    if not is_east_variant(value) or not isinstance(value, EastVariant):
        return None
    if value.type == "some":
        payload = value.value
        # An Option hint threads into the payload, so `some(variant(case, …))`
        # types the inner variant from the declared context (#541/#536).
        inner_hint = _option_inner(hint) \
            if hint is not None and _is_option(hint) else None
        inner = payload if isinstance(payload, Expression) \
            else _lift(payload, hint=inner_hint)
        opt_t = _option_type(inner.east_type)
        node = ir_variant(opt_t, "some", inner.ir)
        return Expression(node, opt_t)
    # `none.value` is the east_null sentinel, not Python None — test the sentinel
    # so this branch (and its type-from-context diagnostic) is actually reachable.
    if value.type == "none" and (is_east_null(value.value) or value.value is None):
        if hint is None or not _is_option(hint):
            raise ExpressionError(
                "`none` in a traced kernel needs a type from context — pair it with a "
                "some(...) arm in East.if_else(), or declare the output type "
                "(East.function(params, OptionType(T), body); out= on the method)"
            )
        node = ir_variant(hint, "none", _literal(None, NullType))
        return Expression(node, hint)
    if hint is not None and hint.type == "Variant":
        # General variant construction: variant("case", payload) with the
        # type from context (e.g. an if_else() arm or a declared output);
        # the payload may be a traced expression or a liftable literal.
        case_t = next((c["type"] for c in hint.value if c["name"] == value.type), None)
        if case_t is None:
            names = ", ".join(c["name"] for c in hint.value)
            raise ExpressionError(f"variant case {value.type!r} not in {{{names}}}")
        payload = _lift(value.value, hint=case_t)
        if payload.east_type != case_t:
            raise ExpressionError(
                f"variant case {value.type!r} payload has type {payload.east_type.type}, "
                f"expected {case_t.type}"
            )
        node = ir_variant(hint, value.type, payload.ir)
        return Expression(node, hint)
    # A general variant — the 2-arg variant(case, payload) construction
    # carries no VariantType — reached here with no Variant hint (#541).
    raise ExpressionError(
        f"variant({value.type!r}, …) in a traced kernel needs a VariantType from "
        "context — declare the output (East.function(params, VariantType(...), "
        "body), or out= on the eager method), or build it in an East.if_else() "
        "with a typed sibling or a typed struct field"
    )


def _needs_type_context(value: Any) -> bool:
    """Whether a value can only lift with a type from context: a bare
    ``none``, a general ``variant(case, …)`` (the 2-arg construction carries
    no VariantType), or a deferred ``if_else`` over such arms (#541).
    ``some(expr)`` self-types — unless its PAYLOAD is itself context-needing
    (``some(variant(case, …))``), which the surrounding Option hint types."""
    from east.expression.expr import Expression
    from east.types.values import is_east_variant

    if isinstance(value, (_DeferredIfElse, _Jump)):
        return True
    if isinstance(value, Expression) or not is_east_variant(value):
        return False
    if value.type != "some":
        return True
    return _needs_type_context(value.value)


# The loops enclosing the expression being traced, innermost last.
# ``East.while_``/``for_`` push a frame while they trace their callbacks. A
# frame carries the loop's label NAME — east-c matches a jump to a loop by
# name, so an unlabelled jump inside a named loop would otherwise match
# nothing and travel out of the kernel — and a ``commit`` that builds the
# loop's state update, so a jump can hand back a final state.
_loop_frames: list = []


def _push_loop_frame(frame: Any) -> None:
    """Enter a loop's body for tracing."""
    _loop_frames.append(frame)


def _pop_loop_frame() -> None:
    """Leave it again."""
    _loop_frames.pop()


def _loop_frame(name: str | None, jump: str) -> Any:
    """The frame a jump targets — the innermost loop when unlabelled."""
    if not _loop_frames:
        raise ExpressionError(
            f"{jump}() outside any loop — it belongs in a while_/for_ body")
    if name is None:
        return _loop_frames[-1]
    for frame in reversed(_loop_frames):
        if frame.name == name:
            return frame
    raise ExpressionError(f"{jump}() names a label no enclosing loop carries")


#: "no final state given" — distinct from a state that IS ``None``.
_NO_STATE = object()


class _Jump:
    """A traced ``break``/``continue``, waiting for a type from context.

    A jump never produces a value, so nothing about it says what East type it
    stands in for — its ``if_else`` sibling does, or the loop state it replaces.
    That is the same deferral a bare ``none`` needs, so it rides the same
    machinery: ``_needs_type_context`` reports it, ``if_else`` types it from
    another arm, and reaching ``_lift`` with no hint raises the actionable error.

    A jump given a final state commits it first, so leaving a loop does not
    throw away what the iteration worked out — the only way an inner loop can
    report anything to the outer one it breaks.
    """

    __slots__ = ("kind", "label", "state")

    def __init__(self, kind: str, label: str | None, state: Any = _NO_STATE) -> None:
        self.kind = kind
        self.label = label
        self.state = state

    def __repr__(self) -> str:
        return f"<{self.kind.lower()} {self.label!r}>"

    def resolve(self, hint: EastType | None) -> Expression:
        from east.expression.expr import Expression
        from east.ir.builders import ir_break, ir_continue, ir_label

        if hint is None:
            raise ExpressionError(
                f"{self.kind.lower()}_() needs a type from context — put it in a "
                "East.if_else() arm inside a while_/for_ body, where the loop state "
                "types it"
            )
        frame = _loop_frame(self.label, f"{self.kind.lower()}_")
        build = ir_break if self.kind == "Break" else ir_continue
        jump = build(hint, ir_label(frame.name))
        if self.state is _NO_STATE:
            return Expression(jump, hint)
        return Expression(_k_block(hint, [frame.commit(self.state), jump]), hint)


class _DeferredIfElse:
    """A traced ``if_else()`` whose arms ALL need a type from context —
    e.g. ``if_else(cond, variant("a", …), variant("b", …))`` (#541).

    The conditional materialises when the surrounding context supplies the
    type: the kernel's declared ``out=`` (threaded to the root lift), a
    typed struct field, or an enclosing ``if_else`` sibling. Reaching
    ``_lift`` with no hint raises the actionable error instead of the
    opaque cannot-lift one.
    """

    __slots__ = ("conds", "values")

    def __init__(self, conds: list, values: list) -> None:
        self.conds = conds
        self.values = values

    def resolve(self, hint: EastType | None) -> Expression:
        if hint is None:
            raise ExpressionError(
                "if_else() with variant arms throughout needs a type from "
                "context — declare the output (East.function(params, "
                "VariantType(...), body), or out= on the eager method) or "
                "build it in a typed struct field"
            )
        return _ifelse_expr(self.conds, [_lift(v, hint=hint) for v in self.values])


def _with_index(fn: Any) -> Any:
    """Normalise an element callback to the two-argument ``(el, idx)`` shape.

    The eager methods all decide this with ``_callback_arity``, so
    ``a.sum(lambda el, i: …)`` is a supported eager call and the traced twins
    must accept it too or a working lambda stops working inside a kernel
    (#525). Delegating to that same oracle rather than re-deriving from
    ``__code__.co_argcount`` matters: a bound method's ``co_argcount`` counts
    ``self`` and a ``functools.partial`` has no ``__code__`` at all, so a
    hand-rolled probe disagrees with eager on exactly the callables that are
    not plain lambdas. The lazy import mirrors collections.py, which already
    imports from this module lazily.
    """
    from east.types.values.collections import _callback_arity

    return fn if _callback_arity(fn, 1) >= 2 else (lambda el, _i: fn(el))


def _with_acc_index(fn: Any) -> Any:
    """Normalise a fold callback to the three-argument ``(acc, el, idx)`` shape.

    The Array fold slots carry the element index, and the eager methods accept
    a callback that takes it (`_acc_idx_cb` in collections.py), so the traced
    twins must too.
    """
    from east.types.values.collections import _callback_arity

    return fn if _callback_arity(fn, 2) >= 3 else (lambda acc, el, _i: fn(acc, el))


def _with_key_arg(fn: Any) -> Any:
    """Normalise a collision handler to the builtin's ``(existing, incoming, key)``.

    The eager ``_combine_cb`` accepts a 2- or 3-argument handler, so both are
    supported EAGER calls and the traced twins must take both — otherwise a
    working lambda stops working inside a kernel (#525).
    """
    from east.types.values.collections import _callback_arity

    return fn if _callback_arity(fn, 2) >= 3 else (lambda a, b, _k: fn(a, b))


def _trace_inner_fn(fn: Any, param_types: list[EastType], declared: int | None = None,
                    out_hint: EastType | None = None) -> tuple[Any, EastType]:
    """Trace an inner (nested) lambda into a Function IR node.

    ``param_types`` is the builtin's full callback signature (e.g. map takes
    ``(element, index)``); a lambda declaring fewer parameters simply ignores
    the tail. ``out_hint`` types the traced body — a declared callback output
    slot (a filter's Boolean, a fold step's accumulator) or a caller's
    ``out=`` pin — which is what lets a callback build a general variant or a
    ``if_else`` over variant arms (#541, #536). Returns
    ``(Function node, traced output type)``.
    """
    from east.expression.expr import Expression

    arity = declared
    if arity is None:
        code = getattr(fn, "__code__", None)
        if code is None or code.co_flags & 0x04:  # CO_VARARGS: *args takes all
            arity = len(param_types)
        else:
            arity = code.co_argcount
    if not (1 <= arity <= len(param_types)):
        raise ExpressionError(
            f"inner lambda takes {arity} parameters; the callback signature has "
            f"{len(param_types)}"
        )
    names = [_fresh_name() for _ in param_types]
    proxies = [Expression(_var(n, t), t) for n, t in zip(names, param_types, strict=True)]
    _push_effects()
    popped = False
    try:
        try:
            result = fn(*proxies[:arity])
        except ExpressionError:
            raise
        except Exception as e:  # pragma: no cover - message carries the cause
            raise ExpressionError(f"inner lambda is not traceable: {e}") from e
        body = _lift(result, hint=out_hint)
        popped = True
        _pop_effects(body.ir)
    finally:
        if not popped:  # a failed trace must not leak this callback's frame
            _effect_frames.pop()
    params = [_var(n, t) for n, t in zip(names, param_types, strict=True)]
    fn_t = FunctionType(list(param_types), body.east_type)
    node = _capturing_fn(fn_t, params, body.ir)
    return node, body.east_type


def _ifelse_expr(conds: list, arms: list) -> Expression:
    """Build the IfElse from lifted conditions and lifted arms (else last)."""
    from east.expression.expr import Expression

    out_t = arms[0].east_type
    for arm in arms:
        if arm.east_type != out_t:
            raise ExpressionError(
                f"if_else() arms must have the same East type "
                f"({out_t.type} vs {arm.east_type.type})"
            )
    node = _k_ifelse(
        out_t,
        [(c.ir, a.ir) for c, a in zip(conds, arms[:-1], strict=True)],
        arms[-1].ir,
    )
    return Expression(node, out_t)


def if_else(*branches: Any) -> Any:
    """Conditional expression — East ``IfElse`` when traced, eager otherwise.

    Python's ``if``/``and``/``or`` cannot be overloaded, so this IS the
    conditional inside a kernel (``&``, ``|``, ``~`` are the boolean algebra).
    Exactly one arm evaluates at run time, so a guarded partial operation is
    safe.

    Arguments are ``cond, value`` pairs followed by the else value, which
    makes an if/elif/else chain ONE node — the IR's ``ifs`` is an array of
    cases — rather than a nest of conditionals::

        East.if_else(r.qty > 10, "bulk",
                     r.qty > 0,  "retail",
                     "none")

    The two-way case is the same call with one pair::

        East.if_else(r.qty > 0.0, r.price / r.qty, 0.0)

    Args:
        branches: ``cond, value`` pairs then the else value — an odd number of
            arguments, at least three. Conditions are tested in order.

    Returns:
        The chosen value: a traced expression when any condition is traced, a
        plain python value otherwise (so the same lambda works on the traced
        and the per-element python paths).

    Raises:
        ExpressionError: If the argument count is even, a condition is not
            Boolean, or the arms disagree on their East type.
    """
    from east.expression.expr import Expression

    if len(branches) < 3 or len(branches) % 2 == 0:
        raise ExpressionError(
            "if_else() takes cond/value pairs then the else value — an odd "
            f"number of arguments, at least three; got {len(branches)}"
        )
    conds = list(branches[0:-1:2])
    values = list(branches[1:-1:2]) + [branches[-1]]

    if not any(isinstance(c, Expression) for c in conds):
        if any(isinstance(v, (Expression, _DeferredIfElse)) for v in values):
            raise ExpressionError(
                "if_else() received python conditions with traced arms — the "
                "condition must come from the kernel's parameters"
            )
        for cond, value in zip(conds, values, strict=False):
            if cond:
                return value
        return values[-1]

    cond_exprs = []
    for cond in conds:
        e = _lift(cond)
        if e.east_type.type != "Boolean":
            raise ExpressionError(
                f"if_else() condition must be Boolean, got {e.east_type.type}")
        cond_exprs.append(e)

    # An arm that cannot lift unaided — a bare `none`, a general
    # `variant(case, …)`, a break/continue, a nested deferred chain — types
    # itself from a sibling. When EVERY arm needs context the conditional
    # defers whole, typed later by the surrounding context (the kernel's
    # declared out=, a typed struct field, an enclosing if_else) — see
    # _DeferredIfElse (#541).
    settled = next((_lift(v).east_type for v in values
                    if not _needs_type_context(v)), None)
    if settled is None:
        return _DeferredIfElse(cond_exprs, values)
    arms = [_lift(v, hint=settled) for v in values]
    # One reconciliation pass, so an Integer/Float mix agrees whichever arm
    # states its type first.
    widened = next((a.east_type for a in arms if a.east_type != settled), None)
    if widened is not None:
        arms = [_lift(v, hint=widened) for v in values]
    return _ifelse_expr(cond_exprs, arms)


def greatest(a: Any, b: Any) -> Any:
    """max(a, b) by East total order: traced IfElse on expressions, eager on
    plain values (dual-mode like ``if_else`` — the same lambda works on both
    the traced and python paths)."""
    from east.expression.expr import Expression

    if isinstance(a, Expression) or isinstance(b, Expression):
        ae = _lift(a, hint=b.east_type if isinstance(b, Expression) else None)
        be = _lift(b, hint=ae.east_type)
        return if_else(ae >= be, ae, be)
    from east.types.values import type_of
    from east.utils.ordering import greater_equal_for

    return a if greater_equal_for(type_of(a))(a, b) else b


def least(a: Any, b: Any) -> Any:
    """min(a, b) by East total order (dual-mode — see ``greatest``)."""
    from east.expression.expr import Expression

    if isinstance(a, Expression) or isinstance(b, Expression):
        ae = _lift(a, hint=b.east_type if isinstance(b, Expression) else None)
        be = _lift(b, hint=ae.east_type)
        return if_else(ae <= be, ae, be)
    from east.types.values import type_of
    from east.utils.ordering import less_equal_for

    return a if less_equal_for(type_of(a))(a, b) else b


def _sequence_effect(result: Any):
    """The ``for_each`` wrapper contract: evaluate for effect, yield null.

    On the eager per-element path the callback has already RUN — its value is
    simply discarded. On the traced path the callback returns an EXPRESSION,
    and discarding it (the old ``(fn(el), east_null)[1]`` tuple) erased the
    effect from the compiled loop — a pure callback emitting through the
    runner's native sink compiled to a null body and every row was silently
    dropped (#565). A Null-typed expression IS the body; any other type
    sequences through a Block so the call executes and the callback still
    types as ``-> Null``.
    """
    from east.expression.expr import Expression

    if isinstance(result, Expression):
        if result.east_type.type == "Null":
            return result
        from east.types.types import NullType

        return Expression(
            _k_block(NullType, [result.ir, _literal(None, NullType)]), NullType)
    from east.types.values import east_null

    return east_null
