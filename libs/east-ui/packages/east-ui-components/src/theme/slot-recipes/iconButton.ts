/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `iconButton` slot recipe — the optional corner badge + attention chrome an
 * IconButton wraps around the native Chakra button (#123). The button itself
 * stays a plain `<IconButton>`; this recipe owns the static chrome:
 *
 *  - `wrapper` — the `position: relative` anchor for the badge + ring;
 *  - `ring`    — the expanding, fading "ping" attention ring around the button;
 *  - `badge`   — the superscript count/notification bubble (`shape` = dot | count,
 *                growing to a pill on overflow; `pulse` blinks it).
 *
 * Animations honour `prefers-reduced-motion`. The palette (`badgeColorPalette`
 * / the button palette) is the only thing set inline on the element — the
 * `colorPalette.*` tokens here resolve against it.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const iconButtonSlotRecipe = defineSlotRecipe({
    className: "elara-icon-button",
    slots: ["wrapper", "ring", "badge"],
    base: {
        wrapper: {
            position: "relative",
            display: "inline-flex",
        },
        ring: {
            position: "absolute",
            inset: "0",
            borderRadius: "md",
            borderWidth: "2px",
            borderColor: "colorPalette.solid",
            pointerEvents: "none",
            animation: "elara-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        },
        badge: {
            bg: "colorPalette.solid",
            color: "colorPalette.contrast",
            borderRadius: "full",
            borderWidth: "1.5px",
            borderColor: "bg.surface",
            fontSize: "9px",
            fontWeight: "bold",
            lineHeight: "1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
        },
    },
    variants: {
        // dot-only indicator vs a count/text bubble (a circle for 1 digit,
        // growing to a pill via minWidth + horizontal padding on overflow).
        shape: {
            dot:   { badge: { minWidth: "8px",  height: "8px",  paddingX: "0" } },
            count: { badge: { minWidth: "16px", height: "16px", paddingX: "1" } },
        },
        // Pulse the badge to draw the eye to the count.
        pulse: {
            true: {
                badge: {
                    animation: "elara-pulse 1.6s ease-in-out infinite",
                    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                },
            },
            false: {},
        },
    },
    defaultVariants: {
        shape: "count",
        pulse: false,
    },
});
