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
 * look worse (−3.1) while the like-for-like estimate flips it positive (+5.2).
 *
 * Pattern (the real, interactive shape — not a mock):
 *   1. `e3.input('batches', Array(BatchRow), [...])` — the **input dataset**. The
 *      renderer introspects this row struct to drive the treatment / outcome /
 *      confounder pickers, exactly like `Table`.
 *   2. `e3.input('experiment_spec', Experiment.Types.Spec, {...})` — the staged
 *      experiment the pickers edit.
 *   3. Three `e3.function`s — `estimate` / `refute` / `dose` — that return the
 *      `Experiment.Types.*` numeric contract. In production their bodies call
 *      east-py-datascience's (generic) Causal functions; here they are pure-East
 *      fixtures returning the constants the real estimator would (mirroring the
 *      `causalEffectConfounding` example), so the surface runs offline with no
 *      datascience dependency. The numbers the snapshot harness seeds for these
 *      functions live in `e3-ui-components/snapshot/main.tsx`, imported from here
 *      so the two copies cannot drift.
 *   4. `<Experiment data spec estimate refute dose journal />`. The renderer
 *      auto-runs on mount, derives every word / colour / bar from the returned
 *      numbers, and re-runs when the user edits the spec.
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
// columns; the estimators ignore the rows (they return fixtures).
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
// Staged spec — the experiment the user framed (the pickers edit this).
// ============================================================================

export const experimentSpecInput = e3.input('experiment_spec', Experiment.Types.Spec, {
    treatment: 'slow_cure',
    outcome: 'bond_strength',
    confounders: ['incoming_grade', 'mix_viscosity', 'supplier'],
    categorical: ['supplier'],
    population: some([
        variant('string', { fieldId: 'line', op: variant('in', new Set(['A', 'B'])) }),
        variant('string', { fieldId: 'product', op: variant('eq', 'panel') }),
    ]),
    method: some(variant('propensity_score_weighting', { weighting_scheme: some(variant('ips_stabilized_weight', null)) })),
    targetUnits: some(variant('ate', null)),
    trim: some(variant('overlap', null)),
});

// ============================================================================
// Estimator functions — pure-East fixtures returning the numeric contract.
// Exported so the snapshot harness seeds the *same* numbers (no drift).
// ============================================================================

export const estimateFn = e3.function('estimate',
    East.function([ArrayType(BatchRow), Experiment.Types.Spec], Experiment.Types.Result, (_$, _data, _spec) => ({
    effect: 5.2,
    ci: some({ lower: 3.1, upper: 7.4 }),
    naive: -3.1,
    naiveCi: some({ lower: -6.0, upper: -0.2 }),
    nTotal: 480n, nTreated: 240n, nControl: 240n, nDropped: 31n,
    balance: [
        { column: 'incoming_grade', treatedMean: 6.1, controlMean: 8.0, stdDiff: 0.90 },
        { column: 'supplier', treatedMean: 0.61, controlMean: 0.33, stdDiff: 0.55 },
        { column: 'mix_viscosity', treatedMean: 24.6, controlMean: 24.1, stdDiff: 0.24 },
    ],
})));

export const refuteFn = e3.function('refute',
    East.function([ArrayType(BatchRow), Experiment.Types.Spec], Experiment.Types.Refute, (_$, _data, _spec) => ( {
    checks: [
        { kind: variant('placebo', null), estimatedEffect: 5.2, newEffects: new Float64Array([0.0]), strengths: none, pValue: some(0.92) },
        { kind: variant('data_subset', null), estimatedEffect: 5.2, newEffects: new Float64Array([4.6, 5.0, 5.4]), strengths: none, pValue: none },
        { kind: variant('random_common_cause', null), estimatedEffect: 5.2, newEffects: new Float64Array([5.1]), strengths: none, pValue: none },
        { kind: variant('unobserved', null), estimatedEffect: 5.2, newEffects: new Float64Array([5.2, 4.4, 3.4, 2.2, 0.8, -0.8]), strengths: some(new Float64Array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])), pValue: none },
    ],
})));

