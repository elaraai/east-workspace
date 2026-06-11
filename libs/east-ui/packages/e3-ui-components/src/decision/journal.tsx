/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraDecisionJournal` — Chakra v3 renderer for the `DecisionJournal`
 * extension component declared in `@elaraai/e3-ui`: the resolved-cases
 * read-back. One row per judgement carrying a verdict, newest first — the
 * verdict (accepted / rejected / deferred / handoff), the case id, the
 * operator's captured knowledge as the rationale quote, injected constraints
 * as the meta line, and the resolution time on the right edge.
 *
 * @packageDocumentation
 */

import { memo, useMemo } from 'react';
import { Box, Text, useSlotRecipe } from '@chakra-ui/react';
import { type ValueTypeOf } from '@elaraai/east';
import { DecisionJournal } from '@elaraai/e3-ui/internal';
import { implementUIComponent, getSomeorUndefined, ClauseChip } from '@elaraai/east-ui-components';

import type { TreePath } from '@elaraai/e3-types';
import { getBindingTypes, getReactiveDatasetCache } from '../platform/index.js';
import { useDecisionHandle, type Judgement, type Verdict } from './handle-runtime.js';
import { normalizeTypeValue, type TypeNode } from './lever-editor.js';
import { formatConstraint } from './constraint-format.js';

type DecisionJournalValue = ValueTypeOf<typeof DecisionJournal.Component.schema>;

type StatusTone = 'success' | 'danger' | 'warning' | 'neutral';

function verdictPresentation(verdict: Verdict): { tone: StatusTone; verb: string; detail: string | null } {
    switch (verdict.type) {
        case 'accepted':
            return { tone: 'success', verb: 'accepted', detail: verdict.value !== '' ? verdict.value : null };
        case 'rejected':
            return { tone: 'danger', verb: 'rejected', detail: null };
        case 'deferred':
            return { tone: 'neutral', verb: 'deferred', detail: verdict.value.type === 'some' ? verdict.value.value : null };
        case 'handoff':
            return { tone: 'warning', verb: 'handed off', detail: verdict.value !== '' ? verdict.value : null };
    }
}

function formatResolvedAt(j: Judgement): string | null {
    if (j.resolvedAt.type !== 'some') return null;
    const d = j.resolvedAt.value;
    const month = d.toLocaleString('en', { month: 'short' });
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${month} ${d.getDate()} · ${time}`;
}

export interface EastChakraDecisionJournalProps {
    value: DecisionJournalValue;
    storageKey: string;
}

const EastChakraDecisionJournal = memo(function EastChakraDecisionJournal({ value }: EastChakraDecisionJournalProps) {
    const eyebrow = useSlotRecipe({ key: 'eyebrowRow' });
    const status = useSlotRecipe({ key: 'status' });
    const es = eyebrow({});

    const handle = useDecisionHandle(value.handle);
    const heading = getSomeorUndefined(value.heading) ?? 'Decision journal';
    const cache = getReactiveDatasetCache();
    const workspace = cache.getConfig().workspace ?? '';
    const leverPayloads = useMemo<Record<string, TypeNode>>(() => {
        const judgements = getBindingTypes(workspace, value.handle.judgements.source as TreePath);
        if (!judgements?.sourceType) return {};
        const root = normalizeTypeValue(judgements.sourceType);
        const constraint = root.value?.fields?.['constraints']?.value;
        return constraint?.type === 'Variant' ? (constraint.cases ?? {}) : {};
    }, [workspace, value.handle]);

    const entries = useMemo(() => handle.journal ?? [], [handle.journal]);

    return (
        <Box borderWidth="1px" borderColor="border.strong" borderRadius="6px" background="bg.canvas" overflow="hidden">
            <Box css={es.root}>
                <Box css={es.lbl}>{heading}</Box>
                <Box css={es.meta}>
                    {entries.length === 1 ? '1 entry' : `${entries.length} entries`}
                </Box>
            </Box>

            <Box
                maxHeight={getSomeorUndefined(value.maxHeight)}
                overflowY={value.maxHeight.type === 'some' ? 'auto' : undefined}
            >
            {entries.length === 0 ? (
                <Text px="16px" py="14px" fontSize="13px" color="fg.muted">
                    No resolved cases yet — verdicts land here as the queue clears.
                </Text>
            ) : entries.map((j, i) => {
                const verdict = j.verdict.type === 'some' ? j.verdict.value : null;
                if (!verdict) return null;
                const { tone, verb, detail } = verdictPresentation(verdict);
                const st = status({ status: tone, size: 'md' });
                const when = formatResolvedAt(j);
                const knowledge = j.knowledge.type === 'some' && j.knowledge.value !== '' ? j.knowledge.value : null;
                return (
                    <Box
                        key={j.caseId}
                        px="16px"
                        py="10px"
                        borderTopWidth={i === 0 ? undefined : '1px'}
                        borderColor="border.subtle"
                        display="flex"
                        flexDirection="column"
                        gap="6px"
                    >
                        <Box display="flex" alignItems="baseline" gap="10px">
                            <Box as="span" css={st.root} flexShrink={0}>
                                <Box as="span" css={st.indicator} />
                                <Box as="span" css={st.label}>{verb}</Box>
                            </Box>
                            <Text as="span" fontFamily="mono" fontSize="12px" color="fg.muted">{j.caseId}</Text>
                            {detail !== null && (
                                <Text as="span" fontSize="13px" minW={0} flex="1" truncate>{detail}</Text>
                            )}
                            {when !== null && (
                                <Text as="span" fontFamily="mono" fontSize="11.5px" color="fg.muted" marginLeft="auto" flexShrink={0}>
                                    {when}
                                </Text>
                            )}
                        </Box>
                        {knowledge !== null && (
                            <Text
                                fontSize="12.5px"
                                fontStyle="italic"
                                color="fg.muted"
                                borderLeftWidth="2px"
                                borderColor="border.strong"
                                paddingLeft="10px"
                            >
                                &ldquo;{knowledge}&rdquo;
                            </Text>
                        )}
                        {j.constraints.length > 0 && (
                            <Box display="flex" gap="12px" flexWrap="wrap">
                                {j.constraints.map((c, k) => {
                                    const tag = (c as unknown as { type: string }).type;
                                    const f = formatConstraint(c, leverPayloads[tag]);
                                    return <ClauseChip key={k} field={f.lever} op={f.op} value={f.value} />;
                                })}
                            </Box>
                        )}
                    </Box>
                );
            })}
            </Box>
        </Box>
    );
});

implementUIComponent(DecisionJournal.Component, EastChakraDecisionJournal);

export { EastChakraDecisionJournal };
