/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398, #1621): every builder's toolbar key search over the
 * records it draws, by primary key — never a field search, which is the rail's,
 * and never what the builder draws. One engine seeks, lists and picks for every
 * builder — the Plan's rows, the Calendar's event kinds, the Allocation's bins,
 * the Roster's people, the Flowchart's states and the Schematic's kinds; a
 * builder names its sources, how a found row reads as its item, its line's
 * words and what a pick does, and renders.
 *
 * - **A source sought through e3** is sought in its record with no choice of
 *   the viewer's: `recordSliceKeySearch` places the query's matches among the
 *   rows the page holds of the record — the record's own, or, on a page whose
 *   source holds a scope, the scope's alone, a block for each of its values
 *   that holds one — and `recordSliceBasePage` reads the rows a list shows by
 *   their place there.
 * - **A source read whole** is sought among its rows, their keys in East's
 *   order at its key type, as the server finds a key (`findKeyInline`), or as
 *   the source matches them; on a page whose source holds a scope, among the
 *   rows its scope holds alone, asked of e3 ({@link scopeHeld}).
 *
 * The box parses typed text at the sources' key type where they share one,
 * else at String, a source keyed otherwise reading the text as typed at its
 * own ({@link kindQuery}); an empty box lists the first matches where it
 * parses at String. The matches are one list: each source's in its keys'
 * order, the sources in the builder's order, each block after the one before
 * ({@link stretchesAt}), and a row keeps its place in it — one a source lists
 * nothing of leaves a gap.
 *
 * A line says what hides its row, as the shared hidden pick words it
 * (`hidden.ts`): a source sought through e3 asks e3 which of the rows a list
 * shows its narrowing holds — over the rows the list read, where they carry
 * them, else by their keys — and which choices hide those it does not; beside
 * it, the builder names the sources it reads as hiding a row (the resource a
 * layout lays an event on, a bin's lane, the people the rail shows), which are
 * asked the same. A pick reads its row again and hands it to the builder, the
 * latest pick alone: a newer pick, a new query or a clear leaves one on its way
 * behind, and a query asked again leaves it standing. The box asks its query
 * again as a source's record moves to another revision, as its page's scope
 * moves, and as what else the builder says its matches are read from moves;
 * and lists its lines again as e3 says what hides a row, as a source's
 * narrowing moves, and as what else the builder's lines read moves.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { EastTypeType, StringType, equalFor, none, parseFor, printFor, some, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import {
    RecordSliceWhereType, findKeyInline, parseKeyInput, recordScopedWhere,
    type DatasetKeyMatchRange, type DatasetKeyQuery, type RecordSliceBindType, type RecordSliceEntry,
} from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type KeySearchJump, type KeySearchSource } from "@elaraai/east-ui-components";
import {
    awaitTracked, recordSliceBasePage, recordSliceKeySearch, recordSliceRevision, recordSliceRows, recordSliceWithin,
} from "@elaraai/east-ui-components/internal";
import { askHiding, hiddenOf, useMoves, useRelist, type RowHidden, type RowHiding, type SourceHidden } from "./hidden.js";
import { STRING_KEYS, type KindKeys } from "./kind-keys.js";

const sameType = equalFor(EastTypeType);
const readString = parseFor(StringType);
const printWhere = printFor(RecordSliceWhereType);

/** A record Slice's part: a source of the slice. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;

/** An empty box lists the first of the matches where it parses at String. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };
/** No source hides a row. */
const NO_HIDINGS: readonly RowHiding[] = [];
/** Nothing else the box reads. */
const NOTHING: readonly unknown[] = [];

/** Each value a tracked read answered, numbered: what tells the box it was read again. */
const readIds = new WeakMap<object, number>();
let nextReadId = 0;

/**
 * A token that moves as a tracked read answers another value: what tells the
 * box a source read whole was read again ({@link WholeSought.token}), where
 * the builder reads its rows through a binding — a read that answers the value
 * it answered before moves nothing.
 *
 * @param read - What the read answered; `none` while it is pending
 * @returns The token: `-` while the read is pending
 */
export function readToken(read: option<object>): string {
    if (read.type === "none") return "-";
    let id = readIds.get(read.value);
    if (id === undefined) {
        id = nextReadId++;
        readIds.set(read.value, id);
    }
    return `read:${id}`;
}

