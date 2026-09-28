#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Python's jq rules are keyed by TypeScript's catalog (#926 Y4).

``east/query/jq/_catalog.json`` is TypeScript's catalog as ``make
query-corpus`` in ``libs/east`` writes it, and ``query.corpus.spec.ts`` fails
while the file is stale. Python's typing and translation rules are functions
keyed by a builtin's name. This test holds their keys to the file's, so a
builtin TypeScript adds, renames or refuses fails here until python follows.
"""

from __future__ import annotations

from east.query.jq.catalog import BUILTINS, TRANSLATED_BUILTINS, TRANSLATED_FORMATS, TYPING_RULES
from east.query.jq.translate_builtins import BUILTIN_RULES, FORMATS

#: The builtins a query may call: the supported ones, and the tooling-only ones.
CALLABLE = {name for name, b in BUILTINS.items() if b.status in ("supported", "tooling")}


def test_every_builtin_a_query_may_call_has_a_typing_rule_and_no_other_does() -> None:
    assert not CALLABLE - set(TYPING_RULES), f"no typing rule for {sorted(CALLABLE - set(TYPING_RULES))}"
    assert not set(TYPING_RULES) - CALLABLE, f"a typing rule for {sorted(set(TYPING_RULES) - CALLABLE)}, which a query may not call"


def test_the_translation_rules_are_typescripts() -> None:
    assert set(BUILTIN_RULES) == set(TRANSLATED_BUILTINS), (
        f"python only: {sorted(set(BUILTIN_RULES) - set(TRANSLATED_BUILTINS))}; "
        f"TypeScript only: {sorted(set(TRANSLATED_BUILTINS) - set(BUILTIN_RULES))}")


def test_the_formats_are_typescripts() -> None:
    assert set(FORMATS) == set(TRANSLATED_FORMATS), (
        f"python only: {sorted(set(FORMATS) - set(TRANSLATED_FORMATS))}; "
        f"TypeScript only: {sorted(set(TRANSLATED_FORMATS) - set(FORMATS))}")


def test_every_builtin_a_query_may_call_and_every_format_has_a_translation() -> None:
    for name in sorted(CALLABLE):
        assert name in BUILTIN_RULES, f"{name} has no translation rule"
        if name.startswith("@"):
            assert name[1:] in FORMATS, f"{name} has no format"
