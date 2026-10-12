/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * IconButton mark recipe — the Font Awesome mark of one of Chakra's icon
 * buttons (#1263): a close button's xmark, the pagination's ellipsis. Each
 * button size draws its mark in the square Chakra's own icon took there — the
 * button recipe's `_icon` size: 14px at 2xs, 16px at xs and sm, 20px at md
 * to xl, 24px at 2xl. Chakra's icon button sets its icon's font to 1.2em of
 * the button's — a style it sets itself, which no recipe outranks — and Font
 * Awesome draws an icon 1em tall: so the button's own font, which sizes
 * nothing else in a button with no words, is the mark's size over 1.2, and
 * `--fa-width` makes the mark square. A host applies it through the button's
 * `css`, with the button's size.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const iconButtonMarkRecipe = defineRecipe({
    className: "elara-icon-button-mark",
    base: {
        "--fa-width": "1em",
    },
    variants: {
        size: {
            "2xs": { fontSize: "calc(14px / 1.2)" },
            xs: { fontSize: "calc(16px / 1.2)" },
            sm: { fontSize: "calc(16px / 1.2)" },
            md: { fontSize: "calc(20px / 1.2)" },
            lg: { fontSize: "calc(20px / 1.2)" },
            xl: { fontSize: "calc(20px / 1.2)" },
            "2xl": { fontSize: "calc(24px / 1.2)" },
        },
    },
    defaultVariants: { size: "md" },
});
