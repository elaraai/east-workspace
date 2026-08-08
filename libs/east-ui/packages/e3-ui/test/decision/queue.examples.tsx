/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

/**
 * `DecisionQueue` examples — *the* Decide surface. One queue over the
 * handle; selecting a row opens one compact facet beneath it (Evidence ·
 * Options · Judgement · Modify). The constraint contract is a by-name
 * `VariantType` declared once beside the inputs (in a real solution, a
 * shared module imported by the reasoning task too): a bounded float lever
 * (`cho_hours_cap`) and a struct lever (`blackout` — person · from · to).
 *
 * The seeds are spelled out as plain values (`e3.input` defaults are plain
 * values); in a real app the decisions input is a reasoning task's output
 * bound with its own patch overlay.
 */

import {
    East, ArrayType, StructType, VariantType, StringType, FloatType, DateTimeType,
    NullType, IntegerType, some, none, variant, example,
} from '@elaraai/east';
import { Box, Chart, Field, Reactive, Separator, Slice, UIComponentType, VStack } from '@elaraai/east-ui';
import { Data, Decision, DecisionQueue, DecisionType } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

// ============================================================================
// The solution's constraint contract — declared ONCE (next to its inputs),
// imported by both the reasoning task and the surface. Lever payloads are
// arbitrary East types: bounded ops for numerics, structs for windows.
// ============================================================================

export const RosterConstraint = VariantType({
    cho_hours_cap: VariantType({
        atMost: FloatType,
        atLeast: FloatType,
        between: StructType({ min: FloatType, max: FloatType }),
    }),
    blackout: StructType({
        person: StringType,
        from: DateTimeType,
        to: DateTimeType,
    }),
});

const CURRENCY = variant('currency', {
    currency: variant('USD', null),
    display: none,
    compact: some(variant('short', null)),
    minimumFractionDigits: none,
    maximumFractionDigits: none,
});

// ============================================================================
// Inputs — one queue (active cases with prompts / levers / evidence /
// alternatives, plus a routine tail) and the staged judgements.
// ============================================================================

export const queueDecisions = e3.input(
    'queue_decisions',
    ArrayType(Decision.Types.Decision),
    [
        {
            id: 'ros-patel-cho',
            kind: 'roster',
            title: 'Move 3 SE shifts Patel → Cho',
            urgency: variant('overdue', null),
            value: 80000,
            deadline: some(new Date('2026-03-10T07:00:00Z')),   // pinned demo timestamp (reads as overdue)
            format: some(CURRENCY),
            valueAxis: none,
            summary: some('SE region · wk 09-16'),
            downside: some(-8000),
            confidence: some(0.82),
            detail: some('Forecast SE demand +14% over the next two weeks; moving three shifts clears the gap without breaching the OT cap.'),
            stakes: some(variant('high', null)),
            prompts: [{ id: 'cho_told', text: 'Has Cho been told this is on the table?' }],
            levers: [
                { case: 'cho_hours_cap', label: 'Cho weekly hours cap' },
                { case: 'blackout', label: 'Roster blackout window' },
            ],
            evidence: [
                { label: 'forecast', text: 'SE region +14%', note: some('next 2 wks · holiday-demand driver') },
                { label: 'capacity', text: 'Cho +12h slack', note: some('Patel at 38h of 40') },
                { label: 'track', text: '5 / 5 similar moves', note: some('reduced OT, no SLA breach') },
            ],
            alternatives: [
                { id: some('contractor'), label: 'Hire 1 contractor', value: 48000, downside: some(-15000), confidence: some(0.71), note: some('2 wk lead time · cost lock-in') },
                { id: some('do_nothing'), label: 'Do nothing', value: 0, downside: some(-140000), confidence: none, note: some('SLA breach wk 2') },
            ],
        },
        {
            id: 'ord-sku-001',
            kind: 'reorder',
            title: 'SKU-001 · 2k units',
            urgency: variant('due', null),
            value: 42000,
            deadline: some(new Date('2026-03-10T16:00:00Z')),   // pinned demo timestamp (due today, 4pm)
            format: some(CURRENCY),
            valueAxis: none,
            summary: some('supplier lead time 6 days'),
            downside: some(-5000),
            confidence: some(0.77),
            detail: none,
            stakes: some(variant('medium', null)),
            prompts: [],
            levers: [],
            evidence: [{ label: 'demand', text: 'wk 10 forecast +9%', note: none }],
            alternatives: [
                { id: some('wait'), label: 'Wait one week', value: 18000, downside: some(-21000), confidence: some(0.6), note: none },
            ],
        },
        {
            id: 'utl-riggs-tidy',
            kind: 'roster',
            title: 'Rebalance Riggs roster −6h',
            urgency: variant('routine', null),
            value: 1200,
            deadline: none,
            format: some(CURRENCY),
            valueAxis: none,
            summary: none,
            downside: none,
            confidence: none,
            detail: none,
            stakes: none,
            prompts: [],
            levers: [],
            evidence: [],
            alternatives: [],
        },
        {
            id: 'cap-mw-trim',
            kind: 'capacity',
            title: 'Trim MW weekend cover',
            urgency: variant('routine', null),
            value: 800,
            deadline: none,
            format: some(CURRENCY),
            valueAxis: none,
            summary: none,
            downside: none,
            confidence: none,
            detail: none,
            stakes: none,
            prompts: [],
            levers: [],
            evidence: [],
            alternatives: [],
        },
        {
            // A non-benefit headline: a press-ETA in days. `valueAxis` relabels
            // the axis "Day" and `signed: false` stops it reading as a green
            // "+2 Uplift" — it's a plain forecast horizon (#135).
            id: 'eta-press-a',
            kind: 'forecast',
            title: 'Press A ready in ~2 days',
            urgency: variant('routine', null),
            value: 2,
            deadline: none,
            format: none,
            valueAxis: some({ label: 'Day', signed: false }),
            summary: some('decision_day + p95 + buffer'),
            downside: none,
            confidence: some(0.7),
            detail: none,
            stakes: none,
            prompts: [],
            levers: [],
            evidence: [],
            alternatives: [],
        },
    ],
);

