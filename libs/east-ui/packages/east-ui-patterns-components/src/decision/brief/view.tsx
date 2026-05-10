/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * EastChakraDecisionBrief — native Chakra v3 renderer for the
 * {@link Decision.Brief} pattern declared in `@elaraai/east-ui-patterns`.
 *
 * @remarks
 * Layout follows the UX/UI Guide §19 chart-card pattern (top zone /
 * title zone / body zone / callout zone / action zone) so the card has
 * a clear visual hierarchy with one element dominating per zone.
 *
 *  • Top zone: eyebrow left, stakes meta right, single line.
 *  • Title zone: 22 px DM Sans 600, line-height 1.2 — the dominant element.
 *  • Body zone: because-bullets with a 3 px brand-500 left rule giving the
 *    "BECAUSE" zone identity (the rule sits inside the card, not on the
 *    card's outer edge — UX/UI Guide §05 anti-pattern is about CARD
 *    edges).
 *  • Callout zone: Upside / Risks / Don't-know rows, each with a 3 px
 *    tone-coloured left rule (success / caution / neutral).
 *  • Action zone: top-bordered footer; primary action upgraded to
 *    size="lg" so it visually outweighs Modify / Override; aside link
 *    pinned to far-right via ml="auto".
 *
 * @packageDocumentation
 */

import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { match, type ValueTypeOf } from "@elaraai/east";
import {
    EastChakraComponent,
    Markdown,
    implementUIComponent,
} from "@elaraai/east-ui-components";
import { Brief, type DecisionBriefAsideType, type DecisionBriefValueType } from "@elaraai/east-ui-patterns";

// ============================================================================
// Helpers.
// ============================================================================

type Value       = ValueTypeOf<typeof DecisionBriefValueType>;
type StakesValue = Value["stakes"];
type ToneValue   = StakesValue["impact"]["tone"];

const TONE_INK: Record<ToneValue["type"], string> = {
    low:  "ink.success",
    mid:  "ink.warning",
    high: "ink.danger",
};

const toneInk = (tone: ToneValue): string => TONE_INK[tone.type];

// ============================================================================
// Stakes meta — top-zone right-side, replaces the old pill.
//
// Strong impact value on the left of the cluster, quieter affected /
// reversibility metadata to its right with em-dash separators. No
// background tint (§02 — status carried by the dot + label, not by the
// surface).
// ============================================================================

/**
 * Stakes meta — top-zone right-side cluster.
 *
 * Tone-coloured bold number + muted "impact" label, then 1px-tall
 * neutral separators, then quieter affected / reversibility metadata.
 * No status dots — the weight + colour on the number carries the
 * signal, the dot is visual stuttering.
 */
function StakesMeta({ value }: { value: StakesValue }) {
    return (
        <HStack gap="3" align="center">
            <HStack gap="1.5" align="baseline">
                <Text textStyle="mono.md" color={toneInk(value.impact.tone)} fontWeight="semibold">
                    {value.impact.value}
                </Text>
                <Text textStyle="caption" color="fg.muted">impact</Text>
            </HStack>
            {match(value.affected, {
                some: (affected) => (
                    <>
                        <Box w="1px" h="12px" bg="border.subtle" />
                        <Text textStyle="caption" color="fg.muted">{affected}</Text>
                    </>
                ),
                none: () => null,
            })}
            {match(value.reversibility, {
                some: (rev) => (
                    <>
                        <Box w="1px" h="12px" bg="border.subtle" />
                        <Text textStyle="caption" color={toneInk(rev.tone)} fontWeight="medium">
                            {rev.value}
                        </Text>
                    </>
                ),
                none: () => null,
            })}
        </HStack>
    );
}

// ============================================================================
// Callout row — one of upside / risks / unknowns.
//
// Inline bold-label + em-dash + body — the label-colour carries the
// semantic, the body sits in fg so the rows share the same vertical
// rhythm as the bullets above. No panels, no left rules: structurally
// honest per UX/UI Guide §05 (no coloured left-borders, decorative or
// otherwise).
// ============================================================================

function CalloutRow({
    label,
    tone,
    children,
}: {
    label: string;
    tone: "upside" | "risk" | "unknown";
    children: ReactNode;
}) {
    // Don't-know is epistemic, not branded — explicit gray, not a
    // semantic-token alias (avoids any chance the alias resolves to
    // brand under a future theme tweak).
    const labelColor =
        tone === "upside" ? "ink.success"
        : tone === "risk" ? "ink.caution"
        : "gray.500";
    return (
        <Box textStyle="body.md" color="fg" lineHeight="snug">
            <Text as="span" fontWeight="semibold" color={labelColor}>
                {label}
            </Text>
            <Text as="span" color="fg.muted" mx="2">
                —
            </Text>
            <Box as="span" fontStyle={tone === "unknown" ? "italic" : "normal"}>
                {children}
            </Box>
        </Box>
    );
}

// ============================================================================
// Top-level renderer.
// ============================================================================

export interface EastChakraDecisionBriefProps {
    value:      Value;
    storageKey: string;
}

/**
 * EastChakraDecisionBrief — Decide-mode anchor pattern.
 *
 * Five-zone layout per UX/UI Guide §19 chart-card pattern: top, title,
 * body, callout, action. One element dominates per zone.
 */
