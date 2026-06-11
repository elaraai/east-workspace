#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""PyMC Bayesian inference for East - regression, hierarchical, and multi-layer models.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.pymc.pymc_impl import (
    PyMCDiagnosticsResultType,
    PyMCHierarchicalConfigType,
    PyMCLayerSpecType,
    PyMCLikelihoodType,
    PyMCModelBlobType,
    PyMCMultiLayerConfigType,
    PyMCNamedDataType,
    PyMCNamedMaskType,
    PyMCNamedPriorType,
    PyMCObservedFitType,
    PyMCParameterDiagType,
    PyMCParameterEstimateType,
    PyMCParameterSummaryType,
    PyMCPoolingType,
    PyMCPredictConfigType,
    PyMCPriorDistributionType,
    PyMCPriorParamsType,
    PyMCPriorSpecType,
    PyMCRegressionConfigType,
    pymc_diagnostics_impl,
    pymc_impl,
    pymc_posterior_predictive_check_impl,
    pymc_posterior_samples_impl,
    pymc_posterior_summary_impl,
    pymc_predict_distribution_impl,
    pymc_predict_impl,
    pymc_train_hierarchical_impl,
    pymc_train_multi_layer_impl,
    pymc_train_regression_impl,
)

__all__ = [
    # Platform registration
    "pymc_impl",
    # Directly-callable implementations
    "pymc_train_regression_impl",
    "pymc_train_hierarchical_impl",
    "pymc_train_multi_layer_impl",
    "pymc_predict_impl",
    "pymc_predict_distribution_impl",
    "pymc_posterior_summary_impl",
    "pymc_posterior_samples_impl",
    "pymc_diagnostics_impl",
    "pymc_posterior_predictive_check_impl",
    # East type definitions
    "PyMCPriorDistributionType",
    "PyMCLikelihoodType",
    "PyMCPoolingType",
    "PyMCPriorParamsType",
    "PyMCPriorSpecType",
    "PyMCRegressionConfigType",
    "PyMCHierarchicalConfigType",
    "PyMCLayerSpecType",
    "PyMCNamedPriorType",
    "PyMCNamedMaskType",
    "PyMCMultiLayerConfigType",
    "PyMCNamedDataType",
    "PyMCPredictConfigType",
    "PyMCParameterEstimateType",
    "PyMCParameterSummaryType",
    "PyMCParameterDiagType",
    "PyMCDiagnosticsResultType",
    "PyMCObservedFitType",
    "PyMCModelBlobType",
]
