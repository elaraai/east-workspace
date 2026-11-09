/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's reference record (#1551): a second record of the app's — a
 * rota beside the Roster's duties, a delivery schedule beside the
 * Allocation's bins — read only for the builder's check. Its source is the
 * builder's slice's source named `reference`: a paged read of the record
 * through an interval index, with a `range`, the field it is read over. The
 * builder writes the period in view into the source, as into its own kind's,
 * and reads the record's rows in it — each week of a month its own, every one
 * whatever choice the source holds, and never the record whole — and gives
 * them to the app's check, `CheckContext(R, P)`, `P` the record's
 * row type, as `reference`: its rows by key. Nothing draws them, and the rail
 * offers none of the source's fields: it narrows nothing.
 *
 * @packageDocumentation
 */

import {
    BlobType, DateTimeType, DictType, East, EastTypeType, Expr, FunctionType, OptionType, StringType, StructType, isTypeEqual, printType, toEastTypeValue,
    type EastType, type ExprType,
} from "@elaraai/east";
import { isRecordSlices, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { scheduleReferenceWindow, type ScheduleKindPart } from "./record-window.js";

/** The name of the slice's source a builder reads its reference record through (#1551). */
export const SCHEDULE_REFERENCE = "reference";

/**
 * A builder's reference record, as its payload carries it (#1551): its rows
 * in a window, each by its key as its row's bytes, and their type, which the
 * renderer decodes them by for the app's check.
 *
 * @property rows - `(from, to)` → the record's rows overlapping `[from, to)`, by key, each its row's beast2 bytes; `none` while the read is in flight
 * @property rowType - The record's row type
 */
export const ScheduleReferenceType = StructType({
    rows: FunctionType([DateTimeType, DateTimeType], OptionType(DictType(StringType, BlobType))),
    rowType: EastTypeType,
});
/** Type representing {@link ScheduleReferenceType}. */
export type ScheduleReferenceType = typeof ScheduleReferenceType;

/** A struct type's fields, by name. */
function fieldsOf(type: EastType | undefined): Readonly<Record<string, EastType>> | undefined {
    return type?.type === "Struct" ? type.fields as Readonly<Record<string, EastType>> : undefined;
}

/**
 * The row type of a builder's reference record, read from its `slice`'s type
 * before the slice is checked: what the builder's `check` is given beside its
 * own rows.
 *
 * @param slice - The builder's `slice` prop, if given
 * @param builder - The builder, as its refusals name it (`Roster`)
 * @returns The row type of the slice's `reference` source; `undefined` with no slice, a slice that is no `Slice.bindRecords`
 *   (which the builder's check of its slice refuses), or no source named `reference`
 * @throws {Error} When the source reads no rows of a Struct
 */
export function referenceRowType(slice: RecordSlicesChromeOptions | undefined, builder: string): EastType | undefined {
    if (slice === undefined || !isRecordSlices(slice.slice)) return undefined;
    const sources = fieldsOf(fieldsOf(Expr.type(East.value(slice.slice) as unknown as Expr))?.["sources"]);
    const part = sources?.[SCHEDULE_REFERENCE];
    if (part === undefined) return undefined;
    const page = fieldsOf(part)?.["pageWhere"];
    const output = page?.type === "Function" ? page.output : undefined;
    const collection = output?.type === "Variant" ? (output.cases as Readonly<Record<string, EastType>>)["some"] : undefined;
    const row = fieldsOf(collection?.type === "Array" ? collection.value : undefined)?.["row"];
    const read = row?.type === "Variant" ? (row.cases as Readonly<Record<string, EastType>>)["some"] : undefined;
    if (read?.type !== "Struct") {
        throw new Error(`${builder}: the slice's reference source reads no rows — bind its record reference: { source: Data.bindPaged(record, { indexes }), range: "<its start field>" }`);
    }
    return read;
}

/** The words a builder's refusals of its `check` use (#1551). */
export interface ReferenceCheckWords {
    /** The builder, as its refusals name it (`Roster`). */
    builder: string;
    /** Its check context's constructor, as the refusals spell it (`Roster.Types.CheckContext`). */
    context: string;
    /** Its own rows' type, printed. */
    row: string;
}

/**
 * Why a builder's `check` and its slice's reference record do not go
 * together (#1551): a slice with a `reference` source and no check, which
 * would read rows nothing uses; a check reading reference rows the slice gives
 * none of; a check of the builder's rows alone over a slice that gives some;
 * and one reading reference rows of another type. Anything else the builder's
 * own check of its function's type refuses.
 *
 * @param check - The builder's `check` prop, if given
 * @param reference - The row type of the slice's reference source ({@link referenceRowType}); `undefined` for none
 * @param words - The builder's words
 * @returns The refusal's words; `undefined` when they go together
 */
export function referenceCheckRefusal(check: unknown, reference: EastType | undefined, words: ReferenceCheckWords): string | undefined {
    const { builder, context, row } = words;
    if (check === undefined) {
        return reference === undefined ? undefined
            : `${builder}: the slice's \`reference\` source is read for the check alone — give the ${builder} a \`check\` from ${context}(${row}, ${printType(reference)}), ` +
                "or leave the source out";
    }
    const type = Expr.type(East.value(check as never) as unknown as Expr) as EastType;
    const asked = type.type === "Function" && type.inputs.length === 1 ? fieldsOf(type.inputs[0]) : undefined;
    const held = asked?.["reference"];
    const theirs = held?.type === "Dict" && isTypeEqual(held.key, StringType) ? held.value : undefined;
    if (reference === undefined) {
        return theirs === undefined ? undefined
            : `${builder}: \`check\` reads a reference record's rows, ${context}(${row}, ${printType(theirs)}), and the slice holds no \`reference\` source — bind the record ` +
                `as one: Slice.bindRecords(key, { …, reference: { source: Data.bindPaged(record, { indexes }), range: "<its start field>" } })`;
    }
    if (asked !== undefined && held === undefined) {
        return `${builder}: the slice's \`reference\` source gives the check its rows, and \`check\` is from ${context}(${row}) — make it from ${context}(${row}, ` +
            `${printType(reference)}), or leave the source out`;
    }
    if (theirs !== undefined && !isTypeEqual(theirs, reference)) {
        return `${builder}: \`check\` reads reference rows of ${printType(theirs)}, and the slice's \`reference\` source reads ${printType(reference)} — make it from ` +
            `${context}(${row}, ${printType(reference)})`;
    }
    return undefined;
}

/**
 * A builder's reference record for its payload (#1551): its rows in a
 * window, read through its source of the builder's slice — bound once in the
 * builder's payload — as bytes, and their type.
 *
 * @param part - The `reference` source's part of the slice, bound by `recordSources(…).bind($)`
 * @param row - The record's row type ({@link referenceRowType})
 * @param builder - The builder, as its refusals name it
 * @returns The reference, as the payload carries it
 * @throws {Error} When the source is not a record Slice over a record keyed by String with joined rows
 */
export function scheduleReference(part: ScheduleKindPart, row: EastType, builder: string): ExprType<ScheduleReferenceType> {
    return East.value({ rows: scheduleReferenceWindow(part, row, builder), rowType: toEastTypeValue(row) }, ScheduleReferenceType);
}
