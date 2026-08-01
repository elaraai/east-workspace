/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Card, Text, Button } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./card.examples.js";

describeEast("Card", (test) => {
    Assert.examples(test, {
        cardBasic: ex.cardBasic,
        cardVariants: ex.cardVariants,
        cardStates: ex.cardStates,
        cardSizing: ex.cardSizing,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#460).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("cardVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.cardVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 14n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "HEADER"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "HEADER TITLE"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FOOTER"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "WITH COMPOUND HEADER"));
        $(Assert.equal(rows.get(8n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "WITH SECTIONS"));
        $(Assert.equal(rows.get(10n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FLUSH"));
        $(Assert.equal(rows.get(12n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "MULTIPLE"));
    });

    test("cardStates panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.cardStates.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 8n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "LOADING"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "EMPTY"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "ERROR"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "PERMISSION DENIED"));
    });

    test("cardSizing panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.cardSizing.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "DIMENSIONS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FLEXIBLE"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FILL BODY"));
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates empty card", $ => {
        const card = $.let(Card.Root([]));

        $(Assert.equal(card.unwrap().unwrap("Card").header.hasTag("none"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").footer.hasTag("none"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").style.hasTag("none"), true));
    });

    test("creates card with text child", $ => {
        const card = $.let(Card.Root([
            Text.Root("Card content here"),
        ]));

        $(Assert.equal(card.unwrap().unwrap("Card").header.hasTag("none"), true));
    });

    test("creates card with title header", $ => {
        const card = $.let(Card.Root([], {
            header: { title: "Card Title" },
        }));

        // A title-only header composes to a single Heading.
        $(Assert.equal(card.unwrap().unwrap("Card").header.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").header.unwrap("some").unwrap().unwrap("Heading").value, "Card Title"));
    });

    test("creates card with header and footer", $ => {
        const card = $.let(Card.Root([], {
            header: { title: "Product Name" },
            footer: { actions: [Button.Root("Buy Now")] },
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").header.unwrap("some").unwrap().unwrap("Heading").value, "Product Name"));
        // An actions footer composes to a Stack row.
        $(Assert.equal(card.unwrap().unwrap("Card").footer.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").footer.unwrap("some").unwrap().hasTag("Stack"), true));
    });

    test("eyebrow header composes the mono eyebrow strip", $ => {
        const card = $.let(Card.Root([], { header: { eyebrow: "Run summary" } }));
        $(Assert.equal(card.unwrap().unwrap("Card").header.hasTag("some"), true));
    });

    // =========================================================================
    // Complex Header/Footer
    // =========================================================================

    test("title + description header composes to a VStack", $ => {
        const card = $.let(Card.Root([
            Text.Root("Body content"),
        ], {
            header: { title: "Title", description: "Description" },
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").header.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").header.unwrap("some").unwrap().hasTag("Stack"), true));
    });

    test("actions footer composes to a Stack row", $ => {
        const card = $.let(Card.Root([
            Text.Root("Body content"),
        ], {
            footer: {
                actions: [
                    Button.Root("Cancel", { variant: "outline" }),
                    Button.Root("Save"),
                ],
            },
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").footer.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").footer.unwrap("some").unwrap().hasTag("Stack"), true));
    });

    test("eyebrow + title + meta header composes", $ => {
        const card = $.let(Card.Root([], {
            header: { eyebrow: "Forecast", title: "Per plan week", meta: "14s ago" },
        }));
        $(Assert.equal(card.unwrap().unwrap("Card").header.hasTag("some"), true));
    });

    // =========================================================================
    // Dimension Properties
    // =========================================================================

    test("creates card with height", $ => {
        const card = $.let(Card.Root([], {
            height: "400px",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").height.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").height.unwrap("some"), "400px"));
    });

    test("creates card with minHeight", $ => {
        const card = $.let(Card.Root([], {
            minHeight: "200px",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").minHeight.unwrap("some"), "200px"));
    });

    test("creates card with maxHeight", $ => {
        const card = $.let(Card.Root([], {
            maxHeight: "600px",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").maxHeight.unwrap("some"), "600px"));
    });

    test("creates card with width", $ => {
        const card = $.let(Card.Root([], {
            width: "300px",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").width.unwrap("some"), "300px"));
    });

    test("creates card with flex", $ => {
        const card = $.let(Card.Root([], {
            flex: "1",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").flex.unwrap("some"), "1"));
    });

    test("creates card with full height", $ => {
        const card = $.let(Card.Root([], {
            height: "100%",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").height.unwrap("some"), "100%"));
    });

    test("creates card with overflow", $ => {
        const card = $.let(Card.Root([], {
            overflow: "auto",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").overflow.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").overflow.unwrap("some").hasTag("auto"), true));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates card with all options", $ => {
        const card = $.let(Card.Root([
            Text.Root("Main content goes here"),
        ], {
            header: { title: "Full Card" },
            footer: { actions: [Button.Root("Action")] },
            height: "400px",
            minHeight: "200px",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").header.unwrap("some").unwrap().unwrap("Heading").value, "Full Card"));
        $(Assert.equal(card.unwrap().unwrap("Card").footer.unwrap("some").unwrap().hasTag("Stack"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").height.unwrap("some"), "400px"));
        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").minHeight.unwrap("some"), "200px"));
    });

    test("creates product card", $ => {
        const card = $.let(Card.Root([
            Text.Root("$99.99"),
        ], {
            header: { title: "Product Name", description: "Product category" },
            footer: { actions: [Button.Root("Add to Cart")] },
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").header.hasTag("some"), true));
        $(Assert.equal(card.unwrap().unwrap("Card").footer.hasTag("some"), true));
    });

    test("creates info card", $ => {
        const card = $.let(Card.Root([
            Text.Root("Important details displayed here in the card body."),
        ], {
            header: { title: "Information" },
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").header.unwrap("some").unwrap().unwrap("Heading").value, "Information"));
    });

    test("creates card with nested components", $ => {
        const card = $.let(Card.Root([
            Text.Root("First line"),
            Text.Root("Second line"),
        ], {
            header: { title: "Multi-content Card" },
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").header.unwrap("some").unwrap().unwrap("Heading").value, "Multi-content Card"));
    });

    test("creates flexible card that fills container", $ => {
        const card = $.let(Card.Root([
            Text.Root("This card fills available space"),
        ], {
            header: { title: "Flexible Card" },
            height: "100%",
            flex: "1",
            overflow: "auto",
        }));

        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").height.unwrap("some"), "100%"));
        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").flex.unwrap("some"), "1"));
        $(Assert.equal(card.unwrap().unwrap("Card").style.unwrap("some").overflow.unwrap("some").hasTag("auto"), true));
    });
}, { platformFns: TestImpl });
