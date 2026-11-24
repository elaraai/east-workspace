/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio text slot recipe — a page's text block (#1669): a heading over
 * plain paragraphs, with no frame, on a page, on the builder's canvas and in
 * its publish preview. The heading is a card title's (DM Sans 18, semibold),
 * a paragraph the body's size in the secondary ink; a line break inside a
 * paragraph is kept.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const studioTextSlotRecipe = defineSlotRecipe({
    className: "elara-studio-text",
    slots: ["root", "heading", "paragraph"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            minWidth: "0",
        },
        heading: { textStyle: "title.card.md", color: "fg", margin: "0", overflowWrap: "anywhere" },
        paragraph: { textStyle: "body.md", color: "fg.muted", margin: "0", whiteSpace: "pre-line", overflowWrap: "anywhere" },
    },
});
