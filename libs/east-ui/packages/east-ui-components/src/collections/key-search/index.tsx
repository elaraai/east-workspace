/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DatasetKeySearch>` — key search over a COLLECTION's canonical key order
 * (#520).
 *
 * Lives here, in east-ui-components, because nothing about it is e3: every
 * prop is a host callback and the only imports are React, Chakra, FontAwesome
 * and east itself (#574). `<PagedDatasetPreview>` mounts it over a dataset's
 * server-side fence search; a component with a keyed paged source mounts it
 * over that source's `seek`. The name is kept for its existing consumers.
 *
 * One control for every collection: the app's standard Combobox (the
 * east-ui `Combobox` renderer, shared slot recipe and field chrome).
 * String-keyed collections type-ahead as debounced PREFIX queries. STRUCT
 * keys type naturally as comma-separated leading field values — `press`
 * (prefix on the first field when it is a String), `press, 2` (exact
 * leading fields; the last segment is a prefix on a String field, an exact
 * value otherwise) — or a whole-key `.east` literal in parentheses for an
 * exact jump; the placeholder and the parse hint spell out the field names
 * and types. Other key types parse the input as an `.east` literal (an
 * unparsable input shows the expected type inline and sends nothing).
 * The popup lists the head of the match range, read once its count stands:
 * the count shows and Enter jumps as soon as the query is found, while the
 * popup says `Searching…` until its lines land, or why they could not be
 * read (#1398, CL10) — never `No matches` over a range found. Committing an item — or
 * pressing Enter when the popup has no highlighted option — jumps the
 * host tree and shows the match in the box, next/prev step through the
 * remembered range ("k of n"), each showing the match it lands on, and
 * the clear button (or emptying the input) drops the query and tells the
 * host to clear its jump highlight. A host is told how each jump was asked
 * (`KeySearchJump`): a commit is a pick, which hands the keyboard to the
 * host's view — the host brings it to the match as it lands, after the box
 * has let it go (`usePickHandOff`, `./hand-off.ts`) — and a next or prev is
 * a step, which leaves it in the box, to step on (#1398). A match shows as the text its host gives
 * its row (`onListRange`'s `text`), else as its label; typing again starts a
 * query from what is typed. The tree itself never changes shape:
 * matches are a contiguous run of rows in the canonical key order, so
 * jumping + stepping subsumes filtering without a second row space. A host
 * whose source moves to another snapshot moves `requery`, and the box asks the
 * query it holds again there, showing what was typed again: a match it showed
 * was placed at the old snapshot's rows (#1199). A host whose lines say more of
 * a row once it has listed it moves `relist`, and the box lists the rows it
 * shows again, its query, its count and its place kept: the Sheet's line for a
 * row its filters hide names them once e3 has said which.
 *
 * The host owns the data: `onFind` locates a query (server fences or a
 * client-side scan), `onListRange` labels a row window for the popup,
 * `onJump` drives the tree's `scrollToRow` contract, and `onClear` clears
 * it.
 *
 * The query grammar (`parseKeyInput`) and the inline range predicates
 * (`keyRangePredicates`) live in `@elaraai/east-ui/internal` (#719) — the
 * terminal's `/find` shares them — and are re-exported from here unchanged.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, chakra } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronUp, faXmark } from '@fortawesome/free-solid-svg-icons';
import { StringType, equalFor, none, some, variant, type EastTypeValue } from '@elaraai/east';
import {
    parseKeyInput,
    keyRangePredicates,
    structKeyFields,
    type DatasetKeyMatchRange,
    type DatasetKeyQuery,
    type ParsedKeyInput,
} from '@elaraai/east-ui/internal';
import { EastChakraCombobox } from '../../forms/combobox/index.js';
import { useFormatters } from '../../format/index.js';
import { useSlotStyles } from '../../theme/slot-styles.js';

export { parseKeyInput, keyRangePredicates };
export type { DatasetKeyMatchRange, DatasetKeyQuery, ParsedKeyInput };

/** Debounce applied to type-ahead queries (ms). */
const FIND_DEBOUNCE_MS = 250;
/** Rows listed in the popup — the head of the match range. */
const POPUP_LIMIT = 20;

/** A row as a host labels it for the popup: its label, at the row asked for; or at a row of its own, with the text the box shows once it is picked. */
export type ListedLabel = string | { row: number; label: string; text?: string };

/**
 * How a jump was asked (#1398): a `pick` — a match chosen from the popup, or Enter in the box — hands the keyboard to the
 * host's view, which brings it to the match as the match lands; a `step` — Previous or Next match — leaves it in the
 * box, to step on.
 */
export type KeySearchJump = "pick" | "step";

/** A listed row: its position, its label, and the text the box shows once it is picked — the host's, else its label. */
interface ListedRow {
    readonly row: number;
    readonly label: string;
    readonly text: string;
}

/** A host's label of a row, at `row` when the label names no row of its own. */
function listedRow(label: ListedLabel, row: number): ListedRow {
    return typeof label === 'string' ? { row, label, text: label } : { row: label.row, label: label.label, text: label.text ?? label.label };
}

/** The match the box shows when its query is asked again: its place in the range, its text, and the show it is. */
interface StandingMatch {
    readonly index: number;
    readonly text: string;
    readonly seq: number;
}

const stringEqual = equalFor(StringType);

export interface DatasetKeySearchProps {
    /** Optional bounded browse on opening an empty box. The source supplies the query; the popup still lists at most 20 rows. */
    browseQuery?: DatasetKeyQuery | undefined;
    /** A local search can describe its own matching instead of the default key-search hint. */
    noMatchesText?: string | undefined;
    /** Names the searched collection in the input; defaults to Search Records. */
    label?: string | undefined;
    /** The searched collection's Dict key / Set element type. */
    keyType: EastTypeValue;
    /** Locates a query; literals are canonical `.east` text of
     *  already-validated values. `again` is a query the box holds asked again,
     *  as `requery` moved — the source's new snapshot, which its matches index:
     *  a host that jumps to a new query's matches leaves the view where it is. */
    onFind: (query: DatasetKeyQuery, again?: boolean) => Promise<DatasetKeyMatchRange>;
    /** Labels rows `[row, row + limit)` for the popup. Explicit positions preserve gaps when a view omits entries; a
     *  row's `text`, when given, is what the box shows once the row is picked or stepped to — its label otherwise. */
    onListRange: (row: number, limit: number) => Promise<ListedLabel[]>;
    /** Jumps the host tree to a global root row — a pick, whose match takes the keyboard as it lands, or a step. */
    onJump: (row: number, how: KeySearchJump) => void;
    /** Clears the host's jump (and its held row highlight) when the query
     *  is cleared. */
    onClear?: (() => void) | undefined;
    /** Told the input's text as it changes — what is typed, the match a pick
     *  or a step shows, and `''` when the clear button empties it: a host that
     *  keeps the search (#1120). */
    onInputChange?: ((text: string) => void) | undefined;
    /**
     * Moves when the source moved to another snapshot (#1199): a query the box
     * holds is asked again (`onFind(query, true)`), its text kept, so its
     * matches index the new snapshot's rows. A host that would rather drop the
     * query keys the box afresh instead.
     */
    requery?: number | undefined;
    /**
     * Moves when what the host says of the rows it lists moves — a host that
     * learns more of a row after listing it, as the Sheet learns which of its
     * filters hide a row: the box lists the rows it shows again
     * (`onListRange`), its query, its count and its place kept, and its lines
     * stand until the new ones land.
     */
    relist?: number | undefined;
}

/**
 * Renders the dataset key search control.
 *
 * @param props - see {@link DatasetKeySearchProps}
 * @returns the search combobox with its match count, range navigation and
 *   clear affordance
 */
export const DatasetKeySearch = memo(function DatasetKeySearch({ keyType, onFind, onListRange, onJump, onClear, onInputChange, requery, relist, label, browseQuery, noMatchesText }: DatasetKeySearchProps) {
    // The combobox's recipe made once for the theme (#1398, CL9): the box is drawn again with its builder's toolbar.
    const styles = useSlotStyles('combobox', { size: 'xs' });
    /** Whether the box holds text: typed, or the match a pick or a step shows. */
    const [typed, setTyped] = useState(false);
    const [open, setOpen] = useState(false);
    /** The query is on its way: its count is not known. */
    const [loading, setLoading] = useState(false);
    const [range, setRange] = useState<DatasetKeyMatchRange | null>(null);
    const [items, setItems] = useState<ListedRow[]>([]);
    /** The lines of a found range are on their way, or why they could not be read: the count stands meanwhile. */
    const [listing, setListing] = useState(false);
    const [listFailure, setListFailure] = useState<string | null>(null);
    /** What was typed: what the box shows again when a match it showed no longer stands (#1199). */
    const typedRef = useRef('');
    /** The match the box shows, as its combobox takes it; `undefined` while it shows what was typed. */
    const [shown, setShown] = useState<{ value: string; seq: number } | undefined>(undefined);
    /** Moves with each match shown and each keystroke: a match's text read after it moved on is not shown. */
    const shownSeqRef = useRef(0);
    /** Whether the box shows a match, rather than what was typed. */
    const showingRef = useRef(false);
    /** Position within the range after a jump; -1 before the first jump. */
    const [activeIdx, setActiveIdx] = useState(-1);
    const [hint, setHint] = useState<string | null>(null);
    /** Bumped to remount the combobox — the one way to empty its input. */
    const [resetSeq, setResetSeq] = useState(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const findSeqRef = useRef(0);
    /** Moves with each listing of a range's rows: a listing a later one overtook is not shown. */
    const listSeqRef = useRef(0);
    /** The query the box holds — the last one sent — until it is cleared (#1199). */
    const queryRef = useRef<DatasetKeyQuery | undefined>(undefined);
    useEffect(() => () => { clearTimeout(debounceRef.current); findSeqRef.current++; }, []);
    // The match counts, in the app's locale (#850).
    const words = useFormatters();

    /** The box shows what was typed again: the match it showed no longer stands where it stood. */
    const showTyped = useCallback(() => {
        showingRef.current = false;
        const text = typedRef.current;
        setShown({ value: text, seq: ++shownSeqRef.current });
        setTyped(text !== '');
        onInputChange?.(text);
    }, [onInputChange]);

    /** Whether a row holds the match the box shows: the text its host gives it now, read through the list. */
    const holdsAt = useCallback(async (row: number, text: string): Promise<boolean> => {
        try {
            const labels = await onListRange(row, 1);
            const at = labels.map((label, i) => listedRow(label, row + i)).find((item) => item.row === row);
            return at !== undefined && stringEqual(at.text, text);
        } catch {
            // Not read, it is not known to stand: the box shows what was typed.
            return false;
        }
    }, [onListRange]);

    /**
     * Lists the head of a found range through the host: its lines the popup's once they land, or why they could not be
     * read (#1398, CL10) — a listing a newer find or a newer listing overtook never shown.
     */
    const listRows = useCallback(async (seq: number, found: DatasetKeyMatchRange) => {
        const listed = ++listSeqRef.current;
        const current = () => seq === findSeqRef.current && listed === listSeqRef.current;
        setListing(true);
        try {
            const labels = await onListRange(found.row, Math.min(POPUP_LIMIT, found.count));
            if (!current()) return;
            setItems(labels.map((label, i) => listedRow(label, found.row + i)));
            setListFailure(null);
        } catch (error) {
            if (!current()) return;
            setListFailure(error instanceof Error ? error.message : 'The matches could not be listed');
        } finally {
            if (current()) setListing(false);
        }
    }, [onListRange]);

    const runFind = useCallback((query: DatasetKeyQuery, again = false, standing?: StandingMatch) => {
        const seq = ++findSeqRef.current;
        queryRef.current = query;
        setLoading(true);
        setItems([]);
        setListing(false);
        setListFailure(null);
        void (async () => {
            let result: DatasetKeyMatchRange;
            try {
                // A query asked again says so; a new one is asked as it always was.
                result = await (again ? onFind(query, true) : onFind(query));
                if (seq !== findSeqRef.current) return; // superseded by newer input
                setRange(result);
                // A match the box shows stands while the new snapshot holds it at its place in the range; a pick, a
                // step or a keystroke since then owns the box.
                const stands = standing !== undefined && result.found && standing.index < result.count
                    && await holdsAt(result.row + standing.index, standing.text);
                if (seq !== findSeqRef.current) return;
                const moved = standing !== undefined && standing.seq !== shownSeqRef.current;
                setActiveIdx(stands && !moved ? standing.index : -1);
                if (standing !== undefined && !stands && !moved) showTyped();
            } catch (error) {
                if (seq !== findSeqRef.current) return;
                setRange(null);
                setItems([]);
                setHint(error instanceof Error ? error.message : 'Search failed');
                setLoading(false);
                return;
            }
            // Found, the count stands and Enter jumps; the lines follow, read through the host — a far match's from its
            // rows' window — and a listing still on its way, or one that failed, never holds either (#1398, CL10).
            setLoading(false);
            if (!result.found) return;
            await listRows(seq, result);
        })();
    }, [onFind, holdsAt, showTyped, listRows]);

    const resetQueryState = useCallback(() => {
        clearTimeout(debounceRef.current);
        findSeqRef.current++;
        queryRef.current = undefined;
        setRange(null);
        setItems([]);
        setActiveIdx(-1);
        setHint(null);
        setLoading(false);
        setListing(false);
        setListFailure(null);
    }, []);

    // The source moved to another snapshot (#1199): the query the box holds is
    // asked again there — never on the first render. A match the box shows
    // stays where the new snapshot holds it at its place in the range, and
    // gives way to what was typed where it does not.
    const askedAt = useRef(requery);
    useEffect(() => {
        if (askedAt.current === requery) return;
        askedAt.current = requery;
        const query = queryRef.current;
        if (query === undefined) return;
        const standing = showingRef.current && shown !== undefined && activeIdx >= 0 ? { index: activeIdx, text: shown.value, seq: shown.seq } : undefined;
        runFind(query, true, standing);
    }, [requery, runFind, shown, activeIdx]);

    // What the host says of the rows listed moved: they are listed again — never on the first render, nor while a query
    // is on its way, whose lines are read as it lands — the query, its count and its place kept, the lines standing until
    // the new ones land.
    const listedAt = useRef(relist);
    useEffect(() => {
        if (listedAt.current === relist) return;
        listedAt.current = relist;
        if (loading || range === null || !range.found) return;
        void listRows(findSeqRef.current, range);
    }, [relist, loading, range, listRows]);

    const handleInput = useCallback((text: string) => {
        clearTimeout(debounceRef.current);
        onInputChange?.(text);
        setTyped(text !== '');
        // What is typed is the box's text now: a match still being read is not shown over it.
        typedRef.current = text;
        shownSeqRef.current++;
        showingRef.current = false;
        setShown(undefined);
        findSeqRef.current++;
        setRange(null);
        setItems([]);
        setActiveIdx(-1);
        setLoading(false);
        setListing(false);
        setListFailure(null);
        if (text === '') {
            resetQueryState();
            onClear?.();
            if (open && browseQuery !== undefined) runFind(browseQuery);
            return;
        }
        const parsed = parseKeyInput(keyType, text);
        if (parsed.kind === 'hint') {
            findSeqRef.current++;
            queryRef.current = undefined;
            setRange(null);
            setItems([]);
            setActiveIdx(-1);
            setHint(parsed.hint);
            return;
        }
        setHint(null);
        setLoading(true);
        debounceRef.current = setTimeout(() => runFind(parsed.query), FIND_DEBOUNCE_MS);
    }, [keyType, runFind, resetQueryState, onClear, onInputChange, open, browseQuery]);

    const handleOpen = useCallback((next: boolean) => {
        setOpen(next);
        if (next && !typed && browseQuery !== undefined) runFind(browseQuery);
    }, [typed, browseQuery, runFind]);

    const clearSearch = useCallback(() => {
        resetQueryState();
        setTyped(false);
        setOpen(false);
        typedRef.current = '';
        shownSeqRef.current++;
        showingRef.current = false;
        setShown(undefined);
        setResetSeq((s) => s + 1);
        onClear?.();
        onInputChange?.('');
    }, [resetQueryState, onClear, onInputChange]);

    /** Shows the match a pick or a step jumped to in the box: its row's text, read through the list when the popup holds none. */
    const showMatch = useCallback((row: number) => {
        const seq = ++shownSeqRef.current;
        const show = (text: string) => {
            // A later pick, step or keystroke moved on: the box is theirs.
            if (seq !== shownSeqRef.current) return;
            showingRef.current = true;
            setShown({ value: text, seq });
            setTyped(true);
            onInputChange?.(text);
        };
        const listed = items.find((item) => item.row === row);
        if (listed !== undefined) {
            show(listed.text);
            return;
        }
        void onListRange(row, 1)
            .then((labels) => {
                const match = labels.map((label, i) => listedRow(label, row + i)).find((item) => item.row === row);
                if (match !== undefined) show(match.text);
            })
            .catch((error: unknown) => { console.error('DatasetKeySearch: could not read the match it jumped to:', error); });
    }, [items, onListRange, onInputChange]);

    const commit = useCallback((row: number, how: KeySearchJump) => {
        onJump(row, how);
        if (range !== null) setActiveIdx(row - range.row);
        showMatch(row);
    }, [onJump, range, showMatch]);

    const step = useCallback((delta: number) => {
        if (range === null || !range.found) return;
        const next = Math.max(0, Math.min(range.count - 1, (activeIdx === -1 ? 0 : activeIdx) + delta));
        commit(range.row + next, 'step');
    }, [range, activeIdx, commit]);

    // Worst-case degrade: with no highlighted popup option, Enter behaves
    // as a plain search box and jumps to the first match — a pick, as a
    // highlighted option's Enter is. A highlighted option commits through
    // the combobox itself.
    const onKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
        if (e.key !== 'Enter' || range === null || !range.found) return;
        if (document.querySelector('[data-scope="combobox"][data-part="content"] [data-highlighted]') !== null) return;
        commit(range.row + Math.max(0, activeIdx), 'pick');
    }, [range, activeIdx, commit]);

    const placeholder = useMemo(() => {
        const title = label ?? "Search Records";
        const fields = structKeyFields(keyType);
        if (fields !== null) return `${title} (${fields.map((f) => f.name).join(', ')})`;
        return keyType.type === 'String' ? title : `${title} (${keyType.type})`;
    }, [keyType, label]);

    // The standard Combobox renderer takes a host-constructed decoded
    // payload (data + JS callbacks) — the same fabrication the ValueTree's
    // inline editors use — so the control is the design system's combobox,
    // not a bespoke widget.
    const payload = useMemo(() => ({
        value: none,
        items: items.map((it) => ({ value: String(it.row), label: it.label, disabled: none })),
        placeholder: some(placeholder),
        multiple: none,
        disabled: none,
        allowCustomValue: some(true),
        onChange: some((v: string) => commit(Number(v), 'pick')),
        onChangeMultiple: none,
        onInputValueChange: some(handleInput),
        onOpenChange: some(handleOpen),
        style: some({ size: some(variant('xs', null)), color: none, background: none, borderColor: none }),
    }) as never, [items, placeholder, commit, handleInput, handleOpen]);

    const status = hint !== null
        ? hint
        : !typed
            ? null
            : loading
            ? 'Searching…'
            : range === null
            ? null
            : !range.found
                ? 'No matches'
                : activeIdx === -1
                    ? `${words.number(range.count)} ${range.count === 1 ? 'match' : 'matches'}`
                    : `${words.number(activeIdx + 1)} of ${words.number(range.count)}`;
    const canStep = typed && range !== null && range.found && range.count > 1;
    const indicators = <>
        {status !== null && <chakra.span css={styles.searchStatus} role="status" title={status}>{status}</chakra.span>}
        {canStep && <>
            <chakra.button type="button" css={styles.searchAction} aria-label="Previous match"
                disabled={activeIdx <= 0} onClick={() => step(-1)}>
                <FontAwesomeIcon icon={faChevronUp} />
            </chakra.button>
            <chakra.button type="button" css={styles.searchAction} aria-label="Next match"
                disabled={activeIdx >= range.count - 1} onClick={() => step(1)}>
                <FontAwesomeIcon icon={faChevronDown} />
            </chakra.button>
        </>}
        {typed && <chakra.button type="button" css={styles.searchAction} aria-label="Clear search" onClick={clearSearch}>
            <FontAwesomeIcon icon={faXmark} />
        </chakra.button>}
    </>;
    return (
        <Box css={[styles.search, { '--key-search-width': `${placeholder.length + (status === null ? 10 : 26)}ch` }]}
            onKeyDownCapture={onKeyDownCapture} data-part="dataset-key-search">
            <EastChakraCombobox key={resetSeq} value={payload} selectionBehavior="preserve" filterItems={false} openOnClick={browseQuery !== undefined} text={shown}
                // Its lines on their way, the popup says so — never `No matches` over a range found (#1398, CL13).
                indicators={indicators} emptyText={loading || listing ? 'Searching…' : listFailure ?? hint ?? (range === null ? 'Type to search' : noMatchesText ?? (keyType.type === 'String'
                    ? 'No matches. Keys are case-sensitive.' : 'No matches'))} />
        </Box>
    );
});
