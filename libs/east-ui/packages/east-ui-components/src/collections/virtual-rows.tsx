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
 * Two modes, chosen by whether a definite `height` / `maxHeight` (or
 * `fillParent`) is set:
 *
 * - **Unbounded** (none set) — the historical grow-to-content behaviour:
 *   the header and every row render in normal flow, no scroll container, no
 *   virtualization, so content-sized examples and snapshots are unchanged.
 * - **Bounded** — the frame becomes the virtualizer's scroll element at the
 *   parsed height / maxHeight (reserved-gutter scrollbar via
 *   {@link virtualScrollbarCss}); the header pins (`position: sticky`, opaque
 *   `bg.surface` so rows never paint through it) and only the visible rows
 *   (+ overscan) are mounted, positioned by `translateY`.
 *
 * The virtualizer's window is measured from the scroll element's origin, but
 * the rows start BELOW the in-flow sticky header — `scrollMargin` (the items
 * container's `offsetTop`) corrects the window so the visible range is not
 * offset by the header height.
 */

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { parseCssSize } from "../style/parse-size.js";
import { virtualScrollbarCss } from "../style/scrollbar.js";

export interface VirtualRowsProps {
    /** Raw `height` size string (parsed here; `"fill"` handled). */
    height: string | undefined;
    /** Raw `maxHeight` size string (parsed here). */
    maxHeight: string | undefined;
    /**
     * Bound the frame as a flex item (`flex: 1 1 auto; min-height: 0`) instead
     * of by its own `height` / `maxHeight`. Used when a host wraps the frame in
     * a sized flex column together with chrome that must stay outside the
     * scroll region (e.g. the review commit bar) — the WRAPPER takes the
     * component's `height` / `maxHeight` and the frame fills the remainder.
     */
    fillParent?: boolean | undefined;
    /** Sticky-top header row; spans the full (min-)width and pins on scroll. */
    header?: ReactNode | undefined;
    /** Trailing content after the rows (e.g. a legend); scrolls with the body. */
    footer?: ReactNode | undefined;
    /** Total number of body rows. */
    count: number;
    /** Estimated pixel height of row `index` (measured precisely once mounted). */
    estimateSize: (index: number) => number;
    /**
     * Whether to measure mounted rows (default true). Pass `false` when rows
     * are FIXED-HEIGHT (`estimateSize` is exact): rows then sit at exact
     * multiples of the fixed height. Fixed-height collections must opt out —
     * under browser zoom, measurement reports device-snapped fractional
     * heights even for a fixed-height box, and the accumulated drift between
     * measured offsets and rendered boxes paints as stray hairline rules and
     * vertically clipped row text (#533).
     */
    measureRows?: boolean | undefined;
    /** Renders body row `index` — a full-width, self-contained row element. */
    renderRow: (index: number) => ReactNode;
    /** Rows above/below the viewport to keep mounted (default 4). */
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
    /**
     * Receives the bounded-mode scroll element (null when unmounted or
     * unbounded) — for scroll-position restore, which `onScroll` alone
     * cannot do.
     */
    scrollElRef?: React.MutableRefObject<HTMLDivElement | null> | undefined;
    /** Extra props / styles for the outer element (root recipe styles, width). */
    rootCss?: Record<string, unknown> | undefined;
}

/**
 * @param props - see {@link VirtualRowsProps}
 * @returns the bounded virtual-scroll frame, or the unbounded grow-to-content
 *   flow when no height / maxHeight / fillParent is set
 */
export function VirtualRows(props: VirtualRowsProps): ReactNode {
    const {
        header, footer, count, estimateSize, renderRow, measureRows = true,
        overscan = 4, minWidth, headerZIndex = 3, onScroll, rootCss, fillParent, scrollElRef,
    } = props;
    const h = parseCssSize(props.height);
    const mh = parseCssSize(props.maxHeight);
    const bounded = h !== undefined || mh !== undefined || fillParent === true;

    const scrollRef = useRef<HTMLDivElement | null>(null);
    // The items container sits BELOW the in-flow sticky header; its offsetTop
    // is the virtualizer's scrollMargin so the visible-range window is not
    // shifted by the header height. Measured after layout (0 on first pass —
    // the virtualizer re-renders once the state settles).
    const itemsRef = useRef<HTMLDivElement | null>(null);
    const [itemsOffset, setItemsOffset] = useState(0);
    // Re-measure when the row set changes (the header may rewrap); any residual
    // drift from a pure style change is absorbed by the overscan rows.
    useLayoutEffect(() => {
        setItemsOffset(itemsRef.current?.offsetTop ?? 0);
    }, [count]);
    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => scrollRef.current,
        estimateSize,
        overscan,
        scrollMargin: itemsOffset,
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
            ref={(el: HTMLDivElement | null) => {
                scrollRef.current = el;
                if (scrollElRef !== undefined) scrollElRef.current = el;
            }}
            // `display:block` overrides any flex-column root recipe — a flex
            // item's default shrink would collapse the total-size spacer and
            // break the scroll. `overflowY:auto` (after rootCss) becomes the
            // virtualizer's scroll axis; horizontal overflow is inherited from
            // rootCss when the collection sets it.
            css={{
                ...rootCss,
                display: "block",
                overflowY: "auto",
                minHeight: "0",
                ...(fillParent === true ? { flex: "1 1 auto" } : {}),
                ...virtualScrollbarCss,
            }}
            height={fillParent === true ? undefined : h}
            maxHeight={fillParent === true ? undefined : mh}
            onScroll={onScroll}
        >
            {header !== undefined && (
                // Opaque wash: scrolled rows must never paint through the
                // pinned header (not every collection's header cells carry
                // their own background — Calendar's don't).
                <Box position="sticky" top="0" zIndex={headerZIndex} minWidth={minWidth} background="bg.surface">
                    {header}
                </Box>
            )}
            <Box ref={itemsRef} position="relative" height={`${virtualizer.getTotalSize()}px`} minWidth={minWidth}>
                {items.map((item) => (
                    <Box
                        key={item.key}
                        data-index={item.index}
                        ref={measureRows ? virtualizer.measureElement : undefined}
                        position="absolute"
                        top="0"
                        left="0"
                        width="100%"
                        style={{ transform: `translateY(${item.start - itemsOffset}px)` }}
                    >
                        {renderRow(item.index)}
                    </Box>
                ))}
            </Box>
            {footer}
        </Box>
    );
}
