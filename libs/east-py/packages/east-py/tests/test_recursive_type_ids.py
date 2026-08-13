#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The id-based recursive-type scheme (#18, closing the #475/#478 family).

Recursive types are spelled ``Recursive wrapper({id, inner})`` with every
self-reference a ``Recursive ref(id)`` leaf — the same dialect TypeScript
serializes (east/src/type_of_type.ts) and east-c models with its cyclic
wrapper pointers. The old spelling was a de Bruijn depth integer counting
container levels between the reference and its binder; every consumer had to
reproduce the exact same counting walk, and each divergence was a latent bug
(#475 patch types, #478 print/parse, the #34 shared-subtree rebinding).

These tests pin the scheme end to end: construction shape, interning (same
structure → same wrapper and id), alpha-equivalence against foreign ids,
mutual-recursion rejection, PatchType's back-reference semantics, and the
value operations (validation, ordering, print/parse) across recursive
boundaries — including recursion THROUGH a mutable container, which the old
comparer factories wired to a placeholder that was never filled in.
"""

import pytest

from east import (
    ArrayType,
    DictType,
    EastArray,
    IntegerType,
    NullType,
    RecursiveTypeRef,
    SetType,
    StringType,
    StructType,
    VariantType,
    is_value_of,
    recursive_type,
    variant,
)
from east.serialization.east_parser import parse_east
from east.serialization.east_printer import print_east
from east.types.types import PatchType, is_subtype, is_type_equal, type_equal
from east.types.values.structural import EastStruct, EastVariant
from east.utils.ordering import (
    _py_compare_for,
    _py_equal_for,
    _py_is_for,
    compare_for,
    equal_for,
    is_for,
)

LinkedType = recursive_type(
    lambda self: VariantType([
        ("cons", StructType([("head", IntegerType), ("tail", self)])),
        ("nil", NullType),
    ])
)

TreeType = recursive_type(
    lambda self: VariantType([
        ("children", ArrayType(self)),
        ("leaf", IntegerType),
    ])
)


def _case_type(variant_type, name):
    for case in variant_type.value:
        if case["name"] == name:
            return case["type"]
    raise KeyError(name)


# ── construction shape ───────────────────────────────────────────────────────

def test_recursive_type_builds_wrapper_with_ref_leaves():
    assert LinkedType.type == "Recursive"
    payload = LinkedType.value
    assert payload.type == "wrapper"
    rec_id = payload.value["id"]
    tail = _case_type(payload.value["inner"], "cons").value[1]["type"]
    assert tail.type == "Recursive"
    assert tail.value.type == "ref"
    assert tail.value.value == rec_id


def test_recursive_type_ref_builds_the_ref_form():
    r = RecursiveTypeRef(7)
    assert r.type == "Recursive"
    assert r.value.type == "ref"
    assert r.value.value == 7


def test_structurally_identical_recursive_types_intern_to_one_wrapper():
    twin = recursive_type(
        lambda self: VariantType([
            ("cons", StructType([("head", IntegerType), ("tail", self)])),
            ("nil", NullType),
        ])
    )
    assert twin is LinkedType


def test_a_completed_nested_recursive_type_is_allowed():
    outer = recursive_type(
        lambda self: VariantType([
            ("stop", NullType),
            ("more", StructType([("sub", LinkedType), ("next", self)])),
        ])
    )
    sub = _case_type(outer.value.value["inner"], "more").value[0]["type"]
    assert sub is LinkedType


# ── equality family ──────────────────────────────────────────────────────────

def test_foreign_ids_compare_by_alpha_equivalence():
    # A wrapper minted elsewhere (another process, another runtime) carries a
    # different id for the same structure. Plain structural == sees different
    # ids; is_type_equal must still equate them.
    rec_id = LinkedType.value.value["id"]
    foreign_id = rec_id + 100_000
    foreign = EastVariant("Recursive", EastVariant("wrapper", {
        "id": foreign_id,
        "inner": VariantType([
            ("cons", StructType([
                ("head", IntegerType),
                ("tail", EastVariant("Recursive", EastVariant("ref", foreign_id))),
            ])),
            ("nil", NullType),
        ]),
    }))
    assert foreign != LinkedType
    assert is_type_equal(foreign, LinkedType)
    assert is_type_equal(LinkedType, foreign)
    assert type_equal(foreign, LinkedType) is foreign
    assert not is_type_equal(foreign, TreeType)


def test_subtype_unwraps_wrappers_and_compares_refs_by_id():
    assert is_subtype(LinkedType, LinkedType)
    assert is_subtype(LinkedType.value.value["inner"], LinkedType)
    assert not is_subtype(LinkedType, TreeType)


# ── construction-time validation ─────────────────────────────────────────────

def test_mutual_recursion_is_rejected():
    with pytest.raises(TypeError, match="SCC size 1"):
        recursive_type(
            lambda outer: StructType([
                ("inner", recursive_type(
                    lambda inner: VariantType([
                        ("stop", NullType),
                        ("via_outer", outer),
                        ("again", inner),
                    ])
                )),
            ])
        )


def test_self_reference_in_set_or_dict_key_is_rejected():
    with pytest.raises(TypeError, match="set keys, dictionary keys"):
        recursive_type(
            lambda self: VariantType([
                ("stop", NullType),
                ("bag", SetType(self)),
            ])
        )
    with pytest.raises(TypeError, match="set keys, dictionary keys"):
        recursive_type(
            lambda self: VariantType([
                ("stop", NullType),
                ("index", DictType(self, IntegerType)),
            ])
        )


# ── PatchType over recursive types (#475/#478) ───────────────────────────────

def test_patch_type_back_references_are_replace_only_of_the_whole_type():
    p = PatchType(LinkedType)
    # The outer level patches structurally (the wrapper is transparent).
    assert {c["name"] for c in p.value} == {"unchanged", "replace", "patch"}
    inner_patch = _case_type(p, "patch")
    cons_patch = _case_type(inner_patch, "cons")
    tail_patch = _case_type(cons_patch, "patch").value[1]["type"]
    # The back-reference position carries replace-only semantics, and the
    # replaced value is the WHOLE recursive type — never a bare back-ref.
    assert {c["name"] for c in tail_patch.value} == {"unchanged", "replace"}
    replace_struct = _case_type(tail_patch, "replace")
    assert replace_struct.value[0]["type"] is LinkedType
    assert replace_struct.value[1]["type"] is LinkedType


def test_patch_type_raises_on_a_detached_ref():
    with pytest.raises(ValueError, match="unresolved Recursive ref"):
        PatchType(RecursiveTypeRef(3))


# ── value operations across the recursive boundary ───────────────────────────

def _linked(*items):
    value = variant("nil", None)
    for head in reversed(items):
        value = variant("cons", EastStruct({"head": head, "tail": value}))
    return value


def test_validation_resolves_refs_through_their_wrapper():
    good = _linked(1, 2, 3)
    assert is_value_of(good, LinkedType)
    assert not is_value_of(variant("cons", EastStruct({"head": 1, "tail": 2})), LinkedType)


def test_assert_and_explain_resolve_recursive_refs():
    # The platform-function output-validation path: assert_value_of walks the
    # declared (recursive) output type. XmlNodeType and BsonValueType route
    # every east-py-io XML/Mongo result through exactly this.
    from east.types.coercion import assert_value_of, explain_value_of

    good = _linked(1, 2)
    assert assert_value_of(good, LinkedType) is good
    assert explain_value_of(good, LinkedType) == []
    bad = variant("cons", EastStruct({"head": 1, "tail": 2}))
    assert explain_value_of(bad, LinkedType)


def test_coerce_to_builds_recursive_values_from_plain_data():
    from east import coerce_to

    plain = {"type": "cons", "value": {
        "head": 1,
        "tail": {"type": "cons", "value": {
            "head": 2,
            "tail": {"type": "nil", "value": None},
        }},
    }}
    v = coerce_to(plain, LinkedType)
    assert is_value_of(v, LinkedType)
    assert equal_for(LinkedType)(v, _linked(1, 2))


def test_ordering_through_a_struct_field_back_reference():
    a, b, c = _linked(1, 2), _linked(1, 2), _linked(1, 3)
    for eq in (equal_for, _py_equal_for):
        assert eq(LinkedType)(a, b)
        assert not eq(LinkedType)(a, c)
    for cmp in (compare_for, _py_compare_for):
        assert cmp(LinkedType)(a, b) == 0
        assert cmp(LinkedType)(a, c) == -1
        assert cmp(LinkedType)(c, a) == 1
    for isf in (is_for, _py_is_for):
        assert isf(LinkedType)(a, a)


def test_ordering_through_a_mutable_container_back_reference():
    # Recursion THROUGH an Array: the old comparer factories parked a None
    # placeholder on their context stack and only swapped the real comparer
    # in AFTER the element comparer had already captured it — a back-edge
    # through Array/Set/Dict/Ref produced a None "comparer" that blew up at
    # call time. The forward-cell registration fixes this by construction.
    def tree(*kids):
        return variant("children", EastArray(TreeType, list(kids)))

    leaf1, leaf2 = variant("leaf", 1), variant("leaf", 2)
    a = tree(leaf1, tree(leaf2))
    b = tree(leaf1, tree(leaf2))
    c = tree(leaf2)
    for eq in (equal_for, _py_equal_for):
        assert eq(TreeType)(a, b)
        assert not eq(TreeType)(a, c)
    for cmp in (compare_for, _py_compare_for):
        assert cmp(TreeType)(a, b) == 0
        assert cmp(TreeType)(a, c) != 0


def test_print_parse_round_trip_of_a_recursive_value():
    value = _linked(10, 20)
    text = print_east(value, LinkedType)
    back = parse_east(LinkedType, text)
    assert equal_for(LinkedType)(value, back)

    nested = variant("children", EastArray(TreeType, [
        variant("leaf", 1),
        variant("children", EastArray(TreeType, [variant("leaf", 2)])),
    ]))
    text = print_east(nested, TreeType)
    back = parse_east(TreeType, text)
    assert equal_for(TreeType)(nested, back)


def test_comparers_reject_a_detached_ref():
    for factory in (equal_for, compare_for, is_for,
                    _py_equal_for, _py_compare_for, _py_is_for):
        with pytest.raises(ValueError, match="unresolved Recursive ref"):
            factory(RecursiveTypeRef(9))


def test_validation_rejects_a_detached_ref():
    with pytest.raises(ValueError, match="unresolved Recursive ref"):
        is_value_of(variant("nil", None), RecursiveTypeRef(9))


def test_recursive_types_may_key_nothing_but_serve_as_data():
    from east.types.types import is_data_type, is_immutable_type

    assert is_data_type(LinkedType)
    assert is_immutable_type(LinkedType)
    assert not is_immutable_type(recursive_type(
        lambda self: VariantType([
            ("stop", NullType),
            ("many", ArrayType(self)),
        ])
    ))


def test_dict_keyed_by_an_immutable_recursive_type():
    d_type = DictType(LinkedType, StringType)
    key_type = d_type.value["key"]
    assert key_type is LinkedType
    from east import EastDict

    d = EastDict(LinkedType, StringType)
    d[_linked(1)] = "one"
    d[_linked(1, 2)] = "one-two"
    assert d[_linked(1)] == "one"
    assert d[_linked(1, 2)] == "one-two"
    assert len(d) == 2
