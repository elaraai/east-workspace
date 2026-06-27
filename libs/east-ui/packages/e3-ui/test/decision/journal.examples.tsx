/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

/**
 * `DecisionJournal` examples — the resolved-cases read-back. The judgements
 * input is pre-seeded with three resolved cases (one per verdict flavour)
 * and one still-staged case, which the journal must NOT show: it renders
 * exactly the judgements carrying a verdict, newest first.
 */

import { East, ArrayType, DictType, StringType, some, none, variant, example } from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui';
import { Data, Decision, DecisionJournal } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

// ============================================================================
// Inputs — one open case in the queue; three resolved cases in judgements.
// ============================================================================

export const journalDecisions = e3.input(
    'journal_decisions',
    ArrayType(Decision.Types.Decision),
    [
        {
            id: 'cap-ne-wk10',
            kind: 'capacity',
            title: 'Raise NE weekend cover',
            urgency: variant('due', null),
            value: 22000,
            deadline: none,
            format: none,
            valueAxis: none,
            summary: some('NE region · wk 10'),
            downside: some(-4000),
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

export const journalJudgements = e3.input(
    'journal_judgements',
    Decision.Types.Judgements(),
    new Map([
        ['ros-patel-cho', {
            caseId: 'ros-patel-cho',
            answers: new Map([['cho_told', variant('yes', null)]]),
            knowledge: some("Accepted the recommendation. Cho's hours are at OT cap; will need to revisit Wed if forecast holds."),
            constraints: [variant('float', variant('atMost', 36))],
            verdict: some(variant('accepted', '')),
            resolvedAt: some(new Date('2026-06-09T16:42:00')),
        }],
        ['avl-patel-thu', {
            caseId: 'avl-patel-thu',
            answers: new Map(),
            knowledge: some('Patel arranged a private swap with Riggs — no roster change needed.'),
            constraints: [],
            verdict: some(variant('rejected', null)),
            resolvedAt: some(new Date('2026-06-09T11:05:00')),
        }],
        ['utl-cho-cap', {
            caseId: 'utl-cho-cap',
            answers: new Map([['trend_structural', variant('unknown', null)]]),
            knowledge: none,
            constraints: [],
            verdict: some(variant('handoff', 'workforce lead — needs the quarterly staffing view')),
            resolvedAt: some(new Date('2026-06-08T09:30:00')),
        }],
        ['cap-ne-wk10', {
            caseId: 'cap-ne-wk10',
            answers: new Map(),
            knowledge: some('Still gathering payroll input.'),
            constraints: [],
            verdict: none,
            resolvedAt: none,
        }],
    ]),
);

// ============================================================================
// 1. Resolved cases — one entry per verdict flavour; the still-staged case
//    is excluded.
// ============================================================================

export const decisionJournalResolved = example({
    keywords: ['DecisionJournal', 'Decide', 'Trust', 'journal', 'verdict', 'resolved', 'read-back'],
    description: 'Decision journal — resolved cases newest first with verdict, rationale quote, injected constraints and resolution time; staged cases excluded',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(journalDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(journalJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind({ decisions: [decisions], judgements }));
                return <DecisionJournal handle={handle} heading="Decision journal · SE region" />;
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 2. Capped height — `maxHeight` pins the header and scrolls the entries.
// ============================================================================

export const decisionJournalScroll = example({
    keywords: ['DecisionJournal', 'Decide', 'maxHeight', 'scroll', 'overflow'],
    description: 'Journal capped with maxHeight — the header stays pinned while the entries scroll',
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const decisions = $.let(Data.bind(journalDecisions, { mode: 'direct' }));
                const judgements = $.let(Data.bind(journalJudgements, { mode: 'direct' }));
                const handle = $.let(Decision.bind({ decisions: [decisions], judgements }));
                return <DecisionJournal handle={handle} heading="Decision journal · SE region" maxHeight="180px" />;
            }}</Reactive>
        );
    }),
    inputs: [],
});
