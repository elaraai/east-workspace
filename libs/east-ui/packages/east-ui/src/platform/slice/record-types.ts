/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record Slice wire; the existing local Slice types remain unchanged. */
import {
    ArrayType, BlobType, BooleanType, DictType, East, FunctionType, IntegerType, NullType,
    OptionType, SetType, StringType, StructType, VariantType, type EastType,
} from "@elaraai/east";
import { ValueFormatType } from "../../contracts/format.js";
import { TimeResolutionType } from "../../contracts/time.js";
import { PinnedSourceType, SeekQueryType, SeekRangeType } from "../../contracts/source.js";

/**
 * One field's narrowing, with values encoded as typed .east literals.
 * @remarks Prefix text is raw text; every exact value and range end is a literal.
 * @property values - Exact alternatives on a leading field (one on a Set field).
 * @property range - Half-open range on the next field.
 * @property prefix - String prefix on the next field.
 */
export const RecordSliceChoiceType = VariantType({
    values: ArrayType(StringType),
    range: StructType({ from: StringType, to: StringType }),
    prefix: StringType,
});
export type RecordSliceChoiceType = typeof RecordSliceChoiceType;

/** A narrowing keyed by row-field name; its clauses follow one index path. */
export const RecordSliceWhereType = DictType(StringType, RecordSliceChoiceType);
export type RecordSliceWhereType = typeof RecordSliceWhereType;

/**
 * Persistable record narrowing. Resolution changes presentation only.
 * @property where - Current field choices.
 * @property preset - Selected preset, if any.
 * @property resolution - Shared presentation resolution; never changes row count.
 */
export const RecordSliceStateType = StructType({
    where: RecordSliceWhereType,
    preset: OptionType(StringType),
    resolution: OptionType(TimeResolutionType),
});
export type RecordSliceStateType = typeof RecordSliceStateType;

/**
 * One named narrowing supplied by the author.
 * @property id - Stable preset identity.
 * @property name - Display name.
 * @property where - Narrowing selecting this preset applies.
 */
export const RecordSlicePresetType = StructType({ id: StringType, name: StringType, where: RecordSliceWhereType });
export type RecordSlicePresetType = typeof RecordSlicePresetType;

/**
 * A known field value, ready for a chip.
 * @property value - Canonical .east literal.
 * @property label - Display label.
 */
export const RecordSliceValueType = StructType({ value: StringType, label: StringType });
export type RecordSliceValueType = typeof RecordSliceValueType;

/**
 * A field's control, derived at authoring time from its row type.
 * @property fieldId - Own row-field name.
 * @property label - Human label.
 * @property kind - string, boolean, enum, datetime, integer, or float.
 * @property optional - Offers an Unset choice.
 * @property multiple - Accepts multiple exact alternatives.
 * @property set - Indexes membership in a Set; requires exactly one value.
 * @property values - Known values and labels, including enum cases and hints.
 * @property format - Shared display format, or the kind's default.
 */
export const RecordSliceFieldType = StructType({
    fieldId: StringType, label: StringType, kind: StringType,
    optional: BooleanType, multiple: BooleanType, set: BooleanType,
    values: ArrayType(RecordSliceValueType), format: OptionType(ValueFormatType),
});
export type RecordSliceFieldType = typeof RecordSliceFieldType;

/**
 * One available query path, invisible to users.
 * @property name - Source selector.
 * @property fields - Row fields in index order.
 * @property sets - Fields that fan out; all must be fixed to one exact value.
 * @property interval - Final field represents overlap with an interval, using distinct start/carry-in queries.
 */
export const RecordSliceIndexType = StructType({
    name: StringType, fields: ArrayType(StringType), sets: SetType(StringType),
    interval: OptionType(StructType({ from: StringType, to: StringType, optional: BooleanType })),
});
export type RecordSliceIndexType = typeof RecordSliceIndexType;

/**
 * Data-only schema of a record slice's controls and supported paths.
 * @property fields - Offered controls in author order.
 * @property indexes - Available query paths.
 * @property range - The field the range pill and a Plan's axis share.
 * @property search - Fields offered for prefix search.
 * @property presets - Named supported narrowings.
 */
export const RecordSliceConfigType = StructType({
    fields: ArrayType(RecordSliceFieldType), indexes: ArrayType(RecordSliceIndexType),
    range: OptionType(StringType), search: ArrayType(StringType), presets: ArrayType(RecordSlicePresetType),
});
export type RecordSliceConfigType = typeof RecordSliceConfigType;

/**
 * A value's exact count in the narrowing choosing it would produce.
 * @property value - Canonical .east literal.
 * @property label - Display label.
 * @property count - Exact result count, none while pending or failed.
 * @property selected - Currently selected as an exact value.
 * @property error - Read failure for this choice, shown with Retry.
 */
export const RecordSliceCountType = StructType({
    value: StringType, label: StringType, count: OptionType(IntegerType), selected: BooleanType, error: OptionType(StringType),
});
export type RecordSliceCountType = typeof RecordSliceCountType;

/** Canonical endpoints of a field's non-empty data extent (both inclusive). */
export const RecordSliceDomainType = StructType({ from: StringType, to: StringType });
export type RecordSliceDomainType = typeof RecordSliceDomainType;

