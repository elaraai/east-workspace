/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * TagsInput slot recipe — the control wears the shared input chrome (wrapping
 * its chips); each committed value is a brand-tint chip with a brand-d delete ×.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldChrome, fieldFocusRing } from "../field-chrome.js";
import { coarseHitArea } from "../../style/hit-area.js";

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
            paddingBlock: "6px",
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
            background: "{colors.brandTint}",
            borderWidth: "1px",
            borderColor: "{colors.brand.500}",
            color: "{colors.brand.700}",
            borderRadius: "{radii.sm}",
            paddingInline: "10px",
            paddingBlock: "4px",
            fontSize: "{fontSizes.xs}",
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
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",
            color: "fg",
            paddingInline: "6px",
            paddingBlock: "4px",
            _placeholder: { color: "fg.subtle" },
        },
    },
});
