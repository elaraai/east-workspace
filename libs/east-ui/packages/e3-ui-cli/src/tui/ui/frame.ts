/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The last frame's geometry, for the mouse: which cells are rows, twists,
 * tabs, crumbs, pills and completion rows (`hits`), and the scrolling
 * pane under the body (`pane`) with its scrollbar column. Views publish
 * body-relative rows with their lines; the App stores the absolute ones
 * after each render; the controller hit-tests clicks against them.
 *
 * @packageDocumentation
 */

import type { ShellLayout } from '../render/layout.js';

/** What a click on a cell does. */
export type HitTarget =
    | { kind: 'list'; index: number }
    | { kind: 'dashboard'; index: number }
    | { kind: 'tree'; flat: number; twistX: number | null }
    | { kind: 'tab'; index: number }
    | { kind: 'stream'; stream: 'stdout' | 'stderr' }
    | { kind: 'toolbar'; action: 'expandAll' | 'collapseAll' | 'save' }
    | { kind: 'crumb'; index: number }
    | { kind: 'pill'; pill: 'running' | 'dirty' | 'connection' }
    | { kind: 'completion'; index: number };

/** A clickable cell range on one row (`x1` exclusive). */
export interface Hit {
    row: number;
    x0: number;
    x1: number;
    target: HitTarget;
}

/** The scrolling pane: its rows, its extent, and where it is scrolled to. */
export interface Pane {
    /** The first row of the pane (the scrollbar's `▲` sits there). */
    top: number;
    /** Rows the pane occupies (the scrollbar's `▼` sits on the last). */
    rows: number;
    total: number;
    visible: number;
    scrollTop: number;
}

/** The last frame's geometry. */
export interface FrameInfo {
    layout: ShellLayout;
    hits: Hit[];
    pane: Pane | null;
}

let last: FrameInfo | null = null;

/** Records the frame just rendered. */
export function setLastFrame(frame: FrameInfo): void {
    last = frame;
}

/** The frame last rendered, if any. */
export function lastFrame(): FrameInfo | null {
    return last;
}

/**
 * The hit under a cell.
 *
 * @param frame - The frame
 * @param x - The column
 * @param y - The row
 * @returns The target, or null
 */
export function hitAt(frame: FrameInfo, x: number, y: number): HitTarget | null {
    for (const hit of frame.hits) {
        if (hit.row === y && x >= hit.x0 && x < hit.x1) return hit.target;
    }
    return null;
}

/**
 * The scroll position a drag on the scrollbar track maps to.
 *
 * @param pane - The pane
 * @param y - The row dragged to
 * @returns The scroll top
 */
export function paneTopFromRow(pane: Pane, y: number): number {
    const track = Math.max(1, pane.rows - 2);
    const pos = Math.max(0, Math.min(track - 1, y - (pane.top + 1)));
    const max = Math.max(0, pane.total - pane.visible);
    return Math.round((pos / Math.max(1, track - 1)) * max);
}
