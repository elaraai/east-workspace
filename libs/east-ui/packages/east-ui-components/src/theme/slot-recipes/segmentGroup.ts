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
 * `variant="ink"` matches spec `.context-tabs` (active = ink fill, white
 * text); `variant="brand-tint"` matches spec `.lib-seg-btn` (active =
 * brand-tinted surface). Segments are mono, divided by a right-rule.
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
            /* Compact containers (#349): overflowing segments WRAP onto
             * further rows. Safe here because the sliding indicator is
             * hidden (active state paints via the item's `_checked`), so
             * the Zag single-row assumption never applies. Width stays
             * auto (shrink-to-fit) with `minWidth: 0` so a flex parent can
             * actually clamp the box — a fixed `max-content` width plus
             * the min-width:auto floor defeats both the percentage clamp
             * and line-shrink, and the wrap never engages. ALL dividers
             * (between segments AND between wrapped rows) are the
             * border-coloured root surface showing through a uniform 1px
             * gap — one mechanism, one visual weight; items carry no
             * borders of their own. */
            minWidth: 0,
            maxWidth: "100%",
            flexWrap: "wrap",
            gap: "1px",
            /* Keep intrinsic width even inside a parent flex with
             * `align-items: stretch` (e.g. VStack). */
            alignSelf: "flex-start",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "border.strong",
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
            /* Wrapped rows fill flush (no ragged root-colour exposure);
             * an unwrapped group shrinks to fit, so grow never shows. */
            flexGrow: 1,
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            /* Touch (#346). */
            _coarse: { minHeight: "44px" },
            borderRadius: "0",
            cursor: "pointer",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            color: "fg.muted",
            background: "transparent",
            /* Defeat Chakra default `_before` divider line — the 1px root
             * gap is the divider. */
            _before: { display: "none" },
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
            /** Spec `.lib-seg-btn` active. Spec fills with the pale brand-tint,
             *  but against the white surface that delta is near-invisible — step
             *  up a few brand stops so the selected segment is legible, same hue
             *  family. Active text is `--brand-dd` (brand.700). */
            "brand-tint": {
                item: {
                    background: "bg.surface",
                    _checked: {
                        background: "{colors.brand.100}",
                        color: "{colors.brand.700}",
                        _dark: { background: "{colors.brand.800}", color: "{colors.brand.300}" },
                    },
                    "&[data-state=checked]": {
                        background: "{colors.brand.100}",
                        color: "{colors.brand.700}",
                        _dark: { background: "{colors.brand.800}", color: "{colors.brand.300}" },
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
        /* Default to the brand-tint active treatment; `ink` and `subtle`
         * remain available as palette overrides. */
        variant: "brand-tint",
        size: "md",
    },
});
