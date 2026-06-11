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
        // Density cascade — mirrors the chipRail `--cr-*` sets so an editable
        // chip lines up with tags and traces at the same density. No default:
        // an undensified chip keeps the `size` look. Declared after `size` so
        // density wins the merge.
        density: {
            condensed: {
                root: { fontSize: "9px", lineHeight: "1", paddingX: "7px", paddingY: "2px", borderRadius: "3px", gap: "4px" },
                trigger: { fontSize: "9px" },
            },
            compact: {
                root: { fontSize: "10px", lineHeight: "1", paddingX: "10px", paddingY: "5px", borderRadius: "4px", gap: "5px" },
                trigger: { fontSize: "10px" },
            },
            comfortable: {
                root: { fontSize: "12.5px", lineHeight: "1", paddingX: "15px", paddingY: "9.75px", borderRadius: "6px", gap: "7px" },
                trigger: { fontSize: "12.5px" },
            },
        },
    },
    defaultVariants: { size: "sm" },
});
