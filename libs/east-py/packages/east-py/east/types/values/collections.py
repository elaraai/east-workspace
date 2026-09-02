#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Mutable collection value types: EastArray, EastSet, EastDict (mutually recursive)."""

from __future__ import annotations

from collections.abc import Callable, Iterable, MutableSequence
from typing import TYPE_CHECKING, Any, Generic

import east.types.values as _ev
from east.types.values._helpers import K, T, V, _call_builtin, _deprecated_alias, _fn_init
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


# Cached Expression class for the traced-argument pre-checks (#393): access
# methods called with a traced key/index re-route through the expression builder
# (this collection lifts to a constant) instead of hitting the C container
# protocol with an expression proxy.
_expression_cls: Any = None


def _is_traced(value: Any) -> bool:
    """Whether ``value`` is a traced expression (lazy class cache)."""
    global _expression_cls
    if _expression_cls is None:
        from east.expression import Expression

        _expression_cls = Expression
    return isinstance(value, _expression_cls)


def _lift_traced(value: Any) -> Any:
    """Lift an eager collection into a traced constant expression (#393)."""
    from east.expression import _lift

    return _lift(value)



def _function_out_type(fn, param_types=None):
    """A callback's output type from the TYPE SYSTEM — the strict derivation.

    Two exact sources, tried in order:

    1. a compiled East function (east.expression / compile_from_* / ``.bind`` results)
       carries its signature on ``_eastc_handle`` (#409);
    2. any other callable is captured against ``param_types`` exactly as the
       eager method will capture it (#625): the built expression's type is the
       answer, and a callback with no East capture RAISES its
       ``ExpressionError`` here — before any of it runs on real elements —
       rather than silently deferring to a data sample (#450's whole family).

    So with ``param_types`` this ALWAYS answers or raises: there is no
    sampling path behind it, and an empty collection derives exactly what a
    full one derives. Returns None only for the handle-only probe (no
    ``param_types``, used to read a compiled East function's declared output);
    a non-callable in a callback slot is a caller error, named here.
    """
    handle = getattr(fn, "_eastc_handle", None)
    if handle is not None:
        try:
            return handle.get_output_type()
        except Exception:
            return None
    if param_types is None:
        return None
    if not callable(fn):
        raise TypeError(
            "a callback slot takes an East.function artifact or a python body, "
            f"got {type(fn).__name__}")
    from east.expression import _trace_out_type

    return _trace_out_type(fn, list(param_types))


def _callback_arity(fn, default):
    """How many PAYLOAD arguments a callback accepts — the block it takes
    first excluded.

    Decides whether a callback gets the extra context some builtins carry
    (DictMap's key). Compiled East functions answer from their declared
    signature (they take no block); plain bodies from ``inspect.signature``
    minus the block (``*args`` accepts everything); ``default`` covers
    callables python cannot introspect. A body with no parameter at all
    cannot receive the block and is refused here, at the call.
    """
    handle = getattr(fn, "_eastc_handle", None)
    if handle is None:
        inner = getattr(fn, "_east_function", None)
        handle = getattr(inner, "_eastc_handle", None) if inner is not None else None
    if handle is not None:
        try:
            return len(handle.get_input_types())
        except Exception:
            return default
    import inspect

    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return default
    n = 0
    for p in params:
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            n += 1
        elif p.kind is p.VAR_POSITIONAL:
            return 1 << 30  # *args — accepts everything the builtin offers
    if n == 0:
        from east.expression.errors import ExpressionError

        raise ExpressionError(
            "a callback takes the block first (TS `($, …) => …`): lambda b, …: … — "
            "this one declares no parameters")
    return n - 1


def _mark_function(wrapper, fn):
    """Tag an eager-callback wrapper with its underlying compiled East function.

    The wrapper adapts the user callback to the builtin's calling convention;
    the bridge resolves ``_east_function`` to pass the function's native function
    value straight to the builtin instead, skipping the capture (#409). Only
    used where the wrapper forwards a PREFIX of the callback arguments in
    order.
    """
    if getattr(fn, "_eastc_handle", None) is not None:
        wrapper._east_function = fn
    return wrapper


def _idx_cb(fn):
    """Wrapper for an ``(element, index)`` builtin callback slot.

    The TS callbacks all receive the index, so forward it when ``fn`` takes
    two payload arguments; a one-argument ``fn`` keeps getting just the
    element. Every body takes the block first.
    """
    if _callback_arity(fn, 1) >= 2:
        return _mark_function(lambda b, el, idx: fn(b, el, idx), fn)
    return _mark_function(lambda b, el, idx: fn(b, el), fn)


def _acc_idx_cb(fn):
    """Wrapper for an ``(accumulator, element, index)`` fold slot (index optional)."""
    if _callback_arity(fn, 2) >= 3:
        return _mark_function(lambda b, acc, el, idx: fn(b, acc, el, idx), fn)
    return _mark_function(lambda b, acc, el, idx: fn(b, acc, el), fn)


def _combine_cb(fn, key_type, value_type):
    """Wrapper for an ``(existing, incoming, key)`` conflict slot.

    Forwards the key when ``fn`` takes three payload arguments. ``None``
    means East's default: error on the duplicate with the key printed — a
    COMPILED error function (the traced twin's ``_key_error_node`` message,
    byte for byte), so the strict surface needs no python error callback
    (#625).
    """
    if fn is None:
        from east.expression import _error_combine_function

        return _error_combine_function(
            value_type, key_type, "Cannot insert duplicate key ", " into dict")
    if _callback_arity(fn, 2) >= 3:
        return _mark_function(lambda b, v1, v2, k: fn(b, v1, v2, k), fn)
    return _mark_function(lambda b, v1, v2, k: fn(b, v1, v2), fn)


def _as_idx_fn(fn):
    """Normalize an element callback to a ``(b, el, idx)`` callable (the
    arity decision is made once, not per element)."""
    if _callback_arity(fn, 1) >= 2:
        return fn
    return lambda b, el, _i: fn(b, el)


def _elem_in(fn, element_type):
    """The declared input list for an element callback (index included when taken)."""
    from east.types.types import IntegerType

    return [element_type, IntegerType] if _callback_arity(fn, 1) >= 2 else [element_type]


def _kv_cb(fn):
    """Wrapper for a Dict ``(value, key)`` builtin callback slot — the
    TypeScript order, on both surfaces. The key is forwarded when ``fn``
    takes two payload arguments; a one-argument ``fn`` sees just the value."""
    if _callback_arity(fn, 1) >= 2:
        return _mark_function(lambda b, v, k: fn(b, v, k), fn)
    return _mark_function(lambda b, v, _k: fn(b, v), fn)


def _acc_kv_cb(fn):
    """Wrapper for a Dict ``(accumulator, value, key)`` fold slot (key optional)."""
    if _callback_arity(fn, 2) >= 3:
        return _mark_function(lambda b, acc, v, k: fn(b, acc, v, k), fn)
    return _mark_function(lambda b, acc, v, _k: fn(b, acc, v), fn)


def _as_kv_fn(fn):
    """Normalize a Dict entry callback to a ``(b, value, key)`` callable (the
    arity decision is made once, not per entry)."""
    if _callback_arity(fn, 1) >= 2:
        return fn
    return lambda b, v, _k: fn(b, v)


def _kv_in(fn, value_type, key_type):
    """The declared input list for a Dict entry callback (key included when taken)."""
    return [value_type, key_type] if _callback_arity(fn, 1) >= 2 else [value_type]


def _check_function_out(fn, expected, param="out"):
    """Reject a compiled East function whose declared output type is not ``expected``.

    Both types are known statically at the call — the function carries its
    signature and ``expected`` derives from an explicitly declared type — so a
    mismatch is always a caller bug. Accepting it would label the function's
    values with a type that does not describe them: the mislabelled collection
    still reads fine (``len``, type labels, ``update_many``) and fails only
    when an element is decoded, arbitrarily far from the cause (#467).

    Only fires for handle-carrying functions; a plain python body has no
    declared signature to compare — the capture checks it against the slot.
    """
    if fn is None or expected is None:
        return
    ko = _function_out_type(fn)
    if ko is not None and ko != expected:
        from east.serialization.east_printer import print_east
        from east.types.coercion import EastTypeError
        from east.types.type_of_type import EastTypeType

        raise EastTypeError(
            f"function output is {print_east(ko, EastTypeType)}, "
            f"expected {print_east(expected, EastTypeType)} (from {param}=)"
        )


def _not_expr(e: Any) -> Any:
    """``~e`` on a traced Boolean (the base ``Expression`` has no ``__invert__``
    for the type checker — the Boolean subclass does at run time)."""
    return ~e


def _typed_or_none(value):
    """``type_of(value)``, or None when it is traced or not an East value."""
    if _is_traced(value):
        return None
    try:
        return _ev.type_of(value)
    except Exception:
        return None


def _require_operand_type(other, expected, op: str) -> None:
    """Reject a second operand whose FULL East type is not ``expected`` (#529).

    These builtins take ONE set of type parameters and two collections, so
    ``other``'s slots are decoded as the receiver's type. That is not a
    downstream type error — it is a raw reinterpretation of a foreign payload.
    Measured: a ``Set<String>`` receiver with a ``Set<Integer>`` argument makes
    ``union``/``sym_diff`` SEGFAULT (the integer dereferenced as a string
    pointer) and ``union_in_place`` corrupt the receiver into a ``MemoryError``
    out of ``PyUnicode_DecodeUTF8``, while ``intersect``/``diff`` quietly
    return wrong answers. east-c cannot catch it: the types it is handed say
    the operands agree.

    Comparing the WHOLE type matters, not just the element type — ``EastArray``,
    ``EastSet`` and ``EastVector`` all expose ``element_type``, so an Array
    passed where a Set is expected compares equal on that attribute and east-c
    then decodes an array header as a b-tree (also exit 139). This is the rule
    the traced twin ``Expression._same_typed`` has always applied; the eager
    path now matches it.

    ``type_of`` is O(1) on a C-backed collection. Operands it cannot type — a
    plain python ``set``/``list``, a traced expression — pass through to the
    existing coercion, which already rejects them.
    """
    if _is_traced(other):
        return
    try:
        actual = _ev.type_of(other)
    except Exception:
        return
    if actual == expected:
        return
    from east.serialization.east_printer import print_east
    from east.types.coercion import EastTypeError
    from east.types.type_of_type import EastTypeType

    raise EastTypeError(
        f"{op}: other is {print_east(actual, EastTypeType)} but this operation "
        f"needs {print_east(expected, EastTypeType)} — the operand types must match"
    )


def _numeric_zero_for(t):
    """The additive identity for a numeric East type, or a named TypeError.

    Shared by every ``sum``/``group_sum`` so the whole family agrees — Set and
    Dict used to fall back to ``0.0`` for a non-numeric projection, silently
    producing Float sums over data that is not numeric at all (#525).
    """
    if t.type == "Integer":
        return 0
    if t.type == "Float":
        return 0.0
    raise TypeError(
        f"expected a numeric (Integer/Float) type, got {t.type} — the zero is "
        "typed from the projection, empty collection or not, so the projection "
        "must yield Integer or Float"
    )


