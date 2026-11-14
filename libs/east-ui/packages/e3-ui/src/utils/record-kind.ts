/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kind over the app's own record: what the Schematic's kinds (#1386) and the
 * Flowchart's (#1500) share. A kind maps the fields of the app's row to the
 * builder's roles and closes the record behind East functions over beast2
 * bytes — its stored rows a read holds, each one's roles beside its bytes; a
 * drafted row's roles; the fields an author's card sets, any field at any
 * depth; the shared editing session over the record with its patch door; the
 * record read by key; its history, its form, its own Details and the app's
 * check — so a builder's payload is one type whatever the rows hold, and its
 * renderer needs no row type.
 *
 * A kind's record is bound three ways, as each builder's binding check tells
 * them apart: `Record.bind(record)` with its patch door, editable — read
 * whole, or through its source of the builder's slice with `entries:
 * Data.bindPaged(record)` beside it; `Data.bind(record)`, read only and whole;
 * or `Data.bindPaged(record)`, read only, through its source. Each builder
 * keeps its own check and its own words; what this module holds is the same
 * for every builder.
 *
 * A kind's record may be keyed by any type a Dict takes. Its keys travel as
 * text, a String key as itself and any other as East prints it, so the wire is
 * one type whatever the key; an accessor, a kind's roles and the app's check
 * hear each key parsed back at the record's key type, and its session writes
 * a Save at it.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DictType, East, EastTypeType, Expr, FunctionType, IntegerType, OptionType, StringType, StructType, TypeMismatchError,
    isSubtype, isTypeEqual, none, some, toEastTypeValue, variant,
    type EastType, type ExprType, type NullType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import type { UIComponentType } from "@elaraai/east-ui";
import {
    EditingReadinessType, EditingType, Fields, FieldSpecType, RecordSliceBindType, RecordSliceReadType, recordSliceReadPlatform,
    type FieldHints, type RecordSliceConfigType, type RecordSliceStateType,
} from "@elaraai/east-ui/internal";
import { scheduleAccessor } from "../schedule/accessor.js";
import { fieldOf, fieldSetters } from "../schedule/fields.js";
import { scheduleEntriesSeam, scheduleRecordSession } from "../schedule/session.js";
import { ScheduleEntriesType, ScheduleFieldWriteType, ScheduleReadyEntryType } from "../schedule/types.js";
import { keyOfText, keyTextOf, optionOf, scheduleEntryByKey, scheduleLastKey, typeText } from "../schedule/window.js";
import { RowInspectorType, rowInspector } from "./row-inspector.js";

// ============================================================================
// The wire
// ============================================================================

/** A record's commits, newest first, as its handle reads them. */
export const KindHistoryType = FunctionType([], OptionType(ArrayType(RecordCommitInfoType)));

/** Type representing {@link KindHistoryType}. */
export type KindHistoryType = typeof KindHistoryType;

/** The author's check over drafted entries, one result each. */
export const KindReadyType = FunctionType([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType));

/** Type representing {@link KindReadyType}. */
export type KindReadyType = typeof KindReadyType;

/**
 * What every kind over the app's record carries: how the record is read and
 * written, and the inspector's form.
 *
 * @property editable - Whether the record is bound with its patch door: what its gestures, drops and edits write
 * @property editing - The shared session over the record, with its patch door; `none` for a record bound read only
 * @property entries - The record read by key, for a record read through its source or bound with `Data.bindPaged`; `none` for one read whole
 * @property history - The record's commits, newest first; `none` for a record bound with `Data.bind` or `Data.bindPaged`
 * @property fields - The inspector's form over the fields no role writes (`Fields`) — and over a Schematic item's centre and box and a zone's box, which a hint holds to their bounds (#1585)
 * @property inspector - The kind's own Details in place of its form, over bytes
 * @property ready - The app's check on drafted rows, one result each
 * @property set - The row with each field write applied in order — a field at any depth, its value as bytes at the field's type — and every other field as it was: what an author's card dropped on a row sets (#1390); `none` for a write naming no field of the row
 * @property rowType - The record's row type
 */
export const KindSideFields = {
    editable: BooleanType,
    editing: OptionType(EditingType),
    entries: OptionType(ScheduleEntriesType),
    history: OptionType(KindHistoryType),
    fields: ArrayType(FieldSpecType),
    inspector: OptionType(RowInspectorType),
    ready: OptionType(KindReadyType),
    set: FunctionType([BlobType, ArrayType(ScheduleFieldWriteType)], OptionType(BlobType)),
    rowType: EastTypeType,
} as const;

// ============================================================================
// The binding
// ============================================================================

/** A kind's record, bound: how, its handle, its key type and its row type. */
export interface KindBinding {
    /** `record`: `Record.bind` with its patch door, editable; `data`: `Data.bind`, read whole; `paged`: `Data.bindPaged`, read through a source. */
    readonly form: "record" | "data" | "paged";
    /** The binding's handle. */
    readonly handle: ExprType<EastType>;
    /** The record's key type: what its accessors and the app's check hear a key at, and what its session writes a Save at. */
    readonly keyType: EastType;
    /** The record's row type. */
    readonly rowType: StructType;
}

/**
 * An accessor of a row and its key, the key at the record's key type: what a
 * computed role is.
 *
 * @typeParam R - The record's row type
 * @typeParam T - The type it returns
 * @typeParam K - The record's key type
 */
export type KindAccessor<R extends EastType, T extends EastType, K extends EastType = StringType> =
    (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<T>;

/** A kind's own Details: an East function over the row and its writer, as the Sheet's are. */
export type KindRowInspector<R extends StructType> = SubtypeExprOrValue<FunctionType<[R, FunctionType<[R], NullType>], UIComponentType>>;

// ============================================================================
// The reads
// ============================================================================

/** A kind's rows, by key at the record's key type: what a read of it gives; `none` while it is in flight. */
export type KindRowsRead = ExprType<FunctionType<[], OptionType<DictType<EastType, EastType>>>>;

/** A kind's roles, from a row and its key at the record's key type. */
type KindRolesOf = ExprType<FunctionType<[EastType, EastType], EastType>>;

/**
 * A kind's record read whole: its binding's `read()` — `Record.bind`'s or
 * `Data.bind`'s — by key.
 *
 * @param handle - The record's binding
 * @param keyType - Its key type
 * @param rowType - Its row type
 * @returns `()` → the record's rows, by key
 */
export function kindWholeRows(handle: ExprType<EastType>, keyType: EastType, rowType: StructType): KindRowsRead {
    const Held = DictType(keyType, rowType);
    const read = (handle as unknown as { read: () => ExprType<DictType<EastType, StructType>> }).read;
    return East.function([], OptionType(Held), (_$) => East.value(some(read()) as never, OptionType(Held))) as unknown as KindRowsRead;
}

/**
 * A kind's narrowing read complete through its source of the builder's slice
 * — the record slice's `PagedScan`, over `recordSliceReadPlatform` — answering
 * `none` while a search or a page is in flight.
 *
 * Through its source a kind reads what its narrowing holds and nothing else:
 * the source's choices, each as the rail holds it, with its page's scope
 * (#1621). Read with `every`, it reads every row through its source instead —
 * every row its page's scope holds, which no choice changes, on a scoped page —
 * and never the viewer's choices, so a choice reads none of its rows again: the
 * renderer draws the rows the choices leave out as context, from the source's
 * shown keys. An entry's row is its `row` — the source joins it — or its
 * `value`, for an index that carries the whole row.
 *
 * @param part - The kind's source of the slice, bound once in the builder's payload (`recordSources(…).bind($)`)
 * @param source - The source's name
 * @param keyType - The kind's record's key type
 * @param rowType - The kind's record's row type
 * @param where - The kind, as a refusal names it
 * @param every - Whether it reads every row — every row its page's scope holds (#1621) — the viewer's choices read nowhere: what they leave out draws as context
 * @param remedy - How the refusal of a source over another record names the source to give
 * @returns `()` → the rows the narrowing holds — or every row — by key; `none` while a search or a page is in flight
 * @throws {Error} When the source narrows another record — its entries keyed or holding rows of other types — or reads
 *   neither its rows nor an index carrying them
 */
export function kindSourceRows(part: ExprType<StructType>, source: string, keyType: EastType, rowType: StructType, where: string, every: boolean,
    remedy: string): KindRowsRead {
    const type = Expr.type(part as unknown as Expr) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : {};
    const data = fields["data"];
    const page = fields["pageWhere"];
    const output = page?.type === "Function" ? page.output : undefined;
    const collection = output === undefined ? undefined : optionOf(output);
    const entry = collection?.type === "Array" ? collection.value as EastType : undefined;
    const entryFields = entry?.type === "Struct" ? entry.fields as Record<string, EastType> : undefined;
    const keyed = entryFields?.["key"] !== undefined && isTypeEqual(entryFields["key"], keyType);
    // An entry's row: its `row`, which a joined read fills, or its `value`, when the index carries the whole row.
    const joined = entryFields?.["row"] !== undefined && isTypeEqual(entryFields["row"], OptionType(rowType));
    const carried = entryFields?.["value"] !== undefined && isTypeEqual(entryFields["value"], rowType);
    const pages = page?.type === "Function" && page.inputs.length === 3 && isTypeEqual(page.inputs[0]!, RecordSliceReadType)
        && isTypeEqual(page.inputs[1]!, IntegerType) && isTypeEqual(page.inputs[2]!, IntegerType);
    const identified = data?.type === "Struct" && data.fields["id"] !== undefined && isTypeEqual(data.fields["id"], StringType)
        && data.fields["revision"] !== undefined && data.fields["revision"].type === "Function";
    const sliced = Object.entries(RecordSliceBindType.fields).every(([name, expected]) => fields[name] !== undefined && isSubtype(fields[name]!, expected));
    if (!pages || !keyed || !(joined || carried) || !identified || !sliced) {
        throw new Error(`${where}: the slice's source "${source}" narrows another record — ${remedy}: ` +
            `Data.bindPaged(record, { indexes }), its rows joined or carried by its indexes`);
    }
    const Held = DictType(keyType, rowType);
    const Entries = collection as ArrayType<StructType<{ key: EastType; row: OptionType<EastType>; value: EastType }>>;
    const noRows = `${where}: the slice's source "${source}" reads no rows — bind it with Data.bindPaged(record, { indexes, join: true })`;
    return East.function([], OptionType(Held), ($) => {
        // The source as the payload bound it, its members read here: the read captures the source alone.
        const bound = $.const(part as unknown as ExprType<StructType<{
            config: RecordSliceConfigType;
            read: FunctionType<[], RecordSliceStateType>;
            countWhere: FunctionType<[typeof RecordSliceReadType], OptionType<IntegerType>>;
            pageWhere: FunctionType<[typeof RecordSliceReadType, IntegerType, IntegerType], OptionType<typeof Entries>>;
            data: StructType<{ id: StringType; revision: FunctionType<[], OptionType<StringType>> }>;
        }>>);
        const countWhere = $.const(bound.countWhere);
        const pageWhere = $.const(bound.pageWhere);
        const id = $.const(bound.data.id);
        const revision = $.const(bound.data.revision);
        // The read: with `every`, the page's scope alone (#1621) — every row, on a page with none — the source's state
        // read nowhere, so a choice reads nothing again and the renderer dims what it leaves out; else the rail's, each
        // of the source's choices with the scope. Never a read by area.
        let taken: ExprType<typeof RecordSliceReadType>;
        if (every) {
            const config = $.const(bound.config);
            taken = $.let({ where: config.scope, area: none }, RecordSliceReadType);
        } else {
            const read = $.const(bound.read);
            const state = $.const(read());
            taken = $.let({ where: state.where, area: none }, RecordSliceReadType);
        }
        const result = $.let(none, OptionType(Held));
        $.match(recordSliceReadPlatform([Entries], id, revision, countWhere, pageWhere, taken), {
            some: ($2, entries) => {
                const held = $2.let(new Map(), Held);
                $2.for(entries, ($3, e) => {
                    if (joined) {
                        $3.match(e.row, {
                            some: ($4, row) => { $4(held.insert(e.key as never, row as never)); },
                            none: ($4) => {
                                if (carried) $4(held.insert(e.key as never, e.value as never));
                                else $4.error(noRows);
                            },
                        });
                    } else {
                        $3(held.insert(e.key as never, e.value as never));
                    }
                });
                $2.assign(result, some(held));
            },
        });
        return result;
    }) as unknown as KindRowsRead;
}

