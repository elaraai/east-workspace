#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cython-accelerated EastStruct as a cdef extension type.

Drop-in replacement for EastStruct from values.py. Direct C struct member
assignment eliminates object.__setattr__ overhead (4 descriptor lookups per
struct construction).
"""

# Shared cache — must be the SAME dict object as values.py uses
from east.types.values import _key_cache


cpdef tuple cy_intern_keys(tuple keys):
    """Intern a keys tuple so all structs with the same schema share one copy."""
    cdef object cached = _key_cache.get(keys)
    if cached is not None:
        return cached
    cdef dict key_index = {k: i for i, k in enumerate(keys)}
    cdef tuple result = (keys, key_index)
    _key_cache[keys] = result
    return result


cdef class CyEastStruct:
    """Hashable, immutable struct backed by tuples.

    Cython extension type — identical interface to the pure-Python EastStruct.
    Direct C member access for construction and field lookup.
    """

    cdef tuple _keys
    cdef tuple _values
    cdef dict _key_index
    cdef object _hash

    def __init__(self, dict data):
        """Create an immutable struct from a dict."""
        cdef tuple keys = tuple(data.keys())
        cdef tuple interned_keys
        cdef dict key_index
        interned_keys, key_index = cy_intern_keys(keys)
        self._keys = interned_keys
        self._values = tuple(data.values())
        self._key_index = key_index
        self._hash = None

    @classmethod
    def _from_tuples(cls, tuple keys, tuple values):
        """Create CyEastStruct directly from keys tuple and values tuple.

        Skips intermediate dict construction. Keys are interned automatically.
        """
        cdef CyEastStruct obj = CyEastStruct.__new__(CyEastStruct)
        cdef tuple interned_keys
        cdef dict key_index
        interned_keys, key_index = cy_intern_keys(keys)
        obj._keys = interned_keys
        obj._values = values
        obj._key_index = key_index
        obj._hash = None
        return obj

    @staticmethod
    cdef CyEastStruct _fast_create(tuple interned_keys, dict key_index, tuple values):
        """Fastest construction path — pre-interned keys, called from Cython only."""
        cdef CyEastStruct obj = CyEastStruct.__new__(CyEastStruct)
        obj._keys = interned_keys
        obj._values = values
        obj._key_index = key_index
        obj._hash = None
        return obj

    def __getitem__(self, str key):
        """Get field value by name."""
        cdef int idx
        try:
            idx = self._key_index[key]
            return self._values[idx]
        except KeyError:
            raise KeyError(key) from None

    def __getattr__(self, str name):
        """Field access as attributes: ``row.price`` == ``row["price"]``.

        Fires only when normal attribute lookup fails, so methods and slots
        shadow same-named fields (use item access for those). Keeps struct
        lambdas uniform across the traced-kernel and python paths.
        """
        cdef int idx
        if name.startswith("_"):
            raise AttributeError(name)
        try:
            idx = self._key_index[name]
            return self._values[idx]
        except (KeyError, TypeError):
            raise AttributeError(
                f"'{type(self).__name__}' object has no attribute or field {name!r}"
            ) from None

    def __contains__(self, key):
        """Check if field name exists."""
        return key in self._key_index

    def __len__(self):
        """Return number of fields."""
        return len(self._keys)

    def __iter__(self):
        """Iterate over field names."""
        return iter(self._keys)

    def items(self):
        """Return (name, value) pairs."""
        return zip(self._keys, self._values)

    def keys(self):
        """Return field names."""
        return self._keys

    def values(self):
        """Return field values."""
        return self._values

    def get(self, str key, default=None):
        """Get field value with default."""
        cdef object idx = self._key_index.get(key)
        if idx is not None:
            return self._values[<int>idx]
        return default

    def __hash__(self):
        """Compute hash based on sorted field items."""
        if self._hash is None:
            items = []
            for k in sorted(self._keys):
                v = self._values[self._key_index[k]]
                try:
                    items.append((k, hash(v)))
                except TypeError:
                    items.append((k, id(v)))
            self._hash = hash(tuple(items))
        return self._hash

    def __eq__(self, other):
        """Check equality with another EastStruct/CyEastStruct or dict."""
        if isinstance(other, CyEastStruct):
            return self._keys == (<CyEastStruct>other)._keys and self._values == (<CyEastStruct>other)._values
        if isinstance(other, dict):
            if len(self) != len(other):
                return False
            for k, v in zip(self._keys, self._values):
                if k not in other or other[k] != v:
                    return False
            return True
        return NotImplemented

    def __class_getitem__(cls, item):
        """Support generic subscripting (e.g. EastStruct[X])."""
        return cls

    def __setattr__(self, name, value):
        """Prevent modification after creation."""
        raise TypeError("EastStruct is immutable")

    def __repr__(self):
        """Return dict-like representation."""
        inner = ", ".join(
            f"{repr(k)}: {repr(v)}" for k, v in zip(self._keys, self._values)
        )
        return f"EastStruct({{{inner}}})"


cpdef CyEastStruct fast_create_struct(tuple interned_keys, dict key_index, tuple values):
    """Module-level fast struct constructor, callable from def closures."""
    cdef CyEastStruct obj = CyEastStruct.__new__(CyEastStruct)
    obj._keys = interned_keys
    obj._values = values
    obj._key_index = key_index
    obj._hash = None
    return obj


cdef class CyEastVariant:
    """Hashable, immutable variant wrapper.

    Cython extension type — identical interface to the pure-Python EastVariant.
    Direct C member access eliminates object.__setattr__ overhead.
    """

    cdef readonly str type
    cdef readonly object value
    cdef object _hash

    def __init__(self, str tag, object value):
        """Create an immutable variant."""
        self.type = tag
        self.value = value
        self._hash = None

    def __hash__(self):
        """Compute hash based on type and value."""
        if self._hash is None:
            try:
                self._hash = hash((self.type, self.value))
            except TypeError:
                self._hash = hash((self.type, id(self.value)))
        return self._hash

    def __eq__(self, other):
        """Check equality with another variant."""
        if isinstance(other, CyEastVariant):
            return self.type == (<CyEastVariant>other).type and self.value == (<CyEastVariant>other).value
        if isinstance(other, dict):
            return (
                other.get("type") == self.type
                and other.get("value") == self.value
                and len(other) == 2
            )
        return NotImplemented

    def __getitem__(self, str key):
        """Get value by key (dict-like access)."""
        if key == "type":
            return self.type
        if key == "value":
            return self.value
        raise KeyError(key)

    def __contains__(self, key):
        """Check if key exists."""
        return key in ("type", "value")

    def __len__(self):
        """Return number of fields (always 2)."""
        return 2

    def __iter__(self):
        """Iterate over keys."""
        return iter(("type", "value"))

    def keys(self):
        """Return keys."""
        return ("type", "value")

    def values(self):
        """Return values."""
        return (self.type, self.value)

    def items(self):
        """Return items as tuples."""
        return (("type", self.type), ("value", self.value))

    def get(self, str key, default=None):
        """Get value by key with default."""
        if key == "type":
            return self.type
        if key == "value":
            return self.value
        return default

    def __class_getitem__(cls, item):
        """Support generic subscripting (e.g. EastVariant[X])."""
        return cls

    def __setattr__(self, name, value):
        """Prevent modification after creation."""
        raise TypeError("EastVariant is immutable")

    def __repr__(self):
        """Return variant representation."""
        return f"EastVariant(type={self.type!r}, value={self.value!r})"


cpdef CyEastVariant fast_create_variant(str tag, object value):
    """Module-level fast variant constructor, callable from def closures."""
    cdef CyEastVariant obj = CyEastVariant.__new__(CyEastVariant)
    obj.type = tag
    obj.value = value
    obj._hash = None
    return obj
