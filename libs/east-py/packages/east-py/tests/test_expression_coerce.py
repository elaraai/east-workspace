#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``east.expression.lift._coerce`` — the python twin of ``coerce_to`` in
``ast_to_ir.ts`` (#627): ``libs/east/src/ast_to_ir.coerce_to.spec.ts``
ported section by section. The helper is the core of deep-As rewriting: a
Struct or Variant literal widens by re-typing the node (its fields/payload
in turn), anything else widens through one outer ``As``.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from east import (
    ArrayType,
    AsyncFunctionType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    FunctionType,
    IntegerType,
    MatrixType,
    NeverType,
    NullType,
    OptionType,
    RefType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
)
from east.expression import Expression, ExpressionError
from east.expression.lift import _coerce
from east.ir.builders import ir_call, ir_error, ir_struct, ir_value, ir_variable, ir_variant
from east.types.types import recursive_type

LOC = 1


def mk_value(t, v):
    return Expression(ir_value(t, v, LOC), t)


def mk_variable(t, name="v"):
    return Expression(ir_variable(t, name, LOC), t)


def mk_call(t):
    return Expression(ir_call(t, ir_variable(FunctionType([], t), "f", LOC), [], LOC), t)


def mk_variant(case, inner_t, inner_v, declared):
    return Expression(ir_variant(declared, case, ir_value(inner_t, inner_v, LOC), LOC), declared)


def mk_struct(declared, fields):
    return Expression(ir_struct(declared, fields, LOC), declared)


def field(struct_node, name):
    return next(f["value"] for f in struct_node.value["fields"] if f["name"] == name)


# ── §1 identity ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("t", [IntegerType, FloatType, StringType, BooleanType, NullType,
                               DateTimeType, BlobType])
def test_identity_returns_the_same_expression_for_scalars(t):
    e = mk_variable(t)
    assert _coerce(e, t) is e


@pytest.mark.parametrize("t", [
    StructType([("a", IntegerType), ("b", StringType)]),
    VariantType([("some", IntegerType), ("none", NullType)]),
    ArrayType(IntegerType), DictType(StringType, IntegerType), SetType(IntegerType),
    RefType(IntegerType), VectorType(FloatType), MatrixType(FloatType),
    FunctionType([IntegerType], IntegerType), AsyncFunctionType([IntegerType], IntegerType),
])
def test_identity_returns_the_same_expression_for_compounds(t):
    e = mk_variable(t)
    assert _coerce(e, t) is e


# ── §2 invalid widening ─────────────────────────────────────────────────────


def test_invalid_widening_raises():
    with pytest.raises(ExpressionError, match="not a subtype"):
        _coerce(mk_value(IntegerType, 1), StringType)
    with pytest.raises(ExpressionError, match="not a subtype"):
        _coerce(mk_value(StringType, "x"), IntegerType)
    narrow = VariantType([("some", IntegerType)])
    wide = VariantType([("some", IntegerType), ("none", NullType)])
    out = _coerce(mk_variant("some", IntegerType, 1, narrow), wide)
    assert out.ir.type == "Variant"
    with pytest.raises(ExpressionError, match="not a subtype"):
        _coerce(mk_variable(wide), narrow)


# ── §3 variant narrow → wide ────────────────────────────────────────────────


def test_variant_rewrites_to_the_option_type_without_an_outer_as():
    narrow = VariantType([("some", IntegerType)])
    wide = OptionType(IntegerType)
    out = _coerce(mk_variant("some", IntegerType, 42, narrow), wide)
    assert out.ir.type == "Variant"
    assert out.ir.value["case"] == "some"
    assert out.ir.value["type"] == wide
    assert out.east_type == wide


def test_variant_widening_keeps_the_inner_value_by_reference():
    narrow = VariantType([("a", IntegerType)])
    wide = VariantType([("a", IntegerType), ("b", StringType), ("c", NullType)])
    inner = ir_value(IntegerType, 7, LOC)
    e = Expression(ir_variant(narrow, "a", inner, LOC), narrow)
    out = _coerce(e, wide)
    assert out.ir.value["value"] is inner
    assert out.ir.value["type"] == wide


