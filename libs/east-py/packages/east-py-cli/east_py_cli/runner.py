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

try:
    import resource  # Unix-only (getrusage); not present on Windows
except ImportError:  # pragma: no cover - Windows has no `resource` module
    resource = None  # type: ignore[assignment]

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
# disables). A --stream input always opens lazily.
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


def _peak_rss_kb() -> float | None:
    """This process's peak resident set size in KB, or ``None`` where the
    platform cannot report it. On Linux ``ru_maxrss`` inherits the parent's
    peak across fork + exec — a runner spawned from a large host process
    reports the host's peak, not its own — so ``VmHWM`` from
    ``/proc/self/status``, which exec resets, is the source there;
    ``ru_maxrss`` elsewhere (KB on Linux, bytes on macOS)."""
    try:
        with open("/proc/self/status", encoding="ascii") as status:
            for line in status:
                if line.startswith("VmHWM:"):
                    return float(line.split()[1])
    except (OSError, ValueError, IndexError, UnicodeDecodeError):
        pass
    if resource is None:
        return None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / 1024 if sys.platform == "darwin" else float(peak)


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


class _EmitSink:
    """The ``--emit`` capability over east-c's streaming emit sink (issues
    #507, #518, #770) — the library sink the east-c CLI runs, so both runners
    write the same bytes for the same emissions.

    The compiled body calls the sink's function value once per row with no
    python in the loop: the cut, the ascending check and the folds all run
    in C, in one pass — segments stream straight to the output file, and
    memory is one open segment whatever the output's size. Set and Dict
    emissions must ascend in East order: an out-of-order key is an error,
    and so is an equal key unless the sink folds it — ``merge`` (a compiled
    ``(K, V, V) -> V``) folds an adjacent equal dict key in emission order,
    ``union`` keeps the first of adjacent equal set elements."""

    def __init__(self, kind: str, emit_param_type: object, output_file: Path,
                 merge: Callable | None = None, union: bool = False):
        from east import ArrayType, DictType, SetType
        from east.serialization._beast2_eastc import _EmitSinkCore

        # `.beast2` only, as east-c and east-node require: the sink writes a
        # beast2 stream, and the message has always said so.
        if Path(output_file).suffix.lower() != ".beast2":
            raise ValueError("--emit requires a .beast2 output file (-o)")
        if getattr(emit_param_type, "type", None) not in ("Function", "AsyncFunction"):
            raise ValueError(
                "--emit requires the function's trailing parameter to be the emit "
                "capability (a function type)"
            )
        ins = emit_param_type.value["inputs"]  # type: ignore[attr-defined]
        expected = 2 if kind == "dict" else 1
        if len(ins) != expected:
            raise ValueError(
                f"--emit {kind} expects an emit parameter taking {expected} "
                f"argument(s), got {len(ins)}"
            )
        self.kind = kind
        self.emit_types = list(ins)
        self.output_file = Path(output_file)
        self.out_type: Any = (
            DictType(ins[0], ins[1]) if kind == "dict"
            else SetType(ins[0]) if kind == "set"
            else ArrayType(ins[0])
        )
        self._core = _EmitSinkCore(
            {"array": 0, "set": 1, "dict": 2}[kind], self.emit_types, self.output_file, merge,
            union)

    def function_value(self) -> Callable:
        """The emit capability as a native East function value: every row runs
        the sink's C entry.

        Passed to a compiled body it rides the FunctionType parameter as the
        value itself (the runner's path — no python in the loop). It is also
        callable, so a harness driving a ``@platform_function`` straight from
        python can hand it over as the emit capability and a pure callback
        still pushes down (issue #592)."""
        return self._core.function_value()

    def emit(self, *args: object) -> None:
        """Python-boundary emission — the same C entry the compiled body
        calls, one marshalled row at a time."""
        self._core.emit(*args)

    def finish(self) -> None:
        """Finalize the output: the held entry, the terminator and the
        index. Raises EastError with the sink's message and leaves the output
        unfinalized."""
        self._core.finish()

    def stats(self) -> dict[str, Any]:
        """The sink's counter (see ``_EmitSinkCore.stats``)."""
        return self._core.stats()


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


