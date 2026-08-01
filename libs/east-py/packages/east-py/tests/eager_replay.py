#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Replay TS-exported compliance IR through the eager/kernel surface (#474).

The exported corpus is East IR — an East VALUE conforming to ``IRType`` — so
loading is one call through the standard serialization layer, and every node
field is an East value already: a node's ``type`` field IS the east-py type,
a ``Value`` node's payload IS the literal. Nothing here parses anything.

This module is the compiler's twin: where ``compile_from_value`` lowers the
IR value to east-c, this evaluator walks the same IR value and executes every
``Builtin`` node through the USER-FACING python surface — eager collection
methods and the ``East.<Type>.*`` namespaces — so the whole corpus exercises
the layer users actually call. Statement nodes (``Let``/``Block``/``IfElse``/
``Match``/``While``/``For*``/``TryCatch``/…) are interpreted here; only the
builtins are the surface under test. The corpus is self-asserting (its
``testFail`` platform calls), so pass/fail needs no authored expectations.

Callback (``Function``-typed) builtin arguments are materialised per MODE:

- ``kernel``      — the callback IR compiles via ``compile_from_value`` into a
                    precompiled kernel (captures baked as ``Let``s of quoted
                    values), so the eager method takes its native path;
- ``trampoline``  — the same compiled callable hidden behind a plain python
                    closure, so pushdown refuses and the per-element python
                    path runs;
- ``traced``      — the callback IR is replayed against ``KernelExpr`` proxies
                    through the traced surface and re-compiled; nodes the
                    traced surface cannot express are COUNTED (the #452
                    ratchet) and fall back to the kernel-mode callable.

Per-builtin path accounting (``eager_stats`` deltas) verifies the mode really
took its path — values agreeing while the path silently degrades is exactly
the #470 failure shape.
"""

from __future__ import annotations

import json as _pyjson
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from east.ir.builders import (
    ir_block,
    ir_function,
    ir_let,
    ir_new_array,
    ir_new_dict,
    ir_new_set,
    ir_struct,
    ir_value,
    ir_variant,
)
from east.kernel import KernelExpr, KernelTraceError, trace
from east.namespace import East
from east.runtime.compiler import compile_from_value, eager_stats
from east.runtime.errors import EastError
from east.serialization.json import decode_json_for
from east.types.type_of_type import IRType
from east.types.values import (
    EastArray,
    EastDict,
    EastRef,
    EastSet,
    EastStruct,
    EastVariant,
    east_null,
)
from east.types.values.structural import EastFunction
from east.utils.ordering import (
    equal_for,
    greater_equal_for,
    greater_for,
    less_equal_for,
    less_for,
    not_equal_for,
)

_decode_ir = decode_json_for(IRType)


def load_ir(path: str | Path) -> EastVariant:
    """The exported file's ``ir`` member, decoded through the standard
    serialization layer into the homoiconic IR value."""
    raw = _pyjson.loads(Path(path).read_text())
    return _decode_ir(_pyjson.dumps(raw["ir"]))


# ─── value → IR quotation (for baking callback captures) ─────────────────────

def quote_value(value: Any, typ: EastVariant):
    """An IR node that CONSTRUCTS ``value``, driven by its declared type.

    Primitives quote as ``Value`` literals; composites as their constructor
    nodes — the same shapes ``east.ir.builders`` emits everywhere else.
    """
    tag = typ.type
    if tag in ("Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
        return ir_value(typ, None if tag == "Null" else value)
    if tag == "Array":
        return ir_new_array(typ, [quote_value(v, child_type(typ)) for v in value])
    if tag == "Set":
        return ir_new_set(typ, [quote_value(v, child_type(typ)) for v in value])
    if tag == "Dict":
        return ir_new_dict(
            typ, [(quote_value(k, dict_child(typ, "key")),
                   quote_value(v, dict_child(typ, "value")))
                  for k, v in value.items()])
    if tag == "Struct":
        from east._eastc_bridge import resolve_child_type

        return ir_struct(typ, [
            (f["name"], quote_value(value[f["name"]],
                                    resolve_child_type(typ, (("field", f["name"]),))))
            for f in typ.value])
    if tag == "Variant":
        from east._eastc_bridge import resolve_child_type

        return ir_variant(typ, value.type, quote_value(
            value.value, resolve_child_type(typ, (("case", value.type),))))
    raise _Unsupported(f"cannot quote a captured {tag} value")



# ─── child-type extraction (canonical, via the bridge) ──────────────────────

def child_type(t: EastVariant) -> EastVariant:
    """The element/inner type, self-contained: resolved through the bridge's
    C round-trip so Recursive markers rebind at arbitrary depth — never a
    naive ``t.value`` extraction, which leaves escaping markers dangling."""
    from east._eastc_bridge import resolve_child_type

    return resolve_child_type(t, ("element",))


def dict_child(t: EastVariant, part: str) -> EastVariant:
    from east._eastc_bridge import resolve_child_type

    return resolve_child_type(t, (part,))


def _mentions_function(t: EastVariant) -> bool:
    tag = t.type
    if tag in ("Function", "AsyncFunction"):
        return True
    if tag in ("Array", "Set", "Ref", "Vector", "Matrix"):
        return _mentions_function(t.value)
    if tag == "Dict":
        return _mentions_function(t.value["key"]) or _mentions_function(t.value["value"])
    if tag in ("Struct", "Variant"):
        return any(_mentions_function(f["type"]) for f in t.value)
    return False


# ─── control-flow signals ────────────────────────────────────────────────────

class _Return(Exception):
    def __init__(self, value: Any):
        self.value = value


class _Break(Exception):
    def __init__(self, label: str):
        self.label = label


class _Continue(Exception):
    def __init__(self, label: str):
        self.label = label


class _Unsupported(Exception):
    """A node/route the replay cannot express — counted, never silent."""


# ─── environment ─────────────────────────────────────────────────────────────

class Env:
    __slots__ = ("vars", "parent")

    def __init__(self, parent: Env | None = None):
        self.vars: dict[str, Any] = {}
        self.parent = parent

    def get(self, name: str) -> Any:
        e: Env | None = self
        while e is not None:
            if name in e.vars:
                return e.vars[name]
            e = e.parent
        raise _Unsupported(f"unresolved variable {name!r}")

    def define(self, name: str, value: Any) -> None:
        self.vars[name] = value

    def assign(self, name: str, value: Any) -> None:
        e: Env | None = self
        while e is not None:
            if name in e.vars:
                e.vars[name] = value
                return
            e = e.parent
        raise _Unsupported(f"assign to unresolved variable {name!r}")


@dataclass
class Closure:
    """An evaluated Function node: params + body + the creation environment.

    ``native`` records whether mode-materialisation could compile it (False
    once it fell back to an interpreter closure for by-reference captures) —
    path accounting skips calls whose callbacks could never ride natively.

    A Closure can land in a Function-typed VALUE slot (struct fields, arrays
    of functions); ``py_value_to_c`` serializes functions from their attached
    homoiconic IR, so ``_east_ir`` exposes the capture-baked Function node and
    the bridge compiles it — the same path any east-py function value takes.
    """
    node: EastVariant
    env: Env
    native: bool = True

    @property
    def payload(self) -> EastStruct:
        return self.node.value

    def __call__(self, *args: Any) -> Any:
        return _EVALUATOR_OF[id(self)].call(self, list(args)) \
            if id(self) in _EVALUATOR_OF else self._call_detached(args)

    def _call_detached(self, args: Any) -> Any:
        raise _Unsupported("closure invoked outside its evaluator")

    @property
    def _east_ir(self) -> Any:
        return _baked_node(self)

    @property
    def _east_captures(self) -> dict:
        return {}


# Closure → owning evaluator (module-level so Closure can stay a light value).
_EVALUATOR_OF: dict[int, EagerEvaluator] = {}


def _baked_node(clo: Closure) -> Any:
    """The closure's Function IR with captures baked as quoted Lets."""
    p = clo.payload
    captures = list(p["captures"])
    if not captures:
        return ir_function(p["type"], [], list(p["parameters"]), p["body"])
    lets = [
        ir_let(var.value["type"], var,
               quote_value(clo.env.get(var.value["name"]), var.value["type"]))
        for var in captures
    ]
    return ir_block(p["type"], [*lets, clo.node])


