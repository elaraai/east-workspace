#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Compliance-replay the TS test corpus through the eager/kernel surface (#474).

The same exported spec programs ``test_compliance.py`` runs through
``compile_from_json`` are replayed here by ``tests/eager_replay.py`` — the
compiler's twin, with every ``Builtin`` node dispatched through the
user-facing python surface. The corpus is self-asserting, so the whole
expression surface is exercised with zero hand-authored expectations.

Gating discipline:

* **kernel mode gates every exported file.** A file's failing-test set must
  EQUAL its pinned ``KNOWN_DIFFS`` entry — a new failure fails CI, and a
  FIXED test also fails CI until its pin is removed, so the diff list only
  ratchets down. Every pin carries its reason (message parity, the strict-
  UTF-8 boxing boundary, function-valued containers, …): these are real,
  named differences between the eager surface and compiled East, not noise.
* **trampoline and traced modes** run the core files with pass-count floors
  (full name-pinning of those modes is #474 phase 3).
* The **funnel-only builtin set** — builtins with no user-surface spelling
  yet — is pinned exactly: the register gap is visible and can only shrink.
* Path-violation counts (a kernel-mode call that trampolined) are floored;
  the per-builtin × path matrix prints in the terminal summary.
"""

from __future__ import annotations

import pytest

from tests.eager_replay import EagerEvaluator, Report, load_ir
from tests.test_compliance import TEST_IR_DIR, get_test_ir_files

SKIP_FILES: dict[str, str] = {
    "Recursive": "recursive-type value construction in the interpreter "
                 "(marker rebinding) — #474 phase 3",
}

# Core files exercised in the non-gating modes.
MODE_CORE = ("Boolean", "Integer", "Float", "Array", "Set", "Dict", "East")

# Pass-count floors for the non-gating modes (measured; may only go up).
MODE_FLOORS = {
    ("trampoline", "Boolean"): 21, ("trampoline", "Integer"): 47,
    ("trampoline", "Float"): 67, ("trampoline", "Array"): 90,
    ("trampoline", "Set"): 65, ("trampoline", "Dict"): 58,
    ("trampoline", "East"): 205,
    ("traced", "Boolean"): 21, ("traced", "Integer"): 47,
    ("traced", "Float"): 67, ("traced", "Array"): 105,
    ("traced", "Set"): 60, ("traced", "Dict"): 48,
    ("traced", "East"): 205,
}

# Builtins the corpus exercises that still route through the funnel — the
# measured register gap (#452's ratchet): shrinking it is progress, growing
# it fails here.
FUNNEL_ONLY = frozenset({
    "ArrayEncodeCsv", "ArrayGetKeys", "ArrayMerge", "ArrayMergeAll",
    "ArrayPrepend", "BlobDecodeBeast", "BlobDecodeBeast2", "BlobDecodeCsv",
    "BlobDecodeUtf8", "BlobDecodeUtf16", "BlobEncodeBeast", "BlobEncodeBeast2",
    "BlobGetUint8", "BlobSize", "DictMerge", "DictUnionInPlace",
    "MatrixCols", "MatrixFill", "MatrixFromArray", "MatrixFromRows",
    "MatrixGet", "MatrixGetCol", "MatrixGetRow", "MatrixMapRows", "MatrixOnes",
    "MatrixRows", "MatrixSet", "MatrixToArray", "MatrixToRows",
    "MatrixToVector", "MatrixTranspose", "MatrixZeros",
    "VectorConcat", "VectorFill", "VectorFold", "VectorFromArray", "VectorGet",
    "VectorLength", "VectorMap", "VectorOnes", "VectorSet", "VectorSlice",
    "VectorToArray", "VectorToMatrix", "VectorZeros",
})

KNOWN_DIFFS: dict[str, tuple[str, frozenset[str]]] = {
    'Array': (
        'message parity (reduce/index wording), pythonic negative indexing, forEach index narrowing, builtin-loop iteration guards',
        frozenset({'Array ops', 'Bulk ops', 'Compute mean for each group', 'Convert to dict with conflict resolution (group-map-reduce pattern)', 'Count elements grouped by a key function (even/odd)', 'Count occurrences of each element', 'Find index of maximum element within each group', 'Find index of minimum element within each group', 'Find the maximum element in each group', 'Find the minimum element in each group', 'For loop - iteration guard', 'ForEach - iteration guard', 'Reduce', 'Sum elements grouped by a key function', 'forEach', 'groupFindMinimum and groupFindMaximum', 'groupMean', 'groupMinimum and groupMaximum', 'groupSize', 'groupSum', 'map() with function returning Expr<RecursiveType> preserves type', 'toDict', 'toDict with conflict handler (groupMapReduce pattern)'})),
    'Blob': (
        'lone-surrogate strings cannot box through the strict-UTF-8 bridge',
        frozenset({'UTF-16 decoding/encoding'})),
    'Blob__Beast_v1_': (
        'lone-surrogate strings cannot box through the strict-UTF-8 bridge',
        frozenset({'Beast v1 - String type', 'Beast v1 - Variant type'})),
    'Blob__Beast_v2_': (
        'beast-codec value shapes crossing the py boundary',
        frozenset({'Beast v2 - Array of functions', 'Beast v2 - Function capturing array', 'Beast v2 - Function with capture', 'Beast v2 - Function with multiple captures', 'Beast v2 - Recursive linked list', 'Beast v2 - Recursive type with render callback and children', 'Beast v2 - Simple function (no captures)', 'Beast v2 - UI component with onClick returning self type'})),
    'Blob__Beast_v2_parity_': (
        'beast-codec value shapes crossing the py boundary',
        frozenset({'Beast v2 parity - a recursive type referenced from several positions'})),
    'DateTime': (
        'datetime format-token surface differences',
        frozenset({'Format a datetime as a string with a format pattern', 'Formatted parsing', 'Formatted parsing errors', 'Formatted printing', 'Parse a formatted string into a datetime'})),
    'Dict': (
        'error-message parity (pythonic KeyError text) and builtin-loop iteration guards',
        frozenset({'Dict delete', 'Dict error messages include printed key', 'Dict for loop - iteration guard', 'Dict forEach - iteration guard', 'Dict keys/copy/filter/map/reduce/etc', 'Dict update', 'Transform dict values with a mapping function'})),
    'East': (
        'value aliasing and recursive-type print parity',
        frozenset({'Nested array aliases', 'Print a variant value as a string', 'Recursive type - EastTypeType', 'Recursive type - larger tree without cycles', 'Recursive type - linked list without cycles', 'Recursive type - tree without cycles', 'print() with variant', 'str() with variant interpolation'})),
    'Function': (
        'function values inside containers crossing the py boundary',
        frozenset({'Serialize a closure that captures an array to BEAST2', 'Serialize a closure that captures another function to BEAST2', 'Serialize a closure with an integer capture to BEAST2', 'Serialize a closure with multiple captures to BEAST2', 'Serialize a struct containing a function to BEAST2', 'Serialize an array of functions to BEAST2', 'Serialize an async closure with captures to BEAST2', 'Serialize deeply nested closures (A->B->C->value) to BEAST2', 'Store functions in an array and call them by index', 'array of functions', 'array of functions serialized and called', 'async function with captures serialized and called', 'closure capturing Dict', 'closure capturing Set', 'closure capturing another function serialized and called', 'closure capturing recursive type (linked list)', 'closure with array capture serialized and called', 'closure with integer capture serialized and called', 'closure with multiple captures serialized and called', 'deeply nested closures (A captures B captures C captures value)', 'function in recursive type (linked list) serialized and called', 'function returning recursive type serialized and called', 'recursive type with function field serialized and called', 'separate closures in struct do not share captures after deserialization', 'struct containing closure and captured value preserves identity', 'struct containing function serialized and called'})),
    'Patch_Fuzz___062a1c65d952': (
        'fuzz cases with function-valued/recursive containers',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    'Patch_Fuzz___19b76faa3c47': (
        'fuzz cases with function-valued/recursive containers',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    'Patch_Fuzz___1e1c1b5a63b7': (
        'fuzz cases with function-valued/recursive containers',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    'Patch_Fuzz___8ee509b21a13': (
        'fuzz cases with function-valued/recursive containers',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    'Patch_Fuzz___98e128b1904b': (
        'fuzz cases with function-valued/recursive containers',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    'Patch_Fuzz___c07dba9d2a08': (
        'fuzz cases with function-valued/recursive containers',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    'Patch_Fuzz___c7637b618ea1': (
        'fuzz cases with function-valued/recursive containers',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    'Patch___E2E_All_Types': (
        'recursive-marker types inside containers (quote/coerce cannot rebind)',
        frozenset({'E2E: Deeply nested Expr AST with recursive types', 'E2E: JSON-like recursive type with Dict containing recursive values', 'E2E: Mutually-referential-like structure via deep nesting', 'E2E: Recursive linked list with nested structs', 'E2E: Recursive type patch-compose-invert roundtrip'})),
    'Set': (
        'error-message parity and builtin-loop iteration guards',
        frozenset({'Set error messages include printed key', 'Set for loop - iteration guard', 'Set forEach - iteration guard'})),
    'String': (
        'lone-surrogate (WTF-8) strings through the strict-UTF-8 bridge',
        frozenset({'JSON parse', 'JSON print', 'Parsing values', 'Printing values', 'Regex indexOf', 'Regex replace', 'Replace all regex matches in a string', 'String contains', 'String indexOf', 'String length', 'String replace', 'String split', 'String starts/ends with', 'String substring', 'String trim'})),
}

_TOTAL = Report()


def _stems() -> list[str]:
    return [f.stem for f in get_test_ir_files() if f.stem not in SKIP_FILES]


def pytest_generate_tests(metafunc):
    if "stem" in metafunc.fixturenames:
        metafunc.parametrize("stem", _stems())
    if "mode_case" in metafunc.fixturenames:
        cases = [(m, s) for m in ("trampoline", "traced") for s in MODE_CORE
                 if (TEST_IR_DIR / f"{s}.json").exists()]
        metafunc.parametrize("mode_case", cases, ids=[f"{m}-{s}" for m, s in cases])


@pytest.mark.skipif(not get_test_ir_files(), reason="no exported IR (run make test-export)")
def test_kernel_mode_replay(stem):
    rep = EagerEvaluator("kernel").run_program(load_ir(TEST_IR_DIR / f"{stem}.json"))
    _TOTAL.merge(rep)
    failed = {name for name, _ in rep.tests_failed}
    reason, pinned = KNOWN_DIFFS.get(stem, ("", frozenset()))
    new = failed - pinned
    fixed = pinned - failed
    assert not new, (
        f"NEW eager-surface failures in {stem}: {sorted(new)} — "
        f"first error: {dict(rep.tests_failed).get(sorted(new)[0], '')[:200]}")
    assert not fixed, (
        f"pinned diffs now PASS in {stem}: {sorted(fixed)} — remove them from "
        f"KNOWN_DIFFS (reason was: {reason})")
    # a file may be entirely pinned (some fuzz cases are wholly exotic) — but
    # an unpinned file that ran nothing is a broken replay, not a pass
    assert rep.tests_passed > 0 or (pinned and failed == pinned)


@pytest.mark.skipif(not get_test_ir_files(), reason="no exported IR (run make test-export)")
def test_other_mode_replay(mode_case):
    mode, stem = mode_case
    rep = EagerEvaluator(mode).run_program(load_ir(TEST_IR_DIR / f"{stem}.json"))
    floor = MODE_FLOORS[(mode, stem)]
    assert rep.tests_passed >= floor, (
        f"{mode} mode on {stem}: {rep.tests_passed} passed, floor is {floor}")


@pytest.mark.skipif(not get_test_ir_files(), reason="no exported IR (run make test-export)")
def test_register_gap_is_pinned():
    """Runs after the sweep above (pytest order): the funnel-only set — the
    builtins with no user-surface spelling — may only shrink."""
    if not sum(_TOTAL.routes.values()):
        pytest.skip("no replay data collected")
    seen_funnel = {b for (b, r), v in _TOTAL.routes.items() if r == "funnel" and v}
    new = seen_funnel - FUNNEL_ONLY
    gone = FUNNEL_ONLY - seen_funnel - {"BlobDecodeUtf16"}  # not in every export
    assert not new, f"builtins newly off the user surface: {sorted(new)}"
    assert not gone, (
        f"builtins now mapped (or no longer exercised): {sorted(gone)} — "
        "remove them from FUNNEL_ONLY")
    surface = sum(v for (b, r), v in _TOTAL.routes.items() if r == "surface")
    funnel = sum(v for (b, r), v in _TOTAL.routes.items() if r == "funnel")
    assert surface / (surface + funnel) >= 0.90, (surface, funnel)
    assert len(_TOTAL.path_violations) <= 20, _TOTAL.path_violations[:5]
