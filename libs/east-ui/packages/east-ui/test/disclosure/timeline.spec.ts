/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Timeline, Text } from "@elaraai/east-ui";
import * as ex from "./timeline.examples.js";

describeEast("Timeline", (test) => {
    Assert.examples(test, {
        timelineAuditTrail: ex.timelineAuditTrail,
        timelineHorizontalLineage: ex.timelineHorizontalLineage,
        timelineCommitApproval: ex.timelineCommitApproval,
    });

    // =========================================================================
    // Timeline.Item — title + status
    // =========================================================================

    test("creates item with string title (coerced to Text.Root)", $ => {
        const item = $.let(Timeline.Item("Created", "completed"));
        $(Assert.equal(item.title.unwrap().unwrap("Text").value, "Created"));
        $(Assert.equal(item.status.hasTag("completed"), true));
        $(Assert.equal(item.timestamp.hasTag("none"), true));
        $(Assert.equal(item.description.hasTag("none"), true));
        $(Assert.equal(item.indicator.hasTag("none"), true));
        $(Assert.equal(item.badgeLabel.hasTag("none"), true));
    });

    test("creates item with rich UIComp title", $ => {
        const item = $.let(Timeline.Item(Text.Root("Rich", { fontWeight: "bold" }), "active"));
        $(Assert.equal(item.title.unwrap().unwrap("Text").value, "Rich"));
        $(Assert.equal(item.status.hasTag("active"), true));
    });

    test("creates item with timestamp", $ => {
        const ts = new Date("2025-03-17T09:00:00Z");
        const item = $.let(Timeline.Item("Created", "completed", { timestamp: ts }));
        $(Assert.equal(item.timestamp.hasTag("some"), true));
    });

    test("creates item with description + indicator + badgeLabel", $ => {
        const item = $.let(Timeline.Item("Created", "completed", {
            description: "Pulled 3,200 rows",
            indicator: { prefix: "fas", name: "check" },
            badgeLabel: "auto-commit",
        }));
        $(Assert.equal(
            item.description.unwrap("some").unwrap().unwrap("Text").value,
            "Pulled 3,200 rows",
        ));
        $(Assert.equal(item.indicator.unwrap("some").name, "check"));
        $(Assert.equal(item.badgeLabel.unwrap("some"), "auto-commit"));
    });

    test("creates item with rich UIComp description", $ => {
        const item = $.let(Timeline.Item("T", "active", {
            description: Text.Root("Rich desc"),
        }));
        $(Assert.equal(
            item.description.unwrap("some").unwrap().unwrap("Text").value,
            "Rich desc",
        ));
    });

    // =========================================================================
    // Status variants (shared with Steps)
    // =========================================================================

    test("creates item with each status variant", $ => {
        const pending = $.let(Timeline.Item("A", "pending"));
        const active = $.let(Timeline.Item("B", "active"));
        const completed = $.let(Timeline.Item("C", "completed"));
        const error = $.let(Timeline.Item("D", "error"));
        const skipped = $.let(Timeline.Item("E", "skipped"));
        $(Assert.equal(pending.status.hasTag("pending"), true));
        $(Assert.equal(active.status.hasTag("active"), true));
        $(Assert.equal(completed.status.hasTag("completed"), true));
        $(Assert.equal(error.status.hasTag("error"), true));
        $(Assert.equal(skipped.status.hasTag("skipped"), true));
    });

    // =========================================================================
    // Timeline.Root
    // =========================================================================

    test("creates timeline with items and default style", $ => {
        const t = $.let(Timeline.Root([
            Timeline.Item("A", "completed"),
            Timeline.Item("B", "active"),
        ]));
        const v = t.unwrap().unwrap("Timeline");
        $(Assert.equal(v.items.size(), 2n));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    // =========================================================================
    // Style
    // =========================================================================

    test("creates timeline with orientation + size", $ => {
        const t = $.let(Timeline.Root([Timeline.Item("A", "pending")], {
            style: { orientation: "horizontal", size: "sm" },
        }));
        const vs = t.unwrap().unwrap("Timeline").style.unwrap("some");
        $(Assert.equal(vs.orientation.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(vs.size.unwrap("some").hasTag("sm"), true));
    });

    test("creates timeline with per-status colour slots", $ => {
        const t = $.let(Timeline.Root([Timeline.Item("A", "pending")], {
            style: {
                pendingColor: "#9ca3af",
                activeColor: "#3d5cff",
                completedColor: "#16a34a",
                errorColor: "#dc2626",
                skippedColor: "#6b7280",
                connectorColor: "#e5e7eb",
                indicatorColor: "#111827",
            },
        }));
        const vs = t.unwrap().unwrap("Timeline").style.unwrap("some");
        $(Assert.equal(vs.pendingColor.unwrap("some"), "#9ca3af"));
        $(Assert.equal(vs.activeColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(vs.completedColor.unwrap("some"), "#16a34a"));
        $(Assert.equal(vs.errorColor.unwrap("some"), "#dc2626"));
        $(Assert.equal(vs.skippedColor.unwrap("some"), "#6b7280"));
        $(Assert.equal(vs.connectorColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(vs.indicatorColor.unwrap("some"), "#111827"));
    });
}, { platformFns: TestImpl });
