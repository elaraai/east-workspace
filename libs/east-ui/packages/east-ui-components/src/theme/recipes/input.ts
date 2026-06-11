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
import { fieldChrome, numericChrome } from "../field-chrome.js";

export const inputRecipe = defineRecipe({
    className: "elara-input",
    base: { ...fieldChrome },
    variants: {
        variant: {
            default: {},
            /** Mono + right-aligned for numeric form rows. */
            numeric: { ...numericChrome },
            /** Uncommitted edit — spec `.mx-num.dirty` */
            dirty: {
                background: "warning.subtle.strong",
                boxShadow: "inset 2px 0 0 {colors.fg.warning}",
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
                    borderBottomColor: "{colors.brand.600}",
                    boxShadow: "none",
                },
            },
        },
        size: {
            sm: { fontSize: "{fontSizes.xs}" /* 12 */, paddingX: "{spacing.2}", paddingY: "{spacing.1}" },
            md: { fontSize: "{fontSizes.control}", paddingX: "10px", paddingY: "7px" },
            lg: { fontSize: "{fontSizes.md}" /* 16 */, paddingX: "{spacing.4}", paddingY: "{spacing.3}" },
        },
    },
    defaultVariants: {
        variant: "default",
        size: "md",
    },
});
