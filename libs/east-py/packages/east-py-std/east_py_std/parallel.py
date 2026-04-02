#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Parallel platform functions for East.

Uses a C-level implementation (pthreads + east_call) for true parallelism
without the GIL.
"""

from __future__ import annotations

from east.runtime.platform import GenericPlatformFunction

from east_py_std._parallel_eastc import parallel_map_factory_capsule

parallel_impl = [
    GenericPlatformFunction(
        name="parallel_map",
        type_parameters=["T", "R"],
        type="async",
        fn=None,
        c_factory=parallel_map_factory_capsule,
    ),
]


__all__ = ["parallel_impl"]
