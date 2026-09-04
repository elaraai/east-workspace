#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Optuna Bayesian optimization for East - TPE-sampled hyperparameter search.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(search space, config, and result types) are re-exported here for building
inputs with ``coerce_to`` and validating outputs.
"""

from east_py_datascience.optuna.optuna import (
    NamedParamType,
    OptimizationDirectionType,
    OptunaStudyConfigType,
    ParamSpaceKindType,
    ParamSpaceType,
    ParamValueType,
    PrunerType,
    StudyResultType,
    TrialResultType,
    optuna_impl,
    optuna_optimize,
)

__all__ = [
    # Platform registration
    "optuna_impl",
    # Directly-callable implementations
    "optuna_optimize",
    # East type definitions
    "ParamValueType",
    "ParamSpaceKindType",
    "ParamSpaceType",
    "NamedParamType",
    "OptimizationDirectionType",
    "PrunerType",
    "OptunaStudyConfigType",
    "TrialResultType",
    "StudyResultType",
]
