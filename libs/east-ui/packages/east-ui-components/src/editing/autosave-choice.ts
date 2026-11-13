/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's choice of an automatic Save (`autosave.ts`): on, or off.
 *
 * - **Where it is kept.** Each builder keeps its own, in the browser, for
 *   whoever is signed in (kept state, `browser`), by the data set its host
 *   names (`EditingScope`) and the builder's view — so a choice made over one
 *   data set never saves another's by itself. Where a session, or one history
 *   over several, is kept for a builder, its key is said for it here; a
 *   session no builder keeps has none, and is saved by a press alone.
 * - **What it begins at.** Until its viewer chooses, the choice is what the
 *   builder's author says ({@link beginAutosave}) — off, said nothing. The
 *   author's word is data's to drive, so it may move: a choice never made
 *   moves with it, and one its viewer made stands over it, kept.
 *
 * @packageDocumentation
 */

/** A builder's choice, as a history bar reads it. */
export interface AutosaveKept {
    /** Where the viewer's choice is kept ({@link autosaveChoiceKey}). */
    readonly key: string;
    /** What the builder's author begins the choice at: what stands while its viewer has chosen nothing. */
    readonly begins: () => boolean;
    /** Hear the author's word move. */
    readonly subscribe: (listener: () => void) => () => void;
}

/** One builder's choice: what a bar reads of it, and what its author says. */
interface Choice {
    readonly kept: AutosaveKept;
    begins: boolean;
    readonly listeners: Set<() => void>;
}

/** Each kept session's, or history's, builder's choice. */
const choices = new WeakMap<object, Choice>();

/**
 * The key a builder keeps its choice under: its data set and its view.
 *
 * @param scope - The data set, as its host names it (the host's `EditingScope`); empty where it names none
 * @param view - The view's key
 * @returns The key
 */
export function autosaveChoiceKey(scope: string, view: string): string {
    return `editing.autosave:${encodeURIComponent(scope)}:${encodeURIComponent(view)}`;
}

/**
 * Says where the builder that keeps a session, or a history, keeps its
 * choice, which begins off until its author says otherwise
 * ({@link beginAutosave}).
 *
 * @param target - The session, or the history
 * @param key - The builder's key ({@link autosaveChoiceKey})
 */
export function keepAutosaveChoice(target: object, key: string): void {
    const listeners = new Set<() => void>();
    const choice: Choice = {
        begins: false, listeners,
        kept: {
            key,
            begins: () => choice.begins,
            subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        },
    };
    choices.set(target, choice);
}

/**
 * Says what a builder's author begins its choice at, telling whoever hears it
 * when that moves. A session, or a history, no builder keeps a choice for has
 * none to begin.
 *
 * @param target - The session, or the history
 * @param on - Whether the choice begins on
 */
export function beginAutosave(target: object, on: boolean): void {
    const choice = choices.get(target);
    if (choice === undefined || choice.begins === on) return;
    choice.begins = on;
    for (const listener of [...choice.listeners]) listener();
}

/**
 * The choice of the builder that keeps a session, or a history.
 *
 * @param target - The session, or the history
 * @returns Where it is kept and what it begins at; `undefined` for one no builder keeps a choice for
 */
export function autosaveChoiceOf(target: object): AutosaveKept | undefined {
    return choices.get(target)?.kept;
}
