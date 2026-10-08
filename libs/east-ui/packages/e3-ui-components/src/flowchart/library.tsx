/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library pane (#1246, #1248, `Flowchart Builder Spec.md` decisions 5–8,
 * §7, §8, §9.7, FB13, FB25–FB29): the flowchart's start pane, its tabs the
 * ones the author's `library` lists, in that order, each with its count after
 * its name and a search. A flowchart whose `library` lists no tab has no pane.
 *
 * - **Flows** (`Flowchart.library.flows()`) — every flow by name, a click
 *   opening one (`flows.tsx`, #1246).
 * - **The state templates** (`Flowchart.library.states(rows, …)`) and **the
 *   transition templates** (`Flowchart.library.transitions(rows, …)`) — one
 *   card per row of the tab's own rows, as the Sheet's author tabs' (SB60):
 *   each its label and its meta under it, with the tab's icon, grouped by its
 *   `group` and searched by its key, label and meta. Each card is a drag
 *   source; a click selects it, and a click on the selected card lets it go
 *   (FB26). A template tab its author leaves unnamed is named in the
 *   flowchart's words.
 * - **An author's tab** (`Flowchart.library.tab(rows, …)`) — its cards as the
 *   templates' are, each a drag source when the tab declares a `drop` (FB27).
 * - An empty tab says so in the shared empty state (FB28): the Flows tab `No
 *   flows`, a template tab `No templates`, an author's tab `Nothing in
 *   <name>`; a search that hides every card, the `Library`'s own `No matches`.
 *   Collapsed, the pane is a rail with the first tab's count (FB25).
 *
 * Each data tab's cards are a `Library`'s, drawn by the shared parts — every
 * icon Font Awesome's solid set, every style the `library` recipe's — and
 * drag from the library `${flowchartKeys(name).library}:<the tab's key>`
 * ({@link flowchartLibraryId}), each card keyed by its row's key: what the
 * canvas takes dropped is #1249's.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { StringType, equalFor, none, some, type ValueTypeOf } from "@elaraai/east";
import type { Flowchart, flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary, getSomeorUndefined, type BuilderFrameDock, type LibraryItemValue, type LibraryValue,
} from "@elaraai/east-ui-components";
import type { FlowchartMessages, FlowchartWords } from "./messages.js";
import type { FlowchartValue } from "./model.js";

/** The names a flowchart keeps its viewer's state under. */
type FlowchartKeys = ReturnType<typeof flowchartKeys>;
/** One tab the payload lists, decoded. */
type FlowchartTabValue = FlowchartValue["library"][number];
/** A tab that reads rows of its own, decoded: the state templates, the transition templates, or an author's. */
export type FlowchartDataTabValue = Exclude<FlowchartTabValue, { type: "flows" }>;
/** What a card shows, decoded, whatever it sets. */
type FlowchartCardValue = ValueTypeOf<typeof Flowchart.Types.Card>;

const stringEqual = equalFor(StringType);

/** The library open: the design system's 272px (§8). */
const LIBRARY_SIZE = "272px";

/** A tab's cards fill the pane and scroll there, every card mounted. */
const FILL = some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none });

/**
 * A data tab's key among the pane's tabs — and, after the flowchart's library
 * id, its cards' library's: `states`, `transitions`, or `tab:<its name>`.
 *
 * @param tab - The tab
 * @returns Its key
 */
export function flowchartTabKey(tab: FlowchartDataTabValue): string {
    switch (tab.type) {
        case "states": return "states";
        case "transitions": return "transitions";
        case "tab": return `tab:${tab.value.name}`;
    }
}

/**
 * The library a tab's cards drag from — the libraries the canvas takes drops
 * from (#1249).
 *
 * @param keys - The flowchart's keys
 * @param tabKey - The tab's key ({@link flowchartTabKey})
 * @returns The library's id
 */
export function flowchartLibraryId(keys: FlowchartKeys, tabKey: string): string {
    return `${keys.library}:${tabKey}`;
}

/**
 * A data tab's name: an author's tab's own; a template tab's its author's, or
 * the flowchart's words for it.
 *
 * @param tab - The tab
 * @param m - The flowchart's messages
 * @returns The name its tab shows
 */
function nameOf(tab: FlowchartDataTabValue, m: FlowchartMessages): string {
    switch (tab.type) {
        case "states":
        case "transitions": return getSomeorUndefined(tab.value.name) ?? m.libraryTab({ tab: tab.type });
        case "tab": return tab.value.name;
    }
}

/**
 * A data tab's cards, as the wire carries them, and whether they drag: a
 * template's always, an author's when its tab declares a `drop` — its cards
 * landing somewhere.
 *
 * @param tab - The tab
 * @returns Its cards, whether they drag, and its icon
 */
function cardsOf(tab: FlowchartDataTabValue): { readonly cards: readonly FlowchartCardValue[]; readonly drags: boolean; readonly icon: string | undefined } {
    const icon = getSomeorUndefined(tab.value.icon);
    switch (tab.type) {
        case "states":
        case "transitions": return { cards: tab.value.cards, drags: true, icon };
        case "tab": return { cards: tab.value.lands.value, drags: tab.value.lands.type !== "none", icon };
    }
}

