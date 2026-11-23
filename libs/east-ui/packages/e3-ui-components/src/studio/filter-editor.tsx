/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A condition's rows, edited (#1673, #1674): the query builder's condition
 * rows in place (`ConditionRows`) — a field, a comparison, a value from the
 * values the rows hold with their counts, add a condition, all or any, and a
 * line of jq where the words run out — the shared picker under them while a
 * slot is open, taking the height the popover's body leaves it, so its list
 * is the one thing that scrolls. Never the builder's frame, its tabs or its
 * toolbar: the popover they lie in is their one frame.
 *
 * {@link ConditionEditor} is the query builder's own editor (`useQueryEditor`)
 * over a query whose last step is one Keep rows where step, its drafts held
 * here, not in an editing session. Its host is one of two kinds, and what
 * each edit tells it is the filters' rule for that kind
 * (`query/visual/filters.ts`):
 *
 * - One that applies each edit as it is made — a visual's own filter, in the
 *   inspector, a gesture of the canvas — hears the condition its finished
 *   rows hold, at once, and that it holds none once its last finished row is
 *   removed (`onChange`, `conditionTold`). Rows an edit left with none start
 *   again, one empty row, as Remove filter leaves them (`rowsKept`).
 * - One that commits by a button of its own — a page filter's popover (Add
 *   filter, Apply), an alert's (Save) — hears the rows as a draft after every
 *   edit: their condition, that none is left, or that none is finished
 *   (`onDraft`, `conditionDraft`).
 *
 * A page filter's query is its source's rows and the step
 * ({@link FilterConditions}); an alert's, its visual's rows and the step
 * (`alert-popover.tsx`).
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import { none, type JqNode } from "@elaraai/east";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { ConditionRows, type ConditionRowsProps } from "../query/condition-rows.js";
import { useQueryCall, useQuerySummaries } from "../query/hooks.js";
import type { SavedOffer } from "../query/model/slots.js";
import type { QueryRoot } from "../query/one-shot.js";
import { usePartStyles } from "../query/parts.js";
import { QUERY_HEADER_ID, entriesQuery, queryEntries, type QueryEntry, type QueryHeader } from "../query/session.js";
import type { StepQuery } from "../query/steps/values.js";
import type { QueryView } from "../query/toolbar.js";
import { useQueryEditor } from "../query/use-query-editor.js";
import { conditionDraft, conditionTold, filterQuery, rowsKept, whereOf, type ConditionDraft } from "../query/visual/filters.js";
import type { PrintSource } from "../query/visual/print.js";
import { useQueryWords } from "../query/words.js";

/** The one view a condition's rows have: the rows. */
const VIEWS: readonly QueryView[] = ["visual"];
/** A condition offers no saved queries to start from. */
const NO_SAVED: readonly SavedOffer[] = [];
const noop = (): void => {};

/** A condition's query's header: its source alone. */
function headerOf(source: string): QueryHeader {
    return { id: QUERY_HEADER_ID, name: "", description: none, source, jq: none };
}

/**
 * Where a condition's edits go: to a host that applies each as it is made
 * (`onChange`), or to one that commits them by a button of its own (`onDraft`).
 */
export type ConditionHost =
    | {
        /** Told the condition its finished rows hold, each time an edit changes it; `undefined` once its last finished row is removed. */
        readonly onChange: (where: JqNode | undefined) => void;
        readonly onDraft?: undefined;
    }
    | {
        readonly onChange?: undefined;
        /** Told what the rows say after every edit: their condition, that none is left, or that none is finished. */
        readonly onDraft: (draft: ConditionDraft) => void;
    };

/** Props of {@link ConditionEditor}: its query, and its host. */
export type ConditionEditorProps = ConditionEditorBase & ConditionHost;

/** What a {@link ConditionEditor} edits. */
interface ConditionEditorBase extends Pick<ConditionRowsProps, "autoOpen"> {
    /** What the condition is among its host's: another opened starts its rows afresh. */
    readonly id: string;
    /** The query its rows edit, as it stands when they open: its last step the condition's Keep rows where step. */
    readonly query: () => StepQuery;
    /** The condition it held as it opened; `undefined` for one still to be written. */
    readonly held: JqNode | undefined;
    /** The condition an edited query holds, once its step is finished; `undefined` while it is not. */
    readonly conditionOf: (query: StepQuery) => JqNode | undefined;
    /** The root its query reads. */
    readonly root: QueryRoot;
}

