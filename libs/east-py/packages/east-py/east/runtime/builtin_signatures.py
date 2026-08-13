#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Declared input signatures for the east-c builtins the eager funnel calls.

``call_builtin`` marshals every argument against the builtin's DECLARED input
type from this table — never against ``type_of(arg)``. Marshalling by the
argument's own inferred type let any wrongly-typed value slot reinterpret
memory inside east-c (#534): the builtin's impl decodes each slot as the type
parameters say, so an Integer key handed to a String-keyed ``DictInsert`` was
dereferenced as a string pointer (exit 139), and a String element handed to an
Integer-keyed ``SetInsert`` surfaced its heap pointer as an East Integer.
Converting against the declared slot type instead raises a named ``TypeError``
at the boundary, and a C-backed proxy in a collection slot gets the
``_check_proxy_type`` mislabel check before its pointer is passed through.

Each entry mirrors ``libs/east/src/builtins.ts`` — the declared source of
truth all runtimes share — as a lambda from the builtin's type parameters to
its input list. ``FN`` marks a Function-typed slot: callbacks carry their own
declared signature on the ``EastFunction`` wrapper (or the compiled kernel's
handle, checked at the native seam), so the funnel only needs to know the slot
is a function. A name missing from this table is a hard error, not a fallback
to the unsafe path — extend the table when a new builtin is exposed.

``ArraySortDefault`` is east-c-only (the keyless sort spelling) and has no
``builtins.ts`` row; its signature mirrors east-c's factory.
"""

from __future__ import annotations

from typing import Any

from east.datetime_format import DateTimeFormatTokenType
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    MatrixType,
    RefType,
    SetType,
    StringType,
    VectorType,
)


class _FunctionSlot:
    """Sentinel for a Function-typed argument slot (see module docstring)."""

    __slots__ = ()

    def __repr__(self) -> str:
        return "FN"


FN = _FunctionSlot()

_TOKENS = ArrayType(DateTimeFormatTokenType)

# name -> lambda(*type_parameters) -> [input slot types]; FN marks callbacks.
_SIGNATURES: dict[str, Any] = {
    # ── comparisons ──
    "Is": lambda T: [T, T],
    "Equal": lambda T: [T, T],
    "NotEqual": lambda T: [T, T],
    "Less": lambda T: [T, T],
    "LessEqual": lambda T: [T, T],
    "Greater": lambda T: [T, T],
    "GreaterEqual": lambda T: [T, T],
    # ── patch ──
    "Diff": lambda T, P: [T, T],
    "ApplyPatch": lambda T, P: [T, P],
    "ComposePatch": lambda T, P: [P, P],
    "InvertPatch": lambda T, P: [P],
    # ── boolean ──
    "BooleanNot": lambda: [BooleanType],
    "BooleanOr": lambda: [BooleanType, BooleanType],
    "BooleanAnd": lambda: [BooleanType, BooleanType],
    "BooleanXor": lambda: [BooleanType, BooleanType],
    # ── integer ──
    "IntegerToFloat": lambda: [IntegerType],
    "IntegerNegate": lambda: [IntegerType],
    "IntegerAdd": lambda: [IntegerType, IntegerType],
    "IntegerSubtract": lambda: [IntegerType, IntegerType],
    "IntegerMultiply": lambda: [IntegerType, IntegerType],
    "IntegerDivide": lambda: [IntegerType, IntegerType],
    "IntegerRemainder": lambda: [IntegerType, IntegerType],
    "IntegerPow": lambda: [IntegerType, IntegerType],
    "IntegerAbs": lambda: [IntegerType],
    "IntegerSign": lambda: [IntegerType],
    "IntegerLog": lambda: [IntegerType, IntegerType],
    # ── float ──
    "FloatToInteger": lambda: [FloatType],
    "FloatNegate": lambda: [FloatType],
    "FloatAdd": lambda: [FloatType, FloatType],
    "FloatSubtract": lambda: [FloatType, FloatType],
    "FloatMultiply": lambda: [FloatType, FloatType],
    "FloatDivide": lambda: [FloatType, FloatType],
    "FloatRemainder": lambda: [FloatType, FloatType],
    "FloatPow": lambda: [FloatType, FloatType],
    "FloatAbs": lambda: [FloatType],
    "FloatSign": lambda: [FloatType],
    "FloatSqrt": lambda: [FloatType],
    "FloatExp": lambda: [FloatType],
    "FloatLog": lambda: [FloatType],
    "FloatSin": lambda: [FloatType],
    "FloatCos": lambda: [FloatType],
    "FloatTan": lambda: [FloatType],
    # ── string ──
    "StringConcat": lambda: [StringType, StringType],
    "StringRepeat": lambda: [StringType, IntegerType],
    "StringLength": lambda: [StringType],
    "StringSubstring": lambda: [StringType, IntegerType, IntegerType],
    "StringUpperCase": lambda: [StringType],
    "StringLowerCase": lambda: [StringType],
    "StringSplit": lambda: [StringType, StringType],
    "StringTrim": lambda: [StringType],
    "StringTrimStart": lambda: [StringType],
    "StringTrimEnd": lambda: [StringType],
    "StringStartsWith": lambda: [StringType, StringType],
    "StringEndsWith": lambda: [StringType, StringType],
    "StringContains": lambda: [StringType, StringType],
    "StringIndexOf": lambda: [StringType, StringType],
    "StringReplace": lambda: [StringType, StringType, StringType],
    "RegexContains": lambda: [StringType, StringType, StringType],
    "RegexIndexOf": lambda: [StringType, StringType, StringType],
    "RegexReplace": lambda: [StringType, StringType, StringType, StringType],
    "StringEncodeUtf8": lambda: [StringType],
    "StringEncodeUtf16": lambda: [StringType],
    "Print": lambda T: [T],
    "Parse": lambda T: [StringType],
    "StringPrintJSON": lambda T: [T],
    "StringParseJSON": lambda T: [StringType],
    # ── datetime ──
    "DateTimeGetYear": lambda: [DateTimeType],
    "DateTimeGetMonth": lambda: [DateTimeType],
    "DateTimeGetDayOfMonth": lambda: [DateTimeType],
    "DateTimeGetHour": lambda: [DateTimeType],
    "DateTimeGetMinute": lambda: [DateTimeType],
    "DateTimeGetSecond": lambda: [DateTimeType],
    "DateTimeGetMillisecond": lambda: [DateTimeType],
    "DateTimeGetDayOfWeek": lambda: [DateTimeType],
    "DateTimeToEpochMilliseconds": lambda: [DateTimeType],
    "DateTimeFromEpochMilliseconds": lambda: [IntegerType],
    "DateTimeFromComponents": lambda: [IntegerType] * 7,
    "DateTimeAddMilliseconds": lambda: [DateTimeType, IntegerType],
    "DateTimeDurationMilliseconds": lambda: [DateTimeType, DateTimeType],
    "DateTimePrintFormat": lambda: [DateTimeType, _TOKENS],
    "DateTimeParseFormat": lambda: [StringType, _TOKENS],
    # ── blob ──
    "BlobSize": lambda: [BlobType],
    "BlobGetUint8": lambda: [BlobType, IntegerType],
    "BlobDecodeUtf8": lambda: [BlobType],
    "BlobDecodeUtf16": lambda: [BlobType],
    "BlobDecodeBeast": lambda T: [BlobType],
    "BlobEncodeBeast": lambda T: [T],
    "BlobDecodeBeast2": lambda T: [BlobType],
    "BlobEncodeBeast2": lambda T: [T],
    "BlobDecodeCsv": lambda T, Config: [BlobType, Config],
    "ArrayEncodeCsv": lambda T, Config: [ArrayType(T), Config],
    # ── ref ──
    "RefGet": lambda T: [RefType(T)],
    "RefUpdate": lambda T: [RefType(T), T],
    "RefMerge": lambda T, T2: [RefType(T), T2, FN],
    # ── array ──
    "ArrayGenerate": lambda T: [IntegerType, FN],
    "ArrayRange": lambda: [IntegerType, IntegerType, IntegerType],
    "ArrayLinspace": lambda: [FloatType, FloatType, IntegerType],
    "ArraySize": lambda T: [ArrayType(T)],
    "ArrayHas": lambda T: [ArrayType(T), IntegerType],
    "ArrayGet": lambda T: [ArrayType(T), IntegerType],
    "ArrayGetOrDefault": lambda T: [ArrayType(T), IntegerType, FN],
    "ArrayTryGet": lambda T: [ArrayType(T), IntegerType],
    "ArrayUpdate": lambda T: [ArrayType(T), IntegerType, T],
    "ArrayMerge": lambda T, T2: [ArrayType(T), IntegerType, T2, FN],
    "ArrayPushLast": lambda T: [ArrayType(T), T],
    "ArrayPopLast": lambda T: [ArrayType(T)],
    "ArrayPushFirst": lambda T: [ArrayType(T), T],
    "ArrayPopFirst": lambda T: [ArrayType(T)],
    "ArrayAppend": lambda T: [ArrayType(T), ArrayType(T)],
    "ArrayPrepend": lambda T: [ArrayType(T), ArrayType(T)],
    "ArrayMergeAll": lambda T, T2: [ArrayType(T), ArrayType(T2), FN],
    "ArrayClear": lambda T: [ArrayType(T)],
    "ArraySortInPlace": lambda T, T2: [ArrayType(T), FN],
    "ArrayReverseInPlace": lambda T: [ArrayType(T)],
    "ArraySort": lambda T, T2: [ArrayType(T), FN],
    "ArraySortDefault": lambda T: [ArrayType(T)],
    "ArrayReverse": lambda T: [ArrayType(T)],
    "ArrayIsSorted": lambda T, T2: [ArrayType(T), FN],
    "ArrayFindSortedFirst": lambda T, T2: [ArrayType(T), T2, FN],
    "ArrayFindSortedLast": lambda T, T2: [ArrayType(T), T2, FN],
    "ArrayFindSortedRange": lambda T, T2: [ArrayType(T), T2, FN],
    "ArrayFindFirst": lambda T, T2: [ArrayType(T), T2, FN],
    "ArrayConcat": lambda T: [ArrayType(T), ArrayType(T)],
    "ArraySlice": lambda T: [ArrayType(T), IntegerType, IntegerType],
    "ArrayGetKeys": lambda T: [ArrayType(T), ArrayType(IntegerType), FN],
    "ArrayForEach": lambda T, T2: [ArrayType(T), FN],
    "ArrayCopy": lambda T: [ArrayType(T)],
    "ArrayMap": lambda T, T2: [ArrayType(T), FN],
    "ArrayFilter": lambda T: [ArrayType(T), FN],
    "ArrayFilterMap": lambda T, T2: [ArrayType(T), FN],
    "ArrayFirstMap": lambda T, T2: [ArrayType(T), FN],
    "ArrayFold": lambda T, T2: [ArrayType(T), T2, FN],
    "ArrayScan": lambda T, T2: [ArrayType(T), T2, FN],
    "ArrayMapReduce": lambda T, T2: [ArrayType(T), FN, FN],
    "ArrayStringJoin": lambda: [ArrayType(StringType), StringType],
    "ArrayToSet": lambda T, K2: [ArrayType(T), FN],
    "ArrayToDict": lambda T, K2, T2: [ArrayType(T), FN, FN, FN],
    "ArrayFlattenToArray": lambda T, T2: [ArrayType(T), FN],
    "ArrayFlattenToSet": lambda T, K2: [ArrayType(T), FN],
    "ArrayFlattenToDict": lambda T, K2, T2: [ArrayType(T), FN, FN],
    "ArrayGroupFold": lambda T, K2, T2: [ArrayType(T), FN, FN, FN],
    # ── set ──
    "SetGenerate": lambda K: [IntegerType, FN, FN],
    "SetSize": lambda K: [SetType(K)],
    "SetHas": lambda K: [SetType(K), K],
    "SetInsert": lambda K: [SetType(K), K],
    "SetTryInsert": lambda K: [SetType(K), K],
    "SetDelete": lambda K: [SetType(K), K],
    "SetTryDelete": lambda K: [SetType(K), K],
    "SetUnionInPlace": lambda K: [SetType(K), SetType(K)],
    "SetClear": lambda K: [SetType(K)],
    "SetUnion": lambda K: [SetType(K), SetType(K)],
    "SetIntersect": lambda K: [SetType(K), SetType(K)],
    "SetDiff": lambda K: [SetType(K), SetType(K)],
    "SetSymDiff": lambda K: [SetType(K), SetType(K)],
    "SetIsSubset": lambda K: [SetType(K), SetType(K)],
    "SetIsDisjoint": lambda K: [SetType(K), SetType(K)],
    "SetCopy": lambda K: [SetType(K)],
    "SetForEach": lambda K, T2: [SetType(K), FN],
    "SetMap": lambda K, T2: [SetType(K), FN],
    "SetFilter": lambda K: [SetType(K), FN],
    "SetFilterMap": lambda K, V2: [SetType(K), FN],
    "SetFirstMap": lambda K, T2: [SetType(K), FN],
    "SetMapReduce": lambda K, T2: [SetType(K), FN, FN],
    "SetReduce": lambda K, T2: [SetType(K), FN, T2],
    "SetScan": lambda K, T2: [SetType(K), FN, T2],
    "SetToArray": lambda K, T2: [SetType(K), FN],
    "SetToSet": lambda K, K2: [SetType(K), FN],
    "SetToDict": lambda K, K2, T2: [SetType(K), FN, FN, FN],
    "SetFlattenToArray": lambda K, T2: [SetType(K), FN],
    "SetFlattenToSet": lambda K, K2: [SetType(K), FN],
    "SetFlattenToDict": lambda K, K2, T2: [SetType(K), FN, FN],
    "SetGroupFold": lambda K, K2, T2: [SetType(K), FN, FN, FN],
    # ── dict ──
    "DictGenerate": lambda K, V: [IntegerType, FN, FN, FN],
    "DictSize": lambda K, V: [DictType(K, V)],
    "DictHas": lambda K, V: [DictType(K, V), K],
    "DictGet": lambda K, V: [DictType(K, V), K],
    "DictGetOrDefault": lambda K, V: [DictType(K, V), K, FN],
    "DictTryGet": lambda K, V: [DictType(K, V), K],
    "DictInsert": lambda K, V: [DictType(K, V), K, V],
    "DictInsertOrUpdate": lambda K, V: [DictType(K, V), K, V, FN],
    "DictGetOrInsert": lambda K, V: [DictType(K, V), K, FN],
    "DictUpdate": lambda K, V: [DictType(K, V), K, V],
    "DictSwap": lambda K, V: [DictType(K, V), K, V],
    "DictMerge": lambda K, V, V2: [DictType(K, V), K, V2, FN, FN],
    "DictDelete": lambda K, V: [DictType(K, V), K],
    "DictTryDelete": lambda K, V: [DictType(K, V), K],
    "DictPop": lambda K, V: [DictType(K, V), K],
    "DictClear": lambda K, V: [DictType(K, V)],
    "DictUnionInPlace": lambda K, V: [DictType(K, V), DictType(K, V), FN],
    "DictMergeAll": lambda K, V, V2: [DictType(K, V), DictType(K, V2), FN, FN],
    "DictKeys": lambda K, V: [DictType(K, V)],
    "DictGetKeys": lambda K, V: [DictType(K, V), SetType(K), FN],
    "DictForEach": lambda K, V, T2: [DictType(K, V), FN],
    "DictCopy": lambda K, V: [DictType(K, V)],
    "DictMap": lambda K, V, V2: [DictType(K, V), FN],
    "DictFilter": lambda K, V: [DictType(K, V), FN],
    "DictFilterMap": lambda K, V, V2: [DictType(K, V), FN],
    "DictFirstMap": lambda K, V, T2: [DictType(K, V), FN],
    "DictMapReduce": lambda K, V, T2: [DictType(K, V), FN, FN],
    "DictReduce": lambda K, V, T2: [DictType(K, V), FN, T2],
    "DictScan": lambda K, V, T2: [DictType(K, V), FN, T2],
    "DictToArray": lambda K, V, T2: [DictType(K, V), FN],
    "DictToSet": lambda K, V, K2: [DictType(K, V), FN],
    "DictToDict": lambda K, V, K2, V2: [DictType(K, V), FN, FN, FN],
    "DictFlattenToArray": lambda K, V, T2: [DictType(K, V), FN],
    "DictFlattenToSet": lambda K, V, K2: [DictType(K, V), FN],
    "DictFlattenToDict": lambda K, V, K2, V2: [DictType(K, V), FN, FN],
    "DictGroupFold": lambda K, V, K2, T2: [DictType(K, V), FN, FN, FN],
    # ── vector ──
    "VectorLength": lambda T: [VectorType(T)],
    "VectorGet": lambda T: [VectorType(T), IntegerType],
    "VectorSet": lambda T: [VectorType(T), IntegerType, T],
    "VectorSlice": lambda T: [VectorType(T), IntegerType, IntegerType],
    "VectorConcat": lambda T: [VectorType(T), VectorType(T)],
    "VectorFromArray": lambda T: [ArrayType(T)],
    "VectorToArray": lambda T: [VectorType(T)],
    "VectorToMatrix": lambda T: [VectorType(T), IntegerType, IntegerType],
    "VectorZeros": lambda T: [IntegerType],
    "VectorOnes": lambda T: [IntegerType],
    "VectorFill": lambda T: [IntegerType, T],
    "VectorMap": lambda T, T2: [VectorType(T), FN],
    "VectorFold": lambda T, T2: [VectorType(T), T2, FN],
    # ── matrix ──
    "MatrixRows": lambda T: [MatrixType(T)],
    "MatrixCols": lambda T: [MatrixType(T)],
    "MatrixGet": lambda T: [MatrixType(T), IntegerType, IntegerType],
    "MatrixSet": lambda T: [MatrixType(T), IntegerType, IntegerType, T],
    "MatrixGetRow": lambda T: [MatrixType(T), IntegerType],
    "MatrixGetCol": lambda T: [MatrixType(T), IntegerType],
    "MatrixToVector": lambda T: [MatrixType(T)],
    "MatrixFromArray": lambda T: [ArrayType(ArrayType(T))],
    "MatrixToArray": lambda T: [MatrixType(T)],
    "MatrixTranspose": lambda T: [MatrixType(T)],
    "MatrixZeros": lambda T: [IntegerType, IntegerType],
    "MatrixOnes": lambda T: [IntegerType, IntegerType],
    "MatrixFill": lambda T: [IntegerType, IntegerType, T],
    "MatrixMapElements": lambda T, T2: [MatrixType(T), FN],
    "MatrixMapRows": lambda T, T2: [MatrixType(T), FN],
    "MatrixToRows": lambda T: [MatrixType(T)],
    "MatrixFromRows": lambda T: [ArrayType(VectorType(T))],
}


def builtin_inputs(name: str, type_params: list) -> list:
    """The declared input types for one builtin call, instanced with its type
    parameters. Entries are East types, or ``FN`` for a Function-typed slot.

    Raises:
        TypeError: If ``name`` has no declared signature here, or
            ``type_params`` does not match its declared type-parameter count.
    """
    sig = _SIGNATURES.get(name)
    if sig is None:
        raise TypeError(
            f"east-c builtin {name!r} has no declared input signature — add it to "
            "east/runtime/builtin_signatures.py (mirroring libs/east/src/builtins.ts)"
        )
    n = sig.__code__.co_argcount
    if n != len(type_params):
        raise TypeError(
            f"east-c builtin {name!r} takes {n} type parameter(s), got {len(type_params)}"
        )
    return sig(*type_params)
