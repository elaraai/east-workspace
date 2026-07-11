/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useRef, useState, useEffect, useCallback } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
    Table as ChakraTable,
    Box,
    Text,
    Skeleton,
    Splitter,
    useToken,
    useSlotRecipe,
    type TableRootProps,
} from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    createColumnHelper,
    type SortingState,
    type ColumnResizeMode,
    type ColumnDef,
} from "@tanstack/react-table";
import { compareFor, equalFor, printFor, variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { Gantt, Table, Slice as SliceInternal, type UIComponentType } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../slice/rail";
import { parseCssSize } from "../../style/parse-size.js";
import { syncedPaneScrollbarCss, virtualScrollbarCss } from "../../style/scrollbar.js";
import { brushHitTest, brushDragWindow, brushRelease, brushCursor, type BrushDrag } from "../../slice/brush-math.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { useRowStatusBg, useDensityHeights } from "../shared/helpers";
import { useReviewController, DecisionButtons, ReviewFoot, DECISION_WIDTH } from "../shared/review";
import { useDragTarget, useDropCell, type DragEventValue, type DragMeta, type DragPayload, type CellCoord } from "../../dnd/drag-layer";
import { canDropAllows, candidateEvent, type CanDropFn } from "../../dnd/ir-can-drop";
import { DensityProvider } from "../../contracts/density";
import { usePlotGutter, gutterPx } from "../../contracts/plot-gutter.js";
import { RowStateManager, type RowKey, type RowState } from "../../utils/RowStateManager";
import { useColumnPinning, HeaderControls, getHeaderCellStyle, getCellStyle, createGetSortIndex, useColumnSizeVars, useLastUnpinnedColumnId } from "../shared/column-pinning";
import { EventAxis, tierInterval, type GanttTier } from "./EventAxis";
import { scaleTime } from "@visx/scale";
import { GanttEventRow, type GanttTaskValue, type GanttMilestoneValue } from "./GanttEventRow";
import { snapToStep as snapDateToStep, timeStepToMs as timeStepMs } from "./GanttTask";

// Pre-define equality function at module level
const ganttRootEqual = equalFor(Gantt.Types.Root);

// Parse CSS size values to pixels (simple numeric extraction)
const parseSize = (val: string | undefined, defaultVal: number): number => {
    if (!val) return defaultVal;
    const num = parseInt(val, 10);
    return isNaN(num) ? defaultVal : num;
};

/** East Gantt Root value type */
export type GanttRootValue = ValueTypeOf<typeof Gantt.Types.Root>;

/** East Gantt Column value type */
export type GanttColumnValue = ValueTypeOf<typeof Gantt.Types.Column>;

/** East Gantt Cell value type */
export type GanttCellValue = ValueTypeOf<typeof Gantt.Types.Cell>;

/** East Gantt Row value type */
export type GanttRowValue = ValueTypeOf<typeof Gantt.Types.Row>;

/** Cell Render Context value type */
type TableCellRenderContextValue = ValueTypeOf<typeof Table.Types.CellRenderContext>;

/** Column render function type */
type ColumnRenderFn = (ctx: TableCellRenderContextValue) => ValueTypeOf<UIComponentType>;

// Column sort types for external API
export type SortDirection = "asc" | "desc";
export interface ColumnSort {
    columnKey: string;
    direction: SortDirection;
}

// Extend TanStack Table's ColumnMeta for our custom properties
declare module "@tanstack/react-table" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData, TValue> {
        print?: (value: unknown) => string;
        columnKey?: string;
        width?: string | undefined;
        minWidth?: string | undefined;
        maxWidth?: string | undefined;
        renderFn?: ColumnRenderFn | undefined;
    }
}

/**
 * Converts an East UI Gantt Root value to Chakra UI TableRoot props.
 */
export function toChakraTableRoot(value: GanttRootValue): TableRootProps {
    const style = getSomeorUndefined(value.style);

    return {
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        size: style ? getSomeorUndefined(style.size)?.type : undefined,
        striped: style ? getSomeorUndefined(style.striped) : undefined,
        // `interactive` was dropped — row hover is now always on. Kept the
        // local variable name as `true` so downstream conditional rendering
        // continues to highlight rows on hover without per-instance opt-out.
        interactive: true as boolean | undefined,
        stickyHeader: style ? getSomeorUndefined(style.stickyHeader) : undefined,
        showColumnBorder: style ? getSomeorUndefined(style.showColumnBorder) : undefined,
    };
}

export interface EastChakraGanttProps {
    value: GanttRootValue;
    /** Height of the gantt container (required for virtualization) */
    height?: string | number;
    /** Estimated row height for virtualization */
    rowHeight?: number;
    /** Number of rows to render outside visible area */
    overscan?: number;
    /** Callback when sort changes */
    onSortChange?: (sorts: ColumnSort[]) => void;
    /** Enable multi-column sorting */
    enableMultiSort?: boolean;
    /** Maximum number of sort columns */
    maxSortColumns?: number;
    /** Loading delay before showing row content (ms) */
    loadingDelay?: number;
    /** Enable column resizing */
    enableColumnResizing?: boolean;
    /** Callback when a task is clicked (component-level prop, separate from East callbacks). */
    onTaskClick?: (task: GanttTaskValue, rowIndex: number, taskIndex: number) => void;
    /** Callback when a milestone is clicked (component-level prop, separate from East callbacks). */
    onMilestoneClick?: (milestone: GanttMilestoneValue, rowIndex: number, milestoneIndex: number) => void;
    /** Initial size of the table panel (0-100) */
    tablePanelSize?: number;
    /** Storage key for persisting sort/column/splitter state in localStorage. Omit for ephemeral state. */
    storageKey: string;
}

interface GanttPersistedState {
    sorting: SortingState;
    columnSizing: Record<string, number>;
    pinnedColumns: string[];
    tablePanelSize: number | null;
}

/**
 * Renders an East UI Gantt value using Chakra UI components.
 * Features:
 * - Row virtualization for large datasets
 * - Column sorting with multi-sort support
 * - Column resizing
 * - Resizable splitter between table and timeline
 * - SVG-based task and milestone rendering
 */