# ─── per-run accounting ──────────────────────────────────────────────────────

@dataclass
class Report:
    routes: Counter = field(default_factory=Counter)          # (builtin, route)
    path_violations: list = field(default_factory=list)       # (builtin, detail)
    untraceable: Counter = field(default_factory=Counter)     # node kind / reason
    unsupported: Counter = field(default_factory=Counter)     # skip reasons
    tests_passed: int = 0
    tests_failed: list = field(default_factory=list)          # (name, error)

    def merge(self, other: Report) -> None:
        self.routes.update(other.routes)
        self.path_violations.extend(other.path_violations)
        self.untraceable.update(other.untraceable)
        self.unsupported.update(other.unsupported)
        self.tests_passed += other.tests_passed
        self.tests_failed.extend(other.tests_failed)


# ─── the evaluator ───────────────────────────────────────────────────────────

class EagerEvaluator:
    """Executes decoded IR with Builtin nodes routed through the user surface."""

    def __init__(self, mode: str = "kernel", report: Report | None = None):
        assert mode in ("kernel", "trampoline", "traced")
        self.mode = mode
        self.report = report if report is not None else Report()
        self.test_depth = 0
        self._canon_memo: dict[int, Any] = {}

    def canon(self, t: Any) -> Any:
        """Node types may carry the TS id-dialect Recursive form; the pure-
        python machinery (ordering, construction, tracing) speaks the depth
        dialect — normalize through the bridge, memoized per type object."""
        hit = self._canon_memo.get(id(t))
        if hit is not None:
            return hit[0]
        from east._eastc_bridge import canonicalize_type

        got = canonicalize_type(t)
        self._canon_memo[id(t)] = (got, t)  # keep t alive for id() stability
        return got

    @staticmethod
    def _klift(value: Any, hint: Any) -> Any:
        """A KernelExpr for a constructor child: proxies pass through, plain
        values lift as typed constants."""
        if isinstance(value, KernelExpr):
            return value
        from east.kernel import _lift

        return _lift(value, hint=hint)

    @staticmethod
    def _in_trace() -> bool:
        """Whether a kernel trace is active. A MUTABLE-container construction
        inside a trace must emit constructor IR even with no traced children:
        an eager value would lift as a hoisted CONSTANT shared across calls —
        an init callback returning `[]` would hand every group one aliased
        accumulator. (`east.kernel` the attribute is the kernel() function,
        shadowing the submodule — go through sys.modules.)"""
        import sys as _sys

        mod = _sys.modules.get("east.kernel")
        return mod is not None and mod._const_registry is not None

    # ── program entry ──

    def run_program(self, ir: EastVariant) -> Report:
        """Run an exported spec program (an argless (Async)Function head)."""
        assert ir.type in ("Function", "AsyncFunction"), ir.type
        self.call(Closure(ir, Env()), [])
        return self.report

    # ── closures ──

    def call(self, fn: Any, args: list) -> Any:
        if isinstance(fn, Closure):
            p = fn.payload
            env = Env(fn.env)
            params = list(p["parameters"])
            # The python user surface narrows some callback signatures (e.g.
            # for_each provides the element but not the index): bind the
            # provided prefix; a body that READS a dropped parameter fails
            # loudly rather than getting a fabricated value.
            for i, var in enumerate(params):
                env.define(var.value["name"],
                           args[i] if i < len(args) else _MissingArg(var.value["name"]))
            try:
                return self.eval(p["body"], env)
            except _Return as r:
                return r.value
        if callable(fn):
            return fn(*args)
        raise _Unsupported(f"call of non-function {type(fn).__name__}")

    # ── the walk ──

    def eval(self, node: EastVariant, env: Env) -> Any:  # noqa: PLR0911, PLR0912, PLR0915
        kind = node.type
        p = node.value

        if kind == "Value":
            lit = p["value"]
            return east_null if lit.type == "Null" else lit.value
        if kind == "Variable":
            return env.get(p["name"])
        if kind == "Let":
            env.define(p["variable"].value["name"], self.eval(p["value"], env))
            return east_null
        if kind == "Assign":
            env.assign(p["variable"].value["name"], self.eval(p["value"], env))
            return east_null
        if kind == "As":
            return self.eval(p["value"], env)
        if kind == "Block":
            scope = Env(env)
            result: Any = east_null
            for stmt in p["statements"]:
                result = self.eval(stmt, scope)
            return result
        if kind == "IfElse":
            for case in p["ifs"]:
                if self._truth(self.eval(case["predicate"], env)):
                    return self.eval(case["body"], Env(env))
            return self.eval(p["else_body"], Env(env))
        if kind == "Match":
            subject = self.eval(p["variant"], env)
            if isinstance(subject, KernelExpr):
                raise _Unsupported("Match over a traced subject outside a callback")
            for case in p["cases"]:
                if case["case"] == subject.type:
                    scope = Env(env)
                    scope.define(case["variable"].value["name"], subject.value)
                    return self.eval(case["body"], scope)
            raise EastError(f"unmatched variant case: {subject.type}", [])
        if kind == "GetField":
            return self.eval(p["struct"], env)[p["field"]]
        if kind == "Struct":
            fields = [(f["name"], self.eval(f["value"], env)) for f in p["fields"]]
            if any(isinstance(v, KernelExpr) for _n, v in fields) or self._in_trace():
                # construction from traced parts IS a traced expression —
                # an eager value holding proxies would hoist as a "constant"
                # referencing kernel parameters (unbound outside the fn).
                # Use the kernel's LAZY constructors: the eager builders'
                # EastArray children convert nodes mid-trace (#411)
                from east.kernel import _k_struct

                t = self.canon(p["type"])
                ftypes = {f["name"]: f["type"] for f in t.value}
                node2 = _k_struct(t, [(n, self._klift(v, ftypes[n]).ir) for n, v in fields])
                return KernelExpr(node2, t)
            return EastStruct(dict(fields))
        if kind == "Variant":
            val = self.eval(p["value"], env)
            if isinstance(val, KernelExpr) or self._in_trace():
                # in-trace: the node's DECLARED type keeps every case — an
                # eager variant would be sampled to a single-case type (#450)
                t = self.canon(p["type"])
                ctypes = {c["name"]: c["type"] for c in t.value}
                return KernelExpr(ir_variant(t, p["case"], self._klift(val, ctypes[p["case"]]).ir), t)
            return EastVariant(p["case"], val)
        if kind == "NewArray":
            # coerce_to is the type-DRIVEN constructor (it derives child types
            # itself, so Recursive markers stay bound); function-bearing
            # element types construct directly — coercion rightly refuses to
            # conjure function values, but Closures serialize via _east_ir
            t = self.canon(p["type"])
            vals = [self.eval(v, env) for v in p["values"]]
            if any(isinstance(v, KernelExpr) for v in vals) or self._in_trace():
                from east.kernel import _k_new_array

                et = child_type(t)
                return KernelExpr(_k_new_array(t, [self._klift(v, et).ir for v in vals]), t)
            if _mentions_function(t):
                return EastArray(child_type(t), vals)
            from east.types.coercion import coerce_to

            return coerce_to(vals, t)
        if kind == "NewSet":
            t = self.canon(p["type"])
            vals = [self.eval(v, env) for v in p["values"]]
            if any(isinstance(v, KernelExpr) for v in vals) or self._in_trace():
                from east.kernel import _k_new_set

                et = child_type(t)
                return KernelExpr(_k_new_set(t, [self._klift(v, et).ir for v in vals]), t)
            if _mentions_function(t):
                return EastSet(child_type(t), vals)
            from east.types.coercion import coerce_to

            return coerce_to(vals, t)
        if kind == "NewDict":
            t = self.canon(p["type"])
            kt, vt = dict_child(t, "key"), dict_child(t, "value")
            entries = [(self.eval(e["key"], env), self.eval(e["value"], env)) for e in p["values"]]
            if any(isinstance(x, KernelExpr) for kv in entries for x in kv) or self._in_trace():
                from east.kernel import _k_new_dict

                return KernelExpr(_k_new_dict(
                    t, [(self._klift(k, kt).ir, self._klift(v, vt).ir) for k, v in entries]), t)
            d = EastDict(kt, vt)
            for k, v in entries:
                d[k] = v
            return d
        if kind == "NewRef":
            return EastRef(self.eval(p["value"], env))
        if kind == "NewVector":
            from east.types.values import EastVector

            return EastVector(child_type(self.canon(p["type"])), [self.eval(v, env) for v in p["values"]])
        if kind == "NewMatrix":
            import numpy as np

            from east.types.values import EastMatrix

            vals = [self.eval(v, env) for v in p["values"]]
            rows, cols = p["rows"], p["cols"]
            return EastMatrix(child_type(self.canon(p["type"])),
                              np.array(vals).reshape(rows, cols), rows, cols)
        if kind in ("WrapRecursive", "UnwrapRecursive"):
            return self.eval(p["value"], env)
        if kind in ("Function", "AsyncFunction"):
            clo = Closure(node, env)
            _EVALUATOR_OF[id(clo)] = self
            return clo
        if kind in ("Call", "CallAsync"):
            fn = self.eval(p["function"], env)
            return self.call(fn, [self.eval(a, env) for a in p["arguments"]])
        if kind == "While":
            label = p["label"]["name"]
            while self._truth(self.eval(p["predicate"], env)):
                try:
                    self.eval(p["body"], Env(env))
                except _Continue as c:
                    if c.label != label:
                        raise
                except _Break as b:
                    if b.label != label:
                        raise
                    break
            return east_null
        if kind == "ForArray":
            arr = self.eval(p["array"], env)
            return self._for_loop(p, env, arr, enumerate(arr), key_value=True)
        if kind == "ForSet":
            s = self.eval(p["set"], env)
            return self._for_loop(p, env, s, ((el, None) for el in s), key_value=False)
        if kind == "ForDict":
            d = self.eval(p["dict"], env)
            return self._for_loop(p, env, d, d.items(), key_value=True)
        if kind == "Return":
            raise _Return(self.eval(p["value"], env))
        if kind == "Break":
            raise _Break(p["label"]["name"])
        if kind == "Continue":
            raise _Continue(p["label"]["name"])
        if kind == "Error":
            msg = self.eval(p["message"], env)
            if isinstance(msg, KernelExpr):
                # data-dependent raise inside a trace replay — untraceable
                raise _Unsupported("Error node over a traced message")
            raise EastError(msg, [])
        if kind == "TryCatch":
            try:
                result = self.eval(p["try_body"], Env(env))
            except (_Return, _Break, _Continue, _Unsupported):
                raise
            except Exception as e:
                # the eager surface raises pythonic errors (ValueError,
                # KeyError, …) where East raises runtime errors — TryCatch
                # parity treats any of them as the caught error; message
                # differences surface in the corpus's own assertions.
                # KeyError/IndexError repr-quote their str(); the message is
                # args[0]
                caught = e.args[0] if isinstance(e, LookupError) and e.args \
                    and isinstance(e.args[0], str) else str(e)
                scope = Env(env)
                scope.define(p["message"].value["name"], caught)
                from east.types.type_of_type import LocationType

                scope.define(p["stack"].value["name"], EastArray(LocationType, []))
                result = self.eval(p["catch_body"], scope)
            finally:
                self.eval(p["finally_body"], Env(env))
            return result
        if kind == "Platform":
            return self._platform(p, env)
        if kind == "Builtin":
            return self._builtin(node, env)
        raise _Unsupported(f"IR node kind {kind}")

    @staticmethod
    def _truth(value: Any) -> bool:
        if isinstance(value, KernelExpr):
            raise _Unsupported("python branch on a traced predicate")
        return bool(value)

    def _for_loop(self, p: EastStruct, env: Env, container: Any, items: Any,
                  *, key_value: bool) -> Any:
        label = p["label"]["name"]
        # East for-loops guard against mutation during iteration; the eager
        # containers carry the same lock the bulk mutators consult.
        container._lock_for_iteration()
        try:
            for k, v in items:
                scope = Env(env)
                scope.define(p["key"].value["name"], k)
                if key_value:
                    scope.define(p["value"].value["name"], v)
                try:
                    self.eval(p["body"], scope)
                except _Continue as c:
                    if c.label != label:
                        raise
                except _Break as b:
                    if b.label != label:
                        raise
                    break
        finally:
            container._unlock_for_iteration()
        return east_null

    # ── platform: the four self-assertion harness functions ──

    def _platform(self, p: EastStruct, env: Env) -> Any:
        name = p["name"]
        args = [self.eval(a, env) for a in p["arguments"]]
        if name == "describe":
            return self.call(args[1], [])
        if name == "test":
            self.test_depth += 1
            try:
                self.call(args[1], [])
                self.report.tests_passed += 1
            except (_Break, _Continue):
                raise
            except Exception as e:  # any python failure = that test fails, recorded
                self.report.tests_failed.append((args[0], f"{type(e).__name__}: {e}"))
            finally:
                self.test_depth -= 1
            return east_null
        if name == "testPass":
            return east_null
        if name == "testFail":
            raise AssertionError(args[0])
        raise _Unsupported(f"platform function {name!r}")

    # ── callbacks per mode ──

    def make_callback(self, clo: Closure) -> Any:
        """A python callable for a Function-typed builtin argument, shaped by
        the mode. Callbacks whose captures are mutable or container-typed are
        NOT baked — East captures by reference, and a baked copy would hide
        mutations (an accumulating forEach would silently count on the copy) —
        they run as interpreter closures instead, counted as such."""
        p = clo.payload
        if any(isinstance(clo.env.get(v.value["name"]), KernelExpr)
               for v in p["captures"]):
            # materialized INSIDE a trace replay: a capture is the outer
            # trace's proxy, so a standalone compile would leave it free —
            # hand back the replay and let the enclosing trace absorb the
            # body into its own IR (how nested lambdas compose)
            self.report.routes[("<nested-trace>", "traced")] += 1
            return self._replay_fn(clo)
        if not self._bake_safe(p["captures"]):
            self.report.routes[("<captures-by-ref>", "interpreted")] += 1
            clo.native = False
            return lambda *args: self.call(clo, list(args))
        if self.mode == "traced":
            traced = self._traced_callback(clo)
            if traced is not None:
                return traced
        compiled = self._compile_closure(clo)
        if self.mode == "trampoline":
            n = len(p["parameters"])

            def hidden(*args: Any) -> Any:
                return compiled(*args[:n])

            return hidden
        return compiled

    @staticmethod
    def _bake_safe(captures: Any) -> bool:
        def immutable(t: EastVariant) -> bool:
            tag = t.type
            if tag in ("Null", "Boolean", "Integer", "Float", "String",
                       "DateTime", "Blob", "Never"):
                return True
            if tag == "Struct":
                return all(immutable(f["type"]) for f in t.value)
            if tag == "Variant":
                return all(immutable(c["type"]) for c in t.value)
            return False  # Array/Set/Dict/Ref/Function/Recursive: by reference

        return all(
            not var.value["mutable"] and immutable(var.value["type"])
            for var in captures
        )

    def _compile_closure(self, clo: Closure) -> Any:
        """``compile_from_value`` on the callback IR, captures baked as Lets of
        quoted values — the same ``Block[Let…, Function]`` shape the kernel
        tracer emits for hoisted constants.

        The compiled callable also gets ``_east_retrace`` (#470's dual-mode
        hook), pointing at a proxy-replay of the same body — so wrappers that
        REORDER arguments (the dict ``(k,v)`` methods) still trace natively
        exactly as user `kernel()` results do."""
        compiled = compile_from_value(_baked_node(clo))
        replay = self._replay_fn(clo)

        def dual(*args: Any) -> Any:
            # mirror kernel()'s dual-mode wrapper (#470): proxies re-run the
            # body through the replay; plain values execute natively
            if any(isinstance(x, KernelExpr) for x in args):
                return replay(*args)
            return compiled(*args)

        dual._eastc_handle = compiled._eastc_handle
        dual.bind = compiled.bind
        dual._east_compiled = compiled
        dual._east_retrace = replay
        return dual

    def _replay_fn(self, clo: Closure) -> Any:
        p = clo.payload

        def replay(*proxies: Any) -> Any:
            env = Env(clo.env)
            for var, proxy in zip(p["parameters"], proxies, strict=False):
                env.define(var.value["name"], proxy)
            return self.eval(p["body"], env)

        return replay

    def _traced_callback(self, clo: Closure) -> Any | None:
        """Replay the callback body over KernelExpr proxies through the traced
        surface; None (counted) when a node has no traced expression form."""
        p = clo.payload
        param_types = [self.canon(v.value["type"]) for v in p["parameters"]]
        try:
            ir_value_, _out = trace(self._replay_fn(clo), param_types)
        except (KernelTraceError, _Unsupported) as e:
            self.report.untraceable[str(e)[:80]] += 1
            return None
        return compile_from_value(ir_value_)

    # ── builtin dispatch ──

    def _builtin(self, node: EastVariant, env: Env) -> Any:
        p = node.value
        name = p["builtin"]
        out_t = self.canon(p["type"])
        tps = [self.canon(t) for t in p["type_parameters"]]
        raw_args = list(p["arguments"])
        args = [self.eval(a, env) for a in raw_args]

        row = _ROWS.get(name)
        traced_ctx = any(isinstance(a, KernelExpr) for a in args)
        cbs = [i for i, a in enumerate(args) if isinstance(a, Closure)]

        if row is not None and not traced_ctx:
            before = eager_stats()
            try:
                result = row(self, node, args)
            except _Unsupported as e:
                self.report.unsupported[str(e)[:80]] += 1
                row = None  # fall through to the funnel, counted
            else:
                native_cbs = any(args[i].native for i in cbs)
                self._account(name, before, had_callbacks=native_cbs)
                self.report.routes[(name, "surface")] += 1
                return result
        if row is not None and traced_ctx:
            # inside a traced callback replay: the row itself runs against
            # proxies (KernelExpr methods / namespace funnel) and emits IR
            result = row(self, node, args)
            self.report.routes[(name, "traced")] += 1
            return result

        # funnel fallback: no user-surface row yet — counted, never silent
        from east.types.values._helpers import _call_builtin

        conv = []
        for a in args:
            if isinstance(a, Closure):
                pp = a.payload
                from east._eastc_bridge import resolve_child_type

                conv.append(EastFunction(
                    self.make_callback(a),
                    [self.canon(v.value["type"]) for v in pp["parameters"]],
                    resolve_child_type(pp["type"], ("output",)),
                ))
            else:
                conv.append(a)
        self.report.routes[(name, "funnel")] += 1
        return _call_builtin(name, tps, conv, out_t)

    def _account(self, name: str, before: dict, *, had_callbacks: bool) -> None:
        if not had_callbacks or self.mode == "traced":
            return
        after = eager_stats()
        tramp = after["trampoline_calls"] - before["trampoline_calls"]
        native = (after["kernel_direct"] - before["kernel_direct"]) + (
            after["pushdown_traced"] - before["pushdown_traced"])
        if self.mode == "kernel" and tramp:
            self.report.path_violations.append(
                (name, f"kernel mode trampolined {tramp}×"))
        if self.mode == "trampoline" and native:
            self.report.path_violations.append(
                (name, f"trampoline mode went native {native}×"))


