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
                variant: "line",
                defaultValue: "tab1",
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
                variant: "enclosed",
                defaultValue: "general",
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
                variant: "outline",
                defaultValue: "all",
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
                variant: "subtle",
                defaultValue: "home",
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
                variant: "line",
                fitted: true,
                defaultValue: "week",
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
            ], { size: "sm", defaultValue: "sm1", variant: "line" }),
            Tabs.Root([
                Tabs.Item("md1", "Medium", [Box.Root([Text.Root("Medium size tabs")], { padding: "4" })]),
                Tabs.Item("md2", "Tabs", [Box.Root([Text.Root("Content")], { padding: "4" })]),
            ], { size: "md", defaultValue: "md1", variant: "line" }),
            Tabs.Root([
                Tabs.Item("lg1", "Large", [Box.Root([Text.Root("Large size tabs")], { padding: "4" })]),
                Tabs.Item("lg2", "Tabs", [Box.Root([Text.Root("Content")], { padding: "4" })]),
            ], { size: "lg", defaultValue: "lg1", variant: "line" }),
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
                variant: "line",
                defaultValue: "enabled1",
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
                        variant: "line",
                        defaultValue: "tab1",
                        onValueChange,
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
