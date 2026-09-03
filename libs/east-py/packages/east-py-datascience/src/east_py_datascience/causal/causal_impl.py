#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Causal inference implementation.

Backdoor-adjusted effect estimation and refutation (DoWhy), heterogeneous
treatment effects via double machine learning (EconML LinearDML), and
accumulated local effects dose-response curves (PyALE).
"""

import logging
import math
from typing import Any

import numpy as np
from east import assert_value_of, none, some, variant
from east.runtime.platform import generic_platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    VectorType,
)
from east.types.values import EastArray, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience._common import deserialize, extra_guard, serialize

# ============================================================================
# Type Definitions for Causal
# ============================================================================

CausalWeightingSchemeType = VariantType(
    [
        ("ips_weight", NullType),
        ("ips_stabilized_weight", NullType),
        ("ips_normalized_weight", NullType),
    ]
)
"""Inverse propensity weighting scheme for the propensity score weighting estimator.

Cases: ``ips_weight`` (raw inverse propensity weights),
``ips_stabilized_weight`` (recommended - lower variance),
``ips_normalized_weight``.
"""

CausalEstimatorType = VariantType(
    [
        ("linear_regression", NullType),
        (
            "propensity_score_weighting",
            StructType([("weighting_scheme", OptionType(CausalWeightingSchemeType))]),
        ),
    ]
)
"""Backdoor-adjusted effect estimator.

Cases: ``linear_regression`` (outcome on treatment + common causes), or
``propensity_score_weighting`` (binary treatment only) with an optional
``weighting_scheme`` (default ``ips_stabilized_weight``).
"""

CausalTargetUnitsType = VariantType(
    [
        ("ate", NullType),
        ("att", NullType),
        ("atc", NullType),
    ]
)
"""Population the effect is estimated for.

Cases: ``ate`` (all units), ``att`` (the treated), ``atc`` (the controls).
"""

CausalSignType = VariantType(
    [
        ("positive", NullType),
        ("negative", NullType),
    ]
)
"""Directional prior on the effect (the ``expected_sign`` guard).

Cases: ``positive`` (expected to increase the outcome), ``negative`` (decrease).
twin: causal.ts ``CausalSignType`` / e3-ui ``SignType``.
"""

PropensityTrimType = VariantType(
    [
        ("overlap", NullType),
        ("bounds", StructType([("lower", FloatType), ("upper", FloatType)])),
    ]
)
"""Propensity-based sample trimming applied before estimation (psw only).

Cases: ``overlap`` (keep units inside the common support of treated and
control propensities), or ``bounds`` ``{lower, upper}`` (explicit propensity
score bounds).
"""

CausalBootstrapConfigType = StructType(
    [
        ("reps", IntegerType),
        ("cluster_column", OptionType(StringType)),
        ("confidence_level", OptionType(FloatType)),
    ]
)
"""Bootstrap confidence interval configuration.

Fields: ``reps`` (replicates), ``cluster_column`` (resample whole clusters
of this column's values - use when rows are autocorrelated within a group;
default resamples rows), ``confidence_level`` (default 0.95).
"""

CausalEffectConfigType = StructType(
    [
        ("treatment", StringType),
        ("outcome", StringType),
        ("common_causes", ArrayType(StringType)),
        ("categorical", OptionType(ArrayType(StringType))),
        ("method", OptionType(CausalEstimatorType)),
        ("target_units", OptionType(CausalTargetUnitsType)),
        ("trim", OptionType(PropensityTrimType)),
        ("bootstrap", OptionType(CausalBootstrapConfigType)),
        ("random_state", OptionType(IntegerType)),
    ]
)
"""Configuration for backdoor-adjusted causal effect estimation.

The data is an ``Array<Struct>`` whose struct fields ARE the columns; every
column referenced by ``treatment``, ``outcome``, ``common_causes``,
``categorical`` and ``bootstrap.cluster_column`` must be a field of that
struct. Fields: ``treatment`` (0/1 for psw), ``outcome``, ``common_causes``
(backdoor set — empty means the unadjusted/naive estimate; psw still requires
at least one), ``categorical`` (integer-coded columns, one-hot encoded
internally), ``method`` (default ``linear_regression``), ``target_units``
(default ``ate``), ``trim`` (psw only), ``bootstrap``, ``random_state``.
"""

CausalRefuterType = VariantType(
    [
        ("placebo_treatment", StructType([("num_simulations", OptionType(IntegerType))])),
        ("random_common_cause", StructType([("num_simulations", OptionType(IntegerType))])),
        (
            "data_subset",
            StructType(
                [
                    ("subset_fraction", OptionType(FloatType)),
                    ("num_simulations", OptionType(IntegerType)),
                ]
            ),
        ),
        (
            "unobserved_common_cause",
            StructType([("effect_strengths", ArrayType(FloatType))]),
        ),
    ]
)
"""Refutation test for an estimated causal effect.

Cases: ``placebo_treatment`` ``{num_simulations (100)}`` (effect should
vanish), ``random_common_cause`` ``{num_simulations (100)}`` (effect should
be unchanged), ``data_subset`` ``{subset_fraction (0.8), num_simulations
(100)}`` (effect should be stable), ``unobserved_common_cause``
``{effect_strengths}`` (simulated hidden confounder per strength - a
tipping curve).
"""

CausalNuisanceModelType = VariantType(
    [
        (
            "random_forest",
            StructType(
                [
                    ("n_estimators", OptionType(IntegerType)),
                    ("min_samples_leaf", OptionType(IntegerType)),
                    ("max_depth", OptionType(IntegerType)),
                ]
            ),
        ),
        (
            "gradient_boosting",
            StructType(
                [
                    ("n_estimators", OptionType(IntegerType)),
                    ("learning_rate", OptionType(FloatType)),
                    ("max_depth", OptionType(IntegerType)),
                ]
            ),
        ),
        ("linear", NullType),
    ]
)
"""Nuisance model for DML residualization stages.

Cases: ``random_forest`` ``{n_estimators (100), min_samples_leaf (5),
max_depth}``, ``gradient_boosting`` ``{n_estimators (100), learning_rate
(0.1), max_depth (3)}``, or ``linear`` (linear/logistic regression).
Classifier variants are used for the treatment stage when the treatment is
discrete.
"""

CausalDMLConfigType = StructType(
    [
        ("model_y", OptionType(CausalNuisanceModelType)),
        ("model_t", OptionType(CausalNuisanceModelType)),
        ("discrete_treatment", OptionType(BooleanType)),
        ("cv_folds", OptionType(IntegerType)),
        ("confidence_level", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
    ]
)
"""Configuration for double machine learning (EconML LinearDML).

Fields: ``model_y`` / ``model_t`` (default ``random_forest``),
``discrete_treatment`` (default false), ``cv_folds`` (cross-fitting folds,
default 2), ``confidence_level`` (for effect/ATE intervals, default 0.95),
``random_state``.
"""

CausalALEConfigType = StructType(
    [
        ("outcome", StringType),
        ("feature", StringType),
        ("categorical", OptionType(ArrayType(StringType))),
        ("grid_size", OptionType(IntegerType)),
        ("include_ci", OptionType(BooleanType)),
        ("confidence_level", OptionType(FloatType)),
        (
            "emulator",
            OptionType(
                StructType(
                    [
                        ("n_estimators", OptionType(IntegerType)),
                        ("learning_rate", OptionType(FloatType)),
                        ("max_depth", OptionType(IntegerType)),
                        ("min_samples_leaf", OptionType(IntegerType)),
                    ]
                )
            ),
        ),
        ("random_state", OptionType(IntegerType)),
    ]
)
"""Configuration for an accumulated local effects (ALE) dose-response curve.

The data is an ``Array<Struct>`` whose struct fields ARE the columns.
Fields: ``outcome`` (emulator target), ``feature`` (continuous
column for the curve), ``categorical`` (integer-coded columns, one-hot
encoded internally), ``grid_size`` (default 10), ``include_ci`` (default
true), ``confidence_level`` (default 0.95), ``emulator``
(HistGradientBoosting ``{n_estimators (300), learning_rate (0.05),
max_depth, min_samples_leaf}``), ``random_state``.
"""

CausalDMLModelBlobType = VariantType(
    [
        (
            "causal_dml",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features_x", IntegerType),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
    ]
)
"""Model blob for a fitted LinearDML estimator.

Single case ``causal_dml``: ``data`` (cloudpickled estimator),
``n_features_x`` (effect-modifier feature count), ``confidence_level``
(used for effect/ATE intervals).
"""

CiType = StructType([("lower", FloatType), ("upper", FloatType)])
"""A confidence interval — the one CI type shared by the effect and experiment results."""

CausalEffectResultType = StructType(
    [
        ("effect", FloatType),
        ("ci", OptionType(CiType)),
        ("n_samples", IntegerType),
        ("n_treated", IntegerType),
        ("n_control", IntegerType),
    ]
)
"""Estimated causal effect.

Fields: ``effect`` (outcome units per treatment unit), ``ci`` (bootstrap
percentile interval, present when bootstrap configured), ``n_samples`` /
``n_treated`` / ``n_control`` (rows used, after trimming).
"""

CausalRefuteResultType = StructType(
    [
        ("estimated_effect", FloatType),
        ("new_effects", VectorType(FloatType)),
        ("p_value", OptionType(FloatType)),
    ]
)
"""Refutation test result.

Fields: ``estimated_effect`` (the original estimate), ``new_effects`` (one
entry, or one per strength for ``unobserved_common_cause``), ``p_value``
(where the refuter provides one).
"""

CausalATEResultType = StructType(
    [
        ("ate", FloatType),
        ("lower", FloatType),
        ("upper", FloatType),
    ]
)
"""Average treatment effect with confidence interval.

Fields: ``ate`` plus ``lower`` / ``upper`` bounds at the model's
confidence level.
"""

ALEResultType = StructType(
    [
        ("grid", VectorType(FloatType)),
        ("effect", VectorType(FloatType)),
        ("lower", OptionType(VectorType(FloatType))),
        ("upper", OptionType(VectorType(FloatType))),
        ("size", VectorType(IntegerType)),
    ]
)
"""Accumulated local effects curve.

