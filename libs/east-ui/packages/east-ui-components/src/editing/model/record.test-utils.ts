/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A small record for the editing core's proof harness (test use): rows by a
 * String key, a revision a commit, each revision's rows kept, and a patch door
 * that checks a Save's batch as an e3 record's does (`Record.onApply`, keyed).
 *
 * - Each change of the batch is restated as its row's insert, update or
 *   delete of a Dict patch — an update the row's own patch, a field at a time
 *   — and the whole is applied by East's patch apply: every row's change, or
 *   none. A part a change began from that the record no longer holds refuses
 *   the batch, as a conflict.
 * - A request id is answered once: sent again, it is answered as it was, and
 *   nothing is applied twice.
 * - Another session's write is a commit of its own, at a revision of its own.
 * - Every commit says who made it and each field it changed, from what to
 *   what: what the harness's checks read (`world.test-utils.ts`).
 *
 * @packageDocumentation
 */
import {
    ConflictError, DictType, IntegerType, SortedMap, StringType, StructType, applyFor, compareFor, diffFor, equalFor, none, some, variant,
    type ValueTypeOf, type option,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";

/** A row of the record: two numbers a session edits apart. */
export const Row = StructType({ a: IntegerType, b: IntegerType });
/** A row's value. */
export type RowValue = ValueTypeOf<typeof Row>;
/** A row's field. */
export type Field = keyof RowValue;
/** Every field of a row. */
export const FIELDS: readonly Field[] = ["a", "b"];
/** The record: rows by a String key. */
export const Rows = DictType(StringType, Row);
/** A Save's batch over the record. */
export const Batch = Editing.Types.ChangeSet(Row, StringType);
/** A batch's value. */
export type BatchValue = ValueTypeOf<typeof Batch>;
/** What the record answers a batch with. */
export type Answer = ValueTypeOf<typeof Editing.Types.ApplyResult>;
/** The record's rows, in key order. */
export type RowsValue = SortedMap<string, RowValue>;

const compareKeys = compareFor(StringType);
const applyRows = applyFor(Rows);
const diffRow = diffFor(Row);
/** Whether two of a row's numbers are equal. */
export const numberEqual = equalFor(IntegerType);
/** Whether two texts — keys, fields' names, revisions — are equal. */
export const textEqual = equalFor(StringType);
/** A field's value: a number, or `undefined` while its row is absent. */
export type Value = bigint | undefined;

/** Whether two of a field's values are equal: each a number, or `undefined` for a row absent. */
export function sameValue(a: Value, b: Value): boolean {
    return a === undefined || b === undefined ? a === b : numberEqual(a, b);
}
/** Whether two collections of rows are equal. */
export const rowsEqual = equalFor(Rows) as (a: RowsValue, b: RowsValue) => boolean;

/** Rows from their entries. */
export function rowsOf(entries: Iterable<readonly [string, RowValue]>): RowsValue {
    return new SortedMap<string, RowValue>([...entries].map(([key, row]) => [key, row] as [string, RowValue]), compareKeys);
}

/** What changed a field of a row last: a session, by its name, or `remote` — a write no session of the harness made. */
export type Writer = string;

/** One commit of the record: who made it, and each field it changed, from what to what — `undefined` for a row absent. */
export interface ModelCommit {
    /** The revision it made. */
    readonly revision: string;
    /** Who made it. */
    readonly by: Writer;
    /** Each field of each row it changed. */
    readonly changed: readonly ModelChange[];
}

/** One field of one row a commit changed: from what to what, `undefined` for a row absent. */
export interface ModelChange {
    /** The row's key. */
    readonly key: string;
    /** The field. */
    readonly field: Field;
    /** What the record held there. */
    readonly before: Value;
    /** What it holds there now. */
    readonly after: Value;
}

/**
 * The record of the proof harness — see the module docs.
 */
export class ModelRecord {
    private rows: RowsValue;
    private serial = 1;
    private readonly held = new Map<string, RowsValue>();
    private readonly answers = new Map<string, Answer>();
    /** Every commit, oldest first. */
    readonly commits: ModelCommit[] = [];
    /** How many batches it applied: one a request id, however often the request was sent. */
    applied = 0;

    /**
     * @param rows - The rows it begins with, at revision `r1`
     */
    constructor(rows: Iterable<readonly [string, RowValue]>) {
        this.rows = rowsOf(rows);
        this.held.set(this.revision, this.rows);
    }

    /** The revision it is at. */
    get revision(): string { return `r${this.serial}`; }
    /** Its rows now. */
    get now(): RowsValue { return this.rows; }

    /**
     * A row as the record holds it now.
     *
     * @param key - The row's key
     * @returns The row, or `none`
     */
    row(key: string): option<RowValue> {
        const row = this.rows.get(key);
        return row === undefined ? none : some(row);
    }

    /**
     * The rows a revision held.
     *
     * @param revision - The revision
     * @returns Its rows
     * @throws {Error} For a revision the record never was at
     */
    at(revision: string): RowsValue {
        const rows = this.held.get(revision);
        if (rows === undefined) throw new Error(`The record never was at ${revision}`);
        return rows;
    }

    /**
     * A Save's batch through the patch door: applied whole, or refused whole.
     *
     * @param batch - The batch
     * @param by - Who sends it
     * @returns The record's answer: the revision the batch made, or its conflict — the same answer for the same request id
     */
    commit(batch: BatchValue, by: Writer): Answer {
        const answered = this.answers.get(batch.requestId);
        if (answered !== undefined) return answered;
        // Each change, restated by key: the batch's own values and entry patches, carrying what each row was as its edit began.
        const ops = new SortedMap<string, unknown>([], compareKeys);
        for (const change of batch.changes) {
            const patch = change.patch;
            if (patch.type === "replace") {
                const { before, after } = patch.value;
                if (after.type === "some") ops.set(change.id, before.type === "some" ? variant("update", diffRow(before.value, after.value)) : variant("insert", after.value));
                else if (before.type === "some") ops.set(change.id, variant("delete", before.value));
            } else if (patch.type === "patch" && patch.value.type === "some") {
                ops.set(change.id, variant("update", patch.value.value));
            }
        }
        let answer: Answer;
        try {
            this.move(rowsOf(applyRows(this.rows, variant("patch", ops))), by);
            this.applied++;
            answer = variant("applied", { revision: some(this.revision) });
        } catch (error) {
            if (!(error instanceof ConflictError)) throw error;
            // As a record read a window at a time answers: its own issue, and each row the batch changed.
            answer = variant("conflict", [
                { entry: "", row: none, field: none, message: "The record changed since this edit began" },
                ...batch.changes.map((change) => ({ entry: change.id, row: none, field: none, message: "Changed since this edit began" })),
            ]);
        }
        this.answers.set(batch.requestId, answer);
        return answer;
    }

    /**
     * Another session's write: a commit of its own.
     *
     * @param write - What it does to the rows, given a copy of them
     * @returns Whether it changed anything
     */
    write(write: (rows: RowsValue) => void): boolean {
        const next = rowsOf(this.rows);
        write(next);
        if (rowsEqual(next, this.rows)) return false;
        this.move(next, "remote");
        return true;
    }

    /**
     * Who changed a field of a row last.
     *
     * @param key - The row's key
     * @param field - The field
     * @returns The writer; `undefined` for a field no commit changed
     */
    writerOf(key: string, field: Field): Writer | undefined {
        for (let i = this.commits.length - 1; i >= 0; i--) {
            const commit = this.commits[i]!;
            if (commit.changed.some((change) => textEqual(change.key, key) && textEqual(change.field, field))) return commit.by;
        }
        return undefined;
    }

    /**
     * The revision that last changed a field of a row — or, given no field, any of its fields — at a revision or before
     * it: which write the value there is.
     *
     * @param key - The row's key
     * @param field - The field; `undefined` for the row as a whole
     * @param at - The revision
     * @returns The revision of that write; `r1` where no commit had changed it by then
     */
    stampOf(key: string, field: Field | undefined, at: string): string {
        let stamp = "r1";
        if (textEqual(at, stamp)) return stamp;
        for (const commit of this.commits) {
            if (commit.changed.some((change) => textEqual(change.key, key) && (field === undefined || textEqual(change.field, field)))) stamp = commit.revision;
            if (textEqual(commit.revision, at)) break;
        }
        return stamp;
    }

    /**
     * How many commits the record had made at a revision.
     *
     * @param revision - The revision
     * @returns The count: 0 at the revision it began at
     * @throws {Error} For a revision the record never was at
     */
    commitsAt(revision: string): number {
        if (textEqual(revision, "r1")) return 0;
        const at = this.commits.findIndex((commit) => textEqual(commit.revision, revision));
        if (at < 0) throw new Error(`The record never was at ${revision}`);
        return at + 1;
    }

    /**
     * Which of the record's writes put a field of a row at a value: the latest that did.
     *
     * @param key - The row's key
     * @param field - The field
     * @param value - The value
     * @returns How many commits the record had made by then, counting that one — 0 for the rows it began with; `undefined`
     *   for a value the record never held there
     */
    writtenAt(key: string, field: Field, value: Value): number | undefined {
        for (let i = this.commits.length - 1; i >= 0; i--) {
            if (this.commits[i]!.changed.some((change) => textEqual(change.key, key) && textEqual(change.field, field) && sameValue(change.after, value))) return i + 1;
        }
        return sameValue(this.at("r1").get(key)?.[field], value) ? 0 : undefined;
    }

    /**
     * The fields of a batch's rows that the record holds otherwise than the batch's changes began from: why it would
     * refuse the batch.
     *
     * @param batch - The batch
     * @returns Each such field, by its row's key
     */
    mismatched(batch: BatchValue): { readonly key: string; readonly field: Field }[] {
        const out: { key: string; field: Field }[] = [];
        for (const change of batch.changes) {
            const now = this.rows.get(change.id);
            const patch = change.patch;
            /** Each field a whole row began from that the record holds otherwise. */
            const whole = (before: RowValue | undefined) => {
                for (const field of FIELDS) if (!sameValue(before?.[field], now?.[field])) out.push({ key: change.id, field });
            };
            if (patch.type === "replace") whole(patch.value.before.type === "some" ? patch.value.before.value : undefined);
            else if (patch.type === "patch" && patch.value.type === "some") {
                const row = patch.value.value;
                if (row.type === "replace") whole(row.value.before);
                else if (row.type === "patch") {
                    for (const field of FIELDS) {
                        const part = row.value[field];
                        if (part.type === "replace" && !sameValue(part.value.before, now?.[field])) out.push({ key: change.id, field });
                    }
                }
            }
        }
        return out;
    }

    /** The record moved to new rows: a revision, and what changed in it. */
    private move(next: RowsValue, by: Writer): void {
        const changed: ModelChange[] = [];
        for (const key of new Set([...this.rows.keys(), ...next.keys()])) {
            const [was, is] = [this.rows.get(key), next.get(key)];
            for (const field of FIELDS) {
                const [before, after] = [was?.[field], is?.[field]];
                if (!sameValue(before, after)) changed.push({ key, field, before, after });
            }
        }
        this.rows = next;
        this.serial++;
        this.held.set(this.revision, next);
        this.commits.push({ revision: this.revision, by, changed });
    }
}
