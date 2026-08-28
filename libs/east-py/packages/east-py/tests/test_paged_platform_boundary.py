#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Lazy paged task inputs at the platform-function call boundary (#621).

The runner opens large beast2 collection inputs as lazy paged values and a
compiled body consumes them at O(segment). A platform-function call with such
an input as an argument must NOT hydrate it whole at the boundary: the python
dispatch receives a pager-backed proxy whose size / keyed reads / iteration
answer from the pager (the TS runtime's LazyMap contract), and only
operations that genuinely need the whole value hydrate — once, cached on the
wrapper. ``paged_value_is_hydrated`` is the laziness oracle: deterministic
where an RSS assertion would be noise.
"""

from pathlib import Path

from east.runtime._compiler_eastc import open_paged_value, paged_value_is_hydrated

from east import (
    ArrayType,
    DictType,
    EastArray,
    EastDict,
    EastSet,
    IntegerType,
    SetType,
    StringType,
    StructType,
)
from east.ir.builders import ir_function, ir_platform, ir_variable
from east.runtime.compiler import compile_from_value
from east.runtime.platform import PlatformFunction
from east.serialization.beast2 import write_beast2_file
from east.types.types import FunctionType

ROW = StructType([("qty", IntegerType), ("tags", ArrayType(StringType))])
DT = DictType(StringType, ROW)
N = 400


def _dict_blob(tmp_path) -> bytes:
    path = tmp_path / "input.beast2"
    write_beast2_file(
        path, DT,
        EastDict(StringType, ROW, {
            f"k{i:05d}": {"qty": i * 7, "tags": [f"t{i}-{j}" for j in range(i % 3)]}
            for i in range(N)
        }),
        segment_rows=50)
    return Path(path).read_bytes()


def _compile_probe(input_type, output_type, impl):
    """A compiled program whose body is one platform call taking the input."""
    fn_ir = ir_function(
        FunctionType([input_type], output_type),
        [],
        [ir_variable(input_type, "d")],
        ir_platform(output_type, "probe", [ir_variable(input_type, "d")]),
    )
    platform = [PlatformFunction(
        name="probe", inputs=[input_type], output=output_type, type="sync", fn=impl)]
    return compile_from_value(fn_ir, platform)


def _open_lazy(compiled, data: bytes, frozen: bool = True):
    lazy = open_paged_value(compiled._eastc_handle._input_types[0], data, frozen=frozen)
    assert lazy is not None, "input did not open as a lazy paged value"
    return lazy


def test_platform_fn_reads_stay_pager_served(tmp_path):
    """size, keyed get, membership and full iteration inside the platform
    function never hydrate — the compiled body's O(segment) cost model."""
    data = _dict_blob(tmp_path)
    seen = {}

    def probe(d):
        seen["len"] = len(d)
        seen["k7"] = d["k00007"]["qty"]
        seen["has"] = "k00003" in d
        seen["missing"] = "nope" in d
        seen["sum"] = sum(v["qty"] for _k, v in d.items())
        seen["keys_prefix"] = [k for k, _v in d.items()][:2]
        return seen["sum"]

    compiled = _compile_probe(DT, IntegerType, probe)
    lazy = _open_lazy(compiled, data)
    got = compiled(lazy)

    assert got == sum(i * 7 for i in range(N))
    assert seen["len"] == N
    assert seen["k7"] == 49
    assert seen["has"] is True
    assert seen["missing"] is False
    assert seen["keys_prefix"] == ["k00000", "k00001"]
    assert paged_value_is_hydrated(lazy._east_c_paged) is False, \
        "the platform call hydrated a pager-servable workload"


def test_platform_fn_whole_value_ops_hydrate_once(tmp_path):
    """An eager method with no pager serving (DictToArray via the funnel)
    hydrates the wrapper once and computes correctly — the funnel applies the
    evaluator's IR_BUILTIN gate, without which a kind-blind builtin would
    read the paged union arms as garbage."""
    data = _dict_blob(tmp_path)

    def probe(d):
        return int(d.to_array(lambda _b, v: v["qty"], out=IntegerType).sum())

    compiled = _compile_probe(DT, IntegerType, probe)
    lazy = _open_lazy(compiled, data)
    got = compiled(lazy)

    assert got == sum(i * 7 for i in range(N))
    assert paged_value_is_hydrated(lazy._east_c_paged) is True


def test_platform_fn_frozen_mutation_refuses(tmp_path):
    """A frozen paged input refuses mutation with the uniform cross-runtime
    copy-first message — loudly, where east_dict_set on a paged value used to
    be a silent no-op."""
    data = _dict_blob(tmp_path)
    seen = {}

    def probe(d):
        try:
            d["zzz"] = {"qty": 1, "tags": []}
            seen["mutated"] = True
        except Exception as e:  # noqa: BLE001 — the message is the assertion
            seen["error"] = str(e)
        return len(d)

    compiled = _compile_probe(DT, IntegerType, probe)
    lazy = _open_lazy(compiled, data)
    assert compiled(lazy) == N
    assert "mutated" not in seen
    assert "cannot mutate a frozen value" in seen.get("error", "")
    assert paged_value_is_hydrated(lazy._east_c_paged) is False


def test_platform_fn_unfrozen_mutation_hydrates_and_applies(tmp_path):
    """A non-frozen paged input mutates through its hydrated child — the
    hydrate-once-and-delegate rule, coherent with subsequent reads."""
    path = tmp_path / "flat.beast2"
    flat = DictType(StringType, IntegerType)
    write_beast2_file(path, flat,
                      EastDict(StringType, IntegerType,
                               {f"k{i:03d}": i for i in range(120)}),
                      segment_rows=16)
    data = Path(path).read_bytes()

    def probe(d):
        d["new"] = 1000
        return d["new"] + len(d)

    compiled = _compile_probe(flat, IntegerType, probe)
    lazy = _open_lazy(compiled, data, frozen=False)
    assert compiled(lazy) == 1000 + 121
    assert paged_value_is_hydrated(lazy._east_c_paged) is True


def test_platform_fn_array_and_set_inputs(tmp_path):
    """Array indexed reads (owned pager elements, negative indices) and Set
    membership + streaming iteration, all without hydration."""
    at = ArrayType(IntegerType)
    apath = tmp_path / "a.beast2"
    write_beast2_file(apath, at, EastArray(IntegerType, list(range(300))),
                      segment_rows=32)
    seen = {}

    def aprobe(a):
        seen["len"] = len(a)
        seen["first"] = a[0]
        seen["mid"] = a[150]
        seen["last"] = a[-1]
        seen["total"] = sum(a)
        return seen["total"]

    compiled = _compile_probe(at, IntegerType, aprobe)
    lazy = _open_lazy(compiled, Path(apath).read_bytes())
    assert compiled(lazy) == sum(range(300))
    assert seen == {"len": 300, "first": 0, "mid": 150, "last": 299,
                    "total": sum(range(300))}
    assert paged_value_is_hydrated(lazy._east_c_paged) is False

    st = SetType(IntegerType)
    spath = tmp_path / "s.beast2"
    write_beast2_file(spath, st, EastSet(IntegerType, list(range(200))),
                      segment_rows=25)

    def sprobe(s):
        assert len(s) == 200
        assert 42 in s
        assert 4200 not in s
        return sum(s)

    scompiled = _compile_probe(st, IntegerType, sprobe)
    slazy = _open_lazy(scompiled, Path(spath).read_bytes())
    assert scompiled(slazy) == sum(range(200))
    assert paged_value_is_hydrated(slazy._east_c_paged) is False
