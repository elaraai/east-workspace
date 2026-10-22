/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record Slice wire; the existing local Slice types remain unchanged. */
import {
    ArrayType, BlobType, BooleanType, DictType, East, FloatType, FunctionType, IntegerType, NullType,
    OptionType, SetType, StringType, StructType, VariantType, type EastType,
} from "@elaraai/east";
import { ValueFormatType } from "../../contracts/format.js";
import { IconType } from "../../display/icon/types.js";
import { TimeResolutionType } from "../../contracts/time.js";
import { LiveSourceType, SeekQueryType, SeekRangeType } from "../../contracts/source.js";

/**
 * One field's narrowing, with values encoded as typed .east literals.
 * @remarks Prefix text is raw text; every exact value and range end is a literal.
 * A `window` is a read's, never the rail's: it is given under an area index's
 * `__area` field to a read's `where` (`pageWhere`, `countWhere`, a scan), never
 * written into a Slice's state, and never shown as a chip (#1385). It is named
 * to sort after every case before it, so the earlier cases keep their tags. A
 * narrowing is a Dict of choices, whose values beast2 reads at exactly their
 * written type, so one an earlier release wrote does not decode under this type
 * (docs/conventions/WIRE_MIGRATION.md).
 * @property values - Exact alternatives on a leading field (one on a Set field);
 *   under `__area`, the unplaced clause (`-1`).
 * @property range - Half-open range on the next field.
 * @property prefix - String prefix on the next field.
 * @property window - The viewport an area index reads, in world units: the rows
 *   whose box meets it grown by its margin (`areaQueries`).
 */
