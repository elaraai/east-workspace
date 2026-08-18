#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast2 column projection (issue #599 — finishing #481 W3).

Two forms over one decode plan:

- INFERRED: the compute family traces its callbacks FIRST, derives the set
  of struct fields the traced IR reads, and decodes each segment to exactly
  that subset — no API, no declaration. Non-inferable callbacks (impure,
  element-escaping, un-retraceable kernels) fall back to today's whole
  decode, counted in ``eager_stats()`` with the reason.
- EXPLICIT: ``open_beast2_file(path, project=NARROW)`` — ``NARROW`` is a
  subset of the wire type; every read serves the projected shape.

The oracle everywhere is the whole decode: projected results must equal the
wide results' kept fields, and a segment decoded under a mask must never be
served to an operation needing more (the cache-correctness pin)."""

import time

import pytest

from east import (
    ArrayType,
    DictType,
    EastArray,
    EastDict,
    EastSet,
    FloatType,
    IntegerType,
    SetType,
    StringType,
    StructType,
    if_else,
    kernel,
)
from east.runtime.compiler import eager_stats
from east.serialization.beast2 import open_beast2_file, write_beast2_file

ROW = StructType([
    ("id", IntegerType),
    ("name", StringType),
    ("qty", IntegerType),
    ("amt", FloatType),
    ("tags", ArrayType(StringType)),
    ("meta", StructType([("code", StringType), ("flag", IntegerType)])),
])
AT = ArrayType(ROW)
DT = DictType(StringType, ROW)


def _rows(n):
    return [
        {
            "id": i,
            "name": f"name-{i:05d}",
            "qty": i * 7,
            "amt": i * 0.37,
            "tags": [f"t{i}-{j}" for j in range(i % 4)],
            "meta": {"code": f"c{i % 9}", "flag": i % 3},
        }
        for i in range(n)
    ]


@pytest.fixture
def array_path(tmp_path):
    path = tmp_path / "wide.beast2"
    write_beast2_file(path, AT, EastArray(ROW, _rows(500)), segment_rows=60)
    return path


@pytest.fixture
def dict_path(tmp_path):
    path = tmp_path / "wide_dict.beast2"
    rows = _rows(400)
    write_beast2_file(path, DT, EastDict(StringType, ROW,
                                         {f"k{i:05d}": rows[i] for i in range(400)}),
                      segment_rows=50)
    return path


def _delta(run):
    before = eager_stats()
    result = run()
    after = eager_stats()
    return result, {k: after[k] - before.get(k, 0) for k in after}


# ── Inferred projection ───────────────────────────────────────────────────


def test_traced_callbacks_infer_projection_and_agree(array_path):
    with open_beast2_file(array_path, AT) as f:
        table = f.load()
        cases = [
            ("map", lambda c: list(c.map(lambda r: r["qty"] * 2))),
            ("map_nested", lambda c: list(c.map(lambda r: r["meta"]["code"]))),
            ("sum", lambda c: c.sum(lambda r: r["amt"])),
            ("fold", lambda c: c.fold(0, lambda a, r: a + r["id"])),
            ("every", lambda c: c.every(lambda r: r["qty"] >= 0)),
            ("group_reduce", lambda c: dict(c.group_reduce(
                lambda r: r["meta"]["code"], lambda _k: 0,
                lambda a, r: a + r["qty"]).items())),
            ("to_dict", lambda c: dict(c.to_dict(
                lambda r: r["id"], value=lambda r: r["qty"]).items())),
        ]
        for name, run in cases:
            got, counted = _delta(lambda run=run: run(f))
            want = run(table)
            assert got == want, name
            assert counted["beast2_segments_projected"] > 0, \
                f"{name} did not project: {counted}"
            assert counted["beast2_segments_whole"] == 0, name


def test_dict_callbacks_infer_value_projection(dict_path):
    with open_beast2_file(dict_path, DT) as d:
        table = d.load()
        got, counted = _delta(
            lambda: list(d.to_array(lambda k, v: v["qty"], out=IntegerType)))
        assert got == list(table.to_array(lambda k, v: v["qty"], out=IntegerType))
        assert counted["beast2_segments_projected"] > 0

        # keys_set reads NOTHING of the value — the empty projection
        # (variant K in the issue's measurements).
        got, counted = _delta(lambda: d.keys_set())
        assert len(got) == 400
        assert counted["beast2_segments_projected"] > 0


def test_precompiled_kernels_infer_from_their_ir(array_path):
    """A kernel's retained IR supplies the mask with nothing to trace; its
    wide native form cannot run against narrow rows, so execution re-traces
    the retained source — still zero python per element."""
    qty2 = kernel(ROW, lambda r: r.qty * 2)
    with open_beast2_file(array_path, AT) as f:
        table = f.load()
        before = eager_stats()
        got = list(f.map(qty2))
        after = eager_stats()
        assert got == list(table.map(qty2))
        assert after["beast2_segments_projected"] > before["beast2_segments_projected"]
        assert after["trampoline_calls"] == before["trampoline_calls"], \
            "kernel projection dropped to per-element python"


def test_bound_kernels_decline_with_the_kernel_reason(array_path):
    side = EastDict(IntegerType, IntegerType, {i: i for i in range(500)})
    look = kernel([ROW, DictType(IntegerType, IntegerType)],
                  lambda r, t: t.get_or_default(r.id, 0)).bind(side)
    with open_beast2_file(array_path, AT) as f:
        got, counted = _delta(lambda: list(f.map(look)))
        assert got == list(range(500))
        assert counted["beast2_projection_declined_kernel"] == 1
        assert counted["beast2_segments_projected"] == 0


def test_non_inferable_callbacks_fall_back_and_count(array_path):
    with open_beast2_file(array_path, AT) as f:
        table = f.load()

        # Impure callback: per-element python semantics preserved, decline
        # counted with the untraceable reason.
        seen = []

        def impure(r):
            seen.append(r["id"])
            return r["qty"]

        got, counted = _delta(lambda: list(f.map(impure, out=IntegerType)))
        assert got == list(table.map(lambda r: r["qty"], out=IntegerType))
        assert len(seen) == 500
        assert counted["beast2_projection_declined_untraceable"] == 1
        assert counted["beast2_segments_projected"] == 0
        assert counted["beast2_segments_whole"] > 0

        # The element escaping whole (identity) declines with the escape
        # reason — nothing can be skipped.
        got, counted = _delta(lambda: list(f.map(lambda r: r)))
        assert [r["id"] for r in got] == [r["id"] for r in table]
        assert counted["beast2_projection_declined_escape"] == 1

        # Operations that embed whole elements decline statically.
        got, counted = _delta(lambda: f.filter(lambda r: r["qty"] > 100))
        assert len(got) == len(table.filter(lambda r: r["qty"] > 100))
        assert counted["beast2_projection_declined_escape"] == 1
        assert counted["beast2_segments_projected"] == 0


def test_projection_never_poisons_wider_reads(dict_path):
    """The cache-correctness pin: a segment decoded under a mask is never
    served to an operation needing more fields — a narrow scan then a keyed
    point read must answer the FULL value, and two different masks in
    sequence each see their own fields."""
    with open_beast2_file(dict_path, DT) as d:
        _, counted = _delta(
            lambda: list(d.to_array(lambda k, v: v["qty"], out=IntegerType)))
        assert counted["beast2_segments_projected"] > 0

        full = d["k00042"]
        assert dict(full["meta"].items()) == {"code": f"c{42 % 9}", "flag": 42 % 3}
        assert full["name"] == "name-00042"
        assert list(full["tags"]) == [f"t42-{j}" for j in range(42 % 4)]

        amts = list(d.to_array(lambda k, v: v["amt"], out=FloatType))
        assert amts[42] == 42 * 0.37
        names = list(d.to_array(lambda k, v: v["name"], out=StringType))
        assert names[7] == "name-00007"


def test_aliased_containers_fall_back_per_segment(tmp_path):
    """A container shared between a kept field and a skipped one makes the
    wire REF cross the projection boundary: that segment decodes whole (the
    callback observes identical fields either way) and the fallback is
    counted."""
    arr_t = ArrayType(IntegerType)
    row_t = StructType([("a", arr_t), ("b", arr_t)])
    shared = EastArray(IntegerType, [1, 2, 3])
    rows = EastArray(row_t, [{"a": shared, "b": shared} for _ in range(10)])
    path = tmp_path / "aliased.beast2"
    write_beast2_file(path, ArrayType(row_t), rows, segment_rows=5)
    with open_beast2_file(path, ArrayType(row_t)) as f:
        got, counted = _delta(lambda: list(f.map(lambda r: r["b"].sum())))
        assert got == [6] * 10
        assert counted["beast2_projection_alias_fallback"] > 0
        assert got == [s.sum() for s in f.load().map(lambda r: r["b"])]


def test_set_files_never_project(tmp_path):
    """Set elements are the container's keys; the scan stays whole with no
    decline noise."""
    st = SetType(StructType([("x", IntegerType), ("y", IntegerType)]))
    path = tmp_path / "s.beast2"
    write_beast2_file(
        path, st,
        EastSet(StructType([("x", IntegerType), ("y", IntegerType)]),
                [{"x": i, "y": -i} for i in range(30)]),
        segment_rows=8)
    with open_beast2_file(path, st) as s:
        got, counted = _delta(lambda: s.sum(lambda el: el["x"]))
        assert got == sum(range(30))
        assert counted["beast2_segments_projected"] == 0
        for key in counted:
            if key.startswith("beast2_projection_declined"):
                assert counted[key] == 0, key


# ── Explicit projection (project=) ────────────────────────────────────────


def test_explicit_projection_no_declared_type(array_path):
    """The self-describing open needs no T at all (the #481 W3 interface
    correction: project is its own argument, T keeps its meaning)."""
    narrow = ArrayType(StructType([("id", IntegerType),
                                   ("meta", StructType([("code", StringType)]))]))
    with open_beast2_file(array_path, project=narrow) as f:
        assert f.collection_type == narrow
        assert f.wire_type == AT
        assert len(f) == 500
        row = f[41]
        assert dict(row.items()) == {"id": 41, "meta": {"code": f"c{41 % 9}"}}
        table = f.load()
        assert len(table) == 500
        assert table[13]["meta"]["code"] == f"c{13 % 9}"
        # The compute family runs against the projected shape.
        assert list(f.map(lambda r: r["id"])) == list(range(500))
        # Point-read gathers project too.
        assert [r["id"] for r in f.get_keys([7, 3])] == [7, 3]


def test_explicit_projection_with_declared_type(array_path, dict_path):
    narrow = ArrayType(StructType([("qty", IntegerType)]))
    with open_beast2_file(array_path, AT, project=narrow) as f:
        assert list(f.map(lambda r: r["qty"])) == [i * 7 for i in range(500)]

    dnarrow = DictType(StringType, StructType([("amt", FloatType)]))
    with open_beast2_file(dict_path, DT, project=dnarrow) as d:
        assert d["k00009"]["amt"] == 9 * 0.37
        assert d.get_or_default("k00009", None)["amt"] == 9 * 0.37
        # fill returns a value of the PROJECTED value type — the eager
        # get_keys contract against the file's (narrow) collection type.
        got = d.get_keys(["k00003", "absent"], lambda k: {"amt": -1.0})
        assert got["k00003"]["amt"] == 3 * 0.37 and got["absent"]["amt"] == -1.0
        assert dict(d.load()["k00011"].items()) == {"amt": 11 * 0.37}


def test_explicit_projection_validation_errors(array_path, dict_path, tmp_path):
    with pytest.raises(ValueError, match=r"field 'nope' is not in the wire type"):
        open_beast2_file(array_path, project=ArrayType(StructType([("nope", IntegerType)])))
    # The error also lists the wire type's fields.
    with pytest.raises(ValueError, match=r"wire fields: id, name, qty"):
        open_beast2_file(array_path, project=ArrayType(StructType([("nope", IntegerType)])))
    # A field kept under the wrong type refuses too.
    with pytest.raises(ValueError, match="does not match the wire type"):
        open_beast2_file(array_path, project=ArrayType(StructType([("id", FloatType)])))
    # Dict keys order the container: they cannot project.
    with pytest.raises(ValueError, match="Dict keys cannot project"):
        open_beast2_file(dict_path, project=DictType(IntegerType, ROW))
    # Without project=, a narrow declared type stays an error exactly as
    # today — no accidental silent field-dropping.
    with pytest.raises(ValueError, match="declared type does not match"):
        open_beast2_file(array_path, ArrayType(StructType([("id", IntegerType)])))
    # Write mode refuses the read-mode option.
    with pytest.raises(ValueError, match="read-mode option"):
        open_beast2_file(tmp_path / "w.beast2", AT, mode="w",
                         project=ArrayType(StructType([("id", IntegerType)])))


def test_explicit_projection_refuses_find_sorted(tmp_path):
    at = ArrayType(StructType([("k", IntegerType), ("pad", StringType)]))
    path = tmp_path / "sorted.beast2"
    write_beast2_file(path, at, EastArray(
        at.value, [{"k": i, "pad": f"p{i}"} for i in range(50)]), segment_rows=10)
    narrow = ArrayType(StructType([("k", IntegerType)]))
    with open_beast2_file(path, project=narrow) as f, \
            pytest.raises(RuntimeError, match="whole elements"):
        f.find_sorted_first({"k": 25})


def test_identity_projection_is_a_no_op(array_path):
    with open_beast2_file(array_path, project=AT) as f:
        assert f._projection is None
        assert len(f.load()) == 500


def test_projected_and_whole_reads_share_one_wire(array_path):
    """Zero wire change: one blob answers both shapes."""
    with open_beast2_file(array_path, AT) as whole, \
            open_beast2_file(array_path,
                             project=ArrayType(StructType([("id", IntegerType)]))) as thin:
        assert [r["id"] for r in whole.load()] == [r["id"] for r in thin.load()]


# ── The performance claim (AC 1) ──────────────────────────────────────────


def test_projected_scan_beats_the_bare_whole_decode(tmp_path):
    """The issue's K-vs-F cliff, inverted: a traced scan reading ONE shallow
    field of a wide record — the whole operation, trace and fold included —
    must beat even a bare whole decode that does no work at all, because
    value materialisation (not byte-walking) dominates decode cost. Before
    projection, reading nothing cost 88% of reading everything; the pin
    keeps a wide margin for CI noise (measured ~2.5x)."""
    wide_row = StructType(
        [("id", IntegerType)]
        + [(f"s{i}", StringType) for i in range(16)]
        + [("tags", ArrayType(StringType))]
    )
    at = ArrayType(wide_row)
    rows = EastArray(wide_row, [
        {
            "id": i,
            **{f"s{j}": f"string-payload-{i}-{j}" for j in range(16)},
            "tags": [f"tag-{i}-{j}" for j in range(8)],
        }
        for i in range(20_000)
    ])
    path = tmp_path / "perf.beast2"
    write_beast2_file(path, at, rows, segment_rows=4000)

    def best_of(runs, fn):
        best = float("inf")
        for _ in range(runs):
            t0 = time.perf_counter()
            fn()
            best = min(best, time.perf_counter() - t0)
        return best

    def bare_whole_decode(f):
        n = 0
        for segment in f._iter_segments():
            n += len(segment)
        return n

    with open_beast2_file(path, at) as f:
        projected_op = best_of(3, lambda: f.sum(lambda r: r["id"]))
        whole_decode = best_of(3, lambda: bare_whole_decode(f))
        got, counted = _delta(lambda: f.sum(lambda r: r["id"]))
        assert got == sum(range(20_000))
        assert counted["beast2_segments_projected"] == 5
    assert projected_op < whole_decode * 0.7, \
        f"projected op {projected_op * 1e3:.1f}ms vs bare whole decode " \
        f"{whole_decode * 1e3:.1f}ms"


def test_paged_loop_task_inputs_project(array_path):
    """AC2's task-input half: a compiled body iterating a lazy paged input —
    exactly how the runner opens beast2 task inputs (open_paged_value,
    frozen) — decodes each segment to the fields its IR reads, with no API
    change at either site. A body the walker cannot prove field-only keeps
    the whole decode, visible in the paired counter."""
    from pathlib import Path

    from east import East
    from east.runtime._compiler_eastc import open_paged_value

    data = Path(array_path).read_bytes()

    narrow_k = kernel(AT, lambda rows: East.for_(
        rows, 0, lambda acc, el: acc + el.qty))
    type_ptr = narrow_k._eastc_handle._input_types[0]
    lazy = open_paged_value(type_ptr, data, frozen=True)
    assert lazy is not None
    before = eager_stats()
    got = narrow_k(lazy)
    after = eager_stats()
    assert got == sum(i * 7 for i in range(500))
    assert after["beast2_paged_loop_segments_projected"] > \
        before["beast2_paged_loop_segments_projected"]
    assert after["beast2_paged_loop_segments_whole"] == \
        before["beast2_paged_loop_segments_whole"]

    # The element compared WHOLE: nothing to skip, so the loop decodes whole
    # and says so.
    whole_k = kernel(AT, lambda rows: East.for_(
        rows, 0, lambda acc, el: acc + if_else(el == el, 1, 0)))
    lazy2 = open_paged_value(whole_k._eastc_handle._input_types[0], data, frozen=True)
    before = eager_stats()
    got = whole_k(lazy2)
    after = eager_stats()
    assert got == 500
    assert after["beast2_paged_loop_segments_whole"] > \
        before["beast2_paged_loop_segments_whole"]
    assert after["beast2_paged_loop_segments_projected"] == \
        before["beast2_paged_loop_segments_projected"]


def test_eager_stats_carries_the_projection_counters():
    stats = eager_stats()
    for key in [
        "beast2_segments_projected",
        "beast2_segments_whole",
        "beast2_projection_declined_untraceable",
        "beast2_projection_declined_escape",
        "beast2_projection_declined_kernel",
        "beast2_projection_declined_unpageable",
        "beast2_projection_declined_shape",
        "beast2_projection_alias_fallback",
    ]:
        assert key in stats, key
