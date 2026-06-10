/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Causal inference for East.
 *
 * Provides causal effect estimation (DoWhy backdoor adjustment),
 * refutation tests, heterogeneous treatment effects (EconML LinearDML),
 * and accumulated local effects dose-response curves (PyALE).
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    IntegerType,
    FloatType,
    BooleanType,
    StringType,
    BlobType,
    NullType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";

// ============================================================================
// Config Types
// ============================================================================

/**
 * Inverse propensity weighting scheme for the propensity score
 * weighting estimator.
 */
export const CausalWeightingSchemeType = VariantType({
    /** Raw inverse propensity weights */
    ips_weight: NullType,
    /** Stabilized inverse propensity weights (recommended; lower variance) */
    ips_stabilized_weight: NullType,
    /** Normalized inverse propensity weights */
    ips_normalized_weight: NullType,
});

/**
 * Backdoor-adjusted effect estimator.
 */
export const CausalEstimatorType = VariantType({
    /** Linear regression of outcome on treatment + common causes */
    linear_regression: NullType,
    /** Inverse propensity score weighting (binary treatment only) */
    propensity_score_weighting: StructType({
        /** Weighting scheme (default: ips_stabilized_weight) */
        weighting_scheme: OptionType(CausalWeightingSchemeType),
    }),
});

/**
 * Population the effect is estimated for.
 */
export const CausalTargetUnitsType = VariantType({
    /** Average treatment effect over all units */
    ate: NullType,
    /** Average treatment effect on the treated */
    att: NullType,
    /** Average treatment effect on the controls */
    atc: NullType,
});

/**
 * Propensity-based sample trimming applied before estimation
 * (propensity score weighting only).
 */
export const PropensityTrimType = VariantType({
    /** Keep units inside the common-support overlap of treated and control propensities */
    overlap: NullType,
    /** Keep units with propensity inside explicit bounds */
    bounds: StructType({
        /** Minimum propensity score to keep */
        lower: FloatType,
        /** Maximum propensity score to keep */
        upper: FloatType,
    }),
});

/**
 * Bootstrap confidence interval configuration.
 *
 * When `cluster_column` is set, whole clusters are resampled with
 * replacement (the cluster is the exchangeable unit) — use this when rows
 * are autocorrelated within a group (e.g. days within a batch).
 */
export const CausalBootstrapConfigType = StructType({
    /** Number of bootstrap replicates */
    reps: IntegerType,
    /** Column whose values identify clusters to resample (default: resample rows) */
    cluster_column: OptionType(StringType),
    /** Confidence level for the percentile interval (default 0.95) */
    confidence_level: OptionType(FloatType),
});

/**
 * Configuration for backdoor-adjusted causal effect estimation.
 *
 * The data matrix is interpreted via `columns`: every column referenced by
 * `treatment`, `outcome`, `common_causes`, `categorical` and
 * `bootstrap.cluster_column` must appear in `columns`. Categorical columns
 * hold integer-valued category codes and are one-hot encoded internally.
 */
export const CausalEffectConfigType = StructType({
    /** Column names for the data matrix (one per column, in order) */
    columns: ArrayType(StringType),
    /** Treatment column (must be 0/1 for propensity score weighting) */
    treatment: StringType,
    /** Outcome column */
    outcome: StringType,
    /** Confounder columns to adjust for (the backdoor set) */
    common_causes: ArrayType(StringType),
    /** Columns holding integer category codes, one-hot encoded internally */
    categorical: OptionType(ArrayType(StringType)),
    /** Effect estimator (default: linear_regression) */
    method: OptionType(CausalEstimatorType),
    /** Target population (default: ate) */
    target_units: OptionType(CausalTargetUnitsType),
    /** Propensity trimming applied before estimation (psw only) */
    trim: OptionType(PropensityTrimType),
    /** Bootstrap confidence interval (omit to skip CI computation) */
    bootstrap: OptionType(CausalBootstrapConfigType),
    /** Random seed for propensity fitting and bootstrap resampling */
    random_state: OptionType(IntegerType),
});

/**
 * Refutation test for an estimated causal effect.
 */