Fields: ``grid`` (feature grid values), ``effect`` (centered ALE effect per
grid value), ``lower`` / ``upper`` (CIs, present when ``include_ci``),
``size`` (samples per grid interval).
"""


# ============================================================================
# Optional Dependency Guards
# ============================================================================

# The `causal` extra bundles four libraries; each entry point guards the one
# it actually needs, so a partial install fails naming the right capability.
_check_dowhy_support = extra_guard("dowhy", "causal", "Causal effect estimation")
_check_econml_support = extra_guard("econml", "causal", "DML estimation")
_check_pyale_support = extra_guard("PyALE", "causal", "ALE curve")
_check_statsmodels_support = extra_guard("statsmodels", "causal", "Trial-design power analysis")


# ============================================================================
# Data Preparation Helpers
# ============================================================================


def _build_dataframe(data: EastArray, func_name: str):
    """Build a pandas DataFrame from an array of row structs (fields = columns)."""
    import pandas as pd

    records = [dict(row.items()) for row in data]
    if not records:
        raise RuntimeError(f"{func_name}: data must have at least one row")
    df = pd.DataFrame.from_records(records)
    # A boolean column (e.g. a yes/no treatment) becomes 0/1 so the estimators
    # see a numeric; categorical string columns are one-hot encoded downstream.
    for col in df.columns:
        if df[col].dtype == bool:
            df[col] = df[col].astype(int)
    return df


def _require_columns(df, needed: list, func_name: str) -> None:
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise RuntimeError(f"{func_name}: column(s) {missing} not found in columns")


def _encode_categoricals(df, categorical: list, protected: list, func_name: str):
    """One-hot encode categorical columns, returning (df, name_expansion map)."""
    import pandas as pd

    if not categorical:
        return df, {}
    for c in categorical:
        if c in protected:
            raise RuntimeError(
                f"{func_name}: column '{c}' cannot be categorical "
                f"(treatment/outcome/feature must be numeric)"
            )
    _require_columns(df, categorical, func_name)
    before = set(df.columns)
    df = pd.get_dummies(df, columns=categorical, drop_first=True, dtype=float)
    after = set(df.columns)
    expansion = {
        c: sorted(col for col in after - before if col.startswith(f"{c}_"))
        for c in categorical
    }
    return df, expansion


def _expand_causes(common_causes: list, expansion: dict) -> list:
    expanded = []
    for c in common_causes:
        expanded.extend(expansion.get(c, [c]))
    return expanded


def _propensity_scores(df, treatment: str, causes: list, random_state):
    """Fit a logistic propensity model P(treated | causes)."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, random_state=random_state),
    )
    model.fit(df[causes].to_numpy(), df[treatment].to_numpy().astype(int))
    return model.predict_proba(df[causes].to_numpy())[:, 1]


def _apply_trim(df, treatment: str, causes: list, trim_variant, random_state, func_name: str):
    """Trim rows by propensity score (overlap or explicit bounds)."""
    ps = _propensity_scores(df, treatment, causes, random_state)
    t = df[treatment].to_numpy() > 0.5
    if trim_variant.type == "overlap":
        if t.sum() == 0 or (~t).sum() == 0:
            raise RuntimeError(f"{func_name}: overlap trim requires both treated and control rows")
        lower = max(ps[t].min(), ps[~t].min())
        upper = min(ps[t].max(), ps[~t].max())
    else:
        bounds = trim_variant.value
        lower = float(bounds.get("lower"))
        upper = float(bounds.get("upper"))
    keep = (ps >= lower) & (ps <= upper)
    if keep.sum() == 0:
        raise RuntimeError(f"{func_name}: propensity trimming removed all rows")
    return df.loc[keep].reset_index(drop=True)


def _validate_binary_treatment(df, treatment: str, func_name: str) -> None:
    values = set(np.unique(df[treatment].to_numpy()))
    if not values <= {0.0, 1.0}:
        raise RuntimeError(
            f"{func_name}: propensity score weighting requires a binary 0/1 "
            f"treatment, but '{treatment}' has values {sorted(values)[:5]}"
        )


def _manual_effect(df, treatment: str, outcome: str, causes: list, method_tag: str,
                   target_units: str, random_state) -> float:
    """Fast effect estimate used inside the bootstrap loop.

    Matches the dowhy estimators: OLS treatment coefficient for
    linear_regression, Hajek-weighted IPW mean difference for
    propensity_score_weighting (the stabilizing constant cancels in the
    Hajek ratio, so all schemes coincide here).
    """
    y = df[outcome].to_numpy(dtype=np.float64)
    if method_tag == "linear_regression":
        t_col = df[treatment].to_numpy(dtype=np.float64)
        X = np.column_stack(
            [np.ones(len(df)), t_col, df[causes].to_numpy(dtype=np.float64)]
        )
        coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        return float(coef[1])

    ps = np.clip(
        _propensity_scores(df, treatment, causes, random_state), 1e-3, 1 - 1e-3
    )
    t = df[treatment].to_numpy() > 0.5
    if target_units == "att":
        w_c = ps[~t] / (1 - ps[~t])
        return float(y[t].mean() - (w_c * y[~t]).sum() / w_c.sum())
    if target_units == "atc":
        w_t = (1 - ps[t]) / ps[t]
        return float((w_t * y[t]).sum() / w_t.sum() - y[~t].mean())
    w_t = 1 / ps[t]
    w_c = 1 / (1 - ps[~t])
    return float((w_t * y[t]).sum() / w_t.sum() - (w_c * y[~t]).sum() / w_c.sum())


def _extract_effect_config(config: EastStruct, func_name: str):
    """Parse CausalEffectConfigType into plain Python values."""
    treatment = str(config.get("treatment"))
    outcome = str(config.get("outcome"))
    common_causes = [str(c) for c in config.get("common_causes")]
    categorical_opt = config["categorical"].unwrap_or(None)
    categorical = [str(c) for c in categorical_opt] if categorical_opt is not None else []
    method_variant = config["method"].unwrap_or(None)
    method_tag = "linear_regression" if method_variant is None else method_variant.type
    scheme = "ips_stabilized_weight"
    if method_tag == "propensity_score_weighting":
        scheme_opt = method_variant.value["weighting_scheme"].unwrap_or(None)
        if scheme_opt is not None:
            scheme = scheme_opt.type
    target_variant = config["target_units"].unwrap_or(None)
    target_units = "ate" if target_variant is None else target_variant.type
    trim_variant = config["trim"].unwrap_or(None)
    bootstrap = config["bootstrap"].unwrap_or(None)
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)
    # An empty backdoor set is the unadjusted ("naive") estimate — a legitimate
    # baseline (e.g. the before-adjustment comparison the Experiment surface
    # shows). Propensity weighting is the exception: it fits a propensity model
    # from the covariates, so it genuinely requires at least one.
    if not common_causes and method_tag == "propensity_score_weighting":
        raise RuntimeError(
            f"{func_name}: propensity_score_weighting requires at least one common cause"
        )
    return (
        treatment, outcome, common_causes, categorical,
        method_tag, scheme, target_units, trim_variant, bootstrap, random_state,
    )


def _prepare_effect_data(data: EastArray, config: EastStruct, func_name: str):
    """Shared data preparation for causal_effect and causal_refute.

    Returns (df, causes, method_tag, scheme, target_units, bootstrap, random_state).
    Trimming is already applied to the returned df.
    """
    (
        treatment, outcome, common_causes, categorical,
        method_tag, scheme, target_units, trim_variant, bootstrap, random_state,
    ) = _extract_effect_config(config, func_name)

    df = _build_dataframe(data, func_name)
    _require_columns(df, [treatment, outcome] + common_causes, func_name)
    df, expansion = _encode_categoricals(df, categorical, [treatment, outcome], func_name)
    causes = _expand_causes(common_causes, expansion)

    if method_tag == "propensity_score_weighting":
        _validate_binary_treatment(df, treatment, func_name)
        df[treatment] = df[treatment].astype(int)
        if trim_variant is not None:
            df = _apply_trim(df, treatment, causes, trim_variant, random_state, func_name)
    elif trim_variant is not None:
        raise RuntimeError(
            f"{func_name}: trim is only supported with propensity_score_weighting"
        )

    return df, treatment, outcome, causes, method_tag, scheme, target_units, bootstrap, random_state


def _dowhy_estimate(df, treatment: str, outcome: str, causes: list,
                    method_tag: str, scheme: str, target_units: str, func_name: str):
    """Run dowhy identify + estimate; returns (model, identified, estimate)."""
    from dowhy import CausalModel

    for name in ("dowhy", "dowhy.causal_model", "dowhy.causal_estimator"):
        logging.getLogger(name).setLevel(logging.ERROR)

    model = CausalModel(
        data=df,
        treatment=treatment,
        outcome=outcome,
        common_causes=causes,
    )
    identified = model.identify_effect(proceed_when_unidentifiable=True)
    if method_tag == "linear_regression":
        estimate = model.estimate_effect(
            identified,
            method_name="backdoor.linear_regression",
            target_units=target_units,
        )
    else:
        estimate = model.estimate_effect(
            identified,
            method_name="backdoor.propensity_score_weighting",
            target_units=target_units,
            method_params={"weighting_scheme": scheme},
        )
    if estimate.value is None:
        raise RuntimeError(f"{func_name}: dowhy returned no effect estimate")
    return model, identified, estimate


def _bootstrap_ci(df, treatment, outcome, causes, method_tag, target_units,
                  bootstrap: EastStruct, random_state):
    """Percentile bootstrap CI, resampling clusters when configured."""
    reps = int(bootstrap.get("reps"))
    cluster_column = bootstrap["cluster_column"].unwrap_or(None)
    confidence_level = float(bootstrap["confidence_level"].unwrap_or(0.95))
    rng = np.random.default_rng(random_state)

    estimates = []
    if cluster_column is not None:
        cluster_column = str(cluster_column)
        groups = dict(iter(df.groupby(cluster_column)))
        keys = list(groups)
        for _ in range(reps):
            import pandas as pd

            picked = rng.choice(len(keys), size=len(keys), replace=True)
            sample = pd.concat([groups[keys[i]] for i in picked], ignore_index=True)
            try:
                estimates.append(
                    _manual_effect(sample, treatment, outcome, causes,
                                   method_tag, target_units, random_state)
                )
            except Exception:
                continue
    else:
        n = len(df)
        for _ in range(reps):
            sample = df.iloc[rng.choice(n, size=n, replace=True)].reset_index(drop=True)
            try:
                estimates.append(
                    _manual_effect(sample, treatment, outcome, causes,
                                   method_tag, target_units, random_state)
                )
            except Exception:
                continue

    if len(estimates) < max(10, reps // 2):
        raise RuntimeError(
            f"causal_effect: bootstrap produced only {len(estimates)}/{reps} "
            f"valid replicates"
        )
    alpha = 1 - confidence_level
    lower, upper = np.percentile(estimates, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    return float(lower), float(upper)


# ============================================================================
# Effect Estimation
# ============================================================================


def causal_effect_impl(data: EastArray, config: EastStruct) -> EastStruct:
    """Estimate a backdoor-adjusted causal effect of treatment on outcome.

    Identifies the effect with DoWhy given the common causes, then estimates
    it by linear regression or inverse propensity score weighting, optionally
    trimming to propensity common support and attaching a (cluster) bootstrap
    percentile confidence interval.

    Args:
        data: ``Array<Struct>`` (``EastArray`` of ``EastStruct``) - one struct
            per unit; the struct's fields ARE the columns.
        config: ``CausalEffectConfigType`` (``EastStruct``) with fields:

            - ``treatment`` (``String``): treatment column; must hold 0/1 for
              propensity score weighting.
            - ``outcome`` (``String``): outcome column.
            - ``common_causes`` (``Array<String>``): confounders to adjust for;
              empty means the unadjusted/naive estimate (psw still requires at
              least one).
            - ``categorical`` (``Option<Array<String>>``): columns holding
              integer category codes, one-hot encoded internally.
            - ``method`` (``Option<CausalEstimatorType>``): ``linear_regression``
              (default) or ``propensity_score_weighting`` with an optional
              ``weighting_scheme`` (``ips_stabilized_weight`` default).
            - ``target_units`` (``Option``): ``ate`` (default), ``att``, ``atc``.
            - ``trim`` (``Option<PropensityTrimType>``): ``overlap`` common
              support, or explicit ``bounds`` ``{lower, upper}`` (psw only).
            - ``bootstrap`` (``Option``): ``{reps, cluster_column, confidence_level}``
              - resamples whole clusters when ``cluster_column`` is set
              (confidence_level default 0.95).
            - ``random_state`` (``Option<Integer>``): seed for propensity
              fitting and bootstrap resampling.

    Returns:
        ``CausalEffectResultType`` (``EastStruct``): ``effect`` (``Float``),
        ``ci`` (``Option<{lower, upper}>``, present when bootstrap configured),
        ``n_samples`` / ``n_treated`` / ``n_control`` (``Integer``, after
        trimming).

    Raises:
        NotImplementedError: the ``causal`` extra is not installed.
        RuntimeError: column/config mismatch, non-binary treatment for psw,
            trimming removed all rows, or DoWhy estimation failure.
    """
    _check_dowhy_support()
    func_name = "causal_effect"

    df, treatment, outcome, causes, method_tag, scheme, target_units, bootstrap, random_state = (
        _prepare_effect_data(data, config, func_name)
    )

    try:
        _, _, estimate = _dowhy_estimate(
            df, treatment, outcome, causes, method_tag, scheme, target_units, func_name
        )
        effect = float(estimate.value)
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"{func_name}: Estimation failed - {e}") from e

    ci_variant = none
    if bootstrap is not None:
        try:
            lower, upper = _bootstrap_ci(
                df, treatment, outcome, causes, method_tag, target_units,
                bootstrap, random_state,
            )
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"{func_name}: Bootstrap failed - {e}") from e
        ci_variant = some(EastStruct({"lower": lower, "upper": upper}))

    t = df[treatment].to_numpy() > 0.5
    return EastStruct(
        {
            "effect": effect,
            "ci": ci_variant,
            "n_samples": len(df),
            "n_treated": int(t.sum()),
            "n_control": int((~t).sum()),
        }
    )


