/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `Experiment` render contract — the **e3-ui-owned** boundary types the
 * component reads and the developer's bound functions return.
 *
 * @remarks
 * These are *not* causal-library types: `e3-ui` never imports
 * `east-py-datascience`. They are the small contract a sign-flip experiment
 * surface needs — the causal quantities (`effect` / `ci` / the ALE vectors /
 * the refuter numbers) plus the two additions the surface requires (`naive`
 * for the raw-vs-adjusted comparison and `balance` for the confounder table).
 *
 * The split follows the **string-vs-variant rule** ({@link ExperimentSpecType}):
 *
 * - **Closed choices are variants** — the user's Advanced estimator / target /
 *   trim selections ({@link EstimatorType}, {@link TargetUnitsType},
 *   {@link TrimType}). They mirror the causal vocabulary *structurally*, so the
 *   developer's ~10-line `spec → CausalEffectConfig` bridge is an identity map
 *   on these fields — but the type lives here, owned by the surface.
 * - **Column references are strings** — `treatment` / `outcome` / `confounders`
 *   are field names introspected from the bound dataset's row struct (the
 *   `Table` pattern), so they are open over whatever columns the data has.
 * - **Presentation is derived, never stored** — no `tone` / bar width / label /
 *   sentence appears here. The renderer composes every word and colour from the
 *   numbers + the user's chosen column names.
 *
 * Where a shape overlaps the library (`Ci`, the ALE vectors) it is
 * **structurally identical**, so values unify by shape across the package
 * boundary with no shared package and no conversion.
 *
 * Reached via `Experiment.Types.*` (like `Table.Types.*`), not public named
 * exports — users only touch them to type the bound functions / seed datasets.
 *
 * @packageDocumentation
 */

import {
    StringType,
    FloatType,
    IntegerType,
    BooleanType,
    NullType,
    DateTimeType,
    ArrayType,
    StructType,
    VariantType,
    OptionType,
    DictType,
    VectorType,
} from '@elaraai/east';
import { Slice } from '@elaraai/east-ui';

// ============================================================================
// Advanced choices — closed vocabularies → variants (mirror the causal terms).
// ============================================================================

/**
 * Inverse-propensity weighting scheme for the
 * {@link EstimatorType | propensity-weighting} estimator. Structurally mirrors
 * the causal library's weighting-scheme variant.
 *
 * @property ips_weight - Raw inverse propensity weights.
 * @property ips_stabilized_weight - Stabilised weights (recommended; lower variance).
 * @property ips_normalized_weight - Normalised inverse propensity weights.
 */
export const WeightingSchemeType = VariantType({
    ips_weight: NullType,
    ips_stabilized_weight: NullType,
    ips_normalized_weight: NullType,
});
/** Type alias for {@link WeightingSchemeType}. */
export type WeightingSchemeType = typeof WeightingSchemeType;

/**
 * How the like-for-like comparison is estimated — the user's "method" choice in
 * the Advanced panel. Closed set, so a variant; structurally mirrors the causal
 * estimator vocabulary.
 *
 * @property linear_regression - Regress the outcome on treatment + confounders.
 * @property propensity_score_weighting - Re-weight rows by treatment
 *   propensity (binary treatment); carries the optional
 *   {@link WeightingSchemeType}.
 */
export const EstimatorType = VariantType({
    linear_regression: NullType,
    propensity_score_weighting: StructType({
        weighting_scheme: OptionType(WeightingSchemeType),
    }),
});
/** Type alias for {@link EstimatorType}. */
export type EstimatorType = typeof EstimatorType;

/**
 * Which population the effect is reported for — the user's "who" choice. Closed
 * set, so a variant; structurally mirrors the causal target-units vocabulary.
 *
 * @property ate - Everyone (average treatment effect).
 * @property att - The treated group (average effect on the treated).
 * @property atc - The untreated group (average effect on the controls).
 */
export const TargetUnitsType = VariantType({
    ate: NullType,
    att: NullType,
    atc: NullType,
});
/** Type alias for {@link TargetUnitsType}. */
export type TargetUnitsType = typeof TargetUnitsType;

/**
 * Whether un-matchable rows are dropped before estimating — the user's "trim"
 * choice. Closed set, so a variant; structurally mirrors the causal
 * propensity-trim vocabulary.
 *
 * @property overlap - Keep only the common-support overlap of the two groups.
 * @property bounds - Keep rows whose propensity is inside explicit `lower` /
 *   `upper` bounds.
 */
export const TrimType = VariantType({
    overlap: NullType,
    bounds: StructType({
        lower: FloatType,
        upper: FloatType,
    }),
});
/** Type alias for {@link TrimType}. */
export type TrimType = typeof TrimType;

// ============================================================================
// The experiment the user framed — column refs are strings.
// ============================================================================

