/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Checkbox slot recipe — brand accent.
 *
 * Spec rule: `accent-color: brand-d` on every interactive control. Default
 * Chakra blue would clash with the deep-teal palette.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const checkboxSlotRecipe = defineSlotRecipe({
    className: "elara-checkbox",
    slots: ["root", "control", "label", "indicator", "group"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            cursor: "pointer",
        },
        control: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            height: "16px",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            color: "white",
            transitionProperty: "background, border-color",
            transitionDuration: "{durations.fast}",
            _checked: {
                background: "{colors.brand.600}",
                borderColor: "{colors.brand.600}",
            },
            _indeterminate: {
                background: "{colors.brand.600}",
                borderColor: "{colors.brand.600}",
            },
            _disabled: {
                background: "bg.subtle",
                borderColor: "border.subtle",
                cursor: "not-allowed",
            },
        },
        label: {
            fontSize: "{fontSizes.sm}",
            color: "fg",
            userSelect: "none",
        },
        group: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
        },
    },
});