def causal_refute_impl(
    data: EastArray, config: EastStruct, refuter: EastVariant
) -> EastStruct:
    """Refute an estimated causal effect with a DoWhy refutation test.

    Re-runs the estimation from ``config`` (same semantics as
    :func:`causal_effect_impl`, bootstrap ignored), then applies the refuter.

    Args:
        data: ``Array<Struct>`` (``EastArray`` of ``EastStruct``) - one struct
            per unit; the struct's fields ARE the columns.
        config: ``CausalEffectConfigType`` - see :func:`causal_effect_impl`.
        refuter: ``CausalRefuterType`` (``EastVariant``), one of:

            - ``placebo_treatment`` ``{num_simulations}``: permute the
              treatment - the effect should vanish.
            - ``random_common_cause`` ``{num_simulations}``: add an
              independent random confounder - the effect should be unchanged.
            - ``data_subset`` ``{subset_fraction (default 0.8), num_simulations}``:
              re-estimate on random subsets - the effect should be stable.
            - ``unobserved_common_cause`` ``{effect_strengths}``: simulate a
              hidden confounder at each strength (flip probability for a
              binary treatment, linear coefficient otherwise; linear on the
              outcome) - one refuted effect per strength (a tipping curve).

    Returns:
        ``CausalRefuteResultType`` (``EastStruct``): ``estimated_effect``
        (``Float``), ``new_effects`` (``Vector<Float>`` - one entry, or one
        per strength for ``unobserved_common_cause``), ``p_value``
        (``Option<Float>`` where the refuter provides one).

    Raises:
        NotImplementedError: the ``causal`` extra is not installed.
        RuntimeError: estimation or refutation failure.
    """
    _check_dowhy_support()
    func_name = "causal_refute"

    df, treatment, outcome, causes, method_tag, scheme, target_units, _, random_state = (
        _prepare_effect_data(data, config, func_name)
    )

    try:
        model, identified, estimate = _dowhy_estimate(
            df, treatment, outcome, causes, method_tag, scheme, target_units, func_name
        )
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"{func_name}: Estimation failed - {e}") from e

    refuter_tag = refuter.type
    refuter_config = refuter.value
    if refuter_config is None:  # every CausalRefuterType case carries a config struct
        raise RuntimeError(f"{func_name}: refuter {refuter_tag!r} has no config")
    new_effects: list[float] = []
    p_value = None

    try:
        if refuter_tag == "unobserved_common_cause":
            binary_treatment = set(np.unique(df[treatment].to_numpy())) <= {0.0, 1.0}
            treatment_effect_kind = "binary_flip" if binary_treatment else "linear"
            for strength in refuter_config.get("effect_strengths"):
                kwargs = {}
                if random_state is not None:
                    kwargs["random_seed"] = random_state
                res = model.refute_estimate(
                    identified,
                    estimate,
                    method_name="add_unobserved_common_cause",
                    confounders_effect_on_treatment=treatment_effect_kind,
                    confounders_effect_on_outcome="linear",
                    effect_strength_on_treatment=float(strength),
                    effect_strength_on_outcome=float(strength),
                    **kwargs,
                )
                new_effects.append(float(np.asarray(res.new_effect).ravel()[0]))
        else:
            kwargs = {}
            num_simulations = refuter_config["num_simulations"].unwrap_or(None)
            if num_simulations is not None:
                kwargs["num_simulations"] = int(num_simulations)
            if refuter_tag == "placebo_treatment":
                method_name = "placebo_treatment_refuter"
                kwargs["placebo_type"] = "permute"
            elif refuter_tag == "random_common_cause":
                method_name = "random_common_cause"
            else:
                method_name = "data_subset_refuter"
                kwargs["subset_fraction"] = float(
                    refuter_config["subset_fraction"].unwrap_or(0.8)
                )
            if random_state is not None:
                kwargs["random_seed"] = random_state
            res = model.refute_estimate(
                identified, estimate, method_name=method_name, **kwargs
            )
            new_effects.append(float(np.asarray(res.new_effect).ravel()[0]))
            result_info = getattr(res, "refutation_result", None)
            if isinstance(result_info, dict) and result_info.get("p_value") is not None:
                p_value = float(np.asarray(result_info["p_value"]).ravel()[0])
    except Exception as e:
        raise RuntimeError(f"{func_name}: Refutation failed - {e}") from e

    return EastStruct(
        {
            "estimated_effect": float(estimate.value),
            "new_effects": EastVector(FloatType, np.array(new_effects, dtype=np.float64)),
            "p_value": some(p_value) if p_value is not None else none,
        }
    )


# ============================================================================
# Double Machine Learning (EconML LinearDML)
# ============================================================================


def _nuisance_option(cfg: EastStruct | None, key: str, default: Any) -> Any:
    """A nuisance-model option, or ``default`` when no model spec was given (the default model)."""
    return default if cfg is None else cfg[key].unwrap_or(default)


def _create_nuisance_model(spec: EastVariant | None, classifier: bool, random_state):
    """Build a nuisance model from CausalNuisanceModelType (default random forest)."""
    tag = "random_forest" if spec is None else spec.type
    cfg = None if spec is None else spec.value

    if tag == "random_forest":
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

        kwargs: dict[str, Any] = {
            "n_estimators": int(_nuisance_option(cfg, "n_estimators", 100)),
            "min_samples_leaf": int(_nuisance_option(cfg, "min_samples_leaf", 5)),
            "random_state": random_state,
        }
        max_depth = _nuisance_option(cfg, "max_depth", None)
        if max_depth is not None:
            kwargs["max_depth"] = int(max_depth)
        return RandomForestClassifier(**kwargs) if classifier else RandomForestRegressor(**kwargs)

    if tag == "gradient_boosting":
        from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor

        kwargs = {
            "n_estimators": int(_nuisance_option(cfg, "n_estimators", 100)),
            "learning_rate": float(_nuisance_option(cfg, "learning_rate", 0.1)),
            "max_depth": int(_nuisance_option(cfg, "max_depth", 3)),
            "random_state": random_state,
        }
        return GradientBoostingClassifier(**kwargs) if classifier else GradientBoostingRegressor(**kwargs)

    from sklearn.linear_model import LinearRegression, LogisticRegression

    if classifier:
        return LogisticRegression(max_iter=1000, random_state=random_state)
    return LinearRegression()


def causal_dml_train_impl(
    Y: EastVector,
    T: EastVector,
    X: EastMatrix,
    W: EastVariant,
    config: EastStruct,
) -> EastVariant:
    """Fit an EconML LinearDML estimator for heterogeneous treatment effects.

    Cross-fits nuisance models for outcome and treatment, then fits a linear
    CATE model on the residuals.

    Args:
        Y: ``Vector<Float>`` (``EastVector``) - outcome per unit.
        T: ``Vector<Float>`` (``EastVector``) - treatment per unit (cast to
            int when ``discrete_treatment``).
        X: ``Matrix<Float>`` (``EastMatrix``) - effect modifiers; the CATE
            varies with these.
        W: ``Option<Matrix<Float>>`` (``EastVariant``) - additional
            confounders adjusted for but not modifying the effect.
        config: ``CausalDMLConfigType`` (``EastStruct``) with fields:

            - ``model_y`` / ``model_t`` (``Option<CausalNuisanceModelType>``):
              ``random_forest`` ``{n_estimators (100), min_samples_leaf (5),
              max_depth}`` (default), ``gradient_boosting`` ``{n_estimators
              (100), learning_rate (0.1), max_depth (3)}``, or ``linear``.
              ``model_t`` becomes a classifier when ``discrete_treatment``.
            - ``discrete_treatment`` (``Option<Boolean>``): default false.
            - ``cv_folds`` (``Option<Integer>``): cross-fitting folds (default 2).
            - ``confidence_level`` (``Option<Float>``): stored for
              effect/ATE intervals (default 0.95).
            - ``random_state`` (``Option<Integer>``): seed.

    Returns:
        ``CausalDMLModelBlobType`` (``EastVariant`` tagged ``causal_dml``):
        ``{data: Blob (cloudpickle), n_features_x: Integer,
        confidence_level: Float}`` for use with :func:`causal_dml_effect_impl`
        / :func:`causal_dml_ate_impl`.

    Raises:
        NotImplementedError: the ``causal`` extra is not installed.
        RuntimeError: shape mismatch or training failure.
    """
    _check_econml_support()
    func_name = "causal_dml_train"

    Y_np = Y.to_numpy()
    T_np = T.to_numpy()
    X_np = X.to_numpy()
    W_opt = W.unwrap_or(None)
    W_np = W_opt.to_numpy() if W_opt is not None else None

    if Y_np.shape[0] != T_np.shape[0] or Y_np.shape[0] != X_np.shape[0]:
        raise RuntimeError(
            f"{func_name}: Y has {Y_np.shape[0]} samples, T has {T_np.shape[0]}, "
            f"X has {X_np.shape[0]} - all must match"
        )
    if W_np is not None and W_np.shape[0] != Y_np.shape[0]:
        raise RuntimeError(
            f"{func_name}: W has {W_np.shape[0]} samples but Y has {Y_np.shape[0]}"
        )

    discrete_treatment = bool(config["discrete_treatment"].unwrap_or(False))
    cv_folds = int(config["cv_folds"].unwrap_or(2))
    confidence_level = float(config["confidence_level"].unwrap_or(0.95))
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    model_y = _create_nuisance_model(
        config["model_y"].unwrap_or(None), classifier=False, random_state=random_state
    )
    model_t = _create_nuisance_model(
        config["model_t"].unwrap_or(None),
        classifier=discrete_treatment,
        random_state=random_state,
    )

    try:
        from econml.dml import LinearDML

        est = LinearDML(
            model_y=model_y,
            model_t=model_t,
            discrete_treatment=discrete_treatment,
            cv=cv_folds,
            random_state=random_state,
        )
        T_fit = T_np.astype(int) if discrete_treatment else T_np
        est.fit(Y_np, T_fit, X=X_np, W=W_np)
    except Exception as e:
        raise RuntimeError(f"{func_name}: Training failed - {e}") from e

    return EastVariant(
        "causal_dml",
        EastStruct(
            {
                "data": serialize(est),
                "n_features_x": X_np.shape[1],
                "confidence_level": confidence_level,
            }
        ),
    )


