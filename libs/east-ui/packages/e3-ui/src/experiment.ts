/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Experiment` component — a causal-experiment surface.
 *
 * @remarks
 * `Experiment` lets a domain expert ask *"did X change Y?"* against a dataset
 * and trust the answer, without meeting a statistician's vocabulary. It is a
 * registered extension component (architecturally like {@link Ontology}): the
 * author writes one tag, `Experiment.Root({ … })`; the React renderer lives in
 * `@elaraai/e3-ui-components` and is wired via
 * `implementUIComponent(Experiment.Component, EastChakraExperiment)`.
 *
 * The component is **visual-first and derived** — because the user frames an
 * arbitrary experiment, nothing on the result side is hand-authored. Every word
 * is a column name the user picked, a number the estimator returned, or a
 * status derived by rule (interval clears zero → HIGHER / LOWER; spans zero →
 * NO CLEAR EFFECT; raw and adjusted disagree in sign → the "misleading" banner).
 * The picture and the colour carry the meaning.
 *
 * `Experiment` binds neutral result datasets via {@link Data.bind} — the heavy
 * causal compute (DoWhy / EconML) lives in a developer dataflow task that writes
 * those datasets, so `e3-ui` never imports `east-py-datascience`.
 *
 * @packageDocumentation
 */

import {
    East,
    NullType,
    StringType,
    BooleanType,
    FloatType,
    IntegerType,
    ArrayType,
    StructType,
    VariantType,
    OptionType,
    DictType,
    none,
    some,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';
import { EastUI, type UIComponentType } from '@elaraai/east-ui';

import { DiffBindingType, type BoundValue } from './data.js';

// ============================================================================
// Neutral boundary types — what the estimator returns + what the user edits.
// Pure East type definitions, zero datascience dependency.
// ============================================================================

/**
 * A confounder row shown in the set-up rail — a column the two groups differ
 * on, with how unbalanced they were and a plain reason.
 *
 * @property col - The confounder column name.
 * @property reason - Plain-language note ("cured batches started ~8 pts lower").
 * @property imbalance - Standardised imbalance magnitude in `[0, 1]` (bar width).
 * @property level - Coarse label ("large gap" / "some" / "small").
 * @property tone - Visual tone: `neg` | `warn` | `muted`.
 */
export const ConfounderType = StructType({
    col: StringType,
    reason: StringType,
    imbalance: FloatType,
    level: StringType,
    tone: StringType,
});
/** Type alias for {@link ConfounderType}. */
export type ConfounderType = typeof ConfounderType;

/**
 * A Slice-style population/comparison filter clause shown as a chip.
 *
 * @property field - Column name.
 * @property op - Operator glyph (`=`, `in`, `≥`, …).
 * @property value - Right-hand value, pre-formatted.
 */
export const FilterClauseType = StructType({
    field: StringType,
    op: StringType,
    value: StringType,
});
/** Type alias for {@link FilterClauseType}. */
export type FilterClauseType = typeof FilterClauseType;

/**
 * The experiment the user framed — drives the set-up rail and the header
 * question. Edited (staged) by the user; the renderer reads it for display.
 */
export const ExperimentSpecType = StructType({
    /** Treatment column (the thing that changed). */
    treatment: StringType,
    /** Short type hint for the treatment ("yes / no"). */
    treatmentKind: StringType,
    /** Outcome column (the thing it might improve). */
    outcome: StringType,
    /** Short type hint for the outcome ("number · MPa"). */
    outcomeKind: StringType,
    /** One-line summary of the treated-vs-compared contrast ("yes · vs no"). */
    comparison: StringType,
    /** The backdoor set — confounders to adjust for. */
    confounders: ArrayType(ConfounderType),
    /** A suggested additional confounder column ("add run_date"). */
    suggestion: StringType,
    /** Population filters (Slice predicates) as display chips. */
    filters: ArrayType(FilterClauseType),
    /** Comparison method ("regression" | "reweighting"). */
    method: StringType,
    /** Target population ("all" | "treated"). */
    target: StringType,
    /** Whether un-matchable rows are trimmed. */
    trim: BooleanType,
    /** Dataset summary shown in the header ("480 batches · 3 lines"). */
    dataLabel: StringType,
});
/** Type alias for {@link ExperimentSpecType}. */
export type ExperimentSpecType = typeof ExperimentSpecType;

/**
 * A per-confounder balance row — the two group means before adjusting.
 *
 * @property col - The confounder column (or "col = level" for categoricals).
 * @property treated - Mean for the treated group.
 * @property control - Mean for the control group.
 * @property display - Pre-formatted "6.1 vs 8.0".
 * @property frac - Imbalance bar width in `[0, 1]`.
 * @property tone - Visual tone: `neg` | `warn` | `muted`.
 */
export const BalanceRowType = StructType({
    col: StringType,
    treated: FloatType,
    control: FloatType,
    display: StringType,
    frac: FloatType,
    tone: StringType,
});
/** Type alias for {@link BalanceRowType}. */
export type BalanceRowType = typeof BalanceRowType;

/**
 * The estimator's answer — pure numbers + the chosen column names. The renderer
 * derives every word and colour from this; no sentence is stored here.
 */
export const EffectAnswerType = StructType({
    /** Treatment column name (echoed for the renderer). */
    treatment: StringType,
    /** Outcome column name. */
    outcome: StringType,
    /** Outcome unit ("MPa"). */
    unit: StringType,
    /** Raw (unadjusted) mean difference. */
    naive: FloatType,
    /** Raw difference confidence-interval bounds. */
    naiveLo: FloatType,
    naiveHi: FloatType,
    /** Adjusted (like-for-like) effect estimate. */
    effect: FloatType,
    /** Adjusted effect confidence-interval bounds. */
    lo: FloatType,
    hi: FloatType,
    /** Sample counts. */
    nTotal: IntegerType,
    nTreated: IntegerType,
    nControl: IntegerType,
    nCompared: IntegerType,
    nDropped: IntegerType,
    /** Per-confounder balance, before adjusting (most imbalanced first). */
    balance: ArrayType(BalanceRowType),
});
/** Type alias for {@link EffectAnswerType}. */
export type EffectAnswerType = typeof EffectAnswerType;

/**
 * A single refutation check shown in the "Can we trust it?" tab.
 *
 * @property name - Check name ("Shuffle test").
 * @property desc - Plain description of what it does.
 * @property value - Pre-formatted outcome ("→ +0.0 ✓").
 * @property passed - Whether it passed (drives colour).
 * @property tip - Optional concept tooltip text.
 */
export const RefuteCheckType = StructType({
    name: StringType,
    desc: StringType,
    value: StringType,
    passed: BooleanType,
    tip: OptionType(StringType),
});
/** Type alias for {@link RefuteCheckType}. */
export type RefuteCheckType = typeof RefuteCheckType;

/**
 * The refutation results — the checklist + a sensitivity band.
 */
export const RefuteAnswerType = StructType({
    /** The refutation checklist. */
    checks: ArrayType(RefuteCheckType),
    /** Sensitivity band: effect vs simulated hidden-cause strength. */
    sensLo: ArrayType(FloatType),
    sensMid: ArrayType(FloatType),
    sensHi: ArrayType(FloatType),
    /** Axis tick labels for the sensitivity band. */
    sensXTicks: ArrayType(StringType),
    sensYTicks: ArrayType(StringType),
});
/** Type alias for {@link RefuteAnswerType}. */
export type RefuteAnswerType = typeof RefuteAnswerType;

/**
 * A vertical reference marker on the dose curve ("you are here" / "sweet spot").
 */
export const DoseMarkType = StructType({
    at: IntegerType,
    label: StringType,
    tone: StringType,
});
/** Type alias for {@link DoseMarkType}. */
export type DoseMarkType = typeof DoseMarkType;

/**
 * A marginal-gain bar (extra outcome from each added dose unit).
 */
export const MarginalRowType = StructType({
    label: StringType,
    value: FloatType,
    frac: FloatType,
});
/** Type alias for {@link MarginalRowType}. */
export type MarginalRowType = typeof MarginalRowType;

/**
 * The dose–response answer — the "How much?" tab.
 */
export const DoseAnswerType = StructType({
    /** The dose feature column ("cure_hours"). */
    feature: StringType,
    /** The outcome column ("bond_strength"). */
    outcome: StringType,
    /** The dose-response band (low / mid / high over the grid). */
    lo: ArrayType(FloatType),
    mid: ArrayType(FloatType),
    hi: ArrayType(FloatType),
    /** Axis tick labels. */
    xTicks: ArrayType(StringType),
    yTicks: ArrayType(StringType),
    /** Vertical reference markers. */
    marks: ArrayType(DoseMarkType),
    /** Recommended-dose callout. */
    recoLabel: StringType,
    recoEffect: FloatType,
    recoLo: FloatType,
    recoHi: FloatType,
    /** Plain trade-off readout. */
    tradeoff: StringType,
    /** Marginal-gain-per-step bars. */
    marginal: ArrayType(MarginalRowType),
    /** Per-segment switch options ("all batches", "Acme", "Globex"). */
    segments: ArrayType(StringType),
});
/** Type alias for {@link DoseAnswerType}. */
export type DoseAnswerType = typeof DoseAnswerType;

/**
 * A committed experiment row in the journal.
 */
export const JournalRowType = StructType({
    treatment: StringType,
    outcome: StringType,
    confounders: StringType,
    effect: StringType,
    verdict: StringType,
    verdictTone: StringType,
    who: StringType,
    when: StringType,
});
/** Type alias for {@link JournalRowType}. */
export type JournalRowType = typeof JournalRowType;

/** The journal dataset: committed experiments, newest first. */
export const JournalType = ArrayType(JournalRowType);
/** Type alias for {@link JournalType}. */
export type JournalType = typeof JournalType;

/**
 * Optional per-column metadata the developer supplies once. Lets the derived
 * prose read "worse" instead of "lower" and show display labels/units.
 *
 * Keyed by column name.
 */
export const ColumnMetaType = DictType(StringType, StructType({
    label: OptionType(StringType),
    unit: OptionType(StringType),
    higherIsBetter: OptionType(BooleanType),
}));
/** Type alias for {@link ColumnMetaType}. */
export type ColumnMetaType = typeof ColumnMetaType;

// ============================================================================
// Component payload — descriptors only (binding handles + options).
// ============================================================================

/**
 * The `Experiment` component payload — binding descriptors + options. Renderers
 * decode this and resolve each binding to a live, reactive value.
 *
 * @property spec - Binding to the {@link ExperimentSpecType} dataset (staged).
 * @property answer - Binding to the {@link EffectAnswerType} dataset.
 * @property refute - Optional binding to the {@link RefuteAnswerType} dataset.
 * @property dose - Optional binding to the {@link DoseAnswerType} dataset.
 * @property journal - Optional binding to the {@link JournalType} dataset.
 * @property columnMeta - Optional per-column display metadata.
 * @property readonly - Render without the Run / Commit / edit affordances.
 */
export const ExperimentPayloadType = StructType({
    spec: DiffBindingType,
    answer: DiffBindingType,
    refute: OptionType(DiffBindingType),
    dose: OptionType(DiffBindingType),
    journal: OptionType(DiffBindingType),
    columnMeta: OptionType(ColumnMetaType),
    readonly: OptionType(BooleanType),
    /** Initial result tab — `answer` (default), `trust`, or `dose`. */
    defaultTab: OptionType(VariantType({ answer: NullType, trust: NullType, dose: NullType })),
});
/** Type alias for {@link ExperimentPayloadType}. */
export type ExperimentPayloadType = typeof ExperimentPayloadType;

/** Initial result tab as a string literal. */
export type ExperimentTabLiteral = 'answer' | 'trust' | 'dose';

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components`.
 */
