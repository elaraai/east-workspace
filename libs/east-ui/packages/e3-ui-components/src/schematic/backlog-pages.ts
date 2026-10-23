/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Backlog of the item kinds read by area (#1393, `Schematic Builder
 * Spec.md` §8, D51): every item kind's rows with no position as one paged
 * list, which the library's Backlog tab draws with the shared `PagedLibrary`.
 *
 * - **The rows in hand come first**: those of the kinds read whole or complete,
 *   and the drafted rows with no position — a row a gesture unplaced, or one it
 *   created (`backlog.ts`).
 * - **Then each kind read by area's**, a page at a time through its source's
 *   area index's unplaced clause (`schematicUnplacedPlan`, §11.4): the
 *   narrowing's choices that index leads taken in the read, the rest asked of
 *   each page's rows in one `within` (D28). A row they leave out draws as
 *   context — faded, and never dragged — as does a stored row a draft has
 *   placed or deleted, drawn as drafted; a row a draft only edits draws as
 *   drafted, in place.
 * - **Its count** ({@link SchematicBacklogPages.count}): the rows it lists, and
 *   — while a narrowing an area index leads narrows them — `N of M`, every row
 *   with no position the kinds hold.
 * - **What a card drops** ({@link SchematicBacklogPages.card}): each row it has
 *   listed and not as context, placed where it lands — its row, as its page
 *   read it at its revision, the original a gesture rewrites
 *   ({@link SchematicBacklogPages.rowOf}), so a drop records at once.
 *
 * Nothing it reads is the record whole: the counts are two index counts a kind,
 * and each page one read of the index's entries, which carry their rows (D29).
 *
 * @packageDocumentation
 */

import {
    ArrayType, SortedMap, StringType, StructType, compareFor, encodeBeast2For, equalFor, fromEastTypeValue, none, printFor, some, variant,
    type StructType as StructTypeOf, type ValueTypeOf, type option,
} from "@elaraai/east";
import { AREA_FIELD, AREA_UNPLACED, RecordSliceWhereType, type RecordSliceBindType, type RecordSliceEntry } from "@elaraai/east-ui/internal";
import { schematicUnplacedPlan, type SchematicAreaIndexes, type SchematicUnplacedPlan } from "@elaraai/e3-ui/internal";
import { recordSlicePage, recordSliceRevision, recordSliceWithin, type LibraryPageSource } from "@elaraai/east-ui-components/internal";
import type { BacklogEntry } from "./backlog.js";
import { entityId, type ItemRoles } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";
import type { SortDrafts } from "./drafted.js";
import type { SchematicDropCard } from "./drop.js";

/** A kind's source of the slice. */
type Part = ValueTypeOf<RecordSliceBindType>;
/** A record Slice's narrowing, decoded. */
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
/** An item kind, decoded. */
type ItemKind = SchematicValue["items"][number];

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const printWhere = printFor(RecordSliceWhereType);

/** The rows with no position, whatever the narrowing: what `M` counts. */
const UNPLACED: Where = new SortedMap([[AREA_FIELD, variant("values", [AREA_UNPLACED])]], compareString);

/** The most cards the list keeps for what a drop finds them by, past which the oldest go: the pages around the view hold far fewer. */
const MAX_SERVED = 4_096;

/** The most rows' roles a kind keeps at a revision, past which they are made again as their pages are read again. */
const MAX_DECODED = 8_192;

/** An item kind read by area that has a backlog: the kind, its source of the slice and its area indexes. */
export interface BacklogAreaKind {
    /** The kind: its `x` and `y` are Options. */
    readonly kind: ItemKind;
    /** Its source of the slice. */
    readonly part: Part;
    /** Its area indexes. */
    readonly areas: SchematicAreaIndexes;
}

/** One row the paged Backlog lists: its entry, and whether it draws as context. */
export interface BacklogPageRow {
    /** Its kind's slot and key, its id and its roles — a drafted row's as drafted. */
    readonly entry: BacklogEntry;
    /** Whether it draws as context, faded and never dragged: the narrowing leaves it out, or a draft placed or deleted it. */
    readonly context: boolean;
}

/** What the paged Backlog counts: the rows it lists, every row with no position, and whether a narrowing narrows the list. */
export interface BacklogPageCount {
    /** The rows it lists. */
    readonly shown: number;
    /** Every row with no position the kinds hold, the rows in hand among them. */
    readonly total: number;
    /** Whether a narrowing an area index leads narrows what it lists. */
    readonly narrowing: boolean;
}

/** Each kind's encoder of the rows a page holds, as its `rowsOf` takes them: an Array of `{ key, row }`. */
type RowsEncoder = (rows: { key: string; row: unknown }[]) => Uint8Array;

/** An entry's row: its joined row, or the whole row its index carries (D29). */
function rowOf(entry: RecordSliceEntry): unknown {
    if (entry.row?.type === "some") return entry.row.value;
    if (entry.value?.type === "some") return entry.value.value;
    return undefined;
}

/**
 * The paged Backlog's rows and counts — see the module docs. Every read is a
 * tracked read of the kinds' sources, so the list's reader runs again as a
 * page, a count or an answer lands, and as a narrowing or a revision moves.
 */
export class SchematicBacklogPages implements LibraryPageSource<BacklogPageRow> {
    /** Each kind's plan, for the narrowing it was made for. */
    private readonly plans = new WeakMap<object, SchematicUnplacedPlan>();
    /** Each kind's rows its pages held — each one's roles and its bytes — by key, at the revision they were read at. */
    private readonly decoded = new Map<string, { readonly revision: string; readonly rows: Map<string, { readonly roles: ItemRoles; readonly row: Uint8Array }> }>();
    /** Each kind's encoder, made once. */
    private readonly encoders = new WeakMap<object, RowsEncoder>();
    /** What each row listed and not as context drops, by its id: kept for the narrowing it was listed under. */
    private served = new Map<string, SchematicDropCard>();
    private servedFor = "";

    /**
     * @param id - The list's id: the Backlog's library, which its cards drag from
     * @param fresh - The rows in hand: the kinds read whole or complete, and the drafted rows with no position, each kind's in its order
     * @param kinds - The item kinds read by area that have a backlog, in the Schematic's order
     * @param drafts - The item kinds' drafts
     */
    constructor(readonly id: string, private readonly fresh: readonly BacklogEntry[], private readonly kinds: readonly BacklogAreaKind[],
        private readonly drafts: SortDrafts<ItemRoles>) {}

    /** A kind's plan for its narrowing as it stands, made once a narrowing. */
    private planOf({ part, areas }: BacklogAreaKind): SchematicUnplacedPlan {
        const where = part.read().where;
        let plan = this.plans.get(where);
        if (plan === undefined) {
            plan = schematicUnplacedPlan(areas, where);
            this.plans.set(where, plan);
        }
        return plan;
    }

    /**
     * The kinds' revisions, as one: `none` while any is not yet known.
     *
     * @returns The revisions
     */
    revision(): option<string> {
        const revisions: string[] = [];
        for (const { part } of this.kinds) {
            const revision = recordSliceRevision(part);
            if (revision.type !== "some") return none;
            revisions.push(revision.value);
        }
        return some(revisions.join("\u0000"));
    }

    /**
     * The narrowings the kinds' rows are read under, as one: the list starts its viewport again as it moves.
     *
     * @returns The narrowings, printed
     */
    query(): string {
        return this.kinds.map(({ part }) => printWhere(part.read().where)).join("\u0001");
    }

    /** Each kind's count of the rows it lists; `undefined` while any is read. */
    private listed(): bigint[] | undefined {
        const counts: bigint[] = [];
        for (const kind of this.kinds) {
            const count = kind.part.countWhere(this.planOf(kind).where);
            if (count.type !== "some") return undefined;
            counts.push(count.value);
        }
        return counts;
    }

    /**
     * How many rows it lists: the rows in hand, and each kind's its narrowing's led choices hold.
     *
     * @returns The count; `none` while any is read
     */
    total(): option<bigint> {
        const counts = this.listed();
        if (counts === undefined) return none;
        return some(counts.reduce((sum, count) => sum + count, BigInt(this.fresh.length)));
    }

    /**
     * What the Backlog tab counts (see {@link BacklogPageCount}).
     *
     * @returns The count; `undefined` while any count is read
     */
    count(): BacklogPageCount | undefined {
        const counts = this.listed();
        if (counts === undefined) return undefined;
        let shown = this.fresh.length, total = this.fresh.length, narrowing = false;
        for (const [i, kind] of this.kinds.entries()) {
            shown += Number(counts[i]!);
            const plan = this.planOf(kind);
            // Only the choices the index leads narrow the list: the rest draw what they leave out as context.
            if (plan.where.size > 1) {
                narrowing = true;
                const all = kind.part.countWhere(UNPLACED);
                if (all.type !== "some") return undefined;
                total += Number(all.value);
            } else {
                total += Number(counts[i]!);
            }
        }
        return { shown, total, narrowing };
    }

    /**
     * The rows `[offset, offset + limit)` of the list: the rows in hand, then each kind's, a page read through its
     * area index's unplaced clause, its narrowing's other choices asked of the page's rows.
     *
     * @param offset - The first row
     * @param limit - How many rows
     * @returns The rows; `none` while a count, a page or an answer is read
     */
    page(offset: bigint, limit: bigint): option<BacklogPageRow[]> {
        const counts = this.listed();
        if (counts === undefined) return none;
        const listing = this.query();
        if (!stringEqual(listing, this.servedFor)) {
            this.served = new Map();
            this.servedFor = listing;
        }
        const rows: BacklogPageRow[] = [];
        let at = offset;
        let left = limit;
        const fresh = BigInt(this.fresh.length);
        if (at < fresh) {
            const end = at + left < fresh ? at + left : fresh;
            for (const entry of this.fresh.slice(Number(at), Number(end))) rows.push({ entry, context: false });
            left -= end - at;
            at = end;
        }
        let base = fresh;
        for (const [i, kind] of this.kinds.entries()) {
            if (left <= 0n) break;
            const count = counts[i]!;
            if (at < base + count) {
                const from = at - base;
                const take = from + left < count ? left : count - from;
                const got = this.kindPage(kind, from, take);
                if (got.type !== "some") return none;
                rows.push(...got.value);
                at += take;
                left -= take;
            }
            base += count;
        }
        for (const row of rows) {
            if (row.context) continue;
            this.served.set(row.entry.id, { does: "place", ref: row.entry.ref, label: row.entry.roles.label });
            if (this.served.size > MAX_SERVED) this.served.delete(this.served.keys().next().value!);
        }
        return some(rows);
    }

    /** One kind's rows `[offset, offset + limit)`: a page of its unplaced clause, its drafts in place and its narrowing's other choices asked. */
    private kindPage(kind: BacklogAreaKind, offset: bigint, limit: bigint): option<BacklogPageRow[]> {
        const plan = this.planOf(kind);
        const got = recordSlicePage(kind.part, plan.where, offset, limit);
        if (got.type !== "some") return none;
        const entries = got.value as RecordSliceEntry[];
        const read = entries.map((entry) => ({ key: entry.key as string, row: rowOf(entry) }));
        // The narrowing's choices the index doesn't lead, asked of the page's rows in one request (D28).
        let held: readonly boolean[] | undefined;
        if (plan.residual.length > 0) {
            const answer = recordSliceWithin(kind.part, kind.part.read().where, read);
            if (answer.type !== "some") return none;
            held = answer.value;
        }
        const stored = this.rowsOf(kind, read);
        if (stored === undefined) return none;
        const drafted = this.drafts.get(kind.kind.key);
        return some(read.map(({ key }, i) => {
            const ref = { kind: kind.kind.key, key };
            const id = entityId(ref);
            const outside = held !== undefined && held[i] !== true;
            const roles = stored.get(key)!.roles;
            if (drafted === undefined || !drafted.has(key)) return { entry: { ref, id, roles }, context: outside };
            // A draft decides: deleted, or placed, it draws as context; edited, as drafted, in place.
            const draft = drafted.get(key);
            if (draft === undefined) return { entry: { ref, id, roles }, context: true };
            return { entry: { ref, id, roles: draft.roles }, context: outside || draft.roles.position.type === "some" };
        }));
    }

    /** Some rows of a kind as its `rowsOf` makes them — each one's roles beside its bytes — those not yet made at its revision made in one call. */
    private rowsOf(kind: BacklogAreaKind, rows: readonly { key: string; row: unknown }[]): ReadonlyMap<string, { readonly roles: ItemRoles; readonly row: Uint8Array }> | undefined {
        const revision = recordSliceRevision(kind.part);
        if (revision.type !== "some") return undefined;
        let kept = this.decoded.get(kind.kind.key);
        if (kept === undefined || !stringEqual(kept.revision, revision.value) || kept.rows.size > MAX_DECODED) {
            kept = { revision: revision.value, rows: new Map() };
            this.decoded.set(kind.kind.key, kept);
        }
        const missing = rows.filter(({ key }) => !kept!.rows.has(key));
        if (missing.length > 0) {
            const made = (kind.kind.rowsOf as (bytes: Uint8Array) => ReadonlyMap<string, { readonly roles: ItemRoles; readonly row: Uint8Array }>)(
                this.encoderOf(kind.kind)([...missing]));
            for (const [key, row] of made) kept.rows.set(key, row);
        }
        return kept.rows;
    }

    /**
     * A row of a kind its pages have read, as the record held it at the revision they read it at: what a gesture on a
     * row it lists — a drop placing it — rewrites, so it records at once, never waiting on a read by key.
     *
     * @param slot - The kind's slot
     * @param key - The row's key
     * @returns Its bytes and the revision they were read at; `undefined` for a row no page has read
     */
    rowOf(slot: string, key: string): { readonly revision: string; readonly row: Uint8Array } | undefined {
        const kept = this.decoded.get(slot);
        const row = kept?.rows.get(key);
        return kept === undefined || row === undefined ? undefined : { revision: kept.revision, row: row.row };
    }

    /** A kind's encoder of the rows it reads, made once per kind. */
    private encoderOf(kind: ItemKind): RowsEncoder {
        let encode = this.encoders.get(kind);
        if (encode === undefined) {
            const row = fromEastTypeValue(kind.rowType) as StructTypeOf;
            encode = encodeBeast2For(ArrayType(StructType({ key: StringType, row }))) as RowsEncoder;
            this.encoders.set(kind, encode);
        }
        return encode;
    }

    /**
     * What a card of the list drops, by its id: a row it has listed, and not as context — placed where it lands.
     *
     * @param id - The card's id
     * @returns What it drops, or `undefined` for a row it lists in hand, as context, or not at all
     */
    card(id: string): SchematicDropCard | undefined {
        return this.served.get(id);
    }
}
