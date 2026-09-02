#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The rule corpus (#638).

For every rule, ``fixtures/<rule>/ok.py`` is East the rule leaves alone and
``fixtures/<rule>/bad.py`` is East whose offending lines carry
``# expect: <rule>``: the diagnostics of the file must be exactly the marked
lines — no line unmarked, no marker unreported — and the ``ok`` file must be
clean under EVERY rule. "One message, two moments": where the build refuses
the same code, the exception's text is the diagnostic's, pinned by building
the very source the rules read.
"""

from __future__ import annotations

import re
import warnings
from pathlib import Path

import pytest

from east.diagnostics import (
    ALL_RULES,
    DEFAULT_EXCLUDES,
    RULES_BY_NAME,
    Diagnostic,
    lint_paths,
    run_east_rules,
)
from east.expression.errors import ExpressionError

FIXTURES = Path(__file__).parent / "fixtures"
EXPECT = re.compile(r"#\s*expect:\s*([\w, -]+)")
RULE_IDS = [rule.name for rule in ALL_RULES]


def expected_marks(source: str) -> set[tuple[int, str]]:
    """``{(line, rule)}`` for every ``# expect: a, b`` marker."""
    marks: set[tuple[int, str]] = set()
    for lineno, line in enumerate(source.splitlines(), start=1):
        m = EXPECT.search(line)
        if m:
            marks.update((lineno, rule.strip()) for rule in m.group(1).split(",") if rule.strip())
    return marks


def diagnose(source: str, **kw) -> list[Diagnostic]:
    return run_east_rules(source, "fixture.py", **kw)


# ── the corpus ──────────────────────────────────────────────────────────────


def test_every_rule_has_a_fixture_pair_and_the_corpus_has_nothing_else():
    dirs = {p.name for p in FIXTURES.iterdir() if p.is_dir()}
    assert dirs == set(RULE_IDS)
    for name in RULE_IDS:
        assert (FIXTURES / name / "ok.py").is_file() and (FIXTURES / name / "bad.py").is_file()
        assert expected_marks((FIXTURES / name / "bad.py").read_text()), f"{name}/bad.py marks no line"
        assert not expected_marks((FIXTURES / name / "ok.py").read_text())


@pytest.mark.parametrize("rule", ALL_RULES, ids=RULE_IDS)
def test_bad_reports_exactly_the_marked_lines(rule):
    source = (FIXTURES / rule.name / "bad.py").read_text()
    found = diagnose(source)
    assert {(d.line, d.rule) for d in found} == expected_marks(source), "\n".join(d.format("bad.py") for d in found)
    assert {d.rule for d in found} == {rule.name}, "a bad fixture trips only its own rule"
    for d in found:
        assert d.code == rule.code and d.category == rule.category and d.flake8_code == f"EAS{rule.code:03d}"
        assert d.end_line >= d.line and d.column >= 1


@pytest.mark.parametrize("rule", ALL_RULES, ids=RULE_IDS)
def test_ok_is_clean_under_every_rule(rule):
    found = diagnose((FIXTURES / rule.name / "ok.py").read_text())
    assert found == [], "\n".join(d.format("ok.py") for d in found)


def test_the_rules_are_numbered_once_and_stably():
    codes = [rule.code for rule in ALL_RULES]
    assert codes == list(range(1, len(ALL_RULES) + 1))
    assert set(RULES_BY_NAME) == set(RULE_IDS)
    assert all(rule.category in ("error", "warning", "suggestion") and rule.description for rule in ALL_RULES)


# ── one message, two moments ─────────────────────────────────────────────────
#
# Each case is ONE source: the rules read it, and then it is built. Where the
# builder refuses the code, the refusal's text is the diagnostic's.


def _build(source: str) -> str:
    """Builds ``source`` (a module) and returns the refusal's text."""
    with pytest.raises(ExpressionError) as raised:
        exec(compile(source, "moment.py", "exec"), {})
    return str(raised.value)