export const ExperimentComponent = EastUI.component('Experiment', ExperimentPayloadType, { optional: true });

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Options for {@link Experiment.Root}.
 *
 * @property spec - The {@link Data.bind} handle for the experiment spec.
 * @property answer - The {@link Data.bind} handle for the effect answer.
 * @property refute - Optional handle for the refutation results.
 * @property dose - Optional handle for the dose–response results.
 * @property journal - Optional handle for the committed-experiment journal.
 * @property columnMeta - Optional per-column display metadata.
 * @property readonly - Render without mutation affordances.
 * @property defaultTab - Initial result tab.
 */
export interface ExperimentOptions {
    spec: BoundValue<ExperimentSpecType>;
    answer: BoundValue<EffectAnswerType>;
    refute?: BoundValue<RefuteAnswerType>;
    dose?: BoundValue<DoseAnswerType>;
    journal?: BoundValue<JournalType>;
    columnMeta?: SubtypeExprOrValue<OptionType<ColumnMetaType>>;
    readonly?: SubtypeExprOrValue<OptionType<BooleanType>>;
    defaultTab?: ExperimentTabLiteral;
}

/**
 * The Experiment component namespace. Surfaces a causal-experiment surface over
 * bound result datasets, with the same staged-binding machinery the rest of
 * e3-ui uses.
 *
 * @remarks
 * Use `Experiment.Root({ spec, answer, refute, dose, journal })` inside a
 * `Reactive` block. The `Component` property is the {@link EastUI.component}
 * carrier the renderer registers against.
 */
