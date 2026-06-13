/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React renderer for the `Experiment` causal-experiment surface.
 *
 * Reads the bound result datasets (spec / answer / refute / dose / journal) and
 * renders the picture-and-colour answer to *"did {treatment} change {outcome}?"*.
 * The result side is **derived, not authored**: the status word, the
 * sign-flip caution banner and the forest rows are all computed from the bound
 * numbers + the chosen column names — no sentence is stored in the data.
 *
 * Registered against `Experiment.Component` via `implementUIComponent`.
 *
 * @packageDocumentation
 */

import { memo, useState, type CSSProperties, type ReactNode } from 'react';
import { Box } from '@chakra-ui/react';
import { type ValueTypeOf } from '@elaraai/east';
import { Experiment } from '@elaraai/e3-ui/internal';
import { implementUIComponent } from '@elaraai/east-ui-components';

import { useBindingValue } from './bind-runtime.js';
import { ForestPlot, AreaRange, type AreaMark } from './charts.js';

// ---------------------------------------------------------------------------
// Decoded value shapes (mirror the East types in e3-ui/src/experiment.ts).
// ---------------------------------------------------------------------------
type Opt<T> = { type: 'none'; value: null } | { type: 'some'; value: T };
interface Confounder { col: string; reason: string; imbalance: number; level: string; tone: string }
interface FilterClause { field: string; op: string; value: string }
interface Spec {
    treatment: string; treatmentKind: string; outcome: string; outcomeKind: string;
    comparison: string; confounders: Confounder[]; suggestion: string; filters: FilterClause[];
    method: string; target: string; trim: boolean; dataLabel: string;
}
interface BalanceRow { col: string; treated: number; control: number; display: string; frac: number; tone: string }
interface Answer {
    treatment: string; outcome: string; unit: string;
    naive: number; naiveLo: number; naiveHi: number; effect: number; lo: number; hi: number;
    nTotal: bigint; nTreated: bigint; nControl: bigint; nCompared: bigint; nDropped: bigint;
    balance: BalanceRow[];
}
interface RefuteCheck { name: string; desc: string; value: string; passed: boolean; tip: Opt<string> }
interface Refute {
    checks: RefuteCheck[]; sensLo: number[]; sensMid: number[]; sensHi: number[];
    sensXTicks: string[]; sensYTicks: string[];
}
interface DoseMark { at: bigint; label: string; tone: string }
interface Marginal { label: string; value: number; frac: number }
interface Dose {
    feature: string; outcome: string; lo: number[]; mid: number[]; hi: number[];
    xTicks: string[]; yTicks: string[]; marks: DoseMark[];
    recoLabel: string; recoEffect: number; recoLo: number; recoHi: number;
    tradeoff: string; marginal: Marginal[]; segments: string[];
}
interface JournalRow {
    treatment: string; outcome: string; confounders: string; effect: string;
    verdict: string; verdictTone: string; who: string; when: string;
}
type ColMeta = Map<string, { label: Opt<string>; unit: Opt<string>; higherIsBetter: Opt<boolean> }>;

// ---------------------------------------------------------------------------
// Palette + small style helpers (mirrors the design spec tokens).
// ---------------------------------------------------------------------------
const P = {
    brand: '#3a7780', brandD: '#3a7780', brandTint: '#e8f6f7',
    ink: '#111b22', ink2: '#253333', ink3: '#4a5f5f', ink4: '#6b8080', ink5: '#9bb0b0',
    rule: '#e2e8e8', ruleStrong: '#cbd5d5', paper: '#ffffff', paper2: '#f8fafa', gray100: '#f1f5f5',
    pos: '#2f7a5b', neg: '#b85a4a', warn: '#b8862d',
    mono: '"JetBrains Mono", ui-monospace, monospace',
    brandFont: '"DM Sans", system-ui, sans-serif',
};
const toneColor = (t: string) => (t === 'neg' ? P.neg : t === 'warn' ? P.warn : t === 'pos' ? P.pos : t === 'muted' ? P.ink4 : P.brand);
const getOpt = <T,>(o: Opt<T> | undefined): T | undefined => (o && o.type === 'some' ? o.value : undefined);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const cardStyle: CSSProperties = { border: `1px solid ${P.rule}`, borderRadius: 9, background: P.paper, padding: '13px 14px 9px', marginTop: 16 };
const capStyle: CSSProperties = { fontFamily: P.mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: P.ink4, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 };

