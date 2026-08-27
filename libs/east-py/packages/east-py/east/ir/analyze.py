#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Analysis and validation of East IR — the python twin of ``analyze.ts``.

The TypeScript compiler analyzes every IR tree before it compiles it:
scope (every Variable is bound, captures name outer variables of the same
type and mutability), typing (the exact-type rules — a Let, an Assign, a
call argument, a collection element, a struct field or a variant payload
must have EXACTLY its slot's type, subtyping being spelled with an explicit
``As`` node; an ``As`` that changes nothing is an error), the divergence
rules (a branch or case body is the node's type or ``Never``; a node whose
every arm diverges is ``Never``, and only then), and the well-formedness of
every node kind. Python never needed the pass while its IR was
TypeScript-authored; with IR built natively (``East.function``, the
statement surface, the IR→python printer) it is the gate every build runs
through before compiling, and the round-trip conformance suite's oracle.

``analyze_ir`` raises :class:`IRAnalysisError` with the TypeScript
analyzer's message (``… at loc_id N``, followed by the resolved python
``file:line:column`` when a source map is given) or returns normally. It is
validation only: the JavaScript backend's ``isAsync`` enrichment has no
meaning for east-c, which executes async IR synchronously.
"""

from __future__ import annotations

from typing import Any, NoReturn

from east.runtime.errors import EastError
from east.types.types import (
    ArrayType,
    EastType,
    IntegerType,
    StringType,
    StructType,
    is_subtype,
    is_type_equal,
)

__all__ = ["IRAnalysisError", "analyze_ir"]


class IRAnalysisError(EastError):
    """The IR failed analysis: a scope, typing or well-formedness rule broke.

    An ``EastError`` (the message carries the TypeScript analyzer's text and,
    when a source map resolved the node, the python ``file:line:column`` —
    also available as ``location``), so a build or compile failure is caught
    by the same handlers as a runtime failure.
    """

    def __init__(self, message: str, location: Any = ()) -> None:
        super().__init__(message, list(location))


_STACK_TYPE = ArrayType(StructType([
    ("filename", StringType), ("line", IntegerType), ("column", IntegerType),
]))


def _print(t: EastType) -> str:
    from east.serialization.east_printer import print_type

    try:
        return print_type(t)
    except Exception:  # pragma: no cover - a printer failure must not mask the error
        return f".{t.type}"


def _expand(t: EastType) -> EastType:
    """A recursive wrapper unrolled one level (TS ``expandTypeValue``)."""
    if t.type == "Recursive":
        from east.expression.lift import _unroll

        return _unroll(t)
    return t


class _Var:
    __slots__ = ("type", "mutable", "captured")

    def __init__(self, t: EastType, mutable: bool) -> None:
        self.type = t
        self.mutable = mutable
        self.captured = False


class _Scope:
    """A lexical scope: its own bindings and (within one function) its parent.
    A function body starts a fresh chain — outer variables reach it only as
    the function's declared captures (TS ``fnCtx``)."""

    __slots__ = ("vars", "parent")

    def __init__(self, parent: _Scope | None) -> None:
        self.vars: dict[str, _Var] = {}
        self.parent = parent

    def lookup(self, name: str) -> _Var | None:
        scope: _Scope | None = self
        while scope is not None:
            hit = scope.vars.get(name)
            if hit is not None:
                return hit
            scope = scope.parent
        return None

    def bind(self, var_node: Any) -> None:
        p = var_node.value
        self.vars[p["name"]] = _Var(p["type"], bool(p["mutable"]))


