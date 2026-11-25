/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query library slot recipe — what `<Query.Library>` (#1063, #1761) draws of
 * its own: what a query's card adds to the Library's gallery card — the mark
 * of the open query, its tags, and why it can't open here — a card's media,
 * the query's wireframe: its source and a bar per step, or the dashed box that
 * counts its problems; and New query's glyphs.
 *
 * Everything else is another recipe's: the frame the `builderFrame`'s, the
 * toolbar and its rail the shared `toolbar`'s, the grid and a card the
 * `library` recipe's paged gallery and gallery card, the buttons the `button`
 * recipe's and New query's menu the `menu`'s.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { oneLineBox } from "../one-line-box.js";

/** The mono caps voice — the mark of the open query, the problems' count. */
const CAPTION = {
    fontFamily: "mono",
    fontSize: "9.5px",
    fontWeight: "600",
    letterSpacing: "0.14em",
    lineHeight: "normal",
    textTransform: "uppercase",
} as const;

export const queryLibrarySlotRecipe = defineSlotRecipe({
    className: "elara-query-library",
    slots: [
        "caret", "buttonIcon", "menuIcon",
        "cardOpen", "cardRefusal", "cardTags", "cardTag",
        "wireframe", "wireRow", "wireIcon", "wireTitle", "wireMore",
        "problems", "problemCount", "problemText",
    ],
    base: {
        /* New query's caret and plus, and a data source's icon in its menu. */
        caret: { fontSize: "9px" },
        buttonIcon: { fontSize: "10px" },
        menuIcon: {
            flexShrink: "0",
            width: "14px",
            fontSize: "11px",
            textAlign: "center",
            color: "fg.subtle",
        },
        /* The mark of the query open in the builder, at the end of its card's head. */
        cardOpen: { ...CAPTION, flexShrink: "0", color: "brand.fg" },
        /* Why a query can't open here, in its description's place: one line, as a description is. */
        cardRefusal: {
            fontSize: "10.5px",
            lineHeight: "1.3",
            color: "fg.warning",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* A card's tags: quiet chips on one line, the ones past its end cut. */
        cardTags: {
            display: "flex",
            flexWrap: "nowrap",
            gap: "6px",
            minWidth: "0",
            overflow: "hidden",
        },
        cardTag: {
            flexShrink: "0",
            paddingX: "6px",
            borderRadius: "3px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "16px",
            color: "fg.muted",
        },
        /* The query's wireframe — its source, then a bar per step, each its
           icon and title — on its card's sunken paper. */
        wireframe: {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            minWidth: "0",
        },
        /* A one-line box (#1638): 17 tall in its edge, its title on the 15px of room inside. */
        wireRow: {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexShrink: "0",
            minWidth: "0",
            ...oneLineBox(17),
            paddingX: "6px",
            borderRadius: "3px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.surface",
            fontSize: "10.5px",
            color: "fg.muted",
            "&[data-wire=source]": {
                fontFamily: "mono",
                fontWeight: "600",
                color: "fg",
                borderColor: "border.strong",
            },
        },
        wireIcon: {
            flexShrink: "0",
            width: "11px",
            fontSize: "8.5px",
            textAlign: "center",
            color: "fg.subtle",
            "[data-wire=source] > &": { color: "brand.solid" },
        },
        wireTitle: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        wireMore: {
            paddingX: "6px",
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
        },
        /* A query with problems here: their count, dashed, and the first. */
        problems: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            minWidth: "0",
            minHeight: "72px",
            paddingX: "12px",
            paddingY: "10px",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "4px",
            textAlign: "center",
        },
        problemCount: { ...CAPTION, fontSize: "10px", color: "fg.danger" },
        problemText: {
            fontSize: "12px",
            lineHeight: "1.4",
            color: "fg.muted",
            lineClamp: "2",
        },
    },
});
