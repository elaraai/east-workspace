/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio sources (#1669) — the data a surface's visuals may read: each a
 * bound handle, and what operators see of it.
 *
 * `Studio.source(handle, meta)` declares one over a `Data.bind`,
 * `Data.bindPaged` or `Record.bind` handle. A surface lists its sources by
 * the names a visual's query reads them by — `sources={{ orders:
 * Studio.source(orders, { … }) }}` reads `.orders` — as `Query.Builder`'s
 * `datasets` are keyed. A source's rows are an Array of Structs, or a Dict of
 * Structs; a field's kind is read from the row's type, and its label made
 * from its name unless given.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DictType,
    East,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    printType,
    some,
    variant,
    type EastType,
    type ExprType,
    type FunctionType,
    type TypeOf,
} from "@elaraai/east";
import { ValueFormatType, sliceFieldKind, toValueFormat, type SliceFieldFormat } from "@elaraai/east-ui/internal";
import { DataSourceType, dataSource, type BoundSource } from "../bind/sources.js";
import { nameWords } from "./component.js";

// ============================================================================
// Types
// ============================================================================

/**
 * What kind of field a source's field is: which wells of a visual take it.
 *
 * @property date - A date and time
 * @property text - Text
 * @property number - A whole number or a decimal
 * @property boolean - Yes or no
 * @property other - Anything else: a struct, a list, a case of several
 */
export const StudioFieldKindType = VariantType({
    date: NullType,
    text: NullType,
    number: NullType,
    boolean: NullType,
    other: NullType,
});

/** Type representing a field's kind. */
export type StudioFieldKindType = typeof StudioFieldKindType;

/**
 * One field of a source, as operators see it.
 *
 * @property id - The field: its name in the source's row, which a visual stores
 * @property label - Its label
 * @property kind - Its kind, read from the row's type; an optional field's is its value's
 * @property format - How its values are shown; `none` shows them plainly
 */
export const StudioFieldType = StructType({
    id: StringType,
    label: StringType,
    kind: StudioFieldKindType,
    format: OptionType(ValueFormatType),
});

/** Type representing one field of a source. */
export type StudioFieldType = typeof StudioFieldType;

/**
 * A source a surface's visuals may read — data only, with no function.
 *
 * @property key - The name a visual's query reads it by: `orders` for `.orders`; a visual stores it
 * @property name - Its name, as operators see it
 * @property icon - A Font Awesome solid icon name
 * @property description - What one row is; `none` says nothing
 * @property binding - The binding it is, and its value's type
 * @property fields - The fields operators may use, in order
 * @property range - The date field the page's range narrows; `none` has no range
 * @property search - The fields the page's search reads
 * @property split - The fields the page may split its charts by
 */
export const StudioSourceType = StructType({
    key: StringType,
    name: StringType,
    icon: StringType,
    description: OptionType(StringType),
    binding: DataSourceType,
    fields: ArrayType(StudioFieldType),
    range: OptionType(StringType),
    search: ArrayType(StringType),
    split: ArrayType(StringType),
});

/** Type representing a source a surface's visuals may read. */
export type StudioSourceType = typeof StudioSourceType;

/**
 * Each listed source's name, by its key: what a visual's source is called
 * wherever a placement's content is said in words. A key two sources share
 * keeps the first one's name.
 */
export const sourceNames = East.function(
    [ArrayType(StudioSourceType)],
    DictType(StringType, StringType),
    (_$, sources) => sources.toDict((_$2, source) => source.key, (_$2, source) => source.name, (_$2, first) => first),
);

/**
 * A source's name, by its key, among the listed sources' names
 * ({@link sourceNames}): the name it is listed under, else its key — the
 * surface lists no source of that key.
 */
export const sourceName = East.function(
    [StringType, DictType(StringType, StringType)],
    StringType,
    (_$, key, sources) => sources.tryGet(key).match({
        some: (_$2, name) => name,
        none: (_$2) => key,
    }),
);

// ============================================================================
// Authoring
// ============================================================================

/** The fields of a handle's East struct. */
type HandleFields<H> = TypeOf<H> extends StructType<infer F> ? F : never;

/** The East type of the value a handle reads: a paged handle's page, else what `read` gives. */
type SourceValue<H> =
    HandleFields<H> extends { page: FunctionType<any, OptionType<infer T>> } ? T
        : HandleFields<H> extends { read: FunctionType<any, infer T> } ? T
            : never;

/** The fields of a value's rows: an Array's elements, or a Dict's values. */
type RowFields<T> = T extends ArrayType<StructType<infer R>> ? R : T extends DictType<any, StructType<infer R>> ? R : never;

/**
 * The names of the fields of a handle's rows; any name where the handle's
 * type does not say, which the surface's build then checks.
 *
 * @typeParam H - The bound handle
 */
export type StudioSourceField<H> = [keyof RowFields<SourceValue<H>>] extends [never] ? string : string & keyof RowFields<SourceValue<H>>;

/**
 * What operators see of a source — its `meta`. Only `name` and `icon` are
 * required.
 *
 * @typeParam F - The names of the fields of the source's rows
 *
 * @property name - Its name
 * @property icon - A Font Awesome solid icon name
 * @property description - What one row is — "One row per order line"
 * @property fields - The fields operators may use, in order, each with a label and a format; every field of the row, labelled from its name, when omitted
 * @property range - The date field the page's range narrows
 * @property search - The fields the page's search reads
 * @property split - The fields the page may split its charts by
 */
export interface StudioSourceMeta<F extends string = string> {
    /** Its name, as operators see it. */
    name: string;
    /** A Font Awesome solid icon name. */
    icon: string;
    /** What one row is — "One row per order line". */
    description?: string;
    /**
     * The fields operators may use, in the order given: each its label —
     * made from its name when omitted — and how its values are shown.
     * Omitted, every field of the row is offered.
     */
    fields?: { [K in F]?: { label?: string; format?: SliceFieldFormat } };
    /** The date field the page's range narrows. */
    range?: F;
    /** The fields the page's search reads. */
    search?: readonly F[];
    /** The fields the page may split its charts by. */
    split?: readonly F[];
}

/** A source as `Studio.source` declares it: its handle, and what operators see of it. A surface lists them under the names its visuals read them by. */
export interface StudioSourceDeclaration {
    /** The bound handle. */
    readonly handle: BoundSource;
    /** What operators see of it. */
    readonly meta: StudioSourceMeta;
}

/**
 * Declares a source a surface's visuals may read: a bound handle, and what
 * operators see of it.
 *
 * @remarks
 * A source is a `Data.bind`, `Data.bindPaged` or `Record.bind` handle the
 * surface binds, so it is in the surface's manifest already. `fields`,
 * `range`, `search` and `split` name the row's own fields: TypeScript holds
 * them to it, and the surface's build refuses a name the row lacks, naming
 * the source. The source's key is the name it is listed under.
 *
 * @typeParam H - The bound handle
 * @param handle - A `Data.bind`, `Data.bindPaged` or `Record.bind` handle
 * @param meta - What operators see of it ({@link StudioSourceMeta})
 * @returns The declaration, which a surface lists in `sources`
 *
 * @example
 * ```tsx
 * const orders = $.let(Data.bindPaged(d.orders));   // large: never downloaded whole
 * const assets = $.let(Data.bind(d.assets));        // small: read in the page
 * const sources = {
 *     orders: Studio.source(orders, {
 *         name: "Orders", icon: "receipt", description: "One row per order line",
 *         fields: {
 *             ordered_at: { label: "Ordered" },
 *             region:     { label: "Region" },
 *             revenue:    { label: "Revenue", format: { currency: { code: "AUD" } } },
 *             units:      { label: "Units", format: "compact" },
 *         },
 *         range: "ordered_at", search: ["region"], split: ["region"],
 *     }),
 *     assets: Studio.source(assets, { name: "Assets", icon: "gears" }),
 * };
 * <Studio.Builder pages={pages} components={components} sources={sources} project="Ops" />
 * ```
 */
export function createSource<H extends BoundSource>(handle: H, meta: StudioSourceMeta<StudioSourceField<H>>): StudioSourceDeclaration {
    return { handle, meta };
}

/** The fields of a source's rows, by name: an Array's elements', or a Dict's values'; `undefined` for a value that is neither, of Structs. */
function rowFieldsOf(type: EastType): Record<string, EastType> | undefined {
    if (type.type !== "Array" && type.type !== "Dict") return undefined;
    const row: EastType = type.value;
    return row.type === "Struct" ? row.fields as Record<string, EastType> : undefined;
}

/** The type of an optional field's value — an Option is the variant of exactly `none` and `some`; `undefined` for a field every row has. */
function optionalValueOf(type: EastType): EastType | undefined {
    const cases = type.type === "Variant" ? type.cases as Record<string, EastType> : undefined;
    return cases !== undefined && Object.keys(cases).length === 2 && cases["none"] !== undefined ? cases["some"] : undefined;
}

/** A field's kind, from its East type: an optional field's is its value's. */
function fieldKindOf(type: EastType): "date" | "text" | "number" | "boolean" | "other" {
    switch (sliceFieldKind(optionalValueOf(type) ?? type)) {
        case "datetime": return "date";
        case "string": return "text";
        case "integer": case "float": return "number";
        case "boolean": return "boolean";
        default: return "other";
    }
}

/** `nameWords`, compiled on first use: a field's default label is made as the surface is built, so the payload holds its text. */
let namedInWords: ((name: string) => string) | undefined;

/** A field's label where its source gives none: its name, in words. */
function defaultLabel(id: string): string {
    namedInWords ??= East.compile(nameWords, []);
    return namedInWords(id);
}

/**
 * The sources a surface lists, as its Studio components take them: each
 * source's key, what operators see of it, its binding and its fields.
 *
 * @param component - The component, for the messages (`"Studio.Builder"`)
 * @param sources - The sources the surface lists, by the names its visuals read them by; none when omitted
 * @returns An East expression of the sources, in the order listed
 * @throws {Error} When a key is not a jq identifier; when a source's rows are
 *   not an Array of Structs or a Dict of Structs; when `fields`, `range`,
 *   `search` or `split` names a field its rows lack; and when `range` names a
 *   field that is no date, or a date some rows may lack — each naming the
 *   source
 */
export function studioSources(component: string, sources: Readonly<Record<string, StudioSourceDeclaration>> | undefined): ExprType<ArrayType<StudioSourceType>> {
    return East.value(Object.entries(sources ?? {}).map(([key, { handle, meta }]) => {
        const bound = dataSource(component, key, handle);
        const row = rowFieldsOf(bound.type);
        if (row === undefined) {
            throw new Error(`${component}: the source "${key}" reads ${printType(bound.type)} — a source's rows are an Array of Structs, or a Dict of Structs`);
        }
        const held = (field: string, what: string) => {
            // The row's own fields: never a name every object answers to.
            if (!Object.hasOwn(row, field)) {
                throw new Error(`${component}: the source "${key}" names ${what} "${field}", which its rows do not have — they have ${Object.keys(row).join(", ")}`);
            }
        };
        const configured: Record<string, { label?: string; format?: SliceFieldFormat } | undefined> = meta.fields ?? {};
        for (const field of Object.keys(configured)) held(field, "the field");
        for (const field of meta.search ?? []) held(field, "the search field");
        for (const field of meta.split ?? []) held(field, "the split field");
        if (meta.range !== undefined) {
            held(meta.range, "the range field");
            const ranged = row[meta.range]!;
            if (fieldKindOf(ranged) !== "date") {
                throw new Error(`${component}: the source "${key}" names the range field "${meta.range}", which is no date — a page's range is over a date field`);
            }
            // The page's range narrows by this field's value, and a row with none would be in no range.
            if (optionalValueOf(ranged) !== undefined) {
                throw new Error(`${component}: the source "${key}" names the range field "${meta.range}", which is an optional date — a page's range is over a date every row has`);
            }
        }
        // The fields operators see: those given, in the order given, else every field of the row.
        const listed = meta.fields === undefined ? Object.keys(row) : Object.keys(configured);
        return {
            key,
            name: meta.name,
            icon: meta.icon,
            description: meta.description === undefined ? none : some(meta.description),
            binding: bound.source,
            fields: listed.map((id) => {
                const config = configured[id];
                return {
                    id,
                    label: config?.label ?? defaultLabel(id),
                    kind: variant(fieldKindOf(row[id]!), null),
                    format: config?.format === undefined ? none : some(toValueFormat(config.format)),
                };
            }),
            range: meta.range === undefined ? none : some(meta.range),
            search: [...(meta.search ?? [])],
            split: [...(meta.split ?? [])],
        };
    }), ArrayType(StudioSourceType));
}
