#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Simulated Annealing platform functions for East.

Provides discrete optimization using the simanneal library.
Ideal for combinatorial problems like TSP, scheduling, and subset selection.
"""

import random
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import numpy as np
from east import variant
from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    OptionType,
    StructType,
    VariantType,
    VectorType,
)
from east.types.values import EastStruct, EastVariant, EastVector

from east_py_datascience._common import extra_guard

# ============================================================================
# Type Definitions
# ============================================================================

# Discrete state type (int_array or bool_array)
DiscreteStateType = VariantType(
    [
        ("int_array", VectorType(IntegerType)),
        ("bool_array", VectorType(BooleanType)),
    ]
)
"""A discrete solution state for simulated annealing.

Cases: ``int_array`` (``Vector<Integer>`` — permutation or integer labels),
``bool_array`` (``Vector<Boolean>`` — binary inclusion mask).
"""

# Energy function type: state -> score
EnergyFunctionType = FunctionType([DiscreteStateType], FloatType)
"""Energy (cost) function signature for general discrete annealing.

Receives ``DiscreteStateType`` and returns ``Float``; lower energy is better.
"""

# Move function type: state -> neighbor
MoveFunctionType = FunctionType([DiscreteStateType], DiscreteStateType)
"""Neighbor-generation function signature for general discrete annealing.

Receives ``DiscreteStateType`` and returns a new ``DiscreteStateType``
neighbor; must preserve the variant tag (``int_array`` or ``bool_array``).
"""

# Permutation energy function type
PermutationEnergyType = FunctionType([VectorType(IntegerType)], FloatType)
"""Energy function signature for permutation problems.

Receives ``Vector<Integer>`` (the current permutation) and returns ``Float``.
"""

# Subset energy function type
SubsetEnergyType = FunctionType([VectorType(BooleanType)], FloatType)
"""Energy function signature for subset-selection problems.

Receives ``Vector<Boolean>`` (inclusion mask) and returns ``Float``.
"""

# Annealing configuration
AnnealConfigType = StructType(
    [
        ("t_max", OptionType(FloatType)),
        ("t_min", OptionType(FloatType)),
        ("steps", OptionType(IntegerType)),
        ("updates", OptionType(IntegerType)),
        ("auto_schedule", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
    ]
)
"""Temperature schedule and runtime configuration for simulated annealing.

