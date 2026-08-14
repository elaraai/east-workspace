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
 *  - `elara-ping`          — expanding, fading ring (IconButton attention).
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
    // Entrance for transient drag-layer chrome (the trash sink, #267) —
    // a short rise + fade so the zone reads as appearing for THIS drag.
    "elara-fade-in": {
        "0%":   { opacity: 0, transform: "translateX(-50%) translateY(6px)" },
        "100%": { opacity: 1, transform: "translateX(-50%) translateY(0)" },
    },
    "elara-pulse": {
        "0%, 100%": { opacity: 1 },
        "50%":      { opacity: 0.4 },
    },
    // Plan focus choreography (R1/R2) — arriving overlays (ribbons, tags,
    // developer renders) fade in after the 300ms geometry settle.
    "plan-settle-in": {
        "0%":   { opacity: 0 },
        "100%": { opacity: 1 },
    },
    // Flowchart connect feedback — one-shot brand halo along a link (the
    // existing link on a duplicate drop; the new link on create).
    "fc-connect-pulse": {
        "0%":   { opacity: 0 },
        "35%":  { opacity: 0.5 },
        "100%": { opacity: 0 },
    },
    // Flowchart in-place feedback — a folded self-loop has no route to
    // pulse, so the node card glows once (brand #488e97).
    "fc-node-pulse": {
        "0%":   { boxShadow: "0 0 0 0 rgba(72, 142, 151, 0.5)" },
        "100%": { boxShadow: "0 0 0 12px rgba(72, 142, 151, 0)" },
    },
    "elara-ping": {
        "0%":        { transform: "scale(1)",   opacity: 0.55 },
        "75%, 100%": { transform: "scale(1.7)", opacity: 0 },
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
    // Map area pulses — drive a choropleth area's stroke / fill between a rest
    // state and a peak; the recipe delays the success pulse so two clusters
    // breathe out of phase.
    "map-pulse-danger": {
        "0%, 100%": { strokeOpacity: 0.6, strokeWidth: 1.5, fillOpacity: 0.1 },
        "50%":      { strokeOpacity: 1,   strokeWidth: 3.5, fillOpacity: 0.28 },
    },
    "map-pulse-success": {
        "0%, 100%": { strokeOpacity: 0.55, strokeWidth: 1.5, fillOpacity: 0.08 },
        "50%":      { strokeOpacity: 1,    strokeWidth: 3.5, fillOpacity: 0.24 },
    },
    "map-pulse-warning": {
        "0%, 100%": { strokeOpacity: 0.58, strokeWidth: 1.5, fillOpacity: 0.1 },
        "50%":      { strokeOpacity: 1,    strokeWidth: 3.5, fillOpacity: 0.26 },
    },
    // Marching-ants dash offset for an active connector / move arrow.
    "map-flow": {
        to: { strokeDashoffset: -24 },
    },
});
