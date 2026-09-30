#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Typed jq queries over East values: the python twin of ``libs/east/src/query``.

The wire types a checked query is made of, and the front end and translator
that make and run one: ``lex_jq``, ``parse_jq``, ``print_jq``, ``check_jq``,
``translate_jq`` and ``evaluate_jq``. ``East.jq`` is the query as East code.
``libs/east/devdocs/QUERY.md`` is the normative account of the language.
"""

from east.query.evaluate import QueryError, evaluate_jq
from east.query.jq.check import CheckedNode, CheckedStage, CheckJqResult, check_jq
from east.query.jq.lex import JqToken, JqTokenKind, lex_jq
from east.query.jq.parse import ParsedJq, parse_jq
from east.query.jq.print import PrintedJq, print_jq
from east.query.jq.spans import JqNode, JqPattern, JqRange, JqSpans, path_at, span_of, to_query_span
from east.query.jq.translate import JqInput, JqTranslation, TranslationError, translate_jq
from east.query.types import (
    JqPatternType,
    JqType,
    QueryCallType,
    QueryEditType,
    QueryErrorType,
    QueryFixType,
    QueryMultiplicityType,
    QuerySpanType,
    QueryType,
    QueryV1Type,
)

__all__ = [
    "CheckJqResult",
    "CheckedNode",
    "CheckedStage",
    "JqInput",
    "JqNode",
    "JqPattern",
    "JqPatternType",
    "JqRange",
    "JqSpans",
    "JqToken",
    "JqTokenKind",
    "JqTranslation",
    "JqType",
    "ParsedJq",
    "PrintedJq",
    "QueryCallType",
    "QueryEditType",
    "QueryError",
    "QueryErrorType",
    "QueryFixType",
    "QueryMultiplicityType",
    "QuerySpanType",
    "QueryType",
    "QueryV1Type",
    "TranslationError",
    "check_jq",
    "evaluate_jq",
    "lex_jq",
    "parse_jq",
    "path_at",
    "print_jq",
    "span_of",
    "to_query_span",
    "translate_jq",
]
