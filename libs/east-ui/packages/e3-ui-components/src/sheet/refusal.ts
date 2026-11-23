/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a refused gesture shows beside its words (east-workspace#1709), read off the message it left
 * ({@link SheetNotice}) — so a change that did not happen is never read as one that did:
 *
 * - **the line that says it** takes the danger tone ({@link noticeRefuses}): the Sheet's footer message, the Record's
 *   status line;
 * - **the row it was refused on** is marked ({@link refusedRowOf}): the row whose fields would have moved it under a key
 *   another row holds, or under none, flashes where it stands — it holds what it held. Each refusal is the other turn
 *   of the one before, so a row refused twice running flashes twice (east-ui-components' `refused-mark.ts`).
 *
 * Both last as long as the message does: the next gesture's words, or a step of the history, takes them away — and so
 * does the next gesture taken, whatever it says (`sheet-state.ts`, `taken`): a refusal said on, after a change that
 * happened, would be read as of that change.
 *
 * @packageDocumentation
 */

import type { SheetNotice } from "./sheet-types.js";

/**
 * Whether a message says a gesture was refused: nothing of it taken, or — a clear — some of it left as it was.
 *
 * @param notice - The message a gesture left; `null` for none
 * @returns Whether the line that says it takes the danger tone
 */
export function noticeRefuses(notice: SheetNotice | null): boolean {
    switch (notice?.id) {
        case "editRefused":
        case "clearRefused":
        case "dropRefused":
        case "keyTaken":
        case "keyFailed":
        case "cantAdd":
        case "keyRefused":
            return true;
        // A paste no cell took.
        case "pasted": return notice.wrote === false;
        default: return false;
    }
}

/** A refusal's turn — each the other of the one before: what a refused row's mark starts over by. */
export type RefusedTurn = "0" | "1";

/** The row a gesture was refused on: its id, and the refusal's turn. */
export interface RefusedRow {
    readonly id: string;
    readonly turn: RefusedTurn;
}

/**
 * The row a message says a gesture was refused on, for its key: a row the sheet holds, which the gesture would have
 * moved. None for any other message, and for a row never added.
 *
 * @param notice - The message a gesture left; `null` for none
 * @returns The row and the refusal's turn, or `undefined`
 */
export function refusedRowOf(notice: SheetNotice | null): RefusedRow | undefined {
    if (notice?.id !== "keyRefused" || notice.row === undefined) return undefined;
    return { id: notice.row, turn: (notice.nth ?? 0) % 2 === 0 ? "0" : "1" };
}
