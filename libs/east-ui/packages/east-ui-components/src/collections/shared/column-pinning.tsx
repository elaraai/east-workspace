/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import type { Column, Header, Table } from "@tanstack/react-table";

// The custom column meta the Table attaches. Declared here in
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

/** The interactive resize handle (drag to resize) showing the grip bar, for
 *  surfaces that resize WITHOUT the Table's pin / sort controls (a frozen left
 *  pane makes pinning moot). */
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

// ── TanStack column-sizing derivations (the Table's) ──

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
        // `options.columns` too: swapping the column DEFINITIONS (a reactive
        // arm change) leaves both sizing states untouched, and without it the
        // vars go stale — old columns keep dead sizes, new ones get none.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table.getState().columnSizingInfo, table.getState().columnSizing, table.options.columns]);
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
