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
 * and says what keeps it off the canvas: the rail's filters, its layer, or no
 * position. A pick hands the frame the item and what it knows of it
 * (`onPick`), and the box shows its key; the pick stands until the search is
 * cleared or a new query asked in its place, which the frame hears
 * (`onCleared`), so what it said of where the pick landed goes with it. The
 * box asks its query again when what its lines are read from moves — a
 * source's record or its narrowing, a kind read whole's rows, the layers
 * hidden or how the narrowing draws — and never when a window of what the
 * canvas draws lands, so a pick's fly keeps its place among the matches: a
 * query asked again leaves the pick standing.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, compareFor, equalFor, match, printFor, toEastTypeValue, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import { RecordSliceWhereType, findKeyInline, type DatasetKeyMatchRange, type DatasetKeyQuery, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, recordSlicePage, recordSliceRevision, recordSliceSeek, recordSliceWithin, toSeekQuery } from "@elaraai/east-ui-components/internal";
import { entityId, type ItemRoles, type SchematicRef } from "./canvas/drawn.js";
import type { RowCodec } from "../shared/schedule/records.js";
import type { SchematicWords } from "./messages.js";

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
    /** Whether the rail's narrowing of its kind's source leaves it out. */
    readonly filtered: boolean;
}

/** What keeps a found item off the canvas, as its line marks it — or `undefined` while nothing does. */
export type FoundMark = "hidden" | "dimmed" | "layer" | "unplaced" | undefined;

/**
 * What keeps a found item off the canvas: no position first, then the rail's filters — `dimmed` where the narrowing
 * draws what it leaves out as context — then a hidden layer.
 *
 * @param item - The item found
 * @param dim - Whether the narrowing dims what it leaves out
 * @param hiddenLayers - The layers hidden, by key
 * @returns Its mark
 */
export function foundMark(item: FoundItem, dim: boolean, hiddenLayers: ReadonlySet<string>): FoundMark {
    if (item.position === undefined) return "unplaced";
    if (item.filtered) return dim ? "dimmed" : "hidden";
    return item.layer !== undefined && hiddenLayers.has(item.layer) ? "layer" : undefined;
}

/**
 * How a found item reads in Find's list: its key, its label when it is not its key, its kind's name, and what keeps
 * it off the canvas.
 *
 * @param item - The item
 * @param mark - What keeps it off the canvas
 * @param words - The Schematic's words
 * @returns Its line
 */
export function foundLine(item: FoundItem, mark: FoundMark, words: SchematicWords): string {
    const parts = keyEqual(item.label, item.ref.key) ? [item.ref.key, item.kind] : [item.ref.key, item.label, item.kind];
    return [...parts, ...(mark === undefined ? [] : [words.m.findMark({ mark })])].join(" · ");
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

/** An item found, from its kind's roles of its row. */
function foundOf(kind: FindKind, key: string, roles: ItemRoles, filtered: boolean): FoundItem {
    const ref = { kind: kind.slot, key };
    const position = someOf(roles.position);
    return {
        id: entityId(ref), ref, label: roles.label, kind: kind.name,
        position: position === undefined ? undefined : { x: position.x, y: position.y }, layer: someOf(roles.layer), filtered,
    };
}

/**
 * Some of a kind's matches, read: a kind read through its source's rows by position, through e3, and which of them its
 * narrowing leaves out in one request; a kind read whole's from its rows.
 */
async function matchesOf(run: FindRun, offset: number, n: number): Promise<FoundItem[]> {
    const { kind } = run;
    if (kind.part === undefined || run.keys !== undefined) {
        const rows = await awaitTracked(() => kind.rows());
        return (run.keys ?? []).slice(offset, offset + n).flatMap((key) => {
            const roles = rows.get(key)?.roles;
            return roles === undefined ? [] : [foundOf(kind, key, roles, false)];
        });
    }
    const part = kind.part;
    // Every record Slice binding reads joined entries of its record's String keys: record.ts' bind refuses any other.
    const entries = await awaitTracked(() => recordSlicePage(part, WHOLE, BigInt(run.start + offset), BigInt(n))) as readonly RecordEntry[];
    const rows = entries.flatMap((entry) => { const row = someOf(entry.row); return row === undefined ? [] : [{ key: entry.key, row }]; });
    const where = part.read().where;
    const held = where.size === 0 ? undefined : await awaitTracked(() => recordSliceWithin(part, where, rows));
    return rows.map(({ key, row }, i) => foundOf(kind, key, kind.read(kind.codec.encode(row), key), held !== undefined && !held[i]));
}

/** Props of {@link useSchematicFind}. */
export interface SchematicFindProps {
    /** The item kinds, in the Schematic's order. */
    readonly kinds: readonly FindKind[];
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** Whether the narrowing dims what it leaves out. */
    readonly dim: boolean;
    /** The layers hidden, by key. */
    readonly hiddenLayers: ReadonlySet<string>;
    /** Told the item a pick lands on. */
    readonly onPick: (item: FoundItem) => void;
    /** Told the last pick stands no more: the search cleared, or a new query asked in its place — never one asked again. */
    readonly onCleared: () => void;
}

/**
 * Find's source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The kinds, the words, how the narrowing and the layers show, the pick, and the pick let go
 * @returns The source
 */
export function useSchematicFind({ kinds, words, dim, hiddenLayers, onPick, onCleared }: SchematicFindProps): KeySearchSource {
    // What a find reads, and whom a pick tells: the latest — the box calls what it captured before the find answered.
    const latest = useRef({ kinds, words, dim, hiddenLayers, onPick, onCleared });
    useLayoutEffect(() => { latest.current = { kinds, words, dim, hiddenLayers, onPick, onCleared }; });
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
            (await matchesOf(run, offset, n)).map((item, i) => ({ at: at + i, item }))));
        return parts.flat();
    }, []);
    const listRange = useCallback(async (row: number, limit: number) => {
        const { words: w, dim: d, hiddenLayers: hidden } = latest.current;
        // A pick shows the item's key in the box: what its query is typed against.
        return (await itemsAt(row, limit)).map(({ at, item }) => ({ row: at, label: foundLine(item, foundMark(item, d, hidden), w), text: item.ref.key }));
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
    // each kind read whole's rows — tracked, so a window the canvas reads moves none of it — the layers hidden and how
    // the narrowing draws.
    const readAnswers = useCallback(() => kinds.map((kind) => (kind.part === undefined
        ? rowsToken(kind.rows())
        : `${someOf(recordSliceRevision(kind.part)) ?? ""}\u0000${printWhere(kind.part.read().where)}`)).join("\n"), [kinds]);
    const { result } = useTrackedEvaluation(readAnswers);
    const answers = result.ok ? result.value : "";
    const layers = useMemo(() => [...hiddenLayers].sort(compareKey).join("\u0000"), [hiddenLayers]);
    const [requery, setRequery] = useState(0);
    const seen = useRef({ answers, layers, dim });
    useEffect(() => {
        if (keyEqual(seen.current.answers, answers) && keyEqual(seen.current.layers, layers) && seen.current.dim === dim) return;
        seen.current = { answers, layers, dim };
        setRequery((n) => n + 1);
    }, [answers, layers, dim]);
    const noMatches = words.m.findNoMatches();
    return useMemo(() => ({ resetKey: "schematic", requery, keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY, noMatchesText: noMatches }),
        [requery, find, listRange, jump, clear, noMatches]);
}