# ─── the mapping table: BuiltinName → user-surface call ──────────────────────
# Collection rows are explicit (they reshape callbacks/argument order to the
# python method signatures); scalar rows are DERIVED from the East namespaces
# below — the namespace methods are thin 1:1 builtin mirrors, and each one's
# builtin name sits in its code constants, so the user surface itself is the
# register.

def _cb(ev: EagerEvaluator, a: Any) -> Any:
    return ev.make_callback(a) if isinstance(a, Closure) else a


def _out(node: EastVariant) -> EastVariant:
    # rows receive the evaluator; the canonical form is what the eager
    # methods' out= guards and constructors expect
    from east._eastc_bridge import canonicalize_type

    return canonicalize_type(node.value["type"])


def _opt_inner(t: EastVariant) -> EastVariant:
    """The `some` payload of an Option type, self-contained."""
    from east._eastc_bridge import resolve_child_type

    return resolve_child_type(t, (("case", "some"),))


_ROWS: dict[str, Any] = {
    # comparisons — user spelling is the ordering-function surface
    "Equal": lambda ev, n, a: equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], KernelExpr) and not isinstance(a[1], KernelExpr)
    else a[0] == a[1],
    "NotEqual": lambda ev, n, a: not_equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], KernelExpr) and not isinstance(a[1], KernelExpr)
    else a[0] != a[1],
    "Less": lambda ev, n, a: less_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], KernelExpr) and not isinstance(a[1], KernelExpr)
    else a[0] < a[1],
    "LessEqual": lambda ev, n, a: less_equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], KernelExpr) and not isinstance(a[1], KernelExpr)
    else a[0] <= a[1],
    "Greater": lambda ev, n, a: greater_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], KernelExpr) and not isinstance(a[1], KernelExpr)
    else a[0] > a[1],
    "GreaterEqual": lambda ev, n, a: greater_equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], KernelExpr) and not isinstance(a[1], KernelExpr)
    else a[0] >= a[1],
    # Array
    "ArrayMap": lambda ev, n, a: a[0].map(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].map(_cb(ev, a[1])),
    "ArrayFilter": lambda ev, n, a: a[0].filter(_cb(ev, a[1])),
    "ArrayFilterMap": lambda ev, n, a: a[0].filter_map(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].filter_map(_cb(ev, a[1])),
    "ArrayFirstMap": lambda ev, n, a: a[0].first_map(_cb(ev, a[1]), out=_opt_inner(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].first_map(_cb(ev, a[1])),
    "ArrayFold": lambda ev, n, a: a[0].fold(a[1], _cb(ev, a[2])),
    "ArrayMapReduce": lambda ev, n, a: a[0].map_reduce(_cb(ev, a[1]), _cb(ev, a[2]))
    if isinstance(a[0], KernelExpr) else a[0].map_reduce(_cb(ev, a[1]), _cb(ev, a[2]), out=_out(n)),
    "ArraySize": lambda ev, n, a: a[0].size() if isinstance(a[0], KernelExpr) else len(a[0]),
    "ArrayHas": lambda ev, n, a: a[0].has(a[1]),
    "ArrayGet": lambda ev, n, a: a[0].get(a[1]),
    "ArrayGetOrDefault": lambda ev, n, a: a[0].get_or_default(a[1], ev.call(a[2], [a[1]]) if isinstance(a[2], Closure) else a[2])
    if not isinstance(a[0], KernelExpr) else a[0].get_or_default(a[1], _default_of(ev, a[2])),
    "ArrayTryGet": lambda ev, n, a: a[0].try_get(a[1]),
    "ArrayConcat": lambda ev, n, a: a[0].concat(a[1]),
    "ArraySlice": lambda ev, n, a: a[0].slice(a[1], a[2]),
    "ArrayReverse": lambda ev, n, a: a[0].reversed(),
    "ArrayCopy": lambda ev, n, a: a[0].copy(),
    "ArraySortDefault": lambda ev, n, a: a[0].sorted(),
    "ArraySort": lambda ev, n, a: a[0].sorted(key=_cb(ev, a[1])),
    "ArrayIsSorted": lambda ev, n, a: a[0].is_sorted(key=_cb(ev, a[1])),
    "ArrayToSet": lambda ev, n, a: a[0].to_set(_cb(ev, a[1])),
    "ArrayToDict": lambda ev, n, a: a[0].to_dict(
        _cb(ev, a[1]), value=_cb(ev, a[2]), combine=_cb(ev, a[3])),
    "ArrayGroupFold": lambda ev, n, a: a[0].group_reduce(
        _cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3]))
    if not isinstance(a[0], KernelExpr) else _unsup("traced group_reduce"),
    "ArrayFlattenToArray": lambda ev, n, a: a[0].flatten_to_array(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].flatten_to_array(_cb(ev, a[1])),
    "ArrayFlattenToSet": lambda ev, n, a: a[0].flatten_to_set(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].flatten_to_set(_cb(ev, a[1])),
    "ArrayFlattenToDict": lambda ev, n, a: a[0].flatten_to_dict(_cb(ev, a[1]), _cb(ev, a[2])),
    "ArrayStringJoin": lambda ev, n, a: a[0].string_join(a[1]),
    "ArrayPushLast": lambda ev, n, a: (a[0].append(a[1]), east_null)[1],
    "ArrayPushFirst": lambda ev, n, a: (a[0].insert(0, a[1]), east_null)[1],
    "ArrayPopLast": lambda ev, n, a: a[0].pop(),
    "ArrayPopFirst": lambda ev, n, a: a[0].pop(0),
    "ArrayAppend": lambda ev, n, a: (a[0].extend(a[1]), east_null)[1],
    "ArrayReverseInPlace": lambda ev, n, a: (a[0].reverse(), east_null)[1],
    "ArraySortInPlace": lambda ev, n, a: (a[0].sort(), east_null)[1]
    if len(a) == 1 else (a[0].sort(key=_cb(ev, a[1])), east_null)[1],
    "ArrayGenerate": lambda ev, n, a: EastArray.generate(a[0], _cb(ev, a[1]), element_type=ev.canon(n.value["type_parameters"][0])),
    "ArrayRange": lambda ev, n, a: EastArray.range(a[0], a[1], a[2]),
    "ArrayLinspace": lambda ev, n, a: EastArray.linspace(a[0], a[1], a[2]),
    "ArrayForEach": lambda ev, n, a: a[0].for_each(_cb(ev, a[1])),
    "ArrayFindFirst": lambda ev, n, a: a[0].find_first(a[1], key=_cb(ev, a[2])),
    "ArrayFindSortedFirst": lambda ev, n, a: a[0].find_sorted_first(a[1], key=_cb(ev, a[2])),
    "ArrayFindSortedLast": lambda ev, n, a: a[0].find_sorted_last(a[1], key=_cb(ev, a[2])),
    "ArrayFindSortedRange": lambda ev, n, a: a[0].find_sorted_range(a[1], key=_cb(ev, a[2])),
    # Set
    "SetSize": lambda ev, n, a: a[0].size() if isinstance(a[0], KernelExpr) else len(a[0]),
    "SetHas": lambda ev, n, a: a[0].has(a[1]),
    "SetInsert": lambda ev, n, a: a[0].insert(a[1]),
    "SetDelete": lambda ev, n, a: a[0].delete(a[1]),
    "SetTryInsert": lambda ev, n, a: a[0].try_insert(a[1]),
    "SetTryDelete": lambda ev, n, a: a[0].try_delete(a[1]),
    "SetUnion": lambda ev, n, a: a[0].union(a[1]),
    "SetIntersect": lambda ev, n, a: a[0].intersect(a[1]),
    "SetDiff": lambda ev, n, a: a[0].diff(a[1]),
    "SetSymDiff": lambda ev, n, a: a[0].sym_diff(a[1]),
    "SetIsSubset": lambda ev, n, a: a[0].is_subset(a[1]),
    "SetIsDisjoint": lambda ev, n, a: a[0].is_disjoint(a[1]),
    "SetCopy": lambda ev, n, a: a[0].copy(),
    "SetUnionInPlace": lambda ev, n, a: a[0].union_in_place(a[1]),
    "SetToArray": lambda ev, n, a: a[0].to_array(_cb(ev, a[1])),
    "SetToSet": lambda ev, n, a: a[0].to_set(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], KernelExpr) else _unsup("traced SetToSet spelling"),
    "SetToDict": lambda ev, n, a: a[0].to_dict(_cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3])),
    "SetMap": lambda ev, n, a: a[0].map(_cb(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], KernelExpr) else a[0].map(_cb(ev, a[1])),
    "SetFilter": lambda ev, n, a: a[0].filter(_cb(ev, a[1])),
    "SetFilterMap": lambda ev, n, a: a[0].filter_map(_cb(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], KernelExpr) else a[0].filter_map(_cb(ev, a[1])),
    "SetFirstMap": lambda ev, n, a: a[0].first_map(_cb(ev, a[1]), out=_opt_inner(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].first_map(_cb(ev, a[1])),
    "SetMapReduce": lambda ev, n, a: a[0].map_reduce(_cb(ev, a[1]), _cb(ev, a[2])),
    "SetReduce": lambda ev, n, a: a[0].reduce(a[2], _cb(ev, a[1])),
    "SetGroupFold": lambda ev, n, a: a[0].group_fold(_cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3])),
    "SetFlattenToArray": lambda ev, n, a: a[0].flatten_to_array(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].flatten_to_array(_cb(ev, a[1])),
    "SetFlattenToSet": lambda ev, n, a: a[0].flatten_to_set(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].flatten_to_set(_cb(ev, a[1])),
    "SetFlattenToDict": lambda ev, n, a: a[0].flatten_to_dict(_cb(ev, a[1]), _cb(ev, a[2])),
    "SetGenerate": lambda ev, n, a: EastSet.generate(a[0], _cb(ev, a[1]), element_type=ev.canon(n.value["type_parameters"][0])),
    "SetForEach": lambda ev, n, a: a[0].for_each(_cb(ev, a[1])),
    # Dict — note the builtin invokes callbacks (value, key); the python
    # methods take user (key, value) argument order
    "DictSize": lambda ev, n, a: a[0].size() if isinstance(a[0], KernelExpr) else len(a[0]),
    "DictHas": lambda ev, n, a: a[0].has(a[1]),
    "DictGet": lambda ev, n, a: a[0].get(a[1]) if isinstance(a[0], KernelExpr) else a[0][a[1]],
    "DictGetOrDefault": lambda ev, n, a: a[0].get_or_default(a[1], ev.call(a[2], [a[1]]) if isinstance(a[2], Closure) else a[2])
    if not isinstance(a[0], KernelExpr) else a[0].get_or_default(a[1], _default_of(ev, a[2])),
    "DictTryGet": lambda ev, n, a: a[0].try_get(a[1]),
    "DictInsert": lambda ev, n, a: a[0].insert(a[1], a[2]),
    # DictGetOrInsert's third arg is a nullary default producer in TS
    "DictGetOrInsert": lambda ev, n, a: a[0].get_or_insert(
        a[1], _arity_trim(ev, a[2])),
    "DictInsertOrUpdate": lambda ev, n, a: a[0].insert_or_update(
        a[1], a[2], _cb(ev, a[3])),
    # east-c DictUpdate SETS the value at an existing key (TS `.update(k, v)`);
    # the user spelling with must-exist semantics is `swap` (old value dropped)
    "DictUpdate": lambda ev, n, a: (a[0].swap(a[1], a[2]), east_null)[1],
    "DictSwap": lambda ev, n, a: a[0].swap(a[1], a[2]),
    "DictPop": lambda ev, n, a: a[0].pop(a[1]),
    "DictDelete": lambda ev, n, a: a[0].delete(a[1]),
    "DictTryDelete": lambda ev, n, a: a[0].try_delete(a[1]),
    "DictCopy": lambda ev, n, a: a[0].copy(),
    "DictKeys": lambda ev, n, a: a[0].keys_set(),
    "DictGetKeys": lambda ev, n, a: a[0].get_keys(a[1], _kv_user(ev, a[2], 1)),
    "DictMap": lambda ev, n, a: a[0].map(_cb(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], KernelExpr) else a[0].map(_cb(ev, a[1])),
    "DictFilter": lambda ev, n, a: a[0].filter(_dict_kv(ev, a[1])),
    "DictFilterMap": lambda ev, n, a: a[0].filter_map(_dict_kv(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], KernelExpr) else a[0].filter_map(_dict_kv(ev, a[1])),
    "DictFirstMap": lambda ev, n, a: a[0].first_map(_dict_kv(ev, a[1]), out=_opt_inner(_out(n)))
    if not isinstance(a[0], KernelExpr) else a[0].first_map(_dict_kv(ev, a[1])),
    "DictMapReduce": lambda ev, n, a: a[0].map_reduce(_dict_kv(ev, a[1]), _cb(ev, a[2])),
    "DictReduce": lambda ev, n, a: a[0].reduce(a[2], _acc_kv(ev, a[1])),
    "DictToArray": lambda ev, n, a: a[0].to_array(_dict_kv(ev, a[1])),
    "DictToSet": lambda ev, n, a: a[0].to_set(_dict_kv(ev, a[1])),
    "DictToDict": lambda ev, n, a: a[0].to_dict(_dict_kv(ev, a[1]), _dict_kv(ev, a[2]), _cb(ev, a[3])),
    "DictGroupFold": lambda ev, n, a: a[0].group_fold(
        _dict_kv(ev, a[1]), _cb(ev, a[2]), _acc_kv3(ev, a[3])),
    "DictFlattenToArray": lambda ev, n, a: a[0].flatten_to_array(_dict_kv(ev, a[1])),
    "DictFlattenToSet": lambda ev, n, a: a[0].flatten_to_set(_dict_kv(ev, a[1])),
    "DictFlattenToDict": lambda ev, n, a: a[0].flatten_to_dict(_dict_kv(ev, a[1]), _cb(ev, a[2])),
    # in-place union with a combine: the user spelling is update_many (#255).
    # update_many's combine contract is (existing, incoming) — a corpus
    # merger that reads the KEY has no user spelling here → funnel (counted).
    "DictUnionInPlace": lambda ev, n, a: (a[0].update_many(
        list(a[1].keys()), list(a[1].values()),
        combine=_two_arg_combine(ev, a[2])), east_null)[1]
    if not (isinstance(a[2], Closure) and len(a[2].payload["parameters"]) > 2)
    else _unsup("DictUnionInPlace merger reads the key: no update_many spelling"),
    "DictMergeAll": lambda ev, n, a: a[0].merge_all(a[1], _cb(ev, a[2]), _cb(ev, a[3])),
    "DictForEach": lambda ev, n, a: a[0].for_each(_dict_kv(ev, a[1])),
    "DictGenerate": lambda ev, n, a: EastDict.generate(
        a[0], _cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3]),
        ev.canon(n.value["type_parameters"][0]), ev.canon(n.value["type_parameters"][1])),
    # Ref — the user surface is the `.value` property; RefUpdate SETS (TS
    # `.update(value)`), RefMerge folds the incoming value into the current
    "RefGet": lambda ev, n, a: a[0].value,
    "RefUpdate": lambda ev, n, a: (setattr(a[0], "value", a[1]), east_null)[1],
    "RefMerge": lambda ev, n, a: (setattr(
        a[0], "value", _arity_trim(ev, a[2])(a[0].value, a[1])), east_null)[1],
}


