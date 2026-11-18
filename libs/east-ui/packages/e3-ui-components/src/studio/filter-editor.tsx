/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page filter's conditions, edited (#1673): the query builder's condition
 * rows over one source's rows, in place — a field, a comparison, a value from
 * the values the source holds with their counts, add a condition, all or any,
 * and a line of jq where the words run out. Never the builder's frame, its
 * tabs or its toolbar.
 *
 * It is the query builder's own editor (`useQueryEditor`) over a query of one
 * Keep rows where step (`filterQuery`), its drafts held here, not in an
 * editing session: each edit that leaves the step finished is told as the
 * filter's condition (`whereOf`); one that leaves it unfinished waits.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { JqType, equalFor, none, type JqNode } from "@elaraai/east";
import { useQueryCall, useQuerySummaries } from "../query/hooks.js";
import type { SavedOffer } from "../query/model/slots.js";
import type { QueryRoot } from "../query/one-shot.js";
import { Lines, Parts, usePartStyles, type Styles } from "../query/parts.js";
import { SlotAutocomplete } from "../query/autocomplete.js";
import { QUERY_HEADER_ID, entriesQuery, queryEntries, type QueryEntry, type QueryHeader } from "../query/session.js";
import type { QueryView } from "../query/toolbar.js";
import { useQueryEditor } from "../query/use-query-editor.js";
import { filterQuery, whereOf } from "../query/visual/filters.js";
import type { PrintSource } from "../query/visual/print.js";
import { useQueryWords } from "../query/words.js";

/** The one view a filter's conditions have: the rows. */
const VIEWS: readonly QueryView[] = ["visual"];
/** A filter offers no saved queries to start from. */
const NO_SAVED: readonly SavedOffer[] = [];
const noop = (): void => {};
const sameCondition = equalFor(JqType);

/** A filter's query's header: its source alone. */
function headerOf(source: string): QueryHeader {
    return { id: QUERY_HEADER_ID, name: "", description: none, source, jq: none };
}

/** Props of {@link FilterConditions}. */
export interface FilterConditionsProps {
    /** What the filter is among the page's: another opened starts its rows afresh. */
    readonly id: string;
    /** The filter's condition over one row; `undefined` for one still to be written. */
    readonly where: JqNode | undefined;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** The root the page's programs read. */
    readonly root: QueryRoot;
    /** Told the condition, each time an edit leaves the rows finished. */
    readonly onChange: (where: JqNode) => void;
}

/**
 * A filter's condition rows — see the module docs.
 *
 * @param props - The filter's condition, its source, the page's root, and where an edit goes
 * @returns The rows, and the open slot's autocomplete
 */
export function FilterConditions({ id, where, read, root, onChange }: FilterConditionsProps) {
    const words = useQueryWords();
    const ps = usePartStyles(words);
    const styles = useSlotRecipe({ key: "studioFilters" })() as Styles;
    const call = useQueryCall();
    const summaries = useQuerySummaries(root, call);
    // The rows' drafts: the filter as a query of one step, as it stood when it was opened.
    const [drafts, setDrafts] = useState<{ readonly entries: readonly QueryEntry[]; readonly version: number }>(() => ({
        entries: queryEntries(headerOf(read.key), filterQuery(where, read, root.type).steps), version: 0,
    }));
    const latest = useRef(drafts.entries);
    const current = useCallback(() => latest.current, []);
    // The condition the filter holds: what it was opened with, then each one told.
    const held = useRef(where);
    const gesture = useCallback((next: readonly QueryEntry[]) => {
        latest.current = next;
        setDrafts((was) => ({ entries: next, version: was.version + 1 }));
        // A finished step is the filter's condition; an unfinished one — a row added, still to be filled — waits, and
        // an edit that leaves the condition as it was tells nothing.
        const told = whereOf(entriesQuery(next).query, root.type);
        if (told !== undefined && (held.current === undefined || !sameCondition(told, held.current))) {
            held.current = told;
            onChange(told);
        }
        return true;
    }, [root, onChange]);
    const [bounds, setBounds] = useState<HTMLDivElement | null>(null);
    const boundsOf = useCallback(() => bounds, [bounds]);
    const editor = useQueryEditor({
        entries: drafts.entries, current, gesture, version: drafts.version, root, views: VIEWS, words, summaries,
        saved: NO_SAVED, onOpenSaved: noop, onShowQuery: noop, bounds: boundsOf, sourceId: id,
    });
    const [card] = editor.cards;
    const popover = editor.popover;
    const lines = useMemo(() => card?.lines ?? [], [card]);
    return (
        <Box ref={setBounds} css={styles.rows} data-studio-filter-rows="" {...(popover !== undefined ? { "data-choosing": "" } : {})}>
            {card !== undefined && card.head.length > 0 && <Box css={ps.styles.row} data-query-line="head"><Parts parts={card.head} ps={ps} actions={editor.actions} /></Box>}
            <Lines lines={lines} ps={ps} actions={editor.actions} />
            {popover !== undefined && bounds !== null && (
                <SlotAutocomplete key={popover.generation} anchor={popover.slot.anchor} bounds={bounds}
                    label={popover.label} placeholder={popover.placeholder} hint={popover.hint} empty={popover.empty} keys={popover.keys}
                    items={popover.items} text={popover.text} onText={popover.onText} initialActive={popover.initialActive}
                    onPick={popover.onPick} onClose={popover.onClose} />
            )}
        </Box>
    );
}
