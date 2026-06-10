#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East Python Standard Platform Functions.

Python implementation of standard platform functions for the East programming
language. Provides equivalents to east-node platform functions for Python
environments.

The ``*_impl`` functions in each module are plain Python callables taking and
returning East values - import them directly from a project's own
``@platform_function`` to reuse the implementations without an IR round-trip.
The ``platform`` list collects every registered function and can be passed to
``compile_async()`` to enable all standard platform functions in one call.
"""

from east_py_std.console import (
    console_error_impl,
    console_impl,
    console_log_impl,
    console_write_impl,
)
from east_py_std.crypto import (
    crypto_hash_sha256_bytes_impl,
    crypto_hash_sha256_impl,
    crypto_impl,
    crypto_random_bytes_impl,
    crypto_uuid_impl,
)
from east_py_std.fetch import (
    FetchMethodType,
    FetchRequestConfigType,
    FetchResponseType,
    fetch_get_bytes_impl,
    fetch_get_impl,
    fetch_impl,
    fetch_post_impl,
    fetch_request_impl,
)
from east_py_std.fs import (
    fs_append_file_impl,
    fs_create_directory_impl,
    fs_delete_file_impl,
    fs_exists_impl,
    fs_impl,
    fs_is_directory_impl,
    fs_is_file_impl,
    fs_read_directory_impl,
    fs_read_file_bytes_impl,
    fs_read_file_impl,
    fs_write_file_bytes_impl,
    fs_write_file_impl,
)
from east_py_std.path import (
    path_basename_impl,
    path_dirname_impl,
    path_extname_impl,
    path_impl,
    path_join_impl,
    path_resolve_impl,
)
from east_py_std.random import (
    random_bates_impl,
    random_bernoulli_impl,
    random_binomial_impl,
    random_exponential_impl,
    random_geometric_impl,
    random_impl,
    random_irwin_hall_impl,
    random_log_normal_impl,
    random_normal_impl,
    random_pareto_impl,
    random_poisson_impl,
    random_range_impl,
    random_seed_impl,
    random_uniform_impl,
    random_weibull_impl,
)
from east_py_std.test import (
    failed,
    passed,
    reset_counters,
    test_fail_impl,
    test_impl,
    test_pass_impl,
)
from east_py_std.time import (
    time_get_timezone_offset_impl,
    time_impl,
    time_now_impl,
    time_sleep_impl,
)

__version__ = "0.1.0"

# Complete Python standard platform implementation.
# Pass this list to compile_async() to enable all platform functions.
platform = [
    *console_impl,
    *crypto_impl,
    *fetch_impl,
    *fs_impl,
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
    "fetch_impl",
    "fs_impl",
    "path_impl",
    "random_impl",
    "test_impl",
    "time_impl",
    # ---------- console ----------
    "console_log_impl",
    "console_error_impl",
    "console_write_impl",
    # ---------- crypto ----------
    "crypto_random_bytes_impl",
    "crypto_hash_sha256_impl",
    "crypto_hash_sha256_bytes_impl",
    "crypto_uuid_impl",
    # ---------- fetch ----------
    "fetch_get_impl",
    "fetch_get_bytes_impl",
    "fetch_post_impl",
    "fetch_request_impl",
    # ---------- fs ----------
    "fs_read_file_impl",
    "fs_write_file_impl",
    "fs_append_file_impl",
    "fs_delete_file_impl",
    "fs_exists_impl",
    "fs_is_file_impl",
    "fs_is_directory_impl",
    "fs_create_directory_impl",
    "fs_read_directory_impl",
    "fs_read_file_bytes_impl",
    "fs_write_file_bytes_impl",
    # ---------- path ----------
    "path_join_impl",
    "path_resolve_impl",
    "path_dirname_impl",
    "path_basename_impl",
    "path_extname_impl",
    # ---------- random ----------
    "random_uniform_impl",
    "random_normal_impl",
    "random_range_impl",
    "random_exponential_impl",
    "random_weibull_impl",
    "random_bernoulli_impl",
    "random_binomial_impl",
    "random_geometric_impl",
    "random_poisson_impl",
    "random_pareto_impl",
    "random_log_normal_impl",
    "random_irwin_hall_impl",
    "random_bates_impl",
    "random_seed_impl",
    # ---------- test ----------
    "test_pass_impl",
    "test_fail_impl",
    "passed",
    "failed",
    "reset_counters",
    # ---------- time ----------
    "time_now_impl",
    "time_sleep_impl",
    "time_get_timezone_offset_impl",
    # ---------- fetch types ----------
    "FetchMethodType",
    "FetchRequestConfigType",
    "FetchResponseType",
]
