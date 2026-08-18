#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Rounding on the traced Float surface (#604).

Float → Integer was unexpressible in a kernel: ``to_integer()`` is exact-only
(an EastError at RUNTIME, on the first non-integral value) and no rounding
method existed. ``round``/``floor``/``ceil``/``trunc`` now trace as composites
over Remainder/Subtract/IfElse/FloatToInteger — no new cross-runtime builtins,
so east-c executes them natively today.

The rounding mode is pinned here because a silently different tie rule
between runtimes shows up as a one-unit discrepancy long after the fact:
``round`` is half AWAY FROM ZERO (2.5 → 3, -2.5 → -3), deliberately not
python's ties-to-even — ``round(expr)`` raises and points at ``.round()``.

Every case runs inside ``kernel(...)``, which raises rather than falling
back, so a pass proves the traced path.
"""

import math

import pytest

from east import FloatType, IntegerType, kernel
from east.kernel import KernelTraceError

F = [FloatType]


@pytest.mark.parametrize(("x", "expected"), [
    (3.7, 4), (3.2, 3), (3.5, 4), (2.5, 3), (0.5, 1), (0.4, 0), (0.0, 0),
    (-0.4, 0), (-0.5, -1), (-2.5, -3), (-3.5, -4), (-3.2, -3), (-3.7, -4),
    (3.0, 3), (-3.0, -3),
    (0.49999999999999994, 0),      # +0.5 then truncate must not reach 1
    (4503599627370497.0, 4503599627370497),   # 2^52+1: integral stays fixed
])
def test_round_is_half_away_from_zero(x, expected):
    assert kernel(F, lambda v: v.round())(x) == expected


@pytest.mark.parametrize(("x", "expected"), [
    (3.7, 3), (3.0, 3), (0.0, 0), (-0.4, -1), (-3.0, -3), (-3.2, -4),
])
def test_floor(x, expected):
    assert kernel(F, lambda v: v.floor())(x) == expected


@pytest.mark.parametrize(("x", "expected"), [
    (3.2, 4), (3.0, 3), (0.0, 0), (0.4, 1), (-3.0, -3), (-3.7, -3),
])
def test_ceil(x, expected):
    assert kernel(F, lambda v: v.ceil())(x) == expected


@pytest.mark.parametrize(("x", "expected"), [
    (3.7, 3), (3.0, 3), (0.0, 0), (0.9, 0), (-0.9, 0), (-3.7, -3),
])
def test_trunc(x, expected):
    assert kernel(F, lambda v: v.trunc())(x) == expected


def test_the_math_module_spellings_trace():
    # math.floor/ceil/trunc dispatch through __floor__/__ceil__/__trunc__ and
    # have identical semantics eagerly and traced — the one spelling works on
    # both paths. round() does NOT get this treatment (different tie rule).
    assert kernel(F, lambda v: math.floor(v))(-3.2) == -4
    assert kernel(F, lambda v: math.ceil(v))(3.2) == 4
    assert kernel(F, lambda v: math.trunc(v))(-3.7) == -3


def test_python_round_names_the_tie_rule_difference():
    with pytest.raises(KernelTraceError, match="half away from zero"):
        kernel(F, lambda v: round(v))


def test_to_integer_stays_exact_only():
    assert kernel(F, lambda v: v.to_integer())(3.0) == 3
    from east import EastError
    with pytest.raises(EastError, match="non-integer float"):
        kernel(F, lambda v: v.to_integer())(3.7)


def test_rounding_needs_a_float():
    with pytest.raises(KernelTraceError, match="needs a Float"):
        kernel([IntegerType], lambda v: v.round())
    with pytest.raises(KernelTraceError, match="needs a Float"):
        kernel([IntegerType], lambda v: v.floor())


def test_an_unknown_scalar_method_names_the_real_cause():
    with pytest.raises(KernelTraceError,
                       match=r"`.round_nearest` is not on the traced kernel "
                             r"surface for a Float-typed expression"):
        kernel(F, lambda v: v.round_nearest())
