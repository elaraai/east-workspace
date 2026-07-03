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
 *   2. `e3.input('experiment_configs', Array(Configuration), [...])` — the list of
 *      **questions**. Each entry is self-contained: a full `spec`
 *      ({@link Experiment.Types.Config}) and an OPTIONAL precomputed `result`
 *      (+ `design`). Selecting one seeds the working config.
 *   3. An OPTIONAL `e3.function('experiment', (rows, config) → ExperimentResult)`.
 *      One universal estimator serves every question; omit it when every shown
 *      config carries a precomputed `result`. Here it returns the constants the
 *      real `Causal.experiment` engine would, so the surface runs offline.
 *   4. `<Experiment data configs experiment journal />`. The renderer selects the
 *      first config, auto-runs (unless it has a precomputed result), derives every
 *      word / colour / bar from the single result + its `verdict`, and re-runs when
 *      the user edits the config.
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
// Estimator — ONE pure-East fixture returning the full numeric contract inline,
// so the docs show exactly what the engine produces. Exported so the snapshot
// harness compiles + seeds the same numbers.
// ============================================================================

export const experimentFn = e3.function('experiment',
    East.function([ArrayType(BatchRow), Experiment.Types.Config], Experiment.Types.Result, (_$, _data, _config) => ({
        naive: -3.1,
        naive_ci: some({ lower: -6.0, upper: -0.2 }),
        adjusted: some({ effect: 5.2, ci: some({ lower: 3.1, upper: 7.4 }) }),
        // n_dropped = rows outside the propensity common support (22% of 480).
        n_total: 480n, n_treated: 240n, n_control: 240n, n_dropped: 106n,
        balance: [
            { column: 'incoming_grade', base_column: 'incoming_grade', treated_mean: 6.1, control_mean: 8.0, std_diff: 0.90, std_diff_adjusted: some(0.07) },
            { column: 'supplier', base_column: 'supplier', treated_mean: 0.61, control_mean: 0.33, std_diff: 0.55, std_diff_adjusted: some(0.09) },
            { column: 'mix_viscosity', base_column: 'mix_viscosity', treated_mean: 24.6, control_mean: 24.1, std_diff: 0.24, std_diff_adjusted: some(0.05) },
        ],
        overlap: {
            treated_propensity: new Float64Array([0, 0, 1, 2, 4, 6, 9, 12, 15, 18, 20, 21, 19, 16, 12, 8, 5, 3, 1, 0]),
            control_propensity: new Float64Array([0, 2, 5, 9, 14, 18, 21, 20, 17, 13, 9, 6, 4, 2, 1, 1, 0, 0, 0, 0]),
            common_support_frac: 0.78,
            positivity_ok: true,
            support_strength: variant('strong', null),
        },
        refutation: some({
            placebo_effect: some(0.0), placebo_passes: some(true), random_cc_within_ci: some(true),
            data_subset_effect: some(5.0), data_subset_std: some(0.4), robustness_value: some(2.3),
            sensitivity: some({
                strengths: new Float64Array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]),
                effects: new Float64Array([5.2, 4.4, 3.4, 2.2, 0.8, -0.8]),
                benchmarks: [
                    { column: 'incoming_grade', strength: 0.85 },
                    { column: 'supplier', strength: 0.4 },
                    { column: 'mix_viscosity', strength: 0.15 },
                ],
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
        verdict_reasons: [],
        outcome_sd: 1.4, materiality_threshold: 0.14,
        treated_outcome_mean: some(5.3), control_outcome_mean: some(8.4),
    })));

// ============================================================================
// Design — ONE pure-East fixture for the optional `design` function (the
// "Validate" tab), with the recipe inline; `Causal.designValidation` computes
// it in production.
// ============================================================================

export const designFn = e3.function('design',
    East.function(
        [ArrayType(BatchRow), Experiment.Types.Config, Experiment.Types.Result, Experiment.Types.DesignConfig],
        Experiment.Types.Design,
        (_$, _data, _config, _result, _designConfig) => ({
            verdict: variant('causal', null),
            basis: variant('detect_observed', null),
            target_effect: 5.2, outcome_sd: 1.4, target_power: 0.8, alpha: 0.05,
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
// Configurations — the questions. Each entry's `spec` is a full
// ExperimentConfigType (snake_case; structurally identical to east-py-datascience's
// `Causal.Types.CausalExperimentConfigType`). The freeform list has one question
// (no precomputed answer → the estimator runs); the menu has three vetted
// questions; the curated list carries a precomputed `result` AND a precomputed
// `design` (so the Answer and Validate tabs both paint with no bound function).
// ============================================================================

/** A single question, no precomputed answer — the estimator auto-runs on select. */
export const experimentConfigsInput = e3.input('experiment_configs', ArrayType(Experiment.Types.Configuration), [
    {
        id: 'cure_strength', label: 'Slow cure → bond strength',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength',
            common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
            categorical: some(['supplier']),
            method: some(variant('propensity_score_weighting', { weighting_scheme: some(variant('ips_stabilized_weight', null)) })),
            estimand: some(variant('ate', null)),
            refute: some({ placebo: true, random_common_cause: true, data_subset: true, sensitivity: some([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]) }),
            dose_feature: some('incoming_grade'),
            min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n), strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: some([
            variant('string', { fieldId: 'line', op: variant('in', new Set(['A', 'B'])) }),
            variant('string', { fieldId: 'product', op: variant('eq', 'panel') }),
        ]),
        group: none, result: none, design: none,
    },
]);

/** Three vetted questions — the curated menu (no precomputed answers; each runs live). */
export const experimentMenuConfigsInput = e3.input('experiment_menu_configs', ArrayType(Experiment.Types.Configuration), [
    {
        id: 'cure_strength', label: 'Slow cure → bond strength',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
            categorical: some(['supplier']), method: none, estimand: none, refute: none, dose_feature: some('incoming_grade'),
            min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: some(42n), strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: none, group: none, result: none, design: none,
    },
    {
        id: 'cure_strength_panels', label: 'Slow cure → strength (panels only)',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
            categorical: some(['supplier']), method: none, estimand: none, refute: none, dose_feature: some('incoming_grade'),
            min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: some(42n), strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: some([variant('string', { fieldId: 'product', op: variant('eq', 'panel') })]),
        group: none, result: none, design: none,
    },
    {
        id: 'cure_strength_byline', label: 'Slow cure → strength (control for line)',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade', 'mix_viscosity', 'supplier', 'line'],
            categorical: some(['supplier', 'line']), method: none, estimand: none, refute: none, dose_feature: some('incoming_grade'),
            min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: some(42n), strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: none, group: none, result: none, design: none,
    },
]);

/** Curated, precomputed — the question carries its answer inline; no estimator needed. */
export const experimentPrecomputedConfigsInput = e3.input('experiment_precomputed_configs', ArrayType(Experiment.Types.Configuration), [
    {
        id: 'cure_strength', label: 'Slow cure → bond strength',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade', 'mix_viscosity', 'supplier'],
            categorical: some(['supplier']), method: none, estimand: none, refute: none, dose_feature: some('incoming_grade'),
            min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: some(42n), strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: none, group: none,
        result: some({
            naive: -3.1,
            naive_ci: some({ lower: -6.0, upper: -0.2 }),
            adjusted: some({ effect: 5.2, ci: some({ lower: 3.1, upper: 7.4 }) }),
            n_total: 480n, n_treated: 240n, n_control: 240n, n_dropped: 106n,
            balance: [
                { column: 'incoming_grade', base_column: 'incoming_grade', treated_mean: 6.1, control_mean: 8.0, std_diff: 0.90, std_diff_adjusted: some(0.07) },
                { column: 'supplier', base_column: 'supplier', treated_mean: 0.61, control_mean: 0.33, std_diff: 0.55, std_diff_adjusted: some(0.09) },
                { column: 'mix_viscosity', base_column: 'mix_viscosity', treated_mean: 24.6, control_mean: 24.1, std_diff: 0.24, std_diff_adjusted: some(0.05) },
            ],
            overlap: {
                treated_propensity: new Float64Array([0, 0, 1, 2, 4, 6, 9, 12, 15, 18, 20, 21, 19, 16, 12, 8, 5, 3, 1, 0]),
                control_propensity: new Float64Array([0, 2, 5, 9, 14, 18, 21, 20, 17, 13, 9, 6, 4, 2, 1, 1, 0, 0, 0, 0]),
                common_support_frac: 0.78, positivity_ok: true, support_strength: variant('strong', null),
            },
            refutation: some({
                placebo_effect: some(0.0), placebo_passes: some(true), random_cc_within_ci: some(true),
                data_subset_effect: some(5.0), data_subset_std: some(0.4), robustness_value: some(2.3),
                sensitivity: some({
                    strengths: new Float64Array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]),
                    effects: new Float64Array([5.2, 4.4, 3.4, 2.2, 0.8, -0.8]),
                    benchmarks: [
                        { column: 'incoming_grade', strength: 0.85 },
                        { column: 'supplier', strength: 0.4 },
                        { column: 'mix_viscosity', strength: 0.15 },
                    ],
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
            verdict_reasons: [],
            outcome_sd: 1.4, materiality_threshold: 0.14,
            treated_outcome_mean: some(5.3), control_outcome_mean: some(8.4),
        }),
        // A precomputed "Validate" recipe too — so the Validate tab paints straight from
        // this entry with NO bound `design` function (the precomputed-design contract).
        design: some({
            verdict: variant('causal', null),
            basis: variant('detect_observed', null),
            target_effect: 5.2, outcome_sd: 1.4, target_power: 0.8, alpha: 0.05,
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
    },
    {
        id: 'cure_strength_byline', label: 'Slow cure → strength (control for line)',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade', 'mix_viscosity', 'supplier', 'line'],
            categorical: some(['supplier', 'line']), method: none, estimand: none, refute: none, dose_feature: some('incoming_grade'),
            min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: some(42n), strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: none, group: none,
        // Adjusting for `line` too leaves thinner common support → the same +effect, but
        // a more cautious `modest` verdict. Selecting this question shows a DIFFERENT answer.
        result: some({
            naive: -3.1,
            naive_ci: some({ lower: -5.4, upper: 0.1 }),
            adjusted: some({ effect: 3.1, ci: some({ lower: 0.4, upper: 5.8 }) }),
            n_total: 480n, n_treated: 240n, n_control: 240n, n_dropped: 283n,
            balance: [
                { column: 'incoming_grade', base_column: 'incoming_grade', treated_mean: 6.1, control_mean: 8.0, std_diff: 0.62, std_diff_adjusted: some(0.11) },
                { column: 'line', base_column: 'line', treated_mean: 0.52, control_mean: 0.48, std_diff: 0.10, std_diff_adjusted: some(0.04) },
            ],
            overlap: {
                treated_propensity: new Float64Array([1, 3, 6, 10, 14, 17, 18, 16, 12, 9, 6, 4, 2, 1, 1, 0, 0, 0, 0, 0]),
                control_propensity: new Float64Array([0, 0, 1, 2, 4, 7, 11, 15, 18, 20, 19, 16, 12, 8, 5, 3, 1, 0, 0, 0]),
                common_support_frac: 0.41, positivity_ok: true, support_strength: variant('thin', null),
            },
            refutation: some({
                placebo_effect: some(0.1), placebo_passes: some(true), random_cc_within_ci: some(true),
                data_subset_effect: some(2.8), data_subset_std: some(0.7), robustness_value: some(1.4),
                sensitivity: some({
                    strengths: new Float64Array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]),
                    effects: new Float64Array([3.1, 2.4, 1.6, 0.7, -0.3, -1.4]),
                    benchmarks: [
                        { column: 'incoming_grade', strength: 0.75 },
                        { column: 'line', strength: 0.2 },
                    ],
                }),
                expected_sign_ok: none,
            }),
            dose_response: some({
                feature: 'incoming_grade',
                grid: new Float64Array([2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5]),
                effect: new Float64Array([0.0, 0.9, 1.6, 2.1, 2.5, 2.8, 2.95, 3.05, 3.1]),
                lower: some(new Float64Array([-0.4, 0.3, 0.9, 1.3, 1.7, 2.0, 2.1, 2.2, 2.25])),
                upper: some(new Float64Array([0.4, 1.5, 2.3, 2.9, 3.3, 3.6, 3.8, 3.9, 3.95])),
                size: new BigInt64Array([40n, 52n, 61n, 66n, 70n, 58n, 44n, 30n, 18n]),
            }),
            verdict: variant('modest', null),
            // Modest BECAUSE the common support is thin — machine-readable.
            verdict_reasons: [variant('thin_support', null)],
            outcome_sd: 1.4, materiality_threshold: 0.14,
            treated_outcome_mean: some(5.3), control_outcome_mean: some(8.4),
        }),
        // Its own precomputed "Validate" recipe — a smaller +3.1 effect needs a larger
        // trial, and matching now includes `line`. Again no bound `design` function.
        design: some({
            verdict: variant('modest', null),
            basis: variant('detect_observed', null),
            target_effect: 3.1, outcome_sd: 1.4, target_power: 0.8, alpha: 0.05,
            current_power: some(0.28),
            match_on: ['incoming_grade', 'supplier', 'line'],
            options: [
                { label: 'Even split', treated_share: 0.5, n_treated: 160n, n_control: 160n, n_total: 320n },
                { label: 'Treat fewer', treated_share: 0.33, n_treated: 119n, n_control: 241n, n_total: 360n },
            ],
            power_curve: {
                n: new BigInt64Array([120n, 200n, 280n, 360n, 440n, 520n]),
                power: new Float64Array([0.34, 0.52, 0.67, 0.79, 0.87, 0.92]),
            },
            rationale: 'Controlling for line shrinks the effect to +3.1 MPa, so a confirming trial needs ~320 batches (even split), matched on incoming grade, supplier and line, for 80% power (α = 0.05).',
        }),
    },
]);

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
]);

// ============================================================================
// Scenes
// ============================================================================

/** Freeform single-question surface — one config, the estimator auto-runs. */
export const experimentSurface = example({
    keywords: ['Experiment', 'causal', 'effect', 'confounding', 'forest', 'verdict', 'Data', 'Func', 'bind', 'configs', 'generic'],
    description: 'An interactive causal-experiment surface: "did slow_cure change bond_strength?" — confounding by indication, with the raw-vs-adjusted sign flip and a "causal" verdict. The "Answer" tab. Driven by a bound `configs` list (one question) + one estimator function; every word is derived from the numbers + verdict.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const configs = $.let(Data.bind(experimentConfigsInput));
            const journal = $.let(Data.bind(experimentJournalInput));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    experiment={experiment}
                    journal={journal}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                        supplier: { label: 'Supplier' },
                        line: { label: 'Line' },
                        product: { label: 'Product' },
                    }}
                    subject="batch"
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
            const configs = $.let(Data.bind(experimentConfigsInput));
            const journal = $.let(Data.bind(experimentJournalInput));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    experiment={experiment}
                    journal={journal}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                        supplier: { label: 'Supplier' },
                        line: { label: 'Line' },
                        product: { label: 'Product' },
                    }}
                    subject="batch"
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
            const configs = $.let(Data.bind(experimentConfigsInput));
            const journal = $.let(Data.bind(experimentJournalInput));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    experiment={experiment}
                    journal={journal}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                        supplier: { label: 'Supplier' },
                        line: { label: 'Line' },
                        product: { label: 'Product' },
                    }}
                    subject="batch"
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
            const configs = $.let(Data.bind(experimentConfigsInput));
            const journal = $.let(Data.bind(experimentJournalInput));
            const experiment = $.let(Func.bind(experimentFn));
            const design = $.let(Func.bind(designFn));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    experiment={experiment}
                    design={design}
                    journal={journal}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                        supplier: { label: 'Supplier' },
                        line: { label: 'Line' },
                        product: { label: 'Product' },
                    }}
                    subject="batch"
                    defaultTab="validate"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** The question selector — a menu of three vetted questions, each estimated live. */
