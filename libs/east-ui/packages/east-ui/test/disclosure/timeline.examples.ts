/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Timeline, UIComponentType } from "@elaraai/east-ui";

export const timelineAuditTrail = example({
    keywords: ["Timeline", "Root", "Item", "audit", "trail", "status"],
    description: "Vertical audit trail with timestamps + icons + per-status colour",
    fn: East.function([], UIComponentType, (_$) => {
        return Timeline.Root([
            Timeline.Item("Commit created", "completed", {
                timestamp: new Date("2025-03-17T09:00:00Z"),
                description: "12 changes staged",
                indicator: { prefix: "fas", name: "code-commit" },
                badgeLabel: "auto-commit",
            }),
            Timeline.Item("Commit approved", "completed", {
                timestamp: new Date("2025-03-17T09:15:00Z"),
                description: "Approved by cmorrison@elara.ai",
                indicator: { prefix: "fas", name: "check" },
            }),
            Timeline.Item("Commit executed", "active", {
                timestamp: new Date("2025-03-17T10:00:00Z"),
                description: "Applying changes to production",
                indicator: { prefix: "fas", name: "play" },
            }),
        ], {
            style: {
                orientation: "vertical",
                completedColor: "#16a34a",
                activeColor: "#3d5cff",
            },
        });
    }),
    inputs: [],
});

export const timelineHorizontalLineage = example({
    keywords: ["Timeline", "horizontal", "lineage", "orientation"],
    description: "Horizontal lineage ribbon tracing upstream → current",
    fn: East.function([], UIComponentType, (_$) => {
        return Timeline.Root([
            Timeline.Item("Extract", "completed", {
                indicator: { prefix: "fas", name: "database" },
            }),
            Timeline.Item("Transform", "completed", {
                indicator: { prefix: "fas", name: "arrow-right-arrow-left" },
            }),
            Timeline.Item("Validate", "active", {
                indicator: { prefix: "fas", name: "check-double" },
            }),
            Timeline.Item("Load", "pending", {
                indicator: { prefix: "fas", name: "upload" },
            }),
        ], {
            style: {
                orientation: "horizontal",
                size: "sm",
                connectorColor: "#e5e7eb",
            },
        });
    }),
    inputs: [],
});

export const timelineCommitApproval = example({
    keywords: ["Timeline", "commit", "approval", "status", "skipped", "error"],
    description: "Commit approval trail with skipped + error statuses",
    fn: East.function([], UIComponentType, (_$) => {
        return Timeline.Root([
            Timeline.Item("Created", "completed", {
                timestamp: new Date("2025-03-17T09:00:00Z"),
            }),
            Timeline.Item("Advisory checks", "skipped", {
                timestamp: new Date("2025-03-17T09:02:00Z"),
                description: "Optional safety checks waived",
            }),
            Timeline.Item("Review", "error", {
                timestamp: new Date("2025-03-17T09:10:00Z"),
                description: "Validation failed: row 1,842 — expected INT, got STRING",
                badgeLabel: "blocked",
            }),
        ], {
            style: {
                orientation: "vertical",
                completedColor: "#16a34a",
                skippedColor: "#6b7280",
                errorColor: "#dc2626",
            },
        });
    }),
    inputs: [],
});
