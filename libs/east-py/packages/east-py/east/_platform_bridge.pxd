# cython: language_level=3
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Declaration of platform bridge functions for use by _compiler_eastc."""

from east cimport _eastc

cdef void register_platform_functions(_eastc.PlatformRegistry *reg, list platform_list) except *
