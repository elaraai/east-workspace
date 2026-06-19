/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Experiment` component — an interactive causal-experiment surface.
 *
 * @remarks
 * `Experiment` lets a domain expert ask *"did X change Y, and can I trust it?"*
 * against a dataset and read a derived, honest answer — without meeting a
 * statistician's vocabulary. It is a registered extension component
 * (architecturally like {@link Ontology}): the author writes one tag,
 * `Experiment.Root({ … })`; the React renderer lives in
 * `@elaraai/e3-ui-components`.
 *
 * **Generic over the input row, like `Table`.** The author binds the input
 * dataset (`data: BoundValue<ArrayType<Row>>`); the renderer introspects its row
 * struct to drive the treatment / outcome / confounder pickers.
 *
 * **The user edits the config → Apply runs ONE function.** Editing a picker
 * stages a new {@link ExperimentConfigType}; **Apply** calls the single bound
 * `experiment` function (`(rows, config) → ExperimentResult`) and the answer
 * arrives reactively. The result carries the naive vs adjusted effect, balance,
 * overlap, robustness, and an honesty **verdict** — `adjusted` is `none` when the
 * engine refuses. **Commit** appends to the journal.
 *
 * **Visual-first and derived.** Nothing on the result side is hand-authored —
 * every word is a column name the user picked, a number the engine returned, or
 * a status derived by rule from the verdict tag.
 *
 * @packageDocumentation
 */

import {
    NullType,
    BooleanType,
    ArrayType,
    StructType,
    VariantType,
    OptionType,
    East,
    none,
    some,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from '@elaraai/east';
import { EastUI, type UIComponentType } from '@elaraai/east-ui';

import { DiffBindingType, type BoundValue } from '../bind/data.js';
import { FuncBindingType, type BoundFunc } from '../bind/func.js';
import {
    ExperimentConfigType,
    ExperimentResultType,
    DoseResponseType,
    JournalType,
    ColumnMetaType,
    PopulationType,
    PresetType,
    DesignConfigType,
    ExperimentDesignType,
    EstimatorType,
    TargetUnitsType,
    BootstrapConfigType,
    RefuteSpecType,
    SignType,
    CiType,
    BalanceRowType,
    OverlapDiagnosticType,
    RefutationType,
    SensitivityCurveType,
    AdjustedEffectType,
    ExperimentVerdictType,
} from './types.js';

// Re-export the contract types so consumers can reach them from the component
// module too (the canonical home is `./types`).
export {
    CiType,
    WeightingSchemeType,
    EstimatorType,
    TargetUnitsType,
    BootstrapConfigType,
    RefuteSpecType,
    ExperimentConfigType,
    BalanceRowType,
    OverlapDiagnosticType,
    RefutationType,
    DoseResponseType,
    ExperimentVerdictType,
    ExperimentResultType,
    JournalRowType,
    JournalType,
    ColumnMetaType,
    PopulationType,
    PresetType,
} from './types.js';

// ============================================================================
// Function signature — the author's single estimator function, generic over the
// bound row struct `Row`.
// ============================================================================

/**
 * The `experiment` function signature: `(rows, config) → ExperimentResult`. The
 * renderer calls this on **Apply** with the bound `data` and the staged config.
 *
 * @typeParam Row - The input dataset's row struct.
 */
export type ExperimentFunc<Row extends StructType> =
    BoundFunc<[ArrayType<Row>, ExperimentConfigType], ExperimentResultType>;

// The optional `design` function — turns a finished result into the recipe for a
// real controlled trial that would validate it. Generic over the row, like the
// experiment function; takes the rows + config + the landed result + design knobs.
export type ExperimentDesignFunc<Row extends StructType> =
    BoundFunc<[ArrayType<Row>, ExperimentConfigType, ExperimentResultType, DesignConfigType], ExperimentDesignType>;

// ============================================================================
// Component payload — descriptors only (binding handles + options).
// ============================================================================

/** Initial result tab variant — `answer` (default), `trust`, `dose`, or `validate`. */
export const ExperimentTabType = VariantType({ answer: NullType, trust: NullType, dose: NullType, validate: NullType });
/** Type alias for {@link ExperimentTabType}. */
export type ExperimentTabType = typeof ExperimentTabType;

/**
 * The `Experiment` component payload — binding descriptors + options. Renderers
 * decode this and resolve each binding to a live, reactive value / call handle.
 *
 * @property data - {@link DiffBindingType} for the input dataset — the renderer
 *   introspects its row struct for the pickers and passes it to the function.
 * @property config - {@link DiffBindingType} for the staged {@link ExperimentConfigType}.
 * @property experiment - {@link FuncBindingType} for the single `experiment` function.
 * @property population - Optional {@link DiffBindingType} for the staged Step-4
 *   population filter ({@link PopulationType}); narrows rows UI-side before the call.
 * @property journal - Optional {@link DiffBindingType} for the committed-experiment journal.
 * @property columnMeta - Optional per-column display metadata.
 * @property readonly - Render without the Apply / Commit / edit affordances.
 * @property defaultTab - Initial result tab ({@link ExperimentTabType}).
 */
export const ExperimentPayloadType = StructType({
    data: DiffBindingType,
    config: DiffBindingType,
    experiment: FuncBindingType,
    population: OptionType(DiffBindingType),
    journal: OptionType(DiffBindingType),
    /** Optional `design` function → the validation-trial recipe ("Validate" tab). */
    design: OptionType(FuncBindingType),
    columnMeta: OptionType(ColumnMetaType),
    readonly: OptionType(BooleanType),
    defaultTab: OptionType(ExperimentTabType),
    /** Optional developer-authored {@link PresetType} list — named vetted questions
     *  rendered as a card grid; selecting one snaps the staged spec + scope. */
    presets: OptionType(ArrayType(PresetType)),
});
/** Type alias for {@link ExperimentPayloadType}. */
export type ExperimentPayloadType = typeof ExperimentPayloadType;

/** Initial result tab as a string literal. */
export type ExperimentTabLiteral = 'answer' | 'trust' | 'dose' | 'validate';

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components`.
 */
