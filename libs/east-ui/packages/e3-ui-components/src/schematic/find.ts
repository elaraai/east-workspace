/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Find (#1387, #1404, §6.1): the toolbar's search over the item kinds' keys,
 * each kind sought in its own record, never in what the canvas draws — the
 * shared key search's item (`useKeySearchToolbarItem`), its box folding to its
 * icon, then into the View popover on a phone. ⌘F focuses it
 * (`focusKeySearch`).
 *
 * - **A kind read through its source of the slice** is sought in its record's
 *   own order, through e3: `recordSliceSeek` with no narrowing places the
 *   query's run, `recordSlicePage` reads the rows a list shows by position,
 *   each made its roles by the kind's `read`, and `recordSliceWithin` asks, in
 *   one request, which of them the rail's narrowing holds.
 * - **A kind read whole** is sought in its rows — every row of its record —
 *   its keys in East's order, as the server finds a key (`findKeyInline`).
 *
 * The query is the shared key search's: a key's start, a quoted key or a
 * range, keys case-sensitive, as the Sheet's Search Records takes it. The
 * matches are one list: each kind's in its keys' order, the kinds in the order
 * the Schematic lists them, each kind's run after the one before. A line names
 * an item by its key, its label where it is not its key, and its kind's name,
 * and says what keeps it off the canvas: its layer, or no position — and,
 * where its kind's source's narrowing leaves it out, which of the rail's
 * choices do, as every builder's Search Records names them (the shared hidden
 * pick, `shared/schedule/hidden.ts`): `hidden by Owner: Northwind Media —
 * picking it clears that filter`, asked of e3 for the rows a list shows that
 * the narrowing leaves out, by the page the list read them from, and `hidden
 * by the filters` until it has said — or, where the narrowing draws what it
 * leaves out as context (`narrowed="dim"`), `dimmed by Owner: Northwind Media
 * — …` and `dimmed by the filters`. A pick hands the frame the item and what
 * it knows of it — what hides it among it (`onPick`) — and the box shows its
 * key; the pick stands until the search is cleared or a new query asked in its
 * place, which the frame hears (`onCleared`), so what it said of where the
 * pick landed goes with it. The box asks its query again when what its lines
 * are read from moves — a source's record or its narrowing, a kind read
 * whole's rows, the layers hidden — and never when a window of what the
 * canvas draws lands, so a pick's fly keeps its place among the matches: a
 * query asked again leaves the pick standing. It lists its lines again as e3
 * says which choices hide a row, and as the narrowing comes to dim what it
 * leaves out or to hide it (`relist`).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, compareFor, equalFor, match, none, printFor, toEastTypeValue, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import { RecordSliceWhereType, findKeyInline, type DatasetKeyMatchRange, type DatasetKeyQuery, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, recordSlicePage, recordSliceRevision, recordSliceSeek, recordSliceWithin, toSeekQuery } from "@elaraai/east-ui-components/internal";
import { entityId, type ItemRoles, type SchematicRef } from "./canvas/drawn.js";
import { hiddenLine, hiddenOf, useRelist, type RowHidden, type SourceHidden } from "../shared/schedule/hidden.js";
import type { HiddenPicks } from "../shared/schedule/hidden-pick.js";
import type { RowCodec } from "../shared/schedule/records.js";
import type { HiddenWords } from "../shared/schedule/words.js";
import type { SchematicMessages, SchematicWords } from "./messages.js";

/** An item's key is a String: the search's text parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);

const compareKey = compareFor(StringType);
const keyEqual = equalFor(StringType);
const printWhere = printFor(RecordSliceWhereType);

/** Each kind read whole's rows as read, numbered: what tells Find they were read again. */
const rowsIds = new WeakMap<object, number>();
let nextRowsId = 0;

/** A kind read whole's rows, as a token that moves when they are read again; `-` while they are read. */
function rowsToken(rows: option<ReadonlyMap<string, unknown>>): string {
    const held = match(rows, { some: (value) => value }, undefined);
    if (held === undefined) return "-";
    let id = rowsIds.get(held);
    if (id === undefined) {
        id = nextRowsId++;
        rowsIds.set(held, id);
    }
    return `rows:${id}`;
}

/** No narrowing: a record's own rows, in its order. */
const WHOLE: ValueTypeOf<typeof RecordSliceWhereType> = new Map();

/** An empty box lists the first of the matches every item kind's record holds. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };

/** An Option's value, or `undefined`. */
const someOf = <T,>(opt: option<T>): T | undefined => match(opt, { some: (value) => value }, undefined);

/** A record Slice's part, as a kind's source of the slice. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;

/** An entry of a record's window, as every record Slice binding reads one: its key — a kind's are Strings — and its row, joined. */
interface RecordEntry {
    readonly key: string;
    readonly row: option<unknown>;
}

