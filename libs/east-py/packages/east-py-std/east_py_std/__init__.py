#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East Python Standard Platform Functions.

Python implementation of standard platform functions for the East programming language.
Provides equivalents to east-node platform functions for Python environments.
"""

from east_py_std.console import console_impl
from east_py_std.crypto import crypto_impl
from east_py_std.fetch import (
    fetch_impl,
    fetch_method_type,
    fetch_request_config_type,
    fetch_response_type,
)
from east_py_std.fs import fs_impl
from east_py_std.parallel import parallel_impl
from east_py_std.path import path_impl
from east_py_std.random import random_impl
from east_py_std.test import test_impl
from east_py_std.time import time_impl

__version__ = "0.1.0"

# Complete Python standard platform implementation
# Pass this list to compile_async() to enable all platform functions
platform = [
    *console_impl,
    *crypto_impl,
    *fetch_impl,
    *fs_impl,
    *parallel_impl,
    *path_impl,
    *random_impl,
    *test_impl,
    *time_impl,
]

__all__ = [
    "__version__",
    "platform",
    # Individual module exports
    "console_impl",
    "crypto_impl",
    "fetch_impl",
    "fs_impl",
    "parallel_impl",
    "path_impl",
    "random_impl",
    "test_impl",
    "time_impl",
    # Type exports
    "fetch_method_type",
    "fetch_request_config_type",
    "fetch_response_type",
]
