/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows an optimiser's answer waits on (east-workspace#1622, rule 8): an
 * answer that touches a row the page does not hold lands once the row is read
 * by its key, so the session keeps the whole entry as it does for every edit.
 * The run (`useOptimise`) names the rows its builder's landing answers it is
 * missing ({@link OptimiseRows.want}); they are read here, tracked, in the
 * builder's render — each record's in one read, as a Save's entries are read
 * back (#1596), never one key search a row, which a source answers only the
 * last of — and kept as they land ({@link OptimiseRows.read}). Each read's
 * landing moves {@link OptimiseRows.key}, and the run, which follows it, asks
 * the builder again with the reads in its hand.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState } from "react";
import type { option } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { OptimiseRowRef } from "./optimise-diff.js";

/** The rows an answer waits on, as they are read, and what moves as they are. */
export interface OptimiseRows {
    /**
     * Names the rows an answer waits on: read by their keys from the next render. The same rows named again ask
     * nothing new.
     *
     * @param rows - The rows, each by its kind and its key's text; none once the answer has landed
     */
    want(rows: readonly OptimiseRowRef[]): void;
    /**
     * A row named, as its read by its key left it.
     *
     * @param kind - The kind's slot, or the record's key
     * @param id - The row's key's text
     * @returns Its row; `none` for one the record does not hold; `undefined` for a row not named, or still being read
     */
    read(kind: string, id: string): option<unknown> | undefined;
    /** Moves as a row named is read: a text of the rows named and where each read stands. */
    readonly key: string;
}

/** Several rows of one kind's record read by their keys, in one read: each row by its key's text; `undefined` while the read is on its way. */
export type OptimiseRowsReader = (kind: string, ids: readonly string[]) => ReadonlyMap<string, option<unknown>> | undefined;

/** No rows read by their keys: a builder with no session over its records — a read-only one, which has no optimiser — reads none. */
export const NO_OPTIMISE_ROWS: OptimiseRowsReader = () => undefined;

const NONE: readonly OptimiseRowRef[] = [];
const NOTHING_READ: ReadonlyMap<string, option<unknown>> = new Map();

/** A row's name among those wanted: its kind and its key's text, which no other row's makes. */
const nameOf = (kind: string, id: string): string => `${kind}\u0000${id}`;

/**
 * Reads the rows an answer waits on (see the module docs).
 *
 * @param readByKeys - Several rows of a kind's record by their keys, in one tracked read (`ScheduleEditing.rowsByKey`)
 * @returns How the builder names the rows, each as it is read, and what moves as they are
 */
export function useOptimiseRows(readByKeys: OptimiseRowsReader): OptimiseRows {
    const [wanted, setWanted] = useState<readonly OptimiseRowRef[]>(NONE);
    // Each kind's rows in one read: what has landed, by the row's name.
    const readAll = useCallback((): ReadonlyMap<string, option<unknown>> => {
        if (wanted.length === 0) return NOTHING_READ;
        const byKind = new Map<string, string[]>();
        for (const { kind, id } of wanted) {
            const ids = byKind.get(kind);
            if (ids === undefined) byKind.set(kind, [id]); else ids.push(id);
        }
        const out = new Map<string, option<unknown>>();
        for (const [kind, ids] of byKind) {
            let read: ReadonlyMap<string, option<unknown>> | undefined;
            // A read that fails leaves its rows unread: the run stays out, and Stop ends it.
            try { read = readByKeys(kind, ids); } catch (err) { console.error(`[Optimise] ${kind}'s rows could not be read by their keys:`, err); }
            if (read === undefined) continue;
            for (const id of ids) {
                const row = read.get(id);
                if (row !== undefined) out.set(nameOf(kind, id), row);
            }
        }
        return out;
    }, [wanted, readByKeys]);
    const { result } = useTrackedEvaluation(readAll);
    const landed = result.ok ? result.value : NOTHING_READ;
    const want = useCallback((rows: readonly OptimiseRowRef[]) => {
        setWanted((held) => {
            if (held.length === rows.length && held.every((one, i) => nameOf(one.kind, one.id) === nameOf(rows[i]!.kind, rows[i]!.id))) return held;
            return rows.length === 0 ? NONE : rows;
        });
    }, []);
    const read = useCallback((kind: string, id: string) => landed.get(nameOf(kind, id)), [landed]);
    // Each row named, and where its read stands: other rows named move it as a read's landing does.
    const key = useMemo(() => wanted.map(({ kind, id }) => `${nameOf(kind, id)}=${landed.get(nameOf(kind, id))?.type ?? "reading"}`).join("\u0001"), [wanted, landed]);
    return useMemo(() => ({ want, read, key }), [want, read, key]);
}
