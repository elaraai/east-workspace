/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Causal inference for East.
 *
 * One declarative entry point — {@link Causal.experiment} — answers *"did X
 * change Y, and can I trust it?"* for a binary treatment: the naive vs
 * backdoor-adjusted effect, confounder balance, propensity overlap, a
 * robustness check, and an honesty **verdict** that refuses (`adjusted = none`)
 * when the data can't support an answer. The raw DoWhy / EconML / PyALE
 * estimators are internal implementation it composes — not a public surface.
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
    NullType,
} from "@elaraai/east";
import { VectorType } from "../types.js";

// Re-export shared types for convenience
export { VectorType } from "../types.js";

// ============================================================================
// Shared vocabulary
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
    /** Linear regression of outcome on treatment + common causes (default) */
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
 * Bootstrap confidence interval configuration.
 *
 * When `cluster_column` is set, whole clusters are resampled with replacement
 * (the cluster is the exchangeable unit) — use this when rows are autocorrelated
 * within a group.
 */
export const CausalBootstrapConfigType = StructType({
    /** Number of bootstrap replicates (default 200) */
    reps: IntegerType,
    /** Column whose values identify clusters to resample (default: resample rows) */
    cluster_column: OptionType(StringType),
    /** Confidence level for the percentile interval (default 0.95) */
    confidence_level: OptionType(FloatType),
});

/** A confidence interval — the one CI type used across the result. */
export const CiType = StructType({ lower: FloatType, upper: FloatType });

// ============================================================================
// Experiment — the single declarative entry point (snake_case; mirrors the
// e3-ui `<Experiment>` contract exactly so the two replicas unify structurally).
// ============================================================================

/**
 * Which robustness checks to run inside {@link causal_experiment}.
 */
export const RefuteSpecType = StructType({
    /** Permuted-treatment negative control — a real effect should vanish. */
    placebo: BooleanType,
    /** Inject an independent random common cause — the effect should hold. */
    random_common_cause: BooleanType,
    /** Re-estimate on random subsamples — the effect should be stable. */
    data_subset: BooleanType,
    /** Unobserved-confounder strengths to simulate → the sensitivity / tipping curve. */
    sensitivity: OptionType(ArrayType(FloatType)),
});

/**
 * Configuration for {@link causal_experiment} — the staged "question + method"
 * the surface edits. Binary treatment only (v1). Reuses the estimator / target
 * / bootstrap vocabularies.
 */
export const CausalExperimentConfigType = StructType({
    /** Binary (0/1) treatment column. */
    treatment: StringType,
    /** Outcome column. */
    outcome: StringType,
    /** Confounders to adjust for (the backdoor set). */
    common_causes: ArrayType(StringType),
    /** Confounder columns holding categories (string or int codes), one-hot encoded. */
    categorical: OptionType(ArrayType(StringType)),
    /** Estimator (default: linear_regression). */
    method: OptionType(CausalEstimatorType),
    /** Target population (default: ate). */
    estimand: OptionType(CausalTargetUnitsType),
    /** Which robustness checks to run. */
    refute: OptionType(RefuteSpecType),
    /** Continuous column for the ALE dose-response curve (the "How much?" view). */
    dose_feature: OptionType(StringType),
    /** Positivity guard — common-support fraction below this → non_identifiable_positivity (default 0.10). */
    min_overlap: OptionType(FloatType),
    /** Not-estimable guard — minority-arm fraction below this → not_estimable (default 0.02). */
    min_treatment_variation: OptionType(FloatType),
    /** Bootstrap CI config (default: 200 reps, 0.95). */
    bootstrap: OptionType(CausalBootstrapConfigType),
    /** Random seed. */
    random_state: OptionType(IntegerType),
});

/** One confounder's before-adjustment imbalance (categoricals → one row per level). */
export const BalanceRowType = StructType({
    column: StringType,
    /** The original confounder this row belongs to — equals `column` for a numeric
     *  confounder; the base confounder for a one-hot categorical level. */
    base_column: StringType,
    treated_mean: FloatType,
    control_mean: FloatType,
    /** Standardized mean difference, (mt-mc)/sqrt((vt+vc)/2). */
    std_diff: FloatType,
});

/** Positivity / common-support diagnostic (binary treatment). */
export const OverlapDiagnosticType = StructType({
    /** Propensity histogram (20 bins over [0,1]) for the treated arm. */
    treated_propensity: VectorType(FloatType),
    /** Propensity histogram for the control arm. */
    control_propensity: VectorType(FloatType),
    /** Fraction of rows inside the treated/control common support. */
    common_support_frac: FloatType,
    /** Whether common support clears `min_overlap`. */
    positivity_ok: BooleanType,
});

