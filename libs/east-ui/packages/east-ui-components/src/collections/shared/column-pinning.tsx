/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo, useCallback, type CSSProperties } from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronUp, faChevronDown, faAnglesDown, faThumbtack } from "@fortawesome/free-solid-svg-icons";
import { flexRender } from "@tanstack/react-table";
import type { Column, Header, SortingState, Table } from "@tanstack/react-table";
import { coarseHitArea } from "../../style/hit-area.js";

/* Touch (#351): 36px tap halo on the 24px pin/sort controls (36, not 44 —
 * pin and sort sit adjacent; full halos would swallow each other). */
const coarseControlHalo = coarseHitArea({ position: true, size: 36 });

// The custom column meta both Table/Gantt and Planner attach. Declared here in
// the shared module so any consumer of these helpers carries the typing.
declare module "@tanstack/react-table" {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    interface ColumnMeta<TData, TValue> {
        columnKey?: string;
        width?: string | undefined;
        alignEnd?: boolean;
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */
}

// ── Pinning styles (TanStack recommended approach) ──────────────────

export function getCommonPinningStyles<TData>(column: Column<TData, unknown>): CSSProperties {
    const isPinned = column.getIsPinned();
    const isLastLeftPinnedColumn = isPinned === 'left' && column.getIsLastColumn('left');

    return {
        borderRight: isLastLeftPinnedColumn ? '2px solid var(--chakra-colors-border, #e2e8e8)' : undefined,
        left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
        right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
        position: isPinned ? 'sticky' : 'relative',
        width: column.getSize(),
        zIndex: isPinned ? 1 : 0,
        backgroundColor: isPinned ? 'var(--chakra-colors-bg-panel, white)' : undefined,
    };
}

// ── Column pinning hook ─────────────────────────────────────────────

export interface UseColumnPinningOpts {
    frozenFromValue: string[];
    persistedPinnedColumns: string[] | undefined;
    setPersistedPinnedColumns: (updater: (prev: string[]) => string[]) => void;
}

export function useColumnPinning({ frozenFromValue, persistedPinnedColumns, setPersistedPinnedColumns }: UseColumnPinningOpts) {
    const pinnedColumns = useMemo(
        () => persistedPinnedColumns ?? [...frozenFromValue],
        [persistedPinnedColumns, frozenFromValue]
    );

    const columnPinning = useMemo(() => ({
        left: pinnedColumns,
        right: [] as string[],
    }), [pinnedColumns]);

    const hasFrozen = pinnedColumns.length > 0;

    const toggleColumnPin = useCallback((columnId: string) => {
        setPersistedPinnedColumns(current => {
            const isPinned = current.includes(columnId);
            return isPinned
                ? current.filter(id => id !== columnId)
                : [...current, columnId];
        });
    }, [setPersistedPinnedColumns]);

    return { pinnedColumns, columnPinning, hasFrozen, toggleColumnPin };
}

// ── Header cell controls (pin + sort) ───────────────────────────────

export interface HeaderControlsProps<TData> {
    header: Header<TData, unknown>;
    toggleColumnPin: (columnId: string) => void;
    getSortIndex: (columnId: string) => number | undefined;
    enableMultiSort: boolean;
    enableColumnResizing: boolean;
}

export function HeaderControls<TData>({
    header,
    toggleColumnPin,
    getSortIndex,
    enableMultiSort,
    enableColumnResizing,
}: HeaderControlsProps<TData>) {
    const sortIndex = getSortIndex(header.id);
    const isSorted = header.column.getIsSorted();
    const sortDirection = isSorted || null;
    const icon = !isSorted ? faAnglesDown : sortDirection === 'asc' ? faChevronUp : faChevronDown;
    const isPinned = header.column.getIsPinned();

    return (
        <>
            <HStack justify="space-between" width="100%" pr={enableColumnResizing ? "4px" : "0"}>
                {/* Bare span so the consumer's `columnHeader` slot governs the
                    type (mono / 10px / 0.16em / uppercase) — identical to the
                    Table's header. Don't set a competing fontSize here. */}
                <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" flex="1">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </Box>
                {/* Controls are hidden until the header is hovered (the consumer's
                    header cell reveals `.col-controls`), except a pinned/sorted
                    column keeps its indicator visible. Mirrors the Table. */}
                <HStack className="col-controls" gap={0} flexShrink={0} alignItems="center"
                    // Hover parity (#351): no hover ⇒ controls stay visible
                    // at reduced emphasis instead of invisible.
                    css={{
                        opacity: isPinned || isSorted ? 1 : 0,
                        "@media (hover: none)": { opacity: isPinned || isSorted ? 1 : 0.6 },
                    }}
                    transition="opacity 0.15s">
                    {/* Pin toggle */}
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
            {enableColumnResizing && <ColumnResizeHandle header={header} />}
        </>
    );
}

// ── Shared header divider bar + resize handle ───────────────────────

/** The vertical grip/divider bar shown between header columns — 2px × 16px,
 *  faint grey, its right edge sitting ON the column boundary so it lines up with
 *  the body cells' `border-right`. The resize handle renders it (brightening on
 *  hover); a non-resizable axis header renders <ColumnDividerBar/> for the SAME
 *  look. (`right: 0` keeps it inside the cell — no clip under `overflow: hidden`.) */
const DIVIDER_BAR = {
    position: "absolute" as const, right: "0", top: "50%", transform: "translateY(-50%)",
    width: "2px", height: "16px", bg: "bg.emphasized", borderRadius: "1px",
} as const;

/** A static copy of the resize-handle grip bar, for non-resizable headers. */
export function ColumnDividerBar() {
    return <Box css={{ ...DIVIDER_BAR, opacity: 0.4 }} pointerEvents="none" />;
}

/** The interactive resize handle (drag to resize) showing the grip bar. Used by
 *  HeaderControls, and directly by surfaces that want resize WITHOUT the pin /
 *  sort controls (e.g. the Planner, whose left pane is frozen so pinning is moot). */
export function ColumnResizeHandle<TData>({ header }: { header: Header<TData, unknown> }) {
    if (!header.column.getCanResize()) return null;
    return (
        <Box
            position="absolute" right="0" top="0" bottom="0" width="8px" cursor="col-resize" bg="transparent"
            _hover={{ _before: { opacity: 1, bg: 'fg.muted' } }}
            transition="all 0.2s" zIndex={10}
            onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()}
            _before={{ content: '""', ...DIVIDER_BAR, opacity: 0.4, transition: 'opacity 0.2s' }}
        />
    );
}

