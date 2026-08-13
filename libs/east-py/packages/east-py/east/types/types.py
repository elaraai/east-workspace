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
    """Recursive type node.

    The payload is itself a variant: ``wrapper`` carries ``{id, inner}`` (the
    binder that introduces a recursive scope), and ``ref`` carries the integer
    id of the wrapper it refers back to. Mirrors the TS reference
    (``EastTypeType`` in libs/east/src/type_of_type.ts).
    """

    type: Literal["Recursive"]
    value: EastVariant  # variant("ref", int) | variant("wrapper", {"id": int, "inner": EastType})


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
        # Hash by the scope id only; never recurse into a wrapper's inner.
        # Structurally identical wrappers share an id via _intern_recursive_wrapper,
        # so id-hashing keeps equal types hash-equal without deep traversal.
        if value.type == "ref":
            return _hash_combine(_hash_combine(h, 0x01), value.value & _FNV_MASK)
        return _hash_combine(_hash_combine(h, 0x02), value.value["id"] & _FNV_MASK)
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
        # "Set key type", not "element type": the TypeScript runtime raises
        # exactly this phrase (libs/east/src/types.ts) and pins it in its spec.
        # Improving the wording on one runtime only would be a cross-runtime
        # divergence — the class of defect this epic exists to remove.
        raise _immutable_key_error("Set", "key type", element_type)
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
        raise _immutable_key_error("Dict", "key type", key_type)
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


def RecursiveTypeRef(marker: int) -> EastVariant[EastVariant]:
    """Create a recursive type back-reference to the wrapper with id ``marker``.

    Args:
        marker: The scope id of the enclosing recursive wrapper

    Returns:
        Recursive type reference (``ref`` form)
    """
    return EastVariant("Recursive", EastVariant("ref", marker))