export const doseFn = e3.function('dose',
    East.function([ArrayType(BatchRow), Experiment.Types.Spec, StringType], Experiment.Types.Dose, (_$, _data, _spec, _feature) => ({
    feature: 'days of slow cure',
    grid: new Float64Array([0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]),
    effect: new Float64Array([0.0, 1.5, 2.6, 3.4, 4.0, 4.4, 4.6, 4.72, 4.8]),
    lower: some(new Float64Array([-0.1, 1.0, 2.0, 2.7, 3.3, 3.7, 3.9, 4.0, 4.1])),
    upper: some(new Float64Array([0.3, 2.0, 3.2, 4.1, 4.7, 5.1, 5.3, 5.45, 5.5])),
    size: new BigInt64Array([40n, 52n, 61n, 66n, 70n, 58n, 44n, 30n, 18n]),
    segments: none,
})));

// ============================================================================
// Journal — committed experiments (newest first). The verdict words / tone are
// derived from each row's effect + CI, not stored.
// ============================================================================

export const experimentJournalInput = e3.input('experiment_journal', Experiment.Types.Journal, [
    {
        spec: { treatment: 'slow_cure', outcome: 'bond_strength', confounders: ['incoming_grade', 'mix_viscosity', 'supplier'], categorical: [], population: none, method: none, targetUnits: none, trim: none },
        effect: 5.2, ci: some({ lower: 3.1, upper: 7.4 }), committedAt: new Date('2026-06-13T08:00:00Z'), committedBy: 'M. Kerr',
    },
    {
        spec: { treatment: 'extra_anneal', outcome: 'hardness', confounders: ['line', 'mix_viscosity'], categorical: [], population: none, method: none, targetUnits: none, trim: none },
        effect: 0.4, ci: some({ lower: -0.3, upper: 1.1 }), committedAt: new Date('2026-06-09T08:00:00Z'), committedBy: 'M. Kerr',
    },
    {
        spec: { treatment: 'new_nozzle', outcome: 'throughput', confounders: ['line', 'batch_size'], categorical: [], population: none, method: none, targetUnits: none, trim: none },
        effect: 38.0, ci: some({ lower: 20.0, upper: 56.0 }), committedAt: new Date('2026-06-02T08:00:00Z'), committedBy: 'T. Ode',
    },
]);

// ============================================================================
// Scene — the full surface bound to the dataset, spec, estimators and journal.
// ============================================================================

export const experimentSurface = example({
    keywords: ['Experiment', 'causal', 'effect', 'confounding', 'forest', 'dose', 'Data', 'Func', 'bind', 'generic'],
    description: 'An interactive causal-experiment surface: "did slow_cure change bond_strength?" — confounding by indication, with the raw-vs-adjusted sign flip. The "Answer" tab. Generic over the bound dataset; results come from bound estimator functions and every word is derived from the numbers.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const spec = $.let(Data.bind(experimentSpecInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const estimate = $.let(Func.bind(estimateFn));
            const refute = $.let(Func.bind(refuteFn));
            const dose = $.let(Func.bind(doseFn));
            return (
                <Experiment data={data} spec={spec} estimate={estimate} refute={refute} dose={dose} journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }} />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const experimentTrust = example({
    keywords: ['Experiment', 'causal', 'refute', 'trust', 'sensitivity', 'robustness'],
    description: 'The Experiment "Can we trust it?" tab — the refutation checklist (placebo / subset / decoy / hidden-cause) and the unobserved-confounder sensitivity curve.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const spec = $.let(Data.bind(experimentSpecInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const estimate = $.let(Func.bind(estimateFn));
            const refute = $.let(Func.bind(refuteFn));
            const dose = $.let(Func.bind(doseFn));
            return (
                <Experiment data={data} spec={spec} estimate={estimate} refute={refute} dose={dose} journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }} defaultTab="trust" />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const experimentDose = example({
    keywords: ['Experiment', 'causal', 'dose', 'ale', 'response', 'marginal'],
    description: 'The Experiment "How much?" tab — the ALE dose-response curve (with recommended point) and the marginal-gain-per-step bars.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const data = $.let(Data.bind(batchesInput));
            const spec = $.let(Data.bind(experimentSpecInput, { mode: 'staged' }));
            const journal = $.let(Data.bind(experimentJournalInput));
            const estimate = $.let(Func.bind(estimateFn));
            const refute = $.let(Func.bind(refuteFn));
            const dose = $.let(Func.bind(doseFn));
            return (
                <Experiment data={data} spec={spec} estimate={estimate} refute={refute} dose={dose} journal={journal}
                    columns={{ bond_strength: { unit: 'MPa' } }} defaultTab="dose" />
            );
        }}</Reactive>
    )),
    inputs: [],
});
