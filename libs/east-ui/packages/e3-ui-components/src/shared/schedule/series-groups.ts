/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The groups of keys a reader of a schedule's event kinds reads a series
 * index's cells for (`cells.ts`, #1433, #1710): a block of the paged rows'
 * resources, or the events on none — each read through the series index that
 * serves it, under the narrowing that index reads it by.
 *
 * A series index in key order files a key's events together: a group's
 * searches are a range a key a level (`levelCellQueries`), and hold its keys'
 * entries and no other's.
 *
 * A series index in time order files a tile's events together, in their keys'
 * order (#1710): a group's searches are a range a tile, from the first of its
 * keys through the last (`inTimeCellQueries`). The keys are ordered as the
 * index orders them — by the type of the row field it files by, each literal
 * read once, never by their text — and a range holds the entries of every key
 * between them, so the reader keeps the entries whose key is one of the
 * group's own ({@link KeyRun.holds}). A block of rows in their keys' order
 * under one group is such a run with nothing between: its ranges hold its own
 * entries alone.
 *
 * Such an index's last leading fields are where its keys stand: the rows a
 * group's keys nest under, which a reader knows by their keys' texts. Each is
 * given to the planner as the leading field it fills holds it
 * ({@link underOf}): the text read at the field's type, a String field's as
 * the text itself, and an Option's as the value it holds.
 *
 * @packageDocumentation
 */

import {
    SortedSet, StringType, compareFor, equalFor, fromEastTypeValue, parseFor, printFor, some,
    type ArrayType, type EastType, type EastTypeValue, type StructType, type ValueTypeOf,
} from "@elaraai/east";
import type { SeekQueryType } from "@elaraai/east-ui";
import {
    inTimeCellQueries, levelCellQueries,
    type RecordSliceChoiceType, type RecordSliceEntry, type RecordSliceIndexType, type RecordUnder, type TileRun,
} from "@elaraai/east-ui/internal";

/** One index of a record Slice's binding. */
type Index = ValueTypeOf<typeof RecordSliceIndexType>;
/** A record Slice's narrowing. */
type Where = ReadonlyMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>;

const stringEqual = equalFor(StringType);
const printString = printFor(StringType);

/** No rows a group's keys stand under. */
export const NO_UNDER: readonly string[] = [];

/**
 * Whether two groups' keys stand under the same rows: as many steps, each the same key's text.
 *
 * @param a - Where one stands, outermost first
 * @param b - Where the other stands
 * @returns Whether they stand under the same rows
 */
export function sameUnder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((step, i) => stringEqual(step, b[i]!));
}

/** A block of keys a series cell is read for (#1433): a block of the paged kind's resources by its place, or the events on none. */
export interface CellGroup {
    /** Its name among the groups a read asks for. */
    readonly id: string;
    /** Its keys, as `.east` literals of the index's key field, in order. */
    readonly literals: readonly string[];
    /** Where its keys stand (#1710): the keys' texts of the rows they nest under, outermost first; none under no row. */
    readonly under: readonly string[];
}

/** A group's keys as a series index in time order holds them (#1710). */
export interface KeyRun {
    /** The first of its keys in the index's order, as a `.east` literal. */
    readonly first: string;
    /** The last of them. */
    readonly last: string;
    /** Whether a key an entry names is one of the group's own: a range from the first through the last holds the keys between them too. */
    readonly holds: (key: unknown) => boolean;
}

/** A group as the series index that serves it reads it (#1710). */
export interface SeriesGroup extends CellGroup {
    /** The narrowing its cells are read under: the reader's, and, through an index in time order, the rows the group stands under. */
    readonly where: Where;
    /** Through an index in time order, its keys as the index holds them; `undefined` through one in key order. */
    readonly run: KeyRun | undefined;
}

/** A row field's values as a series index orders them: a literal read back, and two values' order. */
export interface KeyOrder {
    /** A `.east` literal read at the field's type; `undefined` for a text no value of it prints as. */
    readonly read: (literal: string) => { readonly key: unknown } | undefined;
    /** Two values' order, as East orders the field's type. */
    readonly compare: (a: unknown, b: unknown) => number;
}

/** A row field's type, as a kind's cells' type holds its rows: an Array of `{ key, row }`, at its record's key and row types. */
function rowFieldType(cellsType: EastTypeValue, field: string): EastType | undefined {
    const cells = fromEastTypeValue(cellsType) as ArrayType<StructType>;
    const row = (cells.value.fields as Record<string, EastType>)["row"];
    return row?.type === "Struct" ? (row.fields as Record<string, EastType>)[field] : undefined;
}

