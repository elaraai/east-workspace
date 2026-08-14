#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Helper functions for building IR nodes as East variants.

IR nodes are East values (variants), not Python dataclasses. These helper
functions construct nodes conforming to the canonical ``IRType`` (the same
definition east-c pre-builds in ``type_of_type.c``), so malformed IR is
unrepresentable and a node tree compiles directly via
``east.runtime.compiler.compile_from_value``.

Locations use the v4 dialect: every node carries a ``loc_id`` integer
indexing into a source map held alongside the IR (0 when there is no
source map — e.g. traced kernels). ``location``/``location_stack`` build
the source-map ``Location`` structs themselves.

All IR struct values use EastStruct and all node arrays use EastArray, to
match ``IRType`` exactly.
"""

from datetime import datetime
from typing import Any

from east.types.type_of_type import (
    DictEntryType,
    EastTypeType,
    EastTypeValue,
    IfCaseType,
    IRType,
    LiteralValue,
    LocationType,
    MatchCaseType,
    StructFieldIRType,
)
from east.types.values import EastArray, EastStruct, EastVariant, east_null


def location(filename: str, line: int, column: int) -> EastStruct:
    """Create a source-map Location struct.

    Args:
        filename: Source filename
        line: Line number
        column: Column number

    Returns:
        Location EastStruct
    """
    return EastStruct({"filename": filename, "line": line, "column": column})


def location_stack(*locations: tuple[str, int, int]) -> EastArray:
    """Create a source-map location stack (EastArray of locations).

    Args:
        locations: Varargs of (filename, line, column) tuples

    Returns:
        EastArray of Location structs
    """
    return EastArray(LocationType, [location(f, ln, c) for f, ln, c in locations])


def ir_label(name: str, loc_id: int = 0) -> EastStruct:
    """Create an IR label struct.

    Args:
        name: Label name
        loc_id: Source map index (0 when there is no source map)

    Returns:
        IRLabel EastStruct
    """
    return EastStruct({"name": name, "loc_id": loc_id})


def literal_value(value: Any) -> LiteralValue:
    """Create a LiteralValue variant from a Python value.

    Args:
        value: Python value (None, bool, int, float, str, bytes, or datetime)

    Returns:
        LiteralValue variant
    """
    if value is None or value is east_null:
        return EastVariant("Null", east_null)
    if isinstance(value, bool):
        return EastVariant("Boolean", value)
    if isinstance(value, int):
        return EastVariant("Integer", value)
    if isinstance(value, float):
        return EastVariant("Float", value)
    if isinstance(value, str):
        return EastVariant("String", value)
    if isinstance(value, bytes):
        return EastVariant("Blob", value)
    if isinstance(value, datetime):
        return EastVariant("DateTime", value)
    raise TypeError(f"Cannot convert {type(value)} to LiteralValue")


def ir_value(typ: EastTypeValue, value: Any, loc_id: int = 0):
    """Create a Value IR node holding a literal."""
    return EastVariant("Value", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "value": literal_value(value),
    }))


def ir_variable(
    typ: EastTypeValue,
    name: str,
    loc_id: int = 0,
    mutable: bool = False,
    captured: bool = False,
):
    """Create a Variable IR node."""
    return EastVariant("Variable", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "name": name,
        "mutable": mutable,
        "captured": captured,
    }))


def ir_builtin(
    typ: EastTypeValue,
    builtin_name: str,
    type_parameters: list[EastTypeValue],
    arguments: list,
    loc_id: int = 0,
):
    """Create a Builtin IR node."""
    return EastVariant("Builtin", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "builtin": builtin_name,
        "type_parameters": EastArray(EastTypeType, type_parameters),
        "arguments": EastArray(IRType, arguments),
    }))


def ir_platform(
    typ: EastTypeValue,
    platform_name: str,
    arguments: list,
    async_: bool = False,
    type_parameters: list[EastTypeValue] | None = None,
    loc_id: int = 0,
):
    """Create a Platform IR node."""
    return EastVariant("Platform", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "name": platform_name,
        "type_parameters": EastArray(EastTypeType, type_parameters if type_parameters else []),
        "arguments": EastArray(IRType, arguments),
        "async": async_,
    }))


def ir_function(
    typ: EastTypeValue,
    captures: list,
    parameters: list,
    body,
    loc_id: int = 0,
):
    """Create a Function IR node."""
    return EastVariant("Function", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "captures": EastArray(IRType, captures),
        "parameters": EastArray(IRType, parameters),
        "body": body,
    }))


def ir_async_function(
    typ: EastTypeValue,
    captures: list,
    parameters: list,
    body,
    loc_id: int = 0,
):
    """Create an AsyncFunction IR node."""
    return EastVariant("AsyncFunction", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "captures": EastArray(IRType, captures),
        "parameters": EastArray(IRType, parameters),
        "body": body,
    }))


def ir_call(
    typ: EastTypeValue,
    function,
    arguments: list,
    loc_id: int = 0,
):
    """Create a Call IR node invoking ``function`` (an IR node evaluating to
    a function value) with ``arguments``."""
    return EastVariant("Call", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "function": function,
        "arguments": EastArray(IRType, arguments),
    }))


def ir_call_async(
    typ: EastTypeValue,
    function,
    arguments: list,
    loc_id: int = 0,
):
    """Create a CallAsync IR node."""
    return EastVariant("CallAsync", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "function": function,
        "arguments": EastArray(IRType, arguments),
    }))


def ir_new_ref(typ: EastTypeValue, value, loc_id: int = 0):
    """Create a NewRef IR node."""
    return EastVariant("NewRef", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "value": value,
    }))


def ir_let(typ: EastTypeValue, variable, value, loc_id: int = 0):
    """Create a Let IR node binding ``variable`` to ``value``."""
    return EastVariant("Let", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "variable": variable,
        "value": value,
    }))


def ir_get_field(typ: EastTypeValue, field: str, struct, loc_id: int = 0):
    """Create a GetField IR node reading ``field`` from ``struct``."""
    return EastVariant("GetField", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "field": field,
        "struct": struct,
    }))


def ir_new_array(typ: EastTypeValue, values: list, loc_id: int = 0):
    """Create a NewArray IR node constructing an array from ``values``."""
    return EastVariant("NewArray", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "values": EastArray(IRType, values),
    }))


def ir_new_set(typ: EastTypeValue, values: list, loc_id: int = 0):
    """Create a NewSet IR node constructing a set from ``values``."""
    return EastVariant("NewSet", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "values": EastArray(IRType, values),
    }))


def ir_new_dict(typ: EastTypeValue, entries: list[tuple[Any, Any]], loc_id: int = 0):
    """Create a NewDict IR node from ``(key_node, value_node)`` entries."""
    entry_structs: list[EastStruct] = [EastStruct({"key": k, "value": v}) for k, v in entries]
    return EastVariant("NewDict", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "values": EastArray(DictEntryType, entry_structs),
    }))


def ir_struct(typ: EastTypeValue, fields: list[tuple[str, Any]], loc_id: int = 0):
    """Create a Struct construction IR node from ``(name, value_node)`` fields."""
    field_structs: list[EastStruct] = [EastStruct({"name": n, "value": v}) for n, v in fields]
    return EastVariant("Struct", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "fields": EastArray(StructFieldIRType, field_structs),
    }))


def ir_variant(typ: EastTypeValue, case: str, value, loc_id: int = 0):
    """Create a Variant construction IR node for ``case`` holding ``value``."""
    return EastVariant("Variant", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "case": case,
        "value": value,
    }))


def ir_match(typ: EastTypeValue, variant, cases: list[tuple[str, Any, Any]], loc_id: int = 0):
    """Create a Match IR node from ``(case, variable_node, body_node)`` cases."""
    case_structs: list[EastStruct] = [
        EastStruct({"case": c, "variable": var, "body": body}) for c, var, body in cases
    ]
    return EastVariant("Match", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "variant": variant,
        "cases": EastArray(MatchCaseType, case_structs),
    }))


def ir_error(typ: EastTypeValue, message, loc_id: int = 0):
    """Create an Error IR node raising ``message`` (an IR node) at run time."""
    return EastVariant("Error", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "message": message,
    }))


def ir_block(typ: EastTypeValue, statements: list, loc_id: int = 0):
    """Create a Block IR node."""
    return EastVariant("Block", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "statements": EastArray(IRType, statements),
    }))


def ir_ifelse(
    typ: EastTypeValue,
    ifs: list[tuple],
    else_body,
    loc_id: int = 0,
):
    """Create an IfElse IR node from ``(predicate, body)`` pairs."""
    if_cases: list = []
    for predicate, body in ifs:
        if_cases.append(EastStruct({"predicate": predicate, "body": body}))

    return EastVariant("IfElse", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "ifs": EastArray(IfCaseType, if_cases),
        "else_body": else_body,
    }))


def ir_while(typ: EastTypeValue, predicate, label, body, loc_id: int = 0):
    """Create a While IR node."""
    if isinstance(label, dict):
        label = EastStruct(label)
    return EastVariant("While", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "predicate": predicate,
        "label": label,
        "body": body,
    }))


def ir_trycatch(
    typ: EastTypeValue,
    try_body,
    catch_body,
    message_var,
    stack_var,
    finally_body=None,
    loc_id: int = 0,
):
    """Create a TryCatch IR node."""
    from east.types.types import NullType
    from east.types.values import EastNull

    if finally_body is None:
        finally_body = ir_value(NullType, EastNull(), loc_id)

    return EastVariant("TryCatch", EastStruct({
        "type": typ,
        "loc_id": loc_id,
        "try_body": try_body,
        "catch_body": catch_body,
        "message": message_var,
        "stack": stack_var,
        "finally_body": finally_body,
    }))


__all__ = [
    "location",
    "location_stack",
    "ir_label",
    "literal_value",
    "ir_value",
    "ir_variable",
    "ir_builtin",
    "ir_platform",
    "ir_function",
    "ir_async_function",
    "ir_call",
    "ir_call_async",
    "ir_new_ref",
    "ir_let",
    "ir_get_field",
    "ir_new_array",
    "ir_new_set",
    "ir_new_dict",
    "ir_struct",
    "ir_variant",
    "ir_match",
    "ir_error",
    "ir_block",
    "ir_ifelse",
    "ir_while",
    "ir_trycatch",
]
