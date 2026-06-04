#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Console I/O platform functions for East.

Provides console output operations for East programs running in Python.
"""

import sys

from east.runtime.platform import platform_function, platform_functions
from east.types.types import NullType, StringType


@platform_function(name="console_log", inputs=[StringType], output=NullType)
def console_log_impl(message: str) -> None:
    """Write message to stdout with a newline.

    Args:
        message: Message to write to stdout
    """
    print(message, flush=True)


@platform_function(name="console_error", inputs=[StringType], output=NullType)
def console_error_impl(message: str) -> None:
    """Write message to stderr with a newline.

    Args:
        message: Message to write to stderr
    """
    print(message, file=sys.stderr, flush=True)


@platform_function(name="console_write", inputs=[StringType], output=NullType)
def console_write_impl(message: str) -> None:
    """Write message to stdout without a newline.

    Args:
        message: Message to write to stdout
    """
    sys.stdout.write(message)
    sys.stdout.flush()


# Collected from the @platform_function decorations above.
console_impl = platform_functions(__name__)


__all__ = ["console_impl"]
