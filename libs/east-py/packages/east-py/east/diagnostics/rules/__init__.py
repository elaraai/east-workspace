#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The rule registry (#638): one rule per file, numbered once, stable."""

from __future__ import annotations

from east.diagnostics.rules.body_takes_block_first import BodyTakesBlockFirst
from east.diagnostics.rules.no_build_time_clock import NoBuildTimeClock
from east.diagnostics.rules.no_compile_time_data_injection import NoCompileTimeDataInjection
from east.diagnostics.rules.no_deprecated_alias import NoDeprecatedAlias
from east.diagnostics.rules.no_derived_struct_fields import NoDerivedStructFields
from east.diagnostics.rules.no_discarded_expression import NoDiscardedExpression
from east.diagnostics.rules.no_handrolled_variant import NoHandrolledVariant
from east.diagnostics.rules.no_host_comparison_on_east_values import NoHostComparisonOnEastValues
from east.diagnostics.rules.no_inline_credentials import NoInlineCredentials
from east.diagnostics.rules.no_let_const_in_expression import NoLetConstInExpression
from east.diagnostics.rules.no_module_scope_east_macro import NoModuleScopeEastMacro
from east.diagnostics.rules.no_operator_fork import NoOperatorFork
from east.diagnostics.rules.no_python_boolean import NoPythonBoolean
from east.diagnostics.rules.no_python_data_work import NoPythonDataWork
from east.diagnostics.rules.no_python_east_data import NoPythonEastData
from east.diagnostics.rules.no_python_formatting import NoPythonFormatting
from east.diagnostics.rules.no_python_round import NoPythonRound
from east.diagnostics.rules.no_python_string_building import NoPythonStringBuilding
from east.diagnostics.rules.no_python_work import NoPythonWork
from east.diagnostics.rules.no_redundant_east_cast import NoRedundantEastCast
from east.diagnostics.rules.no_reinlined_east_binding import NoReinlinedEastBinding
from east.diagnostics.rules.no_statement_on_outer_block import NoStatementOnOuterBlock
from east.diagnostics.rules.no_untracked_east_data import NoUntrackedEastData
from east.diagnostics.rules.prefer_explicit_east_type import PreferExplicitEastType
from east.diagnostics.rules.prefer_let_const_over_east_value import PreferLetConstOverEastValue
from east.diagnostics.rules.prefer_some_none import PreferSomeNone
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
    PreferSomeNone(),
    NoHandrolledVariant(),
    PreferExplicitEastType(),
    NoLetConstInExpression(),
    NoUntrackedEastData(),
    NoReinlinedEastBinding(),
    NoRedundantEastCast(),
    PreferLetConstOverEastValue(),
    NoHostComparisonOnEastValues(),
    NoModuleScopeEastMacro(),
    NoBuildTimeClock(),
    NoInlineCredentials(),
    NoCompileTimeDataInjection(),
    NoPythonEastData(),
    NoPythonStringBuilding(),
    NoDerivedStructFields(),
    NoPythonDataWork(),
)

RULES_BY_NAME: dict[str, Rule] = {rule.name: rule for rule in ALL_RULES}

__all__ = ["ALL_RULES", "RULES_BY_NAME"]
