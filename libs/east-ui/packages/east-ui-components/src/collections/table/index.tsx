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
import { parseCssSize } from "../../style/parse-size.js";
import { virtualScrollbarCss } from "../../style/scrollbar.js";
import { coarseHitArea } from "../../style/hit-area.js";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { RowStateManager, type RowKey, type RowState } from "../../utils/RowStateManager";
import { useRowStatusBg, useDensityHeights } from "../shared/helpers";
import { useReviewController, DecisionButtons, ReviewFoot, DECISION_WIDTH, type ApprovalOptionValue } from "../shared/review";
import { DensityProvider } from "../../contracts/density";
import { usePlotGutter, gutterPx } from "../../contracts/plot-gutter.js";
import { useTablePagedRows, type TablePagedSourceValue } from "./use-paged-rows.js";

/* Touch (#351): 36px tap halo on the 24px pin/sort/expander controls (36,
 * not 44 — the controls sit adjacent; full halos would swallow each other). */
const coarseControlHalo = coarseHitArea({ position: true, size: 36 });

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

/** Paged transport state (#576) — what the chrome reports, and what disables
 *  the affordances that would lie over a partial corpus. */
export interface TableTransport {
    /** Source elements whose window has landed. */
    loaded: number;
    /** The source's total element count, once known. */
    total: number | undefined;
    /** Whether a window is still in flight. */
    loading: boolean;
    /** Whether the loaded rows are an INCOMPLETE prefix of the source. */
    partial: boolean;
}

/** The synthetic Decision column's TanStack id (#264). */
const REVIEW_COLUMN_ID = "__review__";

/** One decoded table cell — a LiteralValue variant ({ type, value }). */
type TableCellVariant = ValueTypeOf<typeof Table.Types.Cell>;

/** Row grouping (#317): fold member cell values into one aggregate cell. */
function computeAggregate(tag: string, cells: TableCellVariant[]): TableCellVariant {
    if (tag === "count") return variant("Integer", BigInt(cells.length)) as TableCellVariant;
    if (cells.length === 0) return variant("Null", null) as TableCellVariant;
    const kind = cells[0]!.type;
    if (tag === "sum" || tag === "mean") {
        // Factory-validated: sum/mean columns are Integer or Float.
        const nums = cells.map(c => typeof c.value === "bigint" ? Number(c.value) : (c.value as number));
        const sum = nums.reduce((a, b) => a + b, 0);
        if (tag === "mean") return variant("Float", sum / nums.length) as TableCellVariant;
        return kind === "Integer"
            ? variant("Integer", (cells as { value: bigint }[]).reduce((a, c) => a + c.value, 0n)) as TableCellVariant
            : variant("Float", sum) as TableCellVariant;
    }
    // min / max — native ordering over the column's primitive values.
    let best = cells[0]!;
    for (const c of cells) {
        const a = c.value as number | bigint | string | Date | boolean;
        const b = best.value as number | bigint | string | Date | boolean;
        if (tag === "min" ? a < b : a > b) best = c;
    }
    return best;
}

/** Row grouping (#317): default text for an aggregated value (no `aggregateRender`). */
function formatAggregate(cell: TableCellVariant): string {
    switch (cell.type) {
        case "Integer": return (cell.value as bigint).toLocaleString("en-US");
        case "Float": return (cell.value as number).toLocaleString("en-US", { maximumFractionDigits: 2 });
        case "DateTime": return (cell.value as Date).toISOString().slice(0, 10);
        case "Boolean": return String(cell.value);
        case "String": return cell.value as string;
        default: return "\u2014";
    }
}

