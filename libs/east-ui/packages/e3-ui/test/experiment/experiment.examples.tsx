/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Experiment component example — a causal-experiment surface over a generic
 * manufacturing process. The worked question is *"did `slow_cure` change
 * `bond_strength`?"* — a confounding-by-indication story: the optional
 * slow-cure step is applied to the weaker incoming material, so the raw
 * average makes it look worse (−3.1) while the like-for-like estimate flips it
 * positive (+5.2).
 *
 * Pattern:
 *   1. Declare one `e3.input(name, <ResultType>, default)` per bound dataset
 *      (spec / answer / refute / dose / journal) with the fixture spelled out
 *      inline. In production these datasets are written by a dataflow task that
 *      runs the causal estimator; here the snapshot harness seeds the defaults,
 *      so the surface renders offline with no datascience dependency.
 *   2. Inside `<Reactive>`, bind each via `Data.bind(dataset)`.
 *   3. Pass the handles to `<Experiment … />`. The result side is derived from
 *      the bound numbers — the status word, the sign-flip banner and the forest
 *      rows are computed by the renderer, not stored in the data.
 */

import { East, none, some, example } from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui';
import { Data, Experiment } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

// ============================================================================
// Bound result datasets — the fixture for the slow-cure experiment.
// ============================================================================

export const experimentSpecInput = e3.input('experiment_spec', Experiment.Types.Spec, {
    treatment: 'slow_cure',
    treatmentKind: 'yes / no',
    outcome: 'bond_strength',
    outcomeKind: 'number · MPa',
    comparison: 'yes · vs no',
    confounders: [
        { col: 'incoming_grade', reason: 'cured batches started ~8 grade-pts lower', imbalance: 0.92, level: 'large gap', tone: 'neg' },
        { col: 'mix_viscosity', reason: 'cured batches slightly thicker', imbalance: 0.32, level: 'small', tone: 'warn' },
        { col: 'supplier', reason: 'more Acme in the cured group', imbalance: 0.56, level: 'some', tone: 'warn' },
    ],
    suggestion: 'add run_date',
    filters: [
        { field: 'line', op: 'in', value: 'A, B' },
        { field: 'product', op: '=', value: 'panel' },
    ],
    method: 'reweighting',
    target: 'all',
    trim: true,
    dataLabel: '480 batches · 3 lines',
});

export const experimentAnswerInput = e3.input('experiment_answer', Experiment.Types.Answer, {
    treatment: 'slow_cure',
    outcome: 'bond_strength',
    unit: 'MPa',
    naive: -3.1, naiveLo: -6.0, naiveHi: -0.2,
    effect: 5.2, lo: 3.1, hi: 7.4,
    nTotal: 480n, nTreated: 240n, nControl: 240n, nCompared: 449n, nDropped: 31n,
    balance: [
        { col: 'incoming_grade', treated: 6.1, control: 8.0, display: '6.1 vs 8.0', frac: 0.90, tone: 'neg' },
        { col: 'supplier = Acme', treated: 0.61, control: 0.33, display: '61% vs 33%', frac: 0.55, tone: 'warn' },
        { col: 'mix_viscosity', treated: 24.6, control: 24.1, display: '24.6 vs 24.1', frac: 0.24, tone: 'muted' },
    ],
});

