#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""east-py's own sugar captures whole, for compiled functions AND lambdas (issue #470).

The corpus (``test_compliance_eager``) covers every BUILTIN's callback path
corpus-wide. What it cannot express is east-py's NATIVE sugar — the
``sum``/``mean``/``min``/``max``/``every``/``some``/``group_*`` compositions,
which exist only here — so this matrix drives each of them × {function, lambda}
and asserts the whole composition stays inside east-c.

Under the strict surface (#625) a callback either captures or RAISES, so a
composition whose internal wrapper stopped being capturable fails loudly
here — there is no per-element python path left to measure.

The #409 contract this pins — a compiled East function keeps the whole loop
inside east-c with zero per-element python — held for ``map``/``filter``/
``to_dict`` and silently inverted for the grouping methods: a compiled function was
4.4×–7.6× SLOWER than the identical plain lambda, because wrappers composing
a function (``lambda _b, el: {"k": key(el), ...}``) could neither be captured (a
compiled function was an opaque callable) nor recognised by
``capture_callback`` (which ignored the ``_east_function`` mark that the bridge
honoured — the counter and the branch disagreed, so ``group_by`` looked
healthy and trampolined anyway). Three mechanisms close it, and the matrix
pins all of them at once: compiled functions are dual-mode (called with proxies they
re-run their retained source, so any composing wrapper captures with correct
argument order, including the ``(k, v)``-swapped dict wrappers a mark could
not express); ``capture_callback`` resolves the ``_east_function`` mark through
the bridge's ``native_function_for`` — same signature checks (#467), same arity
adaptation; and the eligibility check reaches two wrapper levels while the
``mean`` family decides Integer-vs-Float from the type system.

Per the issue: a spot-check is not enough — ``group_by`` had the right code,
the right comment, and a healthy-looking ``function_direct`` counter while
being 7.6× slower.
"""

import pytest

from east import (
    ArrayType,
    BooleanType,
    East,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    array,
    if_else,
    none,
    some,
)
from east.runtime.compiler import eager_stats

N = 300
Row = StructType([("g", StringType), ("k", StringType), ("v", FloatType)])


def _rows():
    return array(Row, [{"g": f"g{i % 5}", "k": f"k{i}", "v": float(i)}
                       for i in range(N)])


def _callbacks(mode):
    """The same projections in both spellings; ``if_else``/``some``/``none``
    are dual-mode, so one body serves eager and traced execution."""
    specs = {
        "g":      ([Row], StringType, lambda _b, r: r["g"]),
        "k":      ([Row], StringType, lambda _b, r: r["k"]),
        "v":      ([Row], FloatType, lambda _b, r: r["v"]),
        "pred":   ([Row], BooleanType, lambda _b, r: r["v"] > 5.0),
        "opt":    ([Row], OptionType(StringType),
                   lambda _b, r: if_else(r["v"] > 5.0, some(r["g"]), none)),
        "flat":   ([Row], ArrayType(StringType), lambda _b, r: r["k"].split("|")),
        "folder": ([FloatType, Row], FloatType, lambda _b, acc, r: acc + r["v"]),
        "comb":   ([FloatType, FloatType], FloatType, lambda _b, a, b: a + b),
        "su":     ([StringType], StringType, lambda _b, x: x.upper_case()),
        "spred":  ([StringType], BooleanType, lambda _b, x: x.contains("1")),
        "mv":     ([FloatType], FloatType, lambda _b, x: x * 2.0),
        # Dict callbacks: the builtin's own (value, key) order (TS)
        "dg":     ([FloatType, StringType], StringType, lambda _b, v, k: k),
        "dv":     ([FloatType, StringType], FloatType, lambda _b, v, k: v),
        "dpred":  ([FloatType, StringType], BooleanType, lambda _b, v, k: v > 5.0),
        "dopt":   ([FloatType, StringType], OptionType(StringType),
                   lambda _b, v, k: if_else(v > 5.0, some(k), none)),
    }
    if mode == "function":
        return {name: East.function(types, out, fn)
                for name, (types, out, fn) in specs.items()}
    return {name: fn for name, (_types, _out, fn) in specs.items()}


# The plain builtin-backed method rows that used to live here (map/filter/
# filter_map/first_map/map_reduce/fold/sorted/to_*/flatten_*) are covered
# corpus-wide by tests/test_compliance_eager.py, with per-builtin path
# accounting (#474 cleanup pass 1). This file keeps the east-py-NATIVE surface
# the corpus cannot express: the sugar compositions (sum/mean/min/max/every/
# some/group_*) and the capture mechanics pins.
ARRAY_CASES = {
    "sum":             lambda a, c: a.sum(c["v"]),
    "mean":            lambda a, c: a.mean(c["v"]),
    "maximum":         lambda a, c: a.maximum(by=c["v"]),
    "minimum":         lambda a, c: a.minimum(by=c["v"]),
    "every":           lambda a, c: a.every(c["pred"]),
    "some":            lambda a, c: a.some(c["pred"]),
    "group_by":        lambda a, c: a.group_by(c["g"]),
    "group_size":      lambda a, c: a.group_size(c["g"]),
    "group_sum":       lambda a, c: a.group_sum(c["g"], c["v"]),
    "group_mean":      lambda a, c: a.group_mean(c["g"], c["v"]),
    "group_every":     lambda a, c: a.group_every(c["g"], c["pred"]),
    "group_some":      lambda a, c: a.group_some(c["g"], c["pred"]),
    "group_maximum":   lambda a, c: a.group_maximum(c["g"], by=c["v"]),
    "group_minimum":   lambda a, c: a.group_minimum(c["g"], by=c["v"]),
    # -1.0 matches NOTHING on purpose: the group-find family fills every
    # unmatched group, and that fill is what trampolined once per group (#526
    # review). A value that hits every group would score a healthy 0 while the
    # unbounded-cardinality case cost one python call per group.
    "group_find_all":     lambda a, c: a.group_find_all(c["g"], -1.0, c["v"]),
    "group_find_first":   lambda a, c: a.group_find_first(c["g"], -1.0, c["v"]),
    "group_find_maximum": lambda a, c: a.group_find_maximum(c["g"], by=c["v"]),
    "group_find_minimum": lambda a, c: a.group_find_minimum(c["g"], by=c["v"]),
    "group_reduce":    lambda a, c: a.group_reduce(c["g"], lambda _b, _k: 0.0, c["folder"]),
    "group_to_arrays": lambda a, c: a.group_to_arrays(c["g"], c["v"]),
    "group_to_sets":   lambda a, c: a.group_to_sets(c["g"], c["v"]),
    "group_to_dicts":  lambda a, c: a.group_to_dicts(c["g"], c["k"], c["v"]),
}

SET_CASES = {
    "every":      lambda s, c: s.every(c["spred"]),
    "some":       lambda s, c: s.some(c["spred"]),
}

DICT_CASES = {
    "union":           lambda d, c: d.union(d, c["comb"]),
    "mean":            lambda d, c: d.mean(c["dv"]),
    "group_reduce":    lambda d, c: d.group_reduce(
        c["dg"], lambda _b, _k: 0.0, lambda _b, acc, v, k: acc + v),
    "group_size":      lambda d, c: d.group_size(c["dg"]),
    "group_sum":       lambda d, c: d.group_sum(c["dg"], c["dv"]),
    "group_mean":      lambda d, c: d.group_mean(c["dg"], c["dv"]),
    "group_every":     lambda d, c: d.group_every(c["dg"], c["dpred"]),
    "group_some":      lambda d, c: d.group_some(c["dg"], c["dpred"]),
    "group_to_arrays": lambda d, c: d.group_to_arrays(c["dg"], c["dv"]),
    "group_to_sets":   lambda d, c: d.group_to_sets(c["dg"], c["dv"]),
    "group_to_dicts":  lambda d, c: d.group_to_dicts(c["dg"], c["dg"], c["dv"]),
}


def _assert_captures(run):
    """The composition captures — it did not raise. Under the strict surface
    that is the whole proof: a callback that fails to capture raises rather
    than running per element (#625)."""
    run()


@pytest.mark.parametrize("mode", ["function", "lambda"])
@pytest.mark.parametrize("case", sorted(ARRAY_CASES), ids=str)
def test_array_method_runs_native(case, mode):
    rows, cbs = _rows(), _callbacks(mode)
    _assert_captures(lambda: ARRAY_CASES[case](rows, cbs))


@pytest.mark.parametrize("mode", ["function", "lambda"])
@pytest.mark.parametrize("case", sorted(SET_CASES), ids=str)
def test_set_method_runs_native(case, mode):
    cbs = _callbacks(mode)
    strings = _rows().to_set(East.function([Row], StringType, lambda _b, r: r["k"]))
    _assert_captures(lambda: SET_CASES[case](strings, cbs))


@pytest.mark.parametrize("mode", ["function", "lambda"])
@pytest.mark.parametrize("case", sorted(DICT_CASES), ids=str)
def test_dict_method_runs_native(case, mode):
    cbs = _callbacks(mode)
    d = _rows().to_dict(East.function([Row], StringType, lambda _b, r: r["k"]),
                        value=East.function([Row], FloatType, lambda _b, r: r["v"]))
    _assert_captures(lambda: DICT_CASES[case](d, cbs))


# ── the specific #470 mechanics ──────────────────────────────────────────────

def test_capture_callback_honours_the_mark():
    """A wrapper carrying ``_east_function`` resolves to the function's own native
    value — before, the bridge honoured the mark while capture_callback judged
    the wrapper's own closure, so ``group_by`` branched to its per-element
    python path anyway."""
    from east.expression import capture_callback
    from east.types.values.collections import _mark_function
    from east.types.values.structural import EastFunction

    key = East.function([Row], StringType, lambda _b, r: r["g"])
    wrapper = _mark_function(lambda _b, el, _i: key(el), key)
    native = capture_callback(EastFunction(wrapper, [Row, IntegerType], StringType))
    assert native is not None
    assert getattr(native._eastc_handle, "_fn_val", 0)


def test_capture_callback_still_rejects_a_mismatched_marked_function():
    """The mark rides the same #467 signature checks as the bridge: a marked
    function whose output is not the declared callback output must not pass —
    the strict capture re-traces the wrapper and names the mismatch (#625)."""
    from east.expression import ExpressionError, capture_callback
    from east.types.values.collections import _mark_function
    from east.types.values.structural import EastFunction

    key = East.function([Row], StringType, lambda _b, r: r["g"])            # String
    wrapper = _mark_function(lambda _b, el, _i: key(el), key)
    with pytest.raises(ExpressionError, match="produced String"):
        capture_callback(EastFunction(wrapper, [Row, IntegerType], FloatType))


def test_functions_compose_inside_functions_and_wrappers():
    """Dual-mode: a function called with a trace proxy re-runs its source, so
    functions splice into other functions and into composing wrappers."""
    inner = East.function([Row], FloatType, lambda _b, r: r["v"])
    outer = East.function([Row], FloatType, lambda _b, r: inner(r) * 2.0)
    rows = _rows()
    assert outer({"g": "g0", "k": "k1", "v": 3.0}) == 6.0
    doubled = rows.map(outer, out=FloatType)
    assert list(doubled)[:3] == [0.0, 2.0, 4.0]


def test_group_by_function_matches_lambda_result():
    rows, cbs = _rows(), _callbacks("function")
    by_function = rows.group_by(cbs["g"])
    by_lambda = rows.group_by(lambda _b, r: r["g"])
    assert len(by_function) == len(by_lambda) == 5
    assert {k: len(v) for k, v in by_function.items()} == \
        {k: len(v) for k, v in by_lambda.items()}


@pytest.mark.parametrize("mode", ["function", "lambda"])
def test_mean_family_values_are_correct(mode):
    """The type-driven Integer/Float decision must not change the numbers."""
    cbs = _callbacks(mode)
    rows = _rows()
    values = [float(i) for i in range(N)]
    assert rows.mean(cbs["v"]) == pytest.approx(sum(values) / N)
    means = rows.group_mean(cbs["g"], cbs["v"])
    for g in range(5):
        expected = [v for i, v in enumerate(values) if i % 5 == g]
        assert means[f"g{g}"] == pytest.approx(sum(expected) / len(expected))
    ints = array(StructType([("n", IntegerType)]),
                 [{"n": i} for i in range(1, 5)])
    assert ints.mean(lambda _b, r: r["n"]) == pytest.approx(2.5)


def test_no_bulk_decode_probing():
    """The historical failure mode: an eager method that DECODES the whole
    collection to python (then probes/sorts/rebuilds) moves none of the
    corpus assertions — correct results, silently O(n) python. Pin the top-level C→py decode counter instead: with function
    callbacks, each of these once-guilty operations may sample at most a
    handful of values (type fallbacks read ONE element), never the
    collection. The bound is deliberately generous per call but ~N/10 below
    a per-element decode."""
    rows, cbs = _rows(), _callbacks("function")
    before_d = eager_stats()["c_to_py_decodes"]

    rows.sort(cbs["v"])
    rows.sort_in_place(cbs["v"])            # in-place: the native ArraySortInPlace
    rows.to_dict(cbs["k"], value=cbs["v"])
    rows.group_sum(cbs["g"], cbs["v"])
    rows.group_mean(cbs["g"], cbs["v"])
    rows.map(cbs["v"], out=FloatType)
    rows.filter(cbs["pred"])

    after = eager_stats()
    decoded = after["c_to_py_decodes"] - before_d
    assert decoded < N // 10, (
        f"{decoded} C→py decodes across {N}-row native operations — "
        "an eager method is decoding the collection python-side")
