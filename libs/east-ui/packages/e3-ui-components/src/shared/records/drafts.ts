/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's drafts in what e3 keeps (#1437): for each row a builder's
 * editing session holds a draft of, that row's Save previewed in the page.
 *
 * - **The row as e3 holds it.** At the revision the session's drafts began
 *   from, it is the session's own original. At any later revision it is read
 *   by key at that revision, every drafted row in one request
 *   (`rowsAll`).
 * - **The row as the Save would leave it.** The draft's change is the patch
 *   the Save sends, the original against the draft. Applied to the row as e3
 *   holds it, it is what e3 holds once the Save commits. A change that does
 *   not apply — another session changed the same value — is `stale`: nothing
 *   is previewed, and the session's banner says the source changed.
 * - **What it changes.** The maintenance of each index the binding carries it
 *   for (each nested series and summary index it lists), run on the two rows
 *   and the row's patch: the function e3's commit runs (`indexMaintenance`),
 *   so what comes out is what e3 will change in each index if the Save
 *   commits now.
 *
 * A reader of the record's entries puts each previewed row's changes into
 * what it holds: an entry's `insert` or `update` replaces it, its `delete`
 * drops it, a summary's `add` moves its total. The part changes no read
 * itself, so which rows show, in what order, and a rail's counts keep to what
 * is saved. It runs only on the rows the session holds drafts of — never over
 * the record (never evaluate index functions over every record in the
 * browser) — and runs a row again only when its draft moves, a row lands, or
 * the revision moves. Nothing of it is stored: once a Save commits and reads
 * back, the session's drafts retire, and what e3 keeps is what was previewed.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ConflictError, OptionType, StringType, applyFor, diffFor, equalFor, none, some, type EastType, type option } from "@elaraai/east";
import { useTrackedEvaluation, type DraftedEntry, type EditSession, type SessionDrafts } from "@elaraai/east-ui-components";
import { recordSliceBatchesOf, type IndexMaintenance, type IndexMaintenances } from "../../platform/indexed-paged.js";

/**
 * What a drafted row's Save would change in one index, by entry: each an op
 * of the index's own East patch (`insert`, `update`, `delete`) or a summary
 * index's `add`, as e3's maintenance gives them, in the index's entry order.
 */
export type IndexChanges = ReadonlyMap<unknown, unknown>;

/**
 * One drafted row's Save, previewed: what it changes in each index.
 *
 * @property key - The row's key
 * @property state - `previewed`: the changes are e3's for this Save. `reading`: the row is being read at the revision
 *   the builder reads. `stale`: the draft's change does not apply to the row as e3 now holds it — another session
 *   changed the same value — so nothing is previewed.
 * @property changes - By index, what the Save would change; empty unless `previewed`
 */
export interface PreviewedRow {
    readonly key: unknown;
    readonly state: "previewed" | "reading" | "stale";
    readonly changes: ReadonlyMap<string, IndexChanges>;
}

/**
 * What the part reads of a record's indexed binding (`Data.bindPaged(record,
 * { indexes })`, as a page holds it): the maintenance it carries, its
 * revision, and — through the runtime that built it — its rows by key.
 */
export interface RecordDraftsBinding {
    /** Each listed nested series and summary index's maintenance for one row, by its name; none where it lists neither. */
    readonly maintenance: IndexMaintenances;
    /** The record's revision the binding reads; none while it resolves. */
    revision(): option<string>;
}

/**
 * The session the part reads: the record's, its entries the record's rows
 * whole, keyed by the record's key. A builder that pages a record's rows
 * without their collections — beside a nested series index — reads a row
 * whole as its first change is drafted, so the session's original is the row
 * as e3 holds it.
 */
export type RecordDraftsSession = Pick<EditSession<unknown>, "drafts" | "entryType" | "keyType">;

/**
 * What a spec watches the part by: each run of a row's maintenance. Test use
 * only.
 */
export interface RecordDraftsProbe {
    /** Called for each drafted row whose maintenance runs, with its key. */
    readonly ran?: (key: unknown) => void;
}

/** The probe a spec installed; `undefined` outside tests. */
let recordDraftsProbe: RecordDraftsProbe | undefined;

/**
 * Install (or clear) the probe the part's runs are watched by. Test use only.
 *
 * @param probe - What watches it; `undefined` clears it
 */
