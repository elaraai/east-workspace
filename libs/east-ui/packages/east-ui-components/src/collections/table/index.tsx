/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useRef, useState, useEffect, useCallback, type CSSProperties } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
    Table as ChakraTable,
    Box,
    chakra,
    HStack,
    Text,
    Skeleton,
    useSlotRecipe,
    type TableRootProps,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronUp, faChevronDown, faChevronLeft, faChevronRight, faAnglesDown, faThumbtack } from "@fortawesome/free-solid-svg-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    createColumnHelper,
    flexRender,
    type SortingState,
    type ColumnResizeMode,
    type ColumnDef,
    type RowSelectionState,
} from "@tanstack/react-table";
import { compareFor, equalFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Table, type UIComponentType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../slice/rail";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { RowStateManager, type RowKey, type RowState } from "../../utils/RowStateManager";
import { useRowStatusBg, useDensityHeights } from "../shared/helpers";
import { DensityProvider } from "../../contracts/density";

// Pre-define equality function at module level
const tableRootEqual = equalFor(Table.Types.Root);

// Parse CSS size values to pixels (simple numeric extraction)
const parseSize = (val: string | undefined, defaultVal: number): number => {
    if (!val) return defaultVal;
    const num = parseInt(val, 10);
    return isNaN(num) ? defaultVal : num;
};

/** East Table Root value type */
export type TableRootValue = ValueTypeOf<typeof Table.Types.Root>;

/** East Table Column value type */
export type TableColumnValue = ValueTypeOf<typeof Table.Types.Column>;

/** East Table Cell value type */
export type TableCellValue = ValueTypeOf<typeof Table.Types.Cell>;

/** East Table Cell Render Context value type */
type TableCellRenderContextValue = ValueTypeOf<typeof Table.Types.CellRenderContext>;

/** Column render function type (called at render time with cell context, returns UIComponent value) */
type ColumnRenderFn = (ctx: TableCellRenderContextValue) => ValueTypeOf<UIComponentType>;

/** East Table Row value type */
export type TableRowValue = Map<string, TableCellValue>;

// Column sort types for external API
export type SortDirection = 'asc' | 'desc';
export interface ColumnSort {
    columnKey: string;
    direction: SortDirection;
}

// Extend TanStack Table's ColumnMeta for our custom properties
declare module '@tanstack/react-table' {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    interface ColumnMeta<TData, TValue> {
        print?: (value: unknown) => string;
        columnKey?: string;
        width?: string | undefined;
        minWidth?: string | undefined;
        maxWidth?: string | undefined;
        renderFn?: ColumnRenderFn | undefined;
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */
}

/**
 * Converts an East UI Table Root value to Chakra UI TableRoot props.
 */
export function toChakraTableRoot(value: TableRootValue): TableRootProps {
    const style = getSomeorUndefined(value.style);

    return {
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        size: style ? getSomeorUndefined(style.size)?.type : undefined,
        striped: style ? getSomeorUndefined(style.striped) : undefined,
        interactive: getSomeorUndefined(value.interactive),
        stickyHeader: style ? getSomeorUndefined(style.stickyHeader) : undefined,
        showColumnBorder: style ? getSomeorUndefined(style.showColumnBorder) : undefined,
        colorPalette: style ? getSomeorUndefined(style.colorPalette)?.type : undefined,
    };
}

export interface EastChakraTableProps {
    value: TableRootValue;
    /** Height of the table container (required for virtualization) */
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
    /** Loading delay before showing row content (ms). Defaults to 0 — rows
     * come from an in-memory East value, so there's nothing to fetch and the
     * skeleton is purely cosmetic. Set a positive delay only when the row data
     * is genuinely async (e.g. server-side pagination). */
    loadingDelay?: number;
    /** Enable column resizing */
    enableColumnResizing?: boolean;
    /** Storage key for persisting sort/column state in localStorage. Omit for ephemeral state. */
    storageKey: string;
}

interface TablePersistedState {
    sorting: SortingState;
    columnSizing: Record<string, number>;
    pinnedColumns: string[];
}

/**
 * Renders an East UI Table value using Chakra UI Table components.
 * Features:
 * - Row virtualization for large datasets
 * - Column sorting with multi-sort support
 * - Column resizing
 * - Row loading state indicators
 */
const TableCore = function TableCore({
    value,
    height = "100%",
    rowHeight = 36,
    overscan = 8,
    onSortChange,
    enableMultiSort = true,
    maxSortColumns = 5,
    loadingDelay = 0,
    enableColumnResizing: enableColumnResizingProp,
    storageKey,
    hidePaginationBand,
}: EastChakraTableProps & { hidePaginationBand?: boolean }) {
    const props = useMemo(() => toChakraTableRoot(value), [value]);
    const tableContainerRef = useRef<HTMLDivElement>(null);

    // Extract East-side callbacks from style
    const style = getSomeorUndefined(value.style);
    const onCellClickFn = getSomeorUndefined(value.onCellClick);
    const onCellDoubleClickFn = getSomeorUndefined(value.onCellDoubleClick);
    const onRowClickFn = getSomeorUndefined(value.onRowClick);
    const onRowDoubleClickFn = getSomeorUndefined(value.onRowDoubleClick);
    const onSortChangeFn = getSomeorUndefined(value.onSortChange);
    const onRowSelectionChangeFn = getSomeorUndefined(value.onRowSelectionChange);

    // Column-resize gating — IR `value.columnResize` takes precedence
    // over the JS-side prop. When neither is defined, default to true
    // (preserves the current always-on behaviour).
    const irColumnResize = getSomeorUndefined(value.columnResize);
    const enableColumnResizing = irColumnResize !== undefined
        ? irColumnResize
        : (enableColumnResizingProp ?? true);

    // Virtualization gate — IR `value.virtualization` flag. When false,
    // virtualization is bypassed and every row is rendered. The
    // virtualizer instance is still created (its `getVirtualItems`
    // method drives the layout); we just synthesize a full list of
    // virtual items when virtualization is off so the existing render
    // loop works unchanged.
    const virtualizationEnabled = getSomeorUndefined(value.virtualization) !== false;

    // Visual colour overrides — explicit theme escape hatches per
    // §0.10. Each falls back to Chakra's default when undefined; when
    // set, the renderer plumbs it onto the relevant DOM node via
    // inline style.
    const headerBackground = style ? getSomeorUndefined(style.headerBackground) : undefined;
    // `gray.500` (= spec --ink-4 #6b8080), NOT the semantic `fg.subtle`:
    // Chakra's default theme also defines `fg.subtle` (as the lighter
    // gray.400), and that definition leaks into the table scope and wins,
    // rendering headers too faint. gray.500 is single-valued, so it resolves
    // unambiguously to the spec header ink.
    const headerColor = style ? getSomeorUndefined(style.headerColor) ?? "gray.500" : "gray.500";
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const zebraBackground = style ? getSomeorUndefined(style.zebraBackground) : undefined;
    const hoverBackground = style ? getSomeorUndefined(style.hoverBackground) : undefined;
    const selectedBackground = style ? getSomeorUndefined(style.selectedBackground) : undefined;
    const selectedBorderColor = style ? getSomeorUndefined(style.selectedBorderColor) : undefined;
    const footerBackground = style ? getSomeorUndefined(style.footerBackground) : undefined;

    // Density token — `compact` | `comfortable` | `cozy`. Translates to
    // a row-height + cell-padding pair used by every body row.
    const densityTag = getSomeorUndefined(value.density)?.type;
    // Density → recipe size variant (drives cell/header padding via the
    // `table` slot recipe) + a row height for the virtualizer.
    // condensed/compact→sm, comfortable→lg; an explicit `style.size` is
    // honoured when no density is set.
    const tableSize: "sm" | "md" | "lg" = densityTag === "compact" || densityTag === "condensed" ? "sm"
        : densityTag === "comfortable" ? "lg"
        : ((props.size as "sm" | "md" | "lg" | undefined) ?? "md");
    // Row + header height come from the shared `sizes.density` tokens (the
    // single source, also consumed by Gantt and Planner) — md → 36px, the spec
    // row height. Pad-Y stays here for the group/footer cells that set padding
    // via raw inline style outside the recipe's cell slot.
    const densityPadYPx = tableSize === "sm" ? 6 : tableSize === "lg" ? 12 : 10;
    const densityRowHeight = useDensityHeights(tableSize).row;
    // Group / footer cells sit outside the recipe's cell/columnHeader slots and
    // set padding via raw inline `style`; mirror the same density padding.
    const densityCellPadX = tableSize === "sm" ? "8px" : tableSize === "lg" ? "16px" : "14px";
    const densityCellPadY = `${densityPadYPx}px`;

    // Chakra does NOT auto-apply our `table` slot recipe to ChakraTable's
    // sub-components (its built-in Table recipe wins — the slot classNames
    // attach but the styled hash comes out empty). Consume it explicitly and
    // spread each slot via `css=`, the way accordion/nav do, so the spec
    // values (10px mono header, fg.subtle, 13px cells, 1px rules, top-align)
    // come from the theme rather than per-site inline literals.
    const tableSlotStyles = useSlotRecipe({ key: "table" })({ size: tableSize });

    // Expandable rows — `value.expandedContent` is a `(rowIndex) =>
    // UIComponent` callback. When defined, an extra toggle column is
    // prepended; clicking the chevron toggles the row's `expandedRows`
    // membership; expanded rows render an extra child row beneath
    // showing the callback's UIComp.
    const expandedContentFn = getSomeorUndefined(value.expandedContent);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
    const toggleExpanded = useCallback((idx: number) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx); else next.add(idx);
            return next;
        });
    }, []);

    // Row-status callback — paints each row's background with a
    // semantic token. Shared helper used by Planner / Gantt too.
    const rowStatusBgFor = useRowStatusBg(getSomeorUndefined(value.rowStatus));

    // Row state management for loading indicators
    const [rowStateManager] = useState(() => new RowStateManager());
    const [rowStates, setRowStates] = useState<Map<RowKey, RowState>>(new Map());

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
    const columnHelper = createColumnHelper<TableRowValue>();

    // Create TanStack Table columns from East UI columns
    const columns = useMemo<ColumnDef<TableRowValue, TableCellValue | undefined>[]>(() => {
        return value.columns.map((col) => {
            const print = printFor(col.valueType);
            const compare = compareFor(col.valueType);

            // Extract width values from column config
            const width = getSomeorUndefined(col.width);
            const minWidth = getSomeorUndefined(col.minWidth);
            const maxWidth = getSomeorUndefined(col.maxWidth);
            const renderFn = getSomeorUndefined(col.render) as ColumnRenderFn | undefined;

            return columnHelper.accessor(
                (row) => row.get(col.key),
                {
                    id: col.key,
                    header: getSomeorUndefined(col.header) ?? col.key,
                    enableSorting: true,
                    sortingFn: (rowA, rowB, columnId) => {
                        const cellA = rowA.original.get(columnId);
                        const cellB = rowB.original.get(columnId);
                         const valA = cellA?.value?.value;
                        const valB = cellB?.value?.value;
                        if (valA === undefined || valB === undefined) return 0;
                        return compare(valA as any, valB as any);
                    },
                    minSize: parseSize(minWidth, 80),
                    size: parseSize(width, 150),
                    maxSize: parseSize(maxWidth, 400),
                    meta: {
                        print: print as any,
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

    // Consolidated persisted state (sorting + column sizing)
    const { state: persistedState, setState: setPersistedState } = usePersistedState<TablePersistedState>(
        storageKey,
        { sorting: [], columnSizing: {}, pinnedColumns: [...value.frozen] },
    );
    const sorting = persistedState.sorting;
    const setSorting = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
        setPersistedState(prev => ({
            ...prev,
            sorting: typeof updater === 'function' ? updater(prev.sorting) : updater,
        }));
    }, [setPersistedState]);

    // Controlled selection — `value.selection` carries `mode` /
    // `selected` / `onChange`. When defined the renderer:
    //   1. mirrors `selected` into local `rowSelection` state
    //      (controlled-component pattern, see `useEffect` below)
    //   2. honours `mode` (single / multiple / range) when toggling
    //   3. calls the East-side `onChange` with the new index list
    const selectionConfig = getSomeorUndefined(value.selection) as undefined | {
        mode: { type: "single" | "multiple" | "range" };
        // `selected` and `onChange` live on the IR as plain types (not
        // wrapped in OptionType) — both required when selection is
        // defined.
        selected: bigint[];
        onChange: (idxs: bigint[]) => null;
    };
    const selectionMode = selectionConfig?.mode?.type;
    const selectionSelected = selectionConfig?.selected;
    const selectionOnChange = selectionConfig?.onChange;

    // Row selection state. When `selectionSelected` is defined the IR
    // prop is the source of truth — `rowSelection` is derived directly.
    // When undefined, fall through to local state.
    const isSelectionControlled = selectionSelected !== undefined;
    const [localRowSelection, setLocalRowSelection] = useState<RowSelectionState>({});
    const rowSelection = useMemo<RowSelectionState>(() => {
        if (selectionSelected) {
            const m: RowSelectionState = {};
            for (const idx of selectionSelected) m[String(idx)] = true;
            return m;
        }
        return localRowSelection;
    }, [selectionSelected, localRowSelection]);

    // Track last-clicked index for range-selection (shift+click extends).
    const lastClickedRef = useRef<number | null>(null);

    // Handle row selection changes. Reads from displayed `rowSelection`
    // (which is the IR prop when controlled) so the new selection is
    // computed against the truth. Fires East callbacks and only updates
    // local state in uncontrolled mode.
    const handleRowSelectionChange = useCallback((updater: RowSelectionState | ((prev: RowSelectionState) => RowSelectionState)) => {
        const prev = rowSelection;
        const newSelection = typeof updater === 'function' ? updater(prev) : updater;

        const selectedIndices = Object.keys(newSelection)
            .filter(key => newSelection[key])
            .map(key => BigInt(parseInt(key, 10)));

        // Per-row delta (legacy `onRowSelectionChange`).
        if (onRowSelectionChangeFn) {
            const prevSelected = new Set(Object.keys(prev).filter(key => prev[key]));
            const newSelected = new Set(Object.keys(newSelection).filter(key => newSelection[key]));
            for (const key of newSelected) {
                if (!prevSelected.has(key)) {
                    const rowIndex = BigInt(parseInt(key, 10));
                    queueMicrotask(() => onRowSelectionChangeFn({
                        rowIndex,
                        selected: true,
                        selectedRowsIndices: selectedIndices,
                    }));
                }
            }
            for (const key of prevSelected) {
                if (!newSelected.has(key)) {
                    const rowIndex = BigInt(parseInt(key, 10));
                    queueMicrotask(() => onRowSelectionChangeFn({
                        rowIndex,
                        selected: false,
                        selectedRowsIndices: selectedIndices,
                    }));
                }
            }
        }

        // New `selection.onChange` fires the full selected index list.
        if (selectionOnChange) {
            queueMicrotask(() => selectionOnChange(selectedIndices));
        }

        // Only mutate local state when uncontrolled — when controlled the
        // IR prop drives the next render.
        if (!isSelectionControlled) {
            setLocalRowSelection(newSelection);
        }
    }, [rowSelection, isSelectionControlled, onRowSelectionChangeFn, selectionOnChange]);

    // Toggle a row by index, honouring `selectionMode`. Called by the
    // checkbox column. `shift` enables range-mode extension. Computes
    // the next selection from the displayed `rowSelection` (which is
    // the IR prop when controlled) and delegates to
    // `handleRowSelectionChange` for callback dispatch + local state
    // sync.
    const toggleRowSelection = useCallback((idx: number, shift: boolean) => {
        const prev = rowSelection;
        let next: RowSelectionState;
        const wasSelected = !!prev[String(idx)];
        if (selectionMode === "single") {
            next = wasSelected ? {} : { [String(idx)]: true };
        } else if (selectionMode === "range" && shift && lastClickedRef.current !== null) {
            const lo = Math.min(lastClickedRef.current, idx);
            const hi = Math.max(lastClickedRef.current, idx);
            next = { ...prev };
            for (let i = lo; i <= hi; i++) next[String(i)] = true;
        } else {
            next = { ...prev };
            if (wasSelected) delete next[String(idx)]; else next[String(idx)] = true;
        }
        handleRowSelectionChange(next);
        lastClickedRef.current = idx;
    }, [rowSelection, selectionMode, handleRowSelectionChange]);

    // Handle sorting changes and notify parent
    const handleSortingChange = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
        setSorting(prev => {
            const newSorting = typeof updater === 'function' ? updater(prev) : updater;

            // Convert to external ColumnSort format
            const sorts: ColumnSort[] = newSorting.map(s => ({
                columnKey: s.id,
                direction: s.desc ? 'desc' : 'asc'
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
    }, [onSortChange, onSortChangeFn, setSorting]);

    // Handle cell click
    const handleCellClick = useCallback((rowIndex: bigint, columnKey: string, cellValue: TableCellValue | undefined) => {
        if (onCellClickFn && cellValue?.value !== undefined) {
            queueMicrotask(() => onCellClickFn({ rowIndex, columnKey, cellValue: cellValue.value }));
        }
    }, [onCellClickFn]);

    // Handle cell double click
    const handleCellDoubleClick = useCallback((rowIndex: bigint, columnKey: string, cellValue: TableCellValue | undefined) => {
        if (onCellDoubleClickFn && cellValue?.value !== undefined) {
            queueMicrotask(() => onCellDoubleClickFn({ rowIndex, columnKey, cellValue: cellValue.value }));
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

    // Column sizing (derived from persisted state)
    const columnSizing = persistedState.columnSizing;
    const setColumnSizing = useCallback((updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
        setPersistedState(prev => ({
            ...prev,
            columnSizing: typeof updater === 'function' ? updater(prev.columnSizing) : updater,
        }));
    }, [setPersistedState]);

    // Column pinning: merge East-defined frozen with user-persisted pins
    const pinnedColumns = useMemo(() => persistedState.pinnedColumns ?? [...value.frozen], [persistedState.pinnedColumns, value.frozen]);
    const columnPinning = useMemo(() => ({
        left: pinnedColumns,
        right: [] as string[],
    }), [pinnedColumns]);
    const hasFrozen = pinnedColumns.length > 0;

    const toggleColumnPin = useCallback((columnId: string) => {
        setPersistedState(prev => {
            const current = prev.pinnedColumns ?? [...value.frozen];
            const isPinned = current.includes(columnId);
            return {
                ...prev,
                pinnedColumns: isPinned
                    ? current.filter(id => id !== columnId)
                    : [...current, columnId],
            };
        });
    }, [setPersistedState, value.frozen]);

    // Embedded pagination — `value.pagination` carries `pageSize`,
    // `page` (1-based), and an `onPageChange` callback. When defined,
    // the renderer slices `rows` to the current page on the JS side
    // and renders a small pager beneath the table. Virtualization
    // remains active but only across the page slice.
    const paginationConfig = getSomeorUndefined(value.pagination) as undefined | {
        pageSize: bigint;
        page: bigint;
        // `onPageChange` lives on the IR as a plain `FunctionType` (not
        // wrapped in OptionType) — it's required when pagination is
        // defined.
        onPageChange: (page: bigint) => null;
    };
    const pageSize = paginationConfig ? Number(paginationConfig.pageSize) : undefined;
    // Page index is 0-based per the IR (`TablePaginationType.page` doc).
    const currentPage = paginationConfig ? Number(paginationConfig.page) : 0;
    const paginationOnChange = paginationConfig?.onPageChange;
    const totalPages = pageSize ? Math.max(1, Math.ceil(value.rows.length / pageSize)) : 1;
    // Slice rows to the current page when pagination is active.
    const pagedRows = useMemo(() => {
        if (!pageSize) return value.rows;
        const startIdx = currentPage * pageSize;
        return value.rows.slice(startIdx, startIdx + pageSize);
    }, [value.rows, pageSize, currentPage]);

    // Create table instance
    const table = useReactTable({
        data: pagedRows,
        columns,
        state: {
            sorting,
            columnSizing,
            rowSelection,
            columnPinning,
        },
        onSortingChange: handleSortingChange,
        onColumnSizingChange: setColumnSizing,
        onRowSelectionChange: handleRowSelectionChange,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        enableMultiSort,
        isMultiSortEvent: () => enableMultiSort,
        maxMultiSortColCount: maxSortColumns,
        enableColumnResizing,
        columnResizeMode: 'onChange' as ColumnResizeMode,
        enableRowSelection: true,
        enableColumnPinning: true,
    });

    // Get sorted rows from table
    const { rows } = table.getRowModel();

    // Calculate column size CSS variables for performance
    const columnSizeVars = useMemo(() => {
        const headers = table.getFlatHeaders();
        const colSizes: Record<string, string> = {};

        headers.forEach(header => {
            colSizes[`--header-${header.id}-size`] = `${header.getSize()}px`;
            colSizes[`--col-${header.column.id}-size`] = `${header.column.getSize()}px`;
        });

        return colSizes;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table.getState().columnSizingInfo, table.getState().columnSizing]);

    // Virtual row setup. Density token overrides the default rowHeight
    // unless the consumer passed a JS-side rowHeight prop explicitly.
    const effectiveRowHeight = densityTag ? densityRowHeight : rowHeight;
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => tableContainerRef.current,
        estimateSize: () => effectiveRowHeight,
        overscan,
        // measureElement enables variable-height rows. Required so that
        // rows expanded via `expandedContent` push subsequent rows down
        // by their actual rendered height instead of overlapping.
        measureElement: (el) => el?.getBoundingClientRect().height,
    });

    // Virtual items: when virtualization is off, synthesize a full
    // list of items so the existing render loop walks every row.
    const virtualItems = useMemo(() => {
        if (virtualizationEnabled) return virtualizer.getVirtualItems();
        return rows.map((_r, idx) => ({
            index: idx,
            start: idx * effectiveRowHeight,
            end: (idx + 1) * effectiveRowHeight,
            size: effectiveRowHeight,
            key: idx,
            lane: 0,
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [virtualizationEnabled, virtualizer, rows.length, effectiveRowHeight, virtualizer.getVirtualItems()]);

    // Process visible rows for loading state
    useEffect(() => {
        const currentVisible = new Set<RowKey>();

        virtualItems.forEach(item => {
            currentVisible.add(item.index);
        });

        // Find rows that need loading
        const load: RowKey[] = [];
        currentVisible.forEach(key => {
            const rowState = rowStateManager.getRowState(key);
            if (rowState.status === 'unloaded') {
                load.push(key);
            }
        });

        // Once a row has loaded it stays loaded — we do NOT unload rows that
        // leave the viewport. `measureElement` re-renders the virtualizer on
        // every scroll/measure, so unloading would churn a row back to skeleton
        // (and in a static, non-scrolling view it never settles). The
        // `RowStateManager.cleanup()` cap bounds memory for very large tables.
        if (load.length > 0) {
            if (loadingDelay > 0) {
                rowStateManager.markRowsLoading(load);
                load.forEach(key => rowStateManager.scheduleLoaded(key, loadingDelay));
            } else {
                rowStateManager.markRowsLoaded(load);
            }
        }
    }, [virtualItems, rowStateManager, loadingDelay]);

    // Get sort index for a column (1-based)
    const getSortIndex = useCallback((columnId: string) => {
        const idx = sorting.findIndex(s => s.id === columnId);
        return idx >= 0 ? idx + 1 : undefined;
    }, [sorting]);

    // Total width of pinned columns (for table min-width when frozen)
    const frozenPanelWidth = useMemo(() => {
        if (!hasFrozen) return 0;
        return table.getLeftLeafColumns().reduce((sum, col) => sum + col.getSize(), 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasFrozen, table.getState().columnSizing, table.getState().columnSizingInfo]);

    // ── TanStack pinning styles (applied per-cell) ────────────────────

    const getCommonPinningStyles = (column: ReturnType<typeof table.getAllColumns>[number]): CSSProperties => {
        const isPinned = column.getIsPinned();
        const isLastLeftPinnedColumn = isPinned === 'left' && column.getIsLastColumn('left');

        return {
            borderRight: isLastLeftPinnedColumn ? '2px solid var(--chakra-colors-border, #e2e8f0)' : undefined,
            left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
            right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
            position: isPinned ? 'sticky' : 'relative',
            width: column.getSize(),
            zIndex: isPinned ? 1 : 0,
            backgroundColor: isPinned ? 'var(--chakra-colors-bg-canvas, #fafafa)' : undefined,
        };
    };

    const tableContent = (
        <Box
            ref={tableContainerRef}
            height={(style ? getSomeorUndefined(style.height) : undefined) ?? height}
            overflowY="auto"
            overflowX={hasFrozen ? 'auto' : undefined}
            position="relative"
        >
            <ChakraTable.Root
                {...props}
                size={tableSize}
                style={{
                    ...columnSizeVars,
                    width: hasFrozen ? table.getCenterTotalSize() + frozenPanelWidth : '100%',
                    minWidth: hasFrozen ? table.getCenterTotalSize() + frozenPanelWidth : table.getCenterTotalSize(),
                    tableLayout: 'fixed',
                }}
            >
                <ChakraTable.Header style={{ display: 'block' }} position="sticky" top={0} zIndex={2} bg="bg.canvas">
                    {/* Column-group row — rendered above the column headers when
                        `value.columnGroups` is defined. Each group spans the
                        columns whose keys it lists, computed via CSS `calc()`
                        across the relevant `--col-*-size` variables. */}
                    {(() => {
                        const groups = getSomeorUndefined(value.columnGroups);
                        if (!groups || groups.length === 0) return null;
                        return (
                            <ChakraTable.Row key="column-groups" style={{ display: "flex", width: "100%" }}>
                                {(() => {
                                    // Group-row alignment: when the column-header row uses
                                    // `flex: 1 1 0%` per cell (columns without explicit width
                                    // and no frozen pin), the column cells grow to fill the
                                    // container. To keep group cells aligned, mirror that
                                    // semantic by giving each group cell flex-grow equal to
                                    // the number of columns it spans, with the calc width as
                                    // its min-width. When columns have explicit widths
                                    // (frozen pinning or sized headers), use `flex: none` +
                                    // calc width (no growth, exact alignment).
                                    const groupsRowGrows = !hasFrozen && Object.keys(columnSizing).length === 0
                                        && value.columns.every(c => getSomeorUndefined(c.width) === undefined);
                                    return groups.map((g, gi) => {
                                        const groupKeys: string[] = Array.from(g.columnKeys);
                                        if (groupKeys.length === 0) return null;
                                        const widthCalc = groupKeys.map(k => `var(--col-${k}-size)`).join(" + ");
                                        return (
                                            <ChakraTable.ColumnHeader
                                                key={`group-${gi}`}
                                                bg={headerBackground}
                                                color={headerColor}
                                                style={{
                                                    width: `calc(${widthCalc})`,
                                                    minWidth: `calc(${widthCalc})`,
                                                    flex: groupsRowGrows ? `${groupKeys.length} 1 0%` : "none",
                                                    borderColor,
                                                    paddingLeft: densityCellPadX,
                                                    paddingRight: densityCellPadX,
                                                    paddingTop: densityCellPadY,
                                                    paddingBottom: densityCellPadY,
                                                    textAlign: "center",
                                                    fontWeight: 600,
                                                    // Remove the cell's bottom border so the header
                                                    // row's top border is the single divider —
                                                    // otherwise both rows draw a 1px line at the
                                                    // boundary, doubling up.
                                                    borderBottomWidth: 0,
                                                }}
                                            >
                                                {g.label}
                                            </ChakraTable.ColumnHeader>
                                        );
                                    });
                                })()}
                            </ChakraTable.Row>
                        );
                    })()}
                    {table.getHeaderGroups().map(headerGroup => (
                        <ChakraTable.Row key={headerGroup.id} style={{ display: 'flex', width: '100%' }}>
                            {/* Expand toggle column header — empty placeholder cell. */}
                            {expandedContentFn && (
                                <ChakraTable.ColumnHeader
                                    key="expand-toggle-col-header"
                                    bg={headerBackground}
                                    color={headerColor}
                                    style={{
                                        width: "32px",
                                        flex: "none",
                                        borderColor,
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                    }}
                                />
                            )}
                            {/* Selection checkbox column header — only shown for
                                `multiple` mode (toggles select-all). For `single`
                                / `range` modes the column has no header action. */}
                            {selectionMode && (
                                <ChakraTable.ColumnHeader
                                    key="selection-col-header"
                                    bg={headerBackground}
                                    color={headerColor}
                                    style={{
                                        width: "40px",
                                        flex: "none",
                                        borderColor,
                                        paddingLeft: 0,
                                        paddingRight: 0,
                                        textAlign: "center",
                                    }}
                                >
                                    {selectionMode === "multiple" && (
                                        <input
                                            type="checkbox"
                                            aria-label="Select all rows"
                                            checked={rows.length > 0 && Object.values(rowSelection).filter(Boolean).length === rows.length}
                                            ref={(el) => {
                                                if (el) {
                                                    const some = Object.values(rowSelection).some(Boolean);
                                                    const all = rows.length > 0 && Object.values(rowSelection).filter(Boolean).length === rows.length;
                                                    el.indeterminate = some && !all;
                                                }
                                            }}
                                            onChange={() => {
                                                const all = rows.length > 0 && Object.values(rowSelection).filter(Boolean).length === rows.length;
                                                const next: RowSelectionState = {};
                                                if (!all) for (let i = 0; i < rows.length; i++) next[String(i)] = true;
                                                handleRowSelectionChange(next);
                                            }}
                                        />
                                    )}
                                </ChakraTable.ColumnHeader>
                            )}
                            {headerGroup.headers.map((header) => {
                                const sortIndex = getSortIndex(header.id);
                                const isSorted = header.column.getIsSorted();
                                const sortDirection = isSorted || null;
                                const icon = !isSorted ? faAnglesDown : sortDirection === 'asc' ? faChevronUp : faChevronDown;
                                const pinningStyles = hasFrozen ? getCommonPinningStyles(header.column) : {};
                                const isPinned = header.column.getIsPinned();

                                return (
                                    <ChakraTable.ColumnHeader
                                        key={header.id}
                                        css={tableSlotStyles.columnHeader}
                                        bg={headerBackground}
                                        color={headerColor}
                                        // Reveal the pin / sort controls only on header-cell
                                        // hover; an actively pinned / sorted column keeps them
                                        // visible (handled by the controls' own opacity below).
                                        _hover={{ bg: headerBackground ?? 'bg.muted', "& .col-controls": { opacity: 1 }, "& .col-resizer::before": { opacity: 1 } }}
                                        transition="background 0.2s"
                                        style={{
                                            width: `var(--header-${header.id}-size)`,
                                            flex: hasFrozen ? 'none' : (columnSizing[header.id] || header.column.columnDef.meta?.width) ? 'none' : 1,
                                            ...pinningStyles,
                                            zIndex: isPinned ? 3 : undefined,
                                            borderColor: borderColor,
                                            // Clamp the header to the body row height — the inline
                                            // pin/sort controls would otherwise grow it taller than
                                            // the spec's single-rule header band.
                                            height: `${effectiveRowHeight}px`,
                                            // Center the label + controls vertically (the th is not a
                                            // flex container by default, so without this the content
                                            // sits at the top while body cells are centered).
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                        position={isPinned ? "sticky" : "relative"}
                                    >
                                        <HStack justify="space-between" align="center" width="100%" pr={enableColumnResizing ? "4px" : "0"}>
                                            {/* Inherit the columnHeader slot's mono/10px/0.16em/uppercase/
                                                fg.subtle — a bare span so the recipe governs the type,
                                                not a competing textStyle. */}
                                            <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" flex="1">
                                                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                            </Box>
                                            <HStack className="col-controls" gap={0} flexShrink={0} alignItems="center"
                                                opacity={isPinned || isSorted ? 1 : 0} transition="opacity 0.15s">
                                                {/* Pin toggle — always visible */}
                                                <Box
                                                    as="button"
                                                    aria-label={isPinned ? `Unpin ${header.id}` : `Pin ${header.id}`}
                                                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggleColumnPin(header.id); }}
                                                    color={isPinned ? "fg.default" : "fg.muted"}
                                                    _hover={{ color: "fg.default", bg: "bg.emphasized" }}
                                                    transition="color 0.15s"
                                                    cursor="pointer"
                                                    display="flex"
                                                    alignItems="center"
                                                    justifyContent="center"
                                                    w="24px" h="24px"
                                                    borderRadius="sm"
                                                >
                                                    <FontAwesomeIcon icon={faThumbtack} style={{ width: '10px', height: '10px', transform: isPinned ? undefined : 'rotate(45deg)' }} />
                                                </Box>
                                                {/* Sort button */}
                                                {header.column.getCanSort() && (
                                                    <Box
                                                        as="button"
                                                        aria-label={`Sort by ${header.id}`}
                                                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); header.column.toggleSorting(undefined, enableMultiSort); }}
                                                        color={isSorted ? "fg.default" : "fg.muted"}
                                                        _hover={{ color: "fg.default", bg: "bg.emphasized" }}
                                                        cursor="pointer"
                                                        display="flex"
                                                        alignItems="center"
                                                        justifyContent="center"
                                                        w="24px" h="24px"
                                                        borderRadius="sm"
                                                        position="relative"
                                                    >
                                                        <FontAwesomeIcon icon={icon} style={{ width: '10px', height: '10px' }} />
                                                        {isSorted && sortIndex && enableMultiSort && (
                                                            <Text fontSize="7px" fontWeight="bold" color="fg.muted" lineHeight="1" position="absolute" top="4px" right="4px">
                                                                {sortIndex}
                                                            </Text>
                                                        )}
                                                    </Box>
                                                )}
                                            </HStack>
                                        </HStack>
                                        {enableColumnResizing && header.column.getCanResize() && (
                                            <Box
                                                className="col-resizer"
                                                position="absolute" right="0" top="0" bottom="0" width="6px" cursor="ew-resize" bg="transparent"
                                                _hover={{ _before: { opacity: 1, bg: 'fg.muted' } }}
                                                transition="all 0.2s" zIndex={10}
                                                onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()}
                                                // Spec resize grip (.mx-bar .seg .resize-handle): full-height
                                                // 6px ew-resize hit-zone with a 1px line spanning the middle
                                                // 40% (top/bottom 30%). Hidden at rest so the static header
                                                // matches the bare `.dt`; revealed on header-cell hover via
                                                // the ColumnHeader `_hover`, like the pin/sort controls.
                                                _before={{ content: '""', position: 'absolute', right: '2px', top: '30%', bottom: '30%', width: '1px', bg: 'gray.300', opacity: 0, transition: 'opacity 0.2s' }}
                                            />
                                        )}
                                    </ChakraTable.ColumnHeader>
                                );
                            })}
                        </ChakraTable.Row>
                    ))}
                </ChakraTable.Header>

                <ChakraTable.Body
                    style={{
                        display: 'block',
                        position: 'relative',
                        height: `${virtualizer.getTotalSize()}px`,
                    }}
                >
                    {virtualItems.map(virtualRow => {
                        const row = rows[virtualRow.index];
                        if (!row) return null;

                        const rowKey = virtualRow.index;
                        const rowState = rowStates.get(rowKey) || { status: 'unloaded' };
                        const isRowLoading = !rowStateManager.isRowLoaded(rowKey) || rowState.status === 'loading';
                        const rowIndex = BigInt(row.index);
                        const isSelected = !!row.getIsSelected?.();
                        const isOdd = virtualRow.index % 2 === 1;

                        // Background priority: rowStatus > selected > zebra
                        // (when striped on odd row) > undefined.
                        // Note: virtualizer wraps each row in a `<div>`, which
                        // breaks Chakra's `:nth-child` zebra. Apply zebra
                        // inline. Default uses a translucent black overlay so
                        // it always contrasts against the row beneath in both
                        // light and dark themes (Chakra colour tokens like
                        // `bg-muted` can resolve to the same value as the
                        // table base in some palettes, leaving stripes
                        // invisible).
                        const rowStatusBg = rowStatusBgFor(virtualRow.index);
                        // Default zebra: Chakra's `bg.subtle` token (mode-aware,
                        // distinct from the base table bg in both light and dark
                        // themes). Falls back to a 12% currentColor mix for browsers
                        // / themes where the token isn't defined.
                        const stripedZebra = props.striped && isOdd
                            ? (zebraBackground ?? "var(--chakra-colors-bg-subtle, color-mix(in srgb, currentColor 12%, transparent))")
                            : undefined;
                        const rowBg = rowStatusBg
                            ?? (isSelected ? selectedBackground : undefined)
                            ?? stripedZebra;

                        const isExpanded = expandedRows.has(virtualRow.index);

                        return (
                            <div
                                key={row.id}
                                data-index={virtualRow.index}
                                ref={virtualizer.measureElement}
                                style={{
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    width: "100%",
                                    transform: `translateY(${virtualRow.start}px)`,
                                    // Apply zebra / status / selected bg here on the
                                    // wrapper (no Chakra CSS class) instead of the
                                    // <tr>. The Chakra-emotion class on the <tr>
                                    // applies its own bg in some themes which can
                                    // override an inline `style` even though that
                                    // shouldn't normally happen — applying here
                                    // guarantees the bg shows through.
                                    background: rowBg,
                                }}
                            >
                            <ChakraTable.Row
                                data-selected={isSelected ? "true" : undefined}
                                style={{
                                    display: 'flex',
                                    width: '100%',
                                    // minHeight (not a fixed height) so a row with wrapping
                                    // cell content (e.g. a tags column) grows to fit instead
                                    // of clipping into the next row; `measureElement` reports
                                    // the true height back to the virtualizer.
                                    minHeight: `${effectiveRowHeight}px`,
                                    cursor: (onRowClickFn || onRowDoubleClickFn) ? 'pointer' : undefined,
                                    background: "transparent",
                                    boxShadow: isSelected && selectedBorderColor
                                        ? `inset 0 0 0 2px ${selectedBorderColor}`
                                        : undefined,
                                }}
                                {...(hoverBackground ? { _hover: { bg: hoverBackground } } : {})}
                                onClick={onRowClickFn ? () => handleRowClick(rowIndex) : undefined}
                                onDoubleClick={onRowDoubleClickFn ? () => handleRowDoubleClick(rowIndex) : undefined}
                            >
                                {/* Selection checkbox cell — fires `toggleRowSelection`
                                    which honours `selectionMode` (single / multiple /
                                    range). Stops click propagation so it doesn't fire
                                    `onRowClick`. */}
                                {selectionMode && (
                                    <ChakraTable.Cell
                                        key="selection"
                                        style={{
                                            width: "40px",
                                            flex: "none",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            padding: 0,
                                            borderColor,
                                            background: "transparent",
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <input
                                            type={selectionMode === "single" ? "radio" : "checkbox"}
                                            checked={isSelected}
                                            aria-label={`Select row ${virtualRow.index + 1}`}
                                            onChange={() => toggleRowSelection(virtualRow.index, false)}
                                            onClick={(e) => {
                                                if (e.shiftKey) {
                                                    e.preventDefault();
                                                    toggleRowSelection(virtualRow.index, true);
                                                }
                                            }}
                                        />
                                    </ChakraTable.Cell>
                                )}
                                {/* Expand toggle button cell */}
                                {expandedContentFn && (
                                    <ChakraTable.Cell
                                        key="expand-toggle"
                                        style={{
                                            width: "32px",
                                            flex: "none",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            padding: 0,
                                            background: "transparent",
                                            borderColor,
                                        }}
                                        onClick={(e) => { e.stopPropagation(); toggleExpanded(virtualRow.index); }}
                                    >
                                        <Box
                                            as="button"
                                            aria-label={isExpanded ? "Collapse row" : "Expand row"}
                                            aria-expanded={isExpanded}
                                            cursor="pointer"
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="center"
                                            w="24px" h="24px"
                                            borderRadius="sm"
                                            color="fg.muted"
                                            _hover={{ color: "fg.default", bg: "bg.emphasized" }}
                                            transition="transform 0.15s"
                                            transform={isExpanded ? "rotate(90deg)" : "none"}
                                        >
                                            <FontAwesomeIcon icon={faChevronRight} style={{ width: 10, height: 10 }} />
                                        </Box>
                                    </ChakraTable.Cell>
                                )}
                                {row.getVisibleCells().map((cell) => {
                                    const cellValue = cell.getValue() as TableCellValue | undefined;
                                    const meta = cell.column.columnDef.meta;
                                    const columnKey = meta?.columnKey ?? cell.column.id;
                                    const pinningStyles = hasFrozen ? getCommonPinningStyles(cell.column) : {};

                                    const cellStyle: React.CSSProperties = {
                                        width: `var(--col-${cell.column.id}-size)`,
                                        flex: hasFrozen ? 'none' : (columnSizing[cell.column.id] || meta?.width) ? 'none' : 1,
                                        display: 'flex',
                                        // Spec `.dt` reads vertically centered (its rows hug
                                        // content, so its `vertical-align: top` is moot); our
                                        // rows have a fixed height, so center is the faithful
                                        // match — flex-start would float text to the top.
                                        alignItems: 'center',
                                        overflow: 'hidden',
                                        // padding comes from the `table` slot recipe (size variant)
                                        borderColor,
                                        // Transparent cell bg so the wrapper-div's
                                        // zebra / status / selected bg shows through.
                                        // Pinned cells override below to keep their
                                        // sticky-column bg.
                                        background: pinningStyles.backgroundColor ?? "transparent",
                                        ...pinningStyles,
                                    };

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
                                            <ChakraTable.Cell key={cell.id} css={tableSlotStyles.cell} style={cellStyle}>
                                                <Skeleton height="20px" width="80%" />
                                            </ChakraTable.Cell>
                                        );
                                    }

                                    if (cellValue == null) {
                                        return (
                                            <ChakraTable.Cell
                                                key={cell.id}
                                                css={tableSlotStyles.cell} style={cellStyle}
                                                onClick={cellClickHandler}
                                                onDoubleClick={cellDoubleClickHandler}
                                            />
                                        );
                                    }

                                    // 1. Column render function takes priority
                                    if (meta?.renderFn) {
                                        const rendered = meta.renderFn({
                                            rowIndex: rowIndex,
                                            columnKey,
                                            cellValue: cellValue.value,
                                        });
                                        return (
                                            <ChakraTable.Cell
                                                key={cell.id}
                                                css={tableSlotStyles.cell} style={cellStyle}
                                                onClick={cellClickHandler}
                                                onDoubleClick={cellDoubleClickHandler}
                                            >
                                                <EastChakraComponent value={rendered} storageKey={`${storageKey}.render.${cell.column.id}`} />
                                            </ChakraTable.Cell>
                                        );
                                    }

                                    // 2. Pre-built cell content (e.g. default Text.Root)
                                    const cellContent = getSomeorUndefined(cellValue.content);
                                    if (cellContent != null) {
                                        return (
                                            <ChakraTable.Cell
                                                key={cell.id}
                                                css={tableSlotStyles.cell} style={cellStyle}
                                                onClick={cellClickHandler}
                                                onDoubleClick={cellDoubleClickHandler}
                                            >
                                                <EastChakraComponent value={cellContent} storageKey={`${storageKey}.cell.${cell.column.id}`} />
                                            </ChakraTable.Cell>
                                        );
                                    }

                                    // 3. Fallback: print the raw value
                                    return (
                                        <ChakraTable.Cell
                                            key={cell.id}
                                            css={tableSlotStyles.cell} style={cellStyle}
                                            onClick={cellClickHandler}
                                            onDoubleClick={cellDoubleClickHandler}
                                        >
                                            <Text>{meta?.print?.(cellValue.value.value) ?? null}</Text>
                                        </ChakraTable.Cell>
                                    );
                                })}
                            </ChakraTable.Row>
                            {/* Expandable detail panel — rendered when this row is in
                                `expandedRows`. Spans the full table width. The wrapper
                                <div>'s `measureElement` ref reports the combined height
                                back to the virtualizer so subsequent rows are
                                positioned correctly. */}
                            {expandedContentFn && isExpanded && (() => {
                                const detail = expandedContentFn(rowIndex);
                                return (
                                    <Box
                                        bg="bg.subtle"
                                        borderTop="1px solid"
                                        borderBottom="1px solid"
                                        borderColor={borderColor ?? "border.subtle"}
                                        padding="3"
                                    >
                                        <EastChakraComponent
                                            value={detail as Parameters<typeof EastChakraComponent>[0]["value"]}
                                            storageKey={`${storageKey}.expand.${virtualRow.index}`}
                                        />
                                    </Box>
                                );
                            })()}
                            </div>
                        );
                    })}
                </ChakraTable.Body>

                {/* Footer rows — `value.footer` is a single dict, `value.footerRows` is
                    an array of dicts. The renderer concatenates: any single-row footer
                    is treated as the first entry of the multi-row list. Each footer
                    cell carries `content?: UIComponent` and `colSpan?: number`. */}
                {(() => {
                    const singleFooter = getSomeorUndefined(value.footer);
                    const multiFooterRows = getSomeorUndefined(value.footerRows);
                    const footerRows: Array<Map<string, { content: any; colSpan: any }>> = [];
                    if (singleFooter) footerRows.push(singleFooter as any);
                    if (multiFooterRows) for (const r of multiFooterRows) footerRows.push(r as any);
                    if (footerRows.length === 0) return null;
                    return (
                        <ChakraTable.Footer style={{ display: "block" }}>
                            {footerRows.map((rowMap, rowIdx) => {
                                // Walk columns in order; emit a footer cell per column,
                                // skipping any columns "consumed" by an earlier cell's
                                // colSpan. Footer cells with `colSpan: n` widen to span
                                // n columns horizontally.
                                const cells: React.ReactNode[] = [];
                                let skip = 0;
                                for (let i = 0; i < value.columns.length; i++) {
                                    if (skip > 0) { skip--; continue; }
                                    const colKey = value.columns[i]!.key;
                                    const cellEntry = rowMap.get?.(colKey);
                                    const span = cellEntry ? Number(getSomeorUndefined(cellEntry.colSpan) ?? 1n) : 1;
                                    skip = span - 1;
                                    const widthVar = Array.from({ length: span }, (_, k) =>
                                        `var(--col-${value.columns[i + k]!.key}-size)`
                                    ).join(" + ");
                                    // Footer alignment: when columns are flexible (no
                                    // frozen pin, no explicit widths), each footer cell
                                    // grows in proportion to the columns it spans. When
                                    // columns have explicit widths, use `flex: none` +
                                    // calc width for exact alignment.
                                    const footerRowGrows = !hasFrozen && Object.keys(columnSizing).length === 0
                                        && value.columns.every(c => getSomeorUndefined(c.width) === undefined);
                                    const widthCalc = span > 1 ? `calc(${widthVar})` : `var(--col-${colKey}-size)`;
                                    const cellStyle: React.CSSProperties = {
                                        width: widthCalc,
                                        minWidth: widthCalc,
                                        flex: footerRowGrows ? `${span} 1 0%` : "none",
                                        display: "flex",
                                        alignItems: "center",
                                        overflow: "hidden",
                                        paddingLeft: densityCellPadX,
                                        paddingRight: densityCellPadX,
                                        paddingTop: densityCellPadY,
                                        paddingBottom: densityCellPadY,
                                        background: footerBackground,
                                        borderColor,
                                        fontWeight: 600,
                                    };
                                    // `content` on the IR footer cell is `UIComponentType`
                                    // (not OptionType), so read directly — wrapping in
                                    // `getSomeorUndefined` would always yield undefined.
                                    const content = cellEntry?.content;
                                    cells.push(
                                        <ChakraTable.Cell key={`${rowIdx}-${colKey}`} css={tableSlotStyles.cell} style={cellStyle}>
                                            {content ? (
                                                <EastChakraComponent
                                                    value={content as Parameters<typeof EastChakraComponent>[0]["value"]}
                                                    storageKey={`${storageKey}.footer.${rowIdx}.${colKey}`}
                                                />
                                            ) : null}
                                        </ChakraTable.Cell>
                                    );
                                }
                                return (
                                    <ChakraTable.Row key={`footer-${rowIdx}`} style={{ display: "flex", width: "100%" }}>
                                        {cells}
                                    </ChakraTable.Row>
                                );
                            })}
                        </ChakraTable.Footer>
                    );
                })()}
            </ChakraTable.Root>
            {/* Embedded pagination — rendered beneath the table when
                `value.pagination` is defined. Calls the East-side
                onChange (when present) with the new page (1-based). */}
            {paginationConfig && !hidePaginationBand && (
                <HStack gap="2" justify="flex-end" px="3" py="2" borderTop="1px solid" borderColor="border.subtle">
                    <Text fontSize="sm" color="fg.muted">
                        Page {currentPage + 1} of {totalPages} ({value.rows.length} total)
                    </Text>
                    <button
                        type="button"
                        aria-label="Previous page"
                        disabled={currentPage <= 0}
                        style={{
                            cursor: currentPage <= 0 ? "not-allowed" : "pointer",
                            opacity: currentPage <= 0 ? 0.4 : 1,
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "none",
                            background: "transparent",
                        }}
                        onClick={() => {
                            if (currentPage <= 0) return;
                            if (paginationOnChange) queueMicrotask(() => paginationOnChange(BigInt(currentPage - 1)));
                        }}
                    >
                        <FontAwesomeIcon icon={faChevronLeft} style={{ width: 10, height: 10 }} />
                    </button>
                    <button
                        type="button"
                        aria-label="Next page"
                        disabled={currentPage >= totalPages - 1}
                        style={{
                            cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer",
                            opacity: currentPage >= totalPages - 1 ? 0.4 : 1,
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "none",
                            background: "transparent",
                        }}
                        onClick={() => {
                            if (currentPage >= totalPages - 1) return;
                            if (paginationOnChange) queueMicrotask(() => paginationOnChange(BigInt(currentPage + 1)));
                        }}
                    >
                        <FontAwesomeIcon icon={faChevronRight} style={{ width: 10, height: 10 }} />
                    </button>
                </HStack>
            )}
        </Box>
    );

    // A density set on the table cascades to display components rendered in
    // its cells (Tag, Trace, ChipRail, …) so a whole surface tightens with one
    // prop; cells without a density keep their standalone look when the table
    // has none.
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{tableContent}</DensityProvider>
        : tableContent;
};

/**
 * The exported Table renderer. Without `slice` it renders the bare table.
 * With the `slice` chrome option it renders the frame chassis itself — a
 * header rail mounting the listed affordances (the shared `SliceRailCluster`
 * ladder) and a derived-count footer. Chrome only: the rows are whatever the
 * host fed (`Slice.rows([RowType], slice)` upstream); the table never
 * narrows its own data.
 */
export const EastChakraTable = memo(function EastChakraTable(props: EastChakraTableProps) {
    const chrome = getSomeorUndefined(props.value.slice as never) as
        { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined;
    const slice = chrome?.slice as ValueTypeOf<typeof SliceInternal.Types.Bind> | undefined;
    useSliceReactivity(slice?.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })();
    if (chrome === undefined || slice === undefined) return <TableCore {...props} />;

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    const affordanceKinds = state.cohorts.length > 0 && !configuredKinds.includes("cohort")
        ? [...configuredKinds, "cohort"]
        : configuredKinds;
    const total = Number(slice.totalCount() as bigint);
    const result = Number(slice.resultCount() as bigint);
    const pct = total > 0 ? Math.round((1 - result / total) * 100) : 0;

    // With pagination enabled the pager joins the chrome footer (count left,
    // pager right) — one band, not two.
    const paginationConfig = getSomeorUndefined(props.value.pagination) as undefined | {
        pageSize: bigint; page: bigint; onPageChange?: (page: bigint) => void;
    };
    const pageSize = paginationConfig ? Number(paginationConfig.pageSize) : 0;
    const currentPage = paginationConfig ? Number(paginationConfig.page) : 0;
    const totalPages = paginationConfig ? Math.max(1, Math.ceil(props.value.rows.length / pageSize)) : 1;
    const pagerOnChange = paginationConfig?.onPageChange;

    return (
        <Box css={frameStyles.root}>
            <Box css={frameStyles.frameEyebrow}>
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            <Box css={frameStyles.frameBody}>
                <TableCore {...props} hidePaginationBand />
            </Box>
            <Box css={frameStyles.frameFooter}>
                <Box as="span" css={frameStyles.frameFooterStat}>{result.toLocaleString()}</Box>
                <Box as="span">{`rows · of ${total.toLocaleString()}`}</Box>
                {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${pct}%`}</Box>}
                {paginationConfig && (
                    <Box display="inline-flex" alignItems="center" gap="{spacing.1.5}" marginLeft="auto">
                        <Box as="span">{`page ${currentPage + 1} of ${totalPages}`}</Box>
                        <chakra.button
                            type="button"
                            aria-label="Previous page"
                            disabled={currentPage <= 0}
                            cursor={currentPage <= 0 ? "not-allowed" : "pointer"}
                            opacity={currentPage <= 0 ? 0.4 : 1}
                            onClick={() => {
                                if (currentPage <= 0 || !pagerOnChange) return;
                                queueMicrotask(() => pagerOnChange(BigInt(currentPage - 1)));
                            }}
                        >
                            <FontAwesomeIcon icon={faChevronLeft} style={{ width: 9, height: 9 }} />
                        </chakra.button>
                        <chakra.button
                            type="button"
                            aria-label="Next page"
                            disabled={currentPage >= totalPages - 1}
                            cursor={currentPage >= totalPages - 1 ? "not-allowed" : "pointer"}
                            opacity={currentPage >= totalPages - 1 ? 0.4 : 1}
                            onClick={() => {
                                if (currentPage >= totalPages - 1 || !pagerOnChange) return;
                                queueMicrotask(() => pagerOnChange(BigInt(currentPage + 1)));
                            }}
                        >
                            <FontAwesomeIcon icon={faChevronRight} style={{ width: 9, height: 9 }} />
                        </chakra.button>
                    </Box>
                )}
            </Box>
        </Box>
    );
}, (prev, next) => tableRootEqual(prev.value, next.value));
