#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Discrete Event Simulation (DES) for East - economic ontology DES engine.

``simulation_run`` is a generic platform function (type parameters ``R`` and
``E``) implemented entirely in C. It cannot be called directly as a Python
function; it is registered via ``simulation_impl`` and invoked through the
East IR execution path. See ``simulation_impl`` module docstring for the full
process-handler contract and config/result field documentation.
"""

from east_py_datascience.simulation.simulation_impl import (
    simulation_impl,
)

__all__ = [
    # Platform registration
    "simulation_impl",
]