/**
 * The experiment the user framed in the set-up rail — the staged value the
 * pickers write and **Run** feeds to the bound `estimate` function.
 *
 * @remarks
 * `treatment` / `outcome` / `confounders` / `categorical` are **column names**
 * introspected from the bound dataset's row struct, so the surface re-frames
 * over whatever columns the data has (the `Table` pattern). The Advanced
 * choices ({@link EstimatorType}, {@link TargetUnitsType}, {@link TrimType}) are
 * variants. `population` is an optional Slice-style predicate set that narrows
 * the rows before estimating.
 *
 * @property treatment - The column whose change might cause the effect.
 * @property outcome - The column it might move.
 * @property confounders - The backdoor set — columns to adjust for.
 * @property categorical - Which of the confounders hold category codes (one-hot
 *   encoded by the estimator).
 * @property population - Optional row narrowing (AND-ed Slice predicates).
 * @property method - Optional estimator override (default: linear regression).
 * @property targetUnits - Optional population override (default: everyone).
 * @property trim - Optional un-matchable-row trimming (propensity weighting only).
 */
export const ExperimentSpecType = StructType({
    treatment: StringType,
    outcome: StringType,
    confounders: ArrayType(StringType),
    categorical: ArrayType(StringType),
    population: OptionType(ArrayType(Slice.Types.Predicate)),
    method: OptionType(EstimatorType),
    targetUnits: OptionType(TargetUnitsType),
    trim: OptionType(TrimType),
});
/** Type alias for {@link ExperimentSpecType}. */
export type ExperimentSpecType = typeof ExperimentSpecType;

// ============================================================================
// Shared — a confidence interval.
// ============================================================================

/**
 * A confidence interval. Structurally identical to the causal library's `ci`,
 * so it unifies by shape across the package boundary.
 *
 * @property lower - Lower bound.
 * @property upper - Upper bound.
 */
export const CiType = StructType({
    lower: FloatType,
    upper: FloatType,
});
/** Type alias for {@link CiType}. */
export type CiType = typeof CiType;

// ============================================================================
// What `estimate` returns — causal quantities packaged for the surface.
// ============================================================================

/**
 * One confounder's before-adjustment imbalance — the two group means and the
 * standardised difference. The renderer derives the bar width, tone and "6.1 vs
 * 8.0" label from these numbers.
 *
 * @property column - The confounder column.
 * @property treatedMean - Mean of the column in the treated group.
 * @property controlMean - Mean of the column in the control group.
 * @property stdDiff - Standardised mean difference (the imbalance magnitude).
 */
export const BalanceRowType = StructType({
    column: StringType,
    treatedMean: FloatType,
    controlMean: FloatType,
    stdDiff: FloatType,
});
/** Type alias for {@link BalanceRowType}. */
export type BalanceRowType = typeof BalanceRowType;

/**
 * The `estimate` answer — the adjusted (like-for-like) effect, the naive (raw)
 * effect for the sign-flip comparison, the sample accounting, and the
 * confounder balance. Every word and colour on the surface is derived from
 * these numbers.
 *
 * @property effect - The adjusted (like-for-like) effect estimate.
 * @property ci - Optional confidence interval for `effect`.
 * @property naive - The raw (unadjusted) mean difference.
 * @property naiveCi - Optional confidence interval for `naive`.
 * @property nTotal - Rows in the framed population.
 * @property nTreated - Treated rows used.
 * @property nControl - Control rows used.
 * @property nDropped - Rows dropped by trimming / missing data.
 * @property balance - Per-confounder before-adjustment imbalance, most
 *   imbalanced first.
 */
export const ExperimentResultType = StructType({
    effect: FloatType,
    ci: OptionType(CiType),
    naive: FloatType,
    naiveCi: OptionType(CiType),
    nTotal: IntegerType,
    nTreated: IntegerType,
    nControl: IntegerType,
    nDropped: IntegerType,
    balance: ArrayType(BalanceRowType),
});
/** Type alias for {@link ExperimentResultType}. */
export type ExperimentResultType = typeof ExperimentResultType;

// ============================================================================
// What `refute` returns — the trust checks.
// ============================================================================

/**
 * Which robustness check a {@link RefuteCheckType} row is. Closed set → variant;
 * the renderer derives the check's name, description and pass/fail from the kind
 * plus the numbers.
 *
 * @property placebo - Fake treatment — the effect should vanish.
 * @property random_common_cause - Inject a random cause — the effect should hold.
 * @property data_subset - Re-estimate on subsets — the effect should be stable.
 * @property unobserved - Simulated hidden confounder — a sensitivity curve.
 */
export const RefuteKindType = VariantType({
    placebo: NullType,
    random_common_cause: NullType,
    data_subset: NullType,
    unobserved: NullType,
});
/** Type alias for {@link RefuteKindType}. */
export type RefuteKindType = typeof RefuteKindType;

