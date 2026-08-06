#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR and value loading utilities."""

import importlib
from pathlib import Path
from typing import Any

from east.runtime.platform import PlatformFunction
from east.types.type_of_type import IRType
from east.types.types import EastType


def detect_format(file_path: Path) -> str:
    """Detect file format from extension.

    Args:
        file_path: Path to the file

    Returns:
        Format string: 'beast2', 'east', or 'json'

    Raises:
        ValueError: If extension is not recognized
    """
    ext = file_path.suffix.lower()
    if ext in (".beast2", ".beast"):
        return "beast2"
    elif ext == ".east":
        return "east"
    elif ext == ".json":
        return "json"
    else:
        raise ValueError(
            f"Unknown file extension: {ext}. " f"Supported: .beast2, .beast, .east, .json"
        )


def load_ir(file_path: Path) -> Any:
    """Load IR from a file.

    Auto-detects format from file extension.

    Args:
        file_path: Path to IR file

    Returns:
        Parsed IR value

    Raises:
        ValueError: If format is not recognized or parsing fails
    """
    fmt = detect_format(file_path)

    if fmt == "beast2":
        from east.serialization.beast2 import decode_beast2_with_header_for

        with open(file_path, "rb") as f:
            data = f.read()
        decoder = decode_beast2_with_header_for(IRType)
        return decoder(data)

    elif fmt == "east":
        from east.serialization.east_parser import parse_east

        with open(file_path, encoding="utf-8") as f:
            text = f.read()
        return parse_east(IRType, text)

    elif fmt == "json":
        from east.serialization.json import decode_json_for
        from east.types.types import ArrayType, IntegerType, StringType, StructType

        with open(file_path, "rb") as f:
            data = f.read()

        # Try wrapper format first: {ir, source_map} (exported by TS test suite)
        LocationType = StructType([("column", IntegerType), ("filename", StringType), ("line", IntegerType)])  # noqa: N806
        SourceMapType = StructType([("stacks", ArrayType(ArrayType(LocationType)))])  # noqa: N806
        WrapperType = StructType([("ir", IRType), ("source_map", SourceMapType)])  # noqa: N806
        try:
            wrapper = decode_json_for(WrapperType)(data)
            return wrapper.ir
        except Exception:
            pass

        # Fallback: raw IR type (legacy format)
        return decode_json_for(IRType)(data)

    else:
        raise ValueError(f"Unknown format: {fmt}")


def load_value(file_path: Path, value_type: EastType) -> Any:
    """Load a value from a file with type-directed parsing.

    Args:
        file_path: Path to data file
        value_type: Expected East type for parsing

    Returns:
        Parsed value

    Raises:
        ValueError: If format is not recognized or parsing fails
    """
    fmt = detect_format(file_path)

    if fmt == "beast2":
        from east.serialization.beast2 import decode_beast2_with_header_for

        with open(file_path, "rb") as f:
            data = f.read()
        decoder = decode_beast2_with_header_for(value_type)
        return decoder(data)

    elif fmt == "east":
        from east.serialization.east_parser import parse_east

        with open(file_path, encoding="utf-8") as f:
            text = f.read()
        return parse_east(value_type, text)

    elif fmt == "json":
        from east.serialization.json import decode_json_for

        with open(file_path, "rb") as f:
            data = f.read()
        decoder = decode_json_for(value_type)
        return decoder(data)

    else:
        raise ValueError(f"Unknown format: {fmt}")


def save_value(file_path: Path, value: Any, value_type: EastType) -> None:
    """Save a value to a file with type-directed serialization.

    Args:
        file_path: Path to write to
        value: Value to serialize
        value_type: East type for serialization

    Raises:
        ValueError: If format is not recognized
    """
    fmt = detect_format(file_path)

    if fmt == "beast2":
        # Collection-rooted outputs are ALWAYS written segmented + indexed
        # (byte-adaptive segments) so e3's paged dataset reads can seek —
        # one uniform encoding per logical value, at every size.
        if getattr(value_type, "type", None) in ("Array", "Set", "Dict"):
            from east.serialization.beast2 import encode_beast2_paged_for

            data = encode_beast2_paged_for(value_type)(value)
        else:
            from east.serialization.beast2 import encode_beast2_with_header_for

            data = encode_beast2_with_header_for(value_type)(value)
        with open(file_path, "wb") as f:
            f.write(data)

    elif fmt == "east":
        from east.serialization.east_printer import print_east

        text = print_east(value, value_type)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(text)

    elif fmt == "json":
        from east.serialization.json import encode_json_for

        encoder = encode_json_for(value_type)
        data = encoder(value)
        with open(file_path, "wb") as f:
            f.write(data)

    else:
        raise ValueError(f"Unknown format: {fmt}")