// ============================================================================
// The roles
// ============================================================================

/**
 * A field's type by name, refused naming the role when the row lacks it.
 *
 * @param rowType - The kind's row type
 * @param where - The kind, as a refusal names it
 * @returns `(role, name)` → the field's type
 */
export function fieldTypeOf(rowType: StructType, where: string) {
    const fields = rowType.fields as Record<string, EastType>;
    return (role: string, name: string): EastType => {
        const type = fields[name];
        if (type === undefined) throw new Error(`${where}: \`${role}\` names "${name}", a field the row does not have (${Object.keys(fields).join(", ")})`);
        return type;
    };
}

/**
 * A role naming a field of one type: the field's name, refused naming the
 * role, the field and its type.
 *
 * @param rowType - The kind's row type
 * @param where - The kind, as a refusal names it
 * @returns `(role, name, type, what)` → the field's name; `undefined` for a role not given
 */
export function roleField(rowType: StructType, where: string) {
    const typeOf = fieldTypeOf(rowType, where);
    return (role: string, name: string | undefined, type: EastType, what: string): string | undefined => {
        if (name === undefined) return undefined;
        const held = typeOf(role, name);
        if (!isTypeEqual(held, type)) throw new Error(`${where}: \`${role}\` names ${what} — "${name}" holds ${typeText(held)}`);
        return name;
    };
}

