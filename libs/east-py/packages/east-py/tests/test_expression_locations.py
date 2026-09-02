#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Authoring-frame source maps for python-built functions (#626).

PYTHON-SPELLING pins only (test policy, #623): WHICH python frames a build
records for its nodes, how they surface on ``EastError.location``, the
relativized path form, and that the map survives export — through east-c's
own decode and through the TypeScript runtime's. What a builtin raises, and
where an error inside a compiled body resolves on a given runner, is
runtime-shared behaviour pinned by the TS compliance corpus; nothing here
pins a builtin's value.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from east import (
    East,
    EastError,
    FunctionType,
    IntegerType,
    NullType,
    SourceMap,
    StringType,
    set_location_base_path,
)
from east.expression import capture_callback, trace
from east.expression.location import (
    UNKNOWN_LOC_ID,
    capture_frames,
    current_source_map,
    location_id,
    source_map_scope,
)
from east.runtime.platform import PlatformFunction
from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_with_header_for,
)
from east.types.values import EastFunction

HERE = Path(__file__).resolve()
FN_T = FunctionType([IntegerType], IntegerType)

# The TS runtime, when libs/east has been built (npm run build) — the
# east-node leg skips otherwise, exactly like the compliance corpus skip.
EAST_INDEX = HERE.parents[4] / "east" / "dist" / "src" / "index.js"
NODE = shutil.which("node")


def _raises(fn, *args) -> EastError:
    with pytest.raises(EastError) as info:
        fn(*args)
    return info.value


def _frames(err: EastError) -> list[tuple[str, int, int]]:
    return [(loc["filename"], loc["line"], loc["column"]) for loc in err.location]


def _is_this_file(path: str) -> bool:
    return Path(path).name == HERE.name


def _column_of(line: int, text: str) -> int:
    """The 1-based column where ``text`` starts on line ``line`` of this file."""
    return HERE.read_text().splitlines()[line - 1].index(text) + 1


def _build_divider():
    return East.function([IntegerType], IntegerType,
                         lambda _b, x: East.Integer.divide(x, 0))


DIVIDER_CALL_LINE = _build_divider.__code__.co_firstlineno + 1   # East.function(...)
DIVIDER_BODY_LINE = _build_divider.__code__.co_firstlineno + 2   # the lambda


# ─── What a build records ───────────────────────────────────────────────────


def test_runtime_error_names_the_authoring_expression():
    fn = _build_divider()
    frames = _frames(_raises(fn, 1))
    assert frames, "the error carries the python frames that built the node"
    # Innermost first: the expression inside the lambda, then the
    # East.function(...) call that built it, then this test's call to the
    # builder — and nothing of East's own, pytest's or the interpreter's.
    assert frames[0][1:] == (DIVIDER_BODY_LINE, _column_of(DIVIDER_BODY_LINE, "East.Integer.divide"))
    assert frames[1][1:] == (DIVIDER_CALL_LINE, _column_of(DIVIDER_CALL_LINE, "East.function"))
    assert frames[2][1] == (
        test_runtime_error_names_the_authoring_expression.__code__.co_firstlineno + 1)
    assert all(_is_this_file(path) for path, _line, _column in frames), frames


def test_artifact_carries_its_source_map():
    fn = _build_divider()
    source_map = fn._east_source_map
    assert isinstance(source_map, SourceMap)
    assert len(source_map) > 1
    assert source_map.resolve(UNKNOWN_LOC_ID) == ()
    assert any(_is_this_file(path)
               for stack in source_map.entries() for path, _line, _column in stack)


def test_bound_function_reports_the_same_frames():
    divide = East.function([IntegerType, IntegerType], IntegerType,
                           lambda _b, a, b: East.Integer.divide(a, b))
    body_line = test_bound_function_reports_the_same_frames.__code__.co_firstlineno + 2
    assert _frames(_raises(divide.bind(0), 7))[0][1] == body_line


def test_nested_build_names_the_inner_expression():
    inner = East.function([IntegerType], IntegerType,
                          lambda _b, x: East.Integer.divide(x, 0))
    outer = East.function([IntegerType], IntegerType,
                          lambda _b, x: inner(x + 1))
    base = test_nested_build_names_the_inner_expression.__code__.co_firstlineno
    frames = _frames(_raises(outer, 1))
    # The inner body re-ran inside the outer build (one shared map), so the
    # failing node's innermost frame is the inner lambda, with the outer
    # lambda's call to it above.
    assert frames[0][1] == base + 2
    assert base + 4 in [line for _path, line, _column in frames[1:]]


