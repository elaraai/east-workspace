#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""PyMC Bayesian inference platform functions for East.

Provides Bayesian linear regression, hierarchical models, and multi-layer
joint estimation with full posterior analysis using PyMC.
Uses cloudpickle for model serialization.
"""

from typing import Any

import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    FloatType,
    IntegerType,
    MatrixType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    VectorType,
)
from east.types.values import EastArray, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience._common import (
    deserialize,
    extra_guard,
    option_tag,
    quiet_warnings,
    serialize,
)

# ============================================================================
# Type Definitions (must match TypeScript exactly)
# ============================================================================

PyMCPriorDistributionType = VariantType(
    [
        ("halfnormal", NullType),
        ("lognormal", NullType),
        ("normal", NullType),
        ("halfcauchy", NullType),
        ("exponential", NullType),
        ("uniform", NullType),
        ("horseshoe", NullType),
    ]
)
"""Prior distribution family for a coefficient parameter.

Cases: ``halfnormal`` (half-normal, non-negative coefficients),
``lognormal`` (log-normal, strictly positive), ``normal`` (symmetric,
uses ``mu`` + ``sigma``), ``halfcauchy`` (heavy-tailed scale prior, uses
``sigma`` as beta), ``exponential`` (uses ``tau`` as rate lambda),
``uniform`` (bounded, uses ``lower`` + ``upper``), ``horseshoe``
(regularising horseshoe, encourages sparsity).
"""

PyMCLikelihoodType = VariantType(
    [
        ("normal", NullType),
        ("studentt", NullType),
        ("poisson", NullType),
    ]
)
"""Observation likelihood distribution.

Cases: ``normal`` (default - Gaussian noise with ``HalfNormal`` sigma),
``studentt`` (robust to outliers - adds ``nu`` and ``sigma`` nuisance
parameters), ``poisson`` (count data - ``mu`` clipped to positive).
"""

PyMCPoolingType = VariantType(
    [
        ("none", NullType),
        ("partial", NullType),
        ("full", NullType),
    ]
)
"""Group-level pooling strategy for hierarchical models.

Cases: ``none`` (independent per-group coefficients, no information
sharing), ``partial`` (default - partial pooling via Normal hyperpriors on
shared mean and scale), ``full`` (all groups share a single coefficient
matrix).
"""

PyMCPriorParamsType = StructType(
    [
        ("mu", OptionType(MatrixType(FloatType))),
        ("sigma", OptionType(MatrixType(FloatType))),
        ("tau", OptionType(FloatType)),
        ("lower", OptionType(FloatType)),
        ("upper", OptionType(FloatType)),
    ]
)
"""Hyperparameters for a prior distribution.

Fields: ``mu`` (location matrix, scalar ``[1×1]`` used; default 0.0),
``sigma`` (scale matrix, scalar ``[1×1]`` used; default 1.0; serves as
``beta`` for ``halfcauchy``), ``tau`` (rate used as ``lam`` for
``exponential``; default 1.0), ``lower`` (lower bound for ``uniform``;
default -10.0), ``upper`` (upper bound for ``uniform``; default 10.0).
"""

PyMCPriorSpecType = StructType(
    [
        ("distribution", PyMCPriorDistributionType),
        ("params", PyMCPriorParamsType),
    ]
)
"""Full prior specification: distribution family plus its hyperparameters.

Fields: ``distribution`` (``PyMCPriorDistributionType`` - which family),
``params`` (``PyMCPriorParamsType`` - the hyperparameter values).
"""

PyMCRegressionConfigType = StructType(
    [
        ("prior", OptionType(PyMCPriorSpecType)),
        ("likelihood", OptionType(PyMCLikelihoodType)),
        ("include_intercept", OptionType(BooleanType)),
        ("samples", OptionType(IntegerType)),
        ("tune", OptionType(IntegerType)),
        ("chains", OptionType(IntegerType)),
        ("target_accept", OptionType(FloatType)),
    ]
)
"""Configuration for Bayesian linear regression training.

Fields: ``prior`` (coefficient prior; default ``Normal(0, 10)``),
``likelihood`` (observation model; default ``normal``),
``include_intercept`` (fit per-target intercept; default ``true``),
``samples`` (posterior draws; default 1000), ``tune`` (NUTS warm-up steps;
default 1000), ``chains`` (parallel chains; default 2),
``target_accept`` (NUTS step-size target; default 0.8).
"""

PyMCHierarchicalConfigType = StructType(
    [
        ("prior", OptionType(PyMCPriorSpecType)),
        ("likelihood", OptionType(PyMCLikelihoodType)),
        ("pooling", OptionType(PyMCPoolingType)),
        ("samples", OptionType(IntegerType)),
        ("tune", OptionType(IntegerType)),
        ("chains", OptionType(IntegerType)),
        ("target_accept", OptionType(FloatType)),
    ]
)
"""Configuration for hierarchical Bayesian model training.

Fields: ``prior`` (group-level coefficient prior; ignored for ``partial``
pooling which always uses ``Normal(0,10)`` / ``HalfNormal(5)``
hyperpriors; default ``Normal(0, 10)``), ``likelihood`` (default
``normal``), ``pooling`` (default ``partial``), ``samples`` (default
1000), ``tune`` (default 1000), ``chains`` (default 2),
``target_accept`` (default 0.8).
"""

PyMCLayerSpecType = StructType(
    [
        ("name", StringType),
        ("input", StringType),
        ("output", StringType),
        ("parameter", StringType),
        ("likelihood", OptionType(PyMCLikelihoodType)),
    ]
)
"""Specification for a single layer in a multi-layer joint model.

Fields: ``name`` (identifier used for the likelihood node in the PyMC
model), ``input`` (key into the named-data array for the feature matrix),
``output`` (key into the named-data array for the target matrix),
``parameter`` (name of the coefficient variable - used to look up priors
and masks), ``likelihood`` (per-layer observation model; default
``normal``).
"""

PyMCNamedPriorType = StructType(
    [
        ("name", StringType),
        ("prior", PyMCPriorSpecType),
    ]
)
"""A prior specification keyed by parameter name.

Fields: ``name`` (matches a ``parameter`` field in ``PyMCLayerSpecType``),
``prior`` (``PyMCPriorSpecType`` - distribution + hyperparameters).
"""

PyMCNamedMaskType = StructType(
    [
        ("name", StringType),
        ("mask", MatrixType(BooleanType)),
    ]
)
"""A binary coefficient mask keyed by parameter name.

