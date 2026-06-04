#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Simulated Annealing platform functions for East.

Provides discrete optimization using the simanneal library.
Ideal for combinatorial problems like TSP, scheduling, and subset selection.
"""

import importlib.util
import random
from collections.abc import Callable
from typing import Any

import numpy as np
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
from east.types.values import EastStruct, EastVariant, EastVector, is_east_variant

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

# Energy function type: state -> score
EnergyFunctionType = FunctionType([DiscreteStateType], FloatType)

# Move function type: state -> neighbor
MoveFunctionType = FunctionType([DiscreteStateType], DiscreteStateType)

# Permutation energy function type
PermutationEnergyType = FunctionType([VectorType(IntegerType)], FloatType)

# Subset energy function type
SubsetEnergyType = FunctionType([VectorType(BooleanType)], FloatType)

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

# Annealing result
AnnealResultType = StructType(
    [
        ("best_state", DiscreteStateType),
        ("best_energy", FloatType),
        ("steps_taken", IntegerType),
        ("success", BooleanType),
    ]
)


# ============================================================================
# Helper Functions
# ============================================================================


def _get_option(opt: EastVariant | None, default: Any) -> Any:
    """Extract value from Option variant, returning default if None."""
    if opt is None:
        return default
    if is_east_variant(opt) and opt.type == "some":
        return opt.value
    return default



# Lazy import guard for optional dependency
_HAS_SIMANNEAL_SUPPORT = importlib.util.find_spec("simanneal") is not None


def _check_simanneal_support() -> None:
    """Check if simanneal support is available."""
    if not _HAS_SIMANNEAL_SUPPORT:
        raise NotImplementedError(
            "Simanneal support requires the 'simanneal' extra. "
            "Add east-py-datascience[simanneal] to your pyproject.toml dependencies."
        )


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
    """Run simulated annealing with custom energy and move functions."""
    _check_simanneal_support()
    from simanneal import Annealer

    # Set random seed if provided
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random.seed(int(random_state))

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

    # Create annealer instance
    annealer = EastAnnealer(initial_state, energy_fn, move_fn)

    # Configure schedule
    t_max = _get_option(config.get("t_max"), None)
    if t_max is not None:
        annealer.Tmax = float(t_max)

    t_min = _get_option(config.get("t_min"), None)
    if t_min is not None:
        annealer.Tmin = float(t_min)

    steps = _get_option(config.get("steps"), None)
    if steps is not None:
        annealer.steps = int(steps)

    updates = _get_option(config.get("updates"), None)
    if updates is not None:
        annealer.updates = int(updates)
    else:
        annealer.updates = 0  # Suppress output by default

    # Auto-calibrate if requested
    auto_minutes = _get_option(config.get("auto_schedule"), None)
    if auto_minutes is not None:
        schedule = annealer.auto(minutes=float(auto_minutes))
        annealer.set_schedule(schedule)

    # Run optimization
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
    """Run simulated annealing on a permutation using swap moves."""
    _check_simanneal_support()
    from simanneal import Annealer

    # Set random seed if provided
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random.seed(int(random_state))

    # Convert to numpy array for efficient operations
    state_arr = initial_perm.to_numpy(dtype=np.int64)

    # Pre-allocate EastVector for energy function calls (reused each call)
    cached_east_array: EastVector | None = None
    cached_state_hash: int | None = None

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
            """Calculate energy from permutation."""
            nonlocal cached_east_array, cached_state_hash
            # Cache EastVector based on state content hash
            state_hash = hash(self.state.tobytes())
            if cached_state_hash != state_hash or cached_east_array is None:
                cached_east_array = EastVector(IntegerType, self.state.astype(np.int64))
                cached_state_hash = state_hash
            return self.energy_fn(cached_east_array)

    annealer = PermutationAnnealer(state_arr, energy_fn)

    # Configure schedule
    t_max = _get_option(config.get("t_max"), None)
    if t_max is not None:
        annealer.Tmax = float(t_max)

    t_min = _get_option(config.get("t_min"), None)
    if t_min is not None:
        annealer.Tmin = float(t_min)

    steps = _get_option(config.get("steps"), None)
    if steps is not None:
        annealer.steps = int(steps)

    updates = _get_option(config.get("updates"), None)
    if updates is not None:
        annealer.updates = int(updates)
    else:
        annealer.updates = 0

    auto_minutes = _get_option(config.get("auto_schedule"), None)
    if auto_minutes is not None:
        schedule = annealer.auto(minutes=float(auto_minutes))
        annealer.set_schedule(schedule)

    # Run optimization
    best_state_arr, best_energy = annealer.anneal()

    # Convert numpy array back to EastVector only at return
    return EastStruct(
        {
            "best_state": EastVariant(
                "int_array", EastVector(IntegerType, best_state_arr.astype(np.int64))
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
    """Run simulated annealing on a subset selection using bit-flip moves."""
    _check_simanneal_support()
    from simanneal import Annealer

    # Set random seed if provided
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random.seed(int(random_state))

    # Convert to numpy array for efficient operations
    state_arr = initial_selection.to_numpy(dtype=np.bool_)

    # Pre-allocate EastVector for energy function calls (reused each call)
    cached_east_array: EastVector | None = None
    cached_state_hash: int | None = None

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
            """Calculate energy from selection."""
            nonlocal cached_east_array, cached_state_hash
            # Cache EastVector based on state content hash
            state_hash = hash(self.state.tobytes())
            if cached_state_hash != state_hash or cached_east_array is None:
                cached_east_array = EastVector(BooleanType, self.state)
                cached_state_hash = state_hash
            return self.energy_fn(cached_east_array)

    annealer = SubsetAnnealer(state_arr, energy_fn)

    # Configure schedule
    t_max = _get_option(config.get("t_max"), None)
    if t_max is not None:
        annealer.Tmax = float(t_max)

    t_min = _get_option(config.get("t_min"), None)
    if t_min is not None:
        annealer.Tmin = float(t_min)

    steps = _get_option(config.get("steps"), None)
    if steps is not None:
        annealer.steps = int(steps)

    updates = _get_option(config.get("updates"), None)
    if updates is not None:
        annealer.updates = int(updates)
    else:
        annealer.updates = 0

    auto_minutes = _get_option(config.get("auto_schedule"), None)
    if auto_minutes is not None:
        schedule = annealer.auto(minutes=float(auto_minutes))
        annealer.set_schedule(schedule)

    best_state_arr, best_energy = annealer.anneal()

    # Convert numpy array back to EastVector only at return
    return EastStruct(
        {
            "best_state": EastVariant(
                "bool_array", EastVector(BooleanType, best_state_arr)
            ),
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
