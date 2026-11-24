/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A paged view's page (#1671, #1667): which of its rows a tile shows — a
 * records table's rows (TBL-1), a list's items, a summary's groups of its
 * first field, a pivot's rows — its programs for that page, asked through the
 * page's answers, and its model; the page before, held while the next is
 * asked; and its foot: where the page stands among the rows, and the
 * Pagination at the design system's small size, the footer band's 24px.
 *
 * A page is kept against its view's first page's programs: a new visual, or a
 * narrowing that asks other programs, starts at the first page; a new minute
 * that asks the same ones keeps the page it is on.
 *
 * Its foot is the design system's footer band, the one every host that pages
 * rows draws (east-ui-components' `PageFoot`): a Table's own pager is the
 * same.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useFormatters } from "@elaraai/east-ui-components";
import { PageFoot } from "@elaraai/east-ui-components/internal";
import type { VisualAnswer } from "../../query/visual/ask.js";
import { useVisualAnswers } from "../../query/visual/answers.js";
import { FIRST_PAGE, printVisual, VISUAL_RECORDS_PAGE, type PrintSource, type PrintState, type PrintedVisual, type VisualAsk } from "../../query/visual/print.js";
import { useStudioMessages } from "../messages.js";
import { ShownNote, VisualNote } from "./notes.js";
import type { Visual, VisualPlace, VisualShown } from "./values.js";

/** No programs: a view that does not print. */
const NO_ASKS: readonly VisualAsk[] = [];

/** The programs a printed visual asks, as one text: what a page is kept against. */
function programsOf(printed: PrintedVisual): string {
    return printed.kind === "asks" ? printed.asks.map((ask) => ask.program).join("\n\n") : printed.kind;
}

/**
 * A paged view's model of a page, from the page's programs, their answers and
 * the page's first row.
 *
 * @typeParam T - The view's model
 */
export type PageModelOf<T> = (asks: readonly VisualAsk[], answers: readonly VisualAnswer[], offset: number) => T | undefined;

/**
 * A paged view's page, as its tile draws it.
 *
 * @typeParam T - The view's model
 * @property drawn - The model drawn: the page's, or, while it is asked, the page's before; `undefined` until one is answered
 * @property waiting - Whether the page shown is asked and not yet answered
 * @property failed - Why its programs could not be asked, with a Retry where asking again may mend it; `undefined` while they can
 * @property offset - The page's first row, from 0
 * @property setPage - Shows another page, by its index from 0
 */
export interface PagedModel<T> {
    /** The model drawn: the page's, or, while it is asked, the page's before; `undefined` until one is answered. */
    readonly drawn: T | undefined;
    /** Whether the page shown is asked and not yet answered. */
    readonly waiting: boolean;
    /** Why its programs could not be asked; `undefined` while they can. */
    readonly failed: { readonly message: string; readonly retry: (() => void) | undefined } | undefined;
    /** The page's first row, from 0. */
    readonly offset: number;
    /** Shows another page, by its index from 0. */
    readonly setPage: (page: number) => void;
}

/**
 * A paged view's page: its programs for the page it shows, asked through the
 * page's answers — the first page's are the tile's own, asked once — and its
 * model, the page before held while the next is asked.
 *
 * @param visual - The visual, as its programs print it
 * @param read - Its source, as the printer reads it
 * @param state - The page's state, as its programs read it
 * @param modelOf - The view's model of a page; a stable function, so a model is made once an answer
 * @returns The page drawn, and how to show another
 */
export function usePagedModel<T>(visual: Visual, read: PrintSource, state: PrintState, modelOf: PageModelOf<T>): PagedModel<T> {
    // The page is kept against the first page's programs: other programs start at the first page.
    const first = useMemo(() => programsOf(printVisual(visual, read, state, FIRST_PAGE)), [visual, read, state]);
    const [kept, setKept] = useState({ first, page: 0 });
    const page = kept.first === first ? kept.page : 0;
    const setPage = useCallback((next: number) => setKept({ first, page: next }), [first]);
    const offset = page * VISUAL_RECORDS_PAGE;
    const printed = useMemo(() => printVisual(visual, read, state, { offset, size: VISUAL_RECORDS_PAGE }), [visual, read, state, offset]);
    const asks = printed.kind === "asks" ? printed.asks : NO_ASKS;
    const asked = useVisualAnswers(asks, visual.source);
    // A model an answer: the hook's array of them is new each render, its answers the page's own — the same ones
    // again are the answers the model was made of.
    const madeOf = useRef<readonly VisualAnswer[] | undefined>(undefined);
    const fresh = asked.status === "answered" ? asked.answers : undefined;
    const was = madeOf.current;
    const answers = fresh !== undefined && was !== undefined && fresh.length === was.length && fresh.every((answer, i) => answer === was[i]) ? was : fresh;
    madeOf.current = answers;
    const model = useMemo(() => (answers === undefined ? undefined : modelOf(asks, answers, offset)), [answers, asks, modelOf, offset]);
    // While another page is asked, the page before stays: held, never set as state, so drawing it draws nothing again.
    const held = useRef<T | undefined>(undefined);
    if (model !== undefined) held.current = model;
    return {
        drawn: model ?? held.current,
        waiting: model === undefined,
        failed: asked.status === "failed" ? { message: asked.message, retry: asked.retry } : undefined,
        offset,
        setPage,
    };
}

/** Props of {@link VisualPageFoot}. */
export interface VisualPageFootProps {
    /** Where the page stands among the rows. */
    readonly place: VisualPlace;
    /** The page's first row, from 0: which page the pager marks. */
    readonly offset: number;
    /** Shows another page, by its index from 0. */
    readonly onPage: (page: number) => void;
    /** Where the pager keeps its state. */
    readonly storageKey: string;
}

/**
 * A paged view's foot, on one line — the footer band (TBL-1): where the page
 * stands among the rows — `Showing 51–100 of 1,482` — and, past one page, its
 * page buttons.
 *
 * @param props - Where the page stands, its offset, how to show another, and where the pager keeps its state
 * @returns The foot
 */
export function VisualPageFoot({ place, offset, onPage, storageKey }: VisualPageFootProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const page = Math.floor(offset / VISUAL_RECORDS_PAGE);
    return (
        <PageFoot pages={place.total <= VISUAL_RECORDS_PAGE ? undefined : { count: place.total, pageSize: VISUAL_RECORDS_PAGE, page, onPage, storageKey: `${storageKey}.pages` }}>
            <VisualNote>{m.rowsShown({ first: f.number(place.first), last: f.number(place.last), of: f.number(place.total) })}</VisualNote>
        </PageFoot>
    );
}

/** Props of {@link VisualGroupsFoot}. */
export interface VisualGroupsFootProps extends VisualPageFootProps {
    /** What its first N holds of how many, when it keeps fewer than there are; `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
}

/**
 * A grouped view's foot (#1667) — a list's, a summary's, a pivot's: past one
 * page, where the page stands and its page buttons ({@link VisualPageFoot});
 * else, where its first N holds fewer than there are, how many of how many,
 * in the same band; else none.
 *
 * @param props - Where the page stands, what its first N holds, its offset, how to show another, and where the pager keeps its state
 * @returns The foot; nothing for a view of one page that holds every group
 */
export function VisualGroupsFoot({ shown, ...page }: VisualGroupsFootProps) {
    if (page.place.total > VISUAL_RECORDS_PAGE) return <VisualPageFoot {...page} />;
    if (shown === undefined) return null;
    return <PageFoot><ShownNote shown={shown} /></PageFoot>;
}
