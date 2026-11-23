/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a host compares an entry's draft with (east-workspace#1709).
 *
 * @packageDocumentation
 */

import type { EditSession, EntryVersion } from "./session.js";

/**
 * The version a host compares an entry's draft with: the one its source held as the drafts began — and for an entry a
 * gesture moved under another id ({@link EditSession.moved}), its source's under the id it left. A row its builder moved
 * under the key its fields build is the row it was, edited: never a new row, which its source holding none under the
 * key it stands under now would make it — one a discard would drop as never saved, while its removal under the key it
 * left stood.
 *
 * @param session - The editing session
 * @param id - The entry, by the id it stands under now
 * @returns The version; `undefined` for an entry the session holds no original of
 */
export function baselineOf<W>(session: EditSession<W>, id: string): EntryVersion<W> | undefined {
    return session.originals.get(session.moved.get(id) ?? id);
}