def _messages(source: str, rule: str) -> list[str]:
    return [d.message for d in diagnose(source) if d.rule == rule]


class TestOneMessageTwoMoments:
    def test_body_arity(self):
        source = ("from east import East, IntegerType\n"
                  "East.function([IntegerType], IntegerType, lambda x: x)\n")
        assert _build(source) in _messages(source, "body-takes-block-first")

    def test_no_parameters_is_the_arity_text_for_a_function(self):
        source = ("from east import East, IntegerType\n"
                  "East.function([], IntegerType, lambda: 1)\n")
        assert _build(source) in _messages(source, "body-takes-block-first")

    def test_block_attribute(self):
        source = ("from east import East, IntegerType\n"
                  "@East.function([IntegerType], IntegerType)\n"
                  "def f(b, x):\n"
                  "    return b.price\n")
        assert _build(source) == _messages(source, "body-takes-block-first")[0]

    @pytest.mark.parametrize("op", ["//", "%", "**"])
    def test_operator_fork(self, op):
        source = ("from east import East, IntegerType\n"
                  f"East.function([IntegerType], IntegerType, lambda b, x: x {op} 2)\n")
        assert _build(source) == _messages(source, "no-operator-fork")[0]

    @pytest.mark.parametrize("form", ['f"{x}"', "str(x)", '"{}".format(x)', 'format(x)', "print(x) or x"])
    def test_formatting(self, form):
        source = ("from east import East, IntegerType, StringType\n"
                  f"East.function([IntegerType], StringType, lambda b, x: {form})\n")
        assert _build(source) == _messages(source, "no-python-formatting")[0]

    def test_percent_formatting_is_refused_by_python_itself(self):
        """`"%d" % x` fails in `str.__mod__` before the proxy is asked, with
        python's text; the rule's text is the proxy's, as for the other forms."""
        source = ("from east import East, IntegerType, StringType\n"
                  'East.function([IntegerType], StringType, lambda b, x: "%d" % x)\n')
        assert "IntegerExpression" in _build(source)
        assert _messages(source, "no-python-formatting")[0].startswith("f-strings / str() cannot")

    @pytest.mark.parametrize("form", ["x > 1 and x < 5", "not x", "1 if x else 2", "1 if bool(x) else 2", "max(x, 1)"])
    def test_boolean(self, form):
        source = ("from east import East, IntegerType\n"
                  f"East.function([IntegerType], IntegerType, lambda b, x: {form})\n")
        assert _build(source) == _messages(source, "no-python-boolean")[0]

    def test_boolean_if_statement(self):
        source = ("from east import East, IntegerType\n"
                  "@East.function([IntegerType], IntegerType)\n"
                  "def f(b, x):\n"
                  "    if x > 1:\n"
                  "        return x\n"
                  "    return 0\n")
        assert _build(source) == _messages(source, "no-python-boolean")[0]

    @pytest.mark.parametrize("form", ["len(xs)", "x in xs", "sum(xs)", "max(xs)", "sorted(xs)"])
    def test_boolean_protocols(self, form):
        source = ("from east import East, ArrayType, IntegerType\n"
                  f"East.function([IntegerType, ArrayType(IntegerType)], IntegerType, lambda b, x, xs: {form})\n")
        assert _build(source) == _messages(source, "no-python-boolean")[0]

    def test_round(self):
        source = ("from east import East, FloatType\n"
                  "East.function([FloatType], FloatType, lambda b, x: round(x))\n")
        assert _build(source) == _messages(source, "no-python-round")[0]

    def test_python_work_in_an_eager_callback(self):
        source = ("import math\n"
                  "from east import EastArray, IntegerType\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  "items.map(lambda b, v: math.floor(v))\n")
        assert _build(source) == _messages(source, "no-python-work")[0]

    @pytest.mark.parametrize("form", ["max(v, 1)", "len(str(v))", "1 if isinstance(v, int) else 2"])
    def test_a_python_builtin_in_an_eager_callback_is_refused_by_name(self, form):
        source = ("from east import EastArray, IntegerType\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  f"items.map(lambda b, v: {form})\n")
        assert _build(source) == _messages(source, "no-python-work")[0]
        assert not [d for d in diagnose(source) if d.rule != "no-python-work"], "one message per line"

    @pytest.mark.parametrize("binding", ["from math import floor", "from numpy import floor"])
    def test_a_name_imported_from_the_stdlib_or_an_installed_package_is_refused_by_name(self, binding):
        source = (f"{binding}\n"
                  "from east import EastArray, IntegerType\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  "items.map(lambda b, v: floor(v))\n")
        assert _build(source) == _messages(source, "no-python-work")[0]

    def test_an_imported_constant_lifts_and_is_not_flagged(self):
        source = ("from math import pi\n"
                  "from east import East, EastArray, IntegerType\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  "scaled = items.map(lambda b, v: East.Integer.to_float(v) * pi)\n"
                  "assert list(scaled) == [pi, 2 * pi]\n")
        exec(compile(source, "moment.py", "exec"), {})
        assert diagnose(source) == []

    def test_a_name_from_a_module_of_the_users_own_is_the_builds_to_tell(self, tmp_path, monkeypatch):
        (tmp_path / "helpers_of_mine.py").write_text("import math\n\ndef floor(v):\n    return math.floor(v)\n")
        monkeypatch.syspath_prepend(str(tmp_path))
        source = ("from helpers_of_mine import floor\n"
                  "from east import EastArray, IntegerType\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  "items.map(lambda b, v: floor(v))\n")
        assert "floor" in _build(source)  # the build refuses it …
        assert diagnose(source) == []     # … the rule cannot know what a user module exports

    def test_a_python_def_doing_python_work_in_an_eager_callback(self):
        source = ("import math\n"
                  "from east import EastArray, IntegerType\n"
                  "def work(v):\n"
                  "    return math.floor(v)\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  "items.map(lambda b, v: work(v))\n")
        assert _build(source) == _messages(source, "no-python-work")[0]

    def test_a_macro_def_in_an_eager_callback_builds_and_is_not_flagged(self):
        source = ("from east import EastArray, IntegerType\n"
                  "def twice(v):\n"
                  "    return v * 2\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  "doubled = items.map(lambda b, v: twice(v))\n"
                  "assert list(doubled) == [2, 4]\n")
        exec(compile(source, "moment.py", "exec"), {})
        assert diagnose(source) == []

    def test_a_mutable_collection_in_an_eager_callback(self):
        source = ("from east import EastArray, IntegerType\n"
                  "items = EastArray(IntegerType, [1, 2])\n"
                  "lookup = EastArray(IntegerType, [10, 20])\n"
                  "items.map(lambda b, v: lookup.get(0) + v)\n")
        assert _build(source) == _messages(source, "no-python-work")[0]

    def test_statement_on_the_outer_block(self):
        source = ("from east import East, IntegerType\n"
                  "@East.function([IntegerType], IntegerType)\n"
                  "def f(b, x):\n"
                  "    y = b.let(0)\n"
                  "    b.if_(x > 1, lambda _b: b.assign(y, 1))\n"
                  "    return y\n")
        assert _build(source) == _messages(source, "no-statement-on-outer-block")[0]

    @pytest.mark.parametrize("statement", ["acc.push_last(1)", 'East.error("boom")'])
    def test_discarded_expression(self, statement):
        source = ("from east import East, ArrayType, IntegerType\n"
                  "@East.function([ArrayType(IntegerType)], ArrayType(IntegerType))\n"
                  "def f(b, xs):\n"
                  "    acc = b.let(East.new_array(IntegerType, []))\n"
                  f"    {statement}\n"
                  "    return acc\n")
        assert _build(source) == _messages(source, "no-discarded-expression")[0]

    def test_a_bare_python_expression_is_the_rules_own_call(self):
        """The build cannot see a discarded python-only expression (`1 + 1`
        builds nothing); the rule flags it with its own text."""
        source = ("from east import East, IntegerType\n"
                  "@East.function([IntegerType], IntegerType)\n"
                  "def f(b, x):\n"
                  "    1 + 1\n"
                  "    return x\n")
        exec(compile(source, "moment.py", "exec"), {})  # builds
        assert "b.do(...)" in _messages(source, "no-discarded-expression")[0]

    def test_deprecated_alias(self):
        source = ("from east import East, ArrayType, IntegerType\n"
                  "@East.function([ArrayType(IntegerType)], IntegerType)\n"
                  "def f(b, xs):\n"
                  "    return xs.fold(0, lambda b, acc, x: acc + x)\n")
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            exec(compile(source, "moment.py", "exec"), {})
        warned = [str(w.message) for w in caught if issubclass(w.category, DeprecationWarning)]
        assert warned and ".reduce(" in warned[0]
        [message] = _messages(source, "no-deprecated-alias")
        assert message == ".fold() is deprecated: the spelling is .reduce() (the TypeScript name)"


# ── the engine ───────────────────────────────────────────────────────────────

FORK = ("from east import East, IntegerType\n"
        "@East.function([IntegerType], IntegerType)\n"
        "def f(b, x):\n"
        "    return x // 2{suffix}\n")


@pytest.mark.parametrize("suffix", ["  # noqa", "  # noqa: EAS002", "  # noqa: no-operator-fork", "  # noqa: EAS, F401"])
def test_a_noqa_comment_suppresses_the_line(suffix):
    assert diagnose(FORK.format(suffix=suffix)) == []


def test_a_noqa_for_another_code_does_not(monkeypatch):
    assert [d.rule for d in diagnose(FORK.format(suffix="  # noqa: EAS003"))] == ["no-operator-fork"]


def test_a_disabled_rule_is_skipped():
    assert diagnose(FORK.format(suffix=""), disabled=["no-operator-fork"]) == []
    assert [d.rule for d in diagnose(FORK.format(suffix=""))] == ["no-operator-fork"]


def test_a_file_that_does_not_import_east_is_never_diagnosed():
    assert diagnose("import numpy as np\nxs = [1, 2]\nxs.map(lambda x: x // 2)\n") == []


def test_a_syntax_error_is_one_diagnostic():
    [d] = diagnose("from east import East\ndef f(:\n")
    assert d.rule == "syntax" and d.code == 0 and d.line == 2 and "syntax error" in d.message


def test_format_is_one_ruff_like_line():
    [d] = diagnose(FORK.format(suffix=""))
    assert d.format("pkg/mod.py") == f"pkg/mod.py:4:12: error [no-operator-fork] {d.message}"
    assert d.flake8_code == "EAS002"


def test_lint_paths_walks_a_tree_and_skips_the_excluded_directories(tmp_path):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "bad.py").write_text(FORK.format(suffix=""))
    (tmp_path / "pkg" / "clean.py").write_text("from east import East, IntegerType\n"
                                                "double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)\n")
    (tmp_path / "pkg" / "notes.txt").write_text("x // 2")
    for skipped in ("tests", "node_modules", ".venv"):
        (tmp_path / skipped).mkdir()
        (tmp_path / skipped / "bad.py").write_text(FORK.format(suffix=""))
    found = lint_paths([tmp_path])
    assert list(found) == [str(tmp_path / "pkg" / "bad.py")]
    assert [d.rule for d in found[str(tmp_path / "pkg" / "bad.py")]] == ["no-operator-fork"]
    assert {"tests", "node_modules", ".venv"} <= set(DEFAULT_EXCLUDES)
    # a file path is linted as given; an excluded name only applies to directories walked
    assert list(lint_paths([tmp_path / "tests" / "bad.py"])) == [str(tmp_path / "tests" / "bad.py")]
    assert lint_paths([tmp_path], excludes=(*DEFAULT_EXCLUDES, "pkg")) == {}
