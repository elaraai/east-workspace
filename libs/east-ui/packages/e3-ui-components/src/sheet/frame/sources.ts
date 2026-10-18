/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sources of the Sheet's rail its library follows (#1345): each templates
 * list's, whose shown keys narrow the Rows tab's cards of that list, and each
 * author's tab's that names one — and what the rail counts each in. The
 * shared `FollowSources` reads them.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { SheetWords } from "../words.js";
import type { SheetValue } from "./index.js";

const stringEqual = equalFor(StringType);

/**
 * The sources the library follows: each templates list's, then each author's
 * tab's that names one — each once, in that order.
 *
 * @param value - The payload
 * @returns The sources' names
 */
export function followedSources(value: SheetValue): string[] {
    const named = [
        ...value.templates.map((template) => template.source),
        ...value.library.flatMap((tab) => (tab.type === "tab" && tab.value.source.type === "some" ? [tab.value.source.value] : [])),
    ];
    return named.filter((source, i) => named.findIndex((other) => stringEqual(other, source)) === i);
}

/**
 * What the rail counts each source the library follows in (#1345): a
 * templates list's source, templates; an author's tab's, its name as running
 * text writes it.
 *
 * @param value - The payload
 * @param words - The sheet's words
 * @returns Each source's noun, by its name
 */
export function followedNouns(value: SheetValue, words: SheetWords): ReadonlyMap<string, string> {
    const nouns = new Map<string, string>();
    for (const template of value.templates) nouns.set(template.source, words.m.libraryNoun({ tab: "rows", n: 2 }));
    for (const tab of value.library) {
        if (tab.type === "tab" && tab.value.source.type === "some" && !nouns.has(tab.value.source.value)) {
            nouns.set(tab.value.source.value, tab.value.name.toLocaleLowerCase(words.locale));
        }
    }
    return nouns;
}