export const CausalRefuterType = VariantType({
    /** Replace treatment with a permuted placebo - effect should vanish */
    placebo_treatment: StructType({
        /** Number of simulations (default 100) */
        num_simulations: OptionType(IntegerType),
    }),
    /** Add an independent random common cause - effect should be unchanged */
    random_common_cause: StructType({
        /** Number of simulations (default 100) */
        num_simulations: OptionType(IntegerType),
    }),
    /** Re-estimate on random data subsets - effect should be stable */
    data_subset: StructType({
        /** Fraction of rows kept per simulation (default 0.8) */
        subset_fraction: OptionType(FloatType),
        /** Number of simulations (default 100) */
        num_simulations: OptionType(IntegerType),
    }),
    /**
     * Simulate an unobserved confounder at each given strength - a
     * sensitivity/tipping curve. Strength acts on both treatment
     * (flip probability for binary treatment, linear coefficient otherwise)
     * and outcome (linear coefficient).
     */
    unobserved_common_cause: StructType({
        /** Confounder effect strengths to simulate, one new effect per entry */
        effect_strengths: ArrayType(FloatType),
    }),
});

/**
 * Nuisance model for DML residualization stages.
 */
export const CausalNuisanceModelType = VariantType({
    /** Random forest (regressor, or classifier for a discrete treatment) */
    random_forest: StructType({
        /** Number of trees (default 100) */
        n_estimators: OptionType(IntegerType),
        /** Minimum samples per leaf (default 5) */
        min_samples_leaf: OptionType(IntegerType),
        /** Maximum tree depth (default unlimited) */
        max_depth: OptionType(IntegerType),
    }),
    /** Gradient boosting (regressor, or classifier for a discrete treatment) */
    gradient_boosting: StructType({
        /** Number of boosting stages (default 100) */
        n_estimators: OptionType(IntegerType),
        /** Learning rate (default 0.1) */
        learning_rate: OptionType(FloatType),
        /** Maximum tree depth (default 3) */
        max_depth: OptionType(IntegerType),
    }),
    /** Linear/logistic regression */
    linear: NullType,
});

/**
 * Configuration for double machine learning (EconML LinearDML).
 */
export const CausalDMLConfigType = StructType({
    /** Nuisance model for the outcome stage (default: random_forest) */
    model_y: OptionType(CausalNuisanceModelType),
    /** Nuisance model for the treatment stage (default: random_forest) */
    model_t: OptionType(CausalNuisanceModelType),
    /** Treat the treatment as discrete/categorical (default false) */
    discrete_treatment: OptionType(BooleanType),
    /** Cross-fitting folds (default 2) */
    cv_folds: OptionType(IntegerType),
    /** Confidence level for effect/ATE intervals (default 0.95) */
    confidence_level: OptionType(FloatType),
    /** Random seed */
    random_state: OptionType(IntegerType),
});

/**
 * Configuration for an accumulated local effects (ALE) dose-response curve.
 *
 * Fits a gradient-boosting emulator of the outcome on all non-outcome
 * columns, then computes the correlation-robust ALE curve of `feature`.
 */