def print_result(timings: dict[str, float], peak_bytes: int | None) -> None:
    """Print a unit's result as ``-v`` shows it: where the time went, in
    milliseconds, and the process's peak memory where the platform reports
    it (Windows has no ``resource`` module and no /proc)."""
    print("\nTiming:", file=sys.stderr)
    print(f"  Load:     {timings['load']:8.1f} ms", file=sys.stderr)
    print(f"  Compile:  {timings['compile']:8.1f} ms", file=sys.stderr)
    print(f"  Execute:  {timings['execute']:8.1f} ms", file=sys.stderr)
    print(f"  Output:   {timings['output']:8.1f} ms", file=sys.stderr)
    print(f"  Total:    {sum(timings.values()):8.1f} ms", file=sys.stderr)
    if peak_bytes is not None:
        print("\nMemory:", file=sys.stderr)
        if peak_bytes >= 1024 * 1024:
            print(f"  Peak RSS: {peak_bytes / (1024 * 1024):8.1f} MB", file=sys.stderr)
        else:
            print(f"  Peak RSS: {peak_bytes / 1024:8.0f} KB", file=sys.stderr)


def _peak_bytes() -> int | None:
    """This process's peak resident memory in bytes, or ``None`` where the
    platform cannot report it."""
    peak_kb = _peak_rss_kb()
    return int(peak_kb * 1024) if peak_kb is not None else None


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
    from east.serialization._beast2_eastc import _read_unit, _set_thread_limit, _write_unit_result

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
                       result["peak_bytes"] or 0, timings)
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
    emit: str | None = None,
    stream_inputs: Sequence[int] = (),
    merge: Path | None = None,
    union: bool = False,
) -> object:
    """Run an East IR program.

    With ``emit`` the function's trailing parameter is the emit capability
    and the streaming sink writes ``output_file``; ``merge`` names an IR file
    holding a ``(K, V, V) -> V`` function, compiled with the run's platforms,
    that folds equal dict keys, and ``union`` collapses equal set elements.
    Every input index in ``stream_inputs`` opens lazily.
    """
    t0 = perf_counter()

    # Compile directly from raw data — no Python IR round-trip, single file read
    compiled, is_async = _compile_ir_file(ir_file, platform_fns)

    t1 = perf_counter()

    handle = compiled._eastc_handle  # type: ignore[attr-defined]
    input_types = handle.get_input_types()
    output_type = handle.get_output_type()

    # With --emit the body takes one trailing runner-provided parameter (the
    # emit capability) beyond the input files; the output file is written
    # incrementally by the sink instead of from the return value.
    file_params = len(input_types) - 1 if emit is not None and input_types else len(input_types)

    # Validate input count
    if len(input_files) != file_params:
        sig_params = ", ".join(print_type(t) for t in input_types)
        raise ValueError(
            f"Function expects {file_params} inputs, got {len(input_files)}\n"
            f"Signature: ({sig_params}) -> {print_type(output_type)}"
        )
    for index in stream_inputs:
        if not 0 <= index < file_params:
            # east-node / east-c parity: `--stream 0` on a zero-input program
            # is an error, not a silent no-op.
            raise ValueError(f"--stream index {index} out of range ({file_params} inputs)")

    sink = None
    if emit is not None:
        if output_file is None:
            raise ValueError("--emit requires a .beast2 output file (-o)")
        # The --merge function compiles with the run's platforms, exactly like
        # the main IR; the sink borrows its native function.
        merge_fn = _compile_ir_file(Path(merge), platform_fns)[0] if merge is not None else None
        # A zero-parameter function has no trailing parameter to be the emit
        # capability — the shaped error, not an IndexError.
        sink = _EmitSink(emit, input_types[-1] if input_types else None, output_file,
                         merge=merge_fn, union=union)

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

    # A streamed input always opens lazily; other indexed beast2 collection
    # inputs open lazily at or above the size threshold.
    threshold = _lazy_input_threshold()
    inputs, lazy_inputs = _open_inputs(
        handle, input_files,
        lambda i, size: i in stream_inputs or (threshold > 0 and size >= threshold), verbose)

    # The emit capability rides the trailing FunctionType parameter as a
    # native East function value: the compiled body's per-row calls run the
    # east-c sink directly, with no python in the loop.
    if sink is not None:
        inputs.append(sink.function_value())

    t2 = perf_counter()

    # Execute via east-c
    from east.runtime._compiler_eastc import _eastc_call

    result = _eastc_call(handle._compiled, handle._input_types, handle._output_type, tuple(inputs))

    t3 = perf_counter()

    # Output
    if sink is not None:
        # The sink wrote the output incrementally; the (Null) return value is
        # unused. Finishing writes the held entry, the terminator, index and
        # footer.
        sink.finish()
        if verbose:
            print(
                f"Output: {sink.output_file}  ({_format_file_size(sink.output_file)})",
                file=sys.stderr,
            )
            print(f"  {print_type(sink.out_type)}", file=sys.stderr)
    elif output_file is not None:
        save_value(output_file, result, output_type)
        if verbose:
            print(f"Output: {output_file}  ({_format_file_size(output_file)})", file=sys.stderr)
            print(f"  {print_type(output_type)}", file=sys.stderr)
    else:
        print(print_east(result, output_type))

    t4 = perf_counter()

    if verbose:
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


