/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder's footer loading line says (#1398, CL3) — the same shared
 * line (east-ui-components' `LoadingLine`) in every builder, its words the
 * builder's, in its record's noun:
 *
 * - **a paged source** — the Sheet's and the Plan's rows: `Loading work
 *   orders 8,301–8,500` (`Loading work orders…` while the rows read are not
 *   known yet), `Filtering work orders…` while a narrowing's rows are read
 *   and the last narrowing's stand in, `Couldn't read work orders
 *   8,301–8,500` with Retry ({@link PagedLoading}, {@link pagedLoadingLine});
 * - **a period** — the Roster's week, the Calendar's window, the
 *   Allocation's day: `Loading 12–18 Mar`, `Filtering people…` while a
 *   source the builder follows reads a new narrowing, `Couldn't read Wed 12
 *   May` with Retry ({@link periodLoading}, {@link periodLoadingLine}).
 *
 * Never a count of what has loaded: the toolbar's count is the only count.
 * Each builder's message table carries its words — the Sheet's and the
 * Plan's their own, extending {@link PagedLoadingMessages}; the period
 * builders share {@link scheduleLoadingMessages}.
 *
 * @packageDocumentation
 */

import { none, type option } from "@elaraai/east";
import { loadingLineText, loadingMessages, type LoadingLineText, type LoadingLineValue } from "@elaraai/east-ui-components/internal";

/**
 * What a paged source reads now, or could not read: its elements in flight
 * (`from`–`to`, 0-based and inclusive, both `undefined` before the rows read
 * are known), a narrowing's rows read while the last narrowing's stand in, or
 * a read that failed — a window's elements, or the source's own count or
 * revision, with no range — and why.
 */
export type PagedLoading =
    | { readonly kind: "loading"; readonly from: number | undefined; readonly to: number | undefined }
    | { readonly kind: "filtering" }
    | { readonly kind: "failed"; readonly from: number | undefined; readonly to: number | undefined; readonly reason: string };

/** The loading line's words over a paged source: numbers arrive formatted, 1-based. */
export interface PagedLoadingMessages {
    /** A read in flight — `Loading work orders 8,301–8,500`, the range strong; `Loading work orders…` before the rows read are known. */
    lineLoading: (p: { noun: string; from: string | undefined; to: string | undefined }) => LoadingLineText;
    /** A narrowing's rows read, the last narrowing's standing in — `Filtering work orders…`. */
    lineFiltering: (p: { noun: string }) => LoadingLineText;
    /** A read that failed — `Couldn't read work orders 8,301–8,500`, or the source's, with no range. */
    lineFailed: (p: { noun: string; from: string | undefined; to: string | undefined }) => LoadingLineText;
    /** The line's short form, where its full text does not fit the rail — `Loading…`, `Filtering…`, `Couldn't read`. */
    lineShort: (p: { kind: "loading" | "filtering" | "failed" }) => string;
    /** The failed line's Retry. */
    retry: () => string;
    /** A failed run's Retry, by what it asks again — its accessible name, `Retry work orders 8,301–8,500` (#1398, CL11). */
    retryRange: (p: { noun: string; from: string; to: string }) => string;
}

/** The short forms, in the shared parts' words. */
function shortOf(kind: "loading" | "filtering" | "failed"): string {
    return kind === "loading" ? loadingMessages.loading() : kind === "filtering" ? loadingMessages.filtering() : loadingMessages.failed();
}

/** The loading line's words over a paged source, in English. */
export const pagedLoadingMessages: PagedLoadingMessages = {
    lineLoading: ({ noun, from, to }) => (from === undefined || to === undefined ? [`Loading ${noun}…`] : [`Loading ${noun} `, { strong: `${from}–${to}` }]),
    lineFiltering: ({ noun }) => [`Filtering ${noun}…`],
    lineFailed: ({ noun, from, to }) => (from === undefined || to === undefined ? [`Couldn't read ${noun}`] : [`Couldn't read ${noun} `, { strong: `${from}–${to}` }]),
    lineShort: ({ kind }) => shortOf(kind),
    retry: () => loadingMessages.retry(),
    retryRange: ({ noun, from, to }) => `Retry ${noun} ${from}–${to}`,
};

