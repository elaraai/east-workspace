#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Automatic push-down for eager-method callbacks.

``_call_builtin`` funnels every eager callback through an ``EastFunction``;
before falling back to the per-element python trampoline it asks
``try_push_down`` for a native kernel. Tracing runs the lambda ONCE, so it is
only attempted behind a conservative purity gate (``_eligible``) that proves
the lambda cannot observe per-element python state, and the outcome is
memoised by everything that actually bakes into a trace (``_trace_cache_key``).
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime as _pydatetime
from typing import Any

from east.kernel.control import (
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
from east.kernel.errors import KernelTraceError
from east.kernel.expr import KernelExpr
from east.kernel.lift import _sequence_effect, greatest, least, where
from east.kernel.nodes import _type_key
from east.kernel.trace import trace
from east.types.types import EastType
from east.types.values import EastArray

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


#: The #578 control-flow surface. A tuple compared by IDENTITY, not a set:
#: ``value`` here is any captured binding, and hashing an unhashable one (an
#: East collection, a dict) would raise inside the gate and silently report
#: the whole lambda ineligible.
_CONTROL_FLOW = (
    block, break_, continue_, for_, label, let, new_array, new_dict, new_set,
    ref, try_catch, while_,
)


def _allowed_global(value: Any, depth: int, extra_allowed: Any = None) -> bool:
    if extra_allowed is not None and extra_allowed(value):
        return True
    # A kernel() result retains its source lambda and re-traces when called
    # with proxies (#470) — safe to reference at any nesting depth.
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
    # `lambda el: east_null` must stay traceable
    from east.types.values import is_east_null

    if is_east_null(value):
        return True
    if value is where or value is bool or value is isinstance or value is abs:
        return True
    if value is greatest or value is least:
        return True
    # The control-flow constructs (#578) are dual-mode like `where`: they emit
    # IR inside a trace and run the plain python loop outside one, so a lambda
    # that references one directly is no less traceable than its body.
    if any(value is fn for fn in _CONTROL_FLOW):
        return True
    # kernel.py's own for_each sequencing shim (#565) — pure by construction,
    # and the wrappers that reference it must keep pushing down.
    if value is _sequence_effect:
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


#: code-object id -> (the code object itself — kept alive so the id cannot be
#: reused — and its scan result). The gate and the trace cache both scan per
#: CALL, and a hot aggregate loop hits the same lambda site thousands of
#: times (#422); a code object's bytecode never changes, so this is exact.
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
        # gate. (They used to be conservatively ineligible precisely because
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


# ─── Trace cache (#422) ──────────────────────────────────────────────────────
#
# Eager methods take a FRESH lambda object per call, so a per-group aggregate
# loop used to re-trace an identical lambda once per group — 1,686 groups ×
# ~15 inner eager calls measured 145 s of pure re-tracing on a real census.
# Two callbacks trace identically exactly when they share a code object, the
# declared signature, and every binding the body reads (closure cells and
# loaded globals). Bindings key by what actually bakes into the trace:
# scalars by VALUE; East types structurally; captured plain FUNCTIONS (the
# eager methods' own arity/argument-order wrappers, user helper lambdas) by
# recursing into their code + bindings — identity would make every wrapper
# over a fresh lambda a miss, and worse, a stable lambda over a REBOUND
# global a stale hit; kernels by recursing into their retained source the
# same way. Anything else — mutable collections, bound methods, arbitrary
# objects — makes the call uncacheable and it traces exactly as before:
# soundness never rides on an object staying unchanged.

_TRACE_MEMO_MAX = 512
_push_down_memo: OrderedDict[tuple, Any] = OrderedDict()
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
        # key cannot capture soundly — uncacheable, so every call re-traces
        # and re-binds the callee it actually holds (#561).
        return None
    code = getattr(value, "__code__", None)
    if code is not None:
        if depth == 0 or getattr(value, "__self__", None) is not None:
            # A bound method's trace also bakes ``self``'s (mutable) state,
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
    """The trace-cache key for ``fn`` against ``declared`` signature keys,
    or None (uncacheable) when any binding resists sound keying. ``depth``
    bounds recursion through captured functions, matching the purity gate's
    wrapper depth."""
    code = getattr(fn, "__code__", None)
    if code is None:
        return None
    try:
        pure, names = _code_scan(code)
        if not pure:
            return None
        # The fallback marker flips a failing trace between silent-None and
        # the loud raise, so it is part of the outcome; captured functions
        # carry theirs through the recursive ("f", …) keys below.
        parts: list = [code, declared,
                       bool(getattr(fn, "_east_trace_fallback", False))]
        fn_globals = getattr(fn, "__globals__", {})
        import builtins as _builtins

        for name in sorted(names):
            if name in fn_globals:
                key = _capture_key(fn_globals[name], depth)
            elif hasattr(_builtins, name):
                key = _capture_key(getattr(_builtins, name), depth)
            else:
                # An unresolvable global is part of the trace outcome (it
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
        # re-traces against the current state. An EastDict default is
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
    """The traced output type of a TYPE-TRACEABLE callback, memoised (#422).

    ``_kernel_out_type`` asks this once per eager call; the answer depends
    only on the code, the bindings and the parameter types, so the same
    projection asked per group answers from the cache.
    """
    key = _trace_cache_key(fn, ("out", tuple(_type_key(t) for t in param_types)))
    if key is not None:
        # Unlike the push-down memo, a stored out-type is never None, so
        # None doubles as the miss sentinel and narrows for the checker.
        hit = _out_type_memo.get(key)
        if hit is not None:
            _out_type_memo.move_to_end(key)
            return hit
    out = trace(fn, list(param_types))[1]  # type-only: called-fn binds unused
    if key is not None:
        _out_type_memo[key] = out
        if len(_out_type_memo) > _TRACE_MEMO_MAX:
            _out_type_memo.popitem(last=False)
    return out


def try_push_down(east_fn: Any) -> Any | None:
    """Compile an eager-method callback into a native kernel when safe.

    ``east_fn`` is an ``EastFunction`` (python callable + declared East
    signature). Returns a native callable (carrying ``_eastc_handle``), or
    ``None`` to use the per-element python path. Deterministic outcomes are
    memoised (#422): a fresh-but-identical lambda — same code object, same
    captured bindings, same declared signature — reuses the compiled kernel
    instead of re-tracing, so a per-group aggregate loop traces each inner
    lambda once, not once per group.

    An ELIGIBLE callback — one that passes the purity gate and so LOOKS
    native — that then fails to trace RAISES the ``KernelTraceError``
    instead of silently trampolining: the fallback's only symptom is that
    the job takes hours (#524), and every named trace failure has a traced
    spelling the error message points at. A lambda doing genuine python
    work fails the purity gate and keeps the silent fallback — that path is
    its contract. A callback that traces to a type other than its declared
    output still falls back silently: the declared type may be SAMPLED (the
    #450 family), so a disagreement there is not proof of a mistake.

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
    # A callable declared `_east_trace_fallback = True` keeps the OLD
    # silent-fallback contract: its trace is attempted (a pure body still
    # goes native), and a failure falls back to the per-element python path
    # instead of raising — the eager implementation's own accumulation
    # helpers/adapters and test-harness wrappers, whose python paths are
    # deliberate. The declaration is transitive through closure cells
    # (bounded): a probe or argument-reorder adapter wrapping a declared
    # callable inherits it. Tracked for nativisation on #543; not a user
    # surface.
    def _trace_fallback(fn: Any, depth: int = 3) -> bool:
        if getattr(fn, "_east_trace_fallback", False):
            return True
        if depth == 0:
            return False
        for cell in getattr(fn, "__closure__", None) or ():
            try:
                c = cell.cell_contents
            except ValueError:  # an unassigned cell
                continue
            if callable(c) and _trace_fallback(c, depth - 1):
                return True
        return False

    from east.runtime.errors import NonRetraceableCallError

    key = _trace_cache_key(east_fn.fn, (
        tuple(_type_key(t) for t in east_fn.input_types),
        _type_key(east_fn.output_type)))
    if key is not None:
        hit = _push_down_memo.get(key, _MEMO_MISS)
        if hit is not _MEMO_MISS:
            _push_down_memo.move_to_end(key)
            return hit

    def remember(result: Any) -> Any:
        # Deterministic outcomes only — compiled kernels and the silent
        # Nones (ineligible, sampled-type disagreement, declared fallback).
        # The loud raise re-raises per call, and a generic exception may be
        # transient, so neither is stored.
        if key is not None:
            _push_down_memo[key] = result
            if len(_push_down_memo) > _TRACE_MEMO_MAX:
                _push_down_memo.popitem(last=False)
        return result

    try:
        if not _eligible(east_fn.fn):
            return remember(None)
        ir_value, out_type, fn_binds = trace(east_fn.fn, list(east_fn.input_types),
                                             out_hint=east_fn.output_type)
        if out_type != east_fn.output_type:
            return remember(None)
        from east.runtime.compiler import compile_from_value

        native = compile_from_value(ir_value)
        if fn_binds:
            # Called compiled functions ride as hidden trailing parameters
            # (#561); binding them leaves exactly the builtin's callback
            # signature visible, so the loop and every callee run native.
            native = native.bind(*fn_binds)
        return remember(native)
    except KernelTraceError as exc:
        # The loud contract: a pure-looking callback that fails to trace
        # raises — its silent fallback's only symptom is that the job takes
        # hours (#524). Genuinely-python lambdas fail the purity gate above
        # and keep their fallback; deliberate python paths carry the marker.
        if _trace_fallback(east_fn.fn):
            return remember(None)
        # A call on an already-compiled East function normally LOWERS to the
        # IR Call node now (#561) and never raises here. This cause survives
        # only for the shapes lowering declines — an arity-mismatched call,
        # an argument that does not lift to the parameter type — where the
        # per-element python path is still the documented contract, not a
        # silent performance cliff: raising unconditionally turned every
        # `for_each(lambda e: emit(...))` under the e3 runner into a hard
        # failure (#558 C). Explicit `kernel(...)` still raises for them.
        cause = exc.__cause__
        for _ in range(4):
            if cause is None:
                break
            if isinstance(cause, NonRetraceableCallError):
                return remember(None)
            cause = cause.__cause__
        raise
    except Exception:
        return None

