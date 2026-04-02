#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR compilation and execution — uses east-c backend directly.

All formats (JSON, BEAST2, East text) go straight from raw bytes to C
with no Python IR round-trip.
"""

from pathlib import Path

from east.runtime.compiler import compile_from_beast2, compile_from_east, compile_from_json
from east.runtime.platform import PlatformFunction
from east.serialization.east_printer import print_east, print_type

from east_py_cli.loader import detect_format, load_value, save_value


def run_program(
    ir_file: Path,
    platform_fns: list[PlatformFunction],
    input_files: list[Path],
    output_file: Path | None = None,
    verbose: bool = False,
) -> object:
    """Run an East IR program."""
    fmt = detect_format(ir_file)
    is_async = False

    if verbose:
        print(f"Compiling {ir_file} ({fmt})")
        print(f"  {len(platform_fns)} platform functions")

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

    handle = compiled._eastc_handle
    input_types = handle.get_input_types()
    output_type = handle.get_output_type()

    # Validate input count
    if len(input_files) != len(input_types):
        sig_params = ", ".join(print_type(t) for t in input_types)
        raise ValueError(
            f"Function expects {len(input_types)} inputs, got {len(input_files)}\n"
            f"Signature: ({sig_params}) -> {print_type(output_type)}"
        )

    # Load inputs with type-directed parsing
    inputs = []
    for i, (file_path, param_type) in enumerate(zip(input_files, input_types, strict=False)):
        if verbose:
            print(f"  Input {i}: {file_path} as {print_type(param_type)}")
        inputs.append(load_value(file_path, param_type))

    # Execute via east-c
    if verbose:
        print("Executing...")

    from east.runtime._compiler_eastc import _eastc_call
    result = _eastc_call(handle._compiled, handle._input_types, handle._output_type, tuple(inputs))

    # Output
    if output_file is not None:
        if verbose:
            print(f"Saving output to {output_file}")
        save_value(output_file, result, output_type)
    else:
        print(print_east(result, output_type))

    return result
