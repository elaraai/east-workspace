/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Map slot recipe — the Leaflet basemap canvas plus the East chrome layered
 * over it: the framed root, the loading fallback, and the screen-anchored
 * overlay slot. The Leaflet-generated SVG (areas, hex lattice, lines) and
 * divIcon DOM (pins, labels, tooltips) are styled here through descendant
 * selectors so colour stays theme-owned — data selects a tone class and these
 * rules map it to a token; the pulse / flow animations key off the same
 * classes (Map's renderer is vanilla Leaflet, so `className` reaches the SVG
 * `<path>` and no stroke-hex coupling is needed).
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const mapSlotRecipe = defineSlotRecipe({
    className: "elara-map",
    slots: ["root", "fallback", "overlay", "overlayItem"],
    base: {
        root: {
            position: "relative",
            overflow: "hidden",
            width: "full",
            height: "440px",
            maxHeight: "75vh",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "md",
            background: "bg.panel",

            // ── Leaflet container + muted attribution (CARTO terms require it) ──
            "& .leaflet-container": { background: "bg.panel", fontFamily: "inherit", width: "100%", height: "100%" },
            "& .leaflet-tile": { filter: "saturate(0.92)" },
            "& .leaflet-control-attribution": { fontSize: "2xs", opacity: 0.55 },
            "& .leaflet-control-attribution a": { color: "fg.muted" },
            "& .leaflet-interactive": { cursor: "pointer" },

            // ── Decorative hex lattice (a visible slate graticule, felt not read) ──
            "& path.elara-map-hex": {
                stroke: "{colors.fg.muted}",
                strokeWidth: "0.8px",
                fill: "none",
                opacity: 0.45,
            },

            // ── Areas: colour by tone class, pulse by status class ──
            "& path.elara-map-area": { strokeLinejoin: "round", fillOpacity: 0.14 },
            "& path.elara-map-area--brand": { stroke: "{colors.brand.500}", fill: "{colors.brand.500}" },
            "& path.elara-map-area--ink": { stroke: "{colors.fg}", fill: "{colors.fg}" },
            "& path.elara-map-area--muted": { stroke: "{colors.fg.muted}", fill: "{colors.fg.muted}" },
            "& path.elara-map-area--success": { stroke: "{colors.status.pos}", fill: "{colors.status.pos}" },
            "& path.elara-map-area--warning": { stroke: "{colors.status.warn}", fill: "{colors.status.warn}" },
            "& path.elara-map-area--danger": { stroke: "{colors.status.neg}", fill: "{colors.status.neg}" },
            "& path.elara-map-area--pulse-danger": { animation: "map-pulse-danger 2.4s ease-in-out infinite", cursor: "pointer" },
            "& path.elara-map-area--pulse-success": { animation: "map-pulse-success 2.4s ease-in-out infinite", animationDelay: "1.2s", cursor: "pointer" },
            "& path.elara-map-area--pulse-warning": { animation: "map-pulse-warning 2.4s ease-in-out infinite", animationDelay: "0.6s", cursor: "pointer" },

            // ── Lines / move arrows ──
            "& path.elara-map-line": { strokeLinecap: "round", fill: "none", opacity: 0.85 },
            "& path.elara-map-line--brand": { stroke: "{colors.brand.500}" },
            "& path.elara-map-line--ink": { stroke: "{colors.fg}" },
            "& path.elara-map-line--muted": { stroke: "{colors.fg.muted}" },
            "& path.elara-map-line--success": { stroke: "{colors.status.pos}" },
            "& path.elara-map-line--warning": { stroke: "{colors.status.warn}" },
            "& path.elara-map-line--danger": { stroke: "{colors.status.neg}" },
            "& path.elara-map-line--flow": { animation: "map-flow 1.1s linear infinite" },

            // ── divIcon pins + labels + tooltips ──
            "& .elara-map-pin": { display: "flex", alignItems: "center", gap: "1", whiteSpace: "nowrap" },
            "& .elara-map-pin-dot": {
                width: "8px", height: "8px", borderRadius: "full",
                background: "{colors.brand.500}",
                boxShadow: "0 0 0 3px color-mix(in srgb, {colors.brand.500} 25%, transparent)",
            },
            "& .elara-map-pin-label, & .elara-map-label": {
                fontFamily: "mono", fontSize: "2xs", color: "fg",
                background: "bg.surface", paddingInline: "1", borderRadius: "sm",
                borderWidth: "1px", borderColor: "border.subtle",
            },
            "& .elara-map-tip.leaflet-tooltip": {
                fontFamily: "mono", fontSize: "2xs",
                color: "fg", background: "bg.surface",
                borderWidth: "1px", borderColor: "border.subtle", borderRadius: "sm",
                boxShadow: "xs",
            },

            // ── Marker dot / icon tones ──
            "& .elara-map-pin-dot--brand": { background: "{colors.brand.500}" },
            "& .elara-map-pin-dot--ink": { background: "{colors.fg}" },
            "& .elara-map-pin-dot--muted": { background: "{colors.fg.muted}" },
            "& .elara-map-pin-dot--success": { background: "{colors.status.pos}" },
            "& .elara-map-pin-dot--warning": { background: "{colors.status.warn}" },
            "& .elara-map-pin-dot--danger": { background: "{colors.status.neg}" },
            "& .elara-map-pin-icon": { display: "inline-flex", alignItems: "center", lineHeight: "1" },
            "& .elara-map-pin-icon svg": { width: "14px", height: "14px", display: "block" },
            "& .elara-map-pin-icon--brand": { color: "{colors.brand.500}" },
            "& .elara-map-pin-icon--ink": { color: "{colors.fg}" },
            "& .elara-map-pin-icon--muted": { color: "{colors.fg.muted}" },
            "& .elara-map-pin-icon--success": { color: "{colors.status.pos}" },
            "& .elara-map-pin-icon--warning": { color: "{colors.status.warn}" },
            "& .elara-map-pin-icon--danger": { color: "{colors.status.neg}" },

            // ── Per-cell hex detail (colour reuses the area tone classes) ──
            "& path.elara-map-hex-cell": { strokeLinejoin: "round" },

            // ── Line arrowheads (filled tone) ──
            "& path.elara-map-arrowhead": { strokeLinejoin: "round", fillOpacity: 0.95 },
            "& path.elara-map-arrowhead--brand": { fill: "{colors.brand.500}", stroke: "{colors.brand.500}" },
            "& path.elara-map-arrowhead--ink": { fill: "{colors.fg}", stroke: "{colors.fg}" },
            "& path.elara-map-arrowhead--muted": { fill: "{colors.fg.muted}", stroke: "{colors.fg.muted}" },
            "& path.elara-map-arrowhead--success": { fill: "{colors.status.pos}", stroke: "{colors.status.pos}" },
            "& path.elara-map-arrowhead--warning": { fill: "{colors.status.warn}", stroke: "{colors.status.warn}" },
            "& path.elara-map-arrowhead--danger": { fill: "{colors.status.neg}", stroke: "{colors.status.neg}" },

            _motionReduce: {
                "& path.elara-map-area--pulse-danger, & path.elara-map-area--pulse-success, & path.elara-map-area--pulse-warning, & path.elara-map-line--flow": {
                    animation: "none",
                },
            },
        },
        fallback: {
            position: "absolute",
            inset: "0",
            background: "bg.panel",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        },
        overlay: {
            position: "absolute",
            inset: "0",
            display: "flex",
            padding: "3",
            pointerEvents: "none",
            zIndex: 1000,
        },
        // Chrome matches the canonical popover/card content surface
        // (bg.surface + border.strong + md shadow + 14/16 padding).
        overlayItem: {
            maxWidth: "360px",
            minWidth: "min(240px, calc(100% - 16px))",
            width: "fit-content",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            boxShadow: "md",
            padding: "14px 16px",
            fontSize: "{fontSizes.control}",
            lineHeight: "{lineHeights.normal}",
            color: "fg",
        },
    },
});
