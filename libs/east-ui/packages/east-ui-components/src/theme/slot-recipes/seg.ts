/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Segment strip recipe — spec `.seg` (the slice-chrome bucket-unit /
 * grain segment: `WEEK · DAY`, `GROUP · RESOURCE · ITEM`).
 *
 * A bordered strip of mono uppercase segments: paper surface, 1 px
 * `border.strong` outline, 6 px radius, segments divided by 1 px
 * `border.subtle` rules. The active segment (`data-state="on"`) takes the
 * brand-tint fill with default ink; inactive segments are muted. Distinct
 * from the form-control `SegmentGroup` — this is the compact chrome strip
 * the Slice toolbar and the Plan toolbar mount.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const segSlotRecipe = defineSlotRecipe({
    className: "elara-seg",
    slots: ["root", "item"],
    base: {
        root: {
            display: "flex",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "6px",
            overflow: "hidden",
            background: "bg.surface",
            flex: "none",
        },
        item: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            paddingInline: "11px",
            paddingBlock: "5px",
            lineHeight: "1",
            color: "fg.muted",
            background: "transparent",
            borderLeftWidth: "1px",
            borderLeftStyle: "solid",
            borderLeftColor: "border.subtle",
            cursor: "pointer",
            whiteSpace: "nowrap",
            "&:first-of-type": {
                borderLeftWidth: "0",
            },
            '&[data-state="on"]': {
                background: "bg.brand.subtle",
                color: "fg",
            },
        },
    },
});
