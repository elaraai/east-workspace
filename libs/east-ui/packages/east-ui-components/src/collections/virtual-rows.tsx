/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared row-virtualization frame for the grow-to-content data collections
 * (Matrix / Board / Roster / Calendar / Plan). Table / Library keep
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
 *
 * Measured rows are keyed by `getItemKey` when the host gives one (a row
 * keeps its element and its height when rows change above it), carry
 * `data-slot="virtualRow"` so a host recipe can style the wrappers (a
 * transform transition), and are sized to whole device pixels
 * ({@link devicePixels}) so every row sits on the pixel grid.
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
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
     * Row `index`'s identity (default: the index). The frame keys its row
     * wrappers and the virtualizer's size cache by this value, so when rows
     * are inserted, removed or folded above a row it keeps its DOM element —
     * a CSS transition can slide it to its new offset — and its measured
     * height. Keyed by index, every wrapper after the change would swap the
     * row it shows and inherit another row's height.
     */
    getItemKey?: ((index: number) => string | number) | undefined;
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
     * Controlled scroll target: the body row index to bring into view, applied
     * whenever the value CHANGES (the ValueTree's `scrollToRow` idiom). Only
     * meaningful in bounded mode — an unbounded frame does not scroll.
     */
    scrollToIndex?: number | undefined;
    /**
     * How `scrollToIndex` brings its row into view (default `"center"` — a
     * jump to a sought row). `"auto"` scrolls the least distance that makes the
     * row visible and leaves an already-visible row where it is — what a
     * keyboard-walked selection ring wants.
     */
    scrollAlign?: "auto" | "start" | "center" | "end" | undefined;
    /**
     * Reports the mounted row range whenever it moves — the signal a paged
     * collection needs to shape its demand around the viewport (#577).
     *
     * The range INCLUDES the overscan rows, which is what a prefetching reader
     * wants: they are the rows about to be revealed. `isScrolling` is the
     * virtualizer's own flag; a reader should gate fetching and eviction on it
     * being false, so neither happens mid-gesture.
     *
     * `center` names the item under the viewport's vertical CENTER and how
     * many pixels into it that center sits — resolved from the LIVE scroll
     * offset at report time, never from render-captured geometry. The range
     * alone cannot say where the scrollbar is inside one huge item (a paged
     * collection's unloaded band): the mounted range does not move while the
     * thumb drags within it, so the scroll-end report — the one an idle-gated
     * reader acts on — must read the offset fresh (#612). `undefined` when no
     * mounted item contains the center (an empty body).
     *
     * Fires only in bounded mode — an unbounded frame mounts everything.
     */
    onRangeChange?: ((
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
    ) => void) | undefined;
    /**
     * Bump to force a re-measure. TanStack memoizes its measurements on
     * `[count, paddingStart, scrollMargin, getItemKey, enabled, lanes]` plus the
     * item-size cache — **`estimateSize` is not among them** (verified against
     * `virtual-core@3.13.23`, `dist/esm/index.js:408-440`). So a collection whose
     * row HEIGHTS change while the row COUNT does not — a skeleton band becoming
     * rows, a chart row expanding — leaves stale offsets behind. Changing this
     * value calls `virtualizer.measure()`, which assigns a fresh cache and busts
     * the memo.
     */
    sizeVersion?: number | undefined;
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
 * Rounds a measured CSS-pixel height to whole DEVICE pixels.
 *
 * Measured rows sit at the sum of the heights above them, so one row a
 * fraction of a device pixel tall — fractional line boxes, or a 1.25× / 1.5×
 * screen scale that makes a whole CSS pixel a fraction of a device one —
 * leaves every row below it between device pixels, where a 1px rule smears
 * across two pixel rows or drops out (the #533 family). The browser paints
 * a box to whole device pixels anyway, so the rounded slot is the height the
 * row is drawn at.
 *
 * @param px - A measured height in CSS pixels
 * @returns The height rounded to whole device pixels, in CSS pixels
 */
export function devicePixels(px: number): number {
    const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return Math.round(px * dpr) / dpr;
}

/**
 * @param props - see {@link VirtualRowsProps}
 * @returns the bounded virtual-scroll frame, or the unbounded grow-to-content
 *   flow when no height / maxHeight / fillParent is set
 */
export function VirtualRows(props: VirtualRowsProps): ReactNode {
    const {
        header, footer, count, estimateSize, getItemKey, renderRow, measureRows = true,
        overscan = 4, minWidth, headerZIndex = 3, onScroll, rootCss, fillParent, scrollElRef,
        scrollToIndex, scrollAlign = "center", onRangeChange, sizeVersion,
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
        measureElement: (el) => devicePixels(el.getBoundingClientRect().height),
        ...(getItemKey !== undefined ? { getItemKey } : {}),
    });

    // Bring a requested row into view. Keyed on the index alone, so a row set
    // that grows underneath a standing target (paged windows landing) does not
    // re-scroll on every frame.
    useEffect(() => {
        if (scrollToIndex === undefined || !bounded) return;
        virtualizer.scrollToIndex(scrollToIndex, { align: scrollAlign });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the target index is the trigger
    }, [scrollToIndex]);

    // Heights changed without the count changing — bust TanStack's measurement
    // memo, which does not watch `estimateSize` (see `sizeVersion`).
    useEffect(() => {
        if (sizeVersion === undefined || !bounded) return;
        virtualizer.measure();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the version is the trigger
    }, [sizeVersion]);

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
                {measureRows ? (
                    items.map((item) => (
                        <Box
                            key={item.key}
                            data-index={item.index}
                            data-slot="virtualRow"
                            ref={virtualizer.measureElement}
                            position="absolute"
                            top="0"
                            left="0"
                            width="100%"
                            style={{ transform: `translateY(${item.start - itemsOffset}px)` }}
                        >
                            {renderRow(item.index)}
                        </Box>
                    ))
                ) : items.length > 0 && (
                    // Fixed-row window: ONE translated normal-flow column.
                    // Adjacent rows share edges inside a single layer, so row
                    // backgrounds (hover, match highlight) cannot rasterize
                    // hairline seams between rows — per-row transformed
                    // layers can, whenever fractional zoom / devicePixelRatio
                    // puts some rows' offsets on fractional device pixels
                    // (#533).
                    <Box
                        position="absolute"
                        top="0"
                        left="0"
                        width="100%"
                        style={{ transform: `translateY(${items[0]!.start - itemsOffset}px)` }}
                    >
                        {items.map((item) => (
                            <Box key={item.key} data-index={item.index}>
                                {renderRow(item.index)}
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
            {footer}
            {onRangeChange !== undefined && (
                <RangeReporter
                    virtualizer={virtualizer}
                    startIndex={items[0]?.index ?? 0}
                    endIndex={items[items.length - 1]?.index ?? 0}
                    isScrolling={virtualizer.isScrolling}
                    onRangeChange={onRangeChange}
                />
            )}
        </Box>
    );
}

/** Reports the mounted range in an effect, so the callback fires AFTER commit
 *  and a reader that responds by setting state cannot re-enter the render. */
function RangeReporter({ virtualizer, startIndex, endIndex, isScrolling, onRangeChange }: {
    virtualizer: Virtualizer<HTMLDivElement, Element>;
    startIndex: number;
    endIndex: number;
    isScrolling: boolean;
    onRangeChange: (
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
    ) => void;
}): null {
    useEffect(() => {
        // The center is resolved AT REPORT TIME from the live scroll offset,
        // never from render-captured values: a scrollbar drag deep inside one
        // huge item (a paged collection's unloaded band) never changes the
        // mounted range, so the values captured when the range last moved are
        // stale by the scroll-end report — the one an idle-gated reader acts
        // on (#612). The center is on screen by definition, so its item is
        // always among the mounted ones.
        const centerPx = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 2;
        const item = virtualizer.getVirtualItems().find((it) => centerPx >= it.start && centerPx < it.end);
        onRangeChange(
            { startIndex, endIndex },
            isScrolling,
            item !== undefined ? { index: item.index, withinPx: centerPx - item.start } : undefined,
        );
    }, [startIndex, endIndex, isScrolling, onRangeChange, virtualizer]);
    return null;
}
