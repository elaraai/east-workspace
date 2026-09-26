#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR compilation and execution — uses east-c backend directly.

All formats (JSON, BEAST2, East text) go straight from raw bytes to C
with no Python IR round-trip.
"""

import os
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from time import perf_counter
from typing import Any

from east.runtime.compiler import compile_from_beast2, compile_from_east, compile_from_json
from east.runtime.errors import EastError
from east.runtime.platform import PlatformFunction
from east.serialization.east_printer import print_east, print_type

from east_py_cli.loader import detect_format, load_platform, load_value, save_value


def _format_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def _format_file_size(path: Path) -> str:
    try:
        return _format_size(Path(path).stat().st_size)
    except OSError:
        return "?"


# east-node parity: indexed beast2 collection inputs at or above this many
# bytes open as lazy paged values (EAST_LAZY_INPUT_BYTES overrides; 0
# disables).
_LAZY_INPUT_BYTES_DEFAULT = 64 * 1024 * 1024


def _lazy_input_threshold() -> int:
    env = os.environ.get("EAST_LAZY_INPUT_BYTES", "")
    if env:
        try:
            value = int(env)
        except ValueError:
            value = -1
        if value >= 0:
            return value
    return _LAZY_INPUT_BYTES_DEFAULT


def _load_frozen_input(type_ptr: object, file_path: Path, param_type: Any) -> object:
    """An eagerly-decoded FROZEN input value — task inputs are immutable
    (mutating builtins raise the uniform copy-first error, and frozen
    collections compare by value). beast2 files decode frozen directly;
    other formats load as python values and re-freeze through the beast2
    round-trip, so every format honors the same contract."""
    from east.runtime._compiler_eastc import freeze_value, load_frozen_value

    if Path(file_path).suffix.lower() in (".beast2", ".beast"):
        return load_frozen_value(type_ptr, Path(file_path).read_bytes())
    return freeze_value(type_ptr, load_value(file_path, param_type))


def _compile_ir_file(ir_file: Path, platform_fns: list[PlatformFunction]) -> tuple[Callable, bool]:
    """Compile an IR file straight from its bytes — no Python IR round-trip,
    a single file read — returning the compiled function and whether it is
    async."""
    fmt = detect_format(ir_file)
    is_async = False
    if fmt == "json":
        data = ir_file.read_bytes()
        is_async = b'"AsyncFunction"' in data[:200]
        return compile_from_json(data, platform_fns, is_async), is_async
    if fmt == "beast2":
        return compile_from_beast2(ir_file.read_bytes(), platform_fns, is_async), is_async
    if fmt == "east":
        text = ir_file.read_text(encoding="utf-8")
        is_async = "AsyncFunction" in text[:200]
        return compile_from_east(text, platform_fns, is_async), is_async
    raise ValueError(f"Unknown IR format: {fmt}")


def print_result(timings: dict[str, float], peak_bytes: int) -> None:
    """Print a unit's result as ``-v`` shows it: where the time went, in
    milliseconds, and the process's peak memory."""
    print("\nTiming:", file=sys.stderr)
    print(f"  Load:     {timings['load']:8.1f} ms", file=sys.stderr)
    print(f"  Compile:  {timings['compile']:8.1f} ms", file=sys.stderr)
    print(f"  Execute:  {timings['execute']:8.1f} ms", file=sys.stderr)
    print(f"  Output:   {timings['output']:8.1f} ms", file=sys.stderr)
    print(f"  Total:    {sum(timings.values()):8.1f} ms", file=sys.stderr)
    print("\nMemory:", file=sys.stderr)
    if peak_bytes >= 1024 * 1024:
        print(f"  Peak RSS: {peak_bytes / (1024 * 1024):8.1f} MB", file=sys.stderr)
    else:
        print(f"  Peak RSS: {peak_bytes / 1024:8.0f} KB", file=sys.stderr)


