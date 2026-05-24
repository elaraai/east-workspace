#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Helper functions for building IR nodes as East variants.

IR nodes are East values (variants), not Python dataclasses. These helper functions
make it easier to construct IR variants programmatically.

All IR struct values use EastStruct, all arrays use EastArray, and location fields
are EastArray (location stack) to match the canonical IRType definition in east-c.
"""

from datetime import datetime
from typing import Any

from east.types.type_of_type import (
    EastTypeType,
    EastTypeValue,
    IfCaseType,
    IRType,
    LiteralValue,
)
from east.types.values import EastArray, EastStruct, EastVariant, east_null


def location(filename: str, line: int, column: int) -> EastStruct:
    """Create a Location struct.

    Args:
        filename: Source filename
        line: Line number
        column: Column number

    Returns:
        Location EastStruct
    """
    return EastStruct({"filename": filename, "line": line, "column": column})


def location_stack(*locations: tuple[str, int, int]) -> EastArray:
    """Create a location stack (EastArray of locations).

    Args:
        locations: Varargs of (filename, line, column) tuples

    Returns:
        EastArray of LocationValue structs
    """
    from east.types.type_of_type import LocationType

    return EastArray(LocationType, [location(f, ln, c) for f, ln, c in locations])


def make_loc_array(loc) -> EastArray:
    """Wrap a location (EastStruct, dict, or EastArray) into an EastArray.

    The IRType defines location as Array(LocationStruct). This helper normalises
    whatever the caller passes into the canonical form.
    """
    from east.types.type_of_type import LocationType

    if isinstance(loc, EastArray):
        return loc
    if isinstance(loc, (dict, EastStruct)):
        if isinstance(loc, dict):
            loc = EastStruct(loc)
        return EastArray(LocationType, [loc])
    return EastArray(LocationType, [loc])


def ir_label(name: str, loc: EastArray) -> EastStruct:
    """Create an IR label struct.

    Args:
        name: Label name
        loc: EastArray of locations

    Returns:
        IRLabel EastStruct
    """
    return EastStruct({"name": name, "location": make_loc_array(loc)})


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


def ir_value(typ: EastTypeValue, loc, value: Any):
    """Create a Value IR node."""
    return EastVariant("Value", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "value": literal_value(value),
    }))


def ir_variable(typ: EastTypeValue, name: str, loc, mutable: bool = False, captured: bool = False):
    """Create a Variable IR node."""
    return EastVariant("Variable", EastStruct({
        "type": typ,
        "name": name,
        "location": make_loc_array(loc),
        "mutable": mutable,
        "captured": captured,
    }))


def ir_builtin(
    typ: EastTypeValue,
    loc,
    builtin_name: str,
    type_parameters: list[EastTypeValue],
    arguments: list,
):
    """Create a Builtin IR node."""
    return EastVariant("Builtin", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "builtin": builtin_name,
        "type_parameters": EastArray(EastTypeType, type_parameters),
        "arguments": EastArray(IRType, arguments),
    }))


def ir_platform(
    typ: EastTypeValue,
    loc,
    platform_name: str,
    arguments: list,
    async_: bool = False,
    type_parameters: list[EastTypeValue] | None = None,
):
    """Create a Platform IR node."""
    return EastVariant("Platform", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "name": platform_name,
        "type_parameters": EastArray(EastTypeType, type_parameters if type_parameters else []),
        "arguments": EastArray(IRType, arguments),
        "async": async_,
    }))


def ir_function(
    typ: EastTypeValue,
    loc,
    captures: list,
    parameters: list,
    body,
):
    """Create a Function IR node."""
    return EastVariant("Function", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "captures": EastArray(IRType, captures),
        "parameters": EastArray(IRType, parameters),
        "body": body,
    }))


def ir_async_function(
    typ: EastTypeValue,
    loc,
    captures: list,
    parameters: list,
    body,
):
    """Create an AsyncFunction IR node."""
    return EastVariant("AsyncFunction", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "captures": EastArray(IRType, captures),
        "parameters": EastArray(IRType, parameters),
        "body": body,
    }))


def ir_call_async(
    typ: EastTypeValue,
    loc,
    function,
    arguments: list,
):
    """Create a CallAsync IR node."""
    return EastVariant("CallAsync", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "function": function,
        "arguments": EastArray(IRType, arguments),
    }))


def ir_new_ref(typ: EastTypeValue, loc, value):
    """Create a NewRef IR node."""
    return EastVariant("NewRef", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "value": value,
    }))


def ir_block(typ: EastTypeValue, loc, statements: list):
    """Create a Block IR node."""
    return EastVariant("Block", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "statements": EastArray(IRType, statements),
    }))


def ir_ifelse(
    typ: EastTypeValue,
    loc,
    ifs: list[tuple],
    else_body,
):
    """Create an IfElse IR node."""
    if_cases: list = []
    for predicate, body in ifs:
        if_cases.append(EastStruct({"predicate": predicate, "body": body}))

    return EastVariant("IfElse", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "ifs": EastArray(IfCaseType, if_cases),
        "else_body": else_body,
    }))


def ir_while(typ: EastTypeValue, loc, predicate, label, body):
    """Create a While IR node."""
    if isinstance(label, dict):
        label = EastStruct(label)
    return EastVariant("While", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "predicate": predicate,
        "label": label,
        "body": body,
    }))


def ir_trycatch(
    typ: EastTypeValue,
    loc,
    try_body,
    catch_body,
    message_var,
    stack_var,
    finally_body=None,
):
    """Create a TryCatch IR node."""
    from east.types.types import NullType
    from east.types.values import EastNull

    if finally_body is None:
        finally_body = ir_value(NullType, loc, EastNull())

    return EastVariant("TryCatch", EastStruct({
        "type": typ,
        "location": make_loc_array(loc),
        "try_body": try_body,
        "catch_body": catch_body,
        "message": message_var,
        "stack": stack_var,
        "finally_body": finally_body,
    }))


__all__ = [
    "location",
    "location_stack",
    "make_loc_array",
    "ir_label",
    "literal_value",
    "ir_value",
    "ir_variable",
    "ir_builtin",
    "ir_platform",
    "ir_function",
    "ir_new_ref",
    "ir_block",
    "ir_ifelse",
    "ir_while",
    "ir_trycatch",
]
