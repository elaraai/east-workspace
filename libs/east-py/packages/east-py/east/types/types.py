#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East type system using TypedDict.

Types are plain dicts at runtime, with TypedDict providing static type hints.
This matches TypeScript's approach exactly while maintaining Python type safety.
"""

from __future__ import annotations

from typing import Any, Literal, TypeAlias, TypedDict, TypeGuard

from east.types.values import EastVariant

# =============================================================================
# TypedDict Definitions for Type System
# =============================================================================


class NullTypeDef(TypedDict):
    """Null type - unit type with single value."""

    type: Literal["Null"]
    value: None  # Always east_null in JSON


class BooleanTypeDef(TypedDict):
    """Boolean type - true or false."""

    type: Literal["Boolean"]
    value: None  # Always east_null in JSON


class IntegerTypeDef(TypedDict):
    """Integer type - arbitrary precision integers."""

    type: Literal["Integer"]
    value: None  # Always east_null in JSON


class FloatTypeDef(TypedDict):
    """Float type - 64-bit floating point."""

    type: Literal["Float"]
    value: None  # Always east_null in JSON


class StringTypeDef(TypedDict):
    """String type - UTF-8 text."""

    type: Literal["String"]
    value: None  # Always east_null in JSON


class BlobTypeDef(TypedDict):
    """Blob type - immutable binary data."""

    type: Literal["Blob"]
    value: None  # Always east_null in JSON


class DateTimeTypeDef(TypedDict):
    """DateTime type - UTC timestamps."""

    type: Literal["DateTime"]
    value: None  # Always east_null in JSON


class NeverTypeDef(TypedDict):
    """Never type - bottom type (no values)."""

    type: Literal["Never"]
    value: None  # Always east_null in JSON


class ArrayTypeDef(TypedDict):
    """Array type - mutable ordered collection."""

    type: Literal["Array"]
    value: EastType  # Element type


class VectorTypeDef(TypedDict):
    """Vector type - contiguous 1D numeric array."""

    type: Literal["Vector"]
    value: EastType  # Element type (must be Float, Integer, or Boolean)


class MatrixTypeDef(TypedDict):
    """Matrix type - contiguous 2D numeric array (row-major)."""

    type: Literal["Matrix"]
    value: EastType  # Element type (must be Float, Integer, or Boolean)


class SetTypeDef(TypedDict):
    """Set type - mutable unordered collection of unique values."""

    type: Literal["Set"]
    value: EastType  # Element type


class DictValueTypeDef(TypedDict):
    """Dict type value (key and value types)."""

    key: EastType
    value: EastType


class DictTypeDef(TypedDict):
    """Dict type - mutable key-value mapping."""

    type: Literal["Dict"]
    value: DictValueTypeDef


class RefTypeDef(TypedDict):
    """Ref type - mutable reference cell."""

    type: Literal["Ref"]
    value: EastType  # Type of referenced value


class StructFieldDef(TypedDict):
    """Struct field definition."""

    name: str
    type: EastType


class StructTypeDef(TypedDict):
    """Struct type - product type with named fields."""

    type: Literal["Struct"]
    value: list[StructFieldDef]


class VariantCaseDef(TypedDict):
    """Variant case definition."""

    name: str
    type: EastType


class VariantTypeDef(TypedDict):
    """Variant type - sum type with tagged cases."""

    type: Literal["Variant"]
    value: list[VariantCaseDef]


class FunctionTypeDef(TypedDict):
    """Function type."""

    type: Literal["Function"]
    value: FunctionTypeValue


class FunctionTypeValue(TypedDict):
    """Function type value (inputs, output)."""

    inputs: list[EastType]
    output: EastType


class AsyncFunctionTypeDef(TypedDict):
    """Async Function type."""

    type: Literal["AsyncFunction"]
    value: AsyncFunctionTypeValue


class AsyncFunctionTypeValue(TypedDict):
    """Async Function type value (inputs, output)."""

    inputs: list[EastType]
    output: EastType


class RecursiveTypeDef(TypedDict):
    """Recursive type reference."""

    type: Literal["Recursive"]
    value: int  # Marker ID


# EastType is EastVariant - types are homoiconic (types are values)
# Type cases: Never, Null, Boolean, Integer, Float, String, DateTime, Blob,
#             Ref, Array, Set, Dict, Struct, Variant, Function, AsyncFunction, Recursive
EastType: TypeAlias = EastVariant


# =============================================================================
# Type Constructors (return EastVariant)
# =============================================================================

# Primitive types (singletons)
NullType: EastVariant = EastVariant("Null", None)
BooleanType: EastVariant = EastVariant("Boolean", None)
IntegerType: EastVariant = EastVariant("Integer", None)
FloatType: EastVariant = EastVariant("Float", None)
StringType: EastVariant = EastVariant("String", None)
BlobType: EastVariant = EastVariant("Blob", None)
DateTimeType: EastVariant = EastVariant("DateTime", None)
NeverType: EastVariant = EastVariant("Never", None)


# =============================================================================
# Type interning — ensures structurally identical composite types share identity.
#
# Mirrors the TS reference (`libs/east/src/types.ts`): TS memoizes its type
# constructors so that structurally-equal types are the SAME object. The beast2
# value encoder dedups by object identity, so without interning a repeated
# sub-structure (e.g. an Option appearing in two struct fields) would be emitted
# twice instead of once + backref, diverging from the canonical TS encoding.
#
# We hash a per-kind tag combined with child hashes (FNV-1a style hashCombine),
# then verify structural equality on lookup. Recursive markers are NOT interned
# (cyclic structures are hashed by tag/marker only and never recursed into);
# primitives are already module singletons above.
# =============================================================================

_FNV_PRIME = 0x01000193
_FNV_MASK = 0xFFFFFFFF

# Per-kind tags, mirroring the byte tags used by the TS reference where they
# overlap; the exact values are arbitrary but must be stable.
_KIND_TAGS: dict[str, int] = {
    "Null": 0x00,
    "Boolean": 0x01,
    "Integer": 0x02,
    "Float": 0x03,
    "String": 0x04,
    "Blob": 0x05,
    "DateTime": 0x06,
    "Never": 0x07,
    "Variant": 0x08,
    "Struct": 0x09,
    "Array": 0x41,
    "Function": 0x46,
    "AsyncFunction": 0x47,
    "Set": 0x53,
    "Ref": 0x52,
    "Dict": 0x44,
    "Vector": 0x56,
    "Matrix": 0x4D,
    "Recursive": 0x72,
}

# Intern table: structural hash -> EastVariant, or list[EastVariant] on collision.
_intern: dict[int, Any] = {}


def _hash_combine(h: int, v: int) -> int:
    """Combine an accumulator hash with a value (FNV-1a style)."""
    return ((h ^ (v & _FNV_MASK)) * _FNV_PRIME) & _FNV_MASK


def _type_hash(t: Any) -> int:
    """Compute a structural hash of an East type (EastVariant).

    Recurses through child types, combining a per-kind tag with child hashes.
    Recursive markers are hashed by tag + marker only (never recursed into) to
    keep this finite on cyclic structures.
    """
    kind = t.type
    h = _hash_combine(0, _KIND_TAGS.get(kind, hash(kind) & _FNV_MASK))
    value = t.value
    if kind in ("Array", "Vector", "Matrix", "Set", "Ref"):
        # Single child type.
        return _hash_combine(h, _type_hash(value))
    if kind == "Dict":
        h = _hash_combine(h, _type_hash(value["key"]))
        return _hash_combine(h, _type_hash(value["value"]))
    if kind in ("Struct", "Variant"):
        for member in value:
            h = _hash_combine(h, hash(member["name"]) & _FNV_MASK)
            h = _hash_combine(h, _type_hash(member["type"]))
        return h
    if kind in ("Function", "AsyncFunction"):
        for inp in value["inputs"]:
            h = _hash_combine(h, _type_hash(inp))
        return _hash_combine(h, _type_hash(value["output"]))
    if kind == "Recursive":
        # Hash the marker only; do not recurse into the (cyclic) body.
        return _hash_combine(h, (value if isinstance(value, int) else 0) & _FNV_MASK)
    # Primitive: tag only.
    return h


def _intern_type(built: EastVariant) -> EastVariant:
    """Return the canonical interned instance structurally equal to ``built``.

    Stores and returns ``built`` if no structural match exists yet, chaining
    into a list on hash collision. Uses EastVariant structural ``==`` to verify
    a candidate (correct and finite for non-cyclic types).
    """
    h = _type_hash(built)
    entry = _intern.get(h)
    if entry is None:
        _intern[h] = built
        return built
    if isinstance(entry, list):
        for candidate in entry:
            if candidate == built:
                return candidate
        entry.append(built)
        return built
    if entry == built:
        return entry
    _intern[h] = [entry, built]
    return built


def ArrayType(element_type: EastType) -> EastVariant[EastType]:
    """Create an array type.

    Args:
        element_type: Type of array elements

    Returns:
        Array type
    """
    return _intern_type(EastVariant("Array", element_type))


_VECTOR_ELEMENT_TYPES = frozenset({"Float", "Integer", "Boolean"})


def VectorType(element_type: EastType) -> EastVariant[EastType]:
    """Create a vector type.

    Args:
        element_type: Type of vector elements (must be Float, Integer, or Boolean)

    Returns:
        Vector type

    Raises:
        TypeError: If element_type is not Float, Integer, or Boolean
    """
    if element_type.type not in _VECTOR_ELEMENT_TYPES:
        from east.serialization.east_printer import print_type

        raise TypeError(
            f"Vector element type must be Float, Integer, or Boolean, got {print_type(element_type)}"
        )
    return _intern_type(EastVariant("Vector", element_type))


def MatrixType(element_type: EastType) -> EastVariant[EastType]:
    """Create a matrix type.

    Args:
        element_type: Type of matrix elements (must be Float, Integer, or Boolean)

    Returns:
        Matrix type

    Raises:
        TypeError: If element_type is not Float, Integer, or Boolean
    """
    if element_type.type not in _VECTOR_ELEMENT_TYPES:
        from east.serialization.east_printer import print_type

        raise TypeError(
            f"Matrix element type must be Float, Integer, or Boolean, got {print_type(element_type)}"
        )
    return _intern_type(EastVariant("Matrix", element_type))


def SetType(element_type: EastType) -> EastVariant[EastType]:
    """Create a set type.

    Args:
        element_type: Type of set elements (must be immutable)

    Returns:
        Set type

    Raises:
        TypeError: If element_type is not immutable
    """
    if not is_immutable_type(element_type):
        from east.serialization.east_printer import print_type

        raise TypeError(f"Set key type must be an immutable type, got {print_type(element_type)}")
    return _intern_type(EastVariant("Set", element_type))


def DictType(key_type: EastType, value_type: EastType) -> EastVariant[DictValueTypeDef]:
    """Create a dictionary type.

    Args:
        key_type: Type of dictionary keys (must be immutable)
        value_type: Type of dictionary values

    Returns:
        Dict type

    Raises:
        TypeError: If key_type is not immutable
    """
    if not is_immutable_type(key_type):
        from east.serialization.east_printer import print_type

        raise TypeError(f"Dict key type must be an immutable type, got {print_type(key_type)}")
    return _intern_type(EastVariant("Dict", {"key": key_type, "value": value_type}))


def RefType(value_type: EastType) -> EastVariant[EastType]:
    """Create a reference type.

    Args:
        value_type: Type of referenced value

    Returns:
        Ref type
    """
    return _intern_type(EastVariant("Ref", value_type))


def StructType(fields: list[tuple[str, EastType]]) -> EastVariant[list[StructFieldDef]]:
    """Create a struct type.

    Args:
        fields: List of (field_name, field_type) tuples

    Returns:
        Struct type
    """
    field_defs: list[StructFieldDef] = []
    for name, field_type in fields:
        field_defs.append({"name": name, "type": field_type})

    return _intern_type(EastVariant("Struct", field_defs))


def VariantType(cases: list[tuple[str, EastType]]) -> EastVariant[list[VariantCaseDef]]:
    """Create a variant type.

    Args:
        cases: List of (case_name, case_type) tuples

    Returns:
        Variant type

    Raises:
        ValueError: If case names are not unique
    """
    # Check for duplicate case names
    case_names_list = [name for name, _ in cases]
    if len(case_names_list) != len(set(case_names_list)):
        raise ValueError(f"Variant case names must be unique, got {case_names_list}")

    case_defs: list[VariantCaseDef] = []
    for name, case_type in cases:
        case_defs.append({"name": name, "type": case_type})

    # Sort cases alphabetically by name
    case_defs.sort(key=lambda c: c["name"])

    return _intern_type(EastVariant("Variant", case_defs))


def FunctionType(inputs: list[EastType], output: EastType) -> EastVariant[FunctionTypeValue]:
    """Create a function type.

    Args:
        inputs: List of input parameter types
        output: Output return type

    Returns:
        Function type
    """
    return _intern_type(EastVariant("Function", {"inputs": inputs, "output": output}))


def AsyncFunctionType(
    inputs: list[EastType], output: EastType
) -> EastVariant[AsyncFunctionTypeValue]:
    """Create an async function type.

    Args:
        inputs: List of input parameter types
        output: Output return type

    Returns:
        AsyncFunction type
    """
    return _intern_type(EastVariant("AsyncFunction", {"inputs": inputs, "output": output}))


def RecursiveTypeRef(marker: int) -> EastVariant[int]:
    """Create a recursive type reference.

    Args:
        marker: Recursive type marker ID

    Returns:
        Recursive type reference
    """
    return EastVariant("Recursive", marker)


def RecursiveType(builder: Any) -> EastType:
    """Build a recursive type with integer scope_ids.

    This is an alias for recursive_type() that matches TypeScript's naming convention.

    Args:
        builder: Function that takes a self-reference and returns the node type

    Returns:
        A type where all self-references use integer scope_ids

    Example:
        ListType = RecursiveType(
            lambda self: VariantType([
                ("nil", NullType),
                ("cons", StructType([("head", IntegerType), ("tail", self)]))
            ])
        )
    """
    return recursive_type(builder)


# =============================================================================
# Type Aliases for Specific Type Variants
# =============================================================================

# These aliases match the return types of the type constructors above.
# Use them for function parameters that expect a specific type kind.

ArrayTypeAlias: TypeAlias = EastVariant[EastType]
"""Type alias for Array types. Value is the element type."""

SetTypeAlias: TypeAlias = EastVariant[EastType]
"""Type alias for Set types. Value is the element type."""

RefTypeAlias: TypeAlias = EastVariant[EastType]
"""Type alias for Ref types. Value is the inner type."""

DictTypeAlias: TypeAlias = EastVariant[DictValueTypeDef]
"""Type alias for Dict types. Value has 'key' and 'value' fields."""

StructTypeAlias: TypeAlias = EastVariant[list[StructFieldDef]]
"""Type alias for Struct types. Value is list of field definitions."""

VariantTypeAlias: TypeAlias = EastVariant[list[VariantCaseDef]]
"""Type alias for Variant types. Value is list of case definitions."""

FunctionTypeAlias: TypeAlias = EastVariant[FunctionTypeValue]
"""Type alias for Function types. Value has 'inputs', 'output', 'platforms'."""

RecursiveTypeAlias: TypeAlias = EastVariant[int]
"""Type alias for Recursive type references. Value is the depth."""

VectorTypeAlias: TypeAlias = EastVariant[EastType]
"""Type alias for Vector types. Value is the element type."""

MatrixTypeAlias: TypeAlias = EastVariant[EastType]
"""Type alias for Matrix types. Value is the element type."""


# =============================================================================
# Helper Functions for Working with Types
# =============================================================================


def field_names(struct_type: EastVariant[list[StructFieldDef]]) -> list[str]:
    """Get field names from a Struct type.

    Args:
        struct_type: Struct type

    Returns:
        List of field names
    """
    return [field["name"] for field in struct_type.value]


def field_types(struct_type: EastVariant[list[StructFieldDef]]) -> list[EastType]:
    """Get field types from a Struct type.

    Args:
        struct_type: Struct type

    Returns:
        List of field types
    """
    return [field["type"] for field in struct_type.value]


def field_index(struct_type: EastVariant[list[StructFieldDef]], name: str) -> int:
    """Get field index by name for Struct types.

    Args:
        struct_type: Struct type
        name: Field name

    Returns:
        Index of field

    Raises:
        KeyError: If field not found
    """
    for i, field in enumerate(struct_type.value):
        if field["name"] == name:
            return i
    raise KeyError(f"No field named '{name}'")


def case_names(variant_type: EastVariant[list[VariantCaseDef]]) -> list[str]:
    """Get case names from a Variant type.

    Args:
        variant_type: Variant type

    Returns:
        List of case names
    """
    return [case["name"] for case in variant_type.value]


def case_types(variant_type: EastVariant[list[VariantCaseDef]]) -> list[EastType]:
    """Get case types from a Variant type.

    Args:
        variant_type: Variant type

    Returns:
        List of case types
    """
    return [case["type"] for case in variant_type.value]


def case_type(variant_type: EastVariant[list[VariantCaseDef]], name: str) -> EastType:
    """Get type of a case by name for Variant types.

    Args:
        variant_type: Variant type
        name: Case name

    Returns:
        Type of the case

    Raises:
        KeyError: If case not found
    """
    for case in variant_type.value:
        if case["name"] == name:
            return case["type"]
    raise KeyError(f"No case named '{name}'")


# Type checking helpers with TypeGuard for type narrowing


# Primitive types
def is_null_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is a Null type."""
    return typ.type == "Null"