/**
 * One robustness check — the real refuter numbers. The renderer turns these
 * into the pass/fail row and (for `unobserved`) the sensitivity curve.
 *
 * @property kind - Which check this is ({@link RefuteKindType}).
 * @property estimatedEffect - The original effect being challenged.
 * @property newEffects - Effect(s) under the refutation — one entry for
 *   placebo / random-cause / subset; one per simulated strength for unobserved.
 * @property strengths - For `unobserved` only: the simulated confounder
 *   strengths paired with `newEffects` (the sensitivity-curve x-axis). `none`
 *   for the single-shot checks.
 * @property pValue - Refuter p-value where the check provides one.
 */
export const RefuteCheckType = StructType({
    kind: RefuteKindType,
    estimatedEffect: FloatType,
    newEffects: VectorType(FloatType),
    strengths: OptionType(VectorType(FloatType)),
    pValue: OptionType(FloatType),
});
/** Type alias for {@link RefuteCheckType}. */
export type RefuteCheckType = typeof RefuteCheckType;

/**
 * The `refute` answer — the battery of robustness checks shown in the "Can we
 * trust it?" tab.
 *
 * @property checks - The checks that were run.
 */
export const RefuteResultType = StructType({
    checks: ArrayType(RefuteCheckType),
});
/** Type alias for {@link RefuteResultType}. */
export type RefuteResultType = typeof RefuteResultType;

// ============================================================================
// What `dose` returns — the ALE dose-response curve.
// ============================================================================

/**
 * A per-segment dose-response sub-curve (e.g. one production line). The grid /
 * effect / CI vectors mirror the top-level {@link DoseResultType} curve shape.
 *
 * @property label - Segment label ("Line A", "Acme", …).
 * @property grid - Feature grid values.
 * @property effect - Centered ALE effect at each grid value.
 * @property lower - Optional lower CI at each grid value.
 * @property upper - Optional upper CI at each grid value.
 */
export const DoseSegmentType = StructType({
    label: StringType,
    grid: VectorType(FloatType),
    effect: VectorType(FloatType),
    lower: OptionType(VectorType(FloatType)),
    upper: OptionType(VectorType(FloatType)),
});
/** Type alias for {@link DoseSegmentType}. */
export type DoseSegmentType = typeof DoseSegmentType;

/**
 * The `dose` answer — an ALE dose-response curve for a chosen feature, plus the
 * optional per-segment breakdown. The grid / effect / CI / size vectors are
 * structurally identical to the causal library's ALE result.
 *
 * @property feature - The dose feature column.
 * @property grid - Feature grid values (interval edges).
 * @property effect - Centered ALE effect at each grid value (outcome units).
 * @property lower - Optional lower CI at each grid value.
 * @property upper - Optional upper CI at each grid value.
 * @property size - Number of samples in each grid interval.
 * @property segments - Optional per-segment sub-curves ({@link DoseSegmentType}).
 */
export const DoseResultType = StructType({
    feature: StringType,
    grid: VectorType(FloatType),
    effect: VectorType(FloatType),
    lower: OptionType(VectorType(FloatType)),
    upper: OptionType(VectorType(FloatType)),
    size: VectorType(IntegerType),
    segments: OptionType(ArrayType(DoseSegmentType)),
});
/** Type alias for {@link DoseResultType}. */
export type DoseResultType = typeof DoseResultType;

// ============================================================================
// The journal — committed experiments.
// ============================================================================

/**
 * A committed experiment in the journal — the framed spec + the headline effect
 * + who committed it when. The renderer derives the verdict words and colour
 * from `effect` / `ci`.
 *
 * @property spec - The experiment that was committed ({@link ExperimentSpecType}).
 * @property effect - The adjusted effect at commit time.
 * @property ci - Optional confidence interval at commit time.
 * @property committedAt - When it was committed.
 * @property committedBy - Who committed it.
 */
export const JournalRowType = StructType({
    spec: ExperimentSpecType,
    effect: FloatType,
    ci: OptionType(CiType),
    committedAt: DateTimeType,
    committedBy: StringType,
});
/** Type alias for {@link JournalRowType}. */
export type JournalRowType = typeof JournalRowType;

/** The journal dataset — committed experiments, newest first. */
export const JournalType = ArrayType(JournalRowType);
/** Type alias for {@link JournalType}. */
export type JournalType = typeof JournalType;

// ============================================================================
// Optional per-column metadata.
// ============================================================================

/**
 * Optional per-column metadata the developer supplies once. Lets the derived
 * prose read "worse" instead of "lower" and show friendly labels / units.
 * Keyed by column name.
 *
 * @property label - Friendly display label for the column.
 * @property unit - Unit suffix ("MPa", "$", …).
 * @property higherIsBetter - Whether a larger value is the good direction —
 *   flips "lower" → "worse" in the derived words.
 */
export const ColumnMetaType = DictType(StringType, StructType({
    label: OptionType(StringType),
    unit: OptionType(StringType),
    higherIsBetter: OptionType(BooleanType),
}));
/** Type alias for {@link ColumnMetaType}. */
export type ColumnMetaType = typeof ColumnMetaType;
