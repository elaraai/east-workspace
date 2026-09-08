/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout arithmetic — the shell's fixed rows, the breakpoints, the column
 * plans of every table, and the scrollbar geometry.
 *
 * Every row is exactly one terminal line (no wrapping) so scroll math is
 * exact and the frame never exceeds the viewport: the shell is one header
 * row, a rule, the body, then — bottom-anchored — an optional commit bar,
 * an optional completion list, the three-row command box and one hint
 * row. Widths ≥ 100 columns get the full tables, 80–99 tighter columns,
 * 60–79 drop the secondary columns, and below 60×16 the app refuses.
 *
 * @packageDocumentation
 */

/** The smallest terminal the app runs in. */
export const MIN_COLUMNS = 60;
/** The smallest terminal the app runs in. */
export const MIN_ROWS = 16;
/** Completion rows above the command box, at most. */
export const MAX_COMPLETION_ROWS = 8;

/** A terminal size in cells. */
export interface Size {
    columns: number;
    rows: number;
}

/** The width class: `wide` ≥ 100, `medium` 80–99, `narrow` 60–79, `refuse` below 60 (or under 16 rows). */
export type Breakpoint = 'wide' | 'medium' | 'narrow' | 'refuse';

/**
 * The width class of a terminal size.
 *
 * @param size - The terminal size
 * @returns The breakpoint
 */
export function breakpoint(size: Size): Breakpoint {
    if (size.columns < MIN_COLUMNS || size.rows < MIN_ROWS) return 'refuse';
    if (size.columns >= 100) return 'wide';
    if (size.columns >= 80) return 'medium';
    return 'narrow';
}

/**
 * The shell's row plan for a size and the bottom-anchored extras.
 *
 * @property columns - Terminal columns
 * @property rows - Terminal rows
 * @property bodyTop - The first body row (below the header and its rule)
 * @property bodyRows - Rows the view body may draw
 * @property commitRows - Rows of the commit bar (0 or 2: a dashed rule + the bar)
 * @property completionRows - Rows of the completion list
 * @property commandTop - The first row of the command box (its top rule)
 * @property hintRow - The hint row (the last row)
 */
export interface ShellLayout {
    columns: number;
    rows: number;
    bodyTop: number;
    bodyRows: number;
    commitRows: number;
    completionRows: number;
    commandTop: number;
    hintRow: number;
}

/**
 * Computes the shell's row plan.
 *
 * @param size - The terminal size
 * @param extras - Whether the commit bar shows, and how many completion rows
 * @returns The plan (the body absorbs the remainder, never below 0)
 */
export function shellLayout(size: Size, extras: { commit: boolean; completion: number }): ShellLayout {
    const commitRows = extras.commit ? 2 : 0;
    const completionRows = Math.max(0, Math.min(MAX_COMPLETION_ROWS, extras.completion));
    const chrome = 2 + commitRows + completionRows + 3 + 1;
    const bodyRows = Math.max(0, size.rows - chrome);
    return {
        columns: size.columns,
        rows: size.rows,
        bodyTop: 2,
        bodyRows,
        commitRows,
        completionRows,
        commandTop: 2 + bodyRows + commitRows + completionRows,
        hintRow: size.rows - 1,
    };
}

/**
 * The scrollbar geometry of the design (§8): the thumb spans
 * `max(1, round(track · visible / total))` cells at
 * `round((track − thumb) · top / (total − visible))`.
 *
 * @param track - The track height in cells (between the caps)
 * @param total - Total rows
 * @param visible - Visible rows
 * @param top - The first visible row
 * @returns The thumb size and its offset within the track (`null` when everything fits)
 */
export function scrollbar(track: number, total: number, visible: number, top: number): { thumb: number; pos: number } | null {
    if (track <= 0 || total <= visible) return null;
    const thumb = Math.max(1, Math.round(track * Math.min(1, visible / total)));
    const pos = Math.round((track - thumb) * (Math.min(top, total - visible) / (total - visible)));
    return { thumb, pos: Math.max(0, Math.min(track - thumb, pos)) };
}

/**
 * One column of a table plan.
 *
 * @property key - The column identity
 * @property title - The header text
 * @property width - The width in cells (`0` = the remaining width)
 * @property align - Text alignment
 */
export interface ColumnSpec {
    key: string;
    title: string;
    width: number;
    align?: 'left' | 'right' | undefined;
}

/** The tables with a per-breakpoint column plan. */
export type TableKind = 'tasks' | 'inputs' | 'workspaces' | 'repos' | 'runs' | 'completion' | 'jump';

