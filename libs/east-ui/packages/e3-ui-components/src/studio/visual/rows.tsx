/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows under a visual, as a value tree (#1671, TIL-2): what its tile's
 * Show rows opens, in a popover hanging from the tile's menu. Each row is a
 * value of its source's own East types ({@link recordsRows}), so the tree
 * shows whatever a row holds — a date, a number, a struct, a list — each
 * row's line previewing its values, the first row open over its fields.
 *
 * The rows are never read whole: the tree's scroll bar stands over every row
 * e3 counts, and a page of them — the records program's
 * ({@link VISUAL_RECORDS_PAGE}), newest first — is asked as it comes into
 * view, through the page's answers, and let go as it leaves.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { none, some, toEastTypeValue } from "@elaraai/east";
import { ValueTree } from "@elaraai/east-ui";
import { EastChakraValueTree, type ValueTreePagedRow, type ValueTreePaging, type ValueTreeValue } from "@elaraai/east-ui-components";
import { useLoadingReveal } from "@elaraai/east-ui-components/internal";
import { emptyOf, pageRows } from "../../components/PagedDatasetPreview.js";
import { useVisualAsk } from "../../query/visual/answers.js";
import { printVisual, VISUAL_RECORDS_PAGE, type PrintSource, type PrintState } from "../../query/visual/print.js";
import { messageOf } from "../../shared/message.js";
import { useStudioMessages } from "../messages.js";
import { SourceFailed, problemOf } from "./notes.js";
import { recordsOf, recordsRows } from "./records-table.js";
import { NoRows, VisualLoading } from "./states.js";
import { midSentence, type Visual, type VisualSource } from "./values.js";

/** How tall the tree stands at most, in a popover: ten of its rows. */
const TREE_MAX_HEIGHT = "320px";
/** The pages kept each side of those in view. */
const KEPT_BESIDE = 2;

/** What the rows hold so far: their type, how many there are, and the pages read. */
interface Held {
    /** The tree's root: an empty collection of the rows' type. */
    readonly root: ValueTreeValue["root"];
    /** The rows' type, as the tree's pages are made. */
    readonly type: Parameters<typeof pageRows>[0];
    /** How many rows there are in all. */
    readonly total: number;
    /** The pages read, by their place. */
    readonly pages: ReadonlyMap<number, readonly ValueTreePagedRow[]>;
}

/** Props of {@link RowsTree}. */
export interface RowsTreeProps {
    /** The rows' records visual (`rowsVisual`). */
    readonly visual: Visual;
    /** Its source, as the surface lists it. */
    readonly source: VisualSource;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** The page's state, as its programs read it. */
    readonly state: PrintState;
    /** Where the tree keeps its state. */
    readonly storageKey: string;
    /** Told how many rows there are, once e3 says; `undefined` until then. */
    readonly onTotal?: ((total: number | undefined) => void) | undefined;
}

/**
 * The rows under a visual, as a value tree read a page at a time — see the
 * module docs.
 *
 * @param props - The rows' visual, its source, the page's state, where the tree keeps its state, and who is told the count
 * @returns The tree; while its first page is asked, its loading shape; a source's error; or that it has no rows
 */
export function RowsTree({ visual, source, read, state, storageKey, onTotal }: RowsTreeProps) {
    const m = useStudioMessages();
    const ask = useVisualAsk(visual.source);
    const records = recordsOf(visual);
    const [held, setHeld] = useState<Held | undefined>(undefined);
    const [failed, setFailed] = useState<string | undefined>(undefined);
    // The pages in hand, as the last render held them; those asked and not yet answered; and whether the tree is still
    // there to take one.
    const have = useRef<ReadonlyMap<number, readonly ValueTreePagedRow[]> | undefined>(undefined);
    have.current = held?.pages;
    const asking = useRef(new Set<number>());
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);
    // One page, unless it is in hand or already asked: its program asked, its rows kept as the tree's.
    const readPage = useCallback((page: number) => {
        if (records === undefined || asking.current.has(page) || have.current?.has(page) === true) return;
        const printed = printVisual(visual, read, state, { offset: page * VISUAL_RECORDS_PAGE, size: VISUAL_RECORDS_PAGE });
        if (printed.kind !== "asks") return;
        asking.current.add(page);
        void ask(printed.asks).then(([answer]) => {
            if (!mounted.current || answer === undefined) return;
            if (answer.kind === "problem") {
                setFailed(problemOf(answer, m));
                return;
            }
            const rows = recordsRows(records, answer, source);
            const type = toEastTypeValue(rows.type);
            setHeld((was) => ({
                root: was?.root ?? ValueTree.materialize(type, emptyOf(type)),
                type: was?.type ?? type,
                total: answer.groups,
                pages: new Map([...(was?.pages ?? []), [page, pageRows(was?.type ?? type, rows.value, page * VISUAL_RECORDS_PAGE)]]),
            }));
        }).catch((err: unknown) => {
            if (mounted.current) setFailed(messageOf(err));
        }).finally(() => { asking.current.delete(page); });
    }, [records, visual, read, state, ask, source, m]);
    // Its first page, which says how many rows there are.
    useEffect(() => { readPage(0); }, [readPage]);
    const total = held?.total;
    useEffect(() => { onTotal?.(total); }, [onTotal, total]);
    // The rows in view: their pages asked, and those far from them let go.
    const onNeedRows = useCallback((startRow: number, endRow: number) => {
        const first = Math.floor(startRow / VISUAL_RECORDS_PAGE);
        const last = Math.max(first, Math.ceil(endRow / VISUAL_RECORDS_PAGE) - 1);
        setHeld((was) => {
            if (was === undefined) return was;
            const kept = [...was.pages].filter(([page]) => page >= first - KEPT_BESIDE && page <= last + KEPT_BESIDE);
            return kept.length === was.pages.size ? was : { ...was, pages: new Map(kept) };
        });
        for (let page = first; page <= last; page++) readPage(page);
    }, [readPage]);
    const tree = useMemo((): ValueTreeValue | undefined => (held === undefined ? undefined : {
        root: held.root,
        onEdit: none, onInsert: none, onRemove: none, onTag: none,
        style: some({ height: none, maxHeight: some(TREE_MAX_HEIGHT), openDepth: some(1n), toolbar: some(false) }),
    }), [held]);
    const paging = useMemo((): ValueTreePaging | undefined => (held === undefined ? undefined : {
        totalRows: held.total, pageSize: VISUAL_RECORDS_PAGE, pages: held.pages, onNeedRows,
    }), [held, onNeedRows]);
    const waiting = useLoadingReveal(held === undefined && failed === undefined);
    if (failed !== undefined) return <SourceFailed source={source.name} message={failed} />;
    if (tree === undefined || paging === undefined) return waiting ? <VisualLoading view={visual.view} /> : null;
    if (paging.totalRows === 0) return <NoRows reason={m.noDataReason({ rows: midSentence(source.name) })} />;
    // In a popover it is narrow, where the tree opens its first row alone: one row read whole, the rest a line each.
    return <EastChakraValueTree value={tree} storageKey={storageKey} paging={paging} phoneFirstOnly />;
}
