/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The narrowing's chrome and the one shared scale (§3/§8, #1344).
 *
 * A Plan's narrowing is one `Slice.bindRecords` (`root/sources.ts`): its
 * `rows` source gives the canvas its rows, and each event kind narrowed
 * through a source of its own reads its events through it. The window is the
 * sources' shared `range`: every source whose range field speaks the axis's
 * arm holds it — an event kind's, a tab's that lists what is in the dates on
 * screen — the first leading. The canvas's rows never follow the dates: the
 * `rows` source never holds the window, so a pan, a
 * step, the brush or a key never narrows them again, and a date field there
 * is a field of the rail the viewer sets. The leading source's window is the
 * canvas's; with none — a choice that replaced it, a preset, Clear all — the
 * window last shown stands, and before any, the axis's stated window. A source
 * that does not hold the window takes it, unless writing it would replace a
 * choice of the source's own, which the reader made knowingly: the range
 * editor said so. The rows never set the window (#822).
 *
 * A canvas whose slice has no source holding the window holds its own
 * ({@link PlanWindowHold}): the pan, the keys, the now rung, the brush and the
 * date navigator move it, and the render follows. Each move is kept under the
 * canvas's storage key, as its toggles are (#813, `persisted.ts`), and a
 * remount opens on it from its first paint ({@link restoredWindow}) while the
 * axis still allows it — else on the axis's stated window. A canvas with no
 * slice keeps the axis's stated window.
 *
 * The window is a range, and a time axis's columns take the period the range
 * and the plot's width give (#1740, `shared/time/period.ts`): the finest the
 * axis offers whose column holds the column floor. The period is no state of
 * a source's and is kept nowhere: the canvas's hold works it out when the
 * range changes, by whatever control, and when the canvas opens, and holds
 * that one while the plot's width alone changes — a pane opened, a browser
 * resized — down to the squeeze floor ({@link PlanWindowHold.periodFor},
 * {@link PlanWindowHold.layOut}).
 *
 * The range and the width say nothing of how much the range holds. Past what a
 * view may draw, the period they give may show nothing of what is in view
 * where a coarser one, which a summary shades, does (#1799,
 * `shared/schedule/fallback-period.ts`): the canvas then has its hold fall
 * back to that one ({@link PlanWindowHold.fallBack}), the range as it is. A
 * fallback only ever goes coarser, and it stands while the range moves along
 * — a pan, a step, the now rung, a brush dragged along — so the columns never
 * go finer and back as a viewer moves through such a time. A range of another
 * length — a brush resized or drawn anew, a zoom — is picked again on the
 * plot, and so is a period pressed ({@link PlanWindowHold.pickAgain}).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getSomeorUndefined, useSlicesReactivity } from "@elaraai/east-ui-components";
