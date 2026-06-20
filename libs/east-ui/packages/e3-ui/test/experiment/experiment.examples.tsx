/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Experiment component example — an interactive causal-experiment surface over a
 * generic manufacturing process. The worked question is *"did `slow_cure` change
 * `bond_strength`?"* — a confounding-by-indication story: the optional slow-cure
 * step is applied to the weaker incoming material, so the raw average makes it
 * look worse (−3.1) while the like-for-like estimate flips it positive (+5.2),
 * and the honesty verdict is `causal`.
 *
 * Pattern (the real, interactive shape — not a mock):
 *   1. `e3.input('batches', Array(BatchRow), [...])` — the **input dataset**. The
 *      renderer introspects this row struct to drive the treatment / outcome /
 *      confounder pickers, exactly like `Table`.
 *   2. `e3.input('experiment_config', Experiment.Types.Config, {...})` — the
 *      staged config the pickers edit (snake_case; structurally identical to
 *      east-py-datascience's `Causal.Types.CausalExperimentConfigType`).
 *   3. ONE `e3.function('experiment', (rows, config) → ExperimentResult)`. In
 *      production its body calls east-py-datascience's `Causal.experiment`; here
 *      it is a pure-East fixture returning the constants the real engine would,
 *      so the surface runs offline with no datascience dependency. The snapshot
 *      harness compiles this body to seed the function — the numbers live only
 *      here, so the two copies cannot drift.
 *   4. `<Experiment data config experiment journal />`. The renderer auto-runs on
 *      mount, derives every word / colour / bar from the single returned result
 *      and its `verdict`, and re-runs when the user edits the config.
 */

import {
    East, ArrayType, StructType, BooleanType, FloatType, IntegerType, StringType, DateTimeType,
    some, none, variant, example,
} from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui';
import { Data, Experiment, Func } from '@elaraai/e3-ui';
import e3 from '@elaraai/e3';

// ============================================================================
// Input dataset — the bonded-panel batches. The surface frames over these
// columns; the estimator ignores the rows (it returns a fixture).
// ============================================================================

/** One production batch — the row struct the pickers are generic over. */
export const BatchRow = StructType({
    slow_cure: BooleanType,        // treatment (yes / no)
    bond_strength: FloatType,      // outcome (MPa)
    incoming_grade: FloatType,     // confounder — the cure is applied to weaker stock
    mix_viscosity: FloatType,      // confounder
    supplier: IntegerType,         // confounder (categorical code)
    line: StringType,              // population filter dimension
    product: StringType,           // population filter dimension
    run_date: DateTimeType,        // suggested-but-unused column
});

export const batchesInput = e3.input('batches', ArrayType(BatchRow), [
    { slow_cure: false, bond_strength: 9.0, incoming_grade: 9.0, mix_viscosity: 24.1, supplier: 0n, line: 'A', product: 'panel', run_date: new Date('2026-05-02') },
    { slow_cure: false, bond_strength: 8.6, incoming_grade: 8.5, mix_viscosity: 24.0, supplier: 0n, line: 'B', product: 'panel', run_date: new Date('2026-05-03') },
    { slow_cure: false, bond_strength: 8.2, incoming_grade: 8.0, mix_viscosity: 24.2, supplier: 1n, line: 'A', product: 'panel', run_date: new Date('2026-05-04') },
    { slow_cure: false, bond_strength: 7.7, incoming_grade: 7.5, mix_viscosity: 23.9, supplier: 0n, line: 'B', product: 'panel', run_date: new Date('2026-05-05') },
    { slow_cure: false, bond_strength: 7.3, incoming_grade: 7.0, mix_viscosity: 24.3, supplier: 1n, line: 'A', product: 'panel', run_date: new Date('2026-05-06') },
    { slow_cure: false, bond_strength: 6.8, incoming_grade: 6.5, mix_viscosity: 24.0, supplier: 0n, line: 'B', product: 'panel', run_date: new Date('2026-05-07') },
    { slow_cure: true, bond_strength: 7.1, incoming_grade: 5.0, mix_viscosity: 24.7, supplier: 1n, line: 'A', product: 'panel', run_date: new Date('2026-05-08') },
    { slow_cure: true, bond_strength: 6.6, incoming_grade: 4.5, mix_viscosity: 24.6, supplier: 1n, line: 'B', product: 'panel', run_date: new Date('2026-05-09') },
    { slow_cure: true, bond_strength: 6.2, incoming_grade: 4.0, mix_viscosity: 24.8, supplier: 1n, line: 'A', product: 'panel', run_date: new Date('2026-05-10') },
    { slow_cure: true, bond_strength: 5.7, incoming_grade: 3.5, mix_viscosity: 24.5, supplier: 0n, line: 'B', product: 'panel', run_date: new Date('2026-05-11') },
    { slow_cure: true, bond_strength: 5.3, incoming_grade: 3.0, mix_viscosity: 24.9, supplier: 1n, line: 'A', product: 'panel', run_date: new Date('2026-05-12') },
    { slow_cure: true, bond_strength: 4.8, incoming_grade: 2.5, mix_viscosity: 24.7, supplier: 1n, line: 'B', product: 'panel', run_date: new Date('2026-05-13') },
]);

// ============================================================================
// Staged config — the experiment the user framed (the pickers edit this).
// ============================================================================

export const experimentConfigInput = e3.input('experiment_config', Experiment.Types.Config, {
    treatment: 'slow_cure',
    outcome: 'bond_strength',
    common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
    categorical: some(['supplier']),
    method: some(variant('propensity_score_weighting', { weighting_scheme: some(variant('ips_stabilized_weight', null)) })),
    estimand: some(variant('ate', null)),
    refute: some({ placebo: true, random_common_cause: true, data_subset: true, sensitivity: some([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]) }),
    dose_feature: some('incoming_grade'),
    min_overlap: some(0.1),
    min_treatment_variation: some(0.02),
    bootstrap: none,
    random_state: some(42n),
    strong_overlap: none,
    evalue_floor: none,
    expected_sign: none,
});

// ============================================================================
// Estimator — ONE pure-East fixture returning the full numeric contract.
// Exported so the snapshot harness compiles + seeds the *same* numbers (no drift).
// ============================================================================

export const experimentFn = e3.function('experiment',
    East.function([ArrayType(BatchRow), Experiment.Types.Config], Experiment.Types.Result, (_$, _data, _config) => ({
        naive: -3.1,
        naive_ci: some({ lower: -6.0, upper: -0.2 }),
        adjusted: some({ effect: 5.2, ci: some({ lower: 3.1, upper: 7.4 }) }),
        n_total: 480n, n_treated: 240n, n_control: 240n, n_dropped: 31n,
        balance: [
            { column: 'incoming_grade', base_column: 'incoming_grade', treated_mean: 6.1, control_mean: 8.0, std_diff: 0.90 },
            { column: 'supplier', base_column: 'supplier', treated_mean: 0.61, control_mean: 0.33, std_diff: 0.55 },
            { column: 'mix_viscosity', base_column: 'mix_viscosity', treated_mean: 24.6, control_mean: 24.1, std_diff: 0.24 },
        ],
        overlap: {
            treated_propensity: new Float64Array([0, 0, 1, 2, 4, 6, 9, 12, 15, 18, 20, 21, 19, 16, 12, 8, 5, 3, 1, 0]),
            control_propensity: new Float64Array([0, 2, 5, 9, 14, 18, 21, 20, 17, 13, 9, 6, 4, 2, 1, 1, 0, 0, 0, 0]),
            common_support_frac: 0.78,
            positivity_ok: true,
            support_strength: variant('strong', null),
        },
        refutation: some({
            placebo_effect: some(0.0),
            placebo_passes: some(true),
            random_cc_within_ci: some(true),
            data_subset_effect: some(5.0),
            data_subset_std: some(0.4),
            robustness_value: some(2.3),
            sensitivity: some({
                strengths: new Float64Array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]),
                effects: new Float64Array([5.2, 4.4, 3.4, 2.2, 0.8, -0.8]),
            }),
            expected_sign_ok: none,
        }),
        dose_response: some({
            feature: 'incoming_grade',
            grid: new Float64Array([2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5]),
            effect: new Float64Array([0.0, 1.5, 2.6, 3.4, 4.0, 4.4, 4.6, 4.72, 4.8]),
            lower: some(new Float64Array([-0.1, 1.0, 2.0, 2.7, 3.3, 3.7, 3.9, 4.0, 4.1])),
            upper: some(new Float64Array([0.3, 2.0, 3.2, 4.1, 4.7, 5.1, 5.3, 5.45, 5.5])),
            size: new BigInt64Array([40n, 52n, 61n, 66n, 70n, 58n, 44n, 30n, 18n]),
        }),
        verdict: variant('causal', null),
    })));