def _open_inputs(handle: Any, input_files: Sequence[Path], lazy: Callable[[int, int], bool],
                 verbose: bool) -> tuple[list[object], list[int]]:
    """A program's inputs, always FROZEN — task inputs are immutable; mutating
    one raises the uniform copy-first error — and which of them opened lazily.

    A beast2 collection input ``i`` of ``size`` bytes for which ``lazy(i,
    size)`` holds opens as a lazy paged value (segment-fed iteration and keyed
    reads at O(segment) decoded memory — #505), and because frozen collapses
    the shape gate, nested-container element shapes open lazily too. A lazily
    opened file is MAPPED, never read whole: the paged value serves its reads
    from the mapping, so the input's residency is the page cache and the heap
    holds one decoded segment at a time. Anything not pageable falls back to
    the whole (frozen) decode, exactly like east-node's runner. A file
    holding a manifest is the collection it names, its segments in the
    directory beside it, and it weighs its segments rather than its own few
    kilobytes.
    """
    from east.runtime._compiler_eastc import (
        load_frozen_manifest,
        manifest_segment_bytes,
        open_manifest_file,
        open_paged_file,
    )

    input_types = handle.get_input_types()
    inputs: list[object] = []
    lazy_inputs: list[int] = []
    for i, (file_path, param_type) in enumerate(zip(input_files, input_types, strict=False)):
        beast2 = Path(file_path).suffix.lower() in (".beast2", ".beast")
        collection = getattr(param_type, "type", None) in ("Array", "Set", "Dict")
        weight = manifest_segment_bytes(file_path) if beast2 and collection else None
        size = Path(file_path).stat().st_size + (weight or 0)
        opened = None
        if beast2 and collection and lazy(i, size):
            try:
                opener = open_paged_file if weight is None else open_manifest_file
                opened = opener(handle._input_types[i], file_path, frozen=True)
            except (OSError, ValueError):
                # Not a container of the parameter's type, or a file that
                # cannot be mapped: the whole decode below reads it and
                # reports the real error.
                opened = None
        if opened is not None:
            lazy_inputs.append(i)
            if verbose:
                print(f"  input {i}: opened lazily — mapped from the file", file=sys.stderr)
            inputs.append(opened)
        elif weight is not None:
            inputs.append(load_frozen_manifest(handle._input_types[i], file_path))
        else:
            inputs.append(_load_frozen_input(handle._input_types[i], file_path, param_type))
    return inputs, lazy_inputs


def execute_unit(unit_path: Path) -> dict[str, Any]:
    """Execute a unit — ``east-py exec``: do its work, write its output, and
    record its result where the unit says.

    The unit, the result and the output writers are east-c's (east/unit.h),
    the very code the east-c CLI runs, so the two runners read the same units
    and write the same bytes; east-node implements the same protocol, and the
    conformance corpus holds the three to it.

    Returns the result: ``ok``, a failure's ``message`` and ``locations``
    (``(filename, line, column)``, innermost first), ``peak_bytes`` and
    ``timings``. A failure is the result's, never a raise.

    Raises:
        ValueError: If the file does not hold a unit.
        OSError: If the result cannot be written.
    """
    from east.serialization._beast2_eastc import (
        _peak_bytes,
        _read_unit,
        _set_thread_limit,
        _write_unit_result,
    )

    unit = _read_unit(unit_path)
    # The grant caps every pool east-c starts; one thread frames every output
    # inline.
    _set_thread_limit(min(max(unit["threads"], 1), 1024))
    timings = {"load": 0.0, "compile": 0.0, "execute": 0.0, "output": 0.0}
    mark = perf_counter()

    def lap(phase: str) -> None:
        nonlocal mark
        now = perf_counter()
        timings[phase] += (now - mark) * 1000
        mark = now

    result: dict[str, Any]
    try:
        platform_fns: list[PlatformFunction] = []
        for package in unit["platforms"]:
            platform_fns.extend(load_platform(package))
        if unit["merge"]:
            _merge_work(unit, platform_fns, lap)
        else:
            _run_work(unit, platform_fns, lap)
        result = {"ok": True, "message": None, "locations": []}
    except EastError as e:
        result = {
            "ok": False,
            "message": e.message,
            "locations": [(frame["filename"], frame["line"], frame["column"]) for frame in e.location],
        }
    except Exception as e:  # noqa: BLE001 - every failure is the result's
        result = {"ok": False, "message": str(e), "locations": []}
    result["peak_bytes"] = _peak_bytes()
    result["timings"] = timings
    _write_unit_result(unit["result"], result["ok"], result["message"], result["locations"],
                       result["peak_bytes"], timings)
    return result