Fields: ``name`` (matches a ``parameter`` field in ``PyMCLayerSpecType``),
``mask`` (``Matrix<Boolean>`` of shape ``(n_features, n_targets)``
element-wise multiplied onto the coefficient matrix before the dot
product - use to enforce structural zeros).
"""

PyMCMultiLayerConfigType = StructType(
    [
        ("layers", ArrayType(PyMCLayerSpecType)),
        ("priors", OptionType(ArrayType(PyMCNamedPriorType))),
        ("masks", OptionType(ArrayType(PyMCNamedMaskType))),
        ("samples", OptionType(IntegerType)),
        ("tune", OptionType(IntegerType)),
        ("chains", OptionType(IntegerType)),
        ("target_accept", OptionType(FloatType)),
        ("force_full_mcmc", OptionType(BooleanType)),
        ("fallback_l1_alpha", OptionType(FloatType)),
    ]
)
"""Configuration for multi-layer joint Bayesian estimation.

Fields: ``layers`` (ordered list of ``PyMCLayerSpecType``), ``priors``
(per-parameter prior overrides; unmatched parameters default to
``Normal(0, 10)``), ``masks`` (per-parameter structural zero masks),
``samples`` (default 1000), ``tune`` (default 1000), ``chains`` (default
2), ``target_accept`` (default 0.8), ``force_full_mcmc`` (disable the
``MultiTaskLasso`` fallback for models with more than 10 000 parameters;
default ``false``), ``fallback_l1_alpha`` (L1 regularisation strength when
the fallback triggers; default 0.01).
"""

PyMCNamedDataType = StructType(
    [
        ("name", StringType),
        ("data", MatrixType(FloatType)),
    ]
)
"""A named data matrix for use as a multi-layer input or output.

Fields: ``name`` (referenced by ``PyMCLayerSpecType.input`` /
``PyMCLayerSpecType.output``), ``data`` (``Matrix<Float>`` - the actual
feature or target matrix).
"""

PyMCPredictConfigType = StructType(
    [
        ("layer", OptionType(StringType)),
        ("n_samples", OptionType(IntegerType)),
    ]
)
"""Configuration for posterior prediction and distribution sampling.

Fields: ``layer`` (multi-layer only - name of the layer whose coefficient
is used for prediction; defaults to the first layer), ``n_samples``
(number of posterior draws to average or return; default 100).
"""

PyMCParameterEstimateType = StructType(
    [
        ("index_row", IntegerType),
        ("index_col", IntegerType),
        ("mean", FloatType),
        ("median", FloatType),
        ("sd", FloatType),
        ("ci_lower", FloatType),
        ("ci_upper", FloatType),
        ("rhat", FloatType),
        ("ess", FloatType),
    ]
)
"""Posterior summary for one element of a parameter matrix.

Fields: ``index_row`` / ``index_col`` (zero-based element position),
``mean`` (posterior mean), ``median`` (posterior median), ``sd`` (posterior
standard deviation), ``ci_lower`` / ``ci_upper`` (2.5th and 97.5th
percentile credible interval), ``rhat`` (Gelman-Rubin convergence
statistic - values near 1.0 indicate convergence), ``ess`` (effective
sample size).
"""

PyMCParameterSummaryType = StructType(
    [
        ("parameter", StringType),
        ("shape_rows", IntegerType),
        ("shape_cols", IntegerType),
        ("estimates", ArrayType(PyMCParameterEstimateType)),
    ]
)
"""Full posterior summary for a named parameter.

Fields: ``parameter`` (variable name in the PyMC model), ``shape_rows`` /
``shape_cols`` (matrix dimensions of the parameter), ``estimates``
(``Array<PyMCParameterEstimateType>`` - one entry per element in
row-major order).
"""

PyMCParameterDiagType = StructType(
    [
        ("parameter", StringType),
        ("rhat_max", FloatType),
        ("ess_min", FloatType),
        ("n_divergent", IntegerType),
    ]
)
"""Convergence diagnostics summary for a single parameter.

Fields: ``parameter`` (variable name), ``rhat_max`` (maximum R-hat across
all elements - values above 1.1 indicate poor convergence), ``ess_min``
(minimum effective sample size across all elements), ``n_divergent``
(total divergent NUTS transitions for the model - same across all
parameters in a result).
"""

PyMCDiagnosticsResultType = StructType(
    [
        ("converged", BooleanType),
        ("n_divergences", IntegerType),
        ("parameters", ArrayType(PyMCParameterDiagType)),
        ("warnings", ArrayType(StringType)),
    ]
)
"""MCMC convergence diagnostic report for a trained model.

Fields: ``converged`` (``true`` when all R-hat < 1.1 and no divergent
transitions), ``n_divergences`` (total divergent NUTS transitions across
all chains), ``parameters`` (``Array<PyMCParameterDiagType>`` - per-parameter
diagnostics), ``warnings`` (human-readable messages for each non-converged
parameter and for divergences; L1-fallback models return a single
informational warning).
"""

PyMCObservedFitType = StructType(
    [
        ("name", StringType),
        ("mae", FloatType),
        ("correlation", FloatType),
        ("coverage_95", FloatType),
    ]
)
"""Posterior predictive fit metrics for one target column.

Fields: ``name`` (``"target_<t>"`` where ``t`` is the zero-based column
index), ``mae`` (mean absolute error of the posterior mean prediction),
``correlation`` (Pearson correlation between posterior mean and observed),
``coverage_95`` (fraction of observed values falling inside the 2.5–97.5
posterior predictive interval).
"""

PyMCModelBlobType = VariantType(
    [
        (
            "pymc_regression",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_targets", IntegerType),
                    ("include_intercept", BooleanType),
                ]
            ),
        ),
        (
            "pymc_hierarchical",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_targets", IntegerType),
                    ("n_groups", IntegerType),
                ]
            ),
        ),
        (
            "pymc_multi_layer",
            StructType(
                [
                    ("data", BlobType),
                    ("layer_names", ArrayType(StringType)),
                    ("parameter_names", ArrayType(StringType)),
                ]
            ),
        ),
    ]
)
"""Serialised model blob produced by the PyMC train functions.

Cases:
- ``pymc_regression`` - Bayesian linear regression blob:
  ``data`` (cloudpickled ``InferenceData``), ``n_features``,
  ``n_targets``, ``include_intercept``.
- ``pymc_hierarchical`` - hierarchical model blob:
  ``data`` (cloudpickled ``InferenceData``), ``n_features``,
  ``n_targets``, ``n_groups`` (distinct group count after remapping).
- ``pymc_multi_layer`` - multi-layer joint model blob:
  ``data`` (cloudpickled ``InferenceData`` or L1 point-estimate
  coefficients), ``layer_names``, ``parameter_names``
  (``Array<String>`` - ordered lists from the layer specs).
