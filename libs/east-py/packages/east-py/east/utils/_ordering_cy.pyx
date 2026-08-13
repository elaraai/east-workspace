#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cython-accelerated ordering for East values.

Drop-in replacement for compare_for, equal_for, is_for, and make_east_key
from ordering.py. Gains from:
- CyEastKey cdef class with C-level tp_richcompare
- libc.math for float NaN/copysign checks
- Typed loop variables in composite comparers
"""

from libc.math cimport isnan, copysign

from east.types.types import (
    is_array_type,
    is_async_function_type,
    is_blob_type,
    is_boolean_type,
    is_datetime_type,
    is_dict_type,
    is_float_type,
    is_function_type,
    is_integer_type,
    is_matrix_type,
    is_never_type,
    is_null_type,
    is_recursive_type,
    is_ref_type,
    is_set_type,
    is_string_type,
    is_struct_type,
    is_variant_type,
    is_vector_type,
)
from east.types.values import EastBlob, EastMatrix, EastVector


# =========================================================================
# CyEastKey — cdef class for fast rich comparison
# =========================================================================

cdef class CyEastKey:
    """Key wrapper for East values used in sorted() and SortedContainers.

    Single cdef class with C-level tp_richcompare, replacing the dynamically
    created Python class in make_east_key().
    """

    cdef readonly object value
    cdef object _compare

    def __init__(self, object value, object compare_fn):
        self.value = value
        self._compare = compare_fn

    def __lt__(self, CyEastKey other):
        return self._compare(self.value, other.value) < 0

    def __le__(self, CyEastKey other):
        return self._compare(self.value, other.value) <= 0

    def __gt__(self, CyEastKey other):
        return self._compare(self.value, other.value) > 0

    def __ge__(self, CyEastKey other):
        return self._compare(self.value, other.value) >= 0

    def __eq__(self, other):
        if not isinstance(other, CyEastKey):
            return NotImplemented
        return self._compare(self.value, (<CyEastKey>other).value) == 0

    def __hash__(self):
        return hash(self.value)


def cy_make_east_key(type_val):
    """Create an EastKey class for a specific type.

    Returns a callable that wraps values in CyEastKey instances with
    the appropriate compare function for the given type.
    """
    compare = cy_compare_for(type_val)

    class EastKey(CyEastKey):
        """Type-specific key wrapper."""
        __slots__ = ()

        def __init__(self, value):
            CyEastKey.__init__(self, value, compare)

    return EastKey


# =========================================================================
# Primitive comparers
# =========================================================================

cpdef int cy_compare_bool(bint x, bint y):
    """Compare two booleans. False < True."""
    return (1 if x else 0) - (1 if y else 0)


cpdef int cy_compare_int(long long x, long long y):
    """Compare two integers."""
    if x < y:
        return -1
    if x > y:
        return 1
    return 0


cpdef int cy_compare_float(double x, double y):
    """Compare two floats with NaN and -0 handling."""
    cdef double sx, sy
    if isnan(x):
        if isnan(y):
            return 0
        return 1
    if isnan(y):
        return -1
    # Handle -0 vs +0
    if x == 0.0 and y == 0.0:
        sx = copysign(1.0, x)
        sy = copysign(1.0, y)
        if sx < 0.0 and sy > 0.0:
            return -1
        if sx > 0.0 and sy < 0.0:
            return 1
    if x < y:
        return -1
    if x > y:
        return 1
    return 0


cpdef int cy_compare_string(str x, str y):
    """Compare two strings."""
    if x < y:
        return -1
    if x > y:
        return 1
    return 0


cpdef bint cy_equal_float(double x, double y):
    """Float equality with NaN == NaN and -0 != +0."""
    if isnan(x):
        return isnan(y)
    if x == 0.0 and y == 0.0:
        return copysign(1.0, x) == copysign(1.0, y)
    return x == y


# =========================================================================
# cy_compare_for — three-way compare factory
# =========================================================================

def cy_compare_for(type_val, type_ctx=None):
    """Create a three-way comparer for a given type.

    Returns a function (x, y, ctx=None) -> int where:
    - -1 means x < y
    -  0 means x == y
    -  1 means x > y

    type_ctx maps recursive scope ids to their comparers.
    """
    if type_ctx is None:
        type_ctx = {}

    if is_never_type(type_val):
        def compare_never(_x, _y, _ctx=None):
            raise RuntimeError("Attempted to compare values of type .Never")
        return compare_never

    if is_null_type(type_val):
        return lambda _x, _y, _ctx=None: 0

    if is_boolean_type(type_val):
        def compare_bool(x, y, _ctx=None):
            return cy_compare_bool(x, y)
        return compare_bool

    if is_integer_type(type_val):
        def compare_int(x, y, _ctx=None):
            cdef long long xi, yi
            xi = x
            yi = y
            if xi < yi:
                return -1
            if xi > yi:
                return 1
            return 0
        return compare_int

    if is_float_type(type_val):
        def compare_float(x, y, _ctx=None):
            return cy_compare_float(<double>x, <double>y)
        return compare_float

    if is_string_type(type_val):
        def compare_string(x, y, _ctx=None):
            return cy_compare_string(<str>x, <str>y)
        return compare_string

    if is_datetime_type(type_val):
        def compare_datetime(x, y, _ctx=None):
            cdef double xt, yt
            xt = x.timestamp()
            yt = y.timestamp()
            if xt < yt:
                return -1
            if xt > yt:
                return 1
            return 0
        return compare_datetime

    if is_blob_type(type_val):
        def compare_blob(x, y, _ctx=None):
            cdef int min_len, i, lx, ly
            if isinstance(x, EastBlob):
                x = x.data
            if isinstance(y, EastBlob):
                y = y.data
            lx = len(x)
            ly = len(y)
            min_len = lx if lx < ly else ly
            for i in range(min_len):
                if x[i] < y[i]:
                    return -1
                if x[i] > y[i]:
                    return 1
            if lx < ly:
                return -1
            if lx > ly:
                return 1
            return 0
        return compare_blob

    if is_vector_type(type_val):
        elem_compare = cy_compare_for(type_val.value, type_ctx)

        def compare_vector(x, y, _ctx=None):
            cdef int length, i, cmp_val, lx, ly
            if x is y:
                return 0
            lx = len(x._data)
            ly = len(y._data)
            length = lx if lx < ly else ly
            for i in range(length):
                cmp_val = elem_compare(x._data[i], y._data[i])
                if cmp_val != 0:
                    return cmp_val
            if lx < ly:
                return -1
            if lx > ly:
                return 1
            return 0
        return compare_vector

    if is_matrix_type(type_val):
        elem_compare = cy_compare_for(type_val.value, type_ctx)

        def compare_matrix(x, y, _ctx=None):
            cdef int i, cmp_val
            if x is y:
                return 0
            if x.rows != y.rows:
                return -1 if x.rows < y.rows else 1
            if x.cols != y.cols:
                return -1 if x.cols < y.cols else 1
            flat_x = x._data.ravel()
            flat_y = y._data.ravel()
            for i in range(len(flat_x)):
                cmp_val = elem_compare(flat_x[i], flat_y[i])
                if cmp_val != 0:
                    return cmp_val
            return 0
        return compare_matrix

    if is_array_type(type_val):
        value_comparer = [None]

        def compare_array(x, y, ctx=None):
            cdef int min_len, i, c, lx, ly
            if x is y:
                return 0
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return 0
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            lx = len(x)
            ly = len(y)
            min_len = lx if lx < ly else ly
            _vc = value_comparer[0]
            for i in range(min_len):
                c = _vc(x[i], y[i], ctx)
                if c != 0:
                    return c
            if lx < ly:
                return -1
            if lx > ly:
                return 1
            return 0

        value_comparer[0] = cy_compare_for(type_val.value, type_ctx)
        return compare_array

    if is_set_type(type_val):
        key_comparer = cy_compare_for(type_val.value, type_ctx)
        elem_key_class = cy_make_east_key(type_val.value)

        def compare_set(x, y, ctx=None):
            if x is y:
                return 0
            x_sorted = sorted(x, key=elem_key_class)
            y_sorted = sorted(y, key=elem_key_class)
            x_iter = iter(x_sorted)
            y_iter = iter(y_sorted)
            try:
                while True:
                    try:
                        x_elem = next(x_iter)
                    except StopIteration:
                        try:
                            next(y_iter)
                            return -1
                        except StopIteration:
                            return 0
                    try:
                        y_elem = next(y_iter)
                    except StopIteration:
                        return 1
                    c = key_comparer(x_elem, y_elem, ctx)
                    if c != 0:
                        return c
            except StopIteration:
                pass
            return 0

        return compare_set

    if is_dict_type(type_val):
        key_comparer = cy_compare_for(type_val.value["key"], type_ctx)
        value_comparer_dict = [None]

        def compare_dict(x, y, ctx=None):
            if x is y:
                return 0
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return 0
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            x_iter = iter(x.items())
            y_iter = iter(y.items())
            _vcd = value_comparer_dict[0]
            try:
                while True:
                    try:
                        xk, xv = next(x_iter)
                    except StopIteration:
                        try:
                            next(y_iter)
                            return -1
                        except StopIteration:
                            return 0
                    try:
                        yk, yv = next(y_iter)
                    except StopIteration:
                        return 1
                    kc = key_comparer(xk, yk, None)
                    if kc != 0:
                        return kc
                    vc = _vcd(xv, yv, ctx)
                    if vc != 0:
                        return vc
            except StopIteration:
                pass
            return 0

        value_comparer_dict[0] = cy_compare_for(type_val.value["value"], type_ctx)
        return compare_dict

    if is_ref_type(type_val):
        from east.types.values import EastRef
        inner_comparer = [None]

        def compare_ref(x, y, ctx=None):
            if x is y:
                return 0
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return 0
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))
            return inner_comparer[0](x.value, y.value, ctx)

        inner_comparer[0] = cy_compare_for(type_val.value, type_ctx)
        return compare_ref

    if is_struct_type(type_val):
        field_comparers = []

        def compare_struct(x, y, ctx=None):
            cdef int c
            for field_name, field_comparer in field_comparers:
                c = field_comparer(x[field_name], y[field_name], ctx)
                if c != 0:
                    return c
            return 0

        for field_struct in type_val.value:
            field_name = field_struct["name"]
            field_type = field_struct["type"]
            field_comparers.append((field_name, cy_compare_for(field_type, type_ctx)))
        return compare_struct

    if is_variant_type(type_val):
        case_comparers = {}

        def compare_variant(x, y, ctx=None):
            x_type = x["type"]
            y_type = y["type"]
            if x_type < y_type:
                return -1
            if x_type > y_type:
                return 1
            return case_comparers[x_type](x["value"], y["value"], ctx)

        for case_struct in type_val.value:
            case_name = case_struct["name"]
            case_type = case_struct["type"]
            case_comparers[case_name] = cy_compare_for(case_type, type_ctx)
        return compare_variant

    if is_recursive_type(type_val):
        payload = type_val.value
        if payload.type == "wrapper":
            # Register a forward cell for the scope BEFORE building the inner
            # comparer, so ref(id) leaves inside the body resolve to it.
            rec_id = payload.value["id"]
            cell = [None]

            def compare_recursive(x, y, ctx=None):
                return cell[0](x, y, ctx)

            prev = type_ctx.get(rec_id)
            type_ctx[rec_id] = compare_recursive
            try:
                cell[0] = cy_compare_for(payload.value["inner"], type_ctx)
            finally:
                if prev is None:
                    type_ctx.pop(rec_id, None)
                else:
                    type_ctx[rec_id] = prev
            return cell[0]
        resolved = type_ctx.get(payload.value)
        if resolved is None:
            raise ValueError(f"cy_compare_for: unresolved Recursive ref({payload.value})")
        return resolved

    if is_function_type(type_val) or is_async_function_type(type_val):
        return lambda _x, _y: 0

    raise RuntimeError(f"Unknown type encountered during type printing: {type_val.type}")


# =========================================================================
# cy_equal_for — equality factory
# =========================================================================

def cy_equal_for(type_val, type_ctx=None):
    """Create a type-specific equality function.

    type_ctx maps recursive scope ids to their comparers.
    """
    from east.types.values import EastArray, EastDict, EastSet

    if type_ctx is None:
        type_ctx = {}

    if is_never_type(type_val):
        def equal_never(_x, _y, _ctx=None):
            raise RuntimeError("Attempted to compare values of type .Never")
        return equal_never

    if is_null_type(type_val):
        return lambda _x, _y, _ctx=None: True

    if is_boolean_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_integer_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_float_type(type_val):
        def equal_float(x, y, _ctx=None):
            return cy_equal_float(<double>x, <double>y)
        return equal_float

    if is_string_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_datetime_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_blob_type(type_val):
        def equal_blob(x, y, _ctx=None):
            if len(x.data) != len(y.data):
                return False
            return all(a == b for a, b in zip(x.data, y.data, strict=False))
        return equal_blob

    if is_vector_type(type_val):
        elem_equal = cy_equal_for(type_val.value, type_ctx)

        def equal_vector(x, y, _ctx=None):
            cdef int i
            if x is y:
                return True
            if len(x._data) != len(y._data):
                return False
            for i in range(len(x._data)):
                if not elem_equal(x._data[i], y._data[i]):
                    return False
            return True
        return equal_vector

    if is_matrix_type(type_val):
        elem_equal = cy_equal_for(type_val.value, type_ctx)

        def equal_matrix(x, y, _ctx=None):
            cdef int i
            if x is y:
                return True
            if x.rows != y.rows or x.cols != y.cols:
                return False
            xd = x._data.ravel()
            yd = y._data.ravel()
            for i in range(len(xd)):
                if not elem_equal(xd[i], yd[i]):
                    return False
            return True
        return equal_matrix

    if is_array_type(type_val):
        value_comparer = cy_equal_for(type_val.value, type_ctx)

        def equal_array(x, y, ctx=None):
            cdef int i
            if x is y:
                return True
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))
            if len(x) != len(y):
                return False
            for i in range(len(x)):
                if not value_comparer(x[i], y[i], ctx):
                    return False
            return True

        return equal_array

    if is_set_type(type_val):

        def equal_set(x, y, _ctx=None):
            if len(x) != len(y):
                return False
            return all(item in y for item in x)

        return equal_set

    if is_dict_type(type_val):
        value_comparer = cy_equal_for(type_val.value["value"], type_ctx)

        def equal_dict(x, y, ctx=None):
            if x is y:
                return True
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))
            if len(x) != len(y):
                return False
            for key, x_val in x.items():
                if key not in y:
                    return False
                if not value_comparer(x_val, y[key], ctx):
                    return False
            return True

        return equal_dict

    if is_ref_type(type_val):
        from east.types.values import EastRef
        inner_comparer = cy_equal_for(type_val.value, type_ctx)

        def equal_ref(x, y, ctx=None):
            if x is y:
                return True
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))
            return inner_comparer(x.value, y.value, ctx)

        return equal_ref

    if is_struct_type(type_val):
        field_comparers = []

        def equal_struct(x, y, ctx=None):
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))
            for field_name, comparer in field_comparers:
                if not comparer(x[field_name], y[field_name], ctx):
                    return False
            return True

        for field_struct in type_val.value:
            field_name = field_struct["name"]
            field_type = field_struct["type"]
            field_comparers.append((field_name, cy_equal_for(field_type, type_ctx)))
        return equal_struct

    if is_variant_type(type_val):
        case_comparers = {}

        def equal_variant(x, y, ctx=None):
            x_tag = x["type"]
            y_tag = y["type"]
            if x_tag != y_tag:
                return False
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))
            return case_comparers[x_tag](x["value"], y["value"], ctx)

        for case_struct in type_val.value:
            case_name = case_struct["name"]
            case_type = case_struct["type"]
            case_comparers[case_name] = cy_equal_for(case_type, type_ctx)
        return equal_variant

    if is_recursive_type(type_val):
        payload = type_val.value
        if payload.type == "wrapper":
            rec_id = payload.value["id"]
            cell = [None]

            def equal_recursive(x, y, ctx=None):
                return cell[0](x, y, ctx)

            prev = type_ctx.get(rec_id)
            type_ctx[rec_id] = equal_recursive
            try:
                cell[0] = cy_equal_for(payload.value["inner"], type_ctx)
            finally:
                if prev is None:
                    type_ctx.pop(rec_id, None)
                else:
                    type_ctx[rec_id] = prev
            return cell[0]
        resolved = type_ctx.get(payload.value)
        if resolved is None:
            raise ValueError(f"cy_equal_for: unresolved Recursive ref({payload.value})")
        return resolved

    if is_function_type(type_val) or is_async_function_type(type_val):
        return lambda _x, _y: True

    raise RuntimeError(f"Unknown type encountered during type printing: {type_val.type}")


# =========================================================================
# cy_is_for — identity comparison factory
# =========================================================================

def cy_is_for(type_val, type_ctx=None):
    """Create an identity comparer for a given type.

    type_ctx maps recursive scope ids to their comparers.
    """
    if type_ctx is None:
        type_ctx = {}

    if is_never_type(type_val):
        def is_never(_x, _y, _ctx=None):
            raise RuntimeError("Attempted to compare values of type .Never")
        return is_never

    if is_null_type(type_val):
        return lambda _x, _y, _ctx=None: True

    if is_boolean_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_integer_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_float_type(type_val):
        def is_float(x, y, _ctx=None):
            cdef double dx, dy
            dx = x
            dy = y
            if isnan(dx) and isnan(dy):
                return True
            return dx == dy
        return is_float

    if is_string_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_datetime_type(type_val):
        return lambda x, y, _ctx=None: x.timestamp() == y.timestamp()

    if is_blob_type(type_val):
        def is_blob(x, y, _ctx=None):
            if isinstance(x, EastBlob):
                x = x.data
            if isinstance(y, EastBlob):
                y = y.data
            if len(x) != len(y):
                return False
            return all(a == b for a, b in zip(x, y, strict=True))
        return is_blob

    if is_vector_type(type_val):
        return lambda x, y, _ctx=None: x is y

    if is_matrix_type(type_val):
        return lambda x, y, _ctx=None: x is y

    if is_array_type(type_val):
        return lambda x, y, _ctx=None: x is y

    if is_set_type(type_val):
        return lambda x, y, _ctx=None: x is y

    if is_dict_type(type_val):
        return lambda x, y, _ctx=None: x is y

    if is_ref_type(type_val):
        return lambda x, y, _ctx=None: x is y

    if is_struct_type(type_val):
        field_comparers = []

        def is_struct(x, y, ctx=None):
            for field_name, field_comparer in field_comparers:
                if not field_comparer(x[field_name], y[field_name], ctx):
                    return False
            return True

        for field_struct in type_val.value:
            field_name = field_struct["name"]
            field_type = field_struct["type"]
            field_comparers.append((field_name, cy_is_for(field_type, type_ctx)))
        return is_struct

    if is_variant_type(type_val):
        case_comparers = {}

        def is_variant(x, y, ctx=None):
            if x["type"] != y["type"]:
                return False
            case_key = x["type"]
            return case_comparers[case_key](x["value"], y["value"], ctx)

        for case_struct in type_val.value:
            case_name = case_struct["name"]
            case_type = case_struct["type"]
            case_comparers[case_name] = cy_is_for(case_type, type_ctx)
        return is_variant

    if is_recursive_type(type_val):
        payload = type_val.value
        if payload.type == "wrapper":
            rec_id = payload.value["id"]
            cell = [None]

            def is_recursive(x, y, ctx=None):
                return cell[0](x, y, ctx)

            prev = type_ctx.get(rec_id)
            type_ctx[rec_id] = is_recursive
            try:
                cell[0] = cy_is_for(payload.value["inner"], type_ctx)
            finally:
                if prev is None:
                    type_ctx.pop(rec_id, None)
                else:
                    type_ctx[rec_id] = prev
            return cell[0]
        resolved = type_ctx.get(payload.value)
        if resolved is None:
            raise ValueError(f"cy_is_for: unresolved Recursive ref({payload.value})")
        return resolved

    if is_function_type(type_val):
        raise RuntimeError("Attempted to compare values of type .Function")

    raise RuntimeError(f"Unknown type encountered during type printing: {type_val.type}")