def is_boolean_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is a Boolean type."""
    return typ.type == "Boolean"


def is_integer_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is an Integer type."""
    return typ.type == "Integer"


def is_float_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is a Float type."""
    return typ.type == "Float"


def is_string_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is a String type."""
    return typ.type == "String"


def is_blob_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is a Blob type."""
    return typ.type == "Blob"


def is_datetime_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is a DateTime type."""
    return typ.type == "DateTime"


def is_never_type(typ: EastType) -> TypeGuard[EastVariant[None]]:
    """Check if a type is a Never type."""
    return typ.type == "Never"


# Numeric container types
def is_vector_type(typ: EastType) -> TypeGuard[EastVariant[EastType]]:
    """Check if a type is a Vector type."""
    return typ.type == "Vector"


def is_matrix_type(typ: EastType) -> TypeGuard[EastVariant[EastType]]:
    """Check if a type is a Matrix type."""
    return typ.type == "Matrix"


# Container types
def is_ref_type(typ: EastType) -> TypeGuard[EastVariant[EastType]]:
    """Check if a type is a Ref type."""
    return typ.type == "Ref"


def is_array_type(typ: EastType) -> TypeGuard[EastVariant[EastType]]:
    """Check if a type is an Array type."""
    return typ.type == "Array"


def is_set_type(typ: EastType) -> TypeGuard[EastVariant[EastType]]:
    """Check if a type is a Set type."""
    return typ.type == "Set"


