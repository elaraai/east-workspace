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
import { Box, Chart, Field, Reactive, Slice, UIComponentType } from '@elaraai/east-ui';
import { Data, Decision, DecisionQueue } from '@elaraai/e3-ui';
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
            deadline: some(new Date(Date.now() - 2 * 3_600_000)),
            format: some(CURRENCY),
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
            deadline: some(new Date(new Date().setHours(16, 0, 0, 0))),
            format: some(CURRENCY),
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
// 1. Evidence facet open — the model's argument + the host's detail canvas.
// ============================================================================

export const decisionQueueCase = example({
    keywords: ['DecisionQueue', 'Decide', 'queue', 'facet', 'evidence', 'detail', 'canvas', 'contract'],
    description: 'The Decide surface — urgency-sorted queue; the overdue case expanded on the Evidence facet with the model’s argument and the host’s demand-vs-capacity detail canvas',
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
                return (
                    <DecisionQueue
                        handle={handle}
                        heading="Decisions waiting"
                        defaultExpanded={urgent}
                        modify={(decision, update) => (
                            <Field.Slider
                                label="Uplift target"
                                value={decision.value}
                                min={0}
                                max={120000}
                                step={1000}
                                helperText="Probe the recommendation — committing re-runs the optimizer against the revised target."
                                onChangeEnd={East.function([FloatType], NullType, ($, v) => {
                                    $(update({ ...decision, value: v }));
                                })}
                            />
                        )}
                        detail={() => (
                            <Chart
                                layers={[
                                    Chart.Area(forecast, { x: r => r.week, y: r => r.demand }, { color: 'teal.solid', fillOpacity: 0.25 }),
                                    Chart.Line(forecast, { x: r => r.week, y: r => r.capacity }, { color: 'red.solid' }),
                                ]}
                                grid
                                height={160}
                            />
                        )}
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

export const decisionQueueFacets = example({
    keywords: ['DecisionQueue', 'facets', 'evidence', 'judgement', 'include', 'reduced'],
    description: 'A reduced facet set — only Evidence and Judgement tabs show (Options hidden via the facets include-list)',
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
                        facets={["evidence", "judgement"]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 3. Options facet open — the ranked stack with zero-anchored bars.
// ============================================================================

export const decisionQueueOptions = example({
    keywords: ['DecisionQueue', 'Decide', 'options', 'alternatives', 'ranked', 'bars'],
    description: 'The Options facet — the recommendation and its alternatives ranked by uplift, downside and uplift bars sharing a zero anchor',
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
                        defaultFacet="options"
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 4. Narrow rail — the queue constrained to a ~360px container: rows wrap
//    to two lines, the facet toggles become a full-width segment, Apply /
//    Reject drop to their own line, and the Options facet stacks.
// ============================================================================

export const decisionQueueNarrow = example({
    keywords: ['DecisionQueue', 'Decide', 'narrow', 'rail', 'responsive', 'wrap'],
    description: 'The narrow variant — the same queue in a ~360px rail: two-line rows, full-width facet segment, stacked Options facet',
    fn: East.function([], UIComponentType, (_$) => {
        return (
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
        );
    }),
    inputs: [],
});

// ============================================================================
// 5. Capped height — `maxHeight` pins the header and scrolls the rows.
// ============================================================================

export const decisionQueueScroll = example({
    keywords: ['DecisionQueue', 'Decide', 'maxHeight', 'scroll', 'overflow'],
    description: 'Queue capped with maxHeight — the header stays pinned while the rows scroll',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind([RosterConstraint], { decisions: [decisions], judgements }));
                return <DecisionQueue handle={handle} heading="Decisions waiting" maxHeight="220px" />;
            }}</Reactive>
        );
    }),
    inputs: [],
});


// ============================================================================
// 7. The handle-owned slice — `Decision.bind` binds it (seeded with an
//    initial kind filter); the queue's `slice` option only mounts the rail.
//    The same seed with NO rail mounted is an invisible author scope.
// ============================================================================

export const decisionQueueSlice = example({
    keywords: ['DecisionQueue', 'Decide', 'slice', 'bind', 'seed', 'rail', 'filter', 'search', 'operator'],
    description: 'The handle-owned slice — Decision.bind seeds the initial state (kind = roster, shown as a removable chip); the queue\'s slice option mounts the rail; omitting the rail would make the same seed an invisible author scope',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(queueDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(queueJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind([RosterConstraint], {
                    decisions: [decisions],
                    judgements,
                    slice: Slice.state({
                        filters: [variant('string', { fieldId: 'kind', op: variant('eq', 'roster') })],
                    }),
                }));
                return (
                    <DecisionQueue
                        handle={handle}
                        heading="Decisions waiting"
                        slice={['filter', 'search']}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
