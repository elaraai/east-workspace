/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Brush strip recipe — the horizon brush (#1438), shared by the standalone
 * `Slice.Rail` brush and the Plan canvas's horizon band. One vocabulary at
 * every density (the host sets the strip's height), every layer a semantic
 * token, so the dark theme needs nothing of its own. Bottom to top:
 *
 * - **track** — `bg.surface` edge to edge; nothing masks outside the window.
 * - **band** — the window, `brandTint` at 0.7, the track's full height,
 *   behind the bars.
 * - **baseline** — 1px of `border.subtle` along the track's bottom, under the
 *   bars: it shows in their gaps and under an empty bucket.
 * - **bars** — one layer of the histogram; each **bar** a step on the heat
 *   ramp (`heat.1` … `heat.5`, by its count), top corners 1. Outside the
 *   window the layer dims its bars to 0.45; the same bars again on a layer
 *   clipped to the window draw at full strength.
 * - **now** — 1px of `brand.solid`, the track's full height, over the bars,
 *   under the handles.
 * - **window** — the window's own stop between the handles: it carries the
 *   move cursor and its focus ring, `focusInset`, and draws nothing else.
 * - **zone** — an edge's invisible resize zone, 12 wide (24 on a coarse
 *   pointer), centred on its edge, in lockstep with `brush-math`'s
 *   `BRUSH_HANDLE_PX`; a narrow window's sits beside its edge (`data-side`,
 *   `brushZoneSides`): outside it, or against the track's end just inside.
 * - **handle** — an outlined tab, 9 wide, 2 in from the track's top and
 *   bottom, centred on its edge — beside a narrow window's, over its zone
 *   against the edge: `bg.surface` fill, a 1px `brand.solid` border and two
 *   1px × 10 **grip**s in the same ink, a 1px `bg.surface` outline, so it
 *   reads on any bar. Hover `bg.canvas` with `brandPressed`
 *   ink; pressed `brandTint` with `brandPressed`; focus its ring, `focus`.
 * - **anchor** — the hovered bucket's slot, which the Tooltip stands 8 above.
 *
 * Editing the window here is editing the slice's Range — the gesture machine
 * (draw / slide / resize, and the keys) lives in `slice/brush-math.ts`.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const brushStripSlotRecipe = defineSlotRecipe({
    className: "elara-brush-strip",
    slots: ["track", "band", "baseline", "bars", "bar", "now", "window", "zone", "handle", "grip", "anchor"],
    base: {
        track: {
            position: "relative",
            minWidth: "0",
            background: "bg.surface",
            touchAction: "none",
            userSelect: "none",
            // A gesture in hand shows its own cursor everywhere on the track.
            "&[data-dragging] *": { cursor: "inherit" },
        },
        band: {
            position: "absolute",
            top: "0",
            bottom: "0",
            background: "brandTint",
            opacity: "0.7",
            pointerEvents: "none",
        },
        baseline: {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "0",
            height: "1px",
            background: "border.subtle",
            pointerEvents: "none",
        },
        bars: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            "&[data-dim] > *": { opacity: "0.45" },
        },
        bar: {
            position: "absolute",
            bottom: "0",
            borderRadius: "1px 1px 0 0",
            "&[data-step='1']": { background: "heat.1" },
            "&[data-step='2']": { background: "heat.2" },
            "&[data-step='3']": { background: "heat.3" },
            "&[data-step='4']": { background: "heat.4" },
            "&[data-step='5']": { background: "heat.5" },
        },
        now: {
            position: "absolute",
            top: "0",
            bottom: "0",
            width: "1px",
            transform: "translateX(-50%)",
            background: "brand.solid",
            pointerEvents: "none",
        },
        window: {
            position: "absolute",
            top: "0",
            bottom: "0",
            cursor: "grab",
            outline: "none",
            _focusVisible: { boxShadow: "focusInset" },
        },
        zone: {
            position: "absolute",
            top: "0",
            bottom: "0",
            width: "12px",
            transform: "translateX(-50%)",
            cursor: "ew-resize",
            _coarse: { width: "24px" },
            // Beside a narrow window's edge: outside it, or against the track's end just inside it.
            "&[data-side='out'][data-edge='lo']": { transform: "translateX(-100%)" },
            "&[data-side='in'][data-edge='hi']": { transform: "translateX(-100%)" },
            "&[data-side='out'][data-edge='hi']": { transform: "none" },
            "&[data-side='in'][data-edge='lo']": { transform: "none" },
        },
        handle: {
            position: "absolute",
            top: "2px",
            bottom: "2px",
            left: "50%",
            width: "9px",
            transform: "translateX(-50%)",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1px",
            color: "brand.solid",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "currentColor",
            borderRadius: "2px",
            outlineWidth: "1px",
            outlineStyle: "solid",
            outlineColor: "bg.surface",
            // Beside a narrow window's edge, drawn over its zone against the edge: what is drawn is what is grabbed.
            "[data-side='out'][data-edge='lo'] > &": { left: "100%", transform: "translateX(-100%)" },
            "[data-side='in'][data-edge='hi'] > &": { left: "100%", transform: "translateX(-100%)" },
            "[data-side='out'][data-edge='hi'] > &": { left: "0", transform: "none" },
            "[data-side='in'][data-edge='lo'] > &": { left: "0", transform: "none" },
            "[data-brush-zone]:hover > &": { color: "brandPressed", background: "bg.canvas" },
            "&[data-pressed]": { color: "brandPressed", background: "brandTint" },
            _focusVisible: { boxShadow: "focus" },
        },
        grip: {
            width: "1px",
            height: "10px",
            background: "currentColor",
            flex: "none",
        },
        anchor: {
            position: "absolute",
            top: "0",
            bottom: "0",
            pointerEvents: "none",
        },
    },
});
