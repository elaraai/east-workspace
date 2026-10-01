/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraQueryLibrary` — the renderer of the `QueryLibrary` extension
 * declared in `@elaraai/e3-ui` (#1063): the query library, built in the
 * browser from its interface — the saved queries record bound with its patch,
 * the data sources a query may read, the builder it opens queries in, and who
 * to tell — as Studio's page library is built from its own
 * (`Query Editor Spec.md` §5):
 *
 * - **One toolbar row**, the shared `Toolbar`: the search, "Search N
 *   queries…", over names, descriptions and data sources; Sort · Recent or
 *   Name; Grid · List; a rule; and the primary "+ New query on <data source>" —
 *   the one the pane shows, else the first bound — folded on one ladder.
 * - **The pane**: Data sources — All queries, then each bound data source with
 *   the count of saved queries that start from it — the one shown in the
 *   brand; at its foot, Recent: this viewer's runs, the builder's (#935).
 * - **The gallery**: one `Library` gallery, three across or a row each, which
 *   draws no toolbar of its own. Each card's media is a wireframe of the
 *   query — its source, then a bar per step with its icon and title — or, for
 *   a query with problems here, their count in a dashed box; then its name,
 *   its description (the author's, else the generated sentence), "{source} ·
 *   {n} steps · {what it gives} · saved {when}", and "Open in builder →". A
 *   saved query's card drags onto the builder that shares the id (#939).
 * - **Opening**: a card's click writes the builder's open query, shared by
 *   `id`, with the notice it arrives with, and tells the host — a saved query
 *   as itself, a recent run of one as the saved query, a run never saved as a
 *   new query begun as it. A query whose data sources aren't bound here
 *   carries the reason in the warning tone, and its click says so in a notice
 *   instead of opening.
 * - **Empty**: no queries yet, no recent runs, or none matching the search —
 *   each with what to do.
 *
 * The data source shown, the search, the order and the layout are its own.
 * It reads no dataset — a card draws a query, never its data — and draws no
 * border around itself. Its layout is the `queryLibrary` recipe's; its
 * controls are the theme's shared ones — the Library's search box, the
 * `button` recipe, the `seg` strip and the menu.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useId, useMemo, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library as iconLibrary, type IconName } from "@fortawesome/fontawesome-svg-core";
import {
    fas, faArrowDownAZ, faCaretDown, faCheck, faClockRotateLeft, faMagnifyingGlass, faPlus, faXmark, type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import {
    DateTimeType, StringType, compareFor, equalFor, equivalentFor, fromEastTypeValue, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { QueryLibraryComponent, QueryLibraryPayloadType, SavedQueryType, queryKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, EastChakraLibrary, EmptyStateView, LibraryLayoutSwitch, Toolbar, implementUIComponent, useTrackedEvaluation,
    type LibraryItemValue, type LibraryValue, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { queryAbout, whenWords, type QueryAbout } from "./about.js";
import { sourceKind } from "./datasets-tab.js";
import { useQueryRoot, useRecentQueries } from "./hooks.js";
import type { QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { newQuery, useOpenQuery, type QueryOpen } from "./open-query.js";
import type { SavedQueries, SavedQuery } from "./session.js";
import { useQueryWords } from "./words.js";

// A step's icon is a Font Awesome name; register the free-solid set so it resolves by name (idempotent).
iconLibrary.add(fas);

/** A recipe's styles, by slot. */
type Styles = Record<string, SystemStyleObject>;
/** The renderer's payload, decoded. */
type QueryLibraryValue = ValueTypeOf<typeof QueryLibraryComponent.schema>;
/** How the cards are ordered: the most recently saved — or run — first, or by name. */
type Sort = "recent" | "name";
/** How the gallery lays its cards out. */
type Layout = "grid" | "list";
/** What the pane shows: every saved query, those that start from a data source, or this viewer's recent runs. */
type Shown = { readonly kind: "all" } | { readonly kind: "source"; readonly name: string } | { readonly kind: "recent" };

/** A card of the gallery. */
interface Card {
    /** Its key: a saved query's name, or `recent:<n>` for a run. */
    readonly key: string;
    /** The saved query, or the run. */
    readonly query: SavedQuery;
    /** What it is here. */
    readonly about: QueryAbout;
    /** Whether it is one of this viewer's recent runs. */
    readonly run: boolean;
    /** For a run of a saved query, the saved query it opens as. */
    readonly opens: SavedQuery | undefined;
    /** Why it can't open here — a run of a saved query, the saved query's reason; `undefined` when it can. */
    readonly refusal: string | undefined;
}

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(QueryLibraryPayloadType);
const nameEqual = equalFor(StringType);
const runEqual = equalFor(SavedQueryType);
const byName = compareFor(StringType);
const byTime = compareFor(DateTimeType);

/** The toolbar's fold ranks: the primary action drops its data source, Sort
 *  folds to its icon, the primary action to its plus, and last the search
 *  narrows twice. The layout switch never folds. */
const RANK = { newQuery: 0, sort: 1, newQueryIcon: 2, searchMid: 3, searchNarrow: 4 } as const;

/** The orders Sort offers, in its menu's order, with the icon it folds to. */
const SORTS: ReadonlyArray<{ key: Sort; icon: IconDefinition }> = [
    { key: "recent", icon: faClockRotateLeft },
    { key: "name", icon: faArrowDownAZ },
];

/** How many of a query's steps its wireframe draws before it counts the rest. */
const WIRE_STEPS = 4;

/** Props of {@link EastChakraQueryLibrary}. */
export interface EastChakraQueryLibraryProps {
    /** The payload, decoded. */
    value: QueryLibraryValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Sort · Recent or Name, opening a menu of the two orders — folded, the
 * trigger is the order's icon, the words its name and tooltip.
 */
function SortMenu({ sort, onPick, compact, trigger, caret, check, words }: {
    sort: Sort;
    onPick: (sort: Sort) => void;
    compact: boolean;
    trigger: SystemStyleObject;
    caret: SystemStyleObject;
    check: SystemStyleObject;
    words: QueryWords;
}) {
    const m = words.messages;
    const current = SORTS.find((s) => s.key === sort) ?? SORTS[0]!;
    const label = m.librarySort({ sort });
    return (
        <ChakraMenu.Root positioning={{ placement: "bottom-end" }}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={trigger} data-query-library-sort=""
                    {...(compact ? { "aria-label": label, title: label } : {})}>
                    {compact ? <FontAwesomeIcon icon={current.icon} /> : (
                        <>
                            {label}
                            <Box as="span" css={caret} aria-hidden><FontAwesomeIcon icon={faCaretDown} /></Box>
                        </>
                    )}
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        <ChakraMenu.RadioItemGroup value={sort} onValueChange={(d) => {
                            const picked = SORTS.find((s) => s.key === d.value);
                            if (picked !== undefined && picked.key !== sort) onPick(picked.key);
                        }}>
                            {SORTS.map((s) => (
                                <ChakraMenu.RadioItem key={s.key} value={s.key}>
                                    <Box as="span" css={check}>{s.key === sort && <FontAwesomeIcon icon={faCheck} />}</Box>
                                    {m.librarySortOption({ sort: s.key })}
                                </ChakraMenu.RadioItem>
                            ))}
                        </ChakraMenu.RadioItemGroup>
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/**
 * A row of the pane: its label, its count at the right, and Recent's icon;
 * the one shown in the brand.
 */
function PaneRow({ label, count, active, icon, at, styles, onPick }: {
    label: string;
    count: string;
    active: boolean;
    icon: IconDefinition | undefined;
    at: string;
    styles: Styles;
    onPick: () => void;
}) {
    return (
        <chakra.button type="button" css={styles.paneRow} data-query-library-shows={at}
            {...(active ? { "data-active": "", "aria-current": "true" } : {})}
            onClick={onPick}>
            {icon !== undefined && <Box as="span" css={styles.paneIcon} aria-hidden><FontAwesomeIcon icon={icon} /></Box>}
            <Box as="span" css={styles.paneTitle}>{label}</Box>
            <Box as="span" css={styles.paneCount}>{count}</Box>
        </chakra.button>
    );
}

/**
 * A card's media: the query's wireframe — its source, then a bar per step,
 * each its icon and title, the steps past {@link WIRE_STEPS} counted — or, for
 * a query with problems here, their count, dashed, and why.
 */
function QueryWireframe({ about, icon, styles, words }: { about: QueryAbout; icon: string; styles: Styles; words: QueryWords }) {
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
 * Renders the query library — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The query library
 */
export const EastChakraQueryLibrary = memo(function EastChakraQueryLibrary({ value, storageKey }: EastChakraQueryLibraryProps) {
    const words = useQueryWords();
    const m = words.messages;

    // The record, read where the query library renders, and again when it moves.
    const read = useCallback(() => value.queries.read(), [value.queries]);
    const { result } = useTrackedEvaluation(read);
    // The root: each bound data source, by its name.
    const root = useQueryRoot(value.datasets, words);

    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        return <BannerView status="error" title={m.savedUnreadable({ message })} />;
    }
    if (typeof root === "string") return <BannerView status="error" title={root} />;
    return <QueryLibraryView value={value} record={result.value} root={root} words={words} storageKey={storageKey} />;
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link QueryLibraryView}. */
interface QueryLibraryViewProps {
    /** The payload: the builder's id, and who to tell. */
    readonly value: QueryLibraryValue;
    /** The saved queries. */
    readonly record: SavedQueries;
    /** The root. */
    readonly root: QueryRoot;
    /** The words. */
    readonly words: QueryWords;
    /** The structural storage key. */
    readonly storageKey: string;
}

/** The query library over the record it read: the toolbar, the pane and the gallery. */
function QueryLibraryView({ value, record, root, words, storageKey }: QueryLibraryViewProps) {
    const styles = useSlotRecipe({ key: "queryLibrary" })() as Styles;
    const library = useSlotRecipe({ key: "library" })() as Styles;
    const button = useRecipe({ key: "button" });
    const m = words.messages;
    const f = words.formatters;
    const id = useId();
    const builder = value.id.type === "some" ? value.id.value : undefined;
    const keys = useMemo(() => queryKeys(builder), [builder]);
    const tellHost = value.onOpen.type === "some" ? value.onOpen.value : undefined;

    // This viewer's recent runs, the builder's; and the builder's open query —
    // a new query on the first data source until one opens.
    const { recent } = useRecentQueries(keys.recent);
    const firstSource = root.entries[0]?.name ?? "";
    const first = useMemo((): QueryOpen => variant("new", { id: "first", source: firstSource, from: none }), [firstSource]);
    const [open, writeOpen] = useOpenQuery(keys.query, first);

    // Its own view: what the pane shows, the search, the order and the layout; and a notice.
    const [shown, setShown] = useState<Shown>({ kind: "all" });
    const [text, setText] = useState("");
    const [sort, setSort] = useState<Sort>("recent");
    const [layout, setLayout] = useState<Layout>("grid");
    const [notice, setNotice] = useState<string | undefined>(undefined);
    const show = useCallback((next: Shown) => {
        setShown(next);
        setNotice(undefined);
    }, []);

    // What each saved query and each run is here: read once per record, run list and root.
    const saved = useMemo(() => [...record.values()].map((query) => ({ query, about: queryAbout(query, root, words) })), [record, root, words]);
    const runs = useMemo(() => recent.map((query) => ({ query, about: queryAbout(query, root, words) })), [recent, root, words]);
    // How many saved queries start from each data source.
    const counts = useMemo(() => {
        const out = new Map<string, number>();
        for (const { about } of saved) out.set(about.source, (out.get(about.source) ?? 0) + 1);
        return out;
    }, [saved]);

    // The cards the pane shows: the saved queries — all, or those that start
    // from a data source — or the recent runs, each a run of a saved query
    // opening as it.
    const cards = useMemo((): Card[] => {
        if (shown.kind === "recent") {
            return runs.map(({ query, about }, i) => {
                const opens = saved.find((s) => nameEqual(s.query.name, query.name));
                return { key: `recent:${i}`, query, about, run: true, opens: opens?.query, refusal: (opens?.about ?? about).refusal };
            });
        }
        return saved
            .filter((s) => shown.kind === "all" || nameEqual(s.about.source, shown.name))
            .map(({ query, about }) => ({ key: query.name, query, about, run: false, opens: undefined, refusal: about.refusal }));
    }, [shown, runs, saved]);

    // The search narrows them by name, description and data source; Sort orders them.
    const needle = text.trim().toLowerCase();
    const rows = useMemo(() => {
        const matching = needle === "" ? cards
            : cards.filter((c) => [c.query.name, c.about.description ?? "", c.about.source].join(" ").toLowerCase().includes(needle));
        return [...matching].sort(sort === "name"
            ? (a, b) => byName(a.query.name, b.query.name)
            : (a, b) => byTime(b.query.saved_at, a.query.saved_at) || byName(a.query.name, b.query.name));
    }, [cards, needle, sort]);
    const byKey = useMemo(() => new Map(rows.map((c) => [c.key, c])), [rows]);

    // The query the builder has open is placed: a saved query by its name; a run never saved by itself, whenever it ran.
    const isOpenSaved = useCallback((name: string) => open.type === "saved" && nameEqual(open.value, name), [open]);
    const isOpenRun = useCallback((run: SavedQuery) => open.type === "new" && open.value.from.type === "some"
        && runEqual({ ...open.value.from.value, saved_at: run.saved_at }, run), [open]);

    // A card opens its query in the builder, with its notice, and tells the host.
    const onOpenCard = useCallback((key: string) => {
        const card = byKey.get(key);
        if (card === undefined) return;
        if (card.refusal !== undefined) {
            setNotice(card.refusal);
            return;
        }
        setNotice(undefined);
        const name = card.query.name;
        const target = card.run ? card.opens : card.query;
        writeOpen(target !== undefined ? variant("saved", target.name) : newQuery(card.about.source, card.query), m.openedFromQueryLibrary({ name }));
        if (tellHost !== undefined) queueMicrotask(() => tellHost(name));
    }, [byKey, writeOpen, tellHost, m]);

    // "+ New query on …": the data source the pane shows, else the first bound.
    const startOn = shown.kind === "source" ? shown.name : firstSource;
    const onNew = useCallback(() => {
        if (startOn === "") return;
        setNotice(undefined);
        writeOpen(newQuery(startOn), m.startedOn({ name: startOn }));
        const name = m.untitled({ source: startOn });
        if (tellHost !== undefined) queueMicrotask(() => tellHost(name));
    }, [startOn, writeOpen, tellHost, m]);

    // Each card: its name, its description, what it reads and gives, and its action; the reason it can't open, in the warning tone.
    const items = useMemo(() => {
        const now = new Date();
        return rows.map((card): LibraryItemValue => {
            const { query, about, refusal } = card;
            const steps = about.steps === undefined ? undefined : { count: f.number(about.steps.count), n: about.steps.count };
            const gives = about.gives ?? (about.problems > 0 ? m.problemCount({ count: f.number(about.problems), n: about.problems }) : "");
            return {
                key: card.key,
                label: query.name,
                sublabel: about.description === undefined ? none : some(about.description),
                icon: none,
                status: none,
                trailing: refusal === undefined ? none : some({ icon: "triangle-exclamation", label: refusal, tone: some(variant("warning", null)) }),
                // A saved query's card drags onto the builder, which opens it by name.
                draggable: !card.run,
                filtered: false,
                placed: card.run ? (card.opens !== undefined ? isOpenSaved(card.opens.name) : isOpenRun(query)) : isOpenSaved(query.name),
                media: none,
                avatar: none,
                byline: some(m.libraryByline({ source: about.source, steps, gives, when: whenWords(query.saved_at, now, f), run: card.run })),
                action: refusal === undefined ? some(m.openInBuilder()) : none,
                search: none,
                groups: new Map(),
                facets: new Map(),
                dims: new Map(),
            };
        });
    }, [rows, isOpenSaved, isOpenRun, m, f]);

    // Each card's media: the query's wireframe, its source's icon at its head.
    const icons = useMemo(() => new Map(root.entries.map((e) => [e.name, sourceKind(fromEastTypeValue(e.type)).icon])), [root]);
    const media = useCallback((item: LibraryItemValue): ReactNode => {
        const card = byKey.get(item.key);
        return card === undefined ? null
            : <QueryWireframe about={card.about} icon={icons.get(card.about.source) ?? "table-list"} styles={styles} words={words} />;
    }, [byKey, icons, styles, words]);
    const gallery = useMemo((): LibraryValue => ({
        id: keys.library,
        hint: none,
        items,
        groupOptions: [],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: false,
        noun: none,
        addLabel: none,
        onAdd: none,
        onCardClick: some((key: string) => { onOpenCard(key); return null; }),
        slice: none,
        style: some({ height: none, maxHeight: none, virtualization: none, columns: some(3n), mediaPlacement: none, mediaSize: none }),
        variant: some(variant("gallery", null)),
        layout: some(layout === "list" ? variant("list", null) : variant("grid", null)),
        toolbar: false,
    }), [keys, items, onOpenCard, layout]);

    // Nothing to show: none match the search, no recent runs, or no saved queries here.
    const total = saved.length;
    const empty = rows.length > 0 ? undefined
        : needle !== "" ? { title: m.noMatch({ text: text.trim() }), hints: [m.checkSpelling(), shown.kind === "all" ? m.searchWhat() : m.clearFilter()] }
            : shown.kind === "recent" ? { title: m.noRecent(), hints: [m.runInBuilder()] }
                : { title: m.noQueries(), hints: [m.saveInBuilder()] };

    // The search box at a width the toolbar folds it to — one element in
    // every form, so the field keeps its focus and its text as the row folds.
    const searchBox = (size: "wide" | "mid" | "narrow") => (
        <Box css={library.searchBox} data-size={size}>
            <Box as="span" css={library.searchIcon} aria-hidden>
                <FontAwesomeIcon icon={faMagnifyingGlass} />
            </Box>
            <chakra.input
                css={library.searchInput}
                placeholder={m.librarySearch({ count: f.number(total), n: total })}
                aria-label={m.librarySearchLabel()}
                value={text}
                data-query-library-search=""
                onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Escape" && text !== "") {
                        e.preventDefault();
                        setText("");
                    }
                }}
            />
            {text !== "" && (
                <chakra.button type="button" css={library.searchClear} aria-label={m.clearSearch()} onClick={() => setText("")}>
                    <FontAwesomeIcon icon={faXmark} />
                </chakra.button>
            )}
        </Box>
    );
    const sortMenu = (compact: boolean) => (
        <SortMenu sort={sort} compact={compact} trigger={button({ variant: "outline", size: "sm" }) as SystemStyleObject}
            caret={styles.caret!} check={library.menuCheck!} onPick={setSort} words={words} />
    );
    // The primary action, in each of its forms.
    const newButton = (form: "full" | "short" | "icon"): ReactNode => (
        <chakra.button type="button" css={button({ variant: "solid", size: "sm" })} colorPalette="brand" data-query-library-new=""
            disabled={startOn === ""}
            {...(form !== "full" ? { title: m.newQueryOn({ source: startOn }) } : {})}
            {...(form === "icon" ? { "aria-label": m.newQueryOn({ source: startOn }) } : {})}
            onClick={onNew}>
            <Box as="span" css={styles.buttonIcon} aria-hidden><FontAwesomeIcon icon={faPlus} /></Box>
            {form === "full" ? m.newQueryOn({ source: startOn }) : form === "short" ? m.newQuery() : null}
        </chakra.button>
    );
    const toolbarItems: ReadonlyArray<ToolbarItem> = [
        {
            key: "search",
            forms: [searchBox("wide"), searchBox("mid"), searchBox("narrow")],
            rank: [RANK.searchMid, RANK.searchNarrow],
        },
        { key: "sort", side: "end", forms: [sortMenu(false), sortMenu(true)], rank: RANK.sort, version: sort },
        {
            key: "layout",
            side: "end",
            forms: [<LibraryLayoutSwitch layout={layout} onPick={setLayout} />],
        },
        { key: "rule", side: "end", forms: [<Box as="span" css={styles.divider} aria-hidden />] },
        {
            key: "new",
            side: "end",
            forms: [newButton("full"), newButton("short"), newButton("icon")],
            rank: [RANK.newQuery, RANK.newQueryIcon],
            version: startOn,
        },
    ];

    return (
        <Box css={styles.root} data-query-library="">
            <Box css={styles.toolbar} data-slot="toolbar">
                <Toolbar items={toolbarItems} />
            </Box>
            <Box css={styles.body}>
                <Box css={styles.pane} data-query-library-pane="">
                    <Box css={styles.paneSection} role="group" aria-labelledby={`${id}-sources`}>
                        <Box css={styles.paneHead}>
                            <Box as="span" id={`${id}-sources`} css={styles.paneCaption}>{m.dataSources()}</Box>
                        </Box>
                        <PaneRow label={m.allQueries()} count={f.number(total)} active={shown.kind === "all"} icon={undefined} at="all"
                            styles={styles} onPick={() => show({ kind: "all" })} />
                        {root.entries.map((entry) => (
                            <PaneRow key={entry.name} label={entry.name} count={f.number(counts.get(entry.name) ?? 0)}
                                active={shown.kind === "source" && nameEqual(shown.name, entry.name)} icon={undefined} at={`source:${entry.name}`}
                                styles={styles} onPick={() => show({ kind: "source", name: entry.name })} />
                        ))}
                    </Box>
                    <Box css={styles.paneFoot}>
                        <PaneRow label={m.recentGroup()} count={f.number(recent.length)} active={shown.kind === "recent"} icon={faClockRotateLeft}
                            at="recent" styles={styles} onPick={() => show({ kind: "recent" })} />
                    </Box>
                </Box>
                <Box css={styles.main} data-query-library-main="">
                    {notice !== undefined && (
                        <Box css={styles.notice} data-query-library-notice="">
                            <BannerView status="warning" title={notice} dismissible onDismiss={() => setNotice(undefined)} />
                        </Box>
                    )}
                    {empty !== undefined ? (
                        <Box css={styles.empty} data-query-library-empty="">
                            <EmptyStateView glyph="∅" title={empty.title} description={
                                <Box as="ul" css={styles.emptyList}>
                                    {empty.hints.map((hint) => <li key={hint}>{hint}</li>)}
                                </Box>
                            } />
                        </Box>
                    ) : (
                        <Box css={styles.gallery}>
                            <EastChakraLibrary value={gallery} storageKey={`${storageKey}.gallery`} renderMedia={media} />
                        </Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

implementUIComponent(QueryLibraryComponent, EastChakraQueryLibrary);
