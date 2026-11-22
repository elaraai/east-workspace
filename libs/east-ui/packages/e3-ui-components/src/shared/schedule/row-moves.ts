/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a gesture moves under the keys their fields build
 * (east-workspace#1709), asked before the gesture is recorded: what a builder
 * that writes its kinds a whole row at a time — the Flowchart, the Schematic —
 * asks of a gesture's changes, so what names a moving row follows it in the
 * same step. Whether a row moves, and where, is the one rule every builder
 * follows (`../built-keys.ts`' `builtKeyOf`).
 *
 * @packageDocumentation
 */

import { builtKeyOf } from "../built-keys.js";
import type { ScheduleChange } from "./editing.js";

/** A row a gesture's changes move under the key its fields build. */
export interface RowMove {
    /** Its kind's slot, or its record's key. */
    readonly kind: string;
    /** The key it stands under. */
    readonly key: string;
    /** The key its row builds once the gesture is made. */
    readonly to: string;
}

/** A row whose kind's `key` failed on it as a gesture's changes leave it: the gesture moves nothing, and is refused. */
export interface RowMoveFailed {
    /** The row, and what building its key threw. */
    readonly failed: { readonly kind: string; readonly key: string; readonly error: unknown };
}

/** No row moves. */
const NO_ROW_MOVES: readonly RowMove[] = [];

/** A row a gesture touches, as its changes so far leave it. */
interface Touched {
    readonly kind: string;
    readonly key: string;
    /** The row as the changes leave it; `undefined` for one they remove, or have yet to write. */
    after: Uint8Array | undefined;
    /** Whether a change has written it, or removed it. */
    left: boolean;
    /** Whether the gesture makes it: a new row, keyed as its kind makes one. */
    made: boolean;
}

/**
 * The rows a gesture's changes move under the keys their fields build: each
 * row the gesture finds held — never one it makes, which its kind keys as it
 * makes one — whose kind builds its key from its row, where the key its row
 * builds once the changes are made is another than the one it stands under,
 * and another than its row built as the gesture found it (`builtKeyOf`). The
 * changes are composed in order over each row as the gesture finds it. A
 * gesture touching no kind that builds its keys moves no row: its changes are
 * never composed.
 *
 * @param changes - The gesture's changes
 * @param found - A row as the gesture finds it — drafted, else as its record holds it — by its kind and its key;
 *   `undefined` for one it finds none of
 * @param builderOf - How a kind builds a key's text from a row's bytes; `undefined` for a kind that builds none
 * @returns Each row moved, in the order the gesture touches them; or the row whose key failed as it was built
 */
export function rowMovesOf(changes: readonly ScheduleChange[], found: (kind: string, key: string) => Uint8Array | undefined,
    builderOf: (kind: string) => ((row: Uint8Array) => string) | undefined): readonly RowMove[] | RowMoveFailed {
    if (!changes.some((change) => builderOf(change.kind) !== undefined)) return NO_ROW_MOVES;
    // Each row the gesture touches, in the order it first touches them, as its changes so far leave it.
    const byKind = new Map<string, Map<string, Touched>>();
    const touched: Touched[] = [];
    for (const change of changes) {
        let rows = byKind.get(change.kind);
        if (rows === undefined) { rows = new Map(); byKind.set(change.kind, rows); }
        let row = rows.get(change.id);
        if (row === undefined) {
            row = { kind: change.kind, key: change.id, after: undefined, left: false, made: false };
            rows.set(change.id, row);
            touched.push(row);
        }
        const was = row.left ? row.after : found(change.kind, change.id);
        if ("remove" in change) {
            row.after = undefined;
            row.left = true;
        } else if ("row" in change) {
            row.after = change.row;
            row.left = true;
            if (change.created === true) row.made = true;
        } else if ("rewrite" in change && was !== undefined) {
            // A rewrite that refuses, or fails, leaves the row as it found it.
            let rewritten: Uint8Array | undefined;
            try { rewritten = change.rewrite(was); } catch { rewritten = undefined; }
            row.after = rewritten ?? was;
            row.left = true;
        }
    }
    const moves: RowMove[] = [];
    for (const { kind, key, after, made } of touched) {
        const build = builderOf(kind);
        const was = found(kind, key);
        if (made || build === undefined || was === undefined || after === undefined) continue;
        const moved = builtKeyOf(build, key, was, after);
        if (moved === undefined) continue;
        if ("failed" in moved) return { failed: { kind, key, error: moved.failed } };
        moves.push({ kind, key, to: moved.to });
    }
    return moves;
}
