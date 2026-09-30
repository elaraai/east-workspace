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
    slots: ["root", "canvas"],
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
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            "&[hidden]": { display: "none" },
        },
    },
});