export const Experiment = {
    /**
     * Build an Experiment surface bound to result datasets.
     *
     * @param options - {@link ExperimentOptions}. `spec` and `answer` are
     *   required; the rest are optional.
     * @returns An East expression of {@link UIComponentType}.
     */
    Root(options: ExperimentOptions): ExprType<UIComponentType> {
        const defaultTab = options.defaultTab === undefined
            ? none
            : some(East.value(
                variant(options.defaultTab, null),
                VariantType({ answer: NullType, trust: NullType, dose: NullType }),
            ));
        return ExperimentComponent.Root({
            spec: options.spec.binding,
            answer: options.answer.binding,
            refute: options.refute !== undefined ? some(options.refute.binding) : none,
            dose: options.dose !== undefined ? some(options.dose.binding) : none,
            journal: options.journal !== undefined ? some(options.journal.binding) : none,
            columnMeta: options.columnMeta ?? none,
            readonly: options.readonly ?? none,
            defaultTab,
        });
    },
    /** The internal {@link EastUI.component} carrier renderers register against. */
    Component: ExperimentComponent,
    Types: {
        /** Rendered payload struct (bindings + options). */
        Payload: ExperimentPayloadType,
        /** The experiment-spec value type. */
        Spec: ExperimentSpecType,
        /** The effect-answer value type. */
        Answer: EffectAnswerType,
        /** The refutation-results value type. */
        Refute: RefuteAnswerType,
        /** The dose-response value type. */
        Dose: DoseAnswerType,
        /** The committed-experiment journal value type. */
        Journal: JournalType,
        /** Optional per-column display metadata. */
        ColumnMeta: ColumnMetaType,
        /** Confounder row (set-up rail). */
        Confounder: ConfounderType,
        /** Balance row (Answer tab). */
        Balance: BalanceRowType,
        /** Population/comparison filter clause. */
        FilterClause: FilterClauseType,
        /** Refutation check row. */
        RefuteCheck: RefuteCheckType,
        /** Dose-curve reference marker. */
        DoseMark: DoseMarkType,
        /** Marginal-gain bar. */
        Marginal: MarginalRowType,
        /** Committed-experiment journal row. */
        JournalRow: JournalRowType,
    },
} as const;
