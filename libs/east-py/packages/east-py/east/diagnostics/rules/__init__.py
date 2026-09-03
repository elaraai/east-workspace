#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The rule registry (#638): one rule per file, numbered once, stable."""

from __future__ import annotations

from east.diagnostics.rules.body_takes_block_first import BodyTakesBlockFirst
from east.diagnostics.rules.no_deprecated_alias import NoDeprecatedAlias
from east.diagnostics.rules.no_discarded_expression import NoDiscardedExpression
from east.diagnostics.rules.no_operator_fork import NoOperatorFork
from east.diagnostics.rules.no_python_boolean import NoPythonBoolean
from east.diagnostics.rules.no_python_formatting import NoPythonFormatting
from east.diagnostics.rules.no_python_round import NoPythonRound
from east.diagnostics.rules.no_python_work import NoPythonWork
from east.diagnostics.rules.no_statement_on_outer_block import NoStatementOnOuterBlock
from east.diagnostics.types import Rule

ALL_RULES: tuple[Rule, ...] = (
    BodyTakesBlockFirst(),
    NoOperatorFork(),
    NoPythonFormatting(),
    NoPythonBoolean(),
    NoPythonRound(),
    NoPythonWork(),
    NoStatementOnOuterBlock(),
    NoDeprecatedAlias(),
    NoDiscardedExpression(),
)

RULES_BY_NAME: dict[str, Rule] = {rule.name: rule for rule in ALL_RULES}

__all__ = ["ALL_RULES", "RULES_BY_NAME"]