interface TablePersistedState {
    sorting: SortingState;
    columnSizing: Record<string, number>;
    pinnedColumns: string[];
    /** Top visible ROW INDEX (not a pixel offset) — restored on mount, clamped to
     *  the current row count. A clamped index survives data changes where a raw
     *  scrollTop would not (#143). */
    scrollIndex?: number;
    /** Row grouping (#317): per group-path collapse overrides. Absent paths
     *  fall back to the level's default `collapsed`. */
    groupCollapse?: Record<string, boolean>;
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
    rows: sourceRows,
    transport,
}: EastChakraTableProps & {
    hidePaginationBand?: boolean;
    /** The resolved row collection — the whole inline array, or the loaded
     *  prefix of a paged source. Resolved by the exported wrapper so the core
     *  sees ONE row space either way (#576). */
    rows: TableRowValue[];
    transport?: TableTransport | undefined;
}) {
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
    // single source) — md → 36px, the spec
    // row height. Pad-Y stays here for the group/footer cells that set padding
    // via raw inline style outside the recipe's cell slot.
    const densityPadYPx = tableSize === "sm" ? 6 : tableSize === "lg" ? 12 : 10;
    const densityRowHeight = useDensityHeights(tableSize).row;
    // Explicit pixel row-height override (IR `style.rowHeight`) — wins over the
    // density preset and is fed to the virtualizer; non-expanded rows are
    // clamped to it below so estimate == measured (#127).
    const rowHeightOverride = style ? getSomeorUndefined(style.rowHeight) : undefined;
    const explicitRowHeight = rowHeightOverride !== undefined ? Number(rowHeightOverride) : undefined;
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
    // Chakra generates the "table" slot union from ITS built-in table recipe,
    // so our custom groupHead slots (#317) need a wider view of the result.
    const tableGroupSlotStyles = tableSlotStyles as unknown as Record<string, React.CSSProperties>;

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
    // semantic token (the shared helper).
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

    // ── Review chrome (optional, #264) ────────────────────────────────────
    // The shared per-row Approve/Reject Decision column (a synthetic
    // pinned-right TanStack column riding the existing sticky rails) + the
    // commitBar batch foot below the pager. Decisions are keyed by the
    // UNSLICED row index — stable under sorting AND pagination (the
    // `expandedContent` convention).
    const review = useMemo(() => getSomeorUndefined(value.review), [value.review]);
    const hasReview = review !== undefined;
    const reviewStatusFn = useMemo(() => getSomeorUndefined(value.reviewStatus) as
        ((rowIndex: bigint) => { type: "some" | "none"; value: unknown }) | undefined, [value.reviewStatus]);
    const reviewApprovalFn = useMemo(() => getSomeorUndefined(value.reviewApproval) as
        ((rowIndex: bigint) => ApprovalOptionValue) | undefined, [value.reviewApproval]);
    const reviewApprovals = useMemo(
        () => sourceRows.map((_row: TableRowValue, i: number) => reviewApprovalFn?.(BigInt(i))),
        [sourceRows, reviewApprovalFn],
    );
    const reviewController = useReviewController(review, reviewApprovals);
    const reviewChromeRecipe = useSlotRecipe({ key: "reviewChrome" });
    const reviewChrome = useMemo(() => reviewChromeRecipe({}) as Record<string, Record<string, unknown>>, [reviewChromeRecipe]);
    const reviewDotStyles = useMemo(() => {
        const out: Record<string, Record<string, unknown>> = {};
        for (const t of ["success", "warning", "danger", "info", "neutral"]) out[t] = (reviewChromeRecipe({ status: t } as Record<string, unknown>) as Record<string, Record<string, unknown>>).statusDot ?? {};
        return out;
    }, [reviewChromeRecipe]);

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
            // `render` is required on the IR column (the factory synthesizes a
            // text default when the author omits it) — no Option to unwrap.
            const renderFn = col.render as unknown as ColumnRenderFn;

            return columnHelper.accessor(
                (row) => row.get(col.key),
                {
                    id: col.key,
                    header: getSomeorUndefined(col.header) ?? col.key,
                    // Client sort over a PARTIAL corpus sorts "within whatever
                    // happened to load", which reads as a sort of the whole
                    // table and is simply wrong (#576). The affordance is
                    // withdrawn rather than allowed to lie; the footer says so.
                    enableSorting: transport === undefined,
                    sortingFn: (rowA, rowB, columnId) => {
                        const cellA = rowA.original.get(columnId);
                        const cellB = rowB.original.get(columnId);
                        // Cells are bare LiteralValueType variants — `.value` is the payload.
                        const valA = cellA?.value;
                        const valB = cellB?.value;
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
    }, [value.columns, columnHelper, transport]);

    // The synthetic Decision column — a display column pinned right, sized to
    // the shared DECISION_WIDTH; header + cells wear the reviewChrome slots.
    const allColumns = useMemo<ColumnDef<TableRowValue, TableCellValue | undefined>[]>(() => {
        if (!hasReview || review === undefined) return columns;
        return [...columns, columnHelper.display({
            id: REVIEW_COLUMN_ID,
            header: review.columnLabel,
            enableSorting: false,
            enableResizing: false,
            enablePinning: true,
            size: parseInt(DECISION_WIDTH, 10),
            meta: { columnKey: REVIEW_COLUMN_ID, width: DECISION_WIDTH },
        })];
    }, [columns, columnHelper, hasReview, review]);

    // Consolidated persisted state (sorting + column sizing)
    const { state: persistedState, setState: setPersistedState } = usePersistedState<TablePersistedState>(
        storageKey,
        { sorting: [], columnSizing: {}, pinnedColumns: [...value.frozen], scrollIndex: 0 },
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
        if (onCellClickFn && cellValue !== undefined) {
            // The event's cellValue is the LiteralValueType variant itself.
            queueMicrotask(() => onCellClickFn({ rowIndex, columnKey, cellValue }));
        }
    }, [onCellClickFn]);

    // Handle cell double click
    const handleCellDoubleClick = useCallback((rowIndex: bigint, columnKey: string, cellValue: TableCellValue | undefined) => {
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
        // The synthetic Decision column pins right so it stays visible while
        // the columns scroll (#264).
        right: hasReview ? [REVIEW_COLUMN_ID] : [] as string[],
    }), [pinnedColumns, hasReview]);
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
    const totalPages = pageSize ? Math.max(1, Math.ceil(sourceRows.length / pageSize)) : 1;
    // Slice rows to the current page when pagination is active. (A paged source
    // refuses `pagination` at build time — one paging mechanism, not two.)
    const pagedRows = useMemo(() => {
        if (!pageSize) return sourceRows;
        const startIdx = currentPage * pageSize;
        return sourceRows.slice(startIdx, startIdx + pageSize);
    }, [sourceRows, pageSize, currentPage]);

    // Create table instance
    const table = useReactTable({
        data: pagedRows,
        columns: allColumns,
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

    // ── Row grouping (#317) ─────────────────────────────────────────────────
    // Fold the sorted row model into a DISPLAY LIST of group header entries +
    // leaf rows. Groups keep FIRST-APPEARANCE data order (a P&L's Revenue
    // stays above Cost of Sales under any sort); sorting reorders members
    // WITHIN their group. Collapsed groups (persisted per path, defaulting to
    // the level's `collapsed`) contribute only their header — which carries
    // the per-column aggregates, so a collapsed group reads as its subtotal.
    const groupLevels = useMemo(() => getSomeorUndefined(value.groupBy), [value.groupBy]);
    const groupAggByKey = useMemo(() => {
        const out = new Map<string, { tag: string; renderFn: ((v: TableCellVariant) => unknown) | undefined }>();
        for (const col of value.columns) {
            const agg = getSomeorUndefined(col.aggregate);
            if (agg === undefined) continue;
            out.set(col.key, { tag: agg.type, renderFn: getSomeorUndefined(col.aggregateRender) as ((v: TableCellVariant) => unknown) | undefined });
        }
        return out;
    }, [value.columns]);
    type GroupEntry = { kind: "group"; path: string; depth: number; label: string; count: number; collapsed: boolean; aggregates: Map<string, TableCellVariant> };
    type DisplayEntry = GroupEntry | { kind: "leaf"; row: (typeof rows)[number] };
    const groupCollapse = persistedState.groupCollapse;
    const displayRows: DisplayEntry[] | undefined = useMemo(() => {
        if (groupLevels === undefined || groupLevels.length === 0) return undefined;
        const pageOffset = pageSize ? currentPage * pageSize : 0;
        const rankByIndex = new Map<number, number>();
        rows.forEach((r, i) => rankByIndex.set(r.index, i));
        const rowByIndex = new Map(rows.map(r => [r.index, r]));
        type Node = { path: string; depth: number; label: string; children: Map<string, Node>; order: Node[]; members: number[] };
        const root: Node = { path: "", depth: -1, label: "", children: new Map(), order: [], members: [] };
        // First-appearance order over the (page-sliced) data indices.
        const sliceSize = rows.length;
        for (let i = 0; i < sliceSize; i++) {
            const row = rowByIndex.get(i);
            if (row === undefined) continue;
            let node = root;
            for (let d = 0; d < groupLevels.length; d++) {
                const key = groupLevels[d]!.keys[pageOffset + i] ?? "";
                let child = node.children.get(key);
                if (child === undefined) {
                    child = { path: `${node.path}\u0000${key}`, depth: d, label: key, children: new Map(), order: [], members: [] };
                    node.children.set(key, child);
                    node.order.push(child);
                }
                node = child;
            }
            node.members.push(i);
        }
        const collectMembers = (node: Node): number[] =>
            node.children.size === 0 ? node.members : node.order.flatMap(collectMembers);
        const out: DisplayEntry[] = [];
        const emit = (node: Node) => {
            for (const child of node.order) {
                const memberIdxs = collectMembers(child);
                const aggregates = new Map<string, TableCellVariant>();
                for (const [colKey, { tag }] of groupAggByKey) {
                    const cells = memberIdxs
                        .map(idx => rowByIndex.get(idx)?.original?.get(colKey))
                        .filter((c): c is TableCellVariant => c !== undefined);
                    aggregates.set(colKey, computeAggregate(tag, cells));
                }
                const collapsed = groupCollapse?.[child.path] ?? groupLevels[child.depth]!.collapsed;
                out.push({ kind: "group", path: child.path, depth: child.depth, label: child.label, count: memberIdxs.length, collapsed, aggregates });
                if (collapsed) continue;
                if (child.depth === groupLevels.length - 1) {
                    [...child.members]
                        .sort((a, b) => (rankByIndex.get(a) ?? 0) - (rankByIndex.get(b) ?? 0))
                        .forEach(idx => out.push({ kind: "leaf", row: rowByIndex.get(idx)! }));
                } else {
                    emit(child);
                }
            }
        };
        emit(root);
        return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupLevels, rows, groupAggByKey, groupCollapse, currentPage, pageSize]);
    const toggleGroup = useCallback((path: string, current: boolean) => {
        setPersistedState(prev => ({ ...prev, groupCollapse: { ...(prev.groupCollapse ?? {}), [path]: !current } }));
    }, [setPersistedState]);
    const displayCount = displayRows !== undefined ? displayRows.length : rows.length;

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

    // Virtual row setup. An explicit pixel `rowHeight` (IR) wins; else the
    // density token overrides the default; else the JS-side `rowHeight` prop.
    const effectiveRowHeight = explicitRowHeight ?? (densityTag ? densityRowHeight : rowHeight);
    const virtualizer = useVirtualizer({
        count: displayCount,
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
        return Array.from({ length: displayCount }, (_r, idx) => ({
            index: idx,
            start: idx * effectiveRowHeight,
            end: (idx + 1) * effectiveRowHeight,
            size: effectiveRowHeight,
            key: idx,
            lane: 0,
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [virtualizationEnabled, virtualizer, displayCount, effectiveRowHeight, virtualizer.getVirtualItems()]);

    // ── Scroll position persistence (#143) ──────────────────────────────────
    // Persist the top visible ROW INDEX (never a pixel scrollTop — a clamped
    // index survives data changes). Saved debounced on scroll, restored once on
    // mount clamped to the current row count.
    const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const handleScrollPersist = useCallback(() => {
        if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
        scrollSaveTimer.current = setTimeout(() => {
            const topIndex = virtualizationEnabled
                ? (virtualizer.getVirtualItems()[0]?.index ?? 0)
                : Math.round((tableContainerRef.current?.scrollTop ?? 0) / effectiveRowHeight);
            setPersistedState(prev => prev.scrollIndex === topIndex ? prev : { ...prev, scrollIndex: topIndex });
        }, 150);
    }, [virtualizationEnabled, virtualizer, effectiveRowHeight, setPersistedState]);

    const didRestoreScroll = useRef(false);
    useEffect(() => {
        if (didRestoreScroll.current || rows.length === 0) return;
        didRestoreScroll.current = true;
        const saved = persistedState.scrollIndex ?? 0;
        if (saved <= 0) return;
        const idx = Math.min(saved, rows.length - 1);
        // rAF so the container has a measured height before we scroll to it.
        requestAnimationFrame(() => {
            if (virtualizationEnabled) virtualizer.scrollToIndex(idx, { align: "start" });
            else if (tableContainerRef.current) tableContainerRef.current.scrollTop = idx * effectiveRowHeight;
        });
    // Restore once, as soon as rows exist; deliberately not re-run on later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows.length]);

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

    // Shared plot gutter (#147) — own field wins over an inherited plot-gutter
    // context. When active the data columns are pinned to [left, W−right]: the
    // frozen pane is scaled to `left` (or a left spacer fills it when there are no
    // frozen columns), the centre columns flex-fill the lane, a `right` spacer
    // trails, and horizontal scroll is dropped so the lane is exactly the
    // container width. All of this is gated behind `gutterActive`, so a Table
    // without a gutter renders byte-identically to before.
    const ctxGutter = usePlotGutter();
    const ownGutter = style ? getSomeorUndefined(style.plotGutter) : undefined;
    const gLeft = (ownGutter ? getSomeorUndefined(ownGutter.left) : undefined) ?? ctxGutter?.left;
    const gRight = (ownGutter ? getSomeorUndefined(ownGutter.right) : undefined) ?? ctxGutter?.right;
    const gutterActive = gLeft !== undefined || gRight !== undefined;
    const gutterRightPx = gRight ?? "0px";
    const gLeftPx = gutterPx(gLeft);
    // Scale the frozen pane so its columns sum to `left`; left spacer covers the
    // remainder (the whole of `left` when there are no frozen columns).
    const frozenScale = (gutterActive && gLeftPx !== undefined && frozenPanelWidth > 0)
        ? gLeftPx / frozenPanelWidth : 1;
    const leftSpacerPx = (gutterActive && gLeftPx !== undefined && frozenPanelWidth === 0) ? gLeft : undefined;
    // Per-cell override for the centre (non-pinned) columns: flex-fill the lane
    // AND centre the content. In an aligned stack the day columns sit under the
    // chart's tick centres, so their values / headers must read centred on the
    // column (not left-aligned as a standalone data table) — otherwise the label
    // drifts ~half a column off the shared axis. The frozen row-label column is
    // pinned, so it keeps its default left alignment.
    const gutterCenterStyle = (column: ReturnType<typeof table.getAllColumns>[number]): CSSProperties =>
        (gutterActive && !column.getIsPinned())
            ? { flex: "1 1 0", width: "auto", minWidth: 0, position: "relative", left: undefined, justifyContent: "center", textAlign: "center" }
            : {};

    // ── TanStack pinning styles (applied per-cell) ────────────────────

    const getCommonPinningStyles = (column: ReturnType<typeof table.getAllColumns>[number]): CSSProperties => {
        const isPinned = column.getIsPinned();
        const isLastLeftPinnedColumn = isPinned === 'left' && column.getIsLastColumn('left');

        return {
            borderRight: isLastLeftPinnedColumn ? '2px solid var(--chakra-colors-border, #e2e8e8)' : undefined,
            left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
            right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
            position: isPinned ? 'sticky' : 'relative',
            // Under an active gutter the frozen pane is scaled to occupy exactly
            // `left` (no horizontal scroll, so the sticky offset never engages).
            width: column.getSize() * frozenScale,
            zIndex: isPinned ? 1 : 0,
            backgroundColor: isPinned ? 'var(--chakra-colors-bg-canvas, #f8fafa)' : undefined,
        };
    };

    const styleHeightCss = parseCssSize(style ? getSomeorUndefined(style.height) : undefined);
    const styleMaxHeightCss = parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined);
    // Width-slack absorber (#323 review): with every column explicitly sized,
    // the flex rows ended short of the table width and the leftover painted as
    // a dead strip (fixed-width cells are `flex: none`; only UNSIZED columns
    // grew). The LAST visible leaf data column now grows (`flex: 1 0 auto` —
    // its sized width stays the floor), matching how unsized tables fill.
    // Skipped under frozen pinning (table width IS the summed sizes, h-scroll)
    // and an active plot gutter (the right gutter region owns the slack). A
    // drag-resize keeps the stretch — the resized width is the new floor.
    const lastStretchId = (!hasFrozen && !gutterActive)
        ? table.getVisibleLeafColumns().filter(c => c.id !== REVIEW_COLUMN_ID && !c.getIsPinned()).at(-1)?.id
        : undefined;
    const tableContent = (
        <Box
            ref={tableContainerRef}
            onScroll={handleScrollPersist}
            height={styleHeightCss ?? height}
            maxHeight={styleMaxHeightCss}
            overflowY="auto"
            // Horizontal containment (#351): a wide table pans inside its own
            // scroll container instead of squeezing columns / overflowing the
            // page — frozen or not (gutter mode still owns clipping).
            overflowX={gutterActive ? 'hidden' : 'auto'}
            overscrollBehaviorX="contain"
            // Reserved-gutter bar only when the author bounded the table — an
            // unbounded (content-sized) table must not reserve a dead gutter.
            css={styleHeightCss !== undefined || styleMaxHeightCss !== undefined ? virtualScrollbarCss : undefined}
            position="relative"
            {...(gutterActive ? { width: "100%" } : {})}
        >
            <ChakraTable.Root
                {...props}
                size={tableSize}
                style={{
                    ...columnSizeVars,
                    width: gutterActive ? '100%' : (hasFrozen ? table.getCenterTotalSize() + frozenPanelWidth : '100%'),
                    minWidth: gutterActive ? 0 : (hasFrozen ? table.getCenterTotalSize() + frozenPanelWidth : table.getCenterTotalSize()),
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
                                        // A group spanning the slack-absorbing last column
                                        // must grow with it (min-width keeps the floor).
                                        const spansStretch = lastStretchId !== undefined && groupKeys.includes(lastStretchId);
                                        return (
                                            <ChakraTable.ColumnHeader
                                                key={`group-${gi}`}
                                                bg={headerBackground}
                                                color={headerColor}
                                                style={{
                                                    width: `calc(${widthCalc})`,
                                                    minWidth: `calc(${widthCalc})`,
                                                    flex: groupsRowGrows ? `${groupKeys.length} 1 0%` : (spansStretch ? "1 0 auto" : "none"),
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
                            {/* Gutter: left spacer when there are no frozen columns to fill `left` (#147). */}
                            {leftSpacerPx !== undefined && (
                                <ChakraTable.ColumnHeader aria-hidden="true" bg={headerBackground} style={{ flex: "none", width: leftSpacerPx, padding: 0, borderColor, height: `${effectiveRowHeight}px` }} />
                            )}
                            {headerGroup.headers.map((header) => {
                                // The synthetic Decision column header — the shared
                                // reviewChrome slot, pinned sticky-right, no pin/sort/resize.
                                if (header.column.id === REVIEW_COLUMN_ID) {
                                    return (
                                        <ChakraTable.ColumnHeader
                                            key={header.id}
                                            css={reviewChrome.decisionHeader}
                                            data-slot="decisionHeader"
                                            style={{
                                                width: `var(--header-${header.id}-size)`,
                                                flex: 'none',
                                                height: `${effectiveRowHeight}px`,
                                                ...getCommonPinningStyles(header.column),
                                                zIndex: 3,
                                                borderColor,
                                            }}
                                            position="sticky"
                                        >
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                        </ChakraTable.ColumnHeader>
                                    );
                                }
                                const sortIndex = getSortIndex(header.id);
                                const isSorted = header.column.getIsSorted();
                                const sortDirection = isSorted || null;
                                const icon = !isSorted ? faAnglesDown : sortDirection === 'asc' ? faChevronUp : faChevronDown;
                                const pinningStyles = hasFrozen ? getCommonPinningStyles(header.column) : {};
                                const isPinned = header.column.getIsPinned();
                                // Aligned-stack day column: centre the label on the
                                // shared axis and drop the pin/sort affordance (this
                                // is a read-only display lane, and the controls' flex
                                // space would pull the label off-centre).
                                const centerInGutter = gutterActive && !isPinned;

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
                                            flex: hasFrozen ? 'none'
                                                : (columnSizing[header.id] || header.column.columnDef.meta?.width)
                                                    // The stretch survives a drag-resize: the size var already
                                                    // reflects the resized width, so it stays the flex FLOOR.
                                                    ? (header.column.id === lastStretchId ? '1 0 auto' : 'none')
                                                    : 1,
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
                                            // Gutter: centre columns flex-fill the lane (#147).
                                            ...gutterCenterStyle(header.column),
                                        }}
                                        position={isPinned && !gutterActive ? "sticky" : "relative"}
                                    >
                                        <HStack justify="space-between" align="center" width="100%" pr={centerInGutter ? "0" : (enableColumnResizing ? "4px" : "0")}>
                                            {/* Inherit the columnHeader slot's mono/10px/0.16em/uppercase/
                                                fg.subtle — a bare span so the recipe governs the type,
                                                not a competing textStyle. */}
                                            <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" flex="1" textAlign={centerInGutter ? "center" : undefined}>
                                                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                            </Box>
                                            <HStack className="col-controls" gap={0} flexShrink={0} alignItems="center" display={centerInGutter ? "none" : undefined}
                                                // Hover parity (#351): no hover ⇒ controls stay
                                                // visible at reduced emphasis instead of invisible.
                                                css={{
                                                    opacity: isPinned || isSorted ? 1 : 0,
                                                    "@media (hover: none)": { opacity: isPinned || isSorted ? 1 : 0.6 },
                                                }}
                                                transition="opacity 0.15s">
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
                                                    w="24px" h="24px" css={coarseControlHalo}
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
                                                        w="24px" h="24px" css={coarseControlHalo}
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
                                                _before={{ content: '""', position: 'absolute', right: '2px', top: '30%', bottom: '30%', width: '1px', bg: 'bg.emphasized', opacity: 0, transition: 'opacity 0.2s' }}
                                            />
                                        )}
                                    </ChakraTable.ColumnHeader>
                                );
                            })}
                            {/* Gutter: trailing right-gutter spacer so the lane ends at W−right
                                (#147). Paints the surface colour (NOT the header wash) so the
                                grey header band stops level with the day columns, matching the
                                transparent body-row spacer below — otherwise the band bleeds the
                                gutter's width past the columns. */}
                            {gutterActive && (
                                <ChakraTable.ColumnHeader aria-hidden="true" bg="bg.surface" style={{ flex: "none", width: gutterRightPx, padding: 0, border: "none", height: `${effectiveRowHeight}px` }} />
                            )}
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
                        // Row grouping (#317): group header entries interleave
                        // with leaf rows in the display list.
                        const displayEntry = displayRows !== undefined ? displayRows[virtualRow.index] : undefined;
                        if (displayEntry !== undefined && displayEntry.kind === "group") {
                            const g = displayEntry;
                            return (
                                <div
                                    key={`group:${g.path}`}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                                >
                                    <ChakraTable.Row
                                        css={tableGroupSlotStyles.groupHead}
                                        data-slot="groupHead"
                                        data-depth={g.depth}
                                        display="flex"
                                        width="100%"
                                        onClick={() => toggleGroup(g.path, g.collapsed)}
                                    >
                                        {table.getVisibleLeafColumns().map((col, ci) => {
                                            const sizedFlex = hasFrozen ? 'none'
                                                : (columnSizing[col.id] || col.columnDef.meta?.width)
                                                    ? (col.id === lastStretchId ? '1 0 auto' : 'none')
                                                    : 1;
                                            const cellStyle: React.CSSProperties = {
                                                width: `var(--col-${col.id}-size)`,
                                                flex: sizedFlex,
                                                display: "flex",
                                                alignItems: "center",
                                                minHeight: `${effectiveRowHeight}px`,
                                            };
                                            if (col.id === REVIEW_COLUMN_ID) {
                                                return <ChakraTable.Cell key={col.id} css={tableGroupSlotStyles.groupHeadCell} style={{ ...cellStyle, flex: "none" }} />;
                                            }
                                            if (ci === 0) {
                                                return (
                                                    <ChakraTable.Cell key={col.id} css={tableGroupSlotStyles.groupHeadCell} data-slot="groupHeadLabel" style={{ ...cellStyle, cursor: "pointer", paddingLeft: `${12 + g.depth * 18}px`, gap: "8px", overflow: "visible", whiteSpace: "nowrap" }}>
                                                        <FontAwesomeIcon icon={g.collapsed ? faChevronRight : faChevronDown} style={{ width: 9, height: 9 }} />
                                                        {g.label === "" ? "\u2014" : g.label}
                                                    </ChakraTable.Cell>
                                                );
                                            }
                                            const agg = g.aggregates.get(col.id);
                                            const aggSpec = groupAggByKey.get(col.id);
                                            if (agg === undefined || aggSpec === undefined) {
                                                return <ChakraTable.Cell key={col.id} css={tableGroupSlotStyles.groupHeadCell} style={cellStyle} />;
                                            }
                                            return (
                                                <ChakraTable.Cell key={col.id} css={tableGroupSlotStyles.groupHeadAggregate} data-slot="groupHeadAggregate" style={cellStyle}>
                                                    {aggSpec.renderFn !== undefined
                                                        ? <EastChakraComponent value={aggSpec.renderFn(agg) as Parameters<typeof EastChakraComponent>[0]["value"]} storageKey={`${storageKey ?? "table"}.group.${g.path}.${col.id}`} />
                                                        : formatAggregate(agg)}
                                                </ChakraTable.Cell>
                                            );
                                        })}
                                    </ChakraTable.Row>
                                </div>
                            );
                        }
                        const row = displayEntry !== undefined ? (displayEntry as { kind: "leaf"; row: (typeof rows)[number] }).row : rows[virtualRow.index];
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

                        // With an explicit pixel rowHeight, clamp non-expanded
                        // rows to exactly that height (+ overflow hidden) so
                        // `measureElement` reports the estimate and virtual-scroll
                        // offsets stay exact; expanded rows keep measuring their
                        // real height so `expandedContent` still pushes siblings
                        // down (#127). Without an override, rows stay min-height
                        // so wrapping content can grow.
                        const rowHeightStyle: React.CSSProperties = explicitRowHeight !== undefined && !isExpanded
                            ? { height: `${effectiveRowHeight}px`, overflow: "hidden" }
                            : { minHeight: `${effectiveRowHeight}px` };

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
                                    // Default: minHeight (not fixed) so a row with wrapping
                                    // cell content (e.g. a tags column) grows to fit instead
                                    // of clipping into the next row; `measureElement` reports
                                    // the true height. With an explicit pixel rowHeight, a
                                    // non-expanded row is hard-clamped instead (see above).
                                    ...rowHeightStyle,
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
                                            w="24px" h="24px" css={coarseControlHalo}
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
                                {/* Gutter: left spacer when there are no frozen columns to fill `left` (#147). */}
                                {leftSpacerPx !== undefined && (
                                    <ChakraTable.Cell aria-hidden="true" style={{ flex: "none", width: leftSpacerPx, padding: 0, borderColor }} />
                                )}
                                {row.getVisibleCells().map((cell) => {
                                    // The synthetic Decision cell — the shared reviewChrome
                                    // decisionCol (quiet status dot + Approve/Reject pair),
                                    // acting on the UNSLICED row index.
                                    if (cell.column.id === REVIEW_COLUMN_ID && reviewController !== undefined) {
                                        const unslicedIndex = (pageSize ? currentPage * pageSize : 0) + row.index;
                                        const dotTag = (reviewStatusFn?.(BigInt(unslicedIndex)) as { type: string; value: { type?: string } | null } | undefined);
                                        const statusTag = dotTag?.type === "some" ? (dotTag.value as { type: string }).type : undefined;
                                        return (
                                            <ChakraTable.Cell
                                                key={cell.id}
                                                css={reviewChrome.decisionCol}
                                                data-slot="decisionCol"
                                                data-status={statusTag}
                                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                                style={{
                                                    width: `var(--col-${cell.column.id}-size)`,
                                                    flex: 'none',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    borderColor,
                                                    ...getCommonPinningStyles(cell.column),
                                                    position: 'sticky',
                                                    zIndex: 2,
                                                }}
                                            >
                                                {statusTag !== undefined && (
                                                    <Box as="span" css={reviewDotStyles[statusTag]} data-slot="statusDot" position="absolute" left="12px" />
                                                )}
                                                <DecisionButtons rowIndex={unslicedIndex} controller={reviewController} />
                                            </ChakraTable.Cell>
                                        );
                                    }
                                    const cellValue = cell.getValue() as TableCellValue | undefined;
                                    const meta = cell.column.columnDef.meta;
                                    const columnKey = meta?.columnKey ?? cell.column.id;
                                    const pinningStyles = hasFrozen ? getCommonPinningStyles(cell.column) : {};

                                    const cellStyle: React.CSSProperties = {
                                        width: `var(--col-${cell.column.id}-size)`,
                                        flex: hasFrozen ? 'none'
                                            : (columnSizing[cell.column.id] || meta?.width)
                                                ? (cell.column.id === lastStretchId ? '1 0 auto' : 'none')
                                                : 1,
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
                                        // Gutter: centre columns flex-fill the lane (#147).
                                        ...gutterCenterStyle(cell.column),
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
                                                css={tableSlotStyles.cell} style={cellStyle}
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
                                            css={tableSlotStyles.cell} style={cellStyle}
                                            onClick={cellClickHandler}
                                            onDoubleClick={cellDoubleClickHandler}
                                        >
                                            <Text>{meta?.print?.(cellValue.value) ?? null}</Text>
                                        </ChakraTable.Cell>
                                    );
                                })}
                                {/* Gutter: trailing right-gutter spacer so the lane ends at W−right (#147). */}
                                {gutterActive && (
                                    <ChakraTable.Cell aria-hidden="true" bg="bg.surface" style={{ flex: "none", width: gutterRightPx, padding: 0, border: "none" }} />
                                )}
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
                                    // A footer cell spanning the slack-absorbing last
                                    // column must grow with it (min-width keeps the floor).
                                    const footerSpansStretch = lastStretchId !== undefined
                                        && Array.from({ length: span }, (_, k) => value.columns[i + k]!.key).includes(lastStretchId);
                                    const cellStyle: React.CSSProperties = {
                                        width: widthCalc,
                                        minWidth: widthCalc,
                                        flex: footerRowGrows ? `${span} 1 0%` : (footerSpansStretch ? "1 0 auto" : "none"),
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
                        Page {currentPage + 1} of {totalPages} ({sourceRows.length} total)
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
            {/* Review batch foot (#264) — the shared commitBar foot, stacked
                BELOW the pager band so the page controls stay beside the rows
                they page. */}
            {reviewController !== undefined && reviewController.showFoot && (
                <ReviewFoot controller={reviewController} storageKey={storageKey ?? "table"} />
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

    // ── The row source (#576) ─────────────────────────────────────────────
    // Resolved HERE, once, so `TableCore` sees one row space whichever arm the
    // author used. Table is positional, so a window is an array of mapped rows
    // and windows concatenate; the Plan's keyed windows merge by key. Neither
    // component sniffs the other's shape — the contract carries it.
    const rowsArm = props.value.rows;
    const pagedSource: TablePagedSourceValue | undefined =
        rowsArm.type === "paged" ? rowsArm.value : undefined;
    const paged = useTablePagedRows(pagedSource);
    const rows = useMemo(
        () => (rowsArm.type === "inline" ? (rowsArm.value as TableRowValue[]) : paged.rows),
        [rowsArm, paged.rows],
    );
    const transport = useMemo<TableTransport | undefined>(() => (pagedSource === undefined ? undefined : {
        loaded: paged.loadedElements,
        total: paged.total,
        loading: paged.loading,
        partial: paged.total === undefined || paged.loadedElements < paged.total,
    }), [pagedSource, paged.loadedElements, paged.total, paged.loading]);

    // A source that could not be READ is not an empty table — say why. There is
    // no offline stand-in for a paged source (#573), so this is what a bound
    // table shows outside a workspace.
    if (paged.error !== undefined) {
        return (
            <Box padding="20px" fontFamily="mono" fontSize="10px" color="fg.error" data-table-error>
                {`NO ROWS — the paged source could not be read. ${paged.error}`}
            </Box>
        );
    }
    if (chrome === undefined || slice === undefined) {
        return <TableCore {...props} rows={rows} transport={transport} />;
    }

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    const affordanceKinds = railAffordanceKinds(configuredKinds, state);
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
    const totalPages = paginationConfig ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    const pagerOnChange = paginationConfig?.onPageChange;

    return (
        <Box css={{ ...frameStyles.root, height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box css={{ ...frameStyles.frameEyebrow, flexShrink: 0 }}>
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            <Box css={{ ...frameStyles.frameBody, flex: "1 1 0%", minHeight: 0, overflow: "hidden" }}>
                <TableCore {...props} rows={rows} transport={transport} hidePaginationBand />
            </Box>
            <Box css={{ ...frameStyles.frameFooter, flexShrink: 0 }}>
                {/* A paged table counts ELEMENTS loaded, not slice results: the
                    slice narrows what the host fed, which here is the prefix
                    that happened to land (#575's rule, one component over). */}
                {transport !== undefined ? (
                    <>
                        <Box as="span" css={frameStyles.frameFooterStat} data-slot="tableTransport">
                            {transport.loaded.toLocaleString()}
                        </Box>
                        <Box as="span">
                            {transport.total !== undefined
                                ? `loaded · of ${transport.total.toLocaleString()}`
                                : "loaded"}
                        </Box>
                        {transport.loading && <Box as="span">· Loading…</Box>}
                        {/* The withdrawn affordance, stated where the counts are. */}
                        <Box as="span" data-slot="tableSortNote">· sort disabled on a partial corpus</Box>
                    </>
                ) : (
                    <>
                        <Box as="span" css={frameStyles.frameFooterStat}>{result.toLocaleString()}</Box>
                        <Box as="span">{`rows · of ${total.toLocaleString()}`}</Box>
                        {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${pct}%`}</Box>}
                    </>
                )}
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