export const ExperimentComponent = EastUI.component('Experiment', ExperimentPayloadType, { optional: true });

// ============================================================================
// User-facing factory.
// ============================================================================

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

/**
 * A preset's pre-baked experiment config — a friendly, mostly-optional shape over
 * {@link ExperimentConfigType}. The column-bearing fields are checked against the
 * bound row's columns (like {@link ExperimentColumns}); every other field is optional
 * and falls back to the library default (`none`) when omitted, so a preset author
 * writes only what the question actually pins.
 *
 * @typeParam Row - The input dataset's row struct.
 */
export interface ExperimentPresetConfig<Row extends StructType> {
    /** Binary treatment column. */
    treatment: Extract<keyof Row['fields'], string>;
    /** Outcome column. */
    outcome: Extract<keyof Row['fields'], string>;
    /** Confounders to adjust for (the backdoor set). */
    common_causes: Extract<keyof Row['fields'], string>[];
    /** Confounder columns holding categories (one-hot encoded). */
    categorical?: Extract<keyof Row['fields'], string>[];
    /** Continuous column for the ALE dose-response curve. */
    dose_feature?: Extract<keyof Row['fields'], string>;
    /** Estimator (default: linear_regression). */
    method?: SubtypeExprOrValue<EstimatorType>;
    /** Target population (default: ate). */
    estimand?: SubtypeExprOrValue<TargetUnitsType>;
    /** Which robustness checks to run. */
    refute?: SubtypeExprOrValue<RefuteSpecType>;
    /** Bootstrap CI config. */
    bootstrap?: SubtypeExprOrValue<BootstrapConfigType>;
    /** Directional prior — flags an implausibly-signed effect. */
    expected_sign?: SubtypeExprOrValue<SignType>;
    /** Positivity refuse gate (default 0.10). */
    min_overlap?: number;
    /** Not-estimable guard (default 0.02). */
    min_treatment_variation?: number;
    /** Strong-overlap gate (default 0.55). */
    strong_overlap?: number;
    /** E-value floor (off by default). */
    evalue_floor?: number;
    /** Random seed — pin for a reproducible verdict. */
    random_state?: bigint;
}

