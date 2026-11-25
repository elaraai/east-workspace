/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bounded, virtual palette over a server-paged collection; cards remain
 * Library cards. With no row it says so in the Library's empty state (#1341).
 *
 * Given its source's part of a builder's rail (`search`, #1340, ruling 11), it
 * draws the Library's search box, which finds within the tab alone: the
 * palette lists what the rail narrows its record to, and its search reads the
 * record under a narrowing of the tab's own — the rail's choices, and the text
 * a prefix of a field the source lists in `search` (`paged-search.ts`) —
 * through the part's `pageWhere` and `countWhere`. Its text is the tab's own
 * state: it never writes the rail, so the rail, the builder's board and every
 * count stay as the rail has them, and the tab's footer says how many its
 * search hides, with Show all. A search the rail's choices block says which,
 * with the rail's Clear filters.
 *
 * A new narrowing — the rail's, or the tab's own search's — never blinks
 * (#1398, CL8; #1424): the rows that last landed stand in, retained —
 * aria-disabled in a busy region, readable and taking no gesture that edits —
 * until the new narrowing's count and its first rows land, and are swapped
 * whole then, its view starting again at its start; a new revision's rows, or a
 * new count's at the same revision — its host's drafts moving its rows — stand
 * in the same way, the view kept. A read again of the rows it showed — the same
 * narrowing, revision and count, its windows let go meanwhile — keeps them
 * until they land again. Only the first read, and rows scrolled into view, draw
 * the pending rows.
 *
 * {@link PagedGallery} (east-workspace#1761) is the same reads drawn as a
 * gallery: the Library's gallery cards in a responsive grid — as many columns
 * as fit at the cards' least width, one at least, each line of the grid one
 * virtual row — so a gallery over ten thousand rows reads and mounts a
 * screenful, as the list does.
 *
 * @packageDocumentation
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Skeleton, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { none, type option, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType, RecordSliceFieldType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { BannerView } from "../../feedback/banner/index.js";
import { useContainerColumns } from "../../contracts/adaptive.js";
import { useFormatters } from "../../format/index.js";
import { Toolbar } from "../../toolbar/index.js";
import { SEARCH_DELAY_MS } from "../../slice/record/index.js";
import { VirtualRows } from "../virtual-rows.js";
import { planWindows } from "../paged-window-store.js";
import {
    LibraryCard, LibraryEmptyState, LibraryGalleryCard, LibrarySearchBox, librarySearchItem, useLibrarySearchShortcut,
    type LibraryCardExtras, type LibraryEmpty, type LibraryItemValue, type LibraryNarrowing, type LibrarySearchSize,
} from "./index.js";
import { pagedSearchFields, pagedSearchTarget, pagedSearchWhere } from "./paged-search.js";

type Styles = Record<string, SystemStyleObject>;
type Where = ValueTypeOf<RecordSliceWhereType>;
type Field = ValueTypeOf<RecordSliceFieldType>;

/** The reads a paged palette needs; its provider owns requests and its bounded cache. */
export interface LibraryPageSource<T> {
    readonly id: string;
    page(offset: bigint, limit: bigint): option<T[]>;
    total(): option<bigint>;
    revision(): option<string>;
    /**
     * The narrowing its rows belong to, for a source a builder's rail narrows (a live source, #1354): its `id` stays
     * the same under every narrowing, so the palette starts its viewport again when this moves, as it does for a new
     * source.
     */
    query?(): string;
}

/**
 * A paged palette's own search (#1340, ruling 11): its source's part of the
 * builder's rail, and a page of what a narrowing of the tab's own holds.
 *
 * @typeParam T - The palette's rows
 */
export interface PagedLibrarySearch<T> {
    /**
     * The source's part of the rail: its choices, which the search reads
     * within; its fields, its indexes and its `search`, which say what the
     * search may read; and the exact count of a narrowing of the tab's own
     * (`countWhere`), which never changes the rail.
     */
    readonly part: ValueTypeOf<RecordSliceBindType>;
    /** A page of what a narrowing holds, as the palette's rows: the part's `pageWhere`, its entries the palette's. */
    readonly page: (where: Where, offset: bigint, limit: bigint) => option<T[]>;
}

/**
 * A paged palette as a gallery (east-workspace#1761): the Library's gallery cards in a responsive grid, in place of
 * its compact cards a row each — the query library's. A card is the Library's own, so its press, its keys and its
 * looks are the ones every gallery has.
 *
 * @typeParam T - The palette's rows
 */
export interface PagedLibraryGallery<T> {
    /** The narrowest a card stands, px: the grid holds as many columns as fit at it, and one at least. */
    readonly least: number;
    /** A card's height, px: every card of the gallery stands as tall. */
    readonly cardPx: number;
    /** A row's card: its name, its meta line, its status, its secondary facts, its byline and its action or glyph; `placed`, it is the one its host marks. */
    item(row: T): LibraryItemValue;
    /** Draws a card's media, as React: its host's thumbnail of the row. With none, a card has no media. */
    media?: ((row: T) => ReactNode) | undefined;
    /** What its host draws on a card beside its shared face: its tooltip, and a note in a tone. */
    extras?: ((row: T) => LibraryCardExtras | undefined) | undefined;
    /** Which rows' cards take a press: those it answers `true` for, and every one where it is not given. A card that takes none is no button. */
    clicks?: ((row: T) => boolean) | undefined;
    /** A press on a card, or ⏎ or Space with the keyboard on it: told the card's key. */
    onOpen(key: string): void;
    /** The secondary facts its cards show, by their keys in a card's `dims`, in their order; none where it is not given. */
    dims?: readonly string[] | undefined;
}

/** @internal A paged palette reuses Library's card, empty state, search box and theme. */
export interface PagedLibraryProps<T> {
    source: LibraryPageSource<T>;
    id: string;
    /** A row's card: `filtered`, it draws faded as context and never drags, as a resident Library's filtered card does. */
    item(row: T): LibraryItemValue;
    onOpen(key: string): void;
    /** ⏎ on a card, by its key: what a card that drops does at once — the Schematic's backlog row placed (#1390, SC13). */
    onEnter?: ((key: string) => void) | undefined;
    /** What it says while its source holds no row, in its host's words (`No flows`). */
    empty?: LibraryEmpty | undefined;
    /**
     * While its host's narrowing — a builder's rail — pages its source (#1341):
     * what it says when that leaves no row, and the Clear filters it offers.
     */
    narrowing?: LibraryNarrowing | undefined;
    /**
     * Its search box (#1340, ruling 11): its source's part of the rail, and a
     * page of what a narrowing of the tab's own holds. Without it, or with no
     * String field its source lists in `search`, it draws none.
     */
    search?: PagedLibrarySearch<T> | undefined;
    /** What its search box counts its rows as (`flow`, `flows`); with none, `item`, `items`. */
    noun?: { readonly singular: string; readonly plural: string } | undefined;
    /** What it says while its search finds no row, in its host's words, in place of `No matches`. */
    noMatch?: LibraryEmpty | undefined;
}

/** What it says with no row, and neither words of its host's. */
const NO_ROWS: LibraryEmpty = { title: "No matches", description: "Change or clear the filters to see more records." };

/**
 * How many rows a paged palette reads a page: its source's `page(offset, limit)` is asked a window of this many at a
 * time, its first `page(0, PAGED_LIBRARY_PAGE)` — what a host whose figures must swap with the palette's rows waits on
 * (the Calendar's Backlog count, #1424).
 */
export const PAGED_LIBRARY_PAGE = 32;
/** The rows a narrowing reads first: from its start. */
const FIRST_ROWS = { start: 0, end: 12 } as const;
const estimateSize = () => 56;
const EMPTY_DIMS: readonly string[] = [];
/** Retained content (#1398, CL8): what stands in while a new narrowing is read — aria-disabled in a busy region. */
const RETAINED = { "aria-busy": true, "aria-disabled": true } as const;

/** Labels as running text lists them: `Lane`, `Lane and Owner`, `Lane, Owner and State count`. */
function listed(labels: readonly string[]): string {
    return labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Render only the visible rows and request their adjacent windows. Changing
 * query identity — the rail's, or the tab's own search's — starts the
 * viewport again, the rows that last landed standing in, retained, until the
 * new narrowing's first rows land; a revision replaces all its reads. With no
 * row it says so in the Library's empty state: its host's narrowing's words and
 * Clear filters while one narrows it, else its host's words; a search that
 * finds no row, `No matches`; a search the rail's choices block, which, with
 * Clear filters.
 * @param props - The paged source, card projection, opening action, what it says with no row, and its search
 * @returns A virtualized palette with the standard Library cards, under its search box when it has one
 * @internal
 */
export function PagedLibrary<T>(props: PagedLibraryProps<T>) {
    const { source, id, search, noun } = props;
    const styles = useSlotRecipe({ key: "library" })() as Styles;
    const words = useFormatters();
    const fields = useMemo(() => (search === undefined ? [] : pagedSearchFields(search.part.config)), [search]);
    const searchable = fields.length > 0;
    // The tab's own search: its text, and — a pause after the last keystroke — the text it reads. A text
    // cleared reads at once. It is never the rail's state.
    const [text, setText] = useState("");
    const [query, setQuery] = useState("");
    useEffect(() => {
        if (text === "") return;
        const timer = setTimeout(() => setQuery(text), SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [text]);
    const onQuery = useCallback((next: string) => {
        setText(next);
        if (next === "") setQuery("");
    }, []);
    // The box says how many rows the rail shows, and the field it searches by under the rail's choices; and the
    // narrowing the rows belong to, which starts the viewport again when it moves (#1354).
    const readBox = useCallback(() => {
        const total = source.total();
        const target = search === undefined || !searchable ? undefined : pagedSearchTarget(search.part.config, search.part.read().where);
        return { total: total.type === "some" ? Number(total.value) : undefined, field: target?.field, narrowed: source.query?.() ?? "" };
    }, [source, search, searchable]);
    const { result: boxRead } = useTrackedEvaluation(readBox);
    const { searchRef, claim } = useLibrarySearchShortcut(searchable);
    const known = boxRead.ok ? boxRead.value : undefined;
    const field: Field | undefined = known?.field ?? fields[0];
    const by = field === undefined ? "" : ` by ${field.label.toLocaleLowerCase(words.locale)}`;
    const plural = noun?.plural ?? "items";
    const counted = known?.total === undefined ? plural : `${words.number(known.total)} ${known.total === 1 ? (noun?.singular ?? "item") : plural}`;
    const box = (size: LibrarySearchSize) => (
        <LibrarySearchBox size={size} inputRef={searchRef} query={text} onQuery={onQuery} placeholder={`Search ${counted}${by}…`} label={`Search ${plural}${by}`} />
    );
    return (
        <Box css={[styles.root, styles.pagedRoot]} data-library={id} data-library-paged="" data-scrollable=""
            onPointerEnter={claim} onFocus={claim}>
            {searchable && (
                <Box css={styles.toolbar} data-slot="toolbar">
                    <Toolbar items={[librarySearchItem(box)]} />
                </Box>
            )}
            <PagedRows {...props} identity={`${source.id}|${known?.narrowed ?? ""}|${query}`} query={query} styles={styles} onShowAll={() => onQuery("")} />
        </Box>
    );
}

/**
 * The gap between a gallery's cards, px, and the margins it keeps beside them, its two sides together: 20 each side of
 * its root — at the end, its lines' padding less the gutter its scrollbar keeps there, whatever that gutter is on the
 * platform (`pagedGalleryRow`), so the cards stand 20 in from each side on every one (east-workspace#1772).
 */
const GALLERY_GAP = 12;
const GALLERY_MARGINS = 20 + 20;

/** @internal A paged gallery's props: its source, its cards, and what it says with no row. */
export interface PagedGalleryProps<T> {
    source: LibraryPageSource<T>;
    id: string;
    /** Its cards: its host's own, and the grid they stand in. */
    gallery: PagedLibraryGallery<T>;
    /** What it says while its source holds no row, in its host's words (`No queries yet`). */
    empty?: LibraryEmpty | undefined;
    /** While its host's narrowing — a builder's rail — pages its source: what it says when that leaves no row, and the Clear filters it offers. */
    narrowing?: LibraryNarrowing | undefined;
}

/**
 * A paged palette as a gallery (east-workspace#1761): {@link PagedLibrary}'s reads — a window at a time, the rows in
 * view and their neighbours, the rows that last landed standing in while a new narrowing's are read — drawn as the
 * Library's gallery cards in a responsive grid, each with its media over its face. It has no search of its own: its
 * host's rail narrows it.
 * @param props - The paged source, the cards and their grid, and what it says with no row
 * @returns A virtualized gallery of the host's cards
 * @internal
 */
export function PagedGallery<T>({ source, id, gallery, empty, narrowing }: PagedGalleryProps<T>) {
    const styles = useSlotRecipe({ key: "library" })() as Styles;
    // The narrowing its rows belong to, which starts the viewport again when it moves (#1354).
    const readNarrowed = useCallback(() => source.query?.() ?? "", [source]);
    const { result } = useTrackedEvaluation(readNarrowed);
    // Its columns: as many as fit its root at its cards' least width between its margins, one at least. The root stands
    // through every narrowing, and while it holds no row, where its lines' list is drawn again (east-workspace#1772).
    const rootRef = useRef<HTMLDivElement | null>(null);
    const across = useContainerColumns(rootRef, gallery.least, GALLERY_GAP, GALLERY_MARGINS);
    return (
        <Box ref={rootRef} css={[styles.root, styles.pagedRoot]} data-library={id} data-library-paged="" data-library-gallery="" data-media="top" data-scrollable="">
            <PagedRows source={source} id={id} gallery={gallery} across={across} empty={empty} narrowing={narrowing}
                identity={`${source.id}|${result.ok ? result.value : ""}|`} query="" styles={styles} onShowAll={noShowAll} />
        </Box>
    );
}

/** A gallery has no search of its own, so nothing to show all of. */
const noShowAll = (): void => {};
/** A card of a palette given no `onOpen`: a gallery's, whose cards take its own. */
const noOpen = (): void => {};

/**
 * A gallery's card over its row: the Library's gallery card, its item, its media and what its host draws beside it
 * made once a row, so a card is drawn again only as its row or its gallery changes.
 */
function PagedGalleryCard<T>({ row, gallery, id, styles }: { row: T; gallery: PagedLibraryGallery<T>; id: string; styles: Styles }) {
    const item = useMemo(() => gallery.item(row), [gallery, row]);
    const extras = useMemo(() => gallery.extras?.(row), [gallery, row]);
    const media = gallery.media;
    const renderMedia = useMemo(() => (media === undefined ? undefined : () => media(row)), [media, row]);
    const dims = gallery.dims ?? EMPTY_DIMS;
    const takes = gallery.clicks?.(row) ?? true;
    return <LibraryGalleryCard libraryId={id} item={item} dimOrder={dims} activeDims={dims} filtered={item.filtered} styles={styles}
        onCardClick={takes ? gallery.onOpen : undefined} onCardEnter={undefined} storageKey={id} renderMedia={renderMedia} extras={extras} />;
}

/** Props of {@link PagedRows}: a palette's, its cards the Library's compact ones or — with a `gallery` — its host's own. */
type PagedRowsProps<T> = Omit<PagedLibraryProps<T>, "item" | "onOpen"> & Partial<Pick<PagedLibraryProps<T>, "item" | "onOpen">> & {
    /** A gallery's cards and grid; `undefined` for the Library's compact cards, a row each. */
    gallery?: PagedLibraryGallery<T> | undefined;
    /** How many cards a gallery's line holds: as many as fit its root ({@link PagedGallery}); a list's, one. */
    across?: number | undefined;
    /** The narrowing its rows are of — its source, the rail's narrowing and the tab's own search's text — as one. */
    identity: string;
    /** The tab's own search's text, as it reads; empty, none. */
    query: string;
    /** The `library` recipe's styles. */
    styles: Styles;
    /** Clears the tab's search: its footer's Show all. */
    onShowAll: () => void;
};

/** One read of a palette's rows: its count, its rows by place, and what its search read. */
interface RowsRead<T> {
    /** How many rows it holds; `undefined` while it is counted. */
    readonly count: number | undefined;
    /** The rows read, by place. */
    readonly rows: ReadonlyMap<number, T>;
    /** What the tab shows without its search: what the footer counts the search's hidden rows against. */
    readonly shown: number | undefined;
    /** Whether its search read it. */
    readonly searching: boolean;
    /** The rail's choices that block its search. */
    readonly blocking: readonly Field[] | undefined;
    /** The fields its search may read. */
    readonly fields: readonly Field[];
    /** Its search's text. */
    readonly query: string;
    /** The revision it read at; `undefined` before one is known. */
    readonly revision: string | undefined;
}

/** Whether a read has landed: its count known, and every row of the range it reads that the count holds read. */
function landedAt<T>(read: RowsRead<T>, range: { readonly start: number; readonly end: number }): boolean {
    if (read.count === undefined) return false;
    const end = Math.min(range.end, read.count);
    for (let at = range.start; at < end; at++) if (!read.rows.has(at)) return false;
    return true;
}

/**
 * The palette's rows: the source as the rail narrows it, or what the tab's own search finds within it. A new narrowing
 * reads from its start, the read that last landed standing in, retained, until its count and its first rows land; a
 * new revision of the same narrowing, or a new count at the same revision, keeps its view, the last read standing in
 * until the rows in view land at it.
 */
function PagedRows<T>({ identity, source, id, item, onOpen, onEnter, gallery, across = 1, empty, narrowing, search, noMatch, query, styles, onShowAll }: PagedRowsProps<T>) {
    const words = useFormatters();
    // The rows in view and the narrowing they are of: a new narrowing reads from its start.
    const [viewed, setViewed] = useState<{ readonly identity: string; readonly start: number; readonly end: number }>({ identity, ...FIRST_ROWS });
    const range = viewed.identity === identity ? viewed : FIRST_ROWS;
    const { start, end } = range;
    const read = useCallback((): RowsRead<T> => {
        const revision = source.revision();
        const at = revision.type === "some" ? revision.value : undefined;
        let total = source.total();
        let page = (offset: bigint, limit: bigint) => source.page(offset, limit);
        // What the tab shows without its search: what the footer counts the search's hidden rows against.
        let shown: number | undefined;
        let blocking: readonly Field[] | undefined;
        let fields: readonly Field[] = [];
        const searching = search !== undefined && query !== "";
        if (searching) {
            shown = total.type === "some" ? Number(total.value) : undefined;
            const where = search.part.read().where;
            const target = pagedSearchTarget(search.part.config, where);
            fields = pagedSearchFields(search.part.config);
            if (target?.blocking !== undefined) return { count: 0, rows: new Map<number, T>(), shown, searching, blocking: target.blocking, fields, query, revision: at };
            if (target?.field !== undefined) {
                const within = pagedSearchWhere(target.field, where, query);
                if (within === null) return { count: 0, rows: new Map<number, T>(), shown, searching, blocking, fields, query, revision: at };
                // The tab's own narrowing, never a read by area (#1432).
                total = search.part.countWhere({ where: within, area: none });
                page = (offset, limit) => search.page(within, offset, limit);
            }
        }
        const count = total.type === "some" ? Number(total.value) : undefined;
        const rows = new Map<number, T>();
        if (revision.type === "some" && count !== 0) {
            for (const window of planWindows({ start, end }, PAGED_LIBRARY_PAGE, count).needed) {
                const offset = window * PAGED_LIBRARY_PAGE;
                const got = page(BigInt(offset), BigInt(PAGED_LIBRARY_PAGE));
                if (got.type === "some") got.value.forEach((row, i) => rows.set(offset + i, row));
            }
        }
        return { count, rows, shown, searching, blocking, fields, query, revision: at };
    }, [source, start, end, search, query]);
    const { result } = useTrackedEvaluation(read);
    // The read that last landed, and the narrowing it is of: while a new narrowing's count and first rows are read — or a
    // new revision's of the rows in view, or a new count's at the same revision, its host's drafts moving its rows — it
    // stands in, retained (#1398, CL8), and is swapped whole once they land, never the pending rows again. Rows scrolled
    // into view at the same revision and count are read as pending rows, the rest kept live.
    const landed = useRef<{ readonly identity: string; readonly read: RowsRead<T> } | undefined>(undefined);
    if (result.ok && landedAt(result.value, range)) landed.current = { identity, read: result.value };
    const last = landed.current;
    const standing = result.ok && last !== undefined && (last.identity !== identity || last.read.revision !== result.value.revision
        || (result.value.count !== undefined && result.value.count !== last.read.count));
    // The narrowing the rows shown are of: its view is its own, so the swap starts the new one's at its start.
    const shownIdentity = standing ? last.identity : identity;
    // The rows in view: a gallery's lines hold `across` of them each.
    const onRangeChange = useCallback((next: { startIndex: number; endIndex: number }, scrolling: boolean) => {
        if (scrolling) return;
        const from = next.startIndex * across, to = (next.endIndex + 1) * across;
        setViewed(old => old.identity === shownIdentity && old.start === from && old.end === to ? old : { identity: shownIdentity, start: from, end: to });
    }, [shownIdentity, across]);
    const estimate = useCallback(() => (gallery === undefined ? estimateSize() : gallery.cardPx + GALLERY_GAP), [gallery]);
    if (!result.ok) return <BannerView status="error" title={result.error instanceof Error ? result.error.message : "The list could not be read"} />;
    // A read again of the rows it showed — the same narrowing, revision and count, or its count not read yet, its windows
    // let go meanwhile — keeps what landed of them until they land again: the same rows at the same places, never the
    // pending rows over them; rows scrolled into view still read as pending rows.
    const now = result.value;
    const again = !standing && last !== undefined && last.read !== now;
    const { count, rows, shown, searching, blocking, fields, query: searched } = standing ? last.read
        : again ? { ...now, count: now.count ?? last.read.count, rows: new Map([...last.read.rows, ...now.rows]) } : now;
    // A search the rail's choices block says which; one that finds nothing says so; else the rail's words, or the host's.
    const said: LibraryEmpty = blocking !== undefined
        ? { title: "No search with these filters", description: `Clear the filters on ${listed(blocking.map((f) => f.label))} to search by ${listed(fields.map((f) => f.label))}.` }
        : searching ? noMatch ?? { title: "No matches", description: `Nothing matches "${searched}".` }
            : narrowing?.empty ?? empty ?? NO_ROWS;
    const onClear = blocking !== undefined || !searching ? narrowing?.onClear : undefined;
    // What the search hides of what the rail shows; a search the rail blocks has read nothing, and hides nothing.
    const hidden = searching && blocking === undefined && shown !== undefined && count !== undefined && shown > count ? shown - count : 0;
    const retained = standing ? RETAINED : undefined;
    return (
        <>
            {count === 0 ? (retained === undefined ? <LibraryEmptyState said={said} onClear={onClear} />
                : <Box {...retained}><LibraryEmptyState said={said} onClear={onClear} /></Box>) : (
                <VirtualRows key={shownIdentity} height={undefined} maxHeight={undefined} fillParent count={Math.ceil((count ?? 8) / across)} estimateSize={estimate}
                    onRangeChange={onRangeChange} rootProps={retained}
                    header={gallery === undefined ? undefined : <Box css={styles.pagedGalleryHead} />}
                    renderRow={index => {
                        if (gallery !== undefined) {
                            // One line of the grid: its cards, each at its place, a pending row a skeleton of a card's size.
                            const places = Array.from({ length: across }, (_, column) => index * across + column).filter(at => count === undefined || at < count);
                            return <Box css={styles.pagedGalleryRow} style={{ gridTemplateColumns: `repeat(${across}, minmax(0, 1fr))`, height: `${gallery.cardPx + GALLERY_GAP}px` }}
                                data-library-position={index} data-library-across={across}>
                                {places.map(at => {
                                    const row = rows.get(at);
                                    return <Box key={at} css={styles.pagedGalleryCell} data-library-place={at}>
                                        {row === undefined ? <Skeleton css={styles.pagedGallerySkeleton} aria-label="Loading record" />
                                            : <PagedGalleryCard row={row} gallery={gallery} id={id} styles={styles} />}
                                    </Box>;
                                })}
                            </Box>;
                        }
                        const row = rows.get(index);
                        const card = row === undefined ? undefined : item?.(row);
                        return <Box css={styles.pagedRow} data-library-position={index}>
                            {card === undefined ? <Skeleton css={styles.pagedSkeleton} aria-label="Loading record" /> :
                                <LibraryCard libraryId={id} item={card} dimOrder={EMPTY_DIMS} activeDims={EMPTY_DIMS}
                                    filtered={card.filtered} styles={styles} onCardClick={onOpen ?? noOpen} onCardEnter={onEnter} />
                            }
                        </Box>;
                    }} />
            )}
            {hidden > 0 && (
                <Box css={styles.footer} data-library-search-hidden="">
                    <Box as="span" css={styles.hiddenNote}>
                        {words.number(hidden)} hidden by filter ·{" "}
                        <Box as="button" css={styles.showAll} onClick={onShowAll}>Show all</Box>
                    </Box>
                </Box>
            )}
        </>
    );
}