def is_dict_type(typ: EastType) -> TypeGuard[EastVariant[DictValueTypeDef]]:
    """Check if a type is a Dict type."""
    return typ.type == "Dict"


# Structural types
def is_struct_type(typ: EastType) -> TypeGuard[EastVariant[list[StructFieldDef]]]:
    """Check if a type is a Struct type."""
    return typ.type == "Struct"


def is_variant_type(typ: EastType) -> TypeGuard[EastVariant[list[VariantCaseDef]]]:
    """Check if a type is a Variant type."""
    return typ.type == "Variant"


# Function and recursive types
def is_function_type(typ: EastType) -> TypeGuard[EastVariant[FunctionTypeValue]]:
    """Check if a type is a Function type."""
    return typ.type == "Function"


def is_async_function_type(typ: EastType) -> TypeGuard[EastVariant[AsyncFunctionTypeValue]]:
    """Check if a type is an AsyncFunction type."""
    return typ.type == "AsyncFunction"


def is_recursive_type(typ: EastType) -> TypeGuard[EastVariant[int]]:
    """Check if a type is a Recursive type reference."""
    return typ.type == "Recursive"


# Option type helpers


def is_option_type(typ: EastType) -> bool:
    """Check if type is Option (Variant with exactly 'none' and 'some' cases).

    OptionType is syntactic sugar for VariantType([("none", NullType), ("some", T)]).

    Args:
        typ: Type to check

    Returns:
        True if this is an Option type, False otherwise
    """
    if not is_variant_type(typ):
        return False
    cases = typ.value
    if len(cases) != 2:
        return False
    # Variant cases are sorted alphabetically: none at 0, some at 1
    return cases[0]["name"] == "none" and cases[1]["name"] == "some"


def get_option_inner_type(typ: EastType) -> EastType:
    """Get the inner type of an OptionType (the 'some' case type).

    Args:
        typ: An OptionType

    Returns:
        The type wrapped by the Option (the 'some' case type)

    Raises:
        ValueError: If typ is not an OptionType
    """
    if not is_option_type(typ):
        raise ValueError("Not an OptionType")
    # 'some' is at index 1 (alphabetically sorted)
    return typ.value[1]["type"]


