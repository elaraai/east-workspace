/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typed record Slice authoring. Query execution belongs to the renderer. */
import {
    ArrayType, BooleanType, DateTimeType, East, Expr, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, SetType,
    compareFor, isSubtype, isTypeEqual, isValueOf, none, printFor, printType, some, variant,
    type ArrayExpr, type EastType, type ExprType, type SubtypeExprOrValue, type ValueTypeOf,
} from "@elaraai/east";
import { IndexedEntryType, IndexedSourceType, type IndexedSource } from "../../contracts/indexed-source.js";
import { toValueFormat, type SliceFieldFormat } from "./index.js";
import { planRecordSlice, recordEntriesFields, recordIndexFields, recordPlanIndex, recordScopeSearchIndex } from "./record-plan.js";
import { readAreaMarker } from "./record-area.js";
import { readIntervalMarker } from "./record-interval.js";
import { readTileMarker, tilingOf } from "./record-series.js";
import { recordOnPrinters } from "./record-on.js";
import {
    RecordSliceConfigType, RecordSliceStateType, RecordSliceHandleType, recordSliceBindPlatform,
    type RecordSliceChoiceType, type RecordSliceFieldType, type RecordSliceWhereType,
} from "./record-types.js";

/** The row field an interval index's start is, as its kind's marker names it (`from=…`, #1432). */
type IntervalFrom<K> = K extends { interval: StructType<infer Roles> }
    ? { [N in keyof Roles]: N extends `from=${infer F}` ? F : never }[keyof Roles] : never;
/** The fields the rail may narrow by, index by index (#1432): its `fields` and an interval's start — none of a
 *  series or a summary index's, whose cells a reader reads (#1039); an index whose fields are any string offers any. */
type IndexedFields<M extends StructType> = {
    [I in keyof M["fields"]]: M["fields"][I] extends StructType<{ fields: StructType<infer F>; kind: VariantType<infer K> }>
        ? string extends keyof F ? keyof F
            : "series" extends keyof K ? never : "summary" extends keyof K ? never
                : keyof F | IntervalFrom<K>
        : never;
}[keyof M["fields"]];
/** A field the rail may narrow by: a row field an index is led by, or an interval's start. */
type Field<M extends StructType> = Extract<IndexedFields<M>, string>;
type MarkerType<R extends StructType, F extends string, T> = T extends ArrayType<infer V> ? V
    : T extends SetType ? T : F extends keyof R["fields"] ? R["fields"][F] : never;
