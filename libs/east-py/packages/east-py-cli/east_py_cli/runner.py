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
from pathlib import Path
from time import perf_counter
from typing import Any

try:
    import resource  # Unix-only (getrusage); not present on Windows
except ImportError:  # pragma: no cover - Windows has no `resource` module
    resource = None  # type: ignore[assignment]

from east.runtime.compiler import compile_from_beast2, compile_from_east, compile_from_json
from east.runtime.platform import PlatformFunction
from east.serialization.east_printer import print_east, print_type

from east_py_cli.loader import detect_format, load_value, save_value


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


# One flush per this many emitted elements; the managed file writer
# re-batches toward its own byte-sized segments underneath.
_EMIT_BATCH = 1000

# east-node parity: indexed beast2 collection inputs at or above this many
# bytes open as lazy paged values (EAST_LAZY_INPUT_BYTES overrides; 0
# disables). The --stream input always opens lazily.
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


class _EmitSink:
    """The ``--emit`` capability: a Python callable passed as the body's
    trailing FunctionType parameter, appending elements (pairs for dict
    outputs) through the managed streaming beast2 writer — O(batch) memory
    end to end. Set/Dict emission must be strictly ascending in East (key)
    order; the check runs per call so a violation names the offending emit
    and a duplicate key can never collapse silently inside a batch."""

    def __init__(self, kind: str, emit_param_type: object, output_file: Path):
        from east import ArrayType, DictType, SetType, compare_for
        from east.serialization.beast2 import open_beast2_file

        if Path(output_file).suffix.lower() not in (".beast2", ".beast"):
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
        self._cmp = None if kind == "array" else compare_for(ins[0])
        self._last_key: object = None
        self._has_last = False
        self._batch: list = []
        self._writer = open_beast2_file(output_file, self.out_type, mode="w")

    def emit(self, *args: object) -> None:
        if self._cmp is not None:
            key = args[0]
            if self._has_last and self._cmp(self._last_key, key) >= 0:
                noun = ("Dict", "key") if self.kind == "dict" else ("Set", "element")
                raise ValueError(
                    f"beast2 v5: {noun[0]} stream batches must be strictly ascending in "
                    f"East {noun[1]} order — segment content is the canonical value; "
                    f"emit in ascending {noun[1]} order, or emit arrival order as an Array"
                )
            self._last_key = key
            self._has_last = True
        self._batch.append((args[0], args[1]) if self.kind == "dict" else args[0])
        if len(self._batch) >= _EMIT_BATCH:
            self._flush()

    def _flush(self) -> None:
        if not self._batch:
            return
        if self.kind == "dict":
            self._writer.write(dict(self._batch))
        elif self.kind == "set":
            self._writer.write(set(self._batch))
        else:
            self._writer.write(list(self._batch))
        self._batch = []

    def finish(self) -> None:
        self._flush()
        self._writer.close()


def run_program(
    ir_file: Path,
    platform_fns: list[PlatformFunction],
    packages: list[str],
    input_files: list[Path],
    output_file: Path | None = None,
    verbose: bool = False,
    emit: str | None = None,
    stream_input: int | None = None,
) -> object:
    """Run an East IR program."""
    fmt = detect_format(ir_file)
    is_async = False

    t0 = perf_counter()

    # Compile directly from raw data — no Python IR round-trip, single file read
    if fmt == "json":
        data = ir_file.read_bytes()
        is_async = b'"AsyncFunction"' in data[:200]
        compiled = compile_from_json(data, platform_fns, is_async)
    elif fmt == "beast2":
        data = ir_file.read_bytes()
        compiled = compile_from_beast2(data, platform_fns, is_async)
    elif fmt == "east":
        text = ir_file.read_text(encoding="utf-8")
        is_async = "AsyncFunction" in text[:200]
        compiled = compile_from_east(text, platform_fns, is_async)
    else:
        raise ValueError(f"Unknown IR format: {fmt}")

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
    if stream_input is not None and not 0 <= stream_input < max(file_params, 1):
        raise ValueError(f"--stream index {stream_input} out of range ({file_params} inputs)")

    sink = None
    if emit is not None:
        if output_file is None:
            raise ValueError("--emit requires an output file (-o)")
        sink = _EmitSink(emit, input_types[-1], output_file)

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

    # Load inputs with type-directed parsing. The streamed input always opens
    # as a lazy paged value (segment-fed iteration + keyed reads at O(segment)
    # decoded memory — #505); other indexed beast2 collection inputs open
    # lazily at or above the size threshold. Anything not pageable falls back
    # to the whole decode, exactly like east-node's runner.
    from east.runtime._compiler_eastc import open_paged_value

    threshold = _lazy_input_threshold()
    inputs = []
    for i, (file_path, param_type) in enumerate(zip(input_files, input_types, strict=False)):
        lazy = None
        want_lazy = i == stream_input or (
            threshold > 0 and Path(file_path).stat().st_size >= threshold
        )
        if (
            want_lazy
            and Path(file_path).suffix.lower() in (".beast2", ".beast")
            and getattr(param_type, "type", None) in ("Array", "Set", "Dict")
        ):
            lazy = open_paged_value(handle._input_types[i], Path(file_path).read_bytes())
        inputs.append(lazy if lazy is not None else load_value(file_path, param_type))

    # The emit capability rides the trailing FunctionType parameter as a
    # foreign function value backed by the sink's Python callable.
    if sink is not None:
        from east import EastFunction, NullType
        from east.runtime._compiler_eastc import foreign_function_value

        inputs.append(foreign_function_value(EastFunction(sink.emit, sink.emit_types, NullType)))

    t2 = perf_counter()

    # Execute via east-c
    from east.runtime._compiler_eastc import _eastc_call

    result = _eastc_call(handle._compiled, handle._input_types, handle._output_type, tuple(inputs))

    t3 = perf_counter()

    # Output
    if sink is not None:
        # The sink wrote the output incrementally; the (Null) return value is
        # unused. Closing writes the terminator, index and footer.
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
        print("\nTiming:", file=sys.stderr)
        print(f"  Load:     {(t1 - t0) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Compile:  {(t2 - t1) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Execute:  {(t3 - t2) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Output:   {(t4 - t3) * 1000:8.1f} ms", file=sys.stderr)
        print(f"  Total:    {(t4 - t0) * 1000:8.1f} ms", file=sys.stderr)

        # ru_maxrss is in KB on Linux, bytes on macOS. resource is Unix-only
        # (absent on Windows), so peak-RSS reporting is skipped there.
        if resource is not None:
            peak_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            if sys.platform == "darwin":
                peak_kb = peak_kb / 1024
            print("\nMemory:", file=sys.stderr)
            if peak_kb >= 1024:
                print(f"  Peak RSS: {peak_kb / 1024:8.1f} MB", file=sys.stderr)
            else:
                print(f"  Peak RSS: {peak_kb:8.0f} KB", file=sys.stderr)

    return result