/**
 * A card as the Library draws it: its label, its meta under it and the tab's
 * icon — no media, byline, action, facets or secondary facts — searched by its
 * key, label and meta, and grouped by its group.
 *
 * @param card - The card
 * @param icon - The tab's icon, a Font Awesome solid name
 * @param drags - Whether it is a drag source
 * @param placed - Whether it is the card the tab's click selected
 * @returns The Library's item
 */
function cardItem(card: FlowchartCardValue, icon: string | undefined, drags: boolean, placed: boolean): LibraryItemValue {
    const meta = getSomeorUndefined(card.meta);
    const group = getSomeorUndefined(card.group);
    return {
        key: card.key,
        label: card.label,
        sublabel: meta === undefined ? none : some(meta),
        icon: icon === undefined ? none : some(icon),
        status: none,
        trailing: none,
        draggable: drags,
        filtered: false,
        placed,
        media: none,
        avatar: none,
        byline: none,
        action: none,
        search: some([card.key, card.label, meta ?? ""].filter((text) => text !== "").join(" · ")),
        groups: group === undefined ? new Map() : new Map([["group", group]]),
        facets: new Map(),
        dims: new Map(),
    };
}

/** Props of {@link useFlowchartLibrary}. */
export interface FlowchartLibraryProps {
    /** The tabs the payload lists, in order. */
    readonly library: FlowchartValue["library"];
    /** The Flows tab's body and its count; `undefined` over one flow, which lists no flows. */
    readonly flows: { readonly body: ReactNode; readonly count: string } | undefined;
    /** The names the flowchart keeps its viewer's state under. */
    readonly keys: FlowchartKeys;
    /** The flowchart's words. */
    readonly words: FlowchartWords;
}

/**
 * The library pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The tabs listed, the Flows tab's body, the flowchart's keys, and its words
 * @returns The pane — its tabs the ones `library` lists, each with its count; 272px wide; its collapsed state kept per viewer — or `undefined`, no pane, when `library` lists none
 */
export function useFlowchartLibrary({ library, flows, keys, words }: FlowchartLibraryProps): BuilderFrameDock | undefined {
    const m = words.m;
    // The card each data tab's click selected, by the tab's key (FB26): a click on another moves it, a click on it lets it go.
    const [picked, setPicked] = useState<ReadonlyMap<string, string>>(() => new Map());
    const onCard = useCallback((tabKey: string, key: string) => {
        setPicked((was) => {
            const next = new Map(was);
            const chosen = was.get(tabKey);
            if (chosen !== undefined && stringEqual(chosen, key)) next.delete(tabKey);
            else next.set(tabKey, key);
            return next;
        });
    }, []);
    // Each data tab's Library: its own rows' cards, as its tab reads them.
    const libraries = useMemo(() => new Map(library.flatMap((tab): [string, LibraryValue][] => {
        if (tab.type === "flows") return [];
        const tabKey = flowchartTabKey(tab);
        const { cards, drags, icon } = cardsOf(tab);
        const chosen = picked.get(tabKey);
        return [[tabKey, {
            id: flowchartLibraryId(keys, tabKey),
            hint: none,
            items: cards.map((card) => cardItem(card, icon, drags, chosen !== undefined && stringEqual(chosen, card.key))),
            groupOptions: cards.some((card) => card.group.type === "some") ? [{ key: "group", label: m.libraryGroupBy() }] : [],
            groupSummaries: new Map(),
            dimOptions: [],
            defaultDimensions: [],
            filterOptions: [],
            searchable: true,
            noun: some({ singular: m.libraryNoun({ tab: tab.type, n: 1 }), plural: m.libraryNoun({ tab: tab.type, n: 2 }) }),
            addLabel: none,
            onAdd: none,
            onCardClick: some((key: string) => { onCard(tabKey, key); return null; }),
            slice: none,
            style: FILL,
            variant: none,
            layout: none,
            toolbar: true,
        }]];
    })), [library, picked, keys, m, onCard]);

    return useMemo((): BuilderFrameDock | undefined => {
        // No tab listed: no pane (FB29).
        if (library.length === 0) return undefined;
        const tabs = library.map((tab) => {
            if (tab.type === "flows") return { key: "flows", label: m.flowsTab(), count: flows?.count, body: flows?.body ?? null };
            const tabKey = flowchartTabKey(tab);
            const value = libraries.get(tabKey)!;
            const name = nameOf(tab, m);
            return {
                key: tabKey,
                label: name,
                count: words.number(value.items.length),
                body: (
                    <EastChakraLibrary value={value} storageKey={`${keys.library}.${tabKey}`}
                        empty={{ title: m.libraryEmpty({ tab: tab.type, name }), description: m.libraryEmptyHint({ tab: tab.type, name }) }} />
                ),
            };
        });
        // Collapsed, the rail counts the first tab's cards (FB25).
        return { label: m.libraryPane(), icon: "layer-group", badge: tabs[0]!.count, size: LIBRARY_SIZE, persist: "local", tabs };
    }, [library, flows, libraries, keys, m, words]);
}
