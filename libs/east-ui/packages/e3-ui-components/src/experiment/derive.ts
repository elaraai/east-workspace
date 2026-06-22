/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Derive the Experiment surface's **presentation** from the numeric contract.
 *
 * The design principle is *visual-first, derived — never authored*: the bound
 * `experiment` function returns one honest {@link "@elaraai/e3-ui"}
 * `Experiment.Types.Result` — the naive vs adjusted effect, confounder balance,
 * propensity overlap, a robustness summary and an **honesty verdict** — and
 * **every** word, colour, bar width and status on the surface is computed here
 * from those numbers plus the column names the user picked. Because the user
 * frames an arbitrary experiment, no sentence can be stored — the confounder
 * reasons, the trade-off line and the refuter descriptions are *templated*.
 *
 * The headline switches on the `verdict`: `causal` / `modest` /
 * `adjustment_insufficient` keep the numeric Answer zone (the engine produced an
 * `adjusted` estimate); `non_identifiable_positivity` and `not_estimable` are
 * **refusals** (`adjusted = none`) that render an explanatory zone instead of a
 * number. The output of `deriveView` is the plain view-model the React shell
 * paints, so the shell JSX stays a dumb painter — all judgement lives here.
 *
 * @packageDocumentation
 */

import { some, none } from '@elaraai/east';
import type { ValueTypeOf, option } from '@elaraai/east';
import { Experiment } from '@elaraai/e3-ui';
import { getSomeorUndefined } from '@elaraai/east-ui-components';
import type { HelpId } from './help.js';

// ---------------------------------------------------------------------------
// Decoded contract shapes — the JS values the bound `experiment` function
// returns / the staged config. Mirror the East types in
// e3-ui/src/experiment/types.ts (snake_case, single consolidated result).
// ---------------------------------------------------------------------------
// Boundary marshalling for decoded East vectors → plain `number[]` (via `arr`/`arrI`
// below). VectorType decodes to a typed array; ArrayType to a plain array — both
// satisfy these structural widths.
type Vec = ArrayLike<number> & Iterable<number>;
type VecI = ArrayLike<bigint> & Iterable<bigint>;

// Every decoded shape is DERIVED from the single source of truth (`Experiment.Types.*`)
// via `ValueTypeOf` — never hand-rolled, so it cannot drift from the East types.
/** The complete, honest experiment result. */
export type ResultValue = ValueTypeOf<typeof Experiment.Types.Result>;
/** The staged experiment config. */
export type ConfigValue = ValueTypeOf<typeof Experiment.Types.Config>;
/** A named configuration — a vetted question + scope + optional precomputed answer. */
export type ConfigurationValue = ValueTypeOf<typeof Experiment.Types.Configuration>;
/** A confidence interval. */
export type Ci = ValueTypeOf<typeof Experiment.Types.Ci>;
/** The adjusted (like-for-like) effect + CI. */
export type AdjustedValue = ValueTypeOf<typeof Experiment.Types.Adjusted>;
/** One confounder's before-adjustment imbalance. */
export type BalanceValue = ValueTypeOf<typeof Experiment.Types.Balance>;
/** The propensity-overlap diagnostic. */
export type OverlapValue = ValueTypeOf<typeof Experiment.Types.Overlap>;
/** The robustness summary. */
export type RefutationValue = ValueTypeOf<typeof Experiment.Types.Refutation>;
/** The unobserved-confounder sensitivity (tipping) curve. */
export type SensitivityValue = ValueTypeOf<typeof Experiment.Types.Sensitivity>;
/** The ALE dose-response curve. */
export type DoseValue = ValueTypeOf<typeof Experiment.Types.DoseResponse>;
/** The honesty verdict — only `not_estimable` carries a reason. */
export type VerdictValue = ValueTypeOf<typeof Experiment.Types.Verdict>;
export type VerdictTag = VerdictValue['type'];
/** A committed journal row. */
export type JournalRowValue = ValueTypeOf<typeof Experiment.Types.Journal>[number];
/** Optional per-column display metadata, keyed by column name. */
export type ColMeta = ValueTypeOf<typeof Experiment.Types.ColumnMeta>;

/** A column the surface can frame over — name + coarse type family. */
export interface Column { name: string; kind: 'boolean' | 'integer' | 'float' | 'string' | 'datetime' | 'other' }

