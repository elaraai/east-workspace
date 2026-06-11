#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Causal inference implementation.

Backdoor-adjusted effect estimation and refutation (DoWhy), heterogeneous
treatment effects via double machine learning (EconML LinearDML), and
accumulated local effects dose-response curves (PyALE).
"""

import importlib.util
import logging

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
from east.types.values import EastArray, EastBlob, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience.types import _get_option

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
        ("columns", ArrayType(StringType)),
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

The data matrix is interpreted via ``columns``; every column referenced by
``treatment``, ``outcome``, ``common_causes``, ``categorical`` and
``bootstrap.cluster_column`` must appear there. Fields: ``columns``,
``treatment`` (0/1 for psw), ``outcome``, ``common_causes`` (backdoor set),
``categorical`` (integer-coded columns, one-hot encoded internally),
``method`` (default ``linear_regression``), ``target_units`` (default
``ate``), ``trim`` (psw only), ``bootstrap``, ``random_state``.
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
        ("columns", ArrayType(StringType)),
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

Fields: ``columns``, ``outcome`` (emulator target), ``feature`` (continuous
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

CausalEffectResultType = StructType(
    [
        ("effect", FloatType),
        (
            "ci",
            OptionType(StructType([("lower", FloatType), ("upper", FloatType)])),
        ),
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

_HAS_DOWHY_SUPPORT = importlib.util.find_spec("dowhy") is not None
_HAS_ECONML_SUPPORT = importlib.util.find_spec("econml") is not None
_HAS_PYALE_SUPPORT = importlib.util.find_spec("PyALE") is not None


def _check_dowhy_support() -> None:
    """Raise if the causal extra (dowhy) isn't installed."""
    if not _HAS_DOWHY_SUPPORT:
        raise NotImplementedError(
            "Causal effect estimation requires the 'causal' extra. "
            "Add east-py-datascience[causal] to your pyproject.toml dependencies."
        )


def _check_econml_support() -> None:
    """Raise if the causal extra (econml) isn't installed."""
    if not _HAS_ECONML_SUPPORT:
        raise NotImplementedError(
            "DML estimation requires the 'causal' extra. "
            "Add east-py-datascience[causal] to your pyproject.toml dependencies."
        )


def _check_pyale_support() -> None:
    """Raise if the causal extra (PyALE) isn't installed."""
    if not _HAS_PYALE_SUPPORT:
        raise NotImplementedError(
            "ALE curves require the 'causal' extra. "
            "Add east-py-datascience[causal] to your pyproject.toml dependencies."
        )


# ============================================================================
# Data Preparation Helpers
# ============================================================================


def _build_dataframe(data: EastMatrix, columns: EastArray, func_name: str):
    """Build a pandas DataFrame from the data matrix and column names."""
    import pandas as pd

    try:
        data_np = data.to_numpy()
    except Exception as e:
        raise RuntimeError(f"{func_name}: Invalid input data - {e}") from e

    names = [str(c) for c in columns]
    if len(names) != data_np.shape[1]:
        raise RuntimeError(
            f"{func_name}: data has {data_np.shape[1]} columns "
            f"but {len(names)} column names were given"
        )
    if len(set(names)) != len(names):
        raise RuntimeError(f"{func_name}: column names must be unique")
    return pd.DataFrame(data_np, columns=names)


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
    columns = config.get("columns")
    treatment = str(config.get("treatment"))
    outcome = str(config.get("outcome"))
    common_causes = [str(c) for c in config.get("common_causes")]
    categorical_opt = _get_option(config.get("categorical"), None)
    categorical = [str(c) for c in categorical_opt] if categorical_opt is not None else []
    method_variant = _get_option(config.get("method"), None)
    method_tag = "linear_regression" if method_variant is None else method_variant.type
    scheme = "ips_stabilized_weight"
    if method_tag == "propensity_score_weighting":
        scheme_opt = _get_option(method_variant.value.get("weighting_scheme"), None)
        if scheme_opt is not None:
            scheme = scheme_opt.type
    target_variant = _get_option(config.get("target_units"), None)
    target_units = "ate" if target_variant is None else target_variant.type
    trim_variant = _get_option(config.get("trim"), None)
    bootstrap = _get_option(config.get("bootstrap"), None)
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)
    if not common_causes:
        raise RuntimeError(f"{func_name}: common_causes must not be empty")
    return (
        columns, treatment, outcome, common_causes, categorical,
        method_tag, scheme, target_units, trim_variant, bootstrap, random_state,
    )


def _prepare_effect_data(data: EastMatrix, config: EastStruct, func_name: str):
    """Shared data preparation for causal_effect and causal_refute.

    Returns (df, causes, method_tag, scheme, target_units, bootstrap, random_state).
    Trimming is already applied to the returned df.
    """
    (
        columns, treatment, outcome, common_causes, categorical,
        method_tag, scheme, target_units, trim_variant, bootstrap, random_state,
    ) = _extract_effect_config(config, func_name)

    df = _build_dataframe(data, columns, func_name)
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
    cluster_column = _get_option(bootstrap.get("cluster_column"), None)
    confidence_level = float(_get_option(bootstrap.get("confidence_level"), 0.95))
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