# =============================================================================
# Type Predicates
# =============================================================================


def is_data_type(typ: EastType, recursive_type: EastType | None = None) -> bool:
    """Check if a type is a data type (non-function).

    Data types exclude functions (sync and async) but include all other types.
    Used to validate type parameters that must be serializable.

    Args:
        typ: Type to check
        recursive_type: Internal parameter for cycle detection

    Returns:
        True if the type is a data type, False otherwise
    """
    # Avoid infinite loops in recursive types
    if recursive_type is not None and typ == recursive_type:
        return True

    if is_function_type(typ) or is_async_function_type(typ):
        return False
    if is_ref_type(typ) or is_array_type(typ) or is_set_type(typ) or is_dict_type(typ):
        # Container constructors already validate inner types
        return True
    if is_vector_type(typ) or is_matrix_type(typ):
        return True
    if is_struct_type(typ):
        return all(is_data_type(field["type"], recursive_type) for field in typ.value)
    if is_variant_type(typ):
        return all(is_data_type(case["type"], recursive_type) for case in typ.value)
    if is_recursive_type(typ):
        return True
    # Primitive types are data types
    return True


def is_immutable_type(typ: EastType, recursive_type: EastType | None = None) -> bool:
    """Check if a type is immutable.

    Immutable types exclude mutable collections (Array, Set, Dict) and functions.
    Used to validate key types for Set and Dict.

    Args:
        typ: Type to check
        recursive_type: Internal parameter for cycle detection

    Returns:
        True if the type is immutable, False otherwise
    """
    # Avoid infinite loops in recursive types
    if recursive_type is not None and typ == recursive_type:
        return True

    if (
        is_array_type(typ)
        or is_set_type(typ)
        or is_dict_type(typ)
        or is_ref_type(typ)
        or is_function_type(typ)
        or is_async_function_type(typ)
    ):
        return False
    # Vectors and Matrices are immutable value types (fall through to True).
    if is_struct_type(typ):
        return all(is_immutable_type(field["type"], recursive_type) for field in typ.value)
    if is_variant_type(typ):
        return all(is_immutable_type(case["type"], recursive_type) for case in typ.value)
    if is_recursive_type(typ):
        return True
    # Primitive types are immutable
    return True


# =============================================================================
# Common Type Constructors
# =============================================================================


def SomeType(value_type: EastType) -> EastVariant[list[VariantCaseDef]]:
    """Create an Option.Some variant type (for optional values).

    Args:
        value_type: Type of the wrapped value

    Returns:
        Variant type with 'some' and 'none' cases
    """
    return VariantType([("some", value_type), ("none", NullType)])


def OptionType(value_type: EastType) -> EastVariant[list[VariantCaseDef]]:
    """Create an Option type (for optional values).

    Alias for SomeType.

    Args:
        value_type: Type of the wrapped value

    Returns:
        Variant type with 'some' and 'none' cases
    """
    return SomeType(value_type)


def PatchType(type: EastType) -> EastType:
    """Compute the patch type for ``type``.

    A patch is the type of the diff between two values of ``type``, as produced
    by ``East.diff`` (east-c ``Diff``) and consumed by ``East.apply_patch``.
    Every patch is a variant with an ``unchanged`` case (``Null``) and a
    ``replace`` case (``Struct{before, after}``); structural types add a
    ``patch`` case describing the granular edit.

    Args:
        type: The East type whose patch type to compute.

    Returns:
        The patch type as an ``EastType``.
    """
    kind = type.type
    unchanged = ("unchanged", NullType)
    replace = ("replace", StructType([("before", type), ("after", type)]))

    if kind == "Array":
        element_type = type.value
        operation = VariantType(
            [
                ("delete", element_type),
                ("insert", element_type),
                ("update", PatchType(element_type)),
            ]
        )
        entry = StructType(
            [("key", IntegerType), ("offset", IntegerType), ("operation", operation)]
        )
        return VariantType([unchanged, replace, ("patch", ArrayType(entry))])
    if kind == "Set":
        operation = VariantType([("delete", NullType), ("insert", NullType)])
        return VariantType([unchanged, replace, ("patch", DictType(type.value, operation))])
    if kind == "Dict":
        value_type = type.value["value"]
        operation = VariantType(
            [
                ("delete", value_type),
                ("insert", value_type),
                ("update", PatchType(value_type)),
            ]
        )
        return VariantType(
            [unchanged, replace, ("patch", DictType(type.value["key"], operation))]
        )
    if kind == "Struct":
        patch_fields = [(f["name"], PatchType(f["type"])) for f in type.value]
        return VariantType([unchanged, replace, ("patch", StructType(patch_fields))])
    if kind == "Variant":
        patch_cases = [(c["name"], PatchType(c["type"])) for c in type.value]
        return VariantType([unchanged, replace, ("patch", VariantType(patch_cases))])
    if kind == "Ref":
        return VariantType([unchanged, replace, ("patch", PatchType(type.value))])
    # Scalars, Vector/Matrix, Function/AsyncFunction, and recursive back-reference
    # markers all carry replace-only semantics.
    return VariantType([unchanged, replace])


# =============================================================================
# Exception Types
# =============================================================================


class TypeMismatchError(TypeError):
    """Exception raised when types cannot be unified or intersected."""

    pass


# =============================================================================
# Recursive Type Handling
# =============================================================================


class RecursiveTypeMarker:
    """Temporary marker used during recursive type construction.

    After construction, all marker instances are replaced with integer scope_ids.
    This class should not appear in any final type structures - only integers.
    """

    def __repr__(self) -> str:
        """Return string representation of the marker."""
        return f"<RecursiveMarker at {hex(id(self))}>"


