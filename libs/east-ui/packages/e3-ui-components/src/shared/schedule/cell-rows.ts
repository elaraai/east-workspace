/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a builder's reader read of its event kinds, as the kinds' read seams take them (#1771): held under a handle,
 * the rows as the page unpacked them from e3 — never packed for a kind to unpack again — and answered to each seam's
 * `schedule_cell_rows` read at the kind's cells type. A kind's seams are told which rows to read by the handle (the
 * `rows` case of e3-ui's `ScheduleCellReadType`); a kind the reader reads none of is told so, and reads nothing here.
 *
 * A reader holds a kind's rows under a new handle each time what they are made from moves, makes them when a seam first
 * reads them, and lets go of the handles nothing it hands on names any more (`cells.ts`). A reader no builder holds
 * any more lets go of all of its own.
 *
 * @packageDocumentation
 */

import type { PlatformFunction } from "@elaraai/east/internal";
import { scheduleCellRows } from "@elaraai/e3-ui/internal";
import { registerPlatformImplementation } from "@elaraai/east-ui-components/platform";

/** Rows held under a handle: made when a seam first reads them, and kept as made. */
interface Held {
    rows: readonly unknown[] | undefined;
    readonly make: () => readonly unknown[];
}

/** The rows held, by handle. */
const held = new Map<string, Held>();

/** How many handles have been made: what the next is numbered by, so none is ever made twice. */
let made = 0;

/**
 * Holds rows under a new handle (#1771).
 *
 * @param make - The rows, an Array of `{ key, row }` at the kind's cells type: made once, when they are first read
 * @returns The handle, never made before
 */
export function holdCellRows(make: () => readonly unknown[]): string {
    made += 1;
    const handle = `cells-${made}`;
    held.set(handle, { rows: undefined, make });
    return handle;
}

/**
 * Lets go of rows held: a seam is never handed these handles again.
 *
 * @param handles - The handles
 */
export function releaseCellRows(handles: Iterable<string>): void {
    for (const handle of handles) held.delete(handle);
}

/**
 * The rows held under a handle, as a seam reads them: made, where they were not yet.
 *
 * @param handle - The handle
 * @returns The rows; `undefined` for a handle nothing holds — never made, or let go of
 * @internal
 */
export function heldCellRows(handle: string): readonly unknown[] | undefined {
    const entry = held.get(handle);
    if (entry === undefined) return undefined;
    entry.rows ??= entry.make();
    return entry.rows;
}

/**
 * How many handles hold rows now: what the specs hold a reader's letting go to.
 *
 * @returns The count
 * @internal
 */
export function heldCellRowsCount(): number {
    return held.size;
}

/**
 * `schedule_cell_rows`, as the renderer answers it (#1771): the rows held under the handle, as they are — whatever the
 * cells type, which the rows are of already. A handle nothing holds is a read let go of, refused naming it.
 */
export const ScheduleCellRowsImpl: PlatformFunction[] = [
    scheduleCellRows.implement(() => (handle: unknown) => {
        const rows = heldCellRows(handle as string);
        if (rows === undefined) {
            throw new Error(`Schedule: no rows are held under "${handle as string}" — a kind's seam was handed a read its builder had let go of`);
        }
        return rows;
    }),
];

registerPlatformImplementation(ScheduleCellRowsImpl);
