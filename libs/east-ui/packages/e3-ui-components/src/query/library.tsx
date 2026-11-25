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
import { Box, chakra, Menu as ChakraMenu, Portal, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faCaretDown, faPlus } from "@fortawesome/free-solid-svg-icons";
import {
    StringType, equalFor, equivalentFor, fromEastTypeValue, isValueOf, none, parseFor, printFor, some, variant, type ValueTypeOf, type option,
} from "@elaraai/east";
import { RecordSliceWhereType, recordSliceChosen, type RecordSliceBindType, type RecordSliceEntry } from "@elaraai/east-ui/internal";
import { QueryLibraryComponent, QueryLibraryPayloadType, SavedQueryType, queryKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, getSomeorUndefined, implementUIComponent, useTrackedEvaluation, type LibraryItemValue, type ToolbarItem,
} from "@elaraai/east-ui-components";
import {
    PagedGallery, recordSlicePage, recordSliceRevision, useRecordSlicesToolbarItems, useSlotStyles,
    type LibraryPageSource, type PagedLibraryGallery, type SlotStyles,
} from "@elaraai/east-ui-components/internal";
import { useEquivalent } from "../shared/equivalent.js";
import { entryRow } from "../shared/records/entry-row.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { tellHost } from "../shared/open.js";
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
/** The `rows` source's part of the library's slice. */
type RowsPart = ValueTypeOf<RecordSliceBindType>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(QueryLibraryPayloadType);
/**
 * Who the host tells, and the slice's chrome, by the same equivalence: each kept while a new payload's is equivalent
 * (`useEquivalent`), so a press — which moves the open query alone — makes neither again, nor the cards, the rail and
 * the reads over them.
 */
