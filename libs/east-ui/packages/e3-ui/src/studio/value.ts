/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Studio.value` (#1759) — the value of the pages record a solution ships:
 * each page and template it writes inline, built as every write of the record
 * builds an entry.
 *
 * @packageDocumentation
 */

import {
    East, SortedMap, SortedSet, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, some, variant, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { keptTags } from "../utils/tags.js";
import { StudioKeyType, StudioLiveType, StudioPageType, studioEntry, type StudioEntryType, type StudioPagesType } from "./pages.js";

/** A page's key. */
type Key = ValueTypeOf<typeof StudioKeyType>;
/** A layout: its title, its placements and its starting filters. */
type Layout = ValueTypeOf<StudioPageType>;
/** A published version of a page. */
type Live = ValueTypeOf<typeof StudioLiveType>;
/** One entry of the pages record. */
type Entry = ValueTypeOf<StudioEntryType>;
/** An entry's tags. */
type Tags = Entry["tags"];

const compareKeys = compareFor(StudioKeyType);
const compareStrings = compareFor(StringType);
const printKey = printFor(StudioKeyType);

/** {@link studioEntry}, compiled on first use: the one function an entry is built by. */
let entryOf: ((key: Key, kind: Entry["kind"], draft: Layout, live: Entry["live"], tags: Tags) => Entry) | undefined;

/** {@link keptTags}, compiled on first use: the one function an entry's tags are kept by. */
let tagsOf: ((tags: Tags) => Tags) | undefined;

/** Each type's codec, made on first use: how what is written of it is read ({@link written}). */
const codecs = new Map<EastType, (value: unknown) => unknown>();

/**
 * What an entry holds of a type, read as East reads it: through the type's own codec, which takes a struct's fields
 * in whatever order they were written and gives the value East holds — and refuses what is no value of the type, a
 * `null`, a field left out, a number where an Integer goes. So a seed read from data is checked where its entry is
 * built, naming the entry, and never built into the record to fail where it is next read.
 *
 * @typeParam T - The East type
 * @param key - The entry's key, for the refusal
 * @param field - The field of the entry that holds it, as written
 * @param what - What it is, in words
 * @param type - Its East type
 * @param value - What was written
 * @returns The value, as East holds it
 * @throws {Error} When what was written is no value of the type, naming the entry, the field and why
 */
function written<T extends EastType>(key: Key, field: string, what: string, type: T, value: unknown): ValueTypeOf<T> {
    let read = codecs.get(type);
    if (read === undefined) {
        const encode = encodeBeast2For(type) as (value: unknown) => Uint8Array;
        const decode = decodeBeast2For(type) as (bytes: Uint8Array) => unknown;
        read = (given) => decode(encode(given));
        codecs.set(type, read);
    }
    try {
        return read(value) as ValueTypeOf<T>;
    } catch (error) {
        throw new Error(`Studio.value: ${printKey(key)}'s \`${field}\` is no ${what} (${error instanceof Error ? error.message : "it does not encode"})`);
    }
}

/**
 * A page a solution ships, as it writes one.
 *
 * @property key - Its key: its project, and its name in the project
 * @property draft - Its layout as last saved: its title, its placements and its starting filters
 * @property live - Its published version; omitted, it has not been published
 * @property tags - What it is tagged, each a word or two to find it by; omitted, none
 */
export interface StudioPageInput {
    /** Its key: its project, and its name in the project. */
    readonly key: Key;
    /** Its layout as last saved: its title, its placements and its starting filters. */
    readonly draft: Layout;
    /** Its published version: its number, counting up from 1, and the layout it published. Omitted, the page has not been published. */
    readonly live?: Live;
    /** What it is tagged, each a word or two to find it by; omitted, none. A tag is kept without the spaces around it, once. */
    readonly tags?: readonly string[];
    /** A page is no template: an entry written with both is refused. */
    readonly template?: never;
}

/**
 * A template a solution ships, as it writes one.
 *
 * @property key - Its key: its project, and its name in the project
 * @property template - Its layout: its title, its placements and its starting filters
 * @property tags - What it is tagged, each a word or two to find it by; omitted, none
 */
export interface StudioTemplateInput {
    /** Its key: its project, and its name in the project. */
    readonly key: Key;
    /** Its layout: its title, its placements and its starting filters — what a new page starts from. */
    readonly template: Layout;
    /** What it is tagged, each a word or two to find it by; omitted, none. A tag is kept without the spaces around it, once. */
    readonly tags?: readonly string[];
    /** A template is no page: an entry written with both is refused. */
    readonly draft?: never;
    /** A template has no published version. */
    readonly live?: never;
}

/**
 * An entry as it may be written past the compiler — from data, or a cast: what is refused where it is built, which
 * fields it has and what each holds.
 */
