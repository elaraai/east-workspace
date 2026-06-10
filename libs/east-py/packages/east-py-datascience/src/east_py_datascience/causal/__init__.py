#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Causal inference for East - DoWhy backdoor estimation, EconML DML, ALE curves.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.causal.causal_impl import (
    ALEResultType,
    CausalALEConfigType,
    CausalATEResultType,
    CausalBootstrapConfigType,
    CausalDMLConfigType,
    CausalDMLModelBlobType,
    CausalEffectConfigType,
    CausalEffectResultType,
    CausalEstimatorType,
    CausalNuisanceModelType,
    CausalRefuteResultType,
    CausalRefuterType,
    CausalTargetUnitsType,
    CausalWeightingSchemeType,
    PropensityTrimType,
    causal_ale_impl,
    causal_dml_ate_impl,
    causal_dml_effect_impl,
    causal_dml_train_impl,
    causal_effect_impl,
    causal_impl,
    causal_refute_impl,
)

__all__ = [
    # Platform registration
    "causal_impl",
    # Directly-callable implementations
    "causal_effect_impl",
    "causal_refute_impl",
    "causal_dml_train_impl",
    "causal_dml_effect_impl",
    "causal_dml_ate_impl",
    "causal_ale_impl",
    # East type definitions
    "CausalWeightingSchemeType",
    "CausalEstimatorType",
    "CausalTargetUnitsType",
    "PropensityTrimType",
    "CausalBootstrapConfigType",
    "CausalEffectConfigType",
    "CausalRefuterType",
    "CausalNuisanceModelType",
    "CausalDMLConfigType",
    "CausalALEConfigType",
    "CausalDMLModelBlobType",
    "CausalEffectResultType",
    "CausalRefuteResultType",
    "CausalATEResultType",
    "ALEResultType",
]
