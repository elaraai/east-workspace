#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East.py - Python runtime for the East programming language."""

import contextlib

__version__ = "0.1.0"

# Detect which Cython extensions are available
CYTHON_EXTENSIONS: list[str] = []
with contextlib.suppress(ImportError):
    from east.types._values_cy import CyEastStruct as _  # noqa: F401
    CYTHON_EXTENSIONS.append("values")
with contextlib.suppress(ImportError):
    from east._eastc_bridge import py_type_to_c as _  # noqa: F401
    CYTHON_EXTENSIONS.append("eastc_bridge")
with contextlib.suppress(ImportError):
    from east._platform_bridge import clear_platform_state as _  # noqa: F401
    CYTHON_EXTENSIONS.append("platform_bridge")
with contextlib.suppress(ImportError):
    from east.runtime._compiler_eastc import compile_eastc_from_json as _  # noqa: F401
    CYTHON_EXTENSIONS.append("compiler_eastc")
with contextlib.suppress(ImportError):
    from east.serialization._beast2_eastc import encode_beast2_for as _  # noqa: F401
    CYTHON_EXTENSIONS.append("beast2_eastc")
with contextlib.suppress(ImportError):
    from east.serialization._json_eastc import encode_json_for as _  # noqa: F401
    CYTHON_EXTENSIONS.append("json_eastc")
with contextlib.suppress(ImportError):
    from east.serialization._csv_eastc import encode_csv_for as _  # noqa: F401
    CYTHON_EXTENSIONS.append("csv_eastc")
with contextlib.suppress(ImportError):
    from east.utils._ordering_cy import cy_make_east_key as _  # noqa: F401
    CYTHON_EXTENSIONS.append("ordering")

__all__: list[str] = ["CYTHON_EXTENSIONS"]
