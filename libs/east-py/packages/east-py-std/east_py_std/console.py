#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Console I/O platform functions for East.

Provides console output operations for East programs running in Python.
"""

import sys

from east.runtime.platform import PlatformFunction
from east.types.types import NullType, StringType


def console_log_impl(message: str) -> None:
    """Write message to stdout with a newline.

    Args:
        message: Message to write to stdout
    """
    print(message, flush=True)


def console_error_impl(message: str) -> None:
    """Write message to stderr with a newline.

    Args:
        message: Message to write to stderr
    """
    print(message, file=sys.stderr, flush=True)


def console_write_impl(message: str) -> None:
    """Write message to stdout without a newline.

    Args:
        message: Message to write to stdout
    """
    sys.stdout.write(message)
    sys.stdout.flush()


# Platform function implementations
console_impl = [
    PlatformFunction(
        name="console_log",
        inputs=[StringType],
        output=NullType,
        type="sync",
        fn=console_log_impl,
    ),
    PlatformFunction(
        name="console_error",
        inputs=[StringType],
        output=NullType,
        type="sync",
        fn=console_error_impl,
    ),
    PlatformFunction(
        name="console_write",
        inputs=[StringType],
        output=NullType,
        type="sync",
        fn=console_write_impl,
    ),
]


__all__ = ["console_impl"]
