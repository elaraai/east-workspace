/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's drafted rows as a builder that draws its records' own rows takes
 * them (#1599) — the Schematic's and the Flowchart's: each drafted row read
 * through its kind's `read`, whether its draft adds it, and the roles of the
 * row its session began from.
 *
 * - **Whether a draft adds its row is its session's word**, never the
 *   gesture's that made the draft: the session's original of the row holds
 *   none. The original moves apart from the draft. A row a gesture created is
 *   one its record holds once its Save lands, a later draft of it a change of
 *   that row; and a row its record held is one its draft adds once another
 *   session removes it — the draft standing, a conflict to choose. Read once
 *   as the draft was first decoded, a row changed here and removed by another
 *   session was still a row its record held: its builder, which draws a
 *   drafted row its read does not hold only where the draft adds it — any
 *   other is one a narrowing hides, waiting in its session — drew nothing of
 *   it, while its person was asked to choose over it.
 * - **Decoded once** for the version its session holds of the row and the
 *   original beside it: a session keeps each the same object until a gesture,
 *   a Save or a carry-over replaces it.
 * - **Held while nothing moves** (`use-drafted-rows.ts`). The rows are read
 *   again whenever the history moves — an original moves with no change of
 *   the drafts' bytes, which is all the shared editing's `drafts` follows —
 *   and a kind's rows are the same map while each row is the same object, so
 *   what draws from them holds still while a Save is sent or read back.
 * - **Which drafted rows a builder draws** is one rule ({@link DraftedStanding},
 *   asked by the Schematic, the Flowchart, and the shared cells reader of the
 *   Plan's and the Calendar's events):
 *   a row its read holds, as drafted; a row its draft adds, though no read
 *   holds it; and of any other — a row its record holds, as its session
 *   knows, that the read does not: one a narrowing hides — none, unless the
 *   builder's narrowing is asked of the row itself and holds it. It waits in
 *   its session, and Save sends it.
 * - **Through a carry-over a drafted row stands as it last stood.** A record
 *   that moves is read again by its builder, and the session reads each
 *   drafted row there by its key only after: until that read lands, what the
 *   session says of a row — that its record holds it — is of the record as it
 *   was (the shared editing's `carrying`). A row drafted here that another session removed is then
 *   in no read, and not yet one its draft adds: taken for one a narrowing
 *   hides, it left its builder for a round trip, and came back with its
 *   conflict. Each drafted row is remembered as its builder last drew it, and
 *   stands so until its session has judged it where the record is.
 *
 * Pure: the hook that reads the rows as a builder renders is
 * `use-drafted-rows.ts`.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, type EastTypeValue } from "@elaraai/east";
import type { EntryVersion } from "@elaraai/east-ui-components";
import type { ScheduleEntryRef } from "./editing.js";
import { kindKeys } from "./kind-keys.js";
import { draftedRow, rowCodec } from "./records.js";

const stringEqual = equalFor(StringType);

/** A drafted row, as its builder takes it: its roles, as its kind reads them, and whether its draft adds it. */
export interface DraftedRow<R> {
    /** Its roles. */
    readonly roles: R;
    /**
     * Whether its draft adds it: its session's original holds no row of its key — a row a gesture created and no Save has
     * landed, or one another session removed under the draft. No read holds a row of its key for a narrowing's sake.
     */
    readonly created: boolean;
    /**
     * The roles of the row its session began from — what its record holds of it, as the session knows it — as its kind
     * reads them. `undefined` for a row its draft adds.
     */
    readonly began?: R | undefined;
    /**
     * Whether its session is carrying its drafts over to a record that moved, and has yet to judge them there
     * (`EditSession.carrying`): what it says of the row — whether its record holds it — is of the record as it was.
     * `undefined` for a row whose session is not said — one a Save landed.
     */
    readonly carrying?: boolean | undefined;
}

/** One kind's drafted rows, by key: the drafted row, or `undefined` for one its draft deletes. */
export type DraftedRows<R> = ReadonlyMap<string, DraftedRow<R> | undefined>;

/** A kind whose drafted rows are read. */
export interface DraftedRowsKind<R = unknown> {
    /** What its session is named by in the editing: a kind's slot, a sort. */
    readonly key: string;
    /** Its rows' type. */
    readonly rowType: EastTypeValue;
    /** Its keys' type. */
    readonly keyType: EastTypeValue;
    /** A row's roles, read from its bytes and its key's text. */
    readonly read: (bytes: Uint8Array, key: string) => R;
}

/** A session, as its drafted rows are read from it: each entry's version, and the original beside it. */
export interface DraftedRowsSession {
    /** Each entry the session holds a version of. */
    readonly entries: ReadonlyMap<string, EntryVersion<ScheduleEntryRef>>;
    /** Each entry as the session's source holds it, as the session knows it. */
    readonly originals: ReadonlyMap<string, EntryVersion<ScheduleEntryRef>>;
    /** Whether the session is carrying its drafts over to a source that moved, and has yet to judge them there. */
    readonly carrying: boolean;
}

/** What each drafted row was read as, by the version its session holds of it: under which key, and beside which original. */
export type DraftedRowsCache = WeakMap<EntryVersion<ScheduleEntryRef>, {
    readonly id: string;
    readonly original: EntryVersion<ScheduleEntryRef> | undefined;
    readonly row: DraftedRow<unknown>;
}>;

/** Every kind's drafted rows, by what its session is named by: none of a kind with no draft. */
export type DraftedRowsByKind = ReadonlyMap<string, DraftedRows<unknown>>;

/** No kind's drafted rows. */
export const NO_DRAFTED_ROWS: DraftedRowsByKind = new Map<string, DraftedRows<unknown>>();

/** Whether two kinds' rows are the same: the same keys in the same order, each the same object. */
function sameRows(a: DraftedRows<unknown>, b: DraftedRows<unknown>): boolean {
    if (a.size !== b.size) return false;
    const others = b.entries();
    for (const [key, row] of a) {
        const other = others.next().value;
        if (other === undefined || !stringEqual(other[0], key) || !Object.is(other[1], row)) return false;
    }
    return true;
}

/** Nothing lets a row show that its builder's read holds none of. */
const NEVER = (): boolean => false;

/**
 * Which drafted rows a builder draws, and what it last drew of each (see the module docs): one for a builder, kept
 * while it is mounted.
 */
export class DraftedStanding {
    /** The drafted rows the builder last drew: by what each kind's session is named by, their keys. */
    private drawn: ReadonlyMap<string, ReadonlySet<string>> = new Map();

    /**
     * Whether a drafted row is drawn: a row its read holds; one its draft adds; one the builder's narrowing holds, asked
     * of the row itself; and, while its session has yet to judge it where its record is, one the builder last drew.
     *
     * @param kind - What the row's kind's session is named by
     * @param key - The row's key
     * @param row - The drafted row: whether its draft adds it, and whether its session has yet to judge it
     * @param held - Whether the builder's read holds a row of its key, and shows it
     * @param shown - Whether the builder's narrowing holds the row though its read holds none of it — a builder that
     *   reads a window of its record asks its narrowing of the row itself; never, unless given
     * @returns Whether it is drawn; a row not drawn waits in its session
     */
    stands(kind: string, key: string, row: Pick<DraftedRow<unknown>, "created" | "carrying">, held: boolean, shown: () => boolean = NEVER): boolean {
        return held || row.created || shown() || (row.carrying === true && this.stood(kind, key));
    }

    /**
     * Whether the builder last drew a drafted row: what a row its draft deletes meanwhile is remembered by, drawn
     * nowhere, so the deletion taken back finds it standing as it did.
     *
     * @param kind - What the row's kind's session is named by
     * @param key - The row's key
     * @returns Whether it did
     */
    stood(kind: string, key: string): boolean {
        return this.drawn.get(kind)?.has(key) === true;
    }

    /**
     * Remembers a drawing, once every drafted row of it has been asked: the drafted rows it drew, which stand through a
     * carry-over, in place of the last drawing's.
     *
     * @param drawn - Each kind's drafted rows drawn, by key; a kind not named drew none
     */
    drew(drawn: ReadonlyMap<string, ReadonlySet<string>>): void {
        this.drawn = drawn;
    }

    /**
     * Remembers one kind's part of a drawing, the other kinds' as they were: what a reader that draws its kinds one at
     * a time tells, once every drafted row of the kind has been asked.
     *
     * @param kind - What the kind's session is named by
     * @param keys - The kind's drafted rows drawn, by key
     */
    drewKind(kind: string, keys: ReadonlySet<string>): void {
        if (keys.size === 0 && !this.drawn.has(kind)) return;
        const drawn = new Map(this.drawn);
        if (keys.size === 0) drawn.delete(kind);
        else drawn.set(kind, keys);
        this.drawn = drawn;
    }
}

/**
 * One kind's drafted rows (see the module docs): each read once for the version its session holds of it and the
 * original beside it.
 *
 * @param kind - The kind
 * @param ids - The keys its drafts hold, in the order the rows are listed
 * @param session - Its session; `undefined` for a kind with none, whose every row reads as deleted
 * @param cache - What each drafted row was read as, kept across calls
 * @param held - The rows as last read: handed back, the same map, where no row moved
 * @returns The rows, by key: `undefined` for one its draft deletes
 */
export function draftedRowsOf<R>(kind: DraftedRowsKind<R>, ids: Iterable<string>, session: DraftedRowsSession | undefined, cache: DraftedRowsCache,
    held?: DraftedRows<R>): DraftedRows<R> {
    const codec = rowCodec(kind.rowType);
    // A row under a placeholder is read as keyed by its key type's default, its key still to be typed (#1549).
    const keys = kindKeys(kind.keyType);
    const rows = new Map<string, DraftedRow<R> | undefined>();
    const carrying = session?.carrying === true;
    for (const id of ids) {
        const entry = session?.entries.get(id);
        const row = draftedRow(entry);
        if (entry === undefined || row === undefined) { rows.set(id, undefined); continue; }
        const original = session?.originals.get(id);
        const was = cache.get(entry);
        if (was !== undefined && Object.is(was.original, original) && stringEqual(was.id, id)) {
            // As it was read, and said to be carried over or not: its roles the same object either way.
            const now = (was.row.carrying === true) === carrying ? was.row : { ...was.row, carrying };
            if (!Object.is(now, was.row)) cache.set(entry, { id, original, row: now });
            rows.set(id, now as DraftedRow<R>);
            continue;
        }
        // A row its session's original holds none of is one the draft adds; any other began as the row its record holds.
        const began = draftedRow(original)?.row;
        const drafted: DraftedRow<R> = {
            roles: kind.read(codec.encode(row.row), keys.readKey(id)), created: began === undefined,
            began: began === undefined ? undefined : kind.read(codec.encode(began), keys.readKey(id)), carrying,
        };
        cache.set(entry, { id, original, row: drafted });
        rows.set(id, drafted);
    }
    return held !== undefined && sameRows(held, rows) ? held : rows;
}

/**
 * A kind's drafted rows, of every kind's: read as the kind's `read` gives them.
 *
 * @param rows - Every kind's drafted rows ({@link useDraftedRows})
 * @param kind - The kind
 * @returns Its rows; `undefined` for a kind with no draft
 */
export function draftedOf<R>(rows: DraftedRowsByKind, kind: Pick<DraftedRowsKind<R>, "key" | "read">): DraftedRows<R> | undefined {
    return rows.get(kind.key) as DraftedRows<R> | undefined;
}
