/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Banner, Button, Reactive, State, UIComponentType } from "@elaraai/east-ui";

export const bannerStaleData = example({
    keywords: ["Banner", "warning", "stale", "refresh"],
    description: "Warning banner for stale data with a refresh action",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("warning", "Data last refreshed 48m ago", {
            description: "Some metrics may be stale.",
            actions: Button.Root("Refresh", { style: { variant: "subtle" } }),
        });
    }),
    inputs: [],
});

export const bannerFrozenScenario = example({
    keywords: ["Banner", "info", "frozen scenario"],
    description: "Info banner indicating the scenario is frozen and not editable",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("info", "You're viewing a frozen scenario", {
            description: "Editing is disabled. Duplicate the scenario to make changes.",
        });
    }),
    inputs: [],
});

export const bannerRunWarnings = example({
    keywords: ["Banner", "warning", "actions", "run"],
    description: "Warning banner with a primary review action",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("warning", "3 warnings on this run", {
            description: "Review before promoting to production.",
            actions: Button.Root("Review", { style: { variant: "solid", colorPalette: "yellow" } }),
        });
    }),
    inputs: [],
});

export const bannerDismissible = example({
    keywords: ["Banner", "dismissible", "onDismiss", "Reactive", "State"],
    description: "Dismissible banner wired to State.bind",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([BooleanType], "banner_dismissed", false));
            const onDismiss = $.const(East.function([], NullType, $ => {
                $(bind.write(true));
            }));
            return Banner.Root("info", "Welcome back", {
                description: "You have 3 pending approvals waiting for your review.",
                dismissible: true,
                onDismiss,
            });
        }));
    }),
    inputs: [],
});
