/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record of the app's a declaration reads and writes, bound (#1386, #1447):
 * how it is bound — `Record.bind(record), its record declaring patch:
 * mutation.patch()` to edit it, `Data.bind(record)` or `Data.bindPaged(record)`
 * to read it only — told by its handle's East struct, and the side of it a
 * declaration carries on the wire: the shared editing session with its patch
 * door, the record read by key, its history, the inspector's form over its
 * fields, its own Details, the app's check and the setter a card's field writes
 * go through. The Schematic's kinds and details and the DecisionQueue's record
 * and zones targets each declare theirs through it.
 *
 * @packageDocumentation
 */

import {
    ArrayType, AsyncFunctionType, BlobType, BooleanType, EastTypeType, East, Expr, FunctionType, OptionType, PatchType, StringType,
    isTypeEqual, none, printType, some, toEastTypeValue, variant,
    type DictType, type EastType, type ExprType, type NullType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import type { UIComponentType } from "@elaraai/east-ui";
import { EditingReadinessType, EditingType, Fields, FieldSpecType, resolveRowSource, type FieldHints } from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { fieldOf, fieldSetters } from "../schedule/fields.js";
import { scheduleEntriesSeam, scheduleRecordSession } from "../schedule/session.js";
import { ScheduleEntriesType, ScheduleFieldWriteType, ScheduleReadyEntryType } from "../schedule/types.js";
import { checkEntries, scheduleEntryByKey, scheduleLastKey, typeText } from "../schedule/window.js";
import { RowInspectorType, rowInspector } from "./row-inspector.js";

// ============================================================================
// How the record is bound
// ============================================================================

/**
 * What a declaration's record is, bound: `Record.bind`'s or `Data.bind`'s
 * handle, read whole, or `Data.bindPaged`'s, read by key — each over a
 * `Dict<String, R>`, its row type `R` inferred from the handle.
 *
 * @typeParam R - The record's row type
 */
export type RecordBinding<R extends StructType> =
    | { readonly read: (...args: never[]) => ExprType<DictType<StringType, R>>; readonly binding: unknown }
    | { readonly page: (...args: never[]) => ExprType<OptionType<DictType<StringType, R>>>; readonly revision: unknown };

/** The binding forms, as the refusals name them. */
const FORMS = "Record.bind(record), its record declaring patch: mutation.patch() to edit it, or Data.bind(record) or Data.bindPaged(record) to read it only";

/** A declaration's record, bound: how, its handle, and its row type. */
export interface RecordBound {
    /** `record`: `Record.bind` with its patch door, editable; `data`: `Data.bind`, read whole; `paged`: `Data.bindPaged`, read through a source. */
    readonly form: "record" | "data" | "paged";
    /** The binding's handle. */
    readonly handle: ExprType<EastType>;
    /** The record's row type. */
    readonly rowType: StructType;
}

/**
 * Tells a record's binding by its handle's East struct (`bind/sources.ts`'
 * rule): a `page` field is `Data.bindPaged`'s, a `mutate` field
 * `Record.bind`'s — checked for its patch door — and any other `Data.bind`'s.
 *
 * @param record - What the declaration was given
 * @param where - The declaration, as a refusal names it
 * @param holds - What its record holds, as the refusal of a record of another type says it
 *   (`a Schematic kind's record holds its entities by String key, each a struct`)
 * @returns The binding
 * @throws {Error} Naming the forms to use: anything but a binding of a record of structs keyed by String, a paged read of
 *   an index's window or one naming no snapshot, and a `Record.bind` without its patch door
 */
export function recordBound(record: unknown, where: string, holds: string): RecordBound {
    const refuse = (why: string): never => { throw new Error(`${where}: \`record\` is the app's record, bound — ${FORMS}${why}`); };
    if (!(record instanceof Expr)) return refuse("");
    const type = Expr.type(record) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : undefined;
    if (fields === undefined) return refuse(` — and this is ${printType(type)}`);
    let form: RecordBound["form"];
    let recordType: EastType | undefined;
    if (fields["page"] !== undefined) {
        form = "paged";
        if (fields["indexes"] !== undefined) {
            return refuse(" — and this paged read serves the record's indexes: bind its own entries, Data.bindPaged(record), and name the indexed read " +
                "as the kind's source of the slice");
        }
        const resolved = resolveRowSource(record, where);
        if (resolved.kind !== "paged") {
            return refuse(" — and this paged read serves an index's window: bind the record's own entries, Data.bindPaged(record)");
        }
        recordType = resolved.collectionType;
    } else {
        form = fields["mutate"] !== undefined ? "record" : "data";
        const read = fields["read"];
        if (read === undefined || read.type !== "Function" || read.inputs.length !== 0 || fields["binding"] === undefined) return refuse("");
        recordType = read.output as EastType;
    }
    if (recordType.type !== "Dict" || !isTypeEqual(recordType.key as EastType, StringType) || (recordType.value as EastType).type !== "Struct") {
        throw new Error(`${where}: ${holds} — and this one holds ${typeText(recordType)}`);
    }
    const rowType = recordType.value as StructType;
    if (form === "paged") {
        // A paged read of the record's own entries, at the snapshot every read of it is at.
        checkEntries(record, StringType, rowType, `${where}: \`record\``);
    }
    if (form === "record") {
        // The patch door: the record's mutation.patch(), the mutation named `patch` taking the record's patch.
        const commit = fields["commit"];
        const door = commit?.type === "Struct" ? (commit.fields as Record<string, EastType>)["patch"] : undefined;
        if (door === undefined || !isTypeEqual(door, AsyncFunctionType([StringType, PatchType(recordType)], RecordOutcomeType))) {
            throw new Error(`${where}: \`record\` is bound without its patch door — ${FORMS}`);
        }
    }
    return { form, handle: record as ExprType<EastType>, rowType };
}

/**
 * Checks a declaration's `entries` where it declares them: for a record bound
 * to be edited, a paged read of its own entries.
 *
 * @param bound - The record's binding
 * @param entries - What the declaration was given
 * @param where - The declaration, as a refusal names it
 * @returns The paged read, checked; `undefined` for none
 * @throws {Error} When a read-only binding is given `entries`, or they are no paged read of the record's own entries
 */
export function recordEntries(bound: RecordBound, entries: unknown, where: string): ExprType<EastType> | undefined {
    if (entries === undefined) return undefined;
    if (bound.form !== "record") {
        throw new Error(`${where}: \`entries\` reads an editable record by key — a kind bound ${bound.form === "data" ? "Data.bind" : "Data.bindPaged"} ` +
            `${bound.form === "data" ? "is read whole" : "reads by key through its own binding"}: leave \`entries\` out`);
    }
    return checkEntries(entries, StringType, bound.rowType, `${where}: \`entries\``);
}

// ============================================================================
// The record's side
// ============================================================================

/**
 * A row of the record's type, field by field: each field `set` names from it,
 * every other from `source` — so a write moves only the fields its roles map.
 *
 * @param rowType - The record's row type
 * @param source - The row the other fields come from
 * @param set - The fields written, by name
 * @returns The row
 */
export function rowWith(rowType: StructType, source: unknown, set: Readonly<Record<string, unknown>>): ExprType<EastType> {
    return East.value(Object.fromEntries(Object.keys(rowType.fields).map((f) => [f, set[f] ?? fieldOf(source, f)])) as never, rowType) as ExprType<EastType>;
}

/** A declaration's own Details: an East function over the row and its writer, as the Sheet's and the Flowchart's are. */
export type RowInspector<R extends StructType> = SubtypeExprOrValue<FunctionType<[R, FunctionType<[R], NullType>], UIComponentType>>;

/**
 * What a declaration over a record gives beside its roles, each typed over
 * the record's row, as Schedule's kinds' are (#1391).
 *
 * @typeParam R - The record's row type
 */
export interface RecordSide<R extends StructType = StructType> {
    /** A paged read of the record's own entries, for an editable record read by key. */
    entries?: unknown;
    /** Hints for the inspector's form over the fields no role writes (`Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** The app's check on a drafted row, over the row and its key: a refusal holds Save, naming the row and its field. */
    ready?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<typeof EditingReadinessType>;
    /** The declaration's own Details, in place of its form: an East function over the row and its writer. */
    inspector?: RowInspector<R>;
}

/**
 * The app's check over drafted rows, one result each; a check that throws
 * refuses its own row alone.
 *
 * @param rowType - The record's row type
 * @param ready - The app's check, over the row and its key
 * @returns `(batch)` → a result per drafted row, in order; `undefined` with no check
 */
export function recordReady(rowType: StructType, ready: ((row: ExprType<StructType>, key: ExprType<StringType>) => unknown) | undefined) {
    if (ready === undefined) return undefined;
    const author = East.function([rowType, StringType], EditingReadinessType, ($, row, key) =>
        $.const(ready(row, key) as SubtypeExprOrValue<typeof EditingReadinessType>, EditingReadinessType));
    return East.function([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType), ($, batch) => {
        const check = $.const(author);
        return batch.map(($2, item) => {
            const result = $2.let(variant("ready", null), EditingReadinessType);
            $2.try(($3) => {
                $3.assign(result, check(item.entry.decodeBeast(rowType, "v2"), item.id));
            }).catch(($3, message) => {
                $3.assign(result, variant("invalid", [{ field: "", message: East.str`Readiness check failed: ${message}` }]));
            });
            return result;
        });
    });
}

/**
 * The row with each of a card's field writes applied in order, and every other
 * field as it was (#1390): what an author's card dropped on an entity sets —
 * the fields its `Schematic.patch` sets, each a field at any depth, its value
 * as bytes at the field's type — through the setter Schedule's kinds write an
 * inspector's edit with (`fieldSetters`).
 *
 * @param rowType - The record's row type
 * @returns `(bytes, writes)` → the row written; `none` when a write names no field of the row
 */
export function recordSetter(rowType: StructType) {
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

/** A record's commits, newest first, as its handle reads them. */
const HistoryType = FunctionType([], OptionType(ArrayType(RecordCommitInfoType)));

/** The author's check over drafted entries, one result each. */
const ReadyType = FunctionType([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType));

/**
 * What a declaration over a record carries on the wire: how the record is
 * read and written, and the inspector's form.
 *
 * @property editable - Whether the record is bound with its patch door: what its gestures, drops and edits write
 * @property editing - The shared session over the record, with its patch door; `none` for a record bound read only
 * @property entries - The record read by key, for a record read through its source or bound with `Data.bindPaged`; `none` for one read whole
 * @property history - The record's commits, newest first; `none` for a record bound with `Data.bind` or `Data.bindPaged`
 * @property fields - The inspector's form over the fields no role writes (`Fields`)
 * @property inspector - The declaration's own Details in place of its form, over bytes
 * @property ready - The app's check on drafted rows, one result each
 * @property set - The row with each field write applied in order — a field at any depth, its value as bytes at the field's type — and every other field as it was: what an author's card dropped on an entity sets (#1390); `none` for a write naming no field of the row
 * @property rowType - The record's row type
 */
export const RecordSideFields = {
    editable: BooleanType,
    editing: OptionType(EditingType),
    entries: OptionType(ScheduleEntriesType),
    history: OptionType(HistoryType),
    fields: ArrayType(FieldSpecType),
    inspector: OptionType(RowInspectorType),
    ready: OptionType(ReadyType),
    set: FunctionType([BlobType, ArrayType(ScheduleFieldWriteType)], OptionType(BlobType)),
    rowType: EastTypeType,
} as const;

/**
 * A record's side on the wire ({@link RecordSideFields}): whether it is
 * editable, its session and its read by key, its history, its form, its own
 * Details, the app's check, and the setter an author's card writes its fields
 * through.
 *
 * @param bound - The record's binding
 * @param entries - Its `entries`, checked
 * @param byKey - The paged read its rows are read by key through, if any
 * @param config - Its form's hints, its check and its own Details
 * @param omitted - The fields its roles write, which its form leaves out
 * @param where - The declaration, as a refusal names it
 * @returns The fields of {@link RecordSideFields}
 * @throws {Error} As `Fields.specs`, `rowInspector` and the patch door's check refuse
 */
export function recordSide<R extends StructType>(bound: RecordBound, entries: ExprType<EastType> | undefined, byKey: ExprType<EastType> | undefined,
    config: RecordSide<R>, omitted: readonly (string | undefined)[], where: string): Record<string, unknown> {
    const rowType = bound.rowType;
    const form = Fields.specs(rowType, (config.fields ?? {}) as never,
        [...new Set(omitted.filter((name): name is string => name !== undefined))] as never);
    const inspector = config.inspector === undefined ? undefined : rowInspector(config.inspector, rowType,
        `${where}: \`inspector\` is the kind's own Details — an East.function over the row and its writer: ` +
        "East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …), RowType the record's row");
    // Typed over the kind's row, as its author wrote it: called over the row the check decodes.
    const ready = recordReady(rowType, config.ready as never);
    let editing: unknown = none;
    let seam: unknown;
    let history: unknown = none;
    if (bound.form === "record") {
        // The shared session over the record (Schedule's `session.ts`): whole-entry drafts, keyed batches, Save through
        // its patch door — its base the record's snapshot, or, read through a source, its revision.
        const session = scheduleRecordSession(bound.handle, StringType, rowType, byKey === undefined ? undefined : entries);
        const built = session.build();
        editing = some(built.editing);
        seam = built.entries;
        history = some(session.history);
    } else if (byKey !== undefined) {
        // Read only through `Data.bindPaged`: the record read by key through that binding itself.
        seam = scheduleEntriesSeam(byKey, scheduleEntryByKey(byKey, StringType, rowType), scheduleLastKey(byKey, StringType));
    }
    return {
        editable: bound.form === "record",
        editing,
        entries: seam ?? East.value(none, OptionType(ScheduleEntriesType)),
        history,
        fields: East.value(form, ArrayType(FieldSpecType)),
        inspector: inspector === undefined ? East.value(none, OptionType(RowInspectorType)) : some(inspector),
        ready: ready === undefined ? none : some(ready),
        set: recordSetter(rowType),
        rowType: toEastTypeValue(rowType),
    };
}