// ---------------------------------------------------------------------------
// View-model — the exact shape the shell paints (kept stable so the JSX is a
// dumb renderer; all judgement is here).
// ---------------------------------------------------------------------------
export interface VMVerdict { tag: VerdictTag; tone: string; label: string }
export interface VMConfounder { col: string; reason: string; imbalance: number; level: string; tone: string }
export interface VMSpec {
    treatment: string; treatmentKind: string; outcome: string; outcomeKind: string;
    comparison: string; confounders: VMConfounder[]; suggestion: string;
    method: string; target: string; dataLabel: string;
}
export interface VMBalance { col: string; treated: number; control: number; display: string; frac: number; tone: string }
export interface VMAnswer {
    treatment: string; outcome: string; unit: string;
    naive: number; naiveLo: number; naiveHi: number; effect: number; lo: number; hi: number;
    clear: boolean; flip: boolean; cautious: boolean;
    nTotal: bigint; nTreated: bigint; nControl: bigint; nCompared: bigint; nDropped: bigint;
    balance: VMBalance[];
}
/** A refusal zone (the engine returned `adjusted = none`). */
export interface VMRefusal {
    kind: 'positivity' | 'not_estimable';
    title: string; body: string;
    evidence: { label: string; value: string }[];
}
/** The propensity-overlap diagnostic (always derivable; the centrepiece of a
 *  positivity refusal, a small diagnostic card otherwise). */
export interface VMOverlap {
    treated: number[]; control: number[];
    commonSupportFrac: number; positivityOk: boolean; supportLabel: string;
}
export interface VMRefuteCheck { name: string; desc: string; value: string; passed: boolean; tip: option<string>; help: HelpId }
export interface VMRefute { checks: VMRefuteCheck[]; sens: VMSensitivity | null }
export interface VMSensitivity { lo: number[]; mid: number[]; hi: number[]; xTicks: string[]; yTicks: string[] }
export interface VMDoseMark { at: number; label: string; tone: string; help: HelpId }
export interface VMMarginal { label: string; value: number; frac: number }
export interface VMDose {
    feature: string; outcome: string; lo: number[]; mid: number[]; hi: number[];
    xTicks: string[]; yTicks: string[]; marks: VMDoseMark[];
    recoLabel: string; recoEffect: number; recoLo: number; recoHi: number;
    tradeoff: string; marginal: VMMarginal[];
}
export interface VMJournalRow {
    treatment: string; outcome: string; confounders: string; effect: string;
    verdict: string; verdictTone: string; who: string; when: string; preset: option<string>;
}

// ---------------------------------------------------------------------------
// Small numeric / formatting helpers.
// ---------------------------------------------------------------------------
const arr = (v: Vec | undefined): number[] => (v ? Array.from(v, Number) : []);
const arrI = (v: VecI | undefined): number[] => (v ? Array.from(v, Number) : []);
const fmt = (x: number): string => {
    // Normalise a `-0.0` (from `(-0.04).toFixed(1)`) to `0.0` — sign-confusing on
    // exactly the degenerate results where clarity matters most.
    const r = Number.isInteger(x) ? String(x) : x.toFixed(1);
    return r === '-0.0' ? '0.0' : r;
};
const signed = (x: number): string => {
    const f = fmt(x);
    return f === '0' || f === '0.0' || f.startsWith('-') ? f : `+${f}`;
};
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);


/** Coarse imbalance band from a standardised mean difference. */
function band(absStd: number): { level: string; tone: string } {
    if (absStd >= 0.66) return { level: 'large gap', tone: 'neg' };
    if (absStd >= 0.33) return { level: 'some', tone: 'warn' };
    return { level: 'small', tone: 'muted' };
}

const colMeta = (meta: ColMeta | undefined, col: string) => meta?.get(col);
const unitOf = (meta: ColMeta | undefined, col: string): string => getSomeorUndefined(colMeta(meta, col)?.unit) ?? '';
const kindOf = (cols: Column[], name: string): Column['kind'] | undefined => cols.find(c => c.name === name)?.kind;

