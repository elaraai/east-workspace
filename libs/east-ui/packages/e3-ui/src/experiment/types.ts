/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `Experiment` render contract.
 *
 * These types are **replicated verbatim (snake_case)** from
 * `east-py-datascience`'s `Causal.Types.*`, so the engine's `Causal.experiment`
 * result unifies **structurally** with the component's binding — replicate, don't
 * share (East type equality is structural; `e3-ui` never imports
 * `east-py-datascience`). Keep these byte-identical to the datascience
 * definitions — they are kept in sync by hand.
 *
 * The user edits an {@link ExperimentConfigType} (the staged "question + method")
 * and **Apply** runs the one bound `experiment` function, which returns an
 * {@link ExperimentResultType} — the naive vs adjusted effect, confounder
 * balance, propensity overlap, a robustness summary, and an honesty
 * {@link ExperimentVerdictType}. `adjusted` is `none` when the engine refuses.
 *
 * @packageDocumentation
 */

import {
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    DictType,
    FloatType,
    IntegerType,
    BooleanType,
    StringType,
    NullType,
    DateTimeType,
    VectorType,
} from '@elaraai/east';
import { Slice } from '@elaraai/east-ui';

// ============================================================================
// Shared vocabulary (= Causal.Types.*)
// ============================================================================

/** A confidence interval. */
export const CiType = StructType({ lower: FloatType, upper: FloatType });
/** Type alias for {@link CiType}. */
export type CiType = typeof CiType;

/** Inverse-propensity weighting scheme. */
export const WeightingSchemeType = VariantType({
    ips_weight: NullType,
    ips_stabilized_weight: NullType,
    ips_normalized_weight: NullType,
});
/** Type alias for {@link WeightingSchemeType}. */
export type WeightingSchemeType = typeof WeightingSchemeType;

/** Backdoor-adjusted effect estimator. */
export const EstimatorType = VariantType({
    linear_regression: NullType,
    propensity_score_weighting: StructType({
        weighting_scheme: OptionType(WeightingSchemeType),
    }),
});
/** Type alias for {@link EstimatorType}. */
export type EstimatorType = typeof EstimatorType;

/** Population the effect is reported for. */
export const TargetUnitsType = VariantType({
    ate: NullType,
    att: NullType,
    atc: NullType,
});
/** Type alias for {@link TargetUnitsType}. */
export type TargetUnitsType = typeof TargetUnitsType;

/**
 * A directional prior on the effect — the sign a domain expert expects. Drives the
 * `expected_sign` guard.
 * twin: east-py-datascience causal.ts `CausalSignType`
 */
export const SignType = VariantType({
    positive: NullType,
    negative: NullType,
});
/** Type alias for {@link SignType}. */
export type SignType = typeof SignType;

/** Bootstrap confidence-interval configuration. */
export const BootstrapConfigType = StructType({
    reps: IntegerType,
    cluster_column: OptionType(StringType),
    confidence_level: OptionType(FloatType),
});
/** Type alias for {@link BootstrapConfigType}. */
export type BootstrapConfigType = typeof BootstrapConfigType;

/** Which robustness checks to run. */
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
/** Type alias for {@link RefuteSpecType}. */
export type RefuteSpecType = typeof RefuteSpecType;

// ============================================================================
// The config the user edits (= CausalExperimentConfigType)
// ============================================================================

/**
 * The experiment the user framed — the staged value the pickers write and
 * **Apply** feeds to the bound `experiment` function.
 *
 * `treatment` / `outcome` / `common_causes` / `categorical` are **column names**
 * introspected from the bound dataset's row struct (the `Table` pattern). The
 * `method` / `estimand` advanced choices and the `min_*` guard thresholds are
 * optional developer-defaulted, user-adjustable knobs.
 */
export const ExperimentConfigType = StructType({
    treatment: StringType,
    outcome: StringType,
    common_causes: ArrayType(StringType),
    categorical: OptionType(ArrayType(StringType)),
    method: OptionType(EstimatorType),
    estimand: OptionType(TargetUnitsType),
    refute: OptionType(RefuteSpecType),
    /** Continuous column for the ALE dose-response curve (the "How much?" view). */
    dose_feature: OptionType(StringType),
    min_overlap: OptionType(FloatType),
    min_treatment_variation: OptionType(FloatType),
    bootstrap: OptionType(BootstrapConfigType),
    random_state: OptionType(IntegerType),
    /** Graded-overlap threshold — common support below this keeps `causal` from the
     *  top tier (verdict `modest`, `overlap.support_strength = thin`); default 0.55. */
    strong_overlap: OptionType(FloatType),
    /** Robustness floor — a `causal` verdict whose E-value is below this is downgraded to
     *  `modest`. Off by default. (E-value is a monotone transform of the standardized effect.) */
    evalue_floor: OptionType(FloatType),
    /** Directional prior — a material, CI-clear effect of the opposite sign is flagged
     *  (`expected_sign_ok = some(false)`, verdict `adjustment_insufficient`). Off by default. */
    expected_sign: OptionType(SignType),
});
/** Type alias for {@link ExperimentConfigType}. */
export type ExperimentConfigType = typeof ExperimentConfigType;

