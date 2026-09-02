#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The layout document algebra (#639): the fits-or-breaks rule, hard lines,
hugging, choices — each pinned on a small document, so the printer's layout
rests on stated semantics rather than on its output. The TypeScript twin is
``libs/east/src/codegen/doc.spec.ts``."""

from __future__ import annotations

from east.codegen.doc import (
    bracket,
    call_args,
    choice,
    flat,
    group,
    hardline,
    hug,
    indent,
    join,
    line,
    render,
    softline,
    will_break,
)


def test_a_group_is_flat_when_it_fits_the_remaining_width_and_breaks_otherwise():
    items = ["aaaa", "bbbb", "cccc"]
    assert render(bracket("[", items, "]"), 40) == "[aaaa, bbbb, cccc]"
    assert render(bracket("[", items, "]"), 10) == "[\n    aaaa,\n    bbbb,\n    cccc,\n]"
    # what follows the group on its line counts: the same list breaks when a tail no longer fits
    assert render([bracket("[", items, "]"), " + tail"], 20) == "[\n    aaaa,\n    bbbb,\n    cccc,\n] + tail"
    assert render(bracket("{", ["'a': 1"], "}"), 80) == "{'a': 1}"
    assert render(bracket("{", [], "}"), 80) == "{}"
    assert flat(bracket("[", items, "]")) == "[aaaa, bbbb, cccc]"


def test_nested_groups_take_their_own_turn():
    inner = bracket("[", ["1", "2"], "]")
    outer = bracket("(", ["first", inner, "third"], ")")
    assert render(["f", outer], 14) == "f(\n    first,\n    [1, 2],\n    third,\n)"


def test_a_hard_line_breaks_every_group_around_it_and_a_body_renders_in_break_mode():
    body = group(["def f():", indent([hardline, bracket("(", ["a", "b"], ")")])])
    assert render(["x = ", bracket("[", [body], "]")], 80) == "x = [\n    def f():\n        (a, b),\n]"
    assert will_break(body)
    assert not will_break(bracket("[", ["a"], "]"))


def test_a_choice_takes_the_first_option_that_fits_up_to_its_first_line_break_else_the_last():
    c = choice("short", "a much longer fallback")
    assert render(c, 10) == "short"
    assert render(["0123456789", c], 12) == "0123456789a much longer fallback"


def test_a_sole_literal_argument_is_hugged_and_nothing_else_is():
    lit = hug(bracket("[", ["('a', T)", "('b', T)"], "]"))
    assert render(["StructType", call_args([lit])], 20) == "StructType([\n    ('a', T),\n    ('b', T),\n])"
    # black's rule: two arguments break one per line, the literal breaking inside its own line when it must
    assert render(["f", call_args([lit, "T"])], 25) == "f(\n    [('a', T), ('b', T)],\n    T,\n)"
    assert render(["f", call_args([lit, "T"])], 18) == "f(\n    [\n        ('a', T),\n        ('b', T),\n    ],\n    T,\n)"
    assert render(["f", call_args([])], 80) == "f()"


def test_a_choices_fallback_options_never_break_the_groups_around_it():
    chain = choice(["x", ".a()", ".b()", ".c()"], group(["x", hardline, ".a()", hardline, ".b()", hardline, ".c()"]))
    assert render(["y = b.let", call_args([chain])], 80) == "y = b.let(x.a().b().c())"
    assert render(["y = b.let", call_args([chain])], 16) == "y = b.let(\n    x\n    .a()\n    .b()\n    .c(),\n)"
    assert not will_break(chain)


def test_lines_and_trailing_spaces():
    g = group(["a", line, "b", softline, "c"])
    assert render(g, 80) == "a bc"
    assert render(g, 2) == "a\nb\nc"
    assert render(["x ", hardline, "y"], 80) == "x\ny"
    assert render(indent(["a", hardline, "b"]), 80, "  ") == "a\n  b"
    assert render(join(", ", ["1", "2", "3"]), 80) == "1, 2, 3"
