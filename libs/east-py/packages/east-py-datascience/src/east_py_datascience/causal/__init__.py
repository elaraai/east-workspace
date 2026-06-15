#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Causal inference for East — one declarative entry point, ``Causal.experiment``.

``causal_experiment_impl`` is a plain Python callable taking and returning East
values — import it from a project's own ``@platform_function`` to reuse the
implementation without an IR round-trip. The East type definitions (config,
result) are re-exported here for building inputs with ``coerce_to`` and validating
outputs. The raw DoWhy / EconML / PyALE estimators are internal implementation
that ``experiment`` composes.
"""

from east_py_datascience.causal.causal_impl import (
    BalanceRowType,
    CausalBootstrapConfigType,
    CausalEstimatorType,
    CausalExperimentConfigType,
    CausalExperimentResultType,
    CausalTargetUnitsType,
    CausalWeightingSchemeType,
    CiType,
    DesignBasisType,
    DesignConfigType,
    DoseResponseType,
    ExperimentDesignType,
    ExperimentVerdictType,
    OverlapDiagnosticType,
    PowerCurveType,
    RefutationType,
    RefuteSpecType,
    TrialOptionType,
    causal_design_validation_impl,
    causal_experiment_impl,
    causal_impl,
)

__all__ = [
    # Platform registration
    "causal_impl",
    # Directly-callable implementations
    "causal_experiment_impl",
    "causal_design_validation_impl",
    # East type definitions
    "CausalWeightingSchemeType",
    "CausalEstimatorType",
    "CausalTargetUnitsType",
    "CausalBootstrapConfigType",
    "CiType",
    "RefuteSpecType",
    "CausalExperimentConfigType",
    "BalanceRowType",
    "OverlapDiagnosticType",
    "RefutationType",
    "DoseResponseType",
    "ExperimentVerdictType",
    "CausalExperimentResultType",
    # Validation-design contract
    "DesignBasisType",
    "TrialOptionType",
    "PowerCurveType",
    "ExperimentDesignType",
    "DesignConfigType",
]
