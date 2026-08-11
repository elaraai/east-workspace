/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DatasetKeySearch>` — the key search control of the dataset value-tree
 * preview (#520).
 *
 * One control for every collection: the app's standard Combobox (the
 * east-ui `Combobox` renderer, shared slot recipe and field chrome).
 * String-keyed collections type-ahead as debounced PREFIX queries; other
 * key types parse the input as an `.east` literal of the key type (an
 * unparsable literal shows the expected type inline and sends nothing).
 * The popup lists the head of the match range; committing an item — or
 * pressing Enter when the popup has no highlighted option — jumps the
 * host tree to the match's row, and next/prev step through the remembered
 * range ("k of n"). The tree itself never changes shape: matches are a
 * contiguous run of rows in the canonical key order, so jumping + stepping
 * subsumes filtering without a second row space.
 *
 * The host owns the data: `onFind` locates a query (server fences or a
 * client-side scan), `onListRange` labels a row window for the popup, and
 * `onJump` drives the tree's `scrollToRow` contract.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flex, IconButton, Text } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import { none, some, variant, parseFor, printFor, type EastTypeValue } from '@elaraai/east';
import { EastChakraCombobox } from '@elaraai/east-ui-components';

/** Debounce applied to type-ahead queries (ms). */
const FIND_DEBOUNCE_MS = 250;
/** Rows listed in the popup — the head of the match range. */
const POPUP_LIMIT = 20;

/** Where a query landed in the collection's canonical key order. */
export interface DatasetKeyMatchRange {
    /** Whether any row matched. */
    found: boolean;
    /** First matched row (for a miss, the query's insertion row). */
    row: number;
    /** Number of matched rows. */
    count: number;
}

export interface DatasetKeySearchProps {
    /** The searched collection's Dict key / Set element type. */
    keyType: EastTypeValue;
    /** Locates a prefix (String keys) or an exact key. `key` is the
     *  canonical `.east` text of an already-validated key value. */
    onFind: (query: { prefix: string } | { key: string }) => Promise<DatasetKeyMatchRange>;
    /** Labels rows `[row, row + limit)` for the popup, in row order. */
    onListRange: (row: number, limit: number) => Promise<string[]>;
    /** Jumps the host tree to a global root row. */
    onJump: (row: number) => void;
}

/**
 * Renders the dataset key search control.
 *
 * @param props - see {@link DatasetKeySearchProps}
 * @returns the search combobox with its match count and range navigation
 */
export const DatasetKeySearch = memo(function DatasetKeySearch({ keyType, onFind, onListRange, onJump }: DatasetKeySearchProps) {
    const stringKeys = keyType.type === 'String';
    const [range, setRange] = useState<DatasetKeyMatchRange | null>(null);
    const [items, setItems] = useState<{ row: number; label: string }[]>([]);
    /** Position within the range after a jump; -1 before the first jump. */
    const [activeIdx, setActiveIdx] = useState(-1);
    const [hint, setHint] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const findSeqRef = useRef(0);
    useEffect(() => () => clearTimeout(debounceRef.current), []);

    const runFind = useCallback((query: { prefix: string } | { key: string }) => {
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

    const handleInput = useCallback((text: string) => {
        clearTimeout(debounceRef.current);
        if (text === '') {
            findSeqRef.current++;
            setRange(null);
            setItems([]);
            setActiveIdx(-1);
            setHint(null);
            return;
        }
        if (stringKeys) {
            setHint(null);
            debounceRef.current = setTimeout(() => runFind({ prefix: text }), FIND_DEBOUNCE_MS);
            return;
        }
        const parsed = parseFor(keyType)(text);
        if (!parsed.success) {
            findSeqRef.current++;
            setRange(null);
            setItems([]);
            setActiveIdx(-1);
            setHint(`Key is ${keyType.type}`);
            return;
        }
        setHint(null);
        const canonical = printFor(keyType)(parsed.value as never);
        debounceRef.current = setTimeout(() => runFind({ key: canonical }), FIND_DEBOUNCE_MS);
    }, [stringKeys, keyType, runFind]);

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

    // The standard Combobox renderer takes a host-constructed decoded
    // payload (data + JS callbacks) — the same fabrication the ValueTree's
    // inline editors use — so the control is the design system's combobox,
    // not a bespoke widget.
    const payload = useMemo(() => ({
        value: none,
        items: items.map((it) => ({ value: String(it.row), label: it.label, disabled: none })),
        placeholder: some(stringKeys ? 'Search keys' : `Find key (${keyType.type})`),
        multiple: none,
        disabled: none,
        allowCustomValue: some(true),
        onChange: some((v: string) => commit(Number(v))),
        onChangeMultiple: none,
        onInputValueChange: some(handleInput),
        onOpenChange: none,
        style: some({ size: some(variant('xs', null)), color: none, background: none, borderColor: none }),
    }) as never, [items, stringKeys, keyType.type, commit, handleInput]);

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
            <Flex minW="10rem" maxW="18rem">
                <EastChakraCombobox value={payload} />
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
        </Flex>
    );
});
