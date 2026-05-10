/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Semantic tokens for the canonical Elara Chakra v3 system.
 *
 * Where {@link tokens} expose raw scale values (`brand.500`, `gray.200`),
 * these expose roles (`bg.surface`, `fg.muted`, `border.subtle`). Components
 * should consume the role tokens — that's what makes the theme swappable.
 *
 * @packageDocumentation
 */

import { defineSemanticTokens } from "@chakra-ui/react";

export const semanticTokens = defineSemanticTokens({
    colors: {
        /* ─── Surfaces ───────────────────────────────────────── */
        bg: {
            canvas:  { value: { base: "{colors.gray.50}",  _dark: "{colors.gray.900}" } },
            surface: { value: { base: "{colors.white}",     _dark: "{colors.gray.800}" } },
            muted:   { value: { base: "{colors.gray.100}", _dark: "{colors.gray.700}" } },
            inverse: { value: { base: "{colors.brand.900}", _dark: "{colors.white}" } },
        },

        /* ─── Foreground ────────────────────────────────────── */
        fg: {
            DEFAULT: { value: { base: "{colors.gray.900}", _dark: "{colors.gray.100}" } },
            muted:   { value: { base: "{colors.gray.600}", _dark: "{colors.gray.400}" } },
            subtle:  { value: { base: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
            inverse: { value: { base: "{colors.white}",     _dark: "{colors.brand.900}" } },
        },

        /* ─── Borders ───────────────────────────────────────── */
        border: {
            subtle: { value: { base: "{colors.gray.200}", _dark: "{colors.gray.700}" } },
            strong: { value: { base: "{colors.gray.300}", _dark: "{colors.gray.600}" } },
            focus:  { value: "{colors.brand.500}" },
        },

        /* ─── Status ink (legible numerics on white) ──────────
         *
         *  - success — true positive / committed action (green-700 territory)
         *  - caution — a flagged risk in body prose; muted red so it reads as
         *              caution, not destructive error. Pair with body text.
         *  - danger  — destructive / blocking error UI (red-700). Reserve for
         *              true error states, not risk callouts.
         *  - warning — orange-700, for "needs attention" (stale, drift, etc.)
         */
        ink: {
            success: { value: "{colors.status.successInk}" },
            caution: { value: { base: "{colors.red.600}",     _dark: "{colors.red.400}" } },
            danger:  { value: "{colors.status.dangerInk}" },
            warning: { value: "{colors.status.warningInk}" },
        },

        /* ─── Link ─────────────────────────────────────────── */
        link: {
            DEFAULT: { value: { base: "{colors.brand.600}", _dark: "{colors.brand.300}" } },
            hover:   { value: { base: "{colors.brand.700}", _dark: "{colors.brand.200}" } },
        },
    },
});