const GanttCore = function GanttCore({
    value,
    height = "100%",
    rowHeight = 36,
    overscan = 8,
    onSortChange,
    enableMultiSort = true,
    maxSortColumns = 5,
    loadingDelay = 200,
    enableColumnResizing = true,
    onTaskClick: _onTaskClickProp,
    onMilestoneClick: _onMilestoneClickProp,
    tablePanelSize: tablePanelSizeProp,
    storageKey,
    timelineBrush,
    timelineWindow,
}: EastChakraGanttProps & {
    /** Slice-chrome brush: drag a window on the timeline header to select a
     *  time range (`null` clears — a sub-threshold drag on empty track). */
    timelineBrush?: (range: { from: Date; to: Date } | null) => void;
    /** The applied slice range, rendered as the grabbable brush window on the
     *  timeline header (#192): drag its body to slide, an edge to resize. */
    timelineWindow?: { from: Date; to: Date } | undefined;
}) {
    const props = useMemo(() => toChakraTableRoot(value), [value]);

    // Track root container width for accurate splitter sizing
    const rootRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            if (entry) setContainerWidth(entry.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Extract East-side callbacks from style
    const style = getSomeorUndefined(value.style);

    // Shared plot gutter (#147) — own style field wins over an enclosing
    // <AlignedStack>'s context. When active the timeline is pinned to
    // [left, W−right]: the splitter's table panel is forced to `left` (so the
    // timeline panel starts at the chart's plot-left), the table columns shrink
    // to fit, and the x-scale range is inset by `right` so the time axis ends at
    // W−right. The splitter resize handle is hidden so the gutter stays put.
    const ctxGutter = usePlotGutter();
    const ownGutter = style ? getSomeorUndefined(style.plotGutter) : undefined;
    const gLeft = (ownGutter ? getSomeorUndefined(ownGutter.left) : undefined) ?? ctxGutter?.left;
    const gRight = (ownGutter ? getSomeorUndefined(ownGutter.right) : undefined) ?? ctxGutter?.right;
    const gutterActive = gLeft !== undefined || gRight !== undefined;
    const gLeftPx = gutterPx(gLeft);
    const gRightPx = gutterPx(gRight) ?? 0;

    const onCellClickFn = getSomeorUndefined(value.onCellClick);
    const onCellDoubleClickFn = getSomeorUndefined(value.onCellDoubleClick);
    const onRowClickFn = getSomeorUndefined(value.onRowClick);
    const onRowDoubleClickFn = getSomeorUndefined(value.onRowDoubleClick);
    const onSortChangeFn = getSomeorUndefined(value.onSortChange);
    const onTaskClickFn = getSomeorUndefined(value.onTaskClick);
    const onTaskDoubleClickFn = getSomeorUndefined(value.onTaskDoubleClick);
    // The shared drag grammar (#268): ONE funnel for Library adds, task-body
    // moves, and edge resizes. The bespoke per-gesture callbacks are retired.
    const onDragFn = getSomeorUndefined(value.onDrag);
    const canDropFn = useMemo(() => getSomeorUndefined(value.canDrop) as CanDropFn | undefined, [value.canDrop]);
    const targetId = value.id;
    const onTaskProgressChangeFn = getSomeorUndefined(value.onTaskProgressChange);
    const onMilestoneClickFn = getSomeorUndefined(value.onMilestoneClick);
    const onMilestoneDoubleClickFn = getSomeorUndefined(value.onMilestoneDoubleClick);
    const dragStepValue = getSomeorUndefined(value.dragStep);
    const durationStepValue = getSomeorUndefined(value.durationStep);

    // Density preset → row + header height (mirrors the Table's mapping:
    // compact → sm, comfortable → lg, everything else → md). Body rows are
    // taller than the Table's to hold the bars; the HEADER band is identical
    // to the Table's column-header row (same recipe + same height) so the
    // left pane reads as one component with a Table.
    const densityTag = (style ? getSomeorUndefined(style.density) : undefined)?.type;
    const ganttSize: "sm" | "md" | "lg" = densityTag === "compact" ? "sm"
        : densityTag === "comfortable" ? "lg"
        : "md";
    // Row + header height come from the SAME shared density tokens the Table
    // consumes (`useDensityHeights`), so a Gantt row is exactly a Table row.
    const { header: headerHeight, row: densityRowHeight } = useDensityHeights(ganttSize);
    // An explicit pixel `rowHeight` (IR) wins over the density preset; else the
    // density token; else the JS `rowHeight` prop. Gantt is fixed-height (no
    // measureElement) so this estimate flows cleanly to both panes + bars (#127).
    const rowHeightOverride = style ? getSomeorUndefined(style.rowHeight) : undefined;
    const explicitRowHeight = rowHeightOverride !== undefined ? Number(rowHeightOverride) : undefined;
    const effectiveRowHeight = explicitRowHeight ?? (densityTag ? densityRowHeight : rowHeight);
    const ganttSlotStyles = useSlotRecipe({ key: "gantt" })({ size: ganttSize });
    // The left pane IS a Table — consume the SAME `table` columnHeader slot so
    // the header font/size/padding are identical to the Table component.
    const tableSlotStyles = useSlotRecipe({ key: "table" })({ size: ganttSize });

    // Row-status callback — paints each row's background with a semantic
    // token. Shared helper used by Planner / Table too.
    const rowStatusBgFor = useRowStatusBg(getSomeorUndefined(value.rowStatus));

    // ── Review chrome (optional, #263) ────────────────────────────────────
    // The shared per-row Approve/Reject decision column (a third pane beside
    // the timeline, scroll-synced) + the commitBar batch foot, on the shared
    // review pieces (`../shared/review`) and `reviewChrome` recipe — identical
    // chrome to the Planner's. Decisions are keyed by the ORIGINAL row index
    // (rows sort in the table pane; `row.index` preserves data order).
    const review = useMemo(() => getSomeorUndefined(value.review), [value.review]);
    const approvals = useMemo(() => value.rows.map((row) => row.approval), [value]);
    const reviewController = useReviewController(review, approvals);
    const chromeRecipe = useSlotRecipe({ key: "reviewChrome" });
    const reviewChrome = useMemo(() => chromeRecipe({ size: ganttSize }) as Record<string, Record<string, unknown>>, [chromeRecipe, ganttSize]);
    const reviewDotStyles = useMemo(() => {
        const out: Record<string, Record<string, unknown>> = {};
        for (const t of ["success", "warning", "danger", "info", "neutral"]) out[t] = (chromeRecipe({ size: ganttSize, status: t } as Record<string, unknown>) as Record<string, Record<string, unknown>>).statusDot ?? {};
        return out;
    }, [chromeRecipe, ganttSize]);
    const reviewContainerRef = useRef<HTMLDivElement>(null);

    const [gridLineColor, nowLineColor] = useToken("colors", ["gray.300", "fg.info"]);
    const showNowLine = style ? getSomeorUndefined(style.showToday) ?? false : false;
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const timelineContainerRef = useRef<HTMLDivElement>(null);
    const [timelineWidth, setTimelineWidth] = useState(400);
    // In-flight brush drag (px within the timeline header), when slice chrome
    // enables the brush affordance. The mode machine (draw / slide / resize)
    // is the shared brush-math FSM (#192).
    const [brushDrag, setBrushDrag] = useState<BrushDrag | null>(null);
    const sliceFrameStyles = useSlotRecipe({ key: "sliceFrame" })();

    // Row state management for loading indicators
    const [rowStateManager] = useState(() => new RowStateManager());
    const [rowStates, setRowStates] = useState<Map<RowKey, RowState>>(new Map());
    const visibleRowsRef = useRef<Set<RowKey>>(new Set());

    // Declarative time-axis config (range / format / tier). All optional.
    const axisCfg = useMemo(() => getSomeorUndefined(value.axis), [value.axis]);
    const axisRange = useMemo(() => (axisCfg ? getSomeorUndefined(axisCfg.range) : undefined), [axisCfg]);
    const axisFormat = useMemo(() => (axisCfg ? getSomeorUndefined(axisCfg.format) : undefined), [axisCfg]);
    const axisTier = useMemo(
        () => (axisCfg ? getSomeorUndefined(axisCfg.tier)?.type as GanttTier | undefined : undefined),
        [axisCfg],
    );

    // The time domain: an explicit `axis.range` pins the window; otherwise fit
    // to the task / milestone dates with a 10% (≥1 day) pad on each side.
    const dateRange = useMemo(() => {
        if (axisRange) return { start: axisRange.min, end: axisRange.max };

        let minDate: Date | null = null;
        let maxDate: Date | null = null;

        value.rows.forEach((row) => {
            row.tasks.forEach((task) => {
                const start = task.start;
                const end = task.end;
                if (minDate === null || start < minDate) minDate = start;
                if (maxDate === null || end > maxDate) maxDate = end;
            });
            row.milestones.forEach((milestone) => {
                const date = milestone.date;
                if (minDate === null || date < minDate) minDate = date;
                if (maxDate === null || date > maxDate) maxDate = date;
            });
        });

        // Fallback to current date if no events
        if (minDate === null) minDate = new Date();
        if (maxDate === null) maxDate = new Date();
        // Expand a degenerate (single-instant) domain so nicing has room.
        if (minDate.getTime() === maxDate.getTime()) {
            minDate = new Date(minDate.getTime() - 86_400_000);
            maxDate = new Date(maxDate.getTime() + 86_400_000);
        }

        // Snap the domain out to whole period boundaries (the same d3-time
        // interval the header bands use) so every band is a full period — no
        // cramped, clipped leading/trailing partials.
        const interval = tierInterval(axisTier ?? "auto", minDate, maxDate);
        return { start: interval.floor(minDate), end: interval.ceil(maxDate) };
    }, [value.rows, axisRange, axisTier]);

    // One visx time scale shared by the gridlines + now-line (and the same
    // [start,end]→[0,width] linear mapping the bars/milestones use). `.ticks()`
    // lets the scale choose a human-friendly tick count for the dashed lines.
    // Under an active gutter the time axis ends `right` px short of the panel so
    // the lane is [left, W−right] (the table panel already supplies `left`).
    const timelineRange = gutterActive ? Math.max(0, timelineWidth - gRightPx) : timelineWidth;
    const xScale = useMemo(
        () => scaleTime({ domain: [dateRange.start, dateRange.end], range: [0, timelineRange] }),
        [dateRange.start, dateRange.end, timelineRange],
    );


    const gridLinePositions = useMemo(
        () => xScale.ticks(Math.max(2, Math.floor(timelineWidth / 100)))
            .map((d) => xScale(d))
            .filter((x) => x >= 0 && x <= timelineWidth),
        [xScale, timelineWidth],
    );

    // Update timeline width when container resizes (including splitter changes)
    useEffect(() => {
        const container = timelineContainerRef.current;
        if (!container) return;

        const updateWidth = () => {
            const width = container.offsetWidth;
            setTimelineWidth(Math.max(200, width));
        };

        updateWidth();

        const resizeObserver = new ResizeObserver(updateWidth);
        resizeObserver.observe(container);

        return () => resizeObserver.disconnect();
    }, []);

    // Subscribe to row state changes
    useEffect(() => {
        return rowStateManager.subscribe(() => {
            setRowStates(new Map(rowStateManager.getStates()));
        });
    }, [rowStateManager]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            rowStateManager.clear();
        };
    }, [rowStateManager]);

    // Column helper for type-safe column definitions
    const columnHelper = createColumnHelper<GanttRowValue>();

    // Create TanStack Table columns from East UI columns
    const columns = useMemo<ColumnDef<GanttRowValue, GanttCellValue | undefined>[]>(() => {
        return value.columns.map((col) => {
            const print = printFor(col.valueType);
            const compare = compareFor(col.valueType);

            // Extract width values from column config
            const width = getSomeorUndefined(col.width);
            const minWidth = getSomeorUndefined(col.minWidth);
            const maxWidth = getSomeorUndefined(col.maxWidth);
            // `render` is required on the IR column (the factory synthesizes a
            // text default when the author omits it) — no Option to unwrap.
            const renderFn = col.render as unknown as ColumnRenderFn;

            return columnHelper.accessor(
                (row) => row.cells.get(col.key),
                {
                    id: col.key,
                    header: getSomeorUndefined(col.header) ?? col.key,
                    enableSorting: true,
                    sortingFn: (rowA, rowB, columnId) => {
                        const cellA = rowA.original.cells.get(columnId);
                        const cellB = rowB.original.cells.get(columnId);
                        // Cells are bare LiteralValueType variants — `.value` is the payload.
                        const valA = cellA?.value;
                        const valB = cellB?.value;
                        if (valA === undefined || valB === undefined) return 0;
                        return compare(valA, valB);
                    },
                    minSize: parseSize(minWidth, 80),
                    size: parseSize(width, 150),
                    maxSize: parseSize(maxWidth, 400),
                    meta: {
                        print,
                        columnKey: col.key,
                        width,
                        minWidth,
                        maxWidth,
                        renderFn,
                    },
                }
            );
        });
    }, [value.columns, columnHelper]);

    // Consolidated persisted state (sorting + column sizing + splitter)
    const { state: persistedState, setState: setPersistedState } = usePersistedState<GanttPersistedState>(
        storageKey,
        { sorting: [], columnSizing: {}, pinnedColumns: [...value.frozen], tablePanelSize: null },
    );
    const sorting = persistedState.sorting;

    // Column pinning
    const { columnPinning, hasFrozen, toggleColumnPin } = useColumnPinning({
        frozenFromValue: value.frozen,
        persistedPinnedColumns: persistedState.pinnedColumns,
        setPersistedPinnedColumns: (updater) => setPersistedState(prev => ({
            ...prev,
            pinnedColumns: updater(prev.pinnedColumns ?? [...value.frozen]),
        })),
    });
    const getSortIndex = createGetSortIndex(sorting);
    const setSorting = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
        setPersistedState(prev => ({
            ...prev,
            sorting: typeof updater === 'function' ? updater(prev.sorting) : updater,
        }));
    }, [setPersistedState]);

    // Handle sorting changes and notify parent
    const handleSortingChange = useCallback(
        (updater: SortingState | ((prev: SortingState) => SortingState)) => {
            setSorting((prev) => {
                const newSorting = typeof updater === "function" ? updater(prev) : updater;

                // Convert to external ColumnSort format
                const sorts: ColumnSort[] = newSorting.map((s) => ({
                    columnKey: s.id,
                    direction: s.desc ? "desc" : "asc",
                }));
                onSortChange?.(sorts);

                // Also call East-side callback if present - called once per sort column
                if (onSortChangeFn) {
                    newSorting.forEach((s, index) => {
                        queueMicrotask(() => onSortChangeFn({
                            columnKey: s.id,
                            sortIndex: BigInt(index),
                            sortDirection: s.desc ? variant('desc', null) : variant('asc', null),
                        }));
                    });
                }

                return newSorting;
            });
        },
        [onSortChange, onSortChangeFn, setSorting]
    );

    // Handle cell click
    const handleCellClick = useCallback((rowIndex: bigint, columnKey: string, cellValue: GanttCellValue | undefined) => {
        if (onCellClickFn && cellValue !== undefined) {
            // The event's cellValue is the LiteralValueType variant itself.
            queueMicrotask(() => onCellClickFn({ rowIndex, columnKey, cellValue }));
        }
    }, [onCellClickFn]);

    // Handle cell double click
    const handleCellDoubleClick = useCallback((rowIndex: bigint, columnKey: string, cellValue: GanttCellValue | undefined) => {
        if (onCellDoubleClickFn && cellValue !== undefined) {
            queueMicrotask(() => onCellDoubleClickFn({ rowIndex, columnKey, cellValue }));
        }
    }, [onCellDoubleClickFn]);

    // Handle row click
    const handleRowClick = useCallback((rowIndex: bigint) => {
        if (onRowClickFn) {
            queueMicrotask(() => onRowClickFn({ rowIndex }));
        }
    }, [onRowClickFn]);

    // Handle row double click
    const handleRowDoubleClick = useCallback((rowIndex: bigint) => {
        if (onRowDoubleClickFn) {
            queueMicrotask(() => onRowDoubleClickFn({ rowIndex }));
        }
    }, [onRowDoubleClickFn]);

    // Handle task click (East-side callback)
    const handleTaskClick = useCallback((rowIndex: bigint, taskIndex: bigint, taskStart: Date, taskEnd: Date) => {
        if (onTaskClickFn) {
            queueMicrotask(() => onTaskClickFn({ rowIndex, taskIndex, taskStart, taskEnd }));
        }
    }, [onTaskClickFn]);

    // Handle milestone click (East-side callback)
    const handleMilestoneClick = useCallback((rowIndex: bigint, milestoneIndex: bigint, milestoneDate: Date) => {
        if (onMilestoneClickFn) {
            queueMicrotask(() => onMilestoneClickFn({ rowIndex, milestoneIndex, milestoneDate }));
        }
    }, [onMilestoneClickFn]);

    // Handle task double click (East-side callback)
    const handleTaskDoubleClick = useCallback((rowIndex: bigint, taskIndex: bigint, taskStart: Date, taskEnd: Date) => {
        if (onTaskDoubleClickFn) {
            queueMicrotask(() => onTaskDoubleClickFn({ rowIndex, taskIndex, taskStart, taskEnd }));
        }
    }, [onTaskDoubleClickFn]);

    // Handle milestone double click (East-side callback)
    const handleMilestoneDoubleClick = useCallback((rowIndex: bigint, milestoneIndex: bigint, milestoneDate: Date) => {
        if (onMilestoneDoubleClickFn) {
            queueMicrotask(() => onMilestoneDoubleClickFn({ rowIndex, milestoneIndex, milestoneDate }));
        }
    }, [onMilestoneDoubleClickFn]);

    // Emit a grammar event (#268) — gesture-driven moves/resizes stay
    // component-snapped (@use-gesture previews the bar live; the grammar
    // event is the COMMIT), re-checked against the IR canDrop veto.
    const emitGrammar = useCallback((event: DragEventValue) => {
        if ((event.type === "move" || event.type === "resize") && !canDropAllows(canDropFn, event)) return;
        if (onDragFn) queueMicrotask(() => onDragFn(event));
    }, [onDragFn, canDropFn]);

    // Handle task drag — a grammar `move` (row = row index key, slots = the
    // snapped ISO instants, event = `t<taskIndex>`; duration is preserved so
    // the host derives newEnd from its own task).
    const handleTaskDrag = useCallback((
        rowIndex: bigint,
        taskIndex: bigint,
        previousStart: Date,
        _previousEnd: Date,
        newStart: Date,
        _newEnd: Date
    ) => {
        emitGrammar(variant("move", {
            from: { surface: targetId, row: String(rowIndex), slot: previousStart.toISOString(), event: some(`t${taskIndex}`) },
            to: { surface: targetId, row: String(rowIndex), slot: newStart.toISOString(), event: none },
        }));
    }, [emitGrammar, targetId]);

    // Handle task progress change (East-side callback)
    const handleTaskProgressChange = useCallback((
        rowIndex: bigint,
        taskIndex: bigint,
        previousProgress: number,
        newProgress: number
    ) => {
        if (onTaskProgressChangeFn) {
            queueMicrotask(() => onTaskProgressChangeFn({ rowIndex, taskIndex, previousProgress, newProgress }));
        }
    }, [onTaskProgressChangeFn]);

    // Handle milestone drag — milestones ride the grammar `move` too
    // (event = `m<milestoneIndex>`).
    const handleMilestoneDrag = useCallback((
        rowIndex: bigint,
        milestoneIndex: bigint,
        previousDate: Date,
        newDate: Date
    ) => {
        emitGrammar(variant("move", {
            from: { surface: targetId, row: String(rowIndex), slot: previousDate.toISOString(), event: some(`m${milestoneIndex}`) },
            to: { surface: targetId, row: String(rowIndex), slot: newDate.toISOString(), event: none },
        }));
    }, [emitGrammar, targetId]);

    // Handle task end-edge resize — the grammar `resize` (the event ref's
    // `slot` is the moved edge's NEW snapped instant, edge = end).
    const handleTaskDurationChange = useCallback((
        rowIndex: bigint,
        taskIndex: bigint,
        _previousEnd: Date,
        newEnd: Date
    ) => {
        emitGrammar(variant("resize", {
            event: { surface: targetId, row: String(rowIndex), slot: newEnd.toISOString(), event: some(`t${taskIndex}`) },
            edge: variant("end", null),
        }));
    }, [emitGrammar, targetId]);

    // Wrap task click to fire East callback.
    const handleEventTaskClick = useCallback((task: GanttTaskValue, rowIndex: number, taskIndex: number) => {
        if (onTaskClickFn) {
            handleTaskClick(BigInt(rowIndex), BigInt(taskIndex), task.start, task.end);
        }
    }, [onTaskClickFn, handleTaskClick]);

    // Wrap task double-click to fire East callback.
    const handleEventTaskDoubleClick = useCallback((task: GanttTaskValue, rowIndex: number, taskIndex: number) => {
        if (onTaskDoubleClickFn) {
            handleTaskDoubleClick(BigInt(rowIndex), BigInt(taskIndex), task.start, task.end);
        }
    }, [onTaskDoubleClickFn, handleTaskDoubleClick]);

    // Wrap milestone click to fire East callback.
    const handleEventMilestoneClick = useCallback((milestone: GanttMilestoneValue, rowIndex: number, milestoneIndex: number) => {
        if (onMilestoneClickFn) {
            handleMilestoneClick(BigInt(rowIndex), BigInt(milestoneIndex), milestone.date);
        }
    }, [onMilestoneClickFn, handleMilestoneClick]);

    // Wrap milestone double-click to fire East callback.
    const handleEventMilestoneDoubleClick = useCallback((milestone: GanttMilestoneValue, rowIndex: number, milestoneIndex: number) => {
        if (onMilestoneDoubleClickFn) {
            handleMilestoneDoubleClick(BigInt(rowIndex), BigInt(milestoneIndex), milestone.date);
        }
    }, [onMilestoneDoubleClickFn, handleMilestoneDoubleClick]);




    // Handle task progress change from GanttEventRow
    const handleEventTaskProgressChange = useCallback((
        rowIndex: number,
        eventIndex: number,
        previousProgress: number,
        newProgress: number
    ) => {
        handleTaskProgressChange(BigInt(rowIndex), BigInt(eventIndex), previousProgress, newProgress);
    }, [handleTaskProgressChange]);

    // Convert East TimeStep variant values to TimeStep interface for components
    const dragStep = dragStepValue
        ? { type: dragStepValue.type as "minutes" | "hours" | "days" | "weeks" | "months", value: dragStepValue.value }
        : undefined;
    const durationStep = durationStepValue
        ? { type: durationStepValue.type as "minutes" | "hours" | "days" | "weeks" | "months", value: durationStepValue.value }
        : undefined;

    // Column sizing (derived from persisted state)
    const columnSizing = persistedState.columnSizing;
    const setColumnSizing = useCallback((updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
        setPersistedState(prev => ({
            ...prev,
            columnSizing: typeof updater === 'function' ? updater(prev.columnSizing) : updater,
        }));
    }, [setPersistedState]);

    // Persist splitter resize
    // Splitter drag state: tracks live size during drag, persists on end
    const [dragSize, setDragSize] = useState<number | null>(null);
    const handleSplitterResize = useCallback((details: { size: number[] }) => {
        if (details.size[0] !== undefined) {
            setDragSize(details.size[0]!);
        }
    }, []);
    const handleSplitterResizeEnd = useCallback((details: { size: number[] }) => {
        if (details.size[0] !== undefined) {
            setPersistedState(prev => ({ ...prev, tablePanelSize: details.size[0]! }));
        }
        setDragSize(null);
    }, [setPersistedState]);

    // Create table instance
    const table = useReactTable({
        data: value.rows,
        columns,
        state: {
            sorting,
            columnSizing,
            columnPinning,
        },
        onSortingChange: handleSortingChange,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        enableMultiSort,
        isMultiSortEvent: () => enableMultiSort,
        maxMultiSortColCount: maxSortColumns,
        enableColumnResizing,
        columnResizeMode: "onChange" as ColumnResizeMode,
        enableColumnPinning: true,
    });

    // Get sorted rows from table
    const { rows } = table.getRowModel();

    // Handle task drag from GanttEventRow — display index → ORIGINAL row
    // index (sort-stable, the drag-grammar convention).
    const handleEventTaskDrag = useCallback((
        rowIndex: number,
        eventIndex: number,
        previousStart: Date,
        previousEnd: Date,
        newStart: Date,
        newEnd: Date
    ) => {
        const original = rows[rowIndex]?.index ?? rowIndex;
        handleTaskDrag(BigInt(original), BigInt(eventIndex), previousStart, previousEnd, newStart, newEnd);
    }, [handleTaskDrag, rows]);

    // Handle milestone drag from GanttEventRow (display → original index).
    const handleEventMilestoneDrag = useCallback((
        rowIndex: number,
        eventIndex: number,
        previousDate: Date,
        newDate: Date
    ) => {
        const original = rows[rowIndex]?.index ?? rowIndex;
        handleMilestoneDrag(BigInt(original), BigInt(eventIndex), previousDate, newDate);
    }, [handleMilestoneDrag, rows]);

    // Handle task end-edge resize from GanttEventRow (display → original index).
    const handleEventTaskDurationChange = useCallback((
        rowIndex: number,
        eventIndex: number,
        previousEnd: Date,
        newEnd: Date
    ) => {
        const original = rows[rowIndex]?.index ?? rowIndex;
        handleTaskDurationChange(BigInt(original), BigInt(eventIndex), previousEnd, newEnd);
    }, [handleTaskDurationChange, rows]);


    // Column-sizing CSS variables (shared derivation, also used by Planner).
    const columnSizeVars = useColumnSizeVars(table);

    // Compute table panel % from actual column widths and container width
    const columnTotalWidth = table.getCenterTotalSize();
    const computedTablePanelSize = useMemo(() => {
        if (tablePanelSizeProp != null) return tablePanelSizeProp;
        if (containerWidth <= 0) return 50; // fallback before measurement
        return Math.min(Math.max((columnTotalWidth / containerWidth) * 100, 15), 75);
    }, [tablePanelSizeProp, columnTotalWidth, containerWidth]);

    // Effective: an active gutter pins the table panel to `left` (so the timeline
    // panel starts at the chart's plot-left); otherwise dragging > persisted > computed.
    const gutterTablePanelSize = (gutterActive && gLeftPx !== undefined && containerWidth > 0)
        ? Math.min(Math.max((gLeftPx / containerWidth) * 100, 1), 99)
        : undefined;
    const effectiveTablePanelSize = gutterTablePanelSize
        ?? dragSize ?? persistedState.tablePanelSize ?? computedTablePanelSize;

    // Last unpinned column stretches to fill remaining panel space
    // (shared derivation, also used by Planner).
    const lastUnpinnedColumnId = useLastUnpinnedColumnId(table);

    // Virtual row setup
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => tableContainerRef.current,
        estimateSize: () => effectiveRowHeight,
        overscan,
    });

    const virtualItems = virtualizer.getVirtualItems();

    // Process visible rows for loading state
    useEffect(() => {
        const currentVisible = new Set<RowKey>();

        virtualItems.forEach((item) => {
            currentVisible.add(item.index);
        });

        const prevVisible = visibleRowsRef.current;

        // Find rows that need loading
        const load: RowKey[] = [];
        currentVisible.forEach((key) => {
            const rowState = rowStateManager.getRowState(key);
            if (rowState.status === "unloaded") {
                load.push(key);
            }
        });

        // Find rows that left viewport
        const unload: RowKey[] = [];
        prevVisible.forEach((key) => {
            if (!currentVisible.has(key)) {
                unload.push(key);
            }
        });

        // Process state changes
        if (load.length > 0) {
            rowStateManager.markRowsLoading(load);
            load.forEach((key) => rowStateManager.scheduleLoaded(key, loadingDelay));
        }

        if (unload.length > 0) {
            rowStateManager.markRowsUnloaded(unload);
        }

        visibleRowsRef.current = currentVisible;
    }, [virtualItems, rowStateManager, loadingDelay]);


    // Sync scroll between the table, timeline, and (review-mode) decision panes
    const handleTableScroll = useCallback(() => {
        if (tableContainerRef.current && timelineContainerRef.current) {
            timelineContainerRef.current.scrollTop = tableContainerRef.current.scrollTop;
        }
        if (tableContainerRef.current && reviewContainerRef.current) {
            reviewContainerRef.current.scrollTop = tableContainerRef.current.scrollTop;
        }
    }, []);

    const handleTimelineScroll = useCallback(() => {
        if (tableContainerRef.current && timelineContainerRef.current) {
            tableContainerRef.current.scrollTop = timelineContainerRef.current.scrollTop;
        }
        if (timelineContainerRef.current && reviewContainerRef.current) {
            reviewContainerRef.current.scrollTop = timelineContainerRef.current.scrollTop;
        }
    }, []);

    const handleReviewScroll = useCallback(() => {
        if (reviewContainerRef.current && tableContainerRef.current) {
            tableContainerRef.current.scrollTop = reviewContainerRef.current.scrollTop;
        }
        if (reviewContainerRef.current && timelineContainerRef.current) {
            timelineContainerRef.current.scrollTop = reviewContainerRef.current.scrollTop;
        }
    }, []);

    const panels = useMemo(() => [
        { id: "table", minSize: 20 },
        { id: "timeline", minSize: 20 },
    ], []);

    // ── DnD target role (#268) ────────────────────────────────────────────
    // With `onDrag` wired the Gantt registers as a drag target: Library cards
    // drop anywhere on the timeline body (ONE continuous drop cell whose
    // coordinate resolves from the pointer at drop time — row from the
    // virtualizer band, slot from the x-scale inverted + snapped to
    // `dragStep`), landing as optimistic `proposed(added)` bars.
    const timelineDropEligible = onDragFn !== undefined;
    const [localAdds, setLocalAdds] = useState<Map<number, GanttTaskValue[]>>(() => new Map());
    useEffect(() => { setLocalAdds(new Map()); }, [value]);

    const resolveTimelineCoord = useCallback((clientX: number, clientY: number): CellCoord => {
        const el = timelineContainerRef.current;
        const rect = el?.getBoundingClientRect();
        const xPane = rect ? Math.max(0, Math.min(timelineRange, clientX - rect.left)) : 0;
        const date = xScale.invert(xPane);
        const snapped = dragStep ? snapDateToStep(date, dragStep) : date;
        // Row from the virtual band under the pointer (body scroll applies);
        // map the display row back to the ORIGINAL index (sort-stable).
        const yPane = rect ? clientY - rect.top + (el?.scrollTop ?? 0) - headerHeight : 0;
        const vRow = virtualItems.find(v => yPane >= v.start && yPane < v.end);
        const original = vRow !== undefined ? (rows[vRow.index]?.index ?? vRow.index) : 0;
        return { surface: targetId, row: String(original), slot: snapped.toISOString() };
    }, [timelineRange, xScale, dragStep, virtualItems, rows, targetId, headerHeight]);

    const timelineVeto = useCallback((payload: DragPayload, x?: number, y?: number): boolean => {
        if (canDropFn === undefined) return true;
        if (x === undefined || y === undefined) return true; // structural sweep — veto on hover
        return canDropAllows(canDropFn, candidateEvent(payload, resolveTimelineCoord(x, y)));
    }, [canDropFn, resolveTimelineCoord]);

    const timelineDropCoord = useMemo<CellCoord | null>(
        () => (timelineDropEligible ? { surface: targetId, row: "", slot: "" } : null),
        [timelineDropEligible, targetId],
    );
    const timelineDropRef = useDropCell(timelineDropCoord, false, timelineVeto, resolveTimelineCoord);

    const handleGrammarDrop = useCallback((event: DragEventValue, meta?: DragMeta) => {
        if (event.type === "add") {
            const rowIndex = Number(event.value.into.row);
            const start = new Date(event.value.into.slot);
            if (Number.isFinite(rowIndex) && !Number.isNaN(start.getTime())) {
                // Optimistic proposed(added) bar — one dragStep long (or a day).
                const stepMs = dragStep ? timeStepMs(dragStep) : 24 * 60 * 60 * 1000;
                const task: GanttTaskValue = {
                    start,
                    end: new Date(start.getTime() + stepMs),
                    label: meta?.label !== undefined
                        ? some({ value: meta.label, align: none, verticalAlign: none, color: none, fontWeight: none, fontStyle: none, fontSize: none })
                        : none,
                    progress: none,
                    state: variant("proposed", variant("added", null)),
                    status: none,
                    popover: none,
                };
                setLocalAdds(prev => {
                    const nextMap = new Map(prev);
                    nextMap.set(rowIndex, [...(nextMap.get(rowIndex) ?? []), task]);
                    return nextMap;
                });
            }
        }
        if (onDragFn) queueMicrotask(() => onDragFn(event));
    }, [onDragFn, dragStep]);

    const targetConfig = useMemo(() => (onDragFn !== undefined ? {
        id: targetId,
        sources: [...value.sources],
        kinds: { add: true, move: true, resize: true },
        onDrag: handleGrammarDrop,
    } : null), [onDragFn, targetId, value.sources, handleGrammarDrop]);
    useDragTarget(targetConfig);

    // The review decision pane — a third, fixed-width column beside the
    // timeline wearing the shared `reviewChrome` slots, scroll-synced with
    // both panes. Cells act on the ORIGINAL row index (sort-stable).
    // Uniform sizing (#320) — `"fill"` → 100% of the parent box; `maxHeight` caps.
    const heightCss = parseCssSize(style ? getSomeorUndefined(style.height) : undefined) ?? height;
    const maxHeightCss = parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined);
    const showFoot = reviewController !== undefined && reviewController.showFoot;
    const decisionPane = reviewController !== undefined && review !== undefined ? (
        <Box width={DECISION_WIDTH} flexShrink={0} display="flex" flexDirection="column" height="100%" background="bg.surface">
            <Box css={reviewChrome.decisionHeader} data-slot="decisionHeader" height={`${headerHeight}px`} flexShrink={0}>
                {review.columnLabel}
            </Box>
            <Box ref={reviewContainerRef} flex="1" overflowY="auto" onScroll={handleReviewScroll} css={{ scrollbarWidth: "none" }}>
                <Box position="relative" height={`${virtualizer.getTotalSize()}px`}>
                    {virtualItems.map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        if (!row) return null;
                        const statusTag = getSomeorUndefined(row.original.status)?.type;
                        return (
                            <Box
                                key={row.id}
                                css={reviewChrome.decisionCol}
                                data-slot="decisionCol"
                                data-status={statusTag}
                                position="absolute"
                                top={0}
                                left={0}
                                right={0}
                                transform={`translateY(${virtualRow.start}px)`}
                                height={`${virtualRow.size}px`}
                            >
                                {statusTag !== undefined && (
                                    <Box as="span" css={reviewDotStyles[statusTag]} data-slot="statusDot" position="absolute" left="12px" />
                                )}
                                <DecisionButtons rowIndex={row.index} controller={reviewController} />
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        </Box>
    ) : null;

    const ganttContent = (
        <Box
            ref={rootRef}
            width="100%"
            {...(showFoot ? { flex: "1", minHeight: 0 } : { height: heightCss })}
            {...(maxHeightCss !== undefined ? { maxHeight: maxHeightCss, minHeight: 0 } : {})}
            overflow="hidden"
            display="flex"
        >
        <Box flex="1" minWidth={0} height="100%">
        <Splitter.Root
            size={[effectiveTablePanelSize, 100 - effectiveTablePanelSize]}
            panels={panels}
            width="100%"
            height="100%"
            onResize={handleSplitterResize}
            onResizeEnd={handleSplitterResizeEnd}
        >
            {/* Table Panel */}
            <Splitter.Panel id="table">
                <Box
                    ref={tableContainerRef}
                    height="100%"
                    overflowY="auto"
                    position="relative"
                    onScroll={handleTableScroll}
                    // Left pane of the synced pair hides only its VERTICAL bar
                    // (the timeline pane carries the pair's single visible
                    // vertical bar); its horizontal bar stays — nothing else
                    // scrolls this pane's own x-overflow (frozen columns).
                    css={syncedPaneScrollbarCss}
                >
                    <ChakraTable.Root
                        {...props}
                        style={{
                            ...columnSizeVars,
                            width: "100%",
                            // Under a gutter the table panel is pinned to `left`, so let the
                            // columns shrink to fit it instead of forcing a horizontal scroll.
                            minWidth: gutterActive ? 0 : table.getCenterTotalSize(),
                            tableLayout: "fixed",
                        }}
                    >
                        <ChakraTable.Header
                            style={{ display: "block" }}
                            position="sticky"
                            top={0}
                            zIndex={1}
                            css={ganttSlotStyles.header}
                        >
                            {table.getHeaderGroups().map((headerGroup) => (
                                <ChakraTable.Row
                                    key={headerGroup.id}
                                    style={{ display: "flex", width: "100%", height: `${headerHeight}px` }}
                                >
                                    {headerGroup.headers.map((header) => {
                                        return (
                                            <ChakraTable.ColumnHeader
                                                key={header.id}
                                                css={tableSlotStyles.columnHeader}
                                                color="gray.500"
                                                _hover={{ bg: "bg.muted", "& .col-controls": { opacity: 1 } }}
                                                transition="background 0.2s"
                                                style={getHeaderCellStyle(header, hasFrozen, columnSizing, header.id === lastUnpinnedColumnId)}
                                            >
                                                <HeaderControls
                                                    header={header}
                                                    toggleColumnPin={toggleColumnPin}
                                                    getSortIndex={getSortIndex}
                                                    enableMultiSort={enableMultiSort}
                                                    enableColumnResizing={enableColumnResizing}
                                                />
                                            </ChakraTable.ColumnHeader>
                                        );
                                    })}
                                </ChakraTable.Row>
                            ))}
                        </ChakraTable.Header>

                        <ChakraTable.Body
                            style={{
                                display: "block",
                                position: "relative",
                                height: `${virtualizer.getTotalSize()}px`,
                            }}
                        >
                            {virtualItems.map((virtualRow) => {
                                const row = rows[virtualRow.index];
                                if (!row) return null;

                                const rowKey = virtualRow.index;
                                const rowState = rowStates.get(rowKey) || { status: "unloaded" };
                                const isRowLoading =
                                    !rowStateManager.isRowLoaded(rowKey) ||
                                    rowState.status === "loading";

                                const rowIndex = BigInt(virtualRow.index);
                                const rowStatusBg = rowStatusBgFor(virtualRow.index);

                                return (
                                    <ChakraTable.Row
                                        key={row.id}
                                        style={{
                                            display: "flex",
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                            cursor: (onRowClickFn || onRowDoubleClickFn) ? 'pointer' : undefined,
                                            background: rowStatusBg,
                                        }}
                                        onClick={onRowClickFn ? () => handleRowClick(rowIndex) : undefined}
                                        onDoubleClick={onRowDoubleClickFn ? () => handleRowDoubleClick(rowIndex) : undefined}
                                    >
                                        {row.getVisibleCells().map((cell) => {
                                            const cellValue = cell.getValue() as
                                                | GanttCellValue
                                                | undefined;
                                            const meta = cell.column.columnDef.meta;
                                            const columnKey = meta?.columnKey ?? cell.column.id;

                                            const cellStyle = getCellStyle(cell, hasFrozen, columnSizing, cell.column.id === lastUnpinnedColumnId);

                                            const cellClickHandler = onCellClickFn ? (e: React.MouseEvent) => {
                                                e.stopPropagation();
                                                handleCellClick(rowIndex, columnKey, cellValue);
                                            } : undefined;

                                            const cellDoubleClickHandler = onCellDoubleClickFn ? (e: React.MouseEvent) => {
                                                e.stopPropagation();
                                                handleCellDoubleClick(rowIndex, columnKey, cellValue);
                                            } : undefined;

                                            if (isRowLoading) {
                                                return (
                                                    <ChakraTable.Cell key={cell.id} style={cellStyle}>
                                                        <Skeleton height="20px" width="80%" />
                                                    </ChakraTable.Cell>
                                                );
                                            }

                                            if (cellValue == null) {
                                                return (
                                                    <ChakraTable.Cell
                                                        key={cell.id}
                                                        style={cellStyle}
                                                        onClick={cellClickHandler}
                                                        onDoubleClick={cellDoubleClickHandler}
                                                    />
                                                );
                                            }

                                            // Column render function — always present (the factory
                                            // synthesizes a text default when the author omits it).
                                            // ctx.cellValue is the LiteralValueType variant itself.
                                            if (meta?.renderFn) {
                                                const rendered = meta.renderFn({
                                                    rowIndex: rowIndex,
                                                    columnKey,
                                                    cellValue,
                                                });
                                                return (
                                                    <ChakraTable.Cell
                                                        key={cell.id}
                                                        style={cellStyle}
                                                        onClick={cellClickHandler}
                                                        onDoubleClick={cellDoubleClickHandler}
                                                    >
                                                        <EastChakraComponent value={rendered} storageKey={`${storageKey}.render.${cell.column.id}`} />
                                                    </ChakraTable.Cell>
                                                );
                                            }

                                            // Defensive fallback (the IR requires render): print the payload.
                                            return (
                                                <ChakraTable.Cell
                                                    key={cell.id}
                                                    style={cellStyle}
                                                    onClick={cellClickHandler}
                                                    onDoubleClick={cellDoubleClickHandler}
                                                >
                                                    <Text>
                                                        {meta?.print?.(cellValue.value) ?? null}
                                                    </Text>
                                                </ChakraTable.Cell>
                                            );
                                        })}
                                    </ChakraTable.Row>
                                );
                            })}
                        </ChakraTable.Body>
                    </ChakraTable.Root>
                </Box>
            </Splitter.Panel>

            {/* Base grip from the `splitter` slot recipe; nudge it into the
                rows area (below the header) — a runtime offset, not a recipe value. */}
            {!gutterActive && (
                <Splitter.ResizeTrigger id="table:timeline" css={{ _after: { top: `calc(50% + ${headerHeight / 2}px)` } }} />
            )}

            {/* Timeline Panel */}
            <Splitter.Panel id="timeline">
                <Box
                    ref={timelineContainerRef}
                    width="100%"
                    height="100%"
                    overflowY="auto"
                    overflowX="hidden"
                    position="relative"
                    onScroll={handleTimelineScroll}
                    css={virtualScrollbarCss}
                >
                    {/* Timeline Header - matches table header styling */}
                    <Box position="sticky" top={0} zIndex={1} css={ganttSlotStyles.header}>
                        <EventAxis
                            startDate={dateRange.start}
                            endDate={dateRange.end}
                            width={timelineWidth}
                            height={headerHeight}
                            columnHeaderStyles={tableSlotStyles.columnHeader}
                            tier={axisTier}
                            format={axisFormat}
                        />
                        {/* Trailing right-gutter mask (#147): the header band's wash fills the
                            whole timeline panel, so without this it bleeds into the `right`
                            gutter past where the axis ends (timelineRange = width − right).
                            Painting the surface colour over the gutter stops it at the lane edge. */}
                        {gutterActive && gRightPx > 0 && (
                            <Box position="absolute" top={0} right={0} width={`${gRightPx}px`} height={`${headerHeight}px`} background="bg.surface" pointerEvents="none" zIndex={1} />
                        )}
                        {timelineBrush && (() => {
                            // Brush capture over the header: the time scale spans
                            // the pane (no horizontal scroll), so pixel → time is
                            // xScale.invert on the pointer offset. The applied
                            // window renders grabbable (#192): drag its body to
                            // slide (width preserved), an edge hot zone to resize.
                            const winPx = timelineWindow !== undefined
                                ? {
                                    lo: Math.max(0, Math.min(timelineRange, xScale(timelineWindow.from))),
                                    hi: Math.max(0, Math.min(timelineRange, xScale(timelineWindow.to))),
                                }
                                : undefined;
                            const winValid = winPx !== undefined && Number.isFinite(winPx.lo) && Number.isFinite(winPx.hi) && winPx.hi > winPx.lo;
                            const draft = brushDrag !== null ? brushDragWindow(brushDrag) : undefined;
                            return (
                                <Box
                                    position="absolute"
                                    inset={0}
                                    cursor={brushDrag !== null ? brushCursor(brushDrag.mode) : "crosshair"}
                                    data-brush-track
                                    onPointerDown={(e) => {
                                        const el = e.currentTarget as HTMLElement;
                                        try { el.setPointerCapture(e.pointerId); } catch { /* jsdom has no active pointers */ }
                                        const rect = el.getBoundingClientRect();
                                        const x = e.clientX - rect.left;
                                        const win = winValid ? winPx : undefined;
                                        setBrushDrag({ mode: brushHitTest(x, win), start: x, current: x, width: timelineRange, win });
                                    }}
                                    onPointerMove={(e) => {
                                        if (!brushDrag) return;
                                        const left = (e.currentTarget as HTMLElement).getBoundingClientRect().left;
                                        setBrushDrag({ ...brushDrag, current: e.clientX - left });
                                    }}
                                    onPointerUp={() => {
                                        if (!brushDrag) return;
                                        setBrushDrag(null);
                                        const release = brushRelease(brushDrag);
                                        if (release.kind === "clear") timelineBrush(null);
                                        else if (release.kind === "commit") timelineBrush({ from: xScale.invert(release.lo), to: xScale.invert(release.hi) });
                                    }}
                                >
                                    {brushDrag === null && winValid && (
                                        <>
                                            <Box
                                                data-brush-window
                                                css={sliceFrameStyles.brushWindow}
                                                left={`${winPx.lo}px`}
                                                width={`${winPx.hi - winPx.lo}px`}
                                                opacity={0.18}
                                            />
                                            <Box data-brush-handle="lo" css={sliceFrameStyles.brushHandle} left={`${winPx.lo}px`} />
                                            <Box data-brush-handle="hi" css={sliceFrameStyles.brushHandle} left={`${winPx.hi}px`} />
                                        </>
                                    )}
                                    {draft !== undefined && (
                                        <Box
                                            position="absolute"
                                            top={0}
                                            bottom={0}
                                            left={`${draft.lo}px`}
                                            width={`${draft.hi - draft.lo}px`}
                                            bg="accent.brand"
                                            opacity={0.18}
                                            borderXWidth="1px"
                                            borderColor="accent.brand"
                                            pointerEvents="none"
                                        />
                                    )}
                                </Box>
                            );
                        })()}
                    </Box>

                    {/* Timeline Body - uses same table structure for matching row styles */}
                    <Box position="relative" ref={timelineDropRef}>
                        <ChakraTable.Root
                            {...props}
                            style={{
                                width: "100%",
                                tableLayout: "fixed",
                                position: "relative",
                            }}
                        >
                        <ChakraTable.Body
                            style={{
                                display: "block",
                                position: "relative",
                                height: `${virtualizer.getTotalSize()}px`,
                            }}
                        >
                            {virtualItems.map((virtualRow) => {
                                const row = rows[virtualRow.index];
                                if (!row) return null;
                                const timelineRowBg = rowStatusBgFor(virtualRow.index);

                                return (
                                    <ChakraTable.Row
                                        key={row.id}
                                        style={{
                                            display: "flex",
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                            background: timelineRowBg,
                                        }}
                                    >
                                        {/* Trailing right-gutter mask (#147): stop the row's
                                            full-width bottom rule at W−right; `bottom:-1px` covers
                                            the gutter strip and that 1px rule with the surface colour. */}
                                        {gutterActive && gRightPx > 0 && (
                                            <Box position="absolute" top={0} right={0} bottom="-1px" width={`${gRightPx}px`} background="bg.surface" pointerEvents="none" zIndex={2} aria-hidden="true" />
                                        )}
                                        <ChakraTable.Cell
                                            style={{ width: "100%", padding: 0 }}
                                        >
                                            <svg width="100%" height={virtualRow.size}>
                                                <GanttEventRow
                                                    tasks={[...(row.original.tasks as GanttTaskValue[]), ...(localAdds.get(row.index) ?? [])]}
                                                    milestones={row.original.milestones as GanttMilestoneValue[]}
                                                    rowIndex={virtualRow.index}
                                                    y={0}
                                                    width={timelineWidth}
                                                    height={virtualRow.size}
                                                    startDate={dateRange.start}
                                                    endDate={dateRange.end}
                                                    storageKey={`${storageKey}.gantt`}
                                                    onTaskClick={handleEventTaskClick}
                                                    onTaskDoubleClick={handleEventTaskDoubleClick}
                                                    onMilestoneClick={handleEventMilestoneClick}
                                                    onMilestoneDoubleClick={handleEventMilestoneDoubleClick}
                                                    onTaskDrag={onDragFn ? handleEventTaskDrag : undefined}
                                                    onTaskDurationChange={onDragFn ? handleEventTaskDurationChange : undefined}
                                                    onTaskProgressChange={onTaskProgressChangeFn ? handleEventTaskProgressChange : undefined}
                                                    onMilestoneDrag={onDragFn ? handleEventMilestoneDrag : undefined}
                                                    dragStep={dragStep}
                                                    durationStep={durationStep}
                                                />
                                            </svg>
                                        </ChakraTable.Cell>
                                    </ChakraTable.Row>
                                );
                            })}
                        </ChakraTable.Body>
                        </ChakraTable.Root>
                        {/* Dashed vertical grid lines - rendered on top */}
                        <svg
                            width={timelineWidth}
                            height={virtualizer.getTotalSize()}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                pointerEvents: "none",
                                zIndex: 1,
                            }}
                        >
                            {gridLinePositions.map((x, index) => (
                                <line
                                    key={`grid-${index}`}
                                    x1={x}
                                    y1={0}
                                    x2={x}
                                    y2={virtualizer.getTotalSize()}
                                    stroke={gridLineColor}
                                    strokeWidth={1}
                                    strokeDasharray="4 4"
                                    opacity={0.6}
                                />
                            ))}
                            {/* Now-line — 1px brand-d rule at the present, on the
                                same coordinate origin as the grid + bars. */}
                            {showNowLine && (() => {
                                const nowX = xScale(new Date());
                                if (nowX < 0 || nowX > timelineWidth) return null;
                                return (
                                    <line
                                        x1={nowX}
                                        y1={0}
                                        x2={nowX}
                                        y2={virtualizer.getTotalSize()}
                                        stroke={nowLineColor}
                                        strokeWidth={1}
                                    />
                                );
                            })()}
                        </svg>
                    </Box>
                </Box>
            </Splitter.Panel>
        </Splitter.Root>
        </Box>
        {decisionPane}
        </Box>
    );

    // The batch review foot (shared `ReviewFoot` on the commitBar recipe)
    // mounts below the fixed-height chassis, full-width (#263).
    const surface = showFoot && reviewController !== undefined
        ? (
            <Box display="flex" flexDirection="column" width="100%" height={heightCss} {...(maxHeightCss !== undefined ? { maxHeight: maxHeightCss } : {})}>
                {ganttContent}
                <ReviewFoot controller={reviewController} storageKey={storageKey ?? "gantt"} />
            </Box>
        )
        : ganttContent;

    // A density set on the gantt cascades to display components rendered in
    // its table cells, matching the Table behaviour.
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{surface}</DensityProvider>
        : surface;
};

