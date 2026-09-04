#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Replay TS-exported compliance IR through the eager/expression surface (#474).

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

Callback (``Function``-typed) builtin arguments are materialised as native
function values — the ONE mode the strict surface leaves (#625): immutable
captures bake as ``Let``s of quoted values and the callback IR compiles via
``compile_from_value``; by-reference (mutable/container) captures ride the
bridge's live-captures carrier instead (``_east_ir`` + ``_east_captures``,
#476 E), so mutation semantics survive without a python path — and under the
strict surface there is none: a callback captures or raises, so the replay
cannot silently degrade to per-element python (#625).
"""

from __future__ import annotations

import contextlib
import json as _pyjson
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from east.expression import Expression
from east.ir.builders import (
    ir_block,
    ir_let,
    ir_new_array,
    ir_new_dict,
    ir_new_set,
    ir_struct,
    ir_value,
    ir_variant,
)
from east.namespace import East
from east.runtime.compiler import compile_from_value
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

# The current file's compiled program — loaded exactly as the compiled
# runners load it (compile_from_json: wrapper decode, source-map install,
# platform-signature validation) and held so the replay can install the
# file's source map while it interprets the same IR (see
# _program_source_map). One entry: each load replaces the previous file's
# program.
_PROGRAM_KEEPALIVE: dict[str, Any] = {}


def _load_program(data: bytes) -> Any:
    """``compile_from_json`` with inert test-harness platform impls — the
    program is loaded, never called (the replay interprets its IR). The
    replay runs under the program's source map (``_program_source_map``), so
    closures it creates reference that map (compiler.c stamps the current
    map): their errors resolve original source locations and their beast2
    encodings embed the same stack deltas as any compiled runner's closures."""
    from east.runtime.compiler import compile_from_json
    from east.runtime.platform import PlatformFunction
    from east.types.types import AsyncFunctionType, NullType, StringType
    from tests.test_compliance import _freeze_platform

    def noop(*_args: Any) -> None:
        return None

    # Declared types mirror the TS declarations (libs/east/test/platforms.spec.ts),
    # same as test_compliance's harness — the compile-time signature check
    # rejects a drifted mirror.
    platform = [
        PlatformFunction(name="describe", inputs=[StringType, AsyncFunctionType([], NullType)], output=NullType, type="sync", fn=noop),
        PlatformFunction(name="test", inputs=[StringType, AsyncFunctionType([], NullType)], output=NullType, type="sync", fn=noop),
        PlatformFunction(name="testPass", inputs=[], output=NullType, type="sync", fn=noop),
        PlatformFunction(name="testFail", inputs=[StringType], output=NullType, type="sync", fn=noop),
        *_freeze_platform(),
    ]
    is_async = b'"AsyncFunction"' in data[:100]
    return compile_from_json(data, platform, is_async=is_async)


def load_ir(path: str | Path) -> EastVariant:
    """The exported file's ``ir`` member, decoded through the standard
    serialization layer into the homoiconic IR value."""
    data = Path(path).read_bytes()
    _PROGRAM_KEEPALIVE.clear()  # release the previous file's map first
    with contextlib.suppress(BaseException):
        _PROGRAM_KEEPALIVE[str(path)] = _load_program(data)
    # Explicit utf-8: the corpus is utf-8 JSON with non-ASCII string
    # literals, and windows' locale default (cp1252) mojibakes them — the
    # replay then encodes the mangled literals and every Blob/String
    # byte-comparison diverges.
    raw = _pyjson.loads(data.decode("utf-8"))
    return _decode_ir(_pyjson.dumps(raw["ir"]))


def _program_source_map() -> Any:
    """The loaded program's source map, installed as the thread-current map
    for the replay — the TS ``with_source_map(program.source_map, …)``. A
    compile installs and RESTORES the map it compiles under (#626), so the
    file's map must be installed explicitly for the closures the replay
    builds against the file's loc_ids."""
    program = next(iter(_PROGRAM_KEEPALIVE.values()), None)
    if program is None:
        return contextlib.nullcontext()
    from east.runtime._compiler_eastc import source_map_of

    return source_map_of(program)


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

    A Closure can land in a Function-typed VALUE slot (struct fields, arrays
    of functions); ``py_value_to_c`` serializes functions from their attached
    homoiconic IR, so ``_east_ir`` exposes the capture-baked Function node and
    the bridge compiles it — the same path any east-py function value takes.
    """
    node: EastVariant
    env: Env

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
        # Captures present: expose the UNBAKED node and let _east_captures
        # supply the live values — the bridge populates the closure's captures
        # env through its identity_map, so a captured value and its aliases in
        # the same conversion stay ONE value (#476 E). Capture-free: the baked
        # node suits the compile fallback.
        if list(self.payload["captures"]):
            return self.node
        return _baked_node(self)

    @property
    def _east_captures(self) -> dict:
        return {
            var.value["name"]: self.env.get(var.value["name"])
            for var in self.payload["captures"]
        }


# Closure → owning evaluator (module-level so Closure can stay a light value).
_EVALUATOR_OF: dict[int, EagerEvaluator] = {}


def _baked_node(clo: Closure) -> Any:
    """The closure's Function IR with captures baked as quoted Lets.

    A captured function is not quotable as a literal — it bakes as ITS OWN
    baked node (recursively), so closure chains (A captures B captures C)
    reduce to one self-contained IR tree.
    """
    p = clo.payload
    captures = list(p["captures"])
    if not captures:
        # The node IS the capture-free form — pass it through untouched.
        # Rebuilding via ir_function() dropped its loc_id, so the compiled
        # closure's encoded IR diverged from the program's own closure by
        # exactly that varint.
        return clo.node

    def let_value(var: Any) -> Any:
        captured = clo.env.get(var.value["name"])
        if isinstance(captured, Closure):
            return _baked_node(captured)
        attached = getattr(captured, "_east_ir", None)
        if attached is not None:
            return attached
        return quote_value(captured, var.value["type"])

    lets = [ir_let(var.value["type"], var, let_value(var)) for var in captures]
    return ir_block(p["type"], [*lets, clo.node])


# ─── per-run accounting ──────────────────────────────────────────────────────

@dataclass
class Report:
    routes: Counter = field(default_factory=Counter)          # (builtin, route)
    unsupported: Counter = field(default_factory=Counter)     # skip reasons
    tests_passed: int = 0
    tests_failed: list = field(default_factory=list)          # (name, error)

    def merge(self, other: Report) -> None:
        self.routes.update(other.routes)
        self.unsupported.update(other.unsupported)
        self.tests_passed += other.tests_passed
        self.tests_failed.extend(other.tests_failed)


# ─── the evaluator ───────────────────────────────────────────────────────────

class EagerEvaluator:
    """Executes decoded IR with Builtin nodes routed through the user surface."""

    def __init__(self, report: Report | None = None):
        self.report = report if report is not None else Report()
        self.test_depth = 0
        self._canon_memo: dict[int, Any] = {}
        # Pending capture write-backs: (native callable, defining Env,
        # [(name, type), …]) per carrier whose captures include MUTABLE
        # variables — flushed after the builtin call that used it (see
        # make_callback / _flush_writebacks).
        self._writebacks: list = []

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
        """A Expression for a constructor child: proxies pass through, plain
        values lift as typed constants."""
        if isinstance(value, Expression):
            return value
        from east.expression import _lift

        return _lift(value, hint=hint)

    @staticmethod
    def _in_trace() -> bool:
        """Whether an expression build is active. A MUTABLE-container construction
        inside a trace must emit constructor IR even with no traced children:
        an eager value would lift as a hoisted CONSTANT shared across calls —
        an init callback returning `[]` would hand every group one aliased
        accumulator."""
        from east.expression import _tracing

        return _tracing()

    # ── program entry ──

    def run_program(self, ir: EastVariant) -> Report:
        """Run an exported spec program (an argless (Async)Function head)."""
        assert ir.type in ("Function", "AsyncFunction"), ir.type
        with _program_source_map():
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
            if isinstance(subject, Expression):
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
            if any(isinstance(v, Expression) for _n, v in fields) or self._in_trace():
                # construction from traced parts IS a traced expression —
                # an eager value holding proxies would hoist as a "constant"
                # referencing function parameters (unbound outside the fn).
                # Use the expression builder's LAZY constructors: the eager builders'
                # EastArray children convert nodes mid-trace (#411)
                from east.expression import _k_struct

                t = self.canon(p["type"])
                ftypes = {f["name"]: f["type"] for f in t.value}
                node2 = _k_struct(t, [(n, self._klift(v, ftypes[n]).ir) for n, v in fields])
                return Expression(node2, t)
            return EastStruct(dict(fields))
        if kind == "Variant":
            val = self.eval(p["value"], env)
            if isinstance(val, Expression) or self._in_trace():
                # in-trace: the node's DECLARED type keeps every case — an
                # eager variant would be sampled to a single-case type (#450)
                t = self.canon(p["type"])
                ctypes = {c["name"]: c["type"] for c in t.value}
                return Expression(ir_variant(t, p["case"], self._klift(val, ctypes[p["case"]]).ir), t)
            return EastVariant(p["case"], val)
        if kind == "NewArray":
            t = self.canon(p["type"])
            vals = [self.eval(v, env) for v in p["values"]]
            if any(isinstance(v, Expression) for v in vals) or self._in_trace():
                from east.expression import _k_new_array

                et = child_type(t)
                return Expression(_k_new_array(t, [self._klift(v, et).ir for v in vals]), t)
            # Direct construction: the evaluated values are already East-typed
            # (the IR is), and the constructor's batch conversion preserves
            # element aliasing — a coerce_to detour re-canonicalizes each
            # element into an independent copy, splitting aliases a compiled
            # NewArray keeps.
            return EastArray(child_type(t), vals)
        if kind == "NewSet":
            t = self.canon(p["type"])
            vals = [self.eval(v, env) for v in p["values"]]
            if any(isinstance(v, Expression) for v in vals) or self._in_trace():
                from east.expression import _k_new_set

                et = child_type(t)
                return Expression(_k_new_set(t, [self._klift(v, et).ir for v in vals]), t)
            if _mentions_function(t):
                return EastSet(child_type(t), vals)
            from east.types.coercion import coerce_to

            return coerce_to(vals, t)
        if kind == "NewDict":
            t = self.canon(p["type"])
            kt, vt = dict_child(t, "key"), dict_child(t, "value")
            entries = [(self.eval(e["key"], env), self.eval(e["value"], env)) for e in p["values"]]
            if any(isinstance(x, Expression) for kv in entries for x in kv) or self._in_trace():
                from east.expression import _k_new_dict

                return Expression(_k_new_dict(
                    t, [(self._klift(k, kt).ir, self._klift(v, vt).ir) for k, v in entries]), t)
            d = EastDict(kt, vt)
            for k, v in entries:
                d[k] = v
            return d
        if kind == "NewRef":
            return EastRef(self.eval(p["value"], env))
        if kind == "NewVector":
            # from_array pins the storage dtype from the element type — the raw
            # constructor's np.asarray([]) defaults an EMPTY literal to float64.
            from east.types.values import EastVector

            return EastVector.from_array(
                child_type(self.canon(p["type"])), [self.eval(v, env) for v in p["values"]])
        if kind == "NewMatrix":
            import numpy as np

            from east.types.values import EastMatrix
            from east.types.values._helpers import EAST_ELEMENT_TO_DTYPE

            et = child_type(self.canon(p["type"]))
            vals = [self.eval(v, env) for v in p["values"]]
            rows, cols = p["rows"], p["cols"]
            return EastMatrix(
                et, np.asarray(vals, dtype=EAST_ELEMENT_TO_DTYPE[et.type]).reshape(rows, cols),
                rows, cols)
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
            if isinstance(msg, Expression):
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
        if isinstance(value, Expression):
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

    # ── platform: the self-assertion harness + the corpus capabilities ──

    _HARNESS_IMPLS: dict[str, Any] | None = None

    @classmethod
    def _platform_impls(cls) -> dict[str, Any]:
        """The corpus's non-assertion platform capabilities (the ``freeze*``
        family, #539), shared with ``test_compliance`` so the replay runs the
        SAME implementations the compiled runners do."""
        if cls._HARNESS_IMPLS is None:
            from tests.test_compliance import _freeze_platform

            cls._HARNESS_IMPLS = {pf["name"]: pf for pf in _freeze_platform()}
        return cls._HARNESS_IMPLS

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
        impl = self._platform_impls().get(name)
        if impl is None:
            raise _Unsupported(f"platform function {name!r}")
        result = impl["fn"](*args)
        if getattr(result, "_east_c_value", None) is not None:
            t = self.canon(p["type"])
            if t.type in ("Vector", "Matrix"):
                # Tensors decode by COPY (numpy-backed), which would drop the
                # value identity the frozen brand carries under Is — keep the
                # HOLD; the funnel passes its branded C value by pointer.
                return result
            # A frozen hold (freeze_value) decodes into branded zero-copy
            # proxies, so the replay's eager surface sees exactly what a
            # frozen task input looks like — mutation refuses, Is compares
            # by value (#539).
            from east.runtime._compiler_eastc import frozen_hold_to_py

            return frozen_hold_to_py(result, t)
        return result

    # ── callbacks per mode ──

    def make_callback(self, clo: Closure) -> Any:
        """A python callable for a Function-typed builtin argument.

        Immutable captures bake as ``Let``s of quoted values and the callback
        IR compiles into a native function. By-reference (mutable/container)
        captures must NOT bake — East captures by reference, and a baked copy
        would hide mutations (an accumulating forEach would silently count on
        the copy) — so the callable carries the UNBAKED node and its live
        capture values instead, and the funnel's carrier route builds the
        closure with an identity-mapped captures env (#476 E)."""
        p = clo.payload
        if any(isinstance(clo.env.get(v.value["name"]), Expression)
               for v in p["captures"]):
            # materialized INSIDE a trace replay: a capture is the outer
            # trace's proxy, so a standalone compile would leave it free —
            # hand back the replay and let the enclosing trace absorb the
            # body into its own IR (how nested lambdas compose)
            self.report.routes[("<nested-trace>", "traced")] += 1
            return self._replay_fn(clo)
        if not self._bake_safe(p["captures"]):
            self.report.routes[("<captures-by-ref>", "carrier")] += 1
            from east._eastc_bridge import resolve_child_type
            from east.runtime._compiler_eastc import compile_function_carrier

            def carrier(*args):
                return self.call(clo, list(args))

            # The bridge's live-captures compile (#476 E): the UNBAKED node
            # plus these values, identity-mapped into the closure's captures
            # env — mutations stay visible and the body executes natively.
            carrier._east_ir = clo.node
            carrier._east_captures = clo._east_captures
            native = compile_function_carrier(
                carrier,
                [self.canon(v.value["type"]) for v in p["parameters"]],
                resolve_child_type(p["type"], ("output",)),
            )
            # A MUTABLE capture the body REBINDS (`$.assign(total, …)`)
            # accumulates in the closure's captures env — east-c's Assign
            # writes the defining env, which for the carrier is the closure's
            # own, not this interpreter's. Register a write-back: after the
            # builtin call that drove the callback, the rebound slots fold
            # back into the replay environment (in-place container mutation
            # needs none — the identity map shares the C value).
            mutable_caps = [(v.value["name"], self.canon(v.value["type"]))
                            for v in p["captures"] if v.value["mutable"]]
            if mutable_caps:
                self._writebacks.append((native, clo.env, mutable_caps))
            return native
        return self._compile_closure(clo)

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
        quoted values — the same ``Block[Let…, Function]`` shape the expression
        builder emits for hoisted constants.

        The compiled callable is used AS-IS: called with expression proxies
        (an argument-reordering wrapper under the strict wrap) it lowers to a
        native IR ``Call`` (#561), so the body is never re-derived."""
        return compile_from_value(_baked_node(clo))

    def _replay_fn(self, clo: Closure) -> Any:
        p = clo.payload

        def replay(_b: Any, *proxies: Any) -> Any:
            env = Env(clo.env)
            for var, proxy in zip(p["parameters"], proxies, strict=False):
                env.define(var.value["name"], proxy)
            return self.eval(p["body"], env)

        return replay

    # ── builtin dispatch ──

    def _builtin(self, node: EastVariant, env: Env) -> Any:
        p = node.value
        name = p["builtin"]
        out_t = self.canon(p["type"])
        tps = [self.canon(t) for t in p["type_parameters"]]
        raw_args = list(p["arguments"])
        args = [self.eval(a, env) for a in raw_args]

        row = _ROWS.get(name)
        traced_ctx = any(isinstance(a, Expression) for a in args)
        wb_mark = len(self._writebacks)

        if row is not None and not traced_ctx:
            try:
                result = row(self, node, args)
            except _Unsupported as e:
                self.report.unsupported[str(e)[:80]] += 1
                self._flush_writebacks(wb_mark)
                row = None  # fall through to the funnel, counted
            else:
                self._flush_writebacks(wb_mark)
                self.report.routes[(name, "surface")] += 1
                return result
        if row is not None and traced_ctx:
            # inside a traced callback replay: the row itself runs against
            # proxies (Expression methods / namespace funnel) and emits IR
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

                cb = self.make_callback(a)
                if getattr(cb, "_east_ir", None) is None:
                    # A Function-typed VALUE slot serializes the callback from
                    # its IR; the interpreter-backed callbacks (by-reference
                    # captures) carry none, so attach the Closure's node and
                    # live capture values here — at the builtin call, exactly
                    # when the conversion reads them (aliasing preserved via
                    # the bridge's identity_map).
                    with contextlib.suppress(AttributeError, TypeError, _Unsupported):
                        cb._east_ir = a._east_ir
                        cb._east_captures = a._east_captures
                conv.append(EastFunction(
                    cb,
                    [self.canon(v.value["type"]) for v in pp["parameters"]],
                    resolve_child_type(pp["type"], ("output",)),
                ))
            else:
                conv.append(a)
        self.report.routes[(name, "funnel")] += 1
        try:
            return _call_builtin(name, tps, conv, out_t)
        finally:
            self._flush_writebacks(wb_mark)

    def _flush_writebacks(self, mark: int) -> None:
        """Fold rebound closure captures back into the replay environment.

        Runs after the builtin call that drove the carrier (errors included —
        mutations up to a mid-loop error are real, exactly as they are for a
        native caller). Reading an unrebound capture is an identity refresh.
        """
        from east.runtime._compiler_eastc import read_closure_capture

        while len(self._writebacks) > mark:
            native, env, caps = self._writebacks.pop()
            for cap_name, cap_t in caps:
                env.assign(cap_name, read_closure_capture(native, cap_name, cap_t))


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
    # RegexReplace is the one string builtin whose user spelling reorders the
    # trailing arguments: the builtin (and IR) carry (text, pattern, flags,
    # replacement) while East.String.regex_replace takes (s, pattern,
    # replacement, flags) — the generic namespace funnel would swap them.
    "RegexReplace": lambda ev, n, a: East.String.regex_replace(a[0], a[1], a[3], a[2]),
    # comparisons — user spelling is the ordering-function surface
    "Equal": lambda ev, n, a: equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], Expression) and not isinstance(a[1], Expression)
    else a[0] == a[1],
    "NotEqual": lambda ev, n, a: not_equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], Expression) and not isinstance(a[1], Expression)
    else a[0] != a[1],
    "Less": lambda ev, n, a: less_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], Expression) and not isinstance(a[1], Expression)
    else a[0] < a[1],
    "LessEqual": lambda ev, n, a: less_equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], Expression) and not isinstance(a[1], Expression)
    else a[0] <= a[1],
    "Greater": lambda ev, n, a: greater_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], Expression) and not isinstance(a[1], Expression)
    else a[0] > a[1],
    "GreaterEqual": lambda ev, n, a: greater_equal_for(ev.canon(n.value["type_parameters"][0]))(a[0], a[1])
    if not isinstance(a[0], Expression) and not isinstance(a[1], Expression)
    else a[0] >= a[1],
    # Array
    "ArrayMap": lambda ev, n, a: a[0].map(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].map(_cb(ev, a[1])),
    "ArrayFilter": lambda ev, n, a: a[0].filter(_cb(ev, a[1])),
    "ArrayFilterMap": lambda ev, n, a: a[0].filter_map(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].filter_map(_cb(ev, a[1])),
    "ArrayFirstMap": lambda ev, n, a: a[0].first_map(_cb(ev, a[1]), out=_opt_inner(_out(n)))
    if not isinstance(a[0], Expression) else a[0].first_map(_cb(ev, a[1])),
    "ArrayFold": lambda ev, n, a: a[0].reduce(_cb(ev, a[2]), a[1]),
    # scan IS the running fold, so it takes reduce's argument order (#524).
    "ArrayScan": lambda ev, n, a: a[0].scan(_cb(ev, a[2]), a[1]),
    "ArrayMapReduce": lambda ev, n, a: a[0].map_reduce(_cb(ev, a[1]), _cb(ev, a[2]))
    if isinstance(a[0], Expression) else a[0].map_reduce(_cb(ev, a[1]), _cb(ev, a[2]), out=_out(n)),
    "ArraySize": lambda ev, n, a: a[0].size() if isinstance(a[0], Expression) else len(a[0]),
    "ArrayHas": lambda ev, n, a: a[0].has(a[1]),
    "ArrayGet": lambda ev, n, a: a[0].get(a[1]),
    # TS `get(index, onMissing)`: the eager default body takes the block
    # first, the compiled callback none — `_kv_user` bridges the two.
    "ArrayGetOrDefault": lambda ev, n, a: a[0].get(a[1], _kv_user(ev, a[2], 1))
    if not isinstance(a[0], Expression) else a[0].get(a[1], _cb(ev, a[2])),
    "ArrayTryGet": lambda ev, n, a: a[0].try_get(a[1]),
    "ArrayConcat": lambda ev, n, a: a[0].concat(a[1]),
    "ArraySlice": lambda ev, n, a: a[0].slice(a[1], a[2]),
    "ArrayReverse": lambda ev, n, a: a[0].reverse(),
    "ArrayCopy": lambda ev, n, a: a[0].copy(),
    # the keyless east-c sort computes exactly what the identity-keyed
    # TS `sort()` computes
    "ArraySortDefault": lambda ev, n, a: a[0].sort(),
    "ArraySort": lambda ev, n, a: a[0].sort(_cb(ev, a[1])),
    "ArrayIsSorted": lambda ev, n, a: a[0].is_sorted(_cb(ev, a[1])),
    "ArrayToSet": lambda ev, n, a: a[0].to_set(_cb(ev, a[1])),
    "ArrayToDict": lambda ev, n, a: a[0].to_dict(
        _cb(ev, a[1]), value=_cb(ev, a[2]), combine=_cb(ev, a[3])),
    "ArrayGroupFold": lambda ev, n, a: a[0].group_reduce(
        _cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3]))
    if not isinstance(a[0], Expression) else _unsup("traced group_reduce"),
    "ArrayFlattenToArray": lambda ev, n, a: a[0].flat_map(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].flat_map(_cb(ev, a[1])),
    "ArrayFlattenToSet": lambda ev, n, a: a[0].flatten_to_set(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].flatten_to_set(_cb(ev, a[1])),
    "ArrayFlattenToDict": lambda ev, n, a: a[0].flatten_to_dict(_cb(ev, a[1]), _cb(ev, a[2])),
    "ArrayStringJoin": lambda ev, n, a: a[0].string_join(a[1]),
    "ArrayEncodeCsv": lambda ev, n, a: a[0].encode_csv(a[1]),
    "ArrayUpdate": lambda ev, n, a: (a[0].update(a[1], a[2]), east_null)[1],
    "ArrayMerge": lambda ev, n, a: (a[0].merge(a[1], a[2], _cb(ev, a[3])), east_null)[1],
    "ArrayMergeAll": lambda ev, n, a: (a[0].merge_all(a[1], _cb(ev, a[2])), east_null)[1],
    "ArrayClear": lambda ev, n, a: (a[0].clear(), east_null)[1],
    "ArrayPushLast": lambda ev, n, a: (a[0].push_last(a[1]), east_null)[1],
    "ArrayPushFirst": lambda ev, n, a: (a[0].push_first(a[1]), east_null)[1],
    "ArrayPopLast": lambda ev, n, a: a[0].pop_last(),
    "ArrayPopFirst": lambda ev, n, a: a[0].pop_first(),
    "ArrayAppend": lambda ev, n, a: (a[0].append(a[1]), east_null)[1],
    "ArrayPrepend": lambda ev, n, a: (a[0].prepend(a[1]), east_null)[1],
    "ArrayReverseInPlace": lambda ev, n, a: (a[0].reverse_in_place(), east_null)[1],
    "ArraySortInPlace": lambda ev, n, a: (a[0].sort_in_place(_cb(ev, a[1])), east_null)[1],
    "ArrayGenerate": lambda ev, n, a: East.Array.generate(a[0], ev.canon(n.value["type_parameters"][0]), _cb(ev, a[1])),
    "ArrayRange": lambda ev, n, a: EastArray.range(a[0], a[1], a[2]),
    "ArrayLinspace": lambda ev, n, a: EastArray.linspace(a[0], a[1], a[2]),
    "ArrayForEach": lambda ev, n, a: a[0].for_each(_cb(ev, a[1])),
    "ArrayFindFirst": lambda ev, n, a: a[0].find_first(a[1], key=_cb(ev, a[2])),
    "ArrayFindSortedFirst": lambda ev, n, a: a[0].find_sorted_first(a[1], key=_cb(ev, a[2])),
    "ArrayFindSortedLast": lambda ev, n, a: a[0].find_sorted_last(a[1], key=_cb(ev, a[2])),
    "ArrayFindSortedRange": lambda ev, n, a: a[0].find_sorted_range(a[1], key=_cb(ev, a[2])),
    # Set
    "SetSize": lambda ev, n, a: a[0].size() if isinstance(a[0], Expression) else len(a[0]),
    "SetHas": lambda ev, n, a: a[0].has(a[1]),
    "SetInsert": lambda ev, n, a: a[0].insert(a[1]),
    "SetDelete": lambda ev, n, a: a[0].delete(a[1]),
    "SetClear": lambda ev, n, a: (a[0].clear(), east_null)[1],
    "SetTryInsert": lambda ev, n, a: a[0].try_insert(a[1]),
    "SetTryDelete": lambda ev, n, a: a[0].try_delete(a[1]),
    "SetUnion": lambda ev, n, a: a[0].union(a[1]),
    "SetIntersect": lambda ev, n, a: a[0].intersection(a[1]),
    "SetDiff": lambda ev, n, a: a[0].difference(a[1]),
    "SetSymDiff": lambda ev, n, a: a[0].symmetric_difference(a[1]),
    "SetIsSubset": lambda ev, n, a: a[0].is_subset_of(a[1]),
    "SetIsDisjoint": lambda ev, n, a: a[0].is_disjoint_from(a[1]),
    "SetCopy": lambda ev, n, a: a[0].copy(),
    "SetUnionInPlace": lambda ev, n, a: a[0].union_in_place(a[1]),
    "SetToArray": lambda ev, n, a: a[0].to_array(_cb(ev, a[1])),
    "SetToSet": lambda ev, n, a: a[0].to_set(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else _unsup("traced SetToSet spelling"),
    "SetToDict": lambda ev, n, a: a[0].to_dict(_cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3])),
    "SetMap": lambda ev, n, a: a[0].map(_cb(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], Expression) else a[0].map(_cb(ev, a[1])),
    "SetFilter": lambda ev, n, a: a[0].filter(_cb(ev, a[1])),
    "SetFilterMap": lambda ev, n, a: a[0].filter_map(_cb(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], Expression) else a[0].filter_map(_cb(ev, a[1])),
    "SetFirstMap": lambda ev, n, a: a[0].first_map(_cb(ev, a[1]), out=_opt_inner(_out(n)))
    if not isinstance(a[0], Expression) else a[0].first_map(_cb(ev, a[1])),
    "SetMapReduce": lambda ev, n, a: a[0].map_reduce(_cb(ev, a[1]), _cb(ev, a[2])),
    "SetReduce": lambda ev, n, a: a[0].reduce(_cb(ev, a[1]), a[2]),
    # SetScan mirrors SetReduce's (set, fn, init) argument order (#524).
    "SetScan": lambda ev, n, a: a[0].scan(_cb(ev, a[1]), a[2]),
    "SetGroupFold": lambda ev, n, a: a[0].group_reduce(_cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3])),
    "SetFlattenToArray": lambda ev, n, a: a[0].flatten_to_array(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].flatten_to_array(_cb(ev, a[1])),
    "SetFlattenToSet": lambda ev, n, a: a[0].flatten_to_set(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].flatten_to_set(_cb(ev, a[1])),
    "SetFlattenToDict": lambda ev, n, a: a[0].flatten_to_dict(_cb(ev, a[1]), _cb(ev, a[2])),
    "SetGenerate": lambda ev, n, a: East.Set.generate(
        a[0], ev.canon(n.value["type_parameters"][0]), _cb(ev, a[1]), _cb(ev, a[2])),
    "SetForEach": lambda ev, n, a: a[0].for_each(_cb(ev, a[1])),
    # Dict — the python methods take the builtin's own (value, key) callback
    # order (the TypeScript order, canonical on both surfaces)
    "DictSize": lambda ev, n, a: a[0].size() if isinstance(a[0], Expression) else len(a[0]),
    "DictHas": lambda ev, n, a: a[0].has(a[1]),
    "DictGet": lambda ev, n, a: a[0].get(a[1]),
    "DictGetOrDefault": lambda ev, n, a: a[0].get(a[1], _kv_user(ev, a[2], 1))
    if not isinstance(a[0], Expression) else a[0].get(a[1], _cb(ev, a[2])),
    "DictTryGet": lambda ev, n, a: a[0].try_get(a[1]),
    "DictInsert": lambda ev, n, a: a[0].insert(a[1], a[2]),
    # DictGetOrInsert's third arg is a nullary default producer in TS
    "DictGetOrInsert": lambda ev, n, a: a[0].get_or_insert(
        a[1], _arity_trim(ev, a[2])),
    "DictInsertOrUpdate": lambda ev, n, a: a[0].insert_or_update(
        a[1], a[2], _cb(ev, a[3])),
    "DictUpdate": lambda ev, n, a: (a[0].update(a[1], a[2]), east_null)[1],
    "DictSwap": lambda ev, n, a: a[0].swap(a[1], a[2]),
    "DictPop": lambda ev, n, a: a[0].pop(a[1]),
    "DictClear": lambda ev, n, a: (a[0].clear(), east_null)[1],
    "DictDelete": lambda ev, n, a: a[0].delete(a[1]),
    "DictTryDelete": lambda ev, n, a: a[0].try_delete(a[1]),
    "DictCopy": lambda ev, n, a: a[0].copy(),
    "DictKeys": lambda ev, n, a: a[0].keys(),
    "DictGetKeys": lambda ev, n, a: a[0].get_keys(a[1], _kv_user(ev, a[2], 1)),
    "DictMap": lambda ev, n, a: a[0].map(_cb(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], Expression) else a[0].map(_cb(ev, a[1])),
    "DictFilter": lambda ev, n, a: a[0].filter(_cb(ev, a[1])),
    "DictFilterMap": lambda ev, n, a: a[0].filter_map(_cb(ev, a[1]), out=dict_child(_out(n), "value"))
    if not isinstance(a[0], Expression) else a[0].filter_map(_cb(ev, a[1])),
    "DictFirstMap": lambda ev, n, a: a[0].first_map(_cb(ev, a[1]), out=_opt_inner(_out(n)))
    if not isinstance(a[0], Expression) else a[0].first_map(_cb(ev, a[1])),
    "DictMapReduce": lambda ev, n, a: a[0].map_reduce(_cb(ev, a[1]), _cb(ev, a[2])),
    "DictReduce": lambda ev, n, a: a[0].reduce(_cb(ev, a[1]), a[2]),
    # DictScan mirrors DictReduce's (dict, fn, init) argument order (#524).
    "DictScan": lambda ev, n, a: a[0].scan(_cb(ev, a[1]), a[2]),
    "DictToArray": lambda ev, n, a: a[0].to_array(_cb(ev, a[1])),
    "DictToSet": lambda ev, n, a: a[0].to_set(_cb(ev, a[1])),
    "DictToDict": lambda ev, n, a: a[0].to_dict(_cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3])),
    "DictGroupFold": lambda ev, n, a: a[0].group_reduce(
        _cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3])),
    "DictFlattenToArray": lambda ev, n, a: a[0].flatten_to_array(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].flatten_to_array(_cb(ev, a[1])),
    "DictFlattenToSet": lambda ev, n, a: a[0].flatten_to_set(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].flatten_to_set(_cb(ev, a[1])),
    "DictFlattenToDict": lambda ev, n, a: a[0].flatten_to_dict(_cb(ev, a[1]), _cb(ev, a[2])),
    # in-place union with a combine: the user spelling is update_many (#255).
    # update_many's combine contract is (existing, incoming) — a corpus
    # merger that reads the KEY has no user spelling here → funnel (counted).
    # #527 gave this builtin a direct user spelling — `union_in_place` takes the
    # (existing, incoming, key) combine, so the key-reading merger that had no
    # `update_many` spelling is now expressible and no longer funnels.
    "DictUnionInPlace": lambda ev, n, a: (
        a[0].union_in_place(a[1], _cb(ev, a[2])), east_null)[1],
    # `merge` is the single-key upsert that IS DictMerge (dict, key, value,
    # updateFn, initialFn) — argument-for-argument (TS `merge`).
    "DictMerge": lambda ev, n, a: (
        a[0].merge(a[1], a[2], _cb(ev, a[3]), _cb(ev, a[4])), east_null)[1],
    "DictMergeAll": lambda ev, n, a: a[0].merge_all(a[1], _cb(ev, a[2]), _cb(ev, a[3])),
    "DictForEach": lambda ev, n, a: a[0].for_each(_cb(ev, a[1])),
    "DictGenerate": lambda ev, n, a: East.Dict.generate(
        a[0], ev.canon(n.value["type_parameters"][0]), ev.canon(n.value["type_parameters"][1]),
        _cb(ev, a[1]), _cb(ev, a[2]), _cb(ev, a[3])),
    # Ref — the TS names: get / update(value) / merge(value, fn)
    "RefGet": lambda ev, n, a: a[0].get(),
    "RefUpdate": lambda ev, n, a: (a[0].update(a[1]), east_null)[1],
    "RefMerge": lambda ev, n, a: (a[0].merge(a[1], _arity_trim(ev, a[2])), east_null)[1],
    # Vector/Matrix — the structural surface, the arithmetic and the sparse
    # accumulators (#598): the eager EastVector/EastMatrix methods and the
    # East.Vector namespace, whose traced twins share the same spellings.
    "VectorLength": lambda ev, n, a: a[0].length(),
    "VectorGet": lambda ev, n, a: a[0].get(a[1]),
    "VectorSet": lambda ev, n, a: a[0].set(a[1], a[2]),
    "VectorSlice": lambda ev, n, a: a[0].slice(a[1], a[2]),
    "VectorConcat": lambda ev, n, a: a[0].concat(a[1]),
    "VectorToArray": lambda ev, n, a: a[0].to_array(),
    "VectorToMatrix": lambda ev, n, a: a[0].to_matrix(a[1], a[2]),
    "VectorFromArray": lambda ev, n, a: a[0].to_vector(),
    "VectorMap": lambda ev, n, a: a[0].map(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].map(_cb(ev, a[1])),
    "VectorFold": lambda ev, n, a: a[0].reduce(_cb(ev, a[2]), a[1]),
    "MatrixRows": lambda ev, n, a: a[0].rows(),
    "MatrixCols": lambda ev, n, a: a[0].cols(),
    "MatrixGet": lambda ev, n, a: a[0].get(a[1], a[2]),
    "MatrixSet": lambda ev, n, a: a[0].set(a[1], a[2], a[3]),
    "MatrixGetRow": lambda ev, n, a: a[0].get_row(a[1]),
    "MatrixGetCol": lambda ev, n, a: a[0].get_col(a[1]),
    "MatrixTranspose": lambda ev, n, a: a[0].transpose(),
    "MatrixToVector": lambda ev, n, a: a[0].to_vector(),
    "MatrixToArray": lambda ev, n, a: a[0].to_array(),
    "MatrixToRows": lambda ev, n, a: a[0].to_rows(),
    "MatrixMapRows": lambda ev, n, a: a[0].map_rows(_cb(ev, a[1]), out=child_type(_out(n)))
    if not isinstance(a[0], Expression) else a[0].map_rows(_cb(ev, a[1])),
    "VectorScale": lambda ev, n, a: a[0].scale(a[1]),
    "VectorSum": lambda ev, n, a: a[0].sum(),
    "VectorAddScaled": lambda ev, n, a: a[0].add_scaled(a[1], a[2]),
    "VectorMul": lambda ev, n, a: a[0].mul(a[1]),
    "VectorAddScalar": lambda ev, n, a: a[0].add_scalar(a[1]),
    "VectorDot": lambda ev, n, a: a[0].dot(a[1]),
    "VectorMax": lambda ev, n, a: a[0].max(),
    "VectorMin": lambda ev, n, a: a[0].min(),
    "VectorArgMax": lambda ev, n, a: a[0].arg_max(),
    "VectorArgMin": lambda ev, n, a: a[0].arg_min(),
    "VectorMean": lambda ev, n, a: a[0].mean(),
    "VectorCumSum": lambda ev, n, a: a[0].cum_sum(),
    "VectorAbs": lambda ev, n, a: a[0].abs(),
    "VectorClamp": lambda ev, n, a: a[0].clamp(a[1], a[2]),
    "VectorGather": lambda ev, n, a: a[0].gather(a[1]),
    "VectorScatterAdd": lambda ev, n, a: a[0].scatter_add(a[1], a[2]),
    "VectorSearchSorted": lambda ev, n, a: a[0].search_sorted(a[1]),
    "VectorEq": lambda ev, n, a: a[0].eq(a[1]),
    "VectorLt": lambda ev, n, a: a[0].lt(a[1]),
    "VectorGt": lambda ev, n, a: a[0].gt(a[1]),
    "VectorSelect": lambda ev, n, a: a[0].select(a[1], a[2]),
    # the builtin takes (mask, v); the data-first user spelling is v.compress(mask)
    "VectorCompress": lambda ev, n, a: a[1].compress(a[0]),
    "VectorCountTrue": lambda ev, n, a: a[0].count_true(),
    "SparseAxpy": lambda ev, n, a: East.Vector.sparse_axpy(a[0], a[1], a[2], a[3], a[4]),
    "SparseFromPairs": lambda ev, n, a: East.Vector.sparse_from_pairs(a[0], a[1]),
    "SparseFilterGt": lambda ev, n, a: East.Vector.sparse_filter_gt(a[0], a[1], a[2]),
    "MatrixScale": lambda ev, n, a: a[0].scale(a[1]),
    "MatrixAddScaled": lambda ev, n, a: a[0].add_scaled(a[1], a[2]),
    "MatrixMulElementwise": lambda ev, n, a: a[0].mul_elementwise(a[1]),
    "MatrixRowSums": lambda ev, n, a: a[0].row_sums(),
    "MatrixColSums": lambda ev, n, a: a[0].col_sums(),
    "MatrixVecMul": lambda ev, n, a: a[0].vec_mul(a[1]),
    # Blob — the TS names
    "BlobSize": lambda ev, n, a: a[0].size(),
    "BlobGetUint8": lambda ev, n, a: a[0].get_uint8(a[1]),
    "BlobDecodeUtf8": lambda ev, n, a: a[0].decode_utf8(),
    "BlobDecodeUtf16": lambda ev, n, a: a[0].decode_utf16(),
    "BlobDecodeBeast": lambda ev, n, a: a[0].decode_beast(ev.canon(n.value["type_parameters"][0])),
    "BlobDecodeBeast2": lambda ev, n, a: a[0].decode_beast(ev.canon(n.value["type_parameters"][0]), "v2"),
    "BlobOpenBeast2": lambda ev, n, a: a[0].open_beast(ev.canon(n.value["type_parameters"][0])),
    "BlobDecodeCsv": lambda ev, n, a: a[0].decode_csv(ev.canon(n.value["type_parameters"][0]), a[1]),
    "BlobEncodeBeast": lambda ev, n, a: East.Blob.encode_beast(a[0], typ=ev.canon(n.value["type_parameters"][0])),
    "BlobEncodeBeast2": lambda ev, n, a: East.Blob.encode_beast(a[0], "v2", typ=ev.canon(n.value["type_parameters"][0])),
}