function Cap({ children }: { children: ReactNode }) { return <div style={capStyle}>{children}</div>; }

/** A label · track+fill · value row — the BarStrip idiom. */
function BarRow({ label, frac, tone, value }: { label: string; frac: number; tone: string; value: string }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr 96px', gap: 13, alignItems: 'center' }}>
            <span style={{ fontFamily: P.mono, fontSize: 11, color: P.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            <div style={{ position: 'relative', height: 6, background: P.gray100, borderRadius: 3, overflow: 'hidden' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, width: `${Math.round(frac * 100)}%`, background: toneColor(tone) }} />
            </div>
            <span style={{ fontFamily: P.mono, fontSize: 10.5, color: P.ink4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
type ExperimentValueIR = ValueTypeOf<typeof Experiment.Component.schema>;
type Tab = 'answer' | 'trust' | 'dose';

export interface EastChakraExperimentProps {
    value: ExperimentValueIR;
    storageKey: string;
}

const EastChakraExperiment = memo(function EastChakraExperiment({ value }: EastChakraExperimentProps) {
    const v = value as unknown as {
        spec: unknown; answer: unknown;
        refute: Opt<unknown>; dose: Opt<unknown>; journal: Opt<unknown>;
        columnMeta: Opt<ColMeta>; readonly: Opt<boolean>; defaultTab: Opt<{ type: Tab }>;
    };
    const spec = useBindingValue<Spec>(v.spec as never).value;
    const answer = useBindingValue<Answer>(v.answer as never).value;
    const refute = useBindingValue<Refute>(v.refute.type === 'some' ? (v.refute.value as never) : null).value;
    const dose = useBindingValue<Dose>(v.dose.type === 'some' ? (v.dose.value as never) : null).value;
    const journal = useBindingValue<JournalRow[]>(v.journal.type === 'some' ? (v.journal.value as never) : null).value;
    const meta = getOpt(v.columnMeta);

    const [tab, setTab] = useState<Tab>(getOpt(v.defaultTab)?.type ?? 'answer');

    if (!spec || !answer) {
        return <Box p="6" color="fg.muted" fontSize="sm">Loading experiment…</Box>;
    }

    // ---- derive everything from the numbers + chosen columns (nothing authored) ----
    const clear = answer.lo > 0 || answer.hi < 0;
    const higherBetter = getOpt(meta?.get(answer.outcome)?.higherIsBetter);
    const dirUp = answer.effect > 0;
    const statusWord = higherBetter === undefined
        ? (dirUp ? 'Higher' : 'Lower')
        : (dirUp === higherBetter ? 'Better' : 'Worse');
    const badgeTone = clear ? 'pos' : 'warn';
    const flip = Math.sign(answer.naive) !== Math.sign(answer.effect) && answer.naive !== 0;
    const top = answer.balance[0] ?? { col: '', treated: 0, control: 0, display: '', frac: 0, tone: 'muted' };
    const lowerWord = answer.naive < 0 ? 'lower' : 'higher';

    return (
        <div style={{ border: `1px solid ${P.ruleStrong}`, borderRadius: 10, overflow: 'visible', background: P.paper, boxShadow: '0 1px 2px rgba(17,27,34,0.06)', fontFamily: 'system-ui, sans-serif', color: P.ink }}>
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px', borderBottom: `1px solid ${P.rule}` }}>
                <span style={{ fontFamily: P.brandFont, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
                    Does <span style={{ color: P.brandD, fontWeight: 700 }}>{spec.treatment}</span> change <span style={{ color: P.brandD, fontWeight: 700 }}>{spec.outcome}</span>?
                </span>
                <span style={{ flex: '1 1 auto' }} />
                <span style={{ fontSize: 11, color: P.ink4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: P.pos, display: 'inline-block' }} />{spec.dataLabel}
                </span>
                <button style={{ fontFamily: P.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 14px', borderRadius: 6, border: `1px solid ${P.brandD}`, background: P.brandD, color: '#fff', cursor: 'pointer' }}>Run</button>
                <button style={{ fontFamily: P.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 14px', borderRadius: 6, border: `1px solid ${P.ruleStrong}`, background: 'transparent', color: P.ink3, cursor: 'pointer' }}>Commit</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '286px minmax(0,1fr)', alignItems: 'start' }}>
                {/* set-up rail */}
                <div style={{ borderRight: `1px solid ${P.rule}` }}>
                    <Step n={1} title="What did you change?">
                        <Pick col={spec.treatment} kind={spec.treatmentKind} />
                        <div style={{ fontSize: 10.5, color: P.ink4, marginTop: 7 }}>Treated = <b style={{ color: P.ink2 }}>{spec.comparison}</b></div>
                    </Step>
                    <Step n={2} title="What did you want it to improve?">
                        <Pick col={spec.outcome} kind={spec.outcomeKind} />
                    </Step>
                    <Step n={3} title="What else was different about those batches?">
                        <div style={{ border: `1px solid ${P.rule}`, borderRadius: 8, overflow: 'hidden' }}>
                            {spec.confounders.map((c, i) => (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 16px', gap: 9, alignItems: 'center', padding: '8px 10px', borderTop: i ? `1px solid ${P.rule}` : undefined }}>
                                    <div>
                                        <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 600, color: P.ink }}>{c.col}</div>
                                        <div style={{ fontSize: 10, color: P.ink4, lineHeight: 1.35, marginTop: 1 }}>{c.reason}</div>
                                    </div>
                                    <div>
                                        <div style={{ height: 6, borderRadius: 3, background: P.paper2, position: 'relative', overflow: 'hidden' }}>
                                            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, width: `${Math.round(c.imbalance * 100)}%`, background: toneColor(c.tone) }} />
                                        </div>
                                        <div style={{ fontSize: 8, fontFamily: P.mono, letterSpacing: '0.04em', color: P.ink4, textAlign: 'center', marginTop: 3, textTransform: 'uppercase' }}>{c.level}</div>
                                    </div>
                                    <div style={{ color: P.ink4, fontSize: 11, textAlign: 'center', cursor: 'pointer' }}>×</div>
                                </div>
                            ))}
                            <div style={{ fontFamily: P.mono, fontSize: 10.5, color: P.brandD, padding: '8px 10px', cursor: 'pointer' }}>+ {spec.suggestion}</div>
                        </div>
                    </Step>
                    <Step n={4} title="Which batches?">
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                            {spec.filters.map((f, i) => (
                                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px 4px 11px', border: `1px solid ${P.brandD}`, borderRadius: 9999, background: P.brandTint, fontFamily: P.mono, fontSize: 10.5, color: '#2b4b55', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    <span style={{ color: P.brandD, fontWeight: 500 }}>{f.field}</span><span style={{ color: P.ink4, margin: '0 1px' }}>{f.op}</span>{f.value}<span style={{ color: P.ink4 }}>×</span>
                                </span>
                            ))}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', border: `1px dashed ${P.ruleStrong}`, borderRadius: 9999, fontFamily: P.mono, fontSize: 10.5, color: P.ink4, fontWeight: 600, cursor: 'pointer' }}>+ filter</span>
                        </div>
                    </Step>
                    <details style={{ borderTop: `1px solid ${P.rule}` }}>
                        <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '11px 18px', fontSize: 11, fontWeight: 600, color: P.ink3 }}>▸ Advanced <span style={{ color: P.ink4, fontWeight: 400, fontSize: 10 }}>(sensible defaults — leave it)</span></summary>
                        <div style={{ padding: '2px 18px 14px' }}>
                            <AdvRow label="How to compare" left="regression" right="reweighting" on={spec.method === 'reweighting' ? 'right' : 'left'} />
                            <AdvRow label="Answer for" left="all batches" right="only treated" on={spec.target === 'treated' ? 'right' : 'left'} />
                            <AdvRow label="Drop un-matchable" left="on" right="off" on={spec.trim ? 'left' : 'right'} last />
                        </div>
                    </details>
                </div>

                {/* result deck */}
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', padding: '0 16px', borderBottom: `1px solid ${P.rule}` }}>
                        {(['answer', 'trust', 'dose'] as Tab[]).map((t) => (
                            <span key={t} onClick={() => setTab(t)} style={{ fontSize: 12, fontWeight: 600, padding: '12px 14px', color: tab === t ? P.brandD : P.ink4, cursor: 'pointer', borderBottom: `2px solid ${tab === t ? P.brandD : 'transparent'}`, marginBottom: -1 }}>
                                {t === 'answer' ? 'Answer' : t === 'trust' ? 'Can we trust it?' : 'How much?'}
                            </span>
                        ))}
                    </div>

                    {/* ANSWER */}
                    {tab === 'answer' && (
                        <div style={{ padding: 18 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ fontFamily: P.mono, fontSize: 11, color: P.ink4 }}>{answer.outcome}</span>
                                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                                        <span style={{ fontFamily: P.brandFont, fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, color: clear ? P.pos : P.warn }}>{(answer.effect > 0 ? '+' : '') + answer.effect}</span>
                                        <span style={{ fontFamily: P.mono, fontSize: 11, color: P.ink4 }}>95% CI&nbsp; {(answer.lo > 0 ? '+' : '') + answer.lo} … {(answer.hi > 0 ? '+' : '') + answer.hi}</span>
                                    </span>
                                </div>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '6px 12px', borderRadius: 999, background: badgeTone === 'pos' ? '#e7f1ec' : '#f7efe0', color: badgeTone === 'pos' ? P.pos : P.warn }}>
                                    {clear ? `${dirUp ? '↑' : '↓'} ${statusWord} with ${answer.treatment}` : 'No clear effect'}
                                </span>
                            </div>

                            {flip && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 13, padding: '10px 12px', borderRadius: 8, background: '#fbf5e9', border: '1px solid #e6d4ad', fontSize: 12, lineHeight: 1.5, color: P.ink2 }}>
                                    <span style={{ color: P.warn, marginTop: 1 }}>⚠</span>
                                    <div><b style={{ color: P.ink }}>Raw and like-for-like disagree.</b> In the plain average, <span style={{ fontFamily: P.mono }}>{answer.treatment}</span> batches sit <em>{lowerWord}</em> on <span style={{ fontFamily: P.mono }}>{answer.outcome}</span> ({(answer.naive > 0 ? '+' : '') + answer.naive}) — but they also differ most on <span style={{ fontFamily: P.mono }}>{top.col}</span> ({top.display}). Adjusting for it reverses the result.</div>
                                </div>
                            )}

                            <div style={cardStyle}>
                                <Cap>Raw average vs. like-for-like</Cap>
                                <ForestPlot
                                    rows={[
                                        { label: 'Raw average', note: 'unadjusted', est: answer.naive, lo: answer.naiveLo, hi: answer.naiveHi, tone: answer.naive < 0 ? 'neg' : 'pos' },
                                        { label: 'Like-for-like', note: `adjusted for ${answer.balance.length} confounders`, est: answer.effect, lo: answer.lo, hi: answer.hi, tone: clear ? 'pos' : 'warn' },
                                    ]}
                                    min={Math.floor(Math.min(answer.naiveLo, answer.lo) - 2)}
                                    max={Math.ceil(Math.max(answer.naiveHi, answer.hi) + 2)}
                                    unit={`change in ${answer.outcome} (${answer.unit})`}
                                    height={116}
                                />
                            </div>

                            <div style={cardStyle}>
                                <Cap>How unbalanced each one was — before adjusting</Cap>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '2px 0' }}>
                                    {answer.balance.map((b, i) => <BarRow key={i} label={b.col} frac={b.frac} tone={b.tone} value={b.display} />)}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 11, color: P.ink4 }}>
                                <span><b style={{ color: P.ink2 }}>{Number(answer.nTotal)}</b> batches</span>
                                <span><b style={{ color: P.ink2 }}>{Number(answer.nCompared)}</b> compared like-for-like</span>
                                <span><b style={{ color: P.ink2 }}>{Number(answer.nDropped)}</b> had no fair match</span>
                            </div>
                        </div>
                    )}

                    {/* TRUST */}
                    {tab === 'trust' && refute && (
                        <div style={{ padding: 18 }}>
                            <p style={{ fontSize: 12.5, color: P.ink2, lineHeight: 1.55, margin: '0 0 14px' }}>Before trusting the answer we tried to break it — colour shows pass / caution.</p>
                            <div style={{ border: `1px solid ${P.rule}`, borderRadius: 8, overflow: 'hidden' }}>
                                {refute.checks.map((c, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 11, alignItems: 'start', padding: '11px 13px', borderTop: i ? `1px solid ${P.rule}` : undefined }}>
                                        <span style={{ fontSize: 13, marginTop: 1, color: c.passed ? P.pos : P.warn }}>{c.passed ? '✓' : '⚠'}</span>
                                        <div>
                                            <div style={{ fontSize: 12.5, fontWeight: 600, color: P.ink }}>{c.name}</div>
                                            <div style={{ fontSize: 11, color: P.ink4, lineHeight: 1.45, marginTop: 2 }}>{c.desc}</div>
                                        </div>
                                        <span style={{ fontFamily: P.mono, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', color: c.passed ? P.pos : P.warn }}>{c.value}</span>
                                    </div>
                                ))}
                            </div>
                            <div style={cardStyle}>
                                <Cap>Effect as a hidden cause is made stronger</Cap>
                                <AreaRange lo={refute.sensLo} mid={refute.sensMid} hi={refute.sensHi} zero={0} tone="brand" xTicks={refute.sensXTicks} yTicks={refute.sensYTicks} height={104} />
                            </div>
                        </div>
                    )}

                    {/* DOSE */}
                    {tab === 'dose' && dose && (
                        <div style={{ padding: 18 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                                <span style={{ fontFamily: P.mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: P.ink4 }}>Response for</span>
                                <span style={{ display: 'inline-flex', border: `1px solid ${P.ruleStrong}`, borderRadius: 6, overflow: 'hidden' }}>
                                    {dose.segments.map((s, i) => (
                                        <span key={i} style={{ fontSize: 11, padding: '5px 11px', color: i === 0 ? '#fff' : P.ink3, background: i === 0 ? P.brandD : 'transparent', fontWeight: i === 0 ? 600 : 400, borderRight: i < dose.segments.length - 1 ? `1px solid ${P.rule}` : undefined, cursor: 'pointer' }}>{s}</span>
                                    ))}
                                </span>
                            </div>
                            <div style={cardStyle}>
                                <Cap>{dose.outcome} gained vs. {dose.feature}</Cap>
                                <AreaRange lo={dose.lo} mid={dose.mid} hi={dose.hi} tone="pos" xTicks={dose.xTicks} yTicks={dose.yTicks}
                                    marks={dose.marks.map((m): AreaMark => ({ at: Number(m.at), label: m.label, tone: m.tone }))} height={256} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                                <div style={{ ...cardStyle, marginTop: 0 }}>
                                    <Cap>Recommended</Cap>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        <span style={{ fontFamily: P.mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: P.ink4 }}>{dose.recoLabel}</span>
                                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                            <span style={{ fontFamily: P.brandFont, fontSize: 24, fontWeight: 700, color: P.brandD, letterSpacing: '-0.01em', lineHeight: 1 }}>{(dose.recoEffect > 0 ? '+' : '') + dose.recoEffect}</span>
                                            <span style={{ fontFamily: P.mono, fontSize: 11, color: P.ink4 }}>&nbsp;·&nbsp; {(dose.recoLo > 0 ? '+' : '') + dose.recoLo} … {(dose.recoHi > 0 ? '+' : '') + dose.recoHi}</span>
                                        </span>
                                    </div>
                                    <div style={{ marginTop: 11, paddingTop: 10, borderTop: `1px solid ${P.rule}`, fontSize: 11.5, lineHeight: 1.5, color: P.ink3 }}>{dose.tradeoff}</div>
                                </div>
                                <div style={{ ...cardStyle, marginTop: 0 }}>
                                    <Cap>Extra {dose.outcome} per step</Cap>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '2px 0' }}>
                                        {dose.marginal.map((m, i) => <BarRow key={i} label={m.label} frac={m.frac} tone={i < 2 ? 'brand' : i === 2 ? 'brand' : 'muted'} value={(m.value > 0 ? '+' : '') + m.value} />)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* journal */}
            {journal && journal.length > 0 && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 18px', borderTop: `1px solid ${P.rule}`, background: P.paper2 }}>
                        <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: P.ink3 }}>Committed experiments</span>
                        <span style={{ fontFamily: P.mono, fontSize: 11, color: P.ink4 }}><b style={{ color: P.ink, fontWeight: 600 }}>{journal.length}</b> on record</span>
                    </div>
                    {journal.map((r, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 88px 116px 112px', gap: 12, alignItems: 'center', padding: '11px 18px', borderTop: `1px solid ${P.rule}`, fontSize: 12 }}>
                            <div><b>{r.treatment} → {r.outcome}</b> <span style={{ color: P.ink4 }}>· vs {r.confounders}</span></div>
                            <div style={{ fontFamily: P.mono, fontWeight: 600, textAlign: 'right', color: r.verdictTone === 'pos' ? P.pos : P.ink }}>{r.effect}</div>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: r.verdictTone === 'pos' ? P.pos : P.warn }}>{r.verdict}</div>
                            <div style={{ fontFamily: P.mono, fontSize: 11, textAlign: 'right', color: P.ink4 }}>{r.who} · {r.when}</div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
});

