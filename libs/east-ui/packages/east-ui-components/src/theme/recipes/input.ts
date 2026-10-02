/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Input recipe — the canonical text-field shape, mirrored by the combobox
 * and select triggers so every typed control reads identically.
 *
 *  - `numeric` — mono + right-aligned tabular figures for parameter forms,
 *    matrix cells, KPI inputs.
 *  - `dirty` — flags an uncommitted edit (matrix dirty cells).
 *  - `flushed` — borderless strip for the command-palette input.
 *  Always paired with a static `<label>` above; no floating labels.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";
import { fieldChrome, numericChrome, TOUCH_FONT_FLOOR } from "../field-chrome.js";

export const inputRecipe = defineRecipe({
    className: "elara-input",
    /* Touch (#346): 44px minimum control height on coarse pointers. The
     * 16px font floor lives on each size variant (variant styles land after
     * base in the cascade) — sub-16px focused inputs make iOS Safari zoom
     * the page. */
    base: { ...fieldChrome, _coarse: { minHeight: "44px" } },
    variants: {
        variant: {
            default: {},
            /** Mono + right-aligned for numeric form rows. */
            numeric: { ...numericChrome },
            /** Uncommitted edit — a dirty value is the `--brand-tint` fill
             *  (component-rules §1, base-components › Field). */
            dirty: {
                background: "brandTint",
                fontWeight: "semibold",
                color: "fg",
            },
            /** Borderless variant for command-palette input strips. */
            flushed: {
                borderWidth: "0",
                borderRadius: "0",
                paddingX: "0",
                borderBottomWidth: "1px",
                borderBottomColor: "border.strong",
                _focusVisible: {
                    borderBottomColor: "brand.solid",
                    boxShadow: "none",
                },
            },
        },
        size: {
            sm: { fontSize: "{fontSizes.body.sm}" /* 12.5 */, paddingX: "{spacing.2}", paddingY: "{spacing.1}", _coarse: { fontSize: TOUCH_FONT_FLOOR } },
            md: { fontSize: "{fontSizes.body}" /* 13 */, paddingX: "10px", paddingY: "7px", _coarse: { fontSize: TOUCH_FONT_FLOOR } },
            lg: { fontSize: "{fontSizes.body.lg}" /* 14 */, paddingX: "{spacing.4}", paddingY: "{spacing.3}" },
        },
    },
    defaultVariants: {
        variant: "default",
        size: "md",
    },
});