/**
 * One developer-authored preset for {@link ExperimentOptions.presets} — a named,
 * vetted question (+ optional scope) selectable from the surface's preset grid.
 *
 * @typeParam Row - The input dataset's row struct.
 */
export interface ExperimentPreset<Row extends StructType> {
    /** Stable, **unique** id — recorded in the journal and used as the selection
     *  identity; keep it distinct from `label` so a renamed label never orphans a
     *  committed row. Two presets must not share an id. */
    id: string;
    /** Display title on the card. */
    label: string;
    /** The vetted, pre-baked config. */
    config: ExperimentPresetConfig<Row>;
    /** Optional population scope applied on select (omit ⇒ clears the scope). */
    population?: SubtypeExprOrValue<PopulationType>;
    /** Optional section header — cards sharing a `group` are bucketed together. */
    group?: string;
}

/**
 * Options for {@link Experiment.Root}, generic over the input row struct.
 *
 * @typeParam Row - The input dataset's row struct — inferred from `data`.
 *
 * @property data - The {@link Data.bind} handle for the input dataset.
 * @property config - The {@link Data.bind} handle for the staged experiment config.
 * @property experiment - The {@link Func.bind} handle for the experiment function.
 * @property population - Optional {@link Data.bind} handle for the staged Step-4
 *   population filter (a {@link PopulationType}); narrows the rows UI-side before
 *   the call. Bind it (seeded) to start with filters applied.
 * @property journal - Optional {@link Data.bind} handle for the committed-experiment journal.
 * @property columns - Optional per-column display config.
 * @property readonly - Render without mutation affordances.
 * @property defaultTab - Initial result tab.
 */
export interface ExperimentOptions<Row extends StructType> {
    data: BoundValue<ArrayType<Row>>;
    config: BoundValue<ExperimentConfigType>;
    experiment: ExperimentFunc<Row>;
    /** Optional `design` function — adds the "Validate" tab (the trial recipe). */
    design?: ExperimentDesignFunc<Row>;
    population?: BoundValue<PopulationType>;
    journal?: BoundValue<JournalType>;
    /** Per-column display config, keyed by the data row's fields (like `Table`). */
    columns?: ExperimentColumns<Row>;
    readonly?: SubtypeExprOrValue<OptionType<BooleanType>>;
    defaultTab?: ExperimentTabLiteral;
    /** Developer-authored vetted questions — a card grid that snaps the staged spec
     *  (and scope) on select. Column fields are checked against the row's columns. */
    presets?: Array<ExperimentPreset<Row>>;
}

