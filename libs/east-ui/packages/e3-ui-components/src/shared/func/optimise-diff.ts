/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The diff of a run's result against its request, by entry key (#1409,
 * #1415; `Optimise Spec.md` §6 "The one step", §9.2 R7): absent → present is
 * an add, a different row a change — a move, to another day, time, lane,
 * hour or resource, is a change of placement — and present → absent a
 * remove. Untouched entries are not in the edit; entries outside the scope
 * are never touched. The diff becomes the builder's changes — `{ kind, id,
 * row, created }`, `{ kind, id, row }`, `{ kind, id, remove }` — for one
 * `record` call, and the operations the landing draws and the provenance
 * says (`data-op`, `Was {previous} · Elara run #n`), kept until Apply.
 *
 * @packageDocumentation
 */

import { encodeBeast2For, equalFor, parseFor, printFor, type EastType } from "@elaraai/east";
import type { ScheduleChange } from "../schedule/editing.js";
import type { OptimiseCounts } from "./use-optimise.js";

/**
 * One operation of a run on an entry (R7): what it did, and the row before
 * it, for the provenance.
 *
 * @typeParam R - The entry's row
 */
export type OptimiseOp<R = unknown> =
    | { readonly kind: string; readonly op: "add"; readonly row: R }
    | { readonly kind: string; readonly op: "chg"; readonly row: R; readonly previous: R }
    | { readonly kind: string; readonly op: "del"; readonly previous: R };

/**
 * A run's diff: its changes for one `record`, its operations by entry, and
 * what it counted.
 *
 * @typeParam R - The entries' row
 */
export interface OptimiseDiff<R = unknown> {
    readonly changes: readonly ScheduleChange[];
    /** Each operation, under {@link opKey}. */
    readonly ops: ReadonlyMap<string, OptimiseOp<R>>;
    readonly counts: OptimiseCounts;
}

/** No operations. */
export const NO_OPTIMISE_DIFF: OptimiseDiff<never> = { changes: [], ops: new Map(), counts: { added: 0, changed: 0, removed: 0 } };

/**
 * The key an entry's operation is kept under: its kind and its id, so two
 * kinds' entries of one id never meet.
 *
 * @param kind - The kind's slot, or the record's key
 * @param id - The entry's key's text
 * @returns The key
 */
export function opKey(kind: string, id: string): string {
    return `${kind}\u0000${id}`;
}

/**
 * An entry's key as its session names it: a String key as it is, any other
 * as East prints it — what a Schedule session's ids are.
 *
 * @param keyType - The record's key type
 * @returns The key's text
 */
export function optimiseIdOf<K>(keyType: EastType): (key: K) => string {
    if (keyType.type === "String") return (key) => key as unknown as string;
    const print = printFor(keyType) as (key: K) => string;
    return (key) => print(key);
}

/**
 * An entry's key from its id, as its session names it: a String key is its
 * own id, any other is read from East's text of it — {@link optimiseIdOf}'s
 * inverse, for the rows a request carries by key.
 *
 * @param keyType - The record's key type
 * @returns The key; `undefined` for an id that names no key of the type
 */
export function optimiseKeyOf<K>(keyType: EastType): (id: string) => K | undefined {
    if (keyType.type === "String") return (id) => id as unknown as K;
    const parse = parseFor(keyType) as (text: string) => { success: true; value: K } | { success: false };
    return (id) => {
        const read = parse(id);
        return read.success ? read.value : undefined;
    };
}

/**
 * The diff of one kind's rows, result against request (R7).
 *
 * @typeParam K - The key
 * @typeParam R - The row
 * @param kind - The kind's slot, or the record's key: what the changes name
 * @param rowType - The row's East type: how a row is compared and encoded
 * @param idOf - An entry's key as its session names it ({@link optimiseIdOf})
 * @param before - The rows asked, by key
 * @param after - The rows answered, by key
 * @returns The diff
 */
export function diffOptimiseRows<K, R>(kind: string, rowType: EastType, idOf: (key: K) => string, before: ReadonlyMap<K, R>, after: ReadonlyMap<K, R>): OptimiseDiff<R> {
    const same = equalFor(rowType) as (a: R, b: R) => boolean;
    const encode = encodeBeast2For(rowType) as (row: R) => Uint8Array;
    const changes: ScheduleChange[] = [];
    const ops = new Map<string, OptimiseOp<R>>();
    let added = 0, changed = 0, removed = 0;
    for (const [key, row] of after) {
        const id = idOf(key);
        const was = before.get(key);
        if (was === undefined) {
            changes.push({ kind, id, row: encode(row), created: true });
            ops.set(opKey(kind, id), { kind, op: "add", row });
            added++;
        } else if (!same(was, row)) {
            changes.push({ kind, id, row: encode(row) });
            ops.set(opKey(kind, id), { kind, op: "chg", row, previous: was });
            changed++;
        }
    }
    for (const [key, was] of before) {
        if (after.has(key)) continue;
        const id = idOf(key);
        changes.push({ kind, id, remove: true });
        ops.set(opKey(kind, id), { kind, op: "del", previous: was });
        removed++;
    }
    return { changes, ops, counts: { added, changed, removed } };
}

/**
 * A diff's operations told by the entries' places (§9.5): on a builder whose
 * entries have a place against a backlog — the Calendar's and the Plan's
 * canvas — an entry the run gave a place is an add on the canvas, whatever
 * its key did, and one the run took off its place is a remove, its ghost
 * where it stood; an entry moved, or changed in place, stays a change. The
 * session's changes are the diff's own: an entry the request held is
 * rewritten, never created.
 *
 * @typeParam R - The row
 * @param diff - The diff by key
 * @param placed - Whether a row has a place: a scheduled event, a placed job
 * @returns The diff, its operations and counts told by place
 */
export function optimisePlacementOps<R>(diff: OptimiseDiff<R>, placed: (row: R) => boolean): OptimiseDiff<R> {
    const ops = new Map<string, OptimiseOp<R>>();
    let added = 0, changed = 0, removed = 0;
    for (const [key, op] of diff.ops) {
        let told: OptimiseOp<R> = op;
        if (op.op === "chg") {
            const was = placed(op.previous), now = placed(op.row);
            if (!was && now) told = { kind: op.kind, op: "add", row: op.row };
            else if (was && !now) told = { kind: op.kind, op: "del", previous: op.previous };
        }
        ops.set(key, told);
        if (told.op === "add") added++; else if (told.op === "chg") changed++; else removed++;
    }
    return { changes: diff.changes, ops, counts: { added, changed, removed } };
}

/**
 * Several kinds' diffs as one: one `record` call across every record the
 * builder writes (R8).
 *
 * @param diffs - Each kind's diff
 * @returns The one diff
 */
export function mergeOptimiseDiffs<R>(diffs: readonly OptimiseDiff<R>[]): OptimiseDiff<R> {
    const changes: ScheduleChange[] = [];
    const ops = new Map<string, OptimiseOp<R>>();
    let added = 0, changed = 0, removed = 0;
    for (const diff of diffs) {
        changes.push(...diff.changes);
        for (const [key, op] of diff.ops) ops.set(key, op);
        added += diff.counts.added; changed += diff.counts.changed; removed += diff.counts.removed;
    }
    return { changes, ops, counts: { added, changed, removed } };
}
