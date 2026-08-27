#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The builtin spelling table: IR builtin → python source spelling (#627).

One table for two consumers. The IR→python printer (``east.codegen``) renders
a ``Builtin`` node by its row's **template**; the eager compliance replay
(``tests/eager_replay.py``) derives its rows from the same table, so the
spelling the printer writes and the spelling the replay executes cannot
drift. A row says:

- ``template`` — python source with ``{0}``, ``{1}``, … for the builtin's
  arguments in IR order and ``{T0}``, ``{T1}``, … for its type parameters;
- ``callbacks`` — which argument slots are callbacks, and how the python
  surface's callback signature relates to the builtin's (``"cb"`` — same
  order; ``"dict_kv"`` — the builtin passes ``(value, key)``, python calls
  ``(key, value)``; ``"acc_kv"`` — ``(acc, value, key)`` → ``(acc, key,
  value)``; ``"kv1"`` — python passes only the first argument; ``"trim"`` —
  a nullary/narrowed producer; ``"value"`` — the builtin takes a producer
  function where python takes the VALUE (printable only when the function
  ignores its parameters));
- ``operator`` — the row is an operator spelling (the #624 exactness
  table: only where python and East semantics coincide).

Every builtin with a python spelling has a row; the rest print through the
raw ``East.builtin(...)`` form and are listed by ``RAW_ONLY`` — a ratchet the
printer's tests pin, allowed only to shrink.
"""

from __future__ import annotations

import inspect
import re
from dataclasses import dataclass, field
from typing import Any

__all__ = ["Spelling", "SPELLINGS", "spelling_for", "RAW_ONLY", "namespace_spellings"]


@dataclass(frozen=True)
class Spelling:
    template: str
    callbacks: dict[int, str] = field(default_factory=dict)
    operator: bool = False
    #: the argument that must be an expression for the template to apply
    #: (a namespace spelling works on plain values too)
    note: str = ""


def _s(template: str, callbacks: dict[int, str] | None = None, **kw: Any) -> Spelling:
    return Spelling(template, dict(callbacks or {}), **kw)


CB = "cb"

#: Hand-written rows — the collection, tensor and comparison surface. The
#: scalar namespaces (``East.Integer.*`` and friends) derive below.
_HAND: dict[str, Spelling] = {
    # ── operators (the #624 exactness table) ────────────────────────────
    "IntegerAdd": _s("({0} + {1})", operator=True),
    "FloatAdd": _s("({0} + {1})", operator=True),
    "IntegerSubtract": _s("({0} - {1})", operator=True),
    "FloatSubtract": _s("({0} - {1})", operator=True),
    "IntegerMultiply": _s("({0} * {1})", operator=True),
    "FloatMultiply": _s("({0} * {1})", operator=True),
    "FloatDivide": _s("({0} / {1})", operator=True),
    "IntegerNegate": _s("(-{0})", operator=True),
    "FloatNegate": _s("(-{0})", operator=True),
    "StringConcat": _s("({0} + {1})", operator=True),
    "Equal": _s("({0} == {1})", operator=True),
    "NotEqual": _s("({0} != {1})", operator=True),
    "Less": _s("({0} < {1})", operator=True),
    "LessEqual": _s("({0} <= {1})", operator=True),
    "Greater": _s("({0} > {1})", operator=True),
    "GreaterEqual": _s("({0} >= {1})", operator=True),
    "BooleanAnd": _s("({0} & {1})", operator=True),
    "BooleanOr": _s("({0} | {1})", operator=True),
    "BooleanXor": _s("({0} ^ {1})", operator=True),
    "BooleanNot": _s("(~{0})", operator=True),
    # RegexReplace: the user spelling reorders the trailing arguments — the
    # builtin carries (text, pattern, flags, replacement).
    "RegexReplace": _s("East.String.regex_replace({0}, {1}, {3}, {2})"),
    # ── Array ────────────────────────────────────────────────────────────
    "ArrayMap": _s("{0}.map({1})", {1: CB}),
    "ArrayFilter": _s("{0}.filter({1})", {1: CB}),
    "ArrayFilterMap": _s("{0}.filter_map({1})", {1: CB}),
    "ArrayFirstMap": _s("{0}.first_map({1})", {1: CB}),
    "ArrayFold": _s("{0}.fold({1}, {2})", {2: CB}),
    "ArrayScan": _s("{0}.scan({1}, {2})", {2: CB}),
    "ArrayMapReduce": _s("{0}.map_reduce({1}, {2})", {1: CB, 2: CB}),
    "ArraySize": _s("{0}.size()"),
    "ArrayHas": _s("{0}.has({1})"),
    "ArrayGet": _s("{0}.get({1})"),
    "ArrayGetOrDefault": _s("{0}.get_or_default({1}, {2})", {2: "value"}),
    "ArrayTryGet": _s("{0}.try_get({1})"),
    "ArrayConcat": _s("{0}.concat({1})"),
    "ArraySlice": _s("{0}.slice({1}, {2})"),
    "ArrayReverse": _s("{0}.reversed()"),
    "ArrayCopy": _s("{0}.copy()"),
    "ArraySortDefault": _s("{0}.sorted()"),
    "ArraySort": _s("{0}.sorted(key={1})", {1: CB}),
    "ArrayIsSorted": _s("{0}.is_sorted(key={1})", {1: CB}),
    "ArrayToSet": _s("{0}.to_set({1})", {1: CB}),
    "ArrayToDict": _s("{0}.to_dict({1}, value={2}, combine={3})", {1: CB, 2: CB, 3: CB}),
    "ArrayGroupFold": _s("{0}.group_reduce({1}, {2}, {3})", {1: CB, 2: CB, 3: CB}),
    "ArrayFlattenToArray": _s("{0}.flatten_to_array({1})", {1: CB}),
    "ArrayFlattenToSet": _s("{0}.flatten_to_set({1})", {1: CB}),
    "ArrayFlattenToDict": _s("{0}.flatten_to_dict({1}, {2})", {1: CB, 2: CB}),
    "ArrayStringJoin": _s("{0}.string_join({1})"),
    "ArrayUpdate": _s("{0}.set_at({1}, {2})"),
    "ArrayClear": _s("{0}.clear()"),
    "ArrayPushLast": _s("{0}.append({1})"),
    "ArrayPushFirst": _s("{0}.prepend({1})"),
    "ArrayPopLast": _s("{0}.pop()"),
    "ArrayPopFirst": _s("{0}.pop_first()"),
    "ArrayAppend": _s("{0}.extend({1})"),
    "ArrayReverseInPlace": _s("{0}.reverse_in_place()"),
    "ArraySortInPlace": _s("{0}.sort_in_place({1})", {1: CB}),
    "SetGenerate": _s("East.Set.generate({0}, {1}, {2}, {T0})", {1: CB, 2: CB}),
    "ArrayGenerate": _s("East.Array.generate({0}, {1}, {T0})", {1: CB}),
    "ArrayRange": _s("East.Array.range({0}, {1}, {2})"),
    "ArrayLinspace": _s("East.Array.linspace({0}, {1}, {2})"),
    "ArrayForEach": _s("{0}.for_each({1})", {1: CB}),
    "ArrayFindFirst": _s("{0}.find_first({1}, key={2})", {2: CB}),
    "ArrayFindSortedFirst": _s("{0}.find_sorted_first({1}, key={2})", {2: CB}),
    "ArrayFindSortedLast": _s("{0}.find_sorted_last({1}, key={2})", {2: CB}),
    "ArrayFindSortedRange": _s("{0}.find_sorted_range({1}, key={2})", {2: CB}),
    # ── Set ──────────────────────────────────────────────────────────────
    "SetSize": _s("{0}.size()"),
    "SetHas": _s("{0}.has({1})"),
    "SetInsert": _s("{0}.insert({1})"),
    "SetDelete": _s("{0}.delete({1})"),
    "SetClear": _s("{0}.clear()"),
    "SetTryInsert": _s("{0}.try_insert({1})"),
    "SetTryDelete": _s("{0}.try_delete({1})"),
    "SetUnion": _s("{0}.union({1})"),
    "SetIntersect": _s("{0}.intersect({1})"),
    "SetDiff": _s("{0}.diff({1})"),
    "SetSymDiff": _s("{0}.sym_diff({1})"),
    "SetIsSubset": _s("{0}.is_subset({1})"),
    "SetIsDisjoint": _s("{0}.is_disjoint({1})"),
    "SetCopy": _s("{0}.copy()"),
    "SetUnionInPlace": _s("{0}.union_in_place({1})"),
    "SetToArray": _s("{0}.to_array({1})", {1: CB}),
    "SetToSet": _s("{0}.to_set({1})", {1: CB}),
    "SetToDict": _s("{0}.to_dict({1}, {2}, {3})", {1: CB, 2: CB, 3: CB}),
    "SetMap": _s("{0}.map({1})", {1: CB}),
    "SetFilter": _s("{0}.filter({1})", {1: CB}),
    "SetFilterMap": _s("{0}.filter_map({1})", {1: CB}),
    "SetFirstMap": _s("{0}.first_map({1})", {1: CB}),
    "SetMapReduce": _s("{0}.map_reduce({1}, {2})", {1: CB, 2: CB}),
    "SetReduce": _s("{0}.reduce({2}, {1})", {1: CB}),
    "SetScan": _s("{0}.scan({2}, {1})", {1: CB}),
    "SetGroupFold": _s("{0}.group_reduce({1}, {2}, {3})", {1: CB, 2: CB, 3: CB}),
    "SetFlattenToArray": _s("{0}.flatten_to_array({1})", {1: CB}),
    "SetFlattenToSet": _s("{0}.flatten_to_set({1})", {1: CB}),
    "SetFlattenToDict": _s("{0}.flatten_to_dict({1}, {2})", {1: CB, 2: CB}),
    "SetForEach": _s("{0}.for_each({1})", {1: CB}),
    # ── Dict (the builtin calls callbacks (value, key); python (key, value)) ──
    "DictSize": _s("{0}.size()"),
    "DictHas": _s("{0}.has({1})"),
    "DictGet": _s("{0}.get({1})"),
    "DictGetOrDefault": _s("{0}.get_or_default({1}, {2})", {2: "value"}),
    "DictTryGet": _s("{0}.try_get({1})"),
    "DictInsert": _s("{0}.insert({1}, {2})"),
    "DictGetOrInsert": _s("{0}.get_or_insert({1}, {2})", {2: "trim"}),
    "DictInsertOrUpdate": _s("{0}.insert_or_update({1}, {2}, {3})", {3: CB}),
    "DictUpdate": _s("{0}.update_at({1}, {2})"),
    "DictSwap": _s("{0}.swap({1}, {2})"),
    "DictPop": _s("{0}.pop({1})"),
    "DictClear": _s("{0}.clear()"),
    "DictDelete": _s("{0}.delete({1})"),
    "DictTryDelete": _s("{0}.try_delete({1})"),
    "DictCopy": _s("{0}.copy()"),
    "DictKeys": _s("{0}.keys_set()"),
    "DictGetKeys": _s("{0}.get_keys({1}, {2})", {2: CB}),
    "DictMap": _s("{0}.map({1})", {1: CB}),  # DictMap is the one Dict callback python calls (value, key)
    "DictFilter": _s("{0}.filter({1})", {1: "dict_kv"}),
    "DictFilterMap": _s("{0}.filter_map({1})", {1: "dict_kv"}),
    "DictFirstMap": _s("{0}.first_map({1})", {1: "dict_kv"}),
    "DictMapReduce": _s("{0}.map_reduce({1}, {2})", {1: "dict_kv", 2: CB}),
    "DictReduce": _s("{0}.reduce({2}, {1})", {1: "acc_kv"}),
    "DictScan": _s("{0}.scan({2}, {1})", {1: "acc_kv"}),
    "DictToArray": _s("{0}.to_array({1})", {1: "dict_kv"}),
    "DictToSet": _s("{0}.to_set({1})", {1: "dict_kv"}),
    "DictToDict": _s("{0}.to_dict({1}, {2}, {3})", {1: "dict_kv", 2: "dict_kv", 3: CB}),
    "DictGroupFold": _s("{0}.group_reduce({1}, {2}, {3})", {1: "dict_kv", 2: CB, 3: "acc_kv"}),
    "DictFlattenToArray": _s("{0}.flatten_to_array({1})", {1: "dict_kv"}),
    "DictFlattenToSet": _s("{0}.flatten_to_set({1})", {1: "dict_kv"}),
    "DictFlattenToDict": _s("{0}.flatten_to_dict({1}, {2})", {1: "dict_kv", 2: CB}),
    "DictUnionInPlace": _s("{0}.union_in_place({1}, {2})", {2: CB}),
    "DictMerge": _s("{0}.merge_key({1}, {2}, {3}, {4})", {3: CB, 4: CB}),
    "DictMergeAll": _s("{0}.merge_all({1}, {2}, {3})", {2: CB, 3: CB}),
    "DictForEach": _s("{0}.for_each({1})", {1: "dict_kv"}),
    "DictGenerate": _s("East.Dict.generate({0}, {1}, {2}, {3}, {T0}, {T1})", {1: CB, 2: CB, 3: CB}),
    # ── Ref ──────────────────────────────────────────────────────────────
    "RefGet": _s("{0}.get()"),
    "RefUpdate": _s("{0}.set({1})"),
    "RefMerge": _s("{0}.merge({1}, {2})", {2: CB}),
    # ── Vector / Matrix arithmetic (#598) ────────────────────────────────
    "VectorScale": _s("{0}.scale({1})"),
    "VectorSum": _s("{0}.sum()"),
    "VectorAddScaled": _s("{0}.add_scaled({1}, {2})"),
    "VectorMul": _s("{0}.mul({1})"),
    "VectorAddScalar": _s("{0}.add_scalar({1})"),
    "VectorDot": _s("{0}.dot({1})"),
    "VectorMax": _s("{0}.maximum()"),
    "VectorMin": _s("{0}.minimum()"),
    "VectorArgMax": _s("{0}.arg_max()"),
    "VectorArgMin": _s("{0}.arg_min()"),
    "VectorMean": _s("{0}.mean()"),
    "VectorCumSum": _s("{0}.cum_sum()"),
    "VectorAbs": _s("{0}.abs()"),
    "VectorClamp": _s("{0}.clamp({1}, {2})"),
    "VectorGather": _s("{0}.gather({1})"),
    "VectorScatterAdd": _s("{0}.scatter_add({1}, {2})"),
    "VectorSearchSorted": _s("{0}.search_sorted({1})"),
    "VectorEq": _s("{0}.eq({1})"),
    "VectorLt": _s("{0}.lt({1})"),
    "VectorGt": _s("{0}.gt({1})"),
    "VectorSelect": _s("{0}.select({1}, {2})"),
    "VectorCompress": _s("{1}.compress({0})"),
    "VectorCountTrue": _s("{0}.count_true()"),
    "SparseAxpy": _s("East.Vector.sparse_axpy({0}, {1}, {2}, {3}, {4})"),
    "SparseFromPairs": _s("East.Vector.sparse_from_pairs({0}, {1})"),
    "SparseFilterGt": _s("East.Vector.sparse_filter_gt({0}, {1}, {2})"),
    "MatrixScale": _s("{0}.scale({1})"),
    "MatrixAddScaled": _s("{0}.add_scaled({1}, {2})"),
    "MatrixMulElementwise": _s("{0}.mul_elementwise({1})"),
    "MatrixRowSums": _s("{0}.row_sums()"),
    "MatrixColSums": _s("{0}.col_sums()"),
    "MatrixVecMul": _s("{0}.vec_mul({1})"),
}


# ─── scalar spellings derived from the East namespaces ──────────────────────
# Each namespace method is a thin 1:1 mirror of one builtin; the builtin name
# is a string constant in its code object, so the user surface itself supplies
# the mapping — no hand-written scalar table to drift.

_NAMESPACE_NAMES = ("Boolean", "Integer", "Float", "String", "DateTime")


def _known_builtin_hints(spaces: list[tuple[str, Any]]) -> set[str]:
    pat = re.compile(r"^[A-Z][A-Za-z0-9]+$")
    hints: set[str] = set()
    for _prefix, space in spaces:
        for _m, fn in inspect.getmembers(space, callable):
            for c in getattr(getattr(fn, "__code__", None), "co_consts", ()):
                if isinstance(c, str) and pat.match(c):
                    hints.add(c)
    return hints


def namespace_spellings() -> dict[str, tuple[str, Any, int]]:
    """``builtin → (python source prefix, the namespace method, its arity)``
    for every scalar namespace method that mirrors exactly one builtin. The
    prefix is ``"East.Integer.add"``-style; the arity decides whether the
    builtin's type parameters are passed first (``len(tps) + len(args)``
    parameters), only the first is (``1 + len(args)``), or none are."""
    from east.namespace import East
    from east.runtime.builtin_signatures import _SIGNATURES

    spaces: list[tuple[str, Any]] = [("East", East)]
    spaces += [(f"East.{n}", getattr(East, n)) for n in _NAMESPACE_NAMES]
    hints = _known_builtin_hints(spaces)
    rows: dict[str, tuple[str, Any, int]] = {}
    for prefix, space in spaces:
        for mname, fn in inspect.getmembers(space, callable):
            if mname.startswith("_"):
                continue
            consts = getattr(getattr(fn, "__code__", None), "co_consts", ())
            names = [c for c in consts if isinstance(c, str) and c in hints]
            if len(names) == 1 and names[0] not in rows and names[0] in _SIGNATURES:
                try:
                    arity = len(inspect.signature(fn).parameters)
                except (TypeError, ValueError):
                    continue
                rows[names[0]] = (f"{prefix}.{mname}", fn, arity)
    # The formatted-datetime builtins take a pre-tokenized token array; the
    # namespace sugar tokenizes a format STRING, so the row cannot reproduce
    # the IR's argument shape.
    for name in ("DateTimePrintFormat", "DateTimeParseFormat"):
        rows.pop(name, None)
    return rows


def _namespace_template(prefix: str, arity: int, n_tps: int, n_args: int) -> str:
    args = ", ".join(f"{{{i}}}" for i in range(n_args))
    tps = ", ".join(f"{{T{i}}}" for i in range(n_tps))
    if n_tps and arity == n_tps + n_args:
        return f"{prefix}({tps}{', ' if args else ''}{args})"
    if n_tps and arity == 1 + n_args:
        return f"{prefix}({{T0}}{', ' if args else ''}{args})"
    return f"{prefix}({args})"


_derived: dict[str, Spelling] | None = None


def _derived_rows() -> dict[str, Spelling]:
    global _derived
    if _derived is None:
        from east.runtime.builtin_signatures import _SIGNATURES

        rows: dict[str, Spelling] = {}
        for name, (prefix, _fn, arity) in namespace_spellings().items():
            sig = _SIGNATURES.get(name)
            if sig is None:
                continue
            n_tps = sig.__code__.co_argcount
            try:
                n_args = len(sig(*([None] * n_tps)))
            except Exception:
                continue
            rows[name] = Spelling(_namespace_template(prefix, arity, n_tps, n_args))
        _derived = rows
    return _derived


def spelling_for(name: str) -> Spelling | None:
    """The spelling row of a builtin, or None (printed raw)."""
    hit = _HAND.get(name)
    if hit is not None:
        return hit
    return _derived_rows().get(name)


class _Table(dict):
    """``SPELLINGS[name]`` — hand rows first, namespace-derived rows behind."""

    def __missing__(self, key: str) -> Spelling:
        row = _derived_rows().get(key)
        if row is None:
            raise KeyError(key)
        return row

    def __contains__(self, key: object) -> bool:  # type: ignore[override]
        return dict.__contains__(self, key) or key in _derived_rows()

    def all_names(self) -> set[str]:
        return set(self.keys()) | set(_derived_rows())


SPELLINGS: _Table = _Table(_HAND)

#: Builtins with no python spelling — printed through ``East.builtin(...)``.
#: The compliance replay's FUNNEL_ONLY set plus ``MatrixMapElements`` (which
#: no corpus program calls, so the replay never meets it): the printer's
#: tests pin that this set only ever shrinks.
RAW_ONLY: frozenset[str] = frozenset({
    "MatrixMapElements",
    "ArrayEncodeCsv", "ArrayGetKeys", "ArrayMerge", "ArrayMergeAll", "ArrayPrepend",
    "BlobDecodeBeast", "BlobDecodeBeast2", "BlobDecodeCsv", "BlobDecodeUtf16",
    "BlobDecodeUtf8", "BlobEncodeBeast", "BlobEncodeBeast2", "BlobGetUint8", "BlobSize",
    "DateTimeParseFormat", "DateTimePrintFormat",
    "MatrixCols", "MatrixFill", "MatrixFromArray", "MatrixFromRows", "MatrixGet",
    "MatrixGetCol", "MatrixGetRow", "MatrixMapRows", "MatrixOnes", "MatrixRows", "MatrixSet",
    "MatrixToArray", "MatrixToRows", "MatrixToVector", "MatrixTranspose", "MatrixZeros",
    "VectorConcat", "VectorFill", "VectorFold", "VectorFromArray", "VectorGet", "VectorLength",
    "VectorMap", "VectorOnes", "VectorSet", "VectorSlice", "VectorToArray", "VectorToMatrix",
    "VectorZeros",
})