export const experimentMenu = example({
    keywords: ['Experiment', 'configs', 'causal', 'questions', 'vetted', 'dropdown', 'menu', 'scope', 'select'],
    description: 'The Experiment question selector — the title doubles as a menu of named, vetted questions (current one checked). Each bundles a vetted backdoor set (and optional population scope); selecting one seeds the working config (still editable before Run). Lets a domain expert pick a correct causal question from a menu rather than assemble one.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const configs = $.let(Data.bind(experimentMenuConfigsInput));
            const journal = $.let(Data.bind(experimentJournalInput));
            const experiment = $.let(Func.bind(experimentFn));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    experiment={experiment}
                    journal={journal}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                        supplier: { label: 'Supplier' },
                        line: { label: 'Line' },
                        product: { label: 'Product' },
                    }}
                    subject="batch"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** Curated decision surface — a precomputed answer, read-only, no live estimator. */
export const experimentPrecomputed = example({
    keywords: ['Experiment', 'causal', 'precomputed', 'result', 'configs', 'curated', 'decision surface', 'menu', 'no-run'],
    description: 'A curated, precomputed causal-experiment menu: two vetted questions, each carrying its own precomputed `result` (a confident "causal" +5.2, and a more cautious "modest" +3.1 once you also control for line) AND a precomputed `design`. No estimator, no design function, no Run — selecting a question from the title menu paints both its answer and its "Validate" trial recipe straight from the bound values.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const configs = $.let(Data.bind(experimentPrecomputedConfigsInput));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                        supplier: { label: 'Supplier' },
                        line: { label: 'Line' },
                        product: { label: 'Product' },
                    }}
                    subject="batch"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Refusal scenes — the two verdicts where the engine returns `adjusted = none`
