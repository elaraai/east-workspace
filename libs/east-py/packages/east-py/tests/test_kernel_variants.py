#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""General variant construction in traced kernels (#541).

The 2-arg ``variant(case, payload)`` construction carries no VariantType, so
a traced kernel needs the type from context. These pin every context that
supplies it — the build's declared output (threaded to the root lift), a
``if_else()`` sibling, a typed struct field — and the deferred ``if_else`` over
variant branches in both arms. The exact spellings are the issue's repro.
"""

import pytest

from east import (
    East,
    EastArray,
    NullType,
    StringType,
    StructType,
    VariantType,
    east_null,
    if_else,
    variant,
)
from east.expression import ExpressionError

Source = VariantType([("vessel", StringType), ("added", NullType)])
Row = StructType([("code", StringType)])


def _rows() -> EastArray:
    return EastArray(Row, [{"code": "TANK-1"}, {"code": "ADDED"}])


def _classify(r):
    return if_else(r["code"] == "ADDED", variant("added", east_null),
                 variant("vessel", r["code"]))


def test_where_with_variant_branches_without_context_raises_the_actionable_error():
    # A build's declared output always types the root, so the context-free
    # spelling is an eager call with no out=.
    with pytest.raises(ExpressionError, match="needs a type from context"):
        _rows().map(_classify)


def test_unknown_case_names_the_declared_cases():
    with pytest.raises(ExpressionError, match="not in"):
        East.function([Row], Source, lambda r: variant("boat", r["code"]))


def test_payload_type_mismatch_is_named():
    with pytest.raises(ExpressionError, match="payload has type Integer, expected String"):
        East.function([Row], Source, lambda r: variant("vessel", 1))


def test_bare_variant_without_any_context_raises_the_actionable_error():
    with pytest.raises(ExpressionError, match="needs a VariantType from context"):
        _rows().map(lambda r: variant("vessel", r["code"]))