def _load_dml_model(model_blob: EastVariant, X: EastMatrix, func_name: str):
    """Deserialize a DML blob and validate X; returns (est, X_np, confidence_level)."""

    model_data = model_blob.value
    est = deserialize(model_data.get("data"))
    n_features_x = model_data.get("n_features_x")
    confidence_level = float(model_data.get("confidence_level"))

    X_np = X.to_numpy()
    if X_np.shape[1] != n_features_x:
        raise RuntimeError(
            f"{func_name}: Model trained with {n_features_x} X features "
            f"but X has {X_np.shape[1]} features"
        )
    return est, X_np, confidence_level


def causal_dml_effect_impl(model_blob: EastVariant, X: EastMatrix) -> EastVector:
    """Per-row conditional average treatment effects from a fitted DML model.

    Args:
        model_blob: ``CausalDMLModelBlobType`` from :func:`causal_dml_train_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - effect modifiers; must have
            the same number of columns the model was trained with.

    Returns:
        ``Vector<Float>`` (``EastVector``) - one CATE per row, in outcome
        units per treatment unit.

    Raises:
        NotImplementedError: the ``causal`` extra is not installed.
        RuntimeError: feature-count mismatch or prediction failure.
    """
    _check_econml_support()
    est, X_np, _ = _load_dml_model(model_blob, X, "causal_dml_effect")

    try:
        effects = est.effect(X_np)
    except Exception as e:
        raise RuntimeError(f"causal_dml_effect: Prediction failed - {e}") from e

    return EastVector(FloatType, np.asarray(effects, dtype=np.float64).ravel())


def causal_dml_ate_impl(model_blob: EastVariant, X: EastMatrix) -> EastStruct:
    """Average treatment effect with confidence interval from a fitted DML model.

    Args:
        model_blob: ``CausalDMLModelBlobType`` from :func:`causal_dml_train_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - effect modifiers to average
            the CATE over.

    Returns:
        ``CausalATEResultType`` (``EastStruct``): ``ate`` (``Float``) with
        ``lower`` / ``upper`` bounds at the confidence level configured at
        training.

    Raises:
        NotImplementedError: the ``causal`` extra is not installed.
        RuntimeError: feature-count mismatch or prediction failure.
    """
    _check_econml_support()
    est, X_np, confidence_level = _load_dml_model(model_blob, X, "causal_dml_ate")

    try:
        ate = float(np.asarray(est.ate(X_np)).ravel()[0])
        lower, upper = est.ate_interval(X_np, alpha=1 - confidence_level)
        lower = float(np.asarray(lower).ravel()[0])
        upper = float(np.asarray(upper).ravel()[0])
    except Exception as e:
        raise RuntimeError(f"causal_dml_ate: Prediction failed - {e}") from e

    return EastStruct({"ate": ate, "lower": lower, "upper": upper})


# ============================================================================
# Accumulated Local Effects (PyALE)
# ============================================================================


def causal_ale_impl(data: EastArray, config: EastStruct) -> EastStruct:
    """Accumulated local effects dose-response curve of a feature on an outcome.

    Fits a HistGradientBoosting emulator of the outcome on all non-outcome
    columns, then computes the PyALE curve of the feature - robust to
    correlated features, unlike partial dependence.

    Args:
        data: ``Array<Struct>`` (``EastArray`` of ``EastStruct``) - one struct
            per unit; the struct's fields ARE the columns.
        config: ``CausalALEConfigType`` (``EastStruct``) with fields:

            - ``outcome`` (``String``): column the emulator predicts.
            - ``feature`` (``String``): continuous column for the ALE curve.
            - ``categorical`` (``Option<Array<String>>``): integer-coded
              columns, one-hot encoded internally (not outcome/feature).
            - ``grid_size`` (``Option<Integer>``): grid intervals (default 10).
            - ``include_ci`` (``Option<Boolean>``): default true.
            - ``confidence_level`` (``Option<Float>``): default 0.95.
            - ``emulator`` (``Option``): ``{n_estimators (300), learning_rate
              (0.05), max_depth, min_samples_leaf (sklearn default 20 - lower
              for small datasets)}``.
            - ``random_state`` (``Option<Integer>``): emulator seed.

    Returns:
        ``ALEResultType`` (``EastStruct``): ``grid`` / ``effect``
        (``Vector<Float>``), ``lower`` / ``upper``
        (``Option<Vector<Float>>``, present when ``include_ci``), ``size``
        (``Vector<Integer>`` samples per interval).

    Raises:
        NotImplementedError: the ``causal`` extra is not installed.
        RuntimeError: column/config mismatch, emulator training failure, or
            ALE computation failure.
    """
    _check_pyale_support()
    func_name = "causal_ale"

    outcome = str(config.get("outcome"))
    feature = str(config.get("feature"))
    categorical_opt = config["categorical"].unwrap_or(None)
    categorical = [str(c) for c in categorical_opt] if categorical_opt is not None else []
    grid_size = int(config["grid_size"].unwrap_or(10))
    include_ci = bool(config["include_ci"].unwrap_or(True))
    confidence_level = float(config["confidence_level"].unwrap_or(0.95))
    emulator = config["emulator"].unwrap_or(None)
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    df = _build_dataframe(data, func_name)
    _require_columns(df, [outcome, feature], func_name)
    if outcome == feature:
        raise RuntimeError(f"{func_name}: outcome and feature must differ")
    df, _ = _encode_categoricals(df, categorical, [outcome, feature], func_name)

    y = df[outcome].to_numpy()
    X_df = df.drop(columns=[outcome])

    try:
        from sklearn.ensemble import HistGradientBoostingRegressor

        hgb_kwargs = {
            "max_iter": int(emulator["n_estimators"].unwrap_or(300)) if emulator else 300,
            "learning_rate": float(emulator["learning_rate"].unwrap_or(0.05)) if emulator else 0.05,
            "random_state": random_state,
        }
        max_depth = emulator["max_depth"].unwrap_or(None) if emulator else None
        if max_depth is not None:
            hgb_kwargs["max_depth"] = int(max_depth)
        min_samples_leaf = emulator["min_samples_leaf"].unwrap_or(None) if emulator else None
        if min_samples_leaf is not None:
            hgb_kwargs["min_samples_leaf"] = int(min_samples_leaf)
        gbm = HistGradientBoostingRegressor(**hgb_kwargs)
        gbm.fit(X_df, y)
    except Exception as e:
        raise RuntimeError(f"{func_name}: Emulator training failed - {e}") from e

    try:
        import matplotlib

        matplotlib.use("Agg", force=False)
        logging.getLogger("PyALE._ALE_generic").setLevel(logging.WARNING)
        from PyALE import ale

        res = ale(
            X=X_df,
            model=gbm,
            feature=[feature],
            grid_size=grid_size,
            include_CI=include_ci,
            C=confidence_level,
            plot=False,
        )
    except Exception as e:
        raise RuntimeError(f"{func_name}: ALE computation failed - {e}") from e

    grid = np.asarray(res.index, dtype=np.float64)
    effect = res["eff"].to_numpy(dtype=np.float64)
    size = res["size"].to_numpy(dtype=np.int64)

    lower_variant = none
    upper_variant = none
    if include_ci:
        lower_cols = [c for c in res.columns if str(c).startswith("lowerCI")]
        upper_cols = [c for c in res.columns if str(c).startswith("upperCI")]
        if lower_cols and upper_cols:
            lower_variant = some(EastVector(FloatType, res[lower_cols[0]].to_numpy(dtype=np.float64)))
            upper_variant = some(EastVector(FloatType, res[upper_cols[0]].to_numpy(dtype=np.float64)))

    return EastStruct(
        {
            "grid": EastVector(FloatType, grid),
            "effect": EastVector(FloatType, effect),
            "lower": lower_variant,
            "upper": upper_variant,
            "size": EastVector(IntegerType, size),
        }
    )


# ============================================================================
# Experiment — types (snake_case; mirror the e3-ui contract exactly)
# ============================================================================

RefuteSpecType = StructType(
    [
        ("placebo", BooleanType),
        ("random_common_cause", BooleanType),
        ("data_subset", BooleanType),
        ("sensitivity", OptionType(ArrayType(FloatType))),
    ]
)

CausalExperimentConfigType = StructType(
    [
        ("treatment", StringType),
        ("outcome", StringType),
        ("common_causes", ArrayType(StringType)),
        ("categorical", OptionType(ArrayType(StringType))),
        ("method", OptionType(CausalEstimatorType)),
        ("estimand", OptionType(CausalTargetUnitsType)),
        ("refute", OptionType(RefuteSpecType)),
        ("dose_feature", OptionType(StringType)),
        ("min_overlap", OptionType(FloatType)),
        ("min_treatment_variation", OptionType(FloatType)),
        ("bootstrap", OptionType(CausalBootstrapConfigType)),
        ("random_state", OptionType(IntegerType)),
        # Graded-overlap threshold (G1/G2): common support below this keeps `causal`
        # off the top tier (verdict modest, support_strength=thin); default 0.55.
        ("strong_overlap", OptionType(FloatType)),
        # Robustness floor (G3): a causal verdict whose E-value is below this is
        # downgraded to modest. Off by default.
        ("evalue_floor", OptionType(FloatType)),
        # Directional prior (G6): a material, CI-clear effect of the opposite sign is
        # flagged (expected_sign_ok=some(false), verdict adjustment_insufficient). Off by default.
        ("expected_sign", OptionType(CausalSignType)),
    ]
)

SupportStrengthType = VariantType(
    [
        ("refused", NullType),
        ("thin", NullType),
        ("strong", NullType),
    ]
)
"""Graded common-support tier (G1/G2).

Cases: ``refused`` (below ``min_overlap``), ``thin`` (clears the refuse gate but
below ``strong_overlap``), ``strong`` (>= ``strong_overlap``; vacuously strong with
no confounders). twin: causal.ts / e3-ui ``SupportStrengthType``.
"""