class _Analyzer:
    def __init__(self, platforms: Any, source_map: Any) -> None:
        self.source_map = source_map
        self.platforms: dict[str, Any] | None = None
        if platforms is not None:
            self.platforms = {}
            for p in platforms:
                name = _pf(p, "name")
                if name in self.platforms:
                    raise IRAnalysisError(f"Duplicate platform function definition for '{name}'")
                self.platforms[name] = p

    # ── errors ──────────────────────────────────────────────────────────

    def fail(self, message: str, node: Any) -> NoReturn:
        """Raise with the TypeScript analyzer's ``… at loc_id N`` suffix — or,
        when the source map resolves the node, east-c's ``… at file:line:col``
        form naming the python frame that built it."""
        loc_id = node.value["loc_id"]
        stack: Any = ()
        if self.source_map is not None and loc_id:
            try:
                stack = self.source_map.resolve(loc_id)
            except Exception:
                stack = ()
        if stack:
            top = stack[0]  # a Location is a (filename, line, column) tuple
            frames = [{"filename": f, "line": ln, "column": col} for f, ln, col in stack]
            raise IRAnalysisError(f"{message} at {top[0]}:{top[1]}:{top[2]}", frames)
        raise IRAnalysisError(f"{message} at loc_id {loc_id}")

    # ── the walk ────────────────────────────────────────────────────────

    def visit(self, node: Any, scope: _Scope, ret: EastType | None) -> EastType:
        """Validate ``node`` in ``scope``; return its type."""
        kind = node.type
        p = node.value
        method = getattr(self, "v_" + kind, None)
        if method is None:
            self.fail(f"Unhandled IR type: {kind}", node)
        return method(node, p, scope, ret)

    def v_Value(self, node, p, scope, ret):  # noqa: ARG002
        if p["type"].type != p["value"].type:
            self.fail(
                f"Value node expected value of type .{p['type'].type} "
                f"but got .{p['value'].type}", node)
        return p["type"]

    def v_Variable(self, node, p, scope, ret):  # noqa: ARG002
        name = p["name"]
        var = scope.lookup(name)
        if var is None:
            self.fail(f"Variable {name} not in scope", node)
        if not is_type_equal(var.type, p["type"]):
            self.fail(
                f"Variable {name} has type {_print(var.type)} "
                f"but expected {_print(p['type'])}", node)
        if var.mutable != bool(p["mutable"]):
            self.fail(
                f"Variable {name} mutability mismatch: context has "
                f"{'mutable' if var.mutable else 'const'} but IR expects "
                f"{'mutable' if p['mutable'] else 'const'}", node)
        if name not in scope.vars:
            var.captured = True
        return p["type"]

    def v_Let(self, node, p, scope, ret):
        value_t = self.visit(p["value"], scope, ret)
        var = p["variable"].value
        if var["type"].type != "Never" and not is_type_equal(value_t, var["type"]):
            self.fail(
                f"Let statement requires exact type match. Variable {var['name']} "
                f"has type {_print(var['type'])} but value has type "
                f"{_print(value_t)}. Insert an As node if subtyping is intended.", node)
        scope.bind(p["variable"])
        return p["type"]

    def v_Assign(self, node, p, scope, ret):
        var = p["variable"].value
        name = var["name"]
        meta = scope.lookup(name)
        if meta is None:
            self.fail(f"Cannot assign to variable {name} which is not in scope", node)
        if not var["mutable"]:
            self.fail(f"Cannot reassign const variable {name}", node)
        if not meta.mutable:
            self.fail(f"Cannot reassign variable {name} - context says it's const", node)
        value_t = self.visit(p["value"], scope, ret)
        if value_t.type != "Never" and not is_type_equal(value_t, meta.type):
            self.fail(
                f"Assign statement requires exact type match. Variable {name} has "
                f"type {_print(meta.type)} but value has type {_print(value_t)}. "
                "Insert an As node if subtyping is intended.", node)
        return p["type"]

    def v_Block(self, node, p, scope, ret):
        inner = _Scope(scope)
        from east.types.types import NullType

        last_t: EastType = NullType
        for stmt in p["statements"]:
            last_t = self.visit(stmt, inner, ret)
        if not is_type_equal(last_t, p["type"]):
            self.fail(
                f"Block evaluates to type {_print(last_t)} "
                f"but expected {_print(p['type'])}", node)
        return p["type"]

    def v_As(self, node, p, scope, ret):
        value_t = self.visit(p["value"], scope, ret)
        if not is_subtype(value_t, p["type"]):
            self.fail(
                f"Cannot cast value of type {_print(value_t)} "
                f"to type {_print(p['type'])}", node)
        if value_t.type == "Never":
            self.fail(f"Cannot cast .Never to type {_print(p['type'])}", node)
        if is_type_equal(value_t, p["type"]):
            self.fail(
                f"Unnecessary As node: value is already of type {_print(p['type'])}", node)
        return p["type"]

    def v_Platform(self, node, p, scope, ret):
        name = p["name"]
        platform = self.platforms.get(name) if self.platforms is not None else None
        if platform is None:
            if self.platforms is not None and not p["optional"]:
                self.fail(f"Platform function '{name}' not found", node)
            for arg in p["arguments"]:
                self.visit(arg, scope, ret)
            return p["type"]
        type_params = list(p["type_parameters"])
        declared_params = list(_pf(platform, "type_parameters") or [])
        if len(type_params) != len(declared_params):
            self.fail(
                f"Platform function '{name}' expects {len(declared_params)} "
                f"type parameters, got {len(type_params)}", node)
        signature = _platform_signature(platform, type_params)
        if signature is None:
            # A generic implementation whose signature is only known to its
            # factory (python's GenericPlatformFunction): arguments are
            # analyzed, the call's types are the compile's to check.
            for arg in p["arguments"]:
                self.visit(arg, scope, ret)
            return p["type"]
        inputs, output = signature
        if len(p["arguments"]) != len(inputs):
            self.fail(
                f"Platform function '{name}' expects {len(inputs)} arguments "
                f"but got {len(p['arguments'])}", node)
        for i, (arg, expected) in enumerate(zip(p["arguments"], inputs, strict=True)):
            arg_t = self.visit(arg, scope, ret)
            if arg_t.type != "Never" and not is_type_equal(arg_t, expected):
                self.fail(
                    f"Platform function '{name}' argument {i + 1} requires exact "
                    f"type match. Expected type {_print(expected)} but got "
                    f"{_print(arg_t)}. Insert an As node if subtyping is intended.", node)
        if not is_type_equal(p["type"], output):
            self.fail(
                f"Platform function '{name}' return type expected to be "
                f"{_print(output)} but IR has {_print(p['type'])}", node)
        return p["type"]

    def _function(self, node, p, scope, kind):
        if p["type"].type != kind:
            self.fail(f"Expected {kind} type, got {_print(p['type'])}", node)
        fn_scope = _Scope(None)
        for cap in p["captures"]:
            c = cap.value
            outer = scope.lookup(c["name"])
            if outer is None:
                self.fail(f"Captured variable {c['name']} not in scope", node)
            if not is_type_equal(outer.type, c["type"]):
                self.fail(
                    f"Captured variable {c['name']} has type {_print(outer.type)} "
                    f"but expected {_print(c['type'])}", node)
            if outer.mutable != bool(c["mutable"]):
                self.fail(
                    f"Captured variable {c['name']} mutability mismatch: context has "
                    f"{'mutable' if outer.mutable else 'const'} but IR expects "
                    f"{'mutable' if c['mutable'] else 'const'}", node)
            outer.captured = True
            fn_scope.bind(cap)
        for param in p["parameters"]:
            fn_scope.bind(param)
        expected = p["type"].value["output"]
        body_t = self.visit(p["body"], fn_scope, expected)
        if body_t.type != "Never" and not is_type_equal(body_t, expected):
            self.fail(
                f"{kind} body returns type {_print(body_t)} "
                f"but function signature expects {_print(expected)}", node)
        return p["type"]

    def v_Function(self, node, p, scope, ret):  # noqa: ARG002
        return self._function(node, p, scope, "Function")

    def v_AsyncFunction(self, node, p, scope, ret):  # noqa: ARG002
        return self._function(node, p, scope, "AsyncFunction")

    def _call(self, node, p, scope, ret, kind):
        fn_t = self.visit(p["function"], scope, ret)
        if fn_t.type != kind:
            self.fail(f"{'CallAsync' if kind == 'AsyncFunction' else 'Call'} expects "
                      f"{kind} type, got {_print(fn_t)}", node)
        inputs = list(fn_t.value["inputs"])
        if len(inputs) != len(p["arguments"]):
            self.fail(
                f"Function expects {len(inputs)} arguments, got {len(p['arguments'])}", node)
        for i, (arg, expected) in enumerate(zip(p["arguments"], inputs, strict=True)):
            arg_t = self.visit(arg, scope, ret)
            if arg_t.type != "Never" and not is_type_equal(arg_t, expected):
                self.fail(
                    f"Function call argument {i + 1} requires exact type match. "
                    f"Expected type {_print(expected)} but got {_print(arg_t)}. "
                    "Insert an As node if subtyping is intended.", node)
        output = fn_t.value["output"]
        if not is_type_equal(p["type"], output):
            self.fail(
                f"Function call return type expected to be {_print(output)} "
                f"but IR has {_print(p['type'])}", node)
        return p["type"]

    def v_Call(self, node, p, scope, ret):
        return self._call(node, p, scope, ret, "Function")

    def v_CallAsync(self, node, p, scope, ret):
        return self._call(node, p, scope, ret, "AsyncFunction")

    def v_Builtin(self, node, p, scope, ret):
        from east.runtime.builtin_signatures import builtin_inputs

        name = p["builtin"]
        try:
            inputs = builtin_inputs(name, list(p["type_parameters"]))
        except TypeError as e:
            if "no declared input signature" in str(e):
                self.fail(f"Unknown builtin function '{name}'", node)
            inputs = None
        if inputs is not None and len(p["arguments"]) != len(inputs):
            self.fail(
                f"Builtin function '{name}' expects {len(inputs)} arguments, "
                f"but got {len(p['arguments'])}", node)
        for arg in p["arguments"]:
            self.visit(arg, scope, ret)
        return p["type"]

    def v_Return(self, node, p, scope, ret):
        if ret is None:
            self.fail("Return statement outside of function", node)
        value_t = self.visit(p["value"], scope, ret)
        if value_t.type != "Never" and not is_type_equal(value_t, ret):
            self.fail(
                f"Return statement returns type {_print(value_t)} "
                f"but function signature expects {_print(ret)}", node)
        return p["type"]

    def _elements(self, node, p, scope, ret, kind, what, element_t):
        if p["type"].type != kind:
            self.fail(f"New{kind} node must have {kind} type, got {_print(p['type'])}", node)
        for i, v in enumerate(p["values"]):
            v_t = self.visit(v, scope, ret)
            if v_t.type != "Never" and not is_type_equal(v_t, element_t):
                self.fail(
                    f"{what} {i} has type {_print(v_t)} "
                    f"but {kind.lower()} expects {_print(element_t)}", node)
        return p["type"]

    def v_NewRef(self, node, p, scope, ret):
        if p["type"].type != "Ref":
            self.fail(f"NewRef node must have Ref type, got {_print(p['type'])}", node)
        value_t = self.visit(p["value"], scope, ret)
        if value_t.type != "Never" and not is_type_equal(value_t, p["type"].value):
            self.fail(
                f"Ref value has type {_print(value_t)} "
                f"but Ref expects {_print(p['type'].value)}", node)
        return p["type"]

    def v_NewArray(self, node, p, scope, ret):
        return self._elements(node, p, scope, ret, "Array", "Array element",
                              p["type"].value if p["type"].type == "Array" else None)

    def v_NewSet(self, node, p, scope, ret):
        return self._elements(node, p, scope, ret, "Set", "Set element",
                              p["type"].value if p["type"].type == "Set" else None)

    def v_NewVector(self, node, p, scope, ret):
        return self._elements(node, p, scope, ret, "Vector", "Vector element",
                              p["type"].value if p["type"].type == "Vector" else None)

    def v_NewMatrix(self, node, p, scope, ret):
        return self._elements(node, p, scope, ret, "Matrix", "Matrix element",
                              p["type"].value if p["type"].type == "Matrix" else None)

    def v_NewDict(self, node, p, scope, ret):
        if p["type"].type != "Dict":
            self.fail(f"NewDict node must have Dict type, got {_print(p['type'])}", node)
        k_t, v_t = p["type"].value["key"], p["type"].value["value"]
        for i, entry in enumerate(p["values"]):
            key_t = self.visit(entry["key"], scope, ret)
            val_t = self.visit(entry["value"], scope, ret)
            if key_t.type != "Never" and not is_type_equal(key_t, k_t):
                self.fail(
                    f"Dict key {i} has type {_print(key_t)} "
                    f"but dict expects {_print(k_t)}", node)
            if val_t.type != "Never" and not is_type_equal(val_t, v_t):
                self.fail(
                    f"Dict value {i} has type {_print(val_t)} "
                    f"but dict expects {_print(v_t)}", node)
        return p["type"]

    def v_ForArray(self, node, p, scope, ret):
        arr_t = self.visit(p["array"], scope, ret)
        if arr_t.type != "Array":
            self.fail(f"ForArray expects Array type, got {_print(arr_t)}", node)
        elem_t = arr_t.value
        if p["key"].value["type"].type != "Integer":
            self.fail(
                f"ForArray key must be Integer type, got {_print(p['key'].value['type'])}", node)
        if not is_type_equal(p["value"].value["type"], elem_t):
            self.fail(
                f"ForArray value variable has type {_print(p['value'].value['type'])} "
                f"but array elements have type {_print(elem_t)}", node)
        loop = _Scope(scope)
        loop.bind(p["key"])
        loop.bind(p["value"])
        self.visit(p["body"], loop, ret)
        return p["type"]

    def v_ForSet(self, node, p, scope, ret):
        set_t = self.visit(p["set"], scope, ret)
        if set_t.type != "Set":
            self.fail(f"ForSet expects Set type, got {_print(set_t)}", node)
        if not is_type_equal(p["key"].value["type"], set_t.value):
            self.fail(
                f"ForSet key variable has type {_print(p['key'].value['type'])} "
                f"but set elements have type {_print(set_t.value)}", node)
        loop = _Scope(scope)
        loop.bind(p["key"])
        self.visit(p["body"], loop, ret)
        return p["type"]

    def v_ForDict(self, node, p, scope, ret):
        dict_t = self.visit(p["dict"], scope, ret)
        if dict_t.type != "Dict":
            self.fail(f"ForDict expects Dict type, got {_print(dict_t)}", node)
        k_t, v_t = dict_t.value["key"], dict_t.value["value"]
        if not is_type_equal(p["key"].value["type"], k_t):
            self.fail(
                f"ForDict key variable has type {_print(p['key'].value['type'])} "
                f"but dict keys have type {_print(k_t)}", node)
        if not is_type_equal(p["value"].value["type"], v_t):
            self.fail(
                f"ForDict value variable has type {_print(p['value'].value['type'])} "
                f"but dict values have type {_print(v_t)}", node)
        loop = _Scope(scope)
        loop.bind(p["key"])
        loop.bind(p["value"])
        self.visit(p["body"], loop, ret)
        return p["type"]

    def v_IfElse(self, node, p, scope, ret):
        all_never = True
        for i, case in enumerate(p["ifs"]):
            pred_t = self.visit(case["predicate"], scope, ret)
            if pred_t.type != "Boolean":
                self.fail(
                    f"IfElse predicate {i} must be Boolean type, got {_print(pred_t)}", node)
            body_t = self.visit(case["body"], scope, ret)
            if body_t.type != "Never":
                all_never = False
                if not is_type_equal(body_t, p["type"]):
                    self.fail(
                        f"IfElse branch {i} returns type {_print(body_t)} "
                        f"but IfElse expects {_print(p['type'])}", node)
        else_t = self.visit(p["else_body"], scope, ret)
        if else_t.type != "Never":
            all_never = False
            if not is_type_equal(else_t, p["type"]):
                self.fail(
                    f"IfElse else branch returns type {_print(else_t)} "
                    f"but IfElse expects {_print(p['type'])}", node)
        if all_never and p["type"].type != "Never":
            self.fail(
                "IfElse has all branches returning Never, so it must have type Never, "
                f"but has type {_print(p['type'])}", node)
        if p["type"].type == "Never" and not all_never:
            self.fail("IfElse has type Never but not all branches diverge", node)
        return p["type"]

    def v_While(self, node, p, scope, ret):
        pred_t = self.visit(p["predicate"], scope, ret)
        if pred_t.type != "Boolean":
            self.fail(f"While predicate must be Boolean type, got {_print(pred_t)}", node)
        self.visit(p["body"], scope, ret)
        return p["type"]

    def v_Continue(self, node, p, scope, ret):  # noqa: ARG002
        return p["type"]

    def v_Break(self, node, p, scope, ret):  # noqa: ARG002
        return p["type"]

    def v_Error(self, node, p, scope, ret):
        msg_t = self.visit(p["message"], scope, ret)
        if msg_t.type != "String":
            self.fail(f"Error message must be String type, got {_print(msg_t)}", node)
        return p["type"]

    def v_TryCatch(self, node, p, scope, ret):
        try_t = self.visit(p["try_body"], scope, ret)
        if p["message"].value["type"].type != "String":
            self.fail(
                "TryCatch message variable must be String type, got "
                f"{_print(p['message'].value['type'])}", node)
        if not is_type_equal(p["stack"].value["type"], _STACK_TYPE):
            self.fail(
                f"TryCatch stack variable must be {_print(_STACK_TYPE)} type, got "
                f"{_print(p['stack'].value['type'])}", node)
        catch_scope = _Scope(scope)
        catch_scope.bind(p["message"])
        catch_scope.bind(p["stack"])
        catch_t = self.visit(p["catch_body"], catch_scope, ret)
        if try_t.type != "Never" and not is_type_equal(try_t, p["type"]):
            self.fail(
                f"TryCatch try body returns type {_print(try_t)} "
                f"but TryCatch expects {_print(p['type'])}", node)
        if catch_t.type != "Never" and not is_type_equal(catch_t, p["type"]):
            self.fail(
                f"TryCatch catch body returns type {_print(catch_t)} "
                f"but TryCatch expects {_print(p['type'])}", node)
        if try_t.type == "Never" and catch_t.type == "Never" and p["type"].type != "Never":
            self.fail(
                "TryCatch has both try and catch bodies returning Never, so it must "
                f"have type Never, but has type {_print(p['type'])}", node)
        self.visit(p["finally_body"], scope, ret)
        return p["type"]

    def v_Struct(self, node, p, scope, ret):
        if p["type"].type != "Struct" and _expand(p["type"]).type != "Struct":
            self.fail(f"Struct node must have Struct type, got {_print(p['type'])}", node)
        struct_t = _expand(p["type"])
        fields = list(struct_t.value)
        if len(fields) != len(p["fields"]):
            self.fail(
                f"Struct type has {len(fields)} fields but struct value has "
                f"{len(p['fields'])} fields", node)
        for i, field in enumerate(p["fields"]):
            field_t = self.visit(field["value"], scope, ret)
            type_field = fields[i]
            if type_field["name"] != field["name"]:
                self.fail(
                    f"Struct has field {type_field['name']} at position {i}, "
                    "but value does not", node)
            if not is_type_equal(field_t, type_field["type"]):
                self.fail(
                    f"Struct field {field['name']} has type {_print(field_t)} "
                    f"but struct type expects {_print(type_field['type'])}", node)
        return p["type"]

    def v_GetField(self, node, p, scope, ret):
        struct_t = self.visit(p["struct"], scope, ret)
        expanded = _expand(struct_t)
        if expanded.type != "Struct":
            self.fail(f"GetField expects Struct type, got {_print(struct_t)}", node)
        field = next((f for f in expanded.value if f["name"] == p["field"]), None)
        if field is None:
            self.fail(f"Struct does not have field {p['field']}", node)
        if not is_type_equal(p["type"], field["type"]):
            self.fail(
                f"GetField result type {_print(p['type'])} "
                f"does not match field type {_print(field['type'])}", node)
        return p["type"]

    def v_Variant(self, node, p, scope, ret):
        value_t = self.visit(p["value"], scope, ret)
        expanded = _expand(p["type"])
        if expanded.type != "Variant":
            self.fail(f"Variant node must have Variant type, got {_print(p['type'])}", node)
        case = next((c for c in expanded.value if c["name"] == p["case"]), None)
        if case is None:
            self.fail(f"Variant type does not have case {p['case']}", node)
        if not is_type_equal(value_t, case["type"]):
            self.fail(
                f"Variant case {p['case']} value has type {_print(value_t)} "
                f"but variant type expects {_print(case['type'])}", node)
        return p["type"]

    def v_Match(self, node, p, scope, ret):
        variant_t = self.visit(p["variant"], scope, ret)
        expanded = _expand(variant_t)
        if expanded.type != "Variant":
            self.fail(f"Match expects Variant type, got {_print(variant_t)}", node)
        cases = list(expanded.value)
        if len(cases) != len(p["cases"]):
            self.fail(
                f"Match has {len(p['cases'])} cases but variant type has "
                f"{len(cases)} cases", node)
        all_never = True
        for match_case in p["cases"]:
            type_case = next((c for c in cases if c["name"] == match_case["case"]), None)
            if type_case is None:
                self.fail(
                    f"Match has case {match_case['case']} but variant type does not", node)
            var_t = match_case["variable"].value["type"]
            if not is_type_equal(var_t, type_case["type"]):
                self.fail(
                    f"Match case {match_case['case']} variable has type {_print(var_t)} "
                    f"but variant case has type {_print(type_case['type'])}", node)
            case_scope = _Scope(scope)
            case_scope.bind(match_case["variable"])
            body_t = self.visit(match_case["body"], case_scope, ret)
            if body_t.type != "Never":
                all_never = False
                if not is_type_equal(body_t, p["type"]):
                    self.fail(
                        f"Match case {match_case['case']} returns type {_print(body_t)} "
                        f"but Match expects {_print(p['type'])}", node)
        if all_never and p["type"].type != "Never":
            self.fail(
                "Match has all cases returning Never, so it must have type Never, "
                f"but has type {_print(p['type'])}", node)
        return p["type"]

    def v_UnwrapRecursive(self, node, p, scope, ret):
        value_t = self.visit(p["value"], scope, ret)
        input_t = _expand(value_t) if value_t.type == "Recursive" else value_t
        if input_t.type != "Never" and not is_type_equal(p["type"], input_t):
            self.fail(
                f"UnwrapRecursive result type {_print(p['type'])} "
                f"does not match recursive type {_print(input_t)}", node)
        return p["type"]

    def v_WrapRecursive(self, node, p, scope, ret):
        value_t = self.visit(p["value"], scope, ret)
        expected = _expand(p["type"]) if p["type"].type == "Recursive" else p["type"]
        if value_t.type != "Never" and not is_type_equal(value_t, expected):
            self.fail(
                f"WrapRecursive value has type {_print(value_t)} "
                f"but expects {_print(expected)}", node)
        return p["type"]


