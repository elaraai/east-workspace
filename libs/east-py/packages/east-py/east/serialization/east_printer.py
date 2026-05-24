#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East text format printer — delegates to east-c.

Provides print_east(value, type) → str and print_type(type) → str
via east-c's east_print_value and east_print_type.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from east.types.types import EastType


def print_east(value: Any, value_type: EastType) -> str:
    """Print an East value to text format via east-c."""
    from east.serialization._east_text_eastc import _print_value
    return _print_value(value_type, value)


def print_type(type_val: EastType) -> str:
    """Print an East type to text format via east-c."""
    from east.serialization._east_text_eastc import _print_type
    return _print_type(type_val)


def print_for(type_val: EastType):
    """Create a printer function for the given type."""
    def printer(value):
        return print_east(value, type_val)
    return printer


# Identifier escaping — kept in Python since it's trivial and used by types.py __repr__
_EAST_KEYWORDS = frozenset({
    "null", "true", "false", "Infinity", "NaN",
})
_IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def needs_escaping(identifier: str) -> bool:
    """Check if an identifier needs backtick escaping."""
    if not identifier:
        return True
    if identifier in _EAST_KEYWORDS:
        return True
    return not _IDENTIFIER_RE.match(identifier)


def print_identifier(identifier: str) -> str:
    """Print an identifier, escaping with backticks if needed."""
    if needs_escaping(identifier):
        escaped = identifier.replace("\\", "\\\\").replace("`", "\\`")
        return f"`{escaped}`"
    return identifier


def _find_recursive_marker(typ: EastType) -> Any | None:
    """Find the recursive marker in a type, if any.

    Returns the marker value for recursive types, or None.
    Used by parser for circular reference handling.
    """
    from east.types.types import is_recursive_type
    if is_recursive_type(typ):
        return typ.value
    return None
