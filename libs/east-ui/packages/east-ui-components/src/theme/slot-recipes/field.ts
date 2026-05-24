/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Field slot recipe — label + control + helper/error text wrapper.
 *
 * Label uses `caption.eyebrow` so every form label reads spec mono
 * uppercase. Helper is mono tabular muted; error is fg.danger.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const fieldSlotRecipe = defineSlotRecipe({
    className: "elara-field",
    slots: ["root", "label", "errorText", "helperText", "requiredIndicator"],
    base: {
        root: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        label: { textStyle: "caption.eyebrow", marginBottom: "{spacing.1}" },
        helperText: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
            marginTop: "{spacing.1}",
        },
        errorText: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.danger",
            marginTop: "{spacing.1}",
        },
        requiredIndicator: { color: "fg.danger", marginLeft: "{spacing.1}" },
    },
});
