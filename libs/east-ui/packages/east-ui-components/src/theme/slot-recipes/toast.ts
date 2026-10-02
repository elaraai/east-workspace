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
            padding: "12px 16px",
            minWidth: "240px",
            maxWidth: "480px",
        },
        indicator: {
            fontFamily: "mono",
            fontSize: "16px",
            fontWeight: "bold",
            flexShrink: 0,
            color: "status.info",
            lineHeight: "1.4",
        },
        title: { fontWeight: "semibold", fontSize: "{fontSizes.body.lg}", color: "fg" },
        description: { fontSize: "{fontSizes.body}", color: "fg.muted", marginTop: "{spacing.1}" },
    },
    variants: {
        /* The edge and the indicator glyph are marks: the valence base. */
        type: {
            info:    { root: { background: "info.subtle",    borderColor: "status.info" }, indicator: { color: "status.info" } },
            success: { root: { background: "success.subtle", borderColor: "status.pos"  }, indicator: { color: "status.pos"  } },
            warning: { root: { background: "warning.subtle", borderColor: "status.warn" }, indicator: { color: "status.warn" } },
            error:   { root: { background: "danger.subtle",  borderColor: "status.neg"  }, indicator: { color: "status.neg"  } },
            loading: { root: { background: "bg.surface", borderColor: "border.subtle" }, indicator: { color: "brandMark" } },
        },
    },
    defaultVariants: { type: "info" },
});
