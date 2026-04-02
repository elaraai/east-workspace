#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""JSON serialization for East types.

All encode/decode is handled by east-c via the _json_eastc Cython extension.
"""

from east.serialization._json_eastc import (  # type: ignore[import-not-found]
    JSONDecodeError,
    decode_json_for,
    decode_json_pointer_component,
    decode_relative_ref,
    encode_json_for,
    encode_json_pointer_component,
    encode_relative_ref,
    from_json_for,
    to_json_for,
)

__all__ = [
    "JSONDecodeError",
    "to_json_for",
    "from_json_for",
    "encode_json_for",
    "decode_json_for",
    "encode_json_pointer_component",
    "decode_json_pointer_component",
    "encode_relative_ref",
    "decode_relative_ref",
]
