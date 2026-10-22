/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typed record Slice authoring. Query execution belongs to the renderer. */
import {
    ArrayType, East, Expr, StringType, StructType, VariantType, SetType,
    compareFor, isSubtype, isTypeEqual, isValueOf, none, printFor, some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue, type ValueTypeOf,
} from "@elaraai/east";
import { IndexedEntryType, IndexedSourceType, type IndexedSource } from "../../contracts/indexed-source.js";
import { toValueFormat, type SliceFieldFormat } from "./index.js";
import { planRecordSlice } from "./record-plan.js";
import {
    RecordSliceConfigType, RecordSliceStateType, RecordSliceHandleType, recordSliceBindPlatform,
    type RecordSliceChoiceType, type RecordSliceFieldType, type RecordSliceWhereType,
} from "./record-types.js";

type IndexedFields<M extends StructType> = {
    [I in keyof M["fields"]]: M["fields"][I] extends StructType<infer F> ? keyof F : never;
}[keyof M["fields"]];
type Field<M extends StructType> = Extract<IndexedFields<M>, string>;
type MarkerType<R extends StructType, F extends string, T> = T extends ArrayType<infer V> ? V
    : T extends SetType ? T : F extends keyof R["fields"] ? R["fields"][F] : never;
type FieldType<R extends StructType, M extends StructType, F extends string> = {
    [I in keyof M["fields"]]: M["fields"][I] extends StructType<infer Fields>
        ? F extends keyof Fields ? MarkerType<R, F, Fields[F]> : never : never;
}[keyof M["fields"]];
type Key<T extends EastType> = T extends SetType<infer K extends EastType> ? K : T;
type Scalar<T extends EastType> = Key<T> extends VariantType<infer V>
    ? V extends { some: infer S extends EastType; none: EastType } ? S : Key<T> : Key<T>;
type PrimitiveValue<T extends EastType> = T["type"] extends "String" ? string
    : T["type"] extends "Integer" ? bigint : T["type"] extends "Float" ? number
        : T["type"] extends "Boolean" ? boolean : T["type"] extends "DateTime" ? Date
            : T extends VariantType<infer V> ? Extract<keyof V, string> : never;
/** Authoring shorthand: unit variants are case names; an optional value may be null. */
export type RecordSliceValue<T extends EastType> = Key<T> extends VariantType<infer V>
    ? V extends { some: infer S extends EastType; none: EastType } ? PrimitiveValue<S> | null : PrimitiveValue<Key<T>>
    : PrimitiveValue<Key<T>>;
type RangeField<R extends StructType, M extends StructType> = {
    [F in Field<M>]: FieldType<R, M, F> extends SetType ? never : Scalar<FieldType<R, M, F>>["type"] extends "DateTime" | "Integer" | "Float" ? F : never;
}[Field<M>];
type SearchField<R extends StructType, M extends StructType> = {
    [F in Field<M>]: Scalar<FieldType<R, M, F>> extends StringType ? F : never;
}[Field<M>];
type Choice<T extends EastType> = readonly RecordSliceValue<T>[] | (T extends SetType ? never
    : Scalar<T>["type"] extends "DateTime" | "Integer" | "Float" ? { from: Exclude<RecordSliceValue<T>, null>; to: Exclude<RecordSliceValue<T>, null> }
        : Scalar<T> extends StringType ? { prefix: string } : never);
/** Typed per-field narrowing; clauses must be answerable by one declared index. */
export type RecordSliceWhere<R extends StructType, M extends StructType> = { [F in Field<M>]?: Choice<FieldType<R, M, F>> };

/** Options inferred from the record's row and its binding's declared indexes. */
export interface RecordSliceOptions<R extends StructType, M extends StructType> {
    /** Offered fields; omitted means all indexed fields. */
    fields?: { [F in Field<M>]?: { label?: string; format?: SliceFieldFormat; hints?: readonly RecordSliceValue<FieldType<R, M, F>>[] } };
    /** Ranged field shared by the range control and a Plan's window. */
    range?: RangeField<R, M>;
    /** Prefix-search fields; omitted means all offered String fields. A String field with no hints is refused unless it is one of them: it would offer nothing to choose. */
    search?: SearchField<R, M> | readonly SearchField<R, M>[];
    /** Narrowing seeded on first bind. */
    initial?: RecordSliceWhere<R, M>;
    /** Named narrowings, selected one at a time. */
    presets?: readonly { id: string; name: string; where: RecordSliceWhere<R, M> }[];
}

