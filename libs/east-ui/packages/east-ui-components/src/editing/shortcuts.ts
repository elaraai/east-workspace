/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The history shortcuts (#988) — one reading of a key press for every
 * editable collection, so Undo and Redo take the same keys on the Sheet, the
 * Plan and the SnapGrid.
 *
 * @packageDocumentation
 */

/** A key press, as the shortcuts read it — a React or a DOM keyboard event. */
export interface HistoryKeyPress {
    /** The key. */
    key: string;
    /** Ctrl is held. */
    ctrlKey: boolean;
    /** ⌘ (Meta) is held. */
    metaKey: boolean;
    /** Shift is held. */
    shiftKey: boolean;
    /** Alt (⌥) is held. */
    altKey: boolean;
}

/**
 * The history action a key press asks for: Ctrl/⌘+Z undoes; Ctrl/⌘+Shift+Z and
 * Ctrl/⌘+Y redo. A press with Alt held asks for none.
 *
 * @param e - The key press
 * @returns `"undo"`, `"redo"`, or `undefined` when the press is not a history key
 */
export function historyShortcut(e: HistoryKeyPress): "undo" | "redo" | undefined {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return undefined;
    const letter = e.key.toLowerCase();
    if (letter === "z") return e.shiftKey ? "redo" : "undo";
    if (letter === "y") return "redo";
    return undefined;
}
