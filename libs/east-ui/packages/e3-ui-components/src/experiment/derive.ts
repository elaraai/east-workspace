/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Derive the Experiment surface's **presentation** from the numeric contract.
 *
 * The design principle is *visual-first, derived — never authored*: the bound
 * functions return only causal quantities (the {@link "@elaraai/e3-ui"}
 * `Experiment.Types.*` contract), and **every** word, colour, bar width and
 * status on the surface is computed here from those numbers plus the column
 * names the user picked. Because the user frames an arbitrary experiment, no
 * sentence can be stored — the confounder reasons, the trade-off line and the
 * refuter descriptions are *templated* from the numbers.
 *
 * The output of `deriveView` is the plain view-model the React shell renders, so
 * the shell JSX stays a dumb painter — all the judgement lives in this one pure,
 * testable module.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Decoded contract shapes (the JS values the bound functions return / the
// staged spec). Mirror the East types in e3-ui/src/experiment/types.ts.
// ---------------------------------------------------------------------------
export type Opt<T> = { type: 'none'; value: null } | { type: 'some'; value: T };
type Var<K extends string, V = unknown> = { type: K; value: V };
type Vec = ArrayLike<number> & Iterable<number>;
type VecI = ArrayLike<bigint> & Iterable<bigint>;

export interface Ci { lower: number; upper: number }

export interface SpecValue {
    treatment: string;
    outcome: string;
    confounders: string[];
    categorical: string[];
    population: Opt<unknown[]>;
    method: Opt<Var<'linear_regression' | 'propensity_score_weighting'>>;
    targetUnits: Opt<Var<'ate' | 'att' | 'atc'>>;
    trim: Opt<Var<'overlap' | 'bounds'>>;
}

export interface BalanceValue { column: string; treatedMean: number; controlMean: number; stdDiff: number }
export interface ResultValue {
    effect: number; ci: Opt<Ci>;
    naive: number; naiveCi: Opt<Ci>;
    nTotal: bigint; nTreated: bigint; nControl: bigint; nDropped: bigint;
    balance: BalanceValue[];
}
export interface RefuteCheckValue {
    kind: Var<'placebo' | 'random_common_cause' | 'data_subset' | 'unobserved'>;
    estimatedEffect: number; newEffects: Vec; strengths: Opt<Vec>; pValue: Opt<number>;
}
export interface RefuteValue { checks: RefuteCheckValue[] }
export interface DoseSegValue { label: string; grid: Vec; effect: Vec; lower: Opt<Vec>; upper: Opt<Vec> }
export interface DoseValue {
    feature: string; grid: Vec; effect: Vec; lower: Opt<Vec>; upper: Opt<Vec>;
    size: VecI; segments: Opt<DoseSegValue[]>;
}
export interface JournalValue { spec: SpecValue; effect: number; ci: Opt<Ci>; committedAt: Date; committedBy: string }
export type ColMeta = Map<string, { label: Opt<string>; unit: Opt<string>; higherIsBetter: Opt<boolean> }>;

/** A column the surface can frame over — name + coarse type family. */
export interface Column { name: string; kind: 'boolean' | 'integer' | 'float' | 'string' | 'datetime' | 'other' }

// ---------------------------------------------------------------------------
// View-model — the exact shape the shell paints (kept stable so the JSX is a
// dumb renderer; all judgement is here).
// ---------------------------------------------------------------------------
export interface VMConfounder { col: string; reason: string; imbalance: number; level: string; tone: string }
export interface VMSpec {
    treatment: string; treatmentKind: string; outcome: string; outcomeKind: string;
    comparison: string; confounders: VMConfounder[]; suggestion: string;
    method: string; target: string; trim: boolean; dataLabel: string;
}
export interface VMBalance { col: string; treated: number; control: number; display: string; frac: number; tone: string }
export interface VMAnswer {
    treatment: string; outcome: string; unit: string;
    naive: number; naiveLo: number; naiveHi: number; effect: number; lo: number; hi: number;
    nTotal: bigint; nTreated: bigint; nControl: bigint; nCompared: bigint; nDropped: bigint;
    balance: VMBalance[];
}
export interface VMRefuteCheck { name: string; desc: string; value: string; passed: boolean; tip: Opt<string> }
export interface VMRefute { checks: VMRefuteCheck[]; sensLo: number[]; sensMid: number[]; sensHi: number[]; sensXTicks: string[]; sensYTicks: string[] }
export interface VMDoseMark { at: bigint; label: string; tone: string }
export interface VMMarginal { label: string; value: number; frac: number }
export interface VMDose {
    feature: string; outcome: string; lo: number[]; mid: number[]; hi: number[];
    xTicks: string[]; yTicks: string[]; marks: VMDoseMark[];
    recoLabel: string; recoEffect: number; recoLo: number; recoHi: number;
    tradeoff: string; marginal: VMMarginal[]; segments: string[];
}
export interface VMJournalRow {
    treatment: string; outcome: string; confounders: string; effect: string;
    verdict: string; verdictTone: string; who: string; when: string;
}

// ---------------------------------------------------------------------------
// Small numeric / formatting helpers.
// ---------------------------------------------------------------------------
const arr = (v: Vec | undefined): number[] => (v ? Array.from(v, Number) : []);
const getOpt = <T,>(o: Opt<T> | undefined): T | undefined => (o && o.type === 'some' ? o.value : undefined);
const fmt = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const signed = (x: number): string => (x > 0 ? '+' : '') + fmt(x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]): number => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
};
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Coarse imbalance band from a standardised mean difference. */
function band(absStd: number): { level: string; tone: string } {
    if (absStd >= 0.66) return { level: 'large gap', tone: 'neg' };
    if (absStd >= 0.33) return { level: 'some', tone: 'warn' };
    return { level: 'small', tone: 'muted' };
}

