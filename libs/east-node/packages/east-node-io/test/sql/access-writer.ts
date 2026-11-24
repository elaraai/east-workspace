/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A writer of small Microsoft Access databases, for this package's tests.
 *
 * Access databases are read-only to East: the readers the Access functions run
 * on — mdb-reader under Node, access-parser under Python — read them and write
 * none. So a test's database is written here, once, and kept beside its tests
 * ({@link accessDatabase}).
 *
 * It writes the Jet 4 format (Access 2000 to 2003, `.mdb`) as far as both
 * readers read it, in pages of 4096 bytes:
 * - page 0, the database's definition: its format, then from 0x18 a block
 *   masked with RC4 under the format's fixed key, which holds its code page,
 *   its encoding key (none: no other page is encoded), its password (none) and
 *   when it was made;
 * - page 1, the usage maps: for each table, the pages its rows are on, and
 *   those with room for more;
 * - pages 2 and 3, the catalog (`MSysObjects`): each table's `Id` (its
 *   definition's page), `Name`, `Type` and `Flags`, itself among them. Both
 *   readers look for it on page 2;
 * - then each table: its definition (its columns), then its rows.
 *
 * Its subset of the format: Long Integer, Integer and Text columns, each of
 * which may be null, as Access marks every column; a page of rows a table; no
 * index, no long value (Memo, OLE Object), no encryption. Access itself keeps
 * indexes on its catalog, which neither reader reads. The layout is the one
 * mdbtools documents (its HACKING.md), which mdb-reader cites.
 *
 * @packageDocumentation
 */

/** A column's Access type: Long Integer (32 bits), Integer (16 bits) or Text. */
export type AccessColumnType = "long" | "integer" | "text";

/** A column of a table to write. */
export interface AccessColumn {
    /** Its name. */
    readonly name: string;
    /** Its type. */
    readonly type: AccessColumnType;
    /** A Text column's most characters, 1 to 255: 255 by default. */
    readonly length?: number;
}

/** A row's value for a column: a whole number for a Long Integer or an Integer, a string for Text, `null` for none. */
export type AccessValue = number | string | null;

/** A table to write: its name, its columns, and its rows, each a value per column. */
export interface AccessTable {
    /** Its name. */
    readonly name: string;
    /** Its columns, in order. */
    readonly columns: readonly AccessColumn[];
    /** Its rows, in order, each a value per column. */
    readonly rows: readonly (readonly AccessValue[])[];
}

/** Jet 4's page size, in bytes. */
const PAGE = 4096;

/** Each column type's code in a table's definition. */
const TYPE_CODE: Readonly<Record<AccessColumnType, number>> = { long: 0x04, integer: 0x03, text: 0x0a };

/** The fixed-length types' sizes, in bytes, and the values they hold. */
const FIXED = {
    long: { size: 4, least: -0x80000000, most: 0x7fffffff },
    integer: { size: 2, least: -0x8000, most: 0x7fff },
} as const;

/** A column's flag: its values are of a fixed length. */
const FIXED_LENGTH = 0x01;

/** A column's flag: it may be null. */
const NULLABLE = 0x02;

/** The number Jet 4 writes after a table definition's length, and again in each column's definition. */
const TABLE_NUMBER = 1625;

/** The general sort order (version 0, Jet 4's): the database's, and each Text column's. */
const GENERAL_SORT_ORDER = 1033;

/** The key that masks page 0's block from {@link MASKED_FROM}: 0x6b39dac7, little-endian. */
const HEADER_KEY = [0xc7, 0xda, 0x39, 0x6b] as const;

/** Where page 0's masked block starts. */
const MASKED_FROM = 0x18;

/** The masked block's length in Jet 4. */
const MASKED_LENGTH = 128;

/** A table definition's kind: a system table, the catalog. */
const SYSTEM_TABLE = 0x53;

/** A table definition's kind: a user's table. */
const USER_TABLE = 0x4e;

/** A table's `Type` in the catalog. */
const TABLE_OBJECT = 1;

/** The catalog's `Flags` of a system object. */
const SYSTEM_OBJECT = -0x80000000;

/** The catalog's name. */
const CATALOG_NAME = "MSysObjects";

/** The bytes of an inline usage map's bitmap: a bit a page, from page 0. */
const USAGE_MAP_BYTES = 64;

/** The days from Access's epoch, 30 December 1899, to the Unix epoch. */
const UNIX_EPOCH_DAYS = 25569;

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** The catalog's columns: what both readers read of it. */
const CATALOG: readonly AccessColumn[] = [
    { name: "Id", type: "long" },
    { name: "Name", type: "text" },
    { name: "Type", type: "integer" },
    { name: "Flags", type: "long" },
];

