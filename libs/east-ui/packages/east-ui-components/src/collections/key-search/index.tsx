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
 * The popup lists the head of the match range; committing an item — or
 * pressing Enter when the popup has no highlighted option — jumps the
 * host tree, next/prev step through the remembered range ("k of n"), and
 * the clear button (or emptying the input) drops the query and tells the
 * host to clear its jump highlight. The tree itself never changes shape:
 * matches are a contiguous run of rows in the canonical key order, so
 * jumping + stepping subsumes filtering without a second row space.
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
import { Flex, IconButton, Text } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronUp, faXmark } from '@fortawesome/free-solid-svg-icons';
import { none, some, variant, type EastTypeValue } from '@elaraai/east';
import {
    parseKeyInput,
    keyRangePredicates,
    structKeyFields,
    type DatasetKeyMatchRange,
    type DatasetKeyQuery,
    type ParsedKeyInput,
} from '@elaraai/east-ui/internal';
import { EastChakraCombobox } from '../../forms/combobox/index.js';

export { parseKeyInput, keyRangePredicates };
export type { DatasetKeyMatchRange, DatasetKeyQuery, ParsedKeyInput };

/** Debounce applied to type-ahead queries (ms). */
const FIND_DEBOUNCE_MS = 250;
/** Rows listed in the popup — the head of the match range. */
const POPUP_LIMIT = 20;

export interface DatasetKeySearchProps {
    /** The searched collection's Dict key / Set element type. */
    keyType: EastTypeValue;
    /** Locates a query; literals are canonical `.east` text of
     *  already-validated values. */
    onFind: (query: DatasetKeyQuery) => Promise<DatasetKeyMatchRange>;
    /** Labels rows `[row, row + limit)` for the popup, in row order. */
    onListRange: (row: number, limit: number) => Promise<string[]>;
    /** Jumps the host tree to a global root row. */
    onJump: (row: number) => void;
    /** Clears the host's jump (and its held row highlight) when the query
     *  is cleared. */
    onClear?: (() => void) | undefined;
}

/**
 * Renders the dataset key search control.
 *
 * @param props - see {@link DatasetKeySearchProps}
 * @returns the search combobox with its match count, range navigation and
 *   clear affordance
 */