def _pf(platform: Any, key: str) -> Any:
    """A field of a platform implementation entry — a ``PlatformFunction``
    TypedDict (a dict) or any object carrying the same attributes."""
    if isinstance(platform, dict):
        return platform.get(key)
    return getattr(platform, key, None)


def _platform_signature(platform: Any, type_params: list) -> tuple[list, EastType] | None:
    """``(inputs, output)`` of a platform implementation entry, for the
    concrete ``type_params`` when it is generic (``None`` when only its
    factory knows them)."""
    if type_params:
        inputs_fn = _pf(platform, "inputs_fn") or _pf(platform, "inputsFn")
        output_fn = _pf(platform, "outputs_fn") or _pf(platform, "outputsFn")
        if inputs_fn is None or output_fn is None:
            return None
        return list(inputs_fn(*type_params)), output_fn(*type_params)
    inputs = _pf(platform, "inputs")
    if inputs is None:
        inputs = _pf(platform, "input_types") or []
    output = _pf(platform, "output")
    if output is None:
        output = _pf(platform, "output_type")
    return list(inputs), output


def analyze_ir(ir: Any, platforms: Any = None, *, source_map: Any = None) -> None:
    """Validate an IR value the way the TypeScript compiler's ``analyzeIR``
    does, raising :class:`IRAnalysisError` on the first rule broken.

    Args:
        ir: The IR value (an ``IRType`` variant — a Function node, or the
            ``Block[Let…, Function]`` a build with hoisted constants emits).
        platforms: The platform implementations the program will compile
            against (``PlatformFunction`` entries); when given, every
            ``Platform`` node is checked against its implementation's
            signature, and a missing one is an error unless the node is
            ``optional``. ``None`` skips the implementation checks (a
            program compiled later with ``East.compile``).
        source_map: The IR's source map, so a failure names the python
            ``file:line:column`` of the offending node after its loc_id.

    Raises:
        IRAnalysisError: With the TypeScript analyzer's message for the rule
            that failed.
    """
    _Analyzer(platforms, source_map).visit(ir, _Scope(None), None)
