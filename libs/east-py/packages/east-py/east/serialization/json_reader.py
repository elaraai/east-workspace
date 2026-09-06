#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The strict streaming JSON reader for East types.

All reading is handled by east-c via the ``_json_reader_eastc`` Cython
extension, so the depth bound, the accepted lexical forms, surrogate-pair
joining and the error text are shared with the other runtimes rather than
reimplemented here.
"""

from east.serialization._json_reader_eastc import (  # type: ignore[import-untyped]
    JsonReader,
    JsonReadError,
)

__all__ = [
    "JsonReadError",
    "JsonReader",
]
