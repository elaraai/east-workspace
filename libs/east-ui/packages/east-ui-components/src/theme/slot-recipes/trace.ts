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
 * per-step heat fills, and the now-line position — are set inline by the
 * renderer; everything density- or theme-derived lives here.
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
             * the width clamp breaks the AlignedStack gutter contract (#147).
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
                    "--t-now-color": "{colors.brand.700}",
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
                    "--t-now-color": "{colors.brand.700}",
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
                    "--t-now-color": "{colors.brand.700}",
                },
            },
        },
    },
    defaultVariants: { density: "comfortable" },
});
