/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * TagsInput slot recipe — the control wears the shared input chrome (wrapping
 * its chips); each committed value is a brand-tint chip with a brand-d delete ×.
 *
 * Each size's control is at least the shared input's one line
 * (`fieldHeights`, #1220): a row of the design system's 22px chips, and the
 * box a tag is typed into, centred in it — so tags with one row of chips, or
 * none, sit on the line a text of their size does, and grow a row at a time.
 * Chakra's default recipe sizes the chips and the box by its own variables
 * (24px and 28px); these heights replace them.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldChrome, fieldFocusRing, fieldHeights, TOUCH_FONT_FLOOR } from "../field-chrome.js";
import { coarseHitArea } from "../../style/hit-area.js";

/** A chip's height, and the typed box's beside it: the design system's tag chip. */
const CHIP = "22px";

export const tagsInputSlotRecipe = defineSlotRecipe({
    className: "elara-tags-input",
    slots: [
        "root", "label", "control", "input", "item", "itemPreview",
        "itemText", "itemInput", "itemDeleteTrigger", "clearTrigger",
    ],
    base: {
        control: {
            ...fieldChrome,
            display: "inline-flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "6px",
            paddingInline: "8px",
            width: "100%",
            cursor: "text",
            // Chakra's tagsInput control adds its own focus ring as a 1px solid
            // outline (longhands beat our `outline: none` shorthand), so it sat
            // on top of our brand border. Zero the outline longhands and apply
            // the shared ring on both focus-within and focus-visible so it reads
            // identically to every other input.
            _focusVisible: { ...fieldFocusRing, outline: "none !important" },
            _focusWithin: { ...fieldFocusRing, outline: "none !important" },
        },
        itemPreview: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
            height: CHIP,
            background: "{colors.brandTint}",
            borderWidth: "1px",
            borderColor: "{colors.brand.500}",
            color: "brand.fg",
            borderRadius: "{radii.sm}",
            paddingInline: "10px",
            paddingBlock: "0",
            fontSize: "{fontSizes.body.sm}",
            fontWeight: "medium",
            lineHeight: "1",
            whiteSpace: "nowrap",
        },
        itemDeleteTrigger: {
            color: "{colors.brand.600}",
            cursor: "pointer",
            fontWeight: "normal",
            display: "inline-flex",
            alignItems: "center",
            /* Touch (#346). */
            ...coarseHitArea({ position: true }),
        },
        input: {
            flex: 1,
            minWidth: "80px",
            height: CHIP,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "mono",
            fontSize: "{fontSizes.body.sm}",
            color: "fg",
            paddingInline: "6px",
            paddingBlock: "0",
            _placeholder: { color: "fg.subtle" },
            /* Touch (#346): 16px text, as every input's — a phone zooms into a smaller focused field. */
            _coarse: { fontSize: TOUCH_FONT_FLOOR },
        },
    },
    variants: {
        // The control's line, the chips' row centred in it: (height − border − chip) ÷ 2 above and
        // below. Touch (#346): the 44px floor, as the plain input's — set with each size's own, which
        // a base rule would lose to.
        size: {
            xs: { control: { minHeight: fieldHeights.sm, paddingBlock: "1px", _coarse: { minHeight: "44px" } } },
            sm: { control: { minHeight: fieldHeights.sm, paddingBlock: "1px", _coarse: { minHeight: "44px" } } },
            md: { control: { minHeight: fieldHeights.md, paddingBlock: "4px", _coarse: { minHeight: "44px" } } },
            lg: { control: { minHeight: fieldHeights.lg, paddingBlock: "10px", _coarse: { minHeight: "44px" } } },
        },
    },
    defaultVariants: { size: "md" },
});
