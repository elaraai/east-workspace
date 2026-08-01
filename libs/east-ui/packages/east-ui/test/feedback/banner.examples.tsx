/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Banner, Button, HStack, Reactive, Separator, VStack } from "@elaraai/east-ui";

// ============================================================================
// Status variants — the Banner status grammar's visual guard (epic #455).
// ============================================================================

export const bannerStatusVariants = example({
    keywords: ["Banner", "stale", "dashed", "refresh", "info", "partial", "guard", "warning", "actions", "change", "saved", "success", "commit", "undo", "view", "sync", "progress"],
    description: "Banner status variant panel — stale data (paper-2 dashed grey, mono caption, refresh action), frozen scenario (partial-info: frozen, not editable), run warnings (guardrail warning with brand-d review action), scenario saved (change-state brand-tint, replaces the success toast), commit landed (Undo + View actions), sync progress (persistent info, dismissible by close button)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="STALE DATA" align="start" />
                <Banner
                        status="stale"
                        title="Data last refreshed 48m ago"
                        description="Some metrics may be stale."
                        actions={<Button variant="outline">Refresh</Button>}
                    />
                <Separator label="FROZEN SCENARIO" align="start" />
                <Banner
                        status="info"
                        title="You're viewing a frozen scenario"
                        description="Editing is disabled. Duplicate the scenario to make changes."
                    />
                <Separator label="RUN WARNINGS" align="start" />
                <Banner
                        status="guard"
                        title="3 warnings on this run"
                        description="Review before promoting to production."
                        actions={<Button variant="solid">Review</Button>}
                    />
                <Separator label="SCENARIO SAVED" align="start" />
                <Banner status="change" title="Scenario saved" description="Your changes are committed." dismissible />
                <Separator label="COMMIT LANDED" align="start" />
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
                <Separator label="SYNC PROGRESS" align="start" />
                <Banner status="info" title="Background sync in progress" description="Stays visible until dismissed." dismissible />
            </VStack>
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