"""


_check_pymc_support = extra_guard("pymc", "pymc", "PyMC")


# ============================================================================
# Prior Builder
# ============================================================================


def _build_prior(pm, name, prior_spec, shape):
    """Build a PyMC prior distribution from a PriorSpec."""
    if prior_spec is None:
        # Default: normal(0, 10)
        return pm.Normal(name, mu=0, sigma=10, shape=shape)

    dist_tag = prior_spec["distribution"].type
    params = prior_spec["params"]

    mu_opt = params["mu"].unwrap_or(None)
    sigma_opt = params["sigma"].unwrap_or(None)
    tau_opt = params["tau"].unwrap_or(None)
    lower_opt = params["lower"].unwrap_or(None)
    upper_opt = params["upper"].unwrap_or(None)

    # Convert matrix params to numpy, broadcast to shape
    mu_val = float(mu_opt.to_numpy()[0, 0]) if mu_opt is not None else 0.0
    sigma_val = float(sigma_opt.to_numpy()[0, 0]) if sigma_opt is not None else 1.0

    if dist_tag == "normal":
        return pm.Normal(name, mu=mu_val, sigma=sigma_val, shape=shape)
    elif dist_tag == "halfnormal":
        return pm.HalfNormal(name, sigma=sigma_val, shape=shape)
    elif dist_tag == "lognormal":
        return pm.LogNormal(name, mu=mu_val, sigma=sigma_val, shape=shape)
    elif dist_tag == "halfcauchy":
        beta = sigma_val
        return pm.HalfCauchy(name, beta=beta, shape=shape)
    elif dist_tag == "exponential":
        lam = float(tau_opt) if tau_opt is not None else 1.0
        return pm.Exponential(name, lam=lam, shape=shape)
    elif dist_tag == "uniform":
        lo = float(lower_opt) if lower_opt is not None else -10.0
        hi = float(upper_opt) if upper_opt is not None else 10.0
        return pm.Uniform(name, lower=lo, upper=hi, shape=shape)
    elif dist_tag == "horseshoe":
        tau_hs = pm.HalfCauchy(f"{name}_tau", beta=1.0)
        lam_hs = pm.HalfCauchy(f"{name}_lambda", beta=1.0, shape=shape)
        return pm.Normal(name, mu=0, sigma=tau_hs * lam_hs, shape=shape)
    else:
        return pm.Normal(name, mu=0, sigma=10, shape=shape)


def _build_likelihood(pm, name, mu, observed, likelihood_tag):
    """Build a PyMC likelihood from a likelihood tag."""
    if likelihood_tag == "studentt":
        nu = pm.Exponential(f"{name}_nu", lam=1.0 / 29.0)
        sigma = pm.HalfNormal(f"{name}_sigma", sigma=10)
        return pm.StudentT(name, nu=nu, mu=mu, sigma=sigma, observed=observed)
    elif likelihood_tag == "poisson":
        # Ensure mu is positive
        mu_pos = np.abs(mu) + 1e-8
        return pm.Poisson(name, mu=mu_pos, observed=observed)
    else:
        # Default: normal
        sigma = pm.HalfNormal(f"{name}_sigma", sigma=10)
        return pm.Normal(name, mu=mu, sigma=sigma, observed=observed)


# ============================================================================
# Extract common MCMC config
# ============================================================================


def _get_mcmc_config(config):
    """Extract MCMC configuration from a config struct."""
    return (
        int(config["samples"].unwrap_or(1000)),
        int(config["tune"].unwrap_or(1000)),
        int(config["chains"].unwrap_or(2)),
        float(config["target_accept"].unwrap_or(0.8)),
    )


# ============================================================================
# Posterior access
# ============================================================================


def _flat_draws(idata, name: str) -> np.ndarray:
    """A posterior variable's draws merged across chains: ``(chains * draws, *shape)``."""
    values = idata.posterior[name].values
    return values.reshape(-1, *values.shape[2:])


def _thin_index(total: int, n: int) -> np.ndarray:
    """Indices of up to ``n`` draws spread evenly over ``total``.

    Deterministic thinning rather than a random subsample, so two predictions
    from one blob agree and a call never depends on numpy's global RNG.
    """
    if n >= total:
        return np.arange(total)
    return np.linspace(0, total - 1, n).round().astype(int)


def _layer_spec(model_data: dict, layer_name: str | None, func_name: str) -> dict:
    """The multi-layer spec named ``layer_name``, or the first layer."""
    specs = model_data["layer_specs"]
    if layer_name is None:
        return specs[0]
    for spec in specs:
        if spec["name"] == layer_name:
            return spec
    raise RuntimeError(f"{func_name}: layer '{layer_name}' not found")


def _posterior_predictions(
    model_data: dict, X_np: np.ndarray, layer_name: str | None, n_samples: int, func_name: str
) -> np.ndarray:
    """Per-draw predictions ``(n_draws, n_obs, n_targets)`` for any trained model.

    Up to ``n_samples`` posterior draws are used (thinned evenly). Hierarchical
    models with per-group coefficients average the groups; an L1-fallback
    multi-layer model yields its single point estimate.
    """
    model_type = model_data["model_type"]
    if model_type == "regression":
        idata = model_data["idata"]
        beta = _flat_draws(idata, "beta")
        keep = _thin_index(beta.shape[0], n_samples)
        preds = np.einsum("of,dft->dot", X_np, beta[keep])
        if model_data["include_intercept"] and "intercept" in idata.posterior:
            preds = preds + _flat_draws(idata, "intercept")[keep]  # (draws, 1, targets) broadcasts
        return preds
    if model_type == "hierarchical":
        beta = _flat_draws(model_data["idata"], "beta")
        beta = beta[_thin_index(beta.shape[0], n_samples)]
        if model_data.get("pooling", "partial") != "full":
            beta = beta.mean(axis=1)  # (draws, groups, features, targets) -> average the groups
        return np.einsum("of,dft->dot", X_np, beta)
    if model_type == "multi_layer":
        parameter = _layer_spec(model_data, layer_name, func_name)["parameter"]
        if model_data.get("method", "mcmc") == "l1_fallback":
            return (X_np @ model_data["coefficients"][parameter])[np.newaxis]
        beta = _flat_draws(model_data["idata"], parameter)
        return np.einsum("of,dft->dot", X_np, beta[_thin_index(beta.shape[0], n_samples)])
    raise RuntimeError(f"{func_name}: unknown model type '{model_type}'")


def _convergence(idata, name: str) -> tuple[np.ndarray, np.ndarray]:
    """Per-element ``(rhat, ess)`` of one posterior variable, shaped like the parameter.

    Both come from ArviZ. R-hat needs at least two chains; with one it is
    undefined and reported as NaN rather than a reassuring 1.0.
    """
    import arviz as az

    subset = idata.posterior[[name]]
    ess = np.asarray(az.ess(subset)[name].values, dtype=float)
    if idata.posterior.sizes["chain"] < 2:
        rhat = np.full(ess.shape, np.nan)
    else:
        rhat = np.asarray(az.rhat(subset)[name].values, dtype=float)
    return rhat, ess