export const CausalALEConfigType = StructType({
    /** Column names for the data matrix (one per column, in order) */
    columns: ArrayType(StringType),
    /** Outcome column the emulator predicts */
    outcome: StringType,
    /** Continuous feature column to compute the ALE curve for */
    feature: StringType,
    /** Columns holding integer category codes, one-hot encoded internally */
    categorical: OptionType(ArrayType(StringType)),
    /** Number of grid intervals (default 10) */
    grid_size: OptionType(IntegerType),
    /** Include confidence intervals (default true) */
    include_ci: OptionType(BooleanType),
    /** Confidence level for the CI (default 0.95) */
    confidence_level: OptionType(FloatType),
    /** Emulator (HistGradientBoosting) hyperparameters */
    emulator: OptionType(StructType({
        /** Number of boosting iterations (default 300) */
        n_estimators: OptionType(IntegerType),
        /** Learning rate (default 0.05) */
        learning_rate: OptionType(FloatType),
        /** Maximum tree depth (default unlimited) */
        max_depth: OptionType(IntegerType),
        /** Minimum samples per leaf (default 20; lower for small datasets) */
        min_samples_leaf: OptionType(IntegerType),
    })),
    /** Random seed for the emulator */
    random_state: OptionType(IntegerType),
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob for a fitted LinearDML estimator.
 */
export const CausalDMLModelBlobType = VariantType({
    /** Fitted EconML LinearDML estimator */
    causal_dml: StructType({
        /** Serialized estimator (cloudpickle) */
        data: BlobType,
        /** Number of effect-modifier (X) features */
        n_features_x: IntegerType,
        /** Confidence level used for effect/ATE intervals */
        confidence_level: FloatType,
    }),
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * Estimated causal effect.
 */
export const CausalEffectResultType = StructType({
    /** Point estimate of the effect (outcome units per treatment unit) */
    effect: FloatType,
    /** Bootstrap percentile confidence interval (present when bootstrap configured) */
    ci: OptionType(StructType({
        /** Lower bound */
        lower: FloatType,
        /** Upper bound */
        upper: FloatType,
    })),
    /** Rows used for estimation (after trimming) */
    n_samples: IntegerType,
    /** Treated rows used */
    n_treated: IntegerType,
    /** Control rows used */
    n_control: IntegerType,
});

/**
 * Refutation test result.
 */
export const CausalRefuteResultType = StructType({
    /** The original estimated effect being refuted */
    estimated_effect: FloatType,
    /**
     * Effect under the refutation. One entry for placebo/random-common-cause/
     * data-subset; one entry per strength for unobserved_common_cause.
     */
    new_effects: VectorType(FloatType),
    /** Refutation p-value where the refuter provides one */
    p_value: OptionType(FloatType),
});

/**
 * Average treatment effect with confidence interval.
 */
export const CausalATEResultType = StructType({
    /** Average treatment effect over the given X */
    ate: FloatType,
    /** Lower bound at the model's confidence level */
    lower: FloatType,
    /** Upper bound at the model's confidence level */
    upper: FloatType,
});

/**
 * Accumulated local effects curve.
 */
export const ALEResultType = StructType({
    /** Feature grid values (interval edges) */
    grid: VectorType(FloatType),
    /** Centered ALE effect at each grid value (outcome units) */
    effect: VectorType(FloatType),
    /** Lower CI at each grid value (present when include_ci) */
    lower: OptionType(VectorType(FloatType)),
    /** Upper CI at each grid value (present when include_ci) */
    upper: OptionType(VectorType(FloatType)),
    /** Number of samples in each grid interval */
    size: VectorType(IntegerType),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Estimate a backdoor-adjusted causal effect of treatment on outcome.
 *
 * Identifies the effect with DoWhy given the common causes, then estimates
 * it by linear regression or inverse propensity score weighting. Optionally
 * trims to propensity common support and computes a (cluster) bootstrap
 * confidence interval.
 *
 * @param data - Data matrix (rows = units, columns named by config.columns)
 * @param config - Estimation configuration
 * @returns Effect estimate with optional CI and sample counts
 */
export const causal_effect = East.platform(
    "causal_effect",
    [MatrixType(FloatType), CausalEffectConfigType],
    CausalEffectResultType
);

/**
 * Refute an estimated causal effect.
 *
 * Re-estimates the effect from `config`, then applies the given refuter
 * (placebo treatment, random common cause, data subset, or simulated
 * unobserved confounder sensitivity curve).
 *
 * @param data - Data matrix (rows = units, columns named by config.columns)
 * @param config - Estimation configuration (same as causal_effect)
 * @param refuter - Refutation test to apply
 * @returns Original effect, refuted effect(s), and p-value where available
 */
export const causal_refute = East.platform(
    "causal_refute",
    [MatrixType(FloatType), CausalEffectConfigType, CausalRefuterType],
    CausalRefuteResultType
);

/**
 * Fit an EconML LinearDML estimator for heterogeneous treatment effects.
 *
 * Cross-fits nuisance models for outcome and treatment, then fits a linear
 * CATE model on the residuals.
 *
 * @param Y - Outcome vector
 * @param T - Treatment vector
 * @param X - Effect modifier matrix (CATE varies with these)
 * @param W - Additional confounders adjusted for but not modifying the effect
 * @param config - DML configuration
 * @returns Model blob for use with dmlEffect / dmlAte
 */
export const causal_dml_train = East.platform(
    "causal_dml_train",
    [VectorType(FloatType), VectorType(FloatType), MatrixType(FloatType), OptionType(MatrixType(FloatType)), CausalDMLConfigType],
    CausalDMLModelBlobType
);

/**
 * Per-row conditional average treatment effects (CATE) from a fitted DML model.
 *
 * @param model - Fitted DML model blob
 * @param X - Effect modifier matrix
 * @returns CATE per row (outcome units per treatment unit)
 */
export const causal_dml_effect = East.platform(
    "causal_dml_effect",
    [CausalDMLModelBlobType, MatrixType(FloatType)],
    VectorType(FloatType)
);

/**
 * Average treatment effect with confidence interval from a fitted DML model.
 *
 * @param model - Fitted DML model blob
 * @param X - Effect modifier matrix to average over
 * @returns ATE with interval at the confidence level configured at training
 */
export const causal_dml_ate = East.platform(
    "causal_dml_ate",
    [CausalDMLModelBlobType, MatrixType(FloatType)],
    CausalATEResultType
);

/**
 * Accumulated local effects dose-response curve of a feature on an outcome.
 *
 * Fits a gradient boosting emulator on all non-outcome columns, then
 * computes the ALE curve of the feature - robust to correlated features,
 * unlike partial dependence.
 *
 * @param data - Data matrix (rows = units, columns named by config.columns)
 * @param config - ALE configuration
 * @returns ALE curve with grid, centered effect, optional CI, and bin sizes
 */
export const causal_ale = East.platform(
    "causal_ale",
    [MatrixType(FloatType), CausalALEConfigType],
    ALEResultType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for causal inference functions.
 */
export const CausalTypes = {
    // Config types
    CausalWeightingSchemeType,
    CausalEstimatorType,
    CausalTargetUnitsType,
    PropensityTrimType,
    CausalBootstrapConfigType,
    CausalEffectConfigType,
    CausalRefuterType,
    CausalNuisanceModelType,
    CausalDMLConfigType,
    CausalALEConfigType,
    // Model blob types
    CausalDMLModelBlobType,
    // Result types
    CausalEffectResultType,
    CausalRefuteResultType,
    CausalATEResultType,
    ALEResultType,
} as const;

/**
 * Causal inference.
 *
 * Backdoor-adjusted effect estimation and refutation (DoWhy),
 * heterogeneous treatment effects via double machine learning
 * (EconML LinearDML), and accumulated local effects dose-response
 * curves (PyALE).
 *
 * @example
 * ```ts
 * import { East, FloatType, variant } from "@elaraai/east";
 * import { Causal, MatrixType } from "@elaraai/east-py-datascience";
 *
 * const estimate = East.function(
 *     [MatrixType(FloatType)],
 *     Causal.Types.CausalEffectResultType,
 *     ($, data) => {
 *         const config = $.let({
 *             columns: ["treated", "outcome", "confounder"],
 *             treatment: "treated",
 *             outcome: "outcome",
 *             common_causes: ["confounder"],
 *             categorical: variant('none', null),
 *             method: variant('some', variant('linear_regression', null)),
 *             target_units: variant('some', variant('ate', null)),
 *             trim: variant('none', null),
 *             bootstrap: variant('none', null),
 *             random_state: variant('some', 42n),
 *         }, Causal.Types.CausalEffectConfigType);
 *         return $.return(Causal.effect(data, config));
 *     }
 * );
 * ```
 */
export const Causal = {
    /**
     * Estimate a backdoor-adjusted causal effect of treatment on outcome.
     *
     * Linear regression or inverse propensity score weighting (with
     * optional propensity trimming), plus optional cluster bootstrap CI.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Causal, CausalEffectConfigType, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const attEstimate = East.function(
     *     [MatrixType(FloatType)],
     *     Causal.Types.CausalEffectResultType,
     *     ($, data) => {
     *         const config = $.let({
     *             columns: ["treated", "outcome", "z1", "z2", "batch"],
     *             treatment: "treated",
     *             outcome: "outcome",
     *             common_causes: ["z1", "z2"],
     *             categorical: variant('none', null),
     *             method: variant('some', variant('propensity_score_weighting', {
     *                 weighting_scheme: variant('some', variant('ips_stabilized_weight', null)),
     *             })),
     *             target_units: variant('some', variant('att', null)),
     *             trim: variant('some', variant('overlap', null)),
     *             bootstrap: variant('some', {
     *                 reps: 200n,
     *                 cluster_column: variant('some', "batch"),
     *                 confidence_level: variant('some', 0.95),
     *             }),
     *             random_state: variant('some', 42n),
     *         }, CausalEffectConfigType);
     *         return $.return(Causal.effect(data, config));
     *     }
     * );
     * ```
     */
    effect: causal_effect,
    /**
     * Refute an estimated causal effect with placebo, random common cause,
     * data subset, or unobserved-confounder sensitivity tests.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Causal, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const placebo = East.function(
     *     [MatrixType(FloatType), Causal.Types.CausalEffectConfigType],
     *     Causal.Types.CausalRefuteResultType,
     *     ($, data, config) => {
     *         const refuter = $.let(variant('placebo_treatment', {
     *             num_simulations: variant('some', 50n),
     *         }), Causal.Types.CausalRefuterType);
     *         // new_effects should be near zero if the estimate is causal
     *         return $.return(Causal.refute(data, config, refuter));
     *     }
     * );
     * ```
     */
    refute: causal_refute,
    /**
     * Fit an EconML LinearDML estimator for heterogeneous treatment effects.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Causal, CausalDMLConfigType, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function(
     *     [VectorType(FloatType), VectorType(FloatType), MatrixType(FloatType), MatrixType(FloatType)],
     *     Causal.Types.CausalDMLModelBlobType,
     *     ($, Y, T, X, W) => {
     *         const config = $.let({
     *             model_y: variant('some', variant('random_forest', {
     *                 n_estimators: variant('some', 100n),
     *                 min_samples_leaf: variant('some', 5n),
     *                 max_depth: variant('none', null),
     *             })),
     *             model_t: variant('none', null),
     *             discrete_treatment: variant('none', null),
     *             cv_folds: variant('some', 2n),
     *             confidence_level: variant('some', 0.95),
     *             random_state: variant('some', 42n),
     *         }, CausalDMLConfigType);
     *         return $.return(Causal.dmlTrain(Y, T, X, variant('some', W), config));
     *     }
     * );
     * ```
     */
    dmlTrain: causal_dml_train,
    /**
     * Per-row conditional average treatment effects from a fitted DML model.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Causal, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const cate = East.function(
     *     [Causal.Types.CausalDMLModelBlobType, MatrixType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, X) => $.return(Causal.dmlEffect(model, X))
     * );
     * ```
     */
    dmlEffect: causal_dml_effect,
    /**
     * Average treatment effect with confidence interval from a fitted DML model.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Causal, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const ate = East.function(
     *     [Causal.Types.CausalDMLModelBlobType, MatrixType(FloatType)],
     *     Causal.Types.CausalATEResultType,
     *     ($, model, X) => $.return(Causal.dmlAte(model, X))
     * );
     * ```
     */
    dmlAte: causal_dml_ate,
    /**
     * Accumulated local effects dose-response curve of a feature on an outcome.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Causal, CausalALEConfigType, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const doseResponse = East.function(
     *     [MatrixType(FloatType)],
     *     Causal.Types.ALEResultType,
     *     ($, data) => {
     *         const config = $.let({
     *             columns: ["dose", "z", "response"],
     *             outcome: "response",
     *             feature: "dose",
     *             categorical: variant('none', null),
     *             grid_size: variant('some', 10n),
     *             include_ci: variant('some', true),
     *             confidence_level: variant('some', 0.95),
     *             emulator: variant('none', null),
     *             random_state: variant('some', 42n),
     *         }, CausalALEConfigType);
     *         return $.return(Causal.ale(data, config));
     *     }
     * );
     * ```
     */
    ale: causal_ale,
    /** Type definitions */
    Types: CausalTypes,
} as const;
