/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's drafted rows as it renders (#1599): `drafted-rows.ts`' rows,
 * read from the shared editing's sessions.
 *
 * - **Read again as the history moves**, never only as the drafts' bytes do:
 *   what a row began from moves under an unchanged draft — another session
 *   removed the row, or its own Save landed.
 * - **The same object while no row moves**, so what draws from them holds
 *   still while a Save is sent or read back.
 * - **A session behind its record is said to be carrying its drafts over**
 *   (the shared editing's `carrying`) from the very render the record's
 *   revision moves in: the session itself is told after that render, and a
 *   builder whose rows of the new revision were at hand already would draw one
 *   frame by what the session said of the old.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { StringType, equalFor } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { NO_DRAFTED_ROWS, draftedRowsOf, type DraftedRows, type DraftedRowsByKind, type DraftedRowsCache, type DraftedRowsKind } from "./drafted-rows.js";
import type { ScheduleEditing } from "./editing.js";

const stringEqual = equalFor(StringType);

/**
 * Every kind's drafted rows (see `drafted-rows.ts`), read again as the history moves and the same object while no row
 * does.
 *
 * @param schedule - The shared editing over the kinds' records
 * @param kinds - The kinds, each named as its session is
 * @returns Each kind's rows, by what its session is named by: none of a kind with no draft
 */
export function useDraftedRows(schedule: Pick<ScheduleEditing, "version" | "drafts" | "sessions" | "draftsOf" | "carrying">, kinds: readonly DraftedRowsKind[]): DraftedRowsByKind {
    const cache = useRef<DraftedRowsCache>(new WeakMap());
    const held = useRef<DraftedRowsByKind>(NO_DRAFTED_ROWS);
    const { version, drafts, sessions, draftsOf, carrying } = schedule;
    // Whether each kind's session has yet to judge its drafts where its record reads now (tracked: it reads the record's
    // revision) — from the very render the record moves in, before the session itself is told.
    const readCarrying = useCallback(() => kinds.map((kind) => carrying(kind.key)),
        // The sessions move under the history's version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [kinds, carrying, version]);
    const { result: read } = useTrackedEvaluation(readCarrying);
    const behind = read.ok ? read.value : undefined;
    return useMemo(() => {
        const was = held.current;
        const out = new Map<string, DraftedRows<unknown>>();
        kinds.forEach((kind, i) => {
            const ids = draftsOf(kind.key);
            if (ids.size === 0) return;
            const session = sessions.find((part) => stringEqual(part.kind, kind.key))?.session;
            const from = session === undefined ? undefined : { entries: session.entries, originals: session.originals, carrying: session.carrying || behind?.[i] === true };
            out.set(kind.key, draftedRowsOf(kind, ids.keys(), from, cache.current, was.get(kind.key)));
        });
        if (out.size === was.size && [...out].every(([key, rows]) => Object.is(was.get(key), rows))) return was;
        held.current = out;
        return out;
        // The sessions' maps are mutable: the history's version records each change of them, an original's among them,
        // and the drafts say which entries are drafted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, drafts, sessions, kinds, draftsOf, behind]);
}
