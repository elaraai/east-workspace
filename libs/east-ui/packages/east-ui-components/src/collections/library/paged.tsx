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
 * @packageDocumentation
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Skeleton, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { type option, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType, RecordSliceFieldType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { BannerView } from "../../feedback/banner/index.js";
import { useFormatters } from "../../format/index.js";
import { Toolbar } from "../../toolbar/index.js";
import { SEARCH_DELAY_MS } from "../../slice/record/index.js";
import { VirtualRows } from "../virtual-rows.js";
import { planWindows } from "../paged-window-store.js";
import {
    LibraryCard, LibraryEmptyState, LibrarySearchBox, librarySearchItem, useLibrarySearchShortcut,
    type LibraryEmpty, type LibraryItemValue, type LibraryNarrowing, type LibrarySearchSize,
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
const EMPTY_DIMS: string[] = [];
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

/** Props of {@link PagedRows}. */
interface PagedRowsProps<T> extends PagedLibraryProps<T> {
    /** The narrowing its rows are of — its source, the rail's narrowing and the tab's own search's text — as one. */
    identity: string;
    /** The tab's own search's text, as it reads; empty, none. */
    query: string;
    /** The `library` recipe's styles. */
    styles: Styles;
    /** Clears the tab's search: its footer's Show all. */
    onShowAll: () => void;
}

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
function PagedRows<T>({ identity, source, id, item, onOpen, onEnter, empty, narrowing, search, noMatch, query, styles, onShowAll }: PagedRowsProps<T>) {
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
                total = search.part.countWhere(within);
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
    const onRangeChange = useCallback((next: { startIndex: number; endIndex: number }, scrolling: boolean) => {
        if (scrolling) return;
        setViewed(old => old.identity === shownIdentity && old.start === next.startIndex && old.end === next.endIndex + 1
            ? old : { identity: shownIdentity, start: next.startIndex, end: next.endIndex + 1 });
    }, [shownIdentity]);
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
                <VirtualRows key={shownIdentity} height={undefined} maxHeight={undefined} fillParent count={count ?? 8} estimateSize={estimateSize}
                    onRangeChange={onRangeChange} rootProps={retained}
                    renderRow={index => {
                        const row = rows.get(index);
                        const card = row === undefined ? undefined : item(row);
                        return <Box css={styles.pagedRow} data-library-position={index}>
                            {card === undefined ? <Skeleton css={styles.pagedSkeleton} aria-label="Loading record" /> :
                                <LibraryCard libraryId={id} item={card} dimOrder={EMPTY_DIMS} activeDims={EMPTY_DIMS}
                                    filtered={card.filtered} styles={styles} onCardClick={onOpen} onCardEnter={onEnter} />
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