def _get_attr(fn: Any, attr: str) -> Any:
    """Get attribute from object or dict."""
    if isinstance(fn, dict):
        return fn.get(attr)
    return getattr(fn, attr, None)


def _has_attr(fn: Any, attr: str) -> bool:
    """Check if object or dict has attribute."""
    if isinstance(fn, dict):
        return attr in fn
    return hasattr(fn, attr)


def _validate_platform_function(fn: Any, package_name: str, index: int) -> None:
    """Validate that an object has the required PlatformFunction shape.

    Supports both regular PlatformFunction (with inputs/output) and
    GenericPlatformFunction (with type_parameters, no inputs/output since
    types are computed dynamically from type parameters at call time).

    Args:
        fn: Object to validate (dict or object)
        package_name: Package name for error messages
        index: Index in the platform list for error messages

    Raises:
        ValueError: If the object is not a valid PlatformFunction
    """
    # Check if this is a generic platform function
    is_generic = _has_attr(fn, "type_parameters")

    if is_generic:
        # GenericPlatformFunction: inputs/output computed from type_parameters at runtime
        required_attrs = ["name", "type_parameters", "type", "fn"]
    else:
        # Regular PlatformFunction: has static inputs/output
        required_attrs = ["name", "inputs", "output", "type", "fn"]

    for attr in required_attrs:
        if not _has_attr(fn, attr):
            raise ValueError(
                f"Invalid PlatformFunction at index {index} in '{package_name}': "
                f"missing required attribute '{attr}'"
            )

    name = _get_attr(fn, "name")
    if not isinstance(name, str):
        raise ValueError(
            f"Invalid PlatformFunction at index {index} in '{package_name}': "
            f"'name' must be a string, got {type(name).__name__}"
        )

    if is_generic:
        type_parameters = _get_attr(fn, "type_parameters")
        if not isinstance(type_parameters, list | tuple):
            raise ValueError(
                f"Invalid GenericPlatformFunction '{name}' in '{package_name}': "
                f"'type_parameters' must be a list, got {type(type_parameters).__name__}"
            )
    else:
        inputs = _get_attr(fn, "inputs")
        if not isinstance(inputs, list | tuple):
            raise ValueError(
                f"Invalid PlatformFunction '{name}' in '{package_name}': "
                f"'inputs' must be a list, got {type(inputs).__name__}"
            )

    fn_type = _get_attr(fn, "type")
    if fn_type not in ("sync", "async"):
        raise ValueError(
            f"Invalid PlatformFunction '{name}' in '{package_name}': "
            f"'type' must be 'sync' or 'async', got '{fn_type}'"
        )

    fn_impl = _get_attr(fn, "fn")
    has_c_impl = _has_attr(fn, "c_callback") or _has_attr(fn, "c_factory")
    if not callable(fn_impl) and not has_c_impl:
        raise ValueError(
            f"Invalid PlatformFunction '{name}' in '{package_name}': " f"'fn' must be callable"
        )


def load_platform(package_name: str) -> list[PlatformFunction]:
    """Load platform functions from a platform package.

    Platform packages must export a 'platform' attribute from their __init__.py
    that is a list of PlatformFunction objects.

    Args:
        package_name: Package name (e.g., 'east-py-std')

    Returns:
        List of validated platform functions

    Raises:
        ImportError: If package is not installed
        ValueError: If package doesn't export 'platform' or has invalid functions
    """
    # Convert package name to module name (east-py-std -> east_py_std)
    module_name = package_name.replace("-", "_")

    try:
        mod = importlib.import_module(module_name)
    except ImportError as e:
        raise ImportError(
            f"Platform package '{package_name}' not found.\n"
            f"Install it with: uv add {package_name}"
        ) from e

    # Check for 'platform' attribute
    if not hasattr(mod, "platform"):
        raise ValueError(
            f"Platform package '{package_name}' has no 'platform' export.\n"
            f"The package must export a 'platform' attribute that is a list of PlatformFunction objects."
        )

    platform_fns = mod.platform

    # Validate it's a list
    if not isinstance(platform_fns, list):
        raise ValueError(
            f"'{package_name}.platform' must be a list, got {type(platform_fns).__name__}"
        )

    # Validate each platform function
    for i, fn in enumerate(platform_fns):
        _validate_platform_function(fn, package_name, i)

    return platform_fns


def get_platform_version(package_name: str) -> str:
    """Get version string from a platform package.

    Args:
        package_name: Package name (e.g., 'east-py-std')

    Returns:
        Version string or 'unknown' if not found
    """
    module_name = package_name.replace("-", "_")

    try:
        mod = importlib.import_module(module_name)
        return getattr(mod, "__version__", "unknown")
    except ImportError:
        return "not installed"
