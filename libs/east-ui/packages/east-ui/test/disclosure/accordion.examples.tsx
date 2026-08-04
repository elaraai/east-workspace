/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, StringType, StructType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Accordion, Box, Configurator, HStack, SegmentGroup, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

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
// Accordion — live configurator over the content + behaviour axes
// ============================================================================

export const accordionVariants = example({
    keywords: ["Accordion", "Root", "Item", "multiple", "collapsible", "faq", "settings", "title", "meta", "count", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onValueChange", "interactive", "controlled"],
    description: "Accordion configurator — a content-preset axis plus multiple and collapsible switches driving one live accordion; the aside is a controlled multi-open accordion with live counts",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Only the content needs a struct — a preset is its items PLUS
                // the label the segment control names it by, so there is no
                // single value to key it on.
                const presets = $.const([
                    {
                        label: "basic",
                        items: [
                            Accordion.Item("section-1", "Section 1", [<Box padding="4"><Text>Content for the first section. This panel can stay open while others are opened.</Text></Box>]),
                            Accordion.Item("section-2", "Section 2", [<Box padding="4"><Text>Content for the second section. Multiple panels can be expanded simultaneously.</Text></Box>]),
                            Accordion.Item("section-3", "Section 3", [<Box padding="4"><Text>Content for the third section.</Text></Box>]),
                        ],
                    },
                    {
                        label: "faq",
                        items: [
                            Accordion.Item("profile", "Profile Settings", [<Box padding="4"><Text>Manage your profile information and preferences.</Text></Box>]),
                            Accordion.Item("security", "Security", [<Box padding="4"><Text>Configure password, two-factor authentication, and security options.</Text></Box>]),
                            Accordion.Item("notifications", "Notifications", [<Box padding="4"><Text>Control email and push notification preferences.</Text></Box>]),
                        ],
                    },
                    {
                        label: "grid",
                        items: [
                            Accordion.Item("block-a", "Block A", [<Box padding="4"><Text>Detail panel — per-block schedule, assumptions, guardrails.</Text></Box>], { meta: "3,200 kg · 17–23 Mar" }),
                            Accordion.Item("block-b", "Block B", [<Box padding="4"><Text>Block B detail panel.</Text></Box>], { meta: "1,800 kg · 17–23 Mar" }),
                        ],
                    },
                ], ArrayType(StructType({ label: StringType, items: ArrayType(Accordion.Types.Item) })));

                const contentBind     = $.let(State.bind([StringType], "accordion_content", "basic"));
                const multipleBind    = $.let(State.bind([BooleanType], "accordion_multiple", false));
                const collapsibleBind = $.let(State.bind([BooleanType], "accordion_collapsible", true));
                // The aside is the reactive row — a controlled multi-open
                // accordion whose value round-trips through State (the old
                // reactive panel's key).
                const expandedBind    = $.let(State.bind([ArrayType(StringType)], "accordion_reactive_multi", []));

                const cKey        = $.let(contentBind.read());
                const multiple    = $.let(multipleBind.read());
                const collapsible = $.let(collapsibleBind.read());
                const expanded    = $.let(expandedBind.read(), ArrayType(StringType));

                const onContent     = $.const(East.function([StringType], NullType, ($, next) => { $(contentBind.write(next)); }));
                const onMultiple    = $.const(East.function([BooleanType], NullType, ($, next) => { $(multipleBind.write(next)); }));
                const onCollapsible = $.const(East.function([BooleanType], NullType, ($, next) => { $(collapsibleBind.write(next)); }));
                const onValueChange = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => { $(expandedBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const preset = $.let(presets.filter((_$, o) => o.label.equal(cKey)).get(0n));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Content", cKey,
                                <SegmentGroup value={cKey} onChange={onContent} size="sm"
                                    items={presets.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as the
                            // Multiple / Collapsible spec rows below rather than as
                            // one value.
                            Configurator.Slot("Behaviour",
                                <HStack gap="5" align="center">
                                    <Switch checked={multiple} label="Multiple" onChange={onMultiple} />
                                    <Switch checked={collapsible} label="Collapsible" onChange={onCollapsible} />
                                </HStack>),
                        ]}
                        preview={
                            <Box width="100%">
                                <Accordion items={preset.items} multiple={multiple} collapsible={collapsible} />
                            </Box>
                        }
                        aside={{
                            label: "Controlled · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
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
                                    {<Text.Eyebrow>{East.str`EXPANDED · ${expanded.size()}`}</Text.Eyebrow>}
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Sections", East.print(preset.items.size())),
                            Configurator.Spec("Multiple", multiple.ifElse(_$ => "on", _$ => "off")),
                            Configurator.Spec("Collapsible", collapsible.ifElse(_$ => "on", _$ => "off")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