// ============================================================================
// Design — ONE pure-East fixture for the optional `design` function (the
// "Validate" tab). Like `experimentFn`, the numbers are hardcoded so the surface
// renders offline; `Causal.designValidation` would compute them in production.
// ============================================================================

export const designFn = e3.function('design',
    East.function(
        [ArrayType(BatchRow), Experiment.Types.Config, Experiment.Types.Result, Experiment.Types.DesignConfig],
        Experiment.Types.Design,
        (_$, _data, _config, _result, _designConfig) => ({
            verdict: variant('causal', null),
            basis: variant('detect_observed', null),
            target_effect: 5.2,
            outcome_sd: 1.4,
            target_power: 0.8,
            alpha: 0.05,
            current_power: some(0.42),
            match_on: ['incoming_grade', 'supplier'],
            options: [
                { label: 'Even split', treated_share: 0.5, n_treated: 60n, n_control: 60n, n_total: 120n },
                { label: 'Treat fewer', treated_share: 0.33, n_treated: 45n, n_control: 91n, n_total: 136n },
            ],
            power_curve: {
                n: new BigInt64Array([40n, 80n, 120n, 160n, 200n, 240n]),
                power: new Float64Array([0.32, 0.55, 0.72, 0.84, 0.91, 0.95]),
            },
            rationale: 'A randomised trial of ~120 batches (even split), matched on incoming grade and supplier, detects a +5.2 MPa effect at 80% power (α = 0.05).',
        }),
    ));