def _emit_parameter(kind: str, emit_type: Any) -> list[Any]:
    """The emit parameter's argument types, checked against the output's kind:
    one for an array, a set or a fold, a key and a value for a dict."""
    arity = 2 if kind == "dict" else 1
    if getattr(emit_type, "type", None) != "Function" or len(emit_type.value["inputs"]) != arity:
        raise ValueError(
            f"exec: a {kind} output is emitted: the program's trailing parameter must be emit, "
            f"a function of {arity} argument{'' if arity == 1 else 's'}, got "
            f"{print_type(emit_type)}")
    return list(emit_type.value["inputs"])


def _run_work(unit: dict[str, Any], platform_fns: list[PlatformFunction],
              lap: Callable[[str], None]) -> None:
    """A run unit: the program evaluated on its inputs, its output written by
    kind."""
    from east.runtime._compiler_eastc import _eastc_call, load_frozen_value
    from east.serialization._beast2_eastc import _UnitSinkCore, _write_unit_value

    compiled, _ = _compile_ir_file(Path(unit["program"]), platform_fns)
    handle = compiled._eastc_handle  # type: ignore[attr-defined]
    input_types = handle.get_input_types()
    output = unit["output"]
    # Every kind but a value is emitted, through the trailing parameter.
    emitted = output["kind"] != "value"
    if emitted and not input_types:
        raise ValueError(
            f"exec: a {output['kind']} output is emitted: the program's trailing parameter "
            "must be emit, a function")
    params = input_types[:-1] if emitted else input_types
    if len(unit["inputs"]) != len(params):
        sig_params = ", ".join(print_type(t) for t in input_types)
        raise ValueError(
            f"Function expects {len(params)} inputs, got {len(unit['inputs'])}\n"
            f"Signature: ({sig_params}) -> {print_type(handle.get_output_type())}")

    sink = None
    if emitted:
        emit_types = _emit_parameter(output["kind"], input_types[-1])
        merge = combine = zero = None
        if output["kind"] == "dict" and output["merge"] is not None:
            merge = _compile_ir_file(Path(output["merge"]), platform_fns)[0]
        if output["kind"] == "fold":
            combine = _compile_ir_file(Path(output["combine"]), platform_fns)[0]
            zero = load_frozen_value(emit_types[0], Path(output["zero"]).read_bytes())
        sink = _UnitSinkCore(output["kind"], emit_types, output["path"], merge=merge,
                             combine=combine, zero=zero)
    lap("compile")

    threshold = _lazy_input_threshold()
    inputs, _ = _open_inputs(handle, [Path(p) for p in unit["inputs"]],
                             lambda _i, size: threshold > 0 and size >= threshold, False)
    if sink is not None:
        inputs.append(sink.function_value())
    lap("load")

    returned = _eastc_call(handle._compiled, handle._input_types, handle._output_type, tuple(inputs))
    lap("execute")
    if sink is not None:
        sink.finish()
    else:
        _write_unit_value(handle.get_output_type(), output["path"], returned)
    lap("output")


def _merge_work(unit: dict[str, Any], platform_fns: list[PlatformFunction],
                lap: Callable[[str], None]) -> None:
    """A merge unit: set or dict parts merged into one run, or fold partials
    folded in order, starting at zero."""
    from east.runtime._compiler_eastc import load_frozen_value
    from east.serialization._beast2_eastc import _unit_merge_runs, _write_unit_value

    output = unit["output"]
    kind = output["kind"]
    if kind == "array":
        raise ValueError(
            "exec: an array's parts are concatenated, never merged: a merge unit takes set, "
            "dict or fold parts")
    if kind == "value":
        raise ValueError("exec: a value has no parts: a merge unit takes set, dict or fold parts")
    if kind in ("set", "dict"):
        merge = None
        if kind == "dict" and output["merge"] is not None:
            merge = _compile_ir_file(Path(output["merge"]), platform_fns)[0]
        lap("load")
        _unit_merge_runs(unit["inputs"], output["path"], kind, unit["range"], merge)
        lap("execute")
        return
    # A merge of fold partials has no program to say what was emitted: the
    # combine's own type does.
    combine = _compile_ir_file(Path(output["combine"]), platform_fns)[0]
    ins = combine._eastc_handle.get_input_types()  # type: ignore[attr-defined]
    value_type = combine._eastc_handle.get_output_type()  # type: ignore[attr-defined]
    if len(ins) != 2 or ins[0] != value_type or ins[1] != value_type:
        raise ValueError(
            f"exec: combine: expected a function (T, T) -> T (T = {print_type(value_type)}), "
            f"got ({', '.join(print_type(t) for t in ins)}) -> {print_type(value_type)}")
    acc = load_frozen_value(value_type, Path(output["zero"]).read_bytes())
    lap("compile")
    for part in unit["inputs"]:
        acc = combine(acc, load_frozen_value(value_type, Path(part).read_bytes()))
    lap("execute")
    _write_unit_value(value_type, output["path"], acc)
    lap("output")


