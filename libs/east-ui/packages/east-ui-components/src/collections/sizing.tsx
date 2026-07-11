/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Renderer side of the uniform data-component sizing contract (#320). The IR
 * stores `height` / `maxHeight` as CSS strings (encoded by
 * `@elaraai/east-ui`'s `collections/sizing`); here they resolve into the
 * outer-frame CSS every data component applies:
 *
 * - `height: "fill"` → `100%` of the parent box (the parent must have a
 *   definite / used height — a sized `Box`, a Grid cell, a flex-stretched row).
 * - a pixel / CSS `height` or `maxHeight` passes through unchanged.
 *
 * The bound is **chrome-inclusive**: the outer box is a `min-height:0` flex
 * column, so a component's toolbars / headers / footers keep their natural
 * height (`flex-shrink:0`) and the data region takes the remainder and scrolls
 * (`flex:1; min-height:0`). For a grow-to-content component (Matrix / Board /
 * Roster / Calendar) {@link SizedScrollFrame} supplies that column wholesale.
 */

import { type ReactNode } from "react";
import { Box } from "@chakra-ui/react";

/** `"fill"` → `100%`; a pixel / CSS string passes through; `undefined` stays undefined. */
export function resolveDataHeight(height: string | undefined): string | undefined {
    return height === "fill" ? "100%" : height;
}

/** Whether a component is height-bounded — a definite `height` or `maxHeight` is set. */
export function isSized(height: string | undefined, maxHeight: string | undefined): boolean {
    return height !== undefined || maxHeight !== undefined;
}

/**
 * Bounds a grow-to-content component: an outer `min-height:0` flex column at the
 * resolved `height` / `maxHeight`, whose single child fills the remainder and
 * scrolls (`flex:1; min-height:0; overflow-y:auto`). Returns `children`
 * unwrapped when neither bound is set, so the content-sized default is
 * byte-for-byte unchanged.
 *
 * @param height - resolved height (`"fill"` handled), or undefined
 * @param maxHeight - resolved max-height, or undefined
 * @param children - the component's natural content
 * @returns the bounded column, or `children` unchanged when unbounded
 */
export function SizedScrollFrame({ height, maxHeight, children }: {
    height: string | undefined;
    maxHeight: string | undefined;
    children: ReactNode;
}): ReactNode {
    if (!isSized(height, maxHeight)) return children;
    return (
        <Box
            display="flex"
            flexDirection="column"
            minHeight="0"
            overflow="hidden"
            height={resolveDataHeight(height)}
            maxHeight={maxHeight}
        >
            <Box flex="1" minHeight="0" overflowY="auto">
                {children}
            </Box>
        </Box>
    );
}