// ---------------------------------------------------------------------------
// Verdict → tone + headline label.
// ---------------------------------------------------------------------------
const VERDICT_TONE: Record<VerdictTag, string> = {
    causal: 'pos',
    modest: 'warn',
    adjustment_insufficient: 'warn',
    non_identifiable_positivity: 'neg',
    not_estimable: 'muted',
};
const VERDICT_LABEL: Record<VerdictTag, string> = {
    causal: 'Causal effect',
    modest: 'Modest / unclear',
    adjustment_insufficient: 'Not trustworthy yet',
    non_identifiable_positivity: 'No fair comparison',
    not_estimable: 'Can’t be estimated',
};

function deriveVerdict(v: VerdictValue): VMVerdict {
    return { tag: v.type, tone: VERDICT_TONE[v.type], label: VERDICT_LABEL[v.type] };
}

// ---------------------------------------------------------------------------
// Config → set-up rail.
// ---------------------------------------------------------------------------
function treatmentKind(cols: Column[], treatment: string): string {
    switch (kindOf(cols, treatment)) {
        case 'boolean': return 'yes / no';
        case 'integer': return 'count';
        case 'float': return 'number';
        case 'string': return 'category';
        default: return 'value';
    }
}

function deriveSpec(config: ConfigValue, cols: Column[], result: ResultValue | null, meta: ColMeta | undefined, dataLen: number): VMSpec {
    const tKind = kindOf(cols, config.treatment);
    const outUnit = unitOf(meta, config.outcome);

    // Join the chosen confounders with their measured imbalance (if a result is
    // in yet). Reasons are templated from the sign of the gap.
    // Key balance by the BASE confounder the engine reports (categoricals one-hot
    // expand to many rows), keeping the most-imbalanced level so the rail reads the
    // worst gap.
    const balByCol = new Map<string, BalanceValue>();
    for (const b of result?.balance ?? []) {
        const prev = balByCol.get(b.base_column);
        if (!prev || Math.abs(b.std_diff) > Math.abs(prev.std_diff)) balByCol.set(b.base_column, b);
    }
    const confounders: VMConfounder[] = config.common_causes.map(col => {
        const b = balByCol.get(col);
        const absStd = b ? Math.abs(b.std_diff) : 0;
        const { level, tone } = band(absStd);
        const dir = b ? (b.treated_mean < b.control_mean ? 'lower' : 'higher') : '';
        const reason = b ? `the treated group ran ${dir} on ${col}` : 'measured once you Run';
        return { col, reason, imbalance: clamp01(absStd), level, tone };
    });

    // Suggest the first column not already in play (treatment / outcome / confounder).
    const inPlay = new Set([config.treatment, config.outcome, ...config.common_causes]);
    const suggest = cols.find(c => !inPlay.has(c.name));
    const suggestion = suggest ? `add ${suggest.name}` : '';

    const methodV = getSomeorUndefined(config.method);
    const method = methodV?.type === 'propensity_score_weighting' ? 'reweighting' : 'regression';
    const targetV = getSomeorUndefined(config.estimand);
    const target = targetV && (targetV.type === 'att' || targetV.type === 'atc') ? 'treated' : 'all';

    return {
        treatment: config.treatment,
        treatmentKind: treatmentKind(cols, config.treatment),
        outcome: config.outcome,
        outcomeKind: outUnit ? `number · ${outUnit}` : 'number',
        comparison: tKind === 'boolean' ? 'yes · vs no' : 'high · vs low',
        confounders, suggestion, method, target,
        dataLabel: `${result ? Number(result.n_total) : dataLen} rows`,
    };
}

// ---------------------------------------------------------------------------
// Result → Answer tab (numeric — adjusted present).
// ---------------------------------------------------------------------------
function balanceDisplay(b: BalanceValue, categorical: Set<string>): string {
    // A one-hot level is a proportion (0..1) — format as %. Detect via the engine's
    // `base_column` so the level matches the original categorical confounder.
    const isProp = categorical.has(b.base_column) && b.treated_mean >= 0 && b.treated_mean <= 1 && b.control_mean >= 0 && b.control_mean <= 1;
    return isProp
        ? `${Math.round(b.treated_mean * 100)}% vs ${Math.round(b.control_mean * 100)}%`
        : `${b.treated_mean.toFixed(1)} vs ${b.control_mean.toFixed(1)}`;
}

