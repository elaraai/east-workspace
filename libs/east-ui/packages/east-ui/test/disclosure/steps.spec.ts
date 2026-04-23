/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Steps, Text } from "@elaraai/east-ui";
import * as ex from "./steps.examples.js";

describeEast("Steps", (test) => {
    Assert.examples(test, {
        stepsOnboarding: ex.stepsOnboarding,
        stepsVerticalError: ex.stepsVerticalError,
        stepsCompletedRun: ex.stepsCompletedRun,
    });

    // =========================================================================
    // Steps.Item — title + status
    // =========================================================================

    test("creates item with string title (coerced to Text.Root)", $ => {
        const item = $.let(Steps.Item("Upload", "completed"));
        $(Assert.equal(item.title.unwrap().unwrap("Text").value, "Upload"));
        $(Assert.equal(item.status.hasTag("completed"), true));
        $(Assert.equal(item.description.hasTag("none"), true));
        $(Assert.equal(item.icon.hasTag("none"), true));
    });

    test("creates item with rich UIComp title", $ => {
        const item = $.let(Steps.Item(Text.Root("Rich", { fontWeight: "bold" }), "active"));
        $(Assert.equal(item.title.unwrap().unwrap("Text").value, "Rich"));
        $(Assert.equal(item.status.hasTag("active"), true));
    });

    test("creates item with description + icon", $ => {
        const item = $.let(Steps.Item("Extract", "completed", {
            description: "Pulled 3,200 rows",
            icon: { prefix: "fas", name: "database" },
        }));
        $(Assert.equal(
            item.description.unwrap("some").unwrap().unwrap("Text").value,
            "Pulled 3,200 rows",
        ));
        $(Assert.equal(item.icon.unwrap("some").name, "database"));
    });

    // =========================================================================
    // Status variants
    // =========================================================================

    test("creates item with each status", $ => {
        const pending = $.let(Steps.Item("A", "pending"));
        const active = $.let(Steps.Item("B", "active"));
        const completed = $.let(Steps.Item("C", "completed"));
        const error = $.let(Steps.Item("D", "error"));
        const skipped = $.let(Steps.Item("E", "skipped"));
        $(Assert.equal(pending.status.hasTag("pending"), true));
        $(Assert.equal(active.status.hasTag("active"), true));
        $(Assert.equal(completed.status.hasTag("completed"), true));
        $(Assert.equal(error.status.hasTag("error"), true));
        $(Assert.equal(skipped.status.hasTag("skipped"), true));
    });

    // =========================================================================
    // Steps.Root
    // =========================================================================

    test("creates steps with items and activeIndex", $ => {
        const s = $.let(Steps.Root([
            Steps.Item("A", "completed"),
            Steps.Item("B", "active"),
            Steps.Item("C", "pending"),
        ], { activeIndex: 1n }));
        const v = s.unwrap().unwrap("Steps");
        $(Assert.equal(v.items.size(), 3n));
        $(Assert.equal(v.activeIndex.unwrap("some"), 1n));
    });

    test("creates steps without options — all style none", $ => {
        const s = $.let(Steps.Root([Steps.Item("A", "pending")]));
        const v = s.unwrap().unwrap("Steps");
        $(Assert.equal(v.activeIndex.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    // =========================================================================
    // Style
    // =========================================================================

    test("creates steps with orientation + size", $ => {
        const s = $.let(Steps.Root([Steps.Item("A", "pending")], {
            style: { orientation: "vertical", size: "lg" },
        }));
        const vs = s.unwrap().unwrap("Steps").style.unwrap("some");
        $(Assert.equal(vs.orientation.unwrap("some").hasTag("vertical"), true));
        $(Assert.equal(vs.size.unwrap("some").hasTag("lg"), true));
    });

    test("creates steps with per-status colour slots", $ => {
        const s = $.let(Steps.Root([Steps.Item("A", "pending")], {
            style: {
                pendingColor: "#9ca3af",
                activeColor: "#3d5cff",
                completedColor: "#16a34a",
                errorColor: "#dc2626",
                skippedColor: "#6b7280",
                connectorColor: "#e5e7eb",
            },
        }));
        const vs = s.unwrap().unwrap("Steps").style.unwrap("some");
        $(Assert.equal(vs.pendingColor.unwrap("some"), "#9ca3af"));
        $(Assert.equal(vs.activeColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(vs.completedColor.unwrap("some"), "#16a34a"));
        $(Assert.equal(vs.errorColor.unwrap("some"), "#dc2626"));
        $(Assert.equal(vs.skippedColor.unwrap("some"), "#6b7280"));
        $(Assert.equal(vs.connectorColor.unwrap("some"), "#e5e7eb"));
    });
}, { platformFns: TestImpl });
