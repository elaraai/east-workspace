/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useRef, useState, useCallback } from "react";
import { Box, Grid, HStack, Text, useToken } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Matrix } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const matrixRootEqual = equalFor(Matrix.Types.Root);

/** East Matrix root value type. */
export type MatrixRootValue = ValueTypeOf<typeof Matrix.Types.Root>;

export interface EastChakraMatrixProps {
    value: MatrixRootValue;
    storageKey: string;
}

const SIZE_PRESETS: Record<string, { cellHeight: string; fontSize: string; headerPad: string }> = {
    xs: { cellHeight: "28px", fontSize: "xs", headerPad: "1" },
    sm: { cellHeight: "36px", fontSize: "sm", headerPad: "2" },
    md: { cellHeight: "48px", fontSize: "sm", headerPad: "2" },
    lg: { cellHeight: "60px", fontSize: "md", headerPad: "3" },
};

const POSITION_STYLE: Record<string, React.CSSProperties> = {
    tl: { top: 2, left: 2 },
    tr: { top: 2, right: 2 },
    bl: { bottom: 2, left: 2 },
    br: { bottom: 2, right: 2 },
    center: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
};

/**
 * Renders an East UI Matrix value as a CSS-Grid heat-grid with sticky
 * first column, multi-overlay cells, and optional brush selection.
 *
 * @remarks
 * Each cell exposes `data-cell-id="{rowKey}:{columnKey}"` for
 * consumer patterns (AssignmentBoard / RosterGrid) that address
 * cells by coordinate.
 */
