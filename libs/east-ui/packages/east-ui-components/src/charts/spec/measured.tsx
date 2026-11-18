/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart's body at its measured size (#125): what a frame or a pie draws
 * through, so an SVG gets a pixel width before its first real paint.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { Box, Skeleton } from "@chakra-ui/react";
import { ParentSize } from "@visx/responsive";

/**
 * The height a `fill` chart takes when its parent has none of its own — a tile
 * sized by its content: the plot and its x-axis labels, as the Studio's tiles
 * draw a chart (#993).
 */
const FILL_NATURAL_HEIGHT = 134;

/**
 * A chart's body at its measured size (#125): at once with an explicit width;
 * else once its parent is measured, a Skeleton of its footprint until then;
 * and for a `fill` height (≤ 0) at its parent's height, never less than the
 * chart's natural height — measured in a box laid over the space, so its own
 * height never feeds back into its parent's. `debounceTime={0}` makes the
 * Skeleton → chart swap immediate (visx ParentSize otherwise waits ~300ms).
 */
export function measuredFrame(height: number, width: number | undefined, render: (w: number, h?: number) => ReactNode): ReactNode {
    const skeletonHeight = height > 0 ? `${height}px` : "100%";
    const renderFrame = (w: number, h?: number) =>
        w > 0 && (height > 0 || (h ?? 0) > 0)
            ? render(w, h)
            : <Skeleton width="100%" style={{ height: skeletonHeight }} />;
    if (height <= 0) {
        return (
            <Box height="100%">
                <Box position="relative" height="100%" minHeight={`${FILL_NATURAL_HEIGHT}px`}>
                    <Box position="absolute" inset="0">
                        <ParentSize debounceTime={0}>{({ width: w, height: h }) => renderFrame(w, h)}</ParentSize>
                    </Box>
                </Box>
            </Box>
        );
    }
    return width !== undefined ? render(width) : <ParentSize debounceTime={0}>{({ width: w }) => renderFrame(w)}</ParentSize>;
}
