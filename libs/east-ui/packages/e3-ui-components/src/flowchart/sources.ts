/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sources of the Flowchart's rail it follows (#1502, `Flowchart Records
 * Spec.md` R6, R14): each kind's cards' source, whose shown keys narrow its
 * tab's cards; each author's tab's that names one; and, under `"dim"`, the
 * states' and the transitions' own, whose shown keys say which rows draw as
 * context — and what the rail counts each source in. The shared
 * `FollowSources` reads them.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { sourcePart } from "../shared/schedule/visibility.js";
import { flowchartTabSource } from "./library.js";
import type { FlowchartMessages } from "./messages.js";
import type { FlowchartValue } from "./model.js";
import { SOURCE_SORTS } from "./read.js";

const stringEqual = equalFor(StringType);

/**
 * The sources the Flowchart follows: each tab's — a kind's tab its cards', an
 * author's tab its own — and, under `"dim"`, each kind read through its source
 * of the rail, the states' and the transitions' — each once, in that order.
 *
 * @param value - The payload
 * @returns The sources' names
 */
export function followedSources(value: FlowchartValue): string[] {
    const named = value.library.flatMap((tab) => {
        const source = flowchartTabSource(value, tab);
        return source === undefined ? [] : [source];
    });
    if (value.narrowed.type === "dim") {
        const chrome = getSomeorUndefined(value.slice);
        for (const sort of SOURCE_SORTS) if (sourcePart(chrome, sort) !== undefined) named.push(sort);
    }
    return named.filter((source, i) => named.findIndex((other) => stringEqual(other, source)) === i);
}

/**
 * What the rail counts each source in, by its name: a kind read through its
 * source, its kind's name in the plural; a kind's cards' source, cards; an
 * author's tab's, its name as a sentence writes it — the first that names a
 * source naming it.
 *
 * @param value - The payload
 * @param m - The Flowchart's messages
 * @param locale - The app's locale, which lowers a name
 * @returns Each source's noun, by its name
 */
export function sourceNouns(value: FlowchartValue, m: FlowchartMessages, locale: string): ReadonlyMap<string, string> {
    const nouns = new Map<string, string>();
    for (const sort of SOURCE_SORTS) nouns.set(sort, m.kindNoun({ sort, n: 2 }));
    for (const tab of value.library) {
        const source = flowchartTabSource(value, tab);
        if (source === undefined || nouns.has(source)) continue;
        nouns.set(source, tab.type === "tab" ? tab.value.name.toLocaleLowerCase(locale) : m.cardsNoun({ tab: tab.type }));
    }
    return nouns;
}