/**
 * The line a paged source's read says, in a builder's words.
 *
 * @param loading - What is read, or failed; `undefined` while nothing is
 * @param noun - What the rail counts the rows in — `work orders`
 * @param m - The builder's message table
 * @param number - The builder's locale's number formatter
 * @param onRetry - What the failed line's Retry asks again
 * @returns The line's value; `undefined` while nothing is read
 */
export function pagedLoadingLine(
    loading: PagedLoading | undefined, noun: string, m: PagedLoadingMessages, number: (n: number) => string, onRetry: () => void,
): LoadingLineValue | undefined {
    if (loading === undefined) return undefined;
    const range = (from: number | undefined, to: number | undefined) =>
        ({ from: from === undefined ? undefined : number(from + 1), to: to === undefined ? undefined : number(to + 1) });
    switch (loading.kind) {
        case "loading": return { kind: "loading", text: m.lineLoading({ noun, ...range(loading.from, loading.to) }), short: m.lineShort({ kind: "loading" }) };
        case "filtering": return { kind: "loading", text: m.lineFiltering({ noun }), short: m.lineShort({ kind: "filtering" }) };
        case "failed": return {
            kind: "failed", text: m.lineFailed({ noun, ...range(loading.from, loading.to) }), short: m.lineShort({ kind: "failed" }),
            reason: loading.reason, onRetry, retry: m.retry(),
        };
    }
}

/**
 * What a period builder reads now, or could not read: the period's own reads
 * — its events, its own row, the Roster's targets — or, after a source of the
 * slice it follows has first resolved, that source's new narrowing, the last
 * standing in; or a read that failed — the period's, or a source's, named by
 * its noun — why, and what asks it again.
 */
export type PeriodLoading =
    | { readonly kind: "loading" }
    | { readonly kind: "filtering"; readonly noun: string }
    | { readonly kind: "failed"; readonly reason: string; readonly noun?: string | undefined; readonly onRetry: () => void };

/** A source of the slice a period builder follows beside its period — the Roster's people, the Allocation's lanes. */
export interface PeriodNarrowing {
    /** What its rows are, in the rail's words — `people`. */
    readonly noun: string;
    /** Whether a complete membership has resolved: until one has, its read is part of the frame's first. */
    readonly ready: boolean;
    /** Whether a membership is being read. */
    readonly loading: boolean;
    /** Why its read failed. */
    readonly error: string | undefined;
    /** Reads it again. */
    readonly retry: () => void;
}

/**
 * What a period builder's line says of its reads (#1398, CL3): a failure
 * first — the period's, then a source's — then the period's reads, a source's
 * first membership among them, then a source's new narrowing.
 *
 * @param period - The period's own reads: whether one is in flight, why the latest failed, and what asks them again
 * @param narrowings - The sources the builder follows beside the period, in the rail's order
 * @returns What the line says; `undefined` while nothing is read
 */
export function periodLoading(period: { readonly loading: boolean; readonly error: string | undefined; readonly retry: () => void },
    narrowings: readonly PeriodNarrowing[]): PeriodLoading | undefined {
    if (period.error !== undefined) return { kind: "failed", reason: period.error, onRetry: period.retry };
    for (const source of narrowings) if (source.error !== undefined) return { kind: "failed", reason: source.error, noun: source.noun, onRetry: source.retry };
    if (period.loading || narrowings.some(source => !source.ready && source.loading)) return { kind: "loading" };
    const filtering = narrowings.find(source => source.loading);
    return filtering === undefined ? undefined : { kind: "filtering", noun: filtering.noun };
}

/** The loading line's words over a period — the Roster's week, the Calendar's window, the Allocation's day. */
export interface ScheduleLoadingMessages {
    /** A period read — `Loading 12–18 Mar`, the period strong. */
    periodLoading: (p: { period: string }) => LoadingLineText;
    /** A source's new narrowing read, the last standing in — `Filtering people…`. */
    periodFiltering: (p: { noun: string }) => LoadingLineText;
    /** A period whose read failed — `Couldn't read Wed 12 May`. */
    periodFailed: (p: { period: string }) => LoadingLineText;
    /** A source whose narrowing could not be read — `Couldn't read people`. */
    sourceFailed: (p: { noun: string }) => LoadingLineText;
    /** The line's short form, where its full text does not fit the rail — `Loading…`, `Filtering…`, `Couldn't read`. */
    periodShort: (p: { kind: "loading" | "filtering" | "failed" }) => string;
    /** The failed line's Retry. */
    retry: () => string;
}