function deriveAnswer(config: ConfigValue, result: ResultValue, adj: AdjustedValue, meta: ColMeta | undefined): VMAnswer {
    const ci = getSomeorUndefined(adj.ci);
    const nci = getSomeorUndefined(result.naive_ci);
    const categorical = new Set(getSomeorUndefined(config.categorical) ?? []);
    const balance: VMBalance[] = [...result.balance]
        .sort((a, b) => Math.abs(b.std_diff) - Math.abs(a.std_diff))
        .map(b => ({
            col: b.column, treated: b.treated_mean, control: b.control_mean,
            display: balanceDisplay(b, categorical), frac: clamp01(Math.abs(b.std_diff)), tone: band(Math.abs(b.std_diff)).tone,
        }));
    const lo = ci?.lower ?? adj.effect;
    const hi = ci?.upper ?? adj.effect;
    const clear = result.verdict.type === 'causal' || (ci ? (lo > 0 || hi < 0) : false);
    const flip = Math.sign(result.naive) !== Math.sign(adj.effect) && result.naive !== 0;
    const nDropped = Number(result.n_dropped);
    const nTotal = Number(result.n_total);
    return {
        treatment: config.treatment, outcome: config.outcome, unit: unitOf(meta, config.outcome),
        naive: result.naive, naiveLo: nci?.lower ?? result.naive, naiveHi: nci?.upper ?? result.naive,
        effect: adj.effect, lo, hi, clear, flip,
        cautious: result.verdict.type === 'adjustment_insufficient',
        nTotal: result.n_total, nTreated: result.n_treated, nControl: result.n_control,
        nCompared: BigInt(Math.max(0, nTotal - nDropped)), nDropped: result.n_dropped,
        balance,
    };
}

// ---------------------------------------------------------------------------
// Result → refusal zone (adjusted = none).
// ---------------------------------------------------------------------------
function deriveRefusal(config: ConfigValue, result: ResultValue): VMRefusal {
    const nT = Number(result.n_treated), nC = Number(result.n_control), nTot = Number(result.n_total);
    if (result.verdict.type === 'not_estimable') {
        const reason = result.verdict.value || 'The treatment barely varies, so no comparison can be formed.';
        return {
            kind: 'not_estimable',
            title: `Can’t estimate the effect of ${config.treatment}`,
            body: reason,
            evidence: [
                { label: 'treated', value: String(nT) },
                { label: 'untreated', value: String(nC) },
                { label: 'rows', value: String(nTot) },
            ],
        };
    }
    if (result.verdict.type === 'non_identifiable_positivity') {
        const pct = Math.round(result.overlap.common_support_frac * 100);
        return {
            kind: 'positivity',
            title: 'No like-for-like comparison exists',
            body: `The treated and untreated groups barely overlap on the confounders — only ${pct}% sit in a range where both occur — so there is no fair comparison to adjust toward.`,
            evidence: [
                { label: 'common support', value: `${pct}%` },
                { label: 'treated', value: String(nT) },
                { label: 'untreated', value: String(nC) },
            ],
        };
    }
    // Defensive: adjusted=none under any other verdict (contract drift) — refuse
    // plainly rather than fabricate a positivity explanation.
    return {
        kind: 'not_estimable',
        title: `Can’t estimate the effect of ${config.treatment}`,
        body: 'The engine could not produce a like-for-like estimate for this configuration.',
        evidence: [
            { label: 'treated', value: String(nT) },
            { label: 'untreated', value: String(nC) },
            { label: 'rows', value: String(nTot) },
        ],
    };
}

// ---------------------------------------------------------------------------
// Result → overlap diagnostic (the propensity histogram).
// ---------------------------------------------------------------------------
function deriveOverlap(o: OverlapValue): VMOverlap {
    const pct = Math.round(o.common_support_frac * 100);
    return {
        treated: arr(o.treated_propensity),
        control: arr(o.control_propensity),
        commonSupportFrac: o.common_support_frac,
        positivityOk: o.positivity_ok,
        supportLabel: `${pct}% common support`,
    };
}

// ---------------------------------------------------------------------------
// Refutation → Trust tab (flat scalar fields; only the requested checks).
// ---------------------------------------------------------------------------
/** First x where the piecewise-linear (x,y) curve crosses zero, or null. */
function zeroCrossing(xs: number[], ys: number[]): number | null {
    for (let i = 1; i < ys.length && i < xs.length; i++) {
        const y0 = ys[i - 1]!, y1 = ys[i]!;
        if ((y0 > 0 && y1 <= 0) || (y0 < 0 && y1 >= 0)) {
            const t = y0 / (y0 - y1);
            return xs[i - 1]! + t * (xs[i]! - xs[i - 1]!);
        }
    }
    return null;
}

