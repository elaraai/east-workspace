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
 * `rows` source and a resource kind's never hold the window, so a pan, a
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
 * The resolution is the leading source's, written to each source holding the
 * window, else to every source (`controller/effects.ts`); a record's
 * resolution only re-buckets the canvas, and is no part of a source's
 * narrowing, so zooming fetches nothing.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getSomeorUndefined, useSlicesReactivity } from "@elaraai/east-ui-components";
import { recordSliceWindow, recordSliceWindowFits, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { resolveScale, type PlanAxisValue } from "../axis.js";
import type { PlanScale } from "../scale.js";
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
 */
export interface PlanWindowHold {
    /** The window last shown, `[from, to)` on the axis's domain; `undefined` before any. */
    last: readonly [number, number] | undefined;
    /** The sources whose ranges never hold the window, by name: the `rows` source and each resource kind's (`planRowSources`). */
    rows: readonly string[];
    /** How many times a gesture has moved the canvas's own window: what its render reads the hold by. */
    readonly moves: number;
    /**
     * Moves the canvas's own window — no source of its slice holds one — and
     * tells its render. The window it shows already moves nothing.
     *
     * @param min - The window's start, on the axis's domain
     * @param max - Its end, exclusive
     */
    move(min: number, max: number): void;
    /**
     * Listens for a move of the canvas's own window.
     *
     * @param listener - Called after each move
     * @returns Stop listening
     */
    subscribe(listener: () => void): () => void;
}

/**
 * A window hold for a canvas.
 *
 * @param initial - The canvas's own window to open on: what a last session kept, as {@link restoredWindow} takes it
 *   back (#813); left out, no window shown yet
 * @returns The hold, showing `initial`, the `rows` source the one whose range never holds the window
 */
export function createPlanWindowHold(initial?: readonly [number, number]): PlanWindowHold {
    const listeners = new Set<() => void>();
    let moves = 0;
    const hold: PlanWindowHold = {
        last: initial,
        rows: PLAN_ROW_SOURCES,
        get moves() { return moves; },
        move(min, max) {
            if (hold.last !== undefined && hold.last[0] === min && hold.last[1] === max) return;
            hold.last = [min, max];
            moves += 1;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
    return hold;
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
 * a window the axis still allows, on the arm it was written on and one the axis
 * lays out. Anything else leaves the axis's stated window.
 *
 * @param kept - What the canvas's storage keeps of its own window
 * @param value - The root the canvas mounts with: its axis and its slice
 * @param rows - The sources whose ranges never hold the window (`planRowSources`)
 * @returns The window to open on, `[from, to)` on the axis's domain; `undefined` to open on the stated one
 */
export function restoredWindow(kept: PlanOwnWindow | undefined, value: PlanRootValue, rows: readonly string[]): readonly [number, number] | undefined {
    if (kept === undefined || value.axis.type !== kept.kind) return undefined;
    const chrome = planSlices(value);
    // A canvas with no slice keeps the axis's stated window, and one whose sources hold the window shows theirs.
    if (chrome === undefined || planWindowParts(chrome, value.axis.type, rows).length > 0) return undefined;
    const window = [kept.min, kept.max] as const;
    return resolveScale({ axis: value.axis, sliceWindow: window, sliceResolution: undefined }) === undefined ? undefined : window;
}

/**
 * The resolution the slice holds: the leading source's, else the first
 * source's — a slice with no window holds it there.
 *
 * @param chrome - The rail's chrome
 * @param parts - The sources holding the window
 * @returns Its tag; `undefined` while it holds none
 */
export function slicedResolution(chrome: PlanSlicesChrome | undefined, parts: readonly PlanWindowPart[]): string | undefined {
    const part = parts[0]?.part ?? chrome?.slice.parts[0]?.slice;
    return part === undefined ? undefined : getSomeorUndefined(part.read().resolution)?.type;
}

/**
 * The narrowing's chrome and the scale every row positions against.
 *
 * @param value - The latest root (its slice's chrome)
 * @param data - The root's data-stable twin (its axis)
 * @param words - The canvas's words — the locale the ruler labels format in (#820)
 * @param hold - The canvas's window hold (see {@link PlanWindowHold})
 * @param rows - The sources whose ranges never hold the window: the `rows` source and each resource kind's (`planRowSources`)
 * @returns The chrome, the sources holding the window, and the scale
 */
export function usePlanWindow(value: PlanRootValue, data: PlanRootValue, words: PlanWords, hold: PlanWindowHold, rows: readonly string[]): PlanWindow {
    const chrome = useMemo(() => planSlices(value), [value]);
    const axis = data.axis.type;
    const windowParts = useMemo(() => planWindowParts(chrome, axis, rows), [chrome, axis, rows]);
    // The controller's effects read the sources holding the window as the render does: they name the same row sources.
    useLayoutEffect(() => { hold.rows = rows; }, [hold, rows]);
    // Re-render on every write to a source: the window and the resolution are their state, whoever wrote them. And on
    // every move of the canvas's own window, while no source holds one: the hold's state.
    const version = useSlicesReactivity(chrome?.slice.parts.map((p) => p.slice.key) ?? []);
    useSyncExternalStore(hold.subscribe, () => hold.moves, () => hold.moves);
    const affordances = useMemo(() => chrome?.affordances.map((a) => a.type) ?? [], [chrome]);
    // Read as numbers, never as the decoded state's objects, which are new every read: a memo keyed on them would
    // rebuild the scale — and hand every mounted row a new one — on every render (#812).
    const lead = leadingWindow(windowParts, axis);
    if (lead !== undefined) hold.last = lead;
    const from = (lead ?? hold.last)?.[0];
    const to = (lead ?? hold.last)?.[1];
    const resolution = slicedResolution(chrome, windowParts);
    // `resolveScale` owns the ladder: the sources' window — or the canvas's own — ▸ the stated window, per axis kind. The
    // rows are no input (#822), so windows landing keep one scale rather than handing every mounted row a new one (#812).
    const scale = useMemo(() => resolveScale({
        axis: data.axis,
        sliceWindow: from === undefined || to === undefined ? undefined : [from, to],
        sliceResolution: resolution,
        words,
    }), [data.axis, from, to, resolution, words]);
    // Every source that does not hold the window yet takes it — a first mount, a range a choice replaced, or another
    // source's range written by the range editor — unless it would replace a choice of the source's own.
    const [error, setError] = useState<string>();
    const stated = statedWindow(data.axis);
    const targetFrom = from ?? stated?.[0];
    const targetTo = to ?? stated?.[1];
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