/**
 * Which of some rows of a source a narrowing holds, asked of e3 by their keys:
 * their rows read in one request, and which of them the narrowing holds in one
 * more — a tracked read, which answers once both have. What a builder asks of
 * rows it names by key and holds no page of: the rows of a source read whole
 * against its page's scope ({@link scopeHolds}), the resources a Calendar's
 * events are laid on against their source's narrowing.
 *
 * @param part - The source's part of the slice
 * @param where - The narrowing
 * @param ids - The rows' keys' texts, each once
 * @param keys - The rows' keys: each text read back at the record's key type; String's by default
 * @returns Whether the narrowing holds each row the record holds, by its key's text — none for a key the record holds no
 *   row by, or a text no key prints as; `none` while e3 has not said
 */
export function rowsWithin(part: RecordPart, where: ValueTypeOf<typeof RecordSliceWhereType>, ids: readonly string[],
    keys: KindKeys = STRING_KEYS): option<ReadonlyMap<string, boolean>> {
    const asked = ids.flatMap((id) => {
        const key = keys.keyOf(id);
        return key === undefined ? [] : [{ id, key }];
    });
    if (asked.length === 0) return some(new Map());
    const rows = recordSliceRows(part, asked.map(({ key }) => key));
    if (rows.type === "none") return none;
    const stored = asked.flatMap(({ id, key }, i) => {
        const row = rows.value[i]!;
        return row.type === "some" ? [{ id, key, row: row.value }] : [];
    });
    const held = stored.length === 0 ? some<boolean[]>([]) : recordSliceWithin(part, where, stored.map(({ key, row }) => ({ key, row })));
    return held.type === "none" ? none : some(new Map(stored.map(({ id }, i) => [id, held.value[i]!] as const)));
}

/**
 * Which of some rows of a source its page's scope holds (#1621), asked of e3
 * by their keys ({@link rowsWithin}): a key the record holds no row by is held
 * by none, as is a text no key prints as.
 *
 * @param part - The source's part of the slice, which holds a scope
 * @param ids - The rows' keys' texts, each once
 * @param keys - The rows' keys: each text read back at the record's key type; String's by default
 * @returns The texts of the keys the scope holds; `none` while e3 has not said
 */
export function scopeHolds(part: RecordPart, ids: readonly string[], keys: KindKeys = STRING_KEYS): option<ReadonlySet<string>> {
    const held = rowsWithin(part, recordScopedWhere(part.config.scope, new Map()), ids, keys);
    return held.type === "none" ? none : some(new Set(ids.filter((id) => held.value.get(id) === true)));
}

/**
 * {@link scopeHolds}, awaited: which of some rows of a source its page's scope
 * holds, once e3 has said.
 *
 * @param part - The source's part of the slice; `undefined` with none
 * @param ids - The rows' keys' texts, each once
 * @param keys - The rows' keys; String's by default
 * @returns The texts of the keys the scope holds; `undefined` with no part, or a page with no scope, which holds every row
 */
export async function scopeHeld(part: RecordPart | undefined, ids: readonly string[], keys: KindKeys = STRING_KEYS): Promise<ReadonlySet<string> | undefined> {
    if (part === undefined || part.config.scope.size === 0) return undefined;
    return awaitTracked(() => scopeHolds(part, ids, keys));
}

/** A row a list shows of a source sought through e3, as the binding read it: what a builder reads its item from. */
export interface RecordRow {
    /** Its key's text: a String key as itself, any other as East prints it (#1549). */
    readonly id: string;
    /** Its key, at the record's key type. */
    readonly key: unknown;
    /** Its row, joined; `undefined` where the binding read none — a lean binding's, or a row the record holds no more. */
    readonly row: unknown;
    /** Its entry, as the binding read it: the key of the index the row was read through among it. */
    readonly entry: RecordSliceEntry;
}

/**
 * A source Search Records seeks through e3 (see the module docs): its part of
 * the slice, whose record a query is placed in.
 *
 * @typeParam T - What the builder reads a found row as
 */
