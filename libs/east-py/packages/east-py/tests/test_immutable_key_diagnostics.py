#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""`SetType`/`DictType` immutability errors name the offending field (#522).

The rule itself is right — a Set element and a Dict key must be immutable — and
these tests do not relax it. What they pin is the DIAGNOSTIC: `is_immutable_type`
already walks the type recursively to reach its verdict and then discarded the
location, so the constructors could only print the whole offending type inline
and leave the reader to hunt for the mutable part. The issue's real case had
~12 fields with one nested array and produced roughly 40 lines of printed type
on a single line.
"""

import pytest

from east import (
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    IntegerType,
    MatrixType,
    OptionType,
    RefType,
    SetType,
    StringType,
    StructType,
    VectorType,
)
from east.types.types import (
    AsyncFunctionType,
    FunctionType,
    RecursiveType,
    VariantType,
    first_mutable_path,
    is_immutable_type,
)

# The issue's reproduction, verbatim.
READING = StructType([("heading", StringType), ("value", OptionType(FloatType))])
RECORD = StructType([
    ("a", OptionType(StringType)),
    ("b", OptionType(StringType)),
    ("c", OptionType(StringType)),
    ("d", OptionType(StringType)),
    ("e", OptionType(StringType)),
    ("f", OptionType(StringType)),
    ("readings", ArrayType(READING)),      # the only mutable field
])


def test_the_issues_reproduction_names_the_offending_field():
    with pytest.raises(TypeError) as excinfo:
        SetType(StructType([("k", StringType), ("record", RECORD)]))
    msg = str(excinfo.value)
    # the cause is named, with its path...
    assert "field 'record.readings'" in msg
    assert "is Array (mutable)" in msg
    # ...the sentence that explains the problem is on the FIRST line, not
    # drowned by the printed type...
    first_line = msg.splitlines()[0]
    assert "record.readings" in first_line
    assert ".Struct" not in first_line
    # ...and the full type is still available, just below.
    assert "full type:" in msg
    assert ".Struct" in msg


def test_dict_key_gets_the_identical_treatment():
    with pytest.raises(TypeError) as excinfo:
        DictType(StructType([("id", IntegerType), ("tags", SetType(StringType))]), FloatType)
    msg = str(excinfo.value)
    assert "Dict key type must be an immutable type" in msg
    assert "field 'tags' is Set (mutable)" in msg


def test_a_directly_mutable_type_says_so_without_inventing_a_field():
    """No struct to point into — the message must not print an empty path."""
    with pytest.raises(TypeError) as excinfo:
        SetType(ArrayType(IntegerType))
    msg = str(excinfo.value)
    assert "but it is Array (mutable)" in msg
    assert "field ''" not in msg


@pytest.mark.parametrize(
    ("typ", "want_path", "want_kind"),
    [
        # depth, and left-to-right order within a struct
        (StructType([("x", IntegerType), ("y", ArrayType(IntegerType))]), "y", "Array"),
        (StructType([("y", ArrayType(IntegerType)), ("x", SetType(IntegerType))]), "y", "Array"),
        (StructType([("a", StructType([("b", StructType([("c", RefType(IntegerType))]))]))]),
         "a.b.c", "Ref"),
        # variant cases use `|`, so a case is never mistaken for a field
        # a LEADING variant case keeps its `|`, so it can never be read as a
        # struct field (the outermost struct field is the only bare segment)
        (VariantType([("left", IntegerType), ("right", ArrayType(StringType))]),
         "|right", "Array"),
        (OptionType(StructType([("x", ArrayType(IntegerType))])), "|some.x", "Array"),
        (StructType([("opt", OptionType(DictType(StringType, IntegerType)))]),
         "opt|some", "Dict"),
        # functions are mutable-for-this-purpose too
        (StructType([("f", FunctionType([IntegerType], IntegerType))]), "f", "Function"),
    ],
)
def test_the_path_points_at_the_first_offender_in_east_order(typ, want_path, want_kind):
    found = first_mutable_path(typ)
    assert found is not None
    path, offender = found
    assert (path, offender.type) == (want_path, want_kind)


@pytest.mark.parametrize(
    "typ",
    [
        IntegerType,
        StringType,
        OptionType(FloatType),
        StructType([("a", IntegerType), ("b", OptionType(StringType))]),
        VariantType([("l", IntegerType), ("r", StringType)]),
        # Vector and Matrix are immutable VALUE types in East, so they are
        # legal Set elements — the issue's suggested message listed them as
        # mutable, which would have been wrong.
        VectorType(FloatType),
        MatrixType(BooleanType),
        StructType([("v", VectorType(FloatType))]),
    ],
)
def test_immutable_types_have_no_mutable_path(typ):
    assert first_mutable_path(typ) is None
    assert is_immutable_type(typ)
    SetType(typ)          # and the constructors accept them


def test_vector_and_matrix_really_are_accepted_as_set_elements():
    """The behaviour the parametrized case above depends on, stated outright —
    if this ever changes, `_MUTABLE_KINDS` must change with it."""
    assert SetType(VectorType(FloatType)).type == "Set"
    assert DictType(MatrixType(FloatType), StringType).type == "Dict"


@pytest.mark.parametrize(
    "typ",
    [
        IntegerType,
        ArrayType(IntegerType),
        SetType(IntegerType),
        DictType(StringType, IntegerType),
        RefType(IntegerType),
        VectorType(FloatType),
        MatrixType(FloatType),
        FunctionType([IntegerType], IntegerType),
        OptionType(FloatType),
        OptionType(ArrayType(FloatType)),
        StructType([("a", IntegerType)]),
        StructType([("a", ArrayType(IntegerType))]),
        StructType([("a", StructType([("b", SetType(StringType))]))]),
        VariantType([("l", IntegerType), ("r", StringType)]),
        VariantType([("l", IntegerType), ("r", DictType(StringType, IntegerType))]),
    ],
)
def test_first_mutable_path_agrees_with_is_immutable_type(typ):
    """The two must never disagree.

    They cannot, because both are `_find_mutable` — but that is a property of
    the current structure, not of the API, and re-forking them into two walks
    over the same rule is the obvious refactor to reach for. The failure mode
    if anyone does is a message naming a field for a type that was ACCEPTED, or
    a rejection the message cannot explain. Cheap to keep pinned.
    """
    assert (first_mutable_path(typ) is None) == is_immutable_type(typ)


def test_a_recursive_type_terminates_and_agrees():
    """A recursive type must terminate and still name its offender.

    NB what actually makes this terminate is the ``Recursive`` back-reference
    marker: ``RecursiveType`` replaces every self-reference with an integer
    marker node, which `_find_mutable` does not recurse into. The
    ``recursive_type`` parameter is a second, inherited guard that nothing in
    the tree ever passes — deleting it changes no behaviour here, so this test
    does NOT cover it and should not claim to.
    """
    tree = RecursiveType(lambda self: VariantType([
        ("leaf", IntegerType),
        ("node", StructType([("kids", ArrayType(self))])),
    ]))
    assert (first_mutable_path(tree) is None) == is_immutable_type(tree)
    # this particular one IS mutable (an Array under the `node` case), and the
    # path names it: the leading segment carries no separator, so a top-level
    # variant case reads like a field, and `.kids` is the struct field below it
    found = first_mutable_path(tree)
    assert found is not None
    assert found[0] == "|node.kids"      # `node` is a CASE, `kids` a field
    assert found[1].type == "Array"


def _sample_of(kind):
    """A minimal type of each mutable kind — no `None` holes.

    An earlier version skipped AsyncFunction with a `continue`, which meant
    deleting that entry from `_MUTABLE_KINDS` made async functions legal Set
    elements and Dict keys with the whole suite still green.
    """
    return {
        "Array": ArrayType(IntegerType),
        "Set": SetType(IntegerType),
        "Dict": DictType(StringType, IntegerType),
        "Ref": RefType(IntegerType),
        "Function": FunctionType([IntegerType], IntegerType),
        "AsyncFunction": AsyncFunctionType([IntegerType], IntegerType),
    }[kind]


@pytest.mark.parametrize(
    "kind", ["Array", "Set", "Dict", "Ref", "Function", "AsyncFunction"])
def test_every_listed_mutable_kind_is_actually_rejected(kind):
    """A wrong list is worse than none — a reader trusts it to explain WHY.

    Parametrized over the kinds SPELLED OUT here rather than iterating
    `_MUTABLE_KINDS`: iterating the constant means deleting an entry deletes
    its own test case, so the mutant passes. The list below is the independent
    statement of what the rule must reject.
    """
    from east.types.types import _MUTABLE_KINDS

    assert kind in _MUTABLE_KINDS, f"{kind} dropped out of _MUTABLE_KINDS"
    sample = _sample_of(kind)
    assert not is_immutable_type(sample), f"{kind} is listed but is accepted"
    with pytest.raises(TypeError):
        SetType(sample)
    with pytest.raises(TypeError):
        DictType(sample, StringType)


def test_the_message_actually_names_the_mutable_kinds():
    """The "Mutable kinds: …" clause is part of the explanation, so pin it.

    Nothing asserted its CONTENT before: the message could have carried the
    issue's own (incorrect) list — which calls Vector and Matrix mutable — or
    dropped the clause entirely, and every test still passed.
    """
    with pytest.raises(TypeError) as excinfo:
        SetType(ArrayType(IntegerType))
    msg = str(excinfo.value)
    assert "Mutable kinds: Array, Set, Dict, Ref, Function, AsyncFunction." in msg
    # the two the issue wrongly listed must NOT appear in the clause
    clause = msg.split("Mutable kinds:")[1]
    assert "Vector" not in clause and "Matrix" not in clause


def test_the_predicate_and_the_diagnostic_are_one_traversal():
    """Structural guard: `is_immutable_type` must go THROUGH `_find_mutable`.

    Redirect the shared primitive and both callers must follow. If someone
    re-forks them into two independent walks this fails immediately, which is
    the point — the agreement test above would keep passing for a long time
    before the two drifted on some type nobody parametrized.
    """
    import east.types.types as t

    calls = []
    real = t._find_mutable

    def counting(typ, recursive_type=None):
        calls.append(typ.type)
        return real(typ, recursive_type)

    t._find_mutable = counting
    try:
        assert t.is_immutable_type(StructType([("a", IntegerType)])) is True
        assert calls, "is_immutable_type does not go through _find_mutable"
        calls.clear()
        assert t.first_mutable_path(StructType([("a", ArrayType(IntegerType))])) is not None
        assert calls, "first_mutable_path does not go through _find_mutable"
    finally:
        t._find_mutable = real


def test_a_variant_case_is_called_a_case_not_a_field():
    """`field` and `case` are different things in East.

    Calling a variant case a field sends the reader looking for something that
    does not exist — and an Option is a variant, so this is the common nested
    shape, not an exotic one.
    """
    with pytest.raises(TypeError) as excinfo:
        SetType(StructType([("opt", OptionType(DictType(StringType, IntegerType)))]))
    msg = str(excinfo.value).splitlines()[0]
    assert "case 'opt|some'" in msg
    assert "field 'opt|some'" not in msg


def test_the_success_path_builds_no_path_strings():
    """The predicate gates EVERY SetType/DictType construction, so the accepted
    case must not pay for the diagnostic.

    Segments accumulate on the way OUT of the recursion, so an immutable type
    allocates no list and no string at all. Pinned by asserting the primitive
    returns the bare sentinel rather than an empty-path tuple.
    """
    from east.types.types import _find_mutable

    wide = StructType([(f"f{i}", OptionType(StringType)) for i in range(50)])
    assert _find_mutable(wide) is None      # not ([], something)
    assert is_immutable_type(wide)


def test_a_leading_variant_case_is_not_rendered_as_a_field():
    """`Option<Struct{x: Array}>` must not read like a struct with field `some`.

    The outermost segment used to be emitted bare whatever its kind, so this
    rendered `some.x` — byte-identical to the genuine struct case below — which
    defeated, one level up, the field/case distinction the renderer exists for.
    """
    opt = OptionType(StructType([("x", ArrayType(IntegerType))]))
    genuine = StructType([("some", StructType([("x", ArrayType(IntegerType))]))])
    assert first_mutable_path(opt)[0] == "|some.x"
    assert first_mutable_path(genuine)[0] == "some.x"
    assert first_mutable_path(opt)[0] != first_mutable_path(genuine)[0]
