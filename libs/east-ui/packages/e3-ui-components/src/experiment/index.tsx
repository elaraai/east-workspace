/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React renderer for the `Experiment` causal-experiment surface.
 *
 * **Interactive and generic over the input row.** Binds an input dataset + a
 * staged spec + three estimator functions; introspects the dataset's row struct
 * to drive the treatment / outcome / confounder pickers, runs the bound
 * functions on **Run** via the shared `Func.bind` runtime, and **derives** every
 * word / colour / bar from the returned numbers. Editing a picker stages a new
 * spec and marks the result stale; **Commit** appends to the journal.
 *
 * **Design-system native, like Decision.** No hand-rolled styles: the shell
 * composes shared recipes (`button` / `barStrip` / `facetTabs` / `status` /
 * `badge` / `chip` / `eyebrowRow` / `segmentGroup`), layer styles (`frame` /
 * `header.bar` / `card` / `banner.stale`) and text styles (`caption.eyebrow` /
 * `mono.sm` / `mono-kpi` / `title.row`). The population filter reuses Slice's
 * `SliceEditPopover` + `SlicePredicateBuilder` + `formatPredicate` (its
 * population is an `Array<SlicePredicate>`). Charts are visx (see {@link "./charts"}).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Text, Menu, Portal, useRecipe, useSlotRecipe } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp, faCheck, faChevronDown, faPlus, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import { fromEastTypeValue, variant, some, none, type EastType, type EastTypeValue, type ValueTypeOf } from '@elaraai/east';
import { Experiment } from '@elaraai/e3-ui/internal';
import {
    implementUIComponent,
    SlicePredicateBuilder, SliceEditPopover, formatPredicate,
    type SliceFieldValue, type PredicateValue,
} from '@elaraai/east-ui-components';

import { useBindingValue } from './bind-runtime.js';
import { useFuncCall } from './run-runtime.js';
import { getBindingTypes, getReactiveDatasetCache } from '../platform/index.js';
import { ForestPlot, AreaRange, type AreaMark } from './charts.js';
import {
    deriveView,
    getOpt, signed,
    type Opt, type Column, type SpecValue, type ResultValue, type RefuteValue, type DoseValue, type JournalValue, type ColMeta,
} from './derive.js';

// Tone → semantic colour token (Box `bg` / Text `color`). Semantic roles, no hex.
const TONE_TOKEN: Record<string, string> = {
    neg: 'fg.danger', pos: 'fg.success', warn: 'fg.warning', muted: 'fg.muted', brand: 'brand.solid',
};
const toneToken = (t: string): string => TONE_TOKEN[t] ?? 'brand.solid';

// ---------------------------------------------------------------------------
// Payload decode + column introspection.
// ---------------------------------------------------------------------------
type ExperimentValueIR = ValueTypeOf<typeof Experiment.Component.schema>;
type Tab = 'answer' | 'trust' | 'dose';

interface DiffBindingVal { source: unknown; patch: Opt<unknown>; mode: { type: string } }
interface FuncBindingVal { name: string }

function kindOfTypeValue(t: EastTypeValue): Column['kind'] {
    switch (t.type) {
        case 'Boolean': return 'boolean';
        case 'Integer': return 'integer';
        case 'Float': return 'float';
        case 'String': return 'string';
        case 'DateTime': return 'datetime';
        default: return 'other';
    }
}

/** Recover the bound dataset's columns from the binding registry (Table-style). */
function useColumns(workspace: string, source: unknown): { columns: Column[]; rowArrayType: EastType | null } {
    const types = source ? getBindingTypes(workspace, source as never) : undefined;
    return useMemo(() => {
        const st = types?.sourceType;
        if (!st || st.type !== 'Array') return { columns: [], rowArrayType: null };
        const el = st.value as EastTypeValue;
        const fields = el.type === 'Struct' ? (el.value as { name: string; type: EastTypeValue }[]) : [];
        return {
            columns: fields.map(f => ({ name: f.name, kind: kindOfTypeValue(f.type) })),
            rowArrayType: fromEastTypeValue(st),
        };
    }, [types?.sourceType]);
}

const STR_TYPE: EastTypeValue = variant('String', null) as unknown as EastTypeValue;

// ---------------------------------------------------------------------------
// Small presentational helpers (text-style / layer-style based).
// ---------------------------------------------------------------------------

/** Mono uppercase eyebrow caption for a card section (design `.xp-cap`). */
function Cap({ children }: { children: ReactNode }) {
    return <Text textStyle="caption.eyebrow" fontSize="9px" display="flex" alignItems="center" gap="1.5" mb="2.5">{children}</Text>;
}