/**
 * Build an Experiment surface bound to an input dataset + the single experiment
 * function.
 *
 * @typeParam Row - The input dataset's row struct, inferred from `data`.
 * @param options - {@link ExperimentOptions}. `data`, `config` and `experiment`
 *   are required; the rest are optional.
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
    // Each preset's friendly partial config is completed to a full ExperimentConfig
    // here — the author writes only the fields a question pins; the rest default to
    // `none` (the library default). The author never hand-rolls a some/none wrapper.
    const presets = options.presets === undefined
        ? none
        : some(East.value(
            options.presets.map(p => ({
                id: p.id,
                label: p.label,
                config: {
                    treatment: p.config.treatment,
                    outcome: p.config.outcome,
                    common_causes: p.config.common_causes,
                    categorical: p.config.categorical !== undefined ? some(p.config.categorical) : none,
                    method: p.config.method !== undefined ? some(p.config.method) : none,
                    estimand: p.config.estimand !== undefined ? some(p.config.estimand) : none,
                    refute: p.config.refute !== undefined ? some(p.config.refute) : none,
                    dose_feature: p.config.dose_feature !== undefined ? some(p.config.dose_feature) : none,
                    min_overlap: p.config.min_overlap !== undefined ? some(p.config.min_overlap) : none,
                    min_treatment_variation: p.config.min_treatment_variation !== undefined ? some(p.config.min_treatment_variation) : none,
                    bootstrap: p.config.bootstrap !== undefined ? some(p.config.bootstrap) : none,
                    random_state: p.config.random_state !== undefined ? some(p.config.random_state) : none,
                    strong_overlap: p.config.strong_overlap !== undefined ? some(p.config.strong_overlap) : none,
                    evalue_floor: p.config.evalue_floor !== undefined ? some(p.config.evalue_floor) : none,
                    expected_sign: p.config.expected_sign !== undefined ? some(p.config.expected_sign) : none,
                },
                population: p.population !== undefined ? some(p.population) : none,
                group: p.group !== undefined ? some(p.group) : none,
            })),
            ArrayType(PresetType),
        ));
    return ExperimentComponent.Root({
        data: options.data.binding,
        config: options.config.binding,
        experiment: options.experiment.binding,
        population: options.population !== undefined ? some(options.population.binding) : none,
        journal: options.journal !== undefined ? some(options.journal.binding) : none,
        design: options.design !== undefined ? some(options.design.binding) : none,
        columnMeta,
        readonly: options.readonly ?? none,
        defaultTab,
        presets,
    });
}

/**
 * The Experiment component namespace. Surfaces an interactive causal-experiment
 * over a bound input dataset + a single `experiment` function, generic over the
 * row struct (the `Table` pattern).
 *
 * @remarks
 * Use `Experiment.Root({ data, config, experiment, journal })` inside a
 * `Reactive` block. `Types` exposes the render-contract value types (`Config`,
 * `Result`, `Verdict`, `Overlap`, `Balance`, `Refutation`, `Journal`, …).
 */
export const Experiment = {
    Root: createExperiment,
    /** The internal {@link EastUI.component} carrier renderers register against. */
    Component: ExperimentComponent,
    Types: {
        /** Rendered payload struct (bindings + options). */
        Payload: ExperimentPayloadType,
        /** The experiment-config value type (what the pickers stage). */
        Config: ExperimentConfigType,
        /** The result value type (numbers + verdict). */
        Result: ExperimentResultType,
        /** A confidence interval. */
        Ci: CiType,
        /** The adjusted (like-for-like) effect + CI. */
        Adjusted: AdjustedEffectType,
        /** One confounder's before-adjustment imbalance (a balance row). */
        Balance: BalanceRowType,
        /** The propensity-overlap diagnostic. */
        Overlap: OverlapDiagnosticType,
        /** The robustness summary. */
        Refutation: RefutationType,
        /** The unobserved-confounder sensitivity (tipping) curve. */
        Sensitivity: SensitivityCurveType,
        /** The honesty verdict tag. */
        Verdict: ExperimentVerdictType,
        /** The ALE dose-response curve value type (the "How much?" tab). */
        DoseResponse: DoseResponseType,
        /** The committed-experiment journal value type. */
        Journal: JournalType,
        /** The validation-trial recipe value type (the "Validate" tab). */
        Design: ExperimentDesignType,
        /** The optional design-knobs value type. */
        DesignConfig: DesignConfigType,
        /** The UI-side Step-4 population filter value type (Array of Slice predicates). */
        Population: PopulationType,
        /** The developer-authored preset value type (named vetted question + scope). */
        Preset: PresetType,
        /** Optional per-column display metadata. */
        ColumnMeta: ColumnMetaType,
        /** Initial result tab variant. */
        Tab: ExperimentTabType,
    },
} as const;
