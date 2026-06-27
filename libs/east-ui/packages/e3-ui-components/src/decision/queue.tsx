/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraDecisionQueue` — Chakra v3 renderer for the `DecisionQueue`
 * extension component declared in `@elaraai/e3-ui`: *the* Decide surface.
 * Urgency-sorted rows over the handle's unioned cases, the routine tail
 * collapsed under a bulk-accept band. Selecting a row opens one compact
 * facet beneath it (Evidence · Options · Judgement · Modify), swapped by
 * the row's segmented toggles; Apply / Reject stay on the row, Apply gated
 * by the judgement. Narrow hosts wrap rows to two lines: collapsed rows
 * are display-only, the toggles become a full-width segment, and the
 * Options facet stacks.
 *
 * Composes the shared chrome recipes (`frame` / `eyebrowRow` / `status` /
 * `button` / `facetTabs`) plus the `decisionQueue` row recipe; holds no
 * design values of its own. Registers against
 * {@link DecisionQueue.Component} at module load via
 * {@link implementUIComponent}.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useRecipe, useSlotRecipe } from '@chakra-ui/react';
import { variant, type ValueTypeOf } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { DecisionQueue } from '@elaraai/e3-ui/internal';
import { sliceMatches } from '@elaraai/east-ui/internal';
import {
    EastChakraComponent,
    implementUIComponent,
    getSomeorUndefined,
    formatTick,
    SliceRailCluster,
    useSliceReactivity,
    type TickFormatOpt,
} from '@elaraai/east-ui-components';

import { getBindingTypes, getReactiveDatasetCache } from '../platform/index.js';
import { useDecisionHandle, DECISION_SLICE_CONFIG, type UseDecisionHandleResult, type DecisionHandleRefValue } from './handle-runtime.js';
import { EvidenceFacet, OptionsFacet, JudgementFacet } from './facets.js';
import { normalizeTypeValue, type TypeNode } from './lever-editor.js';
import { URGENCY_RANK, type Decision, type UrgencyKind } from './types.js';

type DecisionQueueValue = ValueTypeOf<typeof DecisionQueue.Component.schema>;
type FacetKey = 'evidence' | 'options' | 'judgement' | 'modify';

const FACETS: ReadonlyArray<{ key: FacetKey; label: string }> = [
    { key: 'evidence', label: 'Evidence' },
    { key: 'options', label: 'Options' },
    { key: 'judgement', label: 'Judgement' },
    { key: 'modify', label: 'Modify' },
];

/** Urgency tag → `status` recipe tone + display label. */
const URGENCY_TONE: Record<UrgencyKind, 'danger' | 'warning' | 'neutral'> = {
    overdue: 'danger',
    due: 'warning',
    routine: 'neutral',
};

/** How a row left the queue — selects the exit treatment in the `rowShell`
 *  recipe (apply sweeps right in the success tone, reject sweeps left in the
 *  danger tone, an external removal fades quietly). */
type ExitReason = 'apply' | 'reject' | 'removed';

/** Slightly past the `rowShell` transition chain so the height collapse
 *  completes before an exited row unmounts. */
const EXIT_MS = 560;

/** Hosts narrower than this wrap rows to the two-line rail layout. */
const NARROW_PX = 560;

function decisionValue(d: Decision, n: number, showSign = false): string {
    return formatTick(n, getSomeorUndefined(d.format) as TickFormatOpt, showSign);
}

/** Deadline qualifier for the urgency flag — "overdue 2h" / "due 4pm". */
function deadlineSuffix(d: Decision): string {
    const deadline = getSomeorUndefined(d.deadline);
    if (deadline === undefined) return '';
    if (d.urgency.type === 'overdue') {
        const hours = Math.round((Date.now() - deadline.getTime()) / 3_600_000);
        if (hours < 1) return ' <1h';
        if (hours < 48) return ` ${hours}h`;
        return ` ${Math.round(hours / 24)}d`;
    }
    if (d.urgency.type === 'due') {
        const h = deadline.getHours();
        const m = deadline.getMinutes();
        const meridiem = h >= 12 ? 'pm' : 'am';
        const clock = h % 12 === 0 ? 12 : h % 12;
        return m === 0 ? ` ${clock}${meridiem}` : ` ${clock}:${String(m).padStart(2, '0')}${meridiem}`;
    }
    return '';
}

/** Walk the judgements binding's registered type to the contract's case
 *  payload types — what the lever editor and constraint chips dispatch on. */
function useLeverPayloads(ref: DecisionHandleRefValue | null): Record<string, TypeNode> {
    const cache = getReactiveDatasetCache();
    const workspace = cache.getConfig().workspace ?? '';
    return useMemo(() => {
        if (!ref) return {};
        const judgements = getBindingTypes(workspace, ref.judgements.source as TreePath);
        if (!judgements?.sourceType) return {};
        const root = normalizeTypeValue(judgements.sourceType);
        const constraint = root.value?.fields?.['constraints']?.value;
        return constraint?.type === 'Variant' ? (constraint.cases ?? {}) : {};
    }, [ref, workspace]);
}

// =============================================================================
// Row — one line; selected row opens one facet beneath, toggled by the
// segmented group. Apply / Reject are commands on the row.
// =============================================================================

interface RowProps {
    decision: Decision;
    handle: UseDecisionHandleResult;
    selected: boolean;
    narrow: boolean;
    leverPayloads: Record<string, TypeNode>;
    modify: ((d: Decision, update: (next: Decision) => void) => unknown) | undefined;
    evidence: ((d: Decision) => unknown) | undefined;
    defaultFacet: FacetKey;
    /** Author include-list of data facets; `null` ⇒ all. `modify` stays callback-gated. */
    facetInclude: ReadonlySet<FacetKey> | null;
    apply: (d: Decision) => void;
    reject: (d: Decision) => void;
    leaving: ExitReason | undefined;
    storageKey: string;
}

const Row = memo(function Row({ decision, handle, selected, narrow, leverPayloads, modify, evidence, defaultFacet, facetInclude, apply, reject, leaving, storageKey }: RowProps) {
    const dq = useSlotRecipe({ key: 'decisionQueue' });
    const status = useSlotRecipe({ key: 'status' });
    const tabs = useSlotRecipe({ key: 'facetTabs' });
    const button = useRecipe({ key: 'button' });
    const rs = dq({});
    const ts = tabs({});
    const st = status({ status: URGENCY_TONE[decision.urgency.type], size: 'md' });

    // Visible facets: the author include-list ANDed with the modify callback gate.
    const visibleFacets = useMemo(
        () => FACETS.filter(f => f.key === 'modify' ? modify !== undefined : (facetInclude === null || facetInclude.has(f.key))),
        [modify, facetInclude],
    );
    // Open the configured default facet, or the first available one when it is disabled.
    const effectiveDefault = visibleFacets.some(f => f.key === defaultFacet)
        ? defaultFacet
        : (visibleFacets[0]?.key ?? defaultFacet);

    const [facet, setFacet] = useState<FacetKey>(effectiveDefault);
    useEffect(() => { if (!selected) setFacet(effectiveDefault); }, [selected, effectiveDefault]);

    const gate = handle.commitStateFor(decision.id);
    const applyEnabled = gate === null || gate.type === 'ready';
    const gatePulse = !applyEnabled && decision.prompts.length > 0;

    const summary = getSomeorUndefined(decision.summary);

    const handleSelect = useCallback(() => {
        if (!selected) handle.select(decision.id);
    }, [selected, handle, decision.id]);

    const handleApply = useCallback(() => { if (applyEnabled) apply(decision); }, [applyEnabled, apply, decision]);
    const handleReject = useCallback(() => { reject(decision); }, [reject, decision]);

    // Host slots — `UIComponentType` values rendered by the nested dispatcher.
    const probe = useMemo<unknown>(() => {
        if (!selected || facet !== 'modify' || !modify) return null;
        return modify(decision, handle.update);
    }, [selected, facet, modify, decision, handle.update]);
    const canvas = useMemo<unknown>(() => {
        if (!selected || facet !== 'evidence' || !evidence) return null;
        return evidence(decision);
    }, [selected, facet, evidence, decision]);

    const facetTabs = (
        <Box css={ts.root} {...(narrow ? { display: 'flex', width: '100%' } : {})}>
            {visibleFacets.map(f => (
                <Box
                    key={f.key}
                    as="button"
                    css={ts.tab}
                    {...(narrow ? { flex: 1 } : {})}
                    {...(facet === f.key ? { 'data-on': '' } : {})}
                    {...(f.key === 'judgement' && gatePulse ? { 'data-pulse': '' } : {})}
                    aria-pressed={facet === f.key}
                    onClick={() => setFacet(f.key)}
                >
                    {f.label}
                </Box>
            ))}
        </Box>
    );

    const commands = (
        <Box display="flex" gap="6px" {...(narrow ? { justifyContent: 'flex-end' } : {})}>
            <Box
                as="button"
                css={button({ variant: 'solid', size: 'xs' })}
                aria-disabled={!applyEnabled}
                opacity={applyEnabled ? undefined : 0.5}
                cursor={applyEnabled ? undefined : 'not-allowed'}
                title={applyEnabled ? undefined : 'Answer the judgement to enable apply'}
                onClick={handleApply}
            >
                Apply
            </Box>
            <Box as="button" css={button({ variant: 'ghost', size: 'xs' })} onClick={handleReject}>
                Reject
            </Box>
        </Box>
    );

    const title = (
        <Box minW={0} cursor={selected ? undefined : 'pointer'} onClick={handleSelect}>
            <Text as="span" fontWeight="semibold">{decision.kind}</Text>
            <Text as="span" color="fg.subtle"> · </Text>
            <Text as="span">{decision.title}</Text>
            {summary !== undefined && !narrow && (
                <>
                    <Text as="span" color="fg.subtle"> · </Text>
                    <Text as="span" color="fg.muted">{summary}</Text>
                </>
            )}
        </Box>
    );

    const urgency = (
        <Box as="span" css={st.root} flexShrink={0}>
            <Box as="span" css={st.indicator} />
            <Box as="span" css={st.label}>{decision.urgency.type}{deadlineSuffix(decision)}</Box>
        </Box>
    );
    // Value-axis descriptor: when `signed` is false, the headline value reads
    // as a plain magnitude — no force-sign, no green-when-positive (#135).
    const valueSigned = getSomeorUndefined(decision.valueAxis)?.signed ?? true;
    const valueText = (
        <Text fontFamily="mono" fontWeight="semibold" textAlign="right" {...(valueSigned && decision.value >= 0 && selected ? { color: 'fg.success' } : {})}>
            {decisionValue(decision, decision.value, valueSigned && selected)}
        </Text>
    );

    return (
        <Box css={rs.rowShell} {...(leaving ? { 'data-leaving': leaving } : {})}>
            {narrow ? (
                <Box px="14px" py="10px">
                    <Box display="flex" justifyContent="space-between" alignItems="baseline">
                        {urgency}
                        {valueText}
                    </Box>
                    <Box mt="2px" fontSize="13px">{title}</Box>
                    {selected && (
                        <>
                            <Box mt="8px">{facetTabs}</Box>
                            <Box mt="8px">{commands}</Box>
                        </>
                    )}
                </Box>
            ) : (
                <Box css={rs.row}>
                    {urgency}
                    <Box css={rs.title} p={0}>{title}</Box>
                    {valueText}
                    <Box display="flex" alignItems="center" gap="12px">
                        {selected && facetTabs}
                        {commands}
                    </Box>
                </Box>
            )}

            {selected && (
                <Box px={narrow ? '14px' : '18px'} py="12px" borderTopWidth="1px" borderColor="border.subtle" bg="bg.canvas">
                    {facet === 'evidence' && (
                        <EvidenceFacet decision={decision}>
                            {canvas != null && (
                                <EastChakraComponent value={canvas as never} storageKey={`${storageKey}-evidence-${decision.id}`} />
                            )}
                        </EvidenceFacet>
                    )}
                    {facet === 'options' && <OptionsFacet decision={decision} narrow={narrow} />}
                    {facet === 'judgement' && (
                        <JudgementFacet decision={decision} handle={handle} leverPayloads={leverPayloads} />
                    )}
                    {facet === 'modify' && probe != null && (
                        <EastChakraComponent value={probe as never} storageKey={`${storageKey}-modify-${decision.id}`} />
                    )}
                </Box>
            )}
        </Box>
    );
});

// =============================================================================
// Routine collapse — compact rows + a single bulk-accept summary.
// =============================================================================

interface RoutineGroupProps {
    routine: Decision[];
    acceptAll: ((ds: Decision[]) => void) | undefined;
    leaving: ReadonlyMap<string, ExitReason>;
    narrow: boolean;
}

const RoutineGroup = memo(function RoutineGroup({ routine, acceptAll, leaving, narrow }: RoutineGroupProps) {
    const dq = useSlotRecipe({ key: 'decisionQueue' });
    const status = useSlotRecipe({ key: 'status' });
    const button = useRecipe({ key: 'button' });
    const rs = dq({});
    const st = status({ status: 'neutral', size: 'md' });

    const total = useMemo(() => routine.reduce((acc, d) => acc + d.value, 0), [routine]);
    const format = routine[0] ? (getSomeorUndefined(routine[0].format) as TickFormatOpt) : undefined;

    const handleAcceptAll = useCallback(() => {
        if (acceptAll) acceptAll(routine);
    }, [acceptAll, routine]);

    if (routine.length === 0) return null;

    return (
        <Box css={rs.routineGroup}>
            {routine.map(d => (
                <Box key={d.id} css={rs.rowShell} {...(leaving.has(d.id) ? { 'data-leaving': leaving.get(d.id) } : {})}>
                    <Box css={rs.routineRow}>
                        <Box as="span" css={st.root}>
                            <Box as="span" css={st.indicator} />
                            <Box as="span" css={st.label}>routine</Box>
                        </Box>
                        <Box minW={0} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                            <Text as="span" fontFamily="mono">{d.id}</Text>
                            <Text as="span" color="fg.muted"> · {d.kind}</Text>
                        </Box>
                        <Box css={rs.routineValue}>{decisionValue(d, d.value)}</Box>
                    </Box>
                </Box>
            ))}
            <Box css={rs.summary} {...(narrow ? { marginLeft: '0', flexWrap: 'wrap' } : {})}>
                <Box as="span" css={rs.summaryCap}>{routine.length} routine</Box>
                <Text as="span" color="fg.subtle">·</Text>
                <Text as="span" fontFamily="mono" fontWeight="semibold">{formatTick(total, format)}</Text>
                <Text as="span" color="fg.muted">total</Text>
                {acceptAll && (
                    <Box as="button" css={button({ variant: 'solid', size: 'xs' })} ml="auto" onClick={handleAcceptAll}>
                        Accept all
                    </Box>
                )}
            </Box>
        </Box>
    );
});

// =============================================================================
// Main component.
// =============================================================================

export interface EastChakraDecisionQueueProps {
    value: DecisionQueueValue;
    storageKey: string;
}

const EastChakraDecisionQueue = memo(function EastChakraDecisionQueue({ value, storageKey }: EastChakraDecisionQueueProps) {
    const eyebrow = useSlotRecipe({ key: 'eyebrowRow' });
    const es = eyebrow({});

    const handleRef = value.handle;
    const handle = useDecisionHandle(handleRef);
    const decisions = handle.decisions;
    const leverPayloads = useLeverPayloads(handleRef);

    // The slice is handle-owned (bound by Decision.bind, seeded there); the
    // payload's `slice` field only lists which affordances mount in the rail.
    // Its narrowing applies whether or not a rail shows — initial state with
    // no rail is an invisible author scope.
    const railAffordances = getSomeorUndefined(value.slice);
    // `buildSliceHandle` now returns a serializable IR handle typed loosely
    // (`Record<string, unknown>`, issue #106); narrow to the methods this view
    // reads. `read()` yields the decoded SliceState (cast `as never` at use).
    const sliceHandle = handle.slice as { key: string; read: () => unknown } | null;
    useSliceReactivity(sliceHandle?.key as string | undefined);
    // Read at render level: the handle's identity is stable across slice
    // writes, so the narrowing memo must depend on the state value itself
    // (a fresh decode per write — the subscription above drives the render).
    const sliceState = sliceHandle !== null ? sliceHandle.read() : null;

    // Narrow hosts (a rail) wrap rows to two lines.
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [narrow, setNarrow] = useState(false);
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(entries => {
            const width = entries[0]?.contentRect.width ?? 0;
            setNarrow(width > 0 && width < NARROW_PX);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Exit animation is data-driven: a row leaves because the bound array no
    // longer contains its id — whoever wrote the change (Apply here, another
    // operator's commit, a dataflow re-run). Just-removed rows keep rendering
    // from their last-seen value with `data-leaving` until the `rowShell`
    // transition completes, then unmount.
    const [exiting, setExiting] = useState<ReadonlyMap<string, { decision: Decision; reason: ExitReason }>>(new Map());
    const prevRef = useRef<Decision[] | null>(null);
    const reasonsRef = useRef(new Map<string, ExitReason>());
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    useLayoutEffect(() => {
        const prev = prevRef.current;
        prevRef.current = decisions;
        if (!prev || !decisions) return;
        const ids = new Set(decisions.map(d => d.id));
        const removed = prev.filter(d => !ids.has(d.id));
        if (removed.length === 0) return;
        setExiting(old => {
            const next = new Map(old);
            for (const d of removed) {
                next.set(d.id, { decision: d, reason: reasonsRef.current.get(d.id) ?? 'removed' });
                reasonsRef.current.delete(d.id);
            }
            return next;
        });
        timersRef.current.push(setTimeout(() => {
            setExiting(old => {
                const next = new Map(old);
                for (const d of removed) next.delete(d.id);
                return next;
            });
        }, EXIT_MS));
    }, [decisions]);
    useEffect(() => () => { for (const t of timersRef.current) clearTimeout(t); }, []);

    const heading = getSomeorUndefined(value.heading) ?? 'Decisions waiting';
    const onApply = useMemo(() => getSomeorUndefined(value.onApply) as ((d: Decision) => unknown) | undefined, [value.onApply]);
    const onReject = useMemo(() => getSomeorUndefined(value.onReject) as ((d: Decision) => unknown) | undefined, [value.onReject]);
    const modify = useMemo(
        () => getSomeorUndefined(value.modify) as
            ((d: Decision, update: (next: Decision) => void) => unknown) | undefined,
        [value.modify],
    );
    const evidence = useMemo(
        () => getSomeorUndefined(value.evidence) as ((d: Decision) => unknown) | undefined,
        [value.evidence],
    );
    const defaultFacet = (getSomeorUndefined(value.defaultFacet)?.type ?? 'evidence') as FacetKey;
    // Author include-list of data facets (`null` ⇒ all). `modify` stays callback-gated.
    const facetInclude = useMemo<ReadonlySet<FacetKey> | null>(() => {
        const facets = getSomeorUndefined(value.facets);
        return facets === undefined ? null : new Set(facets.map(f => f.type as FacetKey));
    }, [value.facets]);
    const defaultExpanded = getSomeorUndefined(value.defaultExpanded);

    // Selection is the expanded row; before any selection exists the host's
    // display-only default (derived from data) shows expanded.
    const selectedId = handle.selected ?? defaultExpanded?.id ?? null;

    // Apply / Reject resolve through the handle: verdict → judgement, removal
    // → the owning patch overlay, selection cleared. Host callbacks are
    // side-effect hooks; the row's exit falls out of the data diff above.
    const resolve = useCallback((ds: Decision[], hook: ((d: Decision) => unknown) | undefined, reason: ExitReason) => {
        if (hook) for (const d of ds) {
            const decision = d;
            queueMicrotask(() => hook(decision));
        }
        for (const d of ds) {
            reasonsRef.current.set(d.id, reason);
            handle.resolve(d.id, reason === 'reject' ? variant('rejected', null) : variant('accepted', ''));
        }
    }, [handle]);
    const apply = useCallback((d: Decision) => resolve([d], onApply, 'apply'), [resolve, onApply]);
    const reject = useCallback((d: Decision) => resolve([d], onReject, 'reject'), [resolve, onReject]);
    const acceptAll = useCallback((ds: Decision[]) => resolve(ds, onApply, 'apply'), [resolve, onApply]);

    // Urgency sort (overdue → due → routine; deadline within bucket), with
    // exiting rows merged back in at their old positions.
    const { active, routine, pastSla, visible } = useMemo(() => {
        const scoped = decisions ?? [];
        const now = new Date();
        const live = sliceState !== null
            ? scoped.filter(d => sliceMatches(sliceState as never, DECISION_SLICE_CONFIG as never, d as never, now))
            : scoped;
        const merged = [...live];
        for (const { decision } of exiting.values()) {
            if (!merged.some(d => d.id === decision.id)) merged.push(decision);
        }
        merged.sort((a, b) => {
            const r = URGENCY_RANK[a.urgency.type] - URGENCY_RANK[b.urgency.type];
            if (r !== 0) return r;
            const da = getSomeorUndefined(a.deadline)?.getTime() ?? Infinity;
            const db = getSomeorUndefined(b.deadline)?.getTime() ?? Infinity;
            if (da !== db) return da - db;
            return b.value - a.value;
        });
        return {
            active: merged.filter(d => d.urgency.type !== 'routine'),
            routine: merged.filter(d => d.urgency.type === 'routine'),
            pastSla: merged.filter(d => d.urgency.type === 'overdue').length,
            visible: live.length,
        };
    }, [decisions, exiting, sliceState]);

    const exitingReasons = useMemo(() => {
        const m = new Map<string, ExitReason>();
        for (const [id, e] of exiting) m.set(id, e.reason);
        return m;
    }, [exiting]);

    if (decisions === null) {
        return (
            <Box layerStyle="frame" p="16px">
                <Text color="fg.muted" fontSize="13px">Loading decisions…</Text>
            </Box>
        );
    }

    return (
        <Box ref={rootRef} layerStyle="frame" overflow="hidden">
            <Box css={es.root}>
                <Box css={es.lbl}>{heading}</Box>
                {sliceHandle !== null && railAffordances !== undefined && (
                    <Box display="flex" alignItems="center" minWidth="0" flex="1" justifyContent="flex-end" marginRight="10px">
                        <SliceRailCluster
                            slice={sliceHandle as never}
                            affordanceKinds={railAffordances.map(a => a.type)}
                        />
                    </Box>
                )}
                <Box css={es.meta} gap="10px">
                    <Box as="span"><Text as="span" color="fg" fontWeight="semibold">{visible}</Text>{narrow ? '' : ' decisions'}</Box>
                    {pastSla > 0 && (
                        <>
                            <Box as="span" css={es.sep}>·</Box>
                            <Box as="span"><Text as="span" color="fg.danger" fontWeight="semibold">{pastSla}</Text>{narrow ? ' SLA' : ' past SLA'}</Box>
                        </>
                    )}
                </Box>
            </Box>

            <Box
                maxHeight={getSomeorUndefined(value.maxHeight)}
                overflowY={value.maxHeight.type === 'some' ? 'auto' : undefined}
            >
                {active.map(d => (
                    <Row
                        key={d.id}
                        decision={d}
                        handle={handle}
                        selected={selectedId === d.id}
                        narrow={narrow}
                        leverPayloads={leverPayloads}
                        modify={modify}
                        evidence={evidence}
                        defaultFacet={defaultFacet}
                        facetInclude={facetInclude}
                        apply={apply}
                        reject={reject}
                        leaving={exitingReasons.get(d.id)}
                        storageKey={storageKey}
                    />
                ))}

                <RoutineGroup routine={routine} acceptAll={acceptAll} leaving={exitingReasons} narrow={narrow} />
            </Box>
        </Box>
    );
});

implementUIComponent(DecisionQueue.Component, EastChakraDecisionQueue);

export { EastChakraDecisionQueue };