def test_captured_callback_carries_its_authoring_frames():
    captured = capture_callback(EastFunction(lambda _b, v: East.Integer.divide(v, 0),
                                             [IntegerType], IntegerType))
    line = test_captured_callback_carries_its_authoring_frames.__code__.co_firstlineno + 1
    frames = _frames(_raises(captured, 3))
    assert frames[0][1] == line
    assert _is_this_file(frames[0][0])


def test_compiled_platform_function_reports_locations():
    probe = East.platform("t.loc_probe", [IntegerType], IntegerType)
    f = East.function([IntegerType], IntegerType,
                      lambda _b, x: East.Integer.divide(probe(x), 0))
    line = test_compiled_platform_function_reports_locations.__code__.co_firstlineno + 3
    compiled = East.compile(f, platform=[PlatformFunction(
        name="t.loc_probe", inputs=[IntegerType], output=IntegerType, type="sync",
        fn=lambda x: x)])
    assert _frames(_raises(compiled, 1))[0][1] == line


def test_platform_signature_mismatch_names_the_call_site():
    log = East.platform("t.loc_sig", [StringType], NullType)
    f = East.function([StringType], NullType, lambda _b, s: log(s))
    line = test_platform_signature_mismatch_names_the_call_site.__code__.co_firstlineno + 2
    with pytest.raises(EastError, match="requires exact type match") as info:
        East.compile(f, platform=[PlatformFunction(
            name="t.loc_sig", inputs=[IntegerType], output=NullType, type="sync",
            fn=lambda s: None)])
    assert re.search(rf" at \S*{re.escape(HERE.name)}:{line}:\d+", info.value.message), \
        info.value.message


# ─── Export: the map rides the function value ───────────────────────────────


def test_locations_survive_a_beast2_round_trip_on_east_c():
    fn = _build_divider()
    blob = encode_beast2_with_header_for(FN_T)(fn)
    decoded = decode_beast2_with_header_for(FN_T)(blob)
    assert _frames(_raises(decoded, 5)) == _frames(_raises(fn, 5))


@pytest.mark.skipif(NODE is None or not EAST_INDEX.exists(),
                    reason="needs node and a built libs/east (npm run build)")
def test_locations_survive_a_beast2_round_trip_on_east_node(tmp_path):
    fn = _build_divider()
    blob_path = tmp_path / "divider.beast2"
    blob_path.write_bytes(encode_beast2_with_header_for(FN_T)(fn))
    run = subprocess.run(
        [NODE, str(HERE.parent / "node_decode_location.mjs"),
         str(blob_path), str(EAST_INDEX), "5"],
        capture_output=True, text=True, check=False)
    assert run.returncode == 0, run.stderr
    report = json.loads(run.stdout)
    assert report["raised"], report
    assert [(loc["filename"], loc["line"], loc["column"]) for loc in report["location"]] \
        == _frames(_raises(fn, 5))


# ─── Paths, scope, interning ────────────────────────────────────────────────


def test_set_location_base_path_relativizes_captured_paths():
    try:
        set_location_base_path(str(HERE.parent))
        assert capture_frames()[0][0] == HERE.name
        set_location_base_path(str(HERE.parent / "elsewhere"))
        assert Path(capture_frames()[0][0]).is_absolute()
    finally:
        set_location_base_path(None)
    # The default base is the working directory: relative under it, absolute
    # outside — either way the path ends with this file.
    assert capture_frames()[0][0].replace("\\", "/").endswith(f"tests/{HERE.name}")


def test_nodes_outside_a_build_carry_no_location():
    assert current_source_map() is None
    assert location_id() == UNKNOWN_LOC_ID
    # A bare trace (a type-only derivation) captures nothing.
    ir, _out, _binds = trace(lambda _b, x: East.Integer.divide(x, 0), [IntegerType])
    assert ir.value["loc_id"] == UNKNOWN_LOC_ID
    assert ir.value["body"].value["loc_id"] == UNKNOWN_LOC_ID
    with source_map_scope() as source_map:
        assert current_source_map() is source_map
        loc = location_id()
        assert loc > 0
        assert _is_this_file(source_map.resolve(loc)[0][0])
        with source_map_scope() as nested:
            assert nested is source_map   # a nested build shares the map
    assert current_source_map() is None


def test_source_map_interns_stacks_by_content():
    source_map = SourceMap()
    a = source_map.intern_stack((("f.py", 3, 1), ("g.py", 9, 5)))
    b = source_map.intern_stack((("f.py", 3, 1), ("g.py", 9, 5)))
    c = source_map.intern_stack((("f.py", 4, 1),))
    assert (a, b, c) == (1, 1, 2)
    assert source_map.intern_stack(()) == UNKNOWN_LOC_ID
    assert source_map.resolve(UNKNOWN_LOC_ID) == ()
    assert source_map.resolve(99) == ()
    assert len(source_map) == 3
    assert source_map.entries()[0] == ()
