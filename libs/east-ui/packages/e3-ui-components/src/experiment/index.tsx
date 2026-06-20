/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React renderer for the `Experiment` causal-experiment surface.
 *
 * **Interactive and generic over the input row.** Binds an input dataset + a
 * staged config + ONE `experiment` function; introspects the dataset's row
 * struct to drive the treatment / outcome / confounder pickers, runs the bound
 * function on **Run** via the shared `Func.bind` runtime, and **derives** every
 * word / colour / bar from the single returned result + its honesty **verdict**.
 * Editing a picker stages a new config and marks the result stale; **Commit**
 * appends the verdict to the journal.
 *
 * The Answer tab switches on the verdict: `causal` / `modest` /
 * `adjustment_insufficient` show the numeric estimate (the engine produced an
 * `adjusted` effect); `non_identifiable_positivity` renders the propensity
 * overlap histogram and `not_estimable` the reason + evidence — both **refusals**
 * where `adjusted = none`.
 *
 * **Design-system native, like Decision.** No hand-rolled styles: shared recipes
 * (`button` / `barStrip` / `status` / `badge` / `chip` / `eyebrowRow` /
 * `segmentGroup`), layer styles (`frame` / `header.bar` / `card` /
 * `banner.stale`) and text styles. The population filter reuses Slice's
 * `SliceEditPopover` + `SlicePredicateBuilder` + `formatPredicate` and narrows
 * the rows UI-side before the call (population is not part of the config
 * contract). Charts are visx (see {@link "./charts"}).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Text, Menu, Portal, Spinner, useRecipe, useSlotRecipe } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp, faCheck, faChevronDown, faPlus, faTriangleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import { fromEastTypeValue, variant, some, none, equalFor, type EastType, type EastTypeValue, type ValueTypeOf } from '@elaraai/east';
import { Experiment } from '@elaraai/e3-ui/internal';
import {
    implementUIComponent,
    SlicePredicateBuilder, SliceEditPopover, formatPredicate,
    getSomeorUndefined,
    type SliceFieldValue, type PredicateValue,
} from '@elaraai/east-ui-components';

import { useBindingValue } from './bind-runtime.js';
import { useFuncCall, type FuncCallError } from './run-runtime.js';
import { getBindingTypes, getReactiveDatasetCache } from '../platform/index.js';
import { ForestPlot, AreaRange, OverlapHistogram } from './charts.js';
import { GuidanceProvider, GuidanceToggle, Help } from './help-ui.js';
import { type HelpId } from './help.js';
import {
    deriveView, deriveDesign,
    signed,
    type Column, type ConfigValue, type ResultValue, type JournalRowValue, type DesignValue, type VMDesign, type PresetValue,
} from './derive.js';

// The neutral noun for a row. `<Experiment>` is generic over any causal-analytics
// dataset, so the renderer never assumes a domain (customer / batch / patient / …)
// — `record(s)` reads correctly across all of them. Used in both the guidance
// glossary (via `helpVars`) and the rail's static prose.
const SUBJECT_ONE = 'record';
const SUBJECT_MANY = 'records';

// Each Run encodes + ships the full filtered dataset to the bound function, so a
// very large dataset shouldn't auto-run on mount (it would jank before the user
// has even framed the question) — past this row count we wait for an explicit Run.
const AUTORUN_MAX_ROWS = 50_000;

// Tone → semantic colour token (Box `bg` / Text `color`). Semantic roles, no hex.
const TONE_TOKEN: Record<string, string> = {
    neg: 'fg.danger', pos: 'fg.success', warn: 'fg.warning', muted: 'fg.muted', brand: 'brand.solid',
};
const toneToken = (t: string): string => TONE_TOKEN[t] ?? 'brand.solid';

// ---------------------------------------------------------------------------
// Payload decode + column introspection.
// ---------------------------------------------------------------------------
type ExperimentValueIR = ValueTypeOf<typeof Experiment.Component.schema>;
type Tab = 'answer' | 'trust' | 'dose' | 'validate';


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

// ---------------------------------------------------------------------------
// UI-side population filter — population is NOT part of the config contract; the
// FilterRail predicates narrow the rows here, before the experiment call. Safe
// by construction: an op we don't model keeps the row (never silently drops).
// ---------------------------------------------------------------------------
type Pred = { value: { fieldId: string; op: { type: string; value: unknown } } };
function rowMatchesAll(row: Record<string, unknown>, preds: PredicateValue[]): boolean {
    return preds.every(p => {
        const { fieldId, op } = (p as unknown as Pred).value;
        const v = row[fieldId];
        const ov = op.value;
        switch (op.type) {
            case 'eq': case 'is': return v === ov;
            case 'neq': return v !== ov;
            case 'lt': return num(v) != null && num(ov) != null ? num(v)! < num(ov)! : true;
            case 'lte': return num(v) != null && num(ov) != null ? num(v)! <= num(ov)! : true;
            case 'gt': return num(v) != null && num(ov) != null ? num(v)! > num(ov)! : true;
            case 'gte': return num(v) != null && num(ov) != null ? num(v)! >= num(ov)! : true;
            case 'in': return ov instanceof Set ? ov.has(v) : true;
            case 'notIn': return ov instanceof Set ? !ov.has(v) : true;
            default: return true; // between / before / after / contains / matches — keep (modelled UI-side later)
        }
    });
}
const num = (x: unknown): number | null => (typeof x === 'number' ? x : typeof x === 'bigint' ? Number(x) : null);

// ---------------------------------------------------------------------------
// Small presentational helpers (text-style / layer-style based).
// ---------------------------------------------------------------------------

/** Mono uppercase eyebrow caption for a card section (design `.xp-cap`). */
function Cap({ children, help }: { children: ReactNode; help?: HelpId }) {
    return <Text textStyle="caption.eyebrow" fontSize="9px" mb="2.5">{help ? <Help id={help}>{children}</Help> : children}</Text>;
}

/** A section card (the `.frame`-inset cards in the result deck). */
function Card({ children, mt = '3' }: { children: ReactNode; mt?: string }) {
    return <Box layerStyle="card" p="3.5" borderRadius="lg" mt={mt}>{children}</Box>;
}

/** The failure detail of a failed `experiment` run — the runner outcome message
 *  plus the captured stderr/stdout tail (so a silent failure, e.g. a missing
 *  runner, is visible in the surface instead of "nothing happens"). */
function RunError({ error }: { error: FuncCallError }) {
    const tail = (error.stderr || error.stdout || '').trim().split('\n').slice(-12).join('\n');
    return (
        <Box layerStyle="banner.stale" display="flex" flexDirection="column" gap="2" mt="3">
            <Box display="inline-flex" alignItems="flex-start" gap="2" color="fg.danger">
                <Box as="span" mt="0.5" fontSize="12px" flexShrink="0"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>
                <Text textStyle="body.sm" color="fg.default"><Text as="span" fontWeight="bold">Could not run the experiment.</Text> {error.message}</Text>
            </Box>
            {tail && (
                <Box as="pre" m="0" p="2" maxH="160px" overflow="auto" bg="bg.canvas" borderRadius="md" borderWidth="1px" borderColor="border.subtle"
                    fontFamily="mono" fontSize="11px" color="fg.muted" whiteSpace="pre-wrap">{tail}</Box>
            )}
        </Box>
    );
}