function deriveRefute(r: RefutationValue, adj: AdjustedValue | undefined): VMRefute {
    const checks: VMRefuteCheck[] = [];
    const est = adj?.effect ?? 0;

    const placeboEffect = getSomeorUndefined(r.placebo_effect);
    const placeboPasses = getSomeorUndefined(r.placebo_passes);
    if (placeboEffect !== undefined || placeboPasses !== undefined) {
        checks.push({
            name: 'Shuffle test',
            desc: 'Shuffle which rows were treated; a real effect should collapse to zero.',
            value: placeboEffect !== undefined ? `→ ${signed(placeboEffect)}` : (placeboPasses ? 'passed' : 'failed'),
            passed: placeboPasses ?? (placeboEffect !== undefined && Math.abs(placeboEffect) < Math.max(0.5, Math.abs(est) * 0.15)),
            tip: some('Randomly re-label which rows were treated. A genuine effect should vanish.'),
            help: 'check_shuffle',
        });
    }
    const ds = getSomeorUndefined(r.data_subset_effect);
    if (ds !== undefined) {
        const dstd = getSomeorUndefined(r.data_subset_std) ?? 0;
        checks.push({
            name: 'Drop-some test',
            desc: 'Re-estimate on random subsamples; a trustworthy effect stays put.',
            value: `${fmt(ds)} ± ${fmt(dstd)}`,
            passed: Math.abs(ds - est) < Math.max(0.5, Math.abs(est) * 0.2),
            tip: none,
            help: 'check_dropsome',
        });
    }
    const rcc = getSomeorUndefined(r.random_cc_within_ci);
    if (rcc !== undefined) {
        checks.push({
            name: 'Decoy cause',
            desc: 'Add an irrelevant random factor; the answer should not move.',
            value: rcc ? 'within range' : 'moved',
            passed: rcc,
            tip: none,
            help: 'check_decoy',
        });
    }
    const sens = getSomeorUndefined(r.sensitivity);
    const evalue = getSomeorUndefined(r.robustness_value);
    if (sens !== undefined || evalue !== undefined) {
        const strengths = sens ? arr(sens.strengths) : [];
        const effects = sens ? arr(sens.effects) : [];
        const tip = sens ? zeroCrossing(strengths, effects) : null;
        const value = tip !== null
            ? `tips at ${fmt(tip)}`
            : evalue !== undefined ? `E-value ${fmt(evalue)}` : 'holds throughout';
        checks.push({
            name: 'Hidden cause',
            desc: 'How strong an unrecorded common cause would need to be to overturn the result.',
            value,
            passed: tip === null,
            tip: some('Something unrecorded could drive both the treatment choice and the outcome.'),
            help: 'check_hidden',
        });
    }

    // Sensitivity band: the unobserved curve is the mid line; the band carries
    // the estimate's CI half-width (≈ constant, as in practice).
    let sensVM: VMSensitivity | null = null;
    if (sens !== undefined) {
        const mid = arr(sens.effects);
        if (mid.length) {
            const ci = getSomeorUndefined(adj?.ci);
            const half = ci ? Math.abs(ci.upper - ci.lower) / 2 : 0;
            const lo = mid.map(m => m - half);
            const hi = mid.map(m => m + half);
            const yLo = Math.min(0, ...lo), yHi = Math.max(...hi, 0);
            sensVM = { lo, mid, hi, xTicks: ['none', 'weaker', 'stronger'], yTicks: [fmt(yLo), fmt((yLo + yHi) / 2), fmt(yHi)] };
        }
    }
    return { checks, sens: sensVM };
}

