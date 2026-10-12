/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Schedule's typed adapter to record Slice's indexed queries. */
import {
    ArrayType, DateTimeType, DictType, East, Expr, FunctionType, IntegerType, OptionType, StringType, StructType,
    isSubtype, isTypeEqual, none, some, variant, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { RecordSliceBindType, RecordSliceChoiceType, RecordSliceWhereType, recordSliceReadPlatform } from "@elaraai/east-ui/internal";

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
 * Read a visible interval or backlog through the same declared Slice paths.
 * This reads only the chosen result, in bounded pages. Index bounds own all
 * membership and distinct counts; no row predicate implements narrowing.
 * @param input - The author's typed Slice handle.
 * @param key - Original record key type.
 * @param row - Record row type.
 * @param start - Interval start field.
 * @param end - Interval end field (the same field for an instant).
 * @param optional - Whether the time fields admit backlog rows.
 * @param backlog - Read Unset starts instead of a scheduled interval.
 * @param label - Kind name used by authoring errors.
 * @returns A window reader compatible with the existing Schedule seams.
 */
export function scheduleRecordWindow(input: unknown, key: EastType, row: EastType, start: string, end: string,
    optional: boolean, backlog: boolean, label: string): ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>> {
    const value = East.value(input as never);
    const Type = ScheduleRecordSliceType(key, row);
    const type = Expr.type(value as Expr);
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
    if (!fits) throw new Error(`${label}: slice must be Slice.bindRecord over this event record with joined rows`);
    const source = value as unknown as ExprType<typeof Type>;
    const Held = DictType(key, row);
    return East.function([DateTimeType, DateTimeType], OptionType(Held), ($, from, to) => {
        const src = $.const(source);
        $.if(src.config.range.match({ none: () => true, some: (_$2, field) => field.notEqual(start) }), $2 => {
            $2.error(`${label}: set the record Slice range to '${start}' so navigation and filters share one window`);
        });
        const supported = $.let(false);
        $.for(src.config.indexes, ($2, index) => {
            $2.match(index.interval, { some: ($3, interval) => {
                $3.if(interval.from.equal(start).and(() => interval.to.equal(end)), $4 => { $4.assign(supported, true); });
            } });
        });
        $.if(supported.not(), $2 => { $2.error(`${label}: declare an interval index for ${start} and ${end} to preserve overlapping events`); });
        const where = $.let(new Map(), RecordSliceWhereType);
        const state = $.const(src.read());
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
        // Preserve the actual window's wire type (including its index key and
        // covering value); only the two validated entry fields are inspected.
        const Entries = collection as ArrayType<StructType<{ key: EastType; row: OptionType<EastType> }>>;
        $.match(recordSliceReadPlatform([Entries], src.data.id, src.data.revision, src.countWhere, src.pageWhere, where), {
            some: ($2, entries) => {
                const held = $2.let(new Map(), Held);
                $2.for(entries, ($3, entry) => {
                    $3.match(entry.row, {
                        none: $4 => { $4.error(`${label}: slice requires Data.bindPaged with join: true`); },
                        some: ($4, value) => { $4(held.insert(entry.key as never, value as never)); },
                    });
                });
                $2.assign(result, some(held));
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>>;
}