/** One item kind, as Find seeks it. */
export interface FindKind {
    /** Its slot. */
    readonly slot: string;
    /** Its name (`Rack`). */
    readonly name: string;
    /** Its source of the slice, whose record it is sought in, through e3; `undefined` for a kind read whole. */
    readonly part: RecordPart | undefined;
    /** Its rows, read whole — every row of its record, by key, each its roles; none while the read is in flight. */
    readonly rows: () => option<ReadonlyMap<string, { readonly roles: ItemRoles }>>;
    /** A stored row's roles, from its bytes and its key. */
    readonly read: (bytes: Uint8Array, key: string) => ItemRoles;
    /** Its record's rows, as bytes and back. */
    readonly codec: RowCodec;
}

/** One item Find found. */
export interface FoundItem {
    /** Its id on the canvas: its reference, printed. */
    readonly id: string;
    /** Its kind's slot and its key. */
    readonly ref: SchematicRef;
    /** Its card's name. */
    readonly label: string;
    /** Its kind's name. */
    readonly kind: string;
    /** Its centre; `undefined` for a row with no position. */
    readonly position: { readonly x: number; readonly y: number } | undefined;
    /** The layer it is on, by the layer's key. */
    readonly layer: string | undefined;
    /**
     * What leaves it out on the rail — its kind's source, and which of its choices e3 has said hide it (the shared hidden
     * pick) — which a pick of it clears; `undefined` while the narrowing holds it.
     */
    readonly hidden: readonly RowHidden[] | undefined;
}

/** What keeps a found item off the canvas but the rail's filters, as its line marks it — or `undefined` while nothing does. */
export type FoundMark = "layer" | "unplaced" | undefined;

/**
 * What keeps a found item off the canvas but the rail's filters, which its line names apart and a pick of it clears: no
 * position first, then a hidden layer.
 *
 * @param item - The item found
 * @param hiddenLayers - The layers hidden, by key
 * @returns Its mark
 */
export function foundMark(item: FoundItem, hiddenLayers: ReadonlySet<string>): FoundMark {
    if (item.position === undefined) return "unplaced";
    return item.layer !== undefined && hiddenLayers.has(item.layer) ? "layer" : undefined;
}

/**
 * The words a line names the choices that leave an item out in, where the narrowing draws what it leaves out as context
 * (`narrowed="dim"`): they dim it, never hide it.
 *
 * @param m - The Schematic's message table
 * @returns Its dimmed words, as the shared hidden pick's line takes them
 */
function dimmedWords(m: SchematicMessages): HiddenWords {
    return { hiddenByFilters: m.dimmedByFilters, hiddenBy: m.dimmedBy };
}

/**
 * How a found item reads in Find's list: its key, its label when it is not its key, its kind's name, what keeps it off
 * the canvas — its layer, or no position — and, last, which of the rail's choices leave it out, as every builder's line
 * names them (`hiddenLine`): `hidden by the filters` until e3 has said which — or, where the narrowing draws what it
 * leaves out as context, `dimmed by the filters`, then the choices that dim it.
 *
 * @param item - The item
 * @param mark - What keeps it off the canvas but the filters
 * @param words - The Schematic's words
 * @param dim - Whether the narrowing draws what it leaves out as context (`narrowed="dim"`), rather than hiding it
 * @returns Its line
 */
export function foundLine(item: FoundItem, mark: FoundMark, words: SchematicWords, dim: boolean): string {
    const parts = keyEqual(item.label, item.ref.key) ? [item.ref.key, item.kind] : [item.ref.key, item.label, item.kind];
    return [
        ...parts,
        ...(mark === undefined ? [] : [words.m.findMark({ mark })]),
        ...(item.hidden === undefined ? [] : [hiddenLine(item.hidden, words, dim ? dimmedWords(words.m) : words.m)]),
    ].join(" · ");
}

/**
 * The keys of a kind read whole that a query finds, in East's order: as the server finds a key in a record's own
 * order (`findKeyInline`) — a key's start, a quoted key, a range.
 *
 * @param keys - The kind's keys, in any order
 * @param query - The query the box parsed
 * @returns The keys it finds, in order
 */
export function wholeMatches(keys: readonly string[], query: DatasetKeyQuery): string[] {
    const sorted = [...keys].sort(compareKey);
    const range = findKeyInline(KEY_TYPE, sorted, query);
    return range.found ? sorted.slice(range.row, range.row + range.count) : [];
}

/** One kind's matches: a run of its record's rows, from `start`, or a kind read whole's keys. */
export interface FindRun {
    /** The kind. */
    readonly kind: FindKind;
    /** Where its matches start, in its record's own order: a kind read through its source. */
    readonly start: number;
    /** How many it finds. */
    readonly count: number;
    /** A kind read whole's matches' keys, in order. */
    readonly keys: readonly string[] | undefined;
}