// ============================================================================
// Journal — committed experiments (newest first). The verdict is STORED on each
// row (not recomputed); the renderer derives only its colour/word from it.
// ============================================================================

export const experimentJournalInput = e3.input('experiment_journal', Experiment.Types.Journal, [
    {
        config: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
            categorical: none, method: none, estimand: none, refute: none,
            dose_feature: none, min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: none,
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        verdict: variant('causal', null), naive: -3.1, adjusted: some(5.2),
        committed_at: new Date('2026-06-13T08:00:00Z'), committed_by: 'M. Kerr',
        preset: some('cure_strength'),
    },
    {
        config: {
            treatment: 'extra_anneal', outcome: 'hardness', common_causes: ['line', 'mix_viscosity'],
            categorical: none, method: none, estimand: none, refute: none,
            dose_feature: none, min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: none,
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        verdict: variant('modest', null), naive: 0.4, adjusted: some(0.4),
        committed_at: new Date('2026-06-09T08:00:00Z'), committed_by: 'M. Kerr',
        preset: none,
    },
    {
        config: {
            treatment: 'new_nozzle', outcome: 'throughput', common_causes: ['line', 'batch_size'],
            categorical: none, method: none, estimand: none, refute: none,
            dose_feature: none, min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: none,
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        verdict: variant('causal', null), naive: 22.0, adjusted: some(38.0),
        committed_at: new Date('2026-06-02T08:00:00Z'), committed_by: 'T. Ode',
        preset: none,
    },
]);

// ============================================================================
// Population filter — the Step-4 "Which batches?" predicates, seeded so the
// surface loads with filter chips applied. UI-side only: it narrows the rows
// before the call and is NOT part of the config the function receives.
// ============================================================================

export const experimentPopulationInput = e3.input('experiment_population', Experiment.Types.Population, [
    variant('string', { fieldId: 'line', op: variant('in', new Set(['A', 'B'])) }),
    variant('string', { fieldId: 'product', op: variant('eq', 'panel') }),
]);

// ============================================================================
// Scene — the full surface bound to the dataset, config, estimator and journal.
// ============================================================================

export const experimentSurface = example({
    keywords: ['Experiment', 'causal', 'effect', 'confounding', 'forest', 'verdict', 'Data', 'Func', 'bind', 'generic'],
    description: 'An interactive causal-experiment surface: "did slow_cure change bond_strength?" — confounding by indication, with the raw-vs-adjusted sign flip and a "causal" verdict. The "Answer" tab. Generic over the bound dataset; the result comes from one bound estimator function and every word is derived from the numbers + verdict.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const config = $.let(Data.bind(experimentConfigInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const population = $.let(Data.bind(experimentPopulationInput, { mode: 'staged' }));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    config={config}
                    experiment={experiment}
                    population={population}
                    journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const experimentTrust = example({
    keywords: ['Experiment', 'causal', 'refute', 'trust', 'sensitivity', 'robustness', 'verdict'],
    description: 'The Experiment "Can we trust it?" tab — the refutation checklist (shuffle / drop-some / decoy / hidden-cause) and the unobserved-confounder sensitivity curve, all from the single result\'s refutation summary.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const config = $.let(Data.bind(experimentConfigInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const population = $.let(Data.bind(experimentPopulationInput, { mode: 'staged' }));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    config={config}
                    experiment={experiment}
                    population={population}
                    journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }}
                    defaultTab="trust"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const experimentDose = example({
    keywords: ['Experiment', 'causal', 'dose', 'ale', 'response', 'marginal'],
    description: 'The Experiment "How much?" tab — the ALE dose-response curve (with "you are here" + "sweet spot" markers) and the marginal-gain-per-step bars, from the single result\'s dose_response.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const config = $.let(Data.bind(experimentConfigInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const population = $.let(Data.bind(experimentPopulationInput, { mode: 'staged' }));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    config={config}
                    experiment={experiment}
                    population={population}
                    journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }}
                    defaultTab="dose"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const experimentValidate = example({
    keywords: ['Experiment', 'causal', 'validate', 'design', 'trial', 'rct', 'power', 'sample-size'],
    description: 'The Experiment "Validate" tab — the optional `design` function turns the landed result into the recipe for a real randomised controlled trial: the split meter, the confounders to match the groups on, and the power curve sized from the observed effect.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const config = $.let(Data.bind(experimentConfigInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const population = $.let(Data.bind(experimentPopulationInput, { mode: 'staged' }));
            const experiment = $.let(Func.bind(experimentFn));
            const design = $.let(Func.bind(designFn));
            return (
                <Experiment
                    data={data}
                    config={config}
                    experiment={experiment}
                    design={design}
                    population={population}
                    journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }}
                    defaultTab="validate"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const experimentPresets = example({
    keywords: ['Experiment', 'presets', 'causal', 'questions', 'vetted', 'dropdown', 'title', 'menu', 'scope'],
    description: 'The Experiment `presets` — the title doubles as a question selector: a chevron after the header turns it into a dropdown of named, developer-authored questions (current one checked). Each bundles a vetted backdoor set (and an optional population scope); selecting one snaps the staged spec + filters to that pre-baked configuration (still editable before Run), and a committed result records which preset it came from. Lets a domain expert pick a correct causal question from a menu rather than assemble one.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const config = $.let(Data.bind(experimentConfigInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const population = $.let(Data.bind(experimentPopulationInput, { mode: 'staged' }));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    config={config}
                    experiment={experiment}
                    population={population}
                    journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }}
                    presets={[
                        {
                            id: 'cure_strength',
                            label: 'Slow cure → bond strength',
                            // The vetted backdoor set for this question; only the fields it
                            // pins are written — the rest default to the library default.
                            config: {
                                treatment: 'slow_cure', outcome: 'bond_strength',
                                common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
                                categorical: ['supplier'],
                            },
                        },
                        {
                            id: 'cure_strength_panels',
                            label: 'Slow cure → strength (panels only)',
                            config: {
                                treatment: 'slow_cure', outcome: 'bond_strength',
                                common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
                                categorical: ['supplier'],
                            },
                            // The same question, pre-scoped to one product family.
                            population: [variant('string', { fieldId: 'product', op: variant('eq', 'panel') })],
                        },
                        {
                            id: 'cure_strength_byline',
                            label: 'Slow cure → strength (control for line)',
                            // A stricter backdoor set — also adjusts for the production line.
                            config: {
                                treatment: 'slow_cure', outcome: 'bond_strength',
                                common_causes: ['incoming_grade', 'mix_viscosity', 'supplier', 'line'],
                                categorical: ['supplier', 'line'],
                            },
                        },
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
