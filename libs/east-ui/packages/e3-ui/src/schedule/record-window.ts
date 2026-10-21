/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Schedule's typed adapter to record Slice's indexed queries. */
import {
    ArrayType, DateTimeType, DictType, East, Expr, FunctionType, IntegerType, OptionType, StringType, StructType,
    isSubtype, isTypeEqual, none, some, variant, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    RecordSliceBindType, RecordSliceChoiceType, RecordSliceConfigType, RecordSliceStateType, RecordSliceWhereType, recordSliceReadPlatform,
} from "@elaraai/east-ui/internal";

/** Minimal typed query reader; additional index-entry fields remain opaque. */
export function ScheduleRecordSliceType<K extends EastType, R extends EastType>(key: K, row: R) {
    return StructType({ ...RecordSliceBindType.fields,
        data: StructType({ id: StringType, revision: FunctionType([], OptionType(StringType)) }),
        pageWhere: FunctionType([RecordSliceWhereType, IntegerType, IntegerType],
            OptionType(ArrayType(StructType({ key, row: OptionType(row) })))),
    });
}
/** A record Slice over the event record's original key and row types. */
export type ScheduleRecordSlice<K extends EastType, R extends EastType> = SubtypeExprOrValue<ReturnType<typeof ScheduleRecordSliceType<K, R>>>;

/**
 * A kind's source of its builder's slice, as the builder hands it to the kind
 * (#1343, #1356): the source's typed record Slice handle, `Slice.bindRecords`'
 * part named after the kind's slot, bound once in the builder's payload by
 * `recordSources(…).bind($)`. The kind's reads read its members inside their
 * functions, so each holds this one source, never the whole slice.
 */
export type ScheduleKindPart = ExprType<StructType>;

/**
 * Read a visible interval or backlog through the same declared Slice paths.
 * This reads only the chosen result, in bounded pages. Index bounds own all
 * membership and distinct counts; no row predicate implements narrowing.
 * The narrowing is the source's choices but its start field's and, on the
 * start field, the window's half-open range — or, for a backlog, the start
 * Unset; exact start values a choice holds stand for a window.
 * @param part - The kind's source of its builder's slice, bound in the builder's payload.
 * @param slot - The kind's slot, which names its source.
 * @param key - Original record key type.
 * @param row - Record row type.
 * @param start - Interval start field.
 * @param end - Interval end field (the same field for an instant).
 * @param optional - Whether the time fields admit backlog rows.
 * @param backlog - Read Unset starts instead of a scheduled interval.
 * @param label - Kind name used by authoring errors.
 * @returns A window reader compatible with the existing Schedule seams; refused as it reads when the source's range is
 *   not the start field, or it declares no interval index from the start to the end.
 * @throws {Error} When the source is not a record Slice over this event record with joined rows.
 */
export function scheduleRecordWindow(part: ScheduleKindPart, slot: string, key: EastType, row: EastType, start: string, end: string,
    optional: boolean, backlog: boolean, label: string): ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>> {
    const Type = ScheduleRecordSliceType(key, row);
    const type = Expr.type(part as unknown as Expr);
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : {};
    const data = fields.data;
    const page = fields.pageWhere;
    const output = page?.type === "Function" ? page.output : undefined;
    const collection = output?.type === "Variant" ? output.cases.some : undefined;
    const entry = collection?.type === "Array" ? collection.value : undefined;
    const fits = page?.type === "Function" && page.inputs.length === Type.fields.pageWhere.inputs.length
        && page.inputs.every((input: EastType, i: number) => isTypeEqual(input, Type.fields.pageWhere.inputs[i]!))
        && entry?.type === "Struct" && entry.fields.key !== undefined && entry.fields.row !== undefined
        && isTypeEqual(entry.fields.key, key) && isTypeEqual(entry.fields.row, OptionType(row))
        && data?.type === "Struct"
        && Object.entries(Type.fields.data.fields).every(([name, expected]) => data.fields[name] !== undefined && isSubtype(data.fields[name]!, expected))
        && Object.entries(RecordSliceBindType.fields).every(([name, expected]) => fields[name] !== undefined && isSubtype(fields[name]!, expected));
    if (!fits) {
        throw new Error(`${label}: the builder's source "${slot}" narrows another record — name it after this kind's slot over the kind's own record, ` +
            "Data.bindPaged(record, { indexes }), its rows joined");
    }
    const Held = DictType(key, row);
    // Preserve the actual window's wire type (including its index key and
    // covering value); only the two validated entry fields are inspected.
    const Entries = collection as ArrayType<StructType<{ key: EastType; row: OptionType<EastType> }>>;
    return East.function([DateTimeType, DateTimeType], OptionType(Held), ($, from, to) => {
        // The source as the builder bound it, its members read here: the reader captures the source alone.
        const source = $.const(part as unknown as ExprType<StructType<{
            config: RecordSliceConfigType;
            read: FunctionType<[], RecordSliceStateType>;
            countWhere: FunctionType<[RecordSliceWhereType], OptionType<IntegerType>>;
            pageWhere: FunctionType<[RecordSliceWhereType, IntegerType, IntegerType], OptionType<typeof Entries>>;
            data: StructType<{ id: StringType; revision: FunctionType<[], OptionType<StringType>> }>;
        }>>);
        const config = $.const(source.config);
        const read = $.const(source.read);
        const countWhere = $.const(source.countWhere);
        const pageWhere = $.const(source.pageWhere);
        const id = $.const(source.data.id);
        const revision = $.const(source.data.revision);
        $.if(config.range.match({ none: () => true, some: (_$2, field) => field.notEqual(start) }), $2 => {
            $2.error(`${label}: set the record Slice range to '${start}' so navigation and filters share one window`);
        });
        const supported = $.let(false);
        $.for(config.indexes, ($2, index) => {
            $2.match(index.interval, { some: ($3, interval) => {
                $3.if(interval.from.equal(start).and(() => interval.to.equal(end)), $4 => { $4.assign(supported, true); });
            } });
        });
        $.if(supported.not(), $2 => { $2.error(`${label}: declare an interval index for ${start} and ${end} to preserve overlapping events`); });
        const where = $.let(new Map(), RecordSliceWhereType);
        const state = $.const(read());
        $.for(state.where, ($2, choice, field) => {
            $2.if(field.notEqual(start), $3 => { $3(where.insert(field, choice)); });
        });
        const time = $.let(backlog ? variant("values", [East.print(East.value(none, OptionType(DateTimeType)))])
            : variant("range", { from: East.print(optional ? East.value(some(from), OptionType(DateTimeType)) : from),
                to: East.print(optional ? East.value(some(to), OptionType(DateTimeType)) : to) }), RecordSliceChoiceType);
        if (!backlog) {
            $.match(state.where.tryGet(start), { some: ($2, choice) => {
                $2.match(choice, { values: ($3, values) => { $3.assign(time, variant("values", values)); } });
            } });
        }
        $(where.insert(start, time));
        const result = $.let(none, OptionType(Held));
        $.match(recordSliceReadPlatform([Entries], id, revision, countWhere, pageWhere, where), {
            some: ($2, entries) => {
                const held = $2.let(new Map(), Held);
                $2.for(entries, ($3, entry) => {
                    $3.match(entry.row, {
                        none: $4 => { $4.error(`${label}: the builder's source "${slot}" reads no rows — bind it with Data.bindPaged with join: true`); },
                        some: ($4, value) => { $4(held.insert(entry.key as never, value as never)); },
                    });
                });
                $2.assign(result, some(held));
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>>;
}
