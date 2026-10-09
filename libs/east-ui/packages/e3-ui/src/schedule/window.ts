/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The window reader (#1199, `Calendar Spec.md` decision 9 and §3.4, `Plan
 * Builder Spec.md` §9.11, PB54): an event kind's large record read a window
 * at a time, through its record indexes, never whole — the days in view
 * through an index on the days each event touches (`Schedule.days`), and the
 * backlog through an index on the rows with no start (`Schedule.unscheduled`).
 * The Calendar's windowed reads (#1156) and the Plan's are this one reader: a
 * kind's seams read through it when the kind is given `window` or
 * `backlogWindow`, and the record whole otherwise.
 *
 * - **A window** is a `Data.bindPaged(record, { index, join: true })` handle:
 *   its pages are the index's entries in the index's own order, each
 *   `{ ik, key, value, row }`, its `seek` the index's key search, and its
 *   revision the record's state, so a Save that moves the record moves the
 *   window, which reads again. Its type is checked at build
 *   ({@link checkIndexWindow}). Whether it joins each entry to its row can't
 *   be told from its type, so a read that meets an entry with no row refuses,
 *   naming `join: true`.
 * - **The days of `[from, to)`**: the midnight of the first day is sought in
 *   the index (a `range` from it), and the pages are read from the one holding
 *   that row — each page from its start to the next page's, at the reader's
 *   own page size, so the pages a pan read before are the runtime's again —
 *   until an entry filed under a day the window does not reach, or the
 *   index's end. An event filed under several of the days is kept once, by
 *   its key.
 * - **The backlog**: every page of the backlog index, from its start.
 * - **One event by its key** — the inspector's, a draft's original, a Save's
 *   entries read back and a conflict's — through a paged read of the record's
 *   own entries (`entries`, `Data.bindPaged(record)`): its key sought, then a
 *   one-row page at the row the search found ({@link scheduleEntryByKey}).
 *   The index windows can't be sought by the record's key, as their key leads
 *   with the index's, and a kind can't open a read of the record's own entries
 *   itself: a paged read is declared where it is bound, which is what lets a
 *   `ui()` task read it at all.
 * - **In flight**, the search or a page answers `none`, and so does the read:
 *   the reader keeps nothing between reads, and the read that asked is asked
 *   again when it lands.
 *
 * @packageDocumentation
 */

import {
    DateTimeType, DictType, East, Expr, IntegerType, NullType, OptionType, StringType, VariantType, isTypeEqual, none, printType, some, variant,
    type ArrayType, type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { resolveRowSource } from "@elaraai/east-ui/internal";

/**
 * How many index entries the reader asks for at a time: each read starts at a
 * whole multiple of it and ends at the next, so two windows that share a page
 * share its read.
 */
export const SCHEDULE_INDEX_PAGE = 256n;

/** An index window's entry, as the reader reads it: its index key, the row's key and the row, joined. */
type IndexEntry = StructType<{ ik: EastType; key: EastType; value: EastType; row: OptionType<EastType> }>;

/** An index window's handle, as the reader reads it: its pages and its key search. */
type IndexHandle = ExprType<StructType<{
    page: FunctionType<[IntegerType, IntegerType], OptionType<ArrayType<IndexEntry>>>;
    seek: OptionType<FunctionType<[typeof SeekQueryType], OptionType<typeof SeekRangeType>>>;
}>>;

/** Which of a kind's windows: the days in view, or the backlog. */
export type ScheduleWindowProp = "window" | "backlogWindow";

/** Whether a type is an Option, and of what. */
function optionOf(type: EastType): EastType | undefined {
    if (type.type !== "Variant") return undefined;
    const some = (type.cases as Record<string, EastType | undefined>)["some"];
    return some !== undefined && isTypeEqual(type, OptionType(some)) ? some : undefined;
}

/** A type as a refusal names it: an Option as an Option of what it holds. */
function typeText(type: EastType): string {
    const inner = optionOf(type);
    return inner === undefined ? printType(type) : `an Option of ${printType(inner)}`;
}

/** The index a window reads through, as its refusals name it. */
function indexWords(prop: ScheduleWindowProp): string {
    return prop === "window" ? "a day index keyed by Schedule.days" : "a backlog index keyed by Schedule.unscheduled";
}

/**
 * Checks a kind's `window` or `backlogWindow` at build: a paged read of an
 * index over the kind's own record, whose pages serve the index's entries —
 * `Array<{ ik, key, value, row: Option<R> }>`, `ik` the index's key (a
 * `DateTime` day for `window`, an `Option<DateTime>` due date for
 * `backlogWindow`), `key` the record's key and `row` its row.
 *
 * @param window - The window, as the author gave it
 * @param prop - Which window it is
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param ik - The index key the window's entries are filed under
 * @param where - The kind, as a refusal names it
 * @returns The window, as an East expression
 * @throws {Error} Naming the window, the index it reads through and what it serves instead
 */
export function checkIndexWindow(
    window: unknown, prop: ScheduleWindowProp, keyType: EastType, rowType: EastType, ik: EastType, where: string,
): ExprType<EastType> {
    const value = East.value(window as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(value as unknown as Expr) as EastType;
    const page = type.type === "Struct" ? (type.fields as Record<string, EastType>)["page"] : undefined;
    const served = page !== undefined && page.type === "Function" ? optionOf(page.output) : undefined;
    const element = served !== undefined && served.type === "Array" ? served.value as EastType : undefined;
    const fields = element !== undefined && element.type === "Struct" ? element.fields as Record<string, EastType> : undefined;
    const fits = fields !== undefined
        && fields["ik"] !== undefined && isTypeEqual(fields["ik"], ik)
        && fields["key"] !== undefined && isTypeEqual(fields["key"], keyType)
        && fields["value"] !== undefined
        && fields["row"] !== undefined && isTypeEqual(fields["row"], OptionType(rowType));
    if (!fits) {
        throw new Error(`${where}: \`${prop}\` reads the record through ${indexWords(prop)} — ` +
            `Data.bindPaged(record, { index, join: true }), each window an Array of { ik: ${typeText(ik)}, key, value, row: Option<${typeText(rowType)}> } — ` +
            `and this one serves ${served === undefined ? "no window of entries" : typeText(served)}`);
    }
    return value;
}

