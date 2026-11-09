/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Trace slot recipe — spec `.trace`.
 *
 * Each density publishes a `--t-*` step-sizing set on the root. The step
 * height and font size deliberately track the `chipRail` chip at the same
 * density (15 / 22 / 34 px), so a Trace cell and a ChipRail cell line up when
 * they share a table row. The dynamic parts — the grid's column count, the
 * now-line position, and the fills of an author's own hue or of the diverging
 * scale — are set inline by the renderer; everything density- or theme-derived
 * lives here, the brand and categorical scales' fills among it.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const traceSlotRecipe = defineSlotRecipe({
    className: "elara-trace",
    slots: ["root", "stub", "grid", "step", "value", "now", "zone", "axis", "axisCell"],
    base: {
        root: {
            position: "relative",
            display: "inline-block",
            fontFamily: "mono",
            /* NO overflow/max-width here: `overflow-x` would couple the
             * vertical axis to `auto` (a stray scrollbar on every trace) and
             * the width clamp breaks the plot-gutter contract (#147).
             * Narrow hosts pan a wide trace via their own scroll container
             * (the showcase example frames do — #356). */
        },
        stub: {
            display: "flex",
            alignItems: "center",
            fontWeight: "semibold",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "fg.muted",
            paddingRight: "6px",
            // Clip to the gutter width with an ellipsis; the renderer's `title`
            // surfaces the full label on hover (#137).
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            fontSize: "var(--t-stub-fs)",
        },
        grid: {
            position: "relative",
            zIndex: 1,
            display: "grid",
            gap: "var(--t-gap)",
        },
        step: {
            position: "relative",
            height: "var(--t-step-h)",
            borderRadius: "var(--t-radius)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "var(--t-fs)",
            fontWeight: "medium",
            lineHeight: "1",
            color: "fg",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "transparent",
            "--t-edge": "{colors.brandPressed}",
            // A step on the design system's heat ramp (`data-level`, 0 to 4), its value in the ink the design system
            // pairs with that step, which reads on it in both themes (charts.md › Sequential ramp).
            "&[data-level]": { background: "var(--t-fill)" },
            "&[data-level='0']": { "--t-fill": "{colors.heat.1}" },
            "&[data-level='1']": { "--t-fill": "{colors.heat.2}" },
            "&[data-level='2']": { "--t-fill": "{colors.heat.3}" },
            "&[data-level='3']": { "--t-fill": "{colors.heat.4}", color: "bg.surface" },
            "&[data-level='4']": { "--t-fill": "{colors.heat.5}", color: "bg.surface" },
            // A categorical track past the first (`data-series`, its place in the design system's series order, the
            // first being the brand's own ramp): its hue's five steps built as the heat ramp is — into the paper on the
            // first three, toward the ink on the last two, where the hue at full strength holds neither ink at 4.5:1 —
            // so the same inks read on them in both themes. Mixed in oklab, which dilutes a hue without turning it
            // toward the paper's or the ink's own faint hue. Its edge is its last step, as the brand's is.
            "&[data-series]": {
                "--t-edge": "color-mix(in oklab, var(--t-hue) 40%, {colors.fg})",
                "&[data-level='0']": { "--t-fill": "color-mix(in oklab, var(--t-hue) 12%, {colors.bg.surface})" },
                "&[data-level='1']": { "--t-fill": "color-mix(in oklab, var(--t-hue) 32%, {colors.bg.surface})" },
                "&[data-level='2']": { "--t-fill": "color-mix(in oklab, var(--t-hue) 56%, {colors.bg.surface})" },
                "&[data-level='3']": { "--t-fill": "color-mix(in oklab, var(--t-hue) 60%, {colors.fg})" },
                "&[data-level='4']": { "--t-fill": "color-mix(in oklab, var(--t-hue) 40%, {colors.fg})" },
            },
            "&[data-series='1']": { "--t-hue": "{colors.accent.teal}" },
            "&[data-series='2']": { "--t-hue": "{colors.accent.purple}" },
            "&[data-series='3']": { "--t-hue": "{colors.accent.blue}" },
            "&[data-series='4']": { "--t-hue": "{colors.accent.orange}" },
            // A predicted step stands on its ramp's lighter three, where the ink is the same; its edge is its ramp's
            // last step, which holds its line against each of the three and the paper in both themes, where the step's
            // own hue on a paler mix of itself did not.
            "&[data-predicted]": {
                fontStyle: "italic",
                "[data-future=ghost] &": { borderStyle: "dashed", borderColor: "var(--t-edge)" },
                "[data-future=hatch] &": {
                    borderStyle: "dashed",
                    borderColor: "var(--t-edge)",
                    backgroundImage: "repeating-linear-gradient(-45deg, transparent 0 5px, color-mix(in srgb, var(--t-edge) 12%, transparent) 5px 6px)",
                },
                // Faded, the fill alone pales: the value keeps its ink, where an opacity over the whole step took it
                // under 4.5:1.
                "[data-future=fade] &": { background: "color-mix(in oklch, var(--t-fill) 70%, transparent)" },
            },
        },
        value: {
            position: "relative",
            zIndex: 1,
        },
        now: {
            position: "absolute",
            top: "-1px",
            bottom: "-1px",
            width: "2px",
            marginLeft: "-1px",
            background: "var(--t-now-color)",
            boxShadow: "0 0 0 1px {colors.bg.canvas}",
            zIndex: 2,
            pointerEvents: "none",
        },
        zone: {
            position: "absolute",
            top: "0",
            bottom: "0",
            zIndex: 0,
            background: "bg.muted",
            borderRadius: "var(--t-radius)",
        },
        axis: {
            display: "grid",
            gap: "var(--t-gap)",
            marginBottom: "5px",
        },
        axisCell: {
            textAlign: "center",
            fontSize: "8.5px",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
    },
    variants: {
        density: {
            condensed: {
                root: {
                    "--t-step-w": "15px",
                    "--t-step-h": "15px",
                    "--t-gap": "1px",
                    "--t-stub-w": "26px",
                    "--t-stub-fs": "8px",
                    "--t-fs": "9px",
                    "--t-radius": "2px",
                    "--t-now-color": "{colors.brandPressed}",
                },
                value: { display: "none" },
            },
            compact: {
                root: {
                    "--t-step-w": "30px",
                    "--t-step-h": "22px",
                    "--t-gap": "2px",
                    "--t-stub-w": "34px",
                    "--t-stub-fs": "9px",
                    "--t-fs": "10px",
                    "--t-radius": "2px",
                    "--t-now-color": "{colors.brandPressed}",
                },
            },
            comfortable: {
                root: {
                    "--t-step-w": "46px",
                    "--t-step-h": "34px",
                    "--t-gap": "3px",
                    "--t-stub-w": "46px",
                    "--t-stub-fs": "10px",
                    "--t-fs": "12.5px",
                    "--t-radius": "3px",
                    "--t-now-color": "{colors.brandPressed}",
                },
            },
        },
    },
    defaultVariants: { density: "comfortable" },
});