/** Type-derived control information, also used to validate custom-control input. */
export interface RecordSliceFieldSchema {
    /** The actual scalar index key, including Option when present. */
    key: EastType;
    /** Inner control type. */
    inner: EastType;
    /** Whether a missing value is selectable. */
    optional: boolean;
    /** Whether the index fans out over a Set. */
    set: boolean;
    /** Closed renderer control kind. */
    kind: "string" | "boolean" | "enum" | "datetime" | "integer" | "float";
}

/**
 * Derive a supported control without putting an East type in the wire.
 * @param type - Record field type.
 * @param name - Field named in an actionable refusal.
 * @returns The scalar key type and control information.
 */
export function recordSliceFieldSchema(type: EastType, name: string): RecordSliceFieldSchema {
    const set = type.type === "Set";
    const key = type.type === "Set" ? type.key : type;
    const optional = key.type === "Variant" && Object.keys(key.cases).length === 2 && key.cases.none?.type === "Null" && key.cases.some !== undefined;
    const inner = optional && key.type === "Variant" ? key.cases.some! : key;
    let kind: RecordSliceFieldSchema["kind"];
    switch (inner.type) {
        case "String": kind = "string"; break;
        case "Boolean": kind = "boolean"; break;
        case "DateTime": kind = "datetime"; break;
        case "Integer": kind = "integer"; break;
        case "Float": kind = "float"; break;
        case "Variant":
            if ((Object.values(inner.cases) as EastType[]).some(value => value.type !== "Null")) throw new Error(`Slice.bindRecord: '${name}' needs a primitive field or a variant of unit cases`);
            kind = "enum";
            break;
        default: throw new Error(`Slice.bindRecord: '${name}' has no narrowing control; use a primitive field or a variant of unit cases`);
    }
    return { key, inner, optional, set, kind };
}

/**
 * Resolve indexed controls' types without reading records. Empty collection
 * markers carry computed types through serialization; row fields keep their
 * existing metadata. Reusing a field name with a different type is refused.
 * @param row - Stored row schema.
 * @param metadata - Ordered index metadata, when computed fields are offered.
 * @returns Stored and computed field types.
 * @internal
 */
export function recordSliceFieldTypes(row: StructType, metadata?: StructType): Record<string, EastType> {
    const fields: Record<string, EastType> = { ...row.fields };
    for (const index of Object.values(metadata?.fields ?? {}) as EastType[]) {
        if (index.type !== "Struct") continue;
        for (const [name, marker] of Object.entries(index.fields as Record<string, EastType>)) {
            if (marker.type !== "Array" && marker.type !== "Set") continue;
            const type = marker.type === "Array" ? marker.value : marker;
            if (fields[name] !== undefined && !isTypeEqual(fields[name]!, type)) {
                throw new Error(`Slice.bindRecord: indexed field '${name}' has inconsistent types; give a distinct computed value its own field name`);
            }
            fields[name] = type;
        }
    }
    return fields;
}