/**
 * An accessor role, reified once and held to the type it returns, naming the
 * role and what it returns.
 *
 * @typeParam T - The type it returns
 * @param keyType - The kind's key type: the key the accessor hears
 * @param rowType - The kind's row type
 * @param where - The kind, as a refusal names it
 * @param role - The role, as the refusal names it
 * @param out - The type it returns
 * @param what - What it returns, as the refusal says it
 * @param fn - What the kind was given
 * @returns The accessor, reified; `undefined` when not given
 * @throws {Error} When it is no function, or returns another type
 */
export function accessorRole<T extends EastType>(keyType: EastType, rowType: StructType, where: string, role: string, out: T, what: string, fn: unknown) {
    if (fn === undefined) return undefined;
    if (typeof fn !== "function") throw new Error(`${where}: \`${role}\` is an accessor, (row, key) => ${what}`);
    return scheduleAccessor(rowType, keyType, out, fn as (row: ExprType<EastType>, key: ExprType<EastType>) => SubtypeExprOrValue<T>,
        (returns) => `${where}: \`${role}\` returns ${what} — and this one returns ${returns}`);
}

/**
 * A new row's key, built from its row by the app (#1549): what a kind's `key`
 * takes — `(move) => ({ from: move.from, to: move.to })`.
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 */
export type KindKeyBuilder<R extends EastType, K extends EastType> = (row: ExprType<R>) => SubtypeExprOrValue<K>;