def _float_proj(fn, t):
    """A Float-typed projection decided from the TYPE SYSTEM, not per value.

    ``t`` is the projection's declared East type: Float passes ``fn`` (or the
    element) through untouched; Integer widens with the East builtin, which
    the eager funnel makes dual-mode — it emits IR inside a trace and runs
    east-c eagerly on values — so the mean/group_mean folds stay traceable
    and never probe a value's python type per element (#470).
    """
    from east.namespace import East

    if t.type == "Float":
        return fn if fn is not None else (lambda _b, el: el)
    if t.type == "Integer":
        if fn is None:
            return lambda _b, el: East.Integer.to_float(el)
        if _callback_arity(fn, 1) >= 2:
            return lambda b, el, i: East.Integer.to_float(fn(b, el, i))
        return lambda b, el: East.Integer.to_float(fn(b, el))
    raise TypeError(f"expected a numeric (Integer/Float) type, got {t.type}")


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

    def sort(self, by: Any = None, *, reverse: bool = False) -> EastArray:
        """New array sorted ascending by East's total order (east-c ArraySort;
        TS ``sort``). :meth:`sort_in_place` is the mutating spelling.

        Args:
            by: Optional projection ``fn(element) -> sort key``; elements are
                ordered by the East total order of the projected keys. When
                omitted, elements are sorted by their own East total order.
            reverse: When True, the sorted result is reversed (descending).

        Returns:
            A new array; the original is left unchanged.

        Note:
            Ordering follows East's total order, not Python's ``<``. The keyless
            path uses ``ArraySortDefault``; with ``by`` it is ``ArraySort``
            over the key's captured result type.
        """
        from east.types.types import ArrayType

        if by is None:
            result = _call_builtin("ArraySortDefault", [self.element_type], [self], ArrayType(self.element_type))
        else:
            t2 = _function_out_type(by, [self.element_type])
            callback = EastFunction(by, [self.element_type], t2)
            result = _call_builtin("ArraySort", [self.element_type, t2], [self, callback], ArrayType(self.element_type))
        return result.reverse() if reverse else result

    def sorted(self, key: Any = None, *, reverse: bool = False) -> EastArray:
        """Deprecated alias of :meth:`sort` (the TypeScript name)."""
        import warnings

        warnings.warn(
            ".sorted() is deprecated: the spelling is .sort() (the TypeScript name)",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.sort(key, reverse=reverse)

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
            callback = EastFunction(lambda _b, el: el, [self.element_type], t2)
        else:
            t2 = _function_out_type(key, [self.element_type])
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("ArrayIsSorted", [self.element_type, t2], [self, callback], BooleanType)

    def _search_key(self, target: Any, key: Any) -> tuple:
        """``(target, projection type, callback)`` for the ArrayFind* family.

        The comparison type comes from the PROJECTION — the key's declared or
        traced output, or the element type when there is no key — and the
        target is coerced into it. Deriving it from the TARGET instead (as this
        family did until #525) is wrong twice over, and `find_all` never did
        it: `Array<Float>.find_first(2)` compared an Integer against Floats
        under East's cross-type total order and answered `none` while
        `find_all(2)` on the same array answered `[1, 2]`; and with a key it
        declared a Float projection as Integer, silently TRUNCATING 2.7 to 2
        and reporting a match that does not exist. Deriving from the key also
        keeps Option/variant targets sound, where `type_of(some(3))` would
        yield an unusable single-case type.
        """
        from east.types.coercion import coerce_to

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda _b, el: el, [self.element_type], t2)
        else:
            t2 = _function_out_type(key, [self.element_type])
            callback = EastFunction(key, [self.element_type], t2)
        return coerce_to(target, t2), t2, callback

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

        target, t2, callback = self._search_key(target, key)
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

        target, t2, callback = self._search_key(target, key)
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

        target, t2, callback = self._search_key(target, key)
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

        target, t2, callback = self._search_key(target, key)
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

        _require_operand_type(other, ArrayType(self.element_type), "concat")
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
        from east.expression import _array_get_function
        from east.types.types import ArrayType

        # A compiled getter with THIS array bound by reference — the python
        # `lambda idx: self[idx]` closure it replaces has no strict capture
        # (#625), and a snapshot capture would copy the whole source.
        callback = _array_get_function(self.element_type).bind(self)
        return _call_builtin("ArrayGetKeys", [self.element_type], [self, indices, callback], ArrayType(self.element_type))

    def copy(self) -> EastArray:
        """A shallow copy of this array (east-c ArrayCopy).

        Returns:
            A new array with the same elements.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayCopy", [self.element_type], [self], ArrayType(self.element_type))

    def reverse(self) -> EastArray:
        """New array with the elements in reverse order (east-c ArrayReverse;
        TS ``reverse``). :meth:`reverse_in_place` is the mutating spelling.

        Returns:
            A new array; the original is left unchanged.
        """
        from east.types.types import ArrayType

        return _call_builtin("ArrayReverse", [self.element_type], [self], ArrayType(self.element_type))

    reversed = _deprecated_alias("reversed", "reverse")

    def has(self, index: int) -> bool:
        """Whether ``index`` is within bounds (``0 <= index < len``)."""
        return 0 <= int(index) < len(self)

    def get(self, index: int, default_fn: Any = None) -> Any:
        """Element at ``index``; a bad index raises East's bounds error — or,
        with ``default_fn``, yields ``default_fn(b, index)`` (TS
        ``get(index, onMissing?)``).

        Unlike the ``arr[i]`` protocol read (pythonic: negative indexing,
        ``IndexError``), this is the East ArrayGet: ``0 <= index < len`` or
        ``Array index N out of bounds``. With a traced ``index`` (inside a
        captured body) this array is lifted as a constant and the access
        emits IR (#393).
        """
        if _is_traced(index):
            return _lift_traced(self).get(index, default_fn)
        if not self.has(index):
            if default_fn is not None:
                from east.expression.statements import EagerBlock

                return default_fn(EagerBlock(), int(index))
            from east.runtime.errors import EastError

            raise EastError(f"Array index {int(index)} out of bounds", [])
        return self[index]

    def at(self, index: int, default_fn: Any = None) -> Any:
        """The element at ``index`` (TS ``at`` — the same as :meth:`get`)."""
        return self.get(index, default_fn)

    def size(self) -> int:
        """Number of elements (east-c ArraySize; TS ``size``)."""
        return len(self)

    def length(self) -> int:
        """Number of elements (TS ``length`` — the same as :meth:`size`)."""
        return len(self)

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
            type comes from the projection's captured output type.
        """
        from east.types.types import IntegerType, SetType

        if key is None:
            k2 = self.element_type
            callback = EastFunction(lambda _b, el, _idx: el, [self.element_type, IntegerType], k2)
        else:
            k2 = _function_out_type(key, _elem_in(key, self.element_type))
            callback = EastFunction(_idx_cb(key), [self.element_type, IntegerType], k2)
        return _call_builtin("ArrayToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def unique(self) -> EastSet:
        """The set of distinct elements (east-c ArrayToSet with an identity key).

        Returns:
            A set of the distinct (East-equal) elements.
        """
        return self.to_set()

    def to_vector(self) -> Any:
        """The elements as a Vector, in order (east-c VectorFromArray).

        The Array-side entry to the tensor surface (#601): a computed
        ``Array<Float/Integer/Boolean>`` becomes the contiguous ``Vector``
        the arithmetic, reduction and sparse builtins take. The traced twin
        emits the same builtin, so a function can seed a tensor from per-row
        values without leaving east-c.

        Returns:
            A ``Vector`` of this array's element type.

        Raises:
            TypeError: If the element type is not Float, Integer or Boolean
                (the Vector element kinds).
        """
        from east.types.types import VectorType

        if self.element_type.type not in ("Float", "Integer", "Boolean"):
            raise TypeError(
                f".to_vector() needs Float, Integer or Boolean elements, "
                f"got {self.element_type.type}")
        return _call_builtin(
            "VectorFromArray", [self.element_type], [self], VectorType(self.element_type))

    def to_dict(self, key: Any, value: Any = None, combine: Any = None) -> EastDict:
        """Build a dict keyed by ``key(element)`` from the array (east-c ArrayToDict).

        Args:
            key: ``fn(element) -> dict key`` (``fn(element, index)`` also
                accepted); its result type becomes the dict key type.
            value: Optional ``fn(element[, index]) -> value``; defaults to the
                element itself. Its result type becomes the dict value type.
            combine: Optional ``fn(existing, incoming[, key]) -> value`` to
                resolve a key collision. Without it a duplicate key errors,
                like every other East runtime.

        Returns:
            A dict with East-ordered keys. An empty array yields an empty dict.
        """
        from east.types.types import DictType, IntegerType

        # The callbacks' captured output types ARE the dict's types — an empty
        # array derives exactly what a full one derives, so the same program
        # cannot change result type with the data (#450/#525).
        value_fn = (lambda _b, el: el) if value is None else value
        k2 = _function_out_type(key, _elem_in(key, self.element_type))
        t2 = self.element_type if value is None else _function_out_type(
            value, _elem_in(value, self.element_type))
        if len(self) == 0:
            return EastDict(k2, t2)
        key_cb = EastFunction(_idx_cb(key), [self.element_type, IntegerType], k2)
        val_cb = EastFunction(_idx_cb(value_fn), [self.element_type, IntegerType], t2)
        combine_cb = EastFunction(_combine_cb(combine, k2, t2), [t2, t2, k2], t2)
        return _call_builtin("ArrayToDict", [self.element_type, k2, t2], [self, key_cb, val_cb, combine_cb], DictType(k2, t2))

    def map(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Apply ``fn`` to each element, producing a new array (east-c ArrayMap).

        Args:
            fn: ``fn(element) -> new value`` (``fn(element, index)`` also
                accepted, matching the builtin's callback).
            out: Optional result element type. When omitted, it is the
                callback's captured output type.

        Returns:
            A new array of the same length; an empty array yields an empty array
            of element type ``out`` (or the callback's captured output type).
        """
        from east.types.types import ArrayType, IntegerType

        _check_function_out(fn, out)
        t2 = out if out is not None else _function_out_type(
            fn, _elem_in(fn, self.element_type))
        if len(self) == 0:
            return EastArray(t2, [])
        callback = EastFunction(_idx_cb(fn), [self.element_type, IntegerType], t2)
        return _call_builtin("ArrayMap", [self.element_type, t2], [self, callback], ArrayType(t2))

    def filter(self, predicate: Any) -> EastArray:
        """Keep elements for which ``predicate`` is truthy (east-c ArrayFilter).

        Args:
            predicate: ``fn(element) -> bool``; the index is not passed.

        Returns:
            A new array of the matching elements in original order.
        """
        from east.expression import Expression
        from east.types.types import ArrayType, BooleanType, IntegerType

        # bool() coerces python truthiness only — a traced predicate stays a
        # Boolean expression so pure lambdas build into east-c
        wants_idx = _callback_arity(predicate, 1) >= 2

        def _pred(b, el, idx):  # noqa: ANN001, ANN202
            r = predicate(b, el, idx) if wants_idx else predicate(b, el)
            return r if isinstance(r, Expression) else bool(r)

        callback = EastFunction(_mark_function(_pred, predicate), [self.element_type, IntegerType], BooleanType)
        return _call_builtin("ArrayFilter", [self.element_type], [self, callback], ArrayType(self.element_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Transform and filter in one pass, keeping ``some`` results (east-c ArrayFilterMap).

        Args:
            fn: ``fn(element) -> some(value) | none``; the index is not passed.
                Elements mapped to ``none`` are dropped.
            out: Optional result element type. When omitted, it is the
                ``some`` payload type the callback captures.

        Returns:
            A new array of the unwrapped ``some`` values; an empty input yields
            an empty array of element type ``out`` (or the ``some`` payload
            type the callback captures).
        """
        from east.types.types import ArrayType, IntegerType, NullType, OptionType, VariantType

        if out is not None:
            _check_function_out(fn, OptionType(out))
        if out is not None:
            t2 = out
        else:
            from east.types.types import get_option_inner_type

            # `fn` returns an Option and this site wants its INNER type, so the
            # capture is asked with the element type and its answer unwrapped.
            t2 = get_option_inner_type(
                _function_out_type(fn, _elem_in(fn, self.element_type)))
        if len(self) == 0:
            return EastArray(t2, [])
        out_variant = VariantType([("none", NullType), ("some", t2)])
        callback = EastFunction(_idx_cb(fn), [self.element_type, IntegerType], out_variant)
        return _call_builtin("ArrayFilterMap", [self.element_type, t2], [self, callback], ArrayType(t2))

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First ``some(value)`` that ``fn`` produces while scanning (east-c ArrayFirstMap).

        Args:
            fn: ``fn(element) -> some(value) | none``; the index is not passed.
                The scan stops at the first ``some``.
            out: Optional payload type for the result variant. When omitted, it
                is the ``some`` payload type the callback captures.

        Returns:
            ``some(value)`` for the first matching element, else ``none``; an
            empty array yields ``none``.
        """
        from east.types.types import IntegerType, NullType, OptionType, VariantType

        if out is not None:
            _check_function_out(fn, OptionType(out))
        if out is not None:
            t2 = out
        else:
            from east.types.types import get_option_inner_type

            # `fn` returns an Option and this site wants its INNER type, so the
            # capture is asked with the element type and its answer unwrapped.
            t2 = get_option_inner_type(
                _function_out_type(fn, _elem_in(fn, self.element_type)))
        if len(self) == 0:
            return EastVariant("none", east_null)
        out_variant = VariantType([("none", NullType), ("some", t2)])
        callback = EastFunction(_idx_cb(fn), [self.element_type, IntegerType], out_variant)
        return _call_builtin("ArrayFirstMap", [self.element_type, t2], [self, callback], out_variant)

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Any:
        """Map each element then pairwise-combine the mapped values (east-c ArrayMapReduce).

        Args:
            map_fn: ``fn(element) -> mapped value``; the index is not passed.
            reduce_fn: ``fn(left, right) -> combined`` applied pairwise over the
                mapped values; it should be associative for a well-defined result.
            out: Optional type of the mapped/result value. When omitted, it is
                ``map_fn``'s captured output type.

        Returns:
            The single reduced value.

        Raises:
            Errors on an empty array, since there is no identity value to
            return; guard with ``len`` if the array may be empty.
        """
        from east.types.types import IntegerType

        _check_function_out(map_fn, out)
        _check_function_out(reduce_fn, out)
        if len(self) == 0:
            from east.runtime.errors import EastError

            raise EastError("Cannot reduce empty array with no initial value", [])
        t2 = out if out is not None else _function_out_type(
            map_fn, _elem_in(map_fn, self.element_type))
        map_cb = EastFunction(_idx_cb(map_fn), [self.element_type, IntegerType], t2)
        reduce_cb = EastFunction(_mark_function(lambda b, x, y: reduce_fn(b, x, y), reduce_fn), [t2, t2], t2)
        return _call_builtin("ArrayMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def reduce(self, fn: Any, init: Any) -> Any:
        """Left-fold the elements from ``init`` (east-c ArrayFold; TS
        ``reduce(fn, init)``).

        Args:
            fn: ``fn(accumulator, element) -> new accumulator``
                (``fn(accumulator, element, index)`` also accepted), applied
                left-to-right.
            init: The starting accumulator; its type fixes the result type.

        Returns:
            The final accumulator; ``init`` itself for an empty array.
        """
        from east.types.types import IntegerType

        fn, init = _fn_init("reduce", fn, init)
        t2 = _ev.type_of(init)
        callback = EastFunction(_acc_idx_cb(fn), [t2, self.element_type, IntegerType], t2)
        return _call_builtin("ArrayFold", [self.element_type, t2], [self, init, callback], t2)

    def fold(self, initial: Any, fn: Any) -> Any:
        """Deprecated alias of :meth:`reduce` (the TypeScript name and
        argument order, ``reduce(fn, init)``)."""
        import warnings

        warnings.warn(
            ".fold(init, fn) is deprecated: the spelling is .reduce(fn, init) "
            "(the TypeScript name and order)",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.reduce(fn, initial)

    def scan(self, fn: Any, init: Any) -> EastArray:
        """Running fold: the array of every intermediate accumulator (east-c
        ArrayScan; TS ``scan(fn, init)``).

        Element ``i`` of the result is the accumulator after folding element
        ``i`` — the result has the same length as this array, the seed is not
        emitted, and for a non-empty array the last element equals
        ``reduce(fn, init)``. An empty array scans to an empty array.

        Args:
            fn: ``fn(accumulator, element) -> new accumulator``
                (``fn(accumulator, element, index)`` also accepted), applied
                left-to-right.
            init: The starting accumulator; its type fixes the result's
                element type. Not emitted into the result.

        Returns:
            A new array of the successive accumulator values, one per element.
        """
        from east.types.types import ArrayType, IntegerType

        fn, init = _fn_init("scan", fn, init)
        t2 = _ev.type_of(init)
        callback = EastFunction(_acc_idx_cb(fn), [t2, self.element_type, IntegerType], t2)
        return _call_builtin("ArrayScan", [self.element_type, t2], [self, init, callback], ArrayType(t2))

    def flat_map(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Map each element to an array and concatenate the results (east-c
        ArrayFlattenToArray; TS ``flatMap``).

        Args:
            fn: ``fn(element) -> array``; the index is not passed.
            out: Optional element type of the inner arrays. When omitted, it is
                the element type of the array ``fn`` captures.

        Returns:
            A new flat array; an empty input yields an empty array of element
            type ``out`` (or the element type the callback's arrays carry).
        """
        from east.types.types import ArrayType, IntegerType

        if out is not None:
            _check_function_out(fn, ArrayType(out))
        t2 = out if out is not None else _function_out_type(
            fn, _elem_in(fn, self.element_type)).value
        if len(self) == 0:
            return EastArray(t2, [])
        callback = EastFunction(_idx_cb(fn), [self.element_type, IntegerType], ArrayType(t2))
        return _call_builtin("ArrayFlattenToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    flatten_to_array = _deprecated_alias("flatten_to_array", "flat_map")

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Map each element to a set and union the results (east-c ArrayFlattenToSet).

        Args:
            fn: ``fn(element) -> set``; the index is not passed.
            out: Optional element type of the inner sets. When omitted, it is
                the element type of the set ``fn`` captures.

        Returns:
            A set of the distinct (East-equal) elements across all produced sets;
            an empty input yields an empty set.
        """
        from east.types.types import IntegerType, SetType

        if out is not None:
            _check_function_out(fn, SetType(out))
        k2 = out if out is not None else _function_out_type(
            fn, _elem_in(fn, self.element_type)).value
        if len(self) == 0:
            return EastSet(k2)
        callback = EastFunction(_idx_cb(fn), [self.element_type, IntegerType], SetType(k2))
        return _call_builtin("ArrayFlattenToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> EastDict:
        """Map each element to a dict and merge the results (east-c ArrayFlattenToDict).

        Args:
            fn: ``fn(element) -> dict`` (``fn(element, index)`` also accepted).
                The key and value types are those of the dict ``fn`` captures.
            combine: Optional ``fn(existing, incoming[, key]) -> value`` to
                resolve a shared key. Without it a duplicate key errors, like
                every other East runtime.

        Returns:
            A merged dict with East-ordered keys; an empty input yields an empty dict.
        """
        from east.types.types import DictType, IntegerType

        # The callback's captured Dict type carries both parameters, empty
        # input or not. The degenerate `(element_type, element_type)` bail it
        # replaced did not merely disagree with the traced twin: on a struct
        # element with an Array field it RAISES, since a mutable type cannot
        # key a Dict (#522/#525).
        _ko = _function_out_type(fn, _elem_in(fn, self.element_type))
        k2, t2 = _ko.value["key"], _ko.value["value"]
        map_cb = EastFunction(_idx_cb(fn), [self.element_type, IntegerType], DictType(k2, t2))
        combine_cb = EastFunction(_combine_cb(combine, k2, t2), [t2, t2, k2], t2)
        return _call_builtin("ArrayFlattenToDict", [self.element_type, k2, t2], [self, map_cb, combine_cb], DictType(k2, t2))

    def for_each(self, fn: Any) -> None:
        """Call ``fn`` once per element for its side effects (east-c ArrayForEach).

        Args:
            fn: ``fn(element) -> any`` (``fn(element, index)`` also accepted);
                the return value is discarded.

        Returns:
            None.
        """
        from east.expression import _sequence_effect
        from east.types.types import IntegerType, NullType

        run = (lambda b, el, idx: _sequence_effect(fn(b, el, idx))) if _callback_arity(fn, 1) >= 2 \
            else (lambda b, el, _idx: _sequence_effect(fn(b, el)))
        callback = EastFunction(run, [self.element_type, IntegerType], NullType)
        _call_builtin("ArrayForEach", [self.element_type, NullType], [self, callback], NullType)

    def group_by(self, key: Any) -> EastDict:
        """Group elements into a dict of arrays keyed by ``key(element)`` (east-c ArrayGroupFold).

        Args:
            key: ``fn(element) -> group key``; its captured result type becomes
                the dict key type.

        Returns:
            A dict mapping each group key to an array of its elements, with keys
            in East total order.
        """
        from east.expression import _append_function, _empty_array_function, capture_callback
        from east.types.types import ArrayType, DictType, IntegerType

        bucket_type = ArrayType(self.element_type)
        k2 = _function_out_type(key, _elem_in(key, self.element_type))
        if len(self) == 0:
            return EastDict(k2, bucket_type)

        # The key captures (#625) and pairs with the hand-built init/append
        # functions, so the whole grouping runs inside east-c.
        # ArrayGroupFold callbacks carry the element index: key(elem, idx),
        # init(group_key), fold(acc, elem, idx).
        key_cb = EastFunction(_idx_cb(key), [self.element_type, IntegerType], k2)
        native_key = capture_callback(key_cb)
        return _call_builtin(
            "ArrayGroupFold",
            [self.element_type, k2, bucket_type],
            [self, native_key, _empty_array_function(k2, self.element_type),
             _append_function(self.element_type)],
            DictType(k2, bucket_type),
        )

    # ----- Reduction & group sugar (TS-expr parity; composes east-c builtins
    # with traced/hand-built native functions — no python loops) ---------------

    def _numeric_zero(self, t: EastType) -> Any:
        """The additive identity for ``t`` — one rule for the whole family."""
        return _numeric_zero_for(t)

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
            step = EastFunction(lambda _b, acc, el, _i: acc + el, [t, t, IntegerType], t)
            return _call_builtin("ArrayFold", [t, t], [self, zero, step], t)
        # The zero is typed from the PROJECTION, empty array or not: gating the
        # derivation on `len(self)` typed an empty array's zero from the
        # element type, so a numeric projection over non-numeric elements
        # RAISED when empty while working non-empty (#450/#525).
        t2 = _function_out_type(fn, _elem_in(fn, self.element_type))
        zero = self._numeric_zero(t2)
        wants_idx = _callback_arity(fn, 1) >= 2
        step = EastFunction(
            (lambda b, acc, el, i: acc + fn(b, el, i)) if wants_idx
            else (lambda b, acc, el, _i: acc + fn(b, el)),
            [t2, self.element_type, IntegerType], t2
        )
        return _call_builtin("ArrayFold", [self.element_type, t2], [self, zero, step], t2)

    def mean(self, fn: Any = None) -> float:
        """Arithmetic mean as a Float (NaN for an empty array, like TS).

        Args:
            fn: Optional numeric projection applied before averaging.
        """
        from east.types.types import FloatType, IntegerType

        n = len(self)
        if n == 0:
            return float("nan")
        # The Integer-vs-Float decision comes from the TYPE SYSTEM, once —
        # not from probing each value in python (#470): a Float projection
        # passes through untouched, an Integer one widens with the East
        # builtin, which the eager funnel makes dual-mode.
        t2 = self.element_type if fn is None else _function_out_type(
            fn, _elem_in(fn, self.element_type))
        proj = _float_proj(fn, t2)
        p_wants = _callback_arity(proj, 1) >= 2
        step = EastFunction(
            (lambda b, acc, el, i: acc + proj(b, el, i)) if p_wants
            else (lambda b, acc, el, _i: acc + proj(b, el)),
            [FloatType, self.element_type, IntegerType], FloatType
        )
        total = _call_builtin("ArrayFold", [self.element_type, FloatType], [self, 0.0, step], FloatType)
        return total / float(n)

    @staticmethod
    def _keep_pair(pair_t: EastType, field: str, want_max: bool) -> Any:
        """The NON-STRICT ``(b, x, y) -> x | y`` chooser behind every extreme:
        ``x`` is the incumbent (earlier) pair, so a tie keeps the first — the
        earliest element/index, matching the traced twin and TS. The East
        namespace is dual-mode, so this captures natively."""
        from east.expression import if_else
        from east.namespace import East

        p_t = next(f["type"] for f in pair_t.value if f["name"] == field)
        if want_max:
            return lambda _b, x, y: if_else(East.greater_equal(p_t, x[field], y[field]), x, y)
        return lambda _b, x, y: if_else(East.less_equal(p_t, x[field], y[field]), x, y)

    def _extreme_pair(self, by: Any, want_max: bool) -> Any:
        """``{element, key}`` of the first extreme element by ``by(element)``
        (the element itself when omitted) — ONE native ArrayMapReduce, as the
        traced twin and TS compose ``maximum``/``minimum``. Errors on an
        empty array."""
        from east.types.types import IntegerType, StructType

        if len(self) == 0:
            from east.runtime.errors import EastError

            raise EastError("Cannot reduce empty array with no initial value", [])
        proj: Any = by if by is not None else (lambda _b, el: el)
        p_t = _function_out_type(proj, _elem_in(proj, self.element_type))
        pf = _as_idx_fn(proj)
        pair_t = StructType([("element", self.element_type), ("key", p_t)])
        map_cb = EastFunction(lambda b, el, i: {"element": el, "key": pf(b, el, i)},
                              [self.element_type, IntegerType], pair_t)
        reduce_cb = EastFunction(self._keep_pair(pair_t, "key", want_max), [pair_t, pair_t], pair_t)
        return _call_builtin("ArrayMapReduce", [self.element_type, pair_t],
                             [self, map_cb, reduce_cb], pair_t)

    def _extreme_index_pair(self, by: Any, want_max: bool, base: int = 0) -> Any:
        """``{by, index}`` of the first extreme element (native ArrayMapReduce);
        ``base`` rebases the index, so a segment-streamed file reports global
        rows. Errors on an empty array."""
        from east.types.types import IntegerType, StructType

        if len(self) == 0:
            from east.runtime.errors import EastError

            raise EastError("Cannot reduce empty array with no initial value", [])
        proj: Any = by if by is not None else (lambda _b, el: el)
        p_t = _function_out_type(proj, _elem_in(proj, self.element_type))
        pf = _as_idx_fn(proj)
        pair_t = StructType([("by", p_t), ("index", IntegerType)])
        map_cb = EastFunction(
            lambda b, el, i: {"by": pf(b, el, i), "index": i + base if base else i},
            [self.element_type, IntegerType], pair_t)
        reduce_cb = EastFunction(self._keep_pair(pair_t, "by", want_max), [pair_t, pair_t], pair_t)
        return _call_builtin("ArrayMapReduce", [self.element_type, pair_t],
                             [self, map_cb, reduce_cb], pair_t)

    def _reduce_pairs(self, field: str, want_max: bool) -> Any:
        """Reduce this Array of pair structs to the first extreme by ``field``
        (the segment-streamed file merges its per-segment candidates here)."""
        from east.types.types import IntegerType

        pair_t = self.element_type
        map_cb = EastFunction(lambda _b, pair, _i: pair, [pair_t, IntegerType], pair_t)
        reduce_cb = EastFunction(self._keep_pair(pair_t, field, want_max), [pair_t, pair_t], pair_t)
        return _call_builtin("ArrayMapReduce", [pair_t, pair_t], [self, map_cb, reduce_cb], pair_t)

    def maximum(self, by: Any = None) -> Any:
        """The largest element under East's total order — of ``by(element)``
        when given, returning the ELEMENT (TS ``maximum``; one native
        ArrayMapReduce). Raises on an empty array; a tie keeps the first."""
        return self._extreme_pair(by, True)["element"]

    def minimum(self, by: Any = None) -> Any:
        """The smallest element under East's total order — of ``by(element)``
        when given, returning the ELEMENT (TS ``minimum``). Raises on an
        empty array; a tie keeps the first."""
        return self._extreme_pair(by, False)["element"]

    def find_maximum(self, by: Any = None) -> Any:
        """Index of the first maximum as ``some(index)``, ``none`` when empty."""
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        if len(self) == 0:
            return _none
        return _some(self._extreme_index_pair(by, True)["index"])

    def find_minimum(self, by: Any = None) -> Any:
        """Index of the first minimum as ``some(index)``, ``none`` when empty."""
        from east.types.construct import none as _none
        from east.types.construct import some as _some

        if len(self) == 0:
            return _none
        return _some(self._extreme_index_pair(by, False)["index"])

    def _first_map_bool(self, want: bool, pred: Any) -> bool:
        """Shared native short-circuit scan: some(True) on the deciding element."""
        from east.expression import Expression, if_else
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import BooleanType, IntegerType, NullType, VariantType

        wants_idx = _callback_arity(pred, 1) >= 2

        def _probe(b, el, i):  # noqa: ANN001, ANN202
            r = pred(b, el, i) if wants_idx else pred(b, el)
            decided = (r if isinstance(r, Expression) else bool(r)) if want else (
                _not_expr(r) if isinstance(r, Expression) else not bool(r)
            )
            if isinstance(decided, Expression):
                return if_else(decided, _some(True), _none)
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
            pred = lambda _b, el: el  # noqa: E731
        return not self._first_map_bool(False, pred)

    def some(self, pred: Any = None) -> bool:
        """True when ``pred`` holds for any element (native short-circuit).

        Without ``pred`` the elements must be Booleans. False when empty.
        """
        if pred is None:
            if self.element_type.type != "Boolean":
                raise TypeError("some() without a predicate needs Boolean elements")
            pred = lambda _b, el: el  # noqa: E731
        return self._first_map_bool(True, pred)

    def find_all(self, value: Any, by: Any = None) -> EastArray:
        """Indices whose element (or projection) equals ``value`` (native
        ArrayFilterMap), in order.
        """
        from east.expression import Expression, if_else
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import ArrayType, IntegerType, NullType, VariantType

        proj: Any = by if by is not None else (lambda _b, el: el)
        wants_idx = _callback_arity(proj, 1) >= 2

        def _probe(b, el, i):  # noqa: ANN001, ANN202
            r = (proj(b, el, i) if wants_idx else proj(b, el)) == value
            if isinstance(r, Expression):
                return if_else(r, _some(i), _none)
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

        # An EMPTY input has the same result type a full one has: the group key
        # and the accumulator both come from the callbacks. Returning a
        # degenerate `(element_type, element_type)` dict made the eager path
        # disagree with the traced one about the RESULT TYPE, invisibly,
        # because both compare equal while empty (#450/#525).
        k2 = _function_out_type(key, _elem_in(key, self.element_type))
        a_t = _function_out_type(init, [k2])
        if len(self) == 0:
            return EastDict(k2, a_t)
        key_cb = EastFunction(_idx_cb(key), [self.element_type, IntegerType], k2)
        init_cb = EastFunction(init, [k2], a_t)
        fold_cb = EastFunction(_acc_idx_cb(fold), [a_t, self.element_type, IntegerType], a_t)
        return _call_builtin(
            "ArrayGroupFold",
            [self.element_type, k2, a_t],
            [self, key_cb, init_cb, fold_cb],
            DictType(k2, a_t),
        )

    def group_size(self, key: Any = None) -> EastDict:
        """Count per group key (native; identity key when omitted)."""
        return self.to_dict(
            key if key is not None else (lambda _b, el: el),
            value=lambda _b, _el: 1,
            combine=lambda _b, x, y: x + y,
        )

    def group_sum(self, key: Any, fn: Any = None) -> EastDict:
        """Sum per group (of elements, or of ``fn(element)``).

        The zero is typed from the projection, exactly as :meth:`sum` types it
        — the two must not disagree about an empty array (#450/#525).
        """
        t2 = self.element_type if fn is None else _function_out_type(
            fn, _elem_in(fn, self.element_type))
        zero = self._numeric_zero(t2)
        proj: Any = fn if fn is not None else (lambda _b, el: el)
        wants_idx = _callback_arity(proj, 1) >= 2
        step = (lambda b, acc, el, i: acc + proj(b, el, i)) if wants_idx \
            else (lambda b, acc, el: acc + proj(b, el))
        return self.group_reduce(key, lambda _b, _k: zero, step)

    def group_mean(self, key: Any, fn: Any = None) -> EastDict:
        """Float mean per group (sum, count and the division all native)."""
        from east.namespace import East
        from east.types.types import FloatType

        k2e = _function_out_type(key, _elem_in(key, self.element_type))
        if len(self) == 0:
            # The key fixes the result type on an empty array too (#525); the
            # mean is always Float.
            return EastDict(k2e, FloatType)
        t2 = self.element_type if fn is None else _function_out_type(
            fn, _elem_in(fn, self.element_type))
        proj = _float_proj(fn, t2)
        p_wants = _callback_arity(proj, 1) >= 2
        step = (lambda b, acc, el, i: acc + proj(b, el, i)) if p_wants \
            else (lambda b, acc, el: acc + proj(b, el))
        sums = self.group_reduce(key, lambda _b, _k: 0.0, step)
        # Divide sum by count native-side: merge the (widened) counts into the
        # fresh sums dict instead of rebuilding through a python closure over
        # the counts dict, which could never trace (#470).
        counts = self.group_size(key).map(lambda _b, c: East.Integer.to_float(c), out=FloatType)
        sums.merge_all(counts, lambda _b, s, c, _k: s / c, lambda _b, _k: 0.0)
        return sums

    def _group_extreme_pairs(self, key: Any, by: Any, want_max: bool) -> EastDict:
        """``Dict<group key, {by, elem}>`` of each group's extreme element
        (native ArrayToDict over ``{by, elem}`` pairs whose collision handler
        compares NON-strictly — the traced twin's and TS's shape). The
        segment-streamed file merges these per segment under the same rule."""
        from east.types.types import DictType, IntegerType, StructType

        proj: Any = by if by is not None else (lambda _b, el: el)
        # Derived BEFORE the empty check: an empty array has the same result
        # type a full one has, and the traced twin derives it unconditionally,
        # so bailing to `(element_type, element_type)` made the two disagree
        # (#450/#525).
        k2 = _function_out_type(key, _elem_in(key, self.element_type))
        p_t = _function_out_type(proj, _elem_in(proj, self.element_type))
        pair_t = StructType([("by", p_t), ("elem", self.element_type)])
        if len(self) == 0:
            return EastDict(k2, pair_t)
        kf, pf = _as_idx_fn(key), _as_idx_fn(proj)
        key_cb = EastFunction(kf, [self.element_type, IntegerType], k2)
        val_cb = EastFunction(lambda b, el, i: {"by": pf(b, el, i), "elem": el},
                              [self.element_type, IntegerType], pair_t)
        return _call_builtin(
            "ArrayToDict", [self.element_type, k2, pair_t],
            [self, key_cb, val_cb, self._group_extreme_combine(pair_t, k2, want_max)],
            DictType(k2, pair_t))

    def _group_extreme(self, key: Any, by: Any, want_max: bool) -> EastDict:
        return self._group_extreme_pairs(key, by, want_max).map(
            lambda _b, pair: pair["elem"], out=self.element_type)

    def group_maximum(self, key: Any, by: Any = None) -> EastDict:
        """The largest element per group under East's total order — of
        ``by(element)`` when given, returning the ELEMENT (TS ``groupMaximum``;
        native). A tie keeps the first."""
        return self._group_extreme(key, by, True)

    def group_minimum(self, key: Any, by: Any = None) -> EastDict:
        """The smallest element per group under East's total order — of
        ``by(element)`` when given, returning the ELEMENT (TS ``groupMinimum``;
        native). A tie keeps the first."""
        return self._group_extreme(key, by, False)

    def _find_index_pairs(self, key: Any, value: Any, by: Any, base: int = 0) -> tuple:
        """Native scan to ``Array<{i, k}>`` — global index + group key — over
        the elements whose projection equals ``value`` (ArrayFilterMap).

        The shared machinery behind :meth:`group_find_all` /
        :meth:`group_find_first`: matching is one native pass, and grouping the
        surviving pairs afterwards keeps the whole composition inside east-c.

        Args:
            key: ``key(element[, index]) -> group key``.
            value: The value matched against the projection.
            by: Optional projection; the element itself when omitted.
            base: Added to every emitted index INSIDE the traced probe, so a
                segment-streamed file rebases to global row indices natively.
                Rebasing the grouped result afterwards instead would cost a
                python callback per group per segment — O(rows) python calls
                on a file whose segments are small (#470).
        """
        from east.expression import Expression, if_else
        from east.namespace import East
        from east.types.coercion import coerce_to
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import ArrayType, IntegerType, NullType, StructType, VariantType

        proj: Any = by if by is not None else (lambda _b, el: el)
        k2 = _function_out_type(key, _elem_in(key, self.element_type))
        p_t = _function_out_type(proj, _elem_in(proj, self.element_type))
        # Coerce the target INTO the projection's type, exactly as `_search_key`
        # does for the ungrouped `find_*` family. Without this, `East.equal`
        # compares a python `int` target against a Float projection under East's
        # cross-type total order and is never true, so `group_find_all(2, ...)`
        # over Float data reported NO matches while the traced twin — which
        # lifts the literal with `hint=p_t` — reported them. Same call, two
        # answers, decided only by whether the enclosing lambda happened to
        # trace (#525).
        value = coerce_to(value, p_t)
        pair_t = StructType([("i", IntegerType), ("k", k2)])
        kf, pf = _as_idx_fn(key), _as_idx_fn(proj)

        def _probe(b, el, i):  # noqa: ANN001, ANN202
            # East equality, not python `==`: the East namespace is dual-mode,
            # so a traced callback emits IR and an untraceable one runs east-c
            # on the values — the two paths then agree on -0.0/NaN and on every
            # structured type, which python `==` does not guarantee.
            r = East.equal(p_t, pf(b, el, i), value)
            gi = i + base if base else i
            if isinstance(r, Expression):
                return if_else(r, _some({"i": gi, "k": kf(b, el, i)}), _none)
            return _some({"i": gi, "k": kf(b, el, i)}) if r else _none

        out_variant = VariantType([("none", NullType), ("some", pair_t)])
        callback = EastFunction(_probe, [self.element_type, IntegerType], out_variant)
        pairs = _call_builtin(
            "ArrayFilterMap", [self.element_type, pair_t], [self, callback], ArrayType(pair_t)
        )
        return pairs, k2, pair_t

    def group_find_all(self, key: Any, value: Any, by: Any = None) -> EastDict:
        """Indices of every element equal to ``value``, per group (native).

        Args:
            key: ``key(element) -> group key`` (``key(element, index)`` also
                accepted).
            value: The value matched against ``by(element)`` — or the element
                itself when ``by`` is omitted — under East equality.
            by: Optional projection ``by(element) -> comparable``.

        Returns:
            A dict from each group key to the array of matching GLOBAL indices,
            in row order. Every group the array has appears, so a group with no
            match maps to an empty array (TS ``groupFindAll`` parity).
        """
        from east.expression import _empty_array_function
        from east.types.types import ArrayType, IntegerType

        # The key fixes the GROUP KEY type even with no rows; the value type is
        # Array<Integer> either way. Bailing to `element_type` made the eager
        # result a differently-typed empty dict from the traced one, and the
        # two only diverge on empty input — invisibly, until a consumer unions
        # or declares the type (#525).
        k2e = _function_out_type(key, _elem_in(key, self.element_type))
        if len(self) == 0:
            return EastDict(k2e, ArrayType(IntegerType))
        pairs, k2, _pair_t = self._find_index_pairs(key, value, by)
        # The groups come from the WHOLE array and the matches fill them in, so
        # a group whose members all failed still appears (with an empty array).
        groups = self.to_set(key)
        found = pairs.group_to_arrays(lambda _b, p: p["k"], lambda _b, p: p["i"]) if len(pairs) \
            else EastDict(k2, ArrayType(IntegerType))
        # The compiled group-init function, not `lambda _k: EastArray(...)`: a
        # python fill closes over EastArray, an eager constructor the capture
        # refuses — and before #625 it silently ran python once per UNMATCHED
        # group, linear in an unbounded group count and invisible whenever
        # every group happened to match (#470).
        return found.get_keys(groups, _empty_array_function(k2, IntegerType))

    def group_find_first(self, key: Any, value: Any, by: Any = None) -> EastDict:
        """First index equal to ``value``, per group (native).

        Args:
            key: ``key(element) -> group key``.
            value: The value matched against ``by(element)`` (or the element).
            by: Optional projection ``by(element) -> comparable``.

        Returns:
            A dict from each group key to ``some(global index)`` for its first
            match, or ``none`` for a group with no match (TS parity).
        """
        from east.types.types import IntegerType, OptionType

        k2e = _function_out_type(key, _elem_in(key, self.element_type))
        if len(self) == 0:
            return EastDict(k2e, OptionType(IntegerType))
        # group_find_all already yields matches in row order per group, so the
        # first match is element 0 — and `out=` pins Option<Integer> rather
        # than letting a `some`-only sample type the dict (#450).
        return self.group_find_all(key, value, by).map(
            lambda _b, idxs: idxs.try_get(0), out=OptionType(IntegerType))

    @staticmethod
    def _group_extreme_combine(pair_t: EastType, key_type: EastType, want_max: bool) -> EastFunction:
        """The ``{by, …}`` collision handler behind the grouped extremes
        (``{by, elem}`` for group_maximum/minimum, ``{by, index}`` for the
        group_find twins): :meth:`_keep_pair` with the key the builtin also
        passes. Shared with the beast2 file surface, which merges per-segment
        pairs under the same first-wins rule.
        """
        keep = EastArray._keep_pair(pair_t, "by", want_max)
        return EastFunction(lambda b, x, y, _k: keep(b, x, y), [pair_t, pair_t, key_type], pair_t)

    def _group_find_extreme_pairs(self, key: Any, by: Any, want_max: bool) -> EastDict:
        """``Dict<group key, {by, index}>`` of each group's extreme element
        (native ArrayToDict) — the index-carrying form the public
        :meth:`group_find_minimum` / :meth:`group_find_maximum` project, and
        the shape a segment-streamed file merges across segments."""
        from east.types.types import DictType, IntegerType, StructType

        proj: Any = by if by is not None else (lambda _b, el: el)
        k2 = _function_out_type(key, _elem_in(key, self.element_type))
        p_t = _function_out_type(proj, _elem_in(proj, self.element_type))
        pair_t = StructType([("by", p_t), ("index", IntegerType)])
        kf, pf = _as_idx_fn(key), _as_idx_fn(proj)
        key_cb = EastFunction(kf, [self.element_type, IntegerType], k2)
        val_cb = EastFunction(lambda b, el, i: {"by": pf(b, el, i), "index": i},
                              [self.element_type, IntegerType], pair_t)
        return _call_builtin(
            "ArrayToDict", [self.element_type, k2, pair_t],
            [self, key_cb, val_cb, self._group_extreme_combine(pair_t, k2, want_max)],
            DictType(k2, pair_t))

    def _group_find_extreme(self, key: Any, by: Any, want_max: bool) -> EastDict:
        from east.types.types import IntegerType

        k2e = _function_out_type(key, _elem_in(key, self.element_type))
        if len(self) == 0:
            return EastDict(k2e, IntegerType)
        pairs = self._group_find_extreme_pairs(key, by, want_max)
        return pairs.map(lambda _b, v: v["index"], out=IntegerType)

    def group_find_minimum(self, key: Any, by: Any = None) -> EastDict:
        """Index of the smallest element/projection per group (East total
        order; a tie keeps the earliest index, like TS)."""
        return self._group_find_extreme(key, by, want_max=False)

    def group_find_maximum(self, key: Any, by: Any = None) -> EastDict:
        """Index of the largest element/projection per group (East total
        order; a tie keeps the earliest index, like TS)."""
        return self._group_find_extreme(key, by, want_max=True)

    def group_every(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for all members (native)."""
        step = (lambda b, acc, el, i: acc & pred(b, el, i)) if _callback_arity(pred, 1) >= 2 \
            else (lambda b, acc, el: acc & pred(b, el))
        return self.group_reduce(key, lambda _b, _k: True, step)

    def group_some(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for any member (native)."""
        step = (lambda b, acc, el, i: acc | pred(b, el, i)) if _callback_arity(pred, 1) >= 2 \
            else (lambda b, acc, el: acc | pred(b, el))
        return self.group_reduce(key, lambda _b, _k: False, step)

    def _group_pairs(self, key: Any, value: Any, extra: Any = None) -> tuple:
        from east.types.types import IntegerType, StructType

        # The captured callback types ARE the pair type (#450). This site backs
        # group_to_dicts / group_to_arrays / group_to_sets and was MISSED by the
        # original fix, so a key OR value containing a `none` still failed here
        # with "Unknown variant case: none" while group_by and to_dict were
        # already correct.
        k_t = _function_out_type(key, _elem_in(key, self.element_type))
        v_t = _function_out_type(value, _elem_in(value, self.element_type))
        kf, vf = _as_idx_fn(key), _as_idx_fn(value)
        if extra is None:
            pair_t = StructType([("k", k_t), ("v", v_t)])
            pair_cb = EastFunction(
                lambda b, el, i: {"k": kf(b, el, i), "v": vf(b, el, i)},
                [self.element_type, IntegerType],
                pair_t,
            )
        else:
            xf = _as_idx_fn(extra)
            pair_t = StructType(
                [("k", k_t),
                 ("k2", _function_out_type(extra, _elem_in(extra, self.element_type))),
                 ("v", v_t)]
            )
            pair_cb = EastFunction(
                lambda b, el, i: {"k": kf(b, el, i), "k2": xf(b, el, i), "v": vf(b, el, i)},
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
        from east.expression import _append_field_function, _empty_array_function
        from east.types.types import ArrayType, DictType, IntegerType

        if value is None:
            return self.group_by(key)
        # The callbacks fix the result type even with no rows (#525).
        k2e = _function_out_type(key, _elem_in(key, self.element_type))
        v_te = _function_out_type(value, _elem_in(value, self.element_type))
        if len(self) == 0:
            return EastDict(k2e, ArrayType(v_te))
        pairs, pair_t = self._group_pairs(key, value)
        k2 = next(f["type"] for f in pair_t.value if f["name"] == "k")
        v_t = next(f["type"] for f in pair_t.value if f["name"] == "v")
        key_cb = EastFunction(lambda _b, p, _i: p["k"], [pair_t, IntegerType], k2)
        return _call_builtin(
            "ArrayGroupFold",
            [pair_t, k2, ArrayType(v_t)],
            [pairs, key_cb, _empty_array_function(k2, v_t), _append_field_function(pair_t, "v")],
            DictType(k2, ArrayType(v_t)),
        )

    def group_to_sets(self, key: Any, value: Any = None) -> EastDict:
        """Sets of ``value(element)`` per group key (native throughout)."""
        from east.expression import _empty_set_function, _set_insert_field_function
        from east.types.types import DictType, IntegerType, SetType

        val = value if value is not None else (lambda _b, el: el)
        k2e = _function_out_type(key, _elem_in(key, self.element_type))
        v_te = _function_out_type(val, _elem_in(val, self.element_type))
        if len(self) == 0:
            return EastDict(k2e, SetType(v_te))
        pairs, pair_t = self._group_pairs(key, val)
        k2 = next(f["type"] for f in pair_t.value if f["name"] == "k")
        v_t = next(f["type"] for f in pair_t.value if f["name"] == "v")
        key_cb = EastFunction(lambda _b, p, _i: p["k"], [pair_t, IntegerType], k2)
        return _call_builtin(
            "ArrayGroupFold",
            [pair_t, k2, SetType(v_t)],
            [pairs, key_cb, _empty_set_function(k2, v_t), _set_insert_field_function(pair_t, "v")],
            DictType(k2, SetType(v_t)),
        )

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None, combine: Any = None) -> EastDict:
        """Dicts of ``key2 -> value`` per group key.

        Without ``combine`` a duplicate inner key errors (TS parity); with it,
        collisions resolve as ``combine(existing, incoming)``.
        """
        from east.expression import _dict_insert_fields_function, _empty_dict_function
        from east.types.types import DictType, IntegerType

        val = value if value is not None else (lambda _b, el: el)
        k1e = _function_out_type(key, _elem_in(key, self.element_type))
        k2e = _function_out_type(key2, _elem_in(key2, self.element_type))
        v_te = _function_out_type(val, _elem_in(val, self.element_type))
        if len(self) == 0:
            return EastDict(k1e, DictType(k2e, v_te))
        pairs, pair_t = self._group_pairs(key, val, extra=key2)
        k1 = next(f["type"] for f in pair_t.value if f["name"] == "k")
        k2t = next(f["type"] for f in pair_t.value if f["name"] == "k2")
        v_t = next(f["type"] for f in pair_t.value if f["name"] == "v")
        key_cb = EastFunction(lambda _b, p, _i: p["k"], [pair_t, IntegerType], k1)
        if combine is None:
            return _call_builtin(
                "ArrayGroupFold",
                [pair_t, k1, DictType(k2t, v_t)],
                [pairs, key_cb, _empty_dict_function(k1, k2t, v_t),
                 _dict_insert_fields_function(pair_t, "k2", "v")],
                DictType(k1, DictType(k2t, v_t)),
            )

        inner = combine if _callback_arity(combine, 2) >= 3 \
            else (lambda b, ex, inc, _key: combine(b, ex, inc))

        from east.expression import block

        # `insert_or_update` gained a traced spelling in #578, so this fold no
        # longer has to run per element in python. `block` sequences the
        # insert and yields the accumulator on both paths; the statement form
        # would trace to a body of just `acc`, silently dropping every insert.
        # `acc` is an EastDict on the python path and a traced expression on
        # the native one, so it is typed for both.
        def _fold(_b: Any, acc: Any, p: Any, _i: Any) -> Any:
            return block(acc.insert_or_update(p["k2"], p["v"], inner), acc)

        init_cb = _empty_dict_function(k1, k2t, v_t)
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

    # ----- In-place mutation, the TypeScript names (#578) --------------------
    # Each is the builtin its traced twin emits, so the eager and traced
    # spellings agree on names, arguments and errors. The python protocol
    # (`arr[i] = v`, `insert`, `pop(i)`, `remove`, `+=`) stays alongside.

    def push_last(self, value: Any) -> None:
        """Add ``value`` at the end, in place (east-c ArrayPushLast; TS
        ``pushLast``). :meth:`append` takes a whole ARRAY."""
        from east.types.types import NullType

        _call_builtin("ArrayPushLast", [self.element_type], [self, value], NullType)

    def push_first(self, value: Any) -> None:
        """Add ``value`` at the front, in place (east-c ArrayPushFirst; TS
        ``pushFirst``)."""
        from east.types.types import NullType

        _call_builtin("ArrayPushFirst", [self.element_type], [self, value], NullType)

    def append(self, array: Any) -> None:
        """Add every element of ``array`` at the end, in place (east-c
        ArrayAppend; TS ``append``). A single element is :meth:`push_last`;
        any python iterable is :meth:`extend`."""
        from east.types.types import ArrayType, NullType

        _require_operand_type(array, ArrayType(self.element_type), "append")
        _call_builtin("ArrayAppend", [self.element_type], [self, array], NullType)

    def prepend(self, array: Any) -> None:
        """Add every element of ``array`` at the front, in place (east-c
        ArrayPrepend; TS ``prepend``). A single element is :meth:`push_first`."""
        from east.types.types import ArrayType, NullType

        _require_operand_type(array, ArrayType(self.element_type), "prepend")
        _call_builtin("ArrayPrepend", [self.element_type], [self, array], NullType)

    def pop_last(self) -> Any:
        """Remove and return the last element (east-c ArrayPopLast; TS
        ``popLast``); an East runtime error when empty."""
        return _call_builtin("ArrayPopLast", [self.element_type], [self], self.element_type)

    def pop_first(self) -> Any:
        """Remove and return the first element (east-c ArrayPopFirst; TS
        ``popFirst``); an East runtime error when empty."""
        return _call_builtin("ArrayPopFirst", [self.element_type], [self], self.element_type)

    def update(self, index: int, value: Any) -> None:
        """Replace the element at ``index``, in place (east-c ArrayUpdate; TS
        ``update``); an East runtime error when out of bounds."""
        from east.types.types import NullType

        _call_builtin("ArrayUpdate", [self.element_type], [self, int(index), value], NullType)

    set_at = _deprecated_alias("set_at", "update")

    def merge(self, index: int, value: Any, update_fn: Any) -> None:
        """Replace the element at ``index`` with ``update_fn(existing, value
        [, index])``, in place (east-c ArrayMerge; TS ``merge``). ``value``
        may be of another East type — its type is inferred with ``type_of``."""
        from east.types.types import IntegerType, NullType

        v2 = _ev.type_of(value)
        fn = update_fn if _callback_arity(update_fn, 2) >= 3 else (
            lambda b, existing, incoming, _i: update_fn(b, existing, incoming))
        callback = EastFunction(_mark_function(fn, update_fn),
                                [self.element_type, v2, IntegerType], self.element_type)
        _call_builtin("ArrayMerge", [self.element_type, v2],
                      [self, int(index), value, callback], NullType)

    def merge_all(self, array: Any, merge_fn: Any) -> None:
        """Replace every element with ``merge_fn(existing, incoming[, index])``
        over the same-length ``array``, in place (east-c ArrayMergeAll; TS
        ``mergeAll``). ``array``'s elements may be of another East type."""
        from east.types.types import ArrayType, IntegerType, NullType

        other_t = _typed_or_none(array)
        if other_t is None or other_t.type != "Array":
            raise TypeError("merge_all() takes an East Array")
        elem2_t = other_t.value
        _require_operand_type(array, ArrayType(elem2_t), "merge_all")
        fn = merge_fn if _callback_arity(merge_fn, 2) >= 3 else (
            lambda b, existing, incoming, _i: merge_fn(b, existing, incoming))
        callback = EastFunction(_mark_function(fn, merge_fn),
                                [self.element_type, elem2_t, IntegerType], self.element_type)
        _call_builtin("ArrayMergeAll", [self.element_type, elem2_t],
                      [self, array, callback], NullType)

    def reverse_in_place(self) -> None:
        """Reverse the elements in place (east-c ArrayReverseInPlace; TS
        ``reverseInPlace``). :meth:`reverse` returns a new array."""
        from east.types.types import NullType

        _call_builtin("ArrayReverseInPlace", [self.element_type], [self], NullType)

    def sort_in_place(self, by: Any = None) -> None:
        """Sort in place by East's total order of ``by(element)`` — the
        element itself when omitted (east-c ArraySortInPlace; TS
        ``sortInPlace``). :meth:`sort` returns a new array."""
        from east.types.types import NullType

        if by is None:
            t2 = self.element_type
            callback = EastFunction(lambda _b, el: el, [self.element_type], t2)
        else:
            t2 = _function_out_type(by, [self.element_type])
            callback = EastFunction(by, [self.element_type], t2)
        _call_builtin("ArraySortInPlace", [self.element_type, t2], [self, callback], NullType)

    def encode_csv(self, config: Any = None, **options: Any) -> Any:
        """This Array of structs as CSV bytes (east-c ArrayEncodeCsv; TS
        ``encodeCsv``). ``config`` is a ``CsvSerializeConfigType`` value; the
        keyword ``options`` are ``east.serialization.csv.csv_serialize_config``'s."""
        from east.serialization.csv import CsvSerializeConfigType, csv_serialize_config
        from east.types.types import BlobType

        if self.element_type.type != "Struct":
            raise TypeError("encode_csv() needs an Array of structs (the rows)")
        if config is not None and options:
            raise TypeError("encode_csv() takes a config value OR keyword options, not both")
        cfg = config if config is not None else csv_serialize_config(**options)
        return _call_builtin("ArrayEncodeCsv", [self.element_type, CsvSerializeConfigType],
                             [self, cfg], BlobType)

    @classmethod
    def generate(cls, count: int, fn: Any, element_type: EastType | None = None) -> EastArray:
        """Build an array by calling ``fn`` for each index (east-c ArrayGenerate).

        Args:
            count: Number of elements to produce.
            fn: ``fn(index) -> element`` for index ``0 .. count-1``.
            element_type: Optional element type. When omitted, it is the
                callback's captured output type.

        Returns:
            A new array of length ``count``; ``count == 0`` yields an empty array
            of element type ``element_type`` (or the callback's captured type).
        """
        from east.types.types import ArrayType, IntegerType

        _check_function_out(fn, element_type, param="element_type")
        n = int(count)
        t = element_type if element_type is not None else _function_out_type(
            fn, [IntegerType])
        if n == 0:
            return cls(t, [])
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
    def generate(n: int, fn: Any, element_type: EastType | None = None,
                 on_conflict: Any = None) -> EastSet:
        """Build a set from ``fn(i)`` over ``i`` in ``[0, n)`` (east-c SetGenerate).

        Args:
            n: Number of indices to apply ``fn`` to; ``0`` yields an empty set.
            fn: ``fn(index) -> element``.
            element_type: Pins the element type. When omitted it is the
                callback's captured output type.
            on_conflict: ``on_conflict(key)`` run for an element generated
                twice; without it a duplicate is an East runtime error
                ``Duplicate key <key> in set`` (TS ``Set.generate``).

        Returns:
            A new set of the ``fn(i)`` values, in East total order.
        """
        from east.types.types import IntegerType, NullType, SetType

        _check_function_out(fn, element_type, param="element_type")
        k = element_type if element_type is not None else _function_out_type(
            fn, [IntegerType])
        if int(n) == 0:
            return EastSet(k)
        gen = EastFunction(fn, [IntegerType], k)
        if on_conflict is None:
            from east.expression import _error_init_function

            side_fn: Any = _error_init_function(NullType, k, "Duplicate key ", " in set")
        else:
            side_fn = on_conflict
        side = EastFunction(_mark_function(side_fn, side_fn), [k], NullType)
        return _call_builtin("SetGenerate", [k], [int(n), gen, side], SetType(k))

    def has(self, value: Any) -> bool:
        """Whether ``value`` is a member (east-c SetHas, via the live value on a proxy).

        A traced ``value`` emits IR against this set as a constant (#393).
        """
        if _is_traced(value):
            return _lift_traced(self).has(value)
        return value in self

    def insert(self, value: Any) -> None:
        """Add ``value`` in place; it must not already be present (east-c SetInsert).

        Use :meth:`add` / :meth:`try_insert` for the non-erroring spellings.
        """
        from east.types.types import NullType

        _call_builtin("SetInsert", [self.element_type], [self, value], NullType)

    def delete(self, value: Any) -> None:
        """Remove ``value`` in place; it must be present (east-c SetDelete).

        Use :meth:`discard` / :meth:`try_delete` for the non-erroring spellings.
        """
        from east.types.types import NullType

        _call_builtin("SetDelete", [self.element_type], [self, value], NullType)

    def union(self, other: EastSet) -> EastSet:
        """Set union as a new set (east-c SetUnion)."""
        return self._set_op("SetUnion", other, "union")

    def intersection(self, other: EastSet) -> EastSet:
        """Set intersection as a new set (east-c SetIntersect; TS ``intersection``)."""
        return self._set_op("SetIntersect", other, "intersection")

    def difference(self, other: EastSet) -> EastSet:
        """Set difference (elements in self but not ``other``) as a new set
        (east-c SetDiff; TS ``difference``)."""
        return self._set_op("SetDiff", other, "difference")

    def symmetric_difference(self, other: EastSet) -> EastSet:
        """Symmetric difference (elements in exactly one set) as a new set
        (east-c SetSymDiff; TS ``symmetricDifference``)."""
        return self._set_op("SetSymDiff", other, "symmetric_difference")

    intersect = _deprecated_alias("intersect", "intersection")
    diff = _deprecated_alias("diff", "difference")
    sym_diff = _deprecated_alias("sym_diff", "symmetric_difference")

    def size(self) -> int:
        """Number of elements (east-c SetSize; TS ``size``)."""
        return len(self)

    def _set_op(self, name: str, other: EastSet, op: str) -> EastSet:
        from east.types.types import SetType

        _require_operand_type(other, SetType(self.element_type), op)
        return _call_builtin(name, [self.element_type], [self, other], SetType(self.element_type))

    def union_in_place(self, other: EastSet) -> None:
        """Add every element of ``other`` to self in place (east-c SetUnionInPlace)."""
        from east.types.types import NullType
        from east.types.types import SetType as _SetT

        _require_operand_type(other, _SetT(self.element_type), "union_in_place")
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

    def is_subset_of(self, other: EastSet) -> bool:
        """Whether every element of self is also in ``other`` (east-c
        SetIsSubset; TS ``isSubsetOf``)."""
        from east.types.types import BooleanType
        from east.types.types import SetType as _SetT

        _require_operand_type(other, _SetT(self.element_type), "is_subset_of")
        return _call_builtin("SetIsSubset", [self.element_type], [self, other], BooleanType)

    is_subset = _deprecated_alias("is_subset", "is_subset_of")

    def is_superset_of(self, other: EastSet) -> bool:
        """Whether every element of ``other`` is also in self (east-c
        SetIsSubset with the operands swapped — the same spelling TS's
        ``SetExpr.isSupersetOf`` uses)."""
        from east.types.types import BooleanType
        from east.types.types import SetType as _SetT

        _require_operand_type(other, _SetT(self.element_type), "is_superset_of")
        return _call_builtin("SetIsSubset", [self.element_type], [other, self], BooleanType)

    def is_disjoint_from(self, other: EastSet) -> bool:
        """Whether self and ``other`` share no elements (east-c SetIsDisjoint;
        TS ``isDisjointFrom``)."""
        from east.types.types import BooleanType
        from east.types.types import SetType as _SetT

        _require_operand_type(other, _SetT(self.element_type), "is_disjoint_from")
        return _call_builtin("SetIsDisjoint", [self.element_type], [self, other], BooleanType)

    is_disjoint = _deprecated_alias("is_disjoint", "is_disjoint_from")

    def copy(self) -> EastSet:
        """An independent copy of the set (east-c SetCopy)."""
        from east.types.types import SetType

        return _call_builtin("SetCopy", [self.element_type], [self], SetType(self.element_type))

    def for_each(self, fn: Any) -> None:
        """Call ``fn(element)`` for each element, for side effects only (east-c SetForEach).

        Args:
            fn: ``fn(element)``; its return value is discarded.
        """
        from east.expression import _sequence_effect
        from east.types.types import NullType

        callback = EastFunction(lambda b, el: _sequence_effect(fn(b, el)), [self.element_type], NullType)
        _call_builtin("SetForEach", [self.element_type, NullType], [self, callback], NullType)

    def to_array(self, key: Any = None) -> EastArray:
        """Elements as an array in East total order (east-c SetToArray).

        Args:
            key: Optional ``key(element) -> value`` projecting each element; when
                omitted the elements themselves are returned. The result element
                type is the projection's captured output type.

        Returns:
            A new array of the (projected) elements, ordered by East total order.
        """
        from east.types.types import ArrayType

        if key is None:
            t2 = self.element_type
            callback = EastFunction(lambda _b, el: el, [self.element_type], t2)
        else:
            t2 = _function_out_type(key, [self.element_type])
            callback = EastFunction(key, [self.element_type], t2)
        return _call_builtin("SetToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    def to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Set of ``fn(element)`` over all elements (east-c SetToSet).

        Args:
            fn: ``fn(element) -> new element``; collisions in the result collapse.
            out: Pins the result element type; otherwise ``fn``'s captured
                output type.

        Returns:
            A new set of the distinct mapped values.
        """
        from east.types.types import SetType

        _check_function_out(fn, out)
        # Derived BEFORE the empty check — the projection fixes the element
        # type with no members at all (#525).
        k2 = out if out is not None else _function_out_type(fn, [self.element_type])
        if len(self) == 0:
            return EastSet(k2)
        callback = EastFunction(fn, [self.element_type], k2)
        return _call_builtin("SetToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def to_dict(self, key: Any, value: Any, combine: Any = None) -> EastDict:
        """Build a dict keyed by ``key(element)`` with ``value(element)`` (east-c SetToDict).

        Args:
            key: ``key(element) -> dict key``; the key and value types are the
                callbacks' captured output types.
            value: ``value(element) -> dict value``.
            combine: On a key collision, ``combine(existing, incoming[, key])
                -> value`` decides the kept value; without ``combine`` a
                duplicate key errors, like every other East runtime.

        Returns:
            A new dict keyed by the projected keys.
        """
        from east.types.types import DictType

        # Derived BEFORE the empty check (#450) — an empty set has the same
        # result type a full one has. `group_size` delegates here, so the
        # degenerate bail typed its counts as the ELEMENT type:
        # `Set<String>.group_size()` on an empty set yielded Dict<String,String>
        # against the traced Dict<String,Integer>, and folding real counts into
        # it then failed inside east-c (#525).
        k2 = _function_out_type(key, [self.element_type])
        t2 = _function_out_type(value, [self.element_type])
        if len(self) == 0:
            return EastDict(k2, t2)
        key_cb = EastFunction(key, [self.element_type], k2)
        value_cb = EastFunction(value, [self.element_type], t2)
        combine_cb = EastFunction(_combine_cb(combine, k2, t2), [t2, t2, k2], t2)
        return _call_builtin(
            "SetToDict", [self.element_type, k2, t2], [self, key_cb, value_cb, combine_cb], DictType(k2, t2)
        )

    def map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Map each element to a value, keyed by the element itself (east-c SetMap → Dict).

        Args:
            fn: ``fn(element) -> value``; the value type is ``fn``'s captured
                output type unless ``out`` is given.
            out: Pins the result value type.

        Returns:
            A new dict from each element to its mapped value.
        """
        from east.types.types import DictType

        _check_function_out(fn, out)
        t2 = out if out is not None else _function_out_type(fn, [self.element_type])
        if len(self) == 0:
            return EastDict(self.element_type, t2)
        callback = EastFunction(fn, [self.element_type], t2)
        return _call_builtin("SetMap", [self.element_type, t2], [self, callback], DictType(self.element_type, t2))

    def filter(self, predicate: Any) -> EastSet:
        """Keep elements satisfying ``predicate`` (east-c SetFilter).

        Args:
            predicate: ``predicate(element) -> bool``.

        Returns:
            A new set of the elements for which ``predicate`` is true.
        """
        from east.expression import Expression
        from east.types.types import BooleanType, SetType

        def _pred(b, el):  # noqa: ANN001, ANN202
            r = predicate(b, el)
            return r if isinstance(r, Expression) else bool(r)

        callback = EastFunction(_mark_function(_pred, predicate), [self.element_type], BooleanType)
        return _call_builtin("SetFilter", [self.element_type], [self, callback], SetType(self.element_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Map then keep ``some`` results, keyed by the element (east-c SetFilterMap → Dict).

        Args:
            fn: ``fn(element) -> some(value) | none``; ``some`` keeps the element
                with that value, ``none`` drops it. The value type is the ``some``
                payload type ``fn`` captures unless ``out`` is given.
            out: Pins the result value type.

        Returns:
            A new dict from each kept element to its unwrapped value.
        """
        from east.types.types import DictType, OptionType

        if out is not None:
            _check_function_out(fn, OptionType(out))
        if out is not None:
            v2 = out
        else:
            from east.types.types import get_option_inner_type

            v2 = get_option_inner_type(_function_out_type(fn, [self.element_type]))
        if len(self) == 0:
            return EastDict(self.element_type, v2)
        callback = EastFunction(fn, [self.element_type], OptionType(v2))
        return _call_builtin(
            "SetFilterMap", [self.element_type, v2], [self, callback], DictType(self.element_type, v2)
        )

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First ``some(value)`` produced by ``fn`` over elements, else ``none`` (east-c SetFirstMap).

        Elements are visited in East total order, so the result is deterministic.

        Args:
            fn: ``fn(element) -> some(value) | none``; the value type is the
                ``some`` payload type ``fn`` captures unless ``out`` is given.
            out: Pins the ``some`` payload type.

        Returns:
            ``some(value)`` for the first element that yields one, otherwise ``none``.
        """
        from east.types.types import OptionType

        if out is not None:
            _check_function_out(fn, OptionType(out))
        if out is not None:
            t2 = out
        else:
            from east.types.types import get_option_inner_type

            t2 = get_option_inner_type(_function_out_type(fn, [self.element_type]))
        if len(self) == 0:
            return EastVariant("none", east_null)
        callback = EastFunction(fn, [self.element_type], OptionType(t2))
        return _call_builtin("SetFirstMap", [self.element_type, t2], [self, callback], OptionType(t2))

    def map_reduce(self, fn: Any, reduce: Any) -> Any:
        """Map each element then combine the results pairwise (east-c SetMapReduce).

        Args:
            fn: ``fn(element) -> value``; the value/result type is ``fn``'s
                captured output type.
            reduce: ``reduce(a, b) -> combined`` folding the mapped values together.

        Returns:
            The single combined value.

        Raises:
            ValueError: If the set is empty (the operation has no identity element).
        """
        if len(self) == 0:
            raise ValueError("map_reduce on an empty set has no result (no identity element)")
        t2 = _function_out_type(fn, [self.element_type])
        map_cb = EastFunction(fn, [self.element_type], t2)
        reduce_cb = EastFunction(_mark_function(lambda b, x, y: reduce(b, x, y), reduce), [t2, t2], t2)
        return _call_builtin("SetMapReduce", [self.element_type, t2], [self, map_cb, reduce_cb], t2)

    def reduce(self, fn: Any, init: Any) -> Any:
        """Fold over elements from a seed accumulator (east-c SetReduce; TS
        ``reduce(fn, init)``).

        Elements are visited in East total order.

        Args:
            fn: ``fn(acc, element) -> new acc`` applied for each element.
            init: Seed accumulator; its type fixes the accumulator/result type.

        Returns:
            The final accumulator.
        """
        fn, init = _fn_init("reduce", fn, init)
        t2 = _ev.type_of(init)
        callback = EastFunction(_mark_function(lambda b, acc, el: fn(b, acc, el), fn), [t2, self.element_type], t2)
        return _call_builtin("SetReduce", [self.element_type, t2], [self, callback, init], t2)

    def scan(self, fn: Any, init: Any) -> EastArray:
        """Running fold: the array of every intermediate accumulator (east-c
        SetScan; TS ``scan(fn, init)``).

        Elements are visited in East total order. Element ``i`` of the result
        is the accumulator after folding the ``i``-th element — one result
        element per member, the seed is not emitted, and for a non-empty set
        the last element equals ``reduce(fn, init)``. An empty set scans to
        an empty array.

        Args:
            fn: ``fn(accumulator, element) -> new accumulator`` applied for
                each element in East order.
            init: The starting accumulator; its type fixes the result's
                element type. Not emitted into the result.

        Returns:
            A new array of the successive accumulator values.
        """
        from east.types.types import ArrayType

        fn, init = _fn_init("scan", fn, init)
        t2 = _ev.type_of(init)
        callback = EastFunction(_mark_function(lambda b, acc, el: fn(b, acc, el), fn), [t2, self.element_type], t2)
        return _call_builtin("SetScan", [self.element_type, t2], [self, callback, init], ArrayType(t2))

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Concatenate the arrays returned by ``fn`` over all elements (east-c
        SetFlattenToArray; TS ``flattenToArray`` — only an Array spells it
        ``flatMap``).

        Args:
            fn: ``fn(element) -> array``; the result element type is that of the
                array ``fn`` captures unless ``out`` is given.
            out: Pins the result element type.

        Returns:
            A new array concatenating each element's array, in East element order.
        """
        from east.types.types import ArrayType

        if out is not None:
            _check_function_out(fn, ArrayType(out))
        t2 = out if out is not None else _function_out_type(
            fn, [self.element_type]).value
        if len(self) == 0:
            return EastArray(t2, [])
        callback = EastFunction(fn, [self.element_type], ArrayType(t2))
        return _call_builtin("SetFlattenToArray", [self.element_type, t2], [self, callback], ArrayType(t2))

    flat_map = _deprecated_alias("flat_map", "flatten_to_array")

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Union the sets returned by ``fn`` over all elements (east-c SetFlattenToSet).

        Args:
            fn: ``fn(element) -> set``; the result element type is that of the
                set ``fn`` captures unless ``out`` is given.
            out: Pins the result element type.

        Returns:
            A new set of the distinct elements across every produced set.
        """
        from east.types.types import SetType

        if out is not None:
            _check_function_out(fn, SetType(out))
        k2 = out if out is not None else _function_out_type(
            fn, [self.element_type]).value
        if len(self) == 0:
            return EastSet(k2)
        callback = EastFunction(fn, [self.element_type], SetType(k2))
        return _call_builtin("SetFlattenToSet", [self.element_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> EastDict:
        """Merge the dicts returned by ``fn`` over all elements (east-c SetFlattenToDict).

        Key and value types are those of the dict ``fn`` captures.

        Args:
            fn: ``fn(element) -> dict`` whose entries are merged into the result.
            combine: On a shared key, ``combine(existing, incoming[, key]) ->
                value`` decides the kept value; without ``combine`` a duplicate
                key errors, like every other East runtime.

        Returns:
            A new dict merging every produced dict.
        """
        from east.types.types import DictType

        # The captured Dict TYPE carries its key/value under .value (#450/#525)
        # — .key_type exists only on a dict VALUE, and reading it off the type
        # crashed every compiled or captured callback here.
        _ko = _function_out_type(fn, [self.element_type])
        k2, t2 = _ko.value["key"], _ko.value["value"]
        callback = EastFunction(fn, [self.element_type], DictType(k2, t2))
        combine_cb = EastFunction(_combine_cb(combine, k2, t2), [t2, t2, k2], t2)
        return _call_builtin(
            "SetFlattenToDict", [self.element_type, k2, t2], [self, callback, combine_cb], DictType(k2, t2)
        )

    def sum(self, fn: Any = None) -> Any:
        """Sum of elements or of ``fn(element)`` (native SetReduce).

        The zero is typed from the projection, so an empty set sums to the
        projection's zero — see the note on ``EastArray.sum`` (#450/#525).
        """
        t2 = self.element_type if fn is None else _function_out_type(
            fn, [self.element_type])
        zero = _numeric_zero_for(t2)
        proj = fn if fn is not None else (lambda _b, el: el)
        step = EastFunction(lambda b, acc, el: acc + proj(b, el), [t2, self.element_type], t2)
        return _call_builtin("SetReduce", [self.element_type, t2], [self, step, zero], t2)

    def mean(self, fn: Any = None) -> float:
        """Float mean of elements/projections (NaN when empty, like TS)."""
        from east.types.types import FloatType

        n = len(self)
        if n == 0:
            return float("nan")
        t2 = self.element_type if fn is None else _function_out_type(
            fn, [self.element_type])
        proj = _float_proj(fn, t2)
        step = EastFunction(lambda b, acc, el: acc + proj(b, el), [FloatType, self.element_type], FloatType)
        total = _call_builtin("SetReduce", [self.element_type, FloatType], [self, step, 0.0], FloatType)
        return total / float(n)

    def _first_map_bool(self, want: bool, pred: Any) -> bool:
        from east.expression import Expression, if_else
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import BooleanType, NullType, VariantType

        def _probe(b, el):  # noqa: ANN001, ANN202
            r = pred(b, el)
            decided = (r if isinstance(r, Expression) else bool(r)) if want else (
                _not_expr(r) if isinstance(r, Expression) else not bool(r)
            )
            if isinstance(decided, Expression):
                return if_else(decided, _some(True), _none)
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
            pred = lambda _b, el: el  # noqa: E731
        return not self._first_map_bool(False, pred)

    def some(self, pred: Any = None) -> bool:
        """True when ``pred`` holds for any member (native short-circuit)."""
        if pred is None:
            if self.element_type.type != "Boolean":
                raise TypeError("some() without a predicate needs Boolean elements")
            pred = lambda _b, el: el  # noqa: E731
        return self._first_map_bool(True, pred)

    def group_size(self, key: Any) -> EastDict:
        """Count per group key (native)."""
        return self.to_dict(key, lambda _b, _el: 1, combine=lambda _b, x, y, _k: x + y)

    def group_sum(self, key: Any, fn: Any = None) -> EastDict:
        """Sum per group (native SetGroupFold).

        The zero is typed from the projection, as :meth:`sum` types it, and a
        non-numeric projection raises rather than silently picking ``0.0``
        (#450/#525).
        """
        proj = fn if fn is not None else (lambda _b, el: el)
        t2 = _function_out_type(proj, [self.element_type])
        zero = _numeric_zero_for(t2)
        return self.group_reduce(key, lambda _b, _k: zero, lambda b, acc, el: acc + proj(b, el))

    def group_mean(self, key: Any, fn: Any = None) -> EastDict:
        """Float mean per group (sum, count and the division all native)."""
        from east.namespace import East
        from east.types.types import FloatType

        k2e = _function_out_type(key, [self.element_type])
        if len(self) == 0:
            # The key fixes the result type on an empty set too (#525); the
            # mean is ALWAYS Float, so the degenerate bail did not merely lose
            # precision in the type — folding real means into an Integer-typed
            # seed truncated them, with no error raised.
            return EastDict(k2e, FloatType)
        t2 = self.element_type if fn is None else _function_out_type(
            fn, [self.element_type])
        proj = _float_proj(fn, t2)
        sums = self.group_reduce(key, lambda _b, _k: 0.0, lambda b, acc, el: acc + proj(b, el))
        counts = self.group_size(key).map(lambda _b, c: East.Integer.to_float(c), out=FloatType)
        sums.merge_all(counts, lambda _b, s, c, _k: s / c, lambda _b, _k: 0.0)
        return sums

    def group_every(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for all members (native)."""
        return self.group_reduce(key, lambda _b, _k: True, lambda b, acc, el: acc & pred(b, el))

    def group_some(self, key: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred`` holds for any member (native)."""
        return self.group_reduce(key, lambda _b, _k: False, lambda b, acc, el: acc | pred(b, el))

    def group_to_arrays(self, key: Any, value: Any = None) -> EastDict:
        """Arrays of members/values per group key (native via to_array)."""
        return self.to_array().group_to_arrays(key, value if value is not None else (lambda _b, el: el))

    def group_to_sets(self, key: Any, value: Any = None) -> EastDict:
        """Sets of members/values per group key (native via to_array)."""
        return self.to_array().group_to_sets(key, value)

    def group_to_dicts(self, key: Any, key2: Any, value: Any = None, combine: Any = None) -> EastDict:
        """Dicts of ``key2 -> value`` per group key (native via to_array)."""
        return self.to_array().group_to_dicts(key, key2, value, combine)

    def group_reduce(self, key: Any, initial: Any, fold: Any) -> EastDict:
        """Group elements by ``key(element)`` and fold within each group (east-c SetGroupFold).

        Key and accumulator types are the callbacks' captured output types.

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

        # An EMPTY input has the same result type a full one has — returning a
        # degenerate `(element_type, element_type)` dict made the eager path
        # disagree with the traced one about the RESULT TYPE, invisibly,
        # because both compare equal while empty (#450/#525).
        k2 = _function_out_type(key, [self.element_type])
        t2 = _function_out_type(initial, [k2])
        if len(self) == 0:
            return EastDict(k2, t2)
        key_cb = EastFunction(key, [self.element_type], k2)
        init_cb = EastFunction(initial, [k2], t2)
        fold_cb = EastFunction(_mark_function(lambda b, acc, el: fold(b, acc, el), fold), [t2, self.element_type], t2)
        return _call_builtin(
            "SetGroupFold", [self.element_type, k2, t2], [self, key_cb, init_cb, fold_cb], DictType(k2, t2)
        )

    def group_fold(self, key: Any, initial: Any, fold: Any) -> EastDict:
        """Deprecated alias for :meth:`group_reduce` (issue #535).

        The grouped fold had two names — TS ``groupReduce`` on every
        container, east-py ``group_reduce`` on Array but ``group_fold`` on
        Set/Dict — so a call ported by name worked on an Array and raised
        ``AttributeError`` on a Set. The operation is unchanged; only the
        spelling moves.
        """
        import warnings

        warnings.warn(
            "EastSet.group_fold is deprecated: the grouped fold is spelled "
            "group_reduce on every container (TS groupReduce). See issue #535.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.group_reduce(key, initial, fold)

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

    def keys(self) -> EastSet:
        """The set of keys (east-c DictKeys; TS ``keys``).

        An ``EastSet`` built in east-c — the East-value spelling, not a python
        view: nothing crosses into python. Iterate the dict itself (or
        :meth:`items`) for the python-boundary walk.

        Returns:
            A set of the keys, ordered under East's total ordering.
        """
        from east.types.types import SetType

        return _call_builtin("DictKeys", [self.key_type, self.value_type], [self], SetType(self.key_type))

    keys_set = _deprecated_alias("keys_set", "keys")

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

    def get(self, key: Any, default: Any = None) -> Any:
        """Value for ``key`` (east-c DictGet; TS ``get(key, onMissing?)``).

        Without ``default`` a missing key raises, like ``d[key]``. ``default``
        may be a VALUE (python's ``dict.get`` convenience — the traced twin's
        :meth:`get_or_default`) or a body ``default(b, key)`` producing the
        value for an absent key (TypeScript's ``onMissing``); a dict of
        functions takes a callable as a value.

        Args:
            key: The key to look up, compared under East's total ordering.
            default: Value, or ``(b, key)`` body, for an absent ``key``.

        Returns:
            The stored value for ``key``, otherwise the default.
        """
        if _is_traced(key) or _is_traced(default):
            # Delegate so a traced lookup emits IR rather than silently
            # falling through `key in self`.
            return _lift_traced(self).get(key, default)
        if default is None:
            return self[key]
        if key in self:
            return self[key]
        if callable(default) and self.value_type.type not in ("Function", "AsyncFunction"):
            from east.expression.statements import EagerBlock

            return default(EagerBlock(), key)
        return default

    def get_or_default(self, key: Any, default: Any) -> Any:
        """Value for ``key``, or ``default`` if absent (east-c DictGetOrDefault).

        With a traced ``key``/``default`` (inside a captured body) this
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
        """Insert ``key`` → ``value`` in place; the key must not exist (east-c DictInsert).

        Use ``d[key] = value`` / :meth:`insert_or_update` for the
        replace-on-existing spellings.

        Args:
            key: The key to write, ordered under East's total ordering.
            value: The value to store.
        """
        from east.types.types import NullType

        _call_builtin("DictInsert", [self.key_type, self.value_type], [self, key, value], NullType)

    def get_or_insert(self, key: Any, fn: Any) -> Any:
        """Fetch the value at ``key``, computing and inserting one if absent (east-c DictGetOrInsert).

        Args:
            key: The key to look up, ordered under East's total ordering.
            fn: Called as ``fn(b, key) -> value`` only when ``key`` is missing
                (python-side, with an eager block); its result is inserted
                before being returned.

        Returns:
            The existing value, or the newly inserted ``fn(b, key)``.
        """
        if key not in self:
            from east.expression.statements import EagerBlock

            self[key] = fn(EagerBlock(), key)
        return self[key]

    def insert_or_update(self, key: Any, value: Any, combine: Any) -> None:
        """Insert ``value`` at ``key`` or combine it with the existing one, in place (east-c DictInsertOrUpdate).

        Args:
            key: The key to write, ordered under East's total ordering.
            value: The incoming value used when ``key`` is absent.
            combine: Called as ``combine(existing, incoming[, key]) -> value``
                when ``key`` already has a value; its result is stored.
        """
        from east.types.types import NullType

        cb = EastFunction(_combine_cb(combine, self.key_type, self.value_type),
                          [self.value_type, self.value_type, self.key_type], self.value_type)
        _call_builtin("DictInsertOrUpdate", [self.key_type, self.value_type], [self, key, value, cb], NullType)

    def update(self, key: Any, value: Any) -> None:
        """Set the value at an EXISTING key, in place (east-c DictUpdate; TS
        ``update``); a missing key is an East runtime error.

        The python read-modify-write spelling ``update(key, fn)`` — ``fn(b,
        current)`` becoming the new value — is deprecated: write
        ``d.update(k, f(d[k]))``.

        Args:
            key: The key whose value is replaced; must already be present.
            value: The new value.
        """
        from east.types.types import NullType

        if callable(value) and self.value_type.type not in ("Function", "AsyncFunction"):
            import warnings

            from east.expression.statements import EagerBlock

            warnings.warn(
                ".update(key, fn) is deprecated: TypeScript's update(key, value) "
                "stores a value — spell the read-modify-write as d.update(k, f(d[k]))",
                DeprecationWarning,
                stacklevel=2,
            )
            current = _call_builtin("DictGet", [self.key_type, self.value_type], [self, key], self.value_type)
            value = value(EagerBlock(), current)
        _call_builtin("DictUpdate", [self.key_type, self.value_type], [self, key, value], NullType)

    def swap(self, key: Any, value: Any) -> Any:
        """Set ``key`` to ``value`` and return the previous value, in place (east-c DictSwap).

        Args:
            key: The key to overwrite; must already be present.
            value: The new value to store.

        Returns:
            The value previously stored at ``key``.
        """
        return _call_builtin("DictSwap", [self.key_type, self.value_type], [self, key, value], self.value_type)

    def delete(self, key: Any) -> None:
        """Remove ``key`` in place (east-c DictDelete).

        Args:
            key: The key to remove; must be present.
        """
        from east.types.types import NullType

        _call_builtin("DictDelete", [self.key_type, self.value_type], [self, key], NullType)

    def try_delete(self, key: Any) -> bool:
        """Remove ``key`` if present, in place (east-c DictTryDelete).

        Args:
            key: The key to remove.

        Returns:
            True if ``key`` was present and removed, else False.
        """
        from east.types.types import BooleanType

        return _call_builtin("DictTryDelete", [self.key_type, self.value_type], [self, key], BooleanType)

    def _first_map_bool(self, want: bool, pred: Any) -> bool:
        """Shared native short-circuit scan: some(True) on the deciding entry.

        The Dict twin of the Array/Set helpers — the callback takes
        ``(value, key)``, the builtin's own slot (the TypeScript order).
        """
        from east.expression import Expression, if_else
        from east.types.construct import none as _none
        from east.types.construct import some as _some
        from east.types.types import BooleanType, NullType, VariantType

        pf = _as_kv_fn(pred)

        def _probe(b, v, k):  # noqa: ANN001, ANN202
            r = pf(b, v, k)
            decided = (r if isinstance(r, Expression) else bool(r)) if want else (
                _not_expr(r) if isinstance(r, Expression) else not bool(r)
            )
            if isinstance(decided, Expression):
                return if_else(decided, _some(True), _none)
            return _some(True) if decided else _none

        out_variant = VariantType([("none", NullType), ("some", BooleanType)])
        callback = EastFunction(_probe, [self.value_type, self.key_type], out_variant)
        result = _call_builtin(
            "DictFirstMap", [self.key_type, self.value_type, BooleanType], [self, callback], out_variant
        )
        return result.type == "some"

    def every(self, pred: Any = None) -> bool:
        """True when ``pred(b, value, key)`` holds for every entry (native
        short-circuiting DictFirstMap scan, like TS). Without ``pred`` the
        values must be Booleans. True for an empty dict.
        """
        if pred is None:
            if self.value_type.type != "Boolean":
                raise TypeError("every() without a predicate needs Boolean values")
            pred = lambda _b, v: v  # noqa: E731
        return not self._first_map_bool(False, pred)

    def some(self, pred: Any = None) -> bool:
        """True when ``pred(b, value, key)`` holds for any entry (native
        short-circuit). Without ``pred`` the values must be Booleans. False
        for an empty dict.
        """
        if pred is None:
            if self.value_type.type != "Boolean":
                raise TypeError("some() without a predicate needs Boolean values")
            pred = lambda _b, v: v  # noqa: E731
        return self._first_map_bool(True, pred)

    def sum(self, fn: Any = None) -> Any:
        """Sum over entries: of values, or of ``fn(value, key)`` (native
        DictReduce).

        Args:
            fn: Optional numeric projection ``fn(value, key)``; without it the
                values must be Integer or Float.

        Returns:
            The total; the type's zero for an empty dict.
        """
        # The zero is typed from the PROJECTION, entries or none: typing an
        # empty dict's zero from value_type made a numeric projection over
        # non-numeric values raise, and a Float projection over Integer values
        # return an Integer zero whose type flips once a row arrives (#450).
        t2 = self.value_type if fn is None else _function_out_type(
            fn, _kv_in(fn, self.value_type, self.key_type))
        zero = _numeric_zero_for(t2)
        proj = _as_kv_fn(fn) if fn is not None else (lambda _b, v, _k: v)
        step = EastFunction(
            lambda b, acc, v, k: acc + proj(b, v, k), [t2, self.value_type, self.key_type], t2
        )
        return _call_builtin(
            "DictReduce", [self.key_type, self.value_type, t2], [self, step, zero], t2
        )

    def mean(self, fn: Any = None) -> float:
        """Float mean over entries: of values, or of ``fn(value, key)``
        (native DictReduce; NaN when empty, like TS)."""
        from east.types.types import FloatType

        n = len(self)
        if n == 0:
            return float("nan")
        t2 = self.value_type if fn is None else _function_out_type(
            fn, _kv_in(fn, self.value_type, self.key_type))
        proj = _as_kv_fn(_float_proj(fn, t2))
        step = EastFunction(
            lambda b, acc, v, k: acc + proj(b, v, k), [FloatType, self.value_type, self.key_type],
            FloatType
        )
        total = _call_builtin(
            "DictReduce", [self.key_type, self.value_type, FloatType], [self, step, 0.0], FloatType
        )
        return total / float(n)

    def group_size(self, key_fn: Any) -> EastDict:
        """Count per ``key_fn(b, value, key)`` group (native)."""
        return self.to_dict(key_fn, lambda _b, _v: 1, combine=lambda _b, x, y, _key: x + y)

    def group_sum(self, key_fn: Any, fn: Any = None) -> EastDict:
        """Sum per group of ``fn(b, value, key)`` (values when omitted; native).

        The zero is typed from the projection, as :meth:`sum` types it, and a
        non-numeric projection raises rather than silently picking ``0.0``
        (#450/#525).
        """
        t2 = self.value_type if fn is None else _function_out_type(
            fn, _kv_in(fn, self.value_type, self.key_type))
        zero = _numeric_zero_for(t2)
        proj = _as_kv_fn(fn) if fn is not None else (lambda _b, v, _k: v)
        return self.group_reduce(key_fn, lambda _b, _k: zero, lambda b, acc, v, k: acc + proj(b, v, k))

    def group_mean(self, key_fn: Any, fn: Any = None) -> EastDict:
        """Float mean per group (sum, count and the division all native)."""
        from east.namespace import East
        from east.types.types import FloatType

        k2e = _function_out_type(key_fn, _kv_in(key_fn, self.value_type, self.key_type))
        if len(self) == 0:
            # Both type parameters were wrong here, not just one: the source
            # KEY type leaked through even when the group key is a projection,
            # and the value type was the source's rather than Float (#525).
            return EastDict(k2e, FloatType)
        t2 = self.value_type if fn is None else _function_out_type(
            fn, _kv_in(fn, self.value_type, self.key_type))
        proj = _as_kv_fn(_float_proj(fn, t2))
        sums = self.group_reduce(key_fn, lambda _b, _k: 0.0, lambda b, acc, v, k: acc + proj(b, v, k))
        counts = self.group_size(key_fn).map(lambda _b, c: East.Integer.to_float(c), out=FloatType)
        sums.merge_all(counts, lambda _b, s, c, _k: s / c, lambda _b, _k: 0.0)
        return sums

    def group_every(self, key_fn: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred(b, value, key)`` holds for all entries."""
        p = _as_kv_fn(pred)
        return self.group_reduce(key_fn, lambda _b, _k: True, lambda b, acc, v, k: acc & p(b, v, k))

    def group_some(self, key_fn: Any, pred: Any) -> EastDict:
        """Per group: True when ``pred(b, value, key)`` holds for any entry."""
        p = _as_kv_fn(pred)
        return self.group_reduce(key_fn, lambda _b, _k: False, lambda b, acc, v, k: acc | p(b, v, k))

    def group_to_arrays(self, key_fn: Any, value_fn: Any = None) -> EastDict:
        """Arrays of ``value_fn(b, value, key)`` per group (native via to_array).

        ``value_fn`` is optional — omitted, the dict's VALUES are collected —
        matching TypeScript's ``groupToArrays(keyFn, valueFn?)`` and the traced
        twin. Requiring it here made east-py the outlier of the three runtimes
        (#525).
        """
        kf = _as_kv_fn(key_fn)
        vf = _as_kv_fn(value_fn) if value_fn is not None else (lambda _b, v, _k: v)
        pairs = self.to_array(lambda b, v, k: {"k": kf(b, v, k), "v": vf(b, v, k)})
        return pairs.group_to_arrays(lambda _b, p: p["k"], lambda _b, p: p["v"])

    def group_to_sets(self, key_fn: Any, value_fn: Any = None) -> EastDict:
        """Sets of ``value_fn(b, value, key)`` per group (the VALUES when omitted)."""
        kf = _as_kv_fn(key_fn)
        vf = _as_kv_fn(value_fn) if value_fn is not None else (lambda _b, v, _k: v)
        pairs = self.to_array(lambda b, v, k: {"k": kf(b, v, k), "v": vf(b, v, k)})
        return pairs.group_to_sets(lambda _b, p: p["k"], lambda _b, p: p["v"])

    def group_to_dicts(self, key_fn: Any, key2_fn: Any, value_fn: Any = None,
                       combine: Any = None) -> EastDict:
        """Dicts of ``key2 -> value`` per group (the VALUES when omitted)."""
        kf, k2f = _as_kv_fn(key_fn), _as_kv_fn(key2_fn)
        vf = _as_kv_fn(value_fn) if value_fn is not None else (lambda _b, v, _k: v)
        pairs = self.to_array(
            lambda b, v, k: {"k": kf(b, v, k), "k2": k2f(b, v, k), "v": vf(b, v, k)}
        )
        return pairs.group_to_dicts(
            lambda _b, p: p["k"], lambda _b, p: p["k2"], lambda _b, p: p["v"], combine
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
        once. A pure ``combine`` lambda (or a compiled East function) runs
        the collision handling C-to-C as well.

        Args:
            keys: Sequence of keys (same length as ``values``).
            values: Sequence of incoming values.
            combine: Optional ``combine(existing, incoming) -> value`` used
                when a key is already present; the incoming value wins when
                omitted. Accepts a python body (captured into a native
                function, or refused) or a compiled East function.
        """
        combine_ptr = 0
        combine_py = None
        keep_alive = None
        if combine is not None:
            handle = getattr(combine, "_eastc_handle", None)
            fn_val = getattr(handle, "_fn_val", 0) if handle is not None else 0
            if fn_val:
                # A precompiled combine runs C-to-C with no per-call
                # conversion, so its declared signature is the only check its
                # values will ever get — a mismatch would write mislabelled
                # values straight into the dict (#467).
                sig_out = _function_out_type(combine)
                try:
                    sig_in = list(handle.get_input_types())
                except Exception:
                    sig_in = None
                if (sig_out is not None and sig_out != self.value_type) or (
                    sig_in is not None and sig_in != [self.value_type, self.value_type]
                ):
                    from east.serialization.east_printer import print_east
                    from east.types.coercion import EastTypeError
                    from east.types.type_of_type import EastTypeType

                    raise EastTypeError(
                        "update_many: combine function signature does not match "
                        f"this dict's value type "
                        f"{print_east(self.value_type, EastTypeType)} "
                        "(expected (value, value) -> value)"
                    )
                combine_ptr = fn_val
                keep_alive = combine
            else:
                from east.expression import capture_callback

                # The combine captures as an East.function body against the
                # dict's value type, or raises (#625) — collisions always
                # resolve C-to-C.
                native = capture_callback(
                    EastFunction(combine, [self.value_type, self.value_type], self.value_type)
                )
                combine_ptr = native._eastc_handle._fn_val
                keep_alive = native
        # When both inputs are ALREADY C-backed arrays of the right element
        # type, hand their pointers over and let the bridge index them C-side.
        # `list(keys), list(values)` boxes every element C->python purely so the
        # bridge can convert it python->C again — O(n) round trips on the one
        # path whose contract is "the whole batch crosses once", and on deeply
        # nested element types the boxing itself could exhaust or corrupt memory
        # (MemoryError in _box_string, SIGSEGV under list_extend).
        # `isinstance` covers function-produced arrays too (EastArrayProxy is an
        # EastArray), and `==` on element types compares structurally, so this
        # matches whether the array came from `array(...)` or a function.
        k_ptr = v_ptr = 0
        n_c = -1
        if isinstance(keys, EastArray) and isinstance(values, EastArray):
            # A wrong element type RAISES rather than falling back: handing
            # mismatched pointers to the bridge would let east-c read values as
            # the wrong type, and silently taking the boxing path instead would
            # hide a caller bug behind a much slower route.
            if keys.element_type != self.key_type:
                from east.types.coercion import EastTypeError

                raise EastTypeError(
                    f"update_many: keys are Array<{keys.element_type}> but this "
                    f"dict is keyed by {self.key_type}"
                )
            if values.element_type != self.value_type:
                from east.types.coercion import EastTypeError

                raise EastTypeError(
                    f"update_many: values are Array<{values.element_type}> but "
                    f"this dict holds {self.value_type}"
                )
            if len(keys) != len(values):
                raise ValueError(
                    f"update_many: {len(keys)} keys but {len(values)} values"
                )
            k_ptr, v_ptr, n_c = keys._c_ptr, values._c_ptr, len(keys)

        # NB do NOT clobber keys/values above: if either pointer turns out to be
        # 0 the bridge takes the python path, and it needs the originals.
        fast = k_ptr != 0 and v_ptr != 0
        _proxy_cls("_dict_update_many")(
            self._c_ptr, self._c_key_type_ptr, self._c_val_type_ptr,
            () if fast else list(keys),
            () if fast else list(values),
            combine_ptr, combine_py, k_ptr, v_ptr, n_c,
        )
        del keep_alive

    def _dict_type_mismatch(self, other: Any, op: str, detail: str) -> Any:
        """The shared EastTypeError for a wrongly-typed ``other``."""
        from east.serialization.east_printer import print_east
        from east.types.coercion import EastTypeError
        from east.types.type_of_type import EastTypeType

        def show(d: Any) -> str:
            return (f"Dict<{print_east(d.key_type, EastTypeType)}, "
                    f"{print_east(d.value_type, EastTypeType)}>")

        return EastTypeError(f"{op}: other is {show(other)} but this dict is "
                             f"{show(self)} — {detail}")

    def _require_same_key_type(self, other: Any, op: str) -> None:
        """``other`` must be keyed the same way; its VALUES may differ.

        The relaxed check, for the builtins that carry a ``V2`` type parameter
        (``DictMergeAll``). Keys are still read as this dict's key type, so a
        key mismatch remains an unsafe decode.
        """
        from east.types.types import DictType as _DictT

        # Derive V2 from `other`'s OWN type, then require the WHOLE type to
        # match — so a Set/Array cannot slip past on a matching element type
        # (#529). Only V2 is free to differ.
        actual = _typed_or_none(other)
        if actual is None:
            return  # traced, or not an East value — existing coercion applies
        v2 = actual.value["value"] if actual.type == "Dict" else self.value_type
        _require_operand_type(other, _DictT(self.key_type, v2), op)

    def _require_same_dict_type(self, other: Any, op: str) -> None:
        """Reject a differently-typed ``other`` before east-c reads it.

        ``DictUnionInPlace`` takes ONE pair of type parameters, so ``other``'s
        slots are decoded as THIS dict's types. A mismatch is not a type error
        downstream — it is a raw reinterpretation of a foreign payload (a heap
        pointer surfaced as an Integer, or arbitrary bytes fed to the UTF-8
        decoder), and #529 had exactly that segfaulting. Fail here instead,
        naming both types, as ``update_many`` already does for its arrays.

        ``merge_all`` uses the relaxed :meth:`_require_same_key_type` — the
        ``DictMergeAll`` builtin is generic in the incoming value type.
        """
        from east.types.types import DictType as _DictT

        actual = _typed_or_none(other)
        if actual is None:
            return  # traced, or not an East value — existing coercion applies
        if actual.type == "Dict" and not len(other):
            # No slots to misread, so no unsafe decode is possible. This is not
            # a loophole but a necessity: the segment-streamed file surfaces
            # union per-segment results, and an EMPTY segment's result carries
            # placeholder type labels (an untypeable callback on no rows infers
            # nothing). The union methods pair this allowance with an
            # empty-`other` short-circuit, so the mislabelled (but contentless)
            # value never crosses into east-c — the funnel's declared-type
            # marshalling would rightly refuse its pointer (#534).
            return
        _require_operand_type(other, _DictT(self.key_type, self.value_type), op)

    def _union_combine(self, combine: Any) -> EastFunction:
        """The shared overlap handler for :meth:`union` / :meth:`union_in_place`.

        ``None`` means East's default for a whole-dict union: error naming the
        shared key — the same default TS's ``DictExpr.unionInPlace`` injects
        (and a DIFFERENT message from the duplicate-insert one ``_combine_cb``
        produces, matching TS).
        """
        if combine is None:
            from east.expression import _error_combine_function

            cb_fn: Any = _error_combine_function(
                self.value_type, self.key_type, "Key ", " exists in both dictionaries")
        else:
            cb_fn = _combine_cb(combine, self.key_type, self.value_type)
        return EastFunction(cb_fn, [self.value_type, self.value_type, self.key_type], self.value_type)

    def union(self, other: EastDict, combine: Any = None) -> EastDict:
        """New dict holding the entries of both (east-c DictCopy + DictUnionInPlace).

        The pure counterpart of :meth:`union_in_place`, exactly as
        :meth:`EastSet.union` is of ``EastSet.union_in_place``, and the same
        operation TypeScript spells ``DictExpr.union``.

        ``other`` must have the SAME key and value types — ``DictUnionInPlace``
        carries one value type parameter, so a mismatch is refused rather than
        decoded (#529). Use :meth:`merge_all` when ``other``'s values have a
        different type (it is generic in them, like TypeScript's
        ``mergeAll<V2>``), or :meth:`merge` for a single differently-typed
        incoming value.

        Args:
            other: The dict whose entries are merged in. Its key/value types
                must match this dict's.
            combine: For a key present in both, called as
                ``combine(existing, incoming)`` — or
                ``combine(existing, incoming, key)`` when it accepts three
                arguments — returning the value to keep. When omitted a shared
                key errors, like every other East runtime.

        Returns:
            A new dict; this dict and ``other`` are unchanged.
        """
        from east.types.types import DictType, NullType

        self._require_same_dict_type(other, "union")
        result = _call_builtin("DictCopy", [self.key_type, self.value_type], [self], DictType(self.key_type, self.value_type))
        if isinstance(other, EastDict) and len(other) == 0:
            # Nothing to add — and an empty `other` may carry placeholder type
            # labels (see _require_same_dict_type), which must not cross into
            # east-c as a mislabelled pointer.
            return result
        _call_builtin("DictUnionInPlace", [self.key_type, self.value_type],
                      [result, other, self._union_combine(combine)], NullType)
        return result

    def union_in_place(self, other: EastDict, combine: Any = None) -> None:
        """Add every entry of ``other`` to this dict in place (east-c DictUnionInPlace).

        The in-place counterpart of :meth:`union`, and the sibling of
        ``EastSet.union_in_place``. Matches TypeScript's
        ``DictExpr.unionInPlace``, including the error on an overlapping key
        when no ``combine`` is given.

        Args:
            other: The dict whose entries are added. Its key/value types must
                match this dict's.
            combine: For a key present in both, ``combine(existing, incoming
                [, key]) -> value``; without it a shared key errors.
        """
        from east.types.types import NullType

        self._require_same_dict_type(other, "union_in_place")
        self._check_not_iterating()
        if isinstance(other, EastDict) and len(other) == 0:
            # Nothing to add — and an empty `other` may carry placeholder type
            # labels (see _require_same_dict_type), which must not cross into
            # east-c as a mislabelled pointer.
            return
        _call_builtin("DictUnionInPlace", [self.key_type, self.value_type],
                      [self, other, self._union_combine(combine)], NullType)

    def merge(self, key: Any, value: Any = None, update_fn: Any = None,
              initial_fn: Any = None) -> None:
        """Combine ``value`` into the entry at ``key``, in place (east-c
        DictMerge; TS ``merge``).

        The single-key upsert — the sibling of ``EastArray.merge`` (one index)
        and ``EastRef.merge`` (the cell). Unlike :meth:`insert_or_update`,
        ``value`` may have a DIFFERENT East type from the dict's values
        (``update_fn`` bridges the two), and a missing key errors unless
        ``initial_fn`` supplies a seed.

        The pre-#527 spelling ``merge(other, combine)`` — the pure whole-dict
        union — is deprecated: that operation is :meth:`union`.

        Args:
            key: The key to combine into.
            value: The incoming value; its East type is inferred with
                ``type_of`` and need not match the dict's value type.
            update_fn: ``update_fn(existing, incoming[, key]) -> value``
                producing the stored result.
            initial_fn: Optional ``initial_fn(key) -> value`` seeding a
                missing key; without it a missing key raises.

        Returns:
            None; the dict is modified in place.
        """
        from east.types.types import NullType

        if update_fn is None and isinstance(key, EastDict):
            import warnings

            warnings.warn(
                "EastDict.merge(other, combine) is deprecated: the pure whole-dict "
                "union is spelled EastDict.union; merge(key, value, update_fn[, "
                "initial_fn]) is TypeScript's single-key upsert. See issue #527.",
                DeprecationWarning,
                stacklevel=2,
            )
            return self.union(key, value)  # type: ignore[return-value]
        if update_fn is None:
            raise TypeError("merge(key, value, update_fn[, initial_fn]) needs the update body")
        v2 = _ev.type_of(value)
        fn = update_fn if _callback_arity(update_fn, 2) >= 3 else (
            lambda b, existing, incoming, _k: update_fn(b, existing, incoming))
        update_cb = EastFunction(_mark_function(fn, update_fn),
                                 [self.value_type, v2, self.key_type], self.value_type)
        if initial_fn is None:
            from east.expression import _error_init_function

            init_fn: Any = _error_init_function(
                self.value_type, self.key_type, "Key ", " not found in dictionary")
        else:
            init_fn = initial_fn
        init_cb = EastFunction(_mark_function(init_fn, init_fn), [self.key_type], self.value_type)
        _call_builtin("DictMerge", [self.key_type, self.value_type, v2],
                      [self, key, value, update_cb, init_cb], NullType)
        return None

    merge_key = _deprecated_alias("merge_key", "merge")

    def merge_all(self, other: EastDict, merge: Any, default: Any) -> None:
        """Fold every entry of ``other`` into self in place (east-c DictMergeAll).

        For each ``(key, value)`` in ``other``: the base is this dict's existing
        value for ``key`` if present, otherwise ``default(key)``; the stored
        result is ``merge(base, value, key)``.

        ``other``'s values may have a DIFFERENT East type from this dict's —
        ``merge`` is what bridges the two — matching TypeScript's generic
        ``DictExpr.mergeAll<V2>``. Only the KEY types must agree. This is the
        method to reach for when folding counts into totals, pushing into
        nested arrays, or partially updating a dict of structs.

        Args:
            other: The dict whose entries are folded in. Its key type must
                match this dict's; its value type need not.
            merge: Called as ``merge(existing, incoming)`` — or
                ``merge(existing, incoming, key)`` when it accepts three
                arguments — where ``existing`` is this dict's value type and
                ``incoming`` is ``other``'s. Its result is stored, so it must
                return this dict's value type.
            default: Called as ``default(key) -> value`` to synthesise a base
                for keys absent from this dict.
        """
        from east.types.types import NullType

        # Read `other`'s OWN value type and pass it as the third type
        # parameter. Declaring it as `self.value_type` — as this did until
        # #529 — makes east-c decode `other`'s slots as this dict's type: a
        # raw reinterpretation of a foreign payload, which segfaults when a
        # primitive is read as a pointer. The builtin has always been
        # `[K, V, V2]`; east-py simply was not using V2.
        self._require_same_key_type(other, "merge_all")
        v2: EastType = getattr(other, "value_type", None) or self.value_type
        self._check_not_iterating()
        # 2-arg or 3-arg, like every sibling (`merge_key`, and `union` via
        # `_combine_cb`) and like TypeScript's `mergeAll`. A 2-arg FUNCTION was
        # already accepted — `_native_function_for` prefix-adapts arity — so
        # rejecting the identical plain lambda was an inconsistency inside one
        # method, on the path this change makes the recommended one.
        merge_fn = merge if _callback_arity(merge, 2) >= 3 else (
            lambda b, existing, incoming, _key: merge(b, existing, incoming))
        merge_cb = EastFunction(
            _mark_function(merge_fn, merge),
            [self.value_type, v2, self.key_type],
            self.value_type,
        )
        default_cb = EastFunction(
            _mark_function(lambda b, key: default(b, key), default),
            [self.key_type],
            self.value_type,
        )
        _call_builtin(
            "DictMergeAll",
            [self.key_type, self.value_type, v2],
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
        from east.types.types import SetType as _SetT

        _require_operand_type(keys, _SetT(self.key_type), "get_keys")
        callback = EastFunction(fill, [self.key_type], self.value_type)
        return _call_builtin("DictGetKeys", [self.key_type, self.value_type], [self, keys, callback], DictType(self.key_type, self.value_type))

    def for_each(self, fn: Any) -> None:
        """Call ``fn`` for each entry in key order (east-c DictForEach).

        Args:
            fn: Called as ``fn(value, key)`` (``fn(value)`` also accepted)
                once per entry, in ascending key order under East's total
                ordering. Its return value is ignored.
        """
        from east.expression import _sequence_effect
        from east.types.types import NullType

        pf = _as_kv_fn(fn)
        callback = EastFunction(lambda b, v, k: _sequence_effect(pf(b, v, k)), [self.value_type, self.key_type], NullType)
        _call_builtin("DictForEach", [self.key_type, self.value_type, NullType], [self, callback], NullType)

    def map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Transform each value, keeping keys, returning a new dict (east-c DictMap).

        Args:
            fn: Called as ``fn(value) -> new value`` for each entry — or
                ``fn(value, key)`` when it accepts two arguments, matching
                the builtin's callback signature.
            out: Optional East type pinning the result value type. When
                omitted it is ``fn``'s captured output type.

        Returns:
            A new dict with the same keys and mapped values. Empty input
            yields an empty dict with value type ``out`` (or the original).
        """
        from east.types.types import DictType

        _check_function_out(fn, out)
        # The capture types the result (#450). The sampling this replaced called
        # `fn` on a DECODED value, so a value function written against the
        # traced surface died with an AttributeError before it ever ran, and a
        # variant result got typed from whichever single case the sample
        # carried.
        v2 = out if out is not None else _function_out_type(
            fn, _kv_in(fn, self.value_type, self.key_type))
        if len(self) == 0:
            return EastDict(self.key_type, v2)
        callback = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], v2)
        return _call_builtin("DictMap", [self.key_type, self.value_type, v2], [self, callback], DictType(self.key_type, v2))

    def filter(self, predicate: Any) -> EastDict:
        """Keep only entries the predicate accepts, returning a new dict (east-c DictFilter).

        Args:
            predicate: Called as ``predicate(value, key) -> bool``; entries
                for which it is falsy are dropped.

        Returns:
            A new dict containing the retained entries in key order.
        """
        from east.expression import Expression
        from east.types.types import BooleanType, DictType

        pf = _as_kv_fn(predicate)

        def _pred(b, v, k):  # noqa: ANN001, ANN202
            r = pf(b, v, k)
            return r if isinstance(r, Expression) else bool(r)

        callback = EastFunction(_mark_function(_pred, predicate), [self.value_type, self.key_type], BooleanType)
        return _call_builtin("DictFilter", [self.key_type, self.value_type], [self, callback], DictType(self.key_type, self.value_type))

    def filter_map(self, fn: Any, out: EastType | None = None) -> EastDict:
        """Filter and remap values in one pass, returning a new dict (east-c DictFilterMap).

        Args:
            fn: Called as ``fn(value, key) -> some(value) | none``; ``none``
                entries are dropped, ``some`` values are kept under the same
                key.
            out: Optional East type pinning the result value type. When
                omitted it is the ``some`` payload type ``fn`` captures.

        Returns:
            A new dict of the surviving, remapped entries. Empty input yields
            an empty dict.
        """
        from east.types.types import DictType, OptionType

        if out is not None:
            _check_function_out(fn, OptionType(out))
        if out is not None:
            v2 = out
        else:
            from east.types.types import get_option_inner_type

            v2 = get_option_inner_type(
                _function_out_type(fn, _kv_in(fn, self.value_type, self.key_type)))
        if len(self) == 0:
            return EastDict(self.key_type, v2)
        callback = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], OptionType(v2))
        return _call_builtin("DictFilterMap", [self.key_type, self.value_type, v2], [self, callback], DictType(self.key_type, v2))

    def first_map(self, fn: Any, out: EastType | None = None) -> EastVariant:
        """First non-empty result of mapping entries in key order (east-c DictFirstMap).

        Args:
            fn: Called as ``fn(value, key) -> some(result) | none`` for
                entries in ascending key order until one returns ``some``.
            out: Optional East type pinning the result type. When omitted it
                is the ``some`` payload type ``fn`` captures.

        Returns:
            ``some(result)`` for the first entry that produced one, else
            ``none`` (also ``none`` for an empty dict).
        """
        from east.types.types import OptionType

        if out is not None:
            _check_function_out(fn, OptionType(out))
        if out is not None:
            t2 = out
        else:
            from east.types.types import get_option_inner_type

            t2 = get_option_inner_type(
                _function_out_type(fn, _kv_in(fn, self.value_type, self.key_type)))
        if len(self) == 0:
            return EastVariant("none", east_null)
        callback = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], OptionType(t2))
        return _call_builtin("DictFirstMap", [self.key_type, self.value_type, t2], [self, callback], OptionType(t2))

    def map_reduce(self, map_fn: Any, reduce_fn: Any, out: EastType | None = None) -> Any:
        """Map each entry then combine the results pairwise (east-c DictMapReduce).

        Args:
            map_fn: Called as ``map_fn(value, key) -> T2`` to project each
                entry.
            reduce_fn: Called as ``reduce_fn(a, b) -> T2`` to fold the
                projections together.
            out: Optional East type pinning ``T2``. When omitted it is
                ``map_fn``'s captured output type.

        Returns:
            The single combined ``T2`` value.

        Raises:
            ValueError: If the dict is empty (the reduction has no identity).
        """
        _check_function_out(map_fn, out)
        _check_function_out(reduce_fn, out)
        if len(self) == 0:
            raise ValueError("map_reduce on an empty Dict")
        t2 = out if out is not None else _function_out_type(map_fn, _kv_in(map_fn, self.value_type, self.key_type))
        map_cb = EastFunction(_kv_cb(map_fn), [self.value_type, self.key_type], t2)
        reduce_cb = EastFunction(reduce_fn, [t2, t2], t2)
        return _call_builtin("DictMapReduce", [self.key_type, self.value_type, t2], [self, map_cb, reduce_cb], t2)

    def reduce(self, fn: Any, init: Any) -> Any:
        """Fold an accumulator over entries in key order (east-c DictReduce;
        TS ``reduce(fn, init)``).

        Args:
            fn: Called as ``fn(acc, value, key) -> acc`` (``fn(acc, value)``
                also accepted) for each entry in ascending key order.
            init: The seed accumulator; its type pins the accumulator and
                result type.

        Returns:
            The final accumulator (``init`` if the dict is empty).
        """
        fn, init = _fn_init("reduce", fn, init)
        t2 = _ev.type_of(init)
        callback = EastFunction(_acc_kv_cb(fn), [t2, self.value_type, self.key_type], t2)
        return _call_builtin("DictReduce", [self.key_type, self.value_type, t2], [self, callback, init], t2)

    def scan(self, fn: Any, init: Any) -> EastArray:
        """Running fold over entries in key order: the array of every
        intermediate accumulator (east-c DictScan; TS ``scan(fn, init)``).

        Element ``i`` of the result is the accumulator after folding the
        ``i``-th entry (ascending key order) — one result element per entry,
        the seed is not emitted, and for a non-empty dict the last element
        equals ``reduce(fn, init)``. An empty dict scans to an empty array.

        Args:
            fn: ``fn(accumulator, value, key) -> new accumulator`` applied for
                each entry in ascending key order.
            init: The starting accumulator; its type fixes the result's
                element type. Not emitted into the result.

        Returns:
            A new array of the successive accumulator values.
        """
        from east.types.types import ArrayType

        fn, init = _fn_init("scan", fn, init)
        t2 = _ev.type_of(init)
        callback = EastFunction(_acc_kv_cb(fn), [t2, self.value_type, self.key_type], t2)
        return _call_builtin("DictScan", [self.key_type, self.value_type, t2], [self, callback, init], ArrayType(t2))

    def to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Project each entry to an array element in key order (east-c DictToArray).

        Args:
            fn: Called as ``fn(value, key) -> element`` for each entry.
            out: Optional East type pinning the element type. When omitted it
                is the callback's captured output type.

        Returns:
            A new array, one element per entry, in ascending key order.
            Empty input yields an empty array of the same element type.
        """
        from east.types.types import ArrayType

        _check_function_out(fn, out)
        # Derived BEFORE the empty check — the group_to_* sugar routes its pair
        # array through here, and an empty dict bailing to Array<Null> made the
        # downstream grouping trace its field reads against Null while the
        # non-empty path typed fine (#625).
        t2 = out if out is not None else _function_out_type(fn, _kv_in(fn, self.value_type, self.key_type))
        if len(self) == 0:
            return EastArray(t2, [])
        callback = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], t2)
        return _call_builtin("DictToArray", [self.key_type, self.value_type, t2], [self, callback], ArrayType(t2))

    def to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Collect a projection of each entry into a set (east-c DictToSet).

        Args:
            fn: Called as ``fn(value, key) -> element`` for each entry;
                duplicate results collapse.
            out: Optional East type pinning the element type. When omitted it
                is ``fn``'s captured output type.

        Returns:
            The set of distinct ``fn`` results, ordered under East's total
            ordering. Empty input yields an empty set.
        """
        from east.types.types import SetType

        _check_function_out(fn, out)
        k2 = out if out is not None else _function_out_type(fn, _kv_in(fn, self.value_type, self.key_type))
        if len(self) == 0:
            return EastSet(k2)
        callback = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], k2)
        return _call_builtin("DictToSet", [self.key_type, self.value_type, k2], [self, callback], SetType(k2))

    def to_dict(self, key_fn: Any, value_fn: Any = None, combine: Any = None,
                key_out: EastType | None = None, value_out: EastType | None = None) -> EastDict:
        """Re-key and re-value into a new dict, combining collisions (east-c
        DictToDict; TS ``toDict(keyFn, valueFn?, combine?)``).

        Args:
            key_fn: Called as ``key_fn(value, key) -> new key`` to build each
                new entry's key.
            value_fn: Called as ``value_fn(value, key) -> new value`` to
                build each new entry's value; the value itself when omitted.
            combine: Called as ``combine(existing, incoming[, new_key]) ->
                value`` when two source entries map to the same new key;
                without it a duplicate key errors, like every other East
                runtime.
            key_out: Optional East type pinning the new key type; ``key_fn``'s
                captured output type when omitted.
            value_out: Optional East type pinning the new value type;
                ``value_fn``'s captured output type when omitted.

        Returns:
            A new dict keyed by ``key_fn`` with values from ``value_fn``.
            Empty input yields an empty dict.
        """
        from east.types.types import DictType

        if value_fn is None:
            value_fn = lambda _b, v: v  # noqa: E731
        _check_function_out(key_fn, key_out, param="key_out")
        _check_function_out(value_fn, value_out, param="value_out")
        # Declared type first (#450), and BEFORE the empty check — `group_size`
        # delegates here, so falling back to (key_type, value_type) typed an
        # empty dict's COUNTS as the source value type: silently Float counts
        # on a Dict<String,Float>, against the traced Integer (#525).
        k2 = key_out if key_out is not None else _function_out_type(
            key_fn, _kv_in(key_fn, self.value_type, self.key_type))
        v2 = value_out if value_out is not None else _function_out_type(
            value_fn, _kv_in(value_fn, self.value_type, self.key_type))
        if len(self) == 0:
            return EastDict(k2, v2)
        key_cb = EastFunction(_kv_cb(key_fn), [self.value_type, self.key_type], k2)
        value_cb = EastFunction(_kv_cb(value_fn), [self.value_type, self.key_type], v2)
        # `_combine_cb`, like the Array and Set twins: it accepts a 2- OR
        # 3-argument handler. Wiring `combine` raw made a 2-arg lambda — which
        # works on every other collection, and which the traced twin accepts —
        # fail at run time on a Dict alone (#525).
        combine_cb = EastFunction(_combine_cb(combine, k2, v2), [v2, v2, k2], v2)
        return _call_builtin("DictToDict", [self.key_type, self.value_type, k2, v2], [self, key_cb, value_cb, combine_cb], DictType(k2, v2))

    def flatten_to_array(self, fn: Any, out: EastType | None = None) -> EastArray:
        """Concatenate per-entry arrays into one array (east-c
        DictFlattenToArray; TS ``flattenToArray`` — only an Array spells it
        ``flatMap``).

        Args:
            fn: Called as ``fn(value, key) -> array`` for each entry; the
                resulting arrays are concatenated in key order. The element
                type is that of the array ``fn`` captures.
            out: Pins the result element type.

        Returns:
            A single array of all elements. Empty input yields an empty
            array.
        """
        from east.types.types import ArrayType

        if out is not None:
            _check_function_out(fn, ArrayType(out))
        t2 = out if out is not None else _function_out_type(
            fn, _kv_in(fn, self.value_type, self.key_type)).value
        if len(self) == 0:
            return EastArray(t2, [])
        callback = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], ArrayType(t2))
        return _call_builtin("DictFlattenToArray", [self.key_type, self.value_type, t2], [self, callback], ArrayType(t2))

    flat_map = _deprecated_alias("flat_map", "flatten_to_array")

    def flatten_to_set(self, fn: Any, out: EastType | None = None) -> EastSet:
        """Union per-entry sets into one set (east-c DictFlattenToSet).

        Args:
            fn: Called as ``fn(value, key) -> set`` for each entry; the
                results are unioned. The element type is that of the set ``fn``
                captures.
            out: Pins the result element type.

        Returns:
            The union set of distinct elements, ordered under East's total
            ordering. Empty input yields an empty set.
        """
        from east.types.types import SetType

        if out is not None:
            _check_function_out(fn, SetType(out))
        k2 = out if out is not None else _function_out_type(
            fn, _kv_in(fn, self.value_type, self.key_type)).value
        if len(self) == 0:
            return EastSet(k2)
        callback = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], SetType(k2))
        return _call_builtin("DictFlattenToSet", [self.key_type, self.value_type, k2], [self, callback], SetType(k2))

    def flatten_to_dict(self, fn: Any, combine: Any = None) -> EastDict:
        """Merge per-entry dicts into one dict, resolving collisions (east-c DictFlattenToDict).

        Args:
            fn: Called as ``fn(value, key) -> dict`` for each entry; the
                results are merged. The key/value types are those of the dict
                ``fn`` captures.
            combine: Called as ``combine(existing, incoming[, key]) -> value``
                when a key appears in more than one of the produced dicts;
                without it a duplicate key errors, like every other East
                runtime.

        Returns:
            The merged dict. Empty input yields an empty dict.
        """
        from east.types.types import DictType

        # The captured Dict type carries both parameters, entries or none
        # (#450/#525).
        _ko = _function_out_type(fn, _kv_in(fn, self.value_type, self.key_type))
        k2, v2 = _ko.value["key"], _ko.value["value"]
        map_cb = EastFunction(_kv_cb(fn), [self.value_type, self.key_type], DictType(k2, v2))
        combine_cb = EastFunction(_combine_cb(combine, k2, v2), [v2, v2, k2], v2)
        return _call_builtin("DictFlattenToDict", [self.key_type, self.value_type, k2, v2], [self, map_cb, combine_cb], DictType(k2, v2))

    def group_reduce(self, key_fn: Any, init_fn: Any, fold_fn: Any, key_out: EastType | None = None, acc_out: EastType | None = None) -> EastDict:
        """Group entries by a derived key and fold each group (east-c DictGroupFold).

        Args:
            key_fn: Called as ``key_fn(value, key) -> group key`` to assign
                each entry to a group.
            init_fn: Called as ``init_fn(group_key) -> acc`` to seed each
                group's accumulator the first time the group is seen.
            fold_fn: Called as ``fold_fn(acc, value, key) -> acc`` to fold
                each entry into its group's accumulator.
            key_out: Optional East type pinning the group key type; ``key_fn``'s
                captured output type when omitted.
            acc_out: Optional East type pinning the accumulator type;
                ``init_fn``'s captured output type when omitted.

        Returns:
            A new dict from group key to its folded accumulator. Empty input
            yields an empty dict.
        """
        from east.types.types import DictType

        _check_function_out(key_fn, key_out, param="key_out")
        _check_function_out(init_fn, acc_out, param="acc_out")
        _check_function_out(fold_fn, acc_out, param="acc_out")
        # An EMPTY dict has the same result type a full one has — falling back
        # to (key_type, value_type) made the eager path disagree with the
        # traced one about the RESULT TYPE, invisibly, because both compare
        # equal while empty (#450/#525).
        k2 = key_out if key_out is not None else _function_out_type(key_fn, _kv_in(key_fn, self.value_type, self.key_type))
        t2 = acc_out if acc_out is not None else _function_out_type(init_fn, [k2])
        if len(self) == 0:
            return EastDict(k2, t2)
        key_cb = EastFunction(_kv_cb(key_fn), [self.value_type, self.key_type], k2)
        init_cb = EastFunction(init_fn, [k2], t2)
        fold_cb = EastFunction(_acc_kv_cb(fold_fn), [t2, self.value_type, self.key_type], t2)
        return _call_builtin("DictGroupFold", [self.key_type, self.value_type, k2, t2], [self, key_cb, init_cb, fold_cb], DictType(k2, t2))

    def group_fold(self, key_fn: Any, init_fn: Any, fold_fn: Any, key_out: EastType | None = None, acc_out: EastType | None = None) -> EastDict:
        """Deprecated alias for :meth:`group_reduce` (issue #535).

        The grouped fold had two names — TS ``groupReduce`` on every
        container, east-py ``group_reduce`` on Array but ``group_fold`` on
        Set/Dict — so a call ported by name worked on an Array and raised
        ``AttributeError`` on a Dict. The operation is unchanged; only the
        spelling moves.
        """
        import warnings

        warnings.warn(
            "EastDict.group_fold is deprecated: the grouped fold is spelled "
            "group_reduce on every container (TS groupReduce). See issue #535.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.group_reduce(key_fn, init_fn, fold_fn, key_out=key_out, acc_out=acc_out)

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
                when two indices produce the same key; ``None`` makes a
                duplicate an East runtime error ``Duplicate key <key> in
                dict`` (TS ``Dict.generate``).
            key_type: The East type of generated keys.
            value_type: The East type of generated values.

        Returns:
            A new dict of the generated entries, ordered under East's total
            ordering on keys.
        """
        from east.types.types import DictType, IntegerType

        _check_function_out(key_fn, key_type, param="key_type")
        _check_function_out(value_fn, value_type, param="value_type")
        _check_function_out(combine, value_type, param="value_type")
        key_cb = EastFunction(key_fn, [IntegerType], key_type)
        value_cb = EastFunction(value_fn, [IntegerType], value_type)
        if combine is None:
            from east.expression import _error_combine_function

            combine = _error_combine_function(value_type, key_type, "Duplicate key ", " in dict")
        combine_cb = EastFunction(_mark_function(combine, combine), [value_type, value_type, key_type], value_type)
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

