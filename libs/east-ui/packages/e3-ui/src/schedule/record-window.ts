/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Schedule's typed adapter to record Slice's indexed queries. */
import {
    ArrayType, DateTimeType, DictType, East, Expr, FunctionType, IntegerType, OptionType, StringType, StructType,
    isSubtype, isTypeEqual, none, some, variant, type BlockBuilder, type EastType, type ExprType, type SubtypeExprOrValue,
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
 * (#1343): its typed handle, which the kind's build checks against its record,
 * and what the kind's reads call, each bound once in the builder's payload. A
 * function captures what it reads, so a read through the slice would capture
 * the whole slice — every source's methods, each of which holds its source —
 * and a payload encodes, and its decode compiles, a capture once for each
 * function holding it.
 */
export interface ScheduleKindPart {
    /** The source's typed record Slice handle, `Slice.bindRecords`' part. */
    readonly handle: unknown;
    /** Its controls and supported paths, `config`. */
    readonly config: unknown;
    /** Its narrowing's state, `read`. */
    readonly read: unknown;
    /** An exact count under a narrowing, `countWhere`. */
    readonly countWhere: unknown;
    /** A page under a narrowing, `pageWhere`. */
    readonly pageWhere: unknown;
    /** Its narrowed data's identity, `data.id`. */
    readonly id: unknown;
    /** Its record's revision, `data.revision`. */
    readonly revision: unknown;
}

/**
 * Binds a kind's source of its builder's slice for the kind's reads (#1343):
 * each member they call, once, in the builder's payload.
 * @typeParam T - The block's type.
 * @param $ - The builder's payload block.
 * @param handle - The source's typed handle: the slice's part named after the kind's slot.
 * @returns The part, as the kind's build takes it.
 */
export function bindScheduleKindPart<T extends EastType>($: BlockBuilder<T>, handle: unknown): ScheduleKindPart {
    const part = East.value(handle as never) as unknown as ExprType<ReturnType<typeof ScheduleRecordSliceType<EastType, EastType>>>;
    const config = $.let(part.config);
    const read = $.let(part.read);
    const countWhere = $.let(part.countWhere);
    const pageWhere = $.let(part.pageWhere);
    const id = $.let(part.data.id);
    const revision = $.let(part.data.revision);
    return { handle, config, read, countWhere, pageWhere, id, revision };
}

/**
 * Read a visible interval or backlog through the same declared Slice paths.
 * This reads only the chosen result, in bounded pages. Index bounds own all
 * membership and distinct counts; no row predicate implements narrowing.
 * The narrowing is the source's choices but its start field's and, on the
 * start field, the window's half-open range — or, for a backlog, the start
 * Unset; exact start values a choice holds stand for a window.
 * @param part - The kind's source of its builder's slice, its reads bound in the builder's payload.
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
    const value = East.value(part.handle as never);
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
    if (!fits) {
        throw new Error(`${label}: the builder's source "${slot}" narrows another record — name it after this kind's slot over the kind's own record, ` +
            "Data.bindPaged(record, { indexes }), its rows joined");
    }
    const Held = DictType(key, row);
    // Preserve the actual window's wire type (including its index key and
    // covering value); only the two validated entry fields are inspected.
    const Entries = collection as ArrayType<StructType<{ key: EastType; row: OptionType<EastType> }>>;
    // The variables the builder bound: the reader captures each, and nothing else of the slice.
    const bound = {
        config: part.config as ExprType<RecordSliceConfigType>,
        read: part.read as ExprType<FunctionType<[], RecordSliceStateType>>,
        countWhere: part.countWhere as ExprType<FunctionType<[RecordSliceWhereType], OptionType<IntegerType>>>,
        pageWhere: part.pageWhere as ExprType<FunctionType<[RecordSliceWhereType, IntegerType, IntegerType], OptionType<typeof Entries>>>,
        id: part.id as ExprType<StringType>,
        revision: part.revision as ExprType<FunctionType<[], OptionType<StringType>>>,
    };
    return East.function([DateTimeType, DateTimeType], OptionType(Held), ($, from, to) => {
        const config = $.const(bound.config);
        const read = $.const(bound.read);
        const countWhere = $.const(bound.countWhere);
        const pageWhere = $.const(bound.pageWhere);
        const id = $.const(bound.id);
        const revision = $.const(bound.revision);
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
