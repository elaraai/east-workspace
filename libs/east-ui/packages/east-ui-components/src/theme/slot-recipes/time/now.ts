/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The now line's look (#1148): one part, merged into the slot recipe of each
 * component that draws a now line (Plan's canvas, and the Calendar's views), so
 * every one draws it alike. e3-ui-components' `shared/time/now-line.tsx` is the
 * React part that places it: it sets `data-along` and the geometry, and these
 * slots are everything else.
 *
 *   - Line: 1.5px of the brand. Down the box it is drawn in for an instant on
 *     a horizontal axis (`data-along="x"`: Plan's canvas, the Calendar's
 *     timeline), across it for one on a vertical axis (`data-along="y"`: the
 *     Calendar's time grid). A host dims it or hides it with its own
 *     `data-axis` (`dim`, `off`), as Plan's expand render does.
 *   - Dot: 7px of the brand at the line's start.
 *   - Chip: what the instant is called, mono 9.5 / 600 on the brand's one dark
 *     fill. On an axis band (Plan's ruler) it sits on the band's middle;
 *     beside a vertical axis (a time grid's hour gutter) at its right edge.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/** The slots this part styles. */
export const nowSlots = ["nowLine", "nowDot", "nowChip"] as const;

/** Their base styles. */
export const nowBase = {
    nowLine: {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: 0,
        borderLeftWidth: "1.5px",
        borderLeftColor: "{colors.brand.solid}",
        pointerEvents: "none",
        zIndex: 7,
        "&[data-along='y']": {
            top: "auto",
            bottom: "auto",
            left: 0,
            right: 0,
            width: "auto",
            height: 0,
            borderLeftWidth: 0,
            borderTopWidth: "1.5px",
            borderTopColor: "{colors.brand.solid}",
        },
        "[data-axis='dim'] &": { opacity: 0.4 },
        "[data-axis='off'] &": { display: "none" },
    },
    nowDot: {
        position: "absolute",
        width: "7px",
        height: "7px",
        borderRadius: "full",
        background: "{colors.brand.solid}",
        top: "-4px",
        left: "-4.5px",
        "[data-along='y'] > &": { top: "-4.5px", left: "-4px" },
    },
    nowChip: {
        position: "absolute",
        top: "50%",
        transform: "translate(-50%, -50%)",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        letterSpacing: "0.08em",
        color: "bg.surface",
        background: "brand.emphasized",
        borderRadius: "2px",
        padding: "1px 4px",
        zIndex: 7,
        pointerEvents: "none",
        "&[data-along='y']": { right: "4px", transform: "translateY(-50%)" },
    },
} satisfies Record<(typeof nowSlots)[number], SystemStyleObject>;
