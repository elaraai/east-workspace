/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import React, { memo, useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Box, Grid, HStack, Popover, Portal, Text, Tooltip, useToken } from "@chakra-ui/react";
import { useDrag } from "@use-gesture/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Matrix } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { alignToCss, tokenToCssVar } from "../shared/helpers";

const matrixRootEqual = equalFor(Matrix.Types.Root);

/** East Matrix root value type. */
export type MatrixRootValue = ValueTypeOf<typeof Matrix.Types.Root>;

export interface EastChakraMatrixProps {
    value: MatrixRootValue;
    storageKey: string;
}

const SIZE_PRESETS: Record<string, { cellHeight: string; fontSize: string; headerPad: string }> = {
    xs: { cellHeight: "32px", fontSize: "xs", headerPad: "1.5" },
    sm: { cellHeight: "40px", fontSize: "sm", headerPad: "2" },
    md: { cellHeight: "52px", fontSize: "sm", headerPad: "2.5" },
    lg: { cellHeight: "64px", fontSize: "md", headerPad: "3" },
};


/**
 * Internal stacking order within a single Matrix. These are ordinal
 * ranks inside the Matrix's own stacking context — not theme-level
 * z-indices. Kept as a single map so the intent is visible and the
 * relationships are easy to audit.
 *
 *   dragHandle < segmentLabel < cellEmphasis < rowHeader < columnHeader < corner < brushRect
 *
 * `dragHandle` and `segmentLabel` are local to a cell's segment
 * stacking context. Segment labels sit above the drag handle but are
 * `pointer-events: none` so interactions still reach the handle.
 */
const STACK = {
    dragHandle: 1,
    segmentLabel: 2,
    cellEmphasis: 3,
    rowHeader: 4,
    columnHeader: 5,
    corner: 6,
    brushRect: 7,
} as const;

/**
 * Renders an East UI Matrix value as a modern enterprise heat-grid —
 * Chakra CSS-Grid with sticky first column, dict-keyed cells,
 * hover cross-highlight, controlled brush selection, and optional
 * segment drag-resize.
 */