const colMeta = (meta: ColMeta | undefined, col: string) => meta?.get(col);
const unitOf = (meta: ColMeta | undefined, col: string): string => getOpt(colMeta(meta, col)?.unit) ?? '';
const kindOf = (cols: Column[], name: string): Column['kind'] | undefined => cols.find(c => c.name === name)?.kind;

// ---------------------------------------------------------------------------
// Spec → set-up rail.
// ---------------------------------------------------------------------------
/** The field ids referenced by the staged population predicates. */
function populationFieldIds(spec: SpecValue): string[] {
    return (getOpt(spec.population) ?? [])
        .map(p => (p as { value?: { fieldId?: string } }).value?.fieldId)
        .filter((id): id is string => typeof id === 'string');
}

function treatmentKind(cols: Column[], treatment: string): string {
    switch (kindOf(cols, treatment)) {
        case 'boolean': return 'yes / no';
        case 'integer': return 'count';
        case 'float': return 'number';
        case 'string': return 'category';
        default: return 'value';
    }
}

function deriveSpec(spec: SpecValue, cols: Column[], result: ResultValue | null, meta: ColMeta | undefined, dataLen: number): VMSpec {
    const tKind = kindOf(cols, spec.treatment);
    const outUnit = unitOf(meta, spec.outcome);

    // Join the chosen confounders with their measured imbalance (if a result
    // is in yet). Reasons are templated from the sign of the gap.
    const balByCol = new Map((result?.balance ?? []).map(b => [b.column, b]));
    const confounders: VMConfounder[] = spec.confounders.map(col => {
        const b = balByCol.get(col);
        const absStd = b ? Math.abs(b.stdDiff) : 0;
        const { level, tone } = band(absStd);
        const dir = b ? (b.treatedMean < b.controlMean ? 'lower' : 'higher') : '';
        const reason = b ? `treated batches ran ${dir} on ${col}` : 'measured once you Run';
        return { col, reason, imbalance: clamp01(absStd), level, tone };
    });

    // Suggest the first column not already in play (treatment / outcome /
    // confounder) and not already used as a population filter.
    const inPlay = new Set([spec.treatment, spec.outcome, ...spec.confounders, ...populationFieldIds(spec)]);
    const suggest = cols.find(c => !inPlay.has(c.name));
    const suggestion = suggest ? `add ${suggest.name}` : '';

    const methodV = getOpt(spec.method);
    const method = methodV?.type === 'propensity_score_weighting' ? 'reweighting' : 'regression';
    const targetV = getOpt(spec.targetUnits);
    const target = targetV && (targetV.type === 'att' || targetV.type === 'atc') ? 'treated' : 'all';
    const trim = getOpt(spec.trim) !== undefined;

    return {
        treatment: spec.treatment,
        treatmentKind: treatmentKind(cols, spec.treatment),
        outcome: spec.outcome,
        outcomeKind: outUnit ? `number · ${outUnit}` : 'number',
        comparison: tKind === 'boolean' ? 'yes · vs no' : 'high · vs low',
        confounders, suggestion, method, target, trim,
        dataLabel: `${result ? Number(result.nTotal) : dataLen} rows`,
    };
}

// ---------------------------------------------------------------------------
// Result → Answer tab.
// ---------------------------------------------------------------------------
function balanceDisplay(b: BalanceValue, categorical: Set<string>): string {
    const isProp = categorical.has(b.column) && b.treatedMean >= 0 && b.treatedMean <= 1 && b.controlMean >= 0 && b.controlMean <= 1;
    return isProp
        ? `${Math.round(b.treatedMean * 100)}% vs ${Math.round(b.controlMean * 100)}%`
        : `${b.treatedMean.toFixed(1)} vs ${b.controlMean.toFixed(1)}`;
}