/** A section card (the `.frame`-inset cards in the result deck). Owns its
 *  padding + radius so call sites never re-tune them. */
function Card({ children, mt = '3' }: { children: ReactNode; mt?: string }) {
    return <Box layerStyle="card" p="3.5" borderRadius="lg" mt={mt}>{children}</Box>;
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------
export interface EastChakraExperimentProps {
    value: ExperimentValueIR;
    storageKey: string;
}

const EastChakraExperiment = memo(function EastChakraExperiment({ value }: EastChakraExperimentProps) {
    const v = value as unknown as {
        data: DiffBindingVal; spec: DiffBindingVal;
        estimate: FuncBindingVal; refute: Opt<FuncBindingVal>; dose: Opt<FuncBindingVal>;
        journal: Opt<DiffBindingVal>;
        columnMeta: Opt<ColMeta>; readonly: Opt<boolean>; defaultTab: Opt<{ type: Tab }>;
    };

    // Recipes — acquired once (the call-once / spread-slot idiom).
    const button = useRecipe({ key: 'button' });
    const chip = useRecipe({ key: 'chip' });
    const badge = useRecipe({ key: 'badge' });
    const bs = useSlotRecipe({ key: 'barStrip' })({});
    const statusR = useSlotRecipe({ key: 'status' });
    const es = useSlotRecipe({ key: 'eyebrowRow' })({});

    const workspace = getReactiveDatasetCache().getConfig().workspace ?? '';
    const data = useBindingValue<unknown[]>(v.data as never);
    const specBind = useBindingValue<SpecValue>(v.spec as never);
    const journalBind = useBindingValue<JournalValue[]>(v.journal.type === 'some' ? (v.journal.value as never) : null);
    const meta = getOpt(v.columnMeta);
    const readonly = getOpt(v.readonly) ?? false;

    const { columns, rowArrayType } = useColumns(workspace, v.data.source);
    const spec = specBind.value;

    // Filterable fields for the Slice predicate builder (the one bit the absent
    // SliceBind handle would otherwise supply via slice.fields()).
    const fields = useMemo<SliceFieldValue[]>(
        () => columns.filter(c => c.kind !== 'other').map(c => ({
            fieldId: c.name, label: getOpt(meta?.get(c.name)?.label) ?? c.name, kind: c.kind,
        }) as SliceFieldValue),
        [columns, meta],
    );

    const estInputs = useMemo(() => (rowArrayType ? [rowArrayType, Experiment.Types.Spec] : null), [rowArrayType]);
    const doseInputs = useMemo(() => (rowArrayType ? [rowArrayType, Experiment.Types.Spec, fromEastTypeValue(STR_TYPE)] : null), [rowArrayType]);
    const estimate = useFuncCall<ResultValue>(v.estimate.name, estInputs, Experiment.Types.Result);
    const refute = useFuncCall<RefuteValue>(v.refute.type === 'some' ? v.refute.value.name : null, estInputs, Experiment.Types.Refute);
    const dose = useFuncCall<DoseValue>(v.dose.type === 'some' ? v.dose.value.name : null, doseInputs, Experiment.Types.Dose);

    const doseFeature = useMemo(() => {
        if (!spec) return '';
        const f = columns.find(c => c.kind === 'float' && c.name !== spec.outcome);
        return f?.name ?? spec.treatment;
    }, [columns, spec]);

    const runAll = useCallback(() => {
        if (!data.value || !spec) return;
        estimate.call(data.value, spec);
        if (v.refute.type === 'some') refute.call(data.value, spec);
        if (v.dose.type === 'some') dose.call(data.value, spec, doseFeature);
    }, [data.value, spec, estimate, refute, dose, doseFeature, v.refute.type, v.dose.type]);

    // Auto-run when the inputs first become ready and nothing has produced a
    // result yet (re-arms if data/spec arrive late; not latched by a ref).
    const autoRan = useRef(false);
    useEffect(() => {
        if (autoRan.current) return;
        if (!data.value || !spec || !rowArrayType) return;
        if (estimate.result !== null || estimate.status === 'running') { autoRan.current = true; return; }
        if (estimate.status !== 'idle') return;
        autoRan.current = true;
        runAll();
    }, [data.value, spec, rowArrayType, estimate.result, estimate.status, runAll]);

    const [stale, setStale] = useState(false);
    // Defer the East-side staged write out of the React event (per the
    // interactive-state rule); the staged store's useSyncExternalStore drives
    // the re-render.
    const editSpec = useCallback((next: SpecValue) => {
        setStale(true);
        queueMicrotask(() => specBind.mutate(next));
    }, [specBind]);
    const onRun = useCallback(() => { runAll(); setStale(false); }, [runAll]);
    const onCommit = useCallback(async () => {
        if (!spec || !estimate.result) return;
        const row: JournalValue = { spec, effect: estimate.result.effect, ci: estimate.result.ci, committedAt: new Date(), committedBy: 'you' };
        journalBind.mutate([row, ...(journalBind.value ?? [])]);
        try {
            await journalBind.commit();
            await specBind.commit();
            setStale(false);
        } catch { /* surface left stale; a commit failed */ }
    }, [spec, estimate.result, journalBind, specBind]);

    const [tab, setTab] = useState<Tab>(getOpt(v.defaultTab)?.type ?? 'answer');
    const now = useMemo(() => new Date(), []);
    const nRows = data.value?.length ?? 0;

    const view = useMemo(() => {
        if (!spec) return null;
        return deriveView(spec, columns, estimate.result, refute.result, dose.result, journalBind.value, meta, nRows, now);
    }, [spec, columns, estimate.result, refute.result, dose.result, journalBind.value, meta, nRows, now]);

    if (!spec || !view || !view.answer) {
        const failed = estimate.status === 'failed';
        return (
            <Box layerStyle="frame" p="6">
                <Text className={failed ? undefined : 'elara-skeleton'} textStyle="body.sm" color="fg.muted">
                    {failed ? 'Could not run the experiment.' : 'Loading experiment…'}
                </Text>
            </Box>
        );
    }
    const { spec: vs, answer: a, refute: vr, dose: vd, journal } = view;

    const clear = a!.lo > 0 || a!.hi < 0;
    const ans = a!;
    const higherBetter = getOpt(meta?.get(vs.outcome)?.higherIsBetter);
    const dirUp = ans.effect > 0;
    const statusWord = higherBetter === undefined ? (dirUp ? 'Higher' : 'Lower') : (dirUp === higherBetter ? 'Better' : 'Worse');
    const flip = Math.sign(ans.naive) !== Math.sign(ans.effect) && ans.naive !== 0;
    const top = ans.balance[0] ?? { col: '', display: '' };
    const lowerWord = ans.naive < 0 ? 'lower' : 'higher';
    const population = (getOpt(spec.population) ?? []) as PredicateValue[];

    const dataStatus = statusR({ status: 'success', size: 'sm' });

    // A bar list via the shared `barStrip` slot recipe (hoisted `bs`).
    const barList = (rows: { label: string; frac: number; tone: string; value: string }[]) => (
        <Box css={bs.root}>
            {rows.map((r, i) => (
                <Box key={i} css={bs.row}>
                    <Text css={bs.label} textStyle="mono.sm" color="fg.default" truncate>{r.label}</Text>
                    <Box css={bs.track}><Box css={bs.fill} width={`${Math.round(r.frac * 100)}%`} bg={toneToken(r.tone)} /></Box>
                    <Text css={bs.value}>{r.value}</Text>
                </Box>
            ))}
        </Box>
    );

    // Run / Commit — real disabled handling (clicks blocked, not aria-only).
    const runDisabled = readonly || !data.value || estimate.pending;
    const commitDisabled = readonly || !estimate.result || estimate.pending;
    const actionBtn = (vt: 'solid' | 'ghost', label: string, onClick: () => void, disabled: boolean, stalePulse = false) => (
        <Box as="button" css={{ ...button({ variant: vt, size: 'sm' }), ...(stalePulse && !disabled ? { animationName: 'pulse', animationDuration: '1.6s', animationIterationCount: 'infinite' } : {}) }}
            onClick={disabled ? undefined : onClick} aria-disabled={disabled || undefined}
            opacity={disabled ? 0.5 : undefined} cursor={disabled ? 'not-allowed' : 'pointer'}>{label}</Box>
    );

    return (
        <Box layerStyle="frame" overflow="visible">
            {/* header */}
            <Box layerStyle="header.bar" display="flex" alignItems="center" gap="3.5">
                <Text textStyle="title.card">
                    Does <Text as="span" color="brand.fg" fontWeight="bold">{vs.treatment}</Text> change <Text as="span" color="brand.fg" fontWeight="bold">{vs.outcome}</Text>?
                </Text>
                <Box flex="1" />
                <Box as="span" css={dataStatus.root}>
                    <Box as="span" css={dataStatus.indicator} />
                    <Box as="span" css={dataStatus.label}>{vs.dataLabel}</Box>
                </Box>
                {actionBtn('solid', 'Run', onRun, runDisabled, stale)}
                {actionBtn('ghost', 'Commit', onCommit, commitDisabled)}
            </Box>

            <Box display="grid" gridTemplateColumns="304px minmax(0,1fr)" alignItems="start">
                {/* set-up rail */}
                <Box borderRightWidth="1px" borderColor="border.subtle">
                    <Step n={1} title="What did you change?">
                        <ColumnPick column={vs.treatment} kind={vs.treatmentKind} badge={badge} button={button} choices={columns.filter(c => c.kind === 'boolean' || c.kind === 'integer').map(c => c.name)} onPick={c => editSpec({ ...spec, treatment: c })} />
                        <Text textStyle="caption" mt="1.5">Treated = <Text as="span" color="fg.default" fontWeight="semibold">{vs.comparison}</Text></Text>
                    </Step>
                    <Step n={2} title="What did you want it to improve?">
                        <ColumnPick column={vs.outcome} kind={vs.outcomeKind} badge={badge} button={button} choices={columns.filter(c => c.kind === 'float' || c.kind === 'integer').map(c => c.name)} onPick={c => editSpec({ ...spec, outcome: c })} />
                    </Step>
                    <Step n={3} title="What else was different about those batches?">
                        <Box layerStyle="frame.flat">
                            {vs.confounders.map((c, i) => (
                                <Box key={i} display="grid" gridTemplateColumns="1fr 78px 16px" gap="2.5" alignItems="center" px="2.5" py="2.5" borderTopWidth={i ? '1px' : '0'} borderColor="border.subtle">
                                    <Box>
                                        <Text textStyle="mono.sm" fontWeight="semibold" color="fg.default">{c.col}</Text>
                                        <Text textStyle="caption" lineHeight="1.35" mt="px">{c.reason}</Text>
                                    </Box>
                                    <Box>
                                        <Box css={bs.track}><Box css={bs.fill} width={`${Math.round(c.imbalance * 100)}%`} bg={toneToken(c.tone)} /></Box>
                                        <Text textStyle="caption.eyebrow" fontSize="9px" textAlign="center" mt="1.5">{c.level}</Text>
                                    </Box>
                                    <Box as="button" css={button({ variant: 'ghost', size: 'xs' })} px="0" minW="16px" display="inline-flex" alignItems="center" justifyContent="center" aria-label={`Remove ${c.col}`} onClick={() => editSpec({ ...spec, confounders: spec.confounders.filter(x => x !== c.col), categorical: spec.categorical.filter(x => x !== c.col) })}><FontAwesomeIcon icon={faXmark} style={{ fontSize: '11px' }} /></Box>
                                </Box>
                            ))}
                            {vs.suggestion && (
                                <ColumnMenu choices={columns.filter(c => !new Set([spec.treatment, spec.outcome, ...spec.confounders]).has(c.name)).map(c => c.name)} onPick={c => editSpec({ ...spec, confounders: [...spec.confounders, c] })}>
                                    <Box as="button" css={button({ variant: 'ghost', size: 'sm' })} justifyContent="flex-start" width="100%" color="brand.fg" fontFamily="mono" display="inline-flex" alignItems="center" gap="2"><FontAwesomeIcon icon={faPlus} style={{ fontSize: '9px' }} />add another</Box>
                                </ColumnMenu>
                            )}
                        </Box>
                    </Step>
                    <Step n={4} title="Which batches?">
                        <FilterRail fields={fields} population={population} onChange={next => editSpec({ ...spec, population: next.length ? some(next) : none } as unknown as SpecValue)} chip={chip} button={button} />
                    </Step>
                    <Box as="details" borderTopWidth="1px" borderColor="border.subtle">
                        <Box as="summary" textStyle="caption.eyebrow" cursor="pointer" px="4.5" py="2.5" display="flex" alignItems="center" gap="1.5"
                             css={{ listStyle: 'none', '&::-webkit-details-marker': { display: 'none' } }}>
                            <Box as="span" display="inline-flex" color="fg.subtle" fontSize="10px" transition="transform 180ms ease" transform="rotate(-90deg)"
                                 css={{ 'details[open] > summary > &': { transform: 'rotate(0deg)' } }}><FontAwesomeIcon icon={faChevronDown} /></Box>
                            Advanced
                        </Box>
                        <Box px="4.5" pb="3.5" pt="0.5">
                            <Segmented label="How to compare" left="regression" right="reweighting" active={vs.method === 'reweighting' ? 'right' : 'left'} onPick={s => editSpec({ ...spec, method: some(s === 'right' ? variant('propensity_score_weighting', { weighting_scheme: none }) : variant('linear_regression', null)) } as unknown as SpecValue)} />
                            <Segmented label="Answer for" left="all batches" right="only treated" active={vs.target === 'treated' ? 'right' : 'left'} onPick={s => editSpec({ ...spec, targetUnits: some(variant(s === 'right' ? 'att' : 'ate', null)) } as unknown as SpecValue)} />
                            <Segmented label="Drop un-matchable" left="on" right="off" active={vs.trim ? 'left' : 'right'} onPick={s => editSpec({ ...spec, trim: s === 'left' ? some(variant('overlap', null)) : none } as unknown as SpecValue)} last />
                        </Box>
                    </Box>
                </Box>

                {/* result deck */}
                <Box minW="0">
                    <Box display="flex" px="4" borderBottomWidth="1px" borderColor="border.subtle">
                        {(['answer', 'trust', 'dose'] as Tab[]).map(tk => {
                            const on = tab === tk;
                            return (
                                <Box key={tk} as="button" onClick={() => setTab(tk)} cursor="pointer"
                                    fontSize="xs" fontWeight="semibold" px="3.5" py="3" mb="-1px"
                                    color={on ? 'brand.fg' : 'fg.muted'}
                                    borderBottomWidth="2px" borderColor={on ? 'brand.solid' : 'transparent'}
                                    _hover={{ color: on ? 'brand.fg' : 'fg.default' }}>
                                    {tk === 'answer' ? 'Answer' : tk === 'trust' ? 'Can we trust it?' : 'How much?'}
                                </Box>
                            );
                        })}
                    </Box>

                    {tab === 'answer' && (
                        <Box p="4.5">
                            <Box display="flex" alignItems="center" gap="4.5" flexWrap="wrap">
                                <Box display="flex" flexDirection="column" gap="0.5">
                                    <Text textStyle="mono.sm" color="fg.muted">{ans.outcome}</Text>
                                    <Box display="flex" alignItems="baseline" gap="2.5">
                                        <Text textStyle="mono-kpi" fontFamily="heading" fontSize="32px" color={clear ? 'fg.success' : 'fg.warning'}>{signed(ans.effect)}</Text>
                                        <Text textStyle="mono.sm" color="fg.muted">95% CI&nbsp; {signed(ans.lo)} … {signed(ans.hi)}</Text>
                                    </Box>
                                </Box>
                                <Box as="span" css={badge({ variant: clear ? 'ok' : 'warn', size: 'md' })} alignSelf="flex-end" mb="1" display="inline-flex" alignItems="center" gap="1">
                                    {clear && <FontAwesomeIcon icon={dirUp ? faArrowUp : faArrowDown} style={{ fontSize: '10px' }} />}
                                    {clear ? `${statusWord} with ${ans.treatment}` : 'No clear effect'}
                                </Box>
                            </Box>

                            {flip && (
                                <Box layerStyle="banner.stale" display="flex" alignItems="flex-start" gap="2" mt="3">
                                    <Box as="span" color="fg.warning" flexShrink="0" mt="0.5" fontSize="12px"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>
                                    <Text textStyle="body.sm" color="fg.default"><Text as="span" fontWeight="bold">Raw and like-for-like disagree.</Text> In the plain average, <Text as="span" fontFamily="mono">{ans.treatment}</Text> batches sit <Text as="span" fontStyle="italic">{lowerWord}</Text> on <Text as="span" fontFamily="mono">{ans.outcome}</Text> ({signed(ans.naive)}) — but they also differ most on <Text as="span" fontFamily="mono">{top.col}</Text> ({top.display}). Adjusting for it reverses the result.</Text>
                                </Box>
                            )}

                            <Card>
                                <Cap>Raw average vs. like-for-like</Cap>
                                <ForestPlot
                                    rows={[
                                        { label: 'Raw average', note: 'unadjusted', est: ans.naive, lo: ans.naiveLo, hi: ans.naiveHi, tone: ans.naive < 0 ? 'neg' : 'pos' },
                                        { label: 'Like-for-like', note: 'adjusted', est: ans.effect, lo: ans.lo, hi: ans.hi, tone: clear ? 'pos' : 'warn' },
                                    ]}
                                    min={Math.floor(Math.min(ans.naiveLo, ans.lo) - 2)}
                                    max={Math.ceil(Math.max(ans.naiveHi, ans.hi) + 2)}
                                    unit={`change in ${ans.outcome}${ans.unit ? ` (${ans.unit})` : ''}`}
                                    height={150}
                                />
                            </Card>

                            <Card>
                                <Cap>How unbalanced each one was — before adjusting</Cap>
                                <Box py="0.5">{barList(ans.balance.map(b => ({ label: b.col, frac: b.frac, tone: b.tone, value: b.display })))}</Box>
                            </Card>

                            <Box display="flex" gap="4" mt="3.5">
                                {([[ans.nTotal, 'batches'], [ans.nCompared, 'compared like-for-like'], [ans.nDropped, 'had no fair match']] as const).map(([n, label], i) => (
                                    <Text key={i} textStyle="mono.sm" color="fg.muted"><Text as="span" color="fg.default" fontWeight="semibold">{Number(n)}</Text> {label}</Text>
                                ))}
                            </Box>
                        </Box>
                    )}

                    {tab === 'trust' && vr && (
                        <Box p="4.5">
                            <Text textStyle="body.sm" color="fg.muted" mb="3.5">Before trusting the answer we tried to break it — colour shows pass / caution.</Text>
                            <Box layerStyle="frame.flat">
                                {vr.checks.map((c, i) => {
                                    const cs = statusR({ status: c.passed ? 'success' : 'warning', size: 'sm' });
                                    return (
                                        <Box key={i} display="grid" gridTemplateColumns="auto 1fr minmax(96px,auto)" gap="2.5" alignItems="start" px="3.5" py="2.5" borderTopWidth={i ? '1px' : '0'} borderColor="border.subtle">
                                            <Box as="span" css={cs.root} mt="1"><Box as="span" css={cs.indicator} /></Box>
                                            <Box>
                                                <Text textStyle="body.sm" fontWeight="semibold" color="fg.default">{c.name}</Text>
                                                <Text textStyle="caption" lineHeight="1.45" mt="0.5">{c.desc}</Text>
                                            </Box>
                                            <Box display="inline-flex" alignItems="center" justifyContent="flex-end" gap="1.5" whiteSpace="nowrap" color={c.passed ? 'fg.success' : 'fg.warning'}>
                                                <Text textStyle="mono.sm" fontWeight="bold" fontVariantNumeric="tabular-nums">{c.value}</Text>
                                                <FontAwesomeIcon icon={c.passed ? faCheck : faTriangleExclamation} style={{ fontSize: '11px' }} />
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                            <Card>
                                <Cap>Effect as a hidden cause is made stronger</Cap>
                                <AreaRange lo={vr.sensLo} mid={vr.sensMid} hi={vr.sensHi} zero={0} tone="brand" xTicks={vr.sensXTicks} yTicks={vr.sensYTicks} height={132} />
                            </Card>
                        </Box>
                    )}

                    {tab === 'dose' && vd && (
                        <Box p="4.5">
                            {vd.segments.length > 1 && (
                                <Box display="flex" alignItems="center" gap="2.5" mb="3.5">
                                    <Text textStyle="caption.eyebrow">Response for</Text>
                                    <SegmentSelect options={vd.segments} active={0} onPick={() => { /* segment narrowing — future */ }} />
                                </Box>
                            )}
                            <Card mt="0">
                                <Cap>{vd.outcome} gained vs. {vd.feature}</Cap>
                                <AreaRange lo={vd.lo} mid={vd.mid} hi={vd.hi} tone="pos" xTicks={vd.xTicks} yTicks={vd.yTicks} marks={vd.marks.map((m): AreaMark => ({ at: Number(m.at), label: m.label, tone: m.tone }))} height={256} />
                            </Card>
                            <Box display="grid" gridTemplateColumns="1fr 1fr" gap="3" mt="3">
                                <Box layerStyle="card" p="3.5" borderRadius="lg">
                                    <Cap>Recommended</Cap>
                                    <Box display="flex" flexDirection="column" gap="0.5">
                                        <Text textStyle="caption.eyebrow">{vd.recoLabel}</Text>
                                        <Box display="flex" alignItems="baseline" gap="2">
                                            <Text textStyle="mono-kpi" fontFamily="heading" color="brand.solid">{signed(vd.recoEffect)}</Text>
                                            <Text textStyle="mono.sm" color="fg.muted">{vd.outcome} · {signed(vd.recoLo)} … {signed(vd.recoHi)}</Text>
                                        </Box>
                                    </Box>
                                    <Text textStyle="caption" mt="2.5" pt="2.5" borderTopWidth="1px" borderColor="border.subtle">{vd.tradeoff}</Text>
                                </Box>
                                <Box layerStyle="card" p="3.5" borderRadius="lg">
                                    <Cap>Extra {vd.outcome} per step</Cap>
                                    <Box py="0.5">{barList(vd.marginal.map((m, i) => ({ label: m.label, frac: m.frac, tone: i < 2 ? 'brand' : 'muted', value: signed(m.value) })))}</Box>
                                </Box>
                            </Box>
                        </Box>
                    )}
                </Box>
            </Box>

            {/* journal */}
            {journal && journal.length > 0 && (
                <>
                    <Box css={es.root} bg="bg.canvas" borderTopWidth="1px" borderColor="border.subtle">
                        <Box css={es.lbl}>Committed experiments</Box>
                        <Box css={es.meta}><Text as="span" color="fg.default" fontWeight="semibold">{journal.length}</Text> on record</Box>
                    </Box>
                    {journal.map((r, i) => (
                        <Box key={i} display="grid" gridTemplateColumns="2fr 1fr 1fr 1fr" gap="3" alignItems="center" px="4.5" py="2.5" borderTopWidth="1px" borderColor="border.subtle">
                            <Text textStyle="body.sm"><Text as="span" fontWeight="bold">{r.treatment} → {r.outcome}</Text> <Text as="span" color="fg.muted">· vs {r.confounders}</Text></Text>
                            <Text textStyle="mono.sm" fontWeight="semibold" textAlign="right" fontVariantNumeric="tabular-nums" color={r.verdictTone === 'pos' ? 'fg.success' : 'fg.default'}>{r.effect}</Text>
                            <Text textStyle="caption.eyebrow" textAlign="right" color={r.verdictTone === 'pos' ? 'fg.success' : 'fg.warning'}>{r.verdict}</Text>
                            <Text textStyle="mono.sm" textAlign="right" color="fg.muted">{r.who} · {r.when}</Text>
                        </Box>
                    ))}
                </>
            )}
        </Box>
    );
});

// ---------------------------------------------------------------------------
// Population filter rail — reuses Slice's predicate editor (the population is an
// Array<SlicePredicate>, the same type Slice's builder produces).
// ---------------------------------------------------------------------------
function FilterRail({ fields, population, onChange, chip, button }: {
    fields: SliceFieldValue[]; population: PredicateValue[]; onChange: (p: PredicateValue[]) => void;
    chip: ReturnType<typeof useRecipe>; button: ReturnType<typeof useRecipe>;
}) {
    const [open, setOpen] = useState<'add' | number | null>(null);
    const replaceAt = (i: number, p: PredicateValue) => onChange(population.map((f, j) => (j === i ? p : f)));
    const removeAt = (i: number) => onChange(population.filter((_, j) => j !== i));
    const done = <Box as="button" css={button({ variant: 'outline', size: 'xs' })} onClick={() => setOpen(null)}>Done</Box>;
    return (
        <Box display="flex" flexWrap="wrap" gap="1.5" alignItems="center">
            {population.map((pred, i) => (
                <SliceEditPopover key={i} open={open === i} onOpenChange={o => setOpen(o ? i : null)}
                    label={<>{'Edit · '}<Box as="span" fontFamily="mono" color="brand.fg">{(pred as { value: { fieldId: string } }).value.fieldId}</Box></>}
                    footActions={done}
                    trigger={
                        <Box css={chip({ tone: 'brand', numeric: true, shape: 'rounded' })} cursor="pointer" flexShrink={0}>
                            <Box as="span" whiteSpace="nowrap">{formatPredicate(pred)}</Box>
                            <Box as="button" display="inline-flex" alignItems="center" cursor="pointer" color="brand.fg" flexShrink="0" fontSize="10px" onClick={e => { e.stopPropagation(); removeAt(i); }} aria-label="Remove filter"><FontAwesomeIcon icon={faXmark} /></Box>
                        </Box>
                    }>
                    {open === i ? <SlicePredicateBuilder fields={fields} initial={pred} lockField submitLabel="Apply" onAdd={p => { replaceAt(i, p); setOpen(null); }} /> : null}
                </SliceEditPopover>
            ))}
            <SliceEditPopover open={open === 'add'} onOpenChange={o => setOpen(o ? 'add' : null)} label="Add filter" size="lg" footActions={done}
                trigger={<Box css={chip({ tone: 'dashed', numeric: true, shape: 'rounded' })} cursor="pointer" display="inline-flex" alignItems="center" gap="1.5"><Box as="span" fontSize="9px"><FontAwesomeIcon icon={faPlus} /></Box><Box as="span">filter</Box></Box>}>
                {open === 'add' ? <SlicePredicateBuilder fields={fields} onAdd={pred => { onChange([...population, pred]); setOpen(null); }} /> : null}
            </SliceEditPopover>
        </Box>
    );
}

// ---------------------------------------------------------------------------
// Set-up-rail controls (recipe + token based).
// ---------------------------------------------------------------------------
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
    return (
        <Box px="4.5" py="3" borderBottomWidth="1px" borderColor="border.subtle">
            <Box display="flex" alignItems="baseline" gap="2" mb="2">
                <Box as="span" fontFamily="mono" fontSize="9px" fontWeight="bold" color="fg.inverse" bg="brand.solid" w="16px" h="16px" borderRadius="full" display="inline-flex" alignItems="center" justifyContent="center" flex="0 0 auto">{n}</Box>
                <Text textStyle="title.row">{title}</Text>
            </Box>
            {children}
        </Box>
    );
}

/** A themed dropdown menu over a set of choices. */
function ColumnMenu({ choices, onPick, children }: { choices: string[]; onPick: (c: string) => void; children: ReactNode }) {
    return (
        <Menu.Root>
            <Menu.Trigger asChild>{children as never}</Menu.Trigger>
            <Portal>
                <Menu.Positioner>
                    <Menu.Content>
                        {choices.map(c => (
                            <Menu.Item key={c} value={c} onClick={() => onPick(c)}>{c}</Menu.Item>
                        ))}
                    </Menu.Content>
                </Menu.Positioner>
            </Portal>
        </Menu.Root>
    );
}

/** The column pick chip (Step 1 / 2) — a Menu trigger on the `button` recipe. */
function ColumnPick({ column, kind, choices, onPick, badge, button }: {
    column: string; kind: string; choices: string[]; onPick: (c: string) => void;
    badge: ReturnType<typeof useRecipe>; button: ReturnType<typeof useRecipe>;
}) {
    return (
        <ColumnMenu choices={choices} onPick={onPick}>
            <Box as="button" css={button({ variant: 'outline', size: 'sm' })} gap="1.5">
                <Text as="span" fontFamily="mono" fontWeight="semibold">{column}</Text>
                <Box as="span" css={badge({ variant: 'plain', size: 'sm' })} textTransform="none" letterSpacing="normal">{kind}</Box>
                <Box as="span" display="inline-flex" color="fg.muted" fontSize="10px"><FontAwesomeIcon icon={faChevronDown} /></Box>
            </Box>
        </ColumnMenu>
    );
}

/** A single-select segmented control built from the `segmentGroup` recipe. */
function SegmentSelect({ options, active, onPick, fill, size = 'sm' }: { options: string[]; active: number; onPick: (i: number) => void; fill?: boolean; size?: 'xs' | 'sm' }) {
    const s = useSlotRecipe({ key: 'segmentGroup' })({ size });
    return (
        <Box css={s.root} {...(fill ? { width: '100%' } : {})}>
            {options.map((o, i) => (
                <Box key={i} as="button" css={s.item} {...(fill ? { flex: '1' } : {})} {...(active === i ? { 'data-state': 'checked' } : {})} onClick={() => onPick(i)}>
                    <Box as="span" css={s.itemText}>{o}</Box>
                </Box>
            ))}
        </Box>
    );
}

/** A labelled two-segment toggle (Advanced rail rows). */
function Segmented({ label, left, right, active, onPick, last }: { label: string; left: string; right: string; active: 'left' | 'right'; onPick: (s: 'left' | 'right') => void; last?: boolean }) {
    return (
        <Box display="flex" flexDirection="column" alignItems="stretch" gap="1.5" py="2" borderBottomWidth={last ? '0' : '1px'} borderColor="border.subtle">
            <Text textStyle="caption.eyebrow" textTransform="none" letterSpacing="normal" color="fg.default">{label}</Text>
            <SegmentSelect options={[left, right]} active={active === 'left' ? 0 : 1} onPick={i => onPick(i === 0 ? 'left' : 'right')} fill size="xs" />
        </Box>
    );
}

implementUIComponent(Experiment.Component, EastChakraExperiment);

export { EastChakraExperiment };
