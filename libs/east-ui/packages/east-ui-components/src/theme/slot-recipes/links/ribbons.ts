/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links layer's look (`Plan links.html`, #1258): one part, merged into the
 * slot that holds the layer in each component that draws links — Plan's
 * canvas, and the Allocation's board (#1321) — so every one draws them alike.
 * e3-ui-components' `shared/links/layer.tsx` draws the links: it writes their
 * paths and weights and the data attributes these rules select by; every
 * other look is here.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/** The links' look, inside the box the layer fills. */
export const linkRibbons = {
    "& svg": { display: "block", overflow: "visible" },
    // The casing: the paper one px either side of every link, under
    // every link's ink — so a link reads over a bar it crosses.
    "& [data-plan-casing='band']": { fill: "none", stroke: "bg.surface", strokeLinejoin: "round" },
    "& [data-plan-casing='head']": { fill: "bg.surface", stroke: "bg.surface", strokeWidth: "2px", strokeLinejoin: "round" },
    // The link and its heads, in the muted ink.
    "& [data-plan-ribbon-band]": { fill: "none", stroke: "fg.muted" },
    "& [data-plan-ribbon-head]": { fill: "fg.muted", stroke: "none" },
    // A lit link (hovered): the strong ink, over the others.
    "& [data-lit] [data-plan-ribbon-band]": { stroke: "fg.strong" },
    "& [data-lit] [data-plan-ribbon-head]": { fill: "fg.strong" },
    // The ends a lit link joins: a 1px halo in the strong ink.
    "& [data-plan-linkend]": { fill: "none", stroke: "fg.strong", strokeWidth: "1px" },
    // An end past the window: its slot, dashed in the subtle ink.
    "& [data-plan-linkslot]": { fill: "none", stroke: "fg.subtle", strokeWidth: "1px", strokeDasharray: "4 4" },
    // The caption — the edge label, mono 10/500 in the muted ink, on a
    // paper knockout.
    "& [data-plan-ribbon-knockout]": { fill: "bg.surface" },
    "& [data-plan-ribbon-caption]": {
        fontFamily: "mono",
        fontSize: "label.sm",
        fontWeight: "medium",
        fontVariantNumeric: "tabular-nums",
        fill: "fg.muted",
    },
    // A selected link (A68): its caption outlined in the ink, and the × in its
    // own 16px target past it — the one other part of the layer that takes the
    // pointer.
    "& [data-selected] [data-plan-ribbon-knockout]": { stroke: "fg", strokeWidth: "1px" },
    "& [data-plan-ribbon-unlink]": { overflow: "visible" },
    "& [data-plan-ribbon-unlink] button": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        padding: 0,
        border: "none",
        borderRadius: "sm",
        background: "bg.surface",
        color: "fg.muted",
        fontSize: "10px",
        cursor: "pointer",
        pointerEvents: "auto",
        _hover: { color: "fg.strong", background: "bg.subtle" },
        _focusVisible: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "1px" },
    },
    // A link drag (A69): the moved link faded to its `was` line, and the new
    // line to the pointer in the brand.
    "& [data-was] [data-plan-ribbon-band]": { stroke: "fg.subtle", strokeWidth: "1.5px" },
    "& [data-was] [data-plan-ribbon-head]": { fill: "fg.subtle" },
    "& [data-plan-link-preview] [data-plan-ribbon-band]": { stroke: "brand.solid", strokeWidth: "3px", strokeLinecap: "round" },
    "& [data-plan-link-preview] [data-plan-ribbon-head]": { fill: "brand.solid" },
    // The hit area: the stroke and 5 either side — the part of the layer that
    // takes the pointer.
    "& [data-link]": {
        fill: "none",
        stroke: "transparent",
        pointerEvents: "stroke",
        cursor: "pointer",
    },
} satisfies SystemStyleObject;