export interface RecordSought<T> {
    /** Its part of the slice: the record sought, and the page's scope. */
    readonly part: RecordPart;
    /** Its keys (#1549): the key type a query is read at, and each key's text. */
    readonly keys: KindKeys;
    /**
     * Its hidden pick (`hidden.ts`): what asks e3 which choices hide a row a list shows that its narrowing leaves out;
     * none for a source whose own narrowing hides no row the builder lists, which asks nothing.
     */
    readonly pick?: SourceHidden | undefined;
    /**
     * A row a list shows, as the builder reads it: a tracked read — `none` while it is pending; then `some(none)` for a
     * row it lists nothing of, whose place the list keeps, else `some(some(item))`.
     */
    readonly read: (row: RecordRow) => option<option<T>>;
}

/**
 * A source's read of the rows a list shows from the rows themselves
 * ({@link RecordSought.read}): a row the list read no row of — a lean
 * binding's, or one the record holds no more — lists nothing, its place kept;
 * any other is the builder's item.
 *
 * @param item - The builder's item, from a row's key's text and its row
 * @returns The read
 */
export function readsRows<T>(item: (id: string, row: unknown) => T): RecordSought<T>["read"] {
    return ({ id, row }) => some(row === undefined ? none : some(item(id, row)));
}

/**
 * A source Search Records seeks among rows held whole (see the module docs).
 *
 * @typeParam T - What the builder reads a found row as
 */
export interface WholeSought<T> {
    /** Every row it holds, as the builder reads it: a tracked read, `none` while it is pending. */
    readonly rows: () => option<readonly T[]>;
    /** A row's key's text: a String key as itself, any other as East prints it. */
    readonly idOf: (row: T) => string;
    /** Its keys: the key type a query is read at, each text read back at it, and their order. */
    readonly keys: KindKeys;
    /** The part of the slice its rows are narrowed through, whose page's scope they are listed under (#1621); none with none. */
    readonly scope?: RecordPart | undefined;
    /** What a query finds among its rows, in their keys' order; by default, those whose keys it finds ({@link keyMatches}). */
    readonly matches?: ((rows: readonly T[], query: DatasetKeyQuery) => readonly T[]) | undefined;
    /**
     * What tells the box its rows were read again, tracked: a token that moves then — {@link readToken} of what a
     * binding answers; none for rows the builder holds, whose moves it names itself ({@link SearchRecordsOptions.requeryBy}).
     */
    readonly token?: (() => string) | undefined;
}

/** A source Search Records seeks: through e3, or among rows held whole. */
export type SoughtSource<T> = RecordSought<T> | WholeSought<T>;

/** Whether a source is sought through e3. */
function throughE3<T>(source: SoughtSource<T>): source is RecordSought<T> {
    return "part" in source;
}

/** A row Search Records found: its place in the list, the builder's item, and what hides it. */
export interface Found<T> {
    /** Its place in the list. */
    readonly at: number;
    /** The row, as the builder reads it. */
    readonly item: T;
    /**
     * What hides it, as far as e3 has said — each source the builder reads as hiding it, its own first, with what e3 said
     * hides it there; `undefined` for a row nothing hides.
     */
    readonly hidden: readonly RowHidden[] | undefined;
}

/** A pick, as the builder takes it: how the box asked it, and whether it is the latest still. */
export interface PickTurn {
    /** How the box asked it: a `pick` hands the keyboard to the builder's view, a `step` leaves it in the box. */
    readonly how: KeySearchJump;
    /** Whether it is the box's latest pick still: a newer pick, a new query or a clear leaves it behind. */
    readonly current: () => boolean;
}

