/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, ArrayType, NullType, StringType, example } from "@elaraai/east";
import { Accordion, Badge, Box, Reactive, Stack, State, Text, UIComponentType } from "../../src/index.js";

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

export const accordionEnclosed = example({
    keywords: ["Accordion", "Root", "Item", "variant", "enclosed", "bordered"],
    description: "Bordered accordion style",
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
                variant: "enclosed",
                collapsible: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const accordionSubtle = example({
    keywords: ["Accordion", "Root", "Item", "variant", "subtle"],
    description: "Light background styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Accordion.Root([
                Accordion.Item("faq-1", "How do I reset my password?", [
                    Box.Root([Text.Root("Click on 'Forgot Password' on the login page and follow the instructions sent to your email.")], { padding: "4" }),
                ]),
                Accordion.Item("faq-2", "Can I change my username?", [
                    Box.Root([Text.Root("Yes, go to Settings > Profile > Edit Username.")], { padding: "4" }),
                ]),
            ], {
                variant: "subtle",
                collapsible: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const accordionPlain = example({
    keywords: ["Accordion", "Root", "Item", "variant", "plain"],
    description: "No visible borders",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Accordion.Root([
                Accordion.Item("topic-1", "Getting Started", [
                    Box.Root([Text.Root("Learn the basics of using our platform.")], { padding: "4" }),
                ]),
                Accordion.Item("topic-2", "Advanced Features", [
                    Box.Root([Text.Root("Explore powerful features for advanced users.")], { padding: "4" }),
                ]),
            ], {
                variant: "plain",
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
            const expanded = $.let(expandedBind.read());

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
                        variant: "enclosed",
                        onValueChange,
                    }),
                ], { width: "100%" }),
                Badge.Root(
                    East.str`Expanded: ${expanded.size()}`,
                    { colorPalette: "green", variant: "solid" }
                ),
                Text.Root(East.str`Sections expanded: ${expanded.size()}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
