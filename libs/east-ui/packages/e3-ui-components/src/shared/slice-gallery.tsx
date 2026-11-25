/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a library of cards over its slice is made of (#1761, #1762) — the
 * query library's saved queries, the page library's pages and templates, each
 * one toolbar over a grid of cards:
 *
 * - **The cards**: the shared paged gallery over a source of the slice, read a
 *   page at a time under the rail's choices and again as the record moves;
 *   with no row its host's words, and while the rail narrows the source, the
 *   narrowing's, with Clear filters ({@link SliceGallery}). A card stands at
 *   the gallery's one size, its tags its one fact ({@link libraryGallery}), and
 *   the row its host says is open is marked ({@link libraryCardMarks}).
 * - **The toolbar**: the rail over the slice ({@link useLibraryRail}), and New,
 *   the brand's solid button ({@link LibraryNewButton}), which follows the one
 *   value the rail has chosen of a field ({@link useRailValue}, L11, L12).
 *
 * @packageDocumentation
 */

import { forwardRef, useCallback, useMemo, type ComponentPropsWithoutRef } from "react";
import { Box, chakra, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faPlus } from "@fortawesome/free-solid-svg-icons";
import { StringType, none, parseFor, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, recordSliceChosen, type RecordSliceBindType, type RecordSliceEntry, type RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type LibraryEmpty, type LibraryItemValue, type LibraryNarrowing, type ToolbarItem } from "@elaraai/east-ui-components";
import {
    PagedGallery, recordSlicePage, recordSliceRevision, useRecordSlicesToolbarItems, useSlotStyles, type LibraryPageSource, type PagedLibraryGallery,
} from "@elaraai/east-ui-components/internal";

/** A source's part of a slice. */
type Part = ValueTypeOf<RecordSliceBindType>;
/** A library's slice, as its payload carries it: the rail's chrome. */
type Chrome = ValueTypeOf<RecordSlicesChromeType>;

/** A narrowing as text: what tells one narrowing's rows from another's. */
const printWhere = printFor(RecordSliceWhereType);
/** A String field's chosen value, as the rail writes it. */
const readText = parseFor(StringType);

/** The narrowest a library's card stands, and its height, px: the Library's gallery card, its media over its face. */
const CARD_LEAST = 300;
const CARD_PX = 224;
/** The fact a library's card shows: its row's tags, as chips. */
const TAGS = "tags";
const CARD_DIMS = [TAGS] as const;

/**
 * A library's gallery: its cards at the one size every library's stand at, each showing its row's tags, and what its
 * host draws of a row — its card, its media, its note, which rows take a press, and the press.
 *
 * @param cards - What the host draws of a row, and the press
 * @returns The gallery the paged gallery draws
 */
export function libraryGallery<T>(cards: Omit<PagedLibraryGallery<T>, "least" | "cardPx" | "dims">): PagedLibraryGallery<T> {
    return { least: CARD_LEAST, cardPx: CARD_PX, dims: CARD_DIMS, ...cards };
}

/**
 * What a library's card says of its row beside its own words: the mark of the one its host says is open — the card
 * placed, its status the word — and the row's tags, as chips.
 *
 * @param open - Whether it is the row its host says is open
 * @param openWord - The status's word (`Open`)
 * @param tags - The row's tags, in their order
 * @returns The card's status, whether it is placed, and its facts
 */
export function libraryCardMarks(open: boolean, openWord: string, tags: Iterable<string>): Pick<LibraryItemValue, "status" | "placed" | "dims"> {
    const chips = [...tags];
    return {
        status: open ? some({ label: openWord, tone: variant("info", null), ring: false }) : none,
        placed: open,
        dims: new Map(chips.length === 0 ? [] : [[TAGS, variant("chips", chips)]]),
    };
}

/** Props of {@link SliceGallery}. */
export interface SliceGalleryProps<T> {
    /** The source's part of the slice: what the cards are read through, and what Clear filters clears. */
    readonly part: Part;
    /** The gallery's id: where its view is kept. */
    readonly id: string;
    /** Its cards, and the grid they stand in. */
    readonly gallery: PagedLibraryGallery<T>;
    /** An entry of a page, as the source reads it, made the gallery's row — its row read through `entryRow`; `undefined` drops one that is none. Keep it stable: the page source is made again as it changes. */
    readonly decode: (entry: RecordSliceEntry) => T | undefined;
    /** What it says while the source holds no row, in its host's words. Keep it stable. */
    readonly empty: LibraryEmpty;
    /** What it says while the rail's choices leave the source no row, in its host's words, over Clear filters. Keep it stable. */
    readonly narrowed: LibraryEmpty;
}

/**
 * A library's cards over a source of its slice: the shared paged gallery,
 * reading the source a page at a time under the rail's choices — its count the
 * narrowing's, from e3, and its revision the record's, so a write elsewhere
 * reads the cards again — and saying so where the rail's choices leave none.
 *
 * @param props - The source's part, the gallery, how a page's row is read, and what it says with no row
 * @returns The gallery
 */
export function SliceGallery<T>({ part, id, gallery, decode, empty, narrowed }: SliceGalleryProps<T>) {
    const source = useMemo((): LibraryPageSource<T> => ({
        id: part.key,
        page: (offset, limit) => {
            const entries = recordSlicePage(part, { where: part.read().where, area: none }, offset, limit);
            if (entries.type === "none") return none;
            return some((entries.value as RecordSliceEntry[]).flatMap((entry) => {
                const row = decode(entry);
                return row === undefined ? [] : [row];
            }));
        },
        total: () => part.count(),
        revision: () => recordSliceRevision(part),
        query: () => printWhere(part.read().where),
    }), [part, decode]);
    // Whether a choice of the viewer's narrows the source: what an empty gallery says, and whether it offers Clear filters.
    const readChosen = useCallback(() => recordSliceChosen(part), [part]);
    const { result } = useTrackedEvaluation(readChosen);
    const chosen = result.ok && result.value;
    const narrowing = useMemo((): LibraryNarrowing | undefined => (chosen ? { empty: narrowed, onClear: () => { part.clearAll(); }, emptied: true } : undefined),
        [chosen, narrowed, part]);
    return <PagedGallery source={source} id={id} gallery={gallery} empty={empty} narrowing={narrowing} />;
}

/**
 * A library's rail: the toolbar items of its slice, as its chrome says to draw them — its affordances, and where its
 * choices are kept — each source counted in its host's noun.
 *
 * @param chrome - The library's slice, as its payload carries it
 * @param nouns - What each source is counted in, by its name
 * @param excludeFields - Fields the rail leaves out, as `source.field`: the sources the library does not show
 * @returns The rail's items, for the library's one toolbar
 */
export function useLibraryRail(chrome: Chrome, nouns: Readonly<Record<string, string>>, excludeFields?: readonly string[]): ToolbarItem[] {
    const affordances = useMemo(() => chrome.affordances.map((affordance) => affordance.type), [chrome]);
    return useRecordSlicesToolbarItems(chrome.slice, {
        nouns, affordances, ...(excludeFields === undefined ? {} : { excludeFields }),
        ...(chrome.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
}

/**
 * The one value the rail has chosen of a String field of a source — the data
 * source the query library's New query starts on (L11), the project the page
 * library's New page starts in (L12). `undefined` while none is chosen, or
 * several.
 *
 * @param part - The source's part of the slice; `undefined` where the slice has no such source
 * @param field - The String field
 * @returns The value chosen, or `undefined`
 */
export function useRailValue(part: Part | undefined, field: string): string | undefined {
    const read = useCallback((): string | undefined => {
        const choice = part?.read().where.get(field);
        if (choice === undefined || choice.type !== "values" || choice.value.length !== 1) return undefined;
        const value = readText(choice.value[0]!);
        return value.success ? value.value : undefined;
    }, [part, field]);
    const { result } = useTrackedEvaluation(read);
    return result.ok ? result.value : undefined;
}

/** Props of {@link LibraryNewButton}: its words and form, and what a menu or a popover hands its trigger. */
export type LibraryNewButtonProps = Omit<ComponentPropsWithoutRef<typeof chakra.button>, "children"> & {
    /** Its words: what it makes, and where (`New page in Ops console`). */
    readonly label: string;
    /** Its words shown, or its plus alone, named by them: the toolbar's folded form. */
    readonly labelled: boolean;
    /** A caret after its words: it opens a menu. */
    readonly caret?: boolean | undefined;
};

/**
 * A library's New, in its toolbar: the brand's solid button, a plus before its
 * words — or, folded, the plus alone, named by its words — and a caret after
 * them where it opens a menu. It is a trigger as well as a button: it takes
 * what a menu or a popover hands its trigger, and its ref.
 */
export const LibraryNewButton = forwardRef<HTMLButtonElement, LibraryNewButtonProps>(function LibraryNewButton({ label, labelled, caret = false, ...rest }, ref) {
    const styles = useSlotStyles("library");
    const button = useRecipe({ key: "button" });
    const solid = useMemo(() => button({ variant: "solid", size: "sm" }) as SystemStyleObject, [button]);
    return (
        <chakra.button ref={ref} type="button" css={solid} colorPalette="brand" {...(labelled ? {} : { "aria-label": label, title: label })} {...rest}>
            <Box as="span" css={styles.newIcon} aria-hidden><FontAwesomeIcon icon={faPlus} /></Box>
            {labelled ? label : null}
            {caret && <Box as="span" css={styles.newCaret} aria-hidden><FontAwesomeIcon icon={faCaretDown} /></Box>}
        </chakra.button>
    );
});