// rather than a number. Precomputed (no estimator), so the surface paints the
// refusal zones directly: the positivity case renders the overlap histogram as
// its centrepiece; the not-estimable case renders the engine's reason. Neither
// names a `dose_feature`, so the "How much?" tab is hidden (nothing could ever
// put a curve on it).
// ============================================================================

export const experimentPositivityConfigsInput = e3.input('experiment_positivity_configs', ArrayType(Experiment.Types.Configuration), [
    {
        id: 'cure_strength_overlap', label: 'Slow cure → bond strength (no overlap)',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade', 'mix_viscosity'],
            categorical: none, method: none, estimand: none, refute: none, dose_feature: none,
            min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: none, strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: none, group: none,
        // The two arms' propensity histograms barely meet — only 6% common
        // support — so the engine refuses: `non_identifiable_positivity`.
        result: some({
            naive: -3.1,
            naive_ci: some({ lower: -5.8, upper: -0.4 }),
            adjusted: none,
            n_total: 480n, n_treated: 240n, n_control: 240n, n_dropped: 451n,
            balance: [
                { column: 'incoming_grade', base_column: 'incoming_grade', treated_mean: 3.4, control_mean: 8.2, std_diff: 2.10, std_diff_adjusted: none },
                { column: 'mix_viscosity', base_column: 'mix_viscosity', treated_mean: 24.8, control_mean: 24.0, std_diff: 0.38, std_diff_adjusted: none },
            ],
            overlap: {
                treated_propensity: new Float64Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 7, 13, 18, 22, 19, 12, 5]),
                control_propensity: new Float64Array([5, 12, 19, 22, 18, 13, 7, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                common_support_frac: 0.06, positivity_ok: false, support_strength: variant('refused', null),
            },
            refutation: none,
            dose_response: none,
            verdict: variant('non_identifiable_positivity', null),
            verdict_reasons: [],
            outcome_sd: 1.5, materiality_threshold: 0.15,
            treated_outcome_mean: some(5.1), control_outcome_mean: some(8.2),
        }),
        design: none,
    },
]);

