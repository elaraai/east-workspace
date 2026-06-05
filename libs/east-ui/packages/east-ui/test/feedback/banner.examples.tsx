/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Banner, Button, HStack, Reactive } from "@elaraai/east-ui";

export const bannerStaleData = example({
    keywords: ["Banner", "stale", "dashed", "refresh"],
    description: "Stale-data banner — paper-2 dashed grey, mono caption, refresh action",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Banner
                status="stale"
                title="Data last refreshed 48m ago"
                description="Some metrics may be stale."
                actions={<Button variant="outline">Refresh</Button>}
            />
        );
    }),
    inputs: [],
});

export const bannerFrozenScenario = example({
    keywords: ["Banner", "info", "partial"],
    description: "Partial-info banner indicating the scenario is frozen and not editable",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Banner
                status="info"
                title="You're viewing a frozen scenario"
                description="Editing is disabled. Duplicate the scenario to make changes."
            />
        );
    }),
    inputs: [],
});

export const bannerRunWarnings = example({
    keywords: ["Banner", "guard", "warning", "actions"],
    description: "Guardrail-style warning banner with brand-d primary review action",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Banner
                status="guard"
                title="3 warnings on this run"
                description="Review before promoting to production."
                actions={<Button variant="solid">Review</Button>}
            />
        );
    }),
    inputs: [],
});

export const bannerDismissible = example({
    keywords: ["Banner", "dismissible", "onDismiss", "Reactive", "State"],
    description: "Dismissible info banner wired to State.bind",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([BooleanType], "banner_dismissed", false));
            const onDismiss = $.const(East.function([], NullType, $ => {
                $(bind.write(true));
            }));
            return (
                <Banner
                    status="info"
                    title="Welcome back"
                    description="You have 3 pending approvals waiting for your review."
                    dismissible
                    onDismiss={onDismiss}
                />
            );
        }}</Reactive>
    )),
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
        return (
            <Banner status="change" title="Scenario saved" description="Your changes are committed." dismissible />
        );
    }),
    inputs: [],
});

export const bannerCommitLanded = example({
    keywords: ["Banner", "change", "commit", "undo", "view"],
    description: "Commit-landed change banner with Undo + View actions (replaces toast with actions)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Banner
                status="change"
                title="Commit landed"
                description="Build #1842 is green."
                actions={
                    <HStack gap="2">
                        <Button variant="outline">Undo</Button>
                        <Button variant="outline">View</Button>
                    </HStack>
                }
                dismissible
            />
        );
    }),
    inputs: [],
});

export const bannerSyncProgress = example({
    keywords: ["Banner", "info", "sync", "progress"],
    description: "Info banner for background sync — persistent, dismissible by close button (replaces persistent toast)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Banner status="info" title="Background sync in progress" description="Stays visible until dismissed." dismissible />
        );
    }),
    inputs: [],
});