/**
 * A condition's rows — see the module docs.
 *
 * @param props - The query its rows edit, the condition it held, how the condition is read, the root, and where an edit goes
 * @returns The rows of its last step, and the open slot's picker
 */
export function ConditionEditor({ id, query, held: was, conditionOf, root, onChange, onDraft, autoOpen = false }: ConditionEditorProps) {
    const words = useQueryWords();
    const ps = usePartStyles(words);
    const styles = useSlotStyles("studioFilters");
    const call = useQueryCall();
    const summaries = useQuerySummaries(root, call);
    // The rows' drafts: the query, as it stood when they were opened.
    const [drafts, setDrafts] = useState<{ readonly entries: readonly QueryEntry[]; readonly version: number }>(() => {
        const opened = query();
        return { entries: queryEntries(headerOf(opened.source), opened.steps), version: 0 };
    });
    const latest = useRef(drafts.entries);
    const current = useCallback(() => latest.current, []);
    // The condition it holds: what it was opened with, then each one told.
    const held = useRef(was);
    const gesture = useCallback((next: readonly QueryEntry[]) => {
        const before = entriesQuery(latest.current).query;
        const { header, query: after } = entriesQuery(next);
        // A host that applies each edit keeps its rows standing (`rowsKept`); one that commits by a button keeps them
        // as the edit left them. Either is told what the edit did.
        const kept = onDraft === undefined ? rowsKept(after) : after;
        const shown = Object.is(kept, after) ? next : queryEntries(header, kept.steps);
        latest.current = shown;
        setDrafts((was) => ({ entries: shown, version: was.version + 1 }));
        if (onDraft !== undefined) {
            onDraft(conditionDraft(after, conditionOf));
            return true;
        }
        const told = conditionTold(before, after, held.current, conditionOf);
        if (told.kind !== "nothing") {
            held.current = told.kind === "condition" ? told.where : undefined;
            onChange(held.current);
        }
        return true;
    }, [conditionOf, onChange, onDraft]);
    const [bounds, setBounds] = useState<HTMLDivElement | null>(null);
    const boundsOf = useCallback(() => bounds, [bounds]);
    const editor = useQueryEditor({
        entries: drafts.entries, current, gesture, version: drafts.version, root, views: VIEWS, words, summaries,
        saved: NO_SAVED, onOpenSaved: noop, onShowQuery: noop, bounds: boundsOf, sourceId: id,
    });
    const card = editor.cards[editor.cards.length - 1];
    return (
        <Box css={styles.rows} data-studio-filter-rows="">
            {card !== undefined && <ConditionRows card={card} popover={editor.popover} ps={ps} actions={editor.actions} autoOpen={autoOpen} rootRef={setBounds} />}
        </Box>
    );
}

/** Props of {@link FilterConditions}: the filter, and its host. */
export type FilterConditionsProps = FilterConditionsBase & ConditionHost;

/** The filter a {@link FilterConditions} edits. */
interface FilterConditionsBase extends Pick<ConditionRowsProps, "autoOpen"> {
    /** What the filter is among the page's: another opened starts its rows afresh. */
    readonly id: string;
    /** The filter's condition over one row; `undefined` for one still to be written. */
    readonly where: JqNode | undefined;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** The root the page's programs read. */
    readonly root: QueryRoot;
}

/**
 * A filter's condition rows over a source (#1673): {@link ConditionEditor}
 * over a query of the source's rows and one Keep rows where step
 * (`filterQuery`), whose condition is the step's (`whereOf`).
 *
 * @param props - The filter's condition, its source, the page's root, and where an edit goes
 * @returns The rows, and the open slot's picker
 */
export function FilterConditions({ id, where, read, root, autoOpen = false, ...host }: FilterConditionsProps) {
    const query = useCallback(() => filterQuery(where, read, root.type), [where, read, root]);
    const conditionOf = useCallback((edited: StepQuery) => whereOf(edited, root.type), [root]);
    return <ConditionEditor id={id} query={query} held={where} conditionOf={conditionOf} root={root} autoOpen={autoOpen} {...host} />;
}
