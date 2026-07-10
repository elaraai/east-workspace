#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR compilation and execution — uses east-c backend directly.

All formats (JSON, BEAST2, East text) go straight from raw bytes to C
with no Python IR round-trip.
"""

import sys
from pathlib import Path
from time import perf_counter

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


def run_program(
    ir_file: Path,
    platform_fns: list[PlatformFunction],
    packages: list[str],
    input_files: list[Path],
    output_file: Path | None = None,
    verbose: bool = False,
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

    # Load inputs with type-directed parsing
    inputs = [
        load_value(file_path, param_type)
        for file_path, param_type in zip(input_files, input_types, strict=False)
    ]

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
