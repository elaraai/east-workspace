/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library pane (#1501, `Flowchart Records Spec.md` R14, D5, D8): the
 * Flowchart's start pane, its tabs the ones `library` lists, in that order,
 * each with its count after its name and a search. A Flowchart whose
 * `library` lists no tab has no pane.
 *
 * - **Steps** (`Flowchart.library.states()`), **Transitions**
 *   (`Flowchart.library.transitions()`) and **Lanes**
 *   (`Flowchart.library.lanes()`) — each its kind's cards, as the kind carries
 *   them (`Flowchart.templates` on the kind): one card per card row, its name,
 *   with the tab's icon or else its kind's, grouped by its `group` and
 *   searched by its name. A tab its author leaves unnamed is named in the
 *   Flowchart's words.
 * - **An author's tab** (`Flowchart.library.tab(rows, …)`) — its cards, each
 *   its label and the line under it, grouped by its `group` and searched by
 *   its key, label and line.
 * - An empty tab says so in the shared empty state; a search that hides
 *   every card, the `Library`'s own `No matches`. Collapsed, the pane is a
 *   rail with the first tab's count — of the cards it shows.
 * - **The narrowing**: a kind's tab follows the source its cards name, an
 *   author's tab the source it names, by its cards' keys — the shared
 *   `sourceTab`: the tab shows the cards its source shows, counts them (`2 of
 *   5`), says so when the rail leaves it none, with the rail's Clear for that
 *   source alone, and while its source resolves holds its cards retained
 *   (#1398, CL8): readable and selectable, aria-disabled, taking no drag, ⏎ or
 *   tap that drops. A tab that follows none lists its cards whole.
 * - **A kind adding no row** (#1549): the Steps' or the Lanes' cards of a kind
 *   whose keys the form can't type, and that builds none, take no drag, ⏎ or
 *   tap that drops, each card's line saying why.
 *
 * Each tab's cards are a `Library`'s, drawn by the shared parts — every icon
 * Font Awesome's solid set, every style the `library` recipe's — and drag
 * from the library `${flowchartKeys(name).library}:<the tab's key>`
 * ({@link flowchartLibraryId}), each card keyed by its row's key: the canvas
 * takes them dropped (`use-drop.ts`). A kind's cards always drag; an author's
 * when its tab's patch names a kind. A card that drops takes ⏎ too — the
 * card, dropped on the canvas's selection — and on a touch screen, or below
 * 480px of main, a tap on the selected card does the same, so no edit needs a
 * precise drag; the tap leaves it selected, for the next. Below 480px of main
 * no card drags. A click selects a card, and a click on the selected card lets
 * it go.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, equalFor, none, some } from "@elaraai/east";
import type { flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary, getSomeorUndefined, useCoarsePointer, type BuilderFrameDock, type LibraryEmpty, type LibraryNarrowing, type LibraryValue,
} from "@elaraai/east-ui-components";
import type { FollowedSources } from "../shared/schedule/follow-sources.js";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { sourceTab, type SourceShown, type SourceTab } from "../shared/schedule/source-tab.js";
import type { FlowchartLibraryTabWord, FlowchartMessages, FlowchartWords } from "./messages.js";
import type { FlowchartValue } from "./model.js";

type Styles = Record<string, SystemStyleObject>;

/** The names a Flowchart keeps its viewer's state under. */
type FlowchartKeys = ReturnType<typeof flowchartKeys>;
/** One tab the payload lists, decoded. */
export type FlowchartTabValue = FlowchartValue["library"][number];
/** The kinds whose cards a tab of their own lists. */
export type FlowchartCardKind = "states" | "transitions" | "lanes";
/** What a kind whose cards a tab lists carries of them: its icon, its cards, and the source they follow. */
type CardKindValue = Pick<FlowchartValue["states"], "icon" | "templates" | "templatesSource">;

const stringEqual = equalFor(StringType);

/** The library open: the design system's 272px. */
const LIBRARY_SIZE = "272px";

/** What a tab that follows no source shows: its cards whole. */
const WHOLE: SourceShown = { keys: none, busy: false, ready: true, clear: undefined };

/** A card as the pane lists it, whatever its tab: its key, its name, the line under it, its group, and what its search reads. */
interface PaneCard {
    readonly key: string;
    readonly label: string;
    readonly meta: string | undefined;
    readonly group: string | undefined;
    readonly search: string;
}

/**
 * A tab's key among the pane's tabs — and, after the Flowchart's library id,
 * its cards' library's: `states`, `transitions`, `lanes`, or `tab:<its name>`.
 *
 * @param tab - The tab
 * @returns Its key
 */
export function flowchartTabKey(tab: FlowchartTabValue): string {
    return tab.type === "tab" ? `tab:${tab.value.name}` : tab.type;
}

/**
 * The library a tab's cards drag from — the libraries the canvas takes drops
 * from.
 *
 * @param keys - The Flowchart's keys
 * @param tabKey - The tab's key ({@link flowchartTabKey})
 * @returns The library's id
 */
export function flowchartLibraryId(keys: FlowchartKeys, tabKey: string): string {
    return `${keys.library}:${tabKey}`;
}

/**
 * A kind whose cards a tab lists, as the payload carries it.
 *
 * @param value - The payload
 * @param kind - The kind
 * @returns Its icon, its cards and their source; `undefined` for a kind the Flowchart is not given
 */
export function cardKindOf(value: FlowchartValue, kind: FlowchartCardKind): CardKindValue | undefined {
    switch (kind) {
        case "states": return value.states;
        case "transitions": return getSomeorUndefined(value.transitions);
        case "lanes": return getSomeorUndefined(value.lanes);
    }
}

/**
 * The source of the rail a tab follows: a kind's tab its cards', an author's
 * tab its own — each when it names one.
 *
 * @param value - The payload
 * @param tab - The tab
 * @returns The source's name; `undefined` for a tab that follows none
 */
export function flowchartTabSource(value: FlowchartValue, tab: FlowchartTabValue): string | undefined {
    if (tab.type === "tab") return getSomeorUndefined(tab.value.source);
    const kind = cardKindOf(value, tab.type);
    return kind === undefined ? undefined : getSomeorUndefined(kind.templatesSource);
}

/**
 * A tab's name: an author's tab's own; a kind's tab its author's, or the
 * Flowchart's words for it — `Steps`, `Transitions`, `Lanes`.
 *
 * @param tab - The tab
 * @param m - The Flowchart's messages
 * @returns The name its tab shows
 */
export function flowchartTabName(tab: FlowchartTabValue, m: FlowchartMessages): string {
    return tab.type === "tab" ? tab.value.name : getSomeorUndefined(tab.value.name) ?? m.libraryTab({ tab: tab.type });
}

/** A tab's cards as the pane lists them, its icon, and whether its cards drag: a kind's always, an author's when its patch names a kind. */
function tabCards(value: FlowchartValue, tab: FlowchartTabValue): { readonly cards: readonly PaneCard[]; readonly icon: string | undefined; readonly drops: boolean } {
    if (tab.type === "tab") {
        return {
            cards: tab.value.cards.map((card): PaneCard => {
                const meta = getSomeorUndefined(card.meta);
                return {
                    key: card.key, label: card.label, meta, group: getSomeorUndefined(card.group),
                    search: [card.key, card.label, meta ?? ""].filter((text) => text !== "").join(" · "),
                };
            }),
            icon: getSomeorUndefined(tab.value.icon),
            drops: tab.value.drop.type === "some",
        };
    }
    const kind = cardKindOf(value, tab.type);
    return {
        cards: (kind?.templates ?? []).map((card): PaneCard => ({ key: card.key, label: card.name, meta: undefined, group: getSomeorUndefined(card.group), search: card.name })),
        icon: getSomeorUndefined(tab.value.icon) ?? (kind === undefined || kind.icon === "" ? undefined : kind.icon),
        drops: true,
    };
}

/** One tab, as the pane builds it: its word, key, name, icon, whether its cards drop, and what its source shows of them. */
interface PaneTab {
    readonly word: FlowchartLibraryTabWord;
    readonly tabKey: string;
    readonly name: string;
    readonly icon: string | undefined;
    readonly drops: boolean;
    /** Why its cards drop nowhere, on each card's line: its kind adds no row (#1549); `undefined` for cards that drop as its tab does. */
    readonly why: string | undefined;
    /** Whether any of its cards has a group: its Group by. */
    readonly grouped: boolean;
    readonly follow: SourceTab<PaneCard>;
}

/** A tab's narrowing in the Flowchart's words: the shared narrowing, its empty state said by its message table. */
function narrowingOf(narrowing: LibraryNarrowing | undefined, tab: FlowchartLibraryTabWord, name: string, m: FlowchartMessages): LibraryNarrowing | undefined {
    return narrowing === undefined ? undefined
        : { ...narrowing, empty: { title: m.libraryNarrowed({ tab, name }), description: m.libraryNarrowedHint({ tab, name }) } };
}

/** Props of {@link useFlowchartLibrary}. */
export interface FlowchartLibraryProps {
    /** The payload: its library's tabs, and its kinds and their cards. */
    readonly value: FlowchartValue;
    /** The names the Flowchart keeps its viewer's state under. */
    readonly keys: FlowchartKeys;
    /** The Flowchart's words. */
    readonly words: FlowchartWords;
    /** A card's ⏎: the card, by its library and its key, dropped on the canvas's selection. */
    readonly enter?: ((library: string, key: string) => void) | undefined;
    /** What each source the library's tabs follow shows, by the source's name. */
    readonly followed: FollowedSources;
    /** Whether main is below 480px: no card drags, and a tap on the selected card is its ⏎, whatever the pointer. */
    readonly narrow?: boolean | undefined;
    /** Why the states or the lanes add no row (#1549): their keys can't be typed, and they build none — their cards' line. */
    readonly off?: { readonly states?: string | undefined; readonly lanes?: string | undefined } | undefined;
}

/**
 * The library pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The payload, the Flowchart's keys, its words, a card's ⏎, the followed sources, whether main is narrow and
 *   why a kind adds no row
 * @returns The pane — its tabs the ones `library` lists, each with its count; 272px wide; its collapsed state kept per viewer — or `undefined`, no pane, when `library` lists none
 */
export function useFlowchartLibrary({ value, keys, words, enter, followed, narrow = false, off }: FlowchartLibraryProps): BuilderFrameDock | undefined {
    const m = words.m;
    const library = value.library;
    // The recipe's styles, resolved once a recipe: the frame renders it again as each read lands.
    const recipe = useSlotRecipe({ key: "flowchart" });
    const styles = useMemo(() => recipe() as Styles, [recipe]);
    // A touch screen, or a main too narrow to drag on: a tap on the selected card drops it, as its ⏎ does.
    const coarse = useCoarsePointer();
    const tapDrops = coarse || narrow;

    // The card each tab's click selected, by the tab's key: a click on another moves it, a click on it lets it go.
    const [picked, setPicked] = useState<ReadonlyMap<string, string>>(() => new Map());
    const isPicked = useCallback((tabKey: string, key: string) => {
        const chosen = picked.get(tabKey);
        return chosen !== undefined && stringEqual(chosen, key);
    }, [picked]);
    const pick = useCallback((tabKey: string, key: string) => {
        setPicked((was) => {
            const next = new Map(was);
            const chosen = was.get(tabKey);
            if (chosen !== undefined && stringEqual(chosen, key)) next.delete(tabKey);
            else next.set(tabKey, key);
            return next;
        });
    }, []);

    // Each tab over the source it follows, by its cards' keys: the cards it shows, its count, its narrowed and its own
    // empty states, and its pane's attributes; a tab that follows none, its cards whole.
    const offStates = off?.states, offLanes = off?.lanes;
    const tabs = useMemo(() => library.map((tab): PaneTab => {
        const { cards, icon, drops } = tabCards(value, tab);
        const name = flowchartTabName(tab, m);
        const source = flowchartTabSource(value, tab);
        const shown = source === undefined ? WHOLE : followed.get(source)?.shown ?? WHOLE;
        // A Steps' or a Lanes' card adds a row: none where its kind adds none.
        const why = tab.type === "states" ? offStates : tab.type === "lanes" ? offLanes : undefined;
        return {
            word: tab.type, tabKey: flowchartTabKey(tab), name, icon, drops: drops && why === undefined, why, grouped: cards.some((card) => card.group !== undefined),
            follow: sourceTab({ cards, keyOf: (card) => card.key, shown, noun: tab.type === "tab" ? name.toLocaleLowerCase(words.locale) : m.libraryNoun({ tab: tab.type, n: 2 }), words }),
        };
    }), [library, value, followed, m, words, offStates, offLanes]);

    // Each tab whose cards drop takes ⏎ on a card: the card, dropped on the canvas's selection — one function per tab, held still.
    const enters = useMemo(() => new Map(tabs.flatMap((tab): [string, (key: string) => void][] => {
        if (enter === undefined || !tab.drops) return [];
        const id = flowchartLibraryId(keys, tab.tabKey);
        return [[tab.tabKey, (key: string) => enter(id, key)]];
    })), [tabs, keys, enter]);
    // A tab its source reads again holds its cards retained (#1398, CL8): a tap on one selects it, and drops nothing.
    const held = useMemo(() => new Set(tabs.flatMap((tab) => (tab.follow.pane["aria-disabled"] === true ? [tab.tabKey] : []))), [tabs]);
    // A click on a card selects it, or lets the selected one go; on a touch screen, or below 480px of main, a tap on the
    // selected card is its ⏎ — never in a tab held while its source reads again.
    const onCard = useCallback((tabKey: string, key: string) => {
        const onEnter = held.has(tabKey) ? undefined : enters.get(tabKey);
        if (tapDrops && onEnter !== undefined && isPicked(tabKey, key)) onEnter(key);
        else pick(tabKey, key);
    }, [held, enters, tapDrops, isPicked, pick]);
    const groupBy = useMemo(() => [{ key: "group", label: m.libraryGroupBy() }], [m]);

    // Each tab's Library: the cards its source shows, each a drag source where its tab drops and main is wide enough.
    const libraries = useMemo(() => new Map(tabs.map((tab): [string, LibraryValue] => [tab.tabKey, scheduleLibrary({
        id: flowchartLibraryId(keys, tab.tabKey),
        items: tab.follow.cards.map((card) => {
            // A card of a kind adding no row says why on its line (#1549).
            const line = tab.why ?? card.meta;
            return scheduleLibraryCard({
                key: card.key, label: card.label, sublabel: line === undefined ? none : some(line), icon: tab.icon === undefined ? none : some(tab.icon),
                status: none, trailing: none,
                draggable: tab.drops && !narrow, filtered: false, placed: isPicked(tab.tabKey, card.key),
                search: some(card.search),
                groups: card.group === undefined ? new Map() : new Map([["group", card.group]]),
            });
        }),
        groupOptions: tab.grouped ? groupBy : [],
        noun: some({ singular: m.libraryNoun({ tab: tab.word, n: 1 }), plural: m.libraryNoun({ tab: tab.word, n: 2 }) }),
        onCardClick: some((key: string) => { onCard(tab.tabKey, key); return null; }),
    }, true)])), [tabs, keys, narrow, isPicked, groupBy, m, onCard]);

    return useMemo((): BuilderFrameDock | undefined => {
        // No tab listed: no pane.
        if (tabs.length === 0) return undefined;
        const panes = tabs.map((tab) => {
            const cards = libraries.get(tab.tabKey)!;
            const empty: LibraryEmpty | undefined = tab.follow.empty === undefined ? undefined
                : { title: m.libraryEmpty({ tab: tab.word, name: tab.name }), description: m.libraryEmptyHint({ tab: tab.word, name: tab.name }) };
            return {
                key: tab.tabKey,
                label: tab.name,
                count: tab.follow.count,
                shown: cards.items.length,
                body: (
                    // Its source's cards, counted, and while its source narrows what it says when that leaves it none.
                    <Box css={styles.pane} data-flowchart-library={tab.tabKey} {...tab.follow.pane}>
                        <EastChakraLibrary value={cards} storageKey={`${keys.library}.${tab.tabKey}`} onCardEnter={enters.get(tab.tabKey)} empty={empty}
                            narrowing={narrowingOf(tab.follow.narrowing, tab.word, tab.name.toLocaleLowerCase(words.locale), m)} />
                    </Box>
                ),
            };
        });
        // Collapsed, the rail counts the cards the first tab shows.
        return {
            label: m.libraryPane(), icon: "layer-group", badge: panes[0]!.shown, size: LIBRARY_SIZE, persist: "local",
            tabs: panes.map(({ shown: _shown, ...pane }) => pane),
        };
    }, [tabs, libraries, enters, keys, m, words.locale, styles.pane]);
}