/** A key's text as a type holds it, as a `.east` literal: a String's as the text itself, any other's read back at the type. */
function literalAt(type: EastType, text: string): string | undefined {
    if (type.type === "String") return printString(text);
    return parseFor(type)(text).success ? text : undefined;
}

/**
 * A row a group's keys stand under, as a leading field of a kind's series
 * index in time order holds it (#1710): the `.east` literal of the row's key
 * at the field's type. A key's text is a String key itself, and any other key
 * as East prints it, so a String field holds the text and any other field the
 * key it reads back as; an Option field holds either as its value.
 *
 * @param cellsType - The kind's cells' type: an Array of `{ key, row }`, at its record's key and row types
 * @param text - The row's key's text
 * @returns The literal a leading field holds it by; `undefined` for a field the rows do not hold, or one that can hold no such key
 */
export function underOf(cellsType: EastTypeValue, text: string): RecordUnder {
    return (field) => {
        const type = rowFieldType(cellsType, field);
        if (type === undefined) return undefined;
        const own = literalAt(type, text);
        if (own !== undefined || type.type !== "Variant") return own;
        // An Option of what the row's key is: the key as its value.
        const cases = type.cases as Record<string, EastType>;
        const held = Object.keys(cases).length === 2 && cases["none"]?.type === "Null" ? cases["some"] : undefined;
        if (held === undefined) return undefined;
        if (held.type === "String") return printFor(type)(some(text) as never);
        const read = parseFor(held)(text);
        return read.success ? printFor(type)(some(read.value) as never) : undefined;
    };
}

/**
 * How a series index orders the keys it files by: by the type of the row
 * field it names, as the kind's cells' type holds it.
 *
 * @param cellsType - The kind's cells' type: an Array of `{ key, row }`, at its record's key and row types
 * @param field - The row field the index files by
 * @returns The field's order
 * @throws {Error} When the rows hold no such field
 */
export function keyOrderOf(cellsType: EastTypeValue, field: string): KeyOrder {
    const type = rowFieldType(cellsType, field);
    if (type === undefined) throw new Error(`A series index files its events by '${field}', and the kind's rows hold no such field`);
    const parse = parseFor(type);
    return {
        read: (literal) => {
            const read = parse(literal);
            return read.success ? { key: read.value } : undefined;
        },
        compare: compareFor(type) as (a: unknown, b: unknown) => number,
    };
}

/**
 * A group's keys as a series index in time order holds them (#1710): the
 * first and the last in the index's order, and the set of them — each literal
 * read once.
 *
 * @param order - The order of the field the index files by ({@link keyOrderOf})
 * @param literals - The group's keys, as `.east` literals of that field
 * @returns The run; `undefined` for a group of no key
 * @throws {Error} For a literal that is no value of the field
 */
export function keyRunOf(order: KeyOrder, literals: readonly string[]): KeyRun | undefined {
    const keys = literals.map((literal) => {
        const read = order.read(literal);
        if (read === undefined) throw new Error(`${literal} is no value of the field a series index files its events by`);
        return { literal, key: read.key };
    });
    if (keys.length === 0) return undefined;
    keys.sort((a, b) => order.compare(a.key, b.key));
    const own = new SortedSet(keys.map(({ key }) => key), order.compare);
    return { first: keys[0]!.literal, last: keys[keys.length - 1]!.literal, holds: (key) => own.has(key) };
}

/** The key a series index's entry is filed by: its key's `key`, in either order. */
export const entryKey = (entry: RecordSliceEntry): unknown => (entry.ik.value as { readonly key: unknown }).key;

/**
 * A group's searches over one level's run of tiles, through the series index
 * that serves it (#1433, #1710): a range a key, or, through an index in time
 * order, a range a tile from its first key through its last.
 *
 * @param series - The series index
 * @param group - The group, as that index reads it
 * @param run - The level and its tiles
 * @returns The searches
 * @throws {Error} As the planner refuses a cell it cannot plan (`levelCellQueries`, `inTimeCellQueries`)
 */
export function groupQueries(series: Index, group: SeriesGroup, run: TileRun): ValueTypeOf<typeof SeekQueryType>[] {
    return group.run === undefined
        ? levelCellQueries(series, group.where, run, group.literals).queries
        : inTimeCellQueries(series, group.where, run, group.run.first, group.run.last).queries;
}
