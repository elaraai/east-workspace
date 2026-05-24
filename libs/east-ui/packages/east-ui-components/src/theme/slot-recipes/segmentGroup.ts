/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SegmentGroup slot recipe — pattern_spec/spec.css `.context-tabs` and
 * `.lib-seg-btn` segmented toggles.
 *
 * Chakra v3's SegmentGroup compound exposes these slots:
 *   - `root`         — outer container
 *   - `label`        — optional group label
 *   - `item`         — each segment's wrapper
 *   - `itemText`     — the visible label inside the segment
 *   - `itemControl`  — the radio control + interactive surface
 *   - `indicator`    — the animated sliding pill (we hide this by default
 *                     and use the item's `_checked` state instead, per
 *                     spec convention)
 *
 * Default `variant="ink"` matches spec `.context-tabs` — mono uppercase
 * 11.5 px / 600 / 0.06 em tracking, hairline 1 px `border.strong` group
 * border, 4 px radius, segments divided by 1 px right-rule, active = ink
 * fill against `bg.surface` rest.
 *
 * `variant="brand-tint"` swaps the active fill to spec `.lib-seg-btn`'s
 * brand-tinted surface.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const segmentGroupSlotRecipe = defineSlotRecipe({
    className: "elara-segment-group",
    slots: ["root", "label", "item", "itemText", "itemControl", "indicator"],
    base: {
        root: {
            /* Defeat Chakra defaults: set radii var to 0 so neither root
             * nor item inherits the rounded pill shape, remove the inset
             * shadow ring, and clear muted-grey fill. */
            "--segment-radius": "0px",
            display: "inline-flex",
            alignItems: "stretch",
            width: "max-content",
            /* Keep intrinsic width even inside a parent flex with
             * `align-items: stretch` (e.g. VStack). */
            alignSelf: "flex-start",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            padding: "0",
            overflow: "hidden",
            position: "relative",
            boxShadow: "none",
        },
        label: {
            textStyle: "caption.eyebrow",
            marginRight: "{spacing.2}",
        },
        /* Sliding indicator pill — hidden so the item's `_checked` paint
         * provides the active fill cleanly per spec. */
        indicator: {
            display: "none",
        },
        item: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderRadius: "0",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            cursor: "pointer",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            color: "fg.muted",
            background: "transparent",
            /* Defeat Chakra default `_before` divider line — we use a real
             * border-right above. */
            _before: { display: "none" },
            "&:last-of-type": { borderRightWidth: "0" },
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "none" },
            _disabled: { opacity: 0.4, cursor: "not-allowed" },
            /* Defeat Chakra's SSR-state shim that paints shadow+bg+radius
             * on `[data-ssr][data-state=checked]`. */
            "&[data-state=checked][data-ssr]": {
                boxShadow: "none",
                borderRadius: "0",
            },
        },
        itemText: {
            fontFamily: "mono",
            fontSize: "11.5px",
            fontWeight: "semibold",
            letterSpacing: "{letterSpacings.wider}",
            lineHeight: "1.2",
            color: "inherit",
            whiteSpace: "nowrap",
        },
        itemControl: {
            display: "inline-flex",
            alignItems: "center",
        },
    },
    variants: {
        variant: {
            /** Spec `.context-tabs` — active = ink fill, white text. */
            ink: {
                item: {
                    background: "bg.surface",
                    _checked: {
                        background: "fg.default",
                        color: "bg.surface",
                    },
                    "&[data-state=checked]": {
                        background: "fg.default",
                        color: "bg.surface",
                    },
                },
            },
            /** Active = mid-brand-tinted surface (brand.100) + brand.800 ink.
             *  Spec calls for the lighter `brand-tint` (#e8f6f7) but against
             *  `bg.surface` white that delta reads near-invisible — bump two
             *  stops to `brand.100` (#c2fcfc) so the selected segment actually
             *  pops while keeping the same hue family. */
            "brand-tint": {
                item: {
                    background: "bg.surface",
                    _checked: {
                        background: "{colors.brand.100}",
                        color: "{colors.brand.800}",
                    },
                    "&[data-state=checked]": {
                        background: "{colors.brand.100}",
                        color: "{colors.brand.800}",
                    },
                },
            },
            /** Subtle — active reads as a recessed gray fill. */
            subtle: {
                item: {
                    background: "bg.surface",
                    _checked: { background: "bg.subtle", color: "fg" },
                    "&[data-state=checked]": { background: "bg.subtle", color: "fg" },
                },
            },
        },
        size: {
            xs: { item: { paddingX: "{spacing.2}", paddingY: "1px" }, itemText: { fontSize: "10px" } },
            sm: { item: { paddingX: "{spacing.2}", paddingY: "{spacing.1}" }, itemText: { fontSize: "11px" } },
            md: { item: { paddingX: "{spacing.3}", paddingY: "{spacing.2}" }, itemText: { fontSize: "11.5px" } },
            lg: { item: { paddingX: "{spacing.4}", paddingY: "{spacing.3}" }, itemText: { fontSize: "12.5px" } },
        },
    },
    defaultVariants: {
        /* bsys §Segmented (design/index.html L1126): active = brand-tint
         * bg + brand-dd text. `brand-tint` is the bsys-compliant default;
         * `ink` and `subtle` remain available as palette overrides. */
        variant: "brand-tint",
        size: "md",
    },
});