const onOpenEquivalent = equivalentFor(QueryLibraryPayloadType.fields.onOpen);
const sliceEquivalent = equivalentFor(QueryLibraryPayloadType.fields.slice);
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
/** The secondary fact a card shows: its query's tags, as chips. */
const TAGS = "tags";
const CARD_DIMS = [TAGS] as const;

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
    const tags = [...saved.tags];
    return {
        key: saved.name, label: saved.name,
        sublabel: about.refusal !== undefined || about.description === undefined ? none : some(about.description),
        icon: none,
        status: open ? some({ label: m.openNow(), tone: variant("info", null), ring: false }) : none,
        trailing: refusalGlyph(about),
        draggable: false, filtered: false, placed: open, media: none, avatar: none,
        byline: some(m.libraryByline({ source: about.source, steps, gives, when: whenWords(saved.saved_at, new Date(), f), run: false })),
        action: about.refusal === undefined ? some(m.openInBuilder()) : none,
        search: none, groups: new Map(), facets: new Map(),
        dims: new Map(tags.length === 0 ? [] : [[TAGS, variant("chips", tags)]]),
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
 * choices, its entries' rows the queries — the row each joined, or the one its index carries (`entryRow`); its count
 * the narrowing's, from e3; and its revision the record's, so a save in a builder reads the cards again. Every read is
 * a tracked read of the source.
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
            return some((entries.value as RecordSliceEntry[]).flatMap((entry) => {
                const row = entryRow(entry);
                return isValueOf(row, SavedQueryType) ? [row as SavedQuery] : [];
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

/** The wireframe a card's media is: its query's, on the library's recipe. */
const CardWireframe = memo(function CardWireframe({ about }: { about: QueryAbout }) {
    const { styles, words, icons } = useQueryLibrary();
    return <QueryWireframe about={about} icon={icons.get(about.source) ?? "table-list"} styles={styles} words={words} />;
});

/**
 * The gallery's cards: each saved query the Library's gallery card ({@link queryItem}), its media the query's
 * wireframe. A press on one tells the host its query, in a turn of its own; one that can't open here takes none, and
 * says why in the warning tone. What the library says of a query is worked out once a row, and kept as the open query
 * moves: a press marks another card, and works out none again.
 *
 * @param root - The bound data sources
 * @param words - The words
 * @param open - The query its host says is open
 * @param onOpen - Who to tell
 * @returns The gallery the paged gallery draws
 */
function useQueryGallery(root: QueryRoot, words: QueryWords, open: option<QueryOpen>, onOpen: QueryLibraryValue["onOpen"]): PagedLibraryGallery<SavedQuery> {
    const aboutOf = useMemo(() => {
        const abouts = new WeakMap<SavedQuery, QueryAbout>();
        return (saved: SavedQuery): QueryAbout => {
            const held = abouts.get(saved);
            if (held !== undefined) return held;
            const about = queryAbout(saved, root, words);
            abouts.set(saved, about);
            return about;
        };
    }, [root, words]);
    return useMemo((): PagedLibraryGallery<SavedQuery> => {
        const isOpen = (saved: SavedQuery) => open.type === "some" && open.value.type === "saved" && nameEqual(open.value.value, saved.name);
        return {
            least: CARD_LEAST,
            cardPx: CARD_PX,
            dims: CARD_DIMS,
            item: (saved) => queryItem(saved, aboutOf(saved), isOpen(saved), words),
            media: (saved) => <CardWireframe about={aboutOf(saved)} />,
            extras: (saved) => {
                const refusal = aboutOf(saved).refusal;
                return refusal === undefined ? undefined : { title: refusal, note: { text: refusal, tone: "warning" } };
            },
            clicks: (saved) => aboutOf(saved).refusal === undefined,
            onOpen: (name) => tellHost(onOpen, variant("saved", name)),
        };
    }, [aboutOf, words, open, onOpen]);
}

/** The cards over their page source: the shared paged gallery, saying so where the rail's choices leave none. */
function QueryCards({ rows, id, words, gallery }: { rows: RowsPart; id: string; words: QueryWords; gallery: PagedLibraryGallery<SavedQuery> }) {
    const m = words.messages;
    const source = useSavedPages(rows);
    // Whether a choice of the viewer's narrows the cards — never the page's scope, which Clear filters keeps: what an
    // empty grid says, and whether it offers Clear filters.
    const readNarrowed = useCallback(() => recordSliceChosen(rows), [rows]);
    const { result } = useTrackedEvaluation(readNarrowed);
    const narrowed = result.ok && result.value;
    const clear = useCallback(() => { rows.clearAll(); }, [rows]);
    const empty = useMemo(() => ({ title: m.noQueries(), description: m.saveInBuilder() }), [m]);
    const narrowing = useMemo(() => (narrowed ? { empty: { title: m.noQueriesMatch(), description: m.changeFilters() }, onClear: clear, emptied: true } : undefined), [narrowed, m, clear]);
    return <PagedGallery source={source} id={id} gallery={gallery} empty={empty} narrowing={narrowing} />;
}

/** The library over its root: the frame's one toolbar — the rail, then New query — over the cards. */
function QueryLibraryView({ value, root, words, storageKey }: { value: QueryLibraryValue; root: QueryRoot; words: QueryWords; storageKey: string }) {
    const m = words.messages;
    const styles = useSlotStyles("queryLibrary");
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => queryKeys(id), [id]);
    // Who to tell, and the slice: each the payload's last one while a new payload's is equivalent — the same function, the
    // same captures — so a press, which moves the open query alone, makes neither again.
    const onOpen = useEquivalent(value.onOpen, onOpenEquivalent);
    const chrome = useEquivalent(value.slice, sliceEquivalent);
    const rows = useMemo(() => sourcePart(chrome, "rows"), [chrome]);
    const icons = useMemo(() => new Map(root.entries.map((entry) => [entry.name, sourceKind(fromEastTypeValue(entry.type)).icon])), [root]);
    const facts = useMemo((): QueryLibraryFacts => ({ root, words, styles, onOpen, icons }), [root, words, styles, onOpen, icons]);
    const gallery = useQueryGallery(root, words, value.query, onOpen);

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
                {rows !== undefined && <QueryCards rows={rows} id={keys.library} words={words} gallery={gallery} />}
            </BuilderFrame>
        </QueryLibraryContext.Provider>
    );
}

implementUIComponent(QueryLibraryComponent, EastChakraQueryLibrary);
