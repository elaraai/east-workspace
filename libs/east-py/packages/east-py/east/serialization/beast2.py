#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Beast v2 binary format for East types.

All encode/decode is handled by east-c via the _beast2_eastc Cython extension.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from east.runtime.platform import PlatformFunction

# Beast v2 magic bytes: 0x89 "East" CRLF 0x01
BEAST2_MAGIC_BYTES = bytes([137, 69, 97, 115, 116, 13, 10, 1])


class Beast2DecodeOptions(TypedDict, total=False):
    """Options for decoding, allowing function compilation.

    Attributes:
        platform: List of platform functions available for function compilation
    """

    platform: list[PlatformFunction]


from east.serialization._beast2_eastc import (  # type: ignore[import-not-found]  # noqa: E402
    decode_beast2_for,
    decode_beast2_with_header_for,
    encode_beast2_for,
    encode_beast2_with_header_for,
)

__all__ = [
    "Beast2DecodeOptions",
    "encode_beast2_for",
    "decode_beast2_for",
    "encode_beast2_with_header_for",
    "decode_beast2_with_header_for",
    "BEAST2_MAGIC_BYTES",
]
