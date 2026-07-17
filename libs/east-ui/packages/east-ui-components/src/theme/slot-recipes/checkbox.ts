/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Checkbox slot recipe — brand accent.
 *
 * Spec rule: `accent-color: brand-d` on every interactive control. Default
 * Chakra blue would clash with the deep-teal palette.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const checkboxSlotRecipe = defineSlotRecipe({
    className: "elara-checkbox",
    slots: ["root", "control", "label", "indicator", "group"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            cursor: "pointer",
            /* Touch hit target (#346) — the 14px control keeps its spec size;
             * the whole label row tap area inflates to ≥44px on coarse. */
            ...coarseHitArea({ position: true }),
        },
        control: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxSize: "14px",
            borderRadius: "{radii.xs}",
            borderWidth: "1.5px",
            borderColor: "border.strong",
            background: "transparent",
            color: "white",
            transitionProperty: "background, border-color",
            transitionDuration: "{durations.fast}",
            // Chakra's Checkmark icon sets stroke-width:3 (in a 24-unit viewBox,
            // ~1.25px here) as an UNLAYERED style, which outranks any layered
            // recipe rule — so this override must be !important to land. Thicken
            // it to read as the spec's bold tick.
            "& svg": { strokeWidth: "5px !important" },
            _disabled: {
                background: "bg.subtle",
                borderColor: "border.subtle",
                cursor: "not-allowed",
            },
        },
        label: {
            fontSize: "{fontSizes.control}",
            color: "fg",
            userSelect: "none",
        },
        group: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
        },
    },
    variants: {
        // Chakra's default checkbox pulls the control box size from its size
        // variant (md = boxSize 5 = 20px), which outranks a base boxSize — pin
        // each size to the spec scale; md is the canonical 14px box.
        // Pin both box and padding per size: Chakra's checkmark size variants
        // carry inconsistent padding (sm none, md/lg 0.5), which would make the
        // md tick smaller than the sm one. A flat 2px inset keeps the glyph
        // scaling monotonically with the box.
        size: {
            sm: { control: { boxSize: "12px", padding: "2px" } },
            md: { control: { boxSize: "14px", padding: "2px" } },
            lg: { control: { boxSize: "16px", padding: "2px" } },
        },
        // The default `solid` variant fills checked/indeterminate from
        // colorPalette. Pin checked to brand-d; the indeterminate "parent"
        // affordance is the muted ink-4 minus — both with a white glyph.
        variant: {
            solid: {
                control: {
                    borderWidth: "1.5px",
                    "&:is([data-state=checked], [data-state=indeterminate])": {
                        background: "{colors.brand.600}",
                        borderColor: "{colors.brand.600}",
                        color: "white",
                    },
                    "&:is([data-state=indeterminate])": {
                        background: "{colors.gray.500}",
                        borderColor: "{colors.gray.500}",
                    },
                },
            },
        },
    },
});
