/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The history shortcuts (#988) — one reading of a key press for every
 * editable collection, so Undo and Redo take the same keys on the Sheet, the
 * Plan and the SnapGrid — what a builder does with a key it acts on
 * ({@link takeKey}, #1398): it goes no further than the builder — and the key
 * no handler acts on, an input method's ({@link composingKey}, #1758).
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

/** A key press a handler takes: a React or a DOM keyboard event. */
export interface TakenKey {
    /** Keeps the browser from the key's own action — a scroll, a click. */
    preventDefault(): void;
    /** Keeps the key from every listener past the handler's element. */
    stopPropagation(): void;
}

/**
 * Takes a key press a builder acts on (#1398): its default is prevented, and
 * it goes no further than the builder — a shortcut of the page around it on
 * the same key, the showcase's `[` that folds its sidebar, never hears it. A
 * handler takes only a key it acts on; one it leaves goes on as it came.
 *
 * @param e - The key press
 */
export function takeKey(e: TakenKey): void {
    e.preventDefault();
    e.stopPropagation();
}

/** A key press as {@link composingKey} reads it: a DOM keyboard event, or React's, which holds one. */
export interface ComposedKeyPress {
    /** Whether an input method is composing as the key is pressed; React's event holds it on its DOM event. */
    readonly isComposing?: boolean | undefined;
    /** The key's code: 229 for a key an input method takes. */
    readonly keyCode: number;
    /** The DOM event a React event holds. */
    readonly nativeEvent?: { readonly isComposing: boolean; readonly keyCode: number } | undefined;
}

/**
 * Whether a key press is an input method's, never a handler's (#1758): one
 * pressed while it composes — a Japanese or a Chinese conversion — or the one
 * that ends its composition. Safari ends the composition first and then sends
 * that key, an Enter or an Esc, as not composing and as key 229, so a handler
 * that asked only whether a composition was under way took the Enter that
 * confirmed a conversion for its own: a name was saved half typed.
 *
 * @param e - The key press
 * @returns Whether an input method takes it
 */
export function composingKey(e: ComposedKeyPress): boolean {
    const native = e.nativeEvent ?? e;
    return native.isComposing === true || native.keyCode === 229;
}