def merge_blobs(
    input_files: Sequence[Path],
    platform_fns: list[PlatformFunction],
    output_file: Path,
    verbose: bool = False,
    merge: Path | None = None,
    union: bool = False,
    range: Path | None = None,  # noqa: A002 - the CLI flag's name
) -> dict[str, int]:
    """Merge sorted Set or Dict blobs of one type into one — ``east-py merge``
    (issue #770), east-c's blob merge behind ``east-c merge`` too, so the two
    runners write the same bytes.

    One pass over the inputs, read segment by segment through a mapping — an
    input may be a manifest directory, read through its segment files; the
    output is what ``run --emit`` writes for the same entries emitted
    ascending. Equal keys fold in input order: ``merge`` names an IR file
    holding a ``(K, V, V) -> V`` function, compiled with the run's platforms,
    that folds equal Dict keys; ``union`` keeps the first of equal Set
    elements; without a fold an equal key is an error. ``range`` names a
    beast2 blob of ``Struct{from: Option<K>, to: Option<K>}`` over the inputs'
    key type: only the keys in ``[from, to)`` merge, an absent bound open.
    The output is written wherever ``output_file`` points, whatever its name,
    exactly as east-c and east-node write it.
    Returns the account ``{"inputs", "entries", "folds"}``; raises ValueError
    with the merge's message and leaves the output unfinalised.
    """
    from east.serialization._beast2_eastc import _merge_blobs

    t0 = perf_counter()
    # No precondition on the output path's name: the merge IS east-c's, and
    # east-c and east-node write the blob wherever `-o` points. A python-side
    # rule here would refuse a command the other two runners accept.
    # The fold compiles with the run's platforms, exactly like a program; the
    # merge checks its signature against the inputs' key and value types.
    merge_fn = _compile_ir_file(Path(merge), platform_fns)[0] if merge is not None else None
    stats = _merge_blobs(
        [Path(p) for p in input_files], Path(output_file), merge_fn, union,
        Path(range) if range is not None else None,
    )
    t1 = perf_counter()
    if verbose:
        print(
            f"merge: {stats['inputs']} input(s), {stats['entries']} entries, "
            f"{stats['folds']} fold(s)",
            file=sys.stderr,
        )
        print(f"Output: {output_file}  ({_format_file_size(output_file)})", file=sys.stderr)
        print("\nTiming:", file=sys.stderr)
        print(f"  Total:    {(t1 - t0) * 1000:8.1f} ms", file=sys.stderr)
    return stats