export function setRecordDraftsProbe(probe: RecordDraftsProbe | undefined): void {
    recordDraftsProbe = probe;
}

/** No index changes: a row not previewed. */
const NOTHING: ReadonlyMap<string, IndexChanges> = new Map();
/** No drafted rows. */
const NO_ROWS: ReadonlyMap<string, PreviewedRow> = new Map();
const stringEqual = equalFor(StringType);

/** A row's last preview: the revision and the row as e3 held it that it was previewed over. */
interface Previewed {
    readonly revision: string;
    readonly held: option<unknown>;
    readonly row: PreviewedRow;
}

/** Whether two answers hold the same rows: each id's preview the same object. */
function sameRows(a: ReadonlyMap<string, PreviewedRow>, b: ReadonlyMap<string, PreviewedRow>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, row] of b) if (a.get(id) !== row) return false;
    return true;
}

/**
 * A record's drafts in what e3 keeps (see the module docs): each drafted
 * row's Save previewed through a binding's maintenance. Its reads are tracked
 * where it runs — {@link useRecordDrafts} runs it in a tracked evaluation — so
 * a row read at a later revision previews once it lands.
 */
export class RecordDrafts {
    /** Each drafted row's last preview, by the session's view of it. */
    private previews = new WeakMap<DraftedEntry<unknown>, Previewed>();
    /** Each drafted row while it is read, by the session's view of it. */
    private reads = new WeakMap<DraftedEntry<unknown>, PreviewedRow>();
    /** The last answer: the same object while each row's preview is. */
    private last: ReadonlyMap<string, PreviewedRow> = NO_ROWS;
    /** A row's change applied to it, as the Save's patch is: the row, or a `ConflictError` thrown where it does not apply. */
    private readonly apply: (held: option<unknown>, patch: unknown) => option<unknown>;
    /** A row's change, as the Save sends it: its patch, as an entry present or absent. */
    private readonly change: (before: option<unknown>, after: option<unknown>) => unknown;
    /** A row's patch, where it is present before and after: what the maintenance follows. */
    private readonly rowPatch: (before: unknown, after: unknown) => unknown;

    /**
     * @param binding - The record's indexed binding
     * @param session - The record's editing session
     * @throws {Error} When the session is no keyed source's
     */
    constructor(private readonly binding: RecordDraftsBinding, private readonly session: RecordDraftsSession) {
        if (session.keyType === undefined) throw new Error("A record's drafts are a keyed source's: its session names no key");
        const row: EastType = session.entryType;
        this.apply = applyFor(OptionType(row)) as (held: option<unknown>, patch: unknown) => option<unknown>;
        this.change = diffFor(OptionType(row)) as (before: option<unknown>, after: option<unknown>) => unknown;
        this.rowPatch = diffFor(row) as (before: unknown, after: unknown) => unknown;
    }

    /**
     * Each drafted row's Save, previewed, by its id: the same object while the
     * session's drafts, the binding's revision and the rows read at it stand.
     *
     * @returns The previewed rows; none where the binding carries no maintenance
     * @throws {Error} When a drafted row is to be read at a later revision and the binding's runtime reads no rows by key
     */
    preview(): ReadonlyMap<string, PreviewedRow> {
        const maintenance = this.binding.maintenance;
        const drafts = this.session.drafts;
        if (maintenance.type === "none") return NO_ROWS;
        return this.kept(this.answer(drafts, maintenance.value));
    }

    /** Each drafted row's preview, by its id, as {@link RecordDrafts.preview} gives it. */
    private answer(drafts: SessionDrafts<unknown>, maintain: Readonly<Record<string, IndexMaintenance>>): Map<string, PreviewedRow> {
        const answer = new Map<string, PreviewedRow>();
        if (drafts.entries.size === 0) return answer;
        const revision = this.binding.revision();
        if (revision.type === "none") return this.reading(drafts);
        // At the revision the drafts began from, each row is the session's own original; at a later one, read by key.
        let rows: readonly option<unknown>[] | undefined;
        if (drafts.revision === undefined || !stringEqual(drafts.revision, revision.value)) {
            const batches = recordSliceBatchesOf(this.binding);
            if (batches === undefined) {
                throw new Error("A record's drafts read each drafted row at the record's revision, and this binding's runtime reads no rows by key");
            }
            const read = batches.rowsAll([...drafts.entries.values()].map((entry) => entry.key));
            if (read.type === "none") return this.reading(drafts);
            rows = read.value;
        }
        [...drafts.entries].forEach(([id, entry], i) => {
            answer.set(id, this.previewed(entry, revision.value, rows === undefined ? entry.before : rows[i]!, maintain));
        });
        return answer;
    }

