/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * EditableChip slot recipe — a chip that triggers a consumer-provided
 * picker. The chip outline follows the `tag` / `.chip` atom; the trailing
 * slot carries the "editable" affordance icon.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const editableChipSlotRecipe = defineSlotRecipe({
    className: "elara-editable-chip",
    slots: ["root", "trigger"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1.5}",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            fontFamily: "body",
            fontWeight: "medium",
            color: "brand.fg",
            cursor: "pointer",
            transitionProperty: "background, border-color, color",
            transitionDuration: "{durations.fast}",
            _hover: { borderColor: "fg.muted" },
            _disabled: { opacity: 0.5, cursor: "not-allowed", _hover: { borderColor: "border.strong" } },
        },
        trigger: {
            display: "inline-flex",
            alignItems: "center",
            color: "fg.muted",
            fontSize: "{fontSizes.xs}",
        },
    },
    variants: {
        size: {
            xs: { root: { paddingX: "{spacing.1.5}", paddingY: "0", fontSize: "{fontSizes.xs}" } },
            sm: { root: { paddingX: "{spacing.2}", paddingY: "{spacing.0.5}", fontSize: "{fontSizes.sm}" } },
            md: { root: { paddingX: "{spacing.2.5}", paddingY: "{spacing.1}", fontSize: "{fontSizes.sm}" } },
            lg: { root: { paddingX: "{spacing.3}", paddingY: "{spacing.1.5}", fontSize: "{fontSizes.md}" } },
            xl: { root: { paddingX: "{spacing.3.5}", paddingY: "{spacing.2}", fontSize: "{fontSizes.md}" } },
        },
    },
    defaultVariants: { size: "sm" },
});