/** The period builders' loading line words, in English. */
export const scheduleLoadingMessages: ScheduleLoadingMessages = {
    periodLoading: ({ period }) => ["Loading ", { strong: period }],
    periodFiltering: ({ noun }) => [`Filtering ${noun}…`],
    periodFailed: ({ period }) => ["Couldn't read ", { strong: period }],
    sourceFailed: ({ noun }) => [`Couldn't read ${noun}`],
    periodShort: ({ kind }) => shortOf(kind),
    retry: () => loadingMessages.retry(),
};

/**
 * The line a period builder's reads say (#1398, CL3).
 *
 * @param state - What is read, or failed (`periodLoading`); `undefined` while nothing is
 * @param period - The period, as its builder names it — `12–18 Mar`
 * @param m - The words: the shared schedule table unless given
 * @returns The line's value; `undefined` while nothing is read
 */
export function periodLoadingLine(state: PeriodLoading | undefined, period: string, m: ScheduleLoadingMessages = scheduleLoadingMessages): LoadingLineValue | undefined {
    if (state === undefined) return undefined;
    switch (state.kind) {
        case "loading": return { kind: "loading", text: m.periodLoading({ period }), short: m.periodShort({ kind: "loading" }) };
        case "filtering": return { kind: "loading", text: m.periodFiltering({ noun: state.noun }), short: m.periodShort({ kind: "filtering" }) };
        case "failed": return {
            kind: "failed", text: state.noun === undefined ? m.periodFailed({ period }) : m.sourceFailed({ noun: state.noun }),
            short: m.periodShort({ kind: "failed" }), reason: state.reason, onRetry: state.onRetry, retry: m.retry(),
        };
    }
}

/**
 * What a period builder's views draw of the period they show (#1398):
 *
 * - `held`: the period as read;
 * - `pending`: a period not read yet — its geometry and what is known without
 *   its read at once, and a placeholder where its content goes (CL2), never a
 *   value it has not read (CL13); each placeholder unseen at its footprint
 *   until the builder's one reveal clock says so (CL4: its `LoadingReveal`,
 *   which each placeholder reads itself, so the clock's flip renders the
 *   placeholders and never the frame);
 * - `failed`: a period whose read failed — its geometry, its cells blank, and
 *   the failure said once, in its first row in view, with Retry (CL11).
 */
export type PeriodRead =
    | { readonly state: "held" }
    | { readonly state: "pending" }
    | { readonly state: "failed"; readonly message: string; readonly retry: () => void };

/** The period as read. */
export const HELD_PERIOD: PeriodRead = { state: "held" };

/** A period not read yet. */
const PENDING_PERIOD: PeriodRead = { state: "pending" };

/**
 * What a period builder's views draw of its period ({@link PeriodRead}): the
 * period as read once it has landed; else, its read failed, the failure in the
 * builder's words — `Couldn't read Wed 12 May` — and what asks it again; else
 * pending.
 *
 * @param period - Whether the period shown has landed, why its read failed, what it is called — `Wed 12 May` — and what asks it again
 * @param m - The words: the shared schedule table unless given
 * @returns What the views draw
 */
export function periodRead(period: { readonly current: boolean; readonly error: string | undefined; readonly name: string; readonly retry: () => void },
    m: ScheduleLoadingMessages = scheduleLoadingMessages): PeriodRead {
    if (period.current) return HELD_PERIOD;
    if (period.error !== undefined) return { state: "failed", message: loadingLineText(m.periodFailed({ period: period.name })), retry: period.retry };
    return PENDING_PERIOD;
}

/** A record a period's read reads: its `entries` where it is read a window at a time, and its source of the slice, if any. */
export interface PeriodRecord {
    /** The record read by key: `none` for a record read whole. */
    readonly entries: option<{ readonly refresh: (target: option<string>) => unknown }>;
    /** Its source's part of the slice. */
    readonly part?: { readonly retry: () => unknown } | undefined;
}

/**
 * Ask again every record a period's read reads (#1398, the line's Retry):
 * each read a window at a time through its `entries` — a refresh, which asks
 * again at once what failed — and each other through its source of the
 * slice, whose Retry is the same refresh.
 *
 * @param records - The records the period's read reads
 */
export function retryPeriod(records: readonly PeriodRecord[]): void {
    for (const record of records) {
        if (record.entries.type === "some") record.entries.value.refresh(none);
        else record.part?.retry();
    }
}
