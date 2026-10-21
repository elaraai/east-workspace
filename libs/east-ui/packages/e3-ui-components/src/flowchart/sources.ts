/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sources of the Flowchart's rail its library follows (#1346): each
 * templates list's, whose shown keys narrow its tab's cards, and each
 * author's tab's that names one — and what the rail counts each source in,
 * the `flows` source among them. The shared `FollowSources` reads the
 * followed ones; the Flows tab pages the `flows` source itself.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { FlowchartMessages } from "./messages.js";
import type { FlowchartValue } from "./model.js";

const stringEqual = equalFor(StringType);

/**
 * The sources the library's data tabs follow: each templates list's, and each
 * author's tab's that names one — each once, in the library's order.
 *
 * @param value - The payload
 * @returns The sources' names
 */
export function followedSources(value: FlowchartValue): string[] {
    const named = value.library.flatMap((tab) => {
        switch (tab.type) {
            case "flows": return [];
            case "states":
            case "transitions": return [tab.value.source];
            case "tab": return tab.value.source.type === "some" ? [tab.value.source.value] : [];
        }
    });
    return named.filter((source, i) => named.findIndex((other) => stringEqual(other, source)) === i);
}

/**
 * What the rail counts each source in, by its name (#1346): the `flows`
 * source, flows; a templates list's, its templates; an author's tab's, its
 * name as running text writes it — the first tab that names a source naming it.
 *
 * @param value - The payload
 * @param m - The flowchart's messages
 * @param locale - The app's locale, which lowers a tab's name
 * @returns Each source's noun, by its name
 */
export function sourceNouns(value: FlowchartValue, m: FlowchartMessages, locale: string): ReadonlyMap<string, string> {
    const nouns = new Map<string, string>([["flows", m.flowNoun({ n: 2 })]]);
    for (const tab of value.library) {
        if (tab.type === "states" || tab.type === "transitions") {
            if (!nouns.has(tab.value.source)) nouns.set(tab.value.source, m.templatesNoun({ tab: tab.type }));
        } else if (tab.type === "tab" && tab.value.source.type === "some" && !nouns.has(tab.value.source.value)) {
            nouns.set(tab.value.source.value, tab.value.name.toLocaleLowerCase(locale));
        }
    }
    return nouns;
}