BalanceRowType = StructType(
    [
        ("column", StringType),
        # The original confounder this row belongs to. Equals `column` for a
        # numeric confounder; for a one-hot categorical level (`column` is the
        # expanded dummy) it is the base confounder, so consumers group / format
        # without re-parsing the dummy name.
        ("base_column", StringType),
        ("treated_mean", FloatType),
        ("control_mean", FloatType),
        ("std_diff", FloatType),
        # Post-adjustment standardized mean difference (same pooled-sd denominator
        # as std_diff, weighted means) — proof the adjustment closed the gap. Some
        # only for propensity_score_weighting with computable scores; none for the
        # regression estimator (which doesn't reweight) or a failed propensity fit.
        ("std_diff_adjusted", OptionType(FloatType)),
    ]
)

OverlapDiagnosticType = StructType(
    [
        ("treated_propensity", VectorType(FloatType)),
        ("control_propensity", VectorType(FloatType)),
        ("common_support_frac", FloatType),
        # Clears the REFUSE gate min_overlap (an adjusted estimate is attempted) —
        # NOT a quality signal. Read support_strength for the graded tier.
        ("positivity_ok", BooleanType),
        # Graded common-support tier: refused / thin / strong (vs strong_overlap).
        ("support_strength", SupportStrengthType),
    ]
)

SensitivityBenchmarkType = StructType(
    [
        ("column", StringType),
        ("strength", FloatType),
    ]
)
"""One observed confounder placed on the sensitivity strengths axis — the
simulated strength whose effect-shift equals the shift from omitting it.
twin: causal.ts / e3-ui ``SensitivityBenchmarkType``."""

RefutationType = StructType(
    [
        ("placebo_effect", OptionType(FloatType)),
        ("placebo_passes", OptionType(BooleanType)),
        ("random_cc_within_ci", OptionType(BooleanType)),
        ("data_subset_effect", OptionType(FloatType)),
        ("data_subset_std", OptionType(FloatType)),
        # Closed-form E-value (risk-ratio scale); a monotone transform of the
        # standardized effect — read as "how easily overturned", not independent of it.
        ("robustness_value", OptionType(FloatType)),
        (
            "sensitivity",
            OptionType(StructType([
                ("strengths", VectorType(FloatType)),
                ("effects", VectorType(FloatType)),
                # Observed-confounder benchmarks on the SAME strengths axis: for each
                # confounder, the simulated strength whose effect-shift equals the
                # shift from omitting that confounder — so "tips at 0.9" can be read
                # as "a hidden cause as strong as <column>". Clamped to the last
                # simulated strength; empty when no benchmark is computable.
                ("benchmarks", ArrayType(SensitivityBenchmarkType)),
            ])),
        ),
        # Sign-prior check (G6): some(true/false) when expected_sign is set and the
        # effect is material; none when no prior or the effect is near-zero.
        ("expected_sign_ok", OptionType(BooleanType)),
    ]
)

DoseResponseType = StructType(
    [
        ("feature", StringType),
        ("grid", VectorType(FloatType)),
        ("effect", VectorType(FloatType)),
        ("lower", OptionType(VectorType(FloatType))),
        ("upper", OptionType(VectorType(FloatType))),
        # Rows per dose bin — drives the surface's "you are here" (busiest bin) marker.
        ("size", VectorType(IntegerType)),
    ]
)

ExperimentVerdictType = VariantType(
    [
        ("causal", NullType),
        ("modest", NullType),
        ("adjustment_insufficient", NullType),
        ("non_identifiable_positivity", NullType),
        ("not_estimable", StringType),
    ]
)

VerdictReasonType = VariantType(
    [
        # The placebo (shuffle) refuter didn't collapse to ~0.
        ("placebo_failed", NullType),
        # |effect| below the materiality band (0.10 × outcome_sd).
        ("not_material", NullType),
        # The adjusted CI straddles zero.
        ("ci_spans_zero", NullType),
        # Material + CI-clear but pointing against config.expected_sign.
        ("wrong_sign", NullType),
        # Common support cleared the refuse gate but is below strong_overlap.
        ("thin_support", NullType),
        # E-value below the (opt-in) evalue_floor.
        ("low_robustness", NullType),
    ]
)
"""Machine-readable reason a verdict fell short of ``causal``.

Every FAILING gate is emitted (the verdict tag is chosen by precedence, but a
consumer explaining "why modest?" needs all of them). Empty for ``causal`` (all
gates passed) and for the two refusal verdicts (the tag itself is the reason).
twin: causal.ts / e3-ui ``VerdictReasonType``.
"""

CausalExperimentResultType = StructType(
    [
        ("naive", FloatType),
        ("naive_ci", OptionType(CiType)),
        ("adjusted", OptionType(StructType([("effect", FloatType), ("ci", OptionType(CiType))]))),
        ("n_total", IntegerType),
        ("n_treated", IntegerType),
        ("n_control", IntegerType),
        # Rows OUTSIDE the propensity common support — the units with no
        # like-for-like counterpart on the other side (display-only; nothing is
        # dropped from the estimate).
        ("n_dropped", IntegerType),
        ("balance", ArrayType(BalanceRowType)),
        ("overlap", OverlapDiagnosticType),
        ("refutation", OptionType(RefutationType)),
        ("dose_response", OptionType(DoseResponseType)),
        ("verdict", ExperimentVerdictType),
        # Why the verdict fell short of `causal` — every failing gate (empty for
        # `causal` and for the refusals, where the tag itself is the reason).
        ("verdict_reasons", ArrayType(VerdictReasonType)),
        # The thresholds the verdict applied, echoed so a consumer can SAY them:
        # "the effect (+0.3) is smaller than what would matter here (±0.6)".
        ("outcome_sd", FloatType),
        ("materiality_threshold", FloatType),
        # Per-arm raw outcome means — the numbers a domain expert recognises from
        # their own reports; none when an arm is empty.
        ("treated_outcome_mean", OptionType(FloatType)),
        ("control_outcome_mean", OptionType(FloatType)),
    ]
)

# Validation-design contract — mirrors e3-ui's experiment types + Causal.Types.* (TS).
DesignBasisType = VariantType(
    [
        ("detect_observed", NullType),
        ("resolve_vs_null", NullType),
        ("de_bias", NullType),
        ("restrict_to_overlap", NullType),
        ("create_control", NullType),
    ]
)
TrialOptionType = StructType(
    [
        ("label", StringType),
        ("treated_share", FloatType),
        ("n_treated", IntegerType),
        ("n_control", IntegerType),
        ("n_total", IntegerType),
    ]
)
PowerCurveType = StructType(
    [
        ("n", VectorType(IntegerType)),
        ("power", VectorType(FloatType)),
    ]
)
ExperimentDesignType = StructType(
    [
        ("verdict", ExperimentVerdictType),
        ("basis", DesignBasisType),
        ("target_effect", FloatType),
        ("outcome_sd", FloatType),
        ("target_power", FloatType),
        ("alpha", FloatType),
        ("current_power", OptionType(FloatType)),
        ("match_on", ArrayType(StringType)),
        ("options", ArrayType(TrialOptionType)),
        ("power_curve", PowerCurveType),
        ("rationale", StringType),
    ]
)
DesignConfigType = StructType(
    [
        ("alpha", OptionType(FloatType)),
        ("target_power", OptionType(FloatType)),
        ("materiality", OptionType(FloatType)),
        ("treated_shares", OptionType(ArrayType(FloatType))),
    ]
)


# ============================================================================
# Experiment — single declarative entry point + honesty verdict
# ============================================================================


def _hist(values, bins: int = 20):
    """20-bin propensity histogram over [0, 1] as a list of float counts."""
    h, _ = np.histogram(np.asarray(values, dtype=float).ravel(), bins=bins, range=(0.0, 1.0))
    return [float(x) for x in h]


def _experiment_overlap(df, treatment, causes, random_state, min_overlap):
    """Non-raising propensity overlap → (treated_hist, control_hist, frac, ok).

    With no confounders or a degenerate arm there is nothing to separate on, so
    positivity is vacuously satisfied (the not-estimable guard catches a
    degenerate arm first).
    """
    t = df[treatment].to_numpy() > 0.5
    if not causes or t.sum() == 0 or (~t).sum() == 0:
        return _hist([]), _hist([]), 1.0, True
    try:
        ps = _propensity_scores(df, treatment, causes, random_state)
    except Exception:
        return _hist([]), _hist([]), 1.0, True
    pt, pc = ps[t], ps[~t]
    lo, hi = max(pt.min(), pc.min()), min(pt.max(), pc.max())
    frac = float(((ps >= lo) & (ps <= hi)).mean()) if hi > lo else 0.0
    return _hist(pt), _hist(pc), frac, bool(frac >= min_overlap)


def _experiment_balance(df, treatment, common_causes, expansion):
    """Per-confounder standardized mean difference; categoricals → one row per level."""
    t = df[treatment].to_numpy() > 0.5
    rows = []
    for c in common_causes:
        for col in expansion.get(c, [c]):
            if col not in df.columns:
                continue
            x = df[col].to_numpy(dtype=np.float64)
            xt, xc = x[t], x[~t]
            if len(xt) == 0 or len(xc) == 0:
                continue
            mt, mc = float(xt.mean()), float(xc.mean())
            pooled = float(np.sqrt((xt.var() + xc.var()) / 2.0))
            # (column, base_column, treated_mean, control_mean, std_diff) — `c` is
            # the original confounder, `col` the (possibly one-hot) reported column.
            rows.append((col, c, mt, mc, float((mt - mc) / pooled) if pooled > 0 else 0.0))
    rows.sort(key=lambda r: -abs(r[4]))
    return rows


def _experiment_balance_adjusted(df, treatment, causes, balance_rows, random_state):
    """Post-weighting SMD per balance row → {column: wsmd}, or {} when not computable.

    ATE inverse-propensity weights (1/ps treated, 1/(1-ps) control); the SMD keeps
    the UNWEIGHTED pooled-sd denominator so before/after are directly comparable
    (the Love-plot convention). Only meaningful for the propensity estimator —
    the caller gates on method_tag.
    """
    try:
        ps = _propensity_scores(df, treatment, causes, random_state)
    except Exception:
        return {}
    t = df[treatment].to_numpy() > 0.5
    eps = 1e-6
    w = np.where(t, 1.0 / np.clip(ps, eps, 1.0), 1.0 / np.clip(1.0 - ps, eps, 1.0))
    out = {}
    for (col, _base, _mt, _mc, _sd) in balance_rows:
        if col not in df.columns:
            continue
        x = df[col].to_numpy(dtype=np.float64)
        xt, xc = x[t], x[~t]
        wt, wc = w[t], w[~t]
        if len(xt) == 0 or len(xc) == 0 or wt.sum() <= 0 or wc.sum() <= 0:
            continue
        mt = float(np.average(xt, weights=wt))
        mc = float(np.average(xc, weights=wc))
        pooled = float(np.sqrt((xt.var() + xc.var()) / 2.0))
        out[col] = float((mt - mc) / pooled) if pooled > 0 else 0.0
    return out


