/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Highlight } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./highlight.examples.js";

describeEast("Highlight", (test) => {
    Assert.examples(test, {
        highlightBasic: ex.highlightBasic,
        highlightVariants: ex.highlightVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#459).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("highlightVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the terms-preset / colour tables
        // and the live Input.String query — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That
        // puts the tables inside the Reactive body, which TestImpl does not
        // execute, so they cannot be asserted from here; `Assert.examples`
        // above still compiles and evaluates the outer function. The per-prop
        // coverage lives in the Highlight.Root tests below, which construct
        // each style directly.
        const panel = $.const(ex.highlightVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation — { value, query, style } shape
    // =========================================================================

    test("creates highlight with value and single query", $ => {
        const highlight = $.let(Highlight.Root("Hello World", { query: ["World"] }));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "Hello World"));
    });

    test("creates highlight with multiple queries", $ => {
        const highlight = $.let(Highlight.Root("The quick brown fox", { query: ["quick", "fox"] }));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "The quick brown fox"));
    });

    test("creates highlight with no style — style is none", $ => {
        const highlight = $.let(Highlight.Root("Search results", { query: ["results"] }));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "Search results"));
        $(Assert.equal(highlight.unwrap().unwrap("Highlight").style.hasTag("none"), true));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates highlight with colour", $ => {
        const highlight = $.let(Highlight.Root("Important text", {
            query: ["Important"],
            color: "fg.warning",
        }));

        const style = highlight.unwrap().unwrap("Highlight").style.unwrap("some");
        $(Assert.equal(style.color.hasTag("some"), true));
        $(Assert.equal(style.color.unwrap("some"), "fg.warning"));
    });

    test("creates highlight with background fill", $ => {
        const highlight = $.let(Highlight.Root("Important text", {
            query: ["Important"],
            background: "bg.warning.subtle",
        }));

        const style = highlight.unwrap().unwrap("Highlight").style.unwrap("some");
        $(Assert.equal(style.background.hasTag("some"), true));
        $(Assert.equal(style.background.unwrap("some"), "bg.warning.subtle"));
    });

    test("creates highlight with colour + background pair", $ => {
        const highlight = $.let(Highlight.Root("Success message", {
            query: ["Success"],
            color: "fg.success",
            background: "bg.success.subtle",
        }));

        const style = highlight.unwrap().unwrap("Highlight").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "fg.success"));
        $(Assert.equal(style.background.unwrap("some"), "bg.success.subtle"));
    });

    // =========================================================================
    // Use Cases
    // =========================================================================

    test("creates search result highlight", $ => {
        const highlight = $.let(Highlight.Root(
            "React is a JavaScript library for building user interfaces",
            { query: ["React", "JavaScript"], background: "bg.brand.subtle" },
        ));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "React is a JavaScript library for building user interfaces"));
        $(Assert.equal(highlight.unwrap().unwrap("Highlight").style.unwrap("some").background.unwrap("some"), "bg.brand.subtle"));
    });

    test("creates keyword highlight", $ => {
        const highlight = $.let(Highlight.Root(
            "The error occurred at line 42",
            { query: ["error"], background: "bg.danger.subtle" },
        ));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "The error occurred at line 42"));
        $(Assert.equal(highlight.unwrap().unwrap("Highlight").style.unwrap("some").background.unwrap("some"), "bg.danger.subtle"));
    });

    test("creates empty query array", $ => {
        const highlight = $.let(Highlight.Root("No highlights", { query: [] }));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "No highlights"));
        $(Assert.equal(highlight.unwrap().unwrap("Highlight").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
