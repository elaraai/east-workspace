/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/** Plan and Calendar use the same quiet edge: its grip appears on hover or keyboard focus. */
export function timeResizeEdge(along: "x" | "y", attribute: `data-${string}`) {
    const horizontal = along === "x";
    return {
        position: "absolute", zIndex: 1,
        ...(horizontal ? { top: 0, bottom: 0, width: "6px", cursor: "ew-resize" }
            : { left: 0, right: 0, height: "6px", cursor: "ns-resize" }),
        [`&[${attribute}='start']`]: horizontal ? { left: 0 } : { top: 0 },
        [`&[${attribute}='end']`]: horizontal ? { right: 0 } : { bottom: 0 },
        "&::after": {
            content: "''", position: "absolute", borderRadius: "1px", background: "currentColor",
            opacity: 0, transition: "opacity {durations.fast}",
            ...(horizontal ? { top: "3px", bottom: "3px", left: "2px", width: "2px" }
                : { left: "3px", right: "3px", top: "2px", height: "2px" }),
        },
        // An edge drawn as the pointer comes over its element — a Plan draws its ends only then (#1780) — has nothing to
        // fade from, so its grip fades in as an animation (`edge-grip-in`), as one drawn before the pointer came fades by
        // its transition: the transition wins where both run.
        "[data-draggable]:hover > &": { "&::after": { opacity: 0.55, animation: "edge-grip-in {durations.fast}" } },
        "&:focus-visible, &[data-dragging]": { "&::after": { opacity: 0.55 } },
        "@media (hover: none)": horizontal ? { width: "10px" } : { height: "10px" },
    } as const satisfies SystemStyleObject;
}
