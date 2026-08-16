#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Every eager callback method runs native for kernels AND lambdas (issue #470).

The #409 contract — a precompiled kernel keeps the whole loop inside east-c
with zero per-element python — held for ``map``/``filter``/``to_dict`` and
silently inverted for the grouping methods: a kernel was 4.4×–7.6× SLOWER
than the identical plain lambda, because wrappers composing a kernel
(``lambda el: {"k": key(el), ...}``) could neither be traced (a compiled
kernel was an opaque callable) nor recognised by ``try_push_down`` (which
ignored the ``_east_kernel`` mark that the bridge honoured — the counter and
the branch disagreed, so ``group_by`` looked healthy and trampolined anyway).

Three mechanisms close it, and this matrix pins all of them at once:

* kernels are dual-mode — called with trace proxies they re-run their
  retained source lambda, so any composing wrapper traces with correct
  argument order (no marking needed, including the ``(k, v)``-swapped dict
  wrappers a mark could not express);
* ``try_push_down`` resolves the ``_east_kernel`` mark through the bridge's
  ``native_kernel_for`` — same signature checks (#467), same arity
  adaptation — so the mark means one thing to every consumer;
* the purity gate reaches two wrapper levels and the ``mean`` family
  decides Integer-vs-Float from the type system, so the group-sugar block
  traces end-to-end.

Per the issue: a spot-check is not enough — ``group_by`` had the right code,
the right comment, and a healthy-looking ``kernel_direct`` counter while
being 7.6× slower. So: every callback-taking method × {kernel, lambda},
asserting ``trampoline_calls`` does not move.
"""

import pytest

from east import (
    FloatType,
    IntegerType,
    StringType,
    StructType,
    array,
    if_else,
    kernel,
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
        "g":      (Row, lambda r: r["g"]),
        "k":      (Row, lambda r: r["k"]),
        "v":      (Row, lambda r: r["v"]),
        "pred":   (Row, lambda r: r["v"] > 5.0),
        "opt":    (Row, lambda r: if_else(r["v"] > 5.0, some(r["g"]), none)),
        "flat":   (Row, lambda r: r["k"].split("|")),
        "folder": ([FloatType, Row], lambda acc, r: acc + r["v"]),
        "comb":   ([FloatType, FloatType], lambda a, b: a + b),
        "su":     (StringType, lambda x: x.upper()),
        "spred":  (StringType, lambda x: x.contains("1")),
        "mv":     (FloatType, lambda x: x * 2.0),
        "dg":     ([StringType, FloatType], lambda k, v: k),
        "dv":     ([StringType, FloatType], lambda k, v: v),
        "dpred":  ([StringType, FloatType], lambda k, v: v > 5.0),
        "dopt":   ([StringType, FloatType],
                   lambda k, v: if_else(v > 5.0, some(k), none)),
    }
    if mode == "kernel":
        return {name: kernel(types, fn) for name, (types, fn) in specs.items()}
    return {name: fn for name, (_types, fn) in specs.items()}


# The plain builtin-backed method rows that used to live here (map/filter/
# filter_map/first_map/map_reduce/fold/sorted/to_*/flatten_*) are now covered
# corpus-wide by tests/test_compliance_eager.py — kernel + trampoline replay
# with per-builtin path accounting (#474 cleanup pass 1). This file keeps the
# east-py-NATIVE surface the corpus cannot express: the sugar compositions
# (sum/mean/min/max/every/some/group_*) and the pushdown mechanics pins.
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
    "group_reduce":    lambda a, c: a.group_reduce(c["g"], lambda _k: 0.0, c["folder"]),
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
        c["dg"], lambda _k: 0.0, lambda acc, k, v: acc + v),
    "group_size":      lambda d, c: d.group_size(c["dg"]),
    "group_sum":       lambda d, c: d.group_sum(c["dg"], c["dv"]),
    "group_mean":      lambda d, c: d.group_mean(c["dg"], c["dv"]),
    "group_every":     lambda d, c: d.group_every(c["dg"], c["dpred"]),
    "group_some":      lambda d, c: d.group_some(c["dg"], c["dpred"]),
    "group_to_arrays": lambda d, c: d.group_to_arrays(c["dg"], c["dv"]),
    "group_to_sets":   lambda d, c: d.group_to_sets(c["dg"], c["dv"]),
    "group_to_dicts":  lambda d, c: d.group_to_dicts(c["dg"], c["dg"], c["dv"]),
}


def _assert_no_per_element_python(run):
    before = eager_stats()["trampoline_calls"]
    run()
    moved = eager_stats()["trampoline_calls"] - before
    assert moved == 0, f"{moved} per-element python trampoline call(s)"


@pytest.mark.parametrize("mode", ["kernel", "lambda"])
@pytest.mark.parametrize("case", sorted(ARRAY_CASES), ids=str)
def test_array_method_runs_native(case, mode):
    rows, cbs = _rows(), _callbacks(mode)
    _assert_no_per_element_python(lambda: ARRAY_CASES[case](rows, cbs))


@pytest.mark.parametrize("mode", ["kernel", "lambda"])
@pytest.mark.parametrize("case", sorted(SET_CASES), ids=str)
def test_set_method_runs_native(case, mode):
    cbs = _callbacks(mode)
    strings = _rows().to_set(kernel(Row, lambda r: r["k"]))
    _assert_no_per_element_python(lambda: SET_CASES[case](strings, cbs))


@pytest.mark.parametrize("mode", ["kernel", "lambda"])
@pytest.mark.parametrize("case", sorted(DICT_CASES), ids=str)
def test_dict_method_runs_native(case, mode):
    cbs = _callbacks(mode)
    d = _rows().to_dict(kernel(Row, lambda r: r["k"]),
                        value=kernel(Row, lambda r: r["v"]))
    _assert_no_per_element_python(lambda: DICT_CASES[case](d, cbs))


# ── the specific #470 mechanics ──────────────────────────────────────────────

def test_try_push_down_honours_the_mark():
    """A wrapper carrying ``_east_kernel`` is pushable — before, the bridge
    honoured the mark while try_push_down judged the wrapper's own closure,
    so ``group_by`` branched to its per-element python path anyway."""
    from east.kernel import try_push_down
    from east.types.values.collections import _mark_kernel
    from east.types.values.structural import EastFunction

    key = kernel(Row, lambda r: r["g"])
    wrapper = _mark_kernel(lambda el, _i: key(el), key)
    native = try_push_down(EastFunction(wrapper, [Row, IntegerType], StringType))
    assert native is not None
    assert getattr(native._eastc_handle, "_fn_val", 0)


def test_try_push_down_still_rejects_a_mismatched_marked_kernel():
    """The mark rides the same #467 signature checks as the bridge: a marked
    kernel whose output is not the declared callback output must not pass."""
    from east.kernel import try_push_down
    from east.types.values.collections import _mark_kernel
    from east.types.values.structural import EastFunction

    key = kernel(Row, lambda r: r["g"])            # String
    wrapper = _mark_kernel(lambda el, _i: key(el), key)
    assert try_push_down(EastFunction(wrapper, [Row, IntegerType], FloatType)) is None


def test_kernels_compose_inside_kernels_and_wrappers():
    """Dual-mode: a kernel called with a trace proxy re-runs its source, so
    kernels splice into other kernels and into composing wrappers."""
    inner = kernel(Row, lambda r: r["v"])
    outer = kernel(Row, lambda r: inner(r) * 2.0)
    rows = _rows()
    assert outer({"g": "g0", "k": "k1", "v": 3.0}) == 6.0
    doubled = rows.map(outer, out=FloatType)
    assert list(doubled)[:3] == [0.0, 2.0, 4.0]


def test_group_by_kernel_matches_lambda_result():
    rows, cbs = _rows(), _callbacks("kernel")
    by_kernel = rows.group_by(cbs["g"])
    by_lambda = rows.group_by(lambda r: r["g"])
    assert len(by_kernel) == len(by_lambda) == 5
    assert {k: len(v) for k, v in by_kernel.items()} == \
        {k: len(v) for k, v in by_lambda.items()}


@pytest.mark.parametrize("mode", ["kernel", "lambda"])
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
    assert ints.mean(lambda r: r["n"]) == pytest.approx(2.5)


def test_no_bulk_decode_probing():
    """The historical failure mode: an eager method that DECODES the whole
    collection to python (then probes/sorts/rebuilds) moves neither the
    trampoline counter nor the corpus assertions — correct results, silently
    O(n) python. Pin the top-level C→py decode counter instead: with kernel
    callbacks, each of these once-guilty operations may sample at most a
    handful of values (type fallbacks read ONE element), never the
    collection. The bound is deliberately generous per call but ~N/10 below
    a per-element decode."""
    rows, cbs = _rows(), _callbacks("kernel")
    before = eager_stats()
    before_d = before["c_to_py_decodes"]
    before_t = before["trampoline_calls"]

    rows.sorted(key=cbs["v"])
    rows.sort(key=cbs["v"])                 # in-place: native sorted + C-to-C rebind
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
    assert after["trampoline_calls"] == before_t
