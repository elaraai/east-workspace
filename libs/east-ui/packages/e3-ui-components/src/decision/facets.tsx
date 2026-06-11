/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal — the decision-queue row's facet panels. One facet open at a
 * time beneath the selected row, swapped by the row's segmented toggles:
 *
 * - `Evidence` — the model's argument: stakes / if-wrong / confidence line,
 *   typed evidence chips, and the host's per-decision `detail` canvas.
 * - `Options` — the ranked stack (recommendation + alternatives) with
 *   zero-anchored downside / uplift bars.
 * - `Judgement` — the operator's staged response: prompts, knowledge, and
 *   the lever builder (typed editors from the solution's constraint
 *   contract), with the gate hint + Defer as the footer.
 *
 * (The `Modify` facet is the host's probe editor, rendered by the queue
 * directly through the `modify` slot.)
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, chakra, useRecipe } from '@chakra-ui/react';
import { none, some, variant } from '@elaraai/east';
import { EastChakraSelect, getSomeorUndefined, formatTick, type TickFormatOpt } from '@elaraai/east-ui-components';

import type { UseDecisionHandleResult, Judgement, ConstraintValue } from './handle-runtime.js';
import { LeverEditor, leverPayloadEditable, type TypeNode } from './lever-editor.js';
import { formatConstraint } from './constraint-format.js';
import type { Decision } from './types.js';

function fmt(d: Decision, n: number, showSign = false): string {
    return formatTick(n, getSomeorUndefined(d.format) as TickFormatOpt, showSign);
}

const caption = { textStyle: 'caption.eyebrow', color: 'fg.muted' } as const;

// =============================================================================
// Evidence — the model's argument + the host's detail canvas (rendered by
// the queue as children, since it owns the component dispatcher).
// =============================================================================

export interface EvidenceFacetProps {
    decision: Decision;
    /** The host's `detail` canvas, already rendered by the queue. */
    children?: React.ReactNode;
}

export const EvidenceFacet = memo(function EvidenceFacet({ decision, children }: EvidenceFacetProps) {
    const stakes = getSomeorUndefined(decision.stakes);
    const downside = getSomeorUndefined(decision.downside);
    const confidence = getSomeorUndefined(decision.confidence);
    const detail = getSomeorUndefined(decision.detail);
    return (
        <Box display="flex" flexDirection="column" gap="10px">
            <Box display="flex" alignItems="baseline" gap="12px" flexWrap="wrap">
                <Text {...caption} color="fg">Why this is recommended</Text>
                <Text {...caption}>
                    {stakes !== undefined && <>stakes <Text as="span" fontFamily="mono" fontWeight="semibold">{stakes.type}</Text> · </>}
                    {downside !== undefined && <>if wrong <Text as="span" fontFamily="mono" fontWeight="semibold" color="fg.danger">{fmt(decision, downside, true)}</Text> · </>}
                    {confidence !== undefined && <>confidence <Text as="span" fontFamily="mono" fontWeight="semibold">{Math.round(confidence * 100)}%</Text></>}
                </Text>
            </Box>
            {detail !== undefined && <Text fontSize="12.5px" color="fg.muted">{detail}</Text>}
            {decision.evidence.length > 0 && (
                <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="8px">
                    {decision.evidence.map((e, i) => {
                        const note = getSomeorUndefined(e.note);
                        return (
                            <Box key={i} borderWidth="1px" borderColor="border.subtle" borderRadius="4px" px="10px" py="8px" bg="bg.canvas">
                                <Text {...caption}>{e.label}</Text>
                                <Text fontSize="13px" fontWeight="medium">{e.text}</Text>
                                {note !== undefined && <Text fontSize="11px" fontFamily="mono" color="fg.subtle">{note}</Text>}
                            </Box>
                        );
                    })}
                </Box>
            )}
            {children}
        </Box>
    );
});

// =============================================================================
// Options — the ranked stack with zero-anchored bars.
// =============================================================================

interface RankedOption {
    rank: number;
    label: string;
    value: number;
    downside: number | undefined;
    confidence: number | undefined;
    note: string | undefined;
    recommended: boolean;
}

