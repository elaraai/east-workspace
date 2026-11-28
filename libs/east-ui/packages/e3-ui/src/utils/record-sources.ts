/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's narrowing (#1340): its `slice` is one `Slice.bindRecords`, each
 * source named after what it narrows, and each source filters every place its
 * records appear — the main area, the Choosers and the Library tab that lists
 * that record. The one check every builder's tag makes of its `slice`, the one
 * binding of its sources in the builder's payload (#1356), the one check of a
 * tab's `source`, and the one of a templates list's. A source narrows a record
 * keyed by any type a Dict takes, in every builder, each key shown as its text
 * — a String key as itself, any other as East prints it (#1549, #1696).
 *
 * @packageDocumentation
 */

import {
    East, Expr, StringType, isTypeEqual, none, printTypeSummary, some,
    type ArrayType, type BlockBuilder, type EastType, type ExprType, type FunctionType, type IntegerType, type NullType, type OptionType,
    type StructType, type option,
} from "@elaraai/east";
import {
    PinnedSourceType, isRecordSlices, recordSlicesChrome, resolveRowSource, type RecordSlicesChromeOptions, type RecordSlicesChromeType, type RowSource,
} from "@elaraai/east-ui/internal";
import { keyVisibility } from "./key-visibility.js";

/** What a builder's narrowing takes. */
export interface RecordSourcesSpec {
    /** The builder, as its messages name it (`Allocation`). */
    builder: string;
    /** The sources it names in its messages, in their order (`lanes`, `resources`, `events`). */
    names: readonly string[];
    /** What its sources narrow, as its refusal says it (`its lanes, its resources and its events`). */
    what: string;
    /** Whether it takes a source of this name; by default, one of `names`. A builder whose sources are its own keys (the Calendar's event kinds) says so here. */
    takes?: (name: string) => boolean;
}

/**
 * A builder's sources, each bound once in its payload's block (#1356): its part of the slice, its narrowed data and
 * its narrowed keys. A function captures what it reads, so one reading a source through these holds that source
 * alone. One reading through the slice would hold every source's methods, and beast2 writes a captured value
 * wherever a function holding it is written.
 *
 * Each is bound as a constant (#1599): a function captures a constant as its value, which the slice gives the same
 * from one evaluation of the author's block to the next, so the functions a builder makes over its sources are the
 * same too. A mutable variable is captured as its box, which every evaluation makes anew — the functions over it then
 * differed each time (East's `equivalentFor`), and a renderer that keeps what it read by the function that read it
 * let all of it go whenever the author's block was evaluated again (`utils/held.ts`).
 */
export interface BoundSources {
    /** Each source's part of the slice, its typed record Slice handle: what a kind narrowed through it reads (a Calendar's event kind), and its record's identity. */
    parts: Readonly<Record<string, ExprType<StructType>>>;
    /** Each source's typed narrowed data, `Slice.rows(slice, name)`: what a main area that pages its rows reads. */
    data: Readonly<Record<string, ExprType<StructType>>>;
    /** Each source's narrowed keys, paged through its data: what the renderer reads to show its rows. */
    keys: Readonly<Record<string, RowSource<ArrayType<StringType>>>>;
}

/** A builder's narrowing, checked: its chrome, its sources' names, and the one binding of its sources. */
export interface RecordSources {
    /** The rail's chrome; `none` with no slice. */
    chrome: option<ExprType<RecordSlicesChromeType>>;
    /** The slice's sources, in their order. */
    names: string[];
    /**
     * Binds each source once in the builder's payload block — its part, its narrowed data and its keys (#1356).
     * Every builder calls it first and reads its sources only through what it returns.
     *
     * @typeParam T - The block's type
     * @param $ - The builder's payload block
     * @returns Each source's part, narrowed data and keys, bound
     */
    bind<T extends EastType>($: BlockBuilder<T>): BoundSources;
}

/** `` `lanes`, `resources` and `events` ``. */
function quoted(names: readonly string[]): string {
    const each = names.map(name => `\`${name}\``);
    return each.length <= 1 ? each.join("") : `${each.slice(0, -1).join(", ")} and ${each.at(-1)}`;
}

/**
 * Checks a builder's `slice` and reads its sources (#1340): the slice is
 * `Slice.bindRecords`, every source one the builder takes, each a record keyed
 * by any type a Dict takes, its shown keys their text (#1696). `bind` binds
 * each source once in the builder's payload (#1356).
 *
 * @param slice - The builder's `slice` prop, if given
 * @param spec - What the builder takes, and its words
 * @returns The chrome, the sources' names, and the binding of each one's part, data and keys
 * @throws {Error} When `slice` is `Slice.bind` or `Slice.bindRecord`, names a source the builder does not take, or
 *   narrows no record's rows
 */
export function recordSources(slice: RecordSlicesChromeOptions | undefined, spec: RecordSourcesSpec): RecordSources {
    if (slice === undefined) return { chrome: none, names: [], bind: () => ({ parts: {}, data: {}, keys: {} }) };
    if (!isRecordSlices(slice.slice)) {
        throw new Error(`${spec.builder}: \`slice\` is Slice.bindRecords(key, { ${spec.names.join(", ")} }) — name each source after what it narrows; Slice.bind and Slice.bindRecord are not taken`);
    }
    const handle = East.value(slice.slice) as unknown as { sources: Readonly<Record<string, ExprType<StructType>>> };
    const sources = (Expr.type(handle as unknown as Expr) as StructType).fields["sources"];
    const names = sources?.type === "Struct" ? Object.keys(sources.fields) : [];
    const takes = spec.takes ?? ((name: string) => spec.names.includes(name));
    const prop = (name: string) => `${spec.builder}.slice's ${name}`;
    const unrecorded = (name: string) => new Error(`${spec.builder}: \`slice\`'s ${name} narrows no record's rows — each source is Data.bindPaged(record, { indexes }) over the record it narrows`);
    for (const name of names) {
        if (!takes(name)) {
            throw new Error(`${spec.builder}: \`slice\` narrows ${spec.what} — its source '${name}' is none of them; name the sources ${quoted(spec.names)}`);
        }
        // A source's rows are keyed as its record is, by any type a Dict takes: a builder matches them by its key's text.
        const resolved = resolveRowSource((handle.sources[name] as unknown as { data: unknown }).data, prop(name));
        if (resolved.kind !== "ordered") throw unrecorded(name);
    }
    return {
        chrome: some(recordSlicesChrome(slice)),
        names,
        bind: ($) => {
            const parts: Record<string, ExprType<StructType>> = {};
            const data: Record<string, ExprType<StructType>> = {};
            const keys: Record<string, RowSource<ArrayType<StringType>>> = {};
            for (const name of names) {
                const part = $.const(handle.sources[name]!);
                const rows = $.const((part as unknown as { data: ExprType<StructType> }).data);
                // Its keys page through its own data, each its text.
                const visible = keyVisibility(rows, prop(name));
                if (visible.source === undefined) throw unrecorded(name);
                const shown = $.const(visible.source);
                parts[name] = part;
                data[name] = rows;
                keys[name] = shown;
            }
            return { parts, data, keys };
        },
    };
}

/** A source's part of the slice, as a reader of the rows its page holds reads it (#1349, #1621). */
type RecordBasePart = ExprType<StructType<{
    total: FunctionType<[], OptionType<IntegerType>>;
    pageBase: FunctionType<[IntegerType, IntegerType], OptionType<EastType>>;
    data: StructType<{
        id: StringType;
        revision: FunctionType<[], OptionType<StringType>>;
        refresh: FunctionType<[OptionType<StringType>], NullType>;
    }>;
}>>;

/**
 * The fields a source's page scopes (#1621): what its part's type names in `scoped`, which its config holds the values
 * of.
 *
 * @param part - The source's part of the slice
 * @returns The scoped fields' names, in their order; none where its page holds no scope
 */
function scopedFields(part: ExprType<StructType>): string[] {
    const scoped = (Expr.type(part as unknown as Expr) as StructType).fields["scoped"];
    return scoped?.type === "Struct" ? Object.keys(scoped.fields) : [];
}

/**
 * Whether a source's page holds a scope (#1621): its part's type names the fields its page scopes (`scoped`), which its
 * config holds the values of.
 *
 * @param part - The source's part of the slice, bound
 * @returns Whether its page scopes a field
 */
export function recordSourceScoped(part: ExprType<StructType>): boolean {
    return scopedFields(part).length > 0;
}

/** A builder's slice's sources, as its handle holds them. */
function sliceSources(slice: RecordSlicesChromeOptions): Readonly<Record<string, ExprType<StructType>>> {
    return (East.value(slice.slice) as unknown as { sources: Readonly<Record<string, ExprType<StructType>>> }).sources;
}

/**
 * The fields a source of a builder's slice scopes (#1621, #1762), read before the slice is bound: what a builder that
 * needs a source scoped — the page library's pages and templates, each by what an entry is — checks.
 *
 * @param slice - The builder's `slice`, checked a `Slice.bindRecords`
 * @param name - The source's name
 * @returns The scoped fields' names; none where its page holds no scope
 */
export function sliceSourceScopes(slice: RecordSlicesChromeOptions, name: string): string[] {
    return scopedFields(sliceSources(slice)[name]!);
}

/** What a library's slice takes (#1761, #1762): its builder's narrowing, and how its refusals write the slice. */
export interface LibrarySliceSpec extends RecordSourcesSpec {
    /** How a refusal writes the slice to give (`slice={{ slice: Slice.bindRecords(key, { rows: … }) }}`). */
    call: string;
    /** What its cards are, as a refusal says it (`the saved queries`). */
    cards: string;
}

/**
 * A library's slice, checked (#1761, #1762): a library's cards are its `rows` source's rows, read through it a window
 * at a time, and its rail narrows them — so its slice is given, it is `{ slice }` over `Slice.bindRecords`, its sources
 * are the library's, and its `rows` source is among them. The query library's and the page library's.
 *
 * @param slice - The library's `slice` prop
 * @param spec - What the library takes, and its words
 * @returns The slice, its sources, and their chrome, which the library's payload carries
 * @throws {Error} When `slice` is left out, is no `{ slice }` over `Slice.bindRecords`, names a source the library does
 *   not take, or has no `rows` source — each naming the slice to write
 */
export function librarySlice(slice: RecordSlicesChromeOptions | undefined, spec: LibrarySliceSpec): {
    slice: RecordSlicesChromeOptions; sources: RecordSources; chrome: ExprType<RecordSlicesChromeType>;
} {
    if (slice === undefined) {
        throw new Error(`${spec.builder}: needs \`slice\` — ${spec.call}: its cards are ${spec.cards} read through it, a window at a time, and its rail narrows them`);
    }
    if (typeof slice !== "object" || slice === null || !("slice" in slice) || !isRecordSlices(slice.slice)) {
        throw new Error(`${spec.builder}: \`slice\` takes { slice } over Slice.bindRecords — ${spec.call}: Slice.bind and a single Slice.bindRecord narrow no record's rows`);
    }
    const sources = recordSources(slice, spec);
    if (!sources.names.includes("rows") || sources.chrome.type === "none") {
        throw new Error(`${spec.builder}: \`slice\` has no \`rows\` source — its cards are its \`rows\` source's rows: ${spec.call}`);
    }
    return { slice, sources, chrome: sources.chrome.value };
}

/** What a library's source pages (#1761, #1762): its rows' type, and its keys' where the library checks them. */
export interface LibraryRowsSpec {
    /** The library, as its refusals name it (`Query.Library`). */
    builder: string;
    /** How a refusal writes the slice to give. */
    call: string;
    /** The type of the rows its cards are. */
    row: EastType;
    /** The type of their record's keys, where the library reads them. */
    key?: EastType | undefined;
    /** The rows, as a refusal says it (`saved queries`). */
    rows: string;
    /** Their record, as a refusal says it (`the saved queries record, of Query.Types.Saved`). */
    record: string;
}

/**
 * Checks that a source of a library's slice pages the rows its cards are (#1761, #1762): a record of the rows' type,
 * keyed as the library reads its keys.
 *
 * @param slice - The library's slice, checked ({@link librarySlice})
 * @param name - The source's name
 * @param spec - The rows' type and the words of the refusal
 * @throws {Error} When the source pages rows of another type, or is keyed otherwise — naming what it pages and the record to page
 */
export function libraryRows(slice: RecordSlicesChromeOptions, name: string, spec: LibraryRowsSpec): void {
    const { key, row } = sliceSourceTypes(slice, name, `${spec.builder}.slice's ${name}`);
    const keyed = spec.key === undefined || (key !== undefined && isTypeEqual(key, spec.key));
    if (row === undefined || !isTypeEqual(row, spec.row) || !keyed) {
        throw new Error(`${spec.builder}: \`slice\`'s \`${name}\` source pages ${row === undefined ? "no rows" : printTypeSummary(row)}, not ${spec.rows} — ` +
            `its source is ${spec.record}: ${spec.call}`);
    }
}

/**
 * What a source of a builder's slice pages (#1761, #1762): the type of its record's keys, and of the rows its entries
 * join, read off the source's own type — what a builder over one record's rows checks its source is.
 *
 * @param slice - The builder's `slice`, checked a `Slice.bindRecords`
 * @param name - The source's name
 * @param prop - The source as a refusal names it (`Query.Library.slice's rows`)
 * @returns Its keys' type and its rows' type; each `undefined` where its entries hold none
 */
export function sliceSourceTypes(slice: RecordSlicesChromeOptions, name: string, prop: string): { key: EastType | undefined; row: EastType | undefined } {
    const data = (sliceSources(slice)[name] as unknown as { data: unknown }).data;
    const entry = resolveRowSource(data, prop).elementType;
    const fields: Readonly<Record<string, EastType>> = entry.type === "Struct" ? entry.fields as Readonly<Record<string, EastType>> : {};
    const joined = fields["row"];
    return { key: fields["key"], row: joined?.type === "Variant" ? (joined.cases as Readonly<Record<string, EastType>>)["some"] : undefined };
}

/**
 * The rows a source's page holds of its record (#1349, #1621), as a pinned
 * source of its window's type: with no scope the record's own, every row in
 * its order; on a scoped page the scope's alone, numbered 1 to N, paged
 * through the index on exactly the scope's fields in their keys' order under
 * each of its values, and no row beyond the scope is read. Its pages are the
 * source's `pageBase` — the windows the source's other reads of those rows
 * share — its total the source's, the scope's rows on a scoped source, and its
 * revision the record's state, which a Save confirms against. It searches no
 * key itself: a reader seeks those rows through the source's binding
 * (`recordSliceKeySearch`). What a Sheet's rows are, and what the Choosers of
 * a paged resource kind list on a scoped page.
 *
 * @param part - The source's part of the slice, bound once in the payload's block
 * @returns A pinned source over the rows the page holds, of the source's window type
 */
export function recordBaseSource(part: ExprType<StructType>): ExprType<StructType> {
    const base = part as unknown as RecordBasePart;
    const pageType = (Expr.type(base.pageBase as unknown as Expr) as FunctionType).output as OptionType<EastType>;
    const collection = (pageType.cases as Record<string, EastType>)["some"]!;
    return East.value({
        id: base.data.id, page: base.pageBase, total: base.total, seek: none, revision: base.data.revision, refresh: base.data.refresh,
    } as never, PinnedSourceType(collection)) as unknown as ExprType<StructType>;
}

/**
 * The sources a builder's `slice` names, read before it is checked: what a
 * builder's templates check lists, so a list written in the code is refused
 * with the change to make before a source no list names is (#1343, #1345).
 *
 * @param slice - The builder's `slice` prop, if given
 * @returns Its sources, in their order; none when it is no `Slice.bindRecords`, which `recordSources` refuses
 */
export function sliceSourceNames(slice: RecordSlicesChromeOptions | undefined): string[] {
    if (slice === undefined || !isRecordSlices(slice.slice)) return [];
    const sources = (Expr.type(East.value(slice.slice) as unknown as Expr) as StructType).fields["sources"];
    return sources?.type === "Struct" ? Object.keys(sources.fields) : [];
}

/**
 * A tab's source (#1340): the slice's source whose shown keys filter the tab's
 * cards, its rows that record's rows by key; `none` for a tab that names none,
 * which lists its rows whole.
 *
 * @param builder - The builder, as its message names it
 * @param tab - The tab, as its message names it (`Positions`)
 * @param source - The source the tab names, if any
 * @param names - The slice's sources
 * @returns The source, as the payload carries it
 * @throws {Error} When the tab names a source the slice lacks
 */
export function tabSource(builder: string, tab: string, source: string | undefined, names: readonly string[]): option<string> {
    if (source === undefined) return none;
    if (!names.includes(source)) {
        throw new Error(`${builder}: the ${tab} tab's source '${source}' is not one of the slice's sources (${names.length === 0 ? "it has no slice" : names.join(", ")})`);
    }
    return some(source);
}

/**
 * A templates list's source (#1340, #1345): every builder's templates are a
 * record of their own, each list a source of the builder's one
 * `Slice.bindRecords`, its cards that record's rows by key. A list written in
 * the code names no source, and is refused as one naming a source the slice
 * lacks is, both with the change to make.
 *
 * @param builder - The builder, as its message names it (`Sheet`)
 * @param what - The builder's templates declaration, as the refusal writes it (`Sheet.templates(rows, { …, source: "rowTemplates" })`)
 * @param source - The source the list names; `undefined` for a list written in the code, or one that names none
 * @param names - The slice's sources
 * @returns The source's name
 * @throws {Error} When the list names no source, or one the slice lacks, listing the slice's sources
 */
export function templatesSource(builder: string, what: string, source: string | undefined, names: readonly string[]): string {
    if (source !== undefined && names.includes(source)) return source;
    const missing = source === undefined ? "" : ` — '${source}' is not one of them`;
    throw new Error(`${builder}: templates are records now — bind them in Slice.bindRecords and name the source, ${what} (${names.length === 0 ? "it has no slice" : `the slice's sources: ${names.join(", ")}`}${missing})`);
}