def _rows_cols(shape: tuple[int, ...]) -> tuple[int, int]:
    """A parameter's ``(rows, cols)`` for the summary: scalars are 1x1, vectors n x 1."""
    if len(shape) == 0:
        return 1, 1
    if len(shape) == 1:
        return shape[0], 1
    return shape[0], shape[1]


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="pymc_train_regression",
    inputs=[MatrixType(FloatType), MatrixType(FloatType), PyMCRegressionConfigType],
    output=PyMCModelBlobType,
)
def pymc_train_regression(
    X: EastMatrix,
    Y: EastMatrix,
    config: EastStruct,
) -> EastVariant:
    """Fit a Bayesian linear regression model with NUTS sampling.

    Builds a PyMC model with a configurable coefficient prior and likelihood,
    samples the posterior with NUTS, and serialises the inference data into a
    ``pymc_regression`` blob for downstream prediction and diagnostics.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix,
            shape ``(n_samples, n_features)``.
        Y: ``Matrix<Float>`` (``EastMatrix``) - target matrix,
            shape ``(n_samples, n_targets)``.
        config: ``PyMCRegressionConfigType`` (``EastStruct``) with fields:

            - ``prior`` (``Option<PyMCPriorSpecType>``): coefficient prior;
              defaults to ``Normal(mu=0, sigma=10)`` when absent. Each spec has:

              - ``distribution`` (``PyMCPriorDistributionType``): one of
                ``normal``, ``halfnormal``, ``lognormal``, ``halfcauchy``,
                ``exponential``, ``uniform``, ``horseshoe``.
              - ``params`` (``PyMCPriorParamsType``): ``mu``
                (``Option<Matrix<Float>>``), ``sigma``
                (``Option<Matrix<Float>>``), ``tau`` (``Option<Float>``),
                ``lower`` / ``upper`` (``Option<Float>``).

            - ``likelihood`` (``Option<PyMCLikelihoodType>``): one of
              ``normal`` (default), ``studentt``, ``poisson``.
            - ``include_intercept`` (``Option<Boolean>``): fit a per-target
              intercept term (default ``True``).
            - ``samples`` (``Option<Integer>``): posterior draws (default 1000).
            - ``tune`` (``Option<Integer>``): warm-up steps (default 1000).
            - ``chains`` (``Option<Integer>``): parallel MCMC chains
              (default 2).
            - ``target_accept`` (``Option<Float>``): NUTS step-size target
              (default 0.8).

    Returns:
        ``PyMCModelBlobType`` (``EastVariant`` tagged ``pymc_regression``):
        ``{data: Blob (cloudpickle), n_features: Integer, n_targets: Integer,
        include_intercept: Boolean}``.

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
        RuntimeError: ``X`` and ``Y`` have different row counts or sampling
            fails.
    """
    _check_pymc_support()
    import pymc as pm

    X_np = X.to_numpy()
    Y_np = Y.to_numpy()

    if X_np.shape[0] != Y_np.shape[0]:
        raise RuntimeError(
            f"pymc_train_regression: X and Y have different sample counts - "
            f"X has {X_np.shape[0]} samples, Y has {Y_np.shape[0]} samples"
        )

    n_samples, n_features = X_np.shape
    n_targets = Y_np.shape[1]

    include_intercept = bool(config["include_intercept"].unwrap_or(True))
    prior_spec = config["prior"].unwrap_or(None)
    likelihood_tag = option_tag(config["likelihood"], "normal")
    samples, tune, chains, target_accept = _get_mcmc_config(config)

    with pm.Model():
        beta = _build_prior(pm, "beta", prior_spec, shape=(n_features, n_targets))

        if include_intercept:
            intercept = pm.Normal("intercept", mu=0, sigma=10, shape=(1, n_targets))
            mu = pm.math.dot(X_np, beta) + intercept
        else:
            mu = pm.math.dot(X_np, beta)

        _build_likelihood(pm, "obs", mu, Y_np, likelihood_tag)

        with quiet_warnings():
            idata = pm.sample(
                draws=samples,
                tune=tune,
                chains=chains,
                target_accept=target_accept,
                progressbar=False,
                return_inferencedata=True,
            )

    model_data = {
        "idata": idata,
        "model_type": "regression",
        "n_features": n_features,
        "n_targets": n_targets,
        "include_intercept": include_intercept,
    }

    return EastVariant(
        "pymc_regression",
        EastStruct(
            {
                "data": serialize(model_data),
                "n_features": n_features,
                "n_targets": n_targets,
                "include_intercept": include_intercept,
            }
        ),
    )


