/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Steps, UIComponentType } from "@elaraai/east-ui";

export const stepsOnboarding = example({
    keywords: ["Steps", "Root", "Item", "onboarding", "linear"],
    description: "4-step linear onboarding with active = step 2",
    fn: East.function([], UIComponentType, (_$) => {
        return Steps.Root([
            Steps.Item("Upload data", "completed"),
            Steps.Item("Validate rows", "completed"),
            Steps.Item("Map fields", "active"),
            Steps.Item("Confirm", "pending"),
        ], { activeIndex: 2n, style: { orientation: "horizontal" } });
    }),
    inputs: [],
});

export const stepsVerticalError = example({
    keywords: ["Steps", "Item", "status", "error", "vertical"],
    description: "Vertical steps with one item in error status",
    fn: East.function([], UIComponentType, (_$) => {
        return Steps.Root([
            Steps.Item("Extract", "completed", {
                description: "Pulled 3,200 rows in 2.1s",
                icon: { prefix: "fas", name: "database" },
            }),
            Steps.Item("Transform", "error", {
                description: "Schema mismatch on row 1,842",
                icon: { prefix: "fas", name: "arrow-right-arrow-left" },
            }),
            Steps.Item("Load", "pending", {
                description: "Waiting on Transform",
                icon: { prefix: "fas", name: "database" },
            }),
        ], {
            activeIndex: 1n,
            style: { orientation: "vertical", errorColor: "#dc2626" },
        });
    }),
    inputs: [],
});

export const stepsCompletedRun = example({
    keywords: ["Steps", "Item", "status", "completed", "skipped"],
    description: "All-completed run showing each StepStatus variant",
    fn: East.function([], UIComponentType, (_$) => {
        return Steps.Root([
            Steps.Item("Queued", "completed"),
            Steps.Item("Pre-flight", "completed"),
            Steps.Item("Advisory checks", "skipped"),
            Steps.Item("Commit", "completed"),
        ], {
            activeIndex: 3n,
            style: {
                orientation: "horizontal",
                completedColor: "#16a34a",
                skippedColor: "#6b7280",
                connectorColor: "#e5e7eb",
            },
        });
    }),
    inputs: [],
});