function deriveAnswer(spec: SpecValue, result: ResultValue, meta: ColMeta | undefined): VMAnswer {
    const ci = getOpt(result.ci);
    const nci = getOpt(result.naiveCi);
    const categorical = new Set(spec.categorical);
    const balance: VMBalance[] = [...result.balance]
        .sort((a, b) => Math.abs(b.stdDiff) - Math.abs(a.stdDiff))
        .map(b => ({
            col: b.column, treated: b.treatedMean, control: b.controlMean,
            display: balanceDisplay(b, categorical), frac: clamp01(Math.abs(b.stdDiff)), tone: band(Math.abs(b.stdDiff)).tone,
        }));
    const nDropped = Number(result.nDropped);
    const nTotal = Number(result.nTotal);
    return {
        treatment: spec.treatment, outcome: spec.outcome, unit: unitOf(meta, spec.outcome),
        naive: result.naive, naiveLo: nci?.lower ?? result.naive, naiveHi: nci?.upper ?? result.naive,
        effect: result.effect, lo: ci?.lower ?? result.effect, hi: ci?.upper ?? result.effect,
        nTotal: result.nTotal, nTreated: result.nTreated, nControl: result.nControl,
        nCompared: BigInt(Math.max(0, nTotal - nDropped)), nDropped: result.nDropped,
        balance,
    };
}

// ---------------------------------------------------------------------------
// Refute → Trust tab.
// ---------------------------------------------------------------------------
function deriveRefuteCheck(c: RefuteCheckValue): VMRefuteCheck {
    const effects = arr(c.newEffects);
    const m = mean(effects);
    const est = c.estimatedEffect;
    switch (c.kind.type) {
        case 'placebo': {
            const passed = Math.abs(m) < Math.max(0.5, Math.abs(est) * 0.15);
            return {
                name: 'Shuffle test',
                desc: 'Shuffle which rows were treated; a real effect should collapse to zero.',
                value: `→ ${signed(m)} ${passed ? '✓' : '⚠'}`, passed,
                tip: { type: 'some', value: 'Randomly re-label which rows were treated. A genuine effect should vanish.' },
            };
        }
        case 'data_subset': {
            const passed = Math.abs(m - est) < Math.max(0.5, Math.abs(est) * 0.2);
            return {
                name: 'Drop-some test',
                desc: 'Re-estimate on random subsamples; a trustworthy effect stays put.',
                value: `${fmt(m)} ± ${fmt(std(effects))} ${passed ? '✓' : '⚠'}`, passed,
                tip: { type: 'none', value: null },
            };
        }
        case 'random_common_cause': {
            const passed = Math.abs(m - est) < Math.max(0.5, Math.abs(est) * 0.2);
            return {
                name: 'Decoy cause',
                desc: 'Add an irrelevant random factor; the answer should not move.',
                value: `${fmt(est)} → ${fmt(m)} ${passed ? '✓' : '⚠'}`, passed,
                tip: { type: 'none', value: null },
            };
        }
        default: {
            // unobserved — find where the curve crosses zero (the tipping strength).
            const strengths = arr(getOpt(c.strengths));
            const tip = zeroCrossing(strengths, effects);
            const passed = tip === null; // never overturned within the simulated range → robust
            return {
                name: 'Hidden cause',
                desc: 'How strong an unrecorded common cause would need to be to overturn the result.',
                value: tip === null ? 'holds throughout ✓' : `tips at ${fmt(tip)} ⚠`, passed,
                tip: { type: 'some', value: 'Something unrecorded could drive both the treatment choice and the outcome.' },
            };
        }
    }
}

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

function deriveRefute(refute: RefuteValue, result: ResultValue): VMRefute {
    const checks = refute.checks.map(deriveRefuteCheck);
    // Sensitivity band: the unobserved curve is the mid line; the band is the
    // estimate's CI half-width carried along it (≈ constant, as in practice).
    const uc = refute.checks.find(c => c.kind.type === 'unobserved');
    const ci = getOpt(result.ci);
    const half = ci ? Math.abs(ci.upper - ci.lower) / 2 : 0;
    const mid = uc ? arr(uc.newEffects) : [];
    const strengths = uc ? arr(getOpt(uc.strengths)) : [];
    const sensLo = mid.map(m => m - half);
    const sensHi = mid.map(m => m + half);
    const xTicks = strengths.length
        ? [strengths[0]!, strengths[Math.floor(strengths.length / 2)]!, strengths[strengths.length - 1]!].map((_, i) => ['none', 'weaker', 'stronger'][i]!)
        : ['none', 'weaker', 'stronger'];
    const lo = Math.min(0, ...sensLo), hi = Math.max(...sensHi, 0);
    const yTicks = [fmt(lo), fmt((lo + hi) / 2), fmt(hi)];
    return { checks, sensLo, sensMid: mid, sensHi, sensXTicks: xTicks, sensYTicks: yTicks };
}