// ============================================================================
// The result the engine returns (= CausalExperimentResultType)
// ============================================================================

/** One confounder's before-adjustment imbalance (categoricals → one row per level). */
export const BalanceRowType = StructType({
    column: StringType,
    /** The original confounder this row belongs to — equals `column` for a numeric
     *  confounder; the base confounder for a one-hot categorical level. */
    base_column: StringType,
    treated_mean: FloatType,
    control_mean: FloatType,
    std_diff: FloatType,
    /** Post-adjustment SMD (weighted means, same pooled-sd denominator) — proof the
     *  adjustment closed the gap. `some` only for the propensity estimator with
     *  computable scores.
     *  twin: east-py-datascience BalanceRowType.std_diff_adjusted */
    std_diff_adjusted: OptionType(FloatType),
});
/** Type alias for {@link BalanceRowType}. */
export type BalanceRowType = typeof BalanceRowType;

/** One observed confounder placed on the sensitivity strengths axis — the simulated
 *  strength whose effect-shift equals the shift from omitting that confounder, so
 *  "tips at 0.9" reads as "a hidden cause as strong as `column`".
 *  twin: east-py-datascience `SensitivityBenchmarkType` */
export const SensitivityBenchmarkType = StructType({
    column: StringType,
    strength: FloatType,
});
/** Type alias for {@link SensitivityBenchmarkType}. */
export type SensitivityBenchmarkType = typeof SensitivityBenchmarkType;

/**
 * Graded common-support tier — `refused` (below `min_overlap`), `thin` (clears the
 * refuse gate but below `strong_overlap`), `strong` (≥ `strong_overlap`). Vacuously
 * `strong` with no confounders.
 * twin: east-py-datascience causal.ts `SupportStrengthType`
 */
export const SupportStrengthType = VariantType({
    refused: NullType,
    thin: NullType,
    strong: NullType,
});
/** Type alias for {@link SupportStrengthType}. */
export type SupportStrengthType = typeof SupportStrengthType;

/** Positivity / common-support diagnostic (binary treatment). */
export const OverlapDiagnosticType = StructType({
    treated_propensity: VectorType(FloatType),
    control_propensity: VectorType(FloatType),
    common_support_frac: FloatType,
    /** Clears the **refuse** gate `min_overlap` — NOT a quality signal (true at the
     *  default 0.10 gate still means barely-overlapping). Read `support_strength`. */
    positivity_ok: BooleanType,
    /** Graded common-support tier (`refused` / `thin` / `strong`).
     *  twin: datascience OverlapDiagnosticType.support_strength */
    support_strength: SupportStrengthType,
});
/** Type alias for {@link OverlapDiagnosticType}. */
export type OverlapDiagnosticType = typeof OverlapDiagnosticType;

/** The unobserved-confounder sensitivity (tipping) curve — effect at each simulated strength. */
export const SensitivityCurveType = StructType({
    strengths: VectorType(FloatType),
    effects: VectorType(FloatType),
    /** Observed-confounder benchmarks on the SAME strengths axis (empty when none is
     *  computable) — lets the surface say "survives a hidden cause as strong as
     *  `incoming_grade`". Clamped to the last simulated strength. */
    benchmarks: ArrayType(SensitivityBenchmarkType),
});
/** Type alias for {@link SensitivityCurveType}. */
export type SensitivityCurveType = typeof SensitivityCurveType;

/** The robustness summary the verdict + trust tab consume. */
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
    /** Closed-form E-value (risk-ratio scale) — confounder strength needed to explain the
     *  effect away. A monotone transform of the standardized effect (not independent of it). */
    robustness_value: OptionType(FloatType),
    /** Unobserved-confounder sensitivity (tipping) curve: effect at each simulated strength. */
    sensitivity: OptionType(SensitivityCurveType),
    /** Sign-prior check (when `config.expected_sign` is set): `some(true)` if a material
     *  effect matches the expected direction, `some(false)` if it points the other way,
     *  `none` when no prior or the effect is near-zero.
     *  twin: datascience RefutationType.expected_sign_ok */
    expected_sign_ok: OptionType(BooleanType),
});
/** Type alias for {@link RefutationType}. */
export type RefutationType = typeof RefutationType;

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
/** Type alias for {@link DoseResponseType}. */
export type DoseResponseType = typeof DoseResponseType;

/**
 * The honesty verdict — a thin tag; the numbers live top-level on the result.
 * Only `not_estimable` carries a human-readable reason.
 */
