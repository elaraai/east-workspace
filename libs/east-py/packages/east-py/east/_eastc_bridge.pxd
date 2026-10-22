# cython: language_level=3
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Declaration of conversion functions between Python East types/values and east-c."""

from east cimport _eastc

from libc.stdint cimport uint64_t

cdef _eastc.EastType* py_type_to_c(object py_type) except NULL
cdef object c_value_to_py(_eastc.EastValue *val, _eastc.EastType *c_type)
cdef _eastc.EastValue* py_value_to_c(object val, _eastc.EastType *c_type) except NULL
cdef object _c_type_tag_to_py_type(_eastc.EastType *c_type)
# The element-level crossings so far (#1357): every read or write of a C
# collection's element through a proxy, which the platform bridge counts
# across a python platform function's body for the profile.
cdef uint64_t bridge_crossings() noexcept