/**
 * The runs a list's rows `[row, row + limit)` fall in: each kind's matches after the one before.
 *
 * @param runs - Each kind's matches, in the Schematic's order of its kinds
 * @param row - The list's first row
 * @param limit - How many rows
 * @returns Each run's part of the rows: the run, the first of its matches, how many, and the list's row it is at
 */
export function runsAt(runs: readonly FindRun[], row: number, limit: number): { run: FindRun; offset: number; n: number; at: number }[] {
    const out: { run: FindRun; offset: number; n: number; at: number }[] = [];
    let base = 0;
    for (const run of runs) {
        const from = Math.max(row, base), to = Math.min(row + limit, base + run.count);
        if (from < to) out.push({ run, offset: from - base, n: to - from, at: from });
        base += run.count;
    }
    return out;
}

/** An item found, from its kind's roles of its row, and what leaves it out on the rail. */
function foundOf(kind: FindKind, key: string, roles: ItemRoles, hidden: readonly RowHidden[] | undefined): FoundItem {
    const ref = { kind: kind.slot, key };
    const position = someOf(roles.position);
    return {
        id: entityId(ref), ref, label: roles.label, kind: kind.name,
        position: position === undefined ? undefined : { x: position.x, y: position.y }, layer: someOf(roles.layer), hidden,
    };
}

/**
 * Some of a kind's matches, read: a kind read through its source's rows by position, through e3, and which of them its
 * narrowing leaves out in one request — those it does asked of e3 which choices do, by the page they were read from
 * (the kind's hidden pick's `askListed`); a kind read whole's from its rows.
 *
 * @param run - The kind's matches
 * @param offset - The first of them the list shows
 * @param n - How many
 * @param pick - The kind's hidden pick; `undefined` for a kind read whole
 * @returns The items, in order
 */
async function matchesOf(run: FindRun, offset: number, n: number, pick: SourceHidden | undefined): Promise<FoundItem[]> {
    const { kind } = run;
    if (kind.part === undefined || run.keys !== undefined) {
        const rows = await awaitTracked(() => kind.rows());
        return (run.keys ?? []).slice(offset, offset + n).flatMap((key) => {
            const roles = rows.get(key)?.roles;
            return roles === undefined ? [] : [foundOf(kind, key, roles, undefined)];
        });
    }
    const part = kind.part;
    const from = run.start + offset;
    // Every record Slice binding reads joined entries of its record's String keys: record.ts' bind refuses any other.
    const entries = await awaitTracked(() => recordSlicePage(part, { where: WHOLE, area: none }, BigInt(from), BigInt(n))) as readonly RecordEntry[];
    const listed = entries.map((entry) => ({ key: entry.key, row: someOf(entry.row) }));
    const rows = listed.flatMap(({ key, row }) => (row === undefined ? [] : [{ key, row }]));
    const where = part.read().where;
    const within = where.size === 0 ? undefined : await awaitTracked(() => recordSliceWithin(part, where, rows));
    // Whether the narrowing holds each row read, in order; every entry of the page with it — one with no row asks nothing.
    const held = rows.map((_row, i) => within === undefined || within[i] === true);
    let at = 0;
    const holds = listed.map(({ row }) => (row === undefined ? true : held[at++]!));
    if (within !== undefined && pick !== undefined) pick.rows.askListed(from, listed.map(({ key }) => key), holds);
    return rows.map(({ key, row }, i) => foundOf(kind, key, kind.read(kind.codec.encode(row), key),
        held[i] || pick === undefined ? undefined : hiddenOf([{ pick, id: key }])));
}

/** Props of {@link useSchematicFind}. */
export interface SchematicFindProps {
    /** The item kinds, in the Schematic's order. */
    readonly kinds: readonly FindKind[];
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /**
     * Each kind's hidden pick, by its slot (`hidden-pick.tsx`' `HideSources`): what a kind read through its source asks e3
     * which of the rail's choices leave out a row its list shows.
     */
    readonly picks: HiddenPicks;
    /** The layers hidden, by key. */
    readonly hiddenLayers: ReadonlySet<string>;
    /**
     * Whether the narrowing draws what it leaves out as context (`narrowed="dim"`), the frame's `look.dim`: a line names
     * the choices that dim an item, never that hide it.
     */
    readonly dim: boolean;
    /** Told the item a pick lands on. */
    readonly onPick: (item: FoundItem) => void;
    /** Told the last pick stands no more: the search cleared, or a new query asked in its place — never one asked again. */
    readonly onCleared: () => void;
}

