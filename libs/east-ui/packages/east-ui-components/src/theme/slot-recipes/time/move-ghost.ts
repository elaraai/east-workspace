/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared readable pointer previews, independent of a short source event's width. */
import type { SystemStyleObject } from "@chakra-ui/react";

export const moveGhostSlots = ["moveGhost", "moveGhostLabel", "moveGhostSpan"] as const;
export const moveGhostBase = {
    // The ghost beside the pointer — the element's name over the span it
    // would take, on paper in a brand ring.
    moveGhost: {
        display: "inline-flex",
        width: "max-content",
        maxWidth: "calc(100vw - 24px)",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "1px",
        padding: "3px 8px",
        borderRadius: "3px",
        background: "bg.surface",
        boxShadow: "inset 0 0 0 1.5px {colors.brand.solid}",
        fontFamily: "mono",
        whiteSpace: "nowrap",
        pointerEvents: "none",
    },
    moveGhostLabel: {
        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
        fontSize: "10px",
        fontWeight: "semibold",
        color: "fg.default",
    },
    moveGhostSpan: {
        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
        fontSize: "9.5px",
        fontWeight: "medium",
        color: "brand.fg",
    },
} satisfies Record<(typeof moveGhostSlots)[number], SystemStyleObject>;