export function EastChakraDecisionBrief({
    value,
    storageKey,
}: EastChakraDecisionBriefProps) {
    // Consume the style escape hatches (maxWidth / width) so authors can
    // widen the card on briefs with longer body content. Defaults: 560 px
    // max-width, full-width up to that cap. Defensive against undefined
    // — older serialized values may predate the `style` field.
    const width = !value.style ? undefined : match(value.style, {
        some: (s) => match(s.width,    { some: (v) => v, none: () => undefined }),
        none: () => undefined,
    });
    const maxWidth = !value.style ? "560px" : match(value.style, {
        some: (s) => match(s.maxWidth, { some: (v) => v, none: () => "560px" }),
        none: () => "560px",
    });
    return (
        <Box
            w={width ?? "full"}
            maxW={maxWidth}
            bg="bg.surface"
            borderRadius="lg"
            boxShadow="md"
            overflow="hidden"
        >
            <Stack gap="0">
                {/* ─── Zone 1: Header strip (52 px). Eyebrow left, stakes
                       meta right. Bottom border separates from the title. */}
                <HStack
                    gap="4"
                    align="center"
                    h="52px"
                    px="5"
                    borderBottomWidth="1px"
                    borderBottomColor="border.subtle"
                >
                    <Text textStyle="eyebrow" color="brand.600">
                        Recommended action
                    </Text>
                    <Box ml="auto">
                        <StakesMeta value={value.stakes} />
                    </Box>
                </HStack>

                {/* ─── Zone 2: Title — 22 px DM Sans 600, the dominant
                       element. */}
                <Box
                    px="5"
                    pt="5"
                    pb="4"
                    fontFamily="heading"
                    fontSize="22px"
                    fontWeight="semibold"
                    lineHeight="1.25"
                    letterSpacing="tight"
                    color="fg"
                >
                    <Markdown inline>{value.claim}</Markdown>
                </Box>

                {/* ─── Zone 3: Because bullets. Tiny brand-500 dot per
                       row, 12 px between dot and text — the list itself
                       is the structural identity. */}
                {value.because.length > 0 && (
                    <Stack as="ul" gap="2.5" listStyleType="none" m="0" px="5" pb="5">
                        {value.because.slice(0, 3).map((b, i) => (
                            <HStack as="li" key={i} align="flex-start" gap="3">
                                <Box
                                    as="span"
                                    w="4px"
                                    h="4px"
                                    mt="9px"
                                    borderRadius="full"
                                    bg="brand.500"
                                    flexShrink={0}
                                />
                                <Box flex="1" textStyle="body.md" color="fg" lineHeight="snug">
                                    <Markdown inline>{b.reason}</Markdown>
                                    {match(b.accent, {
                                        some: (accent) => (
                                            <Text as="span" color="fg.subtle" textStyle="caption" ml="1.5">
                                                ({accent})
                                            </Text>
                                        ),
                                        none: () => null,
                                    })}
                                </Box>
                            </HStack>
                        ))}
                    </Stack>
                )}

                {/* ─── Zone 4: Callout block (consequence). One subtle
                       top hairline marks the shift from reasoning →
                       consequence. No bottom border here — the action
                       footer's own top border handles that separation. */}
                <Stack
                    gap="3"
                    px="5"
                    pt="4"
                    pb="5"
                    borderTopWidth="1px"
                    borderTopColor="border.subtle"
                >
                    <CalloutRow label="Upside" tone="upside">
                        <Markdown inline>{value.upside}</Markdown>
                    </CalloutRow>
                    <CalloutRow label="Risks" tone="risk">
                        {match(value.risks, {
                            some: (risks) => <Markdown inline>{risks}</Markdown>,
                            none: () => <Text as="span" color="fg.subtle" fontStyle="italic">none material</Text>,
                        })}
                    </CalloutRow>
                    {match(value.unknowns, {
                        some: (unknowns) => (
                            <CalloutRow label="Don't know" tone="unknown">
                                <Markdown inline>{unknowns}</Markdown>
                            </CalloutRow>
                        ),
                        none: () => null,
                    })}
                </Stack>

                {/* ─── Zone 5: Action footer. Muted bg.canvas surface so
                       the actions have somewhere to land. Top hairline,
                       16 px vertical / 20 px horizontal padding. Primary
                       at size="lg" (40 px); aside link pinned ml="auto". */}
                <Flex
                    px="5"
                    py="4"
                    bg="gray.50"
                    borderTopWidth="1px"
                    borderTopColor="border.subtle"
                    align="center"
                    gap="3"
                >
                    {value.actions.map((action, i) => (
                        <EastChakraComponent
                            key={i}
                            value={action}
                            storageKey={`${storageKey}.actions.${i}`}
                        />
                    ))}
                    {match(value.aside, {
                        some: (aside) => (
                            <Box ml="auto">
                                <AsideLink value={aside} />
                            </Box>
                        ),
                        none: () => null,
                    })}
                </Flex>
            </Stack>
        </Box>
    );
}

// ============================================================================
// Aside link — small text-link, brand-600, underline-on-hover.
// Renderer-owned chrome; not a button.
// ============================================================================

type AsideValue = ValueTypeOf<typeof DecisionBriefAsideType>;

function AsideLink({ value }: { value: AsideValue }) {
    // Defensive: the decoder may emit `onClick` as the option-shape, or
    // (when none) as `undefined` depending on how nested options are
    // serialised. Treat both as "no handler".
    const onClick = !value.onClick
        ? undefined
        : match(value.onClick, {
            some: (fn) => () => queueMicrotask(() => fn()),
            none: () => undefined,
          });
    return (
        <Box
            as="button"
            textStyle="body.sm"
            color="brand.600"
            fontWeight="medium"
            cursor="pointer"
            background="transparent"
            border="none"
            p="0"
            _hover={{ textDecoration: "underline", color: "brand.700" }}
            _focusVisible={{ boxShadow: "focus", outline: "none", borderRadius: "sm" }}
            onClick={onClick}
        >
            {value.label}
        </Box>
    );
}

// ============================================================================
// Side-effect — register the renderer on module load.
// ============================================================================

implementUIComponent(Brief.Component, EastChakraDecisionBrief);
