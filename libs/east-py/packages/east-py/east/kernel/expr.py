#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``KernelExpr`` — the typed expression proxy handed to traced lambdas.

The class core lives here: construction, struct field access (including the
rule that a field WINS over a same-named method), calling a Function-typed
expression, and the python protocol points that must fail loudly rather than
constant-fold trace-time state into the result.

Everything else is an op mixin under ``east.kernel.ops`` — one module per
domain. A mixin builds its results with ``self._expr(…)`` rather than naming
the class, which is what keeps the mixins importable BEFORE the class exists.
"""

from __future__ import annotations

from typing import Any

from east.ir.builders import ir_get_field
from east.kernel.errors import KernelTraceError, _trace_bail
from east.kernel.lift import _lift
from east.kernel.nodes import _k_call
from east.kernel.ops.collections import _CollectionOps
from east.kernel.ops.grouping import _GroupOps
from east.kernel.ops.mutation import _MutationOps
from east.kernel.ops.optionals import _OptionOps
from east.kernel.ops.reductions import _ReductionOps
from east.kernel.ops.scalar import _ScalarOps
from east.kernel.ops.search import _SearchOps
from east.kernel.ops.sequence import _SequenceOps
from east.kernel.ops.temporal import _TemporalOps
from east.kernel.ops.text import _TextOps
from east.kernel.ops.transforms import _TransformOps
from east.types.types import EastType

# The traced collection surface per container kind — every name is a real
# ``KernelExpr`` method. This is the enumeration the docs, the unsupported-
# method error, and the surface-coverage test all pin, so it cannot drift
# silently (#452). Every transform is pure; the in-place mutators at the end
# of each list are the loop-accumulator surface (#578) — the receiver they
# take is a collection the kernel itself built or was handed, never a
# build-time constant.
_TRACED_SURFACE = {
    "Array": tuple(sorted({
        "map", "filter", "filter_map", "first_map", "fold", "scan", "map_reduce",
        "flatten_to_array", "flatten_to_set", "flatten_to_dict",
        "to_dict", "to_set", "unique",
        "group_by", "sorted", "is_sorted", "some", "every", "string_join",
        "concat", "slice", "reversed", "copy", "get_keys",
        "size", "has", "get", "get_or_default", "try_get",
        # in-place mutation (#578)
        "append", "extend", "clear",
        # reductions (#525 phase 1)
        "sum", "mean", "maximum", "minimum",
        # find_* (#525 phase 2)
        "find_first", "find_all", "find_maximum", "find_minimum",
        "find_sorted_first", "find_sorted_last", "find_sorted_range",
        # group_* (#525 phase 3)
        "group_reduce", "group_size", "group_sum", "group_mean",
        "group_every", "group_some", "group_maximum", "group_minimum",
        # group_to_* / group_find_* (#525 phase 3b)
        "group_to_arrays", "group_to_sets", "group_to_dicts",
        "group_find_all", "group_find_first",
        "group_find_maximum", "group_find_minimum",
    })),
    "Set": tuple(sorted({
        "map", "filter", "filter_map", "first_map", "map_reduce", "scan",
        "flatten_to_array", "flatten_to_set", "flatten_to_dict",
        "to_array", "to_dict", "to_set",
        "union", "intersect", "diff", "sym_diff", "is_subset", "is_superset_of",
        "is_disjoint", "copy", "size", "has",
        # reductions (#525 phase 1)
        "reduce", "sum", "mean", "every", "some",
        # group_* (#525 phase 3; group_reduce primary since #535,
        # group_fold = deprecated alias)
        "group_reduce", "group_fold", "group_size", "group_sum", "group_mean",
        "group_every", "group_some",
        # group_to_* (#525 phase 3b)
        "group_to_arrays", "group_to_sets", "group_to_dicts",
        # in-place mutation (#578)
        "insert", "try_insert", "delete", "try_delete", "clear",
    })),
    "Dict": tuple(sorted({
        "map", "filter", "filter_map", "first_map", "map_reduce", "scan",
        "flatten_to_array", "flatten_to_set", "flatten_to_dict",
        "to_array", "to_set", "to_dict", "union",
        "keys_set", "get_keys", "copy",
        "size", "has", "get", "get_or_default", "try_get",
        # reductions (#525 phase 1)
        "reduce", "sum", "mean", "every", "some",
        # group_* (#525 phase 3; group_reduce primary since #535,
        # group_fold = deprecated alias)
        "group_reduce", "group_fold", "group_size", "group_sum", "group_mean",
        "group_every", "group_some",
        # group_to_* (#525 phase 3b)
        "group_to_arrays", "group_to_sets", "group_to_dicts",
        # in-place mutation (#578)
        "insert", "insert_or_update", "delete", "try_delete", "clear",
    })),
}


_SHADOWABLE: frozenset[str] | None = None


def _shadowable_names() -> frozenset[str]:
    """Public ``KernelExpr`` method names — the ones a struct field can shadow.

    Computed once from the class itself, so a method added later is covered
    without anyone remembering to list it here.
    """
    global _SHADOWABLE
    if _SHADOWABLE is None:
        _SHADOWABLE = frozenset(
            n for n in dir(KernelExpr)
            if not n.startswith("_") and callable(getattr(KernelExpr, n, None))
        )
    return _SHADOWABLE


class KernelExpr(
    _ScalarOps,
    _TextOps,
    _TemporalOps,
    _OptionOps,
    _CollectionOps,
    _TransformOps,
    _SequenceOps,
    _ReductionOps,
    _SearchOps,
    _GroupOps,
    _MutationOps,
):
    """A typed East expression under construction (returned to traced lambdas)."""

    __slots__ = ("ir", "east_type")
    __hash__ = None  # type: ignore[assignment]  # exprs are not usable as dict/set keys

    def __init__(self, ir: Any, east_type: EastType):
        self.ir = ir
        self.east_type = east_type

    def __repr__(self) -> str:
        return f"<KernelExpr {self.east_type.type}>"

    # ── struct field access ────────────────────────────────────────────

    def field(self, name: str) -> KernelExpr:
        """Access a struct field (also available as attribute / item access)."""
        if self.east_type.type != "Struct":
            raise KernelTraceError(
                f"field access `.{name}` on a non-struct expression ({self.east_type.type})"
            )
        for f in self.east_type.value:
            if f["name"] == name:
                out_t = f["type"]
                return KernelExpr(
                    ir_get_field(out_t, name, self.ir),
                    out_t,
                )
        available = ", ".join(f["name"] for f in self.east_type.value)
        raise KernelTraceError(f"struct has no field '{name}' (available: {available})")

    def keys(self) -> list[str]:
        """This struct's field names, so ``{**s, "i": s.i + 1}`` works.

        Python's dict unpacking asks a mapping for ``keys()`` and then indexes
        it, both of which a Struct-typed expression can answer. That makes the
        "change one field, keep the rest" spelling — the loop body's ``else``
        branch — the same on the traced and the eager paths.
        """
        if self.east_type.type != "Struct":
            raise KernelTraceError(
                f".keys() on a non-struct expression ({self.east_type.type})")
        return [f["name"] for f in self.east_type.value]

    def __getattribute__(self, name: str) -> Any:
        """Struct FIELDS win over same-named collection methods.

        ``__getattr__`` only fires when normal lookup fails, so every method on
        this class shadows a struct field of the same name — and the failure is
        opaque (``cannot lift python value of type method``) rather than a
        missing-field error. Harmless while the surface was ``map``/``filter``/
        ``size``; not once #525 added ``sum``, ``mean``, ``maximum``,
        ``minimum`` and ``reduce``, which are ordinary column names in real
        data. A Struct-typed expression has NO collection methods (they all
        raise), so the two namespaces are disjoint and the field always wins.

        The name-set test runs first and is a single frozenset hit, so the hot
        internal accesses (``self.ir``, ``self.east_type``) skip the type probe
        entirely; the whole check is trace-time only.
        """
        if name in _shadowable_names():
            east_type = object.__getattribute__(self, "east_type")
            if east_type.type == "Struct":
                for f in east_type.value:
                    if f["name"] == name:
                        return object.__getattribute__(self, "field")(name)
        return object.__getattribute__(self, name)

    def __getattr__(self, name: str) -> KernelExpr:
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        if name.startswith("_east_"):
            # Internal capability probes (`getattr(x, "_east_c_paged", None)`
            # and friends) must see a missing attribute, not a trace error.
            raise AttributeError(name)
        if name == "type" and self.east_type.type == "Variant":
            # The eager EastVariant's `.type` tag attribute — the traced twin
            # is get_tag(), so the one spelling works on both paths.
            return self.get_tag()
        if self.east_type.type in _TRACED_SURFACE:
            # A method miss on a collection-typed expression: name the traced
            # surface instead of the misleading "field access on a non-struct
            # expression" (#452).
            raise KernelTraceError(
                f"`.{name}` is not on the traced kernel surface for a "
                f"{self.east_type.type}-typed expression — supported: "
                f"{', '.join(_TRACED_SURFACE[self.east_type.type])}"
            )
        return self.field(name)

    def __getitem__(self, name: Any) -> KernelExpr:
        if isinstance(name, slice) and self.east_type.type in ("Array", "String"):
            # `arr[a:b]` / `s[a:b]` — the eager slicing spellings, traced as
            # ArraySlice / StringSubstring. Python's from-the-end negatives
            # and steps have no East twin.
            if name.step is not None:
                raise _trace_bail("stepped slice")
            start = name.start if name.start is not None else 0
            if (isinstance(start, int) and start < 0) or \
                    (isinstance(name.stop, int) and name.stop < 0):
                raise _trace_bail("negative slice bound")
            if self.east_type.type == "String":
                if name.stop is None:
                    return self._with_bound_receiver(
                        lambda recv: recv.substring(start, recv.length()))
                return self.substring(start, name.stop)
            if name.stop is None:
                return self._with_bound_receiver(
                    lambda recv: recv.slice(start, recv.size()))
            return self.slice(start, name.stop)
        if self.east_type.type in ("Array", "Dict") and not isinstance(name, str):
            # `split(data, FM)[n]` / `table[key_expr]` — same as .get() (#393).
            return self.get(name)
        if not isinstance(name, str):
            raise _trace_bail(f"[{name!r}] indexing")
        if self.east_type.type == "Dict":
            return self.get(name)
        return self.field(name)

    # ── function-typed expressions are callable (IR Call, #561) ─────────

    def __call__(self, *args: Any) -> KernelExpr:
        """Call a Function-typed expression: a ``FunctionType`` kernel
        parameter, a function-typed struct field, or any other traced
        function value. Emits the IR ``Call`` node, so the callee — whatever
        function value the expression evaluates to at run time — is invoked
        natively per element."""
        tag = self.east_type.type
        if tag == "AsyncFunction":
            raise KernelTraceError(
                "an AsyncFunction value cannot be called inside a sync traced "
                "kernel — call it from python (per-element) instead"
            )
        if tag != "Function":
            raise KernelTraceError(f"calling a non-function expression ({tag})")
        sig = self.east_type.value
        inputs = list(sig["inputs"])
        out_t = sig["output"]
        if len(args) != len(inputs):
            raise KernelTraceError(
                f"function expression takes {len(inputs)} argument(s), "
                f"called with {len(args)}"
            )
        arg_exprs = []
        for a, t in zip(args, inputs, strict=True):
            e = _lift(a, hint=t)
            if e.east_type != t:
                raise KernelTraceError(
                    f"function argument has East type {e.east_type.type}, "
                    f"the parameter expects {t.type}"
                )
            arg_exprs.append(e)
        node = _k_call(out_t, self.ir, [e.ir for e in arg_exprs])
        return KernelExpr(node, out_t)

    # ── operations that cannot be traced (fail loud, fall back) ─────────
    # Every python protocol point with a NON-RAISING default must appear
    # here: an unlisted one silently constant-folds trace-time state into
    # the result (#530's f-string). `__repr__` stays usable for diagnostics.

    def __str__(self) -> str:
        raise KernelTraceError(
            "f-strings / str() cannot be traced into an East kernel — the "
            "expression proxy would constant-fold into the result. Build "
            "strings with `+` concatenation, or let the method fall back"
        )

    def __format__(self, format_spec: str) -> str:
        raise KernelTraceError(
            "f-strings / format() cannot be traced into an East kernel — the "
            "expression proxy would constant-fold into the result. Build "
            "strings with `+` concatenation, or let the method fall back"
        )

    def __bool__(self) -> bool:
        raise _trace_bail("if/and/or/not")

    def __iter__(self):
        raise _trace_bail("iteration")

    def __len__(self) -> int:
        raise _trace_bail("len()")

    def __float__(self) -> float:
        raise _trace_bail("float()")

    def __int__(self) -> int:
        raise _trace_bail("int()")

    def __index__(self) -> int:
        raise _trace_bail("index()")

    def __contains__(self, item: Any) -> bool:
        raise _trace_bail("in")
