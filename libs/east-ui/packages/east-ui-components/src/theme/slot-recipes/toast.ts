/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Toast slot recipe — inherits alert variants for status backgrounds.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const toastSlotRecipe = defineSlotRecipe({
    className: "elara-toast",
    slots: ["root", "title", "description", "indicator", "closeTrigger", "actionTrigger"],
    base: {
        root: {
            display: "flex",
            alignItems: "flex-start",
            gap: "{spacing.3}",
            borderRadius: "{radii.md}",
            borderWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.surface",
            boxShadow: "md",
            padding: "12px 16px",
            minWidth: "240px",
            maxWidth: "480px",
        },
        indicator: {
            fontFamily: "mono",
            fontSize: "16px",
            fontWeight: "bold",
            flexShrink: 0,
            color: "fg.info",
            lineHeight: "1.4",
        },
        title: { fontWeight: "semibold", fontSize: "{fontSizes.sm}", color: "fg" },
        description: { fontSize: "{fontSizes.control}", color: "fg.muted", marginTop: "{spacing.1}" },
    },
    variants: {
        type: {
            info:    { root: { background: "info.subtle",    borderColor: "fg.info"    }, indicator: { color: "fg.info"    } },
            success: { root: { background: "success.subtle", borderColor: "fg.success" }, indicator: { color: "fg.success" } },
            warning: { root: { background: "warning.subtle", borderColor: "fg.warning" }, indicator: { color: "fg.warning" } },
            error:   { root: { background: "danger.subtle",  borderColor: "fg.danger"  }, indicator: { color: "fg.danger"  } },
            loading: { root: { background: "bg.surface", borderColor: "border.subtle" }, indicator: { color: "{colors.brand.500}" } },
        },
    },
    defaultVariants: { type: "info" },
});
