/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, NullType, StringType, example } from "@elaraai/east";
import { Accordion, Box, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const accordionBasic = example({
    keywords: ["Accordion", "Root", "Item", "basic", "collapsible"],
    description: "Simple collapsible sections",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Accordion.Root([
                Accordion.Item("item-1", "What is East UI?", [
                    Box.Root([Text.Root("East UI is a typed UI component library for building data-driven applications.")], { padding: "4" }),
                ]),
                Accordion.Item("item-2", "How do I install it?", [
                    Box.Root([Text.Root("Run npm install @elaraai/east-ui to add it to your project.")], { padding: "4" }),
                ]),
                Accordion.Item("item-3", "Is it open source?", [
                    Box.Root([Text.Root("Yes, East UI is available under the AGPL-3.0 license.")], { padding: "4" }),
                ]),
            ]),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const accordionMultiple = example({
    keywords: ["Accordion", "Root", "Item", "multiple"],
    description: "Allow multiple sections open at once",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Accordion.Root([
                Accordion.Item("section-1", "Section 1", [
                    Box.Root([Text.Root("Content for the first section. This panel can stay open while others are opened.")], { padding: "4" }),
                ]),
                Accordion.Item("section-2", "Section 2", [
                    Box.Root([Text.Root("Content for the second section. Multiple panels can be expanded simultaneously.")], { padding: "4" }),
                ]),
                Accordion.Item("section-3", "Section 3", [
                    Box.Root([Text.Root("Content for the third section.")], { padding: "4" }),
                ]),
            ], {
                multiple: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const accordionCollapsible = example({
    keywords: ["Accordion", "Root", "Item", "collapsible"],
    description: "All panels can be collapsed",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Accordion.Root([
                Accordion.Item("a", "Panel A", [
                    Box.Root([Text.Root("This accordion allows all panels to be collapsed.")], { padding: "4" }),
                ]),
                Accordion.Item("b", "Panel B", [
                    Box.Root([Text.Root("Click an open panel's trigger to collapse it.")], { padding: "4" }),
                ]),
            ], {
                collapsible: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const accordionFaq = example({
    keywords: ["Accordion", "Root", "Item", "faq", "settings"],
    description: "Profile settings — three collapsible sections",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Accordion.Root([
                Accordion.Item("profile", "Profile Settings", [
                    Box.Root([Text.Root("Manage your profile information and preferences.")], { padding: "4" }),
                ]),
                Accordion.Item("security", "Security", [
                    Box.Root([Text.Root("Configure password, two-factor authentication, and security options.")], { padding: "4" }),
                ]),
                Accordion.Item("notifications", "Notifications", [
                    Box.Root([Text.Root("Control email and push notification preferences.")], { padding: "4" }),
                ]),
            ], {
                collapsible: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const accordionInteractive = example({
    keywords: ["Accordion", "Root", "Reactive", "State", "onValueChange", "interactive"],
    description: "Expand/collapse to see onValueChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const expandedBind = $.let(State.bind([ArrayType(StringType)], "accordion_expanded", []));
            const expanded = $.let(expandedBind.read(), ArrayType(StringType));

            const onValueChange = $.const(East.function(
                [ArrayType(StringType)],
                NullType,
                ($, newValue) => {
                    $(expandedBind.write(newValue));
                }
            ));

            return Stack.VStack([
                Box.Root([
                    Accordion.Root([
                        Accordion.Item("intro", "Introduction", [
                            Box.Root([Text.Root("Welcome! This is the introduction section.")], { padding: "4" }),
                        ]),
                        Accordion.Item("features", "Features", [
                            Box.Root([Text.Root("Explore the amazing features available.")], { padding: "4" }),
                        ]),
                        Accordion.Item("help", "Help & Support", [
                            Box.Root([Text.Root("Get help and support for any issues.")], { padding: "4" }),
                        ]),
                    ], {
                        multiple: true,
                        collapsible: true,
                        onValueChange,
                    }),
                ], { width: "100%" }),
                Text.Presets.Eyebrow(East.str`EXPANDED · ${expanded.size()}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

// -----------------------------------------------------------------------------
// Rich-trigger examples — bsys grammar: status = dot + word, counts = mono numeral
// -----------------------------------------------------------------------------

export const accordionGridTrigger = example({
    keywords: ["Accordion", "Root", "Item", "title", "meta", "count"],
    description: "Accordion headers with title + trailing meta count (shift-optimiser mockup)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Accordion.Root([
                Accordion.Item(
                    "red-vintage",
                    "Red Vintage",
                    [Box.Root([Text.Root("Detail panel — per-block schedule, assumptions, guardrails.")], { padding: "4" })],
                    { meta: "3,200 kg · 17–23 Mar" },
                ),
                Accordion.Item(
                    "white-sauv",
                    "White Sauvignon",
                    [Box.Root([Text.Root("White Sauv detail panel.")], { padding: "4" })],
                    { meta: "1,800 kg · 17–23 Mar" },
                ),
            ], {
                multiple: true,
                collapsible: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const accordionReactiveMulti = example({
    keywords: ["Accordion", "Root", "Reactive", "State", "multiple", "controlled", "count"],
    description: "Reactive multi-open accordion with mono-numeral counts on each trigger",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([ArrayType(StringType)], "accordion_reactive_multi", []));
            const expanded = $.let(bind.read(), ArrayType(StringType));
            const onValueChange = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Accordion.Root([
                Accordion.Item(
                    "recipe",
                    "Recipe",
                    [Box.Root([Text.Root("Recipe detail")], { padding: "4" })],
                    { meta: "12 inputs" },
                ),
                Accordion.Item(
                    "schedule",
                    "Schedule",
                    [Box.Root([Text.Root("Schedule detail")], { padding: "4" })],
                    { meta: "3 conflicts" },
                ),
                Accordion.Item(
                    "cost",
                    "Cost",
                    [Box.Root([Text.Root("Cost detail")], { padding: "4" })],
                    { meta: East.str`${East.print(expanded.size())} open` },
                ),
            ], {
                multiple: true,
                collapsible: true,
                value: expanded,
                onValueChange,
            });
        }));
    }),
    inputs: [],
});
