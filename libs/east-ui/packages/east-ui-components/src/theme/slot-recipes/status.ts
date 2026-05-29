/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Status slot recipe — pattern_spec/spec.css `.status` + `.dot.*`.
 *
 * Spec rule: status = dot + WORD, **never tinted background**. The wrapper
 * carries no chrome — just inline-flex + gap. The indicator is a bare 8 px
 * circle whose colour comes from the spec's muted hues, and the label is
 * rendered in mono uppercase via `caption.eyebrow`.
 *
 * Variant `status` aligns with the East UI IR's StatusType tags
 * (`success | warning | danger | info | neutral`) so the renderer can
 * pass `value.value.type` directly.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const statusSlotRecipe = defineSlotRecipe({
    className: "elara-status",
    slots: ["root", "indicator", "label"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "transparent",
            whiteSpace: "nowrap",
            flexShrink: 0,
        },
        indicator: {
            display: "inline-block",
            borderRadius: "{radii.full}",
            flexShrink: 0,
        },
        label: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.muted",
            lineHeight: "1.2",
        },
    },
    variants: {
        status: {
            success: { indicator: { background: "fg.success" } },
            warning: { indicator: { background: "fg.warning" } },
            danger:  { indicator: { background: "fg.danger"  } },
            info:    { indicator: { background: "fg.info"    } },
            neutral: { indicator: { background: "fg.subtle"   } },
            brand:   { indicator: { background: "{colors.brand.500}" } },
        },
        size: {
            sm: { indicator: { width: "6px",  height: "6px"  } },
            md: { indicator: { width: "8px",  height: "8px"  } },
            lg: { indicator: { width: "10px", height: "10px" } },
        },
        pulsing: {
            true:  { indicator: { animation: "spec-pulse-run 1.6s ease-in-out infinite" } },
            false: {},
        },
        live: {
            true: {
                indicator: {
                    boxShadow: "0 0 0 3px rgba(72, 142, 151, 0.18)",
                    animation: "spec-pulse-live 2.4s ease-in-out infinite",
                },
            },
            false: {},
        },
    },
    defaultVariants: {
        status: "neutral",
        size: "md",
        pulsing: false,
        live: false,
    },
});
