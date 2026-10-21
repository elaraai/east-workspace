/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Field slot recipe — label + control + helper/error text wrapper.
 *
 * Label uses `caption.eyebrow` so every form label reads spec mono
 * uppercase; a field's key (`data-field-key`, the field's path as a form
 * names it) follows it in mono, in its own case. Short of room, the key
 * wraps under the label and either breaks where it must, so a label never
 * runs past its field — a phone's narrow pane included. Helper is mono
 * tabular muted; error is fg.danger.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const fieldSlotRecipe = defineSlotRecipe({
    className: "elara-field",
    slots: ["root", "label", "errorText", "helperText", "requiredIndicator"],
    base: {
        root: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        label: {
            textStyle: "caption.eyebrow", marginBottom: "{spacing.1}",
            // Chakra's label is a flex row 4px apart: ours wraps, its key 12px after the label as the key's margin once put it.
            flexWrap: "wrap", alignItems: "baseline", gap: "0 {spacing.3}", maxWidth: "100%", minWidth: 0, overflowWrap: "anywhere",
            "& > [data-field-key]": {
                minWidth: 0, fontFamily: "mono", fontSize: "{fontSizes.label.lg}", fontWeight: "{fontWeights.medium}",
                letterSpacing: "{letterSpacings.normal}", textTransform: "none", color: "fg.muted", overflowWrap: "anywhere",
            },
        },
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