export const ExperimentVerdictType = VariantType({
    causal: NullType,
    modest: NullType,
    adjustment_insufficient: NullType,
    non_identifiable_positivity: NullType,
    not_estimable: StringType,
});
/** Type alias for {@link ExperimentVerdictType}. */
export type ExperimentVerdictType = typeof ExperimentVerdictType;

/**
 * Machine-readable reason a verdict fell short of `causal` — every FAILING gate
 * (the verdict tag is chosen by severity precedence, but explaining "why modest?"
 * needs all of them). Empty for `causal` and for the two refusal verdicts.
 * twin: east-py-datascience `VerdictReasonType`
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
/** Type alias for {@link VerdictReasonType}. */
export type VerdictReasonType = typeof VerdictReasonType;

/** The adjusted (like-for-like) effect + its CI — `none` on the result when the engine refuses. */
export const AdjustedEffectType = StructType({ effect: FloatType, ci: OptionType(CiType) });
/** Type alias for {@link AdjustedEffectType}. */
export type AdjustedEffectType = typeof AdjustedEffectType;

/**
 * The complete, honest result. `adjusted` is `none` when the engine refuses
 * (positivity / no-variation); the `verdict` tag carries the headline; every
 * word/colour on the surface is derived from these numbers.
 */
export const ExperimentResultType = StructType({
    naive: FloatType,
    naive_ci: OptionType(CiType),
    adjusted: OptionType(AdjustedEffectType),
    n_total: IntegerType,
    n_treated: IntegerType,
    n_control: IntegerType,
    /** Rows OUTSIDE the propensity common support — units with no like-for-like
     *  counterpart on the other side. Display-only; nothing is dropped. */
    n_dropped: IntegerType,
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
    /** The materiality band the verdict applied (0.10 × outcome_sd), echoed so the
     *  surface can say "smaller than what would matter here (±x)". */
    materiality_threshold: FloatType,
    /** Raw outcome mean of the treated arm (`none` when the arm is empty). */
    treated_outcome_mean: OptionType(FloatType),
    /** Raw outcome mean of the control arm (`none` when the arm is empty). */
    control_outcome_mean: OptionType(FloatType),
});
/** Type alias for {@link ExperimentResultType}. */
export type ExperimentResultType = typeof ExperimentResultType;

// ============================================================================
// Validation-design contract (= Causal.Types.ExperimentDesign*)
//
// `Causal.designValidation(data, config, result, design_config)` turns a finished
// experiment into the recipe for a REAL controlled trial that would confirm the
// effect — how many units, the split, and which categories to match the groups
// on — or, when a plain trial can't be run, what to change so one can. There is
// ONE design family (a randomised controlled trial); the framing, the size
// `basis`, and the visuals vary with the verdict. The renderer's "Validate" tab
// paints it from these numbers (KPI + split meter + match chips + power curve).
// Mirrors `Causal.Types.*` in east-py-datascience — kept in sync by hand.
// ============================================================================

/**
 * Why the trial is sized the way it is — set from the verdict, so the tab's
 * headline + visuals change with the result rather than reading the same twice.
 */