// ---------------------------------------------------------------------------
// Dose response → How-much tab.
// ---------------------------------------------------------------------------
function deriveDose(dose: DoseValue, config: ConfigValue, meta: ColMeta | undefined): VMDose {
    const grid = arr(dose.grid);
    const mid = arr(dose.effect);
    const lo = getSomeorUndefined(dose.lower) ? arr(getSomeorUndefined(dose.lower)) : mid.slice();
    const hi = getSomeorUndefined(dose.upper) ? arr(getSomeorUndefined(dose.upper)) : mid.slice();
    const sizes = arrI(dose.size);
    // The recommendation is a point on the FEATURE x-axis (e.g. days), never the
    // outcome unit — labelling "3" as "3 MPa" would be semantically wrong.
    const featureUnit = unitOf(meta, dose.feature);

    // "you are here" = the busiest dose bucket; "sweet spot" = where the lower CI
    // first clears zero and marginal gain has flattened.
    const here = sizes.length ? sizes.indexOf(Math.max(...sizes)) : 0;
    const marg = mid.map((m, i) => (i === 0 ? 0 : m - mid[i - 1]!));
    const maxMarg = Math.max(1e-9, ...marg.map(Math.abs));
    let sweet = mid.length - 1;
    for (let i = 1; i < mid.length; i++) {
        if (lo[i]! > 0 && Math.abs(marg[i]!) < 0.25 * maxMarg) { sweet = i; break; }
    }

    const xi = grid.length ? [0, Math.floor(grid.length / 2), grid.length - 1] : [];
    const xTicks = xi.map(i => fmt(grid[i]!));
    const yLo = Math.min(0, ...lo), yHi = Math.max(...hi, 0);
    const yTicks = [fmt(yLo), fmt((yLo + yHi) / 2), fmt(yHi)];

    // Trim the trailing flat tail (steps whose marginal gain is negligible) so
    // the strip shows only the decision-relevant range.
    const margSteps = marg.slice(1);
    let lastStep = margSteps.length - 1;
    while (lastStep > 0 && Math.abs(margSteps[lastStep]!) < 0.12 * maxMarg) lastStep--;
    const marginal: VMMarginal[] = margSteps.slice(0, lastStep + 1).map((v, i) => ({ label: `${fmt(grid[i + 1]!)}`, value: v, frac: clamp01(Math.abs(v) / maxMarg) }));

    const stepFrom = here < sweet ? here : Math.max(0, sweet - 1);
    const gainToSweet = (mid[sweet] ?? 0) - (mid[stepFrom] ?? 0);
    const nextGain = sweet + 1 < mid.length ? mid[sweet + 1]! - mid[sweet]! : 0;
    const tradeoff = `Going from ${fmt(grid[stepFrom] ?? 0)} to ${fmt(grid[sweet] ?? 0)} adds ${signed(gainToSweet)}; the next step adds only ${signed(nextGain)}.`;

    const marks: VMDoseMark[] = [];
    if (sizes.length) marks.push({ at: here, label: 'you are here', tone: 'muted', help: 'dose_here' });
    marks.push({ at: sweet, label: 'sweet spot', tone: 'pos', help: 'dose_sweet' });

    return {
        feature: dose.feature, outcome: config.outcome, lo, mid, hi, xTicks, yTicks, marks,
        recoLabel: `≈ ${fmt(grid[sweet] ?? 0)}${featureUnit ? ' ' + featureUnit : ''}`,
        recoEffect: mid[sweet] ?? 0, recoLo: lo[sweet] ?? 0, recoHi: hi[sweet] ?? 0,
        tradeoff, marginal,
    };
}

// ---------------------------------------------------------------------------
// Journal.
// ---------------------------------------------------------------------------
function relTime(d: Date, now: Date): string {
    const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return 'last wk';
}

/** Short journal word + tone from the STORED verdict (not recomputed). */
const VERDICT_WORD: Record<VerdictTag, string> = {
    causal: 'causal',
    modest: 'modest',
    adjustment_insufficient: 'not robust',
    non_identifiable_positivity: 'no overlap',
    not_estimable: 'n/a',
};

function deriveJournalRow(row: JournalRowValue, now: Date): VMJournalRow {
    const adj = getSomeorUndefined(row.adjusted);
    return {
        treatment: row.config.treatment, outcome: row.config.outcome,
        confounders: row.config.common_causes.join(', '),
        effect: adj !== undefined ? signed(adj) : signed(row.naive),
        verdict: VERDICT_WORD[row.verdict.type],
        verdictTone: VERDICT_TONE[row.verdict.type],
        who: row.committed_by, when: relTime(row.committed_at, now),
        // The originating preset id (resolved to a label by the surface); `none` for a
        // free-form / pre-presets row.
        preset: row.preset,
    };
}

