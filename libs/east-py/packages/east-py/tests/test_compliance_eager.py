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

Gating discipline — ALL THREE MODES gate EVERY exported file: a
(mode, file)'s failing-test set must EQUAL its ``KNOWN_DIFFS`` pin. A new
failure fails CI; a FIXED test also fails CI until its pin is removed, so
the diff list only ratchets down. Every pin carries its reason (message
parity, the strict-UTF-8 boxing boundary, function values at the py
boundary, …): real, named differences between the eager surface and
compiled East, each awaiting either a fix or an explicit policy blessing.
The funnel-only builtin set — builtins with no user-surface spelling yet —
is pinned exactly and may only shrink (#452's ratchet), and path
accounting bounds kernel-mode trampolining.

The tracer-fidelity differential is the mode matrix itself: kernel mode
compiles the ORIGINAL callback IR, traced mode compiles the tracer's
proxy-replay RECONSTRUCTION, and both must satisfy the same corpus
assertions (with ``east_compile_checked`` acceptance a hard failure, never
a skip) — any reconstruction divergence surfaces as a traced-mode pin.
"""

from __future__ import annotations

import pytest

from tests.eager_replay import EagerEvaluator, Report, load_ir
from tests.test_compliance import TEST_IR_DIR, get_test_ir_files

MODES = ("kernel", "trampoline", "traced")

# Builtins the corpus exercises that still route through the funnel — the
# measured register gap (#452's ratchet): shrinking it is progress, growing
# it fails here. The Vector/Matrix tensor surface is mid-redesign; the rest
# have no user spelling yet (a finding, kept visible).
FUNNEL_ONLY = frozenset({
    "ArrayEncodeCsv", "ArrayGetKeys", "ArrayMerge", "ArrayMergeAll",
    "ArrayPrepend", "BlobDecodeBeast", "BlobDecodeBeast2", "BlobDecodeCsv",
    "BlobDecodeUtf8", "BlobDecodeUtf16", "BlobEncodeBeast", "BlobEncodeBeast2",
    "BlobGetUint8", "BlobSize", "DateTimeParseFormat", "DateTimePrintFormat",
    # DictMerge / DictUnionInPlace left this set in #527: east-py gained
    # `merge_key` and `union_in_place`, so both now route through the surface.
    "MatrixCols", "MatrixFill", "MatrixFromArray", "MatrixFromRows",
    "MatrixGet", "MatrixGetCol", "MatrixGetRow", "MatrixMapRows", "MatrixOnes",
    "MatrixRows", "MatrixSet", "MatrixToArray", "MatrixToRows",
    "MatrixToVector", "MatrixTranspose", "MatrixZeros",
    "VectorConcat", "VectorFill", "VectorFold", "VectorFromArray", "VectorGet",
    "VectorLength", "VectorMap", "VectorOnes", "VectorSet", "VectorSlice",
    "VectorToArray", "VectorToMatrix", "VectorZeros",
})

KNOWN_DIFFS: dict[tuple[str, str], tuple[str, frozenset[str]]] = {
    ('kernel', 'Array'): (
        'serialized Recursive-type dialect divergence (#475)',
        frozenset({'map() with function returning Expr<RecursiveType> preserves type'})),
    ('trampoline', 'Array'): (
        'serialized Recursive-type dialect divergence (#475)',
        frozenset({'map() with function returning Expr<RecursiveType> preserves type'})),
    ('traced', 'Array'): (
        'serialized Recursive-type dialect divergence (#475)',
        frozenset({'map() with function returning Expr<RecursiveType> preserves type'})),
    ('kernel', 'Blob__Beast_v1_'): (
        'variant tag construction at the py boundary — #476/#478 family',
        frozenset({'Beast v1 - Variant type'})),
    ('trampoline', 'Blob__Beast_v1_'): (
        'variant tag construction at the py boundary — #476/#478 family',
        frozenset({'Beast v1 - Variant type'})),
    ('traced', 'Blob__Beast_v1_'): (
        'variant tag construction at the py boundary — #476/#478 family',
        frozenset({'Beast v1 - Variant type'})),
    ('kernel', 'Blob__Beast_v2_'): (
        'beast-codec function/recursive value shapes at the py boundary — #476',
        frozenset({'Beast v2 - Array of functions', 'Beast v2 - Function capturing array', 'Beast v2 - Function with capture', 'Beast v2 - Function with multiple captures', 'Beast v2 - Recursive type with render callback and children', 'Beast v2 - Simple function (no captures)', 'Beast v2 - UI component with onClick returning self type'})),
    ('trampoline', 'Blob__Beast_v2_'): (
        'beast-codec function/recursive value shapes at the py boundary — #476',
        frozenset({'Beast v2 - Array of functions', 'Beast v2 - Function capturing array', 'Beast v2 - Function with capture', 'Beast v2 - Function with multiple captures', 'Beast v2 - Recursive type with render callback and children', 'Beast v2 - Simple function (no captures)', 'Beast v2 - UI component with onClick returning self type'})),
    ('traced', 'Blob__Beast_v2_'): (
        'beast-codec function/recursive value shapes at the py boundary — #476',
        frozenset({'Beast v2 - Array of functions', 'Beast v2 - Function capturing array', 'Beast v2 - Function with capture', 'Beast v2 - Function with multiple captures', 'Beast v2 - Recursive type with render callback and children', 'Beast v2 - Simple function (no captures)', 'Beast v2 - UI component with onClick returning self type'})),
    ('kernel', 'Blob__Beast_v2_parity_'): (
        'beast-codec function/recursive value shapes at the py boundary — #476',
        frozenset({'Beast v2 parity - a recursive type referenced from several positions'})),
    ('trampoline', 'Blob__Beast_v2_parity_'): (
        'beast-codec function/recursive value shapes at the py boundary — #476',
        frozenset({'Beast v2 parity - a recursive type referenced from several positions'})),
    ('traced', 'Blob__Beast_v2_parity_'): (
        'beast-codec function/recursive value shapes at the py boundary — #476',
        frozenset({'Beast v2 parity - a recursive type referenced from several positions'})),
    ('kernel', 'East'): (
        'value aliasing and recursive-type print parity — #478',
        frozenset({'Nested array aliases', 'Print a variant value as a string', 'Recursive type - EastTypeType', 'Recursive type - larger tree without cycles', 'Recursive type - tree without cycles', 'print() with variant', 'str() with variant interpolation'})),
    ('trampoline', 'East'): (
        'value aliasing and recursive-type print parity — #478',
        frozenset({'Nested array aliases', 'Print a variant value as a string', 'Recursive type - EastTypeType', 'Recursive type - larger tree without cycles', 'Recursive type - tree without cycles', 'print() with variant', 'str() with variant interpolation'})),
    ('traced', 'East'): (
        'value aliasing and recursive-type print parity — #478',
        frozenset({'Nested array aliases', 'Print a variant value as a string', 'Recursive type - EastTypeType', 'Recursive type - larger tree without cycles', 'Recursive type - tree without cycles', 'print() with variant', 'str() with variant interpolation'})),
    ('kernel', 'Frozen'): (
        'frozen task-input decode is a C-runtime brand with no eager-python-surface spelling (#539)',
        frozenset({'Is keeps identity semantics for mutable and mixed operands', 'Is on two frozen collections is deep value equality', 'Is recurses into nested frozen containers by value', 'a frozen Ref stays an identity cell under Is', 'copying a frozen array yields a mutable scratch value', 'equality, ordering, printing and encoding match the mutable twin', 'frozen Vector and Matrix are value types under Is', 'frozen array mutations throw; the mutable twin accepts them', 'frozen collections keep serving reads and iteration', 'frozen dict mutations throw, including through a read-out element', 'frozen ref assignment throws', 'frozen set mutations throw; reads still serve'})),
    ('trampoline', 'Frozen'): (
        'frozen task-input decode is a C-runtime brand with no eager-python-surface spelling (#539)',
        frozenset({'Is keeps identity semantics for mutable and mixed operands', 'Is on two frozen collections is deep value equality', 'Is recurses into nested frozen containers by value', 'a frozen Ref stays an identity cell under Is', 'copying a frozen array yields a mutable scratch value', 'equality, ordering, printing and encoding match the mutable twin', 'frozen Vector and Matrix are value types under Is', 'frozen array mutations throw; the mutable twin accepts them', 'frozen collections keep serving reads and iteration', 'frozen dict mutations throw, including through a read-out element', 'frozen ref assignment throws', 'frozen set mutations throw; reads still serve'})),
    ('traced', 'Frozen'): (
        'frozen task-input decode is a C-runtime brand with no eager-python-surface spelling (#539)',
        frozenset({'Is keeps identity semantics for mutable and mixed operands', 'Is on two frozen collections is deep value equality', 'Is recurses into nested frozen containers by value', 'a frozen Ref stays an identity cell under Is', 'copying a frozen array yields a mutable scratch value', 'equality, ordering, printing and encoding match the mutable twin', 'frozen Vector and Matrix are value types under Is', 'frozen array mutations throw; the mutable twin accepts them', 'frozen collections keep serving reads and iteration', 'frozen dict mutations throw, including through a read-out element', 'frozen ref assignment throws', 'frozen set mutations throw; reads still serve'})),
    ('kernel', 'Function'): (
        'function values crossing the py boundary (identity, serialization) — #476',
        frozenset({'Serialize a closure that captures an array to BEAST2', 'Serialize a closure that captures another function to BEAST2', 'Serialize a closure with an integer capture to BEAST2', 'Serialize a closure with multiple captures to BEAST2', 'Serialize a struct containing a function to BEAST2', 'Serialize an async closure with captures to BEAST2', 'Serialize deeply nested closures (A->B->C->value) to BEAST2', 'Store functions in an array and call them by index', 'array of functions', 'async function with captures serialized and called', 'closure capturing Dict', 'closure capturing Set', 'closure capturing another function serialized and called', 'closure capturing recursive type (linked list)', 'closure with array capture serialized and called', 'closure with integer capture serialized and called', 'closure with multiple captures serialized and called', 'deeply nested closures (A captures B captures C captures value)', 'recursive type with function field serialized and called', 'separate closures in struct do not share captures after deserialization', 'struct containing closure and captured value preserves identity', 'struct containing function serialized and called'})),
    ('trampoline', 'Function'): (
        'function values crossing the py boundary (identity, serialization) — #476',
        frozenset({'Serialize a closure that captures an array to BEAST2', 'Serialize a closure that captures another function to BEAST2', 'Serialize a closure with an integer capture to BEAST2', 'Serialize a closure with multiple captures to BEAST2', 'Serialize a function with a loop to BEAST2', 'Serialize a function with control flow (if/return) to BEAST2', 'Serialize a struct containing a function to BEAST2', 'Serialize an async closure with captures to BEAST2', 'Serialize deeply nested closures (A->B->C->value) to BEAST2', 'Store functions in an array and call them by index', 'array of functions', 'async function with captures serialized and called', 'closure capturing Dict', 'closure capturing Set', 'closure capturing another function serialized and called', 'closure capturing recursive type (linked list)', 'closure with array capture serialized and called', 'closure with integer capture serialized and called', 'closure with multiple captures serialized and called', 'deeply nested closures (A captures B captures C captures value)', 'free function with control flow serialized and called', 'free function with loop serialized and called', 'function in recursive type (linked list) serialized and called', 'function returning recursive type serialized and called', 'outer closure with shared mutable capture preserves sharing (with serialization)', 'recursive type with function field serialized and called', 'separate closures in struct do not share captures after deserialization', 'struct containing closure and captured value preserves identity', 'struct containing function serialized and called'})),
    ('traced', 'Function'): (
        'function values crossing the py boundary (identity, serialization) — #476',
        frozenset({'Serialize a closure that captures an array to BEAST2', 'Serialize a closure that captures another function to BEAST2', 'Serialize a closure with an integer capture to BEAST2', 'Serialize a closure with multiple captures to BEAST2', 'Serialize a struct containing a function to BEAST2', 'Serialize an async closure with captures to BEAST2', 'Serialize deeply nested closures (A->B->C->value) to BEAST2', 'Store functions in an array and call them by index', 'array of functions', 'async function with captures serialized and called', 'closure capturing Dict', 'closure capturing Set', 'closure capturing another function serialized and called', 'closure capturing recursive type (linked list)', 'closure with array capture serialized and called', 'closure with integer capture serialized and called', 'closure with multiple captures serialized and called', 'deeply nested closures (A captures B captures C captures value)', 'recursive type with function field serialized and called', 'separate closures in struct do not share captures after deserialization', 'struct containing closure and captured value preserves identity', 'struct containing function serialized and called'})),
    ('kernel', 'Patch_Fuzz___062a1c65d952'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'invert round trip'})),
    ('trampoline', 'Patch_Fuzz___062a1c65d952'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'invert round trip'})),
    ('traced', 'Patch_Fuzz___062a1c65d952'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'invert round trip'})),
    ('kernel', 'Patch_Fuzz___19b76faa3c47'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('trampoline', 'Patch_Fuzz___19b76faa3c47'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('traced', 'Patch_Fuzz___19b76faa3c47'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('kernel', 'Patch_Fuzz___1e1c1b5a63b7'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('trampoline', 'Patch_Fuzz___1e1c1b5a63b7'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('traced', 'Patch_Fuzz___1e1c1b5a63b7'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('kernel', 'Patch_Fuzz___8ee509b21a13'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('trampoline', 'Patch_Fuzz___8ee509b21a13'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('traced', 'Patch_Fuzz___8ee509b21a13'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('kernel', 'Patch_Fuzz___98e128b1904b'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('trampoline', 'Patch_Fuzz___98e128b1904b'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('traced', 'Patch_Fuzz___98e128b1904b'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('kernel', 'Patch_Fuzz___c07dba9d2a08'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('trampoline', 'Patch_Fuzz___c07dba9d2a08'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('traced', 'Patch_Fuzz___c07dba9d2a08'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'diff/apply round trip', 'invert round trip'})),
    ('kernel', 'Patch_Fuzz___c7637b618ea1'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'invert round trip'})),
    ('trampoline', 'Patch_Fuzz___c7637b618ea1'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'invert round trip'})),
    ('traced', 'Patch_Fuzz___c7637b618ea1'): (
        'fuzz cases with function-valued/recursive containers — #476/#478',
        frozenset({'compose round trip', 'invert round trip'})),
    ('kernel', 'Patch___E2E_All_Types'): (
        'recursive/function containers beyond quote and coercion — #476/#478',
        frozenset({'E2E: Deeply nested Expr AST with recursive types', 'E2E: JSON-like recursive type with Dict containing recursive values', 'E2E: Mutually-referential-like structure via deep nesting', 'E2E: Recursive type patch-compose-invert roundtrip'})),
    ('trampoline', 'Patch___E2E_All_Types'): (
        'recursive/function containers beyond quote and coercion — #476/#478',
        frozenset({'E2E: Deeply nested Expr AST with recursive types', 'E2E: JSON-like recursive type with Dict containing recursive values', 'E2E: Mutually-referential-like structure via deep nesting', 'E2E: Recursive type patch-compose-invert roundtrip'})),
    ('traced', 'Patch___E2E_All_Types'): (
        'recursive/function containers beyond quote and coercion — #476/#478',
        frozenset({'E2E: Deeply nested Expr AST with recursive types', 'E2E: JSON-like recursive type with Dict containing recursive values', 'E2E: Mutually-referential-like structure via deep nesting', 'E2E: Recursive type patch-compose-invert roundtrip'})),
    ('kernel', 'String'): (
        'recursive-type print/parse and JSON shapes — #478 family',
        frozenset({'JSON parse', 'JSON print', 'Parsing values', 'Printing values'})),
    ('trampoline', 'String'): (
        'recursive-type print/parse and JSON shapes — #478 family',
        frozenset({'JSON parse', 'JSON print', 'Parsing values', 'Printing values'})),
    ('traced', 'String'): (
        'recursive-type print/parse and JSON shapes — #478 family',
        frozenset({'JSON parse', 'JSON print', 'Parsing values', 'Printing values'})),
    ('kernel', 'Recursive'): (
        'recursive value print/parse and comparison parity — #478',
        frozenset({'Create a struct-based recursive type (like an XML node)', 'Print then parse a value that recurses through a Dict value; the round-trip is equal', 'Print then parse a value that recurses through an Array element; the round-trip is equal', 'Struct-based recursive type', 'Struct-based recursive type with $.let'})),
    ('trampoline', 'Recursive'): (
        'recursive value print/parse and comparison parity — #478',
        frozenset({'Create a struct-based recursive type (like an XML node)', 'Print then parse a value that recurses through a Dict value; the round-trip is equal', 'Print then parse a value that recurses through an Array element; the round-trip is equal', 'Struct-based recursive type', 'Struct-based recursive type with $.let'})),
    ('traced', 'Recursive'): (
        'recursive value print/parse and comparison parity — #478',
        frozenset({'Create a struct-based recursive type (like an XML node)', 'Print then parse a value that recurses through a Dict value; the round-trip is equal', 'Print then parse a value that recurses through an Array element; the round-trip is equal', 'Struct-based recursive type', 'Struct-based recursive type with $.let'})),
}

_TOTAL = Report()


def pytest_generate_tests(metafunc):
    if "mode_stem" in metafunc.fixturenames:
        cases = [(m, f.stem) for m in MODES for f in get_test_ir_files()]
        metafunc.parametrize("mode_stem", cases, ids=[f"{m}-{s}" for m, s in cases])


@pytest.mark.skipif(not get_test_ir_files(), reason="no exported IR (run make test-export)")
def test_replay(mode_stem):
    mode, stem = mode_stem
    rep = EagerEvaluator(mode).run_program(load_ir(TEST_IR_DIR / f"{stem}.json"))
    if mode == "kernel":
        _TOTAL.merge(rep)
    failed = {name for name, _ in rep.tests_failed}
    reason, pinned = KNOWN_DIFFS.get((mode, stem), ("", frozenset()))
    new = failed - pinned
    fixed = pinned - failed
    assert not new, (
        f"NEW eager-surface failures [{mode}] in {stem}: {sorted(new)} — "
        f"first error: {dict(rep.tests_failed).get(sorted(new)[0], '')[:200]}")
    assert not fixed, (
        f"pinned diffs now PASS [{mode}] in {stem}: {sorted(fixed)} — remove "
        f"them from KNOWN_DIFFS (reason was: {reason})")
    # a (mode, file) may be entirely pinned (some fuzz cases are wholly
    # exotic) — but an unpinned file that ran nothing is a broken replay
    assert rep.tests_passed > 0 or (pinned and failed == pinned)


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
    # The native-path guarantee: in kernel mode, across the WHOLE corpus, no
    # builtin call with native-capable callbacks ever fell back to the
    # per-element trampoline (measured from the compiler's real counters —
    # eager_stats() deltas around every call). Exact zero, not a ceiling: a
    # single silent fallback fails the build.
    assert not _TOTAL.path_violations, _TOTAL.path_violations[:5]
