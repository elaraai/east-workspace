/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

/**
 * The decision loop, end to end — decisions from MULTIPLE reasoning tasks
 * union into one queue through a single `Decision.bind` handle; resolved
 * cases land in the journal beneath. Rows expand in place (selection is the
 * expanded row); the Judgement facet gates Apply; Apply / Reject resolve
 * through the handle: the verdict lands in the staged judgements dict
 * (visible in the journal), the case leaves the bound queue, and the loop
 * closes back to Triage.
 *
 * Two seeded inputs stand in for the two task outputs (a roster optimiser
 * and an order optimiser); in a real app each would be a task's output
 * bound with its own patch overlay.
 */

import {
    East, ArrayType, StructType, VariantType, StringType, FloatType, DateTimeType,
    some, none, variant, example,
} from '@elaraai/east';
import { Reactive, UIComponentType, VStack } from '@elaraai/east-ui';
import { Data, Decision, DecisionQueue, DecisionJournal } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

/** The solution's constraint contract — shared with the reasoning tasks. */
export const LoopConstraint = VariantType({
    cho_hours_cap: VariantType({ atMost: FloatType, atLeast: FloatType }),
    blackout: StructType({ person: StringType, from: DateTimeType, to: DateTimeType }),
});

const CURRENCY = variant('currency', {
    currency: variant('USD', null),
    display: none,
    compact: some(variant('short', null)),
    minimumFractionDigits: none,
    maximumFractionDigits: none,
});

export const loopRosterDecisions = e3.input(
    'loop_roster_decisions',
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
            detail: none,
            stakes: some(variant('high', null)),
            prompts: [{ id: 'cho_told', text: 'Has Cho been told this is on the table?' }],
            levers: [
                { case: 'cho_hours_cap', label: 'Cho weekly hours cap' },
                { case: 'blackout', label: 'Roster blackout window' },
            ],
            evidence: [
                { label: 'forecast', text: 'SE region +14%', note: some('next 2 wks') },
                { label: 'capacity', text: 'Cho +12h slack', note: none },
            ],
            alternatives: [],
        },
        {
            id: 'ros-riggs-tidy',
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
    ],
);

export const loopOrderDecisions = e3.input(
    'loop_order_decisions',
    ArrayType(Decision.Types.Decision),
    [
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
            stakes: none,
            prompts: [],
            levers: [],
            evidence: [{ label: 'demand', text: 'wk 10 forecast +9%', note: none }],
            alternatives: [],
        },
    ],
);

export const loopJudgements = e3.input(
    'loop_judgements',
    Decision.Types.Judgements(LoopConstraint),
    new Map(),
);

// ============================================================================
// 1. The full loop — multi-task queue (Judgement facet open on the gated
//    case) + the journal beneath, one handle.
// ============================================================================

export const decisionLoop = example({
    keywords: ['Decision', 'bind', 'handle', 'loop', 'queue', 'journal', 'judgement', 'multi-task'],
    description: 'Two task outputs union into one queue via Decision.bind; the gated case opens on the Judgement facet, and resolved cases land in the journal beneath — one handle for the whole loop',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const roster = $.let(Data.bind([ArrayType(Decision.Types.Decision)], loopRosterDecisions.path, { mode: 'direct' }));
                const orders = $.let(Data.bind([ArrayType(Decision.Types.Decision)], loopOrderDecisions.path, { mode: 'direct' }));
                const judgements = $.let(Data.bind([Decision.Types.Judgements(LoopConstraint)], loopJudgements.path, { mode: 'direct' }));
                const handle = $.let(Decision.bind([LoopConstraint], { decisions: [roster, orders], judgements }));
                const gated = $.let(roster.read().firstMap(($, d) =>
                    d.urgency.hasTag('overdue').ifElse(() => some(d), () => none)));
                return (
                    <VStack gap="6" align="stretch">
                        <DecisionQueue
                            handle={handle}
                            heading="Decisions waiting"
                            defaultExpanded={gated}
                            defaultFacet="judgement"
                        />
                        <DecisionJournal handle={handle} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