/**
 * A kind's `key`, reified once and held to the record's key type (#1549): on
 * the wire, a new row's key's text from the row's bytes — a String key as
 * itself, any other as East prints it — which the renderer makes a new row
 * under, and moves the row to as an edit changes what it reads.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param where - The kind, as a refusal names it
 * @param noun - A row of the kind, as the refusal names it (`a transition`)
 * @param fn - What the kind was given
 * @returns `(bytes)` → the key's text; `undefined` when not given
 * @throws {Error} When it is no function, or builds a key of another type than the record's, naming both
 */
export function keyBuilderOf(keyType: EastType, rowType: StructType, where: string, noun: string, fn: unknown): ExprType<FunctionType<[BlobType], StringType>> | undefined {
    if (fn === undefined) return undefined;
    if (typeof fn !== "function") throw new Error(`${where}: \`key\` builds ${noun}'s key from its row, (row) => …`);
    const author = fn as (row: ExprType<EastType>) => SubtypeExprOrValue<EastType>;
    let built: ExprType<FunctionType<[EastType], EastType>>;
    try {
        built = East.function([rowType], keyType, (_$, row) => author(row)) as unknown as ExprType<FunctionType<[EastType], EastType>>;
    } catch (err) {
        if (!(err instanceof TypeMismatchError)) throw err;
        // What it builds, as East infers it from its own body.
        const inferred = East.function([rowType], undefined, (_$, row) => author(row) as ExprType<EastType>);
        const builds = (Expr.type(inferred as unknown as Expr) as FunctionType).output as EastType;
        throw new Error(`${where}: \`key\` builds ${noun}'s key, of the record's key type ${typeText(keyType)} — and this one builds ${typeText(builds)}`);
    }
    const textOf = keyTextOf(keyType);
    return East.function([BlobType], StringType, ($, bytes) => {
        const build = $.const(built);
        const text = $.const(textOf);
        return text(build(bytes.decodeBeast(rowType, "v2") as never));
    }) as unknown as ExprType<FunctionType<[BlobType], StringType>>;
}