/**
 * The exported Gantt renderer. Without `slice` it renders the bare Gantt.
 * With the `slice` chrome option it renders the frame chassis itself — a
 * header rail mounting the listed affordances (the shared `SliceRailCluster`
 * ladder; the `range` chip edits the window the `brush` gesture will also
 * write) and a derived-count footer. Chrome only: the rows are whatever the
 * host fed (`Slice.rows([RowType], slice)` upstream).
 */
export const EastChakraGantt = memo(function EastChakraGantt(props: EastChakraGanttProps) {
    const chrome = getSomeorUndefined(props.value.slice as never) as
        { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined;
    const slice = chrome?.slice as ValueTypeOf<typeof SliceInternal.Types.Bind> | undefined;
    useSliceReactivity(slice?.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })();
    if (chrome === undefined || slice === undefined) return <GanttCore {...props} />;

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    const railKinds = (state.cohorts.length > 0 && !configuredKinds.includes("cohort")
        ? [...configuredKinds, "cohort"]
        : configuredKinds).filter(k => k !== "brush");
    const total = Number(slice.totalCount() as bigint);
    const result = Number(slice.resultCount() as bigint);
    const pct = total > 0 ? Math.round((1 - result / total) * 100) : 0;
    const brushEnabled = configuredKinds.includes("brush");
    const timelineBrush = brushEnabled
        ? (range: { from: Date; to: Date } | null) => {
            if (range === null) { slice.setRange(none); return; }
            slice.setRange(some(variant("datetime", { from: range.from, to: range.to })));
        }
        : undefined;
    // The applied range, for the grabbable header window (#192). Only the
    // literal `datetime` arm carries bounds; a preset arm renders no window.
    const appliedRange = brushEnabled
        ? getSomeorUndefined(state.range) as { type: string; value: { from: Date; to: Date } } | undefined
        : undefined;
    const timelineWindow = appliedRange?.type === "datetime" ? appliedRange.value : undefined;

    return (
        <Box css={frameStyles.root}>
            <Box css={frameStyles.frameEyebrow}>
                <SliceRailCluster slice={slice} affordanceKinds={railKinds} />
            </Box>
            <Box css={frameStyles.frameBody}>
                <GanttCore {...props} {...(timelineBrush !== undefined ? { timelineBrush } : {})} {...(timelineWindow !== undefined ? { timelineWindow } : {})} />
            </Box>
            <Box css={frameStyles.frameFooter}>
                <Box as="span" css={frameStyles.frameFooterStat}>{result.toLocaleString()}</Box>
                <Box as="span">{`rows · of ${total.toLocaleString()}`}</Box>
                {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${pct}%`}</Box>}
            </Box>
        </Box>
    );
}, (prev, next) => ganttRootEqual(prev.value, next.value));
