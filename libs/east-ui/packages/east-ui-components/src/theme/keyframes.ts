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
 *  - `elara-live-pulse`    — the design system's live dot (`.dot.live::after`,
 *    `east-pulse`): a ring that grows from the dot and fades, the footer's
 *    loading line's one motion (#1398).
 *  - `optimise-*`          — the Optimise run (#1409): the eye's echo, halo
 *    and blink, the banner's fade, and the landing of a run's result on a
 *    builder's entries.
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
    // The design system's live dot (`slice-parts.css` `east-pulse`): the dot's
    // copy grows to 2.5× and fades in its first quarter, then rests.
    "elara-live-pulse": {
        "0%":        { transform: "scale(1)",   opacity: 0.6 },
        "25%, 100%": { transform: "scale(2.5)", opacity: 0 },
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
    // Optimise (#1409, `Optimise Spec.md` §8): the eye while a run is out — its
    // iris's echo, grown to 2.4× and gone in the first quarter of the live-pulse
    // cycle, and its 12px halo, peaking there — and its one blink at a result
    // with nothing to change; the banner's fade in. Colours are the `elara`
    // tokens' variables: keyframes are not run through the token pipeline.
    "optimise-echo": {
        "0%":        { transform: "scale(1)",   opacity: 0.8 },
        "25%, 100%": { transform: "scale(2.4)", opacity: 0 },
    },
    "optimise-halo": {
        "0%":   { boxShadow: "0 0 0 0 transparent" },
        "25%":  { boxShadow: "0 0 12px 2px var(--chakra-colors-elara-glow)" },
        "100%": { boxShadow: "0 0 0 0 transparent" },
    },
    "optimise-blink": {
        "0%, 100%": { transform: "scaleY(1)" },
        "45%":      { transform: "scaleY(0.12)" },
    },
    "optimise-fade-in": {
        "0%":   { opacity: 0 },
        "100%": { opacity: 1 },
    },
    // The landing (#1409, #1416), 1400ms an entry: from the `elara.wash` fill with a 1px `elara` ring and the
    // `elara.glow` to the dirty fill (`brandTint`) with the steady highlight — a 1px `elara.edge` ring and the
    // `elara.soft` glow. An add fades in over the first 10%; an entry with its own fill takes the ring and the glow
    // alone; a Sheet cell takes them inset, and its value fades in over 160ms; a ghost's glow fades out; a total the
    // result changed flashes the wash once.
    "optimise-land-add": {
        "0%":   { opacity: 0, backgroundColor: "var(--chakra-colors-elara-wash)", boxShadow: "0 0 0 1px var(--chakra-colors-elara), 0 0 0 0 transparent" },
        "10%":  { opacity: 1, backgroundColor: "var(--chakra-colors-elara-wash)", boxShadow: "0 0 0 1px var(--chakra-colors-elara), 0 0 18px 4px var(--chakra-colors-elara-glow)" },
        "100%": { opacity: 1, backgroundColor: "var(--chakra-colors-brand-tint)", boxShadow: "0 0 0 1px var(--chakra-colors-elara-edge), 0 0 8px 1px var(--chakra-colors-elara-soft)" },
    },
    "optimise-land-change": {
        "0%":   { backgroundColor: "var(--chakra-colors-elara-wash)", boxShadow: "0 0 0 1px var(--chakra-colors-elara), 0 0 18px 4px var(--chakra-colors-elara-glow)" },
        "100%": { backgroundColor: "var(--chakra-colors-brand-tint)", boxShadow: "0 0 0 1px var(--chakra-colors-elara-edge), 0 0 8px 1px var(--chakra-colors-elara-soft)" },
    },
    "optimise-land-add-own": {
        "0%":   { opacity: 0, boxShadow: "0 0 0 1px var(--chakra-colors-elara), 0 0 0 0 transparent" },
        "10%":  { opacity: 1, boxShadow: "0 0 0 1px var(--chakra-colors-elara), 0 0 18px 4px var(--chakra-colors-elara-glow)" },
        "100%": { opacity: 1, boxShadow: "0 0 0 1px var(--chakra-colors-elara-edge), 0 0 8px 1px var(--chakra-colors-elara-soft)" },
    },
    "optimise-land-change-own": {
        "0%":   { boxShadow: "0 0 0 1px var(--chakra-colors-elara), 0 0 18px 4px var(--chakra-colors-elara-glow)" },
        "100%": { boxShadow: "0 0 0 1px var(--chakra-colors-elara-edge), 0 0 8px 1px var(--chakra-colors-elara-soft)" },
    },
    "optimise-land-cell": {
        "0%":   { backgroundColor: "var(--chakra-colors-bg-surface)", boxShadow: "inset 0 0 0 1px transparent, inset 0 0 0 0 transparent" },
        "10%":  { backgroundColor: "var(--chakra-colors-elara-wash)", boxShadow: "inset 0 0 0 1px var(--chakra-colors-elara), inset 0 0 14px 2px var(--chakra-colors-elara-glow)" },
        "100%": { backgroundColor: "var(--chakra-colors-brand-tint)", boxShadow: "inset 0 0 0 1px var(--chakra-colors-elara-edge), inset 0 0 8px 0 var(--chakra-colors-elara-soft)" },
    },
    "optimise-value-in": {
        "0%":   { opacity: 0 },
        "100%": { opacity: 1 },
    },
    "optimise-ghost-out": {
        "0%":   { boxShadow: "0 0 0 1px var(--chakra-colors-elara), 0 0 12px 3px var(--chakra-colors-elara-glow)" },
        "100%": { boxShadow: "0 0 0 1px transparent, 0 0 0 0 transparent" },
    },
    "optimise-flash": {
        "0%":   { backgroundColor: "transparent" },
        "12%":  { backgroundColor: "var(--chakra-colors-elara-wash)" },
        "100%": { backgroundColor: "transparent" },
    },
});
