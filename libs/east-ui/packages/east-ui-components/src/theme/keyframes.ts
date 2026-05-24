/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @keyframes registered under `theme.keyframes` for the Elara Chakra v3
 * system. Lives in its own module because Chakra's `defineGlobalStyles`
 * type-checker rejects percentage step keys; the dedicated `keyframes`
 * config slot accepts them.
 *
 *  - `elara-pulse`         — generic opacity pulse (Skeleton / pulsing dots).
 *  - `elara-spin`          — full rotation (Spinner default).
 *  - `elara-shimmer`       — background-position sweep (Skeleton variant).
 *  - `spec-pulse-live`     — pattern_spec `.dot.live` (2.4 s ring pulse).
 *  - `spec-pulse-run`      — pattern_spec `.dot.run`  (1.6 s pulse).
 *  - `spec-blink`          — pattern_spec blink (cursor / pending marker).
 *
 * @packageDocumentation
 */

import { defineKeyframes } from "@chakra-ui/react";

export const keyframes = defineKeyframes({
    "elara-pulse": {
        "0%, 100%": { opacity: 1 },
        "50%":      { opacity: 0.4 },
    },
    "elara-spin": {
        "0%":   { transform: "rotate(0deg)" },
        "100%": { transform: "rotate(360deg)" },
    },
    "elara-shimmer": {
        "0%":   { backgroundPosition: "200% 0" },
        "100%": { backgroundPosition: "-200% 0" },
    },
    "spec-pulse-live": {
        "0%, 100%": { opacity: 1 },
        "50%":      { opacity: 0.5 },
    },
    "spec-pulse-run": {
        "0%, 100%": { opacity: 1 },
        "50%":      { opacity: 0.45 },
    },
    "spec-blink": {
        "50%": { opacity: 0 },
    },
});
