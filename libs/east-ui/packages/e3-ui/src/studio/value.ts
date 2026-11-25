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

import { East, SortedMap, SortedSet, StringType, compareFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { keptTags } from "../utils/tags.js";
import { StudioKeyType, studioEntry, type StudioEntryType, type StudioLiveType, type StudioPageType, type StudioPagesType } from "./pages.js";

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
}

/**
 * The pages record's value — every page and template a solution ships in it,
 * by key — what it declares the record with.
 *
 * @remarks
 * - **An entry with `draft` is a page**, and one with `template` a template.
 * - **Each entry is built as every write builds one** (`studioEntry`): its
 *   project is its key's and its title its layout's, so the record's indexes
 *   on them list it where it is. Neither is written here.
 * - **Its tags** are the ones given, each without the spaces around it.
 * - **A placement's content** is built with `Studio.visual`.
 *
 * @param entries - The pages and the templates, each its key, its layout, and its published version and tags ({@link StudioPageInput}, {@link StudioTemplateInput})
 * @returns The entries, by key: a value of the record's type, `Studio.Types.Pages`
 * @throws {Error} When two entries have one key, naming it; and when a tag is empty
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
        const keep = (tagsOf ??= East.compile(keptTags, []));
        // A tag nothing is kept of is the author's slip, never dropped in silence.
        if ((entry.tags ?? []).some(tag => keep(new SortedSet([tag], compareStrings)).size === 0)) {
            throw new Error(`Studio.value: ${printKey(entry.key)} has an empty tag — a tag is a word or two to find the entry by`);
        }
        const tags = keep(new SortedSet(entry.tags ?? [], compareStrings));
        const build = (entryOf ??= East.compile(studioEntry, []));
        pages.set(entry.key, "template" in entry
            ? build(entry.key, variant("template", null), entry.template, none, tags)
            : build(entry.key, variant("page", null), entry.draft, entry.live === undefined ? none : some(entry.live), tags));
    }
    return pages;
}
