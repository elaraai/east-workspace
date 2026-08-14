/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Brush strip recipe — the Plan spec's horizon-strip vocabulary (`.pl-brush`),
 * shared by the standalone `Slice.Rail` brush and the Plan canvas's horizon
 * band. One visual recipe at two densities (the host sets the strip height):
 *
 * - **bars** — the full-horizon histogram, bottom-aligned flex columns with
 *   1 px gaps and `1px 1px 0 0` radii; in-window bars carry the brand wash
 *   (`brand.solid` at 42 %), out-of-window bars the muted wash (`fg.muted`
 *   at 20 %).
 * - **masks** — `fg` at 4 % full-height panels over the excluded regions.
 * - **handles** — the visible 5 px × r2 `brand.solid` bars, inset 4 px
 *   top/bottom, each centred in an invisible 10 px hit zone that stays in
 *   lockstep with `brush-math`'s `BRUSH_HANDLE_PX` geometry.
 * - **now** — the 1.5 px `brand.solid` tick at the now instant, opacity .8.
 *
 * Editing the window here is editing the slice's Range — the gesture machine
 * (draw / slide / resize) lives in `slice/brush-math.ts`.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const brushStripSlotRecipe = defineSlotRecipe({
    className: "elara-brush-strip",
    slots: ["track", "bar", "mask", "handleZone", "handleBar", "now"],
    base: {
        track: {
            position: "relative",
            display: "flex",
            alignItems: "flex-end",
            paddingTop: "5px",
            paddingBottom: "4px",
            /* No overflow clip — a handle at the domain edge keeps its full
             * 5 px face (the zones poke ±5 px, like the spec's free handles). */
            minWidth: "0",
            touchAction: "none",
            /* No histogram (count opted out): a hairline baseline keeps the
             * gesture target discoverable. */
            '&[data-empty="true"]': {
                borderBottomWidth: "1px",
                borderBottomColor: "border.subtle",
            },
        },
        bar: {
            flex: "1",
            marginInline: "1px",
            borderRadius: "1px 1px 0 0",
            background: "color-mix(in srgb, {colors.brand.solid} 42%, transparent)",
            pointerEvents: "none",
            minWidth: "0",
            '&[data-out="true"]': {
                background: "color-mix(in srgb, {colors.fg.muted} 20%, transparent)",
            },
        },
        mask: {
            position: "absolute",
            top: "0",
            bottom: "0",
            background: "color-mix(in srgb, {colors.fg} 4%, transparent)",
            pointerEvents: "none",
        },
        /* Invisible edge-resize hot zone (2 × BRUSH_HANDLE_PX wide, centred on
         * the bound) — must stay in lockstep with brush-math's hit-test. */
        handleZone: {
            position: "absolute",
            top: "0",
            bottom: "0",
            width: "10px",
            transform: "translateX(-50%)",
            cursor: "ew-resize",
            display: "flex",
            alignItems: "stretch",
            justifyContent: "center",
        },
        /* The visible handle — 5 px, r2, brand, inset 4 px top/bottom. */
        handleBar: {
            width: "5px",
            borderRadius: "2px",
            background: "brand.solid",
            marginTop: "4px",
            marginBottom: "4px",
        },
        now: {
            position: "absolute",
            top: "0",
            bottom: "0",
            width: "1.5px",
            background: "brand.solid",
            opacity: "0.8",
            pointerEvents: "none",
        },
    },
});
