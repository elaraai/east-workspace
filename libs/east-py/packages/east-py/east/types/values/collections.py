#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Mutable collection value types: EastArray, EastSet, EastDict (mutually recursive)."""

from __future__ import annotations

from collections.abc import Callable, Iterable, MutableSequence
from typing import TYPE_CHECKING, Any, Generic

import east.types.values as _ev
from east.types.values._helpers import K, T, V, _call_builtin
from east.types.values.primitives import east_null
from east.types.values.structural import EastFunction, EastVariant

if TYPE_CHECKING:
    from east.types.types import EastType
    from east.types.values.structural import EastStruct


# The C-backed proxy classes live in the Cython bridge (_eastc_bridge), which is
# built/loaded after this pure-Python module and whose proxies subclass the
# classes defined here — a top-level import would cycle. Import lazily and cache
# the class object (the same lazy pattern as _call_builtin in _helpers).
_proxy_classes: dict[str, Any] = {}


def _proxy_cls(name: str) -> Any:
    cls = _proxy_classes.get(name)
    if cls is None:
        import east._eastc_bridge as _bridge

        cls = getattr(_bridge, name)
        _proxy_classes[name] = cls
    return cls


def _opt_unwrap_or(opt: Any, default: Any) -> Any:
    """Dual-mode Option unwrap: traced .unwrap_or on expressions, eager on
    runtime variants (shared by the group max/min folds)."""
    from east.kernel import KernelExpr

    if isinstance(opt, KernelExpr):
        return opt.unwrap_or(default)
    return opt.value if opt.type == "some" else default


# Cached KernelExpr class for the traced-argument pre-checks (#393): access
# methods called with a traced key/index re-route through the kernel tracer
# (this collection lifts to a constant) instead of hitting the C container
# protocol with an expression proxy.
_kernel_expr_cls: Any = None


def _is_traced(value: Any) -> bool:
    """Whether ``value`` is a traced kernel expression (lazy class cache)."""
    global _kernel_expr_cls
    if _kernel_expr_cls is None:
        from east.kernel import KernelExpr

        _kernel_expr_cls = KernelExpr
    return isinstance(value, _kernel_expr_cls)


def _lift_traced(value: Any) -> Any:
    """Lift an eager collection into a traced constant expression (#393)."""
    from east.kernel import _lift

    return _lift(value)