def _experiment_benchmarks(df, treatment, outcome, config_causes, expansion, method_tag,
                           target_units, random_state, adj_effect, strengths, effects):
    """Observed-confounder benchmarks on the sensitivity strengths axis.

    For each base confounder c: omitting c moves the adjusted estimate by
    |Δ_c|; its benchmark is the (interpolated) simulated strength at which the
    tipping curve moves by the same amount — so a curve reading like "tips at
    0.9" becomes "a hidden cause as strong as <c>". Shifts beyond the simulated
    range clamp to the last strength. Returns [(column, strength), …].
    """
    if len(strengths) < 2 or len(effects) < 2:
        return []
    base = effects[0]
    curve_shift = [abs(e - base) for e in effects]
    max_shift = max(curve_shift)

    def strength_for(shift: float) -> float:
        if shift <= 0.0:
            return float(strengths[0])
        if max_shift <= 0.0 or shift >= max_shift:
            return float(strengths[-1])
        for i in range(1, len(curve_shift)):
            s0, s1 = curve_shift[i - 1], curve_shift[i]
            if s0 <= shift <= s1 and s1 > s0:
                f = (shift - s0) / (s1 - s0)
                return float(strengths[i - 1] + f * (strengths[i] - strengths[i - 1]))
        return float(strengths[-1])

    out = []
    for c in config_causes:
        remaining = [col for other in config_causes if other != c for col in expansion.get(other, [other])]
        # Same downgrade the main impl applies: the propensity estimator needs at
        # least one confounder — omitting the only one falls back to regression.
        m_tag = method_tag if remaining else "linear_regression"
        try:
            without = _manual_effect(df, treatment, outcome, remaining, m_tag, target_units, random_state)
        except Exception:
            continue
        out.append((c, strength_for(abs(float(without) - float(adj_effect)))))
    return out


def _experiment_placebo(df, treatment, outcome, causes, method_tag, target_units,
                        random_state, sims: int = 8, cluster_column=None):
    """Mean adjusted effect under a permuted (placebo) treatment — should be ~0.

    When ``cluster_column`` is set and treatment is assigned at the cluster level
    (constant within each cluster), the placebo permutes labels BETWEEN clusters —
    each cluster keeps its rows together and is reassigned a permuted cluster-level
    label, mirroring how ``_bootstrap_ci`` resamples whole clusters. A row-level
    shuffle would destroy the within-cluster structure and let the placebo pass
    falsely for a cluster-assigned treatment (the G4 bug). If any cluster has mixed
    treatment (genuine within-cluster variation) the clustered placebo doesn't apply,
    so it falls back to the row-level permutation.
    """
    rng = np.random.default_rng(random_state)
    base = df[treatment].to_numpy()

    # (row indices per cluster, cluster-level treatment label) when the
    # treatment is assigned per cluster; None for the row-level permutation.
    clusters: tuple[list[np.ndarray], np.ndarray] | None = None
    if cluster_column is not None and cluster_column in df.columns:
        cluster_vals = df[cluster_column].to_numpy()
        cand = [np.where(cluster_vals == u)[0] for u in np.unique(cluster_vals)]
        fracs = [float((base[idx] > 0.5).mean()) for idx in cand]
        # Cluster-level assignment ⇒ each cluster's treated-fraction is exactly 0 or 1.
        if len(cand) > 1 and all(f in (0.0, 1.0) for f in fracs):
            clusters = (cand, np.array([1.0 if f == 1.0 else 0.0 for f in fracs]))

    vals = []
    for _ in range(sims):
        d2 = df.copy()
        if clusters is not None:
            groups, cluster_labels = clusters
            perm = rng.permutation(len(cluster_labels))
            # Reject any permutation that leaves the LABEL vector unchanged — not just
            # the index-identity. A shuffle that only permutes same-labelled clusters
            # reproduces the real treatment assignment and biases the placebo away from
            # 0 (with few/imbalanced clusters such permutations are a non-trivial share).
            tries = 0
            while np.array_equal(cluster_labels[perm], cluster_labels) and tries < 16:
                perm = rng.permutation(len(cluster_labels))
                tries += 1
            new_t = base.astype(float).copy()
            for gi, idx in enumerate(groups):
                new_t[idx] = cluster_labels[perm[gi]]
            d2[treatment] = new_t
        else:
            d2[treatment] = rng.permutation(base)
        try:
            vals.append(_manual_effect(d2, treatment, outcome, causes, method_tag, target_units, random_state))
        except Exception:
            continue
    return float(np.mean(vals)) if vals else 0.0


def _evalue(effect: float, outcome_sd: float) -> float:
    """Closed-form E-value (VanderWeele d→RR), on the risk-ratio scale; informational."""
    if outcome_sd <= 0:
        return 1.0
    rr = float(np.exp(0.91 * abs(effect) / outcome_sd))
    if rr < 1.0:
        rr = 1.0 / rr
    return float(rr + np.sqrt(rr * (rr - 1.0)))


def _meandiff_ci(y, t, bootstrap_opt, random_state, cluster_ids=None):
    """Percentile bootstrap CI of the raw mean difference (naive), or None.

    When ``cluster_ids`` is given (a clustered design), whole clusters are resampled
    with replacement — the same exchangeable unit ``_bootstrap_ci`` uses for the
    adjusted CI — so the naive and adjusted intervals are comparable (the G5 fix);
    otherwise rows are resampled. Resamples that leave an arm empty are skipped, and
    fewer than 10 valid replicates returns None (so a degenerate clustered draw can't
    NaN-poison the percentile).
    """
    reps, cl = 200, 0.95
    if bootstrap_opt is not None:
        reps = int(bootstrap_opt.get("reps"))
        cl = float(bootstrap_opt["confidence_level"].unwrap_or(0.95))
    rng = np.random.default_rng(random_state)
    n = len(y)
    est = []
    if cluster_ids is not None:
        members = [np.where(cluster_ids == u)[0] for u in np.unique(cluster_ids)]
        for _ in range(reps):
            picked = rng.integers(0, len(members), len(members))
            s = np.concatenate([members[i] for i in picked])
            ys, ts = y[s], t[s]
            if ts.sum() == 0 or (~ts).sum() == 0:
                continue
            est.append(float(ys[ts].mean() - ys[~ts].mean()))
    else:
        for _ in range(reps):
            s = rng.integers(0, n, n)
            ys, ts = y[s], t[s]
            if ts.sum() == 0 or (~ts).sum() == 0:
                continue
            est.append(float(ys[ts].mean() - ys[~ts].mean()))
    if len(est) < 10:
        return None
    a = 1.0 - cl
    lo, hi = np.percentile(est, [100 * a / 2, 100 * (1 - a / 2)])
    return float(lo), float(hi)


def _experiment_ci(df, treatment, outcome, causes, method_tag, target_units,
                   bootstrap_opt, random_state):
    """(lower, upper) for the adjusted estimate via the percentile bootstrap (default 200 reps)."""
    bs = bootstrap_opt
    if bs is None:
        bs = EastStruct({"reps": 200, "cluster_column": none,
                         "confidence_level": some(0.95)})
    return _bootstrap_ci(df, treatment, outcome, causes, method_tag, target_units, bs, random_state)


def _experiment_random_cc(df, treatment, outcome, causes, method_tag, target_units,
                          adj_effect, ci_half, random_state):
    """Add a decoy random common cause; the estimate should stay inside its CI."""
    rng = np.random.default_rng(random_state)
    d2 = df.copy()
    d2["__rcc__"] = rng.standard_normal(len(d2))
    try:
        new = _manual_effect(d2, treatment, outcome, list(causes) + ["__rcc__"],
                             method_tag, target_units, random_state)
    except Exception:
        return None
    return bool(abs(new - adj_effect) <= max(ci_half, 1e-9))


def _experiment_data_subset(df, treatment, outcome, causes, method_tag, target_units,
                            random_state, sims=10, frac=0.8):
    """Re-estimate on random subsamples → (mean effect, std)."""
    rng = np.random.default_rng(random_state)
    n = len(df)
    k = max(4, int(frac * n))
    vals = []
    for _ in range(sims):
        idx = rng.choice(n, min(k, n), replace=False)
        try:
            vals.append(_manual_effect(df.iloc[idx], treatment, outcome, causes,
                                       method_tag, target_units, random_state))
        except Exception:
            continue
    if not vals:
        return None, None
    return float(np.mean(vals)), float(np.std(vals))


def _effect_config_from(config: EastStruct, treatment: str, outcome: str) -> EastStruct:
    """Build a CausalEffectConfigType (for the internal refute / ale reuse) from
    the experiment config — method / estimand / categorical / random_state are
    the same shapes, so they pass straight through."""
    return EastStruct({
        "treatment": treatment, "outcome": outcome,
        "common_causes": config.get("common_causes"),
        "categorical": config.get("categorical"),
        "method": config.get("method"),
        "target_units": config.get("estimand"),
        "trim": none,
        "bootstrap": none,
        "random_state": config.get("random_state"),
    })


def _experiment_sensitivity(data, config, treatment, outcome, strengths):
    """Unobserved-confounder tipping curve via the internal DoWhy refuter.

    Returns ``(strengths, effects)`` as plain float lists (the caller attaches
    the observed-confounder benchmarks and builds the struct), or ``None``.
    """
    refuter = variant(
        "unobserved_common_cause",
        EastStruct({"effect_strengths": [float(s) for s in strengths]}),
        CausalRefuterType,
    )
    try:
        r = causal_refute_impl(data, _effect_config_from(config, treatment, outcome), refuter)
        effects = [float(x) for x in r.get("new_effects").to_numpy()]
    except Exception:
        return None
    return [float(s) for s in strengths], effects


def _experiment_dose(data, config, outcome, dose_feature):
    """ALE dose-response curve of `dose_feature` via the internal PyALE path."""
    ale_config = EastStruct({
        "outcome": outcome, "feature": dose_feature,
        "categorical": config.get("categorical"),
        "grid_size": some(10),
        "include_ci": some(True),
        "confidence_level": some(0.95),
        "emulator": none,
        "random_state": config.get("random_state"),
    })
    try:
        a = causal_ale_impl(data, ale_config)
    except Exception:
        return none
    return some(EastStruct({
        "feature": dose_feature,
        "grid": a.get("grid"), "effect": a.get("effect"),
        "lower": a.get("lower"), "upper": a.get("upper"),
        "size": a.get("size"),
    }))