def run_program(
    ir_file: Path,
    platform_fns: list[PlatformFunction],
    packages: list[str],
    input_files: list[Path],
    output_file: Path | None = None,
    verbose: bool = False,
) -> object:
    """Run an East IR program: its result written to ``output_file`` in the
    format its extension names, or printed as East text."""
    t0 = perf_counter()

    # Compile directly from raw data — no Python IR round-trip, single file read
    compiled, is_async = _compile_ir_file(ir_file, platform_fns)

    t1 = perf_counter()

    handle = compiled._eastc_handle  # type: ignore[attr-defined]
    input_types = handle.get_input_types()
    output_type = handle.get_output_type()

    # Validate input count
    if len(input_files) != len(input_types):
        sig_params = ", ".join(print_type(t) for t in input_types)
        raise ValueError(
            f"Function expects {len(input_types)} inputs, got {len(input_files)}\n"
            f"Signature: ({sig_params}) -> {print_type(output_type)}"
        )

    # Verbose header
    if verbose:
        print(f"Running: {ir_file}  ({_format_file_size(ir_file)})", file=sys.stderr)

        if packages:
            print(
                f"Platform: {len(packages)} package(s), {len(platform_fns)} function(s)",
                file=sys.stderr,
            )
            for p in packages:
                print(f"  - {p}", file=sys.stderr)

        print(
            f"Function: {len(input_types)} inputs, {'async' if is_async else 'sync'}",
            file=sys.stderr,
        )
        for i, (file_path, param_type) in enumerate(zip(input_files, input_types, strict=False)):
            print(f"  input {i}: {file_path}  ({_format_file_size(file_path)})", file=sys.stderr)
            print(f"    {print_type(param_type)}", file=sys.stderr)
        print("  return:", file=sys.stderr)
        print(f"    {print_type(output_type)}", file=sys.stderr)

    # Indexed beast2 collection inputs open lazily at or above the size
    # threshold.
    threshold = _lazy_input_threshold()
    inputs, lazy_inputs = _open_inputs(
        handle, input_files, lambda _i, size: threshold > 0 and size >= threshold, verbose)

    t2 = perf_counter()

    # Execute via east-c
    from east.runtime._compiler_eastc import _eastc_call

    result = _eastc_call(handle._compiled, handle._input_types, handle._output_type, tuple(inputs))

    t3 = perf_counter()

    # Output
    if output_file is not None:
        save_value(output_file, result, output_type)
        if verbose:
            print(f"Output: {output_file}  ({_format_file_size(output_file)})", file=sys.stderr)
            print(f"  {print_type(output_type)}", file=sys.stderr)
    else:
        print(print_east(result, output_type))

    t4 = perf_counter()

    if verbose:
        from east.serialization._beast2_eastc import _peak_bytes

        print_result({
            "load": (t1 - t0) * 1000,
            "compile": (t2 - t1) * 1000,
            "execute": (t3 - t2) * 1000,
            "output": (t4 - t3) * 1000,
        }, _peak_bytes())

        # What each lazy input's reads came to — the account residency
        # cannot give on a mapping, where the kernel decides how much of a
        # touched file is resident.
        from east.runtime._compiler_eastc import paged_value_stats

        for i in lazy_inputs:
            stats = paged_value_stats(getattr(inputs[i], "_east_c_paged", 0))
            if stats is None:
                continue
            segments, decoded, fences, hydrated = stats
            if hydrated:
                print(f"  input {i}: decoded whole (an operation the pager cannot serve)",
                      file=sys.stderr)
            else:
                print(f"  input {i}: {decoded} of {segments} segments decoded, {fences} fences probed",
                      file=sys.stderr)

    return result