/**
 * The words a read refuses a window in when it meets an entry with no row:
 * the window reads the index alone, not each entry's row.
 *
 * @param where - The kind, as a refusal names it
 * @param prop - Which window it is
 * @returns The refusal
 */
export function joinRefusal(where: string, prop: ScheduleWindowProp): string {
    return `${where}: \`${prop}\` reads each event's row from the record through ${indexWords(prop)} — ` +
        "Data.bindPaged(record, { index, join: true }) — and this one reads the index alone: give it `join: true`";
}

/**
 * Reads the days of `[from, to)` through a kind's day index (see the module
 * docs): the rows filed under them, each once, by the record's key.
 *
 * @param window - The kind's `window`, checked ({@link checkIndexWindow})
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param where - The kind, as a refusal names it
 * @returns `(from, to)` → the rows, by key; `none` while the search or a page is in flight
 */
export function scheduleDayWindow(
    window: ExprType<EastType>, keyType: EastType, rowType: EastType, where: string,
): ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>> {
    const Held = DictType(keyType, rowType);
    const noRows = joinRefusal(where, "window");
    const noSeek = `${where}: \`window\` finds the first day in view by its index's key search — ` +
        "a paged read of the record's day index, Data.bindPaged(record, { index, join: true }) — and this one has none";
    return East.function([DateTimeType, DateTimeType], OptionType(Held), ($, from, to) => {
        const src = $.const(window) as unknown as IndexHandle;
        const size = $.const(SCHEDULE_INDEX_PAGE, IntegerType);
        const result = $.let(East.value(none, OptionType(Held)), OptionType(Held));
        // The midnight the first day in view is filed under.
        const first = $.let(East.DateTime.roundDownDay(from, 1n));
        $.match(src.seek, {
            none: ($2) => { $2.error(noSeek); },
            some: ($2, seek) => {
                // The rows from the first day's midnight on: a range open at its end.
                const query = $2.let(variant("range", { from: [East.print(first)], to: [] }), SeekQueryType);
                $2.match(seek(query), {
                    some: ($3, found) => {
                        const held = $3.let(new Map(), Held);
                        // From the start of the page the first day's first entry is in.
                        const offset = $3.let(found.row.subtract(found.row.remainder(size)), IntegerType);
                        const reading = $3.let(true);
                        const landed = $3.let(true);
                        $3.while(reading, ($4) => {
                            // To the next page's start: a page cut short is read on from where it stopped.
                            const limit = $4.let(size.subtract(offset.remainder(size)), IntegerType);
                            $4.match(src.page(offset, limit), {
                                none: ($5) => {
                                    $5.assign(landed, false);
                                    $5.assign(reading, false);
                                },
                                some: ($5, entries) => {
                                    // The index's end.
                                    $5.if(entries.size().equal(0n), ($6) => { $6.assign(reading, false); });
                                    $5.for(entries, ($6, entry, _i, label) => {
                                        // The day the entry is filed under.
                                        const day = $6.let(entry.ik as unknown as ExprType<DateTimeType>);
                                        // Past the last day in view: the window is read.
                                        $6.if(East.greaterEqual(day, to), ($7) => {
                                            $7.assign(reading, false);
                                            $7.break(label);
                                        });
                                        // An entry of the page before the first day is not in view.
                                        $6.if(East.greaterEqual(day, first), ($7) => {
                                            $7.match(entry.row, {
                                                none: ($8) => { $8.error(noRows); },
                                                // An event filed under several days, once.
                                                some: ($8, row) => {
                                                    $8.if(held.has(entry.key as never).not(), ($9) => { $9(held.insert(entry.key as never, row as never)); });
                                                },
                                            });
                                        });
                                    });
                                    $5.assign(offset, offset.add(entries.size()));
                                },
                            });
                        });
                        $3.if(landed, ($4) => { $4.assign(result, some(held)); });
                    },
                });
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>>;
}

/**
 * Reads a kind's backlog through its backlog index (see the module docs):
 * the rows the index files, each once, by the record's key.
 *
 * @param window - The kind's `backlogWindow`, checked ({@link checkIndexWindow})
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param where - The kind, as a refusal names it
 * @returns `()` → the rows, by key; `none` while a page is in flight
 */
export function scheduleBacklogWindow(
    window: ExprType<EastType>, keyType: EastType, rowType: EastType, where: string,
): ExprType<FunctionType<[], OptionType<DictType<EastType, EastType>>>> {
    const Held = DictType(keyType, rowType);
    const noRows = joinRefusal(where, "backlogWindow");
    return East.function([], OptionType(Held), ($) => {
        const src = $.const(window) as unknown as IndexHandle;
        const size = $.const(SCHEDULE_INDEX_PAGE, IntegerType);
        const result = $.let(East.value(none, OptionType(Held)), OptionType(Held));
        const held = $.let(new Map(), Held);
        const offset = $.let(0n, IntegerType);
        const reading = $.let(true);
        const landed = $.let(true);
        $.while(reading, ($2) => {
            const limit = $2.let(size.subtract(offset.remainder(size)), IntegerType);
            $2.match(src.page(offset, limit), {
                none: ($3) => {
                    $3.assign(landed, false);
                    $3.assign(reading, false);
                },
                some: ($3, entries) => {
                    $3.if(entries.size().equal(0n), ($4) => { $4.assign(reading, false); });
                    $3.for(entries, ($4, entry) => {
                        $4.match(entry.row, {
                            none: ($5) => { $5.error(noRows); },
                            some: ($5, row) => {
                                $5.if(held.has(entry.key as never).not(), ($6) => { $6(held.insert(entry.key as never, row as never)); });
                            },
                        });
                    });
                    $3.assign(offset, offset.add(entries.size()));
                },
            });
        });
        $.if(landed, ($2) => { $2.assign(result, some(held)); });
        return result;
    }) as unknown as ExprType<FunctionType<[], OptionType<DictType<EastType, EastType>>>>;
}

// ============================================================================
// One entry by its key (#1199)
// ============================================================================

/** A paged read of a record's own entries, as the reader reads it: its pages, its size and its key search. */
type EntriesHandle = ExprType<StructType<{
    page: FunctionType<[IntegerType, IntegerType], OptionType<DictType<EastType, EastType>>>;
    total: FunctionType<[], OptionType<IntegerType>>;
    seek: OptionType<FunctionType<[typeof SeekQueryType], OptionType<typeof SeekRangeType>>>;
}>>;

/**
 * Checks a paged read of a record's own entries at build (#1199): the record's
 * entries by key, `Data.bindPaged(record)`, which names the snapshot its reads
 * are at — what a kind given `window` reads one event by, and a paged resource
 * kind its resources.
 *
 * @param entries - The read, as the author gave it
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param where - What reads it, as a refusal names it: the option and its kind
 * @returns The read, as an East expression
 * @throws {Error} Naming what it serves instead: the entries whole, an index's window, another collection, or a read that names no snapshot
 */
export function checkEntries(entries: unknown, keyType: EastType, rowType: EastType, where: string): ExprType<EastType> {
    const resolved = resolveRowSource(entries, where);
    const wanted = DictType(keyType, rowType);
    if (resolved.kind !== "paged" || !isTypeEqual(resolved.collectionType, wanted)) {
        const serves = resolved.kind === "inline" ? `${typeText(resolved.collectionType)} whole`
            : resolved.kind === "ordered" ? `an index's window, ${typeText(resolved.collectionType)}`
                : typeText(resolved.collectionType);
        throw new Error(`${where} reads the record's own entries by key — Data.bindPaged(record), a window at a time of ${typeText(wanted)} — and this one serves ${serves}`);
    }
    if (!resolved.pinned) {
        throw new Error(`${where} reads the record's own entries at the snapshot every read of it is at — Data.bindPaged(record)'s handle, with its revision and refresh — and this one names no snapshot`);
    }
    return resolved.source as unknown as ExprType<EastType>;
}

/** A key's text: a String key as it is, any other key as East prints it. */
function keyTextOf(keyType: EastType): ExprType<FunctionType<[EastType], StringType>> {
    return (keyType.type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key))) as unknown as ExprType<FunctionType<[EastType], StringType>>;
}

/**
 * One entry of a record read by its key (#1199): its read still in flight, the
 * key the record does not hold, or the entry held — its row.
 *
 * @param rowType - The record's row type
 * @returns The variant
 */
export function ScheduleKeyReadType<R extends EastType>(rowType: R): VariantType<{ reading: NullType; absent: NullType; held: R }> {
    return VariantType({ reading: NullType, absent: NullType, held: rowType });
}

/**
 * Reads one entry of a record by its key through a paged read of the record's
 * own entries (#1199): the key sought — the `.east` literal of the key its text
 * names — then a one-row page at the row the search found.
 *
 * @param entries - The read, checked ({@link checkEntries})
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @returns `(id)` → the entry's row, held; `absent` for a key the record does not hold; `reading` while the search or the page is in flight
 */
export function scheduleEntryByKey(
    entries: ExprType<EastType>, keyType: EastType, rowType: EastType,
): ExprType<FunctionType<[StringType], VariantType<{ reading: NullType; absent: NullType; held: EastType }>>> {
    const Read = ScheduleKeyReadType(rowType);
    // A key from its text: a String key is its own text, any other key its `.east` printing, read back.
    const keyOf = (keyType.type === "String"
        ? East.function([StringType], StringType, (_$, id) => id)
        : East.function([StringType], keyType, (_$, id) => id.parse(keyType))) as unknown as ExprType<FunctionType<[StringType], EastType>>;
    // The `.east` literal a seek takes: a String key's is its text quoted; any other key's text is its literal already.
    const literalOf = keyType.type === "String"
        ? East.function([StringType], StringType, (_$, id) => East.print(id))
        : East.function([StringType], StringType, (_$, id) => id);
    return East.function([StringType], Read, ($, id) => {
        const handle = entries as unknown as EntriesHandle;
        const src = $.const(handle);
        const parse = $.const(keyOf);
        const literal = $.const(literalOf);
        const result = $.let(variant("reading", null), Read);
        $.match(src.seek, {
            some: ($2, seek) => {
                const query = $2.let(variant("key", literal(id)), SeekQueryType);
                $2.match(seek(query), {
                    some: ($3, found) => {
                        $3.if(found.found, ($4) => {
                            $4.match(src.page(found.row, 1n), {
                                some: ($5, page) => {
                                    $5.match(page.tryGet(parse(id)), {
                                        some: ($6, row) => { $6.assign(result, variant("held", row) as never); },
                                        none: ($6) => { $6.assign(result, variant("absent", null)); },
                                    });
                                },
                            });
                        }).else(($4) => { $4.assign(result, variant("absent", null)); });
                    },
                });
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType<[StringType], VariantType<{ reading: NullType; absent: NullType; held: EastType }>>>;
}

/**
 * Reads the largest key of a record through a paged read of its own entries
 * (#1199) — the last entry, as the read serves them in key order: how a new
 * Integer key is made past every key the record holds, which no window of it
 * says.
 *
 * @param entries - The read, checked ({@link checkEntries})
 * @param keyType - The record's key type
 * @returns `()` → `some(some(text))`, the largest key's text; `some(none)` for an empty record; `none` while a read is in flight
 */
export function scheduleLastKey(
    entries: ExprType<EastType>, keyType: EastType,
): ExprType<FunctionType<[], OptionType<OptionType<StringType>>>> {
    const Found = OptionType(OptionType(StringType));
    const textOf = keyTextOf(keyType);
    return East.function([], Found, ($) => {
        const handle = entries as unknown as EntriesHandle;
        const src = $.const(handle);
        const text = $.const(textOf);
        const result = $.let(none, Found);
        $.match(src.total(), {
            // The size is learned from a window: the first one's, read.
            none: ($2) => { $2(src.page(0n, 1n)); },
            some: ($2, total) => {
                $2.if(total.equal(0n), ($3) => { $3.assign(result, some(none)); }).else(($3) => {
                    $3.match(src.page(total.subtract(1n), 1n), {
                        some: ($4, page) => {
                            $4.for(page, ($5, _row, key) => { $5.assign(result, some(some(text(key)))); });
                        },
                    });
                });
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType<[], OptionType<OptionType<StringType>>>>;
}
