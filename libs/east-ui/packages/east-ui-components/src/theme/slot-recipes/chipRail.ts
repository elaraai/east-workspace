/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ChipRail slot recipe — spec `.chiprail`.
 *
 * Each density publishes a set of `--cr-*` custom properties on the rail root.
 * Because custom properties inherit down the DOM, descendant chips (`tag` /
 * `chip` recipes) read them as `var(--cr-fs, …)` with their standalone value
 * as the fallback — so a rail tightens its chips' type, padding and radius
 * without the chips needing to know which rail they sit in, and a chip used
 * outside a rail is untouched. The `label` slot is the labeled-mode caption
 * above each chip; it stays mono + uppercase so a column of captions reads as
 * a dimension header strip rather than body copy.
 *
 * A chip's padding and its line are whole numbers of pixels at every density
 * (#1638), so its words start a whole number of pixels under its edge: `--cr-py`
 * and `--cr-lh`. The comfortable chip is 33px in its edge — 9px above and below
 * a 13px line — where a 9.75px padding about a line the face's own 11.5px
 * started the words at a fraction, and the page painted them a row higher or
 * lower in the chip by where it stood the rail.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const chipRailSlotRecipe = defineSlotRecipe({
    className: "elara-chip-rail",
    slots: ["root", "item", "label"],
    base: {
        root: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "var(--cr-gap)",
        },
        item: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--cr-lbl-gap)",
        },
        label: {
            fontFamily: "mono",
            fontWeight: "semibold",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "fg.muted",
            lineHeight: "1",
            textAlign: "center",
            whiteSpace: "nowrap",
            fontSize: "var(--cr-lbl-fs)",
        },
    },
    variants: {
        density: {
            condensed: {
                root: {
                    "--cr-fs": "9px",
                    "--cr-lh": "9px",
                    "--cr-px": "7px",
                    "--cr-py": "2px",
                    "--cr-igap": "4px",
                    "--cr-radius": "3px",
                    "--cr-gap": "5px",
                    "--cr-lbl-fs": "8.5px",
                    "--cr-lbl-gap": "3px",
                },
            },
            compact: {
                root: {
                    "--cr-fs": "10px",
                    "--cr-lh": "10px",
                    "--cr-px": "10px",
                    "--cr-py": "5px",
                    "--cr-igap": "5px",
                    "--cr-radius": "4px",
                    "--cr-gap": "7px",
                    "--cr-lbl-fs": "9.5px",
                    "--cr-lbl-gap": "5px",
                },
            },
            comfortable: {
                root: {
                    "--cr-fs": "12.5px",
                    "--cr-lh": "13px",
                    "--cr-px": "15px",
                    "--cr-py": "9px",
                    "--cr-igap": "7px",
                    "--cr-radius": "6px",
                    "--cr-gap": "9px",
                    "--cr-lbl-fs": "11px",
                    "--cr-lbl-gap": "7px",
                },
            },
        },
    },
    defaultVariants: { density: "comfortable" },
});
