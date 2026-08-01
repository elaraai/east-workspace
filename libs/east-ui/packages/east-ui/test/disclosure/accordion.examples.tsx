/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Accordion, Box, Text, VStack, Reactive } from "@elaraai/east-ui";

export const accordionBasic = example({
    keywords: ["Accordion", "Root", "Item", "basic", "collapsible"],
    description: "Simple collapsible sections",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box width="100%">
                <Accordion
                    items={[
                        Accordion.Item("item-1", "What is East UI?", [<Box padding="4"><Text>East UI is a typed UI component library for building data-driven applications.</Text></Box>]),
                        Accordion.Item("item-2", "How do I install it?", [<Box padding="4"><Text>Run npm install @elaraai/east-ui to add it to your project.</Text></Box>]),
                        Accordion.Item("item-3", "Is it open source?", [<Box padding="4"><Text>Yes, East UI is available under the AGPL-3.0 license.</Text></Box>]),
                    ]}
                />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const accordionVariants = example({
    keywords: ["Accordion", "Root", "Item", "multiple", "collapsible", "faq", "settings", "title", "meta", "count"],
    description: "Accordion variant panel — multiple (multiple sections open at once), collapsible (all panels can be collapsed), faq (profile settings — three collapsible sections), grid trigger (headers with title + trailing meta count, scheduling mockup)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">MULTIPLE</Text>
                    <Box width="100%">
                        <Accordion
                            items={[
                                Accordion.Item("section-1", "Section 1", [<Box padding="4"><Text>Content for the first section. This panel can stay open while others are opened.</Text></Box>]),
                                Accordion.Item("section-2", "Section 2", [<Box padding="4"><Text>Content for the second section. Multiple panels can be expanded simultaneously.</Text></Box>]),
                                Accordion.Item("section-3", "Section 3", [<Box padding="4"><Text>Content for the third section.</Text></Box>]),
                            ]}
                            multiple={true}
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLLAPSIBLE</Text>
                    <Box width="100%">
                        <Accordion
                            items={[
                                Accordion.Item("a", "Panel A", [<Box padding="4"><Text>This accordion allows all panels to be collapsed.</Text></Box>]),
                                Accordion.Item("b", "Panel B", [<Box padding="4"><Text>Click an open panel’s trigger to collapse it.</Text></Box>]),
                            ]}
                            collapsible={true}
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FAQ</Text>
                    <Box width="100%">
                        <Accordion
                            items={[
                                Accordion.Item("profile", "Profile Settings", [<Box padding="4"><Text>Manage your profile information and preferences.</Text></Box>]),
                                Accordion.Item("security", "Security", [<Box padding="4"><Text>Configure password, two-factor authentication, and security options.</Text></Box>]),
                                Accordion.Item("notifications", "Notifications", [<Box padding="4"><Text>Control email and push notification preferences.</Text></Box>]),
                            ]}
                            collapsible={true}
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">GRID TRIGGER</Text>
                    <Box width="100%">
                        <Accordion
                            items={[
                                Accordion.Item("block-a", "Block A", [<Box padding="4"><Text>Detail panel — per-block schedule, assumptions, guardrails.</Text></Box>], { meta: "3,200 kg · 17–23 Mar" }),
                                Accordion.Item("block-b", "Block B", [<Box padding="4"><Text>Block B detail panel.</Text></Box>], { meta: "1,800 kg · 17–23 Mar" }),
                            ]}
                            multiple={true}
                            collapsible={true}
                        />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Reactive — interactive/controlled rows (consolidation epic #455).
// ============================================================================

export const accordionReactive = example({
    keywords: ["Accordion", "Root", "Reactive", "State", "onValueChange", "interactive", "multiple", "controlled", "count"],
    description: "Reactive accordion panel — interactive (expand/collapse to see the onValueChange callback), reactive multi (controlled multi-open accordion with mono-numeral counts on each trigger)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTERACTIVE</Text>
                    <Reactive>{$ => {
                        const expandedBind = $.let(State.bind([ArrayType(StringType)], "accordion_expanded", []));
                        const expanded = $.let(expandedBind.read(), ArrayType(StringType));
                        const onValueChange = $.const(East.function([ArrayType(StringType)], NullType, ($, newValue) => {
                            $(expandedBind.write(newValue));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Box width="100%">
                                    <Accordion
                                        items={[
                                            Accordion.Item("intro", "Introduction", [<Box padding="4"><Text>Welcome! This is the introduction section.</Text></Box>]),
                                            Accordion.Item("features", "Features", [<Box padding="4"><Text>Explore the amazing features available.</Text></Box>]),
                                            Accordion.Item("help", "Help & Support", [<Box padding="4"><Text>Get help and support for any issues.</Text></Box>]),
                                        ]}
                                        multiple={true}
                                        collapsible={true}
                                        onValueChange={onValueChange}
                                    />
                                </Box>
                                {<Text.Eyebrow>{East.str`EXPANDED · ${expanded.size()}`}</Text.Eyebrow>}
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">REACTIVE MULTI</Text>
                    <Reactive>{$ => {
                        const bind = $.let(State.bind([ArrayType(StringType)], "accordion_reactive_multi", []));
                        const expanded = $.let(bind.read(), ArrayType(StringType));
                        const onValueChange = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => {
                            $(bind.write(next));
                        }));
                        return (
                            <Accordion
                                items={[
                                    Accordion.Item("recipe", "Recipe", [<Box padding="4"><Text>Recipe detail</Text></Box>], { meta: "12 inputs" }),
                                    Accordion.Item("schedule", "Schedule", [<Box padding="4"><Text>Schedule detail</Text></Box>], { meta: "3 conflicts" }),
                                    Accordion.Item("cost", "Cost", [<Box padding="4"><Text>Cost detail</Text></Box>], { meta: East.str`${East.print(expanded.size())} open` }),
                                ]}
                                multiple={true}
                                collapsible={true}
                                value={expanded}
                                onValueChange={onValueChange}
                            />
                        );
                    }}</Reactive>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
