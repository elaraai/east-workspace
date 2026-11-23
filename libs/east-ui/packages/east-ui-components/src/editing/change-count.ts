/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How many changes a session holds, as a person counts them
 * (east-workspace#1709).
 *
 * @packageDocumentation
 */

import { EditHistory } from "./history.js";
import type { EditSession } from "./session.js";

/**
 * How many changes a session holds, as a person counts them: each entry its drafts change, a row moved under the key its
 * fields build counted once (east-workspace#1709) — never as the row removed under the key it left and the row added
 * under the one it stands under now, the two entries the session holds of it ({@link EditSession.moved}). Over one
 * history of several sessions, every session's together. What the history bar's count and its Discard's question say,
 * and what a builder's own count of its changes says.
 *
 * @param session - The session, or one history over several
 * @returns The count
 */
export function changeCount<W>(session: EditSession<W> | EditHistory<W>): number {
    if (!(session instanceof EditHistory)) return session.pending - session.moved.size;
    let n = 0;
    for (const key of session.keys) {
        const one = session.session(key);
        if (one !== undefined) n += changeCount(one);
    }
    return n;
}