def test_variant_widens_a_covariant_inner_case():
    narrow_inner = VariantType([("ok", IntegerType)])
    wide_inner = VariantType([("ok", IntegerType), ("err", StringType)])
    narrow = VariantType([("wrapper", narrow_inner)])
    wide = VariantType([("wrapper", wide_inner)])
    inner = mk_variant("ok", IntegerType, 1, narrow_inner)
    outer = Expression(ir_variant(narrow, "wrapper", inner.ir, LOC), narrow)
    out = _coerce(outer, wide)
    assert out.ir.value["type"] == wide
    assert out.ir.value["value"].value["type"] == wide_inner  # the deep-As invariant


# ── §4 struct fields ────────────────────────────────────────────────────────


def test_struct_rewrites_a_narrow_field_at_its_position():
    narrow_area = VariantType([("some", StringType)])
    wide_area = OptionType(StringType)
    Narrow = StructType([("area", narrow_area)])
    Wide = StructType([("area", wide_area)])
    out = _coerce(mk_struct(Narrow, [("area", mk_variant("some", StringType, "A", narrow_area).ir)]), Wide)
    assert out.ir.type == "Struct"
    assert out.ir.value["type"] == Wide
    area = field(out.ir, "area")
    assert area.type == "Variant"
    assert area.value["type"] == wide_area


def test_struct_leaves_equal_typed_fields_by_reference():
    narrow_area = VariantType([("some", StringType)])
    Narrow = StructType([("area", narrow_area), ("date", DateTimeType)])
    Wide = StructType([("area", OptionType(StringType)), ("date", DateTimeType)])
    date_ir = ir_value(DateTimeType, datetime(2025, 1, 1, tzinfo=UTC), LOC)
    out = _coerce(mk_struct(Narrow, [("area", mk_variant("some", StringType, "A", narrow_area).ir),
                                     ("date", date_ir)]), Wide)
    # By VALUE here: the field array is a C-backed EastArray, so python
    # object identity does not survive a read; the node is untouched.
    assert field(out.ir, "date") == date_ir


def test_struct_coerces_several_fields_with_different_widenings():
    n1, w1 = VariantType([("some", IntegerType)]), OptionType(IntegerType)
    n2, w2 = VariantType([("ok", StringType)]), VariantType([("ok", StringType), ("err", StringType)])
    Narrow = StructType([("a", n1), ("b", n2)])
    Wide = StructType([("a", w1), ("b", w2)])
    out = _coerce(mk_struct(Narrow, [("a", mk_variant("some", IntegerType, 5, n1).ir),
                                     ("b", mk_variant("ok", StringType, "done", n2).ir)]), Wide)
    assert field(out.ir, "a").value["type"] == w1
    assert field(out.ir, "b").value["type"] == w2


def test_struct_rewrite_preserves_the_outer_loc_id():
    narrow_f, wide_f = VariantType([("some", IntegerType)]), OptionType(IntegerType)
    Narrow, Wide = StructType([("f", narrow_f)]), StructType([("f", wide_f)])
    inner = mk_variant("some", IntegerType, 1, narrow_f)
    e = Expression(ir_struct(Narrow, [("f", inner.ir)], 99), Narrow)
    out = _coerce(e, Wide)
    assert out.ir.value["loc_id"] == 99


# ── §5 nested compounds ─────────────────────────────────────────────────────


def test_struct_in_struct_in_variant_rewrites_every_level():
    narrow_v, wide_v = VariantType([("some", StringType)]), OptionType(StringType)
    NarrowInner, WideInner = StructType([("x", narrow_v)]), StructType([("x", wide_v)])
    Narrow, Wide = StructType([("nested", NarrowInner)]), StructType([("nested", WideInner)])
    leaf = mk_variant("some", StringType, "A", narrow_v)
    inner = mk_struct(NarrowInner, [("x", leaf.ir)])
    out = _coerce(mk_struct(Narrow, [("nested", inner.ir)]), Wide)
    assert out.ir.value["type"] == Wide
    nested = field(out.ir, "nested")
    assert nested.value["type"] == WideInner
    assert field(nested, "x").value["type"] == wide_v


def test_variant_containing_struct_containing_variant():
    n_leaf, w_leaf = VariantType([("some", IntegerType)]), OptionType(IntegerType)
    NarrowStruct, WideStruct = StructType([("val", n_leaf)]), StructType([("val", w_leaf)])
    Narrow = VariantType([("wrap", NarrowStruct)])
    Wide = VariantType([("wrap", WideStruct), ("other", NullType)])
    leaf = mk_variant("some", IntegerType, 7, n_leaf)
    struct = mk_struct(NarrowStruct, [("val", leaf.ir)])
    outer = Expression(ir_variant(Narrow, "wrap", struct.ir, LOC), Narrow)
    out = _coerce(outer, Wide)
    assert out.ir.type == "Variant" and out.ir.value["type"] == Wide
    inner_struct = out.ir.value["value"]
    assert inner_struct.type == "Struct" and inner_struct.value["type"] == WideStruct
    assert field(inner_struct, "val").value["type"] == w_leaf


