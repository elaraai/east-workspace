#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Discrete Event Simulation (DES) for East - economic ontology DES engine.

``simulation_run`` is a generic platform function (type parameters ``R`` and
``E``) implemented entirely in C, so what is exported under that name is the
DECLARATION an East body calls — ``simulation_run(Resources, Events, state,
events, process, config)`` — with ``simulation_impl`` the registration the
runtime binds. There is no eager python call. See the ``simulation_impl``
module docstring for the full process-handler contract and config/result
field documentation.
"""

from east_py_datascience.simulation.simulation_impl import (
    ProcessFnType,
    ProcessResultType,
    ScheduledEventType,
    SimulationConfigType,
    SimulationResultType,
    simulation_impl,
    simulation_run,
)

__all__ = [
    # Platform registration
    "simulation_impl",
    # The declaration an East body calls
    "simulation_run",
    # East type definitions
    "ScheduledEventType",
    "ProcessResultType",
    "ProcessFnType",
    "SimulationConfigType",
    "SimulationResultType",
]
