/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A call with drafts that the source refused because another write got there
 * first (east-workspace#1622, rule 12; east-workspace#1624, rule 12): the one
 * path a builder's optimiser (`use-optimise.ts`) and its fit (`use-fit.ts`)
 * both take. The call lands nothing. The page reads the records it passed
 * drafts of again ({@link readRecordsAgain}), its sessions take the newer
 * saves in and carry their edits over them, as they do for a Save refused for
 * the same reason, and once they stand on what the page read
 * ({@link afterConflict}): with a conflict to choose, the call has failed in
 * the refused Save's words, until the person chooses; with none, it goes
 * again with the new drafts — as many times in a row as a session sends a
 * refused Save again (`SAVE_RESENDS`), after which it has failed in the
 * source's own words.
 *
 * @packageDocumentation
 */

import { SAVE_RESENDS } from "@elaraai/east-ui-components/internal";
import { defaultRecordRuntime } from "../../platform/index.js";
import type { OptimiseSessions } from "./use-optimise.js";

/**
 * Has the page read each record again, from here on: what its sessions take
 * newer saves in from. Every record in one poll (`RecordRuntime.readAgain`):
 * the page's polls each read all of them, so one mark and one refresh serve
 * every record, never a poll queued behind another's.
 *
 * @param records - The records, by name
 * @returns Settles once the page has read every one again
 */
export function readRecordsAgain(records: readonly string[]): Promise<void> {
    return defaultRecordRuntime.readAgain(records);
}

/**
 * What a call refused for a conflict comes to: sent again, or failed —
 * `refused` the words where a conflict waits to be chosen.
 */
export type ConflictNext = { readonly again: true } | { readonly failed: string; readonly refused?: string };

/**
 * What a call refused because a record moved under its drafts comes to, once
 * the page has read the records again and the sessions stand on what it read.
 *
 * @param sessions - The builder's sessions
 * @param records - The records the call passed drafts of, by name
 * @param resent - How many times in a row the call has gone again for a conflict
 * @param message - The source's refusal, in its own words
 * @returns `again` where nothing is to choose and it may go again; else why it failed
 */
export function afterConflict(sessions: Pick<OptimiseSessions, "conflicts">, records: readonly string[], resent: number, message: string): ConflictNext {
    const toChoose = sessions.conflicts(records);
    if (toChoose !== undefined) return { failed: toChoose, refused: toChoose };
    return resent >= SAVE_RESENDS ? { failed: message } : { again: true };
}
