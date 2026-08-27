#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Reductions on the traced kernel surface (#525 phase 1).

`sum` / `mean` / `maximum` / `minimum` / `reduce` / `every` / `some` existed as
eager methods and ran natively in every runtime, but did not TRACE — so inside
a kernel they were either a `ExpressionError` or a hand-rolled fold. That is
not a slower-but-correct fallback: #524 measured 6h02m for 729k rows caused by
exactly this kind of reformulation.

The issue's test expectation, applied to every operation here:

* the traced and eager paths agree EXACTLY — float accumulation order
  included, which holds because each traced form composes the same builtin the
  eager method uses (ArrayFold / SetReduce / DictReduce / *MapReduce /
  *FirstMap);
* each traced form BUILDS — under the strict surface a body that cannot
  capture raises, so building is the proof it runs natively.
"""

import math

import pytest

from east import (
    ArrayType,
    BooleanType,
    DictType,
    East,
    FloatType,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    StructType,
    array,
)
from east.expression import ExpressionError, trace
from east.runtime.compiler import compile_from_value
from east.types.values.collections import (
    EastArray,
    EastDict,
    EastSet,
    _kernel_out_type,
)

ROW = StructType([("g", StringType), ("v", FloatType), ("n", IntegerType)])
ROWS = [{"g": f"g{i % 3}", "v": float(i) * 1.5, "n": i} for i in range(60)]

A_ROW = ArrayType(ROW)
A_F = ArrayType(FloatType)
S_I = SetType(IntegerType)
D_SF = DictType(StringType, FloatType)
D_SI = DictType(StringType, IntegerType)


def _rows():
    return array(ROW, ROWS)


def _floats():
    return EastArray(FloatType, [0.1, 0.2, 0.3, 1e16, -1e16])


def _ints():
    return EastSet(IntegerType, [3, 1, 4, 1, 5, 9, 2, 6])


def _dict_f():
    return EastDict(StringType, FloatType, {f"k{i:02d}": float(i) * 0.7 for i in range(20)})


def _dict_i():
    return EastDict(StringType, IntegerType, {f"k{i:02d}": i for i in range(20)})


def _native(traced, param_type, value):
    """Run the traced form as a compiled artifact.

    The parametrized cases share this one helper across every output type,
    so the artifact is built from the trace directly rather than through
    ``East.function`` (which declares the output up front). Building at all
    is the native-execution proof: a body that cannot capture raises.
    """
    ir, _out, binds = trace(traced, [param_type])
    compiled = compile_from_value(ir)
    return (compiled.bind(*binds) if binds else compiled)(value)


def _same(got, want):
    if isinstance(want, float) and math.isnan(want):
        assert isinstance(got, float) and math.isnan(got)
    else:
        assert got == want
        assert type(got) is type(want), f"{type(got)} vs {type(want)}"


# ── Array ────────────────────────────────────────────────────────────────────


def test_array_maximum_on_empty_errors_like_eager():
    """Same failure, same message — a max has no identity element, and the
    traced form must not quietly invent one."""
    from east.runtime.errors import EastError

    empty = EastArray(FloatType, [])
    with pytest.raises(EastError, match="Cannot reduce empty array"):
        empty.maximum()
    with pytest.raises(EastError, match="Cannot reduce empty array"):
        East.function([A_F], FloatType, lambda a: a.maximum())(empty)


# ── the no-predicate quantifier form, as the eager methods allow ─────────────


def test_no_predicate_quantifier_on_non_boolean_is_named():
    with pytest.raises(ExpressionError, match="without a predicate needs Boolean elements"):
        East.function([S_I], BooleanType, lambda s: s.every())
    with pytest.raises(ExpressionError, match="without a predicate needs Boolean values"):
        East.function([D_SF], BooleanType, lambda d: d.some())


# ── Set ──────────────────────────────────────────────────────────────────────


# ── Dict ─────────────────────────────────────────────────────────────────────


# ── diagnostics ──────────────────────────────────────────────────────────────

def test_non_numeric_projection_is_named():
    with pytest.raises(ExpressionError, match=r"\.sum\(\) needs a numeric"):
        East.function([A_ROW], FloatType, lambda a: a.sum(lambda r: r.g))
    with pytest.raises(ExpressionError, match=r"\.mean\(\) needs a numeric"):
        East.function([A_ROW], FloatType, lambda a: a.mean(lambda r: r.g))


def test_non_boolean_predicate_is_named():
    with pytest.raises(ExpressionError, match=r"\.every\(\) predicate must return Boolean"):
        East.function([S_I], BooleanType, lambda s: s.every(lambda e: e + 1))
    with pytest.raises(ExpressionError, match=r"\.some\(\) predicate must return Boolean"):
        East.function([D_SF], BooleanType, lambda d: d.some(lambda k, v: v * 2.0))


def test_reduce_accumulator_mismatch_is_named():
    with pytest.raises(ExpressionError, match=r"\.reduce\(\) step returns"):
        East.function([S_I], IntegerType, lambda s: s.reduce(0, lambda a, e: a > e))


def test_reduce_on_an_array_points_at_fold():
    with pytest.raises(ExpressionError, match="fold"):
        East.function([A_F], FloatType, lambda a: a.reduce(0.0, lambda acc, el: acc + el))


def test_maximum_on_a_set_is_refused_not_silently_wrong():
    """EastSet has no eager `maximum`, so the traced surface must not invent
    one — the error should name the surface rather than mis-dispatch."""
    with pytest.raises(ExpressionError):
        East.function([S_I], IntegerType, lambda s: s.maximum())


# ── the projection may take the index, as it may eagerly ─────────────────────


# ── mean evaluates its receiver exactly once ─────────────────────────────────

def _builtin_count(traced, param_type, builtin):
    """How many times ``builtin`` appears in the traced IR."""
    from east.expression import trace
    from east.serialization.json import encode_json_for
    from east.types.type_of_type import IRType

    ir, _out, _binds = trace(traced, [param_type])
    encoded = encode_json_for(IRType)(ir)
    text = encoded.decode() if isinstance(encoded, bytes) else encoded
    return text.count(f'"{builtin}"')


def _builtin_count_inside_callbacks(traced, param_type, builtin):
    """How many times ``builtin`` appears INSIDE a per-element callback.

    `_builtin_count` counts occurrences in the whole IR, which is 1 whether a
    target is `Let`-bound at block level or spliced into the per-element probe
    — the Let changes WHERE it is evaluated, not how many nodes exist. So the
    "evaluates its target once" tests could not fail: deleting the binding left
    them green while the operation went quadratic (measured 3 300x at n=8000).

    Walk the traced IR and count only occurrences under a Function node other
    than the kernel's own top-level one. Spliced -> >= 1; Let-bound -> 0.
    """
    from east.expression import trace
    from east.types.values import is_east_struct, is_east_variant

    ir, _out, _binds = trace(traced, [param_type])
    hits = 0

    def walk(node, in_callback):
        nonlocal hits
        if isinstance(node, (list, tuple)) or hasattr(node, "element_type"):
            for x in node:
                walk(x, in_callback)
            return
        if is_east_struct(node):
            for _f, v in node.items():
                walk(v, in_callback)
            return
        if not is_east_variant(node):
            return
        if node.type == "Builtin" and node.value["builtin"] == builtin and in_callback:
            hits += 1
        inner = in_callback or node.type == "Function"
        payload = node.value
        if is_east_struct(payload):
            for fname, v in payload.items():
                if fname in ("type", "loc_id", "type_parameters", "builtin", "name"):
                    continue
                walk(v, inner)

    # the kernel's own outermost Function is not a per-element callback
    body = ir.value["body"] if ir.type == "Function" else ir
    walk(body, False)
    return hits


# ── struct fields win over same-named methods ────────────────────────────────


# ── the arity oracle is the eager one ────────────────────────────────────────


# ── the set algebra is complete on the traced surface ────────────────────────


# ── find_* (#525 phase 2) ────────────────────────────────────────────────────

_SORTED = [1, 2, 2, 2, 5, 8]


def test_find_target_type_mismatch_is_named():
    with pytest.raises(ExpressionError, match="same East type"):
        East.function([A_ROW], OptionType(IntegerType),
                      lambda a: a.find_first("nope", lambda r: r.v))
    with pytest.raises(ExpressionError, match="same East type"):
        East.function([A_ROW], ArrayType(IntegerType),
                      lambda a: a.find_all(1, lambda r: r.g))


# ── composition: a whole aggregate is one compiled kernel ────────────────────


# ── group_* (#525 phase 3) ───────────────────────────────────────────────────
#
# The grouped fold is the primitive and everything else composes from it, so a
# whole aggregate is ONE compiled kernel. The general fold is spelled
# `group_reduce` on every container (TS `groupReduce` parity, #535);
# `group_fold` survives on Set/Dict as a deprecated alias. Set/Dict have no
# group_maximum/group_minimum because their eager surfaces do not either.

_G_SET = SetType(IntegerType)


def _set_i():
    return EastSet(IntegerType, list(range(12)))


def _dict_kf():
    return EastDict(StringType, FloatType, {f"k{i:02d}": float(i) for i in range(12)})


def _same_dict(got, want):
    """Compare two result dicts by TYPE as well as by contents.

    Contents alone pin almost nothing here. Python's ``{0: 4} == {0: 4.0}`` is
    True, so an Integer-vs-Float divergence in the RESULT TYPE passes a
    contents-only assertion on non-empty input; and two empty dicts compare
    equal however they are typed, so on empty input it pins nothing at all.
    A dict's key/value type is part of a kernel's compiled signature and
    propagates into whatever consumes it, so it is the thing to assert.
    """
    assert (got.key_type, got.value_type) == (want.key_type, want.value_type), (
        f"result TYPE diverged: traced Dict<{got.key_type.type},{got.value_type.type}> "
        f"vs eager Dict<{want.key_type.type},{want.value_type.type}>")
    assert dict(got.items()) == dict(want.items())


def test_group_reduce_is_the_one_spelling_and_group_fold_is_the_alias():
    """#535: `group_reduce` works on every container; `group_fold` survives on
    Set/Dict as a deprecated alias (both paths warn) and still has no Array
    spelling — the eager surface never had one, and inventing it would spread
    the deprecated name."""
    # group_reduce now traces on a Set (it used to point at group_fold)
    s = _set_i()
    want = s.group_reduce(lambda e: East.Integer.remainder(e, 3), lambda _k: 0, lambda acc, e: acc + e)
    got = _native(lambda x: x.group_reduce(lambda e: East.Integer.remainder(e, 3), lambda _k: 0,
                                           lambda acc, e: acc + e), _G_SET, s)
    _same_dict(got, want)
    # the alias answers identically and TELLS you where it went — eager...
    with pytest.warns(DeprecationWarning, match="group_reduce"):
        aliased = s.group_fold(lambda e: East.Integer.remainder(e, 3), lambda _k: 0, lambda acc, e: acc + e)
    _same_dict(aliased, want)
    # ...and traced (the warning fires at trace time)
    with pytest.warns(DeprecationWarning, match="group_reduce"):
        traced_alias = East.function([_G_SET], DictType(IntegerType, IntegerType), lambda x: x.group_fold(
            lambda e: East.Integer.remainder(e, 3), lambda _k: 0, lambda acc, e: acc + e))
    _same_dict(traced_alias(s), want)
    # the Dict alias warns too
    d = _dict_kf()
    with pytest.warns(DeprecationWarning, match="group_reduce"):
        d_alias = d.group_fold(lambda k, v: k[:2], lambda _k: 0.0,
                               lambda acc, k, v: acc + v)
    _same_dict(d_alias, d.group_reduce(lambda k, v: k[:2], lambda _k: 0.0,
                                       lambda acc, k, v: acc + v))
    # an Array still has no group_fold
    with pytest.raises(ExpressionError, match="group_reduce"):
        East.function([A_ROW], DictType(StringType, IntegerType),
                      lambda a: a.group_fold(lambda r: r.g, lambda _k: 0, lambda acc, r: acc))
    with pytest.raises(AttributeError):
        _rows().group_fold(lambda r: r["g"], lambda _k: 0, lambda acc, r: acc)


def test_group_extremes_are_array_only_like_eager():
    """EastSet/EastDict have no eager group_maximum, so the traced surface
    must not invent one.

    `match=` matters here: without it the guard could be deleted outright and
    the test would still pass on the unrelated `ExpressionError` a later arity
    failure raises.
    """
    with pytest.raises(ExpressionError, match=r"group_maximum\(\) on Set"):
        East.function([_G_SET], DictType(IntegerType, IntegerType),
                      lambda s: s.group_maximum(lambda e: East.Integer.remainder(e, 3)))
    with pytest.raises(ExpressionError, match=r"group_minimum\(\) on Dict"):
        East.function([D_SF], D_SF, lambda d: d.group_minimum(lambda k, v: k))


# Each case carries the RESULT TYPE it must produce on empty input, chosen so
# the old degenerate bail (a dict typed from the SOURCE) would be visibly
# wrong: an Array of structs keyed by String, a Set<String> counted to Integer,
# a Dict<String,Float> keyed by a BOOLEAN projection. Comparing traced against
# eager alone is not enough — with a callback the tracer cannot type, BOTH
# sides take the fallback and agree while both are wrong.
_EMPTY_ARRAY_CASES = [
    ("group_reduce", "String", "Float",
     lambda a: a.group_reduce(lambda r: r.g, lambda _k: 0.0, lambda acc, r: acc + r.v),
     lambda a: a.group_reduce(lambda r: r["g"], lambda _k: 0.0, lambda acc, r: acc + r["v"])),
    ("group_size", "String", "Integer",
     lambda a: a.group_size(lambda r: r.g), lambda a: a.group_size(lambda r: r["g"])),
    ("group_sum_float", "String", "Float",
     lambda a: a.group_sum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_sum(lambda r: r["g"], lambda r: r["v"])),
    ("group_sum_int", "String", "Integer",
     lambda a: a.group_sum(lambda r: r.g, lambda r: r.n),
     lambda a: a.group_sum(lambda r: r["g"], lambda r: r["n"])),
    # an INTEGER projection still means a FLOAT mean
    ("group_mean_int_proj", "String", "Float",
     lambda a: a.group_mean(lambda r: r.g, lambda r: r.n),
     lambda a: a.group_mean(lambda r: r["g"], lambda r: r["n"])),
    ("group_every", "String", "Boolean",
     lambda a: a.group_every(lambda r: r.g, lambda r: r.n > 0),
     lambda a: a.group_every(lambda r: r["g"], lambda r: r["n"] > 0)),
    ("group_some", "String", "Boolean",
     lambda a: a.group_some(lambda r: r.g, lambda r: r.n > 0),
     lambda a: a.group_some(lambda r: r["g"], lambda r: r["n"] > 0)),
    # the two names phase 3 newly traced — both compose `_group_extreme`,
    # whose empty bail the first fix pass missed
    ("group_maximum", "String", "Float",
     lambda a: a.group_maximum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_maximum(lambda r: r["g"], lambda r: r["v"])),
    ("group_minimum", "String", "Float",
     lambda a: a.group_minimum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_minimum(lambda r: r["g"], lambda r: r["v"])),
]

_EMPTY_SET_CASES = [
    ("group_reduce", "Integer", "Integer",
     lambda s: s.group_reduce(lambda e: e.length(), lambda _k: 0, lambda acc, e: acc + 1),
     lambda s: s.group_reduce(lambda e: e.length(), lambda _k: 0, lambda acc, e: acc + 1)),
    # Set<String> counted to Integer: the degenerate bail said Dict<String,String>
    ("group_size", "String", "Integer",
     lambda s: s.group_size(lambda e: e), lambda s: s.group_size(lambda e: e)),
    ("group_mean", "String", "Float",
     lambda s: s.group_mean(lambda e: e, lambda e: e.length()),
     lambda s: s.group_mean(lambda e: e, lambda e: e.length())),
    ("group_every", "String", "Boolean",
     lambda s: s.group_every(lambda e: e, lambda e: e.length() > 0),
     lambda s: s.group_every(lambda e: e, lambda e: e.length() > 0)),
    ("group_some", "String", "Boolean",
     lambda s: s.group_some(lambda e: e, lambda e: e.length() > 0),
     lambda s: s.group_some(lambda e: e, lambda e: e.length() > 0)),
]

_EMPTY_DICT_CASES = [
    # a BOOLEAN group key over a Dict<String,Float>, so BOTH type parameters
    # differ from the source — the degenerate bail leaked both
    ("group_reduce", "Boolean", "Float",
     lambda d: d.group_reduce(lambda k, v: v > 5.0, lambda _k: 0.0, lambda acc, k, v: acc + v),
     lambda d: d.group_reduce(lambda k, v: v > 5.0, lambda _k: 0.0, lambda acc, k, v: acc + v)),
    ("group_size", "Boolean", "Integer",
     lambda d: d.group_size(lambda k, v: v > 5.0), lambda d: d.group_size(lambda k, v: v > 5.0)),
    ("group_sum", "Boolean", "Float",
     lambda d: d.group_sum(lambda k, v: v > 5.0), lambda d: d.group_sum(lambda k, v: v > 5.0)),
    ("group_mean", "Boolean", "Float",
     lambda d: d.group_mean(lambda k, v: v > 5.0), lambda d: d.group_mean(lambda k, v: v > 5.0)),
    ("group_every", "Boolean", "Boolean",
     lambda d: d.group_every(lambda k, v: v > 5.0, lambda k, v: v > 0.0),
     lambda d: d.group_every(lambda k, v: v > 5.0, lambda k, v: v > 0.0)),
    ("group_some", "Boolean", "Boolean",
     lambda d: d.group_some(lambda k, v: v > 5.0, lambda k, v: v > 0.0),
     lambda d: d.group_some(lambda k, v: v > 5.0, lambda k, v: v > 0.0)),
]


def test_group_size_defaults_to_the_identity_key_on_an_array():
    xs = EastArray(StringType, ["a", "b", "a"])
    got = _native(lambda a: a.group_size(), ArrayType(StringType), xs)
    assert dict(got.items()) == dict(xs.group_size().items()) == {"a": 2, "b": 1}
    # ...and Set/Dict require one, exactly as their eager twins do
    with pytest.raises(ExpressionError, match="needs a key function"):
        East.function([_G_SET], DictType(IntegerType, IntegerType), lambda s: s.group_size())


def test_an_untypeable_callback_is_refused_even_on_empty_input():
    """The old per-parameter sampling fallback is gone (#625): a callback the
    tracer cannot capture — a python builtin like `len` — raises the named
    error whether or not there is an element to sample, so an empty input can
    no longer change which types (or errors) a program produces. The
    East-typeable spelling derives both type parameters as before.
    """
    empty = EastSet(StringType)
    with pytest.raises(ExpressionError, match="captured automatically"):
        _kernel_out_type(len, [StringType])
    with pytest.raises(ExpressionError, match="captured automatically"):
        empty.group_size(len)
    typed = empty.group_size(lambda e: e.length())
    assert (typed.key_type.type, typed.value_type.type) == ("Integer", "Integer")


# Eager `group_*` names with no traced twin. EMPTY as of #525 phase 3b, which
# closed the last seven (`group_to_*` on all three containers plus the Array
# `group_find_*` family). Every entry would be a working eager call that
# silently drops its enclosing loop to the per-element python path, so this
# stays as a ratchet: it may only ever shrink.
_UNTRACED_GROUP_NAMES: dict[str, set[str]] = {"Array": set(), "Set": set(), "Dict": set()}


# ── group_to_* / group_find_* (#525 phase 3b) ────────────────────────────────
#
# The last seven eager `group_*` names to gain traced twins. `group_to_*`
# accumulate into a COLLECTION, so their step mutates a per-group accumulator —
# hand-built IR, since the traced surface exposes no mutators. `group_find_*`
# are Array-only, like their eager twins.

_G_ROWS = [{"g": f"g{i % 3}", "v": float(i % 4), "n": i} for i in range(12)]


def _g_rows():
    return array(ROW, _G_ROWS)


def _norm(x):
    """Compare nested results structurally (Set/Array/Dict/Option alike)."""
    if hasattr(x, "items"):
        return {k: _norm(v) for k, v in x.items()}
    if hasattr(x, "element_type"):
        out = [_norm(e) for e in x]
        try:
            return sorted(out)
        except TypeError:
            return out
    if hasattr(x, "type") and hasattr(x, "value"):
        return (x.type, x.value)
    return x


# ── flatten_to_dict / Set.to_set / Dict.union (#525 phase 4) ─────────────────
#
# The last three eager methods with no traced twin. With these the traced
# surface equals the eager one on every container.

_P4_ROW = StructType([("g", StringType), ("n", IntegerType), ("tags", ArrayType(StringType))])
_P4_A = ArrayType(_P4_ROW)


def test_set_to_set_traces_like_its_eager_twin():
    """The whole `to_*` family traced except this one member, so a working
    eager `EastSet.to_set(fn)` silently dropped its loop to python."""
    s = EastSet(IntegerType, [1, 2, 3, 4])
    got = _native(lambda x: x.to_set(lambda e: East.Integer.remainder(e, 2)), _G_SET, s)
    assert sorted(got) == sorted(s.to_set(lambda e: East.Integer.remainder(e, 2))) == [0, 1]
    with pytest.raises(ExpressionError, match="needs a projection"):
        East.function([_G_SET], _G_SET, lambda x: x.to_set())


def test_dict_union_overlap_without_a_combine_errors_on_both_paths():
    from east.runtime.errors import EastError

    t = DictType(StringType, IntegerType)
    d = EastDict(StringType, IntegerType, {"x": 1})
    overlap = EastDict(StringType, IntegerType, {"x": 5})
    with pytest.raises(EastError, match="exists in both dictionaries"):
        d.union(overlap)
    with pytest.raises(EastError, match="exists in both dictionaries"):
        East.function([t], D_SI, lambda a: a.union(overlap))(d)
    # the message names the key, as eager and TS both do
    with pytest.raises(EastError, match='Key "?x"? exists in both'):
        East.function([t], D_SI, lambda a: a.union(overlap))(d)


def test_a_set_union_still_takes_no_combine():
    """`union` now serves two containers; a Set has no values to combine, so
    passing one is a caller error rather than a silently ignored argument."""
    with pytest.raises(ExpressionError, match="takes no combine"):
        East.function([_G_SET], _G_SET,
                      lambda s: s.union(EastSet(IntegerType, [9]), lambda a, b: a))


# Keywords an eager method accepts that its traced twin does not.
#
# #536 closed the sweep: the `out=`/`key_out=`/`value_out=`/`acc_out=` pins
# are now accepted AND thread into the callback's trace as its expected type
# (so a pinned callback can build a general variant, #541), and the
# `pred`/`key`/`value_fn` name differences are aligned. RATCHET: this list
# may only ever SHRINK — a new gap fails here.
_KNOWN_KEYWORD_GAPS = {
    # Deliberate semantic difference, not a naming gap: the eager
    # `Dict.get(k, default=None)` is a python-boundary convenience returning
    # the default when the key is absent; the traced `get` errors on a
    # missing key, and `get_or_default` is the traced spelling (see the
    # SKILL's sharp edges). Accepting `default=` would silently change
    # missing-key semantics between the paths.
    "Dict.get": {"default"},
}


def test_the_duplicate_key_error_message_is_unquoted_like_eager_and_ts():
    """A String key is printed BARE on all three runtimes.

    The traced path wrapped every key in the East `Print` builtin, which
    JSON-quotes a String, so the kernel's message read `key "a"` where eager
    and TS both read `key a`. The two tests written at the time used a
    `"?a"?` regex that accepted either, so CI could not see it.
    """
    from east.runtime.errors import EastError

    parts = array(StringType, ["b", "a", "c", "a"])
    t = ArrayType(StringType)
    with pytest.raises(EastError, match="Cannot insert duplicate key a into dict"):
        East.function([t], D_SI, lambda a: a.to_dict(lambda p: p, value=lambda p: p.length()))(parts)
    with pytest.raises(EastError, match="Cannot insert duplicate key a into dict"):
        parts.to_dict(lambda p: p, value=lambda p: p.length())

    dt = DictType(StringType, IntegerType)
    d = EastDict(StringType, IntegerType, {"x": 1})
    o = EastDict(StringType, IntegerType, {"x": 5})
    with pytest.raises(EastError, match="Key x exists in both dictionaries"):
        East.function([dt], D_SI, lambda a: a.union(o))(d)
    with pytest.raises(EastError, match="Key x exists in both dictionaries"):
        d.union(o)
    # a NON-String key still goes through Print, so an Integer key is bare too
    ints = array(IntegerType, [7, 7])
    with pytest.raises(EastError, match="duplicate key 7 into dict"):
        East.function([ArrayType(IntegerType)], DictType(IntegerType, IntegerType), lambda a: a.to_dict(lambda p: p, value=lambda p: p))(ints)


_P4_EROW = StructType([("g", StringType), ("v", FloatType), ("n", IntegerType),
                       ("tags", ArrayType(StringType))])
_P4_EA = ArrayType(_P4_EROW)

_EMPTY_NEW_NAMES = [
    ("group_find_all", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_all(lambda r: r.g, 2.0, lambda r: r.v),
     lambda a: a.group_find_all(lambda r: r["g"], 2.0, lambda r: r["v"])),
    ("group_find_first", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_first(lambda r: r.g, 2.0, lambda r: r.v),
     lambda a: a.group_find_first(lambda r: r["g"], 2.0, lambda r: r["v"])),
    ("group_find_maximum", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_maximum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_find_maximum(lambda r: r["g"], lambda r: r["v"])),
    ("group_find_minimum", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_find_minimum(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_find_minimum(lambda r: r["g"], lambda r: r["v"])),
    ("group_to_arrays", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_to_arrays(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_to_arrays(lambda r: r["g"], lambda r: r["v"])),
    ("group_to_sets", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_to_sets(lambda r: r.g, lambda r: r.v),
     lambda a: a.group_to_sets(lambda r: r["g"], lambda r: r["v"])),
    ("group_to_dicts", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.group_to_dicts(lambda r: r.g, lambda r: r.n, lambda r: r.v),
     lambda a: a.group_to_dicts(lambda r: r["g"], lambda r: r["n"], lambda r: r["v"])),
    ("array_flatten_to_dict", _P4_EA, lambda: array(_P4_EROW, []),
     lambda a: a.flatten_to_dict(lambda r: r.tags.to_dict(lambda x: x, lambda _x: r.n)),
     lambda a: a.flatten_to_dict(lambda r: r["tags"].to_dict(lambda x: x, lambda _x: r["n"]))),
    # The eager sides read the collection itself — a mutable East value the
    # bare lambda cannot capture (#625) — so it rides as a `.bind` parameter.
    ("set_flatten_to_dict", SetType(IntegerType), lambda: EastSet(IntegerType),
     lambda s: s.flatten_to_dict(lambda e: s.map(lambda y: y * e), lambda p, q: p + q),
     lambda s: s.flatten_to_dict(
         East.function([IntegerType, SetType(IntegerType)], DictType(IntegerType, IntegerType),
                lambda e, ss: ss.map(lambda y: y * e)).bind(s),
         lambda p, q: p + q)),
    ("dict_flatten_to_dict", D_SF, lambda: EastDict(StringType, FloatType),
     lambda d: d.flatten_to_dict(lambda k, _v: d.filter(lambda k2, _v2: k2 == k)),
     lambda d: d.flatten_to_dict(
         East.function([StringType, FloatType, D_SF], D_SF,
                lambda k, _v, dd: dd.filter(lambda k2, _v2: k2 == k)).bind(d))),
]


def test_traced_to_set_accepts_the_out_keyword_its_eager_twin_takes():
    """`EastSet.to_set(fn, out=T)` is a documented eager call; the traced twin
    rejected the keyword, so it silently fell back to the per-element path."""
    s = EastSet(IntegerType, [1, 2, 3, 4])
    got = _native(lambda x: x.to_set(lambda e: East.Integer.remainder(e, 2), out=IntegerType), _G_SET, s)
    assert sorted(got) == sorted(s.to_set(lambda e: East.Integer.remainder(e, 2), out=IntegerType)) == [0, 1]
    # a contradictory out= is a caller error, not a silent relabel (#467)
    with pytest.raises(ExpressionError, match="out= declares"):
        East.function([_G_SET], _G_SET, lambda x: x.to_set(
            lambda e: East.Integer.remainder(e, 2), out=SetType(IntegerType)))