def _unsup(reason: str) -> Any:
    raise _Unsupported(reason)


def _default_of(ev: EagerEvaluator, a: Any) -> Any:
    """A get_or_default default: the builtin takes a (key)->default function;
    the user surface takes the VALUE. Constant-fn bodies evaluate directly."""
    if not isinstance(a, Closure):
        return a
    p = a.payload
    env = Env(a.env)
    for var in p["parameters"]:
        env.define(var.value["name"], _Poison())
    return ev.eval(p["body"], env)


class _Poison:
    """Trips if a supposedly-constant default function reads its parameter."""

    def __getattr__(self, name: str) -> Any:
        raise _Unsupported("non-constant default function")


class _MissingArg:
    """A callback parameter the python surface does not provide (narrowed
    signature). Any use trips loudly."""

    def __init__(self, name: str):
        self._name = name

    def __getattr__(self, name: str) -> Any:
        raise _Unsupported(f"callback parameter {self._name!r} narrowed away by the python surface")


def _kv_user(ev: EagerEvaluator, a: Any, keep: int) -> Any:
    """Adapt a single-value user callback: keep only the first ``keep`` args."""
    if not isinstance(a, Closure):
        return a
    cb = ev.make_callback(a)
    return lambda *args: cb(*args[:keep])


def _arity_trim(ev: EagerEvaluator, a: Any) -> Any:
    """Call the closure with only as many arguments as it declares."""
    if not isinstance(a, Closure):
        return lambda *_args: a
    n = len(a.payload["parameters"])
    cb = ev.make_callback(a)
    return lambda *args: cb(*args[:n])


