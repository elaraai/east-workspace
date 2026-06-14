/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Experiment` component — an interactive causal-experiment surface.
 *
 * @remarks
 * `Experiment` lets a domain expert ask *"did X change Y?"* against a dataset
 * and trust the answer, without meeting a statistician's vocabulary. It is a
 * registered extension component (architecturally like {@link Ontology}): the
 * author writes one tag, `Experiment.Root({ … })`; the React renderer lives in
 * `@elaraai/e3-ui-components` and is wired via
 * `implementUIComponent(Experiment.Component, EastChakraExperiment)`.
 *
 * **Generic over the input row, like `Table`.** The author binds the input
 * dataset (`data: BoundValue<ArrayType<Row>>`); the renderer introspects its
 * row struct to drive the treatment / outcome / confounder pickers, so the
 * **end user** re-frames the experiment from the dataset's own columns.
 *
 * **The user adjusts → results go stale → Run re-computes.** Editing a picker
 * stages a new {@link ExperimentSpecType} and marks the result stale; **Run**
 * calls the author-supplied estimator functions ({@link Func.bind} handles) and
 * the answer arrives reactively; **Commit** appends to the journal. The causal
 * compute (DoWhy / EconML) lives entirely in those function bodies, so `e3-ui`
 * never imports `east-py-datascience`.
 *
 * **Visual-first and derived.** Because the user frames an arbitrary
 * experiment, nothing on the result side is hand-authored — every word is a
 * column name the user picked, a number an estimator returned, or a status
 * derived by rule (interval clears zero → HIGHER / LOWER; spans zero → NO CLEAR
 * EFFECT; raw and adjusted disagree in sign → the "misleading" banner). The
 * contract types ({@link ExperimentSpecType}, {@link ExperimentResultType}, …)
 * live in {@link "./experiment/types"} and are reached via `Experiment.Types.*`.
 *
 * @packageDocumentation
 */

import {
    East,
    NullType,
    BooleanType,
    StringType,
    ArrayType,
    StructType,
    VariantType,
    OptionType,
    none,
    some,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';
import { EastUI, type UIComponentType } from '@elaraai/east-ui';

import { DiffBindingType, type BoundValue } from '../data.js';
import { FuncBindingType, type BoundFunc } from '../func.js';
import {
    ExperimentSpecType,
    ExperimentResultType,
    RefuteResultType,
    DoseResultType,
    JournalType,
    ColumnMetaType,
} from './types.js';

// Re-export the contract types so consumers can reach them from the component
// module too (the canonical home is `./types`).
export {
    WeightingSchemeType,
    EstimatorType,
    TargetUnitsType,
    TrimType,
    ExperimentSpecType,
    CiType,
    BalanceRowType,
    ExperimentResultType,
    RefuteKindType,
    RefuteCheckType,
    RefuteResultType,
    DoseSegmentType,
    DoseResultType,
    JournalRowType,
    JournalType,
    ColumnMetaType,
} from './types.js';

// ============================================================================
// Function signatures — the author's three estimator functions, generic over
// the bound row struct `Row`.
// ============================================================================

/**
 * The `estimate` function signature: `(rows, spec) → ExperimentResult`. The
 * renderer calls this on **Run** with the bound `data` and the staged spec.
 *
 * @typeParam Row - The input dataset's row struct.
 */
export type EstimateFunc<Row extends StructType> =
    BoundFunc<[ArrayType<Row>, ExperimentSpecType], ExperimentResultType>;

/**
 * The optional `refute` function signature: `(rows, spec) → RefuteResult` — the
 * robustness battery shown in the "Can we trust it?" tab.
 *
 * @typeParam Row - The input dataset's row struct.
 */
export type RefuteFunc<Row extends StructType> =
    BoundFunc<[ArrayType<Row>, ExperimentSpecType], RefuteResultType>;

/**
 * The optional `dose` function signature: `(rows, spec, feature) → DoseResult` —
 * the ALE dose-response curve for the chosen `feature` column shown in the "How
 * much?" tab.
 *
 * @typeParam Row - The input dataset's row struct.
 */
export type DoseFunc<Row extends StructType> =
    BoundFunc<[ArrayType<Row>, ExperimentSpecType, StringType], DoseResultType>;

// ============================================================================
// Component payload — descriptors only (binding handles + options).
// ============================================================================

/** Initial result tab variant — `answer` (default), `trust`, or `dose`. */
export const ExperimentTabType = VariantType({ answer: NullType, trust: NullType, dose: NullType });
/** Type alias for {@link ExperimentTabType}. */
export type ExperimentTabType = typeof ExperimentTabType;

/**
 * The `Experiment` component payload — binding descriptors + options. Renderers
 * decode this and resolve each binding to a live, reactive value / call handle.
 *
 * @property data - {@link DiffBindingType} for the input dataset — the renderer
 *   introspects its row struct for the pickers and passes it to the functions.
 * @property spec - {@link DiffBindingType} for the staged {@link ExperimentSpecType}.
 * @property estimate - {@link FuncBindingType} for the `estimate` function.
 * @property refute - Optional {@link FuncBindingType} for the `refute` function.
 * @property dose - Optional {@link FuncBindingType} for the `dose` function.
 * @property journal - Optional {@link DiffBindingType} for the committed-experiment journal.
 * @property columnMeta - Optional per-column display metadata.
 * @property readonly - Render without the Run / Commit / edit affordances.
 * @property defaultTab - Initial result tab ({@link ExperimentTabType}).
 */
export const ExperimentPayloadType = StructType({
    data: DiffBindingType,
    spec: DiffBindingType,
    estimate: FuncBindingType,
    refute: OptionType(FuncBindingType),
    dose: OptionType(FuncBindingType),
    journal: OptionType(DiffBindingType),
    columnMeta: OptionType(ColumnMetaType),
    readonly: OptionType(BooleanType),
    defaultTab: OptionType(ExperimentTabType),
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
 * Options for {@link Experiment.Root}, generic over the input row struct.
 *
 * @typeParam Row - The input dataset's row struct — inferred from `data`.
 *
 * @property data - The {@link Data.bind} handle for the input dataset.
 * @property spec - The {@link Data.bind} handle for the staged experiment spec.
 * @property estimate - The {@link Func.bind} handle for the estimator.
 * @property refute - Optional {@link Func.bind} handle for the robustness battery.
 * @property dose - Optional {@link Func.bind} handle for the dose-response curve.
 * @property journal - Optional {@link Data.bind} handle for the committed-experiment journal.
 * @property columnMeta - Optional per-column display metadata.
 * @property readonly - Render without mutation affordances.
 * @property defaultTab - Initial result tab.
 */
/**
 * Per-column display config — the friendly label, unit suffix, and good
 * direction the surface uses to phrase results ("worse" instead of "lower").
 */
export interface ExperimentColumnConfig {
    /** Friendly label shown instead of the raw column name. */
    label?: string;
    /** Unit suffix ("MPa", "$", …). */
    unit?: string;
    /** Whether a larger value is the good direction (flips "lower" → "worse"). */
    higherIsBetter?: boolean;
}

/**
 * Type-safe per-column config, keyed by the bound dataset's field names (the
 * `Table` columns pattern) — only real columns are accepted as keys.
 *
 * @typeParam Row - The input dataset's row struct.
 */
export type ExperimentColumns<Row extends StructType> = {
    [K in Extract<keyof Row['fields'], string>]?: ExperimentColumnConfig;
};

export interface ExperimentOptions<Row extends StructType> {
    data: BoundValue<ArrayType<Row>>;
    spec: BoundValue<ExperimentSpecType>;
    estimate: EstimateFunc<Row>;
    refute?: RefuteFunc<Row>;
    dose?: DoseFunc<Row>;
    journal?: BoundValue<JournalType>;
    /** Per-column display config, keyed by the data row's fields (like `Table`). */
    columns?: ExperimentColumns<Row>;
    readonly?: SubtypeExprOrValue<OptionType<BooleanType>>;
    defaultTab?: ExperimentTabLiteral;
}

/**
 * Build an Experiment surface bound to an input dataset + estimator functions.
 *
 * @typeParam Row - The input dataset's row struct, inferred from `data`.
 * @param options - {@link ExperimentOptions}. `data`, `spec` and `estimate` are
 *   required; the rest are optional.
 * @returns An East expression of {@link UIComponentType}.
 */
function createExperiment<Row extends StructType>(options: ExperimentOptions<Row>): ExprType<UIComponentType> {
    const defaultTab = options.defaultTab === undefined
        ? none
        : some(East.value(variant(options.defaultTab, null), ExperimentTabType));
    const columnMeta = options.columns === undefined
        ? none
        : some(East.value(
            new Map(Object.entries(options.columns).map(([k, c]) => [k, {
                label: c?.label !== undefined ? some(c.label) : none,
                unit: c?.unit !== undefined ? some(c.unit) : none,
                higherIsBetter: c?.higherIsBetter !== undefined ? some(c.higherIsBetter) : none,
            }] as const)),
            ColumnMetaType,
        ));
    return ExperimentComponent.Root({
        data: options.data.binding,
        spec: options.spec.binding,
        estimate: options.estimate.binding,
        refute: options.refute !== undefined ? some(options.refute.binding) : none,
        dose: options.dose !== undefined ? some(options.dose.binding) : none,
        journal: options.journal !== undefined ? some(options.journal.binding) : none,
        columnMeta,
        readonly: options.readonly ?? none,
        defaultTab,
    });
}

/**
 * The Experiment component namespace. Surfaces an interactive causal-experiment
 * over a bound input dataset + estimator functions, generic over the row struct
 * (the `Table` pattern), with the staged-binding machinery the rest of e3-ui
 * uses.
 *
 * @remarks
 * Use `Experiment.Root({ data, spec, estimate, refute, dose, journal })` inside
 * a `Reactive` block. The `Component` property is the {@link EastUI.component}
 * carrier the renderer registers against; `Types` exposes the render-contract
 * value types (`Spec`, `Result`, `Refute`, `Dose`, `Journal`, …).
 */
export const Experiment = {
    Root: createExperiment,
    /** The internal {@link EastUI.component} carrier renderers register against. */
    Component: ExperimentComponent,
    Types: {
        /** Rendered payload struct (bindings + options). */
        Payload: ExperimentPayloadType,
        /** The experiment-spec value type (what the pickers stage). */
        Spec: ExperimentSpecType,
        /** The estimator answer value type. */
        Result: ExperimentResultType,
        /** The robustness-battery value type. */
        Refute: RefuteResultType,
        /** The dose-response value type. */
        Dose: DoseResultType,
        /** The committed-experiment journal value type. */
        Journal: JournalType,
        /** Optional per-column display metadata. */
        ColumnMeta: ColumnMetaType,
        /** Initial result tab variant. */
        Tab: ExperimentTabType,
    },
} as const;
