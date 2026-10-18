/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's narrowing (#1340): its `slice` is one `Slice.bindRecords`, each
 * source named after what it narrows, and each source filters every place its
 * records appear — the main area, the Choosers and the Library tab that lists
 * that record. The one check every builder's tag makes of its `slice`, and the
 * one check of a tab's `source`.
 *
 * @packageDocumentation
 */

import { East, Expr, StringType, isTypeEqual, none, some, type ExprType, type StructType, type option } from "@elaraai/east";
import { isRecordSlices, recordSlicesChrome, resolveRowSource, type RecordSlicesChromeOptions, type RecordSlicesChromeType } from "@elaraai/east-ui/internal";
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

/** A builder's narrowing, checked: its chrome, and each source's keys and typed data. */
export interface RecordSources {
    /** The rail's chrome; `none` with no slice. */
    chrome: option<ExprType<RecordSlicesChromeType>>;
    /** The slice's sources, in their order. */
    names: string[];
    /** Each source's narrowed keys, paged through its part: what the renderer reads to show its rows. */
    keys: Readonly<Record<string, unknown>>;
    /** Each source's typed narrowed data, `Slice.rows(slice, name)`: what a main area that pages its rows reads. */
    data: Readonly<Record<string, unknown>>;
}

/** `` `lanes`, `resources` and `events` ``. */
function quoted(names: readonly string[]): string {
    const each = names.map(name => `\`${name}\``);
    return each.length <= 1 ? each.join("") : `${each.slice(0, -1).join(", ")} and ${each.at(-1)}`;
}

/**
 * Checks a builder's `slice` and reads its sources (#1340): the slice is
 * `Slice.bindRecords`, every source one the builder takes, each a record with
 * String primary keys.
 *
 * @param slice - The builder's `slice` prop, if given
 * @param spec - What the builder takes, and its words
 * @returns The chrome, the sources' names, and each one's keys and typed data
 * @throws {Error} When `slice` is `Slice.bind` or `Slice.bindRecord`, names a source the builder does not take, or narrows a record whose keys are not Strings
 */
export function recordSources(slice: RecordSlicesChromeOptions | undefined, spec: RecordSourcesSpec): RecordSources {
    if (slice === undefined) return { chrome: none, names: [], keys: {}, data: {} };
    if (!isRecordSlices(slice.slice)) {
        throw new Error(`${spec.builder}: \`slice\` is Slice.bindRecords(key, { ${spec.names.join(", ")} }) — name each source after what it narrows; Slice.bind and Slice.bindRecord are not taken`);
    }
    const handle = East.value(slice.slice) as unknown as ExprType<StructType>;
    const sources = (Expr.type(handle as unknown as Expr) as StructType).fields["sources"];
    const names = sources?.type === "Struct" ? Object.keys(sources.fields) : [];
    const takes = spec.takes ?? ((name: string) => spec.names.includes(name));
    const keys: Record<string, unknown> = {}, data: Record<string, unknown> = {};
    for (const name of names) {
        if (!takes(name)) {
            throw new Error(`${spec.builder}: \`slice\` narrows ${spec.what} — its source '${name}' is none of them; name the sources ${quoted(spec.names)}`);
        }
        const rows = (handle as unknown as { sources: Record<string, { data: unknown }> }).sources[name]!.data;
        // A source's rows are keyed as its record is: a builder matches them by String key.
        const resolved = resolveRowSource(rows, `${spec.builder}.slice's ${name}`);
        if (resolved.kind !== "ordered" || !isTypeEqual(resolved.keyType, StringType)) {
            throw new Error(`${spec.builder}: \`slice\`'s ${name} narrows a record whose keys are not Strings — each source is a record with String primary keys`);
        }
        const visible = keyVisibility(rows, `${spec.builder}.slice's ${name}`);
        if (visible.source === undefined) throw new Error(`${spec.builder}: \`slice\`'s ${name} narrows a record whose keys are not Strings — each source is a record with String primary keys`);
        keys[name] = visible.source;
        data[name] = rows;
    }
    return { chrome: some(recordSlicesChrome(slice)), names, keys, data };
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
