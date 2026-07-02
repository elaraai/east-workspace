/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Board slot recipe — the single-day areas × shifts assignment grid per the
 * `board` pattern: mono eyebrow shift headers (label + time-window
 * sublabel), area rows with muted sublabels, and person chips carrying the
 * event-state grammar (committed outline · `+` added tint · struck removed ·
 * dashed model ghost). Coverage renders as `n/required` numerals with
 * under / over tones plus dashed `⊕` open-slot placeholders — numerals,
 * glyphs and tones only, never words. Drop indicators come from the shared
 * drag-layer data attributes.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const boardSlotRecipe = defineSlotRecipe({
    className: "elara-board",
    slots: [
        "root", "grid", "headerCell", "headerSublabel",
        "areaCell", "areaLabel", "areaSublabel",
        "cell", "coverage", "coverageCount",
        "chip", "chipGrip", "chipAction",
        "openSlot", "overflowChip", "overflowContent", "dragGhost",
        "strip", "stripSummary",
    ],
    base: {
        /* Bare like Table / Roster — identity chrome (title, outer frame,
         * toolbar) is host composition via Card / Slice.Frame. */
        root: {
            background: "bg.surface",
        },
        grid: {
            display: "grid",
        },
        headerCell: {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
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
        headerSublabel: {
            fontWeight: "500",
            letterSpacing: "0.06em",
            textTransform: "none",
            color: "fg.subtle",
        },
        areaCell: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "2px",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        areaLabel: {
            fontSize: "{fontSizes.control}",
            fontWeight: "600",
            color: "fg",
        },
        areaSublabel: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            fontVariantNumeric: "tabular-nums",
        },
        cell: {
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: "{spacing.1}",
            padding: "{spacing.1}",
            minHeight: "44px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            "&[data-addable]": { cursor: "copy" },
        },
        /* Coverage header — `n/required` numerals with under / over tones. */
        coverage: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "2px",
        },
        coverageCount: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            "&[data-tone=under]": { color: "{colors.status.warn}" },
            "&[data-tone=ok]": { color: "fg.muted" },
            "&[data-tone=over]": { color: "fg.danger" },
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
            /* Removed — a proposed unassignment; struck, never worded. */
            "&[data-state=removed]": {
                background: "bg.warning.subtle",
                borderColor: "{colors.status.warn}",
                color: "{colors.status.warn}",
                textDecoration: "line-through",
            },
            /* Model ghost — dashed, italic, click (or ✓) to accept. */
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
        /* Dashed open-slot placeholder — a drop hint and `onAddAt` target. */
        openSlot: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            background: "transparent",
            paddingX: "{spacing.2}",
            paddingY: "2px",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            cursor: "copy",
            transition: "border-color {durations.fast}, color {durations.fast}",
            "&:hover": {
                borderColor: "{colors.brand.600}",
                color: "{colors.brand.700}",
            },
        },
        /* The `+N` chip collapsing a cell past `maxVisible`. */
        overflowChip: {
            alignSelf: "flex-start",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            background: "bg.subtle",
            paddingX: "{spacing.2}",
            paddingY: "1px",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            cursor: "pointer",
            "&:hover": { color: "fg" },
        },
        overflowContent: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            padding: "{spacing.2}",
            minWidth: "180px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            boxShadow: "md",
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
    },
});
