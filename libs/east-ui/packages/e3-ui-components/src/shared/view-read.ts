/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The one rule a builder reads its rows by (#1599, ruled 11 Nov 2026): how
 * what a board shows stands to what it is asked for now, and so whether it
 * takes a gesture.
 *
 * A builder reads its rows for a **view**: a period — a day, a week, a window
 * of dates — under the choices its rail holds. Each read takes a round trip, so
 * what a board shows is its last complete read, which stands while a newer one
 * is on its way. The rule says what that read is, by the view it was made for:
 *
 * - **cold** — nothing read yet: the frame's cold load.
 * - **stepping** — the period asked is another than the one read: the board
 *   draws none of the old period's rows under the new one's labels.
 * - **filtering** — the same period under other choices: the rows the last
 *   choices left stand in, *retained* — readable, focusable and selectable,
 *   taking no gesture — until the new choices' rows land. A gesture there
 *   would act on a row its person has asked not to see.
 * - **rereading** — the same period and the same choices, read again: a Save
 *   of the page's own, or another session's write, moved the record. What the
 *   board shows is what its person asked for, so it is *live*: a gesture is
 *   taken at once, beginning from the row shown (east-ui-components'
 *   `EditSession.startOf`), and a Save never stops the editing.
 * - **current** — what is shown is what is asked, and nothing is on its way.
 *
 * A board is held back, then, only while what it shows is another view's —
 * never for a read again of its own. Every builder that reads its rows apart
 * from its editing session asks this rule, each giving its own period and
 * choices as text; none keeps a rule of its own.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";

const stringEqual = equalFor(StringType);

/** The view a read of a builder's rows is made for: its period, and the choices it was read under. */
export interface ReadView {
    /**
     * The period it is of, as text: what a step of the dates moves — a window's bounds, a week's start. The same text
     * for the same period; the empty text for a builder whose rows follow no period.
     */
    readonly period: string;
    /** The choices it was read under, as text: each source's narrowing, printed. The same text for the same choices. */
    readonly choices: string;
}

/** How what a board shows stands to what it is asked for now (see the module docs). */
export type ViewState = "cold" | "stepping" | "filtering" | "rereading" | "current";

/**
 * Whether two views are one: the same period under the same choices.
 *
 * @param a - A view
 * @param b - Another
 * @returns Whether they are the same view
 */
export function sameView(a: ReadView, b: ReadView): boolean {
    return stringEqual(a.period, b.period) && stringEqual(a.choices, b.choices);
}

/**
 * How what a board shows stands to what it is asked for now (see the module docs).
 *
 * @param shown - The view the last complete read was made for; `undefined` before one has landed
 * @param asked - The view asked for now
 * @param reading - Whether a read of the view asked is on its way
 * @returns The state
 */
export function viewState(shown: ReadView | undefined, asked: ReadView, reading: boolean): ViewState {
    if (shown === undefined) return "cold";
    if (!stringEqual(shown.period, asked.period)) return "stepping";
    if (!stringEqual(shown.choices, asked.choices)) return "filtering";
    return reading ? "rereading" : "current";
}

/**
 * Whether what a board holds is of the period asked: while it is not — nothing read, or a period stepped to — it draws
 * none of it.
 *
 * @param state - The view's state
 * @returns Whether the rows held are the period's
 */
export function viewOfPeriod(state: ViewState): boolean {
    return state !== "cold" && state !== "stepping";
}

/**
 * Whether a board takes a gesture: what it shows is the view asked, read again or not.
 *
 * @param state - The view's state
 * @returns Whether it is live
 */
export function viewLive(state: ViewState): boolean {
    return state === "current" || state === "rereading";
}

/**
 * Whether what a board shows stands in for other choices' rows of the same period: retained — readable, focusable and
 * selectable, taking no gesture — until they land.
 *
 * @param state - The view's state
 * @returns Whether it is retained
 */
export function viewRetained(state: ViewState): boolean {
    return state === "filtering";
}

/**
 * The last complete read of a builder's rows, and the view it was made for: what stands while a newer read is on its
 * way. A builder's reader lands each complete read here and asks how it stands to what is asked now; it keeps no rule
 * of its own.
 *
 * @typeParam T - What a read holds: the builder's rows, in its own shape
 */
export class StandingRead<T> {
    private held: { readonly rows: T; readonly view: ReadView } | undefined;

    /**
     * A read that completed: it stands from now.
     *
     * @param rows - What it read
     * @param view - The view it was made for
     */
    land(rows: T, view: ReadView): void {
        this.held = { rows, view };
    }

    /** What the last complete read holds; `undefined` before one has landed. */
    get rows(): T | undefined {
        return this.held?.rows;
    }

    /** The view the last complete read was made for; `undefined` before one has landed. */
    get view(): ReadView | undefined {
        return this.held?.view;
    }

    /**
     * How what stands is to what is asked for now.
     *
     * @param asked - The view asked for now
     * @param reading - Whether a read of it is on its way
     * @returns The state
     */
    state(asked: ReadView, reading: boolean): ViewState {
        return viewState(this.held?.view, asked, reading);
    }
}