import { recordSliceDomain, recordSliceWindow, recordSliceWindowFits, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { columnPeriod, periodColumns, squeezedPeriod } from "../../shared/time/period.js";
import { MAX_BUCKETS, resolutionInterval } from "../../shared/time/scale.js";
import { coarserThan } from "../../shared/time/zoom.js";
import { axisPeriods, resolveScale, type PlanAxisValue } from "../axis.js";
import { PLAN_COLUMN_WIDTHS, PLAN_UNLAID_PLOT } from "../geometry.js";
import type { PlanResolution, PlanScale } from "../scale.js";
import type { PlanAxisKind } from "../instant.js";
import type { PlanRootValue } from "../model.js";
import type { PlanOwnWindow } from "../persisted.js";
import type { PlanWords } from "../words.js";
import { PLAN_ROW_SOURCES, planSlices, planWindowParts, type PlanSlicesChrome, type PlanSourcePart } from "./sources.js";

/** A source holding the window: its name, and its part of the slice. */
export interface PlanWindowPart {
    readonly source: string;
    readonly part: PlanSourcePart;
}

/**
 * The canvas's window beside what its sources hold (#1344) — one per canvas,
 * shared by its render, its controller's effects and its date navigator, so a
 * gesture moves the window the reader sees.
 *
 * It holds the window last shown: the leading source's while one holds it, so
 * a choice that replaced that source's range leaves it standing — and, while
 * no source of the slice holds one, the canvas's own, which a gesture moves
 * ({@link PlanWindowHold.move}) and the render follows
 * ({@link PlanWindowHold.subscribe}). It names the sources whose ranges never
 * hold the window, as the canvas renders, so its effects read the same
 * sources holding it as its render does.
 *
 * It holds the period the window's columns take too (#1740), worked out at the
 * last change of range on the plot as the canvas laid it out — or the coarser
 * one the canvas fell back to there (#1799) — so the render, the effects and a
 * gesture read one period.
 */
export interface PlanWindowHold {
    /** The window last shown, `[from, to)` on the axis's domain; `undefined` before any. */
    last: readonly [number, number] | undefined;
    /** The sources whose ranges never hold the window, by name: the `rows` source (`PLAN_ROW_SOURCES`). */
    rows: readonly string[];
    /** How many times a gesture has moved the canvas's own window, or a change of the plot's width or a fallback its
     *  columns' period: what its render reads the hold by. */
    readonly version: number;
    /** The span of what the canvas's series shown read through its rows' nested series index (#1438), `[from, to)`: what a zoom
     *  to a table cell's period keeps the canvas's own window inside; `undefined` where none is known. */
    span: readonly [number, number] | undefined;
    /** The plot's width as the canvas last laid it out, in px (#1740): what a range's period is picked on, and a preset's
     *  columns counted on. Before any, the plot a canvas not laid out weighs its window on. */
    readonly plot: number;
    /**
     * Moves the canvas's own window — no source of its slice holds one — and
     * tells its render. The window it shows already moves nothing.
     *
     * @param min - The window's start, on the axis's domain
     * @param max - Its end, exclusive
     */
    move(min: number, max: number): void;
    /**
     * Takes the plot's width as the canvas lays it out (#1740). The first one
     * picks the window's period again, on the plot as it is; a later one alone
     * keeps the period — a pane opened or shut, a browser resized, asks nothing
     * of the time — and picks it again only where its columns would fall under
     * the squeeze floor. It tells the render where the period moved. A plot of
     * no width, a pane hidden, is not laid out, and changes nothing. Nor does
     * the plot's width undo a fallback: only a period as coarse takes its place.
     *
     * @param plot - The plot's width, in px
     */
    layOut(plot: number): void;
    /**
     * The period a window's columns take (#1740): the one picked at the last
     * change of range — or fallen back to there — while the range and the
     * periods offered are the same; else picked now, on the plot as it is, and
     * kept. A fallback stands for a range that is the last moved along, unless
     * the plot gives it a coarser period still (#1799): one as long — a brush
     * dragged along — or one of as many whole columns of the period fallen
     * back to as the last touches — a pan, a step, the now rung.
     *
     * @param from - The window's start, in ms
     * @param to - Its end, exclusive
     * @param offered - The periods the axis offers
     * @returns The period; `undefined` where none is offered
     */
    periodFor(from: number, to: number, offered: readonly PlanResolution[]): PlanResolution | undefined;
    /**
     * Falls back to a coarser period for the range as it is (#1799): the one
     * its columns take shows nothing of what is in view, and this one does
     * (`shared/schedule/fallback-period.ts`). It tells the render. Only ever
     * coarser: a period no coarser than the one in use, or one the axis does
     * not offer, changes nothing — nor does any before a range is shown.
     *
     * @param period - The period to take
     */
    fallBack(period: PlanResolution): void;
    /**
     * Picks the period again on the plot as it is, for the range as it is: a
     * period pressed is tried again where the canvas had fallen back from it
     * (#1799). It tells the render where the period moved; with no fallback
     * standing it changes nothing.
     */
    pickAgain(): void;
    /**
     * Listens for a move of the canvas's own window, or of its columns' period.
     *
     * @param listener - Called after each move
     * @returns Stop listening
     */
    subscribe(listener: () => void): () => void;
}

/**
 * Whether a range is another moved along (#1799): as long as it — a brush
 * dragged along — or whole columns of a period, as many as the other touches —
 * a pan, a step or the now rung at that period, which shift the columns drawn.
 * A range of another length is a viewer's change of it.
 *
 * @param period - The period the other's columns take
 * @param was - The other range, `[from, to)` in ms
 * @param from - The range's start, in ms
 * @param to - Its end, exclusive
 * @returns Whether it is the other moved along
 */
function movedAlong(period: PlanResolution, was: { readonly from: number; readonly to: number }, from: number, to: number): boolean {
    if (to - from === was.to - was.from) return true;
    const interval = resolutionInterval(period);
    return interval.floor(new Date(from)).getTime() === from && interval.floor(new Date(to)).getTime() === to
        && periodColumns(period, from, to) === periodColumns(period, was.from, was.to);
}

/**
 * A window hold for a canvas.
 *
 * @param initial - The canvas's own window to open on: what a last session kept, as {@link restoredWindow} takes it
 *   back (#813); left out, no window shown yet
 * @returns The hold, showing `initial`, the `rows` source the one whose range never holds the window, its plot not laid out
 */
export function createPlanWindowHold(initial?: readonly [number, number]): PlanWindowHold {
    const listeners = new Set<() => void>();
    let version = 0;
    let plot = PLAN_UNLAID_PLOT;
    let laidOut = false;
    // The period picked at the last change of range, and the range and the periods it was picked for; `fell` where the
    // canvas fell back to it from the finer one the plot gives the range (#1799).
    let kept: { from: number; to: number; offered: readonly PlanResolution[]; period: PlanResolution; fell: boolean } | undefined;
    const tell = () => {
        version += 1;
        for (const listener of [...listeners]) listener();
    };
    const hold: PlanWindowHold = {
        last: initial,
        rows: PLAN_ROW_SOURCES,
        span: undefined,
        get version() { return version; },
        get plot() { return plot; },
        move(min, max) {
            if (hold.last !== undefined && hold.last[0] === min && hold.last[1] === max) return;
            hold.last = [min, max];
            tell();
        },
        layOut(width) {
            if (!(width > 0) || (laidOut && width === plot)) return;
            const first = !laidOut;
            plot = width;
            laidOut = true;
            if (kept === undefined) return;
            const picked = first
                ? columnPeriod(kept.from, kept.to, plot, kept.offered, PLAN_COLUMN_WIDTHS.floor) ?? kept.period
                : squeezedPeriod(kept.period, kept.from, kept.to, plot, kept.offered, PLAN_COLUMN_WIDTHS);
            // The plot's width never undoes a fallback: what is in view is no fewer for it.
            if (picked === kept.period || (kept.fell && coarserThan(kept.period, picked))) return;
            kept = { ...kept, period: picked, fell: false };
            tell();
        },
        periodFor(from, to, offered) {
            const was = kept !== undefined && kept.offered.length === offered.length && kept.offered.every((period, i) => period === offered[i])
                ? kept : undefined;
            if (was !== undefined && was.from === from && was.to === to) return was.period;
            const picked = columnPeriod(from, to, plot, offered, PLAN_COLUMN_WIDTHS.floor);
            if (picked === undefined) return undefined;
            // A fallback stands for the range it was made at moved along, unless the plot gives that a coarser period still.
            const stands = was !== undefined && was.fell && !coarserThan(picked, was.period) && movedAlong(was.period, was, from, to);
            kept = { from, to, offered, period: stands ? was.period : picked, fell: stands };
            return kept.period;
        },
        fallBack(period) {
            if (kept === undefined || !coarserThan(period, kept.period) || !kept.offered.includes(period)) return;
            kept = { ...kept, period, fell: true };
            tell();
        },
        pickAgain() {
            if (kept === undefined || !kept.fell) return;
            const picked = columnPeriod(kept.from, kept.to, plot, kept.offered, PLAN_COLUMN_WIDTHS.floor) ?? kept.period;
            const moved = picked !== kept.period;
            kept = { ...kept, period: picked, fell: false };
            if (moved) tell();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
    return hold;
}

/** A source's range domain, on the axis's arm: its kind, and its bounds as numbers. */
export type PlanWindowDomain = NonNullable<ReturnType<typeof recordSliceDomain>>;

/**
 * The domain of the sources holding the window (#1344): from the earliest to
 * the latest of their range fields' values, each of the axis's arm — where
 * their data is: what the horizon spans, and what a zoom to a table cell's
 * period keeps its window inside (#1710).
 *
 * @param parts - The sources holding the window
 * @returns Their domain; `undefined` while no source has one
 */
export function windowPartsDomain(parts: readonly PlanWindowPart[]): PlanWindowDomain | undefined {
    let out: PlanWindowDomain | undefined;
    for (const { part } of parts) {
        const domain = recordSliceDomain(part);
        if (domain === undefined) continue;
        out = out === undefined ? domain : { kind: out.kind, min: Math.min(out.min, domain.min), max: Math.max(out.max, domain.max) };
    }
    return out;
}

/** The canvas's narrowing chrome and scale. */
export interface PlanWindow {
    /** The rail's chrome; `undefined` with no slice. */
    chrome: PlanSlicesChrome | undefined;
    /** The sources holding the window, in the slice's order. */
    windowParts: readonly PlanWindowPart[];
    /** The leading one: its range editor is the time navigator's Range panel. */
    lead: PlanWindowPart | undefined;
    /** The rail's affordance kinds. */
    affordances: readonly string[];
    /** The shared scale, or `undefined` when no window resolves. */
    scale: PlanScale | undefined;
    /** Why the window could not be written to a source: its indexes answer none beside its choices. */
    error: string | undefined;
}

/** Whether a source's window speaks the axis's arm. */
function fits(kind: "datetime" | "integer" | "float", axis: PlanAxisKind): boolean {
    return axis === "time" ? kind === "datetime" : axis === "number" && kind !== "datetime";
}

/**
 * The leading window among the sources holding one: the first that holds a
 * window of the axis's arm, `[from, to)` on the axis's domain.
 *
 * @param parts - The sources holding the window
 * @param axis - The axis kind
 * @returns Its window; `undefined` while none holds one
 */
export function leadingWindow(parts: readonly PlanWindowPart[], axis: PlanAxisKind): readonly [number, number] | undefined {
    for (const { part } of parts) {
        const window = recordSliceWindow(part);
        if (window !== undefined && fits(window.kind, axis) && window.max > window.min) return [window.min, window.max];
    }
    return undefined;
}

/**
 * The axis's stated window on its own domain: what a canvas shows before any
 * source holds one.
 *
 * @param axis - The decoded root axis
 * @returns `[from, to)`; `undefined` for an ordinal axis, or one that states none
 */
export function statedWindow(axis: PlanAxisValue): readonly [number, number] | undefined {
    switch (axis.type) {
        case "time": {
            const w = getSomeorUndefined(axis.value.window);
            return w !== undefined ? [w.min.getTime(), w.max.getTime()] : undefined;
        }
        case "number": {
            const w = getSomeorUndefined(axis.value.window);
            return w !== undefined ? [w.min, w.max] : undefined;
        }
        case "ordinal":
            return undefined;
    }
}

/**
 * The canvas's own window a last session kept under its storage key (#813), as
 * the canvas takes it back before its first paint: only while it holds its own
 * — its slice has no source holding the window, whose state keeps it — and only
 * a window the axis still allows, on the arm it was written on and one the
 * axis lays out in no more columns than the canvas draws: a range of time is
 * kept as a range, its period worked out again as the canvas opens (#1740), so
 * any range the coarsest period offered draws whole comes back. Anything else
 * leaves the axis's stated window.
 *
 * @param kept - What the canvas's storage keeps of its own window
 * @param value - The root the canvas mounts with: its axis and its slice
 * @param rows - The sources whose ranges never hold the window (`PLAN_ROW_SOURCES`)
 * @returns The window to open on, `[from, to)` on the axis's domain; `undefined` to open on the stated one
 */
export function restoredWindow(kept: PlanOwnWindow | undefined, value: PlanRootValue, rows: readonly string[]): readonly [number, number] | undefined {
    if (kept === undefined || value.axis.type !== kept.kind) return undefined;
    const chrome = planSlices(value);
    // A canvas with no slice keeps the axis's stated window, and one whose sources hold the window shows theirs.
    if (chrome === undefined || planWindowParts(chrome, value.axis.type, rows).length > 0) return undefined;
    const window = [kept.min, kept.max] as const;
    if (value.axis.type === "time") {
        const offered = axisPeriods(value.axis);
        const coarsest = offered[offered.length - 1];
        const columns = coarsest === undefined ? 0 : periodColumns(coarsest, kept.min, kept.max);
        return columns > 0 && columns <= MAX_BUCKETS ? window : undefined;
    }
    const scale = resolveScale({ axis: value.axis, sliceWindow: window });
    return scale === undefined || scale.truncated !== undefined ? undefined : window;
}

/**
 * The narrowing's chrome and the scale every row positions against.
 *
 * @param value - The latest root (its slice's chrome)
 * @param data - The root's data-stable twin (its axis)
 * @param words - The canvas's words — the locale the ruler labels format in (#820)
 * @param hold - The canvas's window hold (see {@link PlanWindowHold})
 * @param rows - The sources whose ranges never hold the window: the `rows` source (`PLAN_ROW_SOURCES`)
 * @returns The chrome, the sources holding the window, and the scale
 */
export function usePlanWindow(value: PlanRootValue, data: PlanRootValue, words: PlanWords, hold: PlanWindowHold, rows: readonly string[]): PlanWindow {
    const chrome = useMemo(() => planSlices(value), [value]);
    const axis = data.axis.type;
    const windowParts = useMemo(() => planWindowParts(chrome, axis, rows), [chrome, axis, rows]);
    // The controller's effects read the sources holding the window as the render does: they name the same row sources.
    useLayoutEffect(() => { hold.rows = rows; }, [hold, rows]);
    // Re-render on every write to a source: the window is their state, whoever wrote it. And on every move of the
    // canvas's own window, while no source holds one, and of its columns' period as the plot is laid out: the hold's state.
    const version = useSlicesReactivity(chrome?.slice.parts.map((p) => p.slice.key) ?? []);
    useSyncExternalStore(hold.subscribe, () => hold.version, () => hold.version);
    const affordances = useMemo(() => chrome?.affordances.map((a) => a.type) ?? [], [chrome]);
    // Read as numbers, never as the decoded state's objects, which are new every read: a memo keyed on them would
    // rebuild the scale — and hand every mounted row a new one — on every render (#812).
    const lead = leadingWindow(windowParts, axis);
    if (lead !== undefined) hold.last = lead;
    const from = (lead ?? hold.last)?.[0];
    const to = (lead ?? hold.last)?.[1];
    const stated = statedWindow(data.axis);
    const targetFrom = from ?? stated?.[0];
    const targetTo = to ?? stated?.[1];
    // The period the window's columns take (#1740): the hold's, picked at the last change of range on the plot as laid out.
    const offered = useMemo(() => axisPeriods(data.axis), [data.axis]);
    const period = axis !== "time" || targetFrom === undefined || targetTo === undefined ? undefined : hold.periodFor(targetFrom, targetTo, offered);
    // `resolveScale` owns the ladder: the sources' window — or the canvas's own — ▸ the stated window, per axis kind. The
    // rows are no input (#822), so windows landing keep one scale rather than handing every mounted row a new one (#812).
    const scale = useMemo(() => resolveScale({
        axis: data.axis,
        sliceWindow: from === undefined || to === undefined ? undefined : [from, to],
        period,
        words,
    }), [data.axis, from, to, period, words]);
    // Every source that does not hold the window yet takes it — a first mount, a range a choice replaced, or another
    // source's range written by the range editor — unless it would replace a choice of the source's own.
    const [error, setError] = useState<string>();
    useLayoutEffect(() => {
        if (targetFrom === undefined || targetTo === undefined || windowParts.length === 0) return;
        try {
            for (const { part } of windowParts) {
                const held = recordSliceWindow(part);
                if (held !== undefined && held.min === targetFrom && held.max === targetTo) continue;
                if (!recordSliceWindowFits(part)) continue;
                setRecordSliceWindow(part, targetFrom, targetTo);
            }
            setError(undefined);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The window could not be applied");
        }
        // `version` moves with every source's state: a range cleared or written there is followed here.
    }, [windowParts, targetFrom, targetTo, version]);
    const leadPart = windowParts[0];
    return useMemo(() => ({ chrome, windowParts, lead: leadPart, affordances, scale, error }),
        [chrome, windowParts, leadPart, affordances, scale, error]);
}