Fields: ``t_max`` (starting temperature, default auto-detected),
``t_min`` (stopping temperature, default auto-detected),
``steps`` (total annealing steps, default auto-detected),
``updates`` (progress log frequency; 0 = silent, default 0),
``auto_schedule`` (run auto-calibration for this many minutes and use the
resulting schedule — overrides ``t_max``/``t_min``/``steps``),
``random_state`` (seed for Python's ``random`` module).
"""

# Annealing result
AnnealResultType = StructType(
    [
        ("best_state", DiscreteStateType),
        ("best_energy", FloatType),
        ("steps_taken", IntegerType),
        ("success", BooleanType),
    ]
)
"""Outcome of a simulated annealing run.

Fields: ``best_state`` (``DiscreteStateType`` best solution found),
``best_energy`` (``Float`` energy at that state), ``steps_taken``
(``Integer`` total steps completed), ``success`` (``Boolean`` true when the
annealer produced a valid result).
"""


_check_simanneal_support = extra_guard("simanneal", "simanneal", "simanneal")


# ============================================================================
# Helpers
# ============================================================================


@contextmanager
def _seeded(random_state: int | None) -> Iterator[None]:
    """Seed Python's ``random`` for the run, restoring the caller's generator state afterwards.

    ``simanneal`` draws from the module-level generator, so the seed has to be
    global for a run to be reproducible; restoring the state keeps that from
    leaking into unrelated code in the same process.
    """
    if random_state is None:
        yield
        return
    saved = random.getstate()
    random.seed(random_state)
    try:
        yield
    finally:
        random.setstate(saved)


def _configure_schedule(annealer: Any, config: EastStruct) -> None:
    """Apply the ``AnnealConfigType`` schedule fields to an annealer.

    ``auto_schedule`` runs simanneal's calibration and overrides the explicit
    ``t_max`` / ``t_min`` / ``steps``.
    """
    t_max = config["t_max"].unwrap_or(None)
    if t_max is not None:
        annealer.Tmax = float(t_max)
    t_min = config["t_min"].unwrap_or(None)
    if t_min is not None:
        annealer.Tmin = float(t_min)
    steps = config["steps"].unwrap_or(None)
    if steps is not None:
        annealer.steps = int(steps)
    annealer.updates = int(config["updates"].unwrap_or(0))  # 0 = silent
    auto_minutes = config["auto_schedule"].unwrap_or(None)
    if auto_minutes is not None:
        annealer.set_schedule(annealer.auto(minutes=float(auto_minutes)))


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="simanneal_optimize",
    inputs=[
        DiscreteStateType,
        EnergyFunctionType,
        MoveFunctionType,
        AnnealConfigType,
    ],
    output=AnnealResultType,
)
def simanneal_optimize_impl(
    initial_state: EastVariant,
    energy_fn: Callable[[EastVariant], float],
    move_fn: Callable[[EastVariant], EastVariant],
    config: EastStruct,
) -> EastStruct:
    """Run simulated annealing on a discrete state with custom energy and move functions.

    Wraps the ``simanneal`` library's ``Annealer`` to optimize an arbitrary
    ``DiscreteStateType`` value. The caller supplies domain-specific energy and
    move callables; the annealer manages the temperature schedule and acceptance
    criterion.

    Args:
        initial_state: ``DiscreteStateType`` (``EastVariant``) - starting
            state, either:

            - ``int_array`` wrapping ``Vector<Integer>``, or
            - ``bool_array`` wrapping ``Vector<Boolean>``.

        energy_fn: ``Function<[DiscreteStateType], Float>`` (callable) -
            called at each step to score the current state; lower is better
            (the annealer minimizes energy).
        move_fn: ``Function<[DiscreteStateType], DiscreteStateType>``
            (callable) - called at each step to propose a neighbor; must
            return a new ``DiscreteStateType`` with the same variant tag as
            ``initial_state``.
        config: ``AnnealConfigType`` (``EastStruct``) with fields:

            - ``t_max`` (``Option<Float>``): starting temperature (default
              auto-detected by ``simanneal``).
            - ``t_min`` (``Option<Float>``): stopping temperature (default
              auto-detected).
            - ``steps`` (``Option<Integer>``): total annealing steps (default
              auto-detected).
            - ``updates`` (``Option<Integer>``): progress update frequency;
              0 = silent (default 0).
            - ``auto_schedule`` (``Option<Float>``): when present, run
              auto-calibration for this many minutes and use the resulting
              schedule (overrides ``t_max``/``t_min``/``steps``).
            - ``random_state`` (``Option<Integer>``): seed for Python's
              ``random`` module before the run.

    Returns:
        ``AnnealResultType`` (``EastStruct``): ``best_state``
        (``DiscreteStateType``), ``best_energy`` (``Float``),
        ``steps_taken`` (``Integer``), ``success`` (``Boolean`` true when
        the annealer found a valid solution).

    Raises:
        NotImplementedError: the ``simanneal`` extra is not installed.
    """
    _check_simanneal_support()
    from simanneal import Annealer

    class EastAnnealer(Annealer):
        """Annealer that wraps East energy and move functions."""

        copy_strategy = "method"

        def __init__(self, state, energy_fn, move_fn):
            self.energy_fn = energy_fn
            self.move_fn = move_fn
            super().__init__(state)

        def copy_state(self, state):
            """Custom copy for EastVariant - states are immutable."""
            # EastVariant is immutable, so we can just return it
            return state

        def move(self):
            """Generate neighbor state using East move function."""
            self.state = self.move_fn(self.state)

        def energy(self):
            """Calculate energy using East energy function."""
            return self.energy_fn(self.state)

    annealer = EastAnnealer(initial_state, energy_fn, move_fn)
    with _seeded(config["random_state"].unwrap_or(None)):
        _configure_schedule(annealer, config)
        best_state, best_energy = annealer.anneal()

    return EastStruct(
        {
            "best_state": best_state,
            "best_energy": float(best_energy if best_energy is not None else 0.0),
            "steps_taken": int(annealer.steps),
            "success": best_energy is not None,
        }
    )


@platform_function(
    name="simanneal_optimize_permutation",
    inputs=[
        VectorType(IntegerType),
        PermutationEnergyType,
        AnnealConfigType,
    ],
    output=AnnealResultType,
)
def simanneal_optimize_permutation_impl(
    initial_perm: EastVector,
    energy_fn: Callable[[EastVector], float],
    config: EastStruct,
) -> EastStruct:
    """Run simulated annealing on a permutation using random two-element swaps.

    Specialization of :func:`simanneal_optimize_impl` for permutation problems
    (e.g. TSP, job scheduling). The state is maintained as a NumPy array
    internally; ``energy_fn`` receives a ``Vector<Integer>`` view at each
    evaluation. The move operator swaps two randomly selected indices.

    Args:
        initial_perm: ``Vector<Integer>`` (``EastVector``) - initial
            permutation; elements are arbitrary integer labels.
        energy_fn: ``Function<[Vector<Integer>], Float>`` (callable) - scores
            the current permutation; lower energy is preferred.
        config: ``AnnealConfigType`` (``EastStruct``) - see
            :func:`simanneal_optimize_impl` for all fields (``t_max``,
            ``t_min``, ``steps``, ``updates``, ``auto_schedule``,
            ``random_state``).

    Returns:
        ``AnnealResultType`` (``EastStruct``): ``best_state`` tagged
        ``int_array`` (``Vector<Integer>``), ``best_energy`` (``Float``),
        ``steps_taken`` (``Integer``), ``success`` (``Boolean``).

    Raises:
        NotImplementedError: the ``simanneal`` extra is not installed.
    """
    _check_simanneal_support()
    from simanneal import Annealer

    # The state lives in a numpy array the move operator mutates in place
    state_arr = initial_perm.to_numpy(dtype=np.int64)

    class PermutationAnnealer(Annealer):
        """Annealer for permutation problems with swap moves."""

        copy_strategy = "method"

        def __init__(self, state: np.ndarray, energy_fn: Callable[[EastVector], float]):
            self.energy_fn = energy_fn
            self._n = len(state)
            super().__init__(state)

        def copy_state(self, state: np.ndarray) -> np.ndarray:
            """Copy numpy array state."""
            return state.copy()

        def move(self):
            """Swap two random elements."""
            i = random.randint(0, self._n - 1)
            j = random.randint(0, self._n - 1)
            self.state[i], self.state[j] = self.state[j], self.state[i]

        def energy(self):
            """Calculate energy from permutation (a copy, so the East function never sees a later mutation)."""
            return self.energy_fn(EastVector(IntegerType, self.state.copy()))

    annealer = PermutationAnnealer(state_arr, energy_fn)
    with _seeded(config["random_state"].unwrap_or(None)):
        _configure_schedule(annealer, config)
        best_state_arr, best_energy = annealer.anneal()

    return EastStruct(
        {
            "best_state": variant(
                "int_array", EastVector(IntegerType, best_state_arr.astype(np.int64)), DiscreteStateType
            ),
            "best_energy": float(best_energy if best_energy is not None else 0.0),
            "steps_taken": int(annealer.steps),
            "success": best_energy is not None,
        }
    )


@platform_function(
    name="simanneal_optimize_subset",
    inputs=[
        VectorType(BooleanType),
        SubsetEnergyType,
        AnnealConfigType,
    ],
    output=AnnealResultType,
)
def simanneal_optimize_subset_impl(
    initial_selection: EastVector,
    energy_fn: Callable[[EastVector], float],
    config: EastStruct,
) -> EastStruct:
    """Run simulated annealing on a binary subset selection using bit-flip moves.

    Specialization of :func:`simanneal_optimize_impl` for subset-selection
    problems (e.g. feature selection, portfolio construction). The state is a
    boolean mask over items; at each step a random bit is flipped. The state is
    maintained internally as a NumPy boolean array; ``energy_fn`` receives a
    ``Vector<Boolean>`` view at each evaluation.

    Args:
        initial_selection: ``Vector<Boolean>`` (``EastVector``) - initial
            inclusion mask; length = total number of candidate items.
        energy_fn: ``Function<[Vector<Boolean>], Float>`` (callable) - scores
            the current selection mask; lower energy is preferred.
        config: ``AnnealConfigType`` (``EastStruct``) - see
            :func:`simanneal_optimize_impl` for all fields (``t_max``,
            ``t_min``, ``steps``, ``updates``, ``auto_schedule``,
            ``random_state``).

    Returns:
        ``AnnealResultType`` (``EastStruct``): ``best_state`` tagged
        ``bool_array`` (``Vector<Boolean>``), ``best_energy`` (``Float``),
        ``steps_taken`` (``Integer``), ``success`` (``Boolean``).

    Raises:
        NotImplementedError: the ``simanneal`` extra is not installed.
    """
    _check_simanneal_support()
    from simanneal import Annealer

    # The state lives in a numpy array the move operator mutates in place
    state_arr = initial_selection.to_numpy(dtype=np.bool_)

    class SubsetAnnealer(Annealer):
        """Annealer for subset selection with bit-flip moves."""

        copy_strategy = "method"

        def __init__(self, state: np.ndarray, energy_fn: Callable[[EastVector], float]):
            self.energy_fn = energy_fn
            self._n = len(state)
            super().__init__(state)

        def copy_state(self, state: np.ndarray) -> np.ndarray:
            """Copy numpy array state."""
            return state.copy()

        def move(self):
            """Flip a random bit."""
            i = random.randint(0, self._n - 1)
            self.state[i] = not self.state[i]

        def energy(self):
            """Calculate energy from selection (a copy, so the East function never sees a later mutation)."""
            return self.energy_fn(EastVector(BooleanType, self.state.copy()))

    annealer = SubsetAnnealer(state_arr, energy_fn)
    with _seeded(config["random_state"].unwrap_or(None)):
        _configure_schedule(annealer, config)
        best_state_arr, best_energy = annealer.anneal()

    return EastStruct(
        {
            "best_state": variant("bool_array", EastVector(BooleanType, best_state_arr), DiscreteStateType),
            "best_energy": float(best_energy if best_energy is not None else 0.0),
            "steps_taken": int(annealer.steps),
            "success": best_energy is not None,
        }
    )


# ============================================================================
# Platform Function Registration
# ============================================================================

# Collected from the @platform_function decorations above.
simanneal_impl = platform_functions(__name__)


__all__ = [
    "simanneal_impl",
    "DiscreteStateType",
    "EnergyFunctionType",
    "MoveFunctionType",
    "PermutationEnergyType",
    "SubsetEnergyType",
    "AnnealConfigType",
    "AnnealResultType",
]
