#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Reverse type-bridge tests — C EastType* → Python EastType reconstruction.

Covers the east-c bridge's reverse converter (``c_type_ptr_to_py_type``):

- Recursive types whose back-edge passes THROUGH a container (Dict, Array)
  must reconstruct with the same ``Recursive(depth)`` as the canonical depth
  model (``replace_markers`` in east/types/types.py): every container level
  counts, so the forward → reverse round-trip is the identity.
- The reverse caches are scoped to a single top-level conversion, so repeated
  and interleaved conversions never bleed state across calls.

Forward conversion (``py_type_to_c``) is cdef-only; tests reach it through
the ``EastArray`` proxy, whose constructor forward-converts its element type
and retains the resulting C pointer in ``_c_elem_type_ptr``.
"""

import pytest

pytest.importorskip("east._eastc_bridge")

from east._eastc_bridge import c_type_ptr_to_py_type  # noqa: E402

import east  # noqa: E402
from east import (  # noqa: E402
    ArrayType,
    DictType,
    EastArray,
    EastDict,
    IntegerType,
    StringType,
    StructType,
    VariantType,
    is_value_of,
    recursive_type,
    variant,
)

# Note: value checks below use is_value_of with directly-built values rather
# than coerce_to. Coercing against recursive-through-container types is a
# separate, pre-existing limitation: _coerce constructs container proxies
# whose element type is a bare Recursive(n) fragment, which the forward
# bridge rejects ("Invalid recursive type depth") even for hand-built Python
# types that never went through the reverse bridge.

# Back-edge through a Dict: Variant{ leaf: Integer, document: Dict<String, self> }.
# replace_markers counts the Variant level (1) and the Dict level (2),
# so the back-edge is Recursive(2).
DocType = recursive_type(
    lambda self: VariantType([
        ("document", DictType(StringType, self)),
        ("leaf", IntegerType),
    ])
)

# Back-edge through an Array: Variant{ leaf: Integer, children: Array<self> }.
TreeType = recursive_type(
    lambda self: VariantType([
        ("children", ArrayType(self)),
        ("leaf", IntegerType),
    ])
)


def _roundtrip(py_type):
    """Forward-convert py_type to a C EastType*, then reverse-convert it.

    The EastArray proxy holds a retained pointer to the forward-converted
    element type, which keeps it live for the reverse conversion.
    """
    arr = EastArray(py_type, [])
    return c_type_ptr_to_py_type(arr._c_elem_type_ptr)


def _case_type(variant_type, name):
    """Get the payload type of a variant case by name."""
    for case in variant_type.value:
        if case["name"] == name:
            return case["type"]
    raise KeyError(name)


def test_roundtrip_recursive_through_dict():
    rt = _roundtrip(DocType)
    # Round-trip is the identity (structural type equality)
    assert rt == DocType
    # The back-edge counts the Dict container level: Recursive(2), not (1)
    back_edge = _case_type(rt, "document").value["value"]
    assert back_edge.type == "Recursive"
    assert back_edge.value == 2
    # A conforming recursive value validates against the reconstructed type
    inner = EastDict(StringType, DocType)
    inner["a"] = variant("leaf", 1)
    inner["b"] = variant("document", EastDict(StringType, DocType))
    value = variant("document", inner)
    assert is_value_of(value, rt)
    assert is_value_of(value, DocType)
    # And a non-conforming one does not
    assert not is_value_of(variant("document", inner["a"]), rt)


def test_roundtrip_recursive_through_array():
    rt = _roundtrip(TreeType)
    assert rt == TreeType
    # The back-edge counts the Array container level: Recursive(2), not (1)
    back_edge = _case_type(rt, "children").value
    assert back_edge.type == "Recursive"
    assert back_edge.value == 2
    children = EastArray(
        TreeType,
        [variant("leaf", 1), variant("children", EastArray(TreeType, []))],
    )
    value = variant("children", children)
    assert is_value_of(value, rt)
    assert is_value_of(value, TreeType)
    # And a non-conforming one does not
    assert not is_value_of(variant("children", variant("leaf", 1)), rt)


def test_roundtrip_recursive_through_struct_field():
    # Direct Struct back-edge (the previously working case): one level
    LinkedType = recursive_type(
        lambda self: VariantType([
            ("nil", IntegerType),
            ("node", StructType([("next", self)])),
        ])
    )
    rt = _roundtrip(LinkedType)
    assert rt == LinkedType
    back_edge = _case_type(rt, "node").value[0]["type"]
    assert back_edge.type == "Recursive"
    assert back_edge.value == 2  # Variant level + Struct level


def test_reverse_caches_are_scoped_per_conversion():
    # The reverse caches (_py_type_cache, _type_convert_stack) are cdef
    # module-level globals — Cython does not expose them in the module dict,
    # so they cannot be inspected directly from Python. Assert that (so this
    # test is revisited if they ever become introspectable) and verify the
    # observable contract instead: nothing is memoized across top-level
    # conversions, so repeated and interleaved conversions are independently
    # correct.
    bridge = east._eastc_bridge
    assert not hasattr(bridge, "_py_type_cache")
    assert not hasattr(bridge, "_type_convert_stack")

    doc_arr = EastArray(DocType, [])
    tree_arr = EastArray(TreeType, [])
    for _ in range(3):
        assert c_type_ptr_to_py_type(doc_arr._c_elem_type_ptr) == DocType
        assert c_type_ptr_to_py_type(tree_arr._c_elem_type_ptr) == TreeType

    # A conversion that frees its C type must not poison a later conversion:
    # release DocType's proxy (dropping its retained pointer), then convert a
    # different type and re-check it.
    del doc_arr
    assert c_type_ptr_to_py_type(tree_arr._c_elem_type_ptr) == TreeType
