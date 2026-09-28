/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared segmented date field, including compact spacing for grid editors. @packageDocumentation */
import { defineSlotRecipe } from "@chakra-ui/react";

export const dateFieldSlotRecipe = defineSlotRecipe({
    className: "elara-date-field",
    slots: ["root", "label", "input", "segment"],
    base: {
        root: { display: "inline-block" },
        label: { fontSize: "sm", fontWeight: "500", color: "fg", marginBottom: "2" },
        input: {
            display: "inline-flex", border: "none", padding: "0", alignItems: "center", gap: "0",
            background: "transparent", cursor: "text", whiteSpace: "nowrap", flexWrap: "nowrap",
            _focus: { outline: "none" },
            "&[data-readonly]": { opacity: "0.8", cursor: "not-allowed" },
        },
        segment: {
            paddingX: "0", textAlign: "center", background: "transparent", color: "fg",
            borderRadius: "2px", outline: "none", border: "1px solid transparent", cursor: "text",
            "&[data-literal]": { borderWidth: "0" },
            "&[data-placeholder]": { background: "bg.subtle", color: "fg.subtle" },
            "&[data-readonly]": { cursor: "default", fontStyle: "italic", opacity: "0.8" },
            "&:focus:not([data-readonly])": { background: "gray.100", color: "gray.800", borderColor: "gray.400", outline: "none" },
        },
    },
    variants: {
        size: {
            xs: { input: { fontSize: "xs", lineHeight: "1.3", _coarse: { fontSize: "md" } } },
            sm: { input: { fontSize: "xs", lineHeight: "1.3", _coarse: { fontSize: "md" } } },
            md: { input: { fontSize: "control", lineHeight: "1.3", _coarse: { fontSize: "md" } } },
            lg: { input: { fontSize: "md", lineHeight: "1.3" } },
        },
    },
    defaultVariants: { size: "md" },
});