// ---------------------------------------------------------------------------
// Dose → How-much tab.
// ---------------------------------------------------------------------------
function deriveDose(dose: DoseValue, spec: SpecValue, meta: ColMeta | undefined): VMDose {
    const grid = arr(dose.grid);
    const mid = arr(dose.effect);
    const lo = getOpt(dose.lower) ? arr(getOpt(dose.lower)) : mid.slice();
    const hi = getOpt(dose.upper) ? arr(getOpt(dose.upper)) : mid.slice();
    const sizes = dose.size ? Array.from(dose.size, Number) : [];
    // The recommendation is a point on the FEATURE x-axis (e.g. days), never
    // the outcome unit — labelling "3" as "3 MPa" would be semantically wrong.
    const featureUnit = unitOf(meta, dose.feature);

    // "you are here" = the busiest dose bucket; "sweet spot" = where the lower
    // CI first clears zero and marginal gain has flattened.
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
    const segLabels = getOpt(dose.segments)?.map(s => s.label) ?? [];
    const segments = segLabels.length ? ['all', ...segLabels] : ['all'];

    const stepFrom = here < sweet ? here : Math.max(0, sweet - 1);
    const gainToSweet = (mid[sweet] ?? 0) - (mid[stepFrom] ?? 0);
    const nextGain = sweet + 1 < mid.length ? mid[sweet + 1]! - mid[sweet]! : 0;
    const tradeoff = `Going from ${fmt(grid[stepFrom] ?? 0)} to ${fmt(grid[sweet] ?? 0)} adds ${signed(gainToSweet)}; the next step adds only ${signed(nextGain)}.`;

    return {
        feature: dose.feature, outcome: spec.outcome, lo, mid, hi, xTicks, yTicks,
        marks: [
            { at: BigInt(here), label: 'you are here', tone: 'muted' },
            { at: BigInt(sweet), label: 'sweet spot', tone: 'pos' },
        ],
        recoLabel: `≈ ${fmt(grid[sweet] ?? 0)}${featureUnit ? ' ' + featureUnit : ''}`,
        recoEffect: mid[sweet] ?? 0, recoLo: lo[sweet] ?? 0, recoHi: hi[sweet] ?? 0,
        tradeoff, marginal, segments,
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

function deriveJournalRow(row: JournalValue, now: Date): VMJournalRow {
    const ci = getOpt(row.ci);
    const clear = ci ? (ci.lower > 0 || ci.upper < 0) : true;
    const dirUp = row.effect > 0;
    return {
        treatment: row.spec.treatment, outcome: row.spec.outcome,
        confounders: row.spec.confounders.join(', '),
        effect: signed(row.effect),
        verdict: clear ? (dirUp ? 'higher' : 'lower') : 'no clear effect',
        verdictTone: clear ? 'pos' : 'warn',
        who: row.committedBy, when: relTime(row.committedAt, now),
    };
}

// ---------------------------------------------------------------------------
// Public entry — assemble the whole view-model.
// ---------------------------------------------------------------------------
export interface ExperimentView {
    spec: VMSpec;
    answer: VMAnswer | null;
    refute: VMRefute | null;
    dose: VMDose | null;
    journal: VMJournalRow[] | null;
}

/**
 * Derive the full view-model from the staged spec, the bound data's columns and
 * the (possibly absent) function results.
 *
 * @param spec - The staged {@link SpecValue}.
 * @param cols - The bound dataset's columns (name + type family).
 * @param result - The estimate result, or `null` until the first Run settles.
 * @param refute - The refute result, or `null`.
 * @param dose - The dose result, or `null`.
 * @param journal - Committed rows, or `null`.
 * @param meta - Optional per-column display metadata.
 * @param dataLen - Row count of the bound dataset (for the header label).
 * @param now - "Now" for relative journal timestamps (injected for determinism).
 */
export function deriveView(
    spec: SpecValue,
    cols: Column[],
    result: ResultValue | null,
    refute: RefuteValue | null,
    dose: DoseValue | null,
    journal: JournalValue[] | null,
    meta: ColMeta | undefined,
    dataLen: number,
    now: Date,
): ExperimentView {
    return {
        spec: deriveSpec(spec, cols, result, meta, dataLen),
        answer: result ? deriveAnswer(spec, result, meta) : null,
        refute: refute && result ? deriveRefute(refute, result) : null,
        dose: dose ? deriveDose(dose, spec, meta) : null,
        journal: journal ? journal.map(r => deriveJournalRow(r, now)) : null,
    };
}

// Derived helpers the shell also needs for the header / badge / banner.
export { getOpt, fmt, signed, cap, unitOf };
