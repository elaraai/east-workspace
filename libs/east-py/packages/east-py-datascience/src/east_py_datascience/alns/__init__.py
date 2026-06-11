#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""ALNS adaptive large neighborhood search for East - combinatorial meta-heuristic.

The ``alns_optimize_impl`` function is a plain Python callable taking and
returning East values - import it directly from a project's own
``@platform_function`` to reuse the implementation without an IR round-trip.
``alns_optimize_impl`` is generic over the solution type ``S``; type safety is
enforced at the TypeScript/IR level. The East type definitions (config and
result types) are re-exported here for building inputs with ``coerce_to`` and
validating outputs.
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
    alns_optimize_impl,
)

__all__ = [
    # Platform registration
    "alns_impl",
    # Directly-callable implementations
    "alns_optimize_impl",
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
