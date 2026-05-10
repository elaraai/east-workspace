/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named layer-style presets for the Elara Chakra v3 system.
 *
 * `<Box layerStyle="card" />` — and the canonical 1px subtle border + 6px
 * radius + 16px padding + sm shadow are baked in. Authors don't pick a
 * radius, padding, or border value; they pick a role.
 *
 * @packageDocumentation
 */

import { defineLayerStyles } from "@chakra-ui/react";

export const layerStyles = defineLayerStyles({
    /* ─── Cards — the workhorse surface ──────────────────────── */

    /** Default card: white fill, 1px subtle border, 6px radius, sm shadow, 16px padding. */
    "card": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "md",   // 6px (product). Marketing tier uses card.lg.
            padding: "4",          // 16px
            boxShadow: "sm",
        },
    },

    /** Marketing-tier card: 8px radius, 24px padding (per UX/UI Guide §05). */
    "card.lg": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "lg",   // 8px
            padding: "6",          // 24px
            boxShadow: "sm",
        },
    },

    /** Flat card — no shadow at rest. For nested groupings. */
    "card.flat": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "md",
            padding: "4",
        },
    },

    /** Elevated — for popovers, dropdowns, hover lifts. */
    "card.elevated": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "md",
            padding: "4",
            boxShadow: "md",
        },
    },

    /* ─── Surfaces — utility regions ────────────────────────── */

    /** Muted recessed surface for nested rows / row-of-rows. */
    "surface.muted": {
        value: {
            background: "bg.muted",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "sm",
            padding: "3",          // 12px
        },
    },

    /** Page-level canvas. Used by Container to break up sections. */
    "surface.canvas": {
        value: {
            background: "bg.canvas",
        },
    },

    /** Inverse — dark hero / footer / dialog backdrop. */
    "surface.inverse": {
        value: {
            background: "bg.inverse",
            color: "fg.inverse",
        },
    },

    /* Note: pill / chip is intentionally NOT a layer-style — Chakra's
     * layer-style validator constrains values to surface-level properties
     * (bg, border, padding, radius, shadow). Pills carry display: inline-flex
     * + gap + font choices, so they belong in a recipe (or composed inline
     * via HStack + props). See `Tag` / `Badge` recipes when those land. */
});
