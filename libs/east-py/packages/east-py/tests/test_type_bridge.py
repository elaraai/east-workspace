#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Reverse type-bridge tests — C EastType* → Python EastType reconstruction.

Covers the east-c bridge's reverse converter (``c_type_ptr_to_py_type``):

- Recursive types reconstruct in the id dialect — ``wrapper({id, inner})``
  binding the scope, ``ref(id)`` at every back-edge — and intern through
  types.py's recursive-type registry, so the forward → reverse round-trip
  returns the SAME canonical wrapper object (not merely an equal one).
- Back-edges are position-independent: a back-edge through a Dict, an Array,
  or at two different nesting depths is the same ``ref(id)`` everywhere.
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

# Back-edge through a Dict: Variant{ leaf: Integer, document: Dict<String, self> }.
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
    # Round-trip is the identity: the reverse converter interns through the
    # same registry recursive_type used, so the canonical wrapper comes back.
    assert rt is DocType
    # The back-edge through the Dict is a ref bound to the wrapper's own id.
    rec_id = rt.value.value["id"]
    back_edge = _case_type(rt.value.value["inner"], "document").value["value"]
    assert back_edge.type == "Recursive"
    assert back_edge.value.type == "ref"
    assert back_edge.value.value == rec_id
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
    assert rt is TreeType
    rec_id = rt.value.value["id"]
    back_edge = _case_type(rt.value.value["inner"], "children").value
    assert back_edge.type == "Recursive"
    assert back_edge.value.type == "ref"
    assert back_edge.value.value == rec_id
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
    LinkedType = recursive_type(
        lambda self: VariantType([
            ("nil", IntegerType),
            ("node", StructType([("next", self)])),
        ])
    )
    rt = _roundtrip(LinkedType)
    assert rt is LinkedType
    rec_id = rt.value.value["id"]
    back_edge = _case_type(rt.value.value["inner"], "node").value[0]["type"]
    assert back_edge.type == "Recursive"
    assert back_edge.value.type == "ref"
    assert back_edge.value.value == rec_id


def test_reverse_caches_are_scoped_per_conversion():
    # The reverse caches (_py_type_cache, _rev_rec_ids) are cdef module-level
    # globals — Cython does not expose them in the module dict, so they cannot
    # be inspected directly from Python. Assert that (so this test is revisited
    # if they ever become introspectable) and verify the observable contract
    # instead: nothing is memoized across top-level conversions, so repeated
    # and interleaved conversions are independently correct.
    bridge = east._eastc_bridge
    assert not hasattr(bridge, "_py_type_cache")
    assert not hasattr(bridge, "_rev_rec_ids")

    doc_arr = EastArray(DocType, [])
    tree_arr = EastArray(TreeType, [])
    for _ in range(3):
        assert c_type_ptr_to_py_type(doc_arr._c_elem_type_ptr) is DocType
        assert c_type_ptr_to_py_type(tree_arr._c_elem_type_ptr) is TreeType

    # A conversion that frees its C type must not poison a later conversion:
    # release DocType's proxy (dropping its retained pointer), then convert a
    # different type and re-check it.
    del doc_arr
    assert c_type_ptr_to_py_type(tree_arr._c_elem_type_ptr) is TreeType


def test_shared_interned_subtree_at_two_depths():
    # A recursive subtree that appears at two different nesting depths shares
    # ONE interned C pointer (issue #34 H2 in the old depth dialect). Under
    # ids, back-edges are position-independent: both occurrences reconstruct
    # as the same ref(id), whatever depth the shared pointer is re-hit at.
    #
    #   X = Struct{ a: Array<X>, b: Struct{ inner: Array<X> } }
    XType = recursive_type(
        lambda self: StructType([
            ("a", ArrayType(self)),
            ("b", StructType([("inner", ArrayType(self))])),
        ])
    )

    rt = _roundtrip(XType)
    assert rt is XType

    rec_id = rt.value.value["id"]
    fields = {f["name"]: f["type"] for f in rt.value.value["inner"].value}
    a_back = fields["a"].value  # Array payload
    assert a_back.type == "Recursive"
    assert a_back.value.type == "ref"
    assert a_back.value.value == rec_id

    inner_fields = {f["name"]: f["type"] for f in fields["b"].value}
    b_back = inner_fields["inner"].value  # Array payload of nested struct
    assert b_back.type == "Recursive"
    assert b_back.value.type == "ref"
    assert b_back.value.value == rec_id

    # A conforming value validates against the reconstructed type.
    empty = EastArray(XType, [])
    leaf = east.EastStruct({"a": empty, "b": east.EastStruct({"inner": empty})})
    value = east.EastStruct({"a": EastArray(XType, [leaf]),
                             "b": east.EastStruct({"inner": empty})})
    assert is_value_of(value, rt)
    assert is_value_of(value, XType)
