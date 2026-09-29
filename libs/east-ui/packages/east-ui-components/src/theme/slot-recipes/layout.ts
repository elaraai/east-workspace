/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout slot recipe — the 12-column snap grid of tiles (#989).
 *
 * The root is the Layout's frame: it never grows past its host, and a grid
 * wider than it — one at a design width — scrolls within it. The grid stacks
 * the rows with a row gap, and each row is a 12-column grid whose cells take
 * their spans (`--layout-span`), continuing on a line below when their spans
 * pass 12. The grid's width picks the spans a tile takes — CSS container
 * queries, so the renderer measures nothing: under 480px every tile takes the
 * full width, from 480px a span under 6 takes 6 and any other 12
 * (`--layout-span-medium`), and from 960px the span declared. A framed tile is
 * paper with a strong rule and its content clipped, with no header strip; a
 * bare tile draws nothing around its content. The Layout draws no outer
 * border — the host draws the panel around it.
 *
 * A wireframe is the page's miniature, so its cells keep their declared spans
 * at any width: each is an outline on the sunken paper, as tall as its declared
 * height, and an auto-height cell as tall as the wireframe's row.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const layoutSlotRecipe = defineSlotRecipe({
    className: "elara-layout",
    slots: ["root", "grid", "row", "cell"],
    base: {
        root: {
            maxWidth: "100%",
            minWidth: 0,
            overflowX: "auto",
        },
        grid: {
            containerType: "inline-size",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.3}",
        },
        row: {
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            columnGap: "{spacing.3}",
            rowGap: "{spacing.3}",
        },
        cell: {
            gridColumn: "span var(--layout-span)",
            minWidth: 0,
            alignSelf: "start",
            "&[data-align='center']": { alignSelf: "center" },
            "&[data-align='stretch']": { alignSelf: "stretch" },
        },
    },
    variants: {
        variant: {
            tiles: {
                cell: {
                    "&[data-frame]": {
                        bg: "bg.surface",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderColor: "border.strong",
                        borderRadius: "10px",
                        overflow: "hidden",
                    },
                    "@container (max-width: 479.98px)": { gridColumn: "1 / -1" },
                    "@container (min-width: 480px) and (max-width: 959.98px)": { gridColumn: "span var(--layout-span-medium)" },
                },
            },
            wireframe: {
                grid: { bg: "bg.subtle", padding: "{spacing.2}", gap: "{spacing.1}" },
                row: { columnGap: "{spacing.1}", rowGap: "{spacing.1}" },
                cell: {
                    minHeight: "{spacing.6}",
                    bg: "bg.surface",
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: "border.strong",
                    borderRadius: "2px",
                },
            },
        },
    },
    defaultVariants: { variant: "tiles" },
});