def causal_experiment_impl(data: EastArray, config: EastStruct) -> EastStruct:
    """One declarative causal experiment → numbers + overlap + an honesty verdict.

    Binary treatment, backdoor adjustment. Computes the naive (raw) and adjusted
    (like-for-like) effect, the confounder balance, the propensity overlap, an
    optional placebo robustness check, and reduces them to a verdict. ``adjusted``
    is ``none`` when the engine **refuses** (no treatment variation → ``not_estimable``;
    no common support → ``non_identifiable_positivity``). Never raises on a
    degenerate frame — it returns the matching refusal verdict instead.

    Args:
        data: ``Array<Struct>`` — one struct per unit; fields ARE the columns.
        config: ``CausalExperimentConfigType``.

    Returns:
        ``CausalExperimentResultType``.
    """
    func = "causal_experiment"

    treatment = str(config.get("treatment"))
    outcome = str(config.get("outcome"))
    common_causes = [str(c) for c in config.get("common_causes")]
    categorical_opt = config["categorical"].unwrap_or(None)
    categorical = [str(c) for c in categorical_opt] if categorical_opt is not None else []
    method_variant = config["method"].unwrap_or(None)
    # Default to linear regression — the natural backdoor estimator for a
    # continuous outcome (propensity weighting is an explicit opt-in, and needs
    # at least one confounder).
    method_tag = "linear_regression" if method_variant is None else method_variant.type
    if method_tag == "propensity_score_weighting" and not common_causes:
        method_tag = "linear_regression"
    estimand_variant = config["estimand"].unwrap_or(None)
    target_units = "ate" if estimand_variant is None else estimand_variant.type
    refute_opt = config["refute"].unwrap_or(None)
    want_placebo = bool(refute_opt.get("placebo")) if refute_opt is not None else False
    want_random_cc = bool(refute_opt.get("random_common_cause")) if refute_opt is not None else False
    want_data_subset = bool(refute_opt.get("data_subset")) if refute_opt is not None else False
    sensitivity_strengths = None
    if refute_opt is not None:
        ss = refute_opt["sensitivity"].unwrap_or(None)
        sensitivity_strengths = [float(s) for s in ss] if ss is not None else None
    dose_feature_opt = config["dose_feature"].unwrap_or(None)
    dose_feature = str(dose_feature_opt) if dose_feature_opt is not None else None
    min_overlap = float(config["min_overlap"].unwrap_or(0.10))
    min_var = float(config["min_treatment_variation"].unwrap_or(0.02))
    # Graded-overlap threshold (G1/G2). Off-by-default knobs (G3/G6) keep a None
    # sentinel so the feature is disabled unless the caller opts in.
    strong_overlap = float(config["strong_overlap"].unwrap_or(0.55))
    evalue_floor = config["evalue_floor"].unwrap_or(None)
    if evalue_floor is not None:
        evalue_floor = float(evalue_floor)
    expected_sign_opt = config["expected_sign"].unwrap_or(None)
    expected_sign = expected_sign_opt.type if expected_sign_opt is not None else None
    bootstrap_opt = config["bootstrap"].unwrap_or(None)
    cluster_column = (bootstrap_opt["cluster_column"].unwrap_or(None)
                      if bootstrap_opt is not None else None)
    if cluster_column is not None:
        cluster_column = str(cluster_column)
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    df = _build_dataframe(data, func)
    _require_columns(df, [treatment, outcome] + common_causes, func)
    df, expansion = _encode_categoricals(df, categorical, [treatment, outcome], func)
    causes = _expand_causes(common_causes, expansion)
    # Cluster ids aligned to y/t for the clustered naive CI (G5); None when no
    # cluster_column or the named column is absent (degenerate frame → row resample).
    cluster_ids = (df[cluster_column].to_numpy()
                   if cluster_column is not None and cluster_column in df.columns else None)

    t = df[treatment].to_numpy() > 0.5
    y = df[outcome].to_numpy(dtype=np.float64)
    n_total, n_t, n_c = len(df), int(t.sum()), int((~t).sum())
    outcome_sd = float(df[outcome].std()) or 1.0
    # Echo the materiality band the verdict applies, so a consumer can SAY it
    # ("smaller than what would matter here").
    materiality = 0.10 * outcome_sd
    treated_mean_opt = some(float(y[t].mean())) if n_t else none
    control_mean_opt = some(float(y[~t].mean())) if n_c else none

    naive = float(y[t].mean() - y[~t].mean()) if n_t and n_c else 0.0
    nci = _meandiff_ci(y, t, bootstrap_opt, random_state, cluster_ids=cluster_ids)
    naive_ci = some(EastStruct({"lower": nci[0], "upper": nci[1]})) if nci else none

    balance_rows = _experiment_balance(df, treatment, common_causes, expansion)
    th, ch, support_frac, positivity_ok = _experiment_overlap(df, treatment, causes, random_state, min_overlap)
    # Rows outside the common support — the units with no like-for-like
    # counterpart. Display-only (nothing is dropped from the estimate).
    n_off_support = int(round((1.0 - float(support_frac)) * n_total))

    # Graded common-support tier (G1/G2): refused (below the refuse gate) / thin
    # (clears it but below strong_overlap) / strong. Always reported on overlap.
    if support_frac < min_overlap:
        support_tag = "refused"
    elif support_frac >= strong_overlap:
        support_tag = "strong"
    else:
        support_tag = "thin"

    adjusted = none
    refutation = none
    # Every FAILING verdict gate, machine-readable — empty for `causal` (all
    # gates passed) and for the refusals (the verdict tag itself is the reason).
    reasons: list[str] = []
    # Post-adjustment SMD per balance column (PSW only) — {} when not computed.
    adj_bal: dict[str, float] = {}

    minfrac = (min(n_t, n_c) / n_total) if n_total else 0.0
    if minfrac < min_var:
        verdict = variant(
            "not_estimable",
            f"treatment barely varies: the minority arm is {minfrac:.1%} of rows",
            ExperimentVerdictType,
        )
    elif support_frac < min_overlap:
        verdict = variant("non_identifiable_positivity", None, ExperimentVerdictType)
    else:
        adj_effect = _manual_effect(df, treatment, outcome, causes, method_tag, target_units, random_state)
        try:
            alo, ahi = _experiment_ci(df, treatment, outcome, causes, method_tag, target_units, bootstrap_opt, random_state)
        except Exception:
            alo, ahi = adj_effect, adj_effect
        placebo = (_experiment_placebo(df, treatment, outcome, causes, method_tag, target_units,
                                       random_state, cluster_column=cluster_column)
                   if want_placebo else 0.0)
        placebo_fails = want_placebo and abs(placebo) > max(0.05 * outcome_sd, 0.15 * abs(adj_effect))
        robustness_value = _evalue(adj_effect, outcome_sd)

        # An effect is "material" when it is finite and clears the materiality band;
        # below that its sign is noise, so the sign prior (G6) must not fire on it.
        material = (not math.isnan(adj_effect)) and abs(adj_effect) >= 0.10 * outcome_sd
        ci_clear = not (alo <= 0.0 <= ahi)
        sign_match = None
        if expected_sign is not None and material:
            sign_match = (adj_effect > 0.0) == (expected_sign == "positive")

        # Record EVERY failing gate (machine-readable "why not causal?"); the tag
        # itself is then chosen by the severity cascade below.
        if placebo_fails:
            reasons.append("placebo_failed")
        if not material:
            reasons.append("not_material")
        if not ci_clear:
            reasons.append("ci_spans_zero")
        if sign_match is False:
            reasons.append("wrong_sign")
        if support_tag != "strong":
            reasons.append("thin_support")
        if evalue_floor is not None and robustness_value < evalue_floor:
            reasons.append("low_robustness")

        if placebo_fails:
            tag = "adjustment_insufficient"
        elif (not material) or (not ci_clear):
            # Faint / CI-spans-zero is "modest" — decided BEFORE the sign check so a
            # near-zero effect's noisy sign can't escalate it (G6 severity inversion).
            tag = "modest"
        elif sign_match is False:
            # Material, CI-clear, but pointing the wrong way → a reverse-causation /
            # reactive-assignment signal the refuters can't see (G6).
            tag = "adjustment_insufficient"
        elif support_tag != "strong":
            # Thin common support → not the top tier (G1); support_strength says why.
            tag = "modest"
        elif evalue_floor is not None and robustness_value < evalue_floor:
            # Trivially-overturnable per the (opt-in) E-value floor (G3). Same axis as
            # the materiality band — a stricter materiality bar, not a new signal.
            tag = "modest"
        else:
            tag = "causal"
        verdict = variant(tag, None, ExperimentVerdictType)

        # Post-adjustment balance — only the propensity estimator reweights, so
        # only it has an "after" picture to report.
        if method_tag == "propensity_score_weighting" and causes:
            adj_bal = _experiment_balance_adjusted(df, treatment, causes, balance_rows, random_state)
        expected_sign_ok = (some(bool(sign_match)) if sign_match is not None
                            else none)
        adjusted = some(EastStruct({
            "effect": float(adj_effect),
            "ci": some(EastStruct({"lower": float(alo), "upper": float(ahi)})),
        }))
        ci_half = abs(ahi - alo) / 2.0
        rcc = (_experiment_random_cc(df, treatment, outcome, causes, method_tag, target_units,
                                     adj_effect, ci_half, random_state) if want_random_cc else None)
        ds_eff, ds_std = (_experiment_data_subset(df, treatment, outcome, causes, method_tag,
                                                  target_units, random_state)
                          if want_data_subset else (None, None))
        sens = (_experiment_sensitivity(data, config, treatment, outcome, sensitivity_strengths)
                if sensitivity_strengths else None)
        sens_struct: EastStruct | None = None
        if sens is not None:
            s_list, e_list = sens
            benchmarks = _experiment_benchmarks(
                df, treatment, outcome, common_causes, expansion, method_tag,
                target_units, random_state, adj_effect, s_list, e_list)
            sens_struct = EastStruct({
                "strengths": EastVector(FloatType, s_list),
                "effects": EastVector(FloatType, e_list),
                "benchmarks": EastArray(SensitivityBenchmarkType, [
                    EastStruct({"column": col, "strength": float(s)}) for (col, s) in benchmarks
                ]),
            })
        refutation = some(EastStruct({
            "placebo_effect": some(float(placebo)) if want_placebo else none,
            "placebo_passes": some(bool(not placebo_fails)) if want_placebo else none,
            "random_cc_within_ci": some(rcc) if rcc is not None else none,
            "data_subset_effect": some(ds_eff) if ds_eff is not None else none,
            "data_subset_std": some(ds_std) if ds_std is not None else none,
            "robustness_value": some(robustness_value),
            "sensitivity": some(sens_struct) if sens_struct is not None else none,
            "expected_sign_ok": expected_sign_ok,
        }))

    overlap: EastStruct = EastStruct({
        "treated_propensity": EastVector(FloatType, th),
        "control_propensity": EastVector(FloatType, ch),
        "common_support_frac": float(support_frac),
        "positivity_ok": bool(positivity_ok),
        "support_strength": variant(support_tag, None, SupportStrengthType),
    })
    balance: EastArray = EastArray(BalanceRowType, [
        EastStruct({
            "column": col, "base_column": base, "treated_mean": mt, "control_mean": mc, "std_diff": sd,
            "std_diff_adjusted": (some(adj_bal[col]) if col in adj_bal
                                  else none),
        })
        for (col, base, mt, mc, sd) in balance_rows
    ])

    dose_response = (_experiment_dose(data, config, outcome, dose_feature)
                     if dose_feature is not None else none)

    result: EastStruct = EastStruct({
        "naive": float(naive),
        "naive_ci": naive_ci,
        "adjusted": adjusted,
        "n_total": int(n_total),
        "n_treated": int(n_t),
        "n_control": int(n_c),
        "n_dropped": n_off_support,
        "balance": balance,
        "overlap": overlap,
        "refutation": refutation,
        "dose_response": dose_response,
        "verdict": verdict,
        "verdict_reasons": EastArray(
            VerdictReasonType, [variant(r, None, VerdictReasonType) for r in reasons]
        ),
        "outcome_sd": float(outcome_sd),
        "materiality_threshold": float(materiality),
        "treated_outcome_mean": treated_mean_opt,
        "control_outcome_mean": control_mean_opt,
    })
    assert_value_of(result, CausalExperimentResultType)
    return result