// ---------------------------------------------------------------------------
// Public entry — assemble the whole view-model.
// ---------------------------------------------------------------------------
export interface ExperimentView {
    spec: VMSpec;
    verdict: VMVerdict | null;
    answer: VMAnswer | null;
    refusal: VMRefusal | null;
    overlap: VMOverlap | null;
    refute: VMRefute | null;
    dose: VMDose | null;
    journal: VMJournalRow[] | null;
}

/**
 * Derive the full view-model from the staged config, the bound data's columns
 * and the (possibly absent) single experiment result.
 *
 * @param config - The staged {@link ConfigValue}.
 * @param ranConfig - The config that produced `result` (the result deck reads this so its
 *   strings never drift ahead of the numbers on a live edit before the next Run).
 * @param cols - The bound dataset's columns (name + type family).
 * @param result - The experiment result, or `null` until the first Run settles.
 * @param journal - Committed rows, or `null`.
 * @param meta - Optional per-column display metadata.
 * @param dataLen - Row count of the bound dataset (for the header label).
 * @param now - "Now" for relative journal timestamps (injected for determinism).
 */
export function deriveView(
    config: ConfigValue,
    ranConfig: ConfigValue,
    cols: Column[],
    result: ResultValue | null,
    journal: JournalRowValue[] | null,
    meta: ColMeta | undefined,
    dataLen: number,
    now: Date,
): ExperimentView {
    const adj = result ? getSomeorUndefined(result.adjusted) : undefined;
    const refutation = result ? getSomeorUndefined(result.refutation) : undefined;
    const doseR = result ? getSomeorUndefined(result.dose_response) : undefined;
    return {
        // The set-up rail reflects the LIVE config (the editor); the result deck
        // reflects RANCONFIG — the config that produced `result` — so the result
        // strings never drift ahead of the numbers on a live picker edit.
        spec: deriveSpec(config, cols, result, meta, dataLen),
        verdict: result ? deriveVerdict(result.verdict) : null,
        answer: result && adj ? deriveAnswer(ranConfig, result, adj, meta) : null,
        refusal: result && !adj ? deriveRefusal(ranConfig, result) : null,
        overlap: result ? deriveOverlap(result.overlap) : null,
        refute: refutation ? deriveRefute(refutation, adj) : null,
        dose: doseR && doseR.effect.length ? deriveDose(doseR, ranConfig, meta) : null,
        journal: journal ? journal.map(r => deriveJournalRow(r, now)) : null,
    };
}

// ---------------------------------------------------------------------------
// Validation design — the "Validate" tab view-model.
// ---------------------------------------------------------------------------

/** Decoded `ExperimentDesignType` (the `design` function's result). */
export type DesignValue = ValueTypeOf<typeof Experiment.Types.Design>;

export interface VMDesignOption { label: string; nTotal: number; nTreated: number; nControl: number; treatedShare: number }
export interface VMDesignMatch { col: string; frac: number; tone: string; display: string }
export interface VMDesign {
    /** Verdict-framed eyebrow headline. */
    headline: string;
    rationale: string;
    /** The recommended (first) option — the KPI + split meter read from this. */
    primary: VMDesignOption;
    /** Alternate split options (rows under the primary). */
    alternates: VMDesignOption[];
    /** Categories to match the arms on, with imbalance bar widths from the result. */
    matchOn: VMDesignMatch[];
    /** Power curve: total-N → chance of detecting (0..100), with target + "you're here". */
    curve: { mid: number[]; xTicks: string[]; marks: VMDoseMark[] };
    /** Signed target effect with unit, e.g. "+5.2 MPa". */
    targetLabel: string;
    targetPctLabel: string;
    /** create_control → frame the split as a hold-back; no current-power marker. */
    holdback: boolean;
    /** non_identifiable_positivity → point at the overlap chart. */
    showOverlap: boolean;
    /** Effect too faint to size sanely — the head-count is a capped sentinel. */
    faint: boolean;
}

// Basis → eyebrow headline (the verdict-driven framing).
const DESIGN_HEADLINE: Record<string, string> = {
    detect_observed: 'Confirm it with a controlled trial',
    de_bias: 'Make it trustworthy with a controlled trial',
    resolve_vs_null: 'Settle it with a bigger trial',
    restrict_to_overlap: 'You can’t compare yet',
    create_control: 'Hold some back next time',
};