/**
 * Refuses an editable kind of rows whose key is never typed — a Flowchart's
 * transitions, a Schematic's links and nets — keyed by neither String nor
 * Integer and given no `key` (#1549): a String key is made up and an Integer
 * one counted on, and any other only `key` can build.
 *
 * @param bound - The kind's binding
 * @param keyBuilt - Its `key`, reified; `undefined` for none
 * @param where - The kind, as a refusal names it
 * @param noun - Its rows, as the refusal names them (`transitions`)
 * @param made - What makes a new row of the kind, as the refusal says it (`Connect makes one`)
 * @throws {Error} For an editable kind keyed by another type than String or Integer, given no `key`
 */
export function checkMadeKeys(bound: KindBinding, keyBuilt: unknown, where: string, noun: string, made: string): void {
    const keyType = bound.keyType;
    if (bound.form !== "record" || keyBuilt !== undefined || keyType.type === "String" || keyType.type === "Integer") return;
    throw new Error(`${where}: the ${noun} are keyed by ${typeText(keyType)}, and ${made} with no key typed — give \`key\`, building one's key from its row, ` +
        "or key them by String or Integer");
}

/**
 * A row of the record's type, field by field: each field `set` names from it,
 * every other from `source`.
 *
 * @param rowType - The record's row type
 * @param source - The row, or a card's values, the other fields are read from
 * @param set - The fields written, by name
 * @returns The row
 */
export function rowWith(rowType: StructType, source: unknown, set: Readonly<Record<string, unknown>>): ExprType<EastType> {
    return East.value(Object.fromEntries(Object.keys(rowType.fields).map((f) => [f, set[f] ?? fieldOf(source, f)])) as never, rowType) as ExprType<EastType>;
}

/**
 * The row's fields less those its roles write on a drop: what a card's values
 * give.
 *
 * @param rowType - The record's row type
 * @param placed - The fields a drop writes
 * @returns The values' type
 */
export function valuesTypeOf(rowType: StructType, placed: readonly string[]): StructType {
    return StructType(Object.entries(rowType.fields as Record<string, EastType>).filter(([name]) => !placed.includes(name)));
}

/**
 * An accessor's value for a row, bound in the block; `otherwise` for a kind
 * with no such accessor.
 *
 * @typeParam T - The type the accessor returns
 * @param $ - The block
 * @param fn - The accessor, reified; `undefined` for none
 * @param row - The row
 * @param key - Its key
 * @param wrap - What the value becomes
 * @param otherwise - The value without the accessor
 * @returns The value
 */
export function called<T extends EastType>(
    $: { const: (value: unknown) => unknown }, fn: ExprType<FunctionType<[EastType, EastType], T>> | undefined, row: unknown, key: unknown,
    wrap: (value: ExprType<T>) => unknown, otherwise: unknown,
): unknown {
    if (fn === undefined) return otherwise;
    const bound = $.const(fn) as (row: unknown, key: unknown) => ExprType<T>;
    return wrap(bound(row, key));
}

// ============================================================================
// The rows
// ============================================================================

/**
 * A kind's stored rows a read holds, by key: each one's roles, read in the
 * pass that reads the row, beside its bytes. The renderer puts its drafts in
 * place itself.
 *
 * @param read - The kind's read: whole, or through its source
 * @param keyType - The record's key type: the rows' roles hear each key at it, and the wire holds each as its text
 * @param rolesOf - A row's roles, from it and its key
 * @param EntryType - A stored row's type: its roles beside its bytes
 * @returns `()` → the rows, by their keys' text; `none` while the read is in flight
 */
export function storedRows(read: KindRowsRead, keyType: EastType, rolesOf: KindRolesOf, EntryType: StructType) {
    const Rows = DictType(StringType, EntryType);
    const textOf = keyTextOf(keyType);
    return East.function([], OptionType(Rows), ($) => {
        const readRows = $.const(read);
        const roles = $.const(rolesOf);
        const text = $.const(textOf);
        const result = $.let(East.value(none, OptionType(Rows)), OptionType(Rows));
        $.match(readRows(), {
            some: ($2, held) => {
                const out = $2.let(new Map(), Rows);
                $2.for(held, ($3, row, key) => {
                    $3(out.insert(text(key), East.value({ roles: roles(row as never, key), row: East.Blob.encodeBeast(row as ExprType<EastType>, "v2") } as never, EntryType)));
                });
                $2.assign(result, some(out));
            },
        });
        return result;
    });
}

