#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The translator's AST, and its lowering to East IR: the twin of ``ast.ts`` and ``ast_to_ir.ts``.

TypeScript's jq translator writes the program as East's typed AST and lowers
it with ``ast_to_ir``, which casts each value to the type its place declares —
a ``Let``'s variable, a builtin's parameter, a struct's field, a branch's
result — as it goes. The python translator writes the same AST and lowers it
here by the same rules, so the two give the same IR under east-c's normaliser.

A node can also hold IR built elsewhere (``IR``): an expression of the python
build a query is spelled in, which the lowering leaves as it is. Every
variable and label the lowering names is fresh in the process
(``__n<k>``), so a translation spliced into a python build never shadows a
name the build uses. The IR is built as the python builder builds it — its
array children python lists — and ``finalize_ir`` makes it final.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from east.expression.finalize import _arrayify_tree, _free_vars
from east.expression.nodes import _fresh_name
from east.ir.builders import (
    ir_as,
    ir_assign,
    ir_break,
    ir_continue,
    ir_error,
    ir_for_array,
    ir_for_dict,
    ir_for_set,
    ir_get_field,
    ir_label,
    ir_let,
    ir_new_ref,
    ir_return,
    ir_trycatch,
    ir_unwrap_recursive,
    ir_variable,
    ir_variant,
    ir_while,
    ir_wrap_recursive,
)
from east.query.jq.shapes import node_of, type_equal
from east.runtime.builtin_signatures import builtin_inputs
from east.serialization.east_printer import print_type
from east.types.types import EastType, NeverType, NullType, is_subtype
from east.types.values import EastBlob, EastStruct, EastVariant, east_null

#: The reserved "no location" id.
UNKNOWN_LOC_ID = 0


class A:
    """A node of East's typed AST (``ast.ts``'s ``AST``): its kind, type and location, and its kind's fields.

    Nodes are told apart by identity, as TypeScript's are: a ``Variable`` is
    the variable, wherever it is read, and a ``Label`` the loop it names.
    """

    def __init__(self, ast_type: str, type_: EastType, loc_id: int = UNKNOWN_LOC_ID, **fields: Any) -> None:
        self.ast_type = ast_type
        self.type = type_
        self.loc_id = loc_id
        for name, value in fields.items():
            setattr(self, name, value)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<AST {self.ast_type}: {print_type(self.type)}>"


class Label:
    """A loop's label: the loop a ``break`` leaves, told apart by identity."""

    __slots__ = ("loc_id",)

    def __init__(self, loc_id: int = UNKNOWN_LOC_ID) -> None:
        self.loc_id = loc_id


def variable(type_: EastType, name: str | None = None, mutable: bool = False) -> A:
    """A variable node; ``name`` is the author's, which the lowering does not keep."""
    return A("Variable", type_, UNKNOWN_LOC_ID, mutable=mutable, name=name)


def external(ir: Any, type_: EastType) -> A:
    """A node holding IR built elsewhere: an expression of the python build a query is spelled in."""
    return A("IR", type_, UNKNOWN_LOC_ID, ir=ir)


# ─── Lazy IR nodes, their array children python lists ──────────────────────


def _node(kind: str, **fields: Any) -> EastVariant:
    return EastVariant(kind, EastStruct(fields))


def _value(t: EastType, value: Any, loc_id: int) -> EastVariant:
    """A Value node, its literal's case the declared type's (``3`` as a Float is ``3.0``)."""
    kind = t.type
    if kind == "Null":
        literal: EastVariant[Any] = EastVariant("Null", east_null)
    elif kind == "Boolean":
        literal = EastVariant("Boolean", bool(value))
    elif kind == "Integer":
        literal = EastVariant("Integer", int(value))
    elif kind == "Float":
        literal = EastVariant("Float", float(value))
    elif kind == "String":
        literal = EastVariant("String", str(value))
    elif kind == "DateTime":
        if not isinstance(value, datetime):
            raise TypeError(f"a DateTime literal of {type(value).__name__}")
        literal = EastVariant("DateTime", value)
    elif kind == "Blob":
        literal = EastVariant("Blob", EastBlob(bytes(value)))
    else:
        raise TypeError(f"Unsupported literal value type (expected {print_type(t)})")
    return _node("Value", type=t, loc_id=loc_id, value=literal)


# ─── Casting ───────────────────────────────────────────────────────────────


def _node_type(t: EastType) -> EastType:
    """A recursive type's node, with its references closed over it."""
    return node_of(t) if t.type == "Recursive" else t