function rankOptions(d: Decision): RankedOption[] {
    const alternatives = [...d.alternatives]
        .sort((a, b) => b.value - a.value)
        .map(a => ({
            label: a.label,
            value: a.value,
            downside: getSomeorUndefined(a.downside),
            confidence: getSomeorUndefined(a.confidence),
            note: getSomeorUndefined(a.note),
            recommended: false,
        }));
    return [
        {
            label: d.title,
            value: d.value,
            downside: getSomeorUndefined(d.downside),
            confidence: getSomeorUndefined(d.confidence),
            note: getSomeorUndefined(d.summary),
            recommended: true,
        },
        ...alternatives,
    ].map((o, i) => ({ ...o, rank: i + 1 }));
}

function metaLine(o: RankedOption): string {
    const parts: string[] = [];
    if (o.recommended) parts.push('recommended');
    if (o.confidence !== undefined) parts.push(`${Math.round(o.confidence * 100)}% conf`);
    if (!o.recommended && o.note !== undefined) parts.push(o.note);
    return parts.join(' · ');
}

export interface OptionsFacetProps {
    decision: Decision;
    /** Narrow hosts render the stacked meter-card layout. */
    narrow?: boolean;
}

export const OptionsFacet = memo(function OptionsFacet({ decision, narrow }: OptionsFacetProps) {
    const options = rankOptions(decision);
    const maxUp = Math.max(...options.map(o => Math.max(o.value, 0)), 1e-9);
    const maxDown = Math.max(...options.map(o => Math.abs(o.downside ?? 0)), 1e-9);

    if (narrow) {
        const meter = (label: string, frac: number, display: string, tone: 'success' | 'danger' | 'neutral') => (
            <Box display="grid" gridTemplateColumns="80px 1fr 64px" alignItems="center" gap="8px">
                <Text {...caption} whiteSpace="nowrap">{label}</Text>
                <Box height="6px" bg="border.subtle" borderRadius="3px" overflow="hidden">
                    <Box height="100%" width={`${Math.round(Math.min(Math.abs(frac), 1) * 100)}%`} bg={tone === 'success' ? 'fg.success' : tone === 'danger' ? 'fg.danger' : 'fg.subtle'} opacity={0.7} />
                </Box>
                <Text fontSize="11px" fontFamily="mono" fontWeight="semibold" textAlign="right">{display}</Text>
            </Box>
        );
        return (
            <Box display="flex" flexDirection="column" gap="10px">
                <Text {...caption} color="fg">Options · {options.length} evaluated</Text>
                {options.map(o => (
                    <Box key={o.rank} display="flex" flexDirection="column" gap="4px" pl="8px" {...(o.recommended ? { boxShadow: 'inset 2px 0 0 var(--chakra-colors-accent-brand)' } : {})}>
                        <Text fontSize="12.5px"><Text as="span" fontFamily="mono" color="fg.subtle">{o.rank}</Text> <Text as="span" fontWeight={o.recommended ? 'semibold' : 'normal'}>{o.label}</Text></Text>
                        {meter('Uplift', o.value / maxUp, fmt(decision, o.value, true), 'success')}
                        {meter('If wrong', (o.downside ?? 0) / maxDown, o.downside !== undefined ? fmt(decision, o.downside, true) : '—', 'danger')}
                    </Box>
                ))}
            </Box>
        );
    }

    return (
        <Box display="flex" flexDirection="column" gap="6px">
            <Box display="grid" gridTemplateColumns="minmax(180px, 1.1fr) 1fr 1fr" alignItems="baseline" gap="8px">
                <Text {...caption} color="fg">Options · {options.length} evaluated</Text>
                <Text {...caption} textAlign="center">If wrong</Text>
                <Text {...caption} textAlign="right">Uplift</Text>
            </Box>
            {options.map(o => {
                const downFrac = Math.min(Math.abs(o.downside ?? 0) / maxDown, 1);
                const upFrac = Math.min(Math.max(o.value, 0) / maxUp, 1);
                return (
                    <Box
                        key={o.rank}
                        display="grid"
                        gridTemplateColumns="minmax(180px, 1.1fr) 1fr 1fr"
                        alignItems="center"
                        gap="8px"
                        py="4px"
                        {...(o.recommended ? { bg: 'bg.brand.subtle', boxShadow: 'inset 2px 0 0 var(--chakra-colors-accent-brand)' } : {})}
                    >
                        <Box minW={0} pl={o.recommended ? '6px' : '0'} display="flex" alignItems="baseline" gap="6px">
                            <Text as="span" fontFamily="mono" fontSize="11px" color="fg.subtle" flexShrink={0}>{o.rank}</Text>
                            <Text as="span" fontSize="12.5px" fontWeight={o.recommended ? 'semibold' : 'normal'} flexShrink={0}>{o.label}</Text>
                            {metaLine(o) !== '' && (
                                <Text as="span" fontFamily="mono" fontSize="10.5px" color="fg.muted" minW={0} truncate>{metaLine(o)}</Text>
                            )}
                        </Box>
                        <Box display="flex" justifyContent="flex-end" alignItems="center" gap="6px" height="16px">
                            {o.downside !== undefined && (
                                <>
                                    <Text fontSize="10.5px" fontFamily="mono" color="fg.danger" flexShrink={0}>{fmt(decision, o.downside, true)}</Text>
                                    <Box height="12px" width={`${Math.round(downFrac * 100)}%`} bg="fg.danger" opacity={0.55} />
                                </>
                            )}
                        </Box>
                        <Box display="flex" alignItems="center" gap="6px" height="16px" borderLeftWidth="1px" borderColor="border.strong">
                            {o.value > 0 && (
                                <>
                                    <Box height="12px" width={`${Math.round(upFrac * 100)}%`} bg="fg.success" opacity={0.6} />
                                    <Text fontSize="10.5px" fontFamily="mono" color="fg.success" flexShrink={0}>{fmt(decision, o.value, true)}</Text>
                                </>
                            )}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
});

// =============================================================================
// Judgement — prompts · knowledge · lever builder · gate footer.
// =============================================================================

const ANSWERS = [
    { literal: 'yes', label: 'Yes' },
    { literal: 'no', label: 'No' },
    { literal: 'unknown', label: "Don't know" },
] as const;

export interface JudgementFacetProps {
    decision: Decision;
    handle: UseDecisionHandleResult;
    /** Contract case name → payload type, walked off the judgements binding. */
    leverPayloads: Record<string, TypeNode>;
}

export const JudgementFacet = memo(function JudgementFacet({ decision, handle, leverPayloads }: JudgementFacetProps) {
    const button = useRecipe({ key: 'button' });
    const input = useRecipe({ key: 'input' });

    const judgement: Judgement | null = handle.judgementFor(decision.id);
    const stagedKnowledge = judgement?.knowledge.type === 'some' ? judgement.knowledge.value : '';
    const [knowledge, setKnowledge] = useState(stagedKnowledge);
    useEffect(() => { setKnowledge(stagedKnowledge); }, [stagedKnowledge]);
    const commitKnowledge = useCallback(() => {
        if (knowledge !== stagedKnowledge) handle.addKnowledge(decision.id, knowledge);
    }, [knowledge, stagedKnowledge, handle, decision.id]);

    const levers = useMemo(
        () => decision.levers.filter(l => leverPayloadEditable(leverPayloads[l.case])),
        [decision.levers, leverPayloads],
    );
    const [leverCase, setLeverCase] = useState(levers[0]?.case ?? '');
    const activeLever = levers.find(l => l.case === leverCase) ?? levers[0];

    const gate = handle.commitStateFor(decision.id);
    const gateHint = gate?.type === 'gated'
        ? (gate.value === 1n ? 'Answer the judgement question to enable apply' : `Answer the ${gate.value} judgement questions to enable apply`)
        : gate?.type === 'blocked' ? 'Commit blocked — an answer contradicts the recommendation'
        : gate?.type === 'handoff' ? "Awaiting handoff — an answer was don't know"
        : null;

    const onInject = useCallback((constraint: ConstraintValue) => {
        handle.inject(decision.id, constraint);
    }, [handle, decision.id]);

    if (!judgement) return null;

    return (
        <Box display="flex" flexDirection="column" gap="10px">
            <Box display="flex" alignItems="baseline" gap="12px">
                <Text {...caption} color="fg.warning">Required before commit</Text>
                <Text {...caption} marginLeft="auto">human-only signal · model can&rsquo;t see this</Text>
            </Box>

            {decision.prompts.map(prompt => {
                const current = judgement.answers.get(prompt.id)?.type;
                return (
                    <Box key={prompt.id} display="flex" alignItems="center" gap="12px" flexWrap="wrap">
                        <Text fontSize="13px" fontWeight="medium" flex="1" minW="180px">{prompt.text}</Text>
                        <Box display="flex" gap="6px" flexShrink={0}>
                            {ANSWERS.map(a => (
                                <chakra.button
                                    key={a.literal}
                                    type="button"
                                    css={button({ variant: current === a.literal ? 'solid' : 'outline', size: 'xs' })}
                                    onClick={() => handle.answer(decision.id, prompt.id, a.literal)}
                                >
                                    {a.label}
                                </chakra.button>
                            ))}
                        </Box>
                    </Box>
                );
            })}

            <Box display="flex" flexDirection="column" gap="4px">
                <Text {...caption}>Knowledge · what the model can&rsquo;t see</Text>
                <chakra.textarea
                    css={input({ size: 'sm' })}
                    rows={2}
                    value={knowledge}
                    placeholder="Private context — persists with the case"
                    onChange={e => setKnowledge(e.target.value)}
                    onBlur={commitKnowledge}
                />
            </Box>

            {(levers.length > 0 || judgement.constraints.length > 0) && (
                <Box display="flex" flexDirection="column" gap="6px">
                    <Text {...caption}>Inject constraint · next run folds it in</Text>
                    {judgement.constraints.length > 0 && (
                        <Box display="flex" gap="12px" flexWrap="wrap">
                            {judgement.constraints.map((c, i) => {
                                const tag = (c as unknown as { type: string }).type;
                                const f = formatConstraint(c, leverPayloads[tag], decision.levers);
                                return (
                                    <Text key={i} as="span" fontFamily="mono" fontSize="11px">
                                        <Text as="span" color="accent.brand" fontWeight="semibold">{f.lever}</Text>{' '}
                                        <Text as="span" color="fg.subtle">{f.op}</Text>{' '}
                                        <Text as="span" fontWeight="semibold">{f.value}</Text>
                                    </Text>
                                );
                            })}
                        </Box>
                    )}
                    {activeLever !== undefined && (
                        <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                            {levers.length > 1 ? (
                                <Box flexShrink={0} css={{ '& [data-scope=select][data-part=root]': { width: 'auto', minWidth: '160px' } }}>
                                    <EastChakraSelect
                                        ariaLabel="Lever"
                                        value={{
                                            value: some(activeLever.case),
                                            items: levers.map(l => ({ value: l.case, label: l.label, disabled: none })),
                                            placeholder: none, multiple: none, disabled: none,
                                            onChange: some((v: string) => setLeverCase(v)), onChangeMultiple: none, onOpenChange: none,
                                            style: some({ size: some(variant('sm', null)) }),
                                        } as never}
                                    />
                                </Box>
                            ) : (
                                <Text {...caption} color="fg" flexShrink={0}>{activeLever.label}</Text>
                            )}
                            <Box flex="1" minW="260px">
                                <LeverEditor
                                    key={activeLever.case}
                                    leverCase={activeLever.case}
                                    payload={leverPayloads[activeLever.case]!}
                                    onInject={onInject}
                                />
                            </Box>
                        </Box>
                    )}
                </Box>
            )}

            {gateHint !== null && (
                <Box display="flex" alignItems="center" gap="8px" pt="4px">
                    <Box width="7px" height="7px" borderRadius="full" bg="fg.warning" flexShrink={0} />
                    <Text {...caption}>{gateHint}</Text>
                    <chakra.button
                        type="button"
                        css={button({ variant: 'outline', size: 'xs' })}
                        marginLeft="auto"
                        onClick={() => handle.resolve(decision.id, variant('deferred', none))}
                    >
                        Defer
                    </chakra.button>
                </Box>
            )}
        </Box>
    );
});