export const DatasetKeySearch = memo(function DatasetKeySearch({ keyType, onFind, onListRange, onJump, onClear }: DatasetKeySearchProps) {
    const [range, setRange] = useState<DatasetKeyMatchRange | null>(null);
    const [items, setItems] = useState<{ row: number; label: string }[]>([]);
    /** Position within the range after a jump; -1 before the first jump. */
    const [activeIdx, setActiveIdx] = useState(-1);
    const [hint, setHint] = useState<string | null>(null);
    /** Bumped to remount the combobox — the one way to empty its input. */
    const [resetSeq, setResetSeq] = useState(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const findSeqRef = useRef(0);
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    const runFind = useCallback((query: DatasetKeyQuery) => {
        const seq = ++findSeqRef.current;
        void (async () => {
            try {
                const result = await onFind(query);
                if (seq !== findSeqRef.current) return; // superseded by newer input
                setRange(result);
                setActiveIdx(-1);
                if (result.found) {
                    const labels = await onListRange(result.row, Math.min(POPUP_LIMIT, result.count));
                    if (seq !== findSeqRef.current) return;
                    setItems(labels.map((label, i) => ({ row: result.row + i, label })));
                } else {
                    setItems([]);
                }
            } catch {
                if (seq !== findSeqRef.current) return;
                setRange(null);
                setItems([]);
            }
        })();
    }, [onFind, onListRange]);

    const resetQueryState = useCallback(() => {
        clearTimeout(debounceRef.current);
        findSeqRef.current++;
        setRange(null);
        setItems([]);
        setActiveIdx(-1);
        setHint(null);
    }, []);

    const handleInput = useCallback((text: string) => {
        clearTimeout(debounceRef.current);
        if (text === '') {
            resetQueryState();
            onClear?.();
            return;
        }
        const parsed = parseKeyInput(keyType, text);
        if (parsed.kind === 'hint') {
            findSeqRef.current++;
            setRange(null);
            setItems([]);
            setActiveIdx(-1);
            setHint(parsed.hint);
            return;
        }
        setHint(null);
        debounceRef.current = setTimeout(() => runFind(parsed.query), FIND_DEBOUNCE_MS);
    }, [keyType, runFind, resetQueryState, onClear]);

    const clearSearch = useCallback(() => {
        resetQueryState();
        setResetSeq((s) => s + 1);
        onClear?.();
    }, [resetQueryState, onClear]);

    const commit = useCallback((row: number) => {
        onJump(row);
        if (range !== null) setActiveIdx(row - range.row);
    }, [onJump, range]);

    const step = useCallback((delta: number) => {
        if (range === null || !range.found) return;
        const next = Math.max(0, Math.min(range.count - 1, (activeIdx === -1 ? 0 : activeIdx) + delta));
        commit(range.row + next);
    }, [range, activeIdx, commit]);

    // Worst-case degrade: with no highlighted popup option, Enter behaves
    // as a plain search box and jumps to the first match. A highlighted
    // option commits through the combobox itself.
    const onKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
        if (e.key !== 'Enter' || range === null || !range.found) return;
        if (document.querySelector('[data-scope="combobox"][data-part="content"] [data-highlighted]') !== null) return;
        commit(range.row + Math.max(0, activeIdx));
    }, [range, activeIdx, commit]);

    const placeholder = useMemo(() => {
        const fields = structKeyFields(keyType);
        if (fields !== null) return `Search keys (${fields.map((f) => f.name).join(', ')})`;
        return keyType.type === 'String' ? 'Search keys' : `Find key (${keyType.type})`;
    }, [keyType]);

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
        onChange: some((v: string) => commit(Number(v))),
        onChangeMultiple: none,
        onInputValueChange: some(handleInput),
        onOpenChange: none,
        style: some({ size: some(variant('xs', null)), color: none, background: none, borderColor: none }),
    }) as never, [items, placeholder, commit, handleInput]);

    const status = hint !== null
        ? hint
        : range === null
            ? null
            : !range.found
                ? 'No matches'
                : activeIdx === -1
                    ? `${range.count.toLocaleString()} ${range.count === 1 ? 'match' : 'matches'}`
                    : `${(activeIdx + 1).toLocaleString()} of ${range.count.toLocaleString()}`;
    const canStep = range !== null && range.found && range.count > 1;
    return (
        <Flex gap={1} align="center" minW="0" onKeyDownCapture={onKeyDownCapture} data-part="dataset-key-search">
            {/* Sized to the key signature (inputs have a fixed intrinsic
              * width, so the placeholder cannot size the box itself), capped
              * and shrinkable — past the cap the input ellipsizes. */}
            <Flex width={`min(${placeholder.length + 10}ch, 40rem)`} minW="12rem" flexShrink={1}>
                <EastChakraCombobox key={resetSeq} value={payload} selectionBehavior="preserve" />
            </Flex>
            {status !== null && (
                <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">{status}</Text>
            )}
            {canStep && (
                <>
                    <IconButton aria-label="Previous match" size="2xs" variant="ghost"
                        disabled={activeIdx <= 0} onClick={() => step(-1)}>
                        <FontAwesomeIcon icon={faChevronUp} />
                    </IconButton>
                    <IconButton aria-label="Next match" size="2xs" variant="ghost"
                        disabled={activeIdx >= range.count - 1} onClick={() => step(1)}>
                        <FontAwesomeIcon icon={faChevronDown} />
                    </IconButton>
                </>
            )}
            {(range !== null || hint !== null) && (
                <IconButton aria-label="Clear search" size="2xs" variant="ghost" onClick={clearSearch}>
                    <FontAwesomeIcon icon={faXmark} />
                </IconButton>
            )}
        </Flex>
    );
});
