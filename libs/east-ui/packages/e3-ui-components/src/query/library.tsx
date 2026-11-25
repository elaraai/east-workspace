/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraQueryLibrary` — the renderer of the `QueryLibrary` extension
 * declared in `@elaraai/e3-ui` (#1063, #1761): the query library, a
 * builder-frame component — one toolbar over a grid of cards, and no pane.
 *
 * - **The toolbar**, the frame's one row: the rail over the library's slice —
 *   its fields' chips, its search, its presets and its count — then New query,
 *   which follows it (L11): with one bound data source chosen it reads "New
 *   query on orders" and starts on it; with none or several it opens a menu of
 *   the bound data sources.
 * - **The cards**, main: the saved queries the rail narrows to, in the order
 *   e3 pages them, as the shared paged gallery — as many across as fit, a
 *   window read and a screenful mounted at a time. A card is the Library's
 *   gallery card: a wireframe of the query, its source and a bar per step; its
 *   name, and the mark of the query the host says is open; its description —
 *   the author's, else the sentence generated from its steps; its tags; and a
 *   foot holding what it reads and gives and when it was saved, then Open in
 *   builder. A press on it, or ⏎ or Space with the keyboard on it, asks the
 *   host for its query. One whose data sources aren't bound here says why, in
 *   the warning tone, and asks for nothing.
 *
 * Opening tells the host which query is asked for, in a turn of its own, and
 * does nothing else: the query library opens nothing itself, writes nothing,
 * and shares no store entry with a builder (#1668). It reads no dataset, and
 * never the saved queries whole: a card's query is a row of a page e3 read.
 *
 * Its own parts' styles are the `queryLibrary` recipe's, the grid and a card
 * the `library` recipe's, its button the `button` recipe's and its menu the
 * `menu`'s.
 *
 * @packageDocumentation
 */

import { createContext, memo, useCallback, useContext, useMemo, type KeyboardEvent } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faCaretDown, faPlus, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import {
    StringType, equalFor, equivalentFor, fromEastTypeValue, isValueOf, none, parseFor, printFor, some, variant, type ValueTypeOf, type option,
} from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { QueryLibraryComponent, QueryLibraryPayloadType, SavedQueryType, queryKeys } from "@elaraai/e3-ui/internal";
import { BannerView, BuilderFrame, getSomeorUndefined, implementUIComponent, useTrackedEvaluation, type ToolbarItem } from "@elaraai/east-ui-components";
import {
    PagedGallery, recordSlicePage, recordSliceRevision, useRecordSlicesToolbarItems, useSlotStyles,
    type LibraryPageSource, type PagedLibraryGallery, type SlotStyles,
} from "@elaraai/east-ui-components/internal";
import { sourcePart } from "../shared/schedule/visibility.js";
import { tellHost } from "../shared/open.js";
import { queryAbout, whenWords, type QueryAbout } from "./about.js";
import { sourceKind } from "./datasets-tab.js";
import { useQueryRoot } from "./hooks.js";
import type { QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { newQuery, type QueryOpen } from "./open-query.js";
import type { SavedQuery } from "./session.js";
import { useQueryWords } from "./words.js";

/** The renderer's payload, decoded. */
type QueryLibraryValue = ValueTypeOf<typeof QueryLibraryComponent.schema>;
/** The `rows` source's part of the library's slice. */
type RowsPart = ValueTypeOf<RecordSliceBindType>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(QueryLibraryPayloadType);
const nameEqual = equalFor(StringType);
const readName = parseFor(StringType);
/** A narrowing as text: what tells one narrowing's rows from another's. */
const printWhere = printFor(RecordSliceWhereType);

/** The saved query's field that holds the names of the data sources it reads: what the rail's Data source filter narrows by. */
const SOURCES_FIELD = "sources";
/** How many of a query's steps its wireframe draws before it counts the rest: what a card's media holds. */
const WIRE_STEPS = 4;
/** The narrowest a card stands, and its height, px: the Library's gallery card, its wireframe over its face. */
const CARD_LEAST = 300;
const CARD_PX = 224;

/** What the library's cards read: the root, the words, who to tell, and the query its host says is open. */
interface QueryLibraryFacts {
    readonly root: QueryRoot;
    readonly words: QueryWords;
    readonly styles: SlotStyles;
    /** The `library` recipe's: a card is its gallery card. */
    readonly card: SlotStyles;
    readonly open: option<QueryOpen>;
    readonly onOpen: QueryLibraryValue["onOpen"];
    /** Each bound data source's icon, by its name. */
    readonly icons: ReadonlyMap<string, string>;
}

const QueryLibraryContext = createContext<QueryLibraryFacts | undefined>(undefined);

/** Reads what the library's parts read; a part outside the library is a mistake of its frame's, and throws. */
function useQueryLibrary(): QueryLibraryFacts {
    const facts = useContext(QueryLibraryContext);
    if (facts === undefined) throw new Error("A query library part is drawn outside the query library");
    return facts;
}

/**
 * A query's wireframe: its source, then a bar per step, each its icon and title, the steps past {@link WIRE_STEPS}
 * counted — or, for a query with problems here, their count, dashed, and why.
 */
function QueryWireframe({ about, icon, styles, words }: { about: QueryAbout; icon: string; styles: SlotStyles; words: QueryWords }) {
    const m = words.messages;
    const f = words.formatters;
    if (about.problems > 0) {
        const why = about.refusal ?? about.problem;
        return (
            <Box css={styles.problems} data-query-wireframe="problems">
                <Box as="span" css={styles.problemCount}>{m.problemCount({ count: f.number(about.problems), n: about.problems })}</Box>
                {why !== undefined && <Box as="span" css={styles.problemText}>{why}</Box>}
            </Box>
        );
    }
    const outline = about.steps?.outline ?? [];
    const drawn = outline.length > WIRE_STEPS ? outline.slice(0, WIRE_STEPS - 1) : outline;
    const more = outline.length - drawn.length;
    return (
        <Box css={styles.wireframe} data-query-wireframe="steps">
            <Box css={styles.wireRow} data-wire="source">
                <Box as="span" css={styles.wireIcon} aria-hidden><FontAwesomeIcon icon={["fas", icon as IconName]} /></Box>
                <Box as="span" css={styles.wireTitle}>{about.source}</Box>
            </Box>
            {about.steps === undefined ? (
                <Box css={styles.wireRow} data-wire="jq">
                    <Box as="span" css={styles.wireIcon} aria-hidden><FontAwesomeIcon icon={["fas", "code"]} /></Box>
                    <Box as="span" css={styles.wireTitle}>{m.jqProgram()}</Box>
                </Box>
            ) : drawn.map((line, i) => (
                <Box key={i} css={styles.wireRow} data-wire="step">
                    <Box as="span" css={styles.wireIcon} aria-hidden><FontAwesomeIcon icon={["fas", line.icon as IconName]} /></Box>
                    <Box as="span" css={styles.wireTitle}>{line.title}</Box>
                </Box>
            ))}
            {more > 0 && <Box as="span" css={styles.wireMore}>{m.moreSteps({ count: f.number(more), n: more })}</Box>}
        </Box>
    );
}

/**
 * A saved query's card: the Library's gallery card — a wireframe of the query over its name, and the mark of the one
 * open in the builder; its description, or why it can't open here; its tags; and a foot holding what it reads and
 * gives and when it was saved, then Open in builder. The card is the one target: a press, ⏎ or Space asks the host
 * for its query.
 */
const QueryCard = memo(function QueryCard({ saved }: { saved: SavedQuery }) {
    const { root, styles, card, words, open, onOpen, icons } = useQueryLibrary();
    const m = words.messages;
    const f = words.formatters;
    const about = useMemo(() => queryAbout(saved, root, words), [saved, root, words]);
    const name = saved.name;
    const refused = about.refusal !== undefined;
    const ask = useCallback(() => { if (!refused) tellHost(onOpen, variant("saved", name)); }, [onOpen, name, refused]);
    const onKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        ask();
    }, [ask]);
    const isOpen = open.type === "some" && open.value.type === "saved" && nameEqual(open.value.value, name);
    const steps = about.steps === undefined ? undefined : { count: f.number(about.steps.count), n: about.steps.count };
    const gives = about.gives ?? (about.problems > 0 ? m.problemCount({ count: f.number(about.problems), n: about.problems }) : "");
    const tags = [...saved.tags];
    return (
        <Box css={card.galleryCard} role="button" tabIndex={0} aria-disabled={refused ? true : undefined} aria-current={isOpen ? "true" : undefined}
            data-media="top" data-library-card={name} data-clickable={refused ? undefined : ""} data-placed={isOpen ? "" : undefined} data-open={isOpen ? "" : undefined}
            onClick={ask} onKeyDown={onKey}>
            <Box css={card.galleryMedia} data-library-media="" aria-hidden inert>
                <QueryWireframe about={about} icon={icons.get(about.source) ?? "table-list"} styles={styles} words={words} />
            </Box>
            <Box css={card.galleryFace}>
                <Box css={card.galleryHead}>
                    <Box as="span" css={card.galleryTitle} title={name}>{name}</Box>
                    {isOpen && <Box as="span" css={styles.cardOpen} data-query-library-open="">{m.openNow()}</Box>}
                </Box>
                {about.refusal !== undefined
                    ? <Box as="span" css={styles.cardRefusal} title={about.refusal} data-query-library-refusal="">{about.refusal}</Box>
                    : about.description !== undefined && (
                        <Box as="span" css={card.gallerySublabel} title={about.description} data-query-library-description="">{about.description}</Box>
                    )}
                {tags.length > 0 && (
                    <Box css={styles.cardTags} data-query-library-tags="">
                        {tags.map((tag) => <Box as="span" key={tag} css={styles.cardTag}>{tag}</Box>)}
                    </Box>
                )}
                <Box css={card.galleryFoot} data-library-foot="">
                    <Box css={card.galleryByline}>
                        <Box as="span" css={card.galleryBylineText} data-query-library-byline="">
                            {m.libraryByline({ source: about.source, steps, gives, when: whenWords(saved.saved_at, new Date(), f), run: false })}
                        </Box>
                    </Box>
                    {about.refusal === undefined
                        ? <Box as="span" css={card.galleryAction} data-library-action="" aria-hidden>{m.openInBuilder()}</Box>
                        : (
                            <Box as="span" css={card.glyph} role="img" aria-label={about.refusal} title={about.refusal} data-tone="warning">
                                <FontAwesomeIcon icon={faTriangleExclamation} />
                            </Box>
                        )}
                </Box>
            </Box>
        </Box>
    );
});

/** Props of {@link EastChakraQueryLibrary}. */
export interface EastChakraQueryLibraryProps {
    /** The payload, decoded. */
    value: QueryLibraryValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders the query library — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The query library
 */
export const EastChakraQueryLibrary = memo(function EastChakraQueryLibrary({ value, storageKey }: EastChakraQueryLibraryProps) {
    const words = useQueryWords();
    // The root: each bound data source, by its name.
    const root = useQueryRoot(value.datasets, words);
    if (typeof root === "string") return <BannerView status="error" title={root} />;
    return <QueryLibraryView value={value} root={root} words={words} storageKey={storageKey} />;
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

/**
 * The one data source the rail narrows the cards to, when it narrows to one that is bound here (L11): what New query
 * starts on. `undefined` with none chosen, several, or one this surface does not bind.
 *
 * @param rows - The `rows` source's part of the slice
 * @param root - The bound data sources
 * @returns The data source's name, or `undefined`
 */
function useRailSource(rows: RowsPart | undefined, root: QueryRoot): string | undefined {
    const read = useCallback((): string | undefined => {
        const choice = rows?.read().where.get(SOURCES_FIELD);
        if (choice === undefined || choice.type !== "values" || choice.value.length !== 1) return undefined;
        const name = readName(choice.value[0]!);
        return name.success && root.entries.some((entry) => nameEqual(entry.name, name.value)) ? name.value : undefined;
    }, [rows, root]);
    const { result } = useTrackedEvaluation(read);
    return result.ok ? result.value : undefined;
}

/**
 * The saved queries the rail narrows to, a page at a time: each page the `rows` source's own, under the rail's
 * choices, its entries' rows the queries; its count the narrowing's, from e3; and its revision the record's, so a
 * save in a builder reads the cards again. Every read is a tracked read of the source.
 *
 * @param rows - The `rows` source's part of the slice
 * @returns The page source the gallery reads
 */
function useSavedPages(rows: RowsPart): LibraryPageSource<SavedQuery> {
    return useMemo((): LibraryPageSource<SavedQuery> => ({
        id: rows.key,
        page: (offset, limit) => {
            const entries = recordSlicePage(rows, { where: rows.read().where, area: none }, offset, limit);
            if (entries.type === "none") return none;
            return some(entries.value.flatMap((entry) => {
                const row = (entry as { row?: option<unknown> }).row;
                return row?.type === "some" && isValueOf(row.value, SavedQueryType) ? [row.value as SavedQuery] : [];
            }));
        },
        total: () => rows.count(),
        revision: () => recordSliceRevision(rows),
        query: () => printWhere(rows.read().where),
    }), [rows]);
}

/** New query (L11): on the one data source the rail narrows to, or a menu of the bound data sources. */
function NewQuery({ labelled, source }: { labelled: boolean; source: string | undefined }) {
    const { root, words, styles, onOpen, icons } = useQueryLibrary();
    const m = words.messages;
    const button = useRecipe({ key: "button" });
    const solid = useMemo(() => button({ variant: "solid", size: "sm" }) as SystemStyleObject, [button]);
    const start = useCallback((name: string) => tellHost(onOpen, newQuery(name)), [onOpen]);
    const plus = <Box as="span" css={styles.buttonIcon} aria-hidden><FontAwesomeIcon icon={faPlus} /></Box>;
    if (source !== undefined) {
        const label = m.newQueryOn({ source });
        return (
            <chakra.button type="button" css={solid} colorPalette="brand" data-query-library-new={source}
                {...(labelled ? {} : { "aria-label": label, title: label })} onClick={() => start(source)}>
                {plus}
                {labelled ? label : null}
            </chakra.button>
        );
    }
    const label = m.newQuery();
    return (
        <ChakraMenu.Root positioning={{ placement: "bottom-end" }} onSelect={(picked) => start(picked.value)}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={solid} colorPalette="brand" data-query-library-new="" disabled={root.entries.length === 0}
                    {...(labelled ? {} : { "aria-label": label, title: label })}>
                    {plus}
                    {labelled ? label : null}
                    <Box as="span" css={styles.caret} aria-hidden><FontAwesomeIcon icon={faCaretDown} /></Box>
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content aria-label={m.newQueryMenu()} data-query-library-new-menu="">
                        {root.entries.map((entry) => (
                            <ChakraMenu.Item key={entry.name} value={entry.name}>
                                <Box as="span" css={styles.menuIcon} aria-hidden><FontAwesomeIcon icon={["fas", (icons.get(entry.name) ?? "table-list") as IconName]} /></Box>
                                {entry.name}
                            </ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/** The gallery's cards: each row its card. Stable: the gallery's rows are drawn by it. */
const GALLERY: PagedLibraryGallery<SavedQuery> = { least: CARD_LEAST, cardPx: CARD_PX, card: (saved: SavedQuery) => <QueryCard saved={saved} /> };

/** The cards over their page source: the shared paged gallery, saying so where the rail's choices leave none. */
function QueryCards({ rows, id, words }: { rows: RowsPart; id: string; words: QueryWords }) {
    const m = words.messages;
    const source = useSavedPages(rows);
    // Whether a choice of the viewer's narrows the cards: what an empty grid says, and whether it offers Clear filters.
    const readNarrowed = useCallback(() => rows.read().where.size > 0, [rows]);
    const { result } = useTrackedEvaluation(readNarrowed);
    const narrowed = result.ok && result.value;
    const clear = useCallback(() => { rows.clearAll(); }, [rows]);
    const empty = useMemo(() => ({ title: m.noQueries(), description: m.saveInBuilder() }), [m]);
    const narrowing = useMemo(() => (narrowed ? { empty: { title: m.noQueriesMatch(), description: m.changeFilters() }, onClear: clear, emptied: true } : undefined), [narrowed, m, clear]);
    return <PagedGallery source={source} id={id} gallery={GALLERY} empty={empty} narrowing={narrowing} />;
}

/** The library over its root: the frame's one toolbar — the rail, then New query — over the cards. */
function QueryLibraryView({ value, root, words, storageKey }: { value: QueryLibraryValue; root: QueryRoot; words: QueryWords; storageKey: string }) {
    const m = words.messages;
    const styles = useSlotStyles("queryLibrary");
    const card = useSlotStyles("library");
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => queryKeys(id), [id]);
    const onOpen = value.onOpen;
    const chrome = value.slice;
    const rows = useMemo(() => sourcePart(chrome, "rows"), [chrome]);
    const icons = useMemo(() => new Map(root.entries.map((entry) => [entry.name, sourceKind(fromEastTypeValue(entry.type)).icon])), [root]);
    const facts = useMemo((): QueryLibraryFacts => ({ root, words, styles, card, open: value.query, onOpen, icons }), [root, words, styles, card, value.query, onOpen, icons]);

    // The rail, counted in the library's noun, then New query, which follows it.
    const nouns = useMemo(() => ({ rows: m.savedNoun({ n: 2 }) }), [m]);
    const affordances = useMemo(() => chrome.affordances.map((affordance) => affordance.type), [chrome]);
    const rail = useRecordSlicesToolbarItems(chrome.slice, {
        nouns, affordances, ...(chrome.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    const railSource = useRailSource(rows, root);
    const toolbar = useMemo((): ReadonlyArray<ToolbarItem> => [...rail, {
        key: "query-library-new", side: "end",
        forms: [<NewQuery key="full" labelled source={railSource} />, <NewQuery key="compact" labelled={false} source={railSource} />],
    }], [rail, railSource]);

    return (
        <QueryLibraryContext.Provider value={facts}>
            <BuilderFrame storageKey={`${storageKey}.${keys.library}.frame`} label={m.tab({ tab: "library" })} toolbar={toolbar}>
                {rows !== undefined && <QueryCards rows={rows} id={keys.library} words={words} />}
            </BuilderFrame>
        </QueryLibraryContext.Provider>
    );
}

implementUIComponent(QueryLibraryComponent, EastChakraQueryLibrary);