# ============================================================================
# Validation design — the real trial that would confirm an experiment
# ============================================================================

# Verdict tag → why the trial is sized the way it is. A clear/biased effect is
# sized to the *observed* effect; the fuzzy / refusal cases have no trustworthy
# effect to detect, so they're sized to a materiality threshold instead.
_VERDICT_BASIS = {
    "causal": "detect_observed",
    "modest": "resolve_vs_null",
    "adjustment_insufficient": "de_bias",
    "non_identifiable_positivity": "restrict_to_overlap",
    "not_estimable": "create_control",
}
_BASIS_RATIONALE = {
    "detect_observed": "Randomise {total} units {split} to confirm a {eff} change {pwr} of the time.",
    "de_bias": "A check flagged hidden bias — randomise {total} units {split} to remove it and confirm a {eff} change {pwr} of the time.",
    "resolve_vs_null": "The signal is too faint to call — randomise {total} units {split} to resolve a {eff} change {pwr} of the time.",
    "restrict_to_overlap": "The groups don't overlap — randomise {total} comparable units {split} to measure a {eff} change {pwr} of the time.",
    "create_control": "There's no comparison group — hold back a random control ({split}) of {total} units to detect a {eff} change {pwr} of the time.",
}


def _design_options(d_effect, alpha, target_power, shares, func):
    """Per-share sample sizes (statsmodels two-sample power) → TrialOption structs.

    Uses the normal-approximation power (``NormalIndPower``) — the conventional
    large-sample sizing calc, and numerically stable where the noncentral-t in
    ``TTestIndPower`` overflows to NaN for a large effect.
    """
    from statsmodels.stats.power import NormalIndPower

    solver = NormalIndPower()
    opts = []
    for share in shares:
        share = min(max(float(share), 0.05), 0.95)
        ratio = (1.0 - share) / share  # n_control / n_treated
        try:
            nobs1 = solver.solve_power(
                effect_size=d_effect, alpha=alpha, power=target_power,
                ratio=ratio, alternative="two-sided",
            )
        except Exception:
            nobs1 = float("nan")
        if not np.isfinite(nobs1) or nobs1 <= 0:
            nobs1 = 1_000_000.0  # effect too faint to size sanely — flag with a huge N
        n_treated = int(min(np.ceil(nobs1), 5_000_000))
        n_control = int(min(np.ceil(nobs1 * ratio), 5_000_000))
        label = "Even split" if abs(share - 0.5) < 1e-6 else f"Treat {share:.0%}"
        opts.append((share, n_treated, n_control, n_treated + n_control, label))
    # Even split first, then the rest cheapest-first.
    opts.sort(key=lambda o: (abs(o[0] - 0.5) > 1e-6, o[3]))
    return [
        EastStruct({
            "label": label, "treated_share": float(share),
            "n_treated": n_t, "n_control": n_c, "n_total": n_tot,
        })
        for (share, n_t, n_c, n_tot, label) in opts
    ]


def causal_design_validation_impl(
    data: EastArray, config: EastStruct, result: EastStruct, design_config: EastStruct
) -> EastStruct:
    """Design the real controlled trial that would validate an experiment result.

    Reads the experiment's verdict + adjusted effect + arm sizes + confounder
    balance, and the outcome spread from the data, and returns a randomised-trial
    recipe: how many units, the split option(s), which categories to match the
    groups on, the "chance of detecting it" power curve, and a plain-language
    rationale. The size `basis` (and so the whole recipe's framing) is set by the
    verdict — a clear effect is sized to itself; the fuzzy / refusal cases to a
    materiality threshold. Pure power analysis (statsmodels) — never raises on a
    degenerate result.

    Args:
        data: ``Array<Struct>`` — the rows the experiment ran on.
        config: ``CausalExperimentConfigType`` — names treatment / outcome / confounders.
        result: ``CausalExperimentResultType`` — the experiment whose verdict drives this.
        design_config: ``DesignConfigType`` — optional alpha / power / materiality / splits.

    Returns:
        ``ExperimentDesignType``.
    """
    func = "causal_design_validation"
    _check_statsmodels_support()
    from statsmodels.stats.power import NormalIndPower

    outcome = str(config.get("outcome"))
    alpha = float(design_config["alpha"].unwrap_or(0.05))
    target_power = float(design_config["target_power"].unwrap_or(0.8))
    materiality = design_config["materiality"].unwrap_or(None)
    shares_opt = design_config["treated_shares"].unwrap_or(None)
    shares = [float(s) for s in shares_opt] if shares_opt else [0.5]

    verdict = result.get("verdict")
    verdict_tag = verdict.type
    basis = _VERDICT_BASIS.get(verdict_tag, "resolve_vs_null")

    df = _build_dataframe(data, func)
    _require_columns(df, [outcome], func)
    outcome_sd = float(df[outcome].std()) or 1.0

    # Effect the trial is powered to detect: the observed effect when we trust one
    # (clear / de-bias), else the materiality threshold (a small effect = 0.2·SD by
    # convention) — flagged in the rationale as an assumption to override.
    adjusted = result["adjusted"].unwrap_or(None)
    observed = abs(float(adjusted.get("effect"))) if adjusted is not None else 0.0
    assumed_materiality = float(materiality) if materiality is not None else 0.2 * outcome_sd
    if basis in ("detect_observed", "de_bias") and observed > 1e-9:
        target_effect = observed
    else:
        target_effect = assumed_materiality
    # Clamp the standardised effect so power maths stays finite for tiny effects.
    d_effect = float(min(max(target_effect / outcome_sd, 0.01), 5.0))

    options = _design_options(d_effect, alpha, target_power, shares, func)
    primary = options[0]
    n_total_target = int(primary.get("n_total"))
    primary_share = float(primary.get("treated_share"))
    primary_ratio = (1.0 - primary_share) / primary_share

    # Chance the CURRENT sample would already detect `target_effect` — the "you're
    # here" marker. None when an arm is empty (no comparison group to power from).
    n_t_now = int(result.get("n_treated"))
    n_c_now = int(result.get("n_control"))
    solver = NormalIndPower()
    current_power: EastVariant
    if n_t_now > 1 and n_c_now > 1:
        try:
            cp = float(solver.power(effect_size=d_effect, nobs1=n_t_now,
                                    ratio=n_c_now / n_t_now, alpha=alpha))
        except Exception:
            cp = float("nan")
        if not np.isfinite(cp):
            cp = 0.0
        current_power = some(float(min(max(cp, 0.0), 1.0)))
    else:
        current_power = none

    # The detect-chance curve: total head-count → power, at the primary split, on a
    # grid spanning a small start up to past the target so the target sits inside.
    start = max(20, int(0.15 * n_total_target))
    stop = max(int(1.4 * n_total_target), start * 4)
    grid = sorted({int(x) for x in np.linspace(start, stop, 12)})
    n_pts: list[int] = []
    p_pts: list[float] = []
    for n_tot in grid:
        nobs1 = n_tot * primary_share
        if nobs1 < 2:
            continue
        try:
            p = float(solver.power(effect_size=d_effect, nobs1=nobs1,
                                   ratio=primary_ratio, alpha=alpha))
        except Exception:
            p = float("nan")
        if not np.isfinite(p):
            p = 0.0
        n_pts.append(int(n_tot))
        p_pts.append(float(min(max(p, 0.0), 1.0)))
    power_curve: EastStruct = EastStruct({
        "n": EastVector(IntegerType, np.array(n_pts, dtype=np.int64)),
        "power": EastVector(FloatType, np.array(p_pts, dtype=np.float64)),
    })

    # Match the arms on the confounders that were most lopsided (|SMD| desc),
    # de-duplicated to original column names (categoricals expand to "col=level").
    balance = result.get("balance")
    scored: list[tuple[float, str]] = []
    for row in balance:
        col = str(row.get("column")).split("=", 1)[0]
        scored.append((abs(float(row.get("std_diff"))), col))
    scored.sort(key=lambda s: s[0], reverse=True)
    match_on: list[str] = []
    seen: set[str] = set()
    for smd, col in scored:
        if col in seen:
            continue
        if smd > 0.1 or len(match_on) < 2:  # imbalanced ones, else the top 2
            match_on.append(col)
            seen.add(col)
        if len(match_on) >= 4:
            break

    pct = (current_power.value if current_power.type == "some" else None)
    rationale = _BASIS_RATIONALE[basis].format(
        total=f"{n_total_target:,}",
        split=primary.get("label").lower(),
        eff=f"{target_effect:+.1f}",
        pwr=f"{target_power:.0%}",
    )
    if pct is not None and basis in ("resolve_vs_null",):
        rationale += f" Today's data has only a {pct:.0%} chance of catching it."

    design: EastStruct = EastStruct({
        "verdict": verdict,
        "basis": variant(basis, None, DesignBasisType),
        "target_effect": float(target_effect),
        "outcome_sd": float(outcome_sd),
        "target_power": float(target_power),
        "alpha": float(alpha),
        "current_power": current_power,
        "match_on": EastArray(StringType, match_on),
        "options": EastArray(TrialOptionType, options),
        "power_curve": power_curve,
        "rationale": rationale,
    })
    assert_value_of(design, ExperimentDesignType)
    return design


# ============================================================================
# Platform Function Registration
# ============================================================================

# `causal_effect` / `causal_refute` / `causal_ale` are generic over the row
# struct `T` (their input is `Array<Struct<T>>`, and `T` differs per dataset).
# `@generic_platform_function` registers a *factory* `(platform_list, *T) -> impl`;
# these impls don't depend on `T` (the DataFrame is built from the records), so
# the factory just returns the impl. This helper collapses that boilerplate.
def _register_generic_over_rows(name: str, impl):
    @generic_platform_function(name=name, type_parameters=["T"], is_async=False)
    def _factory(_platform_list, _T):  # noqa: N803
        return impl
    return _factory


# `Causal.experiment` is the sole public causal entry point. The effect / refute
# / ale / dml `*_impl` functions remain as INTERNAL machinery that experiment
# composes (and that the dose-response / CATE widenings will reuse) — they are no
# longer registered as standalone platform functions.
_register_generic_over_rows("causal_experiment", causal_experiment_impl)
_register_generic_over_rows("causal_design_validation", causal_design_validation_impl)

# Collected from the @platform_function / @generic_platform_function decorations above.
causal_impl = platform_functions(__name__)

__all__ = [
    "causal_impl",
]
