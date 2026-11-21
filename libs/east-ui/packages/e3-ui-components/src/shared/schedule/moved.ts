/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's rows as a builder keeps them itself — the Roster's stored duties,
 * the Allocation's stored bins — filed by the keys the drafts stand them under
 * (east-workspace#1709): a row an edit moved under the key its fields build is
 * the row it was, edited, never one removed under the key it had and one added
 * under its new one.
 *
 * @packageDocumentation
 */

/**
 * The rows, each one the drafts moved under the key its fields build filed under that key
 * (`ScheduleEditing.movedFrom`). A key the rows hold a row under already keeps it.
 *
 * @param rows - The rows as the record holds them, by their keys' texts
 * @param moved - The moves the drafts hold: each key a row moved to, to the key the record holds it under
 * @returns The rows so filed; the same object where no move holds of them
 */
export function heldUnderMoves<T>(rows: ReadonlyMap<string, T>, moved: ReadonlyMap<string, string> | undefined): ReadonlyMap<string, T> {
    if (moved === undefined || moved.size === 0) return rows;
    let out: Map<string, T> | undefined;
    for (const [to, from] of moved) {
        const row = rows.get(from);
        if (row === undefined || rows.has(to)) continue;
        out ??= new Map(rows);
        out.delete(from);
        out.set(to, row);
    }
    return out ?? rows;
}