def coerce_to(value_ir: Any, source_type: EastType, target_type: EastType, loc_id: int,
              visited: set[tuple[int, int]] | None = None) -> Any:
    """Casts an IR value from one type to a wider one, as ``ast_to_ir.ts``'s ``coerce_to`` does.

    A struct or variant literal is rebuilt with the wider type, each child cast;
    anything else is one outer ``As``. A value of Never is left as it is: it
    never arrives, and the analyzer casts no Never.

    Raises:
        TypeError: When ``source_type`` is not a subtype of ``target_type``.
    """
    if type_equal(source_type, target_type):
        return value_ir
    if source_type.type == "Never":
        return value_ir
    if not is_subtype(source_type, target_type):
        raise TypeError(f"{print_type(source_type)} is not a subtype of {print_type(target_type)} at loc_id {loc_id}")
    pair = (id(source_type), id(target_type))
    if visited is not None and pair in visited:
        return ir_as(target_type, value_ir, loc_id)
    visited2 = visited if visited is not None else set()
    visited2.add(pair)
    s = _node_type(source_type)
    t = _node_type(target_type)
    if value_ir.type == "Struct" and s.type == "Struct" and t.type == "Struct":
        s_fields = {f["name"]: f["type"] for f in s.value}
        t_fields = {f["name"]: f["type"] for f in t.value}
        new_fields: list[EastStruct] = []
        for f in value_ir.value["fields"]:
            name = f["name"]
            field_ir = f["value"]
            if name not in s_fields or name not in t_fields:
                new_fields.append(EastStruct({"name": name, "value": field_ir}))
            else:
                new_fields.append(EastStruct({
                    "name": name, "value": coerce_to(field_ir, s_fields[name], t_fields[name], loc_id, visited2)}))
        return _node("Struct", type=target_type, loc_id=value_ir.value["loc_id"], fields=new_fields)
    if value_ir.type == "Variant" and s.type == "Variant" and t.type == "Variant":
        case_name = value_ir.value["case"]
        s_cases = {c["name"]: c["type"] for c in s.value}
        t_cases = {c["name"]: c["type"] for c in t.value}
        inner = value_ir.value["value"]
        if case_name in s_cases and case_name in t_cases:
            inner = coerce_to(inner, s_cases[case_name], t_cases[case_name], loc_id, visited2)
        return _node("Variant", type=target_type, loc_id=value_ir.value["loc_id"], case=case_name, value=inner)
    return ir_as(target_type, value_ir, loc_id)


# ─── Lowering ──────────────────────────────────────────────────────────────


@dataclass
class _Ctx:
    """What is in scope where a node is lowered."""

    #: A variable node's id → its IR variable, for the variables bound in this function.
    local: dict[int, Any] = field(default_factory=dict)
    #: The same for the enclosing functions', which a nested function captures.
    parent: dict[int, Any] = field(default_factory=dict)
    #: A label's id → its IR label.
    loops: dict[int, Any] = field(default_factory=dict)
    #: The nodes lowered, kept alive so no id is reused while the maps hold it.
    alive: list[Any] = field(default_factory=list)
    output: EastType = NeverType

    def child(self, **changes: Any) -> _Ctx:
        base = _Ctx(dict(self.local), self.parent, self.loops, self.alive, self.output)
        for name, value in changes.items():
            setattr(base, name, value)
        return base


def _bind(ctx: _Ctx, var: A) -> Any:
    """A fresh IR variable for a variable node, in scope from here on."""
    ir = ir_variable(var.type, _fresh_name(), var.loc_id, bool(var.mutable), False)
    ctx.local[id(var)] = ir
    ctx.alive.append(var)
    return ir


def _with_type(declared: EastType, ast: A, ir: Any, loc_id: int) -> Any:
    """``ir``, cast to ``declared`` where its node's type differs."""
    return ir if type_equal(ast.type, declared) else coerce_to(ir, ast.type, declared, loc_id)


def _builtin_argument_types(name: str, type_parameters: list[EastType]) -> list[Any]:
    """Each argument's declared type: an East type, or ``None`` for a function (its own type stands)."""
    return [None if not isinstance(t, EastVariant) else t for t in builtin_inputs(name, list(type_parameters))]


