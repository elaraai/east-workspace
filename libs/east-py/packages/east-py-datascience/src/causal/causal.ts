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
 * A directional prior on the effect — the sign a domain expert expects. Used by
 * {@link causal_experiment}'s `expected_sign` guard: a material, CI-clear effect
 * pointing the *other* way is flagged (a reverse-causation / reactive-assignment
 * signal a backdoor adjustment cannot catch).
 *
 * twin: e3-ui/src/experiment/types.ts `SignType`
 */
export const CausalSignType = VariantType({
    /** The effect is expected to increase the outcome. */
    positive: NullType,
    /** The effect is expected to decrease the outcome. */
    negative: NullType,
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
    /** Graded-overlap threshold — common support below this keeps `causal` from the
     *  top tier (verdict `modest`, `overlap.support_strength = thin`); default 0.55. */
    strong_overlap: OptionType(FloatType),
    /** Robustness floor — when set, a `causal` verdict whose E-value
     *  (`refutation.robustness_value`, risk-ratio scale) is below this is downgraded to
     *  `modest`. Off by default. The E-value is a monotone transform of the standardized
     *  effect, so this acts as a stricter materiality bar, not an independent check. */
    evalue_floor: OptionType(FloatType),
    /** Directional prior — when set, a material, CI-clear effect of the opposite sign is
     *  flagged (`refutation.expected_sign_ok = some(false)`, verdict `adjustment_insufficient`).
     *  Off by default. Catches reverse causation / reactive assignment the refuters can't. */
    expected_sign: OptionType(CausalSignType),
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
    /** Post-adjustment SMD (weighted means, same pooled-sd denominator) — proof the
     *  adjustment closed the gap. `some` only for `propensity_score_weighting` with
     *  computable scores; `none` for the regression estimator (which doesn't
     *  reweight) or a failed propensity fit.
     *  twin: causal_impl.py / e3-ui `BalanceRowType.std_diff_adjusted` */
    std_diff_adjusted: OptionType(FloatType),
});

/** One observed confounder placed on the sensitivity strengths axis — the simulated
 *  strength whose effect-shift equals the shift from omitting that confounder, so
 *  "tips at 0.9" reads as "a hidden cause as strong as `column`".
 *  twin: causal_impl.py / e3-ui `SensitivityBenchmarkType` */
export const SensitivityBenchmarkType = StructType({
    column: StringType,
    strength: FloatType,
});

/**
 * Graded common-support tier — the honest three-state reading of overlap a
 * consumer can switch on without re-deriving thresholds:
 * `refused` (below `min_overlap`, the engine refuses), `thin` (clears the refuse
 * gate but below `strong_overlap` — fragile), `strong` (≥ `strong_overlap`). With
 * no confounders (or a degenerate arm) there is nothing to separate on, so the tier
 * is vacuously `strong`.
 *
 * twin: e3-ui/src/experiment/types.ts `SupportStrengthType`
 */
export const SupportStrengthType = VariantType({
    /** Below `min_overlap` — no like-for-like comparison (engine refuses). */
    refused: NullType,
    /** Clears the refuse gate but below `strong_overlap` — fragile support. */
    thin: NullType,
    /** Common support ≥ `strong_overlap` — solid. */
    strong: NullType,
});

