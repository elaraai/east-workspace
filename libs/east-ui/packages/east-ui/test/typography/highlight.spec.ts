/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Highlight } from "@elaraai/east-ui/internal";
import * as ex from "./highlight.examples.js";

describeEast("Highlight", (test) => {
    Assert.examples(test, {
        highlightSingleTerm: ex.highlightSingleTerm,
        highlightMultipleTerms: ex.highlightMultipleTerms,
        highlightCustomColor: ex.highlightCustomColor,
        highlightGreen: ex.highlightGreen,
        highlightBlue: ex.highlightBlue,
        highlightSearchResult: ex.highlightSearchResult,
        highlightNoMatches: ex.highlightNoMatches,
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
            color: "yellow.800",
        }));

        const style = highlight.unwrap().unwrap("Highlight").style.unwrap("some");
        $(Assert.equal(style.color.hasTag("some"), true));
        $(Assert.equal(style.color.unwrap("some"), "yellow.800"));
    });

    test("creates highlight with background fill", $ => {
        const highlight = $.let(Highlight.Root("Important text", {
            query: ["Important"],
            background: "yellow.200",
        }));

        const style = highlight.unwrap().unwrap("Highlight").style.unwrap("some");
        $(Assert.equal(style.background.hasTag("some"), true));
        $(Assert.equal(style.background.unwrap("some"), "yellow.200"));
    });

    test("creates highlight with colour + background pair", $ => {
        const highlight = $.let(Highlight.Root("Success message", {
            query: ["Success"],
            color: "green.900",
            background: "green.100",
        }));

        const style = highlight.unwrap().unwrap("Highlight").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "green.900"));
        $(Assert.equal(style.background.unwrap("some"), "green.100"));
    });

    // =========================================================================
    // Use Cases
    // =========================================================================

    test("creates search result highlight", $ => {
        const highlight = $.let(Highlight.Root(
            "React is a JavaScript library for building user interfaces",
            { query: ["React", "JavaScript"], background: "blue.100" },
        ));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "React is a JavaScript library for building user interfaces"));
        $(Assert.equal(highlight.unwrap().unwrap("Highlight").style.unwrap("some").background.unwrap("some"), "blue.100"));
    });

    test("creates keyword highlight", $ => {
        const highlight = $.let(Highlight.Root(
            "The error occurred at line 42",
            { query: ["error"], background: "red.100" },
        ));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "The error occurred at line 42"));
        $(Assert.equal(highlight.unwrap().unwrap("Highlight").style.unwrap("some").background.unwrap("some"), "red.100"));
    });

    test("creates empty query array", $ => {
        const highlight = $.let(Highlight.Root("No highlights", { query: [] }));

        $(Assert.equal(highlight.unwrap().unwrap("Highlight").value, "No highlights"));
        $(Assert.equal(highlight.unwrap().unwrap("Highlight").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