/** What a builder's Search Records is made of (see the module docs). */
export interface SearchRecordsOptions<T> {
    /** Who seeks, as the console names it when a read fails: `Calendar`, `Schematic`. */
    readonly name: string;
    /** What tells this box from another a toolbar holds. */
    readonly resetKey: string;
    /** The sources, in the builder's order: their matches are listed in it. */
    readonly sources: readonly SoughtSource<T>[];
    /** A found row's line: its words, and the text the box shows once it is picked — what its query is typed against. */
    readonly line: (found: Found<T>) => { readonly label: string; readonly text: string };
    /** Told the row a pick lands on, and the pick's turn. */
    readonly onPick: (found: Found<T>, turn: PickTurn) => void;
    /** Told the last pick stands no more: the search cleared, or a new query asked in its place — never one asked again. */
    readonly onCleared?: (() => void) | undefined;
    /** What the box says where no key matches. */
    readonly noMatchesText?: string | undefined;
    /**
     * The sources the builder reads as hiding each of some found rows, beside a source's own — the resource a layout lays
     * an event on, a bin's lane, the people the rail shows — each with the row of it the found row stands on.
     */
    readonly hidings?: ((items: readonly T[]) => readonly (readonly RowHiding[])[] | Promise<readonly (readonly RowHiding[])[]>) | undefined;
    /** Whether the builder knows that each source it names hides the row it stands on, so a line says so at once; by default it does. */
    readonly hidingsKnown?: boolean | undefined;
    /** What else the matches are read from, each another object as it moves: the box asks its query again then. */
    readonly requeryBy?: readonly unknown[] | undefined;
    /** What else the lines read — the hidden picks the builder names, a layout, its words — each another object as it moves. */
    readonly relistBy?: readonly unknown[] | undefined;
}

/**
 * A run of a source's matches: a block of them among the rows its page holds,
 * or a source read whole's matches.
 */
export interface FoundRun<T> {
    /** The source. */
    readonly source: SoughtSource<T>;
    /** Where it starts among the rows the source's page holds — the record's own, or its scope's (#1621); 0 for a source read whole. */
    readonly start: bigint;
    /** How many matches it holds. */
    readonly count: number;
    /** A source read whole's matches, in order; `undefined` for a block of a source sought through e3. */
    readonly rows: readonly T[] | undefined;
}

/** A stretch of a list's rows, read from one run. */
export interface Stretch<R> {
    /** The run. */
    readonly run: R;
    /** The first of the run's matches it reads. */
    readonly offset: number;
    /** How many. */
    readonly n: number;
    /** The list's row it starts at. */
    readonly at: number;
}

/**
 * The stretches a list's rows `[row, row + limit)` are read in, its matches one
 * run after another.
 *
 * @param runs - The runs, in the list's order, each with how many matches it holds
 * @param row - The list's first row
 * @param limit - How many rows it reads
 * @returns Each stretch, in the list's order
 */
export function stretchesAt<R extends { readonly count: number }>(runs: readonly R[], row: number, limit: number): Stretch<R>[] {
    const out: Stretch<R>[] = [];
    let base = 0;
    for (const run of runs) {
        const from = Math.max(row, base), to = Math.min(row + limit, base + run.count);
        if (from < to) out.push({ run, offset: from - base, n: to - from, at: from });
        base += run.count;
    }
    return out;
}

/**
 * The rows a query finds among rows held whole, by their keys, in East's order
 * at their key type (#1549): as the server finds a key in a record's own order
 * (`findKeyInline`) — a key's start, a quoted key, a range. A text no key
 * prints as is no key a query finds; of rows whose key's text repeats, the
 * last stands for them.
 *
 * @param rows - The rows, in any order
 * @param idOf - A row's key's text
 * @param query - The query, as the source seeks it ({@link kindQuery})
 * @param keys - The rows' keys: each text read back at their key type, and their order; String's by default
 * @returns The rows it finds, in their keys' order
 */
export function keyMatches<T>(rows: readonly T[], idOf: (row: T) => string, query: DatasetKeyQuery, keys: KindKeys = STRING_KEYS): T[] {
    const byId = new Map(rows.map((row) => [idOf(row), row] as const));
    const sought = keys.order(byId.keys()).filter(({ key }) => key !== undefined);
    const range = findKeyInline(keys.keyType, sought.map(({ key }) => key), query);
    return range.found ? sought.slice(range.row, range.row + range.count).map(({ text }) => byId.get(text)!) : [];
}

/**
 * The key type a box parses typed text at: the sources' where they share one,
 * else String — a source keyed otherwise reading the text as typed at its own
 * ({@link kindQuery}).
 *
 * @param keys - Each source's keys
 * @returns The key type
 */
export function boxKeyType(keys: readonly KindKeys[]): EastTypeValue {
    const first = keys[0]?.keyType;
    return first !== undefined && keys.every((k) => sameType(k.keyType, first)) ? first : STRING_KEYS.keyType;
}

/**
 * The text a query the box parsed at String was typed as: a key's start as itself, a quoted key as its literal, a range
 * by its ends' texts — what a source keyed by another type reads as typed.
 *
 * @param query - The query, parsed at String
 * @returns The text
 */
