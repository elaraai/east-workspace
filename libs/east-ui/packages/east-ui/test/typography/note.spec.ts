/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Note, Text } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./note.examples.js";

describeEast("Note", (test) => {
    Assert.examples(test, {
        noteNarrative: ex.noteNarrative,
        noteVariants: ex.noteVariants,
    });

    test("noteVariants is the live configurator", $ => {
        const panel = $.const(ex.noteVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation — { body, variant, style } container shape
    // =========================================================================

    test("creates note with a string body (coerced to Text.Root)", $ => {
        const note = $.let(Note.Root("Hello"));
        // Default variant is "narrative".
        $(Assert.equal(note.unwrap().unwrap("Note").variant.hasTag("narrative"), true));
        // String body coerces to Text.
        $(Assert.equal(note.unwrap().unwrap("Note").body.unwrap().unwrap("Text").value, "Hello"));
    });

    test("creates note with no style — style is none", $ => {
        const note = $.let(Note.Root("Plain"));
        $(Assert.equal(note.unwrap().unwrap("Note").style.hasTag("none"), true));
    });

    test("creates note with rich UIComp body", $ => {
        const note = $.let(Note.Root(
            Text.Root("Quote", { fontStyle: "italic" }),
            { variant: "quote" },
        ));
        $(Assert.equal(
            note.unwrap().unwrap("Note").body.unwrap().unwrap("Text").style.unwrap("some").fontStyle.unwrap("some").hasTag("italic"),
            true,
        ));
    });

    // =========================================================================
    // Variant (on main — semantic classification)
    // =========================================================================

    test("creates narrative note", $ => {
        const note = $.let(Note.Root("…", { variant: "narrative" }));
        $(Assert.equal(note.unwrap().unwrap("Note").variant.hasTag("narrative"), true));
    });

    test("creates callout note", $ => {
        const note = $.let(Note.Root("…", { variant: "callout" }));
        $(Assert.equal(note.unwrap().unwrap("Note").variant.hasTag("callout"), true));
    });

    test("creates quote note", $ => {
        const note = $.let(Note.Root("…", { variant: "quote" }));
        $(Assert.equal(note.unwrap().unwrap("Note").variant.hasTag("quote"), true));
    });

    // =========================================================================
    // Emphasis (inside style)
    // =========================================================================

    test("creates callout note with strong emphasis", $ => {
        const note = $.let(Note.Root("…", { variant: "callout", emphasis: "strong" }));
        const style = note.unwrap().unwrap("Note").style.unwrap("some");
        $(Assert.equal(style.emphasis.unwrap("some").hasTag("strong"), true));
    });

    test("creates narrative note with subtle emphasis", $ => {
        const note = $.let(Note.Root("…", { emphasis: "subtle" }));
        const style = note.unwrap().unwrap("Note").style.unwrap("some");
        $(Assert.equal(style.emphasis.unwrap("some").hasTag("subtle"), true));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates branded note with explicit colour + background + borderColor + accentColor", $ => {
        const note = $.let(Note.Root("…", {
            variant: "callout",
            color: "fg.default",
            background: "bg.brand.subtle",
            borderColor: "border.brand",
            accentColor: "link",
        }));
        const style = note.unwrap().unwrap("Note").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "fg.default"));
        $(Assert.equal(style.background.unwrap("some"), "bg.brand.subtle"));
        $(Assert.equal(style.borderColor.unwrap("some"), "border.brand"));
        $(Assert.equal(style.accentColor.unwrap("some"), "link"));
    });
}, { platformFns: TestImpl });