/**
 * The column plan of a table at a width class. Widths are the design's
 * (120 columns); the last column takes the remaining width.
 *
 * @param table - The table
 * @param bp - The width class
 * @returns The columns, secondary ones dropped as the terminal narrows
 */
export function columnPlan(table: TableKind, bp: Breakpoint): ColumnSpec[] {
    const narrow = bp === 'narrow';
    const medium = bp === 'medium';
    switch (table) {
        case 'tasks':
            return [
                { key: 'name', title: 'NAME', width: narrow ? 14 : 12 },
                { key: 'status', title: 'STATUS', width: narrow ? 18 : 20 },
                ...(narrow ? [] : [{ key: 'dependsOn', title: 'DEPENDS ON', width: medium ? 16 : 20 }]),
                ...(narrow || medium ? [] : [{ key: 'inputs', title: 'INPUTS', width: 18 }]),
                { key: 'output', title: 'OUTPUT', width: narrow ? 18 : medium ? 20 : 26 },
                { key: 'size', title: 'SIZE · LAST RUN', width: 0 },
            ];
        case 'inputs':
            return [
                { key: 'name', title: 'NAME', width: 14 },
                { key: 'status', title: 'STATUS', width: 16 },
                { key: 'type', title: 'TYPE', width: narrow ? 18 : 26 },
                { key: 'size', title: 'SIZE', width: narrow ? 0 : 10 },
                ...(narrow ? [] : [{ key: 'hash', title: 'HASH', width: 0 }]),
            ];
        case 'workspaces':
            return [
                { key: 'name', title: 'NAME', width: 14 },
                { key: 'state', title: 'STATE', width: 14 },
                { key: 'package', title: 'PACKAGE', width: narrow ? 18 : 22 },
                ...(narrow ? [] : [{ key: 'tasks', title: 'TASKS', width: medium ? 22 : 30 }]),
                { key: 'lastRun', title: 'LAST RUN', width: 0 },
            ];
        case 'repos':
            return [
                { key: 'name', title: 'NAME', width: 22 },
                { key: 'workspaces', title: 'WORKSPACES', width: 14 },
                { key: 'packages', title: 'PACKAGES', width: 12 },
                ...(narrow ? [] : [{ key: 'objects', title: 'OBJECTS', width: 12 }]),
                { key: 'lastDeploy', title: 'LAST DEPLOY', width: 0 },
            ];
        case 'runs':
            return [
                { key: 'status', title: 'STATUS', width: 12 },
                { key: 'started', title: 'STARTED', width: 22 },
                { key: 'duration', title: 'DURATION', width: 10 },
                { key: 'exit', title: 'EXIT', width: 6 },
                { key: 'inputs', title: 'INPUTS', width: narrow ? 0 : 14 },
                ...(narrow ? [] : [{ key: 'note', title: '', width: 0 }]),
            ];
        case 'completion':
            return [
                { key: 'command', title: '', width: 12 },
                { key: 'name', title: '', width: 14 },
                { key: 'status', title: '', width: 18 },
                ...(narrow ? [] : [{ key: 'type', title: '', width: 24 }]),
                { key: 'detail', title: '', width: 0 },
            ];
        case 'jump':
            return [
                { key: 'kind', title: '', width: 12 },
                { key: 'name', title: '', width: 16 },
                { key: 'workspace', title: '', width: 10 },
                { key: 'detail', title: '', width: 0 },
            ];
    }
}

/**
 * The value tree's label column width — at most 45 % of the row, the
 * design's `LW = 44` at 120 columns.
 *
 * @param columns - The row width
 * @returns The label width in cells
 */
export function labelWidth(columns: number): number {
    return Math.min(44, Math.max(16, Math.floor(columns * 0.45) - 10));
}

/**
 * Keeps a selection visible: the top row that shows `sel` within `visible`
 * rows, moving as little as possible from the current `top`.
 *
 * @param top - The current first visible row
 * @param sel - The selected row
 * @param visible - Visible rows
 * @param total - Total rows
 * @returns The new top
 */
export function scrollIntoView(top: number, sel: number, visible: number, total: number): number {
    const maxTop = Math.max(0, total - visible);
    let next = Math.max(0, Math.min(top, maxTop));
    if (visible <= 0) return next;
    if (sel < next) next = sel;
    else if (sel >= next + visible) next = sel - visible + 1;
    return Math.max(0, Math.min(next, maxTop));
}