def lower(ast: A, ctx: _Ctx | None = None) -> Any:  # noqa: C901
    """Lowers an AST node to IR, as ``ast_to_ir`` does: scopes resolved and values cast to their places."""
    if ctx is None:
        ctx = _Ctx()
    kind = ast.ast_type
    if kind == "IR":
        return ast.ir
    if kind == "Variable":
        hit = ctx.local.get(id(ast))
        if hit is not None:
            return hit
        hit = ctx.parent.get(id(ast))
        if hit is not None:
            return hit
        raise ValueError(f"Variable defined at loc_id {ast.loc_id} is out of scope here")
    if kind == "Let":
        value = lower(ast.value, ctx)
        var = _bind(ctx, ast.variable)
        value = _with_type(ast.variable.type, ast.value, value, ast.loc_id)
        return ir_let(ast.type, var, value, ast.loc_id)
    if kind == "Assign":
        var = lower(ast.variable, ctx)
        if not var.value["mutable"]:
            raise ValueError(f"Variable defined const is being reassigned at loc_id {ast.loc_id}")
        value = _with_type(ast.variable.type, ast.value, lower(ast.value, ctx), ast.loc_id)
        return ir_assign(ast.type, var, value, ast.loc_id)
    if kind == "Block":
        inner = ctx.child()
        statements = [lower(s, inner) for s in ast.statements]
        return _node("Block", type=ast.type, loc_id=ast.loc_id, statements=statements)
    if kind == "Builtin":
        declared = _builtin_argument_types(ast.builtin, ast.type_parameters)
        if len(declared) != len(ast.arguments):
            raise ValueError(f"Builtin function '{ast.builtin}' expected {len(declared)} arguments, "
                             f"got {len(ast.arguments)} at loc_id {ast.loc_id}")
        arguments = []
        for arg, expected in zip(ast.arguments, declared, strict=True):
            arg_ir = lower(arg, ctx)
            if expected is not None and arg.type.type != "Never" and not type_equal(arg.type, expected):
                arg_ir = coerce_to(arg_ir, arg.type, expected, ast.loc_id)
            arguments.append(arg_ir)
        return _node("Builtin", type=ast.type, loc_id=ast.loc_id, builtin=ast.builtin,
                     type_parameters=list(ast.type_parameters), arguments=arguments)
    if kind == "Platform":
        return _node("Platform", type=ast.type, loc_id=ast.loc_id, name=ast.name,
                     type_parameters=list(ast.type_parameters), arguments=[lower(a, ctx) for a in ast.arguments],
                     **{"async": bool(ast.is_async)}, optional=bool(ast.optional))
    if kind == "Struct":
        expected = {f["name"]: f["type"] for f in ast.type.value}
        fields: list[EastStruct] = []
        for name, field_ast in ast.fields.items():
            if name not in expected:
                raise ValueError(f"Struct type does not have field '{name}' at loc_id {ast.loc_id}")
            fields.append(EastStruct({
                "name": name, "value": _with_type(expected[name], field_ast, lower(field_ast, ctx), ast.loc_id)}))
        return _node("Struct", type=ast.type, loc_id=ast.loc_id, fields=fields)
    if kind == "GetField":
        return ir_get_field(ast.type, ast.field, lower(ast.struct, ctx), ast.loc_id)
    if kind == "Variant":
        cases = {c["name"]: c["type"] for c in ast.type.value}
        if ast.case not in cases:
            raise ValueError(f"Variant type does not have case '{ast.case}' at loc_id {ast.loc_id}")
        value = _with_type(cases[ast.case], ast.value, lower(ast.value, ctx), ast.loc_id)
        return ir_variant(ast.type, ast.case, value, ast.loc_id)
    if kind in ("Function", "AsyncFunction"):
        inner = _Ctx({}, {**ctx.parent, **ctx.local}, {}, ctx.alive, ast.type.value["output"])
        parameters = [_bind(inner, p) for p in ast.parameters]
        body = lower(ast.body, inner)
        free: dict[str, Any] = {}
        _free_vars(body, frozenset(p.value["name"] for p in parameters), free)
        return _node(kind, type=ast.type, loc_id=ast.loc_id, captures=list(free.values()), parameters=parameters,
                     body=body)
    if kind in ("Call", "CallAsync"):
        inputs = ast.function.type.value["inputs"]
        arguments = [_with_type(inputs[i], a, lower(a, ctx), ast.loc_id) for i, a in enumerate(ast.arguments)]
        return _node(kind, type=ast.type, loc_id=ast.loc_id, function=lower(ast.function, ctx), arguments=arguments)
    if kind == "NewRef":
        return ir_new_ref(ast.type, _with_type(ast.type.value, ast.value, lower(ast.value, ctx), ast.loc_id), ast.loc_id)
    if kind in ("NewArray", "NewSet", "NewVector", "NewMatrix"):
        element = ast.type.value
        values = [_with_type(element, v, lower(v, ctx), ast.loc_id) for v in ast.values]
        if kind == "NewMatrix":
            return _node(kind, type=ast.type, loc_id=ast.loc_id, values=values, rows=ast.rows, cols=ast.cols)
        return _node(kind, type=ast.type, loc_id=ast.loc_id, values=values)
    if kind == "NewDict":
        key_type = ast.type.value["key"]
        value_type = ast.type.value["value"]
        entries: list[EastStruct] = []
        for k, v in ast.values:
            entries.append(EastStruct({
                "key": _with_type(key_type, k, lower(k, ctx), ast.loc_id),
                "value": _with_type(value_type, v, lower(v, ctx), ast.loc_id),
            }))
        return _node("NewDict", type=ast.type, loc_id=ast.loc_id, values=entries)
    if kind == "IfElse":
        ifs: list[EastStruct] = []
        for predicate, body in ast.ifs:
            predicate_ir = lower(predicate, ctx)
            body_ir = lower(body, ctx.child())
            if body.type.type != "Never" and not type_equal(body.type, ast.type):
                body_ir = coerce_to(body_ir, body.type, ast.type, ast.loc_id)
            ifs.append(EastStruct({"predicate": predicate_ir, "body": body_ir}))
        else_ir = lower(ast.else_body, ctx.child())
        if ast.else_body.type.type != "Never" and not type_equal(ast.else_body.type, ast.type):
            else_ir = coerce_to(else_ir, ast.else_body.type, ast.type, ast.loc_id)
        return _node("IfElse", type=ast.type, loc_id=ast.loc_id, ifs=ifs, else_body=else_ir)
    if kind == "Error":
        return ir_error(NeverType, lower(ast.message, ctx), ast.loc_id)
    if kind == "TryCatch":
        try_ir = lower(ast.try_body, ctx.child())
        catch_ctx = ctx.child()
        message = _bind(catch_ctx, ast.message)
        stack = _bind(catch_ctx, ast.stack)
        catch_ir = lower(ast.catch_body, catch_ctx)
        finally_body = getattr(ast, "finally_body", None)
        finally_ir = lower(finally_body, ctx.child()) if finally_body is not None \
            else _value(NullType, None, ast.loc_id)
        return ir_trycatch(ast.type, try_ir, catch_ir, message, stack, finally_ir, ast.loc_id)
    if kind == "Value":
        return _value(ast.type, ast.value, ast.loc_id)
    if kind == "As":
        return coerce_to(lower(ast.value, ctx), ast.value.type, ast.type, ast.loc_id)
    if kind == "While":
        predicate = lower(ast.predicate, ctx)
        label = ir_label(_fresh_name(), ast.label.loc_id)
        inner = ctx.child(loops={**ctx.loops, id(ast.label): label})
        ctx.alive.append(ast.label)
        return ir_while(NullType, predicate, label, lower(ast.body, inner), ast.loc_id)
    if kind in ("ForArray", "ForSet", "ForDict"):
        source = lower(getattr(ast, {"ForArray": "array", "ForSet": "set", "ForDict": "dict"}[kind]), ctx)
        label = ir_label(_fresh_name(), ast.label.loc_id)
        inner = ctx.child(loops={**ctx.loops, id(ast.label): label})
        ctx.alive.append(ast.label)
        if kind == "ForSet":
            key = _bind(inner, ast.key)
            return ir_for_set(NullType, source, label, key, lower(ast.body, inner), ast.loc_id)
        value = _bind(inner, ast.value)
        key = _bind(inner, ast.key)
        make = ir_for_array if kind == "ForArray" else ir_for_dict
        return make(NullType, source, label, key, value, lower(ast.body, inner), ast.loc_id)
    if kind == "Match":
        subject = lower(ast.variant, ctx)
        cases = []
        for name, (var, body) in ast.cases.items():
            arm = ctx.child()
            var_ir = _bind(arm, var)
            body_ir = lower(body, arm)
            if body.type.type != "Never" and not type_equal(body.type, ast.type):
                body_ir = coerce_to(body_ir, body.type, ast.type, ast.loc_id)
            cases.append(EastStruct({"case": name, "variable": var_ir, "body": body_ir}))
        return _node("Match", type=ast.type, loc_id=ast.loc_id, variant=subject, cases=cases)
    if kind == "UnwrapRecursive":
        return ir_unwrap_recursive(ast.type, lower(ast.value, ctx), ast.loc_id)
    if kind == "WrapRecursive":
        return ir_wrap_recursive(ast.type, lower(ast.value, ctx), ast.loc_id)
    if kind in ("Break", "Continue"):
        label = ctx.loops.get(id(ast.label))
        if label is None:
            raise ValueError(f"Label defined at loc_id {ast.label.loc_id} is not in scope at loc_id {ast.loc_id}")
        return (ir_break if kind == "Break" else ir_continue)(NeverType, label, ast.loc_id)
    if kind == "Return":
        if not is_subtype(ast.value.type, ctx.output):
            raise TypeError(f"{print_type(ast.value.type)} is not a {print_type(ctx.output)} at loc_id {ast.loc_id}")
        return ir_return(NeverType, lower(ast.value, ctx), ast.loc_id)
    raise ValueError(f"Cannot lower {kind}")


def finalize_ir(ir: Any) -> Any:
    """The lowered IR as its final homoiconic value: every python-list child its ``EastArray``."""
    return _arrayify_tree(ir)


__all__ = ["A", "Label", "UNKNOWN_LOC_ID", "coerce_to", "external", "finalize_ir", "lower", "variable"]
