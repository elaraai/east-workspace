/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Banner, Button, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const bannerStaleData = example({
    keywords: ["Banner", "stale", "dashed", "refresh"],
    description: "Stale-data banner — paper-2 dashed grey, mono caption, refresh action",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("stale", "Data last refreshed 48m ago", {
            description: "Some metrics may be stale.",
            actions: Button.Root("Refresh", { style: { variant: "outline" } }),
        });
    }),
    inputs: [],
});

export const bannerFrozenScenario = example({
    keywords: ["Banner", "info", "partial"],
    description: "Partial-info banner indicating the scenario is frozen and not editable",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("info", "You're viewing a frozen scenario", {
            description: "Editing is disabled. Duplicate the scenario to make changes.",
        });
    }),
    inputs: [],
});

export const bannerRunWarnings = example({
    keywords: ["Banner", "guard", "warning", "actions"],
    description: "Guardrail-style warning banner with brand-d primary review action",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("guard", "3 warnings on this run", {
            description: "Review before promoting to production.",
            actions: Button.Root("Review", { style: { variant: "solid" } }),
        });
    }),
    inputs: [],
});

export const bannerDismissible = example({
    keywords: ["Banner", "dismissible", "onDismiss", "Reactive", "State"],
    description: "Dismissible info banner wired to State.bind",
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

/**
 * Migrated from the deleted Toast primitive. Per bsys spec §Surface,
 * transient confirmations render as a Banner with status `change` (brand-tint),
 * not as an overlay toast.
 */
export const bannerScenarioSaved = example({
    keywords: ["Banner", "change", "saved", "success"],
    description: "Change-state banner — brand-tint, replaces 'scenario saved' success toast",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("change", "Scenario saved", {
            description: "Your changes are committed.",
            dismissible: true,
        });
    }),
    inputs: [],
});

export const bannerCommitLanded = example({
    keywords: ["Banner", "change", "commit", "undo", "view"],
    description: "Commit-landed change banner with Undo + View actions (replaces toast with actions)",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("change", "Commit landed", {
            description: "Build #1842 is green.",
            actions: Stack.HStack([
                Button.Root("Undo", { style: { variant: "outline" } }),
                Button.Root("View", { style: { variant: "outline" } }),
            ], { gap: "2" }),
            dismissible: true,
        });
    }),
    inputs: [],
});

export const bannerSyncProgress = example({
    keywords: ["Banner", "info", "sync", "progress"],
    description: "Info banner for background sync — persistent, dismissible by close button (replaces persistent toast)",
    fn: East.function([], UIComponentType, (_$) => {
        return Banner.Root("info", "Background sync in progress", {
            description: "Stays visible until dismissed.",
            dismissible: true,
        });
    }),
    inputs: [],
});
