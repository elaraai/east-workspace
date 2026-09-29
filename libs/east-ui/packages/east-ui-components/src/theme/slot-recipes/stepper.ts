/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Stepper slot recipe — a value between its − and + buttons, in one bordered
 * strip, as the Studio spec draws the builder's zoom (`− 100% +`) and its
 * inspector's column span (`− 8 / 12 +`). The value reads in mono tabular
 * figures between two rules; a button disables at the bound its host holds
 * the value to.
 *
 * `tone` is the strip's ink: `neutral` for a toolbar's control, `brand` for
 * the value a pane is editing. `size` is where it sits: `sm` in a toolbar
 * row, `md` in a pane's field rows.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const stepperSlotRecipe = defineSlotRecipe({
    className: "elara-stepper",
    slots: ["root", "button", "value"],
    base: {
        root: {
            flex: "none",
            display: "inline-flex",
            alignItems: "stretch",
            borderWidth: "1px",
            borderStyle: "solid",
            borderRadius: "md",
            overflow: "hidden",
            fontFamily: "mono",
            fontVariantNumeric: "tabular-nums",
        },
        button: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0",
            border: "0",
            background: "transparent",
            cursor: "pointer",
            "& svg": { fontSize: "9px" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            _disabled: { cursor: "not-allowed" },
        },
        value: {
            display: "inline-flex",
            alignItems: "center",
            borderInlineWidth: "1px",
            borderInlineStyle: "solid",
            fontWeight: "600",
            whiteSpace: "nowrap",
        },
    },
    variants: {
        tone: {
            neutral: {
                root: { borderColor: "border.strong" },
                button: { color: "fg.muted", _hover: { color: "fg" }, _disabled: { color: "fg.subtle" } },
                value: { borderInlineColor: "border.subtle", color: "fg" },
            },
            brand: {
                root: { borderColor: "brand.solid", background: "bg.brand.subtle" },
                button: {
                    color: "brand.fg",
                    _hover: { background: "bg.surface" },
                    _disabled: { opacity: 0.4, _hover: { background: "transparent" } },
                },
                value: { borderInlineColor: "brand.solid", color: "brand.fg" },
            },
        },
        size: {
            sm: {
                root: { height: "26px", fontSize: "11px" },
                button: { width: "26px" },
                value: { paddingX: "{spacing.2}" },
            },
            md: {
                root: { height: "28px", fontSize: "12px" },
                button: { width: "28px" },
                value: { paddingX: "10px" },
            },
        },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
});