def recursive_type(builder: Any) -> EastType:
    """Build a recursive type with integer scope_ids (matches TypeScript).

    This function creates a recursive type where all self-references use integer
    scope_ids based on their depth in the type structure.

    Args:
        builder: Function that takes a marker and returns the node type

    Returns:
        A type where all self-references use integer scope_ids

    Example:
        ListType = recursive_type(
            lambda self: VariantType([
                ("nil", NullType),
                ("cons", StructType([("head", IntegerType), ("tail", self)]))
            ])
        )
        # The "tail" field will have type .Recursive 2 (integer, not marker)
    """
    # Create a marker for this recursive scope
    marker = RecursiveTypeMarker()

    # Create a placeholder with internal-only tag (never escapes this function)
    # This avoids polluting is_recursive_type with RecursiveTypeMarker handling
    placeholder: EastVariant = EastVariant("_RecursivePlaceholder", marker)

    # Build the type using the placeholder
    node = builder(placeholder)

    # Replace all placeholders with finalized Recursive types containing integer scope_ids
    def replace_markers(t: EastType, stack_depth: int = 0) -> EastType:
        """Recursively replace placeholders with integer scope_ids.

        Args:
            t: Type to process
            stack_depth: Current type_ctx stack depth

        Returns:
            Type with placeholders replaced by finalized Recursive types
        """
        # Check for internal placeholder (not via is_recursive_type)
        if t.type == "_RecursivePlaceholder":
            if t.value is marker:
                return EastVariant("Recursive", stack_depth)
            # Different marker (nested recursive_type call), leave for outer call
            return t

        # Already finalized recursive type, leave as-is
        if is_recursive_type(t):
            return t

        # Vector, Matrix: These push to type_ctx
        if is_vector_type(t):
            return EastVariant("Vector", replace_markers(t.value, stack_depth + 1))
        if is_matrix_type(t):
            return EastVariant("Matrix", replace_markers(t.value, stack_depth + 1))

        # Array, Set, Ref: These push to type_ctx
        if is_array_type(t):
            return EastVariant("Array", replace_markers(t.value, stack_depth + 1))
        if is_set_type(t):
            return EastVariant("Set", replace_markers(t.value, stack_depth + 1))
        if is_ref_type(t):
            return EastVariant("Ref", replace_markers(t.value, stack_depth + 1))

        # Dict: Pushes to type_ctx once
        if is_dict_type(t):
            new_key = replace_markers(t.value["key"], stack_depth + 1)
            new_value_type = replace_markers(t.value["value"], stack_depth + 1)
            return EastVariant("Dict", {"key": new_key, "value": new_value_type})

        # Struct: Pushes to type_ctx
        if is_struct_type(t):
            new_fields = [
                {"name": field["name"], "type": replace_markers(field["type"], stack_depth + 1)}
                for field in t.value
            ]
            return EastVariant("Struct", new_fields)

        # Variant: Pushes to type_ctx
        if is_variant_type(t):
            new_cases = [
                {"name": case["name"], "type": replace_markers(case["type"], stack_depth + 1)}
                for case in t.value
            ]
            return EastVariant("Variant", new_cases)

        # Function: Does NOT push to type_ctx
        if is_function_type(t):
            new_inputs = [replace_markers(inp, stack_depth) for inp in t.value["inputs"]]
            new_output = replace_markers(t.value["output"], stack_depth)
            return EastVariant(
                "Function",
                {
                    "inputs": new_inputs,
                    "output": new_output,
                },
            )

        # AsyncFunction: Does NOT push to type_ctx
        if is_async_function_type(t):
            new_inputs = [replace_markers(inp, stack_depth) for inp in t.value["inputs"]]
            new_output = replace_markers(t.value["output"], stack_depth)
            return EastVariant(
                "AsyncFunction",
                {
                    "inputs": new_inputs,
                    "output": new_output,
                },
            )

        # Primitive types, return as-is
        return t

    # Start with stack_depth=0; the root type hasn't pushed to type_ctx yet
    return replace_markers(node, stack_depth=0)


# =============================================================================
# Type Comparison
# =============================================================================


def type_equal(
    t1: EastType, t2: EastType, r1: EastType | None = None, r2: EastType | None = None
) -> EastType:
    """Check if two types are structurally equal and return the unified type.

    This is a port of TypeScript's TypeEqual function.

    Args:
        t1: First type
        t2: Second type
        r1: Root type for t1 (for recursive type handling)
        r2: Root type for t2 (for recursive type handling)

    Returns:
        The unified type (t1) if types are equal

    Raises:
        TypeMismatchError: If types are not structurally equal
    """
    from east.serialization.east_printer import print_type

    if r1 is None:
        r1 = t1
    if r2 is None:
        r2 = t2

    # Handle Ref types
    if is_ref_type(t1):
        if is_ref_type(t2):
            return RefType(type_equal(t1.value, t2.value, r1, r2))
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Vector types
    if is_vector_type(t1):
        if is_vector_type(t2):
            return VectorType(type_equal(t1.value, t2.value, r1, r2))
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Matrix types
    if is_matrix_type(t1):
        if is_matrix_type(t2):
            return MatrixType(type_equal(t1.value, t2.value, r1, r2))
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Array types
    if is_array_type(t1):
        if is_array_type(t2):
            return ArrayType(type_equal(t1.value, t2.value, r1, r2))
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Set types
    if is_set_type(t1):
        if is_set_type(t2):
            return SetType(type_equal(t1.value, t2.value, r1, r2))
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Dict types
    if is_dict_type(t1):
        if is_dict_type(t2):
            return DictType(
                type_equal(t1.value["key"], t2.value["key"], r1, r2),
                type_equal(t1.value["value"], t2.value["value"], r1, r2),
            )
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Struct types
    if is_struct_type(t1):
        if is_struct_type(t2):
            if len(t1.value) != len(t2.value):
                raise TypeMismatchError(
                    f"{print_type(t1)} is not equal to {print_type(t2)}: structs contain different number of fields"
                )

            unified_fields = []
            for i, (f1, f2) in enumerate(zip(t1.value, t2.value, strict=False)):
                if f1["name"] != f2["name"]:
                    raise TypeMismatchError(
                        f"{print_type(t1)} is not equal to {print_type(t2)}: struct field {i} has mismatched names {f1['name']} and {f2['name']}"
                    )
                unified_fields.append((f1["name"], type_equal(f1["type"], f2["type"], r1, r2)))

            return StructType(unified_fields)
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Variant types
    if is_variant_type(t1):
        if is_variant_type(t2):
            if len(t1.value) != len(t2.value):
                raise TypeMismatchError(
                    f"{print_type(t1)} is not equal to {print_type(t2)}: variants contain different number of cases"
                )

            unified_cases = []
            for c1, c2 in zip(t1.value, t2.value, strict=False):
                if c1["name"] != c2["name"]:
                    # Report which case is missing
                    if c1["name"] < c2["name"]:
                        raise TypeMismatchError(
                            f"{print_type(t1)} is not equal to {print_type(t2)}: variant case {c1['name']} is not present in both variants"
                        )
                    raise TypeMismatchError(
                        f"{print_type(t1)} is not equal to {print_type(t2)}: variant case {c2['name']} is not present in both variants"
                    )
                unified_cases.append((c1["name"], type_equal(c1["type"], c2["type"], r1, r2)))

            return VariantType(unified_cases)
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Function types
    if is_function_type(t1):
        if is_function_type(t2):
            inputs1 = t1.value["inputs"]
            inputs2 = t2.value["inputs"]

            if len(inputs1) != len(inputs2):
                raise TypeMismatchError(
                    f"{print_type(t1)} is not equal to {print_type(t2)}: functions have different number of inputs"
                )

            unified_inputs = [
                type_equal(i1, i2, r1, r2) for i1, i2 in zip(inputs1, inputs2, strict=False)
            ]
            unified_output = type_equal(t1.value["output"], t2.value["output"], r1, r2)

            return FunctionType(unified_inputs, unified_output)
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle AsyncFunction types
    if is_async_function_type(t1):
        if is_async_function_type(t2):
            inputs1 = t1.value["inputs"]
            inputs2 = t2.value["inputs"]

            if len(inputs1) != len(inputs2):
                raise TypeMismatchError(
                    f"{print_type(t1)} is not equal to {print_type(t2)}: async functions have different number of inputs"
                )

            unified_inputs = [
                type_equal(i1, i2, r1, r2) for i1, i2 in zip(inputs1, inputs2, strict=False)
            ]
            unified_output = type_equal(t1.value["output"], t2.value["output"], r1, r2)

            return AsyncFunctionType(unified_inputs, unified_output)
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle Recursive types
    if is_recursive_type(t1):
        if is_recursive_type(t2):
            # Compare scope_ids directly (both are finalized with int values)
            if t1.value == t2.value:
                return t1
            raise TypeMismatchError(
                f"{print_type(t1)} is not equal to {print_type(t2)}: recursive types do not match"
            )
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )
    if is_recursive_type(t2):
        raise TypeMismatchError(
            f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
        )

    # Handle primitive types - they must match exactly
    if t1.type == t2.type:
        # For primitives (Never, Null, Boolean, Integer, Float, String, DateTime, Blob)
        # they're equal if they have the same kind
        return t1
    raise TypeMismatchError(
        f"{print_type(t1)} is not equal to {print_type(t2)}: incompatible types"
    )


