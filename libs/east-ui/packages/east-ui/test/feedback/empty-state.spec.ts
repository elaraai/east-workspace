/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { EmptyState, Text, Button, UIComponentType } from "@elaraai/east-ui/internal";
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
        const e = $.let(EmptyState.Root({ title: "Nothing here" }));
        const v = e.unwrap().unwrap("EmptyState");
        $(Assert.equal(v.title.unwrap().unwrap("Text").value, "Nothing here"));
        $(Assert.equal(v.icon.hasTag("none"), true));
        $(Assert.equal(v.description.hasTag("none"), true));
        $(Assert.equal(v.actions.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates empty state with rich UIComp title", $ => {
        const e = $.let(EmptyState.Root({ title: Text.Root("Rich", { fontWeight: "bold" }) }));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").title.unwrap().unwrap("Text").value,
            "Rich",
        ));
    });

    // =========================================================================
    // icon / description / actions
    // =========================================================================

    test("creates empty state with icon", $ => {
        const e = $.let(EmptyState.Root({ title: "No scenarios",
            icon: { prefix: "fas", name: "folder-plus" },
        }));
        const icon = e.unwrap().unwrap("EmptyState").icon.unwrap("some");
        $(Assert.equal(icon.prefix, "fas"));
        $(Assert.equal(icon.name, "folder-plus"));
    });

    // =========================================================================
    // No text glyph (#1263): every icon is a Font Awesome solid icon
    // =========================================================================

    test("a text glyph is refused at build, naming its remedy: `icon`, a Font Awesome solid icon (#1263)", $ => {
        const refusal = (() => {
            try { EmptyState.Root({ title: "Nothing here", glyph: "·   ·   ·" } as Parameters<typeof EmptyState.Root>[0]); return ""; }
            catch (e) { return e instanceof Error ? e.message : String(e); }
        })();
        $(Assert.equal(East.value(refusal), "EmptyState: `glyph` is removed (#1263) — an empty state's mark is a Font Awesome solid icon: " +
            "give `icon` instead, as `{ prefix: \"fas\", name: \"<icon>\" }`"));
    });

    test("the EmptyState arm carries no glyph — its icon is its one mark (#1263)", $ => {
        const fields = ["icon", "title", "description", "actions", "style"];
        $(Assert.equal(East.value(Object.keys(UIComponentType.node.cases.EmptyState.fields)), fields));
        $(Assert.equal(East.value(Object.keys(EmptyState.Types.EmptyState.fields)), fields));
    });

    test("creates empty state with string description (coerced)", $ => {
        const e = $.let(EmptyState.Root({ title: "T", description: "Helpful description" }));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").description.unwrap("some").unwrap().unwrap("Text").value,
            "Helpful description",
        ));
    });

    test("creates empty state with rich UIComp description", $ => {
        const e = $.let(EmptyState.Root({ title: "T", description: Text.Root("Rich desc") }));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").description.unwrap("some").unwrap().unwrap("Text").value,
            "Rich desc",
        ));
    });

    test("creates empty state with actions button", $ => {
        const e = $.let(EmptyState.Root({ title: "T", actions: Button.Root("Retry") }));
        $(Assert.equal(
            e.unwrap().unwrap("EmptyState").actions.unwrap("some").unwrap().unwrap("Button").label.unwrap().unwrap("Text").value,
            "Retry",
        ));
    });

    // =========================================================================
    // Style
    // =========================================================================

    test("creates empty state with size + colour slots", $ => {
        const e = $.let(EmptyState.Root({ title: "T",
            size: "sm",
            color: "fg.default",
            background: "bg.canvas",
            borderColor: "border.subtle",
            iconColor: "link",
        }));
        const s = e.unwrap().unwrap("EmptyState").style.unwrap("some");
        $(Assert.equal(s.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(s.color.unwrap("some"), "fg.default"));
        $(Assert.equal(s.background.unwrap("some"), "bg.canvas"));
        $(Assert.equal(s.borderColor.unwrap("some"), "border.subtle"));
        $(Assert.equal(s.iconColor.unwrap("some"), "link"));
    });
}, { platformFns: TestImpl });