export const queueJudgements = e3.input(
    'queue_judgements',
    Decision.Types.Judgements(RosterConstraint),
    new Map([
        ['ros-patel-cho', {
            caseId: 'ros-patel-cho',
            answers: new Map(),
            knowledge: some('Patel mentioned a weekend preference for March.'),
            constraints: [variant('cho_hours_cap', variant('atMost', 36))],
            verdict: none,
            resolvedAt: none,
        }],
    ]),
);

// ============================================================================
// 1. Evidence facet open — the model's argument + the host's evidence canvas.
// ============================================================================

export const decisionQueueCase = example({
    keywords: ['DecisionQueue', 'Decide', 'queue', 'facet', 'evidence', 'detail', 'canvas', 'contract'],
    description: 'The Decide surface — urgency-sorted queue; the overdue case expanded on the Evidence facet with the model’s argument and the host’s demand-vs-capacity evidence canvas',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                // "the overdue case" — a predicate, not an id or a position.
                const urgent = $.let(decisions.read().firstMap(($, d) =>
                    d.urgency.hasTag('overdue').ifElse(() => some(d), () => none)));
                const forecast = $.const([
                    { week: 9n, demand: 82.0, capacity: 96.0 },
                    { week: 10n, demand: 85.0, capacity: 96.0 },
                    { week: 11n, demand: 88.0, capacity: 96.0 },
                    { week: 12n, demand: 91.0, capacity: 96.0 },
                    { week: 13n, demand: 95.0, capacity: 96.0 },
                    { week: 14n, demand: 99.0, capacity: 96.0 },
                    { week: 15n, demand: 104.0, capacity: 96.0 },
                ], ArrayType(StructType({ week: IntegerType, demand: FloatType, capacity: FloatType })));
                const evidence = $.const(East.function([DecisionType], UIComponentType, (_$, _decision) => (
                    <Chart
                        layers={[
                            Chart.Area(forecast, { x: r => r.week, y: r => r.demand }, { color: 'teal.solid', fillOpacity: 0.25 }),
                            Chart.Line(forecast, { x: r => r.week, y: r => r.capacity }, { color: 'red.solid' }),
                        ]}
                        grid
                        height={160}
                    />
                )));
                const modify = $.const(East.function([DecisionType, DecisionQueue.Types.Update], UIComponentType, ($, decision, update) => {
                    const onChangeEnd = $.const(East.function([FloatType], NullType, ($, v) => {
                        // East has no struct spread — rebuild the decision with the probed `value`.
                        const edited = $.const({
                            id: decision.id,
                            kind: decision.kind,
                            title: decision.title,
                            urgency: decision.urgency,
                            value: v,
                            deadline: decision.deadline,
                            format: decision.format,
                            valueAxis: decision.valueAxis,
                            summary: decision.summary,
                            downside: decision.downside,
                            confidence: decision.confidence,
                            detail: decision.detail,
                            stakes: decision.stakes,
                            prompts: decision.prompts,
                            levers: decision.levers,
                            evidence: decision.evidence,
                            alternatives: decision.alternatives,
                        }, DecisionType);
                        $(update(edited));
                    }));
                    return (
                        <Field.Slider
                            label="Uplift target"
                            value={decision.value}
                            min={0}
                            max={120000}
                            step={1000}
                            helperText="Probe the recommendation — committing re-runs the optimizer against the revised target."
                            onChangeEnd={onChangeEnd}
                        />
                    );
                }));
                return (
                    <DecisionQueue
                        handle={handle}
                        heading="Decisions waiting"
                        defaultExpanded={urgent}
                        modify={modify}
                        evidence={evidence}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 2. Judgement facet open — prompts, knowledge, the staged constraint chip,
//    and the typed lever builder (bounded float + struct blackout).
// ============================================================================

export const decisionQueueJudgement = example({
    keywords: ['DecisionQueue', 'Decide', 'judgement', 'lever', 'constraint', 'contract', 'gate'],
    description: 'The Judgement facet — prompt gating Apply, knowledge capture, a staged constraint chip, and the typed lever builder derived from the solution’s constraint contract',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                const urgent = $.let(decisions.read().firstMap(($, d) =>
                    d.urgency.hasTag('overdue').ifElse(() => some(d), () => none)));
                return (
                    <DecisionQueue
                        handle={handle}
                        heading="Decisions waiting"
                        defaultExpanded={urgent}
                        defaultFacet="judgement"
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 3. Facet variants panel — the reduced facet include-list, the non-benefit
//    valueAxis headline, and the Options facet open (the ranked stack with
//    zero-anchored bars).
// ============================================================================

export const decisionQueueFacetVariants = example({
    keywords: ['DecisionQueue', 'facets', 'evidence', 'judgement', 'include', 'reduced', 'valueAxis', 'signed', 'label', 'horizon', 'uplift', 'non-benefit', 'Decide', 'options', 'alternatives', 'ranked', 'bars'],
    description: 'Facet variant panel — FACETS: a reduced facet set, only Evidence and Judgement tabs show (Options hidden via the facets include-list); VALUE AXIS: a non-benefit headline — the press-ETA case carries a valueAxis ("Day", signed:false) so its value reads as a plain magnitude, not a green signed "Uplift"; OPTIONS: the Options facet — the recommendation and its alternatives ranked by uplift, downside and uplift bars sharing a zero anchor',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="FACETS" align="start" />
                <Reactive>{$ => {
                    const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                    const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                    const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                    const urgent = $.let(decisions.read().firstMap(($, d) =>
                        d.urgency.hasTag('overdue').ifElse(() => some(d), () => none)));
                    return (
                        <DecisionQueue
                            handle={handle}
                            heading="Decisions waiting"
                            defaultExpanded={urgent}
                            facets={["evidence", "judgement"]}
                        />
                    );
                }}</Reactive>
                <Separator label="VALUE AXIS" align="start" />
                <Reactive>{$ => {
                    const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                    const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                    const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                    const eta = $.let(decisions.read().firstMap(($, d) =>
                        East.equal(d.kind, 'forecast').ifElse(() => some(d), () => none)));
                    return (
                        <DecisionQueue
                            handle={handle}
                            heading="Decisions waiting"
                            defaultExpanded={eta}
                        />
                    );
                }}</Reactive>
                <Separator label="OPTIONS" align="start" />
                <Reactive>{$ => {
                    const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                    const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                    const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                    const urgent = $.let(decisions.read().firstMap(($, d) =>
                        d.urgency.hasTag('overdue').ifElse(() => some(d), () => none)));
                    return (
                        <DecisionQueue
                            handle={handle}
                            heading="Decisions waiting"
                            defaultExpanded={urgent}
                            defaultFacet="options"
                        />
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// 4. Sizing panel — the queue constrained to a ~360px rail (rows wrap to two
//    lines, the facet toggles become a full-width segment, Apply / Reject
//    drop to their own line, and the Options facet stacks) and capped with
//    `maxHeight` (the header pins while the rows scroll).
// ============================================================================

export const decisionQueueSizing = example({
    keywords: ['DecisionQueue', 'Decide', 'narrow', 'rail', 'responsive', 'wrap', 'maxHeight', 'scroll', 'overflow'],
    description: 'Sizing panel — NARROW: the same queue in a ~360px rail with two-line rows, full-width facet segment, stacked Options facet; SCROLL: the queue capped with maxHeight — the header stays pinned while the rows scroll',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="NARROW" align="start" />
                <Reactive>{$ => {
                    const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                    const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                    const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                    const urgent = $.let(decisions.read().firstMap(($, d) =>
                        d.urgency.hasTag('overdue').ifElse(() => some(d), () => none)));
                    return (
                        <Box width="360px">
                            <DecisionQueue
                                handle={handle}
                                heading="Decisions waiting"
                                defaultExpanded={urgent}
                                defaultFacet="options"
                            />
                        </Box>
                    );
                }}</Reactive>
                <Separator label="SCROLL" align="start" />
                <Reactive>{$ => {
                    const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                    const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                    const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                    return <DecisionQueue handle={handle} heading="Decisions waiting" maxHeight="220px" />;
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});


// ============================================================================
// 5. The author-owned slice — an ordinary `Slice.bind` over the decision
//    envelope (rows = `handle.queue()`, the Table pattern), seeded with an
//    initial kind filter; pass the handle as the queue's `slice` option to
//    mount the rail. The same seed with NO rail mounted is an invisible
//    author scope, and the author-owned key gives per-surface scopes over
//    one handle (or a slice shared with any other component).
// ============================================================================

export const decisionQueueSlice = example({
    keywords: ['DecisionQueue', 'Decide', 'slice', 'Slice.bind', 'Slice.config', 'seed', 'rail', 'filter', 'search', 'affordances', 'operator'],
    description: 'The author-owned slice — Slice.bind over the decision envelope (rows = handle.queue()) seeded with a kind filter (shown as a removable chip); pass the handle as the queue\'s slice option to mount the rail; the same seed with no rail is an invisible author scope',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                const cfg = Slice.config(DecisionType, {
                    fields: { kind: { label: 'Kind' }, title: { label: 'Title' }, value: { label: 'Value' } },
                    searchFieldIds: ['kind', 'title'],
                });
                const slice = $.let(Slice.bind([DecisionType], 'ex.decision.queue.slice', cfg, Slice.state({
                    filters: [variant('string', { fieldId: 'kind', op: variant('eq', 'roster') })],
                }), handle.queue(), none));
                return (
                    <DecisionQueue
                        handle={handle}
                        heading="Decisions waiting"
                        slice={slice}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});


// ============================================================================
// 6. Grouped queue — `groupBy` mounts the Group-by toolbar (built-in Urgency /
//    Kind / None plus the custom `groups` accessors); sections collapse with a
//    Collapse-all control, and the urgency grouping's Routine section ships
//    collapsed hosting the bulk Accept all.
// ============================================================================

export const decisionQueueGrouped = example({
    keywords: ['DecisionQueue', 'Decide', 'grouping', 'groupBy', 'groups', 'collapsible', 'urgency', 'kind', 'custom', 'accessor', 'Accept all'],
    description: 'Grouped queue — Group-by Urgency (default) / Kind / a custom Value-band accessor; collapsible sections with Collapse-all, the Routine section collapsed with its bulk Accept all',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                return (
                    <DecisionQueue
                        handle={handle}
                        heading="Decisions waiting"
                        groupBy="urgency"
                        groups={{
                            'Value band': d => d.value.greater(50000.0).ifElse(() => 'High', () => 'Standard'),
                        }}
                        collapsible
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