export const experimentNotEstimableConfigsInput = e3.input('experiment_not_estimable_configs', ArrayType(Experiment.Types.Configuration), [
    {
        id: 'deal_strength', label: 'Special batch flag → bond strength (44-unit arm)',
        spec: {
            treatment: 'slow_cure', outcome: 'bond_strength', common_causes: ['incoming_grade'],
            categorical: none, method: none, estimand: none, refute: none, dose_feature: none,
            min_overlap: none, min_treatment_variation: none, bootstrap: none, random_state: none, strong_overlap: none, evalue_floor: none, expected_sign: none,
        },
        population: none, group: none,
        // Almost every batch is on one side of the treatment — the engine
        // refuses with `not_estimable` and says why in the verdict's payload.
        result: some({
            naive: 0.8,
            naive_ci: none,
            adjusted: none,
            n_total: 3688n, n_treated: 44n, n_control: 3644n, n_dropped: 2028n,
            balance: [
                { column: 'incoming_grade', base_column: 'incoming_grade', treated_mean: 6.0, control_mean: 6.1, std_diff: 0.05, std_diff_adjusted: none },
            ],
            overlap: {
                treated_propensity: new Float64Array([2, 5, 8, 9, 8, 6, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                control_propensity: new Float64Array([180, 320, 450, 520, 510, 430, 340, 260, 190, 140, 100, 70, 50, 30, 20, 12, 8, 5, 2, 1]),
                common_support_frac: 0.45, positivity_ok: true, support_strength: variant('thin', null),
            },
            refutation: none,
            dose_response: none,
            verdict: variant('not_estimable', 'treatment barely varies: the minority arm is 1.2% of rows'),
            verdict_reasons: [],
            outcome_sd: 1.2, materiality_threshold: 0.12,
            treated_outcome_mean: some(6.9), control_outcome_mean: some(6.1),
        }),
        design: none,
    },
]);

/** The positivity REFUSAL — no like-for-like comparison exists; the Answer tab
 *  renders the back-to-back propensity histogram instead of a number, and the
 *  hidden "How much?" tab demonstrates the dose-tab gating. */
export const experimentRefusalOverlap = example({
    keywords: ['Experiment', 'causal', 'refusal', 'positivity', 'overlap', 'histogram', 'no comparison', 'verdict'],
    description: 'The Experiment positivity refusal — the treated and untreated batches barely overlap on the confounders, so the engine refuses to estimate (adjusted = none, verdict non_identifiable_positivity) and the Answer tab explains why over the propensity-overlap histogram. No dose feature → the "How much?" tab is hidden.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const configs = $.let(Data.bind(experimentPositivityConfigsInput));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                    }}
                    subject="batch"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** The not-estimable REFUSAL — a 44-unit treated arm; the engine refuses with
 *  its reason string and the evidence counts. */
export const experimentRefusalNotEstimable = example({
    keywords: ['Experiment', 'causal', 'refusal', 'not_estimable', 'variation', 'tiny arm', 'verdict'],
    description: 'The Experiment not-estimable refusal — almost every batch is on one side of the treatment (a 44-unit arm), so the engine refuses to guess (adjusted = none, verdict not_estimable) and the Answer tab shows the engine\'s reason plus the arm counts.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const configs = $.let(Data.bind(experimentNotEstimableConfigsInput));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                    }}
                    subject="batch"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const experimentReadonlyPrecomputed = example({
    keywords: ['Experiment', 'causal', 'precomputed', 'readonly', 'locked', 'curated', 'decision surface', 'view-only'],
    description: 'The locked variant of the precomputed menu — `readonly` is on, so the same two vetted, precomputed questions (each with its answer and "Validate" trial recipe) can still be browsed (the question selector stays live: selecting is navigation, not editing) but the config pickers, Run and Commit are all hidden, and a "View only" badge marks the surface. A pure view-only decision surface.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const configs = $.let(Data.bind(experimentPrecomputedConfigsInput));
            return (
                <Experiment
                    data={data}
                    configs={configs}
                    readonly
                    columns={{
                        slow_cure: { label: 'Slow cure' },
                        bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true },
                        incoming_grade: { label: 'Incoming grade' },
                        mix_viscosity: { label: 'Mix viscosity' },
                        supplier: { label: 'Supplier' },
                        line: { label: 'Line' },
                        product: { label: 'Product' },
                    }}
                    subject="batch"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