/** The robustness summary the verdict + Trust tab consume. */
export const RefutationType = StructType({
    /** Effect under a permuted (placebo) treatment — should be ≈ 0. */
    placebo_effect: OptionType(FloatType),
    /** Whether the placebo effect vanished. */
    placebo_passes: OptionType(BooleanType),
    /** Whether a decoy random common cause left the estimate inside its CI. */
    random_cc_within_ci: OptionType(BooleanType),
    /** Mean effect across data subsamples (stability). */
    data_subset_effect: OptionType(FloatType),
    /** Std of the effect across data subsamples. */
    data_subset_std: OptionType(FloatType),
    /** Closed-form E-value — confounder strength needed to explain the effect away. */
    robustness_value: OptionType(FloatType),
    /** Unobserved-confounder sensitivity (tipping) curve: effect at each simulated strength. */
    sensitivity: OptionType(StructType({
        strengths: VectorType(FloatType),
        effects: VectorType(FloatType),
    })),
});

/** A dose-response (ALE) curve of a continuous feature on the outcome. */
export const DoseResponseType = StructType({
    feature: StringType,
    grid: VectorType(FloatType),
    effect: VectorType(FloatType),
    lower: OptionType(VectorType(FloatType)),
    upper: OptionType(VectorType(FloatType)),
    /** Rows per dose bin — drives the surface's "you are here" (busiest bin) marker. */
    size: VectorType(IntegerType),
});

/**
 * The honesty verdict — a thin tag; the numbers live top-level on the result.
 * Only `not_estimable` carries a (human-readable) reason.
 */
export const ExperimentVerdictType = VariantType({
    /** A real, robust, material effect. */
    causal: NullType,
    /** A small but real effect, or no clear effect after adjustment. */
    modest: NullType,
    /** Adjusted, but the estimate isn't trustworthy (placebo fails). */
    adjustment_insufficient: NullType,
    /** No like-for-like comparison exists (positivity violated). */
    non_identifiable_positivity: NullType,
    /** The estimand can't be formed (treatment barely varies). */
    not_estimable: StringType,
});

/**
 * The complete, honest result of {@link causal_experiment}. `adjusted` is
 * `none` when the engine refuses (positivity / no-variation); the `verdict` tag
 * carries the headline; every word/colour on the surface derives from these numbers.
 */
export const CausalExperimentResultType = StructType({
    /** The raw (unadjusted) mean difference — always computable. */
    naive: FloatType,
    naive_ci: OptionType(CiType),
    /** The adjusted (like-for-like) effect + CI; `none` ⇒ the engine refused. */
    adjusted: OptionType(StructType({ effect: FloatType, ci: OptionType(CiType) })),
    n_total: IntegerType,
    n_treated: IntegerType,
    n_control: IntegerType,
    n_dropped: IntegerType,
    /** Per-confounder before-adjustment imbalance, most-imbalanced first. */
    balance: ArrayType(BalanceRowType),
    overlap: OverlapDiagnosticType,
    refutation: OptionType(RefutationType),
    /** ALE dose-response of `dose_feature` (present when `config.dose_feature` is set). */
    dose_response: OptionType(DoseResponseType),
    verdict: ExperimentVerdictType,
});

/**
 * Type-parameter placeholder for the generic row struct `T`. At a call site the
 * caller passes the concrete row `StructType`; `applyTypeArgs` substitutes this
 * bare `"T"` reference wherever it appears in the input types (inside
 * `ArrayType(ROW_T)`).
 */
const ROW_T = "T" as unknown as Parameters<typeof ArrayType>[0];

/**
 * One declarative causal experiment — naive vs adjusted effect, balance,
 * overlap, robustness, and an honesty verdict, in a single call. Generic over
 * the row struct (fields = columns), binary treatment.
 *
 * @param data - Array of row structs (one per unit; fields are the columns)
 * @param config - The experiment configuration
 * @returns The honest result + verdict; `adjusted` is `none` when refused
 */
export const causal_experiment = East.genericPlatform(
    "causal_experiment",
    ["T"],
    [ArrayType(ROW_T), CausalExperimentConfigType],
    CausalExperimentResultType
);

// ============================================================================
// Validation-design contract — `causal_design_validation`
//
// Turns a finished experiment into the recipe for a REAL randomised controlled
// trial that would confirm the effect (how many units, the split, which
// categories to match the groups on) — or, when a plain trial can't be run, what
// to change. One design family; the framing + size `basis` + visuals vary with
// the verdict. Replicated verbatim (snake_case) in e3-ui's experiment types.
// ============================================================================

/** Why the trial is sized the way it is — set from the verdict. */
export const DesignBasisType = VariantType({
    /** Clear effect → power the trial to detect the observed effect. */
    detect_observed: NullType,
    /** Fuzzy / maybe-nothing → power to the smallest effect worth acting on. */
    resolve_vs_null: NullType,
    /** A trust check failed → randomise to remove the bias adjustment couldn't. */
    de_bias: NullType,
    /** No overlap → randomise within the comparable range. */
    restrict_to_overlap: NullType,
    /** No control group exists → hold back a random sample next time. */
    create_control: NullType,
});

/** One sizing option — a split and the head-count it needs (even split first). */
export const TrialOptionType = StructType({
    label: StringType,
    /** Fraction assigned to the treatment (0..1; 0.5 = even). */
    treated_share: FloatType,
    n_treated: IntegerType,
    n_control: IntegerType,
    n_total: IntegerType,
});