@platform_function(
    name="pymc_train_hierarchical",
    inputs=[
        MatrixType(FloatType),
        MatrixType(FloatType),
        VectorType(IntegerType),
        PyMCHierarchicalConfigType,
    ],
    output=PyMCModelBlobType,
)
def pymc_train_hierarchical(
    X: EastMatrix,
    Y: EastMatrix,
    groups: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Fit a hierarchical Bayesian model with group-level pooling.

    Supports three pooling modes: ``full`` (single shared coefficient),
    ``none`` (independent per-group coefficients), and ``partial`` (partial
    pooling via Normal hyperpriors on a shared mean and scale).

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix,
            shape ``(n_samples, n_features)``.
        Y: ``Matrix<Float>`` (``EastMatrix``) - target matrix,
            shape ``(n_samples, n_targets)``.
        groups: ``Vector<Integer>`` (``EastVector``) - integer group label per
            row; remapped to ``0..n_groups-1`` internally.
        config: ``PyMCHierarchicalConfigType`` (``EastStruct``) with fields:

            - ``prior`` (``Option<PyMCPriorSpecType>``): coefficient prior
              applied at the group level; defaults to
              ``Normal(mu=0, sigma=10)``. See
              :func:`pymc_train_regression` for the full prior spec.
              Ignored for ``partial`` pooling (hyperpriors are always
              ``Normal(0, 10)`` / ``HalfNormal(5)``).
            - ``likelihood`` (``Option<PyMCLikelihoodType>``): one of
              ``normal`` (default), ``studentt``, ``poisson``.
            - ``pooling`` (``Option<PyMCPoolingType>``): ``none``,
              ``partial`` (default), or ``full``.
            - ``samples`` (``Option<Integer>``): posterior draws (default 1000).
            - ``tune`` (``Option<Integer>``): warm-up steps (default 1000).
            - ``chains`` (``Option<Integer>``): parallel MCMC chains
              (default 2).
            - ``target_accept`` (``Option<Float>``): NUTS step-size target
              (default 0.8).

    Returns:
        ``PyMCModelBlobType`` (``EastVariant`` tagged ``pymc_hierarchical``):
        ``{data: Blob (cloudpickle), n_features: Integer, n_targets: Integer,
        n_groups: Integer}``.

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
        RuntimeError: row-count mismatches between ``X``, ``Y``, and
            ``groups``, or sampling fails.
    """
    _check_pymc_support()
    import pymc as pm

    X_np = X.to_numpy()
    Y_np = Y.to_numpy()
    groups_np = groups.to_numpy(dtype=np.int64)

    if X_np.shape[0] != Y_np.shape[0]:
        raise RuntimeError(
            f"pymc_train_hierarchical: X and Y have different sample counts - "
            f"X has {X_np.shape[0]} samples, Y has {Y_np.shape[0]} samples"
        )
    if X_np.shape[0] != groups_np.shape[0]:
        raise RuntimeError(
            f"pymc_train_hierarchical: X and groups have different sample counts - "
            f"X has {X_np.shape[0]} samples, groups has {groups_np.shape[0]} samples"
        )

    n_samples, n_features = X_np.shape
    n_targets = Y_np.shape[1]

    # Group labels become 0..n_groups-1 indices into the group coefficients
    unique_groups, group_idx = np.unique(groups_np, return_inverse=True)
    n_groups = len(unique_groups)
    group_map = {int(g): i for i, g in enumerate(unique_groups)}

    prior_spec = config["prior"].unwrap_or(None)
    likelihood_tag = option_tag(config["likelihood"], "normal")
    pooling_tag = option_tag(config["pooling"], "partial")
    samples, tune, chains, target_accept = _get_mcmc_config(config)

    with pm.Model():
        if pooling_tag == "full":
            # All groups share the same parameters
            beta = _build_prior(pm, "beta", prior_spec, shape=(n_features, n_targets))
            mu = pm.math.dot(X_np, beta)
        elif pooling_tag == "none":
            # Independent parameters per group
            beta = _build_prior(pm, "beta", prior_spec, shape=(n_groups, n_features, n_targets))
            # Index into group-specific betas
            mu_parts = beta[group_idx]  # (n_samples, n_features, n_targets)
            # Element-wise multiply X with group beta and sum over features
            X_expanded = X_np[:, :, np.newaxis]  # (n_samples, n_features, 1)
            mu = (X_expanded * mu_parts).sum(axis=1)  # (n_samples, n_targets)
        else:
            # Partial pooling (default)
            # Hyperpriors
            mu_beta = pm.Normal("mu_beta", mu=0, sigma=10, shape=(n_features, n_targets))
            sigma_beta = pm.HalfNormal("sigma_beta", sigma=5, shape=(n_features, n_targets))
            # Group-level parameters
            beta = pm.Normal(
                "beta",
                mu=mu_beta,
                sigma=sigma_beta,
                shape=(n_groups, n_features, n_targets),
            )
            # Index into group-specific betas
            mu_parts = beta[group_idx]
            X_expanded = X_np[:, :, np.newaxis]
            mu = (X_expanded * mu_parts).sum(axis=1)

        _build_likelihood(pm, "obs", mu, Y_np, likelihood_tag)

        with quiet_warnings():
            idata = pm.sample(
                draws=samples,
                tune=tune,
                chains=chains,
                target_accept=target_accept,
                progressbar=False,
                return_inferencedata=True,
            )

    model_data = {
        "idata": idata,
        "model_type": "hierarchical",
        "n_features": n_features,
        "n_targets": n_targets,
        "n_groups": n_groups,
        "group_map": group_map,
        "pooling": pooling_tag,
    }

    return EastVariant(
        "pymc_hierarchical",
        EastStruct(
            {
                "data": serialize(model_data),
                "n_features": n_features,
                "n_targets": n_targets,
                "n_groups": n_groups,
            }
        ),
    )


@platform_function(
    name="pymc_train_multi_layer",
    inputs=[ArrayType(PyMCNamedDataType), PyMCMultiLayerConfigType],
    output=PyMCModelBlobType,
)
def pymc_train_multi_layer(
    data: EastArray,
    config: EastStruct,
) -> EastVariant:
    """Fit a multi-layer joint Bayesian estimation model.

    Builds one linear sub-model per layer spec (``input -> output`` via a
    named coefficient matrix), assigns per-parameter priors and optional
    binary masks, then jointly samples all layers. Falls back to
    ``MultiTaskLasso`` when the total parameter count exceeds 10 000 and
    ``force_full_mcmc`` is not set.

    Args:
        data: ``Array<PyMCNamedDataType>`` (``EastArray``) - list of
            ``{name: String, data: Matrix<Float>}`` structs; each layer
            spec's ``input`` and ``output`` fields reference names from this
            list.
        config: ``PyMCMultiLayerConfigType`` (``EastStruct``) with fields:

            - ``layers`` (``Array<PyMCLayerSpecType>``): ordered list of
              layer specs. Each spec has:

              - ``name`` (``String``): identifier used for the likelihood node.
              - ``input`` (``String``): key in ``data`` for the feature matrix.
              - ``output`` (``String``): key in ``data`` for the target matrix.
              - ``parameter`` (``String``): name of the coefficient variable in
                the model (used to look up priors and masks).
              - ``likelihood`` (``Option<PyMCLikelihoodType>``): per-layer
                likelihood (defaults to ``normal``).

            - ``priors`` (``Option<Array<PyMCNamedPriorType>>``): list of
              ``{name: String, prior: PyMCPriorSpecType}``; matched to layer
              parameters by name. Missing entries use
              ``Normal(mu=0, sigma=10)``.
            - ``masks`` (``Option<Array<PyMCNamedMaskType>>``): list of
              ``{name: String, mask: Matrix<Boolean>}``; element-wise
              multiplied onto the coefficient matrix before the dot product.
            - ``samples`` (``Option<Integer>``): posterior draws (default 1000).
            - ``tune`` (``Option<Integer>``): warm-up steps (default 1000).
            - ``chains`` (``Option<Integer>``): parallel MCMC chains
              (default 2).
            - ``target_accept`` (``Option<Float>``): NUTS step-size target
              (default 0.8).
            - ``force_full_mcmc`` (``Option<Boolean>``): disable the L1
              fallback even for large models (default ``False``).
            - ``fallback_l1_alpha`` (``Option<Float>``): ``MultiTaskLasso``
              regularisation strength used when the L1 fallback triggers
              (default 0.01).

    Returns:
        ``PyMCModelBlobType`` (``EastVariant`` tagged ``pymc_multi_layer``):
        ``{data: Blob (cloudpickle), layer_names: Array<String>,
        parameter_names: Array<String>}``. The blob encodes either a
        full MCMC ``InferenceData`` or L1 point-estimate coefficients.

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
        RuntimeError: a layer's ``input`` or ``output`` name is missing from
            ``data``, or sampling / L1 fitting fails.
    """
    _check_pymc_support()
    import pymc as pm

    data_dict = {str(item["name"]): item["data"].to_numpy() for item in data}
    layer_specs = [
        {
            "name": str(layer["name"]),
            "input": str(layer["input"]),
            "output": str(layer["output"]),
            "parameter": str(layer["parameter"]),
            "likelihood": option_tag(layer["likelihood"], "normal"),
        }
        for layer in config["layers"]
    ]
    named_priors = {str(p["name"]): p["prior"] for p in config["priors"].unwrap_or([])}
    named_masks = {
        str(m["name"]): m["mask"].to_numpy(dtype=bool) for m in config["masks"].unwrap_or([])
    }

    samples, tune, chains, target_accept = _get_mcmc_config(config)
    force_full_mcmc = bool(config["force_full_mcmc"].unwrap_or(False))
    fallback_l1_alpha = float(config["fallback_l1_alpha"].unwrap_or(0.01))

    # Count total parameters
    total_params = 0
    for spec in layer_specs:
        inp = data_dict[spec["input"]]
        out = data_dict[spec["output"]]
        total_params += inp.shape[1] * out.shape[1]

    # L1 fallback for very large models
    use_l1_fallback = total_params > 10000 and not force_full_mcmc

    layer_names = [s["name"] for s in layer_specs]
    parameter_names = [s["parameter"] for s in layer_specs]

    if use_l1_fallback:
        # Use sklearn MultiTaskLasso as a fast point-estimate fallback
        from sklearn.linear_model import MultiTaskLasso

        model_data: dict[str, Any] = {
            "model_type": "multi_layer",
            "method": "l1_fallback",
            "layer_specs": layer_specs,
            "coefficients": {},
            "data_dict_shapes": {k: v.shape for k, v in data_dict.items()},
        }
        for spec in layer_specs:
            X_layer = data_dict[spec["input"]]
            Y_layer = data_dict[spec["output"]]
            lasso = MultiTaskLasso(alpha=fallback_l1_alpha)
            lasso.fit(X_layer, Y_layer)
            model_data["coefficients"][spec["parameter"]] = lasso.coef_.T  # (n_features, n_targets)
    else:
        with pm.Model():
            for spec in layer_specs:
                X_layer = data_dict[spec["input"]]
                Y_layer = data_dict[spec["output"]]
                n_feat = X_layer.shape[1]
                n_targ = Y_layer.shape[1]

                prior_spec = named_priors.get(spec["parameter"])
                beta = _build_prior(pm, spec["parameter"], prior_spec, shape=(n_feat, n_targ))

                # Apply mask if provided
                if spec["parameter"] in named_masks:
                    mask = named_masks[spec["parameter"]]
                    beta = beta * mask

                mu = pm.math.dot(X_layer, beta)
                _build_likelihood(pm, f"{spec['name']}_obs", mu, Y_layer, spec["likelihood"])

            with quiet_warnings():
                idata = pm.sample(
                    draws=samples,
                    tune=tune,
                    chains=chains,
                    target_accept=target_accept,
                    progressbar=False,
                    return_inferencedata=True,
                )

        model_data = {
            "idata": idata,
            "model_type": "multi_layer",
            "method": "mcmc",
            "layer_specs": layer_specs,
            "data_dict_shapes": {k: v.shape for k, v in data_dict.items()},
        }

    return EastVariant(
        "pymc_multi_layer",
        EastStruct(
            {
                "data": serialize(model_data),
                "layer_names": EastArray(StringType, layer_names),
                "parameter_names": EastArray(StringType, parameter_names),
            }
        ),
    )


@platform_function(
    name="pymc_predict",
    inputs=[PyMCModelBlobType, MatrixType(FloatType), PyMCPredictConfigType],
    output=MatrixType(FloatType),
)
def pymc_predict(
    model_blob: EastVariant,
    X: EastMatrix,
    config: EastStruct,
) -> EastMatrix:
    """Predict using the posterior mean of a trained PyMC model.

    Draws up to ``n_samples`` posterior parameter samples, computes
    per-draw predictions, and returns their mean. For hierarchical models
    with ``none`` or ``partial`` pooling, group-level coefficients are
    averaged across groups before prediction.

    For multi-layer models, ``layer`` selects which layer's coefficient
    matrix to use (defaults to the first layer).

    Args:
        model_blob: ``PyMCModelBlobType`` (``EastVariant``) from
            :func:`pymc_train_regression`,
            :func:`pymc_train_hierarchical`, or
            :func:`pymc_train_multi_layer`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix,
            shape ``(n_obs, n_features)``.
        config: ``PyMCPredictConfigType`` (``EastStruct``) with fields:

            - ``layer`` (``Option<String>``): multi-layer only - name of
              the layer to predict with (defaults to first layer).
            - ``n_samples`` (``Option<Integer>``): number of posterior
              draws to average over (default 100).

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - posterior mean predictions,
        shape ``(n_obs, n_targets)``.

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
        RuntimeError: named ``layer`` not found in a multi-layer model.
    """
    _check_pymc_support()

    model_data = deserialize(model_blob.value["data"])
    X_np = X.to_numpy()
    n_samples_pred = int(config["n_samples"].unwrap_or(100))
    layer_name = config["layer"].unwrap_or(None)

    preds = _posterior_predictions(model_data, X_np, layer_name, n_samples_pred, "pymc_predict")
    return EastMatrix(FloatType, preds.mean(axis=0).astype(np.float64))


@platform_function(
    name="pymc_predict_distribution",
    inputs=[PyMCModelBlobType, MatrixType(FloatType), PyMCPredictConfigType],
    output=MatrixType(FloatType),
)
def pymc_predict_distribution(
    model_blob: EastVariant,
    X: EastMatrix,
    config: EastStruct,
) -> EastMatrix:
    """Return the full posterior predictive distribution as a sample matrix.

    Unlike :func:`pymc_predict`, this function does not average across
    draws. Each row in the output corresponds to one posterior sample. Target
    dimensions are flattened into columns so the result is always 2-D.

    For multi-layer models, ``layer`` selects the coefficient to use;
    an L1-fallback model returns a single-row matrix (no posterior variation).

    Args:
        model_blob: ``PyMCModelBlobType`` (``EastVariant``) from any train
            function.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix,
            shape ``(n_obs, n_features)``.
        config: ``PyMCPredictConfigType`` (``EastStruct``) with fields:

            - ``layer`` (``Option<String>``): multi-layer only - layer name
              (defaults to first layer).
            - ``n_samples`` (``Option<Integer>``): posterior draws to return
              (default 100).

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - posterior predictive samples,
        shape ``(n_posterior_samples, n_obs * n_targets)``.

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
    """
    _check_pymc_support()
    model_data = deserialize(model_blob.value["data"])
    X_np = X.to_numpy()
    n_samples_pred = int(config["n_samples"].unwrap_or(100))
    layer_name = config["layer"].unwrap_or(None)

    preds = _posterior_predictions(
        model_data, X_np, layer_name, n_samples_pred, "pymc_predict_distribution"
    )
    # One row per posterior draw, the (obs, target) grid flattened into columns
    return EastMatrix(FloatType, preds.reshape(preds.shape[0], -1).astype(np.float64))


@platform_function(
    name="pymc_posterior_summary",
    inputs=[PyMCModelBlobType],
    output=ArrayType(PyMCParameterSummaryType),
)
def pymc_posterior_summary(
    model_blob: EastVariant,
) -> EastArray:
    """Summarise the posterior distribution for each model parameter.

    Computes per-element mean, median, standard deviation, 95% credible
    interval, R-hat, and ESS across all chains and draws. For L1-fallback
    multi-layer models, returns point estimates with ``sd=0`` and
    ``rhat=1.0``.

    Args:
        model_blob: ``PyMCModelBlobType`` (``EastVariant``) from any train
            function.

    Returns:
        ``Array<PyMCParameterSummaryType>`` (``EastArray``) - one entry per
        named parameter. Each entry is
        ``{parameter: String, shape_rows: Integer, shape_cols: Integer,
        estimates: Array<PyMCParameterEstimateType>}``. Each estimate has
        ``{index_row, index_col, mean, median, sd, ci_lower, ci_upper,
        rhat, ess}`` (all ``Float`` except integer indices).

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
    """
    _check_pymc_support()

    model_data = deserialize(model_blob.value["data"])
    model_type = model_data["model_type"]

    if model_type == "multi_layer" and model_data.get("method") == "l1_fallback":
        # Return point estimates as summary
        summaries: list[EastStruct] = []
        for param_name, coef in model_data["coefficients"].items():
            n_rows, n_cols = coef.shape
            estimates: list[EastStruct] = []
            for r in range(n_rows):
                for c in range(n_cols):
                    val = float(coef[r, c])
                    estimates.append(EastStruct({
                        "index_row": r,
                        "index_col": c,
                        "mean": val,
                        "median": val,
                        "sd": 0.0,
                        "ci_lower": val,
                        "ci_upper": val,
                        "rhat": 1.0,
                        "ess": 0.0,
                    }))
            summaries.append(EastStruct({
                "parameter": param_name,
                "shape_rows": n_rows,
                "shape_cols": n_cols,
                "estimates": EastArray(PyMCParameterEstimateType, estimates),
            }))
        return EastArray(PyMCParameterSummaryType, summaries)

    idata = model_data["idata"]
    summaries = []
    for var_name in idata.posterior.data_vars:
        draws = _flat_draws(idata, var_name)  # (chains * draws, *shape)
        shape = draws.shape[1:]
        with quiet_warnings():
            rhat, ess = _convergence(idata, var_name)
        n_rows, n_cols = _rows_cols(shape)

        estimates = []
        for r in range(n_rows):
            for c in range(n_cols):
                # A parameter with more than two dims (a hierarchical beta is
                # groups x features x targets) is summarised over its trailing
                # dims per (row, col): the worst R-hat and the smallest ESS.
                if len(shape) == 0:
                    samples, rhat_rc, ess_rc = draws, rhat, ess
                elif len(shape) == 1:
                    samples, rhat_rc, ess_rc = draws[:, r], rhat[r], ess[r]
                else:
                    samples, rhat_rc, ess_rc = draws[:, r, c], rhat[r, c], ess[r, c]
                estimates.append(
                    EastStruct(
                        {
                            "index_row": r,
                            "index_col": c,
                            "mean": float(np.mean(samples)),
                            "median": float(np.median(samples)),
                            "sd": float(np.std(samples)),
                            "ci_lower": float(np.percentile(samples, 2.5)),
                            "ci_upper": float(np.percentile(samples, 97.5)),
                            "rhat": _nan_extreme(rhat_rc, np.nanmax),
                            "ess": _nan_extreme(ess_rc, np.nanmin),
                        }
                    )
                )

        summaries.append(
            EastStruct(
                {
                    "parameter": var_name,
                    "shape_rows": n_rows,
                    "shape_cols": n_cols,
                    "estimates": EastArray(PyMCParameterEstimateType, estimates),
                }
            )
        )

    return EastArray(PyMCParameterSummaryType, summaries)


def _nan_extreme(values: np.ndarray, reduce) -> float:
    """``reduce`` (``np.nanmax`` / ``np.nanmin``) over ``values``; NaN when every entry is NaN."""
    values = np.asarray(values, dtype=float)
    if np.all(np.isnan(values)):
        return float("nan")
    return float(reduce(values))


@platform_function(
    name="pymc_posterior_samples",
    inputs=[PyMCModelBlobType, StringType, IntegerType],
    output=MatrixType(FloatType),
)
def pymc_posterior_samples(
    model_blob: EastVariant,
    param_name: str,
    n_samples: int,
) -> EastMatrix:
    """Extract raw posterior samples for a named parameter as a flat matrix.

    Takes up to ``n_samples`` draws spread evenly over the merged chain-draw
    pool (every draw when ``n_samples`` is at least the pool size).
    Parameter dimensions beyond the first are flattened into columns.

    For L1-fallback multi-layer models, ``n_samples`` identical rows are
    returned (coefficient has no posterior variation).

    Args:
        model_blob: ``PyMCModelBlobType`` (``EastVariant``) from any train
            function.
        param_name: ``String`` - name of the posterior variable to extract
            (e.g. ``"beta"``, ``"intercept"``).
        n_samples: ``Integer`` - number of posterior rows to return.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - shape
        ``(n_samples, prod(param_shape))``.

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
        RuntimeError: ``param_name`` is not present in the model's posterior.
    """
    _check_pymc_support()
    model_data = deserialize(model_blob.value["data"])
    param_name = str(param_name)
    n_samples = int(n_samples)

    model_type = model_data["model_type"]

    if model_type == "multi_layer" and model_data.get("method") == "l1_fallback":
        if param_name in model_data["coefficients"]:
            coef = model_data["coefficients"][param_name]
            # Return n_samples identical rows (no posterior variation)
            result = np.tile(coef.ravel(), (n_samples, 1))
            return EastMatrix(FloatType, result.astype(np.float64))
        raise RuntimeError(f"pymc_posterior_samples: parameter '{param_name}' not found")

    idata = model_data["idata"]

    if param_name not in idata.posterior:
        raise RuntimeError(
            f"pymc_posterior_samples: parameter '{param_name}' not found in posterior. "
            f"Available: {list(idata.posterior.data_vars)}"
        )

    flat = _flat_draws(idata, param_name)
    selected = flat[_thin_index(flat.shape[0], n_samples)]
    # Flatten parameter dims to columns
    return EastMatrix(FloatType, selected.reshape(selected.shape[0], -1).astype(np.float64))


@platform_function(
    name="pymc_diagnostics",
    inputs=[PyMCModelBlobType],
    output=PyMCDiagnosticsResultType,
)
def pymc_diagnostics(
    model_blob: EastVariant,
) -> EastStruct:
    """Run MCMC convergence diagnostics on a trained model.

    Reports per-parameter R-hat (convergence) and ESS (effective sample
    size) from ArviZ, counts divergent transitions from ``sample_stats``,
    and sets ``converged=True`` only when all R-hat values are below 1.1 and
    there are no divergences. R-hat needs at least two chains: a single-chain
    model reports ``rhat_max`` as NaN with a warning, and is not judged
    non-converged on that basis. L1-fallback models always return
    ``converged=True`` with an explanatory warning.

    Args:
        model_blob: ``PyMCModelBlobType`` (``EastVariant``) from any train
            function.

    Returns:
        ``PyMCDiagnosticsResultType`` (``EastStruct``):

        - ``converged`` (``Boolean``): all R-hat < 1.1 and no divergences.
        - ``n_divergences`` (``Integer``): total divergent NUTS transitions.
        - ``parameters`` (``Array<PyMCParameterDiagType>``): one entry per
          variable with ``{parameter: String, rhat_max: Float,
          ess_min: Float, n_divergent: Integer}``.
        - ``warnings`` (``Array<String>``): human-readable convergence
          issues (one per non-converged parameter plus one for divergences).

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
    """
    _check_pymc_support()

    model_data = deserialize(model_blob.value["data"])

    if model_data.get("method") == "l1_fallback":
        return EastStruct({
            "converged": True,
            "n_divergences": 0,
            "parameters": EastArray(PyMCParameterDiagType, []),
            "warnings": EastArray(StringType, ["L1 fallback used - no MCMC diagnostics available"]),
        })

    idata = model_data["idata"]

    # Check divergences
    n_divergences = 0
    if hasattr(idata, "sample_stats") and "diverging" in idata.sample_stats:
        n_divergences = int(idata.sample_stats["diverging"].values.sum())

    param_diags: list[EastStruct] = []
    all_converged = True
    warn_messages: list[str] = []
    if idata.posterior.sizes["chain"] < 2:
        warn_messages.append("R-hat is undefined with a single chain; sample at least 2 chains")

    for var_name in idata.posterior.data_vars:
        with quiet_warnings():
            rhat, ess = _convergence(idata, var_name)
        rhat_max = _nan_extreme(rhat, np.nanmax)
        ess_min = _nan_extreme(ess, np.nanmin)

        if rhat_max > 1.1:
            all_converged = False
            warn_messages.append(f"Parameter '{var_name}' has rhat={rhat_max:.3f} > 1.1")

        param_diags.append(
            EastStruct(
                {
                    "parameter": var_name,
                    "rhat_max": rhat_max,
                    "ess_min": ess_min,
                    "n_divergent": n_divergences,
                }
            )
        )

    if n_divergences > 0:
        warn_messages.append(f"{n_divergences} divergent transitions detected")

    return EastStruct({
        "converged": all_converged and n_divergences == 0,
        "n_divergences": n_divergences,
        "parameters": EastArray(PyMCParameterDiagType, param_diags),
        "warnings": EastArray(StringType, warn_messages),
    })


@platform_function(
    name="pymc_posterior_predictive_check",
    inputs=[PyMCModelBlobType, MatrixType(FloatType), MatrixType(FloatType)],
    output=ArrayType(PyMCObservedFitType),
)
def pymc_posterior_predictive_check(
    model_blob: EastVariant,
    X: EastMatrix,
    Y_observed: EastMatrix,
) -> EastArray:
    """Compare posterior predictive distribution against observed targets.

    Draws up to 100 posterior samples, computes per-target MAE, Pearson
    correlation, and 95% predictive interval coverage. For L1-fallback
    multi-layer models, uses the first layer's point-estimate coefficient.

    Args:
        model_blob: ``PyMCModelBlobType`` (``EastVariant``) from any train
            function.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix used for
            prediction, shape ``(n_obs, n_features)``.
        Y_observed: ``Matrix<Float>`` (``EastMatrix``) - observed targets to
            compare against, shape ``(n_obs, n_targets)``.

    Returns:
        ``Array<PyMCObservedFitType>`` (``EastArray``) - one entry per target
        column, each ``{name: String ("target_<t>"), mae: Float,
        correlation: Float, coverage_95: Float}``.

    Raises:
        NotImplementedError: the ``pymc`` extra is not installed.
    """
    _check_pymc_support()
    model_data = deserialize(model_blob.value["data"])
    X_np = X.to_numpy()
    Y_np = Y_observed.to_numpy()
    n_targets = Y_np.shape[1]

    # (draws, obs, targets); a multi-layer model is checked on its first layer
    Y_pred_expanded = _posterior_predictions(
        model_data, X_np, None, 100, "pymc_posterior_predictive_check"
    )

    # Compute per-target metrics
    results: list[EastStruct] = []
    Y_pred_mean = Y_pred_expanded.mean(axis=0)  # (n_obs, n_targets)

    for t in range(n_targets):
        y_true = Y_np[:, t]
        y_pred_mean = Y_pred_mean[:, t]

        # MAE
        mae = float(np.mean(np.abs(y_true - y_pred_mean)))

        # Correlation
        if np.std(y_true) > 1e-10 and np.std(y_pred_mean) > 1e-10:
            corr = float(np.corrcoef(y_true, y_pred_mean)[0, 1])
            if np.isnan(corr):
                corr = 0.0
        else:
            corr = 0.0

        # 95% coverage
        if Y_pred_expanded.shape[0] > 1:
            lower = np.percentile(Y_pred_expanded[:, :, t], 2.5, axis=0)
            upper = np.percentile(Y_pred_expanded[:, :, t], 97.5, axis=0)
            covered = np.sum((y_true >= lower) & (y_true <= upper))
            coverage = float(covered) / float(len(y_true))
        else:
            coverage = 0.0

        results.append(EastStruct({
            "name": f"target_{t}",
            "mae": mae,
            "correlation": corr,
            "coverage_95": coverage,
        }))

    return EastArray(PyMCObservedFitType, results)


# ============================================================================
# Platform Function Registration
# ============================================================================

# Collected from the @platform_function decorations above.
pymc_impl = platform_functions(__name__)

__all__ = [
    "pymc_impl",
]
