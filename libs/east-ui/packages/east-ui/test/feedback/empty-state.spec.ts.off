/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { EmptyState, Text, Button } from "@elaraai/east-ui";
import * as ex from "./empty-state.examples.js";

describeEast("EmptyState", (test) => {
    Assert.examples(test, {
        emptyStateNoResults: ex.emptyStateNoResults,
        emptyStateNoScenarios: ex.emptyStateNoScenarios,
        emptyStateError: ex.emptyStateError,
    });

    // =========================================================================
    // EmptyState.Root — title-only
    // =========================================================================

    test("creates empty state with string title (coerced to Text.Root)", $ => {
        const e = $.let(EmptyState.Root("Nothing here"));
        const v = e.unwrap().unwrap("EmptyState");
        $(Assert.equal(v.title.unwrap().unwrap("Text").value, "Nothing here"));
        $(Assert.equal(v.icon.hasTag("none"), true));
        $(Assert.equal(v.description.hasTag("none"), true));
        $(Assert.equal(v.actions.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates empty state with rich UIComp title", $ => {
        const e = $.let(EmptyState.Root(Text.Root("Rich", { fontWeight: "bold" })));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").title.unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    // =========================================================================
    // icon / description / actions
    // =========================================================================

    test("creates empty state with icon", $ => {
        const e = $.let(EmptyState.Root("No scenarios", {
            icon: { prefix: "fas", name: "folder-plus" },
        }));
        const icon = e.unwrap().unwrap("EmptyState").icon.unwrap("some");
        $(Assert.equal(icon.prefix, "fas"));
        $(Assert.equal(icon.name, "folder-plus"));
    });

    test("creates empty state with string description (coerced)", $ => {
        const e = $.let(EmptyState.Root("T", { description: "Helpful description" }));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").description.unwrap("some").unwrap().unwrap("Text").value,
            "Helpful description",
        ));
    });

    test("creates empty state with rich UIComp description", $ => {
        const e = $.let(EmptyState.Root("T", { description: Text.Root("Rich desc") }));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").description.unwrap("some").unwrap().unwrap("Text").value,
            "Rich desc",
        ));
    });

    test("creates empty state with actions button", $ => {
        const e = $.let(EmptyState.Root("T", { actions: Button.Root("Retry") }));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").actions.unwrap("some").unwrap().unwrap("Button").label.unwrap().unwrap("Text").value,
            "Retry",
        ));
    });

    // =========================================================================
    // Style
    // =========================================================================

    test("creates empty state with size + colour slots", $ => {
        const e = $.let(EmptyState.Root("T", {
            style: {
                size: "sm",
                color: "#111827",
                background: "#f9fafb",
                borderColor: "#e5e7eb",
                iconColor: "#3d5cff",
            },
        }));
        const s = e.unwrap().unwrap("EmptyState").style.unwrap("some");
        $(Assert.equal(s.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(s.color.unwrap("some"), "#111827"));
        $(Assert.equal(s.background.unwrap("some"), "#f9fafb"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(s.iconColor.unwrap("some"), "#3d5cff"));
    });
}, { platformFns: TestImpl });