def _unsup(reason: str) -> Any:
    raise _Unsupported(reason)


class _MissingArg:
    """A callback parameter the python surface does not provide (narrowed
    signature). Any use trips loudly."""

    def __init__(self, name: str):
        self._name = name

    def __getattr__(self, name: str) -> Any:
        raise _Unsupported(f"callback parameter {self._name!r} narrowed away by the python surface")


def _kv_user(ev: EagerEvaluator, a: Any, keep: int) -> Any:
    """Adapt a single-value user callback: keep only the first ``keep`` args.
    The python surface hands every body the block first; the compiled
    callback takes none."""
    if not isinstance(a, Closure):
        return a
    cb = ev.make_callback(a)
    return lambda _b, *args: cb(*args[:keep])


def _arity_trim(ev: EagerEvaluator, a: Any) -> Any:
    """A body calling the closure with only as many arguments as it declares
    (the block the surface passes first is dropped — a compiled callback
    takes none)."""
    if not isinstance(a, Closure):
        return lambda _b, *_args: a
    n = len(a.payload["parameters"])
    cb = ev.make_callback(a)
    return lambda _b, *args: cb(*args[:n])


def _two_arg_combine(ev: EagerEvaluator, a: Any) -> Any:
    """(v1, v2, key) builtin combine → the user surface's (b, v1, v2) combine."""
    if not isinstance(a, Closure):
        return a
    cb = ev.make_callback(a)
    return lambda _b, v1, v2: cb(v1, v2, None) if _combine_arity(a) == 3 else cb(v1, v2)