export const EastChakraMatrix = memo(function EastChakraMatrix({ value, storageKey }: EastChakraMatrixProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const sizeTag = style ? getSomeorUndefined(style.size)?.type ?? "md" : "md";
    const sizePreset = SIZE_PRESETS[sizeTag] ?? SIZE_PRESETS.md!;

    const showGridLines = style ? getSomeorUndefined(style.showGridLines) ?? true : true;
    const gridColorOverride = style ? getSomeorUndefined(style.gridColor) : undefined;
    const headerBackground = style ? getSomeorUndefined(style.headerBackground) : undefined;
    const headerColor = style ? getSomeorUndefined(style.headerColor) : undefined;
    const cellBackground = style ? getSomeorUndefined(style.cellBackground) : undefined;
    const rowHeaderWidth = style ? getSomeorUndefined(style.rowHeaderWidth) ?? "180px" : "180px";
    const columnHeaderHeight = style ? getSomeorUndefined(style.columnHeaderHeight) ?? sizePreset.cellHeight : sizePreset.cellHeight;
    const legendPosition = style ? getSomeorUndefined(style.legendPosition)?.type ?? "bottom" : "bottom";

    const [defaultGridColor] = useToken("colors", ["gray.200"]);
    const gridColor = gridColorOverride ?? defaultGridColor;

    const legendEntries = getSomeorUndefined(value.legend);
    const brushSelection = getSomeorUndefined(value.brushSelection);
    const brushEnabled = brushSelection?.enabled ?? false;
    const brushOnChange = brushSelection ? getSomeorUndefined(brushSelection.onChange) : undefined;
    const onCellClick = getSomeorUndefined(value.onCellClick);

    const gridRef = useRef<HTMLDivElement>(null);
    const [brushRect, setBrushRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [brushOrigin, setBrushOrigin] = useState<{ x: number; y: number } | null>(null);
    const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        if (!brushEnabled || !gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setBrushOrigin({ x, y });
        setBrushRect({ x, y, w: 0, h: 0 });
    }, [brushEnabled]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!brushEnabled || !brushOrigin || !gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const r = {
            x: Math.min(x, brushOrigin.x),
            y: Math.min(y, brushOrigin.y),
            w: Math.abs(x - brushOrigin.x),
            h: Math.abs(y - brushOrigin.y),
        };
        setBrushRect(r);
    }, [brushEnabled, brushOrigin]);

    const handlePointerUp = useCallback(() => {
        if (!brushEnabled || !brushRect || !gridRef.current) {
            setBrushOrigin(null);
            setBrushRect(null);
            return;
        }
        const gridRect = gridRef.current.getBoundingClientRect();
        const selected = new Set<string>();
        const cellEls = gridRef.current.querySelectorAll<HTMLElement>("[data-cell-id]");
        cellEls.forEach(el => {
            const cellId = el.getAttribute("data-cell-id");
            if (!cellId) return;
            const r = el.getBoundingClientRect();
            const cx = r.left - gridRect.left;
            const cy = r.top - gridRect.top;
            const intersects = !(
                cx + r.width < brushRect.x
                || cx > brushRect.x + brushRect.w
                || cy + r.height < brushRect.y
                || cy > brushRect.y + brushRect.h
            );
            if (intersects) selected.add(cellId);
        });
        setSelectedCells(selected);
        if (brushOnChange) {
            const coords = Array.from(selected).map(id => {
                const idx = id.indexOf(":");
                return { row: id.slice(0, idx), column: id.slice(idx + 1) };
            });
            queueMicrotask(() => brushOnChange(coords));
        }
        setBrushOrigin(null);
        setBrushRect(null);
    }, [brushEnabled, brushRect, brushOnChange]);

    const handleCellClick = useCallback((rowKey: string, columnKey: string) => {
        if (onCellClick) {
            queueMicrotask(() => onCellClick({ row: rowKey, column: columnKey }));
        }
    }, [onCellClick]);

    const columns = value.columns;
    const rows = value.rows;
    const gridTemplateColumns = `${rowHeaderWidth} repeat(${columns.length}, 1fr)`;

    const headerBg = headerBackground ?? "gray.50";
    const headerFg = headerColor ?? "gray.700";

    const grid = (
        <Box
            position="relative"
            overflow="auto"
            border={showGridLines ? `1px solid ${gridColor}` : undefined}
            borderRadius="md"
            background="white"
            boxShadow="sm"
        >
            <Grid
                ref={gridRef}
                templateColumns={gridTemplateColumns}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                userSelect="none"
                role="grid"
            >
                {/* Top-left corner (sticky) */}
                <Box
                    position="sticky"
                    left={0}
                    top={0}
                    zIndex={3}
                    height={columnHeaderHeight}
                    background={headerBg}
                    color={headerFg}
                    borderRight={showGridLines ? `1px solid ${gridColor}` : undefined}
                    borderBottom={showGridLines ? `1px solid ${gridColor}` : undefined}
                />

                {/* Column headers */}
                {columns.map((col, i) => (
                    <Box
                        key={`colhdr-${col.key}`}
                        position="sticky"
                        top={0}
                        zIndex={2}
                        height={columnHeaderHeight}
                        background={headerBg}
                        color={headerFg}
                        px={sizePreset.headerPad}
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        fontSize={sizePreset.fontSize}
                        fontWeight="semibold"
                        borderRight={showGridLines && i < columns.length - 1 ? `1px solid ${gridColor}` : undefined}
                        borderBottom={showGridLines ? `1px solid ${gridColor}` : undefined}
                        role="columnheader"
                    >
                        {col.header ? (
                            <EastChakraComponent
                                value={getSomeorUndefined(col.header)!}
                                storageKey={`${storageKey}.col.${col.key}`}
                            />
                        ) : col.key}
                    </Box>
                ))}

                {/* Rows */}
                {rows.map(row => (
                    <>
                        {/* Row header — sticky left */}
                        <Box
                            key={`rowhdr-${row.key}`}
                            position="sticky"
                            left={0}
                            zIndex={1}
                            height={sizePreset.cellHeight}
                            background={headerBg}
                            color={headerFg}
                            px={sizePreset.headerPad}
                            display="flex"
                            alignItems="center"
                            fontSize={sizePreset.fontSize}
                            fontWeight="medium"
                            borderRight={showGridLines ? `1px solid ${gridColor}` : undefined}
                            borderBottom={showGridLines ? `1px solid ${gridColor}` : undefined}
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
                        {columns.map((col, colIdx) => {
                            const cell = row.cells.find(c => c.columnKey === col.key);
                            const cellId = `${row.key}:${col.key}`;
                            const segments = cell?.segments ?? [];
                            const totalWeight = segments.reduce((a, s) => a + s.value, 0) || 1;
                            const emphasis = cell ? getSomeorUndefined(cell.emphasis) : undefined;
                            const emphasisColor = cell ? getSomeorUndefined(cell.emphasisColor) : undefined;
                            const note = cell ? getSomeorUndefined(cell.note) : undefined;
                            const overlays = cell?.overlays ?? [];
                            const isSelected = selectedCells.has(cellId);

                            return (
                                <Box
                                    key={cellId}
                                    data-cell-id={cellId}
                                    role="gridcell"
                                    position="relative"
                                    height={sizePreset.cellHeight}
                                    background={cellBackground ?? "white"}
                                    borderRight={showGridLines && colIdx < columns.length - 1 ? `1px solid ${gridColor}` : undefined}
                                    borderBottom={showGridLines ? `1px solid ${gridColor}` : undefined}
                                    cursor={onCellClick ? "pointer" : brushEnabled ? "crosshair" : "default"}
                                    transition="background 0.15s"
                                    {...(onCellClick ? { _hover: { background: "gray.50" } } : {})}
                                    {...(note !== undefined ? { title: note } : {})}
                                    onClick={() => handleCellClick(row.key, col.key)}
                                    {...((emphasis || isSelected) ? {
                                        outline: `2px solid ${emphasisColor ?? "var(--chakra-colors-blue-400)"}`,
                                        outlineOffset: "-2px",
                                    } : {})}
                                >
                                    {/* Segment fill */}
                                    {segments.length > 0 && (
                                        <HStack gap={0} height="100%" width="100%">
                                            {segments.map((seg, i) => (
                                                <Box
                                                    key={i}
                                                    height="100%"
                                                    flex={seg.value / totalWeight}
                                                    background={getSomeorUndefined(seg.color) ?? "blue.400"}
                                                />
                                            ))}
                                        </HStack>
                                    )}

                                    {/* Overlays */}
                                    {overlays.map((o, i) => (
                                        <Box
                                            key={`ov-${i}`}
                                            position="absolute"
                                            style={POSITION_STYLE[o.position.type] ?? POSITION_STYLE.tl!}
                                            fontSize={sizePreset.fontSize}
                                        >
                                            <EastChakraComponent
                                                value={o.content}
                                                storageKey={`${storageKey}.cell.${cellId}.overlay.${i}`}
                                            />
                                        </Box>
                                    ))}
                                </Box>
                            );
                        })}
                    </>
                ))}
            </Grid>

            {/* Brush selection rectangle */}
            {brushRect && (
                <Box
                    position="absolute"
                    left={`${brushRect.x}px`}
                    top={`${brushRect.y}px`}
                    width={`${brushRect.w}px`}
                    height={`${brushRect.h}px`}
                    background="blue.400"
                    opacity={0.15}
                    border="1px dashed"
                    borderColor="blue.500"
                    pointerEvents="none"
                    zIndex={10}
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

    if (legendPosition === "top") {
        return <Box>{legend}{grid}</Box>;
    }
    if (legendPosition === "bottom" || !legend) {
        return <Box>{grid}{legend}</Box>;
    }
    if (legendPosition === "left") {
        return <HStack gap="3" align="flex-start"><Box>{legend}</Box>{grid}</HStack>;
    }
    return <HStack gap="3" align="flex-start">{grid}<Box>{legend}</Box></HStack>;
}, (prev, next) => matrixRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
