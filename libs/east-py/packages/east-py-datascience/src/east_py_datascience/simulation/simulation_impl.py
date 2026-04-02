#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Discrete Event Simulation (DES) platform functions for East.

Uses a C-level DES engine (min-heap + east_call) for high-performance
event processing without Python overhead per event.
"""

from east.runtime.platform import GenericPlatformFunction

from east_py_datascience.simulation._simulation_eastc import (
    simulation_run_capsule,
    simulation_run_trajectories_capsule,
)

simulation_impl = [
    GenericPlatformFunction(
        name="simulation_run",
        type_parameters=["R", "E"],
        type="sync",
        fn=None,
        c_factory=simulation_run_capsule,
    ),
    GenericPlatformFunction(
        name="simulation_run_trajectories",
        type_parameters=["R", "E"],
        type="sync",
        fn=None,
        c_factory=simulation_run_trajectories_capsule,
    ),
]

__all__ = [
    "simulation_impl",
]