@platform_function(
    name="causal_effect",
    inputs=[MatrixType(FloatType), CausalEffectConfigType],
    output=CausalEffectResultType,
)
def causal_effect_impl(data: EastMatrix, config: EastStruct) -> EastStruct:
    """Estimate a backdoor-adjusted causal effect of treatment on outcome.

    Identifies the effect with DoWhy given the common causes, then estimates
    it by linear regression or inverse propensity score weighting, optionally
    trimming to propensity common support and attaching a (cluster) bootstrap
    percentile confidence interval.

    Args:
        data: ``Matrix<Float>`` (``EastMatrix``) - one row per unit, columns
            named by ``config["columns"]``.
        config: ``CausalEffectConfigType`` (``EastStruct``) with fields:

            - ``columns`` (``Array<String>``): name per data column.
            - ``treatment`` (``String``): treatment column; must hold 0/1 for
              propensity score weighting.
            - ``outcome`` (``String``): outcome column.
            - ``common_causes`` (``Array<String>``): confounders to adjust for.
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

    ci_variant = EastVariant("none", None)
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
        ci_variant = EastVariant("some", EastStruct({"lower": lower, "upper": upper}))

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


@platform_function(
    name="causal_refute",
    inputs=[MatrixType(FloatType), CausalEffectConfigType, CausalRefuterType],
    output=CausalRefuteResultType,
)
def causal_refute_impl(
    data: EastMatrix, config: EastStruct, refuter: EastVariant
) -> EastStruct:
    """Refute an estimated causal effect with a DoWhy refutation test.

    Re-runs the estimation from ``config`` (same semantics as
    :func:`causal_effect_impl`, bootstrap ignored), then applies the refuter.

    Args:
        data: ``Matrix<Float>`` (``EastMatrix``) - one row per unit.
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
            num_simulations = _get_option(refuter_config.get("num_simulations"), None)
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
                    _get_option(refuter_config.get("subset_fraction"), 0.8)
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
            "p_value": EastVariant("some", p_value) if p_value is not None else EastVariant("none", None),
        }
    )


# ============================================================================
# Double Machine Learning (EconML LinearDML)
# ============================================================================


def _create_nuisance_model(variant: EastVariant | None, classifier: bool, random_state):
    """Build a nuisance model from CausalNuisanceModelType (default random forest)."""
    tag = "random_forest" if variant is None else variant.type
    cfg = None if variant is None else variant.value

    if tag == "random_forest":
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

        kwargs = {
            "n_estimators": int(_get_option(cfg.get("n_estimators"), 100)) if cfg else 100,
            "min_samples_leaf": int(_get_option(cfg.get("min_samples_leaf"), 5)) if cfg else 5,
            "random_state": random_state,
        }
        max_depth = _get_option(cfg.get("max_depth"), None) if cfg else None
        if max_depth is not None:
            kwargs["max_depth"] = int(max_depth)
        return RandomForestClassifier(**kwargs) if classifier else RandomForestRegressor(**kwargs)

    if tag == "gradient_boosting":
        from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor

        kwargs = {
            "n_estimators": int(_get_option(cfg.get("n_estimators"), 100)),
            "learning_rate": float(_get_option(cfg.get("learning_rate"), 0.1)),
            "max_depth": int(_get_option(cfg.get("max_depth"), 3)),
            "random_state": random_state,
        }
        return GradientBoostingClassifier(**kwargs) if classifier else GradientBoostingRegressor(**kwargs)

    from sklearn.linear_model import LinearRegression, LogisticRegression

    if classifier:
        return LogisticRegression(max_iter=1000, random_state=random_state)
    return LinearRegression()


