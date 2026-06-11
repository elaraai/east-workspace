/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Roster slot recipe — the people × days shift grid per the `roster`
 * pattern: mono eyebrow day headers, person rows with muted target
 * sublabels, and shift chips carrying the event-state grammar (committed
 * outline · `+` added tint · struck removed · dashed model ghost). Drop
 * indicators come from the shared drag-layer data attributes.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const rosterSlotRecipe = defineSlotRecipe({
    className: "elara-roster",
    slots: [
        "root", "grid", "headerCell",
        "personCell", "personLabel", "personSublabel",
        "cell", "chip", "chipGrip", "chipAction", "dragGhost",
        "strip", "stripSummary", "stripHint",
    ],
    base: {
        /* Bare like Table / Planner — identity chrome (title, outer frame)
         * is host composition via Card / Slice.Frame. */
        root: {
            background: "bg.surface",
        },
        grid: {
            display: "grid",
        },
        headerCell: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.muted",
            background: "bg.panel",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
        },
        personCell: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "2px",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        personLabel: {
            fontSize: "{fontSizes.control}",
            fontWeight: "600",
            color: "fg",
        },
        personSublabel: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            fontVariantNumeric: "tabular-nums",
        },
        cell: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            padding: "{spacing.1}",
            minHeight: "44px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            "&[data-addable]": { cursor: "copy" },
        },
        chip: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
            whiteSpace: "nowrap",
            minWidth: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            paddingX: "{spacing.2}",
            paddingY: "2px",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            cursor: "pointer",
            /* Committed — the published outline chip; pointer-immutable. */
            "&[data-state=committed]": {
                background: "bg.brand.subtle",
                borderColor: "{colors.brand.500}",
                color: "fg",
                cursor: "default",
            },
            /* Added — an operator proposal. */
            "&[data-state=added]": {
                background: "bg.brand.subtle",
                borderColor: "{colors.brand.600}",
                borderStyle: "dashed",
                color: "{colors.brand.700}",
                fontWeight: "600",
            },
            /* Removed — a proposed deletion of a committed shift. */
            "&[data-state=removed]": {
                background: "bg.warning.subtle",
                borderColor: "{colors.status.warn}",
                color: "{colors.status.warn}",
            },
            /* Model ghost — dashed, italic, click to accept. */
            "&[data-state=model]": {
                background: "transparent",
                borderColor: "border.strong",
                borderStyle: "dashed",
                color: "fg.muted",
                fontStyle: "italic",
            },
            /* Rejected — struck and muted. */
            "&[data-state=rejected]": {
                background: "bg.subtle",
                borderColor: "border.subtle",
                color: "fg.subtle",
                textDecoration: "line-through",
                cursor: "default",
            },
            "&[data-draggable]": { cursor: "grab" },
            "&[data-dragging]": { opacity: "0.4" },
        },
        chipGrip: {
            color: "fg.subtle",
            fontSize: "9px",
            flexShrink: "0",
            opacity: "0",
            transition: "opacity {durations.fast}",
            "[data-draggable]:hover &": { opacity: "1" },
        },
        /* Hover action buttons — accept (check) on ghosts, remove (bin) on
         * proposals. First action pushes to the chip's right edge. */
        chipAction: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            color: "fg.muted",
            background: "transparent",
            border: "none",
            padding: "1px",
            cursor: "pointer",
            opacity: "0",
            transition: "opacity {durations.fast}",
            flexShrink: "0",
            "&:first-of-type": { marginLeft: "auto" },
            "[data-state]:hover > &": { opacity: "1" },
            "&:hover": { color: "fg" },
            "&[data-danger]:hover": { color: "fg.danger" },
        },
        dragGhost: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            color: "fg",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            boxShadow: "md",
            paddingX: "{spacing.2}",
            paddingY: "2px",
        },
        strip: {
            display: "flex",
            alignItems: "baseline",
            gap: "{spacing.4}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderTopWidth: "1px",
            borderTopColor: "border.strong",
            background: "bg.panel",
        },
        stripSummary: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
        },
        stripHint: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "10px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
    },
});