/**
 * The rows a reader read of a record by area or by key, made its stored rows
 * (#1393): each row's roles, read in the pass that reads it, beside its bytes,
 * as `rows` gives them — from the rows as beast2 bytes of an `Array` of
 * `{ key, row }` at the record's row type, each key its text, which the
 * reader encodes from what it read.
 *
 * @param keyType - The record's key type: each key's text is parsed back at it for the row's roles
 * @param rowType - The record's row type
 * @param rolesOf - A row's roles, from it and its key
 * @param EntryType - A stored row's type: its roles beside its bytes
 * @returns `(bytes)` → the rows, by their keys' text
 */
export function rowsReadOf(keyType: EastType, rowType: StructType, rolesOf: KindRolesOf, EntryType: StructType) {
    const Read = ArrayType(StructType({ key: StringType, row: rowType }));
    const Rows = DictType(StringType, EntryType);
    const keyOf = keyOfText(keyType);
    return East.function([BlobType], Rows, ($, bytes) => {
        const roles = $.const(rolesOf);
        const parse = $.const(keyOf);
        const read = $.const(bytes.decodeBeast(Read, "v2"));
        const out = $.let(new Map(), Rows);
        $.for(read, ($2, entry) => {
            $2(out.insert(entry.key, East.value({ roles: roles(entry.row as never, parse(entry.key)), row: East.Blob.encodeBeast(entry.row as ExprType<EastType>, "v2") } as never, EntryType)));
        });
        return out;
    });
}

/**
 * A drafted row's roles, from its bytes and its key's text: what `rows` gives
 * a stored one.
 *
 * @param keyType - The record's key type: the key's text is parsed back at it for the row's roles
 * @param rowType - The record's row type
 * @param rolesOf - A row's roles, from it and its key
 * @param RolesType - The roles' type
 * @returns `(bytes, key)` → the roles
 */
export function readOf(keyType: EastType, rowType: StructType, rolesOf: KindRolesOf, RolesType: StructType) {
    const keyOf = keyOfText(keyType);
    return East.function([BlobType, StringType], RolesType, ($, bytes, id) => {
        const roles = $.const(rolesOf);
        const parse = $.const(keyOf);
        return roles(bytes.decodeBeast(rowType, "v2") as never, parse(id)) as never;
    });
}

/**
 * The app's check over drafted rows, one result each; a check that throws
 * refuses its own row alone.
 *
 * @param keyType - The record's key type: each drafted row's key is parsed back at it for the check
 * @param rowType - The record's row type
 * @param ready - The app's check over a row and its key
 * @returns The check over bytes; `undefined` for none
 */
export function readyOf(keyType: EastType, rowType: StructType, ready: ((row: ExprType<StructType>, key: ExprType<EastType>) => unknown) | undefined) {
    if (ready === undefined) return undefined;
    const author = East.function([rowType, keyType], EditingReadinessType, ($, row, key) =>
        $.const(ready(row, key) as SubtypeExprOrValue<typeof EditingReadinessType>, EditingReadinessType));
    const keyOf = keyOfText(keyType);
    return East.function([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType), ($, batch) => {
        const check = $.const(author);
        const parse = $.const(keyOf);
        return batch.map(($2, item) => {
            const result = $2.let(variant("ready", null), EditingReadinessType);
            $2.try(($3) => {
                $3.assign(result, check(item.entry.decodeBeast(rowType, "v2"), parse(item.id)));
            }).catch(($3, message) => {
                $3.assign(result, variant("invalid", [{ field: "", message: East.str`Readiness check failed: ${message}` }]));
            });
            return result;
        });
    });
}

/**
 * The row with each of a card's field writes applied in order, and every other
 * field as it was (#1390): what an author's card dropped on a row sets — the
 * fields its patch sets, each a field at any depth, its value as bytes at the
 * field's type — through the setter Schedule's kinds write an inspector's edit
 * with (`fieldSetters`).
 *
 * @param rowType - The record's row type
 * @returns `(bytes, writes)` → the row written; `none` when a write names no field of the row
 */