function typedText(query: DatasetKeyQuery): string {
    if ("key" in query) return query.key;
    if ("from" in query || "to" in query) {
        const end = (literals: readonly string[] | undefined): string => {
            const literal = literals?.[0];
            const read = literal === undefined ? undefined : readString(literal);
            return read?.success === true ? read.value : "";
        };
        return `${end(query.from)}..${end(query.to)}`;
    }
    return "prefix" in query ? query.prefix : "";
}

/**
 * A query the box parsed, as one source seeks it (#1549): as it is where the
 * box parses at the source's key type; else — the box at String, over sources
 * keyed by several types — the text as typed, read at the source's as the
 * shared key search reads it (`parseKeyInput`): `10` the key 10 of a source
 * keyed by Integer, `2..9` a range of them.
 *
 * @param query - The query the box parsed
 * @param box - The key type the box parses at
 * @param keyed - The source's keys
 * @returns The query the source is sought by; `undefined` where the text reads as no key of the source's, which finds
 *   none of its rows
 */
export function kindQuery(query: DatasetKeyQuery, box: EastTypeValue, keyed: KindKeys): DatasetKeyQuery | undefined {
    if (sameType(box, keyed.keyType)) return query;
    const parsed = parseKeyInput(keyed.keyType, typedText(query));
    return parsed.kind === "query" ? parsed.query : undefined;
}

/**
 * Seeks a query in each source, in order (see the module docs): a source
 * sought through e3 a block of matches at a time — one with no scope, one for
 * each of the scope's values that holds one — and a source read whole its
 * matches, on a scoped page those its scope holds alone.
 *
 * @param sources - The sources, in the builder's order
 * @param query - The query the box parsed
 * @param box - The key type the box parses at ({@link boxKeyType})
 * @returns Each run of matches, in the list's order: none for a source the query finds nothing of
 */
export async function searchRuns<T>(sources: readonly SoughtSource<T>[], query: DatasetKeyQuery, box: EastTypeValue): Promise<FoundRun<T>[]> {
    const runs = await Promise.all(sources.map(async (source): Promise<FoundRun<T>[]> => {
        // Text that reads as no key of the source's finds none of its rows.
        const asked = kindQuery(query, box, source.keys);
        if (asked === undefined) return [];
        if (throughE3(source)) {
            const blocks = await awaitTracked(() => recordSliceKeySearch(source.part, asked));
            return blocks.flatMap((block) => (block.count === 0n ? [] : [{ source, start: block.row, count: Number(block.count), rows: undefined }]));
        }
        const rows = await awaitTracked(source.rows);
        const all = source.matches === undefined ? keyMatches(rows, source.idOf, asked, source.keys) : source.matches(rows, asked);
        // On a scoped page, the rows its scope holds alone (#1621): the rest are no row of this page's.
        const held = await scopeHeld(source.scope, all.map(source.idOf), source.keys);
        const found = held === undefined ? all : all.filter((row) => held.has(source.idOf(row)));
        return found.length === 0 ? [] : [{ source, start: 0n, count: found.length, rows: found }];
    }));
    return runs.flat();
}

/** A found row as a list read it: its place, the builder's item, and its own source, where that source's narrowing hides it. */
interface Listed<T> {
    readonly at: number;
    readonly item: T;
    readonly own: readonly RowHiding[];
}

/** What a list reads beside what a find found ({@link listFound}). */
export interface ListOptions<T> {
    /**
     * The sources as the builder names them now: a run of a source sought through e3 is read through the one sought
     * through the same part — its hidden pick, and so its narrowing, and its read the latest, as a narrowing that moved
     * since the find lists its lines again; by default, the sources the find sought.
     */
    readonly sources?: readonly SoughtSource<T>[] | undefined;
    /** The sources the builder reads as hiding each found row, beside a source's own ({@link SearchRecordsOptions.hidings}). */
    readonly hidings?: SearchRecordsOptions<T>["hidings"];
    /** Whether the builder knows each source it names hides the row it stands on; by default it does. */
    readonly known?: boolean | undefined;
}

/**
 * A run's source, as the builder names it now: the one sought through the same part, else the one the find sought.
 *
 * @param source - The source the find sought
 * @param current - The sources as the builder names them now
 * @returns The source to read the run through
 */