def _combine_arity(a: Closure) -> int:
    return len(a.payload["parameters"])


# ─── scalar rows derived from the shared spelling table ─────────────────────
# The builtin → python spelling table lives in east.codegen.spellings (the
# IR→python printer's table, #627); the replay's scalar rows are derived from
# it, so the spelling the printer writes and the spelling the replay executes
# are one table. tests/test_codegen_spellings.py pins the hand rows above
# against the same table.


def _scalar_row(fn: Any, n_params: int) -> Any:
    """A row calling a namespace method: generic methods take the builtin's
    type parameter(s) as their leading python argument(s); the arity decides."""

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


def _namespace_rows() -> dict[str, Any]:
    from east.codegen.spellings import namespace_spellings

    return {name: _scalar_row(fn, arity)
            for name, (_prefix, fn, arity) in namespace_spellings().items()}


for _name, _row in _namespace_rows().items():
    _ROWS.setdefault(_name, _row)

# The formatted-datetime builtins take a pre-tokenized
# Array<DateTimeFormatToken>; the namespace sugar tokenizes a format STRING,
# so its derived rows cannot replay the IR's argument shape — the funnel
# carries them instead (they are in FUNNEL_ONLY).
for _fmt_builtin in ("DateTimePrintFormat", "DateTimeParseFormat"):
    _ROWS.pop(_fmt_builtin, None)
