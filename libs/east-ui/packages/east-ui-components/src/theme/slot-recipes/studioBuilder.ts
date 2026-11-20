/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio builder slot recipe — the builder's frame: the canvas, which the
 * publish preview takes the place of while it shows. The builder fills its
 * host and draws no border of its own; a host frames it, or places it bare.
 * The canvas, the palette, the inspector and the preview are their own
 * recipes' — the snap grid's, the dock's, the library's and the preview's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const studioBuilderSlotRecipe = defineSlotRecipe({
    className: "elara-studio-builder",
    slots: ["root", "canvas", "linkNote"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            minHeight: "0",
        },
        /* Kept mounted while the preview shows — its drafts stay its own. */
        canvas: {
            position: "relative",
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            "&[hidden]": { display: "none" },
            /* Linking (#1673, LNK-6): while a leader is picked, the visuals that can lead are outlined dashed `--brand-d`
               on `--brand-tint` and take a pointer's hand; the one being linked stands as it is; the rest dim. */
            "&[data-linking] [data-snap-grid-tile]": { opacity: "0.4" },
            "&[data-linking] [data-snap-grid-tile]:has([data-pick])": { opacity: "1" },
            "&[data-linking] [data-snap-grid-tile]:has([data-pick=leader])": {
                outline: "1.5px dashed", outlineColor: "brand.solid", outlineOffset: "-1px", background: "brandTint", cursor: "pointer",
            },
        },
        /* What the link's popover says under its fields: 12 / 16, `--ink-3`, a line each. The banner that says what to do is
           the `banner` recipe's, in the canvas's frame's banners slot, as every builder's banners are. */
        linkNote: { fontSize: "{fontSizes.body.sm}", lineHeight: "16px", color: "fg.muted", margin: "0", "& + &": { marginTop: "{spacing.1}" } },
    },
});