function sourceNow<T>(source: RecordSought<T>, current: readonly SoughtSource<T>[] | undefined): RecordSought<T> {
    return current?.find((now): now is RecordSought<T> => throughE3(now) && Object.is(now.part, source.part)) ?? source;
}

/**
 * Which of the rows a list read of a source its narrowing hides, as far as is
 * known, asked of e3 with which choices hide those it does (its hidden pick):
 * over the rows the list read, where they carry them (`askListed`) — known at
 * once — else by their keys (`askIds`), known once the answers land, which
 * move the pick. Nothing is asked with no pick, or a narrowing that holds no
 * choice.
 *
 * @param source - The source
 * @param from - The list's first row of it, among the rows its page holds
 * @param rows - The rows read
 * @returns For each row, whether its narrowing hides it: `undefined` while it is not known
 */
async function hidesListed<T>(source: RecordSought<T>, from: bigint, rows: readonly RecordRow[]): Promise<readonly (boolean | undefined)[]> {
    const { pick, part } = source;
    const where = pick?.where;
    if (pick === undefined || where === undefined || where.size === 0) return rows.map(() => false);
    const joined = rows.flatMap(({ key, row }) => (row === undefined ? [] : [{ key, row }]));
    const within = joined.length === 0 ? [] : await awaitTracked(() => recordSliceWithin(part, where, joined));
    // Whether the narrowing holds each row read, in order: one the list read no row of is asked of by its key.
    let j = 0;
    const holds = rows.map(({ row }) => (row === undefined ? true : within[j++]!));
    pick.rows.askListed(Number(from), rows.map(({ id }) => id), holds);
    const unread = rows.flatMap(({ id, row }) => (row === undefined ? [id] : []));
    if (unread.length > 0) pick.rows.askIds(unread);
    return rows.map(({ id, row }, i) => (row === undefined ? pick.rows.stateOf(id)?.hidden : !holds[i]));
}

/**
 * Reads the rows `[row, row + limit)` of what a find found, as a list shows them
 * (see the module docs): a source sought through e3 a page of the rows its page
 * holds at a time, each read as the builder reads it now, and which its
 * narrowing now hides asked of e3; a source read whole's matches as they were
 * found; and what hides each row, the builder's sources beside a source's own.
 *
 * @param runs - What the find found
 * @param row - The list's first row
 * @param limit - How many rows
 * @param options - The sources as the builder names them now, and the sources it reads as hiding a row
 * @returns Each row found, at its place in the list, in order: one a source lists nothing of leaves its place
 */
export async function listFound<T>(runs: readonly FoundRun<T>[], row: number, limit: number, options: ListOptions<T> = {}): Promise<Found<T>[]> {
    const { sources: current, hidings, known = true } = options;
    const stretches = await Promise.all(stretchesAt(runs, row, limit).map(async ({ run, offset, n, at }): Promise<Listed<T>[]> => {
        if (!throughE3(run.source)) return (run.rows ?? []).slice(offset, offset + n).map((item, i) => ({ at: at + i, item, own: NO_HIDINGS }));
        const source = sourceNow(run.source, current);
        const from = run.start + BigInt(offset);
        const entries = await awaitTracked(() => recordSliceBasePage(source.part, from, BigInt(n)));
        const rows = entries.map((entry): RecordRow => ({
            id: source.keys.textOf(entry.key), key: entry.key, row: entry.row?.type === "some" ? entry.row.value : undefined, entry,
        }));
        const hides = await hidesListed(source, from, rows);
        const items = await Promise.all(rows.map((listed) => awaitTracked(() => source.read(listed))));
        return items.flatMap((item, i): Listed<T>[] => (item.type === "none" ? [] : [{
            at: at + i, item: item.value, own: hides[i] === true && source.pick !== undefined ? [{ pick: source.pick, id: rows[i]!.id }] : NO_HIDINGS,
        }]));
    }));
    const listed = stretches.flat();
    const more = hidings === undefined ? undefined : await hidings(listed.map(({ item }) => item));
    if (more !== undefined) askHiding(more.flat(), known);
    return listed.map(({ at, item, own }, i) => ({ at, item, hidden: hiddenOf([...own, ...(more?.[i] ?? NO_HIDINGS)]) }));
}