export const experimentRefuteInput = e3.input('experiment_refute', Experiment.Types.Refute, {
    checks: [
        { name: 'Shuffle test', desc: 'We shuffled the cure labels; the effect should disappear — and it did.', value: '→ +0.0 ✓', passed: true, tip: some('Randomly re-label which batches were cured. A real effect should vanish.') },
        { name: 'Drop-some test', desc: 'Re-ran on 100 random 80% samples. A trustworthy effect stays put.', value: '5.0 ± 0.3 ✓', passed: true, tip: none },
        { name: 'Decoy cause', desc: 'Added an irrelevant made-up factor; the answer should not budge.', value: '5.2 → 5.1 ✓', passed: true, tip: none },
        { name: 'Hidden cause', desc: 'A moderately strong un-recorded cause would be enough to wipe it out — worth noting.', value: 'tips at 0.7', passed: false, tip: some('Something we did not record could drive both the cure choice and strength.') },
    ],
    sensLo: [3.1, 2.8, 2.4, 1.9, 1.3, 0.6, -0.2],
    sensMid: [5.2, 4.8, 4.4, 3.8, 3.1, 2.3, 1.4],
    sensHi: [7.4, 7.0, 6.5, 5.9, 5.2, 4.4, 3.5],
    sensXTicks: ['none', 'weaker', 'stronger'],
    sensYTicks: ['0', '+4', '+8'],
});

export const experimentDoseInput = e3.input('experiment_dose', Experiment.Types.Dose, {
    feature: 'days of slow cure',
    outcome: 'bond_strength',
    lo: [-0.1, 1.0, 2.0, 2.7, 3.3, 3.7, 3.9, 4.0, 4.1],
    mid: [0.0, 1.5, 2.6, 3.4, 4.0, 4.4, 4.6, 4.72, 4.8],
    hi: [0.3, 2.0, 3.2, 4.1, 4.7, 5.1, 5.3, 5.45, 5.5],
    xTicks: ['day 0', 'day 1', 'day 2', 'day 3', 'day 4'],
    yTicks: ['0', '+2.5', '+5'],
    marks: [
        { at: 2n, label: 'you are here', tone: 'muted' },
        { at: 6n, label: 'sweet spot', tone: 'pos' },
    ],
    recoLabel: '≈ 3 days · 72 h',
    recoEffect: 4.6, recoLo: 3.9, recoHi: 5.3,
    tradeoff: 'You cure ~1 day now. Going to 3 days adds +2.0; a 4th day adds only +0.2 for a whole extra oven-day.',
    marginal: [
        { label: 'day 1', value: 2.6, frac: 1.00 },
        { label: 'day 2', value: 1.4, frac: 0.54 },
        { label: 'day 3', value: 0.6, frac: 0.23 },
        { label: 'day 4', value: 0.2, frac: 0.08 },
    ],
    segments: ['all batches', 'Acme', 'Globex'],
});

export const experimentJournalInput = e3.input('experiment_journal', Experiment.Types.Journal, [
    { treatment: 'slow_cure', outcome: 'bond_strength', confounders: 'incoming_grade, viscosity, supplier', effect: '+5.2', verdict: 'higher', verdictTone: 'pos', who: 'M. Kerr', when: 'today' },
    { treatment: 'extra_anneal', outcome: 'hardness', confounders: 'line, viscosity', effect: '+0.4', verdict: 'no clear effect', verdictTone: 'warn', who: 'M. Kerr', when: 'Tue' },
    { treatment: 'new_nozzle', outcome: 'throughput', confounders: 'line, batch_size', effect: '+38', verdict: 'higher', verdictTone: 'pos', who: 'T. Ode', when: 'last wk' },
]);

// ============================================================================
// Scene — the full surface bound to the seeded result datasets.
// ============================================================================

export const experimentSurface = example({
    keywords: ['Experiment', 'causal', 'effect', 'confounding', 'forest', 'dose', 'Data', 'bind'],
    description: 'A causal-experiment surface: "did slow_cure change bond_strength?" — confounding by indication, with the raw-vs-adjusted sign flip, a refutation checklist, and a dose-response curve. All derived from the bound numbers.',
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const spec = $.let(Data.bind(experimentSpecInput));
            const answer = $.let(Data.bind(experimentAnswerInput));
            const refute = $.let(Data.bind(experimentRefuteInput));
            const dose = $.let(Data.bind(experimentDoseInput));
            const journal = $.let(Data.bind(experimentJournalInput));
            return <Experiment spec={spec} answer={answer} refute={refute} dose={dose} journal={journal} />;
        }}</Reactive>
    )),
    inputs: [],
});
