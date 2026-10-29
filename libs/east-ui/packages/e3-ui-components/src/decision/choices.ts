/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The viewer's own state in the DecisionQueue (`Decision Queue Spec.md` D12,
 * R21, §14), kept under the queue's `id` until a verdict: the open card, the
 * Routine band's fold, and each card's choices — the option chosen, the
 * answer to each option's question, the note, Modify's edits of each option
 * and the override form — so a card closed and opened again, or the queue
 * unmounted and mounted again, shows them as left. An option is named by its
 * key as East prints it ({@link optionId}); Modify's edited rows are kept as
 * their bytes, in base64.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { OptionType, StringType, printFor } from "@elaraai/east";
import { usePersistedState } from "@elaraai/east-ui-components";
import type { DecisionOption } from "./layout.js";
import type { DecisionAnswerWord, DecisionReasonWord } from "./messages.js";

/** Modify's edit of one changed row: the row as the viewer left it, or the row kept as it stands. */
export type RowEdit = { readonly keep: true } | { readonly row: string };

/** One card's choices. */
export interface CaseChoice {
    /** The chosen option ({@link optionId}), where the viewer chose another than the recommended. */
    readonly option?: string | undefined;
    /** The answer to each option's question, by the option ({@link optionId}). */
    readonly answers?: Readonly<Record<string, DecisionAnswerWord>> | undefined;
    /** The note, as typed. */
    readonly note?: string | undefined;
    /** The panel open under the actions. */
    readonly panel?: "edit" | "override" | undefined;
    /** The override's reason. */
    readonly reason?: DecisionReasonWord | undefined;
    /** The override's note. */
    readonly overrideNote?: string | undefined;
    /** Modify's edits of each option ({@link optionId}), by the changed row's key. */
    readonly edits?: Readonly<Record<string, Readonly<Record<string, RowEdit>>>> | undefined;
}

/** What the queue keeps for its viewer. */
export interface DecisionChoices {
    /**
     * The open case's key; `null` once the viewer has closed the open card; `undefined` while they have neither opened
     * nor closed one, which opens the first case waiting (§11).
     */
    readonly open: string | null | undefined;
    /** Whether the Routine band is open. */
    readonly routineOpen: boolean;
    /** Each card's choices, by its case's key. */
    readonly cases: Readonly<Record<string, CaseChoice>>;
}

const INITIAL: DecisionChoices = { open: undefined, routineOpen: false, cases: {} };
const NO_CHOICE: CaseChoice = {};
const printKey = printFor(OptionType(StringType));

/**
 * An option's name among its case's choices: its key as East prints it — `none` for a case that is its own one
 * proposal (D15).
 *
 * @param o - The option
 * @returns Its name
 */
export function optionId(o: DecisionOption): string {
    return printKey(o.key);
}

/** What {@link useDecisionChoices} gives. */
export interface DecisionChoicesState {
    /** What is kept. */
    readonly choices: DecisionChoices;
    /** A card's choices; none for a card the viewer has left as it opened. */
    choiceOf(key: string): CaseChoice;
    /** Changes some of a card's choices, from its choices as they stand. */
    setChoice(key: string, next: (was: CaseChoice) => Partial<CaseChoice>): void;
    /** Forgets the choices of the cases given, as their verdicts read back saved. */
    forget(keys: Iterable<string>): void;
    /** Opens a card, or closes the open one with `null`. */
    setOpen(key: string | null): void;
    /** Opens or folds the Routine band. */
    setRoutineOpen(open: boolean): void;
}

/**
 * The viewer's state under the queue's key (see the module docs).
 *
 * @param storageKey - The queue's key
 * @returns What is kept, and how it changes
 */
export function useDecisionChoices(storageKey: string): DecisionChoicesState {
    const { state: choices, setState } = usePersistedState<DecisionChoices>(`${storageKey}.choices`, INITIAL);
    const setChoice = useCallback((key: string, next: (was: CaseChoice) => Partial<CaseChoice>) => {
        setState(was => {
            const held = was.cases[key] ?? NO_CHOICE;
            return { ...was, cases: { ...was.cases, [key]: { ...held, ...next(held) } } };
        });
    }, [setState]);
    const forget = useCallback((keys: Iterable<string>) => {
        const gone = [...keys];
        if (gone.length === 0) return;
        setState(was => {
            if (!gone.some(key => key in was.cases)) return was;
            const cases = { ...was.cases };
            for (const key of gone) delete cases[key];
            return { ...was, cases };
        });
    }, [setState]);
    const setOpen = useCallback((key: string | null) => setState(was => (was.open === key ? was : { ...was, open: key })), [setState]);
    const setRoutineOpen = useCallback((open: boolean) => setState(was => ({ ...was, routineOpen: open })), [setState]);
    const choiceOf = useCallback((key: string) => choices.cases[key] ?? NO_CHOICE, [choices]);
    return useMemo(() => ({ choices, choiceOf, setChoice, forget, setOpen, setRoutineOpen }),
        [choices, choiceOf, setChoice, forget, setOpen, setRoutineOpen]);
}

/**
 * A row's bytes as Modify keeps them.
 *
 * @param bytes - The row's bytes
 * @returns Their base64
 */
export function keptBytes(bytes: Uint8Array): string {
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
}

/**
 * A row's bytes from what Modify kept.
 *
 * @param kept - Their base64
 * @returns The bytes
 */
export function bytesOf(kept: string): Uint8Array {
    const text = atob(kept);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
}
