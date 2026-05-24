/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SegmentedMeter slot recipe — spec `.bf2-conf` confidence breakdown.
 *
 * Multi-color segmented horizontal bar with a mono legend below.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const segmentedMeterSlotRecipe = defineSlotRecipe({
    className: "elara-segmented-meter",
    slots: ["root", "track", "segment", "label", "valueText", "keyRow", "keyItem", "keyDot"],
    base: {
        root: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        label: { textStyle: "caption.eyebrow" },
        track: {
            display: "flex",
            height: "6px",
            gap: "2px",
            borderRadius: "1px",
            overflow: "hidden",
            background: "{colors.gray.100}",
        },
        segment: { height: "100%", borderRadius: "1px" },
        keyRow: {
            display: "flex",
            gap: "{spacing.4}",
            marginTop: "{spacing.1}",
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
            flexWrap: "wrap",
        },
        keyItem: { display: "inline-flex", alignItems: "center", gap: "{spacing.1}" },
        keyDot: { width: "8px", height: "8px", borderRadius: "1px", display: "inline-block" },
        valueText: { fontFamily: "mono", fontSize: "11px", fontWeight: "semibold", color: "fg" },
    },
});
