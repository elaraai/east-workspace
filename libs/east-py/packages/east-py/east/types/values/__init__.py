#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East value types - Python representations of East values.

All East value types are prefixed with 'East' for explicit naming:
- EastNull: Unit type (singleton)
- EastBlob: Immutable binary data (extends bytes)
- EastArray: Ordered collection (extends list)
- EastSet: Sorted unique collection
- EastDict: Sorted key-value collection
- EastStruct: Immutable record type (extends dict)
- EastVariant: Tagged union type (extends dict)
- EastOption: Option variant (some/none)
- EastRef: Mutable reference cell

For primitive types (Boolean, Integer, Float, String, DateTime),
Python's built-in types are used directly (bool, int, float, str, datetime).
"""

from east.types.values._helpers import (  # noqa: F401
    EAST_ELEMENT_TO_DTYPE,
    _call_builtin,
    _intern_keys,
    _key_cache,
    _make_east_key,
    dtype_matches_element,
    ensure_utc_datetime,
)
from east.types.values.collections import EastArray, EastDict, EastSet  # noqa: F401
from east.types.values.guards import (  # noqa: F401
    is_east_array,
    is_east_blob,
    is_east_dict,
    is_east_matrix,
    is_east_null,
    is_east_option,
    is_east_set,
    is_east_struct,
    is_east_variant,
    is_east_vector,
)
from east.types.values.primitives import EastBlob, EastNull, east_null  # noqa: F401
from east.types.values.structural import (  # noqa: F401
    REF_SYMBOL,
    EastFunction,
    EastNone,
    EastOption,
    EastRef,
    EastSome,
    EastStruct,
    EastVariant,
    deref,
    east_ref,
    is_east_ref,
    set_ref,
)
from east.types.values.tensor import EastMatrix, EastVector  # noqa: F401
from east.types.values.validation import EastValue, is_value_of, type_of  # noqa: F401

__all__ = [
    # EastValue union type
    "EastValue",
    # EastNull
    "EastNull",
    "east_null",
    # EastBlob
    "EastBlob",
    # Numeric containers
    "EAST_ELEMENT_TO_DTYPE",
    "dtype_matches_element",
    "EastVector",
    "EastMatrix",
    # Containers
    "EastArray",
    "EastSet",
    "EastDict",
    # Structural
    "EastStruct",
    "EastVariant",
    "EastOption",
    "EastSome",
    "EastNone",
    # EastRef
    "EastRef",
    "REF_SYMBOL",
    "east_ref",
    "is_east_ref",
    "deref",
    "set_ref",
    # DateTime
    "ensure_utc_datetime",
    # TypeGuard functions
    "is_east_null",
    "is_east_blob",
    "is_east_vector",
    "is_east_matrix",
    "is_east_array",
    "is_east_set",
    "is_east_dict",
    "is_east_struct",
    "is_east_variant",
    "is_east_option",
    # Type checking and inference
    "is_value_of",
    "type_of",
]