@platform_function(
    name="causal_dml_train",
    inputs=[
        VectorType(FloatType),
        VectorType(FloatType),
        MatrixType(FloatType),
        OptionType(MatrixType(FloatType)),
        CausalDMLConfigType,
    ],
    output=CausalDMLModelBlobType,
)
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

    try:
        Y_np = Y.to_numpy()
        T_np = T.to_numpy()
        X_np = X.to_numpy()
        W_opt = _get_option(W, None)
        W_np = W_opt.to_numpy() if W_opt is not None else None
    except Exception as e:
        raise RuntimeError(f"{func_name}: Invalid input data - {e}") from e

    if Y_np.shape[0] != T_np.shape[0] or Y_np.shape[0] != X_np.shape[0]:
        raise RuntimeError(
            f"{func_name}: Y has {Y_np.shape[0]} samples, T has {T_np.shape[0]}, "
            f"X has {X_np.shape[0]} - all must match"
        )
    if W_np is not None and W_np.shape[0] != Y_np.shape[0]:
        raise RuntimeError(
            f"{func_name}: W has {W_np.shape[0]} samples but Y has {Y_np.shape[0]}"
        )

    discrete_treatment = bool(_get_option(config.get("discrete_treatment"), False))
    cv_folds = int(_get_option(config.get("cv_folds"), 2))
    confidence_level = float(_get_option(config.get("confidence_level"), 0.95))
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    model_y = _create_nuisance_model(
        _get_option(config.get("model_y"), None), classifier=False, random_state=random_state
    )
    model_t = _create_nuisance_model(
        _get_option(config.get("model_t"), None),
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

    import cloudpickle

    return EastVariant(
        "causal_dml",
        EastStruct(
            {
                "data": EastBlob(cloudpickle.dumps(est)),
                "n_features_x": X_np.shape[1],
                "confidence_level": confidence_level,
            }
        ),
    )


def _load_dml_model(model_blob: EastVariant, X: EastMatrix, func_name: str):
    """Deserialize a DML blob and validate X; returns (est, X_np, confidence_level)."""
    import cloudpickle

    model_data = model_blob.value
    est = cloudpickle.loads(bytes(model_data.get("data")))
    n_features_x = model_data.get("n_features_x")
    confidence_level = float(model_data.get("confidence_level"))

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"{func_name}: Invalid input data - {e}") from e
    if X_np.shape[1] != n_features_x:
        raise RuntimeError(
            f"{func_name}: Model trained with {n_features_x} X features "
            f"but X has {X_np.shape[1]} features"
        )
    return est, X_np, confidence_level


@platform_function(
    name="causal_dml_effect",
    inputs=[CausalDMLModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
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


@platform_function(
    name="causal_dml_ate",
    inputs=[CausalDMLModelBlobType, MatrixType(FloatType)],
    output=CausalATEResultType,
)
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


@platform_function(
    name="causal_ale",
    inputs=[MatrixType(FloatType), CausalALEConfigType],
    output=ALEResultType,
)
def causal_ale_impl(data: EastMatrix, config: EastStruct) -> EastStruct:
    """Accumulated local effects dose-response curve of a feature on an outcome.

    Fits a HistGradientBoosting emulator of the outcome on all non-outcome
    columns, then computes the PyALE curve of the feature - robust to
    correlated features, unlike partial dependence.

    Args:
        data: ``Matrix<Float>`` (``EastMatrix``) - one row per unit, columns
            named by ``config["columns"]``.
        config: ``CausalALEConfigType`` (``EastStruct``) with fields:

            - ``columns`` (``Array<String>``): name per data column.
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
    categorical_opt = _get_option(config.get("categorical"), None)
    categorical = [str(c) for c in categorical_opt] if categorical_opt is not None else []
    grid_size = int(_get_option(config.get("grid_size"), 10))
    include_ci = bool(_get_option(config.get("include_ci"), True))
    confidence_level = float(_get_option(config.get("confidence_level"), 0.95))
    emulator = _get_option(config.get("emulator"), None)
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    df = _build_dataframe(data, config.get("columns"), func_name)
    _require_columns(df, [outcome, feature], func_name)
    if outcome == feature:
        raise RuntimeError(f"{func_name}: outcome and feature must differ")
    df, _ = _encode_categoricals(df, categorical, [outcome, feature], func_name)

    y = df[outcome].to_numpy()
    X_df = df.drop(columns=[outcome])

    try:
        from sklearn.ensemble import HistGradientBoostingRegressor

        hgb_kwargs = {
            "max_iter": int(_get_option(emulator.get("n_estimators"), 300)) if emulator else 300,
            "learning_rate": float(_get_option(emulator.get("learning_rate"), 0.05)) if emulator else 0.05,
            "random_state": random_state,
        }
        max_depth = _get_option(emulator.get("max_depth"), None) if emulator else None
        if max_depth is not None:
            hgb_kwargs["max_depth"] = int(max_depth)
        min_samples_leaf = _get_option(emulator.get("min_samples_leaf"), None) if emulator else None
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

    lower_variant = EastVariant("none", None)
    upper_variant = EastVariant("none", None)
    if include_ci:
        lower_cols = [c for c in res.columns if str(c).startswith("lowerCI")]
        upper_cols = [c for c in res.columns if str(c).startswith("upperCI")]
        if lower_cols and upper_cols:
            lower_variant = EastVariant(
                "some", EastVector(FloatType, res[lower_cols[0]].to_numpy(dtype=np.float64))
            )
            upper_variant = EastVariant(
                "some", EastVector(FloatType, res[upper_cols[0]].to_numpy(dtype=np.float64))
            )

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
# Platform Function Registration
# ============================================================================

# Collected from the @platform_function decorations above.
causal_impl = platform_functions(__name__)

__all__ = [
    "causal_impl",
]