type FieldType<R extends StructType, M extends StructType, F extends string> = {
    [I in keyof M["fields"]]: M["fields"][I] extends StructType<{ fields: StructType<infer Fields>; kind: VariantType<infer K> }>
        ? F extends keyof Fields ? MarkerType<R, F, Fields[F]>
            : F extends IntervalFrom<K> ? F extends keyof R["fields"] ? R["fields"][F] : never : never
        : never;
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
/** The fields an entries index offers (#1522): each a Dict field of the rows, its keys picked as a Set's elements are, and never
 *  searched. An index whose kind is any kind names none. */
type EntriesField<M extends StructType> = {
    [I in keyof M["fields"]]: M["fields"][I] extends StructType<{ fields: StructType<infer F>; kind: VariantType<infer K> }>
        ? string extends keyof K ? never : "entries" extends keyof K ? keyof F : never
        : never;
}[keyof M["fields"]];
type SearchField<R extends StructType, M extends StructType> = {
    [F in Exclude<Field<M>, EntriesField<M>>]: Scalar<FieldType<R, M, F>> extends StringType ? F : never;
}[Exclude<Field<M>, EntriesField<M>>];
type Choice<T extends EastType> = readonly RecordSliceValue<T>[] | (T extends SetType ? never
    : Scalar<T>["type"] extends "DateTime" | "Integer" | "Float" ? { from: Exclude<RecordSliceValue<T>, null>; to: Exclude<RecordSliceValue<T>, null> }
        : Scalar<T> extends StringType ? { prefix: string } : never);
/** Typed per-field narrowing; clauses must be answerable by one declared index. */
export type RecordSliceWhere<R extends StructType, M extends StructType> = { [F in Field<M>]?: Choice<FieldType<R, M, F>> };
/** One exact value of a scope's list: a value as `initial` takes one, or an East expression of the field's type — a page's parameter. */
type ScopeValue<T extends EastType> = RecordSliceValue<T> | ExprType<Key<T>> | ExprType<Scalar<T>>;
/**
 * A page's scope (#1621): a field of the rows to the list of its exact values the page holds — written in the code,
 * each a value or an East expression, or the whole list one East expression. An entries index's Dict field takes none.
 */
export type RecordSliceScope<R extends StructType, M extends StructType> = {
    [F in Exclude<Field<M>, EntriesField<M>>]?: readonly ScopeValue<FieldType<R, M, F>>[]
        | ExprType<ArrayType<Key<FieldType<R, M, F>>>> | ExprType<ArrayType<Scalar<FieldType<R, M, F>>>>;
};

/** A value a field offers: the value alone, shown as it is, or with the words the rail shows it by. */
export type RecordSliceHint<V> = V | { readonly value: V; readonly label: string };

/** Options inferred from the record's row and its binding's declared indexes. */
export interface RecordSliceOptions<R extends StructType, M extends StructType> {
    /** Offered fields; omitted means all indexed fields. A hint is a value, or a value and the words the rail shows it by (`{ value: "in_progress", label: "In progress" }`). */
    fields?: { [F in Field<M>]?: { label?: string; format?: SliceFieldFormat; hints?: readonly RecordSliceHint<RecordSliceValue<FieldType<R, M, F>>>[] } };
    /** Ranged field shared by the range control and a Plan's window. */
    range?: RangeField<R, M>;
    /** Prefix-search fields; omitted means all offered String fields. A String field with no hints is refused unless it is one of them: it would offer nothing to choose. */
    search?: SearchField<R, M> | readonly SearchField<R, M>[];
    /** Narrowing seeded on first bind. */
    initial?: RecordSliceWhere<R, M>;
    /**
     * The page's scope (#1621): a narrowing the page holds and the viewer cannot clear — a field of the rows to a list
     * of its exact values, each a value as `initial` takes one or an East expression of the field's type, so a page's
     * parameter goes in (`scope: { press: [press] }`). Every read of the source carries it beside the rail's choices;
     * the rail offers no control of a scoped field, and Clear all and a preset leave it. Each field the rail offers is
     * answered by one listed index led by the scope's fields (`index.on(["press", "start"])`). A list written here is
     * never empty; one that is an East expression may be, and the source then reads no rows. A scope is no access rule:
     * e3 serves the record's other rows to whoever may read it.
     */
    scope?: RecordSliceScope<R, M>;
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
 * existing metadata. Reusing a field name with a different type is refused,
 * save an entries index's Dict field of the rows (#1522): a Set marker of the
 * Dict's key type carries it, and it is picked as a Set's elements are.
 * @param row - Stored row schema.
 * @param metadata - Ordered index metadata, when computed fields are offered.
 * @returns Stored and computed field types.
 * @internal
 */
export function recordSliceFieldTypes(row: StructType, metadata?: StructType): Record<string, EastType> {
    const fields: Record<string, EastType> = { ...row.fields };
    for (const index of Object.values(metadata?.fields ?? {}) as EastType[]) {
        // Each index's metadata is `{ fields, kind }` (#1432): its row fields carry the markers.
        const led = index.type === "Struct" ? (index.fields as Record<string, EastType>).fields : undefined;
        if (led?.type !== "Struct") continue;
        const kind = index.type === "Struct" ? (index.fields as Record<string, EastType>).kind : undefined;
        const entries = kind?.type === "Variant" && Object.hasOwn(kind.cases, "entries");
        for (const [name, marker] of Object.entries(led.fields as Record<string, EastType>)) {
            if (marker.type !== "Array" && marker.type !== "Set") continue;
            const type = marker.type === "Array" ? marker.value : marker;
            const held = row.fields[name];
            if (entries && marker.type === "Set" && held?.type === "Dict" && fields[name] === held && isTypeEqual(held.key, marker.key)) {
                fields[name] = type;
                continue;
            }
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

/** A value written in the code, as the field holds it: a unit variant's case by its name, an optional field's value in its Option, `null` its none. */
function written(schema: RecordSliceFieldSchema, input: unknown): unknown {
    const value = schema.kind === "enum" && isValueOf(input, StringType) ? variant(input as string, null) : input;
    return schema.optional ? input === null ? none : some(value) : value;
}

function literal(schema: RecordSliceFieldSchema, input: unknown): string {
    const value = written(schema, input);
    if (!isValueOf(value, schema.key)) throw new Error(`Slice.bindRecord: invalid ${schema.kind} choice`);
    return printFor(schema.key)(value);
}

/** The types a value written in the code may be, by what East takes it for: how a refusal names the type of one. */
const WRITTEN = [StringType, IntegerType, FloatType, BooleanType, DateTimeType, NullType] as const;

/**
 * A scoped field's exact values, as the literals a narrowing holds (#1621): a
 * list written in the code, each of its values a value or an East expression
 * of the field's type, or the whole list one East expression. An expression is
 * printed where the page runs, so a page's parameter goes in.
 * @param field - The scoped field, named in a refusal.
 * @param schema - Its control information: the type its values are of.
 * @param list - The list the author gave.
 * @returns The literals: an Array of them, or an East expression of one.
 * @throws {Error} When the list is written empty, a Set field's is not one written value, or a value is of another
 *   type than the field's — naming the field and both types.
 */
function scopeValues(field: string, schema: RecordSliceFieldSchema, list: unknown): SubtypeExprOrValue<ArrayType<StringType>> {
    const takes = `'${field}' takes values of its type, ${printType(schema.key)}${schema.optional ? ` (or ${printType(schema.inner)}, a value it holds)` : ""}`;
    /** An expression of the field's type printed as it is, or as the value an optional field holds. */
    const printed = (value: Expr, type: EastType, given: string): ExprType<StringType> => {
        if (isTypeEqual(type, schema.key)) return East.print(value);
        if (schema.optional && isTypeEqual(type, schema.inner)) return East.print(East.value(some(value) as never, schema.key) as Expr);
        throw new Error(`Slice.bindRecord: the scope's ${takes}, and was given ${given} of type ${printType(type)}`);
    };
    if (list instanceof Expr) {
        const type = Expr.type(list);
        if (type.type !== "Array") {
            throw new Error(`Slice.bindRecord: the scope's ${takes}, as a list — [value, …] or an East expression of an Array — and was given an expression of type ${printType(type)}`);
        }
        if (schema.set) {
            throw new Error(`Slice.bindRecord: the scope's '${field}' fans out over a Set, which a narrowing reads by exactly one value — write its list in the code, with one value`);
        }
        const element = type.value as EastType;
        return (list as ArrayExpr<EastType>).map((_$, value) => printed(value as Expr, element, "an Array of values"));
    }
    if (!Array.isArray(list)) throw new Error(`Slice.bindRecord: the scope's ${takes}, as a list — [value, …] or an East expression of an Array`);
    if (list.length === 0) {
        throw new Error(`Slice.bindRecord: the scope's '${field}' (${printType(schema.key)}) lists no value, and would read no rows — list at least one, or leave '${field}' out of the scope`);
    }
    if (schema.set && list.length !== 1) {
        throw new Error(`Slice.bindRecord: the scope's '${field}' fans out over a Set, which a narrowing reads by exactly one value, and lists ${list.length}`);
    }
    return (list as unknown[]).map((value) => {
        if (value instanceof Expr) return printed(value, Expr.type(value), "an expression");
        const own = written(schema, value);
        if (isValueOf(own, schema.key)) return printFor(schema.key)(own);
        const type = WRITTEN.find(candidate => isValueOf(value, candidate));
        throw new Error(`Slice.bindRecord: the scope's ${takes}, and was given ${type === undefined ? "a value of no type it takes" : `a value of type ${printType(type)}`}`);
    });
}

/**
 * Bind a record through its field indexes. The source's joined entries retain
 * their primary keys; no row predicate or full-record read is generated.
 *
 * Each index's metadata names the row fields it is led by and its kind
 * (#1432): a plain index's fields, a generated index's `on`; e3's own parts
 * are the kind's, never a field of the rail, so a row field may be named
 * anything. An area index (`index.area`) offers its leading fields; a
 * read by area gives its `window` — or the unplaced clause — beside the
 * narrowing, in the read `pageWhere` and `countWhere` take, and the plan reads
 * it through an area index whose leading fields the narrowing fills exactly
 * (#1385). An interval index offers its leading fields and its start.
 *
 * A series or a summary index (`index.series`, `index.summary`) offers no
 * field at all: it is listed for a reader of its cells (#1039), and its
 * metadata says how it files the record's events.
 *
 * An entries index (`index.entries`, #1522) offers its Dict field: the rail
 * lists the Dict's keys as the field's values, from its hints, each counted by
 * the rows holding it, and takes several of them. Its picks weigh what a
 * reader draws of each row — a Flowchart's details adding up the picked
 * entries — and narrow none of the rows, so they stand beside every other
 * field's choices.
 *
 * A source's `scope` is a narrowing its page holds (#1621): exact values of
 * indexed fields, each a value or an East expression, which every read of the
 * source carries beside the rail's choices. The rail offers no control of a
 * scoped field, and Clear all and a preset leave the scope as it is. Each
 * field the rail offers — its `range` and its `search` among them — is
 * answered by one listed index led by the scope's fields, and the scope by one
 * alone; otherwise the build refuses, naming the index to declare. The handle
 * names the scoped fields in its type (`scoped`).
 *
 * @param key - Stable UI state key.
 * @param source - A field-index binding, such as Data.bindPaged(record, { indexes }).
 * @param options - Fields, initial narrowing, the page's scope, range, search and presets.
 * @returns A serializable handle with typed narrowed data.
 * @throws {Error} When the source is no indexed record binding; when a field, a narrowing, the range or a search field
 *   has no listed index to answer it; and when the scope names a field no listed index is led by, holds a value of
 *   another type than its field's or a list written empty, or leaves a field the rail offers with no index led by the
 *   scope's fields — each naming the field, and the types or the index to declare
 */
export function bindRecord<K extends EastType, R extends StructType, P extends EastType, M extends StructType, IK extends VariantType, N extends EastType,
    Maint extends EastType>(
    key: SubtypeExprOrValue<StringType>,
    source: IndexedSource<K, R, P, M, IK, N, Maint>,
    options: RecordSliceOptions<NoInfer<R>, NoInfer<M>> = {},
): ExprType<ReturnType<typeof RecordSliceHandleType<ArrayType<ReturnType<typeof IndexedEntryType<K, R, P, IK>>>, M, N,
    ReturnType<typeof IndexedSourceType<K, R, P, M, IK, N, Maint>>, StructType>>> {
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
    const nested = sourceType.fields.nested;
    const maintenance = sourceType.fields.maintenance;
    if (nested === undefined || maintenance === undefined) throw new Error("Slice.bindRecord needs Data.bindPaged(record, { indexes }); a plain paged binding cannot be narrowed");
    if (!isSubtype(sourceType, IndexedSourceType(entry.fields.key, rowType, projectionOption.cases.some!, metadata, entry.fields.ik, nested, maintenance))) {
        throw new Error("Slice.bindRecord needs an indexed record binding");
    }
    type Index = ValueTypeOf<RecordSliceConfigType>["indexes"][number];
    const unmarked = (name: string, kind: string) =>
        new Error(`Slice.bindRecord: '${name}' has no ${kind} index's marker; bind it with Data.bindPaged(record, { indexes })`);
    const indexes: Index[] = Object.entries(metadata.fields).map(([name, type]) => {
        // An index's metadata (#1432): the row fields it is led by, and its kind's one case, its marker naming e3's own parts.
        const led = type.type === "Struct" ? (type.fields as Record<string, EastType>).fields : undefined;
        const kinds = type.type === "Struct" ? (type.fields as Record<string, EastType>).kind : undefined;
        if (led?.type !== "Struct" || kinds?.type !== "Variant" || Object.keys(kinds.cases).length !== 1) {
            throw new Error(`Slice.bindRecord: '${name}' needs its fields and its kind; bind it with Data.bindPaged(record, { indexes })`);
        }
        const fields = Object.keys(led.fields);
        const [kind, marker] = Object.entries(kinds.cases as Record<string, EastType>)[0]!;
        const names = marker.type === "Struct" ? Object.keys(marker.fields) : [];
        let interval: Index["interval"] = none;
        let area: Index["area"] = none;
        let series: Index["series"] = none;
        let summary: Index["summary"] = none;
        let entries = false;
        if (kind === "plain") {
            if (fields.length === 0) throw new Error(`Slice.bindRecord: '${name}' has no fields`);
        } else if (kind === "entries") {
            // One Dict field of the rows, filed entry by entry (#1522): the rail's field, its keys the values.
            const held = fields.length === 1 ? rowType.fields[fields[0]!] : undefined;
            if (held?.type !== "Dict") {
                throw new Error(`Slice.bindRecord: '${name}' is an entries index, which files one Dict field of the rows, and its metadata names ` +
                    `${fields.length === 1 ? `'${fields[0]}', which is not one` : `${fields.length} fields`}; bind it with Data.bindPaged(record, { indexes })`);
            }
            entries = true;
        } else if (kind === "series" || kind === "summary") {
            const tiling = readTileMarker(names);
            if (tiling === undefined || tiling.summary !== (kind === "summary") || [tiling.key, tiling.from, tiling.to].some(field => rowType.fields[field] === undefined)) {
                throw unmarked(name, `${kind}`);
            }
            const filed = some({ key: tiling.key, from: tiling.from, to: tiling.to, tile: variant(tiling.tile, null) });
            if (tiling.summary) summary = filed;
            else series = filed;
        } else if (kind === "area") {
            const box = readAreaMarker(names);
            const xType = box === undefined ? undefined : rowType.fields[box.x];
            if (box === undefined || xType === undefined) throw unmarked(name, "an area");
            area = some({ x: box.x, y: box.y, width: box.width === undefined ? none : some(box.width), height: box.height === undefined ? none : some(box.height),
                centre: box.centre, cell: box.cell, optional: isTypeEqual(xType, OptionType(FloatType)) });
        } else if (kind === "interval") {
            const ends = readIntervalMarker(names);
            if (ends === undefined || rowType.fields[ends.from] === undefined) throw unmarked(name, "an interval");
            interval = some({ from: ends.from, to: ends.to, optional: recordSliceFieldSchema(rowType.fields[ends.from]!, ends.from).optional });
        } else {
            throw new Error(`Slice.bindRecord: '${name}' is of a kind no record Slice reads, '${kind}'`);
        }
        const structured = entry.fields.ik.cases[name]?.type === "Struct";
        // An entries index fans out over its Dict's keys, and narrows nothing: no path reads its field.
        return { name, fields, sets: new Set(entries ? [] : fields.filter(field => fieldTypes[field]?.type === "Set")),
            structured, interval, area, series, summary, entries };
    });
    const weighing = recordEntriesFields(indexes);
    // A series or a summary index offers nothing: a reader reads its cells. An interval's start is a range the rail reads.
    const indexedFields = new Set(indexes.flatMap(index => tilingOf(index) !== undefined ? [] : recordIndexFields(index)));
    const printOn = recordOnPrinters(entry.fields.ik.cases as Record<string, EastType>);
    // The page's scope (#1621): exact values of fields an index is led by, which every read of the source carries.
    const scope = new Map<string, variant<"values", SubtypeExprOrValue<ArrayType<StringType>>>>();
    for (const [field, list] of Object.entries((options.scope ?? {}) as Record<string, unknown>)) {
        if (list === undefined) continue;
        if (weighing.has(field)) {
            throw new Error(`Slice.bindRecord: the scope's '${field}' is a Dict field an entries index files, whose keys weigh the rows and narrow none — scope a field an index is led by`);
        }
        if (!indexedFields.has(field) || fieldTypes[field] === undefined) {
            throw new Error(`Slice.bindRecord: the scope's '${field}' needs an index led by it — by_${field}: index.on(["${field}"]) among the record's indexes, listed in Data.bindPaged's indexes`);
        }
        scope.set(field, variant("values", scopeValues(field, recordSliceFieldSchema(fieldTypes[field]!, field), list)));
    }
    const scoped = [...scope.keys()];
    const declare = (path: readonly string[]) => `by_${path.join("_")}: index.on([${path.map(name => JSON.stringify(name)).join(", ")}]) among the record's indexes, listed in Data.bindPaged's indexes`;
    /** A narrowing as the matcher reads it beside the scope: each scoped field an exact choice, whatever its values are when the page runs. */
    const beside = (where: ReadonlyMap<string, ValueTypeOf<RecordSliceChoiceType>>) =>
        new Map<string, ValueTypeOf<RecordSliceChoiceType>>([...where, ...scoped.map(name => [name, variant("values", [""])] as const)]);
    if (scoped.length > 0 && recordPlanIndex(indexes, beside(new Map())) === undefined) {
        throw new Error(`Slice.bindRecord: the scope (${scoped.map(name => `'${name}'`).join(", ")}) needs one index led by exactly its fields — ${declare(scoped)}`);
    }
    // Search Records seeks the page's keys among the scope's rows (#1621), which run in their keys' order only through a
    // plain index on exactly the scope's fields: an interval, an area or a series index led by them orders them otherwise.
    if (scoped.length > 0 && recordScopeSearchIndex(indexes, scoped) === undefined) {
        throw new Error(`Slice.bindRecord: Search Records finds a row among the scope's (${scoped.map(name => `'${name}'`).join(", ")}) by its key, ` +
            `through an index on exactly the scope's fields, whose rows run in their keys' order — ${declare(scoped)}`);
    }
    /** What a refusal says of a scoped field named where the rail's own fields go. */
    const held = (field: string, where: string) =>
        new Error(`Slice.bindRecord: '${field}' is in the scope, which every read holds and the rail shows no control for — leave it out of ${where}`);
    for (const field of Object.keys(options.fields ?? {})) if (scope.has(field)) throw held(field, "fields");
    const offered = options.fields === undefined ? [...indexedFields].filter(field => !scope.has(field)) : Object.keys(options.fields);
    /** Whether a listed index is led by the scope's fields and takes the field after them: what answers a choice of it on this page. */
    const answered = (field: string) => indexes.some(index => {
        if (tilingOf(index) !== undefined || index.entries) return false;
        const path = recordIndexFields(index);
        return scoped.every(name => path.indexOf(name) >= 0 && path.indexOf(name) < scoped.length) && path.indexOf(field) >= scoped.length;
    });
    const schemas = new Map<string, RecordSliceFieldSchema>();
    const fields: ValueTypeOf<RecordSliceFieldType>[] = offered.map(field => {
        if (!indexedFields.has(field) || fieldTypes[field] === undefined) {
            throw new Error(`Slice.bindRecord: narrowing by '${field}' needs an index on it — by_${field}: index.on(["${field}"]) among the record's indexes, listed in Data.bindPaged's indexes`);
        }
        if (scoped.length > 0 && weighing.has(field)) {
            throw new Error(`Slice.bindRecord: '${field}' is a Dict field the rail counts by its entries index, across the whole record, and this source is scoped — ` +
                `${options.fields === undefined ? "list the fields the rail offers in fields, without it" : "leave it out of fields"}`);
        }
        if (scoped.length > 0 && !answered(field)) {
            throw new Error(`Slice.bindRecord: narrowing by '${field}' beside the scope (${scoped.map(name => `'${name}'`).join(", ")}) needs one index led by the scope's fields, then it — ` +
                `${declare([...scoped, field])}${options.fields === undefined ? "; or list the fields the rail offers in fields, without it" : ""}`);
        }
        const schema = recordSliceFieldSchema(fieldTypes[field]!, field);
        schemas.set(field, schema);
        const config = options.fields?.[field as Field<M>];
        const known = config?.hints ?? (schema.kind === "boolean" ? [true, false]
            : schema.inner.type === "Variant" ? Object.keys(schema.inner.cases) : []);
        const values = [...known].map((hint: unknown) => {
            // An authored `{ value, label }`: never an East value, which a field's scalar kinds are none of.
            const labelled = hint !== null && typeof hint === "object" && "label" in hint && "value" in hint ? hint as { value: unknown; label: string } : undefined;
            const value = labelled === undefined ? hint : labelled.value;
            return { value: literal(schema, value), label: labelled?.label ?? (value === null ? "Unset" : schema.kind === "boolean" ? (value ? "Yes" : "No")
                : schema.kind === "enum" ? label(value as string) : isValueOf(value, StringType) ? value as string : printFor(schema.inner)(value)) };
        });
        if (schema.optional && !values.some(value => value.value === printFor(schema.key)(none))) values.unshift({ value: printFor(schema.key)(none), label: "Unset" });
        // An entries field takes several keys, each weighing the rows by its entries (#1522).
        const weighs = weighing.has(field);
        return { fieldId: field, label: config?.label ?? label(field), kind: schema.kind, optional: schema.optional,
            multiple: !schema.set || weighs, set: schema.set && !weighs, values, format: config?.format === undefined ? none : some(toValueFormat(config.format)) };
    });
    const getField = (field: string) => {
        const schema = schemas.get(field);
        if (schema === undefined) throw new Error(`Slice.bindRecord: '${field}' must be included in fields and ordered by a listed index`);
        return schema;
    };
    const makeWhere = (input: Record<string, unknown>): ValueTypeOf<RecordSliceWhereType> => {
        const where = new Map<string, ValueTypeOf<RecordSliceChoiceType>>();
        for (const [field, choice] of Object.entries(input)) {
            if (scope.has(field)) throw held(field, "initial and every preset");
            const schema = getField(field);
            if (Array.isArray(choice)) {
                const one = schema.set && !weighing.has(field);
                if (choice.length === 0 || (one && choice.length !== 1)) throw new Error(`Slice.bindRecord: '${field}' needs ${one ? "exactly one value" : "at least one value"}`);
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
        if (scoped.length === 0) {
            if (planRecordSlice(indexes, where, "primary", undefined, printOn) === null) throw new Error("Slice.bindRecord: this narrowing needs one index on its exact fields followed by its range or prefix");
        } else if (recordPlanIndex(indexes, beside(where)) === undefined) {
            // The scope's values are the page's when it runs: the narrowing is matched beside it by its shape.
            throw new Error(`Slice.bindRecord: this narrowing, beside the scope (${scoped.map(name => `'${name}'`).join(", ")}), needs one index on the scope's fields and its exact fields followed by its range or prefix`);
        }
        return where;
    };
    const range = options.range;
    if (range !== undefined) {
        if (scope.has(range)) throw held(range, "range");
        const schema = getField(range);
        if (schema.set || !["datetime", "integer", "float"].includes(schema.kind)) throw new Error(`Slice.bindRecord: range '${range}' must be DateTime, Integer or Float`);
    }
    const search = options.search === undefined ? fields.filter(field => field.kind === "string" && !weighing.has(field.fieldId)).map(field => field.fieldId)
        : typeof options.search === "string" ? [options.search] : [...options.search];
    for (const field of search) {
        if (scope.has(field)) throw held(field, "search");
        if (weighing.has(field)) throw new Error(`Slice.bindRecord: '${field}' is a Dict field the rail lists by its hints, and is not searched — leave it out of search`);
        if (getField(field).kind !== "string") throw new Error(`Slice.bindRecord: search '${field}' must be String`);
    }
    // An entries field offers its keys from its hints alone (#1522): with none it offers nothing to choose.
    for (const field of fields) {
        if (weighing.has(field.fieldId) && field.values.length === 0) {
            throw new Error(`Slice.bindRecord: '${field.label}' offers nothing to choose — give it hints, the keys of '${field.fieldId}' it lists`);
        }
    }
    // A String field's editor offers its hints and, when searched, what a search finds: with neither it offers nothing to choose.
    for (const field of fields) {
        if (weighing.has(field.fieldId)) continue;
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
    const config = { fields, indexes, range: range === undefined ? none : some(range), search, presets, scope };
    // The scoped fields, named in the handle's type: a builder writes a new row's scoped fields from them (#1621).
    const scopedType = StructType(scoped.map(name => [name, NullType] as const));
    return recordSliceBindPlatform([sourceType, output.cases.some, metadata, nested, scopedType], key, source as never,
        East.value(config, RecordSliceConfigType), East.value(initial, RecordSliceStateType)) as never;
}