// ---------------------------------------------------------------------------
// Small set-up-rail helpers.
// ---------------------------------------------------------------------------
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
    return (
        <div style={{ padding: '13px 18px', borderBottom: `1px solid ${P.rule}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
                <span style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: '#fff', background: P.brandD, width: 16, height: 16, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{n}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: P.ink, lineHeight: 1.35 }}>{title}</span>
            </div>
            {children}
        </div>
    );
}
function Pick({ col, kind }: { col: string; kind: string }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', border: `1px solid ${P.ruleStrong}`, borderRadius: 7, background: P.paper, fontSize: 12.5, color: P.ink, cursor: 'pointer' }}>
            <span style={{ fontFamily: P.mono, fontWeight: 600 }}>{col}</span>
            <span style={{ fontSize: 9.5, color: P.ink4, background: P.paper2, padding: '1px 5px', borderRadius: 4 }}>{kind}</span>
            <span style={{ color: P.ink4, fontSize: 10 }}>▾</span>
        </span>
    );
}
function AdvRow({ label, left, right, on, last }: { label: string; left: string; right: string; on: 'left' | 'right'; last?: boolean }) {
    const seg = (txt: string, active: boolean, border: boolean) => (
        <span style={{ flex: '1 1 0', textAlign: 'center', whiteSpace: 'nowrap', fontSize: 10.5, padding: '5px 8px', color: active ? '#fff' : P.ink3, background: active ? P.brandD : 'transparent', cursor: 'pointer', fontFamily: P.mono, borderRight: border ? `1px solid ${P.ruleStrong}` : undefined }}>{txt}</span>
    );
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '9px 0', borderBottom: last ? undefined : `1px solid ${P.rule}` }}>
            <span style={{ fontSize: 11.5, color: P.ink2 }}>{label}</span>
            <span style={{ display: 'flex', width: '100%', border: `1px solid ${P.ruleStrong}`, borderRadius: 6, overflow: 'hidden' }}>
                {seg(left, on === 'left', true)}
                {seg(right, on === 'right', false)}
            </span>
        </div>
    );
}

implementUIComponent(Experiment.Component, EastChakraExperiment);

export { EastChakraExperiment };
