/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared row-virtualization frame for the grow-to-content data collections
 * (Matrix / Board / Roster / Calendar / Planner). Table / Gantt / Library keep
 * their own bespoke virtualizers; every other collection routes its body rows
 * through this one helper so they all bound, scroll and virtualize identically
 * (#320).
 *
 * Two modes, chosen by whether a definite `height` / `maxHeight` is set:
 *
 * - **Unbounded** (neither set) — the historical grow-to-content behaviour:
 *   the header and every row render in normal flow, no scroll container, no
 *   virtualization. Byte-for-byte the previous output, so content-sized
 *   examples and snapshots are unchanged.
 * - **Bounded** — the frame becomes the virtualizer's scroll element at the
 *   parsed height / maxHeight (reserved-gutter scrollbar via
 *   {@link virtualScrollbarCss}); the header pins (`position: sticky`) and only
 *   the visible rows (+ overscan) are mounted, positioned by `translateY`.
 */

import { Fragment, useRef, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { parseCssSize } from "../style/parse-size.js";
import { virtualScrollbarCss } from "../style/scrollbar.js";

export interface VirtualRowsProps {
    /** Raw `height` size string (parsed here; `"fill"` handled). */
    height: string | undefined;
    /** Raw `maxHeight` size string (parsed here). */
    maxHeight: string | undefined;
    /** Sticky-top header row; spans the full (min-)width and pins on scroll. */
    header?: ReactNode | undefined;
    /** Trailing content after the rows (e.g. a legend); scrolls with the body. */
    footer?: ReactNode | undefined;
    /** Total number of body rows. */
    count: number;
    /** Estimated pixel height of row `index` (measured precisely once mounted). */
    estimateSize: (index: number) => number;
    /** Renders body row `index` — a full-width, self-contained row element. */
    renderRow: (index: number) => ReactNode;
    /** Rows above/below the viewport to keep mounted (default 8). */
    overscan?: number | undefined;
    /**
     * Min-width for the header + row band, so a grid wider than the viewport
     * scrolls horizontally as one unit (the header scrolls with it, pinned
     * only vertically). Omit for width-flexible collections.
     */
    minWidth?: string | undefined;
    /** z-index for the pinned header (default 3 — above the translated rows). */
    headerZIndex?: number | undefined;
    /** Forwarded to the scroll element (e.g. scroll-position persistence). */
    onScroll?: (() => void) | undefined;
    /** Extra props / styles for the outer element (root recipe styles, width). */
    rootCss?: Record<string, unknown> | undefined;
}

/**
 * @param props - see {@link VirtualRowsProps}
 * @returns the bounded virtual-scroll frame, or the unbounded grow-to-content
 *   flow when no height / maxHeight is set
 */
export function VirtualRows(props: VirtualRowsProps): ReactNode {
    const {
        header, footer, count, estimateSize, renderRow,
        overscan = 8, minWidth, headerZIndex = 3, onScroll, rootCss,
    } = props;
    const h = parseCssSize(props.height);
    const mh = parseCssSize(props.maxHeight);
    const bounded = h !== undefined || mh !== undefined;

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => scrollRef.current,
        estimateSize,
        overscan,
        measureElement: (el) => el?.getBoundingClientRect().height,
    });

    // Unbounded: preserve the exact grow-to-content flow (no scroll, no
    // virtualization) so content-sized output is unchanged.
    if (!bounded) {
        return (
            <Box css={rootCss}>
                {header}
                {Array.from({ length: count }, (_unused, i) => (
                    <Fragment key={i}>{renderRow(i)}</Fragment>
                ))}
                {footer}
            </Box>
        );
    }

    const items = virtualizer.getVirtualItems();
    return (
        <Box
            ref={scrollRef}
            // `display:block` overrides any flex-column root recipe — a flex
            // item's default shrink would collapse the total-size spacer and
            // break the scroll. `overflowY:auto` (after rootCss) becomes the
            // virtualizer's scroll axis; horizontal overflow is inherited from
            // rootCss when the collection sets it.
            css={{ ...rootCss, display: "block", overflowY: "auto", minHeight: "0", ...virtualScrollbarCss }}
            height={h}
            maxHeight={mh}
            onScroll={onScroll}
        >
            {header !== undefined && (
                <Box position="sticky" top="0" zIndex={headerZIndex} minWidth={minWidth}>
                    {header}
                </Box>
            )}
            <Box position="relative" height={`${virtualizer.getTotalSize()}px`} minWidth={minWidth}>
                {items.map((item) => (
                    <Box
                        key={item.key}
                        data-index={item.index}
                        ref={virtualizer.measureElement}
                        position="absolute"
                        top="0"
                        left="0"
                        width="100%"
                        style={{ transform: `translateY(${item.start}px)` }}
                    >
                        {renderRow(item.index)}
                    </Box>
                ))}
            </Box>
            {footer}
        </Box>
    );
}
