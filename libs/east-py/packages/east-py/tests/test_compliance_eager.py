#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compliance-replay the TS test corpus through the eager/kernel surface (#474).

The same exported spec programs ``test_compliance.py`` runs through
``compile_from_json`` are replayed by ``tests/eager_replay.py`` — the
compiler's twin, with every ``Builtin`` node dispatched through the
user-facing python surface. The corpus is self-asserting, so the whole
expression surface is exercised with zero hand-authored expectations.

Gating discipline — every exported file gates: a file's failing-test set
must EQUAL its ``KNOWN_DIFFS`` pin. A new failure fails CI; a FIXED test
also fails CI until its pin is removed, so the diff list only ratchets
down. Every pin carries its reason: real, named differences between the
eager surface and compiled East, each awaiting either a fix or an explicit
policy blessing. The funnel-only builtin set — builtins with no
user-surface spelling yet — is pinned exactly and may only shrink (#452's
ratchet). Under the strict surface (#625) there is exactly one execution
path, so the old kernel/trampoline/traced mode matrix collapsed to this one
replay.
"""

from __future__ import annotations

import pytest

from tests.eager_replay import EagerEvaluator, Report, load_ir
from tests.test_compliance import TEST_IR_DIR, get_test_ir_files

# Builtins the corpus exercises that still route through the funnel — the
# measured register gap (#452's ratchet): shrinking it is progress, growing
# it fails here. ArrayGetKeys carries a hand-built getter callback the surface
# derives from the receiver; the formatted-datetime pair takes a pre-tokenized
# token array the namespace sugar builds from a format STRING.
FUNNEL_ONLY = frozenset({"ArrayGetKeys", "DateTimeParseFormat", "DateTimePrintFormat"})

KNOWN_DIFFS: dict[str, tuple[str, frozenset[str]]] = {}

# Arms whose OUTCOME is platform-divergent, excluded from BOTH ratchet
# directions. Emptied by the id-based recursive-type rework (#475/#18): the
# formerly-flapping Patch_Fuzz diff/apply arms became well-defined (and
# passing) once PatchType resolved back-references through wrapper scope ids
# instead of depth markers. Repopulate only with evidence of a genuine
# platform flip, naming the arms and the platforms.
UNSTABLE: dict[str, frozenset[str]] = {}

_TOTAL = Report()


def pytest_generate_tests(metafunc):
    if "stem" in metafunc.fixturenames:
        stems = [f.stem for f in get_test_ir_files()]
        metafunc.parametrize("stem", stems, ids=stems)


@pytest.mark.skipif(not get_test_ir_files(), reason="no exported IR (run make test-export)")
def test_replay(stem):
    rep = EagerEvaluator().run_program(load_ir(TEST_IR_DIR / f"{stem}.json"))
    _TOTAL.merge(rep)
    failed = {name for name, _ in rep.tests_failed}
    reason, pinned = KNOWN_DIFFS.get(stem, ("", frozenset()))
    unstable = UNSTABLE.get(stem, frozenset())
    new = failed - pinned - unstable
    fixed = pinned - failed - unstable
    assert not new, (
        f"NEW eager-surface failures in {stem}: {sorted(new)} — "
        f"first error: {dict(rep.tests_failed).get(sorted(new)[0], '')[:200]}")
    assert not fixed, (
        f"pinned diffs now PASS in {stem}: {sorted(fixed)} — remove "
        f"them from KNOWN_DIFFS (reason was: {reason})")
    # a (mode, file) may be entirely pinned (some fuzz cases are wholly
    # exotic) — but an unpinned file that ran nothing is a broken replay.
    # Unstable arms drop out of BOTH sides: on the platform where one fails
    # a wholly-pinned stem can run zero tests, and on the other the same arm
    # is absent from `failed` while still sitting in its pin.
    assert rep.tests_passed > 0 or (
        (pinned or unstable) and failed - unstable == pinned - unstable)


@pytest.mark.skipif(not get_test_ir_files(), reason="no exported IR (run make test-export)")
def test_register_gap_is_pinned():
    """Runs after the sweep above (pytest order): the funnel-only set — the
    builtins with no user-surface spelling — may only shrink."""
    if not sum(_TOTAL.routes.values()):
        pytest.skip("no replay data collected")
    seen_funnel = {b for (b, r), v in _TOTAL.routes.items() if r == "funnel" and v}
    new = seen_funnel - FUNNEL_ONLY
    gone = FUNNEL_ONLY - seen_funnel
    assert not new, f"builtins newly off the user surface: {sorted(new)}"
    assert not gone, (
        f"builtins now mapped (or no longer exercised): {sorted(gone)} — "
        "remove them from FUNNEL_ONLY")
    surface = sum(v for (b, r), v in _TOTAL.routes.items() if r == "surface")
    funnel = sum(v for (b, r), v in _TOTAL.routes.items() if r == "funnel")
    assert surface / (surface + funnel) >= 0.90, (surface, funnel)