/** Default labels shared by inferred field names and enum cases. */
function label(name: string): string {
    const text = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function literal(schema: RecordSliceFieldSchema, input: unknown): string {
    let value = schema.kind === "enum" && isValueOf(input, StringType) ? variant(input as string, null) : input;
    if (schema.optional) value = input === null ? none : some(value);
    if (!isValueOf(value, schema.key)) throw new Error(`Slice.bindRecord: invalid ${schema.kind} choice`);
    return printFor(schema.key)(value);
}

/**
 * Bind a record through its field indexes. The source's joined entries retain
 * their primary keys; no row predicate or full-record read is generated.
 *
 * @param key - Stable UI state key.
 * @param source - A field-index binding, such as Data.bindPaged(record, { indexes }).
 * @param options - Fields, initial narrowing, range, search and presets.
 * @returns A serializable handle with typed narrowed data.
 */
export function bindRecord<K extends EastType, R extends StructType, P extends EastType, M extends StructType, IK extends VariantType>(
    key: SubtypeExprOrValue<StringType>,
    source: IndexedSource<K, R, P, M, IK>,
    options: RecordSliceOptions<NoInfer<R>, NoInfer<M>> = {},
): ExprType<ReturnType<typeof RecordSliceHandleType<ArrayType<ReturnType<typeof IndexedEntryType<K, R, P, IK>>>>>> {
    const sourceType = Expr.type(source);
    if (sourceType.type !== "Struct" || sourceType.fields.page?.type !== "Function" || sourceType.fields.indexes?.type !== "Struct") {
        throw new Error("Slice.bindRecord needs Data.bindPaged(record, { indexes }); a plain paged binding cannot be narrowed");
    }
    const output = sourceType.fields.page.output;
    if (output.type !== "Variant" || output.cases.some?.type !== "Array" || output.cases.some.value.type !== "Struct") throw new Error("Slice.bindRecord needs indexed record entries");
    const entry = output.cases.some.value;
    const rowOption = entry.fields.row;
    const projectionOption = entry.fields.value;
    if (rowOption?.type !== "Variant" || rowOption.cases.some?.type !== "Struct" || projectionOption?.type !== "Variant" || entry.fields.ik?.type !== "Variant" || entry.fields.key === undefined) {
        throw new Error("Slice.bindRecord needs indexed record entries with a Struct row");
    }
    const rowType = rowOption.cases.some;
    const metadata = sourceType.fields.indexes;
    const fieldTypes = recordSliceFieldTypes(rowType, metadata);
    if (!isSubtype(sourceType, IndexedSourceType(entry.fields.key, rowType, projectionOption.cases.some!, metadata, entry.fields.ik))) throw new Error("Slice.bindRecord needs an indexed record binding");
    const indexes: ValueTypeOf<RecordSliceConfigType>["indexes"] = Object.entries(metadata.fields).map(([name, type]) => {
        if (type.type !== "Struct") throw new Error("Slice.bindRecord needs field metadata on every index");
        const fields = Object.keys(type.fields);
        if (fields.length === 0) throw new Error(`Slice.bindRecord: '${name}' has no fields`);
        const markers = Object.entries(type.fields as Record<string, EastType>).filter(([, marker]) => marker.type === "Struct");
        if (markers.length > 1) throw new Error(`Slice.bindRecord: '${name}' has multiple interval fields`);
        const marker = markers[0];
        const ends = marker?.[1].type === "Struct" ? Object.keys(marker[1].fields) : [];
        if (marker !== undefined && (marker[0] !== fields.at(-1) || ends.length !== 1)) throw new Error(`Slice.bindRecord: '${name}' needs one final interval field`);
        const interval = marker === undefined ? none : some({ from: marker[0], to: ends[0]!,
            optional: recordSliceFieldSchema(rowType.fields[marker[0]]!, marker[0]).optional });
        const structured = entry.fields.ik.cases[name]?.type === "Struct";
        return { name, fields, sets: new Set(fields.filter(field => fieldTypes[field]?.type === "Set")),
            structured, interval };
    });
    const indexedFields = new Set(indexes.flatMap(index => index.fields));
    const offered = options.fields === undefined ? [...indexedFields] : Object.keys(options.fields);
    const schemas = new Map<string, RecordSliceFieldSchema>();
    const fields: ValueTypeOf<RecordSliceFieldType>[] = offered.map(field => {
        if (!indexedFields.has(field) || fieldTypes[field] === undefined) {
            throw new Error(`Slice.bindRecord: narrowing by '${field}' needs an index on it — e3.recordIndex("by_${field}", record, { on: ["${field}"] }), listed in Data.bindPaged's indexes`);
        }
        const schema = recordSliceFieldSchema(fieldTypes[field]!, field);
        schemas.set(field, schema);
        const config = options.fields?.[field as Field<M>];
        const known = config?.hints ?? (schema.kind === "boolean" ? [true, false]
            : schema.inner.type === "Variant" ? Object.keys(schema.inner.cases) : []);
        const values = [...known].map(value => ({ value: literal(schema, value), label: value === null ? "Unset" : schema.kind === "boolean" ? (value ? "Yes" : "No")
            : schema.kind === "enum" ? label(value as string) : isValueOf(value, StringType) ? value as string : printFor(schema.inner)(value) }));
        if (schema.optional && !values.some(value => value.value === printFor(schema.key)(none))) values.unshift({ value: printFor(schema.key)(none), label: "Unset" });
        return { fieldId: field, label: config?.label ?? label(field), kind: schema.kind, optional: schema.optional,
            multiple: !schema.set, set: schema.set, values, format: config?.format === undefined ? none : some(toValueFormat(config.format)) };
    });
    const getField = (field: string) => {
        const schema = schemas.get(field);
        if (schema === undefined) throw new Error(`Slice.bindRecord: '${field}' must be included in fields and ordered by a listed index`);
        return schema;
    };
    const makeWhere = (input: Record<string, unknown>): ValueTypeOf<RecordSliceWhereType> => {
        const where = new Map<string, ValueTypeOf<RecordSliceChoiceType>>();
        for (const [field, choice] of Object.entries(input)) {
            const schema = getField(field);
            if (Array.isArray(choice)) {
                if (choice.length === 0 || (schema.set && choice.length !== 1)) throw new Error(`Slice.bindRecord: '${field}' needs ${schema.set ? "exactly one value" : "at least one value"}`);
                where.set(field, variant("values", [...new Set(choice.map(value => literal(schema, value)))]));
            } else if (choice !== null && typeof choice === "object" && "prefix" in choice) {
                if (schema.kind !== "string" || schema.set || !isValueOf(choice.prefix, StringType)) throw new Error(`Slice.bindRecord: '${field}' cannot use a prefix; choose an exact value`);
                where.set(field, variant("prefix", choice.prefix as string));
            } else if (choice !== null && typeof choice === "object" && "from" in choice && "to" in choice) {
                if (schema.set || !["datetime", "integer", "float"].includes(schema.kind)) throw new Error(`Slice.bindRecord: '${field}' cannot use a range`);
                const from = literal(schema, choice.from);
                const to = literal(schema, choice.to);
                if (compareFor(schema.inner)(choice.from, choice.to) >= 0) throw new Error(`Slice.bindRecord: '${field}' needs an increasing half-open range`);
                where.set(field, variant("range", { from, to }));
            } else throw new Error(`Slice.bindRecord: '${field}' needs values, a range or a prefix`);
        }
        if (planRecordSlice(indexes, where, "primary") === null) throw new Error("Slice.bindRecord: this narrowing needs one index on its exact fields followed by its range or prefix");
        return where;
    };
    const range = options.range;
    if (range !== undefined) {
        const schema = getField(range);
        if (schema.set || !["datetime", "integer", "float"].includes(schema.kind)) throw new Error(`Slice.bindRecord: range '${range}' must be DateTime, Integer or Float`);
    }
    const search = options.search === undefined ? fields.filter(field => field.kind === "string").map(field => field.fieldId) : typeof options.search === "string" ? [options.search] : [...options.search];
    for (const field of search) if (getField(field).kind !== "string") throw new Error(`Slice.bindRecord: search '${field}' must be String`);
    // A String field's editor offers its hints and, when searched, what a search finds: with neither it offers nothing to choose.
    for (const field of fields) {
        if (field.kind === "string" && (options.fields?.[field.fieldId as Field<M>]?.hints?.length ?? 0) === 0 && !search.includes(field.fieldId)) {
            throw new Error(`Slice.bindRecord: '${field.label}' offers nothing to choose — give it hints, or list '${field.fieldId}' in search`);
        }
    }
    const initial = { where: makeWhere(options.initial ?? {}), preset: none, resolution: none };
    const presetIds = new Set<string>();
    const presets = (options.presets ?? []).map(preset => {
        if (presetIds.has(preset.id)) throw new Error(`Slice.bindRecord: repeated preset '${preset.id}'`);
        presetIds.add(preset.id);
        return { id: preset.id, name: preset.name, where: makeWhere(preset.where) };
    });
    const config = { fields, indexes, range: range === undefined ? none : some(range), search, presets };
    return recordSliceBindPlatform([sourceType, output.cases.some], key, source as never,
        East.value(config, RecordSliceConfigType), East.value(initial, RecordSliceStateType)) as never;
}