/** A header action button (Run / Commit). */
function ActionButton({ button, variant, label, onClick, disabled, pulse = false }: {
    button: ReturnType<typeof useRecipe>;
    variant: 'solid' | 'ghost'; label: string; onClick: () => void; disabled: boolean; pulse?: boolean;
}) {
    return (
        <Box as="button" css={button({ variant, size: 'sm' })}
            onClick={disabled ? undefined : onClick} aria-disabled={disabled || undefined}
            opacity={disabled ? 0.5 : undefined} cursor={disabled ? 'not-allowed' : 'pointer'}
            animation={pulse && !disabled ? 'pulse 1.6s infinite' : undefined}>
            {label}
        </Box>
    );
}

/** A per-tab shimmer placeholder shown while a (re-)run is in flight, so the deck
 *  never asserts the previous result as current. Built from the shared `skeleton`
 *  recipe (line / block variants) — the single "result not ready" vocabulary. */
function DeckSkeleton({ tab }: { tab: Tab }) {
    const sk = useRecipe({ key: 'skeleton' });
    const bar = (w: string, h: string) => <Box css={sk({ variant: 'line' })} width={w} height={h} />;
    const block = (h: string) => <Box css={sk({ variant: 'block' })} width="100%" minHeight={h} />;
    return (
        <Box p="4.5" display="flex" flexDirection="column" gap="4">
            {tab === 'answer' && (
                <>
                    <Box display="flex" gap="4.5" alignItems="flex-end">
                        <Box display="flex" flexDirection="column" gap="2">{bar('64px', '10px')}{bar('120px', '32px')}</Box>
                        {bar('170px', '24px')}
                    </Box>
                    {block('120px')}
                    {block('120px')}
                </>
            )}
            {tab === 'trust' && (<>{bar('70%', '14px')}{block('160px')}</>)}
            {tab === 'dose' && (
                <>
                    {block('240px')}
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gap="3">{block('90px')}{block('90px')}</Box>
                </>
            )}
            {tab === 'validate' && (
                <>
                    <Box display="flex" gap="5" alignItems="flex-end">{bar('120px', '32px')}{bar('200px', '10px')}</Box>
                    {block('110px')}
                    {block('150px')}
                </>
            )}
        </Box>
    );
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------
export interface EastChakraExperimentProps {
    value: ExperimentValueIR;
    storageKey: string;
}

// Structural equality over the decoded payload — the MANDATORY memo+equalFor rule
// (east-ui-components/CLAUDE.md). The payload is all data structs (binding
// descriptors {name}, diff handles), so equalFor compares cleanly.
const experimentValueEqual = equalFor(Experiment.Component.schema);

const EastChakraExperiment = memo(function EastChakraExperiment({ value }: EastChakraExperimentProps) {
    const v = value as unknown as ValueTypeOf<typeof Experiment.Types.Payload>;

    // Recipes — acquired once (the call-once / spread-slot idiom).
    const button = useRecipe({ key: 'button' });
    const chip = useRecipe({ key: 'chip' });
    const badge = useRecipe({ key: 'badge' });
    const bs = useSlotRecipe({ key: 'barStrip' })({});
    const statusR = useSlotRecipe({ key: 'status' });
    const es = useSlotRecipe({ key: 'eyebrowRow' })({});

    const workspace = getReactiveDatasetCache().getConfig().workspace ?? '';
    const data = useBindingValue<Record<string, unknown>[]>(v.data as never);
    const configBind = useBindingValue<ConfigValue>(v.config as never);
    const journalBind = useBindingValue<JournalRowValue[]>(v.journal.type === 'some' ? (v.journal.value as never) : null);
    const populationBind = useBindingValue<PredicateValue[]>(v.population.type === 'some' ? (v.population.value as never) : null);
    const meta = getSomeorUndefined(v.columnMeta);
    const readonly = getSomeorUndefined(v.readonly) ?? false;
    // Developer-authored presets (a header dropdown) + which one is currently loaded — the
    // staged spec's provenance, cleared the moment a picker edits a field away from it.
    const presets = useMemo(() => getSomeorUndefined(v.presets) ?? [], [v.presets]);
    const [currentPreset, setCurrentPreset] = useState<string | undefined>(undefined);
    // Bucket presets by their optional `group`, preserving first-appearance order
    // (ungrouped presets fall under one default section header).
    const presetGroups = useMemo(() => {
        const buckets = new Map<string, PresetValue[]>();
        for (const p of presets) {
            const label = getSomeorUndefined(p.group) ?? 'Saved questions';
            const bucket = buckets.get(label);
            if (bucket) bucket.push(p); else buckets.set(label, [p]);
        }
        return [...buckets].map(([label, items]) => ({ label, items }));
    }, [presets]);

    const { columns, rowArrayType } = useColumns(workspace, v.data.source);
    const config = configBind.value;

    // Population is UI-side — staged in its own bound dataset when one is bound
    // (so a surface can seed / persist / commit framing filters), else a transient
    // local fallback. It NEVER enters the config the experiment function receives;
    // it only narrows the rows passed to the call.
    const [localPop, setLocalPop] = useState<PredicateValue[]>([]);
    const population = populationBind.value ?? localPop;
    const filteredRows = useMemo(() => {
        if (!data.value) return null;
        return population.length ? data.value.filter(r => rowMatchesAll(r, population)) : data.value;
    }, [data.value, population]);

    // Filterable fields for the Slice predicate builder.
    const fields = useMemo<SliceFieldValue[]>(
        () => columns.filter(c => c.kind !== 'other').map(c => ({
            fieldId: c.name, label: getSomeorUndefined(meta?.get(c.name)?.label) ?? c.name, kind: c.kind,
        }) as SliceFieldValue),
        [columns, meta],
    );

    const estInputs = useMemo(() => (rowArrayType ? [rowArrayType, Experiment.Types.Config] : null), [rowArrayType]);
    const experiment = useFuncCall<ResultValue>(v.experiment.name, estInputs, Experiment.Types.Result);

    // The optional `design` function (the "Validate" tab) — bound only when the
    // surface supplies it; called lazily the first time the tab is opened.
    const hasDesign = v.design.type === 'some';
    const designInputs = useMemo(
        () => (rowArrayType ? [rowArrayType, Experiment.Types.Config, Experiment.Types.Result, Experiment.Types.DesignConfig] : null),
        [rowArrayType],
    );
    const design = useFuncCall<DesignValue>(v.design.type === 'some' ? v.design.value.name : null, designInputs, Experiment.Types.Design);

    // The result deck reflects the config that produced the CURRENT result, not
    // live edits — captured at call time, promoted when the result lands (below),
    // so editing a Step-1/2 picker doesn't rewrite the result strings before Run.
    const pendingConfigRef = useRef<ConfigValue | null>(null);
    const [ranConfig, setRanConfig] = useState<ConfigValue | null>(null);

    const runAll = useCallback(() => {
        if (!filteredRows || !config) return;
        pendingConfigRef.current = config;
        experiment.call(filteredRows, config);
    }, [filteredRows, config, experiment]);

    // Auto-run once, the first time inputs are ready and nothing has produced a
    // result yet. Latched by `autoRan` — it fires at most once and intentionally
    // does NOT self-heal a failed first run (the user hits Run to retry), so the
    // surface never silently re-runs behind a manual edit.
    const autoRan = useRef(false);
    useEffect(() => {
        if (autoRan.current) return;
        if (!filteredRows || !config || !rowArrayType) return;
        if (experiment.result !== null || experiment.status === 'running') { autoRan.current = true; return; }
        if (experiment.status !== 'idle') return;
        autoRan.current = true;
        if (filteredRows.length > AUTORUN_MAX_ROWS) return; // too large to auto-run — wait for explicit Run
        runAll();
    }, [filteredRows, config, rowArrayType, experiment.result, experiment.status, runAll]);

    // Promote the pending config to the "ran" config when a result lands, so the
    // result deck's labels change together with its numbers — never on live edits.
    useEffect(() => {
        if (experiment.result !== null) setRanConfig(pendingConfigRef.current);
    }, [experiment.result]);

    const [stale, setStale] = useState(false);
    // Defer the East-side staged write out of the React event (interactive-state
    // rule); the staged store's useSyncExternalStore drives the re-render.
    const editConfig = useCallback((next: ConfigValue, fromPreset?: string) => {
        if (readonly) return; // never write through in readonly, even in direct mode
        setStale(true);
        // A picker edit passes no `fromPreset` → clears the provenance; a preset
        // selection passes its id → records it (until the next manual edit).
        setCurrentPreset(fromPreset);
        queueMicrotask(() => configBind.mutate(next));
    }, [readonly, configBind]);
    const editPopulation = useCallback((next: PredicateValue[], fromPreset?: string) => {
        if (readonly) return;
        setStale(true);
        // The scope is part of a preset's pinned identity, so a manual scope edit (no
        // `fromPreset`) drops the provenance just like a manual config edit does.
        setCurrentPreset(fromPreset);
        if (v.population.type === 'some') queueMicrotask(() => populationBind.mutate(next));
        else setLocalPop(next);
    }, [readonly, v.population.type, populationBind]);
    // Selecting a preset snaps the staged spec + scope to its pre-baked configuration;
    // both stay editable before Run, and Commit records the originating preset id.
    const selectPreset = useCallback((p: PresetValue) => {
        if (readonly) return;
        editConfig(p.config, p.id);
        editPopulation(getSomeorUndefined(p.population) ?? [], p.id);
    }, [readonly, editConfig, editPopulation]);
    const onRun = useCallback(() => { runAll(); setStale(false); }, [runAll]);
    const onCommit = useCallback(async () => {
        if (!config || !experiment.result) return;
        const r = experiment.result;
        const row: JournalRowValue = {
            config, verdict: r.verdict, naive: r.naive,
            adjusted: r.adjusted.type === 'some' ? some(r.adjusted.value.effect) : none,
            committed_at: new Date(), committed_by: 'you',
            // Record which preset framed this experiment (none for a free-form run).
            preset: currentPreset !== undefined ? some(currentPreset) : none,
        };
        journalBind.mutate([row, ...(journalBind.value ?? [])]);
        try {
            await journalBind.commit();
            await configBind.commit();
            if (v.population.type === 'some') await populationBind.commit();
            setStale(false);
        } catch { /* surface left stale; a commit failed */ }
    }, [config, experiment.result, journalBind, configBind, populationBind, v.population.type, currentPreset]);

    const [tab, setTab] = useState<Tab>(getSomeorUndefined(v.defaultTab)?.type ?? 'answer');
    const [guidance, setGuidance] = useState(true);
    const now = useMemo(() => new Date(), []);
    const nRows = filteredRows?.length ?? 0;

    // The nouns the guidance glossary interpolates — the result deck's column
    // names (ran config), run through the friendly `columns` labels. `subject` /
    // `subjects` is the neutral noun for a row: the component is generic over any
    // causal-analytics dataset (customers, batches, patients, transactions …), so
    // we never assume a domain — `record(s)` reads correctly for all of them.
    const helpVars = useMemo(() => {
        const rc = ranConfig ?? config;
        const labelOf = (col: string | undefined) => (col ? (getSomeorUndefined(meta?.get(col)?.label) ?? col) : '');
        return { treatment: labelOf(rc?.treatment), outcome: labelOf(rc?.outcome), subject: SUBJECT_ONE, subjects: SUBJECT_MANY };
    }, [ranConfig, config, meta]);

    const view = useMemo(() => {
        if (!config) return null;
        return deriveView(config, ranConfig ?? config, columns, experiment.result, journalBind.value, meta, nRows, now);
    }, [config, ranConfig, columns, experiment.result, journalBind.value, meta, nRows, now]);

    // Default design knobs — library-defaulted alpha/power/materiality, and offer
    // both an even split and a cost-saving 30% split so the alternate row shows.
    // Variants MUST be built with `some`/`none`/`variant` (they carry the symbol
    // the encoder needs) — never hand-rolled `{ type, value }` literals.
    const designConfigValue = useMemo(() => ({
        alpha: none,
        target_power: none,
        materiality: none,
        treated_shares: some([0.5, 0.3]),
    }), []);

    // The Validate tab's `design` runs LAZILY — on first open, and again whenever a
    // fresh result lands. We snapshot the result + config the design was sized for
    // at call time, so the recipe is always derived against ITS OWN generation and
    // never fused with a newer result while the second async hop is in flight.
    const designSnapRef = useRef<{ result: ResultValue; config: ConfigValue } | null>(null);
    useEffect(() => {
        if (tab !== 'validate' || !hasDesign || design.pending) return;
        if (!filteredRows || !config || !experiment.result) return;
        if (designSnapRef.current?.result === experiment.result) return;
        designSnapRef.current = { result: experiment.result, config: ranConfig ?? config };
        design.call(filteredRows, ranConfig ?? config, experiment.result, designConfigValue);
    }, [tab, hasDesign, filteredRows, config, ranConfig, experiment.result, design, designConfigValue]);

    // Derive against the SNAPSHOT (the result design.result is for), not the live
    // result — closes the cross-generation fusion at source.
    const vmDesign = useMemo(
        () => (design.result && designSnapRef.current ? deriveDesign(design.result, designSnapRef.current.result, designSnapRef.current.config, meta) : null),
        [design.result, meta],
    );
    // The design in hand corresponds to the CURRENT result (not a stale generation)
    // and is settled — the only state in which the Validate panel may paint.
    const designFresh = design.result !== null && designSnapRef.current?.result === experiment.result && !design.pending;

    if (!config || !view) {
        const failed = experiment.status === 'failed';
        // A binding that failed to read/decode (rather than one still loading) gets
        // surfaced as an error — never a perpetual "loading" spinner. Name the dataset
        // so a type-version mismatch is diagnosable from the surface itself.
        const which = data.error ? 'dataset' : configBind.error ? 'config' : journalBind.error ? 'journal' : populationBind.error ? 'population filter' : null;
        const bindError = data.error ?? configBind.error ?? journalBind.error ?? populationBind.error;
        const bindMsg = bindError instanceof Error ? bindError.message : bindError != null ? String(bindError) : null;
        return (
            <Box layerStyle="frame" p="6">
                {bindMsg
                    ? <Text textStyle="body.sm" color="fg.danger">Couldn’t load the experiment {which}: {bindMsg}</Text>
                    : failed && experiment.error
                        ? <RunError error={experiment.error} />
                        : <Text className={failed ? undefined : 'elara-skeleton'} textStyle="body.sm" color="fg.muted">{failed ? 'Could not run the experiment.' : 'Loading experiment…'}</Text>}
            </Box>
        );
    }
    const { spec: vs, answer: a, refusal: ref, overlap: ov, refute: vr, dose: vd, journal, verdict } = view;

    const higherBetter = getSomeorUndefined(meta?.get(vs.outcome)?.higherIsBetter);

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

    // Run / Commit affordances derive from `readonly`, live state, and the
    // binding configuration (Commit only means something when config is bound
    // `{ mode: 'staged' }` and a `journal` is bound).
    const specStaged = configBind.mode === 'staged';
    const hasJournal = v.journal.type === 'some';
    const canRun = !readonly;
    const canCommit = !readonly && specStaged && hasJournal;

    const runDisabled = !data.value || experiment.pending;
    // Commit only a FRESH, succeeded, un-edited result — never journal a stale or
    // failed run against the current config.
    const commitDisabled = experiment.status !== 'succeeded' || experiment.pending || stale;

    // The single display-readiness discriminator the whole deck routes through:
    // a failed run shows the error (not stale numbers); a pending (re-)run shows the
    // skeleton; only a settled result paints the tabs.
    const failed = experiment.status === 'failed' && experiment.error;
    const showResult = experiment.result !== null && !experiment.pending && !failed;

    // The visible result tabs (Validate only when a `design` function is bound) —
    // shared by the tablist render and its roving keyboard navigation.
    const tabKeys: Tab[] = [...(['answer', 'trust', 'dose'] as Tab[]), ...(hasDesign ? ['validate' as Tab] : [])];

    return (
        <GuidanceProvider on={guidance} vars={helpVars}>
        <Box layerStyle="frame" overflow="visible">
            {/* header */}
            <Box layerStyle="header.bar" display="flex" alignItems="center" gap="3.5">
                {/* The title IS the question selector (spec #79, GitHub-repo-picker style): when
                    presets exist, the header text + a chevron open a menu of vetted questions
                    (current one checked). Selecting one snaps the staged spec + scope to that
                    pre-baked config (still editable before Run); a committed result records it. */}
                {presets.length > 0 && !readonly ? (
                    <Menu.Root>
                        <Menu.Trigger asChild>
                            <Box as="button" bg="transparent" border="0" p="0" cursor="pointer" display="inline-flex" alignItems="center" gap="2" textAlign="start">
                                <Text textStyle="title.card" color="fg.muted">
                                    Does&nbsp;<Text as="span" color="brand.solid" fontWeight="bold">{vs.treatment}</Text>&nbsp;change&nbsp;<Text as="span" color="brand.solid" fontWeight="bold">{vs.outcome}</Text>?
                                </Text>
                                <Box as="span" color="fg.subtle" fontSize="11px" lineHeight="1"><FontAwesomeIcon icon={faChevronDown} /></Box>
                            </Box>
                        </Menu.Trigger>
                        <Portal>
                            <Menu.Positioner>
                                <Menu.Content minW="280px">
                                    {presetGroups.map(g => (
                                        <Menu.ItemGroup key={g.label}>
                                            {g.label !== 'Saved questions' && (
                                                <Menu.ItemGroupLabel textStyle="caption.eyebrow" fontSize="9px">{g.label}</Menu.ItemGroupLabel>
                                            )}
                                            {g.items.map(p => (
                                                <Menu.Item key={p.id} value={p.id} onClick={() => selectPreset(p)} gap="2">
                                                    <Box as="span" width="14px" flexShrink="0" color="brand.fg">
                                                        {p.id === currentPreset && <FontAwesomeIcon icon={faCheck} style={{ fontSize: '10px' }} />}
                                                    </Box>
                                                    {p.label}
                                                </Menu.Item>
                                            ))}
                                        </Menu.ItemGroup>
                                    ))}
                                </Menu.Content>
                            </Menu.Positioner>
                        </Portal>
                    </Menu.Root>
                ) : (
                    <Text textStyle="title.card" color="fg.muted">
                        <Help id="header">Does&nbsp;<Text as="span" color="brand.solid" fontWeight="bold">{vs.treatment}</Text>&nbsp;change&nbsp;<Text as="span" color="brand.solid" fontWeight="bold">{vs.outcome}</Text>?</Help>
                    </Text>
                )}
                <Box flex="1" />
                <Box as="span" css={dataStatus.root}>
                    <Box as="span" css={dataStatus.indicator} />
                    <Box as="span" css={dataStatus.label}>{stale ? `${nRows} rows` : vs.dataLabel}</Box>
                </Box>
                <GuidanceToggle on={guidance} onToggle={() => setGuidance(g => !g)} />
                {canRun && <ActionButton button={button} variant="solid" label="Run" onClick={onRun} disabled={runDisabled} pulse={stale} />}
                {canCommit && <ActionButton button={button} variant="ghost" label="Commit" onClick={onCommit} disabled={commitDisabled} />}
            </Box>

            <Box display="grid" gridTemplateColumns="304px minmax(0,1fr)" alignItems="start">
                {/* set-up rail */}
                <Box borderRightWidth="1px" borderColor="border.subtle">
                    <Step n={1} title="What did you change?" help="step_treatment">
                        <ColumnPick column={vs.treatment} kind={vs.treatmentKind} badge={badge} button={button} choices={columns.filter(c => c.kind === 'boolean' || c.kind === 'integer').map(c => c.name)} onPick={c => editConfig({ ...config, treatment: c })} />
                        <Text textStyle="caption" mt="1.5">Treated = <Text as="span" color="fg.default" fontWeight="semibold">{vs.comparison}</Text></Text>
                    </Step>
                    <Step n={2} title="What did you want it to improve?" help="step_outcome">
                        <ColumnPick column={vs.outcome} kind={vs.outcomeKind} badge={badge} button={button} choices={columns.filter(c => c.kind === 'float' || c.kind === 'integer').map(c => c.name)} onPick={c => editConfig({ ...config, outcome: c })} />
                    </Step>
                    <Step n={3} title="What else was different?" help="step_confounders">
                        <Box layerStyle="frame.flat">
                            <Box maxH="216px" overflowY="auto">
                            {vs.confounders.map((c, i) => (
                                <Box key={i} display="grid" gridTemplateColumns="1fr 78px 16px" gap="2.5" alignItems="center" px="2.5" py="2.5" borderTopWidth={i ? '1px' : '0'} borderColor="border.subtle">
                                    <Box>
                                        <Text textStyle="mono.sm" fontWeight="semibold" color="fg.default">{c.col}</Text>
                                        <Text textStyle="caption" lineHeight="1.35" mt="px">{c.reason}</Text>
                                    </Box>
                                    <Box>
                                        <Box css={bs.track}><Box css={bs.fill} width={`${Math.round(c.imbalance * 100)}%`} bg={toneToken(c.tone)} /></Box>
                                        <Text textStyle="caption.eyebrow" fontSize="9px" textAlign="center" mt="1.5"><Help id="confounder_imbalance">{c.level}</Help></Text>
                                    </Box>
                                    <Box as="button" css={button({ variant: 'ghost', size: 'xs' })} px="0" minW="16px" display="inline-flex" alignItems="center" justifyContent="center" aria-label={`Remove ${c.col}`} onClick={() => editConfig({ ...config, common_causes: config.common_causes.filter(x => x !== c.col), categorical: config.categorical.type === 'some' ? some(config.categorical.value.filter(x => x !== c.col)) : none })}><FontAwesomeIcon icon={faXmark} style={{ fontSize: '11px' }} /></Box>
                                </Box>
                            ))}
                            </Box>
                            {vs.suggestion && (
                                <ColumnMenu choices={columns.filter(c => !new Set([config.treatment, config.outcome, ...config.common_causes]).has(c.name)).map(c => c.name)} onPick={c => editConfig({ ...config, common_causes: [...config.common_causes, c] })}>
                                    <Box as="button" css={button({ variant: 'ghost', size: 'sm' })} justifyContent="flex-start" width="100%" color="brand.fg" fontFamily="mono" display="inline-flex" alignItems="center" gap="2"><FontAwesomeIcon icon={faPlus} style={{ fontSize: '9px' }} />add another</Box>
                                </ColumnMenu>
                            )}
                        </Box>
                    </Step>
                    <Step n={4} title={`Which ${SUBJECT_MANY}?`} help="step_population">
                        <FilterRail fields={fields} population={population} onChange={editPopulation} chip={chip} button={button} />
                    </Step>
                    <Box as="details" borderTopWidth="1px" borderColor="border.subtle">
                        <Box as="summary" textStyle="caption.eyebrow" cursor="pointer" px="4.5" py="2.5" display="flex" alignItems="center" gap="1.5"
                             css={{ listStyle: 'none', '&::-webkit-details-marker': { display: 'none' } }}>
                            <Box as="span" display="inline-flex" color="fg.subtle" fontSize="10px" transition="transform 180ms ease" transform="rotate(-90deg)"
                                 css={{ 'details[open] > summary > &': { transform: 'rotate(0deg)' } }}><FontAwesomeIcon icon={faChevronDown} /></Box>
                            Advanced
                        </Box>
                        <Box px="4.5" pb="3.5" pt="0.5">
                            <Segmented label="How to compare" help="adv_method" left="regression" right="reweighting" active={vs.method === 'reweighting' ? 'right' : 'left'} onPick={s => editConfig({ ...config, method: some(s === 'right' ? variant('propensity_score_weighting', { weighting_scheme: none }) : variant('linear_regression', null)) } as unknown as ConfigValue)} />
                            <Segmented label="Answer for" help="adv_estimand" left="all" right="only treated" active={vs.target === 'treated' ? 'right' : 'left'} onPick={s => editConfig({ ...config, estimand: some(variant(s === 'right' ? 'att' : 'ate', null)) } as unknown as ConfigValue)} last />
                        </Box>
                    </Box>
                </Box>

                {/* result deck */}
                <Box minW="0">
                    <Box display="flex" alignItems="center" px="4" borderBottomWidth="1px" borderColor="border.subtle"
                        role="tablist" aria-label="Result views"
                        onKeyDown={(e) => {
                            const i = tabKeys.indexOf(tab);
                            let j = i;
                            if (e.key === 'ArrowRight') j = (i + 1) % tabKeys.length;
                            else if (e.key === 'ArrowLeft') j = (i - 1 + tabKeys.length) % tabKeys.length;
                            else if (e.key === 'Home') j = 0;
                            else if (e.key === 'End') j = tabKeys.length - 1;
                            else return;
                            e.preventDefault();
                            setTab(tabKeys[j]!);
                            const btns = e.currentTarget.querySelectorAll('[role="tab"]');
                            (btns[j] as HTMLElement | undefined)?.focus();
                        }}>
                        {tabKeys.map(tk => {
                            const on = tab === tk;
                            const tabHelp: HelpId = tk === 'answer' ? 'tab_answer' : tk === 'trust' ? 'tab_trust' : tk === 'dose' ? 'tab_dose' : 'tab_validate';
                            const tabLabel = tk === 'answer' ? 'Answer' : tk === 'trust' ? 'Trust' : tk === 'dose' ? 'Dose' : 'Validate';
                            return (
                                <Box key={tk} as="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
                                    onClick={() => setTab(tk)} cursor="pointer"
                                    fontSize="xs" fontWeight="semibold" px="3.5" py="3" mb="-1px"
                                    color={on ? 'brand.fg' : 'fg.muted'}
                                    borderBottomWidth="2px" borderColor={on ? 'brand.solid' : 'transparent'}
                                    _hover={{ color: on ? 'brand.fg' : 'fg.default' }}
                                    _focusVisible={{ outline: '2px solid', outlineColor: 'brand.solid', outlineOffset: '-2px' }}>
                                    <Help id={tabHelp}>{tabLabel}</Help>
                                </Box>
                            );
                        })}
                        {experiment.pending && (
                            <Box ml="auto" display="inline-flex" alignItems="center" gap="2" color="fg.muted" pr="1">
                                <Spinner size="xs" borderWidth="1.5px" color="brand.solid" />
                                <Text textStyle="caption.eyebrow">Running…</Text>
                            </Box>
                        )}
                    </Box>

                    {failed ? (
                        <Box px="4.5" pt="4.5"><RunError error={experiment.error!} /></Box>
                    ) : !showResult ? (
                        <DeckSkeleton tab={tab} />
                    ) : (
                    <>
                    {stale && (
                        <Box layerStyle="banner.stale" display="flex" alignItems="center" gap="2" mx="4.5" mt="4.5">
                            <Box as="span" color="fg.warning" flexShrink="0" fontSize="12px"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>
                            <Text textStyle="body.sm" color="fg.default"><Text as="span" fontWeight="bold">Showing the previous setup.</Text> Hit Run to update these results for your edits.</Text>
                        </Box>
                    )}

                    {tab === 'answer' && a && (
                        <AnswerNumeric a={a} verdict={verdict} higherBetter={higherBetter} badge={badge} barList={barList} />
                    )}
                    {tab === 'answer' && !a && ref && (
                        <RefusalZone refusal={ref} overlap={ov} naiveValue={experiment.result?.naive ?? 0} outcome={vs.outcome} />
                    )}

                    {tab === 'trust' && vr && (
                        <Box p="4.5">
                            <Text textStyle="body.sm" color="fg.muted" mb="3.5"><Help id="trust_intro">Before trusting the answer we tried to break it — colour shows pass / caution.</Help></Text>
                            <Box layerStyle="frame.flat">
                                {vr.checks.map((c, i) => {
                                    const cs = statusR({ status: c.passed ? 'success' : 'warning', size: 'sm' });
                                    return (
                                        <Box key={i} display="grid" gridTemplateColumns="auto 1fr minmax(96px,auto)" gap="2.5" alignItems="start" px="3.5" py="2.5" borderTopWidth={i ? '1px' : '0'} borderColor="border.subtle">
                                            <Box as="span" css={cs.root} mt="1"><Box as="span" css={cs.indicator} /></Box>
                                            <Box>
                                                <Text textStyle="body.sm" fontWeight="semibold" color="fg.default"><Help id={c.help}>{c.name}</Help></Text>
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
                            {vr.sens && (
                                <Card>
                                    <Cap help="sensitivity">Effect as a hidden cause is made stronger</Cap>
                                    <AreaRange lo={vr.sens.lo} mid={vr.sens.mid} hi={vr.sens.hi} zero={0} tone="brand" xTicks={vr.sens.xTicks} yTicks={vr.sens.yTicks} height={132} />
                                </Card>
                            )}
                        </Box>
                    )}
                    {tab === 'trust' && !vr && (
                        <Box p="4.5">
                            <Box display="inline-flex" alignItems="center" gap="2" mb="2" color="fg.muted">
                                <FontAwesomeIcon icon={faTriangleExclamation} style={{ fontSize: '13px' }} />
                                <Text textStyle="body.sm" fontWeight="semibold" color="fg.default">Nothing to stress-test</Text>
                            </Box>
                            <Text textStyle="body.sm" color="fg.muted" lineHeight="1.5">There’s no adjusted estimate to try to break — the experiment couldn’t produce one (see the <Text as="span" fontWeight="semibold" color="fg.default">Answer</Text> tab for why).</Text>
                        </Box>
                    )}

                    {tab === 'dose' && vd && (
                        <Box p="4.5">
                            <Card mt="0">
                                <Cap help="dose_curve">{vd.outcome} gained vs. {vd.feature}</Cap>
                                <AreaRange lo={vd.lo} mid={vd.mid} hi={vd.hi} tone="pos" xTicks={vd.xTicks} yTicks={vd.yTicks} marks={vd.marks.map(m => ({ at: m.at, label: m.label, tone: m.tone, help: m.help }))} height={256} />
                            </Card>
                            <Box display="grid" gridTemplateColumns="1fr 1fr" gap="3" mt="3">
                                <Box layerStyle="card" p="3.5" borderRadius="lg">
                                    <Cap help="dose_reco">Recommended</Cap>
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
                                    <Cap help="dose_marginal">Extra {vd.outcome} per step</Cap>
                                    <Box py="0.5" maxH="200px" overflowY="auto">{barList(vd.marginal.map((m, i) => ({ label: m.label, frac: m.frac, tone: i < 2 ? 'brand' : 'muted', value: signed(m.value) })))}</Box>
                                </Box>
                            </Box>
                        </Box>
                    )}

                    {tab === 'validate' && (
                        design.status === 'failed' && design.error
                            ? <Box px="4.5" pt="4.5"><RunError error={design.error} /></Box>
                            : designFresh && vmDesign
                                ? <ValidatePanel vm={vmDesign} barList={barList} />
                                : (
                                    <Box p="4.5" display="inline-flex" alignItems="center" gap="2" color="fg.muted">
                                        <Spinner size="xs" borderWidth="1.5px" color="brand.solid" />
                                        <Text textStyle="body.sm">Sizing the trial that would confirm this…</Text>
                                    </Box>
                                )
                    )}
                    </>
                    )}
                </Box>
            </Box>

            {/* journal */}
            {journal && journal.length > 0 && (
                <>
                    <Box css={es.root} bg="bg.canvas" borderTopWidth="1px" borderColor="border.subtle">
                        <Box css={es.lbl}><Help id="journal">Committed experiments</Help></Box>
                        <Box css={es.meta}><Text as="span" color="fg.default" fontWeight="semibold">{journal.length}</Text> on record{journal.length > 50 ? ' · showing newest 50' : ''}</Box>
                    </Box>
                    {journal.slice(0, 50).map((r, i) => (
                        <Box key={i} display="grid" gridTemplateColumns="2fr 1fr 1fr 1fr" gap="3" alignItems="center" px="4.5" py="2.5" borderTopWidth="1px" borderColor="border.subtle">
                            <Text textStyle="body.sm"><Text as="span" fontWeight="bold">{r.treatment} → {r.outcome}</Text> <Text as="span" color="fg.muted">· vs {r.confounders}</Text>{(() => {
                                const id = getSomeorUndefined(r.preset);
                                if (id === undefined) return null;
                                const label = presets.find(p => p.id === id)?.label ?? id;
                                return <>{' '}<Box as="span" css={chip({ tone: 'brand', size: 'sm' })}>from {label}</Box></>;
                            })()}</Text>
                            <Text textStyle="mono.sm" fontWeight="semibold" textAlign="right" fontVariantNumeric="tabular-nums" color={r.verdictTone === 'pos' ? 'fg.success' : 'fg.default'}>{r.effect}</Text>
                            <Text textStyle="caption.eyebrow" textAlign="right" color={toneToken(r.verdictTone)}>{r.verdict}</Text>
                            <Text textStyle="mono.sm" textAlign="right" color="fg.muted">{r.who} · {r.when}</Text>
                        </Box>
                    ))}
                </>
            )}
        </Box>
        </GuidanceProvider>
    );
}, (prev, next) => experimentValueEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

// ---------------------------------------------------------------------------
// Answer tab — numeric (the engine produced an adjusted estimate).
// ---------------------------------------------------------------------------
function AnswerNumeric({ a, verdict, higherBetter, badge, barList }: {
    a: NonNullable<ReturnType<typeof deriveView>['answer']>;
    verdict: ReturnType<typeof deriveView>['verdict'];
    higherBetter: boolean | undefined;
    badge: ReturnType<typeof useRecipe>;
    barList: (rows: { label: string; frac: number; tone: string; value: string }[]) => ReactNode;
}) {
    const dirUp = a.effect > 0;
    const statusWord = higherBetter === undefined ? (dirUp ? 'Higher' : 'Lower') : (dirUp === higherBetter ? 'Better' : 'Worse');
    const lowerWord = a.naive < 0 ? 'lower' : 'higher';
    const top = a.balance[0] ?? { col: '', display: '' };
    const kpiColor = a.clear && !a.cautious ? 'fg.success' : 'fg.warning';
    const badgeOk = a.clear && !a.cautious;
    const badgeText = a.cautious ? (verdict?.label ?? 'Not trustworthy yet') : a.clear ? `${statusWord} with ${a.treatment}` : 'No clear effect';
    return (
        <Box p="4.5">
            <Box display="flex" alignItems="center" gap="4.5" flexWrap="wrap">
                <Box display="flex" flexDirection="column" gap="0.5">
                    <Text textStyle="mono.sm" color="fg.muted">{a.outcome}</Text>
                    <Box display="flex" alignItems="baseline" gap="2.5">
                        <Text textStyle="mono-kpi" fontFamily="heading" fontSize="32px" color={kpiColor}>
                            <Help id="answer_effect">{signed(a.effect)}</Help>
                        </Text>
                        <Text textStyle="mono.sm" color="fg.muted"><Help id="answer_ci">95% CI&nbsp; {signed(a.lo)} … {signed(a.hi)}</Help></Text>
                    </Box>
                </Box>
                <Box as="span" css={badge({ variant: badgeOk ? 'ok' : 'warn', size: 'md' })} alignSelf="flex-end" mb="1" display="inline-flex" alignItems="center" gap="1">
                    {a.clear && !a.cautious && <FontAwesomeIcon icon={dirUp ? faArrowUp : faArrowDown} style={{ fontSize: '10px' }} />}
                    <Help id={`verdict_${verdict?.tag ?? 'modest'}` as HelpId}>{badgeText}</Help>
                </Box>
            </Box>

            {a.cautious && (
                <Box layerStyle="banner.stale" display="flex" alignItems="flex-start" gap="2" mt="3">
                    <Box as="span" color="fg.warning" flexShrink="0" mt="0.5" fontSize="12px"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>
                    <Text textStyle="body.sm" color="fg.default"><Help id="answer_cautious"><Text as="span" fontWeight="bold">Treat this as provisional.</Text></Help> We adjusted and got a number, but a robustness check failed — the estimate may still be driven by something we didn’t adjust for. See <Text as="span" fontWeight="semibold">Can we trust it?</Text></Text>
                </Box>
            )}

            {a.flip && (
                <Box layerStyle="banner.stale" display="flex" alignItems="flex-start" gap="2" mt="3">
                    <Box as="span" color="fg.warning" flexShrink="0" mt="0.5" fontSize="12px"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>
                    <Text textStyle="body.sm" color="fg.default"><Help id="answer_flip"><Text as="span" fontWeight="bold">Raw and like-for-like disagree.</Text></Help> In the plain average, the <Text as="span" fontFamily="mono">{a.treatment}</Text> group sits <Text as="span" fontStyle="italic">{lowerWord}</Text> on <Text as="span" fontFamily="mono">{a.outcome}</Text> ({signed(a.naive)}) — but they also differ most on <Text as="span" fontFamily="mono">{top.col}</Text> ({top.display}). Adjusting for it reverses the result.</Text>
                </Box>
            )}

            <Card>
                <Cap help="forest_plot">Raw average vs. like-for-like</Cap>
                <ForestPlot
                    rows={[
                        { label: 'Raw average', note: 'unadjusted', est: a.naive, lo: a.naiveLo, hi: a.naiveHi, tone: a.naive < 0 ? 'neg' : 'pos' },
                        { label: 'Like-for-like', note: 'adjusted', est: a.effect, lo: a.lo, hi: a.hi, tone: a.clear && !a.cautious ? 'pos' : 'warn' },
                    ]}
                    min={Math.floor(Math.min(0, a.naiveLo, a.lo) - 2)}
                    max={Math.ceil(Math.max(0, a.naiveHi, a.hi) + 2)}
                    unit={`change in ${a.outcome}${a.unit ? ` (${a.unit})` : ''}`}
                    height={150}
                    rowHelp={['forest_naive', 'forest_adjusted']}
                />
            </Card>

            <Card>
                <Cap help="balance">How unbalanced each one was — before adjusting</Cap>
                <Box py="0.5" maxH="208px" overflowY="auto">{barList(a.balance.map(b => ({ label: b.col, frac: b.frac, tone: b.tone, value: b.display })))}</Box>
            </Card>

            <Box mt="3.5">
                <Help id="counts" display="inline-flex" gap="4">
                    {([[a.nTotal, SUBJECT_MANY], [a.nCompared, 'compared like-for-like'], [a.nDropped, 'had no fair match']] as const).map(([n, label], i) => (
                        <Text key={i} textStyle="mono.sm" color="fg.muted"><Text as="span" color="fg.default" fontWeight="semibold">{Number(n)}</Text> {label}</Text>
                    ))}
                </Help>
            </Box>
        </Box>
    );
}

// ---------------------------------------------------------------------------
// Answer tab — refusal (the engine returned adjusted = none).
// ---------------------------------------------------------------------------
function RefusalZone({ refusal, overlap, naiveValue, outcome }: {
    refusal: NonNullable<ReturnType<typeof deriveView>['refusal']>;
    overlap: ReturnType<typeof deriveView>['overlap'];
    naiveValue: number; outcome: string;
}) {
    return (
        <Box p="4.5">
            <Box display="inline-flex" alignItems="center" gap="2" mb="2" color="fg.warning">
                <FontAwesomeIcon icon={faTriangleExclamation} style={{ fontSize: '14px' }} />
                <Text textStyle="title.card" color="fg.default"><Help id={refusal.kind === 'positivity' ? 'refusal_positivity' : 'refusal_not_estimable'}>{refusal.title}</Help></Text>
            </Box>
            <Text textStyle="body.sm" color="fg.muted" mb="3" lineHeight="1.5">{refusal.body}</Text>

            {refusal.kind === 'positivity' && overlap && (
                <Card mt="1">
                    <Cap help="overlap_histogram">Propensity overlap — {overlap.supportLabel}</Cap>
                    <OverlapHistogram treated={overlap.treated} control={overlap.control} supportLabel={overlap.supportLabel} positivityOk={overlap.positivityOk} height={170} />
                </Card>
            )}

            <Box display="flex" gap="4" mt="3.5">
                {refusal.evidence.map((e, i) => (
                    <Text key={i} textStyle="mono.sm" color="fg.muted"><Text as="span" color="fg.default" fontWeight="semibold">{e.value}</Text> {e.label}</Text>
                ))}
            </Box>

            <Text textStyle="caption" color="fg.subtle" mt="3.5" pt="3" borderTopWidth="1px" borderColor="border.subtle">
                Raw average difference in {outcome} (context only, not an answer): <Text as="span" fontFamily="mono" color="fg.muted">{signed(naiveValue)}</Text>
            </Text>
        </Box>
    );
}

// ---------------------------------------------------------------------------
// Validate tab — the real trial that would confirm the result.
// ---------------------------------------------------------------------------
function ValidatePanel({ vm, barList }: {
    vm: VMDesign;
    barList: (rows: { label: string; frac: number; tone: string; value: string }[]) => ReactNode;
}) {
    // Shared design-system recipes for the head-count + split bar (no hand-rolled styles).
    const stat = useSlotRecipe({ key: 'stat' })({ size: 'lg' });
    const meter = useSlotRecipe({ key: 'segmentedMeter' })({});
    return (
        <Box p="4.5">
            <Cap help="tab_validate">{vm.headline}</Cap>

            {/* KPI head-count (`stat`) + the split meter (`segmentedMeter`) */}
            <Box display="flex" alignItems="flex-end" gap="5" flexWrap="wrap">
                <Box css={stat.root}>
                    <Text css={stat.label}><Help id="validate_size">{vm.holdback ? 'to hold back from' : 'to run'}</Help></Text>
                    {vm.faint ? (
                        <Text textStyle="body.sm" fontWeight="semibold" color="fg.warning" maxW="220px">Effect too faint to size — set a materiality threshold to size a trial.</Text>
                    ) : (
                        <Text css={stat.valueText} color="brand.solid">{vm.primary.nTotal.toLocaleString()}</Text>
                    )}
                </Box>
                <Box css={meter.root} flex="1" minW="220px">
                    <Text css={meter.label}><Help id="validate_split">{vm.holdback ? 'Hold-back split' : 'Split'}</Help></Text>
                    <Box css={meter.track}>
                        <Box css={meter.segment} flex={vm.primary.treatedShare} bg="brand.solid" />
                        <Box css={meter.segment} flex={1 - vm.primary.treatedShare} bg="bg.emphasized" />
                    </Box>
                    <Box css={meter.keyRow} justifyContent="space-between">
                        <Box css={meter.keyItem}>
                            <Box css={meter.keyDot} bg="brand.solid" />
                            <span><Text as="span" css={meter.valueText}>{vm.primary.nTreated.toLocaleString()}</Text> {vm.holdback ? 'treated' : 'get it'}</span>
                        </Box>
                        <Box css={meter.keyItem}>
                            <Box css={meter.keyDot} bg="bg.emphasized" />
                            <span><Text as="span" css={meter.valueText}>{vm.primary.nControl.toLocaleString()}</Text> {vm.holdback ? 'held back' : 'left alone'}</span>
                        </Box>
                    </Box>
                </Box>
            </Box>

            {/* the categories to match the arms on */}
            {vm.matchOn.length > 0 && (
                <Card>
                    <Cap help="validate_match">Match both groups on</Cap>
                    <Box py="0.5">{barList(vm.matchOn.map(m => ({ label: m.display, frac: m.frac, tone: m.tone, value: '' })))}</Box>
                </Card>
            )}

            {/* chance-of-detecting curve */}
            {vm.curve.mid.length > 0 && (
                <Card>
                    <Cap help="validate_power">Chance of detecting it</Cap>
                    <AreaRange lo={vm.curve.mid} mid={vm.curve.mid} hi={vm.curve.mid} tone="brand"
                        xTicks={vm.curve.xTicks} yTicks={['100', '50', '0']} yFormat="percent"
                        marks={vm.curve.marks.map(m => ({ at: m.at, label: m.label, tone: m.tone, help: m.help }))} height={170} />
                </Card>
            )}

            <Text textStyle="body.sm" color="fg.default" lineHeight="1.5" mt="3.5">{vm.rationale}</Text>

            {/* alternate split options */}
            {vm.alternates.length > 0 && (
                <Box display="flex" flexDirection="column" gap="1.5" mt="3" pt="3" borderTopWidth="1px" borderColor="border.subtle">
                    {vm.alternates.map((o, i) => (
                        <Text key={i} textStyle="caption" color="fg.muted">
                            <Text as="span" fontWeight="semibold" color="fg.default">{o.label}</Text> · {o.nTotal.toLocaleString()} total ({o.nTreated.toLocaleString()} / {o.nControl.toLocaleString()})
                        </Text>
                    ))}
                </Box>
            )}
        </Box>
    );
}

// ---------------------------------------------------------------------------
// Population filter rail — reuses Slice's predicate editor.
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
function Step({ n, title, help, children }: { n: number; title: string; help?: HelpId; children: ReactNode }) {
    return (
        <Box px="4.5" py="3" borderBottomWidth="1px" borderColor="border.subtle">
            <Box display="flex" alignItems="baseline" gap="2.5" mb="2">
                <Box as="span" fontFamily="mono" fontSize="11px" fontWeight="bold" color="brand.fg" flex="0 0 auto" lineHeight="1">{n}</Box>
                <Text textStyle="title.row">{help ? <Help id={help}>{title}</Help> : title}</Text>
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

/** A single-select segmented control built from the `segmentGroup` recipe.
 *  A `radiogroup` for assistive tech: each option is a `radio` with `aria-checked`,
 *  roving tabindex, and Left/Right arrow selection. */
function SegmentSelect({ options, active, onPick, fill, size = 'xs' }: { options: string[]; active: number; onPick: (i: number) => void; fill?: boolean; size?: 'xs' }) {
    const s = useSlotRecipe({ key: 'segmentGroup' })({ size });
    return (
        <Box css={s.root} {...(fill ? { width: '100%' } : {})} role="radiogroup"
            onKeyDown={(e) => {
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const next = (active + d + options.length) % options.length;
                onPick(next);
                const btns = e.currentTarget.querySelectorAll('[role="radio"]');
                (btns[next] as HTMLElement | undefined)?.focus();
            }}>
            {options.map((o, i) => (
                <Box key={i} as="button" role="radio" aria-checked={active === i} tabIndex={active === i ? 0 : -1}
                    css={s.item} {...(fill ? { flex: '1' } : {})} {...(active === i ? { 'data-state': 'checked' } : {})} onClick={() => onPick(i)}>
                    <Box as="span" css={s.itemText}>{o}</Box>
                </Box>
            ))}
        </Box>
    );
}

/** A labelled two-segment toggle (Advanced rail rows). */
function Segmented({ label, left, right, active, onPick, last, help }: { label: string; left: string; right: string; active: 'left' | 'right'; onPick: (s: 'left' | 'right') => void; last?: boolean; help?: HelpId }) {
    return (
        <Box display="flex" flexDirection="column" alignItems="stretch" gap="1.5" py="2" borderBottomWidth={last ? '0' : '1px'} borderColor="border.subtle">
            <Text textStyle="caption.eyebrow" textTransform="none" letterSpacing="normal" color="fg.default">{help ? <Help id={help}>{label}</Help> : label}</Text>
            <SegmentSelect options={[left, right]} active={active === 'left' ? 0 : 1} onPick={i => onPick(i === 0 ? 'left' : 'right')} fill size="xs" />
        </Box>
    );
}

implementUIComponent(Experiment.Component, EastChakraExperiment);

export { EastChakraExperiment };
