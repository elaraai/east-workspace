/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Popover, Portal, Tooltip, useSlotRecipe } from "@chakra-ui/react";
import {
    useReactTable, getCoreRowModel, createColumnHelper,
    type ColumnDef, type ColumnSizingState, type Updater,
} from "@tanstack/react-table";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCircleCheck, faTriangleExclamation, faCircleXmark, faCircleInfo, faCircle,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Matrix } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { EastChakraComponent } from "../../component";
import {
    getHeaderCellStyle, getCellStyle, useColumnSizeVars, ColumnResizeHandle, ColumnDividerBar,
} from "../shared/column-pinning";
import { useDensityHeights } from "../shared/helpers";
import { DensityProvider } from "../../contracts/density";
import { usePlotGutter } from "../../contracts/plot-gutter.js";

const matrixRootEqual = equalFor(Matrix.Types.Root);

/** East Matrix root value (the `Matrix` variant's data). */
export type MatrixRootValue = ValueTypeOf<typeof Matrix.Types.Root>;
/** East Matrix row value. */
export type MatrixRowValue = ValueTypeOf<typeof Matrix.Types.Row>;
/** East Matrix column value. */
export type MatrixColumnValue = ValueTypeOf<typeof Matrix.Types.Column>;
/** East Matrix cell value. */
export type MatrixCellValue = ValueTypeOf<typeof Matrix.Types.Cell>;
/** East Matrix segment value. */
export type MatrixSegmentValue = ValueTypeOf<typeof Matrix.Types.Segment>;
/** East Matrix marker value. */
export type MatrixMarkerValue = ValueTypeOf<typeof Matrix.Types.Marker>;

export interface EastChakraMatrixProps {
    /** The Matrix root value. */
    value: MatrixRootValue;
    /** Storage key for persisting layout state. Omit for ephemeral state. */
    storageKey: string;
}

/** Persisted left-pane layout — the row-header column width. */
interface MatrixPersistedState {
    columnSizing: ColumnSizingState;
}

type RecipeStyles = Record<string, Record<string, unknown>>;
type FillKey = "brand" | "success" | "warning" | "danger" | "info" | "neutral" | "slack" | "free";
type StatusKey = "success" | "warning" | "danger" | "info" | "neutral";
type Orientation = "horizontal" | "vertical";

const FILLS: FillKey[] = ["brand", "success", "warning", "danger", "info", "neutral", "slack", "free"];
const STATUSES: StatusKey[] = ["success", "warning", "danger", "info", "neutral"];
const ORIENTATIONS: Orientation[] = ["horizontal", "vertical"];

/** Status tag → paired FontAwesome icon — mirrors the shared `feedback/status`
 *  PAIRED_ICONS so a Matrix marker reads the same as a Status elsewhere. */
const STATUS_ICON: Record<string, IconDefinition> = {
    success: faCircleCheck,
    warning: faTriangleExclamation,
    danger:  faCircleXmark,
    info:    faCircleInfo,
    neutral: faCircle,
};

/** The density → recipe `size` mapping (mirrors Table / Gantt / Planner). */
function sizeFromDensity(value: MatrixRootValue): "sm" | "md" | "lg" {
    const d = getSomeorUndefined(value.density)?.type;
    if (d === "compact") return "sm";
    if (d === "comfortable") return "lg";
    return "md";
}

/** Extract the plain text of an optional `LabelInput`. */
function labelText(opt: MatrixColumnValue["label"]): string | undefined {
    const li = getSomeorUndefined(opt);
    return li ? li.value : undefined;
}

// ============================================================================
// Segment bar — the weighted track (horizontal weight bar / vertical capacity).
// ============================================================================

interface SegmentBarProps {
    segments: readonly MatrixSegmentValue[];
    orientation: Orientation;
    barStyle: Record<string, unknown>;
    segByFill: Record<FillKey, Record<string, unknown>>;
    segLabelStyle: Record<string, unknown>;
    resizeHandleStyle: Record<string, unknown>;
    minLabelSizePx: number;
    onResize?: ((e: React.PointerEvent, segmentIndex: number, total: number, extentPx: number) => void) | undefined;
}

