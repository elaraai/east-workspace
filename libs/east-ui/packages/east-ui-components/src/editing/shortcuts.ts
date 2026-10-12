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

/** The inputs nothing is typed into: a press on one is the collection's, never the field's. */
const UNTYPED_INPUTS: ReadonlySet<string> = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/**
 * Whether a key press lands where a person types — an input that takes text, a
 * text area, a select or editable content — where the history keys are the
 * field's own undo, never the collection's (#1185): a builder's frame hears
 * them from anywhere else in it.
 *
 * @param target - The key press's target
 * @returns Whether it is typed into
 */
export function typedInto(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
    return target instanceof HTMLInputElement && !UNTYPED_INPUTS.has(target.type);
}
