#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East text format parser — delegates to east-c.

Provides parse_east(type, text) → value via east-c's east_parse_value.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from east.types.types import EastType


class ParseError(Exception):
    """Error during East text format parsing."""

    def __init__(self, message: str, position: int = 0, line: int = 1, column: int = 1):
        self.position = position
        self.line = line
        self.column = column
        super().__init__(f"Parse error at line {line}, column {column}: {message}")


def parse_east(target_type: EastType, text: str) -> Any:
    """Parse East text format into a value via east-c."""
    from east.serialization._east_text_eastc import _parse_value
    return _parse_value(target_type, text)
