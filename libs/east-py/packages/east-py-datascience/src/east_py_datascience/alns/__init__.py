#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""ALNS adaptive large neighborhood search for East - combinatorial meta-heuristic.

``alns_optimize`` is a plain Python callable taking and returning East values
- import it directly from a project's own ``@East.platform_function`` to reuse
the implementation without an IR round-trip - and the same object called
inside an East body is the platform call, the solution type ``S`` first:
``alns_optimize(SolutionType, initial, objective, destroy, repair, config)``.
The search itself reads the values, not ``S``. The East type definitions
(config and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.alns.alns import (
    AcceptanceCriterionType,
    ALNSConfigType,
    ALNSResultType,
    OperatorSelectionType,
    RecordToRecordConfigType,
    RouletteWheelConfigType,
    SimulatedAnnealingConfigType,
    StopCriterionType,
    alns_impl,
    alns_optimize,
)

__all__ = [
    # Platform registration
    "alns_impl",
    # Directly-callable implementations
    "alns_optimize",
    # East type definitions
    "SimulatedAnnealingConfigType",
    "RecordToRecordConfigType",
    "AcceptanceCriterionType",
    "RouletteWheelConfigType",
    "OperatorSelectionType",
    "StopCriterionType",
    "ALNSConfigType",
    "ALNSResultType",
]
