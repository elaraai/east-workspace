/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Bounding helper for the grow-to-content data components (Matrix / Board /
 * Roster / Calendar). Size props stay plain strings parsed by
 * {@link parseCssSize}; this wraps a component's natural content in a
 * `min-height:0` flex column at the bound height / maxHeight so the whole
 * component (chrome included) takes that box and scrolls within it (#320).
 */

import { type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { parseCssSize } from "../style/parse-size.js";

/** Whether a component is height-bounded — a definite `height` or `maxHeight` is set. */
export function isSized(height: string | undefined, maxHeight: string | undefined): boolean {
    return height !== undefined || maxHeight !== undefined;
}

/**
 * Bounds a grow-to-content component: an outer `min-height:0` flex column at the
 * parsed `height` / `maxHeight`, whose single child fills the remainder and
 * scrolls (`flex:1; min-height:0; overflow-y:auto`). Returns `children`
 * unwrapped when neither bound is set, so the content-sized default is
 * byte-for-byte unchanged.
 *
 * @param height - the raw `height` size string (parsed here; `"fill"` handled)
 * @param maxHeight - the raw `maxHeight` size string (parsed here)
 * @param children - the component's natural content
 * @returns the bounded column, or `children` unchanged when unbounded
 */
export function SizedScrollFrame({ height, maxHeight, children }: {
    height: string | undefined;
    maxHeight: string | undefined;
    children: ReactNode;
}): ReactNode {
    const h = parseCssSize(height);
    const mh = parseCssSize(maxHeight);
    if (!isSized(h, mh)) return children;
    return (
        <Box display="flex" flexDirection="column" minHeight="0" overflow="hidden" height={h} maxHeight={mh}>
            <Box flex="1" minHeight="0" overflowY="auto">
                {children}
            </Box>
        </Box>
    );
}
