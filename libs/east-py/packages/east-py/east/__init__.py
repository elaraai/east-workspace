#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East.py - Python runtime for the East programming language.

Public surface for using East *values* as plain Python data: the value classes
(``EastArray``/``EastStruct``/``EastVariant``/``EastVector``/…), the type
constructors and guards, runtime validation/coercion (``coerce_to``,
``assert_value_of``, ``EastTypeError``), the ergonomic constructors
(``variant``/``some``/``none``/``match``/``struct``/``array``), and the East
ordering functions (``compare_for``/``equal_for``/``less_for``).
"""

import contextlib

__version__ = "0.1.0"

# Detect which Cython extensions are available
CYTHON_EXTENSIONS: list[str] = []
with contextlib.suppress(ImportError):
    from east.types._values_cy import CyEastStruct as _  # noqa: F401
    CYTHON_EXTENSIONS.append("values")
with contextlib.suppress(ImportError):
    from east._eastc_bridge import c_type_ptr_to_py_type as _  # noqa: F401
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

# --- public value/type surface (curated in east.types) ---
import east.types as _types  # noqa: E402
from east.kernel import KernelTraceError, greatest, kernel, least, where  # noqa: E402
from east.namespace import East  # noqa: E402
from east.runtime.errors import EastError  # noqa: E402
from east.runtime.memo import configure_memo, memoize  # noqa: E402
from east.runtime.platform import (  # noqa: E402
    GenericPlatformFunction,
    PlatformFunction,
    generic_platform_function,
    platform_function,
    platform_functions,
)
from east.types import *  # noqa: E402,F403
from east.utils.ordering import (  # noqa: E402
    TYPE_ORDER,
    compare_for,
    equal_for,
    greater_equal_for,
    greater_for,
    is_for,
    less_equal_for,
    less_for,
    make_east_key,
    not_equal_for,
)

__all__ = [
    "CYTHON_EXTENSIONS",
    *_types.__all__,
    # ordering
    "TYPE_ORDER",
    "make_east_key",
    "compare_for",
    "equal_for",
    "is_for",
    "less_for",
    "not_equal_for",
    "less_equal_for",
    "greater_equal_for",
    "greater_for",
    # scalar namespace
    "East",
    # runtime
    "EastError",
    "PlatformFunction",
    "GenericPlatformFunction",
    "platform_function",
    "generic_platform_function",
    "platform_functions",
    "memoize",
    "configure_memo",
    # kernels (IR push-down for eager methods)
    "kernel",
    "where",
    "greatest",
    "least",
    "KernelTraceError",
]