# ── §6 opaque source → As ───────────────────────────────────────────────────


def test_variable_of_narrow_type_wraps_in_as():
    narrow, wide = VariantType([("some", IntegerType)]), OptionType(IntegerType)
    e = mk_variable(narrow, "x")
    out = _coerce(e, wide)
    assert out.ir.type == "As"
    assert out.ir.value["type"] == wide
    assert out.ir.value["value"] is e.ir


def test_call_of_narrow_type_wraps_in_as():
    narrow, wide = VariantType([("some", StringType)]), OptionType(StringType)
    e = mk_call(narrow)
    out = _coerce(e, wide)
    assert out.ir.type == "As" and out.ir.value["value"] is e.ir


def test_never_widens_to_anything_through_as():
    never = Expression(ir_error(NeverType, ir_value(StringType, "boom", LOC), LOC), NeverType)
    out = _coerce(never, IntegerType)
    assert out.ir.type == "As" and out.ir.value["type"] == IntegerType


def test_struct_to_the_same_struct_is_a_no_op():
    S = StructType([("a", IntegerType)])
    e = mk_struct(S, [("a", ir_value(IntegerType, 1, LOC))])
    assert _coerce(e, S) is e


# ── §7 invariant containers ─────────────────────────────────────────────────


@pytest.mark.parametrize("make", [ArrayType, SetType, RefType])
def test_containers_are_invariant(make):
    narrow = make(VariantType([("some", IntegerType)]))
    wide = make(OptionType(IntegerType))
    assert _coerce(mk_variable(narrow), narrow).ir.type == "Variable"
    with pytest.raises(ExpressionError, match="not a subtype"):
        _coerce(mk_variable(narrow), wide)


def test_dict_values_are_invariant():
    narrow = DictType(StringType, VariantType([("some", IntegerType)]))
    wide = DictType(StringType, OptionType(IntegerType))
    with pytest.raises(ExpressionError, match="not a subtype"):
        _coerce(mk_variable(narrow), wide)


def test_vector_and_matrix_elements_are_scalars_only():
    with pytest.raises(Exception, match="element type"):
        VectorType(VariantType([("some", FloatType)]))
    with pytest.raises(Exception, match="element type"):
        MatrixType(VariantType([("some", FloatType)]))


# ── §8 recursive types ──────────────────────────────────────────────────────


def test_equal_recursive_types_are_a_no_op():
    R = recursive_type(lambda self: VariantType([("nil", NullType), ("cons", self)]))
    e = Expression(ir_variant(R, "nil", ir_value(NullType, None, LOC), LOC), R)
    assert _coerce(e, R) is e


def test_nested_recursive_widening_terminates(monkeypatch):
    """A recursive type coerced to itself is the identity in ONE step — the
    equal-type fast path answers before anything descends into the wrapper,
    so a nested self-reference cannot recurse (a clock used to guard this;
    the call count is the mechanism)."""
    import east.expression.lift as lift

    calls = []
    real = lift._coerce
    monkeypatch.setattr(lift, "_coerce", lambda *a, **k: calls.append(1) or real(*a, **k))
    R = recursive_type(lambda self: VariantType([("nil", NullType), ("cons", self)]))
    e = Expression(ir_variant(R, "cons", ir_variable(R, "inner", LOC), LOC), R)
    assert lift._coerce(e, R) is e
    assert len(calls) == 1


# ── §9 determinism ──────────────────────────────────────────────────────────


def test_rewrite_is_deterministic_and_does_not_mutate_its_input():
    narrow, wide = VariantType([("some", IntegerType)]), OptionType(IntegerType)
    a1 = mk_variant("some", IntegerType, 42, narrow)
    a2 = mk_variant("some", IntegerType, 42, narrow)
    r1, r2 = _coerce(a1, wide), _coerce(a2, wide)
    assert r1.ir.value["type"] == r2.ir.value["type"]
    assert r1.ir.value["case"] == r2.ir.value["case"]
    before = a1.ir.value["type"]
    _coerce(a1, wide)
    assert a1.ir.value["type"] is before