/**
 * A builder's Search Records, for the shared key search's toolbar item (see
 * the module docs).
 *
 * @param options - The builder's sources, its lines, its pick and what else its matches and lines read
 * @returns The box's source; `undefined` with no source to seek
 */
export function useSearchRecords<T>(options: SearchRecordsOptions<T>): KeySearchSource | undefined {
    const { resetKey, sources, noMatchesText, requeryBy, relistBy } = options;
    // What a find reads, and whom a pick tells: the latest — the box calls what it captured before a find answered.
    const latest = useRef(options);
    useLayoutEffect(() => { latest.current = options; });
    const box = useMemo(() => boxKeyType(sources.map((source) => source.keys)), [sources]);
    // What the last find found; a find answered after a newer one was asked finds nothing here.
    const found = useRef<readonly FoundRun<T>[]>([]);
    const asked = useRef(0);
    // The latest pick: a newer pick, a new query or a clear leaves one on its way behind.
    const picked = useRef(0);
    const find = useCallback(async (query: DatasetKeyQuery, again?: boolean): Promise<DatasetKeyMatchRange> => {
        // A new query takes the last pick's place; one asked again, as what its matches are read from moved, leaves it.
        if (again !== true) {
            picked.current++;
            latest.current.onCleared?.();
        }
        const mine = ++asked.current;
        const sought = latest.current.sources;
        const runs = await searchRuns(sought, query, boxKeyType(sought.map((source) => source.keys)));
        if (mine === asked.current) found.current = runs;
        const count = runs.reduce((sum, run) => sum + run.count, 0);
        return { found: count > 0, row: 0, count };
    }, []);
    // A list reads each source as the builder names it now: a narrowing that moved since the find is the one asked.
    const listed = useCallback((row: number, limit: number): Promise<Found<T>[]> => {
        const { sources: now, hidings, hidingsKnown } = latest.current;
        return listFound(found.current, row, limit, { sources: now, hidings, known: hidingsKnown });
    }, []);
    const listRange = useCallback(async (row: number, limit: number) => {
        const rows = await listed(row, limit);
        const { line } = latest.current;
        return rows.map((hit) => ({ row: hit.at, ...line(hit) }));
    }, [listed]);
    const jump = useCallback((row: number, how: KeySearchJump) => {
        const turn = ++picked.current;
        const current = () => turn === picked.current;
        void listed(row, 1).then(([hit]) => {
            if (hit !== undefined && current()) latest.current.onPick(hit, { how, current });
        }).catch((error: unknown) => { console.error(`[${latest.current.name}] Search Records could not read the row it found:`, error); });
    }, [listed]);
    const clear = useCallback(() => {
        asked.current++;
        picked.current++;
        found.current = [];
        latest.current.onCleared?.();
    }, []);
    // The box asks its query again as what its matches are read from moves: each source's record's revision and its
    // page's scope, each source read whole's token — tracked, so a window the builder reads moves none of it — and what
    // else the builder names.
    const readTokens = useCallback(() => sources.map((source): string => {
        if (!throughE3(source)) return source.token?.() ?? "";
        const revision = recordSliceRevision(source.part);
        return `${revision.type === "some" ? revision.value : "-"}\u0000${printWhere(source.part.config.scope)}`;
    }).join("\n"), [sources]);
    const { result } = useTrackedEvaluation(readTokens);
    const requery = useMoves([result.ok ? result.value : "", ...(requeryBy ?? NOTHING)]);
    // It lists its lines again as e3 says what hides a row and as a source's narrowing moves — each pick another object
    // then — and as what else the builder's lines read moves.
    const picks = sources.flatMap((source) => (throughE3(source) && source.pick !== undefined ? [source.pick] : []));
    const relist = useRelist(picks, relistBy ?? NOTHING);
    const browse = sameType(box, STRING_KEYS.keyType) ? BROWSE_QUERY : undefined;
    const any = sources.length > 0;
    return useMemo(() => (any ? {
        resetKey, requery, relist, keyType: box, find, listRange, jump, clear, browseQuery: browse, noMatchesText,
    } : undefined), [any, resetKey, requery, relist, box, find, listRange, jump, clear, browse, noMatchesText]);
}