/**
 * Find's source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The kinds, the words, each kind's hidden pick, the layers hidden, whether the narrowing dims, the pick,
 *   and the pick let go
 * @returns The source
 */
export function useSchematicFind({ kinds, words, picks, hiddenLayers, dim, onPick, onCleared }: SchematicFindProps): KeySearchSource {
    // What a find reads, and whom a pick tells: the latest — the box calls what it captured before the find answered.
    const latest = useRef({ kinds, words, picks, hiddenLayers, dim, onPick, onCleared });
    useLayoutEffect(() => { latest.current = { kinds, words, picks, hiddenLayers, dim, onPick, onCleared }; });
    // What the last find found, each kind's run; a find answered after a newer one asked finds nothing here.
    const found = useRef<readonly FindRun[]>([]);
    const asked = useRef(0);
    const find = useCallback(async (query: DatasetKeyQuery, again?: boolean): Promise<DatasetKeyMatchRange> => {
        // A new query takes the last pick's place; one asked again, as what its lines are read from moved, keeps it.
        if (again !== true) latest.current.onCleared();
        const mine = ++asked.current;
        const seek = toSeekQuery(query);
        const runs = await Promise.all(latest.current.kinds.map(async (kind): Promise<FindRun> => {
            if (kind.part !== undefined) {
                const part = kind.part;
                const range = await awaitTracked(() => recordSliceSeek(part, WHOLE, seek));
                return { kind, start: range.found ? Number(range.row) : 0, count: range.found ? Number(range.count) : 0, keys: undefined };
            }
            const rows = await awaitTracked(() => kind.rows());
            const keys = wholeMatches([...rows.keys()], query);
            return { kind, start: 0, count: keys.length, keys };
        }));
        if (mine === asked.current) found.current = runs;
        const count = runs.reduce((sum, run) => sum + run.count, 0);
        return { found: count > 0, row: 0, count };
    }, []);
    /** The matches at the list's rows `[row, row + limit)`, each with the row it is at. */
    const itemsAt = useCallback(async (row: number, limit: number): Promise<{ at: number; item: FoundItem }[]> => {
        const parts = await Promise.all(runsAt(found.current, row, limit).map(async ({ run, offset, n, at }) =>
            (await matchesOf(run, offset, n, latest.current.picks.get(run.kind.slot))).map((item, i) => ({ at: at + i, item }))));
        return parts.flat();
    }, []);
    const listRange = useCallback(async (row: number, limit: number) => {
        const { words: w, hiddenLayers: hidden, dim: dimmed } = latest.current;
        // A pick shows the item's key in the box: what its query is typed against.
        return (await itemsAt(row, limit)).map(({ at, item }) => ({ row: at, label: foundLine(item, foundMark(item, hidden), w, dimmed), text: item.ref.key }));
    }, [itemsAt]);
    const jump = useCallback((row: number) => {
        void itemsAt(row, 1).then(([hit]) => { if (hit !== undefined) latest.current.onPick(hit.item); })
            .catch((error: unknown) => { console.error("[Schematic] Find could not read the item it found:", error); });
    }, [itemsAt]);
    const clear = useCallback(() => {
        asked.current++;
        found.current = [];
        latest.current.onCleared();
    }, []);
    // The box asks its query again when what its lines are read from moves: each source's record and its narrowing,
    // each kind read whole's rows — tracked, so a window the canvas reads moves none of it — and the layers hidden.
    const readAnswers = useCallback(() => kinds.map((kind) => (kind.part === undefined
        ? rowsToken(kind.rows())
        : `${someOf(recordSliceRevision(kind.part)) ?? ""}\u0000${printWhere(kind.part.read().where)}`)).join("\n"), [kinds]);
    const { result } = useTrackedEvaluation(readAnswers);
    const answers = result.ok ? result.value : "";
    const layers = useMemo(() => [...hiddenLayers].sort(compareKey).join("\u0000"), [hiddenLayers]);
    const [requery, setRequery] = useState(0);
    const seen = useRef({ answers, layers });
    useEffect(() => {
        if (keyEqual(seen.current.answers, answers) && keyEqual(seen.current.layers, layers)) return;
        seen.current = { answers, layers };
        setRequery((n) => n + 1);
    }, [answers, layers]);
    // It lists its lines again as e3 says which choices leave out a row they show, or a kind's pick comes to ask — and as
    // the narrowing comes to dim what it leaves out, or to hide it, which its lines word.
    const relist = useRelist(kinds.flatMap((kind) => { const pick = picks.get(kind.slot); return pick === undefined ? [] : [pick]; }), [dim]);
    const noMatches = words.m.findNoMatches();
    return useMemo(() => ({
        resetKey: "schematic", requery, relist, keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY, noMatchesText: noMatches,
    }), [requery, relist, find, listRange, jump, clear, noMatches]);
}
