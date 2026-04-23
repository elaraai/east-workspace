/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { Badge, Box, Reactive, Stack, State, Tabs, Text, UIComponentType } from "@elaraai/east-ui";

export const tabsBasic = example({
    keywords: ["Tabs", "Root", "Item", "defaultValue", "basic"],
    description: "Simple tabbed interface",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Tabs.Root([
                Tabs.Item("overview", "Overview", [
                    Box.Root([Text.Root("Welcome to the overview tab. This is the default content panel.")], { padding: "4" }),
                ]),
                Tabs.Item("features", "Features", [
                    Box.Root([Text.Root("Explore our features in this panel.")], { padding: "4" }),
                ]),
                Tabs.Item("pricing", "Pricing", [
                    Box.Root([Text.Root("View pricing information here.")], { padding: "4" }),
                ]),
            ], {
                defaultValue: "overview",
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const tabsLine = example({
    keywords: ["Tabs", "Root", "variant", "line", "underline"],
    description: "Underline indicator style",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Tabs.Root([
                Tabs.Item("tab1", "Account", [
                    Box.Root([Text.Root("Manage your account settings and preferences.")], { padding: "4" }),
                ]),
                Tabs.Item("tab2", "Security", [
                    Box.Root([Text.Root("Configure security options and two-factor authentication.")], { padding: "4" }),
                ]),
                Tabs.Item("tab3", "Billing", [
                    Box.Root([Text.Root("View billing history and update payment methods.")], { padding: "4" }),
                ]),
            ], {
                defaultValue: "tab1",
                style: { variant: "line" },
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const tabsEnclosed = example({
    keywords: ["Tabs", "Root", "variant", "enclosed", "bordered"],
    description: "Bordered tab container",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Tabs.Root([
                Tabs.Item("general", "General", [
                    Box.Root([Text.Root("General application settings.")], { padding: "4" }),
                ]),
                Tabs.Item("advanced", "Advanced", [
                    Box.Root([Text.Root("Advanced configuration options.")], { padding: "4" }),
                ]),
            ], {
                defaultValue: "general",
                style: { variant: "enclosed" },
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const tabsOutline = example({
    keywords: ["Tabs", "Root", "variant", "outline"],
    description: "Outlined tab buttons",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Tabs.Root([
                Tabs.Item("all", "All Items", [
                    Box.Root([Text.Root("Showing all items in the list.")], { padding: "4" }),
                ]),
                Tabs.Item("active", "Active", [
                    Box.Root([Text.Root("Showing only active items.")], { padding: "4" }),
                ]),
                Tabs.Item("archived", "Archived", [
                    Box.Root([Text.Root("Showing archived items.")], { padding: "4" }),
                ]),
            ], {
                defaultValue: "all",
                style: { variant: "outline" },
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const tabsSubtle = example({
    keywords: ["Tabs", "Root", "variant", "subtle"],
    description: "Light background on selected",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Tabs.Root([
                Tabs.Item("home", "Home", [
                    Box.Root([Text.Root("Welcome to the home tab.")], { padding: "4" }),
                ]),
                Tabs.Item("profile", "Profile", [
                    Box.Root([Text.Root("Your profile information.")], { padding: "4" }),
                ]),
                Tabs.Item("settings", "Settings", [
                    Box.Root([Text.Root("Application settings.")], { padding: "4" }),
                ]),
            ], {
                defaultValue: "home",
                style: { variant: "subtle" },
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const tabsFitted = example({
    keywords: ["Tabs", "Root", "fitted", "equal width"],
    description: "Equal width tabs",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Tabs.Root([
                Tabs.Item("day", "Day", [
                    Box.Root([Text.Root("Daily view of your calendar.")], { padding: "4" }),
                ]),
                Tabs.Item("week", "Week", [
                    Box.Root([Text.Root("Weekly view of your calendar.")], { padding: "4" }),
                ]),
                Tabs.Item("month", "Month", [
                    Box.Root([Text.Root("Monthly view of your calendar.")], { padding: "4" }),
                ]),
            ], {
                defaultValue: "week",
                style: { variant: "line", fitted: true },
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const tabsSizes = example({
    keywords: ["Tabs", "Root", "size", "sm", "md", "lg"],
    description: "Small, medium, and large",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Tabs.Root([
                Tabs.Item("sm1", "Small", [Box.Root([Text.Root("Small size tabs")], { padding: "4" })]),
                Tabs.Item("sm2", "Tabs", [Box.Root([Text.Root("Content")], { padding: "4" })]),
            ], { defaultValue: "sm1", style: { size: "sm", variant: "line" } }),
            Tabs.Root([
                Tabs.Item("md1", "Medium", [Box.Root([Text.Root("Medium size tabs")], { padding: "4" })]),
                Tabs.Item("md2", "Tabs", [Box.Root([Text.Root("Content")], { padding: "4" })]),
            ], { defaultValue: "md1", style: { size: "md", variant: "line" } }),
            Tabs.Root([
                Tabs.Item("lg1", "Large", [Box.Root([Text.Root("Large size tabs")], { padding: "4" })]),
                Tabs.Item("lg2", "Tabs", [Box.Root([Text.Root("Content")], { padding: "4" })]),
            ], { defaultValue: "lg1", style: { size: "lg", variant: "line" } }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const tabsWithDisabled = example({
    keywords: ["Tabs", "Item", "disabled"],
    description: "One tab is disabled",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Tabs.Root([
                Tabs.Item("enabled1", "Enabled", [
                    Box.Root([Text.Root("This tab is enabled.")], { padding: "4" }),
                ]),
                Tabs.Item("disabled", "Disabled", [
                    Box.Root([Text.Root("This content is not accessible.")], { padding: "4" }),
                ], { disabled: true }),
                Tabs.Item("enabled2", "Also Enabled", [
                    Box.Root([Text.Root("This tab is also enabled.")], { padding: "4" }),
                ]),
            ], {
                defaultValue: "enabled1",
                style: { variant: "line" },
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const tabsInteractive = example({
    keywords: ["Tabs", "Root", "Reactive", "State", "onValueChange", "interactive"],
    description: "Click tabs to see onValueChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const selectedBind = $.let(State.bind([StringType], "tabs_selected", "tab1"));
            const selected = $.let(selectedBind.read());

            const onValueChange = $.const(East.function(
                [StringType],
                NullType,
                ($, newValue) => {
                    $(selectedBind.write(newValue));
                }
            ));

            return Stack.VStack([
                Box.Root([
                    Tabs.Root([
                        Tabs.Item("tab1", "Dashboard", [
                            Box.Root([Text.Root("Dashboard content - view your metrics here.")], { padding: "4" }),
                        ]),
                        Tabs.Item("tab2", "Analytics", [
                            Box.Root([Text.Root("Analytics content - detailed reports and charts.")], { padding: "4" }),
                        ]),
                        Tabs.Item("tab3", "Settings", [
                            Box.Root([Text.Root("Settings content - configure your preferences.")], { padding: "4" }),
                        ]),
                    ], {
                        defaultValue: "tab1",
                        onValueChange,
                        style: { variant: "line" },
                    }),
                ], { width: "100%" }),
                Badge.Root(
                    East.str`Selected tab: ${selected}`,
                    { colorPalette: "blue", variant: "solid" }
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

// -----------------------------------------------------------------------------
// Plan 1.9 new examples
// -----------------------------------------------------------------------------

export const tabsWithCountBadges = example({
    keywords: ["Tabs", "Root", "Item", "trigger", "Badge", "count", "rich"],
    description: "Rich trigger with an inline count badge (Results · 5)",
    fn: East.function([], UIComponentType, (_$) => {
        return Tabs.Root([
            Tabs.Item("inputs", "Inputs", [
                Box.Root([Text.Root("Three inputs are defined.")], { padding: "4" }),
            ]),
            Tabs.Item(
                "results",
                Stack.HStack([
                    Text.Root("Results"),
                    Badge.Root("5", { colorPalette: "blue", variant: "subtle" }),
                ], { gap: "2", align: "center" }),
                [Box.Root([Text.Root("Five results computed.")], { padding: "4" })],
            ),
        ], {
            defaultValue: "inputs",
            style: { variant: "line" },
        });
    }),
    inputs: [],
});

export const tabsTwoLine = example({
    keywords: ["Tabs", "Root", "Item", "trigger", "two-line", "rich"],
    description: "Rich two-line trigger mirroring the shift-optimiser Week / Vintage header",
    fn: East.function([], UIComponentType, (_$) => {
        return Tabs.Root([
            Tabs.Item(
                "week-06",
                Stack.VStack([
                    Text.Root("Week 06", { fontWeight: "semibold" }),
                    Text.Root("Vintage · 3–9 Feb", { color: "fg.muted" }),
                ], { gap: "0", align: "flex-start" }),
                [Box.Root([Text.Root("Week 06 detail.")], { padding: "4" })],
            ),
            Tabs.Item(
                "week-12",
                Stack.VStack([
                    Text.Root("Week 12", { fontWeight: "semibold" }),
                    Text.Root("Vintage · 17–23 Mar", { color: "fg.muted" }),
                ], { gap: "0", align: "flex-start" }),
                [Box.Root([Text.Root("Week 12 detail.")], { padding: "4" })],
            ),
        ], {
            defaultValue: "week-06",
            style: { variant: "enclosed" },
        });
    }),
    inputs: [],
});

export const tabsReactive = example({
    keywords: ["Tabs", "Root", "Reactive", "State", "controlled", "onValueChange"],
    description: "Reactive controlled Tabs with a live active-tab indicator",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([StringType], "tabs_reactive_active", "a"));
            const active = $.let(bind.read());
            const onValueChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Stack.VStack([
                Tabs.Root([
                    Tabs.Item("a", "Tab A", [Box.Root([Text.Root("A content")], { padding: "4" })]),
                    Tabs.Item("b", "Tab B", [Box.Root([Text.Root("B content")], { padding: "4" })]),
                    Tabs.Item("c", "Tab C", [Box.Root([Text.Root("C content")], { padding: "4" })]),
                ], {
                    value: active,
                    onValueChange,
                    style: { variant: "line" },
                }),
                Text.Root(East.str`Active: ${active}`, { color: "fg.muted" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
