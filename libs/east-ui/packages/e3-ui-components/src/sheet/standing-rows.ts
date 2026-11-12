/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A drafted row that stands through a carry-over (#1599) — pure: whether the
 * rows a sheet draws, read again, have closed over the place a drafted row
 * stood at.
 *
 * A sheet over a record read a page at a time draws a drafted row where its
 * page holds the row. A record that moves is read again a page at a time, and
 * the session reads each drafted row there by its key only after: until that
 * read lands, the session still holds the row as one its record holds. A row
 * changed here that another session removed is then on no page, and not yet a
 * row its draft adds: drawn only where a page holds it, it left the grid for a
 * round trip, and came back with its conflict.
 *
 * Such a row stands where it stood until its session has judged it — but only
 * one the rows read again have closed over, which tells it from a row the
 * sheet no longer draws because its page was let go, scrolled away from:
 *
 * - another row stands at the position it stood at, read at the revision the
 *   source reads at now; or
 * - none does, and the source, counted at that revision, ends before that
 *   position: it was the source's last row.
 *
 * A row whose page was let go has no row drawn at its position, in a source
 * that reaches past it. Positions are the source's own, in whatever order it
 * serves its rows, so the rule holds of a record's key order and of an index's
 * alike.
 *
 * @packageDocumentation
 */

/**
 * Whether the rows the sheet draws now, read again, have closed over the position a row stood at (see the module docs):
 * the row is gone from its place in its source's rows as they are read now, never merely off the pages the sheet holds.
 *
 * @param position - The source position the row stood at
 * @param idAt - The row drawn at a source position now; `undefined` for none
 * @param readNow - Whether the row drawn at a source position was read at the revision its source reads at now
 * @param total - How many rows the source holds, counted at the revision it reads at now; `undefined` while that count is
 *   not known
 * @returns Whether they have
 */
export function closedOver(position: number, idAt: (position: number) => string | undefined, readNow: (position: number) => boolean, total: number | undefined): boolean {
    // Another row stands there, read now: its page was read again, and holds the row no more.
    if (idAt(position) !== undefined) return readNow(position);
    // None does: closed over only where the source ends before it. A page let go leaves no row there, in a source that goes on.
    return total !== undefined && total <= position;
}