def _dict_kv(ev: EagerEvaluator, a: Any) -> Any:
    """Builtin callbacks over dict entries are (value, key); the python
    methods call user functions as (key, value). The reordering wrapper
    cannot ride natively itself — the compiled callable's ``_east_retrace``
    lets the method's own tracing push it down; when that cannot fire the
    call is per-element by construction, so it is not a path violation."""
    if not isinstance(a, Closure):
        return a
    cb = ev.make_callback(a)
    a.native = False
    return lambda k, v: cb(v, k)


def _acc_kv(ev: EagerEvaluator, a: Any) -> Any:
    """DictReduce: builtin (acc, value, key) → user fn(acc, key, value)."""
    if not isinstance(a, Closure):
        return a
    cb = ev.make_callback(a)
    a.native = False
    return lambda acc, k, v: cb(acc, v, k)


def _acc_kv3(ev: EagerEvaluator, a: Any) -> Any:
    """DictGroupFold fold: builtin (acc, value, key) → user fn(acc, key, value)."""
    return _acc_kv(ev, a)


def _two_arg_combine(ev: EagerEvaluator, a: Any) -> Any:
    """(v1, v2, key) builtin combine → the user surface's (v1, v2) combine."""
    if not isinstance(a, Closure):
        return a
    cb = ev.make_callback(a)
    return lambda v1, v2: cb(v1, v2, None) if _combine_arity(a) == 3 else cb(v1, v2)