/**
 * Record controls' non-generic handle, safe to embed in component IR.
 * @remarks The typed authoring handle adds data; chrome keeps only this shape.
 * @property key - Store identity.
 * @property config - Controls and supported paths.
 * @property read - Read tracked narrowing state.
 * @property write - Replace state after validating its complete path.
 * @property choose - Choose canonical values for a field; empty clears it.
 * @property range - Set a half-open range, with canonical endpoints.
 * @property prefix - Set a String prefix.
 * @property clear - Clear one field and any dependent trailing choices.
 * @property clearAll - Clear the narrowing.
 * @property count - Exact narrowed count; none while pending.
 * @property countWhere - Exact count of a saved narrowing, without changing current state.
 * @property total - Exact primary-row count; none while pending.
 * @property domain - Inclusive numeric/date extent, ignoring that field's range; none while pending or empty.
 * @property values - Known values with exact prospective counts.
 * @property suggest - At most eight distinct String values with exact counts.
 * @property replaces - Field labels a new choice would replace.
 * @property togglePreset - Set or clear a named narrowing.
 * @property setResolution - Set presentation resolution without changing narrowing.
 * @property retry - Retry failed reads against the current record revision.
 * @property sourceId - Stable record identity for a shared editing session.
 * @property contains - Exact indexed membership of a primary identity in a captured narrowing; internal editing integration.
 * @property readEntry - Confirm an entry by primary identity: outer none is pending, inner none is confirmed absent. Internal editing integration.
 */
export const RecordSliceBindType = StructType({
    key: StringType,
    config: RecordSliceConfigType,
    read: FunctionType([], RecordSliceStateType),
    write: FunctionType([RecordSliceStateType], NullType),
    choose: FunctionType([StringType, ArrayType(StringType)], NullType),
    range: FunctionType([StringType, StringType, StringType], NullType),
    prefix: FunctionType([StringType, StringType], NullType),
    clear: FunctionType([StringType], NullType),
    clearAll: FunctionType([], NullType),
    count: FunctionType([], OptionType(IntegerType)),
    countWhere: FunctionType([RecordSliceWhereType], OptionType(IntegerType)),
    total: FunctionType([], OptionType(IntegerType)),
    domain: FunctionType([StringType], OptionType(RecordSliceDomainType)),
    values: FunctionType([StringType], ArrayType(RecordSliceCountType)),
    suggest: FunctionType([StringType, StringType], OptionType(ArrayType(RecordSliceCountType))),
    replaces: FunctionType([StringType], ArrayType(StringType)),
    togglePreset: FunctionType([StringType], NullType),
    setResolution: FunctionType([OptionType(TimeResolutionType)], NullType),
    retry: FunctionType([], NullType),
    sourceId: StringType,
    readEntry: FunctionType([StringType], OptionType(OptionType(BlobType))),
    contains: FunctionType([RecordSliceWhereType, StringType], OptionType(BooleanType)),
});
export type RecordSliceBindType = typeof RecordSliceBindType;

/**
 * Typed authoring handle; `data` preserves the narrowed window type through $.let.
 * @typeParam C - The collection type one narrowed window serves.
 * @param collection - Window type.
 * @returns The typed record Slice handle.
 */
export function RecordSliceHandleType<C extends EastType | string>(collection: C) {
    return StructType({ ...RecordSliceBindType.fields, data: PinnedSourceType(collection),
        /** Read a captured narrowing without replacing the shared controls' state. */
        pageWhere: FunctionType([RecordSliceWhereType, IntegerType, IntegerType], OptionType(collection)),
    });
}

/** New record-arm bind; local slice_bind remains byte-for-byte unchanged. @internal */
export const recordSliceBindPlatform = East.genericPlatform("slice_bind_record", ["S", "C"],
    [StringType, "S", RecordSliceConfigType, RecordSliceStateType], RecordSliceHandleType("C"), { optional: true });

const descriptor = [StringType, "S", RecordSliceConfigType, RecordSliceStateType] as const;
function op<const A extends readonly (EastType | string)[], O extends EastType | string>(name: string, args: A, output: O) {
    return East.genericPlatform(`slice_record_${name}`, ["S", "C"], [...descriptor, ...args], output, { optional: true });
}

/** Serializable operations carrying the binding descriptor, including after decode. @internal */
export const RecordSlicePrimitives = {
    read: op("read", [], RecordSliceStateType),
    write: op("write", [RecordSliceStateType], NullType),
    choose: op("choose", [StringType, ArrayType(StringType)], NullType),
    range: op("range", [StringType, StringType, StringType], NullType),
    prefix: op("prefix", [StringType, StringType], NullType),
    clear: op("clear", [StringType], NullType),
    clearAll: op("clear_all", [], NullType),
    count: op("count", [], OptionType(IntegerType)),
    countWhere: op("count_where", [RecordSliceWhereType], OptionType(IntegerType)),
    total: op("total", [], OptionType(IntegerType)),
    domain: op("domain", [StringType], OptionType(RecordSliceDomainType)),
    values: op("values", [StringType], ArrayType(RecordSliceCountType)),
    suggest: op("suggest", [StringType, StringType], OptionType(ArrayType(RecordSliceCountType))),
    replaces: op("replaces", [StringType], ArrayType(StringType)),
    togglePreset: op("toggle_preset", [StringType], NullType),
    setResolution: op("set_resolution", [OptionType(TimeResolutionType)], NullType),
    page: op("page", [RecordSliceWhereType, IntegerType, IntegerType], OptionType("C")),
    pageWhere: op("page_where", [RecordSliceWhereType, IntegerType, IntegerType], OptionType("C")),
    seek: op("seek", [RecordSliceWhereType, SeekQueryType], OptionType(SeekRangeType)),
    dataCount: op("data_count", [RecordSliceWhereType], OptionType(IntegerType)),
    revision: op("revision", [], OptionType(StringType)),
    refresh: op("refresh", [OptionType(StringType)], NullType),
    retry: op("retry", [], NullType),
    readEntry: op("read_entry", [StringType], OptionType(OptionType(BlobType))),
    contains: op("contains", [RecordSliceWhereType, StringType], OptionType(BooleanType)),
};