/** A column laid out in its table: its number, its size, and where a row holds its value. */
interface LaidColumn extends AccessColumn {
    /** Its number, from 0. */
    readonly number: number;
    /** Its size in bytes: a fixed-length value's, or a Text column's most. */
    readonly size: number;
    /** A fixed-length column's offset in a row's fixed part, else 0. */
    readonly fixedOffset: number;
    /** A Text column's index among the row's variable-length values, else 0. */
    readonly variableIndex: number;
}

/**
 * Lays out a table's columns: each fixed-length one after the last in a row's
 * fixed part, each Text one the next of its variable-length values.
 *
 * @param table - The table's name, for an error
 * @param columns - Its columns, in order
 * @returns Each column laid out
 * @throws {Error} When a Text column's length is not 1 to 255
 */
function layOut(table: string, columns: readonly AccessColumn[]): LaidColumn[] {
    let fixedOffset = 0;
    let variableIndex = 0;
    return columns.map((column, number) => {
        if (column.type === "text") {
            const length = column.length ?? 255;
            if (!Number.isInteger(length) || length < 1 || length > 255) {
                throw new Error(`Text column '${column.name}' of '${table}' holds 1 to 255 characters, not ${length}`);
            }
            return { ...column, number, size: 2 * length, fixedOffset: 0, variableIndex: variableIndex++ };
        }
        const { size } = FIXED[column.type];
        const laid = { ...column, number, size, fixedOffset, variableIndex: 0 };
        fixedOffset += size;
        return laid;
    });
}

/**
 * Masks bytes with RC4 under a key, as it unmasks them: page 0's block from
 * 0x18 is kept so.
 *
 * @param key - The key
 * @param bytes - The bytes
 * @returns The masked bytes
 */