export const EastChakraMatrix = memo(function EastChakraMatrix({ value, storageKey }: EastChakraMatrixProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const sizeTag = style ? getSomeorUndefined(style.size)?.type ?? "md" : "md";
    const sizePreset = SIZE_PRESETS[sizeTag] ?? SIZE_PRESETS.md!;

    const showGridLines = style ? getSomeorUndefined(style.showGridLines) ?? false : false;
    const gridColorOverride = style ? getSomeorUndefined(style.gridColor) : undefined;
    const headerBackground = style ? getSomeorUndefined(style.headerBackground) : undefined;
    const headerColor = style ? getSomeorUndefined(style.headerColor) : undefined;
    const cellBackground = style ? getSomeorUndefined(style.cellBackground) : undefined;
    const cellBorderRadius = style ? getSomeorUndefined(style.cellBorderRadius) ?? "2px" : "2px";
    const rowHeaderWidth = style ? getSomeorUndefined(style.rowHeaderWidth) ?? "180px" : "180px";
    const columnHeaderHeight = style ? getSomeorUndefined(style.columnHeaderHeight) ?? sizePreset.cellHeight : sizePreset.cellHeight;
    const legendPosition = style ? getSomeorUndefined(style.legendPosition)?.type ?? "bottom" : "bottom";
    const emphasisDefault = style ? getSomeorUndefined(style.emphasisColor) : undefined;
    const selectedBackground = style ? getSomeorUndefined(style.selectedBackground) ?? "blue.200" : "blue.200";
    const selectedBorderColor = style ? getSomeorUndefined(style.selectedBorderColor) ?? "blue.700" : "blue.700";
    const hoverHighlightColor = style ? getSomeorUndefined(style.hoverHighlightColor) ?? "yellow.50" : "yellow.50";
    const segmentLabelColor = style ? getSomeorUndefined(style.segmentLabelColor) ?? "white" : "white";
    const segmentLabelFontSize = style ? getSomeorUndefined(style.segmentLabelFontSize) ?? "0.75rem" : "0.75rem";
    const segmentLabelFontWeight = style ? getSomeorUndefined(style.segmentLabelFontWeight) ?? "600" : "600";
    const orientation = style ? getSomeorUndefined(style.cellOrientation)?.type ?? "horizontal" : "horizontal";
    // Minimum rendered segment width (CSS) below which the segment label is
    // suppressed. Default `"24px"`; `"0"` always renders.
    const minLabelSizePx = useMemo(() => {
        const raw = style ? getSomeorUndefined(style.minLabelSize) : undefined;
        if (raw === undefined) return 24;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : 24;
    }, [style]);

    const [defaultGridColor, defaultEmphasis, selectedBgToken, selectedBorderToken, hoverHighlightToken] = useToken("colors", [
        "gray.200",
        emphasisDefault ?? "blue.500",
        selectedBackground,
        selectedBorderColor,
        hoverHighlightColor,
    ]);
    const gridColor = gridColorOverride ?? defaultGridColor;

    const legendEntries = getSomeorUndefined(value.legend);
    const colorByCategory = useMemo(() => {
        const m = new Map<string, string>();
        if (legendEntries) {
            for (const e of legendEntries) m.set(e.category, e.color);
        }
        return m;
    }, [legendEntries]);
    const brushSelection = getSomeorUndefined(value.brushSelection);
    const brushEnabled = brushSelection?.enabled ?? false;
    const brushOnChange = brushSelection ? getSomeorUndefined(brushSelection.onChange) : undefined;
    const brushSelected = brushSelection ? getSomeorUndefined(brushSelection.selected) : undefined;
    const onCellClick = getSomeorUndefined(value.onCellClick);
    const onSegmentClick = getSomeorUndefined(value.onSegmentClick);
    const onSegmentChange = getSomeorUndefined(value.onSegmentChange);

    // Selected cells: when `brushSelected` (the IR prop) is defined,
    // derive directly from it. When undefined (uncontrolled), fall
    // through to local state. The pointerUp commit fires
    // `brushOnChange` for controlled callers; the local state is only
    // mutated in uncontrolled mode.
    const isBrushControlled = brushSelected !== undefined;
    const [localSelectedCells, setLocalSelectedCells] = useState<Set<string>>(new Set());
    const selectedCells = useMemo<Set<string>>(() => {
        if (brushSelected) {
            return new Set(brushSelected.map(c => `${c.row}:${c.column}`));
        }
        return localSelectedCells;
    }, [brushSelected, localSelectedCells]);

    // Hover cross-highlight
    const [hoveredCell, setHoveredCell] = useState<{ row: string; column: string } | null>(null);

    // Brush-drag state
    const gridRef = useRef<HTMLDivElement>(null);

    // Live-measured cell pixel width — feeds the `minLabelSize` gating
    // and the horizontal segment-drag math. Cells in a Matrix are
    // uniformly sized (`repeat(N, 1fr)`), so one measurement applies to
    // every cell. Updated via ResizeObserver on the grid container.
    const [cellWidthPx, setCellWidthPx] = useState<number>(0);
    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const measure = () => {
            const total = el.clientWidth;
            const rowHdrPx = parseInt(rowHeaderWidth, 10) || 0;
            const cols = value.columns.length || 1;
            const w = Math.max(0, (total - rowHdrPx) / cols);
            setCellWidthPx(w);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [rowHeaderWidth, value.columns.length]);
    const [brushRect, setBrushRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [provisionalSelected, setProvisionalSelected] = useState<Set<string>>(() => new Set());
    const brushOriginRef = useRef<{ x: number; y: number } | null>(null);

    const computeCellsInRect = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
        if (!gridRef.current) return new Set<string>();
        const gridRect = gridRef.current.getBoundingClientRect();
        const hits = new Set<string>();
        gridRef.current.querySelectorAll<HTMLElement>("[data-cell-id]").forEach(el => {
            const cellId = el.getAttribute("data-cell-id");
            if (!cellId) return;
            const r = el.getBoundingClientRect();
            const cx = r.left - gridRect.left;
            const cy = r.top - gridRect.top;
            if (!(cx + r.width < rect.x || cx > rect.x + rect.w
                || cy + r.height < rect.y || cy > rect.y + rect.h)) {
                hits.add(cellId);
            }
        });
        return hits;
    }, []);

    // Brush selection via @use-gesture/react. The library handles
    // pointerCapture, pointer-cancel cleanup, and click-vs-drag (via
    // `filterTaps`); we just compute the rect against the grid's local
    // coordinate frame and commit on `last`.
    const bindBrush = useDrag(({ active, xy: [px, py], last, first, tap }) => {
        if (!brushEnabled || !gridRef.current) return;
        if (tap) {
            // Single click hits a cell — no brush selection.
            brushOriginRef.current = null;
            setBrushRect(null);
            setProvisionalSelected(new Set());
            return;
        }
        const r = gridRef.current.getBoundingClientRect();
        const x = px - r.left;
        const y = py - r.top;
        if (first) {
            brushOriginRef.current = { x, y };
        }
        const origin = brushOriginRef.current;
        if (!origin) return;
        const rect = {
            x: Math.min(x, origin.x),
            y: Math.min(y, origin.y),
            w: Math.abs(x - origin.x),
            h: Math.abs(y - origin.y),
        };
        if (last) {
            const selected = computeCellsInRect(rect);
            // Only mutate local state when uncontrolled — when controlled,
            // the IR prop drives the next render via `brushOnChange`.
            if (!isBrushControlled) {
                setLocalSelectedCells(selected);
            }
            setProvisionalSelected(new Set());
            if (brushOnChange) {
                const coords = Array.from(selected).map(id => {
                    const idx = id.indexOf(":");
                    return { row: id.slice(0, idx), column: id.slice(idx + 1) };
                });
                queueMicrotask(() => brushOnChange(coords));
            }
            brushOriginRef.current = null;
            setBrushRect(null);
            return;
        }
        if (active) {
            setBrushRect(rect);
            setProvisionalSelected(computeCellsInRect(rect));
        }
    }, { filterTaps: true, preventDefault: true });

    const handleCellClick = useCallback((rowKey: string, columnKey: string) => {
        if (onCellClick) {
            queueMicrotask(() => onCellClick({ row: rowKey, column: columnKey }));
        }
    }, [onCellClick]);

    const handleSegmentClick = useCallback((e: React.MouseEvent, rowKey: string, columnKey: string, category: string) => {
        if (!onSegmentClick) return;
        e.stopPropagation();
        queueMicrotask(() => onSegmentClick({ row: rowKey, column: columnKey, category }));
    }, [onSegmentClick]);

    const handleSegmentDrag = useCallback((
        e: React.PointerEvent,
        rowKey: string,
        columnKey: string,
        category: string,
        startWeight: number,
        totalWeight: number,
        axis: "x" | "y",
        cellSize: number,
        min: number,
        max: number,
        step: number,
    ) => {
        if (!onSegmentChange) return;
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const moveHandler = (me: PointerEvent) => {
            const delta = axis === "x" ? me.clientX - startX : me.clientY - startY;
            const deltaWeight = (delta / cellSize) * totalWeight;
            let newWeight = startWeight + (axis === "x" ? deltaWeight : -deltaWeight);
            newWeight = Math.max(min, Math.min(max, newWeight));
            newWeight = Math.round(newWeight / step) * step;
            queueMicrotask(() => onSegmentChange({ row: rowKey, column: columnKey, category, weight: newWeight }));
        };
        const upHandler = () => {
            window.removeEventListener("pointermove", moveHandler);
            window.removeEventListener("pointerup", upHandler);
        };
        window.addEventListener("pointermove", moveHandler);
        window.addEventListener("pointerup", upHandler);
    }, [onSegmentChange]);

    const columns = value.columns;
    const rows = value.rows;
    const gridTemplateColumns = `${rowHeaderWidth} repeat(${columns.length}, 1fr)`;

    const headerBg = headerBackground ?? "gray.50";
    const headerFg = headerColor ?? "gray.700";

    const grid = (
        <Box
            position="relative"
            overflow="auto"
            borderRadius="md"
            background="white"
            boxShadow="sm"
            border="1px solid"
            borderColor={gridColor}
        >
            <Grid
                ref={gridRef}
                templateColumns={gridTemplateColumns}
                gap={showGridLines ? "0" : "1px"}
                background={showGridLines ? undefined : gridColor}
                {...bindBrush()}
                userSelect="none"
                role="grid"
            >
                {/* Top-left corner */}
                <Box
                    position="sticky"
                    left={0}
                    top={0}
                    zIndex={STACK.corner}
                    height={columnHeaderHeight}
                    background={headerBg}
                    color={headerFg}
                    {...(showGridLines ? { borderRight: `1px solid ${gridColor}`, borderBottom: `1px solid ${gridColor}` } : {})}
                />

                {/* Column headers */}
                {columns.map(col => {
                    const isHovered = hoveredCell?.column === col.key;
                    return (
                        <Box
                            key={`colhdr-${col.key}`}
                            position="sticky"
                            top={0}
                            zIndex={STACK.columnHeader}
                            height={columnHeaderHeight}
                            background={isHovered ? hoverHighlightToken : headerBg}
                            color={headerFg}
                            px={sizePreset.headerPad}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            fontSize={sizePreset.fontSize}
                            fontWeight="semibold"
                            transition="background 0.15s"
                            {...(showGridLines ? { borderBottom: `1px solid ${gridColor}` } : {})}
                            role="columnheader"
                        >
                            {col.header ? (
                                <EastChakraComponent
                                    value={getSomeorUndefined(col.header)!}
                                    storageKey={`${storageKey}.col.${col.key}`}
                                />
                            ) : col.key}
                        </Box>
                    );
                })}

                {/* Rows */}
                {rows.map(row => {
                    const isRowHovered = hoveredCell?.row === row.key;
                    return (
                        <>
                            {/* Row header */}
                            <Box
                                key={`rowhdr-${row.key}`}
                                position="sticky"
                                left={0}
                                zIndex={STACK.rowHeader}
                                height={sizePreset.cellHeight}
                                background={isRowHovered ? hoverHighlightToken : headerBg}
                                color={headerFg}
                                px={sizePreset.headerPad}
                                display="flex"
                                alignItems="center"
                                fontSize={sizePreset.fontSize}
                                fontWeight="medium"
                                transition="background 0.15s"
                                {...(showGridLines ? { borderRight: `1px solid ${gridColor}` } : {})}
                                role="rowheader"
                            >
                                {row.header ? (
                                    <EastChakraComponent
                                        value={getSomeorUndefined(row.header)!}
                                        storageKey={`${storageKey}.row.${row.key}`}
                                    />
                                ) : row.key}
                            </Box>

                            {/* Cells for this row */}
                            {columns.map(col => {
                                const cell = row.cells.get(col.key);
                                const cellId = `${row.key}:${col.key}`;
                                const segments = cell?.segments ?? [];
                                const totalWeight = segments.reduce((a, s) => a + s.weight, 0) || 1;
                                const emphasisColor = cell ? getSomeorUndefined(cell.emphasisColor) : undefined;
                                const isEmphasized = !!emphasisColor || (cell && emphasisDefault !== undefined && false);
                                const tooltip = cell ? getSomeorUndefined(cell.tooltip) : undefined;
                                const popover = cell ? getSomeorUndefined(cell.popover) : undefined;
                                const overlays = cell?.overlays ?? [];
                                const isSelected = selectedCells.has(cellId) || provisionalSelected.has(cellId);
                                const isThisCellHovered = hoveredCell?.row === row.key && hoveredCell?.column === col.key;

                                const cellBody = (
                                    <Box
                                        data-cell-id={cellId}
                                        role="gridcell"
                                        position="relative"
                                        width="100%"
                                        height={sizePreset.cellHeight}
                                        background={
                                            isSelected ? selectedBgToken
                                            : isThisCellHovered ? "yellow.100"
                                            : (cellBackground ?? "white")
                                        }
                                        borderRadius={cellBorderRadius}
                                        cursor={onCellClick ? "pointer" : brushEnabled ? "crosshair" : "default"}
                                        transition="background 0.15s, box-shadow 0.15s"
                                        onClick={() => handleCellClick(row.key, col.key)}
                                        onPointerEnter={() => setHoveredCell({ row: row.key, column: col.key })}
                                        onPointerLeave={() => setHoveredCell(null)}
                                        overflow="hidden"
                                        {...(emphasisColor ? {
                                            outline: `3px solid ${emphasisColor}`,
                                            outlineOffset: "-3px",
                                            zIndex: STACK.cellEmphasis,
                                        } : isEmphasized ? {
                                            outline: `3px solid ${defaultEmphasis}`,
                                            outlineOffset: "-3px",
                                            zIndex: STACK.cellEmphasis,
                                        } : {})}
                                        {...(isSelected ? {
                                            boxShadow: `inset 0 0 0 3px ${selectedBorderToken}`,
                                        } : {})}
                                    >
                                        {/* Segment fill */}
                                        {segments.length > 0 && (
                                            orientation === "vertical" ? (
                                                <Box display="flex" flexDirection="column-reverse" height="100%" width="100%">
                                                    {segments.map((seg, i) => {
                                                        const pct = (seg.weight / totalWeight) * 100;
                                                        const isResizable = !!onSegmentChange && i < segments.length - 1;
                                                        const segColor = getSomeorUndefined(seg.color) ?? colorByCategory.get(seg.category) ?? "blue.400";
                                                        const handleColor = tokenToCssVar(segColor);
                                                        const segLabel = getSomeorUndefined(seg.label);
                                                        // Cell height is fixed via the size preset; vertical
                                                        // segment height in pixels = pct% × cellHeight. Hide
                                                        // label when below `style.minLabelSize`.
                                                        const cellPxV = parseInt(sizePreset.cellHeight, 10) || 52;
                                                        const segPxV = (pct / 100) * cellPxV;
                                                        const showLabelV = segPxV >= minLabelSizePx;
                                                        return (
                                                            <Box
                                                                key={i}
                                                                width="100%"
                                                                height={`${pct}%`}
                                                                background={segColor}
                                                                position="relative"
                                                                cursor={onSegmentClick ? "pointer" : "default"}
                                                                onClick={(e) => handleSegmentClick(e, row.key, col.key, seg.category)}
                                                            >
                                                                {isResizable && (
                                                                    <div
                                                                        style={{
                                                                            position: "absolute",
                                                                            top: "-4px",
                                                                            left: 0,
                                                                            right: 0,
                                                                            height: "8px",
                                                                            cursor: "row-resize",
                                                                            background: "transparent",
                                                                            transition: "background 0.15s",
                                                                            zIndex: STACK.dragHandle,
                                                                        }}
                                                                        onPointerEnter={(e) => { e.currentTarget.style.background = handleColor; e.currentTarget.style.filter = "brightness(0.55)"; }}
                                                                        onPointerLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.filter = "none"; }}
                                                                        onPointerDown={(e) => handleSegmentDrag(
                                                                            e, row.key, col.key, seg.category,
                                                                            seg.weight, totalWeight, "y",
                                                                            parseInt(sizePreset.cellHeight, 10) || 52,
                                                                            getSomeorUndefined(seg.min) ?? 0,
                                                                            getSomeorUndefined(seg.max) ?? 1,
                                                                            getSomeorUndefined(seg.step) ?? 0.01,
                                                                        )}
                                                                    />
                                                                )}
                                                                {segLabel && showLabelV && (
                                                                    <div
                                                                        style={{
                                                                            position: "absolute",
                                                                            inset: 0,
                                                                            display: "flex",
                                                                            alignItems: alignToCss(getSomeorUndefined(segLabel.verticalAlign)?.type),
                                                                            justifyContent: alignToCss(getSomeorUndefined(segLabel.align)?.type),
                                                                            padding: "0 6px",
                                                                            color: getSomeorUndefined(segLabel.color) ?? segmentLabelColor,
                                                                            fontSize: segmentLabelFontSize,
                                                                            fontWeight: segmentLabelFontWeight,
                                                                            pointerEvents: "none",
                                                                            zIndex: STACK.segmentLabel,
                                                                        }}
                                                                    >
                                                                        {segLabel.value}
                                                                    </div>
                                                                )}
                                                            </Box>
                                                        );
                                                    })}
                                                </Box>
                                            ) : (
                                                <Box display="flex" flexDirection="row" height="100%" width="100%">
                                                    {segments.map((seg, i) => {
                                                        const pct = (seg.weight / totalWeight) * 100;
                                                        const isResizable = !!onSegmentChange && i < segments.length - 1;
                                                        const segColor = getSomeorUndefined(seg.color) ?? colorByCategory.get(seg.category) ?? "blue.400";
                                                        const handleColor = tokenToCssVar(segColor);
                                                        const segLabel = getSomeorUndefined(seg.label);
                                                        // Cell width is live-measured via the ResizeObserver
                                                        // on the grid container (cells are uniformly sized
                                                        // by `repeat(N, 1fr)` so one measurement applies).
                                                        // Hide the label when its segment renders narrower
                                                        // than `style.minLabelSize`.
                                                        const segPxH = (pct / 100) * cellWidthPx;
                                                        const showLabelH = cellWidthPx > 0 && segPxH >= minLabelSizePx;
                                                        return (
                                                            <Box
                                                                key={i}
                                                                height="100%"
                                                                width={`${pct}%`}
                                                                background={segColor}
                                                                position="relative"
                                                                cursor={onSegmentClick ? "pointer" : "default"}
                                                                onClick={(e) => handleSegmentClick(e, row.key, col.key, seg.category)}
                                                            >
                                                                {isResizable && (
                                                                    <div
                                                                        style={{
                                                                            position: "absolute",
                                                                            right: "-4px",
                                                                            top: 0,
                                                                            bottom: 0,
                                                                            width: "8px",
                                                                            cursor: "col-resize",
                                                                            background: "transparent",
                                                                            transition: "background 0.15s",
                                                                            zIndex: STACK.dragHandle,
                                                                        }}
                                                                        onPointerEnter={(e) => { e.currentTarget.style.background = handleColor; e.currentTarget.style.filter = "brightness(0.55)"; }}
                                                                        onPointerLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.filter = "none"; }}
                                                                        onPointerDown={(e) => handleSegmentDrag(
                                                                            e, row.key, col.key, seg.category,
                                                                            seg.weight, totalWeight, "x",
                                                                            cellWidthPx || 200,
                                                                            getSomeorUndefined(seg.min) ?? 0,
                                                                            getSomeorUndefined(seg.max) ?? 1,
                                                                            getSomeorUndefined(seg.step) ?? 0.01,
                                                                        )}
                                                                    />
                                                                )}
                                                                {segLabel && showLabelH && (
                                                                    <div
                                                                        style={{
                                                                            position: "absolute",
                                                                            inset: 0,
                                                                            display: "flex",
                                                                            alignItems: alignToCss(getSomeorUndefined(segLabel.verticalAlign)?.type),
                                                                            justifyContent: alignToCss(getSomeorUndefined(segLabel.align)?.type),
                                                                            padding: "0 6px",
                                                                            color: getSomeorUndefined(segLabel.color) ?? segmentLabelColor,
                                                                            fontSize: segmentLabelFontSize,
                                                                            fontWeight: segmentLabelFontWeight,
                                                                            pointerEvents: "none",
                                                                            zIndex: STACK.segmentLabel,
                                                                        }}
                                                                    >
                                                                        {segLabel.value}
                                                                    </div>
                                                                )}
                                                            </Box>
                                                        );
                                                    })}
                                                </Box>
                                            )
                                        )}

                                        {/* Selection / hover tint — drawn on top of segments so the
                                            state colour shows through even when the cell is fully filled. */}
                                        {(isSelected || isThisCellHovered) && (
                                            <Box
                                                position="absolute"
                                                inset={0}
                                                background={isSelected ? selectedBgToken : hoverHighlightToken}
                                                opacity={isSelected ? 0.55 : 0.4}
                                                pointerEvents="none"
                                            />
                                        )}

                                        {/* Overlays — each fills the cell as a flex container so
                                            align / verticalAlign position the content within. */}
                                        {overlays.map((o, i) => (
                                            <div
                                                key={`ov-${i}`}
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    display: "flex",
                                                    justifyContent: alignToCss(o.align?.type),
                                                    alignItems: alignToCss(o.verticalAlign?.type),
                                                    padding: "4px",
                                                    pointerEvents: "none",
                                                }}
                                            >
                                                <EastChakraComponent
                                                    value={o.content}
                                                    storageKey={`${storageKey}.cell.${cellId}.overlay.${i}`}
                                                />
                                            </div>
                                        ))}
                                    </Box>
                                );

                                // Wrapping order: Popover.Root (outermost so its
                                // anchor element is the cell), then Tooltip.Root
                                // around the same cellBody. Both can be present
                                // simultaneously — popover opens on click,
                                // tooltip opens on hover.
                                let body: React.ReactNode = cellBody;
                                if (tooltip !== undefined) {
                                    body = (
                                        <Tooltip.Root key={`${cellId}-tt`} openDelay={200}>
                                            <Tooltip.Trigger asChild>
                                                {body}
                                            </Tooltip.Trigger>
                                            <Tooltip.Positioner>
                                                <Tooltip.Content>
                                                    <EastChakraComponent
                                                        value={tooltip}
                                                        storageKey={`${storageKey}.cell.${cellId}.tooltip`}
                                                    />
                                                </Tooltip.Content>
                                            </Tooltip.Positioner>
                                        </Tooltip.Root>
                                    );
                                }
                                if (popover !== undefined) {
                                    body = (
                                        <Popover.Root key={`${cellId}-pop`}>
                                            <Popover.Trigger asChild>
                                                {body}
                                            </Popover.Trigger>
                                            <Portal>
                                                <Popover.Positioner>
                                                    <Popover.Content>
                                                        <Popover.Body p="3">
                                                            <EastChakraComponent
                                                                value={popover}
                                                                storageKey={`${storageKey}.cell.${cellId}.popover`}
                                                            />
                                                        </Popover.Body>
                                                    </Popover.Content>
                                                </Popover.Positioner>
                                            </Portal>
                                        </Popover.Root>
                                    );
                                }
                                return <React.Fragment key={cellId}>{body}</React.Fragment>;
                            })}
                        </>
                    );
                })}
            </Grid>

            {/* Brush selection rectangle */}
            {brushRect && (
                <Box
                    position="absolute"
                    left={`${brushRect.x}px`}
                    top={`${brushRect.y}px`}
                    width={`${brushRect.w}px`}
                    height={`${brushRect.h}px`}
                    background={selectedBgToken}
                    opacity={0.35}
                    border="1px dashed"
                    borderColor={selectedBorderToken}
                    pointerEvents="none"
                    zIndex={STACK.brushRect}
                />
            )}
        </Box>
    );

    const legend = legendEntries ? (
        <HStack gap="4" flexWrap="wrap" px="1" py="2">
            {legendEntries.map((e, i) => (
                <HStack key={i} gap="1.5">
                    <Box width="12px" height="12px" borderRadius="sm" background={e.color} />
                    <Text fontSize="xs" color="gray.700">
                        {getSomeorUndefined(e.label) ?? e.category}
                    </Text>
                </HStack>
            ))}
        </HStack>
    ) : null;

    if (legendPosition === "top") return <Box>{legend}{grid}</Box>;
    if (legendPosition === "bottom" || !legend) return <Box>{grid}{legend}</Box>;
    if (legendPosition === "left") return <HStack gap="3" align="flex-start"><Box>{legend}</Box>{grid}</HStack>;
    return <HStack gap="3" align="flex-start">{grid}<Box>{legend}</Box></HStack>;
}, (prev, next) => matrixRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
