/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Ontology mark recipe — an icon of e3-ui-components' Ontology editor
 * (#1263): Font Awesome's solid icon, in the square the Feather icon it
 * replaced took. Feather's `size` drew an N × N px svg; the mark's font is N
 * px, so Font Awesome's icon, 1em tall, is N tall, and `--fa-width` makes it
 * as wide. The mark is a flex box, a block as the svg it replaced was
 * (Chakra's preflight draws an svg as a block): no line box grows around it,
 * so it sits where that svg sat — a flex item in a row, the search box's
 * holder 14px tall. The sizes are the ones the editor draws — 11, 12, 13 and
 * 14 px in the table and the search box, 18 px on a node.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const ontologyMarkRecipe = defineRecipe({
    className: "elara-ontology-mark",
    base: {
        display: "flex",
        flexShrink: "0",
        "--fa-width": "1em",
    },
    variants: {
        size: {
            "11": { fontSize: "11px" },
            "12": { fontSize: "12px" },
            "13": { fontSize: "13px" },
            "14": { fontSize: "14px" },
            "18": { fontSize: "18px" },
        },
    },
    defaultVariants: { size: "14" },
});