def is_type_equal(
    t1: EastType, t2: EastType, r1: EastType | None = None, r2: EastType | None = None
) -> bool:
    """Check if two types are structurally equal (boolean version).

    This is a boolean wrapper around type_equal that returns True/False instead of throwing.

    Args:
        t1: First type to compare
        t2: Second type to compare
        r1: Recursive type root for t1 (internal, optional)
        r2: Recursive type root for t2 (internal, optional)

    Returns:
        True if types are structurally equal, False otherwise
    """
    if r1 is None:
        r1 = t1
    if r2 is None:
        r2 = t2

    # Handle Recursive types (finalized with int scope_ids)
    if is_recursive_type(t1):
        if is_recursive_type(t2):
            return t1.value == t2.value
        return False
    if is_recursive_type(t2):
        return False

    # Handle primitive types
    if t1.type in ("Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
        return t1.type == t2.type

    # Handle Ref types
    if is_ref_type(t1):
        return is_ref_type(t2) and is_type_equal(t1.value, t2.value, r1, r2)

    # Handle Vector types
    if is_vector_type(t1):
        return is_vector_type(t2) and is_type_equal(t1.value, t2.value, r1, r2)

    # Handle Matrix types
    if is_matrix_type(t1):
        return is_matrix_type(t2) and is_type_equal(t1.value, t2.value, r1, r2)

    # Handle Array types
    if is_array_type(t1):
        return is_array_type(t2) and is_type_equal(t1.value, t2.value, r1, r2)

    # Handle Set types
    if is_set_type(t1):
        return is_set_type(t2) and is_type_equal(t1.value, t2.value, r1, r2)

    # Handle Dict types
    if is_dict_type(t1):
        if not is_dict_type(t2):
            return False
        return is_type_equal(t1.value["key"], t2.value["key"], r1, r2) and is_type_equal(
            t1.value["value"], t2.value["value"], r1, r2
        )

    # Handle Struct types
    if is_struct_type(t1):
        if not is_struct_type(t2):
            return False
        if len(t1.value) != len(t2.value):
            return False
        for f1, f2 in zip(t1.value, t2.value, strict=False):
            if f1["name"] != f2["name"]:
                return False
            if not is_type_equal(f1["type"], f2["type"], r1, r2):
                return False
        return True

    # Handle Variant types
    if is_variant_type(t1):
        if not is_variant_type(t2):
            return False
        if len(t1.value) != len(t2.value):
            return False
        for c1, c2 in zip(t1.value, t2.value, strict=False):
            if c1["name"] != c2["name"]:
                return False
            if not is_type_equal(c1["type"], c2["type"], r1, r2):
                return False
        return True

    # Handle Function types
    if is_function_type(t1):
        if not is_function_type(t2):
            return False
        inputs1 = t1.value["inputs"]
        inputs2 = t2.value["inputs"]
        if len(inputs1) != len(inputs2):
            return False
        for i1, i2 in zip(inputs1, inputs2, strict=False):
            if not is_type_equal(i1, i2, r1, r2):
                return False
        return is_type_equal(t1.value["output"], t2.value["output"], r1, r2)

    # Handle AsyncFunction types
    if is_async_function_type(t1):
        if not is_async_function_type(t2):
            return False
        inputs1 = t1.value["inputs"]
        inputs2 = t2.value["inputs"]
        if len(inputs1) != len(inputs2):
            return False
        for i1, i2 in zip(inputs1, inputs2, strict=False):
            if not is_type_equal(i1, i2, r1, r2):
                return False
        return is_type_equal(t1.value["output"], t2.value["output"], r1, r2)

    # Unknown type
    raise NotImplementedError(f"is_type_equal not implemented for type kind: {t1}")


def is_subtype(t1: EastType, t2: EastType) -> bool:
    """Check if t1 is a subtype of t2.

    Args:
        t1: The potential subtype
        t2: The potential supertype

    Returns:
        True if t1 is a subtype of t2, False otherwise
    """
    # Handle Recursive types (finalized with int scope_ids)
    if is_recursive_type(t1):
        if is_recursive_type(t2):
            return t1.value == t2.value
        return False
    if is_recursive_type(t2):
        return False

    # Never is a subtype of everything
    if is_never_type(t1):
        return True

    # Primitive types are only subtypes of themselves
    if t1.type in ("Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"):
        return t1.type == t2.type

    # Handle Ref types (invariant)
    if is_ref_type(t1):
        return is_ref_type(t2) and is_type_equal(t1.value, t2.value)

    # Handle Vector types (invariant)
    if is_vector_type(t1):
        return is_vector_type(t2) and is_type_equal(t1.value, t2.value)

    # Handle Matrix types (invariant)
    if is_matrix_type(t1):
        return is_matrix_type(t2) and is_type_equal(t1.value, t2.value)

    # Handle Array types (invariant)
    if is_array_type(t1):
        return is_array_type(t2) and is_type_equal(t1.value, t2.value)

    # Handle Set types (invariant)
    if is_set_type(t1):
        return is_set_type(t2) and is_type_equal(t1.value, t2.value)

    # Handle Dict types (invariant)
    if is_dict_type(t1):
        if not is_dict_type(t2):
            return False
        return is_type_equal(t1.value["key"], t2.value["key"]) and is_type_equal(
            t1.value["value"], t2.value["value"]
        )

    # Handle Struct types (structural subtyping)
    if is_struct_type(t1):
        if not is_struct_type(t2):
            return False
        if len(t1.value) != len(t2.value):
            return False
        for f1, f2 in zip(t1.value, t2.value, strict=False):
            if f1["name"] != f2["name"]:
                return False
            if not is_subtype(f1["type"], f2["type"]):
                return False
        return True

    # Handle Variant types (subset of cases)
    if is_variant_type(t1):
        if not is_variant_type(t2):
            return False
        # Build case map for t2
        cases2_map = {case["name"]: case["type"] for case in t2.value}
        # Check each case in t1 is in t2 with compatible type
        for case1 in t1.value:
            case_type2 = cases2_map.get(case1["name"], NeverType)
            if not is_subtype(case1["type"], case_type2):
                return False
        return True

    # Handle Function types (contravariant inputs, covariant output)
    # Function <: Function OR Function <: AsyncFunction (sync is subtype of async)
    if is_function_type(t1):
        if is_function_type(t2) or is_async_function_type(t2):
            inputs1 = t1.value["inputs"]
            inputs2 = t2.value["inputs"]
            if len(inputs1) != len(inputs2):
                return False
            # Contravariant inputs (t2 input subtypes of t1 inputs)
            for i1, i2 in zip(inputs1, inputs2, strict=False):
                if not is_subtype(i2, i1):
                    return False
            # Covariant output
            return is_subtype(t1.value["output"], t2.value["output"])
        return False

    # Handle AsyncFunction types (contravariant inputs, covariant output)
    # AsyncFunction <: AsyncFunction only (not to sync Function)
    if is_async_function_type(t1):
        if is_async_function_type(t2):
            inputs1 = t1.value["inputs"]
            inputs2 = t2.value["inputs"]
            if len(inputs1) != len(inputs2):
                return False
            # Contravariant inputs (t2 input subtypes of t1 inputs)
            for i1, i2 in zip(inputs1, inputs2, strict=False):
                if not is_subtype(i2, i1):
                    return False
            # Covariant output
            return is_subtype(t1.value["output"], t2.value["output"])
        return False

    # Unknown type
    raise NotImplementedError(f"is_subtype not implemented for type: {t1}")


def type_union(t1: EastType, t2: EastType) -> EastType:
    """Compute the union of two East types.

    Args:
        t1: First type
        t2: Second type

    Returns:
        The union type

    Raises:
        TypeMismatchError: When the types cannot be unioned
    """
    from east.serialization.east_printer import print_identifier, print_type

    try:
        # Never is identity for union
        if is_never_type(t1):
            return t2
        if is_never_type(t2):
            return t1

        # Recursive types
        if is_recursive_type(t1):
            if is_recursive_type(t2):
                if t1.value == t2.value:
                    return t1
                raise TypeMismatchError(
                    f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible recursive types"
                )
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )
        if is_recursive_type(t2):
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Ref types
        if is_ref_type(t1):
            if is_ref_type(t2):
                return RefType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Vector types
        if is_vector_type(t1):
            if is_vector_type(t2):
                return VectorType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Matrix types
        if is_matrix_type(t1):
            if is_matrix_type(t2):
                return MatrixType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Array types
        if is_array_type(t1):
            if is_array_type(t2):
                return ArrayType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Set types
        if is_set_type(t1):
            if is_set_type(t2):
                return SetType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Dict types
        if is_dict_type(t1):
            if is_dict_type(t2):
                return DictType(
                    type_equal(t1.value["key"], t2.value["key"]),
                    type_equal(t1.value["value"], t2.value["value"]),
                )
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Struct types
        if is_struct_type(t1):
            if is_struct_type(t2):
                if len(t1.value) != len(t2.value):
                    raise TypeMismatchError(
                        f"Cannot union {print_type(t1)} with {print_type(t2)}: "
                        "structs contain different number of fields"
                    )
                result_fields = []
                for i, (field1, field2) in enumerate(zip(t1.value, t2.value, strict=False)):
                    if field1["name"] != field2["name"]:
                        raise TypeMismatchError(
                            f"Cannot union {print_type(t1)} with {print_type(t2)}: "
                            f"struct field {i} has mismatched names {print_identifier(field1['name'])} and {print_identifier(field2['name'])}"
                        )
                    result_fields.append(
                        (field1["name"], type_union(field1["type"], field2["type"]))
                    )
                return StructType(result_fields)
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Variant types
        if is_variant_type(t1):
            if is_variant_type(t2):
                cases1 = {c["name"]: c["type"] for c in t1.value}
                cases2 = {c["name"]: c["type"] for c in t2.value}
                result_cases = {}
                for k1, f1 in cases1.items():
                    f2 = cases2.get(k1)
                    result_cases[k1] = type_union(f1, f2) if f2 is not None else f1
                for k2, f2 in cases2.items():
                    if k2 not in cases1:
                        result_cases[k2] = f2
                return VariantType(list(result_cases.items()))
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Function types
        # Union of Function + Function = Function
        # Union of Function + AsyncFunction = AsyncFunction
        if is_function_type(t1):
            if is_function_type(t2):
                inputs1 = t1.value["inputs"]
                inputs2 = t2.value["inputs"]
                if len(inputs1) != len(inputs2):
                    raise TypeMismatchError(
                        f"Cannot union {print_type(t1)} with {print_type(t2)}: "
                        "functions take different number of arguments"
                    )
                # Contravariant inputs, covariant output
                inputs = [type_intersect(i1, i2) for i1, i2 in zip(inputs1, inputs2, strict=False)]
                output = type_union(t1.value["output"], t2.value["output"])
                return FunctionType(inputs, output)
            if is_async_function_type(t2):
                inputs1 = t1.value["inputs"]
                inputs2 = t2.value["inputs"]
                if len(inputs1) != len(inputs2):
                    raise TypeMismatchError(
                        f"Cannot union {print_type(t1)} with {print_type(t2)}: "
                        "functions take different number of arguments"
                    )
                # Contravariant inputs, covariant output; result is AsyncFunction
                inputs = [type_intersect(i1, i2) for i1, i2 in zip(inputs1, inputs2, strict=False)]
                output = type_union(t1.value["output"], t2.value["output"])
                return AsyncFunctionType(inputs, output)
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # AsyncFunction types
        # Union of AsyncFunction + Function = AsyncFunction
        # Union of AsyncFunction + AsyncFunction = AsyncFunction
        if is_async_function_type(t1):
            if is_function_type(t2) or is_async_function_type(t2):
                inputs1 = t1.value["inputs"]
                inputs2 = t2.value["inputs"]
                if len(inputs1) != len(inputs2):
                    raise TypeMismatchError(
                        f"Cannot union {print_type(t1)} with {print_type(t2)}: "
                        "functions take different number of arguments"
                    )
                # Contravariant inputs, covariant output; result is AsyncFunction
                inputs = [type_intersect(i1, i2) for i1, i2 in zip(inputs1, inputs2, strict=False)]
                output = type_union(t1.value["output"], t2.value["output"])
                return AsyncFunctionType(inputs, output)
            raise TypeMismatchError(
                f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Primitive types
        if t1.type == t2.type:
            return t1
        raise TypeMismatchError(
            f"Cannot union {print_type(t1)} with {print_type(t2)}: incompatible types"
        )

    except TypeMismatchError:
        raise
    except Exception as e:
        raise TypeMismatchError(f"Cannot union {print_type(t1)} with {print_type(t2)}") from e


def type_intersect(t1: EastType, t2: EastType) -> EastType:
    """Compute the intersection of two East types.

    Args:
        t1: First type
        t2: Second type

    Returns:
        The intersection type

    Raises:
        TypeMismatchError: When the types cannot be intersected
    """
    from east.serialization.east_printer import print_identifier, print_type

    try:
        # Never is absorbing for intersection
        if is_never_type(t1) or is_never_type(t2):
            return NeverType

        # Recursive types
        if is_recursive_type(t1):
            if is_recursive_type(t2):
                if t1.value == t2.value:
                    return t1
                raise TypeMismatchError(
                    f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible recursive types"
                )
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )
        if is_recursive_type(t2):
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Ref types
        if is_ref_type(t1):
            if is_ref_type(t2):
                return RefType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Vector types
        if is_vector_type(t1):
            if is_vector_type(t2):
                return VectorType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Matrix types
        if is_matrix_type(t1):
            if is_matrix_type(t2):
                return MatrixType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Array types
        if is_array_type(t1):
            if is_array_type(t2):
                return ArrayType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Set types
        if is_set_type(t1):
            if is_set_type(t2):
                return SetType(type_equal(t1.value, t2.value))
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Dict types
        if is_dict_type(t1):
            if is_dict_type(t2):
                return DictType(
                    type_equal(t1.value["key"], t2.value["key"]),
                    type_equal(t1.value["value"], t2.value["value"]),
                )
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Struct types
        if is_struct_type(t1):
            if is_struct_type(t2):
                if len(t1.value) != len(t2.value):
                    raise TypeMismatchError(
                        f"Cannot intersect {print_type(t1)} with {print_type(t2)}: "
                        "structs contain different number of fields"
                    )
                result_fields = []
                for i, (field1, field2) in enumerate(zip(t1.value, t2.value, strict=False)):
                    if field1["name"] != field2["name"]:
                        raise TypeMismatchError(
                            f"Cannot intersect {print_type(t1)} with {print_type(t2)}: "
                            f"struct field {i} has mismatched names {print_identifier(field1['name'])} and {print_identifier(field2['name'])}"
                        )
                    result_fields.append(
                        (field1["name"], type_intersect(field1["type"], field2["type"]))
                    )
                return StructType(result_fields)
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Variant types
        if is_variant_type(t1):
            if is_variant_type(t2):
                cases1 = {c["name"]: c["type"] for c in t1.value}
                cases2 = {c["name"]: c["type"] for c in t2.value}
                result_cases = {
                    k1: type_intersect(f1, cases2[k1]) for k1, f1 in cases1.items() if k1 in cases2
                }
                if not result_cases:
                    raise TypeMismatchError(
                        f"Cannot intersect {print_type(t1)} with {print_type(t2)}: "
                        "variants have no overlapping cases"
                    )
                return VariantType(list(result_cases.items()))
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Function types
        # Intersect of Function + Function = Function
        # Intersect of Function + AsyncFunction = Function (more specific)
        if is_function_type(t1):
            if is_function_type(t2) or is_async_function_type(t2):
                inputs1 = t1.value["inputs"]
                inputs2 = t2.value["inputs"]
                if len(inputs1) != len(inputs2):
                    raise TypeMismatchError(
                        f"Cannot intersect {print_type(t1)} with {print_type(t2)}: "
                        "functions take different number of arguments"
                    )
                # Contravariant inputs, covariant output; result is Function
                inputs = [type_union(i1, i2) for i1, i2 in zip(inputs1, inputs2, strict=False)]
                output = type_intersect(t1.value["output"], t2.value["output"])
                return FunctionType(inputs, output)
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # AsyncFunction types
        # Intersect of AsyncFunction + Function = Function (more specific)
        # Intersect of AsyncFunction + AsyncFunction = AsyncFunction
        if is_async_function_type(t1):
            if is_function_type(t2):
                inputs1 = t1.value["inputs"]
                inputs2 = t2.value["inputs"]
                if len(inputs1) != len(inputs2):
                    raise TypeMismatchError(
                        f"Cannot intersect {print_type(t1)} with {print_type(t2)}: "
                        "functions take different number of arguments"
                    )
                # Contravariant inputs, covariant output; result is Function
                inputs = [type_union(i1, i2) for i1, i2 in zip(inputs1, inputs2, strict=False)]
                output = type_intersect(t1.value["output"], t2.value["output"])
                return FunctionType(inputs, output)
            if is_async_function_type(t2):
                inputs1 = t1.value["inputs"]
                inputs2 = t2.value["inputs"]
                if len(inputs1) != len(inputs2):
                    raise TypeMismatchError(
                        f"Cannot intersect {print_type(t1)} with {print_type(t2)}: "
                        "functions take different number of arguments"
                    )
                # Contravariant inputs, covariant output; result is AsyncFunction
                inputs = [type_union(i1, i2) for i1, i2 in zip(inputs1, inputs2, strict=False)]
                output = type_intersect(t1.value["output"], t2.value["output"])
                return AsyncFunctionType(inputs, output)
            raise TypeMismatchError(
                f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
            )

        # Primitive types
        if t1.type == t2.type:
            return t1
        raise TypeMismatchError(
            f"Cannot intersect {print_type(t1)} with {print_type(t2)}: incompatible types"
        )

    except TypeMismatchError:
        raise
    except Exception as e:
        raise TypeMismatchError(f"Cannot intersect {print_type(t1)} with {print_type(t2)}") from e


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Core type alias
    "EastType",
    # TypedDicts for type values
    "StructFieldDef",
    "VariantCaseDef",
    "DictValueTypeDef",
    "FunctionTypeValue",
    "AsyncFunctionTypeValue",
    # Primitive type singletons
    "NullType",
    "BooleanType",
    "IntegerType",
    "FloatType",
    "StringType",
    "BlobType",
    "DateTimeType",
    "NeverType",
    # Type constructors
    "VectorType",
    "MatrixType",
    "ArrayType",
    "SetType",
    "DictType",
    "RefType",
    "StructType",
    "VariantType",
    "FunctionType",
    "AsyncFunctionType",
    "RecursiveTypeRef",
    "RecursiveType",
    # Common type constructors
    "SomeType",
    "OptionType",
    "PatchType",
    # Helper functions for working with types
    "field_names",
    "field_types",
    "field_index",
    "case_names",
    "case_types",
    "case_type",
    # TypeGuard helpers for type narrowing
    "is_null_type",
    "is_boolean_type",
    "is_integer_type",
    "is_float_type",
    "is_string_type",
    "is_blob_type",
    "is_datetime_type",
    "is_never_type",
    "is_vector_type",
    "is_matrix_type",
    "is_ref_type",
    "is_array_type",
    "is_set_type",
    "is_dict_type",
    "is_struct_type",
    "is_variant_type",
    "is_function_type",
    "is_async_function_type",
    "is_recursive_type",
    # Option type helpers
    "is_option_type",
    "get_option_inner_type",
    # Type predicates
    "is_data_type",
    "is_immutable_type",
    # Recursive type utilities
    "RecursiveTypeMarker",
    "recursive_type",
    # Type comparison
    "type_equal",
    "is_type_equal",
    "is_subtype",
    "type_union",
    "type_intersect",
    # Exceptions
    "TypeMismatchError",
]