def RecursiveType(builder: Any) -> EastType:
    """Build a recursive type in the id-based wrapper/ref form.

    This is an alias for recursive_type() that matches TypeScript's naming convention.

    Args:
        builder: Function that takes a self-reference and returns the node type

    Returns:
        A ``Recursive`` wrapper type whose self-references are ``ref(id)`` nodes

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

RecursiveTypeAlias: TypeAlias = EastVariant[EastVariant]
"""Type alias for Recursive types. Value is the ``ref``/``wrapper`` payload variant."""

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


def is_recursive_type(typ: EastType) -> TypeGuard[EastVariant[EastVariant]]:
    """Check if a type is a Recursive type (``ref`` or ``wrapper`` form)."""
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
        # ref: a back-reference into a scope already being checked. wrapper:
        # check the inner node (its refs are leaves, so this is finite).
        if typ.value.type == "wrapper":
            return is_data_type(typ.value.value["inner"], recursive_type)
        return True
    # Primitive types are data types
    return True


# The kinds the immutability rule rejects outright. Vector and Matrix are
# deliberately NOT here — East treats them as immutable numeric value types, so
# they may legally key a Set or Dict.
_MUTABLE_KINDS = ("Array", "Set", "Dict", "Ref", "Function", "AsyncFunction")


def _find_mutable(
    typ: EastType, recursive_type: EastType | None = None
) -> tuple[list[tuple[str, str]], EastType] | None:
    """The single traversal behind both the predicate and the diagnostic.

    One walk, two callers: :func:`is_immutable_type` asks only whether this
    returned ``None``, and :func:`first_mutable_path` renders the location it
    found. Deriving both from one function is the point — a second walk over
    the same rule could drift from the one that actually gates the constructors,
    and the failure mode is a message naming a field for a type that was
    accepted, or a rejection the message cannot explain.

    Returns ``None`` when ``typ`` is immutable, otherwise
    ``(segments, offending type)``. ``segments`` is the path from the offender
    back up to ``typ`` — REVERSED, because each frame appends on the way OUT of
    the recursion. Each is ``(kind, name)`` with kind ``"field"`` or ``"case"``.

    Accumulating on the way out rather than threading a path down means the
    success path — the one every accepted ``SetType``/``DictType`` construction
    takes — allocates nothing at all, and a failure pays only O(depth).

    Args:
        typ: Type to inspect.
        recursive_type: Internal parameter for cycle detection.

    Returns:
        ``None``, or ``(reversed path segments, the mutable sub-type)``.
    """
    # Avoid infinite loops in recursive types
    if recursive_type is not None and typ == recursive_type:
        return None
    if typ.type in _MUTABLE_KINDS:
        return [], typ
    # Vectors and Matrices are immutable value types (fall through to None).
    if is_struct_type(typ):
        for field in typ.value:
            found = _find_mutable(field["type"], recursive_type)
            if found is not None:
                found[0].append(("field", field["name"]))
                return found
        return None
    if is_variant_type(typ):
        for case in typ.value:
            found = _find_mutable(case["type"], recursive_type)
            if found is not None:
                found[0].append(("case", case["name"]))
                return found
        return None
    if typ.type == "Recursive" and typ.value.type == "wrapper":
        # The wrapper is transparent: a recursive type is immutable iff its
        # inner node is. Back-references (ref) fall through as immutable —
        # the scope containing them is already being checked.
        return _find_mutable(typ.value.value["inner"], recursive_type)
    # Primitives and recursive back-references are immutable
    return None


def is_immutable_type(typ: EastType, recursive_type: EastType | None = None) -> bool:
    """Check if a type is immutable.

    Immutable types exclude mutable collections (Array, Set, Dict), Refs and
    functions. Used to validate key types for Set and Dict.

    Delegates to :func:`_find_mutable` so the predicate and the diagnostic that
    explains it are the same traversal and cannot disagree (#522).

    Args:
        typ: Type to check
        recursive_type: Internal parameter for cycle detection

    Returns:
        True if the type is immutable, False otherwise
    """
    return _find_mutable(typ, recursive_type) is None


def _render_path(segments: list[tuple[str, str]]) -> str:
    """Render :func:`_find_mutable` segments as ``record.readings``.

    ``segments`` arrives offender-first, so it is reversed here. Struct fields
    join with ``.`` and variant cases with ``|``, which keeps a case visibly
    distinct from a field of the same name.

    The OUTERMOST segment carries a separator only when it is a case: a leading
    ``.`` would be noise on the common all-struct path, but leaving a leading
    case bare made ``Option<Struct{x: Array}>`` render ``some.x`` — identical to
    a struct with a field named ``some``, which defeats one level up the exact
    field-vs-case distinction this function exists to draw.
    """
    parts = []
    for i, (kind, name) in enumerate(reversed(segments)):
        if kind == "case":
            parts.append(f"|{name}")
        else:
            parts.append(name if i == 0 else f".{name}")
    return "".join(parts)


def first_mutable_path(
    typ: EastType, recursive_type: EastType | None = None
) -> tuple[str, EastType] | None:
    """Locate the first sub-type that makes ``typ`` mutable.

    The diagnostic view of :func:`is_immutable_type`: both are
    :func:`_find_mutable`, so this returns ``None`` for exactly the types that
    predicate accepts, by construction rather than by agreement.

    Without it ``SetType``/``DictType`` could only print the whole offending
    type and leave the reader to hunt for the mutable part — a wall of text on a
    wide struct, and a recursive hunt on a nested one (#522).

    Args:
        typ: Type to inspect.
        recursive_type: Internal parameter for cycle detection.

    Returns:
        ``(path, offending type)`` for the first mutable position, in East's own
        field/case order, or ``None`` when ``typ`` is immutable. ``path`` is
        empty when ``typ`` ITSELF is the mutable one; otherwise it reads like
        ``record.readings``, with variant cases separated by ``|``.
    """
    found = _find_mutable(typ, recursive_type)
    if found is None:
        return None
    segments, offender = found
    return _render_path(segments), offender


def _immutable_key_error(container: str, slot: str, typ: EastType) -> TypeError:
    """The shared "must be immutable" error, naming the offending field (#522).

    Keeps the full printed type on a following line rather than inline: in a
    traceback the inlined form drowned the sentence that explains the problem.
    """
    from east.serialization.east_printer import print_type

    found = _find_mutable(typ)
    if found is None:
        # Unreachable via the constructors (they only build this after the
        # check has already failed), but a wrong answer here would be worse
        # than a plain message.
        return TypeError(
            f"{container} {slot} must be an immutable type, got {print_type(typ)}"
        )
    segments, offender = found
    # Name the position the way East names it — `field` and `case` are
    # different things, and calling a variant case a field would send the
    # reader looking for something that is not there.
    where = f"{segments[0][0]} '{_render_path(segments)}' is" if segments else "it is"
    return TypeError(
        f"{container} {slot} must be an immutable type, but {where} "
        f"{offender.type} (mutable). Mutable kinds: {', '.join(_MUTABLE_KINDS)}.\n"
        f"  full type: {print_type(typ)}"
    )


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


def PatchType(type: EastType, _ctx: dict[int, EastType] | None = None) -> EastType:
    """Compute the patch type for ``type``.

    A patch is the type of the diff between two values of ``type``, as produced
    by ``East.diff`` (east-c ``Diff``) and consumed by ``East.apply_patch``.
    Every patch is a variant with an ``unchanged`` case (``Null``) and a
    ``replace`` case (``Struct{before, after}``); structural types add a
    ``patch`` case describing the granular edit.

    Args:
        type: The East type whose patch type to compute.
        _ctx: Internal map from recursive scope id to the patch type its
            back-references resolve to.

    Returns:
        The patch type as an ``EastType``.
    """
    kind = type.type
    unchanged = ("unchanged", NullType)
    replace = ("replace", StructType([("before", type), ("after", type)]))

    if kind == "Recursive":
        # Mirrors the TS reference (libs/east/src/patch/type_of_patch.ts): a
        # wrapper registers replace-only semantics for its scope BEFORE
        # recursing, so back-references inside the body resolve to a patch of
        # the whole recursive type — never to a patch of the bare back-ref.
        payload = type.value
        if _ctx is None:
            _ctx = {}
        if payload.type == "wrapper":
            rec_id = payload.value["id"]
            cached = _ctx.get(rec_id)
            if cached is not None:
                return cached
            _ctx[rec_id] = VariantType([unchanged, replace])
            return PatchType(payload.value["inner"], _ctx)
        cached = _ctx.get(payload.value)
        if cached is None:
            raise ValueError(f"PatchType: unresolved Recursive ref({payload.value})")
        return cached
    if kind == "Array":
        element_type = type.value
        operation = VariantType(
            [
                ("delete", element_type),
                ("insert", element_type),
                ("update", PatchType(element_type, _ctx)),
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
                ("update", PatchType(value_type, _ctx)),
            ]
        )
        return VariantType(
            [unchanged, replace, ("patch", DictType(type.value["key"], operation))]
        )
    if kind == "Struct":
        patch_fields = [(f["name"], PatchType(f["type"], _ctx)) for f in type.value]
        return VariantType([unchanged, replace, ("patch", StructType(patch_fields))])
    if kind == "Variant":
        patch_cases = [(c["name"], PatchType(c["type"], _ctx)) for c in type.value]
        return VariantType([unchanged, replace, ("patch", VariantType(patch_cases))])
    if kind == "Ref":
        return VariantType([unchanged, replace, ("patch", PatchType(type.value, _ctx))])
    # Scalars, Vector/Matrix, and Function/AsyncFunction carry replace-only
    # semantics.
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

    After construction, all marker instances are replaced with ``ref(id)``
    back-references. This class should not appear in any final type structure.
    """

    def __repr__(self) -> str:
        """Return string representation of the marker."""
        return f"<RecursiveMarker at {hex(id(self))}>"


# Process-unique scope ids for recursive wrappers, and the canonical wrapper
# registry. Mirrors the TS reference (_recursiveIntern in libs/east/src/types.ts):
# structurally identical recursive types share ONE wrapper (and therefore one
# id), which is what makes the id fast-paths in the equality family sound
# within a process. Foreign ids (decoded wire types, another runtime's mint)
# are handled by alpha-equivalence in is_type_equal.
_next_recursive_id: int = 1
_recursive_intern: list[EastVariant] = []


def _mint_recursive_id() -> int:
    """Allocate the next process-unique recursive scope id.

    Shared with the C bridge's reverse type converter, so wrappers minted from
    C pointers draw from the same sequence as recursive_type.
    """
    global _next_recursive_id
    rec_id = _next_recursive_id
    _next_recursive_id += 1
    return rec_id


def _intern_recursive_wrapper(built: EastVariant) -> EastVariant:
    """Return the canonical wrapper structurally equal to ``built``.

    Registers ``built`` as the new canonical if no match exists. Also the
    chokepoint for wrappers reconstructed from east-c pointers or decoded from
    the wire, so every in-process route to a given recursive structure
    converges on one id.
    """
    for existing in _recursive_intern:
        if is_type_equal(existing, built):
            return existing
    _recursive_intern.append(built)
    return built


def recursive_type(builder: Any) -> EastType:
    """Build a recursive type in the id-based wrapper/ref form.

    The builder's self-references become ``Recursive ref(id)`` leaves and the
    whole type is wrapped as ``Recursive wrapper{id, inner}``, matching the
    TypeScript reference (``toEastTypeValue`` of a ``RecursiveType``). The
    result is a finite tree: refs are leaves, and only the wrapper binds them.

    Args:
        builder: Function that takes a self-reference and returns the node type

    Returns:
        The canonical ``Recursive`` wrapper type for the built structure

    Raises:
        TypeError: If the builder threads its self-reference into another
            in-progress recursive scope (mutual recursion), or places it in a
            set key or dict key position.

    Example:
        ListType = recursive_type(
            lambda self: VariantType([
                ("nil", NullType),
                ("cons", StructType([("head", IntegerType), ("tail", self)]))
            ])
        )
        # The "tail" field will have type .Recursive .ref <id>
    """
    marker = RecursiveTypeMarker()

    # Create a placeholder with internal-only tag (never escapes this function)
    # This avoids polluting is_recursive_type with RecursiveTypeMarker handling
    placeholder: EastVariant = EastVariant("_RecursivePlaceholder", marker)

    node = builder(placeholder)

    rec_id = _mint_recursive_id()
    ref: EastVariant = EastVariant("Recursive", EastVariant("ref", rec_id))

    def finalize(t: EastType, allowed: bool) -> EastType:
        """Replace our placeholders with ``ref(id)``, validating as we go.

        ``allowed`` is False inside set-key and dict-key positions, mirroring
        the TS reference's validateNotMutuallyRecursive.
        """
        if t.type == "_RecursivePlaceholder":
            if t.value is marker:
                if not allowed:
                    raise TypeError(
                        "RecursiveType cannot pass into set keys, dictionary keys, "
                        "or function input/output types"
                    )
                return ref
            # A different in-progress scope's marker reached our body: the
            # builder captured another recursive_type's self-reference.
            raise TypeError(
                "RecursiveType must have SCC size 1: nested RecursiveTypes with "
                "cross-references are not supported. Each RecursiveType can only "
                "reference itself, not other recursive scopes."
            )

        # A completed nested recursive type contains no placeholders (its own
        # finalize already ran, and a leaked foreign marker raises above).
        if is_recursive_type(t):
            return t

        if is_vector_type(t):
            new = finalize(t.value, allowed)
            return t if new is t.value else EastVariant("Vector", new)
        if is_matrix_type(t):
            new = finalize(t.value, allowed)
            return t if new is t.value else EastVariant("Matrix", new)
        if is_array_type(t):
            new = finalize(t.value, allowed)
            return t if new is t.value else EastVariant("Array", new)
        if is_set_type(t):
            new = finalize(t.value, False)
            return t if new is t.value else EastVariant("Set", new)
        if is_ref_type(t):
            new = finalize(t.value, allowed)
            return t if new is t.value else EastVariant("Ref", new)

        if is_dict_type(t):
            new_key = finalize(t.value["key"], False)
            new_value_type = finalize(t.value["value"], allowed)
            if new_key is t.value["key"] and new_value_type is t.value["value"]:
                return t
            return EastVariant("Dict", {"key": new_key, "value": new_value_type})

        if is_struct_type(t):
            new_fields = [
                {"name": field["name"], "type": finalize(field["type"], allowed)}
                for field in t.value
            ]
            if all(nf["type"] is f["type"] for nf, f in zip(new_fields, t.value, strict=True)):
                return t
            return EastVariant("Struct", new_fields)

        if is_variant_type(t):
            new_cases = [
                {"name": case["name"], "type": finalize(case["type"], allowed)}
                for case in t.value
            ]
            if all(nc["type"] is c["type"] for nc, c in zip(new_cases, t.value, strict=True)):
                return t
            return EastVariant("Variant", new_cases)

        if is_function_type(t):
            new_inputs = [finalize(inp, allowed) for inp in t.value["inputs"]]
            new_output = finalize(t.value["output"], allowed)
            if new_output is t.value["output"] and all(
                ni is i for ni, i in zip(new_inputs, t.value["inputs"], strict=True)
            ):
                return t
            return EastVariant("Function", {"inputs": new_inputs, "output": new_output})

        if is_async_function_type(t):
            new_inputs = [finalize(inp, allowed) for inp in t.value["inputs"]]
            new_output = finalize(t.value["output"], allowed)
            if new_output is t.value["output"] and all(
                ni is i for ni, i in zip(new_inputs, t.value["inputs"], strict=True)
            ):
                return t
            return EastVariant("AsyncFunction", {"inputs": new_inputs, "output": new_output})

        # Primitive types, return as-is
        return t

    inner = finalize(node, True)
    built: EastVariant = EastVariant(
        "Recursive", EastVariant("wrapper", {"id": rec_id, "inner": inner})
    )
    return _intern_recursive_wrapper(built)


# =============================================================================
# Type Comparison
# =============================================================================

# Co-inductive assumption stack for comparing recursive wrappers with distinct
# ids (alpha-equivalence). While wrapper(id1) and wrapper(id2) are being
# compared structurally, the pair (id1, id2) is assumed equal so their inner
# ref(id1)/ref(id2) leaves agree — the same reasoning east-c's assumption stack
# uses on its cyclic form, and the TS reference's cache pre-seed on ids.
_rec_eq_assumptions: set[tuple[int, int]] = set()


def _recursive_ids_equal(t1: EastType, t2: EastType) -> bool | None:
    """Resolve the Recursive-vs-Recursive fast paths shared by the comparison family.

    Returns True when the scope ids match or are assumed equal, None when both
    sides are wrappers with distinct ids (caller must compare inners under the
    assumption), and False otherwise.
    """
    p1, p2 = t1.value, t2.value
    id1 = p1.value if p1.type == "ref" else p1.value["id"]
    id2 = p2.value if p2.type == "ref" else p2.value["id"]
    if id1 == id2:
        return True
    if (id1, id2) in _rec_eq_assumptions:
        return True
    if p1.type == "wrapper" and p2.type == "wrapper":
        return None
    return False


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
            fast = _recursive_ids_equal(t1, t2)
            if fast is True:
                return t1
            if fast is None:
                # Distinct wrappers: structurally compare inners under the
                # assumption that their scopes coincide (alpha-equivalence).
                id1 = t1.value.value["id"]
                id2 = t2.value.value["id"]
                _rec_eq_assumptions.add((id1, id2))
                try:
                    type_equal(t1.value.value["inner"], t2.value.value["inner"], r1, r2)
                finally:
                    _rec_eq_assumptions.discard((id1, id2))
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

    # Handle Recursive types
    if is_recursive_type(t1):
        if is_recursive_type(t2):
            fast = _recursive_ids_equal(t1, t2)
            if fast is not None:
                return fast
            id1 = t1.value.value["id"]
            id2 = t2.value.value["id"]
            _rec_eq_assumptions.add((id1, id2))
            try:
                return is_type_equal(t1.value.value["inner"], t2.value.value["inner"], r1, r2)
            finally:
                _rec_eq_assumptions.discard((id1, id2))
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
    # Handle Recursive types, mirroring the TS reference (isSubtypeValueImpl):
    # wrappers are transparent on either side; refs compare by scope id.
    if is_recursive_type(t1) and t1.value.type == "wrapper":
        return is_subtype(t1.value.value["inner"], t2)
    if is_recursive_type(t2) and t2.value.type == "wrapper":
        return is_subtype(t1, t2.value.value["inner"])
    if is_recursive_type(t1):
        return is_recursive_type(t2) and t1.value.value == t2.value.value
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

        # Recursive types: require the same recursive type (exact match, heap
        # invariance) — id fast-path plus alpha-equivalence for foreign ids.
        if is_recursive_type(t1):
            if is_recursive_type(t2):
                if is_type_equal(t1, t2):
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

        # Recursive types: require the same recursive type (exact match, heap
        # invariance) — id fast-path plus alpha-equivalence for foreign ids.
        if is_recursive_type(t1):
            if is_recursive_type(t2):
                if is_type_equal(t1, t2):
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
    "first_mutable_path",
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