/** Positivity / common-support diagnostic (binary treatment). */
export const OverlapDiagnosticType = StructType({
    /** Propensity histogram (20 bins over [0,1]) for the treated arm. */
    treated_propensity: VectorType(FloatType),
    /** Propensity histogram for the control arm. */
    control_propensity: VectorType(FloatType),
    /** Fraction of rows inside the treated/control common support. */
    common_support_frac: FloatType,
    /** Whether common support clears the **refuse** gate `min_overlap` — i.e. an
     *  adjusted estimate is attempted at all. NOT a quality signal: `true` at the
     *  default gate (0.10) still means barely-overlapping. Read `support_strength`
     *  for the graded tier. */
    positivity_ok: BooleanType,
    /** Graded common-support tier (`refused` / `thin` / `strong` vs `strong_overlap`).
     *  twin: e3-ui OverlapDiagnosticType.support_strength */
    support_strength: SupportStrengthType,
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
    /** Closed-form E-value (risk-ratio scale) — the confounder strength needed to
     *  explain the effect away. A monotone transform of the standardized effect, so
     *  it is NOT independent of the effect size; read it as "how easily overturned",
     *  not as a separate confounding measure. */
    robustness_value: OptionType(FloatType),
    /** Unobserved-confounder sensitivity (tipping) curve: effect at each simulated strength. */
    sensitivity: OptionType(StructType({
        strengths: VectorType(FloatType),
        effects: VectorType(FloatType),
        /** Observed-confounder benchmarks on the SAME strengths axis (empty when
         *  none is computable) — lets a consumer say "survives a hidden cause as
         *  strong as `incoming_grade`". Clamped to the last simulated strength. */
        benchmarks: ArrayType(SensitivityBenchmarkType),
    })),
    /** Sign-prior check (when `config.expected_sign` is set): `some(true)` if a
     *  material effect matches the expected direction, `some(false)` if it points the
     *  other way (→ verdict `adjustment_insufficient`). `none` when no prior is given
     *  or the effect is near-zero (its sign is undefined).
     *  twin: e3-ui RefutationType.expected_sign_ok */
    expected_sign_ok: OptionType(BooleanType),
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
    /** A real, robust, material effect — robust to the **observed** backdoor set + the
     *  refuters that were run. It does NOT mean correctly-signed, free of reverse
     *  causation, or free of unobserved confounding: read `refutation.robustness_value`
     *  (E-value) and `refutation.expected_sign_ok` alongside it. */
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
 * Machine-readable reason a verdict fell short of `causal`. Every FAILING gate
 * is emitted (the verdict tag is chosen by severity precedence, but a consumer
 * explaining "why modest?" needs all of them); empty for `causal` (all gates
 * passed) and for the two refusal verdicts (the tag itself is the reason).
 *
 * twin: causal_impl.py / e3-ui `VerdictReasonType`
 */
export const VerdictReasonType = VariantType({
    /** The placebo (shuffle) refuter didn't collapse to ~0. */
    placebo_failed: NullType,
    /** |effect| below the materiality band (0.10 × outcome_sd). */
    not_material: NullType,
    /** The adjusted CI straddles zero. */
    ci_spans_zero: NullType,
    /** Material + CI-clear but pointing against `config.expected_sign`. */
    wrong_sign: NullType,
    /** Common support cleared the refuse gate but is below `strong_overlap`. */
    thin_support: NullType,
    /** E-value below the (opt-in) `evalue_floor`. */
    low_robustness: NullType,
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
    /** Rows OUTSIDE the propensity common support — units with no like-for-like
     *  counterpart on the other side. Display-only; nothing is dropped from the
     *  estimate. */
    n_dropped: IntegerType,
    /** Per-confounder before-adjustment imbalance, most-imbalanced first. */
    balance: ArrayType(BalanceRowType),
    overlap: OverlapDiagnosticType,
    refutation: OptionType(RefutationType),
    /** ALE dose-response of `dose_feature` (present when `config.dose_feature` is set). */
    dose_response: OptionType(DoseResponseType),
    verdict: ExperimentVerdictType,
    /** Why the verdict fell short of `causal` — every failing gate (empty for
     *  `causal` and for the refusals, where the tag itself is the reason). */
    verdict_reasons: ArrayType(VerdictReasonType),
    /** The outcome's standard deviation — the scale the materiality band is on. */
    outcome_sd: FloatType,
    /** The materiality band the verdict applied (0.10 × outcome_sd), echoed so a
     *  consumer can say "smaller than what would matter here (±x)". */
    materiality_threshold: FloatType,
    /** Raw outcome mean of the treated arm (`none` when the arm is empty). */
    treated_outcome_mean: OptionType(FloatType),
    /** Raw outcome mean of the control arm (`none` when the arm is empty). */
    control_outcome_mean: OptionType(FloatType),
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
    CausalSignType,
    CausalBootstrapConfigType,
    CiType,
    // Experiment contract
    RefuteSpecType,
    CausalExperimentConfigType,
    BalanceRowType,
    SensitivityBenchmarkType,
    SupportStrengthType,
    OverlapDiagnosticType,
    RefutationType,
    DoseResponseType,
    ExperimentVerdictType,
    VerdictReasonType,
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
 * `causal` means robust to the **observed** backdoor set + the refuters that ran —
 * NOT correctly-signed, free of reverse causation, or free of unobserved confounding.
 * The graded `overlap.support_strength` (`refused`/`thin`/`strong`) tempers a thin-support
 * result to `modest`; an opt-in `evalue_floor` folds a weak E-value into `modest`; an
 * opt-in `expected_sign` prior flags an implausibly-signed effect (`adjustment_insufficient`,
 * `refutation.expected_sign_ok = some(false)`). A reactively-assigned treatment needs a
 * design-based strategy (IV / within-unit pre-period) — see `designValidation`.
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
