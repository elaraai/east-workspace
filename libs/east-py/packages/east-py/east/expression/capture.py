#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Capturing an eager-method callback as an East function.

``call_builtin`` funnels every eager callback through an ``EastFunction``;
``capture_callback`` turns it into a native kernel by capturing it exactly as
an ``East.function`` body with the builtin's declared signature. The capture
runs the callback ONCE over expression proxies, so a body that does python
work cannot be captured: ``_refused_binding`` finds the reference with no
East form and the capture RAISES naming it (#625) — there is no second
execution path. Outcomes are memoised by everything that bakes into the
capture (``_trace_cache_key``).
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime as _pydatetime
from typing import Any

from east.expression.control import (
    block,
    break_,
    continue_,
    for_,
    label,
    let,
    new_array,
    new_dict,
    new_set,
    ref,
    try_catch,
    while_,
)
from east.expression.errors import ExpressionError
from east.expression.expr import Expression
from east.expression.function import trace
from east.expression.lift import _sequence_effect, greatest, if_else, least
from east.expression.nodes import _type_key
from east.types.types import EastType
from east.types.values import EastArray

# ─── What a captured callback may reference ─────────────────────────────────
#
# The capture runs the callback once, over proxies, so a body that observes
# per-element python state has no East form: it may reference its parameters,
# plain scalar constants, East types/values, `if_else`, precompiled kernels
# (re-traced from their retained source, #470), and — two levels deep, enough
# for the group-sugar wrappers that compose a user callback through an
# internal lambda — other lambdas that pass the same check. Anything else —
# modules, arbitrary callables, mutable closures — cannot be captured, and
# `_capture_error()` says so with the fix-its.


#: The #578 control-flow surface. A tuple compared by IDENTITY, not a set:
#: ``value`` here is any captured binding, and hashing an unhashable one (an
#: East collection, a dict) would raise inside the check and silently report
#: the whole lambda ineligible.
_CONTROL_FLOW = (
    block, break_, continue_, for_, label, let, new_array, new_dict, new_set,
    ref, try_catch, while_,
)


def _allowed_global(value: Any, depth: int, extra_allowed: Any = None) -> bool:
    # A captured Expression INSTANCE is another trace's proxy. Compiling a
    # callback around one would mis-bind the foreign variable against the new
    # kernel's own parameters — a silently wrong answer — so it is REFUSED,
    # first and explicitly (Expression.__getattr__ raises non-AttributeError
    # on the attribute probes below, so probing one is also unsafe). The
    # sanctioned spellings pass the receiver as a parameter (`.bind`) or use
    # the traced method on a traced receiver.
    if isinstance(value, Expression):
        return False
    if extra_allowed is not None and extra_allowed(value):
        return True
    # An East.function artifact retains its source body and re-runs it when
    # called with proxies (#470) — safe to reference at any nesting depth.
    if getattr(value, "_east_retrace", None) is not None:
        return True
    # A compiled East function VALUE — a `.bind` result, a `compile_from_*`
    # function, a decoded FunctionType input: a CALL on it lowers to the IR
    # Call node (#561), and a mere reference fails the lift loudly.
    if getattr(value, "_eastc_handle", None) is not None or \
            getattr(value, "_east_c_handle", None) is not None:
        return True
    if value is None or isinstance(value, (bool, int, float, str, bytes, _pydatetime)):
        return True
    if isinstance(value, EastType):  # East variants/types are immutable constants
        return True
    # the Null sentinel is an immutable constant — side-effect callbacks like
    # `lambda el: east_null` must stay capturable
    from east.types.values import is_east_null

    if is_east_null(value):
        return True
    if value is if_else or value is bool or value is isinstance or value is abs:
        return True
    if value is greatest or value is least:
        return True
    # The control-flow constructs (#578) are dual-mode like `if_else`: they emit
    # IR inside a trace and run the plain python loop outside one, so a lambda
    # that references one directly is no less capturable than its body.
    if any(value is fn for fn in _CONTROL_FLOW):
        return True
    # the for_each sequencing shim (#565) — pure by construction, and the
    # wrappers that reference it must keep capturing.
    if value is _sequence_effect:
        return True
    if value is Expression:
        return True
    # The `East` builtin namespace is a stateless singleton whose calls now
    # trace through the eager funnel (#393) — allowing it lets lambdas like
    # `lambda r: East.String.upper_case(r.sku)` capture automatically.
    # Mutable East collections are deliberately NOT allowed here: a capture
    # snapshots them, and snapshot-vs-live must be the author's explicit
    # choice — `East.function` snapshots, `.bind` keeps the value live.
    from east.namespace import East as _East

    if value is _East:
        return True
    # `some`/`none`/`variant` are pure constructors that _lift_variant turns
    # into Variant IR — allow them so option/variant-returning lambdas capture
    # natively (a general `variant(case, …)` types itself from the declared
    # slot, #541).
    from east.types.construct import none, some, struct, variant

    if value is some or value is none or value is variant or value is struct:
        return True
    if callable(value) and depth > 0:
        return _eligible(value, depth - 1, extra_allowed)
    return False


# Opcodes that mutate state outside the lambda's own frame: a lambda that
# writes a closure/global cell observes per-element execution, which a capture
# (one run, over proxies) cannot express.
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


#: code-object id -> (the code object itself — kept alive so the id cannot be
#: reused — and its scan result). The eligibility check and the capture cache
#: both scan per CALL, and a hot aggregate loop hits the same lambda site
#: thousands of times (#422); a code object's bytecode never changes, so this
#: is exact.
_code_scan_memo: dict[int, tuple[Any, tuple[bool, frozenset[str]]]] = {}


def _code_scan(code: Any) -> tuple[bool, frozenset[str]]:
    """One disassembly pass: (pure shape, names actually loaded as globals).

    Only ``LOAD_GLOBAL``/``LOAD_NAME`` targets count as globals — ``co_names``
    also contains ATTRIBUTE names, and treating those as globals made any
    lambda touching a struct field named after a python builtin (``r.id``,
    ``r.len``, ``r.format``, …) resolve the field name against ``builtins``
    and get refused as impure (#409).
    """
    hit = _code_scan_memo.get(id(code))
    if hit is not None and hit[0] is code:
        return hit[1]
    import dis
    import types as _pytypes

    result: tuple[bool, frozenset[str]] | None = None
    names: set[str] = set()
    for ins in dis.get_instructions(code):
        if ins.opname in _MUTATING_OPS:
            result = (False, frozenset())
            break
        if ins.opname in ("LOAD_GLOBAL", "LOAD_NAME"):
            names.add(ins.argval)
    if result is None:
        # Nested code objects (inner lambdas, comprehensions) are scanned
        # recursively: their mutations and global loads count against the same
        # check. (They used to be conservatively ineligible precisely because
        # their references went unchecked.)
        for const in code.co_consts:
            if isinstance(const, _pytypes.CodeType):
                inner_pure, inner_names = _code_scan(const)
                if not inner_pure:
                    result = (False, frozenset())
                    break
                names |= inner_names
    if result is None:
        result = (True, frozenset(names))
    if len(_code_scan_memo) > 4096:
        _code_scan_memo.clear()
    _code_scan_memo[id(code)] = (code, result)
    return result


#: What ``_refused_binding`` reports when the body itself mutates state
#: outside its own frame — there is no single name to blame.
_MUTATES = "a closure or global it writes to"


def _inner_refused(value: Any, depth: int, extra_allowed: Any) -> str | None:
    """The refusal from INSIDE a python function held in a closure cell.

    The eager methods wrap the user's callback (arity adapters, argument-order
    shims) and hold it as a closure cell, so the binding worth naming is the
    one the WRAPPED body reads — reporting the wrapper's own cell name would
    point at library code. Only closure cells descend: a refused GLOBAL is
    named as the body spells it (a body reaching for ``helper`` is told
    ``helper``, not whatever ``helper`` reads). ``None`` for anything with no
    python body to look inside (a module, a C builtin, a collection).
    """
    if depth > 0 and callable(value) and getattr(value, "__code__", None) is not None:
        return _refused_binding(value, depth - 1, extra_allowed)
    return None


def _refused_binding(fn: Any, depth: int = 4, extra_allowed: Any = None) -> str | None:
    """The first binding that cannot be captured, or None when all can.

    Names the offender so the refusal is actionable: a body reaching for
    ``np``/``random``/a mutable table gets told WHICH reference has no East
    form, rather than a list of everything that could have been wrong.

    ``depth`` bounds recursion through captured callables. Four levels covers
    the deepest in-tree composition (an arity adapter over a sugar step over
    a widening projection over the user callback, ``group_mean``'s Integer
    path) — and since #625 a refusal RAISES instead of silently falling back,
    so a too-shallow depth is a spurious error: lean deep.
    """
    code = getattr(fn, "__code__", None)
    if code is None:
        return "a callable with no python body"
    try:
        import builtins as _builtins

        pure, global_names = _code_scan(code)
        if not pure:
            return _MUTATES
        fn_globals = getattr(fn, "__globals__", {})
        # sorted: the scan yields a frozenset, and a body with two refused
        # globals must name the same one on every run.
        for name in sorted(global_names):
            if name in fn_globals:
                value = fn_globals[name]
            elif hasattr(_builtins, name):
                value = getattr(_builtins, name)
            else:
                continue  # unresolvable global: fails at capture time if reached
            if not _allowed_global(value, depth, extra_allowed):
                return name
        # `co_freevars` names the closure cells in `__closure__` order, so a
        # captured variable is reported by the name the body reads it under.
        names = getattr(code, "co_freevars", ())
        for i, cell in enumerate(getattr(fn, "__closure__", None) or ()):
            held = cell.cell_contents
            if not _allowed_global(held, depth, extra_allowed):
                return _inner_refused(held, depth, extra_allowed) or (
                    names[i] if i < len(names) else "a captured value")
    except Exception as e:
        return f"a binding that could not be inspected ({type(e).__name__})"
    return None


def _eligible(fn: Any, depth: int = 4, extra_allowed: Any = None) -> bool:
    """Whether capturing ``fn`` is provably semantics-preserving (see above)."""
    return _refused_binding(fn, depth, extra_allowed) is None


def _east_value_capture(value: Any) -> bool:
    """Captured East VALUES — pure to lift, so safe for type-only capture."""
    from east.types.values import EastDict, EastSet, is_east_struct, is_east_variant

    if isinstance(value, (EastArray, EastSet, EastDict)):
        return True
    return is_east_struct(value) or is_east_variant(value)


def _immutable_east_capture(value: Any) -> bool:
    """Captured IMMUTABLE East values — a snapshot of one IS the value, so
    the automatic capture admits them (mutable collections stay an explicit
    opt-in: `East.function` snapshots, `.bind` keeps live)."""
    from east.types.values import is_east_struct, is_east_variant

    return is_east_struct(value) or is_east_variant(value)


def _capture_error(refused: str | None = None) -> ExpressionError:
    """The one strict-capture refusal (#625), shared by the automatic capture
    and the type derivation so a python-work callback gets the same fix-it
    everywhere. ``refused`` names the binding that has no East form."""
    what = f"it references {refused}" if refused else "it does python work"
    return ExpressionError(
        f"the callback cannot be captured automatically: {what}, which has "
        "no East form — capture side-tables explicitly with East.function "
        "(a build-time snapshot) or .bind (live, by reference), and write "
        "an explicit python loop for genuine python semantics (#625)"
    )


# ─── Capture cache (#422) ────────────────────────────────────────────────────
#
# Eager methods take a FRESH lambda object per call, so a per-group aggregate
# loop used to re-capture an identical lambda once per group — 1,686 groups ×
# ~15 inner eager calls measured 145 s of pure re-tracing on a real census.
# Two callbacks capture identically exactly when they share a code object, the
# declared signature, and every binding the body reads (closure cells and
# loaded globals). Bindings key by what actually bakes into the capture:
# scalars by VALUE; East types structurally; captured plain FUNCTIONS (the
# eager methods' own arity/argument-order wrappers, user helper lambdas) by
# recursing into their code + bindings — identity would make every wrapper
# over a fresh lambda a miss, and worse, a stable lambda over a REBOUND
# global a stale hit; kernels by recursing into their retained source the
# same way. Anything else — mutable collections, bound methods, arbitrary
# objects — makes the call uncacheable and it captures exactly as before:
# soundness never rides on an object staying unchanged.

_TRACE_MEMO_MAX = 512
_capture_memo: OrderedDict[tuple, Any] = OrderedDict()
_out_type_memo: OrderedDict[tuple, EastType] = OrderedDict()
_MEMO_MISS = object()


def _capture_key(value: Any, depth: int) -> tuple | None:
    """A hashable cache-key part for one captured/global binding, or None
    when the binding cannot be keyed soundly."""
    import types as _pytypes

    from east.types.values import is_east_null, is_east_struct, is_east_variant

    if value is None or isinstance(value, (bool, int, float, str, bytes, _pydatetime)):
        return (type(value).__name__, value)
    if isinstance(value, EastType):
        return ("t", _type_key(value))
    if is_east_null(value):
        return ("null",)
    retrace = getattr(value, "_east_retrace", None)
    if retrace is not None:
        # A precompiled kernel re-traces from its SOURCE when spliced into a
        # surrounding trace, so the source's bindings are what bake — key
        # those, not the wrapper's identity.
        sub = _trace_cache_key(retrace, ("kernel",), depth - 1) if depth > 0 else None
        return None if sub is None else ("k", sub)
    if getattr(value, "_eastc_handle", None) is not None or \
            getattr(value, "_east_c_handle", None) is not None:
        # A compiled East function value with no retained source (a `.bind`
        # result, a decoded FunctionType input) is identity-bound state the
        # key cannot capture soundly — uncacheable, so every call re-captures
        # and re-binds the callee it actually holds (#561).
        return None
    code = getattr(value, "__code__", None)
    if code is not None:
        if depth == 0 or getattr(value, "__self__", None) is not None:
            # A bound method's capture also bakes ``self``'s (mutable) state,
            # which nothing here can key — uncacheable.
            return None
        sub = _trace_cache_key(value, ("fn",), depth - 1)
        return None if sub is None else ("f", sub)
    if isinstance(value, (type, _pytypes.ModuleType)):
        return ("o", value)
    if is_east_struct(value) or is_east_variant(value):
        # Frozen East values (some/none, config structs) — structural
        # hash/eq when the class supports it; refuse otherwise.
        try:
            hash(value)
        except TypeError:
            return None
        return ("v", value)
    return None


def _trace_cache_key(fn: Any, declared: tuple, depth: int = 2) -> tuple | None:
    """The capture-cache key for ``fn`` against ``declared`` signature keys,
    or None (uncacheable) when any binding resists sound keying. ``depth``
    bounds recursion through captured functions, matching the eligibility
    check's wrapper depth."""
    code = getattr(fn, "__code__", None)
    if code is None:
        return None
    try:
        pure, names = _code_scan(code)
        if not pure:
            return None
        parts: list = [code, declared]
        fn_globals = getattr(fn, "__globals__", {})
        import builtins as _builtins

        for name in sorted(names):
            if name in fn_globals:
                key = _capture_key(fn_globals[name], depth)
            elif hasattr(_builtins, name):
                key = _capture_key(getattr(_builtins, name), depth)
            else:
                # An unresolvable global is part of the capture outcome (it
                # raises if reached) — key its absence so it resolving later
                # cannot hit a stale entry.
                key = ("missing",)
            if key is None:
                return None
            parts.append((name, key))
        for cell in getattr(fn, "__closure__", None) or ():
            key = _capture_key(cell.cell_contents, depth)
            if key is None:
                return None
            parts.append(key)
        # Parameter DEFAULTS are bindings too — a callback invoked below its
        # declared arity reads them, and the beast2 segment folds deliberately
        # bind their running (mutable) accumulator this way so each segment
        # re-captures against the current state. An EastDict default is
        # unkeyable, which is exactly right: it makes the call uncacheable.
        for default in getattr(fn, "__defaults__", None) or ():
            key = _capture_key(default, depth)
            if key is None:
                return None
            parts.append(("d", key))
        kwdefaults = getattr(fn, "__kwdefaults__", None) or {}
        for name in sorted(kwdefaults):
            key = _capture_key(kwdefaults[name], depth)
            if key is None:
                return None
            parts.append(("kw", name, key))
        return tuple(parts)
    except Exception:
        return None


def _trace_out_type(fn: Any, param_types: list[EastType]) -> EastType:
    """The captured output type of a callback, memoised (#422).

    ``_kernel_out_type`` asks this once per eager call; the answer depends
    only on the code, the bindings and the parameter types, so the same
    projection asked per group answers from the cache. A callback that cannot
    be captured RAISES here — before any element is touched.
    """
    key = _trace_cache_key(fn, ("out", tuple(_type_key(t) for t in param_types)))
    if key is not None:
        # Unlike the capture memo, a stored out-type is never None, so
        # None doubles as the miss sentinel and narrows for the checker.
        hit = _out_type_memo.get(key)
        if hit is not None:
            _out_type_memo.move_to_end(key)
            return hit
    # The type capture RUNS the callback once over proxies, so python work must
    # be refused BEFORE it executes — the same strict contract as the capture
    # itself (#625). East-value captures (mutable included) are fine here:
    # only the captured TYPE is taken, so snapshot-vs-live cannot be observed.
    refused = _refused_binding(fn, extra_allowed=_east_value_capture)
    if refused is not None:
        raise _capture_error(refused)
    out = trace(fn, list(param_types))[1]  # type-only: called-fn binds unused
    if key is not None:
        _out_type_memo[key] = out
        if len(_out_type_memo) > _TRACE_MEMO_MAX:
            _out_type_memo.popitem(last=False)
    return out


def capture_callback(east_fn: Any) -> Any:
    """Compile an eager-method callback into a native kernel (#625).

    ``east_fn`` is an ``EastFunction`` (python callable + declared East
    signature). The callback is captured exactly as an ``East.function``
    body with the builtin's declared signature: once, over expression
    proxies, with the built expression checked against the declared output
    slot. A capture failure RAISES its ``ExpressionError`` — there is no
    per-element python path behind it, so two syntactically identical
    callbacks can never differ by purity. Captures are memoised as a pure
    cache (#422): a fresh-but-identical lambda — same code object, same
    captured bindings, same declared signature — reuses the compiled kernel
    instead of capturing again.

    A callback that already IS a precompiled kernel — directly, or recorded
    on its wrapper by ``_mark_kernel`` — resolves through the bridge's
    ``_native_kernel_for``: the same signature checks (#467) and arity
    adaptation, so the mark means the same thing to every consumer (#470).
    """
    try:
        from east.runtime._compiler_eastc import native_kernel_for

        native = native_kernel_for(east_fn)
        if native is not None:
            return native
    except Exception:
        pass
    key = _trace_cache_key(east_fn.fn, (
        tuple(_type_key(t) for t in east_fn.input_types),
        _type_key(east_fn.output_type)))
    if key is not None:
        hit = _capture_memo.get(key, _MEMO_MISS)
        if hit is not _MEMO_MISS:
            _capture_memo.move_to_end(key)
            return hit
    # Genuinely-python callbacks fail LOUDLY before the capture runs: a
    # side-effecting body would otherwise capture "successfully" with its
    # effect executed once at build time and then silently dropped from the
    # loop. Immutable East values (structs/variants) capture fine — a
    # snapshot of an immutable value IS the value. A captured MUTABLE
    # collection keeps the explicit-opt-in rule: `East.function` snapshots
    # it, `.bind` keeps it live — the automatic capture must not pick
    # silently.
    refused = _refused_binding(east_fn.fn, extra_allowed=_immutable_east_capture)
    if refused is not None:
        raise _capture_error(refused)
    ir_value, out_type, fn_binds = trace(east_fn.fn, list(east_fn.input_types),
                                         out_hint=east_fn.output_type)
    if out_type != east_fn.output_type:
        raise ExpressionError(
            f"callback produced {out_type.type}, the declared slot is "
            f"{east_fn.output_type.type} — the built expression must match "
            "the method's declared callback type"
        )
    from east.runtime.compiler import compile_from_value

    native = compile_from_value(ir_value)
    if fn_binds:
        # Called compiled functions ride as hidden trailing parameters
        # (#561); binding them leaves exactly the builtin's callback
        # signature visible, so the loop and every callee run native.
        native = native.bind(*fn_binds)
    if key is not None:
        _capture_memo[key] = native
        if len(_capture_memo) > _TRACE_MEMO_MAX:
            _capture_memo.popitem(last=False)
    return native