/** The "chance of detecting it" curve — total head-count → power (0..1). */
export const PowerCurveType = StructType({
    n: VectorType(IntegerType),
    power: VectorType(FloatType),
});

/**
 * The validation-trial recipe — a randomised controlled trial sized from the
 * observed effect (or the materiality threshold) and the outcome spread, with the
 * groups matched on the confounders that were most imbalanced.
 */
export const ExperimentDesignType = StructType({
    verdict: ExperimentVerdictType,
    basis: DesignBasisType,
    /** Effect size the trial is powered to detect (observed, or materiality). */
    target_effect: FloatType,
    /** Outcome spread (pooled SD) used to size it. */
    outcome_sd: FloatType,
    target_power: FloatType,
    alpha: FloatType,
    /** Chance the CURRENT sample would already detect `target_effect`; `none` when there's no comparison group. */
    current_power: OptionType(FloatType),
    /** Categories both groups must be matched on (most-imbalanced confounders). */
    match_on: ArrayType(StringType),
    /** Ranked split options (even split first; cost-saving alternates). */
    options: ArrayType(TrialOptionType),
    /** The detect-chance curve for the chart. */
    power_curve: PowerCurveType,
    /** One generated, plain-language sentence framing the recipe. */
    rationale: StringType,
});

/** Optional knobs for {@link causal_design_validation} (all developer-defaulted). */
export const DesignConfigType = StructType({
    /** Significance level (default 0.05). */
    alpha: OptionType(FloatType),
    /** Target chance of detecting the effect (default 0.8). */
    target_power: OptionType(FloatType),
    /** Smallest effect worth acting on — sizes the trial to this when set / when there's no trustworthy observed effect. */
    materiality: OptionType(FloatType),
    /** Treatment shares to offer as options (default [0.5]). */
    treated_shares: OptionType(ArrayType(FloatType)),
});

/**
 * Design the real controlled trial that would validate a finished experiment.
 * Generic over the row struct (same as {@link causal_experiment}); takes the data,
 * the experiment config, the experiment result, and optional design knobs, and
 * returns the trial recipe (sample size, split options, match-on categories, the
 * power curve, and a plain-language rationale).
 *
 * @param data - The rows the experiment ran on
 * @param config - The experiment configuration (names treatment / outcome / confounders)
 * @param result - The {@link causal_experiment} result whose verdict drives the recipe
 * @param design_config - Optional alpha / power / materiality / split knobs
 * @returns The validation-trial recipe
 */
export const causal_design_validation = East.genericPlatform(
    "causal_design_validation",
    ["T"],
    [ArrayType(ROW_T), CausalExperimentConfigType, CausalExperimentResultType, DesignConfigType],
    ExperimentDesignType
);

// ============================================================================
// Grouped Export
// ============================================================================

/** Type definitions for causal inference. */
export const CausalTypes = {
    // Shared vocabulary
    CausalWeightingSchemeType,
    CausalEstimatorType,
    CausalTargetUnitsType,
    CausalBootstrapConfigType,
    CiType,
    // Experiment contract
    RefuteSpecType,
    CausalExperimentConfigType,
    BalanceRowType,
    OverlapDiagnosticType,
    RefutationType,
    DoseResponseType,
    ExperimentVerdictType,
    CausalExperimentResultType,
    // Validation-design contract
    DesignBasisType,
    TrialOptionType,
    PowerCurveType,
    ExperimentDesignType,
    DesignConfigType,
} as const;

/**
 * Causal inference — one declarative entry point.
 *
 * `Causal.experiment(data, config)` runs a complete, honest causal experiment
 * for a binary treatment and returns the naive vs adjusted effect, confounder
 * balance, propensity overlap, a robustness check, and a verdict
 * (`causal` / `modest` / `adjustment_insufficient` / `non_identifiable_positivity`
 * / `not_estimable`). It refuses (`adjusted = none`) when the data can't support
 * an estimate. DoWhy / EconML / PyALE are internal implementation it composes.
 *
 * @example
 * ```ts
 * import { East, ArrayType, StructType, FloatType, BooleanType, variant } from "@elaraai/east";
 * import { Causal } from "@elaraai/east-py-datascience";
 *
 * const Row = StructType({ treated: BooleanType, outcome: FloatType, z: FloatType });
 * const run = East.function([ArrayType(Row)], Causal.Types.CausalExperimentResultType, ($, data) => {
 *   const config = $.let({
 *     treatment: "treated", outcome: "outcome", common_causes: ["z"],
 *     categorical: variant('none', null),
 *     method: variant('none', null), estimand: variant('none', null),
 *     refute: variant('some', { placebo: true, random_common_cause: false }),
 *     min_overlap: variant('some', 0.1), min_treatment_variation: variant('some', 0.02),
 *     bootstrap: variant('none', null), random_state: variant('some', 42n),
 *   }, Causal.Types.CausalExperimentConfigType);
 *   return $.return(Causal.experiment([Row], data, config));
 * });
 * ```
 */
export const Causal = {
    experiment: causal_experiment,
    /** Design the real controlled trial that would validate an experiment result. */
    designValidation: causal_design_validation,
    /** Type definitions */
    Types: CausalTypes,
} as const;
