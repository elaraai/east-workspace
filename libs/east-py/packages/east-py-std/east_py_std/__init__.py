#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East Python Standard Platform Functions.

Python implementation of standard platform functions for the East programming
language. Provides equivalents to east-node platform functions for Python
environments.

Every platform function is exported under its own name (``fs_read_file``,
``fetch_get``, …): a plain Python callable taking and returning East values,
callable from a project's own ``@East.platform_function``, and — the same
object — callable inside an ``East.function`` body, where the call is the
``Platform`` node with the function's declared signature (#667). The
``platform`` list collects every registered function for ``East.compile(fn,
platform=…)`` and the runners.
"""

from east_py_std.console import (
    console_error,
    console_impl,
    console_log,
    console_write,
)
from east_py_std.crypto import (
    crypto_hash_sha256,
    crypto_hash_sha256_bytes,
    crypto_impl,
    crypto_random_bytes,
    crypto_uuid,
)
from east_py_std.env import (
    env_get,
    env_impl,
)
from east_py_std.fetch import (
    FetchMethodType,
    FetchRequestConfigType,
    FetchResponseType,
    fetch_get,
    fetch_get_bytes,
    fetch_impl,
    fetch_post,
    fetch_request,
)
from east_py_std.fs import (
    fs_append_file,
    fs_create_directory,
    fs_delete_file,
    fs_exists,
    fs_impl,
    fs_is_directory,
    fs_is_file,
    fs_open_beast,
    fs_read_directory,
    fs_read_file,
    fs_read_file_bytes,
    fs_write_file,
    fs_write_file_bytes,
)
from east_py_std.json import (
    json_close,
    json_impl,
    json_more,
    json_next,
    json_open,
    json_open_text,
    json_value,
)
from east_py_std.path import (
    path_basename,
    path_dirname,
    path_extname,
    path_impl,
    path_join,
    path_resolve,
)
from east_py_std.random import (
    random_bates,
    random_bernoulli,
    random_binomial,
    random_exponential,
    random_geometric,
    random_impl,
    random_irwin_hall,
    random_log_normal,
    random_normal,
    random_pareto,
    random_poisson,
    random_range,
    random_seed,
    random_uniform,
    random_weibull,
)
from east_py_std.test import (
    describe,
    failed,
    passed,
    reset_counters,
    test_fail,
    test_impl,
    test_impl_fn,
    test_pass,
)
from east_py_std.time import (
    time_get_timezone_offset,
    time_impl,
    time_now,
    time_sleep,
)

__version__ = "0.1.0"

# Complete Python standard platform implementation.
# Pass this list to compile_async() to enable all platform functions.
platform = [
    *console_impl,
    *crypto_impl,
    *env_impl,
    *fetch_impl,
    *fs_impl,
    *json_impl,
    *path_impl,
    *random_impl,
    *test_impl,
    *time_impl,
]

__all__ = [
    "__version__",
    "platform",
    # ---------- registration lists ----------
    "console_impl",
    "crypto_impl",
    "env_impl",
    "fetch_impl",
    "fs_impl",
    "json_impl",
    "path_impl",
    "random_impl",
    "test_impl",
    "time_impl",
    # ---------- console ----------
    "console_log",
    "console_error",
    "console_write",
    # ---------- crypto ----------
    "crypto_random_bytes",
    "crypto_hash_sha256",
    "crypto_hash_sha256_bytes",
    "crypto_uuid",
    # ---------- env ----------
    "env_get",
    # ---------- fetch ----------
    "fetch_get",
    "fetch_get_bytes",
    "fetch_post",
    "fetch_request",
    # ---------- fs ----------
    "fs_read_file",
    "fs_write_file",
    "fs_append_file",
    "fs_delete_file",
    "fs_exists",
    "fs_is_file",
    "fs_is_directory",
    "fs_create_directory",
    "fs_read_directory",
    "fs_read_file_bytes",
    "fs_write_file_bytes",
    "fs_open_beast",
    # ---------- json ----------
    "json_open",
    "json_open_text",
    "json_more",
    "json_next",
    "json_value",
    "json_close",
    # ---------- path ----------
    "path_join",
    "path_resolve",
    "path_dirname",
    "path_basename",
    "path_extname",
    # ---------- random ----------
    "random_uniform",
    "random_normal",
    "random_range",
    "random_exponential",
    "random_weibull",
    "random_bernoulli",
    "random_binomial",
    "random_geometric",
    "random_poisson",
    "random_pareto",
    "random_log_normal",
    "random_irwin_hall",
    "random_bates",
    "random_seed",
    # ---------- test ----------
    "test_pass",
    "test_fail",
    "test_impl_fn",
    "describe",
    "passed",
    "failed",
    "reset_counters",
    # ---------- time ----------
    "time_now",
    "time_sleep",
    "time_get_timezone_offset",
    # ---------- fetch types ----------
    "FetchMethodType",
    "FetchRequestConfigType",
    "FetchResponseType",
]