export function rowSetter(rowType: StructType) {
    const setters = fieldSetters(rowType);
    return East.function([BlobType, ArrayType(ScheduleFieldWriteType)], OptionType(BlobType), ($, bytes, writes) => {
        // Each setter's path as East holds it: a field is named by its steps, never by text a dotted name could mimic.
        const fns = setters.map((setter) => ({ path: $.const([...setter.path], ArrayType(StringType)), set: $.const(setter.set) }));
        const row = $.let(bytes.decodeBeast(rowType, "v2") as ExprType<EastType>, rowType);
        const named = $.let(true);
        $.for(writes, ($2, write) => {
            const found = $2.let(false);
            for (const fn of fns) {
                $2.if(East.equal(write.path, fn.path), ($3) => {
                    $3.assign(row, fn.set(row, write.value) as never);
                    $3.assign(found, true);
                });
            }
            $2.if(found.not(), ($3) => { $3.assign(named, false); });
        });
        return named.ifElse(
            (_$2) => East.value(some(East.Blob.encodeBeast(row, "v2")), OptionType(BlobType)),
            (_$2) => East.value(none, OptionType(BlobType)),
        );
    });
}

// ============================================================================
// The record's side
// ============================================================================

/**
 * What every kind declares beside its roles, each typed over the record's
 * row and its key, as Schedule's kinds' are (#1391).
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 */
export interface RecordSide<R extends StructType = StructType, K extends EastType = StringType> {
    /** A paged read of the record's own entries, for an editable record read through its source. */
    entries?: unknown;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** The app's check on a drafted row, over the row and its key: a refusal holds Save, naming the row and its field. */
    ready?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<typeof EditingReadinessType>;
    /** The kind's own Details, in place of its form: an East function over the row and its writer. */
    inspector?: KindRowInspector<R>;
}

/**
 * A record's side of a kind on the wire ({@link KindSideFields}): whether it
 * is editable, its session and its read by key, its history, its form, its
 * own Details, the app's check, and the setter an author's card writes its
 * fields through.
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 * @param bound - The record's binding
 * @param entries - Its `entries`, checked
 * @param byKey - The paged read its rows are read by key through, if any
 * @param config - Its form's hints, its check and its own Details
 * @param omitted - The fields its form leaves out: those its roles write, but any a hint holds to its bounds (#1585)
 * @param where - The kind, as a refusal names it
 * @returns The fields every kind carries
 * @throws {Error} As `Fields.specs`, `rowInspector` and the patch door's check refuse
 */
export function recordSide<R extends StructType, K extends EastType>(bound: KindBinding, entries: ExprType<EastType> | undefined, byKey: ExprType<EastType> | undefined,
    config: RecordSide<R, K>, omitted: readonly (string | undefined)[], where: string): Record<string, unknown> {
    const rowType = bound.rowType;
    const form = Fields.specs(rowType, (config.fields ?? {}) as never,
        [...new Set(omitted.filter((name): name is string => name !== undefined))] as never);
    const inspector = config.inspector === undefined ? undefined : rowInspector(config.inspector, rowType,
        `${where}: \`inspector\` is the kind's own Details — an East.function over the row and its writer: ` +
        "East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …), RowType the record's row");
    // Typed over the kind's row and key, as its author wrote it: called over the row the check decodes and its key, read back.
    const ready = readyOf(bound.keyType, rowType, config.ready as never);
    let editing: unknown = none;
    let seam: unknown;
    let history: unknown = none;
    if (bound.form === "record") {
        // The shared session over the record (Schedule's `session.ts`): whole-entry drafts, keyed batches, Save through
        // its patch door at the record's key type — its base the record's snapshot, or, read through a source, its revision.
        const session = scheduleRecordSession(bound.handle, bound.keyType, rowType, byKey === undefined ? undefined : entries);
        const built = session.build();
        editing = some(built.editing);
        seam = built.entries;
        history = some(session.history);
    } else if (byKey !== undefined) {
        // Read only through `Data.bindPaged`: the record read by key through that binding itself.
        seam = scheduleEntriesSeam(byKey, scheduleEntryByKey(byKey, bound.keyType, rowType), scheduleLastKey(byKey, bound.keyType));
    }
    return {
        editable: bound.form === "record",
        editing,
        entries: seam ?? East.value(none, OptionType(ScheduleEntriesType)),
        history,
        fields: East.value(form, ArrayType(FieldSpecType)),
        inspector: inspector === undefined ? East.value(none, OptionType(RowInspectorType)) : some(inspector),
        ready: ready === undefined ? none : some(ready),
        set: rowSetter(rowType),
        rowType: toEastTypeValue(rowType),
    };
}
