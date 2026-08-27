#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The builtin spelling table (#627) — one table for the printer and the
eager compliance replay, ratcheted.

Pins: the printer's raw set IS the replay's funnel set (a builtin gains a
python spelling in both or neither); every replay row has a printer row
whose template names the same method; every namespace-derived row prints;
and the raw set only ever shrinks.
"""

from __future__ import annotations

import re

from east.codegen.spellings import RAW_ONLY, SPELLINGS, namespace_spellings, spelling_for
from east.runtime.builtin_signatures import _SIGNATURES
from tests.eager_replay import _ROWS
from tests.test_compliance_eager import FUNNEL_ONLY


def test_raw_set_is_the_replays_funnel_set():
    # MatrixMapElements is declared but called by no corpus program, so the
    # replay never meets it — raw for the printer, absent from the funnel.
    assert frozenset(FUNNEL_ONLY) | {"MatrixMapElements"} == RAW_ONLY


def test_every_declared_builtin_is_either_spelled_or_raw():
    for name in _SIGNATURES:
        assert (name in SPELLINGS) != (name in RAW_ONLY), name


def test_every_replay_row_has_a_spelling_naming_the_same_method():
    method = re.compile(r"\.([a-z_0-9]+)\(|East\.([A-Za-z]+)\.([a-z_0-9]+)\(")
    for name in _ROWS:
        row = spelling_for(name)
        assert row is not None, f"replay row {name} has no printer spelling"
        if row.operator:
            continue
        assert method.search(row.template), f"{name}: template {row.template!r} names no method"


def test_namespace_spellings_cover_the_scalar_surface():
    rows = namespace_spellings()
    assert "IntegerAdd" in rows and rows["IntegerAdd"][0] == "East.Integer.add"
    assert "StringLength" in rows and rows["StringLength"][0] == "East.String.length"
    assert "Print" in rows and rows["Print"][0] == "East.String.print"
    for name in ("DateTimePrintFormat", "DateTimeParseFormat"):
        assert name not in rows


def test_operator_rows_follow_the_exactness_table():
    """Operators only where python and East agree: no `/` on Integers, no
    `%`, no `**`, no `//`."""
    for name in ("IntegerDivide", "IntegerRemainder", "FloatRemainder", "IntegerPow", "FloatPow"):
        row = spelling_for(name)
        assert row is not None and not row.operator, name
    for name, op in (("IntegerAdd", "+"), ("FloatDivide", "/"), ("Equal", "=="), ("BooleanNot", "~")):
        row = spelling_for(name)
        assert row is not None and row.operator and op in row.template