    /** The answer, as the last one where it holds the same rows: the same object while each row's preview is. */
    private kept(answer: ReadonlyMap<string, PreviewedRow>): ReadonlyMap<string, PreviewedRow> {
        if (sameRows(this.last, answer)) return this.last;
        this.last = answer;
        return answer;
    }

    /** Every drafted row reading: the revision, or the rows at it, still in flight. */
    private reading(drafts: SessionDrafts<unknown>): Map<string, PreviewedRow> {
        return new Map([...drafts.entries].map(([id, entry]) => {
            let row = this.reads.get(entry);
            if (row === undefined) {
                row = { key: entry.key, state: "reading", changes: NOTHING };
                this.reads.set(entry, row);
            }
            return [id, row] as const;
        }));
    }

    /**
     * One drafted row's Save, previewed over the row as e3 holds it: kept
     * while its draft, the revision and the row stand.
     *
     * @param entry - The session's view of the drafted row
     * @param revision - The revision e3's row is held at
     * @param held - The row as e3 holds it there
     * @param maintain - Each index's maintenance, by its name
     * @returns The previewed row
     */
    private previewed(entry: DraftedEntry<unknown>, revision: string, held: option<unknown>, maintain: Readonly<Record<string, IndexMaintenance>>): PreviewedRow {
        const kept = this.previews.get(entry);
        // The same row read, or the session's own original: what it was previewed over.
        if (kept !== undefined && stringEqual(kept.revision, revision) && Object.is(kept.held, held)) return kept.row;
        let next: option<unknown>;
        try {
            next = this.apply(held, this.change(entry.before, entry.after));
        } catch (error) {
            if (!(error instanceof ConflictError)) throw error;
            const row: PreviewedRow = { key: entry.key, state: "stale", changes: NOTHING };
            this.previews.set(entry, { revision, held, row });
            return row;
        }
        // The row's patch, where it is updated: what a nested series index follows to the entries it touched (#1434).
        const patch = entry.before.type === "some" && entry.after.type === "some" && held.type === "some" && next.type === "some"
            ? some(this.rowPatch(entry.before.value, entry.after.value)) : none;
        recordDraftsProbe?.ran?.(entry.key);
        const changes = new Map<string, IndexChanges>();
        for (const [index, fn] of Object.entries(maintain)) changes.set(index, fn(entry.key, held, next, patch));
        const row: PreviewedRow = { key: entry.key, state: "previewed", changes };
        this.previews.set(entry, { revision, held, row });
        return row;
    }
}

/** No session's changes to follow. */
const unsubscribed = () => () => {};
const unversioned = () => 0;

/**
 * A record's drafts in what e3 keeps (see the module docs), tracked: it reads
 * again as a draft moves, a row lands or the revision moves.
 *
 * @param binding - The record's indexed binding, as the page holds it: its maintenance and its revision, its rows read
 *   by key through the runtime that built it
 * @param session - The record's editing session: each drafted row, as it began and as drafted
 * @returns Each drafted row's preview, by its id; none without a binding or a session
 * @throws {Error} As {@link RecordDrafts} does, through the evaluation's error
 */
export function useRecordDrafts(binding: RecordDraftsBinding | undefined, session: (RecordDraftsSession & Pick<EditSession<unknown>, "subscribe" | "getSnapshot">) | undefined): ReadonlyMap<string, PreviewedRow> {
    const version = useSyncExternalStore(session?.subscribe ?? unsubscribed, session?.getSnapshot ?? unversioned);
    const drafts = useMemo(() => (binding === undefined || session === undefined ? undefined : new RecordDrafts(binding, session)), [binding, session]);
    // The session's version keys the evaluation: a gesture, an Undo or a Save runs it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the drafts are the session's, read inside: its version says when they moved
    const evaluate = useCallback(() => drafts?.preview() ?? NO_ROWS, [drafts, version]);
    const { result } = useTrackedEvaluation(evaluate);
    if (!result.ok) throw result.error;
    return result.value;
}
