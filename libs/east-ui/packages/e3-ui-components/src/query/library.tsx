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
 *   gallery card, drawn by the Library ({@link queryItem}): a wireframe of the
 *   query, its source and a bar per step; its name, and Open on the one the
 *   host says is open; its description — the author's, else the sentence
 *   generated from its steps; its tags; and a foot holding what it reads and
 *   gives and when it was saved, then Open in builder. A press on it, or ⏎ or
 *   Space with the keyboard on it, asks the host for its query. One whose data
 *   sources aren't bound here says why, in the warning tone, and is no button.
 *
 * Opening tells the host which query is asked for, in a turn of its own, and
 * does nothing else: the query library opens nothing itself, writes nothing,
 * and shares no store entry with a builder (#1668). It reads no dataset, and
 * never the saved queries whole: a card's query is a row of a page e3 read.
 *
 * Its wireframe's and New query's styles are the `queryLibrary` recipe's, the
 * grid and a card the `library` recipe's, its button the `button` recipe's and
 * its menu the `menu`'s.
 *
 * @packageDocumentation
 */

import { createContext, memo, useCallback, useContext, useMemo } from "react";
import { Box, Menu as ChakraMenu, Portal } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { StringType, equalFor, equivalentFor, fromEastTypeValue, isValueOf, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { QueryLibraryComponent, QueryLibraryPayloadType, SavedQueryType, queryKeys } from "@elaraai/e3-ui/internal";
import { BannerView, BuilderFrame, getSomeorUndefined, implementUIComponent, type LibraryItemValue, type ToolbarItem } from "@elaraai/east-ui-components";
import { useSlotStyles, type PagedLibraryGallery, type SlotStyles } from "@elaraai/east-ui-components/internal";
import { sourcePart } from "../shared/schedule/visibility.js";
import { tellHost } from "../shared/open.js";
import { LibraryNewButton, SliceGallery, libraryCardMarks, libraryGallery, useLibraryRail, useRailValue } from "../shared/slice-gallery.js";
import { queryAbout, refusalGlyph, whenWords, type QueryAbout } from "./about.js";
import { sourceKind } from "./datasets-tab.js";
import { useQueryRoot } from "./hooks.js";
import type { QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { newQuery, type QueryOpen } from "./open-query.js";
import type { SavedQuery } from "./session.js";
import { useQueryWords } from "./words.js";

/** The renderer's payload, decoded. */
type QueryLibraryValue = ValueTypeOf<typeof QueryLibraryComponent.schema>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(QueryLibraryPayloadType);
const nameEqual = equalFor(StringType);

/** The saved query's field that holds the names of the data sources it reads: what the rail's Data source filter narrows by. */
const SOURCES_FIELD = "sources";
/** How many of a query's steps its wireframe draws before it counts the rest: what a card's media holds. */
const WIRE_STEPS = 4;

/** What the library's parts read: the root, the words, and who to tell. */
interface QueryLibraryFacts {
    readonly root: QueryRoot;
    readonly words: QueryWords;
    readonly styles: SlotStyles;
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
 * A saved query's card, as the Library's gallery card draws it: its name, and Open while it is the one its host says
 * is open, which is then the card marked; its description, or — where it can't open here — why, as its note; its tags;
 * and a foot holding what it reads and gives and when it was saved, then Open in builder, or a warning's glyph.
 *
 * @param saved - The saved query
 * @param about - What the library says of it
 * @param open - Whether it is the query its host says is open
 * @param words - The words
 * @returns The card
 */
function queryItem(saved: SavedQuery, about: QueryAbout, open: boolean, words: QueryWords): LibraryItemValue {
    const m = words.messages;
    const f = words.formatters;
    const steps = about.steps === undefined ? undefined : { count: f.number(about.steps.count), n: about.steps.count };
    const gives = about.gives ?? (about.problems > 0 ? m.problemCount({ count: f.number(about.problems), n: about.problems }) : "");
    return {
        key: saved.name, label: saved.name,
        sublabel: about.refusal !== undefined || about.description === undefined ? none : some(about.description),
        icon: none,
        trailing: refusalGlyph(about),
        draggable: false, filtered: false, media: none, avatar: none,
        byline: some(m.libraryByline({ source: about.source, steps, gives, when: whenWords(saved.saved_at, new Date(), f), run: false })),
        action: about.refusal === undefined ? some(m.openInBuilder()) : none,
        search: none, groups: new Map(), facets: new Map(),
        ...libraryCardMarks(open, m.openNow(), saved.tags),
    };
}

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
 * A page's row, as the saved queries' source reads it: the saved query its entry joins, checked of its type.
 *
 * @param entry - An entry of a page of the `rows` source
 * @returns The saved query; `undefined` for an entry that joins none
 */
function savedRow(entry: unknown): SavedQuery | undefined {
    const row = (entry as { row?: option<unknown> }).row;
    return row?.type === "some" && isValueOf(row.value, SavedQueryType) ? row.value as SavedQuery : undefined;
}

/** New query (L11): on the one data source the rail narrows to, or a menu of the bound data sources. */
function NewQuery({ labelled, source }: { labelled: boolean; source: string | undefined }) {
    const { root, words, styles, onOpen, icons } = useQueryLibrary();
    const m = words.messages;
    const start = useCallback((name: string) => tellHost(onOpen, newQuery(name)), [onOpen]);
    if (source !== undefined) {
        return <LibraryNewButton label={m.newQueryOn({ source })} labelled={labelled} data-query-library-new={source} onClick={() => start(source)} />;
    }
    return (
        <ChakraMenu.Root positioning={{ placement: "bottom-end" }} onSelect={(picked) => start(picked.value)}>
            <ChakraMenu.Trigger asChild>
                <LibraryNewButton label={m.newQuery()} labelled={labelled} caret data-query-library-new="" disabled={root.entries.length === 0} />
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

/** The wireframe a card's media is: its query's, on the library's recipe. */
const CardWireframe = memo(function CardWireframe({ about }: { about: QueryAbout }) {
    const { styles, words, icons } = useQueryLibrary();
    return <QueryWireframe about={about} icon={icons.get(about.source) ?? "table-list"} styles={styles} words={words} />;
});

/**
 * The gallery's cards: each saved query the Library's gallery card ({@link queryItem}), its media the query's
 * wireframe. A press on one tells the host its query, in a turn of its own; one that can't open here takes none, and
 * says why in the warning tone. What the library says of a query is worked out once a row.
 *
 * @param root - The bound data sources
 * @param words - The words
 * @param open - The query its host says is open
 * @param onOpen - Who to tell
 * @returns The gallery the paged gallery draws
 */
function useQueryGallery(root: QueryRoot, words: QueryWords, open: option<QueryOpen>, onOpen: QueryLibraryValue["onOpen"]): PagedLibraryGallery<SavedQuery> {
    return useMemo((): PagedLibraryGallery<SavedQuery> => {
        const abouts = new WeakMap<SavedQuery, QueryAbout>();
        const aboutOf = (saved: SavedQuery): QueryAbout => {
            const held = abouts.get(saved);
            if (held !== undefined) return held;
            const about = queryAbout(saved, root, words);
            abouts.set(saved, about);
            return about;
        };
        const isOpen = (saved: SavedQuery) => open.type === "some" && open.value.type === "saved" && nameEqual(open.value.value, saved.name);
        return libraryGallery({
            item: (saved) => queryItem(saved, aboutOf(saved), isOpen(saved), words),
            media: (saved) => <CardWireframe about={aboutOf(saved)} />,
            extras: (saved) => {
                const refusal = aboutOf(saved).refusal;
                return refusal === undefined ? undefined : { title: refusal, note: { text: refusal, tone: "warning" } };
            },
            clicks: (saved) => aboutOf(saved).refusal === undefined,
            onOpen: (name) => tellHost(onOpen, variant("saved", name)),
        });
    }, [root, words, open, onOpen]);
}

/** The library over its root: the frame's one toolbar — the rail, then New query — over the cards. */
function QueryLibraryView({ value, root, words, storageKey }: { value: QueryLibraryValue; root: QueryRoot; words: QueryWords; storageKey: string }) {
    const m = words.messages;
    const styles = useSlotStyles("queryLibrary");
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => queryKeys(id), [id]);
    const onOpen = value.onOpen;
    const chrome = value.slice;
    const rows = useMemo(() => sourcePart(chrome, "rows"), [chrome]);
    const icons = useMemo(() => new Map(root.entries.map((entry) => [entry.name, sourceKind(fromEastTypeValue(entry.type)).icon])), [root]);
    const facts = useMemo((): QueryLibraryFacts => ({ root, words, styles, onOpen, icons }), [root, words, styles, onOpen, icons]);
    const gallery = useQueryGallery(root, words, value.query, onOpen);

    // The rail, counted in the library's noun, then New query, which follows it.
    const nouns = useMemo(() => ({ rows: m.savedNoun({ n: 2 }) }), [m]);
    const rail = useLibraryRail(chrome, nouns);
    // New query starts on the one data source the rail narrows the cards to, where it is bound here (L11).
    const chosen = useRailValue(rows, SOURCES_FIELD);
    const railSource = chosen !== undefined && root.entries.some((entry) => nameEqual(entry.name, chosen)) ? chosen : undefined;
    const empty = useMemo(() => ({ title: m.noQueries(), description: m.saveInBuilder() }), [m]);
    const narrowed = useMemo(() => ({ title: m.noQueriesMatch(), description: m.changeFilters() }), [m]);
    const toolbar = useMemo((): ReadonlyArray<ToolbarItem> => [...rail, {
        key: "query-library-new", side: "end",
        forms: [<NewQuery key="full" labelled source={railSource} />, <NewQuery key="compact" labelled={false} source={railSource} />],
    }], [rail, railSource]);

    return (
        <QueryLibraryContext.Provider value={facts}>
            <BuilderFrame storageKey={`${storageKey}.${keys.library}.frame`} label={m.tab({ tab: "library" })} toolbar={toolbar}>
                {rows !== undefined && <SliceGallery part={rows} id={keys.library} gallery={gallery} decode={savedRow} empty={empty} narrowed={narrowed} />}
            </BuilderFrame>
        </QueryLibraryContext.Provider>
    );
}

implementUIComponent(QueryLibraryComponent, EastChakraQueryLibrary);
