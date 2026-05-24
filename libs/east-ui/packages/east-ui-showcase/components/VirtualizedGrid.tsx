/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ExampleCard } from "./ExampleCard";
import type { CatalogEntry } from "../catalog";

/** Card chrome (eyebrow row: name + blurb + chips + padding) above the body. */
const CARD_CHROME = 70;
/** Vertical gap between sibling frame rows — bsys Main recipe. */
const ROW_GAP = 16;
/** Horizontal gap between grid cells within a row — bsys Main recipe. */
const CELL_GAP = 12;
/** Side gutter — bsys Main recipe ("24 px left/right viewport padding").
 *  Matches the Header bar's paddingInline so the Row 2 surface title and
 *  the first card's left edge sit on the same x-coordinate. */
const SIDE_PADDING = "24px";
/** Top gap from the Header's bottom rule to the first card row — bsys
 *  Main recipe ("32 px top/bottom viewport padding"). Bottom uses the
 *  same value for symmetry. */
const TOP_PADDING = 32;

function useViewportWidth(): number {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const onResize = () => setW(window.innerWidth);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return w;
}

/** Clamp an entry's preferred column count to the bsys Main recipe
 *  breakpoint ladder: cap at 1 below 560 px, 2 below 768, 3 below 960,
 *  4 below 1280, otherwise honour the entry's preference (max 6). */
function columnsForEntry(e: CatalogEntry, viewportW: number): number {
    let cap: number;
    if      (viewportW < 560)  cap = 1;
    else if (viewportW < 768)  cap = 2;
    else if (viewportW < 960)  cap = 3;
    else if (viewportW < 1280) cap = 4;
    else                       cap = 6;
    return Math.min(e.columns, cap);
}

interface Row { entries: CatalogEntry[]; cols: number; bodyHeight: number; rowHeight: number }

/**
 * Group consecutive entries that share both column count and body height
 * into rows. Fixed body sizes per `ShowcaseLayout` keep row heights
 * deterministic for the virtualizer.
 */
function buildRows(entries: readonly CatalogEntry[], viewportW: number): Row[] {
    const out: Row[] = [];
    let buf: CatalogEntry[] = [];
    let bufCols: number | null = null;
    let bufHeight: number | null = null;
    const flush = () => {
        if (buf.length === 0 || bufCols === null || bufHeight === null) return;
        const rowHeight = bufHeight + CARD_CHROME;
        for (let i = 0; i < buf.length; i += bufCols) {
            out.push({ entries: buf.slice(i, i + bufCols), cols: bufCols, bodyHeight: bufHeight, rowHeight });
        }
        buf = [];
    };
    for (const e of entries) {
        const cols = columnsForEntry(e, viewportW);
        if ((bufCols !== null && cols !== bufCols) || (bufHeight !== null && e.bodyHeight !== bufHeight)) flush();
        bufCols = cols;
        bufHeight = e.bodyHeight;
        buf.push(e);
    }
    flush();
    return out;
}

/**
 * Virtualizes the showcase grid by row using TanStack Virtual against a
 * scrollable parent. Only rows currently in or near the viewport are
 * mounted, so even 100+ Chart cards don't all mount on category switch.
 */
export function VirtualizedGrid({ entries }: { entries: readonly CatalogEntry[] }) {
    const viewportWidth = useViewportWidth();
    const rows = useMemo(() => buildRows(entries, viewportWidth), [entries, viewportWidth]);
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (i) => rows[i].rowHeight,
        overscan: 2,
        gap: ROW_GAP,
    });

    /* Reset scroll on entry-set change so switching to a shorter category
     * doesn't leave the viewport pinned at an out-of-range offset. */
    useEffect(() => {
        parentRef.current?.scrollTo({ top: 0 });
    }, [entries]);

    return (
        /* Scroll container fills the available width so the scrollbar sits
         * flush against the viewport's right edge. The inner relative box
         * holds the absolutely-positioned rows with a `TOP_PADDING` gap
         * either side so the first/last rows clear the sticky header
         * rule and the bottom of the scroll area. */
        <Box ref={parentRef} h="100%" w="100%" overflowY="auto">
            <Box
                position="relative"
                h={`${virtualizer.getTotalSize() + TOP_PADDING * 2}px`}
            >
                {virtualizer.getVirtualItems().map(virtualRow => {
                    const row = rows[virtualRow.index];
                    return (
                        <Box
                            key={virtualRow.key}
                            position="absolute"
                            top={`${TOP_PADDING}px`}
                            left={SIDE_PADDING}
                            right={SIDE_PADDING}
                            h={`${row.rowHeight}px`}
                            transform={`translateY(${virtualRow.start}px)`}
                            display="grid"
                            gridTemplateColumns={`repeat(${row.cols}, minmax(0, 1fr))`}
                            gap={`${CELL_GAP}px`}
                        >
                            {row.entries.map(entry => (
                                <ExampleCard
                                    key={entry.name}
                                    name={entry.name}
                                    example={entry}
                                    bodyHeight={`${row.bodyHeight}px`}
                                />
                            ))}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}
