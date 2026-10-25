/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library pane (#1389, `Schematic Builder Spec.md` §8, SC4, SC27): the
 * Schematic's start pane, its tabs the ones `library` lists, in that order,
 * each with its count after its name. A Schematic whose `library` lists no
 * tab has no pane. Like the Calendar's and the Plan's, each covers every kind
 * (D33):
 *
 * - **Templates** (`Schematic.library.templates()`) — every kind's templates,
 *   item, link and net kinds alike, each card its template's name over its
 *   kind's, grouped by its kind and then its template's `group`; each kind's
 *   list follows the source of the rail its templates record names
 *   (`sourcesTab`), counting what it shows (`3 of 5`) and saying so, with
 *   Clear filters, when the rail leaves it none.
 * - **Backlog** (`Schematic.library.backlog()`) — every item kind's rows with
 *   no position, with the drafts in place (`backlog.ts`), each card its
 *   label, its kind's name and its second line, and its status's dot, grouped
 *   by its kind. A kind read through its source lists the rows its narrowing
 *   holds; while the rail narrows one, an emptied tab says so with Clear
 *   filters. Beside a kind read by area (#1393, D51), it is one paged list
 *   (`PagedLibrary` over `backlog-pages.ts`): the rows in hand, then each such
 *   kind's, a page at a time through its area index's unplaced clause, a row
 *   its narrowing leaves out, or a draft placed or deleted, drawn as context;
 *   it counts `N of M` while an index the narrowing leads narrows it.
 * - **Index** (`Schematic.library.index()`) — the zones nested by containment
 *   and the items inside them (`index-tab.tsx`); a kind read by area's read by
 *   the tab itself, an open zone's by its box and the search's through the
 *   kind's source (#1393, D52).
 * - **Layers** (`Schematic.library.layers()`) — each layer, with Isolate, Lock
 *   and Show or Hide, and Show all (`layers-tab.tsx`).
 * - **An author's tab** (`Schematic.library.tab(rows, …)`) — its cards, each
 *   its label and its meta, grouped by its `group`, following the source it
 *   names (`sourceTab`).
 *
 * Each card tab is a `Library` — its search finds within the tab alone, and
 * only the cards in view are mounted, as the Roster's and the Allocation's
 * are — whose cards are keyed as the canvas names what they are: a template's and a
 * backlog row's by its kind's slot and its key, as East prints a
 * `Schematic.Types.Ref`; an author's by its row's key. A click selects a card,
 * and a click on the selected card lets it go: the template selected is what
 * a Connect's new link or net takes its fields from (§4.3). The frame keeps
 * which card each tab has selected.
 *
 * Each card that drops is a drag source (#1390): every template, every
 * backlog row, and an author's tab's cards when its patch names a kind. They
 * drag from the libraries `${schematicKeys(id).library}:<the tab's key>`
 * ({@link schematicLibraryId}), which the canvas takes drops from
 * (`use-drop.ts`). A card that drops takes ⏎ too — dropped on the selection,
 * or at the view's centre — and on a touch screen a tap on the selected card
 * does the same, so no drop needs a precise drag (SC13); the tap leaves it
 * selected, for the next. Below 480px of main (#1394, D15) no card drags, and
 * a tap on the selected card drops it whatever the pointer. While a tab's
 * source reads again its cards are retained (#1398, CL8): aria-disabled,
 * selectable, and taking no drag, ⏎ or tap that drops.
 *
 * The pane is the frame's start pane, 272px open, its open tab and its
 * collapsed state kept under the Schematic's `id`; collapsed, its rail counts
 * the backlog — or, with no Backlog tab, the first tab's cards.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, equalFor, none, some } from "@elaraai/east";
import type { schematicKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary, getSomeorUndefined, useCoarsePointer, useSlicesReactivity, useTrackedEvaluation,
    type BuilderFrameDock, type LibraryEmpty, type LibraryItemValue, type LibraryNarrowing, type LibraryValue,
} from "@elaraai/east-ui-components";
import { PagedLibrary, narrowedCount } from "@elaraai/east-ui-components/internal";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import type { FollowedSources } from "../shared/schedule/follow-sources.js";
import { sourceTab, sourcesTab, type SourceShown, type SourceTab } from "../shared/schedule/source-tab.js";
import type { BacklogEntry } from "./backlog.js";
import type { BacklogPageCount, BacklogPageRow, SchematicBacklogPages } from "./backlog-pages.js";
import { entityId, type DrawnItem, type DrawnZone } from "./canvas/drawn.js";
import type { SchematicLayerValue } from "./canvas/layers.js";
import type { SchematicValue } from "./data.js";
import { SchematicIndexTab, type SchematicIndexAreaProps } from "./index-tab.js";
import type { SchematicLayerView } from "./layers-view.js";
import { SchematicLayersTab } from "./layers-tab.js";
import type { SchematicLibraryTabWord, SchematicWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** The names a Schematic keeps its viewer's state under. */
type SchematicKeys = ReturnType<typeof schematicKeys>;
/** One tab the payload lists, decoded. */
type SchematicTabValue = SchematicValue["library"][number];
/** An author's tab, decoded. */
type AuthorTabValue = Extract<SchematicTabValue, { type: "tab" }>["value"];
/** One card of an author's tab. */
type AuthorCardValue = AuthorTabValue["cards"][number];
/** A kind that may have templates: an item, link or net kind. */
type TemplatesKind = SchematicValue["items"][number] | SchematicValue["links"][number] | SchematicValue["nets"][number];
/** A template, decoded. */
type TemplateValue = TemplatesKind["templates"][number];

/** One template's card: its kind, and the template. */
interface TemplateEntry {
    readonly kind: TemplatesKind;
    readonly template: TemplateValue;
}

const stringEqual = equalFor(StringType);

/** The library open: the Calendar's and the Plan's 272px (§8). */
const LIBRARY_SIZE = "272px";

/** What a tab that follows no source shows: its cards whole. */
const WHOLE: SourceShown = { keys: none, busy: false, ready: true, clear: undefined };

/**
 * A tab's key among the pane's tabs — and, after the Schematic's library id,
 * its cards' library's: `templates`, `backlog`, `index`, `layers`, or
 * `tab:<its name>`.
 *
 * @param tab - The tab
 * @returns Its key
 */
export function schematicTabKey(tab: SchematicTabValue): string {
    return tab.type === "tab" ? `tab:${tab.value.name}` : tab.type;
}

/**
 * The library a tab's cards drag from (#1390): the Schematic's library id, and the tab's key.
 *
 * @param keys - The Schematic's keys
 * @param tabKey - The tab's key ({@link schematicTabKey})
 * @returns The library's id
 */
export function schematicLibraryId(keys: SchematicKeys, tabKey: string): string {
    return `${keys.library}:${tabKey}`;
}

/** What the rail hides of the backlog: whether it narrows an item kind read through its source, and its Clear filters. */
export interface SchematicBacklogNarrowing {
    /** Whether a choice of the rail narrows an item kind with a backlog. */
    readonly narrows: boolean;
    /** Clears those kinds' sources' choices; `undefined` while none narrows. */
    readonly clear: (() => void) | undefined;
}

/** Props of {@link useSchematicLibrary}. */
export interface SchematicLibraryProps {
    /** The payload: its library's tabs, its kinds and their templates, its layers. */
    readonly value: SchematicValue;
    /** The zones the canvas draws, the drafts in place and a hidden layer's left out: the Index's. */
    readonly zones: readonly DrawnZone[];
    /** The items the canvas draws, as its zones are: the Index's. */
    readonly items: readonly DrawnItem[];
    /** Every item kind's rows with no position, the drafts in place: the Backlog's. */
    readonly backlog: readonly BacklogEntry[];
    /** What the rail hides of the backlog. */
    readonly backlogNarrowing: SchematicBacklogNarrowing;
    /**
     * The Backlog beside item kinds read by area (#1393, D51): its one paged list — the rows in hand, then each such kind's
     * rows with no position, read a page at a time — and what it counts, `undefined` while a count is read; `undefined`
     * while the Backlog lists only rows in hand.
     */
    readonly backlogPages?: { readonly source: SchematicBacklogPages; readonly count: BacklogPageCount | undefined } | undefined;
    /** The item kinds read by area, which the Index reads itself (#1393, D52); `undefined` with none. */
    readonly indexArea?: SchematicIndexAreaProps | undefined;
    /** The layers, with their author defaults. */
    readonly layers: readonly SchematicLayerValue[];
    /** How many entities each layer holds in the drawing, by its key. */
    readonly layerCounts: ReadonlyMap<string, number>;
    /** The viewer's layer choices. */
    readonly layerView: SchematicLayerView;
    /** Writes the viewer's layer choices. */
    readonly onLayerView: (next: SchematicLayerView) => void;
    /** The zone the viewport is in, by its id. */
    readonly inView: string | undefined;
    /** What the canvas has selected, by id. */
    readonly selected: ReadonlySet<string>;
    /** Flies to an item or a zone, by its id, and selects it. */
    readonly onReveal: (id: string) => void;
    /** The names the Schematic keeps its viewer's state under. */
    readonly keys: SchematicKeys;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** What each source of the rail its tabs follow shows: each templates record's, and each an author's tab names. */
    readonly followed: FollowedSources;
    /** The card each card tab has selected, by the tab's key: the frame's. */
    readonly picked: ReadonlyMap<string, string>;
    /** A click on a card of a tab, by the tab's key and the card's: it selects the card, or lets the selected one go. */
    readonly onPick: (tabKey: string, key: string) => void;
    /** A card's ⏎ (#1390, SC13): the card, by its library and its key, dropped on the selection or at the view's centre. */
    readonly enter?: ((library: string, key: string) => void) | undefined;
    /** Whether main is below 480px (#1394, D15): no card drags, and a tap on the selected card is its ⏎, whatever the pointer. */
    readonly narrow?: boolean | undefined;
}

/** A tab's narrowing in the Schematic's words: the shared narrowing, its empty state said by its message table. */
function narrowingOf(narrowing: LibraryNarrowing | undefined, tab: SchematicLibraryTabWord, name: string, words: SchematicWords): LibraryNarrowing | undefined {
    return narrowing === undefined ? undefined
        : { ...narrowing, empty: { title: words.m.libraryNarrowed({ tab, name }), description: words.m.libraryNarrowedHint({ tab, name }) } };
}

/**
 * The Templates tab's cards (see the module docs): every kind's templates, in
 * the kinds' order — items', links', nets' — each following the source its
 * templates record names, by its key in that record.
 *
 * @param value - The payload
 * @param followed - What each followed source shows
 * @param words - The Schematic's words
 * @returns The cards it shows, its count, its narrowed and its own empty states, and its pane's attributes
 */
function templatesTab(value: SchematicValue, followed: FollowedSources, words: SchematicWords): SourceTab<TemplateEntry> {
    const kinds: readonly TemplatesKind[] = [...value.items, ...value.links, ...value.nets];
    const entries = kinds.flatMap((kind) => kind.templates.map((template): TemplateEntry => ({ kind, template })));
    const sourceOf = (kind: TemplatesKind): SourceShown | undefined => {
        const source = getSomeorUndefined(kind.templatesSource);
        return source === undefined ? undefined : followed.get(source)?.shown;
    };
    const sources = kinds.flatMap((kind) => { const shown = sourceOf(kind); return shown === undefined ? [] : [shown]; })
        .filter((shown, i, all) => all.indexOf(shown) === i);
    return sourcesTab({
        cards: entries, keyOf: (entry) => entry.template.key, sources, sourceOf: (entry) => sourceOf(entry.kind),
        noun: words.m.libraryNoun({ tab: "templates", n: 2 }), words,
    });
}

/**
 * The library pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The payload, the drawing's zones and items, the backlog and what the rail hides of it, the layers and the viewer's choices, the zone in view, the selection, what a row's click does, the keys, the words and the followed sources
 * @returns The pane — its tabs the ones `library` lists, each with its count — or `undefined`, no pane, when `library` lists none
 */
export function useSchematicLibrary(props: SchematicLibraryProps): BuilderFrameDock | undefined {
    const {
        value, zones, items, backlog, backlogNarrowing, backlogPages, indexArea, layers, layerCounts, layerView, onLayerView, inView, selected, onReveal, keys,
        words, followed, picked, onPick, enter, narrow = false,
    } = props;
    const m = words.m;
    // The recipe's styles, resolved once a recipe: the frame renders it again as each window lands.
    const recipe = useSlotRecipe({ key: "schematic" });
    const styles = useMemo(() => recipe() as Styles, [recipe]);
    const library = value.library;
    const listsBacklog = library.some((tab) => tab.type === "backlog");
    // A touch screen, or a main too narrow to drag on (#1394): a tap on the selected card drops it, as its ⏎ does (SC13).
    const coarse = useCoarsePointer();
    const tapDrops = coarse || narrow;

    const isPicked = useCallback((tabKey: string, key: string) => {
        const chosen = picked.get(tabKey);
        return chosen !== undefined && stringEqual(chosen, key);
    }, [picked]);
    // Each tab whose cards drop takes ⏎ on a card (#1390): the card, dropped on the selection or at the view's centre —
    // one function per tab, held still. An author's tab drops when its patch names a kind.
    const enters = useMemo(() => new Map(library.flatMap((tab): [string, (key: string) => void][] => {
        if (enter === undefined) return [];
        const drops = tab.type === "templates" || tab.type === "backlog" || (tab.type === "tab" && tab.value.drop.type === "some");
        if (!drops) return [];
        const tabKey = schematicTabKey(tab);
        const id = schematicLibraryId(keys, tabKey);
        return [[tabKey, (key: string) => enter(id, key)]];
    })), [library, keys, enter]);
    // What each tab that follows a source shows: the Templates tab its kinds' templates records', an author's tab its own.
    const templatesFollow = useMemo(() => templatesTab(value, followed, words), [value, followed, words]);
    const authorTabs = useMemo(() => library.flatMap((tab) => (tab.type === "tab" ? [tab.value] : [])), [library]);
    const authorFollows = useMemo(() => new Map(authorTabs.map((tab): [string, SourceTab<AuthorCardValue>] => {
        const source = getSomeorUndefined(tab.source);
        const shown = source === undefined ? WHOLE : followed.get(source)?.shown ?? WHOLE;
        return [`tab:${tab.name}`, sourceTab({ cards: tab.cards, keyOf: (card) => card.key, shown, noun: tab.name.toLocaleLowerCase(words.locale), words })];
    })), [authorTabs, followed, words]);
    // A tab its source reads again holds its cards retained (#1398, CL8): a tap on one selects it, and drops nothing.
    const held = useMemo(() => new Set([...(templatesFollow.pane["aria-disabled"] === true ? ["templates"] : []),
        ...[...authorFollows].flatMap(([tabKey, follow]) => (follow.pane["aria-disabled"] === true ? [tabKey] : []))]), [templatesFollow, authorFollows]);
    // A click on a card selects it, or lets the selected one go; on a touch screen, or below 480px of main, a tap on the
    // selected card is its ⏎ (SC13, #1394) — never in a tab held while its source reads again.
    const onCard = useCallback((tabKey: string, key: string) => {
        const onEnter = held.has(tabKey) ? undefined : enters.get(tabKey);
        if (tapDrops && onEnter !== undefined && isPicked(tabKey, key)) onEnter(key);
        else onPick(tabKey, key);
    }, [enters, held, tapDrops, isPicked, onPick]);
    const groupBy = useMemo(() => [{ key: "group", label: m.libraryGroupBy() }], [m]);
    const noun = useCallback((tab: SchematicLibraryTabWord) => some({ singular: m.libraryNoun({ tab, n: 1 }), plural: m.libraryNoun({ tab, n: 2 }) }), [m]);
    const empty = useCallback((tab: SchematicLibraryTabWord, name: string): LibraryEmpty => ({ title: m.libraryEmpty({ tab, name }), description: m.libraryEmptyHint({ tab, name }) }), [m]);

    // ── Templates: every kind's, under its name, then their group ────────
    const templates = useMemo((): LibraryValue => scheduleLibrary({
        id: schematicLibraryId(keys, "templates"),
        items: templatesFollow.cards.map(({ kind, template }) => {
            const key = entityId({ kind: kind.key, key: template.key });
            const icon = getSomeorUndefined(template.icon) ?? (kind.icon === "" ? undefined : kind.icon);
            return scheduleLibraryCard({
                key, label: template.name, sublabel: some(kind.name), icon: icon === undefined ? none : some(icon), status: none, trailing: none,
                // An item kind's lands on the canvas, a link or a net kind's on a link or a net of its kind (#1390) — dragged
                // there wherever main is wide enough (#1394).
                draggable: !narrow, filtered: false, placed: isPicked("templates", key),
                search: some([template.name, kind.name, getSomeorUndefined(template.group) ?? ""].filter((text) => text !== "").join(" · ")),
                groups: new Map([["group", m.templateGroup({ kind: kind.name, group: getSomeorUndefined(template.group) })]]),
            });
        }),
        groupOptions: groupBy,
        noun: noun("templates"),
        onCardClick: some((key: string) => { onCard("templates", key); return null; }),
    }, true), [keys, templatesFollow, narrow, isPicked, m, groupBy, noun, onCard]);

    // ── Backlog: every item kind's rows with no position, under its name ─
    const kindOf = useMemo(() => new Map(value.items.map((kind) => [kind.key, kind] as const)), [value.items]);
    // A row's card: drawn as context — the narrowing leaves it out, or a draft placed or deleted it — faded, never dragged.
    const backlogCard = useCallback(({ id, ref, roles }: BacklogEntry, context: boolean): LibraryItemValue => {
        const kind = kindOf.get(ref.kind);
        const name = kind?.name ?? ref.kind;
        const icon = getSomeorUndefined(roles.icon) ?? (kind === undefined || kind.icon === "" ? undefined : kind.icon);
        const line = m.backlogLine({ kind: name, sublabel: getSomeorUndefined(roles.sublabel) });
        return scheduleLibraryCard({
            key: id, label: roles.label, sublabel: some(line), icon: icon === undefined ? none : some(icon), status: roles.status, trailing: none,
            // A drop places it where it lands (#1390, SC4): dragged there wherever main is wide enough (#1394).
            draggable: !context && !narrow, filtered: context, placed: isPicked("backlog", id),
            search: some([roles.label, ref.key, line].join(" · ")),
            groups: new Map([["group", name]]),
        });
    }, [kindOf, narrow, isPicked, m]);
    const backlogLibrary = useMemo((): LibraryValue => scheduleLibrary({
        id: schematicLibraryId(keys, "backlog"),
        items: backlog.map((entry) => backlogCard(entry, false)),
        groupOptions: groupBy,
        noun: noun("backlog"),
        onCardClick: some((key: string) => { onCard("backlog", key); return null; }),
    }, true), [keys, backlog, backlogCard, groupBy, noun, onCard]);
    // The paged Backlog's cards, and a click on one (#1393).
    const pagedCard = useCallback((row: BacklogPageRow) => backlogCard(row.entry, row.context), [backlogCard]);
    const onPagedCard = useCallback((key: string) => onCard("backlog", key), [onCard]);
    // The backlog is each kind's read: while the rail narrows one, an emptied tab says so, with Clear filters.
    const backlogNarrowed = useMemo((): LibraryNarrowing | undefined => (!backlogNarrowing.narrows || backlogNarrowing.clear === undefined ? undefined : {
        empty: { title: m.libraryNarrowed({ tab: "backlog", name: "" }), description: m.libraryNarrowedHint({ tab: "backlog", name: "" }) },
        onClear: backlogNarrowing.clear,
    }), [backlogNarrowing, m]);

    // ── An author's tabs: their cards, each following the source it names ─
    const authorLibraries = useMemo(() => new Map(authorTabs.map((tab): [string, LibraryValue] => {
        const tabKey = `tab:${tab.name}`;
        const icon = getSomeorUndefined(tab.icon);
        // Its cards drag when its patch names the kind they land on (#1390), wherever main is wide enough (#1394).
        const drags = tab.drop.type === "some" && !narrow;
        return [tabKey, scheduleLibrary({
            id: schematicLibraryId(keys, tabKey),
            items: (authorFollows.get(tabKey)?.cards ?? tab.cards).map((card) => {
                const meta = getSomeorUndefined(card.meta);
                const group = getSomeorUndefined(card.group);
                return scheduleLibraryCard({
                    key: card.key, label: card.label, sublabel: meta === undefined ? none : some(meta), icon: icon === undefined ? none : some(icon),
                    status: none, trailing: none,
                    draggable: drags, filtered: false, placed: isPicked(tabKey, card.key),
                    search: some([card.key, card.label, meta ?? ""].filter((text) => text !== "").join(" · ")),
                    groups: group === undefined ? new Map() : new Map([["group", group]]),
                });
            }),
            groupOptions: tab.cards.some((card) => card.group.type === "some") ? groupBy : [],
            noun: noun("tab"),
            onCardClick: some((key: string) => { onCard(tabKey, key); return null; }),
        }, true)];
    })), [authorTabs, authorFollows, keys, narrow, isPicked, groupBy, noun, onCard]);

    // The kinds' names, by slot: what the Index's search reads beside an item's label and key.
    const kindName = useCallback((slot: string) => kindOf.get(slot)?.name ?? slot, [kindOf]);

    return useMemo((): BuilderFrameDock | undefined => {
        // No tab listed: no pane.
        if (library.length === 0) return undefined;
        const body = (tab: string, attributes: SourceTab<unknown>["pane"], content: ReactNode) => (
            <Box css={styles.libraryPane} data-schematic-library={tab} {...attributes}>{content}</Box>
        );
        const tabs = library.map((tab) => {
            switch (tab.type) {
                case "templates":
                    return {
                        key: "templates", label: m.libraryTab({ tab: "templates" }), count: templatesFollow.count, shown: templates.items.length,
                        body: body("templates", templatesFollow.pane, (
                            <EastChakraLibrary value={templates} storageKey={`${keys.library}.templates`} onCardEnter={enters.get("templates")}
                                empty={templatesFollow.empty === undefined ? undefined : empty("templates", "")}
                                narrowing={narrowingOf(templatesFollow.narrowing, "templates", "", words)} />
                        )),
                    };
                case "backlog": {
                    // Beside a kind read by area, one paged list (#1393, D51), counted `N of M` while an index the narrowing leads narrows it.
                    if (backlogPages !== undefined) {
                        const { source, count } = backlogPages;
                        return {
                            key: "backlog", label: m.libraryTab({ tab: "backlog" }),
                            count: count === undefined ? undefined : narrowedCount(words, count.shown, count.total, count.narrowing), shown: count?.shown ?? 0,
                            body: body("backlog", {}, (
                                <PagedLibrary source={source} id={source.id} item={pagedCard} onOpen={onPagedCard} onEnter={enters.get("backlog")}
                                    empty={empty("backlog", "")} narrowing={backlogNarrowed} />
                            )),
                        };
                    }
                    return {
                        key: "backlog", label: m.libraryTab({ tab: "backlog" }), count: backlogLibrary.items.length, shown: backlogLibrary.items.length,
                        body: body("backlog", {}, (
                            <EastChakraLibrary value={backlogLibrary} storageKey={`${keys.library}.backlog`} onCardEnter={enters.get("backlog")}
                                empty={empty("backlog", "")} narrowing={backlogNarrowed} />
                        )),
                    };
                }
                case "index":
                    return {
                        key: "index", label: m.libraryTab({ tab: "index" }), count: zones.length, shown: zones.length,
                        body: body("index", {}, (
                            <SchematicIndexTab zones={zones} items={items} kindName={kindName} inView={inView} selected={selected} onReveal={onReveal} words={words}
                                area={indexArea} />
                        )),
                    };
                case "layers":
                    return {
                        key: "layers", label: m.libraryTab({ tab: "layers" }), count: layers.length, shown: layers.length,
                        body: body("layers", {}, (
                            <SchematicLayersTab layers={layers} view={layerView} onView={onLayerView} counts={layerCounts} words={words} />
                        )),
                    };
                case "tab": {
                    const tabKey = `tab:${tab.value.name}`;
                    const cards = authorLibraries.get(tabKey)!;
                    const follows = authorFollows.get(tabKey)!;
                    const name = tab.value.name.toLocaleLowerCase(words.locale);
                    return {
                        key: tabKey, label: tab.value.name, count: follows.count, shown: cards.items.length,
                        body: body(tabKey, follows.pane, (
                            <EastChakraLibrary value={cards} storageKey={`${keys.library}.${tabKey}`} onCardEnter={enters.get(tabKey)}
                                empty={follows.empty === undefined ? undefined : empty("tab", tab.value.name)}
                                narrowing={narrowingOf(follows.narrowing, "tab", name, words)} />
                        )),
                    };
                }
            }
        });
        // Collapsed, the rail counts the backlog — or, with no Backlog tab, the first tab's cards.
        const backlogShown = backlogPages === undefined ? backlogLibrary.items.length : backlogPages.count?.shown ?? 0;
        return {
            label: m.libraryPane(), icon: "layer-group", size: LIBRARY_SIZE, persist: "local",
            badge: listsBacklog ? backlogShown : tabs[0]!.shown,
            tabs: tabs.map(({ shown: _shown, ...pane }) => pane),
        };
    }, [library, m, words, styles.libraryPane, templates, templatesFollow, backlogLibrary, backlogNarrowed, backlogPages, pagedCard, onPagedCard, zones, items,
        indexArea, kindName, inView, selected, onReveal, layers, layerView, onLayerView, layerCounts, authorLibraries, authorFollows, keys, empty, listsBacklog,
        enters]);
}

/**
 * The paged Backlog's count (#1393), read where it renders nothing and handed
 * to the frame only as it moves, as the Flows tab's count is: a tracked read
 * in the frame would draw the whole frame again at every settle.
 *
 * @param props - The paged Backlog, the sources of the kinds it reads, and where its count goes
 * @returns Nothing: the count is handed on
 */
export function SchematicBacklogCountReader({ source, parts, onCount }: {
    readonly source: SchematicBacklogPages; readonly parts: readonly string[]; readonly onCount: (count: BacklogPageCount | undefined) => void;
}): null {
    useSlicesReactivity(parts);
    const read = useCallback(() => source.count(), [source]);
    const { result } = useTrackedEvaluation(read);
    const count = result.ok ? result.value : undefined;
    // Handed on by what it counts, so a read that settles the same count draws nothing again.
    const shown = count?.shown, total = count?.total, narrowing = count?.narrowing;
    useEffect(() => {
        onCount(shown === undefined || total === undefined || narrowing === undefined ? undefined : { shown, total, narrowing });
    }, [shown, total, narrowing, onCount]);
    return null;
}