interface Written {
    readonly draft?: unknown;
    readonly template?: unknown;
    readonly live?: unknown;
}

/**
 * The pages record's value — every page and template a solution ships in it,
 * by key — what it declares the record with.
 *
 * @remarks
 * - **An entry with `draft` is a page**, and one with `template` a template.
 *   An entry is one or the other: written with both, or as a template with a
 *   `live` version, it is refused — by the compiler, and where it is built —
 *   so nothing written is dropped unsaid.
 * - **What an entry holds is read where it is built** too: its layout as
 *   `Studio.Types.Page` and its published version as `Studio.Types.Live`,
 *   through East's own codec. A struct's fields may be written in any order.
 *   A seed read from data — a `live` of `null`, a version that is no Integer,
 *   a layout with no placements — is refused here, naming the entry, never
 *   built into the record to fail where it is next read.
 * - **Each entry is built as every write builds one** (`studioEntry`): its
 *   project is its key's and its title its layout's, so the record's indexes
 *   on them list it where it is. Neither is written here.
 * - **Its tags** are the ones given, each without the spaces around it.
 * - **A placement's content** is built with `Studio.visual`.
 *
 * @param entries - The pages and the templates, each its key, its layout, and its published version and tags ({@link StudioPageInput}, {@link StudioTemplateInput})
 * @returns The entries, by key: a value of the record's type, `Studio.Types.Pages`
 * @throws {Error} When two entries have one key, naming it; when a tag is empty; when an entry is written as both a
 *   page and a template, as neither, or as a template with a published version; and when its layout or its published
 *   version is no value of its type
 *
 * @example
 * ```ts
 * import { none, variant } from "@elaraai/east";
 * import { Studio } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const trend = { key: "trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: Studio.visual.component("revenue_trend") };
 *
 * // The record ships with one page, published as it was drafted, and one template.
 * export const pages = e3.record("pages", Studio.Types.Pages, {
 *     initial: Studio.value([
 *         {
 *             key: { project: "Ops console", page: "Overview" }, tags: ["weekly"],
 *             draft: { title: "Overview", cells: [trend], filters: [] },
 *             live: { version: 1n, page: { title: "Overview", cells: [trend], filters: [] } },
 *         },
 *         { key: { project: "Ops console", page: "One chart" }, template: { title: "One chart", cells: [trend], filters: [] } },
 *     ]),
 *     mutations: (mutation) => ({
 *         patch: mutation.patch(),
 *     }),
 * });
 * ```
 */
export function studioPagesValue(entries: readonly (StudioPageInput | StudioTemplateInput)[]): ValueTypeOf<StudioPagesType> {
    const pages = new SortedMap<Key, Entry>([], compareKeys);
    for (const entry of entries) {
        if (pages.has(entry.key)) {
            throw new Error(`Studio.value: ${printKey(entry.key)} is written twice — an entry's key is its own in the record`);
        }
        const given: Written = entry;
        if (given.template !== undefined && given.draft !== undefined) {
            throw new Error(`Studio.value: ${printKey(entry.key)} is written as a page, with a \`draft\`, and as a template — an entry is one or the other`);
        }
        if (given.template === undefined && given.draft === undefined) {
            throw new Error(`Studio.value: ${printKey(entry.key)} has neither a \`draft\` nor a \`template\` — a page is written with its draft, a template with its layout`);
        }
        if (given.template !== undefined && given.live !== undefined) {
            throw new Error(`Studio.value: ${printKey(entry.key)} is a template written with a \`live\` version — a template has no published version`);
        }
        // What it holds, read past the compiler: a seed from data holds what its file held.
        const layout = given.template !== undefined
            ? written(entry.key, "template", "layout — its title, its placements and its starting filters, `Studio.Types.Page`", StudioPageType, given.template)
            : written(entry.key, "draft", "layout — its title, its placements and its starting filters, `Studio.Types.Page`", StudioPageType, given.draft);
        const live = given.live === undefined ? none
            : some(written(entry.key, "live", "published version — its number, an Integer, and the layout it published, `Studio.Types.Live`; a page not yet published is written with no `live`", StudioLiveType, given.live));
        const keep = (tagsOf ??= East.compile(keptTags, []));
        // A tag nothing is kept of is the author's slip, never dropped in silence.
        if ((entry.tags ?? []).some(tag => keep(new SortedSet([tag], compareStrings)).size === 0)) {
            throw new Error(`Studio.value: ${printKey(entry.key)} has an empty tag — a tag is a word or two to find the entry by`);
        }
        const tags = keep(new SortedSet(entry.tags ?? [], compareStrings));
        const build = (entryOf ??= East.compile(studioEntry, []));
        pages.set(entry.key, build(entry.key, given.template !== undefined ? variant("template", null) : variant("page", null), layout, live, tags));
    }
    return pages;
}