function deriveDesignOption(o: DesignValue['options'][number]): VMDesignOption {
    return {
        label: o.label,
        nTotal: Number(o.n_total),
        nTreated: Number(o.n_treated),
        nControl: Number(o.n_control),
        treatedShare: o.treated_share,
    };
}

/** Design value → the "Validate" tab view-model (numbers → recipe + chart). */
export function deriveDesign(d: DesignValue, result: ResultValue | null, ranConfig: ConfigValue, meta: ColMeta | undefined): VMDesign {
    const basis = d.basis.type;
    const outcome = ranConfig.outcome;
    const unit = unitOf(meta, outcome);
    const options = d.options.map(deriveDesignOption);
    const primary = options[0] ?? { label: 'Even split', nTotal: 0, nTreated: 0, nControl: 0, treatedShare: 0.5 };

    // Match-on bars: join each category to the result's pre-adjustment imbalance,
    // by BASE confounder (categoricals one-hot expand to col=level / col_level).
    const balByCol = new Map<string, BalanceValue>();
    for (const b of result?.balance ?? []) {
        const prev = balByCol.get(b.base_column);
        if (!prev || Math.abs(b.std_diff) > Math.abs(prev.std_diff)) balByCol.set(b.base_column, b);
    }
    const matchOn: VMDesignMatch[] = d.match_on.map(col => {
        const b = balByCol.get(col);
        const absStd = b ? Math.abs(b.std_diff) : 0;
        const { tone } = band(absStd);
        return { col, frac: clamp01(absStd), tone, display: getSomeorUndefined(colMeta(meta, col)?.label) ?? col };
    });

    // Power curve → a single mid line (lo=hi=mid → no band); a "target" mark at the
    // bin nearest the recommended N, and "you're here" at the current sample size.
    // Zip n/power to the common length — the contract allows divergence; a defined
    // current power past the grid is shown off-scale rather than dropped silently.
    const ns = arrI(d.power_curve.n);
    const powers = arr(d.power_curve.power);
    const len = Math.min(ns.length, powers.length);
    const nearest = (target: number) => {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < len; i++) { const dd = Math.abs(ns[i]! - target); if (dd < bd) { bd = dd; bi = i; } }
        return bi;
    };
    const xTicks = len ? [String(ns[0]), String(ns[Math.floor((len - 1) / 2)]), String(ns[len - 1])] : [];
    const marks: VMDoseMark[] = [];
    if (len) marks.push({ at: nearest(primary.nTotal), label: `target ${(d.target_power * 100).toFixed(0)}%`, tone: 'pos', help: 'validate_power' });
    // "you're here" — only when there's a comparison group to power from.
    const cp = getSomeorUndefined(d.current_power);
    if (cp !== undefined && len) {
        const curN = result ? Number(result.n_total) : 0;
        if (curN > 0) {
            const offScale = curN >= (ns[len - 1] ?? 0);
            marks.push({
                at: offScale ? len - 1 : nearest(curN),
                label: offScale ? `you’re here · ${(cp * 100).toFixed(0)}% (off-scale)` : `you’re here ${(cp * 100).toFixed(0)}%`,
                tone: 'muted', help: 'validate_power',
            });
        }
    }

    // Sentinel: the engine clamps the standardised effect to ≥0.01, so an effect
    // too faint to size sanely returns a capped head-count — flag it, don't present
    // a precise-looking million as a recommendation.
    const faint = d.outcome_sd > 0 && Math.abs(d.target_effect) / d.outcome_sd <= 0.011;

    return {
        headline: DESIGN_HEADLINE[basis] ?? 'Validate this',
        rationale: d.rationale,
        primary,
        alternates: options.slice(1),
        matchOn,
        curve: { mid: powers.slice(0, len).map(p => p * 100), xTicks, marks },
        targetLabel: `${signed(d.target_effect)}${unit ? ` ${unit}` : ''}`,
        targetPctLabel: `${(d.target_power * 100).toFixed(0)}%`,
        holdback: basis === 'create_control',
        showOverlap: basis === 'restrict_to_overlap',
        faint,
    };
}

// Derived helpers the shell also needs for the header / badge / banner.
export { fmt, signed, cap, unitOf };