def _combine_arity(a: Closure) -> int:
    return len(a.payload["parameters"])


# ─── scalar rows derived from the East namespaces ────────────────────────────
# Each namespace method is a thin 1:1 mirror of one builtin; the builtin name
# is a string constant in its code object, so the user surface itself supplies
# the mapping — no hand-written scalar table to drift.

_NAMESPACES = (East, East.Boolean, East.Integer, East.Float, East.String, East.DateTime)


def _scalar_row(fn: Any) -> Any:
    """A row calling a namespace method: generic methods take the builtin's
    type parameter(s) as their leading python argument(s); the arity decides."""
    import inspect

    n_params = len(inspect.signature(fn).parameters)

    def row(ev: EagerEvaluator, n: EastVariant, a: list) -> Any:
        tps = [ev.canon(t) for t in n.value["type_parameters"]]
        if n_params == len(tps) + len(a):
            return fn(*tps, *a)
        if tps and n_params == 1 + len(a):
            # some namespace methods take one leading type and derive the
            # rest (e.g. invert_patch(typ, patch) vs tps [T, Patch<T>])
            return fn(tps[0], *a)
        return fn(*a)

    return row


def _known_builtin_hints() -> set[str]:
    """Builtin-name string constants appearing in the namespace methods —
    the user surface itself supplies the mapping candidates; the exactly-one
    filter below removes docstring-style collisions."""
    import inspect
    import re

    pat = re.compile(r"^[A-Z][A-Za-z0-9]+$")
    hints: set[str] = set()
    for space in _NAMESPACES:
        for _m, fn in inspect.getmembers(space, callable):
            for c in getattr(getattr(fn, "__code__", None), "co_consts", ()):
                if isinstance(c, str) and pat.match(c):
                    hints.add(c)
    return hints


def _namespace_rows() -> dict[str, Any]:
    import inspect

    hints = _known_builtin_hints()
    rows: dict[str, Any] = {}
    for space in _NAMESPACES:
        for mname, fn in inspect.getmembers(space, callable):
            if mname.startswith("_"):  # private helpers are not the surface
                continue
            consts = getattr(getattr(fn, "__code__", None), "co_consts", ())
            names = [c for c in consts if isinstance(c, str) and c in hints]
            if len(names) == 1 and names[0] not in rows:
                rows[names[0]] = _scalar_row(fn)
    return rows


for _name, _row in _namespace_rows().items():
    _ROWS.setdefault(_name, _row)