function SegmentBar({ segments, orientation, barStyle, segByFill, segLabelStyle, resizeHandleStyle, minLabelSizePx, onResize }: SegmentBarProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [extent, setExtent] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => {
            const r = el.getBoundingClientRect();
            setExtent(orientation === "vertical" ? r.height : r.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [orientation]);

    const total = segments.reduce((a, s) => a + s.weight, 0) || 1;
    return (
        <Box ref={ref} css={barStyle} data-slot="bar">
            {segments.map((seg, i) => {
                const pct = (seg.weight / total) * 100;
                const segExtentPx = (extent * pct) / 100;
                const fill = seg.fill.type as FillKey;
                const colorOverride = getSomeorUndefined(seg.color);
                const text = labelText(seg.label);
                const showLabel = text !== undefined && (minLabelSizePx <= 0 || segExtentPx === 0 || segExtentPx >= minLabelSizePx);
                const resizable = onResize !== undefined && i < segments.length - 1;
                const segCss: Record<string, unknown> = {
                    ...segByFill[fill],
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: `${pct}%`,
                    ...(colorOverride !== undefined ? { background: colorOverride } : {}),
                };
                return (
                    <Box key={i} css={segCss} data-slot="seg" data-fill={fill}>
                        {showLabel && <Box as="span" css={segLabelStyle} data-slot="segLabel">{text}</Box>}
                        {resizable && (
                            <Box
                                css={resizeHandleStyle}
                                data-slot="resizeHandle"
                                onPointerDown={(e) => onResize!(e, i, total, extent)}
                            />
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}

// ============================================================================
// Cell — segment bar (or free slot) + status markers + click popover.
// ============================================================================

interface MatrixCellProps {
    cell: MatrixCellValue;
    rowKey: string;
    columnKey: string;
    rootOrientation: Orientation;
    storageKey: string;
    minLabelSizePx: number;
    barStyles: Record<Orientation, Record<string, unknown>>;
    segStyles: Record<Orientation, Record<FillKey, Record<string, unknown>>>;
    segLabelStyle: Record<string, unknown>;
    resizeHandleStyle: Record<string, unknown>;
    statusStyles: Record<StatusKey, RecipeStyles>;
    markerInset: string;
    onCellClick?: ((e: { row: string; column: string }) => void) | undefined;
    onSegmentClick?: ((e: { row: string; column: string; segmentIndex: bigint; fill: MatrixSegmentValue["fill"] }) => void) | undefined;
    onSegmentChange?: ((e: { row: string; column: string; segmentIndex: bigint; weight: number }) => void) | undefined;
}

function cornerOffset(at: string, inset: string): Record<string, unknown> {
    const top = at === "tl" || at === "tr" ? inset : "auto";
    const bottom = at === "bl" || at === "br" ? inset : "auto";
    const left = at === "tl" || at === "bl" ? inset : "auto";
    const right = at === "tr" || at === "br" ? inset : "auto";
    return { top, bottom, left, right };
}

function MatrixCell({
    cell, rowKey, columnKey, rootOrientation, storageKey, minLabelSizePx,
    barStyles, segStyles, segLabelStyle, resizeHandleStyle, statusStyles, markerInset,
    onCellClick, onSegmentClick, onSegmentChange,
}: MatrixCellProps) {
    const orientation: Orientation = getSomeorUndefined(cell.orientation)?.type === "vertical" ? "vertical" : rootOrientation;
    const slot = getSomeorUndefined(cell.slot);
    const popover = getSomeorUndefined(cell.popover);
    const segments = cell.segments;
    const markers = cell.markers;

    // Segment drag-resize — fires onSegmentChange with the dragged slice's new
    // weight (snapped + clamped). The bar's measured extent maps px → weight.
    const handleResize = useCallback((e: React.PointerEvent, segmentIndex: number, total: number, extentPx: number) => {
        if (!onSegmentChange || extentPx <= 0) return;
        e.stopPropagation();
        e.preventDefault();
        const seg = segments[segmentIndex];
        if (!seg) return;
        const startWeight = seg.weight;
        const min = getSomeorUndefined(seg.min) ?? 0;
        const max = getSomeorUndefined(seg.max) ?? total;
        const step = getSomeorUndefined(seg.step) ?? 0;
        const start = orientation === "vertical" ? e.clientY : e.clientX;
        const move = (me: PointerEvent) => {
            const cur = orientation === "vertical" ? me.clientY : me.clientX;
            const delta = orientation === "vertical" ? start - cur : cur - start;
            let next = startWeight + (delta / extentPx) * total;
            next = Math.max(min, Math.min(max, next));
            if (step > 0) next = Math.round(next / step) * step;
            queueMicrotask(() => onSegmentChange({ row: rowKey, column: columnKey, segmentIndex: BigInt(segmentIndex), weight: next }));
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [onSegmentChange, segments, orientation, rowKey, columnKey]);

    const segClick = onSegmentClick !== undefined;
    const body = slot !== undefined
        ? <EastChakraComponent value={slot} storageKey={`${storageKey}.slot`} />
        : (
            <SegmentBar
                segments={segments}
                orientation={orientation}
                barStyle={barStyles[orientation]}
                segByFill={segStyles[orientation]}
                segLabelStyle={segLabelStyle}
                resizeHandleStyle={resizeHandleStyle}
                minLabelSizePx={minLabelSizePx}
                onResize={onSegmentChange ? handleResize : undefined}
            />
        );

    const clickable = popover === undefined && (onCellClick !== undefined || segClick);
    const bodyBox = (
        <Box
            flex="1"
            minW={0}
            display="flex"
            alignItems="center"
            width="100%"
            height="100%"
            cursor={clickable ? "pointer" : undefined}
            onClick={clickable ? () => {
                if (onCellClick) onCellClick({ row: rowKey, column: columnKey });
                if (onSegmentClick && segments.length > 0) {
                    onSegmentClick({ row: rowKey, column: columnKey, segmentIndex: 0n, fill: segments[0]!.fill });
                }
            } : undefined}
        >
            {body}
        </Box>
    );

    const ringStatus = markers.length > 0 ? (markers[0]!.status.type as StatusKey) : undefined;
    const ringStyle = ringStatus ? (statusStyles[ringStatus] ?? statusStyles.info).markerRing : undefined;

    return (
        <>
            {popover !== undefined ? (
                <Popover.Root positioning={{ placement: "top" }}>
                    <Popover.Trigger asChild>
                        <Box flex="1" minW={0} display="flex" alignItems="center" width="100%" height="100%" cursor="pointer">{body}</Box>
                    </Popover.Trigger>
                    <Portal>
                        <Popover.Positioner>
                            <Popover.Content padding="14px 16px" minW="240px" maxW="360px" fontSize="13px">
                                <Popover.Body padding={0}>
                                    <EastChakraComponent value={popover} storageKey={`${storageKey}.popover`} />
                                </Popover.Body>
                            </Popover.Content>
                        </Popover.Positioner>
                    </Portal>
                </Popover.Root>
            ) : bodyBox}

            {ringStyle && <Box css={ringStyle} data-slot="markerRing" />}
            {markers.map((m, mi) => {
                const ms = statusStyles[m.status.type as StatusKey] ?? statusStyles.info;
                const badge = getSomeorUndefined(m.label);
                const iconCss = { ...ms.markerIcon, ...cornerOffset(m.at.type, markerInset) };
                return (
                    <Tooltip.Root key={mi} openDelay={150}>
                        <Tooltip.Trigger asChild>
                            <Box css={iconCss} data-slot="markerIcon">
                                {badge !== undefined
                                    ? badge
                                    : <FontAwesomeIcon icon={STATUS_ICON[m.status.type] ?? faCircleInfo} />}
                            </Box>
                        </Tooltip.Trigger>
                        <Portal>
                            <Tooltip.Positioner>
                                <Tooltip.Content>{m.message}</Tooltip.Content>
                            </Tooltip.Positioner>
                        </Portal>
                    </Tooltip.Root>
                );
            })}
        </>
    );
}

// ============================================================================
// Main renderer
// ============================================================================

const ROW_HEADER_DEFAULT = 180;

/** Renders an East Matrix value as a CSS-grid of status-coloured segment bars. */
export const EastChakraMatrix = memo(function EastChakraMatrix({ value, storageKey }: EastChakraMatrixProps) {
    const densityTag = getSomeorUndefined(value.density)?.type;
    const size = sizeFromDensity(value);
    const recipe = useSlotRecipe({ key: "matrix" });
    const tableRecipe = useSlotRecipe({ key: "table" });
    const sliceRecipe = useSlotRecipe({ key: "sliceFrame" });
    const base = useMemo(() => recipe({ size }) as unknown as RecipeStyles, [recipe, size]);
    // The header cells reuse the shared `table` columnHeader chrome (solid wash +
    // strong bottom rule), identical to Table / Gantt — one source, three views.
    const headerCellStyle = useMemo(() => (tableRecipe({ size }) as unknown as RecipeStyles).columnHeader ?? {}, [tableRecipe, size]);
    // The legend reuses the Slice.Legend rail + item slots (the same swatch · label
    // chips), so a Matrix legend reads identically to a Slice breakdown legend.
    const sliceStyles = useMemo(() => sliceRecipe() as unknown as RecipeStyles, [sliceRecipe]);
    const { header: headerH, row: unitH } = useDensityHeights(size);

    const rootOrientation: Orientation = value.orientation.type === "vertical" ? "vertical" : "horizontal";

    const cols = useMemo(
        () => value.columns.map((c) => ({ key: c.key, label: labelText(c.label) ?? c.key })),
        [value.columns],
    );
    const nCols = Math.max(cols.length, 1);

    // Resolve the per-orientation bar / cell / segment-by-fill styles, the
    // per-status marker styles, and the segment-label / handle slots up front —
    // every cell/segment picks from these maps (no per-element recipe calls).
    const barStyles = useMemo(() => {
        const out = {} as Record<Orientation, Record<string, unknown>>;
        for (const o of ORIENTATIONS) out[o] = (recipe({ size, orientation: o } as Record<string, unknown>) as unknown as RecipeStyles).bar ?? {};
        return out;
    }, [recipe, size]);
    const cellStyles = useMemo(() => {
        const out = {} as Record<Orientation, Record<string, unknown>>;
        for (const o of ORIENTATIONS) out[o] = (recipe({ size, orientation: o } as Record<string, unknown>) as unknown as RecipeStyles).cell ?? {};
        return out;
    }, [recipe, size]);
    const segStyles = useMemo(() => {
        const out = {} as Record<Orientation, Record<FillKey, Record<string, unknown>>>;
        for (const o of ORIENTATIONS) {
            const byFill = {} as Record<FillKey, Record<string, unknown>>;
            for (const f of FILLS) byFill[f] = (recipe({ size, orientation: o, fill: f } as Record<string, unknown>) as unknown as RecipeStyles).seg ?? {};
            out[o] = byFill;
        }
        return out;
    }, [recipe, size]);
    const statusStyles = useMemo(() => {
        const out = {} as Record<StatusKey, RecipeStyles>;
        for (const s of STATUSES) out[s] = recipe({ size, status: s } as Record<string, unknown>) as unknown as RecipeStyles;
        return out;
    }, [recipe, size]);
    const markerInset = (base.markerIcon?.top as string) ?? "3px";

    // Deterministic row height (mirrors the density row/header heights): the
    // density row height, raised to fit the orientation's bar + its cell
    // padding, then extended by one line when the row header carries a
    // sublabel. Keeps heights fixed and gives the vertical bar equal inset on
    // every side. Every layout value is read back from the recipe.
    const hasSublabel = useMemo(
        () => value.rows.some((r) => getSomeorUndefined(r.sublabel) !== undefined),
        [value.rows],
    );
    const cellPadY = parseInt((base.cell?.padding as string) ?? "8", 10) || 8;
    const barH = parseInt((barStyles[rootOrientation]?.height as string) ?? "24", 10) || 24;
    const subLineH = Math.round((parseInt((base.rowHeaderSub?.fontSize as string) ?? "10", 10) || 10) * 1.4)
        + (parseInt((base.rowHeaderSub?.marginTop as string) ?? "2", 10) || 2);
    const rowH = Math.max(unitH, barH + 2 * cellPadY) + (hasSublabel ? subLineH : 0);

    const minLabelSizePx = useMemo(() => {
        const raw = getSomeorUndefined(value.minLabelSize);
        return raw === undefined ? 0 : Math.round(raw);
    }, [value.minLabelSize]);

    const onCellClick = useMemo(() => getSomeorUndefined(value.onCellClick), [value.onCellClick]);
    const onSegmentClick = useMemo(() => getSomeorUndefined(value.onSegmentClick), [value.onSegmentClick]);
    const onSegmentChange = useMemo(() => getSomeorUndefined(value.onSegmentChange), [value.onSegmentChange]);

    // ── Left pane — a single resizable row-header column (Table chrome). ──────
    const columnHelper = useMemo(() => createColumnHelper<MatrixRowValue>(), []);
    const hasFrozen = false;
    const rowHeaderLabel = getSomeorUndefined(value.rowHeader) ?? "";
    const columns = useMemo<ColumnDef<MatrixRowValue, string>[]>(() => [
        columnHelper.accessor((row) => row.value, {
            id: "__rowheader__",
            header: rowHeaderLabel,
            enableSorting: false,
            size: ROW_HEADER_DEFAULT,
            minSize: 80,
            meta: { columnKey: "__rowheader__", width: `${ROW_HEADER_DEFAULT}px` },
        }),
    ], [columnHelper, rowHeaderLabel]);

    const { state: persistedState, setState: setPersistedState } = usePersistedState<MatrixPersistedState>(
        storageKey, { columnSizing: {} },
    );
    const columnSizing = persistedState.columnSizing;
    const setColumnSizing = useCallback((updater: Updater<ColumnSizingState>) => {
        setPersistedState((prev) => ({
            ...prev,
            columnSizing: typeof updater === "function" ? updater(prev.columnSizing) : updater,
        }));
    }, [setPersistedState]);

    const table = useReactTable({
        data: value.rows,
        columns,
        state: { columnSizing },
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        enableSorting: false,
        enableColumnResizing: true,
        columnResizeMode: "onChange",
    });
    const columnSizeVars = useColumnSizeVars(table);
    const headerCells = table.getHeaderGroups()[0]?.headers ?? [];

    const leftPaneWidth = `${table.getTotalSize()}px`;
    const colMin = "90px";
    const colMinPx = 90;
    const slotTemplate = `repeat(${nCols}, minmax(${colMin}, 1fr))`;
    const gridMinWidth = `calc(${leftPaneWidth} + ${nCols * colMinPx}px)`;
    const stickyLeft = { position: "sticky" as const, left: 0, zIndex: 1, background: "bg.surface" };
    const stickyLeftHeader = { ...stickyLeft, zIndex: 2, background: "bg.panel" };

    // Shared plot gutter (#147) — own field wins over an enclosing <AlignedStack>'s
    // context. When active the value-grid is pinned to [left, W−right]: the
    // row-header pane becomes `left` (overriding its resizable width), the outer
    // row grid gains a trailing right-gutter track, columns fill flush (minmax 0),
    // and horizontal scroll is dropped so the lane is exactly the container width.
    const ctxGutter = usePlotGutter();
    const ownGutter = useMemo(() => getSomeorUndefined(value.plotGutter), [value.plotGutter]);
    const gLeft = (ownGutter ? getSomeorUndefined(ownGutter.left) : undefined) ?? ctxGutter?.left;
    const gRight = (ownGutter ? getSomeorUndefined(ownGutter.right) : undefined) ?? ctxGutter?.right;
    const gutterActive = gLeft !== undefined || gRight !== undefined;
    const rightCol = gRight ?? "0px";
    const effectiveLeftPane = gLeft ?? leftPaneWidth;
    // When `left` pins the header pane, override the TanStack size vars so the
    // inner cells match the outer track (otherwise the 180px cell overflows `left`).
    const effectiveSizeVars = gLeft !== undefined
        ? { ...columnSizeVars, "--col-__rowheader__-size": gLeft, "--header-__rowheader__-size": gLeft }
        : columnSizeVars;
    const outerCols = gutterActive ? `${effectiveLeftPane} 1fr ${rightCol}` : `${leftPaneWidth} 1fr`;
    const rightCols = gutterActive ? `repeat(${nCols}, minmax(0, 1fr))` : slotTemplate;
    const outerMinWidth = gutterActive ? undefined : gridMinWidth;

    const legendEntries = getSomeorUndefined(value.legend);

    const groups = useMemo(() => {
        const out: { label: string | undefined; rows: { row: MatrixRowValue; index: number }[] }[] = [];
        value.rows.forEach((row, index) => {
            const g = getSomeorUndefined(row.group);
            const last = out[out.length - 1];
            if (last && last.label === g) last.rows.push({ row, index });
            else out.push({ label: g, rows: [{ row, index }] });
        });
        return out;
    }, [value.rows]);

    const matrixContent = (
        <Box css={base.root} {...(gutterActive ? { width: "100%" } : {})}>
            {/* Header: the row-header column header (corner) + the column axis. */}
            <Box css={base.header} data-slot="header" display="grid" gridTemplateColumns={outerCols} minWidth={outerMinWidth} height={`${headerH}px`}>
                <Box css={stickyLeftHeader} display="flex" width="100%" style={effectiveSizeVars}>
                    {headerCells.map((header) => (
                        <Box
                            key={header.id}
                            css={headerCellStyle}
                            data-slot="colHeader"
                            position="relative"
                            display="flex"
                            alignItems="center"
                            style={getHeaderCellStyle(header, hasFrozen, columnSizing, false)}
                        >
                            <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" minW={0}>
                                {header.column.columnDef.header as string}
                            </Box>
                            <ColumnResizeHandle header={header} />
                        </Box>
                    ))}
                </Box>
                <Box display="grid" gridTemplateColumns={rightCols}>
                    {cols.map((c, ci) => (
                        <Box
                            key={c.key}
                            css={{ ...headerCellStyle, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}
                            data-slot="headerCell"
                        >
                            {c.label}
                            {ci < cols.length - 1 && <ColumnDividerBar />}
                        </Box>
                    ))}
                </Box>
            </Box>

            {/* Body: group-head rows + data rows. */}
            {groups.map((group, gi) => (
                <Box key={gi}>
                    {group.label !== undefined && (
                        <Box css={base.groupHead} data-slot="groupHead" minWidth={outerMinWidth} display="grid" gridTemplateColumns={outerCols}>
                            <Box css={{ ...stickyLeft, ...base.groupHeadCell, background: "bg.panel" }} data-slot="groupHeadCell">{group.label}</Box>
                        </Box>
                    )}
                    {group.rows.map(({ row, index }) => (
                        <Box
                            key={index}
                            css={base.row}
                            position="relative"
                            display="grid"
                            gridTemplateColumns={outerCols}
                            minWidth={outerMinWidth}
                        >
                            {/* Left pane — the single row-header column. */}
                            <Box css={stickyLeft} display="flex" width="100%" style={effectiveSizeVars}>
                                {table.getVisibleLeafColumns().map((column) => {
                                    const sub = getSomeorUndefined(row.sublabel);
                                    return (
                                        <Box
                                            key={column.id}
                                            css={base.rowHeader}
                                            data-slot="rowHeader"
                                            style={getCellStyle({ column }, hasFrozen, columnSizing, false)}
                                        >
                                            <Box css={base.rowHeaderName} data-slot="rowHeaderName">{row.value}</Box>
                                            {sub !== undefined && <Box css={base.rowHeaderSub} data-slot="rowHeaderSub">{sub}</Box>}
                                        </Box>
                                    );
                                })}
                            </Box>
                            {/* Right pane — the cell grid. */}
                            <Box display="grid" gridTemplateColumns={rightCols}>
                                {cols.map((c, ci) => {
                                    const cell = row.cells.get(c.key);
                                    const orientation: Orientation = cell
                                        ? (getSomeorUndefined(cell.orientation)?.type === "vertical" ? "vertical" : rootOrientation)
                                        : rootOrientation;
                                    let cellCss: Record<string, unknown> = { ...cellStyles[orientation], height: `${rowH}px` };
                                    if (ci === cols.length - 1) cellCss = { ...cellCss, borderRightWidth: "0" };
                                    return (
                                        <Box key={c.key} data-slot="cell" css={cellCss}>
                                            {cell && (
                                                <MatrixCell
                                                    cell={cell}
                                                    rowKey={row.key}
                                                    columnKey={c.key}
                                                    rootOrientation={rootOrientation}
                                                    storageKey={`${storageKey}.${row.key}.${c.key}`}
                                                    minLabelSizePx={minLabelSizePx}
                                                    barStyles={barStyles}
                                                    segStyles={segStyles}
                                                    segLabelStyle={base.segLabel ?? {}}
                                                    resizeHandleStyle={base.resizeHandle ?? {}}
                                                    statusStyles={statusStyles}
                                                    markerInset={markerInset}
                                                    onCellClick={onCellClick}
                                                    onSegmentClick={onSegmentClick}
                                                    onSegmentChange={onSegmentChange}
                                                />
                                            )}
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>
                    ))}
                </Box>
            ))}

            {/* Legend — reuses the Slice.Legend rail + item slots (one swatch ·
                label chip per declared fill), so it reads like a Slice breakdown
                legend. The grid's last-row rule already separates it above. */}
            {legendEntries && legendEntries.length > 0 && (
                <Box css={sliceStyles.legendRail} data-slot="legend" borderTopWidth="1px" borderTopColor="border.subtle">
                    {legendEntries.map((entry, li) => {
                        const fill = entry.fill.type as FillKey;
                        // Chakra wraps recipe slot styles in an `@layer recipes`
                        // block; pull the inner resolved fill colour/hatch out and
                        // apply it as the swatch `background` prop (over the shared
                        // Slice swatch shape) — exactly how Slice.Legend does it.
                        const segInner = ((segStyles.horizontal[fill] as Record<string, unknown>)["@layer recipes"] ?? segStyles.horizontal[fill] ?? {}) as Record<string, unknown>;
                        return (
                            <Box as="span" key={li} css={sliceStyles.legendItem} cursor="default" data-slot="legendItem">
                                <Box
                                    as="span"
                                    css={sliceStyles.legendSwatch}
                                    data-slot="legendSwatch"
                                    {...(segInner.background ? { background: segInner.background as string } : {})}
                                    {...(segInner.backgroundImage ? { backgroundImage: segInner.backgroundImage as string } : {})}
                                    {...(fill === "free" ? { borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle" } : {})}
                                />
                                <Box as="span" css={sliceStyles.legendLabel} data-slot="legendLabel">{entry.label}</Box>
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );

    // A density set on the matrix cascades to display components rendered in
    // its cells, matching the Table behaviour.
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{matrixContent}</DensityProvider>
        : matrixContent;
}, (prev, next) => matrixRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