export const RecordSliceChoiceType = VariantType({
    values: ArrayType(StringType),
    range: StructType({ from: StringType, to: StringType }),
    prefix: StringType,
    window: StructType({ minX: FloatType, minY: FloatType, maxX: FloatType, maxY: FloatType }),
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
 * @property structured - Index key is a Struct, including a single computed field.
 * @property interval - Final field represents overlap with an interval, using distinct start/carry-in queries.
 * @property area - Final field is an area index's `__area` (#1385): the row fields its box is read from (`x`, `y`,
 *   and `width` and `height` unless the rows are points), whether `x`, `y` is the box's centre or its minimum corner,
 *   the finest cell's side in world units (a power of two), and whether `x` and `y` are Options, which makes the
 *   unplaced clause meaningful. Its entries carry their rows.
 */
export const RecordSliceIndexType = StructType({
    name: StringType, fields: ArrayType(StringType), sets: SetType(StringType), structured: BooleanType,
    interval: OptionType(StructType({ from: StringType, to: StringType, optional: BooleanType })),
    area: OptionType(StructType({
        x: StringType, y: StringType, width: OptionType(StringType), height: OptionType(StringType),
        centre: BooleanType, cell: FloatType, optional: BooleanType,
    })),
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
 * @property containsRow - Exact indexed membership of an entry whose row the caller holds at the record's current revision — a Save's: the row its request began from, or the one its confirmation read back — its maintained keys sought without reading the row again; internal editing integration.
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
    containsRow: FunctionType([RecordSliceWhereType, StringType, BlobType], OptionType(BooleanType)),
});
export type RecordSliceBindType = typeof RecordSliceBindType;

/**
 * Typed authoring handle; `data` preserves the narrowed window type through $.let.
 * @remarks `data` is a live source (#1354): one per binding, whatever the
 * narrowing, its reads reading the narrowing as it stands when they run and
 * its `query` naming it — so a component built over it is not built again when
 * a choice changes.
 * @typeParam C - The collection type one narrowed window serves.
 * @param collection - Window type.
 * @returns The typed record Slice handle.
 */
export function RecordSliceHandleType<C extends EastType | string>(collection: C) {
    return StructType({ ...RecordSliceBindType.fields, data: LiveSourceType(collection),
        /** Read a captured narrowing without replacing the shared controls' state. */
        pageWhere: FunctionType([RecordSliceWhereType, IntegerType, IntegerType], OptionType(collection)),
    });
}

/**
 * One source of a Slice over several records: its name, how the rail names it, and its controls.
 * @property source - The source's name (`lanes`), what `Slice.rows(slice, source)` names.
 * @property label - How the rail names it (`Bays`); none, the host's noun for it.
 * @property icon - Its icon on the rail, a Font Awesome solid icon; none, the rail's own.
 * @property slice - Its record Slice's controls, a part like any other.
 */
export const RecordSlicePartType = StructType({ source: StringType, label: OptionType(StringType), icon: OptionType(IconType), slice: RecordSliceBindType });
export type RecordSlicePartType = typeof RecordSlicePartType;

/**
 * A named narrowing over several sources, selected as one.
 * @property id - Stable preset identity, shared by each part's preset.
 * @property name - Display name.
 */
export const RecordSlicesPresetType = StructType({ id: StringType, name: StringType });
export type RecordSlicesPresetType = typeof RecordSlicesPresetType;

/**
 * A Slice over several records' non-generic handle: the product of one record
 * Slice per source, safe to embed in component IR.
 * @remarks No index relates two records, so a choice in one part never changes
 * another's result or counts. The product keeps no state of its own: its state
 * is each part's.
 * @property key - Store identity; each part's is `${key}.${source}`.
 * @property parts - Each source's controls, in source order.
 * @property presets - Narrowings over several sources; a part holds each as a preset of the same id.
 * @property clearAll - Clear every part.
 * @property togglePreset - Select a preset in every part, or clear every part when each already has it.
 */
export const RecordSlicesBindType = StructType({
    key: StringType,
    parts: ArrayType(RecordSlicePartType),
    presets: ArrayType(RecordSlicesPresetType),
    clearAll: FunctionType([], NullType),
    togglePreset: FunctionType([StringType], NullType),
});
export type RecordSlicesBindType = typeof RecordSlicesBindType;

/**
 * Typed authoring handle over several records; `sources` keeps each part's typed handle through $.let.
 * @typeParam S - Each source's typed record Slice handle type, by name.
 * @param sources - The handle types.
 * @returns The typed handle type.
 */
export function RecordSlicesHandleType<S extends Record<string, EastType>>(sources: S) {
    return StructType({ ...RecordSlicesBindType.fields, sources: StructType(sources) });
}

/** New record-arm bind; local slice_bind remains byte-for-byte unchanged. @internal */
export const recordSliceBindPlatform = East.genericPlatform("slice_bind_record", ["S", "C"],
    [StringType, "S", RecordSliceConfigType, RecordSliceStateType], RecordSliceHandleType("C"), { optional: true });

const descriptor = [StringType, "S", RecordSliceConfigType, RecordSliceStateType] as const;
function op<const A extends readonly (EastType | string)[], O extends EastType | string>(name: string, args: A, output: O) {
    return East.genericPlatform(`slice_record_${name}`, ["S", "C"], [...descriptor, ...args], output, { optional: true });
}

/**
 * Serializable operations carrying the binding descriptor, including after decode.
 * @remarks The narrowed data's reads (`dataPage`, `dataSeek`, `dataQuery`) read
 * the binding's narrowing when they run, so its handle captures none (#1354);
 * its total is `count`.
 * @internal
 */
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
    pageWhere: op("page_where", [RecordSliceWhereType, IntegerType, IntegerType], OptionType("C")),
    dataPage: op("data_page", [IntegerType, IntegerType], OptionType("C")),
    dataSeek: op("data_seek", [SeekQueryType], OptionType(SeekRangeType)),
    dataQuery: op("data_query", [], StringType),
    revision: op("revision", [], OptionType(StringType)),
    refresh: op("refresh", [OptionType(StringType)], NullType),
    retry: op("retry", [], NullType),
    readEntry: op("read_entry", [StringType], OptionType(OptionType(BlobType))),
    contains: op("contains", [RecordSliceWhereType, StringType], OptionType(BooleanType)),
    containsRow: op("contains_row", [RecordSliceWhereType, StringType, BlobType], OptionType(BooleanType)),
};

/**
 * Read one active indexed result incrementally in the renderer's read scope.
 * The result belongs to that reader; this does not extend either page cache.
 * @internal
 */
export const recordSliceReadPlatform = East.genericPlatform("slice_record_scan", ["C"], [
    StringType,
    FunctionType([], OptionType(StringType)),
    FunctionType([RecordSliceWhereType], OptionType(IntegerType)),
    FunctionType([RecordSliceWhereType, IntegerType, IntegerType], OptionType("C" as const)),
    RecordSliceWhereType,
], OptionType("C" as const), { optional: true });
