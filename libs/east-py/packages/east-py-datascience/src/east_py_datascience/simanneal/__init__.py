#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Simulated annealing discrete optimization for East - combinatorial search via simanneal.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(state, function, config, and result types) are re-exported here for building
inputs with ``coerce_to`` and validating outputs.
"""

from east_py_datascience.simanneal.simanneal import (
    AnnealConfigType,
    AnnealResultType,
    DiscreteStateType,
    EnergyFunctionType,
    MoveFunctionType,
    PermutationEnergyType,
    SubsetEnergyType,
    simanneal_impl,
    simanneal_optimize,
    simanneal_optimize_permutation,
    simanneal_optimize_subset,
)

__all__ = [
    # Platform registration
    "simanneal_impl",
    # Directly-callable implementations
    "simanneal_optimize",
    "simanneal_optimize_permutation",
    "simanneal_optimize_subset",
    # East type definitions
    "DiscreteStateType",
    "EnergyFunctionType",
    "MoveFunctionType",
    "PermutationEnergyType",
    "SubsetEnergyType",
    "AnnealConfigType",
    "AnnealResultType",
]