// ── Header cell style helper ────────────────────────────────────────

export function getHeaderCellStyle<TData>(
    header: Header<TData, unknown>,
    hasFrozen: boolean,
    columnSizing: Record<string, number>,
    isLastUnpinned?: boolean,
): CSSProperties {
    const pinningStyles = hasFrozen ? getCommonPinningStyles(header.column) : {};
    const isPinned = header.column.getIsPinned();

    return {
        display: 'flex',
        alignItems: 'center',
        // Last unpinned column stretches to fill remaining space
        ...(isLastUnpinned
            ? { minWidth: `var(--header-${header.id}-size)`, flex: 1 }
            : { width: `var(--header-${header.id}-size)`, flex: hasFrozen ? 'none' : (columnSizing[header.id] || header.column.columnDef.meta?.width) ? 'none' : 1 }
        ),
        ...pinningStyles,
        zIndex: isPinned ? 3 : undefined,
        position: isPinned ? 'sticky' : 'relative',
    };
}

// ── Cell style helper ────────────────────────────────────────────────

export function getCellStyle<TData>(
    cell: { column: Column<TData, unknown> },
    hasFrozen: boolean,
    columnSizing: Record<string, number>,
    isLastUnpinned?: boolean,
): CSSProperties {
    const meta = cell.column.columnDef.meta;
    const pinningStyles = hasFrozen ? getCommonPinningStyles(cell.column) : {};

    return {
        ...(isLastUnpinned
            ? { minWidth: `var(--col-${cell.column.id}-size)`, flex: 1 }
            : { width: `var(--col-${cell.column.id}-size)`, flex: hasFrozen ? 'none' : (columnSizing[cell.column.id] || meta?.width) ? 'none' : 1 }
        ),
        ...pinningStyles,
    };
}

// ── Sort index helper ───────────────────────────────────────────────

export function createGetSortIndex(sorting: SortingState) {
    return (columnId: string) => {
        const idx = sorting.findIndex(s => s.id === columnId);
        return idx >= 0 ? idx + 1 : undefined;
    };
}

// ── TanStack column-sizing derivations (shared by Table/Gantt/Planner) ──

/**
 * Memoized `--header-<id>-size` / `--col-<id>-size` CSS variables for the
 * current column sizing. Applied once to the header/body wrapper so each cell
 * reads its width from a variable instead of forcing a layout per resize tick.
 */
export function useColumnSizeVars<TData>(table: Table<TData>): Record<string, string> {
    return useMemo(() => {
        const colSizes: Record<string, string> = {};
        for (const header of table.getFlatHeaders()) {
            colSizes[`--header-${header.id}-size`] = `${header.getSize()}px`;
            colSizes[`--col-${header.column.id}-size`] = `${header.column.getSize()}px`;
        }
        return colSizes;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table.getState().columnSizingInfo, table.getState().columnSizing]);
}

/** The id of the last unpinned column — it stretches to fill remaining space. */
export function useLastUnpinnedColumnId<TData>(table: Table<TData>): string | null {
    return useMemo(() => {
        const headers = table.getFlatHeaders();
        for (let i = headers.length - 1; i >= 0; i--) {
            if (!headers[i]!.column.getIsPinned()) return headers[i]!.id;
        }
        return null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table, table.getState().columnPinning]);
}