class EastArray(MutableSequence, Generic[T]):
    """East array with element type tracking.

    Arrays are mutable, ordered, 0-indexed collections backed by a live east-c
    array value — one representation, no Python store. The element ops live on the
    proxy and route to east-c; ``MutableSequence`` derives the rest (index, count,
    __reversed__, __iadd__, ...) from the proxy's __getitem__/__setitem__/
    __delitem__/__len__/insert primitives.

    Generic type parameter T is for static type hints only (e.g., EastArray[float]).
    At runtime, element_type provides the actual East type.
    """

    __slots__ = ("element_type", "_iteration_lock")

    def __new__(cls, *args, **kwargs):  # noqa: ARG004 — Python forwards constructor args here; the proxy __init__ consumes them
        # EastArray(element_type, items) constructs a live C-backed proxy from birth.
        # Returning an EastArrayProxy makes Python run EastArrayProxy.__init__, which
        # allocates the east-c array and bulk-pushes. Subclasses construct normally.
        if cls is EastArray:
            return object.__new__(_proxy_cls("EastArrayProxy"))
        return object.__new__(cls)

    def _lock_for_iteration(self) -> None:
        """Lock array for iteration (prevents modifications)."""
        self._iteration_lock += 1

    def _unlock_for_iteration(self) -> None:
        """Unlock array after iteration."""
        self._iteration_lock -= 1

    def _check_not_iterating(self) -> None:
        """Check if array is being iterated and raise error if so."""
        if self._iteration_lock > 0:
            raise RuntimeError("Cannot modify Array during iteration")

    # ----- MutableSequence primitives -----------------------------------------
    # Implemented by EastArrayProxy against the live east-c array (see
    # _eastc_bridge.pyx); MutableSequence derives index/count/__reversed__/__iadd__
    # from them. Declared here so EastArray reads as a concrete Sequence to static
    # checkers — the proxy overrides each at runtime, so these bodies never run.

    def __getitem__(self, index: Any) -> Any:
        raise NotImplementedError

    def __setitem__(self, index: Any, value: Any) -> None:
        raise NotImplementedError

    def __delitem__(self, index: Any) -> None:
        raise NotImplementedError

    def __len__(self) -> int:
        raise NotImplementedError

    def insert(self, index: int, value: Any) -> None:
        raise NotImplementedError

    # ----- Eager value methods (delegate to east-c; results are live values) ---

    def sorted(self, key: Any = None, *, reverse: bool = False) -> EastArray:
        """New array sorted ascending by East's total order (east-c ArraySort).

        Args:
            key: Optional projection ``fn(element) -> sort key``; elements are
                ordered by the East total order of the projected keys. When
                omitted, elements are sorted by their own East total order.
            reverse: When True, the sorted result is reversed (descending).

        Returns:
            A new array; the original is left unchanged.

        Note:
            Ordering follows East's total order, not Python's ``<``. The keyless
            path uses ``ArraySortDefault``; a ``key`` whose result type is sampled
            from the first element uses ``ArraySort``.
        """
        from east.types.types import ArrayType

        if key is None:
            result = _call_builtin("ArraySortDefault", [self.element_type], [self], ArrayType(self.element_type))
        else:
            t2 = _ev.type_of(key(self[0])) if len(self) else self.element_type
            callback = EastFunction(key, [self.element_type], t2)
            result = _call_builtin("ArraySort", [self.element_type, t2], [self, callback], ArrayType(self.element_type))
        return result.reversed() if reverse else result

    def is_sorted(self, key: Any = None) -> bool:
        """Whether elements are in non-decreasing East order (east-c ArrayIsSorted).

        Args:
            key: Optional projection ``fn(element) -> sort key`` to compare by;
                without it, elements are compared directly.

        Returns:
            True if each element's key is in East total order relative to the next.
        """
        from east.types.types import BooleanType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = _ev.type_of(key(self[0])) if len(self) else self.element_type
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("ArrayIsSorted", [self.element_type, t2], [self, callback], BooleanType)

    def find_sorted_first(self, target: Any, key: Any = None) -> int:
        """Leftmost insertion index for ``target`` in a sorted array (east-c ArrayFindSortedFirst).

        Assumes the array is already sorted in East order (by ``key`` if given).

        Args:
            target: Value to locate; compared against ``key(element)`` (or the
                element itself when ``key`` is omitted).
            key: Optional projection ``fn(element) -> comparable`` matching the
                sort order; when given, ``target`` is compared in the key's type.

        Returns:
            The first index where ``target`` could be inserted while keeping
            order, i.e. the leftmost position of an equal key.
        """
        from east.types.types import IntegerType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = _ev.type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("ArrayFindSortedFirst", [self.element_type, t2], [self, target, callback], IntegerType)

    def find_sorted_last(self, target: Any, key: Any = None) -> int:
        """Rightmost insertion index for ``target`` in a sorted array (east-c ArrayFindSortedLast).

        Assumes the array is already sorted in East order (by ``key`` if given).

        Args:
            target: Value to locate; compared against ``key(element)`` (or the
                element itself when ``key`` is omitted).
            key: Optional projection ``fn(element) -> comparable`` matching the
                sort order; when given, ``target`` is compared in the key's type.

        Returns:
            The last index where ``target`` could be inserted while keeping
            order, i.e. just past the rightmost equal key.
        """
        from east.types.types import IntegerType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = _ev.type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("ArrayFindSortedLast", [self.element_type, t2], [self, target, callback], IntegerType)

    def find_sorted_range(self, target: Any, key: Any = None) -> EastStruct:
        """Half-open index range of elements equal to ``target`` in a sorted array (east-c ArrayFindSortedRange).

        Assumes the array is already sorted in East order (by ``key`` if given).

        Args:
            target: Value to locate; compared against ``key(element)`` (or the
                element itself when ``key`` is omitted).
            key: Optional projection ``fn(element) -> comparable`` matching the
                sort order; when given, ``target`` is compared in the key's type.

        Returns:
            A struct ``{start, end}`` of integers giving the ``[start, end)``
            span of matching elements; ``start == end`` when ``target`` is absent.
        """
        from east.types.types import IntegerType, StructType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = _ev.type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        out_type = StructType([("start", IntegerType), ("end", IntegerType)])
        return _call_builtin("ArrayFindSortedRange", [self.element_type, t2], [self, target, callback], out_type)

    def find_first(self, target: Any, key: Any = None) -> EastVariant:
        """First index whose ``key`` equals ``target`` by linear scan (east-c ArrayFindFirst).

        Does not require a sorted array.

        Args:
            target: Value to match against ``key(element)`` (or the element
                itself when ``key`` is omitted), using East equality.
            key: Optional projection ``fn(element) -> comparable``; when given,
                ``target`` is matched in the key's type.

        Returns:
            ``some(index)`` for the first match, else ``none``.
        """
        from east.types.types import IntegerType, NullType, VariantType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        else:
            t2 = _ev.type_of(target)
            callback = EastFunction(key, [self.element_type], t2)
        out_type = VariantType([("none", NullType), ("some", IntegerType)])
        return _call_builtin("ArrayFindFirst", [self.element_type, t2], [self, target, callback], out_type)

    def concat(self, other: EastArray) -> EastArray:
        """New array with ``other`` appended after this array's elements (east-c ArrayConcat).

        Args:
            other: Array of the same element type to append.

        Returns:
            A new array; neither input is modified.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayConcat", [self.element_type], [self, other], ArrayType(self.element_type))

    def slice(self, start: int, end: int) -> EastArray:
        """New array holding the half-open sub-range ``[start, end)`` (east-c ArraySlice).

        Args:
            start: Inclusive start index.
            end: Exclusive end index.

        Returns:
            A new array of the elements in the range.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArraySlice", [self.element_type], [self, int(start), int(end)], ArrayType(self.element_type))

    def get_keys(self, indices: EastArray) -> EastArray:
        """Gather elements at the given indices into a new array (east-c ArrayGetKeys).

        Args:
            indices: Array of integer indices to read, in order.

        Returns:
            A new array with one element per index, ``self[index]`` for each.
        """
        from east.types.types import ArrayType, IntegerType

        callback = EastFunction(lambda idx: self[idx], [IntegerType], self.element_type)
        return _call_builtin("ArrayGetKeys", [self.element_type], [self, indices, callback], ArrayType(self.element_type))

    def copy(self) -> EastArray:
        """A shallow copy of this array (east-c ArrayCopy).

        Returns:
            A new array with the same elements.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayCopy", [self.element_type], [self], ArrayType(self.element_type))

    def reversed(self) -> EastArray:
        """New array with the elements in reverse order (east-c ArrayReverse).

        Returns:
            A new array; the original is left unchanged.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayReverse", [self.element_type], [self], ArrayType(self.element_type))

    def has(self, index: int) -> bool:
        """Whether ``index`` is within bounds (``0 <= index < len``)."""
        return 0 <= int(index) < len(self)

    def get(self, index: int) -> Any:
        """Element at ``index`` (the container read delegates to the live value on a proxy).

        With a traced ``index`` (inside a ``kernel()`` lambda) this array is
        lifted as a constant and the access emits IR (#393).
        """
        if _is_traced(index):
            return _lift_traced(self).get(index)
        return self[index]

    def get_or_default(self, index: int, default: Any) -> Any:
        """Element at ``index``, or ``default`` when ``index`` is out of bounds.

        Traced arguments emit IR against this array as a constant (#393).
        """
        if _is_traced(index) or _is_traced(default):
            return _lift_traced(self).get_or_default(index, default)
        return self[index] if self.has(index) else default

    def try_get(self, index: int) -> EastVariant:
        """``some(element)`` when ``index`` is in bounds, else ``none``.

        A traced ``index`` emits IR against this array as a constant (#393).
        """
        if _is_traced(index):
            return _lift_traced(self).try_get(index)
        return EastVariant("some", self[index]) if self.has(index) else EastVariant("none", east_null)

    def to_set(self, key: Any = None) -> EastSet:
        """Set of the elements, or of their projected keys (east-c ArrayToSet).

        Args:
            key: Optional projection ``fn(element) -> key``; the index is not
                passed. Without it, the elements themselves form the set.

        Returns:
            A set of the distinct (East-equal) elements or keys. The element
            type is taken from the projection sampled on the first element.
        """
        from east.types.types import IntegerType, SetType

        if key is None:
            k2 = self.element_type
            callback = EastFunction(lambda el, idx: el, [self.element_type, IntegerType], k2)
        else:
            k2 = _ev.type_of(key(self[0])) if len(self) else self.element_type
            callback = EastFunction(lambda el, idx: key(el), [self.element_type, IntegerType], k2)
        return _call_builtin("ArrayToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def unique(self) -> EastSet:
        """The set of distinct elements (east-c ArrayToSet with an identity key).

        Returns:
            A set of the distinct (East-equal) elements.
        """
        return self.to_set()

    def to_dict(self, key: Any, value: Any = None, combine: Any = None) -> EastDict:
        """Build a dict keyed by ``key(element)`` from the array (east-c ArrayToDict).

        Args:
            key: ``fn(element) -> dict key``; its result type, sampled on the
                first element, becomes the dict key type.
            value: Optional ``fn(element) -> value``; defaults to the element
                itself. Its result type becomes the dict value type.
            combine: Optional ``fn(existing, incoming) -> value`` to resolve a
                key collision. Without it, the later element wins.

        Returns:
            A dict with East-ordered keys. An empty array yields an empty dict.
        """
        from east.types.types import DictType, IntegerType

        if len(self) == 0:
            k2 = self.element_type
            t2 = self.element_type
            return EastDict(k2, t2)
        k2 = _ev.type_of(key(self[0]))
        value_fn = (lambda el: el) if value is None else value
        t2 = self.element_type if value is None else _ev.type_of(value(self[0]))
        key_cb = EastFunction(lambda el, idx: key(el), [self.element_type, IntegerType], k2)
        val_cb = EastFunction(lambda el, idx: value_fn(el), [self.element_type, IntegerType], t2)
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin("ArrayToDict", [self.element_type, k2, t2], [self, key_cb, val_cb, combine_cb], DictType(k2, t2))

    def map(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Apply ``fn`` to each element, producing a new array (east-c ArrayMap).

        Args:
            fn: ``fn(element) -> new value``; the index is not passed.
            out: Optional result element type. When omitted, it is inferred by
                applying ``fn`` to the first element.

        Returns:
            A new array of the same length; an empty array yields an empty array
            of element type ``out`` (or Null when ``out`` is omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        t2 = out if out is not None else _ev.type_of(fn(self[0]))
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], t2)
        return _call_builtin("ArrayMap", [self.element_type, t2], [self, callback], ArrayType(t2))

    def filter(self, predicate: Any) -> EastArray:
        """Keep elements for which ``predicate`` is truthy (east-c ArrayFilter).

        Args:
            predicate: ``fn(element) -> bool``; the index is not passed.

        Returns:
            A new array of the matching elements in original order.
        """
        from east.kernel import KernelExpr
        from east.types.types import ArrayType, BooleanType, IntegerType

        # bool() coerces python truthiness only — a traced predicate stays a
        # Boolean expression so pure lambdas push down into east-c
        def _pred(el, _idx):  # noqa: ANN001, ANN202
            r = predicate(el)
            return r if isinstance(r, KernelExpr) else bool(r)

        callback = EastFunction(_pred, [self.element_type, IntegerType], BooleanType)
        return _call_builtin("ArrayFilter", [self.element_type], [self, callback], ArrayType(self.element_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Transform and filter in one pass, keeping ``some`` results (east-c ArrayFilterMap).

        Args:
            fn: ``fn(element) -> some(value) | none``; the index is not passed.
                Elements mapped to ``none`` are dropped.
            out: Optional result element type. When omitted, it is inferred from
                the ``some`` payload of ``fn`` on the first element.

        Returns:
            A new array of the unwrapped ``some`` values; an empty input yields
            an empty array of element type ``out`` (or Null when omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType, VariantType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        t2 = out if out is not None else _ev.type_of(fn(self[0]).value)
        out_variant = VariantType([("none", NullType), ("some", t2)])
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], out_variant)
        return _call_builtin("ArrayFilterMap", [self.element_type, t2], [self, callback], ArrayType(t2))

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First ``some(value)`` that ``fn`` produces while scanning (east-c ArrayFirstMap).

        Args:
            fn: ``fn(element) -> some(value) | none``; the index is not passed.
                The scan stops at the first ``some``.
            out: Optional payload type for the result variant. When omitted, it
                is inferred from the ``some`` payload of ``fn`` on the first element.

        Returns:
            ``some(value)`` for the first matching element, else ``none``; an
            empty array yields ``none``.
        """
        from east.types.types import IntegerType, NullType, VariantType

        if len(self) == 0:
            t2 = out if out is not None else self.element_type
            return EastVariant("none", east_null)
        t2 = out if out is not None else _ev.type_of(fn(self[0]).value)
        out_variant = VariantType([("none", NullType), ("some", t2)])
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], out_variant)
        return _call_builtin("ArrayFirstMap", [self.element_type, t2], [self, callback], out_variant)

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Any:
        """Map each element then pairwise-combine the mapped values (east-c ArrayMapReduce).

        Args:
            map_fn: ``fn(element) -> mapped value``; the index is not passed.
            reduce_fn: ``fn(left, right) -> combined`` applied pairwise over the
                mapped values; it should be associative for a well-defined result.
            out: Optional type of the mapped/result value. When omitted, it is
                inferred from ``map_fn`` on the first element.

        Returns:
            The single reduced value.

        Raises:
            Errors on an empty array, since there is no identity value to
            return; guard with ``len`` if the array may be empty.
        """
        from east.types.types import IntegerType

        if len(self) == 0:
            raise ValueError("map_reduce on an empty array has no result (no identity element)")
        t2 = out if out is not None else _ev.type_of(map_fn(self[0]))
        map_cb = EastFunction(lambda el, idx: map_fn(el), [self.element_type, IntegerType], t2)
        reduce_cb = EastFunction(lambda a, b: reduce_fn(a, b), [t2, t2], t2)
        return _call_builtin("ArrayMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def fold(self, initial: Any, fn: Any) -> Any:
        """Left-fold the elements from ``initial`` (east-c ArrayFold).

        Args:
            initial: The starting accumulator; its type fixes the result type.
            fn: ``fn(accumulator, element) -> new accumulator``; applied
                left-to-right, the index is not passed.

        Returns:
            The final accumulator; ``initial`` itself for an empty array.
        """
        from east.types.types import IntegerType

        t2 = _ev.type_of(initial)
        callback = EastFunction(lambda acc, el, idx: fn(acc, el), [t2, self.element_type, IntegerType], t2)
        return _call_builtin("ArrayFold", [self.element_type, t2], [self, initial, callback], t2)

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Map each element to an array and concatenate the results (east-c ArrayFlattenToArray).

        Args:
            fn: ``fn(element) -> array``; the index is not passed.
            out: Optional element type of the inner arrays. When omitted, it is
                taken from the array ``fn`` returns for the first element.

        Returns:
            A new flat array; an empty input yields an empty array of element
            type ``out`` (or Null when omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        t2 = out if out is not None else fn(self[0]).element_type
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], ArrayType(t2))
        return _call_builtin("ArrayFlattenToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Map each element to a set and union the results (east-c ArrayFlattenToSet).

        Args:
            fn: ``fn(element) -> set``; the index is not passed.
            out: Optional element type of the inner sets. When omitted, it is
                taken from the set ``fn`` returns for the first element.

        Returns:
            A set of the distinct (East-equal) elements across all produced sets;
            an empty input yields an empty set.
        """
        from east.types.types import IntegerType, SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.element_type)
        k2 = out if out is not None else fn(self[0]).element_type
        callback = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], SetType(k2))
        return _call_builtin("ArrayFlattenToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> EastDict:
        """Map each element to a dict and merge the results (east-c ArrayFlattenToDict).

        Args:
            fn: ``fn(element) -> dict``; the index is not passed. The key and
                value types are sampled from the dict produced for the first element.
            combine: Optional ``fn(existing, incoming) -> value`` to resolve a
                shared key. Without it, the later value wins.

        Returns:
            A merged dict with East-ordered keys; an empty input yields an empty dict.
        """
        from east.types.types import DictType, IntegerType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sample = fn(self[0])
        k2 = sample.key_type
        t2 = sample.value_type
        map_cb = EastFunction(lambda el, idx: fn(el), [self.element_type, IntegerType], DictType(k2, t2))
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin("ArrayFlattenToDict", [self.element_type, k2, t2], [self, map_cb, combine_cb], DictType(k2, t2))

    def for_each(self, fn: Any) -> None:
        """Call ``fn`` once per element for its side effects (east-c ArrayForEach).

        Args:
            fn: ``fn(element) -> any``; the index is not passed and the return
                value is discarded.

        Returns:
            None.
        """
        from east.types.types import IntegerType, NullType

        callback = EastFunction(lambda el, idx: (fn(el), east_null)[1], [self.element_type, IntegerType], NullType)
        _call_builtin("ArrayForEach", [self.element_type, NullType], [self, callback], NullType)

    def group_by(self, key: Any) -> EastDict:
        """Group elements into a dict of arrays keyed by ``key(element)`` (east-c ArrayGroupFold).

        Args:
            key: ``fn(element) -> group key``; its result type, sampled on the
                first element, becomes the dict key type.

        Returns:
            A dict mapping each group key to an array of its elements, with keys
            in East total order.
        """
        from east.kernel import _append_kernel, _empty_array_kernel, try_push_down
        from east.types.types import ArrayType, DictType, IntegerType

        bucket_type = ArrayType(self.element_type)
        if len(self) == 0:
            return EastDict(self.element_type, bucket_type)
        k2 = _ev.type_of(key(self[0]))

        # ArrayGroupFold callbacks carry the element index: key(elem, idx),
        # init(group_key), fold(acc, elem, idx).
        key_cb = EastFunction(lambda el, _idx: key(el), [self.element_type, IntegerType], k2)

        # When the key traces to a native kernel, pair it with hand-built
        # init/append kernels so the whole grouping runs inside east-c (the
        # internal python init/append lambdas would otherwise trampoline
        # per element even with a native key).
        native_key = try_push_down(key_cb)
        if native_key is not None:
            return _call_builtin(
                "ArrayGroupFold",
                [self.element_type, k2, bucket_type],
                [self, native_key, _empty_array_kernel(k2, self.element_type),
                 _append_kernel(self.element_type)],
                DictType(k2, bucket_type),
            )

        def _append(acc: EastArray, el: Any, _idx: int) -> EastArray:
            acc.append(el)
            return acc

        init_cb = EastFunction(lambda _gk: EastArray(self.element_type, []), [k2], bucket_type)
        fold_cb = EastFunction(_append, [bucket_type, self.element_type, IntegerType], bucket_type)
        return _call_builtin(
            "ArrayGroupFold",
            [self.element_type, k2, bucket_type],
            [self, key_cb, init_cb, fold_cb],
            DictType(k2, bucket_type),
        )

    # ----- Reduction & group sugar (TS-expr parity; composes east-c builtins
    # with traced/hand-built native kernels — no python loops) ---------------

    def _numeric_zero(self, t: EastType) -> Any:
        if t.type == "Integer":
            return 0
        if t.type == "Float":
            return 0.0
        raise TypeError(f"expected a numeric (Integer/Float) type, got {t.type}")

    def sum(self, fn: Any = None) -> Any:
        """Sum of elements, or of ``fn(element)`` (native ArrayFold).

        Args:
            fn: Optional numeric projection; without it the elements must be
                Integer or Float.

        Returns:
            The total; the type's zero for an empty array.
        """
        from east.types.types import IntegerType

        if fn is None:
            t = self.element_type
            zero = self._numeric_zero(t)
            step = EastFunction(lambda acc, el, _i: acc + el, [t, t, IntegerType], t)
            return _call_builtin("ArrayFold", [t, t], [self, zero, step], t)
        t2 = _ev.type_of(fn(self[0])) if len(self) else self.element_type
        zero = self._numeric_zero(t2)
        step = EastFunction(
            lambda acc, el, _i: acc + fn(el), [t2, self.element_type, IntegerType], t2
        )
        return _call_builtin("ArrayFold", [self.element_type, t2], [self, zero, step], t2)

    def mean(self, fn: Any = None) -> float:
        """Arithmetic mean as a Float (NaN for an empty array, like TS).

        Args:
            fn: Optional numeric projection applied before averaging.
        """
        from east.kernel import KernelExpr
        from east.types.types import FloatType, IntegerType

        def _to_float(x: Any) -> Any:
            if isinstance(x, KernelExpr):
                return x.to_float() if x.east_type.type == "Integer" else x
            return float(x)

        proj = (lambda el: _to_float(fn(el))) if fn is not None else _to_float
        step = EastFunction(
            lambda acc, el, _i: acc + proj(el), [FloatType, self.element_type, IntegerType], FloatType
        )
        total = _call_builtin("ArrayFold", [self.element_type, FloatType], [self, 0.0, step], FloatType)
        n = len(self)
        return total / float(n) if n else float("nan")

    def maximum(self, by: Any = None) -> Any:
        """Largest element (or ``by``-projection) by East total order (native
        ArrayMapReduce). Raises on an empty array, like the TS ``maximum``.
        """
        from east.kernel import greatest
        from east.types.types import IntegerType

        t2 = (_ev.type_of(by(self[0])) if by is not None else self.element_type) if len(self) else self.element_type
        map_cb = EastFunction(
            (lambda el, _i: by(el)) if by is not None else (lambda el, _i: el),
            [self.element_type, IntegerType],
            t2,
        )
        reduce_cb = EastFunction(lambda a, b: greatest(a, b), [t2, t2], t2)
        return _call_builtin("ArrayMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def minimum(self, by: Any = None) -> Any:
        """Smallest element (or projection) by East total order; raises on empty."""
        from east.kernel import least
        from east.types.types import IntegerType

        t2 = (_ev.type_of(by(self[0])) if by is not None else self.element_type) if len(self) else self.element_type
        map_cb = EastFunction(
            (lambda el, _i: by(el)) if by is not None else (lambda el, _i: el),
            [self.element_type, IntegerType],
            t2,
        )
        reduce_cb = EastFunction(lambda a, b: least(a, b), [t2, t2], t2)
        return _call_builtin("ArrayMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def find_maximum(self, by: Any = None) -> Any:
        """Index of the first maximum as ``some(index)``, ``none`` when empty."""
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        if len(self) == 0:
            return _none
        target = self.maximum(by)
        return _some(self.find_first(target, key=by).unwrap("some")) if by is not None else _some(
            self.find_first(target).unwrap("some")
        )

    def find_minimum(self, by: Any = None) -> Any:
        """Index of the first minimum as ``some(index)``, ``none`` when empty."""
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        if len(self) == 0:
            return _none
        target = self.minimum(by)
        return _some(self.find_first(target, key=by).unwrap("some")) if by is not None else _some(
            self.find_first(target).unwrap("some")
        )

    def _first_map_bool(self, want: bool, pred: Any) -> bool:
        """Shared native short-circuit scan: some(True) on the deciding element."""
        from east.kernel import KernelExpr, where
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import BooleanType, IntegerType, NullType, VariantType

        def _probe(el, _i):  # noqa: ANN001, ANN202
            r = pred(el)
            decided = (r if isinstance(r, KernelExpr) else bool(r)) if want else (
                ~r if isinstance(r, KernelExpr) else not bool(r)
            )
            if isinstance(decided, KernelExpr):
                return where(decided, _some(True), _none)
            return _some(True) if decided else _none

        out_variant = VariantType([("none", NullType), ("some", BooleanType)])
        callback = EastFunction(_probe, [self.element_type, IntegerType], out_variant)
        result = _call_builtin(
            "ArrayFirstMap", [self.element_type, BooleanType], [self, callback], out_variant
        )
        return result.type == "some"

    def every(self, pred: Any = None) -> bool:
        """True when ``pred`` holds for all elements (native short-circuiting
        ArrayFirstMap scan, like TS). Without ``pred`` the elements must be
        Booleans. True for an empty array.
        """
        if pred is None:
            if self.element_type.type != "Boolean":
                raise TypeError("every() without a predicate needs Boolean elements")
            pred = lambda el: el  # noqa: E731
        return not self._first_map_bool(False, pred)

    def some(self, pred: Any = None) -> bool:
        """True when ``pred`` holds for any element (native short-circuit).

        Without ``pred`` the elements must be Booleans. False when empty.
        """
        if pred is None:
            if self.element_type.type != "Boolean":
                raise TypeError("some() without a predicate needs Boolean elements")
            pred = lambda el: el  # noqa: E731
        return self._first_map_bool(True, pred)

    def find_all(self, value: Any, by: Any = None) -> EastArray:
        """Indices whose element (or projection) equals ``value`` (native
        ArrayFilterMap), in order.
        """
        from east.kernel import KernelExpr, where
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import ArrayType, IntegerType, NullType, VariantType

        proj = by if by is not None else (lambda el: el)

        def _probe(el, i):  # noqa: ANN001, ANN202
            r = proj(el) == value
            if isinstance(r, KernelExpr):
                return where(r, _some(i), _none)
            return _some(i) if r else _none

        out_variant = VariantType([("none", NullType), ("some", IntegerType)])
        callback = EastFunction(_probe, [self.element_type, IntegerType], out_variant)
        return _call_builtin(
            "ArrayFilterMap", [self.element_type, IntegerType], [self, callback], ArrayType(IntegerType)
        )

    def group_reduce(self, key: Any, init: Any, fold: Any) -> EastDict:
        """General grouped reduction (native ArrayGroupFold): a dict from
        ``key(element)`` to ``fold``-accumulated values starting at
        ``init(group_key)``.

        Args:
            key: ``key(element) -> group key``.
            init: ``init(group_key) -> initial accumulator``.
            fold: ``fold(acc, element) -> new accumulator``.
        """
        from east.types.types import DictType, IntegerType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        k2 = _ev.type_of(key(self[0]))
        a_t = _ev.type_of(init(key(self[0])))
        key_cb = EastFunction(lambda el, _i: key(el), [self.element_type, IntegerType], k2)
        init_cb = EastFunction(init, [k2], a_t)
        fold_cb = EastFunction(
            lambda acc, el, _i: fold(acc, el), [a_t, self.element_type, IntegerType], a_t
        )
        return _call_builtin(
            "ArrayGroupFold",
            [self.element_type, k2, a_t],
            [self, key_cb, init_cb, fold_cb],
            DictType(k2, a_t),
        )

    def group_size(self, key: Any = None) -> EastDict:
        """Count per group key (native; identity key when omitted)."""
        return self.to_dict(
            key if key is not None else (lambda el: el),
            value=lambda _el: 1,
            combine=lambda a, b: a + b,
        )

    def group_sum(self, key: Any, fn: Any = None) -> EastDict:
        """Sum per group (of elements, or of ``fn(element)``)."""
        if fn is None:
            t2 = self.element_type
        else:
            t2 = _ev.type_of(fn(self[0])) if len(self) else self.element_type
        zero = self._numeric_zero(t2)
        proj = fn if fn is not None else (lambda el: el)
        return self.group_reduce(key, lambda _k: zero, lambda acc, el: acc + proj(el))

    def group_mean(self, key: Any, fn: Any = None) -> EastDict:
        """Float mean per group (sum and count both computed natively)."""
        from east.kernel import KernelExpr

        def _to_float(x: Any) -> Any:
            if isinstance(x, KernelExpr):
                return x.to_float() if x.east_type.type == "Integer" else x
            return float(x)

        proj = (lambda el: _to_float(fn(el))) if fn is not None else _to_float
        sums = self.group_reduce(key, lambda _k: 0.0, lambda acc, el: acc + proj(el))
        counts = self.group_size(key)
        return sums.to_dict(
            lambda k, _v: k, lambda k, v: v / float(counts[k]), lambda _a, b, _k: b
        )

    def _group_extreme(self, key: Any, by: Any, pick: Any) -> EastDict:
        from east.kernel import _none_init_kernel
        from east.types.construct import some as _some
        from east.types.types import DictType, IntegerType, OptionType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        proj = by if by is not None else (lambda el: el)
        k2 = _ev.type_of(key(self[0]))
        p_t = _ev.type_of(proj(self[0]))
        opt_t = OptionType(p_t)
        key_cb = EastFunction(lambda el, _i: key(el), [self.element_type, IntegerType], k2)
        fold_cb = EastFunction(
            lambda acc, el, _i: _some(pick(_opt_unwrap_or(acc, proj(el)), proj(el))),
            [opt_t, self.element_type, IntegerType],
            opt_t,
        )
        grouped = _call_builtin(
            "ArrayGroupFold",
            [self.element_type, k2, opt_t],
            [self, key_cb, _none_init_kernel(k2, p_t), fold_cb],
            DictType(k2, opt_t),
        )
        return grouped.map(lambda v: v.unwrap("some"), out=p_t)

    def group_maximum(self, key: Any, by: Any = None) -> EastDict:
        """Largest element/projection per group (East total order, native)."""
        from east.kernel import greatest

        return self._group_extreme(key, by, greatest)

    def group_minimum(self, key: Any, by: Any = None) -> EastDict:
        """Smallest element/projection per group (East total order, native)."""
        from east.kernel import least

        return self._group_extreme(key, by, least)

    def group_every(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for all members (native)."""
        return self.group_reduce(key, lambda _k: True, lambda acc, el: acc & pred(el))

    def group_some(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for any member (native)."""
        return self.group_reduce(key, lambda _k: False, lambda acc, el: acc | pred(el))

    def _group_pairs(self, key: Any, value: Any, extra: Any = None) -> tuple:
        from east.types.types import IntegerType, StructType

        k_s = key(self[0])
        v_s = value(self[0])
        if extra is None:
            pair_t = StructType([("k", _ev.type_of(k_s)), ("v", _ev.type_of(v_s))])
            pair_cb = EastFunction(
                lambda el, _i: {"k": key(el), "v": value(el)},
                [self.element_type, IntegerType],
                pair_t,
            )
        else:
            pair_t = StructType(
                [("k", _ev.type_of(k_s)), ("k2", _ev.type_of(extra(self[0]))), ("v", _ev.type_of(v_s))]
            )
            pair_cb = EastFunction(
                lambda el, _i: {"k": key(el), "k2": extra(el), "v": value(el)},
                [self.element_type, IntegerType],
                pair_t,
            )
        from east.types.types import ArrayType

        pairs = _call_builtin(
            "ArrayMap", [self.element_type, pair_t], [self, pair_cb], ArrayType(pair_t)
        )
        return pairs, pair_t

    def group_to_arrays(self, key: Any, value: Any = None) -> EastDict:
        """Arrays of ``value(element)`` per group key (native throughout).

        Without ``value`` this is ``group_by``.
        """
        from east.kernel import _append_field_kernel, _empty_array_kernel
        from east.types.types import ArrayType, DictType, IntegerType

        if value is None:
            return self.group_by(key)
        if len(self) == 0:
            return EastDict(self.element_type, ArrayType(self.element_type))
        pairs, pair_t = self._group_pairs(key, value)
        k2 = next(f["type"] for f in pair_t.value if f["name"] == "k")
        v_t = next(f["type"] for f in pair_t.value if f["name"] == "v")
        key_cb = EastFunction(lambda p, _i: p["k"], [pair_t, IntegerType], k2)
        return _call_builtin(
            "ArrayGroupFold",
            [pair_t, k2, ArrayType(v_t)],
            [pairs, key_cb, _empty_array_kernel(k2, v_t), _append_field_kernel(pair_t, "v")],
            DictType(k2, ArrayType(v_t)),
        )

    def group_to_sets(self, key: Any, value: Any = None) -> EastDict:
        """Sets of ``value(element)`` per group key (native throughout)."""
        from east.kernel import _empty_set_kernel, _set_insert_field_kernel
        from east.types.types import DictType, IntegerType, SetType

        if len(self) == 0:
            return EastDict(self.element_type, SetType(self.element_type))
        pairs, pair_t = self._group_pairs(key, value if value is not None else (lambda el: el))
        k2 = next(f["type"] for f in pair_t.value if f["name"] == "k")
        v_t = next(f["type"] for f in pair_t.value if f["name"] == "v")
        key_cb = EastFunction(lambda p, _i: p["k"], [pair_t, IntegerType], k2)
        return _call_builtin(
            "ArrayGroupFold",
            [pair_t, k2, SetType(v_t)],
            [pairs, key_cb, _empty_set_kernel(k2, v_t), _set_insert_field_kernel(pair_t, "v")],
            DictType(k2, SetType(v_t)),
        )

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None, combine: Any = None) -> EastDict:
        """Dicts of ``key2 -> value`` per group key.

        Without ``combine`` a duplicate inner key errors (TS parity); with it,
        collisions resolve as ``combine(existing, incoming)`` (the collision
        handling runs per inner insert on the python path).
        """
        from east.kernel import _dict_insert_fields_kernel, _empty_dict_kernel
        from east.types.types import DictType, IntegerType

        if len(self) == 0:
            return EastDict(self.element_type, DictType(self.element_type, self.element_type))
        val = value if value is not None else (lambda el: el)
        pairs, pair_t = self._group_pairs(key, val, extra=key2)
        k1 = next(f["type"] for f in pair_t.value if f["name"] == "k")
        k2t = next(f["type"] for f in pair_t.value if f["name"] == "k2")
        v_t = next(f["type"] for f in pair_t.value if f["name"] == "v")
        key_cb = EastFunction(lambda p, _i: p["k"], [pair_t, IntegerType], k1)
        if combine is None:
            return _call_builtin(
                "ArrayGroupFold",
                [pair_t, k1, DictType(k2t, v_t)],
                [pairs, key_cb, _empty_dict_kernel(k1, k2t, v_t),
                 _dict_insert_fields_kernel(pair_t, "k2", "v")],
                DictType(k1, DictType(k2t, v_t)),
            )

        def _fold(acc: EastDict, p: Any, _i: Any) -> EastDict:
            acc.insert_or_update(p["k2"], p["v"], lambda ex, inc, _key: combine(ex, inc))
            return acc

        init_cb = _empty_dict_kernel(k1, k2t, v_t)
        fold_cb = EastFunction(_fold, [DictType(k2t, v_t), pair_t, IntegerType], DictType(k2t, v_t))
        return _call_builtin(
            "ArrayGroupFold",
            [pair_t, k1, DictType(k2t, v_t)],
            [pairs, key_cb, init_cb, fold_cb],
            DictType(k1, DictType(k2t, v_t)),
        )

    def string_join(self, separator: str) -> str:
        """Join an Array<String> into one string (east-c ArrayStringJoin).

        Args:
            separator: String placed between consecutive elements.

        Returns:
            The concatenated string.
        """
        from east.types.types import StringType

        return _call_builtin("ArrayStringJoin", [], [self, separator], StringType)

    # ----- Columnar interop (one crossing per column, not per row × field) ---

    def to_columns(self, fields: list[str] | None = None) -> dict[str, Any]:
        """Struct-of-arrays view of an Array<Struct>: ``{field: column}``.

        One C↔python crossing per column instead of per row × field:
        Float/Integer/Boolean columns come back as numpy arrays filled in C
        (``Option<Float>`` becomes float64 with NaN for none), String columns
        as interned python lists, and any other field type as a list of boxed
        values. Transform with vectorised numpy, then rebuild with
        ``EastArray.from_columns``.

        Args:
            fields: Optional subset of field names to extract; all fields
                when omitted.

        Returns:
            Dict mapping field name to its column (ndarray or list).
        """
        return _proxy_cls("_array_to_columns")(
            self._c_ptr, self._c_elem_type_ptr, fields, 0, -1
        )

    @staticmethod
    def from_columns(element_type: EastType, columns: dict[str, Any]) -> EastArray:
        """Build a C-backed Array<Struct> from equal-length columns in one pass.

        The inverse of ``to_columns``: float64/int64/bool numpy columns write
        through raw buffers (float64 with NaN maps to ``none`` for
        ``Option<Float>`` fields); other columns convert per cell.

        Args:
            element_type: The ``StructType`` of each row; every field must
                have a matching column.
            columns: Field name → sequence (numpy array or list), all the
                same length.

        Returns:
            A new C-backed array of ``element_type`` rows.
        """
        return _proxy_cls("_array_from_columns")(element_type, dict(columns))

    def map_batches(
        self,
        fn: Callable[[dict[str, Any]], dict[str, Any]],
        out: EastType | None = None,
        batch_size: int = 100_000,
    ) -> EastArray:
        """Transform in columnar batches: python sees columns, not rows.

        Slices the array into batches of ``batch_size`` rows, hands ``fn`` a
        columnar dict per batch (as ``to_columns``), and rebuilds the results
        (as ``from_columns``) into one output array — amortising the
        C↔python boundary to O(columns × batches) crossings where per-row
        callbacks pay O(rows × fields). ``fn`` may change the number of rows
        per batch (filter-like) but must return equal-length columns.

        Args:
            fn: ``fn(columns: dict) -> dict`` of output columns.
            out: Element type of the result rows; the input element type
                when omitted.
            batch_size: Rows per batch (default 100_000).

        Returns:
            A new array of ``out`` rows across all batches.
        """
        out_type = out if out is not None else self.element_type
        to_cols = _proxy_cls("_array_to_columns")
        extend = _proxy_cls("_array_extend_bulk")
        n = len(self)
        result: EastArray | None = None
        start = 0
        while start < n or result is None:
            stop = min(start + batch_size, n)
            cols = to_cols(self._c_ptr, self._c_elem_type_ptr, None, start, stop)
            part = EastArray.from_columns(out_type, fn(cols))
            if result is None:
                result = part
            else:
                extend(result._c_ptr, result._c_elem_type_ptr, part, True)
            start = stop
            if n == 0:
                break
        return result

    def extend(self, values: Iterable[T]) -> None:
        """Append many elements in one crossing (east-c bulk push).

        Fast paths: another East array of the same element type copies
        C-to-C with no boxing; float64/int64/bool numpy arrays convert
        through raw buffers. Other iterables marshal per item inside the
        single call. Replaces MutableSequence's per-item append loop.

        Args:
            values: Iterable of elements (EastArray, numpy array, or any
                python sequence).
        """
        self._check_not_iterating()
        allow_c_copy = isinstance(values, EastArray) and values.element_type == self.element_type
        _proxy_cls("_array_extend_bulk")(
            self._c_ptr, self._c_elem_type_ptr, values, allow_c_copy
        )

    @classmethod
    def generate(cls, count: int, fn: Any, element_type: EastType | None = None) -> EastArray:
        """Build an array by calling ``fn`` for each index (east-c ArrayGenerate).

        Args:
            count: Number of elements to produce.
            fn: ``fn(index) -> element`` for index ``0 .. count-1``.
            element_type: Optional element type. When omitted, it is inferred
                from ``fn(0)``.

        Returns:
            A new array of length ``count``; ``count == 0`` yields an empty array
            of element type ``element_type`` (or Null when omitted).
        """
        from east.types.types import ArrayType, IntegerType, NullType

        n = int(count)
        if n == 0:
            return cls(element_type if element_type is not None else NullType, [])
        t = element_type if element_type is not None else _ev.type_of(fn(0))
        callback = EastFunction(fn, [IntegerType], t)
        return _call_builtin("ArrayGenerate", [t], [n, callback], ArrayType(t))

    @classmethod
    def range(cls, start: int, end: int, step: int = 1) -> EastArray:
        """Array of integers over the half-open range ``[start, end)`` (east-c ArrayRange).

        Args:
            start: Inclusive first value.
            end: Exclusive bound.
            step: Increment between consecutive values (default 1).

        Returns:
            An Array<Integer> of the stepped values.
        """
        from east.types.types import ArrayType, IntegerType

        return _call_builtin("ArrayRange", [], [int(start), int(end), int(step)], ArrayType(IntegerType))

    @classmethod
    def linspace(cls, start: float, end: float, count: int) -> EastArray:
        """``count`` evenly spaced Floats from ``start`` to ``end`` inclusive (east-c ArrayLinspace).

        Args:
            start: First value.
            end: Last value.
            count: Number of points to generate.

        Returns:
            An Array<Float> of the evenly spaced values.
        """
        from east.types.types import ArrayType, FloatType

        return _call_builtin("ArrayLinspace", [], [float(start), float(end), int(count)], ArrayType(FloatType))

    def __repr__(self) -> str:
        """Return East text format representation."""
        if len(self) == 0:
            return "[]"
        items = ", ".join(repr(item) for item in self)
        return f"[{items}]"


# =============================================================================
# EastSet - Sorted unique collection
# =============================================================================


class EastSet(Generic[T]):
    """East set with element type tracking.

    Sets are mutable, sorted collections of unique elements.
    Elements are sorted using East's total ordering.

    Generic type parameter T is for static type hints only (e.g., EastSet[str]).
    At runtime, element_type provides the actual East type.
    """

    __slots__ = ("element_type", "_iteration_lock")

    def __new__(cls, *args, **kwargs):  # noqa: ARG004 — Python forwards constructor args here; the proxy __init__ consumes them
        # EastSet(element_type, items) constructs a live C-backed proxy from birth
        # — one representation, no Python store. Returning an EastSetProxy makes
        # Python run EastSetProxy.__init__, which allocates the east-c set and
        # bulk-inserts. The element ops (add/remove/has/iter/len/clear) and equality
        # all live on the proxy. Subclasses (and _wrap) construct normally.
        if cls is EastSet:
            return object.__new__(_proxy_cls("EastSetProxy"))
        return object.__new__(cls)

    def _lock_for_iteration(self) -> None:
        """Lock set for iteration (prevents modifications)."""
        self._iteration_lock += 1

    def _unlock_for_iteration(self) -> None:
        """Unlock set after iteration."""
        self._iteration_lock -= 1

    def _check_not_iterating(self) -> None:
        """Check if set is being iterated and raise error if so."""
        if self._iteration_lock > 0:
            raise RuntimeError("Cannot modify Set during iteration")

    # Membership/len/iter and the in-place mutators are implemented by
    # EastSetProxy against the live east-c set; declared here so EastSet reads as
    # a concrete collection to static checkers — the proxy overrides each at runtime.
    def __contains__(self, item: Any) -> bool:
        raise NotImplementedError

    def __len__(self) -> int:
        raise NotImplementedError

    def __iter__(self) -> Any:
        raise NotImplementedError

    def add(self, value: Any) -> None:
        raise NotImplementedError

    def discard(self, value: Any) -> None:
        raise NotImplementedError

    def remove(self, value: Any) -> None:
        raise NotImplementedError

    def clear(self) -> None:
        raise NotImplementedError

    # ----- Eager value methods (delegate to east-c; results are live values) ---

    @staticmethod
    def generate(n: int, fn: Any, element_type: EastType | None = None) -> EastSet:
        """Build a set from ``fn(i)`` over ``i`` in ``[0, n)`` (east-c SetGenerate).

        Args:
            n: Number of indices to apply ``fn`` to; ``0`` yields an empty set.
            fn: ``fn(index) -> element``; duplicate elements collapse into one.
            element_type: Pins the element type. When omitted it is inferred by
                sampling ``fn(0)``.

        Returns:
            A new set of the distinct ``fn(i)`` values, in East total order.
        """
        from east.types.types import IntegerType, NullType, SetType

        if int(n) == 0:
            return EastSet(element_type if element_type is not None else NullType)
        k = element_type if element_type is not None else _ev.type_of(fn(0))
        gen = EastFunction(fn, [IntegerType], k)
        side = EastFunction(lambda el: east_null, [k], NullType)
        return _call_builtin("SetGenerate", [k], [int(n), gen, side], SetType(k))

    def has(self, value: Any) -> bool:
        """Whether ``value`` is a member (east-c SetHas, via the live value on a proxy).

        A traced ``value`` emits IR against this set as a constant (#393).
        """
        if _is_traced(value):
            return _lift_traced(self).has(value)
        return value in self

    def insert(self, value: Any) -> None:
        """Add ``value`` in place (east-c SetInsert)."""
        self.add(value)

    def delete(self, value: Any) -> None:
        """Remove ``value`` in place if present (east-c SetDelete)."""
        self.discard(value)

    def union(self, other: EastSet) -> EastSet:
        """Set union as a new set (east-c SetUnion)."""
        return self._set_op("SetUnion", other)

    def intersect(self, other: EastSet) -> EastSet:
        """Set intersection as a new set (east-c SetIntersect)."""
        return self._set_op("SetIntersect", other)

    def diff(self, other: EastSet) -> EastSet:
        """Set difference (elements in self but not ``other``) as a new set (east-c SetDiff)."""
        return self._set_op("SetDiff", other)

    def sym_diff(self, other: EastSet) -> EastSet:
        """Symmetric difference (elements in exactly one set) as a new set (east-c SetSymDiff)."""
        return self._set_op("SetSymDiff", other)

    def _set_op(self, name: str, other: EastSet) -> EastSet:
        from east.types.types import SetType

        return _call_builtin(name, [self.element_type], [self, other], SetType(self.element_type))

    def union_in_place(self, other: EastSet) -> None:
        """Add every element of ``other`` to self in place (east-c SetUnionInPlace)."""
        from east.types.types import NullType

        self._check_not_iterating()
        _call_builtin("SetUnionInPlace", [self.element_type], [self, other], NullType)

    def try_insert(self, value: Any) -> bool:
        """Insert ``value`` in place, reporting whether it was new (east-c SetTryInsert).

        Args:
            value: The element to add; its type must match the set's element type.

        Returns:
            ``True`` if ``value`` was newly added, ``False`` if it was already present.
        """
        from east.types.types import BooleanType

        self._check_not_iterating()
        return _call_builtin("SetTryInsert", [self.element_type], [self, value], BooleanType)

    def try_delete(self, value: Any) -> bool:
        """Delete ``value`` in place, reporting whether it was present (east-c SetTryDelete).

        Args:
            value: The element to remove; its type must match the set's element type.

        Returns:
            ``True`` if ``value`` was present and removed, ``False`` if it was absent.
        """
        from east.types.types import BooleanType

        self._check_not_iterating()
        return _call_builtin("SetTryDelete", [self.element_type], [self, value], BooleanType)

    def is_subset(self, other: EastSet) -> bool:
        """Whether every element of self is also in ``other`` (east-c SetIsSubset)."""
        from east.types.types import BooleanType

        return _call_builtin("SetIsSubset", [self.element_type], [self, other], BooleanType)

    def is_disjoint(self, other: EastSet) -> bool:
        """Whether self and ``other`` share no elements (east-c SetIsDisjoint)."""
        from east.types.types import BooleanType

        return _call_builtin("SetIsDisjoint", [self.element_type], [self, other], BooleanType)

    def copy(self) -> EastSet:
        """An independent copy of the set (east-c SetCopy)."""
        from east.types.types import SetType

        return _call_builtin("SetCopy", [self.element_type], [self], SetType(self.element_type))

    def for_each(self, fn: Any) -> None:
        """Call ``fn(element)`` for each element, for side effects only (east-c SetForEach).

        Args:
            fn: ``fn(element)``; its return value is discarded.
        """
        from east.types.types import NullType

        callback = EastFunction(lambda el: (fn(el), east_null)[1], [self.element_type], NullType)
        _call_builtin("SetForEach", [self.element_type, NullType], [self, callback], NullType)

    def to_array(self, key: Any = None) -> EastArray:
        """Elements as an array in East total order (east-c SetToArray).

        Args:
            key: Optional ``key(element) -> value`` projecting each element; when
                omitted the elements themselves are returned. The result element
                type is inferred by sampling ``key`` on the first element.

        Returns:
            A new array of the (projected) elements, ordered by East total order.
        """
        from east.types.types import ArrayType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda el: el, [self.element_type], t2)
        elif len(self) == 0:
            return EastArray(self.element_type, [])
        else:
            t2 = _ev.type_of(key(next(iter(self))))
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("SetToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    def to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Set of ``fn(element)`` over all elements (east-c SetToSet).

        Args:
            fn: ``fn(element) -> new element``; collisions in the result collapse.
            out: Pins the result element type; otherwise inferred by sampling
                ``fn`` on the first element.

        Returns:
            A new set of the distinct mapped values.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.element_type)
        k2 = out if out is not None else _ev.type_of(fn(next(iter(self))))
        callback = EastFunction(fn, [self.element_type], k2)
        return _call_builtin("SetToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def to_dict(self, key: Any, value: Any, combine: Any = None) -> EastDict:
        """Build a dict keyed by ``key(element)`` with ``value(element)`` (east-c SetToDict).

        Args:
            key: ``key(element) -> dict key``; key and value types are inferred by
                sampling the first element.
            value: ``value(element) -> dict value``.
            combine: On a key collision, ``combine(existing, incoming, key) -> value``
                decides the kept value; without ``combine`` the later element wins.

        Returns:
            A new dict keyed by the projected keys.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sample = next(iter(self))
        k2 = _ev.type_of(key(sample))
        t2 = _ev.type_of(value(sample))
        key_cb = EastFunction(key, [self.element_type], k2)
        value_cb = EastFunction(value, [self.element_type], t2)
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2, k)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin(
            "SetToDict", [self.element_type, k2, t2], [self, key_cb, value_cb, combine_cb], DictType(k2, t2)
        )

    def map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Map each element to a value, keyed by the element itself (east-c SetMap → Dict).

        Args:
            fn: ``fn(element) -> value``; the value type is inferred by sampling
                ``fn`` on the first element unless ``out`` is given.
            out: Pins the result value type.

        Returns:
            A new dict from each element to its mapped value.
        """
        from east.types.types import DictType

        if len(self) == 0:
            t2 = out if out is not None else self.element_type
            return EastDict(self.element_type, t2)
        t2 = out if out is not None else _ev.type_of(fn(next(iter(self))))
        callback = EastFunction(fn, [self.element_type], t2)
        return _call_builtin("SetMap", [self.element_type, t2], [self, callback], DictType(self.element_type, t2))

    def filter(self, predicate: Any) -> EastSet:
        """Keep elements satisfying ``predicate`` (east-c SetFilter).

        Args:
            predicate: ``predicate(element) -> bool``.

        Returns:
            A new set of the elements for which ``predicate`` is true.
        """
        from east.kernel import KernelExpr
        from east.types.types import BooleanType, SetType

        def _pred(el):  # noqa: ANN001, ANN202
            r = predicate(el)
            return r if isinstance(r, KernelExpr) else bool(r)

        callback = EastFunction(_pred, [self.element_type], BooleanType)
        return _call_builtin("SetFilter", [self.element_type], [self, callback], SetType(self.element_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Map then keep ``some`` results, keyed by the element (east-c SetFilterMap → Dict).

        Args:
            fn: ``fn(element) -> some(value) | none``; ``some`` keeps the element
                with that value, ``none`` drops it. The value type is inferred from
                the ``some`` payload by sampling the first element unless ``out`` is given.
            out: Pins the result value type.

        Returns:
            A new dict from each kept element to its unwrapped value.
        """
        from east.types.types import DictType, OptionType

        if len(self) == 0:
            v2 = out if out is not None else self.element_type
            return EastDict(self.element_type, v2)
        if out is not None:
            v2 = out
        else:
            sampled = _ev.type_of(fn(next(iter(self))))
            from east.types.types import get_option_inner_type

            v2 = get_option_inner_type(sampled)
        callback = EastFunction(fn, [self.element_type], OptionType(v2))
        return _call_builtin(
            "SetFilterMap", [self.element_type, v2], [self, callback], DictType(self.element_type, v2)
        )

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First ``some(value)`` produced by ``fn`` over elements, else ``none`` (east-c SetFirstMap).

        Elements are visited in East total order, so the result is deterministic.

        Args:
            fn: ``fn(element) -> some(value) | none``; the value type is inferred
                from the ``some`` payload by sampling the first element unless ``out`` is given.
            out: Pins the ``some`` payload type.

        Returns:
            ``some(value)`` for the first element that yields one, otherwise ``none``.
        """
        from east.types.types import OptionType

        if len(self) == 0:
            return EastVariant("none", east_null)
        if out is not None:
            t2 = out
        else:
            from east.types.types import get_option_inner_type

            t2 = get_option_inner_type(_ev.type_of(fn(next(iter(self)))))
        callback = EastFunction(fn, [self.element_type], OptionType(t2))
        return _call_builtin("SetFirstMap", [self.element_type, t2], [self, callback], OptionType(t2))

    def map_reduce(self, fn: Any, reduce: Any) -> Any:
        """Map each element then combine the results pairwise (east-c SetMapReduce).

        Args:
            fn: ``fn(element) -> value``; the value/result type is inferred by
                sampling ``fn`` on the first element.
            reduce: ``reduce(a, b) -> combined`` folding the mapped values together.

        Returns:
            The single combined value.

        Raises:
            ValueError: If the set is empty (the operation has no identity element).
        """
        if len(self) == 0:
            raise ValueError("map_reduce on an empty set has no result (no identity element)")
        sample = next(iter(self))
        t2 = _ev.type_of(fn(sample))
        map_cb = EastFunction(fn, [self.element_type], t2)
        reduce_cb = EastFunction(lambda a, b: reduce(a, b), [t2, t2], t2)
        return _call_builtin("SetMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def reduce(self, initial: Any, fn: Any) -> Any:
        """Fold over elements from a seed accumulator (east-c SetReduce).

        Elements are visited in East total order.

        Args:
            initial: Seed accumulator; its type fixes the accumulator/result type.
            fn: ``fn(acc, element) -> new acc`` applied for each element.

        Returns:
            The final accumulator.
        """
        t2 = _ev.type_of(initial)
        callback = EastFunction(lambda acc, el: fn(acc, el), [t2, self.element_type], t2)
        return _call_builtin("SetReduce", [self.element_type, t2], [self, callback, initial], t2)

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Concatenate the arrays returned by ``fn`` over all elements (east-c SetFlattenToArray).

        Args:
            fn: ``fn(element) -> array``; the result element type is inferred from
                that array's element type by sampling the first element unless
                ``out`` is given.
            out: Pins the result element type.

        Returns:
            A new array concatenating each element's array, in East element order.
        """
        from east.types.types import ArrayType

        if len(self) == 0:
            return EastArray(out if out is not None else self.element_type, [])
        t2 = out if out is not None else _ev.type_of(fn(next(iter(self)))).element_type
        callback = EastFunction(fn, [self.element_type], ArrayType(t2))
        return _call_builtin("SetFlattenToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Union the sets returned by ``fn`` over all elements (east-c SetFlattenToSet).

        Args:
            fn: ``fn(element) -> set``; the result element type is inferred from
                that set's element type by sampling the first element unless
                ``out`` is given.
            out: Pins the result element type.

        Returns:
            A new set of the distinct elements across every produced set.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.element_type)
        k2 = out if out is not None else _ev.type_of(fn(next(iter(self)))).element_type
        callback = EastFunction(fn, [self.element_type], SetType(k2))
        return _call_builtin("SetFlattenToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> EastDict:
        """Merge the dicts returned by ``fn`` over all elements (east-c SetFlattenToDict).

        Key and value types are inferred from the dict produced for the first element.

        Args:
            fn: ``fn(element) -> dict`` whose entries are merged into the result.
            combine: On a shared key, ``combine(existing, incoming, key) -> value``
                decides the kept value; without ``combine`` the later element's value wins.

        Returns:
            A new dict merging every produced dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sampled = _ev.type_of(fn(next(iter(self))))
        k2 = sampled.key_type
        t2 = sampled.value_type
        callback = EastFunction(fn, [self.element_type], DictType(k2, t2))
        combine_cb = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2, k)),
            [t2, t2, k2],
            t2,
        )
        return _call_builtin(
            "SetFlattenToDict", [self.element_type, k2, t2], [self, callback, combine_cb], DictType(k2, t2)
        )

    def sum(self, fn: Any = None) -> Any:
        """Sum of elements or of ``fn(element)`` (native SetReduce)."""
        if fn is None:
            t2 = self.element_type
        else:
            t2 = _ev.type_of(fn(next(iter(self)))) if len(self) else self.element_type
        if t2.type == "Integer":
            zero: Any = 0
        elif t2.type == "Float":
            zero = 0.0
        else:
            raise TypeError(f"expected a numeric (Integer/Float) type, got {t2.type}")
        proj = fn if fn is not None else (lambda el: el)
        step = EastFunction(lambda acc, el: acc + proj(el), [t2, self.element_type], t2)
        return _call_builtin("SetReduce", [self.element_type, t2], [self, step, zero], t2)

    def mean(self, fn: Any = None) -> float:
        """Float mean of elements/projections (NaN when empty, like TS)."""
        from east.kernel import KernelExpr
        from east.types.types import FloatType

        def _to_float(x: Any) -> Any:
            if isinstance(x, KernelExpr):
                return x.to_float() if x.east_type.type == "Integer" else x
            return float(x)

        proj = (lambda el: _to_float(fn(el))) if fn is not None else _to_float
        step = EastFunction(lambda acc, el: acc + proj(el), [FloatType, self.element_type], FloatType)
        total = _call_builtin("SetReduce", [self.element_type, FloatType], [self, step, 0.0], FloatType)
        n = len(self)
        return total / float(n) if n else float("nan")

    def _first_map_bool(self, want: bool, pred: Any) -> bool:
        from east.kernel import KernelExpr, where
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import BooleanType, NullType, VariantType

        def _probe(el):  # noqa: ANN001, ANN202
            r = pred(el)
            decided = (r if isinstance(r, KernelExpr) else bool(r)) if want else (
                ~r if isinstance(r, KernelExpr) else not bool(r)
            )
            if isinstance(decided, KernelExpr):
                return where(decided, _some(True), _none)
            return _some(True) if decided else _none

        out_variant = VariantType([("none", NullType), ("some", BooleanType)])
        callback = EastFunction(_probe, [self.element_type], out_variant)
        result = _call_builtin(
            "SetFirstMap", [self.element_type, BooleanType], [self, callback], out_variant
        )
        return result.type == "some"

    def every(self, pred: Any = None) -> bool:
        """True when ``pred`` holds for all members (native short-circuit);
        Boolean elements when omitted; True when empty."""
        if pred is None:
            if self.element_type.type != "Boolean":
                raise TypeError("every() without a predicate needs Boolean elements")
            pred = lambda el: el  # noqa: E731
        return not self._first_map_bool(False, pred)

    def some(self, pred: Any = None) -> bool:
        """True when ``pred`` holds for any member (native short-circuit)."""
        if pred is None:
            if self.element_type.type != "Boolean":
                raise TypeError("some() without a predicate needs Boolean elements")
            pred = lambda el: el  # noqa: E731
        return self._first_map_bool(True, pred)

    def group_size(self, key: Any) -> EastDict:
        """Count per group key (native)."""
        return self.to_dict(key, lambda _el: 1, combine=lambda a, b, _k: a + b)

    def group_sum(self, key: Any, fn: Any = None) -> EastDict:
        """Sum per group (native SetGroupFold)."""
        proj = fn if fn is not None else (lambda el: el)
        t2 = _ev.type_of(proj(next(iter(self)))) if len(self) else self.element_type
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self.group_fold(key, lambda _k: zero, lambda acc, el: acc + proj(el))

    def group_mean(self, key: Any, fn: Any = None) -> EastDict:
        """Float mean per group."""
        from east.kernel import KernelExpr

        def _to_float(x: Any) -> Any:
            if isinstance(x, KernelExpr):
                return x.to_float() if x.east_type.type == "Integer" else x
            return float(x)

        proj = (lambda el: _to_float(fn(el))) if fn is not None else _to_float
        sums = self.group_fold(key, lambda _k: 0.0, lambda acc, el: acc + proj(el))
        counts = self.group_size(key)
        return sums.to_dict(
            lambda k, _v: k, lambda k, v: v / float(counts[k]), lambda _a, b, _k: b
        )

    def group_every(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for all members (native)."""
        return self.group_fold(key, lambda _k: True, lambda acc, el: acc & pred(el))

    def group_some(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for any member (native)."""
        return self.group_fold(key, lambda _k: False, lambda acc, el: acc | pred(el))

    def group_to_arrays(self, key: Any, value: Any = None) -> EastDict:
        """Arrays of members/values per group key (native via to_array)."""
        return self.to_array().group_to_arrays(key, value if value is not None else (lambda el: el))

    def group_to_sets(self, key: Any, value: Any = None) -> EastDict:
        """Sets of members/values per group key (native via to_array)."""
        return self.to_array().group_to_sets(key, value)

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None, combine: Any = None) -> EastDict:
        """Dicts of ``key2 -> value`` per group key (native via to_array)."""
        return self.to_array().group_to_dicts(key, key2, value, combine)

    def group_fold(self, key: Any, initial: Any, fold: Any) -> EastDict:
        """Group elements by ``key(element)`` and fold within each group (east-c SetGroupFold).

        Key and accumulator types are inferred by sampling the first element.

        Args:
            key: ``key(element) -> group key`` assigning each element to a bucket.
            initial: ``initial(group_key) -> seed`` producing each bucket's seed
                accumulator.
            fold: ``fold(acc, element) -> new acc`` accumulating each element into
                its bucket.

        Returns:
            A new dict from each group key to its folded accumulator.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.element_type, self.element_type)
        sample = next(iter(self))
        k2 = _ev.type_of(key(sample))
        t2 = _ev.type_of(initial(key(sample)))
        key_cb = EastFunction(key, [self.element_type], k2)
        init_cb = EastFunction(initial, [k2], t2)
        fold_cb = EastFunction(lambda acc, el: fold(acc, el), [t2, self.element_type], t2)
        return _call_builtin(
            "SetGroupFold", [self.element_type, k2, t2], [self, key_cb, init_cb, fold_cb], DictType(k2, t2)
        )

    def __repr__(self) -> str:
        """Return East text format representation."""
        if len(self) == 0:
            return "{}"
        items = ", ".join(repr(item) for item in self)
        return f"{{{items}}}"


# =============================================================================
# EastDict - Sorted key-value collection
# =============================================================================


class EastDict(Generic[K, V]):
    """East dict with key and value type tracking.

    Dicts are mutable, sorted collections of key-value pairs.
    Keys are sorted using East's total ordering.

    Generic type parameters K and V are for static type hints only
    (e.g., EastDict[str, int]). At runtime, key_type and value_type
    provide the actual East types.
    """

    __slots__ = ("key_type", "value_type", "_iteration_lock")

    def __new__(cls, *args, **kwargs):  # noqa: ARG004 — Python forwards constructor args here; the proxy __init__ consumes them
        # EastDict(...) constructs a live C-backed proxy from birth — one
        # representation, no Python store. Returning an EastDictProxy makes Python
        # run EastDictProxy.__init__, which allocates the east-c dict and bulk-
        # inserts. The element ops (get/set/del/has/iter/keys/values/items/get/pop/
        # clear) and equality all live on the proxy. Subclasses (and _wrap) construct normally.
        if cls is EastDict:
            return object.__new__(_proxy_cls("EastDictProxy"))
        return object.__new__(cls)

    def _lock_for_iteration(self) -> None:
        """Lock dict for iteration."""
        self._iteration_lock += 1

    def _unlock_for_iteration(self) -> None:
        """Unlock dict after iteration."""
        self._iteration_lock -= 1

    def _check_not_iterating(self) -> None:
        """Check if dict is being iterated."""
        if self._iteration_lock > 0:
            raise RuntimeError("Cannot modify Dict during iteration")

    # The mapping protocol is implemented by EastDictProxy against the live east-c
    # dict; declared here so EastDict reads as a concrete mapping to static
    # checkers — the proxy overrides each at runtime.
    def __contains__(self, key: Any) -> bool:
        raise NotImplementedError

    def __getitem__(self, key: Any) -> Any:
        raise NotImplementedError

    def __setitem__(self, key: Any, value: Any) -> None:
        raise NotImplementedError

    def __delitem__(self, key: Any) -> None:
        raise NotImplementedError

    def __len__(self) -> int:
        raise NotImplementedError

    def __iter__(self) -> Any:
        raise NotImplementedError

    def items(self) -> Any:
        raise NotImplementedError

    def keys(self) -> Any:
        raise NotImplementedError

    def values(self) -> Any:
        raise NotImplementedError

    def pop(self, key: Any, *args: Any) -> Any:
        raise NotImplementedError

    def clear(self) -> None:
        raise NotImplementedError

    # ----- Eager value methods (delegate to east-c; results are live values) ---

    def size(self) -> int:
        """Number of key-value pairs (east-c DictSize).

        Returns:
            The entry count. On a C-backed proxy this reads the live value.
        """
        return len(self)

    def has(self, key: Any) -> bool:
        """Whether ``key`` is present (east-c DictHas).

        Args:
            key: The key to look up, compared under East's total ordering.

        Returns:
            True if an entry for ``key`` exists. On a C-backed proxy this
            reads the live value.
        """
        return key in self

    def get_or_default(self, key: Any, default: Any) -> Any:
        """Value for ``key``, or ``default`` if absent (east-c DictGetOrDefault).

        With a traced ``key``/``default`` (inside a ``kernel()`` lambda) this
        dict is lifted as a constant and the lookup emits IR (#393) — the
        TRANS-style side-table shape.

        Args:
            key: The key to look up, compared under East's total ordering.
            default: Value returned when ``key`` is not present.

        Returns:
            The stored value for ``key``, otherwise ``default``.
        """
        if _is_traced(key) or _is_traced(default):
            return _lift_traced(self).get_or_default(key, default)
        # Route through the container protocol (`self[key]` / `key in self`), which
        # the proxy backs with the live east-c value.
        return self[key] if key in self else default  # noqa: SIM401

    def try_get(self, key: Any) -> EastVariant:
        """Optionally fetch the value for ``key`` (east-c DictTryGet).

        A traced ``key`` emits IR against this dict as a constant (#393).

        Args:
            key: The key to look up, compared under East's total ordering.

        Returns:
            ``some(value)`` if present, else ``none``.
        """
        if _is_traced(key):
            return _lift_traced(self).try_get(key)
        return EastVariant("some", self[key]) if key in self else EastVariant("none", east_null)

    def insert(self, key: Any, value: Any) -> None:
        """Set ``key`` to ``value`` in place (east-c DictInsert).

        Args:
            key: The key to write, ordered under East's total ordering.
            value: The value to store, replacing any existing value.
        """
        self[key] = value

    def get_or_insert(self, key: Any, fn: Any) -> Any:
        """Fetch the value at ``key``, computing and inserting one if absent (east-c DictGetOrInsert).

        Args:
            key: The key to look up, ordered under East's total ordering.
            fn: Called as ``fn(key) -> value`` only when ``key`` is missing;
                its result is inserted before being returned.

        Returns:
            The existing value, or the newly inserted ``fn(key)``.
        """
        if key not in self:
            self[key] = fn(key)
        return self[key]

    def insert_or_update(self, key: Any, value: Any, combine: Any) -> None:
        """Insert ``value`` at ``key`` or combine it with the existing one, in place (east-c DictInsertOrUpdate).

        Args:
            key: The key to write, ordered under East's total ordering.
            value: The incoming value used when ``key`` is absent.
            combine: Called as ``combine(existing, incoming, key) -> value``
                when ``key`` already has a value; its result is stored.
        """
        self[key] = value if key not in self else combine(self[key], value, key)

    def update(self, key: Any, fn: Any) -> None:
        """Replace the value at ``key`` with ``fn(current)``, in place (east-c DictUpdate).

        Args:
            key: The key whose value is transformed; must already be present.
            fn: Called as ``fn(current) -> new value``.
        """
        self[key] = fn(self[key])

    def swap(self, key: Any, value: Any) -> Any:
        """Set ``key`` to ``value`` and return the previous value, in place (east-c DictSwap).

        Args:
            key: The key to overwrite; must already be present.
            value: The new value to store.

        Returns:
            The value previously stored at ``key``.
        """
        old = self[key]
        self[key] = value
        return old

    def delete(self, key: Any) -> None:
        """Remove ``key`` in place (east-c DictDelete).

        Args:
            key: The key to remove; must be present.
        """
        del self[key]

    def try_delete(self, key: Any) -> bool:
        """Remove ``key`` if present, in place (east-c DictTryDelete).

        Args:
            key: The key to remove.

        Returns:
            True if ``key`` was present and removed, else False.
        """
        if key in self:
            del self[key]
            return True
        return False

    def mean(self, fn: Any = None) -> float:
        """Float mean over entries: of values, or of ``fn(key, value)``
        (native DictReduce; NaN when empty, like TS)."""
        from east.kernel import KernelExpr
        from east.types.types import FloatType

        def _to_float(x: Any) -> Any:
            if isinstance(x, KernelExpr):
                return x.to_float() if x.east_type.type == "Integer" else x
            return float(x)

        proj = (lambda k, v: _to_float(fn(k, v))) if fn is not None else (lambda _k, v: _to_float(v))
        step = EastFunction(
            lambda acc, v, k: acc + proj(k, v), [FloatType, self.value_type, self.key_type], FloatType
        )
        total = _call_builtin(
            "DictReduce", [self.key_type, self.value_type, FloatType], [self, step, 0.0], FloatType
        )
        n = len(self)
        return total / float(n) if n else float("nan")

    def group_size(self, key_fn: Any) -> EastDict:
        """Count per ``key_fn(key, value)`` group (native)."""
        return self.to_dict(key_fn, lambda _k, _v: 1, combine=lambda a, b, _key: a + b)

    def group_sum(self, key_fn: Any, fn: Any = None) -> EastDict:
        """Sum per group of ``fn(key, value)`` (values when omitted; native)."""
        proj = fn if fn is not None else (lambda _k, v: v)
        if len(self):
            k0, v0 = next(iter(self.items()))
            t2 = _ev.type_of(proj(k0, v0))
        else:
            t2 = self.value_type
        zero: Any = 0 if t2.type == "Integer" else 0.0
        return self.group_fold(key_fn, lambda _k: zero, lambda acc, k, v: acc + proj(k, v))

    def group_mean(self, key_fn: Any, fn: Any = None) -> EastDict:
        """Float mean per group."""
        from east.kernel import KernelExpr

        def _to_float(x: Any) -> Any:
            if isinstance(x, KernelExpr):
                return x.to_float() if x.east_type.type == "Integer" else x
            return float(x)

        proj = (lambda k, v: _to_float(fn(k, v))) if fn is not None else (lambda _k, v: _to_float(v))
        sums = self.group_fold(key_fn, lambda _k: 0.0, lambda acc, k, v: acc + proj(k, v))
        counts = self.group_size(key_fn)
        return sums.to_dict(
            lambda k, _v: k, lambda k, v: v / float(counts[k]), lambda _a, b, _k: b
        )

    def group_every(self, key_fn: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred(key, value)`` holds for all entries."""
        return self.group_fold(key_fn, lambda _k: True, lambda acc, k, v: acc & pred(k, v))

    def group_some(self, key_fn: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred(key, value)`` holds for any entry."""
        return self.group_fold(key_fn, lambda _k: False, lambda acc, k, v: acc | pred(k, v))

    def group_to_arrays(self, key_fn: Any, value_fn: Any) -> EastDict:
        """Arrays of ``value_fn(key, value)`` per group (native via to_array)."""
        pairs = self.to_array(lambda k, v: {"k": key_fn(k, v), "v": value_fn(k, v)})
        return pairs.group_to_arrays(lambda p: p["k"], lambda p: p["v"])

    def group_to_sets(self, key_fn: Any, value_fn: Any) -> EastDict:
        """Sets of ``value_fn(key, value)`` per group (native via to_array)."""
        pairs = self.to_array(lambda k, v: {"k": key_fn(k, v), "v": value_fn(k, v)})
        return pairs.group_to_sets(lambda p: p["k"], lambda p: p["v"])

    def group_to_dicts(self, key_fn: Any, key2_fn: Any, value_fn: Any, combine: Any = None) -> EastDict:
        """Dicts of ``key2 -> value`` per group (native via to_array)."""
        pairs = self.to_array(
            lambda k, v: {"k": key_fn(k, v), "k2": key2_fn(k, v), "v": value_fn(k, v)}
        )
        return pairs.group_to_dicts(
            lambda p: p["k"], lambda p: p["k2"], lambda p: p["v"], combine
        )

    def update_many(
        self,
        keys: Iterable[K],
        values: Iterable[V],
        combine: Callable[[V, V], V] | None = None,
    ) -> None:
        """Apply many (key, value) updates in one crossing (issue #255).

        Makes East dicts viable as hot-loop accumulators: instead of one FFI
        round trip per ``d[k] = combine(d[k], v)``, the whole batch crosses
        once. A pure ``combine`` lambda (or a precompiled East kernel) runs
        the collision handling C-to-C as well.

        Args:
            keys: Sequence of keys (same length as ``values``).
            values: Sequence of incoming values.
            combine: Optional ``combine(existing, incoming) -> value`` used
                when a key is already present; the incoming value wins when
                omitted. Accepts a python callable (traced into a native
                kernel when pure) or a compiled East function.
        """
        combine_ptr = 0
        combine_py = None
        keep_alive = None
        if combine is not None:
            handle = getattr(combine, "_eastc_handle", None)
            fn_val = getattr(handle, "_fn_val", 0) if handle is not None else 0
            if fn_val:
                combine_ptr = fn_val
                keep_alive = combine
            else:
                from east.kernel import try_push_down

                native = try_push_down(
                    EastFunction(combine, [self.value_type, self.value_type], self.value_type)
                )
                if native is not None:
                    combine_ptr = native._eastc_handle._fn_val
                    keep_alive = native
                else:
                    combine_py = combine
        _proxy_cls("_dict_update_many")(
            self._c_ptr, self._c_key_type_ptr, self._c_val_type_ptr,
            list(keys), list(values), combine_ptr, combine_py,
        )
        del keep_alive

    def merge(self, other: EastDict, combine: Any = None) -> EastDict:
        """New dict merging ``other`` into a copy of this one (east-c DictCopy + DictUnionInPlace).

        Args:
            other: The dict whose entries are merged in. Its key/value types
                must match this dict's.
            combine: For a key present in both, called as
                ``combine(existing, incoming) -> value`` to pick the result.
                When omitted, the incoming value from ``other`` wins.

        Returns:
            A new dict; this dict and ``other`` are unchanged.
        """
        from east.types.types import DictType, NullType

        result = _call_builtin("DictCopy", [self.key_type, self.value_type], [self], DictType(self.key_type, self.value_type))
        callback = EastFunction(
            (lambda v1, v2, k: v2) if combine is None else (lambda v1, v2, k: combine(v1, v2)),
            [self.value_type, self.value_type, self.key_type],
            self.value_type,
        )
        _call_builtin("DictUnionInPlace", [self.key_type, self.value_type], [result, other, callback], NullType)
        return result

    def merge_all(self, other: EastDict, merge: Any, default: Any) -> None:
        """Fold every entry of ``other`` into self in place (east-c DictMergeAll).

        For each ``(key, value)`` in ``other``: the base is this dict's existing
        value for ``key`` if present, otherwise ``default(key)``; the stored
        result is ``merge(base, value, key)``.

        Args:
            other: The dict whose entries are folded in. Its key/value types
                must match this dict's.
            merge: Called as ``merge(existing, incoming, key) -> value`` to
                combine the base with ``other``'s value.
            default: Called as ``default(key) -> value`` to synthesise a base
                for keys absent from this dict.
        """
        from east.types.types import NullType

        self._check_not_iterating()
        merge_cb = EastFunction(
            lambda existing, incoming, key: merge(existing, incoming, key),
            [self.value_type, self.value_type, self.key_type],
            self.value_type,
        )
        default_cb = EastFunction(
            lambda key: default(key),
            [self.key_type],
            self.value_type,
        )
        _call_builtin(
            "DictMergeAll",
            [self.key_type, self.value_type],
            [self, other, merge_cb, default_cb],
            NullType,
        )

    def copy(self) -> EastDict:
        """A shallow copy of this dict (east-c DictCopy).

        Returns:
            A new dict with the same entries; mutating it does not affect
            the original.
        """
        from east.types.types import DictType

        return _call_builtin("DictCopy", [self.key_type, self.value_type], [self], DictType(self.key_type, self.value_type))

    def keys_set(self) -> EastSet:
        """The set of keys (east-c DictKeys).

        Returns:
            A set of the keys, ordered under East's total ordering.
        """
        from east.types.types import SetType

        return _call_builtin("DictKeys", [self.key_type, self.value_type], [self], SetType(self.key_type))

    def get_keys(self, keys: EastSet, fill: Any) -> EastDict:
        """Restrict to a given set of keys, filling in any that are missing (east-c DictGetKeys).

        Args:
            keys: The set of keys the result is restricted to.
            fill: Called as ``fill(key) -> value`` for each requested key not
                present in this dict.

        Returns:
            A new dict keyed exactly by ``keys``: existing values where
            present, ``fill(key)`` otherwise.
        """
        from east.types.types import DictType

        callback = EastFunction(fill, [self.key_type], self.value_type)
        return _call_builtin("DictGetKeys", [self.key_type, self.value_type], [self, keys, callback], DictType(self.key_type, self.value_type))

    def for_each(self, fn: Any) -> None:
        """Call ``fn`` for each entry in key order (east-c DictForEach).

        Args:
            fn: Called as ``fn(key, value)`` once per entry, in ascending
                key order under East's total ordering. Its return value is
                ignored.
        """
        from east.types.types import NullType

        callback = EastFunction(lambda v, k: (fn(k, v), east_null)[1], [self.value_type, self.key_type], NullType)
        _call_builtin("DictForEach", [self.key_type, self.value_type, NullType], [self, callback], NullType)

    def map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Transform each value, keeping keys, returning a new dict (east-c DictMap).

        Args:
            fn: Called as ``fn(value) -> new value`` for each entry; the key
                is not passed.
            out: Optional East type pinning the result value type. When
                omitted it is inferred by sampling ``fn`` on the first value.

        Returns:
            A new dict with the same keys and mapped values. Empty input
            yields an empty dict with value type ``out`` (or the original).
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.key_type, out if out is not None else self.value_type)
        first_key = next(iter(self))
        v2 = out if out is not None else _ev.type_of(fn(self[first_key]))
        callback = EastFunction(lambda v, k: fn(v), [self.value_type, self.key_type], v2)
        return _call_builtin("DictMap", [self.key_type, self.value_type, v2], [self, callback], DictType(self.key_type, v2))

    def filter(self, predicate: Any) -> EastDict:
        """Keep only entries the predicate accepts, returning a new dict (east-c DictFilter).

        Args:
            predicate: Called as ``predicate(key, value) -> bool``; entries
                for which it is falsy are dropped.

        Returns:
            A new dict containing the retained entries in key order.
        """
        from east.kernel import KernelExpr
        from east.types.types import BooleanType, DictType

        def _pred(v, k):  # noqa: ANN001, ANN202
            r = predicate(k, v)
            return r if isinstance(r, KernelExpr) else bool(r)

        callback = EastFunction(_pred, [self.value_type, self.key_type], BooleanType)
        return _call_builtin("DictFilter", [self.key_type, self.value_type], [self, callback], DictType(self.key_type, self.value_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Filter and remap values in one pass, returning a new dict (east-c DictFilterMap).

        Args:
            fn: Called as ``fn(key, value) -> some(value) | none``; ``none``
                entries are dropped, ``some`` values are kept under the same
                key.
            out: Optional East type pinning the result value type. When
                omitted it is inferred from the first ``some`` sample,
                falling back to the original value type.

        Returns:
            A new dict of the surviving, remapped entries. Empty input yields
            an empty dict.
        """
        from east.types.types import DictType, OptionType

        if len(self) == 0:
            return EastDict(self.key_type, out if out is not None else self.value_type)
        if out is not None:
            v2 = out
        else:
            v2 = next(
                (_ev.type_of(r.value) for k in self if (r := fn(k, self[k])).type == "some"),
                self.value_type,
            )
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], OptionType(v2))
        return _call_builtin("DictFilterMap", [self.key_type, self.value_type, v2], [self, callback], DictType(self.key_type, v2))

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First non-empty result of mapping entries in key order (east-c DictFirstMap).

        Args:
            fn: Called as ``fn(key, value) -> some(result) | none`` for
                entries in ascending key order until one returns ``some``.
            out: Optional East type pinning the result type. When omitted it
                is inferred from the first ``some`` sample, falling back to
                the value type.

        Returns:
            ``some(result)`` for the first entry that produced one, else
            ``none`` (also ``none`` for an empty dict).
        """
        from east.types.types import OptionType

        if len(self) == 0:
            return EastVariant("none", east_null)
        if out is not None:
            t2 = out
        else:
            t2 = next(
                (_ev.type_of(r.value) for k in self if (r := fn(k, self[k])).type == "some"),
                self.value_type,
            )
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], OptionType(t2))
        return _call_builtin("DictFirstMap", [self.key_type, self.value_type, t2], [self, callback], OptionType(t2))

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Any:
        """Map each entry then combine the results pairwise (east-c DictMapReduce).

        Args:
            map_fn: Called as ``map_fn(key, value) -> T2`` to project each
                entry.
            reduce_fn: Called as ``reduce_fn(a, b) -> T2`` to fold the
                projections together.
            out: Optional East type pinning ``T2``. When omitted it is
                inferred by sampling ``map_fn`` on the first entry.

        Returns:
            The single combined ``T2`` value.

        Raises:
            ValueError: If the dict is empty (the reduction has no identity).
        """
        if len(self) == 0:
            raise ValueError("map_reduce on an empty Dict")
        first_key = next(iter(self))
        t2 = out if out is not None else _ev.type_of(map_fn(first_key, self[first_key]))
        map_cb = EastFunction(lambda v, k: map_fn(k, v), [self.value_type, self.key_type], t2)
        reduce_cb = EastFunction(reduce_fn, [t2, t2], t2)
        return _call_builtin("DictMapReduce", [self.key_type, self.value_type, t2], [self, map_cb, reduce_cb], t2)

    def reduce(self, initial: Any, fn: Any) -> Any:
        """Fold an accumulator over entries in key order (east-c DictReduce).

        Args:
            initial: The seed accumulator; its type pins the accumulator and
                result type.
            fn: Called as ``fn(acc, key, value) -> acc`` for each entry in
                ascending key order.

        Returns:
            The final accumulator (``initial`` if the dict is empty).
        """
        t2 = _ev.type_of(initial)
        callback = EastFunction(lambda acc, v, k: fn(acc, k, v), [t2, self.value_type, self.key_type], t2)
        return _call_builtin("DictReduce", [self.key_type, self.value_type, t2], [self, callback, initial], t2)

    def to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Project each entry to an array element in key order (east-c DictToArray).

        Args:
            fn: Called as ``fn(key, value) -> element`` for each entry.
            out: Optional East type pinning the element type. When omitted it
                is inferred by sampling ``fn`` on the first entry.

        Returns:
            A new array, one element per entry, in ascending key order.
            Empty input yields an empty array.
        """
        from east.types.types import ArrayType, NullType

        if len(self) == 0:
            return EastArray(out if out is not None else NullType, [])
        first_key = next(iter(self))
        t2 = out if out is not None else _ev.type_of(fn(first_key, self[first_key]))
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], t2)
        return _call_builtin("DictToArray", [self.key_type, self.value_type, t2], [self, callback], ArrayType(t2))

    def to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Collect a projection of each entry into a set (east-c DictToSet).

        Args:
            fn: Called as ``fn(key, value) -> element`` for each entry;
                duplicate results collapse.
            out: Optional East type pinning the element type. When omitted it
                is inferred by sampling ``fn`` on the first entry.

        Returns:
            The set of distinct ``fn`` results, ordered under East's total
            ordering. Empty input yields an empty set.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(out if out is not None else self.key_type)
        first_key = next(iter(self))
        k2 = out if out is not None else _ev.type_of(fn(first_key, self[first_key]))
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], k2)
        return _call_builtin("DictToSet", [self.key_type, self.value_type, k2], [self, callback], SetType(k2))

    def to_dict(self, key_fn: Any, value_fn: Any, combine: Any, key_out: EastType | None = None, value_out: EastType | None = None) -> EastDict:
        """Re-key and re-value into a new dict, combining collisions (east-c DictToDict).

        Args:
            key_fn: Called as ``key_fn(key, value) -> new key`` to build each
                new entry's key.
            value_fn: Called as ``value_fn(key, value) -> new value`` to
                build each new entry's value.
            combine: Called as ``combine(existing, incoming, new_key) ->
                value`` when two source entries map to the same new key.
            key_out: Optional East type pinning the new key type; inferred
                from a first-entry sample when omitted.
            value_out: Optional East type pinning the new value type;
                inferred from a first-entry sample when omitted.

        Returns:
            A new dict keyed by ``key_fn`` with values from ``value_fn``.
            Empty input yields an empty dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(
                key_out if key_out is not None else self.key_type,
                value_out if value_out is not None else self.value_type,
            )
        first_key = next(iter(self))
        k2 = key_out if key_out is not None else _ev.type_of(key_fn(first_key, self[first_key]))
        v2 = value_out if value_out is not None else _ev.type_of(value_fn(first_key, self[first_key]))
        key_cb = EastFunction(lambda v, k: key_fn(k, v), [self.value_type, self.key_type], k2)
        value_cb = EastFunction(lambda v, k: value_fn(k, v), [self.value_type, self.key_type], v2)
        combine_cb = EastFunction(combine, [v2, v2, k2], v2)
        return _call_builtin("DictToDict", [self.key_type, self.value_type, k2, v2], [self, key_cb, value_cb, combine_cb], DictType(k2, v2))

    def flatten_to_array(self, fn: Any) -> EastArray:
        """Concatenate per-entry arrays into one array (east-c DictFlattenToArray).

        Args:
            fn: Called as ``fn(key, value) -> array`` for each entry; the
                resulting arrays are concatenated in key order. The element
                type is taken from the first entry's sample array.

        Returns:
            A single array of all elements. Empty input yields an empty
            array.
        """
        from east.types.types import ArrayType, NullType

        if len(self) == 0:
            return EastArray(NullType, [])
        first_key = next(iter(self))
        sample = fn(first_key, self[first_key])
        t2 = sample.element_type
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], ArrayType(t2))
        return _call_builtin("DictFlattenToArray", [self.key_type, self.value_type, t2], [self, callback], ArrayType(t2))

    def flatten_to_set(self, fn: Any) -> EastSet:
        """Union per-entry sets into one set (east-c DictFlattenToSet).

        Args:
            fn: Called as ``fn(key, value) -> set`` for each entry; the
                results are unioned. The element type is taken from the first
                entry's sample set.

        Returns:
            The union set of distinct elements, ordered under East's total
            ordering. Empty input yields an empty set.
        """
        from east.types.types import SetType

        if len(self) == 0:
            return EastSet(self.key_type)
        first_key = next(iter(self))
        sample = fn(first_key, self[first_key])
        k2 = sample.element_type
        callback = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], SetType(k2))
        return _call_builtin("DictFlattenToSet", [self.key_type, self.value_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any) -> EastDict:
        """Merge per-entry dicts into one dict, resolving collisions (east-c DictFlattenToDict).

        Args:
            fn: Called as ``fn(key, value) -> dict`` for each entry; the
                results are merged. The key/value types are taken from the
                first entry's sample dict.
            combine: Called as ``combine(existing, incoming, key) -> value``
                when a key appears in more than one of the produced dicts.

        Returns:
            The merged dict. Empty input yields an empty dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(self.key_type, self.value_type)
        first_key = next(iter(self))
        sample = fn(first_key, self[first_key])
        k2, v2 = sample.key_type, sample.value_type
        map_cb = EastFunction(lambda v, k: fn(k, v), [self.value_type, self.key_type], DictType(k2, v2))
        combine_cb = EastFunction(combine, [v2, v2, k2], v2)
        return _call_builtin("DictFlattenToDict", [self.key_type, self.value_type, k2, v2], [self, map_cb, combine_cb], DictType(k2, v2))

    def group_fold(self, key_fn: Any, init_fn: Any, fold_fn: Any, key_out: EastType | None = None, acc_out: EastType | None = None) -> EastDict:
        """Group entries by a derived key and fold each group (east-c DictGroupFold).

        Args:
            key_fn: Called as ``key_fn(key, value) -> group key`` to assign
                each entry to a group.
            init_fn: Called as ``init_fn(group_key) -> acc`` to seed each
                group's accumulator the first time the group is seen.
            fold_fn: Called as ``fold_fn(acc, key, value) -> acc`` to fold
                each entry into its group's accumulator.
            key_out: Optional East type pinning the group key type; inferred
                from a first-entry sample when omitted.
            acc_out: Optional East type pinning the accumulator type;
                inferred from a first-entry sample when omitted.

        Returns:
            A new dict from group key to its folded accumulator. Empty input
            yields an empty dict.
        """
        from east.types.types import DictType

        if len(self) == 0:
            return EastDict(
                key_out if key_out is not None else self.key_type,
                acc_out if acc_out is not None else self.value_type,
            )
        first_key = next(iter(self))
        k2 = key_out if key_out is not None else _ev.type_of(key_fn(first_key, self[first_key]))
        t2 = acc_out if acc_out is not None else _ev.type_of(init_fn(key_fn(first_key, self[first_key])))
        key_cb = EastFunction(lambda v, k: key_fn(k, v), [self.value_type, self.key_type], k2)
        init_cb = EastFunction(init_fn, [k2], t2)
        fold_cb = EastFunction(lambda acc, v, k: fold_fn(acc, k, v), [t2, self.value_type, self.key_type], t2)
        return _call_builtin("DictGroupFold", [self.key_type, self.value_type, k2, t2], [self, key_cb, init_cb, fold_cb], DictType(k2, t2))

    @classmethod
    def generate(
        cls,
        n: int,
        key_fn: Any,
        value_fn: Any,
        combine: Any,
        key_type: EastType,
        value_type: EastType,
    ) -> EastDict:
        """Build a dict of ``n`` entries from index functions (east-c DictGenerate).

        Args:
            n: The number of indices ``0..n-1`` to generate from.
            key_fn: Called as ``key_fn(i) -> key`` for each index.
            value_fn: Called as ``value_fn(i) -> value`` for each index.
            combine: Called as ``combine(existing, incoming, key) -> value``
                when two indices produce the same key.
            key_type: The East type of generated keys.
            value_type: The East type of generated values.

        Returns:
            A new dict of the generated entries, ordered under East's total
            ordering on keys.
        """
        from east.types.types import DictType, IntegerType

        key_cb = EastFunction(key_fn, [IntegerType], key_type)
        value_cb = EastFunction(value_fn, [IntegerType], value_type)
        combine_cb = EastFunction(combine, [value_type, value_type, key_type], value_type)
        return _call_builtin(
            "DictGenerate",
            [key_type, value_type],
            [int(n), key_cb, value_cb, combine_cb],
            DictType(key_type, value_type),
        )

    def __repr__(self) -> str:
        """Return East text format representation."""
        if len(self) == 0:
            return "{:}"
        items = ", ".join(f"{repr(k)}: {repr(v)}" for k, v in self.items())
        return f"{{{items}}}"


# =============================================================================
# EastStruct - Immutable record type (tuple-backed)
# =============================================================================