export const DesignBasisType = VariantType({
    /** Clear effect → power the trial to detect the *observed* effect. */
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
/** Type alias for {@link DesignBasisType}. */
export type DesignBasisType = typeof DesignBasisType;

/** One sizing option — a split and the head-count it needs (even split first). */
export const TrialOptionType = StructType({
    /** Plain label, e.g. "Even split" / "Treat fewer". */
    label: StringType,
    /** Fraction assigned to the treatment (0..1; 0.5 = even). */
    treated_share: FloatType,
    n_treated: IntegerType,
    n_control: IntegerType,
    n_total: IntegerType,
});
/** Type alias for {@link TrialOptionType}. */
export type TrialOptionType = typeof TrialOptionType;

/** The "chance of detecting it" curve — total head-count → power (0..1). */
export const PowerCurveType = StructType({
    n: VectorType(IntegerType),
    power: VectorType(FloatType),
});
/** Type alias for {@link PowerCurveType}. */
export type PowerCurveType = typeof PowerCurveType;

/**
 * The validation-trial recipe — a randomised controlled trial sized from the
 * observed effect (or the materiality threshold) and the outcome spread, with
 * the groups matched on the confounders that were most imbalanced. Everything
 * the "Validate" tab paints is derived from these fields.
 */
export const ExperimentDesignType = StructType({
    /** The verdict that drove the recommendation (echoed for framing). */
    verdict: ExperimentVerdictType,
    basis: DesignBasisType,
    /** The effect size the trial is powered to detect (observed, or materiality). */
    target_effect: FloatType,
    /** Outcome spread (pooled SD) used to size it. */
    outcome_sd: FloatType,
    target_power: FloatType,
    alpha: FloatType,
    /** Chance the CURRENT sample would already detect `target_effect` (the "you're here" marker); `none` when there's no comparison group. */
    current_power: OptionType(FloatType),
    /** Categories both groups must be matched on (the most-imbalanced confounders). */
    match_on: ArrayType(StringType),
    /** Ranked split options (even split first; cost-saving alternates). */
    options: ArrayType(TrialOptionType),
    /** The detect-chance curve for the chart. */
    power_curve: PowerCurveType,
    /** One generated, plain-language sentence framing the recipe. */
    rationale: StringType,
});
/** Type alias for {@link ExperimentDesignType}. */
export type ExperimentDesignType = typeof ExperimentDesignType;

/** Optional knobs `Causal.designValidation` accepts (all developer-defaulted). */
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
/** Type alias for {@link DesignConfigType}. */
export type DesignConfigType = typeof DesignConfigType;

// ============================================================================
// UI-only types (not part of the engine contract)
// ============================================================================

/**
 * The UI-side population filter — a set of {@link Slice} predicates the Step-4
 * rail edits. It narrows the rows **client-side, before** the `experiment` call,
 * so it is deliberately **not** a field of {@link ExperimentConfigType} (the
 * bound function never sees it; the config stays byte-identical to the causal
 * library's contract). Bound as its own optional staged dataset so a surface can
 * seed / persist / commit the framing filters.
 */
export const PopulationType = ArrayType(Slice.Types.Predicate);
/** Type alias for {@link PopulationType}. */
export type PopulationType = typeof PopulationType;

/**
 * One developer-authored, vetted experiment configuration — a named question whose
 * `spec` is loaded into the working config (and whose optional `population` sets the
 * scope) when it is selected from the surface's question selector. A committed result
 * records the originating configuration by `id`.
 *
 * A configuration bundles the **vetted backdoor set + scope** so a non-expert can pick a
 * correct causal question from a menu rather than assemble one. `spec` is a full
 * {@link ExperimentConfigType} (column names are plain strings); `population` is the
 * optional Step-4 scope (`none` ⇒ no scope); `group` sections the selector. An entry may
 * also carry a precomputed `result`/`design` so the surface paints an answer with no live
 * call.
 */
export const ConfigurationType = StructType({
    /** Stable key — the journal records THIS (not `label`), and it drives selection
     *  identity, so a renamed `label` never orphans a committed row. */
    id: StringType,
    /** Display title shown in the question selector. */
    label: StringType,
    /** The causal question — the vetted, pre-baked {@link ExperimentConfigType} this
     *  entry frames (loaded into the working config when selected). */
    spec: ExperimentConfigType,
    /** Optional population scope to apply on select; `none` ⇒ no scope. */
    population: OptionType(PopulationType),
    /** Optional section header — entries sharing a `group` are bucketed together. */
    group: OptionType(StringType),
    /** Optional precomputed answer for this question (e.g. a dataflow task ran
     *  `Causal.experiment` once). `none` ⇒ compute live via the `experiment` function. */
    result: OptionType(ExperimentResultType),
    /** Optional precomputed "Validate" recipe ({@link ExperimentDesignType}) for this
     *  question; `none` ⇒ compute live via the `design` function (if bound). */
    design: OptionType(ExperimentDesignType),
});
/** Type alias for {@link ConfigurationType}. */
export type ConfigurationType = typeof ConfigurationType;

/**
 * Optional per-column display metadata the developer supplies once. Keyed by
 * column name. Lets the derived prose read "worse" instead of "lower" and show
 * friendly labels / units.
 */
export const ColumnMetaType = DictType(StringType, StructType({
    label: OptionType(StringType),
    unit: OptionType(StringType),
    higherIsBetter: OptionType(BooleanType),
}));
/** Type alias for {@link ColumnMetaType}. */
export type ColumnMetaType = typeof ColumnMetaType;

/**
 * A committed experiment in the journal — the framed config + the verdict +
 * headline effect + who committed it when. The renderer derives the verdict
 * words and colour from `verdict` / `adjusted`.
 */
export const JournalRowType = StructType({
    config: ExperimentConfigType,
    verdict: ExperimentVerdictType,
    naive: FloatType,
    adjusted: OptionType(FloatType),
    committed_at: DateTimeType,
    committed_by: StringType,
    /** The `id` of the preset this experiment was framed from (`none` for a
     *  free-form / pre-presets row); the surface renders it as a "from {label}" chip. */
    preset: OptionType(StringType),
});
/** Type alias for {@link JournalRowType}. */
export type JournalRowType = typeof JournalRowType;

/** The journal dataset — committed experiments, newest first. */
export const JournalType = ArrayType(JournalRowType);
/** Type alias for {@link JournalType}. */
export type JournalType = typeof JournalType;
