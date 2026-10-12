/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Select slot recipe — inherits Input chrome on the trigger; the content
 * listbox is flat and bordered — no shadow (the design system shadows
 * nothing but the focus ring). Each size's trigger is the shared input's one
 * line (`fieldHeights`, #1220), its value centred in it; it clears the
 * `textStyle` Chakra's default trigger sizes carry, which outranks a size's
 * own `fontSize`. The chevron and a picked item's check are Font Awesome's
 * (#1263), each in the square Chakra's icon took: 16px — 20px at lg, 14px at
 * xs. Font Awesome's own height is 1em, outranking the `_icon` size, so the
 * part's font is the icon's size, and `--fa-width` its width.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldChrome, fieldHeights, TOUCH_FONT_FLOOR } from "../field-chrome.js";

export const selectSlotRecipe = defineSlotRecipe({
    className: "elara-select",
    slots: [
        "root", "label", "control", "trigger", "indicatorGroup",
        "indicator", "clearTrigger", "valueText",
        "positioner", "content", "item", "itemText", "itemIndicator",
        "itemGroup", "itemGroupLabel",
    ],
    base: {
        trigger: {
            ...fieldChrome,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.2}",
            width: "100%",
            cursor: "pointer",
            /* Touch (#346): 44px trigger + 16px text on coarse pointers. */
            _coarse: { minHeight: "44px", fontSize: TOUCH_FONT_FLOOR },
        },
        valueText: {
            flex: 1,
            // Shrink + ellipsis-truncate a long value INSIDE the trigger's
            // reserved area instead of running under the absolutely-positioned
            // chevron (#130). A flex item's default `min-width: auto` won't
            // shrink below its content, so `minWidth: 0` is required.
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            textAlign: "left",
            color: "fg",
            _placeholder: { color: "fg.subtle" },
        },
        indicator: {
            color: "fg.muted",
            fontSize: "16px",
            "--fa-width": "1em",
        },
        // A box the icon's own at every size (Chakra's md alone makes it flex),
        // never a line box around it: Font Awesome draws inline.
        itemIndicator: {
            display: "inline-flex",
            alignItems: "center",
            fontSize: "16px",
            "--fa-width": "1em",
        },
        content: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            paddingY: "{spacing.1}",
            overflow: "hidden",
            maxHeight: "320px",
            overflowY: "auto",
        },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            fontSize: "{fontSizes.body}",
            cursor: "pointer",
            /* Touch (#346). */
            _coarse: { minHeight: "44px" },
            _hover: { background: "bg.subtle" },
            _highlighted: { background: "bg.subtle" },
            _selected: { color: "brand.fg" },
        },
        itemGroupLabel: {
            textStyle: "caption.eyebrow",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
        },
        label: {
            textStyle: "caption.eyebrow",
            marginBottom: "{spacing.1}",
        },
    },
    variants: {
        variant: {
            outline: {},
            numeric: {
                trigger: {
                    fontFamily: "mono",
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                },
                item: {
                    fontFamily: "mono",
                    fontVariantNumeric: "tabular-nums",
                },
            },
        },
        // Reserve room at the inline-end for the absolutely-positioned chevron
        // (`indicatorGroup` sits over the trigger's right edge), so the value
        // text never collides with it — per size (#130).
        size: {
            sm: { trigger: { textStyle: "none", fontSize: "{fontSizes.body.sm}", height: fieldHeights.sm, paddingX: "{spacing.2}", paddingInlineEnd: "28px", paddingY: "0" } },
            md: { trigger: { textStyle: "none", fontSize: "{fontSizes.body}", height: fieldHeights.md, paddingX: "10px", paddingInlineEnd: "30px", paddingY: "0" } },
            lg: { trigger: { textStyle: "none", fontSize: "{fontSizes.body.lg}", height: fieldHeights.lg, paddingX: "{spacing.4}", paddingInlineEnd: "38px", paddingY: "0" }, indicator: { fontSize: "20px" } },
            // Chakra's xs trigger keeps its own; its chevron is 14px, as Chakra's was.
            xs: { indicator: { fontSize: "14px" } },
        },
    },
    defaultVariants: {
        variant: "outline",
        size: "md",
    },
});