function rc4(key: readonly number[], bytes: Uint8Array): Buffer {
    const s = Array.from({ length: 256 }, (_, i) => i);
    const swap = (a: number, b: number) => {
        const held = s[a]!;
        s[a] = s[b]!;
        s[b] = held;
    };
    for (let i = 0, j = 0; i < 256; i++) {
        j = (j + s[i]! + key[i % key.length]!) & 0xff;
        swap(i, j);
    }
    const out = Buffer.from(bytes);
    for (let k = 0, i = 0, j = 0; k < out.length; k++) {
        i = (i + 1) & 0xff;
        j = (j + s[i]!) & 0xff;
        swap(i, j);
        out[k] = out[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
    }
    return out;
}

/**
 * Writes page 0, the database's definition: Jet 4, made at `created`, with no
 * password and no encoding key.
 *
 * @param created - When the database says it was made
 * @returns The page
 */
function headerPage(created: Date): Buffer {
    const page = Buffer.alloc(PAGE);
    // The page's type (0), then 1, 0, 0; the engine's name, its NUL at 19; the format, Jet 4
    page[1] = 0x01;
    page.write("Standard Jet DB", 4, "latin1");
    page.writeUInt32LE(1, 0x14);
    const block = Buffer.alloc(MASKED_LENGTH);
    const at = (offset: number) => offset - MASKED_FROM;
    // The code page, Western European. The encoding key at 0x3e stays 0: no other page is encoded
    block.writeUInt16LE(1252, at(0x3c));
    // When it was made, in days since Access's epoch; the password is kept masked by its whole days, so none is the mask itself
    const made = created.getTime() / DAY_MS + UNIX_EPOCH_DAYS;
    const mask = Buffer.alloc(4);
    mask.writeInt32LE(Math.floor(made));
    for (let i = 0; i < 40; i++) block[at(0x42) + i] = mask[i % 4]!;
    // The sort order, its version (0) at 0x71
    block.writeUInt16LE(GENERAL_SORT_ORDER, at(0x6e));
    block.writeDoubleLE(made, at(0x72));
    rc4(HEADER_KEY, block).copy(page, MASKED_FROM);
    return page;
}

/**
 * A row's place, as a table definition points to its usage maps: its page and
 * its number on the page.
 *
 * @param page - The row's page
 * @param row - Its number on the page
 * @returns The place
 */
function pageRow(page: number, row: number): number {
    return page * 256 + row;
}

/**
 * Writes a table's definition page: its kind, how many rows it holds, where its
 * usage maps are, and its columns.
 *
 * @param table - The table's name, for an error
 * @param columns - Its columns, laid out
 * @param rows - How many rows it holds
 * @param kind - {@link SYSTEM_TABLE} or {@link USER_TABLE}
 * @param maps - Its usage maps' rows on page 1: its pages', then its pages with room's
 * @returns The page
 * @throws {Error} When its definition does not fit the page
 */
function tablePage(table: string, columns: readonly LaidColumn[], rows: number, kind: number, maps: readonly [number, number]): Buffer {
    const names = columns.map((column) => Buffer.from(column.name, "utf16le"));
    const length = 63 + 25 * columns.length + names.reduce((sum, name) => sum + 2 + name.length, 0);
    if (length > PAGE) throw new Error(`The definition of '${table}' takes ${length} bytes, more than a page`);
    const page = Buffer.alloc(PAGE);
    // The page's type (2), then 1 and "VC"; the next definition page stays 0: the definition fits this one
    page[0] = 0x02;
    page[1] = 0x01;
    page.write("VC", 2, "latin1");
    page.writeUInt32LE(length - 8, 8);
    page.writeUInt32LE(TABLE_NUMBER, 12);
    page.writeUInt32LE(rows, 16);
    // The next AutoNumber stays 0, and its flag is set, as Access sets it
    page[24] = 0x01;
    page[40] = kind;
    // The most columns a row holds, the variable-length ones, the columns; no logical index, no real index
    page.writeUInt16LE(columns.length, 41);
    page.writeUInt16LE(columns.filter((column) => column.type === "text").length, 43);
    page.writeUInt16LE(columns.length, 45);
    page.writeUInt32LE(pageRow(1, maps[0]), 55);
    page.writeUInt32LE(pageRow(1, maps[1]), 59);
    let at = 63;
    for (const column of columns) {
        page[at] = TYPE_CODE[column.type];
        page.writeUInt32LE(TABLE_NUMBER, at + 1);
        page.writeUInt16LE(column.number, at + 5);
        page.writeUInt16LE(column.variableIndex, at + 7);
        page.writeUInt16LE(column.number, at + 9);
        // A Text column's sort order, its version (0) at 14; its text is kept as UTF-16, with no compression flag at 16
        if (column.type === "text") page.writeUInt16LE(GENERAL_SORT_ORDER, at + 11);
        page[at + 15] = (column.type === "text" ? 0 : FIXED_LENGTH) | NULLABLE;
        page.writeUInt16LE(column.fixedOffset, at + 21);
        page.writeUInt16LE(column.size, at + 23);
        at += 25;
    }
    for (const name of names) {
        page.writeUInt16LE(name.length, at);
        name.copy(page, at + 2);
        at += 2 + name.length;
    }
    return page;
}

/**
 * Writes a row of a table: how many columns it has, its fixed-length values,
 * its Text values, where each of those starts and ends, and which values it
 * holds.
 *
 * @param table - The table's name, for an error
 * @param columns - Its columns, laid out
 * @param values - The row's values, a value per column
 * @returns The row's bytes
 * @throws {Error} When the row has not a value per column, or a value is not of its column's type or is too large for it
 */
function rowBytes(table: string, columns: readonly LaidColumn[], values: readonly AccessValue[]): Buffer {
    if (values.length !== columns.length) {
        throw new Error(`A row of '${table}' holds ${values.length} values for its ${columns.length} columns`);
    }
    const fixed = Buffer.alloc(columns.reduce((sum, column) => (column.type === "text" ? sum : sum + column.size), 0));
    const present = Buffer.alloc(Math.ceil(columns.length / 8));
    const texts: Buffer[] = [];
    const starts: number[] = [];
    // After the column count and the fixed part
    let at = 2 + fixed.length;
    columns.forEach((column, i) => {
        const value = values[i] ?? null;
        if (value !== null) present[i >> 3] = (present[i >> 3] ?? 0) | (1 << (i & 7));
        const wrong = () => new Error(`A row of '${table}' holds ${JSON.stringify(value)} for its ${column.type} column '${column.name}'`);
        if (column.type === "text") {
            starts.push(at);
            if (value === null) return;
            if (typeof value !== "string" || 2 * value.length > column.size) throw wrong();
            const text = Buffer.from(value, "utf16le");
            texts.push(text);
            at += text.length;
            return;
        }
        if (value === null) return;
        const { least, most } = FIXED[column.type];
        if (typeof value !== "number" || !Number.isInteger(value) || value < least || value > most) throw wrong();
        if (column.type === "long") fixed.writeInt32LE(value, column.fixedOffset);
        else fixed.writeInt16LE(value, column.fixedOffset);
    });
    const count = Buffer.alloc(2);
    count.writeUInt16LE(columns.length);
    if (starts.length === 0) return Buffer.concat([count, fixed, present]);
    // Where the Text values end, then where each starts, the last one's first, then how many there are
    const offsets = Buffer.alloc(2 * (starts.length + 2));
    offsets.writeUInt16LE(at, 0);
    starts.forEach((start, k) => offsets.writeUInt16LE(start, 2 * (starts.length - k)));
    offsets.writeUInt16LE(starts.length, offsets.length - 2);
    return Buffer.concat([count, fixed, ...texts, offsets, present]);
}

/**
 * Writes a data page: the page of its owner's definition, then its rows, the
 * first at the page's end.
 *
 * @param owner - The page of its table's definition, or 0 for page 1's usage maps
 * @param rows - Its rows
 * @returns The page, and how many bytes it has free
 * @throws {Error} When its rows do not fit the page
 */
function dataPage(owner: number, rows: readonly Buffer[]): { page: Buffer; free: number } {
    const free = PAGE - 14 - rows.reduce((sum, row) => sum + 2 + row.length, 0);
    if (free < 0) throw new Error(`${rows.length} rows take ${PAGE - free} bytes, more than a page`);
    const page = Buffer.alloc(PAGE);
    page[0] = 0x01;
    page[1] = 0x01;
    page.writeUInt16LE(free, 2);
    page.writeUInt32LE(owner, 4);
    page.writeUInt16LE(rows.length, 12);
    let end = PAGE;
    rows.forEach((row, i) => {
        end -= row.length;
        row.copy(page, end);
        page.writeUInt16LE(end, 14 + 2 * i);
    });
    return { page, free };
}

/**
 * Writes a usage map: an inline one (type 0), its bitmap a bit a page from page 0.
 *
 * @param pages - The pages it marks
 * @returns The map
 */
function usageMap(pages: readonly number[]): Buffer {
    const map = Buffer.alloc(5 + USAGE_MAP_BYTES);
    for (const page of pages) map[5 + (page >> 3)] = (map[5 + (page >> 3)] ?? 0) | (1 << (page & 7));
    return map;
}

/**
 * Writes an Access database in the Jet 4 format: the tables given, each its
 * definition and a page of rows, after the catalog that lists them.
 *
 * @param tables - Its tables
 * @param created - When it says it was made: a fixed instant writes the same file each time
 * @returns The database's bytes
 * @throws {Error} When two tables share a name (or one takes the catalog's), a table's definition or rows do not fit a page, or a row does not fit its columns
 *
 * @example
 * ```ts
 * const bytes = accessDatabase([{
 *     name: "item",
 *     columns: [{ name: "id", type: "long" }, { name: "label", type: "text", length: 50 }],
 *     rows: [[1, "First"], [2, null]],
 * }], new Date(Date.UTC(2026, 10, 24)));
 * writeFileSync("items.mdb", bytes);
 * ```
 */
export function accessDatabase(tables: readonly AccessTable[], created: Date): Buffer {
    const names = new Set([CATALOG_NAME]);
    for (const table of tables) {
        if (names.has(table.name)) throw new Error(`Two tables are named '${table.name}'`);
        names.add(table.name);
    }
    // Page 2 holds the catalog's definition and page 3 its rows; each table then takes the next two
    const definitionOf = (k: number) => 4 + 2 * k;
    const catalog = layOut(CATALOG_NAME, CATALOG);
    const listed: AccessValue[][] = [
        [2, CATALOG_NAME, TABLE_OBJECT, SYSTEM_OBJECT],
        ...tables.map((table, k): AccessValue[] => [definitionOf(k), table.name, TABLE_OBJECT, 0]),
    ];
    const laid = tables.map((table) => {
        const columns = layOut(table.name, table.columns);
        return { columns, rows: table.rows.map((values) => rowBytes(table.name, columns, values)) };
    });
    const catalogRows = dataPage(2, listed.map((values) => rowBytes(CATALOG_NAME, catalog, values)));
    const tableRows = laid.map(({ rows }, k) => dataPage(definitionOf(k), rows));
    // Two usage maps a table on page 1, the catalog's first: the page its rows are on, then the same where it has room
    const maps = [{ at: 3, rows: catalogRows }, ...tableRows.map((rows, k) => ({ at: definitionOf(k) + 1, rows }))]
        .flatMap(({ at, rows }) => [usageMap([at]), usageMap(rows.free > 0 ? [at] : [])]);
    return Buffer.concat([
        headerPage(created),
        dataPage(0, maps).page,
        tablePage(CATALOG_NAME, catalog, listed.length, SYSTEM_TABLE, [0, 1]),
        catalogRows.page,
        ...laid.flatMap(({ columns }, k) => [
            tablePage(tables[k]!.name, columns, tables[k]!.rows.length, USER_TABLE, [2 + 2 * k, 3 + 2 * k]),
            tableRows[k]!.page,
        ]),
    ]);
}
